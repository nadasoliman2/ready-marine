/**
 * Brand validation rules
 */

const validateBrandInput = (data = {}) => {
    const errors = [];
    if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
        errors.push("اسم الماركة مطلوب (Brand name is required).");
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
};

module.exports = {
    validateBrandInput,
};
