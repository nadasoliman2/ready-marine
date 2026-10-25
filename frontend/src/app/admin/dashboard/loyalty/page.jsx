'use client';

import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../../../context/AppContext';
import { adminLoyaltyApi } from '../../../../lib/api';
import {
  Sparkles, Save, Loader2, Search, AlertTriangle, Plus, Minus,
  History, X, Check, Users, Wallet, Clock, Lock,
} from 'lucide-react';
import useRowLink from '../../../../lib/useRowLink';
import Overlay from '../../../../components/Overlay';

const inputClass = 'w-full bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-2.5 focus:border-marine-cyan focus:ring-1 focus:ring-marine-cyan outline-none transition-colors';
const labelClass = 'block text-xs font-bold text-zinc-500 uppercase mb-2';
const cardClass = 'bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-2xl p-6';

const formatDate = (value, isAr) => value
  ? new Date(value).toLocaleString(isAr ? 'ar-u-ca-gregory' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  : '—';

/**
 * Admin → Loyalty Program.
 *
 * The one thing this screen must not let an admin do quietly is change
 * `point_value`. Every existing balance keeps its point COUNT but changes what
 * those points are worth, so the form warns before saving and reports the
 * re-valued liability after.
 */
export default function LoyaltyControl() {
  const rowLink = useRowLink();
  const { language } = useApp();
  const isAr = language === 'ar';

  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [stats, setStats] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmRevalue, setConfirmRevalue] = useState(false);

  // ---- Accounts ----
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  // ---- Audit ----
  const [audit, setAudit] = useState([]);

  const currency = stats?.currency || 'EGP';

  const load = async () => {
    try {
      const [settingsRes, statsRes, auditRes] = await Promise.all([
        adminLoyaltyApi.getSettings(),
        adminLoyaltyApi.getStats(),
        adminLoyaltyApi.getAudit({ limit: 15 }),
      ]);
      setSettings(settingsRes.settings);
      setForm(settingsRes.settings);
      setStats(statsRes.stats);
      setAudit(auditRes.entries || []);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const loadAccounts = async (search = '') => {
    setAccountsLoading(true);
    try {
      const data = await adminLoyaltyApi.getAccounts({ q: search, limit: 20 });
      setAccounts(data.accounts || []);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => { loadAccounts(); }, []);

  // Does this save re-value every outstanding balance?
  const pointValueChanged = !!form && !!settings
    && Number(form.point_value) !== Number(settings.point_value);

  // Live worked example, so the admin sees the rules applied rather than only
  // the numbers behind them.
  const example = useMemo(() => {
    if (!form) return null;
    const spend = 500;
    const points = Math.floor(spend / (Number(form.spend_per_point) || 1));
    return { spend, points, worth: (points * Number(form.point_value || 0)).toFixed(2) };
  }, [form]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (pointValueChanged && !confirmRevalue) { setConfirmRevalue(true); return; }

    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await adminLoyaltyApi.updateSettings({
        enabled: form.enabled,
        earning_enabled: form.earning_enabled,
        redemption_enabled: form.redemption_enabled,
        spend_per_point: Number(form.spend_per_point),
        point_value: Number(form.point_value),
        min_redeem_points: Number(form.min_redeem_points),
        max_redemption_percent: Number(form.max_redemption_percent),
        allow_with_coupons: form.allow_with_coupons,
        points_expiry_days: form.points_expiry_days === '' || form.points_expiry_days === null
          ? null
          : Number(form.points_expiry_days),
      });
      setSettings(res.settings);
      setForm(res.settings);
      setConfirmRevalue(false);
      setSuccessMsg(
        res.revaluation
          ? (isAr
              ? `تم الحفظ. أُعيد تقييم ${res.revaluation.outstanding_points} نقطة قائمة من ${currency} ${res.revaluation.value_before} إلى ${currency} ${res.revaluation.value_after}.`
              : `Saved. ${res.revaluation.outstanding_points} outstanding points re-valued from ${currency} ${res.revaluation.value_before} to ${currency} ${res.revaluation.value_after}.`)
          : (isAr ? 'تم حفظ إعدادات برنامج الولاء.' : 'Loyalty settings saved.')
      );
      await load();
      setTimeout(() => setSuccessMsg(''), 6000);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={36} className="text-marine-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-3">
            <Sparkles className="text-marine-primary" />
            {isAr ? 'برنامج الولاء' : 'Loyalty Program'}
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            {isAr
              ? 'نقاط العملاء: قواعد الكسب والاستخدام، الأرصدة القائمة، والتعديلات اليدوية.'
              : 'Customer points: earning and redemption rules, outstanding balances, and manual adjustments.'}
          </p>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full ${
          settings?.enabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-zinc-500/15 text-zinc-500'
        }`}>
          {settings?.enabled ? (isAr ? 'مُفعّل' : 'Active') : (isAr ? 'متوقف' : 'Off')}
        </span>
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-sm font-medium">{successMsg}</div>
      )}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm font-medium">{errorMsg}</div>
      )}

      {/* ---- Program totals ---- */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Wallet} label={isAr ? 'نقاط متاحة' : 'Available points'} value={stats?.available_points ?? 0}
          sub={`${currency} ${Number(stats?.outstanding_value || 0).toFixed(2)} ${isAr ? 'التزام قائم' : 'outstanding'}`} />
        <StatCard icon={Clock} label={isAr ? 'نقاط قيد الانتظار' : 'Pending points'} value={stats?.pending_points ?? 0} />
        <StatCard icon={Lock} label={isAr ? 'نقاط محجوزة' : 'Reserved points'} value={stats?.reserved_points ?? 0} />
        <StatCard icon={Users} label={isAr ? 'حسابات نشطة' : 'Accounts'} value={stats?.accounts ?? 0}
          sub={`${stats?.lifetime_earned_points ?? 0} ${isAr ? 'مكتسبة' : 'earned'} · ${stats?.lifetime_redeemed_points ?? 0} ${isAr ? 'مستخدمة' : 'redeemed'}`} />
      </div>

      {/* ---- Settings ---- */}
      <form onSubmit={handleSave} className={cardClass}>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-6">{isAr ? 'الإعدادات' : 'Settings'}</h2>

        <div className="space-y-4 mb-6">
          <Toggle
            checked={form.enabled}
            onChange={(v) => setForm({ ...form, enabled: v })}
            title={isAr ? 'تفعيل برنامج الولاء' : 'Loyalty program enabled'}
            desc={isAr
              ? 'إيقاف البرنامج لا يحذف أي أرصدة قائمة.'
              : 'Switching the program off never deletes existing balances.'}
          />
          <Toggle
            checked={form.earning_enabled}
            onChange={(v) => setForm({ ...form, earning_enabled: v })}
            title={isAr ? 'كسب النقاط' : 'Earning enabled'}
            desc={isAr ? 'الطلبات الجديدة تكسب نقاطاً عند التسليم.' : 'New orders earn points when they are delivered.'}
          />
          <Toggle
            checked={form.redemption_enabled}
            onChange={(v) => setForm({ ...form, redemption_enabled: v })}
            title={isAr ? 'استخدام النقاط' : 'Redemption enabled'}
            desc={isAr
              ? 'يمكن للعملاء دفع جزء من طلباتهم بالنقاط. أوقفه بشكل منفصل عن الكسب.'
              : 'Customers can pay part of an order with points. Controlled separately from earning.'}
          />
          <Toggle
            checked={form.allow_with_coupons}
            onChange={(v) => setForm({ ...form, allow_with_coupons: v })}
            title={isAr ? 'السماح بالجمع مع الكوبونات' : 'Allow stacking with coupons'}
            desc={isAr ? 'يُطبَّق الكوبون أولاً، ثم النقاط على المتبقي.' : 'The coupon is applied first, then points on the remainder.'}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className={labelClass}>{isAr ? `قيمة الإنفاق لكل نقطة (${currency})` : `Spend per point (${currency})`}</label>
            <input type="number" min="0.01" step="0.01" className={inputClass}
              value={form.spend_per_point}
              onChange={(e) => setForm({ ...form, spend_per_point: e.target.value })} />
            <p className="text-[11px] text-zinc-500 mt-1.5">
              {isAr ? 'كم جنيهاً من قيمة المنتجات يعادل نقطة واحدة.' : 'How much product value earns 1 point.'}
            </p>
          </div>

          <div>
            <label className={labelClass}>{isAr ? `قيمة النقطة (${currency})` : `Point value (${currency})`}</label>
            <input type="number" min="0.01" step="0.01" className={inputClass}
              value={form.point_value}
              onChange={(e) => { setForm({ ...form, point_value: e.target.value }); setConfirmRevalue(false); }} />
            <p className="text-[11px] text-zinc-500 mt-1.5">
              {isAr ? 'قيمة الخصم لكل نقطة عند الاستخدام.' : 'The discount each point is worth at checkout.'}
            </p>
          </div>

          <div>
            <label className={labelClass}>{isAr ? 'الحد الأدنى للاستخدام (نقاط)' : 'Minimum redemption (points)'}</label>
            <input type="number" min="0" step="1" className={inputClass}
              value={form.min_redeem_points}
              onChange={(e) => setForm({ ...form, min_redeem_points: e.target.value })} />
          </div>

          <div>
            <label className={labelClass}>{isAr ? 'الحد الأقصى للاستخدام (%)' : 'Maximum redemption (%)'}</label>
            <input type="number" min="0" max="100" step="1" className={inputClass}
              value={form.max_redemption_percent}
              onChange={(e) => setForm({ ...form, max_redemption_percent: e.target.value })} />
            <p className="text-[11px] text-zinc-500 mt-1.5">
              {isAr ? 'نسبة قيمة المنتجات التي يمكن دفعها بالنقاط. الشحن مستثنى دائماً.' : 'Share of product value payable with points. Shipping is always excluded.'}
            </p>
          </div>

          <div>
            <label className={labelClass}>{isAr ? 'انتهاء صلاحية النقاط (أيام)' : 'Points expiry (days)'}</label>
            <input type="number" min="1" step="1" className={inputClass}
              placeholder={isAr ? 'اتركه فارغاً — لا تنتهي' : 'Leave empty — never expires'}
              value={form.points_expiry_days ?? ''}
              onChange={(e) => setForm({ ...form, points_expiry_days: e.target.value === '' ? null : e.target.value })} />
          </div>
        </div>

        {/* Worked example — the rules, applied. */}
        {example && (
          <div className="mt-6 p-4 rounded-xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {isAr
                ? `شراء بقيمة ${currency} ${example.spend} من المنتجات يكسب ${example.points} نقطة، تساوي حالياً ${currency} ${example.worth}.`
                : `A ${currency} ${example.spend} eligible purchase earns ${example.points} points, currently worth ${currency} ${example.worth}.`}
            </p>
          </div>
        )}

        {/* Re-valuation warning. Shown BEFORE the save goes through, because
            afterwards every customer's balance is already worth something else. */}
        {pointValueChanged && (
          <div className="mt-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-600 dark:text-amber-400 leading-relaxed">
              <p className="font-bold">{isAr ? 'سيؤثر هذا على كل رصيد قائم.' : 'This changes the value of every existing balance.'}</p>
              <p className="mt-1">
                {isAr
                  ? `يحتفظ العملاء بنفس عدد النقاط، لكن قيمتها تتغير من ${currency} ${settings.point_value} إلى ${currency} ${form.point_value} لكل نقطة. الأرصدة القائمة الآن: ${(stats?.available_points ?? 0) + (stats?.pending_points ?? 0)} نقطة.`
                  : `Customers keep the same number of points, but each becomes worth ${currency} ${form.point_value} instead of ${currency} ${settings.point_value}. Outstanding right now: ${(stats?.available_points ?? 0) + (stats?.pending_points ?? 0)} points.`}
              </p>
              {confirmRevalue && (
                <p className="mt-2 font-bold">{isAr ? 'اضغط حفظ مرة أخرى للتأكيد.' : 'Press Save again to confirm.'}</p>
              )}
            </div>
          </div>
        )}

        <button type="submit" disabled={saving}
          className="mt-6 inline-flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-6 py-3 rounded-xl transition-colors disabled:opacity-60">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {confirmRevalue && pointValueChanged
            ? (isAr ? 'تأكيد الحفظ' : 'Confirm save')
            : (isAr ? 'حفظ' : 'Save settings')}
        </button>
      </form>

      {/* ---- Customer balances ---- */}
      <div className={cardClass}>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-4">{isAr ? 'أرصدة العملاء' : 'Customer balances'}</h2>

        <form onSubmit={(e) => { e.preventDefault(); loadAccounts(query); }} className="flex gap-2 mb-5">
          <div className="relative flex-1">
            <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-zinc-400" />
            <input
              className={`${inputClass} ps-10`}
              placeholder={isAr ? 'ابحث بالاسم أو البريد أو الهاتف' : 'Search by name, email, or phone'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button type="submit" className="px-5 rounded-xl bg-zinc-900 dark:bg-white/10 text-white font-bold text-sm">
            {isAr ? 'بحث' : 'Search'}
          </button>
        </form>

        {accountsLoading ? (
          <div className="py-10 flex justify-center"><Loader2 size={24} className="text-marine-primary animate-spin" /></div>
        ) : accounts.length === 0 ? (
          <p className="text-zinc-500 text-sm py-6 text-center">{isAr ? 'لا توجد نتائج.' : 'No accounts found.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="text-start font-bold pb-3">{isAr ? 'العميل' : 'Customer'}</th>
                  <th className="text-end font-bold pb-3">{isAr ? 'متاحة' : 'Available'}</th>
                  <th className="text-end font-bold pb-3">{isAr ? 'قيد الانتظار' : 'Pending'}</th>
                  <th className="text-end font-bold pb-3">{isAr ? 'محجوزة' : 'Reserved'}</th>
                  <th className="text-end font-bold pb-3">{isAr ? 'القيمة' : 'Value'}</th>
                  <th className="pb-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {accounts.map((a) => (
                  <tr key={a._id} {...rowLink(a.user && (() => setSelected(a)))} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                    <td className="py-3">
                      <p className="font-bold text-zinc-900 dark:text-white">{a.user?.name || '—'}</p>
                      <p className="text-zinc-500 text-xs">{a.user?.email || a.user?.phone || ''}</p>
                    </td>
                    <td className="py-3 text-end font-bold text-zinc-900 dark:text-white">{a.available_points}</td>
                    <td className="py-3 text-end text-zinc-500">{a.pending_points}</td>
                    <td className="py-3 text-end text-zinc-500">{a.reserved_points}</td>
                    <td className="py-3 text-end text-zinc-500">{currency} {Number(a.available_value).toFixed(2)}</td>
                    <td className="py-3 text-end">
                      <button
                        type="button"
                        onClick={() => setSelected(a)}
                        className="text-xs font-bold text-marine-primary hover:underline"
                        disabled={!a.user}
                      >
                        {isAr ? 'تعديل' : 'Adjust'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Audit ---- */}
      <div className={cardClass}>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
          <History size={18} className="text-marine-primary" />
          {isAr ? 'سجل التغييرات' : 'Change history'}
        </h2>
        {audit.length === 0 ? (
          <p className="text-zinc-500 text-sm py-4">{isAr ? 'لا توجد تغييرات مسجلة بعد.' : 'No changes recorded yet.'}</p>
        ) : (
          <div className="space-y-2">
            {audit.map((entry) => (
              <div key={entry._id} className="p-3 rounded-xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-bold text-zinc-900 dark:text-white">
                      {auditLabel(entry.action, isAr)}
                      <span className="text-zinc-500 font-medium"> · {entry.actor?.label || 'Admin'}</span>
                    </p>
                    {entry.impact?.changed_fields?.length > 0 && (
                      <p className="text-xs text-zinc-500 mt-0.5">{entry.impact.changed_fields.join(', ')}</p>
                    )}
                    {entry.impact?.reason && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {entry.impact.points} {isAr ? 'نقطة' : 'points'} — {entry.impact.reason}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">{formatDate(entry.created_at, isAr)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <AdjustModal
          account={selected}
          isAr={isAr}
          currency={currency}
          onClose={() => setSelected(null)}
          onDone={async () => { setSelected(null); await load(); await loadAccounts(query); }}
        />
      )}
    </div>
  );
}

const auditLabel = (action, isAr) => ({
  loyalty_settings_updated: isAr ? 'تحديث الإعدادات' : 'Settings updated',
  loyalty_admin_credit: isAr ? 'إضافة نقاط يدوية' : 'Manual credit',
  loyalty_admin_debit: isAr ? 'خصم نقاط يدوي' : 'Manual debit',
}[action] || action);

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className={cardClass}>
      <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
        <Icon size={12} />{label}
      </p>
      <p className="text-3xl font-black text-zinc-900 dark:text-white mt-2">{value}</p>
      {sub && <p className="text-zinc-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, title, desc }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="w-full flex items-start gap-4 p-4 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-start hover:border-zinc-300 dark:hover:border-white/20 transition-colors"
    >
      <span className={`mt-0.5 w-10 h-6 rounded-full flex-shrink-0 relative transition-colors ${checked ? 'bg-marine-cyan' : 'bg-zinc-300 dark:bg-white/20'}`}>
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'start-5' : 'start-1'}`} />
      </span>
      <span>
        <span className="block font-bold text-zinc-900 dark:text-white text-sm">{title}</span>
        <span className="block text-zinc-500 text-xs mt-0.5 leading-relaxed">{desc}</span>
      </span>
    </button>
  );
}

/**
 * Manual credit / debit.
 *
 * The reason is required by the API, not merely by this form — an adjustment
 * without an explanation is unauditable, and the customer sees this text in
 * their own points history.
 */
function AdjustModal({ account, isAr, currency, onClose, onDone }) {
  const [direction, setDirection] = useState('credit');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await adminLoyaltyApi.adjust(account.user._id, {
        points: Number(points),
        reason: reason.trim(),
        direction,
      });
      await onDone();
    } catch (err) {
      setError(err.code === 'INSUFFICIENT_POINTS'
        ? (isAr ? 'رصيد العميل لا يكفي لهذا الخصم.' : "This customer's balance is not enough for that debit.")
        : err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        dir={isAr ? 'rtl' : 'ltr'}
        className="bg-white dark:bg-[#16181B] border border-zinc-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-md space-y-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">{isAr ? 'تعديل يدوي' : 'Manual adjustment'}</h3>
            <p className="text-zinc-500 text-sm mt-0.5">{account.user?.name} · {account.available_points} {isAr ? 'نقطة متاحة' : 'available'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-600"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { value: 'credit', label: isAr ? 'إضافة' : 'Credit', icon: Plus },
            { value: 'debit', label: isAr ? 'خصم' : 'Debit', icon: Minus },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDirection(opt.value)}
              className={`p-3 rounded-xl border-2 font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                direction === opt.value
                  ? 'border-marine-cyan bg-marine-cyan/10 text-marine-primary'
                  : 'border-zinc-200 dark:border-white/10 text-zinc-500'
              }`}
            >
              <opt.icon size={14} />{opt.label}
            </button>
          ))}
        </div>

        <div>
          <label className={labelClass}>{isAr ? 'عدد النقاط' : 'Points'}</label>
          <input type="number" min="1" step="1" required className={inputClass}
            value={points} onChange={(e) => setPoints(e.target.value)} />
        </div>

        <div>
          <label className={labelClass}>{isAr ? 'السبب (إلزامي)' : 'Reason (required)'}</label>
          <textarea rows={3} required className={`${inputClass} resize-none`}
            placeholder={isAr ? 'يظهر هذا النص للعميل في سجل نقاطه.' : "This text appears in the customer's own points history."}
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        {error && <p className="text-sm font-medium text-red-500">{error}</p>}

        <button type="submit" disabled={saving || !points || !reason.trim()}
          className="w-full inline-flex items-center justify-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          {isAr ? 'تطبيق التعديل' : 'Apply adjustment'}
        </button>
      </form>
    </Overlay>
  );
}
