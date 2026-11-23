const path = require('path');
const fs = require('fs');
const multer = require('multer');
const reviewService = require('./review.service');
const { MAX_REVIEW_IMAGES } = require('../../models/reviews');

const reviewUploadDir = path.join(__dirname, '../../public/uploads/reviews');
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
 * GET /api/reviews/product/:productId
 */
const getProductReviews = async (req, res) => {
    try {
        res.json(await reviewService.getProductReviews(req.params.productId, {
            page: req.query.page,
            limit: req.query.limit,
        }));
    } catch (error) {
        fail(res, error);
    }
};

/**
 * GET /api/reviews/vendor/:vendorId
 */
const getVendorReviews = async (req, res) => {
    try {
        res.json(await reviewService.getVendorReviews(req.params.vendorId, {
            page: req.query.page,
            limit: req.query.limit,
        }));
    } catch (error) {
        fail(res, error);
    }
};

/**
 * Check token middleware before upload
 */
const checkInviteToken = async (req, res, next) => {
    try {
        await reviewService.assertInviteIsLive(req.params.token, req.user, req.userRole);
        next();
    } catch (error) {
        fail(res, error);
    }
};

/**
 * POST /api/reviews/invite/:token/images
 */
const uploadImages = (req, res) => {
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
};

/**
 * GET /api/reviews/invite/:token
 */
const getInviteContext = async (req, res) => {
    try {
        res.json(await reviewService.getInviteContext(req.params.token, req.user, req.userRole));
    } catch (error) {
        fail(res, error);
    }
};

/**
 * POST /api/reviews/invite/:token
 */
const submitReview = async (req, res) => {
    try {
        const result = await reviewService.submitReviews(req.params.token, req.body?.reviews, req.user, req.userRole);
        res.json({
            message: 'Thank you! Your review will appear once it has been checked.',
            ...result,
        });
    } catch (error) {
        fail(res, error);
    }
};

/**
 * Admin: GET /api/admin/reviews
 */
const listAdminReviews = async (req, res) => {
    try {
        res.json(await reviewService.listReviewsForAdmin({
            status: req.query.status || 'pending',
            target: req.query.target || 'all',
            page: req.query.page,
            limit: req.query.limit,
        }));
    } catch (error) {
        fail(res, error);
    }
};

/**
 * Admin: PUT /api/admin/reviews/:id
 */
const moderateReview = async (req, res) => {
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
};

module.exports = {
    getProductReviews,
    getVendorReviews,
    checkInviteToken,
    uploadImages,
    getInviteContext,
    submitReview,
    listAdminReviews,
    moderateReview,
};
