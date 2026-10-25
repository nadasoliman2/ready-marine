const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const svc = require('../services/shippingService');
const courierCost = require('../services/courierCostService');

router.use(protect('admin'));

function handle(promiseFn) {
    return async (req, res) => {
        try {
            const result = await promiseFn(req);
            res.json(result === undefined ? { success: true } : result);
        } catch (err) {
            const status = err.code === 'ZONE_IN_USE' || err.code === 'CLASS_IN_USE' ? 409 : 400;
            res.status(status).json({ success: false, message: err.message, code: err.code });
        }
    };
}

/* ------------------ Zones ------------------ */
router.get('/zones', handle(async () => ({ zones: await svc.listZones() })));
router.post('/zones', handle(async (req) => ({ zone: await svc.createZone(req.body) })));
router.get('/zones/:id', handle(async (req) => ({ zone: await svc.getZone(req.params.id) })));
router.put('/zones/:id', handle(async (req) => ({ zone: await svc.updateZone(req.params.id, req.body) })));
router.delete('/zones/:id', handle(async (req) => { await svc.deleteZone(req.params.id); return { success: true }; }));

/* ------------------ Classes ------------------ */
router.get('/classes', handle(async () => ({ classes: await svc.listClasses() })));
router.post('/classes', handle(async (req) => ({ shippingClass: await svc.createClass(req.body) })));
router.get('/classes/:id', handle(async (req) => ({ shippingClass: await svc.getClass(req.params.id) })));
router.put('/classes/:id', handle(async (req) => ({ shippingClass: await svc.updateClass(req.params.id, req.body) })));
router.delete('/classes/:id', handle(async (req) => { await svc.deleteClass(req.params.id); return { success: true }; }));

/* ------------------ Methods ------------------ */
router.get('/methods', handle(async (req) => ({ methods: await svc.listMethods({ zone_id: req.query.zone_id }) })));
router.post('/methods', handle(async (req) => ({ method: await svc.createMethod(req.body) })));
router.get('/methods/:id', handle(async (req) => ({ method: await svc.getMethod(req.params.id) })));
router.put('/methods/:id', handle(async (req) => ({ method: await svc.updateMethod(req.params.id, req.body) })));
router.delete('/methods/:id', handle(async (req) => { await svc.deleteMethod(req.params.id); return { success: true }; }));

/* ------------------ Policies ------------------ */
router.get('/policies', handle(async () => ({ policies: await svc.listPolicies() })));
router.post('/policies', handle(async (req) => ({ policy: await svc.createPolicy(req.body) })));
router.get('/policies/:id', handle(async (req) => ({ policy: await svc.getPolicy(req.params.id) })));
router.put('/policies/:id', handle(async (req) => ({ policy: await svc.updatePolicy(req.params.id, req.body) })));
router.delete('/policies/:id', handle(async (req) => { await svc.deletePolicy(req.params.id); return { success: true }; }));

/* ------------------ Subsidy report ------------------ */
/**
 * What we collected from customers for shipping against what Bosta actually billed us, for
 * a period. Read-only, and derived entirely from figures frozen on each parcel at dispatch —
 * calling it can never change a price.
 *
 * `from` / `to` are ISO dates measured on the day the parcel SHIPPED, because that is the
 * event the courier invoices. Both optional; the default is everything up to now.
 */
router.get('/subsidy', handle(async (req) => ({
    report: await courierCost.summarize({ from: req.query.from, to: req.query.to }),
})));

/* ------------------ Settings ------------------ */
router.get('/settings', handle(async () => ({ settings: await svc.getSettingsDoc() })));
router.put('/settings', handle(async (req) => ({ settings: await svc.updateSettings(req.body) })));

/* ------------------ Test console ------------------ */
router.post('/test', handle(async (req) => await svc.runTestCalculation(req.body || {})));

module.exports = router;
