const { recordAuditLog } = require("../../models/auditLog");

/**
 * Record a product's publishing state changing hands.
 *
 * Nothing else keeps this. A product taken off the shop reads to everyone — the vendor,
 * the admin, the customer following a link — as the site being broken: its page answers
 * "not found" while the product still has its orders, its rating and its reviews. When a
 * live product went to `draft` in Sep 2026 there was no way to tell whether a vendor, an
 * admin or a subscription lapse had done it. Now there is.
 *
 * Never throws: the audit trail must not be the reason a legitimate edit fails.
 */
const recordProductStatusChange = async ({ product, from, to, actor = {}, reason = "" }) => {
    if (!product?._id || !to || from === to) return null;
    return recordAuditLog({
        action: `product_status_${to}`,
        actor: { role: actor.role || "system", label: actor.label || "System" },
        target_type: "product",
        target_id: product._id,
        target_snapshot: {
            title: product.title_en || product.title_ar || "",
            sku: product.sku || "",
            slug: product.slug_en || product.slug_ar || "",
            vendor_id: product.vendor_id?._id || product.vendor_id || null,
        },
        impact: { from: from || null, to, reason: reason || "" },
    });
};

module.exports = { recordProductStatusChange };
