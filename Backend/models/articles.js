const mongoose = require('mongoose');
const { Schema } = mongoose;

const articleSchema = new Schema({
    // Bilingual content
    title_en: { type: String, trim: true },
    title_ar: { type: String, trim: true },
    content_en: { type: String },
    content_ar: { type: String },
    excerpt_en: { type: String, trim: true },
    excerpt_ar: { type: String, trim: true },

    // URL slugs (unique, sparse — same pattern as products)
    slug_en: { type: String, trim: true, sparse: true, unique: true },
    slug_ar: { type: String, trim: true, sparse: true, unique: true },

    // Featured image (URL from upload system)
    featured_image: { type: String, default: null },

    // Author
    author_name: { type: String, trim: true },

    // Status
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },

    // Tags and category
    tags: [{ type: String, trim: true }],
    category: { type: String, trim: true, default: '' },

    // SEO fields
    meta_title_en: { type: String, trim: true },
    meta_title_ar: { type: String, trim: true },
    meta_description_en: { type: String, trim: true },
    meta_description_ar: { type: String, trim: true },
    keywords: [{ type: String, trim: true }],
    canonical_url: { type: String, trim: true },

    // Publication & tracking
    published_at: { type: Date, default: null },
    view_count: { type: Number, default: 0 },

    created_at: { type: Date, default: Date.now },
}, {
    timestamps: false,
});

// Text index for search
articleSchema.index({
    title_en: 'text',
    title_ar: 'text',
    content_en: 'text',
    content_ar: 'text',
    excerpt_en: 'text',
    excerpt_ar: 'text',
});

articleSchema.index({ status: 1, published_at: -1 });
// No index() call for slug_en / slug_ar: the field definitions above already declare them
// `unique, sparse`, and repeating them here as plain indexes only made Mongoose warn about
// a duplicate on every boot. The unique+sparse version is the one that exists in the
// database, and it serves lookups by slug just as well.

const Article = mongoose.model('Article', articleSchema);
module.exports = { Article };
