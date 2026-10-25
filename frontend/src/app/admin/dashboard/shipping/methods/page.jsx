'use client';

import { useEffect, useMemo, useState } from 'react';
import { Package, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import { Field, Toggle, StatCard, Modal, ModalFooter, RowsEditor, RuleBuilder, inputCls, PrimaryButton } from '../../../../../components/dashboard/shipping/ShippingUI';

const TYPES = [
    { value: 'flat', en: 'Flat rate', ar: 'سعر ثابت' },
    { value: 'weight_tier', en: 'Weight-based tiers', ar: 'شرائح حسب الوزن' },
    { value: 'class_based', en: 'Class-based', ar: 'حسب فئة الشحن' },
    { value: 'rule_engine', en: 'Rule engine (advanced)', ar: 'محرك القواعد (متقدم)' },
];

const emptyForm = () => ({
    zone_id: '', name: '', name_ar: '', type: 'flat', is_active: true, sort_order: 0,
    delivery_time_min_days: '', delivery_time_max_days: '', base_cost: 0, min_fee: 0, max_fee: '',
    flat_config: { per_item_cost: 0, per_vendor_cost: 0 },
    weight_config: { tiers: [{ min_weight: 0, max_weight: '', cost: 0 }] },
    class_config: { default_class_cost: 0, class_rates: [] },
    rule_config: { rules: [] },
});

export default function ShippingMethodsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    const [methods, setMethods] = useState([]);
    const [zones, setZones] = useState([]);
    const [classes, setClasses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState('');
    const [zoneFilter, setZoneFilter] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState('');
    const [form, setForm] = useState(emptyForm());

    const load = async () => {
        setLoading(true);
        try {
            const [m, z, c] = await Promise.all([adminApi.getShippingMethods(), adminApi.getShippingZones(), adminApi.getShippingClasses()]);
            setMethods(m.methods || []);
            setZones(z.zones || []);
            setClasses(c.classes || []);
        } catch (err) { setError(err.message || 'Failed to load methods'); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => zoneFilter ? methods.filter((m) => String(m.zone_id?._id || m.zone_id) === zoneFilter) : methods, [methods, zoneFilter]);

    const openAdd = () => { setEditingId(''); setForm(emptyForm()); setShowModal(true); };
    const openEdit = (m) => {
        setEditingId(m._id);
        const f = emptyForm();
        setForm({
            ...f,
            zone_id: String(m.zone_id?._id || m.zone_id || ''),
            name: m.name || '', name_ar: m.name_ar || '', type: m.type || 'flat', is_active: m.is_active !== false, sort_order: m.sort_order || 0,
            delivery_time_min_days: m.delivery_time_min_days ?? '', delivery_time_max_days: m.delivery_time_max_days ?? '',
            base_cost: m.base_cost || 0, min_fee: m.min_fee || 0, max_fee: m.max_fee ?? '',
            flat_config: { per_item_cost: m.flat_config?.per_item_cost || 0, per_vendor_cost: m.flat_config?.per_vendor_cost || 0 },
            weight_config: { tiers: (m.weight_config?.tiers || [{ min_weight: 0, max_weight: '', cost: 0 }]).map((t) => ({ min_weight: t.min_weight ?? 0, max_weight: t.max_weight ?? '', cost: t.cost ?? 0 })) },
            class_config: { default_class_cost: m.class_config?.default_class_cost || 0, class_rates: (m.class_config?.class_rates || []).map((r) => ({ shipping_class_id: String(r.shipping_class_id), cost: r.cost || 0, handling_fee: r.handling_fee || 0, surcharge_percent: r.surcharge_percent || 0 })) },
            rule_config: { rules: (m.rule_config?.rules || []).map((r) => ({ ...r })) },
        });
        setShowModal(true);
    };
    const closeModal = () => { setShowModal(false); setEditingId(''); setForm(emptyForm()); };

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true); setError('');
        try {
            const payload = {
                zone_id: form.zone_id,
                name: form.name.trim(), name_ar: form.name_ar.trim(), type: form.type, is_active: form.is_active, sort_order: Number(form.sort_order) || 0,
                delivery_time_min_days: form.delivery_time_min_days === '' ? null : Number(form.delivery_time_min_days),
                delivery_time_max_days: form.delivery_time_max_days === '' ? null : Number(form.delivery_time_max_days),
                base_cost: Number(form.base_cost) || 0, min_fee: Number(form.min_fee) || 0, max_fee: form.max_fee === '' ? null : Number(form.max_fee),
            };
            if (form.type === 'flat') payload.flat_config = { per_item_cost: Number(form.flat_config.per_item_cost) || 0, per_vendor_cost: Number(form.flat_config.per_vendor_cost) || 0 };
            else if (form.type === 'weight_tier') payload.weight_config = { tiers: form.weight_config.tiers.map((t) => ({ min_weight: Number(t.min_weight) || 0, max_weight: t.max_weight === '' || t.max_weight === null ? null : Number(t.max_weight), cost: Number(t.cost) || 0 })) };
            else if (form.type === 'class_based') payload.class_config = { default_class_cost: Number(form.class_config.default_class_cost) || 0, class_rates: form.class_config.class_rates.filter((r) => r.shipping_class_id).map((r) => ({ shipping_class_id: r.shipping_class_id, cost: Number(r.cost) || 0, handling_fee: Number(r.handling_fee) || 0, surcharge_percent: Number(r.surcharge_percent) || 0 })) };
            else if (form.type === 'rule_engine') payload.rule_config = { rules: form.rule_config.rules };

            if (editingId) await adminApi.updateShippingMethod(editingId, payload);
            else await adminApi.addShippingMethod(payload);
            closeModal(); await load();
        } catch (err) { setError(err.message || 'Failed to save method'); }
        finally { setSaving(false); }
    };

    const removeMethod = async (m) => {
        if (!confirm(isAr ? 'حذف طريقة الشحن هذه؟' : 'Delete this shipping method?')) return;
        setDeletingId(m._id); setError('');
        try { await adminApi.deleteShippingMethod(m._id); await load(); }
        catch (err) { setError(err.message || 'Failed to delete method'); }
        finally { setDeletingId(''); }
    };

    const classOptions = classes.filter((c) => c.is_active !== false);
    const typeLabel = (t) => { const x = TYPES.find((y) => y.value === t); return x ? (isAr ? x.ar : x.en) : t; };

    if (loading) return <div className="h-40 flex items-center justify-center"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                    <StatCard icon={Package} label={isAr ? 'إجمالي الطرق' : 'Total Methods'} value={methods.length} />
                    <StatCard icon={Package} label={isAr ? 'الطرق النشطة' : 'Active Methods'} value={methods.filter((m) => m.is_active !== false).length} tone="green" />
                </div>
                <div className="flex items-center gap-3">
                    <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} className={inputCls + ' w-auto'}>
                        <option value="">{isAr ? 'كل المناطق' : 'All zones'}</option>
                        {zones.map((z) => <option key={z._id} value={z._id}>{z.name}</option>)}
                    </select>
                    <PrimaryButton onClick={openAdd}><Plus size={18} /> {isAr ? 'إضافة طريقة' : 'Add Method'}</PrimaryButton>
                </div>
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">{error}</div>}
            {zones.length === 0 && <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 p-3 rounded-xl text-sm">{isAr ? 'أنشئ منطقة شحن أولاً.' : 'Create a shipping zone first.'}</div>}

            <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm divide-y divide-zinc-100 dark:divide-white/5">
                {filtered.length === 0 ? (
                    <div className="px-6 py-14 text-center"><Package size={36} className="mx-auto text-zinc-300 mb-3" /><p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد طرق شحن' : 'No shipping methods'}</p></div>
                ) : filtered.map((m) => (
                    <div key={m._id} className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4">
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h3 className="font-black text-zinc-900 dark:text-white">{isAr ? (m.name_ar || m.name) : m.name}</h3>
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-sky-500/10 text-sky-500 rounded-full uppercase">{typeLabel(m.type)}</span>
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-zinc-100 dark:bg-white/10 text-zinc-500 rounded-full">{m.zone_id?.name || ''}</span>
                                {m.is_active === false && <span className="px-2 py-0.5 text-[10px] font-bold bg-zinc-100 dark:bg-white/10 text-zinc-500 rounded-full uppercase">{isAr ? 'معطّل' : 'Disabled'}</span>}
                            </div>
                            <p className="text-xs text-zinc-500">
                                {isAr ? 'التكلفة الأساسية: ' : 'Base: '}{m.base_cost || 0}
                                {!!m.min_fee && ` · ${isAr ? 'حد أدنى' : 'min'} ${m.min_fee}`}
                                {m.max_fee != null && ` · ${isAr ? 'حد أقصى' : 'max'} ${m.max_fee}`}
                                {(m.delivery_time_min_days != null || m.delivery_time_max_days != null) && ` · ${m.delivery_time_min_days ?? ''}–${m.delivery_time_max_days ?? ''} ${isAr ? 'يوم' : 'days'}`}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => openEdit(m)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300"><Pencil size={13} /> {isAr ? 'تعديل' : 'Edit'}</button>
                            <button onClick={() => removeMethod(m)} disabled={deletingId === m._id} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50">{deletingId === m._id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {isAr ? 'حذف' : 'Delete'}</button>
                        </div>
                    </div>
                ))}
            </div>

            {showModal && (
                <Modal title={editingId ? (isAr ? 'تعديل طريقة شحن' : 'Edit Shipping Method') : (isAr ? 'إضافة طريقة شحن' : 'Add Shipping Method')} onClose={closeModal} wide>
                    <form onSubmit={submit} className="p-5 space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <Field label={isAr ? 'المنطقة' : 'Zone'} required>
                                <select required value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value })} className={inputCls}>
                                    <option value="">{isAr ? '— اختر —' : '— select —'}</option>
                                    {zones.map((z) => <option key={z._id} value={z._id}>{z.name}</option>)}
                                </select>
                            </Field>
                            <Field label={isAr ? 'الاسم' : 'Name'} required><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
                            <Field label={isAr ? 'الاسم بالعربية' : 'Arabic Name'}><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className={inputCls} /></Field>
                            <Field label={isAr ? 'النوع' : 'Type'} required>
                                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>
                                    {TYPES.map((t) => <option key={t.value} value={t.value}>{isAr ? t.ar : t.en}</option>)}
                                </select>
                            </Field>
                            <Field label={isAr ? 'ترتيب العرض' : 'Sort Order'}><input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} className={inputCls} /></Field>
                            <div className="flex items-end pb-2"><Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label={isAr ? 'مفعّل' : 'Active'} /></div>
                            <Field label={isAr ? 'التكلفة الأساسية' : 'Base Cost'}><input type="number" step="any" value={form.base_cost} onChange={(e) => setForm({ ...form, base_cost: Number(e.target.value) || 0 })} className={inputCls} /></Field>
                            <Field label={isAr ? 'الحد الأدنى للرسوم' : 'Minimum Fee'}><input type="number" step="any" value={form.min_fee} onChange={(e) => setForm({ ...form, min_fee: Number(e.target.value) || 0 })} className={inputCls} /></Field>
                            <Field label={isAr ? 'الحد الأقصى للرسوم' : 'Maximum Fee'} hint={isAr ? 'فارغ = بلا حد' : 'blank = no cap'}><input type="number" step="any" value={form.max_fee} onChange={(e) => setForm({ ...form, max_fee: e.target.value })} className={inputCls} /></Field>
                            <Field label={isAr ? 'مدة التوصيل (الأدنى، أيام)' : 'Delivery time min (days)'}><input type="number" value={form.delivery_time_min_days} onChange={(e) => setForm({ ...form, delivery_time_min_days: e.target.value })} className={inputCls} /></Field>
                            <Field label={isAr ? 'مدة التوصيل (الأقصى، أيام)' : 'Delivery time max (days)'}><input type="number" value={form.delivery_time_max_days} onChange={(e) => setForm({ ...form, delivery_time_max_days: e.target.value })} className={inputCls} /></Field>
                        </div>

                        <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 space-y-3">
                            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'إعدادات النوع' : 'Type configuration'}</p>

                            {form.type === 'flat' && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <Field label={isAr ? 'تكلفة لكل عنصر' : 'Per item cost'}><input type="number" step="any" value={form.flat_config.per_item_cost} onChange={(e) => setForm({ ...form, flat_config: { ...form.flat_config, per_item_cost: Number(e.target.value) || 0 } })} className={inputCls} /></Field>
                                    <Field label={isAr ? 'تكلفة لكل بائع' : 'Per vendor cost'} hint={isAr ? 'في وضع التقسيم تُطبَّق لكل بائع' : 'In split mode this applies per vendor'}><input type="number" step="any" value={form.flat_config.per_vendor_cost} onChange={(e) => setForm({ ...form, flat_config: { ...form.flat_config, per_vendor_cost: Number(e.target.value) || 0 } })} className={inputCls} /></Field>
                                </div>
                            )}

                            {form.type === 'weight_tier' && (
                                <div>
                                    <p className="text-[11px] text-zinc-400 mb-2">{isAr ? 'يجب أن تبدأ الشرائح من 0، متصلة، وآخر شريحة بلا حد أقصى (فارغ).' : 'Tiers must start at 0, be contiguous, and the last tier must be open-ended (blank max).'}</p>
                                    <RowsEditor
                                        rows={form.weight_config.tiers}
                                        onChange={(tiers) => setForm({ ...form, weight_config: { tiers } })}
                                        blank={() => ({ min_weight: 0, max_weight: '', cost: 0 })}
                                        addLabel={isAr ? 'إضافة شريحة' : 'Add tier'}
                                        isAr={isAr}
                                        renderRow={(row, idx, update) => (
                                            <>
                                                <Field label={isAr ? 'من (كجم)' : 'From (kg)'}><input type="number" step="any" value={row.min_weight} onChange={(e) => update({ min_weight: Number(e.target.value) || 0 })} className={inputCls} /></Field>
                                                <Field label={isAr ? 'إلى (كجم)' : 'To (kg)'}><input type="number" step="any" value={row.max_weight} onChange={(e) => update({ max_weight: e.target.value })} className={inputCls} placeholder="∞" /></Field>
                                                <Field label={isAr ? 'التكلفة' : 'Cost'}><input type="number" step="any" value={row.cost} onChange={(e) => update({ cost: Number(e.target.value) || 0 })} className={inputCls} /></Field>
                                            </>
                                        )}
                                    />
                                </div>
                            )}

                            {form.type === 'class_based' && (
                                <div className="space-y-3">
                                    <Field label={isAr ? 'تكلفة الفئة الافتراضية' : 'Default class cost'} hint={isAr ? 'تُطبَّق مرة واحدة إذا احتوت السلة على منتج بدون فئة' : 'Applied once if the cart has any product without a class'} className="max-w-xs"><input type="number" step="any" value={form.class_config.default_class_cost} onChange={(e) => setForm({ ...form, class_config: { ...form.class_config, default_class_cost: Number(e.target.value) || 0 } })} className={inputCls} /></Field>
                                    <RowsEditor
                                        rows={form.class_config.class_rates}
                                        onChange={(class_rates) => setForm({ ...form, class_config: { ...form.class_config, class_rates } })}
                                        blank={() => ({ shipping_class_id: '', cost: 0, handling_fee: 0, surcharge_percent: 0 })}
                                        addLabel={isAr ? 'إضافة سعر فئة' : 'Add class rate'}
                                        isAr={isAr}
                                        renderRow={(row, idx, update) => (
                                            <>
                                                <Field label={isAr ? 'الفئة' : 'Class'}>
                                                    <select value={row.shipping_class_id} onChange={(e) => update({ shipping_class_id: e.target.value })} className={inputCls}>
                                                        <option value="">{isAr ? '— اختر —' : '— select —'}</option>
                                                        {classOptions.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                                                    </select>
                                                </Field>
                                                <Field label={isAr ? 'التكلفة' : 'Cost'}><input type="number" step="any" value={row.cost} onChange={(e) => update({ cost: Number(e.target.value) || 0 })} className={inputCls} /></Field>
                                                <Field label={isAr ? 'رسوم المناولة' : 'Handling fee'}><input type="number" step="any" value={row.handling_fee} onChange={(e) => update({ handling_fee: Number(e.target.value) || 0 })} className={inputCls} /></Field>
                                                <Field label={isAr ? 'رسوم إضافية %' : 'Surcharge %'}><input type="number" step="any" value={row.surcharge_percent} onChange={(e) => update({ surcharge_percent: Number(e.target.value) || 0 })} className={inputCls} /></Field>
                                            </>
                                        )}
                                    />
                                </div>
                            )}

                            {form.type === 'rule_engine' && (
                                <RuleBuilder
                                    rules={form.rule_config.rules}
                                    onChange={(rules) => setForm({ ...form, rule_config: { rules } })}
                                    lookups={{ classes: classOptions.map((c) => ({ _id: c._id, label: c.name })) }}
                                    isAr={isAr}
                                />
                            )}
                        </div>

                        <ModalFooter onClose={closeModal} saving={saving} isAr={isAr} />
                    </form>
                </Modal>
            )}
        </div>
    );
}
