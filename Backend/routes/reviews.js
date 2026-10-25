/**
 * Reviews Router — the customer-facing side. Mounted at /api/reviews.
 *
 * The invite endpoints are intentionally PUBLIC: the WhatsApp link has to open
 * straight into the form, and requiring a login collapses response rates. The
 * single-use token is the credential, so these routes expose only what the form
 * needs — never the order's address, totals, or payment.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const { rateLimit } = require('../middleware/rateLimit');
const reviewService = require('../services/reviewService');
const { MAX_REVIEW_IMAGES } = require('../models/reviews');

/* ------------------------------------------------------------------ */
/* Review photo uploads                                                */
/* ------------------------------------------------------------------ */

// Review photos live in their own directory, which is what lets `sanitizeReviewImages`
// accept a url by its path alone: nothing but this endpoint can put a file there.
const reviewUploadDir = path.join(__dirname, '../public/uploads/reviews');
if (!fs.existsSync(reviewUploadDir)) fs.mkdirSync(reviewUploadDir, { recursive: true });

const ALLOWED_IMAGE_TYPES = /^(jpeg|jpg|png|webp)$/;

const reviewUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, reviewUploadDir),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
            cb(null, `review-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: MAX_REVIEW_IMAGES },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().slice(1);
        const okExt = ALLOWED_IMAGE_TYPES.test(ext);
        const okMime = ALLOWED_IMAGE_TYPES.test(String(file.mimetype).split('/')[1] || '');
        if (okExt && okMime) return cb(null, true);
        cb(new Error('Images only (jpeg, jpg, png, webp)'));
    },
});

const fail = (res, error) => res.status(error.status || 400).json({
    code: error.code || 'REVIEW_ERROR',
    message: error.message,
});

/**
 * @desc    Approved reviews + rating summary for a product page
 * @route   GET /api/reviews/product/:productId
 */
router.get('/product/:productId', async (req, res) => {
    try {
        res.json(await reviewService.getProductReviews(req.params.productId, {
            page: req.query.page,
            limit: req.query.limit,
        }));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Approved reviews + rating summary for a store page
 * @route   GET /api/reviews/vendor/:vendorId
 */
router.get('/vendor/:vendorId', async (req, res) => {
    try {
        res.json(await reviewService.getVendorReviews(req.params.vendorId, {
            page: req.query.page,
            limit: req.query.limit,
        }));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Attach a photo to a review being written.
 *
 * Gated on the same single-use token as the form, so this is not an open upload endpoint:
 * a file can only be stored by someone holding a live review link. The returned url is
 * what the submit call may reference — `sanitizeReviewImages` rejects anything else.
 *
 * @route   POST /api/reviews/invite/:token/images
 */
router.post(
    '/invite/:token/images',
    rateLimit({ name: 'review_image_upload', windowMs: 60 * 60 * 1000, max: 30 }),
    async (req, res, next) => {
        // Validate the token BEFORE multer writes anything to disk, so a bad link cannot
        // leave files behind.
        try {
            await reviewService.assertInviteIsLive(req.params.token);
            next();
        } catch (error) {
            fail(res, error);
        }
    },
    (req, res) => {
        reviewUpload.array('images', MAX_REVIEW_IMAGES)(req, res, (err) => {
            if (err) {
                return res.status(400).json({
                    code: 'UPLOAD_FAILED',
                    message: err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5MB or smaller' : err.message,
                });
            }
            const files = req.files || [];
            if (files.length === 0) {
                return res.status(400).json({ code: 'NO_FILE', message: 'No image uploaded' });
            }
            const baseUrl = process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
            res.json({ images: files.map((f) => ({ url: `${baseUrl}/uploads/reviews/${f.filename}` })) });
        });
    }
);

/**
 * @desc    Open a review link — returns the items to rate
 * @route   GET /api/reviews/invite/:token
 */
router.get(
    '/invite/:token',
    rateLimit({ name: 'review_invite_open', windowMs: 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            res.json(await reviewService.getInviteContext(req.params.token));
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Submit ratings. Everything lands as `pending` for admin moderation.
 * @route   POST /api/reviews/invite/:token
 */
router.post(
    '/invite/:token',
    rateLimit({ name: 'review_invite_submit', windowMs: 60 * 60 * 1000, max: 20 }),
    async (req, res) => {
        try {
            const result = await reviewService.submitReviews(req.params.token, req.body?.reviews);
            res.json({
                message: 'Thank you! Your review will appear once it has been checked.',
                ...result,
            });
        } catch (error) {
            fail(res, error);
        }
    }
);

module.exports = router;
