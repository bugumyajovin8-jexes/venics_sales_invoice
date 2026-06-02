import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Expense } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { Plus, Trash2, Calendar, Tag, FileText, Wallet } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { format } from 'date-fns';

const CATEGORIES = [
  'Kodi',
  'Umeme',
  'Maji',
  'Usafiri',
  'Mishahara',
  'Chakula',
  'Matengenezo',
  'Mengineyo'
];

export default function Matumizi() {
  const { user, showConfirm, showAlert, isBoss, isFeatureEnabled } = useStore();
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';
  const expenses = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.expenses.filter(e => e.isDeleted !== 1 && e.shop_id === user.shopId).reverse().toArray();
  }, [user?.shopId]) || [];
  
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formAmount, setFormAmount] = useState('');

  if (!isBoss() && !isFeatureEnabled('staff_expense_management')) {
    return (
      <div className="p-8 text-center flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
          <Wallet className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Hauna Ruhusa</h2>
        <p className="text-gray-500">Meneja wako hajakupa ruhusa ya kuona au kuongeza matumizi.</p>
      </div>
    );
  }

  const formatInputNumber = (val: string) => {
    const num = val.replace(/[^0-9]/g, '');
    if (!num) return '';
    return Number(num).toLocaleString();
  };

  const parseInputNumber = (val: string) => {
    return Number(val.replace(/,/g, '')) || 0;
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const formData = new FormData(e.currentTarget);
      
      const rawAmount = parseInputNumber(formAmount);
      const expense: Expense = {
        id: uuidv4(),
        shop_id: user?.shopId || '',
        amount: rawAmount,
        category: formData.get('category') as string,
        description: (formData.get('description') as string)?.trim() || 'Maelezo hayakuwekwa',
        date: formData.get('date') as string || new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        isDeleted: 0,
        synced: 0
      };

      await db.expenses.add(expense);
      
      // Log audit for boss to see
      await SyncService.logAction('add_expense', {
        category: expense.category,
        amount: rawAmount,
        description: expense.description
      });

      setIsAdding(false);
      setFormAmount('');
      SyncService.sync().catch(err => console.error('Sync failed:', err));
    } catch (err: any) {
      console.error('Failed to save expense:', err);
      setError('Imeshindwa kuhifadhi matumizi. Tafadhali jaribu tena.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string) => {
    const isBoss = user?.role === 'admin' || user?.role === 'boss';
    if (!isBoss) {
      showAlert('Kizuizi', 'Huna ruhusa ya kufuta matumizi haya.');
      return;
    }
    showConfirm('Futa Matumizi', 'Una uhakika unataka kufuta matumizi haya?', async () => {
      await db.expenses.update(id, { 
        isDeleted: 1,
        updated_at: new Date().toISOString(),
        synced: 0
      });
      SyncService.sync();
    });
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  if (isAdding) {
    return (
      <div className="p-4 lg:p-8 bg-gray-50/50 min-h-full font-sans">
        <div className="max-w-2xl mx-auto bg-white p-6 md:p-8 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center mb-6 pb-4 border-b border-gray-100">
            <button 
              onClick={() => setIsAdding(false)}
              className="text-blue-600 font-bold text-sm bg-blue-50 px-4 py-1.5 rounded-xl mr-4 hover:bg-blue-100 transition-all"
            >
              ← Nyuma
            </button>
            <h1 className="text-lg font-black text-gray-900 tracking-tight">Ongeza Matumizi Mapya</h1>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Kiasi cha Matumizi ({currency})</label>
              <input 
                required 
                type="text" 
                inputMode="numeric" 
                value={formAmount}
                onChange={e => setFormAmount(formatInputNumber(e.target.value))}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold text-red-600" 
                placeholder="0"
                autoFocus
              />
            </div>
            
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Kundi (Category)</label>
              <select 
                required 
                name="category" 
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Maelezo (Description)</label>
              <textarea 
                name="description" 
                rows={3}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold"
                placeholder="Elezea kwa kifupi madhumuni ya matumizi haya..."
              ></textarea>
            </div>

            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Tarehe ya Matumizi</label>
              <input 
                type="date" 
                name="date" 
                defaultValue={new Date().toISOString().split('T')[0]}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold" 
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl font-bold">
                {error}
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-2xl mt-6 transition-all active:scale-95 shadow-lg shadow-blue-500/10"
            >
              {loading ? 'Inahifadhi...' : 'Hifadhi Matumizi'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full px-4 py-6 flex flex-col h-full bg-gray-50/20 font-sans gap-4">
      
      {/* Premium Adaptive Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <h1 className="text-xl font-black text-gray-950 tracking-tight">Matumizi ya Duka (Expenses)</h1>
          <p className="text-xs font-semibold text-gray-400 mt-0.5">
            Sajili na udhibiti matumizi ya duka ili kupata faida halisi
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="bg-orange-50 px-5 py-3 rounded-2xl border border-orange-100/50 flex flex-col items-end select-none">
            <span className="text-[10px] uppercase font-black tracking-wider text-orange-600">Jumla Matumizi Yote</span>
            <span className="text-xl font-black text-orange-700 mt-0.5">{formatCurrency(totalExpenses, currency)}</span>
          </div>

          <button 
            onClick={() => setIsAdding(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl shadow-lg shadow-blue-500/10 font-bold text-xs transition-all active:scale-95 flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Rekodi Matumizi</span>
          </button>
        </div>
      </div>

      <div className="flex items-center pb-1 border-b border-gray-100">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">Historia ya Matumizi ({expenses.length})</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {expenses.length === 0 ? (
          <div className="text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100">
            <div className="bg-gray-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
              <FileText className="w-6 h-6 text-gray-400" />
            </div>
            Hakuna matumizi yoyote yaliyorekodiwa kwa sasa.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
            {expenses.map(expense => (
              <div key={expense.id} className="bg-white p-4 rounded-2xl border border-gray-100 hover:border-orange-100 hover:shadow-md transition-all flex justify-between items-center">
                <div className="flex items-center min-w-0 mr-2 font-sans">
                  <div className="bg-orange-50 p-3 rounded-xl mr-3 shrink-0">
                    <Tag className="w-5 h-5 text-orange-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-gray-900 text-sm truncate">{expense.category}</h3>
                    <p className="text-xs font-semibold text-gray-400 flex items-center mt-0.5 truncate">
                      <Calendar className="w-3.5 h-3.5 mr-1 text-gray-300" />
                      {format(new Date(expense.date), 'dd MMM yyyy')}
                    </p>
                    {expense.description && (
                      <p className="text-xs font-semibold text-gray-400 mt-1 italic truncate">"{expense.description}"</p>
                    )}
                  </div>
                </div>
                <div className="text-right flex flex-col items-end shrink-0">
                  <div className="font-black text-red-600 text-sm">{formatCurrency(expense.amount, currency)}</div>
                  {(user?.role === 'admin' || user?.role === 'boss') && (
                    <button 
                      onClick={() => expense.id && handleDelete(expense.id)} 
                      className="mt-2 text-gray-300 hover:text-red-500 transition-colors bg-gray-50 hover:bg-red-50 p-1.5 rounded-lg"
                      title="Futa matumizi haya"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
