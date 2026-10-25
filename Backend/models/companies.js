const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * Corporate accounts — see feature-planner/14-corporate-accounts.md.
 *
 * A Company is created by the admin only. People reach it through a
 * CompanyMembership, which is always attached to an ordinary customer `User`:
 * a manager and an employee are the same kind of account, told apart by two
 * flags on their membership. That is what lets one person be both at once,
 * with one login.
 *
 * Offices, groups and company cars are embedded: a company has tens of each at
 * most, they are always read together with the company, and embedding makes
 * "is this group id one of ours?" a lookup on a document we already hold.
 */

/* ------------------ Company ------------------ */

const officeSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        // The same fields a customer address carries, so an office can be handed
        // to checkout and to the shipping engine exactly like one.
        recipient_name: { type: String, required: true, trim: true },
        phone: { type: String, required: true, trim: true },
        full_address: { type: String, required: true, trim: true },
        shipping_country: { type: String, default: null },
        shipping_city: { type: String, default: null },
        active: { type: Boolean, default: true },
        created_at: { type: Date, default: Date.now },
    },
    { _id: true }
);

const groupSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        // Monthly limit in EGP, shipping included.
        limit: { type: Number, required: true, min: 0 },
        created_at: { type: Date, default: Date.now },
    },
    { _id: true }
);

const carSchema = new Schema(
    {
        // Picked from the site's make/model list, like a car in a customer's garage, so
        // the shop can show the parts that fit it. `make` and `model` keep the names.
        car_brand_id: { type: Schema.Types.ObjectId, ref: 'CarBrand', default: null },
        car_model_id: { type: Schema.Types.ObjectId, default: null },
        make: { type: String, required: true, trim: true },
        model: { type: String, default: '', trim: true },
        year: { type: Number, default: null },
        // Stored upper-cased and space-collapsed, so "abc 123" and "ABC  123" are the same car.
        plate: { type: String, required: true, trim: true },
        active: { type: Boolean, default: true },
        created_at: { type: Date, default: Date.now },
    },
    { _id: true }
);

const companySchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        // What kind of organisation this is — only the words on screen change with it
        // (a property has residents and buildings, not employees and branches).
        // See services/shared/orgTerms.js.
        org_type: { type: String, enum: ['company', 'authority', 'school', 'property'], default: 'company' },
        commercial_registration: { type: String, default: '', trim: true },
        tax_card: { type: String, default: '', trim: true },
        // The account's logo, uploaded by its manager (/uploads/company-logos/…), and
        // whether it may appear on ReadyCar's home page among its corporate clients. The
        // manager decides; the admin can turn it off.
        logo: { type: String, default: null },
        show_logo_on_homepage: { type: Boolean, default: true },

        // 'ended': the contract is over for good — no new orders, the employees are
        // released, and the managers keep the portal to see and pay the final invoices.
        status: { type: String, enum: ['active', 'suspended', 'ended'], default: 'active', index: true },
        // Why it is suspended. 'overdue' lifts itself once the overdue invoices are
        // paid; 'manual' waits for an admin.
        suspension: {
            reason: { type: String, enum: ['manual', 'overdue', null], default: null },
            note: { type: String, default: '' },
            at: { type: Date, default: null },
            by: { type: String, default: '' },
        },
        // Phase 4: the admin resumed a company paused for a late invoice. Until this date
        // the automatic pause leaves it alone (they agreed more time with the company).
        overdue_waiver_until: { type: Date, default: null },

        /* ---- Set by the admin (the credit ReadyCar extends) ---- */
        // The most the whole company may spend in a calendar month, employees and
        // company cars together, amounts held in waiting batches included.
        monthly_cap: { type: Number, required: true, min: 0 },
        // How the company pays (see companyWalletService):
        //   monthly        on a monthly invoice, up to `monthly_cap` a month.
        //   wallet         prepaid wallet: tops up, then spends what is there.
        //   credit_wallet  wallet with a credit line: spends down to `monthly_cap` below
        //                  zero, tops up to pay it back. No invoices, no due date.
        billing_mode: { type: String, enum: ['monthly', 'wallet', 'credit_wallet'], default: 'monthly', index: true },
        // Below zero on a credit wallet whenever it is using its line. On a prepaid one,
        // only when a charge the company cannot refuse (the shipping difference when an
        // order leaves a closed batch) outran the balance: the company owes it, the next
        // top-up pays it off first, and no order fits until the balance is positive.
        wallet_balance_minor: { type: Number, default: 0 },
        wallet_version: { type: Number, default: 0 },
        // Written atomically with the balance, then copied to the immutable journal.
        // A process restart can finish this entry without charging/crediting again.
        wallet_pending_entry: { type: Schema.Types.Mixed, default: null },
        wallet_budget_lock: { type: Schema.Types.Mixed, default: null },
        payment_terms_days: { type: Number, default: 15, min: 0 },
        overdue_grace_days: { type: Number, default: 7, min: 0 },

        /* ---- The end of the contract ---- */
        contract_end: {
            at: { type: Date, default: null },
            by: { type: String, default: '' },
            note: { type: String, default: '' },
        },
        // After the end, credit left over once the company's unpaid invoices are covered
        // is money ReadyCar owes it. `refund_owed` is the total ever owed; the transfers
        // the admin sent are in `refunds`, so what is still due is the difference.
        refund_owed: { type: Number, default: 0, min: 0 },
        refunds: [{
            amount: { type: Number, required: true, min: 0.01 },
            paid_on: { type: Date, required: true },
            reference: { type: String, default: '' },
            note: { type: String, default: '' },
            recorded_by: { type: String, default: '' },
            created_at: { type: Date, default: Date.now },
        }],
        // Overrides the global consolidation rule for this company only. Null
        // fields fall back to CorporateSettings.
        consolidation_override: {
            enabled: { type: Boolean, default: false },
            order_count: { type: Number, default: null, min: 2 },
            wait_hours: { type: Number, default: null, min: 1 },
        },

        /* ---- Set by the company's managers ---- */
        // Monthly limit for an employee in no group and with no personal override.
        default_limit: { type: Number, default: 0, min: 0 },
        // Off: no employee has a limit of their own (default, group or personal); anyone may
        // order on the company account until the company's own monthly cap / wallet is used.
        employee_limits_enabled: { type: Boolean, default: true },
        modes: {
            consolidate: { type: Boolean, default: true },
            instant: { type: Boolean, default: true },
        },

        offices: [officeSchema],
        groups: [groupSchema],
        cars: [carSchema],

        // The first-sign-in checklist. Each step is stamped the first time the
        // manager completes it; adding employees is read from the data instead.
        setup: {
            office_confirmed_at: { type: Date, default: null },
            default_limit_set_at: { type: Date, default: null },
            modes_confirmed_at: { type: Date, default: null },
        },

        created_by: { type: String, default: '' },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

companySchema.pre('save', function () {
    // Mongoose 9 document middleware is promise-based — no `next` callback.
    this.updated_at = new Date();
});

/* ------------------ Membership ------------------ */

const companyMembershipSchema = new Schema(
    {
        company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

        // A manager runs the company portal and orders for company cars. An
        // employee has a limit. One person may be both.
        is_manager: { type: Boolean, default: false },
        is_employee: { type: Boolean, default: false },

        // Employee placement. Both ids point into the company's embedded arrays.
        group_id: { type: Schema.Types.ObjectId, default: null },
        office_id: { type: Schema.Types.ObjectId, default: null },
        // A personal monthly limit that beats the group's and the default. Null
        // means "no override"; zero is a real value (the employee may not order).
        limit_override: { type: Number, default: null, min: 0 },

        status: { type: String, enum: ['active', 'left', 'removed'], default: 'active', index: true },
        // The manager paused this employee (they left the job, for instance): they may not
        // order on the company account until reactivated. Reversible — their history, group
        // and limit stay, and no new invitation is needed. A manager role is not affected.
        deactivated_at: { type: Date, default: null },
        deactivated_by: { type: String, default: '' },
        joined_at: { type: Date, default: Date.now },
        ended_at: { type: Date, default: null },
        ended_by: { type: String, default: '' },
    },
    { timestamps: false }
);

// A person may belong to several companies, but to each only once at a time.
// Historical (left/removed) rows do not block a later join.
companyMembershipSchema.index(
    { company_id: 1, user_id: 1 },
    { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_membership_per_company' }
);
companyMembershipSchema.index({ company_id: 1, status: 1 });

/* ------------------ Invitation ------------------ */

const companyInvitationSchema = new Schema(
    {
        company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        role: { type: String, enum: ['employee', 'manager'], required: true },

        // The name the company typed (or the Excel row carried). Shown in the
        // employees table until the person accepts; never written onto an
        // existing account.
        name: { type: String, default: '', trim: true },

        // Exactly one of these identifies the invitee, normalized the way auth
        // normalizes it. A phone invitation goes out over WhatsApp and is answered
        // with a code; an email invitation is answered by signing in with that address.
        email: { type: String, default: null, lowercase: true, trim: true },
        phone: { type: String, default: null, trim: true },
        channel: { type: String, enum: ['email', 'whatsapp'], default: 'email' },
        invited_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        created_invited_account: { type: Boolean, default: false },
        delivery_reference: { type: String, default: null },

        // Where the employee lands once they accept.
        group_id: { type: Schema.Types.ObjectId, default: null },
        office_id: { type: Schema.Types.ObjectId, default: null },

        // Only the sha256 hash of the single-use token is persisted.
        token_hash: { type: String, required: true, index: true },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'declined', 'expired', 'revoked'],
            default: 'pending',
            index: true,
        },
        expires_at: { type: Date, required: true, index: true },
        accepted_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },

        invited_by: {
            kind: { type: String, enum: ['admin', 'manager'], required: true },
            user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            label: { type: String, default: '' },
        },

        last_sent_at: { type: Date, default: Date.now },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

companyInvitationSchema.index({ company_id: 1, email: 1, status: 1 });
companyInvitationSchema.index({ company_id: 1, phone: 1, status: 1 });

companyInvitationSchema.pre('save', function () {
    this.updated_at = new Date();
});

/* ------------------ Global settings (singleton) ------------------ */

/**
 * Admin-wide knobs. Internal — never shipped to the public settings endpoint.
 * A company's own `consolidation_override` beats the batch rule here.
 */
const corporateSettingsSchema = new Schema(
    {
        // A consolidation batch closes when it holds this many orders...
        batch_order_count: { type: Number, default: 3, min: 2 },
        // ...or this many hours after its first order, whichever comes first.
        batch_wait_hours: { type: Number, default: 48, min: 1 },
        // Defaults stamped on a NEW company; each company keeps its own copy.
        default_payment_terms_days: { type: Number, default: 15, min: 0 },
        default_overdue_grace_days: { type: Number, default: 7, min: 0 },
        // Invoices (phase 4): the first reminder goes this many days before the due date.
        invoice_reminder_days: { type: Number, default: 3, min: 0 },
        // Printed on every invoice: where the company transfers the money.
        bank_details: {
            bank_name: { type: String, default: '' },
            account_name: { type: String, default: '' },
            account_number: { type: String, default: '' },
            iban: { type: String, default: '' },
            instructions: { type: String, default: '' },
        },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

const Company = mongoose.model('Company', companySchema);
const CompanyMembership = mongoose.model('CompanyMembership', companyMembershipSchema);
const CompanyInvitation = mongoose.model('CompanyInvitation', companyInvitationSchema);
const CorporateSettings = mongoose.model('CorporateSettings', corporateSettingsSchema);

module.exports = {
    Company,
    CompanyMembership,
    CompanyInvitation,
    CorporateSettings,
};
