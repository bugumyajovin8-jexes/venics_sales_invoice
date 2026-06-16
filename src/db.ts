import Dexie, { type Table } from 'dexie';
import { decrypt } from './utils/encryption';

export interface Shop {
  id: string;
  name: string;
  owner_name: string;
  phone?: string;
  whatsapp_phone?: string;
  status?: 'active' | 'blocked';
  enable_expiry?: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  isDeleted: number;
  synced: number;
}

export interface User {
  id: string;
  shop_id?: string;
  shopId?: string; // Alias for compatibility
  email: string;
  name: string;
  phone?: string;
  role: 'superadmin' | 'admin' | 'employee' | 'staff' | 'boss' | 'manager' | 'cashier'; // Expanded roles to match schema
  status: 'active' | 'blocked';
  isActive?: boolean; // Alias for compatibility
  last_seen?: string;
  is_deleted?: boolean; // Remote field
  fcm_token?: string; // For push notifications
  isDeleted: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface Product {
  id: string;
  shop_id: string;
  name: string;
  buy_price: number;
  sell_price: number;
  stock: number;
  min_stock: number;
  unit: string;
  batches: {
    id: string;
    batch_number: string;
    expiry_date: string;
    stock: number;
  }[];
  notify_expiry_days?: number;
  stock_delta: number;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface Sale {
  id: string;
  shop_id: string;
  user_id: string;
  total_amount: number;
  total_profit: number;
  is_credit: boolean;
  is_paid: boolean;
  payment_method: 'cash' | 'mobile_money' | 'credit' | 'mobile' | 'card';
  status: 'completed' | 'cancelled' | 'refunded' | 'pending';
  customer_name?: string;
  customer_phone?: string;
  due_date?: string;
  date: string;
  is_vat?: boolean;
  transport_cost?: number;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  shop_id: string;
  product_id: string;
  product_name: string;
  qty: number;
  buy_price: number;
  sell_price: number;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at?: string;
  synced: number;
}

export interface Expense {
  id: string;
  shop_id: string;
  user_id?: string;
  amount: number;
  category: string;
  description?: string;
  date: string;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface Settings {
  id: number;
  shopName: string;
  currency: string;
  taxPercentage: number;
  darkMode: boolean;
  lastSync: number;
  shopId?: string;
}

export interface Feature {
  id: string;
  shop_id?: string;
  featureKey: string;
  isEnabled: boolean;
  updated_at: string;
  synced: number;
}

export interface AuditLog {
  id: string;
  shop_id: string;
  user_id: string;
  user_name?: string;
  action: 'add_product' | 'edit_product' | 'import_products' | 'delete_product' | 'delete_all_products' | 'refund_sale' | 'add_expense' | 'discounted_sale' | 'login' | 'logout' | 'app_opened';
  details: any;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface DebtPayment {
  id: string;
  shop_id: string;
  sale_id: string;
  amount: number;
  date: string;
  isDeleted: number; // 0 for false, 1 for true
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface License {
  id: number; // Always 1
  deviceId: string;
  startDate: number;
  expiryDate: number;
  isActive: boolean;
  lastVerifiedAt: number;
  signature?: string; // HMAC signature for tamper detection
}

export class PosDatabase extends Dexie {
  shops!: Table<Shop>;
  users!: Table<User>;
  products!: Table<Product>;
  sales!: Table<Sale>;
  saleItems!: Table<SaleItem>;
  expenses!: Table<Expense>;
  settings!: Table<Settings>;
  features!: Table<Feature>;
  auditLogs!: Table<AuditLog>;
  license!: Table<License>;
  debtPayments!: Table<DebtPayment>;

  constructor() {
    super('PosDatabaseV10'); // Bumped version for encryption
    this.version(16).stores({
      shops: 'id, name, created_by, synced',
      users: 'id, shop_id, email, role, synced',
      products: 'id, shop_id, name, synced, isDeleted, [shop_id+isDeleted]',
      sales: 'id, shop_id, user_id, status, created_at, synced, isDeleted, [shop_id+isDeleted], [shop_id+isDeleted+created_at]',
      saleItems: 'id, sale_id, shop_id, product_id, synced, isDeleted',
      expenses: 'id, shop_id, category, date, synced, isDeleted, [shop_id+isDeleted], [shop_id+isDeleted+date]',
      settings: 'id',
      features: 'id, featureKey, synced',
      auditLogs: 'id, shop_id, user_id, action, created_at, synced, isDeleted, [shop_id+isDeleted], [shop_id+isDeleted+created_at]',
      license: 'id',
      debtPayments: 'id, shop_id, sale_id, synced, isDeleted'
    });

    // Encryption Hooks (Reading only for backward compatibility)
    const sensitiveFields: Record<string, string[]> = {
      products: ['buy_price'],
      sales: ['total_profit'],
      saleItems: ['buy_price'],
      expenses: ['amount'],
      debtPayments: ['amount']
    };

    Object.entries(sensitiveFields).forEach(([tableName, fields]) => {
      const table = this.table(tableName);

      table.hook('reading', (obj) => {
        if (!obj) return obj;
        fields.forEach(field => {
          if (obj[field] !== undefined && typeof obj[field] === 'string') {
            try {
              const decrypted = decrypt(obj[field]);
              const num = parseFloat(decrypted);
              if (!isNaN(num)) {
                obj[field] = num;
              }
            } catch (e) {
              // If decryption fails, it might not be encrypted yet
            }
          }
        });
        return obj;
      });
    });

    // Write-Through Tracking Hooks
    this.tables.forEach(table => {
      if (table.name !== 'settings' && table.name !== 'license') {
        table.hook('creating', (primKey, obj: any) => {
          if (obj && obj.synced === 0) {
            triggerSyncCallback();
          }
        });

        table.hook('updating', (modifications: any, primKey, obj: any) => {
          if (modifications.synced === 0 || (obj && obj.synced === 0)) {
            triggerSyncCallback();
          }
        });
      }
    });
  }
}

export type LocalWriteListener = () => void;
let onLocalWriteTrigger: LocalWriteListener | null = null;

let scheduledCallback: any = null;
const triggerSyncCallback = () => {
  if (scheduledCallback) return;
  scheduledCallback = setTimeout(() => {
    scheduledCallback = null;
    if (typeof onLocalWriteTrigger === 'function') {
      try {
        onLocalWriteTrigger();
      } catch (e) {
        console.error('onLocalWriteTrigger callback error:', e);
      }
    }
  }, 100);
};

export function registerLocalWriteTrigger(listener: LocalWriteListener) {
  onLocalWriteTrigger = listener;
}

export const db = new PosDatabase();

