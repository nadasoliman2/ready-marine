'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, X, CheckCircle2, AlertTriangle, CreditCard, Gift, Store, Home } from 'lucide-react';
import { adminSubscriptionApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import Overlay from '../../../../components/Overlay';

const emptyPackage = {
    name: '',
    name_ar: '',
    description: '',
    description_ar: '',
    price: '',
    billing_period: 'monthly',
    max_products: '',
    status: 'active',
    is_free_trial: false,
    trial_days: '',
    grants_vendors_page: true,
    grants_home_slider: false,
};

export default function SubscriptionPackagesPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(emptyPackage);

    const loadPackages = async () => {
        try {
            const data = await adminSubscriptionApi.getPackages();
            setPackages(data.packages || []);
        } catch (err) {
            setError(err.message || 'Failed to load packages');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadPackages(); }, []);

    const openCreate = () => {
        setEditingId(null);
        setForm(emptyPackage);
        setShowModal(true);
    };

    const openEdit = (pkg) => {
        setEditingId(pkg._id);
        setForm({
            name: pkg.name || '',
            name_ar: pkg.name_ar || '',
            description: pkg.description || '',
            description_ar: pkg.description_ar || '',
            price: pkg.price?.toString() || '',
            billing_period: pkg.billing_period || 'monthly',
            max_products: pkg.max_products?.toString() || '',
            status: pkg.status || 'active',
            is_free_trial: pkg.is_free_trial || false,
            trial_days: pkg.trial_days?.toString() || '',
            grants_vendors_page: pkg.grants_vendors_page !== false,
            grants_home_slider: pkg.grants_home_slider === true,
        });
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        setSuccess('');

        try {
            const payload = {
                name: form.name,
                name_ar: form.name_ar,
                description: form.description,
                description_ar: form.description_ar,
                price: form.is_free_trial ? 0 : Number(form.price),
                billing_period: form.is_free_trial ? 'trial' : form.billing_period,
                max_products: Number(form.max_products),
                status: form.status,
                is_free_trial: form.is_free_trial,
                trial_days: form.is_free_trial ? Number(form.trial_days) || 0 : 0,
                grants_vendors_page: form.grants_vendors_page,
                grants_home_slider: form.grants_home_slider,
            };

            if (editingId) {
                await adminSubscriptionApi.updatePackage(editingId, payload);
                setSuccess(isAr ? 'تم تحديث الباقة بنجاح' : 'Package updated successfully');
            } else {
                await adminSubscriptionApi.createPackage(payload);
                setSuccess(isAr ? 'تم إنشاء الباقة بنجاح' : 'Package created successfully');
            }

            setShowModal(false);
            setForm(emptyPackage);
            setEditingId(null);
            loadPackages();
        } catch (err) {
            setError(err.message || 'Failed to save package');
        } finally {
            setSaving(false);
        }
    };

    const toggleStatus = async (pkg) => {
        try {
            await adminSubscriptionApi.togglePackageStatus(pkg._id);
            loadPackages();
        } catch (err) {
            setError(err.message || 'Failed to toggle status');
        }
    };

    const deletePackage = async (pkg) => {
        const confirmMsg = isAr
            ? `هل تريد حذف الباقة "${pkg.name}"؟`
            : `Delete package "${pkg.name}"?`;
        if (!confirm(confirmMsg)) return;

        setDeletingId(pkg._id);
        try {
            await adminSubscriptionApi.deletePackage(pkg._id);
            setPackages(prev => prev.filter(p => p._id !== pkg._id));
        } catch (err) {
            setError(err.message || 'Failed to delete package');
        } finally {
            setDeletingId('');
        }
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 size={32} className="animate-spin text-marine-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
                        {isAr ? 'خطط الاشتراك' : 'Subscription Plans'}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">
                        {isAr ? 'إنشاء وإدارة باقات الاشتراك للبائعين.' : 'Create and manage vendor subscription plans.'}
                    </p>
                </div>
                <button
                    onClick={openCreate}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl font-bold shadow-lg shadow-red-500/20 transition-all"
                >
                    <Plus size={18} />
                    {isAr ? 'إضافة باقة' : 'Add Package'}
                </button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
                    {error}
                </div>
            )}
            {success && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-xl text-sm font-bold">
                    {success}
                </div>
            )}

            <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                        <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/5">
                            <tr className={isAr ? 'text-right' : 'text-left'}>
                                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الباقة' : 'Package'}</th>
                                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الفترة' : 'Billing'}</th>
                                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'السعر' : 'Price'}</th>
                                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'المنتجات' : 'Products'}</th>
                                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الحالة' : 'Status'}</th>
                                <th className={`px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px] ${isAr ? 'text-left' : 'text-right'}`}>{isAr ? 'إجراءات' : 'Actions'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                            {packages.map(pkg => {
                                const isActive = pkg.status === 'active';
                                return (
                                    <tr key={pkg._id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${isActive ? 'bg-marine-cyan/10 text-marine-primary' : 'bg-zinc-100 text-zinc-400 dark:bg-white/5'}`}>
                                                    {pkg.is_free_trial ? <Gift size={18} /> : <CreditCard size={18} />}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-black text-zinc-900 dark:text-white">{pkg.name}</p>
                                                        {pkg.is_free_trial && (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                                                                <Gift size={9} />
                                                                {isAr ? 'تجريبي' : 'Trial'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {pkg.description && <p className="text-xs text-zinc-500 max-w-[200px] truncate">{pkg.description}</p>}
                                                    {pkg.is_free_trial && pkg.trial_days > 0 && (
                                                        <p className="text-xs text-emerald-600 font-bold">{pkg.trial_days} {isAr ? 'يوم' : 'days'}</p>
                                                    )}
                                                    {(pkg.grants_vendors_page !== false || pkg.grants_home_slider === true) && (
                                                        <div className="flex flex-wrap items-center gap-1 mt-1">
                                                            {pkg.grants_vendors_page !== false && (
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400" title={isAr ? 'الظهور في صفحة البائعين' : 'Show on vendors page'}>
                                                                    <Store size={9} />
                                                                    {isAr ? 'البائعين' : 'Vendors'}
                                                                </span>
                                                            )}
                                                            {pkg.grants_home_slider === true && (
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400" title={isAr ? 'الظهور في سلايدر الرئيسية' : 'Show in homepage slider'}>
                                                                    <Home size={9} />
                                                                    {isAr ? 'الرئيسية' : 'Home'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-xs font-bold px-3 py-1 rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300">
                                                {pkg.billing_period === 'trial'
                                                    ? (isAr ? 'تجريبي' : 'Trial')
                                                    : pkg.billing_period === 'yearly'
                                                        ? (isAr ? 'سنوي' : 'Yearly')
                                                        : (isAr ? 'شهري' : 'Monthly')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-black text-zinc-900 dark:text-white">{Number(pkg.price).toFixed(2)}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-bold text-zinc-600 dark:text-zinc-300">{pkg.max_products}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase ${isActive ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400'}`}>
                                                {isActive ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                                                {isActive ? (isAr ? 'نشط' : 'Active') : (isAr ? 'غير نشط' : 'Inactive')}
                                            </span>
                                        </td>
                                        <td className={`px-6 py-4 ${isAr ? 'text-left' : 'text-right'}`}>
                                            <div className="inline-flex items-center gap-2">
                                                <button
                                                    onClick={() => openEdit(pkg)}
                                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => toggleStatus(pkg)}
                                                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black transition-colors ${isActive ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400'}`}
                                                >
                                                    {isActive ? (isAr ? 'إلغاء تفعيل' : 'Deactivate') : (isAr ? 'تفعيل' : 'Activate')}
                                                </button>
                                                <button
                                                    onClick={() => deletePackage(pkg)}
                                                    disabled={deletingId === pkg._id}
                                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 disabled:opacity-50"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {packages.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-16 text-center">
                                        <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'لا توجد باقات بعد' : 'No packages yet'}</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {showModal && (
                <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-xl max-h-[calc(100vh-2rem)] bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5 shrink-0">
                            <div>
                                <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                                    {editingId ? (isAr ? 'تعديل الباقة' : 'Edit Package') : (isAr ? 'إضافة باقة جديدة' : 'Add New Package')}
                                </h2>
                            </div>
                            <button onClick={() => setShowModal(false)} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                            <div className="min-h-0 flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                        {isAr ? 'اسم الباقة بالإنجليزية' : 'Package Name (English)'}
                                    </label>
                                    <input required type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                                        className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan" />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                        {isAr ? 'اسم الباقة بالعربية' : 'Package Name (Arabic)'}
                                    </label>
                                    <input dir="rtl" type="text" value={form.name_ar} onChange={e => setForm({ ...form, name_ar: e.target.value })}
                                        className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan" />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                        {isAr ? 'الوصف بالإنجليزية' : 'Description (English)'}
                                    </label>
                                    <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2}
                                        className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan resize-none" />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                        {isAr ? 'الوصف بالعربية' : 'Description (Arabic)'}
                                    </label>
                                    <textarea dir="rtl" value={form.description_ar} onChange={e => setForm({ ...form, description_ar: e.target.value })} rows={2}
                                        className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan resize-none" />
                                </div>

                                {!form.is_free_trial && (
                                    <>
                                        <div>
                                            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                                {isAr ? 'السعر' : 'Price'}
                                            </label>
                                            <input required={!form.is_free_trial} type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}
                                                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan" />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                                {isAr ? 'فترة الفوترة' : 'Billing Period'}
                                            </label>
                                            <select value={form.billing_period} onChange={e => setForm({ ...form, billing_period: e.target.value })}
                                                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan">
                                                <option value="monthly">{isAr ? 'شهري' : 'Monthly'}</option>
                                                <option value="yearly">{isAr ? 'سنوي' : 'Yearly'}</option>
                                            </select>
                                        </div>
                                    </>
                                )}

                                <div>
                                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                        {isAr ? 'الحد الأقصى للمنتجات' : 'Max Products'}
                                    </label>
                                    <input required type="number" min="1" value={form.max_products} onChange={e => setForm({ ...form, max_products: e.target.value })}
                                        className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan" />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                        {isAr ? 'الحالة' : 'Status'}
                                    </label>
                                    <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                                        className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan">
                                        <option value="active">{isAr ? 'نشط' : 'Active'}</option>
                                        <option value="inactive">{isAr ? 'غير نشط' : 'Inactive'}</option>
                                    </select>
                                </div>

                                {/* Free Trial Section */}
                                <div className="md:col-span-2">
                                    <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 space-y-3">
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <div
                                                onClick={() => setForm(prev => ({ ...prev, is_free_trial: !prev.is_free_trial, trial_days: '' }))}
                                                className={`relative w-11 h-6 rounded-full transition-colors ${form.is_free_trial ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-700'}`}
                                            >
                                                <div className={`absolute top-0.5 start-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.is_free_trial ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </div>
                                            <div>
                                                <span className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                                    <Gift size={14} className="text-emerald-500" />
                                                    {isAr ? 'خطة تجريبية مجانية' : 'Free Trial Plan'}
                                                </span>
                                                <p className="text-xs text-zinc-500 mt-0.5">{isAr ? 'يمكن لكل بائع استخدام هذه الخطة مرة واحدة فقط' : 'Each vendor can use this plan only once'}</p>
                                            </div>
                                        </label>
                                        {form.is_free_trial && (
                                            <div>
                                                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                                    {isAr ? 'عدد أيام التجربة' : 'Trial Duration (days)'}
                                                </label>
                                                <input
                                                    required={form.is_free_trial}
                                                    type="number" min="1"
                                                    value={form.trial_days}
                                                    onChange={e => setForm({ ...form, trial_days: e.target.value })}
                                                    placeholder={isAr ? 'مثال: 14' : 'e.g. 14'}
                                                    className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Vendor Visibility Perks — applied automatically while subscribed, reset on expiry */}
                                <div className="md:col-span-2">
                                    <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 space-y-3">
                                        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                                            {isAr ? 'مزايا ظهور البائع' : 'Vendor Visibility Perks'}
                                        </p>
                                        <p className="text-xs text-zinc-500 -mt-1">
                                            {isAr
                                                ? 'تُطبَّق تلقائياً على البائع عند اشتراكه في هذه الباقة، وتُلغى عند انتهاء الاشتراك.'
                                                : 'Applied to the vendor automatically while subscribed to this package, and reset when the subscription ends.'}
                                        </p>

                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <div
                                                onClick={() => setForm(prev => ({ ...prev, grants_vendors_page: !prev.grants_vendors_page }))}
                                                className={`relative w-11 h-6 rounded-full transition-colors ${form.grants_vendors_page ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-700'}`}
                                            >
                                                <div className={`absolute top-0.5 start-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.grants_vendors_page ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </div>
                                            <span className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                                <Store size={14} className="text-emerald-500" />
                                                {isAr ? 'الظهور في صفحة البائعين' : 'Show on vendors page'}
                                            </span>
                                        </label>

                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <div
                                                onClick={() => setForm(prev => ({ ...prev, grants_home_slider: !prev.grants_home_slider }))}
                                                className={`relative w-11 h-6 rounded-full transition-colors ${form.grants_home_slider ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-700'}`}
                                            >
                                                <div className={`absolute top-0.5 start-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.grants_home_slider ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </div>
                                            <span className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                                <Home size={14} className="text-emerald-500" />
                                                {isAr ? 'الظهور في سلايدر الصفحة الرئيسية' : 'Show in homepage slider'}
                                            </span>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <div className="shrink-0 flex justify-end gap-3 p-5 border-t border-zinc-100 dark:border-white/5 bg-white dark:bg-[#14171A]">
                                <button type="button" onClick={() => setShowModal(false)}
                                    className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold">
                                    {isAr ? 'إلغاء' : 'Cancel'}
                                </button>
                                <button type="submit" disabled={saving}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold">
                                    {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                                    {isAr ? 'حفظ الباقة' : 'Save Package'}
                                </button>
                            </div>
                        </form>
                    </div>
                </Overlay>
            )}
        </div>
    );
}
