const express = require('express');
const { getMetaCatalogCsv } = require('../services/metaCatalogFeedService');

const router = express.Router();

/**
 * @route   GET /api/feeds/meta-catalog.csv[?lang=en]
 * @desc    The product feed for Meta Commerce Manager (Arabic unless lang=en). Public: it
 *          holds only what the product pages already show.
 */
router.get('/meta-catalog.csv', async (req, res) => {
    try {
        const lang = req.query.lang === 'en' ? 'en' : 'ar';
        const { csv, count } = await getMetaCatalogCsv(lang);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="readycar-meta-catalog-${lang}.csv"`);
        res.setHeader('Cache-Control', 'public, max-age=900');
        res.setHeader('X-Feed-Items', String(count));
        res.send(csv);
    } catch (err) {
        console.error('[Feeds] meta catalog:', err.message);
        res.status(500).json({ success: false, message: 'Feed unavailable' });
    }
});

module.exports = router;
