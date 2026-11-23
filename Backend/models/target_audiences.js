const mongoose = require('mongoose');
const { Schema } = mongoose;

const targetAudienceSchema = new Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        name_ar: {
            type: String,
            required: true,
            trim: true,
        },
        name_en: {
            type: String,
            required: true,
            trim: true,
        },
        description_ar: {
            type: String,
            trim: true,
            default: '',
        },
        description_en: {
            type: String,
            trim: true,
            default: '',
        },
        badge_ar: {
            type: String,
            trim: true,
            default: '',
        },
        badge_en: {
            type: String,
            trim: true,
            default: '',
        },
        image: {
            type: String,
            default: '',
        },
        card_position: {
            type: String,
            enum: ['large', 'small_top', 'small_bottom', 'hidden'],
            default: 'large',
        },
        sort_order: {
            type: Number,
            default: 0,
        },
        is_active: {
            type: Boolean,
            default: true,
        },
        slider_active: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

targetAudienceSchema.index({ is_active: 1, card_position: 1, sort_order: 1 });

const TargetAudience = mongoose.models.TargetAudience || mongoose.model('TargetAudience', targetAudienceSchema);

module.exports = {
    TargetAudience,
};
