import { Router } from 'express';
import { db, ServerRamCache } from '../db';
import { authenticateToken, requireRole } from './auth';

export const licenseRouter = Router();

licenseRouter.use(authenticateToken);

// Check license for current shop
licenseRouter.get('/check', (req: any, res) => {
  const { shop_id, role } = req.user;
  if (role === 'admin' && shop_id === 'SYSTEM') {
    return res.json({
      shop_id: 'SYSTEM',
      start_date: Date.now(),
      expiry_date: Date.now() + (365 * 24 * 60 * 60 * 1000),
      is_active: 1,
      updated_at: Date.now()
    });
  }
  const license = ServerRamCache.getLicenseByShop(shop_id);
  res.json(license);
});

// Admin routes
licenseRouter.use(requireRole(['admin']));

// Get all licenses
licenseRouter.get('/all', (req: any, res) => {
  const licenses = db.prepare(`
    SELECT s.name as shop_name, l.* 
    FROM licenses l 
    JOIN shops s ON l.shop_id = s.id
    WHERE s.id != 'SYSTEM'
  `).all();
  res.json(licenses);
});

// Extend license by 30 days
licenseRouter.post('/extend', (req: any, res) => {
  const { shop_id } = req.body;
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  
  try {
    const license = ServerRamCache.getLicenseByShop(shop_id);
    if (!license) return res.status(404).json({ error: 'License not found' });

    // If already expired, start 30 days from now. If active, add 30 days to expiry.
    const newExpiry = Math.max(now, license.expiry_date) + thirtyDays;

    db.prepare(`
      UPDATE licenses 
      SET expiry_date = ?, updated_at = ? 
      WHERE shop_id = ?
    `).run(newExpiry, now, shop_id);
    
    ServerRamCache.invalidateLicense(shop_id);
    
    res.json({ success: true, newExpiry });
  } catch (error) {
    res.status(500).json({ error: 'Failed to extend license' });
  }
});

// Block/Unblock shop
licenseRouter.post('/block', (req: any, res) => {
  const { shop_id, is_active } = req.body;
  const now = Date.now();
  
  try {
    db.prepare(`
      UPDATE licenses 
      SET is_active = ?, updated_at = ? 
      WHERE shop_id = ?
    `).run(is_active ? 1 : 0, now, shop_id);
    
    ServerRamCache.invalidateLicense(shop_id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update license status' });
  }
});

