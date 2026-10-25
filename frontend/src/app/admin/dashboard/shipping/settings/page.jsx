'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Truck, RefreshCw, Copy } from 'lucide-react';
import { adminApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import { Field, Toggle, inputCls, PrimaryButton } from '../../../../../components/dashboard/shipping/ShippingUI';

export default function ShippingSettingsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    const [form, setForm] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [savedAt, setSavedAt] = useState(0);
    // Courier switch state: what exists, what is configured, Arrive's webhook URL and areas.
    const [couriers, setCouriers] = useState(null);
    const [syncing, setSyncing] = useState(false);
    const loadCouriers = async () => {
        try { const r = await adminApi.getCouriers(); if (r?.success) setCouriers(r); } catch (_) { /* shown as unavailable */ }
    };

    const load = async () => {
        setLoading(true);
        try {
            const data = await adminApi.getShippingSettings();
            const s = data.settings || {};
            setForm({
                enabled: s.enabled !== false,
                // Defaults to 'split' to match the schema: a settings row that has never been
                // saved prices each parcel on its own leg.
                multi_vendor_mode: s.multi_vendor_mode === 'combined' ? 'combined' : 'split',
                no_zone_behavior: ['free', 'block', 'flat'].includes(s.no_zone_behavior) ? s.no_zone_behavior : 'free',
                no_zone_flat_cost: s.no_zone_flat_cost || 0,
                default_weight_unit: s.default_weight_unit || 'kg',
                cache_ttl_seconds: s.cache_ttl_seconds ?? 300,
                auto_pickup_enabled: s.auto_pickup_enabled !== false,
                default_pickup_time_slot: s.default_pickup_time_slot || '10:00 to 13:00',
                pickup_batch_threshold: s.pickup_batch_threshold ?? 1,
                pickup_cutoff_hour: s.pickup_cutoff_hour ?? 16,
                pickup_skip_fridays: s.pickup_skip_fridays !== false,
                smart_label_enabled: s.smart_label_enabled === true,
                courier_provider: s.courier_provider === 'arrive' ? 'arrive' : 'bosta',
                vendor_action_deadline_hours: s.vendor_action_deadline_hours ?? 48,
                vendor_deadline_reminder_hours: s.vendor_deadline_reminder_hours ?? 12,
                bundle_low_orders_threshold: s.bundle_low_orders_threshold ?? 5,
                bundle_low_days_threshold: s.bundle_low_days_threshold ?? 5,
                // One row per courier. Seeded from the schema's own default so a settings
                // document saved before this existed still renders both couriers.
                courier_cod_settlement: (s.courier_cod_settlement?.length
                    ? s.courier_cod_settlement
                    : [{ provider: 'bosta', cod_mode: 'net' }, { provider: 'arrive', cod_mode: 'net' }]
                ).map((r) => ({ provider: r.provider, cod_mode: r.cod_mode === 'gross' ? 'gross' : 'net' })),
            });
        } catch (err) { setError(err.message || 'Failed to load settings'); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); loadCouriers(); }, []);

    const syncSectors = async () => {
        setSyncing(true); setError('');
        try { await adminApi.syncArriveSectors(); await loadCouriers(); }
        catch (err) { setError(err.message || 'Sector sync failed'); }
        finally { setSyncing(false); }
    };

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true); setError('');
        try {
            await adminApi.updateShippingSettings({
                enabled: form.enabled,
                multi_vendor_mode: form.multi_vendor_mode,
                no_zone_behavior: form.no_zone_behavior,
                no_zone_flat_cost: Number(form.no_zone_flat_cost) || 0,
                default_weight_unit: form.default_weight_unit,
                cache_ttl_seconds: Number(form.cache_ttl_seconds) || 0,
                auto_pickup_enabled: form.auto_pickup_enabled,
                default_pickup_time_slot: form.default_pickup_time_slot,
                pickup_batch_threshold: Number(form.pickup_batch_threshold) || 1,
                pickup_cutoff_hour: Number(form.pickup_cutoff_hour) || 16,
                pickup_skip_fridays: form.pickup_skip_fridays,
                smart_label_enabled: form.smart_label_enabled,
                courier_provider: form.courier_provider,
                vendor_action_deadline_hours: Number(form.vendor_action_deadline_hours) || 48,
                vendor_deadline_reminder_hours: Number(form.vendor_deadline_reminder_hours) || 0,
                bundle_low_orders_threshold: Number(form.bundle_low_orders_threshold) || 0,
                bundle_low_days_threshold: Number(form.bundle_low_days_threshold) || 0,
                courier_cod_settlement: form.courier_cod_settlement,
            });
            setSavedAt(Date.now());
        } catch (err) { setError(err.message || 'Failed to save settings'); }
        finally { setSaving(false); }
    };

    if (loading || !form) return <div className="h-40 flex items-center justify-center"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;

    return (
        <div className="max-w-2xl space-y-6 animate-in fade-in duration-300">
            {error && <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">{error}</div>}
            {savedAt > 0 && <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 p-3 rounded-xl text-sm font-bold">{isAr ? 'تم الحفظ.' : 'Settings saved.'}</div>}

            <form onSubmit={submit} className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-white/5 pb-4">
                    <div>
                        <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'تفعيل محرك الشحن' : 'Enable shipping engine'}</p>
                        <p className="text-xs text-zinc-500">{isAr ? 'عند الإيقاف، يكون الشحن مجانياً في كل الطلبات.' : 'When off, shipping is free on all orders.'}</p>
                    </div>
                    <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
                </div>

                {/* ---- Courier ---- */}
                <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <Truck size={16} className="text-marine-primary" />
                        <h3 className="text-sm font-black text-zinc-900 dark:text-white">{isAr ? 'شركة الشحن الافتراضية' : 'Default courier'}</h3>
                    </div>
                    <p className="text-xs text-zinc-500">
                        {isAr
                            ? 'الشحنات الجديدة بتروح للشركة دي، إلا لو الأدمن اختار شركة تانية على الشحنة نفسها من صفحة الطلب. الشحنات اللي اتبعتت خلاص بتفضل مع شركتها.'
                            : 'New parcels go to this courier unless the admin picks a different one on the parcel itself from the order page. Parcels already sent stay with their courier.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {(couriers?.providers || [{ key: 'bosta', label: 'Bosta', label_ar: 'بوسطة', configured: true }, { key: 'arrive', label: 'Arrive', label_ar: 'أرايف', configured: false }]).map((p) => (
                            <button
                                key={p.key}
                                type="button"
                                disabled={p.configured === false}
                                onClick={() => setForm({ ...form, courier_provider: p.key })}
                                className={`px-4 py-2 rounded-xl text-sm font-bold border transition ${
                                    form.courier_provider === p.key
                                        ? 'bg-marine-cyan text-white border-marine-cyan'
                                        : 'border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5'
                                } disabled:opacity-40`}
                            >
                                {isAr ? (p.label_ar || p.label) : p.label}
                                {p.configured === false ? (isAr ? ' — غير مُعدّ' : ' — not configured') : ''}
                            </button>
                        ))}
                    </div>

                    {couriers?.arrive && (
                        <div className="rounded-lg bg-zinc-50 dark:bg-white/5 p-3 space-y-2 text-xs">
                            <p className="font-bold text-zinc-700 dark:text-zinc-200">Arrive</p>
                            <p className="text-zinc-500">
                                {isAr ? 'الحالة: ' : 'Status: '}
                                <b className={couriers.arrive.configured ? 'text-emerald-600' : 'text-red-500'}>
                                    {couriers.arrive.configured ? (isAr ? 'مُعدّ' : 'configured') : (isAr ? 'بيانات الـ API ناقصة' : 'API credentials missing')}
                                </b>
                                {' · '}
                                {isAr ? 'المناطق: ' : 'Areas: '}<b>{couriers.arrive.sectors_count}</b>
                                {couriers.arrive.sectors_synced_at ? ` (${new Date(couriers.arrive.sectors_synced_at).toLocaleDateString(isAr ? 'ar-EG' : 'en-GB')})` : ''}
                                {' '}
                                <button type="button" onClick={syncSectors} disabled={syncing} className="inline-flex items-center gap-1 text-marine-primary font-bold hover:underline disabled:opacity-50">
                                    {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                                    {isAr ? 'تحديث المناطق' : 'Resync areas'}
                                </button>
                            </p>
                            <div>
                                <p className="text-zinc-500 mb-1">{isAr ? 'رابط الـ webhook (ابعته لأرايف عشان يسجلوه):' : 'Webhook URL (give this to Arrive to register):'}</p>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 truncate rounded bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 px-2 py-1 text-[11px]" dir="ltr">{couriers.arrive.webhook_url}</code>
                                    <button type="button" onClick={() => navigator.clipboard?.writeText(couriers.arrive.webhook_url)} className="p-1.5 rounded-lg border border-zinc-200 dark:border-white/10 hover:bg-zinc-100 dark:hover:bg-white/10" title="Copy">
                                        <Copy size={12} />
                                    </button>
                                </div>
                            </div>
                            <p className="text-zinc-500">
                                {isAr
                                    ? 'ملاحظة: أرايف مفيهاش إلغاء ولا حجز مندوب بالـ API؛ الإلغاء بعد الإرسال بيتعمل من بورتال أرايف، والليبل بيتطبع من عندنا.'
                                    : 'Note: Arrive has no cancel or pickup API. A cancellation after dispatch is requested in the Arrive portal, and the label is printed from here.'}
                            </p>
                        </div>
                    )}
                </div>

                <Field label={isAr ? 'وضع تعدد البائعين' : 'Multi-vendor mode'} hint={form.multi_vendor_mode === 'split' ? (isAr ? 'يُحسب الشحن لكل بائع على حدة — يُطبَّق الحد الأدنى/الأقصى لكل بائع (طلب من ٣ بائعين بحد أدنى ٥٠ ⇐ ١٥٠ على الأقل).' : 'Shipping is computed per vendor — min/max fees apply per vendor (a 3-vendor order with min 50 ⇒ at least 150).') : (isAr ? 'تكلفة شحن واحدة لكامل الطلب.' : 'One combined shipping cost for the whole order.')}>
                    <select value={form.multi_vendor_mode} onChange={(e) => setForm({ ...form, multi_vendor_mode: e.target.value })} className={inputCls}>
                        <option value="combined">{isAr ? 'مدمج (تكلفة واحدة)' : 'Combined (single cost)'}</option>
                        <option value="split">{isAr ? 'مقسّم (لكل بائع)' : 'Split (per vendor)'}</option>
                    </select>
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label={isAr ? 'عند عدم تطابق منطقة' : 'When no zone matches'}>
                        <select value={form.no_zone_behavior} onChange={(e) => setForm({ ...form, no_zone_behavior: e.target.value })} className={inputCls}>
                            <option value="free">{isAr ? 'شحن مجاني' : 'Free shipping'}</option>
                            <option value="flat">{isAr ? 'سعر ثابت' : 'Flat fee'}</option>
                            <option value="block">{isAr ? 'منع الطلب' : 'Block checkout'}</option>
                        </select>
                    </Field>
                    {form.no_zone_behavior === 'flat' && (
                        <Field label={isAr ? 'السعر الثابت' : 'Flat fee amount'}><input type="number" step="any" value={form.no_zone_flat_cost} onChange={(e) => setForm({ ...form, no_zone_flat_cost: Number(e.target.value) || 0 })} className={inputCls} /></Field>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label={isAr ? 'وحدة الوزن' : 'Weight unit'}><input value={form.default_weight_unit} disabled className={inputCls + ' opacity-60'} /></Field>
                    <Field label={isAr ? 'مدة صلاحية الكاش (ثواني)' : 'Cache TTL (seconds)'}><input type="number" value={form.cache_ttl_seconds} onChange={(e) => setForm({ ...form, cache_ttl_seconds: Number(e.target.value) || 0 })} className={inputCls} /></Field>
                </div>

                {/* Bosta Pickup Settings */}
                <div className="border-t border-zinc-100 dark:border-white/5 pt-5 space-y-4">
                    <div>
                        <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'إعدادات الاستلام (بوسطة)' : 'Pickup Settings (Bosta)'}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{isAr ? 'تحكم في جدولة استلام الشحنات من البائعين.' : 'Control courier pickup scheduling from vendor locations.'}</p>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-bold text-zinc-900 dark:text-white text-sm">{isAr ? 'الاستلام التلقائي' : 'Auto-pickup scheduling'}</p>
                            <p className="text-xs text-zinc-500">{isAr ? 'عند التفعيل، يتم جدولة الاستلام تلقائياً عند تجهيز الطلب. عند الإيقاف، يجب جدولته يدوياً.' : 'When enabled, pickups auto-schedule when orders go Ready. When disabled, admin schedules manually.'}</p>
                        </div>
                        <Toggle checked={form.auto_pickup_enabled} onChange={(v) => setForm({ ...form, auto_pickup_enabled: v })} />
                    </div>

                    <Field label={isAr ? 'فترة الاستلام الافتراضية' : 'Default pickup time slot'}>
                        <select value={form.default_pickup_time_slot} onChange={(e) => setForm({ ...form, default_pickup_time_slot: e.target.value })} className={inputCls}>
                            <option value="10:00 to 13:00">10:00 - 13:00</option>
                            <option value="13:00 to 16:00">13:00 - 16:00</option>
                        </select>
                    </Field>

                    <Field label={isAr ? 'الحد الأدنى للطلبات قبل جدولة الاستلام' : 'Batch threshold (min orders before pickup)'} hint={isAr ? `لن يتم جدولة الاستلام حتى يصل عدد الطلبات من نفس الفرع إلى ${form.pickup_batch_threshold} طلب.` : `Pickup won't be scheduled until ${form.pickup_batch_threshold} order(s) are ready from the same location.`}>
                        <input type="number" min="1" value={form.pickup_batch_threshold} onChange={(e) => setForm({ ...form, pickup_batch_threshold: Math.max(1, Number(e.target.value) || 1) })} className={inputCls} />
                    </Field>

                    <Field label={isAr ? 'ساعة القطع (التوقيت المصري)' : 'Cutoff hour (Egypt time)'} hint={isAr ? `الطلبات بعد الساعة ${form.pickup_cutoff_hour}:00 لن يتم جدولة استلامها تلقائياً — يجب جدولتها يدوياً لليوم التالي.` : `Orders after ${form.pickup_cutoff_hour}:00 won't auto-schedule — admin must schedule manually for next day.`}>
                        <input type="number" min="0" max="23" value={form.pickup_cutoff_hour} onChange={(e) => setForm({ ...form, pickup_cutoff_hour: Math.min(23, Math.max(0, Number(e.target.value) || 16)) })} className={inputCls} />
                    </Field>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-bold text-zinc-900 dark:text-white text-sm">{isAr ? 'تخطي يوم الجمعة' : 'Skip Fridays'}</p>
                            <p className="text-xs text-zinc-500">{isAr ? 'بوسطة لا تقبل جدولة الاستلام يوم الجمعة. عند التفعيل، يتم الجدولة ليوم السبت بدلاً منه.' : 'Bosta doesn\'t accept Friday pickups. When on, auto-schedules for Saturday instead.'}</p>
                        </div>
                        <Toggle checked={form.pickup_skip_fridays} onChange={(v) => setForm({ ...form, pickup_skip_fridays: v })} />
                    </div>
                </div>

                {/* Smart Label */}
                <div className="border-t border-zinc-100 dark:border-white/5 pt-5 space-y-4">
                    <div>
                        <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'الملصق الذكي' : 'Smart Label'}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            {isAr
                                ? 'التاجر يلزق ملصق بوسطة مطبوع مسبقاً على الطرد ويمسحه، والرقم ده يبقى رقم تتبع الشحنة — من غير طباعة بوليصة.'
                                : 'The vendor sticks a pre-printed Bosta label on the parcel and scans it; that number becomes the shipment tracking number — no waybill to print.'}
                        </p>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-bold text-zinc-900 dark:text-white text-sm">{isAr ? 'تفعيل مسح الملصقات' : 'Enable label scanning'}</p>
                            <p className="text-xs text-zinc-500">
                                {isAr
                                    ? 'اتركه مقفولاً حتى تصل الملصقات فعلاً إلى التجار. عند الإيقاف، تعمل كل الطلبات بالبوليصة المطبوعة كالمعتاد.'
                                    : 'Leave off until the labels are physically with the vendors. When off, every order keeps using the printed waybill as it does today.'}
                            </p>
                        </div>
                        <Toggle checked={form.smart_label_enabled} onChange={(v) => setForm({ ...form, smart_label_enabled: v })} />
                    </div>
                </div>

                {/* Sub-order deadlines. Passing one only FLAGS a late parcel for the order
                    team — nothing is ever auto-cancelled, because a late parcel is still a
                    parcel the customer is waiting for. */}
                <div className="grid sm:grid-cols-2 gap-4">
                    <Field
                        label={isAr ? 'مهلة التاجر لتجهيز الشحنة (ساعات)' : 'Vendor deadline per parcel (hours)'}
                        hint={isAr
                            ? 'من وقت الطلب لحد ما التاجر يقول "جاهز للاستلام". بعد المهلة الشحنة بتتعلّم متأخرة في طابور الأدمن — مفيش إلغاء تلقائي.'
                            : 'From when the order is placed until the vendor marks the parcel ready. Passing it only flags the parcel in the admin queue — nothing is auto-cancelled.'}
                    >
                        <input
                            type="number" min="1"
                            value={form.vendor_action_deadline_hours}
                            onChange={(e) => setForm({ ...form, vendor_action_deadline_hours: e.target.value })}
                            className={inputCls}
                        />
                    </Field>
                    <Field
                        label={isAr ? 'التذكير قبل المهلة بـ (ساعات)' : 'Remind the vendor this many hours before'}
                        hint={isAr ? 'صفر = مفيش تذكير.' : 'Zero disables the reminder.'}
                    >
                        <input
                            type="number" min="0"
                            value={form.vendor_deadline_reminder_hours}
                            onChange={(e) => setForm({ ...form, vendor_deadline_reminder_hours: e.target.value })}
                            className={inputCls}
                        />
                    </Field>
                </div>

                {/* Bundle warnings. Both ends of a prepaid bundle cost money — running out
                    stops shipping, and expiring throws away whatever is left on it — so each
                    gets its own threshold rather than one shared "warn me soon". */}
                <div className="pt-4 border-t border-zinc-100 dark:border-white/5">
                    <p className="font-bold text-zinc-900 dark:text-white mb-1">
                        {isAr ? 'تنبيهات باقة بوسطة' : 'Bosta bundle alerts'}
                    </p>
                    <p className="text-xs text-zinc-500 mb-4">
                        {isAr
                            ? 'بيوصل تنبيه لكل أدمن. الشحنات اللي فاضلة في الباقة بتضيع لو خلصت مدتها — مش بتترحّل للباقة الجاية.'
                            : 'Every admin is notified. Parcels left on a bundle are lost when it expires — they do not carry over.'}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-4">
                        <Field
                            label={isAr ? 'نبّهني لما يفضل عدد شحنات' : 'Warn me at this many parcels left'}
                            hint={isAr ? 'صفر = مفيش تنبيه.' : 'Zero disables it.'}
                        >
                            <input
                                type="number" min="0"
                                value={form.bundle_low_orders_threshold}
                                onChange={(e) => setForm({ ...form, bundle_low_orders_threshold: e.target.value })}
                                className={inputCls}
                            />
                        </Field>
                        <Field
                            label={isAr ? 'نبّهني قبل انتهاء الباقة بـ (أيام)' : 'Warn me this many days before it expires'}
                            hint={isAr ? 'صفر = مفيش تنبيه.' : 'Zero disables it.'}
                        >
                            <input
                                type="number" min="0"
                                value={form.bundle_low_days_threshold}
                                onChange={(e) => setForm({ ...form, bundle_low_days_threshold: e.target.value })}
                                className={inputCls}
                            />
                        </Field>
                    </div>
                </div>

                {/* How each courier settles COD. The money screen cannot guess this, and
                    guessing wrong misstates what every cash order is owed. */}
                <div className="pt-4 border-t border-zinc-100 dark:border-white/5">
                    <p className="font-bold text-zinc-900 dark:text-white mb-1">
                        {isAr ? 'تحويل فلوس الدفع عند الاستلام' : 'How couriers settle COD'}
                    </p>
                    <p className="text-xs text-zinc-500 mb-4">
                        {isAr
                            ? 'ده اللي بيحدد المستحق لك في صفحة المالية ← شركات الشحن.'
                            : 'This decides what Finance → Couriers reports as owed to you.'}
                    </p>
                    <div className="space-y-3">
                        {(form.courier_cod_settlement || []).map((row, i) => (
                            <div key={row.provider} className="flex items-center justify-between gap-3 flex-wrap">
                                <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200 capitalize">{row.provider}</span>
                                <select
                                    value={row.cod_mode}
                                    onChange={(e) => {
                                        const next = [...form.courier_cod_settlement];
                                        next[i] = { ...row, cod_mode: e.target.value };
                                        setForm({ ...form, courier_cod_settlement: next });
                                    }}
                                    className={inputCls}
                                >
                                    <option value="net">{isAr ? 'بيخصم رسومه ويحوّل الباقي' : 'Deducts its fees, transfers the rest'}</option>
                                    <option value="gross">{isAr ? 'بيحوّل التحصيل كامل وبيبعت فاتورة' : 'Transfers everything, invoices separately'}</option>
                                </select>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end pt-2">
                    <PrimaryButton type="submit" loading={saving}>{!saving && <Save size={16} />} {isAr ? 'حفظ الإعدادات' : 'Save Settings'}</PrimaryButton>
                </div>
            </form>
        </div>
    );
}
