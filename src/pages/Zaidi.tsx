import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { Database, LogOut, RefreshCw, BarChart3, ChevronRight, Phone, Wallet, User, ShieldCheck, Trash2, Clock, AlertTriangle, X, CheckCircle, MessageSquare, Zap, Bell, Users, Plus, Shield, Settings, Ban } from 'lucide-react';
import { supabase } from '../supabase';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { notifications } from '../services/notifications';
import { useNavigate, useLocation } from 'react-router-dom';
import { startOfDay, startOfWeek, startOfMonth, startOfYear, subDays, isBefore, isAfter, addDays, format } from 'date-fns';

export default function Zaidi() {
  const { user, logout, showAlert, showConfirm, isBoss, isFeatureEnabled } = useStore();
  const location = useLocation();
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';
  const shop = useLiveQuery(() => user?.shopId ? db.shops.get(user.shopId) : Promise.resolve(undefined), [user?.shopId]);
  const products = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.products.filter(p => p.isDeleted !== 1 && p.shop_id === user.shopId).toArray();
  }, [user?.shopId]) || [];
  const navigate = useNavigate();

  const [isSyncing, setIsSyncing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedDeletePeriod, setSelectedDeletePeriod] = useState<'today' | 'week' | 'month' | 'year' | 'all' | null>(null);
  const [showExpiryList, setShowExpiryList] = useState(false);
  const [activeExpiryTab, setActiveExpiryTab] = useState<'expired' | 'near'>('expired');
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<'employee' | 'staff' | 'manager' | 'cashier'>('employee');
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showInventoryValue, setShowInventoryValue] = useState(false);
  const [newName, setNewName] = useState('');

  const staff = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.users.filter(u => u.shop_id === user.shopId && u.id !== user.id).toArray();
  }, [user?.shopId, user?.id]) || [];

  const inventoryMetrics = useMemo(() => {
    return products.reduce((acc, p) => {
      acc.totalBuyingValue += (p.buy_price * p.stock);
      acc.totalSellingValue += (p.sell_price * p.stock);
      return acc;
    }, { totalBuyingValue: 0, totalSellingValue: 0 });
  }, [products]);

  const handleUpdateStaff = async () => {
    if (!editingStaffId) return;
    setIsAddingStaff(true);
    try {
      // Update the user's role and name
      const { error: updateError } = await supabase
        .from('users')
        .update({
          name: staffName,
          role: staffRole,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingStaffId)
        .eq('shop_id', user?.shopId); // Extra safety check

      if (updateError) throw updateError;

      // Update local db
      await db.users.update(editingStaffId, { 
        name: staffName,
        role: staffRole 
      });

      showAlert('Imefanikiwa', `Taarifa za ${staffName} zimebadilishwa kikamilifu.`);
      setShowStaffModal(false);
      setEditingStaffId(null);
      setStaffName('');
      setStaffRole('employee');
      
      // Trigger sync
      SyncService.sync();
    } catch (err: any) {
      console.error('Update staff error:', err);
      showAlert('Kosa', err.message || 'Imeshindwa kubadilisha taarifa');
    } finally {
      setIsAddingStaff(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!user || !newName.trim()) return;
    setIsAddingStaff(true);
    try {
      const { error: updateError } = await supabase
        .from('users')
        .update({
          name: newName.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (updateError) throw updateError;

      // Update local db
      await db.users.update(user.id, { name: newName.trim() });
      
      // Update store
      useStore.getState().setAuth(useStore.getState().token!, {
        ...user,
        name: newName.trim()
      });

      showAlert('Imefanikiwa', 'Wasifu wako umesasishwa.');
      setShowProfileModal(false);
      
      // Trigger sync
      SyncService.sync();
    } catch (err: any) {
      console.error('Update profile error:', err);
      showAlert('Kosa', err.message || 'Imeshindwa kusasisha wasifu');
    } finally {
      setIsAddingStaff(false);
    }
  };

  const handleInviteStaff = async () => {
    if (!staffEmail || !user?.shopId) return;
    setIsAddingStaff(true);
    try {
      // 1. Check if user is already in this shop
      const { data: existingUser } = await supabase
        .from('users')
        .select('id, shop_id')
        .eq('email', staffEmail.toLowerCase())
        .single();

      if (existingUser && existingUser.shop_id === user.shopId) {
        throw new Error('Mfanyakazi huyu tayari yupo kwenye duka lako.');
      }

      // 2. Create invitation in Supabase
      const { error: inviteError } = await supabase
        .from('shop_invitations')
        .insert({
          shop_id: user.shopId,
          email: staffEmail.toLowerCase(),
          role: staffRole,
          created_at: new Date().toISOString()
        });

      if (inviteError) {
        if (inviteError.code === '23505') {
          throw new Error('Mwaliko kwa email hii tayari upo. Mfanyakazi anapaswa tu kujisajili (Register) ili kujiunga.');
        }
        throw inviteError;
      }

      showAlert('Mwaliko Umetumwa', `Mwaliko wa kujiunga na duka lako umetumwa kwa ${staffEmail}. Mwambie mfanyakazi ajisajili (Register) kwa kutumia email hii.`);
      setShowInviteModal(false);
      setStaffEmail('');
      setStaffRole('employee');
    } catch (err: any) {
      console.error('Invite staff error:', err);
      showAlert('Kosa', err.message || 'Imeshindwa kutuma mwaliko');
    } finally {
      setIsAddingStaff(false);
    }
  };

  const handleToggleBlockStaff = async (staffId: string, name: string, currentStatus: string) => {
    const isBlocking = currentStatus !== 'blocked';
    const actionText = isBlocking ? 'kumzuia (block)' : 'kumfungulia (unblock)';
    const successText = isBlocking ? 'Mfanyakazi amezuiwa.' : 'Mfanyakazi amefunguliwa.';
    
    showConfirm(isBlocking ? 'Zuia Mfanyakazi' : 'Fungulia Mfanyakazi', `Je, una uhakika unataka ${actionText} ${name}? ${isBlocking ? 'Hataweza tena kuingia kwenye duka hili.' : 'Ataweza kuingia tena.'}`, async () => {
      try {
        const newStatus = isBlocking ? 'blocked' : 'active';
        
        // 1. Update in Supabase
        const { error } = await supabase
          .from('users')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', staffId);

        if (error) throw error;

        // 2. Update local DB
        await db.users.update(staffId, { status: newStatus });
        showAlert('Imefanikiwa', successText);
        
        // Trigger sync
        SyncService.sync();
      } catch (err: any) {
        console.error('Toggle block staff error:', err);
        showAlert('Kosa', `Imeshindwa ${actionText} mfanyakazi`);
      }
    });
  };

  useEffect(() => {
    if (location.state?.openExpiryList) {
      setShowExpiryList(true);
    }
  }, [location.state]);

  const [expiryData, setExpiryData] = useState<{ expired: any[], nearExpiry: any[] }>({ expired: [], nearExpiry: [] });
  const [loadingExpiry, setLoadingExpiry] = useState(false);

  useEffect(() => {
    if (showExpiryList && user?.shopId) {
      const fetchExpiryData = async () => {
        setLoadingExpiry(true);
        const now = new Date();
        const thirtyDaysFromNow = addDays(now, 30);
        
        const expired: any[] = [];
        const nearExpiry: any[] = [];

        // We only fetch products that have batches and are not deleted
        await db.products
          .where('[shop_id+isDeleted]')
          .equals([user.shopId, 0])
          .filter(p => p.batches && p.batches.length > 0)
          .each(p => {
            p.batches.forEach(b => {
              const expiryDate = new Date(b.expiry_date);
              if (isBefore(expiryDate, now)) {
                expired.push({ ...p, batch: b });
              } else if (isBefore(expiryDate, thirtyDaysFromNow)) {
                nearExpiry.push({ ...p, batch: b });
              }
            });
          });

        setExpiryData({ expired, nearExpiry });
        setLoadingExpiry(false);
      };
      fetchExpiryData();
    }
  }, [showExpiryList, user?.shopId]);

  const toggleExpiry = async () => {
    if (!user?.shopId) return;
    
    let currentShop = shop;
    if (!currentShop) {
      currentShop = await db.shops.get(user.shopId);
    }
    
    if (!currentShop) {
      return;
    }

    const newValue = !currentShop.enable_expiry;
    await db.shops.update(currentShop.id, { 
      enable_expiry: newValue,
      updated_at: new Date().toISOString(),
      synced: 0
    });
    SyncService.sync();
  };

  const handleDeleteHistory = () => {
    if (!selectedDeletePeriod) return;
    
    const period = selectedDeletePeriod;
    const periodLabel = {
      today: 'Leo',
      week: 'Wiki Hii',
      month: 'Mwezi Huu',
      year: 'Mwaka Huu',
      all: 'Zote'
    }[period];

    showConfirm('Futa Historia', `Je, una uhakika unataka kufuta historia ya ${periodLabel}? Kitendo hiki hakiwezi kurudishwa.`, async () => {
      let startDate: Date | null = null;
      const now = new Date();

      if (period === 'today') startDate = startOfDay(now);
      else if (period === 'week') startDate = startOfWeek(now);
      else if (period === 'month') startDate = startOfMonth(now);
      else if (period === 'year') startDate = startOfYear(now);

      const filterFn = (item: any) => {
        if (item.shop_id !== user?.shopId) return false;
        if (period === 'all') return true;
        if (!startDate) return false;
        return new Date(item.created_at || item.date) >= startDate;
      };

      try {
        // Mark sales as deleted
        const salesToDelete = await db.sales.filter(s => filterFn(s)).toArray();
        for (const sale of salesToDelete) {
          const now = new Date().toISOString();
          await db.sales.update(sale.id, { isDeleted: 1, synced: 0, updated_at: now });
          await db.saleItems.where('sale_id').equals(sale.id).modify({ isDeleted: 1, synced: 0, updated_at: now });
        }

        // Mark expenses as deleted
        const expensesToDelete = await db.expenses.filter(e => filterFn(e)).toArray();
        for (const expense of expensesToDelete) {
          await db.expenses.update(expense.id, { isDeleted: 1, synced: 0, updated_at: new Date().toISOString() });
        }

        // Mark debt payments as deleted
        const paymentsToDelete = await db.debtPayments.filter(p => filterFn(p)).toArray();
        for (const payment of paymentsToDelete) {
          await db.debtPayments.update(payment.id, { isDeleted: 1, synced: 0, updated_at: new Date().toISOString() });
        }

        showAlert('Imefanikiwa', 'Historia imefutwa kwa mafanikio!');
        setShowDeleteModal(false);
        setSelectedDeletePeriod(null);
        SyncService.sync();
      } catch (e) {
        showAlert('Kosa', 'Kuna tatizo wakati wa kufuta historia.');
      }
    });
  };

  const handleBackup = async () => {
    try {
      const products = await db.products.filter(p => p.shop_id === user?.shopId).toArray();
      const sales = await db.sales.filter(s => s.shop_id === user?.shopId).toArray();
      const sets = await db.settings.toArray();
      
      const backupData = JSON.stringify({ products, sales, settings: sets });
      const blob = new Blob([backupData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `pos_backup_${new Date().getTime()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      showAlert('Kosa', 'Kuna tatizo wakati wa kuhifadhi nakala.');
    }
  };

  const handleLogout = async () => {
    if (!navigator.onLine) {
      if (!window.confirm("Hauna mtandao (Offline) kwa sasa. Kujitoa kutafuta taarifa ambazo hazijatumwa. Je, una uhakika unataka kujitoa?")) {
        return;
      }
    }
    
    try {
      await SyncService.logAction('logout', { platform: 'web' });
      await SyncService.sync(true); // Force sync so the logout event goes through
    } catch (e) {
      console.error('Failed to log logout', e);
    }
    await supabase.auth.signOut();
    logout();
  };

  const handleManualSync = async () => {
    if (!navigator.onLine) {
      showAlert('Kosa', 'Tafadhali unganisha mtandao kwanza!');
      return;
    }
    setIsSyncing(true);
    await SyncService.sync(true);
    setIsSyncing(false);
    showAlert('Imefanikiwa', 'Usawazishaji (Sync) umekamilika!');
  };

  const handleRemoveBatch = (productId: string, batchId: string, skipConfirm = false) => {
    const removeLogic = async () => {
      try {
        const product = await db.products.get(productId);
        if (!product) return;

        const batchToRemove = product.batches.find(b => b.id === batchId);
        if (!batchToRemove) return;

        const updatedBatches = product.batches.filter(b => b.id !== batchId);
        const updatedStock = product.stock - batchToRemove.stock;

        await db.products.update(productId, {
          batches: updatedBatches,
          stock: Math.max(0, updatedStock),
          stock_delta: (product.stock_delta || 0) - batchToRemove.stock,
          updated_at: new Date().toISOString(),
          synced: 0
        });

        // Refresh data
        setExpiryData(prev => ({
          expired: prev.expired.filter(item => !(item.id === productId && item.batch.id === batchId)),
          nearExpiry: prev.nearExpiry.filter(item => !(item.id === productId && item.batch.id === batchId))
        }));

        SyncService.sync();
      } catch (e) {
        showAlert('Kosa', 'Kuna tatizo wakati wa kuondoa bidhaa.');
      }
    };

    if (!skipConfirm) {
      showConfirm('Ondoa Bidhaa', 'Je, una uhakika unataka kuondoa bidhaa hii iliyokwisha muda? Hii itapunguza idadi ya bidhaa zilizopo.', removeLogic);
    } else {
      removeLogic();
    }
  };

  return (
    <div className="p-4 pb-20">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Zaidi</h1>
        <button onClick={handleLogout} className="text-red-600 flex items-center font-medium bg-red-50 px-4 py-2 rounded-xl">
          <LogOut className="w-5 h-5 mr-2" /> Ondoka (Logout)
        </button>
      </div>

      <div className="space-y-6">
        {/* User Profile Section */}
        <section className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="bg-blue-100 p-3 rounded-2xl mr-4">
                <User className="w-8 h-8 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-gray-900 truncate">
                  {user?.name || 'Mtumiaji'}
                </h2>
                <p className="text-sm text-gray-500 truncate">
                  {user?.email}
                </p>
                <span className="inline-block mt-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded uppercase tracking-wider">
                  {user?.role || 'Admin'}
                </span>
              </div>
            </div>
            <button 
              onClick={() => {
                setNewName(user?.name || '');
                setShowProfileModal(true);
              }}
              className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </section>

        {/* Subscription / Malipo ya Mfumo Section */}
        {isBoss() && (
          <section className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 animate-in fade-in duration-300">
            <div className="flex items-center mb-4">
              <div className="bg-blue-100 p-2.5 rounded-xl mr-3 text-blue-600">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Malipo ya Mfumo</h2>
                <p className="text-xs text-gray-500 font-medium">Usajili na leseni ya matumizi ya mfumo</p>
              </div>
            </div>
            
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-2">
                <span className="text-sm font-semibold text-blue-900">Gharama ya Mwezi:</span>
                <span className="text-lg font-black text-blue-700 bg-white px-3 py-1 rounded-xl shadow-xs border border-blue-100">
                  {formatCurrency(20000, currency)} / Mwezi
                </span>
              </div>
              <div className="text-xs text-blue-800 space-y-2 leading-relaxed">
                <p>
                  Ili kuendelea kutumia mfumo huu wa <strong>Venics Sales</strong> kuhifadhi na kusimamia bidhaa, mauzo, wafanyakazi na kupata ripoti zako kikamilifu, unapaswa kulipia TZS 20,000 kila mwezi.
                </p>
                <div className="mt-3 p-3 bg-white rounded-xl border border-blue-100">
                  <p className="font-bold text-blue-900 mb-1">Jinsi ya Kulipia:</p>
                  <ul className="list-disc list-inside space-y-1.5 text-gray-700">
                    <li>Wasiliana na huduma kwa wateja kupitia namba <strong>0787979273</strong></li>
                    <li>Taja barua pepe yako (Email): <strong className="text-blue-700">{user?.email || 'Akaunti yako'}</strong></li>
                    <li>Utapokea maelekezo ya kufanya malipo na kuwezeshwa leseni yako mara moja.</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Executive Dashboard Section */}
        {isBoss() && (
          <section className="space-y-3">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <button 
                onClick={async () => {
                  const granted = await notifications.requestPermission();
                  if (granted) {
                    notifications.sendNotification('Hongera!', 'Notifications sasa zimeunganishwa kikamilifu.');
                  } else {
                    showAlert('Kosa', 'Tafadhali ruhusu notifications kwenye browser yako.');
                  }
                }}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center">
                  <div className="bg-purple-100 p-2 rounded-xl mr-3">
                    <Bell className="w-6 h-6 text-purple-600" />
                  </div>
                  <div className="text-left">
                    <h2 className="text-lg font-semibold text-gray-800">Washa Notifications</h2>
                    <p className="text-xs text-gray-500">Pokea ripoti za Pulse na Master kila siku</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </section>
        )}

        {/* Expiry Toggle Section */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div 
              onClick={() => shop?.enable_expiry && setShowExpiryList(true)}
              className={`flex items-center flex-1 ${shop?.enable_expiry ? 'cursor-pointer' : ''}`}
            >
              <div className="bg-purple-100 p-2 rounded-xl mr-3">
                <Clock className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Usimamizi wa Expiry</h2>
                <p className="text-xs text-gray-500">Washa/Zima kipengele cha tarehe za kuisha</p>
              </div>
            </div>
            <button 
              onClick={toggleExpiry}
              className={`w-12 h-6 rounded-full transition-colors relative ${shop?.enable_expiry ? 'bg-purple-600' : 'bg-gray-200'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${shop?.enable_expiry ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
          {shop?.enable_expiry && (
            <button 
              onClick={() => setShowExpiryList(true)}
              className="w-full mt-4 py-2 text-sm font-bold text-purple-600 bg-purple-50 rounded-xl border border-purple-100"
            >
              Tazama Bidhaa Zilizokwisha Muda
            </button>
          )}
        </section>

        {/* Inventory Value Section - Boss Only */}
        {isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="bg-green-100 p-2 rounded-xl mr-3">
                  <Database className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Thamani ya Stock</h2>
                  <p className="text-xs text-gray-500">Thamani ya bidhaa zote zilizopo</p>
                </div>
              </div>
              <button 
                onClick={() => setShowInventoryValue(!showInventoryValue)}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${showInventoryValue ? 'bg-gray-100 text-gray-600' : 'bg-green-600 text-white'}`}
              >
                {showInventoryValue ? 'Ficha' : 'Tazama'}
              </button>
            </div>
            
            {showInventoryValue && (
              <div className="mt-4 pt-4 border-t border-gray-50 grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Jumla ya Manunuzi</p>
                  <p className="text-lg font-black text-gray-900">{formatCurrency(inventoryMetrics.totalBuyingValue, currency)}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Jumla ya Mauzo</p>
                  <p className="text-lg font-black text-blue-600">{formatCurrency(inventoryMetrics.totalSellingValue, currency)}</p>
                </div>
                <div className="col-span-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] text-blue-600 uppercase font-bold tracking-wider">Tarajio la Faida</p>
                    <p className="text-xl font-black text-blue-700">
                      {formatCurrency(inventoryMetrics.totalSellingValue - inventoryMetrics.totalBuyingValue, currency)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}


        {/* Staff Management Section */}
        {isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <div className="bg-green-100 p-2 rounded-xl mr-3">
                  <Users className="w-6 h-6 text-green-600" />
                </div>
                <div className="text-left">
                  <h2 className="text-lg font-semibold text-gray-800">Wafanyakazi</h2>
                  <p className="text-xs text-gray-500">Dhibiti wafanyakazi wa duka lako</p>
                </div>
              </div>
              <button 
                onClick={() => setShowInviteModal(true)}
                className="p-2 bg-green-600 text-white rounded-xl shadow-md hover:bg-green-700 transition-colors flex items-center space-x-1"
              >
                <Plus className="w-4 h-4" />
                <span className="text-xs font-bold">Ongeza</span>
              </button>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl mb-4">
              <p className="text-sm text-blue-800 font-medium mb-2">Jinsi ya kuongeza mfanyakazi:</p>
              <ol className="list-decimal list-inside text-xs text-blue-700 space-y-1">
                <li>Bonyeza kitufe cha <b>(+ Ongeza)</b> hapo juu.</li>
                <li>Ingiza <b>Email</b> ya mfanyakazi.</li>
                <li>Mwambie mfanyakazi ajisajili (Register) kwa kutumia email hiyo.</li>
                <li>Atajiunga na duka lako moja kwa moja baada ya kujisajili.</li>
              </ol>
            </div>

            {/* Feature Toggle: Staff Product Management */}
            <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-100 rounded-2xl mb-4">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-bold text-blue-900">Ruhusu Wafanyakazi Kuongeza Bidhaa</h3>
                <p className="text-[10px] text-blue-700">Wafanyakazi wataweza kuongeza, kuhariri na kuingiza bidhaa kwa Excel.</p>
              </div>
              <button 
                onClick={() => SyncService.toggleFeature('staff_product_management', !isFeatureEnabled('staff_product_management'))}
                className={`w-12 h-6 rounded-full transition-colors relative ${isFeatureEnabled('staff_product_management') ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isFeatureEnabled('staff_product_management') ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {/* Feature Toggle: Staff Expense Management */}
            <div className="flex items-center justify-between p-4 bg-orange-50 border border-orange-100 rounded-2xl mb-4">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-bold text-orange-900">Ruhusu Wafanyakazi Kuona/Kuongeza Matumizi</h3>
                <p className="text-[10px] text-orange-700">Wafanyakazi wataweza kuona na kuongeza matumizi ya duka.</p>
              </div>
              <button 
                onClick={() => SyncService.toggleFeature('staff_expense_management', !isFeatureEnabled('staff_expense_management'))}
                className={`w-12 h-6 rounded-full transition-colors relative ${isFeatureEnabled('staff_expense_management') ? 'bg-orange-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isFeatureEnabled('staff_expense_management') ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {/* Feature Toggle: Staff Revenue Visibility */}
            <div className="flex items-center justify-between p-4 bg-purple-50 border border-purple-100 rounded-2xl mb-4">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-bold text-purple-900">Ruhusu Wafanyakazi Kuona Mapato</h3>
                <p className="text-[10px] text-purple-700">Wafanyakazi wataweza kuona mapato na mauzo yote kwenye Dashibodi na Historia.</p>
              </div>
              <button 
                onClick={() => SyncService.toggleFeature('show_mapato_to_staff', !isFeatureEnabled('show_mapato_to_staff'))}
                className={`w-12 h-6 rounded-full transition-colors relative ${isFeatureEnabled('show_mapato_to_staff') ? 'bg-purple-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isFeatureEnabled('show_mapato_to_staff') ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {staff.length > 0 ? (
              <div className="space-y-3">
                {staff.map(s => {
                  const isBlocked = s.status === 'blocked';
                  return (
                  <div key={s.id} className={`flex items-center justify-between p-3 rounded-xl border ${isBlocked ? 'bg-red-50 border-red-100 opacity-75' : 'bg-gray-50 border-gray-100'}`}>
                    <div className="flex items-center">
                      <div className={`w-10 h-10 bg-white rounded-full flex items-center justify-center border ${isBlocked ? 'border-red-200' : 'border-gray-200'} mr-3`}>
                        <User className={`w-5 h-5 ${isBlocked ? 'text-red-400' : 'text-gray-400'}`} />
                      </div>
                      <div>
                        <p className={`text-sm font-bold ${isBlocked ? 'text-red-900 line-through' : 'text-gray-900'}`}>
                          {s.name}
                        </p>
                        <div className="flex items-center space-x-2">
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">{s.role}</p>
                          {isBlocked && (
                            <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded uppercase font-bold">Imezuiwa</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={() => {
                          setEditingStaffId(s.id);
                          setStaffName(s.name);
                          setStaffRole(s.role as any);
                          setShowStaffModal(true);
                        }}
                        className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleToggleBlockStaff(s.id, s.name, s.status)}
                        className={`p-2 rounded-lg ${isBlocked ? 'text-green-600 hover:bg-green-50' : 'text-red-500 hover:bg-red-50'}`}
                        title={isBlocked ? 'Fungulia Mfanyakazi' : 'Zuia Mfanyakazi'}
                      >
                        {isBlocked ? <CheckCircle className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4 italic">Hujasajili mfanyakazi yeyote bado.</p>
            )}
          </section>
        )}


        {/* Delete History Section */}
        {isBoss() && (
          <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
              <Trash2 className="w-5 h-5 mr-2 text-red-500" /> Futa Historia
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Futa historia ya mauzo na matumizi kwa kipindi fulani.
            </p>
            <button 
              onClick={() => setShowDeleteModal(true)}
              className="w-full bg-red-50 text-red-600 font-bold py-3 rounded-xl border border-red-100"
            >
              Futa Historia
            </button>
          </section>
        )}

        {/* Customer Service Section */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Phone className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Huduma kwa Wateja</h2>
          <p className="text-gray-500 mb-6 text-sm">Kwa msaada wowote au maoni, wasiliana nasi kupitia namba hapa chini:</p>
          <a 
            href="tel:0787979273" 
            className="block w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-md transition-transform active:scale-95 text-lg"
          >
            0787979273
          </a>
        </section>


        <div className="text-center py-8">
          <p className="text-lg font-bold text-blue-600">Venics Sales</p>
          <p className="text-xs text-gray-400 mt-1">Version 1.0.0</p>
          <p className="text-[10px] text-gray-300 mt-4">Made by Venics Software Company</p>
        </div>
      </div>

      {/* Expiry List Modal */}
      {showExpiryList && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-purple-600">
                <Clock className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Usimamizi wa Expiry</h2>
              </div>
              <button onClick={() => setShowExpiryList(false)} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex p-1 bg-gray-100 rounded-2xl mb-6">
              <button 
                onClick={() => setActiveExpiryTab('expired')}
                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${activeExpiryTab === 'expired' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500'}`}
              >
                Zilizokwisha ({expiryData.expired.length})
              </button>
              <button 
                onClick={() => setActiveExpiryTab('near')}
                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${activeExpiryTab === 'near' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}
              >
                Zinazoisha ({expiryData.nearExpiry.length})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6">
              {loadingExpiry ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-12 h-12 border-4 border-purple-100 border-t-purple-600 rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-500 font-medium">Inapakia data...</p>
                </div>
              ) : (
                <>
                  {activeExpiryTab === 'expired' ? (
                    /* Expired Section */
                    <div>
                      {expiryData.expired.length > 0 ? (
                        <div className="space-y-3">
                          <button 
                            onClick={() => {
                              showConfirm('Ondoa Zote', `Je, una uhakika unataka kuondoa bidhaa ZOTE ${expiryData.expired.length} zilizokwisha muda?`, async () => {
                                for (const item of expiryData.expired) {
                                  await handleRemoveBatch(item.id, item.batch.id, true);
                                }
                                showAlert('Imefanikiwa', 'Bidhaa zote zilizokwisha muda zimeondolewa.');
                              });
                            }}
                            className="w-full py-3 bg-red-600 text-white rounded-2xl text-sm font-bold flex items-center justify-center mb-4 shadow-md"
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Ondoa Zote Zilizokwisha
                          </button>
                          {expiryData.expired.map((item, idx) => (
                            <div key={`${item.id}-${idx}`} className="p-4 bg-red-50 border border-red-100 rounded-2xl">
                              <div className="flex justify-between items-start mb-3">
                                <div>
                                  <p className="font-bold text-gray-800 text-lg">{item.name}</p>
                                  <p className="text-sm text-red-600 font-medium flex items-center">
                                    <AlertTriangle className="w-4 h-4 mr-1" />
                                    Iliisha: {format(new Date(item.batch.expiry_date), 'dd/MM/yyyy')}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-gray-400 uppercase font-bold">Stock</p>
                                  <p className="text-xl font-bold text-gray-900">{item.batch.stock}</p>
                                </div>
                              </div>
                              <button 
                                onClick={() => handleRemoveBatch(item.id, item.batch.id)}
                                className="w-full py-2.5 bg-white text-red-600 border border-red-200 rounded-xl text-sm font-bold flex items-center justify-center hover:bg-red-100 transition-colors"
                              >
                                <Trash2 className="w-4 h-4 mr-2" /> Ondoa Bidhaa Hii
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-green-500" />
                          </div>
                          <p className="text-gray-500 font-medium">Hongera! Hakuna bidhaa zilizokwisha muda.</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Near Expiry Section */
                    <div>
                      {expiryData.nearExpiry.length > 0 ? (
                        <div className="space-y-3">
                          {expiryData.nearExpiry.map((item, idx) => (
                            <div key={`${item.id}-${idx}`} className="p-4 bg-orange-50 border border-orange-100 rounded-2xl">
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-bold text-gray-800 text-lg">{item.name}</p>
                                  <p className="text-sm text-orange-600 font-medium flex items-center">
                                    <Clock className="w-4 h-4 mr-1" />
                                    Inaisha: {format(new Date(item.batch.expiry_date), 'dd/MM/yyyy')}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-gray-400 uppercase font-bold">Stock</p>
                                  <p className="text-xl font-bold text-gray-900">{item.batch.stock}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12">
                          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Clock className="w-8 h-8 text-gray-300" />
                          </div>
                          <p className="text-gray-500 font-medium">Hakuna bidhaa zinazoisha karibuni (ndani ya siku 30).</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            
            <button 
              onClick={() => setShowExpiryList(false)}
              className="w-full mt-6 py-4 bg-purple-600 text-white font-bold rounded-2xl shadow-lg"
            >
              Funga
            </button>
          </div>
        </div>
      )}

      {/* Delete History Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center text-red-600">
                <Trash2 className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Futa Historia</h2>
              </div>
              <button onClick={() => setShowDeleteModal(false)} className="p-1 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <p className="text-gray-600 mb-6 text-sm">Chagua kipindi unachotaka kufuta. Kitendo hiki hakiwezi kurudishwa.</p>
            
            <div className="space-y-2 mb-6">
              {[
                { label: 'Leo', value: 'today' },
                { label: 'Wiki Hii', value: 'week' },
                { label: 'Mwezi Huu', value: 'month' },
                { label: 'Mwaka Huu', value: 'year' },
                { label: 'Zote', value: 'all' }
              ].map((p) => (
                <button 
                  key={p.value}
                  onClick={() => setSelectedDeletePeriod(p.value as any)}
                  className={`w-full p-4 text-left font-bold rounded-2xl transition-all border-2 ${
                    selectedDeletePeriod === p.value 
                      ? 'bg-red-50 border-red-500 text-red-700 shadow-sm' 
                      : 'bg-gray-50 border-transparent text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span>{p.label}</span>
                    {selectedDeletePeriod === p.value && <CheckCircle className="w-5 h-5" />}
                  </div>
                </button>
              ))}
            </div>
            
            <div className="flex space-x-3">
              <button 
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedDeletePeriod(null);
                }}
                className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
              >
                Ghairi
              </button>
              <button 
                onClick={handleDeleteHistory}
                disabled={!selectedDeletePeriod}
                className="flex-1 py-4 bg-red-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-red-100"
              >
                Futa Sasa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {showStaffModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-blue-600">
                <Settings className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Hariri Mfanyakazi</h2>
              </div>
              <button onClick={() => { setShowStaffModal(false); setEditingStaffId(null); }} className="p-1 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">Jina la Mfanyakazi</label>
                <input 
                  type="text"
                  value={staffName}
                  onChange={e => setStaffName(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700"
                  placeholder="Jina Kamili"
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => { setShowStaffModal(false); setEditingStaffId(null); }}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
                >
                  Ghairi
                </button>
                <button 
                  onClick={handleUpdateStaff}
                  disabled={isAddingStaff || !staffName.trim()}
                  className="flex-1 py-4 bg-blue-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-blue-100"
                >
                  {isAddingStaff ? 'Inahifadhi...' : 'Hifadhi'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invite Staff Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-green-600">
                <Plus className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Mwaliko Mpya</h2>
              </div>
              <button onClick={() => { setShowInviteModal(false); setStaffEmail(''); }} className="p-1 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">Email ya Mfanyakazi</label>
                <input 
                  type="email"
                  value={staffEmail}
                  onChange={e => setStaffEmail(e.target.value)}
                  placeholder="mfano@email.com"
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-green-500 outline-none font-bold text-gray-700"
                  autoFocus
                />
              </div>

              <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl text-orange-700 text-[10px] leading-relaxed">
                <b>Kumbuka:</b> Mfanyakazi lazima ajisajili (Register) kwa kutumia email hii ili kujiunga na duka lako moja kwa moja.
              </div>

              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => { setShowInviteModal(false); setStaffEmail(''); }}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
                >
                  Ghairi
                </button>
                <button 
                  onClick={handleInviteStaff}
                  disabled={isAddingStaff || !staffEmail}
                  className="flex-1 py-4 bg-green-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-green-100"
                >
                  {isAddingStaff ? 'Inatuma...' : 'Tuma Mwaliko'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Edit Profile Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-blue-600">
                <User className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Hariri Wasifu</h2>
              </div>
              <button onClick={() => setShowProfileModal(false)} className="p-1 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">Jina Lako Kamili</label>
                <input 
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700"
                  placeholder="Jina Kamili"
                  autoFocus
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => setShowProfileModal(false)}
                  className="flex-1 py-4 text-gray-500 font-bold bg-gray-100 rounded-2xl"
                >
                  Ghairi
                </button>
                <button 
                  onClick={handleUpdateProfile}
                  disabled={isAddingStaff || !newName.trim()}
                  className="flex-1 py-4 bg-blue-600 disabled:bg-gray-300 text-white font-bold rounded-2xl shadow-lg shadow-blue-100"
                >
                  {isAddingStaff ? 'Inahifadhi...' : 'Hifadhi'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
