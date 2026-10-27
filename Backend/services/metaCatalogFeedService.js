/**
 * The product feed Meta (Facebook / Instagram) Commerce Manager reads to build the shop's
 * catalog: one CSV row per product a customer can find on the site, in Meta's column names.
 *
 * The same products the storefront lists — published, from a vendor that is not suspended
 * and has a live subscription (productService.getActiveVendorIds) — so the catalog never
 * advertises a product whose page would not open.
 *
 * `id` is the product's database id: the checkout's InitiateCheckout and Purchase pixel
 * events send that id as content_ids, and Meta matches the two to show the right product.
 */
const { Product } = require('../models/products');
const { Brand } = require('../models/product_brands');
const { CarBrand } = require('../models/car_brands');
const { Category } = require('../models/categories');
const { getActiveVendorIds } = require('./productService');

const CURRENCY = 'EGP';
const CACHE_MS = 15 * 60 * 1000;
const MAX_TITLE = 200;          // Meta's limit
const MAX_DESCRIPTION = 5000;   // Meta allows 9999; a feed row this long is never read
const MAX_EXTRA_IMAGES = 10;

const COLUMNS = [
    'id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price',
    'link', 'image_link', 'additional_image_link', 'brand', 'mpn', 'gtin', 'product_type',
];

const siteUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
const filesUrl = () => (process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/+$/, '');

/** An image path as Meta can fetch it: absolute, and ASCII (an Arabic file name is escaped). */
const absoluteUrl = (url) => {
    const raw = String(url || '').trim();
    if (!raw) return '';
    const full = /^https?:\/\//i.test(raw) ? raw : `${filesUrl()}${raw.startsWith('/') ? '' : '/'}${raw}`;
    return /[^\x21-\x7E]/.test(full) ? encodeURI(full) : full;
};

/** Plain text: descriptions are written in the rich editor and arrive as HTML. */
const plainText = (html) => String(html || '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const money = (n) => `${(Math.round(Number(n) * 100) / 100).toFixed(2)} ${CURRENCY}`;

/**
 * Buyable as the product page decides it: stock is only counted when the vendor manages it,
 * and a product with options is buyable while any option has stock.
 */
const isInStock = (p) => {
    if (!p.stock_management) return true;
    if (Number(p.quantity) > 0) return true;
    return (p.variants || []).some((v) => Number(v.stock) > 0);
};

/** Meta rejects a malformed GTIN; a vendor's free-typed one is sent only when it is one. */
const validGtin = (value) => {
    const digits = String(value || '').trim();
    return /^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits) ? digits : '';
};

const pick = (lang, ar, en) => (lang === 'ar' ? (ar || en) : (en || ar)) || '';

/** "Parent > Child" category paths, in the feed's language. */
const categoryPaths = (categories, lang) => {
    const byId = new Map(categories.map((c) => [String(c._id), c]));
    const paths = new Map();
    const pathOf = (id, seen = new Set()) => {
        const key = String(id);
        if (paths.has(key)) return paths.get(key);
        const cat = byId.get(key);
        if (!cat || seen.has(key)) return '';
        seen.add(key);
        const name = pick(lang, cat.name_ar, cat.name);
        const parent = cat.parent_id ? pathOf(cat.parent_id, seen) : '';
        const path = parent ? `${parent} > ${name}` : name;
        paths.set(key, path);
        return path;
    };
    categories.forEach((c) => pathOf(c._id));
    return paths;
};

/** One product as its CSV cells, or null when Meta would reject it (no link, image or price). */
const toRow = (p, { lang, brandNames, categoryPath }) => {
    const slug = pick(lang, p.slug_ar, p.slug_en);
    const images = (p.images || []).map((img) => absoluteUrl(img?.url)).filter(Boolean);
    const price = Number(p.price);
    if (!slug || !images.length || !(price > 0)) return null;

    const title = clip(plainText(pick(lang, p.title_ar, p.title_en)), MAX_TITLE);
    if (!title) return null;
    const description = clip(
        plainText(pick(lang, p.description_ar, p.description_en))
            || plainText(pick(lang, p.subtitle_ar, p.subtitle_en))
            || title,
        MAX_DESCRIPTION,
    );
    const sale = Number(p.discount_price);

    return {
        id: String(p._id),
        title,
        description,
        availability: isInStock(p) ? 'in stock' : 'out of stock',
        condition: 'new',
        price: money(price),
        sale_price: sale > 0 && sale < price ? money(sale) : '',
        link: `${siteUrl()}/${lang}/product/${encodeURIComponent(slug)}`,
        image_link: images[0],
        additional_image_link: images.slice(1, 1 + MAX_EXTRA_IMAGES).join(','),
        brand: brandNames.get(String(p.product_brand_id)) || 'Ready Marine',
        mpn: String(p.part_number || '').trim(),
        gtin: validGtin(p.gtin),
        product_type: categoryPath.get(String(p.category_id)) || '',
    };
};

// Every cell quoted and inner quotes doubled, as routes/adminFinance.js does. No BOM: Meta
// would read the first column as "﻿id" and find no id column.
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const toCsv = (rows) => [COLUMNS, ...rows.map((r) => COLUMNS.map((c) => r[c]))]
    .map((r) => r.map(cell).join(','))
    .join('\r\n');

const buildFeed = async (lang) => {
    const [activeVendorIds, brands, carBrands, categories] = await Promise.all([
        getActiveVendorIds(),
        Brand.find().select('name').lean(),
        CarBrand.find().select('name').lean(),
        Category.find().select('name name_ar parent_id').lean(),
    ]);
    const brandNames = new Map([...brands, ...carBrands].map((b) => [String(b._id), String(b.name || '').trim()]));
    const categoryPath = categoryPaths(categories, lang);

    const rows = [];
    const cursor = Product.find({ status: 'published', vendor_id: { $in: activeVendorIds } })
        .select('title_ar title_en subtitle_ar subtitle_en description_ar description_en slug_ar slug_en '
            + 'price discount_price images stock_management quantity variants.stock product_brand_id '
            + 'category_id part_number gtin')
        .sort({ created_at: -1 })
        .lean()
        .cursor();
    for await (const p of cursor) {
        const row = toRow(p, { lang, brandNames, categoryPath });
        if (row) rows.push(row);
    }
    return { csv: toCsv(rows), count: rows.length };
};

const cache = new Map(); // lang → { at, promise }

/** The feed for 'ar' or 'en', built at most once every 15 minutes. */
const getMetaCatalogCsv = async (lang = 'ar') => {
    const key = lang === 'en' ? 'en' : 'ar';
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
    const promise = buildFeed(key);
    cache.set(key, { at: Date.now(), promise });
    promise.catch(() => cache.delete(key)); // a failed build is retried on the next fetch
    return promise;
};

module.exports = {
    getMetaCatalogCsv,
    COLUMNS,
    _test: { toRow, toCsv, plainText, isInStock, validGtin, categoryPaths, absoluteUrl },
};
