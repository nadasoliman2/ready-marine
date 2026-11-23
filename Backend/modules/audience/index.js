const express = require('express');
const audienceController = require('./audience.controller');
const audienceService = require('./audience.service');
const { TargetAudience } = require('../../models/target_audiences');
const { protect } = require('../../middleware/authMiddleware');

const router = express.Router();

// Public routes
router.get('/', audienceController.getAll);
router.get('/slider', audienceController.getSlider);

// Admin-only stats & management
router.get('/admin/all', protect('admin'), audienceController.getAdminAll);
router.post('/admin', protect('admin'), audienceController.create);
router.post('/', protect('admin'), audienceController.create);
router.put('/admin/:id', protect('admin'), audienceController.update);
router.put('/:id', protect('admin'), audienceController.update);
router.delete('/admin/:id', protect('admin'), audienceController.remove);
router.delete('/:id', protect('admin'), audienceController.remove);

// Public single audience by ID, key, or slug
router.get('/:idOrSlug', audienceController.getByIdOrSlug);

module.exports = {
    router,
    TargetAudience,
    audienceService,
    audienceController,
};
