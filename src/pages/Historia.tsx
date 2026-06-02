import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { format, startOfDay, startOfWeek, startOfMonth, subMonths, startOfYear, eachDayOfInterval, subDays } from 'date-fns';
import { 
  Receipt, 
  Calendar, 
  Download, 
  TrendingUp, 
  BarChart3, 
  ArrowUpRight, 
  ArrowDownRight, 
  RotateCcw, 
  AlertCircle, 
  Search, 
  Filter, 
  ShoppingBag, 
  CreditCard, 
  DollarSign, 
  User, 
  ChevronLeft, 
  ChevronRight, 
  Trash2,
  FileSpreadsheet,
  CheckCircle2,
  FileText
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { SyncService } from '../services/sync';
import { notifications } from '../services/notifications';
import { generateCreditInvoice, generateReceipt } from '../utils/pdfGenerator';

export default function Historia() {
  const { user, isBoss, isFeatureEnabled, isAuthenticated } = useStore();
  const settings = useLiveQuery(async () => {
    const settingsData = await db.settings.get(1);
    const shopId = user?.shopId || user?.shop_id;
    if (shopId) {
      const shopData = await db.shops.get(shopId);
      return {
        ...settingsData,
        ...shopData
      };
    }
    return settingsData;
  }, [user?.shopId, user?.shop_id]);
  const currency = settings?.currency || 'TZS';

  const handleDownloadInvoice = (sale: any) => {
    try {
      const items = saleItems.filter(i => i.sale_id === sale.id);
      if (sale.payment_method === 'credit' && sale.status === 'pending') {
        generateCreditInvoice(sale, items, settings || null, user?.name);
      } else {
        generateReceipt(sale, items, settings || null, user?.name);
      }
    } catch (err) {
      console.error('Invoice download error:', err);
    }
  };
  
  const [view, setView] = useState<'risiti' | 'ripoti'>('risiti');
  const [filter, setFilter] = useState('leo'); // leo, wiki, mwezi, miezi6, mwaka, yote
  const [reportType, setReportType] = useState<'mwezi' | 'mwaka'>('mwezi');
  const [topProductsMetric, setTopProductsMetric] = useState<'qty' | 'profit'>('qty');
  const [reversingSaleId, setReversingSaleId] = useState<string | null>(null);
  const [isReversing, setIsReversing] = useState(false);
  
  // Custom interactive search and method filters
  const [searchTerm, setSearchTerm] = useState('');
  const [payMethodFilter, setPayMethodFilter] = useState<'all' | 'cash' | 'credit'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;
  
  const boss = isBoss();
  const hasMapatoAccess = boss || isFeatureEnabled('show_mapato_to_staff');
  
  // 1. Compute totals over the whole filtered period using a streaming cursor (constant O(1) memory)
  const totals = useLiveQuery(async () => {
    if (!user?.shopId) return { revenue: 0, profit: 0, count: 0 };
    
    let startDateNum = 0;
    const n = new Date();
    switch(filter) {
      case 'leo': startDateNum = startOfDay(n).getTime(); break;
      case 'wiki': startDateNum = startOfWeek(n).getTime(); break;
      case 'mwezi': startDateNum = startOfMonth(n).getTime(); break;
      case 'miezi6': startDateNum = subMonths(n, 6).getTime(); break;
      case 'mwaka': startDateNum = startOfYear(n).getTime(); break;
      default: startDateNum = 0; break;
    }
    const minIso = new Date(startDateNum).toISOString();

    let revenue = 0;
    let profit = 0;
    let count = 0;

    await db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([user.shopId, 0, minIso], [user.shopId, 0, '\uffff'])
      .each(sale => {
        if (boss || sale.user_id === user.id) {
          revenue += sale.total_amount || 0;
          profit += (sale.total_profit || 0);
          count++;
        }
      });

    return { revenue, profit, count };
  }, [user?.shopId, filter, boss, user?.id]) || { revenue: 0, profit: 0, count: 0 };

  // 2. Fetch only the most recent receipts for listing (limit to 300 to prevent DOM/memory freeze)
  const sales = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    
    let startDateNum = 0;
    const n = new Date();
    switch(filter) {
      case 'leo': startDateNum = startOfDay(n).getTime(); break;
      case 'wiki': startDateNum = startOfWeek(n).getTime(); break;
      case 'mwezi': startDateNum = startOfMonth(n).getTime(); break;
      case 'miezi6': startDateNum = subMonths(n, 6).getTime(); break;
      case 'mwaka': startDateNum = startOfYear(n).getTime(); break;
      default: startDateNum = 0; break;
    }
    const minIso = new Date(startDateNum).toISOString();

    const queryResult = await db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([user.shopId, 0, minIso], [user.shopId, 0, '\uffff'])
      .reverse()
      .limit(300)
      .toArray();

    return boss ? queryResult : queryResult.filter(s => s.user_id === user.id);
  }, [user?.shopId, filter, boss, user?.id]) || [];

  // 3. Keep trendData extremely accurate by loading exact last 30 days of sales
  const trendSales = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
    const queryResult = await db.sales
      .where('[shop_id+isDeleted+created_at]')
      .between([user.shopId, 0, thirtyDaysAgo], [user.shopId, 0, '\uffff'])
      .toArray();
    return boss ? queryResult : queryResult.filter(s => s.user_id === user.id);
  }, [user?.shopId, boss, user?.id]) || [];

  const saleItems = useLiveQuery(async () => {
    if (!user?.shopId || sales.length === 0) return [];
    const saleIds = sales.map(s => s.id);
    return db.saleItems
      .where('sale_id')
      .anyOf(saleIds)
      .filter(i => i.isDeleted !== 1)
      .toArray();
  }, [user?.shopId, sales]) || [];
  
  const expenses = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    
    let startDateNum = 0;
    const n = new Date();
    switch(filter) {
      case 'leo': startDateNum = startOfDay(n).getTime(); break;
      case 'wiki': startDateNum = startOfWeek(n).getTime(); break;
      case 'mwezi': startDateNum = startOfMonth(n).getTime(); break;
      case 'miezi6': startDateNum = subMonths(n, 6).getTime(); break;
      case 'mwaka': startDateNum = startOfYear(n).getTime(); break;
      default: startDateNum = 0; break;
    }
    const minIso = new Date(startDateNum).toISOString();

    const queryResult = await db.expenses
      .where('[shop_id+isDeleted+date]')
      .between([user.shopId, 0, minIso], [user.shopId, 0, '\uffff'])
      .toArray();

    const filteredResult = boss ? queryResult : queryResult.filter(e => e.user_id === user.id);
    return filteredResult.sort((a, b) => b.date.localeCompare(a.date));
  }, [user?.shopId, filter, boss, user?.id]) || [];

  const now = new Date();
  const getStartDate = () => {
    switch(filter) {
      case 'leo': return startOfDay(now).getTime();
      case 'wiki': return startOfWeek(now).getTime();
      case 'mwezi': return startOfMonth(now).getTime();
      case 'miezi6': return subMonths(now, 6).getTime();
      case 'mwaka': return startOfYear(now).getTime();
      default: return 0;
    }
  };

  const startDate = getStartDate();
  const filteredSales = sales; // sales is already filtered and limited
  const filteredExpenses = expenses; // expenses is already filtered

  const totalRevenue = totals.revenue;
  const totalProfit = totals.profit;
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Show net profit for all filters
  const showNetProfit = true;
  const netProfit = totalProfit - totalExpenses;

  // client side quick search and payment filter calculation
  const displayedSales = useMemo(() => {
    let result = filteredSales;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(s => {
        const matchesCustomer = s.customer_name?.toLowerCase().includes(term);
        const matchesId = s.id?.toLowerCase().includes(term);
        const matchesItems = saleItems
          .filter(i => i.sale_id === s.id)
          .some(i => i.product_name.toLowerCase().includes(term));
        return matchesCustomer || matchesId || matchesItems;
      });
    }
    if (payMethodFilter !== 'all') {
      result = result.filter(s => s.payment_method === payMethodFilter);
    }
    return result;
  }, [filteredSales, searchTerm, payMethodFilter, saleItems]);

  const totalPages = Math.ceil(displayedSales.length / itemsPerPage) || 1;
  const paginatedSales = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return displayedSales.slice(start, start + itemsPerPage);
  }, [displayedSales, currentPage, itemsPerPage]);

  const handlePageChange = (p: number) => {
    if (p >= 1 && p <= totalPages) {
      setCurrentPage(p);
    }
  };

  // Chart Data: Revenue Trend (Last 30 days)
  const trendData = useMemo(() => {
    const last30Days = eachDayOfInterval({
      start: subDays(now, 29),
      end: now
    });

    return last30Days.map(day => {
      const dayStart = startOfDay(day).getTime();
      const dayEnd = dayStart + 86400000;
      const daySales = trendSales.filter(s => {
        const t = new Date(s.created_at).getTime();
        return t >= dayStart && t < dayEnd;
      });
      return {
        date: format(day, 'dd/MM'),
        Mapato: daySales.reduce((sum, s) => sum + s.total_amount, 0),
        Faida: daySales.reduce((sum, s) => sum + s.total_profit, 0)
      };
    });
  }, [trendSales]);

  // Chart Data: Top 10 Products
  const topProductsData = useMemo(() => {
    const productStats: Record<string, { name: string, qty: number, profit: number }> = {};
    
    saleItems.forEach(item => {
      if (!productStats[item.product_id]) {
        productStats[item.product_id] = { name: item.product_name, qty: 0, profit: 0 };
      }
      productStats[item.product_id].qty += item.qty;
      productStats[item.product_id].profit += (item.sell_price - item.buy_price) * item.qty;
    });

    return Object.values(productStats)
      .sort((a, b) => topProductsMetric === 'qty' ? b.qty - a.qty : b.profit - a.profit)
      .slice(0, 10)
      .map(p => ({
        name: p.name.length > 12 ? p.name.substring(0, 10) + '..' : p.name,
        value: topProductsMetric === 'qty' ? p.qty : p.profit
      }));
  }, [saleItems, topProductsMetric]);

  const handleReverseSale = async (saleId: string) => {
    if (!user?.shopId) return;
    setIsReversing(true);
    
    try {
      await db.transaction('rw', [db.sales, db.saleItems, db.products, db.debtPayments, db.auditLogs], async () => {
        const sale = await db.sales.get(saleId);
        if (!sale) throw new Error('Sale not found');
        
        const items = await db.saleItems.where('sale_id').equals(saleId).toArray();
        
        // 1. Return stock to products
        for (const item of items) {
          const product = await db.products.get(item.product_id);
          if (product) {
            let updatedBatches = product.batches ? JSON.parse(JSON.stringify(product.batches)) : [];
            
            if (updatedBatches.length > 0) {
              // Return to the first non-expired batch, or the first one if all expired
              let returned = false;
              for (let i = 0; i < updatedBatches.length; i++) {
                const isExpired = updatedBatches[i].expiry_date && new Date(updatedBatches[i].expiry_date) < new Date();
                if (!isExpired) {
                  updatedBatches[i].stock = Number(updatedBatches[i].stock) + item.qty;
                  returned = true;
                  break;
                }
              }
              if (!returned) {
                updatedBatches[0].stock = Number(updatedBatches[0].stock) + item.qty;
              }
            }
            
            await db.products.update(item.product_id, {
              stock: Number(product.stock) + item.qty,
              stock_delta: (product.stock_delta || 0) + item.qty,
              batches: updatedBatches,
              updated_at: new Date().toISOString(),
              synced: 0
            });
          }
        }
        
        // 2. Soft delete sale and items
        await db.sales.update(saleId, { 
          isDeleted: 1, 
          status: 'refunded',
          updated_at: new Date().toISOString(),
          synced: 0 
        });

        // Trigger Audit Alert for Boss
        if (sale) {
          notifications.sendAuditAlert(sale.total_amount, user?.name || 'Employee');
        }
        
        const itemIds = items.map(i => i.id);
        await db.saleItems.where('id').anyOf(itemIds).modify({ 
          isDeleted: 1,
          updated_at: new Date().toISOString(),
          synced: 0 
        });

        // 3. Soft delete debt payments if any
        await db.debtPayments.where('sale_id').equals(saleId).modify({
          isDeleted: 1,
          updated_at: new Date().toISOString(),
          synced: 0 
        });

        // 4. Log to audit logs for the boss to see
        await SyncService.logAction('refund_sale', {
          sale_id: saleId,
          amount: sale.total_amount,
          items: items.map(i => ({ name: i.product_name, qty: i.qty })),
          customer: sale.customer_name
        });
      });
      
      setReversingSaleId(null);
      SyncService.sync();
    } catch (error: any) {
      console.error('Failed to reverse sale:', error);
      alert('Imeshindwa kurudisha mauzo: ' + error.message);
    } finally {
      setIsReversing(false);
    }
  };

  const exportCSV = () => {
    const headers = ['Tarehe', 'Kiasi', 'Faida', 'Aina', 'Mteja'];
    const rows = displayedSales.map(s => [
      format(new Date(s.created_at), 'yyyy-MM-dd HH:mm'),
      s.total_amount,
      s.total_profit,
      s.payment_method === 'credit' ? 'Mkopo' : 'Taslimu',
      s.customer_name || 'Taslimu'
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `mauzo_${filter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Generate Reports Data directly from DB using an ultra-low-memory streaming cursor!
  const reportData = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const groups: Record<string, { mapato: number, faida: number, matumizi: number, mauzo: number }> = {};
    
    // Stream through sales without allocating a large array in memory
    await db.sales
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .each(sale => {
        if (!boss && sale.user_id !== user?.id) return;
        
        const date = new Date(sale.created_at);
        const dateStr = reportType === 'mwezi' 
          ? format(date, 'MMM yyyy') 
          : format(date, 'yyyy');
          
        if (!groups[dateStr]) {
          groups[dateStr] = { mapato: 0, faida: 0, matumizi: 0, mauzo: 0 };
        }
        groups[dateStr].mapato += sale.total_amount;
        groups[dateStr].faida += (sale.total_profit || 0);
        groups[dateStr].mauzo += 1;
      });

    // Stream through expenses
    await db.expenses
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .each(expense => {
        if (!boss && expense.user_id !== user?.id) return;
        
        const date = new Date(expense.date);
        const dateStr = reportType === 'mwezi' 
          ? format(date, 'MMM yyyy') 
          : format(date, 'yyyy');
          
        if (groups[dateStr]) {
          groups[dateStr].matumizi += expense.amount;
        } else {
          groups[dateStr] = { mapato: 0, faida: 0, matumizi: expense.amount, mauzo: 0 };
        }
      });

    return Object.entries(groups).map(([label, data]) => ({
      label,
      ...data,
      faidaHalisi: data.faida - data.matumizi
    })).sort((a, b) => {
      const parseDate = (s: string) => {
        if (reportType === 'mwaka') return new Date(parseInt(s), 0, 1).getTime();
        return new Date(s).getTime();
      };
      return parseDate(b.label) - parseDate(a.label);
    });
  }, [user?.shopId, boss, user?.id, reportType]) || [];

  return (
    <div className="max-w-7xl mx-auto w-full px-4 lg:px-8 py-6 flex flex-col h-full bg-slate-50/50 font-sans gap-6">
      
      {/* Dynamic Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between p-6 bg-white rounded-3xl border border-slate-100 shadow-md shadow-slate-100/30 gap-4">
        <div>
          <span className="bg-blue-50 text-blue-600 font-extrabold tracking-wider text-[10px] uppercase px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 mb-2 border border-blue-100">
            <Receipt className="w-3.5 h-3.5" /> Historia ya Kibackoffice
          </span>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Historia ya Mauzo & Grafu</h1>
          <p className="text-xs font-semibold text-slate-400 mt-0.5">
            Dhibiti risiti zilizofanywa, changanua mapato, kagua faida, na pakua taarifa
          </p>
        </div>

        {/* Action Toggle Tab */}
        {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
          <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200/50 self-start md:self-center shrink-0">
            <button 
              onClick={() => setView('risiti')}
              className={`px-5 py-2.5 text-xs font-black rounded-xl flex items-center transition-all duration-300 ${
                view === 'risiti' 
                  ? 'bg-white text-blue-600 shadow-md shadow-slate-200/50 transform scale-[1.02]' 
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Receipt className="w-4 h-4 mr-2" /> Risiti / Mauzo Feed
            </button>
            <button 
              onClick={() => { setView('ripoti'); setCurrentPage(1); }}
              className={`px-5 py-2.5 text-xs font-black rounded-xl flex items-center transition-all duration-300 ${
                view === 'ripoti' 
                  ? 'bg-white text-blue-600 shadow-md shadow-slate-200/50 transform scale-[1.02]' 
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-4 h-4 mr-2" /> Ripoti & Grafu za Kifedha
            </button>
          </div>
        )}
      </div>

      {view === 'risiti' ? (
        <>
          {/* Filtering Controllers & Analytics */}
          <div className="flex flex-col gap-6">
            
            {/* Filter Pills with custom design */}
            <div className="flex justify-between items-center overflow-x-auto pb-1 scrollbar-hide gap-4 border-b border-slate-200/60">
              <div className="flex space-x-2">
                {[
                  { id: 'leo', label: 'Leo' },
                  { id: 'wiki', label: 'Wiki Hii' },
                  { id: 'mwezi', label: 'Mwezi Huu' },
                  { id: 'miezi6', label: 'Miezi 6' },
                  { id: 'mwaka', label: 'Mwaka Huu' },
                  { id: 'yote', label: 'Yote' }
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => { setFilter(f.id); setCurrentPage(1); }}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-250 whitespace-nowrap ${
                      filter === f.id 
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 transform scale-105' 
                        : 'bg-white text-slate-500 hover:text-slate-800 border border-slate-200/80 hover:bg-slate-50'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              
              <div className="text-xs text-slate-400 font-bold shrink-0 hidden md:block">
                Jumla ya Risiti: <span className="text-slate-900 bg-slate-100 px-2.5 py-1 rounded-full">{displayedSales.length}</span>
              </div>
            </div>

            {/* Desktop Dashboard Grid: Left list table (8 cols) & Right Sticky metrics side block (4 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* LEFT COLUMN: Datatable & Search */}
              <div className="lg:col-span-8 flex flex-col gap-4">
                
                {/* Search & Type filter panel */}
                <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text"
                      placeholder="Tafuta risiti kwa Bidhaa au Mteja..."
                      value={searchTerm}
                      onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                      className="w-full bg-slate-50/70 text-slate-700 placeholder-slate-400 font-semibold text-xs rounded-2xl pl-10 pr-4 py-3 border border-slate-200 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
                    />
                  </div>
                  
                  {/* Payment filter select tab */}
                  <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200/50 shrink-0">
                    <button 
                      onClick={() => { setPayMethodFilter('all'); setCurrentPage(1); }}
                      className={`px-3 py-2 text-[11px] font-black rounded-xl transition-all ${payMethodFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
                    >
                      Aina Zote
                    </button>
                    <button 
                      onClick={() => { setPayMethodFilter('cash'); setCurrentPage(1); }}
                      className={`px-3 py-2 text-[11px] font-black rounded-xl transition-all ${payMethodFilter === 'cash' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      Taslimu
                    </button>
                    <button 
                      onClick={() => { setPayMethodFilter('credit'); setCurrentPage(1); }}
                      className={`px-3 py-2 text-[11px] font-black rounded-xl transition-all ${payMethodFilter === 'credit' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      Mkopo
                    </button>
                  </div>
                </div>

                {/* RECEIPTS LIST - DESKTOP TABLE & MOBILE FEED CARD */}
                <div className="bg-white rounded-3xl border border-slate-100 shadow-md shadow-slate-100/50 overflow-hidden">
                  
                  {/* Table header with details */}
                  <div className="p-5 border-b border-slate-100 bg-white/50 flex justify-between items-center flex-wrap gap-2">
                    <h2 className="text-sm font-black text-slate-800 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
                      Orodha ya Risiti za Mauzo
                    </h2>
                    
                    <button 
                      onClick={exportCSV} 
                      className="text-blue-600 hover:text-white border border-blue-100 bg-blue-50/50 hover:bg-blue-600 font-bold text-[11px] py-1.5 px-3 rounded-xl transition-all duration-200 flex items-center gap-1.5 shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Pakua CSV</span>
                    </button>
                  </div>

                  {paginatedSales.length === 0 ? (
                    <div className="text-center text-slate-400 py-16 px-4 bg-white">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                        <Receipt className="w-6 h-6 text-slate-300" />
                      </div>
                      <p className="text-xs font-bold text-slate-500">
                        Hakuna mauzo katika kipindi hiki cha '{filter}'.
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Jaribu kubadilisha kitafutio chako au mchanganuo wa muda uliopo.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* DESKTOP VIEW TABLE */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left font-sans text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-50/80 text-slate-500 border-b border-slate-100 uppercase tracking-widest font-black text-[9px]">
                              <th className="py-4 px-5">Tarehe</th>
                              <th className="py-4 px-4">Bidhaa Zilizouzwa</th>
                              <th className="py-4 px-4">Mteja / Njia</th>
                              <th className="py-4 px-4 text-right">Kiasi</th>
                              {hasMapatoAccess && <th className="py-4 px-4 text-right">Faida</th>}
                              <th className="py-4 px-5 text-center">Kitendo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedSales.map(sale => {
                              const saleItemsGroup = saleItems.filter(i => i.sale_id === sale.id);
                              return (
                                <tr 
                                  key={sale.id} 
                                  className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors group"
                                >
                                  {/* Date */}
                                  <td className="py-4 px-5">
                                    <span className="text-xs text-slate-900 font-bold flex items-center gap-1.5">
                                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                      {format(new Date(sale.created_at), 'dd MMM yyyy HH:mm')}
                                    </span>
                                  </td>

                                  {/* Products Column */}
                                  <td className="py-4 px-4 max-w-[240px]">
                                    <div className="flex flex-wrap gap-1.5 align-middle">
                                      {saleItemsGroup.map((item, idx) => (
                                        <span 
                                          key={idx} 
                                          className="text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200/40 px-2 py-0.5 rounded-md inline-block whitespace-nowrap"
                                        >
                                          {item.product_name} <span className="text-blue-600 font-black">({item.qty})</span>
                                        </span>
                                      ))}
                                      {saleItemsGroup.length === 0 && (
                                        <span className="text-slate-400 text-[10px] italic">Hakuna jina la bidhaa</span>
                                      )}
                                    </div>
                                  </td>

                                  {/* Customer & Payment Method */}
                                  <td className="py-4 px-4">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black ${
                                      sale.payment_method === 'credit' 
                                        ? 'bg-amber-50 text-amber-700 border border-amber-100' 
                                        : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                    }`}>
                                      {sale.payment_method === 'credit' ? 'Mkopo' : 'Taslimu'}
                                    </span>
                                    {sale.customer_name && (
                                      <span className="text-[10px] font-semibold text-slate-400 block mt-1 flex items-center gap-1">
                                        <User className="w-3 h-3 text-slate-300 shrink-0" />
                                        {sale.customer_name}
                                      </span>
                                    )}
                                  </td>

                                  {/* Total Amount */}
                                  <td className="py-4 px-4 text-right font-black text-slate-900 text-sm">
                                    {formatCurrency(sale.total_amount, currency)}
                                  </td>

                                  {/* Total Profit */}
                                  {hasMapatoAccess && (
                                    <td className="py-4 px-4 text-right font-bold text-emerald-600">
                                      {formatCurrency(sale.total_profit, currency)}
                                    </td>
                                  )}

                                  {/* Actions */}
                                  <td className="py-4 px-5 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button 
                                        onClick={() => handleDownloadInvoice(sale)}
                                        className="md:opacity-0 group-hover:opacity-100 focus:opacity-100 text-[10px] font-black text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 px-2.5 py-1.5 rounded-xl transition-all duration-200 inline-flex items-center gap-1 shadow-sm cursor-pointer"
                                        title={sale.payment_method === 'credit' && sale.status === 'pending' ? "Pakua Invoisi ya PDF" : "Pakua Risiti ya PDF"}
                                      >
                                        <FileText className="w-3.5 h-3.5" />
                                        <span>PDF</span>
                                      </button>
                                      {isAuthenticated ? (
                                        <button 
                                          onClick={() => setReversingSaleId(sale.id)}
                                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[10px] font-black text-red-500 bg-red-50 hover:bg-red-100/90 border border-red-100 px-2.5 py-1.5 rounded-xl transition-all duration-200 inline-flex items-center gap-1 shadow-sm"
                                          title="Rudisha mauzo"
                                        >
                                          <RotateCcw className="w-3 h-3" />
                                          <span>RUDISHA</span>
                                        </button>
                                      ) : (
                                        <span className="text-slate-300">-</span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* MOBILE NATIVE LIST CARD */}
                      <div className="block md:hidden space-y-3 p-4">
                        {paginatedSales.map(sale => {
                          const saleItemsGroup = saleItems.filter(i => i.sale_id === sale.id);
                          return (
                            <div key={sale.id} className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 shadow-xs">
                              <div className="flex justify-between items-start gap-2 mb-2">
                                <div>
                                  <span className="text-xs text-slate-900 font-bold block">
                                    {format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm')}
                                  </span>
                                </div>
                                <span className={`text-[10px] font-black px-2.5 py-1 rounded inline-block ${
                                  sale.payment_method === 'credit' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                                }`}>
                                  {sale.payment_method === 'credit' ? 'Mkopo' : 'Taslimu'}
                                </span>
                              </div>

                              <div className="py-2 border-t border-b border-slate-200/50 my-2 text-slate-600">
                                <div className="text-[11px] font-bold text-slate-700">
                                  {saleItemsGroup.map(i => i.product_name).join(', ')}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  Idadi ya Vipande: {saleItemsGroup.reduce((a, b) => a + b.qty, 0)}
                                </div>
                              </div>

                              <div className="flex justify-between items-end gap-2">
                                <div>
                                  {hasMapatoAccess && (
                                    <div className="font-extrabold text-[#111827] text-sm">
                                      {formatCurrency(sale.total_amount, currency)}
                                    </div>
                                  )}
                                  {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
                                    <div className="text-[10px] text-emerald-600 font-bold">
                                      Faida: {formatCurrency(sale.total_profit, currency)}
                                    </div>
                                  )}
                                </div>

                                <div className="flex gap-1.5 items-center">
                                  <button 
                                    onClick={() => handleDownloadInvoice(sale)}
                                    className="flex items-center text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200/40 px-3 py-1.5 rounded-xl hover:bg-emerald-100 transition-colors cursor-pointer"
                                    title={sale.payment_method === 'credit' && sale.status === 'pending' ? "Pakua Invoisi ya PDF" : "Pakua Risiti ya PDF"}
                                  >
                                    <FileText className="w-3.5 h-3.5 mr-1" /> PDF
                                  </button>
                                  {isAuthenticated && (
                                    <button 
                                      onClick={() => setReversingSaleId(sale.id)}
                                      className="flex items-center text-[10px] font-bold text-red-500 bg-red-100/50 border border-red-200/40 px-3 py-1.5 rounded-xl hover:bg-red-100 transition-colors"
                                    >
                                      <RotateCcw className="w-3 h-3 mr-1" /> RUDISHA
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* CLIENT SIDE SOLID PAGINATION BAR */}
                      {totalPages > 1 && (
                        <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-slate-400 font-bold text-[11px]">
                            Inaonyesha <span className="text-slate-800">{(currentPage-1)*itemsPerPage+1}</span> hadi <span className="text-slate-800">{Math.min(currentPage*itemsPerPage, displayedSales.length)}</span> kati ya <span className="text-slate-800">{displayedSales.length}</span> mauzo
                          </span>
                          
                          <div className="flex items-center gap-1 bg-white p-1 rounded-2xl border border-slate-200">
                            <button 
                              onClick={() => handlePageChange(currentPage - 1)}
                              disabled={currentPage === 1}
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                            
                            <span className="px-3 text-xs font-black text-slate-800">
                              Ukurasa {currentPage} wa {totalPages}
                            </span>
                            
                            <button 
                              onClick={() => handlePageChange(currentPage + 1)}
                              disabled={currentPage === totalPages}
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* RIGHT COLUMN: STICKY METRICS SIDE BLOCK (4 cols) */}
              <div className="lg:col-span-4 flex flex-col gap-4 lg:sticky lg:top-4">
                
                {/* 1. Revenue Card */}
                {hasMapatoAccess ? (
                  <div className="bg-gradient-to-br from-slate-900 to-slate-850 text-white p-6 rounded-3xl border border-slate-800 shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl -mr-6 -mt-6"></div>
                    <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Jumla ya Mapato</p>
                    <p className="text-3xl font-black mt-2 tracking-tight">{formatCurrency(totalRevenue, currency)}</p>
                    
                    <div className="flex items-center text-blue-400 text-xs mt-4 select-none bg-white/5 inline-flex transform px-3 py-1.5 rounded-full border border-white/5 font-extrabold gap-1">
                      <ArrowUpRight className="w-4 h-4" />
                      <span>Kipindi cha {filter.toUpperCase()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] uppercase font-black text-slate-400 tracking-wider">Risiti Zilizokatwa</p>
                    <p className="text-3xl font-black text-purple-600 mt-2">{filteredSales.length}</p>
                  </div>
                )}

                {/* 2. Profit Metrics Block */}
                {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
                  <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-md shadow-slate-100/30">
                    <div className="flex justify-between items-center mb-4">
                      <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Mchanganuo wa Faida</p>
                      <TrendingUp className="w-4 h-4 text-emerald-500" />
                    </div>
                    
                    <span className="text-[11px] font-bold text-slate-400 block">Jumla ya Faida</span>
                    <p className="text-2xl font-black text-emerald-600 mt-1">{formatCurrency(totalProfit, currency)}</p>
                    
                    {showNetProfit && (
                      <div className="mt-5 pt-4 border-t border-slate-100">
                        <span className="text-[11px] font-bold text-slate-400 block">Faida Halisi (Pato Safi)</span>
                        <p className={`text-xl font-black mt-1 ${netProfit >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                          {formatCurrency(netProfit, currency)}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold mt-1.5 flex items-center justify-between">
                          <span>Jumla Matumizi:</span>
                          <span className="font-extrabold text-red-500">{formatCurrency(totalExpenses, currency)}</span>
                        </p>
                      </div>
                    )}
                  </div>
                )}
                


              </div>
            </div>
          </div>

          {/* Reverse Sale Confirmation Modal */}
          {reversingSaleId && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center text-red-600 mb-4 bg-red-50 p-3 rounded-2xl">
                  <AlertCircle className="w-6 h-6 mr-2 shrink-0 animate-bounce" />
                  <h3 className="text-lg font-black tracking-tight text-red-700">Rudisha Mauzo?</h3>
                </div>
                <p className="text-slate-600 mb-6 text-xs font-semibold leading-relaxed">
                  Je, una uhakika kabisa unataka kurudisha mauzo haya? 
                  <br /><br />
                  <span className="font-bold text-red-600 bg-red-50/50 p-2.5 rounded-xl border border-red-100 block">
                    Kitendo hiki kitarejesha idadi ya bidhaa zote zilizouzwa hapa kurudi tena kwenye stock yako (Inventory) na kufuta kabisa kiasi hiki cha mapato.
                  </span>
                </p>
                <div className="flex space-x-3">
                  <button 
                    onClick={() => setReversingSaleId(null)}
                    disabled={isReversing}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black rounded-xl disabled:opacity-50 transition-colors text-xs"
                  >
                    Hapana, Ghairi
                  </button>
                  <button 
                    onClick={() => handleReverseSale(reversingSaleId)}
                    disabled={isReversing}
                    className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl shadow-lg shadow-red-200 disabled:opacity-50 flex items-center justify-center text-xs transition-transform transform active:scale-95"
                  >
                    {isReversing ? 'Inarudisha...' : 'Ndio, Rejesha'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-6 pb-4 scrollbar-hide">
          
          {/* Charts Row inside Grid */}
          {hasMapatoAccess && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Chart 1: Revenue trend over 30 days */}
              <div className="bg-white p-5 rounded-3xl shadow-md shadow-slate-100 border border-slate-100">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-black text-slate-800 tracking-tight">Mwenendo wa Mapato (Siku 30 Zilizopita)</h2>
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                </div>
                
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="date" 
                        fontSize={9} 
                        tickLine={false} 
                        axisLine={false} 
                        interval={4}
                        stroke="#94a3b8"
                      />
                      <YAxis fontSize={9} tickLine={false} axisLine={false} stroke="#94a3b8" tickFormatter={(v) => `${v/1000}k`} />
                      <Tooltip 
                        formatter={(value: number) => formatCurrency(value, currency)}
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)', backgroundColor: '#1e293b', color: '#fff' }}
                        labelStyle={{ fontWeight: 'bold', color: '#94a3b8' }}
                      />
                      <Line type="monotone" dataKey="Mapato" stroke="#3b82f6" strokeWidth={3} dot={false} />
                      <Line type="monotone" dataKey="Faida" stroke="#10b981" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center space-x-6 mt-3 border-t border-slate-50 pt-3">
                  <div className="flex items-center text-xs font-semibold text-slate-500">
                    <div className="w-3 h-3 bg-blue-500 rounded-full mr-1.5"></div> Mapato (Sales)
                  </div>
                  <div className="flex items-center text-xs font-semibold text-slate-500">
                    <div className="w-3 h-3 bg-green-500 rounded-full mr-1.5"></div> Faida Halisi
                  </div>
                </div>
              </div>

              {/* Chart 2: Top Selling Products */}
              <div className="bg-white p-5 rounded-3xl shadow-md shadow-slate-100 border border-slate-100">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-black text-slate-800 tracking-tight">Bidhaa 10 Zinazoongoza</h2>
                  
                  {/* Metric Switch */}
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button 
                      onClick={() => setTopProductsMetric('qty')}
                      className={`px-3 py-1.5 text-[10px] font-black rounded-lg transition-colors ${topProductsMetric === 'qty' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      Idadi ya Mauzo
                    </button>
                    <button 
                      onClick={() => setTopProductsMetric('profit')}
                      className={`px-3 py-1.5 text-[10px] font-black rounded-lg transition-colors ${topProductsMetric === 'profit' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      Faida (Profit)
                    </button>
                  </div>
                </div>

                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topProductsData} layout="vertical">
                      <XAxis type="number" hide />
                      <YAxis 
                        dataKey="name" 
                        type="category" 
                        fontSize={9} 
                        width={90} 
                        tickLine={false} 
                        axisLine={false} 
                        stroke="#64748b"
                      />
                      <Tooltip 
                        formatter={(value: number) => topProductsMetric === 'qty' ? value : formatCurrency(value, currency)}
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)', backgroundColor: '#1e293b', color: '#fff' }}
                      />
                      <Bar 
                        dataKey="value" 
                        fill={topProductsMetric === 'qty' ? '#8b5cf6' : '#10b981'} 
                        radius={[0, 6, 6, 0]} 
                        barSize={14}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          )}

          {/* Ledger Table controls for Monthly/Yearly ledger statements */}
          <div className="flex items-center justify-between mt-4">
            <h2 className="text-base font-black text-slate-800 tracking-tight">Mizania & Ripoti za Mara kwa Mara</h2>
            
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => setReportType('mwezi')}
                className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${reportType === 'mwezi' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
              >
                Ripoti ya Mwezi
              </button>
              <button
                onClick={() => setReportType('mwaka')}
                className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${reportType === 'mwaka' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
              >
                Ripoti ya Mwaka
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {reportData.length === 0 ? (
              <div className="text-center text-slate-400 py-16 bg-white rounded-3xl border border-slate-100 shadow-sm">
                <Receipt className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs font-bold">Hakuna data ya ripoti za {reportType === 'mwezi' ? 'Kila Mwezi' : 'Kila Mwaka'}.</p>
              </div>
            ) : (
              reportData.map((report, idx) => (
                <div key={idx} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                  <div className="flex justify-between items-center mb-4 pb-3 border-b border-rose-50">
                    <h3 className="font-black text-slate-900 text-base flex items-center">
                      <Calendar className="w-5 h-5 mr-2 text-blue-500" />
                      {report.label}
                    </h3>
                    <span className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100/30">
                      Mauzo {report.mauzo} yaliyofanyika
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {hasMapatoAccess && (
                      <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Mapato yote</p>
                        <p className="text-lg font-black text-slate-950 mt-1">{formatCurrency(report.mapato, currency)}</p>
                      </div>
                    )}
                    
                    {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
                      <>
                        <div className="bg-emerald-50/30 p-4 rounded-2xl border border-emerald-100/40">
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Jumla ya Faida</p>
                          <p className="text-lg font-black text-emerald-600 mt-1">{formatCurrency(report.faida, currency)}</p>
                        </div>
                        
                        <div className="bg-blue-50/30 p-4 rounded-2xl border border-blue-100/40">
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Faida Halisi (Baada ya matumizi)</p>
                          <p className={`text-lg font-black flex items-center mt-1 ${report.faidaHalisi >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                            {report.faidaHalisi >= 0 ? (
                              <ArrowUpRight className="w-4 h-4 mr-1 text-blue-500" />
                            ) : (
                              <ArrowDownRight className="w-4 h-4 mr-1 text-red-500" />
                            )}
                            {formatCurrency(report.faidaHalisi, currency)}
                          </p>
                          {report.matumizi > 0 && (
                            <p className="text-[10px] text-slate-400 mt-1 fontWeight-bold">
                              Matumizi ya Mara kwa mara: <span className="text-red-500 font-extrabold">{formatCurrency(report.matumizi, currency)}</span>
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
