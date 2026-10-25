'use client';

import { useEffect, useState } from 'react';
import { ScrollText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import { Field, Toggle, StatCard, Modal, ModalFooter, ConditionRows, ActionRows, inputCls, PrimaryButton } from '../../../../../components/dashboard/shipping/ShippingUI';

const emptyForm = () => ({
    name: '', name_ar: '', is_active: true, priority: 0, scope: 'global', zone_id: '',
    applies_to: { shipping_class_ids: [], vendor_ids: [], category_ids: [] },
    condition_logic: 'all', conditions: [], actions: [{ type: 'free_shipping', value: 0 }],
});

function MultiSelect({ label, options, value, onChange, isAr }) {
    return (
        <Field label={label}>
            <select
                multiple
                value={value}
                onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
                className={inputCls + ' h-28'}
            >
                {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <span className="block text-[11px] text-zinc-400 mt-1">{isAr ? 'Ctrl/⌘ + نقر للاختيار المتعدد. فارغ = الكل.' : 'Ctrl/⌘ + click to multi-select. Empty = all.'}</span>
        </Field>
    );
}

export default function ShippingPoliciesPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    const [policies, setPolicies] = useState([]);
    const [zones, setZones] = useState([]);
    const [classes, setClasses] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState('');
    const [form, setForm] = useState(emptyForm());

    const load = async () => {
        setLoading(true);
        try {
            const [p, z, c, v, cat] = await Promise.all([
                adminApi.getShippingPolicies(), adminApi.getShippingZones(), adminApi.getShippingClasses(),
                adminApi.getVendorsForFilter().catch(() => []), adminApi.getCategoriesAdmin().catch(() => ({ categories: [] })),
            ]);
            setPolicies(p.policies || []);
            setZones(z.zones || []);
            setClasses(c.classes || []);
            setVendors(Array.isArray(v) ? v : (v.vendors || []));
            setCategories((cat.categories || []));
        } catch (err) { setError(err.message || 'Failed to load policies'); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const openAdd = () => { setEditingId(''); setForm(emptyForm()); setShowModal(true); };
    const openEdit = (p) => {
        setEditingId(p._id);
        setForm({
            name: p.name || '', name_ar: p.name_ar || '', is_active: p.is_active !== false, priority: p.priority || 0,
            scope: p.scope || 'global', zone_id: String(p.zone_id?._id || p.zone_id || ''),
            applies_to: {
                shipping_class_ids: (p.applies_to?.shipping_class_ids || []).map(String),
                vendor_ids: (p.applies_to?.vendor_ids || []).map(String),
                category_ids: (p.applies_to?.category_ids || []).map(String),
            },
            condition_logic: p.condition_logic || 'all',
            conditions: (p.conditions || []).map((c) => ({ ...c })),
            actions: (p.actions || []).map((a) => ({ ...a })),
        });
        setShowModal(true);
    };
    const closeModal = () => { setShowModal(false); setEditingId(''); setForm(emptyForm()); };

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true); setError('');
        try {
            const payload = {
                name: form.name.trim(), name_ar: form.name_ar.trim(), is_active: form.is_active, priority: Number(form.priority) || 0,
                scope: form.scope, zone_id: form.scope === 'zone' ? (form.zone_id || null) : null,
                applies_to: form.applies_to,
                condition_logic: form.condition_logic, conditions: form.conditions, actions: form.actions,
            };
            if (editingId) await adminApi.updateShippingPolicy(editingId, payload);
            else await adminApi.addShippingPolicy(payload);
            closeModal(); await load();
        } catch (err) { setError(err.message || 'Failed to save policy'); }
        finally { setSaving(false); }
    };

    const removePolicy = async (p) => {
        if (!confirm(isAr ? 'حذف هذه السياسة؟' : 'Delete this policy?')) return;
        setDeletingId(p._id); setError('');
        try { await adminApi.deleteShippingPolicy(p._id); await load(); }
        catch (err) { setError(err.message || 'Failed to delete policy'); }
        finally { setDeletingId(''); }
    };

    const classOpts = classes.filter((c) => c.is_active !== false).map((c) => ({ id: c._id, label: c.name }));
    const vendorOpts = vendors.map((v) => ({ id: v._id, label: v.store_name || v.store_username || v._id }));
    const categoryOpts = categories.map((c) => ({ id: c._id, label: c.name }));

    if (loading) return <div className="h-40 flex items-center justify-center"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                    <StatCard icon={ScrollText} label={isAr ? 'إجمالي السياسات' : 'Total Policies'} value={policies.length} />
                    <StatCard icon={ScrollText} label={isAr ? 'السياسات النشطة' : 'Active Policies'} value={policies.filter((p) => p.is_active !== false).length} tone="green" />
                </div>
                <PrimaryButton onClick={openAdd}><Plus size={18} /> {isAr ? 'إضافة سياسة' : 'Add Policy'}</PrimaryButton>
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">{error}</div>}
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 p-3 rounded-xl text-xs">
                {isAr ? 'تُطبَّق السياسات بعد حساب التكلفة الأساسية لطريقة الشحن المختارة، بترتيب الأولوية (الأقل أولاً). انتبه عند تعارض سياسة شحن مجاني مع سياسة رسوم إضافية لاحقة.' : 'Policies run after the chosen method computes its base cost, in priority order (lowest first). Watch for a free-shipping policy followed by a later surcharge policy.'}
            </div>

            <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm divide-y divide-zinc-100 dark:divide-white/5">
                {policies.length === 0 ? (
                    <div className="px-6 py-14 text-center"><ScrollText size={36} className="mx-auto text-zinc-300 mb-3" /><p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد سياسات' : 'No policies yet'}</p></div>
                ) : policies.map((p) => (
                    <div key={p._id} className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4">
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h3 className="font-black text-zinc-900 dark:text-white">{isAr ? (p.name_ar || p.name) : p.name}</h3>
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-zinc-100 dark:bg-white/10 text-zinc-500 rounded-full uppercase">{p.scope === 'zone' ? (p.zone_id?.name || (isAr ? 'منطقة' : 'zone')) : (isAr ? 'عام' : 'global')}</span>
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-marine-cyan/10 text-marine-primary rounded-full">{isAr ? 'أولوية: ' : 'Priority: '}{p.priority || 0}</span>
                                {p.is_active === false && <span className="px-2 py-0.5 text-[10px] font-bold bg-zinc-100 dark:bg-white/10 text-zinc-500 rounded-full uppercase">{isAr ? 'معطّل' : 'Disabled'}</span>}
                            </div>
                            <p className="text-xs text-zinc-500">{(p.actions || []).map((a) => `${a.type}${a.value ? '=' + a.value : ''}${a.threshold ? ' @>' + a.threshold : ''}`).join(', ') || (isAr ? 'لا توجد إجراءات' : 'no actions')}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => openEdit(p)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300"><Pencil size={13} /> {isAr ? 'تعديل' : 'Edit'}</button>
                            <button onClick={() => removePolicy(p)} disabled={deletingId === p._id} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50">{deletingId === p._id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {isAr ? 'حذف' : 'Delete'}</button>
                        </div>
                    </div>
                ))}
            </div>

            {showModal && (
                <Modal title={editingId ? (isAr ? 'تعديل سياسة' : 'Edit Policy') : (isAr ? 'إضافة سياسة' : 'Add Policy')} onClose={closeModal} wide>
                    <form onSubmit={submit} className="p-5 space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <Field label={isAr ? 'الاسم' : 'Name'} required><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
                            <Field label={isAr ? 'الاسم بالعربية' : 'Arabic Name'}><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className={inputCls} /></Field>
                            <Field label={isAr ? 'الأولوية' : 'Priority'}><input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })} className={inputCls} /></Field>
                            <Field label={isAr ? 'النطاق' : 'Scope'}>
                                <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} className={inputCls}>
                                    <option value="global">{isAr ? 'عام (كل المناطق)' : 'Global (all zones)'}</option>
                                    <option value="zone">{isAr ? 'منطقة محددة' : 'Specific zone'}</option>
                                </select>
                            </Field>
                            {form.scope === 'zone' && (
                                <Field label={isAr ? 'المنطقة' : 'Zone'} required>
                                    <select required value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value })} className={inputCls}>
                                        <option value="">{isAr ? '— اختر —' : '— select —'}</option>
                                        {zones.map((z) => <option key={z._id} value={z._id}>{z.name}</option>)}
                                    </select>
                                </Field>
                            )}
                            <div className="flex items-end pb-2"><Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label={isAr ? 'مفعّل' : 'Active'} /></div>
                        </div>

                        <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 space-y-3">
                            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'ينطبق على (اختياري)' : 'Applies to (optional filters)'}</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <MultiSelect label={isAr ? 'فئات الشحن' : 'Shipping classes'} options={classOpts} value={form.applies_to.shipping_class_ids} onChange={(v) => setForm({ ...form, applies_to: { ...form.applies_to, shipping_class_ids: v } })} isAr={isAr} />
                                <MultiSelect label={isAr ? 'التجار' : 'Vendors'} options={vendorOpts} value={form.applies_to.vendor_ids} onChange={(v) => setForm({ ...form, applies_to: { ...form.applies_to, vendor_ids: v } })} isAr={isAr} />
                                <MultiSelect label={isAr ? 'التصنيفات' : 'Categories'} options={categoryOpts} value={form.applies_to.category_ids} onChange={(v) => setForm({ ...form, applies_to: { ...form.applies_to, category_ids: v } })} isAr={isAr} />
                            </div>
                        </div>

                        <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'الشروط' : 'Conditions'}</p>
                                <select value={form.condition_logic} onChange={(e) => setForm({ ...form, condition_logic: e.target.value })} className={inputCls + ' w-auto py-1.5'}>
                                    <option value="all">{isAr ? 'مطابقة الكل' : 'Match ALL'}</option>
                                    <option value="any">{isAr ? 'مطابقة أي' : 'Match ANY'}</option>
                                </select>
                            </div>
                            <ConditionRows conditions={form.conditions} onChange={(c) => setForm({ ...form, conditions: c })} lookups={{ classes: classOpts.map((o) => ({ _id: o.id, label: o.label })), categories: categoryOpts.map((o) => ({ _id: o.id, label: o.label })), vendors: vendorOpts.map((o) => ({ _id: o.id, label: o.label })) }} isAr={isAr} />
                        </div>

                        <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 space-y-3">
                            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'الإجراءات' : 'Actions'}</p>
                            <ActionRows actions={form.actions} onChange={(a) => setForm({ ...form, actions: a })} kind="policy" isAr={isAr} />
                        </div>

                        <ModalFooter onClose={closeModal} saving={saving} isAr={isAr} />
                    </form>
                </Modal>
            )}
        </div>
    );
}
