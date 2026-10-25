const { Service } = require('../models/services');

function toSlug(input = '') {
    return String(input || '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}-]+/gu, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

async function generateServiceSlug(baseText, lang = 'en', excludeId = null) {
    const base = toSlug(baseText) || `service-${Date.now().toString(36)}`;
    const field = lang === 'ar' ? 'slug_ar' : 'slug_en';

    let slug = base;
    let counter = 1;

    while (true) {
        const query = { [field]: slug };
        if (excludeId) query._id = { $ne: excludeId };
        const exists = await Service.exists(query);
        if (!exists) return slug;
        slug = `${base}-${counter++}`;
    }
}

function normalizePhone(value = '') {
    return String(value).replace(/[^\d+]/g, '').trim();
}

function normalizeWhatsappNumber(value = '') {
    return String(value).replace(/\D/g, '').trim();
}

function normalizeSocialLinks(links = []) {
    if (!Array.isArray(links)) return [];
    return links
        .map(link => ({
            platform: String(link?.platform || 'other').toLowerCase().trim(),
            url: String(link?.url || '').trim(),
        }))
        .filter(link => link.url);
}

function normalizeServiceLocations(raw = {}) {
    if (Array.isArray(raw.locations)) {
        return raw.locations
            .map(location => {
                const legacyName = String(location?.name || '').trim();
                const legacyLanguage = location?.language === 'ar' ? 'ar' : 'en';
                return {
                    name_en: String(location?.name_en || (legacyLanguage === 'en' ? legacyName : '')).trim(),
                    name_ar: String(location?.name_ar || (legacyLanguage === 'ar' ? legacyName : '')).trim(),
                    link: String(location?.link || '').trim(),
                };
            })
            .filter(location => location.name_en || location.name_ar);
    }

    const locations = [];
    const locationEn = String(raw.vendor_location_en || '').trim();
    const locationAr = String(raw.vendor_location_ar || '').trim();

    if (locationEn) {
        locations.push({ name_en: locationEn, name_ar: locationAr, link: '' });
    } else if (locationAr) {
        locations.push({ name_en: '', name_ar: locationAr, link: '' });
    }

    return locations;
}

function prepareServicePayload(raw = {}) {
    const hasPrice = raw.price !== undefined && raw.price !== null && raw.price !== '';
    const parsedPrice = Number(raw.price);
    const hasExplicitLocations = Array.isArray(raw.locations);
    const locations = normalizeServiceLocations(raw);
    const firstEnLocation = locations.find(location => location.name_en)?.name_en || '';
    const firstArLocation = locations.find(location => location.name_ar)?.name_ar || '';

    const payload = {
        title_en: String(raw.title_en || '').trim(),
        title_ar: String(raw.title_ar || '').trim(),

        description_en: String(raw.description_en || '').trim(),
        description_ar: String(raw.description_ar || '').trim(),

        vendor_name_en: String(raw.vendor_name_en || '').trim(),
        vendor_name_ar: String(raw.vendor_name_ar || '').trim(),

        vendor_location_en: hasExplicitLocations ? firstEnLocation : (firstEnLocation || String(raw.vendor_location_en || '').trim()),
        vendor_location_ar: hasExplicitLocations ? firstArLocation : (firstArLocation || String(raw.vendor_location_ar || '').trim()),
        locations,

        status: raw.status === 'inactive' ? 'inactive' : 'active',
        featured: Boolean(raw.featured),
        show_in_banner_ad_slider: Boolean(raw.show_in_banner_ad_slider),
        price: hasPrice && Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null,

        images: Array.isArray(raw.images) ? raw.images : [],
        social_links: normalizeSocialLinks(raw.social_links),
    };

    payload.phones = (Array.isArray(raw.phones) ? raw.phones : [])
        .map(normalizePhone)
        .filter(Boolean);

    payload.whatsapp_numbers = (Array.isArray(raw.whatsapp_numbers) ? raw.whatsapp_numbers : [])
        .map(normalizeWhatsappNumber)
        .filter(Boolean);

    return payload;
}

async function getAllServices(filters = {}) {
    const {
        page = 1,
        limit = 12,
        search,
        status = 'active',
        featured,
        sort = 'newest',
    } = filters;

    const query = {};

    if (status) query.status = status;
    if (featured === 'true') query.featured = true;
    if (featured === 'false') query.featured = false;

    if (search) {
        query.$or = [
            { title_en: { $regex: search, $options: 'i' } },
            { title_ar: { $regex: search, $options: 'i' } },
            { description_en: { $regex: search, $options: 'i' } },
            { description_ar: { $regex: search, $options: 'i' } },
            { vendor_name_en: { $regex: search, $options: 'i' } },
            { vendor_name_ar: { $regex: search, $options: 'i' } },
            { vendor_location_en: { $regex: search, $options: 'i' } },
            { vendor_location_ar: { $regex: search, $options: 'i' } },
            { 'locations.name_en': { $regex: search, $options: 'i' } },
            { 'locations.name_ar': { $regex: search, $options: 'i' } },
            { 'locations.link': { $regex: search, $options: 'i' } },
        ];
    }

    let sortOptions = { created_at: -1 };
    if (sort === 'oldest') sortOptions = { created_at: 1 };
    if (sort === 'featured') sortOptions = { featured: -1, created_at: -1 };

    const skip = (Number(page) - 1) * Number(limit);

    const [services, total] = await Promise.all([
        Service.find(query)
            .sort(sortOptions)
            .skip(skip)
            .limit(Number(limit))
            .lean(),
        Service.countDocuments(query),
    ]);

    return {
        services,
        pagination: {
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit)),
            limit: Number(limit),
        },
    };
}

async function getFeaturedServices(limit = 6) {
    return Service.find({ status: 'active', featured: true })
        .sort({ created_at: -1 })
        .limit(Number(limit))
        .lean();
}

async function getBannerAdServices(limit = 6) {
    return Service.find({ status: 'active', show_in_banner_ad_slider: true })
        .sort({ created_at: -1 })
        .limit(Number(limit))
        .lean();
}

async function getServiceBySlug(slug) {
    return Service.findOne({
        $or: [{ slug_en: slug }, { slug_ar: slug }],
    }).lean();
}

async function getServiceById(id) {
    return Service.findById(id).lean();
}

module.exports = {
    toSlug,
    generateServiceSlug,
    normalizePhone,
    normalizeWhatsappNumber,
    normalizeSocialLinks,
    normalizeServiceLocations,
    prepareServicePayload,
    getAllServices,
    getFeaturedServices,
    getBannerAdServices,
    getServiceBySlug,
    getServiceById,
};
