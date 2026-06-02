import { useState, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Product } from '../db';
import { formatCurrency } from '../utils/format';
import { getValidStock, getSales30DaysVelocityMap, getDynamicThreshold } from '../utils/stock';
import { Plus, Search, Edit, Trash2, AlertCircle, FileDown, Upload, Clock, Calendar, Camera, Zap, Send, RefreshCw, TrendingUp } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { SyncService } from '../services/sync';
import ExcelImportModal from '../components/ExcelImportModal';
import AIScanModal from '../components/AIScanModal';
import StockAuditModal from '../components/StockAuditModal';
import { format, isAfter, isBefore, addDays } from 'date-fns';
import { List, RowComponentProps } from 'react-window';

export default function Bidhaa() {
  const { user, showAlert, showConfirm, showToast, isBoss, isFeatureEnabled } = useStore();
  const settings = useLiveQuery(() => db.settings.get(1));
  const shop = useLiveQuery(() => user?.shopId ? db.shops.get(user.shopId) : Promise.resolve(undefined), [user?.shopId]);
  const currency = settings?.currency || 'TZS';
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const products = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    
    // Use compound index for faster filtering
    const query = db.products.where('[shop_id+isDeleted]').equals([user.shopId, 0]);
    
    if (deferredSearch) {
      // If searching, we still have to filter in memory for 'includes'
      // but we can limit the initial fetch if needed.
      // For now, let's fetch all matching names to keep it simple but faster than full objects
      return query.filter(p => p.name.toLowerCase().includes(deferredSearch.toLowerCase())).toArray();
    }
    
    // If not searching, fetch all products to show accurate count and list
    // (react-window handles the DOM performance)
    return query.toArray();
  }, [user?.shopId, deferredSearch]) || [];

  const velocityMap = useLiveQuery(async () => {
    if (!user?.shopId) return {};
    return getSales30DaysVelocityMap(user.shopId);
  }, [user?.shopId]) || {};
  
  const [isAdding, setIsAdding] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAIScanModalOpen, setIsAIScanModalOpen] = useState(false);
  const [isStockAuditModalOpen, setIsStockAuditModalOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [isProcessingQuickAdd, setIsProcessingQuickAdd] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockModalProduct, setStockModalProduct] = useState<Product | null>(null);
  const [batchModalProduct, setBatchModalProduct] = useState<Product | null>(null);
  const [stockToAdd, setStockToAdd] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(500);

  useEffect(() => {
    if (containerRef.current) {
      setListHeight(containerRef.current.offsetHeight);
    }
    const handleResize = () => {
      if (containerRef.current) setListHeight(containerRef.current.offsetHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isAdding, editingProduct]);

  const isExpiryEnabled = shop?.enable_expiry === true;
  const canManageProducts = isBoss() || isFeatureEnabled('staff_product_management');

  // Form states for formatting
  const [formBuyPrice, setFormBuyPrice] = useState('');
  const [formSellPrice, setFormSellPrice] = useState('');
  const [formStock, setFormStock] = useState('');
  const [formLowStock, setFormLowStock] = useState('5');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formNotifyDays, setFormNotifyDays] = useState('30');

  const formatInputNumber = (val: string) => {
    const num = val.replace(/[^0-9]/g, '');
    if (!num) return '';
    return Number(num).toLocaleString();
  };

  const parseInputNumber = (val: string) => {
    return Number(val.replace(/,/g, '')) || 0;
  };

  const filteredProducts = useMemo(() => {
    const s = deferredSearch.toLowerCase();
    // Since we already filtered in the query for search, we just need to sort here
    return [...products].sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aStarts = aName.startsWith(s);
      const bStarts = bName.startsWith(s);
      
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return aName.localeCompare(bName);
    });
  }, [products, deferredSearch]);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const formData = new FormData(e.currentTarget);
      const stock = parseInputNumber(formStock);
      const notifyDays = parseInputNumber(formNotifyDays);
      
      const currentStock = editingProduct?.stock || 0;
      const stockChange = stock - currentStock;

      let updatedBatches = editingProduct?.batches || [];
      const totalBatchStock = updatedBatches.reduce((sum, b) => sum + Number(b.stock), 0);
      
      // If user reduced stock below total batch stock, we need to adjust batches
      if (stock < totalBatchStock) {
        let stockToRemove = totalBatchStock - stock;
        // Sort batches by expiry date (earliest first) to remove from oldest first
        updatedBatches.sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime());
        
        updatedBatches = updatedBatches.map(batch => {
          if (stockToRemove <= 0) return batch;
          const batchStock = Number(batch.stock);
          if (batchStock <= stockToRemove) {
            stockToRemove -= batchStock;
            return { ...batch, stock: 0 };
          } else {
            const newBatchStock = batchStock - stockToRemove;
            stockToRemove = 0;
            return { ...batch, stock: newBatchStock };
          }
        }).filter(batch => Number(batch.stock) > 0);
      }
      
      const rawBuyPrice = parseInputNumber(formBuyPrice);
      const rawSellPrice = parseInputNumber(formSellPrice);
      
      const product: Product = {
        id: editingProduct?.id || uuidv4(),
        shop_id: user?.shopId || '',
        name: formData.get('name') as string,
        buy_price: rawBuyPrice,
        sell_price: rawSellPrice,
        stock: stock,
        min_stock: parseInputNumber(formLowStock),
        unit: 'pcs',
        batches: updatedBatches,
        stock_delta: (editingProduct?.stock_delta || 0) + stockChange,
        notify_expiry_days: isExpiryEnabled ? notifyDays : undefined,
        created_at: editingProduct?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        synced: 0,
        isDeleted: 0
      };

      // If it's a new product with stock and expiry is enabled, create an initial batch
      if (!editingProduct && stock > 0 && isExpiryEnabled) {
        product.batches = [{
          id: uuidv4(),
          batch_number: `B-${Date.now()}`,
          expiry_date: formExpiryDate ? new Date(formExpiryDate).toISOString() : new Date(addDays(new Date(), 365)).toISOString(),
          stock: stock
        }];
      }

      await db.products.put(product);
      
      // Log action
      if (editingProduct) {
        const changes: any = {};
        if (product.sell_price !== editingProduct.sell_price) {
          changes.sell_price = { old: editingProduct.sell_price, new: rawSellPrice };
        }
        if (product.buy_price !== editingProduct.buy_price) {
          changes.buy_price = { old: editingProduct.buy_price, new: rawBuyPrice };
        }
        if (product.stock !== editingProduct.stock) {
          changes.stock = { old: editingProduct.stock, new: product.stock };
        }
        if (product.name !== editingProduct.name) {
          changes.name = { old: editingProduct.name, new: product.name };
        }
        if (product.notify_expiry_days !== editingProduct.notify_expiry_days) {
          changes.notify_expiry_days = { old: editingProduct.notify_expiry_days || 'N/A', new: product.notify_expiry_days || 'N/A' };
        }

        SyncService.logAction('edit_product', { 
          product_id: product.id, 
          name: product.name,
          changes
        });
      } else {
        SyncService.logAction('add_product', { 
          product_id: product.id, 
          name: product.name,
          stock: product.stock,
          sell_price: rawSellPrice,
          buy_price: rawBuyPrice
        });
      }
      
      setIsAdding(false);
      setEditingProduct(null);
      setFormBuyPrice('');
      setFormSellPrice('');
      setFormStock('');
      setFormLowStock('5');
      setFormExpiryDate('');
      setFormNotifyDays('30');
      SyncService.sync();
    } catch (err) {
      console.error('Save product error:', err);
      // Use a non-blocking alert or just log it
    }
  };

  const handleDelete = (id: string) => {
    showConfirm('Futa Bidhaa', 'Una uhakika unataka kufuta bidhaa hii?', async () => {
      const product = await db.products.get(id);
      await db.products.update(id, { 
        isDeleted: 1, 
        synced: 0, 
        updated_at: new Date().toISOString() 
      });
      
      if (product) {
        SyncService.logAction('delete_product', { product_id: id, name: product.name });
      }
      SyncService.sync();
    });
  };

  const handleDeleteAll = () => {
    showConfirm('Futa Bidhaa Zote', 'Je, una uhakika unataka kufuta bidhaa ZOTE? Kitendo hiki hakiwezi kutenguliwa na kitafuta bidhaa zote zilizopo.', async () => {
      try {
        const productIds = products.map(p => p.id).filter((id): id is string => !!id);
        const count = productIds.length;
        
        await Promise.all(productIds.map(id => 
          db.products.update(id, { 
            isDeleted: 1, 
            synced: 0, 
            updated_at: new Date().toISOString() 
          })
        ));
        
        // Log action
        await SyncService.logAction('delete_all_products', { count });
        
        SyncService.sync();
        showAlert('Imefanikiwa', `Bidhaa zote ${count} zimefutwa kikamilifu.`);
      } catch (err) {
        console.error('Failed to delete all products:', err);
        showAlert('Kosa', 'Imeshindwa kufuta bidhaa zote. Tafadhali jaribu tena.');
      }
    });
  };

  const ProductRow = ({ index, style }: RowComponentProps) => {
    const product = filteredProducts[index];
    if (!product) return null;
    
    const validStock = getValidStock(product, isExpiryEnabled);
    const dynThreshold = getDynamicThreshold(product.id || '', product.min_stock, velocityMap);
    const isLowStock = validStock <= dynThreshold;
    
    return (
      <div style={style} className="px-1">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center h-[110px]">
          <div className="flex-1 min-w-0 mr-4">
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-gray-800 truncate">{product.name}</h3>
              {dynThreshold > 0 && (
                <span className="bg-blue-50 text-blue-600 text-[10px] font-extrabold px-1.5 py-0.5 rounded flex items-center shrink-0" title={`Kikomo cha tahadhari ni ${dynThreshold} kulingana na mauzo ya siku 7`}>
                  <TrendingUp className="w-3 h-3 mr-0.5" /> AUTO: {dynThreshold}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-500 mt-0.5">
              Bei: {formatCurrency(product.sell_price, currency)}
            </div>
            <div className="flex items-center mt-2">
              <span className={`text-xs font-medium px-2 py-1 rounded-md ${isLowStock ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                Zilizopo: {validStock} {isLowStock && <span className="text-[10px] opacity-80">(Chini ya {dynThreshold})</span>}
              </span>
              {canManageProducts && (
                <button 
                  onClick={() => setStockModalProduct(product)}
                  className="ml-2 bg-blue-100 hover:bg-blue-200 text-blue-700 p-1 rounded-md transition-colors"
                  title="Ongeza idadi ya bidhaa"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
              {canManageProducts && isExpiryEnabled && (
                <button 
                  onClick={() => setBatchModalProduct(product)}
                  className="ml-2 bg-orange-100 hover:bg-orange-200 text-orange-700 p-1 rounded-md transition-colors"
                  title="Simamia tarehe za kuisha"
                >
                  <Calendar className="w-4 h-4" />
                </button>
              )}
              {isLowStock && (
                <span title={`Tahadhari: stoki iko chini ya kikomo cha ${dynThreshold}`}>
                  <AlertCircle className="w-4 h-4 text-red-500 ml-2 animate-pulse" />
                </span>
              )}
            </div>
          </div>
          {canManageProducts && (
            <div className="flex space-x-2 shrink-0">
              <button onClick={() => setEditingProduct(product)} className="p-2 text-blue-600 bg-blue-50 rounded-lg">
                <Edit className="w-5 h-5" />
              </button>
              <button onClick={() => product.id && handleDelete(product.id)} className="p-2 text-red-600 bg-red-50 rounded-lg">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleAddStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockModalProduct) return;
    
    const amount = parseInputNumber(stockToAdd);
    if (isNaN(amount) || amount <= 0) {
      showAlert('Kosa', 'Tafadhali weka namba sahihi.');
      return;
    }
    
    if (stockModalProduct.id) {
      try {
        await db.transaction('rw', [db.products, db.auditLogs], async () => {
          const currentProduct = await db.products.get(stockModalProduct.id!);
          if (!currentProduct) throw new Error('Bidhaa haikupatikana');

          const updatedBatches = [...(currentProduct.batches || [])];
          
          if (isExpiryEnabled && expiryDate) {
            updatedBatches.push({
              id: uuidv4(),
              batch_number: `B-${Date.now()}`,
              expiry_date: new Date(expiryDate).toISOString(),
              stock: amount
            });
          }

          await db.products.update(currentProduct.id!, { 
            stock: currentProduct.stock + amount,
            stock_delta: (currentProduct.stock_delta || 0) + amount,
            batches: updatedBatches,
            updated_at: new Date().toISOString(),
            synced: 0
          });

          await SyncService.logAction('edit_product', {
            product_id: currentProduct.id,
            name: currentProduct.name,
            changes: {
              stock: { old: currentProduct.stock, new: currentProduct.stock + amount },
              stock_added: amount,
              ...(expiryDate ? { expiry_date: expiryDate } : {})
            }
          });
        });
        
        SyncService.sync();
      } catch (error: any) {
        showAlert('Kosa', error.message || 'Kuna tatizo wakati wa kuongeza stock');
        return;
      }
    }
    
    setStockModalProduct(null);
    setStockToAdd('');
    setExpiryDate('');
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddText.trim() || isProcessingQuickAdd) return;

    setIsProcessingQuickAdd(true);
    try {
      const text = quickAddText.trim();
      
      // Smart parsing: Extract name and numbers
      // Format: "Name BuyPrice SellPrice Stock"
      const parts = text.split(/\s+/);
      
      // Try to find numbers at the end
      let numbers: number[] = [];
      let nameParts: string[] = [];
      
      for (let i = parts.length - 1; i >= 0; i--) {
        const num = Number(parts[i].replace(/,/g, ''));
        if (!isNaN(num) && numbers.length < 3) {
          numbers.unshift(num);
        } else {
          nameParts = parts.slice(0, i + 1);
          break;
        }
      }

      const name = nameParts.join(' ');
      
      if (!name || numbers.length < 2) {
        throw new Error('Matabiri ya kosa: Andika "Jina Bei_Kununua Bei_Kuuza Stock". Mfano: Soda 500 700 24');
      }

      const buyPrice = numbers[0];
      const sellPrice = numbers[1];
      const stock = numbers[2] || 0;

      const product: Product = {
        id: uuidv4(),
        shop_id: user?.shopId || '',
        name: name,
        buy_price: buyPrice,
        sell_price: sellPrice,
        stock: stock,
        min_stock: 5,
        unit: 'pcs',
        stock_delta: stock,
        batches: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        synced: 0,
        isDeleted: 0
      };

      await db.products.put(product);
      SyncService.logAction('add_product', { 
        product_id: product.id, 
        name: product.name,
        stock: product.stock,
        sell_price: product.sell_price,
        buy_price: product.buy_price
      });
      
      SyncService.sync();
      setQuickAddText('');
      showToast(`Biashara "${name}" imeongezwa!`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Kuna tatizo wakati wa kuongeza bidhaa', 'error');
    } finally {
      setIsProcessingQuickAdd(false);
    }
  };

  if (isAdding || editingProduct) {
    if (!canManageProducts) {
      return (
        <div className="p-10 text-center max-w-md mx-auto bg-white rounded-3xl border border-gray-100 shadow-sm mt-10">
          <h2 className="text-xl font-bold text-red-600">Kizuizi</h2>
          <p className="text-gray-500 mt-2">Huna ruhusa ya kuongeza au kuhariri bidhaa.</p>
          <button onClick={() => { setIsAdding(false); setEditingProduct(null); }} className="mt-4 text-blue-600 font-bold underline">Rudi</button>
        </div>
      );
    }
    const p = editingProduct;
    
    // Initialize form states if editing
    if (p && formBuyPrice === '' && formSellPrice === '' && !isAdding) {
      setFormBuyPrice(p.buy_price.toLocaleString());
      setFormSellPrice(p.sell_price.toLocaleString());
      setFormStock(p.stock.toLocaleString());
      setFormLowStock(p.min_stock.toLocaleString());
      if (p.notify_expiry_days) setFormNotifyDays(p.notify_expiry_days.toString());
    }

    return (
      <div className="p-4 lg:p-8 bg-gray-50/50 min-h-full">
        <div className="max-w-2xl mx-auto bg-white p-6 md:p-8 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center mb-6 pb-4 border-b border-gray-100">
            <button 
              onClick={() => { 
                setIsAdding(false); 
                setEditingProduct(null);
                setFormBuyPrice('');
                setFormSellPrice('');
                setFormStock('');
                setFormLowStock('5');
                setFormExpiryDate('');
                setFormNotifyDays('30');
              }}
              className="text-blue-600 font-bold text-sm bg-blue-50 px-4 py-1.5 rounded-xl mr-4 hover:bg-blue-100 transition-all"
            >
              ← Nyuma
            </button>
            <h1 className="text-lg font-black text-gray-900 tracking-tight">
              {p ? `Hariri: ${p.name}` : 'Sajili Bidhaa Mpya'}
            </h1>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Jina la Bidhaa</label>
              <input required name="name" defaultValue={p?.name} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold" placeholder="Mfano: Colgate 120g..." />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Bei ya Kununua ({currency})</label>
                <input 
                  required 
                  type="text" 
                  inputMode="numeric" 
                  value={formBuyPrice}
                  onChange={e => setFormBuyPrice(formatInputNumber(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold text-green-600" 
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Bei ya Kuuza ({currency})</label>
                <input 
                  required 
                  type="text" 
                  inputMode="numeric" 
                  value={formSellPrice}
                  onChange={e => setFormSellPrice(formatInputNumber(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold text-blue-600" 
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Idadi ya Stock ya Awali</label>
                <input 
                  required 
                  type="text" 
                  inputMode="numeric" 
                  value={formStock}
                  onChange={e => setFormStock(formatInputNumber(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold" 
                  placeholder="Mfano: 50"
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">Kiwango cha Tahadhari (Min Stock)</label>
                <input 
                  required 
                  type="text" 
                  inputMode="numeric" 
                  value={formLowStock}
                  onChange={e => setFormLowStock(formatInputNumber(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white outline-none transition-all text-sm font-semibold" 
                  placeholder="5"
                />
              </div>
            </div>

            {isExpiryEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border border-orange-100 rounded-2xl bg-orange-50/20">
                <div>
                  <label className="block text-xs font-extrabold uppercase tracking-wide text-orange-600 mb-1">Tarehe ya Kumalizika</label>
                  <input 
                    type="date" 
                    value={formExpiryDate}
                    onChange={e => setFormExpiryDate(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-white outline-none transition-all text-sm font-semibold" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-extrabold uppercase tracking-wide text-orange-600 mb-1">Siku za Tahadhari kabla ya kuisha</label>
                  <input 
                    type="text" 
                    inputMode="numeric" 
                    value={formNotifyDays}
                    onChange={e => setFormNotifyDays(formatInputNumber(e.target.value))}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-white outline-none transition-all text-sm font-semibold" 
                  />
                </div>
              </div>
            )}
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-2xl mt-6 transition-all active:scale-95 shadow-lg shadow-blue-500/10">
              {p ? 'Hifadhi Mabadiliko' : 'Sajili Bidhaa Kikamilifu'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full px-4 py-6 flex flex-col h-full bg-gray-50/20 font-sans gap-4">
      
      {/* Premium Adaptive Header & Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <h1 className="text-xl font-black text-gray-950 tracking-tight">Katalogi ya Bidhaa</h1>
          <p className="text-xs font-semibold text-gray-400 mt-0.5">
            Dhibiti bei, stock, expiry na usajili wa bidhaa zako
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isBoss() && products.length > 0 && (
            <button 
              onClick={handleDeleteAll}
              className="bg-red-50 hover:bg-red-100 text-red-600 px-3.5 py-2.5 rounded-xl border border-red-100 shrink-0 text-xs font-bold transition-all flex items-center space-x-1.5"
              title="Futa Bidhaa Zote"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Futa Zote</span>
            </button>
          )}

          {canManageProducts && (
            <button 
              onClick={() => setIsQuickAddOpen(!isQuickAddOpen)}
              className={`px-3.5 py-2.5 rounded-xl border transition-all shrink-0 text-xs font-bold flex items-center space-x-1.5 ${isQuickAddOpen ? 'bg-orange-600 text-white border-orange-700 shadow-sm' : 'bg-orange-50 hover:bg-orange-100 text-orange-600 border-orange-100'}`}
              title="Njia ya haraka kwa maandishi"
            >
              <Zap className="w-4 h-4" />
              <span>Haraka</span>
            </button>
          )}

          {canManageProducts && (
            <button 
              onClick={() => setIsAIScanModalOpen(true)}
              className="bg-green-50 hover:bg-green-100 text-green-600 border border-green-100 px-3.5 py-2.5 rounded-xl shrink-0 text-xs font-bold transition-all flex items-center space-x-1.5"
              title="Scan picha au risiti kusajili bidhaa"
            >
              <Camera className="w-4 h-4" />
              <span>AI Scan</span>
            </button>
          )}

          {canManageProducts && (
            <button 
              onClick={() => setIsImportModalOpen(true)}
              className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 px-3.5 py-2.5 rounded-xl shrink-0 text-xs font-bold transition-all flex items-center space-x-1.5"
              title="Ingiza kutoka file la Excel"
            >
              <Upload className="w-4 h-4" />
              <span>Excel</span>
            </button>
          )}

          <button 
            onClick={() => setIsAdding(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl shadow-lg shadow-blue-500/10 shrink-0 font-bold text-xs transition-all active:scale-95 flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Sajili Bidhaa</span>
          </button>
        </div>
      </div>

      {/* Info indicator */}
      <div className="flex items-center justify-between pb-1">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input 
            type="text" 
            placeholder="Tafuta kwa jina la bidhaa..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200/80 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs transition-all shadow-sm"
          />
        </div>
        <div>
          <span className="text-xs font-extrabold text-gray-400 uppercase tracking-wider bg-gray-100 px-3.5 py-1.5 rounded-full border border-gray-200/50">
            Jumla: <span className="text-gray-900 font-black">{products.length}</span>
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0" ref={containerRef}>
        {filteredProducts.length > 0 ? (
          <List
            rowCount={filteredProducts.length}
            rowHeight={120} // 110px height + 10px gap
            rowComponent={ProductRow}
            rowProps={{}}
            style={{ width: '100%', height: listHeight || 500 }}
          />
        ) : (
          <div className="text-center text-gray-500 py-10">
            Hakuna bidhaa zilizopatikana.
          </div>
        )}
      </div>

      {isQuickAddOpen && (
        <div className="fixed bottom-20 left-4 right-4 z-40 animate-in slide-in-from-bottom-4 duration-300">
          <form 
            onSubmit={handleQuickAdd}
            className="bg-white p-3 rounded-2xl shadow-2xl border border-orange-100 flex items-center space-x-2"
          >
            <div className="bg-orange-100 p-2 rounded-xl">
              <Zap className="w-5 h-5 text-orange-600" />
            </div>
            <input 
              autoFocus
              value={quickAddText}
              onChange={(e) => setQuickAddText(e.target.value)}
              placeholder="Soda 500 700 24"
              className="flex-1 bg-transparent border-none outline-none text-sm font-bold placeholder:text-gray-300"
              disabled={isProcessingQuickAdd}
            />
            <button 
              type="submit"
              disabled={!quickAddText.trim() || isProcessingQuickAdd}
              className={`p-2 rounded-xl transition-all ${quickAddText.trim() ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-100 text-gray-400'}`}
            >
              {isProcessingQuickAdd ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </form>
          <p className="text-[10px] text-gray-400 mt-2 px-2 italic">
            Andika: <b>Jina Bei_Kununua Bei_Kuuza Stock</b> na bonyeza Enter.
          </p>
        </div>
      )}

      {/* Stock Addition Modal */}
      {stockModalProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <h2 className="text-xl font-bold text-gray-800 mb-2">Ongeza Stock</h2>
            <p className="text-gray-600 mb-4">
              Bidhaa: <span className="font-bold text-gray-900">{stockModalProduct.name}</span><br />
              Zilizopo sasa: <span className="font-bold text-gray-900">{stockModalProduct.stock}</span>
            </p>
            
            <form onSubmit={handleAddStockSubmit}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Weka idadi ya kuongeza</label>
              <input 
                autoFocus
                required
                type="text"
                inputMode="numeric"
                placeholder="Mfano: 10"
                value={stockToAdd}
                onChange={e => setStockToAdd(formatInputNumber(e.target.value))}
                className="w-full p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-4 text-lg"
              />

              {isExpiryEnabled && (
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                      <Calendar className="w-4 h-4 mr-1" /> Tarehe ya Kuisha (Expiry)
                    </label>
                    <input 
                      type="date"
                      required
                      value={expiryDate}
                      onChange={e => setExpiryDate(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
              )}
              
              <div className="flex space-x-3">
                <button 
                  type="button"
                  onClick={() => { setStockModalProduct(null); setStockToAdd(''); }}
                  className="flex-1 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl"
                >
                  Ghairi
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-100"
                >
                  Ongeza
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Batch Management Modal */}
      {batchModalProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl flex flex-col max-h-[80vh]">
            <h2 className="text-xl font-bold text-gray-800 mb-2">Simamia Batches & Expiry</h2>
            <p className="text-gray-600 mb-4">
              Bidhaa: <span className="font-bold text-gray-900">{batchModalProduct.name}</span>
            </p>
            
            <div className="flex-1 overflow-y-auto space-y-3 mb-6">
              {batchModalProduct.batches && batchModalProduct.batches.length > 0 ? (
                batchModalProduct.batches.map((batch, index) => (
                  <div key={batch.id} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase">Stock</p>
                        <p className="font-bold text-blue-600">{batch.stock}</p>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Tarehe ya Kuisha</label>
                      <input 
                        type="date"
                        defaultValue={batch.expiry_date ? batch.expiry_date.split('T')[0] : ''}
                        onChange={async (e) => {
                          const newDate = e.target.value;
                          if (newDate && batchModalProduct.id) {
                            const oldDate = batch.expiry_date;
                            const updatedBatches = [...batchModalProduct.batches];
                            updatedBatches[index] = {
                              ...batch,
                              expiry_date: new Date(newDate).toISOString()
                            };
                            await db.products.update(batchModalProduct.id, {
                              batches: updatedBatches,
                              updated_at: new Date().toISOString(),
                              synced: 0
                            });

                            // Log expiry date change
                            SyncService.logAction('edit_product', {
                              product_id: batchModalProduct.id,
                              name: batchModalProduct.name,
                              changes: {
                                expiry_date: { 
                                  old: oldDate ? oldDate.split('T')[0] : 'N/A', 
                                  new: newDate 
                                }
                              }
                            });

                            SyncService.sync();
                          }
                        }}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500 italic">
                  Hakuna batches zilizopatikana kwa bidhaa hii.
                </div>
              )}
            </div>
            
            <button 
              onClick={() => setBatchModalProduct(null)}
              className="w-full py-4 bg-gray-800 text-white font-bold rounded-xl shadow-lg"
            >
              Funga
            </button>
          </div>
        </div>
      )}

      {/* Excel Import Modal */}
      {user?.shopId && (
        <ExcelImportModal 
          isOpen={isImportModalOpen} 
          onClose={() => setIsImportModalOpen(false)} 
          shopId={user.shopId} 
        />
      )}

      {/* AI Scan Onboarding Modal */}
      {user?.shopId && (
        <AIScanModal
          isOpen={isAIScanModalOpen}
          onClose={() => setIsAIScanModalOpen(false)}
          shopId={user.shopId}
          onSuccess={() => {
            showToast('Bidhaa zako zimeongezwa kwa mafanikio!', 'success');
          }}
        />
      )}

      {/* Stock Audit Modal */}
      {user?.shopId && (
        <StockAuditModal
          isOpen={isStockAuditModalOpen}
          onClose={() => setIsStockAuditModalOpen(false)}
          products={products}
          onSuccess={(msg) => {
            showToast(msg, 'success');
          }}
        />
      )}
    </div>
  );
}
