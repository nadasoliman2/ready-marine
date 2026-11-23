const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const campaignController = require('./campaign.controller');
const campaignService = require('./campaign.service');
const { EmailCampaign, CarEmailCampaign } = require('../../models/carEmailCampaigns');

// Public route for email recipients
router.get('/unsubscribe', campaignController.unsubscribe);

// Admin-protected routes
router.get('/logos', protect('admin'), campaignController.getLogos);
router.get('/estimate', protect('admin'), campaignController.estimateAudience);
router.get('/audience', protect('admin'), campaignController.estimateAudience);
router.get('/recommended-products', protect('admin'), campaignController.getRecommendations);
router.get('/recommendations', protect('admin'), campaignController.getRecommendations);
router.post('/preview-html', protect('admin'), campaignController.previewHtml);
router.post('/test', protect('admin'), campaignController.sendTest);
router.get('/', protect('admin'), campaignController.listCampaigns);
router.post('/', protect('admin'), campaignController.createCampaign);
router.get('/:id', protect('admin'), campaignController.getCampaignById);
router.put('/:id', protect('admin'), campaignController.updateCampaign);
router.post('/:id/send', protect('admin'), campaignController.sendCampaign);
router.delete('/:id', protect('admin'), campaignController.deleteCampaign);

module.exports = {
    router,
    EmailCampaign,
    CarEmailCampaign,
    campaignService,
    campaignController,
};
