const mongoose = require('mongoose');
const { Schema } = mongoose;

const carEmailCampaignSchema = new Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        subject: {
            type: String,
            required: true,
            trim: true,
        },
        target_filter: {
            brand_id: { type: Schema.Types.ObjectId, ref: 'CarBrand', default: null },
            brand_name: { type: String, default: '' },
            model_id: { type: Schema.Types.ObjectId, default: null },
            model_name: { type: String, default: '' },
            year: { type: Number, default: null },
        },
        message_body: {
            type: String,
            default: '',
        },
        category_tags: [
            {
                label: { type: String, required: true },
                label_en: { type: String, default: '' },
                // A tag picked from the site's categories opens that category's page.
                category_id: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
                link: { type: String, default: '' },
            },
        ],
        product_ids: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Product',
            },
        ],
        custom_cta_text: {
            type: String,
            default: '',
        },
        custom_cta_link: {
            type: String,
            default: '',
        },
        status: {
            type: String,
            enum: ['draft', 'sending', 'sent', 'failed'],
            default: 'draft',
            index: true,
        },
        stats: {
            targeted_count: { type: Number, default: 0 },
            sent_count: { type: Number, default: 0 },
            failed_count: { type: Number, default: 0 },
            skipped_count: { type: Number, default: 0 },
        },
        created_by: {
            type: String,
            default: 'admin',
        },
        sent_at: {
            type: Date,
            default: null,
        },
        error_log: [
            {
                email: String,
                error: String,
                timestamp: { type: Date, default: Date.now },
            },
        ],
    },
    {
        timestamps: true,
    }
);

carEmailCampaignSchema.index({ createdAt: -1 });

const CarEmailCampaign = mongoose.model('CarEmailCampaign', carEmailCampaignSchema);

module.exports = { CarEmailCampaign };
