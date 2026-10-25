const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * What a company owes ReadyCar, line by line — feature 14, phase 2.
 *
 * Two collections, for two different questions:
 *
 *   CompanyLedgerEntry    the history. One row per charge (an order placed on the
 *                         company account) and per credit (a parcel cancelled or
 *                         returned). Append-only: a mistake is corrected by a
 *                         counter-entry, never by editing a row, so the monthly
 *                         statement can always be rebuilt from it.
 *
 *   CompanySpendCounter   the running totals the limits are enforced against:
 *                         one row per (company, month) and one per (company,
 *                         month, employee). Moved with conditional atomic
 *                         increments, so two orders placed at the same instant
 *                         cannot both squeeze under the same remaining limit.
 *                         Money held for a card payment still in progress is
 *                         counted here too — it is committed, just not settled.
 *
 * Amounts are EGP with two decimals, the same unit as `Order.total_price`.
 */

const companyLedgerEntrySchema = new Schema(
    {
        company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        billing_mode: { type: String, enum: ['monthly', 'wallet', 'credit_wallet'], default: 'monthly', index: true },
        // The calendar month (store time zone) the ORDER belongs to. A credit for
        // an order carries the order's month, not the month it was refunded in.
        month: { type: String, required: true, index: true },
        // Who placed the order: the employee, or the manager ordering for a car.
        user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        beneficiary: { type: String, enum: ['employee', 'car'], required: true },
        car_id: { type: Schema.Types.ObjectId, default: null },
        car_label: { type: String, default: '' },

        order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
        order_reference: { type: String, default: '' },
        sub_order_id: { type: Schema.Types.ObjectId, default: null },
        refund_id: { type: Schema.Types.ObjectId, ref: 'Refund', default: null },
        // Consolidation (phase 3): shipping given back when a batch closed, or a
        // shipping difference the company absorbed when an order left a closed batch.
        batch_id: { type: Schema.Types.ObjectId, ref: 'CompanyBatch', default: null },
        // Phase 4: set when the event belongs to a month whose invoice was already issued.
        // The entry is then booked on the next open month (`month`) — an adjustment on the
        // next invoice, never an edit of one already sent — and this remembers the order's
        // own month.
        for_month: { type: String, default: null },
        // An order is invoiced in the month it is COMPLETED, not the month it was placed.
        // When a month is invoiced while the order is still on its way, its rows move to
        // the next month (`month`) and this keeps the month they were first booked on —
        // the month the purchase belongs to in the purchases and statistics screens.
        deferred_from: { type: String, default: null },

        kind: { type: String, enum: ['charge', 'credit'], required: true },
        // Signed: a charge is positive, a credit negative. The month's balance is
        // simply the sum.
        amount: { type: Number, required: true },
        // The employee's own money on the same event: what they paid on top of the
        // company's share (a charge), or what went back to them (a credit).
        personal_amount: { type: Number, default: 0 },

        reason: { type: String, default: '' },
        // Makes every write safe to retry: the same event can never be booked twice.
        idempotency_key: { type: String, required: true, unique: true },
        actor: {
            role: { type: String, default: 'system' },
            label: { type: String, default: '' },
        },
        created_at: { type: Date, default: Date.now, index: true },
    },
    { timestamps: false }
);

companyLedgerEntrySchema.index({ company_id: 1, month: 1, created_at: -1 });

const companySpendCounterSchema = new Schema(
    {
        company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
        month: { type: String, required: true },
        // 'company' — everything on the account this month (employees + cars).
        // 'user'    — one employee's own spend, which is what their limit caps.
        scope: { type: String, enum: ['company', 'user'], required: true },
        user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        amount: { type: Number, default: 0 },
        // Cap alerts already sent this month (company scope), e.g. "warn@50000", "full@50000".
        cap_alerts: { type: [String], default: undefined },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

companySpendCounterSchema.index(
    { company_id: 1, month: 1, scope: 1, user_id: 1 },
    { unique: true, name: 'one_counter_per_scope' }
);

const CompanyLedgerEntry = mongoose.model('CompanyLedgerEntry', companyLedgerEntrySchema);
const CompanySpendCounter = mongoose.model('CompanySpendCounter', companySpendCounterSchema);

module.exports = { CompanyLedgerEntry, CompanySpendCounter };
