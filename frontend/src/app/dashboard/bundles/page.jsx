'use client';

import { useEffect, useState } from 'react';
import Link from '../../../components/LocaleLink';
import { Boxes, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { vendorApi } from '../../../lib/api';
import { useApp } from '../../../context/AppContext';
import useRowLink from '../../../lib/useRowLink';

const statusStyle = {
  published: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  draft: 'bg-zinc-100 text-zinc-500',
};

export default function VendorBundlesPage() {
  const rowLink = useRowLink();
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState('');

  const load = async () => {
    try {
      const res = await vendorApi.getBundles();
      setBundles(res.bundles || []);
    } catch (_) { setBundles([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!window.confirm(isAr ? 'حذف هذه الباقة؟' : 'Delete this bundle?')) return;
    setDeletingId(id);
    try { await vendorApi.deleteBundle(id); setBundles(prev => prev.filter(b => b._id !== id)); }
    catch (_) {} finally { setDeletingId(''); }
  };

  const statusLabel = (s) => isAr
    ? ({ published: 'منشورة', pending: 'قيد المراجعة', draft: 'مسودة' }[s] || s)
    : ({ published: 'Published', pending: 'Pending', draft: 'Draft' }[s] || s);

  return (
    <div className="max-w-5xl mx-auto" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Boxes className="text-marine-primary" size={26} />
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">{isAr ? 'الباقات' : 'Bundles'}</h1>
        </div>
        <Link href="/dashboard/bundles/add" className="inline-flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-4 py-2.5 rounded-xl text-sm">
          <Plus size={16} /> {isAr ? 'إنشاء باقة' : 'Create Bundle'}
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-marine-primary" size={30} /></div>
      ) : bundles.length === 0 ? (
        <div className="bg-white dark:bg-white/5 rounded-3xl p-16 text-center border border-dashed border-zinc-200 dark:border-white/10">
          <Boxes size={48} className="text-zinc-300 mx-auto mb-4" />
          <p className="text-zinc-500 font-bold">{isAr ? 'لم تنشئ أي باقات بعد.' : 'You have not created any bundles yet.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bundles.map(b => {
            const title = isAr ? (b.title_ar || b.title_en) : (b.title_en || b.title_ar);
            const img = (b.images || []).find(i => i.is_primary)?.url || b.images?.[0]?.url || '';
            return (
              <div key={b._id} {...rowLink(`/dashboard/bundles/${b._id}/edit`)} className="flex items-center gap-4 bg-white dark:bg-white/5 rounded-2xl border border-zinc-100 dark:border-white/10 p-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                <div className="w-14 h-14 rounded-xl bg-zinc-50 overflow-hidden flex-shrink-0">
                  {img ? <img src={img} alt={title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-zinc-300"><Boxes size={20} /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-zinc-800 dark:text-white truncate">{title || (isAr ? 'بدون عنوان' : 'Untitled')}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${statusStyle[b.status] || ''}`}>{statusLabel(b.status)}</span>
                    <span className="text-xs text-zinc-500">{(b.members?.length || 0)} {isAr ? 'منتجات' : 'items'}</span>
                    {b.pricing && <span className="text-xs text-marine-primary font-bold">{currency} {Number(b.pricing.effective || 0).toFixed(2)}</span>}
                  </div>
                </div>
                <Link href={`/dashboard/bundles/${b._id}/edit`} className="p-2 rounded-xl bg-zinc-50 dark:bg-white/5 text-zinc-600 dark:text-zinc-300"><Pencil size={16} /></Link>
                <button onClick={() => handleDelete(b._id)} disabled={deletingId === b._id} className="p-2 rounded-xl bg-red-50 text-red-500 disabled:opacity-50">
                  {deletingId === b._id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
