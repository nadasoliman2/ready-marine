/**
 * Corporate accounts — companies, their people, and what each person may spend.
 * See feature-planner/14-corporate-accounts.md.
 *
 * Three audiences use this module and each is authorized differently:
 *   - the ReadyCar admin (routes/adminCompanies.js) — any company, by id;
 *   - a company manager (routes/company.js) — their own company only, re-derived
 *     from their membership on every call, never from an id the client sends;
 *   - an employee (routes/myCompany.js) — their own membership only.
 *
 * Invitations live in companyInvitationService; this module never sends a message.
 */
const { orgType, flatTerms } = require('./shared/orgTerms');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const { User } = require('../models/users');
const { Company, CompanyMembership, CompanyInvitation, CorporateSettings } = require('../models/companies');
const { CompanySpendCounter, CompanyLedgerEntry } = require('../models/companyLedger');
const { recordAuditLog } = require('../models/auditLog');
const { notifyCustomer } = require('./customerNotificationService');
const { authorizationError } = require('./shared/addressAuthorization');
const { canonicalPhone, isValidEgyptMobile } = require('./shared/phone');
const { scopedCompanyId } = require('./shared/companyScope');

/** Domain error with a machine-readable `code` the routes map to HTTP statuses. */
const companyError = authorizationError;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const sameId = (a, b) => !!a && !!b && String(a) === String(b);

const isObjectId = (value) => !!value && mongoose.Types.ObjectId.isValid(String(value));

const cleanText = (value, max = 200) => String(value ?? '').trim().slice(0, max);

/* ------------------------------------------------------------------ */
/* Calendar month                                                      */
/* ------------------------------------------------------------------ */

/**
 * Limits renew on the 1st of the month in the STORE's time zone, not the
 * server's: an order placed at 00:30 on the 1st in Cairo belongs to the new
 * month even though it is still the 31st in UTC.
 */
const STORE_TIMEZONE = process.env.STORE_TIMEZONE || 'Africa/Cairo';

/** 'YYYY-MM' for the month `date` falls in, in the store's time zone. */
const monthKey = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: STORE_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year').value;
    const month = parts.find((p) => p.type === 'month').value;
    return `${year}-${month}`;
};

/** 'YYYY-MM-01' of the month after `key` — the day limits renew. */
const renewalDate = (key) => {
    const [year, month] = key.split('-').map(Number);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
};

/* ------------------------------------------------------------------ */
/* Global settings                                                     */
/* ------------------------------------------------------------------ */

const DEFAULT_CORPORATE_SETTINGS = Object.freeze({
    batch_order_count: 3,
    batch_wait_hours: 48,
    default_payment_terms_days: 15,
    default_overdue_grace_days: 7,
    // Invoices (phase 4): the first payment reminder, in days before the due date.
    invoice_reminder_days: 3,
});

const SETTINGS_BOUNDS = {
    batch_order_count: { min: 2, max: 100 },
    batch_wait_hours: { min: 1, max: 24 * 14 },
    default_payment_terms_days: { min: 0, max: 120 },
    default_overdue_grace_days: { min: 0, max: 90 },
    invoice_reminder_days: { min: 0, max: 30 },
};

/** Where companies transfer the money — printed on every invoice. */
const BANK_FIELDS = { bank_name: 120, account_name: 160, account_number: 60, iban: 60, instructions: 500 };
const emptyBankDetails = () => Object.fromEntries(Object.keys(BANK_FIELDS).map((k) => [k, '']));

const getCorporateSettings = async () => {
    const stored = await CorporateSettings.findOne().lean();
    const settings = { ...DEFAULT_CORPORATE_SETTINGS };
    for (const key of Object.keys(DEFAULT_CORPORATE_SETTINGS)) {
        if (stored && Number.isFinite(stored[key])) settings[key] = stored[key];
    }
    settings.bank_details = { ...emptyBankDetails(), ...(stored?.bank_details || {}) };
    return settings;
};

/** Parse a whole number inside [min, max], or throw with the field named. */
const toBoundedInt = (value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw companyError('INVALID_FIELD', `${field} must be a whole number between ${min} and ${max}`, 400);
    }
    return n;
};

const updateCorporateSettings = async (patch = {}, actor) => {
    const before = await getCorporateSettings();
    const update = {};
    for (const [key, bounds] of Object.entries(SETTINGS_BOUNDS)) {
        if (patch[key] !== undefined) update[key] = toBoundedInt(patch[key], key, bounds);
    }
    if (patch.bank_details && typeof patch.bank_details === 'object') {
        for (const [field, max] of Object.entries(BANK_FIELDS)) {
            if (patch.bank_details[field] !== undefined) update[`bank_details.${field}`] = cleanText(patch.bank_details[field], max);
        }
    }
    if (!Object.keys(update).length) return before;

    update.updated_at = new Date();
    await CorporateSettings.findOneAndUpdate({}, { $set: update }, { upsert: true });
    const after = await getCorporateSettings();

    // Settings are a singleton with no id of its own; the row's id is the target.
    const row = await CorporateSettings.findOne().select('_id').lean();
    await recordAuditLog({
        action: 'corporate_settings_updated',
        actor,
        target_type: 'corporate_settings',
        target_id: row._id,
        target_snapshot: { before, after },
    });
    return after;
};

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

const findGroup = (company, groupId) =>
    (groupId ? (company.groups || []).find((g) => sameId(g._id, groupId)) : null) || null;

const findOffice = (company, officeId) =>
    (officeId ? (company.offices || []).find((o) => sameId(o._id, officeId)) : null) || null;

const activeOffices = (company) => (company.offices || []).filter((o) => o.active !== false);

const activeCars = (company) => (company.cars || []).filter((c) => c.active !== false);

/**
 * An employee's monthly limit, shipping included. The most specific level wins:
 * their personal override, then their group's limit, then the company default.
 * `limit: null` (source 'none') when the company has switched employee limits off: only
 * the company's own cap stands.
 */
const limitsOff = (company) => company?.employee_limits_enabled === false;

/** What is left of a limit; null for no limit. */
const remainingOf = (limit, spent) => (limit === null ? null : round2(Math.max(0, limit - spent)));

const effectiveLimit = (company, membership) => {
    if (!membership?.is_employee) return { limit: 0, source: null };
    if (limitsOff(company)) return { limit: null, source: 'none' };
    if (membership.limit_override !== null && membership.limit_override !== undefined) {
        return { limit: round2(membership.limit_override), source: 'override' };
    }
    const group = findGroup(company, membership.group_id);
    if (group) return { limit: round2(group.limit), source: 'group' };
    return { limit: round2(company.default_limit || 0), source: 'default' };
};

/**
 * What each employee has charged to the company in `month`, by user id — read
 * from the same counters their limit is enforced against, so the number on the
 * screen is exactly the number checkout checks. Includes money held for a card
 * payment still in progress.
 */
const monthSpendByUser = async (companyId, userIds = [], month = monthKey()) => {
    const ids = (userIds || []).filter(Boolean);
    if (!ids.length) return new Map();
    const rows = await CompanySpendCounter.find({ company_id: companyId, month, scope: 'user', user_id: { $in: ids } })
        .select('user_id amount').lean();
    return new Map(rows.map((r) => [String(r.user_id), round2(Math.max(0, r.amount))]));
};

/** Everything on the company account in `month`, employees and cars together. */
const monthSpendForCompany = async (companyId, month = monthKey()) => {
    const row = await CompanySpendCounter.findOne({ company_id: companyId, month, scope: 'company', user_id: null })
        .select('amount').lean();
    return round2(Math.max(0, row?.amount || 0));
};

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

/**
 * The caller's active company position, re-derived from the database.
 *
 * The single authorization primitive for the portal and the employee tab: no
 * route ever takes a company id from the client as proof of anything.
 */
/**
 * The person's active memberships, oldest first, each with its company. A person may
 * belong to several companies — to each at most once (see the membership index).
 */
const listMemberships = async (userId) => {
    const memberships = await CompanyMembership.find({ user_id: userId, status: 'active' }).sort({ joined_at: 1 });
    if (!memberships.length) return [];
    const companies = await Company.find({ _id: { $in: memberships.map((m) => m.company_id) } });
    const byId = new Map(companies.map((c) => [String(c._id), c]));
    return memberships
        .map((membership) => ({ membership, company: byId.get(String(membership.company_id)) || null }))
        .filter((row) => row.company);
};

/**
 * One of the person's companies.
 *
 *   companyId  which one — for the portal it comes from the request's company scope
 *              (the `X-Company-Id` header); at checkout from the person's choice
 *   role       'manager' / 'employee': only memberships with that role qualify
 *   strict     true: a companyId the person is not in (with that role) finds nothing,
 *              instead of falling back to their first qualifying company. Checkout is
 *              strict — an order must never land on a company nobody chose.
 */
const resolveCompanyContext = async (userId, { companyId = scopedCompanyId(), role = null, strict = false } = {}) => {
    const rows = await listMemberships(userId);
    const fits = (m) => (role === 'manager' ? m.is_manager : role === 'employee' ? m.is_employee : true);
    let row = companyId ? rows.find((r) => sameId(r.company._id, companyId) && fits(r.membership)) : null;
    if (!row && !(strict && companyId)) row = rows.find((r) => fits(r.membership)) || null;
    return row ? { membership: row.membership, company: row.company } : { membership: null, company: null };
};

const requireManager = async (userId) => {
    const context = await resolveCompanyContext(userId, { role: 'manager' });
    if (!context.company || !context.membership.is_manager) {
        throw companyError('NOT_COMPANY_MANAGER', 'You do not manage a company account', 403);
    }
    return context;
};

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

const officeShape = (o) => ({
    _id: o._id,
    name: o.name,
    recipient_name: o.recipient_name,
    phone: o.phone,
    full_address: o.full_address,
    shipping_country: o.shipping_country || null,
    shipping_city: o.shipping_city || null,
    active: o.active !== false,
});

const groupShape = (g) => ({ _id: g._id, name: g.name, limit: round2(g.limit) });

const carShape = (c) => ({
    _id: c._id,
    car_brand_id: c.car_brand_id || null,
    car_model_id: c.car_model_id || null,
    make: c.make,
    model: c.model || '',
    year: c.year || null,
    plate: c.plate,
    active: c.active !== false,
});

const userShape = (u) => (u ? {
    _id: u._id,
    name: u.name,
    email: u.email || null,
    phone: u.phone || null,
    profile_image: u.profile_image || null,
} : null);

/** What a company's own managers see about it. */
const portalCompanyShape = (company) => ({
    _id: company._id,
    name: company.name,
    org_type: orgType(company.org_type),
    status: company.status,
    ended_at: company.status === 'ended' ? company.contract_end?.at || null : null,
    logo: company.logo || null,
    show_logo_on_homepage: company.show_logo_on_homepage !== false,
    monthly_cap: round2(require('./companyWalletService').creditLimit(company)),
    billing_mode: company.billing_mode || 'monthly',
    wallet_balance: require('./companyWalletService').balance(company),
    // The line under a credit wallet, as the admin set it — `monthly_cap` above is what
    // is left to spend, which moves with the balance.
    credit_line: round2(require('./companyWalletService').creditLine(company)),
    total_credit_limit: round2(require('./companyWalletService').creditLimit(company)),
    payment_terms_days: company.payment_terms_days,
    default_limit: round2(company.default_limit),
    employee_limits_enabled: !limitsOff(company),
    modes: {
        consolidate: company.modes?.consolidate !== false,
        instant: company.modes?.instant !== false,
    },
    offices: activeOffices(company).map(officeShape),
    groups: (company.groups || []).map(groupShape),
    cars: activeCars(company).map(carShape),
});

/**
 * A company that changed how it pays has something on both sides: the invoices of the
 * orders it placed on one, the wallet it paid others from. Its screens show a side for as
 * long as there is anything on it, not only the one it pays with now.
 */
const billingSides = async (company) => {
    const wallet = require('./companyWalletService');
    const onWallet = wallet.isWallet(company);
    const { CompanyWalletTransaction } = require('../models/companyWalletTransactions');
    const [invoices, walletMoves] = await Promise.all([
        onWallet ? CompanyLedgerEntry.exists({ company_id: company._id, billing_mode: { $nin: wallet.WALLET_MODES } }) : true,
        onWallet ? true : (Number(company.wallet_balance_minor || 0) !== 0 || CompanyWalletTransaction.exists({ company_id: company._id })),
    ]);
    return { has_invoices: !!invoices, has_wallet: !!walletMoves };
};

/** Everything, for the ReadyCar admin. */
const adminCompanyShape = (company) => ({
    ...portalCompanyShape(company),
    commercial_registration: company.commercial_registration || '',
    tax_card: company.tax_card || '',
    overdue_grace_days: company.overdue_grace_days,
    suspension: company.status === 'suspended' ? {
        reason: company.suspension?.reason || null,
        note: company.suspension?.note || '',
        at: company.suspension?.at || null,
        by: company.suspension?.by || '',
    } : null,
    consolidation_override: {
        enabled: !!company.consolidation_override?.enabled,
        order_count: company.consolidation_override?.order_count ?? null,
        wait_hours: company.consolidation_override?.wait_hours ?? null,
    },
    overdue_waiver_until: company.overdue_waiver_until && new Date(company.overdue_waiver_until) > new Date()
        ? company.overdue_waiver_until
        : null,
    created_by: company.created_by || '',
    created_at: company.created_at,
});

/* ------------------------------------------------------------------ */
/* Validation of company-owned pieces                                  */
/* ------------------------------------------------------------------ */

const toMoney = (value, field, { required = false } = {}) => {
    if (value === undefined || value === null || value === '') {
        if (required) throw companyError('INVALID_FIELD', `${field} is required`, 400);
        return undefined;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
        throw companyError('INVALID_FIELD', `${field} must be zero or more`, 400);
    }
    return round2(n);
};

/** An office is a delivery address, so it needs everything a courier needs. */
const validateOfficeInput = (input = {}) => {
    const office = {
        name: cleanText(input.name, 80),
        recipient_name: cleanText(input.recipient_name, 80),
        phone: cleanText(input.phone, 30),
        full_address: cleanText(input.full_address, 500),
        shipping_country: cleanText(input.shipping_country, 80) || null,
        shipping_city: cleanText(input.shipping_city, 80) || null,
    };
    if (!office.name) throw companyError('OFFICE_NAME_REQUIRED', 'Give the branch a name', 400);
    if (!office.recipient_name) throw companyError('OFFICE_RECIPIENT_REQUIRED', 'Enter who receives parcels at this branch', 400);
    if (!isValidEgyptMobile(office.phone)) {
        throw companyError('OFFICE_PHONE_INVALID', 'Enter a valid mobile number for the branch', 400);
    }
    office.phone = canonicalPhone(office.phone);
    if (!office.full_address) throw companyError('OFFICE_ADDRESS_REQUIRED', 'Enter the branch address', 400);
    // Country and city are the shipping zone, optional exactly as on a customer
    // address: a store with no zones configured has nothing to pick, and "anywhere
    // in the country" is a real choice with no city.
    return office;
};

const normalizePlate = (plate) => cleanText(plate, 30).toUpperCase().replace(/\s+/g, ' ');

/**
 * A company car is picked from the site's make/model/year list, as a garage car is, so
 * the shop can filter parts for it. The names are taken from the list, not the client.
 */
const validateCarInput = async (input = {}) => {
    const plate = normalizePlate(input.plate);
    if (!isObjectId(input.car_brand_id) || !isObjectId(input.car_model_id)) {
        throw companyError('CAR_MAKE_REQUIRED', 'Choose the make and model', 400);
    }
    if (!plate) throw companyError('CAR_PLATE_REQUIRED', 'Enter the plate number', 400);
    const { CarBrand } = require('../models/car_brands');
    const brand = await CarBrand.findById(input.car_brand_id).select('name models._id models.name models.years').lean();
    const model = (brand?.models || []).find((m) => sameId(m._id, input.car_model_id));
    if (!brand || !model) throw companyError('CAR_MAKE_REQUIRED', 'Choose the make and model', 400);
    const year = Number(input.year);
    const years = (model.years || []).map((y) => Number(y.year));
    if (!Number.isInteger(year) || (years.length ? !years.includes(year) : (year < 1950 || year > new Date().getFullYear() + 1))) {
        throw companyError('CAR_YEAR_INVALID', 'Choose the model year', 400);
    }
    return {
        car_brand_id: brand._id,
        car_model_id: model._id,
        make: brand.name,
        model: model.name,
        year,
        plate,
    };
};

/** A group or office id the client names must be one of THIS company's. */
const assertGroupId = (company, groupId) => {
    if (groupId === null || groupId === undefined || groupId === '') return null;
    if (!findGroup(company, groupId)) throw companyError('GROUP_NOT_FOUND', 'That group does not exist', 404);
    return findGroup(company, groupId)._id;
};

const assertOfficeId = (company, officeId) => {
    if (officeId === null || officeId === undefined || officeId === '') return null;
    const office = findOffice(company, officeId);
    if (!office || office.active === false) throw companyError('OFFICE_NOT_FOUND', 'That branch does not exist', 404);
    return office._id;
};

/** Where a new employee lands when nobody said: the company's first office. */
const defaultOfficeId = (company) => activeOffices(company)[0]?._id || null;

/* ------------------------------------------------------------------ */
/* Notifying managers                                                  */
/* ------------------------------------------------------------------ */

const managerUserIds = async (companyId, { except = null } = {}) => {
    const rows = await CompanyMembership.find({ company_id: companyId, status: 'active', is_manager: true })
        .select('user_id').lean();
    return rows.map((r) => r.user_id).filter((id) => !sameId(id, except));
};

const notifyManagers = async (companyId, type, copy, options = {}, { except = null } = {}) => {
    const ids = await managerUserIds(companyId, { except });
    await Promise.all(ids.map((id) => notifyCustomer(id, type, copy, options)));
};

/**
 * A branded Arabic email to every manager of the company. `copy` carries subject,
 * eyebrow, title, body and button; `path` is the portal page the button opens.
 * Quietly does nothing without an email provider.
 */
const emailManagers = async (companyId, { path, ...copy }) => {
    if (!process.env.RESEND_TOKEN) return;
    const { sendBrandedActionEmail } = require('./emailService');
    const { getFrontendUrl } = require('./shared/guestInvites');
    const managers = await CompanyMembership.find({ company_id: companyId, status: 'active', is_manager: true })
        .populate('user_id', 'name email').lean();
    const actionUrl = `${getFrontendUrl()}${path}`;
    await Promise.allSettled(managers.filter((m) => m.user_id?.email).map((m) => sendBrandedActionEmail({
        to: m.user_id.email,
        name: m.user_id.name,
        actionUrl,
        copy: {
            lang: 'ar', dir: 'rtl', align: 'right',
            fallbackName: '',
            greeting: 'أهلاً',
            fallback: 'لو الزرار مش شغال، افتح اللينك ده:',
            text: (name) => `أهلاً ${name || ''}، ${copy.title}: ${actionUrl}`,
            ...copy,
        },
    })));
};

/** An in-dashboard notification to every admin. Never throws. */
const notifyAdmins = async (type, title, message, data) => {
    try {
        const { createNotification } = require('../models/notifications');
        const admins = await User.find({ role: 'admin' }).select('_id').lean();
        await Promise.allSettled(admins.map((a) => createNotification(a._id, type, title, message, data)));
    } catch (err) {
        console.error(`[Company] Admin notification failed: ${err.message}`);
    }
};

/* ------------------------------------------------------------------ */
/* Admin — companies                                                   */
/* ------------------------------------------------------------------ */

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Head-counts per company, for lists and the admin detail page. */
const countsByCompany = async (companyIds) => {
    const [members, invitations] = await Promise.all([
        CompanyMembership.aggregate([
            { $match: { company_id: { $in: companyIds }, status: 'active' } },
            {
                $group: {
                    _id: '$company_id',
                    employees: { $sum: { $cond: ['$is_employee', 1, 0] } },
                    managers: { $sum: { $cond: ['$is_manager', 1, 0] } },
                },
            },
        ]),
        CompanyInvitation.aggregate([
            { $match: { company_id: { $in: companyIds }, status: 'pending', expires_at: { $gt: new Date() } } },
            { $group: { _id: '$company_id', pending: { $sum: 1 } } },
        ]),
    ]);
    const map = new Map(companyIds.map((id) => [String(id), { employees: 0, managers: 0, pending_invitations: 0 }]));
    for (const row of members) Object.assign(map.get(String(row._id)), { employees: row.employees, managers: row.managers });
    for (const row of invitations) map.get(String(row._id)).pending_invitations = row.pending;
    return map;
};

const listCompanies = async ({ search = '', status = '', page = 1, limit = 25 } = {}) => {
    const filter = {};
    if (search) filter.name = { $regex: escapeRegex(search.trim()), $options: 'i' };
    if (['active', 'suspended', 'ended'].includes(status)) filter.status = status;

    const pageNum = Math.max(1, Number(page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 25));

    const [total, companies] = await Promise.all([
        Company.countDocuments(filter),
        Company.find(filter).sort({ created_at: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize),
    ]);
    const counts = await countsByCompany(companies.map((c) => c._id));
    const month = monthKey();
    const spendRows = await CompanySpendCounter.find({
        company_id: { $in: companies.map((c) => c._id) }, month, scope: 'company', user_id: null,
    }).select('company_id amount').lean();
    const spendByCompany = new Map(spendRows.map((r) => [String(r.company_id), round2(Math.max(0, r.amount))]));
    const collection = await require('./companyInvoiceService').collectionFigures(companies.map((c) => c._id));
    // Phase 5: this month's activity beside the money.
    const activity = await require('./companyStatsService').monthActivityByCompany(companies.map((c) => c._id), month);

    return {
        companies: companies.map((company) => ({
            _id: company._id,
            name: company.name,
            org_type: orgType(company.org_type),
            status: company.status,
            monthly_cap: round2(require('./companyWalletService').creditLimit(company)),
            billing_mode: company.billing_mode || 'monthly',
            wallet_balance: require('./companyWalletService').balance(company),
            credit_line: round2(require('./companyWalletService').creditLine(company)),
            payment_terms_days: company.payment_terms_days,
            created_at: company.created_at,
            ...counts.get(String(company._id)),
            month_spent: spendByCompany.get(String(company._id)) || 0,
            month,
            // Phase 4: invoiced, paid, still owed, how much of it is late, receipts to check.
            collection: collection.get(String(company._id)) || null,
            month_orders: activity.get(String(company._id))?.orders || 0,
            month_active_employees: activity.get(String(company._id))?.active_employees || 0,
        })),
        pagination: { total, page: pageNum, pages: Math.max(1, Math.ceil(total / pageSize)), limit: pageSize },
    };
};

const loadCompanyById = async (companyId) => {
    if (!isObjectId(companyId)) throw companyError('COMPANY_NOT_FOUND', 'Company not found', 404);
    const company = await Company.findById(companyId);
    if (!company) throw companyError('COMPANY_NOT_FOUND', 'Company not found', 404);
    return company;
};

/**
 * Create a company and invite its first manager, in one step.
 *
 * The identifier is checked BEFORE the company is written, so a typo does not
 * leave an orphan company behind. If only the delivery fails, the company stays
 * and the admin resends from its page — the error is returned, not thrown.
 */
const createCompany = async (payload = {}, actor, { language = 'en' } = {}) => {
    const name = cleanText(payload.name, 120);
    if (!name) throw companyError('COMPANY_NAME_REQUIRED', 'Enter the company name', 400);

    const billingMode = payload.billing_mode || 'monthly';
    if (!['monthly', 'wallet', 'credit_wallet'].includes(billingMode)) throw companyError('INVALID_BILLING_MODE', 'Choose monthly invoice, prepaid wallet or wallet with a credit limit', 400);
    // The same field is the month's cap on an invoice and the credit line under a credit
    // wallet; a prepaid wallet has neither.
    const monthlyCap = billingMode === 'wallet' ? 0 : toMoney(payload.monthly_cap, billingMode === 'credit_wallet' ? 'Credit limit' : 'Monthly cap', { required: true });
    const office = validateOfficeInput(payload.office || {});

    const managerName = cleanText(payload.manager?.name, 80);
    const managerIdentifier = cleanText(payload.manager?.identifier, 120);
    if (!managerIdentifier) {
        throw companyError('MANAGER_REQUIRED', "Enter the first manager's email or mobile number", 400);
    }
    const { parseInviteIdentifier } = require('./shared/guestInvites');
    if (!parseInviteIdentifier(managerIdentifier).type) {
        throw companyError('INVALID_IDENTIFIER', 'Enter a valid email address or mobile number for the manager', 400);
    }

    const defaults = await getCorporateSettings();
    const company = await Company.create({
        name,
        org_type: orgType(payload.org_type),
        commercial_registration: cleanText(payload.commercial_registration, 60),
        tax_card: cleanText(payload.tax_card, 60),
        monthly_cap: monthlyCap,
        billing_mode: billingMode,
        payment_terms_days: payload.payment_terms_days !== undefined && payload.payment_terms_days !== ''
            ? toBoundedInt(payload.payment_terms_days, 'Payment terms', SETTINGS_BOUNDS.default_payment_terms_days)
            : defaults.default_payment_terms_days,
        overdue_grace_days: payload.overdue_grace_days !== undefined && payload.overdue_grace_days !== ''
            ? toBoundedInt(payload.overdue_grace_days, 'Overdue grace period', SETTINGS_BOUNDS.default_overdue_grace_days)
            : defaults.default_overdue_grace_days,
        offices: [office],
        created_by: actor?.label || '',
    });

    await recordAuditLog({
        action: 'company_created',
        actor,
        target_type: 'company',
        target_id: company._id,
        target_snapshot: { name: company.name, monthly_cap: company.monthly_cap, payment_terms_days: company.payment_terms_days },
    });

    let managerInvitation = null;
    let managerInvitationError = null;
    try {
        managerInvitation = await require('./companyInvitationService').createInvitation({
            company,
            role: 'manager',
            name: managerName,
            identifier: managerIdentifier,
            invitedBy: { kind: 'admin', label: actor?.label || 'ReadyCar' },
            language,
        });
    } catch (err) {
        managerInvitationError = { code: err.code || 'INVITE_FAILED', message: err.message };
    }

    return {
        company: adminCompanyShape(company),
        manager_invitation: managerInvitation?.invitation || null,
        manager_invitation_error: managerInvitationError,
    };
};

const getCompanyForAdmin = async (companyId) => {
    const company = await loadCompanyById(companyId);
    const counts = (await countsByCompany([company._id])).get(String(company._id));
    const managers = await CompanyMembership.find({ company_id: company._id, status: 'active', is_manager: true })
        .populate('user_id', 'name email phone profile_image').lean();
    const settings = await getCorporateSettings();

    return {
        company: { ...adminCompanyShape(company), ...(await billingSides(company)) },
        counts,
        managers: managers.map((m) => ({
            membership_id: m._id,
            is_employee: !!m.is_employee,
            joined_at: m.joined_at,
            user: userShape(m.user_id),
        })),
        // What actually applies to this company, after its override.
        consolidation: effectiveConsolidation(company, settings),
        collection: (await require('./companyInvoiceService').collectionFigures([company._id])).get(String(company._id)) || null,
        // Once the contract has ended: unpaid invoices and what ReadyCar owes back.
        settlement: await require('./companyInvoiceService').settlementFor(company),
    };
};

const effectiveConsolidation = (company, settings) => {
    const override = company.consolidation_override || {};
    const on = !!override.enabled;
    return {
        order_count: on && override.order_count ? override.order_count : settings.batch_order_count,
        wait_hours: on && override.wait_hours ? override.wait_hours : settings.batch_wait_hours,
        overridden: on,
    };
};

const BILLING_MODES = ['monthly', 'wallet', 'credit_wallet'];

/**
 * The admin moves a company to another way of paying.
 *
 * The mode decides how NEW orders are paid. Nothing already booked is rewritten: orders
 * placed on an invoice are still invoiced and that invoice is still owed; orders paid from
 * the wallet still refund to it. What is in the wallet when a company leaves it for an
 * invoice — a balance, or a debt — goes on its next invoice (companyWalletService.sweep),
 * and a credit an invoice owes a company that now has a wallet is paid into it.
 *
 * Only sets the fields; the caller saves. Runs under the budget lock, so a checkout on the
 * wallet finishes before the wallet stops being what the company pays from.
 */
const changeBillingMode = (company, patch) => {
    const mode = patch.billing_mode;
    if (!BILLING_MODES.includes(mode)) throw companyError('INVALID_BILLING_MODE', 'Choose monthly invoice, prepaid wallet or wallet with a credit limit', 400);
    if (company.status === 'ended') throw companyError('COMPANY_ENDED', 'This contract has ended; its payment mode can no longer change', 409);
    // The same field is the month's cap on an invoice and the line under a credit wallet,
    // and they are different figures: it is asked for again rather than carried across.
    company.monthly_cap = mode === 'wallet' ? 0 : toMoney(patch.monthly_cap, mode === 'credit_wallet' ? 'Credit limit' : 'Monthly cap', { required: true });
    company.billing_mode = mode;
};

const updateCompanyByAdmin = async (companyId, patch = {}, actor) => {
    const current = await loadCompanyById(companyId);
    const modeChanges = patch.billing_mode !== undefined && patch.billing_mode !== (current.billing_mode || 'monthly');
    if (!modeChanges) return applyCompanyUpdate(current, patch, actor);
    const result = await require('./companyWalletService').withBudgetLock(companyId,
        async () => applyCompanyUpdate(await loadCompanyById(companyId), patch, actor, { modeChanges: true }));
    const after = result.company;
    const terms = flatTerms(after.org_type, true);
    const termsEn = flatTerms(after.org_type, false);
    const ar = { monthly: 'فاتورة شهرية', wallet: 'محفظة مسبقة الدفع', credit_wallet: 'محفظة بحد ائتماني' }[after.billing_mode];
    const en = { monthly: 'a monthly invoice', wallet: 'a prepaid wallet', credit_wallet: 'a wallet with a credit limit' }[after.billing_mode];
    await notifyManagers(companyId, 'company_billing_mode_changed', {
        title_en: `The ${termsEn.one} account now pays by ${en}`,
        title_ar: `طريقة الدفع لحساب ${terms.the} بقت: ${ar}`,
        message_en: 'New orders are paid this way. Orders already placed finish the way they started.',
        message_ar: 'الأوردرات الجديدة هتتحاسب بالطريقة دي. الأوردرات اللي اتطلبت قبل كده بتكمل زي ما بدأت.',
    }, { link: after.billing_mode === 'monthly' ? '/company/invoices' : '/company/wallet' }).catch(() => {});
    return result;
};

const applyCompanyUpdate = async (company, patch, actor, { modeChanges = false } = {}) => {
    const before = adminCompanyShape(company);
    if (modeChanges) changeBillingMode(company, patch);

    if (patch.name !== undefined) {
        const name = cleanText(patch.name, 120);
        if (!name) throw companyError('COMPANY_NAME_REQUIRED', 'Enter the company name', 400);
        company.name = name;
    }
    if (patch.org_type !== undefined) company.org_type = orgType(patch.org_type);
    if (patch.commercial_registration !== undefined) company.commercial_registration = cleanText(patch.commercial_registration, 60);
    if (patch.tax_card !== undefined) company.tax_card = cleanText(patch.tax_card, 60);
    if (patch.show_logo_on_homepage !== undefined) company.show_logo_on_homepage = !!patch.show_logo_on_homepage;
    if (!modeChanges && patch.monthly_cap !== undefined && company.billing_mode !== 'wallet') company.monthly_cap = toMoney(patch.monthly_cap, company.billing_mode === 'credit_wallet' ? 'Credit limit' : 'Monthly cap', { required: true });
    if (patch.payment_terms_days !== undefined) {
        company.payment_terms_days = toBoundedInt(patch.payment_terms_days, 'Payment terms', SETTINGS_BOUNDS.default_payment_terms_days);
    }
    if (patch.overdue_grace_days !== undefined) {
        company.overdue_grace_days = toBoundedInt(patch.overdue_grace_days, 'Overdue grace period', SETTINGS_BOUNDS.default_overdue_grace_days);
    }
    if (patch.consolidation_override !== undefined) {
        const o = patch.consolidation_override || {};
        const enabled = !!o.enabled;
        company.consolidation_override = {
            enabled,
            order_count: enabled && o.order_count !== null && o.order_count !== '' && o.order_count !== undefined
                ? toBoundedInt(o.order_count, 'Batch order count', SETTINGS_BOUNDS.batch_order_count)
                : null,
            wait_hours: enabled && o.wait_hours !== null && o.wait_hours !== '' && o.wait_hours !== undefined
                ? toBoundedInt(o.wait_hours, 'Batch waiting hours', SETTINGS_BOUNDS.batch_wait_hours)
                : null,
        };
        company.markModified('consolidation_override');
    }

    await company.save();
    // Now on a wallet: a credit an earlier invoice left the company goes into it.
    if (modeChanges) {
        await require('./companyInvoiceService').creditInvoicesToWallet(company._id);
        company = await loadCompanyById(company._id);
    }
    const after = adminCompanyShape(company);

    await recordAuditLog({
        action: 'company_updated',
        actor,
        target_type: 'company',
        target_id: company._id,
        target_snapshot: { before, after },
    });
    return { company: after };
};

/**
 * Delete an account that was created by mistake.
 *
 * Only an account with no money on it can go: once an order, an invoice, a payment or
 * a wallet movement carries its id, deleting the company would leave that record
 * pointing at nothing and the books short. Those accounts are closed with "end
 * contract" instead, which keeps the history.
 *
 * What goes with it is only what never touched money: the memberships, the invitations
 * and the (empty) spend counters. The people keep their ReadyCar accounts.
 */
const deleteCompanyByAdmin = async (companyId, actor) => {
    const company = await loadCompanyById(companyId);
    const scope = { company_id: company._id };

    const { Order } = require('../models/orders');
    const { CompanyInvoice, CompanyPayment } = require('../models/companyInvoices');
    const { CompanyBatch } = require('../models/companyBatches');
    const { CompanyWalletTransaction } = require('../models/companyWalletTransactions');
    const [orders, ledger, invoices, payments, batches, walletMoves] = await Promise.all([
        Order.exists({ 'company.company_id': company._id }),
        CompanyLedgerEntry.exists(scope),
        CompanyInvoice.exists(scope),
        CompanyPayment.exists(scope),
        CompanyBatch.exists(scope),
        CompanyWalletTransaction.exists(scope),
    ]);
    const hasHistory = orders || ledger || invoices || payments || batches || walletMoves
        || Number(company.wallet_balance_minor || 0) !== 0
        || !!company.wallet_pending_entry;
    if (hasHistory) {
        throw companyError('COMPANY_HAS_HISTORY', 'This account has orders or payments on it and cannot be deleted. End its contract instead.', 409);
    }

    const members = await CompanyMembership.find({ ...scope, status: 'active' }).select('user_id').lean();

    await Promise.all([
        CompanyMembership.deleteMany(scope),
        CompanyInvitation.deleteMany(scope),
        CompanySpendCounter.deleteMany(scope),
    ]);
    await Company.deleteOne({ _id: company._id });

    await recordAuditLog({
        action: 'company_deleted',
        actor,
        target_type: 'company',
        target_id: company._id,
        target_snapshot: { ...adminCompanyShape(company), members_removed: members.length },
    });

    // Telling them is a courtesy; the account is already gone if a message fails.
    await Promise.allSettled(members.map((m) => notifyCustomer(
        m.user_id,
        'company_member_removed',
        {
            title_en: `The ${company.name} account was closed`,
            title_ar: `حساب ${company.name} اتقفل`,
            message_en: `You can no longer order on the ${flatTerms(company.org_type, false).one} account.`,
            message_ar: `مش هتقدر تطلب على حساب ${flatTerms(company.org_type, true).the} تاني.`,
        },
        { link: '/profile' }
    )));

    return { deleted: true, company_id: company._id };
};

const loadManagerMembership = async (company, membershipId) => {
    if (!isObjectId(membershipId)) throw companyError('MANAGER_NOT_FOUND', 'Manager not found', 404);
    const membership = await CompanyMembership.findOne({
        _id: membershipId, company_id: company._id, status: 'active', is_manager: true,
    });
    if (!membership) throw companyError('MANAGER_NOT_FOUND', 'Manager not found', 404);
    return membership;
};

/**
 * Correct a manager's email or mobile from the admin side.
 *
 * These are the person's ReadyCar sign-in details, not a copy kept on the company, so
 * the change follows them everywhere they sign in. Each must stay unique across
 * accounts; the email may be cleared, the mobile may not.
 */
const updateManagerContactByAdmin = async (companyId, membershipId, patch = {}, actor) => {
    const company = await loadCompanyById(companyId);
    const membership = await loadManagerMembership(company, membershipId);
    const user = await User.findById(membership.user_id);
    if (!user) throw companyError('MANAGER_NOT_FOUND', 'Manager not found', 404);
    const before = { email: user.email || null, phone: user.phone || null };

    if (patch.email !== undefined) {
        const { canonicalEmail } = require('./shared/emailIdentity');
        const email = canonicalEmail(cleanText(patch.email, 200));
        if (!email) {
            user.email = undefined;
        } else if (email !== canonicalEmail(user.email || '')) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw companyError('MANAGER_EMAIL_INVALID', 'Enter a valid email address', 400);
            if (await User.exists({ email, _id: { $ne: user._id } })) {
                throw companyError('MANAGER_EMAIL_TAKEN', 'Another account already uses this email', 409);
            }
            user.email = email;
        }
    }

    if (patch.phone !== undefined) {
        const { phoneLookupVariants } = require('./shared/phone');
        const raw = cleanText(patch.phone, 30);
        if (!isValidEgyptMobile(raw)) throw companyError('MANAGER_PHONE_INVALID', 'Enter a valid Egyptian mobile number', 400);
        const phone = canonicalPhone(raw);
        if (phone !== user.phone) {
            if (await User.exists({ phone: { $in: phoneLookupVariants(phone) }, _id: { $ne: user._id } })) {
                throw companyError('MANAGER_PHONE_TAKEN', 'Another account already uses this mobile number', 409);
            }
            user.phone = phone;
        }
    }

    try {
        await user.save();
    } catch (error) {
        // Two admins saving the same value at once: the unique index is the last word.
        if (error?.code === 11000) {
            throw error.keyPattern?.phone
                ? companyError('MANAGER_PHONE_TAKEN', 'Another account already uses this mobile number', 409)
                : companyError('MANAGER_EMAIL_TAKEN', 'Another account already uses this email', 409);
        }
        throw error;
    }

    const after = { email: user.email || null, phone: user.phone || null };
    if (before.email !== after.email || before.phone !== after.phone) {
        await recordAuditLog({
            action: 'company_manager_contact_updated',
            actor,
            target_type: 'company_membership',
            target_id: membership._id,
            target_snapshot: { company_id: company._id, user_id: user._id, before, after },
        });
    }
    return { manager: { membership_id: membership._id, user: userShape(user) } };
};

/**
 * Take the manager role off a membership. Someone who is also an employee stays one;
 * a manager-only membership ends.
 */
const dropManagerRole = async (company, membership, actor) => {
    if (membership.is_employee) {
        membership.is_manager = false;
    } else {
        membership.status = 'removed';
        membership.ended_at = new Date();
        membership.ended_by = actor.label;
    }
    await membership.save();

    await notifyCustomer(
        membership.user_id,
        'company_role_changed',
        {
            title_en: `You no longer manage ${company.name}`,
            title_ar: `مبقتش مدير حساب ${company.name}`,
            message_en: `Your access to the ${flatTerms(company.org_type, false).one} portal was removed.`,
            message_ar: `صلاحية دخولك للوحة ${flatTerms(company.org_type, true).the} اتشالت.`,
        },
        { link: '/profile' }
    );

    await recordAuditLog({
        action: 'company_manager_removed',
        actor,
        target_type: 'company_membership',
        target_id: membership._id,
        target_snapshot: { company_id: company._id, user_id: membership.user_id, kept_as_employee: !!membership.is_employee },
    });
};

/**
 * Remove a manager from the admin side. Unlike the portal, the admin may remove the
 * last one — the admin is the one who can invite the next.
 */
const removeManagerByAdmin = async (companyId, membershipId, actor) => {
    const company = await loadCompanyById(companyId);
    const membership = await loadManagerMembership(company, membershipId);
    await dropManagerRole(company, membership, actor);
    return { ok: true };
};

const assertNotEnded = (company) => {
    if (company.status === 'ended') throw companyError('COMPANY_ENDED', 'This contract has ended', 409);
};

const suspendCompany = async (companyId, { note = '' } = {}, actor) => {
    const company = await loadCompanyById(companyId);
    assertNotEnded(company);
    if (company.status === 'suspended') return { company: adminCompanyShape(company) };

    company.status = 'suspended';
    company.suspension = { reason: 'manual', note: cleanText(note, 500), at: new Date(), by: actor?.label || '' };
    await company.save();

    await recordAuditLog({
        action: 'company_suspended',
        actor,
        target_type: 'company',
        target_id: company._id,
        target_snapshot: { name: company.name, reason: 'manual', note: company.suspension.note },
    });
    return { company: adminCompanyShape(company) };
};

const reactivateCompany = async (companyId, actor) => {
    const company = await loadCompanyById(companyId);
    assertNotEnded(company);
    if (company.status === 'active') return { company: adminCompanyShape(company) };

    const previous = company.suspension?.reason || null;
    company.status = 'active';
    company.suspension = { reason: null, note: '', at: null, by: '' };
    // Resuming a company paused for a late invoice is the admin granting more time: the
    // automatic pause holds off for another grace period (at least three days).
    if (previous === 'overdue') {
        const days = Math.max(3, Number(company.overdue_grace_days ?? 7));
        company.overdue_waiver_until = new Date(Date.now() + days * 24 * 3600 * 1000);
    }
    await company.save();

    await recordAuditLog({
        action: 'company_reactivated',
        actor,
        target_type: 'company',
        target_id: company._id,
        target_snapshot: { name: company.name, previous_reason: previous },
    });
    return { company: adminCompanyShape(company) };
};

/* ------------------------------------------------------------------ */
/* People — members and invitations in one list                        */
/* ------------------------------------------------------------------ */

/**
 * Lazily expire what has run out. Reads never show a "pending" invitation that
 * can no longer be accepted.
 */
const expireStaleInvitations = async (companyId) => {
    await CompanyInvitation.updateMany(
        { company_id: companyId, status: 'pending', expires_at: { $lte: new Date() } },
        { $set: { status: 'expired', updated_at: new Date() } }
    );
};

/**
 * Every employee row of a company: joined employees, then invitations still
 * waiting for an answer (pending, expired, declined). Manager-only people and
 * manager invitations are not employees and are listed on the managers screen.
 */
const listEmployees = async (company) => {
    await expireStaleInvitations(company._id);

    const [members, invitations] = await Promise.all([
        CompanyMembership.find({ company_id: company._id, status: 'active', is_employee: true })
            .populate('user_id', 'name email phone profile_image')
            .sort({ joined_at: -1 })
            .lean(),
        CompanyInvitation.find({
            company_id: company._id,
            role: 'employee',
            status: { $in: ['pending', 'expired', 'declined'] },
        }).sort({ created_at: -1 }).lean(),
    ]);

    const month = monthKey();
    const spend = await monthSpendByUser(company._id, members.map((m) => m.user_id?._id), month);

    const memberRows = members.map((m) => {
        const { limit, source } = effectiveLimit(company, m);
        const spent = round2(spend.get(String(m.user_id?._id)) || 0);
        return {
            kind: 'member',
            _id: m._id,
            // 'deactivated': the manager paused their ordering (reversible).
            status: m.deactivated_at ? 'deactivated' : 'joined',
            deactivated_at: m.deactivated_at || null,
            deactivated_by: m.deactivated_by || '',
            name: m.user_id?.name || '',
            email: m.user_id?.email || null,
            phone: m.user_id?.phone || null,
            is_manager: !!m.is_manager,
            group_id: m.group_id || null,
            group_name: findGroup(company, m.group_id)?.name || null,
            office_id: m.office_id || null,
            office_name: findOffice(company, m.office_id)?.name || null,
            limit,
            limit_source: source,
            limit_override: m.limit_override ?? null,
            spent,
            remaining: remainingOf(limit, spent),
            joined_at: m.joined_at,
        };
    });

    const invitationRows = invitations.map((inv) => ({
        kind: 'invitation',
        _id: inv._id,
        status: inv.status,
        name: inv.name || '',
        email: inv.email || null,
        phone: inv.phone || null,
        channel: inv.channel,
        group_id: inv.group_id || null,
        group_name: findGroup(company, inv.group_id)?.name || null,
        office_id: inv.office_id || null,
        office_name: findOffice(company, inv.office_id)?.name || null,
        expires_at: inv.expires_at,
        last_sent_at: inv.last_sent_at,
    }));

    return { month, rows: [...memberRows, ...invitationRows] };
};

/* ------------------------------------------------------------------ */
/* Portal — overview                                                   */
/* ------------------------------------------------------------------ */

const getPortalOverview = async (userId) => {
    const { company } = await requireManager(userId);
    const { month, rows } = await listEmployees(company);

    const members = rows.filter((r) => r.kind === 'member');
    const invitations = rows.filter((r) => r.kind === 'invitation');
    // The company counter, not the sum of employees: it includes company-car orders.
    const monthSpent = await monthSpendForCompany(company._id, month);

    const setup = {
        office_confirmed: !!company.setup?.office_confirmed_at,
        default_limit_set: !!company.setup?.default_limit_set_at,
        modes_confirmed: !!company.setup?.modes_confirmed_at,
        employees_added: rows.length > 0,
    };

    // Consolidation (phase 3): what the batches saved this month, and what is waiting now.
    const batches = await require('./companyBatchService').companyBatchOverview(company._id, month)
        .catch((err) => {
            console.error(`[Company] Batch overview failed for ${company._id}: ${err.message}`);
            return null;
        });

    // Phase 4: the oldest invoice with money still owed.
    const invoiceDue = await require('./companyInvoiceService').currentDue(company._id).catch(() => null);

    return {
        company: portalCompanyShape(company),
        invoice_due: invoiceDue,
        month: {
            key: month,
            renews_on: renewalDate(month),
            spent: monthSpent,
            cap: round2(require('./companyWalletService').creditLimit(company)),
            shipping_savings: batches?.savings || 0,
            parcels_saved: batches?.parcels_saved || 0,
            combined_parcels: batches?.combined_parcels || 0,
        },
        batches: batches ? { open: batches.open, recent: batches.recent } : { open: [], recent: [] },
        counts: {
            employees: members.length,
            active_employees: members.filter((r) => r.spent > 0).length,
            pending_invitations: invitations.filter((r) => r.status === 'pending').length,
            expired_invitations: invitations.filter((r) => r.status === 'expired').length,
            declined_invitations: invitations.filter((r) => r.status === 'declined').length,
            employees_without_group: members.filter((r) => !r.group_id && r.limit_source !== 'override').length,
        },
        setup,
        setup_complete: Object.values(setup).every(Boolean),
    };
};

const confirmSetupStep = async (userId, step) => {
    const { company } = await requireManager(userId);
    const field = { office: 'office_confirmed_at', default_limit: 'default_limit_set_at', modes: 'modes_confirmed_at' }[step];
    if (!field) throw companyError('INVALID_STEP', 'Unknown setup step', 400);
    if (!company.setup?.[field]) {
        company.set(`setup.${field}`, new Date());
        await company.save();
    }
    return { ok: true };
};

/* ------------------------------------------------------------------ */
/* Portal — employees                                                  */
/* ------------------------------------------------------------------ */

const getPortalEmployees = async (userId) => {
    const { company } = await requireManager(userId);
    const { month, rows } = await listEmployees(company);
    return {
        month,
        renews_on: renewalDate(month),
        default_limit: round2(company.default_limit),
        employee_limits_enabled: !limitsOff(company),
        groups: (company.groups || []).map(groupShape),
        offices: activeOffices(company).map(officeShape),
        rows,
    };
};

const loadEmployeeMembership = async (company, membershipId) => {
    if (!isObjectId(membershipId)) throw companyError('MEMBER_NOT_FOUND', 'Employee not found', 404);
    const membership = await CompanyMembership.findOne({
        _id: membershipId,
        company_id: company._id,
        status: 'active',
        is_employee: true,
    });
    if (!membership) throw companyError('MEMBER_NOT_FOUND', 'Employee not found', 404);
    return membership;
};

/** Group and office names as they were at the time of a change, so history reads right after a rename or delete. */
const placeNames = (company, values) => {
    const out = {};
    if ('group_id' in values) out.group_id = values.group_id ? findGroup(company, values.group_id)?.name || null : null;
    if ('office_id' in values) out.office_id = values.office_id ? findOffice(company, values.office_id)?.name || null : null;
    return out;
};

const managerActor = async (userId) => {
    const user = await User.findById(userId).select('name').lean();
    return { role: 'company_manager', label: user?.name || 'Company manager' };
};

/**
 * Change one employee's group, office or personal limit.
 *
 * A limit change takes effect immediately and is never retroactive: what they
 * already spent this month stays spent, and remaining = new limit − spent,
 * floored at zero.
 */
const updateEmployee = async (userId, membershipId, patch = {}) => {
    const { company } = await requireManager(userId);
    const membership = await loadEmployeeMembership(company, membershipId);
    const before = { group_id: membership.group_id, office_id: membership.office_id, limit_override: membership.limit_override };

    if (patch.group_id !== undefined) membership.group_id = assertGroupId(company, patch.group_id);
    if (patch.office_id !== undefined) {
        const officeId = assertOfficeId(company, patch.office_id);
        if (!officeId) throw companyError('OFFICE_REQUIRED', 'Every employee belongs to a branch', 400);
        membership.office_id = officeId;
    }
    if (patch.limit_override !== undefined) {
        membership.limit_override = patch.limit_override === null || patch.limit_override === ''
            ? null
            : toMoney(patch.limit_override, 'Personal limit', { required: true });
    }
    await require('./companyWalletService').assertAllocationsFit(company, { replacements: [membership] });
    await membership.save();

    await recordAuditLog({
        action: 'company_employee_updated',
        actor: await managerActor(userId),
        target_type: 'company_membership',
        target_id: membership._id,
        target_snapshot: {
            company_id: company._id,
            before,
            after: { group_id: membership.group_id, office_id: membership.office_id, limit_override: membership.limit_override },
            names: {
                before: placeNames(company, before),
                after: placeNames(company, { group_id: membership.group_id, office_id: membership.office_id }),
            },
        },
    });
    return { ok: true };
};

/**
 * Take someone off the employee list.
 *
 * Orders they already placed are untouched — they continue and are billed to the
 * company — because the removal only stops NEW orders. A person who is also a
 * manager keeps that role; only their limit goes.
 */
const removeEmployeeMembership = async (company, membership, actor) => {
    if (membership.is_manager) {
        membership.is_employee = false;
        membership.group_id = null;
        membership.limit_override = null;
    } else {
        membership.status = 'removed';
        membership.ended_at = new Date();
        membership.ended_by = actor.label;
    }
    await membership.save();

    await notifyCustomer(
        membership.user_id,
        'company_member_removed',
        {
            title_en: `You were removed from ${company.name}`,
            title_ar: `تم حذفك من حساب ${company.name}`,
            message_en: `You can no longer order on the ${flatTerms(company.org_type, false).one} account. Orders you already placed continue as normal.`,
            message_ar: `مش هتقدر تطلب على حساب ${flatTerms(company.org_type, true).the} تاني. الأوردرات اللي طلبتها قبل كده هتكمل عادي.`,
        },
        { link: '/profile?tab=orders' }
    );

    await recordAuditLog({
        action: 'company_employee_removed',
        actor,
        target_type: 'company_membership',
        target_id: membership._id,
        target_snapshot: { company_id: company._id, user_id: membership.user_id, kept_as_manager: !!membership.is_manager },
    });
};

/**
 * Pause or resume one employee's ordering on the company account. This is how a company
 * stops someone who has left the job: their history, group and limit stay, and bringing
 * them back needs no new invitation. Orders already placed continue. A manager role on
 * the same person is not affected.
 */
const setEmployeeActiveState = async (company, membership, active, actor) => {
    if (active === !membership.deactivated_at) return false;
    membership.deactivated_at = active ? null : new Date();
    membership.deactivated_by = active ? '' : (actor?.label || '');
    await require('./companyWalletService').assertAllocationsFit(company, { replacements: [membership] });
    await membership.save();

    await notifyCustomer(
        membership.user_id,
        active ? 'company_member_reactivated' : 'company_member_deactivated',
        active
            ? {
                title_en: `You can order on ${company.name}'s account again`,
                title_ar: `تقدر تطلب على حساب ${company.name} تاني`,
                message_en: `Your ${flatTerms(company.org_type, false).one} manager resumed your ordering.`,
                message_ar: `مدير حساب ${flatTerms(company.org_type, true).the} رجّع لك الطلب على ${flatTerms(company.org_type, true).v('حسابها', 'حسابه')}.`,
            }
            : {
                title_en: `Ordering on ${company.name}'s account is paused for you`,
                title_ar: `الطلب على حساب ${company.name} اتوقف ليك`,
                message_en: `Your ${flatTerms(company.org_type, false).one} manager paused it. Orders you already placed continue as normal.`,
                message_ar: `مدير حساب ${flatTerms(company.org_type, true).the} وقّفه. الأوردرات اللي طلبتها قبل كده بتكمل عادي.`,
            },
        { link: '/profile?tab=company' }
    );

    await recordAuditLog({
        action: active ? 'company_employee_reactivated' : 'company_employee_deactivated',
        actor,
        target_type: 'company_membership',
        target_id: membership._id,
        target_snapshot: { company_id: company._id, user_id: membership.user_id },
    });
    return true;
};

const setEmployeeActive = async (userId, membershipId, active) => {
    const { company } = await requireManager(userId);
    const membership = await loadEmployeeMembership(company, membershipId);
    await setEmployeeActiveState(company, membership, !!active, await managerActor(userId));
    return { ok: true, deactivated: !active };
};

/**
 * Who changed this employee — limit, group, office, paused or resumed, joined, removed —
 * and when. Read from the audit log every change already writes.
 */
const HISTORY_ACTIONS = [
    'company_invitation_accepted', 'company_manager_made_employee', 'company_employee_updated',
    'company_employee_deactivated', 'company_employee_reactivated', 'company_employee_removed',
];

const employeeHistoryFor = async (company, membershipId) => {
    if (!isObjectId(membershipId)) throw companyError('MEMBER_NOT_FOUND', 'Employee not found', 404);
    const membership = await CompanyMembership.findOne({ _id: membershipId, company_id: company._id }).lean();
    if (!membership) throw companyError('MEMBER_NOT_FOUND', 'Employee not found', 404);
    const { AuditLog } = require('../models/auditLog');
    const logs = await AuditLog.find({ target_type: 'company_membership', target_id: membership._id, action: { $in: HISTORY_ACTIONS } })
        .sort({ created_at: -1 }).limit(200).lean();

    // Names saved with the change win; older entries fall back to today's names.
    const nameOf = (field, id, saved) => {
        if (!id) return null;
        if (saved && saved[field]) return saved[field];
        const found = field === 'group_id' ? findGroup(company, id) : findOffice(company, id);
        return found?.name || '—';
    };
    const changes = ({ before = {}, after = {}, names = {} } = {}) => {
        const out = [];
        for (const field of ['limit_override', 'group_id', 'office_id']) {
            if (!(field in after)) continue;
            const from = before[field] ?? null;
            const to = after[field] ?? null;
            if (String(from) === String(to)) continue;
            if (field === 'limit_override') out.push({ field: 'limit', from, to });
            if (field === 'group_id') out.push({ field: 'group', from: nameOf(field, from, names.before), to: nameOf(field, to, names.after) });
            if (field === 'office_id') out.push({ field: 'office', from: nameOf(field, from, names.before), to: nameOf(field, to, names.after) });
        }
        return out;
    };

    return {
        entries: logs
            .map((l) => ({
                at: l.created_at,
                by: l.actor?.label || '',
                by_role: l.actor?.role || '',
                action: l.action,
                changes: l.action === 'company_employee_updated' ? changes(l.target_snapshot || {}) : [],
            }))
            .filter((e) => e.action !== 'company_employee_updated' || e.changes.length > 0),
    };
};

const getEmployeeHistory = async (userId, membershipId) => {
    const { company } = await requireManager(userId);
    return employeeHistoryFor(company, membershipId);
};

const adminEmployeeHistory = async (companyId, membershipId) => {
    const company = await loadCompanyById(companyId);
    return employeeHistoryFor(company, membershipId);
};

const removeEmployee = async (userId, membershipId) => {
    const { company } = await requireManager(userId);
    const membership = await loadEmployeeMembership(company, membershipId);
    await removeEmployeeMembership(company, membership, await managerActor(userId));
    return { ok: true };
};

/**
 * One action over many employees. Each id is re-checked against the caller's
 * company, so a list mixing in another company's ids changes nothing of theirs.
 */
const bulkUpdateEmployees = async (userId, { membership_ids = [], action, group_id, office_id } = {}) => {
    const { company } = await requireManager(userId);
    const ids = [...new Set((Array.isArray(membership_ids) ? membership_ids : []).filter(isObjectId).map(String))];
    if (!ids.length) throw companyError('NOTHING_SELECTED', 'Select at least one employee', 400);
    if (ids.length > 1000) throw companyError('TOO_MANY', 'Select at most 1000 employees at a time', 400);

    const memberships = await CompanyMembership.find({
        _id: { $in: ids },
        company_id: company._id,
        status: 'active',
        is_employee: true,
    });
    const actor = await managerActor(userId);

    if (action === 'move_group' || action === 'move_office') {
        const field = action === 'move_group' ? 'group_id' : 'office_id';
        const value = action === 'move_group' ? assertGroupId(company, group_id) : assertOfficeId(company, office_id);
        if (action === 'move_office' && !value) throw companyError('OFFICE_REQUIRED', 'Choose a branch', 400);
        await require('./companyWalletService').assertAllocationsFit(company, { replacements: memberships.map((m) => ({ ...m.toObject(), [field]: value })) });
        await CompanyMembership.updateMany({ _id: { $in: memberships.map((m) => m._id) } }, { $set: { [field]: value } });
        // One record per employee, so each one's history says who moved them and when.
        for (const m of memberships) {
            if (sameId(m[field], value)) continue;
            await recordAuditLog({
                action: 'company_employee_updated',
                actor,
                target_type: 'company_membership',
                target_id: m._id,
                target_snapshot: {
                    company_id: company._id,
                    before: { [field]: m[field] || null },
                    after: { [field]: value || null },
                    names: { before: placeNames(company, { [field]: m[field] || null }), after: placeNames(company, { [field]: value || null }) },
                    bulk: true,
                },
            });
        }
    } else if (action === 'remove') {
        for (const membership of memberships) {
            await removeEmployeeMembership(company, membership, actor);
        }
    } else if (action === 'deactivate' || action === 'reactivate') {
        for (const membership of memberships) {
            await setEmployeeActiveState(company, membership, action === 'reactivate', actor);
        }
    } else {
        throw companyError('INVALID_ACTION', 'Unknown action', 400);
    }
    return { updated: memberships.length };
};

/* ------------------------------------------------------------------ */
/* Portal — groups                                                     */
/* ------------------------------------------------------------------ */

/**
 * How many employees of this company would be over `limit` right now. Shown as
 * a warning before a lower limit is saved; saving is still allowed, because a
 * lower limit is never retroactive.
 */
const countOverLimit = async (company, memberships, limitFor) => {
    if (!memberships.length) return 0;
    const spend = await monthSpendByUser(company._id, memberships.map((m) => m.user_id));
    return memberships.filter((m) => (spend.get(String(m.user_id)) || 0) > limitFor(m)).length;
};

const groupPayload = (input = {}) => {
    const name = cleanText(input.name, 60);
    if (!name) throw companyError('GROUP_NAME_REQUIRED', 'Give the group a name', 400);
    return { name, limit: toMoney(input.limit, 'Group limit', { required: true }) };
};

const assertUniqueGroupName = (company, name, exceptId = null) => {
    const clash = (company.groups || []).find((g) => g.name.toLowerCase() === name.toLowerCase() && !sameId(g._id, exceptId));
    if (clash) throw companyError('GROUP_NAME_TAKEN', 'A group with this name already exists', 409);
};

const listGroups = async (userId) => {
    const { company } = await requireManager(userId);
    const counts = await CompanyMembership.aggregate([
        { $match: { company_id: company._id, status: 'active', is_employee: true } },
        { $group: { _id: '$group_id', count: { $sum: 1 } } },
    ]);
    const byGroup = new Map(counts.map((c) => [String(c._id), c.count]));
    return {
        default_limit: round2(company.default_limit),
        employee_limits_enabled: !limitsOff(company),
        employees_without_group: byGroup.get('null') || 0,
        groups: (company.groups || []).map((g) => ({ ...groupShape(g), employees: byGroup.get(String(g._id)) || 0 })),
    };
};

const createGroup = async (userId, input) => {
    const { company } = await requireManager(userId);
    const group = groupPayload(input);
    assertUniqueGroupName(company, group.name);
    company.groups.push(group);
    await require('./companyWalletService').assertAllocationsFit(company);
    await company.save();
    return { group: groupShape(company.groups[company.groups.length - 1]) };
};

const updateGroup = async (userId, groupId, input = {}) => {
    const { company } = await requireManager(userId);
    const group = findGroup(company, groupId);
    if (!group) throw companyError('GROUP_NOT_FOUND', 'That group does not exist', 404);

    if (input.name !== undefined) {
        const name = cleanText(input.name, 60);
        if (!name) throw companyError('GROUP_NAME_REQUIRED', 'Give the group a name', 400);
        assertUniqueGroupName(company, name, group._id);
        group.name = name;
    }
    let overLimit = 0;
    if (input.limit !== undefined) {
        const limit = toMoney(input.limit, 'Group limit', { required: true });
        if (limit < group.limit) {
            const members = await CompanyMembership.find({
                company_id: company._id, status: 'active', is_employee: true, group_id: group._id, limit_override: null,
            }).select('user_id').lean();
            overLimit = await countOverLimit(company, members, () => limit);
        }
        group.limit = limit;
    }
    await require('./companyWalletService').assertAllocationsFit(company);
    await company.save();
    return { group: groupShape(group), over_limit_count: overLimit };
};

/**
 * Deleting a group never strands anyone: its employees fall back to the
 * company default limit, and invitations that pointed at it lose the group.
 */
const deleteGroup = async (userId, groupId) => {
    const { company } = await requireManager(userId);
    const group = findGroup(company, groupId);
    if (!group) throw companyError('GROUP_NOT_FOUND', 'That group does not exist', 404);

    company.groups.pull(group._id);
    await require('./companyWalletService').assertAllocationsFit(company);
    const moved = await CompanyMembership.updateMany(
        { company_id: company._id, group_id: group._id },
        { $set: { group_id: null } }
    );
    await CompanyInvitation.updateMany({ company_id: company._id, group_id: group._id }, { $set: { group_id: null } });
    await company.save();
    return { deleted: true, employees_moved_to_default: moved.modifiedCount || 0 };
};

/* ------------------------------------------------------------------ */
/* Portal — offices                                                    */
/* ------------------------------------------------------------------ */

const listOffices = async (userId) => {
    const { company } = await requireManager(userId);
    const counts = await CompanyMembership.aggregate([
        { $match: { company_id: company._id, status: 'active', is_employee: true } },
        { $group: { _id: '$office_id', count: { $sum: 1 } } },
    ]);
    const byOffice = new Map(counts.map((c) => [String(c._id), c.count]));
    return {
        offices: activeOffices(company).map((o) => ({ ...officeShape(o), employees: byOffice.get(String(o._id)) || 0 })),
        office_confirmed: !!company.setup?.office_confirmed_at,
    };
};

const createOffice = async (userId, input) => {
    const { company } = await requireManager(userId);
    company.offices.push(validateOfficeInput(input));
    company.set('setup.office_confirmed_at', company.setup?.office_confirmed_at || new Date());
    await company.save();
    return { office: officeShape(company.offices[company.offices.length - 1]) };
};

const updateOffice = async (userId, officeId, input) => {
    const { company } = await requireManager(userId);
    const office = findOffice(company, officeId);
    if (!office || office.active === false) throw companyError('OFFICE_NOT_FOUND', 'That branch does not exist', 404);
    Object.assign(office, validateOfficeInput({ ...officeShape(office), ...input }));
    company.set('setup.office_confirmed_at', company.setup?.office_confirmed_at || new Date());
    await company.save();
    return { office: officeShape(office) };
};

/**
 * Offices are retired, never deleted: orders will point at them. Employees and
 * invitations on a retired office move to the company's first remaining one.
 */
const deleteOffice = async (userId, officeId) => {
    const { company } = await requireManager(userId);
    const office = findOffice(company, officeId);
    if (!office || office.active === false) throw companyError('OFFICE_NOT_FOUND', 'That branch does not exist', 404);
    if (activeOffices(company).length <= 1) {
        throw companyError('LAST_OFFICE', 'A company needs at least one branch', 409);
    }
    // Orders waiting to be consolidated to this office were promised delivery there.
    // Editing its details is fine; removing it has to wait until they have shipped.
    if (await require('./companyBatchService').officeHasWaitingBatches(company._id, office._id)) {
        throw companyError('OFFICE_HAS_WAITING_ORDERS', 'Orders are waiting to be delivered to this branch — it can be removed once they have shipped', 409);
    }

    office.active = false;
    const fallback = activeOffices(company)[0]._id;
    await company.save();

    const moved = await CompanyMembership.updateMany(
        { company_id: company._id, office_id: office._id },
        { $set: { office_id: fallback } }
    );
    await CompanyInvitation.updateMany({ company_id: company._id, office_id: office._id }, { $set: { office_id: fallback } });
    return { deleted: true, employees_moved: moved.modifiedCount || 0, moved_to_office_id: fallback };
};

/* ------------------------------------------------------------------ */
/* Portal — company cars                                               */
/* ------------------------------------------------------------------ */

const assertUniquePlate = (company, plate, exceptId = null) => {
    const clash = activeCars(company).find((c) => c.plate === plate && !sameId(c._id, exceptId));
    if (clash) throw companyError('CAR_PLATE_TAKEN', 'A car with this plate number is already registered', 409);
};

const listCars = async (userId) => {
    const { company } = await requireManager(userId);
    const month = monthKey();
    const spend = await CompanyLedgerEntry.aggregate([
        { $match: { company_id: company._id, beneficiary: 'car', $or: [{ deferred_from: month }, { deferred_from: null, month }] } },
        { $group: { _id: '$car_id', net: { $sum: '$amount' } } },
    ]);
    const byCar = new Map(spend.map((r) => [String(r._id), round2(r.net)]));
    return { month, cars: activeCars(company).map((c) => ({ ...carShape(c), month_spent: byCar.get(String(c._id)) || 0 })) };
};

const createCar = async (userId, input) => {
    const { company } = await requireManager(userId);
    const car = await validateCarInput(input);
    assertUniquePlate(company, car.plate);
    company.cars.push(car);
    await company.save();
    return { car: carShape(company.cars[company.cars.length - 1]) };
};

const updateCar = async (userId, carId, input = {}) => {
    const { company } = await requireManager(userId);
    const car = (company.cars || []).find((c) => sameId(c._id, carId) && c.active !== false);
    if (!car) throw companyError('CAR_NOT_FOUND', 'That car does not exist', 404);
    const next = await validateCarInput({ ...carShape(car), ...input });
    assertUniquePlate(company, next.plate, car._id);
    Object.assign(car, next);
    await company.save();
    return { car: carShape(car) };
};

/** Retired, not deleted — past orders name the car they were for. */
const deleteCar = async (userId, carId) => {
    const { company } = await requireManager(userId);
    const car = (company.cars || []).find((c) => sameId(c._id, carId) && c.active !== false);
    if (!car) throw companyError('CAR_NOT_FOUND', 'That car does not exist', 404);
    car.active = false;
    await company.save();
    return { deleted: true };
};

/* ------------------------------------------------------------------ */
/* Portal — settings and managers                                      */
/* ------------------------------------------------------------------ */

const getPortalSettings = async (userId) => {
    const { company, membership } = await requireManager(userId);
    const managers = await CompanyMembership.find({ company_id: company._id, status: 'active', is_manager: true })
        .populate('user_id', 'name email phone profile_image').sort({ joined_at: 1 }).lean();
    await expireStaleInvitations(company._id);
    const invitations = await CompanyInvitation.find({
        company_id: company._id, role: 'manager', status: { $in: ['pending', 'expired'] },
    }).sort({ created_at: -1 }).lean();

    return {
        company: portalCompanyShape(company),
        me: { membership_id: membership._id, is_employee: !!membership.is_employee },
        managers: managers.map((m) => ({
            membership_id: m._id,
            is_employee: !!m.is_employee,
            is_me: sameId(m.user_id?._id, userId),
            joined_at: m.joined_at,
            user: userShape(m.user_id),
        })),
        manager_invitations: invitations.map((inv) => ({
            _id: inv._id,
            name: inv.name || '',
            email: inv.email || null,
            phone: inv.phone || null,
            status: inv.status,
            expires_at: inv.expires_at,
        })),
    };
};

const updatePortalSettings = async (userId, patch = {}) => {
    const { company } = await requireManager(userId);

    let overLimit = 0;
    if (patch.default_limit !== undefined) {
        const limit = toMoney(patch.default_limit, 'Default limit', { required: true });
        if (limit < company.default_limit) {
            const members = await CompanyMembership.find({
                company_id: company._id, status: 'active', is_employee: true, group_id: null, limit_override: null,
            }).select('user_id').lean();
            overLimit = await countOverLimit(company, members, () => limit);
        }
        company.default_limit = limit;
        company.set('setup.default_limit_set_at', company.setup?.default_limit_set_at || new Date());
    }
    if (patch.modes !== undefined) {
        const consolidate = patch.modes?.consolidate !== undefined ? !!patch.modes.consolidate : company.modes?.consolidate !== false;
        const instant = patch.modes?.instant !== undefined ? !!patch.modes.instant : company.modes?.instant !== false;
        if (!consolidate && !instant) {
            throw companyError('ONE_MODE_REQUIRED', 'Keep at least one delivery mode on', 400);
        }
        company.modes = { consolidate, instant };
        company.set('setup.modes_confirmed_at', company.setup?.modes_confirmed_at || new Date());
    }
    if (patch.show_logo_on_homepage !== undefined) company.show_logo_on_homepage = !!patch.show_logo_on_homepage;
    if (patch.employee_limits_enabled !== undefined) company.employee_limits_enabled = !!patch.employee_limits_enabled;
    await require('./companyWalletService').assertAllocationsFit(company);
    await company.save();
    return { company: portalCompanyShape(company), over_limit_count: overLimit };
};

/* ---- The account's logo, and ReadyCar's home page ---- */

const LOGO_DIR = path.join(__dirname, '../public/uploads/company-logos');
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
// Raster only. An SVG is a document that can carry script, and this one would be served
// from ReadyCar's own origin to everybody who opens the home page.
const LOGO_SIGNATURES = [
    { ext: '.png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
    { ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { ext: '.webp', test: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
];

const dropLogoFile = (url) => {
    if (!url || !String(url).startsWith('/uploads/company-logos/')) return;
    fs.promises.unlink(path.join(LOGO_DIR, path.basename(url))).catch(() => {});
};

/** The manager uploads (or replaces) the account's logo. Checked by its bytes, not its name. */
const setPortalLogo = async (userId, file) => {
    const { company } = await requireManager(userId);
    if (!file?.buffer?.length) throw companyError('LOGO_REQUIRED', 'Choose an image for the logo', 400);
    if (file.size > LOGO_MAX_BYTES) throw companyError('LOGO_TOO_LARGE', 'The logo is larger than 2 MB', 400);
    const kind = LOGO_SIGNATURES.find((s) => s.test(file.buffer.subarray(0, 12)));
    if (!kind) throw companyError('LOGO_TYPE', 'Upload the logo as a PNG, JPG or WebP image', 400);

    await fs.promises.mkdir(LOGO_DIR, { recursive: true });
    const name = `${company._id}-${crypto.randomBytes(8).toString('hex')}${kind.ext}`;
    await fs.promises.writeFile(path.join(LOGO_DIR, name), file.buffer);
    const previous = company.logo;
    company.logo = `/uploads/company-logos/${name}`;
    await company.save();
    dropLogoFile(previous);
    return { company: portalCompanyShape(company) };
};

const removePortalLogo = async (userId) => {
    const { company } = await requireManager(userId);
    const previous = company.logo;
    company.logo = null;
    await company.save();
    dropLogoFile(previous);
    return { company: portalCompanyShape(company) };
};

/**
 * "ReadyCar's corporate clients" on the home page: active accounts that uploaded a logo
 * and left it on. Public — so only the name and the logo, nothing else about the account.
 */
const corporateClientsShowcase = async () => {
    const companies = await Company.find({ status: 'active', logo: { $ne: null }, show_logo_on_homepage: { $ne: false } })
        .select('name logo').sort({ created_at: 1 }).lean();
    return companies.map((c) => ({ _id: c._id, name: c.name, logo: c.logo }));
};

/**
 * Drop someone's manager role. The last manager cannot go — a company with no
 * manager can only be recovered by the ReadyCar admin.
 */
const removeManager = async (userId, membershipId) => {
    const { company } = await requireManager(userId);
    const membership = await loadManagerMembership(company, membershipId);

    const managers = await CompanyMembership.countDocuments({ company_id: company._id, status: 'active', is_manager: true });
    if (managers <= 1) throw companyError('LAST_MANAGER', 'A company needs at least one manager', 409);

    await dropManagerRole(company, membership, await managerActor(userId));
    return { ok: true };
};

/* ------------------------------------------------------------------ */
/* Employee — "My company"                                             */
/* ------------------------------------------------------------------ */

/** One membership as the person sees it: their limit and what is left of it this month. */
const myMembershipShape = async (userId, company, membership, month) => {
    const { limit, source } = effectiveLimit(company, membership);
    const spent = membership.is_employee
        ? round2((await monthSpendByUser(company._id, [userId], month)).get(String(userId)) || 0)
        : 0;
    const office = findOffice(company, membership.office_id);
    const group = findGroup(company, membership.group_id);
    const deactivated = !!membership.deactivated_at;
    return {
        company: { _id: company._id, name: company.name, org_type: orgType(company.org_type), billing_mode: company.billing_mode || 'monthly', ...(await billingSides(company)), wallet_balance: require('./companyWalletService').balance(company), status: company.status, ended_at: company.contract_end?.at || null },
        is_employee: !!membership.is_employee,
        is_manager: !!membership.is_manager,
        joined_at: membership.joined_at,
        // The manager paused this person's ordering (they may have left the job).
        deactivated,
        limit,
        limit_source: source,
        spent,
        remaining: remainingOf(limit, spent),
        month,
        renews_on: renewalDate(month),
        group: group ? { name: group.name } : null,
        office: office ? { name: office.name, full_address: office.full_address } : null,
        modes: {
            consolidate: company.modes?.consolidate !== false,
            instant: company.modes?.instant !== false,
        },
        can_order_on_company: company.status === 'active' && !deactivated
            && (company.modes?.instant !== false || company.modes?.consolidate !== false),
        // A manager's company cars, for the shop's "fits my car" pickers next to the garage.
        cars: membership.is_manager
            ? activeCars(company).filter((c) => c.car_brand_id && c.car_model_id).map((c) => ({
                _id: c._id,
                car_brand_id: c.car_brand_id,
                car_brand_name: c.make,
                car_model_id: c.car_model_id,
                car_model_name: c.model || '',
                year: c.year || null,
                plate: c.plate,
            }))
            : [],
    };
};

/**
 * Every company the person belongs to. `membership` (the first) stays for screens that
 * show one; `memberships` lists them all — a person may be in several companies.
 */
const getMyCompany = async (userId) => {
    const rows = await listMemberships(userId);
    if (!rows.length) return { membership: null, memberships: [] };
    const month = monthKey();
    const memberships = [];
    for (const { membership, company } of rows) memberships.push(await myMembershipShape(userId, company, membership, month));
    return { membership: memberships[0], memberships };
};

const withManagerBudget = (fn) => async (userId, ...args) => {
    const { company } = await requireManager(userId);
    return require('./companyWalletService').withBudgetLock(company._id, () => fn(userId, ...args));
};

module.exports = {
    companyError,
    setPortalLogo,
    removePortalLogo,
    corporateClientsShowcase,
    round2,
    sameId,
    isObjectId,
    cleanText,
    monthKey,
    renewalDate,
    DEFAULT_CORPORATE_SETTINGS,
    getCorporateSettings,
    updateCorporateSettings,
    effectiveLimit,
    monthSpendByUser,
    monthSpendForCompany,
    effectiveConsolidation,
    findGroup,
    findOffice,
    activeOffices,
    assertGroupId,
    assertOfficeId,
    defaultOfficeId,
    resolveCompanyContext,
    listMemberships,
    setEmployeeActive: withManagerBudget(setEmployeeActive),
    getEmployeeHistory,
    adminEmployeeHistory,
    requireManager,
    managerActor,
    notifyManagers,
    emailManagers,
    notifyAdmins,
    expireStaleInvitations,
    portalCompanyShape,
    adminCompanyShape,
    userShape,
    // admin
    listCompanies,
    loadCompanyById,
    createCompany,
    getCompanyForAdmin,
    updateCompanyByAdmin,
    deleteCompanyByAdmin,
    updateManagerContactByAdmin,
    removeManagerByAdmin,
    suspendCompany,
    reactivateCompany,
    listEmployees,
    // portal
    getPortalOverview,
    confirmSetupStep,
    getPortalEmployees,
    updateEmployee: withManagerBudget(updateEmployee),
    removeEmployee,
    bulkUpdateEmployees: withManagerBudget(bulkUpdateEmployees),
    listGroups,
    createGroup: withManagerBudget(createGroup),
    updateGroup: withManagerBudget(updateGroup),
    deleteGroup: withManagerBudget(deleteGroup),
    listOffices,
    createOffice,
    updateOffice,
    deleteOffice,
    listCars,
    createCar,
    updateCar,
    deleteCar,
    getPortalSettings,
    updatePortalSettings: withManagerBudget(updatePortalSettings),
    removeManager,
    // employee
    getMyCompany,
};
