const express = require('express');
const router = express.Router();
const {
    getAllServices,
    getFeaturedServices,
    getBannerAdServices,
    getServiceBySlug,
} = require('../services/serviceService');

// GET /api/services
router.get('/', async (req, res) => {
    try {
        const result = await getAllServices({ ...req.query, status: 'active' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/services/featured
router.get('/featured', async (req, res) => {
    try {
        const limit = Number(req.query.limit || 6);
        const services = await getFeaturedServices(limit);
        res.json({ services });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/services/banner-ads
router.get('/banner-ads', async (req, res) => {
    try {
        const limit = Number(req.query.limit || 6);
        const services = await getBannerAdServices(limit);
        res.json({ services });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/services/slug/:slug
router.get('/slug/:slug', async (req, res) => {
    try {
        const service = await getServiceBySlug(req.params.slug);
        if (!service || service.status !== 'active') {
            return res.status(404).json({ message: 'Service not found' });
        }
        res.json(service);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
