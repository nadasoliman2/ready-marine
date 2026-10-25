const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { protect, denyUnclaimedGuest } = require('../middleware/authMiddleware');
const { User } = require('../models/users');
const {
    getUserProfile,
    updateProfile,
    changePassword,
    addAddress,
    updateAddress,
    deleteAddress,
    getUserOrders
} = require('../services/userService');
const { Order } = require('../models/orders');

const profileUploadDir = path.join(__dirname, '../public/uploads/users');
if (!fs.existsSync(profileUploadDir)) fs.mkdirSync(profileUploadDir, { recursive: true });

const profilePhotoUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, profileUploadDir),
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
        },
    }),
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp/;
        const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
        const mimeOk = allowed.test(file.mimetype);
        if (extOk && mimeOk) return cb(null, true);
        cb(new Error('Images only (jpeg, jpg, png, webp)!'));
    },
});

/**
 * @desc    Get user profile
 * @route   GET /api/users/profile
 */
router.get('/profile', protect('user'), async (req, res) => {
    try {
        // Checkout calls this on a guest session to prefill saved addresses, so
        // refusing it outright would break the very flow that creates guests.
        // Answer instead with the identity the visitor themselves just typed and
        // nothing that account may have accumulated — an address book belonging
        // to whoever really owns this number is exactly what must not come back
        // to someone who has only demonstrated that they can type it.
        if (req.isUnclaimedGuest) {
            return res.json({
                _id: req.user._id,
                name: req.user.name,
                email: null,
                phone: req.user.phone,
                profile_image: null,
                account_status: 'guest',
                is_guest: true,
                addresses: [],
                cars: [],
            });
        }
        const profile = await getUserProfile(req.user._id);
        res.json(profile);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Update user profile info
 * @route   PUT /api/users/profile
 */
router.put('/profile', protect('user'), async (req, res) => {
    try {
        const profile = await updateProfile(req.user._id, req.body);
        res.json({ message: 'Profile updated successfully', profile });
    } catch (error) {
        res.status(error.status || 500).json({ message: error.message });
    }
});

/**
 * @desc    Upload user profile photo
 * @route   PUT /api/users/profile-photo
 */
router.put('/profile-photo', protect('user'), (req, res, next) => {
    profilePhotoUpload.single('profile_image')(req, res, (err) => {
        if (err) return res.status(400).json({ message: err.message });
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

        const profileImage = `/uploads/users/${req.file.filename}`;
        const profile = await User.findByIdAndUpdate(
            req.user._id,
            { profile_image: profileImage },
            { returnDocument: 'after', runValidators: true }
        ).select('-password');

        res.json({ message: 'Profile photo updated successfully', profile });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Change password
 * @route   PUT /api/users/change-password
 */
router.put('/change-password', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ message: 'Please provide old and new passwords' });
        }
        await changePassword(req.user._id, oldPassword, newPassword);
        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        const status = error.message === 'Incorrect old password' ? 401 : 500;
        res.status(status).json({ message: error.message });
    }
});

/**
 * @desc    Get user orders
 * @route   GET /api/users/orders
 */
router.get('/orders', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const orders = await getUserOrders(req.user._id);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    A review link for one delivered parcel — the "rate this parcel" button
 * @route   POST /api/users/orders/:id/parcels/:subOrderId/review-link
 *
 * Opens the same review page as the WhatsApp message, so there is one form to maintain.
 * Answers `{ submitted: true }` when the parcel has already been rated.
 */
router.post('/orders/:id/parcels/:subOrderId/review-link', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const reviewService = require('../services/reviewService');
        res.json(await reviewService.getParcelReviewLink(req.user._id, req.params.id, req.params.subOrderId));
    } catch (error) {
        res.status(error.status || 500).json({ message: error.message, code: error.code });
    }
});

/**
 * @desc    Get tracking info for a user's order
 * @route   GET /api/users/orders/:id/tracking
 *
 * Returns one card per PARCEL, each naming the store it comes from — the customer has to
 * be able to tell that these are different merchants, not one order behaving oddly. The
 * amount each courier will collect rides along so a cash customer is never surprised at
 * the door.
 */
router.get('/orders/:id/tracking', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const order = await Order.findOne({ _id: req.params.id, user_id: req.user._id }).lean();
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const subOrderService = require('../services/subOrderService');
        const { Seller } = require('../models/sellers');

        const vendorIds = [...new Set((order.sub_orders || []).map((s) => String(s.vendor_id)))];
        const vendors = await Seller.find({ _id: { $in: vendorIds } })
            .select('store_name store_username')
            .lean();
        const vendorMap = new Map(vendors.map((v) => [v._id.toString(), v]));

        const isCOD = order.transaction?.payment_method === 'cash';
        const waitingBySub = await require('../services/companyBatchService')
            .waitingInfoForSubs(order.sub_orders || [])
            .catch(() => new Map());
        const parcels = (order.sub_orders || []).map((sub) => {
            const view = subOrderService.toPublicSubOrder(order, sub, {
                audience: 'customer',
                vendor: vendorMap.get(String(sub.vendor_id)),
            });
            if (view.company_batch && waitingBySub.has(String(sub._id))) {
                view.company_batch.batch = waitingBySub.get(String(sub._id));
            }
            return {
                ...view,
                // Only meaningful on a cash order; a prepaid customer owes nothing at the door.
                amount_due_on_delivery: isCOD ? view.cod_amount : 0,
            };
        });

        const live = (order.sub_orders || []).filter(subOrderService.isLive);

        // Kept for anything still reading the old shape.
        const shipments = (order.shipments || []).map((s) => ({
            _id: s._id,
            sub_order_id: s.sub_order_id,
            provider: s.provider || 'bosta',
            tracking_number: s.tracking_number || s.bosta_tracking_number,
            bosta_tracking_number: s.bosta_tracking_number,
            bosta_status: s.bosta_status,
            pickup_address: s.pickup_address,
            items: s.items,
            sent_at: s.sent_at,
            last_tracked_at: s.last_tracked_at,
            tracking_history: s.tracking_history,
        }));

        res.json({
            success: true,
            shipments,
            parcels,
            order_status: order.status,
            payment_method: order.transaction?.payment_method,
            // The counter every screen shows beside the status word.
            parcel_summary: {
                total: live.length,
                delivered: live.filter((s) => s.status === 'delivered').length,
                cancelled: (order.sub_orders || []).length - live.length,
            },
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Cancel one parcel of the customer's own order
 * @route   POST /api/users/orders/:id/sub-orders/:subOrderId/cancel
 *
 * Open only while no courier has been booked for that parcel. Past that point a driver is
 * committed to collecting it, and the option is hidden from the customer and the vendor
 * alike. Cancelling refunds this parcel's own frozen share and re-checks the coupon
 * against what is left — a customer may not shrink an order under a coupon's minimum and
 * keep the discount.
 */
router.post('/orders/:id/sub-orders/:subOrderId/cancel', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const order = await Order.findOne({ _id: req.params.id, user_id: req.user._id }).select('_id').lean();
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const subOrderFlow = require('../services/subOrderFlowService');
        const result = await subOrderFlow.cancelSubOrder({
            orderId: req.params.id,
            subOrderId: req.params.subOrderId,
            reason: req.body.reason || 'Cancelled by the customer',
            actor: { role: 'user', label: req.user.name || 'Customer' },
            byRole: 'customer',
        });

        res.json({
            success: true,
            refunded: result.refunded,
            points_restored: result.points_restored,
            coupon_dropped: result.coupon_dropped,
            message: result.coupon_dropped
                ? 'Parcel cancelled. Your coupon no longer applies to what is left, so it was removed from the order.'
                : 'Parcel cancelled.',
        });
    } catch (error) {
        res.status(error.status || 400).json({
            success: false,
            code: error.code || 'CANCEL_FAILED',
            message: error.message,
        });
    }
});

/**
 * @desc    Add address
 * @route   POST /api/users/addresses
 */
router.post('/addresses', protect('user'), async (req, res) => {
    try {
        const addresses = await addAddress(req.user._id, req.body);
        res.status(201).json({ message: 'Address added successfully', addresses });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Update address
 * @route   PUT /api/users/addresses/:id
 */
router.put('/addresses/:id', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const addresses = await updateAddress(req.user._id, req.params.id, req.body);
        res.json({ message: 'Address updated successfully', addresses });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Delete address
 * @route   DELETE /api/users/addresses/:id
 */
router.delete('/addresses/:id', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const addresses = await deleteAddress(req.user._id, req.params.id);
        res.json({ message: 'Address deleted successfully', addresses });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Get user cart
 * @route   GET /api/users/cart
 */
router.get('/cart', protect('user'), async (req, res) => {
    try {
        const cart = await require('../services/userService').getCart(req.user._id);
        res.json(cart);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Sync user cart
 * @route   POST /api/users/cart
 */
router.post('/cart', protect('user'), async (req, res) => {
    try {
        const cart = await require('../services/userService').syncCart(req.user._id, req.body.items);
        res.json(cart);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Add car to user garage
 * @route   POST /api/users/cars
 */
router.post('/cars', protect('user'), async (req, res) => {
    try {
        const { addCar } = require('../services/userService');
        const cars = await addCar(req.user._id, req.body);
        res.status(201).json({ message: 'Car added successfully', cars });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    ReadyCar recommendations — parts for the user's cars and products for any car,
 *          60/40, best sellers first, nothing bought in the last 30 days.
 * @route   GET /api/users/recommendations
 * @returns { products, cars }  each product with `fit`: 'car' | 'universal'; `cars` named
 */
router.get('/recommendations', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const { getRecommendationsForUser } = require('../services/productService');
        const limit = req.query.limit ? Number(req.query.limit) : 5;
        const { products, cars } = await getRecommendationsForUser(req.user._id, limit);
        res.set('Cache-Control', 'private, no-store');
        res.json({ products, cars });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Remove car from user garage
 * @route   DELETE /api/users/cars/:id
 */
router.delete('/cars/:id', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const { deleteCar } = require('../services/userService');
        const cars = await deleteCar(req.user._id, req.params.id);
        res.json({ message: 'Car removed successfully', cars });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
