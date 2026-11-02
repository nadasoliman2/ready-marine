const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    evaluateCondition,
    evaluateConditions,
    applyRuleActions,
    applyPolicyActions,
} = require('../services/shippingRules');

describe('Shipping Rules & Condition Engine', () => {
    describe('evaluateCondition - Numeric Fields', () => {
        const ctx = {
            cart_total: 500,
            cart_total_after_discount: 450,
            total_weight: 12.5,
            item_count: 3,
            vendor_count: 2,
        };

        test('handles equality, inequality, and ranges', () => {
            assert.equal(evaluateCondition({ field: 'cart_total', operator: 'eq', value: 500 }, ctx), true);
            assert.equal(evaluateCondition({ field: 'cart_total', operator: 'eq', value: 400 }, ctx), false);
            assert.equal(evaluateCondition({ field: 'cart_total', operator: 'ne', value: 400 }, ctx), true);

            assert.equal(evaluateCondition({ field: 'total_weight', operator: 'gt', value: 10 }, ctx), true);
            assert.equal(evaluateCondition({ field: 'total_weight', operator: 'gte', value: 12.5 }, ctx), true);
            assert.equal(evaluateCondition({ field: 'total_weight', operator: 'lt', value: 15 }, ctx), true);
            assert.equal(evaluateCondition({ field: 'total_weight', operator: 'lte', value: 12.5 }, ctx), true);
        });

        test('handles "in" and "not_in" operators with numbers', () => {
            assert.equal(evaluateCondition({ field: 'vendor_count', operator: 'in', value: [1, 2, 3] }, ctx), true);
            assert.equal(evaluateCondition({ field: 'vendor_count', operator: 'not_in', value: [4, 5] }, ctx), true);
            assert.equal(evaluateCondition({ field: 'vendor_count', operator: 'in', value: [5, 6] }, ctx), false);
        });
    });

    describe('evaluateCondition - Membership Fields', () => {
        const ctx = {
            classes: new Set(['class-heavy', 'class-fragile']),
            categories: new Set(['cat-electronics', 'cat-marine']),
            vendors: new Set(['vendor-1', 'vendor-2']),
        };

        test('checks presence in set using eq, in, contains', () => {
            assert.equal(evaluateCondition({ field: 'has_class', operator: 'eq', value: 'class-heavy' }, ctx), true);
            assert.equal(evaluateCondition({ field: 'has_class', operator: 'in', value: ['class-unknown', 'class-fragile'] }, ctx), true);
            assert.equal(evaluateCondition({ field: 'has_class', operator: 'contains', value: 'class-heavy' }, ctx), true);
            assert.equal(evaluateCondition({ field: 'has_class', operator: 'eq', value: 'class-hazmat' }, ctx), false);
        });

        test('checks absence using ne and not_in', () => {
            assert.equal(evaluateCondition({ field: 'has_vendor', operator: 'ne', value: 'vendor-99' }, ctx), true);
            assert.equal(evaluateCondition({ field: 'has_vendor', operator: 'not_in', value: ['vendor-99', 'vendor-88'] }, ctx), true);
            assert.equal(evaluateCondition({ field: 'has_vendor', operator: 'ne', value: 'vendor-1' }, ctx), false);
        });
    });

    describe('evaluateCondition - String Fields', () => {
        const ctx = { country: 'Egypt', city: 'Alexandria' };

        test('normalizes case and whitespace', () => {
            assert.equal(evaluateCondition({ field: 'country', operator: 'eq', value: ' egypt ' }, ctx), true);
            assert.equal(evaluateCondition({ field: 'city', operator: 'eq', value: 'alexandria' }, ctx), true);
            assert.equal(evaluateCondition({ field: 'city', operator: 'contains', value: 'alex' }, ctx), true);
            assert.equal(evaluateCondition({ field: 'city', operator: 'in', value: ['Cairo', 'Alexandria'] }, ctx), true);
            assert.equal(evaluateCondition({ field: 'city', operator: 'not_in', value: ['Giza', 'Aswan'] }, ctx), true);
        });
    });

    describe('evaluateConditions - Combination Logic', () => {
        const ctx = { cart_total: 1000, item_count: 5 };
        const cond1 = { field: 'cart_total', operator: 'gte', value: 500 };
        const cond2 = { field: 'item_count', operator: 'lt', value: 2 };

        test('logic "all" requires all conditions to be satisfied', () => {
            assert.equal(evaluateConditions([cond1], 'all', ctx), true);
            assert.equal(evaluateConditions([cond1, cond2], 'all', ctx), false);
        });

        test('logic "any" requires at least one condition to be satisfied', () => {
            assert.equal(evaluateConditions([cond1, cond2], 'any', ctx), true);
            assert.equal(evaluateConditions([{ field: 'item_count', operator: 'gt', value: 10 }], 'any', ctx), false);
        });

        test('empty conditions list defaults to true', () => {
            assert.equal(evaluateConditions([], 'all', ctx), true);
            assert.equal(evaluateConditions([], 'any', ctx), true);
        });
    });

    describe('applyRuleActions', () => {
        test('applies fixed fee, percentage, clamp min/max, and free shipping', () => {
            let cost = 50;
            const clamp = { min: null, max: null };
            const sink = [];

            // Add fixed 20 -> 70
            let res = applyRuleActions(cost, [{ type: 'add_fixed', value: 20 }], clamp, sink, 'Rule 1');
            assert.equal(res.cost, 70);
            assert.equal(res.stop, false);

            // Add percent 10% on 70 -> 77
            res = applyRuleActions(res.cost, [{ type: 'add_percent', value: 10 }], clamp, sink, 'Rule 2');
            assert.equal(res.cost, 77);

            // Set clamp limits
            applyRuleActions(res.cost, [{ type: 'set_min_fee', value: 30 }, { type: 'set_max_fee', value: 100 }], clamp, sink, 'Rule Clamps');
            assert.equal(clamp.min, 30);
            assert.equal(clamp.max, 100);

            // Free shipping zeroes cost and sets stop=true
            res = applyRuleActions(res.cost, [{ type: 'free_shipping' }], clamp, sink, 'Free Ship');
            assert.equal(res.cost, 0);
            assert.equal(res.stop, true);
        });
    });

    describe('applyPolicyActions', () => {
        test('applies discount, surcharge, and free shipping accurately', () => {
            let cost = 100;
            const clamp = { min: null, max: null };
            const sink = [];
            const policySink = [];

            // 20% discount on 100 -> 80
            let res = applyPolicyActions(cost, [{ type: 'percent_discount', value: 20 }], clamp, sink, policySink, {});
            assert.equal(res.cost, 80);
            assert.equal(res.freeShipping, false);

            // Fixed surcharge +15 -> 95
            res = applyPolicyActions(res.cost, [{ type: 'surcharge_fixed', value: 15 }], clamp, sink, policySink, {});
            assert.equal(res.cost, 95);

            // Free shipping
            res = applyPolicyActions(res.cost, [{ type: 'free_shipping' }], clamp, sink, policySink, {});
            assert.equal(res.cost, 0);
            assert.equal(res.freeShipping, true);
        });
    });
});
