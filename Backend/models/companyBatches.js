const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * A consolidation batch — feature 14, phase 3.
 *
 * Orders placed on a company account in "consolidate to office" mode do not go
 * to the vendor at once. Each of their parcels (sub-orders) waits in the batch
 * for its (company office × vendor × pickup branch), and the batch closes — and
 * ships as ONE parcel — as soon as either:
 *   - it holds `target_count` orders, or
 *   - `deadline_at` passes (it then ships with whatever it holds, even one).
 *
 * Both limits are snapshotted when the batch opens: the time told to the people
 * in it is a promise, so later changes to the settings, or the first person
 * leaving, never move it.
 *
 * Each member keeps its own order, items and money; the batch only decides how
 * the one parcel's shipping is split between them. Physically it is one parcel:
 * at close one member becomes the `lead`, whose courier delivery carries the
 * whole box, and the others ride with it.
 */

const memberSchema = new Schema(
    {
        order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
        sub_order_id: { type: Schema.Types.ObjectId, required: true },
        user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        // Shown to the vendor on the packing labels, and in the company's ledger.
        display_name: { type: String, default: '' },
        order_reference: { type: String, default: '' },
        beneficiary: { type: String, enum: ['employee', 'car'], default: 'employee' },
        joined_at: { type: Date, default: Date.now },
        // waiting  — in the batch, the vendor has not seen it yet
        // left     — cancelled, or sent on alone ("ship it now"), before the batch closed
        // released — the batch closed and this parcel went to the vendor with it
        status: { type: String, enum: ['waiting', 'left', 'released'], default: 'waiting' },
        left_reason: { type: String, enum: ['cancelled', 'ship_now', null], default: null },
        left_at: { type: Date, default: null },
        // What this parcel's shipping would have been alone — the amount held at checkout.
        standalone_shipping: { type: Number, default: 0 },
        // Its part of the consolidated parcel's shipping, set at close.
        share: { type: Number, default: null },
        // standalone_shipping − share: returned to the person when the batch closed.
        savings: { type: Number, default: 0 },
        released_at: { type: Date, default: null },
        // Released with the batch, then cancelled before the parcel shipped (for
        // example the vendor had run out). The others keep their share; the company
        // absorbs the difference — see `company_absorbed`.
        dropped_at: { type: Date, default: null },
    },
    { _id: false }
);

const companyBatchSchema = new Schema(
    {
        company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        office_id: { type: Schema.Types.ObjectId, required: true },
        office_name: { type: String, default: '' },
        vendor_id: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
        // The vendor branch the parcel is collected from — one parcel, one pickup.
        fulfillment_location: { type: String, default: '' },

        // open → closing → closed. `closing` is a short claim so two closers
        // (the order that fills it, and the timer) never both process it.
        // `cancelled`: everyone left before it closed.
        status: { type: String, enum: ['open', 'closing', 'closed', 'cancelled'], default: 'open', index: true },

        // Snapshots taken when the batch opened — see the note above.
        target_count: { type: Number, required: true, min: 2 },
        wait_hours: { type: Number, required: true, min: 1 },
        opened_at: { type: Date, default: Date.now },
        deadline_at: { type: Date, required: true, index: true },

        // Members still waiting. Kept as a counter so joining can be a single
        // conditional update: nobody joins a batch that is already full.
        waiting_count: { type: Number, default: 0 },
        members: { type: [memberSchema], default: [] },

        closing_started_at: { type: Date, default: null },
        closed_at: { type: Date, default: null },
        // count: it filled · time: its wait ran out · admin: the website team closed it early
        close_reason: { type: String, enum: ['count', 'time', 'admin', null], default: null },

        // The consolidated parcel's shipping, priced at close, and how it was split.
        parcel_shipping: { type: Number, default: null },
        split_mode: { type: String, enum: ['equal', 'proportional', 'single', 'separate', null], default: null },
        // Money the company absorbed because a member dropped out after the close
        // and the others' share of the parcel went up (never charged to them).
        company_absorbed: { type: Number, default: 0 },

        // The member whose courier delivery carries the whole parcel.
        lead: {
            order_id: { type: Schema.Types.ObjectId, default: null },
            sub_order_id: { type: Schema.Types.ObjectId, default: null },
        },
        // When the lead's courier delivery was created, and when the parcel reached an
        // end (delivered / returned / cancelled) and its riders were settled with it.
        dispatched_at: { type: Date, default: null },
        finished_at: { type: Date, default: null },

        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

// At most one OPEN batch per destination and pickup: a second opener is refused
// by the index and joins the existing one instead.
companyBatchSchema.index(
    { company_id: 1, office_id: 1, vendor_id: 1, fulfillment_location: 1 },
    { unique: true, partialFilterExpression: { status: 'open' }, name: 'one_open_batch_per_route' }
);
companyBatchSchema.index({ 'members.sub_order_id': 1 });
companyBatchSchema.index({ status: 1, deadline_at: 1 });
companyBatchSchema.index({ status: 1, finished_at: 1, dispatched_at: 1 });

companyBatchSchema.pre('save', function () {
    this.updated_at = new Date();
});

const CompanyBatch = mongoose.model('CompanyBatch', companyBatchSchema);

module.exports = { CompanyBatch };
