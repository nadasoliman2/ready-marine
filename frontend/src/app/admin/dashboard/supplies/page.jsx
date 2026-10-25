'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Loader2, Package, Plus, Pencil, Trash2, AlertCircle, CheckCircle2,
    Truck, X, Store, Eye, EyeOff, RefreshCw,
} from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { adminApi } from '../../../../lib/api';
import {
    SUPPLY_CATEGORIES, ORDER_STATUSES, PAYMENT_STATUSES, DELIVERY_METHODS,
    NEXT_ACTIONS, label, toneClasses, packLabel, suppliesCopy,
} from '../../../../lib/suppliesLocalization';
import Overlay from '../../../../components/Overlay';

const inputCls = 'w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-marine-cyan';

const emptyProduct = () => ({
    name: '', name_ar: '', description: '', description_ar: '',
    category: 'poly_mailer', dimensions: '',
    price: 0, pack_size: 1, unit_label: 'piece', unit_label_ar: 'قطعة',
    min_order_quantity: 1, max_order_quantity: '', is_active: true, sort_order: 0,
});

/**
 * Admin side of the supplies module: the catalogue the vendors buy from, and the queue of
 * what they ordered.
 *
 * The queue is deliberately one button per order. Everything the admin does here is "move
 * this to its next state", and the server owns which states may follow which — so this
 * renders whatever the shared transition table says is legal rather than trying to
 * re-derive the rules.
 */
export default function AdminSuppliesPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const copy = useMemo(() => suppliesCopy(isAr), [isAr]);

    const [tab, setTab] = useState('orders');
    const [catalogue, setCatalogue] = useState([]);
    const [orders, setOrders] = useState([]);
    const [pendingCount, setPendingCount] = useState(0);
    const [statusFilter, setStatusFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState({ type: '', text: '' });

    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState('');
    const [form, setForm] = useState(emptyProduct());

    const [actionOn, setActionOn] = useState(null); // { order, status }
    const [actionNote, setActionNote] = useState('');
    const [actionTracking, setActionTracking] = useState('');
    const [actionMethod, setActionMethod] = useState('with_pickup');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [cat, ord] = await Promise.all([
                adminApi.getSuppliesCatalogue(),
                adminApi.getSupplyOrders({ status: statusFilter, limit: 50 }),
            ]);
            setCatalogue(cat.products || []);
            setOrders(ord.orders || []);
            setPendingCount(ord.pending_count || 0);
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { load(); }, [load]);

    /* ---- Catalogue ---- */
    const openAdd = () => { setEditingId(''); setForm(emptyProduct()); setShowModal(true); };
    const openEdit = (p) => {
        setEditingId(p._id);
        setForm({
            name: p.name || '', name_ar: p.name_ar || '',
            description: p.description || '', description_ar: p.description_ar || '',
            category: p.category || 'other', dimensions: p.dimensions || '',
            price: p.price ?? 0, pack_size: p.pack_size ?? 1,
            unit_label: p.unit_label || 'piece', unit_label_ar: p.unit_label_ar || 'قطعة',
            min_order_quantity: p.min_order_quantity ?? 1,
            max_order_quantity: p.max_order_quantity ?? '',
            is_active: p.is_active !== false, sort_order: p.sort_order ?? 0,
        });
        setShowModal(true);
    };

    const saveProduct = async (e) => {
        e.preventDefault();
        setBusy('save');
        setMessage({ type: '', text: '' });
        try {
            const payload = {
                ...form,
                price: Number(form.price) || 0,
                pack_size: Number(form.pack_size) || 1,
                min_order_quantity: Number(form.min_order_quantity) || 1,
                max_order_quantity: form.max_order_quantity === '' ? null : Number(form.max_order_quantity),
                sort_order: Number(form.sort_order) || 0,
            };
            if (editingId) await adminApi.updateSupplyProduct(editingId, payload);
            else await adminApi.addSupplyProduct(payload);
            setShowModal(false);
            setMessage({ type: 'success', text: isAr ? 'تم الحفظ.' : 'Saved.' });
            await load();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy('');
        }
    };

    const removeProduct = async (p) => {
        if (!confirm(isAr ? `حذف "${p.name}" نهائيًا؟ لو مؤقتًا مش متوفر، الأفضل توقفه بدل ما تحذفه.` : `Delete "${p.name}" permanently? If it is only out of stock, deactivate it instead.`)) return;
        setBusy(p._id);
        try {
            await adminApi.deleteSupplyProduct(p._id);
            await load();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy('');
        }
    };

    const toggleActive = async (p) => {
        setBusy(p._id);
        try {
            await adminApi.updateSupplyProduct(p._id, { is_active: !p.is_active });
            await load();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy('');
        }
    };

    /* ---- Orders ---- */
    const openAction = (order, status) => {
        setActionOn({ order, status });
        setActionNote('');
        setActionTracking(order.delivery?.tracking_number || '');
        setActionMethod(order.delivery?.method || 'with_pickup');
    };

    const runAction = async () => {
        const { order, status } = actionOn;
        setBusy(order._id);
        setMessage({ type: '', text: '' });
        try {
            await adminApi.updateSupplyOrder(order._id, {
                status,
                note: actionNote,
                ...(status === 'sent' ? { tracking_number: actionTracking, delivery_method: actionMethod } : {}),
            });
            setActionOn(null);
            await load();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy('');
        }
    };

    // The vendor says they paid, the order says "awaiting payment": ask the provider.
    const recheckPayment = async (order) => {
        setBusy(order._id);
        setMessage({ type: '', text: '' });
        try {
            const res = await adminApi.recheckSupplyPayment(order._id);
            if (res.status === 'paid') {
                setMessage({ type: 'success', text: isAr ? `تم تأكيد دفع الطلب ${order.order_number} من بوابة الدفع.` : `Payment for ${order.order_number} confirmed by the gateway.` });
            } else {
                setMessage({ type: 'error', text: isAr ? `بوابة الدفع بتقول إن الطلب ${order.order_number} لسه مدفعش.` : `The gateway reports ${order.order_number} is still unpaid.` });
            }
            await load();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy('');
        }
    };

    if (loading) return <div className="h-64 flex items-center justify-center"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;

    const needsReason = actionOn && ['rejected', 'cancelled'].includes(actionOn.status);

    return (
        <div className="p-6 max-w-6xl space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
            <h1 className="text-2xl font-black text-zinc-900 flex items-center gap-3">
                <Package className="text-marine-primary" /> {copy.adminTitle}
            </h1>

            <div className="flex items-center gap-2 flex-wrap">
                {[
                    { value: 'orders', label: copy.orders, count: pendingCount },
                    { value: 'catalogue', label: copy.catalogue },
                ].map((t) => (
                    <button
                        key={t.value}
                        onClick={() => setTab(t.value)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                            tab === t.value ? 'bg-marine-cyan text-white shadow-lg' : 'bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-300'
                        }`}
                    >
                        {t.label}
                        {t.count > 0 && (
                            <span className={`text-[11px] font-black rounded-full px-1.5 ${tab === t.value ? 'bg-white text-marine-primary' : 'bg-marine-cyan text-white'}`}>{t.count}</span>
                        )}
                    </button>
                ))}
            </div>

            {message.text && (
                <div className={`p-4 rounded-xl text-sm font-bold flex items-start gap-3 ${
                    message.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'
                }`}>
                    {message.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
                    <span>{message.text}</span>
                </div>
            )}

            {/* ---------------- Orders ---------------- */}
            {tab === 'orders' && (
                <>
                    <div className="flex flex-wrap gap-2">
                        {['all', ...Object.keys(ORDER_STATUSES)].map((s) => (
                            <button
                                key={s}
                                onClick={() => setStatusFilter(s)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    statusFilter === s ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-500 hover:border-zinc-300'
                                }`}
                            >
                                {s === 'all' ? (isAr ? 'الكل' : 'All') : label(ORDER_STATUSES, s, isAr)}
                            </button>
                        ))}
                    </div>

                    {orders.length === 0 ? (
                        <div className="bg-white border border-dashed border-zinc-200 rounded-2xl p-12 text-center">
                            <Package size={40} className="text-zinc-300 mx-auto mb-3" />
                            <p className="text-zinc-500 font-bold text-sm">{isAr ? 'لا توجد طلبات.' : 'No orders.'}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {orders.map((order) => (
                                <div key={order._id} className="bg-white border border-zinc-200 rounded-2xl p-5">
                                    <div className="flex flex-wrap items-center gap-3 mb-3">
                                        <span className="font-mono text-xs font-bold text-zinc-500">{order.order_number}</span>
                                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${toneClasses(ORDER_STATUSES[order.status]?.tone)}`}>
                                            {label(ORDER_STATUSES, order.status, isAr)}
                                        </span>
                                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${toneClasses(PAYMENT_STATUSES[order.payment_status]?.tone)}`}>
                                            {label(PAYMENT_STATUSES, order.payment_status, isAr)}
                                        </span>
                                        <span className="ms-auto font-black text-zinc-900 tabular-nums">{order.total} {isAr ? 'ج.م' : 'EGP'}</span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <p className="flex items-center gap-1.5 font-bold text-zinc-800">
                                                <Store size={13} className="text-marine-primary" />
                                                {order.vendor_id?.store_name || '—'}
                                            </p>
                                            <p className="text-xs text-zinc-500 mt-1">{order.ship_to?.address || '—'}{order.ship_to?.city ? ` · ${order.ship_to.city}` : ''}</p>
                                            <p className="text-xs text-zinc-500">{order.ship_to?.phone || order.vendor_id?.phone || ''}</p>
                                            <p className="text-[11px] text-zinc-400 mt-1">
                                                {copy.fromWallet}: {order.wallet_amount} · {copy.payOnline}: {order.online_amount}
                                            </p>
                                        </div>

                                        <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 space-y-1">
                                            {order.items.map((i) => (
                                                <div key={i._id} className="flex justify-between text-xs">
                                                    <span className="text-zinc-700">
                                                        {isAr ? (i.name_ar || i.name) : i.name}
                                                        {i.dimensions ? <span className="text-zinc-400"> · {i.dimensions}</span> : null}
                                                    </span>
                                                    <span className="font-bold text-zinc-900 tabular-nums whitespace-nowrap ms-3">
                                                        {i.quantity} × {i.unit_price}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {order.vendor_note && <p className="text-xs text-zinc-600 mt-2">{order.vendor_note}</p>}
                                    {order.delivery?.tracking_number && (
                                        <p className="text-xs text-zinc-500 mt-2 flex items-center gap-1.5">
                                            <Truck size={13} /> {label(DELIVERY_METHODS, order.delivery.method, isAr)} · <span className="font-mono">{order.delivery.tracking_number}</span>
                                        </p>
                                    )}
                                    {order.rejection_reason && <p className="text-xs text-red-600 mt-2">{order.rejection_reason}</p>}

                                    <div className="flex items-center gap-2 mt-4 flex-wrap">
                                        {order.payment_status === 'awaiting_online' && !['cancelled', 'rejected'].includes(order.status) && (
                                            <button
                                                onClick={() => recheckPayment(order)}
                                                disabled={busy === order._id}
                                                title={isAr ? 'اسأل بوابة الدفع هل الطلب اتدفع' : 'Ask the payment gateway whether this was paid'}
                                                className="px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50 bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1.5"
                                            >
                                                {busy === order._id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                                {isAr ? 'تحقق من الدفع' : 'Re-check payment'}
                                            </button>
                                        )}
                                        {(NEXT_ACTIONS[order.status] || []).map((next) => (
                                            <button
                                                key={next}
                                                onClick={() => openAction(order, next)}
                                                disabled={busy === order._id}
                                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50 ${
                                                    ['rejected', 'cancelled'].includes(next)
                                                        ? 'bg-white border border-zinc-200 hover:border-red-300 text-red-600'
                                                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                                }`}
                                            >
                                                {label(ORDER_STATUSES, next, isAr)}
                                            </button>
                                        ))}
                                        {(NEXT_ACTIONS[order.status] || []).length === 0 && (
                                            <span className="text-xs text-zinc-400">{isAr ? 'لا يوجد إجراء متبقي.' : 'Nothing left to do.'}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* ---------------- Catalogue ---------------- */}
            {tab === 'catalogue' && (
                <>
                    <div className="flex justify-end">
                        <button onClick={openAdd} className="bg-marine-cyan hover:bg-marine-cyan-dark text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2">
                            <Plus size={16} /> {isAr ? 'إضافة منتج' : 'Add item'}
                        </button>
                    </div>

                    <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
                        {catalogue.length === 0 ? (
                            <div className="p-12 text-center text-zinc-500 font-bold text-sm">{isAr ? 'الكتالوج فاضي.' : 'The catalogue is empty.'}</div>
                        ) : catalogue.map((p) => (
                            <div key={p._id} className={`p-4 flex flex-wrap items-center gap-4 ${p.is_active ? '' : 'opacity-55'}`}>
                                <div className="min-w-0 flex-1">
                                    <p className="font-black text-zinc-900 text-sm">
                                        {isAr ? (p.name_ar || p.name) : p.name}
                                        {!p.is_active && <span className="ms-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">{isAr ? 'موقوف' : 'Inactive'}</span>}
                                    </p>
                                    <p className="text-xs text-zinc-500">
                                        {label({ ...Object.fromEntries(SUPPLY_CATEGORIES.map((c) => [c.value, c])) }, p.category, isAr)}
                                        {p.dimensions ? ` · ${p.dimensions}` : ''}
                                    </p>
                                </div>
                                <div className="text-end">
                                    <p className="font-black text-zinc-900">{p.price} <span className="text-[11px] font-bold text-zinc-500">{isAr ? 'ج.م' : 'EGP'}</span></p>
                                    <p className="text-[11px] text-zinc-500 font-bold">{packLabel(p, isAr)}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => toggleActive(p)} disabled={busy === p._id} title={p.is_active ? 'Deactivate' : 'Activate'}
                                        className="p-2 rounded-lg border border-zinc-200 text-zinc-500 hover:text-zinc-800 disabled:opacity-50">
                                        {p.is_active ? <Eye size={15} /> : <EyeOff size={15} />}
                                    </button>
                                    <button onClick={() => openEdit(p)} className="p-2 rounded-lg border border-zinc-200 text-zinc-500 hover:text-marine-primary">
                                        <Pencil size={15} />
                                    </button>
                                    <button onClick={() => removeProduct(p)} disabled={busy === p._id}
                                        className="p-2 rounded-lg border border-zinc-200 text-zinc-400 hover:text-red-600 disabled:opacity-50">
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* ---------------- Catalogue modal ---------------- */}
            {showModal && (
                <Overlay className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                    <form
                        onClick={(e) => e.stopPropagation()}
                        onSubmit={saveProduct}
                        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4"
                    >
                        <div className="flex items-center justify-between">
                            <h2 className="font-black text-zinc-900 text-lg">{editingId ? (isAr ? 'تعديل منتج' : 'Edit item') : (isAr ? 'إضافة منتج' : 'Add item')}</h2>
                            <button type="button" onClick={() => setShowModal(false)} className="text-zinc-400 hover:text-zinc-800"><X size={20} /></button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Field label={isAr ? 'الاسم (إنجليزي)' : 'Name (English)'}>
                                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
                            </Field>
                            <Field label={isAr ? 'الاسم (عربي)' : 'Name (Arabic)'}>
                                <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className={inputCls} />
                            </Field>
                            <Field label={isAr ? 'التصنيف' : 'Category'}>
                                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
                                    {SUPPLY_CATEGORIES.filter((c) => c.value !== 'all').map((c) => (
                                        <option key={c.value} value={c.value}>{isAr ? c.ar : c.en}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label={isAr ? 'المقاس' : 'Dimensions'}>
                                <input value={form.dimensions} onChange={(e) => setForm({ ...form, dimensions: e.target.value })} placeholder="20 × 30 cm" className={inputCls} />
                            </Field>

                            <Field label={isAr ? 'سعر العبوة (ج.م)' : 'Price per pack (EGP)'} hint={isAr ? 'تمن العبوة كلها، مش القطعة.' : 'What one whole pack costs, not one piece.'}>
                                <input required type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={inputCls} />
                            </Field>
                            <Field label={isAr ? 'عدد القطع في العبوة' : 'Pieces per pack'} hint={isAr ? 'حط 1 لو بيتباع بالقطعة.' : 'Use 1 for items sold singly.'}>
                                <input required type="number" min="1" value={form.pack_size} onChange={(e) => setForm({ ...form, pack_size: e.target.value })} className={inputCls} />
                            </Field>

                            <Field label={isAr ? 'اسم الوحدة (إنجليزي)' : 'Unit name (English)'}>
                                <input value={form.unit_label} onChange={(e) => setForm({ ...form, unit_label: e.target.value })} className={inputCls} />
                            </Field>
                            <Field label={isAr ? 'اسم الوحدة (عربي)' : 'Unit name (Arabic)'}>
                                <input value={form.unit_label_ar} onChange={(e) => setForm({ ...form, unit_label_ar: e.target.value })} className={inputCls} />
                            </Field>

                            <Field label={isAr ? 'أقل كمية' : 'Minimum quantity'}>
                                <input type="number" min="1" value={form.min_order_quantity} onChange={(e) => setForm({ ...form, min_order_quantity: e.target.value })} className={inputCls} />
                            </Field>
                            <Field label={isAr ? 'أقصى كمية (فاضي = مفيش حد)' : 'Maximum quantity (blank = no cap)'}>
                                <input type="number" min="1" value={form.max_order_quantity} onChange={(e) => setForm({ ...form, max_order_quantity: e.target.value })} className={inputCls} />
                            </Field>

                            <Field label={isAr ? 'الترتيب' : 'Sort order'}>
                                <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} className={inputCls} />
                            </Field>
                            <Field label={isAr ? 'متاح للتجار' : 'Available to vendors'}>
                                <label className="flex items-center gap-2 text-sm font-bold text-zinc-700 py-2">
                                    <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 accent-marine-cyan" />
                                    {form.is_active ? (isAr ? 'ظاهر' : 'Shown') : (isAr ? 'مخفي' : 'Hidden')}
                                </label>
                            </Field>
                        </div>

                        <Field label={isAr ? 'الوصف (إنجليزي)' : 'Description (English)'}>
                            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
                        </Field>
                        <Field label={isAr ? 'الوصف (عربي)' : 'Description (Arabic)'}>
                            <textarea rows={2} value={form.description_ar} onChange={(e) => setForm({ ...form, description_ar: e.target.value })} className={inputCls} />
                        </Field>

                        <div className="flex items-center gap-3 pt-2">
                            <button type="submit" disabled={busy === 'save'} className="bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2">
                                {busy === 'save' && <Loader2 size={15} className="animate-spin" />}
                                {isAr ? 'حفظ' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setShowModal(false)} className="text-zinc-500 hover:text-zinc-800 text-sm font-bold">
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                        </div>
                    </form>
                </Overlay>
            )}

            {/* ---------------- Order action modal ---------------- */}
            {actionOn && (
                <Overlay className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setActionOn(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
                        <h2 className="font-black text-zinc-900">
                            {label(ORDER_STATUSES, actionOn.status, isAr)} — <span className="font-mono text-sm text-zinc-500">{actionOn.order.order_number}</span>
                        </h2>

                        {actionOn.status === 'sent' && (
                            <>
                                <Field label={isAr ? 'طريقة التسليم' : 'How it is going'}>
                                    <select value={actionMethod} onChange={(e) => setActionMethod(e.target.value)} className={inputCls}>
                                        {Object.entries(DELIVERY_METHODS).map(([value, l]) => (
                                            <option key={value} value={value}>{isAr ? l.ar : l.en}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label={isAr ? 'رقم التتبع (اختياري)' : 'Tracking number (optional)'}>
                                    <input value={actionTracking} onChange={(e) => setActionTracking(e.target.value)} className={inputCls} />
                                </Field>
                            </>
                        )}

                        <Field label={needsReason ? (isAr ? 'السبب (مطلوب)' : 'Reason (required)') : (isAr ? 'ملاحظة للتاجر (اختياري)' : 'Note to the vendor (optional)')}>
                            <textarea rows={3} value={actionNote} onChange={(e) => setActionNote(e.target.value)} className={inputCls} />
                        </Field>

                        {needsReason && (
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                                {isAr ? 'الفلوس هترجع لمحفظة التاجر تلقائيًا.' : "The vendor's money returns to their wallet automatically."}
                            </p>
                        )}

                        <div className="flex items-center gap-3">
                            <button
                                onClick={runAction}
                                disabled={busy === actionOn.order._id || (needsReason && !actionNote.trim())}
                                className="bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2"
                            >
                                {busy === actionOn.order._id && <Loader2 size={15} className="animate-spin" />}
                                {isAr ? 'تأكيد' : 'Confirm'}
                            </button>
                            <button onClick={() => setActionOn(null)} className="text-zinc-500 hover:text-zinc-800 text-sm font-bold">
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}

function Field({ label: text, hint, children }) {
    return (
        <label className="block">
            <span className="block text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-1">{text}</span>
            {children}
            {hint && <span className="block text-[11px] text-zinc-400 mt-1">{hint}</span>}
        </label>
    );
}
