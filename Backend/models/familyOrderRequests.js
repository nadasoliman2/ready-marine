const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * FamilyOrderRequest — a PRE-ORDER approval object shared between a family
 * member (requester) and the family organizer.
 *
 * It is deliberately NOT an Order: no vendor supervision, shipment, commission,
 * earnings, or payment object exists until the organizer approves AND either
 * confirms cash on delivery or completes an online payment. All estimated
 * amounts below are display snapshots — never trusted for the final charge.
 */
const REQUEST_STATUSES = [
    'pending_approval',
    'declined',
    'withdrawn',
    'expired',
    'approved_payment_needed',
    'payment_in_progress',
    'order_placed',
];

/* ------------------ Requested line item ------------------ */
const requestItemSchema = new Schema(
    {
        // A line is either a single product or a bundle (mirrors the cart model).
        product_id: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
        variant_id: { type: Schema.Types.ObjectId, default: null },
        bundle_id: { type: Schema.Types.ObjectId, ref: 'Bundle', default: null },
        quantity: { type: Number, required: true, min: 1 },

        // Display snapshots — kept so the request stays readable even if the
        // catalogue changes or the product is later unpublished.
        product_title_snapshot: { type: String, default: '' },
        product_image_snapshot: { type: String, default: '' },
        variant_label_snapshot: { type: String, default: '' },
        estimated_unit_price: { type: Number, default: 0 },

        // Set when the organizer drops an item that became unavailable.
        removed_at_approval: { type: Boolean, default: false },
    },
    { _id: true }
);

/* ------------------ Family Order Request ------------------ */
const familyOrderRequestSchema = new Schema(
    {
        family_id: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
        organizer_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        requester_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

        items: { type: [requestItemSchema], default: [] },

        // The organizer's embedded address _id the member selected.
        organizer_address_id: { type: Schema.Types.ObjectId, default: null },
        shipping_address_snapshot: { type: Schema.Types.Mixed, default: null },
        shipping_destination: { type: Schema.Types.Mixed, default: null },
        shipping_method_id: { type: Schema.Types.ObjectId, ref: 'ShippingMethod', default: null },
        shipping_method_snapshot: { type: Schema.Types.Mixed, default: null },

        coupon_code: { type: String, default: '', trim: true },
        estimated_subtotal: { type: Number, default: 0 },
        estimated_discount: { type: Number, default: 0 },
        estimated_shipping: { type: Number, default: 0 },
        estimated_total: { type: Number, default: 0 },

        member_note: { type: String, default: '', maxlength: 200 },
        decline_reason: { type: String, default: '' },
        decline_note: { type: String, default: '', maxlength: 300 },

        status: { type: String, enum: REQUEST_STATUSES, default: 'pending_approval', index: true },
        approved_at: { type: Date, default: null },
        declined_at: { type: Date, default: null },
        withdrawn_at: { type: Date, default: null },
        expires_at: { type: Date, default: null, index: true },

        // Conversion guard: a request converts to AT MOST one real order.
        // `unique` + `sparse` makes the database itself reject a second order id.
        converted_order_id: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
        // The in-flight OrderPayment while status is payment_in_progress.
        payment_id: { type: Schema.Types.ObjectId, ref: 'OrderPayment', default: null },

        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

familyOrderRequestSchema.index({ organizer_user_id: 1, status: 1, created_at: -1 });
familyOrderRequestSchema.index({ requester_user_id: 1, created_at: -1 });
familyOrderRequestSchema.index(
    { converted_order_id: 1 },
    {
        unique: true,
        partialFilterExpression: { converted_order_id: { $type: 'objectId' } },
        name: 'one_order_per_request',
    }
);

familyOrderRequestSchema.pre('save', function () {
    // Mongoose 9 document middleware is promise-based — no `next` callback.
    this.updated_at = new Date();
});

const FamilyOrderRequest = mongoose.model('FamilyOrderRequest', familyOrderRequestSchema);

module.exports = { FamilyOrderRequest, REQUEST_STATUSES };
