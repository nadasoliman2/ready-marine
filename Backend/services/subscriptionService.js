/**
 * Subscription Service
 * Handles subscription package CRUD for admin and vendor browsing.
 */
const { SubscriptionPackage, getActivePackages, getAllPackages, getPackageById, createPackage, updatePackage, deletePackage, togglePackageStatus } = require('../models/subscriptionPackages');

module.exports = {
    getActivePackages,
    getAllPackages,
    getPackageById,
    createPackage,
    updatePackage,
    deletePackage,
    togglePackageStatus,
};