'use client';

import { useState, useEffect } from 'react';
import { useApp } from '../../../../context/AppContext';
import { adminWalletApi, adminPaymentsApi, adminApi } from '../../../../lib/api';
import {
  Wallet, Save, Loader2, Search, AlertTriangle, Plus, Minus,
  History, X, Check, Users, Lock, Unlock, ArrowDownCircle,
  CreditCard, Copy, FlaskConical,
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

const money = (value) => Number(value || 0).toFixed(2);

/**
 * Admin → Customer Wallets.
 *
 * Two things on this screen carry real weight and are treated accordingly.
 *
 * `enabled` is the checkout kill switch: turning it off does NOT touch a single
 * balance, and the copy says so, because an admin who believes otherwise will
 * hesitate to use it in the exact incident it exists for.
 *
 * The outstanding liability is money customers have paid and not yet spent. It
 * is shown first and named plainly rather than sitting among the counters —
 * it is a debt, not a metric.
 */
export default function WalletControl() {
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

  // ---- Accounts ----
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  const [exceptions, setExceptions] = useState([]);
  const [audit, setAudit] = useState([]);
  const [retrying, setRetrying] = useState(null);

  // ---- Payment gateway ----
  // Kept in its own form and saved by its own button: moving the money between
  // two providers is not the same kind of decision as tweaking a suggested
  // top-up amount, and one Save for both would make it feel like it is.
  const [payments, setPayments] = useState(null);
  const [providers, setProviders] = useState(null);
  const [callbackUrls, setCallbackUrls] = useState(null);
  const [savingProvider, setSavingProvider] = useState(false);
  // Who may pay cash at the door. Beside the COD switch because one is "do we offer cash at
  // all" and the other is "and to whom".
  const [codPolicy, setCodPolicy] = useState(null);
  const [savingCod, setSavingCod] = useState(false);
  const [copied, setCopied] = useState('');

  const currency = stats?.currency || 'EGP';

  const load = async () => {
    try {
      const [settingsRes, statsRes, auditRes, exceptionsRes, paymentsRes] = await Promise.all([
        adminWalletApi.getSettings(),
        adminWalletApi.getStats(),
        adminWalletApi.getAudit({ limit: 15 }),
        adminWalletApi.getExceptions(),
        adminPaymentsApi.getSettings(),
      ]);
      adminApi.getCodPolicy().then((res) => setCodPolicy(res.policy)).catch(() => { });
      setSettings(settingsRes.settings);
      setForm(settingsRes.settings);
      setStats(statsRes.stats);
      setAudit(auditRes.entries || []);
      setExceptions(exceptionsRes.exceptions || []);
      setPayments(paymentsRes.settings);
      setProviders(paymentsRes.providers);
      setCallbackUrls(paymentsRes.paymob_callback_urls);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveCodPolicy = async () => {
    setSavingCod(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await adminApi.updateCodPolicy({
        enabled: codPolicy.enabled,
        min_finished_orders: Number(codPolicy.min_finished_orders),
        max_undelivered_percent: Number(codPolicy.max_undelivered_percent),
        use_bosta_ranking: codPolicy.use_bosta_ranking,
        min_bosta_ranking: Number(codPolicy.min_bosta_ranking),
      });
      setCodPolicy(res.policy);
      setSuccessMsg(isAr ? 'تم حفظ شروط الدفع عند الاستلام.' : 'COD rules saved.');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSavingCod(false);
    }
  };

  const loadAccounts = async (search = '') => {
    setAccountsLoading(true);
    try {
      const data = await adminWalletApi.getAccounts({ q: search, limit: 20 });
      setAccounts(data.accounts || []);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => { loadAccounts(); }, []);

  const save = async () => {
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await adminWalletApi.updateSettings({
        enabled: form.enabled,
        topup_enabled: form.topup_enabled,
        online_payment_enabled: form.online_payment_enabled,
        cod_enabled: form.cod_enabled,
        topup_suggestions: form.topup_suggestions,
      });
      setSettings(res.settings);
      setForm(res.settings);
      setSuccessMsg(isAr ? 'تم حفظ الإعدادات.' : 'Settings saved.');
      await load();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Point the store at a gateway.
   *
   * Only payments STARTED after this takes effect are affected — anything
   * already open at the other provider keeps settling there, because every
   * payment record carries its own provider. The server refuses a provider
   * whose keys are missing rather than letting checkout break in front of a
   * customer, and that refusal is what the error line below reports.
   */
  const saveProvider = async (patch) => {
    setSavingProvider(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await adminPaymentsApi.updateSettings(patch);
      setPayments(res.settings);
      setSuccessMsg(isAr ? 'تم حفظ بوابة الدفع.' : 'Payment gateway saved.');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSavingProvider(false);
    }
  };

  const copy = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch (_) { /* clipboard blocked — the value is on screen to select */ }
  };

  /**
   * Resolve a captured-but-uncredited top-up.
   *
   * The server re-reads the invoice from the provider before crediting, so this
   * cannot mint money for a payment that never actually happened — a row that
   * turns out to be unpaid comes back as an error and is marked failed.
   */
  const retryException = async (topupId) => {
    setRetrying(topupId);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await adminWalletApi.retryException(topupId);
      setSuccessMsg(res.alreadyCredited
        ? (isAr ? 'كان قد أُضيف بالفعل إلى المحفظة.' : 'This top-up had already been credited.')
        : (isAr
          ? `تم التحقق من الدفعة وإضافة ${currency} ${money(res.amount)} إلى محفظة العميل.`
          : `Verified with the provider and credited ${currency} ${money(res.amount)} to the customer's wallet.`));
      await load();
    } catch (err) {
      setErrorMsg(err.message);
      // A row proven unpaid leaves the exceptions list, so refresh either way.
      await load();
    } finally {
      setRetrying(null);
    }
  };

  const openAccount = async (userId) => {
    setErrorMsg('');
    try {
      const data = await adminWalletApi.getAccount(userId, { limit: 50 });
      setSelected(data);
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={32} className="text-marine-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide flex items-center gap-3">
          <Wallet className="text-marine-primary" />
          {isAr ? 'محافظ العملاء' : 'Customer Wallets'}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          {isAr
            ? 'رصيد المتجر الذي يشحنه العملاء ويدفعون منه، وتعود إليه كل المبالغ المستردة.'
            : 'Store credit customers top up, pay from, and receive every refund into.'}
        </p>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-700 dark:text-red-300 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />{errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl text-emerald-700 dark:text-emerald-300 text-sm flex items-start gap-2">
          <Check size={16} className="flex-shrink-0 mt-0.5" />{successMsg}
        </div>
      )}

      {/* ---- Liability first ---- */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className={`${cardClass} md:col-span-2 border-marine-cyan/30 bg-marine-cyan/5`}>
          <p className="text-xs font-bold text-zinc-500 uppercase">
            {isAr ? 'الرصيد المستحق للعملاء' : 'Outstanding liability'}
          </p>
          <p className="text-3xl font-black text-zinc-900 dark:text-white mt-2">
            {currency} {money(stats?.outstanding_liability)}
          </p>
          <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
            {isAr
              ? 'مبالغ دفعها العملاء ولم ينفقوها بعد. هذه التزام على الموقع يُسدَّد بالبضائع.'
              : 'Money customers have paid for and not yet spent — a debt the website settles in goods.'}
          </p>
        </div>
        <StatCard label={isAr ? 'إجمالي الشحن' : 'Total topped up'} value={`${currency} ${money(stats?.lifetime_topped_up)}`} />
        <StatCard label={isAr ? 'إجمالي الإنفاق' : 'Total spent'} value={`${currency} ${money(stats?.lifetime_spent)}`} />
        <StatCard label={isAr ? 'إجمالي المسترد' : 'Total refunded'} value={`${currency} ${money(stats?.lifetime_refunded)}`} />
        <StatCard label={isAr ? 'عدد المحافظ' : 'Wallets'} value={stats?.accounts || 0} icon={Users} />
        <StatCard label={isAr ? 'محافظ موقوفة' : 'Frozen wallets'} value={stats?.frozen_accounts || 0} icon={Lock} />
      </div>

      {/* ---- Payments that need a human ---- */}
      {exceptions.length > 0 && (
        <div className={`${cardClass} border-amber-300 dark:border-amber-500/30`}>
          <h2 className="font-bold text-zinc-900 dark:text-white mb-1 flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            {isAr ? 'مدفوعات لم تصل إلى المحافظ' : 'Paid but not credited'}
          </h2>
          <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
            {isAr
              ? 'هؤلاء العملاء دفعوا فعلاً ولم يُضَف الرصيد إلى محافظهم. زرار «تحقق وأضف الرصيد» يراجع الفاتورة مع بوابة الدفع أولاً، فلو الدفعة لم تتم فعلاً لن يُضاف أي رصيد.'
              : 'These customers were charged and the credit never landed. “Verify & credit” re-checks the invoice with the gateway first, so a payment that never actually happened cannot be credited.'}
          </p>
          <div className="space-y-2">
            {exceptions.map((ex) => (
              <div key={ex._id} className="flex items-center justify-between gap-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">{ex.user?.name || '—'}</p>
                  <p className="text-xs text-zinc-500 truncate">{ex.user?.email} · {isAr ? 'فاتورة' : 'Invoice'} {ex.invoice_id || '—'}</p>
                  {ex.error_message && <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{ex.error_message}</p>}
                </div>
                <div className="text-end flex-shrink-0">
                  <p className="text-sm font-black text-zinc-900 dark:text-white">{ex.currency} {money(ex.amount)}</p>
                  <p className="text-[11px] text-zinc-500">{formatDate(ex.paid_at, isAr)}</p>
                  <button
                    onClick={() => retryException(ex._id)}
                    disabled={retrying === ex._id}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {retrying === ex._id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Check size={12} />}
                    {isAr ? 'تحقق وأضف الرصيد' : 'Verify & credit'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Payment gateway ---- */}
      <div className={cardClass}>
        <div className="flex items-center gap-2 mb-1">
          <CreditCard size={18} className="text-zinc-500" />
          <h2 className="font-bold text-zinc-900 dark:text-white">
            {isAr ? 'بوابة الدفع' : 'Payment gateway'}
          </h2>
        </div>
        <p className="text-xs text-zinc-500 mb-5">
          {isAr
            ? 'تطبَّق على كل الدفع الأونلاين: طلبات العملاء، شحن المحافظ، اشتراكات التجار، وأوردرات التوريد. التغيير يخص العمليات الجديدة فقط — أي عملية مفتوحة حالياً على البوابة الأخرى تكمل عليها.'
            : 'Applies to every online payment: customer orders, wallet top-ups, vendor subscriptions and supply orders. Only NEW payments are affected — anything already open at the other provider settles there.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { id: 'fawaterak', name: 'Fawaterak', nameAr: 'فواتيرك' },
            { id: 'paymob', name: 'Paymob', nameAr: 'Paymob' },
          ].map((provider) => {
            const info = providers?.[provider.id] || {};
            const active = payments?.provider === provider.id;
            return (
              <button
                key={provider.id}
                type="button"
                disabled={savingProvider || !info.ready}
                onClick={() => saveProvider({ provider: provider.id })}
                className={`text-start rounded-xl border p-4 transition-colors disabled:cursor-not-allowed ${
                  active
                    ? 'border-marine-cyan bg-red-50 dark:bg-red-500/10'
                    : 'border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20 disabled:opacity-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-zinc-900 dark:text-white">
                    {isAr ? provider.nameAr : provider.name}
                  </span>
                  {active && <Check size={16} className="text-marine-primary shrink-0" />}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className={`px-2 py-0.5 rounded-full font-bold ${
                    info.mode === 'live'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
                  }`}>
                    {info.mode === 'live' ? (isAr ? 'تشغيل حقيقي' : 'Live') : (isAr ? 'تجريبي' : 'Test')}
                  </span>
                  {active && (
                    <span className="text-zinc-500">{isAr ? 'البوابة الحالية' : 'Currently in use'}</span>
                  )}
                </div>
                {/* Naming the missing variables beats "not configured": the
                    person reading this is the one who has to go and fill them
                    in on the server. */}
                {!info.ready && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                    {isAr ? 'ناقص في ملف .env: ' : 'Missing from .env: '}
                    <span className="font-mono break-all">{(info.missing || []).join(', ')}</span>
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Paymob's callback URLs. Not informational — both have to be saved
            against EVERY Integration ID in Paymob's own dashboard, because only
            card integrations honour the URL we send with each payment. */}
        {callbackUrls && (
          <div className="mt-5 rounded-xl border border-zinc-200 dark:border-white/10 p-4">
            <p className="text-xs font-bold text-zinc-500 uppercase mb-1">
              {isAr ? 'روابط Paymob' : 'Paymob callback URLs'}
            </p>
            <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
              {isAr
                ? 'الاتنين لازم يتحطوا على كل Integration ID في داشبورد Paymob (Settings ← Payment Integrations)، لأن الرابط اللي بنبعته مع كل عملية بيشتغل مع الكارت بس.'
                : 'Both must be saved on every Integration ID in the Paymob dashboard (Settings → Payment Integrations) — the URL we send with each payment is honoured for card integrations only.'}
            </p>
            {[
              { key: 'webhook', label: isAr ? 'Webhook URL' : 'Webhook URL', value: callbackUrls.webhook },
              { key: 'redirect', label: isAr ? 'Redirect URL' : 'Redirect URL', value: callbackUrls.redirect },
            ].map((row) => (
              <div key={row.key} className="flex items-center gap-2 mt-2">
                <span className="text-xs text-zinc-500 w-24 shrink-0">{row.label}</span>
                <code className="flex-1 min-w-0 text-xs font-mono text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-white/5 rounded-lg px-3 py-2 overflow-x-auto whitespace-nowrap">
                  {row.value}
                </code>
                <button
                  type="button"
                  onClick={() => copy(row.value, row.key)}
                  className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-500 shrink-0"
                  title={isAr ? 'نسخ' : 'Copy'}
                >
                  {copied === row.key ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* The rehearsal mechanism: named accounts go to Paymob while everyone
            else stays on the live switch. Meant to be emptied on go-live. */}
        <div className="mt-5">
          <label className={`${labelClass} flex items-center gap-1.5`}>
            <FlaskConical size={12} />
            {isAr ? 'حسابات تجريبية على Paymob' : 'Paymob pilot accounts'}
          </label>
          <input
            className={inputClass}
            value={(payments?.paymob_pilot_user_ids || []).join(', ')}
            onChange={(e) => setPayments({
              ...payments,
              paymob_pilot_user_ids: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
            })}
            placeholder={isAr ? 'معرّفات المستخدمين، مفصولة بفاصلة' : 'User IDs, comma separated'}
          />
          <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
            {isAr
              ? 'الحسابات دي بتروح Paymob دايماً حتى لو البوابة فوق على فواتيرك — عشان نجرّب على السيرفر الحقيقي من غير ما عميل واحد يحس. فضّيها بعد ما تبدّل البوابة نفسها.'
              : 'These accounts always go to Paymob even while the switch above says Fawaterak — so it can be rehearsed on the real server without a customer noticing. Empty it once the switch itself is flipped.'}
          </p>
          <button
            onClick={() => saveProvider({ paymob_pilot_user_ids: payments?.paymob_pilot_user_ids || [] })}
            disabled={savingProvider}
            className="mt-3 px-5 py-2 bg-zinc-900 dark:bg-white/10 hover:bg-zinc-800 dark:hover:bg-white/20 text-white rounded-xl font-bold text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {savingProvider ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isAr ? 'حفظ الحسابات التجريبية' : 'Save pilot accounts'}
          </button>
        </div>
      </div>

      {/* ---- Settings ---- */}
      <div className={cardClass}>
        <h2 className="font-bold text-zinc-900 dark:text-white mb-4">{isAr ? 'الإعدادات' : 'Settings'}</h2>

        <div className="space-y-4">
          <Toggle
            checked={!!form?.enabled}
            onChange={(v) => setForm({ ...form, enabled: v })}
            title={isAr ? 'تفعيل الدفع بالمحفظة' : 'Wallet checkout'}
            hint={isAr
              ? 'عند الإيقاف يعود الدفع عبر بوابة الدفع مباشرة عند إتمام الطلب. لا يتأثر أي رصيد قائم، وتظل المبالغ المستردة تُضاف إلى المحافظ.'
              : 'When off, checkout charges the gateway directly again. No existing balance is touched, and refunds still land in wallets.'}
          />
          {/* Only meaningful while the wallet is live: with it off the gateway
              is already the only prepaid route and cannot be withdrawn. */}
          <Toggle
            checked={!!form?.online_payment_enabled}
            onChange={(v) => setForm({ ...form, online_payment_enabled: v })}
            title={isAr ? 'السماح بالدفع الأونلاين مع المحفظة' : 'Online payment alongside the wallet'}
            hint={isAr
              ? 'عند التفعيل يختار العميل: المحفظة أو الدفع الأونلاين أو عند الاستلام. عند الإيقاف تعود الشاشة إلى المحفظة والدفع عند الاستلام فقط، من غير ما تطفي المحفظة وتحبس أرصدة العملاء.'
              : 'On, the customer chooses: wallet, online, or cash. Off, checkout returns to wallet and cash only — without switching the wallet off and stranding customer balances.'}
          />
          <Toggle
            checked={!!form?.topup_enabled}
            onChange={(v) => setForm({ ...form, topup_enabled: v })}
            title={isAr ? 'السماح بشحن المحافظ' : 'Allow top-ups'}
            hint={isAr
              ? 'أوقفه أثناء انقطاع بوابة الدفع. يظل الرصيد الحالي قابلاً للإنفاق.'
              : 'Turn off during a gateway outage. Existing credit stays spendable.'}
          />
          <Toggle
            checked={!!form?.cod_enabled}
            onChange={(v) => setForm({ ...form, cod_enabled: v })}
            title={isAr ? 'الدفع عند الاستلام' : 'Cash on delivery'}
            hint={isAr
              ? 'مستقل تماماً عن المحفظة. لو اتقفل هنا، بيتقفل على الكل مهما كانت الشروط تحت.'
              : 'Independent of the wallet entirely. Off here means off for everyone, whatever the rules below say.'}
          />

          {/* ---- Who is allowed to pay cash ----
              Two tests on two different sources, and both must pass before a customer keeps
              COD. A customer with no history is never blocked, and Bosta being unreachable
              falls back to our own test rather than closing the method. */}
          {codPolicy && form?.cod_enabled && (
            <div className="pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
              <Toggle
                checked={!!codPolicy.enabled}
                onChange={(v) => setCodPolicy({ ...codPolicy, enabled: v })}
                title={isAr ? 'اقفل الكاش على العملاء اللي بيرفضوا الاستلام' : 'Close COD to customers who refuse deliveries'}
                hint={isAr
                  ? 'عند الإيقاف، الدفع عند الاستلام مفتوح للكل زي ما كان.'
                  : 'When off, cash on delivery is open to everyone as before.'}
              />

              {codPolicy.enabled && (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>
                        {isAr ? 'اقفل لو نسبة أوردراته غير المستلمة أعلى من (%)' : 'Block above this undelivered rate (%)'}
                      </label>
                      <input
                        type="number" min="0" max="100" dir="ltr"
                        className={inputClass}
                        value={codPolicy.max_undelivered_percent}
                        onChange={(e) => setCodPolicy({ ...codPolicy, max_undelivered_percent: e.target.value })}
                      />
                      <p className="text-xs text-zinc-500 mt-2">
                        {isAr
                          ? 'الأوردر بيتحسب «مش مستلم» لو رجع بعد ما اتبعت، أو العميل ألغاه وهو في الطريق. الإلغاء قبل الشحن مش بيتحسب عليه.'
                          : 'An order counts as undelivered when it was refused at the door, or cancelled after it shipped. A cancellation before dispatch is not counted.'}
                      </p>
                    </div>

                    <div>
                      <label className={labelClass}>
                        {isAr ? 'ما تطبّقش القاعدة قبل ما يخلّص كام أوردر' : 'Minimum finished orders before the rule applies'}
                      </label>
                      <input
                        type="number" min="1" dir="ltr"
                        className={inputClass}
                        value={codPolicy.min_finished_orders}
                        onChange={(e) => setCodPolicy({ ...codPolicy, min_finished_orders: e.target.value })}
                      />
                      <p className="text-xs text-zinc-500 mt-2">
                        {isAr
                          ? 'العميل الجديد الكاش مفتوح ليه دايماً — أول أوردر مفيش فيه حاجة تتحكم عليها.'
                          : 'A new customer is never blocked — a first order has nothing to judge.'}
                      </p>
                    </div>
                  </div>

                  <Toggle
                    checked={!!codPolicy.use_bosta_ranking}
                    onChange={(v) => setCodPolicy({ ...codPolicy, use_bosta_ranking: v })}
                    title={isAr ? 'استخدم كمان تقييم بوسطة للعميل' : 'Also use Bosta customer ranking'}
                    hint={isAr
                      ? 'بوسطة بتحسب تقييم للرقم من تعاملاته اللي إحنا مش شايفينها. لو مش متاح أو بوسطة مردتش، القرار بيرجع لشرط الموقع لوحده.'
                      : "Bosta scores the phone from deliveries we cannot see. If it is unavailable, the decision falls back to our own rule alone."}
                  />

                  {codPolicy.use_bosta_ranking && (
                    <div>
                      <label className={labelClass}>
                        {isAr ? 'اقفل لو تقييم بوسطة أقل من' : 'Block below this Bosta ranking'}
                      </label>
                      <input
                        type="number" min="0" max="100" dir="ltr"
                        className={inputClass}
                        value={codPolicy.min_bosta_ranking}
                        onChange={(e) => setCodPolicy({ ...codPolicy, min_bosta_ranking: e.target.value })}
                      />
                    </div>
                  )}
                </>
              )}

              <button
                onClick={saveCodPolicy}
                disabled={savingCod}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-[#b91c1c] transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                {savingCod ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {isAr ? 'حفظ شروط الكاش' : 'Save COD rules'}
              </button>
            </div>
          )}

          <div>
            <label className={labelClass}>
              {isAr ? 'مبالغ الشحن المقترحة' : 'Suggested top-up amounts'}
            </label>
            <input
              className={inputClass}
              value={(form?.topup_suggestions || []).join(', ')}
              onChange={(e) => setForm({
                ...form,
                topup_suggestions: e.target.value.split(',').map((v) => Number(v.trim())).filter((v) => v > 0),
              })}
              placeholder="100, 250, 500, 1000"
            />
            <p className="text-xs text-zinc-500 mt-2">
              {isAr
                ? 'اقتراحات فقط — يستطيع العميل دائماً كتابة أي مبلغ، ولا تؤثر على شحن الفرق عند إتمام الطلب.'
                : 'Suggestions only — a customer can always type any amount, and the shortfall top-up at checkout ignores these.'}
            </p>
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="mt-6 px-6 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl font-bold flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {isAr ? 'حفظ' : 'Save'}
        </button>
      </div>

      {/* ---- Accounts ---- */}
      <div className={cardClass}>
        <h2 className="font-bold text-zinc-900 dark:text-white mb-4">{isAr ? 'محافظ العملاء' : 'Customer wallets'}</h2>

        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              className={`${inputClass} ps-10`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadAccounts(query)}
              placeholder={isAr ? 'ابحث بالاسم أو البريد أو الهاتف' : 'Search by name, email, or phone'}
            />
          </div>
          <button
            onClick={() => loadAccounts(query)}
            className="px-5 py-2.5 bg-zinc-900 dark:bg-white/10 text-white rounded-xl font-bold text-sm"
          >
            {isAr ? 'بحث' : 'Search'}
          </button>
        </div>

        {accountsLoading ? (
          <div className="py-10 flex justify-center"><Loader2 size={24} className="animate-spin text-marine-primary" /></div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-zinc-500 py-6 text-center">{isAr ? 'لا توجد نتائج.' : 'No results.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-start text-xs uppercase text-zinc-500 border-b border-zinc-100 dark:border-white/10">
                  <th className="px-3 py-2 text-start">{isAr ? 'العميل' : 'Customer'}</th>
                  <th className="px-3 py-2 text-start">{isAr ? 'الرصيد' : 'Balance'}</th>
                  <th className="px-3 py-2 text-start">{isAr ? 'شُحن' : 'Topped up'}</th>
                  <th className="px-3 py-2 text-start">{isAr ? 'أُنفق' : 'Spent'}</th>
                  <th className="px-3 py-2 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a._id} {...rowLink(a.user?._id && (() => openAccount(a.user._id)))} className="border-b border-zinc-50 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                    <td className="px-3 py-3">
                      <p className="font-bold text-zinc-900 dark:text-white">{a.user?.name || '—'}</p>
                      <p className="text-xs text-zinc-500">{a.user?.email}</p>
                    </td>
                    <td className="px-3 py-3 font-black text-zinc-900 dark:text-white">{currency} {money(a.available)}</td>
                    <td className="px-3 py-3 text-zinc-500">{money(a.lifetime_topped_up)}</td>
                    <td className="px-3 py-3 text-zinc-500">{money(a.lifetime_spent)}</td>
                    <td className="px-3 py-3">
                      {a.status === 'frozen' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold">
                          <Lock size={11} />{isAr ? 'موقوفة' : 'Frozen'}
                        </span>
                      ) : (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">{isAr ? 'نشطة' : 'Active'}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-end">
                      <button
                        onClick={() => openAccount(a.user?._id)}
                        disabled={!a.user?._id}
                        className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-white text-xs font-bold disabled:opacity-40"
                      >
                        {isAr ? 'إدارة' : 'Manage'}
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
        <h2 className="font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
          <History size={18} className="text-marine-primary" />{isAr ? 'سجل التدخلات الإدارية' : 'Admin activity'}
        </h2>
        {audit.length === 0 ? (
          <p className="text-sm text-zinc-500">{isAr ? 'لا يوجد نشاط بعد.' : 'No activity yet.'}</p>
        ) : (
          <div className="space-y-2">
            {audit.map((entry) => (
              <div key={entry._id} className="p-3 rounded-xl bg-zinc-50 dark:bg-white/5 text-sm">
                <div className="flex justify-between gap-3">
                  <p className="font-bold text-zinc-900 dark:text-white">{entry.action.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-zinc-500 flex-shrink-0">{formatDate(entry.created_at, isAr)}</p>
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  {entry.actor?.label}
                  {entry.impact?.amount !== undefined && ` · ${currency} ${money(entry.impact.amount)}`}
                  {entry.impact?.reason && ` · ${entry.impact.reason}`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <AccountDrawer
          data={selected}
          currency={currency}
          isAr={isAr}
          onClose={() => setSelected(null)}
          onChanged={async (userId) => {
            await openAccount(userId);
            await loadAccounts(query);
            await load();
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className={cardClass}>
      <p className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-1.5">
        {Icon && <Icon size={12} />}{label}
      </p>
      <p className="text-xl font-black text-zinc-900 dark:text-white mt-2">{value}</p>
    </div>
  );
}

function Toggle({ checked, onChange, title, hint }) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-zinc-50 dark:bg-white/5">
      <div className="min-w-0">
        <p className="font-bold text-zinc-900 dark:text-white text-sm">{title}</p>
        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{hint}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-6 rounded-full flex-shrink-0 transition-colors ${checked ? 'bg-marine-cyan' : 'bg-zinc-300 dark:bg-white/20'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'start-7' : 'start-1'}`} />
      </button>
    </div>
  );
}

/**
 * One customer's wallet: balance, manual adjustment, freeze, and full statement.
 *
 * The adjustment form requires a reason before it will submit, because that
 * reason is written into the customer's own statement — it is the only
 * explanation they will ever receive for a balance that changed on its own.
 */
function AccountDrawer({ data, currency, isAr, onClose, onChanged }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [direction, setDirection] = useState('credit');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [freezeReason, setFreezeReason] = useState('');
  const [showFreeze, setShowFreeze] = useState(false);

  const userId = data?.customer?._id;
  const isFrozen = data?.balances?.status === 'frozen';

  const submitAdjust = async () => {
    setBusy(true);
    setErr('');
    try {
      await adminWalletApi.adjust(userId, { amount: Number(amount), reason, direction });
      setAmount('');
      setReason('');
      await onChanged(userId);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitStatus = async (status) => {
    setBusy(true);
    setErr('');
    try {
      await adminWalletApi.setStatus(userId, { status, reason: freezeReason });
      setFreezeReason('');
      setShowFreeze(false);
      await onChanged(userId);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#09090b] w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h3 className="text-lg font-black text-zinc-900 dark:text-white">{data.customer?.name}</h3>
            <p className="text-xs text-zinc-500">{data.customer?.email} · {data.customer?.phone}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10">
            <X size={18} className="text-zinc-500" />
          </button>
        </div>

        {err && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-700 dark:text-red-300 text-sm">
            {err}
          </div>
        )}

        <div className="p-5 rounded-2xl bg-marine-cyan/10 border border-marine-cyan/30 mb-6">
          <p className="text-xs font-bold text-zinc-500 uppercase">{isAr ? 'الرصيد المتاح' : 'Available balance'}</p>
          <p className="text-3xl font-black text-zinc-900 dark:text-white mt-1">
            {currency} {money(data.balances?.available)}
          </p>
          {isFrozen && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1.5">
              <Lock size={12} />
              {isAr ? 'موقوفة' : 'Frozen'}{data.balances?.frozen_reason ? ` — ${data.balances.frozen_reason}` : ''}
            </p>
          )}
        </div>

        {/* ---- Manual adjustment ---- */}
        <div className="mb-6">
          <p className="font-bold text-zinc-900 dark:text-white mb-3">{isAr ? 'تعديل يدوي' : 'Manual adjustment'}</p>
          <div className="flex gap-2 mb-3">
            {['credit', 'debit'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                  direction === d
                    ? d === 'credit' ? 'bg-emerald-600 text-white' : 'bg-marine-cyan text-white'
                    : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                {d === 'credit' ? <Plus size={14} /> : <Minus size={14} />}
                {d === 'credit' ? (isAr ? 'إضافة' : 'Add') : (isAr ? 'خصم' : 'Remove')}
              </button>
            ))}
          </div>
          <input
            className={`${inputClass} mb-3`}
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={isAr ? `المبلغ (${currency})` : `Amount (${currency})`}
          />
          <input
            className={`${inputClass} mb-2`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={isAr ? 'السبب (إلزامي)' : 'Reason (required)'}
          />
          <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
            {isAr
              ? 'يظهر هذا السبب للعميل في سجل محفظته، وهو التفسير الوحيد الذي سيصله.'
              : 'This reason appears in the customer’s own wallet statement — it is the only explanation they will get.'}
          </p>
          <button
            onClick={submitAdjust}
            disabled={busy || !amount || !reason.trim()}
            className="w-full py-2.5 rounded-xl bg-zinc-900 dark:bg-white/10 text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {isAr ? 'تنفيذ' : 'Apply'}
          </button>
        </div>

        {/* ---- Freeze ---- */}
        <div className="mb-6 p-4 rounded-xl bg-zinc-50 dark:bg-white/5">
          <p className="font-bold text-zinc-900 dark:text-white text-sm mb-1">
            {isFrozen ? (isAr ? 'إعادة تفعيل المحفظة' : 'Unfreeze wallet') : (isAr ? 'إيقاف المحفظة' : 'Freeze wallet')}
          </p>
          <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
            {isAr
              ? 'الإيقاف يمنع الإنفاق والشحن فقط. تظل المبالغ المستردة والتعديلات الإدارية تصل إلى المحفظة، والرصيد لا يُمس.'
              : 'A freeze stops spending and top-ups only. Refunds and admin corrections still land, and the balance is untouched.'}
          </p>

          {isFrozen ? (
            <button
              onClick={() => submitStatus('active')}
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Unlock size={14} />{isAr ? 'إعادة التفعيل' : 'Unfreeze'}
            </button>
          ) : !showFreeze ? (
            <button
              onClick={() => setShowFreeze(true)}
              className="w-full py-2.5 rounded-xl bg-amber-500 text-white font-bold text-sm flex items-center justify-center gap-2"
            >
              <Lock size={14} />{isAr ? 'إيقاف' : 'Freeze'}
            </button>
          ) : (
            <div className="space-y-2">
              <input
                className={inputClass}
                value={freezeReason}
                onChange={(e) => setFreezeReason(e.target.value)}
                placeholder={isAr ? 'سبب الإيقاف (إلزامي)' : 'Reason for the freeze (required)'}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => submitStatus('frozen')}
                  disabled={busy || !freezeReason.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white font-bold text-sm disabled:opacity-40"
                >
                  {isAr ? 'تأكيد الإيقاف' : 'Confirm freeze'}
                </button>
                <button
                  onClick={() => setShowFreeze(false)}
                  className="px-4 py-2.5 rounded-xl bg-zinc-200 dark:bg-white/10 text-zinc-700 dark:text-white font-bold text-sm"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---- Top-ups ---- */}
        {data.topups?.length > 0 && (
          <div className="mb-6">
            <p className="font-bold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
              <ArrowDownCircle size={16} className="text-marine-primary" />{isAr ? 'عمليات الشحن' : 'Top-ups'}
            </p>
            <div className="space-y-1.5">
              {data.topups.map((t) => (
                <div key={t._id} className="flex justify-between gap-3 p-2.5 rounded-lg bg-zinc-50 dark:bg-white/5 text-sm">
                  <div>
                    <p className="font-bold text-zinc-900 dark:text-white">{t.currency} {money(t.amount)}</p>
                    <p className="text-[11px] text-zinc-500">{formatDate(t.created_at, isAr)}</p>
                  </div>
                  <p className={`text-xs font-bold ${
                    t.status === 'paid' ? 'text-emerald-600 dark:text-emerald-400'
                      : t.status === 'paid_credit_failed' ? 'text-amber-600 dark:text-amber-400'
                        : 'text-zinc-500'
                  }`}>
                    {t.status.replace(/_/g, ' ')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- Statement ---- */}
        <div>
          <p className="font-bold text-zinc-900 dark:text-white mb-3">{isAr ? 'سجل المحفظة' : 'Wallet statement'}</p>
          {(data.transactions || []).length === 0 ? (
            <p className="text-sm text-zinc-500">{isAr ? 'لا توجد عمليات.' : 'No transactions.'}</p>
          ) : (
            <div className="space-y-1.5">
              {data.transactions.map((tx) => (
                <div key={tx._id} className="flex justify-between gap-3 p-2.5 rounded-lg bg-zinc-50 dark:bg-white/5 text-sm">
                  <div className="min-w-0">
                    <p className="font-bold text-zinc-900 dark:text-white">{tx.type.replace(/_/g, ' ')}</p>
                    <p className="text-[11px] text-zinc-500">{formatDate(tx.created_at, isAr)}</p>
                    {tx.reason && <p className="text-[11px] text-zinc-500 mt-0.5">{tx.reason}</p>}
                  </div>
                  <div className="text-end flex-shrink-0">
                    <p className="font-black text-zinc-900 dark:text-white">{tx.currency} {money(tx.amount)}</p>
                    <p className="text-[11px] text-zinc-500">{isAr ? 'الرصيد' : 'Balance'} {money(tx.balance_after)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}
