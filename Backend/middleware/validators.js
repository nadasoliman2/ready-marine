const { body, validationResult } = require('express-validator');
const { findUserByFields } = require('../models/users');
const { findSellerByFields } = require('../models/sellers');
const { formatPhone, normalizeEmailForAuth } = require('../services/authService');

/**
 * Middleware to handle validation results.
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const arr = errors.array();
        // Surface a human-readable message too, so generic frontend error handlers
        // (which read `data.message`) show the real reason instead of "Something went wrong".
        const message = arr.map(e => e.msg).filter(Boolean).join(' ') || 'Validation failed';
        return res.status(400).json({ message, errors: arr });
    }
    next();
};

/**
 * Validation rules for user registration.
 */
const registerUserValidation = [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Invalid email format').bail().customSanitizer(value => normalizeEmailForAuth(value)),
    body('phone').customSanitizer(value => formatPhone(value))
        .notEmpty().withMessage('Phone is required')
        .isLength({ min: 10 }).withMessage('Phone number must be at least 10 digits'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    
    // Custom uniqueness checks using model abstraction
    body('email').custom(async (email) => {
        const user = await findUserByFields({ email: normalizeEmailForAuth(email) });
        if (user) throw new Error('Email already in use');
        return true;
    }),
    body('phone').custom(async (phone) => {
        const user = await findUserByFields({ phone: formatPhone(phone) });
        if (user) throw new Error('Phone already in use');
        return true;
    }),
    validate
];

/**
 * Validation rules for vendor registration.
 */
const registerVendorValidation = [
    body('name').trim().notEmpty().withMessage('Owner name is required'),
    body('store_name').trim().notEmpty().withMessage('Store name is required'),
    body('store_username').trim().notEmpty().withMessage('Store username is required').toLowerCase(),
    body('email').isEmail().withMessage('Invalid email format').bail().customSanitizer(value => normalizeEmailForAuth(value)),
    body('phone').customSanitizer(value => formatPhone(value))
        .notEmpty().withMessage('Phone is required'),
    body('address').trim().notEmpty().withMessage('Address is required')
        // Bosta refuses a pickup-location address under 5 characters.
        .isLength({ min: 5 }).withMessage('Address must be at least 5 characters'),
    // Bosta cannot register a pickup location without a city, and a vendor with no pickup
    // location can never have a courier sent to them — so it is required up front and must
    // be a city Bosta actually serves.
    body('shipping_city').trim().notEmpty().withMessage('City is required')
        .bail()
        .custom(async (city) => {
            const { City } = require('../models/cities');
            const found = await City.findOne({ name: city }).lean();
            if (!found) throw new Error(`"${city}" is not a supported shipping city`);
            return true;
        }),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),

    // Uniqueness checks using model abstraction
    body('store_username').custom(async (username) => {
        const seller = await findSellerByFields({ store_username: username.toLowerCase() });
        if (seller) throw new Error('Store username already in use');
        return true;
    }),
    body('email').custom(async (email) => {
        const seller = await findSellerByFields({ email: normalizeEmailForAuth(email) });
        if (seller) throw new Error('Email already in use');
        return true;
    }),
    body('phone').custom(async (phone) => {
        const seller = await findSellerByFields({ phone: formatPhone(phone) });
        if (seller) throw new Error('Phone already in use');
        return true;
    }),
    validate
];

/**
 * Validation rules for login.
 */
const loginValidation = [
    body('identifier').notEmpty().withMessage('Email, phone, or username is required'),
    body('password').notEmpty().withMessage('Password is required'),
    validate
];

const forgotPasswordValidation = [
    body('role').isIn(['user', 'vendor']).withMessage('Account type is required'),
    body('email').isEmail().withMessage('Invalid email format').bail().customSanitizer(value => normalizeEmailForAuth(value)),
    validate
];

const resetPasswordValidation = [
    body('token').trim().notEmpty().withMessage('Reset token is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    validate
];

module.exports = {
    registerUserValidation,
    registerVendorValidation,
    loginValidation,
    forgotPasswordValidation,
    resetPasswordValidation
};
