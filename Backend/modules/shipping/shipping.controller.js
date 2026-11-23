const shippingService = require('./shipping.service');
const shippingEngine = require('./shipping.engine');
const courierCost = require('./courier_cost.service');
const { City } = require('../../models/cities');

/**
 * GET /api/shipping/zones
 */
const getZonesTree = async (req, res) => {
    try {
        const [tree, settings] = await Promise.all([
            shippingService.getZonePickerTree(),
            shippingEngine.getSettings(),
        ]);
        res.json({
            tree,
            config: {
                enabled: settings.enabled,
                multi_vendor_mode: settings.multi_vendor_mode,
                single_country: tree.length === 1 ? tree[0].country : null,
                single_country_ar: tree.length === 1 ? (tree[0].country_ar || tree[0].country) : null,
                single_country_has_wildcard: tree.length === 1 ? !!tree[0].has_whole_country_option : false,
            },
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/**
 * GET /api/shipping/cities
 */
const getCities = async (req, res) => {
    try {
        const cities = await City.find().sort({ name: 1 }).lean();
        res.json({ cities });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/**
 * GET /api/shipping/classes
 */
const getClasses = async (req, res) => {
    try {
        const classes = await shippingService.listActiveClasses();
        res.json({ classes });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/**
 * POST /api/shipping/quote
 */
const getQuote = async (req, res) => {
    try {
        const { items, destination } = req.body || {};
        const quote = await shippingEngine.getQuoteForDestination({
            items: items || [],
            destination: destination || {},
            useCache: true,
        });
        res.json(quote);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/* ------------------ Admin Handlers ------------------ */

const listAdminZones = async (req, res) => {
    try {
        res.json({ zones: await shippingService.listZones() });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

const createAdminZone = async (req, res) => {
    try {
        res.json({ zone: await shippingService.createZone(req.body) });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

const updateAdminZone = async (req, res) => {
    try {
        res.json({ zone: await shippingService.updateZone(req.params.id, req.body) });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

const deleteAdminZone = async (req, res) => {
    try {
        await shippingService.deleteZone(req.params.id);
        res.json({ success: true });
    } catch (err) {
        const status = err.code === 'ZONE_IN_USE' ? 409 : 400;
        res.status(status).json({ success: false, message: err.message, code: err.code });
    }
};

const getSubsidyReport = async (req, res) => {
    try {
        res.json({ report: await courierCost.summarize({ from: req.query.from, to: req.query.to }) });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

const getAdminSettings = async (req, res) => {
    try {
        res.json({ settings: await shippingService.getSettingsDoc() });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

const updateAdminSettings = async (req, res) => {
    try {
        res.json({ settings: await shippingService.updateSettings(req.body) });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

module.exports = {
    getZonesTree,
    getCities,
    getClasses,
    getQuote,
    listAdminZones,
    createAdminZone,
    updateAdminZone,
    deleteAdminZone,
    getSubsidyReport,
    getAdminSettings,
    updateAdminSettings,
};
