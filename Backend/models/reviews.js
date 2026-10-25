const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * Review — a customer's rating of something they actually received.
 *
 * Two things can be rated, distinguished by `target_type`:
 *   `product` — one item from the order. Feeds that product's public rating.
 *   `vendor`  — the seller who shipped it: packing, speed, how they dealt with you.
 *               Feeds the store's public rating. A product can be excellent and the
 *               seller slow, so conflating the two would hide exactly the signal a
 *               marketplace needs.
 *
 * Either way the review is anchored to an ORDER, which is what makes it a verified
 * purchase: it can only exist if that customer's order was delivered, and the target has
 * to be something that order actually contained. There is no path to review a product you
 * did not buy or a seller you never bought from.
 *
 * Reviews are invisible until an admin approves them, so nothing a customer writes reaches
 * a public page unmoderated — images included, which is the half most worth checking.
 */
const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
const REVIEW_TARGETS = ['product', 'vendor'];

/** How many photos one review may carry. */
const MAX_REVIEW_IMAGES = 3;

const reviewImageSchema = new Schema(
    {
        url: { type: String, required: true, trim: true },
    },
    { _id: false }
);

const reviewSchema = new Schema(
    {
        order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },

        target_type: { type: String, enum: REVIEW_TARGETS, default: 'product', required: true, index: true },
        // Set for a product review; null for a vendor review. Not `required`, because
        // "which product?" is a question a vendor review has no answer to — the
        // `pre('validate')` hook below enforces the right one per target instead.
        product_id: { type: Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
        // The target of a vendor review, and denormalized provenance on a product review
        // so a vendor can be shown their own without re-resolving the order every time.
        vendor_id: { type: Schema.Types.ObjectId, ref: 'Seller', default: null, index: true },
        // The account that placed the order. Null is possible for legacy or
        // guest orders; the order link is the authoritative provenance.
        user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

        rating: { type: Number, required: true, min: 1, max: 5 },
        comment: { type: String, default: '', trim: true, maxlength: 1000 },
        // Customer photos. Optional, capped, and held back with the rest of the review
        // until an admin approves it.
        images: {
            type: [reviewImageSchema],
            default: [],
            validate: {
                validator: (list) => (list || []).length <= MAX_REVIEW_IMAGES,
                message: `A review may carry at most ${MAX_REVIEW_IMAGES} images`,
            },
        },

        // The ACCOUNT that wrote the review, when it was written by one. Its current name
        // is what every screen shows, read live — a customer who renames their account
        // appears under the new name on every review, old and new.
        //
        // Not `user_id`: that one is the order's owner, which on a friend or family order
        // is the payer, not the person who received the parcel and rated it.
        reviewer_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

        // The name as it was when the review was written. Shown only when there is no
        // account to read a live name from — the parcel went to someone without one.
        author_name: { type: String, default: '' },

        status: { type: String, enum: REVIEW_STATUSES, default: 'pending', index: true },
        // Moderation trail.
        reviewed_by: { type: String, default: null },
        reviewed_at: { type: Date, default: null },
        rejection_reason: { type: String, default: '' },

        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

/**
 * One review per target per order — a customer cannot stack ratings on the same purchase,
 * and a resubmitted form updates rather than duplicates.
 *
 * All four fields are in the key because the discriminator differs by target: a product
 * review is unique on its product, a vendor review on its vendor. An order that spans two
 * sellers therefore holds two vendor reviews, each with a null `product_id`, which a
 * two-field key on (order, product) would have rejected as a duplicate.
 *
 * NB: this REPLACES the older `one_review_per_order_item` index. Existing installations
 * drop it via `Backend/scripts/migrateReviewTargets.js`; a stale copy would still reject
 * the second vendor review on an order.
 */
reviewSchema.index(
    { order_id: 1, target_type: 1, product_id: 1, vendor_id: 1 },
    { unique: true, name: 'one_review_per_order_target' }
);
// The product page query: approved reviews, newest first.
reviewSchema.index({ product_id: 1, status: 1, created_at: -1 });
// The store page query: approved vendor reviews, newest first.
reviewSchema.index({ vendor_id: 1, target_type: 1, status: 1, created_at: -1 });
// The admin moderation queue.
reviewSchema.index({ status: 1, created_at: -1 });

reviewSchema.pre('validate', function (next) {
    // Each target type owns exactly one required id. Enforced here rather than with
    // `required: true` on the field, which cannot be conditional.
    if (this.target_type === 'vendor') {
        this.product_id = null;
        if (!this.vendor_id) this.invalidate('vendor_id', 'A vendor review must name the vendor it is about.');
    } else if (!this.product_id) {
        this.invalidate('product_id', 'A product review must name the product it is about.');
    }
    if (typeof next === 'function') next();
});

reviewSchema.pre('save', function () {
    this.updated_at = new Date();
});

/**
 * ReviewInvite — the single-use link sent over WhatsApp after delivery.
 *
 * Only the token HASH is stored, matching how invitation and reset tokens are
 * handled elsewhere: the raw token exists solely inside the message we send, so
 * a database leak does not hand out working review links.
 *
 * The link deliberately works WITHOUT a login. Requiring sign-in collapses
 * response rates, and the token already proves possession of a message sent to
 * the phone number on that specific order.
 */
const reviewInviteSchema = new Schema(
    {
        order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
        // One invite per PARCEL: each box arrives on its own day from its own store, and
        // is rated when it arrives. Null only on invites created for a whole order before
        // parcels were rated separately.
        sub_order_id: { type: Schema.Types.ObjectId, default: null },
        token_hash: { type: String, required: true, index: true },
        // Further live links to the same invite. The customer's "rate this parcel" button
        // issues a fresh link (only a hash is stored, so the original cannot be shown
        // again); keeping the earlier hashes here means that press never breaks the link
        // already sitting in their WhatsApp.
        extra_token_hashes: { type: [String], default: [], index: true },

        expires_at: { type: Date, required: true, index: true },
        // Stamped when the customer submits; the link stops working afterwards.
        submitted_at: { type: Date, default: null },

        sent_at: { type: Date, default: Date.now },
        // Provider campaign id, so a "no message arrived" report is traceable.
        delivery_reference: { type: String, default: null },

        created_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

reviewInviteSchema.index({ order_id: 1, sub_order_id: 1 }, { unique: true });

const Review = mongoose.model('Review', reviewSchema);
const ReviewInvite = mongoose.model('ReviewInvite', reviewInviteSchema);

module.exports = { Review, ReviewInvite, REVIEW_STATUSES, REVIEW_TARGETS, MAX_REVIEW_IMAGES };
