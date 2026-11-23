/**
 * Campaign validation rules
 */

const validateCampaignInput = (data = {}) => {
    const errors = [];
    if (!data.title || typeof data.title !== 'string' || !data.title.trim()) {
        errors.push('عنوان الحملة الداخلي مطلوب.');
    }
    if (!data.subject || typeof data.subject !== 'string' || !data.subject.trim()) {
        errors.push('عنوان البريد (Subject) مطلوب.');
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
};

module.exports = {
    validateCampaignInput,
};
