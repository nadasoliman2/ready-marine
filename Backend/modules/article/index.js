const express = require('express');
const router = express.Router();
const articleController = require('./article.controller');
const articleService = require('./article.service');
const { Article } = require('../../models/articles');
const { protect } = require('../../middleware/authMiddleware');

// Public routes
router.get('/', articleController.getAllArticles);
router.get('/slug/:slug', articleController.getArticleBySlug);
router.get('/:id', articleController.getArticleById);

// Admin routes
router.post('/', protect('admin'), articleController.createArticle);
router.put('/:id', protect('admin'), articleController.updateArticle);
router.delete('/:id', protect('admin'), articleController.deleteArticle);

module.exports = {
    router,
    Article,
    articleService,
    articleController,
};
