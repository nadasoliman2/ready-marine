// Isolated temporary standalone MongoDB. Never reads the application's DB URI.
// Requires mongod on PATH, or TEST_MONGOD_BINARY pointing to its executable.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const net = require('node:net');
const mongoose = require('mongoose');
const { Company, CompanyMembership, CompanyInvitation } = require('../models/companies');
const { CompanyWalletTransaction: Journal } = require('../models/companyWalletTransactions');
const { CompanySpendCounter, CompanyLedgerEntry } = require('../models/companyLedger');
const { WalletTopup } = require('../models/walletTopups');
const { CompanyInvoice } = require('../models/companyInvoices');
const wallet = require('../services/companyWalletService');
const companyService = require('../services/companyService');
const orders = require('../services/companyOrderService');
const invoices = require('../services/companyInvoiceService');
const topups = require('../services/walletTopupService');
const id = () => new mongoose.Types.ObjectId();
let mongo, directory;
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'readymarine-company-wallet-test-'));
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    mongo = spawn(process.env.TEST_MONGOD_BINARY || 'mongod', ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', String(port), '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Temporary MongoDB startup timed out')), 15000);
        const finish = (err) => { clearTimeout(timeout); err ? reject(err) : resolve(); };
        mongo.once('error', finish);
        mongo.once('exit', (code) => finish(new Error(`MongoDB exited: ${code}`)));
        mongo.stdout.on('data', (chunk) => { if (String(chunk).includes('Waiting for connections')) finish(); });
        mongo.stderr.resume();
    });
    await mongoose.connect(`mongodb://127.0.0.1:${port}/company_wallet_tests`);
    await Promise.all([Company, CompanyMembership, CompanyInvitation, Journal, CompanySpendCounter, CompanyLedgerEntry, WalletTopup, CompanyInvoice].map((model) => model.init()));
});
after(async () => {
    await mongoose.disconnect();
    if (mongo && mongo.exitCode === null) {
        const stopped = new Promise((resolve) => mongo.once('exit', resolve));
        mongo.kill('SIGTERM');
        await stopped;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
});
const createCompany = (extra = {}) => Company.create({ name: 'Wallet integration test', monthly_cap: 0, billing_mode: 'wallet', ...extra });
const move = (company, amount, key = String(id()), kind = amount > 0 ? 'topup' : 'purchase') => wallet.move({ companyId: company._id, deltaMinor: amount, key, kind });
const freshBalance = async (company) => wallet.balance(await Company.findById(company._id).lean());
const ctxFor = async (company, limit = 100) => ({ company, beneficiary: 'employee', membership: await CompanyMembership.create({ company_id: company._id, user_id: id(), is_employee: true, limit_override: limit }) });
const orderFor = (ctx, orderId, amount, month = companyService.monthKey()) => ({ _id: orderId, user_id: ctx.membership.user_id, total_price: amount, company: { company_id: ctx.company._id, billing_mode: 'wallet', beneficiary: 'employee', company_amount: amount, personal_amount: 0, month } });

test('legacy companies remain monthly and new wallets start at zero', async () => {
    const monthly = await Company.create({ name: 'Monthly', monthly_cap: 200 });
    assert.equal(monthly.billing_mode, 'monthly');
    assert.equal(wallet.creditLimit(monthly), 200);
    assert.equal(wallet.creditLimit(await createCompany()), 0);
    await assert.rejects(move(monthly, 100), { code: 'COMPANY_NOT_WALLET' });
});
test('simultaneous confirmations credit a top-up only once', async () => {
    const company = await createCompany();
    const topup = await WalletTopup.create({ company_id: company._id, user_id: id(), amount_minor: 10000 });
    const copies = await Promise.all([WalletTopup.findById(topup._id), WalletTopup.findById(topup._id)]);
    await Promise.all(copies.map((t) => topups.creditPaidTopup(t)));
    assert.equal(await freshBalance(company), 100);
    assert.equal(await Journal.countDocuments({ company_id: company._id }), 1);
    const saved = await WalletTopup.findById(topup._id);
    assert.ok(saved.company_wallet_transaction_id);
    assert.equal(saved.wallet_transaction_id, null);
});
test('company top-ups cannot be confirmed through personal wallet endpoints', async () => {
    const company = await createCompany();
    const userId = id();
    const topup = await WalletTopup.create({ company_id: company._id, user_id: userId, amount_minor: 500 });
    await assert.rejects(topups.confirmTopup({ userId, topupId: topup._id }), { code: 'TOPUP_NOT_FOUND' });
    assert.equal(await freshBalance(company), 0);
});
test('concurrent purchases cannot spend the same remaining balance', async () => {
    const company = await createCompany({ wallet_balance_minor: 10000 });
    const results = await Promise.allSettled([move(company, -7000), move(company, -7000)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'COMPANY_WALLET_INSUFFICIENT');
    assert.equal(await freshBalance(company), 30);
});
test('same debit key never charges twice, and amount changes are rejected', async () => {
    const company = await createCompany({ wallet_balance_minor: 10000 });
    await Promise.all([move(company, -2000, 'purchase'), move(company, -2000, 'purchase')]);
    assert.equal(await freshBalance(company), 80);
    await assert.rejects(move(company, -3000, 'purchase'), { code: 'WALLET_KEY_CONFLICT' });
});
test('durable receipt recovers after a process stopped before archiving', async () => {
    const company = await createCompany({ wallet_balance_minor: 2500, wallet_version: 1 });
    const receipt = { _id: id(), company_id: company._id, idempotency_key: 'paid', kind: 'topup', delta_minor: 2500, balance_after_minor: 2500, created_at: new Date() };
    await Company.updateOne({ _id: company._id }, { $set: { wallet_pending_entry: receipt } });
    assert.equal((await move(company, 2500, 'paid')).duplicate, true);
    assert.equal(await freshBalance(company), 25);
    assert.equal((await Company.findById(company._id)).wallet_pending_entry, null);
});
test('employee limit failure refunds the reservation and clears counters', async () => {
    const company = await createCompany({ wallet_balance_minor: 10000 });
    const ctx = await ctxFor(company, 20);
    await assert.rejects(orders.reserveSpend({ ctx, month: companyService.monthKey(), amount: 30, orderId: id() }), { code: 'COMPANY_LIMIT_CHANGED' });
    assert.equal(await freshBalance(company), 100);
    assert.ok((await CompanySpendCounter.find({ company_id: company._id })).every((c) => c.amount === 0));
});
test('recording a placed order does not charge again; refunds go to company once', async () => {
    const company = await createCompany({ wallet_balance_minor: 10000 });
    const ctx = await ctxFor(company);
    const orderId = id();
    await orders.reserveSpend({ ctx, month: companyService.monthKey(), amount: 60, orderId });
    const order = orderFor(ctx, orderId, 60);
    await orders.recordCharge(order);
    await orders.recordCharge(order);
    assert.equal(await freshBalance(company), 40);
    await orders.refundShare({ order, amount: 20, key: 'cancel-one' });
    await orders.refundShare({ order, amount: 20, key: 'cancel-one' });
    assert.equal(await freshBalance(company), 60);
    const standing = await orders.standing(ctx);
    assert.equal(standing.spent, 40);
    assert.equal(standing.remaining_cap, 60);
    assert.equal(standing.remaining, 60);
});
test('wallet balance does not reset or have monthly spend subtracted twice', async () => {
    const company = await createCompany({ wallet_balance_minor: 5000 });
    const ctx = await ctxFor(company, 200);
    await CompanySpendCounter.create({ company_id: company._id, month: '2026-01', scope: 'company', amount: 150 });
    assert.equal((await orders.standing(ctx, '2026-01')).remaining_cap, 50);
    assert.equal((await orders.standing(ctx, '2026-02')).remaining_cap, 50);
});
test('remaining employee and invitation allocations must fit actual balance', async () => {
    const company = await createCompany({ wallet_balance_minor: 10000, default_limit: 20 });
    const ctx = await ctxFor(company, 100);
    await CompanySpendCounter.create({ company_id: company._id, month: companyService.monthKey(), scope: 'user', user_id: ctx.membership.user_id, amount: 40 });
    const invite = await CompanyInvitation.create({ company_id: company._id, role: 'employee', token_hash: 'test', invited_by: { kind: 'admin' }, expires_at: new Date(Date.now() + 86400000) });
    const budget = await wallet.allocationBudget(company);
    assert.equal(budget.allocated, 80);
    assert.equal(budget.available_to_allocate, 20);
    await wallet.assertAllocationsFit(company);
    await assert.rejects(wallet.assertAllocationsFit(company, { additional: [{ limit_override: 30 }] }), { code: 'COMPANY_ALLOCATION_EXCEEDED' });
    await wallet.assertAllocationsFit(company, { excludeInvitationId: invite._id, replacements: [{ _id: id(), user_id: id(), is_employee: true, status: 'active' }] });
});
test('company budget lock allows nesting and rejects a competing owner', async () => {
    const company = await createCompany();
    await wallet.withBudgetLock(company._id, async () => {
        await wallet.withBudgetLock(company._id, async () => {});
        const lock = await Company.updateOne({ _id: company._id, wallet_budget_lock: null }, { $set: { wallet_budget_lock: { token: 'other' } } });
        assert.equal(lock.modifiedCount, 0);
    });
    assert.equal((await Company.findById(company._id)).wallet_budget_lock, null);
});
test('wallet orders are excluded from invoices and company receivables', async () => {
    const company = await createCompany({ wallet_balance_minor: 10000 });
    const ctx = await ctxFor(company);
    const orderId = id();
    await orders.reserveSpend({ ctx, month: '2025-01', amount: 50, orderId });
    await orders.recordCharge(orderFor(ctx, orderId, 50, '2025-01'));
    const result = await invoices.issueInvoice(company._id, '2025-01', { force: true });
    assert.equal(result.reason, 'no_activity');
    assert.equal(result.invoice, null);
    assert.equal((await invoices.receivables()).not_yet_invoiced, 0);
    assert.equal((await invoices.issueDueInvoices()).issued, 0);
});
test('ended accounts accept returns and settle the actual remaining balance', async () => {
    const company = await createCompany({ wallet_balance_minor: 10000, status: 'ended' });
    await assert.rejects(move(company, -100), { code: 'COMPANY_SUSPENDED' });
    await move(company, 500, 'return-after-close', 'refund');
    const settlement = await invoices.settleEndedCompany(company._id);
    assert.equal(settlement.refund_due, 105);
    assert.equal(settlement.outstanding, 0);
    const paid = await invoices.recordRefund(company._id, { amount: 25, reference: 'bank-001' }, { label: 'Test' });
    assert.equal(paid.refund_due, 80);
    assert.equal(paid.refunded, 25);
    await invoices.recordRefund(company._id, { amount: 25, reference: 'bank-001' }, { label: 'Test' });
    assert.equal(await freshBalance(company), 80);
});
test('invalid amounts and another company balance cannot be spent', async () => {
    const funded = await createCompany({ wallet_balance_minor: 10000 });
    await assert.rejects(move(await createCompany(), -1), { code: 'COMPANY_WALLET_INSUFFICIENT' });
    await assert.rejects(move(funded, 1.5), { code: 'INVALID_AMOUNT' });
    await assert.rejects(move(funded, Number.MAX_SAFE_INTEGER), { code: 'INVALID_AMOUNT' });
    assert.equal(await freshBalance(funded), 100);
});
test('a second budget operation waits for the first instead of failing', async () => {
    const company = await createCompany();
    const order = [];
    await Promise.all([
        wallet.withBudgetLock(company._id, async () => { await new Promise((r) => setTimeout(r, 400)); order.push('first'); }),
        new Promise((r) => setTimeout(r, 50)).then(() => wallet.withBudgetLock(company._id, async () => { order.push('second'); })),
    ]);
    assert.deepEqual(order, ['first', 'second']);
});
test('over-allocated after the month renews: lowering is allowed, raising is not', async () => {
    const company = await createCompany({ wallet_balance_minor: 5000, default_limit: 0 });
    const a = await CompanyMembership.create({ company_id: company._id, user_id: id(), is_employee: true, limit_override: 40 });
    await CompanyMembership.create({ company_id: company._id, user_id: id(), is_employee: true, limit_override: 40 });
    assert.equal((await wallet.allocationBudget(company)).shortfall, 30);
    a.limit_override = 30;
    await wallet.assertAllocationsFit(company, { replacements: [a] });
    a.deactivated_at = new Date();
    await wallet.assertAllocationsFit(company, { replacements: [a] });
    a.deactivated_at = null;
    a.limit_override = 50;
    await assert.rejects(wallet.assertAllocationsFit(company, { replacements: [a] }), { code: 'COMPANY_ALLOCATION_EXCEEDED' });
});
test('adjustments on a placed order still settle while the company is paused', async () => {
    const company = await createCompany({ wallet_balance_minor: 10000 });
    const ctx = await ctxFor(company);
    const orderId = id();
    await orders.reserveSpend({ ctx, month: companyService.monthKey(), amount: 50, orderId });
    const order = orderFor(ctx, orderId, 50);
    await orders.recordCharge(order);
    await Company.updateOne({ _id: company._id }, { $set: { status: 'suspended' } });
    await orders.absorbShippingDifference({ order, amount: 10, key: 'batch:gap' });
    assert.equal(await freshBalance(company), 40);
});
test('a shipping difference the wallet cannot cover leaves a debt the next top-up pays', async () => {
    const company = await createCompany({ wallet_balance_minor: 5000 });
    const ctx = await ctxFor(company);
    const orderId = id();
    await orders.reserveSpend({ ctx, month: companyService.monthKey(), amount: 50, orderId });
    const order = orderFor(ctx, orderId, 50);
    await orders.recordCharge(order);
    await orders.absorbShippingDifference({ order, amount: 15, key: 'batch:short' });
    await orders.absorbShippingDifference({ order, amount: 15, key: 'batch:short' });
    assert.equal(await freshBalance(company), -15);
    const view = await wallet.overview(company._id);
    assert.equal(view.owed, 15);
    assert.equal(view.available_to_allocate, 0);
    const where = await orders.standing({ ...ctx, company: await Company.findById(company._id).lean() });
    assert.ok(where.remaining <= 0);
    await assert.rejects(move(company, -1), { code: 'COMPANY_WALLET_INSUFFICIENT' });
    await move(company, 2000, 'topup-after-debt');
    assert.equal(await freshBalance(company), 5);
    // A negative balance must not break ordinary saves of the company document.
    await Company.updateOne({ _id: company._id }, { $set: { wallet_balance_minor: -500 } });
    const doc = await Company.findById(company._id);
    doc.name = 'Still saves';
    await doc.save();
});
test('an ended company with a debt shows it as outstanding, not as a refund', async () => {
    const company = await createCompany({ wallet_balance_minor: -1200, status: 'ended' });
    const settlement = await invoices.settleEndedCompany(company._id);
    assert.equal(settlement.outstanding, 12);
    assert.equal(settlement.refund_due, 0);
});

/* ---- A wallet with a credit line: spends below zero down to the line, never invoiced ---- */
const createCreditCompany = (line = 100, extra = {}) => createCompany({ billing_mode: 'credit_wallet', monthly_cap: line, ...extra });
const creditOrderFor = (ctx, orderId, amount, month = companyService.monthKey()) => ({ ...orderFor(ctx, orderId, amount, month), company: { ...orderFor(ctx, orderId, amount, month).company, billing_mode: 'credit_wallet' } });

test('a credit wallet spends below zero down to its line, and no further', async () => {
    const company = await createCreditCompany(100);
    assert.equal(wallet.isWallet(company), true);
    assert.equal(wallet.creditLimit(company), 100);
    await move(company, -7000);
    assert.equal(await freshBalance(company), -70);
    const after = await Company.findById(company._id).lean();
    assert.equal(wallet.owed(after), 70);
    assert.equal(wallet.creditLimit(after), 30);
    await assert.rejects(move(company, -4000), { code: 'COMPANY_WALLET_INSUFFICIENT' });
    await move(company, -3000);
    assert.equal(await freshBalance(company), -100);
    await assert.rejects(move(company, -1), { code: 'COMPANY_WALLET_INSUFFICIENT' });
});
test('a top-up that pays back only part of what is owed still lands', async () => {
    const company = await createCreditCompany(100, { wallet_balance_minor: -9000 });
    await move(company, 2000, 'part-payment');
    assert.equal(await freshBalance(company), -70);
    assert.equal(wallet.creditLimit(await Company.findById(company._id).lean()), 30);
    await move(company, 20000, 'more-than-owed');
    assert.equal(await freshBalance(company), 130);
    assert.equal(wallet.creditLimit(await Company.findById(company._id).lean()), 230);
});
test('concurrent purchases cannot both take the last of the credit line', async () => {
    const company = await createCreditCompany(100);
    const results = await Promise.allSettled([move(company, -7000), move(company, -7000)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'COMPANY_WALLET_INSUFFICIENT');
    assert.equal(await freshBalance(company), -70);
});
test('lowering the line below what is owed stops orders but not repayment', async () => {
    const company = await createCreditCompany(100, { wallet_balance_minor: -8000 });
    await Company.updateOne({ _id: company._id }, { $set: { monthly_cap: 50 } });
    const lowered = await Company.findById(company._id).lean();
    assert.equal(wallet.creditLimit(lowered), -30);
    await assert.rejects(move(company, -100), { code: 'COMPANY_WALLET_INSUFFICIENT' });
    await move(company, 1000, 'repay');
    assert.equal(await freshBalance(company), -70);
});
test('a credit wallet order is charged on credit, counted once, and never invoiced', async () => {
    const company = await createCreditCompany(100);
    const ctx = await ctxFor(company);
    assert.equal((await orders.standing(ctx)).remaining_cap, 100);
    const orderId = id();
    await orders.reserveSpend({ ctx, month: '2025-02', amount: 60, orderId });
    const order = creditOrderFor(ctx, orderId, 60, '2025-02');
    await orders.recordCharge(order);
    await orders.recordCharge(order);
    assert.equal(await freshBalance(company), -60);
    assert.equal((await CompanyLedgerEntry.findOne({ company_id: company._id })).billing_mode, 'credit_wallet');
    const where = await orders.standing({ ...ctx, company: await Company.findById(company._id).lean() }, '2025-02');
    assert.equal(where.remaining_cap, 40);
    await assert.rejects(orders.reserveSpend({ ctx, month: '2025-02', amount: 41, orderId: id() }), { code: 'COMPANY_WALLET_INSUFFICIENT' });
    assert.equal(await freshBalance(company), -60);
    await orders.refundShare({ order, amount: 20, key: 'credit-cancel' });
    assert.equal(await freshBalance(company), -40);
    const result = await invoices.issueInvoice(company._id, '2025-02', { force: true });
    assert.equal(result.reason, 'no_activity');
    assert.equal(result.invoice, null);
    assert.equal((await invoices.issueDueInvoices()).issued, 0);
});
test('a credit wallet takes online top-ups, and limits fit the balance plus the line', async () => {
    const company = await createCreditCompany(100, { default_limit: 20 });
    const topup = await WalletTopup.create({ company_id: company._id, user_id: id(), amount_minor: 5000 });
    await topups.creditPaidTopup(await WalletTopup.findById(topup._id));
    assert.equal(await freshBalance(company), 50);
    await ctxFor(company, 120);
    const fresh = await Company.findById(company._id).lean();
    const budget = await wallet.allocationBudget(fresh);
    assert.equal(budget.allocated, 120);
    assert.equal(budget.available_to_allocate, 30);
    await wallet.assertAllocationsFit(fresh);
    const view = await wallet.overview(company._id);
    assert.equal(view.credit_line, 100);
    assert.equal(view.credit_limit, 150);
});

/* ---- The admin moves a company to another way of paying ---- */
const changeMode = (company, patch) => companyService.updateCompanyByAdmin(company._id, patch, { label: 'Test' });
const monthlyOrderFor = (ctx, orderId, amount, month) => ({ ...orderFor(ctx, orderId, amount, month), company: { ...orderFor(ctx, orderId, amount, month).company, billing_mode: 'monthly' } });
const refreshed = async (ctx) => ({ ...ctx, company: await Company.findById(ctx.company._id).lean() });

test('an invoice company moved to a wallet still gets, and owes, the invoice of its earlier orders', async () => {
    const company = await Company.create({ name: 'Invoice to wallet', monthly_cap: 500 });
    const ctx = await ctxFor(company, 300);
    const orderId = id();
    await orders.reserveSpend({ ctx, month: '2025-03', amount: 80, orderId });
    const order = monthlyOrderFor(ctx, orderId, 80, '2025-03');
    await orders.recordCharge(order);

    const { company: after } = await changeMode(company, { billing_mode: 'wallet' });
    assert.equal(after.billing_mode, 'wallet');
    assert.equal(after.credit_line, 0);
    assert.equal(after.wallet_balance, 0);

    // A return of the invoiced order comes off its invoice, not into the wallet.
    await orders.refundShare({ order, amount: 30, key: 'invoice-to-wallet-return' });
    assert.equal(await freshBalance(company), 0);
    const { invoice } = await invoices.issueInvoice(company._id, '2025-03', { force: true, stage: 'final' });
    assert.equal(invoice.amount_due, 50);

    // New orders are paid from the wallet.
    const now = await refreshed(ctx);
    await assert.rejects(orders.reserveSpend({ ctx: now, month: companyService.monthKey(), amount: 10, orderId: id() }), { code: 'COMPANY_WALLET_INSUFFICIENT' });
    await move(company, 2000);
    await orders.reserveSpend({ ctx: now, month: companyService.monthKey(), amount: 10, orderId: id() });
    assert.equal(await freshBalance(company), 10);

    // The invoice is still collected: left unpaid past the grace period, ordering pauses.
    await invoices.runCollectionSweep(new Date(new Date(invoice.due_at).getTime() + 30 * 86400000));
    assert.equal((await Company.findById(company._id)).status, 'suspended');
});

test('a wallet company moved to an invoice: what is in the wallet comes off its next invoice', async () => {
    const company = await createCompany({ wallet_balance_minor: 10000 });
    const ctx = await ctxFor(company, 300);
    const walletOrderId = id();
    await orders.reserveSpend({ ctx, month: '2025-04', amount: 40, orderId: walletOrderId });
    const walletOrder = orderFor(ctx, walletOrderId, 40, '2025-04');
    await orders.recordCharge(walletOrder);
    assert.equal(await freshBalance(company), 60);

    // The monthly cap is a new figure: it has to come with the change.
    await assert.rejects(changeMode(company, { billing_mode: 'monthly' }), { code: 'INVALID_FIELD' });
    const { company: after } = await changeMode(company, { billing_mode: 'monthly', monthly_cap: 500 });
    assert.equal(after.billing_mode, 'monthly');
    assert.equal(after.wallet_balance, 60);
    assert.equal((await Company.findById(company._id)).wallet_budget_lock, null);

    // The order paid from the wallet is returned afterwards: back to the wallet.
    await orders.refundShare({ order: walletOrder, amount: 40, key: 'wallet-to-invoice-return' });
    assert.equal(await freshBalance(company), 100);
    await assert.rejects(move(company, -100), { code: 'COMPANY_NOT_WALLET' });

    // A new order goes on the invoice and leaves the wallet alone.
    const now = await refreshed(ctx);
    const orderId = id();
    await orders.reserveSpend({ ctx: now, month: '2025-04', amount: 150, orderId });
    await orders.recordCharge(monthlyOrderFor(now, orderId, 150, '2025-04'));
    assert.equal(await freshBalance(company), 100);

    const { invoice } = await invoices.issueInvoice(company._id, '2025-04', { force: true, stage: 'final' });
    assert.equal(invoice.totals.orders, 150);
    assert.equal(invoice.totals.wallet_balance, -100);
    assert.equal(invoice.amount_due, 50);
    assert.equal(await freshBalance(company), 0);
    // Issuing again finds the same invoice and takes nothing twice.
    assert.equal((await invoices.issueInvoice(company._id, '2025-04', { force: true, stage: 'final' })).created, false);
    assert.equal(await wallet.sweep(company._id, invoice._id), 100);
    assert.equal(await freshBalance(company), 0);
});

test('a credit wallet in debt moved to an invoice: the debt is invoiced even with no new order', async () => {
    const company = await createCreditCompany(100);
    const ctx = await ctxFor(company, 300);
    const orderId = id();
    await orders.reserveSpend({ ctx, month: '2025-05', amount: 60, orderId });
    await orders.recordCharge(creditOrderFor(ctx, orderId, 60, '2025-05'));
    assert.equal(await freshBalance(company), -60);

    await changeMode(company, { billing_mode: 'monthly', monthly_cap: 300 });
    const midMonth = new Date();
    midMonth.setDate(15);
    await invoices.issueDueInvoices(midMonth);
    const issued = await CompanyInvoice.find({ company_id: company._id }).lean();
    assert.equal(issued.length, 1);
    assert.equal(issued[0].totals.wallet_balance, 60);
    assert.equal(issued[0].amount_due, 60);
    assert.equal(await freshBalance(company), 0);
    await invoices.issueDueInvoices(midMonth);
    assert.equal(await CompanyInvoice.countDocuments({ company_id: company._id }), 1);
});

test('a credit an invoice owes the company is paid into the wallet it moves to', async () => {
    const company = await Company.create({ name: 'Credit to wallet', monthly_cap: 500 });
    const ctx = await ctxFor(company, 300);
    const orderId = id();
    await orders.reserveSpend({ ctx, month: '2025-06', amount: 80, orderId });
    const order = monthlyOrderFor(ctx, orderId, 80, '2025-06');
    await orders.recordCharge(order);
    await invoices.issueInvoice(company._id, '2025-06', { force: true, stage: 'final' });
    // Returned after its invoice: a credit on this month's statement, which comes out below zero.
    await orders.refundShare({ order, amount: 80, key: 'credit-to-wallet-return' });
    const { invoice: credit } = await invoices.issueInvoice(company._id, companyService.monthKey(), { force: true, stage: 'final' });
    assert.equal(credit.totals.total, -80);

    const { company: after } = await changeMode(company, { billing_mode: 'credit_wallet', monthly_cap: 200 });
    assert.equal(after.wallet_balance, 80);
    assert.equal(after.total_credit_limit, 280);
    assert.equal((await CompanyInvoice.findById(credit._id)).carried_to_month, 'wallet');
    assert.equal(await invoices.creditInvoicesToWallet(company._id), 0);
    assert.equal(await freshBalance(company), 80);
});

test('between a prepaid wallet and a credit wallet only the line changes; an ended contract cannot change', async () => {
    const company = await createCompany({ wallet_balance_minor: 1000 });
    const ctx = await ctxFor(company, 300);
    await assert.rejects(changeMode(company, { billing_mode: 'nonsense' }), { code: 'INVALID_BILLING_MODE' });
    await assert.rejects(changeMode(company, { billing_mode: 'credit_wallet' }), { code: 'INVALID_FIELD' });
    let { company: now } = await changeMode(company, { billing_mode: 'credit_wallet', monthly_cap: 200 });
    assert.equal(now.credit_line, 200);
    assert.equal(now.total_credit_limit, 210);
    await orders.reserveSpend({ ctx: await refreshed(ctx), month: companyService.monthKey(), amount: 150, orderId: id() });
    assert.equal(await freshBalance(company), -140);

    // Back to prepaid: the line goes, what was used of it is still owed, and a top-up pays it.
    ({ company: now } = await changeMode(company, { billing_mode: 'wallet', monthly_cap: 999 }));
    assert.equal(now.credit_line, 0);
    assert.equal(now.wallet_balance, -140);
    await assert.rejects(orders.reserveSpend({ ctx: await refreshed(ctx), month: companyService.monthKey(), amount: 1, orderId: id() }), { code: 'COMPANY_WALLET_INSUFFICIENT' });
    await move(company, 15000);
    assert.equal(await freshBalance(company), 10);

    // Sending the same mode with other fields is an ordinary edit.
    ({ company: now } = await changeMode(company, { billing_mode: 'wallet', name: 'Renamed' }));
    assert.equal(now.name, 'Renamed');

    await Company.updateOne({ _id: company._id }, { $set: { status: 'ended' } });
    await assert.rejects(changeMode(company, { billing_mode: 'monthly', monthly_cap: 100 }), { code: 'COMPANY_ENDED' });
});
