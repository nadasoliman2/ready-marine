const { Product } = require('../models/products');

/**
 * Give every order line enough about its product for a screen to link to it.
 *
 * Order lines are snapshots (title, image, price frozen at checkout) and only carry the
 * product's id. The customer, vendor and admin order screens all want a "go to this
 * product" button, and that needs the product's CURRENT slug — a snapshot would go stale
 * the first time a product is renamed. One query for the whole page, then the lines are
 * stamped in place, so the lean documents keep working everywhere they already flow.
 *
 * Adds to each item: `product_slug`, `product_sku`, `product_part_number`. Items whose
 * product has since been deleted are left as they are, and the screens hide the button.
 */
const attachProductLinks = async (orders = []) => {
    const ids = new Set();
    for (const order of orders) {
        for (const item of order?.items || []) {
            const id = item?.product_id?._id || item?.product_id;
            if (id) ids.add(String(id));
        }
    }
    if (ids.size === 0) return orders;

    const products = await Product.find({ _id: { $in: [...ids] } })
        .select('slug_en slug_ar sku part_number')
        .lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    for (const order of orders) {
        for (const item of order?.items || []) {
            const id = item?.product_id?._id || item?.product_id;
            const product = id ? byId.get(String(id)) : null;
            if (!product) continue;
            item.product_slug = product.slug_en || product.slug_ar || null;
            item.product_sku = product.sku || null;
            item.product_part_number = product.part_number || null;
        }
    }
    return orders;
};

module.exports = { attachProductLinks };
