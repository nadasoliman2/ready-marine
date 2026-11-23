require('dotenv').config();
const createError = require('http-errors');
const express = require('express');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const compression = require('compression');
const mongoose = require('mongoose');

const {
    indexRouter,
    servicesRouter,
    uploadRouter,
    settingsRouter,
    pagesRouter,
    verificationRouter,
    feedsRouter,
    assistantRouter
} = require('./modules/general');
const {
    adminRouter,
    adminCatalogRouter,
    adminEverysecondRouter,
    adminFinanceRouter,
    adminFitmentRouter,
    adminImageCheckRouter,
    adminImageStudioRouter,
    adminPaymentsRouter,
    adminReportsRouter,
    adminSuppliesRouter,
    vendorSuppliesRouter,
    imageStudioService,
    imageCheckService,
    supplyService
} = require('./modules/admin');

const { subscriptionPackagesRouter, subscriptionsRouter } = require('./modules/subscription');
const { notificationsRouter, customerNotificationsRouter } = require('./modules/notification');

const {
    bostaWebhookRouter,
    arriveWebhookRouter,
    paymobWebhookRouter,
    paymobPayoutWebhookRouter,
    everysecondWebhookRouter
} = require('./modules/webhook');
const { returnsRouter } = require('./modules/return');
const { adsRouter } = require('./modules/ad');
const { bundlesRouter } = require('./modules/bundle');
const { familyRouter, familyInvitationsRouter } = require('./modules/family');
const {
    friendsRouter,
    friendCheckoutRouter,
    friendInvitationsRouter,
    invitationsRouter
} = require('./modules/friend');

const path = require('path');

const app = express();

// Database Connection
mongoose.connect(process.env.MONGO_URI)
.then(async () => {
    console.log(process.env.PORT);
    console.log(process.env.MONGO_URI);
    console.log('MongoDB Connected');
    // Build the search index now, so the first visitor to type in the search box does not wait.
    require('./modules/product/search_suggest.service').getIndex().catch(() => {});
    // Check if we need to seed pages
    try {
        const { Page } = require('./models/pages');
        const count = await Page.countDocuments();
        if (count === 0) {
            console.log('[Init] No pages found, running seeder...');
            const { seed } = require('./seeders/seed_pages');
            await seed();
        }
    } catch (e) {
        console.error('[Init] Error checking/seeding pages:', e);
    }
    // Check if we need to seed shipping defaults
    try {
        const { ShippingSettings } = require('./models/shipping_settings');
        const shippingCount = await ShippingSettings.countDocuments();
        if (shippingCount === 0) {
            console.log('[Init] No shipping settings found, running shipping seeder...');
            const { seed } = require('./seeders/shippingSeeder');
            await seed();
        }
    } catch (e) {
        console.error('[Init] Error checking/seeding shipping defaults:', e);
    }
    // Check if we need to seed cities (Bosta-compatible)
    try {
        const { City } = require('./models/cities');
        const cityCount = await City.countDocuments();
        if (cityCount === 0) {
            console.log('[Init] No cities found, running city seeder...');
            const { seed: seedCities } = require('./seeders/citySeeder');
            await seedCities();
        }
    } catch (e) {
        console.error('[Init] Error checking/seeding cities:', e);
    }
    // Seed the packaging catalogue on a fresh install. Guarded on the collection being
    // empty, so an admin who deletes an item they do not sell will not find it back
    // tomorrow.
    try {
        const { SupplyProduct } = require('./models/supplyProducts');
        if (await SupplyProduct.countDocuments() === 0) {
            console.log('[Init] No supply products found, seeding the packaging catalogue...');
            const { seed: seedSupplies } = require('./seeders/supplyProductsSeeder');
            await seedSupplies({ apply: true });
        }
    } catch (e) {
        console.error('[Init] Error checking/seeding supply products:', e);
    }
    // Check if we need to seed the Bosta sector zones and their rates. Guarded on there
    // being no ACTIVE zone at all: with no zone, `no_zone_behavior` decides every quote,
    // which on this install means checkout is blocked outright.
    try {
        const { ShippingZone } = require('./models/shipping_zones');
        const activeZones = await ShippingZone.countDocuments({ is_active: true });
        if (activeZones === 0) {
            console.log('[Init] No active shipping zones found, seeding Bosta sector rates...');
            const { seed: seedRates } = require('./seeders/bostaRatesSeeder');
            await seedRates({ apply: true });
        }
    } catch (e) {
        console.error('[Init] Error checking/seeding Bosta rates:', e);
    }
    // Check and seed initial target audiences
    try {
        const { audienceService } = require('./modules/audience');
        await audienceService.seedInitialAudiences();
    } catch (e) {
        console.error('[Init] Error checking/seeding target audiences:', e);
    }
})
.catch(err => console.error('MongoDB Connection Error:', err));

// Trust the nginx/Apache reverse proxy so req.protocol reflects https
app.set('trust proxy', 1);

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
// gzip every response over ~1KB. The JSON API responses here are structured,
// repetitive data (the same key names thousands of times over), which compresses
// to a small fraction of its size — the /products/filters payload alone goes from
// ~1.9MB to under 100KB. Costs a bit of CPU per request in exchange for a much
// smaller transfer, which is the right trade for a JSON API on real networks.
app.use(compression());
app.use(logger('dev'));
// EverySecond's webhook is signed over the exact bytes it sends, so it reads its own raw
// body and has to be mounted before express.json() would parse (and consume) it.
app.use('/api/webhooks/everysecond', everysecondWebhookRouter);
// Above Express's 100kb default: a reviewed bulk upload posts every parsed row
// back — titles, descriptions and image URLs for hundreds of products — and the
// 413 would land on the vendor after they had already worked through the review
// screen. Payloads here are text; images travel through /api/upload separately.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.COOKIE_SECRET));
// Every uploader names its files uniquely (timestamp + random / content hash) and never
// overwrites one, so a stored image can be cached by the browser for a long time instead
// of being re-checked on every page view (it was served with max-age=0).
// `?w=` asks for a resized copy — see middleware/imageThumbnails.js.
// Company transfer receipts (feature 14) live under uploads so they persist with the
// volume, but are bank documents: never served statically, only through the company's
// and the admin's authenticated routes.
app.use('/uploads/company-receipts', (req, res) => res.status(404).end());
app.use('/uploads', require('./middleware/imageThumbnails')(path.join(__dirname, 'public/uploads')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), { maxAge: '30d', immutable: true }));

// Routes
app.use('/', indexRouter);
// Mounted ahead of the generic users router so the more specific customer
// sub-resources win before /api/users sees the request.
app.use('/api/users/family', familyRouter);
app.use('/api/users/friends', friendsRouter);
app.use('/api/users/notifications', customerNotificationsRouter);
app.use('/api/users/loyalty', require('./modules/loyalty').router);
app.use('/api/users/wallet', require('./modules/wallet').router);
app.use('/api/users/verification', verificationRouter);
app.use('/api/users/company', require('./modules/company').myCompanyRouter);
app.use('/api/family-invitations', familyInvitationsRouter);
app.use('/api/friend-invitations', friendInvitationsRouter);
app.use('/api/company-invitations', require('./modules/company').companyInvitationsRouter);
app.use('/api/company', require('./modules/company').companyRouter);
app.use('/api/corporate-clients', require('./modules/company').corporateClientsRouter);
app.use('/api/invitations', invitationsRouter);
app.use('/api/users', require('./modules/user').router);
app.use('/api/auth', require('./modules/auth').router);
app.use('/api/brands', require('./modules/brand').router);
app.use('/api/categories', require('./modules/category').router);
app.use('/api/target-audiences', require('./modules/audience').router);
app.use('/api/admin/target-audiences', require('./modules/audience').router);
app.use('/api/products', require('./modules/product').router);
app.use('/api/services', servicesRouter);
app.use('/api/feeds', feedsRouter);
// Mounted ahead of the generic orders router: friend checkout is online-only
// and must never fall through to the normal (COD-capable) order route.
app.use('/api/orders/friend-checkout', friendCheckoutRouter);
app.use('/api/orders', require('./modules/order').router);
app.use('/api/coupons', require('./modules/coupon').router);
app.use('/api/vendors/supplies', vendorSuppliesRouter);
app.use('/api/vendors', require('./modules/vendor').router);
app.use('/api/upload', uploadRouter);
// Ahead of the main admin router: its `/users/:id` would take "reports" for an id.
app.use('/api/admin/users/reports', adminReportsRouter);
app.use('/api/admin/car-campaigns', require('./modules/campaign').router);
app.use('/api/admin/campaigns', require('./modules/campaign').router);
// Ahead of the main admin router for the same reason: "/products/fitment-check" is not a product.
app.use('/api/admin/products/fitment-check', adminFitmentRouter);
// The same for "/products/image-studio": cleaner product pictures before approval, web pictures.
app.use('/api/admin/products/image-studio', adminImageStudioRouter);
// And "/products/image-check": products whose pictures look wrong, beside the fitment check.
app.use('/api/admin/products/image-check', adminImageCheckRouter);
app.use('/api/admin', adminRouter);

// The image studio's queue picks up where a restart left it (services/imageStudioService.js;
// off under test unless IMAGE_STUDIO_WORKER=1).
imageStudioService.start();
// The image check measures new product pictures in the background (off under test).
imageCheckService.start();
app.use('/api/settings', settingsRouter);
app.use('/api/tickets', require('./modules/support').ticketsRouter);
app.use('/api/admin/subscription-packages', subscriptionPackagesRouter);
app.use('/api/admin/shipping', require('./modules/shipping').adminShippingRouter);
app.use('/api/admin/loyalty', require('./modules/loyalty').adminLoyaltyRouter);
app.use('/api/admin/wallet', require('./modules/wallet').adminWalletRouter);
app.use('/api/admin/payments', adminPaymentsRouter);
app.use('/api/payments/paymob', paymobWebhookRouter);
app.use('/api/admin/catalog', adminCatalogRouter);
app.use('/api/admin/finance', adminFinanceRouter);
app.use('/api/admin/supplies', adminSuppliesRouter);
app.use('/api/admin/companies', require('./modules/company').adminCompaniesRouter);
app.use('/api/admin/everysecond', adminEverysecondRouter);
// The website chat with the AI assistant (EverySecond chat commerce).
app.use('/api/assistant', assistantRouter);
app.use('/api/vendors/subscription', subscriptionsRouter);
app.use('/api/vendors/notifications', notificationsRouter);
app.use('/api/pages', pagesRouter);
app.use('/api/articles', require('./modules/article').router);
app.use('/api/shipping', require('./modules/shipping').shippingRouter);
app.use('/api/contact', require('./modules/support').contactRouter);
app.use('/api/webhooks/bosta', bostaWebhookRouter);
app.use('/api/webhooks/arrive', arriveWebhookRouter);
app.use('/api/webhooks/paymob-payouts', paymobPayoutWebhookRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/ads', adsRouter);
app.use('/api/bundles', bundlesRouter);
app.use('/api/reviews', require('./modules/review').router);
app.use('/api/admin/reviews', require('./modules/review').adminRouter);

// Cron job: check for expired subscriptions daily at midnight
if (process.env.NODE_ENV !== 'test') {
    // The catalog link matcher reads all 38,000 entries (about ten seconds on the server), a
    // minute after start, so the first admin to open the catalog does not wait for it.
    setTimeout(() => require('./modules/product/catalog_match.service').getMatcher().catch(() => {}), 60 * 1000);

    const cron = require('node-cron');
    const { expireOldSubscriptions, sendExpiryReminders } = require('./modules/subscription/vendor_subscription.service');
    const { runEarningsClearanceSweep } = require('./modules/vendor/vendor_earnings.service');
    const { expireOldAds } = require('./modules/ad/ad.service');

    // Run daily at midnight
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log('[Cron] Running daily subscription expiration check...');
            await expireOldSubscriptions();
            // Send expiry reminders: 7-day, 3-day, and day-of warnings
            await sendExpiryReminders(7);
            await sendExpiryReminders(3);
            await sendExpiryReminders(1);
            console.log('[Cron] Subscription expiration check complete.');
        } catch (err) {
            console.error('[Cron] Subscription expiration check failed:', err.message);
        }

        try {
            console.log('[Cron] Running daily vendor earnings clearance sweep...');
            await runEarningsClearanceSweep();
        } catch (err) {
            console.error('[Cron] Earnings clearance sweep failed:', err.message);
        }

        try {
            console.log('[Cron] Running daily loyalty points sweep...');
            const { runLoyaltySweep } = require('./modules/loyalty/loyalty.service');
            const { releaseStalePaymentHolds } = require('./modules/order/order_payment.service');
            await releaseStalePaymentHolds();
            await runLoyaltySweep();
        } catch (err) {
            console.error('[Cron] Loyalty sweep failed:', err.message);
        }

        try {
            // Closes out abandoned top-ups, and — the part that matters —
            // credits any that were genuinely paid but whose webhook never
            // arrived. Nothing else in the system would ever notice those.
            const { sweepStaleTopups } = require('./modules/wallet/wallet_topup.service');
            await sweepStaleTopups();
        } catch (err) {
            console.error('[Cron] Wallet top-up sweep failed:', err.message);
        }

        try {
            console.log('[Cron] Expiring ended banner ads...');
            await expireOldAds();
        } catch (err) {
            console.error('[Cron] Ad expiry failed:', err.message);
        }

        try {
            const { expireOldInvitations } = require('./modules/friend/friend.service');
            const { expired } = await expireOldInvitations();
            if (expired > 0) console.log(`[Cron] Expired ${expired} friend invitation(s).`);
        } catch (err) {
            console.error('[Cron] Friend invitation expiry failed:', err.message);
        }
    });

    // Vendor payouts: follow Paymob transfers to their final status, catch bank returns, and
    // undo any payout whose preparation was interrupted. Every 10 minutes because wallet
    // transfers settle on the spot but bank ones take hours to days; Paymob allows only
    // 5 status reads a minute, which the client paces.
    cron.schedule('*/10 * * * *', async () => {
        try {
            const { runPayoutMaintenance } = require('./modules/vendor/vendor_payout.service');
            await runPayoutMaintenance();
        } catch (err) {
            console.error('[Cron] Payout maintenance failed:', err.message);
        }
    });
    console.log('[Cron] Payout maintenance started (every 10 minutes).');

    // The Paymob Payouts account statement: copy the top-ups Paymob lists (from the portal or
    // the API), so money loaded into the budget is on the books without anyone typing it.
    // Every 30 minutes, off the payout maintenance's minutes — Paymob allows 5 reads a minute.
    cron.schedule('7,37 * * * *', async () => {
        try {
            const { syncTopups } = require('./common/services/payouts/payoutsAccountService');
            const r = await syncTopups();
            if (r.created || r.linked || r.updated) console.log(`[Payouts] Top-ups synced: ${JSON.stringify(r)}`);
            if (r.ok === false) console.error('[Payouts] Top-up sync failed:', r.error);
        } catch (err) {
            console.error('[Cron] Payouts top-up sync failed:', err.message);
        }
    });

    // Review requests go out a day after each parcel arrives, so the sweep runs hourly and
    // the service decides what is due. It skips the night hours on its own: it used to ride
    // the midnight UTC job — 3 AM for the customer — which is no time to ask for a favour.
    cron.schedule('5 * * * *', async () => {
        try {
            const { sendPendingReviewInvites } = require('./modules/review/review.service');
            const { invited, sent, skipped } = await sendPendingReviewInvites();
            if (!skipped && invited > 0) console.log(`[Cron] Review invites: ${sent}/${invited} sent.`);
        } catch (err) {
            console.error('[Cron] Review invite sweep failed:', err.message);
        }
    });
    console.log('[Cron] Review invite sweep started (hourly; sends 10:00-21:00 Cairo, a day after delivery).');

    // Family order requests expire faster than a day, so they get their own
    // hourly sweep: expire what timed out, warn on what is about to.
    const { expireStaleRequests } = require('./modules/family/family_order_request.service');
    cron.schedule('15 * * * *', async () => {
        try {
            const { expired, warned } = await expireStaleRequests();
            if (expired > 0 || warned > 0) {
                console.log(`[Cron] Family requests: expired ${expired}, expiring-soon warnings ${warned}.`);
            }
        } catch (err) {
            console.error('[Cron] Family request expiry sweep failed:', err.message);
        }
    });
    console.log('[Cron] Family order-request expiry sweep started (runs hourly).');

    // The prepaid Bosta bundle: how many parcels are left on it, and how long it has to
    // live. Hourly rather than daily because both ends of it are urgent — when the balance
    // runs out shipping stops entirely, and when the bundle expires whatever is left on it
    // is simply lost (the cycle before this one expired with 9 of its 20 parcels unused).
    // The sweep re-reads Bosta, so it doubles as the mirror that keeps parcel costing
    // priced against the live bundle.
    cron.schedule('25 * * * *', async () => {
        try {
            const { runBundleAlertSweep } = require('./modules/shipping/bosta_bundle.service');
            const result = await runBundleAlertSweep();
            if (result?.alerted?.length) {
                const names = Array.isArray(result.alerted) ? result.alerted.join(', ') : String(result.alerted);
                console.log(`[Cron] Bosta bundle alerts sent: ${names}.`);
            }
        } catch (err) {
            console.error('[Cron] Bosta bundle sweep failed:', err.message);
        }
    });
    console.log('[Cron] Bosta bundle balance sweep started (runs hourly).');

    // Supply orders learn they are paid from the provider's webhook — and a webhook can be
    // lost or rejected. This re-reads every order still "awaiting payment" from the provider
    // and settles the ones whose money already arrived. Runs once shortly after boot too, so
    // a deploy is enough to unstick anything waiting.
    const { sweepAwaitingOrders } = supplyService;
    const runSupplySweep = async () => {
        try {
            const { checked, rescued } = await sweepAwaitingOrders();
            if (checked > 0) console.log(`[Cron] Supply payment sweep: checked ${checked}, settled ${rescued}.`);
        } catch (err) {
            console.error('[Cron] Supply payment sweep failed:', err.message);
        }
    };
    cron.schedule('25 * * * *', runSupplySweep);
    setTimeout(runSupplySweep, 30 * 1000);
    console.log('[Cron] Supply payment sweep started (hourly, plus once 30s after boot).');
    console.log('[Cron] Daily scheduler started (subscriptions + earnings clearance, runs daily at midnight).');

    // Polling fallback: sync Bosta delivery status for active orders every 20 minutes.
    // This is a safety net so orders still progress (and complete) even if a Bosta
    // webhook is missed or not yet configured.
    const { sweepActiveBostaOrders } = require('./modules/shipping/bosta_fulfillment.service');
    cron.schedule('*/20 * * * *', async () => {
        try {
            const { checked, updated } = await sweepActiveBostaOrders();
            if (checked > 0) {
                console.log(`[Cron] Bosta tracking sweep: checked ${checked}, updated ${updated}.`);
            }
        } catch (err) {
            console.error('[Cron] Bosta tracking sweep failed:', err.message);
        }
    });
    console.log('[Cron] Bosta tracking sweep started (runs every 20 minutes).');

    // Same safety net for Arrive, offset by ten minutes so the two sweeps never share a
    // minute. One request per 50 waybills, paced under Arrive's 50/minute ceiling.
    const { sweepActiveArriveShipments } = require('./modules/shipping/couriers/arrive/tracking');
    cron.schedule('10,30,50 * * * *', async () => {
        try {
            const { checked, updated } = await sweepActiveArriveShipments();
            if (checked > 0) console.log(`[Cron] Arrive tracking sweep: checked ${checked}, updated ${updated}.`);
        } catch (err) {
            console.error('[Cron] Arrive tracking sweep failed:', err.message);
        }
    });
    console.log('[Cron] Arrive tracking sweep started (runs every 20 minutes, offset).');

    // Retry the WhatsApp order confirmations that have not gone out, and raise the
    // phone-call flag on the ones that have run out of attempts. Same cadence as the
    // retry window, so an order gets its three tries inside the hour.
    const { sweepUnconfirmedOrders } = require('./modules/order/order.service');
    cron.schedule('*/20 * * * *', async () => {
        try {
            const { retried, abandoned, flagged } = await sweepUnconfirmedOrders();
            if (retried > 0 || abandoned > 0) {
                console.log(`[Cron] Order confirmations: retried ${retried}, abandoned ${abandoned}, flagged ${flagged} for a call.`);
            }
        } catch (err) {
            console.error('[Cron] Order confirmation sweep failed:', err.message);
        }
    });
    console.log('[Cron] Order confirmation sweep started (runs every 20 minutes).');

    // Ask EverySecond what actually happened to the confirmations already queued. The retry
    // sweep above only sees messages that never left; this one catches the ones the provider
    // accepted and then failed to deliver — invisible here until it is asked, because there
    // are no delivery webhooks. Offset from the retry sweep so the two never contend for the
    // same orders in the same minute.
    const { sweepConfirmationDeliveries } = require('./modules/order/order.service');
    cron.schedule('10,30,50 * * * *', async () => {
        try {
            const { checked, delivered, failed, flagged } = await sweepConfirmationDeliveries();
            if (checked > 0) {
                console.log(`[Cron] WhatsApp delivery: checked ${checked}, delivered ${delivered}, failed ${failed}, flagged ${flagged}.`);
            }
        } catch (err) {
            console.error('[Cron] WhatsApp delivery sweep failed:', err.message);
        }
    });
    console.log('[Cron] WhatsApp delivery sweep started (runs every 20 minutes).');

    // Vendor deadlines on parcels: remind before the deadline, flag after it. Deliberately
    // toothless — nothing is ever auto-cancelled, because a late parcel is still a parcel
    // the customer is waiting for and writing it off is an admin's judgement call.
    const { runSubOrderDeadlineSweep } = require('./modules/order/sub_order_sweep.service');
    cron.schedule('10 * * * *', async () => {
        try {
            const { reminded, flagged } = await runSubOrderDeadlineSweep();
            if (reminded > 0 || flagged > 0) {
                console.log(`[Cron] Parcel deadlines: reminded ${reminded}, flagged ${flagged} overdue.`);
            }
        } catch (err) {
            console.error('[Cron] Parcel deadline sweep failed:', err.message);
        }
    });
    console.log('[Cron] Parcel deadline sweep started (runs hourly).');

    // Abandoned-cart reminder emails: daily, at ABANDONED_CART_CRON in ABANDONED_CART_TIMEZONE.
    // Off unless ABANDONED_CART_ENABLED=true; needs REDIS_URL to tell who is online.
    require('./modules/order/abandoned_cart.service').scheduleAbandonedCartReminders(cron);

    // Reconciliation: link any vendor location still missing a Bosta pickup location.
    // Signup links them already, so this only mops up the ones a Bosta outage left behind
    // — without it such a vendor stays permanently unbookable for a courier.
    const { sweepUnlinkedVendorLocations } = require('./modules/vendor/vendor.service');
    cron.schedule('30 * * * *', async () => {
        try {
            const { checked, linked, problems } = await sweepUnlinkedVendorLocations();
            if (checked > 0) {
                console.log(`[Cron] Bosta vendor-location sweep: ${linked}/${checked} linked.`);
                for (const p of problems) console.warn(`[Cron]   needs attention — ${p}`);
            }
        } catch (err) {
            console.error('[Cron] Bosta vendor-location sweep failed:', err.message);
        }
    });
    console.log('[Cron] Bosta vendor-location sweep started (runs hourly).');

    // Company consolidation (feature 14): close batches whose time is up, finish any close
    // that was interrupted, and keep the orders riding in a combined parcel level with it.
    // Every five minutes, because the wait promised to employees is counted in hours.
    const { runBatchSweep } = require('./modules/company/company_batch.service');
    cron.schedule('*/5 * * * *', async () => {
        try {
            const r = await runBatchSweep();
            if (r.closed || r.recovered || r.joined || r.released) {
                console.log(`[Cron] Company batches: closed ${r.closed}, recovered ${r.recovered}, joined ${r.joined}, released ${r.released}.`);
            }
        } catch (err) {
            console.error('[Cron] Company batch sweep failed:', err.message);
        }
    });
    console.log('[Cron] Company batch sweep started (runs every 5 minutes).');

    // Company invoices (feature 14, phase 4): issue last month's invoices on the 1st
    // (an hour after midnight), remind before and on the due date, pause late companies past their grace
    // period and resume them once paid. Hourly — every step is a no-op when nothing is due.
    const { runInvoiceSweep } = require('./modules/company/company_invoice.service');
    cron.schedule('20 * * * *', async () => {
        try {
            const r = await runInvoiceSweep();
            if (r.issued || r.moved || r.reminders || r.due_notices || r.overdue || r.paused || r.resumed) {
                console.log(`[Cron] Company invoices: issued ${r.issued}, moved ${r.moved}, reminders ${r.reminders + r.due_notices}, overdue ${r.overdue}, paused ${r.paused}, resumed ${r.resumed}.`);
            }
        } catch (err) {
            console.error('[Cron] Company invoice sweep failed:', err.message);
        }
    });
    console.log('[Cron] Company invoice sweep started (runs hourly).');

    // EverySecond chat commerce (Backend/docs/EVERYSECOND_CHAT_COMMERCE.md). Off unless
    // EVERYSECOND_API_KEY is set.
    //   menu sync  — every EVERYSECOND_SYNC_MINUTES (default 10): the catalogue's prices, stock,
    //                links and photos reach the agent; only what changed is sent.
    //   every min  — webhook events that failed to apply, chat orders EverySecond holds that
    //                never reached us (webhook down, or a machine it cannot call), and the
    //                order statuses the customer has not been told in the chat yet.
    const everysecond = require('./modules/admin/everysecond');
    if (everysecond.isConfigured()) {
        const syncMinutes = Number.parseInt(process.env.EVERYSECOND_SYNC_MINUTES ?? '10', 10);
        const runSync = async ({ reconcile = false } = {}) => {
            try {
                const r = await everysecond.syncCatalog({ reconcile });
                if (r?.pushed || r?.deleted || r?.failed) {
                    console.log(`[Cron] EverySecond menu sync: ${r.pushed} sent, ${r.deleted} removed, ${r.failed} failed.`);
                }
            } catch (err) {
                console.error('[Cron] EverySecond menu sync failed:', err.message);
            }
        };
        if (syncMinutes > 0) {
            // The first run reconciles against what EverySecond actually holds.
            setTimeout(() => runSync({ reconcile: true }), 45 * 1000);
            cron.schedule(syncMinutes >= 60 ? '0 * * * *' : `*/${syncMinutes} * * * *`, () => runSync());
        }
        let followUpRunning = false;
        cron.schedule('* * * * *', async () => {
            if (followUpRunning) return;
            followUpRunning = true;
            try {
                const events = await everysecond.retryEvents();
                const imported = await everysecond.importMissedOrders().catch((err) => {
                    console.error('[Cron] EverySecond order catch-up failed:', err.message);
                    return 0;
                });
                const told = await everysecond.sweepStatusAnnouncements();
                if (events || imported || told) {
                    console.log(`[Cron] EverySecond: ${events} event(s) retried, ${imported} missed order(s) imported, ${told} status update(s) sent.`);
                }
            } catch (err) {
                console.error('[Cron] EverySecond follow-up failed:', err.message);
            } finally {
                followUpRunning = false;
            }
        });
        console.log(`[Cron] EverySecond chat commerce started (menu sync ${syncMinutes > 0 ? `every ${syncMinutes}m` : 'off'}, follow-ups every minute).`);
    } else {
        console.log('[Cron] EverySecond chat commerce off — EVERYSECOND_API_KEY is not set.');
    }
}

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.json({
        message: err.message,
        error: req.app.get('env') === 'development' ? err : {}
    });
});

module.exports = app;
