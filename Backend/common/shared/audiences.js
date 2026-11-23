const mongoose = require('mongoose');

const AUDIENCE_KEYS = [
    'pro_angler', 'next_gen', 'family_safety', 'lifestyle_comfort', 'yacht_luxury',
    'diy_maintenance', 'saltwater', 'freshwater', 'smart_gear', 'eco_friendly',
];

const AUDIENCE_NAME_MAP = {
    'مستلزمات المياه المالحة': 'saltwater',
    'مستلزمات المياه المالحة والعذبة': 'saltwater',
    'المياه المالحة': 'saltwater',
    'قسم الصياد المحترف': 'pro_angler',
    'صياد محترف': 'pro_angler',
    'الصياد المحترف': 'pro_angler',
    'مستلزمات اليخوت الفاخرة': 'yacht_luxury',
    'يخوت فاخرة': 'yacht_luxury',
    'اليخوت الفاخرة': 'yacht_luxury',
    'صيانتك بنفسك': 'diy_maintenance',
    'صيانة': 'diy_maintenance',
    'صيانة ذاتية': 'diy_maintenance',
    'الرحلات والرفاهية': 'lifestyle_comfort',
    'المبتدئين والشباب': 'next_gen',
    'المياه المالحة والعذبة': 'saltwater',
    'الصيد الذكي والصديق للبيئة': 'smart_gear',
    'أمان العائلة والأطفال': 'family_safety',
    'أمان العائلة': 'family_safety',
    'القسم الصديق للبيئة': 'eco_friendly',
    'صديق للبيئة': 'eco_friendly',
    'صيد ذكي': 'smart_gear',
    'مستلزمات المياه العذبة والبحيرات': 'freshwater',
    'المياه العذبة': 'freshwater',
};

// Static fallback IDs for the 10 core marine audience hubs
const STATIC_KEY_TO_ID = {
    'yacht_luxury': new mongoose.Types.ObjectId('6afaca2236910ebda095d86a'),
    'pro_angler': new mongoose.Types.ObjectId('6afaca2236910ebda095d86b'),
    'diy_maintenance': new mongoose.Types.ObjectId('6afaca2236910ebda095d86c'),
    'lifestyle_comfort': new mongoose.Types.ObjectId('6afaca2236910ebda095d86d'),
    'next_gen': new mongoose.Types.ObjectId('6afaca2236910ebda095d86e'),
    'saltwater': new mongoose.Types.ObjectId('6afaca2236910ebda095d86f'),
    'smart_gear': new mongoose.Types.ObjectId('6afaca2236910ebda095d870'),
    'family_safety': new mongoose.Types.ObjectId('6afaca2236910ebda095d871'),
    'eco_friendly': new mongoose.Types.ObjectId('6afaca2236910ebda095d872'),
    'freshwater': new mongoose.Types.ObjectId('6afaca2236910ebda095d873'),
};

const STATIC_SLUG_TO_ID = {
    'yacht-luxury': new mongoose.Types.ObjectId('6afaca2236910ebda095d86a'),
    'pro-angler': new mongoose.Types.ObjectId('6afaca2236910ebda095d86b'),
    'diy-maintenance': new mongoose.Types.ObjectId('6afaca2236910ebda095d86c'),
    'lifestyle-comfort': new mongoose.Types.ObjectId('6afaca2236910ebda095d86d'),
    'next-gen': new mongoose.Types.ObjectId('6afaca2236910ebda095d86e'),
    'saltwater': new mongoose.Types.ObjectId('6afaca2236910ebda095d86f'),
    'smart-eco': new mongoose.Types.ObjectId('6afaca2236910ebda095d870'),
    'family-safety': new mongoose.Types.ObjectId('6afaca2236910ebda095d871'),
    'eco-friendly': new mongoose.Types.ObjectId('6afaca2236910ebda095d872'),
    'freshwater': new mongoose.Types.ObjectId('6afaca2236910ebda095d873'),
};

// In-memory key/slug/name to ObjectId map initialized with static defaults
const audienceCache = new Map();
for (const [k, id] of Object.entries(STATIC_KEY_TO_ID)) {
    audienceCache.set(k.toLowerCase(), id);
    audienceCache.set(String(id), id);
}
for (const [slug, id] of Object.entries(STATIC_SLUG_TO_ID)) {
    audienceCache.set(slug.toLowerCase(), id);
}
for (const [name, key] of Object.entries(AUDIENCE_NAME_MAP)) {
    if (STATIC_KEY_TO_ID[key]) {
        audienceCache.set(name.toLowerCase(), STATIC_KEY_TO_ID[key]);
    }
}

function updateAudienceCache(audiences = []) {
    for (const a of audiences) {
        if (!a || !a._id) continue;
        const id = a._id instanceof mongoose.Types.ObjectId ? a._id : new mongoose.Types.ObjectId(String(a._id));
        audienceCache.set(String(id), id);
        if (a.key) audienceCache.set(a.key.toLowerCase(), id);
        if (a.slug) audienceCache.set(a.slug.toLowerCase(), id);
        if (a.name_en) audienceCache.set(a.name_en.toLowerCase(), id);
        if (a.name_ar) audienceCache.set(a.name_ar.toLowerCase(), id);
    }
}

// Populate cache on demand or startup
async function refreshAudienceCache() {
    try {
        const { TargetAudience } = require('../../models/target_audiences');
        const docs = await TargetAudience.find().lean();
        updateAudienceCache(docs);
    } catch {
        // ignore if db not connected yet
    }
}

/**
 * Normalizes input list of audiences into ObjectIds synchronously.
 * Handles existing ObjectIds, string ObjectIds, populated objects, keys, slugs, and aliases.
 */
function cleanAudiencesToIds(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const item of list) {
        if (!item) continue;
        if (typeof item === 'object') {
            if (item instanceof mongoose.Types.ObjectId) {
                out.push(item);
                continue;
            }
            if (item._id && mongoose.Types.ObjectId.isValid(String(item._id))) {
                out.push(new mongoose.Types.ObjectId(String(item._id)));
                continue;
            }
            if (item.key) {
                const k = String(item.key).trim().toLowerCase();
                if (audienceCache.has(k)) {
                    out.push(audienceCache.get(k));
                    continue;
                }
            }
        }
        const str = String(item).trim();
        if (!str) continue;
        if (audienceCache.has(str)) {
            out.push(audienceCache.get(str));
        } else if (mongoose.Types.ObjectId.isValid(str) && String(new mongoose.Types.ObjectId(str)) === str) {
            out.push(new mongoose.Types.ObjectId(str));
        } else {
            const lower = str.toLowerCase();
            const keyOrAlias = AUDIENCE_NAME_MAP[lower] || lower;
            if (audienceCache.has(keyOrAlias)) {
                out.push(audienceCache.get(keyOrAlias));
            } else if (audienceCache.has(lower)) {
                out.push(audienceCache.get(lower));
            }
        }
    }
    return [...new Set(out.map(String))].map(id => new mongoose.Types.ObjectId(id));
}

/** Known keys or valid ObjectIds only, each once (for User.interests etc.) */
const cleanAudiences = (list) => {
    if (!Array.isArray(list)) return [];
    const cleaned = [];
    for (const item of list) {
        if (!item) continue;
        const str = String(item).trim();
        if (mongoose.Types.ObjectId.isValid(str)) {
            cleaned.push(str);
        } else if (AUDIENCE_KEYS.includes(str.toLowerCase())) {
            cleaned.push(str.toLowerCase());
        }
    }
    return [...new Set(cleaned)];
};

module.exports = {
    AUDIENCE_KEYS,
    cleanAudiences,
    cleanAudiencesToIds,
    updateAudienceCache,
    refreshAudienceCache,
};
