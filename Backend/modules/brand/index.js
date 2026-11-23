const express = require("express");
const brandController = require("./brand.controller");
const brandService = require("./brand.service");
const { Brand, ProductBrand } = require("../../models/product_brands");
const { protect } = require('../../middleware/authMiddleware');

const router = express.Router();

// Public routes
router.get("/", brandController.getBrands);
router.get("/:id", brandController.getBrand);

// Admin routes
router.post("/", protect("admin"), brandController.createBrand);
router.put("/:id", protect("admin"), brandController.updateBrand);
router.delete("/:id", protect("admin"), brandController.deleteBrand);

module.exports = {
    router,
    Brand,
    ProductBrand,
    brandService,
    brandController,
};
