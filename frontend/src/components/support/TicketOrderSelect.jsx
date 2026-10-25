'use client';

import { Package } from 'lucide-react';

/**
 * "Which order is this about?" — one dropdown shared by the customer's and the vendor's
 * new-ticket forms. `orders` is whatever list the caller already has; each row needs an
 * `_id`, a reference (`reference` or `transaction.reference`) and a `created_at`.
 * Picking an order is optional: most tickets are not about one.
 */
export default function TicketOrderSelect({ orders = [], value = '', onChange, isAr = false, loading = false }) {
  const refOf = (o) => o?.reference || o?.transaction?.reference || String(o?._id || '').slice(-8).toUpperCase();
  const dateOf = (o) => (o?.created_at ? new Date(o.created_at).toLocaleDateString(isAr ? 'ar-EG' : 'en-GB') : '');

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
        <span className="inline-flex items-center gap-1.5"><Package size={14} /> {isAr ? 'الطلب المتعلق بالمشكلة' : 'Related order'}</span>
        <span className="text-zinc-400 font-normal ms-1">({isAr ? 'اختياري' : 'optional'})</span>
      </label>
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={loading}
        className="w-full px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50 disabled:opacity-60"
      >
        <option value="">{loading ? (isAr ? 'جاري تحميل الطلبات…' : 'Loading orders…') : (isAr ? '— مش متعلق بطلب معين —' : '— Not about a specific order —')}</option>
        {orders.map((o) => (
          <option key={o._id} value={o._id}>
            #{refOf(o)}{dateOf(o) ? ` · ${dateOf(o)}` : ''}
          </option>
        ))}
      </select>
      {value && (
        <p className="text-xs text-zinc-500 mt-1.5">
          {isAr ? 'هيوصل للدعم الفني مربوط بالطلب ده مباشرة.' : 'Support will see this ticket attached to that order.'}
        </p>
      )}
    </div>
  );
}
