import { db, AuditLog, registerLocalWriteTrigger } from '../db';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { LicenseService } from './license';
import { v4 as uuidv4 } from 'uuid';

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
  /**
   * Deltas currently in flight, by product id.
   *
   * Read by the pull merge so a pull landing mid-push does not add a delta the
   * server has already applied. In memory only — the durable half is the
   * `pending_delta` claim written to the row itself, which is what survives the
   * process being killed.
   */
  private static inFlightProductDeltas: Map<string, number> = new Map();
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
        // Heartbeat shortcut removed for 100% reliable multi-device sync
      }

      const pullTargets = this.getPullTargets(scope, user.role);
      for (const tableName of pullTargets) {
        const lastSyncDate = this.getTableSyncDate(settings, tableName);
        await this.pullTable(tableName, this.getTableRef(tableName), shopId, lastSyncDate, force);
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

  /**
   * Set once a pull discovers whether the server has `server_updated_at`.
   * null = not yet known. Lets this build ship before the migration is run
   * without every pull failing on an unknown column.
   */
  private static serverCursorColumn: boolean | null = null;

  /** The column the incremental pull filters and orders on. */
  private static cursorColumn(): 'server_updated_at' | 'updated_at' {
    return this.serverCursorColumn === false ? 'updated_at' : 'server_updated_at';
  }

  private static getCursorKey(tableName: string) {
    // Scoped to the shop, and namespaced v2 — matching the mobile and desktop
    // apps, which share this database.
    //
    // It used to be one global key per table. Every pull filters
    // `.gt(<cursor column>, cursor)`, so that key was a high-water mark shared
    // by every shop and account this machine had ever signed into, and it only
    // ever moves forward: anything below it was never requested again.
    //
    // v2 because the stored value also changes MEANING here — it was a device
    // clock reading, it is now a server one — and comparing an old client
    // timestamp against the new column would skip rows just as badly. A fresh
    // key starts this device from epoch once, which is also what repairs a
    // device already missing another device's work.
    const user = useStore.getState().user;
    const shopId = user?.shopId || 'default';
    return `syncCursorV2_${shopId}_${tableName}`;
  }

  private static getTableSyncDate(settings: any, tableName: string): string {
    const cursor = settings?.[this.getCursorKey(tableName)];
    if (!cursor) return new Date(0).toISOString();
    // Stored as the raw string now, to keep the sub-millisecond precision a
    // Postgres timestamp carries. Older numeric cursors still convert.
    if (typeof cursor === 'string') return cursor;
    return new Date(cursor).toISOString();
  }

  private static async setTableSyncCursor(tableName: string, cursorValue: string | number) {
    await this.saveSettingsPatch({ [this.getCursorKey(tableName)]: cursorValue });
  }

  private static async pushTable(tableName: string, table: DexieTable) {
    const userRole = useStore.getState().user?.role;
    const isBoss = userRole === 'boss' || userRole === 'admin' || userRole === 'superadmin';

    if (!isBoss && ['shops', 'users', 'features'].includes(tableName)) return;

    let unsynced = await table.where('synced').equals(0).toArray();
    if (unsynced.length === 0) return;

    // Only ever push rows belonging to the ACTIVE shop. The local cache retains
    // rows from every shop this device has logged into, and every RLS policy
    // resolves the caller's shop to the single `users.shop_id` — so pushing
    // another shop's row is guaranteed to be rejected (42501), and after four
    // retries the exception aborts the entire push, taking the legitimate rows
    // in the same batch down with it.
    //
    // Filtered-out rows simply stay `synced: 0` and go up when the user switches
    // back to that shop. Rows carrying no shop_id at all are left alone rather
    // than being stranded here forever.
    const currentUserForShop = useStore.getState().user;
    const activeShopId = currentUserForShop?.shopId;
    if (activeShopId) {
      unsynced = unsynced.filter((record: any) => {
        // `shops` rows identify their shop by their own primary key.
        const owner = tableName === 'shops' ? record.id : record.shop_id;
        return owner === undefined || owner === null || owner === activeShopId;
      });
      if (unsynced.length === 0) return;
    }

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
      // ---- Claim each delta on disk BEFORE sending it ----------------------
      // Stock is additive on the server, so a delta that arrives twice is
      // counted twice — a shop that received 20 items sees 40. The server
      // de-duplicates by `delta_id`, but only if the client repeats the SAME id
      // and the SAME amount, and this app was sending no id at all: it fell back
      // to the server's weaker derived key, which catches an exact resend but
      // not "the app died, the shopkeeper added more stock, and the client now
      // sends a bigger delta".
      //
      // A row that ALREADY carries a claim is a resend: something interrupted
      // the previous attempt. Re-send that exact claim rather than whatever the
      // delta has grown to since, or the server would recognise the id, skip the
      // whole thing, and silently swallow the stock added in between.
      const claims = new Map<string, { deltaId: string; amount: number }>();

      for (const record of unsynced) {
        const resuming = !!record.pending_delta_id;
        const claim = resuming
          ? { deltaId: record.pending_delta_id as string, amount: Number(record.pending_delta) || 0 }
          : { deltaId: uuidv4(), amount: record.stock_delta || 0 };

        claims.set(record.id, claim);
        this.inFlightProductDeltas.set(record.id, claim.amount);

        if (!resuming) {
          await table.update(record.id, {
            pending_delta_id: claim.deltaId,
            pending_delta: claim.amount,
          });
        }
      }

      try {
        const productsData = unsynced.map(record => {
          const claim = claims.get(record.id)!;
          const { synced, ...localData } = record;
          const dataToSync = this.mapToRemote(tableName, localData);
          // The claimed amount, not the current one: anything added since the
          // claim rides on the next push under a new id.
          dataToSync.stock_delta = claim.amount;
          dataToSync.delta_id = claim.deltaId;
          return dataToSync;
        });

        await this.runWithRetry(() => supabase.rpc('sync_products_with_deltas', { products_data: productsData }), 'sync_products_with_deltas');

        for (const record of unsynced) {
          const claim = claims.get(record.id)!;
          const current = await table.get(record.id);
          if (!current) continue;
          // Subtract only what was actually sent. Stock added while the request
          // was in flight stays queued and goes out next time.
          const newDelta = (current.stock_delta || 0) - claim.amount;
          await table.update(record.id, {
            synced: newDelta === 0 ? 1 : 0,
            stock_delta: newDelta,
            pending_delta_id: null,
            pending_delta: null,
          });
        }
      } finally {
        for (const record of unsynced) {
          this.inFlightProductDeltas.delete(record.id);
        }
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
        // upsert, not insert. A retry after a lost reply re-sends rows the server
        // already has, and a plain INSERT answers that with 23505 on the primary
        // key — which then fails on every subsequent attempt, forever.
        // ignoreDuplicates compiles to ON CONFLICT DO NOTHING, so the retry
        // succeeds and the rows clear. It matters here specifically because
        // audit_logs has an INSERT policy but no UPDATE policy, so a normal
        // upsert's update branch would be refused by RLS.
        await this.runWithRetry(() => supabase.from(tableName).upsert(batch, { onConflict: 'id', ignoreDuplicates: true }), `push ${tableName}`);
      } else {
        // `features` is identified remotely by its UNIQUE (shop_id, feature_key)
        // index, not by id. Conflicting on 'id' makes a same-shop/same-key row
        // that merely carries a different uuid INSERT, tripping
        // features_shop_id_feature_key_key (23505). Targeting the real key
        // updates the existing row instead; we still send `id`, so the server
        // adopts our uuid and local and remote ids stay aligned for the id-keyed
        // pull.
        const onConflict = tableName === 'features' ? 'shop_id,feature_key' : 'id';
        await this.runWithRetry(() => supabase.from(tableName).upsert(batch, { onConflict }), `push ${tableName}`);
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
    let newestRemoteCursorStr: string | null = null;

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

      // Filtered and ordered on the SERVER's clock, not the device's. See
      // 20260901_server_sync_cursor.sql in the mobile app: `updated_at` is
      // stamped by whichever device made the edit, so a row typed offline at
      // 10:00 and pushed at 14:00 sorted below rows another device had already
      // consumed — and was never handed to it again.
      const cursorCol = this.cursorColumn();
      if (lastSyncDate && !force && tableName !== 'features') {
        query = query.gt(cursorCol, lastSyncDate);
      }

      query = query
        .order(cursorCol, { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + SYNC_BATCH_SIZE - 1);

      let data: any[];
      try {
        data = await this.runWithRetry(() => query, `pull ${tableName} offset ${offset}`);
        if (this.serverCursorColumn === null && cursorCol === 'server_updated_at') {
          this.serverCursorColumn = true;
        }
      } catch (error: any) {
        // This build can reach a device before the migration reaches the
        // database. Postgres reports an unknown column as 42703; PostgREST also
        // names it in the message. Fall back to `updated_at` for the session
        // rather than failing every pull.
        const missingColumn =
          cursorCol === 'server_updated_at' &&
          (error?.code === '42703' || /server_updated_at/i.test(error?.message || ''));
        if (missingColumn) {
          console.warn('[SyncService] server_updated_at not present yet — falling back to updated_at. Run 20260901_server_sync_cursor.sql.');
          this.serverCursorColumn = false;
          continue; // retry this same page with the old column
        }
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

          // The watermark must come from the SAME column the filter uses, or the
          // next pull compares two different clocks against each other.
          const cursorValue = record[cursorCol] ?? record.updated_at;
          const remoteUpdatedAt = cursorValue ? new Date(cursorValue).getTime() : 0;
          if (remoteUpdatedAt > newestRemoteCursor) {
            newestRemoteCursor = remoteUpdatedAt;
            newestRemoteCursorStr = cursorValue;
          }

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
              // Subtract the slice the server has ALREADY applied.
              //
              // Without this, a pull that lands while a push is in flight added
              // the delta a second time: the remote stock already contained it.
              // Prefer the claim persisted on the row — unlike the in-memory map
              // it survives a restart, so a pull after an interrupted push still
              // knows which slice the server has.
              const inFlightDelta = existing.pending_delta != null
                ? Number(existing.pending_delta) || 0
                : SyncService.inFlightProductDeltas.get(record.id) || 0;
              const netDelta = pendingDelta - inFlightDelta;
              const remoteStock = Number(record.stock) || 0;
              const mergedStock = Math.max(0, remoteStock + netDelta);

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

    // Prefer the raw string: rounding to epoch milliseconds throws away the
    // microseconds a Postgres timestamp carries.
    if (newestRemoteCursorStr) {
      await this.setTableSyncCursor(tableName, newestRemoteCursorStr);
    } else if (newestRemoteCursor > 0) {
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
    // Local delta bookkeeping. `delta_id` is re-attached by the products push
    // (it is what the server de-duplicates on); these two never leave the device.
    delete mapped.pending_delta_id;
    delete mapped.pending_delta;
    // Server-owned. The trigger overwrites whatever arrives, so sending it back
    // is merely pointless — but a client that could set it would be able to hide
    // its own rows below other devices' watermarks, which is the whole bug this
    // column exists to end.
    delete mapped.server_updated_at;

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
