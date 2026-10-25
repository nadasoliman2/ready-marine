const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * AuditLog — records sensitive/irreversible admin actions (e.g. hard deletes).
 * Intentionally append-only; nothing in the app updates or deletes these records.
 */
const auditLogSchema = new Schema(
    {
        action: { type: String, required: true, index: true }, // e.g. 'hard_delete_user', 'hard_delete_vendor'
        actor: {
            role: { type: String, default: 'admin' },
            label: { type: String, default: 'Admin' }, // admin username
        },
        target_type: {
            type: String,
            enum: [
                'user', 'vendor',
                'family', 'family_membership', 'family_invitation', 'family_order_request',
                'friendship', 'friend_invitation',
                'review',
                'loyalty_settings', 'loyalty_account',
                'wallet_account', 'site_settings',
                // Packaging catalogue and the vendor orders against it.
                'supply_product', 'supply_order',
                // Money the admin moves: a payout to a vendor, and the marketing spend
                // that shapes the profit figure it is reported against.
                'vendor_payout', 'ad_spend', 'payout_schedule',
                // An admin stopping money from reaching a vendor: one parcel's earning,
                // or every payout to the vendor. Both must say who did it and why.
                'vendor_earning', 'vendor_payout_hold',
                // A courier's cash transfer, matched by hand against the parcels it paid
                // for. Nothing else records who declared that money received.
                'courier_settlement',
                // A payment gateway's transfer into our bank, entered by hand because
                // neither provider exposes its settlements to our API keys.
                'gateway_payout',
                // Money loaded into the Paymob Payouts budget, entered by hand when Paymob
                // has not listed it yet (the listed ones are synced, and need no author).
                'payouts_topup',
                // Publishing state: a product vanishing from the shop is invisible
                // otherwise, and nothing else records who took it down.
                'product',
                // Corporate accounts: the credit we extend (cap, terms, suspension),
                // who is in a company, and the global consolidation rule.
                'company', 'company_membership', 'company_invitation', 'corporate_settings',
                // Its monthly invoice and the bank transfers recorded against it.
                'company_invoice', 'company_payment',
            ],
            required: true,
            index: true,
        },
        target_id: { type: Schema.Types.ObjectId, required: true, index: true },
        // Snapshot of the deleted account so the record stays meaningful after deletion.
        target_snapshot: { type: Schema.Types.Mixed, default: {} },
        // Counts of related records removed by the cascade.
        impact: { type: Schema.Types.Mixed, default: {} },
        created_at: { type: Date, default: Date.now, index: true },
    },
    { timestamps: false }
);

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

const recordAuditLog = async (entry) => {
    try {
        return await AuditLog.create(entry);
    } catch (err) {
        // Never let audit logging break the primary action; surface in server logs only.
        console.error('[AuditLog] failed to record entry:', err.message);
        return null;
    }
};

module.exports = { AuditLog, recordAuditLog };
