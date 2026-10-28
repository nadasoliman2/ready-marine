/**
 * The ten marine audiences (the marketing plan's hubs): what a product is tagged with
 * (Product.target_audiences) and what a customer says they are into (User.interests).
 * Keep in step with AUDIENCE_OPTIONS in frontend/src/lib/marineHubs.js.
 */
const AUDIENCE_KEYS = [
    'pro_angler', 'next_gen', 'family_safety', 'lifestyle_comfort', 'yacht_luxury',
    'diy_maintenance', 'saltwater', 'freshwater', 'smart_gear', 'eco_friendly',
];

/** Known keys only, each once — an unknown or misspelt key would match no hub. */
const cleanAudiences = (list) => (Array.isArray(list)
    ? [...new Set(list.map((k) => String(k || '').trim()).filter((k) => AUDIENCE_KEYS.includes(k)))]
    : []);

module.exports = { AUDIENCE_KEYS, cleanAudiences };
