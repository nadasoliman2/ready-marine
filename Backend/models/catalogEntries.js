const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ Catalog Entry ------------------
 *
 * "What the product is", separated from "the vendor's offer on it".
 *
 * A catalog entry is the platform's description of a part — title, images,
 * category, brand, compatibility, variation types. Vendor products carry price,
 * stock and publish status, and point back here through `catalog_entry_id`.
 *
 * The relationship is deliberately one-directional and non-authoritative: entry
 * data is COPIED into a vendor product when the vendor picks the entry, and never
 * again. Editing an entry does not touch a single linked product. The link exists
 * so the business can answer "which merchants carry this, and at what price" —
 * it is not a control channel, which is why vendors are never shown it.
 *
 * Entries deliberately have NO unique identity key (part number and GTIN are both
 * optional). Duplicate detection is an admin judgement call, helped by the
 * "similar entries" suggestion on the review screen. Revisit if duplicates pile up.
 */

/* Sub-documents mirror the product schema shapes so an entry can be spread
   straight onto a product payload without translation. */
const imageSchema = new Schema(
    {
        url: { type: String, required: true },
        is_primary: { type: Boolean, default: false },
    },
    { _id: true }
);

const variationOptionSchema = new Schema(
    { value: { type: String, required: true } },
    { _id: true }
);

const variationTypeSchema = new Schema(
    {
        name: { type: String, required: true },
        options: [variationOptionSchema],
    },
    { _id: true }
);

const compatibleModelSchema = new Schema(
    {
        model_id: { type: Schema.Types.ObjectId, required: true },
        model_name: { type: String, required: true },
        years: [{ type: Number }],
        all_years: { type: Boolean, default: false },
    },
    { _id: false }
);

const compatibleCarSchema = new Schema(
    {
        brand_id: { type: Schema.Types.ObjectId, required: true },
        brand_name: { type: String, required: true },
        models: [compatibleModelSchema],
        all_models: { type: Boolean, default: false },
    },
    { _id: false }
);

const catalogEntrySchema = new Schema(
    {
        // Localized content. Only a title (in either language) and a category are
        // required — an incomplete entry still saves the vendor typing, and the
        // vendor's own publish validation is what guards the storefront.
        title_en: { type: String, trim: true },
        title_ar: { type: String, trim: true },

        subtitle_en: { type: String, trim: true },
        subtitle_ar: { type: String, trim: true },

        description_en: { type: String },
        description_ar: { type: String },

        category_id: {
            type: Schema.Types.ObjectId,
            ref: "Category",
            required: [true, 'A catalog entry must have a category.'],
            index: true,
        },

        // Either a hand-entered brand (`Brand`) or a car make (`CarBrand`): a Toyota part is
        // branded Toyota without anyone typing Toyota a second time. Which collection the id
        // lives in is `product_brand_source`, stamped automatically on every write — see
        // services/shared/brandRef.js.
        product_brand_id: {
            type: Schema.Types.ObjectId,
            refPath: "product_brand_source",
            default: null,
            index: true,
        },
        product_brand_source: {
            type: String,
            enum: ["Brand", "CarBrand"],
            default: "Brand",
        },

        // Manufacturer identifiers. Not unique and not required — see the header note.
        part_number: { type: String, trim: true, index: true },
        gtin: { type: String, trim: true, index: true },

        images: [imageSchema],

        is_universal: { type: Boolean, default: true },
        compatible_cars: [compatibleCarSchema],

        // The shape of the variations (Size → S/M/L), never their price or stock:
        // those belong to the vendor's copy.
        variation_types: [variationTypeSchema],

        // suggested — created from a vendor's "add new product", awaiting admin review.
        //             Visible in vendor search badged "Under review", and selectable.
        // approved  — part of the catalog proper.
        // archived  — hidden from vendor search; existing links keep working.
        // merged    — folded into `merged_into`; never surfaced again.
        // rejected  — a suggestion the admin turned down; never offered again unless restored.
        status: {
            type: String,
            enum: ['suggested', 'approved', 'archived', 'merged', 'rejected'],
            default: 'suggested',
            index: true,
        },

        // Set when status === 'merged'. Kept (rather than deleting the row) so a
        // stale link on an old product can still be resolved to the surviving entry.
        merged_into: { type: Schema.Types.ObjectId, ref: "CatalogEntry", default: null },

        // Provenance, admin-facing only. An entry belongs to the platform from the
        // moment it exists, even when a vendor's product produced it.
        created_by_role: { type: String, enum: ['admin', 'vendor'], default: 'admin' },
        created_by_vendor_id: { type: Schema.Types.ObjectId, ref: "Seller", default: null, index: true },
        // The vendor product that generated this suggestion, for admin context.
        source_product_id: { type: Schema.Types.ObjectId, ref: "Product", default: null },

        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

catalogEntrySchema.pre('validate', function (next) {
    // A title in at least one language — the entry is unusable in search without it.
    if (!this.title_en?.trim() && !this.title_ar?.trim()) {
        this.invalidate('title_en', 'A catalog entry must have a title in English or Arabic.');
    }
    // Universal and specific compatibility are mutually exclusive, same as products.
    if (this.is_universal) this.compatible_cars = [];
    this.updated_at = new Date();
    if (typeof next === 'function') next();
});

/* ------------------ Indexing ------------------ */
// Vendor search is a title/part-number lookup; the text index carries it.
catalogEntrySchema.index({
    title_en: "text",
    title_ar: "text",
    subtitle_en: "text",
    subtitle_ar: "text",
    part_number: "text",
});
// The default list ordering: newest first within a status tab.
catalogEntrySchema.index({ status: 1, created_at: -1 });

require("../services/shared/brandRef").attachBrandSourceHooks(catalogEntrySchema);

const CatalogEntry = mongoose.model("CatalogEntry", catalogEntrySchema);

module.exports = { CatalogEntry };
