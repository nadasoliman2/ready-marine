'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { adminApi } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import Overlay from '../Overlay';

// Human-readable labels for each related-record key returned by the backend impact preview.
const RELATED_LABELS = {
  orders: { en: 'Orders', ar: 'الطلبات' },
  payments: { en: 'Payments', ar: 'المدفوعات' },
  return_requests: { en: 'Return requests', ar: 'طلبات الإرجاع' },
  refunds: { en: 'Refunds', ar: 'المبالغ المستردة' },
  support_tickets: { en: 'Support tickets', ar: 'تذاكر الدعم' },
  saved_addresses: { en: 'Saved addresses', ar: 'العناوين المحفوظة' },
  saved_vehicles: { en: 'Saved vehicles', ar: 'المركبات المحفوظة' },
  coupon_usage_records: { en: 'Coupon usage records', ar: 'سجلات استخدام الكوبونات' },
  wallet_transactions: { en: 'Wallet transactions', ar: 'حركات المحفظة' },
  loyalty_transactions: { en: 'Loyalty transactions', ar: 'حركات نقاط الولاء' },
  products: { en: 'Products', ar: 'المنتجات' },
  ad_requests: { en: 'Ad requests', ar: 'طلبات الإعلانات' },
  earnings: { en: 'Earnings records', ar: 'سجلات الأرباح' },
  subscriptions: { en: 'Subscriptions', ar: 'الاشتراكات' },
  subscription_payments: { en: 'Subscription payments', ar: 'مدفوعات الاشتراك' },
  withdrawal_requests: { en: 'Withdrawal requests', ar: 'طلبات السحب' },
  notifications: { en: 'Notifications', ar: 'الإشعارات' },
  bosta_pickups: { en: 'Bosta pickups', ar: 'استلامات بوسطة' },
  coupon_links: { en: 'Coupon links (detached)', ar: 'روابط الكوبونات (تُفصل)' },
  shipping_policy_links: { en: 'Shipping policy links (detached)', ar: 'روابط سياسات الشحن (تُفصل)' },
  orders_with_their_items: { en: 'Orders containing their items (kept)', ar: 'طلبات تحتوي عناصرهم (يتم الاحتفاظ بها)' },
};

/**
 * Reusable permanent-delete confirmation modal for user/vendor accounts.
 *
 * Props:
 *  - open: boolean
 *  - entityType: 'user' | 'vendor'
 *  - account: { _id, email, name?, store_name? }
 *  - onClose: () => void
 *  - onDeleted: (impact) => void   // called after a successful delete
 */
export default function HardDeleteModal({ open, entityType, account, onClose, onDeleted }) {
  const { language } = useApp();
  const isAr = language === 'ar';
  const requestSeq = useRef(0);
  const deleteInFlight = useRef(false);

  const [impact, setImpact] = useState(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const accountId = account?._id;
  const displayName = account?.store_name || account?.name || account?.email || '';
  const expected = String(account?.email || '').trim().toLowerCase();
  const matches = confirmText.trim().toLowerCase() === expected && expected.length > 0;

  // Reset + fetch the impact preview each time the modal opens for an account.
  useEffect(() => {
    requestSeq.current += 1;
    const seq = requestSeq.current;

    if (!open || !accountId) {
      setConfirmText('');
      setError('');
      setImpact(null);
      setLoadingImpact(false);
      setDeleting(false);
      deleteInFlight.current = false;
      return undefined;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setConfirmText('');
    setError('');
    setImpact(null);
    setDeleting(false);
    deleteInFlight.current = false;
    setLoadingImpact(true);
    const fetcher = entityType === 'vendor'
      ? adminApi.getVendorDeleteImpact
      : adminApi.getUserDeleteImpact;
    fetcher(accountId, controller ? { signal: controller.signal } : {})
      .then(data => {
        if (requestSeq.current === seq) setImpact(data);
      })
      .catch(err => {
        if (requestSeq.current !== seq || err.name === 'AbortError') return;
        setError(err.message || 'Failed to load deletion impact');
      })
      .finally(() => {
        if (requestSeq.current === seq) setLoadingImpact(false);
      });

    return () => {
      requestSeq.current += 1;
      if (controller) controller.abort();
    };
  }, [open, accountId, entityType]);

  if (!open || !account) return null;

  const handleDelete = async () => {
    if (!matches || deleting || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleting(true);
    setError('');
    let deleted = false;
    try {
      const deleter = entityType === 'vendor'
        ? adminApi.hardDeleteVendor
        : adminApi.hardDeleteUser;
      const res = await deleter(accountId, confirmText.trim());
      onDeleted?.(res.impact || impact);
      deleted = true;
    } catch (err) {
      setError(err.message || 'Failed to delete account');
    } finally {
      if (!deleted) {
        deleteInFlight.current = false;
        setDeleting(false);
      }
    }
  };

  const related = (impact?.related || []).filter(r => r.count > 0);
  // A blocker is money the customer is still owed. It does not warn — it stops
  // the delete, because the cascade would take the wallet ledger with it and
  // leave no record that the debt ever existed.
  const blockers = impact?.blockers || [];
  const blocked = blockers.length > 0;

  return (
    <Overlay className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-[#14171A] rounded-2xl border border-red-200 dark:border-red-500/20 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5 bg-red-50/60 dark:bg-red-500/5">
          <h2 className="text-lg font-black text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertTriangle size={20} />
            {isAr ? 'حذف نهائي للحساب' : 'Permanently Delete Account'}
          </h2>
          <button
            onClick={onClose}
            disabled={deleting}
            className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
            {isAr ? 'أنت على وشك حذف ' : 'You are about to permanently delete '}
            <span className="font-black text-zinc-900 dark:text-white">{displayName}</span>
            {isAr
              ? ' نهائياً. هذا الإجراء لا يمكن التراجع عنه.'
              : '. This action cannot be undone.'}
          </p>

          {/* Impact preview */}
          <div className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0E1012] p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">
              {isAr ? 'سيتم حذف ما يلي' : 'This will remove'}
            </p>
            {loadingImpact ? (
              <div className="flex items-center gap-2 text-sm text-zinc-500 py-2">
                <Loader2 size={16} className="animate-spin" />
                {isAr ? 'جاري حساب التأثير...' : 'Calculating impact...'}
              </div>
            ) : related.length > 0 ? (
              <ul className="space-y-1.5">
                {related.map(r => {
                  const label = RELATED_LABELS[r.key] || { en: r.key, ar: r.key };
                  return (
                    <li key={r.key} className="flex items-center justify-between text-sm">
                      <span className={`text-zinc-600 dark:text-zinc-300 ${r.preserved ? 'italic' : ''}`}>
                        {isAr ? label.ar : label.en}
                      </span>
                      <span className={`font-black ${r.preserved ? 'text-zinc-400' : 'text-red-600 dark:text-red-400'}`}>
                        {r.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">
                {isAr ? 'لا توجد سجلات مرتبطة — سيتم حذف الحساب فقط.' : 'No related records — only the account will be deleted.'}
              </p>
            )}
          </div>

          {/* Outstanding balance — a hard stop, not a caution */}
          {blocked && (
            <div className="rounded-xl border-2 border-amber-400 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4">
              <p className="text-sm font-black text-amber-900 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle size={16} />
                {isAr ? 'لا يمكن الحذف — العميل لديه رصيد' : 'Cannot delete — the customer holds a balance'}
              </p>
              {blockers.map((b) => (
                <p key={b.key} className="text-2xl font-black text-amber-900 dark:text-amber-200 mt-2">
                  {b.currency} {Number(b.amount).toFixed(2)}
                </p>
              ))}
              <p className="text-xs text-amber-800 dark:text-amber-300/80 mt-2 leading-relaxed">
                {isAr
                  ? 'حذف الحساب سيمحو الرصيد وسجل المحفظة بالكامل. سوِّ الرصيد أولاً من «محافظ العملاء» بخصم مع ذكر السبب، وبعدها يمكن الحذف.'
                  : 'Deleting would erase both the balance and the wallet ledger proving it existed. Settle it first from Customer Wallets with a stated reason, then delete.'}
              </p>
            </div>
          )}

          {/* Type-to-confirm */}
          <div>
            <label className="block text-xs font-bold text-zinc-500 mb-2">
              {isAr ? 'اكتب البريد الإلكتروني للتأكيد:' : 'Type the account email to confirm:'}
              <span className="font-mono text-zinc-700 dark:text-zinc-300 ms-1">{account.email}</span>
            </label>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              disabled={deleting}
              dir="ltr"
              placeholder={account.email}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-500 disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-xl text-sm font-bold">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={onClose}
              disabled={deleting}
              className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold disabled:opacity-40"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              onClick={handleDelete}
              // `blocked` is enforced by the server too. Disabling here is so
              // the admin is not invited to press a button that will refuse.
              disabled={!matches || deleting || loadingImpact || blocked}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              {isAr ? 'حذف نهائي' : 'Delete Permanently'}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
