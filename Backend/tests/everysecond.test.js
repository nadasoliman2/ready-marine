const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    toExternalId,
    parseExternalId,
    signBody,
    verifySignature,
    menuItemsForProduct,
    itemHash,
    matchCity,
    orderAddressFromChat,
    fitmentOf,
    isSellableStock,
} = require('../services/everysecond/helpers');

const P = 'a'.repeat(24);
const V = 'b'.repeat(24);

const ctx = {
    isActiveVendor: (id) => String(id) === 'vendor-ok',
    categoryName: () => 'Brakes',
    brandName: () => 'Bosch',
    imageUrl: (u) => (u ? `https://readycar.store${u}` : ''),
    productUrl: (p) => `https://readycar.store/ar/product/${p.slug_ar}`,
    maxQtyPerOrder: null,
};

const product = (over = {}) => ({
    _id: P,
    title_en: 'Brake pads',
    title_ar: 'تيل فرامل',
    slug_ar: 'تيل-فرامل',
    price: 500,
    discount_price: null,
    status: 'published',
    vendor_id: 'vendor-ok',
    stock_management: true,
    stock_status: 'instock',
    quantity: 4,
    images: [{ url: '/uploads/products/x.jpg', is_primary: true }],
    compatible_cars: [{ brand_name: 'Toyota', models: [{ model_name: 'Corolla', years: [2018, 2015, 2020] }] }],
    variants: [],
    ...over,
});

test('external ids round-trip and refuse anything that is not ours', () => {
    assert.equal(toExternalId(P), P);
    assert.equal(toExternalId(P, V), `${P}~${V}`);
    assert.deepEqual(parseExternalId(`${P}~${V}`), { productId: P, variantId: V });
    assert.deepEqual(parseExternalId(P.toUpperCase()), { productId: P, variantId: null });
    assert.equal(parseExternalId('SKU-1042'), null);
    assert.equal(parseExternalId(`${P}~nope`), null);
});

test('a webhook signature is checked over t.body, any v1 matching, within the tolerance', () => {
    const now = 1_800_000_000_000;
    const t = now / 1000;
    const body = Buffer.from('{"event":"order.created"}');
    const good = signBody('whsec_x', t, body);
    assert.ok(verifySignature({ header: `t=${t},v1=${good}`, rawBody: body, secret: 'whsec_x', now }));
    assert.ok(verifySignature({ header: `t=${t},v1=${'0'.repeat(64)},v1=${good}`, rawBody: body, secret: 'whsec_x', now }));
    assert.ok(!verifySignature({ header: `t=${t},v1=${good}`, rawBody: Buffer.from('{}'), secret: 'whsec_x', now }));
    assert.ok(!verifySignature({ header: `t=${t - 600},v1=${signBody('whsec_x', t - 600, body)}`, rawBody: body, secret: 'whsec_x', now }));
    assert.ok(!verifySignature({ header: '', rawBody: body, secret: 'whsec_x', now }));
});

test('a published product becomes one menu item with its link, photo, fitment and list/offer price', () => {
    const items = menuItemsForProduct(product({ discount_price: 420 }), ctx);
    const item = items.get(P);
    assert.equal(item.price, 500);
    assert.equal(item.offer_price, 420);
    assert.equal(item.available, true);
    assert.equal(item.stock_qty, 4);
    assert.equal(item.image_url, 'https://readycar.store/uploads/products/x.jpg');
    assert.equal(item.product_url, 'https://readycar.store/ar/product/تيل-فرامل');
    assert.deepEqual(item.name, { en: 'Brake pads', ar: 'تيل فرامل' });
    assert.match(item.description.en, /Fits: Toyota Corolla 2015–2020/);
    assert.match(item.description.ar, /يناسب/);
    assert.equal(item.category, 'Brakes');
});

test('drafts, inactive vendors and priceless rows must not be on the menu', () => {
    assert.equal(menuItemsForProduct(product({ status: 'pending' }), ctx).get(P), null);
    assert.equal(menuItemsForProduct(product({ vendor_id: 'vendor-off' }), ctx).get(P), null);
    assert.equal(menuItemsForProduct(product({ price: 0 }), ctx).get(P), null);
});

test('each variant is its own item with its own price and options', () => {
    const items = menuItemsForProduct(product({
        variants: [{ _id: V, price: 650, discount_price: null, selected_options: [{ type_name: 'Side', option_value: 'Front' }] }],
    }), ctx);
    const item = items.get(`${P}~${V}`);
    assert.equal(item.price, 650);
    assert.equal(item.offer_price, null);
    assert.deepEqual(item.options, { Side: 'Front' });
    assert.equal(item.option_group, 'Brake pads');
    assert.equal(item.name.en, 'Brake pads (Front)');
    assert.equal(items.has(P), false);
});

test('a title longer than the 255 characters EverySecond accepts is cut, keeping the variant label', () => {
    const long = 'Car mount '.repeat(40);
    const plain = menuItemsForProduct(product({ title_en: long, title_ar: long }), ctx).get(P);
    assert.ok(plain.name.en.length <= 255 && plain.name.ar.length <= 255);
    assert.ok(plain.name.en.endsWith('…'));
    const variant = menuItemsForProduct(product({
        title_en: long,
        variants: [{ _id: V, price: 10, selected_options: [{ type_name: 'Colour', option_value: 'Black' }] }],
    }), ctx).get(`${P}~${V}`);
    assert.ok(variant.name.en.length <= 255);
    assert.ok(variant.name.en.endsWith('(Black)'));
});

test('stock: explicit out of stock or a tracked zero hides it; an untracked quantity does not', () => {
    assert.equal(isSellableStock(product({ stock_status: 'outofstock' })), false);
    assert.equal(isSellableStock(product({ quantity: 0 })), false);
    assert.equal(isSellableStock(product({ quantity: null })), true);
    assert.equal(isSellableStock(product({ quantity: 0, stock_status: 'onbackorder' })), true);
    assert.equal(isSellableStock(product({ quantity: 0, stock_management: false })), true);
});

test('the hash only changes when the content does', () => {
    const a = menuItemsForProduct(product(), ctx).get(P);
    const b = menuItemsForProduct(product(), ctx).get(P);
    assert.equal(itemHash(a), itemHash(b));
    assert.notEqual(itemHash(a), itemHash(menuItemsForProduct(product({ price: 510 }), ctx).get(P)));
});

test('universal parts say so', () => {
    assert.equal(fitmentOf({ is_universal: true }, 'en'), 'Universal fit');
});

const cities = [
    { name: 'Cairo', name_ar: 'القاهره', country: 'Egypt' },
    { name: 'Giza', name_ar: 'الجيزه', country: 'Egypt' },
    { name: 'Alexandria', name_ar: 'الاسكندريه', country: 'Egypt' },
];

test('a governorate is matched however it is spelled', () => {
    assert.equal(matchCity(['القاهرة'], cities)?.name, 'Cairo');
    assert.equal(matchCity(['El Giza'], cities)?.name, 'Giza');
    assert.equal(matchCity(['alex'], cities)?.name, 'Alexandria');
    assert.equal(matchCity(['مدينة نصر - القاهرة'], cities)?.name, 'Cairo');
    assert.equal(matchCity(['Narnia'], cities), null);
});

test('a chat address becomes a shipping address and destination', () => {
    const a = orderAddressFromChat(
        { type: 'delivery', zone: 'Giza', address_details: { street: 'Faisal St', building: '12', unit: '5', area: 'Haram' } },
        { cities, name: 'Ahmed', phone: '01012345678' }
    );
    assert.deepEqual(a.shipping_destination, { country: 'Egypt', city: 'Giza' });
    assert.equal(a.shipping_address.recipient_name, 'Ahmed');
    assert.match(a.shipping_address.full_address, /Faisal St, Building 12, Apt 5, Haram/);
});
