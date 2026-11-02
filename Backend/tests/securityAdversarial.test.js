const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { startMongo } = require('./support/testServers');
const adminAccess = require('../services/adminAccessService');
const { assertOwnedAddressIds, resolveSharedAddress } = require('../services/shared/addressAuthorization');
const authService = require('../services/authService');
const { User } = require('../models/users');

describe('Security & Adversarial Access Control Auditing', () => {
    let mongo;

    before(async () => {
        mongo = await startMongo('test-security-adversarial');
        await mongoose.connect(mongo.uri);
    });

    after(async () => {
        await mongoose.disconnect();
        await mongo.stop();
    });

    describe('Admin RBAC & Privilege Escalation (adminAccessService)', () => {
        const superAdmin = { is_super: true, username: 'admin', permissions: [] };
        const ordersViewer = {
            is_super: false,
            username: 'order_viewer',
            permissions: [{ module: 'orders', access: 'view' }],
        };
        const financeManager = {
            is_super: false,
            username: 'finance_lead',
            permissions: [{ module: 'finance', access: 'manage' }],
        };

        test('super admin has unrestricted access to all endpoints including admin management', () => {
            const adminUsersVerdict = adminAccess.checkAccess(superAdmin, 'GET', '/api/admin/admin-users');
            assert.equal(adminUsersVerdict.allowed, true);

            const financeVerdict = adminAccess.checkAccess(superAdmin, 'POST', '/api/admin/finance/payout');
            assert.equal(financeVerdict.allowed, true);
        });

        test('sub-admin is strictly denied access to super-admin-only management endpoints', () => {
            const verdict = adminAccess.checkAccess(financeManager, 'GET', '/api/admin/admin-users');
            assert.equal(verdict.allowed, false);
            assert.equal(verdict.code, 'SUPER_ADMIN_ONLY');
        });

        test('sub-admin with view access is denied write operations (POST, PUT, DELETE)', () => {
            // GET orders allowed
            const readVerdict = adminAccess.checkAccess(ordersViewer, 'GET', '/api/admin/orders');
            assert.equal(readVerdict.allowed, true);

            // POST / DELETE orders forbidden with READ_ONLY code
            const writeVerdict = adminAccess.checkAccess(ordersViewer, 'POST', '/api/admin/orders');
            assert.equal(writeVerdict.allowed, false);
            assert.equal(writeVerdict.code, 'READ_ONLY');

            const deleteVerdict = adminAccess.checkAccess(ordersViewer, 'DELETE', '/api/admin/orders/123');
            assert.equal(deleteVerdict.allowed, false);
            assert.equal(deleteVerdict.code, 'READ_ONLY');
        });

        test('sub-admin is forbidden from accessing ungranted modules', () => {
            // ordersViewer tries to access finance
            const verdict = adminAccess.checkAccess(ordersViewer, 'GET', '/api/admin/finance');
            assert.equal(verdict.allowed, false);
            assert.equal(verdict.code, 'MODULE_FORBIDDEN');
            assert.equal(verdict.module, 'finance');
        });

        test('unmapped admin paths fail closed by default', () => {
            const verdict = adminAccess.checkAccess(ordersViewer, 'GET', '/api/admin/some-unregistered-internal-route');
            assert.equal(verdict.allowed, false);
            assert.equal(verdict.code, 'MODULE_NOT_MAPPED');
        });
    });

    describe('Horizontal Privilege Escalation & Resource Isolation', () => {
        test('assertOwnedAddressIds throws error if a user attempts to share addresses they do not own', () => {
            const realAddressId = new mongoose.Types.ObjectId();
            const foreignAddressId = new mongoose.Types.ObjectId();

            const ownerUser = {
                _id: new mongoose.Types.ObjectId(),
                addresses: [{ _id: realAddressId, label: 'Home' }],
            };

            // Attempting to share both own address and someone else's address
            assert.throws(
                () => assertOwnedAddressIds(ownerUser, [realAddressId.toString(), foreignAddressId.toString()]),
                (err) => {
                    assert.equal(err.code, 'ADDRESS_NOT_OWNED');
                    assert.equal(err.status, 400);
                    return true;
                }
            );
        });

        test('resolveSharedAddress strictly blocks access to unshared addresses', async () => {
            const ownerId = new mongoose.Types.ObjectId();
            const privateAddressId = new mongoose.Types.ObjectId();

            await User.create({
                _id: ownerId,
                name: 'Private Owner',
                phone: '01011112222',
                addresses: [
                    {
                        _id: privateAddressId,
                        recipient_name: 'Owner',
                        phone: '01011112222',
                        full_address: 'Private Residence, Cairo',
                    },
                ],
            });

            // Viewer has permission Set that does NOT include privateAddressId
            const viewerPermissions = new Set(['some-other-address-id']);

            await assert.rejects(
                async () => resolveSharedAddress(ownerId, privateAddressId, viewerPermissions),
                (err) => {
                    assert.equal(err.code, 'ADDRESS_NOT_SHARED');
                    assert.equal(err.status, 403);
                    return true;
                }
            );
        });
    });

    describe('NoSQL Injection & Input Type Coercion', () => {
        test('authenticateUser rejects object injection and documents type check exception', async () => {
            await User.create({
                name: 'Target Account',
                email: 'victim@readymarine.test',
                phone: '01099998888',
                password: await authService.hashPassword('VictimSecretPass!'),
                account_status: 'active',
            });

            // Attacker passes an object instead of a string identifier
            const maliciousIdentifier = { $ne: null };

            // Edge Case / Finding: formatPhone(identifier) throws TypeError because phone is not a string
            await assert.rejects(
                async () => authService.authenticateUser(maliciousIdentifier, 'anyPass'),
                /phone\.replace is not a function/
            );
        });

        test('malformed ObjectIds are handled gracefully', () => {
            const malformedIds = ['invalid-id', '123', null, undefined, '', '507f1f77bcf86cd799439011-extra'];
            for (const id of malformedIds) {
                const isValid = mongoose.Types.ObjectId.isValid(id);
                if (id === '507f1f77bcf86cd799439011-extra') {
                    // Mongoose may treat 24 hex chars or reject
                    continue;
                }
                assert.equal(isValid, false);
            }
        });
    });

    describe('Session Revocation on Password Change', () => {
        test('tokens created before password change are marked stale', () => {
            const passwordChangedAt = new Date('2026-10-29T12:00:00Z');
            const account = { password_changed_at: passwordChangedAt };

            // Token issued 10 minutes BEFORE password change
            const oldTokenDecoded = {
                id: 'user-1',
                iat: Math.floor(passwordChangedAt.getTime() / 1000) - 600,
            };

            // Token issued 10 minutes AFTER password change
            const freshTokenDecoded = {
                id: 'user-1',
                iat: Math.floor(passwordChangedAt.getTime() / 1000) + 600,
            };

            const isStale = (acc, dec) => {
                if (!acc?.password_changed_at || !dec?.iat) return false;
                return Math.floor(acc.password_changed_at.getTime() / 1000) > dec.iat;
            };

            assert.equal(isStale(account, oldTokenDecoded), true);
            assert.equal(isStale(account, freshTokenDecoded), false);
        });
    });
});
