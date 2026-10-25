/**
 * The admin dashboard's front page: a few numbers for every section of the sidebar, so the
 * admin sees where work is waiting before opening anything.
 *
 *   getOverview(admin) → { sections: { [module]: { [stat]: number } }, generated_at }
 *
 * Only the modules this admin may view are counted (adminAccessService decides, the same way
 * it decides every other request), so a sub-admin's page never reveals what another section
 * holds. Each section is counted on its own: one that fails comes back missing, not as an
 * error for the whole page.
 *
 * The stat keys are what the dashboard labels; `attention` keys are the ones that mean
 * somebody has to act.
 */

const { User } = require('../models/users');
const { Seller } = require('../models/sellers');
const { Company } = require('../models/companies');
const { EmailVerification } = require('../models/emailVerification');
const { VendorSubscription } = require('../models/vendorSubscriptions');
const { SubscriptionPackage } = require('../models/subscriptionPackages');
const { Product } = require('../models/products');
const { CatalogEntry } = require('../models/catalogEntries');
const { Bundle } = require('../models/bundles');
const { Order } = require('../models/orders');
const { ReturnRequest } = require('../models/returnRequests');
const { Refund } = require('../models/refunds');
const { WithdrawalRequest } = require('../models/withdrawalRequests');
const { AdRequest } = require('../models/ads');
const { BostaPickup } = require('../models/bostaPickups');
const { SupplyOrder } = require('../models/supplyOrders');
const { ContactInquiry } = require('../models/contact_inquiries');
const { Ticket } = require('../models/tickets');
const { Coupon } = require('../models/coupons');
const { WalletAccount } = require('../models/walletAccounts');
const { LoyaltyAccount } = require('../models/loyaltyAccounts');
const { Review } = require('../models/reviews');
const { Category } = require('../models/categories');
const { CarBrand } = require('../models/car_brands');
const { Brand } = require('../models/product_brands');
const { Service } = require('../models/services');
const { Article } = require('../models/articles');
const { Page } = require('../models/pages');
const { CarEmailCampaign } = require('../models/carEmailCampaigns');
const { AbandonedCartEmail } = require('../models/abandonedCartEmails');
const adminAccess = require('./adminAccessService');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const OPEN_RETURN_STATUSES = ['pending_vendor_review', 'vendor_approved', 'vendor_rejected', 'pending_admin_review', 'approved', 'return_shipping', 'return_received', 'refund_processing'];
const PARCEL_ATTENTION = ['needs_admin', 'exception'];

/** Run every count of a section in parallel: `{ key: promise }` → `{ key: value }`. */
const all = async (counts) => {
    const keys = Object.keys(counts);
    const values = await Promise.all(keys.map((k) => counts[k]));
    return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
};

const sumOf = async (model, match, field) => {
    const [row] = await model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: `$${field}` } } }]);
    return Math.round(Number(row?.total || 0) * 100) / 100;
};

/** One counter per permission module. A module with nothing worth counting is left out. */
const COUNTERS = {
    users: () => all({
        total: User.countDocuments({ account_status: 'active' }),
        new_7d: User.countDocuments({ account_status: 'active', created_at: { $gte: daysAgo(7) } }),
        reminders_7d: AbandonedCartEmail.countDocuments({ status: 'sent', created_at: { $gte: daysAgo(7) } }),
    }),
    car_campaigns: () => all({
        total: CarEmailCampaign.countDocuments({}),
        sent: CarEmailCampaign.countDocuments({ status: 'sent' }),
    }),
    vendors: () => all({
        total: Seller.countDocuments({}),
        suspended: Seller.countDocuments({ status: 'suspended' }),
        new_7d: Seller.countDocuments({ created_at: { $gte: daysAgo(7) } }),
    }),
    companies: () => all({
        active: Company.countDocuments({ status: 'active' }),
        suspended: Company.countDocuments({ status: 'suspended' }),
    }),
    verifications: () => all({
        pending: EmailVerification.countDocuments({}),
    }),
    subscription_packages: () => all({
        active: SubscriptionPackage.countDocuments({ status: 'active' }),
    }),
    subscriptions: () => all({
        active: VendorSubscription.countDocuments({ status: 'active' }),
        expired: VendorSubscription.countDocuments({ status: 'expired' }),
    }),
    products: () => all({
        published: Product.countDocuments({ status: 'published' }),
        pending: Product.countDocuments({ status: 'pending' }),
        draft: Product.countDocuments({ status: 'draft' }),
    }),
    catalog: () => all({
        approved: CatalogEntry.countDocuments({ status: 'approved' }),
        suggested: CatalogEntry.countDocuments({ status: 'suggested' }),
    }),
    bundles: () => all({
        published: Bundle.countDocuments({ status: 'published' }),
        pending: Bundle.countDocuments({ status: 'pending' }),
    }),
    orders: () => all({
        today: Order.countDocuments({ created_at: { $gte: startOfToday() } }),
        pending: Order.countDocuments({ status: 'pending' }),
        last_30d: Order.countDocuments({ created_at: { $gte: daysAgo(30) }, status: { $ne: 'cancelled' } }),
        revenue_30d: sumOf(Order, { created_at: { $gte: daysAgo(30) }, status: { $ne: 'cancelled' } }, 'total_price'),
    }),
    parcels: async () => {
        const [row] = await Order.aggregate([
            { $match: { 'sub_orders.status': { $in: PARCEL_ATTENTION } } },
            { $unwind: '$sub_orders' },
            { $match: { 'sub_orders.status': { $in: PARCEL_ATTENTION } } },
            { $count: 'n' },
        ]);
        return { attention: row?.n || 0 };
    },
    returns: () => all({
        open: ReturnRequest.countDocuments({ status: { $in: OPEN_RETURN_STATUSES } }),
        refunds_pending: Refund.countDocuments({ status: { $in: ['pending', 'processing'] } }),
    }),
    withdrawals: () => all({
        pending: WithdrawalRequest.countDocuments({ status: 'pending' }),
        paid_30d: sumOf(WithdrawalRequest, { status: 'paid', created_at: { $gte: daysAgo(30) } }, 'amount'),
    }),
    ads: () => all({
        pending: AdRequest.countDocuments({ status: 'pending' }),
        approved: AdRequest.countDocuments({ status: 'approved' }),
    }),
    pickups: () => all({
        scheduled: BostaPickup.countDocuments({ status: 'scheduled' }),
    }),
    supplies: () => all({
        pending: SupplyOrder.countDocuments({ status: 'pending' }),
    }),
    contact_inquiries: () => all({
        new: ContactInquiry.countDocuments({ status: 'new' }),
        total: ContactInquiry.countDocuments({}),
    }),
    tickets: () => all({
        open: Ticket.countDocuments({ status: 'open' }),
        pending: Ticket.countDocuments({ status: 'pending' }),
    }),
    coupons: () => all({
        active: Coupon.countDocuments({ is_active: true, $or: [{ expires_at: null }, { expires_at: { $gte: new Date() } }] }),
    }),
    wallets: () => all({
        total: WalletAccount.countDocuments({}),
        frozen: WalletAccount.countDocuments({ status: 'frozen' }),
    }),
    loyalty: () => all({
        members: LoyaltyAccount.countDocuments({}),
    }),
    reviews: () => all({
        pending: Review.countDocuments({ status: 'pending' }),
        approved: Review.countDocuments({ status: 'approved' }),
    }),
    categories: () => all({ total: Category.countDocuments({}), active: Category.countDocuments({ is_active: true }) }),
    car_brands: () => all({ total: CarBrand.countDocuments({}) }),
    product_brands: () => all({ total: Brand.countDocuments({}) }),
    services: () => all({ active: Service.countDocuments({ status: 'active' }), total: Service.countDocuments({}) }),
    articles: () => all({ published: Article.countDocuments({ status: 'published' }), draft: Article.countDocuments({ status: 'draft' }) }),
    pages: () => all({ total: Page.countDocuments({}) }),
};

const mayView = (admin, moduleKey) => {
    const mod = adminAccess.MODULES.find((m) => m.key === moduleKey);
    if (!mod) return false;
    return adminAccess.checkAccess(admin, 'GET', mod.paths[0]).allowed;
};

const getOverview = async (admin) => {
    const keys = Object.keys(COUNTERS).filter((k) => mayView(admin, k));
    const results = await Promise.all(keys.map(async (k) => {
        try {
            return [k, await COUNTERS[k]()];
        } catch (err) {
            console.error(`[Admin overview] ${k} failed: ${err.message}`);
            return [k, null];
        }
    }));
    return {
        sections: Object.fromEntries(results.filter(([, v]) => v)),
        generated_at: new Date(),
    };
};

module.exports = { getOverview };
