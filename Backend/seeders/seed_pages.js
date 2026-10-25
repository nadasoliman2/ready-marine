require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { Page } = require('../models/pages');
const { connectToDatabase } = require('./db');

// Files are now in the same directory as the seeder
const seederDir = __dirname;

const pagesToSeed = [
    {
        slug: 'privacy-policy',
        title_en: 'Privacy Policy',
        title_ar: 'سياسة الخصوصية',
        file: 'privacy policy.txt'
    },
    {
        slug: 'shipping-policy',
        title_en: 'Shipping Policy',
        title_ar: 'سياسة الشحن والتوصيل',
        file: 'shipping policy.txt'
    },
    {
        slug: 'delivery-and-return',
        title_en: 'Delivery & Return',
        title_ar: 'الاستلام & الاسترجاع',
        file: 'delivery and return.txt'
    },
    {
        slug: 'terms-and-conditions',
        title_en: 'Terms and Conditions',
        title_ar: 'الشروط والأحكام',
        file: 'terms and conditions.txt'
    }
];

async function seed() {
    let shouldDisconnect = false;
    try {
        if (mongoose.connection.readyState === 0) {
            await connectToDatabase();
            console.log('Connected to DB');
            shouldDisconnect = true;
        }

        for (const page of pagesToSeed) {
            const filePath = path.join(seederDir, page.file);
            if (!fs.existsSync(filePath)) {
                console.log(`[Warning] File not found: ${filePath}`);
                continue;
            }

            const rawContent = fs.readFileSync(filePath, 'utf-8');
            
            // Split by "arabic :" (case insensitive, flexible spacing)
            const parts = rawContent.split(/arabic\s*:/i);
            
            let content_en = parts[0] ? parts[0].trim() : '';
            let content_ar = parts[1] ? parts[1].trim() : '';

            // Optional: remove the title from the first line if it exists
            const enLines = content_en.split('\n');
            if (enLines.length > 0 && enLines[0].toLowerCase().includes(page.title_en.toLowerCase())) {
                enLines.shift(); // Remove the first line
                content_en = enLines.join('\n').trim();
            }

            const arLines = content_ar.split('\n');
            if (arLines.length > 0 && arLines[0].includes(page.title_ar)) {
                arLines.shift(); // Remove the first line
                content_ar = arLines.join('\n').trim();
            }

            // Upsert
            await Page.findOneAndUpdate(
                { slug: page.slug },
                {
                    title_en: page.title_en,
                    title_ar: page.title_ar,
                    content_en,
                    content_ar
                },
                { upsert: true, returnDocument: "after" }
            );
            console.log(`✅ Seeded page: ${page.slug}`);
        }

        console.log('Seeding completed.');
        if (shouldDisconnect) {
            await mongoose.disconnect();
            console.log('🔌 Disconnected.');
        }
    } catch (err) {
        console.error('Seeding failed:', err);
        if (shouldDisconnect) {
            await mongoose.disconnect();
        }
    }
}

if (require.main === module) {
    seed();
}

module.exports = { seed };
