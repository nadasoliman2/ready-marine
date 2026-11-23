const express = require('express');
const router = express.Router();
const adminRouter = express.Router();
const { rateLimit } = require('../../middleware/rateLimit');
const { protect } = require('../../middleware/authMiddleware');
const reviewController = require('./review.controller');
const reviewService = require('./review.service');
const { Review, ReviewInvite } = require('../../models/reviews');

// Public product/vendor reviews
router.get('/product/:productId', reviewController.getProductReviews);
router.get('/vendor/:vendorId', reviewController.getVendorReviews);

// Customer review submission (requires active user login or admin, and validates order ownership)
router.get(
    '/invite/:token',
    rateLimit({ name: 'review_invite_open', windowMs: 60 * 1000, max: 30 }),
    protect('user', 'admin'),
    reviewController.getInviteContext
);
router.post(
    '/invite/:token',
    rateLimit({ name: 'review_invite_submit', windowMs: 60 * 60 * 1000, max: 20 }),
    protect('user', 'admin'),
    reviewController.submitReview
);
router.post(
    '/invite/:token/images',
    rateLimit({ name: 'review_image_upload', windowMs: 60 * 60 * 1000, max: 30 }),
    protect('user', 'admin'),
    reviewController.checkInviteToken,
    reviewController.uploadImages
);

// Admin moderation
adminRouter.get('/', protect('admin'), reviewController.listAdminReviews);
adminRouter.put('/:id', protect('admin'), reviewController.moderateReview);

module.exports = {
    router,
    adminRouter,
    Review,
    ReviewInvite,
    reviewService,
    reviewController,
};
