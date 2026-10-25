const test = require('node:test');
const assert = require('node:assert/strict');

process.env.FRONTEND_URL = 'https://readycar.store';
process.env.BACKEND_PUBLIC_URL = 'https://readycar.store';

const { COLUMNS, _test: { toRow, toCsv, plainText, isInStock, validGtin, categoryPaths, absoluteUrl } } = require('../services/metaCatalogFeedService');

const ctx = (lang = 'ar') => ({
    lang,
    brandNames: new Map([['b1', 'Bosch']]),
    categoryPath: categoryPaths([
        { _id: 'c1', name: 'Filters', name_ar: 'فلاتر' },
        { _id: 'c2', name: 'Oil filters', name_ar: 'فلاتر زيت', parent_id: 'c1' },
    ], lang),
});

const product = (over = {}) => ({
    _id: '665f00000000000000000001',
    title_ar: 'فلتر زيت بوش', title_en: 'Bosch oil filter',
    description_ar: '<p>فلتر&nbsp;أصلي</p><ul><li>يناسب تويوتا</li></ul>', description_en: '',
    slug_ar: 'فلتر-زيت-بوش', slug_en: 'bosch-oil-filter',
    price: 450, discount_price: 399,
    images: [{ url: '/uploads/products/a.jpg' }, { url: 'https://cdn.example.com/b.jpg' }],
    stock_management: true, quantity: 3, variants: [],
    product_brand_id: 'b1', category_id: 'c2', part_number: '0 451 103 316', gtin: '4047024',
    ...over,
});

test('a product becomes one row in Meta\'s columns, in Arabic by default', () => {
    const row = toRow(product(), ctx());
    assert.deepEqual(Object.keys(row), COLUMNS);
    assert.equal(row.id, '665f00000000000000000001');
    assert.equal(row.title, 'فلتر زيت بوش');
    assert.equal(row.description, 'فلتر أصلي يناسب تويوتا');
    assert.equal(row.price, '450.00 EGP');
    assert.equal(row.sale_price, '399.00 EGP');
    assert.equal(row.availability, 'in stock');
    assert.equal(row.condition, 'new');
    assert.equal(row.link, `https://readycar.store/ar/product/${encodeURIComponent('فلتر-زيت-بوش')}`);
    assert.equal(row.image_link, 'https://readycar.store/uploads/products/a.jpg');
    assert.equal(row.additional_image_link, 'https://cdn.example.com/b.jpg');
    assert.equal(row.brand, 'Bosch');
    assert.equal(row.mpn, '0 451 103 316');
    assert.equal(row.gtin, '', 'a 7-digit GTIN is not one');
    assert.equal(row.product_type, 'فلاتر > فلاتر زيت');
});

test('English feed falls back to the Arabic text a product only has in Arabic', () => {
    const row = toRow(product(), ctx('en'));
    assert.equal(row.title, 'Bosch oil filter');
    assert.equal(row.description, 'فلتر أصلي يناسب تويوتا');
    assert.equal(row.link, 'https://readycar.store/en/product/bosch-oil-filter');
    assert.equal(row.product_type, 'Filters > Oil filters');
});

test('stock is counted only when the vendor manages it, and any option in stock is enough', () => {
    assert.equal(isInStock({ stock_management: false, quantity: 0 }), true);
    assert.equal(isInStock({ stock_management: true, quantity: 0 }), false);
    assert.equal(isInStock({ stock_management: true, quantity: null }), false);
    assert.equal(isInStock({ stock_management: true, quantity: 0, variants: [{ stock: 0 }, { stock: 2 }] }), true);
    assert.equal(toRow(product({ quantity: 0 }), ctx()).availability, 'out of stock');
});

test('no sale price unless it is below the price; no brand falls back to ReadyCar', () => {
    const row = toRow(product({ discount_price: null, product_brand_id: null }), ctx());
    assert.equal(row.sale_price, '');
    assert.equal(row.brand, 'ReadyCar');
    assert.equal(toRow(product({ discount_price: 450 }), ctx()).sale_price, '');
});

test('a product Meta would reject is left out', () => {
    assert.equal(toRow(product({ images: [] }), ctx()), null);
    assert.equal(toRow(product({ price: 0 }), ctx()), null);
    assert.equal(toRow(product({ slug_ar: '', slug_en: '' }), ctx()), null);
    assert.equal(toRow(product({ title_ar: '', title_en: '' }), ctx()), null);
});

test('description falls back to the subtitle, then the title', () => {
    assert.equal(toRow(product({ description_ar: '', subtitle_ar: 'أصلي' }), ctx()).description, 'أصلي');
    assert.equal(toRow(product({ description_ar: '<p> </p>' }), ctx()).description, 'فلتر زيت بوش');
});

test('helpers: GTIN shapes, HTML entities, non-ASCII image paths', () => {
    assert.equal(validGtin('4006381333931'), '4006381333931');
    assert.equal(validGtin('12345'), '');
    assert.equal(plainText('A&amp;B<br>C&quot;'), 'A&B C"');
    assert.equal(absoluteUrl('/uploads/صورة.jpg'), `https://readycar.store/uploads/${encodeURIComponent('صورة')}.jpg`);
});

test('CSV: header first, every cell quoted, quotes doubled, no BOM', () => {
    const csv = toCsv([toRow(product({ title_ar: 'فلتر "بوش", أصلي' }), ctx())]);
    const [header, line] = csv.split('\r\n');
    assert.equal(header, COLUMNS.map((c) => `"${c}"`).join(','));
    assert.ok(line.includes('"فلتر ""بوش"", أصلي"'));
    assert.notEqual(csv.charCodeAt(0), 0xFEFF);
});
