// Throwaway MongoDB and Redis for tests. Never reads the application's MONGO_URI/REDIS_URL.
//
// TEST_MONGO_URI / TEST_REDIS_URL point at servers someone already started (a container, say);
// otherwise `mongod` and `redis-server` are spawned on free ports (TEST_MONGOD_BINARY /
// TEST_REDIS_SERVER_BINARY override the executables), as tests/companyWallet.test.js does.
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const net = require('node:net');

const freePort = async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise((resolve) => server.close(resolve));
    return port;
};

const spawnUntil = (binary, args, readyText, label) => new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => reject(new Error(`${label} startup timed out`)), 15000);
    const finish = (err) => { clearTimeout(timeout); err ? reject(err) : resolve(child); };
    child.once('error', finish);
    child.once('exit', (code) => finish(new Error(`${label} exited: ${code}`)));
    child.stdout.on('data', (chunk) => { if (String(chunk).includes(readyText)) finish(); });
    child.stderr.resume();
});

const startMongo = async (dbName) => {
    if (process.env.TEST_MONGO_URI) {
        const url = new URL(process.env.TEST_MONGO_URI);
        url.pathname = `/${dbName}`;
        return { uri: url.toString(), stop: async () => {} };
    }
    const directory = await mkdtemp(join(tmpdir(), `readymarine-${dbName}-`));
    const port = await freePort();
    const child = await spawnUntil(process.env.TEST_MONGOD_BINARY || 'mongod',
        ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', String(port), '--quiet'],
        'Waiting for connections', 'MongoDB');
    return {
        uri: `mongodb://127.0.0.1:${port}/${dbName}`,
        stop: async () => { child.kill('SIGTERM'); await rm(directory, { recursive: true, force: true }); },
    };
};

// `db`: node --test runs files in parallel, and a shared TEST_REDIS_URL must not let one
// file's FLUSHDB wipe another's keys — so each file takes its own logical database.
const startRedis = async (db = 0) => {
    if (process.env.TEST_REDIS_URL) {
        const url = new URL(process.env.TEST_REDIS_URL);
        url.pathname = `/${db}`;
        return { url: url.toString(), stop: async () => {} };
    }
    const port = await freePort();
    const child = await spawnUntil(process.env.TEST_REDIS_SERVER_BINARY || 'redis-server',
        ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'],
        'Ready to accept connections', 'Redis');
    return { url: `redis://127.0.0.1:${port}/${db}`, stop: async () => { child.kill('SIGTERM'); } };
};

/** Resolves once the shared ioredis client can take commands. */
const redisReady = (client) => (client.status === 'ready'
    ? Promise.resolve()
    : new Promise((resolve) => client.once('ready', resolve)));

module.exports = { startMongo, startRedis, redisReady };
