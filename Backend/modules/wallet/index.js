const express = require('express');
const { protect, denyUnclaimedGuest } = require('../../middleware/authMiddleware');
const walletController = require('./wallet.controller');
const walletService = require('./wallet.service');
const { WalletAccount } = require('../../models/walletAccounts');
const { WalletTransaction } = require('../../models/walletTransactions');

// User routes (mounted at /api/users/wallet)
const router = express.Router();
router.get('/', protect('user'), denyUnclaimedGuest, walletController.getMyWallet);
router.get('/transactions', protect('user'), denyUnclaimedGuest, walletController.getMyTransactions);
router.post('/topup/initiate', protect('user'), denyUnclaimedGuest, walletController.initiateTopup);
router.get('/topup/:reference/status', protect('user'), denyUnclaimedGuest, walletController.getTopupStatus);

// Admin routes (mounted at /api/admin/wallet)
const adminWalletRouter = express.Router();
adminWalletRouter.get('/settings', protect('admin'), walletController.getSettings);
adminWalletRouter.put('/settings', protect('admin'), walletController.updateSettings);
adminWalletRouter.get('/stats', protect('admin'), walletController.getStats);
adminWalletRouter.get('/accounts', protect('admin'), walletController.getAllAccounts);
adminWalletRouter.get('/accounts/:userId', protect('admin'), walletController.getCustomerAccount);
adminWalletRouter.post('/accounts/:userId/adjust', protect('admin'), walletController.adjustCustomerBalance);

module.exports = {
    router,
    adminWalletRouter,
    WalletAccount,
    WalletTransaction,
    walletService,
    walletController,
};
