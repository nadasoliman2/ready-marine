const mongoose = require("mongoose");
const { Schema } = mongoose;
const { DISCOUNT_TYPES, computeDiscountPrice, validateDiscount } = require("../services/shared/productPricing");

/* ------------------ Image ------------------ */
const imageSchema = new Schema(
    {
        url: { type: String, required: true },
        is_primary: { type: Boolean, default: false },
    },
    { _id: true }
);

/* ------------------ Variation Option ------------------ */
const variationOptionSchema = new Schema(
    {
        value: { type: String, required: true },
    },
    { _id: true }
);

/* ------------------ Variation Type ------------------ */
const variationTypeSchema = new Schema(
    {
        name: { type: String, required: true },
        options: [variationOptionSchema],
    },
    { _id: true }
);

/* ------------------ Selected Option (inside variant) ------------------ */
const selectedOptionSchema = new Schema(
    {
        type_id: { type: Schema.Types.ObjectId, required: false, default: null },
        type_name: { type: String, required: true },

        option_id: { type: Schema.Types.ObjectId, required: false, default: null },
        option_value: { type: String, required: true },
    },
    { _id: false }
);

/* ------------------ Variant ------------------ */
const variantSchema = new Schema(
    {
        price: { type: Number, default: null },           // null = use product base price

        // Discount input — same shape as the product level. The discount applies
        // to this variant's effective price (variant.price ?? product.price).
        discount_type: { type: String, enum: [...DISCOUNT_TYPES, null], default: null },
        discount_value: { type: Number, default: null, min: 0 },

        // DERIVED from discount_type + discount_value — never write it directly.
        // null = no variant discount (falls back to the product base).
        discount_price: { type: Number, default: null },

        stock: { type: Number, default: 0 },

        selected_options: [selectedOptionSchema],
    },
    { _id: true }
);

/* ------------------ Compatible Cars ------------------ */
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

/* ------------------ Shipping Dimensions ------------------ */
const dimensionsSchema = new Schema(
    {
        length: { type: Number, default: null, min: 0 }, // cm
        width: { type: Number, default: null, min: 0 },  // cm
        height: { type: Number, default: null, min: 0 }, // cm
    },
    { _id: false }
);

/* ------------------ Main Product Schema ------------------ */
const productSchema = new Schema(
    {
        vendor_id: {
            type: Schema.Types.ObjectId,
            ref: "Seller",
            required: [true, 'Please select a vendor for this product.'],
            index: true,
        },

        category_id: {
            type: Schema.Types.ObjectId,
            ref: "Category",
            required: [true, 'Please select a category for this product.'],
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

        // The master-catalog entry this product was created from. Purely an
        // analytics link: entry data is copied in once, at creation, and nothing
        // downstream reads through it. Null for legacy products and for products
        // an admin has unlinked. Never shown to the vendor.
        catalog_entry_id: {
            type: Schema.Types.ObjectId,
            ref: "CatalogEntry",
            default: null,
            index: true,
        },

        // Localized content — at least one full language set is required (enforced below)
        title_en: { type: String, trim: true },
        title_ar: { type: String, trim: true },

        subtitle_en: { type: String, trim: true },
        subtitle_ar: { type: String, trim: true },

        description_en: { type: String },
        description_ar: { type: String },

        // Identifiers
        sku: { type: String, required: [true, 'SKU is required'], trim: true },
        part_number: { type: String, trim: true },
        gtin: { type: String, trim: true },
        // Original / OEM / Aftermarket (services/shared/partType). Required by every form
        // and bulk upload; null only on products saved before it existed.
        part_type: { type: String, enum: [...require('../services/shared/partType').PART_TYPES, null], default: null, index: true },

        // Slugs — at least one language set required (enforced below)
        slug_en: { type: String, trim: true, sparse: true, unique: true },
        slug_ar: { type: String, trim: true, sparse: true, unique: true },

        // Pricing — the seller enters `price` plus an optional discount expressed
        // as a type (fixed amount / percentage) and a value.
        price: { type: Number, required: [true, 'Price is required'] },
        discount_type: { type: String, enum: [...DISCOUNT_TYPES, null], default: null },
        discount_value: { type: Number, default: null, min: 0 },

        // DERIVED from price + discount_type + discount_value by the pre-validate
        // hook below. Kept on the document because every read path (storefront,
        // cart, orders, shipping, bundles, aggregations) resolves the effective
        // price through `discount_price ?? price`. Never write it directly.
        discount_price: { type: Number, default: null },

        status: { type: String, enum: ['draft', 'pending', 'published'], default: 'draft' },
        // What the admin corrected while the product waited for approval ('category',
        // 'fitment', …: services/productReviewService.js FIXES). Told to the vendor when it
        // is published, then cleared.
        review_fixes: { type: [String], default: undefined },

        // The admin looked at this product on the "unlinked products" worklist and decided
        // it does not belong in the catalog. Set once; the product stays exactly as it is
        // for the vendor and simply stops being offered for linking.
        catalog_dismissed_at: { type: Date, default: null },

        // The admin looked at this product's catalog link on "links to review" and kept it.
        // The link is not questioned again until its entry is edited after this.
        catalog_link_checked_at: { type: Date, default: null },

        // The fitment check's findings the admin dismissed (services/fitmentCheckService.js):
        // `signature` is what was found then, so a new disagreement — the title or the
        // fitment edited since — shows again.
        fitment_check_dismissed: {
            type: new Schema({ at: Date, signature: String }, { _id: false }),
            default: undefined,
        },

        // "The pictures are fine" on the image check (services/imageCheckService.js): held
        // against the pictures' signature, so a picture changed since shows again.
        image_check_dismissed: {
            type: new Schema({ at: Date, signature: String, by: String }, { _id: false }),
            default: undefined,
        },

        // True once a product is admin-approved (published). Resetting to draft does not clear this.
        // Vendors must re-submit for review if they edit a published product.
        is_published: { type: Boolean, default: false },

        // Is this product active (visible on marketplace)? False when vendor is suspended via admin override.
        // When vendor is suspended due to expired subscription, this can be set to false.
        is_active: { type: Boolean, default: true },

        // Tracks when product was hidden due to subscription expiry/cancellation.
        // Used to determine re-review requirements on restoration.
        subscription_hidden_at: { type: Date, default: null },

        // Set to true when vendor edits a product after it was restored from subscription expiry.
        // Triggers re-review workflow (status → 'pending') even if it was previously approved.
        modified_after_subscription_restore: { type: Boolean, default: false },

        // Compatibility — is_universal OR compatible_cars must be set (enforced below)
        is_universal: { type: Boolean, default: false },

        // Flag to include product in the "Car Trunk" page — the things every car should
        // carry (jack, warning triangle, first-aid kit, jump leads, ...).
        for_trunk: { type: Boolean, default: false },

        // The marine audience hubs the product shows in — the ten keys of
        // services/shared/audiences.js; anything else is dropped on save.
        target_audiences: {
            type: [{ type: String, trim: true }],
            index: true,
            set: (v) => require('../services/shared/audiences').cleanAudiences(v),
        },

        sold_count: { type: Number, default: 0 },
        rating: { type: Number, default: 0 },
        reviews_count: { type: Number, default: 0 },

        stock_management: { type: Boolean, default: true },
        stock_status: { type: String, enum: ['instock', 'outofstock', 'onbackorder'], default: 'instock' },
        quantity: { type: Number, default: null },

        images: [imageSchema],

        compatible_cars: [compatibleCarSchema],

        variation_types: [variationTypeSchema],

        variants: [variantSchema],

        // ---- Shipping attributes (vendor-set; never rates/rules) ----
        weight: { type: Number, default: null, min: 0 }, // kg; null = not entered
        dimensions: { type: dimensionsSchema, default: undefined },
        shipping_class_id: { type: Schema.Types.ObjectId, ref: "ShippingClass", default: null, index: true },

        created_at: { type: Date, default: Date.now },
    },
    {
        timestamps: false,
    }
);

/**
 * Recompute `discount_price` on a product document and on each of its variants
 * from the stored discount_type / discount_value, and report the first problem.
 * @returns {string|null} validation message, or null when the pricing is sound.
 */
function applyDerivedPricing(doc) {
    const productError = validateDiscount(doc.price, doc.discount_type ?? null, doc.discount_value);
    doc.discount_price = productError
        ? null
        : computeDiscountPrice(doc.price, doc.discount_type ?? null, doc.discount_value);
    if (!doc.discount_type) doc.discount_value = null;

    for (const variant of (doc.variants || [])) {
        const effectivePrice = variant.price != null ? variant.price : doc.price;
        const variantError = validateDiscount(effectivePrice, variant.discount_type ?? null, variant.discount_value);
        variant.discount_price = variantError
            ? null
            : computeDiscountPrice(effectivePrice, variant.discount_type ?? null, variant.discount_value);
        if (!variant.discount_type) variant.discount_value = null;
        if (variantError && !productError) return variantError;
    }

    return productError;
}

/* ------------------ Validation Middleware ------------------ */
productSchema.pre('validate', function (next) {
    /* Rule 0: derive discount_price from the discount type/value pair.
       Services normalize before they write, but this hook is the backstop that
       guarantees no document — seeded, scripted or saved directly — can ever
       hold a discount_price that disagrees with its discount_type/value. */
    const priceError = applyDerivedPricing(this);
    if (priceError) this.invalidate('discount_value', priceError);

    if (this.status === 'published') {
        const hasEnglishSet =
            !!(this.title_en?.trim() &&
                this.subtitle_en?.trim() &&
                this.description_en?.trim() &&
                this.slug_en?.trim());

        const hasArabicSet =
            !!(this.title_ar?.trim() &&
                this.subtitle_ar?.trim() &&
                this.description_ar?.trim() &&
                this.slug_ar?.trim());

        if (!hasEnglishSet && !hasArabicSet) {
            this.invalidate(
                'title_en',
                'A published product must have title, subtitle, description, and slug all completed in at least one language (English or Arabic).'
            );
        }
    }

    // Rule 2: Must be universal OR have specific compatible cars
    if (!this.is_universal && (!this.compatible_cars || this.compatible_cars.length === 0)) {
        this.invalidate(
            'compatible_cars',
            'A product must be universally compatible or have at least one compatible car entry.'
        );
    }

    // Always call next — invalidate() will cause save() to fail with a ValidationError
    if (typeof next === 'function') next();
});

/* ------------------ Indexing ------------------ */
productSchema.index({
    title_en: "text",
    title_ar: "text",
    subtitle_en: "text",
    subtitle_ar: "text",
    description_en: "text",
    description_ar: "text"
});
productSchema.index({ vendor_id: 1, category_id: 1 });
// The public listing's default query — {status, [vendor_id/category_id $in]} sorted
// newest-first — had no index to sort by, so every "newest" page forced Mongo to
// collect every matching product and sort it in memory. These cover that sort for
// the plain listing and the store page, and the other two sort options the UI offers.
productSchema.index({ status: 1, created_at: -1 });
productSchema.index({ vendor_id: 1, status: 1, created_at: -1 });
productSchema.index({ status: 1, price: 1 });
productSchema.index({ status: 1, sold_count: -1, created_at: -1 });

require("../services/shared/brandRef").attachBrandSourceHooks(productSchema);

const Product = mongoose.model("Product", productSchema);

module.exports = { Product };
