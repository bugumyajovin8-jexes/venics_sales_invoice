import { Router } from 'express';
import { db } from '../db';
import { authenticateToken } from './auth';

export const syncRouter = Router();

syncRouter.use(authenticateToken);

// Pull changes from server since last sync
syncRouter.get('/pull', (req: any, res) => {
  const { shop_id, role } = req.user;
  const lastSync = parseInt(req.query.lastSync as string) || 0;

  if (role === 'admin' && shop_id === 'SYSTEM') {
    return res.json({ timestamp: Date.now(), data: { products: [], sales: [], saleItems: [], users: [], features: [] } });
  }

  try {
    const products = db.prepare('SELECT * FROM products WHERE shop_id = ? AND updated_at > ?').all(shop_id, lastSync);
    const sales = db.prepare('SELECT * FROM sales WHERE shop_id = ? AND updated_at > ?').all(shop_id, lastSync);
    
    // Get sale items for those sales
    const saleIds = sales.map((s: any) => s.id);
    let saleItems: any[] = [];
    if (saleIds.length > 0) {
      const placeholders = saleIds.map(() => '?').join(',');
      saleItems = db.prepare(`SELECT * FROM sale_items WHERE sale_id IN (${placeholders})`).all(...saleIds);
    }

    const users = db.prepare('SELECT id, email, role, is_active, updated_at FROM users WHERE shop_id = ? AND updated_at > ?').all(shop_id, lastSync);
    const features = db.prepare('SELECT * FROM features WHERE shop_id = ? AND updated_at > ?').all(shop_id, lastSync);

    res.json({
      timestamp: Date.now(),
      data: {
        products,
        sales,
        saleItems,
        users,
        features
      }
    });
  } catch (error) {
    console.error('Sync pull error:', error);
    res.status(500).json({ error: 'Failed to pull data' });
  }
});

// Push changes to server
syncRouter.post('/push', (req: any, res) => {
  const { shop_id, id: user_id, role } = req.user;
  const { products, sales, saleItems } = req.body;
  const now = Date.now();

  if (role === 'admin' && shop_id === 'SYSTEM') {
    return res.json({ success: true, timestamp: now });
  }

  const transaction = db.transaction(() => {
    // Process Products
    if (products && products.length > 0) {
      const stmt = db.prepare(`
        INSERT INTO products (id, shop_id, name, buy_price, sell_price, stock, low_stock_threshold, is_deleted, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          buy_price = excluded.buy_price,
          sell_price = excluded.sell_price,
          stock = excluded.stock,
          low_stock_threshold = excluded.low_stock_threshold,
          is_deleted = excluded.is_deleted,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at > products.updated_at
      `);
      for (const p of products) {
        stmt.run(p.id, shop_id, p.name, p.buy_price, p.sell_price, p.stock, p.low_stock_threshold, p.isDeleted ? 1 : 0, p.updatedAt || now);
      }
    }

    // Process Sales
    if (sales && sales.length > 0) {
      const stmtSale = db.prepare(`
        INSERT INTO sales (id, shop_id, user_id, date, total_amount, total_profit, is_credit, customer_name, customer_phone, due_date, is_paid, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          is_paid = excluded.is_paid,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at > sales.updated_at
      `);
      for (const s of sales) {
        stmtSale.run(
          s.id, shop_id, s.userId || user_id, s.date, s.totalAmount, s.totalProfit, 
          s.isCredit ? 1 : 0, s.customerName, s.customerPhone, s.dueDate, 
          s.isPaid ? 1 : 0, s.updatedAt || now
        );
      }
    }

    // Process Sale Items
    if (saleItems && saleItems.length > 0) {
      const stmtItem = db.prepare(`
        INSERT OR IGNORE INTO sale_items (id, sale_id, product_id, name, qty, buy_price, sell_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of saleItems) {
        stmtItem.run(item.id, item.saleId, item.productId, item.name, item.qty, item.buyPrice, item.sellPrice);
      }
    }
  });

  try {
    transaction();
    res.json({ success: true, timestamp: now });
  } catch (error) {
    console.error('Sync push error:', error);
    res.status(500).json({ error: 'Failed to push data' });
  }
});
