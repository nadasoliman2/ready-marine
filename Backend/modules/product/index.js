const express = require('express');
const router = express.Router();
const productController = require('./product.controller');
const productService = require('./product.service');
const { Product } = require('../../models/products');
const { CatalogEntry } = require('../../models/catalogEntries');
const { ProductType } = require('../../models/productTypes');
const { optionalUser } = require('../../middleware/authMiddleware');

router.get('/categories', productController.getCategories);
router.get('/filters', productController.getFilters);
router.get('/vessel-brands/:id/models', productController.getBrandModels);
router.get('/boat-brands/:id/models', productController.getBrandModels);
router.get('/car-brands/:id/models', productController.getBrandModels);
router.get('/suggest', productController.getSuggestions);
router.get('/', optionalUser, productController.getAllProducts);
router.get('/landing/:section', productController.getLandingProducts);
router.get('/slug/:slug', productController.getProductBySlug);
router.get('/:id([0-9a-fA-F]{24})', productController.getProductById);

module.exports = {
    router,
    Product,
    CatalogEntry,
    ProductType,
    productService,
    productController,
};
