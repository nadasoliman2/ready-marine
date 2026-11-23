const audienceService = require('./audience.service');

/**
 * GET /api/target-audiences
 * Public: Get all active audiences
 */
async function getAll(req, res) {
    try {
        const audiences = await audienceService.getAllAudiences({ is_active: true });
        res.json({ success: true, audiences });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * GET /api/target-audiences/slider
 * Public: Get dynamic slider cards formatted for CardAutoSlider hero component
 */
async function getSlider(req, res) {
    try {
        const slider = await audienceService.getSliderCards();
        res.json({ success: true, slider });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * GET /api/target-audiences/admin/all
 * Admin: Get all audiences with product counts & management details
 */
async function getAdminAll(req, res) {
    try {
        const audiences = await audienceService.getAudiencesWithStats();
        res.json({ success: true, audiences });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * GET /api/target-audiences/:idOrSlug
 * Public: Get single audience by id or slug
 */
async function getByIdOrSlug(req, res) {
    try {
        const audience = await audienceService.getAudienceByIdOrSlug(req.params.idOrSlug);
        if (!audience) {
            return res.status(404).json({ success: false, message: 'المجموعة المخصصة غير موجودة' });
        }
        res.json({ success: true, audience });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * POST /api/target-audiences
 * Admin: Create new target audience
 */
async function create(req, res) {
    try {
        const audience = await audienceService.createAudience(req.body);
        res.status(201).json({ success: true, message: 'تم إنشاء المجموعة المخصصة بنجاح', audience });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
}

/**
 * PUT /api/target-audiences/:id
 * Admin: Update target audience
 */
async function update(req, res) {
    try {
        const audience = await audienceService.updateAudience(req.params.id, req.body);
        res.json({ success: true, message: 'تم تحديث المجموعة المخصصة بنجاح', audience });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
}

/**
 * DELETE /api/target-audiences/:id
 * Admin: Delete target audience
 */
async function remove(req, res) {
    try {
        await audienceService.deleteAudience(req.params.id);
        res.json({ success: true, message: 'تم حذف المجموعة المخصصة بنجاح' });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
}

module.exports = {
    getAll,
    getSlider,
    getAdminAll,
    getByIdOrSlug,
    create,
    update,
    remove,
};
