/**
 * Ordering on a company account — feature 14, phase 2.
 *
 * An order "on company account" is an ordinary order with two payers. The
 * company covers as much as the employee's limit and its own monthly cap allow;
 * whatever is left the employee pays online at checkout (card or wallet). A
 * manager ordering for a company car has only the cap and no personal part.
 *
 * The company's side of the money is kept in CompanyLedgerEntry, and enforced
 * through CompanySpendCounter, which is moved only by conditional atomic
 * increments: the limit check and the spend are one operation, so two orders
 * placed together cannot both fit under the same remaining limit.
 *
 * Refunds follow the order's split: if the company covered 80% of an order, 80%
 * of any refund comes off the company's bill (and back to the limit, in the
 * order's month) and 20% goes back to the employee's wallet.
 *
 * Phase 2 is instant delivery only; consolidation (phase 3) adds batches.
 */
const ExcelJS = require('exceljs');

const { User } = require('../models/users');
const { Order } = require('../models/orders');
const { Company, CompanyMembership } = require('../models/companies');
const { CompanyLedgerEntry, CompanySpendCounter } = require('../models/companyLedger');
const walletService = require('./walletService');
const companyWallet = require('./companyWalletService');
const {
    companyError,
    round2,
    sameId,
    isObjectId,
    monthKey,
    renewalDate,
    effectiveLimit,
    findGroup,
    findOffice,
    activeOffices,
    resolveCompanyContext,
    requireManager,
    loadCompanyById,
} = require('./companyService');

const EPSILON = 0.005;

const carLabel = (car) => (car ? [car.plate, [car.make, car.model].filter(Boolean).join(' ')].filter(Boolean).join(' — ') : '');

/* ------------------------------------------------------------------ */
/* Who is ordering, for what, delivered where                          */
/* ------------------------------------------------------------------ */

/**
 * Everything the server needs to know about a company checkout, re-derived
 * from the caller's membership. The client names a beneficiary, a car and an
 * office; each is checked against the company the caller actually belongs to.
 */
const resolveCheckoutContext = async (userId, selection = {}) => {
    // A person in several companies picks which one pays (strict: never a company they
    // did not choose). With no choice made, their first company is used.
    const companyId = selection.company_id && isObjectId(selection.company_id) ? selection.company_id : null;
    const { membership, company } = await resolveCompanyContext(userId, { companyId, strict: !!companyId });
    if (!company) throw companyError('NOT_IN_COMPANY', 'You are not part of that company account', 403);
    if (company.status === 'ended') {
        throw companyError('COMPANY_ENDED', 'This company account has ended', 409);
    }
    if (company.status === 'suspended') {
        throw companyError('COMPANY_SUSPENDED', 'Ordering on the company account is temporarily paused', 409);
    }

    // The delivery mode is the person's choice, among the ones the company allows. With
    // nothing chosen, instant stays the default (what every client did before phase 3).
    const modes = companyModes(company);
    let deliveryMode = selection.delivery_mode;
    if (!['instant', 'consolidate'].includes(deliveryMode)) deliveryMode = modes.instant ? 'instant' : 'consolidate';
    if (deliveryMode === 'instant' && !modes.instant) {
        throw companyError('INSTANT_MODE_OFF', 'Your company only allows consolidated delivery to the branch', 409);
    }
    if (deliveryMode === 'consolidate' && !modes.consolidate) {
        throw companyError('CONSOLIDATE_MODE_OFF', 'Your company does not consolidate orders to the branch', 409);
    }

    const beneficiary = selection.beneficiary
        || (membership.is_employee ? 'employee' : (membership.is_manager ? 'car' : null));

    let car = null;
    if (beneficiary === 'employee') {
        if (!membership.is_employee) throw companyError('NOT_EMPLOYEE', 'You do not have a limit on this company account', 403);
        // Paused by the company's manager — typically someone who has left the job.
        if (membership.deactivated_at) {
            throw companyError('EMPLOYEE_DEACTIVATED', "Your company's manager has paused your ordering on this account", 403);
        }
    } else if (beneficiary === 'car') {
        if (!membership.is_manager) throw companyError('NOT_COMPANY_MANAGER', 'Only a manager can order for company cars', 403);
        if (!selection.car_id) throw companyError('CAR_REQUIRED', 'Choose which company car this order is for', 400);
        car = (company.cars || []).find((c) => sameId(c._id, selection.car_id) && c.active !== false) || null;
        if (!car) throw companyError('CAR_NOT_FOUND', 'That company car does not exist', 404);
    } else {
        throw companyError('NOT_EMPLOYEE', 'You do not have a limit on this company account', 403);
    }

    let office = null;
    if (selection.office_id) {
        office = findOffice(company, selection.office_id);
        if (!office || office.active === false) throw companyError('OFFICE_NOT_FOUND', 'That branch does not exist', 404);
    } else if (deliveryMode === 'consolidate') {
        // Consolidated orders always go to an office: the person's own, or the first one.
        const own = findOffice(company, membership.office_id);
        office = own && own.active !== false ? own : (activeOffices(company)[0] || null);
        if (!office) throw companyError('OFFICE_REQUIRED', 'Choose the branch to deliver to', 400);
    }

    return { company, membership, beneficiary, car, office, delivery_mode: deliveryMode };
};

/** Which delivery modes a company allows. Both default to on. */
const companyModes = (company) => ({
    instant: company.modes?.instant !== false,
    consolidate: company.modes?.consolidate !== false,
});

/** Vendor ids the person chose to send at once in a consolidated order. */
const cleanShipNow = (list) => (Array.isArray(list) ? list : [])
    .map((v) => String(v || '').trim())
    .filter((v) => /^[a-f0-9]{24}$/i.test(v))
    .slice(0, 50);

/**
 * An office delivery replaces whatever address the browser sent: the parcel
 * goes to the office's reception, labelled with the employee's name so it can
 * be handed to them.
 */
const applyOfficeDelivery = (orderData, ctx, user) => {
    if (!ctx.office) return orderData;
    const office = ctx.office;
    return {
        ...orderData,
        shipping_address: {
            recipient_name: `${user.name || ''} — ${office.recipient_name}`.trim().replace(/^—\s*/, ''),
            phone: office.phone,
            full_address: `${ctx.company.name} — ${office.name}: ${office.full_address}`,
        },
        shipping_destination: office.shipping_country
            ? { country: office.shipping_country, city: office.shipping_city || null }
            : orderData.shipping_destination || null,
    };
};

/* ------------------------------------------------------------------ */
/* Counters: what is left, and taking from it                          */
/* ------------------------------------------------------------------ */

const counterFilter = (companyId, month, userId = null) => ({
    company_id: companyId,
    month,
    scope: userId ? 'user' : 'company',
    user_id: userId || null,
});

const readCounter = async (companyId, month, userId = null) => {
    const row = await CompanySpendCounter.findOne(counterFilter(companyId, month, userId)).select('amount').lean();
    return round2(row?.amount || 0);
};

const ensureCounter = async (companyId, month, userId = null) => {
    try {
        await CompanySpendCounter.updateOne(
            counterFilter(companyId, month, userId),
            { $setOnInsert: { amount: 0, updated_at: new Date() } },
            { upsert: true }
        );
    } catch (err) {
        // Two first orders of the month racing to create the same row: the other won.
        if (err.code !== 11000) throw err;
    }
};

/** Add to a counter only if it stays at or under `ceiling`. Returns false when it would not. */
const incrementWithin = async (filter, amount, ceiling) => {
    const updated = await CompanySpendCounter.findOneAndUpdate(
        { ...filter, amount: { $lte: round2(ceiling - amount) + EPSILON } },
        { $inc: { amount }, $set: { updated_at: new Date() } },
        { returnDocument: 'after' }
    );
    return !!updated;
};

const incrementUnconditionally = async (filter, amount) => {
    await CompanySpendCounter.updateOne(filter, { $inc: { amount }, $set: { updated_at: new Date() } }, { upsert: true });
};

/**
 * Where this company, and this employee, stand in `month`.
 * `remaining` is what the company would cover on the next order.
 */
const standing = async (ctx, month = monthKey()) => {
    const freshCompany = companyWallet.isWallet(ctx.company) ? await Company.findById(ctx.company._id).lean() : ctx.company;
    const cap = round2(companyWallet.creditLimit(freshCompany));
    const capUsed = await readCounter(ctx.company._id, month);
    const remainingCap = companyWallet.isWallet(ctx.company) ? cap : round2(Math.max(0, cap - capUsed));

    if (ctx.beneficiary !== 'employee') {
        return { month, cap, cap_used: capUsed, remaining_cap: remainingCap, limit: null, spent: null, remaining_limit: null, remaining: remainingCap };
    }

    const { limit, source } = effectiveLimit(ctx.company, ctx.membership);
    const spent = await readCounter(ctx.company._id, month, ctx.membership.user_id);
    // No limit of their own (the company switched employee limits off): only the cap stands.
    const remainingLimit = limit === null ? null : round2(Math.max(0, limit - spent));
    return {
        month,
        cap,
        cap_used: capUsed,
        remaining_cap: remainingCap,
        limit,
        limit_source: source,
        spent,
        remaining_limit: remainingLimit,
        remaining: remainingLimit === null ? remainingCap : round2(Math.min(remainingLimit, remainingCap)),
    };
};

/**
 * Whether an order of `total` fits what is left, and if not, which rule it breaks. The
 * company pays a company order in FULL or not at all: an order bigger than what is left
 * is refused, and the person places it from their own account instead (no split).
 *
 * @returns {string|null} null when it fits; otherwise the reason code
 */
const overLimitReason = (ctx, where, total) => {
    const amount = round2(total);
    if (companyWallet.isWallet(ctx.company) && amount > where.remaining_cap + EPSILON) return 'COMPANY_WALLET_INSUFFICIENT';
    if (ctx.beneficiary === 'car') {
        return amount > where.remaining_cap + EPSILON || where.remaining_cap <= EPSILON ? 'COMPANY_CAP_REACHED' : null;
    }
    if (where.remaining_limit !== null && where.remaining_limit <= EPSILON) return 'LIMIT_USED_UP';
    if (where.remaining_limit !== null && amount > where.remaining_limit + EPSILON) return 'LIMIT_NOT_ENOUGH';
    if (amount > where.remaining_cap + EPSILON) return 'COMPANY_CAP_REACHED';
    return null;
};

const OVER_LIMIT_MESSAGES = {
    COMPANY_WALLET_INSUFFICIENT: 'The company wallet (and its credit, if it has any) must cover the entire order. Ask the manager to top up the company wallet.',
    LIMIT_USED_UP: 'Your limit for this month is used up',
    LIMIT_NOT_ENOUGH: 'This order is more than what is left on your limit — place it from your own account',
    COMPANY_CAP_REACHED: "This order goes over the company's monthly spending cap",
};

/**
 * Take `amount` from the company's month (and the employee's, for their own
 * orders), refusing if either would go over. Both are conditional increments;
 * if the second refuses, the first is put back.
 */
const reserveSpend = async ({ ctx, month, amount, orderId = null }) => {
    if (amount <= EPSILON) return;
    const companyId = ctx.company._id;
    const employeeId = ctx.beneficiary === 'employee' ? ctx.membership.user_id : null;

    await ensureCounter(companyId, month);
    if (employeeId) await ensureCounter(companyId, month, employeeId);

    const prepaid = companyWallet.isWallet(ctx.company);
    if (prepaid) {
        if (!orderId) throw new Error('Company wallet checkout requires an order ID');
        await companyWallet.move({ companyId, deltaMinor: -companyWallet.toMinor(amount), key: `order:${orderId}:charge`, kind: 'purchase', orderId, reason: 'Company order' });
    }
    let companyOk = false;
    try {
        companyOk = prepaid
            ? (await incrementUnconditionally(counterFilter(companyId, month), amount), true)
            : await incrementWithin(counterFilter(companyId, month), amount, ctx.company.monthly_cap);
    if (!companyOk) {
        throw companyError('COMPANY_CAP_REACHED', "This order goes over the company's monthly spending cap", 409);
    }
    if (employeeId) {
        const { limit } = effectiveLimit(ctx.company, ctx.membership);
        // Still counted with no limit, so the manager sees what each person spent.
        const employeeOk = limit === null
            ? (await incrementUnconditionally(counterFilter(companyId, month, employeeId), amount), true)
            : await incrementWithin(counterFilter(companyId, month, employeeId), amount, limit);
        if (!employeeOk) {
            throw companyError('COMPANY_LIMIT_CHANGED', 'Your remaining limit changed. Please review the order again.', 409);
        }
    }
    } catch (err) {
        if (companyOk) await incrementUnconditionally(counterFilter(companyId, month), -amount);
        if (prepaid) await companyWallet.move({ companyId, deltaMinor: companyWallet.toMinor(amount), key: `order:${orderId}:reserve-release`, kind: 'reversal', orderId, reason: 'Company checkout reservation failed' });
        throw err;
    }
};

/** Give back what `reserveSpend` took. */
const releaseSpend = async ({ companyId, userId = null, month, amount }) => {
    if (!(amount > EPSILON)) return;
    await incrementUnconditionally(counterFilter(companyId, month), -amount);
    if (userId) await incrementUnconditionally(counterFilter(companyId, month, userId), -amount);
};

/** The counters' owner for an order already placed. */
const orderCounterOwner = (order) => ({
    companyId: order.company.company_id,
    userId: order.company.beneficiary === 'employee' ? order.user_id : null,
    month: order.company.month,
});

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

/**
 * What checkout shows for the company option on THIS basket. Never throws for
 * an ineligible customer — it says why, so the option can be shown disabled
 * with the reason instead of vanishing.
 */
const previewForCheckout = async (userId, selection = {}, total = 0, parcels = []) => {
    const { listMemberships } = require('./companyService');
    // An ended contract is no longer a way to pay (its managers keep the portal only).
    const rows = (await listMemberships(userId)).filter((r) => r.company.status !== 'ended');
    if (!rows.length) return { eligible: false };
    // A person in several companies chooses which one this order is for.
    const chosen = (selection.company_id && rows.find((r) => sameId(r.company._id, selection.company_id))) || rows[0];
    const { membership, company } = chosen;

    const activeCars = (company.cars || []).filter((c) => c.active !== false);
    const eligible = !!membership.is_employee || (!!membership.is_manager && activeCars.length > 0);
    const base = {
        eligible,
        company: { _id: company._id, name: company.name, org_type: company.org_type || 'company', billing_mode: company.billing_mode || 'monthly' },
        companies: rows.map((r) => ({
            _id: r.company._id,
            name: r.company.name,
            org_type: r.company.org_type || 'company',
            is_employee: !!r.membership.is_employee,
            is_manager: !!r.membership.is_manager,
        })),
        roles: { employee: !!membership.is_employee, manager: !!membership.is_manager },
        cars: membership.is_manager ? activeCars.map((c) => ({ _id: c._id, label: carLabel(c) })) : [],
        offices: activeOffices(company).map((o) => ({
            _id: o._id,
            name: o.name,
            recipient_name: o.recipient_name,
            phone: o.phone,
            full_address: o.full_address,
            shipping_country: o.shipping_country || null,
            shipping_city: o.shipping_city || null,
        })),
        default_office_id: (findOffice(company, membership.office_id) || activeOffices(company)[0])?._id || null,
        renews_on: renewalDate(monthKey()),
        modes: companyModes(company),
    };
    if (!eligible) return { ...base, available: false, reason: 'NOT_EMPLOYEE' };

    let ctx;
    try {
        ctx = await resolveCheckoutContext(userId, {
            company_id: company._id,
            beneficiary: selection.beneficiary,
            car_id: selection.car_id,
            office_id: selection.office_id,
            delivery_mode: selection.delivery_mode,
        });
    } catch (err) {
        return { ...base, available: false, reason: err.code || 'UNAVAILABLE' };
    }

    // Consolidated: what each parcel would join, and what it could save.
    let consolidation = null;
    if (ctx.delivery_mode === 'consolidate' && ctx.office) {
        const shipNow = new Set(cleanShipNow(selection.ship_now_vendor_ids));
        consolidation = await require('./companyBatchService').checkoutBatchInfo({
            company: ctx.company,
            officeId: ctx.office._id,
            parcels,
        }).catch((err) => {
            console.error('[Company] batch preview failed:', err.message);
            return null;
        });
        if (consolidation) {
            consolidation.office_id = ctx.office._id;
            consolidation.parcels = consolidation.parcels.map((p) => ({ ...p, ship_now: shipNow.has(String(p.vendor_id)) }));
        }
    }

    const where = await standing(ctx);
    const reason = overLimitReason(ctx, where, total);

    return {
        ...base,
        available: !reason,
        reason,
        beneficiary: ctx.beneficiary,
        limit: where.limit,
        spent: where.spent,
        remaining_limit: where.remaining_limit,
        remaining_cap: where.remaining_cap,
        remaining: where.remaining,
        // All or nothing: the company pays the whole order, or the option is closed.
        company_amount: reason ? 0 : round2(total),
        personal_amount: 0,
        order_total: round2(total),
        delivery_mode: ctx.delivery_mode,
        office_id: ctx.office?._id || null,
        consolidation,
    };
};

const capAlerts = () => require('./companyCapAlertService');

/**
 * Place an order on the company account. Called by POST /api/orders.
 *
 * The company pays the whole order or none of it: an order above what is left on
 * the limit (or the cap) is refused, and the person places it from their own account.
 *
 * @returns {{ order }}
 */
const placeCompanyOrder = async (userId, orderData = {}) => {
    const { getPricedOrderPreview, placeOrder } = require('./orderService');
    const selection = orderData.company || {};
    const ctx = await resolveCheckoutContext(userId, selection);
    const user = await User.findById(userId).select('name').lean();

    const payload = applyOfficeDelivery({ ...orderData }, ctx, user || {});
    delete payload.company;

    const preview = await getPricedOrderPreview({
        userId,
        items: payload.items,
        couponCode: payload.coupon_code || '',
        shippingDestination: payload.shipping_destination || null,
        shippingMethodId: payload.shipping_method_id || null,
        redeemPoints: payload.redeem_points || 0,
    });
    const total = round2(preview.total);
    const month = monthKey();
    const where = await standing(ctx, month);
    // The company pays the whole order or none of it. Bigger than what is left → refused;
    // the person orders it from their own account instead.
    const reason = overLimitReason(ctx, where, total);
    if (reason) {
        if (reason === 'COMPANY_CAP_REACHED') await capAlerts().checkCapAlerts(ctx.company, { month, refused: true });
        const err = companyError(reason, OVER_LIMIT_MESSAGES[reason], 409);
        err.details = { total, remaining: where.remaining };
        throw err;
    }

    if (companyWallet.isWallet(ctx.company) && ctx.beneficiary === 'car') {
        const budget = await companyWallet.allocationBudget(ctx.company);
        if (total > budget.available_to_allocate + EPSILON) throw companyError('COMPANY_ALLOCATION_EXCEEDED', 'This amount is allocated to employees. Reduce their limits or top up before ordering for a company car.', 409);
    }

    const companyInfo = {
        order_id: new (require('mongoose').Types.ObjectId)(),
        billing_mode: ctx.company.billing_mode || 'monthly',
        company_id: ctx.company._id,
        company_name: ctx.company.name,
        org_type: ctx.company.org_type || 'company',
        membership_id: ctx.membership._id,
        beneficiary: ctx.beneficiary,
        car_id: ctx.car?._id || null,
        car_label: carLabel(ctx.car),
        office_id: ctx.office?._id || null,
        office_name: ctx.office?.name || '',
        delivery_mode: ctx.delivery_mode,
        ship_now_vendor_ids: ctx.delivery_mode === 'consolidate' ? cleanShipNow(selection.ship_now_vendor_ids) : [],
        month,
        company_amount: total,
        personal_amount: 0,
        personal_method: null,
    };

    try {
        await reserveSpend({ ctx, month, amount: total, orderId: companyInfo.order_id });
    } catch (err) {
        if (err.code === 'COMPANY_CAP_REACHED') await capAlerts().checkCapAlerts(ctx.company, { month, refused: true });
        throw err;
    }
    try {
        const order = await placeOrder(userId, { ...payload, payment_method: 'company_account' }, { company: companyInfo });
        await capAlerts().checkCapAlerts(ctx.company, { month });
        return { order };
    } catch (err) {
        // Order creation may have succeeded before a notification/coupon hook failed.
        // Never return its money while a real order still exists.
        const placed = await Order.findById(companyInfo.order_id);
        if (placed) return { order: placed };
        await releaseSpend({
            companyId: ctx.company._id,
            userId: ctx.beneficiary === 'employee' ? ctx.membership.user_id : null,
            month,
            amount: total,
        }).catch((e) => console.error(`[Company] Could not release a checkout hold: ${e.message}`));
        if (companyWallet.isWallet(ctx.company)) {
            await companyWallet.move({ companyId: ctx.company._id, deltaMinor: companyWallet.toMinor(total), key: `order:${companyInfo.order_id}:placement-release`, kind: 'reversal', orderId: companyInfo.order_id, reason: 'Company order could not be created' });
        }
        throw err;
    }
};

/* ------------------------------------------------------------------ */
/* Ledger writes                                                       */
/* ------------------------------------------------------------------ */

/** Insert once; a retry with the same key is reported as a duplicate, not an error. */
const insertEntry = async (entry, { allowNegative = false } = {}) => {
    if (companyWallet.isWalletMode(entry.billing_mode) && Math.abs(entry.amount) > EPSILON) {
        // Every row here follows an order already placed (its charge was taken at
        // checkout under the status check), so a paused company still settles it — and
        // so does one that has moved to an invoice since (`settling`).
        await companyWallet.move({
            companyId: entry.company_id, deltaMinor: -companyWallet.toMinor(entry.amount),
            key: entry.idempotency_key, kind: entry.amount > 0 ? 'purchase' : 'refund',
            orderId: entry.order_id, reason: entry.reason, allowInactive: true, allowNegative, settling: true,
        });
    }
    try {
        await CompanyLedgerEntry.create(entry);
        return { duplicate: false };
    } catch (err) {
        if (err.code === 11000) return { duplicate: true };
        throw err;
    }
};

/**
 * Which month's ledger an event on this order is booked in.
 *
 * Normally the order's own month — the one it counts against. Once that month's invoice is
 * issued (phase 4) it is closed: anything that happens to the order afterwards is booked on
 * the current month instead, as an adjustment on the next invoice, and the limits are left
 * alone — the order's month is over, and the current month's limit was never spent on it.
 */
const bookingFor = async (order) => {
    const month = order.company.month;
    if (companyWallet.isWalletMode(order.company.billing_mode)) return { month, late: false, for_month: null };
    const { CompanyInvoice } = require('../models/companyInvoices');
    // An order not complete when its month was invoiced had its rows moved to a later
    // month (companyInvoiceService.deferOpenOrders): what happens to it next is booked
    // beside its charge, so its invoice line still shows the order whole.
    const charge = await CompanyLedgerEntry.findOne({ idempotency_key: `order:${order._id}:charge` }).select('month deferred_from').lean();
    const home = charge?.month || month;
    const invoiced = await CompanyInvoice.exists({ company_id: order.company.company_id, month: home });
    if (!invoiced) return { month: home, late: false, for_month: null, deferred_from: charge?.deferred_from || null };
    // Normally the current month; after an ended contract's final invoice, the next one.
    const { openMonthFrom } = require('./companyInvoiceService');
    return { month: await openMonthFrom(order.company.company_id, monthKey()), late: true, for_month: month };
};

const baseEntry = (order, booking = null) => ({
    billing_mode: order.company.billing_mode || 'monthly',
    company_id: order.company.company_id,
    month: booking?.month || order.company.month,
    for_month: booking?.late ? booking.for_month : null,
    deferred_from: booking?.deferred_from || null,
    user_id: order.user_id,
    beneficiary: order.company.beneficiary,
    car_id: order.company.car_id || null,
    car_label: order.company.car_label || '',
    order_id: order._id,
    order_reference: order.transaction?.reference || '',
});

/**
 * Book the company's share of a freshly placed order. The limit was already
 * taken at checkout (reserveSpend), so this only writes the history row.
 */
const recordCharge = async (order) => {
    if (!order?.company) return;
    await insertEntry({
        ...baseEntry(order, await bookingFor(order)),
        kind: 'charge',
        amount: round2(order.company.company_amount),
        personal_amount: round2(order.company.personal_amount),
        reason: order.company.beneficiary === 'car' ? `Order for company car ${order.company.car_label}` : 'Order on company account',
        idempotency_key: `order:${order._id}:charge`,
        actor: { role: 'user', label: '' },
    });
};

/**
 * How much of an amount refunded (or re-charged) on this order is the
 * company's, and how much the employee's — in the same proportion the order
 * was paid.
 */
const splitAmount = (order, amount) => {
    const total = Number(order.total_price || 0);
    const companyShare = Number(order.company?.company_amount || 0);
    const value = round2(Math.max(0, Number(amount) || 0));
    if (total <= 0 || companyShare >= total) return { company: value, personal: 0 };
    const company = round2(value * (companyShare / total));
    return { company, personal: round2(value - company) };
};

/**
 * Money back on a company order: the company's part off its bill (and back to
 * the limit of the order's month), the employee's part to their wallet.
 *
 * `key` must identify the event (a parcel's cancellation, a refund) so that
 * retrying moves the money once.
 */
const refundShare = async ({ order, amount, key, subOrderId = null, refundId = null, reason = '', actor = {} }) => {
    if (!order?.company) throw companyError('NOT_COMPANY_ORDER', 'This order was not placed on a company account', 400);
    const split = splitAmount(order, amount);
    const booking = await bookingFor(order);

    let duplicate = true;
    if (split.company > EPSILON) {
        const res = await insertEntry({
            ...baseEntry(order, booking),
            kind: 'credit',
            amount: -split.company,
            personal_amount: split.personal,
            sub_order_id: subOrderId,
            refund_id: refundId,
            reason,
            idempotency_key: `${key}:company`,
            actor: { role: actor.role || 'system', label: actor.label || '' },
        });
        duplicate = res.duplicate;
        // After the invoice, the credit comes off the next invoice; the limit is untouched.
        if (!res.duplicate && !booking.late) {
            const owner = orderCounterOwner(order);
            await releaseSpend({ ...owner, amount: split.company });
        }
    }

    if (split.personal > EPSILON) {
        const res = await walletService.refundOrder({
            userId: order.user_id,
            amountMinor: walletService.toMinor(split.personal),
            orderId: order._id,
            reason: reason || 'Refund of the part you paid on a company order',
            idempotencyKey: `${key}:personal`,
            actor,
        });
        duplicate = duplicate && !!res?.duplicate;
    }

    return { ...split, duplicate };
};

/**
 * Reinstating a cancelled parcel: the company is charged its part again. The
 * limit is not checked — an admin is undoing their own cancellation — but the
 * counters move, so the employee's remaining limit reflects it. The employee's
 * part is re-charged by the caller, through the wallet, exactly as before.
 */
const chargeBack = async ({ order, amount, key, subOrderId = null, reason = '', actor = {} }) => {
    const split = splitAmount(order, amount);
    if (split.company > EPSILON) {
        const booking = await bookingFor(order);
        const res = await insertEntry({
            ...baseEntry(order, booking),
            kind: 'charge',
            amount: split.company,
            personal_amount: split.personal,
            sub_order_id: subOrderId,
            reason,
            idempotency_key: key,
            actor: { role: actor.role || 'admin', label: actor.label || '' },
        });
        if (!res.duplicate && !booking.late) {
            const owner = orderCounterOwner(order);
            await incrementUnconditionally(counterFilter(owner.companyId, owner.month), split.company);
            if (owner.userId) await incrementUnconditionally(counterFilter(owner.companyId, owner.month, owner.userId), split.company);
        }
    }
    return split;
};

/**
 * Shipping given back when a consolidation batch closes (phase 3).
 *
 * Unlike a return, this is not split in proportion: the person gets back what they paid
 * out of pocket FIRST (to their wallet, up to what they paid on this order), and only the
 * rest goes back to the company — off its bill and back onto the limit. They topped up
 * with their own money because the full shipping was held; that is the money the saving
 * should replace first.
 *
 * Idempotent on `key`. The caller lowers the order's own figures afterwards.
 */
const returnBatchSavings = async ({ order, amount, key, subOrderId = null, batchId = null, actor = {} }) => {
    if (!order?.company) throw companyError('NOT_COMPANY_ORDER', 'This order was not placed on a company account', 400);
    const value = round2(Math.max(0, Number(amount) || 0));
    const personal = round2(Math.min(value, Math.max(0, Number(order.company.personal_amount || 0))));
    const company = round2(value - personal);
    const booking = await bookingFor(order);

    if (company > EPSILON) {
        const res = await insertEntry({
            ...baseEntry(order, booking),
            kind: 'credit',
            amount: -company,
            personal_amount: personal,
            sub_order_id: subOrderId,
            batch_id: batchId,
            reason: 'Shipping saved by the company batch',
            idempotency_key: `${key}:company`,
            actor: { role: actor.role || 'system', label: actor.label || '' },
        });
        if (!res.duplicate && !booking.late) await releaseSpend({ ...orderCounterOwner(order), amount: company });
    } else if (personal > EPSILON) {
        // Nothing back to the company, but the statement still shows the saving happened.
        await insertEntry({
            ...baseEntry(order, booking),
            kind: 'credit',
            amount: 0,
            personal_amount: personal,
            sub_order_id: subOrderId,
            batch_id: batchId,
            reason: 'Shipping saved by the company batch',
            idempotency_key: `${key}:company`,
            actor: { role: actor.role || 'system', label: actor.label || '' },
        });
    }

    if (personal > EPSILON) {
        await walletService.refundOrder({
            userId: order.user_id,
            amountMinor: walletService.toMinor(personal),
            orderId: order._id,
            reason: 'Shipping saved by your company batch',
            idempotencyKey: `${key}:personal`,
            actor,
        });
    }
    return { company, personal };
};

/**
 * An order left a batch after it closed, so the colleagues still in it now share a
 * parcel whose shipping is more than their promised shares add up to. They are never
 * charged again; the company absorbs the difference on its statement. It does not come
 * off anybody's limit — only the company's month moves.
 */
const absorbShippingDifference = async ({ order, amount, key, batchId = null, actor = {} }) => {
    const value = round2(Math.max(0, Number(amount) || 0));
    if (!order?.company || value <= EPSILON) return { absorbed: 0, duplicate: false };
    const booking = await bookingFor(order);
    const res = await insertEntry({
        ...baseEntry(order, booking),
        kind: 'charge',
        amount: value,
        personal_amount: 0,
        batch_id: batchId,
        reason: "Shipping difference: an order left a combined parcel, the company covers the rest",
        idempotency_key: key,
        actor: { role: actor.role || 'system', label: actor.label || '' },
    // A prepaid company owes this even when its wallet is empty (owner's call,
    // 2026-09-30): the balance goes below zero and the next top-up pays it first.
    }, { allowNegative: true });
    if (!res.duplicate && !booking.late) {
        await incrementUnconditionally(counterFilter(order.company.company_id, order.company.month), value);
    }
    return { absorbed: value, duplicate: res.duplicate };
};

/** Release the hold a card checkout took when its payment never became an order. */
const releaseCheckoutHold = async (companyCheckout) => {
    if (!companyCheckout?.reserved || !(companyCheckout.company_amount > 0)) return;
    const membership = companyCheckout.membership_id
        ? await CompanyMembership.findById(companyCheckout.membership_id).select('user_id').lean()
        : null;
    await releaseSpend({
        companyId: companyCheckout.company_id,
        userId: companyCheckout.beneficiary === 'employee' ? membership?.user_id || null : null,
        month: companyCheckout.month,
        amount: companyCheckout.company_amount,
    });
};

/* ------------------------------------------------------------------ */
/* Reading the ledger                                                  */
/* ------------------------------------------------------------------ */

const itemSummary = (items = []) => items.map((i) => ({
    title: i.product_title,
    variant: i.variant_label || '',
    quantity: i.quantity,
    unit_price: round2(i.unit_price),
}));

/**
 * One month of a company's account: every charge and credit, what was in each
 * order, and a summary per employee and per car.
 */
const buildPurchases = async (company, { month = monthKey(), userId = null, carId = null } = {}) => {
    // The month a purchase BELONGS to — where it was first booked — not the month it is
    // invoiced in: an order still on its way at month end is invoiced later (`deferred_from`).
    const filter = { company_id: company._id, $or: [{ deferred_from: month }, { deferred_from: null, month }] };
    if (userId && isObjectId(userId)) filter.user_id = userId;
    if (carId && isObjectId(carId)) filter.car_id = carId;

    const entries = await CompanyLedgerEntry.find(filter).sort({ created_at: -1 }).lean();
    const [users, orders] = await Promise.all([
        User.find({ _id: { $in: [...new Set(entries.map((e) => String(e.user_id)))] } }).select('name email phone').lean(),
        Order.find({ _id: { $in: [...new Set(entries.map((e) => String(e.order_id)))] } })
            .select('items sub_orders total_price shipping_address company status created_at transaction.reference coupon_discount_amount loyalty.redemption_discount shipping.total_cost')
            .lean(),
    ]);
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const orderMap = new Map(orders.map((o) => [String(o._id), o]));

    const memberships = await CompanyMembership.find({ company_id: company._id, user_id: { $in: users.map((u) => u._id) } })
        .select('user_id group_id').lean();
    const groupByUser = new Map(memberships.map((m) => [String(m.user_id), findGroup(company, m.group_id)?.name || null]));

    const rows = entries.map((e) => {
        const order = orderMap.get(String(e.order_id));
        const u = userMap.get(String(e.user_id));
        const subItems = e.sub_order_id && order
            ? (order.items || []).filter((i) => sameId(i.sub_order_id, e.sub_order_id))
            : null;
        return {
            _id: e._id,
            kind: e.kind,
            created_at: e.created_at,
            amount: round2(e.amount),
            personal_amount: round2(e.personal_amount),
            beneficiary: e.beneficiary,
            car_label: e.car_label || '',
            reason: e.reason || '',
            // Booked here because the order's own month was already invoiced (phase 4).
            for_month: e.for_month || null,
            user: u ? { _id: u._id, name: u.name, email: u.email || null, phone: u.phone || null } : null,
            group_name: e.beneficiary === 'employee' ? (groupByUser.get(String(e.user_id)) || null) : null,
            order: order ? {
                _id: order._id,
                reference: order.transaction?.reference || e.order_reference,
                status: order.status,
                total: round2(order.total_price),
                shipping: round2(order.shipping?.total_cost || 0),
                office_name: order.company?.office_name || '',
                items: itemSummary(subItems || order.items),
            } : null,
        };
    });

    const byEmployee = new Map();
    const byCar = new Map();
    let charged = 0;
    let credited = 0;
    for (const r of rows) {
        if (r.kind === 'charge') charged += r.amount; else credited += -r.amount;
        const bucket = r.beneficiary === 'car' ? byCar : byEmployee;
        const key = r.beneficiary === 'car' ? (r.car_label || '—') : String(r.user?._id || '');
        if (!bucket.has(key)) {
            bucket.set(key, {
                key,
                name: r.beneficiary === 'car' ? r.car_label : (r.user?.name || ''),
                email: r.user?.email || null,
                phone: r.user?.phone || null,
                group_name: r.group_name,
                orders: 0,
                charged: 0,
                credited: 0,
                net: 0,
                personal: 0,
            });
        }
        const b = bucket.get(key);
        if (r.kind === 'charge') {
            b.orders += 1;
            b.charged = round2(b.charged + r.amount);
            b.personal = round2(b.personal + r.personal_amount);
        } else {
            b.credited = round2(b.credited - r.amount);
            b.personal = round2(b.personal - r.personal_amount);
        }
        b.net = round2(b.charged - b.credited);
    }

    const months = [...new Set([
        ...await CompanyLedgerEntry.distinct('month', { company_id: company._id, deferred_from: null }),
        ...await CompanyLedgerEntry.distinct('deferred_from', { company_id: company._id, deferred_from: { $ne: null } }),
    ])];
    if (!months.includes(monthKey())) months.push(monthKey());

    return {
        month,
        months: months.sort().reverse(),
        totals: { charged: round2(charged), credited: round2(credited), net: round2(charged - credited) },
        rows,
        by_employee: [...byEmployee.values()].sort((a, b) => b.net - a.net),
        by_car: [...byCar.values()].sort((a, b) => b.net - a.net),
    };
};

const getPortalPurchases = async (userId, query = {}) => {
    const { company } = await requireManager(userId);
    return buildPurchases(company, { month: query.month || monthKey(), userId: query.user_id, carId: query.car_id });
};

const getAdminPurchases = async (companyId, query = {}) => {
    const company = await loadCompanyById(companyId);
    return buildPurchases(company, { month: query.month || monthKey(), userId: query.user_id, carId: query.car_id });
};

/**
 * The month as a workbook: every line, plus a per-employee totals sheet the
 * company's accountant can deduct salaries from.
 */
const buildPurchasesWorkbook = async (company, data) => {
    // Sheet and column names in the account's own words (shared/orgTerms).
    const oa = require('./shared/orgTerms').flatTerms(company.org_type, true);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ReadyCar';
    wb.created = new Date();
    const header = (ws, titles, widths) => {
        ws.columns = widths.map((width) => ({ width }));
        const row = ws.addRow(titles);
        row.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        });
        row.height = 28;
    };
    const MONEY = '#,##0.00';

    const lines = wb.addWorksheet('المشتريات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    header(lines, ['التاريخ', 'رقم الأوردر', `${oa.theMember} / العربية`, 'الجروب', 'النوع', 'المنتجات', `نصيب ${oa.the}`, `دفعه ${oa.theMember}`, `${oa.theBranch}`], [14, 18, 26, 16, 12, 60, 14, 14, 18]);
    for (const r of data.rows) {
        const row = lines.addRow([
            new Date(r.created_at),
            r.order?.reference || '',
            r.beneficiary === 'car' ? `عربية: ${r.car_label}` : (r.user?.name || ''),
            r.group_name || '',
            r.kind === 'charge' ? 'طلب' : 'مرتجع / إلغاء',
            (r.order?.items || []).map((i) => `${i.title}${i.variant ? ` (${i.variant})` : ''} × ${i.quantity}`).join('، '),
            r.amount,
            r.personal_amount,
            r.order?.office_name || '',
        ]);
        row.getCell(1).numFmt = 'yyyy-mm-dd';
        row.getCell(7).numFmt = MONEY;
        row.getCell(8).numFmt = MONEY;
    }
    const total = lines.addRow(['', '', '', '', '', 'الإجمالي', data.totals.net, null, '']);
    total.font = { bold: true };
    total.getCell(7).numFmt = MONEY;

    const people = wb.addWorksheet(`ملخص ${oa.members}`, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    header(people, [`${oa.theMember}`, 'الإيميل', 'الموبايل', 'الجروب', 'عدد الأوردرات', `على ${oa.the}`, 'مرتجع', `الصافي على ${oa.the}`], [26, 28, 16, 16, 14, 16, 14, 18]);
    for (const p of data.by_employee) {
        const row = people.addRow([p.name, p.email || '', p.phone || '', p.group_name || '', p.orders, p.charged, p.credited, p.net]);
        [6, 7, 8].forEach((c) => { row.getCell(c).numFmt = MONEY; });
    }

    if (data.by_car.length) {
        const cars = wb.addWorksheet(`عربيات ${oa.the}`, { views: [{ rightToLeft: true }] });
        header(cars, ['العربية', 'عدد الأوردرات', `على ${oa.the}`, 'مرتجع', 'الصافي'], [30, 14, 16, 14, 16]);
        for (const c of data.by_car) {
            const row = cars.addRow([c.name, c.orders, c.charged, c.credited, c.net]);
            [3, 4, 5].forEach((i) => { row.getCell(i).numFmt = MONEY; });
        }
    }

    return { workbook: wb, filename: `readycar-${String(company.name).replace(/[^\w-]+/g, '-')}-${data.month}.xlsx` };
};

const exportPortalPurchases = async (userId, query = {}) => {
    const { company } = await requireManager(userId);
    const data = await buildPurchases(company, { month: query.month || monthKey(), userId: query.user_id, carId: query.car_id });
    return buildPurchasesWorkbook(company, data);
};

const exportAdminPurchases = async (companyId, query = {}) => {
    const company = await loadCompanyById(companyId);
    const data = await buildPurchases(company, { month: query.month || monthKey(), userId: query.user_id, carId: query.car_id });
    return buildPurchasesWorkbook(company, data);
};

/** An employee's own orders on the company account, newest first. */
const getMyCompanyOrders = async (userId, { limit = 50 } = {}) => {
    const entries = await CompanyLedgerEntry.find({ user_id: userId, beneficiary: 'employee' })
        .sort({ created_at: -1 }).limit(Math.min(200, Number(limit) || 50)).lean();
    const orders = await Order.find({ _id: { $in: [...new Set(entries.map((e) => String(e.order_id)))] } })
        .select('items status total_price transaction.reference transaction.status company user_id').lean();
    const orderMap = new Map(orders.map((o) => [String(o._id), o]));
    const settleMap = new Map(await Promise.all(orders.map(async (o) => [String(o._id), await settleInfo(o, userId)])));
    return {
        rows: entries.map((e) => {
            const order = orderMap.get(String(e.order_id));
            return {
                _id: e._id,
                kind: e.kind,
                created_at: e.created_at,
                month: e.deferred_from || e.month,
                amount: round2(e.amount),
                personal_amount: round2(e.personal_amount),
                // A person may be in several companies: say which one this was.
                company_name: order?.company?.company_name || '',
                order: order ? {
                    _id: order._id,
                    reference: order.transaction?.reference || '',
                    status: order.status,
                    total: round2(order.total_price),
                    items: itemSummary(e.sub_order_id ? order.items.filter((i) => sameId(i.sub_order_id, e.sub_order_id)) : order.items),
                    // Offered on the order's charge row only, so it shows once per order.
                    settle: e.kind === 'charge' ? settleMap.get(String(order._id)) || null : null,
                } : null,
            };
        }),
    };
};

/* ------------------------------------------------------------------ */
/* Settling an order yourself                                          */
/* ------------------------------------------------------------------ */

/** What the company still carries for an order: the sum of its ledger rows, never below 0. */
const companyShareOutstanding = async (orderId) => {
    const [row] = await CompanyLedgerEntry.aggregate([
        { $match: { order_id: new (require('mongoose').Types.ObjectId)(String(orderId)) } },
        { $group: { _id: null, net: { $sum: '$amount' } } },
    ]);
    return round2(Math.max(0, row?.net || 0));
};

/** Why this person cannot settle this order now, or null. */
const settleBlockedReason = (order, userId) => {
    if (!order?.company) return 'NOT_COMPANY_ORDER';
    if (!sameId(order.user_id, userId) || order.company.beneficiary !== 'employee') return 'NOT_YOUR_COMPANY_ORDER';
    // A card payment for the personal part still in flight: the order is not settled yet.
    if (order.transaction?.status !== 'paid') return 'ORDER_NOT_PAID';
    return null;
};

const SETTLE_MESSAGES = {
    NOT_COMPANY_ORDER: 'This order was not placed on a company account',
    NOT_YOUR_COMPANY_ORDER: 'Only the employee who placed this order can pay it',
    ORDER_NOT_PAID: 'This order is still waiting for its payment to complete',
    NOTHING_TO_SETTLE: 'The company has nothing left to pay on this order',
};

/**
 * The employee pays the company's remaining share of their own order from their wallet
 * (topping it up by card first if it is short). The company is credited — off its bill,
 * or back into its prepaid wallet — and the amount goes back onto the employee's limit
 * for the order's month. From then on the order is the employee's own: `company_amount`
 * becomes 0, so a later cancellation or return refunds them, not the company.
 *
 * Retry-safe: every step is keyed on the settlement's sequence number, and the sequence
 * only advances once the order records it. A failure after the wallet debit is completed
 * by pressing again — the debit is not repeated.
 */
const settleOrderByEmployee = async (userId, orderId) => {
    if (!isObjectId(orderId)) throw companyError('ORDER_NOT_FOUND', 'Order not found', 404);
    const order = await Order.findById(orderId);
    if (!order) throw companyError('ORDER_NOT_FOUND', 'Order not found', 404);
    const blocked = settleBlockedReason(order, userId);
    if (blocked) throw companyError(blocked, SETTLE_MESSAGES[blocked], blocked === 'ORDER_NOT_PAID' ? 409 : 403);

    const run = async () => {
        const amount = await companyShareOutstanding(order._id);
        if (amount <= EPSILON) throw companyError('NOTHING_TO_SETTLE', SETTLE_MESSAGES.NOTHING_TO_SETTLE, 409);
        const seq = (order.company.settlements?.length || 0) + 1;
        const key = `order:${order._id}:settle:${seq}`;
        const reference = order.transaction?.reference || String(order._id);

        // 1. The employee's money first — it throws INSUFFICIENT_BALANCE if it is short.
        const paid = await walletService.rechargeOrder({
            userId,
            amountMinor: walletService.toMinor(amount),
            orderId: order._id,
            reason: `Paid company order ${reference} yourself`,
            idempotencyKey: `${key}:wallet`,
            actor: { role: 'user', label: 'Employee settlement' },
        });

        // 2. The company's side: a credit on its ledger (and its wallet, if prepaid), and the
        //    limit back — unless the month is already invoiced, then it is next invoice's credit.
        const booking = await bookingFor(order);
        const res = await insertEntry({
            ...baseEntry(order, booking),
            kind: 'credit',
            amount: -amount,
            personal_amount: amount,
            reason: 'Paid by the employee',
            idempotency_key: `${key}:company`,
            actor: { role: 'user', label: 'Employee settlement' },
        });
        if (!res.duplicate && !booking.late) await releaseSpend({ ...orderCounterOwner(order), amount });

        // 3. The order is the employee's from here on.
        const companyAmount = Number(order.company.company_amount || 0);
        await Order.updateOne(
            { _id: order._id, 'company.settlements.seq': { $ne: seq } },
            {
                $push: {
                    'company.settlements': { seq, amount, wallet_transaction_id: paid?.transaction?._id || null, at: new Date() },
                    history: {
                        action: 'company_order_settled',
                        title: 'Paid by the employee',
                        details: `${amount.toFixed(2)} EGP paid from the employee's wallet; the company was credited and the limit restored.`,
                        actor_role: 'user',
                        actor_label: 'Employee',
                        metadata: { amount, seq, limit_restored: !booking.late },
                        created_at: new Date(),
                    },
                },
                $set: {
                    'company.company_amount': 0,
                    'company.personal_amount': round2(companyAmount + Number(order.company.personal_amount || 0)),
                    'company.personal_method': order.company.personal_method || 'wallet',
                },
            }
        );
        return { amount, limit_restored: !booking.late, credited_month: booking.month };
    };

    return companyWallet.isWalletMode(order.company.billing_mode)
        ? companyWallet.withBudgetLock(order.company.company_id, run)
        : run();
};

/** What the settle button needs for one order: the amount, or why it is not offered. */
const settleInfo = async (order, userId) => {
    const blocked = settleBlockedReason(order, userId);
    if (blocked === 'NOT_COMPANY_ORDER' || blocked === 'NOT_YOUR_COMPANY_ORDER') return null;
    const amount = await companyShareOutstanding(order._id);
    return { amount, blocked: blocked || (amount <= EPSILON ? 'NOTHING_TO_SETTLE' : null), settled: (order.company?.settlements || []).length > 0 };
};

const withOrderBudget = (fn) => async (args) => {
    if (!companyWallet.isWalletMode(args.order?.company?.billing_mode)) return fn(args);
    return companyWallet.withBudgetLock(args.order.company.company_id, () => fn(args));
};
const placeWithBudget = async (userId, data = {}) => {
    const ctx = await resolveCheckoutContext(userId, data.company || {});
    return companyWallet.withBudgetLock(ctx.company._id, () => placeCompanyOrder(userId, data));
};

module.exports = {
    carLabel,
    companyModes,
    bookingFor,
    resolveCheckoutContext,
    applyOfficeDelivery,
    standing,
    reserveSpend,
    releaseSpend,
    previewForCheckout,
    placeCompanyOrder: placeWithBudget,
    recordCharge,
    splitAmount,
    refundShare: withOrderBudget(refundShare),
    chargeBack: withOrderBudget(chargeBack),
    returnBatchSavings: withOrderBudget(returnBatchSavings),
    absorbShippingDifference: withOrderBudget(absorbShippingDifference),
    releaseCheckoutHold,
    buildPurchases,
    getPortalPurchases,
    getAdminPurchases,
    exportPortalPurchases,
    exportAdminPurchases,
    getMyCompanyOrders,
    companyShareOutstanding,
    settleOrderByEmployee,
};
