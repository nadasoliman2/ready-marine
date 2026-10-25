const { Article } = require('../models/articles');

/**
 * Generate a unique slug for an article
 */
const generateArticleSlug = async (title, lang = 'en', articleId = null) => {
    if (!title) return '';
    let slug = title.toLowerCase();
    if (lang === 'en') {
        slug = slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    } else {
        slug = slug.replace(/[^ء-ي0-9a-z]+/g, '-').replace(/^-+|-+$/g, '');
    }

    let isUnique = false;
    let uniqueSlug = slug;
    let counter = 1;

    while (!isUnique) {
        const query = lang === 'en' ? { slug_en: uniqueSlug } : { slug_ar: uniqueSlug };
        if (articleId) {
            query._id = { $ne: articleId };
        }
        const existing = await Article.findOne(query);
        if (!existing) {
            isUnique = true;
        } else {
            uniqueSlug = `${slug}-${counter}`;
            counter++;
        }
    }

    return uniqueSlug;
};

/**
 * Get all published articles with pagination and filters (public)
 */
const getAllArticles = async (filters = {}) => {
    const {
        page = 1,
        limit = 12,
        search,
        tag,
        category,
        status,
    } = filters;

    const query = {};

    // Public-only: default to published
    if (status) {
        query.status = status;
    } else {
        query.status = 'published';
    }

    if (search) {
        query.$or = [
            { title_en: { $regex: search, $options: 'i' } },
            { title_ar: { $regex: search, $options: 'i' } },
            { excerpt_en: { $regex: search, $options: 'i' } },
            { excerpt_ar: { $regex: search, $options: 'i' } },
        ];
    }

    if (tag) {
        query.tags = tag;
    }

    if (category) {
        query.category = category;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Article.countDocuments(query);
    const articles = await Article.find(query)
        .sort({ published_at: -1, created_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean();

    return {
        articles,
        pagination: {
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit)),
            limit: Number(limit),
        },
    };
};

/**
 * Get a single article by slug (public) — increments view_count
 */
const getArticleBySlug = async (slug) => {
    const article = await Article.findOneAndUpdate(
        {
            $or: [{ slug_en: slug }, { slug_ar: slug }],
            status: 'published',
        },
        { $inc: { view_count: 1 } },
        { new: true }
    ).lean();

    return article;
};

/**
 * Get a single article by ID (admin — any status)
 */
const getArticleById = async (id) => {
    return Article.findById(id).lean();
};

/**
 * Create a new article
 */
const createArticle = async (data) => {
    if (data.title_en) {
        data.slug_en = await generateArticleSlug(data.title_en, 'en');
    }
    if (data.title_ar) {
        data.slug_ar = await generateArticleSlug(data.title_ar, 'ar');
    }

    if (data.status === 'published' && !data.published_at) {
        data.published_at = new Date();
    }

    const article = new Article(data);
    await article.save();
    return article;
};

/**
 * Update an existing article
 */
const updateArticle = async (id, data) => {
    const existing = await Article.findById(id);
    if (!existing) return null;

    // Regenerate slugs if titles changed
    if (data.title_en && data.title_en !== existing.title_en) {
        data.slug_en = await generateArticleSlug(data.title_en, 'en', id);
    }
    if (data.title_ar && data.title_ar !== existing.title_ar) {
        data.slug_ar = await generateArticleSlug(data.title_ar, 'ar', id);
    }

    // Set published_at when transitioning to published
    if (data.status === 'published' && existing.status !== 'published') {
        data.published_at = new Date();
    }

    Object.assign(existing, data);
    await existing.save();
    return existing;
};

/**
 * Delete an article
 */
const deleteArticle = async (id) => {
    return Article.findByIdAndDelete(id);
};

module.exports = {
    getAllArticles,
    getArticleBySlug,
    getArticleById,
    createArticle,
    updateArticle,
    deleteArticle,
};
