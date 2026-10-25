'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from '../../../../../lib/navigation';
import Link from '../../../../../components/LocaleLink';
import { ArrowLeft, Loader2, CheckCircle2, XCircle, Clock, Truck, Package, Phone, PhoneCall, PhoneOff, Lock, Edit3, AlertTriangle, RefreshCw, History, Search, X, MapPin, RotateCcw, Trash2, ScanLine, ExternalLink, Undo2 } from 'lucide-react';
import { adminApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import OrderShippingPanel from '../../../../../components/dashboard/OrderShippingPanel';
import SmartLabelScanner from '../../../../../components/dashboard/SmartLabelScanner';
import AdminParcelCard from '../../../../../components/dashboard/AdminParcelCard';
import {
    ORDER_STATUS_META,
    ADMIN_SETTABLE_STATUSES,
    isBostaDrivenStatus,
    getParcelCounterLabel,
    getOrderStatusLabel,
    getOrderStatusColor,
    getShipmentStatusLabel,
    getShipmentStatusColor,
} from '../../../../../lib/orderStatus';
import { orgTerms } from '../../../../../lib/orgTerms';
import Overlay from '../../../../../components/Overlay';

// Admin can only manually set pre-dispatch statuses; the rest are Bosta-driven.
const ADMIN_STATUS_BUTTONS = ADMIN_SETTABLE_STATUSES.map((value) => ({
    value,
    ...ORDER_STATUS_META[value],
}));

const ITEM_STATUSES = [
    { value: 'pending', label_en: 'Pending', label_ar: 'قيد الانتظار', color: 'bg-amber-500/20 text-amber-500' },
    { value: 'approved', label_en: 'Approved', label_ar: 'تمت الموافقة', color: 'bg-emerald-500/20 text-emerald-500' },
    { value: 'declined', label_en: 'Declined', label_ar: 'مرفوض', color: 'bg-red-500/20 text-red-500' },
];

const formatDateTime = (value, locale = 'en-US') => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function AdminOrderDetailsPage({ params }) {
    const router = useRouter();
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'QAR';

    const [order, setOrder] = useState(null);
    // The phone-confirmation card: what the caller types, and which button is mid-flight.
    const [callNote, setCallNote] = useState('');
    const [callBusy, setCallBusy] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [actionMsg, setActionMsg] = useState('');

    // Per-item edit state
    const [editingItems, setEditingItems] = useState(false);
    const [itemUpdates, setItemUpdates] = useState([]);
    const [replacementModal, setReplacementModal] = useState(null);
    const [replacementProducts, setReplacementProducts] = useState([]);
    const [replacementLoading, setReplacementLoading] = useState(false);
    const [replacementSearch, setReplacementSearch] = useState('');
    const [replacementForm, setReplacementForm] = useState({
        product_id: '',
        variant_id: '',
        variant_label: '',
        quantity: 1,
        unit_price: '',
        reason: '',
    });

    // Bosta sending state
    const [bostaSending, setBostaSending] = useState(false);
    const [bostaMsg, setBostaMsg] = useState('');
    // Vendors whose parcel did not go out while the rest of the order did. Kept on screen
    // until dismissed — a half-dispatched order is exactly what an admin must not miss.
    const [bostaFailures, setBostaFailures] = useState([]);
    // Parcels the bulk send did not touch, with the reason. Used to be dropped on the
    // floor, so a parcel with neither a Smart Sticker nor a waybill vanished from a
    // "completed" send with no word about why.
    const [bostaSkipped, setBostaSkipped] = useState([]);
    // Which parcel is mid-action, so only that card goes busy.
    const [parcelBusy, setParcelBusy] = useState('');
    // Courier switch: the default and what each courier can do, for the parcel cards.
    const [couriersInfo, setCouriersInfo] = useState({ default: 'bosta', providers: [] });
    useEffect(() => {
        adminApi.getCouriers().then((r) => { if (r?.success) setCouriersInfo(r); }).catch(() => {});
    }, []);
    const [refreshingTracking, setRefreshingTracking] = useState(false);

    // How reliable this order's customer is — our own record and Bosta's ranking. Fetched
    // separately from the order because it can call Bosta, and the screen must render
    // whether or not a third party answers.
    const [codProfile, setCodProfile] = useState(null);
    const [codLoading, setCodLoading] = useState(false);

    // Fulfillment location edits per vendor
    const [fulfillmentEdits, setFulfillmentEdits] = useState({});
    const [vendorLocationsMap, setVendorLocationsMap] = useState({});

    // Pickup data
    const [orderPickups, setOrderPickups] = useState([]);

    const filteredReplacementProducts = useMemo(() => {
        const q = replacementSearch.trim().toLowerCase();
        if (!q) return replacementProducts;

        return replacementProducts.filter(product => {
            const title = `${product.title_en || ''} ${product.title_ar || ''}`.toLowerCase();
            const vendor = `${product.vendor_id?.store_name || ''} ${product.vendor_id?.store_username || ''}`.toLowerCase();
            return title.includes(q) || vendor.includes(q) || product.sku?.toLowerCase().includes(q);
        });
    }, [replacementProducts, replacementSearch]);

    const selectedReplacementProduct = useMemo(() => {
        return replacementProducts.find(product => product._id === replacementForm.product_id);
    }, [replacementProducts, replacementForm.product_id]);

    const getProductHref = (productOrSnapshot) => {
        const slug = productOrSnapshot?.slug_en || productOrSnapshot?.slug_ar || productOrSnapshot?.product_slug_en || productOrSnapshot?.product_slug_ar;
        return slug ? `/product/${slug}` : '';
    };

    /** Re-read the customer's ranking from Bosta rather than the cached copy. */
    const refreshCodProfile = async () => {
        setCodLoading(true);
        try {
            const res = await adminApi.getOrderCodProfile(params.id, true);
            setCodProfile(res.profile);
        } catch (err) {
            alert(err.message);
        } finally {
            setCodLoading(false);
        }
    };

    /**
     * Force cash on delivery open or shut for this customer, or hand them back to the rules.
     * A reason is asked for on every decision: the next admin to look at this needs to know
     * why a customer the numbers closed was reopened.
     */
    const setCodOverride = async (override) => {
        const userId = order?.user_id?._id || order?.user_id;
        if (!userId) return;
        const reason = override
            ? prompt(isAr ? 'السبب؟ (هيتسجل)' : 'Reason? (it is recorded)') || ''
            : '';
        if (override && reason === null) return;
        setCodLoading(true);
        try {
            const res = await adminApi.setUserCodOverride(userId, { override, reason });
            setCodProfile(res.profile);
        } catch (err) {
            alert(err.message);
        } finally {
            setCodLoading(false);
        }
    };

    useEffect(() => {
        const load = async () => {
            try {
                const data = await adminApi.getOrderById(params.id);
                setOrder(data.order);
                initItemUpdates(data.order);
                // Side by side with the order, never blocking it: a Bosta timeout must not
                // stop the admin from seeing the parcels they came here for.
                adminApi.getOrderCodProfile(params.id)
                    .then((res) => setCodProfile(res.profile))
                    .catch(() => { });
                // Fetch pickups for this order
                if (data.order?.shipments?.length > 0) {
                    adminApi.getPickups({}).then(res => {
                        const relevant = (res.pickups || []).filter(p =>
                            p.order_ids?.some(id => id === params.id || id === data.order._id)
                        );
                        setOrderPickups(relevant);
                    }).catch(() => {});
                }
            } catch (err) {
                setError(err.message || 'Failed to load order');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [params.id]);

    const initItemUpdates = (o) => {
        if (!o?.items) return;
        setItemUpdates(o.items.map(item => ({
            itemId: item._id,
            status: item.vendor_status || 'pending',
            note: item.vendor_note || '',
        })));
        // Init fulfillment location edits from vendor_supervisions
        const edits = {};
        for (const vs of o.vendor_supervisions || []) {
            const vid = vs.vendor_id?._id || vs.vendor_id;
            edits[vid] = vs.fulfillment_location || '';
        }
        setFulfillmentEdits(edits);
    };

    const handleItemStatusChange = (itemId, newStatus) => {
        setItemUpdates(prev => prev.map(u => u.itemId === itemId ? { ...u, status: newStatus } : u));
    };

    const handleItemNoteChange = (itemId, note) => {
        setItemUpdates(prev => prev.map(u => u.itemId === itemId ? { ...u, note } : u));
    };

    const getVariantLabel = (variant) => {
        if (!variant) return 'Default';
        return (variant.selected_options || [])
            .map(option => option.option_value)
            .filter(Boolean)
            .join(' / ') || 'Default';
    };

    const getVariantPrice = (product, variantId) => {
        const variant = product?.variants?.find(v => v._id === variantId);
        return (variant?.discount_price ?? variant?.price) ?? (product?.discount_price ?? product?.price ?? 0);
    };

    const paymentRows = order ? [
        [isAr ? 'طريقة الدفع' : 'Method', order.transaction?.payment_method?.replace('_', ' ') || '-'],
        [isAr ? 'حالة الدفع' : 'Payment Status', order.transaction?.status || 'pending', 'status'],
        [isAr ? 'المزود' : 'Provider', order.transaction?.provider || (order.transaction?.payment_method === 'cash' ? 'cash' : '-')],
        [isAr ? 'وضع المزود' : 'Provider Mode', order.transaction?.provider_mode || '-'],
        [isAr ? 'المرجع' : 'Reference', order.transaction?.reference || order._id],
        [isAr ? 'معرف الدفع' : 'Payment ID', order.transaction?.payment_id || '-'],
        [isAr ? 'رقم الفاتورة' : 'Invoice ID', order.transaction?.invoice_id || '-'],
        [isAr ? 'مفتاح الفاتورة' : 'Invoice Key', order.transaction?.invoice_key || '-'],
        [isAr ? 'تاريخ الدفع' : 'Paid At', formatDateTime(order.transaction?.paid_at, isAr ? 'ar-u-ca-gregory' : 'en-US')],
        [isAr ? 'سبب الفشل' : 'Failure Reason', order.transaction?.failure_reason || '-'],
        // A company-account order (feature 14): who is billed, and how the total split.
        ...(order.company ? [
            [isAr ? orgTerms(order.company.org_type, true).the : orgTerms(order.company.org_type, false).One, order.company.company_name || '-'],
            [isAr ? 'لمين' : 'For', order.company.beneficiary === 'car'
                ? `${isAr ? `عربية ${orgTerms(order.company.org_type, true).the}` : `${orgTerms(order.company.org_type, false).One} car`} ${order.company.car_label || ''}`
                : (isAr ? `${orgTerms(order.company.org_type, true).theMember} (من الليميت)` : `The ${orgTerms(order.company.org_type, false).member} (own limit)`)],
            [isAr ? `على ${orgTerms(order.company.org_type, true).the}` : `Billed to ${orgTerms(order.company.org_type, false).one}`, Number(order.company.company_amount || 0).toFixed(2)],
            [isAr ? 'دفعه العميل' : 'Paid by customer', `${Number(order.company.personal_amount || 0).toFixed(2)}${order.company.personal_method ? ` (${order.company.personal_method.replace('_', ' ')})` : ''}`],
            ...(order.company.office_name ? [[isAr ? `التوصيل على ${orgTerms(order.company.org_type, true).branch}` : `${orgTerms(order.company.org_type, false).Branch} delivery`, order.company.office_name]] : []),
        ] : []),
    ] : [];

    const loadReplacementProducts = async () => {
        if (replacementProducts.length > 0) return;
        setReplacementLoading(true);
        try {
            const data = await adminApi.getProducts('published');
            setReplacementProducts(data.products || []);
        } catch (err) {
            alert(err.message || 'Failed to load products');
        } finally {
            setReplacementLoading(false);
        }
    };

    const openReplacementModal = async (item) => {
        setReplacementModal(item);
        setReplacementSearch('');
        setReplacementForm({
            product_id: '',
            variant_id: '',
            variant_label: '',
            quantity: item.quantity || 1,
            unit_price: '',
            reason: '',
        });
        await loadReplacementProducts();
    };

    const selectReplacementProduct = (product) => {
        const firstVariant = product.variants?.[0];
        const variantId = firstVariant?._id || '';
        setReplacementForm(prev => ({
            ...prev,
            product_id: product._id,
            variant_id: variantId,
            variant_label: getVariantLabel(firstVariant),
            unit_price: getVariantPrice(product, variantId),
        }));
    };

    const handleReplacementVariantChange = (variantId) => {
        const variant = selectedReplacementProduct?.variants?.find(v => v._id === variantId);
        setReplacementForm(prev => ({
            ...prev,
            variant_id: variantId,
            variant_label: getVariantLabel(variant),
            unit_price: getVariantPrice(selectedReplacementProduct, variantId),
        }));
    };

    const submitReplacement = async () => {
        if (!replacementModal || !replacementForm.product_id) {
            alert(isAr ? 'اختر المنتج البديل.' : 'Please choose a replacement product.');
            return;
        }
        if (!replacementForm.reason.trim()) {
            alert(isAr ? 'اكتب سبب الاستبدال.' : 'Please add a replacement reason.');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                product_id: replacementForm.product_id,
                variant_id: replacementForm.variant_id || undefined,
                variant_label: replacementForm.variant_label || undefined,
                quantity: Number(replacementForm.quantity || replacementModal.quantity || 1),
                unit_price: replacementForm.unit_price,
                reason: replacementForm.reason.trim(),
            };
            const data = await adminApi.replaceOrderItem(params.id, replacementModal._id, payload);
            setOrder(data.order);
            initItemUpdates(data.order);
            setReplacementModal(null);
            showMsg(isAr ? 'تم استبدال المنتج بنجاح' : 'Item replaced successfully');
        } catch (err) {
            alert(err.message || 'Failed to replace item');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteItem = async (item) => {
        if (!confirm(isAr
            ? `حذف "${item.product_title}" نهائياً من الطلب؟`
            : `Permanently remove "${item.product_title}" from this order?`)) return;
        setSaving(true);
        try {
            const data = await adminApi.deleteOrderItem(params.id, item._id);
            setOrder(data.order);
            initItemUpdates(data.order);
            showMsg(isAr ? 'تم حذف المنتج' : 'Item deleted');
        } catch (err) {
            alert(err.message || 'Failed to delete item');
        } finally {
            setSaving(false);
        }
    };

    const saveItemChanges = async () => {
        const hasDeclineWithoutNote = itemUpdates.some(u => u.status === 'declined' && !u.note.trim());
        if (hasDeclineWithoutNote) {
            alert(isAr ? 'يرجى كتابة سبب الرفض لكل منتج مرفوض.' : 'Please provide a reason for all declined items.');
            return;
        }

        // Build fulfillment_locations array from edits
        const fulfillment_locations = Object.entries(fulfillmentEdits)
            .filter(([_, loc]) => loc)
            .map(([vendor_id, fulfillment_location]) => ({ vendor_id, fulfillment_location }));

        setSaving(true);
        try {
            const data = await adminApi.updateOrderItems(params.id, itemUpdates, fulfillment_locations.length > 0 ? fulfillment_locations : undefined);
            setOrder(data.order);
            initItemUpdates(data.order);
            setEditingItems(false);
            showMsg(isAr ? 'تم تحديث حالة المنتجات بنجاح' : 'Item statuses updated successfully');
        } catch (err) {
            alert(err.message);
        } finally {
            setSaving(false);
        }
    };

    const updateOrderStatus = async (newStatus) => {
        if (newStatus === 'ready') {
            if (!confirm(isAr ? 'سيتم إرسال الشحنات إلى بوسطة. متابعة؟' : 'This will send shipments to Bosta. Continue?')) return;
            setBostaSending(true);
            setBostaFailures([]);
            setBostaSkipped([]);
            setBostaMsg(isAr ? 'جاري إرسال الطلبات إلى بوسطة...' : 'Sending orders to Bosta...');
            try {
                const data = await adminApi.updateOrderStatus(params.id, newStatus);
                setOrder(data.order);
                const failures = data.failures || [];
                setBostaFailures(failures);
                // A parcel already with a courier, or cancelled, is not news; everything
                // else that was left behind is said out loud, with the reason.
                const skipped = (data.skipped || []).filter(
                    (s) => !/^already sent|^the parcel is cancelled/i.test(s.reason || '')
                );
                setBostaSkipped(skipped);
                // Sent, but the sticker was refused: the shipment exists and the parcel is back
                // at the vendor's label step. Said out loud, because a silent success here is
                // a box going out with no label on it.
                const stickerProblems = (data.dispatched || []).filter((d) => d.sticker_error);
                if (stickerProblems.length) {
                    alert((isAr
                        ? 'الشحنات اتعملت على بوسطة، بس الملصق ماتربطش على دول — لازم ملصق تاني أو طباعة البوليصة:\n\n'
                        : 'Shipments were created on Bosta, but these stickers were not linked — scan another or print the waybill:\n\n')
                        + stickerProblems.map((d) => `${d.reference}: ${d.sticker_error}`).join('\n'));
                }
                setBostaMsg(failures.length
                    ? (isAr
                        ? `تم إرسال جزء من الشحنات — ${failures.length} شحنة رجعت للتاجر`
                        : `Sent in part — ${failures.length} shipment(s) returned to the vendor`)
                    : skipped.length && !(data.dispatched || []).length
                        ? (isAr ? 'لم تُرسل أي شحنة — شوف السبب تحت' : 'Nothing was sent — see why below')
                    : skipped.length
                        ? (isAr ? `تم الإرسال — ${skipped.length} شحنة اتخطّت، شوف السبب تحت` : `Sent — ${skipped.length} parcel(s) skipped, see why below`)
                    : (isAr ? 'تم إرسال الطلبات إلى بوسطة بنجاح' : 'Sending orders to Bosta completed'));
                setTimeout(() => { setBostaSending(false); setBostaMsg(''); }, 3000);
            } catch (err) {
                setBostaMsg('');
                setBostaSending(false);
                alert(err.message || (isAr ? 'فشل إرسال الطلبات إلى بوسطة' : 'Failed to send orders to Bosta'));
            }
            return;
        }

        if (!confirm(isAr ? `تأكيد تغيير حالة الطلب إلى: ${newStatus}؟` : `Change order status to: ${newStatus}?`)) return;
        setSaving(true);
        try {
            const data = await adminApi.updateOrderStatus(params.id, newStatus);
            setOrder(data.order);
            showMsg(isAr ? 'تم تحديث حالة الطلب بنجاح' : 'Order status updated');
        } catch (err) {
            alert(err.message);
        } finally {
            setSaving(false);
        }
    };

    // Admin scanning is the rescue path: a vendor whose scanner or phone will not
    // cooperate should not stop the parcel from going out.
    const handleScanLabel = async (vendorId, trackingNumber) => {
        await adminApi.scanSmartLabel(params.id, vendorId, trackingNumber);
        const data = await adminApi.getOrderById(params.id);
        setOrder(data.order);
    };

    const handleUnlinkLabel = async (vendorId) => {
        await adminApi.unlinkSmartLabel(params.id, vendorId);
        const data = await adminApi.getOrderById(params.id);
        setOrder(data.order);
    };

    const handleRefreshTracking = async () => {
        setRefreshingTracking(true);
        try {
            const data = await adminApi.refreshTracking(params.id);
            setOrder(data.order);
            showMsg(isAr ? 'تم تحديث بيانات التتبع' : 'Tracking data refreshed');
        } catch (err) {
            alert(err.message);
        } finally {
            setRefreshingTracking(false);
        }
    };

    /**
     * Every per-parcel action funnels through here.
     *
     * The response carries the whole re-populated order, so the screen never has to guess
     * at what a cancellation did to the totals or to the order's own status — both of which
     * are derived server-side from the parcels.
     */
    const runParcelAction = async (parcel, fn, confirmText) => {
        if (confirmText && !confirm(confirmText)) return;
        setParcelBusy(String(parcel._id));
        try {
            const res = await fn();
            if (res?.order) setOrder(res.order);
            else {
                const fresh = await adminApi.getOrderById(params.id);
                setOrder(fresh.order);
            }
            if (res?.dispatch_error) {
                alert(isAr
                    ? `شركة الشحن اتغيرت، لكن إرسال البوليصة الجديدة ماكملش. راجع السبب وأعد الإرسال من كارت الشحنة:\n\n${res.dispatch_error}`
                    : `The courier changed, but the replacement shipment was not completed. Resolve this issue, then send from the parcel card:\n\n${res.dispatch_error}`);
            }
            if (res?.sticker_error) {
                alert(isAr
                    ? `الشحنة اتعملت على بوسطة، بس الملصق ماتربطش. الطرد رجع لمرحلة الملصق عند التاجر: يسكن ملصق تاني أو يطبع البوليصة.\n\n${res.sticker_error}`
                    : `The shipment was created on Bosta, but the sticker was not linked. The parcel is back at the vendor's label step: scan another sticker or print the waybill.\n\n${res.sticker_error}`);
            }
            if (res?.stranded_tracking) {
                // Name the courier the parcel is actually with. This used to always say
                // Bosta, which sent the admin hunting for an Arrive waybill in the wrong
                // portal — and an uncancelled parcel is one we still get billed for.
                const strandedName = courierNameOf(res.stranded_courier || 'bosta');
                alert(isAr
                    ? `تم الإلغاء، لكن لازم تلغي الشحنة ${res.stranded_tracking} يدويًا من ${strandedName}.`
                    : `Cancelled, but you must cancel ${res.stranded_tracking} at ${strandedName} by hand.`);
            }
        } catch (err) {
            alert(err.message);
            // Removal may have succeeded before the replacement failed. Read the durable
            // checkpoint so the next action never uses an obsolete courier or waybill.
            try { const fresh = await adminApi.getOrderById(params.id); setOrder(fresh.order); } catch (_) { /* retain current view */ }
        } finally {
            setParcelBusy('');
        }
    };

    // Two routes to Bosta, and the confirm says which one this press takes: a scanned
    // sticker becomes the tracking number; without one Bosta mints the number and the
    // waybill is printed from the shipment card afterwards.
    const courierNameOf = (key) => {
        const opt = (couriersInfo.providers || []).find((p) => p.key === key);
        if (opt) return isAr ? (opt.label_ar || opt.label) : opt.label;
        return key === 'arrive' ? (isAr ? 'أرايف' : 'Arrive') : (isAr ? 'بوسطة' : 'Bosta');
    };

    const dispatchParcel = (parcel) => {
        const courier = parcel.courier_override || parcel.courier || couriersInfo.default || 'bosta';
        const name = courierNameOf(courier);
        const vendorId = (parcel.vendor_id?._id || parcel.vendor_id)?.toString();
        const group = (order.vendor_groups || []).find(g => (g.vendor?._id || g.vendor)?.toString() === vendorId);
        const label = courier === 'bosta' ? group?.smart_label?.tracking_number : null;
        let text;
        if (courier === 'arrive') {
            text = isAr
                ? `هتتبعت الشحنة دي لأرايف على منطقة "${parcel.courier_sector_name || '—'}". هتتعمل بوليصة أرايف وتطبع اللابيل من كارت الشحنة. متابعة؟`
                : `This parcel will be sent to Arrive, area "${parcel.courier_sector_name || '—'}". An Arrive waybill is created and you print the label from the shipment card. Continue?`;
        } else if (label) {
            text = isAr
                ? `هتتبعت الشحنة دي لـ ${name} برقم اللابيل ${label}. متابعة؟`
                : `This parcel will be sent to ${name} with label ${label}. Continue?`;
        } else {
            text = isAr
                ? `مفيش لابيل متسجل على الطرد ده. الشحنة هتتعمل برقم من ${name}، وبعدها تطبع البوليصة من كارت الشحنة. متابعة؟`
                : `No label is scanned on this parcel. The shipment will be created with a ${name} number, and you print the waybill from the shipment card afterwards. Continue?`;
        }
        return runParcelAction(parcel, () => adminApi.dispatchSubOrder(params.id, parcel._id), text);
    };

    /** Courier per parcel; for Arrive the area is matched from the address or chosen from the picker. */
    const setParcelCourier = (parcel, courier, sectorId) =>
        runParcelAction(parcel, async () => {
            const res = await adminApi.setSubOrderCourier(params.id, parcel._id, courier, sectorId);
            if (courier === 'arrive' && !res?.sector && res?.suggestion?.candidates?.length) {
                alert(isAr
                    ? `مقدرناش نحدد المنطقة بثقة. اختارها من القايمة (اقتراحات: ${res.suggestion.candidates.map((c) => c.name).join('، ')}).`
                    : `The delivery area could not be matched with confidence. Pick it from the search (suggestions: ${res.suggestion.candidates.map((c) => c.name).join(', ')}).`);
            } else if (courier === 'arrive' && !res?.sector) {
                alert(isAr ? 'اختار منطقة التوصيل عند أرايف من البحث.' : 'Choose the Arrive delivery area from the search.');
            }
            return res;
        });

    const searchSectors = async (q) => {
        const res = await adminApi.searchArriveSectors(q);
        return res?.sectors || [];
    };

    const transferParcel = (parcel, data) => runParcelAction(
        parcel,
        () => adminApi.transferSubOrderCourier(params.id, parcel._id, data)
    );

    // A parcel with a shipment but still at the label stage: the sticker is optional once a
    // waybill exists, so the admin can move it on without one.
    const confirmWaybill = (parcel) => runParcelAction(
        parcel,
        () => adminApi.confirmSubOrderWaybill(params.id, parcel._id),
        isAr
            ? `هتأكد إن بوليصة ${parcel.tracking_number || parcel.bosta_tracking_number} متلزقة على الشحنة وتنقلها لمرحلة التجهيز. الملصق الذكي مش مطلوب. بعدها اضغط "جاهزة للاستلام" عشان تظهر في شاشة البيك أب. متابعة؟`
            : `Confirm that waybill ${parcel.tracking_number || parcel.bosta_tracking_number} is on the parcel and move it to the packing stage. No Smart Sticker is needed. Afterwards press "Ready for pickup" to list it on the Pickups screen. Continue?`
    );

    // Stage ③ on the vendor's behalf. Only a ready parcel is bookable on the Pickups screen.
    const markReady = (parcel) => runParcelAction(
        parcel,
        () => adminApi.markSubOrderReady(params.id, parcel._id),
        isAr
            ? `هتعلّم الشحنة ${parcel.reference} إنها مقفولة وجاهزة للاستلام عند التاجر، وهتظهر في شاشة البيك أب. متابعة؟`
            : `Mark parcel ${parcel.reference} as sealed and waiting for a courier at the vendor. It will appear on the Pickups screen. Continue?`
    );

    const courierCancelDone = (parcel) => runParcelAction(
        parcel,
        () => adminApi.courierCancelDone(params.id, parcel._id),
        isAr ? 'أكدت إنك لغيت البوليصة عند شركة الشحن؟' : 'Confirm you cancelled the waybill at the courier?'
    );

    const resolveDispatch = (parcel, mode) => {
        let waybill = '';
        if (mode === 'attach') {
            waybill = prompt(isAr ? 'رقم البوليصة كما يظهر في بورتال الشركة:' : 'Waybill exactly as shown in the courier portal:') || '';
            if (!waybill.trim()) return undefined;
        } else if (!confirm(isAr ? 'متأكد إن مفيش شحنة اتعملت عند الشركة؟' : 'Sure nothing was created at the courier?')) {
            return undefined;
        }
        return runParcelAction(parcel, () => adminApi.resolveDispatch(params.id, parcel._id, waybill.trim()));
    };

    const releaseParcel = (parcel) => runParcelAction(
        parcel,
        () => adminApi.releaseSubOrder(params.id, parcel._id),
        isAr
            ? 'هترجع الشحنة للتاجر عشان يكمّل تجهيزها. متابعة؟'
            : 'This parcel goes back to the vendor to finish preparing. Continue?'
    );

    const cancelParcel = async (parcel) => {
        const reason = prompt(isAr ? 'سبب إلغاء الشحنة؟' : 'Why is this parcel being cancelled?');
        if (!reason?.trim()) return;
        await runParcelAction(parcel, () => adminApi.cancelSubOrder(params.id, parcel._id, reason.trim()));
    };

    /**
     * Reverse a cancellation. The server re-charges the refund, takes the points back and
     * retires the dead Bosta delivery; it refuses if the customer no longer has the money,
     * so the confirm spells out what will be charged before anything moves.
     */
    const reactivateParcel = async (parcel) => {
        const refunded = Number(parcel.refunded_amount || 0);
        const warn = refunded > 0
            ? (isAr
                ? `هيتم خصم ${refunded.toFixed(2)} من محفظة العميل تاني. متابعة؟`
                : `${refunded.toFixed(2)} will be charged back to the customer's wallet. Continue?`)
            : (isAr
                ? 'هترجع الشحنة للتاجر عشان يجهزها من جديد وتتبعت لبوسطة بشحنة جديدة. متابعة؟'
                : 'The parcel goes back to the vendor to prepare again and a new Bosta delivery is created. Continue?');
        if (!confirm(warn)) return;
        const reason = prompt(isAr ? 'سبب إعادة التفعيل (إجباري):' : 'Reason for reactivating (required):');
        if (!reason?.trim()) return;
        await runParcelAction(parcel, async () => {
            const res = await adminApi.reactivateSubOrder(params.id, parcel._id, reason.trim());
            if (res?.previous_tracking) {
                alert(isAr
                    ? `تمت إعادة التفعيل. شحنة بوسطة القديمة ${res.previous_tracking} اتقفلت وهتتعمل شحنة جديدة عند الإرسال.`
                    : `Reactivated. The old Bosta delivery ${res.previous_tracking} is retired; a new one is created on dispatch.`);
            }
            return res;
        });
    };

    const reactivateOrder = async () => {
        const cancelledCount = (order?.sub_orders || []).filter((p) => p.status === 'cancelled').length;
        if (!cancelledCount) return;
        const owed = (order?.sub_orders || [])
            .filter((p) => p.status === 'cancelled')
            .reduce((sum, p) => sum + Number(p.refunded_amount || 0), 0);
        const warn = isAr
            ? `هيتم إعادة تفعيل ${cancelledCount} شحنة${owed > 0 ? ` وخصم ${owed.toFixed(2)} من محفظة العميل تاني` : ''}. متابعة؟`
            : `${cancelledCount} cancelled parcel(s) will be reinstated${owed > 0 ? ` and ${owed.toFixed(2)} charged back to the customer's wallet` : ''}. Continue?`;
        if (!confirm(warn)) return;
        const reason = prompt(isAr ? 'سبب إعادة التفعيل (إجباري):' : 'Reason for reactivating (required):');
        if (!reason?.trim()) return;
        setSaving(true);
        try {
            const res = await adminApi.reactivateOrder(params.id, reason.trim());
            if (res?.order) setOrder(res.order);
            if (res?.failures?.length) alert(res.message);
        } catch (err) {
            alert(err.message);
        } finally {
            setSaving(false);
        }
    };

    /**
     * Close a parcel by hand. Narrow on purpose — Bosta stays the source of truth, and this
     * exists only because a parcel stuck in Bosta's `exception` otherwise sits there for ever.
     */
    const overrideParcel = async (parcel) => {
        const status = prompt(
            isAr
                ? 'اقفل الشحنة كـ: delivered / returned / cancelled'
                : 'Close this parcel as: delivered / returned / cancelled'
        );
        if (!status) return;
        const clean = status.trim().toLowerCase();
        if (!['delivered', 'returned', 'cancelled'].includes(clean)) {
            alert(isAr ? 'اختيار غير صحيح.' : 'Not a valid choice.');
            return;
        }
        const reason = prompt(isAr ? 'السبب (إجباري):' : 'Reason (required):');
        if (!reason?.trim()) return;
        await runParcelAction(parcel, () => adminApi.setSubOrderStatus(params.id, parcel._id, clean, reason.trim()));
    };

    const handlePrintAWB = async (shipmentId) => {
        let objectUrl;
        try {
            const blob = await adminApi.getShipmentAWB(params.id, shipmentId);
            objectUrl = URL.createObjectURL(blob);
            window.open(objectUrl, '_blank');
        } catch (err) {
            alert(err.message || 'Failed to get AWB');
        } finally {
            // Give the new tab time to load before releasing the blob.
            if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        }
    };

    const lockForFulfillment = async () => {
        const items = order?.items || [];
        const pendingItems = items.filter(item => item.vendor_status === 'pending').length;
        const declinedItems = items.filter(item => item.vendor_status === 'declined').length;

        if (order.status !== 'pending') {
            alert(isAr ? 'يمكن قفل الطلب فقط وهو في حالة قيد الانتظار.' : 'The order can only be locked while it is pending.');
            return;
        }

        if (items.length === 0) {
            alert(isAr ? 'لا يمكن قفل طلب بدون منتجات.' : 'Cannot lock an order with no items.');
            return;
        }

        if (pendingItems > 0) {
            alert(isAr ? 'لا يمكن قفل الطلب قبل مراجعة كل المنتجات.' : 'Cannot lock the order while items are still pending review.');
            return;
        }

        if (declinedItems > 0) {
            alert(isAr ? 'لا يمكن قفل الطلب وهناك منتجات مرفوضة. استبدلها أو وافق عليها أولاً.' : 'Cannot lock the order while items are declined. Replace or approve them first.');
            return;
        }

        if (!confirm(isAr ? 'هل تريد قفل هذا الطلب للتجهيز؟ سيتم نقله إلى قيد التجهيز.' : 'Lock this order for fulfillment? It will move to processing.')) return;
        setSaving(true);
        try {
            const data = await adminApi.lockOrderForFulfillment(params.id);
            setOrder(data.order);
            showMsg(isAr ? 'تم قفل الطلب للشحن بنجاح' : 'Order locked for fulfillment');
        } catch (err) {
            alert(err.message);
        } finally {
            setSaving(false);
        }
    };

    const showMsg = (msg) => {
        setActionMsg(msg);
        setTimeout(() => setActionMsg(''), 3000);
    };

    const statusLabel = (status, opts) => opts.find(o => o.value === status);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 size={32} className="animate-spin text-marine-primary" />
            </div>
        );
    }

    if (error || !order) {
        return (
            <div className="max-w-3xl mx-auto">
                <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
                    {error || (isAr ? 'الطلب غير موجود' : 'Order not found')}
                </div>
            </div>
        );
    }

    const approvedCount = itemUpdates.filter(u => u.status === 'approved').length;
    const declinedCount = itemUpdates.filter(u => u.status === 'declined').length;
    const pendingCount = itemUpdates.filter(u => u.status === 'pending').length;
    const itemCount = order.items?.length || 0;
    const lockStatusBlocked = order.status !== 'pending';
    const canLockForFulfillment = !lockStatusBlocked && itemCount > 0 && pendingCount === 0 && declinedCount === 0 && approvedCount === itemCount;
    const lockBlockReason = itemCount === 0
        ? (isAr ? 'لا توجد منتجات في الطلب.' : 'Order has no items.')
        : pendingCount > 0
            ? (isAr ? `${pendingCount} منتجات ما زالت قيد المراجعة.` : `${pendingCount} item(s) are still pending review.`)
            : declinedCount > 0
                ? (isAr ? `${declinedCount} منتجات مرفوضة. استبدلها أو وافق عليها أولاً.` : `${declinedCount} item(s) are declined. Replace or approve them first.`)
                : '';

    /**
     * Record what happened on the phone. Refuses nothing and cancels nothing — the outcome
     * is a note on the order, and what to DO about a refusal stays a separate decision.
     */
    const recordCall = async (outcome) => {
        setCallBusy(outcome);
        try {
            const res = await adminApi.recordCustomerConfirmation(params.id, outcome, callNote);
            setOrder(res.order);
            setCallNote('');
            setActionMsg(isAr ? 'تم تسجيل نتيجة المكالمة' : 'Call outcome recorded');
        } catch (err) {
            setActionMsg(err.message || (isAr ? 'تعذر تسجيل المكالمة' : 'Could not record the call'));
        } finally {
            setCallBusy('');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300 pb-12">
            {/* Bosta Sending Overlay */}
            {bostaSending && (
                <Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-white dark:bg-[#14171A] rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-4 max-w-sm mx-4">
                        {bostaMsg.includes('completed') || bostaMsg.includes('بنجاح') ? (
                            <CheckCircle2 size={48} className="text-emerald-500" />
                        ) : (
                            <Loader2 size={48} className="animate-spin text-marine-primary" />
                        )}
                        <p className="text-lg font-bold text-zinc-900 dark:text-white text-center">{bostaMsg}</p>
                    </div>
                </Overlay>
            )}

            {/* The customer nobody has reached.
                Shown only once WhatsApp has actually given up — three attempts over an hour,
                or one settled "failed" verdict from the provider on an order too old to
                retry — so it means "ring this person", not "an attempt failed once". */}
            {['needs_call', 'no_answer'].includes(order.customer_confirmation?.status) && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                        <PhoneCall size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-black text-red-700 dark:text-red-400">
                                {order.customer_confirmation.status === 'no_answer'
                                    ? (isAr ? 'العميل مردش — محتاج محاولة تانية' : 'No answer — needs another try')
                                    : (isAr ? 'العميل لم يستلم رسالة التأكيد — كلّمه تليفونياً' : 'The customer never got the confirmation — call them')}
                            </p>
                            <p className="text-xs text-red-700/80 dark:text-red-400/70 mt-0.5">
                                {isAr
                                    ? `رسالة الواتساب لم تصل ${order.customer_confirmation.whatsapp_attempts || 0} مرة.`
                                    : `The WhatsApp message did not arrive ${order.customer_confirmation.whatsapp_attempts || 0} time(s).`}
                                {order.customer_confirmation.call_attempts > 0 && (
                                    isAr
                                        ? ` واتعملت ${order.customer_confirmation.call_attempts} مكالمة قبل كده.`
                                        : ` ${order.customer_confirmation.call_attempts} call(s) already made.`
                                )}
                            </p>

                            {/* The provider's own words. An expired template and a dead number
                                need completely different fixes, so the reason is shown, not hidden. */}
                            {order.customer_confirmation.last_error && (
                                <p className="text-[11px] text-red-700/60 dark:text-red-400/50 mt-1 break-words">
                                    {order.customer_confirmation.last_error}
                                </p>
                            )}

                            <a
                                href={`tel:${order.shipping_address?.phone || ''}`}
                                className="inline-flex items-center gap-1.5 mt-2 text-sm font-black text-red-700 dark:text-red-300 hover:underline"
                            >
                                <Phone size={13} /> {order.shipping_address?.phone || '-'}
                            </a>

                            <input
                                type="text"
                                value={callNote}
                                onChange={(e) => setCallNote(e.target.value)}
                                placeholder={isAr ? 'ملاحظة على المكالمة (اختياري)' : 'Note about the call (optional)'}
                                className="w-full mt-3 bg-white dark:bg-[#0E1012] border border-red-500/20 text-zinc-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500"
                            />

                            <div className="flex flex-wrap gap-2 mt-2">
                                <button
                                    type="button"
                                    onClick={() => recordCall('confirmed')}
                                    disabled={!!callBusy}
                                    className="px-3 py-2 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
                                >
                                    {callBusy === 'confirmed' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                    {isAr ? 'العميل أكّد الأوردر' : 'Customer confirmed'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => recordCall('no_answer')}
                                    disabled={!!callBusy}
                                    className="px-3 py-2 rounded-xl text-xs font-black bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5"
                                >
                                    {callBusy === 'no_answer' ? <Loader2 size={13} className="animate-spin" /> : <PhoneOff size={13} />}
                                    {isAr ? 'مردش' : 'No answer'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => recordCall('refused')}
                                    disabled={!!callBusy}
                                    className="px-3 py-2 rounded-xl text-xs font-black bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5"
                                >
                                    {callBusy === 'refused' ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                                    {isAr ? 'رفض الأوردر' : 'Refused the order'}
                                </button>
                            </div>

                            {/* Refusing records the fact and stops there: a parcel may already be
                                packed or a courier booked, so writing the order off is its own call. */}
                            <p className="text-[11px] text-red-700/60 dark:text-red-400/50 mt-2">
                                {isAr
                                    ? 'تسجيل «رفض» بيسجل الواقعة بس — الإلغاء بيفضل قرارك من زرار الإلغاء.'
                                    : 'Recording a refusal only notes it — cancelling stays your decision.'}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Settled by a phone call — kept visible so nobody rings the same customer twice. */}
            {['confirmed', 'refused'].includes(order.customer_confirmation?.status) && (
                <div className={`rounded-2xl p-3 border ${order.customer_confirmation.status === 'confirmed' ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-red-500/10 border-red-500/25'}`}>
                    <p className={`text-xs font-black ${order.customer_confirmation.status === 'confirmed' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                        <PhoneCall size={12} className="inline me-1.5" />
                        {order.customer_confirmation.status === 'confirmed'
                            ? (isAr ? 'العميل أكّد الأوردر تليفونياً' : 'Customer confirmed by phone')
                            : (isAr ? 'العميل رفض الأوردر في المكالمة' : 'Customer refused the order on the call')}
                        {order.customer_confirmation.resolved_by && ` — ${order.customer_confirmation.resolved_by}`}
                    </p>
                    {order.customer_confirmation.note && (
                        <p className="text-[11px] text-zinc-500 mt-1">{order.customer_confirmation.note}</p>
                    )}
                </div>
            )}

            {/* Bulk send left parcels behind — each one with the reason, so a parcel with
                neither a Smart Sticker nor a waybill is never a silent omission. */}
            {bostaSkipped.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-black text-amber-700 dark:text-amber-400">
                                    {isAr ? 'شحنات اتخطّت ولم تُرسل' : 'Parcels skipped, not sent'}
                                </p>
                                <p className="text-xs text-amber-700/80 dark:text-amber-400/70 mt-0.5">
                                    {isAr
                                        ? 'كل شحنة لازم يكون معاها ملصق ذكي متسكن أو بوليصة. ابعت الشحنة لوحدها من كارتها عشان تتعمل بوليصة، أو خلّي التاجر يسكن الملصق.'
                                        : 'Every parcel needs either a scanned Smart Sticker or a waybill. Send the parcel on its own from its card to create a waybill, or have the vendor scan the sticker.'}
                                </p>
                                <ul className="mt-2 space-y-1">
                                    {bostaSkipped.map((s, i) => (
                                        <li key={i} className="text-xs text-amber-800 dark:text-amber-300">
                                            <span className="font-bold">{s.vendor_name}{s.reference ? ` · ${s.reference}` : ''}</span>: {s.reason}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setBostaSkipped([])}
                            className="text-amber-600 hover:text-amber-800 dark:hover:text-amber-200 flex-shrink-0"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Partial dispatch — the shipments that failed, and why */}
            {bostaFailures.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-black text-amber-700 dark:text-amber-400">
                                    {isAr
                                        ? 'شحنات رجعت للتاجر ولم تُرسل إلى بوسطة'
                                        : 'Shipments returned to their vendor, not sent to Bosta'}
                                </p>
                                <p className="text-xs text-amber-700/80 dark:text-amber-400/70 mt-0.5">
                                    {isAr
                                        ? 'باقي الشحنات اتبعتت عادي. بعد ما التاجر يظبط، اضغط "جاهز" تاني لإرسال الناقص بس.'
                                        : 'The rest went out normally. Once the vendor fixes this, press "Ready" again to send only what is missing.'}
                                </p>
                                <ul className="mt-2 space-y-1">
                                    {bostaFailures.map((f, i) => (
                                        <li key={i} className="text-xs text-amber-800 dark:text-amber-300">
                                            <span className="font-bold">{f.vendor_name}</span>: {f.message}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setBostaFailures([])}
                            className="text-amber-600 hover:text-amber-800 dark:hover:text-amber-200 flex-shrink-0"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Toast */}
            {actionMsg && (
                <div className="fixed top-6 end-6 z-[100] bg-emerald-500 text-white px-5 py-3 rounded-xl font-bold shadow-xl animate-in slide-in-from-top-2 flex items-center gap-2">
                    <CheckCircle2 size={16} />
                    {actionMsg}
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <Link href="/admin/dashboard/orders" className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-[#14171A] rounded-lg border border-zinc-200 dark:border-white/10 transition-colors">
                        <ArrowLeft size={18} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2 flex-wrap">
                            {isAr ? 'طلب' : 'Order'}
                            <span className="text-marine-primary">#{order.reference}</span>
                            {/* Visible from the top: a company order behaves differently. */}
                            {order.company && (
                                <span className="text-[11px] font-black px-2.5 py-1 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 tracking-normal">
                                    {isAr ? `طلب ${orgTerms(order.company.org_type, true).one}` : `${orgTerms(order.company.org_type, false).One} order`}
                                    {order.company.delivery_mode === 'consolidate' ? (isAr ? ` · تجميع على ${orgTerms(order.company.org_type, true).theBranch}` : ` · consolidated to ${orgTerms(order.company.org_type, false).branch}`) : ''}
                                </span>
                            )}
                        </h1>
                        <p className="text-sm text-zinc-500 mt-0.5">
                            {new Date(order.created_at).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', {
                                year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            })}
                        </p>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                    {!editingItems && (order.sub_orders || []).some((p) => p.status === 'cancelled') && (
                        <button
                            onClick={reactivateOrder}
                            disabled={saving}
                            className="px-4 py-2 rounded-xl text-sm font-bold bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                            {isAr ? 'إعادة تفعيل الملغي' : 'Reactivate cancelled'}
                        </button>
                    )}
                    {editingItems ? (
                        <>
                            <button onClick={() => { setEditingItems(false); initItemUpdates(order); }} className="px-4 py-2 rounded-xl text-sm font-bold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button onClick={saveItemChanges} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark transition-colors flex items-center gap-2 shadow-lg disabled:opacity-50">
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                {isAr ? 'حفظ التغييرات' : 'Save Changes'}
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={async () => {
                                setEditingItems(true);
                                // Fetch vendor locations for pickup address dropdowns
                                try {
                                    const data = await adminApi.getVendorLocations(params.id);
                                    const map = {};
                                    for (const v of data.vendor_locations || []) {
                                        map[v.vendor_id] = v.locations || [];
                                    }
                                    setVendorLocationsMap(map);
                                } catch (_) {}
                            }} className="px-4 py-2 rounded-xl text-sm font-bold bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:border-marine-cyan/30 transition-colors flex items-center gap-2">
                                <Edit3 size={14} />
                                {isAr ? 'تعديل المنتجات' : 'Edit Items'}
                            </button>
                            {!lockStatusBlocked && (
                                <div className="flex flex-col items-end gap-1">
                                    <button
                                        onClick={lockForFulfillment}
                                        disabled={saving || !canLockForFulfillment}
                                        title={lockBlockReason || undefined}
                                        className={`px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors flex items-center gap-2 shadow-lg disabled:opacity-60 ${
                                            canLockForFulfillment
                                                ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20'
                                                : 'bg-zinc-400 cursor-not-allowed shadow-zinc-400/10'
                                        }`}
                                    >
                                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                                        {isAr ? 'قفل للشحن' : 'Lock for Fulfillment'}
                                    </button>
                                    {lockBlockReason && (
                                        <p className="max-w-[220px] text-end text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                            {lockBlockReason}
                                        </p>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Status Control */}
            <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-3">
                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{isAr ? 'حالة الطلب' : 'Order Status'}</p>
                    <span className={`inline-flex items-center text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-widest ${getOrderStatusColor(order.status)}`}>
                        {getOrderStatusLabel(order.status, isAr)}
                    </span>
                    {/* The badge never travels without its counter — one word cannot
                        honestly describe three parcels in three different states. */}
                    {getParcelCounterLabel(order.parcel_summary, isAr) && (
                        <span className="text-[11px] font-bold text-zinc-500">
                            {getParcelCounterLabel(order.parcel_summary, isAr)}
                        </span>
                    )}
                </div>
                {/* A company order still collecting: say it before anything else, so nobody
                    goes looking for why the parcel will not send. */}
                {(order.sub_orders || []).some((p) => p.company_batch?.waiting) && (
                    <div className="mb-3 flex items-start gap-2 text-xs text-indigo-800 dark:text-indigo-200 bg-indigo-500/10 border border-indigo-500/25 rounded-xl p-3">
                        <Lock size={14} className="mt-0.5 flex-shrink-0" />
                        <span>
                            {isAr
                                ? <>ده <b>طلب {orgTerms(order.company?.org_type, true).one} بيتجمّع على {orgTerms(order.company?.org_type, true).theBranch}</b> مع طلبات زمايله من نفس التاجر عشان يتشحنوا في طرد واحد ويوفّروا شحن. الإرسال لشركة الشحن مقفول لحد ما الدفعة تقفل — التفاصيل ومتى بتقفل على كارت الشحنة تحت.</>
                                : <>This is a <b>{orgTerms(order.company?.org_type, false).one} order collecting for the {orgTerms(order.company?.org_type, false).branch}</b> with colleagues&apos; orders from the same vendor, so they ship in one parcel and save on shipping. Sending to the courier is locked until the batch closes — details and closing time are on the parcel card below.</>}
                        </span>
                    </div>
                )}
                {(order.sub_orders || []).length > 0 ? (
                    <div className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-white/5 rounded-xl p-3">
                        <Truck size={14} className="mt-0.5 flex-shrink-0 text-marine-primary" />
                        <span>
                            {isAr
                                ? 'حالة الطلب محسوبة من شحناته. اتعامل مع الشحنة اللي تقصدها من تحت — ابعتها لبوسطة أو ألغيها — والطلب هيتبعها.'
                                : "This order's status is worked out from its parcels. Act on the parcel you mean below — send it to Bosta or cancel it — and the order will follow."}
                        </span>
                    </div>
                ) : isBostaDrivenStatus(order.status) ? (
                    <div className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-white/5 rounded-xl p-3">
                        <Truck size={14} className="mt-0.5 flex-shrink-0 text-marine-primary" />
                        <span>
                            {isAr
                                ? 'تم إرسال هذا الطلب إلى بوسطة. الحالة الآن يتحكم بها تتبع شحنات بوسطة ولا يمكن تغييرها يدويًا.'
                                : 'This order has been dispatched to Bosta. Its status is now controlled by Bosta delivery tracking and cannot be changed manually.'}
                        </span>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {ADMIN_STATUS_BUTTONS.map(s => (
                            <button
                                key={s.value}
                                onClick={() => updateOrderStatus(s.value)}
                                disabled={saving || order.status === s.value}
                                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-1.5 ${
                                    order.status === s.value
                                        ? `${s.color} ring-2 ring-current`
                                        : 'border border-zinc-200 dark:border-white/10 text-zinc-500 hover:border-zinc-400 dark:hover:border-white/30 hover:text-zinc-700 dark:hover:text-white'
                                } disabled:opacity-60`}
                            >
                                {s.value === 'pending' && <Clock size={13} />}
                                {s.value === 'confirmed' && <CheckCircle2 size={13} />}
                                {s.value === 'ready' && <Truck size={13} />}
                                {isAr ? s.label_ar : s.label_en}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-[#14171A] p-4 shadow-sm text-center">
                    <p className="text-2xl font-black text-zinc-900 dark:text-white">{order.items?.length || 0}</p>
                    <p className="text-xs font-bold text-zinc-400 mt-0.5">{isAr ? 'إجمالي المنتجات' : 'Total Items'}</p>
                </div>
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-sm text-center">
                    <p className="text-2xl font-black text-emerald-500">{approvedCount}</p>
                    <p className="text-xs font-bold text-emerald-600 mt-0.5">{isAr ? 'تمت الموافقة' : 'Approved'}</p>
                </div>
                <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 shadow-sm text-center">
                    <p className="text-2xl font-black text-red-500">{declinedCount}</p>
                    <p className="text-xs font-bold text-red-600 mt-0.5">{isAr ? 'مرفوض' : 'Declined'}</p>
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-sm text-center">
                    <p className="text-2xl font-black text-amber-500">{pendingCount}</p>
                    <p className="text-xs font-bold text-amber-600 mt-0.5">{isAr ? 'معلق' : 'Pending'}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-[#14171A] p-4 shadow-sm text-center">
                    <p className="text-2xl font-black text-zinc-900 dark:text-white">{order.vendor_groups?.length || 0}</p>
                    <p className="text-xs font-bold text-zinc-400 mt-0.5">{isAr ? 'التجار' : 'Vendors'}</p>
                </div>
                <div className="rounded-2xl border border-marine-cyan/20 bg-marine-cyan/5 p-4 shadow-sm text-center">
                    <p className="text-2xl font-black text-marine-primary">{currency} {order.total_price?.toFixed(2)}</p>
                    <p className="text-xs font-bold text-marine-primary mt-0.5">{isAr ? 'الإجمالي' : 'Total'}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: Customer + Payment */}
                <div className="space-y-4">
                    {/* Customer Info */}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
                        <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide mb-4">
                            {isAr ? 'معلومات العميل' : 'Customer Info'}
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">{isAr ? 'الاسم' : 'Name'}</p>
                                <p className="text-sm font-bold text-zinc-900 dark:text-white">{order.shipping_address?.recipient_name || '-'}</p>
                            </div>
                            <div>
                                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">{isAr ? 'الهاتف' : 'Phone'}</p>
                                <a href={`tel:${order.shipping_address?.phone}`} className="text-sm font-bold text-marine-primary flex items-center gap-1 hover:underline">
                                    <Phone size={12} /> {order.shipping_address?.phone || '-'}
                                </a>
                            </div>
                            <div>
                                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">{isAr ? 'العنوان' : 'Address'}</p>
                                <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">{order.shipping_address?.full_address || '-'}</p>
                            </div>
                            {order.user_id && (
                                <div>
                                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">{isAr ? 'مستخدم الموقع' : 'Registered User'}</p>
                                    <p className="text-sm text-zinc-600 dark:text-zinc-300">{order.user_id.name || '-'}</p>
                                    <p className="text-xs text-zinc-400">{order.user_id.email}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ---- How reliable is this customer ----
                        Two numbers that answer the same question from two sides: what they
                        did to US, and what Bosta's own ranking says about the phone. Admin
                        only — the customer is never shown a score, and the checkout hides
                        cash without explaining why. */}
                    {codProfile && (
                        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-3 mb-4">
                                <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide">
                                    {isAr ? 'سجل استلام العميل' : 'Customer delivery record'}
                                </h3>
                                <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-widest ${codProfile.allowed ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-600'}`}>
                                    {codProfile.allowed
                                        ? (isAr ? 'الدفع عند الاستلام مفتوح' : 'COD open')
                                        : (isAr ? 'الدفع عند الاستلام مقفول' : 'COD blocked')}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">
                                        {isAr ? 'عندنا' : 'With us'}
                                    </p>
                                    {codProfile.site.finished > 0 ? (
                                        <>
                                            <p dir="ltr" className={`text-lg font-black tabular-nums ${codProfile.site.undelivered_percent > codProfile.policy.max_undelivered_percent ? 'text-red-600' : 'text-zinc-900 dark:text-white'}`}>
                                                {(100 - codProfile.site.undelivered_percent).toFixed(0)}%
                                            </p>
                                            <p className="text-[11px] text-zinc-400">
                                                {isAr
                                                    ? `استلم ${codProfile.site.received} من ${codProfile.site.finished} أوردر`
                                                    : `took ${codProfile.site.received} of ${codProfile.site.finished} orders`}
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-sm text-zinc-400">{isAr ? 'أول أوردر' : 'First order'}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">
                                        {isAr ? 'تقييم بوسطة' : 'Bosta ranking'}
                                    </p>
                                    {codProfile.bosta.ranking !== null ? (
                                        <>
                                            <p dir="ltr" className={`text-lg font-black tabular-nums ${codProfile.bosta.ranking < codProfile.policy.min_bosta_ranking ? 'text-red-600' : 'text-zinc-900 dark:text-white'}`}>
                                                {Number(codProfile.bosta.ranking).toFixed(1)}
                                            </p>
                                            <p className="text-[11px] text-zinc-400">
                                                {codProfile.bosta.source === 'cache' || codProfile.bosta.source === 'stale_cache'
                                                    ? (isAr ? 'من آخر قراءة' : 'from the last read')
                                                    : (isAr ? 'لحظي من بوسطة' : 'live from Bosta')}
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-sm text-zinc-400">
                                            {isAr ? 'مفيش تقييم' : 'No ranking'}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Why it is closed, in the admin's words — support answers this
                                call, so the reason cannot live only in the server logs. */}
                            {codProfile.reasons?.length > 0 && !codProfile.allowed && (
                                <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-xs font-bold space-y-1">
                                    {codProfile.reasons.map((r, i) => (
                                        <p key={i}>
                                            {r.code === 'site_undelivered_rate' && (isAr
                                                ? `${r.value}% من أوردراته معندناش وصلتله (الحد ${r.threshold}%)`
                                                : `${r.value}% of their orders never arrived (limit ${r.threshold}%)`)}
                                            {r.code === 'bosta_ranking' && (isAr
                                                ? `تقييم بوسطة ${r.value} أقل من ${r.threshold}`
                                                : `Bosta ranking ${r.value} is under ${r.threshold}`)}
                                            {r.code === 'admin_blocked' && (isAr ? 'مقفول يدوي من الأدمن' : 'Blocked by an admin')}
                                            {r.code === 'cod_disabled_site_wide' && (isAr ? 'الدفع عند الاستلام مقفول للموقع كله' : 'COD is off site-wide')}
                                        </p>
                                    ))}
                                </div>
                            )}

                            {codProfile.override && (
                                <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400 font-bold">
                                    {isAr ? 'قرار يدوي: ' : 'Manual decision: '}
                                    {codProfile.override === 'allow' ? (isAr ? 'مفتوح' : 'allowed') : (isAr ? 'مقفول' : 'blocked')}
                                    {codProfile.override_reason ? ` — ${codProfile.override_reason}` : ''}
                                </p>
                            )}

                            <div className="mt-4 flex flex-wrap gap-2">
                                {codProfile.override !== 'allow' && (
                                    <button
                                        onClick={() => setCodOverride('allow')}
                                        disabled={codLoading}
                                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                                    >
                                        {isAr ? 'افتح الكاش ليه' : 'Force COD open'}
                                    </button>
                                )}
                                {codProfile.override !== 'block' && (
                                    <button
                                        onClick={() => setCodOverride('block')}
                                        disabled={codLoading}
                                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                    >
                                        {isAr ? 'اقفل الكاش عليه' : 'Force COD shut'}
                                    </button>
                                )}
                                {codProfile.override && (
                                    <button
                                        onClick={() => setCodOverride(null)}
                                        disabled={codLoading}
                                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
                                    >
                                        {isAr ? 'رجّعه للقاعدة' : 'Back to the rules'}
                                    </button>
                                )}
                                <button
                                    onClick={refreshCodProfile}
                                    disabled={codLoading}
                                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                >
                                    <RefreshCw size={11} className={codLoading ? 'animate-spin' : ''} />
                                    {isAr ? 'حدّث من بوسطة' : 'Refresh from Bosta'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Payment Info */}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
                        <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide mb-4">
                            {isAr ? 'معلومات الدفع' : 'Payment Info'}
                        </h3>
                        <div className="space-y-3">
                            {paymentRows.map(([label, value, kind]) => (
                                <div key={label} className="flex items-center justify-between gap-3">
                                    <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{label}</p>
                                    {kind === 'status' ? (
                                        <span className={`inline-flex items-center text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-widest ${
                                            order.transaction?.status === 'paid' ? 'bg-emerald-500/20 text-emerald-500' :
                                            order.transaction?.status === 'pending' ? 'bg-amber-500/20 text-amber-500' :
                                            order.transaction?.status === 'refunded' ? 'bg-zinc-500/20 text-zinc-500' :
                                            'bg-red-500/20 text-red-500'
                                        }`}>
                                            {value}
                                        </span>
                                    ) : (
                                        <span className="text-sm font-bold text-zinc-900 dark:text-white text-right break-all capitalize">{String(value)}</span>
                                    )}
                                </div>
                            ))}
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{isAr ? 'الإجمالي' : 'Total'}</p>
                                <span className="text-lg font-black text-marine-primary">{currency} {order.total_price?.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Coupon / Financial Breakdown */}
                    {(order.coupon_code || order.coupon_discount_amount > 0) && (() => {
                        const discountAmt = order.coupon_discount_amount || 0;
                        const subtotal = (order.total_price || 0) + discountAmt;
                        // Who funded the coupon, summed from the parcels' frozen allocation. An
                        // order from before the split existed has no vendor share: all ours.
                        const vendorPct = Number(order.coupon_vendor_share_percent || 0);
                        const vendorFunded = (order.sub_orders || []).reduce((s, so) => s + Number(so.coupon_vendor_share || 0), 0);
                        const platformFunded = Math.max(0, discountAmt - vendorFunded);
                        return (
                            <div className="bg-white dark:bg-[#14171A] border border-marine-cyan/20 rounded-2xl p-5 shadow-sm">
                                <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide mb-4 flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-full bg-marine-cyan/10 text-marine-primary flex items-center justify-center text-xs">%</span>
                                    {isAr ? 'التفاصيل المالية' : 'Financial Breakdown'}
                                </h3>
                                <div className="space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{isAr ? 'المجموع قبل الخصم' : 'Subtotal'}</p>
                                        <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{currency} {subtotal.toFixed(2)}</span>
                                    </div>
                                    {order.coupon_code && (
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{isAr ? 'كوبون' : 'Coupon'}</p>
                                                <span className="inline-block mt-0.5 text-[10px] font-black tracking-widest text-marine-primary bg-marine-cyan/10 rounded px-1.5 py-0.5">{order.coupon_code}</span>
                                            </div>
                                            <span className="text-sm font-bold text-emerald-500">- {currency} {discountAmt.toFixed(2)}</span>
                                        </div>
                                    )}
                                    {discountAmt > 0 && (
                                        <div className="rounded-lg bg-zinc-50 dark:bg-white/5 px-3 py-2 text-[11px] space-y-1">
                                            <div className="flex items-center justify-between">
                                                <span className="text-zinc-500">{isAr ? `التاجر متحمل (${vendorPct}% من الخصم)` : `Vendor absorbs (${vendorPct}% of the discount)`}</span>
                                                <span className="font-bold text-zinc-700 dark:text-zinc-200">{currency} {vendorFunded.toFixed(2)}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-zinc-500">{isAr ? `الموقع متحمل (${100 - vendorPct}% من الخصم)` : `Platform absorbs (${100 - vendorPct}% of the discount)`}</span>
                                                <span className="font-bold text-marine-primary">{currency} {platformFunded.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    )}
                                    <div className="pt-2 border-t border-dashed border-zinc-200 dark:border-white/10 flex items-center justify-between">
                                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{isAr ? 'الإجمالي النهائي' : 'Final Total'}</p>
                                        <span className="text-lg font-black text-marine-primary">{currency} {(order.total_price || 0).toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Shipping */}
                    <OrderShippingPanel order={order} isAr={isAr} currency={currency} dark />

                    {/* Returns for this order */}
                    {order.items?.some(i => i.return_status && i.return_status !== 'none') && (
                        <Link href={`/admin/dashboard/returns?search=${order._id}`}
                            className="block bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 hover:bg-amber-500/20 transition-colors">
                            <p className="text-sm font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2">
                                <RotateCcw size={15} />
                                {isAr ? 'يوجد طلبات إرجاع لهذا الطلب' : 'This order has return requests'}
                            </p>
                            <p className="text-xs text-amber-500/70 mt-1">{isAr ? 'اضغط لعرض طلبات الإرجاع' : 'Click to view return requests'}</p>
                        </Link>
                    )}

                    {/* Order History */}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide flex items-center gap-2">
                                <History size={15} className="text-marine-primary" />
                                {isAr ? 'سجل الطلب' : 'Order History'}
                            </h3>
                            <span className="text-xs font-bold text-zinc-400">{order.history?.length || 0}</span>
                        </div>
                        {order.history?.length ? (
                            <div className="space-y-3 max-h-[420px] overflow-y-auto pe-1">
                                {order.history.map(event => (
                                    <div key={event._id || `${event.action}-${event.created_at}`} className="border-s-2 border-marine-cyan/30 ps-3 pb-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-black text-zinc-900 dark:text-white">{event.title}</p>
                                            <span className="text-[10px] text-zinc-400 whitespace-nowrap">
                                                {new Date(event.created_at).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        {event.details && (
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">{event.details}</p>
                                        )}
                                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mt-1">
                                            {event.actor_label || 'System'} - {event.action}
                                        </p>
                                        {event.metadata?.reason && (
                                            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1">
                                                {event.metadata.reason}
                                            </p>
                                        )}
                                        {event.action === 'item_replaced' && event.metadata?.old_item && event.metadata?.new_item && (
                                            <div className="mt-2 grid grid-cols-1 gap-2 text-xs">
                                                <HistoryItemSnapshot
                                                    label={isAr ? 'المنتج السابق' : 'Previous'}
                                                    item={event.metadata.old_item}
                                                    href={getProductHref(event.metadata.old_item)}
                                                    currency={currency}
                                                />
                                                <HistoryItemSnapshot
                                                    label={isAr ? 'المنتج البديل' : 'Replacement'}
                                                    item={event.metadata.new_item}
                                                    href={getProductHref(event.metadata.new_item)}
                                                    currency={currency}
                                                />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-zinc-400">{isAr ? 'لا يوجد سجل بعد.' : 'No history yet.'}</p>
                        )}
                    </div>
                </div>

                {/* Right: parcels, then the per-vendor financial rollup */}
                <div className="lg:col-span-2 space-y-5">

                    {/* One card per parcel, with its own buttons. Actions live inside the
                        card they act on, so on an order with three vendors it is structurally
                        impossible to dispatch or cancel the wrong one. */}
                    {(order.sub_orders || []).length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wider">
                                    {isAr ? `الشحنات (${order.sub_orders.length})` : `Parcels (${order.sub_orders.length})`}
                                </h2>
                                {order.edit_blocked_reason && (
                                    <span className="text-[10px] text-amber-600 font-bold">
                                        {isAr ? 'الأسعار متجمدة' : 'Amounts locked'}
                                    </span>
                                )}
                            </div>

                            {order.edit_blocked_reason && (
                                <p className="text-[11px] text-zinc-500 leading-relaxed bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                                    {isAr
                                        ? 'أول شحنة راحت لبوسطة، فمبالغ الطلب اتقفلت. مينفعش تغيّر المنتجات دلوقتي — تقدر تلغي شحنة بس.'
                                        : order.edit_blocked_reason}
                                </p>
                            )}

                            {order.sub_orders.map((parcel) => (
                                <AdminParcelCard
                                    key={parcel._id}
                                    parcel={parcel}
                                    currency={currency}
                                    isAr={isAr}
                                    busy={parcelBusy}
                                    onDispatch={dispatchParcel}
                                    onRelease={releaseParcel}
                                    onCancel={cancelParcel}
                                    onReactivate={reactivateParcel}
                                    onOverride={overrideParcel}
                                    defaultCourier={couriersInfo.default}
                                    courierOptions={couriersInfo.providers || []}
                                    onSetCourier={setParcelCourier}
                                    onTransferCourier={transferParcel}
                                    orgType={order.company?.org_type}
                                    onSearchSectors={searchSectors}
                                    onResolveDispatch={resolveDispatch}
                                    onCourierCancelDone={courierCancelDone}
                                    onConfirmWaybill={confirmWaybill}
                                    onMarkReady={markReady}
                                    onPrintAWB={(p) => handlePrintAWB(p.shipment_id)}
                                />
                            ))}
                        </div>
                    )}

                    {(order.vendor_groups || []).map((group, gi) => (
                        <div key={gi} className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
                            <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50/60 dark:bg-white/[0.02] flex items-center justify-between flex-wrap gap-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-marine-cyan/10 flex items-center justify-center">
                                        <Store size={16} className="text-marine-primary" />
                                    </div>
                                    <div>
                                        <p className="text-base font-black text-zinc-900 dark:text-white">
                                            {group.vendor?.store_name || group.vendor?.store_username || (isAr ? 'بائع غير معروف' : 'Unknown Vendor')}
                                        </p>
                                        <p className="text-sm text-zinc-400">{group.items.length} {isAr ? 'عناصر' : 'items'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`inline-flex items-center text-xs px-3 py-1.5 rounded-full font-bold uppercase tracking-widest ${
                                        group.supervision?.status === 'supervised' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-amber-500/20 text-amber-500'
                                    }`}>
                                        {group.supervision?.status === 'supervised'
                                            ? (isAr ? 'تمت المراجعة' : 'Supervised')
                                            : (isAr ? 'قيد المراجعة' : 'Pending')}
                                    </span>
                                    <div className="flex flex-col items-end">
                                        <span className="text-base font-black text-marine-primary">{currency} {group.supervision?.total_amount?.toFixed(2) || '0.00'}</span>
                                        {group.supervision?.total_commission !== undefined && (
                                            <span className="text-xs font-bold text-zinc-500 mt-0.5">
                                                {isAr ? 'العمولة: ' : 'Commission: '} {currency} {group.supervision.total_commission.toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Fulfillment Location per vendor */}
                            <div className="px-5 py-3 border-b border-zinc-100 dark:border-white/5 bg-zinc-50/30 dark:bg-white/[0.01] flex items-center gap-3 flex-wrap">
                                <MapPin size={14} className="text-marine-primary flex-shrink-0" />
                                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{isAr ? 'فرع الاستلام:' : 'Pickup Location:'}</span>
                                {editingItems ? (
                                    vendorLocationsMap[group.vendor?._id]?.length > 0 ? (
                                        <select
                                            value={fulfillmentEdits[group.vendor?._id] || ''}
                                            onChange={(e) => setFulfillmentEdits(prev => ({ ...prev, [group.vendor?._id]: e.target.value }))}
                                            className="flex-1 min-w-[200px] text-xs bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-marine-cyan"
                                        >
                                            <option value="">{isAr ? '-- اختر فرع الاستلام --' : '-- Select Pickup Location --'}</option>
                                            {vendorLocationsMap[group.vendor?._id].map((loc, li) => (
                                                <option key={li} value={loc.address}>
                                                    {loc.address} {loc.is_default ? (isAr ? '(الافتراضي)' : '(Default)') : ''}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            value={fulfillmentEdits[group.vendor?._id] || ''}
                                            onChange={(e) => setFulfillmentEdits(prev => ({ ...prev, [group.vendor?._id]: e.target.value }))}
                                            placeholder={isAr ? 'أدخل عنوان الاستلام' : 'Enter pickup address'}
                                            className="flex-1 min-w-[200px] text-xs bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-marine-cyan"
                                        />
                                    )
                                ) : (
                                    <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                                        {group.supervision?.fulfillment_location || (isAr ? 'غير محدد' : 'Not set')}
                                    </span>
                                )}
                            </div>

                            {/* Smart Label — shown per vendor, so a multi-vendor order makes it
                                obvious which parcels are labelled before pressing "Ready". */}
                            {order.smart_label_enabled && (() => {
                                const vendorId = group.vendor?._id;
                                // The shipment in play, not a retired one left by a reactivation.
                                const shipment = [...(order.shipments || [])].reverse().find(
                                    s => (s.vendor_id?._id || s.vendor_id)?.toString() === vendorId?.toString() && !s.superseded_at
                                );
                                const hasApproved = group.items.some(i => i.vendor_status === 'approved');
                                if (!hasApproved && !group.smart_label) return null;
                                // Smart Labels are Bosta stickers; a vendor whose parcels go with Arrive has nothing to scan.
                                const vendorParcels = (order.sub_orders || []).filter(p => (p.vendor_id?._id || p.vendor_id)?.toString() === vendorId);
                                const allOnArrive = vendorParcels.length > 0 && vendorParcels.every(p => (p.courier || p.courier_override || couriersInfo.default) === 'arrive');
                                if (allOnArrive && !group.smart_label) return null;
                                // Packed inside another order's combined company parcel: it travels
                                // under that parcel's sticker or waybill. This order has no shipment
                                // of its own, which made the panel ask for a new sticker.
                                const rider = vendorParcels.length > 0 && vendorParcels.every(p => p.company_batch?.role === 'rider');
                                if (rider) {
                                    const lead = vendorParcels[0].company_batch?.lead_reference || '';
                                    return (
                                        <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5">
                                            <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-3 py-2">
                                                {isAr
                                                    ? `الأوردر ده بيتشحن جوه الطرد المجمّع #${lead} — بيمشي بالسمارت ليبل أو البوليصة بتاعة الطرد ده، ومش محتاج ليبل لوحده.`
                                                    : `This order ships inside combined parcel #${lead} — it travels under that parcel's Smart Label or waybill and needs no label of its own.`}
                                            </p>
                                        </div>
                                    );
                                }

                                return (
                                    <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5">
                                        <SmartLabelScanner
                                            label={group.smart_label}
                                            // `allOnArrive` above only hides the panel when no label exists yet, so
                                            // without this a Bosta sticker could still be scanned onto a vendor group
                                            // going out with Arrive — and a reservation the Arrive dispatch never
                                            // consumes is never released, burning that sticker for good.
                                            // Frozen once a sticker is LINKED, not once the shipment exists: a
                                            // parcel that went out on the printed route, or whose first sticker
                                            // Bosta refused, can still be scanned onto.
                                            canScan={group.supervision?.status === 'supervised' && !allOnArrive && !shipment?.smart_label_barcode}
                                            dispatched={!!shipment?.smart_label_barcode}
                                            // A live shipment with no sticker went out on the printed waybill:
                                            // the sticker is optional there, and the panel says so.
                                            waybill={shipment && !shipment.smart_label_barcode
                                                ? (shipment.tracking_number || shipment.bosta_tracking_number || null)
                                                : null}
                                            onScan={(number) => handleScanLabel(vendorId, number)}
                                            onUnlink={() => handleUnlinkLabel(vendorId)}
                                            isAr={isAr}
                                        />
                                    </div>
                                );
                            })()}

                            <div className="divide-y divide-zinc-100 dark:divide-white/5">
                                {group.items.map((item) => {
                                    const update = itemUpdates.find(u => u.itemId === item._id?.toString());
                                    const currentStatus = update?.status || item.vendor_status || 'pending';
                                    const currentNote = update?.note || item.vendor_note || '';
                                    const statusInfo = ITEM_STATUSES.find(s => s.value === currentStatus) || ITEM_STATUSES[0];

                                    return (
                                        <div key={item._id} className="p-4 sm:p-5 flex flex-col sm:flex-row gap-5">
                                            <div className="flex gap-4 flex-1">
                                                <div className="w-24 h-24 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 overflow-hidden flex-shrink-0">
                                                    {item.product_id?.images?.[0]?.url ? (
                                                        <img src={item.product_id.images[0].url} alt="" className="w-full h-full object-cover" />
                                                    ) : item.product_image ? (
                                                        <img src={item.product_image} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center"><Package size={24} className="text-zinc-300" /></div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="font-bold text-zinc-900 dark:text-white text-base leading-snug">{item.product_title}</h4>
                                                    {(item.product_id?.sku || item.product_id?.part_number) && (
                                                        <p className="mt-1 text-sm text-zinc-500 font-mono" dir="ltr">
                                                            {item.product_id?.sku && <span>SKU: <strong className="text-zinc-700 dark:text-zinc-200">{item.product_id.sku}</strong></span>}
                                                            {item.product_id?.sku && item.product_id?.part_number && <span className="mx-2 text-zinc-300">|</span>}
                                                            {item.product_id?.part_number && <span>P/N: <strong className="text-zinc-700 dark:text-zinc-200">{item.product_id.part_number}</strong></span>}
                                                        </p>
                                                    )}
                                                    <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-zinc-500 font-medium">
                                                        <span>{isAr ? 'الكمية' : 'Qty'}: <strong className="text-zinc-700 dark:text-zinc-200">{item.quantity}</strong></span>
                                                        <span>{item.variant_label && item.variant_label !== 'Default' ? item.variant_label : (isAr ? 'افتراضي' : 'Default')}</span>
                                                        <span className="text-marine-primary font-bold">{currency} {(item.unit_price * item.quantity).toFixed(2)}</span>
                                                        {item.commission_amount !== undefined && (
                                                            <span className="text-zinc-400">| {isAr ? 'عمولة: ' : 'Comm: '} {currency} {item.commission_amount.toFixed(2)} ({item.commission_rate}%)</span>
                                                        )}
                                                        {item.return_status && item.return_status !== 'none' && (
                                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-widest ${
                                                                item.return_status === 'refunded' ? 'bg-emerald-500/20 text-emerald-500'
                                                                : item.return_status === 'returned' ? 'bg-indigo-500/20 text-indigo-500'
                                                                : item.return_status === 'return_in_progress' ? 'bg-cyan-500/20 text-cyan-500'
                                                                : item.return_status === 'return_approved' ? 'bg-violet-500/20 text-violet-500'
                                                                : 'bg-amber-500/20 text-amber-500'
                                                            }`}>
                                                                {item.return_status.replace(/_/g, ' ')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {currentNote && (
                                                        <p className="mt-2 text-sm text-zinc-500 italic bg-zinc-50 dark:bg-white/5 p-2 rounded-lg border border-zinc-100 dark:border-white/5">
                                                            <AlertTriangle size={14} className="inline me-1 text-amber-500" />
                                                            {currentNote}
                                                        </p>
                                                    )}
                                                    {(getProductHref(item.product_id) || item.product_id?._id) && (
                                                        <div className="flex flex-wrap items-center gap-2 mt-3">
                                                            {getProductHref(item.product_id) && (
                                                                <Link
                                                                    href={getProductHref(item.product_id)}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark shadow-sm transition-colors"
                                                                >
                                                                    <ExternalLink size={15} />
                                                                    {isAr ? 'فتح صفحة المنتج' : 'Open Product Page'}
                                                                </Link>
                                                            )}
                                                            {item.product_id?._id && (
                                                                <Link
                                                                    href={`/admin/dashboard/products/${item.product_id._id}`}
                                                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/20 transition-colors"
                                                                >
                                                                    <Edit3 size={15} />
                                                                    {isAr ? 'تعديل المنتج' : 'Edit Product'}
                                                                </Link>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Item Status */}
                                            <div className="sm:w-48 flex-shrink-0 flex flex-col justify-center">
                                                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                                                    {isAr ? 'حالة المنتج' : 'Item Status'}
                                                </p>
                                                {editingItems ? (
                                                    <div className="space-y-2">
                                                        <div className="flex gap-1 p-1 bg-zinc-50 dark:bg-white/5 rounded-xl border border-zinc-100 dark:border-white/5">
                                                            {ITEM_STATUSES.map(s => (
                                                                <button
                                                                    key={s.value}
                                                                    onClick={() => handleItemStatusChange(item._id.toString(), s.value)}
                                                                    title={isAr ? s.label_ar : s.label_en}
                                                                    className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1 transition-colors ${
                                                                        currentStatus === s.value
                                                                            ? `${s.color} ring-1 ring-current`
                                                                            : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-white'
                                                                    }`}
                                                                >
                                                                    {s.value === 'pending' && <Clock size={15} />}
                                                                    {s.value === 'approved' && <CheckCircle2 size={15} />}
                                                                    {s.value === 'declined' && <XCircle size={15} />}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        {currentStatus === 'declined' && (
                                                            <input
                                                                type="text"
                                                                placeholder={isAr ? 'سبب الرفض (إلزامي)' : 'Reason (required)'}
                                                                value={currentNote}
                                                                onChange={e => handleItemNoteChange(item._id.toString(), e.target.value)}
                                                                className="w-full text-sm bg-zinc-50 dark:bg-white/5 border border-red-500/30 text-zinc-900 dark:text-white rounded-xl px-3 py-2 focus:outline-none focus:border-red-500"
                                                            />
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => openReplacementModal(item)}
                                                            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-marine-cyan/10 text-marine-primary hover:bg-marine-cyan/20 transition-colors"
                                                        >
                                                            <RefreshCw size={14} />
                                                            {isAr ? 'استبدال المنتج' : 'Replace Item'}
                                                        </button>
                                                        {item.vendor_status === 'declined' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteItem(item)}
                                                                disabled={saving}
                                                                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                                            >
                                                                <Trash2 size={14} />
                                                                {isAr ? 'حذف المنتج' : 'Delete Item'}
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold uppercase tracking-wide ${statusInfo.color}`}>
                                                        {currentStatus === 'pending' && <Clock size={15} />}
                                                        {currentStatus === 'approved' && <CheckCircle2 size={15} />}
                                                        {currentStatus === 'declined' && <XCircle size={15} />}
                                                        {isAr ? statusInfo.label_ar : statusInfo.label_en}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Bosta Shipments Panel */}
            {order.shipments && order.shipments.length > 0 && (
                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide flex items-center gap-2">
                            <Truck size={15} className="text-marine-primary" />
                            {isAr ? 'الشحنات' : 'Shipments'}
                        </h3>
                        <button
                            onClick={handleRefreshTracking}
                            disabled={refreshingTracking}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                            <RefreshCw size={12} className={refreshingTracking ? 'animate-spin' : ''} />
                            {isAr ? 'تحديث التتبع' : 'Refresh Tracking'}
                        </button>
                    </div>

                    <div className="space-y-4">
                        {order.shipments.map((shipment, idx) => {
                            const vendorGroup = order.vendor_groups?.find(g => g.vendor?._id === shipment.vendor_id?.toString() || g.vendor?._id === shipment.vendor_id);
                            const vendorName = vendorGroup?.vendor?.store_name || vendorGroup?.vendor?.store_username || (isAr ? 'بائع' : 'Vendor');
                            const statusColor = getShipmentStatusColor(shipment.bosta_status);

                            return (
                                <div key={shipment._id || idx} className="border border-zinc-200 dark:border-white/10 rounded-xl p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                        <div>
                                            <p className="text-sm font-bold text-zinc-900 dark:text-white">
                                                {isAr ? `شحنة ${idx + 1}` : `Shipment ${idx + 1}`} - {vendorName}
                                            </p>
                                            <p className="text-xs text-zinc-400 mt-0.5">
                                                {isAr ? 'رقم التتبع: ' : 'Tracking: '}
                                                <span className="font-mono font-bold text-zinc-700 dark:text-zinc-200">{shipment.tracking_number || shipment.bosta_tracking_number || '-'}</span>
                                                {shipment.provider && shipment.provider !== 'bosta' && (
                                                    <span className="ms-2 inline-flex items-center text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-widest bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300">{shipment.provider}</span>
                                                )}
                                            </p>
                                            {shipment.pickup_address?.address && (
                                                <p className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1">
                                                    <MapPin size={10} />
                                                    {shipment.pickup_address.address}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {/* No waybill was printed for this parcel — the vendor
                                                scanned a label that was already on it. */}
                                            {shipment.is_smart_label && (
                                                <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-widest bg-indigo-500/15 text-indigo-500">
                                                    <ScanLine size={11} />
                                                    {isAr ? 'ملصق' : 'Sticker'}{shipment.smart_label_barcode ? ` ${shipment.smart_label_barcode}` : ''}
                                                </span>
                                            )}
                                            <span className={`inline-flex items-center text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-widest ${statusColor}`}>
                                                {getShipmentStatusLabel(shipment.bosta_status, isAr)}
                                            </span>
                                            <button
                                                onClick={() => handlePrintAWB(shipment._id)}
                                                className="px-2 py-1 rounded-lg text-[10px] font-bold bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
                                            >
                                                AWB
                                            </button>
                                        </div>
                                    </div>

                                    {/* ---- What this parcel costs us, and what it collects ----
                                        Every shipping figure on one line, because the three of
                                        them are constantly confused for each other: what the
                                        customer paid for shipping, what the trip costs us, and
                                        what the courier is holding.

                                        The distinction that matters is `billing_mode`. On a
                                        prepaid Bosta bundle the trip was paid up front — one
                                        parcel off the balance, the same to Cairo or Aswan — so
                                        the courier deducts NOTHING for it from the cash, and
                                        this parcel's cost is the bundle's credit price rather
                                        than the 97/140/564 rate card. */}
                                    {shipment.courier_cost?.recorded_at && (() => {
                                        const c = shipment.courier_cost;
                                        const prepaid = c.billing_mode === 'bundle';
                                        const cod = Number(shipment.cod_amount || 0);
                                        const kept = prepaid
                                            ? Number(c.extra_cod || 0) + Number(c.rto || 0) + Number(c.cancel_fee || 0)
                                            : Number(c.total || 0);
                                        const settled = shipment.cod_settlement?.settled_at;
                                        return (
                                            <div className="border-t border-zinc-100 dark:border-white/5 pt-3 mt-3">
                                                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">
                                                    {isAr ? 'تكلفة الشحنة وفلوسها' : 'Cost & cash'}
                                                </p>
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                                    <CostCell
                                                        label={isAr ? 'العميل دفع شحن' : 'Customer paid'}
                                                        value={`${currency} ${Number(c.charged || 0).toFixed(2)}`}
                                                    />
                                                    <CostCell
                                                        label={isAr ? 'تكلفة التوصيل علينا' : 'Delivery cost'}
                                                        value={`${currency} ${Number(c.send || 0).toFixed(2)}`}
                                                        note={prepaid
                                                            ? (isAr ? 'مدفوعة مقدّم بالباقة' : 'prepaid by bundle')
                                                            : (isAr ? 'بتعريفة الشركة' : 'at the rate card')}
                                                        tone={prepaid ? 'good' : 'plain'}
                                                    />
                                                    <CostCell
                                                        label={isAr ? 'رسوم تحصيل' : 'Collection fee'}
                                                        value={`${currency} ${Number(c.extra_cod || 0).toFixed(2)}`}
                                                        note={Number(c.extra_cod || 0) > 0
                                                            ? (isAr ? 'بتتخصم من الكاش' : 'taken from the cash')
                                                            : (isAr ? 'مفيش' : 'none')}
                                                    />
                                                    {cod > 0 ? (
                                                        <CostCell
                                                            label={isAr ? 'مستحق من الشركة' : 'Owed by courier'}
                                                            value={`${currency} ${(cod - kept).toFixed(2)}`}
                                                            note={settled
                                                                ? (isAr ? 'اتحوّل للبنك' : 'transferred')
                                                                : (isAr ? `محصّل ${cod.toFixed(2)} لسه عندهم` : `${cod.toFixed(2)} collected, still held`)}
                                                            tone={settled ? 'good' : 'brand'}
                                                        />
                                                    ) : (
                                                        <CostCell
                                                            label={isAr ? 'التحصيل' : 'Collection'}
                                                            value={isAr ? 'مدفوع أونلاين' : 'Paid online'}
                                                            note={isAr ? 'مفيش كاش عند الشركة' : 'no cash at the courier'}
                                                        />
                                                    )}
                                                </div>
                                                {prepaid && Number(c.list_send || 0) > Number(c.send || 0) && (
                                                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-2">
                                                        {isAr
                                                            ? `سعر الشحنة دي عند بوسطة من غير باقة كان ${currency} ${Number(c.list_send).toFixed(2)} — الباقة وفّرت ${currency} ${(Number(c.list_send) - Number(c.send)).toFixed(2)}`
                                                            : `Rate card for this parcel is ${currency} ${Number(c.list_send).toFixed(2)} — the bundle saved ${currency} ${(Number(c.list_send) - Number(c.send)).toFixed(2)}`}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* Tracking Timeline */}
                                    {shipment.tracking_history && shipment.tracking_history.length > 0 && (
                                        <div className="border-t border-zinc-100 dark:border-white/5 pt-3 mt-3">
                                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">{isAr ? 'سجل التتبع' : 'Tracking History'}</p>
                                            <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                                {shipment.tracking_history.slice().reverse().map((entry, ei) => (
                                                    <div key={ei} className="flex items-start gap-2 text-xs">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-marine-cyan mt-1.5 flex-shrink-0" />
                                                        <div>
                                                            <span className="font-bold text-zinc-700 dark:text-zinc-200">{entry.state}</span>
                                                            {entry.notes && <span className="text-zinc-400 ms-2">{entry.notes}</span>}
                                                            <p className="text-[10px] text-zinc-400 mt-0.5">
                                                                {entry.timestamp ? new Date(entry.timestamp).toLocaleString(isAr ? 'ar-u-ca-gregory' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Pickup Status */}
                                    {(() => {
                                        const pickup = orderPickups.find(p => p.location_address === shipment.pickup_address?.address);
                                        if (!pickup) return null;
                                        const pickupColor = pickup.status === 'picked_up' ? 'bg-emerald-500/20 text-emerald-500'
                                            : pickup.status === 'cancelled' ? 'bg-red-500/20 text-red-500'
                                            : 'bg-blue-500/20 text-blue-500';
                                        return (
                                            <div className="border-t border-zinc-100 dark:border-white/5 pt-3 mt-3 flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                    <Truck size={12} className="text-blue-500" />
                                                    <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                                                        {isAr ? 'الاستلام:' : 'Pickup:'} {pickup.scheduled_date} ({pickup.scheduled_time_slot})
                                                    </span>
                                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${pickupColor}`}>
                                                        {pickup.status}
                                                    </span>
                                                </div>
                                                {pickup.status === 'scheduled' && (
                                                    <button
                                                        onClick={async () => {
                                                            if (!confirm(isAr ? 'إلغاء الاستلام؟' : 'Cancel this pickup?')) return;
                                                            try {
                                                                await adminApi.cancelPickup(pickup._id);
                                                                setOrderPickups(prev => prev.map(p => p._id === pickup._id ? { ...p, status: 'cancelled' } : p));
                                                            } catch (err) { alert(err.message); }
                                                        }}
                                                        className="text-[10px] font-bold text-red-500 hover:text-red-600"
                                                    >
                                                        {isAr ? 'إلغاء' : 'Cancel'}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {replacementModal && (
                <Overlay className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col">
                        <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-black text-zinc-900 dark:text-white">
                                    {isAr ? 'استبدال المنتج' : 'Replace Item'}
                                </h3>
                                <p className="text-xs text-zinc-500 mt-0.5">{replacementModal.product_title}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setReplacementModal(null)}
                                className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-5 overflow-y-auto space-y-5">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                <div className="lg:col-span-2 space-y-3">
                                    <div className="relative">
                                        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                                        <input
                                            value={replacementSearch}
                                            onChange={e => setReplacementSearch(e.target.value)}
                                            placeholder={isAr ? 'ابحث عن منتج بديل' : 'Search replacement products'}
                                            className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
                                        />
                                    </div>

                                    <div className="border border-zinc-200 dark:border-white/10 rounded-xl overflow-hidden max-h-[360px] overflow-y-auto">
                                        {replacementLoading ? (
                                            <div className="py-12 flex justify-center">
                                                <Loader2 size={24} className="animate-spin text-marine-primary" />
                                            </div>
                                        ) : filteredReplacementProducts.length === 0 ? (
                                            <div className="py-12 text-center text-sm text-zinc-400">
                                                {isAr ? 'لا توجد منتجات منشورة مطابقة' : 'No matching published products'}
                                            </div>
                                        ) : (
                                            filteredReplacementProducts.map(product => {
                                                const selected = product._id === replacementForm.product_id;
                                                const title = product.title_en || product.title_ar || 'Untitled product';
                                                const price = product.discount_price ?? product.price;

                                                return (
                                                    <button
                                                        key={product._id}
                                                        type="button"
                                                        onClick={() => selectReplacementProduct(product)}
                                                        className={`w-full text-start px-4 py-3 flex gap-3 border-b border-zinc-100 dark:border-white/5 last:border-b-0 transition-colors ${
                                                            selected ? 'bg-marine-cyan/10' : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                                                        }`}
                                                    >
                                                        <div className="w-14 h-14 rounded-xl bg-zinc-100 dark:bg-white/5 overflow-hidden border border-zinc-200 dark:border-white/10 flex-shrink-0">
                                                            {product.images?.[0]?.url ? (
                                                                <img src={product.images[0].url} alt="" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center">
                                                                    <Package size={16} className="text-zinc-300" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-sm font-black text-zinc-900 dark:text-white truncate">{title}</p>
                                                            <p className="text-xs text-zinc-400 mt-0.5">
                                                                {product.vendor_id?.store_name || product.vendor_id?.store_username || 'Vendor'}
                                                            </p>
                                                            <p className="text-xs font-bold text-marine-primary mt-1">{currency} {Number(price || 0).toFixed(2)}</p>
                                                        </div>
                                                        {selected && <CheckCircle2 size={18} className="text-marine-primary mt-1" />}
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0E1012] p-4">
                                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                                            {isAr ? 'المنتج المختار' : 'Selected Product'}
                                        </p>
                                        {selectedReplacementProduct ? (
                                            <div>
                                                <p className="text-sm font-black text-zinc-900 dark:text-white">
                                                    {selectedReplacementProduct.title_en || selectedReplacementProduct.title_ar}
                                                </p>
                                                <p className="text-xs text-zinc-400 mt-1">
                                                    {selectedReplacementProduct.vendor_id?.store_name || selectedReplacementProduct.vendor_id?.store_username}
                                                </p>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-zinc-400">{isAr ? 'لم يتم اختيار منتج' : 'No product selected'}</p>
                                        )}
                                    </div>

                                    {selectedReplacementProduct?.variants?.length > 0 && (
                                        <div>
                                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                                                {isAr ? 'النوع' : 'Variant'}
                                            </label>
                                            <select
                                                value={replacementForm.variant_id}
                                                onChange={e => handleReplacementVariantChange(e.target.value)}
                                                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-marine-cyan"
                                            >
                                                {selectedReplacementProduct.variants.map(variant => (
                                                    <option key={variant._id} value={variant._id}>
                                                        {getVariantLabel(variant)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                                                {isAr ? 'الكمية' : 'Quantity'}
                                            </label>
                                            <input
                                                type="number"
                                                min="1"
                                                value={replacementForm.quantity}
                                                onChange={e => setReplacementForm(prev => ({ ...prev, quantity: e.target.value }))}
                                                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-marine-cyan"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                                                {isAr ? 'سعر الوحدة' : 'Unit Price'}
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={replacementForm.unit_price}
                                                onChange={e => setReplacementForm(prev => ({ ...prev, unit_price: e.target.value }))}
                                                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-marine-cyan"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                                            {isAr ? 'سبب الاستبدال' : 'Replacement Reason'}
                                        </label>
                                        <textarea
                                            value={replacementForm.reason}
                                            onChange={e => setReplacementForm(prev => ({ ...prev, reason: e.target.value }))}
                                            rows={4}
                                            placeholder={isAr ? 'مثال: البائع رفض المنتج أو تأخر في التأكيد' : 'Example: vendor declined or confirmation is delayed'}
                                            className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-marine-cyan resize-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="px-5 py-4 border-t border-zinc-100 dark:border-white/5 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setReplacementModal(null)}
                                className="px-4 py-2 rounded-xl text-sm font-bold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                            >
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button
                                type="button"
                                onClick={submitReplacement}
                                disabled={saving || !replacementForm.product_id}
                                className="px-4 py-2 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                {isAr ? 'تأكيد الاستبدال' : 'Confirm Replacement'}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}

function HistoryItemSnapshot({ label, item, href, currency }) {
    const content = (
        <div className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.03] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{label}</p>
                <p className="text-[10px] font-bold text-marine-primary">
                    {currency} {Number((item.unit_price || 0) * (item.quantity || 0)).toFixed(2)}
                </p>
            </div>
            <p className="mt-1 font-bold text-zinc-800 dark:text-zinc-100">{item.product_title || 'Unknown item'}</p>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                {item.vendor_name || item.vendor_username || 'Unknown vendor'} · {item.variant_label || 'Default'} · Qty {item.quantity || 1}
            </p>
        </div>
    );

    return href ? (
        <Link href={href} className="block hover:opacity-80 transition-opacity">
            {content}
        </Link>
    ) : content;
}

// Inline icon for vendor in the detail page
function Store({ size, className }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
    );
}

/**
 * One figure in a parcel's cost breakdown.
 *
 * `note` carries the sentence that makes the number mean something — "prepaid by bundle",
 * "still held" — because on this card every figure is in the same currency and they are
 * otherwise indistinguishable.
 */
function CostCell({ label, value, note, tone = 'plain' }) {
    const tones = {
        plain: 'text-zinc-900 dark:text-white',
        good: 'text-emerald-600 dark:text-emerald-400',
        brand: 'text-marine-primary',
    };
    return (
        <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{label}</p>
            <p dir="ltr" className={`text-sm font-black tabular-nums mt-0.5 ${tones[tone]}`}>{value}</p>
            {note && <p className="text-[10px] text-zinc-400 mt-0.5">{note}</p>}
        </div>
    );
}
