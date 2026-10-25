const mongoose = require('mongoose');

const pageSchema = new mongoose.Schema({
    slug: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    title_en: {
        type: String,
        required: true,
        trim: true
    },
    title_ar: {
        type: String,
        required: true,
        trim: true
    },
    content_en: {
        type: String,
        required: true
    },
    content_ar: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

const Page = mongoose.model('Page', pageSchema);

module.exports = { Page };
