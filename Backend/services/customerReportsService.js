/**
 * Two admin reports on what customers keep in their accounts:
 *
 *  - cart products: one row per line in a customer's cart — the product, its vendor, the
 *    customer and how to reach them, and their governorate;
 *  - customer cars: one row per car in a customer's garage — make, model, year, the customer,
 *    their governorate, the company they belong to and when they signed up — grouped by make.
 *
 * Only carts saved to an account are here: a visitor who is not signed in keeps theirs in
 * the browser, and the server never sees it.
 *
 * The governorate is the city of the customer's default address (else their first one),
 * named from the cities list; a customer without an address has none.
 */

const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const { User } = require('../models/users');
const { Product } = require('../models/products');
const { Bundle } = require('../models/bundles');
const { City } = require('../models/cities');
const { CompanyMembership } = require('../models/companies');
const { AbandonedCartEmail } = require('../models/abandonedCartEmails');
const { Order } = require('../models/orders');

/** Lower case, Arabic letter variants folded — "احمد" finds "أحمد". */
const fold = (value) => String(value || '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .trim();

/** Does a row answer to the search: every typed word in its text, or the typed digits in its phone. */
const matcher = (search) => {
    const words = fold(search).split(/\s+/).filter(Boolean);
    const digits = String(search || '').replace(/\D/g, '');
    if (!words.length) return () => true;
    return (text, phone) => words.every((w) => text.includes(w))
        || (digits.length >= 3 && String(phone || '').replace(/\D/g, '').includes(digits));
};

/** The city of the customer's default address (else their first), in both languages. */
const governorateOf = (user, cityNames) => {
    const addresses = user.addresses || [];
    const address = addresses.find((a) => a.is_default) || addresses[0];
    const city = address?.shipping_city || '';
    if (!city) return { en: '', ar: '' };
    const known = cityNames.get(fold(city));
    return { en: known?.name || city, ar: known?.name_ar || known?.name || city };
};

const loadCityNames = async () => {
    const cities = await City.find().select('name name_ar').lean();
    return new Map(cities.map((c) => [fold(c.name), c]));
};

const customerOf = (user, cityNames) => {
    const governorate = governorateOf(user, cityNames);
    return {
        user_id: user._id,
        customer_name: user.name || '',
        phone: user.phone || '',
        email: user.email || '',
        governorate_en: governorate.en,
        governorate_ar: governorate.ar,
    };
};

/* ------------------------------------------------------------------ *
 * Cart products
 * ------------------------------------------------------------------ */

const variantLabel = (product, variantId) => {
    if (!variantId) return '';
    const variant = (product?.variants || []).find((v) => String(v._id) === String(variantId));
    return (variant?.selected_options || []).map((o) => o.option_value).filter(Boolean).join(' / ');
};

/**
 * @param search     words matched against the product, the customer's name, email and phone
 * @param vendor_id  only this vendor's products
 */
const buildCartReport = async ({ search = '', vendor_id: vendorId = '' } = {}) => {
    const users = await User.find({ 'cart.items.0': { $exists: true } })
        .select('name phone email addresses cart')
        .sort({ 'cart.updated_at': -1 })
        .lean();

    const productIds = new Set();
    const bundleIds = new Set();
    for (const user of users) {
        for (const item of user.cart.items) {
            if (item.product_id) productIds.add(String(item.product_id));
            if (item.bundle_id) bundleIds.add(String(item.bundle_id));
        }
    }
    const [products, bundles, cityNames] = await Promise.all([
        Product.find({ _id: { $in: [...productIds] } })
            .select('title_en title_ar vendor_id variants._id variants.selected_options')
            .populate('vendor_id', 'store_name')
            .lean(),
        Bundle.find({ _id: { $in: [...bundleIds] } })
            .select('title_en title_ar vendor_id')
            .populate('vendor_id', 'store_name')
            .lean(),
        loadCityNames(),
    ]);
    const productById = new Map(products.map((p) => [String(p._id), p]));
    const bundleById = new Map(bundles.map((b) => [String(b._id), b]));

    const matches = matcher(search);
    const rows = [];
    const vendors = new Map();
    for (const user of users) {
        const customer = customerOf(user, cityNames);
        for (const item of user.cart.items) {
            const thing = item.bundle_id ? bundleById.get(String(item.bundle_id)) : productById.get(String(item.product_id));
            const vendor = thing?.vendor_id || null;
            if (vendor?._id) vendors.set(String(vendor._id), vendor.store_name || '');
            const variant = item.bundle_id ? '' : variantLabel(thing, item.variant_id);
            const row = {
                ...customer,
                // A product deleted since it was put in the cart still shows, unnamed.
                product_title_en: thing ? (thing.title_en || thing.title_ar || '') : '',
                product_title_ar: thing ? (thing.title_ar || thing.title_en || '') : '',
                is_bundle: Boolean(item.bundle_id),
                variant,
                quantity: item.quantity,
                vendor_id: vendor?._id || null,
                vendor_name: vendor?.store_name || '',
                cart_updated_at: user.cart.updated_at || null,
            };
            if (vendorId && String(row.vendor_id) !== String(vendorId)) continue;
            const text = fold([row.product_title_en, row.product_title_ar, row.vendor_name, row.customer_name, row.email, row.phone].join(' '));
            if (!matches(text, row.phone)) continue;
            rows.push(row);
        }
    }
    rows.forEach((row, i) => { row.serial = i + 1; });

    return {
        rows,
        vendors: [...vendors].map(([id, name]) => ({ _id: id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        totals: {
            lines: rows.length,
            customers: new Set(rows.map((r) => String(r.user_id))).size,
            quantity: rows.reduce((sum, r) => sum + (r.quantity || 0), 0),
        },
    };
};

/* ------------------------------------------------------------------ *
 * Customer cars, by make
 * ------------------------------------------------------------------ */

/**
 * @param search  words matched against the make, model, year and the customer
 * @param brand   only this make (by name)
 */
const buildCarsReport = async ({ search = '', brand = '' } = {}) => {
    const users = await User.find({ 'cars.0': { $exists: true } })
        .select('name phone email addresses cars created_at')
        .lean();

    const [memberships, cityNames] = await Promise.all([
        CompanyMembership.find({ user_id: { $in: users.map((u) => u._id) }, status: 'active' })
            .select('user_id company_id')
            .populate('company_id', 'name')
            .lean(),
        loadCityNames(),
    ]);
    const companiesOf = new Map();
    for (const m of memberships) {
        if (!m.company_id?.name) continue;
        const key = String(m.user_id);
        companiesOf.set(key, [...(companiesOf.get(key) || []), m.company_id.name]);
    }

    const matches = matcher(search);
    const groups = new Map();
    const allBrands = new Map();
    for (const user of users) {
        const customer = customerOf(user, cityNames);
        const company = [...new Set(companiesOf.get(String(user._id)) || [])].join('، ');
        for (const car of user.cars) {
            const brandName = car.car_brand_name || '';
            allBrands.set(brandName, (allBrands.get(brandName) || 0) + 1);
            if (brand && brandName !== brand) continue;
            const row = {
                ...customer,
                brand: brandName,
                model: car.car_model_name || '',
                year: car.year || null,
                company,
                registered_at: user.created_at || null,
            };
            const text = fold([row.brand, row.model, row.year, row.customer_name, row.email, row.phone, row.company, row.governorate_en, row.governorate_ar].join(' '));
            if (!matches(text, row.phone)) continue;
            if (!groups.has(brandName)) groups.set(brandName, []);
            groups.get(brandName).push(row);
        }
    }

    const brandGroups = [...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, rows]) => ({
            brand: name,
            count: rows.length,
            rows: rows.sort((a, b) => a.model.localeCompare(b.model) || (a.year || 0) - (b.year || 0)),
        }));
    const rows = brandGroups.flatMap((g) => g.rows);

    // Each make's logo, for the picker (matched by name: the garage keeps the make's name).
    const { CarBrand } = require('../models/car_brands');
    const logos = new Map((await CarBrand.find({ name: { $in: [...allBrands.keys()] } }).select('name image').lean())
        .map((b) => [b.name, b.image || null]));

    return {
        groups: brandGroups,
        brands: [...allBrands].map(([name, count]) => ({ name, count, image: logos.get(name) || null })).sort((a, b) => a.name.localeCompare(b.name)),
        totals: {
            cars: rows.length,
            customers: new Set(rows.map((r) => String(r.user_id))).size,
            brands: brandGroups.length,
        },
    };
};

/* ------------------------------------------------------------------ *
 * Excel, in Arabic, right to left
 * ------------------------------------------------------------------ */

const styleHeader = (row) => {
    row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    row.height = 26;
};

const today = () => new Date().toISOString().slice(0, 10);

const buildCartReportWorkbook = async (query = {}) => {
    const report = await buildCartReport(query);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ready Marine';
    wb.created = new Date();
    const ws = wb.addWorksheet('منتجات في السلة', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = [6, 44, 24, 8, 24, 16, 28, 16, 14].map((width) => ({ width }));
    styleHeader(ws.addRow(['م', 'اسم المنتج', 'التاجر', 'الكمية', 'اسم العميل', 'رقم التليفون', 'الإيميل', 'المحافظة', 'آخر تحديث للسلة']));
    for (const r of report.rows) {
        const title = r.product_title_ar || 'منتج محذوف';
        const row = ws.addRow([
            r.serial,
            `${r.is_bundle ? 'باقة: ' : ''}${title}${r.variant ? ` (${r.variant})` : ''}`,
            r.vendor_name,
            r.quantity,
            r.customer_name,
            r.phone,
            r.email,
            r.governorate_ar,
            r.cart_updated_at ? new Date(r.cart_updated_at) : '',
        ]);
        row.getCell(9).numFmt = 'yyyy-mm-dd';
    }
    const t = report.totals;
    const total = ws.addRow(['', `الإجمالي: ${t.lines} منتج في سلال ${t.customers} عميل`, '', t.quantity]);
    total.font = { bold: true };
    return { workbook: wb, filename: `readymarine-cart-products-${today()}.xlsx` };
};

const buildCarsReportWorkbook = async (query = {}) => {
    const report = await buildCarsReport(query);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ready Marine';
    wb.created = new Date();
    const ws = wb.addWorksheet('عربيات العملاء', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    const COLS = 9;
    ws.columns = [16, 20, 8, 24, 16, 28, 16, 24, 14].map((width) => ({ width }));
    styleHeader(ws.addRow(['الماركة', 'الموديل', 'السنة', 'العميل', 'رقم التليفون', 'الإيميل', 'المحافظة', 'الشركة', 'تاريخ التسجيل']));
    for (const group of report.groups) {
        // The make's own line across the sheet, with how many cars it has.
        const head = ws.addRow([`${group.brand || '—'} — ${group.count} عربية`]);
        ws.mergeCells(head.number, 1, head.number, COLS);
        head.font = { bold: true, name: 'Arial' };
        head.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F5' } };
        for (const r of group.rows) {
            const row = ws.addRow([
                r.brand, r.model, r.year || '', r.customer_name, r.phone, r.email,
                r.governorate_ar, r.company, r.registered_at ? new Date(r.registered_at) : '',
            ]);
            row.getCell(9).numFmt = 'yyyy-mm-dd';
        }
    }
    const t = report.totals;
    const total = ws.addRow([`الإجمالي: ${t.cars} عربية — ${t.customers} عميل — ${t.brands} ماركة`]);
    ws.mergeCells(total.number, 1, total.number, COLS);
    total.font = { bold: true };
    return { workbook: wb, filename: `readymarine-customer-cars-${today()}.xlsx` };
};

/* ------------------------------------------------------------------ *
 * Abandoned-cart reminder emails
 * ------------------------------------------------------------------ */

// An order this soon after a reminder is counted as following it. Not proof the email caused
// it — the customer may have come back anyway — only that they did come back.
const REMINDER_ORDER_WINDOW_DAYS = 7;
const REMINDER_ROWS_LIMIT = 5000;

/**
 * The reminder emails the daily sweep sent or tried to send (services/abandonedCartService.js),
 * newest first, each with the customer's first order in the week after it.
 *
 * @param search  words matched against the customer's name, email, phone and the items
 * @param status  'sent' | 'failed' (refused, or outcome unknown) — empty for all
 */
const buildCartReminderReport = async ({ search = '', status = '' } = {}) => {
    const filter = {};
    if (status === 'sent') filter.status = 'sent';
    else if (status === 'failed') filter.status = { $in: ['failed', 'outcome_unknown'] };

    const emails = await AbandonedCartEmail.find(filter).sort({ created_at: -1 }).limit(REMINDER_ROWS_LIMIT).lean();

    const matches = matcher(search);
    const shown = emails.filter((e) => matches(
        fold([e.customer_name, e.email, e.phone, ...(e.items || []).map((i) => i.title)].join(' ')),
        e.phone,
    ));

    const windowMs = REMINDER_ORDER_WINDOW_DAYS * 24 * 3600 * 1000;
    const sent = shown.filter((e) => e.status === 'sent');
    const earliest = sent.reduce((min, e) => (e.created_at < min ? e.created_at : min), new Date());
    const orders = sent.length === 0 ? [] : await Order.find({
        user_id: { $in: [...new Set(sent.map((e) => String(e.user_id)))] },
        created_at: { $gt: earliest },
    }).select('user_id created_at total_price').sort({ created_at: 1 }).lean();
    const ordersByUser = new Map();
    for (const o of orders) {
        const key = String(o.user_id);
        if (!ordersByUser.has(key)) ordersByUser.set(key, []);
        ordersByUser.get(key).push(o);
    }

    const rows = shown.map((e) => {
        const after = e.status !== 'sent' ? null : (ordersByUser.get(String(e.user_id)) || []).find((o) => (
            o.created_at > e.created_at && o.created_at - e.created_at <= windowMs
        ));
        return {
            _id: e._id,
            user_id: e.user_id,
            customer_name: e.customer_name,
            email: e.email,
            phone: e.phone,
            language: e.language,
            status: e.status,
            sent_at: e.created_at,
            items: e.items || [],
            more_count: e.more_count || 0,
            item_count: (e.items || []).length + (e.more_count || 0),
            items_total: e.items_total || 0,
            attempt: e.attempt || 1,
            error: e.error || null,
            order_after: after ? { _id: after._id, created_at: after.created_at, total_price: after.total_price || 0 } : null,
        };
    });

    const sentRows = rows.filter((r) => r.status === 'sent');
    const ordered = sentRows.filter((r) => r.order_after);
    return {
        rows,
        order_window_days: REMINDER_ORDER_WINDOW_DAYS,
        truncated: emails.length === REMINDER_ROWS_LIMIT,
        totals: {
            sent: sentRows.length,
            failed: rows.length - sentRows.length,
            customers: new Set(sentRows.map((r) => String(r.user_id))).size,
            ordered_after: ordered.length,
            ordered_after_value: Math.round(ordered.reduce((sum, r) => sum + r.order_after.total_price, 0) * 100) / 100,
        },
    };
};

/**
 * One reminder as the customer saw it, rebuilt from what was logged at send time — the same
 * template, the same items. The unsubscribe link goes to the campaign preview's harmless page,
 * so an admin clicking around cannot unsubscribe the customer.
 */
const buildCartReminderPreview = async (id) => {
    if (!mongoose.isValidObjectId(id)) return null;
    const entry = await AbandonedCartEmail.findById(id).lean();
    if (!entry) return null;
    const { buildAbandonedCartEmail } = require('./emailService');
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const email = await buildAbandonedCartEmail({
        name: entry.customer_name,
        items: (entry.items || []).map((i) => ({
            title: i.title, variantLabel: i.variant_label, imageUrl: i.image_url, link: i.link, quantity: i.quantity, price: i.price,
        })),
        moreCount: entry.more_count || 0,
        cartUrl: `${frontendUrl}/${entry.language === 'ar' ? 'ar' : 'en'}/checkout`,
        unsubscribeUrl: `${frontendUrl}/unsubscribe-preview`,
        language: entry.language,
    });
    return { to: entry.email, sent_at: entry.created_at, status: entry.status, subject: email.subject, html: email.html };
};

const REMINDER_STATUS_AR = { sent: 'اتبعت', failed: 'فشل', outcome_unknown: 'غير معروف' };

const buildCartReminderReportWorkbook = async (query = {}) => {
    const report = await buildCartReminderReport(query);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ready Marine';
    wb.created = new Date();
    const ws = wb.addWorksheet('إيميلات تذكير السلة', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = [18, 24, 28, 16, 12, 60, 14, 18, 14, 40].map((width) => ({ width }));
    styleHeader(ws.addRow(['التاريخ', 'اسم العميل', 'الإيميل', 'رقم التليفون', 'الحالة', 'المنتجات', 'قيمة السلة', `طلب خلال ${report.order_window_days} أيام`, 'قيمة الطلب', 'الخطأ']));
    for (const r of report.rows) {
        const items = r.items.map((i) => `${i.title}${i.variant_label ? ` (${i.variant_label})` : ''} × ${i.quantity}`).join('، ')
            + (r.more_count ? ` + ${r.more_count} تاني` : '');
        const row = ws.addRow([
            new Date(r.sent_at),
            r.customer_name,
            r.email,
            r.phone,
            REMINDER_STATUS_AR[r.status] || r.status,
            items,
            r.items_total,
            r.order_after ? new Date(r.order_after.created_at) : (r.status === 'sent' ? 'لأ' : ''),
            r.order_after ? r.order_after.total_price : '',
            r.error || '',
        ]);
        row.getCell(1).numFmt = 'yyyy-mm-dd hh:mm';
        if (r.order_after) row.getCell(8).numFmt = 'yyyy-mm-dd';
    }
    const t = report.totals;
    const total = ws.addRow(['', `الإجمالي: ${t.sent} إيميل اتبعت لـ ${t.customers} عميل — ${t.ordered_after} طلبوا بعدها`]);
    total.font = { bold: true };
    return { workbook: wb, filename: `readymarine-cart-reminders-${today()}.xlsx` };
};

module.exports = {
    buildCartReport, buildCarsReport, buildCartReportWorkbook, buildCarsReportWorkbook,
    buildCartReminderReport, buildCartReminderReportWorkbook, buildCartReminderPreview,
};
