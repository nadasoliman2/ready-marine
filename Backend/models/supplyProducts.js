const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * SupplyProduct — one packaging or labelling item the store sells to its vendors.
 *
 * This is a small, admin-owned catalogue that is deliberately NOT the `Product` collection:
 * these are never listed publicly, never carry a vendor, never enter a customer's basket,
 * and are priced in packs rather than per unit. Sharing the storefront model would have
 * meant a `is_supply` flag threaded through every public query — one missed filter and
 * flyers appear in the shop.
 *
 * PRICE IS PER PACK, not per piece. The supplier's list is written that way ("فلير صغير:
 * 3.5 جنيه / 10 قطع" is 3.5 for the ten), and a vendor orders whole packs, so `price` is
 * what one pack costs and `pack_size` only describes what is inside it. Storing a per-piece
 * price instead would force a division that does not divide evenly on most of the list.
 */

const SUPPLY_CATEGORIES = ["poly_mailer", "box", "sticker", "label", "other"];

const supplyProductSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        name_ar: { type: String, trim: true, default: "" },
        description: { type: String, trim: true, default: "" },
        description_ar: { type: String, trim: true, default: "" },

        category: { type: String, enum: SUPPLY_CATEGORIES, default: "other", index: true },

        // Free text rather than three numbers: a mailer is two dimensions, a box is three,
        // and a label roll is neither. The supplier's own wording is the most useful thing
        // to show a vendor deciding which size to buy.
        dimensions: { type: String, trim: true, default: "" },

        /** What ONE pack costs, in EGP. */
        price: { type: Number, required: true, min: 0 },
        /** How many pieces are in that pack. 1 for items sold singly, such as boxes. */
        pack_size: { type: Number, required: true, min: 1, default: 1 },
        /** What one piece is called, for the "10 قطع" / "500 ملصق" line under the price. */
        unit_label: { type: String, trim: true, default: "piece" },
        unit_label_ar: { type: String, trim: true, default: "قطعة" },

        /** Fewest packs a vendor may order in one line. */
        min_order_quantity: { type: Number, default: 1, min: 1 },
        /** Most packs per line, or null for no ceiling. Guards a mis-typed 1000. */
        max_order_quantity: { type: Number, default: null },

        image: { type: String, default: "" },

        // Deactivating is how an item goes out of stock. There is no stock count on
        // purpose: a number nobody updates after every delivery is worse than no number,
        // because vendors would order against it and be told later it was wrong.
        is_active: { type: Boolean, default: true, index: true },
        sort_order: { type: Number, default: 0 },
    },
    { timestamps: true }
);

// Case-insensitive uniqueness on name, so the same item cannot be added twice under
// "White Bag" and "white bag" with two different prices.
supplyProductSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
supplyProductSchema.index({ is_active: 1, category: 1, sort_order: 1 });

/** What one pack costs and what it contains, as the vendor's cart shows it. */
supplyProductSchema.methods.packSummary = function () {
    return {
        price: this.price,
        pack_size: this.pack_size,
        unit_label: this.unit_label,
        unit_label_ar: this.unit_label_ar,
    };
};

const SupplyProduct = mongoose.model("SupplyProduct", supplyProductSchema);

module.exports = { SupplyProduct, SUPPLY_CATEGORIES };
