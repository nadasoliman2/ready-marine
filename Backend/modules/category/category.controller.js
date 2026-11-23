const categoryService = require("./category.service");
const { validateCategoryInput } = require("./category.validation");

/**
 * GET /api/categories (tree)
 */
const getTree = async (req, res) => {
    try {
        const tree = await categoryService.getCategoryTree();
        res.json({ success: true, categories: tree });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/categories/all (flat)
 */
const getAll = async (req, res) => {
    try {
        const categories = await categoryService.getAllCategories();
        res.json({ success: true, categories });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/categories/:id
 */
const getById = async (req, res) => {
    try {
        const category = await categoryService.getCategoryById(req.params.id);
        if (!category) return res.status(404).json({ success: false, message: "الفئة غير موجودة" });
        res.json({ success: true, category });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * POST /api/categories
 */
const create = async (req, res) => {
    try {
        const { isValid, errors } = validateCategoryInput(req.body);
        if (!isValid) return res.status(400).json({ success: false, message: errors.join(" - ") });

        const category = await categoryService.createCategory(req.body);
        res.status(201).json({ success: true, message: "تم إنشاء الفئة بنجاح", category });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * PUT /api/categories/:id
 */
const update = async (req, res) => {
    try {
        const category = await categoryService.updateCategory(req.params.id, req.body);
        res.json({ success: true, message: "تم تعديل الفئة بنجاح", category });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * DELETE /api/categories/:id
 */
const remove = async (req, res) => {
    try {
        await categoryService.deleteCategory(req.params.id);
        res.json({ success: true, message: "تم حذف الفئة بنجاح" });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

module.exports = {
    getTree,
    getAll,
    getById,
    create,
    update,
    remove,
};
