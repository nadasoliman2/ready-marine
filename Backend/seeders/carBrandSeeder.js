require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CarBrand } = require('../models/car_brands');

const { connectToDatabase } = require('./db');

const yrs = (from, to) => {
    const min = Math.min(from, to);
    const max = Math.max(from, to);
    return Array.from({ length: max - min + 1 }, (_, i) => ({ year: min + i }));
};

const slugify = (value) => String(value || 'brand')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'brand';

const seedCarBrands = async () => {
    try {
        await connectToDatabase();
        console.log('✅ Connected to MongoDB');

        const resetSeedData = process.env.RESET_SEED_DATA === 'true';
        const existingCount = await CarBrand.countDocuments();

        if (existingCount > 0 && !resetSeedData) {
            console.log(`ℹ️  Found ${existingCount} existing car brands. Skipping destructive reseed.`);
            await mongoose.disconnect();
            process.exit(0);
        }

        if (resetSeedData) {
            await CarBrand.deleteMany({});
            console.log('🗑️  Cleared existing car brands');
        }

        const sourceDirCandidates = [
            path.join(__dirname, '..', '..', 'carbrands'),
            '/app/carbrands',
            '/carbrands'
        ];

        const sourceDir = sourceDirCandidates.find(dir => fs.existsSync(path.join(dir, 'car_brands.json')));

        if (!sourceDir) {
            console.error(`❌ Source JSON not found in any of: ${sourceDirCandidates.join(', ')}`);
            process.exit(1);
        }

        const jsonPath = path.join(sourceDir, 'car_brands.json');
        const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'car_brands');

        fs.mkdirSync(uploadDir, { recursive: true });

        const carBrandsData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        const createdCarBrands = [];

        let copied = 0;
        let missing = 0;

        for (const b of carBrandsData) {
            let finalImageUrl = b.image; // fallback to original

            // Process image
            if (b.image) {
                const relativeImagePath = b.image.replace(/^\/+/, '');
                const sourceImagePath = path.join(sourceDir, relativeImagePath); // /carbrands/logos/xxx.png
                if (fs.existsSync(sourceImagePath)) {
                    const ext = path.extname(sourceImagePath).toLowerCase() || '.png';
                    const hash = crypto.createHash('md5').update(b.image).digest('hex').slice(0, 10);
                    const filename = `${slugify(b.name)}-${hash}${ext}`;
                    const destinationPath = path.join(uploadDir, filename);

                    if (!fs.existsSync(destinationPath)) {
                        fs.copyFileSync(sourceImagePath, destinationPath);
                        copied++;
                    }
                    finalImageUrl = `/uploads/car_brands/${filename}`;
                } else {
                    console.warn(`⚠️  Missing image for brand ${b.name}: ${sourceImagePath}`);
                    missing++;
                }
            }

            const cb = await CarBrand.create({
                name: b.name,
                image: finalImageUrl,
                models: b.models.map(m => ({
                    name: m.name,
                    years: yrs(m.startYear, m.endYear)
                })),
            });
            createdCarBrands.push(cb);
        }

        console.log(`🚗 ${createdCarBrands.length} car brands created`);
        console.log(`🖼️  Images copied: ${copied}, Missing: ${missing}`);
        process.exit(0);

    } catch (err) {
        console.error('❌ Seeding error:', err.message || err);
        process.exit(1);
    }
};

seedCarBrands();
