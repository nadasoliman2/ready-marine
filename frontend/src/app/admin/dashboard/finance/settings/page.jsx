'use client';

import { useEffect, useState, useCallback } from 'react';
import { useApp } from '../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../lib/api';
import {
    CARD, INPUT, LABEL, Money, Spinner, EmptyState, TableWrap, Th, Td,
    money, fmtDate, toInputDate,
} from '../../../../../components/dashboard/finance/FinanceUI';
import {
    CalendarClock, Save, Loader2, CheckCircle2, Megaphone, Plus, Trash2,
    AlertTriangle, Info, X,
} from 'lucide-react';
import Overlay from '../../../../../components/Overlay';

const WEEKDAYS = [
    { value: 0, en: 'Sunday', ar: 'الأحد' },
    { value: 1, en: 'Monday', ar: 'الإثنين' },
    { value: 2, en: 'Tuesday', ar: 'الثلاثاء' },
    { value: 3, en: 'Wednesday', ar: 'الأربعاء' },
    { value: 4, en: 'Thursday', ar: 'الخميس' },
    { value: 5, en: 'Friday', ar: 'الجمعة' },
    { value: 6, en: 'Saturday', ar: 'السبت' },
];

const CHANNELS = [
    { value: 'facebook', en: 'Facebook', ar: 'فيسبوك' },
    { value: 'instagram', en: 'Instagram', ar: 'إنستجرام' },
    { value: 'google', en: 'Google', ar: 'جوجل' },
    { value: 'tiktok', en: 'TikTok', ar: 'تيك توك' },
    { value: 'snapchat', en: 'Snapchat', ar: 'سناب شات' },
    { value: 'influencer', en: 'Influencer', ar: 'مؤثرين' },
    { value: 'offline', en: 'Offline', ar: 'دعاية خارجية' },
    { value: 'other', en: 'Other', ar: 'أخرى' },
];

/**
 * Settings — the payout calendar, and the ad-spend ledger that feeds the profit figure.
 *
 * Both live here because both are inputs the admin controls, as opposed to the other three
 * screens which only report what the system already recorded.
 */
export default function FinanceSettingsPage() {
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';
    const locale = isAr ? 'ar-EG' : 'en-US';

    /* ---- Payout schedule ---- */
    const [schedule, setSchedule] = useState(null);
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [scheduleError, setScheduleError] = useState('');

    /* ---- Ad spend ---- */
    const [adSpend, setAdSpend] = useState(null);
    const [adRange, setAdRange] = useState(() => {
        const now = new Date();
        return { from: toInputDate(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: toInputDate(now) };
    });
    const [adForm, setAdForm] = useState(null);
    const [adSaving, setAdSaving] = useState(false);
    const [adError, setAdError] = useState('');

    const [loading, setLoading] = useState(true);

    const loadSchedule = useCallback(async () => {
        try {
            const res = await adminFinanceApi.getPayoutSchedule();
            setSchedule(res.schedule);
            setForm({
                enabled: res.schedule.enabled,
                frequency: res.schedule.frequency || 'daily',
                weekday: res.schedule.weekday,
                interval_weeks: res.schedule.interval_weeks,
                anchor_date: toInputDate(res.schedule.anchor_date),
                hold_days: res.schedule.hold_days,
            });
        } catch (err) {
            setScheduleError(err.message || 'Failed to load the payout schedule');
        }
    }, []);

    const loadAdSpend = useCallback(async () => {
        try {
            setAdSpend(await adminFinanceApi.getAdSpend(adRange));
        } catch (_) { /* the schedule half of the page still works */ }
    }, [adRange.from, adRange.to]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            await Promise.all([loadSchedule(), loadAdSpend()]);
            setLoading(false);
        })();
    }, [loadSchedule]);

    useEffect(() => { loadAdSpend(); }, [loadAdSpend]);

    const saveSchedule = async () => {
        setSaving(true);
        setScheduleError('');
        try {
            const res = await adminFinanceApi.updatePayoutSchedule({
                ...form,
                anchor_date: form.anchor_date || null,
            });
            setSchedule(res.schedule);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (err) {
            setScheduleError(err.message || 'Could not save the schedule');
        } finally {
            setSaving(false);
        }
    };

    const saveAdSpend = async () => {
        setAdSaving(true);
        setAdError('');
        try {
            if (adForm._id) {
                await adminFinanceApi.updateAdSpend(adForm._id, adForm);
            } else {
                await adminFinanceApi.createAdSpend(adForm);
            }
            setAdForm(null);
            await loadAdSpend();
        } catch (err) {
            setAdError(err.message || 'Could not save the entry');
        } finally {
            setAdSaving(false);
        }
    };

    const removeAdSpend = async (id) => {
        try {
            await adminFinanceApi.deleteAdSpend(id);
            await loadAdSpend();
        } catch (err) {
            setAdError(err.message || 'Could not delete the entry');
        }
    };

    if (loading || !form) return <Spinner />;

    return (
        <div className="space-y-6">
            {/* ---------------- Payout schedule ---------------- */}
            <div className={`${CARD} p-6`}>
                <div className="flex items-start gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center shrink-0">
                        <CalendarClock size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                            {isAr ? 'جدول دفع التجار' : 'Vendor payout schedule'}
                        </h2>
                        <p className="text-sm text-zinc-500 mt-0.5">
                            {isAr
                                ? 'اليوم الذي تُدفع فيه مستحقات التجار، ومدة الاحتفاظ بالأموال بعد التسليم.'
                                : 'Which day vendors get paid, and how long their money is held after delivery.'}
                        </p>
                    </div>
                </div>

                <label className="flex items-center gap-3 p-4 rounded-xl bg-zinc-50 dark:bg-white/[0.03] mb-6 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                        className="w-4 h-4 rounded accent-marine-cyan"
                    />
                    <div>
                        <p className="font-bold text-sm text-zinc-900 dark:text-white">
                            {isAr ? 'تفعيل الجدول' : 'Use a payout schedule'}
                        </p>
                        <p className="text-xs text-zinc-500">
                            {isAr
                                ? 'عند إيقافه لا تظهر مواعيد دفع، وتتم الدفعات يدويًا وقتما تشاء.'
                                : 'Switch this off and no payout dates are shown — you pay whenever you choose.'}
                        </p>
                    </div>
                </label>

                <div className={`mb-4 ${form.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
                    <label className={LABEL}>{isAr ? 'التكرار' : 'Frequency'}</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                            { key: 'daily', en: 'Every day', ar: 'يوميًا', hint_en: 'Each order is due the day its settlement period ends.', hint_ar: 'كل طلب يبقى مستحق يوم ما فترة التسوية بتاعته تخلص.' },
                            { key: 'weekly', en: 'On a weekday', ar: 'يوم ثابت في الأسبوع', hint_en: 'Settled orders are batched onto one day of the week.', hint_ar: 'الطلبات اللي خلصت تسويتها تتجمع ليوم واحد في الأسبوع.' },
                        ].map((f) => (
                            <button key={f.key} type="button" onClick={() => setForm({ ...form, frequency: f.key })}
                                className={`text-start p-3 rounded-xl border transition-colors ${form.frequency === f.key
                                    ? 'border-marine-cyan bg-red-50 dark:bg-marine-cyan/10'
                                    : 'border-zinc-200 dark:border-white/10'}`}>
                                <p className={`font-bold text-sm ${form.frequency === f.key ? 'text-marine-primary' : 'text-zinc-900 dark:text-white'}`}>{isAr ? f.ar : f.en}</p>
                                <p className="text-xs text-zinc-500">{isAr ? f.hint_ar : f.hint_en}</p>
                            </button>
                        ))}
                    </div>
                </div>

                <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 ${form.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
                    <div className={form.frequency === 'weekly' ? '' : 'opacity-40 pointer-events-none'}>
                        <label className={LABEL}>{isAr ? 'يوم الدفع' : 'Payout day'}</label>
                        <select
                            value={form.weekday}
                            onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}
                            className={`${INPUT} w-full`}
                        >
                            {WEEKDAYS.map((d) => (
                                <option key={d.value} value={d.value}>{isAr ? d.ar : d.en}</option>
                            ))}
                        </select>
                    </div>

                    <div className={form.frequency === 'weekly' ? '' : 'opacity-40 pointer-events-none'}>
                        <label className={LABEL}>{isAr ? 'كل كم أسبوع' : 'Repeat every'}</label>
                        <select
                            value={form.interval_weeks}
                            onChange={(e) => setForm({ ...form, interval_weeks: Number(e.target.value) })}
                            className={`${INPUT} w-full`}
                        >
                            {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                                <option key={n} value={n}>
                                    {n === 1 ? (isAr ? 'كل أسبوع' : 'Every week') : (isAr ? `كل ${n} أسابيع` : `Every ${n} weeks`)}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className={form.frequency === 'weekly' ? '' : 'opacity-40 pointer-events-none'}>
                        <label className={LABEL}>{isAr ? 'نقطة بداية الدورة' : 'Cycle anchor'}</label>
                        <input
                            type="date"
                            value={form.anchor_date}
                            onChange={(e) => setForm({ ...form, anchor_date: e.target.value })}
                            className={`${INPUT} w-full`}
                        />
                        <p className="text-[11px] text-zinc-400 mt-1">
                            {isAr
                                ? 'تحدد أي أسبوع من الدورة. مهمة فقط عند التكرار كل أسبوعين أو أكثر.'
                                : 'Decides which week of the cycle falls where. Only matters when repeating every 2+ weeks.'}
                        </p>
                    </div>

                    <div>
                        <label className={LABEL}>{isAr ? 'فترة التسوية (يوم)' : 'Settlement period (days)'}</label>
                        <input
                            type="number"
                            min="14"
                            max="90"
                            value={form.hold_days}
                            onChange={(e) => setForm({ ...form, hold_days: Number(e.target.value) })}
                            className={`${INPUT} w-full`}
                            dir="ltr"
                        />
                        <p className="text-[11px] text-zinc-400 mt-1">
                            {isAr
                                ? 'بعد التسليم بكام يوم فلوس الطلب تدخل محفظة التاجر. أقل حاجة ١٤ يوم (فترة الإرجاع). التغيير بيسري على الطلبات اللي تتسلم بعده بس.'
                                : 'Days after delivery before an order’s money reaches the vendor’s wallet. Never under 14 (the return window). Applies to orders delivered after the change.'}
                        </p>
                    </div>
                </div>

                {form.enabled && schedule?.upcoming?.length > 0 && (
                    <div className="mt-6 p-4 rounded-xl bg-zinc-50 dark:bg-white/[0.03]">
                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-3">
                            {isAr ? 'المواعيد القادمة بهذه الإعدادات' : 'Upcoming payout dates with these settings'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {schedule.upcoming.map((d, i) => (
                                <span
                                    key={d}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold ${i === 0
                                        ? 'bg-marine-cyan text-white'
                                        : 'bg-white dark:bg-white/5 text-zinc-600 dark:text-zinc-400'
                                        }`}
                                >
                                    {fmtDate(d, isAr)}
                                </span>
                            ))}
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-3">
                            {isAr
                                ? 'هذه المواعيد تعكس آخر إعدادات محفوظة — احفظ لتحديثها.'
                                : 'These reflect the last SAVED settings — save to refresh them.'}
                        </p>
                    </div>
                )}

                <div className="flex items-start gap-2.5 mt-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10">
                    <Info size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                        {isAr
                            ? 'تغيير هذه الإعدادات يؤثر على المواعيد القادمة فقط. كل مبلغ مُسجَّل يحمل تاريخ انتهاء احتجازه المحدد وقت التسليم، فتقصير المدة لا يجعل أموالًا محتجزة مستحقة بأثر رجعي.'
                            : 'Changing this re-dates future payouts only. Every earning carries its own clearing date, frozen at delivery — shortening the hold period cannot retroactively release money that is already inside its window.'}
                    </p>
                </div>

                {scheduleError && <p className="mt-4 text-sm font-bold text-red-600 dark:text-red-400">{scheduleError}</p>}

                <button
                    onClick={saveSchedule}
                    disabled={saving}
                    className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold text-sm disabled:opacity-60 transition-colors"
                >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                    {saved ? (isAr ? 'تم الحفظ' : 'Saved') : (isAr ? 'حفظ الجدول' : 'Save schedule')}
                </button>
            </div>

            {/* ---------------- Ad spend ledger ---------------- */}
            <div className={CARD}>
                <div className="p-6 pb-4 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center shrink-0">
                            <Megaphone size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                                {isAr ? 'سجل الإنفاق الإعلاني' : 'Ad spend ledger'}
                            </h2>
                            <p className="text-sm text-zinc-500 mt-0.5 max-w-xl">
                                {isAr
                                    ? 'كل إدخال يُوزَّع على أيامه، فأي تقرير يلتقط تلقائيًا حصة الفترة من الحملة.'
                                    : 'Each entry is apportioned across its days, so any report automatically picks up its share of a campaign that spans the period.'}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => setAdForm({
                            channel: 'facebook',
                            campaign: '',
                            amount: '',
                            start_date: toInputDate(new Date()),
                            end_date: toInputDate(new Date()),
                            notes: '',
                        })}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold text-sm transition-colors shrink-0"
                    >
                        <Plus size={16} />
                        {isAr ? 'إضافة إنفاق' : 'Record spend'}
                    </button>
                </div>

                <div className="px-6 pb-4 flex flex-wrap items-end gap-3">
                    <div>
                        <label className={LABEL}>{isAr ? 'من' : 'From'}</label>
                        <input type="date" value={adRange.from} onChange={(e) => setAdRange({ ...adRange, from: e.target.value })} className={INPUT} />
                    </div>
                    <div>
                        <label className={LABEL}>{isAr ? 'إلى' : 'To'}</label>
                        <input type="date" value={adRange.to} onChange={(e) => setAdRange({ ...adRange, to: e.target.value })} className={INPUT} />
                    </div>
                    {adSpend && (
                        <div className="ms-auto text-end">
                            <p className={LABEL}>{isAr ? 'إجمالي الفترة' : 'Total in period'}</p>
                            <p dir="ltr" className="text-xl font-black text-zinc-900 dark:text-white tabular-nums">
                                {money(adSpend.total, currency, locale)}
                            </p>
                        </div>
                    )}
                </div>

                {adError && <p className="px-6 pb-3 text-sm font-bold text-red-600 dark:text-red-400">{adError}</p>}

                {!adSpend ? (
                    <Spinner />
                ) : adSpend.entries.length === 0 ? (
                    <EmptyState
                        icon={Megaphone}
                        title={isAr ? 'لا يوجد إنفاق مسجل' : 'No ad spend recorded'}
                        message={isAr
                            ? 'أضف ما أنفقته على الإعلانات ليظهر في حساب الأرباح تلقائيًا.'
                            : 'Record what you spent on advertising and it flows into the profit calculation automatically.'}
                    />
                ) : (
                    <TableWrap>
                        <table className="w-full min-w-[720px]">
                            <thead className="bg-zinc-50 dark:bg-white/[0.02] border-y border-zinc-100 dark:border-white/5">
                                <tr>
                                    <Th>{isAr ? 'القناة' : 'Channel'}</Th>
                                    <Th>{isAr ? 'الحملة' : 'Campaign'}</Th>
                                    <Th>{isAr ? 'الفترة' : 'Ran'}</Th>
                                    <Th align="right">{isAr ? 'المبلغ' : 'Amount'}</Th>
                                    <Th align="right">{isAr ? 'ضمن الفترة' : 'In this period'}</Th>
                                    <Th className="w-10" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {adSpend.entries.map((e) => {
                                    const partial = e.amount_in_period < e.amount;
                                    return (
                                        <tr key={e._id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                                            <Td>
                                                <span className="text-xs font-bold px-2 py-1 rounded-lg bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300">
                                                    {isAr
                                                        ? (CHANNELS.find((c) => c.value === e.channel)?.ar || e.channel)
                                                        : (CHANNELS.find((c) => c.value === e.channel)?.en || e.channel)}
                                                </span>
                                            </Td>
                                            <Td>
                                                <p className="text-sm text-zinc-800 dark:text-zinc-200">{e.campaign || '—'}</p>
                                                {e.notes && <p className="text-xs text-zinc-500 truncate max-w-[220px]">{e.notes}</p>}
                                            </Td>
                                            <Td>
                                                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                                    {fmtDate(e.start_date, isAr)}
                                                    {e.end_date !== e.start_date && ` → ${fmtDate(e.end_date, isAr)}`}
                                                </p>
                                            </Td>
                                            <Td align="right"><Money value={e.amount} currency={currency} className="text-sm" /></Td>
                                            <Td align="right">
                                                <span dir="ltr" className="text-sm font-bold text-zinc-900 dark:text-white tabular-nums">
                                                    {money(e.amount_in_period, currency, locale)}
                                                </span>
                                                {partial && (
                                                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                                        {isAr ? 'جزء من الحملة' : 'part of the campaign'}
                                                    </p>
                                                )}
                                            </Td>
                                            <Td align="right">
                                                <div className="flex gap-1 justify-end">
                                                    <button
                                                        onClick={() => setAdForm({
                                                            _id: e._id,
                                                            channel: e.channel,
                                                            campaign: e.campaign,
                                                            amount: e.amount,
                                                            start_date: toInputDate(e.start_date),
                                                            end_date: toInputDate(e.end_date),
                                                            notes: e.notes,
                                                        })}
                                                        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-400 hover:text-marine-primary transition-colors"
                                                        aria-label={isAr ? 'تعديل' : 'Edit'}
                                                    >
                                                        <Save size={15} />
                                                    </button>
                                                    <button
                                                        onClick={() => removeAdSpend(e._id)}
                                                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-zinc-400 hover:text-red-500 transition-colors"
                                                        aria-label={isAr ? 'حذف' : 'Delete'}
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            </Td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableWrap>
                )}

                {adSpend && Object.keys(adSpend.by_channel || {}).length > 0 && (
                    <div className="p-6 pt-4 border-t border-zinc-100 dark:border-white/5 flex flex-wrap gap-2">
                        {Object.entries(adSpend.by_channel).map(([channel, amount]) => (
                            <span key={channel} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300">
                                {isAr ? (CHANNELS.find((c) => c.value === channel)?.ar || channel) : (CHANNELS.find((c) => c.value === channel)?.en || channel)}
                                {' · '}
                                <span dir="ltr">{money(amount, currency, locale)}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* ---- Ad spend modal ---- */}
            {adForm && (
                <Overlay className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !adSaving && setAdForm(null)}>
                    <div className={`${CARD} w-full max-w-lg p-6`} onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-start justify-between mb-5">
                            <h3 className="text-lg font-black text-zinc-900 dark:text-white">
                                {adForm._id ? (isAr ? 'تعديل الإنفاق' : 'Edit ad spend') : (isAr ? 'تسجيل إنفاق إعلاني' : 'Record ad spend')}
                            </h3>
                            <button onClick={() => !adSaving && setAdForm(null)} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-400">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={LABEL}>{isAr ? 'القناة' : 'Channel'}</label>
                                    <select value={adForm.channel} onChange={(e) => setAdForm({ ...adForm, channel: e.target.value })} className={`${INPUT} w-full`}>
                                        {CHANNELS.map((c) => <option key={c.value} value={c.value}>{isAr ? c.ar : c.en}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className={LABEL}>{isAr ? 'المبلغ' : 'Amount'} ({currency})</label>
                                    <input
                                        type="number" min="0" step="0.01" dir="ltr"
                                        value={adForm.amount}
                                        onChange={(e) => setAdForm({ ...adForm, amount: e.target.value })}
                                        className={`${INPUT} w-full`}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className={LABEL}>{isAr ? 'اسم الحملة' : 'Campaign name'}</label>
                                <input
                                    value={adForm.campaign}
                                    onChange={(e) => setAdForm({ ...adForm, campaign: e.target.value })}
                                    placeholder={isAr ? 'اختياري — لتمييز حملتين في نفس الشهر' : 'Optional — tells two campaigns in one month apart'}
                                    className={`${INPUT} w-full`}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={LABEL}>{isAr ? 'من تاريخ' : 'Start date'}</label>
                                    <input type="date" value={adForm.start_date} onChange={(e) => setAdForm({ ...adForm, start_date: e.target.value })} className={`${INPUT} w-full`} />
                                </div>
                                <div>
                                    <label className={LABEL}>{isAr ? 'إلى تاريخ' : 'End date'}</label>
                                    <input type="date" value={adForm.end_date} onChange={(e) => setAdForm({ ...adForm, end_date: e.target.value })} className={`${INPUT} w-full`} />
                                </div>
                            </div>

                            <div>
                                <label className={LABEL}>{isAr ? 'ملاحظات' : 'Notes'}</label>
                                <textarea
                                    rows={2}
                                    value={adForm.notes}
                                    onChange={(e) => setAdForm({ ...adForm, notes: e.target.value })}
                                    className={`${INPUT} w-full resize-none`}
                                />
                            </div>
                        </div>

                        <p className="text-[11px] text-zinc-400 mt-4 flex items-start gap-1.5">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            {isAr
                                ? 'المبلغ يُوزَّع بالتساوي على أيام الفترة. حملة من ١ إلى ٣٠ يناير تساهم بعشرة أيام فقط في تقرير يغطي أول عشرة أيام.'
                                : 'The amount is spread evenly across the days it ran. A 1–30 January campaign contributes only ten days of spend to a report covering the first ten days of January.'}
                        </p>

                        <div className="flex gap-3 mt-5">
                            <button onClick={() => setAdForm(null)} disabled={adSaving} className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 font-bold text-sm disabled:opacity-50">
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button onClick={saveAdSpend} disabled={adSaving || !adForm.amount || !adForm.start_date} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-black text-sm disabled:opacity-60 transition-colors">
                                {adSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {isAr ? 'حفظ' : 'Save'}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}
