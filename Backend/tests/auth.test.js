const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { startMongo } = require('./support/testServers');
const authService = require('../services/authService');
const { User } = require('../models/users');

describe('Authentication & Account Security', () => {
    let mongo;

    before(async () => {
        mongo = await startMongo('test-auth-service');
        await mongoose.connect(mongo.uri);
    });

    after(async () => {
        await mongoose.disconnect();
        await mongo.stop();
    });

    describe('Input Sanitization & Normalization', () => {
        test('formatPhone strips non-digit characters', () => {
            assert.equal(authService.formatPhone('+20 (100) 123-4567'), '201001234567');
            assert.equal(authService.formatPhone('010-1234-5678'), '01012345678');
        });

        test('normalizeEmailForAuth produces canonical email addresses', () => {
            assert.equal(authService.normalizeEmailForAuth('  Captain.Ahab+sea@GMAIL.com  '), 'captainahab@gmail.com');
            assert.equal(authService.normalizeEmailForAuth('user.test@custom-domain.com'), 'user.test@custom-domain.com');
        });
    });

    describe('Password Hashing & Verification', () => {
        test('hashes password with bcrypt and verifies matching and non-matching passwords', async () => {
            const rawPassword = 'SuperSecretMarinePassword!123';
            const hash = await authService.hashPassword(rawPassword);

            assert.notEqual(hash, rawPassword);
            assert.ok(hash.startsWith('$2'));

            const validMatch = await authService.comparePassword(rawPassword, hash);
            assert.equal(validMatch, true);

            const wrongMatch = await authService.comparePassword('WrongPassword123', hash);
            assert.equal(wrongMatch, false);
        });
    });

    describe('JWT Token Generation & Role Isolation', () => {
        test('generates valid JWT with specified claims', () => {
            const secret = 'test-jwt-secret-xyz';
            const payload = { id: 'user-123', role: 'user' };
            const token = authService.generateToken(payload, secret, '1h');

            const decoded = jwt.verify(token, secret);
            assert.equal(decoded.id, 'user-123');
            assert.equal(decoded.role, 'user');
        });

        test('token fails verification when checked with mismatched role secret', () => {
            const userSecret = 'user-secret-111';
            const adminSecret = 'admin-secret-222';

            const userToken = authService.generateToken({ id: 'user-123', role: 'user' }, userSecret);

            assert.throws(
                () => jwt.verify(userToken, adminSecret),
                jwt.JsonWebTokenError
            );
        });
    });

    describe('Passwordless Account Guard', () => {
        test('authenticateUser strictly rejects accounts with null or empty password', async () => {
            // Guest or Google OAuth account without password set
            const user = await User.create({
                name: 'Guest Sailor',
                email: 'guest.sailor@readymarine.test',
                phone: '01011119999',
                password: null, // No password set
                account_status: 'guest',
            });

            await assert.rejects(
                async () => authService.authenticateUser(user.email, 'anyPassword123'),
                /Invalid credentials/
            );

            await assert.rejects(
                async () => authService.authenticateUser(user.phone, ''),
                /Invalid credentials/
            );
        });
    });

    describe('Duplicate Registration & Guest Claiming', () => {
        test('rejects duplicate email and phone for registered users', async () => {
            const user = await User.create({
                name: 'Registered Sailor',
                email: 'sailor@readymarine.test',
                phone: '01022228888',
                password: await authService.hashPassword('Pass12345!'),
                account_status: 'active',
                phone_verified_at: new Date(),
            });

            await assert.rejects(
                async () => authService.registerUser({
                    name: 'Duplicate Email',
                    email: user.email,
                    phone: '01033337777',
                    password: 'Password1234!',
                }),
                /Email already in use/
            );

            await assert.rejects(
                async () => authService.registerUser({
                    name: 'Duplicate Phone',
                    email: 'different@readymarine.test',
                    phone: user.phone,
                    password: 'Password1234!',
                }),
                /Phone already in use/
            );
        });
    });
});
