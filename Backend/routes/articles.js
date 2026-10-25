const express = require('express');
const router = express.Router();
const { getAllArticles, getArticleBySlug } = require('../services/articleService');

/**
 * @desc    Get all published articles (public, paginated)
 * @route   GET /api/articles
 * @access  Public
 */
router.get('/', async (req, res) => {
    try {
        const { page, limit, search, tag, category } = req.query;
        const result = await getAllArticles({ page, limit, search, tag, category });
        res.json(result);
    } catch (err) {
        console.error('Error fetching articles:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * @desc    Get a single published article by slug
 * @route   GET /api/articles/slug/:slug
 * @access  Public
 */
router.get('/slug/:slug', async (req, res) => {
    try {
        const article = await getArticleBySlug(req.params.slug);
        if (!article) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }
        res.json({ success: true, article });
    } catch (err) {
        console.error('Error fetching article:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
