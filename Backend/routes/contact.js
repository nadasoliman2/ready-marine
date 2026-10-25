const express = require('express');
const { body, validationResult } = require('express-validator');
const { ContactInquiry } = require('../models/contact_inquiries');

const router = express.Router();

const validateContactInquiry = [
    body('name').trim().notEmpty().withMessage('Your name is required'),
    body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('subject').trim().notEmpty().withMessage('Subject is required'),
    body('message').optional({ values: 'falsy' }).trim(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const message = errors.array().map(error => error.msg).join(' ');
            return res.status(400).json({ success: false, message, errors: errors.array() });
        }
        next();
    },
];

/**
 * @desc    Create contact inquiry
 * @route   POST /api/contact
 * @access  Public
 */
router.post('/', validateContactInquiry, async (req, res) => {
    try {
        const inquiry = await ContactInquiry.create({
            name: req.body.name,
            email: req.body.email,
            subject: req.body.subject,
            message: req.body.message || '',
        });

        res.status(201).json({
            success: true,
            message: 'Your inquiry has been received.',
            inquiry: {
                id: inquiry._id,
                status: inquiry.status,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
