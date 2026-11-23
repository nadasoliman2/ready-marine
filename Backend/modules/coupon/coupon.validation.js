/**
 * Coupon validation rules
 */

const validateCouponInput = (data = {}) => {
    const errors = [];
    if (!data.code || typeof data.code !== 'string' || !data.code.trim()) {
        errors.push('كود الخصم مطلوب.');
    }
    if (!data.discount_type || !['percentage', 'fixed'].includes(data.discount_type)) {
        errors.push('نوع الخصم يجب أن يكون percentage أو fixed.');
    }
    if (data.discount_value === undefined || Number(data.discount_value) <= 0) {
        errors.push('قيمة الخصم يجب أن تكون أكبر من صفر.');
    }
    if (!data.end_date) {
        errors.push('تاريخ انتهاء الكوبون مطلوب.');
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
};

module.exports = {
    validateCouponInput,
};
