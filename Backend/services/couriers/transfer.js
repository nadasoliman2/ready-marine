const couriers = require('./index');
const core = require('../subOrderService');
const fulfillment = require('../bostaFulfillmentService');
const { withOperation } = require('./operation');

const fail = (message, status = 409) => Object.assign(new Error(message), { status });

function blockedReason(sub, isAr = false) {
  if (sub.dispatch_attempt?.at) return isAr ? 'راجع نتيجة الإرسال السابق في بوابة الشركة الأول.' : 'Resolve the previous send in the courier portal first.';
  if (sub.courier_cancel_pending?.at && !sub.courier_cancel_pending.done_at) return isAr ? 'أكّد حذف البوليصة السابقة الأول.' : 'Confirm removal of the previous waybill first.';
  if (sub.pickup_booked_at || sub.pickup_id || sub.handed_over_at) return isAr ? 'لازم تلغي حجز الاستلام قبل التحويل. لو المندوب استلم الطرد بالفعل، التحويل مقفول.' : 'Cancel the pickup before transferring; a parcel already handed to a courier cannot be transferred.';
  if (sub.company_batch?.role === 'lead' || sub.company_batch?.role === 'rider' || sub.status === 'held_in_batch') return isAr ? 'الطرد المجمّع لطلبات الشركة ماينفعش يتحول كطلب منفرد.' : 'A combined company parcel cannot be transferred individually.';
  if (!core.AT_VENDOR_STATUSES.includes(sub.status)) return isAr ? 'التحويل متاح للشحنات اللي لسه عند التاجر فقط.' : 'Only a parcel still at the vendor can change courier.';
  return null;
}

async function destinationFor(order, target, sectorId) {
  if (!couriers.isProvider(target)) throw fail('Unknown courier', 400);
  if (target === 'bosta') {
    if (!process.env.BOSTA_API_KEY) throw fail('Bosta is not configured', 400);
    if (!order.shipping?.destination?.city) throw fail('Choose the destination city before transferring to Bosta.', 400);
    return null;
  }
  if (!require('./arrive/client').isConfigured()) throw fail('Arrive is not configured', 400);
  const sectors = require('./arrive/sectors');
  let sector = sectorId ? await sectors.getSector(sectorId) : null;
  if (!sectorId) {
    const suggestion = await sectors.suggestSector({ address: order.shipping_address?.full_address || '', city: order.shipping?.destination?.city || '' });
    if (suggestion.confidence === 'high') sector = suggestion.sector;
  }
  if (!sector) throw fail('Choose the Arrive delivery area before transferring.', 400);
  if (sector.serviceable === false || require('./arrive/tariff').isUnservedGroup(sector.gov_name)) throw fail('Arrive does not serve this delivery area.', 400);
  return sector;
}

async function transfer({ order, sub, target, sectorId, removedTracking, actor = {} }) {
  return withOperation(order, async (operationToken) => {
    const blocked = blockedReason(sub);
    if (blocked) throw fail(blocked);
    const oldShipment = core.liveShipmentFor(order, sub);
    const source = oldShipment ? couriers.providerOfShipment(oldShipment) : await couriers.courierFor(sub);
    const oldTracking = couriers.trackingNumberOf(sub);
    if (source === target) throw fail('This parcel already uses this courier. Use Send to retry an unfinished dispatch.');
    if (oldTracking && !oldShipment) throw fail('The current shipment record is missing. Reconcile it before transferring.');
    if (sub.courier_transfer?.phase === 'removing' && sub.courier_transfer.to !== target) throw fail('Finish the pending courier transfer first.');

    // Validate destination BEFORE touching the source delivery.
    const sector = await destinationFor(order, target, sectorId);
    if (!order.shipping_address?.full_address || !order.shipping_address?.phone) throw fail('The delivery address and recipient phone are required.', 400);
    if (oldShipment && !couriers.capabilities(source).cancelApi && String(removedTracking || '') !== String(oldTracking)) {
      throw fail(`Delete waybill ${oldTracking} from ${couriers.labelOf(source)} first, then confirm that exact waybill in the transfer form.`);
    }
    if (oldShipment && source === 'bosta' && !oldShipment.bosta_delivery_id) throw fail('The Bosta delivery ID is missing. Reconcile the waybill before transferring.');

    // A crash after the DELETE must never leave a parcel free to dispatch to both couriers.
    sub.courier_transfer = { phase: 'removing', from: source, to: target, tracking_number: oldTracking, at: new Date() };
    await order.save();
    if (oldShipment && couriers.capabilities(source).cancelApi) {
      try {
        await require('../bostaService').terminateDelivery(oldShipment.bosta_delivery_id);
      } catch (err) {
        // A retry after a successful DELETE can legitimately find nothing left to delete.
        if (err.status !== 404 && err.statusCode !== 404) {
          throw fail(`Could not remove waybill ${oldTracking} from ${couriers.labelOf(source)}: ${err.message}. No replacement was sent; retry this transfer after checking the courier.`);
        }
      }
    }

    const oldRecord = oldShipment?.toObject ? oldShipment.toObject() : oldShipment;
    core.appendSubHistory(sub, 'courier_transferred', 'Courier changed',
      `${couriers.labelOf(source)} → ${couriers.labelOf(target)}. Replace the old waybill before handing over the parcel.`,
      { from: source, to: target, removed_tracking: oldTracking, removed_manually: !!oldShipment && !couriers.capabilities(source).cancelApi, retired_shipment: oldRecord || null }, actor);
    // Keep the retired record in audit history, not in the active shipments collection:
    // customer/vendor tracking, labels, pickup queues and courier finance all see only the replacement.
    if (oldShipment) order.shipments.pull(oldShipment._id);
    sub.courier = target;
    sub.courier_sector_id = sector?.sector_id || null;
    sub.courier_sector_name = sector?.name || '';
    sub.courier_transfer_count = Number(sub.courier_transfer_count || 0) + 1;
    sub.courier_transfer = null;
    sub.shipment_id = null;
    sub.tracking_number = null;
    sub.bosta_tracking_number = null;
    sub.smart_label_barcode = null;
    sub.tracking_assigned_at = null;
    sub.ready_at = null;
    sub.pickup_id = null;
    sub.pickup_booked_at = null;
    if (oldShipment) sub.status = 'awaiting_tracking';
    core.syncOrderStatus(order, actor.label);
    // Commit the removal and new courier even if the replacement API is unavailable.
    await order.save();

    await require('../smartLabelService').forceRelease([
      oldRecord?.smart_label_barcode || (oldRecord?.is_smart_label ? oldRecord.bosta_tracking_number : null),
    ].filter(Boolean));
    await require('../smartLabelService').releaseReservations(order, { vendorId: sub.vendor_id, reason: 'Courier changed', actor });

    let dispatchError = fulfillment.dispatchBlockedReason(order, sub, false, false, { allowWithoutLabel: true, provider: target });
    if (!dispatchError) {
      try {
        await fulfillment.dispatchSubOrder(order, sub, { actor, operationToken });
        sub.items_confirmed_at = sub.items_confirmed_at || new Date();
        sub.tracking_assigned_at = new Date();
        sub.status = 'awaiting_handover';
      } catch (err) {
        dispatchError = err.message;
        core.appendSubHistory(sub, 'sub_order_dispatch_failed', 'Replacement shipment not completed', err.message, { courier: target }, actor);
      }
    }
    core.syncOrderStatus(order, actor.label);
    await order.save();

    try {
      await require('../../models/notifications').createNotification(sub.vendor_id, 'courier_transferred',
        'شركة الشحن اتغيرت / Courier changed',
        `الشحنة ${sub.reference}: ${couriers.labelOf(source, true)} ← ${couriers.labelOf(target, true)}. شيل البوليصة القديمة وجهّز البوليصة الجديدة قبل التسليم. / Replace the old waybill before handover.`,
        { order_id: order._id, sub_order_id: sub._id, courier: target });
    } catch (err) { console.error(`[Courier transfer] Vendor notification failed: ${err.message}`); }
    return { dispatch_error: dispatchError || null, dispatched: !!couriers.trackingNumberOf(sub) };
  });
}

module.exports = { transfer, blockedReason };
