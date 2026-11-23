const { Category } = require("../../models/categories");

/**
 * Get category tree with hierarchy
 */
const getCategoryTree = async () => {
    const all = await Category.find({ is_active: true }).sort({ sort_order: 1, name: 1 }).lean();
    const map = new Map(all.map((c) => [String(c._id), { ...c, subcategories: [] }]));
    const roots = [];

    for (const cat of map.values()) {
        if (cat.parent_id && map.has(String(cat.parent_id))) {
            map.get(String(cat.parent_id)).subcategories.push(cat);
        } else {
            roots.push(cat);
        }
    }
    return roots;
};

/**
 * Get all flat categories
 */
const getAllCategories = async (filter = {}) => {
    return Category.find(filter).sort({ sort_order: 1, name: 1 }).lean();
};

/**
 * Get single category
 */
const getCategoryById = async (id) => {
    return Category.findById(id).lean();
};

/**
 * Create category
 */
const createCategory = async (data) => {
    const category = new Category({
        name: String(data.name).trim(),
        name_ar: data.name_ar ? String(data.name_ar).trim() : undefined,
        parent_id: data.parent_id || null,
        image: data.image || null,
        sort_order: Number(data.sort_order) || 0,
        is_active: data.is_active !== undefined ? Boolean(data.is_active) : true,
        type_ids: Array.isArray(data.type_ids) ? data.type_ids : [],
    });
    return category.save();
};

/**
 * Update category
 */
const updateCategory = async (id, data) => {
    const cat = await Category.findById(id);
    if (!cat) throw new Error("الفئة غير موجودة.");

    if (data.name) cat.name = String(data.name).trim();
    if (data.name_ar !== undefined) cat.name_ar = data.name_ar ? String(data.name_ar).trim() : null;
    if (data.parent_id !== undefined) cat.parent_id = data.parent_id || null;
    if (data.image !== undefined) cat.image = data.image;
    if (data.sort_order !== undefined) cat.sort_order = Number(data.sort_order) || 0;
    if (data.is_active !== undefined) cat.is_active = Boolean(data.is_active);
    if (Array.isArray(data.type_ids)) cat.type_ids = data.type_ids;

    return cat.save();
};

/**
 * Delete category
 */
const deleteCategory = async (id) => {
    const hasChildren = await Category.countDocuments({ parent_id: id });
    if (hasChildren > 0) {
        throw new Error("لا يمكن حذف هذه الفئة لأنها تحتوي على فئات فرعية.");
    }
    return Category.findByIdAndDelete(id);
};

module.exports = {
    getCategoryTree,
    getAllCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
};
