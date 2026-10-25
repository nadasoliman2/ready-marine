const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema({
    currency: { type: String, default: '' },
    header_phone: { type: String, default: '' },
    footer_phones: { type: [String], default: [] },
    footer_emails: { type: [String], default: [] },
    contact_email: { type: String, default: '' },
    contact_telephone: { type: String, default: '' },
    contact_address: { type: String, default: '' },
    header_text_en: { type: String, default: '' },
    header_text_ar: { type: String, default: '' },
    footer_text_en: { type: String, default: '' },
    footer_text_ar: { type: String, default: '' },
    locations_en: { type: [String], default: [] },
    locations_ar: { type: [String], default: [] },

    logo_url: { type: String, default: '' },
    logo_light_url: { type: String, default: '' },
    favicon_url: { type: String, default: '' },
    social_links: {
        facebook: { type: String, default: '' },
        instagram: { type: String, default: '' },
        twitter: { type: String, default: '' },
        youtube: { type: String, default: '' },
        linkedin: { type: String, default: '' },
        tiktok: { type: String, default: '' },
        whatsapp: { type: String, default: '' },
    },
    // When true, vendor bundles require admin approval before publishing (mirrors
    // product approval). When false, vendors publish bundles directly (members
    // must already be published). Toggled by admin.
    bundle_approval_required: { type: Boolean, default: true },
    commission_settings: {
        type: { type: String, enum: ['fixed', 'category'], default: 'fixed' },
        fixed_rate: { type: Number, default: 0 },
        category_rates: [{
            category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
            rate: { type: Number, default: 0 }
        }]
    },

    // ---- Vendor payout calendar ----
    // When we actually hand vendors their cleared money. The 14-day hold in
    // `vendorEarningsService` decides when an earning BECOMES payable; this decides which
    // day it is paid on, and the two are separate because an earning clearing on a Tuesday
    // should not mean a bank transfer on a Tuesday.
    //
    // The phase is `anchor_date`, not "the first Monday of the month": a fortnightly cycle
    // has no month-boundary answer — some months hold three Mondays of the cycle and some
    // two — so the cadence counts weeks from a date the admin picked, and every payout date
    // is anchor + k × interval_weeks. A vendor may override the whole block; see
    // `sellers.payout_schedule`.
    payout_schedule: {
        enabled: { type: Boolean, default: true },
        // "daily": every settled parcel is due the day its settlement period ends — the
        // admin's daily transfer list. "weekly": batched onto `weekday` every
        // `interval_weeks`. A document saved before this field existed reads as daily.
        frequency: { type: String, enum: ['daily', 'weekly'], default: 'daily' },
        // 0 = Sunday … 6 = Saturday, matching Date.prototype.getDay().
        weekday: { type: Number, default: 1, min: 0, max: 6 },
        // 1 = every week, 2 = every other week, and so on.
        interval_weeks: { type: Number, default: 1, min: 1, max: 12 },
        // Any date on the cycle. Its weekday does not matter — the first `weekday` on or
        // after it is the first payout, and the rest follow from the interval.
        anchor_date: { type: Date, default: null },
        // The settlement period: how long after delivery an earning is held before it can
        // be paid. Applied when the earning is created, and never shorter than the customer
        // return window (RETURN_WINDOW_DAYS) — money must not leave for goods that can still
        // come back. Changing it does NOT re-date earnings already recorded — each one
        // carries its own `clearable_at`, frozen at delivery.
        hold_days: { type: Number, default: 14, min: 0, max: 90 },
    },

    // ---- Customer loyalty program ----
    // `earning_enabled` and `redemption_enabled` are deliberately separate:
    // switching the program off must never strand a balance customers already
    // hold, so earning can stop while spending stays open (or the reverse).
    // `activated_at` is the cut-off for participation — orders created before
    // it never earn, which is what "no retroactive points" means in practice.
    loyalty: {
        enabled: { type: Boolean, default: false },
        earning_enabled: { type: Boolean, default: true },
        redemption_enabled: { type: Boolean, default: true },
        activated_at: { type: Date, default: null },
        spend_per_point: { type: Number, default: 25 },     // EGP of eligible spend per 1 point
        point_value: { type: Number, default: 0.5 },        // EGP discount per 1 point
        min_redeem_points: { type: Number, default: 1 },
        max_redemption_percent: { type: Number, default: 50 }, // % of eligible merchandise
        allow_with_coupons: { type: Boolean, default: true },
        // Null means "points never expire" — the confirmed MVP behavior.
        points_expiry_days: { type: Number, default: null },
    },

    // ---- Customer wallet (store credit) ----
    // `enabled` is the kill switch for wallet CHECKOUT: off, and the store
    // falls back to charging the gateway directly at checkout. It deliberately
    // does not disable refunds into the wallet — money already owed to a
    // customer must still land somewhere — nor does it hide a balance somebody
    // already holds.
    //
    // `topup_enabled` is separate so money can be stopped from coming IN
    // (a provider outage, an investigation) while existing credit stays
    // spendable. `cod_enabled` keeps cash on delivery independent of all of it.
    wallet: {
        enabled: { type: Boolean, default: false },
        topup_enabled: { type: Boolean, default: true },
        cod_enabled: { type: Boolean, default: true },
        // Keeps the gateway on the checkout screen alongside the wallet, so
        // the wallet adds a way to pay rather than replacing one. Separate
        // from `enabled` on purpose: stepping back to wallet-only must not
        // require switching the wallet off and stranding customer balances.
        online_payment_enabled: { type: Boolean, default: true },
        // Suggested amounts only. The customer can always type their own, and
        // the shortfall top-up at checkout ignores these entirely.
        topup_suggestions: { type: [Number], default: [100, 250, 500, 1000] },
        activated_at: { type: Date, default: null },
    },

    // Read ONLY when a payment is being created. Every later step — the
    // redirect confirmation, the webhook, the sweeps — reads the provider
    // stored on the payment record instead, so flipping this switch can never
    // orphan a customer who is mid-payment on the other provider.
    //
    // `paymob_pilot_user_ids` is the rehearsal mechanism: those accounts are
    // routed to Paymob while `provider` still says fawaterak, which is how
    // Paymob gets exercised on the live server without a customer noticing.
    // Meant to be emptied once the switch itself is flipped.
    //
    // The API keys are NOT here. They live in the root `.env` alongside
    // Fawaterak's, so a settings document can never leak a live secret key.
    // ---- Who is allowed to pay cash on delivery ----
    // COD is the only payment method where the customer can change their mind at the door
    // and leave us paying for the trip both ways. This is the gate: a customer who keeps
    // refusing parcels stops being offered it, and the thresholds are numbers rather than
    // code so they can be tuned against what actually happens.
    //
    // TWO INDEPENDENT TESTS, BOTH OF WHICH MUST PASS when there is data for them:
    //   ours    the share of this customer's finished orders that never reached them.
    //   Bosta's `receiver.ranking`, which Bosta computes from data we cannot see.
    //
    // A customer with no history is never blocked — a first order has nothing to judge — and
    // if Bosta's figure cannot be fetched the decision falls back to our own test alone
    // rather than blocking on a number nobody could read.
    cod_policy: {
        enabled: { type: Boolean, default: true },
        // How many FINISHED orders a customer needs before our own rule may block them.
        // Below it the rate is noise: one refusal out of two is 50% and means nothing.
        min_finished_orders: { type: Number, default: 3, min: 1 },
        // Block when more than this share of their finished orders went undelivered.
        max_undelivered_percent: { type: Number, default: 50, min: 0, max: 100 },
        // Consult Bosta's customer ranking as the second test.
        use_bosta_ranking: { type: Boolean, default: true },
        // Block when Bosta's ranking for the phone is below this.
        min_bosta_ranking: { type: Number, default: 30, min: 0, max: 100 },
        // How long a fetched ranking is trusted before it is read again. Checkout must not
        // wait on a third party for a figure that moves this slowly.
        ranking_cache_hours: { type: Number, default: 12, min: 1 },
    },

    // ---- Which gateway takes the money ----
    payments: {
        provider: { type: String, enum: ['fawaterak', 'paymob'], default: 'fawaterak' },
        paymob_pilot_user_ids: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
    },

    // ---- Abandoned-cart reminder emails (services/abandonedCartService.js) ----
    // Set from the admin's "Cart reminder emails" page. A field left unset falls back to its
    // ABANDONED_CART_* environment value. Kept out of the public GET /api/settings.
    abandoned_cart: {
        enabled: { type: Boolean, default: undefined },
        send_time: { type: String, default: undefined },        // 'HH:MM', in ABANDONED_CART_TIMEZONE
        inactivity_hours: { type: Number, default: undefined },
        // What the last real run did — counts per outcome, or why it did not run.
        last_run_at: { type: Date, default: undefined },
        last_run_result: { type: mongoose.Schema.Types.Mixed, default: undefined },
    },
}, {
    timestamps: true
});

const SiteSettings = mongoose.model('SiteSettings', siteSettingsSchema);

module.exports = { SiteSettings };
