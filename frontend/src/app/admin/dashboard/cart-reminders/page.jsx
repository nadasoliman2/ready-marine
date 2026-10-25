'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Download, Eye, Loader2, MailCheck, MailX, Save, Search, ShoppingBag, Users, X } from 'lucide-react';
import { adminApi, downloadFile } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import Link from '../../../../components/LocaleLink';
import Overlay from '../../../../components/Overlay';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';

const INPUT = 'bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-zinc-900 dark:text-white outline-none focus:border-marine-cyan';
const CARD = 'bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl';
const TH = 'text-start font-bold px-4 py-3 whitespace-nowrap';
const TD = 'px-4 py-3 text-zinc-700 dark:text-zinc-300';

const STATUS = {
  sent: { ar: 'اتبعت', en: 'Sent', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  failed: { ar: 'فشل', en: 'Failed', cls: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' },
  outcome_unknown: { ar: 'غير معروف', en: 'Unknown', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
};

const money = (n) => `${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`;

/** Typing settles for a moment before the list is asked again. */
function useDebounced(value, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className={`${CARD} p-4 flex items-center gap-3`}>
      <span className="w-10 h-10 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center shrink-0">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-zinc-500">{label}</p>
        <p className="text-xl font-black text-zinc-900 dark:text-white">{Number(value || 0).toLocaleString('en-US')}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status, error, isAr }) {
  const s = STATUS[status] || STATUS.failed;
  return (
    <span title={error || ''} className={`inline-block px-2 py-0.5 rounded-lg text-xs font-black whitespace-nowrap ${s.cls}`}>
      {isAr ? s.ar : s.en}
    </span>
  );
}

// What a run's outcomes mean, for the "last run" line.
const RUN_SKIPPED = {
  presence_unavailable: { ar: 'اتلغى: مكانش ممكن نعرف مين أونلاين (Redis)', en: 'Skipped: online status unavailable (Redis)' },
  email_not_configured: { ar: 'اتلغى: إعدادات الإيميل ناقصة', en: 'Skipped: email is not configured' },
  lock_unavailable: { ar: 'اتلغى: مشكلة مؤقتة', en: 'Skipped: temporary problem' },
};

function lastRunText(result, isAr) {
  if (!result) return '';
  if (result.skipped) {
    const s = RUN_SKIPPED[result.skipped];
    return s ? (isAr ? s.ar : s.en) : result.skipped;
  }
  const counts = result.counts || {};
  const sent = counts.sent || 0;
  const failed = (counts.send_failed || 0) + (counts.send_outcome_unknown || 0);
  const online = counts.connected || 0;
  const parts = [isAr ? `اتبعت ${sent}` : `${sent} sent`];
  if (failed) parts.push(isAr ? `فشل ${failed}` : `${failed} failed`);
  if (online) parts.push(isAr ? `${online} كانوا أونلاين فاتأجلوا` : `${online} online, held back`);
  return parts.join(' · ');
}

/**
 * When the reminders go out: on/off, the daily time (Cairo), and how long a cart must sit
 * untouched first. Saved changes apply at once — the server re-reads them every minute.
 */
function ScheduleSettings({ isAr }) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { ok, text }

  useEffect(() => {
    let active = true;
    adminApi.getCartReminderSettings()
      .then((data) => {
        if (!active) return;
        setSettings(data.settings);
        setForm({ enabled: data.settings.enabled, send_time: data.settings.send_time || '18:00', inactivity_hours: data.settings.inactivity_hours });
      })
      .catch((err) => { if (active) setMessage({ ok: false, text: err.message }); });
    return () => { active = false; };
  }, []);

  const tz = settings?.timezone || 'Africa/Cairo';
  const fmt = (d, opts) => new Date(d).toLocaleString(isAr ? 'ar-EG' : 'en-GB', { timeZone: tz, ...opts });
  const dirty = settings && form && (
    form.enabled !== settings.enabled || form.send_time !== settings.send_time || Number(form.inactivity_hours) !== settings.inactivity_hours
  );

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const data = await adminApi.updateCartReminderSettings({
        enabled: form.enabled, send_time: form.send_time, inactivity_hours: Number(form.inactivity_hours),
      });
      setSettings(data.settings);
      setMessage({ ok: true, text: isAr ? 'اتحفظ — الميعاد الجديد شغال من دلوقتي.' : 'Saved — the new schedule applies now.' });
    } catch (err) {
      setMessage({ ok: false, text: err.message || (isAr ? 'تعذر الحفظ.' : 'Could not save.') });
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return (
      <div className={`${CARD} p-4 mb-5 text-sm ${message ? 'text-red-500 font-bold' : ''}`}>
        {message ? message.text : <Loader2 size={18} className="animate-spin text-marine-primary" />}
      </div>
    );
  }

  return (
    <div className={`${CARD} p-4 mb-5`}>
      <div className="flex items-center gap-2 mb-4">
        <CalendarClock size={18} className="text-marine-primary" />
        <h2 className="font-black text-zinc-900 dark:text-white">{isAr ? 'ميعاد الإرسال' : 'Send schedule'}</h2>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            onClick={() => setForm({ ...form, enabled: !form.enabled })}
            className={`relative w-11 h-6 rounded-full transition-colors ${form.enabled ? 'bg-marine-cyan' : 'bg-zinc-300 dark:bg-white/20'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${form.enabled ? 'start-[22px]' : 'start-0.5'}`} />
          </button>
          <span className="text-sm font-bold">{form.enabled ? (isAr ? 'الإرسال شغال' : 'Sending on') : (isAr ? 'الإرسال متوقف' : 'Sending off')}</span>
        </label>

        <label className="text-sm">
          <span className="block text-xs font-bold text-zinc-500 mb-1">{isAr ? 'الساعة (بتوقيت القاهرة)' : 'Time (Cairo)'}</span>
          <input type="time" dir="ltr" value={form.send_time} onChange={(e) => setForm({ ...form, send_time: e.target.value })} className={INPUT} />
        </label>

        <label className="text-sm">
          <span className="block text-xs font-bold text-zinc-500 mb-1">{isAr ? 'بعد كام ساعة من آخر نشاط في السلة' : 'Hours since the cart was last touched'}</span>
          <input type="number" min={1} max={720} step={1} dir="ltr" value={form.inactivity_hours}
            onChange={(e) => setForm({ ...form, inactivity_hours: e.target.value })} className={`${INPUT} w-28`} />
        </label>

        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl text-sm font-bold"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {isAr ? 'حفظ' : 'Save'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
        <span>
          {isAr ? 'الإرسال الجاي: ' : 'Next run: '}
          <b className="text-zinc-700 dark:text-zinc-300">
            {settings.next_run_at
              ? fmt(settings.next_run_at, { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
              : (isAr ? 'مفيش — الإرسال متوقف' : 'none — sending is off')}
          </b>
        </span>
        {settings.last_run_at && (
          <span>
            {isAr ? 'آخر تشغيل: ' : 'Last run: '}
            <b className="text-zinc-700 dark:text-zinc-300">{fmt(settings.last_run_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</b>
            {' — '}{lastRunText(settings.last_run_result, isAr)}
          </span>
        )}
      </div>
      {settings.problems?.length > 0 && <p className="mt-2 text-xs font-bold text-red-500">{settings.problems.join(' · ')}</p>}
      {message && <p className={`mt-2 text-xs font-bold ${message.ok ? 'text-emerald-600' : 'text-red-500'}`}>{message.text}</p>}
    </div>
  );
}

/** Links in the preview open in a new tab: a <base> inside the email's <head>, not before its doctype. */
const withBlankTargets = (html = '') => (html.includes('<head>')
  ? html.replace('<head>', '<head><base target="_blank">')
  : `<base target="_blank">${html}`);

/** The email exactly as the customer received it, rebuilt from what was logged when it went out. */
function EmailPreview({ id, isAr, fmtDateTime, onClose }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    adminApi.getCartReminderPreview(id)
      .then((data) => { if (active) setPreview(data); })
      .catch((err) => { if (active) setError(err.message || (isAr ? 'تعذر تحميل الإيميل.' : 'Could not load the email.')); });
    return () => { active = false; };
  }, [id, isAr]);

  return (
    <Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#181B1F] border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-zinc-200 dark:border-white/10">
          <div className="min-w-0 text-sm">
            <p className="font-black text-zinc-900 dark:text-white truncate">{preview?.subject || (isAr ? 'الإيميل' : 'Email')}</p>
            {preview && (
              <p className="text-xs text-zinc-500 mt-0.5 truncate">
                {isAr ? 'إلى' : 'To'}: <span dir="ltr">{preview.to}</span> · {fmtDateTime(preview.sent_at)}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label={isAr ? 'إغلاق' : 'Close'} className="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 bg-zinc-100 dark:bg-zinc-950/60 rounded-b-2xl p-3">
          {error && <p className="py-14 text-center text-sm font-bold text-red-500">{error}</p>}
          {!error && !preview && (
            <div className="py-16 flex justify-center"><Loader2 size={28} className="animate-spin text-marine-primary" /></div>
          )}
          {preview && (
            <iframe
              title="Email"
              // Links open in a new tab; no scripts run here (no allow-scripts), so same-origin
              // only spares the page's own code an error when it looks into the frame.
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              srcDoc={withBlankTargets(preview.html)}
              className="w-full h-[75vh] rounded-xl bg-white border border-zinc-200 dark:border-white/10"
            />
          )}
        </div>
      </div>
    </Overlay>
  );
}

/**
 * The abandoned-cart reminder emails the daily job sent (Backend services/abandonedCartService.js):
 * who got one, when, and — one click — the email itself as they saw it.
 */
export default function CartRemindersPage() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const settledSearch = useDebounced(search.trim());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.cartReminders', 25);
  const [previewId, setPreviewId] = useState(null);

  const params = useMemo(() => ({ search: settledSearch, status }), [settledSearch, status]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    adminApi.getCartReminderReport(params)
      .then((data) => { if (active) { setReport(data); setPage(1); } })
      .catch((err) => { if (active) setError(err.message || (isAr ? 'تعذر تحميل الإيميلات.' : 'Could not load the emails.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params, isAr]);

  const rows = report?.rows || [];
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);
  const days = report?.order_window_days || 7;
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
  const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString(isAr ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  const fmtDateTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;

  return (
    <div className="animate-in fade-in duration-300" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-black text-zinc-900 dark:text-white">
          <MailCheck size={24} className="text-marine-primary" />
          {isAr ? 'إيميلات تذكير السلة' : 'Cart Reminder Emails'}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          {isAr
            ? 'الإيميلات اللي اتبعتت تلقائي للعملاء اللي سابوا منتجات في السلة. اضغط "عرض الإيميل" تشوفه زي ما وصل للعميل.'
            : 'Emails sent automatically to customers who left items in their cart. Press "View email" to see it as the customer did.'}
        </p>
      </div>

      <ScheduleSettings isAr={isAr} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat icon={MailCheck} label={isAr ? 'إيميلات اتبعت' : 'Emails sent'} value={report?.totals?.sent} />
        <Stat icon={Users} label={isAr ? 'عملاء وصلهم' : 'Customers reached'} value={report?.totals?.customers} />
        <Stat icon={ShoppingBag} label={isAr ? `طلبوا خلال ${days} أيام` : `Ordered within ${days} days`} value={report?.totals?.ordered_after} />
        <Stat icon={MailX} label={isAr ? 'محاولات فشلت' : 'Failed attempts'} value={report?.totals?.failed} />
      </div>

      <div className={`${CARD} p-3 mb-5 flex flex-wrap items-center gap-3`}>
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? 'ابحث باسم العميل أو الإيميل أو التليفون أو المنتج' : 'Search customer, email, phone or product'}
            className={`${INPUT} w-full ps-9`}
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT}>
          <option value="">{isAr ? 'كل الحالات' : 'All statuses'}</option>
          <option value="sent">{isAr ? 'اتبعت' : 'Sent'}</option>
          <option value="failed">{isAr ? 'فشلت' : 'Failed'}</option>
        </select>
        <button
          type="button"
          onClick={() => downloadFile(adminApi.cartReminderReportUrl(params))}
          className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-4 py-2 rounded-xl text-sm font-bold"
        >
          <Download size={16} /> {isAr ? 'تحميل Excel' : 'Download Excel'}
        </button>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        {!rows.length ? (
          loading
            ? <div className="py-16 flex justify-center"><Loader2 size={28} className="animate-spin text-marine-primary" /></div>
            : (
              <p className={`py-14 text-center text-sm font-bold ${error ? 'text-red-500' : 'text-zinc-400'}`}>
                {error || (isAr ? 'لسه مفيش إيميلات اتبعتت.' : 'No reminder emails yet.')}
              </p>
            )
        ) : (
          <>
            <div className={`overflow-x-auto ${loading ? 'opacity-50' : ''}`}>
              <table className="w-full text-sm min-w-[960px]">
                <thead className="bg-zinc-50 dark:bg-white/[0.02] text-zinc-500 border-b border-zinc-200 dark:border-white/5">
                  <tr>
                    <th className={TH}>{isAr ? 'التاريخ' : 'Date'}</th>
                    <th className={TH}>{isAr ? 'العميل' : 'Customer'}</th>
                    <th className={TH}>{isAr ? 'الإيميل' : 'Email'}</th>
                    <th className={TH}>{isAr ? 'رقم التليفون' : 'Phone'}</th>
                    <th className={TH}>{isAr ? 'المنتجات' : 'Items'}</th>
                    <th className={TH}>{isAr ? 'الحالة' : 'Status'}</th>
                    <th className={TH}>{isAr ? `طلب بعدها (${days} أيام)` : `Ordered after (${days}d)`}</th>
                    <th className={TH} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                  {shown.map((r) => (
                    <tr key={r._id}>
                      <td className={`${TD} whitespace-nowrap`}>
                        {fmtDate(r.sent_at)}
                        <span className="block text-xs text-zinc-400">{fmtTime(r.sent_at)}</span>
                      </td>
                      <td className={`${TD} font-bold text-zinc-900 dark:text-white`}>
                        <Link href={`/admin/dashboard/users/${r.user_id}`} className="hover:text-marine-primary">{r.customer_name || '—'}</Link>
                      </td>
                      <td className={TD}><span dir="ltr">{r.email || '—'}</span></td>
                      <td className={TD}><span dir="ltr" className="whitespace-nowrap">{r.phone || '—'}</span></td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <span className="font-bold">{r.item_count}</span> · {money(r.items_total)}
                      </td>
                      <td className={TD}><StatusBadge status={r.status} error={r.error} isAr={isAr} /></td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {r.order_after ? (
                          <Link href={`/admin/dashboard/orders/${r.order_after._id}`} className="font-bold text-emerald-600 hover:underline">
                            {money(r.order_after.total_price)}
                            <span className="block text-xs font-medium text-zinc-500">{fmtDate(r.order_after.created_at)}</span>
                          </Link>
                        ) : <span className="text-zinc-400">{r.status === 'sent' ? (isAr ? 'لأ' : 'No') : '—'}</span>}
                      </td>
                      <td className={`${TD} text-end`}>
                        <button
                          type="button"
                          onClick={() => setPreviewId(r._id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-white/10 text-xs font-bold hover:border-marine-cyan hover:text-marine-primary whitespace-nowrap"
                        >
                          <Eye size={14} /> {isAr ? 'عرض الإيميل' : 'View email'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls
              page={page}
              pageSize={pageSize}
              total={rows.length}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              labels={{ showing: isAr ? 'عرض' : 'Showing', of: isAr ? 'من' : 'of', previous: isAr ? 'السابق' : 'Previous', next: isAr ? 'التالي' : 'Next' }}
            />
          </>
        )}
      </div>

      {previewId && <EmailPreview id={previewId} isAr={isAr} fmtDateTime={fmtDateTime} onClose={() => setPreviewId(null)} />}
    </div>
  );
}
