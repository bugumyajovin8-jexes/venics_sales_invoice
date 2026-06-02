import { db, AuditLog, registerLocalWriteTrigger } from '../db';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { LicenseService } from './license';

// Register immediate write-through trigger for index mutations (Push-on-Commit)
registerLocalWriteTrigger(() => {
  console.log('⚡ Write-Through Trigger received. Scheduling critical sync in 500ms...');
  SyncService.scheduleCriticalSync(true);
});

type DexieTable = {
  where: (field: string) => any;
  get: (key: string) => Promise<any>;
  put: (value: any) => Promise<any>;
  update: (key: string, changes: any) => Promise<any>;
  add: (value: any) => Promise<any>;
  toArray: () => Promise<any[]>;
};

type SupabaseResult<T> = { data: T; error: any };
type SyncScope = 'critical' | 'background' | 'full';
type SyncRequest = { scope: SyncScope; force: boolean; createdAt: number };

const SYNC_BATCH_SIZE = 100;
const PUSH_CHUNK_SIZE = 50;
const MAX_RETRIES = 3;

const CRITICAL_TABLES = ['sales', 'sale_items', 'products', 'debt_payments'] as const;
const DELAYED_TABLES = ['shops', 'users', 'features'] as const;
const BACKGROUND_TABLES = ['audit_logs', 'expenses'] as const;
const ALL_TABLES = [
  'shops',
  'users',
  'products',
  'sales',
  'sale_items',
  'expenses',
  'features',
  'audit_logs',
  'debt_payments',
] as const;

export class SyncService {
  private static activeSyncPromise: Promise<void> | null = null;
  private static requestQueue: SyncRequest[] = [];
  private static scheduledCriticalSync: ReturnType<typeof setTimeout> | null = null;
  private static scheduledBackgroundSync: ReturnType<typeof setTimeout> | null = null;
  private static scheduledFullSync: ReturnType<typeof setTimeout> | null = null;
  private static lastCriticalSyncStartedAt = 0;
  private static lastBackgroundSyncStartedAt = 0;
  private static lastFullSyncStartedAt = 0;

  private static pendingAuditLogs: any[] = [];
  private static auditLogFlushTimeout: ReturnType<typeof setTimeout> | null = null;

  private static scheduleAuditLogFlush() {
    if (this.auditLogFlushTimeout) return;
    this.auditLogFlushTimeout = setTimeout(async () => {
      this.auditLogFlushTimeout = null;
      await this.flushAuditLogs();
    }, 25_000); // 25s deferral to fully clear initial login and system startup windows
  }

  static async flushAuditLogs() {
    if (this.pendingAuditLogs.length === 0) return;
    const logsToFlush = [...this.pendingAuditLogs];
    this.pendingAuditLogs = [];
    try {
      await db.auditLogs.bulkAdd(logsToFlush);
      console.log(`[SyncService] Flushed ${logsToFlush.length} deferred audit logs.`);
      this.scheduleBackgroundSync();
    } catch (err) {
      console.error('[SyncService] Failed to flush deferred audit logs:', err);
      // Re-insert at the start of queue
      this.pendingAuditLogs.unshift(...logsToFlush);
    }
  }

  static async sync(force = false, scope: SyncScope = 'full'): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    this.enqueueRequest(scope, force);
    if (this.activeSyncPromise) return this.activeSyncPromise;

    this.activeSyncPromise = this.drainQueue();
    try {
      await this.activeSyncPromise;
    } finally {
      this.activeSyncPromise = null;
    }
  }

  static scheduleCriticalSync(force = false) {
    if (this.scheduledCriticalSync) clearTimeout(this.scheduledCriticalSync);
    this.scheduledCriticalSync = setTimeout(() => {
      this.scheduledCriticalSync = null;
      void this.sync(force, 'critical');
    }, 500);
  }

  static scheduleBackgroundSync(force = false) {
    if (this.scheduledBackgroundSync) clearTimeout(this.scheduledBackgroundSync);
    this.scheduledBackgroundSync = setTimeout(() => {
      this.scheduledBackgroundSync = null;
      void this.sync(force, 'background');
    }, 300_000); // Debounce background syncs heavily (5 minutes) to avoid I/O load
  }

  static scheduleFullSync(force = false) {
    if (this.scheduledFullSync) clearTimeout(this.scheduledFullSync);
    this.scheduledFullSync = setTimeout(() => {
      this.scheduledFullSync = null;
      void this.sync(force, 'full');
    }, 30_000);
  }

  static getIsSyncing() {
    return this.activeSyncPromise !== null;
  }

  static async triggerCriticalSync() {
    this.scheduleCriticalSync(true);
  }

  private static enqueueRequest(scope: SyncScope, force: boolean) {
    const existing = this.requestQueue.find(r => r.scope === scope);
    if (existing) {
      existing.force = existing.force || force;
      existing.createdAt = Math.min(existing.createdAt, Date.now());
    } else {
      this.requestQueue.push({ scope, force, createdAt: Date.now() });
    }

    this.requestQueue.sort((a, b) => {
      const priority = this.getScopePriority(b.scope) - this.getScopePriority(a.scope);
      if (priority !== 0) return priority;
      return a.createdAt - b.createdAt;
    });
  }

  private static async drainQueue(): Promise<void> {
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (!request) continue;
      await this.runOneSync(request.force, request.scope);
    }
  }

  private static getScopePriority(scope: SyncScope): number {
    if (scope === 'critical') return 3;
    if (scope === 'full') return 2;
    return 1;
  }

  private static async runOneSync(force: boolean, scope: SyncScope): Promise<void> {
    const now = Date.now();
    if (!force) {
      if (scope === 'critical' && now - this.lastCriticalSyncStartedAt < 1_000) return;
      if (scope === 'background' && now - this.lastBackgroundSyncStartedAt < 600_000) return; // 10 minutes throttle for non-urgent telemetry
      if (scope === 'full' && now - this.lastFullSyncStartedAt < 30_000) return;
    }

    if (scope === 'critical') this.lastCriticalSyncStartedAt = now;
    if (scope === 'background') this.lastBackgroundSyncStartedAt = now;
    if (scope === 'full') this.lastFullSyncStartedAt = now;

    const state = useStore.getState();
    const user = state.user;
    if (!user?.shopId) return;

    const shopId = user.shopId;
    const settings = await db.settings.get(1);

    try {
      console.log(`Starting ${scope} sync process...`);

      if (scope === 'full' || scope === 'background') {
        await this.runWithRetry(() => LicenseService.syncLicense(), 'syncLicense');
      }

      const pushTargets = this.getPushTargets(scope, user.role);
      let anyPushed = false;
      for (const tableName of pushTargets) {
        const table = this.getTableRef(tableName);
        if (table) {
          const unsyncedCount = await table.where('synced').equals(0).count();
          if (unsyncedCount > 0) {
            await this.pushTable(tableName, table);
            anyPushed = true;
          }
        }
      }

      if (anyPushed) {
        await this.updateServerHeartbeat(shopId);
      }

      // Check remote heartbeat key in shop_sync_state
      let shouldPull = true;
      let remoteHeartbeatStr = '';
      const localHeartbeatKey = `shop_sync_heartbeat_${shopId}`;
      const lastLocalHeartbeat = localStorage.getItem(localHeartbeatKey) || '';

      if (!force) {
        try {
          const { data: syncState, error: syncStateError } = await supabase
            .from('shop_sync_state')
            .select('last_updated_at')
            .eq('shop_id', shopId)
            .maybeSingle();

          if (syncStateError) {
            if (syncStateError.code === '42P01') {
              console.warn('shop_sync_state table does not exist on Supabase. Falling back to default individual pulls.');
            } else {
              console.error('Error fetching shop_sync_state:', syncStateError);
            }
          } else if (syncState) {
            remoteHeartbeatStr = syncState.last_updated_at || '';
            if (remoteHeartbeatStr && lastLocalHeartbeat && new Date(remoteHeartbeatStr).getTime() <= new Date(lastLocalHeartbeat).getTime()) {
              shouldPull = false;
              console.log(`Heartbeat matches local (${remoteHeartbeatStr}). Skipping pull targets.`);
            }
          } else {
            // Heartbeat row doesn't exist yet, we can create or initialize it
            const initTime = new Date().toISOString();
            await supabase
              .from('shop_sync_state')
              .upsert({ shop_id: shopId, last_updated_at: initTime }, { onConflict: 'shop_id' });
            remoteHeartbeatStr = initTime;
          }
        } catch (err) {
          console.error('Failed to query/update shop_sync_state heartbeat:', err);
        }
      }

      if (shouldPull) {
        const pullTargets = this.getPullTargets(scope, user.role);
        for (const tableName of pullTargets) {
          const lastSyncDate = this.getTableSyncDate(settings, tableName);
          await this.pullTable(tableName, this.getTableRef(tableName), shopId, lastSyncDate, force);
        }

        // Save new local heartbeat
        if (remoteHeartbeatStr) {
          localStorage.setItem(localHeartbeatKey, remoteHeartbeatStr);
        } else {
          localStorage.setItem(localHeartbeatKey, new Date().toISOString());
        }
      }

      if (scope !== 'critical') {
        await this.saveSettingsPatch({ lastSync: Date.now() });
      }

      if (scope === 'full' || scope === 'background') {
        const allFeatures = await db.features.toArray();
        const featureMap: Record<string, boolean> = {};
        allFeatures.forEach(f => {
          featureMap[f.featureKey] = f.isEnabled;
        });
        useStore.getState().setFeatures(featureMap);
      }

      console.log(`${scope} sync completed successfully`);
    } catch (error) {
      console.error(`${scope} sync failed:`, error);
    }
  }

  private static async updateServerHeartbeat(shopId: string) {
    try {
      const nowStr = new Date().toISOString();
      const localHeartbeatKey = `shop_sync_heartbeat_${shopId}`;

      const { error } = await supabase
        .from('shop_sync_state')
        .upsert({ shop_id: shopId, last_updated_at: nowStr }, { onConflict: 'shop_id' });

      if (!error) {
        localStorage.setItem(localHeartbeatKey, nowStr);
      }
    } catch (err) {
      console.warn('Silent failure updating server heartbeat:', err);
    }
  }

  private static getPushTargets(scope: SyncScope, role?: string): string[] {
    const isBoss = role === 'boss' || role === 'admin' || role === 'superadmin';

    if (scope === 'critical') return [...CRITICAL_TABLES];
    if (scope === 'background') return [...BACKGROUND_TABLES, 'features'];

    const tables = [...ALL_TABLES];
    if (!isBoss) {
      return tables.filter(t => !['shops', 'users', 'features'].includes(t));
    }
    return tables as string[];
  }

  private static getPullTargets(scope: SyncScope, role?: string): string[] {
    const isBoss = role === 'boss' || role === 'admin' || role === 'superadmin';

    if (scope === 'critical') return [...CRITICAL_TABLES];
    if (scope === 'background') return [...BACKGROUND_TABLES, 'features'];

    const tables = [...ALL_TABLES];
    if (!isBoss) {
      return tables.filter(t => !['shops', 'users'].includes(t));
    }
    return tables as string[];
  }

  private static getTableRef(tableName: string): DexieTable {
    const tables: Record<string, DexieTable> = {
      shops: db.shops,
      users: db.users,
      products: db.products,
      sales: db.sales,
      sale_items: db.saleItems,
      expenses: db.expenses,
      features: db.features,
      audit_logs: db.auditLogs,
      debt_payments: db.debtPayments,
    };

    return tables[tableName];
  }

  private static async runWithRetry<T>(fn: () => any, label: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await fn();
        if (result && typeof result === 'object' && 'error' in result && result.error) {
          throw result.error;
        }
        return (result && typeof result === 'object' && 'data' in result ? result.data : result) as T;
      } catch (error) {
        lastError = error;
        const waitMs = 300 * attempt * attempt;
        console.warn(`${label} failed on attempt ${attempt}/${MAX_RETRIES}. Retrying in ${waitMs}ms.`, error);
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }
    }

    throw lastError;
  }

  private static chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private static async saveSettingsPatch(patch: Record<string, any>) {
    const current = await db.settings.get(1);
    if (current) {
      await db.settings.update(1, patch);
    } else {
      await db.settings.put({ id: 1, ...patch } as any);
    }
  }

  private static getCursorKey(tableName: string) {
    return `syncCursor_${tableName}`;
  }

  private static getTableSyncDate(settings: any, tableName: string): string {
    const cursor = settings?.[this.getCursorKey(tableName)];
    if (!cursor) return new Date(0).toISOString();
    return new Date(cursor).toISOString();
  }

  private static async setTableSyncCursor(tableName: string, cursorValue: number) {
    await this.saveSettingsPatch({ [this.getCursorKey(tableName)]: cursorValue });
  }

  private static async pushTable(tableName: string, table: DexieTable) {
    const userRole = useStore.getState().user?.role;
    const isBoss = userRole === 'boss' || userRole === 'admin' || userRole === 'superadmin';

    if (!isBoss && ['shops', 'users', 'features'].includes(tableName)) return;

    let unsynced = await table.where('synced').equals(0).toArray();
    if (unsynced.length === 0) return;

    if (tableName === 'audit_logs') {
      const currentUser = useStore.getState().user;
      if (currentUser) {
        unsynced = unsynced.filter((record: any) => record.user_id === currentUser.id);
      } else {
        unsynced = [];
      }
      if (unsynced.length === 0) return;
    }

    if (tableName === 'products') {
      const productsData = unsynced.map(record => {
        const { synced, ...localData } = record;
        const dataToSync = this.mapToRemote(tableName, localData);
        dataToSync.stock_delta = record.stock_delta || 0;
        return dataToSync;
      });

      await this.runWithRetry(() => supabase.rpc('sync_products_with_deltas', { products_data: productsData }), 'sync_products_with_deltas');

      for (const record of unsynced) {
        const current = await table.get(record.id);
        if (!current) continue;
        const newDelta = (current.stock_delta || 0) - (record.stock_delta || 0);
        await table.update(record.id, {
          synced: newDelta === 0 ? 1 : 0,
          stock_delta: newDelta,
        });
      }
      return;
    }

    const remoteBatch = unsynced.map(record => {
      const { synced, ...localData } = record;
      return this.mapToRemote(tableName, localData);
    });

    let cursor = 0;
    for (const batch of this.chunk(remoteBatch, PUSH_CHUNK_SIZE)) {
      if (tableName === 'audit_logs') {
        await this.runWithRetry(() => supabase.from(tableName).insert(batch), `push ${tableName}`);
      } else {
        await this.runWithRetry(() => supabase.from(tableName).upsert(batch, { onConflict: 'id' }), `push ${tableName}`);
      }

      const syncedRows = unsynced.slice(cursor, cursor + batch.length);
      for (const record of syncedRows) {
        await table.update(record.id, { synced: 1 });
      }
      cursor += batch.length;
    }
  }

  private static async pullTable(tableName: string, table: DexieTable, shopId: string, lastSyncDate: string, force: boolean) {
    let hasMore = true;
    let offset = 0;
    let newestRemoteCursor = 0;

    while (hasMore) {
      let query = supabase.from(tableName).select('*');

      if (tableName === 'shops') {
        query = query.eq('id', shopId);
      } else {
        query = query.eq('shop_id', shopId);
      }

      if (tableName === 'audit_logs') {
        const role = useStore.getState().user?.role;
        if (role !== 'boss' && role !== 'admin' && role !== 'superadmin') return;
        query = query.eq('is_deleted', false);
      }

      if (lastSyncDate && !force && tableName !== 'features') {
        query = query.gt('updated_at', lastSyncDate);
      }

      query = query
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + SYNC_BATCH_SIZE - 1);

      let data: any[];
      try {
        data = await this.runWithRetry(() => query, `pull ${tableName} offset ${offset}`);
      } catch (error) {
        console.error(`Error pulling ${tableName} (offset ${offset}):`, error);
        return;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      await db.transaction('rw', table as any, async () => {
        for (const record of data) {
          const localData = this.mapToLocal(tableName, record);
          const existing = await table.get(record.id);

          const remoteUpdatedAt = record.updated_at ? new Date(record.updated_at).getTime() : 0;
          if (remoteUpdatedAt > newestRemoteCursor) newestRemoteCursor = remoteUpdatedAt;

          const isRemoteNewer = Boolean(
            existing &&
            record.updated_at &&
            existing.updated_at &&
            new Date(record.updated_at) > new Date(existing.updated_at)
          );

          const hasUnsyncedChanges = Boolean(existing && existing.synced === 0);

          if (!existing) {
            const dataToStore: any = { ...localData, synced: 1 };
            if (tableName === 'products') {
              dataToStore.stock_delta = localData.stock_delta || 0;
            }
            await table.put(dataToStore);
            continue;
          }

          if (isRemoteNewer) {
            if (tableName === 'products' && hasUnsyncedChanges) {
              const pendingDelta = existing.stock_delta || 0;
              const remoteStock = Number(record.stock) || 0;
              const mergedStock = Math.max(0, remoteStock + pendingDelta);

              await table.put({
                ...existing,
                ...localData,
                stock: mergedStock,
                stock_delta: pendingDelta,
                synced: 0,
              });
            } else if (!hasUnsyncedChanges) {
              await table.put({ ...existing, ...localData, synced: 1 });
            }
          }
        }
      });

      if (data.length < SYNC_BATCH_SIZE) {
        hasMore = false;
      } else {
        offset += SYNC_BATCH_SIZE;
      }
    }

    if (newestRemoteCursor > 0) {
      await this.setTableSyncCursor(tableName, newestRemoteCursor);
    }
  }

  private static mapToRemote(tableName: string, data: any) {
    const mapped: any = { ...data };
    const tablesWithIsDeleted = ['products', 'sales', 'sale_items', 'expenses', 'debt_payments', 'audit_logs'];

    if ('isDeleted' in mapped) {
      if (tablesWithIsDeleted.includes(tableName)) {
        mapped.is_deleted = mapped.isDeleted === 1;
      }
      delete mapped.isDeleted;
    }

    if ('shopId' in mapped) {
      if (!mapped.shop_id) mapped.shop_id = mapped.shopId;
      delete mapped.shopId;
    }

    delete mapped.synced;
    delete mapped.stock_delta;

    if (tableName === 'users') {
      mapped.status = data.status || (data.isActive ? 'active' : 'blocked');
      delete mapped.isActive;
    }

    if (tableName === 'sales') {
      if (mapped.payment_method === 'mobile' || mapped.payment_method === 'card') {
        mapped.payment_method = 'mobile_money';
      }
      if (!mapped.created_at && mapped.date) {
        mapped.created_at = mapped.date;
      }
      delete mapped.is_credit;
      delete mapped.is_paid;
      delete mapped.date;
    }

    if (tableName === 'debt_payments') {
      if (mapped.date) mapped.created_at = mapped.date;
      delete mapped.date;
    }

    if (tableName === 'features') {
      mapped.feature_key = data.featureKey;
      mapped.is_enabled = data.isEnabled;
      delete mapped.featureKey;
      delete mapped.isEnabled;
    }

    return mapped;
  }

  private static mapToLocal(tableName: string, data: any) {
    const mapped: any = { ...data };
    mapped.isDeleted = 0;

    if ('is_deleted' in data) {
      mapped.isDeleted = data.is_deleted ? 1 : 0;
      delete mapped.is_deleted;
    }

    if (tableName === 'users') {
      mapped.isActive = data.status === 'active';
      mapped.shopId = data.shop_id;
    }

    if (tableName === 'sales') {
      mapped.is_credit = data.payment_method === 'credit';
      mapped.is_paid = data.status === 'completed';
      mapped.date = data.created_at;
    }

    if (tableName === 'debt_payments') {
      mapped.date = data.created_at;
    }

    if (tableName === 'sale_items') {
      mapped.product_name = data.product_name || data.name;
    }

    if (tableName === 'features') {
      mapped.featureKey = data.feature_key;
      mapped.isEnabled = data.is_enabled;
    }

    return mapped;
  }

  static async logAction(action: AuditLog['action'], details: any) {
    const user = useStore.getState().user;
    if (!user?.shopId) return;

    const isBoss = user.role === 'boss' || user.role === 'admin' || user.role === 'superadmin';
    if (isBoss) return;

    const logEntry = {
      id: crypto.randomUUID(),
      shop_id: user.shopId,
      user_id: user.id,
      user_name: user.name,
      action,
      details,
      isDeleted: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      synced: 0,
    };

    if (action === 'logout') {
      try {
        await db.auditLogs.add(logEntry);
        await this.flushAuditLogs();
      } catch (err) {
        console.warn('Logging logout immediately failed, buffering:', err);
        this.pendingAuditLogs.push(logEntry);
        await this.flushAuditLogs();
      }
    } else {
      this.pendingAuditLogs.push(logEntry);
      this.scheduleAuditLogFlush();
    }
  }

  static async toggleFeature(key: string, isEnabled: boolean) {
    const user = useStore.getState().user;
    if (!user?.shopId) return;

    const existing = await db.features.where('featureKey').equals(key).first();
    const now = new Date().toISOString();

    if (existing) {
      await db.features.update(existing.id, {
        shop_id: user.shopId,
        isEnabled,
        updated_at: now,
        synced: 0,
      });
    } else {
      await db.features.add({
        id: crypto.randomUUID(),
        shop_id: user.shopId,
        featureKey: key,
        isEnabled,
        updated_at: now,
        synced: 0,
      });
    }

    const currentFeatures = useStore.getState().features;
    useStore.getState().setFeatures({ ...currentFeatures, [key]: isEnabled });
    this.scheduleBackgroundSync();
  }
}
