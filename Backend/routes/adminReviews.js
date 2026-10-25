/**
 * Admin Reviews Router — the moderation queue. Mounted at /api/admin/reviews.
 *
 * No customer review reaches a product page without passing through here: every
 * submission is created `pending`, and only an explicit approval publishes it.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const reviewService = require('../services/reviewService');

const fail = (res, error) => res.status(error.status || 400).json({
    code: error.code || 'REVIEW_ERROR',
    message: error.message,
});

/**
 * @desc    Moderation queue (defaults to pending) + the pending badge count
 * @route   GET /api/admin/reviews
 */
router.get('/', protect('admin'), async (req, res) => {
    try {
        res.json(await reviewService.listReviewsForAdmin({
            status: req.query.status || 'pending',
            // 'product' | 'vendor' | 'all' — product reviews and store reviews are
            // moderated with different questions in mind, so the queue can be split.
            target: req.query.target || 'all',
            page: req.query.page,
            limit: req.query.limit,
        }));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Approve or reject a review; the product's rating is recomputed
 *          from approved reviews either way.
 * @route   PUT /api/admin/reviews/:id
 */
router.put('/:id', protect('admin'), async (req, res) => {
    try {
        const result = await reviewService.moderateReview(req.params.id, {
            status: req.body?.status,
            reason: req.body?.reason,
            actor: req.user?.username || 'Admin',
        });
        res.json({
            message: result.status === 'approved' ? 'Review published.' : 'Review rejected.',
            ...result,
        });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
