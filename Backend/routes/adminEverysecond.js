const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const everysecond = require('../services/everysecond');

/*
 * Chat commerce, admin side: where the menu sync and the webhook stand, and a
 * manual sync for when a catalogue change should reach the agent now.
 */
const router = express.Router();

router.get('/status', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, data: await everysecond.getStatus() });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ?reconcile=1 compares against what EverySecond holds rather than what was last pushed.
router.post('/sync', protect('admin'), async (req, res) => {
    try {
        const reconcile = ['1', 'true'].includes(String(req.query?.reconcile ?? req.body?.reconcile ?? ''));
        res.json({ success: true, data: await everysecond.syncCatalog({ reconcile }) });
    } catch (err) {
        res.status(502).json({ success: false, message: err.message });
    }
});

module.exports = router;
