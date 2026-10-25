require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const defaults = require('../data/siteSettings.json');
const { SiteSettings } = require('../models/site_settings');
const { connectToDatabase } = require('./db');

const isEmptyValue = (value) => {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
};

async function seed() {
    let shouldDisconnect = false;
    try {
        if (mongoose.connection.readyState === 0) {
            await connectToDatabase();
            console.log('Connected to DB');
            shouldDisconnect = true;
        }

        let settings = await SiteSettings.findOne();
        if (!settings) {
            settings = new SiteSettings(defaults);
            await settings.save();
            console.log('✅ Seeded site settings');
        } else {
            let changed = false;

            Object.entries(defaults).forEach(([key, value]) => {
                if (isEmptyValue(settings[key])) {
                    settings[key] = value;
                    changed = true;
                }
            });

            if (changed) {
                await settings.save();
                console.log('✅ Filled missing site settings');
            } else {
                console.log('Site settings already seeded.');
            }
        }

        if (shouldDisconnect) {
            await mongoose.disconnect();
            console.log('🔌 Disconnected.');
        }
    } catch (err) {
        console.error('Site settings seeding failed:', err);
        if (shouldDisconnect) {
            await mongoose.disconnect();
        }
    }
}

if (require.main === module) {
    seed();
}

module.exports = { seed };
