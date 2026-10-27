const express = require('express');
const fs = require('fs');
const router = express.Router();
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const { SiteSettings } = require('../models/site_settings');
const { Seller } = require('../models/sellers');
const { normalizePartType, PART_TYPE_REQUIRED } = require('../services/shared/partType');
const { Product } = require('../models/products');
const { Service } = require('../models/services');
const { Category } = require('../models/categories');
const { ProductType } = require('../models/productTypes');
const { CarBrand } = require('../models/car_brands');
const { Brand } = require('../models/product_brands');
const { Coupon } = require('../models/coupons');
const { Ticket } = require('../models/tickets');
const { User } = require('../models/users');
const { Order } = require('../models/orders');
const { Page } = require('../models/pages');
const { ContactInquiry } = require('../models/contact_inquiries');
const { AdminUser } = require('../models/adminUsers');
const adminAccess = require('../services/adminAccessService');
const { Article } = require('../models/articles');
const { EmailVerification } = require('../models/emailVerification');
const articleService = require('../services/articleService');
const { protect } = require('../middleware/authMiddleware');
const { emitToTicket } = require('../services/socket');
const { hashPassword, comparePassword, formatPhone, verifyEmailRegistrationById } = require('../services/authService');
const {
    recordCustomerConfirmationCall,
    getAllOrders,
    getOrderById,
    updateOrderStatus,
    reactivateWholeOrder,
    updateOrderItems,
    replaceOrderItem,
    deleteOrderItem,
    lockOrderForFulfillment,
    deleteOrder,
    getVendorsForFilter,
} = require('../services/orderService');
const { generateSlug, linkVariantIds, assertVendorLocationsAreShippable } = require('../services/vendorService');
const { normalizePricing } = require('../services/shared/productPricing');
const { normalizeProductImages } = require('../services/shared/productImages');
const {
    generateServiceSlug,
    normalizePhone,
    normalizeWhatsappNumber,
    normalizeSocialLinks,
    prepareServicePayload,
} = require('../services/serviceService');
const { processBulkUpload, processBulkJsonUpload, generateBulkUploadTemplate } = require('../services/bulkUploadService');
const { normalizeCode } = require('../services/couponService');
const shippingEngine = require('../services/shippingEngine');
const { sendOrderToBosta, refreshOrderTracking, analyzePickupOrders, resolveSubLocation } = require('../services/bostaFulfillmentService');
const bostaFulfillment = require('../services/bostaFulfillmentService');
const smartLabelService = require('../services/smartLabelService');
const bostaService = require('../services/bostaService');
const bostaTariff = require('../services/bostaTariff');
const { VendorSubscription, getActiveSubscriptionForVendor } = require('../models/vendorSubscriptions');
const { SubscriptionPackage } = require('../models/subscriptionPackages');
const { suspendVendor } = require('../models/sellers');
const { getAllSubscriptionsAdmin, getSubscriptionStatsAdmin, getVendorSubscriptionStatus, paymentSegmentFilter, vendorIdsWithLiveSubscription } = require('../services/vendorSubscriptionService');
const { getBundlesForAdmin, approveBundle, rejectBundle } = require('../services/bundleService');
const { getSubscriptionPaymentsAdmin } = require('../services/subscriptionPaymentService');
const { sendSubscriptionNotification } = require('../services/notificationService');
const {
    getUserDeleteImpact,
    hardDeleteUser,
    getVendorDeleteImpact,
    hardDeleteVendor,
} = require('../services/accountDeletionService');

const getAdminActor = (req) => ({
    role: 'admin',
    label: req.user?.username || 'Admin',
});

const { recordProductStatusChange } = require('../services/shared/productAudit');

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

// Categories / product brands / car brands feed products/filters, which is cached
// (see productService.getFilterMetadata) because it is loaded on nearly every
// product-related screen. Any write here has to drop that cache so the change is
// visible immediately rather than waiting out the TTL.
const invalidateFiltersOnWrite = (req, res, next) => {
    res.on('finish', () => {
        if (res.statusCode < 400) {
            try { require('../services/productService').invalidateFilterMetadataCache(); } catch (_) { /* best effort */ }
        }
    });
    next();
};

const toObjectId = (value) => new mongoose.Types.ObjectId(value);

const paginate = (query, page = 1, limit = 20) => {
    const skip = (Math.max(1, Number(page)) - 1) * limit;
    return query.skip(skip).limit(limit);
};

const mapPendingVerification = (verification) => {
    const payload = verification.payload || {};
    return {
        _id: verification._id,
        role: verification.role,
        email: verification.email,
        phone: verification.phone,
        store_username: verification.store_username || null,
        name: payload.name || '',
        store_name: payload.store_name || '',
        created_at: verification.created_at,
        expires_at: verification.expires_at,
        expired: verification.expires_at ? verification.expires_at <= new Date() : false,
    };
};

const mapCategoryTree = (allCategories, parentId = null) => {
    return allCategories
        .filter(cat => String(cat.parent_id || null) === String(parentId))
        .map(cat => ({
            ...cat,
            subcategories: mapCategoryTree(allCategories, cat._id),
        }));
};

const sanitizeCouponPayload = (body = {}) => {
    const scopeType = body.scope_type;
    const asObjectIdList = (arr) => (Array.isArray(arr) ? arr : [])
        .filter(Boolean)
        .filter(isObjectId)
        .map(toObjectId);

    const payload = {
        code: normalizeCode(body.code),
        name: String(body.name || '').trim(),
        description: String(body.description || '').trim(),
        discount_type: body.discount_type,
        discount_value: Number(body.discount_value),
        scope_type: scopeType,
        // Who funds the discount: the vendor's percentage of it. Missing means 0 — the
        // platform pays — so a client that predates the field cannot silently bill vendors.
        vendor_share_percent: body.vendor_share_percent == null || body.vendor_share_percent === ''
            ? 0
            : Number(body.vendor_share_percent),
        category_ids: asObjectIdList(body.category_ids),
        product_ids: asObjectIdList(body.product_ids),
        vendor_ids: asObjectIdList(body.vendor_ids),
        min_order_amount: body.min_order_amount == null || body.min_order_amount === '' ? 0 : Number(body.min_order_amount),
        usage_limit_total: body.usage_limit_total == null || body.usage_limit_total === '' ? null : Number(body.usage_limit_total),
        usage_limit_per_user: body.usage_limit_per_user == null || body.usage_limit_per_user === '' ? null : Number(body.usage_limit_per_user),
        is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
        starts_at: body.starts_at ? new Date(body.starts_at) : null,
        expires_at: body.expires_at ? new Date(body.expires_at) : null,
    };

    if (scopeType !== 'category_tree') payload.category_ids = [];
    if (scopeType !== 'product_list') payload.product_ids = [];
    if (scopeType !== 'vendor_list') payload.vendor_ids = [];

    return payload;
};

// Multer for branding uploads (logo/favicon): disk storage
const brandingUploadDir = path.join(__dirname, '../public/uploads/branding');
if (!fs.existsSync(brandingUploadDir)) fs.mkdirSync(brandingUploadDir, { recursive: true });

const brandingStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, brandingUploadDir),
    filename: (req, file, cb) => {
        const validTypes = ['logo', 'logo_light', 'favicon'];
        const type = validTypes.includes(req.query.type) ? req.query.type : 'logo';
        cb(null, `${type}-${Date.now()}${path.extname(file.originalname)}`);
    },
});

/**
 * A logo exported on a big white canvas shows up as a speck: the header fits the whole
 * image, margins included, into a 48px-tall box. Cut the plain margin off before it is
 * served. Raster only — an SVG or an .ico is left as uploaded — and a file sharp cannot
 * read stays as it was rather than failing the upload.
 */
async function trimLogoMargins(filePath) {
    if (!/\.(jpe?g|png|webp)$/i.test(filePath)) return;
    try {
        const sharp = require('sharp');
        const trimmed = await sharp(filePath).trim({ threshold: 20 }).toBuffer();
        await fs.promises.writeFile(filePath, trimmed);
    } catch (err) {
        console.warn('[Branding] Could not trim logo margins:', err.message);
    }
}

const brandingUpload = multer({
    storage: brandingStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedExts = /\.(jpeg|jpg|png|webp|ico|svg)$/i;
        if (allowedExts.test(path.extname(file.originalname))) {
            return cb(null, true);
        }
        cb(new Error('Only image files are accepted (jpeg, jpg, png, webp, ico, svg).'));
    },
});

// Multer for admin bulk upload: in-memory storage, 5MB max, xlsx only
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.xlsx') {
            return cb(new Error('Only .xlsx files are accepted.'));
        }
        cb(null, true);
    },
});

/**
 * @desc    Admin login
 * @route   POST /api/admin/login
 * @access  Public
 */
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    const envUsername = process.env.ADMIN_USERNAME;
    const envPassword = process.env.ADMIN_PASSWORD;

    if (!envUsername || !envPassword) {
        return res.status(500).json({ success: false, message: 'Admin credentials not configured on server' });
    }

    const setCookie = (payload) => {
        const token = jwt.sign(payload, process.env.JWT_SECRET_ADMIN, { expiresIn: '7d' });
        res.cookie('admin_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });
    };

    // The super admin is checked FIRST and against the environment, never the database. It
    // is the account that must survive anything that goes wrong inside the dashboard, so it
    // does not depend on a collection that a bug or a bad edit could empty.
    if (username === envUsername && password === envPassword) {
        setCookie({ role: 'admin', username, sa: true });
        return res.json({ success: true, message: 'Admin logged in', is_super: true });
    }

    try {
        const account = await AdminUser.findOne({ username: String(username || '').trim().toLowerCase() })
            .select('+password');

        // One message for "no such account" and for "wrong password", and the password is
        // still compared when the account is missing would be the ideal — but bcrypt on a
        // non-existent hash throws, so the branches are merged into a single reply instead.
        // Nothing here tells the caller which half failed.
        const ok = account && account.is_active !== false && await comparePassword(password, account.password);
        if (!ok) {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
        }

        setCookie({ role: 'admin', username: account.username, aid: account._id.toString(), sa: false });
        account.last_login_at = new Date();
        await account.save();

        return res.json({ success: true, message: 'Admin logged in', is_super: false });
    } catch (err) {
        console.error('[Admin login]', err.message);
        return res.status(500).json({ success: false, message: 'Login failed' });
    }
});

/**
 * @desc    Logout admin
 * @route   POST /api/admin/logout
 * @access  Public
 */
router.post('/logout', (req, res) => {
    res.cookie('admin_token', 'none', {
        expires: new Date(Date.now() + 10 * 1000),
        httpOnly: true
    });
    res.json({ success: true, message: 'Admin logged out' });
});

/* ==================================================================== *
 * Admin accounts
 *
 * Super-admin only, and not by convention — `SUPER_ADMIN_ONLY_PREFIXES` in
 * services/adminAccessService.js refuses `/admin-users` to every sub-admin before any
 * handler here runs. That is the rule that stops a sub-admin granting themselves the
 * modules they were not given. The `is_super` checks below are a second, local guard: if
 * the prefix table were ever edited by mistake, these still hold.
 * ==================================================================== */

const requireSuper = (req, res) => {
    if (req.user?.is_super) return true;
    res.status(403).json({ success: false, message: 'Only the main admin account can manage admin accounts.' });
    return false;
};

/** The module catalogue, for building the permission checkboxes. */
router.get('/admin-users/modules', protect('admin'), (req, res) => {
    if (!requireSuper(req, res)) return;
    res.json({ success: true, modules: adminAccess.listModules() });
});

router.get('/admin-users', protect('admin'), async (req, res) => {
    if (!requireSuper(req, res)) return;
    try {
        const accounts = await AdminUser.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, accounts });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/admin-users', protect('admin'), async (req, res) => {
    if (!requireSuper(req, res)) return;
    try {
        const username = String(req.body.username || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (username.length < 3) {
            return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });
        }
        if (password.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
        }
        // A sub-admin sharing the super admin's username would make the login ambiguous and
        // the audit trail a lie about who did what.
        if (process.env.ADMIN_USERNAME && username === String(process.env.ADMIN_USERNAME).toLowerCase()) {
            return res.status(400).json({ success: false, message: 'That username belongs to the main admin account' });
        }
        if (await AdminUser.findOne({ username })) {
            return res.status(409).json({ success: false, message: 'That username is already taken' });
        }

        const account = await AdminUser.create({
            username,
            name: String(req.body.name || '').trim(),
            password: await hashPassword(password),
            permissions: adminAccess.sanitizePermissions(req.body.permissions),
            is_active: req.body.is_active !== false,
            created_by: req.user.username,
        });

        const { password: _omit, ...safe } = account.toObject();
        res.status(201).json({ success: true, account: safe });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/admin-users/:id', protect('admin'), async (req, res) => {
    if (!requireSuper(req, res)) return;
    try {
        const account = await AdminUser.findById(req.params.id);
        if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

        if (req.body.name !== undefined) account.name = String(req.body.name).trim();
        if (req.body.permissions !== undefined) {
            account.permissions = adminAccess.sanitizePermissions(req.body.permissions);
        }
        if (req.body.is_active !== undefined) account.is_active = req.body.is_active !== false;

        if (req.body.password) {
            const password = String(req.body.password);
            if (password.length < 8) {
                return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
            }
            account.password = await hashPassword(password);
            // Retires every token this account is currently holding, so a password reset
            // actually ends the sessions it was reset because of.
            account.password_changed_at = new Date();
        }

        await account.save();
        const { password: _omit, ...safe } = account.toObject();
        res.json({ success: true, account: safe });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/admin-users/:id', protect('admin'), async (req, res) => {
    if (!requireSuper(req, res)) return;
    try {
        const account = await AdminUser.findByIdAndDelete(req.params.id);
        if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
        res.json({ success: true, message: 'Account deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get current admin user (for verifying auth state on frontend load)
 * @route   GET /api/admin/me
 * @access  Private (Admin)
 */
router.get('/me', protect('admin'), (req, res) => {
    res.json({
        success: true,
        admin: {
            username: req.user.username,
            name: req.user.name || '',
            role: 'admin',
            is_super: !!req.user.is_super,
            permissions: req.user.permissions || [],
        },
        // The catalogue the sidebar filters against. Sent with the identity so the dashboard
        // never has to guess which modules exist.
        modules: adminAccess.listModules(),
    });
});

/**
 * @desc    The dashboard's front page: a few numbers per section this admin may view
 * @route   GET /api/admin/overview
 * @access  Private (Admin) — every admin; the service leaves out the modules they cannot view
 */
router.get('/overview', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await require('../services/adminOverviewService').getOverview(req.user)) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get pending account verification registrations
 * @route   GET /api/admin/verifications
 * @access  Private (Admin)
 */
router.get('/verifications', protect('admin'), async (req, res) => {
    try {
        const filter = {};
        if (['user', 'vendor'].includes(req.query.role)) {
            filter.role = req.query.role;
        }

        const verifications = await EmailVerification.find(filter)
            .sort({ created_at: -1 })
            .lean();

        res.json({
            success: true,
            verifications: verifications.map(mapPendingVerification),
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Manually verify a pending account registration
 * @route   POST /api/admin/verifications/:id/verify
 * @access  Private (Admin)
 */
router.post('/verifications/:id/verify', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid verification ID' });
        }

        const result = await verifyEmailRegistrationById(req.params.id);
        res.status(201).json({
            success: true,
            message: 'Account verified successfully',
            ...result,
        });
    } catch (err) {
        const status = err.message.includes('already in use') || err.message.includes('required') ? 400 : 404;
        res.status(status).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get all vendors
 * @route   GET /api/admin/vendors
 * @access  Private (Admin)
 */
router.get('/vendors', protect('admin'), async (req, res) => {
    try {
        const vendors = await Seller.find()
            .select([
                'name',
                'store_name',
                'store_username',
                'email',
                'phone',
                'locations',
                'store_image',
                'status',
                'subscription_status',
                'subscription_reason',
                'subscription_date',
                'suspension_reason',
                'suspension_date',
                'suspended_by',
                'commission_settings',
                'auto_publish_products',
                'public_show_on_vendors_page',
                'public_vendors_page_order',
                'public_show_on_home',
                'public_home_order',
                'created_at',
            ].join(' '))
            .sort({ created_at: -1 })
            .lean();

        res.json({ success: true, vendors });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Add a vendor
 * @route   POST /api/admin/vendors
 * @access  Private (Admin)
 */
router.post('/vendors', protect('admin'), async (req, res) => {
    try {
        const { name, store_name, store_username, email, phone, locations, address, password, store_image } = req.body;

        if (!name || !store_name || !store_username || !email || !phone || !password) {
            return res.status(400).json({ success: false, message: 'Required vendor fields are missing' });
        }

        const vendorLocations = locations || [];
        if (address && vendorLocations.length === 0) {
            vendorLocations.push({
                address: address.trim(),
                shipping_country: req.body.shipping_country || null,
                shipping_city: req.body.shipping_city || null,
                is_default: true,
            });
        }

        // Same gate as vendor signup: a location Bosta can't accept means a vendor no
        // courier can ever be sent to, so it is refused rather than quietly created.
        try {
            await assertVendorLocationsAreShippable(vendorLocations);
        } catch (err) {
            return res.status(400).json({ success: false, message: err.message });
        }

        const normalizedUsername = store_username.toLowerCase().trim();
        // Canonical spelling (Gmail dots/+aliases collapsed), the same the schema stores.
        const normalizedEmail = require('../services/shared/emailIdentity').canonicalEmail(email);
        const normalizedPhone = formatPhone(phone);

        const existing = await Seller.findOne({
            $or: [
                { store_username: normalizedUsername },
                { email: normalizedEmail },
                { phone: normalizedPhone }
            ]
        });

        if (existing) {
            return res.status(409).json({ success: false, message: 'A vendor with this username, email, or phone already exists' });
        }

        // Auto-sync locations to Bosta pickup locations
        for (const loc of vendorLocations) {
            if (loc.shipping_city) {
                try {
                    loc.bosta_location_id = await bostaService.ensurePickupLocation(loc, { name: name.trim(), phone: normalizedPhone, store_name: store_name.trim() });
                    console.log(`[Bosta] Create vendor sync location "${loc.address}" → ${loc.bosta_location_id}`);
                } catch (err) {
                    console.error(`[Bosta] Create vendor sync failed for "${loc.address}":`, err.message);
                }
            }
        }

        const vendor = await Seller.create({
            name: name.trim(),
            store_name: store_name.trim(),
            store_username: normalizedUsername,
            email: normalizedEmail,
            phone: normalizedPhone,
            locations: vendorLocations,
            password: await hashPassword(password),
            store_image: store_image || null,
            status: 'active',
            subscription_status: 'not_subscribed',
        });

        const cleanVendor = vendor.toObject();
        delete cleanVendor.password;
        res.status(201).json({ success: true, vendor: cleanVendor });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update vendor details (admin)
 * @route   PUT /api/admin/vendors/:id
 * @access  Private (Admin)
 */
router.put('/vendors/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
        }

        const allowedFields = [
            'name',
            'store_name',
            'locations',
            'store_image',
            'commission_settings',
            'auto_publish_products',
            'public_show_on_vendors_page',
            'public_vendors_page_order',
            'public_show_on_home',
            'public_home_order',
        ];
        const updateData = {};
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) updateData[field] = req.body[field];
        });

        if (typeof req.body.new_password === 'string' && req.body.new_password.trim()) {
            if (req.body.new_password.length < 8) {
                return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
            }
            updateData.password = await hashPassword(req.body.new_password);
            updateData.password_changed_at = new Date();
        }

        // Auto-sync locations to Bosta pickup locations
        if (updateData.locations && Array.isArray(updateData.locations)) {
            try {
                await assertVendorLocationsAreShippable(updateData.locations);
            } catch (err) {
                return res.status(400).json({ success: false, message: err.message });
            }
            const existingVendor = await Seller.findById(req.params.id).select('name store_name phone email').lean();
            const vendorContact = {
                name: updateData.name || existingVendor?.name || existingVendor?.store_name || "",
                phone: existingVendor?.phone || "",
                store_name: updateData.store_name || existingVendor?.store_name || "",
            };
            for (const loc of updateData.locations) {
                if (loc.shipping_city) {
                    try {
                        loc.bosta_location_id = await bostaService.ensurePickupLocation(loc, vendorContact);
                        console.log(`[Bosta] Admin sync location "${loc.address}" → ${loc.bosta_location_id}`);
                    } catch (err) {
                        console.error(`[Bosta] Admin sync failed for "${loc.address}":`, err.message);
                    }
                }
            }
        }

        const vendor = await Seller.findByIdAndUpdate(
            req.params.id,
            updateData,
            { returnDocument: "after", runValidators: true }
        ).select('-password');

        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
        res.json({ success: true, vendor });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update vendor status
 * @route   PUT /api/admin/vendors/:id/status
 * @access  Private (Admin)
 */
router.put('/vendors/:id/status', protect('admin'), async (req, res) => {
    try {
        const { status, reason } = req.body;
        if (!['active', 'suspended'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid vendor status' });
        }

        if (status === 'suspended' && (!reason || !reason.trim())) {
            return res.status(400).json({ success: false, message: 'Suspension reason is required' });
        }

        let vendor;
        if (status === 'suspended') {
            vendor = await suspendVendor(req.params.id, reason.trim(), 'admin');
            await Seller.findByIdAndUpdate(req.params.id, {
                subscription_status: 'suspended',
            });
            await sendSubscriptionNotification(vendor._id, 'account_suspended', {
                reason: reason.trim(),
                suspendedAt: new Date(),
            });
        } else {
            // Determine correct subscription_status on reactivation
            const activeSub = await getActiveSubscriptionForVendor(req.params.id);
            const reactivatedSubStatus = activeSub ? 'active' : 'not_subscribed';

            vendor = await Seller.findByIdAndUpdate(
                req.params.id,
                {
                    status: 'active',
                    subscription_status: reactivatedSubStatus,
                    subscription_reason: null,
                    subscription_date: null,
                    suspension_reason: null,
                    suspension_date: null,
                    suspended_by: null,
                },
                { returnDocument: "after", runValidators: true }
            ).select('-password');
        }

        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
        res.json({ success: true, vendor });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get all products for admin (optionally filtered by status)
 * @route   GET /api/admin/products
 * @access  Private (Admin)
 */
router.get('/products', protect('admin'), async (req, res) => {
    try {
        const { status, category_id, product_brand_id, vendor_id, search, page = 1, limit = 20, fitment, car_brand_id, car_model_id, car_year } = req.query;

        // This used to load every product (1,500+ and growing) fully populated with the
        // WHOLE vendor document, on every visit to this screen, then filter and paginate
        // in the browser. Same shape as the public listing now: the DB does the filtering
        // and paging, and only the fields the table actually renders are populated.
        const filter = {};
        if (status) filter.status = status;
        if (isObjectId(product_brand_id)) filter.product_brand_id = product_brand_id;
        if (isObjectId(vendor_id)) filter.vendor_id = vendor_id;
        if (isObjectId(category_id)) {
            const { getDescendantCategoryIds } = require('../services/productService');
            filter.category_id = { $in: await getDescendantCategoryIds(category_id) };
        }
        // Compatibility. `fitment`: universal (fits any car), specific (names its cars) or
        // none (neither — a product no car filter can find). A car (make, model, year) finds
        // the products that name it, with the shop's rules; universal ones are not counted in.
        const compat = [];
        if (fitment === 'universal') compat.push({ is_universal: true });
        if (fitment === 'specific') compat.push({ is_universal: { $ne: true }, 'compatible_cars.0': { $exists: true } });
        if (fitment === 'none') compat.push({ is_universal: { $ne: true }, 'compatible_cars.0': { $exists: false } });
        if (isObjectId(car_brand_id)) {
            const { carClauses } = require('../services/carFitService');
            compat.push({ $or: carClauses({
                car_brand_id,
                car_model_id: isObjectId(car_model_id) ? car_model_id : '',
                car_year: isObjectId(car_model_id) ? car_year : '',
            }) });
        }
        if (compat.length) filter.$and = compat;

        const term = String(search || '').trim();
        if (term) {
            const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            filter.$or = [
                { title_en: rx }, { title_ar: rx }, { subtitle_en: rx }, { subtitle_ar: rx },
                { sku: rx }, { part_number: rx },
            ];
        }

        // A few older screens call this with only `?status=` expecting the full
        // matching set (a coupon's product picker, the pending-review queue) — keep
        // that working exactly as before. Pagination only kicks in when the caller
        // actually asks for it, which is what the admin product list now always does.
        const paginating = req.query.page !== undefined || req.query.limit !== undefined;
        const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
        const safePage = Math.max(Number(page) || 1, 1);

        let query = Product.find(filter)
            .sort({ created_at: -1 })
            .populate('category_id', 'name name_en name_ar parent_id')
            .populate('product_brand_id', 'name')
            .populate('vendor_id', 'store_name store_username')
            .lean();
        if (paginating) query = query.skip((safePage - 1) * safeLimit).limit(safeLimit);

        const [products, total] = await Promise.all([query, Product.countDocuments(filter)]);

        res.json({
            success: true,
            products,
            pagination: paginating
                ? { total, page: safePage, pages: Math.max(Math.ceil(total / safeLimit), 1), limit: safeLimit }
                : { total, page: 1, pages: 1, limit: total },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get one product for admin, including drafts
 * @route   GET /api/admin/products/:id
 * @access  Private (Admin)
 */
router.get('/products/:id([0-9a-fA-F]{24})', protect('admin'), async (req, res) => {
    try {
        // catalog_entry_id is populated for the review screen: the reviewer needs
        // the linked entry beside the vendor's data to spot a product that has
        // drifted into being something else entirely.
        const product = await Product.findById(req.params.id)
            .populate('category_id product_brand_id vendor_id')
            .populate({ path: 'catalog_entry_id', populate: { path: 'category_id product_brand_id' } });

        if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
        res.json({ success: true, product });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update any product for admin
 * @route   PUT /api/admin/products/:id
 * @access  Private (Admin)
 */
/**
 * @desc    Delete a product for good, from any vendor.
 *
 *          Orders are untouched: every order line carries its own frozen title, price and
 *          image, so history keeps reading correctly. What cannot survive is a live link
 *          to a product that no longer exists — the product is pulled out of every cart
 *          and every bundle that carried it, and a bundle left with fewer than two members
 *          is deactivated rather than sold as a "bundle" of one.
 * @route   DELETE /api/admin/products/:id
 * @access  Private (Admin)
 */
router.delete('/products/:id', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid product id' });
        }
        const id = toObjectId(req.params.id);
        const product = await Product.findById(id).select('_id title_en title_ar vendor_id').lean();
        if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

        const { Bundle } = require('../models/bundles');
        const { User } = require('../models/users');

        // Bundles: drop the member, and retire a bundle that no longer has two products.
        const bundles = await Bundle.find({ 'items.product_id': id }).select('_id items is_active status');
        let bundlesTouched = 0;
        let bundlesRetired = 0;
        for (const bundle of bundles) {
            bundle.items = bundle.items.filter((i) => String(i.product_id) !== String(id));
            bundlesTouched += 1;
            if (bundle.items.length < 2) {
                // Back to a draft and switched off: the vendor decides what to do with what is left.
                bundle.is_active = false;
                bundle.status = 'draft';
                bundlesRetired += 1;
            }
            await bundle.save().catch((err) => console.error(`[Admin] Could not update bundle ${bundle._id} after deleting product ${id}: ${err.message}`));
        }

        // Carts: a line pointing at nothing is what the storefront already drops silently;
        // remove it here so nobody's cart count lies.
        const carts = await User.updateMany(
            { 'cart.items.product_id': id },
            { $pull: { 'cart.items': { product_id: id } }, $set: { 'cart.updated_at': new Date() } }
        );

        await Product.deleteOne({ _id: id });
        shippingEngine.invalidateShippingCache?.();

        res.json({
            success: true,
            message: 'Product deleted',
            deleted: { _id: product._id, title_en: product.title_en, title_ar: product.title_ar },
            cleanup: { carts: carts.modifiedCount || 0, bundles: bundlesTouched, bundles_retired: bundlesRetired },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/products/:id', protect('admin'), async (req, res) => {
    try {
        const forbiddenFields = ['_id', 'created_at', 'vendor_id', 'is_published'];
        const updateData = { ...req.body };
        forbiddenFields.forEach(field => delete updateData[field]);

        if (updateData.product_brand_id === '') updateData.product_brand_id = null;
        // Sent by the edit form, which requires it; a product cannot be cleared back to "unknown".
        if (updateData.part_type !== undefined) {
            updateData.part_type = normalizePartType(updateData.part_type);
            if (!updateData.part_type) return res.status(400).json({ success: false, message: PART_TYPE_REQUIRED });
        }
        // discount_price is derived, never accepted from the client.
        delete updateData.discount_price;
        if (updateData.quantity === '') updateData.quantity = null;
        if (updateData.shipping_class_id === '') updateData.shipping_class_id = null;
        if (updateData.weight === '') updateData.weight = null;
        else if (updateData.weight !== undefined && updateData.weight !== null) updateData.weight = Number(updateData.weight) || null;
        if (updateData.dimensions && typeof updateData.dimensions === 'object') {
            let allNull = true;
            for (const k of ['length', 'width', 'height']) {
                const v = updateData.dimensions[k];
                updateData.dimensions[k] = (v === '' || v === undefined || v === null) ? null : (Number(v) || null);
                if (updateData.dimensions[k] !== null) allNull = false;
            }
            if (allNull) delete updateData.dimensions;
        }

        const productBefore = await Product.findById(req.params.id).populate('vendor_id');
        if (!productBefore) return res.status(404).json({ success: false, message: 'Product not found' });

        const vendorName = productBefore.vendor_id?.store_name || productBefore.vendor_id?.store_username || 'vendor';
        if (updateData.title_en !== undefined) {
            if (updateData.title_en && (updateData.title_en !== productBefore.title_en || !productBefore.slug_en)) {
                updateData.slug_en = await generateSlug(updateData.title_en, vendorName, 'en', req.params.id);
            }
        } else if (!productBefore.slug_en && productBefore.title_en) {
            updateData.slug_en = await generateSlug(productBefore.title_en, vendorName, 'en', req.params.id);
        }

        if (updateData.title_ar !== undefined) {
            if (updateData.title_ar && (updateData.title_ar !== productBefore.title_ar || !productBefore.slug_ar)) {
                updateData.slug_ar = await generateSlug(updateData.title_ar, vendorName, 'ar', req.params.id);
            }
        } else if (!productBefore.slug_ar && productBefore.title_ar) {
            updateData.slug_ar = await generateSlug(productBefore.title_ar, vendorName, 'ar', req.params.id);
        }

        if (updateData.variation_types && updateData.variants) {
            linkVariantIds(updateData);
        }

        updateData.images = normalizeProductImages(updateData.images);

        // findByIdAndUpdate bypasses document middleware, so derive discount_price
        // here from the submitted discount type/value (falling back to the stored
        // price / discount when the admin only edited one side of the pair).
        const pricingErrors = normalizePricing(updateData, { existing: productBefore });
        if (pricingErrors.length > 0) {
            return res.status(400).json({ success: false, message: pricingErrors.map(e => e.message).join(' ') });
        }

        const product = await Product.findByIdAndUpdate(
            req.params.id,
            updateData,
            { returnDocument: "after", runValidators: true }
        ).populate('category_id product_brand_id vendor_id');

        shippingEngine.invalidateShippingCache();
        await recordProductStatusChange({
            product, from: productBefore.status, to: product?.status, actor: getAdminActor(req),
        });
        // A correction made while the product waits for approval is told to the vendor when
        // it is published (services/productReviewService.js).
        if (productBefore.status === 'pending' && product) {
            const review = require('../services/productReviewService');
            await review.noteFixes(product._id, review.changedFixes(productBefore, product));
        }
        res.json({ success: true, product });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Approve a pending product (set to published)
 * @route   PUT /api/admin/products/:id/approve
 * @access  Private (Admin)
 */
router.put('/products/:id/approve', protect('admin'), async (req, res) => {
    try {
        if (!(await Product.exists({ _id: req.params.id }))) return res.status(404).json({ success: false, message: 'Product not found' });
        await require('../services/productReviewService').approveProducts([req.params.id], getAdminActor(req));
        const product = await Product.findById(req.params.id).populate('category_id product_brand_id vendor_id');
        res.json({ success: true, product });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, message: err.message, code: err.code });
    }
});

/**
 * @desc    The review queue: every product waiting for approval, slim, with the problems
 *          found on each (services/productReviewService.js)
 * @route   GET /api/admin/products/review-queue
 */
router.get('/products/review-queue', protect('admin'), async (req, res) => {
    try {
        const products = await require('../services/productReviewService').reviewQueue();
        res.json({ success: true, products });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Publish many waiting products at once; each vendor gets one notice
 * @route   POST /api/admin/products/review/approve   { ids }
 */
router.post('/products/review/approve', protect('admin'), async (req, res) => {
    try {
        const result = await require('../services/productReviewService').approveProducts(req.body?.ids, getAdminActor(req));
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, message: err.message, code: err.code });
    }
});

/**
 * @desc    One correction on many waiting products (category, part type, fitment), and
 *          optionally publish them in the same step
 * @route   POST /api/admin/products/review/bulk   { ids, set: { category_id?, part_type?, fitment? }, publish? }
 */
router.post('/products/review/bulk', protect('admin'), async (req, res) => {
    try {
        const result = await require('../services/productReviewService').bulkFix(req.body || {}, getAdminActor(req));
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, message: err.message, code: err.code });
    }
});

/**
 * @desc    Reject a pending product (set to draft)
 * @route   PUT /api/admin/products/:id/reject
 * @access  Private (Admin)
 */
router.put('/products/:id/reject', protect('admin'), async (req, res) => {
    try {
        const before = await Product.findById(req.params.id).select('status').lean();
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            { status: 'draft' },
            { returnDocument: "after", runValidators: true }
        ).populate('category_id product_brand_id vendor_id');

        if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
        await recordProductStatusChange({
            product, from: before?.status, to: 'draft', actor: getAdminActor(req),
            reason: String(req.body?.reason || 'Rejected by admin'),
        });
        res.json({ success: true, product });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------------------ Bundle moderation ------------------------------ */

/**
 * @desc    List bundles for admin (optionally by status)
 * @route   GET /api/admin/bundles
 */
router.get('/bundles', protect('admin'), async (req, res) => {
    try {
        const bundles = await getBundlesForAdmin({ status: req.query.status });
        res.json({ success: true, bundles });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Approve a pending bundle (re-validates members, sets published)
 * @route   PUT /api/admin/bundles/:id/approve
 */
router.put('/bundles/:id/approve', protect('admin'), async (req, res) => {
    try {
        const bundle = await approveBundle(req.params.id);
        res.json({ success: true, bundle });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message, code: err.code });
    }
});

/**
 * @desc    Reject a pending bundle (set to draft)
 * @route   PUT /api/admin/bundles/:id/reject
 */
router.put('/bundles/:id/reject', protect('admin'), async (req, res) => {
    try {
        const bundle = await rejectBundle(req.params.id);
        res.json({ success: true, bundle });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Admin creates a product directly (with vendor assignment)
 * @route   POST /api/admin/products
 * @access  Private (Admin)
 */
router.post('/products', protect('admin'), async (req, res) => {
    try {
        const {
            vendor_id,
            category_id,
            product_brand_id,
            title_en,
            title_ar,
            subtitle_en,
            subtitle_ar,
            description_en,
            description_ar,
            sku,
            part_number,
            gtin,
            price,
            discount_type,
            discount_value,
            status,
            is_universal,
            for_girls,
            for_trunk,
            stock_management,
            quantity,
            images,
            compatible_cars,
            variation_types,
            variants,
            weight,
            dimensions,
            shipping_class_id,
        } = req.body;

        if (!vendor_id) return res.status(400).json({ success: false, message: 'Vendor is required' });
        if (!category_id) return res.status(400).json({ success: false, message: 'Category is required' });
        if (!price) return res.status(400).json({ success: false, message: 'Price is required' });
        if (!normalizePartType(req.body.part_type)) return res.status(400).json({ success: false, message: PART_TYPE_REQUIRED });

        const vendor = await Seller.findById(vendor_id);
        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

        const vendorName = vendor.store_name || vendor.store_username;

        const productData = {
            vendor_id,
            category_id: category_id || undefined,
            product_brand_id: product_brand_id || null,
            title_en: title_en || '',
            title_ar: title_ar || '',
            subtitle_en: subtitle_en || '',
            subtitle_ar: subtitle_ar || '',
            description_en: description_en || '',
            description_ar: description_ar || '',
            sku: sku || 'SKU-' + Date.now().toString(36).toUpperCase(),
            part_number: part_number || '',
            gtin: gtin || '',
            part_type: normalizePartType(req.body.part_type),
            price: Number(price),
            // discount_price is derived from the pair below by normalizePricing.
            discount_type: discount_type ?? null,
            discount_value: discount_value ?? null,
            status: status || 'draft',
            is_published: status === 'published',
            is_universal: is_universal !== undefined ? is_universal : true,
            for_girls: for_girls || false,
            for_trunk: for_trunk || false,
            stock_management: stock_management !== undefined ? stock_management : true,
            quantity: quantity != null && quantity !== '' ? Number(quantity) : null,
            images: images || [],
            compatible_cars: compatible_cars || [],
            variation_types: variation_types || [],
            variants: variants || [],
            weight: weight === '' || weight === undefined || weight === null ? null : (Number(weight) || null),
            shipping_class_id: shipping_class_id === '' || shipping_class_id === undefined ? null : shipping_class_id,
            dimensions: (dimensions && typeof dimensions === 'object'
                && ['length', 'width', 'height'].some(k => dimensions[k] !== '' && dimensions[k] !== undefined && dimensions[k] !== null))
                ? {
                    length: dimensions.length === '' || dimensions.length == null ? null : (Number(dimensions.length) || null),
                    width: dimensions.width === '' || dimensions.width == null ? null : (Number(dimensions.width) || null),
                    height: dimensions.height === '' || dimensions.height == null ? null : (Number(dimensions.height) || null),
                }
                : undefined,
        };

        if (productData.title_en) {
            productData.slug_en = await generateSlug(productData.title_en, vendorName, 'en');
        }
        if (productData.title_ar) {
            productData.slug_ar = await generateSlug(productData.title_ar, vendorName, 'ar');
        }

        if (!productData.is_universal && (!productData.compatible_cars || productData.compatible_cars.length === 0)) {
            productData.is_universal = true;
        }

        if (productData.variation_types && productData.variants) {
            linkVariantIds(productData);
        }

        productData.images = normalizeProductImages(productData.images);

        const pricingErrors = normalizePricing(productData);
        if (pricingErrors.length > 0) {
            return res.status(400).json({ success: false, message: pricingErrors.map(e => e.message).join(' ') });
        }

        const newProduct = new Product(productData);
        await newProduct.save();
        shippingEngine.invalidateShippingCache();

        const populated = await Product.findById(newProduct._id)
            .populate('category_id product_brand_id vendor_id');

        res.status(201).json({ success: true, product: populated });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Admin bulk upload products for a selected vendor
 * @route   POST /api/admin/products/bulk-upload
 * @access  Private (Admin)
 */
router.post('/products/bulk-upload', protect('admin'), (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        const vendorId = req.body.vendor_id;
        if (!vendorId) {
            return res.status(400).json({ success: false, message: 'Vendor is required' });
        }

        const vendor = await Seller.findById(vendorId).select('_id status subscription_status');
        if (!vendor) {
            return res.status(404).json({ success: false, message: 'Vendor not found' });
        }
        if (vendor.status !== 'active') {
            return res.status(400).json({ success: false, message: 'Cannot bulk upload for suspended vendor' });
        }
        if (['not_subscribed', 'expired', 'cancelled', 'suspended'].includes(vendor.subscription_status)) {
            return res.status(400).json({ success: false, message: 'Cannot bulk upload for vendor without active subscription' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded. Please attach an .xlsx file with field name "file".' });
        }

        // The admin publishing directly is the approval, so this is the one caller that
        // skips the gate. Vendor uploads go through routes/vendors.js and do not.
        const result = await processBulkUpload(req.file.buffer, vendorId, { bypassApproval: true });
        res.status(200).json({ success: true, ...result });
    } catch (err) {
        console.error('Admin Bulk Upload Error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Admin bulk create products for a selected vendor (JSON grid)
 * @route   POST /api/admin/products/bulk-json
 * @access  Private (Admin)
 */
router.post('/products/bulk-json', protect('admin'), async (req, res) => {
    try {
        const vendorId = req.body.vendor_id;
        if (!vendorId) {
            return res.status(400).json({ success: false, message: 'Vendor is required' });
        }

        const vendor = await Seller.findById(vendorId).select('_id status subscription_status');
        if (!vendor) {
            return res.status(404).json({ success: false, message: 'Vendor not found' });
        }
        if (vendor.status !== 'active') {
            return res.status(400).json({ success: false, message: 'Cannot bulk create for suspended vendor' });
        }
        if (['not_subscribed', 'expired', 'cancelled', 'suspended'].includes(vendor.subscription_status)) {
            return res.status(400).json({ success: false, message: 'Cannot bulk create for vendor without active subscription' });
        }

        const result = await processBulkJsonUpload(req.body.products, vendorId, { bypassApproval: true });
        res.status(200).json({ success: true, ...result });
    } catch (err) {
        console.error('Admin Bulk JSON Upload Error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Download bulk upload Excel template (admin)
 * @route   GET /api/admin/products/bulk-template
 * @access  Private (Admin)
 */
router.get('/products/bulk-template', protect('admin'), async (req, res) => {
    try {
        const lang = req.query.lang === 'ar' ? 'ar' : 'en';
        const buffer = await generateBulkUploadTemplate(lang);
        const filename = lang === 'ar' ? 'product_bulk_upload_template_ar.xlsx' : 'product_bulk_upload_template.xlsx';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (err) {
        console.error('Admin Template Generation Error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate template' });
    }
});

/**
 * @desc    Get all services for admin
 * @route   GET /api/admin/services
 * @access  Private (Admin)
 */
router.get('/services', protect('admin'), async (req, res) => {
    try {
        const services = await Service.find()
            .sort({ created_at: -1 })
            .lean();

        res.json({ success: true, services });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get one service for admin
 * @route   GET /api/admin/services/:id
 * @access  Private (Admin)
 */
router.get('/services/:id', protect('admin'), async (req, res) => {
    try {
        const service = await Service.findById(req.params.id).lean();
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        res.json({ success: true, service });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Add a service
 * @route   POST /api/admin/services
 * @access  Private (Admin)
 */
router.post('/services', protect('admin'), async (req, res) => {
    try {
        const payload = prepareServicePayload(req.body || {});

        if (!payload.title_en && !payload.title_ar) {
            return res.status(400).json({ success: false, message: 'Service title is required in at least one language.' });
        }

        if (!payload.description_en && !payload.description_ar) {
            return res.status(400).json({ success: false, message: 'Service description is required in at least one language.' });
        }

        if (!payload.vendor_name_en && !payload.vendor_name_ar) {
            return res.status(400).json({ success: false, message: 'Vendor name is required in at least one language.' });
        }

        if (!payload.locations.length && !payload.vendor_location_en && !payload.vendor_location_ar) {
            return res.status(400).json({ success: false, message: 'Vendor location is required in at least one language.' });
        }

        if (payload.phones.length === 0 && payload.whatsapp_numbers.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one phone or WhatsApp number is required.' });
        }

        if (payload.price !== null && (!Number.isFinite(Number(payload.price)) || Number(payload.price) < 0)) {
            return res.status(400).json({ success: false, message: 'Service price must be a non-negative number.' });
        }

        const slugBaseEn = payload.title_en || payload.vendor_name_en || payload.vendor_name_ar || payload.title_ar;
        const slugBaseAr = payload.title_ar || payload.vendor_name_ar || payload.vendor_name_en || payload.title_en;

        payload.slug_en = await generateServiceSlug(slugBaseEn, 'en');
        payload.slug_ar = await generateServiceSlug(slugBaseAr, 'ar');

        const service = await Service.create(payload);
        res.status(201).json({ success: true, service });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update a service
 * @route   PUT /api/admin/services/:id
 * @access  Private (Admin)
 */
router.put('/services/:id', protect('admin'), async (req, res) => {
    try {
        const serviceBefore = await Service.findById(req.params.id);
        if (!serviceBefore) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        const payload = prepareServicePayload({ ...serviceBefore.toObject(), ...(req.body || {}) });

        if (payload.price !== null && (!Number.isFinite(Number(payload.price)) || Number(payload.price) < 0)) {
            return res.status(400).json({ success: false, message: 'Service price must be a non-negative number.' });
        }

        if (!payload.locations.length && !payload.vendor_location_en && !payload.vendor_location_ar) {
            return res.status(400).json({ success: false, message: 'At least one vendor location is required.' });
        }

        if ((req.body?.title_en !== undefined || req.body?.title_ar !== undefined)) {
            if (!payload.title_en && !payload.title_ar) {
                return res.status(400).json({ success: false, message: 'Service title is required in at least one language.' });
            }

            if (req.body?.title_en !== undefined) {
                const slugBaseEn = payload.title_en || payload.vendor_name_en || payload.vendor_name_ar || payload.title_ar;
                payload.slug_en = await generateServiceSlug(slugBaseEn, 'en', req.params.id);
            }

            if (req.body?.title_ar !== undefined) {
                const slugBaseAr = payload.title_ar || payload.vendor_name_ar || payload.vendor_name_en || payload.title_en;
                payload.slug_ar = await generateServiceSlug(slugBaseAr, 'ar', req.params.id);
            }
        } else {
            payload.slug_en = serviceBefore.slug_en;
            payload.slug_ar = serviceBefore.slug_ar;
        }

        const service = await Service.findByIdAndUpdate(
            req.params.id,
            payload,
            { returnDocument: "after", runValidators: true }
        );

        res.json({ success: true, service });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Delete a service
 * @route   DELETE /api/admin/services/:id
 * @access  Private (Admin)
 */
router.delete('/services/:id', protect('admin'), async (req, res) => {
    try {
        const service = await Service.findByIdAndDelete(req.params.id);
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        res.json({ success: true, message: 'Service deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------------- Coupon Management ------------------------- */

router.get('/coupons', protect('admin'), async (req, res) => {
    try {
        const { q = '', is_active } = req.query;
        const filter = {};

        if (is_active === 'true') filter.is_active = true;
        if (is_active === 'false') filter.is_active = false;

        const search = String(q || '').trim();
        if (search) {
            filter.$or = [
                { code: { $regex: search, $options: 'i' } },
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
            ];
        }

        const coupons = await Coupon.find(filter)
            .sort({ createdAt: -1 })
            .lean();

        res.json({ success: true, coupons });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/coupons/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid coupon id' });
        }

        const coupon = await Coupon.findById(req.params.id).lean();
        if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });

        res.json({ success: true, coupon });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/coupons', protect('admin'), async (req, res) => {
    try {
        const payload = sanitizeCouponPayload(req.body || {});

        if (!payload.code || !payload.name || !payload.discount_type || !payload.scope_type) {
            return res.status(400).json({ success: false, message: 'code, name, discount_type, and scope_type are required' });
        }

        if (!Number.isFinite(payload.discount_value) || payload.discount_value <= 0) {
            return res.status(400).json({ success: false, message: 'discount_value must be greater than 0' });
        }

        const exists = await Coupon.findOne({ code: payload.code }).lean();
        if (exists) return res.status(409).json({ success: false, message: 'Coupon code already exists' });

        const coupon = await Coupon.create(payload);
        res.status(201).json({ success: true, coupon });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/coupons/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid coupon id' });
        }

        const payload = sanitizeCouponPayload(req.body || {});

        if (!payload.code || !payload.name || !payload.discount_type || !payload.scope_type) {
            return res.status(400).json({ success: false, message: 'code, name, discount_type, and scope_type are required' });
        }

        if (!Number.isFinite(payload.discount_value) || payload.discount_value <= 0) {
            return res.status(400).json({ success: false, message: 'discount_value must be greater than 0' });
        }

        const duplicate = await Coupon.findOne({ code: payload.code, _id: { $ne: req.params.id } }).lean();
        if (duplicate) return res.status(409).json({ success: false, message: 'Coupon code already exists' });

        const coupon = await Coupon.findByIdAndUpdate(req.params.id, payload, { returnDocument: "after", runValidators: true });
        if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });

        res.json({ success: true, coupon });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/coupons/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid coupon id' });
        }

        const coupon = await Coupon.findByIdAndDelete(req.params.id);
        if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });

        res.json({ success: true, message: 'Coupon deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------------- Product Types ------------------------- */
// Broad, shopper-facing groupings of categories (models/productTypes.js). Under
// /categories so the Categories permission covers them: whoever runs the tree runs its types.

/** The type ids a category may carry: valid ids of types that exist, deduplicated. */
const categoryTypeIds = async (raw) => {
    const ids = [...new Set((Array.isArray(raw) ? raw : []).map(String).filter(isObjectId))];
    if (!ids.length) return [];
    const found = await ProductType.find({ _id: { $in: ids } }).select('_id').lean();
    const known = new Set(found.map((t) => String(t._id)));
    return ids.filter((id) => known.has(id));
};

const typePayload = (body = {}) => {
    const payload = {};
    if (body.name !== undefined) payload.name = String(body.name || '').trim();
    if (body.name_ar !== undefined) payload.name_ar = String(body.name_ar || '').trim();
    if (body.image !== undefined) payload.image = String(body.image || '').trim();
    if (body.sort_order !== undefined) payload.sort_order = Number(body.sort_order) || 0;
    if (body.is_active !== undefined) payload.is_active = Boolean(body.is_active);
    return payload;
};

router.get('/categories/types', protect('admin'), async (req, res) => {
    try {
        const types = await ProductType.find().sort({ sort_order: 1, name: 1 }).lean();
        const counts = await Category.aggregate([
            { $unwind: '$type_ids' },
            { $group: { _id: '$type_ids', count: { $sum: 1 } } },
        ]);
        const byType = new Map(counts.map((c) => [String(c._id), c.count]));
        res.json({ success: true, types: types.map((t) => ({ ...t, category_count: byType.get(String(t._id)) || 0 })) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/categories/types', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        const payload = typePayload(req.body);
        if (!payload.name) return res.status(400).json({ success: false, message: 'Type name is required' });
        const type = await ProductType.create(payload);
        res.status(201).json({ success: true, type });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/categories/types/:id', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid type id' });
        const payload = typePayload(req.body);
        if (payload.name !== undefined && !payload.name) {
            return res.status(400).json({ success: false, message: 'Type name is required' });
        }
        const type = await ProductType.findByIdAndUpdate(req.params.id, payload, { returnDocument: 'after', runValidators: true });
        if (!type) return res.status(404).json({ success: false, message: 'Type not found' });
        res.json({ success: true, type });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/categories/types/:id', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid type id' });
        const type = await ProductType.findByIdAndDelete(req.params.id);
        if (!type) return res.status(404).json({ success: false, message: 'Type not found' });
        // The categories stay; they just stop being offered under this type.
        const { modifiedCount } = await Category.updateMany({ type_ids: type._id }, { $pull: { type_ids: type._id } });
        res.json({ success: true, message: 'Type deleted', categories_updated: modifiedCount });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------------- Category Management ------------------------- */

router.get('/categories', protect('admin'), async (req, res) => {
    try {
        const categories = await Category.find().sort({ sort_order: 1, name: 1 }).lean();
        res.json({ success: true, categories, tree: mapCategoryTree(categories) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/categories', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        const { name, name_ar = '', parent_id = null, image = '', sort_order = 0, is_active = true } = req.body || {};

        if (!String(name || '').trim()) {
            return res.status(400).json({ success: false, message: 'Category name is required' });
        }

        if (parent_id && !isObjectId(parent_id)) {
            return res.status(400).json({ success: false, message: 'Invalid parent category id' });
        }

        if (parent_id) {
            const parentExists = await Category.exists({ _id: parent_id });
            if (!parentExists) return res.status(404).json({ success: false, message: 'Parent category not found' });
        }

        const category = await Category.create({
            name: String(name).trim(),
            name_ar: String(name_ar || '').trim(),
            parent_id: parent_id || null,
            image: String(image || '').trim(),
            sort_order: Number(sort_order) || 0,
            is_active: Boolean(is_active),
            type_ids: await categoryTypeIds(req.body?.type_ids),
        });

        res.status(201).json({ success: true, category });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/categories/:id', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }

        const { name, name_ar = '', parent_id = null, image = '', sort_order, is_active } = req.body || {};

        if (!String(name || '').trim()) {
            return res.status(400).json({ success: false, message: 'Category name is required' });
        }

        if (parent_id && !isObjectId(parent_id)) {
            return res.status(400).json({ success: false, message: 'Invalid parent category id' });
        }

        if (parent_id && String(parent_id) === String(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Category cannot be its own parent' });
        }

        if (parent_id) {
            const parentExists = await Category.exists({ _id: parent_id });
            if (!parentExists) return res.status(404).json({ success: false, message: 'Parent category not found' });
        }

        const updateData = {
            name: String(name).trim(),
            name_ar: String(name_ar || '').trim(),
            parent_id: parent_id || null,
            image: String(image || '').trim(),
        };

        if (sort_order !== undefined) updateData.sort_order = Number(sort_order) || 0;
        if (is_active !== undefined) updateData.is_active = Boolean(is_active);
        if (req.body?.type_ids !== undefined) updateData.type_ids = await categoryTypeIds(req.body.type_ids);

        const category = await Category.findByIdAndUpdate(
            req.params.id,
            updateData,
            { returnDocument: "after", runValidators: true }
        );

        if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

        res.json({ success: true, category });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/categories/:id', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }

        const id = toObjectId(req.params.id);

        const hasChildren = await Category.exists({ parent_id: id });
        if (hasChildren) {
            return res.status(400).json({ success: false, message: 'Cannot delete category with child categories' });
        }

        const linkedProducts = await Product.exists({ category_id: id });
        if (linkedProducts) {
            return res.status(400).json({ success: false, message: 'Cannot delete category linked to products' });
        }

        const category = await Category.findByIdAndDelete(id);
        if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

        res.json({ success: true, message: 'Category deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------------- Product Brand Management ------------------------- */

/**
 * The category ids a brand may be tagged with: valid ids that actually exist, deduplicated.
 * An id for a deleted category is dropped rather than stored, so a brand never carries a
 * tag that no filter could ever match.
 */
const brandCategoryIds = async (raw) => {
    const ids = [...new Set((Array.isArray(raw) ? raw : []).filter(Boolean).map(String).filter(isObjectId))];
    if (ids.length === 0) return [];
    const found = await Category.find({ _id: { $in: ids } }).select('_id').lean();
    return found.map((c) => c._id);
};

router.get('/product-brands', protect('admin'), async (req, res) => {
    try {
        const productBrands = await Brand.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, productBrands });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/product-brands', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        const { name, image = '', categories = [] } = req.body || {};
        if (!String(name || '').trim()) {
            return res.status(400).json({ success: false, message: 'Brand name is required' });
        }

        const normalizedName = String(name).trim().toLowerCase();
        const existing = await Brand.findOne({ name: normalizedName }).lean();
        if (existing) return res.status(409).json({ success: false, message: 'Brand already exists' });
        // Every car make is already on every brand list (brandRef.js). Typing it again would
        // put two Toyotas in the picker with two logos to keep in step.
        const asMake = await CarBrand.findOne({ name: new RegExp(`^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('name').lean();
        if (asMake) {
            return res.status(409).json({
                success: false,
                message: `"${asMake.name}" is already one of the car makes and is offered on every brand list automatically — no need to add it here. Edit it under Car Brands.`,
            });
        }

        const productBrand = await Brand.create({
            name: normalizedName,
            image: String(image || '').trim(),
            categories: await brandCategoryIds(categories),
        });
        res.status(201).json({ success: true, productBrand });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/product-brands/:id', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid brand id' });
        }

        const { name, image = '', categories } = req.body || {};
        if (!String(name || '').trim()) {
            return res.status(400).json({ success: false, message: 'Brand name is required' });
        }

        const normalizedName = String(name).trim().toLowerCase();
        const duplicate = await Brand.findOne({ name: normalizedName, _id: { $ne: req.params.id } }).lean();
        if (duplicate) return res.status(409).json({ success: false, message: 'Brand already exists' });

        const update = { name: normalizedName, image: String(image || '').trim() };
        // Only touched when sent: an older client that edits the name must not wipe the
        // categories an admin has just spent time tagging.
        if (Array.isArray(categories)) update.categories = await brandCategoryIds(categories);

        const productBrand = await Brand.findByIdAndUpdate(
            req.params.id,
            update,
            { returnDocument: "after", runValidators: true }
        );

        if (!productBrand) return res.status(404).json({ success: false, message: 'Brand not found' });

        res.json({ success: true, productBrand });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/product-brands/:id', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid brand id' });
        }

        const id = toObjectId(req.params.id);
        const linkedProducts = await Product.exists({ product_brand_id: id });
        if (linkedProducts) {
            return res.status(400).json({ success: false, message: 'Cannot delete brand linked to products' });
        }

        const productBrand = await Brand.findByIdAndDelete(id);
        if (!productBrand) return res.status(404).json({ success: false, message: 'Brand not found' });

        res.json({ success: true, message: 'Brand deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------------- Car Brand Management ------------------------- */

router.get('/car-brands', protect('admin'), async (req, res) => {
    try {
        const carBrands = await CarBrand.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, carBrands });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/car-brands', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        const { name, image = '', models = [], is_featured = false } = req.body || {};
        if (!String(name || '').trim()) {
            return res.status(400).json({ success: false, message: 'Car brand name is required' });
        }

        const existing = await CarBrand.findOne({ name: String(name).trim() }).lean();
        if (existing) return res.status(409).json({ success: false, message: 'Car brand already exists' });

        const sanitizedModels = (Array.isArray(models) ? models : []).map(model => ({
            name: String(model?.name || '').trim(),
            // The schema stores each year as a subdocument ({ year }), exactly as the
            // update route does — a bare number fails validation.
            years: (Array.isArray(model?.years) ? model.years : [])
                .map(y => Number(y?.year ?? y))
                .filter(y => Number.isInteger(y) && y > 1900)
                .map(year => ({ year })),
        })).filter(model => model.name);

        const carBrand = await CarBrand.create({
            name: String(name).trim(),
            image: String(image || '').trim(),
            models: sanitizedModels,
            is_featured: Boolean(is_featured),
        });

        // A new make is a new product brand too: let the brand-source lookup see it at once.
        require('../services/shared/brandRef').invalidateBrandRefCache();
        res.status(201).json({ success: true, carBrand });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/car-brands/:id', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid car brand id' });
        }

        const { name, image = '', models = [], is_featured } = req.body || {};
        if (!String(name || '').trim()) {
            return res.status(400).json({ success: false, message: 'Car brand name is required' });
        }

        const duplicate = await CarBrand.findOne({ name: String(name).trim(), _id: { $ne: req.params.id } }).lean();
        if (duplicate) return res.status(409).json({ success: false, message: 'Car brand already exists' });

        const sanitizedModels = (Array.isArray(models) ? models : []).map(model => ({
            _id: model?._id && isObjectId(model._id) ? model._id : new mongoose.Types.ObjectId(),
            name: String(model?.name || '').trim(),
            years: (Array.isArray(model?.years) ? model.years : [])
                .map(y => Number(y?.year ?? y))
                .filter(y => Number.isInteger(y) && y > 1900)
                .map(year => ({ year })),
        })).filter(model => model.name);

        const updateData = {
            name: String(name).trim(),
            image: String(image || '').trim(),
            models: sanitizedModels,
        };
        if (is_featured !== undefined) {
            updateData.is_featured = Boolean(is_featured);
        }

        const carBrand = await CarBrand.findByIdAndUpdate(
            req.params.id,
            updateData,
            { returnDocument: "after", runValidators: true }
        );

        if (!carBrand) return res.status(404).json({ success: false, message: 'Car brand not found' });

        res.json({ success: true, carBrand });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/car-brands/:id', protect('admin'), invalidateFiltersOnWrite, async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid car brand id' });
        }

        const carBrandId = req.params.id;
        const linkedProducts = await Product.exists({
            'compatible_cars.brand_id': toObjectId(carBrandId),
        });

        if (linkedProducts) {
            return res.status(400).json({ success: false, message: 'Cannot delete car brand linked to product compatibility' });
        }
        // A make can also be a product's BRAND (brandRef.js); deleting it would leave those
        // products and catalog entries pointing at nothing.
        const { CatalogEntry } = require('../models/catalogEntries');
        const brandedProducts = await Product.exists({ product_brand_id: toObjectId(carBrandId) });
        const brandedEntries = brandedProducts ? null : await CatalogEntry.exists({ product_brand_id: toObjectId(carBrandId) });
        if (brandedProducts || brandedEntries) {
            return res.status(400).json({ success: false, message: 'Cannot delete this car brand: products or catalog entries use it as their brand' });
        }

        const carBrand = await CarBrand.findByIdAndDelete(carBrandId);
        if (!carBrand) return res.status(404).json({ success: false, message: 'Car brand not found' });
        require('../services/shared/brandRef').invalidateBrandRefCache();

        res.json({ success: true, message: 'Car brand deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Upload branding asset (logo or favicon)
 * @route   POST /api/admin/upload/branding?type=logo|favicon
 * @access  Private (Admin)
 */
router.post('/upload/branding', protect('admin'), brandingUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const baseUrl = process.env.BACKEND_PUBLIC_URL || (req.protocol + '://' + req.get('host'));
        const url = `${baseUrl}/uploads/branding/${req.file.filename}`;
        const validTypes = ['logo', 'logo_light', 'favicon'];
        const type = validTypes.includes(req.query.type) ? req.query.type : 'logo';
        if (type !== 'favicon') await trimLogoMargins(req.file.path);

        let settings = await SiteSettings.findOne();
        if (!settings) settings = new SiteSettings();
        if (type === 'logo') settings.logo_url = url;
        else if (type === 'logo_light') settings.logo_light_url = url;
        else settings.favicon_url = url;
        await settings.save();

        res.json({ success: true, url, settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update site settings
 * @route   PUT /api/admin/settings
 * @access  Private (Admin)
 */
router.put('/settings', protect('admin'), async (req, res) => {
    try {
        const {
            currency,
            header_phone,
            footer_phones,
            footer_emails,
            contact_email,
            contact_telephone,
            contact_address,
            header_text_en,
            header_text_ar,
            footer_text_en,
            footer_text_ar,
            locations_en,
            locations_ar,

            logo_url,
            favicon_url,
            social_links,
            commission_settings,
            bundle_approval_required,
        } = req.body;

        let settings = await SiteSettings.findOne();
        if (!settings) {
            settings = new SiteSettings();
        }

        if (currency !== undefined) settings.currency = currency;
        if (header_phone !== undefined) settings.header_phone = header_phone;
        if (footer_phones !== undefined) settings.footer_phones = footer_phones;
        if (footer_emails !== undefined) settings.footer_emails = footer_emails;
        if (contact_email !== undefined) settings.contact_email = contact_email;
        if (contact_telephone !== undefined) settings.contact_telephone = contact_telephone;
        if (contact_address !== undefined) settings.contact_address = contact_address;
        if (header_text_en !== undefined) settings.header_text_en = header_text_en;
        if (header_text_ar !== undefined) settings.header_text_ar = header_text_ar;
        if (footer_text_en !== undefined) settings.footer_text_en = footer_text_en;
        if (footer_text_ar !== undefined) settings.footer_text_ar = footer_text_ar;
        if (locations_en !== undefined) settings.locations_en = locations_en;
        if (locations_ar !== undefined) settings.locations_ar = locations_ar;

        if (logo_url !== undefined) settings.logo_url = logo_url;
        if (favicon_url !== undefined) settings.favicon_url = favicon_url;
        if (social_links !== undefined) settings.social_links = social_links;
        if (commission_settings !== undefined) settings.commission_settings = commission_settings;
        if (bundle_approval_required !== undefined) settings.bundle_approval_required = bundle_approval_required;

        await settings.save();
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get contact inquiries
 * @route   GET /api/admin/contact-inquiries
 * @access  Private (Admin)
 */
router.get('/contact-inquiries', protect('admin'), async (req, res) => {
    try {
        const { status, q = '', page = 1, limit = 20 } = req.query;
        const filter = {};

        if (status) filter.status = status;

        const search = String(q).trim();
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { subject: { $regex: search, $options: 'i' } },
                { message: { $regex: search, $options: 'i' } },
            ];
        }

        const normalizedLimit = Number(limit) || 20;
        const total = await ContactInquiry.countDocuments(filter);
        const inquiries = await paginate(
            ContactInquiry.find(filter).sort({ createdAt: -1 }),
            page,
            normalizedLimit
        ).lean();

        res.json({
            success: true,
            inquiries,
            pagination: {
                total,
                page: Number(page),
                pages: Math.ceil(total / normalizedLimit),
                limit: normalizedLimit,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get contact inquiry by ID
 * @route   GET /api/admin/contact-inquiries/:id
 * @access  Private (Admin)
 */
router.get('/contact-inquiries/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid inquiry ID' });
        }

        const inquiry = await ContactInquiry.findById(req.params.id).lean();
        if (!inquiry) {
            return res.status(404).json({ success: false, message: 'Inquiry not found' });
        }

        res.json({ success: true, inquiry });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update contact inquiry status/note
 * @route   PUT /api/admin/contact-inquiries/:id
 * @access  Private (Admin)
 */
router.put('/contact-inquiries/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid inquiry ID' });
        }

        const { status, admin_note } = req.body;
        const updateFields = {};

        if (status !== undefined) {
            if (!['new', 'read', 'archived'].includes(status)) {
                return res.status(400).json({ success: false, message: 'Invalid status value' });
            }
            updateFields.status = status;
        }

        if (admin_note !== undefined) updateFields.admin_note = admin_note;

        const inquiry = await ContactInquiry.findByIdAndUpdate(
            req.params.id,
            updateFields,
            { returnDocument: "after", runValidators: true }
        ).lean();

        if (!inquiry) {
            return res.status(404).json({ success: false, message: 'Inquiry not found' });
        }

        res.json({ success: true, inquiry });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------------- Orders Management ------------------------- */

/**
 * @desc    Get all orders (admin)
 * @route   GET /api/admin/orders
 * @access  Private (Admin)
 */
router.get('/orders', protect('admin'), async (req, res) => {
    try {
        const result = await getAllOrders(req.query);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get vendors list for filter dropdown
 * @route   GET /api/admin/orders/vendors
 * @access  Private (Admin)
 */
router.get('/orders/vendors', protect('admin'), async (req, res) => {
    try {
        const vendors = await getVendorsForFilter();
        res.json({ success: true, vendors });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get a single order by ID (admin)
 * @route   GET /api/admin/orders/:id
 * @access  Private (Admin)
 */
router.get('/orders/:id', protect('admin'), async (req, res) => {
    try {
        const order = await getOrderById(req.params.id);
        res.json({ success: true, order });
    } catch (err) {
        res.status(404).json({ success: false, message: err.message });
    }
});

/**
 * @desc    How reliable is this order's customer — our record, and Bosta's ranking
 * @route   GET /api/admin/orders/:id/cod-profile
 * @access  Private (Admin)
 *
 * Its own endpoint rather than part of the order payload because it can call Bosta, and the
 * order screen must render instantly whether or not a third party answers. `?refresh=true`
 * re-reads Bosta instead of using the cached ranking.
 */
router.get('/orders/:id/cod-profile', protect('admin'), async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).select('user_id shipping_address').lean();
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const profile = await require('../services/codEligibilityService').evaluate({
            userId: order.user_id || null,
            phone: order.shipping_address?.phone || '',
            force: req.query.refresh === 'true',
        });
        res.json({ success: true, profile });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Force cash on delivery open or shut for one customer, or hand them back to the rules
 * @route   PUT /api/admin/users/:id/cod-override
 * @access  Private (Admin)
 */
router.put('/users/:id/cod-override', protect('admin'), async (req, res) => {
    try {
        const { override = null, reason = '' } = req.body || {};
        const profile = await require('../services/codEligibilityService').setOverride(req.params.id, {
            override: override || null,
            reason,
            adminLabel: req.user?.username || 'Admin',
        });
        res.json({ success: true, profile });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Record the outcome of ringing a customer whose WhatsApp confirmation failed.
 *          Outcomes: confirmed | no_answer | refused. Nothing else about the order moves —
 *          by now a parcel may be packed and a courier booked, so cancelling on `refused`
 *          stays a separate, explicit admin decision.
 * @route   POST /api/admin/orders/:id/customer-confirmation
 * @access  Private (Admin)
 */
router.post('/orders/:id/customer-confirmation', protect('admin'), async (req, res) => {
    try {
        await recordCustomerConfirmationCall(req.params.id, {
            outcome: req.body?.outcome,
            note: req.body?.note || '',
            actor: getAdminActor(req),
        });
        // Re-read through the normal path so the client gets the same populated shape the
        // order screen already renders.
        const order = await getOrderById(req.params.id);
        res.json({ success: true, order });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get vendor locations for an order (for admin to pick fulfillment address)
 * @route   GET /api/admin/orders/:id/vendor-locations
 * @access  Private (Admin)
 */
router.get('/orders/:id/vendor-locations', protect('admin'), async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).lean();
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const vendorIds = [...new Set((order.vendor_supervisions || []).map(vs => vs.vendor_id.toString()))];
        const vendors = await Seller.find({ _id: { $in: vendorIds } }).select('_id store_name store_username locations').lean();

        const result = vendors.map(v => ({
            vendor_id: v._id,
            store_name: v.store_name || v.store_username,
            locations: v.locations || [],
        }));

        res.json({ success: true, vendor_locations: result });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update order status (admin override)
 * @route   PUT /api/admin/orders/:id/status
 * @access  Private (Admin)
 */
router.put('/orders/:id/status', protect('admin'), async (req, res) => {
    try {
        const { status } = req.body;

        // "ready" is the bulk action: send every parcel that is ready to go, and report
        // the rest rather than failing. Parcels not ready are `skipped` with a reason —
        // one vendor still reviewing no longer blocks a vendor who finished yesterday.
        if (status === 'ready') {
            const { dispatched, failures, skipped } = await sendOrderToBosta(req.params.id, getAdminActor(req));
            const populated = await getOrderById(req.params.id);
            return res.json({
                success: true,
                order: populated,
                bosta_sent: dispatched.length > 0,
                dispatched,
                failures,
                skipped,
            });
        }

        await updateOrderStatus(req.params.id, status, getAdminActor(req));
        const order = await getOrderById(req.params.id);
        res.json({ success: true, order });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/* ================================================================== */
/*  SUB-ORDERS (parcels)                                              */
/* ================================================================== */

const subOrderFlowService = require('../services/subOrderFlowService');
const subOrderCore = require('../services/subOrderService');

const subOrderError = (res, err) =>
    res.status(err.status || 400).json({
        success: false,
        code: err.code || 'SUB_ORDER_ERROR',
        message: err.message,
    });

/**
 * @desc    Every parcel waiting on the website team, across all orders — the single queue an
 *          admin works from. Declines, overdue vendors, exceptions and open cancellation
 *          requests all land here with the reason attached.
 * @route   GET /api/admin/sub-orders/attention
 * @access  Private (Admin)
 */
router.get('/sub-orders/attention', protect('admin'), async (req, res) => {
    try {
        const orders = await Order.find({
            $or: [
                { 'sub_orders.status': { $in: ['needs_admin', 'exception'] } },
                { 'sub_orders.is_overdue': true },
                { 'sub_orders.cancel_request.requested_at': { $ne: null } },
                { 'sub_orders.dispatch_attempt.at': { $ne: null } },
                { 'sub_orders.courier_cancel_pending.at': { $ne: null }, 'sub_orders.courier_cancel_pending.done_at': null },
            ],
        })
            .sort({ created_at: 1 })
            .limit(200)
            .populate('user_id', 'name phone')
            .lean();

        const vendorIds = new Set();
        for (const o of orders) for (const s of o.sub_orders || []) vendorIds.add(String(s.vendor_id));
        const vendors = await Seller.find({ _id: { $in: [...vendorIds] } })
            .select('store_name store_username phone')
            .lean();
        const vendorMap = new Map(vendors.map((v) => [v._id.toString(), v]));

        const rows = [];
        for (const order of orders) {
            for (const sub of order.sub_orders || []) {
                const manualCancel = !!(sub.courier_cancel_pending?.at && !sub.courier_cancel_pending?.done_at);
                // A cancelled parcel only stays in the queue while the courier still has to be
                // told about it by hand.
                if (sub.status === 'cancelled' && !manualCancel) continue;

                // Every distinct reason a parcel can be sitting here, so the queue can be
                // filtered and the admin knows what they are walking into.
                const reasons = [];
                if (manualCancel) reasons.push('courier_cancel_pending');
                if (sub.status === 'needs_admin') reasons.push('declined_items');
                if (sub.status === 'exception') reasons.push('delivery_exception');
                if (sub.is_overdue) reasons.push('overdue');
                if (sub.cancel_request?.requested_at) reasons.push('cancellation_requested');
                if (sub.dispatch_attempt?.at && sub.status !== 'cancelled') reasons.push('dispatch_uncertain');
                if (sub.status === 'cancelled') { if (!manualCancel) continue; }
                if (reasons.length === 0) continue;

                const vendor = vendorMap.get(String(sub.vendor_id));
                rows.push({
                    ...subOrderCore.toPublicSubOrder(order, sub, { audience: 'admin', vendor }),
                    order_id: order._id,
                    order_reference: order.transaction?.reference || order._id.toString(),
                    order_created_at: order.created_at,
                    customer_name: order.user_id?.name || order.shipping_address?.recipient_name || '-',
                    customer_phone: order.user_id?.phone || order.shipping_address?.phone || '-',
                    vendor_phone: vendor?.phone || null,
                    reasons,
                });
            }
        }

        res.json({ success: true, sub_orders: rows, total: rows.length });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Send this one parcel to Bosta (admin rescue for a vendor who cannot act)
 * @route   POST /api/admin/orders/:id/sub-orders/:subOrderId/dispatch
 * @access  Private (Admin)
 */
router.post('/orders/:id/sub-orders/:subOrderId/dispatch', protect('admin'), async (req, res) => {
    try {
        const { order, sub } = await subOrderFlowService.loadSubOrder(req.params.id, req.params.subOrderId);
        const couriers = require('../services/couriers');
        const provider = await couriers.courierFor(sub);
        const smartLabelEnabled = couriers.smartLabelApplies(provider, await smartLabelService.isEnabled().catch(() => false));
        const reservation = provider === 'bosta' ? await smartLabelService.reservationFor(order._id, sub.vendor_id) : null;

        // Without a scanned sticker the shipment is still created — the courier mints the
        // number and the waybill is printed from the shipment card. One parcel, on purpose;
        // the bulk send still skips unlabelled parcels.
        const blocked = bostaFulfillment.dispatchBlockedReason(order, sub, smartLabelEnabled, !!reservation, { allowWithoutLabel: true, provider });
        if (blocked) return res.status(400).json({ success: false, message: `Cannot send this parcel — ${blocked}.` });

        const actor = getAdminActor(req);
        const { stickerError } = await bostaFulfillment.dispatchSubOrder(order, sub, {
            trackingNumber: reservation?.tracking_number || null,
            actor,
        });
        sub.items_confirmed_at = sub.items_confirmed_at || new Date();
        sub.tracking_assigned_at = new Date();
        if (stickerError) {
            // Delivery created, sticker refused. The parcel goes back to the vendor's label
            // step (scan another sticker, or print the waybill) and the sticker is released.
            // The order is still saved below — the delivery is live at the courier.
            sub.status = 'awaiting_tracking';
            if (reservation) {
                await smartLabelService.releaseReservations(order, {
                    vendorId: sub.vendor_id, reason: stickerError, actor,
                }).catch(() => {});
            }
        } else {
            sub.status = 'awaiting_handover';
            if (reservation) await smartLabelService.markDispatched(reservation._id);
        }
        if (smartLabelEnabled && !reservation) {
            subOrderCore.appendSubHistory(
                sub, 'sub_order_shipment_created', 'Shipment created',
                `${couriers.labelOf(sub.courier || provider)} issued tracking ${couriers.trackingNumberOf(sub)}. Print the waybill and stick it on the parcel.`,
                { tracking_number: couriers.trackingNumberOf(sub), printed_waybill: true, courier: sub.courier || provider }, actor
            );
        }

        subOrderCore.syncOrderStatus(order, getAdminActor(req).label);
        try {
            await order.save();
        } catch (saveErr) {
            // dispatchSubOrder already persisted the live waybill under the courier lock.
            // Only the vendor stage failed to save; cancelling here would invalidate that
            // durable tracking record and make a harmless retry destructive.
            return res.status(500).json({
                success: false,
                message: `Shipment ${couriers.trackingNumberOf(sub)} was created and recorded, but its preparation stage could not be saved (${saveErr.message}). Refresh the order and continue preparing this shipment.`,
            });
        }

        const populated = await getOrderById(req.params.id);
        res.json({ success: true, order: populated, sticker_error: stickerError || null });
    } catch (err) {
        subOrderError(res, err);
    }
});

/**
 * @desc    Move a parcel that already has a shipment past the label stage. The vendor's
 *          "It is attached — continue" button, from the admin side: a parcel whose vendor
 *          created the printed waybill but never pressed continue used to sit at stage ②
 *          with nothing an admin could press. Optionally links a Smart Sticker on the way
 *          (tracking_number), exactly as the vendor route does — never required.
 * @route   POST /api/admin/orders/:id/sub-orders/:subOrderId/tracking
 * @access  Private (Admin)
 */
router.post('/orders/:id/sub-orders/:subOrderId/tracking', protect('admin'), async (req, res) => {
    try {
        await subOrderFlowService.assignTracking({
            orderId: req.params.id,
            subOrderId: req.params.subOrderId,
            trackingNumber: req.body?.tracking_number || null,
            actor: getAdminActor(req),
        });
        const populated = await getOrderById(req.params.id);
        res.json({ success: true, order: populated });
    } catch (err) {
        subOrderError(res, err);
    }
});

/**
 * @desc    Mark a parcel sealed and ready for pickup on the vendor's behalf — the vendor's
 *          stage ③ button from the admin side. Only from here does the parcel appear as
 *          bookable on the Pickups screen; until then it is counted as "still packing".
 * @route   POST /api/admin/orders/:id/sub-orders/:subOrderId/ready
 * @access  Private (Admin)
 */
router.post('/orders/:id/sub-orders/:subOrderId/ready', protect('admin'), async (req, res) => {
    try {
        await subOrderFlowService.markReadyForPickup({
            orderId: req.params.id,
            subOrderId: req.params.subOrderId,
            actor: getAdminActor(req),
        });
        const populated = await getOrderById(req.params.id);
        res.json({ success: true, order: populated });
    } catch (err) {
        subOrderError(res, err);
    }
});

/**
 * @desc    Hand a parked parcel back to its vendor once the declined items are dealt with
 * @route   POST /api/admin/orders/:id/sub-orders/:subOrderId/release
 * @access  Private (Admin)
 */
router.post('/orders/:id/sub-orders/:subOrderId/release', protect('admin'), async (req, res) => {
    try {
        await subOrderFlowService.releaseIntervention({
            orderId: req.params.id,
            subOrderId: req.params.subOrderId,
            note: req.body.note || '',
            actor: getAdminActor(req),
        });
        const populated = await getOrderById(req.params.id);
        res.json({ success: true, order: populated });
    } catch (err) {
        subOrderError(res, err);
    }
});

/**
 * @desc    Cancel one parcel — refunds its own frozen share, returns its points, and
 *          terminates its Bosta delivery. Its siblings are untouched.
 * @route   POST /api/admin/orders/:id/sub-orders/:subOrderId/cancel
 * @access  Private (Admin)
 */
router.post('/orders/:id/sub-orders/:subOrderId/cancel', protect('admin'), async (req, res) => {
    try {
        const result = await subOrderFlowService.cancelSubOrder({
            orderId: req.params.id,
            subOrderId: req.params.subOrderId,
            reason: req.body.reason || 'Cancelled by the website team',
            actor: getAdminActor(req),
            byRole: 'admin',
            // An admin's authority extends past the customer's and vendor's cancel window;
            // a booked pickup becomes a phone call to Bosta, not a refusal.
            skipWindowCheck: true,
        });
        const populated = await getOrderById(req.params.id);
        res.json({
            success: true,
            order: populated,
            refunded: result.refunded,
            points_restored: result.points_restored,
            stranded_tracking: result.stranded_tracking,
            stranded_courier: result.stranded_courier || null,
        });
    } catch (err) {
        subOrderError(res, err);
    }
});

/* ================================================================== */
/*  COURIERS — default switch, per-parcel choice, Arrive areas          */
/* ================================================================== */

const couriersMod = require('../services/couriers');

const arriveWebhookUrl = () => {
    const base = (process.env.PUBLIC_API_URL || `${(process.env.FRONTEND_URL || 'https://readymarine.store').replace(/\/+$/, '')}/api`).replace(/\/+$/, '');
    const secret = process.env.ARRIVE_WEBHOOK_SECRET || '';
    return `${base}/webhooks/arrive/${secret}`;
};

/**
 * @desc    What couriers exist, which is the default, and whether each is ready to use.
 * @route   GET /api/admin/couriers
 * @access  Private (Admin)
 */
router.get('/couriers', protect('admin'), async (req, res) => {
    try {
        const { ArriveSector } = require('../models/arriveSectors');
        const arriveClient = require('../services/couriers/arrive/client');
        const [def, sectorsCount, lastSync] = await Promise.all([
            couriersMod.getDefaultCourier(),
            ArriveSector.estimatedDocumentCount(),
            ArriveSector.findOne().sort({ synced_at: -1 }).select('synced_at').lean(),
        ]);
        res.json({
            success: true,
            default: def,
            providers: couriersMod.PROVIDERS.map((key) => ({
                key,
                label: couriersMod.labelOf(key),
                label_ar: couriersMod.labelOf(key, true),
                capabilities: couriersMod.capabilities(key),
                configured: key === 'arrive' ? arriveClient.isConfigured() : !!process.env.BOSTA_API_KEY,
            })),
            arrive: {
                configured: arriveClient.isConfigured(),
                webhook_url: arriveWebhookUrl(),
                sectors_count: sectorsCount,
                sectors_synced_at: lastSync?.synced_at || null,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Pull Arrive's delivery-area list again.
 * @route   POST /api/admin/couriers/arrive/sectors/sync
 * @access  Private (Admin)
 */
router.post('/couriers/arrive/sectors/sync', protect('admin'), async (req, res) => {
    try {
        const result = await require('../services/couriers/arrive/sectors').syncSectors({ actor: getAdminActor(req) });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Search Arrive delivery areas for the parcel picker.
 * @route   GET /api/admin/couriers/arrive/sectors?q=
 * @access  Private (Admin)
 */
router.get('/couriers/arrive/sectors', protect('admin'), async (req, res) => {
    try {
        const rows = await require('../services/couriers/arrive/sectors').searchSectors(req.query.q || '', { limit: Math.min(50, Number(req.query.limit) || 25) });
        res.json({ success: true, sectors: rows.map((s) => ({ id: s.sector_id, name: s.name, group: s.gov_name, serviceable: s.serviceable !== false })) });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Choose the courier for one parcel (and, for Arrive, its delivery area). Allowed
 *          until a shipment exists. `courier: null` returns the parcel to the default.
 *          When Arrive is chosen without an area, the address is matched and a confident
 *          match is applied; otherwise the candidates come back for the admin to pick.
 * @route   PUT /api/admin/orders/:id/sub-orders/:subOrderId/courier
 * @access  Private (Admin)
 */
router.post('/orders/:id/sub-orders/:subOrderId/transfer-courier', protect('admin'), async (req, res) => {
    try {
        const { order, sub } = await subOrderFlowService.loadSubOrder(req.params.id, req.params.subOrderId);
        const result = await require('../services/couriers/transfer').transfer({
            order, sub, target: req.body.courier, sectorId: req.body.sector_id,
            removedTracking: req.body.removed_tracking, actor: getAdminActor(req),
        });
        res.json({ success: true, ...result, order: await getOrderById(req.params.id) });
    } catch (err) {
        subOrderError(res, err);
    }
});

router.put('/orders/:id/sub-orders/:subOrderId/courier', protect('admin'), async (req, res) => {
    try {
        const { order, sub } = await subOrderFlowService.loadSubOrder(req.params.id, req.params.subOrderId);
        if (order.courier_operation || sub.courier_transfer || sub.dispatch_attempt?.at) {
            return res.status(409).json({ success: false, message: 'Finish the pending courier operation before changing the courier.' });
        }
        if (sub.status === 'cancelled') return res.status(400).json({ success: false, message: 'This parcel is cancelled' });
        if (couriersMod.trackingNumberOf(sub)) {
            return res.status(400).json({ success: false, message: `This parcel is already with ${couriersMod.labelOf(sub.courier)} and cannot change courier` });
        }
        const courier = req.body.courier === null || req.body.courier === '' ? null : req.body.courier;
        if (courier !== null && !couriersMod.isProvider(courier)) return res.status(400).json({ success: false, message: `Unknown courier "${courier}"` });
        if (courier === 'arrive' && !require('../services/couriers/arrive/client').isConfigured()) {
            return res.status(400).json({ success: false, message: 'Arrive is not configured on this server' });
        }
        const actor = getAdminActor(req);
        const before = sub.courier || null;
        sub.courier = courier;

        let suggestion = null;
        const sectors = require('../services/couriers/arrive/sectors');
        if (courier === 'arrive') {
            if (req.body.sector_id !== undefined && req.body.sector_id !== null && req.body.sector_id !== '') {
                const sector = await sectors.getSector(req.body.sector_id);
                if (!sector) return res.status(400).json({ success: false, message: 'Unknown Arrive area' });
                if (sector.serviceable === false) return res.status(400).json({ success: false, message: `Arrive does not deliver to "${sector.name}"` });
                sub.courier_sector_id = sector.sector_id;
                sub.courier_sector_name = sector.name;
            } else if (!sub.courier_sector_id) {
                suggestion = await sectors.suggestSector({ address: order.shipping_address?.full_address || '', city: order.shipping?.destination?.city || '' });
                if (suggestion.sector && suggestion.confidence === 'high') {
                    sub.courier_sector_id = suggestion.sector.sector_id;
                    sub.courier_sector_name = suggestion.sector.name;
                }
            }
        } else {
            sub.courier_sector_id = null;
            sub.courier_sector_name = '';
        }

        subOrderCore.appendSubHistory(
            sub, 'courier_changed', 'Courier set',
            `${before ? couriersMod.labelOf(before) : 'Default'} → ${courier ? couriersMod.labelOf(courier) : 'Default'}${sub.courier_sector_name ? ` (${sub.courier_sector_name})` : ''}`,
            { from: before, to: courier, sector_id: sub.courier_sector_id || null }, actor
        );
        await order.save();
        const populated = await getOrderById(req.params.id);
        res.json({
            success: true,
            order: populated,
            courier: sub.courier,
            sector: sub.courier_sector_id ? { id: sub.courier_sector_id, name: sub.courier_sector_name } : null,
            suggestion: suggestion ? {
                confidence: suggestion.confidence,
                candidates: suggestion.candidates.map((s) => ({ id: s.sector_id, name: s.name, group: s.gov_name })),
            } : null,
        });
    } catch (err) {
        subOrderError(res, err);
    }
});

/**
 * @desc    Resolve a send whose outcome was unknown (timeout mid-create). Either the admin
 *          found the shipment in the courier portal and enters its waybill, which is then
 *          attached to the parcel, or nothing was created and the attempt is cleared.
 * @route   POST /api/admin/orders/:id/sub-orders/:subOrderId/resolve-dispatch
 * @access  Private (Admin)
 */
router.post('/orders/:id/sub-orders/:subOrderId/resolve-dispatch', protect('admin'), async (req, res) => {
    try {
        const { order, sub } = await subOrderFlowService.loadSubOrder(req.params.id, req.params.subOrderId);
        if (!sub.dispatch_attempt?.at) return res.status(400).json({ success: false, message: 'This parcel has no unresolved send' });
        const actor = getAdminActor(req);
        const waybill = String(req.body.tracking_number || '').trim();
        if (waybill) {
            await bostaFulfillment.attachArriveShipment(order, sub, { waybill, actor });
            sub.status = 'awaiting_handover';
            sub.items_confirmed_at = sub.items_confirmed_at || new Date();
            sub.tracking_assigned_at = new Date();
        } else {
            sub.dispatch_attempt = { provider: null, reference: null, at: null };
            subOrderCore.appendSubHistory(sub, 'dispatch_attempt_cleared', 'Unfinished send cleared',
                'The admin confirmed no shipment exists at the courier for the previous attempt.', {}, actor);
        }
        subOrderCore.syncOrderStatus(order, actor.label);
        await order.save();
        const populated = await getOrderById(req.params.id);
        res.json({ success: true, order: populated });
    } catch (err) {
        subOrderError(res, err);
    }
});

/**
 * @desc    The admin confirms they cancelled the waybill in the courier's own portal, which
 *          takes the parcel out of the attention queue.
 * @route   POST /api/admin/orders/:id/sub-orders/:subOrderId/courier-cancel-done
 * @access  Private (Admin)
 */
router.post('/orders/:id/sub-orders/:subOrderId/courier-cancel-done', protect('admin'), async (req, res) => {
    try {
        const { order, sub } = await subOrderFlowService.loadSubOrder(req.params.id, req.params.subOrderId);
        if (!sub.courier_cancel_pending?.at || sub.courier_cancel_pending.done_at) {
            return res.status(400).json({ success: false, message: 'Nothing is waiting to be cancelled at the courier for this parcel' });
        }
        const actor = getAdminActor(req);
        sub.courier_cancel_pending.done_at = new Date();
        sub.courier_cancel_pending.done_by_label = actor.label;
        subOrderCore.appendSubHistory(sub, 'courier_cancel_done', 'Cancelled at the courier',
            `${actor.label} confirmed waybill ${sub.courier_cancel_pending.tracking_number} was cancelled at ${couriersMod.labelOf(sub.courier_cancel_pending.provider)}.`,
            { tracking_number: sub.courier_cancel_pending.tracking_number, provider: sub.courier_cancel_pending.provider }, actor);
        await order.save();
        const populated = await getOrderById(req.params.id);
        res.json({ success: true, order: populated });
    } catch (err) {
        subOrderError(res, err);
    }
});

/**
 * @desc    Reverse a parcel's cancellation. Charges the refund back to the wallet, takes
 *          back the returned points, restores a dropped coupon, retires the terminated
 *          Bosta delivery and puts the parcel back in the vendor's hands so a new delivery
 *          is created on the next dispatch. Refuses if the customer no longer has the
 *          money or points — reinstating a parcel never creates debt.
 * @route   POST /api/admin/orders/:id/sub-orders/:subOrderId/reactivate
 * @access  Private (Admin)
 */
router.post('/orders/:id/sub-orders/:subOrderId/reactivate', protect('admin'), async (req, res) => {
    try {
        const result = await subOrderFlowService.reactivateSubOrder({
            orderId: req.params.id,
            subOrderId: req.params.subOrderId,
            reason: req.body.reason,
            actor: getAdminActor(req),
        });
        const populated = await getOrderById(req.params.id);
        res.json({
            success: true,
            order: populated,
            restored_status: result.restored_status,
            recharged: result.recharged,
            points_reconsumed: result.points_reconsumed,
            coupon_restored: result.coupon_restored,
            previous_tracking: result.previous_tracking,
            stranded_tracking: result.stranded_tracking,
            stranded_courier: result.stranded_courier || null,
        });
    } catch (err) {
        subOrderError(res, err);
    }
});

/**
 * @desc    Reverse a whole-order cancellation: every cancelled parcel is reinstated through
 *          the per-parcel path. Parcels that cannot be reinstated are reported, the rest
 *          still come back.
 * @route   POST /api/admin/orders/:id/reactivate
 * @access  Private (Admin)
 */
router.post('/orders/:id/reactivate', protect('admin'), async (req, res) => {
    try {
        const { reactivated, failures } = await reactivateWholeOrder(req.params.id, {
            reason: req.body.reason,
            actor: getAdminActor(req),
        });
        const populated = await getOrderById(req.params.id);
        res.status(failures.length && !reactivated.length ? 400 : 200).json({
            success: reactivated.length > 0,
            order: populated,
            reactivated,
            failures,
            message: failures.length
                ? `${reactivated.length} parcel(s) reinstated, ${failures.length} could not be: ${failures.map((f) => f.message).join('; ')}`
                : `${reactivated.length} parcel(s) reinstated.`,
        });
    } catch (err) {
        res.status(err.status || 400).json({ success: false, code: err.code || 'REACTIVATE_FAILED', message: err.message });
    }
});

/**
 * @desc    Close a parcel by hand when Bosta has stopped moving it. Narrow by design —
 *          delivered / returned / cancelled only, always with a written reason.
 * @route   PUT /api/admin/orders/:id/sub-orders/:subOrderId/status
 * @access  Private (Admin)
 */
router.put('/orders/:id/sub-orders/:subOrderId/status', protect('admin'), async (req, res) => {
    try {
        await subOrderFlowService.adminCloseSubOrder({
            orderId: req.params.id,
            subOrderId: req.params.subOrderId,
            status: req.body.status,
            reason: req.body.reason,
            actor: getAdminActor(req),
        });
        const populated = await getOrderById(req.params.id);
        res.json({ success: true, order: populated });
    } catch (err) {
        subOrderError(res, err);
    }
});

/**
 * @desc    Scan a smart label onto a vendor's shipment (admin rescue — a vendor who
 *          cannot scan, or a correction on their behalf)
 * @route   POST /api/admin/orders/:id/smart-labels
 * @access  Private (Admin)
 */
router.post('/orders/:id/smart-labels', protect('admin'), async (req, res) => {
    try {
        const { vendor_id, tracking_number } = req.body;
        if (!vendor_id) return res.status(400).json({ success: false, message: 'vendor_id is required' });

        const label = await smartLabelService.scanLabel({
            orderId: req.params.id,
            vendorId: vendor_id,
            trackingNumber: tracking_number,
            actor: getAdminActor(req),
        });
        res.json({ success: true, smart_label: label });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Release a vendor's scanned label
 * @route   DELETE /api/admin/orders/:id/smart-labels/:vendorId
 * @access  Private (Admin)
 */
router.delete('/orders/:id/smart-labels/:vendorId', protect('admin'), async (req, res) => {
    try {
        const result = await smartLabelService.unlinkLabel({
            orderId: req.params.id,
            vendorId: req.params.vendorId,
            actor: getAdminActor(req),
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update individual item statuses/notes on an order (admin override)
 * @route   PUT /api/admin/orders/:id/items
 * @access  Private (Admin)
 */
router.put('/orders/:id/items', protect('admin'), async (req, res) => {
    try {
        const { items, fulfillment_locations } = req.body;
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }
        await updateOrderItems(req.params.id, items, getAdminActor(req), fulfillment_locations || null);
        const order = await getOrderById(req.params.id);
        res.json({ success: true, order });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Replace an order item with an alternative product
 * @route   PUT /api/admin/orders/:id/items/:itemId/replace
 * @access  Private (Admin)
 */
router.put('/orders/:id/items/:itemId/replace', protect('admin'), async (req, res) => {
    try {
        await replaceOrderItem(req.params.id, req.params.itemId, req.body, getAdminActor(req));
        const order = await getOrderById(req.params.id);
        res.json({ success: true, order });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Delete a declined order item
 * @route   DELETE /api/admin/orders/:id/items/:itemId
 * @access  Private (Admin)
 */
router.delete('/orders/:id/items/:itemId', protect('admin'), async (req, res) => {
    try {
        await deleteOrderItem(req.params.id, req.params.itemId, getAdminActor(req));
        const order = await getOrderById(req.params.id);
        res.json({ success: true, order });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Lock order for fulfillment (admin confirms with user)
 * @route   POST /api/admin/orders/:id/lock
 * @access  Private (Admin)
 */
router.post('/orders/:id/lock', protect('admin'), async (req, res) => {
    try {
        await lockOrderForFulfillment(req.params.id, getAdminActor(req));
        const order = await getOrderById(req.params.id);
        res.json({ success: true, order });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Delete an order
 * @route   DELETE /api/admin/orders/:id
 * @access  Private (Admin)
 */
router.delete('/orders/:id', protect('admin'), async (req, res) => {
    try {
        // `?courier=1`: also cancel the order's shipments at the courier first.
        const cancelAtCourier = ['1', 'true', 'yes'].includes(String(req.query.courier || req.body?.courier || '').toLowerCase());
        const order = await deleteOrder(req.params.id, { cancelAtCourier });
        res.json({ success: true, message: 'Order deleted successfully', courier_results: order.courier_results || [] });
    } catch (err) {
        res.status(404).json({ success: false, message: err.message });
    }
});

/* ------------------------- Bosta / Fulfillment Helpers ------------------------- */

/**
 * @desc    Update fulfillment locations per vendor before sending to Bosta
 * @route   PUT /api/admin/orders/:id/fulfillment-locations
 * @access  Private (Admin)
 */
router.put('/orders/:id/fulfillment-locations', protect('admin'), async (req, res) => {
    try {
        const { locations } = req.body; // [{ vendor_id, fulfillment_location }]
        if (!Array.isArray(locations)) {
            return res.status(400).json({ success: false, message: 'locations must be an array' });
        }
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        for (const loc of locations) {
            const vs = order.vendor_supervisions.find(
                (v) => v.vendor_id.toString() === loc.vendor_id
            );
            if (vs) {
                vs.fulfillment_location = loc.fulfillment_location;
            }
        }
        await order.save();
        const populated = await getOrderById(req.params.id);
        res.json({ success: true, order: populated });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Refresh tracking data for an order's shipments from Bosta
 * @route   POST /api/admin/orders/:id/refresh-tracking
 * @access  Private (Admin)
 */
router.post('/orders/:id/refresh-tracking', protect('admin'), async (req, res) => {
    try {
        await refreshOrderTracking(req.params.id);
        const order = await getOrderById(req.params.id);
        res.json({ success: true, order });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get AWB (airway bill) for a shipment
 * @route   GET /api/admin/orders/:id/shipments/:shipmentId/awb
 * @access  Private (Admin)
 */
router.get('/orders/:id/shipments/:shipmentId/awb', protect('admin'), async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const shipment = order.shipments.id(req.params.shipmentId);
        if (!shipment) return res.status(404).json({ success: false, message: 'Shipment not found' });
        if (!shipment.tracking_number && !shipment.bosta_delivery_id) {
            return res.status(400).json({ success: false, message: 'Shipment has no courier reference yet' });
        }
        const sub = (order.sub_orders || []).find((s) => s._id.toString() === shipment.sub_order_id?.toString())
            || { _id: null, vendor_id: shipment.vendor_id, reference: '' };

        // Bosta hands back its PDF; an Arrive label is rendered here as a printable page.
        const label = await require('../services/couriers/labels').labelForShipment(order, sub, shipment);
        res.setHeader('Content-Type', label.contentType);
        res.setHeader('Content-Disposition', `inline; filename="${label.filename}"`);
        res.send(label.body);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/* ------------------------- Bosta Pickup Management ------------------------- */

const { BostaPickup, LIVE_PICKUP_STATUSES } = require('../models/bostaPickups');

/**
 * @desc    List all Bosta pickup locations (v2)
 * @route   GET /api/admin/bosta/locations
 * @access  Private (Admin)
 */
router.get('/bosta/locations', protect('admin'), async (req, res) => {
    try {
        const locations = await bostaService.listPickupLocations();
        res.json({ success: true, locations });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    List pickups with optional filters
 * @route   GET /api/admin/bosta/pickups?date=YYYY-MM-DD&vendor_id=
 * @access  Private (Admin)
 */
router.get('/bosta/pickups', protect('admin'), async (req, res) => {
    try {
        const filter = {};
        if (req.query.date) filter.scheduled_date = req.query.date;
        if (req.query.vendor_id) filter.vendor_id = req.query.vendor_id;
        if (req.query.status) filter.status = req.query.status;

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [pickups, total] = await Promise.all([
            BostaPickup.find(filter).sort({ scheduled_date: -1, created_at: -1 }).skip(skip).limit(limit).lean(),
            BostaPickup.countDocuments(filter),
        ]);
        res.json({ success: true, pickups, total, page, limit });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Pickup summary: per-location stats for a given date
 * @route   GET /api/admin/bosta/pickup-summary?date=YYYY-MM-DD
 * @access  Private (Admin)
 */
router.get('/bosta/pickup-summary', protect('admin'), async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];

        // Parcels still on the vendor's side of the flow — shown as "still packing" so the
        // admin can see what is coming rather than assume a branch is done.
        const NOT_READY_STATUSES = ['pending_review', 'awaiting_tracking', 'awaiting_handover', 'needs_admin'];

        // Driven by the PARCELS, not by the vendor list.
        //
        // Walking every linked branch and asking "which parcels match this address?" built
        // 91 rows of which 90 were empty, and — because it matched `fulfillment_location`
        // against the branch address as a raw string — dropped every parcel whose vendor had
        // renamed that branch since the order was placed. Those parcels were FINISHED: sealed
        // and waiting for a courier, and invisible on the one screen that books it.
        const docs = await Order.find({
            $or: [
                { 'sub_orders.status': { $in: ['ready_for_pickup', ...NOT_READY_STATUSES] } },
                { sub_orders: { $elemMatch: { status: 'handed_to_courier', pickup_id: null } } },
            ],
        }).select('transaction.reference sub_orders items created_at').lean();

        const vendorIds = [...new Set(
            docs.flatMap((o) => (o.sub_orders || []).map((s) => String(s.vendor_id)))
        )];
        const vendorDocs = await Seller.find({ _id: { $in: vendorIds } })
            .select('store_name name phone locations').lean();
        const vendorsById = new Map(vendorDocs.map((v) => [String(v._id), v]));

        const rows = new Map();
        // Finished parcels that cannot be booked from here — the vendor was deleted, has no
        // location left, or the branch was never linked to Bosta. Reported rather than
        // skipped: a parcel disappearing in silence is exactly the failure being fixed.
        const unbookable = [];

        // Parcels riding another courier are collected by that courier, not booked with Bosta.
        // Listed on their own so the admin still sees what is sitting sealed at a branch.
        const otherCourier = [];

        // The vendor pressed "the courier took it" with no courier ever booked, and Bosta has
        // not reported collecting it. Most likely it is still on the counter — a vendor ran
        // through the buttons one after the other — and it had vanished from this screen,
        // the only place a courier is booked. Listed so the admin can book one; Bosta's own
        // pickup scan moves it on and off this list by itself.
        const handedOver = [];

        for (const o of docs) {
            for (const sub of o.sub_orders || []) {
                const isReady = sub.status === 'ready_for_pickup';
                const unconfirmedHandover = sub.status === 'handed_to_courier' && !sub.pickup_id;
                if (!isReady && !unconfirmedHandover && !NOT_READY_STATUSES.includes(sub.status)) continue;

                const vendor = vendorsById.get(String(sub.vendor_id));
                const onOtherCourier = sub.courier === 'arrive' || (sub.tracking_number && !sub.bosta_tracking_number);
                if (unconfirmedHandover) {
                    if (onOtherCourier) continue;
                    const handedLoc = resolveSubLocation(vendor?.locations, sub.fulfillment_location);
                    handedOver.push({
                        order_id: o._id,
                        order_reference: o.transaction?.reference || o._id.toString(),
                        sub_order_id: sub._id,
                        reference: sub.reference,
                        tracking_number: sub.bosta_tracking_number,
                        vendor_id: sub.vendor_id,
                        vendor_name: vendor?.store_name || vendor?.name || null,
                        location_address: handedLoc?.address || sub.fulfillment_location || '',
                        bosta_location_id: handedLoc?.bosta_location_id || null,
                        handed_over_at: sub.handed_over_at,
                        handed_over_by_label: sub.handed_over_by_label || '',
                    });
                    continue;
                }
                if (onOtherCourier) {
                    if (isReady) {
                        otherCourier.push({
                            order_id: o._id,
                            order_reference: o.transaction?.reference || o._id.toString(),
                            sub_order_id: sub._id,
                            reference: sub.reference,
                            courier: sub.courier || 'arrive',
                            tracking_number: sub.tracking_number,
                            vendor_name: vendor?.store_name || vendor?.name || null,
                            fulfillment_location: sub.fulfillment_location || '',
                            ready_at: sub.ready_at,
                        });
                    }
                    continue;
                }
                // Resolved the same way dispatch resolves it, so a renamed branch keeps its
                // parcels instead of orphaning them.
                const loc = resolveSubLocation(vendor?.locations, sub.fulfillment_location);

                if (!loc?.bosta_location_id) {
                    if (isReady) {
                        unbookable.push({
                            order_id: o._id,
                            order_reference: o.transaction?.reference || o._id.toString(),
                            sub_order_id: sub._id,
                            reference: sub.reference,
                            vendor_name: vendor?.store_name || vendor?.name || null,
                            fulfillment_location: sub.fulfillment_location || '',
                            reason: !vendor
                                ? 'vendor_deleted'
                                : (loc ? 'branch_not_linked_to_bosta' : 'vendor_has_no_location'),
                        });
                    }
                    continue;
                }

                const key = `${sub.vendor_id}|${loc.bosta_location_id}`;
                if (!rows.has(key)) {
                    rows.set(key, {
                        vendor_id: sub.vendor_id,
                        vendor_name: vendor.store_name || vendor.name,
                        location_address: loc.address,
                        shipping_city: loc.shipping_city,
                        bosta_location_id: loc.bosta_location_id,
                        ready_parcels: [],
                        not_ready_count: 0,
                    });
                }
                const row = rows.get(key);

                if (!isReady) {
                    row.not_ready_count += 1;
                    continue;
                }

                row.ready_parcels.push({
                    order_id: o._id,
                    order_reference: o.transaction?.reference || o._id.toString(),
                    sub_order_id: sub._id,
                    reference: sub.reference,
                    tracking_number: sub.bosta_tracking_number,
                    item_count: (o.items || []).filter(
                        (i) => String(i.sub_order_id) === String(sub._id)
                    ).length,
                    parcel_photos: sub.parcel_photos || [],
                    ready_at: sub.ready_at,
                    cod_amount: sub.cod_amount,
                });
            }
        }

        // One read for the pickups already booked on this date at the branches in play.
        const bookedToday = await BostaPickup.find({
            bosta_location_id: { $in: [...rows.values()].map((r) => r.bosta_location_id) },
            scheduled_date: date,
            status: { $ne: 'cancelled' },
        }).lean();
        const pickupByLocation = new Map(bookedToday.map((p) => [String(p.bosta_location_id), p]));

        const summary = [...rows.values()].map((row) => ({
            ...row,
            ready_parcel_count: row.ready_parcels.length,
            // Retained under its old name so nothing reading this route breaks.
            pending_order_count: row.ready_parcels.length,
            pickup: pickupByLocation.get(String(row.bosta_location_id)) || null,
        }));

        handedOver.sort((a, b) => new Date(a.handed_over_at || 0) - new Date(b.handed_over_at || 0));
        res.json({ success: true, date, summary, unbookable_parcels: unbookable, other_courier_parcels: otherCourier, handed_over_parcels: handedOver });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Manually schedule a pickup
 * @route   POST /api/admin/bosta/pickups
 * @access  Private (Admin)
 */
router.post('/bosta/pickups', protect('admin'), async (req, res) => {
    try {
        const { bosta_location_id, scheduled_date, scheduled_time_slot, vendor_id } = req.body;
        if (!bosta_location_id || !scheduled_date || !scheduled_time_slot) {
            return res.status(400).json({ success: false, message: 'bosta_location_id, scheduled_date, and scheduled_time_slot are required' });
        }

        const vendor = vendor_id ? await Seller.findById(vendor_id).lean() : null;
        const location = vendor?.locations?.find(l => l.bosta_location_id === bosta_location_id);

        // Find ready orders and analyze before creating pickup
        const locationAddress = location?.address || '';

        // The parcels this booking is actually for. The admin may pass an explicit list —
        // that is how they exclude one whose photos did not convince them — and otherwise
        // every sealed parcel at this branch is taken.
        const requestedSubIds = Array.isArray(req.body.sub_order_ids)
            ? req.body.sub_order_ids.map(String)
            : null;

        const candidateDocs = await Order.find({
            'sub_orders': {
                $elemMatch: {
                    ...(vendor_id ? { vendor_id } : {}),
                    status: { $in: ['ready_for_pickup', 'handed_to_courier'] },
                },
            },
        }).select('_id sub_orders');

        const targets = [];
        for (const o of candidateDocs) {
            for (const sub of o.sub_orders || []) {
                if (vendor_id && String(sub.vendor_id) !== String(vendor_id)) continue;
                // A parcel the vendor called handed over that Bosta never collected is booked
                // only when the admin names it: they have decided it is still at the store.
                const unconfirmedHandover = sub.status === 'handed_to_courier' && !sub.pickup_id
                    && !!requestedSubIds?.includes(sub._id.toString());
                if (sub.status !== 'ready_for_pickup' && !unconfirmedHandover) continue;
                // Never put an Arrive parcel on a Bosta pickup.
                if (sub.courier === 'arrive' || (sub.tracking_number && !sub.bosta_tracking_number)) continue;
                // Which branch this parcel is collected from, resolved exactly as the
                // summary and the dispatch do. Comparing `fulfillment_location` to the
                // branch address directly excluded every parcel booked before the vendor
                // renamed that branch — the same parcels the summary was hiding.
                const parcelLocation = resolveSubLocation(vendor?.locations, sub.fulfillment_location);
                if (String(parcelLocation?.bosta_location_id || '') !== String(bosta_location_id)) continue;
                if (requestedSubIds && !requestedSubIds.includes(sub._id.toString())) continue;
                // The parcel's own vendor, not the optional `vendor_id` filter: a booking
                // made for a branch without naming a vendor still has to notify whoever
                // actually owns each box.
                targets.push({ orderId: o._id, subId: sub._id, vendorId: sub.vendor_id, status: sub.status });
            }
        }

        if (targets.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No parcels at this branch are sealed and ready yet, so there is nothing to collect.',
            });
        }

        const orderIds = [...new Set(targets.map((t) => t.orderId.toString()))];
        const analysis = await analyzePickupOrders(orderIds, locationAddress, vendor_id);
        // One parcel is one physical box, so the count Bosta is told is the number of
        // parcels being handed over — not the number of orders they came from.
        analysis.parcelCount = targets.length;
        // The fee follows the corrected count, not the one derived from whole orders: an
        // admin who deselects parcels down to a single box has just chosen to pay for the
        // visit, and the record has to say so.
        analysis.pickupFee = bostaTariff.pickupFee(analysis.parcelCount);

        // One live courier visit per branch per day (the unique index on BostaPickup). With
        // one already booked, these parcels join it instead: booking a second visit on Bosta
        // and then failing to save it left a real, billed pickup with no row behind it.
        const sameDay = await BostaPickup.findOne({
            bosta_location_id, scheduled_date, status: { $in: LIVE_PICKUP_STATUSES },
        });
        if (sameDay && sameDay.status !== 'scheduled') {
            return res.status(409).json({
                success: false,
                message: 'A courier has already been to this branch on that date. Pick another date.',
            });
        }

        let pickup = sameDay;
        if (sameDay) {
            const known = new Set(sameDay.order_ids.map(String));
            for (const id of orderIds) if (!known.has(id)) sameDay.order_ids.push(id);
            sameDay.parcel_count = Number(sameDay.parcel_count || 0) + targets.length;
            sameDay.pickup_fee = bostaTariff.pickupFee(sameDay.parcel_count);
            sameDay.has_fragile = sameDay.has_fragile || analysis.hasFragile;
            sameDay.has_big_items = sameDay.has_big_items || analysis.hasBigItems;
            await sameDay.save();
        } else {
            const result = await bostaService.createPickup({
                businessLocationId: bosta_location_id,
                scheduledDate: scheduled_date,
                scheduledTimeSlot: scheduled_time_slot,
                contactPerson: {
                    name: vendor?.name || vendor?.store_name || '',
                    phone: vendor?.phone || '',
                    email: vendor?.email || '',
                },
                noOfPackages: analysis.parcelCount || undefined,
                packageType: analysis.packageType || undefined,
                notes: analysis.notes || undefined,
            });

            pickup = await BostaPickup.create({
                bosta_pickup_id: result.pickupId,
                bosta_location_id,
                location_address: locationAddress,
                vendor_id: vendor_id || null,
                vendor_name: vendor?.store_name || vendor?.name || '',
                scheduled_date,
                scheduled_time_slot,
                contact_person: {
                    name: vendor?.name || vendor?.store_name || '',
                    phone: vendor?.phone || '',
                    email: vendor?.email || '',
                },
                status: 'scheduled',
                order_ids: orderIds,
                parcel_count: analysis.parcelCount,
                has_fragile: analysis.hasFragile,
                has_big_items: analysis.hasBigItems,
                pickup_fee: analysis.pickupFee,
                created_by: 'admin',
            });
        }

        // Stamp each collected parcel. This is the moment the cancel option disappears for
        // the vendor AND the customer: a driver is now committed to collecting it.
        const subHistory = {
            action: 'pickup_scheduled',
            title: 'Pickup scheduled',
            details: `A courier is booked for ${pickup.scheduled_date} (${pickup.scheduled_time_slot}). Bosta pickup #${pickup.bosta_pickup_id}. This parcel can no longer be cancelled.`,
            actor_role: 'admin',
            actor_label: req.user?.username || 'Admin',
            metadata: { bosta_pickup_id: pickup.bosta_pickup_id, scheduled_date: pickup.scheduled_date, scheduled_time_slot: pickup.scheduled_time_slot },
            created_at: new Date(),
        };

        for (const t of targets) {
            if (t.status === 'handed_to_courier') {
                // Back to waiting for the courier now booked: the vendor sees the appointment
                // and confirms the handover again when the courier really takes it. Their
                // first confirmation stays in the history.
                await Order.updateOne(
                    { _id: t.orderId },
                    {
                        $set: {
                            'sub_orders.$[p].status': 'pickup_scheduled',
                            'sub_orders.$[p].pickup_id': pickup._id,
                            'sub_orders.$[p].pickup_booked_at': new Date(),
                            'sub_orders.$[p].handed_over_at': null,
                            'sub_orders.$[p].handed_over_by_label': '',
                        },
                        $push: {
                            'sub_orders.$[p].history': {
                                ...subHistory,
                                details: `${subHistory.details} The vendor had confirmed the handover, but Bosta never reported collecting the parcel, so it is waiting for this courier again.`,
                            },
                        },
                    },
                    { arrayFilters: [{ 'p._id': t.subId, 'p.status': 'handed_to_courier', 'p.pickup_id': null }] }
                ).catch((e) => console.error(`[Pickup] Could not stamp parcel ${t.subId}: ${e.message}`));
                continue;
            }
            await Order.updateOne(
                { _id: t.orderId, 'sub_orders._id': t.subId, 'sub_orders.status': 'ready_for_pickup' },
                {
                    $set: {
                        'sub_orders.$.status': 'pickup_scheduled',
                        'sub_orders.$.pickup_id': pickup._id,
                        'sub_orders.$.pickup_booked_at': new Date(),
                    },
                    $push: { 'sub_orders.$.history': subHistory },
                }
            ).catch((e) => console.error(`[Pickup] Could not stamp parcel ${t.subId}: ${e.message}`));
        }

        // Tell the vendor when their courier is coming. Every parcel in a manual booking
        // belongs to the one branch the admin picked, so this is one message naming the day
        // and the slot — the appointment used to exist only on this screen.
        await bostaFulfillment.notifyVendorsOfPickup(
            pickup,
            targets.map((t) => ({ vendorId: t.vendorId, orderId: t.orderId, subId: t.subId }))
        );

        // Roll each affected order's headline up from its parcels, read back rather than
        // reasoned about — the documents were loaded before the Bosta call.
        for (const oid of orderIds) {
            const fresh = await Order.findById(oid);
            if (!fresh) continue;
            const rolled = subOrderCore.syncOrderStatus(fresh, req.user?.username || 'Admin');
            if (rolled.changed) await fresh.save().catch(() => {});
        }

        // `joined_existing`: the parcels went on the visit already booked for that day, at
        // its time slot — the screen says so, since it may not be the slot that was picked.
        res.json({ success: true, pickup, parcels_booked: targets.length, joined_existing: !!sameDay });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * Put a cancelled pickup's orders back in the needs-pickup queue.
 *
 * Orders that are still only *scheduled* would otherwise sit in `pickup_scheduled`
 * forever — that status is Bosta-driven, so an admin cannot correct it by hand. Orders
 * already picked up or further along are left alone.
 */
async function releaseOrdersFromCancelledPickup(pickup, actorLabel) {
    // Parcels first: put every one this pickup was going to collect back in the
    // needs-pickup queue, and clear the booking so its cancel window reopens — no courier
    // is coming for it any more, so the reason the option was hidden is gone.
    await Order.updateMany(
        { 'sub_orders.pickup_id': pickup._id, 'sub_orders.status': 'pickup_scheduled' },
        {
            $set: {
                'sub_orders.$[p].status': 'ready_for_pickup',
                'sub_orders.$[p].pickup_id': null,
                'sub_orders.$[p].pickup_booked_at': null,
            },
            $push: {
                'sub_orders.$[p].history': {
                    action: 'pickup_cancelled',
                    title: 'Pickup cancelled',
                    details: `Bosta pickup #${pickup.bosta_pickup_id} was cancelled. This parcel is waiting for a courier again.`,
                    actor_role: 'admin',
                    actor_label: actorLabel || 'Admin',
                    metadata: { bosta_pickup_id: pickup.bosta_pickup_id },
                    created_at: new Date(),
                },
            },
        },
        { arrayFilters: [{ 'p.pickup_id': pickup._id, 'p.status': 'pickup_scheduled' }] }
    ).catch((err) => console.error(`[Pickup] Could not release parcels: ${err.message}`));

    if (!pickup.order_ids?.length) return;
    await Order.updateMany(
        { _id: { $in: pickup.order_ids }, status: 'pickup_scheduled' },
        {
            $set: { status: 'ready' },
            $push: {
                history: {
                    action: 'pickup_cancelled',
                    title: 'Pickup cancelled',
                    details: `Bosta pickup #${pickup.bosta_pickup_id} was cancelled. Order returned to ready for rescheduling.`,
                    actor_role: 'admin',
                    actor_label: actorLabel,
                    metadata: { bosta_pickup_id: pickup.bosta_pickup_id },
                    created_at: new Date(),
                },
            },
        }
    );
}

/**
 * @desc    Cancel a pickup
 * @route   DELETE /api/admin/bosta/pickups/:pickupId
 * @access  Private (Admin)
 */
router.delete('/bosta/pickups/:pickupId', protect('admin'), async (req, res) => {
    try {
        const pickup = await BostaPickup.findById(req.params.pickupId);
        if (!pickup) return res.status(404).json({ success: false, message: 'Pickup not found' });

        // Try to cancel on Bosta — if it fails for any reason, still cancel locally
        let bostaWarning = null;
        try {
            await bostaService.deletePickup(pickup.bosta_pickup_id);
        } catch (bostaErr) {
            bostaWarning = bostaErr.message || 'Could not cancel on Bosta';
        }
        pickup.status = 'cancelled';
        await pickup.save();
        await releaseOrdersFromCancelledPickup(pickup, req.user?.username || 'Admin');

        const response = { success: true, pickup };
        if (bostaWarning) response.warning = bostaWarning;

        res.json(response);
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Refresh pickup status from Bosta
 * @route   POST /api/admin/bosta/pickups/:pickupId/refresh
 * @access  Private (Admin)
 */
router.post('/bosta/pickups/:pickupId/refresh', protect('admin'), async (req, res) => {
    try {
        const pickup = await BostaPickup.findById(req.params.pickupId);
        if (!pickup) return res.status(404).json({ success: false, message: 'Pickup not found' });

        // Bosta calls it `state` ("Requested" / "Picked up" / "Canceled"), not `status`.
        let data;
        try {
            data = await bostaService.getPickupById(pickup.bosta_pickup_id);
        } catch (err) {
            // Bosta drops a pickup outright when it is cancelled before a route is
            // assigned, so this specific error means cancelled, not a failed refresh.
            // Matched on Bosta's exact wording so an unrelated error can't cancel a live
            // pickup just by mentioning "not found".
            if (/^pickup request not found$/i.test((err.message || '').trim())) {
                pickup.status = 'cancelled';
                pickup.bosta_state = 'Canceled';
                pickup.last_refreshed_at = new Date();
                await pickup.save();
                await releaseOrdersFromCancelledPickup(pickup, 'Bosta Sync');
                return res.json({ success: true, pickup, note: 'Pickup no longer exists on Bosta — marked cancelled.' });
            }
            throw err;
        }

        const state = typeof data?.state === 'string' ? data.state : null;
        const mapped = bostaService.mapBostaPickupState(state);
        if (mapped) pickup.status = mapped;
        if (state) pickup.bosta_state = state;
        pickup.last_refreshed_at = new Date();
        await pickup.save();
        if (mapped === 'cancelled') {
            await releaseOrdersFromCancelledPickup(pickup, 'Bosta Sync');
        }

        res.json({ success: true, pickup });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Reschedule a pickup (cancel old, create new with new date/time)
 * @route   PUT /api/admin/bosta/pickups/:pickupId/reschedule
 * @access  Private (Admin)
 */
router.put('/bosta/pickups/:pickupId/reschedule', protect('admin'), async (req, res) => {
    try {
        const { scheduled_date, scheduled_time_slot } = req.body;
        if (!scheduled_date || !scheduled_time_slot) {
            return res.status(400).json({ success: false, message: 'scheduled_date and scheduled_time_slot are required' });
        }
        const pickup = await BostaPickup.findById(req.params.pickupId);
        if (!pickup) return res.status(404).json({ success: false, message: 'Pickup not found' });

        // Cancel old pickup on Bosta
        try { await bostaService.deletePickup(pickup.bosta_pickup_id); } catch (_) {}

        // Create new pickup
        const vendor = pickup.vendor_id ? await Seller.findById(pickup.vendor_id).lean() : null;
        const result = await bostaService.createPickup({
            businessLocationId: pickup.bosta_location_id,
            scheduledDate: scheduled_date,
            scheduledTimeSlot: scheduled_time_slot,
            contactPerson: {
                name: vendor?.name || vendor?.store_name || pickup.contact_person?.name || '',
                phone: vendor?.phone || pickup.contact_person?.phone || '',
                email: vendor?.email || pickup.contact_person?.email || '',
            },
        });

        pickup.bosta_pickup_id = result.pickupId;
        pickup.scheduled_date = scheduled_date;
        pickup.scheduled_time_slot = scheduled_time_slot;
        pickup.status = 'scheduled';
        await pickup.save();

        res.json({ success: true, pickup });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/* ------------------------- Ticket Management ------------------------- */

/**
 * @desc    Admin starts a conversation with a vendor
 * @route   POST /api/admin/tickets
 * @access  Private (Admin)
 */
router.post('/tickets', protect('admin'), async (req, res) => {
    try {
        const { vendorId, title, message, priority, category } = req.body;

        if (!isObjectId(vendorId)) {
            return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
        }
        if (!title?.trim()) {
            return res.status(400).json({ success: false, message: 'Title is required' });
        }
        if (!message?.trim()) {
            return res.status(400).json({ success: false, message: 'Message is required' });
        }

        const vendor = await Seller.findById(vendorId).select('name store_name').lean();
        if (!vendor) {
            return res.status(404).json({ success: false, message: 'Vendor not found' });
        }

        const ticket = await Ticket.create({
            title: title.trim(),
            description: message.trim(),
            category: category || 'other',
            priority: priority || 'medium',
            authorId: vendor._id,
            authorRole: 'vendor',
            authorName: vendor.store_name || vendor.name || 'Vendor',
            status: 'open',
            initiatedByAdmin: true,
            messages: [{
                senderRole: 'admin',
                senderId: new mongoose.Types.ObjectId(),
                senderName: req.user.username || 'Admin',
                content: message.trim(),
            }],
        });

        const created = await Ticket.findById(ticket._id).lean();
        emitToTicket(ticket._id, 'ticket:updated', created);
        res.status(201).json({ success: true, ticket: created });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get all tickets (admin)
 * @route   GET /api/admin/tickets
 * @access  Private (Admin)
 */
router.get('/tickets', protect('admin'), async (req, res) => {
    try {
        const { status, priority, authorRole, q = '', page = 1, limit = 20 } = req.query;

        const filter = {};

        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        if (authorRole) filter.authorRole = authorRole;

        const search = String(q).trim();
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { authorName: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
            ];
        }

        const total = await Ticket.countDocuments(filter);
        const tickets = await paginate(
            Ticket.find(filter)
                .select('title status priority category authorRole authorName createdAt updatedAt messages order_id order_reference')
                .sort({ createdAt: -1 }),
            page,
            limit
        ).lean();

        res.json({
            success: true,
            tickets,
            pagination: {
                total,
                page: Number(page),
                pages: Math.ceil(total / limit),
                limit: Number(limit),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get single ticket by ID (admin)
 * @route   GET /api/admin/tickets/:id
 * @access  Private (Admin)
 */
router.get('/tickets/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid ticket ID' });
        }

        const ticket = await Ticket.findById(req.params.id).lean();
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        res.json({ success: true, ticket });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update ticket status/priority/assignedTo (admin)
 * @route   PUT /api/admin/tickets/:id
 * @access  Private (Admin)
 */
router.put('/tickets/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid ticket ID' });
        }

        const { status, priority, assignedTo, assignedToName, adminNote } = req.body;

        const updateFields = {};
        if (status !== undefined) {
            if (!['open', 'pending', 'resolved', 'closed'].includes(status)) {
                return res.status(400).json({ success: false, message: 'Invalid status value' });
            }
            updateFields.status = status;
        }
        if (priority !== undefined) {
            if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
                return res.status(400).json({ success: false, message: 'Invalid priority value' });
            }
            updateFields.priority = priority;
        }
        if (assignedTo !== undefined) {
            updateFields.assignedTo = assignedTo || null;
            updateFields.assignedToName = assignedToName || null;
        }
        if (adminNote !== undefined) {
            updateFields.adminNote = adminNote;
        }

        const ticket = await Ticket.findByIdAndUpdate(
            req.params.id,
            updateFields,
            { returnDocument: "after", runValidators: true }
        ).lean();

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        res.json({ success: true, ticket });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Admin reply to a ticket
 * @route   POST /api/admin/tickets/:id/messages
 * @access  Private (Admin)
 */
router.post('/tickets/:id/messages', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid ticket ID' });
        }

        const { content } = req.body;
        if (!content?.trim()) {
            return res.status(400).json({ success: false, message: 'Message content is required' });
        }

        const ticket = await Ticket.findById(req.params.id);
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        if (ticket.status === 'closed') {
            return res.status(400).json({ success: false, message: 'Cannot reply to a closed ticket' });
        }

        // Auto-set to pending when admin replies
        if (ticket.status === 'open') {
            ticket.status = 'pending';
        }

        ticket.messages.push({
            senderRole: 'admin',
            senderId: new mongoose.Types.ObjectId(), // Admin has no real ObjectId, use a dummy to satisfy schema
            senderName: req.user.username || 'Admin',
            content: content.trim(),
        });

        await ticket.save();

        const updated = await Ticket.findById(ticket._id).lean();
        emitToTicket(ticket._id, 'ticket:updated', updated);
        res.json({ success: true, ticket: updated });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------------- Vendor Subscription Management (Admin) ------------------------- */

/**
 * Get vendors with no active subscription (not_subscribed, expired, cancelled)
 * @route   GET /api/admin/vendors/not-subscribed
 * @access  Private (Admin)
 */
router.get('/vendors/not-subscribed', protect('admin'), async (req, res) => {
    try {
        const { q = '', subscription_status, page = 1, limit = 20 } = req.query;

        // Not subscribed = no live subscription, as the statistics card counts it. The seller's
        // own subscription_status can lag behind (active on a subscription already past its
        // end), and the card and this list then disagreed by those vendors.
        const filter = subscription_status
            ? { subscription_status }
            : { _id: { $nin: await vendorIdsWithLiveSubscription() } };

        if (q.trim()) {
            filter.$or = [
                { store_name:     { $regex: q.trim(), $options: 'i' } },
                { store_username: { $regex: q.trim(), $options: 'i' } },
                { email:          { $regex: q.trim(), $options: 'i' } },
            ];
        }

        const total = await Seller.countDocuments(filter);
        const vendors = await Seller.find(filter)
            .select('-password')
            .sort({ created_at: -1 })
            .skip((Math.max(1, Number(page)) - 1) * Number(limit))
            .limit(Number(limit))
            .lean();

        res.json({
            success: true,
            vendors,
            pagination: {
                total,
                page: Number(page),
                pages: Math.ceil(total / Number(limit)),
                limit: Number(limit),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Subscription statistics, computed across every subscription rather than the
 * page the list happens to be showing.
 * @route   GET /api/admin/subscriptions/stats
 * @access  Private (Admin)
 */
router.get('/subscriptions/stats', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, stats: await getSubscriptionStatsAdmin() });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Get all vendor subscriptions (with optional is_free_trial filter)
 * @route   GET /api/admin/subscriptions
 * @access  Private (Admin)
 */
router.get('/subscriptions', protect('admin'), async (req, res) => {
    try {
        const { vendor_id, package_id, status, is_free_trial, segment, page = 1, limit = 20 } = req.query;
        const result = await getAllSubscriptionsAdmin({
            vendorId: vendor_id,
            packageId: package_id,
            status,
            // A statistics card's subscriptions (getSubscriptionStatsAdmin counts with the same query).
            segment,
            is_free_trial: is_free_trial !== undefined ? is_free_trial === 'true' : undefined,
            page: Number(page),
            limit: Number(limit),
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Get subscription payment transactions
 * @route   GET /api/admin/subscription-payments
 * @access  Private (Admin)
 */
router.get('/subscription-payments', protect('admin'), async (req, res) => {
    try {
        const { vendor_id, package_id, status, action, q, from, to, segment, page = 1, limit = 20 } = req.query;
        // A money card's payments, by the card's own query.
        const match = segment ? paymentSegmentFilter(segment) : null;
        if (segment && !match) return res.status(400).json({ success: false, message: `Unknown segment: ${segment}` });
        const result = await getSubscriptionPaymentsAdmin({
            match,
            vendorId: vendor_id,
            packageId: package_id,
            status,
            action,
            q,
            from,
            to,
            page: Number(page),
            limit: Number(limit),
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Get a specific vendor's subscription status
 * @route   GET /api/admin/vendors/:id/subscription
 * @access  Private (Admin)
 */
router.get('/vendors/:id/subscription', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
        }
        const status = await getVendorSubscriptionStatus(req.params.id);
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Manual suspend a vendor with required reason
 * @route   PUT /api/admin/vendors/:id/suspend
 * @access  Private (Admin)
 */
router.put('/vendors/:id/suspend', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
        }

        const { reason } = req.body;
        if (!reason || !reason.trim()) {
            return res.status(400).json({ success: false, message: 'Suspension reason is required' });
        }

        const vendor = await suspendVendor(req.params.id, reason.trim(), 'admin');
        await Seller.findByIdAndUpdate(req.params.id, {
            subscription_status: 'suspended',
        });

        await sendSubscriptionNotification(vendor._id, 'account_suspended', {
            reason: reason.trim(),
            suspendedAt: new Date(),
        });

        res.json({ success: true, vendor });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Upload a store image for a specific vendor (admin)
 * @route   PUT /api/admin/vendors/:id/store-image
 * @access  Private (Admin)
 */
const storeImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../public/uploads/store-images');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `store-${req.params.id}-${Date.now()}${path.extname(file.originalname)}`);
    },
});
const storeImageUpload = multer({
    storage: storeImageStorage,
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedExts = /\.(jpeg|jpg|png|webp)$/i;
        if (allowedExts.test(path.extname(file.originalname))) return cb(null, true);
        cb(new Error('Only image files are accepted (jpeg, jpg, png, webp).'));
    },
});

router.put('/vendors/:id/store-image', protect('admin'), (req, res, next) => {
    storeImageUpload.single('store_image')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message });
        next();
    });
}, async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file provided' });
        }

        const imageUrl = `/uploads/store-images/${req.file.filename}`;
        const vendor = await Seller.findByIdAndUpdate(
            req.params.id,
            { store_image: imageUrl },
            { returnDocument: "after" }
        ).select('-password');

        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
        res.json({ success: true, vendor, store_image: imageUrl });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Cancel a vendor's subscription (admin)
 * @route   PUT /api/admin/vendors/:id/subscription/cancel
 * @access  Private (Admin)
 */
router.put('/vendors/:id/subscription/cancel', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
        }

        const { cancelVendorSubscription } = require('../services/vendorSubscriptionService');
        const cancelled = await cancelVendorSubscription(req.params.id);
        res.json({ success: true, subscription: cancelled });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * Grant a free subscription to a vendor for N months (admin)
 * @route   POST /api/admin/vendors/:id/subscription/grant
 * @access  Private (Admin)
 */
router.post('/vendors/:id/subscription/grant', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
        }
        const { package_id, months } = req.body;
        if (!package_id || !isObjectId(package_id)) {
            return res.status(400).json({ success: false, message: 'Valid package_id is required' });
        }
        if (!months || isNaN(Number(months))) {
            return res.status(400).json({ success: false, message: 'months is required and must be a number' });
        }
        const { grantAdminSubscription } = require('../services/vendorSubscriptionService');
        const result = await grantAdminSubscription(req.params.id, package_id, months);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/* ------------------------- Users Management ------------------------- */

/**
 * @desc    Get all users (admin)
 * @route   GET /api/admin/users
 * @access  Private (Admin)
 */
router.get('/users', protect('admin'), async (req, res) => {
    try {
        const { q = '', page = 1, limit = 20 } = req.query;

        const filter = {};
        const search = String(q).trim();
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
            ];
        }

        const total = await User.countDocuments(filter);
        const users = await paginate(
            User.find(filter).select('-password').sort({ created_at: -1 }),
            page,
            limit
        ).lean();

        res.json({
            success: true,
            users,
            pagination: {
                total,
                page: Number(page),
                pages: Math.ceil(total / limit),
                limit: Number(limit),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get single user by ID (admin) with their orders
 * @route   GET /api/admin/users/:id
 * @access  Private (Admin)
 */
router.get('/users/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        const user = await User.findById(req.params.id).select('-password').lean();
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Fetch user's orders
        const orders = await Order.find({ user_id: user._id })
            .select('status total_price created_at items')
            .sort({ created_at: -1 })
            .lean();

        res.json({ success: true, user, orders });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Preview what a user hard-delete will remove (impact counts)
 * @route   GET /api/admin/users/:id/delete-impact
 * @access  Private (Admin)
 */
router.get('/users/:id/delete-impact', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }
        const impact = await getUserDeleteImpact(req.params.id);
        res.json({ success: true, ...impact });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Permanently (hard) delete a user and cascade their related records
 * @route   DELETE /api/admin/users/:id/hard
 * @access  Private (Admin)
 */
router.delete('/users/:id/hard', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }
        const confirm = (req.body && req.body.confirm ? String(req.body.confirm) : '').trim().toLowerCase();
        const user = await User.findById(req.params.id).select('email').lean();
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (confirm !== String(user.email || '').trim().toLowerCase()) {
            return res.status(400).json({ success: false, message: 'Confirmation text does not match the account email' });
        }

        const impact = await hardDeleteUser(req.params.id, getAdminActor(req));
        res.json({ success: true, message: 'User permanently deleted', impact });
    } catch (err) {
        // A refused delete is not a server fault — it is the customer still
        // being owed money. Pass the code and the amount through so the admin
        // is told what to settle rather than just that it failed.
        res.status(err.status || 500).json({
            success: false,
            code: err.code,
            blockers: err.blockers,
            message: err.message,
        });
    }
});

/**
 * @desc    Preview what a vendor hard-delete will remove (impact counts)
 * @route   GET /api/admin/vendors/:id/delete-impact
 * @access  Private (Admin)
 */
router.get('/vendors/:id/delete-impact', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
        }
        const impact = await getVendorDeleteImpact(req.params.id);
        res.json({ success: true, ...impact });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Permanently (hard) delete a vendor and cascade their related records.
 *          Requires the vendor to be suspended first.
 * @route   DELETE /api/admin/vendors/:id/hard
 * @access  Private (Admin)
 */
router.delete('/vendors/:id/hard', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid vendor ID' });
        }
        const confirm = (req.body && req.body.confirm ? String(req.body.confirm) : '').trim().toLowerCase();
        const vendor = await Seller.findById(req.params.id).select('email status').lean();
        if (!vendor) {
            return res.status(404).json({ success: false, message: 'Vendor not found' });
        }
        if (vendor.status !== 'suspended') {
            return res.status(409).json({ success: false, message: 'Vendor must be suspended before it can be permanently deleted' });
        }
        if (confirm !== String(vendor.email || '').trim().toLowerCase()) {
            return res.status(400).json({ success: false, message: 'Confirmation text does not match the account email' });
        }

        const impact = await hardDeleteVendor(req.params.id, getAdminActor(req));
        res.json({ success: true, message: 'Vendor permanently deleted', impact });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get all pages
 * @route   GET /api/admin/pages
 * @access  Private (Admin)
 */
router.get('/pages', protect('admin'), async (req, res) => {
    try {
        const pages = await Page.find().sort({ createdAt: -1 });
        res.json({ success: true, pages });
    } catch (err) {
        console.error('Error fetching pages:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * @desc    Update a page
 * @route   PUT /api/admin/pages/:id
 * @access  Private (Admin)
 */
router.put('/pages/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid Page ID' });
        }

        const { title_en, title_ar, content_en, content_ar } = req.body;
        const page = await Page.findByIdAndUpdate(
            req.params.id,
            { title_en, title_ar, content_en, content_ar },
            { returnDocument: "after", runValidators: true }
        );

        if (!page) {
            return res.status(404).json({ success: false, message: 'Page not found' });
        }

        res.json({ success: true, page, message: 'Page updated successfully' });
    } catch (err) {
        console.error('Error updating page:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ======================== ARTICLES ========================

/**
 * @desc    List all articles (admin — all statuses)
 * @route   GET /api/admin/articles
 * @access  Private (Admin)
 */
router.get('/articles', protect('admin'), async (req, res) => {
    try {
        const { page, limit, search, tag, category, status } = req.query;
        const result = await articleService.getAllArticles({ page, limit, search, tag, category, status: status || undefined });
        // Override default 'published' filter — admin sees all
        if (!status) {
            const { Article } = require('../models/articles');
            const allQuery = {};
            if (search) {
                allQuery.$or = [
                    { title_en: { $regex: search, $options: 'i' } },
                    { title_ar: { $regex: search, $options: 'i' } },
                ];
            }
            const skip = ((Number(page) || 1) - 1) * (Number(limit) || 12);
            const total = await Article.countDocuments(allQuery);
            const articles = await Article.find(allQuery)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(Number(limit) || 12)
                .lean();
            return res.json({
                articles,
                pagination: {
                    total,
                    page: Number(page) || 1,
                    pages: Math.ceil(total / (Number(limit) || 12)),
                    limit: Number(limit) || 12,
                },
            });
        }
        res.json(result);
    } catch (err) {
        console.error('Error fetching articles:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * @desc    Get a single article by ID (admin)
 * @route   GET /api/admin/articles/:id
 * @access  Private (Admin)
 */
router.get('/articles/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid Article ID' });
        }
        const article = await articleService.getArticleById(req.params.id);
        if (!article) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }
        res.json({ success: true, article });
    } catch (err) {
        console.error('Error fetching article:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * @desc    Create a new article
 * @route   POST /api/admin/articles
 * @access  Private (Admin)
 */
router.post('/articles', protect('admin'), async (req, res) => {
    try {
        const article = await articleService.createArticle(req.body);
        res.status(201).json({ success: true, article, message: 'Article created successfully' });
    } catch (err) {
        console.error('Error creating article:', err);
        res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * @desc    Update an article
 * @route   PUT /api/admin/articles/:id
 * @access  Private (Admin)
 */
router.put('/articles/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid Article ID' });
        }
        const article = await articleService.updateArticle(req.params.id, req.body);
        if (!article) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }
        res.json({ success: true, article, message: 'Article updated successfully' });
    } catch (err) {
        console.error('Error updating article:', err);
        res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * @desc    Delete an article
 * @route   DELETE /api/admin/articles/:id
 * @access  Private (Admin)
 */
router.delete('/articles/:id', protect('admin'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid Article ID' });
        }
        const article = await articleService.deleteArticle(req.params.id);
        if (!article) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }
        res.json({ success: true, message: 'Article deleted successfully' });
    } catch (err) {
        console.error('Error deleting article:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/* ================================================================== */
/*  RETURNS & REFUNDS                                                 */
/* ================================================================== */

const {
    getAllReturnRequests,
    getReturnRequestById: getAdminReturnById,
    getReturnCounts: getAdminReturnCounts,
    adminReviewReturn,
    confirmReturnReceived: adminConfirmReceipt,
} = require('../services/returnService');

const {
    createRefund,
    processRefund,
    completeRefund,
    failRefund,
    getAllRefunds,
    getRefundById: getAdminRefundById,
    getRefundAnalytics,
} = require('../services/refundService');

/**
 * @desc    List all return requests
 * @route   GET /api/admin/returns
 */
router.get('/returns', protect('admin'), async (req, res) => {
    try {
        const { page, limit, status, vendorId, search, from, to } = req.query;
        const result = await getAllReturnRequests({ page, limit, status, vendorId, search, from, to });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Get return counts by status
 * @route   GET /api/admin/returns/counts
 */
router.get('/returns/counts', protect('admin'), async (req, res) => {
    try {
        const counts = await getAdminReturnCounts();
        res.json({ success: true, counts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Return/refund analytics
 * @route   GET /api/admin/returns/analytics
 */
router.get('/returns/analytics', protect('admin'), async (req, res) => {
    try {
        const { from, to, vendorId } = req.query;
        const analytics = await getRefundAnalytics({ from, to, vendorId });
        res.json({ success: true, analytics });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Get single return request
 * @route   GET /api/admin/returns/:id
 */
router.get('/returns/:id', protect('admin'), async (req, res) => {
    try {
        const ret = await getAdminReturnById(req.params.id);
        if (!ret) return res.status(404).json({ success: false, message: 'Return request not found' });
        res.json({ success: true, return_request: ret });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Admin approve/reject return
 * @route   PUT /api/admin/returns/:id/review
 */
router.put('/returns/:id/review', protect('admin'), async (req, res) => {
    try {
        const { decision, fault_type, notes } = req.body;
        const ret = await adminReviewReturn(req.params.id, {
            decision,
            fault_type,
            notes,
            adminUsername: req.user.username || 'Admin',
        });
        res.json({ success: true, return_request: ret });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_RETURN_STATUS' ? 400
            : error.code === 'INVALID_INPUT' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Create return shipment via Bosta
 * @route   POST /api/admin/returns/:id/ship
 */
router.post('/returns/:id/ship', protect('admin'), async (req, res) => {
    try {
        const { createReturnShipment } = require('../services/returnLogisticsService');
        const ret = await createReturnShipment(req.params.id, {
            role: 'admin',
            label: req.user.username || 'Admin',
        });
        res.json({ success: true, return_request: ret });
    } catch (error) {
        // Missing city / vendor location and address-shape rejections are all things the
        // admin can go fix, so they read as 400s rather than "internal error".
        const status = error.code === 'NOT_FOUND' ? 404
            : ['INVALID_RETURN_STATUS', 'SHIPMENT_EXISTS', 'MISSING_CITY', 'MISSING_VENDOR_LOCATION'].includes(error.code) ? 400
            : /^Bosta /.test(error.message || '') ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Admin confirms receipt of returned goods (override)
 * @route   POST /api/admin/returns/:id/confirm-receipt
 */
router.post('/returns/:id/confirm-receipt', protect('admin'), async (req, res) => {
    try {
        const ret = await adminConfirmReceipt(req.params.id, {
            role: 'admin',
            label: req.user.username || 'Admin',
        });
        res.json({ success: true, return_request: ret });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_RETURN_STATUS' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Refresh return tracking from Bosta
 * @route   POST /api/admin/returns/:id/refresh-tracking
 */
router.post('/returns/:id/refresh-tracking', protect('admin'), async (req, res) => {
    try {
        const { refreshReturnTracking } = require('../services/returnLogisticsService');
        const ret = await refreshReturnTracking(req.params.id);
        res.json({ success: true, return_request: ret });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404 : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Create refund for an approved return
 * @route   POST /api/admin/returns/:id/refund
 */
router.post('/returns/:id/refund', protect('admin'), async (req, res) => {
    try {
        const { restocking_fee, notes, refund_method } = req.body;
        const refund = await createRefund(req.params.id, {
            restocking_fee,
            notes,
            // Where the money goes. Absent, the destination defaults to the way
            // the customer paid — see `defaultRefundMethod`.
            refund_method: refund_method || null,
            adminUsername: req.user.username || 'Admin',
        });
        res.status(201).json({ success: true, refund });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'REFUND_ALREADY_EXISTS' ? 409
            : error.code === 'INVALID_RETURN_STATUS' ? 400
            : error.code === 'INVALID_REFUND_METHOD' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    List all refunds
 * @route   GET /api/admin/refunds
 */
router.get('/refunds', protect('admin'), async (req, res) => {
    try {
        const { page, limit, status, vendorId, from, to } = req.query;
        const result = await getAllRefunds({ page, limit, status, vendorId, from, to });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Get single refund details
 * @route   GET /api/admin/refunds/:id
 */
router.get('/refunds/:id', protect('admin'), async (req, res) => {
    try {
        const refund = await getAdminRefundById(req.params.id);
        if (!refund) return res.status(404).json({ success: false, message: 'Refund not found' });
        res.json({ success: true, refund });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Initiate refund processing
 * @route   POST /api/admin/refunds/:id/process
 */
router.post('/refunds/:id/process', protect('admin'), async (req, res) => {
    try {
        const refund = await processRefund(req.params.id, req.user.username || 'Admin');
        res.json({ success: true, refund });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_STATUS' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Mark refund as completed
 * @route   POST /api/admin/refunds/:id/complete
 */
router.post('/refunds/:id/complete', protect('admin'), async (req, res) => {
    try {
        const { payment_details } = req.body;
        const refund = await completeRefund(req.params.id, {
            payment_details,
            adminUsername: req.user.username || 'Admin',
        });
        res.json({ success: true, refund });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_STATUS' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Mark refund as failed
 * @route   POST /api/admin/refunds/:id/fail
 */
router.post('/refunds/:id/fail', protect('admin'), async (req, res) => {
    try {
        const { failure_reason } = req.body;
        const refund = await failRefund(req.params.id, {
            failure_reason,
            adminUsername: req.user.username || 'Admin',
        });
        res.json({ success: true, refund });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_STATUS' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/* ------------------------------------------------------------------ */
/*  Vendor Withdrawals                                                */
/* ------------------------------------------------------------------ */
const {
    listAllWithdrawals,
    getWithdrawalById,
    approveWithdrawal,
    rejectWithdrawal,
    markWithdrawalPaid,
} = require('../services/withdrawalService');

// Payout errors carry a `code`; map the ones a person can act on to a 4xx so the screen shows
// the sentence instead of a generic failure.
const payoutErrorStatus = (error) => ({
    NOT_FOUND: 404,
    INVALID_INPUT: 400,
    BELOW_MINIMUM: 400,
    INVALID_STATUS: 409,
    PAYOUTS_ON_HOLD: 409,
    NO_PAYOUT_METHOD: 409,
    NOTHING_PAYABLE: 409,
    NOTHING_TO_TRANSFER: 409,
    WITHDRAWAL_EXISTS: 409,
    BUSY: 409,
    NOT_CONFIGURED: 503,
}[error.code] || 500);

/**
 * @desc    List all withdrawal requests (filters: status, vendorId, from, to)
 * @route   GET /api/admin/withdrawals
 */
router.get('/withdrawals', protect('admin'), async (req, res) => {
    try {
        const { page, limit, status, vendorId, channel, initiatedBy, needsReview, from, to } = req.query;
        const result = await listAllWithdrawals({
            page, limit, status, vendorId, channel, initiatedBy,
            needsReview: needsReview === 'true' || needsReview === '1',
            from, to,
        });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Get single withdrawal request
 * @route   GET /api/admin/withdrawals/:id
 */
router.get('/withdrawals/:id', protect('admin'), async (req, res) => {
    try {
        const withdrawal = await getWithdrawalById(req.params.id);
        if (!withdrawal) return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
        res.json({ success: true, withdrawal });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Approve a withdrawal request
 * @route   POST /api/admin/withdrawals/:id/approve
 */
router.post('/withdrawals/:id/approve', protect('admin'), async (req, res) => {
    try {
        const withdrawal = await approveWithdrawal(req.params.id, req.user.username || 'Admin');
        res.json({ success: true, withdrawal });
    } catch (error) {
        res.status(payoutErrorStatus(error)).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Reject a withdrawal request
 * @route   POST /api/admin/withdrawals/:id/reject
 */
router.post('/withdrawals/:id/reject', protect('admin'), async (req, res) => {
    try {
        const { reason } = req.body;
        const withdrawal = await rejectWithdrawal(req.params.id, { reason, adminUsername: req.user.username || 'Admin' });
        res.json({ success: true, withdrawal });
    } catch (error) {
        res.status(payoutErrorStatus(error)).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Mark a withdrawal request as paid
 * @route   POST /api/admin/withdrawals/:id/paid
 */
router.post('/withdrawals/:id/paid', protect('admin'), async (req, res) => {
    try {
        const { payment_reference } = req.body;
        const withdrawal = await markWithdrawalPaid(req.params.id, { payment_reference, adminUsername: req.user.username || 'Admin' });
        res.json({ success: true, withdrawal });
    } catch (error) {
        res.status(payoutErrorStatus(error)).json({ success: false, message: error.message, code: error.code });
    }
});

/* ------------------------------------------------------------------ */
/*  Vendor Ad Banner Requests                                         */
/* ------------------------------------------------------------------ */
const {
    listAllAds,
    getAdById,
    approveAd,
    rejectAd,
    takeDownAd,
} = require('../services/adService');

/**
 * @desc    List all ad requests (filters: status, vendorId, from, to)
 * @route   GET /api/admin/ads
 */
router.get('/ads', protect('admin'), async (req, res) => {
    try {
        const { page, limit, status, vendorId, from, to } = req.query;
        const result = await listAllAds({ page, limit, status, vendorId, from, to });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Get single ad request
 * @route   GET /api/admin/ads/:id
 */
router.get('/ads/:id', protect('admin'), async (req, res) => {
    try {
        const ad = await getAdById(req.params.id);
        if (!ad) return res.status(404).json({ success: false, message: 'Ad request not found' });
        res.json({ success: true, ad });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    What an ad did: impressions, clicks, actions, by day / placement / device.
 * @route   GET /api/admin/ads/:id/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get('/ads/:id/analytics', protect('admin'), async (req, res) => {
    try {
        const { getAdAnalytics } = require('../services/adAnalyticsService');
        const report = await getAdAnalytics(req.params.id, { from: req.query.from, to: req.query.to });
        if (!report) return res.status(404).json({ success: false, message: 'Ad request not found' });
        res.json({ success: true, ...report });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Approve an ad request (sets live window)
 * @route   POST /api/admin/ads/:id/approve
 */
router.post('/ads/:id/approve', protect('admin'), async (req, res) => {
    try {
        const { start_date, end_date } = req.body;
        const ad = await approveAd(req.params.id, { start_date, end_date, adminUsername: req.user.username || 'Admin' });
        res.json({ success: true, ad });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_STATUS' ? 400
            : error.code === 'INVALID_INPUT' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Reject an ad request
 * @route   POST /api/admin/ads/:id/reject
 */
router.post('/ads/:id/reject', protect('admin'), async (req, res) => {
    try {
        const { reason } = req.body;
        const ad = await rejectAd(req.params.id, { reason, adminUsername: req.user.username || 'Admin' });
        res.json({ success: true, ad });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_STATUS' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Take down a live ad early
 * @route   POST /api/admin/ads/:id/takedown
 */
router.post('/ads/:id/takedown', protect('admin'), async (req, res) => {
    try {
        const ad = await takeDownAd(req.params.id, { adminUsername: req.user.username || 'Admin' });
        res.json({ success: true, ad });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_STATUS' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

module.exports = router;
