const mongoose = require('mongoose');

/**
 * Connect to MongoDB with graceful fallback for local development without credentials.
 */
async function connectToDatabase(customUri = null) {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    const primaryUri = customUri || process.env.MONGO_URI || 'mongodb://localhost:27017/readycar';
    try {
        await mongoose.connect(primaryUri);
    } catch (err) {
        const isAuthError = err && (err.code === 18 || err.codeName === 'AuthenticationFailed' || String(err.message || '').includes('Authentication failed'));
        const localFallback = process.env.LOCAL_MONGO_URI || (primaryUri.includes('@') ? primaryUri.replace(/\/\/[^@]+@/, '//').replace(/\?authSource=[^&]*&?/, '').replace(/\?$/, '') : 'mongodb://localhost:27017/readycar');
        if (isAuthError && localFallback) {
            console.warn(`⚠️  Auth failed for MONGO_URI. Retrying with local unauthenticated fallback: ${localFallback}`);
            await mongoose.connect(localFallback);
        } else {
            throw err;
        }
    }
    return mongoose.connection;
}

module.exports = { connectToDatabase };
