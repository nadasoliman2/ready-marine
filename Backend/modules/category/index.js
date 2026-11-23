const express = require("express");
const categoryController = require("./category.controller");
const categoryService = require("./category.service");
const { Category } = require("../../models/categories");
const { protect } = require('../../middleware/authMiddleware');

const router = express.Router();

// Public routes
router.get("/", categoryController.getTree);
router.get("/tree", categoryController.getTree);
router.get("/all", categoryController.getAll);
router.get("/:id", categoryController.getById);

// Admin routes
router.post("/", protect("admin"), categoryController.create);
router.put("/:id", protect("admin"), categoryController.update);
router.delete("/:id", protect("admin"), categoryController.remove);

module.exports = {
    router,
    Category,
    categoryService,
    categoryController,
};
