/**
 * Ending a company's contract — feature 14.
 *
 * The admin ends it; from that moment:
 *   - nothing new can be ordered on the account, and pending invitations are cancelled;
 *   - the employees go back to being ordinary customers (told so); a person who is also a
 *     manager keeps the manager role;
 *   - orders already placed — those waiting in a batch too — carry on as normal;
 *   - the final invoice is issued at once, for every order not invoiced yet (the current
 *     month included), at the figures of that moment;
 *   - whatever reaches the ledger afterwards (a return, a batch's saving) is booked on the
 *     next month and issued on the next 1st as an "after the contract" statement;
 *   - the company's credit goes first against its unpaid invoices, and what is left is
 *     owed back to it, transferred by the admin (companyInvoiceService.recordRefund).
 *
 * The managers keep the company portal, to see and pay what is left. The end is final.
 */

const { flatTerms } = require('./shared/orgTerms');
const { Company, CompanyMembership, CompanyInvitation } = require('../models/companies');
const { CompanyLedgerEntry } = require('../models/companyLedger');
const { CompanyInvoice } = require('../models/companyInvoices');
const { recordAuditLog } = require('../models/auditLog');
const { notifyCustomer } = require('./customerNotificationService');
const {
    companyError,
    cleanText,
    loadCompanyById,
    adminCompanyShape,
    notifyManagers,
    emailManagers,
} = require('./companyService');
const { issueInvoice, settleEndedCompany, settlementFor, invoiceSummary, openMonthFrom } = require('./companyInvoiceService');
const { WALLET_MODES, isWallet } = require('./companyWalletService');

const endContract = async (companyId, { note = '' } = {}, actor) => {
    const company = await loadCompanyById(companyId);
    // The account's own words (a property's residents, a school's staff) — shared/orgTerms.
    const oa = flatTerms(company.org_type, true);
    const oe = flatTerms(company.org_type, false);
    if (company.status === 'ended') throw companyError('COMPANY_ENDED', 'This contract has already ended', 409);
    const now = new Date();

    company.status = 'ended';
    company.contract_end = { at: now, by: actor?.label || '', note: cleanText(note, 500) };
    company.overdue_waiver_until = null;
    await company.save();

    // No one new joins.
    await CompanyInvitation.updateMany(
        { company_id: company._id, status: 'pending' },
        { $set: { status: 'revoked', updated_at: now } }
    );

    // The employees go back to being ordinary customers.
    const employees = await CompanyMembership.find({ company_id: company._id, status: 'active', is_employee: true });
    for (const m of employees) {
        if (m.is_manager) {
            m.is_employee = false;
            m.group_id = null;
            m.limit_override = null;
        } else {
            m.status = 'removed';
            m.ended_at = now;
            m.ended_by = 'Contract ended';
        }
        await m.save();
        await notifyCustomer(m.user_id, 'company_contract_ended', {
            title_en: `${company.name}'s ${oe.one} account has ended`,
            title_ar: `حساب ${company.name} على ReadyCar انتهى`,
            message_en: `You can no longer order on the ${oe.one} account. Orders you already placed continue as normal.`,
            message_ar: `مابقاش ينفع تطلب على حساب ${oa.the}. الأوردرات اللي طلبتها قبل كده بتكمل عادي.`,
        }, { link: '/profile?tab=company' }).catch(() => {});
    }

    // The final invoice: every month with orders that has not been invoiced, now.
    const months = (await CompanyLedgerEntry.distinct('month', { company_id: company._id, billing_mode: { $nin: WALLET_MODES } })).sort();
    const invoiced = new Set((await CompanyInvoice.find({ company_id: company._id, snapshot_at: { $ne: null } }).select('month').lean()).map((i) => i.month));
    const due = months.filter((m) => !invoiced.has(m));
    // On an invoice, with something left in the wallet it used to pay from and no month
    // to put it on: this month's statement is issued for it alone.
    if (due.length === 0 && !isWallet(company) && Number(company.wallet_balance_minor || 0) !== 0) {
        due.push(await openMonthFrom(company._id));
    }
    const issued = [];
    for (const month of due) {
        const res = await issueInvoice(company._id, month, { force: true, now, stage: 'final' });
        if (res.invoice) issued.push(res.invoice);
    }
    const settlement = await settleEndedCompany(company._id) || await settlementFor(company._id);

    await recordAuditLog({
        action: 'company_contract_ended',
        actor,
        target_type: 'company',
        target_id: company._id,
        target_snapshot: {
            name: company.name,
            note: company.contract_end.note,
            employees_released: employees.length,
            final_invoices: issued.map((i) => i.number),
            outstanding: settlement?.outstanding || 0,
            refund_due: settlement?.refund_due || 0,
        },
    });

    const money = (n) => Number(n || 0).toFixed(2);
    const owed = settlement?.outstanding > 0
        ? `فاضل عليكم ${money(settlement.outstanding)} ج.`
        : settlement?.refund_due > 0 ? `ليكم عندنا ${money(settlement.refund_due)} ج وهنحوّلهالكم.` : 'مفيش مبالغ متبقية.';
    await notifyManagers(company._id, 'company_contract_ended', {
        title_en: `${company.name}'s contract with ReadyCar has ended`,
        title_ar: `العقد بين ${company.name} و ReadyCar انتهى`,
        message_en: settlement?.outstanding > 0
            ? `The final invoice is ready — ${money(settlement.outstanding)} is left to pay.`
            : 'The final invoice is ready in the portal.',
        message_ar: `آخر فاتورة جاهزة في لوحة ${oa.the}. ${owed}`,
    }, { link: '/company/invoices' }).catch(() => {});
    await emailManagers(company._id, {
        subject: `العقد بين ${company.name} و ReadyCar انتهى`,
        eyebrow: `حساب ${oa.the}`,
        title: 'العقد انتهى وآخر فاتورة جاهزة',
        body: `مابقاش ينفع حد يطلب على حساب ${oa.the}، والأوردرات اللي اتطلبت قبل كده بتكمل عادي. ${owed} أي مرتجع بييجي بعد كده بيتخصم من المتبقي أو بيرجعلكم.`,
        button: 'افتح الفواتير',
        expiry: `لوحة ${oa.the} فاضلة مفتوحة للمديرين عشان الفواتير والسداد.`,
        path: '/company/invoices',
    }).catch(() => {});

    const fresh = await Company.findById(company._id);
    return {
        company: adminCompanyShape(fresh),
        employees_released: employees.length,
        invoices: issued.map((i) => invoiceSummary(i)),
        settlement: await settlementFor(fresh),
    };
};

module.exports = { endContract };
