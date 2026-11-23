const articleService = require('./article.service');

/**
 * @desc    Get all published articles (public, paginated)
 * @route   GET /api/articles
 * @access  Public
 */
const getAllArticles = async (req, res) => {
    try {
        const { page, limit, search, tag, category } = req.query;
        const result = await articleService.getAllArticles({ page, limit, search, tag, category });
        res.json(result);
    } catch (err) {
        console.error('Error fetching articles:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * @desc    Get a single published article by slug
 * @route   GET /api/articles/slug/:slug
 * @access  Public
 */
const getArticleBySlug = async (req, res) => {
    try {
        const article = await articleService.getArticleBySlug(req.params.slug);
        if (!article) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }
        res.json({ success: true, article });
    } catch (err) {
        console.error('Error fetching article:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * @desc    Get article by id (Admin)
 */
const getArticleById = async (req, res) => {
    try {
        const article = await articleService.getArticleById(req.params.id);
        if (!article) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }
        res.json({ success: true, article });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @desc    Create article (Admin)
 */
const createArticle = async (req, res) => {
    try {
        const article = await articleService.createArticle(req.body);
        res.status(201).json({ success: true, article });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

/**
 * @desc    Update article (Admin)
 */
const updateArticle = async (req, res) => {
    try {
        const article = await articleService.updateArticle(req.params.id, req.body);
        if (!article) return res.status(404).json({ success: false, message: 'Article not found' });
        res.json({ success: true, article });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

/**
 * @desc    Delete article (Admin)
 */
const deleteArticle = async (req, res) => {
    try {
        await articleService.deleteArticle(req.params.id);
        res.json({ success: true, message: 'تم حذف المقال بنجاح' });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

module.exports = {
    getAllArticles,
    getArticleBySlug,
    getArticleById,
    createArticle,
    updateArticle,
    deleteArticle,
};
