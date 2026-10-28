// Customer recommendations (services/productService.js getRecommendationsForUser) and the
// audience keys a product or a customer may carry (services/shared/audiences.js).
// Needs a throwaway MongoDB: see tests/support/testServers.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { startMongo } = require('./support/testServers');

let mongo, Product, User, getRecommendationsForUser;
let vendorId, fishing, camping;

let serial = 0;
const product = (title, extra = {}) => Product.create({
    vendor_id: vendorId,
    category_id: fishing,
    title_en: title,
    subtitle_en: title,
    description_en: title,
    slug_en: `p-${++serial}`,
    sku: `SKU-${serial}`,
    price: 100,
    status: 'published',
    is_universal: true,
    ...extra,
});

before(async () => {
    mongo = await startMongo('recommendations_tests');
    await mongoose.connect(mongo.uri);
    ({ Product } = require('../models/products'));
    ({ User } = require('../models/users'));
    ({ getRecommendationsForUser } = require('../services/productService'));
});

after(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
    await mongo.stop();
});

beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    // Inserted raw: only what getActiveVendorIds looks at matters here.
    vendorId = new mongoose.Types.ObjectId();
    await mongoose.connection.collection('sellers').insertOne({ _id: vendorId, status: 'active', subscription_status: 'active' });
    fishing = new mongoose.Types.ObjectId();
    camping = new mongoose.Types.ObjectId();
});

test('a customer with no vessel, no cart and no interests still gets products', async () => {
    await product('Reel');
    await product('Tent', { category_id: camping });
    const user = await User.create({ name: 'C', phone: '01000000101' });

    const { products, cars } = await getRecommendationsForUser(user._id, 5);
    assert.equal(products.length, 2);
    assert.deepEqual(cars, []);
    assert.ok(products.every((p) => ['new', 'popular'].includes(p.reason)));
});

test('picked interests bring in the products of those hubs', async () => {
    await product('Plain reel', { created_at: new Date(Date.now() + 1000) });
    const lure = await product('Big game lure', { target_audiences: ['pro_angler'] });
    const user = await User.create({ name: 'C', phone: '01000000102', interests: ['pro_angler'] });

    const { products } = await getRecommendationsForUser(user._id, 5);
    const hit = products.find((p) => String(p._id) === String(lure._id));
    assert.equal(hit?.reason, 'interest');
});

test('the cart brings its categories, and its own products are left out', async () => {
    const inCart = await product('Reel in cart');
    const sameCategory = await product('Another reel', { sold_count: 9 });
    await product('Tent', { category_id: camping });
    const user = await User.create({
        name: 'C', phone: '01000000103',
        cart: { items: [{ product_id: inCart._id, quantity: 1 }] },
    });

    const { products } = await getRecommendationsForUser(user._id, 5);
    assert.ok(!products.some((p) => String(p._id) === String(inCart._id)), 'the cart item is not recommended back');
    assert.equal(products.find((p) => String(p._id) === String(sameCategory._id))?.reason, 'cart');
});

test('unpublished products and suspended vendors never show', async () => {
    await product('Draft', { status: 'draft' });
    const other = new mongoose.Types.ObjectId();
    await mongoose.connection.collection('sellers').insertOne({ _id: other, status: 'suspended', subscription_status: 'active' });
    await product('From suspended', { vendor_id: other });
    const user = await User.create({ name: 'C', phone: '01000000104' });

    const { products } = await getRecommendationsForUser(user._id, 5);
    assert.equal(products.length, 0);
});

test('unknown audience keys are dropped on products and customers', async () => {
    const p = await product('Tagged', { target_audiences: ['pro_angler', 'bogus', 'pro_angler', ' yacht_luxury '] });
    assert.deepEqual([...p.target_audiences], ['pro_angler', 'yacht_luxury']);

    const user = await User.create({ name: 'C', phone: '01000000105' });
    await User.findByIdAndUpdate(user._id, { interests: ['family_safety', 'nope'] });
    const saved = await User.findById(user._id).lean();
    assert.deepEqual(saved.interests, ['family_safety']);
});
