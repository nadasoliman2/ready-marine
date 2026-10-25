'use client';

import { useEffect, useState } from 'react';
import { Globe2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import { Field, Toggle, StatCard, Modal, ModalFooter, RowsEditor, inputCls, PrimaryButton } from '../../../../../components/dashboard/shipping/ShippingUI';

const emptyForm = { name: '', name_ar: '', is_active: true, priority: 0, locations: [] };

export default function ShippingZonesPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    const [zones, setZones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState('');
    const [form, setForm] = useState(emptyForm);

    const load = async () => {
        setLoading(true);
        try {
            const data = await adminApi.getShippingZones();
            setZones(data.zones || []);
        } catch (err) {
            setError(err.message || 'Failed to load zones');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const openAdd = () => { setEditingId(''); setForm(emptyForm); setShowModal(true); };
    const openEdit = (z) => {
        setEditingId(z._id);
        setForm({
            name: z.name || '', name_ar: z.name_ar || '', is_active: z.is_active !== false, priority: z.priority || 0,
            locations: (z.locations || []).map((l) => ({ country: l.country || '', country_ar: l.country_ar || '', city: l.city || '', city_ar: l.city_ar || '' })),
        });
        setShowModal(true);
    };
    const closeModal = () => { setShowModal(false); setEditingId(''); setForm(emptyForm); };

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true); setError('');
        try {
            const payload = {
                name: form.name.trim(),
                name_ar: form.name_ar.trim(),
                is_active: form.is_active,
                priority: Number(form.priority) || 0,
                locations: form.locations
                    .filter((l) => l.country && l.country.trim())
                    .map((l) => ({ country: l.country.trim(), country_ar: (l.country_ar || '').trim(), city: (l.city || '').trim() || null, city_ar: (l.city_ar || '').trim() })),
            };
            if (editingId) await adminApi.updateShippingZone(editingId, payload);
            else await adminApi.addShippingZone(payload);
            closeModal();
            await load();
        } catch (err) {
            setError(err.message || 'Failed to save zone');
        } finally {
            setSaving(false);
        }
    };

    const removeZone = async (z) => {
        if (!confirm(isAr ? 'حذف هذه المنطقة؟' : 'Delete this zone?')) return;
        setDeletingId(z._id); setError('');
        try { await adminApi.deleteShippingZone(z._id); await load(); }
        catch (err) { setError(err.message || 'Failed to delete zone'); }
        finally { setDeletingId(''); }
    };

    if (loading) return <div className="h-40 flex items-center justify-center"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                    <StatCard icon={Globe2} label={isAr ? 'إجمالي المناطق' : 'Total Zones'} value={zones.length} />
                    <StatCard icon={Globe2} label={isAr ? 'المناطق النشطة' : 'Active Zones'} value={zones.filter((z) => z.is_active !== false).length} tone="green" />
                </div>
                <PrimaryButton onClick={openAdd}><Plus size={18} /> {isAr ? 'إضافة منطقة' : 'Add Zone'}</PrimaryButton>
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">{error}</div>}

            <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm divide-y divide-zinc-100 dark:divide-white/5">
                {zones.length === 0 ? (
                    <div className="px-6 py-14 text-center"><Globe2 size={36} className="mx-auto text-zinc-300 mb-3" /><p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد مناطق' : 'No zones yet'}</p></div>
                ) : zones.map((z) => (
                    <div key={z._id} className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4">
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h3 className="font-black text-zinc-900 dark:text-white">{isAr ? (z.name_ar || z.name) : z.name}</h3>
                                {z.is_active === false && <span className="px-2 py-0.5 text-[10px] font-bold bg-zinc-100 dark:bg-white/10 text-zinc-500 rounded-full uppercase">{isAr ? 'معطّل' : 'Disabled'}</span>}
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-marine-cyan/10 text-marine-primary rounded-full">{isAr ? 'أولوية: ' : 'Priority: '}{z.priority || 0}</span>
                            </div>
                            <p className="text-xs text-zinc-500">
                                {(z.locations || []).map((l) => `${l.country}${l.city ? ' / ' + l.city : ` (${isAr ? 'كل الدولة' : 'whole country'})`}`).join(' · ') || (isAr ? 'لا توجد مواقع' : 'No locations')}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => openEdit(z)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300"><Pencil size={13} /> {isAr ? 'تعديل' : 'Edit'}</button>
                            <button onClick={() => removeZone(z)} disabled={deletingId === z._id} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50">{deletingId === z._id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {isAr ? 'حذف' : 'Delete'}</button>
                        </div>
                    </div>
                ))}
            </div>

            {showModal && (
                <Modal title={editingId ? (isAr ? 'تعديل منطقة' : 'Edit Zone') : (isAr ? 'إضافة منطقة' : 'Add Zone')} onClose={closeModal} wide>
                    <form onSubmit={submit} className="p-5 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field label={isAr ? 'الاسم' : 'Name'} required><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
                            <Field label={isAr ? 'الاسم بالعربية' : 'Arabic Name'}><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className={inputCls} /></Field>
                            <Field label={isAr ? 'الأولوية' : 'Priority'} hint={isAr ? 'الأقل يفوز عند التداخل' : 'Lower wins on overlap'}><input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })} className={inputCls} /></Field>
                            <div className="flex items-end pb-2"><Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label={isAr ? 'مفعّل' : 'Active'} /></div>
                        </div>
                        <div>
                            <p className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">{isAr ? 'المواقع المغطاة' : 'Covered Locations'}</p>
                            <p className="text-[11px] text-zinc-400 mb-2">{isAr ? 'اترك المدينة فارغة لتغطية الدولة بأكملها.' : 'Leave the city blank to cover the entire country.'}</p>
                            <RowsEditor
                                rows={form.locations}
                                onChange={(locations) => setForm({ ...form, locations })}
                                blank={() => ({ country: '', country_ar: '', city: '', city_ar: '' })}
                                addLabel={isAr ? 'إضافة موقع' : 'Add location'}
                                isAr={isAr}
                                renderRow={(row, idx, update) => (
                                    <>
                                        <input value={row.country} onChange={(e) => update({ country: e.target.value })} placeholder={isAr ? 'الدولة' : 'Country'} className={inputCls} />
                                        <input value={row.country_ar} onChange={(e) => update({ country_ar: e.target.value })} placeholder={isAr ? 'الدولة (عربي)' : 'Country (AR)'} className={inputCls} />
                                        <input value={row.city} onChange={(e) => update({ city: e.target.value })} placeholder={isAr ? 'المدينة (اختياري)' : 'City (optional)'} className={inputCls} />
                                        <input value={row.city_ar} onChange={(e) => update({ city_ar: e.target.value })} placeholder={isAr ? 'المدينة (عربي)' : 'City (AR)'} className={inputCls} />
                                    </>
                                )}
                            />
                        </div>
                        <ModalFooter onClose={closeModal} saving={saving} isAr={isAr} />
                    </form>
                </Modal>
            )}
        </div>
    );
}
