import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db, ServerRamCache } from '../db';

export const authRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_change_in_prod';

authRouter.post('/register', (req, res) => {
  const { shopName, email, password } = req.body;
  if (!shopName || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const existing = ServerRamCache.getUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const shopId = uuidv4();
    const userId = uuidv4();
    const now = Date.now();
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    const passHash = bcrypt.hashSync(password, 10);

    const transaction = db.transaction(() => {
      db.prepare('INSERT INTO shops (id, name, updated_at) VALUES (?, ?, ?)').run(shopId, shopName, now);
      db.prepare('INSERT INTO licenses (shop_id, start_date, expiry_date, is_active, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        shopId, now, now + fourteenDays, 1, now
      );
      db.prepare('INSERT INTO users (id, shop_id, email, password_hash, role, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        userId, shopId, email, passHash, 'admin', 1, now
      );
    });

    transaction();

    const token = jwt.sign(
      { id: userId, role: 'admin', shop_id: shopId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: userId,
        email,
        role: 'admin',
        shop_id: shopId
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = ServerRamCache.getUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'Account disabled. Contact admin.' });
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, shop_id: user.shop_id },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      shop_id: user.shop_id
    }
  });
});

export const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  });
};

export const requireRole = (roles: string[]) => {
  return (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};
