const mongoose = require('mongoose');

const { User } = require('../models/users');
const { Seller } = require('../models/sellers');
const { Order } = require('../models/orders');
const { OrderPayment } = require('../models/orderPayments');
const { ReturnRequest } = require('../models/returnRequests');
const { Refund } = require('../models/refunds');
const { Ticket } = require('../models/tickets');
const { Coupon } = require('../models/coupons');
const { Product } = require('../models/products');
const { AdRequest } = require('../models/ads');
const { VendorEarning } = require('../models/vendorEarnings');
const { VendorSubscription } = require('../models/vendorSubscriptions');
const { SubscriptionPayment } = require('../models/subscriptionPayments');
const { WithdrawalRequest } = require('../models/withdrawalRequests');
const { Notification } = require('../models/notifications');
const { BostaPickup } = require('../models/bostaPickups');
const { ShippingPolicy } = require('../models/shipping_policies');
const { WalletAccount } = require('../models/walletAccounts');
const { WalletTransaction } = require('../models/walletTransactions');
const { WalletTopup } = require('../models/walletTopups');
const { LoyaltyAccount } = require('../models/loyaltyAccounts');
const { LoyaltyTransaction } = require('../models/loyaltyTransactions');
const { recordAuditLog } = require('../models/auditLog');

/** Minor units → EGP. Kept local so this file never imports a service. */
const toMajorAmount = (minor) => Number(((Number(minor) || 0) / 100).toFixed(2));

/**
 * Hard delete (permanent, non-recoverable) for user and vendor accounts.
 *
 * Strategy for "all-or-nothing":
 *  - When the MongoDB deployment supports multi-document transactions (replica set
 *    / Atlas), the whole cascade runs inside one transaction and rolls back fully
 *    on any error.
 *  - When it does not (standalone mongod — no transactions exist anywhere else in
 *    this codebase), we fall back to a sequential cascade that deletes the account
 *    document LAST. A mid-cascade failure therefore leaves the account intact and
 *    the operation safely retryable, rather than half-deleted.
 *
 * NOTE on shared Orders for vendors: an Order belongs to a buyer and may contain
 * items from multiple vendors. Deleting it because one vendor is removed would
 * destroy unrelated buyers' / vendors' data, so vendor deletion PRESERVES Order
 * documents. Buyer-owned Orders are deleted with the buyer (user deletion).
 */

const isTxnUnsupported = (err) => {
    if (!err) return false;
    const msg = String(err.message || '');
    return (
        err.code === 20 ||
        err.codeName === 'IllegalOperation' ||
        /Transaction numbers are only allowed/i.test(msg) ||
        /replica set/i.test(msg) ||
        /Transactions are not supported/i.test(msg) ||
        /not supported.*transaction/i.test(msg)
    );
};

let transactionSupportCache;

const checkTransactionSupport = async () => {
    if (transactionSupportCache !== undefined) return transactionSupportCache;

    try {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        transactionSupportCache = Boolean(hello.setName || hello.msg === 'isdbgrid');
    } catch (_) {
        // If the capability check fails, keep the original attempt-and-fallback path.
        transactionSupportCache = null;
    }

    return transactionSupportCache;
};

// Run a unit of work transactionally when possible, else fall back without a session.
const runAtomic = async (work) => {
    const supportsTransactions = await checkTransactionSupport();
    if (supportsTransactions === false) {
        return await work(null);
    }

    let session;
    try {
        session = await mongoose.startSession();
        let result;
        await session.withTransaction(async () => {
            result = await work(session);
        });
        return result;
    } catch (err) {
        if (isTxnUnsupported(err)) {
            return await work(null);
        }
        throw err;
    } finally {
        if (session) {
            try { await session.endSession(); } catch (_) { /* ignore */ }
        }
    }
};

const opts = (session) => (session ? { session } : {});

const toId = (value) => new mongoose.Types.ObjectId(value);

/* ----------------------------- USER ----------------------------- */

const getUserDeleteImpact = async (userId) => {
    const user = await User.findById(userId).select('-password').lean();
    if (!user) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
    }

    const id = toId(userId);
    const [orders, payments, returns, refunds, tickets, couponUsages, walletAccount, walletRows, loyaltyRows] =
        await Promise.all([
            Order.countDocuments({ user_id: id }),
            OrderPayment.countDocuments({ user_id: id }),
            ReturnRequest.countDocuments({ user_id: id }),
            Refund.countDocuments({ user_id: id }),
            Ticket.countDocuments({ authorId: id, authorRole: 'user' }),
            Coupon.countDocuments({ 'usage_by_user.user_id': id }),
            WalletAccount.findOne({ user_id: id }).lean(),
            WalletTransaction.countDocuments({ user_id: id }),
            LoyaltyTransaction.countDocuments({ user_id: id }),
        ]);

    // Money still sitting in the wallet. Reported separately from the record
    // counts because it is not a record to be tidied away — it is a debt, and
    // deleting the account would destroy both the balance and the only evidence
    // of it. `blockers` is what stops the delete going through.
    const walletBalance = toMajorAmount(walletAccount?.available_minor || 0);
    const walletHeld = toMajorAmount(walletAccount?.reserved_minor || 0);
    const outstanding = Number((walletBalance + walletHeld).toFixed(2));

    const blockers = [];
    if (outstanding > 0) {
        blockers.push({
            key: 'wallet_balance_outstanding',
            amount: outstanding,
            currency: walletAccount?.currency || 'EGP',
        });
    }

    return {
        account: {
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
        },
        // Order matters: shown to the admin as the impact preview.
        related: [
            { key: 'orders', count: orders },
            { key: 'payments', count: payments },
            { key: 'return_requests', count: returns },
            { key: 'refunds', count: refunds },
            { key: 'support_tickets', count: tickets },
            { key: 'saved_addresses', count: (user.addresses || []).length },
            { key: 'saved_vehicles', count: (user.cars || []).length },
            { key: 'coupon_usage_records', count: couponUsages },
            { key: 'wallet_transactions', count: walletRows },
            { key: 'loyalty_transactions', count: loyaltyRows },
        ],
        wallet: {
            balance: walletBalance,
            held: walletHeld,
            currency: walletAccount?.currency || 'EGP',
        },
        // Non-empty means the delete will be refused until an admin settles it.
        blockers,
    };
};

const hardDeleteUser = async (userId, actor) => {
    const impact = await getUserDeleteImpact(userId); // throws 404 if missing
    const id = toId(userId);

    // ---- Never delete an account that still holds money ----
    //
    // A hard delete is irreversible and takes the wallet ledger with it, so a
    // customer with credit would lose both the balance and the record proving
    // they ever had it. Refusing is the only safe default: the admin must first
    // zero the wallet through the ordinary adjustment flow, which forces a
    // stated reason and leaves an audit trail explaining where the money went.
    if (impact.blockers.length > 0) {
        const outstanding = impact.blockers[0];
        const err = new Error(
            `This customer still holds ${outstanding.currency} ${outstanding.amount.toFixed(2)} in their wallet. ` +
            'Settle the balance from Customer Wallets before deleting the account.'
        );
        err.status = 409;
        err.code = 'WALLET_BALANCE_OUTSTANDING';
        err.blockers = impact.blockers;
        throw err;
    }

    await runAtomic(async (session) => {
        // Related records first; account document last.
        await Order.deleteMany({ user_id: id }, opts(session));
        await OrderPayment.deleteMany({ user_id: id }, opts(session));
        await ReturnRequest.deleteMany({ user_id: id }, opts(session));
        await Refund.deleteMany({ user_id: id }, opts(session));
        await Ticket.deleteMany({ authorId: id, authorRole: 'user' }, opts(session));
        // Wallet and loyalty records. Safe to remove only because the balance
        // check above proved there is nothing left owed; without that guard
        // this line would be destroying evidence of a debt. Left behind, they
        // would be orphans pointing at a user id that no longer resolves.
        await WalletTransaction.deleteMany({ user_id: id }, opts(session));
        await WalletTopup.deleteMany({ user_id: id }, opts(session));
        await WalletAccount.deleteOne({ user_id: id }, opts(session));
        await LoyaltyTransaction.deleteMany({ user_id: id }, opts(session));
        await LoyaltyAccount.deleteOne({ user_id: id }, opts(session));
        // Detach the user's usage entries from any coupons (don't delete the coupon).
        await Coupon.updateMany(
            { 'usage_by_user.user_id': id },
            { $pull: { usage_by_user: { user_id: id } } },
            opts(session)
        );
        // Account document last → a failure above leaves the account retryable.
        await User.deleteOne({ _id: id }, opts(session));
    });

    await recordAuditLog({
        action: 'hard_delete_user',
        actor: actor || { role: 'admin', label: 'Admin' },
        target_type: 'user',
        target_id: id,
        target_snapshot: impact.account,
        impact: impact.related.reduce((acc, r) => { acc[r.key] = r.count; return acc; }, {}),
    });

    return impact;
};

/* ----------------------------- VENDOR ----------------------------- */

const getVendorDeleteImpact = async (vendorId) => {
    const vendor = await Seller.findById(vendorId).select('-password').lean();
    if (!vendor) {
        const err = new Error('Vendor not found');
        err.status = 404;
        throw err;
    }

    const id = toId(vendorId);
    const [
        products, ads, earnings, subscriptions, subPayments,
        withdrawals, refunds, returns, notifications, pickups,
        tickets, orderItems, coupons, shippingPolicies,
    ] = await Promise.all([
        Product.countDocuments({ vendor_id: id }),
        AdRequest.countDocuments({ vendor_id: id }),
        VendorEarning.countDocuments({ vendor_id: id }),
        VendorSubscription.countDocuments({ vendor_id: id }),
        SubscriptionPayment.countDocuments({ vendor_id: id }),
        WithdrawalRequest.countDocuments({ vendor_id: id }),
        Refund.countDocuments({ vendor_id: id }),
        ReturnRequest.countDocuments({ vendor_id: id }),
        Notification.countDocuments({ vendor_id: id }),
        BostaPickup.countDocuments({ vendor_id: id }),
        Ticket.countDocuments({ authorId: id, authorRole: 'vendor' }),
        Order.countDocuments({ 'items.vendor_id': id }),
        Coupon.countDocuments({ vendor_ids: id }),
        ShippingPolicy.countDocuments({ 'applies_to.vendor_ids': id }),
    ]);

    return {
        account: {
            _id: vendor._id,
            name: vendor.name,
            store_name: vendor.store_name,
            store_username: vendor.store_username,
            email: vendor.email,
            phone: vendor.phone,
            status: vendor.status,
        },
        related: [
            { key: 'products', count: products },
            { key: 'ad_requests', count: ads },
            { key: 'earnings', count: earnings },
            { key: 'subscriptions', count: subscriptions },
            { key: 'subscription_payments', count: subPayments },
            { key: 'withdrawal_requests', count: withdrawals },
            { key: 'refunds', count: refunds },
            { key: 'return_requests', count: returns },
            { key: 'notifications', count: notifications },
            { key: 'bosta_pickups', count: pickups },
            { key: 'support_tickets', count: tickets },
            { key: 'coupon_links', count: coupons },
            { key: 'shipping_policy_links', count: shippingPolicies },
            // Preserved — informational only.
            { key: 'orders_with_their_items', count: orderItems, preserved: true },
        ],
    };
};

const hardDeleteVendor = async (vendorId, actor) => {
    const vendor = await Seller.findById(vendorId).select('-password').lean();
    if (!vendor) {
        const err = new Error('Vendor not found');
        err.status = 404;
        throw err;
    }
    // Gate: vendor must be suspended (soft-deleted) before a permanent delete.
    if (vendor.status !== 'suspended') {
        const err = new Error('Vendor must be suspended before it can be permanently deleted');
        err.status = 409;
        throw err;
    }

    const impact = await getVendorDeleteImpact(vendorId);
    const id = toId(vendorId);

    await runAtomic(async (session) => {
        await Product.deleteMany({ vendor_id: id }, opts(session));
        await AdRequest.deleteMany({ vendor_id: id }, opts(session));
        await VendorEarning.deleteMany({ vendor_id: id }, opts(session));
        await VendorSubscription.deleteMany({ vendor_id: id }, opts(session));
        await SubscriptionPayment.deleteMany({ vendor_id: id }, opts(session));
        await WithdrawalRequest.deleteMany({ vendor_id: id }, opts(session));
        await Refund.deleteMany({ vendor_id: id }, opts(session));
        await ReturnRequest.deleteMany({ vendor_id: id }, opts(session));
        await Notification.deleteMany({ vendor_id: id }, opts(session));
        await BostaPickup.deleteMany({ vendor_id: id }, opts(session));
        await Ticket.deleteMany({ authorId: id, authorRole: 'vendor' }, opts(session));
        // Detach the vendor from array-based references (don't delete those docs).
        await Coupon.updateMany({ vendor_ids: id }, { $pull: { vendor_ids: id } }, opts(session));
        await ShippingPolicy.updateMany(
            { 'applies_to.vendor_ids': id },
            { $pull: { 'applies_to.vendor_ids': id } },
            opts(session)
        );
        // Account document last.
        await Seller.deleteOne({ _id: id }, opts(session));
    });

    await recordAuditLog({
        action: 'hard_delete_vendor',
        actor: actor || { role: 'admin', label: 'Admin' },
        target_type: 'vendor',
        target_id: id,
        target_snapshot: impact.account,
        impact: impact.related.reduce((acc, r) => { acc[r.key] = r.count; return acc; }, {}),
    });

    return impact;
};

module.exports = {
    getUserDeleteImpact,
    hardDeleteUser,
    getVendorDeleteImpact,
    hardDeleteVendor,
};
