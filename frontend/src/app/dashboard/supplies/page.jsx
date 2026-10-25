'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    Loader2, Package, ShoppingCart, Plus, Minus, Trash2, Wallet,
    CreditCard, AlertCircle, CheckCircle2, Boxes, Sticker, Tag, Mail,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { vendorApi, vendorWalletApi } from '../../../lib/api';
import {
    SUPPLY_CATEGORIES, ORDER_STATUSES, PAYMENT_STATUSES, DELIVERY_METHODS,
    label, toneClasses, packLabel, suppliesCopy,
} from '../../../lib/suppliesLocalization';

const CATEGORY_ICONS = { poly_mailer: Mail, box: Boxes, sticker: Sticker, label: Tag, other: Package };

/**
 * The vendor's supplies shop.
 *
 * The one thing this page has to get right is the money: the vendor must see, BEFORE
 * confirming, exactly how much comes out of their wallet and how much they will be asked to
 * pay online. The split is computed here from the live balance and shown under the total,
 * so nobody is surprised by a payment page they did not expect.
 */
export default function VendorSuppliesPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const copy = useMemo(() => suppliesCopy(isAr), [isAr]);
    const searchParams = useSearchParams();

    const [catalogue, setCatalogue] = useState([]);
    const [orders, setOrders] = useState([]);
    const [wallet, setWallet] = useState(null);
    const [cart, setCart] = useState({});
    const [category, setCategory] = useState('all');
    const [loading, setLoading] = useState(true);
    const [placing, setPlacing] = useState(false);
    const [busyOrder, setBusyOrder] = useState('');
    const [message, setMessage] = useState({ type: '', text: '' });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [cat, ord, walletRes] = await Promise.all([
                vendorApi.getSuppliesCatalogue(),
                vendorApi.getSupplyOrders({ limit: 20 }),
                // Read fresh rather than cached: the split shown under the basket is only
                // honest if it is computed from the balance the server will use.
                vendorWalletApi.getWallet().catch(() => null),
            ]);
            setCatalogue(cat.products || []);
            setOrders(ord.orders || []);
            setWallet(walletRes?.wallet || null);
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Coming back from the hosted payment page. The query string is only a hint — the
    // server re-reads the payment from the provider and settles the order itself, so a
    // lost or rejected webhook no longer leaves a paid order on "awaiting payment".
    useEffect(() => {
        const payment = searchParams.get('payment');
        if (!payment) return;
        const orderId = searchParams.get('orderId');

        if (payment === 'failed') {
            setMessage({ type: 'error', text: isAr ? 'الدفع ما تمّش. تقدر تحاول تاني من الطلب.' : 'The payment did not go through. You can retry it from the order below.' });
            return;
        }
        if (!orderId) {
            setMessage({ type: 'info', text: isAr ? 'الدفع لسه بيتأكد.' : 'The payment is still being confirmed.' });
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const res = await vendorApi.confirmSupplyPayment(orderId);
                if (cancelled) return;
                if (res.status === 'paid') {
                    setMessage({ type: 'success', text: isAr ? 'تم تأكيد الدفع. طلبك في طريقه للمراجعة.' : 'Payment confirmed. Your order is on its way to review.' });
                } else {
                    setMessage({ type: 'info', text: isAr ? 'الدفع لسه بيتأكد من بوابة الدفع. هيتحدّث تلقائيًا.' : 'The payment is still being confirmed by the gateway. It will update on its own.' });
                }
            } catch (_) {
                if (cancelled) return;
                setMessage({ type: 'info', text: isAr ? 'الدفع لسه بيتأكد من بوابة الدفع. هيتحدّث تلقائيًا.' : 'The payment is still being confirmed by the gateway. It will update on its own.' });
            } finally {
                if (!cancelled) load();
            }
        })();
        return () => { cancelled = true; };
    }, [searchParams, isAr, load]);

    const shown = catalogue.filter((p) => category === 'all' || p.category === category);

    const setQty = (product, quantity) => {
        setCart((c) => {
            const next = { ...c };
            const min = product.min_order_quantity || 1;
            const max = product.max_order_quantity || Infinity;
            const q = Math.min(max, Math.max(0, quantity));
            if (q <= 0) delete next[product._id];
            else next[product._id] = { product, quantity: Math.max(min, q) };
            return next;
        });
    };

    const lines = Object.values(cart);
    const total = lines.reduce((sum, l) => sum + l.quantity * l.product.price, 0);
    const available = Number(wallet?.available_balance || 0);
    // Mirrors the server's split exactly: the wallet pays what it can, the rest goes online.
    const fromWallet = Math.min(available, total);
    const payOnline = Math.max(0, total - fromWallet);

    const placeOrder = async () => {
        setPlacing(true);
        setMessage({ type: '', text: '' });
        try {
            const res = await vendorApi.placeSupplyOrder({
                items: lines.map((l) => ({ product_id: l.product._id, quantity: l.quantity })),
            });
            setCart({});
            if (res.payment_url) {
                // The wallet did not cover it — hand the vendor straight to the gateway.
                window.location.href = res.payment_url;
                return;
            }
            setMessage({ type: 'success', text: isAr ? 'تم إرسال طلبك، واتخصم من محفظتك.' : 'Order placed and paid from your wallet.' });
            await load();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setPlacing(false);
        }
    };

    const payOrder = async (order) => {
        setBusyOrder(order._id);
        try {
            const res = await vendorApi.paySupplyOrder(order._id);
            if (res.payment_url) window.location.href = res.payment_url;
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusyOrder('');
        }
    };

    const cancelOrder = async (order) => {
        if (!confirm(isAr ? 'إلغاء الطلب ده؟' : 'Cancel this order?')) return;
        setBusyOrder(order._id);
        try {
            await vendorApi.cancelSupplyOrder(order._id, '');
            await load();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusyOrder('');
        }
    };

    if (loading) {
        return <div className="h-64 flex items-center justify-center"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;
    }

    return (
        <div className="p-6 space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
            <div>
                <h1 className="text-2xl font-black text-zinc-900 flex items-center gap-3">
                    <Package className="text-marine-primary" /> {copy.vendorTitle}
                </h1>
                <p className="text-sm text-zinc-500 mt-1">{copy.vendorIntro}</p>
            </div>

            {message.text && (
                <div className={`p-4 rounded-xl text-sm font-bold flex items-start gap-3 ${
                    message.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                    : message.type === 'error' ? 'bg-red-50 border border-red-200 text-red-700'
                    : 'bg-blue-50 border border-blue-200 text-blue-700'
                }`}>
                    {message.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
                    <span>{message.text}</span>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Catalogue */}
                <div className="lg:col-span-2 space-y-4">
                    <div className="flex flex-wrap gap-2">
                        {SUPPLY_CATEGORIES.map((c) => (
                            <button
                                key={c.value}
                                onClick={() => setCategory(c.value)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    category === c.value ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-300'
                                }`}
                            >
                                {isAr ? c.ar : c.en}
                            </button>
                        ))}
                    </div>

                    {shown.length === 0 ? (
                        <div className="bg-white border border-dashed border-zinc-200 rounded-2xl p-12 text-center">
                            <Package size={40} className="text-zinc-300 mx-auto mb-3" />
                            <p className="text-zinc-500 font-bold text-sm">{isAr ? 'لا توجد مستلزمات متاحة حالياً.' : 'No supplies available right now.'}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {shown.map((product) => {
                                const Icon = CATEGORY_ICONS[product.category] || Package;
                                const inCart = cart[product._id]?.quantity || 0;
                                return (
                                    <div key={product._id} className="bg-white border border-zinc-200 rounded-2xl p-4 flex flex-col gap-3">
                                        <div className="flex items-start gap-3">
                                            <div className="w-11 h-11 rounded-xl bg-red-50 text-marine-primary flex items-center justify-center shrink-0">
                                                <Icon size={20} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-black text-zinc-900 text-sm">{isAr ? (product.name_ar || product.name) : product.name}</p>
                                                {product.dimensions && <p className="text-xs text-zinc-500 mt-0.5">{product.dimensions}</p>}
                                                {product.description && (
                                                    <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                                                        {isAr ? (product.description_ar || product.description) : product.description}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-end justify-between gap-3 mt-auto">
                                            <div>
                                                <p className="text-lg font-black text-zinc-900">{product.price} <span className="text-xs font-bold text-zinc-500">{isAr ? 'ج.م' : 'EGP'}</span></p>
                                                <p className="text-[11px] text-zinc-500 font-bold">{packLabel(product, isAr)}</p>
                                            </div>

                                            {inCart > 0 ? (
                                                <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl p-1">
                                                    <button onClick={() => setQty(product, inCart - 1)} className="p-1.5 rounded-lg hover:bg-white text-zinc-600"><Minus size={14} /></button>
                                                    <span className="w-8 text-center font-black text-sm tabular-nums">{inCart}</span>
                                                    <button onClick={() => setQty(product, inCart + 1)} className="p-1.5 rounded-lg hover:bg-white text-zinc-600"><Plus size={14} /></button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setQty(product, product.min_order_quantity || 1)}
                                                    className="px-3 py-2 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white text-xs font-bold flex items-center gap-1.5"
                                                >
                                                    <Plus size={14} /> {copy.addToCart}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Basket */}
                <div className="space-y-4">
                    <div className="bg-white border border-zinc-200 rounded-2xl p-5 sticky top-4">
                        <h2 className="font-black text-zinc-900 flex items-center gap-2 mb-4">
                            <ShoppingCart size={18} className="text-marine-primary" /> {copy.cart}
                        </h2>

                        {lines.length === 0 ? (
                            <p className="text-sm text-zinc-400 py-6 text-center">{copy.emptyCart}</p>
                        ) : (
                            <>
                                <div className="space-y-3 mb-4">
                                    {lines.map(({ product, quantity }) => (
                                        <div key={product._id} className="flex items-center gap-3 text-sm">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-bold text-zinc-800 truncate">{isAr ? (product.name_ar || product.name) : product.name}</p>
                                                <p className="text-[11px] text-zinc-500">{quantity} × {product.price}</p>
                                            </div>
                                            <span className="font-black text-zinc-900 tabular-nums">{(quantity * product.price).toFixed(2)}</span>
                                            <button onClick={() => setQty(product, 0)} className="text-zinc-300 hover:text-red-500"><Trash2 size={14} /></button>
                                        </div>
                                    ))}
                                </div>

                                <div className="border-t border-zinc-100 pt-4 space-y-2 text-sm">
                                    <div className="flex justify-between font-black text-zinc-900">
                                        <span>{copy.total}</span>
                                        <span className="tabular-nums">{total.toFixed(2)} {isAr ? 'ج.م' : 'EGP'}</span>
                                    </div>
                                    {/* The split, shown before confirming rather than discovered afterwards. */}
                                    <div className="flex justify-between text-emerald-600 font-bold">
                                        <span className="flex items-center gap-1.5"><Wallet size={13} /> {copy.fromWallet}</span>
                                        <span className="tabular-nums">{fromWallet.toFixed(2)}</span>
                                    </div>
                                    {payOnline > 0 && (
                                        <div className="flex justify-between text-amber-600 font-bold">
                                            <span className="flex items-center gap-1.5"><CreditCard size={13} /> {copy.payOnline}</span>
                                            <span className="tabular-nums">{payOnline.toFixed(2)}</span>
                                        </div>
                                    )}
                                    <p className="text-[11px] text-zinc-400 pt-1">
                                        {copy.walletBalance}: <span className="font-bold text-zinc-600">{available.toFixed(2)} {isAr ? 'ج.م' : 'EGP'}</span>
                                    </p>
                                </div>

                                <button
                                    onClick={placeOrder}
                                    disabled={placing}
                                    className="w-full mt-4 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-60 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"
                                >
                                    {placing && <Loader2 size={16} className="animate-spin" />}
                                    {placing ? copy.placing : (payOnline > 0 ? `${copy.placeOrder} — ${copy.payOnline} ${payOnline.toFixed(2)}` : copy.placeOrder)}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Past orders */}
            <div className="space-y-3">
                <h2 className="font-black text-zinc-900 text-lg">{copy.myOrders}</h2>
                {orders.length === 0 ? (
                    <div className="bg-white border border-dashed border-zinc-200 rounded-2xl p-10 text-center">
                        <p className="text-zinc-500 font-bold text-sm">{copy.noOrders}</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {orders.map((order) => (
                            <div key={order._id} className="bg-white border border-zinc-200 rounded-2xl p-4">
                                <div className="flex flex-wrap items-center gap-3 mb-2">
                                    <span className="font-mono text-xs font-bold text-zinc-500">{order.order_number}</span>
                                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${toneClasses(ORDER_STATUSES[order.status]?.tone)}`}>
                                        {label(ORDER_STATUSES, order.status, isAr)}
                                    </span>
                                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${toneClasses(PAYMENT_STATUSES[order.payment_status]?.tone)}`}>
                                        {label(PAYMENT_STATUSES, order.payment_status, isAr)}
                                    </span>
                                    <span className="ms-auto font-black text-zinc-900 tabular-nums">{order.total} {isAr ? 'ج.م' : 'EGP'}</span>
                                </div>

                                <p className="text-xs text-zinc-500">
                                    {order.items.length} {copy.items} · {label(DELIVERY_METHODS, order.delivery?.method, isAr)}
                                    {order.delivery?.tracking_number && <span className="font-mono"> · {order.delivery.tracking_number}</span>}
                                </p>
                                {order.wallet_amount > 0 && (
                                    <p className="text-[11px] text-zinc-400 mt-1">
                                        {copy.fromWallet}: {order.wallet_amount} · {copy.payOnline}: {order.online_amount}
                                    </p>
                                )}
                                {order.rejection_reason && <p className="text-xs text-red-600 mt-1">{order.rejection_reason}</p>}
                                {order.admin_note && !order.rejection_reason && <p className="text-xs text-zinc-600 mt-1">{order.admin_note}</p>}

                                <div className="flex items-center gap-3 mt-3">
                                    {['awaiting_online', 'failed'].includes(order.payment_status) && !['cancelled', 'rejected'].includes(order.status) && (
                                        <button
                                            onClick={() => payOrder(order)}
                                            disabled={busyOrder === order._id}
                                            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"
                                        >
                                            {busyOrder === order._id ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={13} />}
                                            {copy.payNow} ({order.online_amount})
                                        </button>
                                    )}
                                    {order.status === 'pending' && (
                                        <button
                                            onClick={() => cancelOrder(order)}
                                            disabled={busyOrder === order._id}
                                            className="bg-white border border-zinc-200 hover:border-red-300 text-red-600 px-4 py-2 rounded-xl text-xs font-bold"
                                        >
                                            {copy.cancel}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
