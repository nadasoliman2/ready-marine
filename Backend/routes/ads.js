const express = require('express');
const router = express.Router();
const { getActiveBanners, getHomepageBannerShift } = require('../services/adService');
const { getPromotedSectionProducts } = require('../services/productService');
const { optionalUser } = require('../middleware/authMiddleware');
const { recordEvents } = require('../services/adAnalyticsService');
const { rateLimit } = require('../middleware/rateLimit');

// A browser sends a batch every second or two at most; anything past this is a script.
const eventsLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    name: 'ad-events',
    keyOf: (req) => `v:${String(req.body?.viewer_id || '').slice(0, 64) || req.ip}`,
});

// POST /api/ads/events — public: a browser reports what it did with ads (batched).
// Always answers 204: telemetry must never break the page that sent it.
router.post('/events', eventsLimiter, optionalUser, async (req, res) => {
    try {
        const events = Array.isArray(req.body?.events) ? req.body.events : [];
        await recordEvents(events, {
            viewerId: req.body?.viewer_id || req.get('x-viewer-id') || '',
            userId: req.user?._id || null,
            userAgent: req.get('user-agent') || '',
            referrer: req.body?.referrer || req.get('referer') || '',
        });
    } catch (error) {
        console.error('[Ads] event batch failed:', error.message);
    }
    res.status(204).end();
});

// GET /api/ads/banners — public: active vendor ad banners (newest-first)
router.get('/banners', async (req, res) => {
    try {
        const limit = Number(req.query.limit || 20);
        const banners = await getActiveBanners(limit);
        res.json({ banners });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/ads/homepage-banners — lightweight, fair, time-shifted homepage slider
router.get('/homepage-banners', async (req, res) => {
    try {
        const result = await getHomepageBannerShift({ limit: req.query.limit });
        const secondsUntilNextShift = Math.max(
            1,
            Math.floor((result.nextShiftAt.getTime() - Date.now()) / 1000)
        );
        const browserMaxAge = Math.min(60, secondsUntilNextShift);
        const sharedMaxAge = Math.min(300, secondsUntilNextShift);

        res.set('Cache-Control', `public, max-age=${browserMaxAge}, s-maxage=${sharedMaxAge}, must-revalidate`);
        res.json({
            slides: result.slides,
            total_candidates: result.totalCandidates,
            shift_count: result.shiftCount,
            active_shift: result.activeShiftIndex + 1,
            shift_duration_minutes: result.shiftMinutes,
            next_shift_at: result.nextShiftAt.toISOString(),
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/ads/promoted-products — public: products for the homepage "Promoted Products" row
router.get('/promoted-products', async (req, res) => {
    try {
        const limit = Number(req.query.limit || 8);
        const products = await getPromotedSectionProducts(limit);
        res.json({ products });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
