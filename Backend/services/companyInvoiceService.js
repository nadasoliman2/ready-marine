const companyWallet = require('./companyWalletService');
/**
 * Company invoices and collection — feature 14, phase 4.
 *
 * ── When an invoice is issued ─────────────────────────────────────────────────────────
 * Once per (company, month), automatically, on the first day of the next month (store
 * time zone), for every order COMPLETED by the end of the month — every parcel delivered,
 * cancelled or returned. An order still with the vendor or on the road is not billed yet:
 * its ledger rows move to the next month (deferOpenOrders) and it is invoiced in the month
 * it completes. The company is never asked to pay for goods its people have not received.
 * The one exception is the final invoice of an ended contract, which bills everything.
 *
 * ── What it contains ──────────────────────────────────────────────────────────────────
 * A snapshot of the month's ledger: one line per order (the company's final share —
 * charged, less what the batch saved, less what came back before the invoice), the
 * shipping differences the company absorbed, adjustments on earlier months' orders that
 * reached the ledger after their own invoice, and any credit balance the previous invoice
 * carried. After issuing, the month is closed: new events on its orders are booked on the
 * current month (companyOrderService.bookingFor) and appear on the next invoice.
 *
 * ── Collection ────────────────────────────────────────────────────────────────────────
 * Payment is by bank transfer. The admin records it, or the company uploads the receipt
 * and the admin confirms it. Part-payments are fine. Reminders go before the due date and
 * on it; past it the invoice is overdue, and past the company's grace period its ordering
 * on the company account is paused until the overdue invoices are paid — then it resumes
 * by itself. Waiting batches are never affected.
 */

const { flatTerms } = require('./shared/orgTerms');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Company } = require('../models/companies');
const { CompanyLedgerEntry } = require('../models/companyLedger');
const { CompanyInvoice, CompanyPayment } = require('../models/companyInvoices');
const { Order } = require('../models/orders');
const { User } = require('../models/users');
const { recordAuditLog } = require('../models/auditLog');
const { notifyCustomer } = require('./customerNotificationService');
const {
    companyError,
    round2,
    sameId,
    isObjectId,
    cleanText,
    monthKey,
    getCorporateSettings,
    requireManager,
    loadCompanyById,
    notifyManagers,
    notifyAdmins,
    emailManagers: emailCompanyManagers,
} = require('./companyService');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const EPSILON = 0.005;
/** How long after a month ends before its invoice is issued — orders placed in its last
 *  seconds finish being written first. Still the first day of the next month. */
const ISSUE_DELAY_HOURS = 1;
const STORE_TIMEZONE = process.env.STORE_TIMEZONE || 'Africa/Cairo';
const SYSTEM = { role: 'system', label: 'Ready Marine' };

/* ------------------------------------------------------------------ */
/* Dates in the store's time zone                                      */
/* ------------------------------------------------------------------ */

/** Minutes the store's time zone is ahead of UTC at `date` (+180 for Cairo in summer). */
const zoneOffsetMinutes = (date) => {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: STORE_TIMEZONE, timeZoneName: 'shortOffset' })
        .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    const minutes = Number(m[2]) * 60 + Number(m[3] || 0);
    return m[1] === '-' ? -minutes : minutes;
};

/** The instant a local calendar day starts in the store's time zone. */
const localDayStart = (year, month, day) => {
    const utcGuess = Date.UTC(year, month - 1, day);
    return new Date(utcGuess - zoneOffsetMinutes(new Date(utcGuess)) * 60000);
};

/** Local (y, m, d) of an instant. */
const localParts = (date) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(date);
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    return { year: get('year'), month: get('month'), day: get('day') };
};

/** When the month after `key` starts — the moment `key` is over. */
const monthEnd = (key) => {
    const [y, m] = key.split('-').map(Number);
    return m === 12 ? localDayStart(y + 1, 1, 1) : localDayStart(y, m + 1, 1);
};

/**
 * The due moment: the END of the day `days` after issue, in the store's time zone. A
 * company told "due on the 16th" has all of the 16th to pay.
 */
const dueAtFor = (issuedAt, days) => {
    const { year, month, day } = localParts(issuedAt);
    return new Date(localDayStart(year, month, day + Number(days || 0) + 1).getTime() - 1);
};

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

const balanceOf = (inv) => round2(Math.max(0, Number(inv.amount_due || 0) - Number(inv.amount_paid || 0)));

const nextMonthKey = (key) => {
    const [y, m] = key.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const previousMonthKey = (key) => {
    const [y, m] = key.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/**
 * The month a new ledger row for this company should be booked on: `from` (normally the
 * current month), or the first month after it with no invoice yet. Only an ended contract
 * has an invoice for the current month — issued the moment it ended — so what reaches the
 * ledger after that waits for the next month's statement.
 */
const openMonthFrom = async (companyId, from = monthKey()) => {
    let month = from;
    for (let i = 0; i < 24; i += 1) {
        if (!(await CompanyInvoice.exists({ company_id: companyId, month }))) return month;
        month = nextMonthKey(month);
    }
    return month;
};

/** issued / partially_paid / paid, and overdue on top of the first two once the date passes. */
const displayStatus = (inv, now = new Date()) => {
    if (inv.status === 'paid' || balanceOf(inv) <= EPSILON) return 'paid';
    if (new Date(inv.due_at) < now) return 'overdue';
    return inv.status;
};

const invoiceSummary = (inv, now = new Date()) => ({
    _id: inv._id,
    number: inv.number,
    month: inv.month,
    issued_at: inv.issued_at,
    due_at: inv.due_at,
    amount_due: round2(inv.amount_due),
    amount_paid: round2(inv.amount_paid),
    balance: balanceOf(inv),
    total: round2(inv.totals?.total),
    status: inv.status,
    display_status: displayStatus(inv, now),
    days_overdue: displayStatus(inv, now) === 'overdue' ? Math.floor((now - new Date(inv.due_at)) / DAY) + 1 : 0,
    order_count: inv.totals?.order_count || 0,
    shipping_savings: round2(inv.totals?.shipping_savings),
    contract_stage: inv.contract_stage || null,
});

const paymentShape = (p, { withReceipt = true } = {}) => ({
    _id: p._id,
    invoice_id: p.invoice_id,
    amount: round2(p.amount),
    paid_on: p.paid_on,
    reference: p.reference,
    note: p.note,
    kind: p.kind || 'transfer',
    status: p.status,
    has_receipt: !!p.receipt?.file,
    receipt_name: withReceipt ? (p.receipt?.original_name || '') : '',
    submitted_by: { kind: p.submitted_by?.kind, label: p.submitted_by?.label || '' },
    confirmed_by: p.confirmed_by || '',
    confirmed_at: p.confirmed_at,
    rejected_reason: p.rejected_reason || '',
    rejected_at: p.rejected_at,
    created_at: p.created_at,
});

const invoiceDetail = async (inv) => {
    const payments = await CompanyPayment.find({ invoice_id: inv._id }).sort({ created_at: -1 }).lean();
    return {
        ...invoiceSummary(inv),
        company_snapshot: inv.company_snapshot,
        bank_details: inv.bank_details,
        payment_terms_days: inv.payment_terms_days,
        lines: inv.lines,
        totals: inv.totals,
        carried_to_month: inv.carried_to_month,
        payments: payments.map((p) => paymentShape(p)),
    };
};

/* ------------------------------------------------------------------ */
/* Issuing                                                             */
/* ------------------------------------------------------------------ */

/** Whether the month may be invoiced yet — see the header. */
const monthReadyToInvoice = async (companyId, month, now = new Date()) => {
    if (month >= monthKey(now)) return { ready: false, reason: 'month_open' };
    if (now.getTime() < monthEnd(month).getTime() + ISSUE_DELAY_HOURS * HOUR) return { ready: false, reason: 'just_ended' };
    return { ready: true, reason: null };
};

/* ---- Only completed orders are invoiced ---- */

/** A parcel that will not move again: handed to the customer, cancelled, or sent back. */
const SETTLED_PARCEL_STATUSES = ['delivered', 'cancelled', 'returned'];
const SETTLED_ORDER_STATUSES = ['completed', 'delivered', 'cancelled', 'returned', 'refunded'];

/**
 * Whether an order was complete by `cutoff` — every parcel delivered, cancelled or
 * returned. An order completed after the cutoff belongs to the next month's invoice even
 * when the invoice is issued late.
 */
const orderSettledBy = (order, cutoff) => {
    if (!order) return true; // the order is gone: nothing more can happen to it
    const subs = order.sub_orders || [];
    const settled = subs.length
        ? subs.every((s) => SETTLED_PARCEL_STATUSES.includes(s.status))
        : SETTLED_ORDER_STATUSES.includes(order.status);
    if (!settled) return false;
    return !(order.delivered_at && cutoff && new Date(order.delivered_at) > cutoff);
};

/**
 * Before a month is invoiced: the rows of every order not complete by the end of it move
 * to the next open month, keeping the month they came from (`deferred_from`). They are
 * invoiced in the month the order completes. Late adjustments (`for_month`) are about
 * orders already invoiced and stay where they are. Returns how many orders were deferred.
 */
const deferOpenOrders = async (companyId, month) => {
    const entries = await CompanyLedgerEntry.find({ company_id: companyId, month, for_month: null, billing_mode: { $nin: companyWallet.WALLET_MODES } })
        .select('order_id').lean();
    const orderIds = [...new Set(entries.map((e) => String(e.order_id)))];
    if (orderIds.length === 0) return 0;
    const orders = await Order.find({ _id: { $in: orderIds } }).select('status delivered_at sub_orders.status').lean();
    const byId = new Map(orders.map((o) => [String(o._id), o]));
    const cutoff = new Date(monthEnd(month).getTime() + ISSUE_DELAY_HOURS * HOUR);
    const open = orderIds.filter((id) => !orderSettledBy(byId.get(id), cutoff));
    if (open.length === 0) return 0;

    const target = await openMonthFrom(companyId, nextMonthKey(month));
    // Two updates so a row deferred twice keeps the month it was FIRST booked on.
    const filter = { company_id: companyId, month, for_month: null, order_id: { $in: open } };
    await CompanyLedgerEntry.updateMany({ ...filter, deferred_from: null }, { $set: { deferred_from: month } });
    await CompanyLedgerEntry.updateMany(filter, { $set: { month: target } });
    return open.length;
};

const nextNumber = async (month) => {
    const count = await CompanyInvoice.countDocuments({ month });
    return `INV-${month.replace('-', '')}-${String(count + 1).padStart(4, '0')}`;
};

/** The invoice's lines and totals, from the month's ledger. */
const buildLines = async (companyId, month, invoiceId) => {
    const entries = await CompanyLedgerEntry.find({ company_id: companyId, month, billing_mode: { $nin: companyWallet.WALLET_MODES } }).sort({ created_at: 1 }).lean();

    const orderIds = [...new Set(entries.map((e) => String(e.order_id)))];
    const userIds = [...new Set(entries.map((e) => String(e.user_id)))];
    const [orders, users] = await Promise.all([
        Order.find({ _id: { $in: orderIds } }).select('created_at company.shipping_savings company.beneficiary transaction.reference').lean(),
        User.find({ _id: { $in: userIds } }).select('name').lean(),
    ]);
    const orderById = new Map(orders.map((o) => [String(o._id), o]));
    const nameById = new Map(users.map((u) => [String(u._id), u.name || '']));

    const orderLines = new Map();
    const other = [];
    for (const e of entries) {
        const common = {
            ledger_entry_id: e._id,
            order_id: e.order_id,
            order_reference: e.order_reference,
            user_id: e.user_id,
            name: nameById.get(String(e.user_id)) || '',
            car_label: e.car_label || '',
            reason: e.reason || '',
        };
        if (e.batch_id && e.kind === 'charge') {
            other.push({ ...common, kind: 'shipping_difference', amount: round2(e.amount), date: e.created_at, for_month: e.for_month || null });
            continue;
        }
        if (e.for_month) {
            // A batch that closed after the order's own invoice: its saving comes off here.
            const kind = e.batch_id && e.kind === 'credit' ? 'late_savings' : (e.kind === 'credit' ? 'late_credit' : 'late_charge');
            other.push({ ...common, kind, amount: round2(e.amount), personal_amount: round2(e.personal_amount), date: e.created_at, for_month: e.for_month });
            continue;
        }
        const key = String(e.order_id);
        if (!orderLines.has(key)) {
            const order = orderById.get(key);
            orderLines.set(key, {
                ...common,
                ledger_entry_id: null,
                kind: e.beneficiary === 'car' ? 'car_order' : 'order',
                date: order?.created_at || e.created_at,
                charged: 0, saved: 0, returned: 0, amount: 0, personal_amount: 0,
                reason: '',
            });
        }
        const line = orderLines.get(key);
        const amount = round2(e.amount);
        if (e.kind === 'charge') {
            line.charged = round2(line.charged + amount);
            line.personal_amount = round2(line.personal_amount + Number(e.personal_amount || 0));
        } else if (e.batch_id) {
            line.saved = round2(line.saved - amount);
            line.personal_amount = round2(line.personal_amount - Number(e.personal_amount || 0));
        } else {
            line.returned = round2(line.returned - amount);
            line.personal_amount = round2(line.personal_amount - Number(e.personal_amount || 0));
        }
        line.amount = round2(line.amount + amount);
    }

    // A credit balance left by an earlier invoice, carried to this one.
    const carried = await CompanyInvoice.find({
        company_id: companyId,
        _id: { $ne: invoiceId },
        'totals.total': { $lt: -EPSILON },
        $or: [{ carried_to_month: null }, { carried_to_month: month }],
    }).lean();
    if (carried.length) {
        await CompanyInvoice.updateMany({ _id: { $in: carried.map((c) => c._id) } }, { $set: { carried_to_month: month } });
    }
    for (const c of carried) {
        other.push({
            kind: 'carried_credit',
            amount: round2(c.totals.total),
            reason: `Credit balance from invoice ${c.number} (${c.month})`,
            for_month: c.month,
            date: c.issued_at,
        });
    }

    // A company that moved from a wallet to an invoice: whatever is in the wallet now
    // (what was left in it, a return of an order it had paid from it, or a debt) is
    // settled here, and the wallet is left at zero.
    const swept = round2(await companyWallet.sweep(companyId, invoiceId));
    if (Math.abs(swept) > EPSILON) {
        other.push({
            kind: 'wallet_balance',
            amount: -swept,
            reason: swept > 0 ? 'Wallet balance, taken off this invoice' : 'Amount owed on the wallet',
            date: new Date(),
        });
    }

    const lines = [...orderLines.values()].sort((a, b) => new Date(a.date) - new Date(b.date)).concat(other);
    const sum = (list) => round2(list.reduce((s, l) => s + Number(l.amount || 0), 0));
    const byKind = (...kinds) => lines.filter((l) => kinds.includes(l.kind));
    const orderList = byKind('order', 'car_order');
    const totals = {
        orders: sum(orderList),
        adjustments: sum(byKind('late_credit', 'late_charge', 'late_savings')),
        shipping_differences: sum(byKind('shipping_difference')),
        carried_credit: sum(byKind('carried_credit')),
        wallet_balance: sum(byKind('wallet_balance')),
        total: sum(lines),
        shipping_savings: round2(orderList.reduce((s, l) => s + Number(orderById.get(String(l.order_id))?.company?.shipping_savings || 0), 0)),
        employee_paid: round2(orderList.reduce((s, l) => s + Math.max(0, Number(l.personal_amount || 0)), 0)),
        order_count: orderList.length,
    };
    return { lines, totals, entryIds: entries.map((e) => String(e._id)), hasActivity: entries.length > 0 || carried.length > 0 || Math.abs(swept) > EPSILON };
};

/**
 * For a company that pays from a wallet now: an invoice that came out in its favour (its
 * invoiced orders were returned) is paid into the wallet, since no later invoice may come
 * to carry it to. Safe to repeat: each invoice is credited once.
 */
const creditInvoicesToWallet = async (companyId) => {
    const company = await Company.findById(companyId).lean();
    if (!company || !companyWallet.isWallet(company)) return 0;
    const credits = await CompanyInvoice.find({
        company_id: company._id,
        snapshot_at: { $ne: null },
        'totals.total': { $lt: -EPSILON },
        carried_to_month: null,
    }).lean();
    let total = 0;
    for (const inv of credits) {
        const amount = round2(Math.abs(Number(inv.totals.total || 0)));
        await companyWallet.move({
            companyId: company._id, deltaMinor: companyWallet.toMinor(amount), key: `invoice:${inv._id}:credit`,
            kind: 'refund', reason: `Credit balance from invoice ${inv.number}`, allowInactive: true,
        });
        await CompanyInvoice.updateOne({ _id: inv._id, carried_to_month: null }, { $set: { carried_to_month: 'wallet' } });
        total = round2(total + amount);
    }
    return total;
};

/**
 * Issue one company's invoice for one month. Safe to call twice: the second call finds the
 * first invoice (unique per company and month) and, if it never finished, finishes it.
 */
const issueInvoice = async (companyId, month, { force = false, now = new Date(), stage = null } = {}) => {
    const existing = await CompanyInvoice.findOne({ company_id: companyId, month });
    if (existing && existing.snapshot_at) return { invoice: existing, created: false };

    if (!existing && !force) {
        const { ready, reason } = await monthReadyToInvoice(companyId, month, now);
        if (!ready) return { invoice: null, created: false, reason };
    }

    const company = await Company.findById(companyId).lean();
    if (!company) throw companyError('COMPANY_NOT_FOUND', 'Company not found', 404);
    const settings = await getCorporateSettings();

    let invoice = existing;
    if (!invoice) {
        // The invoice exists BEFORE the ledger is read: from this instant, any new event on
        // this month's orders is booked on the next month instead (bookingFor).
        const office = (company.offices || []).find((o) => o.active !== false) || company.offices?.[0];
        for (let attempt = 0; attempt < 5 && !invoice; attempt += 1) {
            try {
                invoice = await CompanyInvoice.create({
                    company_id: company._id,
                    month,
                    number: await nextNumber(month),
                    company_snapshot: {
                        name: company.name,
                        org_type: company.org_type || 'company',
                        commercial_registration: company.commercial_registration || '',
                        tax_card: company.tax_card || '',
                        address: office ? `${office.name} — ${office.full_address}` : '',
                    },
                    bank_details: settings.bank_details || null,
                    issued_at: now,
                    payment_terms_days: Number(company.payment_terms_days ?? settings.default_payment_terms_days ?? 15),
                    due_at: dueAtFor(now, company.payment_terms_days ?? settings.default_payment_terms_days ?? 15),
                    amount_due: 0,
                });
            } catch (err) {
                if (err.code !== 11000) throw err;
                if (err.keyPattern?.company_id) {
                    invoice = await CompanyInvoice.findOne({ company_id: company._id, month });
                    if (invoice?.snapshot_at) return { invoice, created: false };
                }
                // A number another month's issuer took a moment ago: count again.
            }
        }
        if (!invoice) throw new Error(`Could not number the invoice for ${company.name} ${month}`);
    }

    // Orders still on their way are not billed: they wait for the month they complete.
    // The final invoice of an ended contract is the exception — nothing comes after it.
    const final = stage === 'final' || company.status === 'ended';
    if (!final) await deferOpenOrders(company._id, month);

    const { lines, totals, entryIds, hasActivity } = await buildLines(company._id, month, invoice._id);
    if (!hasActivity) {
        // Nothing to bill this month — no order completed in it: no invoice.
        await CompanyInvoice.deleteOne({ _id: invoice._id, snapshot_at: null });
        return { invoice: null, created: false, reason: 'no_activity' };
    }

    invoice.lines = lines;
    invoice.totals = totals;
    invoice.ledger_entry_ids = entryIds;
    invoice.amount_due = round2(Math.max(0, totals.total));
    invoice.snapshot_at = new Date();
    invoice.contract_stage = stage || (company.status === 'ended' ? 'after_end' : null);
    if (invoice.amount_due <= EPSILON) {
        invoice.status = 'paid';
        invoice.paid_at = invoice.snapshot_at;
    }
    await invoice.save();

    await recordAuditLog({
        action: 'company_invoice_issued',
        actor: SYSTEM,
        target_type: 'company_invoice',
        target_id: invoice._id,
        target_snapshot: { company: company.name, month, number: invoice.number, total: totals.total, amount_due: invoice.amount_due },
    }).catch(() => {});

    await tellManagers(invoice, 'issued').catch((err) => console.error(`[Company invoice] Issue notice failed for ${invoice.number}: ${err.message}`));
    // A company that pays from a wallet now has no next invoice to carry a credit to.
    await creditInvoicesToWallet(company._id).catch((err) =>
        console.error(`[Company invoice] Credit to wallet failed for ${company.name}: ${err.message}`));
    // After the contract, credit is not carried to a next invoice that may never come:
    // it goes against what is unpaid, and the rest is owed back to the company.
    if (company.status === 'ended') {
        await settleEndedCompany(company._id).catch((err) =>
            console.error(`[Company invoice] Settlement failed for ${company.name}: ${err.message}`));
    }
    return { invoice, created: true };
};

/* ------------------------------------------------------------------ */
/* The end of the contract: credit against debt, the rest refunded      */
/* ------------------------------------------------------------------ */

const walletSettlement = async (company) => {
    await companyWallet.flushPending(company);
    const { CompanyWalletTransaction } = require('../models/companyWalletTransactions');
    const refunds = await CompanyWalletTransaction.find({ company_id: company._id, kind: 'settlement' }).sort({ created_at: -1 }).lean();
    // Invoices from before the company moved to a wallet are still owed with it.
    const open = await CompanyInvoice.find({ company_id: company._id, snapshot_at: { $ne: null }, status: { $ne: 'paid' } })
        .select('amount_due amount_paid').lean();
    return {
        ended_at: company.contract_end?.at || null, ended_by: company.contract_end?.by || '', note: company.contract_end?.note || '',
        outstanding: round2(companyWallet.owed(company) + open.reduce((sum, inv) => sum + balanceOf(inv), 0)),
        refund_due: Math.max(0, companyWallet.balance(company)), pending_adjustments: 0,
        refunded: refunds.reduce((sum, r) => sum - r.delta_minor / 100, 0),
        refunds: refunds.map((r) => ({ _id: r._id, amount: -r.delta_minor / 100, paid_on: r.created_at, reference: r.reason, note: '', recorded_by: '' })),
    };
};
const refundedTotal = (company) => round2((company.refunds || []).reduce((sum, r) => sum + Number(r.amount || 0), 0));
const refundDue = (company) => companyWallet.isWallet(company) ? Math.max(0, companyWallet.balance(company)) : round2(Math.max(0, Number(company.refund_owed || 0) - refundedTotal(company)));

/**
 * For an ended contract: every credit the company has with us — invoices that came out
 * below zero, and any refund not sent yet — goes first against its unpaid invoices
 * (oldest first, as "credit" payments), and what is left is owed back to it. Safe to
 * repeat: a credit is used once.
 */
const settleEndedCompany = async (companyId) => {
    const company = await Company.findById(companyId);
    if (!company || company.status !== 'ended') return null;
    if (companyWallet.isWallet(company)) return walletSettlement(company);

    const credits = await CompanyInvoice.find({
        company_id: company._id,
        snapshot_at: { $ne: null },
        'totals.total': { $lt: -EPSILON },
        carried_to_month: null,
    }).lean();
    let pool = round2(credits.reduce((sum, c) => sum + Math.abs(Number(c.totals.total || 0)), 0) + refundDue(company));
    if (credits.length) {
        await CompanyInvoice.updateMany({ _id: { $in: credits.map((c) => c._id) } }, { $set: { carried_to_month: 'settlement' } });
    }
    const sources = credits.map((c) => c.number);

    const open = await CompanyInvoice.find({ company_id: company._id, snapshot_at: { $ne: null }, status: { $ne: 'paid' } })
        .sort({ issued_at: 1 });
    for (const inv of open) {
        if (pool <= EPSILON) break;
        const take = round2(Math.min(pool, balanceOf(inv)));
        if (take <= EPSILON) continue;
        await CompanyPayment.create({
            company_id: company._id,
            invoice_id: inv._id,
            amount: take,
            paid_on: new Date(),
            reference: sources.length ? sources.join(', ') : 'Credit balance',
            note: 'The company\'s credit (returns and savings), set against this invoice when the contract ended.',
            kind: 'credit',
            status: 'confirmed',
            submitted_by: { kind: 'admin', label: 'Ready Marine' },
            confirmed_by: 'Ready Marine',
            confirmed_at: new Date(),
        });
        await settleInvoice(inv);
        pool = round2(pool - take);
    }

    const before = refundDue(company);
    company.refund_owed = round2(refundedTotal(company) + Math.max(0, pool));
    await company.save();
    if (refundDue(company) > before + EPSILON) {
        await recordAuditLog({
            action: 'company_refund_owed',
            actor: SYSTEM,
            target_type: 'company',
            target_id: company._id,
            target_snapshot: { name: company.name, refund_due: refundDue(company), from_invoices: sources },
        }).catch(() => {});
        await notifyAdmins(
            'company_refund_owed',
            'Money owed to a company',
            `${company.name}'s contract has ended with ${refundDue(company).toFixed(2)} of credit left — transfer it and record the refund.`,
            { company_id: company._id }
        );
    }
    return settlementFor(company);
};

/** Where an ended contract stands: unpaid invoices, and what ReadyCar still owes back. */
const settlementFor = async (companyOrId) => {
    const company = companyOrId?.refund_owed !== undefined ? companyOrId : await Company.findById(companyOrId?._id || companyOrId).lean();
    if (!company || company.status !== 'ended') return null;
    if (companyWallet.isWallet(company)) return walletSettlement(company);
    const open = await CompanyInvoice.find({ company_id: company._id, snapshot_at: { $ne: null }, status: { $ne: 'paid' } })
        .select('amount_due amount_paid').lean();
    const waiting = await CompanyLedgerEntry.aggregate([
        { $match: { company_id: company._id } },
        { $group: { _id: '$month', total: { $sum: '$amount' } } },
    ]);
    const invoiced = new Set((await CompanyInvoice.find({ company_id: company._id, snapshot_at: { $ne: null } }).select('month').lean()).map((i) => i.month));
    return {
        ended_at: company.contract_end?.at || null,
        ended_by: company.contract_end?.by || '',
        note: company.contract_end?.note || '',
        outstanding: round2(open.reduce((sum, inv) => sum + balanceOf(inv), 0)),
        refund_due: refundDue(company),
        refunded: refundedTotal(company),
        // Returns or savings that reached the ledger after the final invoice, for the next statement.
        pending_adjustments: round2(waiting.filter((w) => !invoiced.has(w._id)).reduce((sum, w) => sum + Number(w.total || 0), 0)),
        refunds: (company.refunds || []).map((r) => ({
            _id: r._id,
            amount: round2(r.amount),
            paid_on: r.paid_on,
            reference: r.reference || '',
            note: r.note || '',
            recorded_by: r.recorded_by || '',
        })),
    };
};

/** Admin: the refund transfer to a company whose contract ended. */
const recordRefund = async (companyId, input = {}, actor) => {
    const company = await Company.findById(companyId);
    if (!company) throw companyError('COMPANY_NOT_FOUND', 'Company not found', 404);
    if (company.status !== 'ended') throw companyError('CONTRACT_NOT_ENDED', 'Refunds are recorded after the contract has ended', 409);
    const amount = round2(Number(input.amount));
    if (!(amount > 0)) throw companyError('INVALID_AMOUNT', 'Enter the amount transferred', 400);
    if (amount > refundDue(company) + EPSILON) {
        throw companyError('REFUND_TOO_LARGE', `The amount is more than what is owed to the company (${refundDue(company).toFixed(2)})`, 409);
    }
    const paidOn = input.paid_on ? new Date(input.paid_on) : new Date();
    if (Number.isNaN(paidOn.getTime()) || paidOn > new Date(Date.now() + DAY)) throw companyError('INVALID_DATE', 'Enter the transfer date', 400);
    if (companyWallet.isWallet(company)) {
        const reference = cleanText(input.reference, 120);
        if (!reference) throw companyError('REFERENCE_REQUIRED', 'Enter a unique bank transfer reference', 400);
        await companyWallet.move({ companyId, deltaMinor: -companyWallet.toMinor(amount), key: `settlement:${reference}`, kind: 'settlement', reason: reference, allowInactive: true });
        return settlementFor(companyId);
    }
    company.refunds.push({
        amount,
        paid_on: paidOn,
        reference: cleanText(input.reference, 120),
        note: cleanText(input.note, 500),
        recorded_by: actor?.label || 'Admin',
    });
    await company.save();
    await recordAuditLog({
        action: 'company_refund_recorded',
        actor,
        target_type: 'company',
        target_id: company._id,
        target_snapshot: { name: company.name, amount, reference: cleanText(input.reference, 120), still_due: refundDue(company) },
    }).catch(() => {});
    await notifyManagers(company._id, 'company_refund_sent', {
        title_en: `Ready Marine transferred ${amount.toFixed(2)} to you`,
        title_ar: `Ready Marine حوّلتلكم ${amount.toFixed(2)} ج`,
        message_en: 'The credit left on your account when the contract ended.',
        message_ar: 'الرصيد اللي كان ليكم لما العقد انتهى.',
    }, { link: '/company/invoices' }).catch(() => {});
    return settlementFor(company);
};

/** Every (company, month) that is over, has ledger activity and no invoice yet — issued if ready. */
const issueDueInvoices = async (now = new Date()) => {
    const current = monthKey(now);
    const pending = await CompanyLedgerEntry.aggregate([
        { $match: { month: { $lt: current }, billing_mode: { $nin: companyWallet.WALLET_MODES } } },
        { $group: { _id: { company_id: '$company_id', month: '$month' } } },
    ]);
    // A company on an invoice that still owes on the wallet it used to pay from, and has
    // no order to invoice: last month's statement is issued for the debt alone. A balance
    // in its favour simply waits for its next invoice — unless the contract has ended and
    // none is coming, when it is stated now so it can be paid back.
    const leftover = await Company.find({
        billing_mode: { $nin: companyWallet.WALLET_MODES },
        $or: [{ wallet_balance_minor: { $lt: 0 } }, { status: 'ended', wallet_balance_minor: { $gt: 0 } }],
    }).select('_id').lean();
    const last = previousMonthKey(current);
    for (const c of leftover) {
        if (pending.some((p) => String(p._id.company_id) === String(c._id))) continue;
        if (await CompanyInvoice.exists({ company_id: c._id, month: last })) continue;
        pending.push({ _id: { company_id: c._id, month: last } });
    }
    if (pending.length === 0) return { issued: 0, waiting: [] };
    const invoiced = await CompanyInvoice.find({
        $or: pending.map((p) => ({ company_id: p._id.company_id, month: p._id.month })),
    }).select('company_id month snapshot_at').lean();
    const done = new Set(invoiced.filter((i) => i.snapshot_at).map((i) => `${i.company_id}:${i.month}`));

    let issued = 0;
    const waiting = [];
    for (const p of pending.sort((a, b) => a._id.month.localeCompare(b._id.month))) {
        const key = `${p._id.company_id}:${p._id.month}`;
        if (done.has(key)) continue;
        const res = await issueInvoice(p._id.company_id, p._id.month, { now }).catch((err) => {
            console.error(`[Company invoice] Could not issue ${key}: ${err.message}`);
            return { invoice: null, reason: 'error' };
        });
        if (res.created) issued += 1;
        else if (!res.invoice) waiting.push({ key, reason: res.reason });
    }
    return { issued, waiting };
};

/**
 * The one race the invoice cannot close by itself: an event that checked "is this month
 * invoiced?" a moment before the invoice existed and wrote its entry a moment after the
 * ledger was read. Such an entry is moved to the current month, where the next invoice
 * picks it up — the same place it would have gone a millisecond later.
 */
const reconcileLateEntries = async (now = new Date()) => {
    const recent = await CompanyInvoice.find({ snapshot_at: { $gte: new Date(now.getTime() - 3 * DAY) } })
        .select('+ledger_entry_ids company_id month').lean();
    let moved = 0;
    for (const inv of recent) {
        const res = await CompanyLedgerEntry.updateMany(
            { company_id: inv.company_id, month: inv.month, billing_mode: { $nin: companyWallet.WALLET_MODES }, _id: { $nin: inv.ledger_entry_ids || [] } },
            { $set: { month: await openMonthFrom(inv.company_id, monthKey(now)), for_month: inv.month } }
        );
        moved += res.modifiedCount || 0;
    }
    return moved;
};

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

const RECEIPT_DIR = path.join(__dirname, '../public/uploads/company-receipts');
const RECEIPT_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;

/** Store an uploaded receipt under a random name. Returns the stored descriptor. */
const saveReceiptFile = (file) => {
    if (!file) return null;
    const ext = RECEIPT_TYPES[file.mimetype];
    if (!ext) throw companyError('RECEIPT_TYPE', 'Upload the receipt as an image (JPG, PNG, WEBP) or a PDF', 400);
    if (file.size > RECEIPT_MAX_BYTES) throw companyError('RECEIPT_TOO_LARGE', 'The receipt file is larger than 8 MB', 400);
    if (!fs.existsSync(RECEIPT_DIR)) fs.mkdirSync(RECEIPT_DIR, { recursive: true });
    const name = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(RECEIPT_DIR, name), file.buffer);
    return { file: name, original_name: cleanText(file.originalname, 200), mime: file.mimetype };
};

/** Path and type of a payment's receipt, for a route that has already checked who is asking. */
const receiptFileFor = (payment) => {
    if (!payment?.receipt?.file) throw companyError('RECEIPT_NOT_FOUND', 'No receipt was uploaded for this payment', 404);
    const full = path.join(RECEIPT_DIR, path.basename(payment.receipt.file));
    if (!fs.existsSync(full)) throw companyError('RECEIPT_NOT_FOUND', 'The receipt file is missing', 404);
    return { path: full, mime: payment.receipt.mime || 'application/octet-stream', name: payment.receipt.original_name || payment.receipt.file };
};

const parsePaymentInput = (input = {}, { requireAmount = true } = {}) => {
    const amount = round2(Number(input.amount));
    if (requireAmount && !(amount > 0)) throw companyError('INVALID_AMOUNT', 'Enter the amount transferred', 400);
    const paidOn = input.paid_on ? new Date(input.paid_on) : null;
    if (!paidOn || Number.isNaN(paidOn.getTime())) throw companyError('INVALID_DATE', 'Enter the transfer date', 400);
    if (paidOn.getTime() > Date.now() + DAY) throw companyError('INVALID_DATE', 'The transfer date cannot be in the future', 400);
    return {
        amount,
        paid_on: paidOn,
        reference: cleanText(input.reference, 120),
        note: cleanText(input.note, 500),
    };
};

const loadInvoiceFor = async (companyId, invoiceId) => {
    if (!isObjectId(invoiceId)) throw companyError('INVOICE_NOT_FOUND', 'Invoice not found', 404);
    const invoice = await CompanyInvoice.findOne({ _id: invoiceId, company_id: companyId, snapshot_at: { $ne: null } });
    if (!invoice) throw companyError('INVOICE_NOT_FOUND', 'Invoice not found', 404);
    return invoice;
};

/** Re-add the confirmed payments and set the invoice's paid state. Then resume a company paused for being late, if nothing is late any more. */
const settleInvoice = async (invoice) => {
    const confirmed = await CompanyPayment.find({ invoice_id: invoice._id, status: 'confirmed' }).select('amount').lean();
    const paid = round2(confirmed.reduce((s, p) => s + Number(p.amount || 0), 0));
    invoice.amount_paid = paid;
    if (paid + EPSILON >= Number(invoice.amount_due || 0)) {
        invoice.status = 'paid';
        invoice.paid_at = invoice.paid_at || new Date();
    } else {
        invoice.status = paid > EPSILON ? 'partially_paid' : 'issued';
        invoice.paid_at = null;
    }
    await invoice.save();
    await resumeIfNothingLate(invoice.company_id).catch((err) =>
        console.error(`[Company invoice] Could not resume company ${invoice.company_id}: ${err.message}`));
    return invoice;
};

const assertFits = (invoice, amount, { excludePaymentAmount = 0 } = {}) => {
    const room = round2(Number(invoice.amount_due || 0) - Number(invoice.amount_paid || 0) + excludePaymentAmount);
    if (amount > room + EPSILON) {
        throw companyError('PAYMENT_TOO_LARGE', `The amount is more than what is left on this invoice (${room.toFixed(2)})`, 409);
    }
};

/** Admin: a transfer that reached the bank. Confirmed at once. */
const recordPaymentByAdmin = async (companyId, invoiceId, input, file, actor) => {
    const invoice = await loadInvoiceFor(companyId, invoiceId);
    const data = parsePaymentInput(input);
    assertFits(invoice, data.amount);
    const receipt = saveReceiptFile(file);
    const payment = await CompanyPayment.create({
        company_id: invoice.company_id,
        invoice_id: invoice._id,
        ...data,
        receipt: receipt || undefined,
        status: 'confirmed',
        submitted_by: { kind: 'admin', label: actor?.label || 'Admin' },
        confirmed_by: actor?.label || 'Admin',
        confirmed_at: new Date(),
    });
    await settleInvoice(invoice);
    await recordAuditLog({
        action: 'company_payment_recorded',
        actor,
        target_type: 'company_payment',
        target_id: payment._id,
        target_snapshot: { invoice: invoice.number, amount: data.amount, reference: data.reference },
    }).catch(() => {});
    await tellManagers(invoice, 'payment_recorded', { amount: data.amount }).catch(() => {});
    return { payment: paymentShape(payment.toObject()), invoice: invoiceSummary(invoice) };
};

/** Manager: "we transferred it" — the receipt waits for the admin to confirm it. */
const submitReceipt = async (userId, invoiceId, input, file) => {
    const { company } = await requireManager(userId);
    const invoice = await loadInvoiceFor(company._id, invoiceId);
    if (invoice.status === 'paid') throw companyError('INVOICE_PAID', 'This invoice is already paid', 409);
    if (!file) throw companyError('RECEIPT_REQUIRED', 'Attach the transfer receipt', 400);
    const data = parsePaymentInput(input);
    assertFits(invoice, data.amount);
    const receipt = saveReceiptFile(file);
    const user = await User.findById(userId).select('name').lean();
    const payment = await CompanyPayment.create({
        company_id: company._id,
        invoice_id: invoice._id,
        ...data,
        receipt,
        status: 'pending',
        submitted_by: { kind: 'manager', user_id: userId, label: user?.name || '' },
    });
    await notifyAdmins(
        'company_receipt_uploaded',
        'Transfer receipt to confirm',
        `${company.name} uploaded a transfer of ${data.amount.toFixed(2)} for invoice ${invoice.number}.`,
        { company_id: company._id, invoice_id: invoice._id, payment_id: payment._id }
    );
    return { payment: paymentShape(payment.toObject()) };
};

/** Admin: the uploaded transfer did arrive. The amount and date may be corrected on the way. */
const confirmPayment = async (companyId, paymentId, input = {}, actor) => {
    const payment = await CompanyPayment.findOne({ _id: paymentId, company_id: companyId });
    if (!payment) throw companyError('PAYMENT_NOT_FOUND', 'Payment not found', 404);
    if (payment.status !== 'pending') throw companyError('PAYMENT_NOT_PENDING', 'This payment was already handled', 409);
    const invoice = await loadInvoiceFor(companyId, payment.invoice_id);
    if (input.amount !== undefined || input.paid_on !== undefined || input.reference !== undefined) {
        const data = parsePaymentInput({
            amount: input.amount ?? payment.amount,
            paid_on: input.paid_on ?? payment.paid_on,
            reference: input.reference ?? payment.reference,
            note: payment.note,
        });
        payment.amount = data.amount;
        payment.paid_on = data.paid_on;
        payment.reference = data.reference;
    }
    assertFits(invoice, payment.amount);
    payment.status = 'confirmed';
    payment.confirmed_by = actor?.label || 'Admin';
    payment.confirmed_at = new Date();
    await payment.save();
    await settleInvoice(invoice);
    await recordAuditLog({
        action: 'company_payment_confirmed',
        actor,
        target_type: 'company_payment',
        target_id: payment._id,
        target_snapshot: { invoice: invoice.number, amount: payment.amount },
    }).catch(() => {});
    await tellManagers(invoice, 'payment_recorded', { amount: payment.amount }).catch(() => {});
    return { payment: paymentShape(payment.toObject()), invoice: invoiceSummary(invoice) };
};

/** Admin: the transfer is not in the bank (or is wrong). The company is told why. */
const rejectPayment = async (companyId, paymentId, reason, actor) => {
    const payment = await CompanyPayment.findOne({ _id: paymentId, company_id: companyId });
    if (!payment) throw companyError('PAYMENT_NOT_FOUND', 'Payment not found', 404);
    if (payment.status !== 'pending') throw companyError('PAYMENT_NOT_PENDING', 'This payment was already handled', 409);
    const why = cleanText(reason, 300);
    if (!why) throw companyError('REASON_REQUIRED', 'Say why the receipt is rejected — the company reads it', 400);
    payment.status = 'rejected';
    payment.rejected_reason = why;
    payment.rejected_at = new Date();
    await payment.save();
    const invoice = await CompanyInvoice.findById(payment.invoice_id);
    await recordAuditLog({
        action: 'company_payment_rejected',
        actor,
        target_type: 'company_payment',
        target_id: payment._id,
        target_snapshot: { invoice: invoice?.number, amount: payment.amount, reason: why },
    }).catch(() => {});
    if (invoice) await tellManagers(invoice, 'payment_rejected', { amount: payment.amount, reason: why }).catch(() => {});
    return { payment: paymentShape(payment.toObject()) };
};

/* ------------------------------------------------------------------ */
/* Reminders, overdue, pause and resume                                */
/* ------------------------------------------------------------------ */

/** Invoices with money still owed whose due date has passed by more than the company's grace. */
const lateBeyondGrace = async (company, now = new Date()) => {
    const graceDays = Number(company.overdue_grace_days ?? 7);
    const open = await CompanyInvoice.find({ company_id: company._id, status: { $ne: 'paid' }, snapshot_at: { $ne: null } }).lean();
    return open.filter((inv) => balanceOf(inv) > EPSILON && now.getTime() > new Date(inv.due_at).getTime() + graceDays * DAY);
};

/** Lift a pause that was for being late, once nothing is late beyond grace any more. */
const resumeIfNothingLate = async (companyId, now = new Date()) => {
    const company = await Company.findById(companyId);
    if (!company || company.status !== 'suspended' || company.suspension?.reason !== 'overdue') return false;
    if ((await lateBeyondGrace(company, now)).length > 0) return false;
    company.status = 'active';
    company.suspension = { reason: null, note: '', at: null, by: '' };
    await company.save();
    await recordAuditLog({
        action: 'company_reactivated',
        actor: SYSTEM,
        target_type: 'company',
        target_id: company._id,
        target_snapshot: { name: company.name, previous_reason: 'overdue', automatic: true },
    }).catch(() => {});
    await notifyManagers(company._id, 'company_reactivated', {
        title_en: `Ordering on the ${flatTerms(company.org_type, false).one} account has resumed`,
        title_ar: `الطلب على حساب ${flatTerms(company.org_type, true).the} رجع يشتغل`,
        message_en: 'Thank you — the late invoice is paid.',
        message_ar: 'شكراً — الفاتورة المتأخرة اتدفعت.',
    }, { link: '/company/invoices' }).catch(() => {});
    return true;
};

const runCollectionSweep = async (now = new Date()) => {
    const result = { reminders: 0, due_notices: 0, overdue: 0, paused: 0, resumed: 0 };
    const settings = await getCorporateSettings();
    const reminderDays = Number(settings.invoice_reminder_days ?? 3);

    const open = await CompanyInvoice.find({ status: { $ne: 'paid' }, snapshot_at: { $ne: null } });
    for (const inv of open) {
        if (balanceOf(inv) <= EPSILON) continue;
        const due = new Date(inv.due_at).getTime();
        const t = now.getTime();
        // The due day starts 24 hours before the due moment (its last millisecond).
        const dueDayStart = due - DAY + 1;

        if (t < dueDayStart && t >= due - reminderDays * DAY && !inv.notices?.reminder_sent_at) {
            inv.set('notices.reminder_sent_at', now);
            await inv.save();
            await tellManagers(inv, 'reminder').catch(() => {});
            result.reminders += 1;
        } else if (t >= dueDayStart && t <= due && !inv.notices?.due_sent_at) {
            inv.set('notices.due_sent_at', now);
            await inv.save();
            await tellManagers(inv, 'due_today').catch(() => {});
            result.due_notices += 1;
        } else if (t > due && !inv.notices?.overdue_sent_at) {
            inv.set('notices.overdue_sent_at', now);
            await inv.save();
            await tellManagers(inv, 'overdue').catch(() => {});
            const company = await Company.findById(inv.company_id).select('name').lean();
            await notifyAdmins(
                'company_invoice_overdue',
                'Company invoice overdue',
                `${company?.name || 'A company'} has not paid invoice ${inv.number} (${balanceOf(inv).toFixed(2)} left).`,
                { company_id: inv.company_id, invoice_id: inv._id }
            );
            result.overdue += 1;
        }
    }

    // Pause companies late beyond their grace period.
    // Whatever the company pays with now: one that moved to a wallet still owes the
    // invoices of its orders from before.
    const companies = await Company.find({ status: 'active' });
    for (const company of companies) {
        if (company.overdue_waiver_until && new Date(company.overdue_waiver_until) > now) continue;
        const late = await lateBeyondGrace(company, now);
        if (late.length === 0) continue;
        company.status = 'suspended';
        company.suspension = {
            reason: 'overdue',
            note: `Invoice ${late.map((i) => i.number).join(', ')} unpaid past the grace period`,
            at: now,
            by: 'Ready Marine',
        };
        await company.save();
        await recordAuditLog({
            action: 'company_suspended',
            actor: SYSTEM,
            target_type: 'company',
            target_id: company._id,
            target_snapshot: { name: company.name, reason: 'overdue', invoices: late.map((i) => i.number) },
        }).catch(() => {});
        await notifyManagers(company._id, 'company_suspended', {
            title_en: `Ordering on the ${flatTerms(company.org_type, false).one} account is paused`,
            title_ar: `الطلب على حساب ${flatTerms(company.org_type, true).the} اتوقف مؤقتاً`,
            message_en: `Invoice ${late[0].number} is past due. Ordering resumes as soon as it is paid; orders already waiting still ship.`,
            message_ar: `الفاتورة ${late[0].number} عدّى ميعادها. الطلب بيرجع أول ما تتدفع، والأوردرات المستنية بتتشحن عادي.`,
        }, { link: `/company/invoices/${late[0]._id}` }).catch(() => {});
        await emailManagers(company._id, late[0], 'paused').catch(() => {});
        result.paused += 1;
    }

    // Resume the ones whose late invoices were paid (in case a payment path missed it).
    const paused = await Company.find({ status: 'suspended', 'suspension.reason': 'overdue' }).select('_id').lean();
    for (const c of paused) if (await resumeIfNothingLate(c._id, now)) result.resumed += 1;
    return result;
};

/** The whole phase-4 cron: issue, reconcile, remind, pause, resume. */
const runInvoiceSweep = async (now = new Date()) => {
    const issued = await issueDueInvoices(now);
    const moved = await reconcileLateEntries(now);
    const collection = await runCollectionSweep(now);
    return { issued: issued.issued, waiting: issued.waiting.length, moved, ...collection };
};

/* ------------------------------------------------------------------ */
/* Telling people                                                      */
/* ------------------------------------------------------------------ */

const money = (n) => Number(n || 0).toFixed(2);
// The invoice's account in its own words (a property, a school…) — see shared/orgTerms.
const oaI = (inv) => flatTerms(inv?.company_snapshot?.org_type, true);
const oeI = (inv) => flatTerms(inv?.company_snapshot?.org_type, false);
const arMonth = (key) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
const enMonth = (key) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const arDate = (d) => new Date(d).toLocaleDateString('ar-EG', { timeZone: STORE_TIMEZONE, day: 'numeric', month: 'long' });
const enDate = (d) => new Date(d).toLocaleDateString('en-US', { timeZone: STORE_TIMEZONE, day: 'numeric', month: 'long' });

const NOTICE_COPY = {
    issued: (inv) => ({
        type: 'company_invoice_issued',
        title_en: `Invoice for ${enMonth(inv.month)} is ready`,
        title_ar: `فاتورة ${arMonth(inv.month)} جاهزة`,
        message_en: inv.amount_due > EPSILON ? `${money(inv.amount_due)} due by ${enDate(inv.due_at)}.` : 'Nothing to pay this month.',
        message_ar: inv.amount_due > EPSILON ? `المطلوب ${money(inv.amount_due)} ج قبل ${arDate(inv.due_at)}.` : 'مفيش مبلغ مطلوب الشهر ده.',
    }),
    reminder: (inv) => ({
        type: 'company_invoice_reminder',
        title_en: `Invoice ${inv.number} is due on ${enDate(inv.due_at)}`,
        title_ar: `فاتورة ${inv.number} ميعادها ${arDate(inv.due_at)}`,
        message_en: `${money(balanceOf(inv))} is still to pay.`,
        message_ar: `فاضل ${money(balanceOf(inv))} ج.`,
    }),
    due_today: (inv) => ({
        type: 'company_invoice_reminder',
        title_en: `Invoice ${inv.number} is due today`,
        title_ar: `فاتورة ${inv.number} ميعادها النهارده`,
        message_en: `${money(balanceOf(inv))} is still to pay.`,
        message_ar: `فاضل ${money(balanceOf(inv))} ج.`,
    }),
    overdue: (inv) => ({
        type: 'company_invoice_overdue',
        title_en: `Invoice ${inv.number} is overdue`,
        title_ar: `فاتورة ${inv.number} متأخرة`,
        message_en: `${money(balanceOf(inv))} is past due. Ordering on the ${oeI(inv).one} account pauses if it stays unpaid.`,
        message_ar: `${money(balanceOf(inv))} ج عدّى ميعادها. لو فضلت مش مدفوعة، الطلب على حساب ${oaI(inv).the} هيقف.`,
    }),
    payment_recorded: (inv, extra) => ({
        type: 'company_payment_recorded',
        title_en: `Payment of ${money(extra.amount)} recorded`,
        title_ar: `اتسجّل دفع ${money(extra.amount)} ج`,
        message_en: balanceOf(inv) > EPSILON ? `Invoice ${inv.number}: ${money(balanceOf(inv))} left.` : `Invoice ${inv.number} is fully paid.`,
        message_ar: balanceOf(inv) > EPSILON ? `فاتورة ${inv.number}: فاضل ${money(balanceOf(inv))} ج.` : `فاتورة ${inv.number} اتدفعت بالكامل.`,
    }),
    payment_rejected: (inv, extra) => ({
        type: 'company_payment_rejected',
        title_en: `Transfer of ${money(extra.amount)} not confirmed`,
        title_ar: `تحويل ${money(extra.amount)} ج ماتأكدش`,
        message_en: extra.reason,
        message_ar: extra.reason,
    }),
};

/** In-panel notice to every manager, plus an email for the ones that matter. */
const tellManagers = async (invoice, what, extra = {}) => {
    const copy = NOTICE_COPY[what](invoice, extra);
    await notifyManagers(invoice.company_id, copy.type, copy, { link: `/company/invoices/${invoice._id}` });
    if (['issued', 'reminder', 'due_today', 'overdue'].includes(what)) {
        await emailManagers(invoice.company_id, invoice, what).catch((err) =>
            console.error(`[Company invoice] Email failed for ${invoice.number}: ${err.message}`));
    }
};

const EMAIL_COPY = {
    issued: (inv) => ({
        subject: `فاتورة ${arMonth(inv.month)} — Ready Marine`,
        eyebrow: `حساب ${oaI(inv).the}`,
        title: `فاتورة ${arMonth(inv.month)} جاهزة`,
        body: inv.amount_due > EPSILON
            ? `المطلوب ${money(inv.amount_due)} ج، وميعاد السداد ${arDate(inv.due_at)}. الفاتورة وتفاصيل التحويل البنكي في لوحة ${oaI(inv).the}.`
            : `مفيش مبلغ مطلوب الشهر ده. الفاتورة بالتفاصيل في لوحة ${oaI(inv).the}.`,
    }),
    reminder: (inv) => ({
        subject: `تذكير: فاتورة ${inv.number}`,
        eyebrow: 'تذكير بالسداد',
        title: `ميعاد الفاتورة ${arDate(inv.due_at)}`,
        body: `فاضل ${money(balanceOf(inv))} ج على فاتورة ${arMonth(inv.month)}. بعد التحويل تقدروا ترفعوا الإيصال من لوحة ${oaI(inv).the}.`,
    }),
    due_today: (inv) => ({
        subject: `فاتورة ${inv.number} ميعادها النهارده`,
        eyebrow: 'تذكير بالسداد',
        title: 'ميعاد الفاتورة النهارده',
        body: `فاضل ${money(balanceOf(inv))} ج على فاتورة ${arMonth(inv.month)}.`,
    }),
    overdue: (inv) => ({
        subject: `فاتورة ${inv.number} متأخرة`,
        eyebrow: 'فاتورة متأخرة',
        title: 'الفاتورة عدّى ميعادها',
        body: `فاضل ${money(balanceOf(inv))} ج. لو فضلت مش مدفوعة بعد مهلة التأخير، الطلب على حساب ${oaI(inv).the} هيقف لحد السداد.`,
    }),
    paused: (inv) => ({
        subject: `الطلب على حساب ${oaI(inv).the} اتوقف مؤقتاً`,
        eyebrow: `حساب ${oaI(inv).the}`,
        title: 'الطلب اتوقف لحد سداد الفاتورة',
        body: `فاتورة ${inv.number} عدّى ميعادها ومهلة التأخير. الطلب بيرجع يشتغل لوحده أول ما تتدفع، والأوردرات المستنية بتتشحن عادي.`,
    }),
};

const emailManagers = (companyId, invoice, what) => emailCompanyManagers(companyId, {
    button: 'افتح الفاتورة',
    expiry: `الفاتورة كشف حساب بالأوردرات اللي اتطلبت على حساب ${oaI(invoice).the}.`,
    ...EMAIL_COPY[what](invoice),
    path: `/company/invoices/${invoice._id}`,
});

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * Months that have activity and no invoice yet — this month, and a month that ended
 * within the last hour — with their running total so far.
 */
const pendingMonths = async (companyId, now = new Date()) => {
    const rows = await CompanyLedgerEntry.aggregate([
        { $match: { company_id: companyId, billing_mode: { $nin: companyWallet.WALLET_MODES } } },
        { $group: { _id: '$month', total: { $sum: '$amount' }, entries: { $sum: 1 } } },
    ]);
    const invoiced = new Set((await CompanyInvoice.find({ company_id: companyId, snapshot_at: { $ne: null } }).select('month').lean()).map((i) => i.month));
    const out = [];
    for (const r of rows) {
        if (invoiced.has(r._id)) continue;
        const { ready, reason } = await monthReadyToInvoice(companyId, r._id, now);
        // Only completed orders are invoiced: say how much of the running total that is.
        const entries = await CompanyLedgerEntry.find({ company_id: companyId, month: r._id, billing_mode: { $nin: companyWallet.WALLET_MODES } })
            .select('order_id amount for_month').lean();
        const orders = await Order.find({ _id: { $in: [...new Set(entries.map((e) => String(e.order_id)))] } })
            .select('status delivered_at sub_orders.status').lean();
        const byId = new Map(orders.map((o) => [String(o._id), o]));
        const waiting = entries.filter((e) => !e.for_month && !orderSettledBy(byId.get(String(e.order_id)), null));
        const waitingTotal = round2(waiting.reduce((sum, e) => sum + Number(e.amount || 0), 0));
        out.push({
            month: r._id,
            running_total: round2(r.total),
            // What the invoice would hold if it were issued now, and what waits for delivery.
            completed_total: round2(r.total - waitingTotal),
            waiting_total: waitingTotal,
            waiting_orders: new Set(waiting.map((e) => String(e.order_id))).size,
            state: r._id >= monthKey(now) ? 'collecting' : (ready ? 'issuing' : reason),
        });
    }
    return out.sort((a, b) => b.month.localeCompare(a.month));
};

const listInvoicesFor = async (companyId) => {
    const invoices = await CompanyInvoice.find({ company_id: companyId, snapshot_at: { $ne: null } }).sort({ month: -1 }).lean();
    const pendingPayments = await CompanyPayment.find({ company_id: companyId, status: 'pending' }).select('invoice_id').lean();
    const pendingBy = new Map();
    for (const p of pendingPayments) pendingBy.set(String(p.invoice_id), (pendingBy.get(String(p.invoice_id)) || 0) + 1);
    const now = new Date();
    const rows = invoices.map((inv) => ({ ...invoiceSummary(inv, now), pending_receipts: pendingBy.get(String(inv._id)) || 0 }));
    const outstanding = round2(rows.reduce((s, r) => s + r.balance, 0));
    const overdue = round2(rows.filter((r) => r.display_status === 'overdue').reduce((s, r) => s + r.balance, 0));
    return {
        invoices: rows,
        pending_months: await pendingMonths(companyId, now),
        totals: {
            invoiced: round2(rows.reduce((s, r) => s + r.amount_due, 0)),
            paid: round2(rows.reduce((s, r) => s + r.amount_paid, 0)),
            outstanding,
            overdue,
        },
    };
};

const portalInvoices = async (userId) => {
    const { company } = await requireManager(userId);
    const settings = await getCorporateSettings();
    return { ...(await listInvoicesFor(company._id)), bank_details: settings.bank_details || null };
};

const portalInvoice = async (userId, invoiceId) => {
    const { company } = await requireManager(userId);
    return { invoice: await invoiceDetail(await loadInvoiceFor(company._id, invoiceId)) };
};

const portalReceipt = async (userId, paymentId) => {
    const { company } = await requireManager(userId);
    const payment = isObjectId(paymentId) ? await CompanyPayment.findOne({ _id: paymentId, company_id: company._id }).lean() : null;
    if (!payment) throw companyError('PAYMENT_NOT_FOUND', 'Payment not found', 404);
    return receiptFileFor(payment);
};

const adminInvoices = async (companyId) => {
    const company = await loadCompanyById(companyId);
    return listInvoicesFor(company._id);
};

const adminInvoice = async (companyId, invoiceId) => {
    const company = await loadCompanyById(companyId);
    return { invoice: await invoiceDetail(await loadInvoiceFor(company._id, invoiceId)) };
};

const adminReceipt = async (companyId, paymentId) => {
    const payment = isObjectId(paymentId) ? await CompanyPayment.findOne({ _id: paymentId, company_id: companyId }).lean() : null;
    if (!payment) throw companyError('PAYMENT_NOT_FOUND', 'Payment not found', 404);
    return receiptFileFor(payment);
};

/** Per company: what is still owed, how much of it is late, and receipts waiting — for the admin list. */
const collectionFigures = async (companyIds = []) => {
    const now = new Date();
    const [invoices, pending] = await Promise.all([
        CompanyInvoice.find({ company_id: { $in: companyIds }, snapshot_at: { $ne: null } })
            .select('company_id amount_due amount_paid status due_at').lean(),
        CompanyPayment.aggregate([
            { $match: { company_id: { $in: companyIds }, status: 'pending' } },
            { $group: { _id: '$company_id', n: { $sum: 1 } } },
        ]),
    ]);
    const out = new Map(companyIds.map((id) => [String(id), { invoiced: 0, paid: 0, outstanding: 0, overdue: 0, oldest_overdue_days: 0, pending_receipts: 0 }]));
    for (const inv of invoices) {
        const row = out.get(String(inv.company_id));
        if (!row) continue;
        row.invoiced = round2(row.invoiced + Number(inv.amount_due || 0));
        row.paid = round2(row.paid + Number(inv.amount_paid || 0));
        row.outstanding = round2(row.outstanding + balanceOf(inv));
        if (displayStatus(inv, now) === 'overdue') {
            row.overdue = round2(row.overdue + balanceOf(inv));
            row.oldest_overdue_days = Math.max(row.oldest_overdue_days, Math.floor((now - new Date(inv.due_at)) / DAY) + 1);
        }
    }
    for (const p of pending) {
        const row = out.get(String(p._id));
        if (row) row.pending_receipts = p.n;
    }
    return out;
};

/** The oldest invoice with money owed, for the portal's home card. */
const currentDue = async (companyId) => {
    const inv = await CompanyInvoice.findOne({ company_id: companyId, status: { $ne: 'paid' }, snapshot_at: { $ne: null } })
        .sort({ due_at: 1 }).lean();
    return inv ? invoiceSummary(inv) : null;
};

/** Treasury: what companies owe us — invoiced and unpaid, and this month's orders not invoiced yet. */
const receivables = async () => {
    const now = new Date();
    const invoices = await CompanyInvoice.find({ status: { $ne: 'paid' }, snapshot_at: { $ne: null } })
        .select('amount_due amount_paid due_at status').lean();
    const invoicedIds = await CompanyInvoice.find({ snapshot_at: { $ne: null } }).select('company_id month amount_due amount_paid status').lean();
    const invoicedKeys = new Set(invoicedIds.map((i) => `${i.company_id}:${i.month}`));
    const monthRows = await CompanyLedgerEntry.aggregate([
        { $match: { billing_mode: { $nin: companyWallet.WALLET_MODES } } },
        { $group: { _id: { company_id: '$company_id', month: '$month' }, total: { $sum: '$amount' } } },
    ]);
    const notInvoiced = round2(monthRows
        .filter((r) => !invoicedKeys.has(`${r._id.company_id}:${r._id.month}`))
        .reduce((s, r) => s + Math.max(0, r.total), 0));
    // Every invoice ever issued: how much of it is paid, how much is not, and how many of each.
    // A part-paid invoice counts as unpaid, with its paid part in `paid_total`.
    const billed = invoicedIds.filter((i) => Number(i.amount_due || 0) > EPSILON);
    const paidInFull = billed.filter((i) => balanceOf(i) <= EPSILON);
    return {
        invoiced_total: round2(billed.reduce((s, i) => s + Number(i.amount_due || 0), 0)),
        paid_total: round2(billed.reduce((s, i) => s + Math.min(Number(i.amount_due || 0), Number(i.amount_paid || 0)), 0)),
        invoices_count: billed.length,
        invoices_paid: paidInFull.length,
        invoices_unpaid: billed.length - paidInFull.length,
        invoiced_outstanding: round2(invoices.reduce((s, i) => s + balanceOf(i), 0)),
        overdue: round2(invoices.filter((i) => displayStatus(i, now) === 'overdue').reduce((s, i) => s + balanceOf(i), 0)),
        not_yet_invoiced: notInvoiced,
    };
};

/** Treasury: confirmed transfers, for "what came in" by month. */
// Money that actually arrived: a credit set against an invoice moved no money.
const confirmedPaymentsBetween = async (from, to) =>
    CompanyPayment.find({ status: 'confirmed', kind: { $ne: 'credit' }, paid_on: { $gte: from, $lte: to } }).select('paid_on amount').lean();

module.exports = {
    zoneOffsetMinutes,
    monthEnd,
    dueAtFor,
    monthReadyToInvoice,
    issueInvoice,
    creditInvoicesToWallet,
    issueDueInvoices,
    openMonthFrom,
    settleEndedCompany,
    settlementFor,
    recordRefund,
    reconcileLateEntries,
    runCollectionSweep,
    runInvoiceSweep,
    recordPaymentByAdmin,
    submitReceipt,
    confirmPayment,
    rejectPayment,
    resumeIfNothingLate,
    portalInvoices,
    portalInvoice,
    portalReceipt,
    adminInvoices,
    adminInvoice,
    adminReceipt,
    collectionFigures,
    currentDue,
    receivables,
    confirmedPaymentsBetween,
    invoiceSummary,
    balanceOf,
};
