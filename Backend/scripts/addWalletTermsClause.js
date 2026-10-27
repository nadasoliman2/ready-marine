/**
 * One-off migration: add the wallet clause to the live Terms and Conditions.
 *
 * Why this exists rather than just re-running `seeders/seed_pages.js`: that
 * seeder overwrites ALL four policy pages with whatever is in its .txt files,
 * which would silently discard every edit made through the admin CMS since
 * launch. This script touches one page, appends one section, and refuses to run
 * twice.
 *
 * The clause itself is the legally material one for this feature: store credit
 * cannot be withdrawn as cash. The UI states it next to every balance, but a
 * customer funding a wallet is entering a commercial arrangement, and the terms
 * are where that has to be written down.
 *
 *   node scripts/addWalletTermsClause.js            # dry run — prints, writes nothing
 *   node scripts/addWalletTermsClause.js --apply    # write
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Page } = require('../models/pages');

const APPLY = process.argv.includes('--apply');

// Anchors: the clause is inserted immediately BEFORE the shipping section, so
// it sits with payment rather than being tacked onto the end of the document.
const EN_ANCHOR = '8. Shipping and Delivery';
const AR_ANCHOR = '8. الشحن والتوصيل';

// Presence marker — how the script knows it has already run.
const EN_MARKER = '7.1 Wallet (Store Credit)';
const AR_MARKER = '7.1 المحفظة (رصيد المتجر)';

const EN_CLAUSE = `7.1 Wallet (Store Credit)
• The customer's account includes a wallet that holds store credit, which may be funded by the customer through the approved payment gateways or credited by Ready Marine as a refund.
• Wallet credit may be used only to pay for products and services purchased through Ready Marine. It is not cash, it is not a deposit, and it does not earn any interest or return.
• Wallet credit is NOT redeemable for cash, is NOT transferable to another account or person, and CANNOT be withdrawn to a bank account, card, or any other means. By adding credit to the wallet, the customer accepts this condition.
• Wallet credit does not expire.
• Where an order is cancelled or returned, the refunded amount is credited to the customer's wallet and becomes available for immediate use on a subsequent purchase, regardless of the method originally used to pay.
• Ready Marine may temporarily suspend activity on a wallet where fraud or unauthorised use is reasonably suspected, or where required by law. A suspension does not affect the customer's entitlement to the balance held.
• On closure of an account holding a balance, the customer must be given the opportunity to use the remaining credit, or it will be settled in accordance with applicable law.
`;

const AR_CLAUSE = `7.1 المحفظة (رصيد المتجر)
• يتضمن حساب العميل محفظة تحتوي على رصيد للمتجر، يقوم العميل بشحنه عبر بوابات الدفع المعتمدة، أو يقوم Ready Marine بإضافته كمبلغ مسترد.
• يُستخدم رصيد المحفظة حصرياً في شراء المنتجات والخدمات من Ready Marine. وهو ليس نقداً وليس وديعة ولا يترتب عليه أي فائدة أو عائد.
• رصيد المحفظة غير قابل للاستبدال نقداً، وغير قابل للتحويل إلى حساب أو شخص آخر، ولا يمكن سحبه إلى حساب بنكي أو بطاقة أو بأي وسيلة أخرى. وبشحن المحفظة يقر العميل بقبوله هذا الشرط.
• رصيد المحفظة لا تنتهي صلاحيته.
• في حالة إلغاء الطلب أو إرجاعه، يُضاف المبلغ المسترد إلى محفظة العميل ويصبح متاحاً للاستخدام الفوري في عملية شراء لاحقة، بغض النظر عن وسيلة الدفع المستخدمة في الأصل.
• يجوز لـ Ready Marine إيقاف النشاط على المحفظة مؤقتاً عند وجود اشتباه معقول في احتيال أو استخدام غير مصرح به، أو عند الاقتضاء القانوني. ولا يمس هذا الإيقاف حق العميل في الرصيد المستحق له.
• عند إغلاق حساب يحتوي على رصيد، يجب تمكين العميل من استخدام الرصيد المتبقي، أو تتم تسويته وفقاً للقانون المعمول به.
`;

/**
 * Insert the clause before the anchor, or append if the anchor is missing.
 *
 * The anchor may legitimately be absent — an admin can have rewritten the page
 * — so a missing anchor appends rather than failing. Losing the ideal position
 * is acceptable; not publishing the clause at all is not.
 */
const insertClause = (content, anchor, clause) => {
    if (!content) return clause;
    const index = content.indexOf(anchor);
    if (index === -1) return `${content.trimEnd()}\n\n${clause}`;
    return `${content.slice(0, index)}${clause}\n${content.slice(index)}`;
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Database: ${String(process.env.MONGO_URI).replace(/\/\/[^@]*@/, '//***@')}`);
    console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: DRY RUN (pass --apply to write)\n');

    const page = await Page.findOne({ slug: 'terms-and-conditions' });
    if (!page) {
        console.error('No terms-and-conditions page found. Run seeders/seed_pages.js first.');
        await mongoose.disconnect();
        process.exit(1);
    }

    const hasEn = (page.content_en || '').includes(EN_MARKER);
    const hasAr = (page.content_ar || '').includes(AR_MARKER);

    if (hasEn && hasAr) {
        console.log('The wallet clause is already present in both languages. Nothing to do.');
        await mongoose.disconnect();
        process.exit(0);
    }

    if (!hasEn) {
        page.content_en = insertClause(page.content_en, EN_ANCHOR, EN_CLAUSE);
        console.log('· English clause will be added.');
    } else {
        console.log('· English clause already present — left alone.');
    }

    if (!hasAr) {
        page.content_ar = insertClause(page.content_ar, AR_ANCHOR, AR_CLAUSE);
        console.log('· Arabic clause will be added.');
    } else {
        console.log('· Arabic clause already present — left alone.');
    }

    if (APPLY) {
        await page.save();
        console.log('\nTerms and Conditions updated.');
    } else {
        console.log('\nDry run — nothing was written. Re-run with --apply.');
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch(async (err) => {
    console.error('Migration failed:', err.message);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
});
