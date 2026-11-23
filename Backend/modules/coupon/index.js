const express = require("express");
const couponController = require("./coupon.controller");
const couponService = require("./coupon.service");
const { Coupon } = require("../../models/coupons");
const { protect } = require('../../middleware/authMiddleware');

const router = express.Router();

// User routes
router.post("/validate", protect("user"), couponController.validateCoupon);

// Admin routes
router.get("/", protect("admin"), couponController.getCoupons);
router.post("/", protect("admin"), couponController.createCoupon);

module.exports = {
    router,
    Coupon,
    couponService,
    couponController,
};
