const mongoose = require('mongoose');

const contactInquirySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, default: '', trim: true },
    status: {
        type: String,
        enum: ['new', 'read', 'archived'],
        default: 'new',
        index: true,
    },
    admin_note: { type: String, default: '', trim: true },
}, {
    timestamps: true,
});

const ContactInquiry = mongoose.model('ContactInquiry', contactInquirySchema);

module.exports = { ContactInquiry };
