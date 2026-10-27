/**
 * Withdraw a company invoice that should not have been issued, and re-run its month under
 * the current rule (an order is invoiced in the month it is completed): the orders still
 * open move to the next month and are billed when they are delivered.
 *
 *   docker exec readycar_backend node scripts/withdrawCompanyInvoice.js INV-202609-0001            # dry run
 *   docker exec readycar_backend node scripts/withdrawCompanyInvoice.js INV-202609-0001 --confirm  # do it
 *
 * Refuses an invoice with any payment on it. Writes a backup of the invoice and the
 * month's ledger rows next to the uploads before changing anything.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const { CompanyInvoice, CompanyPayment } = require('../models/companyInvoices');
const { CompanyLedgerEntry } = require('../models/companyLedger');
const { Order } = require('../models/orders');
const { recordAuditLog } = require('../models/auditLog');

const [number, flag] = process.argv.slice(2);
const confirmed = flag === '--confirm';

(async () => {
    if (!number) throw new Error('Usage: node scripts/withdrawCompanyInvoice.js <INVOICE-NUMBER> [--confirm]');
    await mongoose.connect(process.env.MONGO_URI);

    const inv = await CompanyInvoice.findOne({ number }).select('+ledger_entry_ids').lean();
    if (!inv) throw new Error(`Invoice ${number} not found`);
    const payments = await CompanyPayment.countDocuments({ invoice_id: inv._id });
    if (payments > 0 || Number(inv.amount_paid || 0) > 0 || inv.status !== 'issued') {
        throw new Error(`Not safe to withdraw: ${payments} payment(s), paid ${inv.amount_paid}, status ${inv.status}`);
    }

    const entries = await CompanyLedgerEntry.find({ company_id: inv.company_id, month: inv.month }).lean();
    const orders = await Order.find({ _id: { $in: [...new Set(entries.map((e) => String(e.order_id)))] } })
        .select('status transaction.reference sub_orders.status').lean();
    console.log(`Invoice ${inv.number} — ${inv.company_snapshot?.name} — ${inv.month} — due ${inv.amount_due}`);
    for (const o of orders) console.log(`  ${o.transaction?.reference}: ${o.status} [${(o.sub_orders || []).map((s) => s.status).join(', ')}]`);

    if (!confirmed) {
        console.log('\nDry run — nothing changed. Add --confirm to withdraw it.');
        await mongoose.disconnect();
        return;
    }

    const backupDir = path.join(__dirname, '../public/uploads/company-receipts');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `withdrawn-${inv.number}-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({ invoice: inv, entries }, null, 1));
    console.log(`\nBackup written: ${backupFile}`);

    await CompanyInvoice.deleteOne({ _id: inv._id });
    const invoices = require('../services/companyInvoiceService');
    const res = await invoices.issueInvoice(inv.company_id, inv.month, { now: new Date() });

    const after = await CompanyLedgerEntry.find({ company_id: inv.company_id }).select('month deferred_from order_reference amount').lean();
    console.log(res.invoice ? `Re-issued as ${res.invoice.number}: ${res.invoice.amount_due} due` : `No invoice for ${inv.month} — nothing was completed in it`);
    for (const e of after) console.log(`  ${e.order_reference} ${e.amount} → ${e.month}${e.deferred_from ? ` (ordered ${e.deferred_from})` : ''}`);

    await recordAuditLog({
        action: 'company_invoice_withdrawn',
        actor: { role: 'system', label: 'Ready Marine' },
        target_type: 'company_invoice',
        target_id: inv._id,
        target_snapshot: { number: inv.number, month: inv.month, amount_due: inv.amount_due, reason: 'Issued for orders not delivered yet' },
    }).catch((err) => console.log(`Audit log failed: ${err.message}`));

    const { notifyManagers } = require('../services/companyService');
    await notifyManagers(inv.company_id, 'company_invoice_withdrawn', {
        title_en: `Invoice ${inv.number} was withdrawn`,
        title_ar: `فاتورة ${inv.number} اتسحبت`,
        message_en: 'It billed orders that have not been delivered yet. Each order is now invoiced in the month it is delivered.',
        message_ar: 'كانت فيها أوردرات لسه ماتسلّمتش. من دلوقتي كل أوردر بيتفوتر في الشهر اللي يتسلّم فيه.',
    }, { link: '/company/invoices' }).catch((err) => console.log(`Notification failed: ${err.message}`));

    await mongoose.disconnect();
    console.log('\nDone.');
})().catch(async (err) => {
    console.error(`FAILED: ${err.message}`);
    try { await mongoose.disconnect(); } catch (_) { /* already closed */ }
    process.exit(1);
});
