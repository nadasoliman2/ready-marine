'use client';

import { useState, useEffect } from 'react';
import { vendorApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import { Loader2, ArrowLeft, ArrowRight, CheckCircle2, XCircle, Info, Send, MapPin, ExternalLink, Edit3, LifeBuoy } from 'lucide-react';
import Link from '../../../../components/LocaleLink';
import { useRouter } from '../../../../lib/navigation';
import { getShipmentStatusLabel, getShipmentStatusColor } from '../../../../lib/orderStatus';
import SmartLabelScanner from '../../../../components/dashboard/SmartLabelScanner';

const pickupStatusAr = {
  pending: 'قيد الانتظار',
  scheduled: 'مجدول',
  handed_to_courier: 'اتسلمت للمندوب',
  picked_up: 'تم الاستلام',
  cancelled: 'ملغي',
};

const returnStatusAr = {
  return_requested: 'تم طلب الإرجاع',
  return_in_progress: 'الإرجاع قيد التنفيذ',
  return_approved: 'تمت الموافقة على الإرجاع',
  returned: 'تم الإرجاع',
  refunded: 'تم الاسترداد',
};

export default function VendorOrderDetailsPage({ params }) {
  const router = useRouter();
  const { id } = params;
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [itemStatuses, setItemStatuses] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [vendorPickups, setVendorPickups] = useState([]);

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const [pending, supervised, profile] = await Promise.all([
          vendorApi.getOrders(false),
          vendorApi.getOrders(true),
          vendorApi.getProfile()
        ]);
        const allOrders = [...pending, ...supervised];
        const found = allOrders.find(o => o._id === id);
        
        if (found) {
          setOrder(found);
          const initialStatuses = found.items.map(item => ({
            itemId: item._id,
            status: item.vendor_status === 'pending' ? 'approved' : item.vendor_status,
            note: item.vendor_note || ''
          }));
          setItemStatuses(initialStatuses);
          setLocations(profile.locations || []);
          setSelectedLocation(found.fulfillment_location || '');
          // Fetch vendor pickups
          vendorApi.getPickups({}).then(res => setVendorPickups(res.pickups || [])).catch(() => {});
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
  }, [id]);

  const handleStatusChange = (itemId, newStatus) => {
    setItemStatuses(prev => prev.map(s => s.itemId === itemId ? { ...s, status: newStatus } : s));
  };

  const handleNoteChange = (itemId, note) => {
    setItemStatuses(prev => prev.map(s => s.itemId === itemId ? { ...s, note } : s));
  };

  const handleApproveAll = () => {
    setItemStatuses(prev => prev.map(s => ({ ...s, status: 'approved' })));
  };

  // Re-reads the order so the label panel, badge, and shipment card all move together.
  const reloadOrder = async () => {
    const [pending, supervised] = await Promise.all([
      vendorApi.getOrders(false),
      vendorApi.getOrders(true),
    ]);
    const found = [...pending, ...supervised].find(o => o._id === id);
    if (found) setOrder(found);
  };

  const handleScanLabel = async (trackingNumber) => {
    await vendorApi.scanSmartLabel(id, trackingNumber);
    await reloadOrder();
  };

  const handleUnlinkLabel = async () => {
    await vendorApi.unlinkSmartLabel(id);
    await reloadOrder();
  };

  const handleSubmit = async () => {
    const hasInvalidDecline = itemStatuses.some(s => s.status === 'declined' && !s.note.trim());
    if (hasInvalidDecline) {
      alert(isAr ? 'يرجى كتابة سبب الرفض للمنتجات المرفوضة' : 'Please provide a note for all declined items.');
      return;
    }

    setSubmitting(true);
    try {
      await vendorApi.updateOrderStatus(id, itemStatuses, selectedLocation);
      // Approving is what unlocks scanning, so when a label is now due we stay put and
      // let the panel appear — sending the vendor back to the list only to make them
      // reopen the same order is the step this feature exists to remove.
      const [pending, supervised] = await Promise.all([
        vendorApi.getOrders(false),
        vendorApi.getOrders(true),
      ]);
      const updated = [...pending, ...supervised].find(o => o._id === id);
      if (updated?.smart_label_scannable) {
        setOrder(updated);
        return;
      }
      router.push('/dashboard/orders');
      router.refresh();
    } catch (err) {
      alert(isAr ? 'تعذر تحديث الطلب. يرجى المحاولة مرة أخرى.' : (err.message || 'Failed to update the order.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[600px] flex items-center justify-center">
        <Loader2 size={40} className="text-marine-primary animate-spin" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-20">
        <p className="text-zinc-500">{isAr ? 'لم يتم العثور على الطلب.' : 'Order not found.'}</p>
        <Link href="/dashboard/orders" className="text-marine-primary font-bold mt-4 inline-block">
          {isAr ? 'العودة للطلبات' : 'Back to Orders'}
        </Link>
      </div>
    );
  }

  const isPending = order.vendor_supervision_status === 'pending';
  // Any courier: an Arrive shipment carries only the generic `tracking_number`, so
  // checking Bosta's field alone reported "not dispatched" for a parcel already on the
  // road and kept offering the label scanner on it.
  // A sticker is frozen once linked, not once the shipment exists: a parcel that went out
  // on the printed route can still be scanned onto.
  const shipmentDispatched = (order.shipments || []).some(s => s.smart_label_barcode && !s.superseded_at);
  // The shipment in play that carries no sticker — the vendor printed its waybill. The
  // panel then says so instead of demanding a sticker the parcel does not need.
  const liveShipment = [...(order.shipments || [])].reverse().find(
    s => !s.superseded_at && (s.tracking_number || s.bosta_tracking_number)
  );
  const printedWaybill = liveShipment && !liveShipment.smart_label_barcode
    ? (liveShipment.tracking_number || liveShipment.bosta_tracking_number)
    : null;
  // No panel at all before the vendor has reviewed their items — there is nothing to
  // label yet, and an inert control would only add noise.
  const showSmartLabel = order.smart_label_enabled && (order.smart_label || order.smart_label_scannable);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Link 
            href="/dashboard/orders" 
            className="w-10 h-10 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
          </Link>
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-3">
              {isAr ? 'طلب' : 'Order'} <span className="text-marine-primary">#{order.reference}</span>
              <Link
                href={`/dashboard/tickets/new?order=${order._id}`}
                title={isAr ? 'إبلاغ الدعم الفني عن مشكلة في الطلب ده' : 'Report a problem with this order to support'}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-marine-cyan hover:text-white transition-colors"
              >
                <LifeBuoy size={13} /> {isAr ? 'بلّغ عن مشكلة' : 'Report a problem'}
              </Link>
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              {new Date(order.created_at).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', {
                year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
              })}
            </p>
          </div>
        </div>

        {isPending && (
          <div className="flex items-center gap-3">
            <button 
              onClick={handleApproveAll}
              className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold py-2.5 px-6 rounded-xl hover:bg-emerald-500/20 transition-colors text-sm"
            >
              {isAr ? 'الموافقة على الكل' : 'Approve All'}
            </button>
            <button 
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-marine-cyan text-white font-bold py-2.5 px-6 rounded-xl hover:bg-marine-cyan-dark transition-colors text-sm flex items-center gap-2 shadow-lg disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {isAr ? 'تأكيد المراجعة' : 'Submit Confirmations'}
            </button>
          </div>
        )}
      </div>

      {/* Info Banner */}
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex items-start gap-3">
          <Info size={20} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
            {isAr 
              ? 'حفاظاً على الخصوصية، يظهر لك فقط المنتجات الخاصة بك في هذا الطلب. نقوم نحن بالتوصيل والتعامل مع العميل مباشرة.' 
              : 'For privacy, you are only shown the items from your store in this order. We handle shipping and direct communication with the buyer.'}
          </p>
        </div>

        {/* Location Selection */}
        <div className="w-full lg:w-80 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-2xl p-4">
          <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">
            {isAr ? 'فرع التجهيز / الاستلام' : 'Fulfillment / Pickup Location'}
          </label>
          {isPending ? (
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors"
            >
              <option value="" disabled>{isAr ? '-- اختر الفرع --' : '-- Select Branch --'}</option>
              {locations.map((loc, idx) => (
                <option key={idx} value={loc.address}>
                  {loc.address} {loc.is_default && `(${isAr ? 'الافتراضي' : 'Default'})`}
                </option>
              ))}
              {locations.length === 0 && <option value="">{order.fulfillment_location || (isAr ? 'لم يتم تحديد عنوان' : 'No address set')}</option>}
            </select>
          ) : (
            <div className="flex items-center gap-2 text-zinc-900 dark:text-white font-bold text-sm">
              <MapPin size={16} className="text-marine-primary" />
              {order.fulfillment_location || (isAr ? 'غير محدد' : 'Not specified')}
            </div>
          )}
        </div>
      </div>

      {/* Smart Label — stick a pre-printed Bosta label on the parcel and scan it */}
      {showSmartLabel && (
        <SmartLabelScanner
          label={order.smart_label}
          canScan={!!order.smart_label_scannable}
          waybill={printedWaybill}
          dispatched={shipmentDispatched}
          onScan={handleScanLabel}
          onUnlink={handleUnlinkLabel}
          isAr={isAr}
        />
      )}

      {/* Bosta Shipment Tracking (shown after order is ready) */}
      {order.shipments && order.shipments.length > 0 && (
        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide flex items-center gap-2 mb-4">
            <MapPin size={15} className="text-marine-primary" />
            {isAr ? 'تتبع الشحنة' : 'Shipment Tracking'}
          </h3>
          <div className="space-y-3">
            {order.shipments.map((shipment, idx) => {
              const statusColor = getShipmentStatusColor(shipment.bosta_status);

              return (
                <div key={shipment._id || idx} className="border border-zinc-200 dark:border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-zinc-400">
                        {isAr ? 'رقم التتبع' : 'Tracking Number'}
                      </p>
                      <p className="font-mono font-bold text-sm text-zinc-900 dark:text-white">{shipment.tracking_number || shipment.bosta_tracking_number || '-'}</p>
                    </div>
                    <span className={`inline-flex items-center text-xs px-3 py-1.5 rounded-full font-bold uppercase tracking-widest ${statusColor}`}>
                      {getShipmentStatusLabel(shipment.bosta_status, isAr)}
                    </span>
                  </div>
                  {shipment.tracking_history && shipment.tracking_history.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/5 space-y-1.5">
                      {shipment.tracking_history.slice(-3).reverse().map((entry, ei) => (
                        <div key={ei} className="flex items-center gap-2 text-xs text-zinc-500">
                          <div className="w-1.5 h-1.5 rounded-full bg-marine-cyan" />
                          <span className="font-bold">
                            {getShipmentStatusLabel(entry.state, isAr)}
                          </span>
                          <span className="text-zinc-400">
                            {entry.timestamp ? new Date(entry.timestamp).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Pickup info */}
                  {(() => {
                    const pickup = vendorPickups.find(p =>
                      p.order_ids?.includes(id) && p.location_address === shipment.pickup_address?.address
                    );
                    if (!pickup) return null;
                    return (
                      <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-white/5 flex items-center gap-2 text-xs text-zinc-400">
                        <MapPin size={10} className="text-blue-400" />
                        <span>{isAr ? 'استلام:' : 'Pickup:'} {pickup.scheduled_date} ({pickup.scheduled_time_slot})</span>
                        <span className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                          pickup.status === 'picked_up' ? 'bg-emerald-500/20 text-emerald-400' :
                          pickup.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                          'bg-blue-500/20 text-blue-400'
                        }`}>{isAr ? (pickupStatusAr[pickup.status] || pickup.status) : pickup.status.replace(/_/g, ' ')}</span>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Items List */}
      <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-3xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-zinc-100 dark:border-white/5 bg-zinc-50/50 dark:bg-white/[0.02]">
          <h3 className="text-lg font-black text-zinc-900 dark:text-white">
            {isAr ? 'عناصر الطلب المطلوب تجهيزها' : 'Order Items to Fulfill'}
          </h3>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-white/5">
          {order.items.map((item) => {
            const statusObj = itemStatuses.find(s => s.itemId === item._id);
            const currentStatus = statusObj?.status || 'approved';
            const currentNote = statusObj?.note || '';

            return (
              <div key={item._id} className="p-6 flex flex-col md:flex-row gap-8">
                {/* Product Info */}
                <div className="flex-1 flex gap-5">
                  <div className="w-24 h-24 rounded-2xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 overflow-hidden flex-shrink-0">
                    {item.product_image ? (
                      <img src={item.product_image} alt={item.product_title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs font-bold uppercase">{isAr ? 'لا توجد صورة' : 'No Image'}</div>
                    )}
                  </div>
                  <div className="flex flex-col justify-center min-w-0">
                    <h4 className="text-zinc-900 dark:text-white font-bold text-lg mb-1">{item.product_title}</h4>
                    {(item.product_sku || item.product_part_number) && (
                      <p className="text-sm text-zinc-500 font-mono mb-1" dir="ltr">
                        {item.product_sku && <span>SKU: <strong className="text-zinc-700 dark:text-zinc-200">{item.product_sku}</strong></span>}
                        {item.product_sku && item.product_part_number && <span className="mx-2 text-zinc-300">|</span>}
                        {item.product_part_number && <span>P/N: <strong className="text-zinc-700 dark:text-zinc-200">{item.product_part_number}</strong></span>}
                      </p>
                    )}
                    <p className="text-zinc-500 text-sm font-medium mb-3">
                      {isAr ? 'الكمية' : 'Quantity'}: <span className="text-zinc-900 dark:text-white font-black">{item.quantity}</span> &times; {item.variant_label}
                    </p>
                    <p className="text-marine-primary font-black text-base mb-2">
                      {siteSettings?.currency || 'QAR'} {(item.unit_price * item.quantity).toFixed(2)}
                    </p>
                    {item.return_status && item.return_status !== 'none' && (
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-2 w-fit ${
                        item.return_status === 'refunded' ? 'bg-emerald-500/20 text-emerald-500'
                        : item.return_status === 'returned' ? 'bg-indigo-500/20 text-indigo-500'
                        : item.return_status === 'return_in_progress' ? 'bg-cyan-500/20 text-cyan-500'
                        : item.return_status === 'return_approved' ? 'bg-violet-500/20 text-violet-500'
                        : 'bg-amber-500/20 text-amber-500'
                      }`}>
                        {isAr ? (returnStatusAr[item.return_status] || 'قيد الإرجاع') : item.return_status.replace(/_/g, ' ')}
                      </span>
                    )}

                    {/* Financial Breakdown */}
                    <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-zinc-100 dark:border-white/5 pt-3 mt-1">
                      <div className="flex flex-col">
                        <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">{isAr ? 'العمولة' : 'Platform Fee'}</span>
                        <span className="text-base font-bold text-red-500">
                          -{siteSettings?.currency || 'QAR'} {(item.commission_amount || 0).toFixed(2)}
                          <span className="text-xs ml-1 opacity-60">({item.commission_rate || 0}%)</span>
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">{isAr ? 'صافي المبلغ' : 'Your Net'}</span>
                        <span className="text-base font-black text-emerald-500">
                          {siteSettings?.currency || 'QAR'} {((item.unit_price * item.quantity) - (item.commission_amount || 0)).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {(item.product_slug || item.product_id) && (
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        {item.product_slug && (
                          <Link
                            href={`/product/${item.product_slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark shadow-sm transition-colors"
                          >
                            <ExternalLink size={15} />
                            {isAr ? 'فتح صفحة المنتج' : 'Open Product Page'}
                          </Link>
                        )}
                        {item.product_id && (
                          <Link
                            href={`/dashboard/products/${item.product_id?._id || item.product_id}`}
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

                {/* Status Controls */}
                <div className="md:w-72 flex-shrink-0 border-t md:border-t-0 md:border-s border-zinc-100 dark:border-white/5 pt-6 md:pt-0 md:ps-8 flex flex-col justify-center">
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">
                    {isAr ? 'حالة المنتج' : 'Item Status'}
                  </p>
                  
                  {isPending ? (
                    <div className="space-y-4">
                      <div className="flex gap-2 p-1 bg-zinc-50 dark:bg-white/5 rounded-xl border border-zinc-100 dark:border-white/5">
                        <button 
                          onClick={() => handleStatusChange(item._id, 'approved')}
                          className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                            currentStatus === 'approved' 
                              ? 'bg-emerald-500 text-white shadow-md' 
                              : 'text-zinc-500 hover:text-emerald-500'
                          }`}
                        >
                          <CheckCircle2 size={14} /> {isAr ? 'متاح' : 'Approve'}
                        </button>
                        <button 
                          onClick={() => handleStatusChange(item._id, 'declined')}
                          className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                            currentStatus === 'declined' 
                              ? 'bg-red-500 text-white shadow-md' 
                              : 'text-zinc-500 hover:text-red-500'
                          }`}
                        >
                          <XCircle size={14} /> {isAr ? 'غير متاح' : 'Decline'}
                        </button>
                      </div>
                      
                      {currentStatus === 'declined' && (
                        <div className="animate-in fade-in slide-in-from-top-2">
                          <input 
                            type="text"
                            placeholder={isAr ? 'اكتب سبب الرفض (إلزامي)' : 'Reason for decline (Required)'}
                            value={currentNote}
                            onChange={(e) => handleNoteChange(item._id, e.target.value)}
                            className="w-full text-sm bg-zinc-50 dark:bg-white/5 border border-red-500/30 text-zinc-900 dark:text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-red-500 transition-colors"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide ${
                        item.vendor_status === 'approved' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                      }`}>
                        {item.vendor_status === 'approved' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                        {item.vendor_status === 'approved' ? (isAr ? 'تمت الموافقة' : 'Approved') : (isAr ? 'مرفوض' : 'Declined')}
                      </span>
                      {item.vendor_status === 'declined' && item.vendor_note && (
                        <p className="mt-2 text-sm text-zinc-500 italic bg-zinc-50 dark:bg-white/5 p-2 rounded-lg border border-zinc-100 dark:border-white/5">
                          "{item.vendor_note}"
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
