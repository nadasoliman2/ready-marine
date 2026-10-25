'use client';

import { useEffect, useState } from 'react';
import { Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import { Field, Toggle, StatCard, Modal, ModalFooter, inputCls, PrimaryButton } from '../../../../../components/dashboard/shipping/ShippingUI';

const emptyForm = { name: '', name_ar: '', description: '', default_handling_fee: 0, is_active: true };

export default function ShippingClassesPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    const [classes, setClasses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState('');
    const [form, setForm] = useState(emptyForm);

    const load = async () => {
        setLoading(true);
        try { const data = await adminApi.getShippingClasses(); setClasses(data.classes || []); }
        catch (err) { setError(err.message || 'Failed to load classes'); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const openAdd = () => { setEditingId(''); setForm(emptyForm); setShowModal(true); };
    const openEdit = (c) => {
        setEditingId(c._id);
        setForm({ name: c.name || '', name_ar: c.name_ar || '', description: c.description || '', default_handling_fee: c.default_handling_fee || 0, is_active: c.is_active !== false });
        setShowModal(true);
    };
    const closeModal = () => { setShowModal(false); setEditingId(''); setForm(emptyForm); };

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true); setError('');
        try {
            const payload = { name: form.name.trim(), name_ar: form.name_ar.trim(), description: form.description.trim(), default_handling_fee: Number(form.default_handling_fee) || 0, is_active: form.is_active };
            if (editingId) await adminApi.updateShippingClass(editingId, payload);
            else await adminApi.addShippingClass(payload);
            closeModal(); await load();
        } catch (err) { setError(err.message || 'Failed to save class'); }
        finally { setSaving(false); }
    };

    const removeClass = async (c) => {
        if (!confirm(isAr ? 'حذف فئة الشحن هذه؟' : 'Delete this shipping class?')) return;
        setDeletingId(c._id); setError('');
        try { await adminApi.deleteShippingClass(c._id); await load(); }
        catch (err) { setError(err.message || 'Failed to delete class'); }
        finally { setDeletingId(''); }
    };

    if (loading) return <div className="h-40 flex items-center justify-center"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                    <StatCard icon={Layers} label={isAr ? 'إجمالي الفئات' : 'Total Classes'} value={classes.length} />
                    <StatCard icon={Layers} label={isAr ? 'الفئات النشطة' : 'Active Classes'} value={classes.filter((c) => c.is_active !== false).length} tone="green" />
                </div>
                <PrimaryButton onClick={openAdd}><Plus size={18} /> {isAr ? 'إضافة فئة' : 'Add Class'}</PrimaryButton>
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">{error}</div>}

            <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm divide-y divide-zinc-100 dark:divide-white/5">
                {classes.length === 0 ? (
                    <div className="px-6 py-14 text-center"><Layers size={36} className="mx-auto text-zinc-300 mb-3" /><p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد فئات شحن' : 'No shipping classes yet'}</p></div>
                ) : classes.map((c) => (
                    <div key={c._id} className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4">
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h3 className="font-black text-zinc-900 dark:text-white">{isAr ? (c.name_ar || c.name) : c.name}</h3>
                                {c.is_active === false && <span className="px-2 py-0.5 text-[10px] font-bold bg-zinc-100 dark:bg-white/10 text-zinc-500 rounded-full uppercase">{isAr ? 'معطّل' : 'Disabled'}</span>}
                                {!!c.default_handling_fee && <span className="px-2 py-0.5 text-[10px] font-bold bg-marine-cyan/10 text-marine-primary rounded-full">{isAr ? 'رسوم مناولة: ' : 'Handling: '}{c.default_handling_fee}</span>}
                            </div>
                            {c.description && <p className="text-xs text-zinc-500">{c.description}</p>}
                            <p className="text-[11px] text-zinc-400">ID: {c._id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => openEdit(c)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300"><Pencil size={13} /> {isAr ? 'تعديل' : 'Edit'}</button>
                            <button onClick={() => removeClass(c)} disabled={deletingId === c._id} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50">{deletingId === c._id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {isAr ? 'حذف' : 'Delete'}</button>
                        </div>
                    </div>
                ))}
            </div>

            {showModal && (
                <Modal title={editingId ? (isAr ? 'تعديل فئة' : 'Edit Class') : (isAr ? 'إضافة فئة' : 'Add Class')} onClose={closeModal}>
                    <form onSubmit={submit} className="p-5 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field label={isAr ? 'الاسم' : 'Name'} required><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
                            <Field label={isAr ? 'الاسم بالعربية' : 'Arabic Name'}><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className={inputCls} /></Field>
                            <Field label={isAr ? 'رسوم المناولة الافتراضية' : 'Default Handling Fee'}><input type="number" step="any" value={form.default_handling_fee} onChange={(e) => setForm({ ...form, default_handling_fee: Number(e.target.value) || 0 })} className={inputCls} /></Field>
                            <div className="flex items-end pb-2"><Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label={isAr ? 'مفعّل' : 'Active'} /></div>
                        </div>
                        <Field label={isAr ? 'الوصف' : 'Description'}><textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls + ' resize-none'} /></Field>
                        <ModalFooter onClose={closeModal} saving={saving} isAr={isAr} />
                    </form>
                </Modal>
            )}
        </div>
    );
}
