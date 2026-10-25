'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, CreditCard, Package, RefreshCw, Calendar, AlertCircle, X, Gift } from 'lucide-react';
import { subscriptionApi } from '../../../lib/api';
import { useApp } from '../../../context/AppContext';
import Overlay from '../../../components/Overlay';

function formatDate(dateStr, isAr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString(isAr ? 'ar-EG' : 'en-US');
}

export default function VendorSubscriptionPage() {
    const { language, t } = useApp();
    const isAr = language === 'ar';

    const [status, setStatus] = useState(null);
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [purchasing, setPurchasing] = useState(false);
    const [purchasingId, setPurchasingId] = useState(null);
    const [billingPeriod, setBillingPeriod] = useState('monthly');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showSelectProducts, setShowSelectProducts] = useState(false);
    const [selectProductError, setSelectProductError] = useState(null);
    const [selectedProducts, setSelectedProducts] = useState([]);
    const [usedFreeTrial, setUsedFreeTrial] = useState(false);

    const loadData = async () => {
        setLoading(true);
        setError('');
        try {
            const [statusData, packagesData, freeTrialData] = await Promise.all([
                subscriptionApi.getStatus(),
                subscriptionApi.getPackages(),
                subscriptionApi.checkFreeTrial(),
            ]);
            setStatus(statusData);
            setPackages(packagesData.packages || []);
            setUsedFreeTrial(freeTrialData?.usedFreeTrial || false);
        } catch (err) {
            setError(isAr ? 'تعذر تحميل بيانات الاشتراك.' : (err.message || 'Failed to load subscription data.'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const paymentStatus = params.get('payment');
        const paymentId = params.get('paymentId');
        const invoiceId = params.get('invoice_id');

        if (paymentStatus === 'success') {
            const confirmPayment = async () => {
                try {
                    const result = await subscriptionApi.confirmPayment({ paymentId, invoice_id: invoiceId });
                    if (result.status === 'paid') {
                        setSuccess(isAr ? 'تم تأكيد الدفع وتفعيل الاشتراك.' : 'Payment confirmed and subscription activated.');
                    } else {
                        setSuccess(isAr ? 'تم الدفع بنجاح. سيتم تحديث اشتراكك بعد تأكيد بوابة الدفع.' : 'Payment successful. Your subscription will update after payment confirmation.');
                    }
                } catch (err) {
                    setSuccess(isAr ? 'تم الدفع بنجاح. سيتم تحديث اشتراكك بعد تأكيد بوابة الدفع.' : 'Payment successful. Your subscription will update after payment confirmation.');
                } finally {
                    loadData();
                }
            };

            confirmPayment();
        } else if (paymentStatus === 'pending') {
            setSuccess(isAr ? 'عملية الدفع قيد الانتظار.' : 'Payment is pending.');
            loadData();
        } else if (paymentStatus === 'failed') {
            setError(isAr ? 'فشلت عملية الدفع أو تم إلغاؤها.' : 'Payment failed or was cancelled.');
        }
    }, [isAr]);

    const handlePaymentResult = (res, successMessage) => {
        if (res?.requiresPayment && res.paymentUrl) {
            window.location.href = res.paymentUrl;
            return;
        }

        setSuccess(successMessage);
        loadData();
    };

    const purchasePackage = async (pkg) => {
        setPurchasingId(pkg._id);
        setError('');
        setSuccess('');
        try {
            if (hasActive) {
                const res = await subscriptionApi.changePlan(pkg._id, billingPeriod, []);
                handlePaymentResult(res, isAr ? 'تم تغيير خطة الاشتراك بنجاح!' : 'Subscription plan changed successfully!');
            } else if (['expired', 'cancelled'].includes(subscriptionStatus)) {
                const res = await subscriptionApi.resubscribe(pkg._id, billingPeriod, []);
                handlePaymentResult(res, isAr ? 'تم تفعيل الاشتراك بنجاح!' : 'Subscription activated successfully!');
            } else {
                const res = await subscriptionApi.purchase(pkg._id, billingPeriod);
                handlePaymentResult(res, isAr ? 'تم تفعيل الاشتراك بنجاح!' : 'Subscription activated successfully!');
            }
        } catch (err) {
            if (err.code === 'SELECT_PRODUCTS_REQUIRED') {
                setSelectedProducts({
                    packageId: pkg._id,
                    productIds: [],
                    pkg,
                    action: hasActive ? 'change_plan' : 'resubscribe',
                });
                setSelectProductError(err);
                setShowSelectProducts(true);
            } else if (err.code === 'FREE_TRIAL_ALREADY_USED') {
                setError(isAr ? 'لقد استخدمت التجربة المجانية بالفعل. يرجى اختيار باقة مدفوعة.' : 'You have already used your free trial. Please select a paid plan.');
            } else if (err.code === 'SAME_PACKAGE') {
                setError(isAr ? 'هذه هي باقتك الحالية بالفعل.' : 'This is already your current plan.');
            } else if (err.code === 'PRODUCT_LIMIT_EXCEEDED') {
                setError(isAr ? 'عدد المنتجات المنشورة يتجاوز الحد المسموح لهذه الباقة.' : err.message);
            } else {
                setError(isAr ? 'تعذر شراء الاشتراك. يرجى المحاولة مرة أخرى.' : (err.message || 'Failed to purchase subscription.'));
            }
        } finally {
            setPurchasingId(null);
        }
    };

    const renewSubscription = async () => {
        setPurchasing(true);
        setError('');
        setSuccess('');
        try {
            const res = await subscriptionApi.renew(billingPeriod);
            handlePaymentResult(res, isAr ? 'تم تجديد الاشتراك بنجاح!' : 'Subscription renewed successfully!');
        } catch (err) {
            setError(isAr ? 'تعذر تجديد الاشتراك.' : (err.message || 'Failed to renew subscription.'));
        } finally {
            setPurchasing(false);
        }
    };

    const confirmProductSelection = async () => {
        const selectedPkg = selectedProducts.pkg;
        if (!selectedPkg) return;

        setPurchasing(true);
        setError('');
        setSuccess('');
        try {
            const request = selectedProducts.action === 'change_plan'
                ? subscriptionApi.changePlan
                : subscriptionApi.resubscribe;
            const res = await request(selectedProducts.packageId, billingPeriod, selectedProducts.productIds);
            handlePaymentResult(
                res,
                selectedProducts.action === 'change_plan'
                    ? (isAr ? 'تم تغيير خطة الاشتراك بنجاح!' : 'Subscription plan changed successfully!')
                    : (isAr ? 'تم إعادة تفعيل حسابك بنجاح!' : 'Account reactivated successfully!')
            );
            setShowSelectProducts(false);
            setSelectedProducts([]);
        } catch (err) {
            if (err.code === 'SELECT_PRODUCTS_REQUIRED') {
                setSelectProductError(err);
                setShowSelectProducts(true);
            } else if (err.code === 'FREE_TRIAL_ALREADY_USED') {
                setError(isAr ? 'لقد استخدمت التجربة المجانية بالفعل. يرجى اختيار باقة مدفوعة.' : 'You have already used your free trial. Please select a paid plan.');
            } else {
                setError(isAr ? 'تعذر إعادة الاشتراك.' : (err.message || 'Failed to resubscribe.'));
            }
        } finally {
            setPurchasing(false);
        }
    };

    const openSelectProducts = (pkg) => {
        setSelectedProducts({
            packageId: pkg._id,
            productIds: [],
            pkg,
            action: hasActive ? 'change_plan' : 'resubscribe',
        });
        setSelectProductError(null);
        if (selectProductError?.allProducts) {
            setSelectProductError({ ...selectProductError, maxProducts: pkg.max_products, excessCount: status.publishedCount - pkg.max_products });
        }
        setShowSelectProducts(true);
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 size={32} className="animate-spin text-marine-primary" />
            </div>
        );
    }

    const subscriptionStatus = status?.subscriptionStatus;
    const { hasActive, subscription, package: pkg, publishedCount, maxProducts, remaining } = status || {};
    const progress = maxProducts > 0 ? Math.round((publishedCount / maxProducts) * 100) : 0;
    const packageName = (packageData) => isAr
        ? (packageData?.name_ar || packageData?.name || 'باقة اشتراك')
        : (packageData?.name || packageData?.name_ar || 'Subscription');
    const packageDescription = (packageData) => isAr
        ? (packageData?.description_ar || packageData?.description || '')
        : (packageData?.description || packageData?.description_ar || '');

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
                    {isAr ? 'إدارة الاشتراك' : 'Subscription Management'}
                </h1>
                <p className="text-sm text-zinc-500 mt-1">
                    {isAr ? 'إدارة باقة الاشتراك والمنتجات المنشورة.' : 'Manage your subscription plan and published products.'}
                </p>
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

            {/* Not Subscribed / Expired / Cancelled Banner */}
            {!hasActive && ['not_subscribed', 'expired', 'cancelled'].includes(subscriptionStatus) && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="text-red-600 mt-0.5 shrink-0" size={20} />
                    <div>
                        <p className="font-black text-red-600 dark:text-red-400">
                            {isAr ? 'لا يوجد اشتراك نشط!' : 'No active subscription!'}
                        </p>
                        <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">
                            {subscriptionStatus === 'expired'
                                ? (isAr ? 'انتهى اشتراكك. يرجى إعادة الاشتراك للمتابعة.' : 'Your subscription has expired. Please resubscribe to continue.')
                                : (isAr ? 'لم تقم بشراء اشتراك بعد. اشترِ باقة للبدء بنشر منتجاتك.' : 'You have not subscribed yet. Purchase a plan to start publishing products.')}
                        </p>
                    </div>
                </div>
            )}

            {/* Suspended (admin) Banner */}
            {!hasActive && subscriptionStatus === 'suspended' && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle className="text-red-600 mt-0.5 shrink-0" size={20} />
                    <div>
                        <p className="font-black text-red-600 dark:text-red-400">
                            {isAr ? 'حسابك معلق!' : 'Your account is suspended!'}
                        </p>
                        <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">
                            {isAr ? 'تم تعليق حسابك بواسطة الإدارة.' : 'Your account has been suspended by the admin.'}
                        </p>
                    </div>
                </div>
            )}

            {/* Active Subscription Card */}
            {hasActive && (
                <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
                    <div className="p-6">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-xl bg-marine-cyan/10 text-marine-primary flex items-center justify-center">
                                    <CreditCard size={24} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-lg font-black text-zinc-900 dark:text-white">{packageName(pkg)}</h2>
                                        {subscription?.is_free_trial && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                                                <Gift size={10} />
                                                {isAr ? 'تجربة' : 'Free Trial'}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-zinc-500">{packageDescription(pkg)}</p>
                                </div>
                            </div>
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                                <CheckCircle2 size={12} />
                                {isAr ? 'نشط' : 'Active'}
                            </span>
                        </div>

                        {/* Product Usage */}
                        <div className="mb-4">
                            <div className="flex justify-between text-sm mb-2">
                                <span className="font-bold text-zinc-600 dark:text-zinc-300">{isAr ? 'المنتجات المنشورة' : 'Published Products'}</span>
                                <span className="font-black text-zinc-900 dark:text-white">{publishedCount} / {maxProducts}</span>
                            </div>
                            <div className="w-full bg-zinc-100 dark:bg-white/10 rounded-full h-3">
                                <div className={`h-3 rounded-full transition-all ${progress >= 90 ? 'bg-red-500' : progress >= 70 ? 'bg-amber-500' : 'bg-marine-cyan'}`}
                                    style={{ width: `${Math.min(progress, 100)}%` }} />
                            </div>
                            {remaining <= 0 && (
                                <p className="text-xs text-red-600 mt-2 font-bold">
                                    {isAr ? 'وصلت إلى الحد الأقصى! قم بالترقية لإضافة منتجات أخرى.' : 'You reached the limit! Upgrade to add more products.'}
                                </p>
                            )}
                            {remaining > 0 && remaining <= 2 && (
                                <p className="text-xs text-amber-600 mt-2 font-bold">
                                    {isAr ? `بقي ${remaining} منتجات فقط!` : `Only ${remaining} slots left!`}
                                </p>
                            )}
                        </div>

                        {/* Subscription Details */}
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                            <div className="bg-zinc-50 dark:bg-[#0E1012] rounded-xl p-3">
                                <p className="text-[10px] font-black uppercase text-zinc-400 mb-1">{isAr ? 'يبدأ' : 'Started'}</p>
                                <p className="text-sm font-bold text-zinc-900 dark:text-white">{formatDate(subscription?.started_at, isAr)}</p>
                            </div>
                            <div className="bg-zinc-50 dark:bg-[#0E1012] rounded-xl p-3">
                                <p className="text-[10px] font-black uppercase text-zinc-400 mb-1">{isAr ? 'ينتهي' : 'Expires'}</p>
                                <p className="text-sm font-bold text-zinc-900 dark:text-white">{formatDate(subscription?.expires_at, isAr)}</p>
                            </div>
                            <div className="bg-zinc-50 dark:bg-[#0E1012] rounded-xl p-3">
                                <p className="text-[10px] font-black uppercase text-zinc-400 mb-1">{isAr ? 'الفوترة' : 'Billing'}</p>
                                <p className="text-sm font-bold text-zinc-900 dark:text-white">
                                    {subscription?.is_free_trial
                                        ? (isAr ? `تجريبي (${pkg?.trial_days || ''}ي)` : `Trial (${pkg?.trial_days || ''}d)`)
                                        : pkg?.billing_period === 'yearly'
                                            ? (isAr ? 'سنوي' : 'Yearly')
                                            : (isAr ? 'شهري' : 'Monthly')}
                                </p>
                            </div>
                        </div>

                        {/* Renewal */}
                        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                            <select value={billingPeriod} onChange={e => setBillingPeriod(e.target.value)}
                                className="bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none">
                                <option value="monthly">{isAr ? 'شهري' : 'Monthly'}</option>
                                <option value="yearly">{isAr ? 'سنوي' : 'Yearly'}</option>
                            </select>
                            <button onClick={renewSubscription} disabled={purchasing}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold transition-all">
                                {purchasing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                {isAr ? 'تجديد الاشتراك' : 'Renew Subscription'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Subscription Packages */}
            <div>
                <h2 className="text-lg font-black text-zinc-900 dark:text-white mb-4">
                    {isAr ? 'خطط الاشتراك المتاحة' : 'Available Subscription Plans'}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {packages.map(pkg => {
                        const isCurrent = hasActive && status?.package?._id === pkg._id;
                        const isFreeTrialPkg = pkg.is_free_trial;
                        const canUseTrial = isFreeTrialPkg && !usedFreeTrial;

                        return (
                            <div key={pkg._id} className={`bg-white dark:bg-[#14171A] rounded-xl border ${isCurrent ? 'border-marine-cyan shadow-lg shadow-red-500/10' : 'border-zinc-200 dark:border-white/5'} p-5 relative`}>
                                {isCurrent && (
                                    <span className="absolute -top-3 start-4 px-3 py-1 bg-marine-cyan text-white text-[10px] font-black rounded-full uppercase">
                                        {isAr ? 'باقتك الحالية' : 'Current Plan'}
                                    </span>
                                )}
                                {isFreeTrialPkg && !isCurrent && (
                                    <span className="absolute -top-3 end-4 px-3 py-1 bg-emerald-500 text-white text-[10px] font-black rounded-full uppercase">
                                        <Gift size={10} className="inline mr-1" />
                                        {isAr ? 'تجربة مجانية' : 'Free Trial'}
                                    </span>
                                )}
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-10 h-10 rounded-xl bg-marine-cyan/10 text-marine-primary flex items-center justify-center">
                                        <Package size={18} />
                                    </div>
                                    <div>
                                        <h3 className="font-black text-zinc-900 dark:text-white">{packageName(pkg)}</h3>
                                        <p className="text-xs text-zinc-500">{pkg.max_products} {isAr ? 'منتج' : 'products'}</p>
                                    </div>
                                </div>
                                <p className="text-sm text-zinc-500 mb-3">{packageDescription(pkg)}</p>
                                {isFreeTrialPkg ? (
                                    <div className="mb-4">
                                        <p className="text-lg font-black text-emerald-600">{isAr ? 'مجاني' : 'Free'}</p>
                                        {pkg.trial_days > 0 && (
                                            <p className="text-xs text-zinc-400 mt-0.5">{pkg.trial_days} {isAr ? 'يوم تجريبي' : 'trial days'}</p>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex items-baseline gap-1 mb-4">
                                        <span className="text-2xl font-black text-zinc-900 dark:text-white">{Number(pkg.price).toFixed(2)}</span>
                                        <span className="text-xs text-zinc-400">/ {pkg.billing_period === 'yearly' ? (isAr ? 'سنوي' : 'year') : (isAr ? 'شهري' : 'month')}</span>
                                    </div>
                                )}

                                {isCurrent ? (
                                    <div className="text-center py-2 text-xs font-bold text-marine-primary">
                                        {isAr ? '✓ باقتك الحالية' : '✓ Current Plan'}
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => purchasePackage(pkg)}
                                        disabled={purchasingId === pkg._id || (isFreeTrialPkg && usedFreeTrial)}
                                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold text-sm transition-all">
                                        {purchasingId === pkg._id ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
                                        {isFreeTrialPkg ? (isAr ? 'تجربة مجانية' : 'Free Trial') : (isAr ? 'اشتراك' : 'Subscribe')}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                    {packages.length === 0 && (
                        <div className="col-span-3 text-center py-8">
                            <Package size={32} className="mx-auto text-zinc-300 mb-2" />
                            <p className="text-sm font-bold text-zinc-500">{isAr ? 'لا توجد باقات متاحة حالياً' : 'No packages available at the moment'}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Product Selection Modal (for resubscribe) */}
            {showSelectProducts && selectProductError && (
                <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5 shrink-0">
                            <div>
                                <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                                    {isAr ? 'اختر المنتجات للنشر' : 'Select Products to Publish'}
                                </h2>
                                <p className="text-xs text-zinc-500 mt-1">
                                    {isAr
                                        ? `باقتك تسمح بـ ${selectProductError.maxProducts} منتجات. اختر ${selectProductError.maxProducts} من قائمة منتجاتك.`
                                        : `Your plan allows ${selectProductError.maxProducts} products. Select up to ${selectProductError.maxProducts} from your products.`}
                                </p>
                            </div>
                            <button onClick={() => setShowSelectProducts(false)} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-2">
                            {selectProductError.allProducts?.map(p => {
                                const isSelected = selectedProducts.productIds?.includes(p._id);
                                const canSelect = (selectedProducts.productIds?.length || 0) < selectProductError.maxProducts;
                                return (
                                    <div key={p._id}
                                        onClick={() => {
                                            if (isSelected) {
                                                setSelectedProducts(prev => ({ ...prev, productIds: prev.productIds.filter(id => id !== p._id) }));
                                            } else if (canSelect) {
                                                setSelectedProducts(prev => ({ ...prev, productIds: [...(prev.productIds || []), p._id] }));
                                            }
                                        }}
                                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${isSelected ? 'border-marine-cyan bg-marine-cyan/5' : 'border-zinc-200 dark:border-white/10 hover:border-zinc-300'}`}>
                                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-marine-cyan border-marine-cyan' : 'border-zinc-300'}`}>
                                            {isSelected && <CheckCircle2 size={14} className="text-white" />}
                                        </div>
                                        <p className="text-sm font-bold text-zinc-900 dark:text-white">
                                            {isAr ? (p.title_ar || p.title || p.title_en || 'منتج') : (p.title_en || p.title || p.title_ar || 'Product')}
                                        </p>
                                    </div>
                                );
                            })}
                            {(!selectProductError.allProducts || selectProductError.allProducts.length === 0) && (
                                <p className="text-center text-sm text-zinc-500 py-4">{isAr ? 'لا توجد منتجات' : 'No products'}</p>
                            )}
                        </div>

                        <div className="p-5 border-t border-zinc-100 dark:border-white/5 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 shrink-0 bg-white dark:bg-[#14171A]">
                            <p className="text-sm text-zinc-500">
                                {selectedProducts.productIds?.length || 0} / {selectProductError.maxProducts} {isAr ? 'تم الاختيار' : 'selected'}
                            </p>
                            <div className="flex flex-col sm:flex-row gap-3">
                                <button onClick={() => setShowSelectProducts(false)}
                                    className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold text-sm">
                                    {isAr ? 'إلغاء' : 'Cancel'}
                                </button>
                                <button onClick={confirmProductSelection} disabled={purchasing || !selectedProducts.productIds?.length}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold text-sm">
                                    {purchasing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                    {selectedProducts.action === 'change_plan'
                                        ? (isAr ? 'تغيير الخطة' : 'Change Plan')
                                        : (isAr ? 'إعادة تفعيل الاشتراك' : 'Reactivate Subscription')}
                                </button>
                            </div>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}
