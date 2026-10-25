/**
 * Admin Subscription Packages Router
 * Full CRUD for subscription packages (admin only)
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { SubscriptionPackage } = require('../models/subscriptionPackages');

const parseBoolean = (value) => value === true || value === 'true';

/**
 * Get all subscription packages
 * @route   GET /api/admin/subscription-packages
 * @access  Private (Admin)
 */
router.get('/', protect('admin'), async (req, res) => {
    try {
        const packages = await SubscriptionPackage.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, packages });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Get single subscription package
 * @route   GET /api/admin/subscription-packages/:id
 * @access  Private (Admin)
 */
router.get('/:id', protect('admin'), async (req, res) => {
    try {
        const pkg = await SubscriptionPackage.findById(req.params.id).lean();
        if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
        res.json({ success: true, package: pkg });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Create a subscription package
 * @route   POST /api/admin/subscription-packages
 * @access  Private (Admin)
 */
router.post('/', protect('admin'), async (req, res) => {
    try {
        const { name, name_ar, description, description_ar, price, billing_period, max_products, status, is_free_trial, trial_days, grants_vendors_page, grants_home_slider } = req.body;
        const isTrial = parseBoolean(is_free_trial);

        if (!name || (!isTrial && price === undefined) || (!isTrial && !billing_period) || !max_products) {
            return res.status(400).json({ success: false, message: isTrial
                ? 'name and max_products are required for free trial packages'
                : 'name, price, billing_period, and max_products are required' });
        }

        if (!isTrial) {
            if (!['monthly', 'yearly'].includes(billing_period)) {
                return res.status(400).json({ success: false, message: 'billing_period must be "monthly" or "yearly"' });
            }
            if (Number(price) < 0) {
                return res.status(400).json({ success: false, message: 'price must be non-negative' });
            }
        }

        if (Number(max_products) < 1) {
            return res.status(400).json({ success: false, message: 'max_products must be at least 1' });
        }

        const pkg = await SubscriptionPackage.create({
            name: name.trim(),
            name_ar: name_ar?.trim() || '',
            description: description || '',
            description_ar: description_ar?.trim() || '',
            price: isTrial ? 0 : Number(price),
            billing_period: isTrial ? 'trial' : billing_period,
            max_products: Number(max_products),
            status: status || 'active',
            is_free_trial: isTrial,
            trial_days: isTrial ? (trial_days !== undefined ? Number(trial_days) : 7) : 0,
            grants_vendors_page: grants_vendors_page !== undefined ? parseBoolean(grants_vendors_page) : true,
            grants_home_slider: grants_home_slider !== undefined ? parseBoolean(grants_home_slider) : false,
        });

        res.status(201).json({ success: true, package: pkg });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Update a subscription package
 * @route   PUT /api/admin/subscription-packages/:id
 * @access  Private (Admin)
 */
router.put('/:id', protect('admin'), async (req, res) => {
    try {
        const { name, name_ar, description, description_ar, price, billing_period, max_products, status, is_free_trial, trial_days, grants_vendors_page, grants_home_slider } = req.body;

        const pkg = await SubscriptionPackage.findById(req.params.id);
        if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });

        if (name !== undefined) pkg.name = name.trim();
        if (name_ar !== undefined) pkg.name_ar = name_ar.trim();
        if (description !== undefined) pkg.description = description.trim();
        if (description_ar !== undefined) pkg.description_ar = description_ar.trim();

        // Determine final trial status (updated value or existing)
        const isTrial = is_free_trial !== undefined ? parseBoolean(is_free_trial) : pkg.is_free_trial;
        if (is_free_trial !== undefined) pkg.is_free_trial = isTrial;

        if (isTrial) {
            // Free trial packages: force billing_period=trial and price=0
            pkg.billing_period = 'trial';
            pkg.price = 0;
        } else {
            if (price !== undefined) pkg.price = Number(price);
            if (billing_period !== undefined) {
                if (!['monthly', 'yearly'].includes(billing_period)) {
                    return res.status(400).json({ success: false, message: 'billing_period must be "monthly" or "yearly"' });
                }
                pkg.billing_period = billing_period;
            }
        }

        if (max_products !== undefined) pkg.max_products = Number(max_products);
        if (status !== undefined) {
            if (!['active', 'inactive'].includes(status)) {
                return res.status(400).json({ success: false, message: 'status must be "active" or "inactive"' });
            }
            pkg.status = status;
        }
        if (trial_days !== undefined) pkg.trial_days = Number(trial_days);
        if (grants_vendors_page !== undefined) pkg.grants_vendors_page = parseBoolean(grants_vendors_page);
        if (grants_home_slider !== undefined) pkg.grants_home_slider = parseBoolean(grants_home_slider);

        await pkg.save();
        res.json({ success: true, package: pkg });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Delete a subscription package
 * @route   DELETE /api/admin/subscription-packages/:id
 * @access  Private (Admin)
 */
router.delete('/:id', protect('admin'), async (req, res) => {
    try {
        const pkg = await SubscriptionPackage.findByIdAndDelete(req.params.id);
        if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
        res.json({ success: true, message: 'Package deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Toggle package status (activate/deactivate)
 * @route   PUT /api/admin/subscription-packages/:id/status
 * @access  Private (Admin)
 */
router.put('/:id/status', protect('admin'), async (req, res) => {
    try {
        const pkg = await SubscriptionPackage.findById(req.params.id);
        if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });

        pkg.status = pkg.status === 'active' ? 'inactive' : 'active';
        await pkg.save();

        res.json({ success: true, package: pkg });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
