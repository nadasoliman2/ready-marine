const mongoose = require('mongoose');
const { Product } = require('./Backend/models/products');
require('dotenv').config({ path: './Backend/.env' });

const migrate = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/sayarty');
        console.log('Connected to MongoDB');

        const result = await Product.updateMany(
            { status: { $exists: false } },
            { $set: { status: 'published' } }
        );

        console.log(`Migration complete. Updated ${result.nModified || result.modifiedCount} products.`);
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrate();
