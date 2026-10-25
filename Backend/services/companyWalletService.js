const mongoose = require('mongoose');
const { Company } = require('../models/companies');
const { CompanyWalletTransaction: Journal } = require('../models/companyWalletTransactions');

const error = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
// Two kinds of company wallet, both topped up online and charged per order, neither
// ever invoiced:
//   wallet         prepaid — it spends what was topped up, and stops at zero.
//   credit_wallet  the same wallet with a credit line under it — it may spend down to
//                  `monthly_cap` BELOW zero, and tops up to pay that back. There is no due
//                  date: the line is the only brake, and it is the total owed, not a
//                  figure that renews each month.
// 'monthly' is the third way a company pays — on a monthly invoice — and has no wallet.
//
// The admin can move a company from one to another. The mode decides how NEW orders are
// paid; what is already booked finishes the way it started. So a company on an invoice can
// still hold a balance — the return of an order it placed on its wallet, or what was left
// in it — and that balance (in its favour or owed) goes on its next invoice (`sweep`).
const WALLET_MODES = ['wallet', 'credit_wallet'];
const isWalletMode = (mode) => WALLET_MODES.includes(mode);
const isWallet = (company) => isWalletMode(company?.billing_mode);
const toMinor = (amount) => Math.round(Number(amount) * 100);
const balance = (company) => Number((Number(company?.wallet_balance_minor || 0) / 100).toFixed(2));
// How far below zero the wallet may be taken by an order. Nothing, on a prepaid wallet.
const creditLine = (company) => company?.billing_mode === 'credit_wallet' ? Number(company.monthly_cap || 0) : 0;
// What the company owes: the credit it has used, or — on a prepaid wallet — a charge it
// could not refuse that took the balance below zero.
const owed = (company) => Math.max(0, -balance(company));
// What the company can still spend: the balance plus whatever is left of its credit line
// on a wallet; the monthly cap on an invoice.
const creditLimit = (company) => isWallet(company)
    ? Number((balance(company) + creditLine(company)).toFixed(2))
    : Number(company?.monthly_cap || 0);
const budgetScope = new (require('node:async_hooks').AsyncLocalStorage)();

// Two employees checking out together, or a refund landing while the manager edits a
// limit, is normal traffic, not an error: wait for the other holder before giving up.
const LOCK_WAIT_MS = 10000;
const LOCK_POLL_MS = 150;
const LOCK_STALE_MS = 300000;

async function withBudgetLock(companyId, work) {
    if (budgetScope.getStore() === String(companyId)) return work();
    const company = await Company.findById(companyId).select('billing_mode').lean();
    if (!isWallet(company)) return work();
    const token = require('node:crypto').randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
        const lock = await Company.updateOne({ _id: companyId, $or: [
            { wallet_budget_lock: null }, { 'wallet_budget_lock.at': { $lt: new Date(Date.now() - LOCK_STALE_MS) } },
        ] }, { $set: { wallet_budget_lock: { token, at: new Date() } } });
        if (lock.modifiedCount) break;
        if (Date.now() >= deadline) throw error('COMPANY_WALLET_BUSY', 'Another company budget operation is in progress. Please retry.');
        await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
    try { return await budgetScope.run(String(companyId), work); }
    finally { await Company.updateOne({ _id: companyId, 'wallet_budget_lock.token': token }, { $set: { wallet_budget_lock: null } }); }
}

async function allocationBudget(company, { replacements = [], additional = [], excludeInvitationId = null } = {}) {
    const { CompanyMembership, CompanyInvitation } = require('../models/companies');
    const { effectiveLimit, monthKey, monthSpendByUser } = require('./companyService');
    const members = await CompanyMembership.find({ company_id: company._id, status: 'active', is_employee: true }).lean();
    const byId = new Map(members.map((m) => [String(m._id), m]));
    for (const m of replacements) byId.set(String(m._id), m);
    const invitations = await CompanyInvitation.find({ company_id: company._id, role: 'employee', status: 'pending', expires_at: { $gt: new Date() } }).lean();
    const active = [...byId.values()].filter((m) => m.is_employee && m.status === 'active' && !m.deactivated_at);
    const spent = await monthSpendByUser(company._id, active.map((m) => m.user_id), monthKey());
    // With employee limits off nothing is promised per person (null): the wallet itself is
    // the only bound, checked when an order is placed.
    const remainingMinor = active.reduce((sum, m) => sum + Math.max(0, toMinor(effectiveLimit(company, m).limit ?? 0) - toMinor(spent.get(String(m.user_id)) || 0)), 0);
    const pending = invitations.filter((i) => String(i._id) !== String(excludeInvitationId));
    const reservedMinor = [...pending, ...additional].reduce((sum, m) => sum + toMinor(effectiveLimit(company, { ...m, is_employee: true }).limit ?? 0), 0);
    const allocated = (remainingMinor + reservedMinor) / 100;
    const spendable = creditLimit(company);
    return { allocated, available_to_allocate: Math.max(0, spendable - allocated), shortfall: Math.max(0, allocated - spendable) };
}

/** Refuses a change only when it ADDS to what is promised beyond the balance. Limits
 * renew each month while the balance does not, so a company can already be over
 * after the 1st; lowering a limit, pausing an employee or accepting an invitation
 * (which swaps its reservation for a membership) must still go through then. */
async function assertAllocationsFit(company, changes = {}) {
    if (!isWallet(company)) return;
    // `company` may carry the unsaved change (a group limit, the default limit);
    // the stored copy is the "before" and holds the current balance.
    const stored = await Company.findById(company._id).lean();
    const after = await allocationBudget({ ...(company.toObject?.() || company), wallet_balance_minor: stored?.wallet_balance_minor || 0 }, changes);
    if (after.shortfall <= 0.005) return;
    const before = await allocationBudget(stored);
    if (after.allocated <= before.allocated + 0.005) return;
    throw error('COMPANY_ALLOCATION_EXCEEDED', `Employee limits exceed the company wallet balance by ${after.shortfall.toFixed(2)} EGP. Top up the wallet or reduce the limits.`);
}

async function flushPending(company) {
    const entry = company?.wallet_pending_entry;
    if (!entry) return;
    await Journal.updateOne({ company_id: company._id, idempotency_key: entry.idempotency_key },
        { $setOnInsert: entry }, { upsert: true });
    await Company.updateOne({ _id: company._id, 'wallet_pending_entry._id': entry._id },
        { $set: { wallet_pending_entry: null } });
}

/** The balance and its durable receipt move in ONE Mongo write, including on standalone
 * Mongo. Before another movement, finish copying that receipt to the history collection.
 * A crash on either side of the copy is recoverable and cannot duplicate money. */
async function move({ companyId, deltaMinor, key, kind, orderId = null, topupId = null, reason = '', allowInactive = false, allowNegative = false, settling = false }) {
    if (!Number.isSafeInteger(deltaMinor) || !deltaMinor || !key) throw error('INVALID_AMOUNT', 'Invalid company wallet amount', 400);
    await Journal.init();
    for (let attempt = 0; attempt < 20; attempt++) {
        const company = await Company.findById(companyId).lean();
        if (!company) throw error('COMPANY_NOT_FOUND', 'Company not found', 404);
        // `settling`: money that follows something already done on the wallet — an order
        // placed on it, a top-up already paid — and so still lands after the company moved
        // to an invoice. It is never refused for the balance: what it leaves is invoiced.
        if (!isWallet(company) && !settling) throw error('COMPANY_NOT_WALLET', 'This company pays by monthly invoice', 400);
        if (!isWallet(company)) allowNegative = true;
        if (company.wallet_pending_entry) { await flushPending(company); continue; }
        const existing = await Journal.findOne({ company_id: companyId, idempotency_key: key }).lean();
        if (existing) {
            if (existing.delta_minor !== deltaMinor) throw error('WALLET_KEY_CONFLICT', 'This wallet operation was already recorded with a different amount');
            return { transaction: existing, duplicate: true };
        }
        if (deltaMinor < 0 && !allowInactive && company.status !== 'active') throw error('COMPANY_SUSPENDED', 'Ordering on this company account is paused');
        if (!Number.isSafeInteger(Number(company.wallet_balance_minor || 0) + deltaMinor)) throw error('INVALID_AMOUNT', 'Company wallet amount is too large', 400);
        // The floor a debit may not cross: zero, or the end of the credit line. Money
        // coming IN is never refused — a top-up that pays back only part of what is
        // owed still has to land.
        const floorMinor = -toMinor(creditLine(company));
        if (deltaMinor < 0 && !allowNegative && Number(company.wallet_balance_minor || 0) + deltaMinor < floorMinor) throw error('COMPANY_WALLET_INSUFFICIENT', 'The company wallet balance is not enough. Top up the company wallet first.');
        const entry = {
            _id: new mongoose.Types.ObjectId(), company_id: company._id, idempotency_key: key,
            kind, delta_minor: deltaMinor, balance_after_minor: Number(company.wallet_balance_minor || 0) + deltaMinor,
            order_id: orderId, topup_id: topupId, reason, created_at: new Date(),
        };
        const updated = await Company.findOneAndUpdate({
            _id: company._id, billing_mode: company.billing_mode, wallet_version: company.wallet_version ?? 0,
            wallet_pending_entry: null,
            // The line is re-read with the balance: an admin lowering it mid-checkout
            // must not leave this debit measured against the old one.
            ...(deltaMinor < 0 && !allowNegative ? { wallet_balance_minor: { $gte: floorMinor - deltaMinor }, monthly_cap: company.monthly_cap } : {}),
            ...(deltaMinor < 0 && !allowInactive ? { status: 'active' } : {}),
        }, {
            $inc: { wallet_balance_minor: deltaMinor, wallet_version: 1 },
            $set: { wallet_pending_entry: entry, updated_at: new Date() },
        }, { returnDocument: 'after' }).lean();
        if (!updated) continue;
        // The balance already moved with a durable receipt. Archiving failure must
        // not report an unapplied debit; the next operation recovers the receipt.
        await flushPending(updated).catch((err) => console.error(`[Company wallet] Pending journal receipt: ${err.message}`));
        return { transaction: entry, duplicate: false };
    }
    throw error('COMPANY_WALLET_BUSY', 'Company wallet is busy. Please retry.');
}

const invoiceSweepKey = (invoiceId) => `invoice:${invoiceId}:wallet-balance`;

/**
 * Empty the wallet of a company that is on an invoice now, onto that invoice: returns the
 * balance taken — above zero in the company's favour, below zero what it owed. Safe to
 * repeat for the same invoice: the second call reports what the first one took.
 */
async function sweep(companyId, invoiceId) {
    const key = invoiceSweepKey(invoiceId);
    const company = await Company.findById(companyId).lean();
    if (!company) return 0;
    await flushPending(company);
    const done = await Journal.findOne({ company_id: companyId, idempotency_key: key }).lean();
    if (done) return -done.delta_minor / 100;
    const balanceMinor = Number(company.wallet_balance_minor || 0);
    if (isWallet(company) || !balanceMinor) return 0;
    const { transaction } = await move({ companyId, deltaMinor: -balanceMinor, key, kind: 'invoice', reason: 'Wallet balance moved to the invoice', allowInactive: true, settling: true });
    return -transaction.delta_minor / 100;
}

async function overview(companyId, { page = 1 } = {}) {
    const company = await Company.findById(companyId).lean();
    if (!company) throw error('COMPANY_NOT_FOUND', 'Company not found', 404);
    await flushPending(company);
    const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const [transactions, total] = await Promise.all([
        Journal.find({ company_id: companyId }).sort({ created_at: -1, _id: -1 }).skip((currentPage - 1) * 30).limit(30).lean(),
        Journal.countDocuments({ company_id: companyId }),
    ]);
    return {
        company: { _id: company._id, name: company.name, org_type: company.org_type || 'company', billing_mode: company.billing_mode || 'monthly', status: company.status },
        balance: balance(company), owed: owed(company), credit_limit: creditLimit(company), credit_line: creditLine(company), currency: 'EGP',
        ...(isWallet(company) ? await allocationBudget(company) : {}),
        transactions: transactions.map((t) => ({ _id: t._id, kind: t.kind, amount: t.delta_minor / 100, balance_after: t.balance_after_minor / 100, order_id: t.order_id, reason: t.reason, created_at: t.created_at })),
        pagination: { page: currentPage, pages: Math.max(1, Math.ceil(total / 30)), total },
    };
}

module.exports = { WALLET_MODES, isWallet, isWalletMode, balance, owed, creditLine, creditLimit, toMinor, move, sweep, overview, flushPending, withBudgetLock, allocationBudget, assertAllocationsFit };
