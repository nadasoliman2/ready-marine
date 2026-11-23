/**
 * Category validation rules
 */

const validateCategoryInput = (data = {}) => {
    const errors = [];
    if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
        errors.push("اسم الفئة بالإنجليزية مطلوب (Category name in English is required).");
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
};

module.exports = {
    validateCategoryInput,
};
