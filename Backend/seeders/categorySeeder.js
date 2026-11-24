/**
 * Ready Marine - Category Seeder for Production & Development
 *
 * Reads canonical category taxonomy from seeders/data/categories.seed.json
 * (or fallback data/categories.json) and seeds the Category collection.
 *
 * Features:
 * - Recursive seeding (10 roots -> 35 subcategories -> 170 leaves = 215 categories)
 * - Safe by default: skips destructive reseed if categories exist, unless --reset or --sync is specified
 * - --sync: updates names, images, and adds any missing categories without changing existing ObjectIds (safe for production)
 * - --reset: clears collection and re-inserts from scratch
 * - Automatically ensures bundled category images exist in public/uploads/
 *
 * Usage:
 *   node ./seeders/categorySeeder.js           # Seeds if empty (safe)
 *   node ./seeders/categorySeeder.js --sync    # Non-destructive sync
 *   node ./seeders/categorySeeder.js --reset   # Destructive reset
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Category } = require('../models/categories');
const { connectToDatabase } = require('./db');

const SEED_CATEGORIES_JSON = path.join(__dirname, 'data', 'categories.seed.json');
const FALLBACK_CATEGORIES_JSON = path.join(__dirname, '..', 'data', 'categories.json');

/**
 * Ensures bundled category images in seeders/data/category-images
 * are copied to public/uploads/ so that production fresh deploys have all images ready.
 */
function ensureCategoryImages() {
  const seedImagesDir = path.join(__dirname, 'data', 'category-images');
  if (!fs.existsSync(seedImagesDir)) return 0;

  const publicCategoriesDir = path.join(__dirname, '..', 'public', 'uploads', 'categories');
  const publicProductsDir = path.join(__dirname, '..', 'public', 'uploads', 'products');

  fs.mkdirSync(publicCategoriesDir, { recursive: true });
  fs.mkdirSync(publicProductsDir, { recursive: true });

  const files = fs.readdirSync(seedImagesDir);
  let copied = 0;

  for (const file of files) {
    const src = path.join(seedImagesDir, file);
    if (!fs.statSync(src).isFile()) continue;

    const targetDir = file.startsWith('product-') ? publicProductsDir : publicCategoriesDir;
    const dest = path.join(targetDir, file);

    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      copied++;
    }
  }

  return copied;
}

/**
 * Recursively insert or synchronize category nodes.
 * @param {Array} nodes - Hierarchical category nodes
 * @param {ObjectId|null} parentId - Parent category ObjectId
 * @param {Object} options - { sync: boolean, stats: Object }
 */
async function insertOrUpdateCategories(nodes, parentId = null, options = {}) {
  const { sync = false, stats = { created: 0, updated: 0, unchanged: 0 } } = options;

  for (const [index, node] of nodes.entries()) {
    const name = (node.name || node.name_en || '').trim();
    const name_ar = (node.name_ar || node.name || name).trim();
    // Normalize image to relative URL, stripping any localhost domain
    const image = node.image ? node.image.replace(/^https?:\/\/[^\/]+/, '') : null;
    const sort_order = typeof node.sort_order === 'number' ? node.sort_order : index;
    const is_active = node.is_active !== false;

    if (!name) continue;

    let category = null;

    if (sync) {
      // Find existing category under the same parent by English name
      category = await Category.findOne({
        name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        parent_id: parentId
      });

      if (category) {
        let changed = false;
        if (category.name_ar !== name_ar) {
          category.name_ar = name_ar;
          changed = true;
        }
        if (image && category.image !== image) {
          category.image = image;
          changed = true;
        }
        if (category.sort_order !== sort_order) {
          category.sort_order = sort_order;
          changed = true;
        }
        if (category.is_active !== is_active) {
          category.is_active = is_active;
          changed = true;
        }

        if (changed) {
          await category.save();
          stats.updated += 1;
        } else {
          stats.unchanged += 1;
        }
      }
    }

    if (!category) {
      category = await Category.create({
        name,
        name_ar,
        parent_id: parentId,
        image,
        sort_order,
        is_active
      });
      stats.created += 1;
    }

    // Recurse into children
    if (node.subcategories && node.subcategories.length > 0) {
      await insertOrUpdateCategories(node.subcategories, category._id, options);
    }
  }

  return stats;
}

/**
 * Main seeding entry point. Can be invoked from CLI or required in server initialization.
 */
async function seedCategories(opts = {}) {
  const isCli = require.main === module;
  const reset = opts.reset || process.argv.includes('--reset') || process.env.RESET_SEED_DATA === 'true';
  const sync = opts.sync || process.argv.includes('--sync');
  const quiet = opts.quiet || false;

  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/readymarine';

  if (!mongoose.connection.readyState) {
    if (!quiet) console.log('🔌 Connecting to MongoDB…');
    await connectToDatabase(MONGO_URI);
    if (!quiet) console.log('✅ Connected to MongoDB.');
  }

  // 1. Ensure images are present in public/uploads/
  const copiedImages = ensureCategoryImages();
  if (!quiet && copiedImages > 0) {
    console.log(`🖼️  Copied ${copiedImages} category images to public uploads directory.`);
  }

  // 2. Locate JSON source
  let jsonPath = SEED_CATEGORIES_JSON;
  if (!fs.existsSync(jsonPath)) {
    jsonPath = FALLBACK_CATEGORIES_JSON;
  }
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`❌ Categories seed JSON not found at ${SEED_CATEGORIES_JSON} or ${FALLBACK_CATEGORIES_JSON}`);
  }

  if (!quiet) console.log(`📄 Reading categories dataset from: ${jsonPath}`);
  const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const existingCount = await Category.countDocuments();

  if (existingCount > 0 && !reset && !sync) {
    if (!quiet) {
      console.log(`ℹ️  Found ${existingCount} existing categories in DB.`);
      console.log('   Skipping destructive reseed. Pass --sync to update or --reset to re-create.');
    }
    if (isCli) await mongoose.disconnect();
    return { existingCount, created: 0, updated: 0, skipped: true };
  }

  if (reset) {
    const deleted = await Category.deleteMany({});
    if (!quiet) console.log(`🗑️  Cleared ${deleted.deletedCount} existing categories.`);
  }

  const stats = { created: 0, updated: 0, unchanged: 0 };
  if (!quiet) console.log(`📥 Seeding category hierarchy (${rawData.length} root categories)…`);

  await insertOrUpdateCategories(rawData, null, { sync: !reset && sync, stats });

  const total = await Category.countDocuments();
  if (!quiet) {
    console.log(`✅ Categories seeding complete!`);
    console.log(`   - Total in DB: ${total}`);
    console.log(`   - Created: ${stats.created}`);
    if (sync) console.log(`   - Updated: ${stats.updated}, Unchanged: ${stats.unchanged}`);
  }

  if (isCli) {
    await mongoose.disconnect();
    if (!quiet) console.log('🔌 Disconnected.');
  }

  return { total, ...stats };
}

// CLI execution
if (require.main === module) {
  seedCategories().catch((err) => {
    console.error('❌ Category seeder error:', err);
    process.exit(1);
  });
}

module.exports = { seedCategories };
