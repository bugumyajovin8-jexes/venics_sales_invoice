import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Using a new database file to cleanly apply the new Email/Password schema
const dbPath = path.join(dbDir, 'backend_v2.db');
export const db = new Database(dbPath);

// Initialize Backend Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('boss', 'admin', 'manager', 'cashier', 'employee', 'staff')),
    is_active INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    name TEXT NOT NULL,
    buy_price REAL NOT NULL,
    sell_price REAL NOT NULL,
    stock INTEGER NOT NULL,
    low_stock_threshold INTEGER NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    date INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    total_profit REAL NOT NULL,
    is_credit INTEGER DEFAULT 0,
    customer_name TEXT,
    customer_phone TEXT,
    due_date INTEGER,
    is_paid INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    buy_price REAL NOT NULL,
    sell_price REAL NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id)
  );

  CREATE TABLE IF NOT EXISTS features (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    feature_key TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS licenses (
    shop_id TEXT PRIMARY KEY,
    start_date INTEGER NOT NULL,
    expiry_date INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  -- Index Everything: Ensure crucial lookups are fully indexed to eliminate sequential table scans
  CREATE INDEX IF NOT EXISTS idx_users_shop_id ON users (shop_id);
  CREATE INDEX IF NOT EXISTS idx_users_shop_updated ON users (shop_id, updated_at);

  CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products (shop_id);
  CREATE INDEX IF NOT EXISTS idx_products_shop_updated ON products (shop_id, updated_at);

  CREATE INDEX IF NOT EXISTS idx_sales_shop_id ON sales (shop_id);
  CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales (user_id);
  CREATE INDEX IF NOT EXISTS idx_sales_shop_updated ON sales (shop_id, updated_at);

  CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id);
  CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items (product_id);

  CREATE INDEX IF NOT EXISTS idx_features_shop_id ON features (shop_id);
  CREATE INDEX IF NOT EXISTS idx_features_shop_updated ON features (shop_id, updated_at);
`);

// Seed initial admin user
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
if (userCount.count === 0) {
  const shopId = 'SYSTEM';
  const adminId = uuidv4();
  const now = Date.now();
  
  db.prepare('INSERT INTO shops (id, name, updated_at) VALUES (?, ?, ?)').run(shopId, 'System Administration', now);
  
  const passHash = bcrypt.hashSync('123456', 10);
  db.prepare('INSERT INTO users (id, shop_id, email, password_hash, role, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    adminId, shopId, 'admin@pos.com', passHash, 'admin', 1, now
  );
  
  console.log('Seeded initial admin: email: admin@pos.com, password: 123456');
}

export class ServerRamCache {
  private static userByEmail = new Map<string, any>();
  private static licenseByShop = new Map<string, any>();
  private static featuresByShop = new Map<string, any[]>();

  static getUserByEmail(email: string): any {
    if (this.userByEmail.has(email)) {
      return this.userByEmail.get(email);
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (user) {
      this.userByEmail.set(email, user);
    }
    return user;
  }

  static getLicenseByShop(shopId: string): any {
    if (this.licenseByShop.has(shopId)) {
      return this.licenseByShop.get(shopId);
    }
    const license = db.prepare('SELECT * FROM licenses WHERE shop_id = ?').get(shopId) as any;
    if (license) {
      this.licenseByShop.set(shopId, license);
    }
    return license;
  }

  static getFeaturesByShop(shopId: string): any[] {
    if (this.featuresByShop.has(shopId)) {
      return this.featuresByShop.get(shopId) || [];
    }
    const features = db.prepare('SELECT * FROM features WHERE shop_id = ?').all(shopId) as any[];
    if (features) {
      this.featuresByShop.set(shopId, features);
    }
    return features || [];
  }

  static invalidateUser(email: string) {
    this.userByEmail.delete(email);
  }

  static invalidateLicense(shopId: string) {
    this.licenseByShop.delete(shopId);
  }

  static invalidateFeatures(shopId: string) {
    this.featuresByShop.delete(shopId);
  }
}

