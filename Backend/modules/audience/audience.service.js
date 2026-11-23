const mongoose = require('mongoose');
const { TargetAudience } = require('../../models/target_audiences');
const { Product } = require('../../models/products');

const INITIAL_AUDIENCES = [
    {
        key: 'yacht_luxury',
        slug: 'yacht-luxury',
        name_ar: 'مستلزمات اليخوت الفاخرة',
        name_en: 'Premium Yacht Luxury',
        badge_ar: 'فخامة واعتناء فائق',
        badge_en: 'Ultra-Luxury VIP',
        description_ar: 'يضم أنظمة الإضاءة الفاخرة تحت الماء، شاشات الملاحة الذكية، إكسسوارات الستانلس 316 المصقولة، والديكورات البحرية الراقية.',
        description_en: 'Underwater LED lights, smart chartplotters, polished 316 stainless fittings, and nautical decor.',
        image: '/images/hubs/yacht-luxury.png',
        card_position: 'large',
        sort_order: 1,
        is_active: true,
        slider_active: true,
    },
    {
        key: 'pro_angler',
        slug: 'pro-angler',
        name_ar: 'قسم الصياد المحترف',
        name_en: 'Pro-Angler Hub',
        badge_ar: 'احتراف وأداء فائق',
        badge_en: 'Pro Performance',
        description_ar: 'أجهزة السونار المتقدمة، قطع غيار المحركات الثقيلة (سوزوكي وهوندا)، ومعدات الصيد في المياه العميقة.',
        description_en: 'Advanced CHIRP sonars, heavy outboard parts, and deep-water big game tackle.',
        image: '/images/hubs/pro-angler.jpg',
        card_position: 'large',
        sort_order: 2,
        is_active: true,
        slider_active: true,
    },
    {
        key: 'diy_maintenance',
        slug: 'diy-maintenance',
        name_ar: 'صيانتك بنفسك',
        name_en: 'DIY Boat Maintenance',
        badge_ar: 'أطقم توفير وصيانة ذاتية',
        badge_en: 'Cost-Saving DIY Kits',
        description_ar: 'مجموعات جاهزة لتغيير الزيت، البويات البحرية، أطقم ريش طلمبات المياه، وأدوات إصلاح الفايبر جلاس.',
        description_en: 'Complete oil service kits, water pump impellers, zinc anodes, and fiberglass patch kits.',
        image: '/images/hubs/diy-maintenance.jpg',
        card_position: 'large',
        sort_order: 3,
        is_active: true,
        slider_active: true,
    },
    {
        key: 'lifestyle_comfort',
        slug: 'lifestyle-comfort',
        name_ar: 'الرحلات والرفاهية',
        name_en: 'Lifestyle & Comfort',
        badge_ar: 'استجمام وراحة تامة',
        badge_en: 'Pure Leisure & Chill',
        description_ar: 'كراسي قوارب مريحة، ثلاجات حفظ أطعمة ومشروبات، وأنظمة صوت بحرية مقاومة للماء.',
        description_en: 'Ergonomic helm seats, heavy-duty iceboxes, and waterproof marine audio.',
        image: '/images/hubs/lifestyle-comfort.jpg',
        card_position: 'small_top',
        sort_order: 1,
        is_active: true,
        slider_active: true,
    },
    {
        key: 'next_gen',
        slug: 'next-gen',
        name_ar: 'المبتدئين والشباب',
        name_en: 'Next-Gen Boaters',
        badge_ar: 'شباب ونشاط (20-35)',
        badge_en: 'Young & Active (20-35)',
        description_ar: 'ألواح ويك بورد وتجديف، أطواق ومصايف، ومعدات صيد سهلة الاستخدام بأسعار اقتصادية.',
        description_en: 'Wakeboards, SUP boards, towables, and easy-to-use budget fishing gear.',
        image: '/images/hubs/next-gen.jpg',
        card_position: 'small_top',
        sort_order: 2,
        is_active: true,
        slider_active: true,
    },
    {
        key: 'saltwater',
        slug: 'saltwater',
        name_ar: 'المياه المالحة والعذبة',
        name_en: 'Saltwater & Freshwater',
        badge_ar: 'معدات بيئات متخصصة',
        badge_en: 'Specialized Waters',
        description_ar: 'قطع غيار مقاومة للملوحة والصدأ، قوارب كاياك، ومعدات صيد نهرية وبحرية.',
        description_en: 'Corrosion-proof hardware, kayaks, and freshwater/saltwater tackle.',
        image: '/images/hubs/saltwater.jpg',
        card_position: 'small_top',
        sort_order: 3,
        is_active: true,
        slider_active: true,
    },
    {
        key: 'smart_gear',
        slug: 'smart-eco',
        name_ar: 'الصيد الذكي والصديق للبيئة',
        name_en: 'Smart & Eco-Friendly Marine',
        badge_ar: 'تكنولوجيا ذكية',
        badge_en: 'Smart Tech & Eco',
        description_ar: 'طائرات درون لإسقاط الطعوم، ساعات بحرية ذكية، كاميرات تصوير، ومنظفات صديقة للبيئة.',
        description_en: 'Bait drones, marine GPS watches, underwater cameras, and eco boat cleaners.',
        image: '/images/hubs/smart-gear.jpg',
        card_position: 'small_bottom',
        sort_order: 1,
        is_active: true,
        slider_active: true,
    },
    {
        key: 'family_safety',
        slug: 'family-safety',
        name_ar: 'أمان العائلة والأطفال',
        name_en: 'Family & Kids Safety',
        badge_ar: 'أمان وراحة بال عائلية',
        badge_en: 'Family Safety First',
        description_ar: 'سترات نجاة معتمدة للأطفال، أطواق نجاة، أدوات صيد آمنة للصغار، وحقائب إسعافات.',
        description_en: 'Certified kids life vests, safety buoys, child-safe tackle, and marine first aid.',
        image: '/images/hubs/family-safety.jpg',
        card_position: 'small_bottom',
        sort_order: 2,
        is_active: true,
        slider_active: true,
    },
    {
        key: 'eco_friendly',
        slug: 'eco-friendly',
        name_ar: 'القسم الصديق للبيئة',
        name_en: 'Eco-Friendly Marine',
        badge_ar: 'استدامة وحلول بيئية',
        badge_en: 'Clean & Sustainable',
        description_ar: 'طعوم صيد قابلة للتحلل، منظفات قوارب صديقة للبيئة، ومعدات طاقة شمسية وتجديف.',
        description_en: 'Biodegradable lures, eco boat wash, and lightweight paddle/solar equipment.',
        image: '/images/hubs/eco-friendly.jpg',
        card_position: 'small_bottom',
        sort_order: 3,
        is_active: true,
        slider_active: true,
    },
    {
        key: 'freshwater',
        slug: 'freshwater',
        name_ar: 'مستلزمات المياه العذبة والبحيرات',
        name_en: 'Freshwater & Lake Fishing',
        badge_ar: 'مياه عذبة وبحيرات',
        badge_en: 'Freshwater Specialist',
        description_ar: 'معدات الصيد والإبحار الخاصة بالبحيرات والأنهار والمياه العذبة.',
        description_en: 'Freshwater tackle, lake navigation, and river boating equipment.',
        image: '/images/hubs/saltwater.jpg',
        card_position: 'hidden',
        sort_order: 4,
        is_active: true,
        slider_active: false,
    },
];

/**
 * Seed initial target audiences into DB if collection is empty
 */
async function seedInitialAudiences() {
    try {
        const count = await TargetAudience.countDocuments();
        if (count === 0) {
            console.log('[TargetAudience] Seeding initial marine target audiences...');
            await TargetAudience.insertMany(INITIAL_AUDIENCES);
            console.log('[TargetAudience] Seeding complete.');
        }

        // One-time migration: migrate any products that have string keys in target_audiences to ObjectIds
        const allAudiences = await TargetAudience.find().lean();
        const { updateAudienceCache } = require('../../common/shared/audiences');
        updateAudienceCache(allAudiences);
        const keyToId = new Map();
        for (const aud of allAudiences) {
            keyToId.set(aud.key, aud._id);
            keyToId.set(aud.slug, aud._id);
        }

        // Find products with non-ObjectId string values in target_audiences
        const sampleProds = await Product.find({ 'target_audiences.0': { $exists: true } })
            .select('_id target_audiences')
            .lean();

        for (const p of sampleProds) {
            const rawAuds = p.target_audiences || [];
            let needsUpdate = false;
            const newAudIds = [];

            for (const item of rawAuds) {
                if (mongoose.Types.ObjectId.isValid(item)) {
                    newAudIds.push(new mongoose.Types.ObjectId(item));
                } else if (typeof item === 'string' && keyToId.has(item.trim().toLowerCase())) {
                    newAudIds.push(keyToId.get(item.trim().toLowerCase()));
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                await Product.updateOne(
                    { _id: p._id },
                    { $set: { target_audiences: [...new Set(newAudIds.map(String))].map(id => new mongoose.Types.ObjectId(id)) } }
                );
            }
        }
    } catch (err) {
        console.error('[TargetAudience] Seed/Migration error:', err.message);
    }
}

/**
 * Get all target audiences
 */
async function getAllAudiences(filter = {}) {
    return TargetAudience.find(filter).sort({ card_position: 1, sort_order: 1, createdAt: 1 }).lean();
}

/**
 * Get audience by ID, key, or slug
 */
async function getAudienceByIdOrSlug(idOrSlug) {
    if (!idOrSlug) return null;
    const s = String(idOrSlug).trim();
    if (mongoose.Types.ObjectId.isValid(s)) {
        const doc = await TargetAudience.findById(s).lean();
        if (doc) return doc;
    }
    return TargetAudience.findOne({
        $or: [{ slug: s.toLowerCase() }, { key: s.toLowerCase() }],
    }).lean();
}

/**
 * Get hero slider cards structured for CardAutoSlider
 */
async function getSliderCards() {
    await seedInitialAudiences();
    const active = await TargetAudience.find({ is_active: true, slider_active: true })
        .sort({ sort_order: 1, createdAt: 1 })
        .lean();

    const toSlide = (item) => ({
        _id: item._id,
        slug: item.slug,
        titleAr: item.name_ar,
        titleEn: item.name_en,
        badgeAr: item.badge_ar,
        badgeEn: item.badge_en,
        descAr: item.description_ar,
        descEn: item.description_en,
        image: item.image || '/images/hubs/yacht-luxury.png',
    });

    const largeSlides = active.filter((a) => a.card_position === 'large').map(toSlide);
    const smallTopSlides = active.filter((a) => a.card_position === 'small_top').map(toSlide);
    const smallBottomSlides = active.filter((a) => a.card_position === 'small_bottom').map(toSlide);

    return {
        large: {
            id: 'large_featured',
            large: true,
            intervalMs: 4200,
            slides: largeSlides.length ? largeSlides : INITIAL_AUDIENCES.filter((a) => a.card_position === 'large').map(toSlide),
        },
        small_top: {
            id: 'small_top',
            large: false,
            intervalMs: 4800,
            slides: smallTopSlides.length ? smallTopSlides : INITIAL_AUDIENCES.filter((a) => a.card_position === 'small_top').map(toSlide),
        },
        small_bottom: {
            id: 'small_bottom',
            large: false,
            intervalMs: 5400,
            slides: smallBottomSlides.length ? smallBottomSlides : INITIAL_AUDIENCES.filter((a) => a.card_position === 'small_bottom').map(toSlide),
        },
    };
}

/**
 * Get audiences with product count stats for the Admin Dashboard
 */
async function getAudiencesWithStats() {
    await seedInitialAudiences();
    const audiences = await TargetAudience.find().sort({ card_position: 1, sort_order: 1, createdAt: -1 }).lean();

    const counts = await Product.aggregate([
        { $unwind: '$target_audiences' },
        { $group: { _id: '$target_audiences', count: { $sum: 1 } } },
    ]);

    const countMap = new Map();
    for (const c of counts) {
        countMap.set(String(c._id), c.count);
    }

    return audiences.map((aud) => ({
        ...aud,
        products_count: (countMap.get(String(aud._id)) || 0) + (countMap.get(aud.key) || 0) + (countMap.get(aud.slug) || 0),
    }));
}

/**
 * Helper to generate a unique key or slug
 */
function toSlug(str) {
    return String(str || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u0621-\u064A]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Create a new audience
 */
async function createAudience(data) {
    const nameAr = String(data.name_ar || '').trim();
    const nameEn = String(data.name_en || '').trim();
    if (!nameAr || !nameEn) {
        throw new Error('Arabic and English names are required.');
    }

    let slug = toSlug(data.slug || nameEn || nameAr);
    if (!slug) slug = 'group-' + Date.now().toString(36);
    let key = toSlug(data.key || slug).replace(/-/g, '_');

    // Ensure uniqueness
    let existing = await TargetAudience.findOne({ $or: [{ slug }, { key }] });
    if (existing) {
        slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
        key = `${key}_${Date.now().toString(36).slice(-4)}`;
    }

    const doc = new TargetAudience({
        key,
        slug,
        name_ar: nameAr,
        name_en: nameEn,
        description_ar: String(data.description_ar || '').trim(),
        description_en: String(data.description_en || '').trim(),
        badge_ar: String(data.badge_ar || '').trim(),
        badge_en: String(data.badge_en || '').trim(),
        image: String(data.image || '').trim(),
        card_position: ['large', 'small_top', 'small_bottom', 'hidden'].includes(data.card_position) ? data.card_position : 'large',
        sort_order: Number(data.sort_order) || 0,
        is_active: data.is_active !== undefined ? !!data.is_active : true,
        slider_active: data.slider_active !== undefined ? !!data.slider_active : true,
    });

    return doc.save();
}

/**
 * Update an existing audience
 */
async function updateAudience(id, data) {
    const audience = await TargetAudience.findById(id);
    if (!audience) throw new Error('Target audience not found.');

    if (data.name_ar) audience.name_ar = String(data.name_ar).trim();
    if (data.name_en) audience.name_en = String(data.name_en).trim();
    if (data.description_ar !== undefined) audience.description_ar = String(data.description_ar).trim();
    if (data.description_en !== undefined) audience.description_en = String(data.description_en).trim();
    if (data.badge_ar !== undefined) audience.badge_ar = String(data.badge_ar).trim();
    if (data.badge_en !== undefined) audience.badge_en = String(data.badge_en).trim();
    if (data.image !== undefined) audience.image = String(data.image).trim();
    if (data.card_position && ['large', 'small_top', 'small_bottom', 'hidden'].includes(data.card_position)) {
        audience.card_position = data.card_position;
    }
    if (data.sort_order !== undefined) audience.sort_order = Number(data.sort_order) || 0;
    if (data.is_active !== undefined) audience.is_active = !!data.is_active;
    if (data.slider_active !== undefined) audience.slider_active = !!data.slider_active;

    if (data.slug) {
        const cleanSlug = toSlug(data.slug);
        const dup = await TargetAudience.findOne({ slug: cleanSlug, _id: { $ne: id } });
        if (dup) throw new Error('Slug already in use by another audience.');
        audience.slug = cleanSlug;
    }

    return audience.save();
}

/**
 * Delete an audience
 */
async function deleteAudience(id) {
    const audience = await TargetAudience.findById(id);
    if (!audience) throw new Error('Target audience not found.');

    // Unset reference from products
    await Product.updateMany(
        { target_audiences: audience._id },
        { $pull: { target_audiences: audience._id } }
    );

    return TargetAudience.findByIdAndDelete(id);
}

const ALIAS_MAP = {
    'مستلزمات المياه المالحة': 'saltwater',
    'مستلزمات المياه المالحة والعذبة': 'saltwater',
    'المياه المالحة': 'saltwater',
    'صياد محترف': 'pro_angler',
    'الصياد المحترف': 'pro_angler',
    'يخوت فاخرة': 'yacht_luxury',
    'اليخوت الفاخرة': 'yacht_luxury',
    'صيانة': 'diy_maintenance',
    'صيانة ذاتية': 'diy_maintenance',
    'أمان العائلة': 'family_safety',
    'صديق للبيئة': 'eco_friendly',
    'صيد ذكي': 'smart_gear',
};

/**
 * Takes array of inputs (ObjectIds, keys, slugs, names) and resolves them to TargetAudience ObjectIds
 */
async function resolveAudienceIds(inputList = []) {
    if (!Array.isArray(inputList) || !inputList.length) return [];
    const allAudiences = await TargetAudience.find().lean();
    const map = new Map();
    for (const a of allAudiences) {
        map.set(String(a._id), a._id);
        map.set(a.key.toLowerCase(), a._id);
        map.set(a.slug.toLowerCase(), a._id);
        map.set(a.name_en.toLowerCase(), a._id);
        map.set(a.name_ar.toLowerCase(), a._id);
    }

    const resolved = [];
    for (const raw of inputList) {
        const s = String(raw || '').trim().toLowerCase();
        if (map.has(s)) {
            resolved.push(map.get(s));
        } else if (ALIAS_MAP[s] && map.has(ALIAS_MAP[s])) {
            resolved.push(map.get(ALIAS_MAP[s]));
        } else if (mongoose.Types.ObjectId.isValid(s)) {
            resolved.push(new mongoose.Types.ObjectId(s));
        }
    }

    return [...new Set(resolved.map(String))].map((id) => new mongoose.Types.ObjectId(id));
}

module.exports = {
    seedInitialAudiences,
    getAllAudiences,
    getAudienceByIdOrSlug,
    getSliderCards,
    getAudiencesWithStats,
    createAudience,
    updateAudience,
    deleteAudience,
    resolveAudienceIds,
};
