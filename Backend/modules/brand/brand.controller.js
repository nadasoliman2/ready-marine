const brandService = require("./brand.service");
const { validateBrandInput } = require("./brand.validation");

/**
 * GET /api/brands or /api/admin/product-brands
 */
const getBrands = async (req, res) => {
    try {
        const brands = await brandService.getAllBrands();
        res.json({
            success: true,
            productBrands: brands,
            brands,
            carBrands: brands,
            vesselBrands: brands,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/brands/:id
 */
const getBrand = async (req, res) => {
    try {
        const brand = await brandService.getBrandById(req.params.id);
        if (!brand) {
            return res.status(404).json({ success: false, message: "الماركة غير موجودة" });
        }
        res.json({ success: true, brand });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * POST /api/admin/product-brands
 */
const createBrand = async (req, res) => {
    try {
        const { isValid, errors } = validateBrandInput(req.body);
        if (!isValid) {
            return res.status(400).json({ success: false, message: errors.join(" - ") });
        }

        const brand = await brandService.createBrand(req.body);
        res.status(201).json({ success: true, message: "تمت إضافة الماركة بنجاح", brand });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * PUT /api/admin/product-brands/:id
 */
const updateBrand = async (req, res) => {
    try {
        const brand = await brandService.updateBrand(req.params.id, req.body);
        res.json({ success: true, message: "تم تعديل الماركة بنجاح", brand });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * DELETE /api/admin/product-brands/:id
 */
const deleteBrand = async (req, res) => {
    try {
        await brandService.deleteBrand(req.params.id);
        res.json({ success: true, message: "تم حذف الماركة بنجاح" });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

module.exports = {
    getBrands,
    getBrand,
    createBrand,
    updateBrand,
    deleteBrand,
};
