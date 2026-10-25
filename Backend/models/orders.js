const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ Shipping Address Snapshot ------------------ */
const shippingAddressSchema = new Schema(
  {
    recipient_name: { type: String, required: true },
    phone: { type: String, required: true },
    full_address: { type: String, required: true },
  },
  { _id: false }
);

/* ------------------ Order Item Snapshot ------------------ */
const orderItemSchema = new Schema(
  {
    product_id: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    product_title: { type: String, required: true },
    product_image: { type: String },

    variant_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },

    variant_label: { type: String },

    quantity: { type: Number, required: true, min: 1 },

    unit_price: { type: Number, required: true }, // snapshot price

    vendor_id: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    vendor_status: { type: String, enum: ["pending", "approved", "declined"], default: "pending" },
    vendor_note: { type: String },

    // Which sub-order fulfils this line. Stored rather than derived from
    // (vendor_id + location) because an admin resolving a declined item can move the line
    // to a DIFFERENT vendor, and a derived membership would silently reassign it while the
    // money already allocated to the old sub-order stayed behind.
    sub_order_id: { type: Schema.Types.ObjectId, default: null, index: true },

    commission_rate: { type: Number, default: 0 },
    commission_amount: { type: Number, default: 0 },

    // ---- Bundle tagging (set when this line came from a purchased bundle) ----
    bundle_id: { type: Schema.Types.ObjectId, ref: "Bundle", default: null, index: true },
    // Distinguishes each purchased bundle instance (two of the same bundle, or a
    // bundle whose member also appears standalone, stay independently returnable).
    bundle_group: { type: Schema.Types.ObjectId, default: null },
    bundle_title: { type: String, default: '' },
    is_bundle_member: { type: Boolean, default: false },

    return_status: {
      type: String,
      enum: ["none", "return_requested", "return_approved", "return_in_progress", "returned", "refunded"],
      default: "none",
    },
  },
  { _id: true }
);

/* ------------------ Transaction (1-to-1 embedded) ------------------ */
const transactionSchema = new Schema(
  {
    amount: { type: Number, required: true },

    payment_method: {
      type: String,
      // "company_account": billed to the customer's employer on its monthly invoice
      // (feature 14). The `company` block on the order says how much of the total that is.
      enum: ["credit_card", "cash", "wallet", "bank_transfer", "company_account"],
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      required: true,
    },

    reference: { type: String, required: true },
    provider: { type: String, default: null },
    provider_mode: { type: String, default: null },
    payment_id: { type: Schema.Types.ObjectId, ref: "OrderPayment", default: null },
    // The wallet ledger row that paid for this order. Set only for
    // `payment_method: "wallet"`, and the link support follows from an order to
    // the money that funded it — and from a refund back to what it reverses.
    wallet_transaction_id: { type: Schema.Types.ObjectId, ref: "WalletTransaction", default: null },
    invoice_id: { type: String, default: null },
    invoice_key: { type: String, default: null },
    payment_url: { type: String, default: null },
    paid_at: { type: Date, default: null },
    failure_reason: { type: String, default: null },
    provider_payload: { type: Schema.Types.Mixed, default: null },

    created_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/* ------------------ Shipping Snapshot (embedded) ------------------ */
const shippingAdjustmentSchema = new Schema(
  {
    source: {
      type: String,
      // `company_batch`: shipping given back when a company consolidation batch closed.
      enum: ["base", "per_item", "per_vendor", "weight", "class", "rule", "policy", "clamp_min", "clamp_max", "company_batch"],
      required: true,
    },
    label: { type: String, default: "" },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const shippingPolicyAppliedSchema = new Schema(
  {
    policy_id: { type: Schema.Types.ObjectId },
    name: { type: String, default: "" },
    action: { type: String, default: "" },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const shippingPerVendorSchema = new Schema(
  {
    vendor_id: { type: Schema.Types.ObjectId, ref: "Seller" },
    cost: { type: Number, default: 0 },
    adjustments: { type: [shippingAdjustmentSchema], default: [] },
  },
  { _id: false }
);

const shippingSnapshotSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    mode: { type: String, enum: ["combined", "split"], default: "combined" },
    destination: {
      country: { type: String, default: null },
      city: { type: String, default: null },
    },
    zone_id: { type: Schema.Types.ObjectId, ref: "ShippingZone", default: null },
    zone_name: { type: String, default: "" },
    method_id: { type: Schema.Types.ObjectId, ref: "ShippingMethod", default: null },
    method_name: { type: String, default: "" },
    method_type: { type: String, default: "" },
    total_weight: { type: Number, default: 0 },
    base_cost: { type: Number, default: 0 },
    adjustments: { type: [shippingAdjustmentSchema], default: [] },
    policies_applied: { type: [shippingPolicyAppliedSchema], default: [] },
    warnings: { type: [String], default: [] },
    total_cost: { type: Number, default: 0 },
    per_vendor: { type: [shippingPerVendorSchema], default: [] },
    // Frozen copy of { method, policies } used at order time, for re-quoting on item replacement.
    config_snapshot: { type: Schema.Types.Mixed, default: null },
    quote_signature: { type: String, default: "" },
  },
  { _id: false }
);

/* ------------------ Order History ------------------ */
const orderHistorySchema = new Schema(
  {
    action: { type: String, required: true },
    title: { type: String, required: true },
    details: { type: String },
    actor_role: { type: String, default: "system" },
    actor_label: { type: String, default: "System" },
    metadata: { type: Schema.Types.Mixed },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true }
);

/* ------------------ Bosta Shipment (embedded per pickup group) ------------------ */
const shipmentTrackingEntrySchema = new Schema(
  {
    state: { type: String, required: true },
    timestamp: { type: Date, required: true },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const shipmentSchema = new Schema(
  {
    vendor_id: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
    // The sub-order this parcel carries. One-to-one: a sub-order is exactly one parcel,
    // because the sub-order key already includes the pickup branch.
    sub_order_id: { type: Schema.Types.ObjectId, default: null, index: true },
    pickup_address: {
      address: { type: String, required: true },
      city: { type: String, default: "" },
      zone: { type: String, default: "" },
      district: { type: String, default: "" },
    },
    /* ---- Which courier carries this parcel ----
     * Stamped at creation and never re-read from settings: an admin switching the default
     * courier must not change how a parcel already on the road is tracked or cancelled.
     * `bosta_*` stays populated for Bosta rows; every row also carries the generic fields.
     */
    provider: { type: String, enum: ["bosta", "arrive"], default: "bosta", index: true },
    tracking_number: { type: String, default: null, index: true },
    provider_shipment_id: { type: String, default: null },
    provider_status: { type: String, default: null },
    // Courier-specific extras worth keeping (Arrive's qr_code, the sector it was sent to).
    provider_payload: { type: Schema.Types.Mixed, default: null },
    bosta_delivery_id: { type: String, default: null },
    bosta_tracking_number: { type: String, default: null },
    bosta_status: { type: String, default: null },
    // The parcel carries a pre-printed Smart Sticker the vendor scanned, so no AWB needs
    // printing. Since September 2026 the sticker is NOT the tracking number: Bosta mints
    // that, and the sticker's barcode is linked to it afterwards — hence the second field.
    is_smart_label: { type: Boolean, default: false },
    smart_label_barcode: { type: String, default: null, index: true },
    // Bosta's own event time for the newest update applied. Guards against a webhook
    // that arrives out of order dragging the shipment back to an earlier state.
    last_event_at: { type: Date, default: null },
    // Set when the parcel this shipment carried was cancelled and then reactivated. The
    // delivery was terminated at Bosta and a new one replaces it; this row is kept for its
    // history, and every tracking path ignores it so a late event for the dead delivery
    // can never touch the parcel that now has a live one.
    superseded_at: { type: Date, default: null },
    superseded_reason: { type: String, default: "" },
    items: [{ type: Schema.Types.ObjectId }], // references order.items[]._id
    cod_amount: { type: Number, default: 0 },

    /* ---- What this parcel cost US ----
     * `shipping.total_cost` on the order is what the CUSTOMER was charged. This is the
     * other half of that sentence — what Bosta bills us — and the gap between the two is
     * the shipping margin the finance module reports.
     *
     * Snapshotted at dispatch rather than derived at report time because `bostaTariff` is
     * a live file: when Bosta raises its rates and we update it, a derived figure would
     * silently re-price every parcel we ever shipped and last quarter's profit would move.
     * Parcels dispatched before this field existed are back-filled from the tariff by
     * `scripts/backfillBostaCosts.js`, which is why `source` records where a number came
     * from — a derived cost is an estimate and the screens say so.
     */
    bosta_cost: {
      // "bundle" when a prepaid bundle paid for the trip, in which case `send` below is the
      // bundle's credit price and not a rate off the sector table. Mirrors the same two
      // fields on `courier_cost`, so whichever ledger a report reads it gets one answer.
      billing_mode: { type: String, enum: ["tariff", "bundle"], default: "tariff" },
      bundle_subscription_id: { type: Number, default: null },
      // Base send rate for the destination sector at this parcel's size, VAT included.
      send: { type: Number, default: 0 },
      // 1% of COD above the free threshold. Charged on the parcel that carries the money.
      extra_cod_fee: { type: Number, default: 0 },
      // This parcel's share of the courier visit that collected it — the visit fee split
      // across the parcels on it, so a single-parcel pickup carries the whole fee.
      pickup_share: { type: Number, default: 0 },
      // Return-to-origin: what bringing it back cost when the customer refused it. Stays
      // 0 on a successful delivery, and is the reason a parcel's margin can go negative.
      rto: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      sector_id: { type: Number, default: null },
      size_key: { type: String, default: null },
      source: { type: String, enum: ["snapshot", "derived"], default: "snapshot" },
      computed_at: { type: Date, default: null },
    },

    sent_at: { type: Date, default: null },
    last_tracked_at: { type: Date, default: null },
    tracking_history: { type: [shipmentTrackingEntrySchema], default: [] },
    error: { type: String, default: null },

    /**
     * What this parcel really costs US at Bosta, against what the customer paid for it.
     *
     * It exists because the two numbers stopped being the same. Retail shipping is a flat
     * 25 EGP per parcel while Bosta still bills the real tariff, so the gap is a subsidy
     * Ready Car pays — and a subsidy nobody measures is a subsidy nobody can decide about.
     * `services/courierCostService.js` writes it; nothing else should.
     *
     * FROZEN AT DISPATCH, not derived on read. `services/bostaTariff.js` is periodically
     * re-read from Bosta's pricing API and updated, so pricing a two-month-old parcel off
     * today's table would silently rewrite every historical margin figure. Same reason the
     * customer's own allocation is frozen at this exact moment.
     */
    courier_cost: {
      // Which tariff priced it. Rows before the courier switch are Bosta.
      provider: { type: String, default: "bosta" },
      /* ---- How the delivery leg was paid for ----
       * "tariff"  billed per parcel at the courier's rate card, out of the cash it collects.
       * "bundle"  already paid: the account is on a prepaid Bosta bundle, so the parcel
       *           costs one of its credits and NOTHING is deducted from the COD for the
       *           delivery itself. Only the COD collection fee still is.
       *
       * The distinction is the whole of the cash question — what a courier owes us on a
       * COD order depends entirely on whether it has already been paid for the trip.
       */
      billing_mode: { type: String, enum: ["tariff", "bundle"], default: "tariff" },
      // The bundle cycle this parcel was drawn from, so a closed cycle's parcels can still
      // be counted against what that cycle cost.
      bundle_subscription_id: { type: Number, default: null },
      // What this leg WOULD have cost at the rate card. Kept on bundle parcels because it
      // is the only way to answer whether the bundle is worth what it cost: a month of
      // parcels to Aswan saves far more than a month of parcels across Cairo.
      list_send: { type: Number, default: 0 },
      // Arrive's pricing group name (e.g. "القاهره"); empty for Bosta.
      group: { type: String, default: "" },
      // Bosta sector (1..7) and pricing size the parcel was billed at.
      sector: { type: Number, default: null },
      size_key: { type: String, default: "" },
      // All VAT-inclusive, because that is what actually leaves the bank account.
      send: { type: Number, default: 0 },
      extra_cod: { type: Number, default: 0 },
      // Bringing a refused parcel back. Added when the parcel reaches `returned`, so it is
      // 0 on a healthy delivery and the field's presence is itself the signal.
      rto: { type: Number, default: 0 },
      // What cancelling this parcel cost us AFTER it was already with the courier.
      //
      // Bosta terminates a delivery for free until a pickup is booked, so this stays 0 for
      // Bosta and the field never had to exist. Arrive has no cancellation at all — the
      // merchant portal's "الغاء التسليم" is commented out of their own page and no request
      // type offers it — and their price list charges a cancellation the FULL delivery fee.
      // Without this the customer's refund went out, Arrive billed us, and no report ever
      // saw the loss. See `couriers/arrive/cancellation.js` for what is and is not known.
      cancel_fee: { type: Number, default: 0 },
      // send + extra_cod + rto + cancel_fee. Maintained by courierCostService on every write.
      total: { type: Number, default: 0 },
      // The customer's side of the same parcel — a copy of `sub_order.shipping_share` — so
      // the subsidy is one subtraction on one document instead of a join at report time.
      charged: { type: Number, default: 0 },
      // False when the destination city is not in the tariff, which makes `send` a guess
      // rather than a price. The report counts these separately instead of averaging a
      // fiction into the total.
      priced: { type: Boolean, default: false },
      recorded_at: { type: Date, default: null },
    },

    /**
     * The cash this parcel collected, and whether it has reached our bank yet.
     *
     * A courier holds the money it collects at the door for days — Bosta transfers weekly,
     * on Wednesdays — so between delivery and transfer there is a real, growing amount of
     * OUR money sitting at a courier that appeared in no report. This is the per-parcel half
     * of that answer; `courierSettlementService` adds them up per courier and matches them
     * against the transfers that actually landed.
     *
     * Stamped at delivery, cleared at settlement. A parcel with a COD, delivered, and no
     * `settled_at` is money we are owed right now.
     */
    cod_settlement: {
      // What the courier says it expects to transfer this parcel's money on. Bosta returns
      // it per delivery (`cashoutInfo.expectedCashoutDate`); other couriers may not.
      expected_at: { type: Date, default: null },
      // When the admin matched this parcel to a transfer that reached the bank. Indexed
      // because "what has a courier not paid us for yet" is asked on every finance screen
      // and must not degrade into a scan of every cash order ever delivered.
      settled_at: { type: Date, default: null, index: true },
      settlement_id: { type: Schema.Types.ObjectId, ref: "CourierSettlement", default: null, index: true },
    },
  },
  { _id: true }
);

/* ------------------ Sub-Order (one per vendor + pickup branch) ------------------ */

/**
 * The unit of FULFILMENT. The order stays the unit of MONEY — one price, one payment,
 * one coupon, one loyalty snapshot — but everything physical happens here: one vendor,
 * one branch, one parcel, one tracking number, one delivery date, one return window.
 *
 * Keyed on (vendor, branch) rather than vendor alone because a vendor shipping from two
 * branches produces two real parcels that Bosta collects separately and delivers days
 * apart. A single row could not answer "delivered when?" for either of them.
 */
const subOrderStatuses = [
  // Vendor-driven, pre-dispatch
  "pending_review",     // vendor still has unreviewed items
  "awaiting_tracking",  // all items available; Bosta delivery created
  "awaiting_handover",  // tracking number assigned; parcel being sealed
  "ready_for_pickup",   // vendor says it is sealed and waiting; surfaces in admin Pickups
  // The vendor's word that the courier physically took the parcel. It sits between
  // "waiting for a courier" and Bosta's own "picked up" because those are two different
  // facts, and until one of them is true NO screen may say the parcel has left the store.
  // Bosta confirming the collection later moves it on to `picked_up`.
  "handed_to_courier",
  // Bosta-driven, post-dispatch
  "pickup_scheduled",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returned",
  "exception",
  // Off-flow
  "needs_admin",        // an item was declined, or the vendor became unavailable
  "cancelled",
  // Company consolidation (feature 14). `held_in_batch`: waiting in the company's batch
  // for colleagues ordering from the same vendor — the vendor does not see it yet, and no
  // deadline runs. `in_batch_parcel`: packed inside a colleague's parcel (the batch's
  // "lead") and travelling with it; where that parcel is lives in
  // `company_batch.mirror_status`, and the parcel becomes `delivered` / `returned` for
  // real when the lead does.
  "held_in_batch",
  "in_batch_parcel",
];

const parcelPhotoSchema = new Schema(
  {
    url: { type: String, required: true },
    uploaded_at: { type: Date, default: Date.now },
    uploaded_by_label: { type: String, default: "" },
  },
  { _id: true }
);

const subOrderHistorySchema = new Schema(
  {
    action: { type: String, required: true },
    title: { type: String, required: true },
    details: { type: String },
    actor_role: { type: String, default: "system" },
    actor_label: { type: String, default: "System" },
    metadata: { type: Schema.Types.Mixed },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true }
);

/**
 * One past cancellation of a parcel, kept whole when the parcel is reactivated. The live
 * `cancelled_at` / `cancel_reason` / `refunded_amount` fields are cleared on reactivation so
 * the parcel reads as alive again; this is where what happened is preserved, so a refund
 * that was given and then taken back can always be explained from the order itself.
 */
const cancellationRecordSchema = new Schema(
  {
    cancelled_at: { type: Date, default: null },
    cancelled_by_role: { type: String, default: null },
    cancel_reason: { type: String, default: "" },
    status_before: { type: String, default: null },
    refunded_amount: { type: Number, default: 0 },
    points_restored: { type: Number, default: 0 },
    coupon_dropped: { type: Boolean, default: false },
    coupon_discount_before: { type: Number, default: null },
    stranded_tracking: { type: String, default: null },
    // The Bosta delivery this parcel had when it was cancelled. Its shipment row stays on
    // the order, marked superseded, so tracking history is never lost.
    bosta_tracking_number: { type: String, default: null },
    shipment_id: { type: Schema.Types.ObjectId, default: null },
    reactivated_at: { type: Date, default: null },
    reactivated_by_label: { type: String, default: "" },
    reactivation_reason: { type: String, default: "" },
    recharged_amount: { type: Number, default: 0 },
    points_reconsumed: { type: Number, default: 0 },
    coupon_restored: { type: Boolean, default: false },
    restored_status: { type: String, default: null },
  },
  { _id: true }
);

const subOrderSchema = new Schema(
  {
    // Customer-facing reference: the order reference with a parcel suffix (REF-A3F9-1).
    reference: { type: String, default: "" },

    vendor_id: { type: Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    // Part of the sub-order's identity, not a mutable preference: changing the branch
    // means a different parcel from a different pickup, which is a different sub-order.
    fulfillment_location: { type: String, default: "" },

    status: { type: String, enum: subOrderStatuses, default: "pending_review", index: true },

    /* ---- Money: the FROZEN allocation ----
     * Bosta exposes no way to change a delivery's COD once created, and these figures are
     * shown to the customer at checkout before they pay. Both reasons say the same thing:
     * once the first sub-order dispatches, this split is fixed. A later cancellation
     * refunds its own share and never re-prices its siblings.
     */
    merchandise_total: { type: Number, default: 0 },
    commission_total: { type: Number, default: 0 },
    shipping_share: { type: Number, default: 0 },
    coupon_share: { type: Number, default: 0 },
    // Who funded this parcel's coupon_share: the vendor's part comes off their earning, the
    // platform's part is our cost. coupon_vendor_share + coupon_platform_share === coupon_share.
    // Absent (older orders) reads as 0 vendor / all platform, which is what they were.
    coupon_vendor_share: { type: Number, default: 0 },
    coupon_platform_share: { type: Number, default: 0 },
    loyalty_share: { type: Number, default: 0 },
    // merchandise + shipping − coupon − loyalty. Σ across sub-orders === order.total_price.
    cod_amount: { type: Number, default: 0 },
    allocation_frozen_at: { type: Date, default: null },

    /* ---- Vendor's three stages ---- */
    items_confirmed_at: { type: Date, default: null },
    tracking_assigned_at: { type: Date, default: null },
    ready_at: { type: Date, default: null },
    // Optional. They are the vendor's evidence if a customer later disputes what arrived,
    // and the admin reviews them before booking a courier — but a parcel with none is still
    // a real sealed parcel, so they never block the vendor from finishing.
    parcel_photos: { type: [parcelPhotoSchema], default: [] },

    /* ---- Courier choice ----
     * `courier` is the admin's per-parcel override; null means "the default courier at the
     * moment of dispatch" (see services/couriers). Arrive addresses parcels by district
     * ("sector"), chosen or auto-suggested before dispatch and kept for the record.
     */
    courier: { type: String, enum: ["bosta", "arrive", null], default: null },
    courier_sector_id: { type: Number, default: null },
    courier_sector_name: { type: String, default: "" },
    courier_transfer_count: { type: Number, default: 0 },
    // A durable checkpoint: never create the replacement before removal is recorded.
    courier_transfer: { type: Schema.Types.Mixed, default: null },
    // Set immediately before a courier create call and cleared after it returns. A stamp
    // still present means the outcome is unknown (timeout, crash) and a second create must
    // not be fired blindly — Arrive has no duplicate guard.
    dispatch_attempt: {
      provider: { type: String, default: null },
      reference: { type: String, default: null },
      at: { type: Date, default: null },
    },

    /* ---- Fulfilment links ---- */
    shipment_id: { type: Schema.Types.ObjectId, default: null },
    // Generic tracking number, whichever courier. Bosta parcels ALSO keep
    // `bosta_tracking_number` because the pickup booking and several screens key on it.
    tracking_number: { type: String, default: null, index: true },
    bosta_tracking_number: { type: String, default: null, index: true },
    // The Smart Sticker on the box, when one was scanned. Distinct from the tracking
    // number Bosta minted; see the shipment schema.
    smart_label_barcode: { type: String, default: null },
    // Set when a pickup is booked. This is what closes the cancel window for BOTH the
    // vendor and the customer — past this point a courier is committed to collecting it.
    pickup_id: { type: Schema.Types.ObjectId, ref: "BostaPickup", default: null },
    pickup_booked_at: { type: Date, default: null },

    /* ---- Handover to the courier ----
     * Set when the VENDOR confirms a Bosta courier physically took the parcel. Kept as its
     * own timestamp rather than inferred from the status, because Bosta's later confirmation
     * overwrites the status and this is the only record of when the store said it happened —
     * which is the figure any argument about a missing parcel turns on.
     */
    handed_over_at: { type: Date, default: null },
    handed_over_by_label: { type: String, default: "" },

    /* ---- Deadline ---- */
    deadline_at: { type: Date, default: null },
    deadline_reminded_at: { type: Date, default: null },
    // Flagged for the admin, never auto-cancelled: a late parcel is still a parcel the
    // customer wants, and cancelling it is a judgement call.
    is_overdue: { type: Boolean, default: false },

    /* ---- Admin intervention ---- */
    // Any decline — partial or total — parks the sub-order here. The vendor cannot
    // proceed; the admin resolves it, usually after speaking to the customer off-platform.
    needs_admin_reason: { type: String, default: "" },
    needs_admin_since: { type: Date, default: null },

    /* ---- Cancellation ---- */
    cancel_request: {
      requested_at: { type: Date, default: null },
      requested_by_role: { type: String, default: null },
      requested_by_label: { type: String, default: null },
      reason: { type: String, default: "" },
    },
    cancelled_at: { type: Date, default: null },
    // Drives coupon re-validation: only a CUSTOMER-initiated cancellation may cost the
    // customer their discount. A vendor running out of stock never does.
    cancelled_by_role: { type: String, default: null },
    cancel_reason: { type: String, default: "" },
    refunded_amount: { type: Number, default: 0 },
    // Where the parcel was when it was cancelled — what a reactivation puts back when the
    // parcel had not yet reached Bosta.
    status_before_cancel: { type: String, default: null },
    // A cancellation the courier could not be told about by API (Arrive has none; a Bosta
    // call that failed). Sits in the admin queue until someone confirms they did it in the
    // courier's portal — a parcel the courier still thinks is live is a parcel that gets
    // collected and billed.
    courier_cancel_pending: {
      provider: { type: String, default: null },
      tracking_number: { type: String, default: null },
      at: { type: Date, default: null },
      done_at: { type: Date, default: null },
      done_by_label: { type: String, default: "" },
      // Arrive has no cancellation, so a human has to finish this by hand — and what they
      // must do differs before and after the courier takes the box (delete the record vs
      // request a return). The wording is frozen here at cancel time, with the fee we
      // expect to be billed, so the screen never has to guess it later.
      stage: { type: String, enum: ["pre_handover", "in_transit", null], default: null },
      instruction: { type: String, default: "" },
      instruction_ar: { type: String, default: "" },
      expected_fee: { type: Number, default: null },
    },

    /* ---- Reactivation ----
     * A cancellation can be reversed by the website team. Each reversal re-charges what
     * the cancellation refunded, takes back the points it returned, and sends the parcel
     * back through the vendor's stages so a NEW Bosta delivery is created — the old one
     * was terminated and cannot be revived. `reactivation_count` makes the ledger keys of
     * a second cancellation distinct from the first, so the customer is refunded again.
     */
    reactivation_count: { type: Number, default: 0 },
    reactivated_at: { type: Date, default: null },
    cancellations: { type: [cancellationRecordSchema], default: [] },

    delivered_at: { type: Date, default: null },

    /* ---- Company consolidation (feature 14) ----
     * Set on the parcels of a company order placed in "consolidate to office" mode. The
     * batch closes into ONE physical parcel: its `lead` is the parcel whose courier delivery
     * carries the whole box, and every other member is a `rider` that ships inside it,
     * with no courier delivery of its own. `role` is null while the parcel is still waiting.
     */
    company_batch: {
      type: new Schema(
        {
          batch_id: { type: Schema.Types.ObjectId, ref: "CompanyBatch", default: null },
          role: { type: String, enum: ["lead", "rider", null], default: null },
          joined_at: { type: Date, default: null },
          released_at: { type: Date, default: null },
          // Left before the batch closed: cancelled, or sent on alone ("ship it now").
          // The link to the batch is kept for the record; the parcel is then an ordinary one.
          left_at: { type: Date, default: null },
          left_reason: { type: String, enum: ["cancelled", "ship_now", null], default: null },
          // Riders only: the lead's status, which is where this parcel physically is.
          mirror_status: { type: String, default: null },
          lead_order_id: { type: Schema.Types.ObjectId, default: null },
          lead_sub_order_id: { type: Schema.Types.ObjectId, default: null },
          lead_reference: { type: String, default: "" },
          // When the lead's courier delivery was created.
          dispatched_at: { type: Date, default: null },
          // Shipping this parcel paid alone at checkout, and what it pays inside the batch.
          standalone_shipping: { type: Number, default: null },
          savings: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: null,
    },

    history: { type: [subOrderHistorySchema], default: [] },

    created_at: { type: Date, default: Date.now },
  },
  { _id: true }
);

/* ------------------ Order Schema ------------------ */
const orderSchema = new Schema(
  {
    courier_operation: { type: Schema.Types.Mixed, default: null },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    status: {
      type: String,
      // DERIVED from sub_orders — never set directly once sub-orders exist. It is a
      // presentation and filtering value; the sub-order status is the source of truth.
      //
      // pending → processing are pre-dispatch. `partially_shipped` and
      // `partially_delivered` exist because one word cannot honestly describe three
      // parcels in three different states, and every screen renders them beside a
      // counter ("1 of 3 delivered"). `partially_cancelled` is an order that kept a
      // delivered parcel while the rest was cancelled.
      //
      // ready, pickup_scheduled, picked_up, in_transit, out_for_delivery, returned and
      // exception still appear when EVERY live sub-order agrees on them.
      //
      // The RETURN states are an overlay on a finished order, derived from the items'
      // `return_status` — which already records every step of the journey back. They exist
      // because "completed" stopped being true the moment the customer sent something back,
      // and one flag cannot say whether the goods are still travelling, already with the
      // vendor, or paid for. They apply only once nothing is still moving forward, so a
      // return on one parcel never hides another parcel that is still on its way:
      //
      //   return_requested   → a return is agreed but the goods have not shipped back
      //   return_in_progress → the goods are travelling back to the vendor
      //   partially_returned → part of the order came back, the customer kept the rest
      //   returned           → all of it came back, refund not issued yet
      //   refunded           → all of it came back and the money was returned
      //
      // `returned` is shared with the Bosta failed-delivery case on purpose: in both the
      // goods ended up back with the vendor, which is what the word says.
      enum: [
        "pending", "processing", "confirmed", "ready",
        "pickup_scheduled", "picked_up", "in_transit", "out_for_delivery",
        "partially_shipped", "partially_delivered", "partially_cancelled",
        "completed",
        "return_requested", "return_in_progress", "partially_returned", "returned", "refunded",
        "exception", "cancelled",
      ],
      default: "pending",
      index: true,
    },

    // ---- Guest checkout provenance ----
    // Placed through an account created silently during this checkout, whose
    // owner had not proved the phone number at the time of ordering. Deliberately
    // NOT part of `status`: that field is derived from sub_orders and describes
    // fulfilment, while this describes how much we know about the customer.
    //
    // For a cash order the pair is what ops needs and nothing more: an order with
    // `placed_as_guest` true and `guest_phone_confirmed_at` null is a COD order
    // to a number nobody has answered on yet, and is worth a call before dispatch.
    placed_as_guest: { type: Boolean, default: false, index: true },
    // Stamped when the customer answered the WhatsApp code sent after ordering.
    guest_phone_confirmed_at: { type: Date, default: null },

    // ---- Chat commerce provenance (Backend/docs/EVERYSECOND_CHAT_COMMERCE.md) ----
    // "everysecond" when the AI agent took the order in a chat (WhatsApp, Messenger,
    // Instagram or the website chat). `chat` links it to EverySecond's own order so
    // the customer can be told, in that same chat, when it is confirmed, shipped and
    // delivered; `announced_status` is the last status they were told about.
    source: { type: String, enum: ["web", "everysecond"], default: "web", index: true },
    chat: {
      type: new Schema(
        {
          es_order_id: { type: Number, default: null, index: true },
          lead_id: { type: Number, default: null },
          channel: { type: String, default: "" },
          conversation_url: { type: String, default: "" },
          announced_status: { type: String, default: "" },
          announce_error: { type: String, default: "" },
          announce_attempts: { type: Number, default: 0 },
          announced_at: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: undefined,
    },

    // ---- Family provenance (set only for orders converted from a family
    // order request). The order OWNER is always the organizer (user_id);
    // requested_by_user_id is provenance only and grants read-only tracking.
    family_id: { type: Schema.Types.ObjectId, ref: "Family", default: null, index: true },
    family_order_request_id: { type: Schema.Types.ObjectId, ref: "FamilyOrderRequest", default: null, index: true },
    requested_by_user_id: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },

    // ---- Friend provenance (set only for "buy for a friend" orders).
    // `user_id` stays the PAYER so all existing financial, refund, and order
    // history logic keeps working unchanged; `ordered_for_user_id` is the
    // recipient and grants read-only delivery visibility, nothing more.
    friendship_id: { type: Schema.Types.ObjectId, ref: "Friendship", default: null, index: true },
    paid_by_user_id: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    ordered_for_user_id: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },

    // ---- Company account (feature 14). Set only when the order was placed "on company
    // account". `user_id` stays the person who ordered; the company is who pays for
    // `company_amount`, and the employee paid `personal_amount` themselves (online) when the
    // order went over what was left of their limit. The company's side of the money lives
    // in CompanyLedgerEntry; these fields are the snapshot of what was agreed at checkout.
    company: {
      type: new Schema({
        company_id: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
        company_name: { type: String, default: "" },
        // company | authority | school | property — only changes the words shown.
        org_type: { type: String, default: "company" },
        membership_id: { type: Schema.Types.ObjectId, default: null },
        // 'employee' — from the person's own limit; 'car' — a manager ordering for a company car.
        beneficiary: { type: String, enum: ["employee", "car"], required: true },
        car_id: { type: Schema.Types.ObjectId, default: null },
        car_label: { type: String, default: "" },
        // Set when the order is delivered to one of the company's offices.
        office_id: { type: Schema.Types.ObjectId, default: null },
        office_name: { type: String, default: "" },
        delivery_mode: { type: String, enum: ["instant", "consolidate"], default: "instant" },
        // The month (store time zone) this order counts against.
        month: { type: String, required: true },
        company_amount: { type: Number, required: true },
        billing_mode: { type: String, enum: ['monthly', 'wallet', 'credit_wallet'], default: 'monthly' },
        personal_amount: { type: Number, default: 0 },
        personal_method: { type: String, enum: ["wallet", "credit_card", null], default: null },
        // Consolidation (phase 3): shipping given back because the parcels rode in a
        // company batch. Already taken off `total_price` and the two amounts above.
        shipping_savings: { type: Number, default: 0 },
        // The employee paid the company's share themselves ("settle"): it comes off the
        // company's bill and back onto their limit, and from then on the order is theirs —
        // `company_amount` drops to 0, so any later refund goes to their wallet.
        settlements: {
          type: [new Schema({
            seq: { type: Number, required: true },
            amount: { type: Number, required: true },
            wallet_transaction_id: { type: Schema.Types.ObjectId, ref: "WalletTransaction", default: null },
            at: { type: Date, default: Date.now },
          }, { _id: false })],
          default: undefined,
        },
      }, { _id: false }),
      default: null,
    },

    shipping_address: shippingAddressSchema, // snapshot

    items: [orderItemSchema], // snapshot

    // The unit of fulfilment. One per (vendor, pickup branch).
    sub_orders: { type: [subOrderSchema], default: [] },

    // True once ANY sub-order has dispatched to Bosta. From this moment the per-sub-order
    // money split is fixed and the admin may no longer edit the order's contents — only
    // cancel a sub-order. Both reasons are hard: Bosta cannot restate a delivery's COD,
    // and these numbers were shown to the customer before they paid.
    allocation_frozen: { type: Boolean, default: false },
    allocation_frozen_at: { type: Date, default: null },

    // Retained alongside sub_orders: still the per-VENDOR financial rollup that vendor
    // dashboards, commissions and reporting read. A vendor with two branches has two
    // sub-orders but one supervision.
    vendor_supervisions: [{
      vendor_id: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
      status: { type: String, enum: ["pending", "supervised"], default: "pending" },
      total_amount: { type: Number, required: true },
      total_commission: { type: Number, default: 0 },
      shipping_cost: { type: Number, default: 0 },
      fulfillment_location: { type: String, default: null },
      _id: false
    }],

    shipping: { type: shippingSnapshotSchema, default: undefined },

    total_price: {
      type: Number,
      required: true,
    },

    coupon_code: { type: String, trim: true },
    coupon_discount_type: { type: String, enum: ['percent', 'fixed'] },
    coupon_discount_value: { type: Number, min: 0 },
    coupon_discount_amount: { type: Number, min: 0, default: 0 },
    coupon_scope_type: {
      type: String,
      enum: ['all_products', 'category_tree', 'product_list', 'vendor_list'],
    },
    // The coupon's funding split as it stood when the order was placed — the vendor's
    // percentage of the discount. Frozen here so a later edit to the coupon cannot move
    // money on an order already priced and shown to the customer.
    coupon_vendor_share_percent: { type: Number, min: 0, max: 100, default: 0 },

    // ---- Loyalty snapshot ----
    // Frozen at placement. The rate snapshots exist because Admin can change
    // the program at any time and a historical order must stay explainable
    // with the numbers it was actually priced with.
    loyalty: {
      // Whoever paid — the same account that owns the points. On a gift order
      // that is `user_id`, never the recipient.
      payer_user_id: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
      // Merchandise after coupon and loyalty discounts; shipping excluded.
      eligible_amount: { type: Number, default: 0 },
      earn_points_pending: { type: Number, default: 0 },
      earned_points_released: { type: Number, default: 0 },
      earned_points_reversed: { type: Number, default: 0 },
      redeemed_points: { type: Number, default: 0 },
      redemption_discount: { type: Number, default: 0 },
      restored_points: { type: Number, default: 0 },
      spend_per_point_snapshot: { type: Number, default: 0 },
      point_value_snapshot: { type: Number, default: 0 },
    },

    shipments: { type: [shipmentSchema], default: [] },

    transaction: transactionSchema, // 1-to-1 embedded

    history: [orderHistorySchema],

    delivered_at: { type: Date, default: null },

    // Timestamp of the WhatsApp order-confirmation message (once-per-order guard).
    whatsapp_confirmation_sent_at: { type: Date, default: null },
    // Provider campaign id for that message. The provider exposes no delivery
    // webhooks, so polling this id is the only way to confirm the message
    // actually reached the customer.
    whatsapp_campaign_id: { type: Number, default: null },

    /**
     * What the provider says actually HAPPENED to that message.
     *
     * `whatsapp_confirmation_sent_at` above only means EverySecond accepted the campaign
     * for dispatch — a 2xx on `POST /send`. It is not delivery, and treating it as delivery
     * is how three failed messages sat in this system looking successful. These three fields
     * hold the answer to the only question that matters, polled from
     * `GET /campaigns/{id}` because the provider offers no delivery webhook.
     */
    whatsapp_delivered_at: { type: Date, default: null },
    // Provider's own campaign state at the last poll: queued, running, completed, failed.
    whatsapp_delivery_status: { type: String, default: null },
    // When it was last polled, so a campaign still in flight is retried and a settled one
    // is left alone.
    whatsapp_delivery_checked_at: { type: Date, default: null },

    /**
     * Whether a HUMAN has heard this customer say yes.
     *
     * The WhatsApp confirmation is one-way. Its template carries a confirm button, but the
     * provider exposes no webhook for a press — so the customer's answer never reaches this
     * system even on a perfect delivery. That makes a phone call the only way an order is
     * ever really confirmed, and this records that call.
     *
     * Raised only when WhatsApp has genuinely given up (see WHATSAPP_MAX_ATTEMPTS): a
     * message that went out is left alone, because chasing every customer by phone is a
     * cost the store pays for nothing.
     *
     *   pending    nothing is wrong — the message went out, or still has attempts left
     *   needs_call every attempt failed; the order team has to ring the customer
     *   confirmed  someone called and the customer confirmed the order
     *   no_answer  someone called and nobody picked up — deliberately still open, so the
     *              order stays in the queue for the next person rather than looking done
     *   refused    the customer disowned the order; cancelling it stays an admin decision,
     *              because the goods may already be moving
     */
    customer_confirmation: {
      status: {
        type: String,
        enum: ["pending", "needs_call", "confirmed", "no_answer", "refused"],
        default: "pending",
        index: true,
      },
      whatsapp_attempts: { type: Number, default: 0 },
      first_attempt_at: { type: Date, default: null },
      last_attempt_at: { type: Date, default: null },
      // The provider's own words for the last failure. Kept because "it did not send" is
      // useless to whoever has to fix it — an expired template and a dead number need
      // completely different actions.
      last_error: { type: String, default: null },
      flagged_at: { type: Date, default: null },
      // Every call anyone made, not just the last: an order nobody could reach after four
      // attempts is a different problem from one nobody has tried yet.
      call_attempts: { type: Number, default: 0 },
      resolved_at: { type: Date, default: null },
      resolved_by: { type: String, default: null },
      note: { type: String, default: null },
    },

    created_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

/* ------------------ Indexing ------------------ */
orderSchema.index({ user_id: 1, created_at: -1 });
// "Which cash orders are still waiting on an unanswered code?" — the one
// question guest checkout adds to the ops queue, answered from an index rather
// than a collection scan that grows with every order ever placed.
orderSchema.index({ placed_as_guest: 1, guest_phone_confirmed_at: 1, created_at: -1 });
// The vendor's queue and the admin's intervention queue both scan on these.
orderSchema.index({ "sub_orders.vendor_id": 1, "sub_orders.status": 1 });
// The overdue sweep reads only sub-orders still owed an action.
orderSchema.index({ "sub_orders.deadline_at": 1, "sub_orders.status": 1 });

/**
 * Company consolidation (feature 14): a batch's lead parcel carries its colleagues' orders
 * inside it, so whenever the lead moves — courier webhook, sweep, vendor, admin — the
 * riders are brought level. The lead records the status it last passed on in
 * `company_batch.mirror_status`; only a difference triggers a sync. Fire-and-forget: the
 * batch sweep repeats it on a timer, so a missed run only delays the riders.
 */
orderSchema.post("save", function (doc) {
  if (process.env.COMPANY_BATCH_SYNC_HOOK === "off") return;
  const moved = (doc.sub_orders || []).some((s) =>
    s.company_batch?.role === "lead" && s.company_batch.dispatched_at && s.status !== s.company_batch.mirror_status);
  if (!moved) return;
  setImmediate(() => {
    require("../services/companyBatchService").syncRidersOfLeadOrder(doc._id)
      .catch((err) => console.error(`[Company batch] Rider sync failed for order ${doc._id}: ${err.message}`));
  });
});

const Order = mongoose.model("Order", orderSchema);

module.exports = { Order, SUB_ORDER_STATUSES: subOrderStatuses };
