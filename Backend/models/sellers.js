const mongoose = require("mongoose");

const { Schema } = mongoose;

/* ------------------ Seller Schema ------------------ */
const sellerSchema = new Schema(
    {
        name: { type: String, required: true },

        store_name: { type: String, required: true },
        store_username: {
            type: String,
            required: true,
            unique: true,
            index: true,
            lowercase: true,
            trim: true,
        },
        // The store's clean link, /store/<store_slug> — the URL-safe twin of the username,
        // kept apart because the username is also a login identifier. Set automatically
        // (services/shared/storeSlug.js); never typed by anyone.
        store_slug: {
            type: String,
            unique: true,
            sparse: true,
            lowercase: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            index: true,
            lowercase: true,
            trim: true,
            // Canonical spelling on every write and query — services/shared/emailIdentity.js.
            set: (v) => require('../services/shared/emailIdentity').canonicalEmail(v),
        },

        phone: { type: String, required: true, unique: true, index: true, trim: true },

        locations: {
            type: [{
                address: { type: String, required: true },
                // Geographic zone of this location (matched against shipping zones).
                shipping_country: { type: String, default: null },
                shipping_city: { type: String, default: null },
                is_default: { type: Boolean, default: false },
                // Bosta pickup location ID (set by admin, from Bosta dashboard)
                bosta_location_id: { type: String, default: null }
            }],
            validate: [v => Array.isArray(v) && v.length > 0, 'Vendor must have at least one location.']
        },
        store_image: { type: String, default: null },

        password: { type: String, required: true },
        password_changed_at: { type: Date, default: null },
        status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },

        // ---- Contact verification ----
        // Stamped when the owner proved control of that contact method during
        // registration: a code to the email, or a WhatsApp code to the phone.
        // Which one is set depends on the channel they picked, so the dashboard
        // prompts for whichever is still missing after the first login.
        //
        // The store's email is where password resets, order notifications and
        // payout correspondence go, so leaving it unproven is not a small gap.
        email_verified_at: { type: Date, default: null },
        phone_verified_at: { type: Date, default: null },
        // A replacement contact awaiting its code. Held here rather than
        // overwriting the live field so a typo'd address cannot lock the owner
        // out of the store they are signed in to.
        pending_email: { type: String, default: null, lowercase: true, trim: true, set: (v) => require('../services/shared/emailIdentity').canonicalEmail(v) },
        pending_phone: { type: String, default: null, trim: true },

        // Google account (`sub`) linked to this store, stamped the first time
        // the owner signs in with Google. Stores are never *created* from a
        // Google sign-in — registration needs the store details — so this only
        // ever links an account that already exists. No default: the unique
        // index is sparse (see the same field on User).
        google_id: { type: String, unique: true, sparse: true },

        // Subscription-related fields
        subscription_id: { type: Schema.Types.ObjectId, ref: 'VendorSubscription', default: null },
        subscription_status: {
            type: String,
            enum: ['active', 'trial_active', 'not_subscribed', 'expired', 'cancelled', 'suspended'],
            default: 'not_subscribed',
            index: true,
        },

        // Subscription lifecycle metadata
        subscription_reason: { type: String, default: null },
        subscription_date: { type: Date, default: null },

        // Suspension metadata (admin manual suspension)
        suspension_reason: { type: String, default: null },
        suspension_date: { type: Date, default: null },
        suspended_by: { type: String, enum: ['admin', 'system'], default: null },

        // Commission settings
        commission_settings: {
            is_custom: { type: Boolean, default: false },
            type: { type: String, enum: ['fixed', 'category'], default: 'fixed' },
            fixed_rate: { type: Number, default: 0 },
            category_rates: [{
                category_id: { type: Schema.Types.ObjectId, ref: 'Category' },
                rate: { type: Number, default: 0 }
            }]
        },

        auto_publish_products: { type: Boolean, default: false },

        public_show_on_vendors_page: { type: Boolean, default: true, index: true },
        public_vendors_page_order: { type: Number, default: 0, index: true },
        public_show_on_home: { type: Boolean, default: false, index: true },
        public_home_order: { type: Number, default: 0, index: true },

        // Earnings wallet (cached balances; source of truth is the VendorEarning /
        // WithdrawalRequest aggregations — recomputed on every money mutation).
        wallet: {
            available_balance: { type: Number, default: 0 }, // spendable/withdrawable now
            pending_balance: { type: Number, default: 0 },   // earned but held (return window open)
            reserved_balance: { type: Number, default: 0 },  // locked by open withdrawals + unsettled supply orders
            frozen_balance: { type: Number, default: 0 },    // unpaid earnings an admin froze (not spendable, not payable)
            total_withdrawn: { type: Number, default: 0 },   // cumulative paid out to a bank account
            // Cumulative spent buying packaging and labels from the store. Separate from
            // `total_withdrawn` because it never left as cash — it was spent here.
            total_spent_on_supplies: { type: Number, default: 0 },
            last_recomputed_at: { type: Date, default: null },
        },

        /* ---- Public reputation (cached; derived, never incremented) ----
         * All three are recomputed from scratch by `vendorStatsService` at the few moments
         * that can change them. Derived rather than counted up, for the same reason a
         * product's rating is: a delivery that is later returned, a review that is approved
         * and then rejected, or a backfill after an import all converge on the right number
         * instead of drifting a little further from it each time.
         */
        // Parcels this vendor delivered that the customer kept. The trust number shown on
        // the storefront — see vendorStatsService.recomputeCompletedOrders for what counts.
        completed_orders_count: { type: Number, default: 0, index: true },
        // Average of the APPROVED reviews written about the vendor themselves (service,
        // packing, speed) — not the ratings of their products, which live on each product.
        rating: { type: Number, default: 0, min: 0, max: 5 },
        reviews_count: { type: Number, default: 0 },

        // Default payout bank details (prefill the withdrawal form).
        default_bank_details: {
            bank_name: { type: String, default: null },
            account_holder: { type: String, default: null },
            account_number: { type: String, default: null },
            iban: { type: String, default: null },
        },

        // Where Paymob sends this vendor's money. One method at a time; changing it needs the
        // account password and notifies the vendor, because it decides where money goes.
        //   vodafone | etisalat | orange | bank_wallet   -> msisdn (11-digit mobile)
        //   bank_card                                     -> bank_card_number (account/IBAN/card) + bank_code + full_name
        //   instant_bank                                  -> bank_card_number (account/IBAN) + bank_code + full_name (min 112 EGP)
        //   `type` is the form's own word for it: account | iban | card | wallet.
        payout_method: {
            type: { type: String, default: null },
            issuer: { type: String, default: null },
            msisdn: { type: String, default: null },
            bank_card_number: { type: String, default: null },
            bank_code: { type: String, default: null },
            full_name: { type: String, default: null },
            updated_at: { type: Date, default: null },
        },

        // An admin stopping every payout to this vendor. Earnings keep clearing into the
        // wallet (the vendor still sees what they have earned) but nothing can leave it —
        // no admin transfer, no vendor request — until it is lifted.
        payout_hold: {
            active: { type: Boolean, default: false },
            reason: { type: String, default: null },
            by: { type: String, default: null },
            at: { type: Date, default: null },
        },

        // Short-lived mutex held while a payout for this vendor is being assembled, so two
        // payouts started at the same moment cannot both net the same wallet deductions.
        payout_lock_until: { type: Date, default: null, select: false },

        // Payout calendar override. `enabled: false` — the default — means this vendor
        // follows `site_settings.payout_schedule`, which is the case for almost all of
        // them; the override exists for the handful who negotiate their own terms.
        //
        // The fields are deliberately nullable rather than mirroring the global defaults:
        // a null here reads through to the global value, so raising the company-wide hold
        // period still moves a vendor who only overrode their payout weekday.
        payout_schedule: {
            enabled: { type: Boolean, default: false },
            frequency: { type: String, enum: ['daily', 'weekly'], default: null }, // null reads through to the global value
            weekday: { type: Number, default: null, min: 0, max: 6 },
            interval_weeks: { type: Number, default: null, min: 1, max: 12 },
            anchor_date: { type: Date, default: null },
            hold_days: { type: Number, default: null, min: 0, max: 90 },
        },

        created_at: { type: Date, default: Date.now },
    },
    {
        timestamps: false,
    }
);

// Keep the slug in step with the username, on every write path that can change it.
sellerSchema.pre("save", async function () {
    if (this.store_slug && !this.isModified("store_username")) return;
    const { buildStoreSlug } = require("../services/shared/storeSlug");
    this.store_slug = await buildStoreSlug(this.constructor, this);
});
sellerSchema.pre("findOneAndUpdate", async function () {
    const update = this.getUpdate() || {};
    const set = update.$set || update;
    if (!Object.prototype.hasOwnProperty.call(set, "store_username")) return;
    const current = await this.model.findOne(this.getQuery()).select("_id store_name").lean();
    if (!current) return;
    const { buildStoreSlug } = require("../services/shared/storeSlug");
    set.store_slug = await buildStoreSlug(this.model, {
        _id: current._id,
        store_username: set.store_username,
        store_name: set.store_name || current.store_name,
    });
    if (update.$set) update.$set = set;
});

const Seller = mongoose.model("Seller", sellerSchema);

/**
 * Data Access: Create a new seller
 */
const createSeller = async (sellerData) => {
    return await Seller.create(sellerData);
};

/**
 * Data Access: Find seller by email, phone, or username
 */
const findSellerByIdentifier = async (identifier) => {
    return await Seller.findOne({
        $or: [
            { email: identifier },
            { store_username: identifier },
            { phone: identifier }
        ]
    });
};

/**
 * Data Access: Find seller by specific fields (for validation)
 */
const findSellerByFields = async (query) => {
    return await Seller.findOne(query);
};

/**
 * Suspend a vendor (auto or manual)
 */
const suspendVendor = async (vendorId, reason, suspendedBy = 'system') => {
    return await Seller.findByIdAndUpdate(
        vendorId,
        {
            status: 'suspended',
            suspension_reason: reason,
            suspension_date: new Date(),
            suspended_by: suspendedBy,
        },
        { returnDocument: "after" }
    ).select('-password');
};

/**
 * Reactivate a vendor (clear suspension)
 */
const reactivateVendor = async (vendorId) => {
    return await Seller.findByIdAndUpdate(
        vendorId,
        {
            status: 'active',
            suspension_reason: null,
            suspension_date: null,
            suspended_by: null,
        },
        { returnDocument: "after" }
    ).select('-password');
};

/**
 * Get all vendors for admin with filtering and pagination.
 */
const getAllVendorsAdmin = async ({ subscription_status, status, q, page = 1, limit = 20 } = {}) => {
    const filter = {};

    if (subscription_status) {
        if (Array.isArray(subscription_status)) {
            filter.subscription_status = { $in: subscription_status };
        } else {
            filter.subscription_status = subscription_status;
        }
    }

    if (status) filter.status = status;

    if (q && q.trim()) {
        filter.$or = [
            { store_name: { $regex: q.trim(), $options: 'i' } },
            { store_username: { $regex: q.trim(), $options: 'i' } },
            { email: { $regex: q.trim(), $options: 'i' } },
            { name: { $regex: q.trim(), $options: 'i' } },
        ];
    }

    const total = await Seller.countDocuments(filter);
    const vendors = await Seller.find(filter)
        .select('-password')
        .sort({ created_at: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Number(limit))
        .lean();

    return {
        vendors,
        pagination: {
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit)),
            limit: Number(limit),
        },
    };
};

module.exports = {
    Seller,
    createSeller,
    findSellerByIdentifier,
    findSellerByFields,
    suspendVendor,
    reactivateVendor,
    getAllVendorsAdmin,
};
