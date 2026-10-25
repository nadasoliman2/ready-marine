const mongoose = require('mongoose');

const { Schema } = mongoose;

const couponSchema = new Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
            default: '',
        },
        discount_type: {
            type: String,
            enum: ['percent', 'fixed'],
            required: true,
        },
        discount_value: {
            type: Number,
            required: true,
            min: 0,
        },
        scope_type: {
            type: String,
            enum: ['all_products', 'category_tree', 'product_list', 'vendor_list'],
            required: true,
        },
        category_ids: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
        product_ids: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
        vendor_ids: [{ type: Schema.Types.ObjectId, ref: 'Seller' }],
        // Who pays for the discount. The percentage OF THE DISCOUNT (not of the order) that
        // the vendor absorbs; the platform absorbs the rest. 0 means the platform funds the
        // whole coupon — which is what every coupon did before this field existed, so old
        // coupons keep their economics. Frozen onto each order at placement.
        vendor_share_percent: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        min_order_amount: {
            type: Number,
            min: 0,
            default: 0,
        },
        usage_limit_total: {
            type: Number,
            min: 0,
            default: null,
        },
        usage_limit_per_user: {
            type: Number,
            min: 0,
            default: null,
        },
        used_count: {
            type: Number,
            default: 0,
            min: 0,
        },
        usage_by_user: [
            {
                user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
                count: { type: Number, default: 0, min: 0 },
                _id: false,
            },
        ],
        is_active: {
            type: Boolean,
            default: true,
            index: true,
        },
        starts_at: {
            type: Date,
            default: null,
        },
        expires_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

couponSchema.pre('validate', function(next) {
    if (this.code) {
        this.code = this.code.trim().toUpperCase();
    }

    if (this.discount_type === 'percent' && this.discount_value > 100) {
        this.invalidate('discount_value', 'Percent discount cannot exceed 100.');
    }

    const share = Number(this.vendor_share_percent);
    if (!Number.isFinite(share) || share < 0 || share > 100) {
        this.invalidate('vendor_share_percent', 'The vendor share of the discount must be between 0 and 100.');
    }

    if (this.scope_type === 'category_tree' && (!this.category_ids || this.category_ids.length === 0)) {
        this.invalidate('category_ids', 'At least one category is required for category_tree scope.');
    }

    if (this.scope_type === 'product_list' && (!this.product_ids || this.product_ids.length === 0)) {
        this.invalidate('product_ids', 'At least one product is required for product_list scope.');
    }

    if (this.scope_type === 'vendor_list' && (!this.vendor_ids || this.vendor_ids.length === 0)) {
        this.invalidate('vendor_ids', 'At least one vendor is required for vendor_list scope.');
    }

    if (this.starts_at && this.expires_at && this.starts_at > this.expires_at) {
        this.invalidate('expires_at', 'Expiry date must be after start date.');
    }

    if (typeof next === 'function') next();
});

couponSchema.index({ code: 1, is_active: 1 });
couponSchema.index({ starts_at: 1, expires_at: 1 });

const Coupon = mongoose.model('Coupon', couponSchema);

module.exports = { Coupon };
