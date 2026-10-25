'use client';

import { useEffect, useState } from 'react';
import { Boxes, Check, X, Loader2, ShieldCheck } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';

const TABS = ['pending', 'published', 'draft'];

export default function AdminBundlesPage() {
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';

  const [tab, setTab] = useState('pending');
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState('');

  const [approvalRequired, setApprovalRequired] = useState(true);
  const [savingToggle, setSavingToggle] = useState(false);

  const load = async (status) => {
    setLoading(true);
    try {
      const res = await adminApi.getBundles(status);
      setBundles(res.bundles || []);
    } catch (_) { setBundles([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(tab); }, [tab]);
  useEffect(() => {
    (async () => {
      try {
        const s = await adminApi.getSettings();
        setApprovalRequired(s?.bundle_approval_required !== false);
      } catch (_) {}
    })();
  }, []);

  const toggleApproval = async () => {
    const next = !approvalRequired;
    setSavingToggle(true);
    setApprovalRequired(next);
    try { await adminApi.updateSettings({ bundle_approval_required: next }); }
    catch (_) { setApprovalRequired(!next); }
    finally { setSavingToggle(false); }
  };

  const act = async (id, action) => {
    setActingId(id);
    try {
      if (action === 'approve') await adminApi.approveBundle(id);
      else await adminApi.rejectBundle(id);
      setBundles(prev => prev.filter(b => b._id !== id));
    } catch (err) {
      window.alert(err.message || 'Action failed');
    } finally { setActingId(''); }
  };

  const tabLabel = (s) => isAr
    ? ({ pending: 'قيد المراجعة', published: 'منشورة', draft: 'مسودات' }[s])
    : ({ pending: 'Pending', published: 'Published', draft: 'Drafts' }[s]);

  return (
    <div className="max-w-5xl mx-auto" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-3 mb-6">
        <Boxes className="text-marine-primary" size={26} />
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white">{isAr ? 'الباقات' : 'Bundles'}</h1>
      </div>

      {/* Global approval toggle */}
      <div className="mb-6 flex items-center justify-between bg-white dark:bg-white/5 rounded-2xl border border-zinc-100 dark:border-white/10 p-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-violet-600" size={20} />
          <div>
            <p className="font-bold text-zinc-800 dark:text-white text-sm">{isAr ? 'مراجعة الباقات قبل النشر' : 'Require approval for bundles'}</p>
            <p className="text-xs text-zinc-500">{isAr ? 'عند التفعيل، تتبع الباقات نفس مسار مراجعة المنتجات لكل التجار.' : 'When on, bundles follow the product approval flow for all vendors.'}</p>
          </div>
        </div>
        <button onClick={toggleApproval} disabled={savingToggle}
          className={`relative w-12 h-6 rounded-full transition-colors ${approvalRequired ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
          <span className={`absolute top-0.5 start-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${approvalRequired ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {TABS.map(s => (
          <button key={s} onClick={() => setTab(s)}
            className={`px-4 py-2 rounded-xl text-sm font-bold ${tab === s ? 'bg-marine-cyan text-white' : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300'}`}>
            {tabLabel(s)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-marine-primary" size={30} /></div>
      ) : bundles.length === 0 ? (
        <div className="bg-white dark:bg-white/5 rounded-3xl p-16 text-center border border-dashed border-zinc-200 dark:border-white/10">
          <Boxes size={48} className="text-zinc-300 mx-auto mb-4" />
          <p className="text-zinc-500 font-bold">{isAr ? 'لا توجد باقات.' : 'No bundles here.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bundles.map(b => {
            const title = isAr ? (b.title_ar || b.title_en) : (b.title_en || b.title_ar);
            const img = (b.images || []).find(i => i.is_primary)?.url || b.images?.[0]?.url || '';
            return (
              <div key={b._id} className="flex items-center gap-4 bg-white dark:bg-white/5 rounded-2xl border border-zinc-100 dark:border-white/10 p-3">
                <div className="w-14 h-14 rounded-xl bg-zinc-50 overflow-hidden flex-shrink-0">
                  {img ? <img src={img} alt={title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-zinc-300"><Boxes size={20} /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-zinc-800 dark:text-white truncate">{title || 'Untitled'}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                    <span>{b.vendor_id?.store_name || b.vendor_id?.store_username || '—'}</span>
                    <span>· {(b.members?.length || 0)} {isAr ? 'منتجات' : 'items'}</span>
                    {b.pricing && <span className="text-marine-primary font-bold">· {currency} {Number(b.pricing.effective || 0).toFixed(2)}</span>}
                  </div>
                </div>
                {tab === 'pending' && (
                  <>
                    <button onClick={() => act(b._id, 'approve')} disabled={actingId === b._id}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold disabled:opacity-50">
                      {actingId === b._id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {isAr ? 'قبول' : 'Approve'}
                    </button>
                    <button onClick={() => act(b._id, 'reject')} disabled={actingId === b._id}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-red-50 text-red-500 text-xs font-bold disabled:opacity-50">
                      <X size={14} /> {isAr ? 'رفض' : 'Reject'}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
