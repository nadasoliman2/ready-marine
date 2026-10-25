require('dotenv').config({ path: __dirname + '/../.env' });

const { MongoClient } = require('mongodb');

const DEFAULT_URI = 'mongodb://localhost:27017/readycar';
const uri = process.env.LOCAL_MONGO_URI || DEFAULT_URI;
const yes = process.argv.includes('--yes');

function getDatabaseName(connectionString) {
  const url = new URL(connectionString);
  const dbName = url.pathname.replace(/^\//, '').split('?')[0];
  return dbName || null;
}

async function resetLocalReadycarDb() {
  const host = new URL(uri).hostname;
  const dbName = getDatabaseName(uri);

  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(`Refusing to reset non-local MongoDB host "${host}".`);
  }

  if (dbName !== 'readycar') {
    throw new Error(
      `Refusing to reset database "${dbName || '(none)'}". This script only resets "readycar".`
    );
  }

  if (!yes) {
    console.log('This will permanently delete all data in the local MongoDB database: readycar');
    console.log(`Target URI: ${uri}`);
    console.log('Run again with --yes to confirm:');
    console.log('  node scripts/resetLocalReadycarDb.js --yes');
    return;
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const result = await client.db(dbName).dropDatabase();

    if (!result) {
      throw new Error('MongoDB did not confirm the database drop.');
    }

    console.log(`Reset complete. Dropped local MongoDB database: ${dbName}`);
  } finally {
    await client.close();
  }
}

resetLocalReadycarDb().catch((error) => {
  console.error('Reset failed:', error.message);
  process.exit(1);
});
