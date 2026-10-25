'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from '../../../../lib/navigation';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { ticketApi, vendorApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import TicketOrderSelect from '../../../../components/support/TicketOrderSelect';

const CATEGORIES = [
    { value: 'account', label_en: 'Account', label_ar: 'الحساب' },
    { value: 'order', label_en: 'Order', label_ar: 'الطلب' },
    { value: 'product', label_en: 'Product', label_ar: 'المنتج' },
    { value: 'payment', label_en: 'Payment', label_ar: 'الدفع' },
    { value: 'technical', label_en: 'Technical', label_ar: 'تقني' },
    { value: 'other', label_en: 'Other', label_ar: 'أخرى' },
];

const PRIORITIES = [
    { value: 'low', label_en: 'Low', label_ar: 'منخفض' },
    { value: 'medium', label_en: 'Medium', label_ar: 'متوسط' },
    { value: 'high', label_en: 'High', label_ar: 'عالي' },
    { value: 'urgent', label_en: 'Urgent', label_ar: 'عاجل' },
];

export default function VendorNewTicketPage() {
    return (
        <Suspense fallback={<div className="max-w-2xl mx-auto" />}>
            <VendorNewTicketForm />
        </Suspense>
    );
}

function VendorNewTicketForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { language } = useApp();
    const isAr = language === 'ar';

    // Arriving from an order's "report a problem" button pre-selects that order.
    const presetOrderId = searchParams.get('order') || '';
    const [form, setForm] = useState({ title: '', description: '', category: presetOrderId ? 'order' : 'other', priority: 'medium', order_id: presetOrderId });
    const [orders, setOrders] = useState([]);
    const [ordersLoading, setOrdersLoading] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let alive = true;
        // Both lists: the ones still under review and the ones already confirmed.
        Promise.all([vendorApi.getOrders(false).catch(() => []), vendorApi.getOrders(true).catch(() => [])])
            .then(([pending, revised]) => {
                if (!alive) return;
                const seen = new Set();
                const merged = [...(pending || []), ...(revised || [])].filter((o) => o?._id && !seen.has(String(o._id)) && seen.add(String(o._id)));
                merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
                setOrders(merged);
            })
            .finally(() => { if (alive) setOrdersLoading(false); });
        return () => { alive = false; };
    }, []);

    const selectOrder = (order_id) => {
        setForm((f) => {
            const chosen = orders.find((o) => String(o._id) === String(order_id));
            const ref = chosen ? (chosen.reference || String(chosen._id).slice(-8).toUpperCase()) : '';
            const autoTitle = order_id && !f.title.trim() ? (isAr ? `مشكلة في الطلب #${ref}` : `Problem with order #${ref}`) : f.title;
            return { ...f, order_id, category: order_id ? 'order' : f.category, title: autoTitle };
        });
    };

    useEffect(() => {
        if (presetOrderId && orders.length && !form.title.trim()) selectOrder(presetOrderId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orders]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.title.trim() || !form.description.trim()) return;

        setLoading(true);
        setError('');
        try {
            const data = await ticketApi.createTicket(form);
            router.push(`/dashboard/tickets/${data.ticket._id}`);
        } catch (err) {
            setError(isAr ? 'تعذر إنشاء تذكرة الدعم. يرجى مراجعة البيانات.' : (err.message || 'Failed to create ticket.'));
        } finally {
            setLoading(false);
        }
    };

    const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={() => router.back()}
                    className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-[#1a1d24] transition-colors"
                >
                    <ArrowLeft size={18} className="text-zinc-600 dark:text-zinc-400" />
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
                        {isAr ? 'إنشاء تذكرة دعم' : 'New Support Ticket'}
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {isAr ? 'أرسل طلباً لفريق الدعم' : 'Submit a request to the support team'}
                    </p>
                </div>
            </div>

            {/* Form */}
            <div className="bg-white dark:bg-[#1a1d24] rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
                <form onSubmit={handleSubmit} className="space-y-5">
                    <TicketOrderSelect orders={orders} value={form.order_id} onChange={selectOrder} isAr={isAr} loading={ordersLoading} />
                    {/* Title */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                            {isAr ? 'عنوان طلب الدعم *' : 'Ticket Title *'}
                        </label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={set('title')}
                            placeholder={isAr ? 'اكتب عنواناً واضحاً...' : 'Write a clear title...'}
                            required
                            maxLength={255}
                            className="w-full px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50"
                        />
                    </div>

                    {/* Category & Priority */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                {isAr ? 'الفئة' : 'Category'}
                            </label>
                            <select
                                value={form.category}
                                onChange={set('category')}
                                className="w-full px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50"
                            >
                                {CATEGORIES.map(cat => (
                                    <option key={cat.value} value={cat.value}>
                                        {isAr ? cat.label_ar : cat.label_en}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                {isAr ? 'الأولوية' : 'Priority'}
                            </label>
                            <select
                                value={form.priority}
                                onChange={set('priority')}
                                className="w-full px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50"
                            >
                                {PRIORITIES.map(p => (
                                    <option key={p.value} value={p.value}>
                                        {isAr ? p.label_ar : p.label_en}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                            {isAr ? 'الوصف *' : 'Description *'}
                        </label>
                        <textarea
                            value={form.description}
                            onChange={set('description')}
                            placeholder={isAr ? 'اشرح مشكلتك بالتفصيل...' : 'Describe your issue in detail...'}
                            required
                            rows={7}
                            className="w-full px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50 resize-none"
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-red-500 bg-red-50 dark:bg-red-500/10 px-4 py-3 rounded-lg">
                            {error}
                        </p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-2">
                        <button
                            type="submit"
                            disabled={loading || !form.title.trim() || !form.description.trim()}
                            className="flex items-center gap-2 px-6 py-2.5 bg-marine-cyan hover:bg-[#b55d16] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            {loading ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <Send size={16} />
                            )}
                            {isAr ? 'إرسال طلب الدعم' : 'Submit Ticket'}
                        </button>
                        <button
                            type="button"
                            onClick={() => router.back()}
                            className="px-6 py-2.5 border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-[#0E1012] rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-400 transition-colors"
                        >
                            {isAr ? 'إلغاء' : 'Cancel'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
