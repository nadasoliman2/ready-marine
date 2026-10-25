/**
 * Cap alerts — feature 14.
 *
 * The company's managers (and ReadyCar's admins) hear when this month's spend on the
 * account passes 80% of the monthly cap, and when the cap is used up: either the spend
 * reaches it, or — past 80% — an order is refused because it would go over. Each alert goes once per
 * month for a given cap — raising the cap mid-month re-arms both.
 *
 * Called after a company order is placed and when one is refused for the cap. Never
 * throws: an alert that cannot be sent must not fail or block an order.
 */

const { flatTerms } = require('./shared/orgTerms');
const { Company } = require('../models/companies');
const { CompanySpendCounter } = require('../models/companyLedger');
const { notifyManagers, emailManagers, notifyAdmins, monthKey, round2 } = require('./companyService');

const EPSILON = 0.005;
const WARN_SHARE = 0.8;

/**
 * Mark the alert as sent on the month's company counter — atomically, so two orders
 * crossing the line together send it once. True when this call claimed it.
 */
const claim = async (companyId, month, key) => {
    const row = await CompanySpendCounter.findOneAndUpdate(
        { company_id: companyId, month, scope: 'company', user_id: null, cap_alerts: { $ne: key } },
        { $addToSet: { cap_alerts: key } },
        { returnDocument: 'after' }
    );
    return !!row;
};

const money = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

const COPY = {
    warn: ({ used, cap, pct, oa, oe }) => ({
        subject: `صرف ${oa.the} وصل ${pct}% من السقف الشهري`,
        eyebrow: `حساب ${oa.the}`,
        title: `صرفتوا ${pct}% من سقف الشهر`,
        body: `اتصرف ${money(used)} ج من ${money(cap)} ج. لما السقف يخلص، الطلب على حساب ${oa.the} بيقف لحد أول الشهر الجاي. لو محتاجين سقف أعلى كلّموا ReadyCar.`,
        title_en: `You have used ${pct}% of this month's ${oe.one} cap`,
        title_ar: `صرفتوا ${pct}% من سقف الشهر`,
        message_en: `${money(used)} of ${money(cap)} spent. When the cap is used up, ordering on the ${oe.one} account stops until the 1st. Ask ReadyCar if you need a higher cap.`,
        message_ar: `اتصرف ${money(used)} ج من ${money(cap)} ج. لما السقف يخلص الطلب على حساب ${oa.the} بيقف لحد أول الشهر. لو محتاجين سقف أعلى كلّموا ReadyCar.`,
    }),
    full: ({ used, cap, oa, oe }) => ({
        subject: `سقف ${oa.the} الشهري خلص`,
        eyebrow: `حساب ${oa.the}`,
        title: 'سقف الشهر خلص',
        body: `اتصرف ${money(used)} ج من ${money(cap)} ج، ومفيش أوردرات جديدة على حساب ${oa.the} لحد أول الشهر الجاي. ${oa.members} يقدروا يطلبوا من حساباتهم. لو محتاجين سقف أعلى كلّموا ReadyCar.`,
        title_en: `This month's ${oe.one} cap is used up`,
        title_ar: 'سقف الشهر خلص',
        message_en: `${money(used)} of ${money(cap)} spent. No new orders on the ${oe.one} account until the 1st; ${oe.members} can still order from their own accounts. Ask ReadyCar if you need a higher cap.`,
        message_ar: `اتصرف ${money(used)} ج من ${money(cap)} ج، ومفيش أوردرات جديدة على حساب ${oa.the} لحد أول الشهر. ${oa.members} يقدروا يطلبوا من حساباتهم. لو محتاجين سقف أعلى كلّموا ReadyCar.`,
    }),
};

const send = async (company, kind, figures) => {
    // The account's own words: a property's residents, a school's staff (shared/orgTerms).
    const copy = COPY[kind]({ ...figures, oa: flatTerms(company.org_type, true), oe: flatTerms(company.org_type, false) });
    await notifyManagers(company._id, 'company_cap_alert', {
        title_en: copy.title_en,
        title_ar: copy.title_ar,
        message_en: copy.message_en,
        message_ar: copy.message_ar,
    }, { link: '/company', data: { company_id: company._id, kind, used: figures.used, cap: figures.cap } });
    await emailManagers(company._id, {
        subject: copy.subject,
        eyebrow: copy.eyebrow,
        title: copy.title,
        body: copy.body,
        button: `افتح لوحة ${flatTerms(company.org_type, true).the}`,
        expiry: 'السقف الشهري بيتجدد أول كل شهر.',
        path: '/company',
    }).catch(() => {});
    await notifyAdmins(
        'company_cap_alert',
        kind === 'full' ? `${company.name}: monthly cap used up` : `${company.name}: ${figures.pct}% of the monthly cap`,
        `${money(figures.used)} of ${money(figures.cap)} spent this month.`,
        { company_id: company._id, kind, used: figures.used, cap: figures.cap }
    );
};

/**
 * Send whichever cap alert is due for the company's month. `refused` means an order was
 * just turned away for the cap, which counts as "used up" whatever the figure says.
 */
const checkCapAlerts = async (companyOrId, { month = monthKey(), refused = false } = {}) => {
    try {
        const company = companyOrId?.monthly_cap !== undefined
            ? companyOrId
            : await Company.findById(companyOrId).select('name monthly_cap billing_mode org_type').lean();
        // A wallet has no month to fill up: its balance (and credit) is what stops it.
        if (require('./companyWalletService').isWallet(company)) return null;
        const cap = Number(company?.monthly_cap || 0);
        if (!(cap > 0)) return null;
        const counter = await CompanySpendCounter.findOne({ company_id: company._id, month, scope: 'company', user_id: null })
            .select('amount').lean();
        if (!counter) return null;
        const used = round2(counter.amount || 0);
        const figures = { used, cap, pct: Math.round(WARN_SHARE * 100) };

        // The fuller alert first; claiming it also retires the 80% one, so a single order
        // that jumps from 70% to 100% sends one message, not two.
        // A refusal counts as "used up" once the month is past the warning line; a single big
        // order refused early in the month is the employee's to see, not an alert.
        const nearlyFull = used >= cap * WARN_SHARE - EPSILON;
        if (used >= cap - EPSILON || (refused && nearlyFull)) {
            const sentFull = await claim(company._id, month, `full@${cap}`);
            await claim(company._id, month, `warn@${cap}`);
            if (sentFull) await send(company, 'full', figures);
            return sentFull ? 'full' : null;
        }
        if (nearlyFull && await claim(company._id, month, `warn@${cap}`)) {
            await send(company, 'warn', figures);
            return 'warn';
        }
        return null;
    } catch (err) {
        console.error(`[Company] Cap alert failed: ${err.message}`);
        return null;
    }
};

module.exports = { checkCapAlerts, WARN_SHARE };
