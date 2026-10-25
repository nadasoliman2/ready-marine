'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from '../../../../../lib/navigation';
import { useApp } from '../../../../../context/AppContext';
import { userApi, returnsApi } from '../../../../../lib/api';
import { ArrowLeft, RotateCcw, Package, CheckCircle2, Loader2, Upload, X } from 'lucide-react';

const REASONS = [
    { value: 'defective', en: 'Defective Product', ar: 'منتج معيب' },
    { value: 'wrong_item', en: 'Wrong Item Received', ar: 'تم استلام منتج خاطئ' },
    { value: 'not_as_described', en: 'Not as Described', ar: 'غير مطابق للوصف' },
    { value: 'changed_mind', en: 'Changed Mind', ar: 'تغيير رأي' },
    { value: 'other', en: 'Other', ar: 'أخرى' },
];

const EVIDENCE_REQUIRED = ['defective', 'wrong_item', 'not_as_described'];
const FAULT_TYPE_BY_REASON = {
    defective: 'vendor_fault',
    wrong_item: 'vendor_fault',
    not_as_described: 'vendor_fault',
    changed_mind: 'customer_fault',
};

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function CreateReturnRequestPage() {
    const { orderId } = useParams();
    const router = useRouter();
    const { language } = useApp();
    const isAr = language === 'ar';

    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Form state
    const [selectedItems, setSelectedItems] = useState({});
    const [reason, setReason] = useState('');
    const [reasonDetails, setReasonDetails] = useState('');
    const [evidence, setEvidence] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        loadOrder();
    }, [orderId]);

    const loadOrder = async () => {
        try {
            setLoading(true);
            const data = await userApi.getOrders();
            const orders = data.orders || data || [];
            const found = orders.find((o) => o._id === orderId);
            if (!found) throw new Error(isAr ? 'الطلب غير موجود' : 'Order not found');
            if (found.status !== 'completed') throw new Error(isAr ? 'يمكن إرجاع الطلبات المكتملة فقط' : 'Only completed orders can be returned');
            setOrder(found);
        } catch (err) {
            setError(isAr ? 'تعذر تحميل بيانات الطلب.' : (err.message || 'Failed to load order data.'));
        } finally {
            setLoading(false);
        }
    };

    const toggleItem = (itemId) => {
        setSelectedItems((prev) => {
            const copy = { ...prev };
            if (copy[itemId]) {
                delete copy[itemId];
            } else {
                const item = order.items.find((i) => i._id === itemId);
                copy[itemId] = { order_item_id: itemId, quantity_returning: item?.quantity || 1 };
            }
            return copy;
        });
    };

    const updateQty = (itemId, qty) => {
        setSelectedItems((prev) => ({
            ...prev,
            [itemId]: { ...prev[itemId], quantity_returning: Math.max(1, Number(qty)) },
        }));
    };

    const handleImageUpload = async (e) => {
        const input = e.target;
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        setUploading(true);
        try {
            const formData = new FormData();
            files.forEach((file) => formData.append('images', file));
            const response = await fetch(`${BASE_URL.replace('/api', '')}/api/upload`, {
                method: 'POST',
                body: formData,
                credentials: 'include',
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || (isAr ? 'فشل رفع الصورة' : 'Image upload failed'));
            }

            const uploadedImages = data.images || (data.url ? [{ url: data.url }] : []);
            if (uploadedImages.length === 0) {
                throw new Error(isAr ? 'لم يتم استلام رابط الصورة' : 'No uploaded image URL received');
            }
            setEvidence((prev) => [
                ...prev,
                ...uploadedImages.map((image) => ({ url: image.url, type: 'image' })),
            ]);
        } catch (err) {
            alert(isAr ? 'فشل رفع الصورة.' : (err.message || 'Image upload failed.'));
        } finally {
            setUploading(false);
            input.value = '';
        }
    };

    const removeEvidence = (index) => {
        setEvidence((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async () => {
        const items = Object.values(selectedItems);
        if (items.length === 0) {
            alert(isAr ? 'يرجى اختيار منتج واحد على الأقل' : 'Please select at least one item');
            return;
        }
        if (!reason) {
            alert(isAr ? 'يرجى اختيار سبب الإرجاع' : 'Please select a return reason');
            return;
        }
        if (EVIDENCE_REQUIRED.includes(reason) && evidence.length === 0) {
            alert(isAr ? 'يرجى رفع صورة كدليل' : 'Please upload evidence photos');
            return;
        }

        // Check all items belong to same vendor
        const vendorIds = new Set();
        for (const item of items) {
            const orderItem = order.items.find((i) => i._id === item.order_item_id);
            if (orderItem?.vendor_id) vendorIds.add(typeof orderItem.vendor_id === 'object' ? orderItem.vendor_id._id : orderItem.vendor_id);
        }
        if (vendorIds.size > 1) {
            alert(isAr ? 'يجب أن تكون جميع المنتجات من نفس البائع. أنشئ طلبات منفصلة.' : 'All items must be from the same vendor. Create separate requests.');
            return;
        }

        try {
            setSubmitting(true);
            await returnsApi.create({
                order_id: orderId,
                items,
                reason,
                reason_details: reasonDetails,
                evidence,
                fault_type: FAULT_TYPE_BY_REASON[reason] || 'undetermined',
            });
            router.push('/dashboard/returns');
        } catch (err) {
            alert(isAr ? 'تعذر إرسال طلب الإرجاع. يرجى مراجعة البيانات والمحاولة مرة أخرى.' : (err.message || 'Failed to submit the return request.'));
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;
    if (error) return <div className="bg-red-500/10 border border-red-500/20 text-red-600 p-6 rounded-xl">{error}</div>;

    const eligibleItems = (order?.items || []).filter(
        (item) => item.vendor_status === 'approved' && (!item.return_status || item.return_status === 'none')
    );

    return (
        <div className="space-y-6 max-w-2xl">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button onClick={() => router.back()} className="p-2 rounded-xl border border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                    <ArrowLeft size={18} className={isAr ? 'rotate-180' : ''} />
                </button>
                <div>
                    <h1 className="text-xl font-black text-zinc-900 dark:text-white flex items-center gap-2">
                        <RotateCcw size={20} /> {isAr ? 'طلب إرجاع' : 'Return Request'}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-0.5">{isAr ? 'اختر المنتجات التي تريد إرجاعها' : 'Select items to return'}</p>
                </div>
            </div>

            {/* Select Items */}
            <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4">{isAr ? 'اختر المنتجات' : 'Select Items'}</h2>
                {eligibleItems.length === 0 ? (
                    <p className="text-sm text-zinc-500">{isAr ? 'لا توجد منتجات مؤهلة للإرجاع' : 'No items eligible for return'}</p>
                ) : (
                    <div className="space-y-3">
                        {eligibleItems.map((item) => {
                            const isSelected = !!selectedItems[item._id];
                            return (
                                <div key={item._id}
                                    className={`flex items-center gap-4 p-3 rounded-xl border cursor-pointer transition-colors ${
                                        isSelected
                                            ? 'border-marine-cyan bg-red-50 dark:bg-red-500/5'
                                            : 'border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-white/[0.02]'
                                    }`}
                                    onClick={() => toggleItem(item._id)}>
                                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                                        isSelected ? 'border-marine-cyan bg-marine-cyan' : 'border-zinc-300 dark:border-zinc-600'}`}>
                                        {isSelected && <CheckCircle2 size={12} className="text-white" />}
                                    </div>
                                    {item.product_image ? (
                                        <img src={item.product_image} alt="" className="w-12 h-12 rounded-lg object-cover" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                                            <Package size={18} className="text-zinc-400" />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">{item.product_title}</p>
                                        {item.variant_label && <p className="text-xs text-zinc-500">{item.variant_label}</p>}
                                        <p className="text-xs text-zinc-400">{item.unit_price} {isAr ? 'ج.م' : 'EGP'}</p>
                                    </div>
                                    {isSelected && (
                                        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                                            <label className="text-[10px] text-zinc-400 block mb-1">{isAr ? 'الكمية' : 'Qty'}</label>
                                            <input type="number" min={1} max={item.quantity}
                                                value={selectedItems[item._id]?.quantity_returning || 1}
                                                onChange={(e) => updateQty(item._id, e.target.value)}
                                                className="w-16 px-2 py-1.5 bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg text-sm text-center text-zinc-900 dark:text-white" />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Reason */}
            <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4">{isAr ? 'سبب الإرجاع' : 'Return Reason'}</h2>
                <div className="space-y-2">
                    {REASONS.map((r) => (
                        <label key={r.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                            reason === r.value ? 'border-marine-cyan bg-red-50 dark:bg-red-500/5' : 'border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-white/[0.02]'
                        }`}>
                            <input type="radio" name="reason" value={r.value} checked={reason === r.value}
                                onChange={() => setReason(r.value)} className="sr-only" />
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                reason === r.value ? 'border-marine-cyan' : 'border-zinc-300 dark:border-zinc-600'}`}>
                                {reason === r.value && <div className="w-2 h-2 rounded-full bg-marine-cyan" />}
                            </div>
                            <span className="text-sm text-zinc-900 dark:text-white">{isAr ? r.ar : r.en}</span>
                        </label>
                    ))}
                </div>
                <textarea value={reasonDetails} onChange={(e) => setReasonDetails(e.target.value)}
                    placeholder={isAr ? 'تفاصيل إضافية (اختياري)' : 'Additional details (optional)'}
                    rows={3}
                    className="w-full mt-4 px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white resize-none" />
            </div>

            {/* Evidence Upload */}
            {EVIDENCE_REQUIRED.includes(reason) && (
                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-2">
                        {isAr ? 'صور الدليل' : 'Evidence Photos'} <span className="text-red-500">*</span>
                    </h2>
                    <p className="text-xs text-zinc-500 mb-4">{isAr ? 'ارفق صور توضح المشكلة' : 'Upload photos showing the issue'}</p>

                    {evidence.length > 0 && (
                        <div className="grid grid-cols-4 gap-2 mb-4">
                            {evidence.map((ev, i) => (
                                <div key={i} className="relative">
                                    <img src={ev.url} alt="" className="w-full h-20 rounded-lg object-cover" />
                                    <button onClick={() => removeEvidence(i)}
                                        className="absolute -top-1.5 -end-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center">
                                        <X size={10} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <label className="flex items-center justify-center gap-2 py-3 border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-xl text-sm text-zinc-500 hover:border-marine-cyan hover:text-marine-primary cursor-pointer transition-colors">
                        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        {uploading ? (isAr ? 'جاري الرفع...' : 'Uploading...') : (isAr ? 'رفع صور' : 'Upload Photos')}
                        <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="sr-only" disabled={uploading} />
                    </label>
                </div>
            )}

            {/* Submit */}
            <button onClick={handleSubmit} disabled={submitting || Object.keys(selectedItems).length === 0 || !reason}
                className="w-full py-3 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark disabled:opacity-50 transition-colors">
                {submitting ? <Loader2 size={16} className="animate-spin mx-auto" /> : (isAr ? 'إرسال طلب الإرجاع' : 'Submit Return Request')}
            </button>
        </div>
    );
}
