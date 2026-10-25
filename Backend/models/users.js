const mongoose = require("mongoose");

const { Schema } = mongoose;

/* ------------------ Address Subdocument ------------------ */
const addressSchema = new Schema(
    {
        recipient_name: { type: String, required: true },
        phone: { type: String, required: true },
        full_address: { type: String, required: true },
        // Optional friendly label (Home, Work, Parents' Home) — helps a family
        // member pick the right shared address without reading the full text.
        label: { type: String, default: '', trim: true },
        // Remembered shipping-zone selection (manual zone picker at checkout).
        shipping_country: { type: String, default: null },
        shipping_city: { type: String, default: null },
        is_default: { type: Boolean, default: false },
    },
    { _id: true } // keep ObjectId for each address
);

/* ------------------ Cart Item Subdocument ------------------ */
const cartItemSchema = new Schema(
    {
        // A cart line is either a single product (product_id) OR a bundle (bundle_id).
        product_id: {
            type: Schema.Types.ObjectId,
            ref: "Product",
            required: false,
        },
        variant_id: {
            type: Schema.Types.ObjectId,
            required: false,
        },
        // Set for bundle lines; product_id/variant_id are null in that case.
        bundle_id: {
            type: Schema.Types.ObjectId,
            ref: "Bundle",
            required: false,
        },
        quantity: { type: Number, required: true, min: 1 },
    },
    { _id: true }
);

/* ------------------ Cart Subdocument ------------------ */
const cartSchema = new Schema(
    {
        updated_at: { type: Date, default: Date.now },
        items: [cartItemSchema],
    },
    { _id: false } // cart itself doesn't need _id
);

/* ------------------ User Car Subdocument ------------------ */
const userCarSchema = new Schema(
    {
        car_brand_id: { type: Schema.Types.ObjectId, ref: "CarBrand", required: true },
        car_brand_name: { type: String, required: true },
        car_model_id: { type: Schema.Types.ObjectId, required: true },
        car_model_name: { type: String, required: true },
        year: { type: Number, required: true }
    },
    { _id: true }
);

/* ------------------ User Schema ------------------ */
const userSchema = new Schema(
    {
        name: { type: String, required: true },
        // Optional because guest checkout creates accounts from a shipping form,
        // which asks for a name, a phone, and an address — never an email. The
        // uniqueness rule lives in a partial index below rather than here: a
        // plain `unique` would index the missing value too and let the FIRST
        // emailless account block every one after it.
        // Stored — and matched in every query — in its canonical spelling (Gmail dots and
        // +aliases collapsed): see services/shared/emailIdentity.js.
        email: { type: String, required: false, default: undefined, lowercase: true, trim: true, set: (v) => require('../services/shared/emailIdentity').canonicalEmail(v) },
        phone: { type: String, required: true, unique: true, index: true, trim: true },
        profile_image: { type: String, default: null },
        // Optional for the same reason. A guest account is reached by WhatsApp
        // code, and stays passwordless unless its owner chooses to set one from
        // the order-confirmation screen.
        password: { type: String, required: false, default: null },
        password_changed_at: { type: Date, default: null },
        created_at: { type: Date, default: Date.now },

        /**
         * How much of an account this is.
         *
         * 'guest'  — created silently during checkout. The customer has proved
         *            nothing yet, so it discloses nothing: no saved addresses,
         *            no order history, no password reset. It exists to own an
         *            order and to be claimed.
         * 'active' — a normal account. Reached by registering, by signing in
         *            with Google, or by a guest confirming the WhatsApp code
         *            sent after their first order.
         *
         * The gate is `phone_verified_at`, not this field — this field is what
         * makes "which accounts are unclaimed?" a one-index question for ops.
         */
        account_status: { type: String, enum: ['guest', 'active'], default: 'active', index: true },

        // Google account (`sub`) linked to this user, set the first time they
        // sign in with Google. Deliberately has no default: the unique index is
        // sparse, and a stored null on every password account would collide.
        // A Google-created account still carries a password hash (a random one
        // nobody holds), so "forgot password" is the way to add a password.
        google_id: { type: String, unique: true, sparse: true },

        // Language used for this account's emails and in-app notifications —
        // the recipient's preference, not the sender's current browser language.
        preferred_language: { type: String, enum: ['en', 'ar'], default: 'en' },

        // ---- Contact verification ----
        // Stamped when the customer proved control of that contact method:
        // email via the registration link or an emailed code, phone via a
        // WhatsApp OTP. Which one is set depends on how they registered, so the
        // account prompts for whichever is still missing after login.
        email_verified_at: { type: Date, default: null },
        phone_verified_at: { type: Date, default: null },

        /* ---- Cash-on-delivery risk ----
         * Whether this customer may still pay at the door, and the evidence behind it.
         *
         * `override` is an admin's decision about a person and beats the statistics in both
         * directions: "allow" reopens COD for someone the rules closed, "block" closes it for
         * someone the numbers have not caught yet. Null hands them back to the rules.
         *
         * The Bosta fields are a CACHE, not a record: Bosta has no endpoint that answers
         * "what is this phone's score", so it is read off the customer's past deliveries and
         * kept here because checkout cannot wait on a third party every time the page loads.
         * `services/codEligibilityService.js` owns all of it.
         */
        cod_risk: {
            override: { type: String, enum: ["allow", "block", null], default: null },
            override_reason: { type: String, default: "" },
            override_by: { type: String, default: "" },
            override_at: { type: Date, default: null },
            bosta_ranking: { type: Number, default: null },
            bosta_delivered: { type: Number, default: null },
            bosta_returned: { type: Number, default: null },
            bosta_checked_at: { type: Date, default: null },
        },
        // A replacement contact awaiting its code. Held here rather than
        // overwriting the live field so a typo'd number can be corrected
        // without locking the customer out of the account they signed in with.
        pending_email: { type: String, default: null, lowercase: true, trim: true, set: (v) => require('../services/shared/emailIdentity').canonicalEmail(v) },
        pending_phone: { type: String, default: null, trim: true },

        addresses: [addressSchema], // embedded
        cart: cartSchema, // embedded
        cars: [userCarSchema], // embedded
        marketing_emails_unsubscribed: { type: Boolean, default: false, index: true },

        /*
         * Abandoned-cart reminder bookkeeping (services/abandonedCartService.js).
         *
         * Kept beside `cart`, not inside it: the cart is replaced whole on every sync, and the
         * record of what was already sent must outlive that.
         *
         * A "cycle" is a cart's contents plus the customer's latest order (`cycle_key`): a
         * change to either starts a new one, and each cycle gets at most one reminder.
         * Every write goes through `version` (compare-and-set), so two instances can never
         * both claim the same cycle.
         */
        abandoned_cart_reminder: {
            type: new Schema({
                version: { type: Number, default: 0 },
                sent_cycle_key: { type: String, default: null },
                sent_at: { type: Date, default: null },
                provider_message_id: { type: String, default: null },
                // An instance is sending right now, until claim_expires_at.
                claim_id: { type: String, default: null },
                claim_cycle_key: { type: String, default: null },
                claim_expires_at: { type: Date, default: null },
                // Send attempts the provider refused, for attempts_cycle_key only.
                attempts: { type: Number, default: 0 },
                attempts_cycle_key: { type: String, default: null },
                // A cycle that will get no reminder: attempts ran out, or a send's outcome is unknown.
                gave_up_cycle_key: { type: String, default: null },
                gave_up_reason: { type: String, default: null },
                last_attempt_at: { type: Date, default: null },
                last_error: { type: String, default: null },
            }, { _id: false }),
            default: undefined,
        },
    },
    {
        timestamps: false, // because you're manually using created_at
    }
);

/**
 * Email is unique among the accounts that HAVE one.
 *
 * A partial index rather than a sparse one: sparse skips only a MISSING field,
 * while `null` counts as a value and is indexed — so a sparse unique index
 * would still collide the moment a second emailless guest account was written.
 * Restricting the index to documents whose email is a string sidesteps that
 * entirely, whether the field is absent or explicitly null.
 */
userSchema.index(
    { email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);

// The daily abandoned-cart sweep: carts untouched since a cutoff.
userSchema.index({ 'cart.updated_at': 1 });

const User = mongoose.model("User", userSchema);

/**
 * Data Access: Create a new user
 */
const createUser = async (userData) => {
    return await User.create(userData);
};

/**
 * Data Access: Find user by email or phone
 */
const findUserByIdentifier = async (identifier) => {
    // We assume identifier is already formatted/lowercase if needed by the caller
    return await User.findOne({
        $or: [
            { email: identifier },
            { phone: identifier }
        ]
    });
};

/**
 * Data Access: Find user by specific fields (for validation)
 */
const findUserByFields = async (query) => {
    return await User.findOne(query);
};

/**
 * Data Access: Find a user by phone, in ANY format it could have been stored in.
 *
 * Guest checkout resolves identity from a phone number alone, so a lookup that
 * only matched the exact string typed would create a second account for a
 * customer who wrote their number with a country code this time. Matching the
 * whole variant set makes the number mean one person regardless of formatting.
 */
const findUserByPhoneVariants = async (rawPhone) => {
    const { phoneLookupVariants } = require('../services/shared/phone');
    const variants = phoneLookupVariants(rawPhone);
    if (variants.length === 0) return null;
    return await User.findOne({ phone: { $in: variants } });
};

module.exports = {
    User,
    createUser,
    findUserByIdentifier,
    findUserByFields,
    findUserByPhoneVariants
};
