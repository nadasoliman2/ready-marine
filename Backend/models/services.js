const mongoose = require('mongoose');
const { Schema } = mongoose;

const imageSchema = new Schema(
    {
        url: { type: String, required: true },
        is_primary: { type: Boolean, default: false },
    },
    { _id: true }
);

const socialLinkSchema = new Schema(
    {
        platform: {
            type: String,
            enum: ['facebook', 'instagram', 'tiktok', 'x', 'youtube', 'linkedin', 'website', 'other'],
            default: 'other',
        },
        url: { type: String, required: true, trim: true },
    },
    { _id: true }
);

const locationSchema = new Schema(
    {
        name_en: { type: String, trim: true },
        name_ar: { type: String, trim: true },
        link: { type: String, trim: true },
    },
    { _id: true }
);

const serviceSchema = new Schema(
    {
        title_en: { type: String, trim: true },
        title_ar: { type: String, trim: true },

        description_en: { type: String, trim: true },
        description_ar: { type: String, trim: true },

        vendor_name_en: { type: String, trim: true },
        vendor_name_ar: { type: String, trim: true },

        vendor_location_en: { type: String, trim: true },
        vendor_location_ar: { type: String, trim: true },
        locations: [locationSchema],

        phones: [{ type: String, trim: true }],
        whatsapp_numbers: [{ type: String, trim: true }],
        social_links: [socialLinkSchema],

        images: [imageSchema],

        slug_en: { type: String, trim: true, sparse: true, unique: true },
        slug_ar: { type: String, trim: true, sparse: true, unique: true },

        status: { type: String, enum: ['active', 'inactive'], default: 'active' },
        featured: { type: Boolean, default: false },
        show_in_banner_ad_slider: { type: Boolean, default: false },
        price: { type: Number, default: null, min: 0 },

        created_at: { type: Date, default: Date.now },
    },
    {
        timestamps: false,
    }
);

serviceSchema.pre('validate', function (next) {
    const hasTitle = !!(this.title_en?.trim() || this.title_ar?.trim());
    const hasDescription = !!(this.description_en?.trim() || this.description_ar?.trim());
    const hasVendorName = !!(this.vendor_name_en?.trim() || this.vendor_name_ar?.trim());
    const hasVendorLocation = !!(
        this.vendor_location_en?.trim()
        || this.vendor_location_ar?.trim()
        || (this.locations || []).some(location => location?.name_en?.trim() || location?.name_ar?.trim())
    );

    if (!hasTitle) {
        this.invalidate('title_en', 'Service title is required in at least one language (English or Arabic).');
    }

    if (!hasDescription) {
        this.invalidate('description_en', 'Service description is required in at least one language (English or Arabic).');
    }

    if (!hasVendorName) {
        this.invalidate('vendor_name_en', 'Vendor name is required in at least one language (English or Arabic).');
    }

    if (!hasVendorLocation) {
        this.invalidate('vendor_location_en', 'Vendor location is required in at least one language (English or Arabic).');
    }

    (this.locations || []).forEach((location, index) => {
        if (!location?.name_en?.trim() && !location?.name_ar?.trim()) {
            this.invalidate(`locations.${index}.name_en`, 'Each location requires English or Arabic text.');
        }
    });

    if ((!this.phones || this.phones.length === 0) && (!this.whatsapp_numbers || this.whatsapp_numbers.length === 0)) {
        this.invalidate('phones', 'At least one phone number or WhatsApp number is required.');
    }

    if (this.images && this.images.length > 0) {
        const primaryCount = this.images.filter(img => img?.is_primary).length;
        if (primaryCount === 0) {
            this.images[0].is_primary = true;
        } else if (primaryCount > 1) {
            this.invalidate('images', 'Only one image can be primary.');
        }
    }

    if (typeof next === 'function') next();
});

serviceSchema.index({
    title_en: 'text',
    title_ar: 'text',
    description_en: 'text',
    description_ar: 'text',
    vendor_name_en: 'text',
    vendor_name_ar: 'text',
    vendor_location_en: 'text',
    vendor_location_ar: 'text',
});

serviceSchema.index({ status: 1, featured: 1, created_at: -1 });
serviceSchema.index({ status: 1, show_in_banner_ad_slider: 1, created_at: -1 });

const Service = mongoose.model('Service', serviceSchema);

module.exports = { Service };
