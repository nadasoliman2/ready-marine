require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { ShippingSettings } = require('../models/shipping_settings');
const { ShippingClass } = require('../models/shipping_classes');
const { ShippingZone } = require('../models/shipping_zones');
const { ShippingMethod } = require('../models/shipping_methods');
const { ShippingPolicy } = require('../models/shipping_policies');
const { connectToDatabase } = require('./db');

const DEFAULT_CLASSES = [
    { name: 'Light', name_ar: 'خفيف', description: 'Small, lightweight items.', default_handling_fee: 0 },
    { name: 'Heavy', name_ar: 'ثقيل', description: 'Bulky or heavy items.', default_handling_fee: 0 },
    { name: 'Fragile', name_ar: 'قابل للكسر', description: 'Items needing careful handling.', default_handling_fee: 0 },
    { name: 'Perishable', name_ar: 'قابل للتلف', description: 'Items with a limited shelf life.', default_handling_fee: 0 },
];

async function seed() {
    let shouldDisconnect = false;
    try {
        if (mongoose.connection.readyState === 0) {
            await connectToDatabase();
            console.log('Connected to DB');
            shouldDisconnect = true;
        }

        // NOTE: ShippingSettings is created LAST. The app's startup check re-runs this
        // seeder while no ShippingSettings document exists, so creating it last makes a
        // partial run safe — the next boot simply re-runs the (idempotent) seeder.

        // Classes (skip existing by name, case-insensitive)
        for (const c of DEFAULT_CLASSES) {
            const exists = await ShippingClass.findOne({ name: c.name }).collation({ locale: 'en', strength: 2 });
            if (!exists) {
                await ShippingClass.create({ ...c, is_active: true });
                console.log(`✅ Seeded shipping class: ${c.name}`);
            }
        }

        // Default zone: Qatar (Doha + rest of Qatar wildcard)
        let zone = await ShippingZone.findOne({ name: 'Qatar' });
        if (!zone) {
            zone = await ShippingZone.create({
                name: 'Qatar',
                name_ar: 'قطر',
                is_active: true,
                priority: 0,
                locations: [
                    { country: 'Qatar', country_ar: 'قطر', city: 'Doha', city_ar: 'الدوحة' },
                    { country: 'Qatar', country_ar: 'قطر', city: null, city_ar: '' },
                ],
            });
            console.log('✅ Seeded shipping zone: Qatar');
        }

        // Default flat method in that zone
        const hasMethod = await ShippingMethod.countDocuments({ zone_id: zone._id });
        if (!hasMethod) {
            await ShippingMethod.create({
                zone_id: zone._id,
                name: 'Standard delivery',
                name_ar: 'التوصيل القياسي',
                type: 'flat',
                is_active: true,
                sort_order: 0,
                delivery_time_min_days: 2,
                delivery_time_max_days: 4,
                base_cost: 15,
                min_fee: 0,
                max_fee: null,
                flat_config: { per_item_cost: 0, per_vendor_cost: 0 },
            });
            console.log('✅ Seeded shipping method: Standard delivery (Qatar)');
        }

        // Sample (inactive) global policy: free shipping over QAR 500
        const hasSamplePolicy = await ShippingPolicy.findOne({ name: 'Free shipping over QAR 500' });
        if (!hasSamplePolicy) {
            await ShippingPolicy.create({
                name: 'Free shipping over QAR 500',
                name_ar: 'شحن مجاني للطلبات فوق ٥٠٠ ريال',
                is_active: false,
                priority: 0,
                scope: 'global',
                zone_id: null,
                applies_to: { shipping_class_ids: [], vendor_ids: [], category_ids: [] },
                condition_logic: 'all',
                conditions: [{ field: 'cart_total', operator: 'gte', value: 500 }],
                actions: [{ type: 'free_shipping', value: 0 }],
            });
            console.log('✅ Seeded sample shipping policy (inactive): Free shipping over QAR 500');
        }

        // Settings (singleton) — created last so a partial run stays re-triggerable.
        const existingSettings = await ShippingSettings.findOne();
        if (!existingSettings) {
            await ShippingSettings.create({
                enabled: true,
                // Omitted deliberately so the schema default ("split") applies: a fresh
                // install should price each (vendor, branch) parcel on its own leg, which is
                // what the per-parcel COD is built from. Pinning it here is what left every
                // existing installation on "combined" — a stored value the schema default
                // can never reach.
                //
                // NOTE for an EXISTING install: this seeder only runs when no settings row
                // exists, so it will not change your mode. Use Admin → Shipping → Settings.
                no_zone_behavior: 'free',
                no_zone_flat_cost: 0,
                default_weight_unit: 'kg',
                cache_ttl_seconds: 300,
            });
            console.log('✅ Seeded shipping settings');
        }

        console.log('Shipping seeding completed.');
        if (shouldDisconnect) {
            await mongoose.disconnect();
            console.log('🔌 Disconnected.');
        }
    } catch (err) {
        console.error('Shipping seeding failed:', err);
        if (shouldDisconnect) {
            await mongoose.disconnect();
        }
    }
}

if (require.main === module) {
    seed();
}

module.exports = { seed };
