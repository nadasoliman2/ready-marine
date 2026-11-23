const { Brand } = require("../../models/product_brands");
const { Product } = require('../../models/products');

/**
 * Get all brands sorted alphabetically
 */
const getAllBrands = async (filter = {}) => {
    return Brand.find(filter).sort({ name: 1 }).lean();
};

/**
 * Get single brand by ID
 */
const getBrandById = async (id) => {
    return Brand.findById(id).lean();
};

/**
 * Create a new brand
 */
const createBrand = async (data) => {
    const cleanName = String(data.name || "").trim().toLowerCase();
    const existing = await Brand.findOne({ name: cleanName });
    if (existing) {
        throw new Error("هذه الماركة موجودة بالفعل.");
    }

    const brand = new Brand({
        name: cleanName,
        image: data.image || null,
        categories: Array.isArray(data.categories) ? data.categories : [],
    });

    return brand.save();
};

/**
 * Update an existing brand
 */
const updateBrand = async (id, data) => {
    const brand = await Brand.findById(id);
    if (!brand) {
        throw new Error("الماركة غير موجودة.");
    }

    if (data.name) {
        const cleanName = String(data.name).trim().toLowerCase();
        const existing = await Brand.findOne({ name: cleanName, _id: { $ne: id } });
        if (existing) {
            throw new Error("هذا الاسم مستخدم لماركة أخرى.");
        }
        brand.name = cleanName;
    }

    if (data.image !== undefined) brand.image = data.image;
    if (Array.isArray(data.categories)) brand.categories = data.categories;

    return brand.save();
};

/**
 * Delete a brand if no published products rely on it
 */
const deleteBrand = async (id) => {
    const brand = await Brand.findById(id);
    if (!brand) {
        throw new Error("الماركة غير موجودة.");
    }

    // Check if any product is using this brand
    const inUse = await Product.countDocuments({ product_brand_id: id });
    if (inUse > 0) {
        throw new Error(`لا يمكن حذف هذه الماركة لأن هناك ${inUse} منتج مرتبط بها.`);
    }

    return Brand.findByIdAndDelete(id);
};

module.exports = {
    getAllBrands,
    getBrandById,
    createBrand,
    updateBrand,
    deleteBrand,
};
