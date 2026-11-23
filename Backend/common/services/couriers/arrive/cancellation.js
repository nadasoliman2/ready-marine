/**
 * Cancelling a parcel that is already at Arrive.
 *
 * ── What was established, on their own portal, 2026-09-14 ─────────────────────────────
 *
 * There is NO cancellation. Two independent confirmations:
 *
 *   1. The merchant portal's bulk-action menu ships the option commented OUT of the page:
 *        <option value="delete">حذف</option>
 *        <!-- <option value="cancel_delivery">الغاء التسليم</option> -->
 *      The feature exists in their system and is withheld from merchant accounts.
 *   2. Of the 15 request ("task") types a merchant may raise, none cancels a shipment. The
 *      closest is "مرتجع بعلم الراسل" — bring it back, with the sender's knowledge — which
 *      is a return, priced as one.
 *
 * What a merchant DOES have is **delete** (حذف), offered on every status filter. Deleting is
 * not cancelling: it removes the record rather than stopping the parcel. That distinction is
 * the whole design below.
 *
 * ── The line that actually matters is the HANDOVER, not our dispatch ──────────────────
 *
 * Creating the shipment only produces a waybill. The parcel is still on the vendor's shelf,
 * and deleting the record then is a true cancellation — nothing is in motion. Once the
 * courier has physically taken the box, deleting the record is WORSE than doing nothing: the
 * box keeps travelling under a waybill Arrive no longer knows, so it can neither be delivered
 * nor returned. Hence `deletableNow()` — it refuses to recommend a delete past handover.
 *
 * ── The one thing still unknown ───────────────────────────────────────────────────────
 *
 * Whether deleting BEFORE the courier arrives is free. Their price list charges a
 * cancellation the full delivery fee (`cancel` = 70 EGP in Cairo, the same as `delivery`),
 * and it is not known whether a delete is billed that way or not at all. Until Arrive
 * answers, `PRE_HANDOVER_DELETE_IS_FREE` stays false: we would rather record a cost that
 * turns out not to exist than book a saving that does. Flip the one constant when they
 * answer — nothing else needs to change.
 */
const tariff = require("./tariff");

/**
 * Does a pre-handover delete cost us nothing?
 *
 * TRUE on the owner's judgement (2026-09-15): deleting an order before a courier has been is
 * expected to be free, the same way terminating a Bosta delivery before a pickup is booked is.
 * It is NOT confirmed by Arrive, and their price list does charge a *cancellation* the full
 * delivery fee — so if a settlement ever shows a fee against a parcel we deleted before
 * handover, this assumption is where it came from and flipping it back is the whole fix.
 *
 * This governs the MONEY only. It deliberately does not re-open the customer's cancel window,
 * which stays closed at dispatch — see `subOrderService.cancellability`. A free delete is not
 * the same as a safe one: the delete is manual, so a cancellation at 2am is only free if an
 * admin actually deletes it before the courier arrives in the morning. Re-opening that window
 * is an operations decision, not a pricing one.
 */
const PRE_HANDOVER_DELETE_IS_FREE = true;

/** The parcel is still on the vendor's shelf, so removing it at Arrive stops something real. */
const deletableNow = (sub) =>
  !!sub && !sub.handed_over_at && !sub.pickup_booked_at
  && !["picked_up", "in_transit", "out_for_delivery", "delivered", "returned"].includes(sub.status);

/**
 * What cancelling this parcel costs us, and what a human has to go and do about it.
 *
 * @param {object} sub       the sub-order being cancelled
 * @param {object} shipment  its Arrive shipment row
 * @returns {{ fee: number, priced: boolean, stage: 'pre_handover'|'in_transit',
 *             action: string, action_ar: string }}
 */
function cancellationOutcome(sub, shipment) {
  const group = shipment?.provider_payload?.gov_name || shipment?.courier_cost?.group || null;
  const q = tariff.quote(group, 0);
  const preHandover = deletableNow(sub);

  if (preHandover) {
    return {
      stage: "pre_handover",
      fee: PRE_HANDOVER_DELETE_IS_FREE ? 0 : (q.priced ? q.cancel : 0),
      priced: PRE_HANDOVER_DELETE_IS_FREE ? true : q.priced,
      action:
        "The parcel has not been collected yet. Delete it at Arrive now, before a courier "
        + "turns up: portal → الشحنات → tick the waybill → الإجراء: حذف. Arrive has no "
        + "cancellation, so this is the only way to stop it.",
      action_ar:
        "الشحنة لسه ماتجمعتش. امسحها من Arrive دلوقتي قبل ما المندوب ييجي: "
        + "البورتال ← الشحنات ← علّم على البوليصة ← الإجراء: حذف. "
        + "Arrive مالهاش إلغاء، فده الطريق الوحيد لإيقافها.",
    };
  }

  // The courier already has the box. Deleting the record now would strand it — the parcel
  // would travel under a waybill Arrive cannot resolve. The honest route is a return, and
  // a returned parcel is billed the delivery leg AND the return leg.
  return {
    stage: "in_transit",
    fee: q.priced ? Number(q.refuse || q.delivery || 0) + Number(q.return || 0) : 0,
    priced: q.priced,
    action:
      "The courier already has this parcel — do NOT delete it at Arrive, that would strand "
      + "the box with a waybill they cannot resolve. Raise a \"مرتجع بعلم الراسل\" request on "
      + "the waybill instead and expect it back; Arrive bills the delivery and the return.",
    action_ar:
      "المندوب خد الطرد بالفعل — متمسحهوش من Arrive، ده هيسيب الصندوق ماشي ببوليصة مش "
      + "موجودة عندهم. اعمل طلب \"مرتجع بعلم الراسل\" على البوليصة واستنى يرجع؛ "
      + "Arrive هتحاسبنا على التوصيل والإرجاع.",
  };
}

module.exports = { PRE_HANDOVER_DELETE_IS_FREE, deletableNow, cancellationOutcome };
