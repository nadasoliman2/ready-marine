const mongoose = require('mongoose');
const { Schema } = mongoose;

const emailCampaignSchema = new Schema(
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
            brand_id: { type: Schema.Types.ObjectId, ref: 'Brand', default: null },
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
        },
        total_targeted: {
            type: Number,
            default: 0,
        },
        total_sent: {
            type: Number,
            default: 0,
        },
        total_failed: {
            type: Number,
            default: 0,
        },
        logs: [
            {
                email: String,
                status: String,
                error: String,
                sent_at: Date,
            },
        ],
        sent_by: {
            type: Schema.Types.ObjectId,
            ref: 'AdminUser',
            default: null,
        },
        sent_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

emailCampaignSchema.index({ createdAt: -1 });

const EmailCampaign = mongoose.models.EmailCampaign || mongoose.models.CarEmailCampaign || mongoose.model('EmailCampaign', emailCampaignSchema);

// Register alias so any legacy query for CarEmailCampaign resolves to EmailCampaign
if (!mongoose.models.CarEmailCampaign) mongoose.models.CarEmailCampaign = EmailCampaign;

module.exports = {
    EmailCampaign,
    CarEmailCampaign: EmailCampaign,
};
