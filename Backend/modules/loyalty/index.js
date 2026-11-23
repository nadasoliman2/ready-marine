const express = require('express');
const { protect, denyUnclaimedGuest } = require('../../middleware/authMiddleware');
const loyaltyController = require('./loyalty.controller');
const loyaltyService = require('./loyalty.service');
const { LoyaltyAccount } = require('../../models/loyaltyAccounts');
const { LoyaltyTransaction } = require('../../models/loyaltyTransactions');

// User routes (mounted at /api/users/loyalty)
const router = express.Router();
router.get('/', protect('user'), denyUnclaimedGuest, loyaltyController.getMyWallet);
router.get('/transactions', protect('user'), denyUnclaimedGuest, loyaltyController.getMyTransactions);

// Admin routes (mounted at /api/admin/loyalty)
const adminLoyaltyRouter = express.Router();
adminLoyaltyRouter.get('/settings', protect('admin'), loyaltyController.getSettings);
adminLoyaltyRouter.put('/settings', protect('admin'), loyaltyController.updateSettings);
adminLoyaltyRouter.get('/stats', protect('admin'), loyaltyController.getStats);
adminLoyaltyRouter.get('/accounts', protect('admin'), loyaltyController.getAcccounts);
adminLoyaltyRouter.get('/accounts/:userId', protect('admin'), loyaltyController.getCustomerAccount);
adminLoyaltyRouter.post('/accounts/:userId/adjust', protect('admin'), loyaltyController.adjustCustomerPoints);
adminLoyaltyRouter.get('/audit', protect('admin'), loyaltyController.getAuditLogs);

module.exports = {
    router,
    adminLoyaltyRouter,
    LoyaltyAccount,
    LoyaltyTransaction,
    loyaltyService,
    loyaltyController,
};
