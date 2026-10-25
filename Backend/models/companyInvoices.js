const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * A company's monthly invoice, and the transfers paid against it — feature 14, phase 4.
 *
 * The invoice is a statement of account ("كشف حساب / مطالبة"), not an e-invoice. It is
 * issued once per (company, month) on the 1st of the next month, for every order placed
 * in the month. Its lines are a snapshot of the month's ledger at that moment; anything
 * that happens to the month's orders afterwards (a return, a cancellation, a batch
 * saving) is booked on the next open month and shows up on the next invoice — an issued
 * invoice is never edited. Ending the contract issues the open months at once.
 *
 * `amount_due` never goes below zero. A month whose credits outweigh its charges carries
 * the difference to the next month as a credit line — or, once the contract has ended,
 * is set against unpaid invoices and the rest refunded.
 */

const invoiceLineSchema = new Schema(
    {
        // order        — an employee's order: the company's final share of it this month
        // car_order    — the same, for a manager's order for a company car
        // late_credit  — a return/cancellation of an order from an earlier, invoiced month
        // late_charge  — a charge on an order from an earlier, invoiced month
        // late_savings — shipping saved by a batch that closed after its orders were invoiced
        // shipping_difference — what the company absorbed when an order left a closed batch
        // carried_credit      — the previous invoice's balance in the company's favour
        // wallet_balance      — what was in the wallet of a company that used to pay from
        //                       one: its balance off the invoice, or what it owed added to it
        kind: {
            type: String,
            enum: ['order', 'car_order', 'late_credit', 'late_charge', 'late_savings', 'shipping_difference', 'carried_credit', 'wallet_balance'],
            required: true,
        },
        // Order lines only: how `amount` was reached — the share charged when the order was
        // placed, minus shipping the consolidation batch gave back, minus anything returned
        // or cancelled before the invoice.
        charged: { type: Number, default: 0 },
        saved: { type: Number, default: 0 },
        returned: { type: Number, default: 0 },
        order_id: { type: Schema.Types.ObjectId, default: null },
        order_reference: { type: String, default: '' },
        user_id: { type: Schema.Types.ObjectId, default: null },
        name: { type: String, default: '' },
        car_label: { type: String, default: '' },
        date: { type: Date, default: null },
        // Signed, like the ledger: a charge is positive, a credit negative.
        amount: { type: Number, required: true },
        personal_amount: { type: Number, default: 0 },
        reason: { type: String, default: '' },
        for_month: { type: String, default: null },
    },
    { _id: false }
);

const companyInvoiceSchema = new Schema(
    {
        company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        month: { type: String, required: true },
        number: { type: String, required: true, unique: true },

        // Snapshot of who is being billed, as it stood when the invoice was issued.
        company_snapshot: {
            name: { type: String, default: '' },
            // company | authority | school | property — the words the invoice is printed in.
            org_type: { type: String, default: 'company' },
            commercial_registration: { type: String, default: '' },
            tax_card: { type: String, default: '' },
            address: { type: String, default: '' },
        },
        // And where to pay, as printed on it.
        bank_details: { type: Schema.Types.Mixed, default: null },

        issued_at: { type: Date, required: true },
        payment_terms_days: { type: Number, required: true },
        due_at: { type: Date, required: true, index: true },

        lines: { type: [invoiceLineSchema], default: [] },
        totals: {
            // Σ the month's order lines (the company's final share of each order).
            orders: { type: Number, default: 0 },
            // Σ late lines: returns and charges on orders of earlier, invoiced months.
            adjustments: { type: Number, default: 0 },
            shipping_differences: { type: Number, default: 0 },
            carried_credit: { type: Number, default: 0 },
            wallet_balance: { type: Number, default: 0 },
            // Σ lines. Can be negative; then nothing is due and it carries to next month.
            total: { type: Number, default: 0 },
            // For information: what consolidation saved on this month's shipping, and what
            // employees paid on top of the company's share.
            shipping_savings: { type: Number, default: 0 },
            employee_paid: { type: Number, default: 0 },
            order_count: { type: Number, default: 0 },
        },
        amount_due: { type: Number, required: true, min: 0 },
        amount_paid: { type: Number, default: 0 },
        // issued → partially_paid → paid. Overdue is a fact about time, derived on read.
        status: { type: String, enum: ['issued', 'partially_paid', 'paid'], default: 'issued', index: true },
        paid_at: { type: Date, default: null },
        // A total below zero is carried, as a `carried_credit` line, to whichever invoice
        // is issued next for this company; this records which month's invoice took it.
        // 'settlement': the contract had ended, so it went against unpaid invoices / a refund.
        // 'wallet': the company pays from a wallet now, so the credit went into it.
        carried_to_month: { type: String, default: null },
        // 'final': issued at once when the contract ended. 'after_end': a later statement of
        // what reached the ledger after that (returns, batch savings).
        contract_stage: { type: String, enum: ['final', 'after_end', null], default: null },

        // When the lines were taken from the ledger, and exactly which ledger rows they
        // include. A row written for this month that is not in the list reached the ledger
        // after the snapshot, and is moved to the next month (companyInvoiceService).
        snapshot_at: { type: Date, default: null },
        ledger_entry_ids: { type: [Schema.Types.ObjectId], default: [], select: false },

        notices: {
            issued_sent_at: { type: Date, default: null },
            reminder_sent_at: { type: Date, default: null },
            due_sent_at: { type: Date, default: null },
            overdue_sent_at: { type: Date, default: null },
        },

        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

// One invoice per company per month — also what stops two issuers racing.
companyInvoiceSchema.index({ company_id: 1, month: 1 }, { unique: true });

companyInvoiceSchema.pre('save', function () {
    this.updated_at = new Date();
});

/**
 * A bank transfer against an invoice. The admin records one directly (confirmed at once),
 * or the company uploads its receipt (pending) and the admin confirms or rejects it.
 * Only confirmed payments count against the invoice.
 */
const companyPaymentSchema = new Schema(
    {
        company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        invoice_id: { type: Schema.Types.ObjectId, ref: 'CompanyInvoice', required: true, index: true },
        amount: { type: Number, required: true, min: 0.01 },
        paid_on: { type: Date, required: true },
        reference: { type: String, default: '' },
        note: { type: String, default: '' },
        // 'credit': not money that moved — the company's own credit (returns, savings after
        // the contract ended) set against this invoice.
        kind: { type: String, enum: ['transfer', 'credit'], default: 'transfer' },
        // Stored outside the public uploads path; served only to the company and the admin.
        receipt: {
            file: { type: String, default: '' },
            original_name: { type: String, default: '' },
            mime: { type: String, default: '' },
        },
        status: { type: String, enum: ['pending', 'confirmed', 'rejected'], default: 'pending', index: true },
        submitted_by: {
            kind: { type: String, enum: ['manager', 'admin'], required: true },
            user_id: { type: Schema.Types.ObjectId, default: null },
            label: { type: String, default: '' },
        },
        confirmed_by: { type: String, default: '' },
        confirmed_at: { type: Date, default: null },
        rejected_reason: { type: String, default: '' },
        rejected_at: { type: Date, default: null },
        created_at: { type: Date, default: Date.now, index: true },
    },
    { timestamps: false }
);

const CompanyInvoice = mongoose.model('CompanyInvoice', companyInvoiceSchema);
const CompanyPayment = mongoose.model('CompanyPayment', companyPaymentSchema);

module.exports = { CompanyInvoice, CompanyPayment };
