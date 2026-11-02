const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { startMongo } = require('./support/testServers');
const walletService = require('../services/walletService');
const { WalletAccount } = require('../models/walletAccounts');
const { WalletTransaction } = require('../models/walletTransactions');

describe('Wallet Ledger & Balance Service', () => {
    let mongo;

    before(async () => {
        mongo = await startMongo('test-wallet-ledger');
        await mongoose.connect(mongo.uri);
    });

    after(async () => {
        await mongoose.disconnect();
        await mongo.stop();
    });

    test('toMinor and toMajor convert correctly with banker/half-up rounding', () => {
        assert.equal(walletService.toMinor(10.5), 1050);
        assert.equal(walletService.toMinor('25.99'), 2599);
        assert.equal(walletService.toMinor(12.345), 1235); // 12.345 rounds to 1235 minor
        assert.equal(walletService.toMinor('invalid'), 0);
        assert.equal(walletService.toMinor(null), 0);

        assert.equal(walletService.toMajor(1050), 10.50);
        assert.equal(walletService.toMajor(2599), 25.99);
        assert.equal(walletService.toMajor(0), 0);
    });

    test('validateSettingsPatch validates topup suggestions and clamps inputs', () => {
        const patch = {
            enabled: true,
            topup_suggestions: [500, 100, 250, 100, 50],
            online_payment_enabled: false,
        };
        const cleaned = walletService.validateSettingsPatch(patch);
        assert.equal(cleaned.enabled, true);
        assert.equal(cleaned.online_payment_enabled, false);
        // Deduplicated and sorted ascending
        assert.deepEqual(cleaned.topup_suggestions, [50, 100, 250, 500]);

        // Throws if suggestions is not an array
        assert.throws(
            () => walletService.validateSettingsPatch({ topup_suggestions: 'not-an-array' }),
            /Top-up suggestions must be a list of amounts/
        );

        // Throws if more than 8 suggestions
        assert.throws(
            () => walletService.validateSettingsPatch({
                topup_suggestions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
            }),
            /At most 8 top-up suggestions can be shown/
        );
    });

    test('getOrCreateAccount creates an account idempotently', async () => {
        const userId = new mongoose.Types.ObjectId();
        const account1 = await walletService.getOrCreateAccount(userId);
        assert.ok(account1._id);
        assert.equal(account1.available_minor, 0);

        const account2 = await walletService.getOrCreateAccount(userId);
        assert.equal(account1._id.toString(), account2._id.toString());
    });

    test('applyLedgerEntry credits funds and records transaction', async () => {
        const userId = new mongoose.Types.ObjectId();
        const topupId = new mongoose.Types.ObjectId();

        const result = await walletService.applyLedgerEntry({
            userId,
            type: 'topup',
            amountMinor: 5000, // 50.00 EGP
            deltas: { available: 5000 },
            lifetime: { topped_up: 5000 },
            idempotencyKey: `topup:${topupId}:credit`,
            topupId,
            reason: 'Test Top-up',
        });

        assert.equal(result.duplicate, false);
        assert.equal(result.account.available_minor, 5000);
        assert.equal(result.transaction.amount_minor, 5000);

        // Verify public balance representation
        const balance = await walletService.getBalances(userId);
        assert.equal(balance.available, 50.00);
        assert.equal(balance.spendable, 50.00);
    });

    test('applyLedgerEntry is idempotent and prevents duplicate credits', async () => {
        const userId = new mongoose.Types.ObjectId();
        const topupId = new mongoose.Types.ObjectId();
        const idempotencyKey = `topup:${topupId}:credit`;

        // First application
        const first = await walletService.applyLedgerEntry({
            userId,
            type: 'topup',
            amountMinor: 2000,
            deltas: { available: 2000 },
            idempotencyKey,
        });
        assert.equal(first.duplicate, false);

        // Duplicate call with exact same key
        const second = await walletService.applyLedgerEntry({
            userId,
            type: 'topup',
            amountMinor: 2000,
            deltas: { available: 2000 },
            idempotencyKey,
        });
        assert.equal(second.duplicate, true);

        // Balance must remain 2000, NOT 4000
        const currentMinor = await walletService.getSpendableMinor(userId);
        assert.equal(currentMinor, 2000);
    });

    test('applyLedgerEntry rejects overdraft via atomic conditional query', async () => {
        const userId = new mongoose.Types.ObjectId();
        // Account has 0 balance
        await walletService.getOrCreateAccount(userId);

        await assert.rejects(
            async () => {
                await walletService.applyLedgerEntry({
                    userId,
                    type: 'order_payment',
                    amountMinor: 1000,
                    deltas: { available: -1000 },
                    idempotencyKey: `spend:${new mongoose.Types.ObjectId()}`,
                });
            },
            (err) => {
                assert.equal(err.code, 'INSUFFICIENT_BALANCE');
                return true;
            }
        );
    });

    test('assertSpendable rejects operations on frozen wallets', async () => {
        const userId = new mongoose.Types.ObjectId();
        const account = await walletService.getOrCreateAccount(userId);
        account.status = 'frozen';
        account.frozen_reason = 'Suspected fraudulent activity';
        await account.save();

        await assert.rejects(
            async () => {
                await walletService.assertSpendable(userId);
            },
            (err) => {
                assert.equal(err.code, 'WALLET_FROZEN');
                assert.match(err.message, /Suspected fraudulent activity/);
                return true;
            }
        );
    });
});
