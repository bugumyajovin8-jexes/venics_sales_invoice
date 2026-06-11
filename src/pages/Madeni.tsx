import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Sale } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { format } from 'date-fns';
import { CheckCircle, Phone, User, History, Plus, X, CreditCard, FileText } from 'lucide-react';
import { SyncService } from '../services/sync';
import { v4 as uuidv4 } from 'uuid';
import { generateCreditInvoice, generateReceipt } from '../utils/pdfGenerator';
import { useTranslation } from '../utils/translations';

export default function Madeni() {
  const { user, showConfirm, showAlert } = useStore();
  const { t, language } = useTranslation();
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

  const handleDownloadInvoice = (debt: Sale) => {
    try {
      const items = saleItems.filter(i => i.sale_id === debt.id);
      generateCreditInvoice(debt, items, settings || null, user?.name);
    } catch (err) {
      console.error('Invoice download err:', err);
    }
  };

  const [selectedDebt, setSelectedDebt] = useState<Sale | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [showHistory, setShowHistory] = useState<string | null>(null);
  
  const allSales = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.sales.filter(s => s.isDeleted !== 1 && s.shop_id === user.shopId).toArray();
  }, [user?.shopId]) || [];
  
  const saleItems = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.saleItems.filter(i => i.isDeleted !== 1 && i.shop_id === user.shopId).toArray();
  }, [user?.shopId]) || [];

  const debtPayments = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.debtPayments
      .where('shop_id')
      .equals(user.shopId)
      .filter(p => p.isDeleted !== 1)
      .toArray();
  }, [user?.shopId]) || [];
  
  const unpaidDebts = allSales
    .filter(s => s.payment_method === 'credit' && s.status === 'pending')
    .filter(s => {
      const payments = debtPayments.filter(p => p.sale_id === s.id);
      const paid = payments.reduce((sum, p) => sum + p.amount, 0);
      return (s.total_amount - paid) > 0.1; // Only show if balance is more than 0.1
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  
  const totalDebt = unpaidDebts.reduce((sum, debt) => {
    const payments = debtPayments.filter(p => p.sale_id === debt.id);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    return sum + Math.max(0, debt.total_amount - paid);
  }, 0);

  const handleRecordPayment = async (saleId: string, amount: number) => {
    if (amount <= 0 || !user?.shopId) return;
    
    const sale = await db.sales.get(saleId);
    if (!sale) return;

    // Fetch current payments from DB to ensure accuracy
    const currentPayments = await db.debtPayments.where('sale_id').equals(saleId).toArray();
    const totalPaidSoFar = currentPayments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = sale.total_amount - totalPaidSoFar;

    // Use a small epsilon (0.1) to handle floating point rounding issues
    if (amount > (remaining + 0.1)) {
      showAlert(
        t('kosa', 'Kosa'),
        language === 'sw'
          ? `Kiasi unacholipa (${formatCurrency(amount, currency)}) ni kikubwa kuliko deni lililobaki (${formatCurrency(remaining, currency)})`
          : `The payment amount (${formatCurrency(amount, currency)}) exceeds the remaining debt (${formatCurrency(remaining, currency)})`
      );
      return;
    }

    const paymentId = uuidv4();
    const now = new Date().toISOString();
    await db.debtPayments.add({
      id: paymentId,
      shop_id: user.shopId,
      sale_id: saleId,
      amount: amount,
      date: now,
      isDeleted: 0,
      created_at: now,
      updated_at: now,
      synced: 0
    });

    // If the new total paid is equal to or very close to the total amount, mark as completed
    if ((totalPaidSoFar + amount) >= (sale.total_amount - 0.1)) {
      await db.sales.update(saleId, {
        status: 'completed',
        updated_at: new Date().toISOString(),
        synced: 0
      });

      try {
        const items = saleItems.filter(i => i.sale_id === saleId);
        const updatedSale = {
          ...sale,
          status: 'completed',
          is_paid: true
        };
        generateReceipt(updatedSale, items, settings || null, user?.name);
      } catch (pdfErr) {
        console.error('Fully paid receipt pdf generation error:', pdfErr);
      }
    } else {
      await db.sales.update(saleId, {
        updated_at: new Date().toISOString(),
        synced: 0
      });
    }
    
    SyncService.sync();
    setSelectedDebt(null);
    setPaymentAmount('');
  };

  const handleFullPayment = (debt: Sale) => {
    const payments = debtPayments.filter(p => p.sale_id === debt.id);
    const totalPaidSoFar = payments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = debt.total_amount - totalPaidSoFar;

    showConfirm(
      t('thibitisha_malipo', 'Thibitisha Malipo'),
      language === 'sw'
        ? `Je, unathibitisha kuwa deni lote la ${formatCurrency(remaining, currency)} limelipwa?`
        : `Do you confirm that the full remaining debt of ${formatCurrency(remaining, currency)} has been paid?`,
      () => {
        handleRecordPayment(debt.id, remaining);
      }
    );
  };

  return (
    <div className="max-w-7xl mx-auto w-full px-4 py-6 flex flex-col h-full bg-gray-50/20 font-sans gap-4">
      
      {/* Premium Adaptive Header & Debt Summary */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <h1 className="text-xl font-black text-gray-950 tracking-tight">{t('daftari_la_madeni', 'Daftari la Madeni (Credit Ledger)')}</h1>
          <p className="text-xs font-semibold text-gray-400 mt-0.5">
            {t('daftari_la_madeni_desc', 'Fuatilia mauzo ya mikopo na dhibiti malipo ya wateja')}
          </p>
        </div>

        <div className="bg-red-50 px-5 py-3 rounded-2xl border border-red-100/50 flex flex-col items-end shrink-0 select-none">
          <span className="text-[10px] uppercase font-black tracking-wider text-red-500">{t('jumla_ya_madeni_yote', 'Jumla ya Madeni YOTE')}</span>
          <span className="text-xl font-black text-red-600 mt-0.5">{formatCurrency(totalDebt, currency)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pb-1 border-b border-gray-100">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">{t('orodha_ya_wanaodaiwa', 'Orodha ya Wanaodaiwa')} ({unpaidDebts.length})</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {unpaidDebts.length === 0 ? (
          <div className="text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100">
            {t('safi_kabisa_hakuna_mteja', 'Safi kabisa! Hakuna mteja anayedaiwa kwa sasa.')}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
            {unpaidDebts.map(debt => {
              const payments = debtPayments.filter(p => p.sale_id === debt.id);
              const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
              const remaining = debt.total_amount - totalPaid;

              return (
                <div key={debt.id} className="bg-white p-5 rounded-2xl border border-gray-100 hover:border-red-100 hover:shadow-md transition-all flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-3 gap-2">
                      <div className="min-w-0">
                        <h3 className="font-extrabold text-gray-900 flex items-center text-sm truncate">
                          <User className="w-4 h-4 mr-1.5 text-blue-500 shrink-0" />
                          {debt.customer_name}
                        </h3>
                        {debt.customer_phone && (
                          <p className="text-xs font-semibold text-gray-400 flex items-center mt-1 truncate">
                            <Phone className="w-3.5 h-3.5 mr-1 text-gray-300" />
                            {debt.customer_phone}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-black text-red-600 text-sm">{formatCurrency(remaining, currency)}</div>
                        <div className="text-[10px] text-red-400 uppercase font-extrabold tracking-wider">{t('baki', 'Baki')}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 mb-3.5">
                      <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                        <p className="text-[9px] text-gray-400 uppercase font-black tracking-wider">{t('bei_ya_mwanzo', 'Bei ya Mwanzo')}</p>
                        <p className="text-xs font-black text-gray-700 mt-0.5">{formatCurrency(debt.total_amount, currency)}</p>
                      </div>
                      <div className="bg-green-50/50 p-2.5 rounded-xl border border-green-100/30">
                        <p className="text-[9px] text-green-500 uppercase font-black tracking-wider">{t('amelipa', 'Amelipa')}</p>
                        <p className="text-xs font-black text-green-700 mt-0.5">{formatCurrency(totalPaid, currency)}</p>
                      </div>
                    </div>

                    <div className="mb-4 bg-gray-50/60 p-3 rounded-xl border border-gray-100">
                      <div className="flex justify-between items-center mb-1.5">
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">{t('bidhaa_zilizochukuliwa', 'Bidhaa zilizochukuliwa:')}</p>
                        <div className="flex gap-1.5">
                          <button 
                            onClick={() => handleDownloadInvoice(debt)}
                            className="text-[9px] font-black text-emerald-600 hover:text-emerald-700 uppercase flex items-center tracking-wider bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded cursor-pointer transition-colors"
                            title={t('pakua_invoisi_title', 'Pakua Invoisi ya PDF')}
                          >
                            <FileText className="w-2.5 h-2.5 mr-0.5" /> PDF
                          </button>
                          <button 
                            onClick={() => setShowHistory(showHistory === debt.id ? null : debt.id)}
                            className="text-[9px] font-black text-blue-600 hover:text-blue-700 uppercase flex items-center tracking-wider bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded cursor-pointer transition-colors"
                          >
                            <History className="w-2.5 h-2.5 mr-0.5" /> {t('historia', 'Historia')}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {saleItems.filter(i => i.sale_id === debt.id).map((item, idx) => (
                          <div key={idx} className="text-xs text-gray-600 flex justify-between font-semibold">
                            <span className="truncate mr-2">{item.product_name} <span className="text-gray-400">x{item.qty}</span></span>
                            <span className="shrink-0">{formatCurrency(item.sell_price * item.qty, currency)}</span>
                          </div>
                        ))}
                      </div>

                      {showHistory === debt.id && payments.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-gray-200">
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">{t('historia_ya_viwango_vya_malipo', 'Historia ya Viwango vya Malipo:')}</p>
                          <div className="space-y-1">
                            {payments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((p, idx) => (
                              <div key={idx} className="text-[10px] text-gray-500 flex justify-between font-bold">
                                <span>{format(new Date(p.created_at), 'dd/MM/yyyy')}</span>
                                <span className="text-green-600">+{formatCurrency(p.amount, currency)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex gap-2 pt-3 border-t border-gray-100/80">
                    <button 
                      onClick={() => setSelectedDebt(debt)}
                      className="flex-1 flex items-center justify-center text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 py-2.5 rounded-xl transition-all font-sans cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      {t('lipa_kidogo', 'Lipa Kidogo')}
                    </button>
                    <button 
                      onClick={() => handleFullPayment(debt)}
                      className="flex-1 flex items-center justify-center text-xs font-bold text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 py-2.5 rounded-xl transition-all font-sans cursor-pointer"
                    >
                      <CheckCircle className="w-3.5 h-3.5 mr-1" />
                      {t('lipa_zote', 'Lipa Zote')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Partial Payment Modal */}
      {selectedDebt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800">{t('rekodi_malipo', 'Rekodi Malipo')}</h3>
              <button onClick={() => setSelectedDebt(null)} className="p-1 text-gray-400 cursor-pointer">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-1">{t('mteja', 'Mteja')}: <span className="font-bold text-gray-800">{selectedDebt.customer_name}</span></p>
              <p className="text-sm text-gray-500">{t('deni_lililobaki', 'Deni Lililobaki')}: <span className="font-bold text-red-600">{formatCurrency(selectedDebt.total_amount - (debtPayments.filter(p => p.sale_id === selectedDebt.id).reduce((s, p) => s + p.amount, 0)), currency)}</span></p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">{t('kiasi_cha_malipo', 'Kiasi cha Malipo')}</label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input 
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder={t('weka_kiasi', 'Weka kiasi...')}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-bold text-lg"
                    autoFocus
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setSelectedDebt(null)}
                  className="py-3 bg-gray-100 text-gray-600 rounded-xl font-bold cursor-pointer hover:bg-gray-200 transition-colors"
                >
                  {t('ghairi', 'Ghairi')}
                </button>
                <button 
                  onClick={() => handleRecordPayment(selectedDebt.id, Number(paymentAmount))}
                  disabled={!paymentAmount || Number(paymentAmount) <= 0}
                  className="py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md shadow-blue-200 disabled:opacity-50 cursor-pointer hover:bg-blue-700 transition-colors"
                >
                  {t('hifadhi', 'Hifadhi')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
