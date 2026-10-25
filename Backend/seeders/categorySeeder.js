/**
 * Category Seeder
 * Reads data from readycar_scrapping/categories.json and seeds the
 * Category collection recursively (parent → children at any depth).
 *
 * Usage:
 *   node Backend/seeders/categorySeeder.js
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Category } = require('../models/categories');
const { connectToDatabase } = require('./db');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const FALLBACK_CATEGORIES_JSON = path.join(__dirname, '..', 'data', 'categories.json');
const CATEGORY_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'categories');

const seedStats = {
  copied: 0,
  reused: 0,
  missingImages: 0,
};

const getScrapingDir = () => {
  const candidates = [
    process.env.READYMARINE_SCRAPING_DIR,
    process.env.READTMARINE_SCRAPING_DIR,
    process.env.READYCAR_SCRAPING_DIR,
    path.join(PROJECT_ROOT, 'readymarine_scrapping'),
    path.join(__dirname, '..', 'readymarine_scrapping'),
    path.join(process.cwd(), 'readymarine_scrapping'),
    '/app/readymarine_scrapping',
    '/readymarine_scrapping',
    path.join(PROJECT_ROOT, 'readycar_scrapping'),
    path.join(__dirname, '..', 'readycar_scrapping'),
    path.join(process.cwd(), 'readycar_scrapping'),
    '/app/readycar_scrapping',
    '/readycar_scrapping',
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'categories.json'))) || null;
};

const getCategoriesJsonPath = (scrapingDir) => {
  if (scrapingDir) return path.join(scrapingDir, 'categories.json');
  return FALLBACK_CATEGORIES_JSON;
};

const slugify = (value) => String(value || 'category')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60) || 'category';

const resolveLocalImagePath = (localImage, scrapingDir) => {
  if (!localImage) return null;
  if (!scrapingDir) return null;

  const sourcePath = path.resolve(scrapingDir, localImage);
  const scrapingRoot = path.resolve(scrapingDir);

  if (!sourcePath.startsWith(scrapingRoot + path.sep)) {
    return null;
  }

  return sourcePath;
};

const copyCategoryImage = (node, scrapingDir) => {
  const sourcePath = resolveLocalImagePath(node.local_image, scrapingDir);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    if (node.local_image) {
      console.warn(`⚠️  Missing local category image: ${node.local_image}`);
      seedStats.missingImages += 1;
    }
    return null;
  }

  fs.mkdirSync(CATEGORY_UPLOAD_DIR, { recursive: true });

  const ext = path.extname(sourcePath).toLowerCase() || '.webp';
  const hash = crypto.createHash('md5').update(node.local_image).digest('hex').slice(0, 10);
  const filename = `${slugify(node.name_en || node.name)}-${hash}${ext}`;
  const destinationPath = path.join(CATEGORY_UPLOAD_DIR, filename);

  if (fs.existsSync(destinationPath)) {
    seedStats.reused += 1;
  } else {
    fs.copyFileSync(sourcePath, destinationPath);
    seedStats.copied += 1;
  }

  return `/uploads/categories/${filename}`;
};

/**
 * Recursively insert a list of category nodes.
 * @param {Array}  nodes      - Array of category objects from JSON
 * @param {string|null} parentId - MongoDB ObjectId of the parent, or null for roots
 */
async function insertCategories(nodes, parentId = null, scrapingDir = null) {
  for (const node of nodes) {
    const imageUrl = copyCategoryImage(node, scrapingDir);

    const category = await Category.create({
      name: node.name_en || node.name,   // English name → `name`
      name_ar: node.name,                // Arabic name  → `name_ar`
      parent_id: parentId,
      image: imageUrl,
      is_active: true,
      sort_order: 0
    });

    // Recurse into children if any
    if (node.subcategories && node.subcategories.length > 0) {
      await insertCategories(node.subcategories, category._id, scrapingDir);
    }
  }
}

async function seedCategories() {
  const MONGO_URI =
    process.env.MONGO_URI || 'mongodb://localhost:27017/readycar';

  console.log('🔌 Connecting to MongoDB…');
  await connectToDatabase(MONGO_URI);
  console.log('✅ Connected.');

  const scrapingDir = getScrapingDir();
  const categoriesJsonPath = getCategoriesJsonPath(scrapingDir);

  // Read source data
  if (!fs.existsSync(categoriesJsonPath)) {
    console.error(`❌ categories.json not found at:\n   ${categoriesJsonPath}`);
    process.exit(1);
  }
  console.log(`📄 Reading categories from: ${categoriesJsonPath}`);
  if (!scrapingDir) {
    console.warn('⚠️  readycar_scrapping was not found. Categories will seed without local images.');
  } else {
    console.log(`🖼️  Reading local category images from: ${scrapingDir}`);
  }
  const rawData = JSON.parse(fs.readFileSync(categoriesJsonPath, 'utf-8'));

  const resetSeedData = process.env.RESET_SEED_DATA === 'true' || process.argv.includes('--reset');
  const existingCount = await Category.countDocuments();

  if (existingCount > 0 && !resetSeedData) {
    console.log(`ℹ️  Found ${existingCount} existing categories. Skipping destructive reseed.`);
    await mongoose.disconnect();
    console.log('🔌 Disconnected.');
    return;
  }

  if (resetSeedData) {
    const deleted = await Category.deleteMany({});
    console.log(`🗑️  Cleared ${deleted.deletedCount} existing categories.`);
  }

  // Insert fresh data
  console.log(`📥 Inserting ${rawData.length} root categories (with all subcategories)…`);
  await insertCategories(rawData, null, scrapingDir);

  const total = await Category.countDocuments();
  console.log(`✅ Done! Total categories in DB: ${total}`);
  console.log(`🖼️  Category images copied: ${seedStats.copied}, reused: ${seedStats.reused}, missing: ${seedStats.missingImages}`);

  await mongoose.disconnect();
  console.log('🔌 Disconnected.');
}

seedCategories().catch((err) => {
  console.error('❌ Seeder error:', err);
  process.exit(1);
});
