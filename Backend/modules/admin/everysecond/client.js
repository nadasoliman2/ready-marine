/**
 * EverySecond platform API client for chat commerce.
 *
 * EVERYSECOND_API_KEY is the key of the agent that sells (Dashboard →
 * Integrations → the agent). It is deliberately separate from WHATSAPP_API_KEY:
 * the outbound WhatsApp templates can stay on the live agent while chat
 * commerce is tried on a test agent. Never put the live agent's key in a
 * development .env — the first sync reconciles, and a dev database would
 * replace the live menu with its own products.
 *
 * One key allows 120 requests a minute; a 429 says how long to wait.
 */
const BASE_URL = () => (process.env.EVERYSECOND_BASE_URL || 'https://everysecond.ai/api/v1').replace(/\/+$/, '');
const API_KEY = () => (process.env.EVERYSECOND_API_KEY || '').trim();

/** This process talks to a database on this very machine — a developer's, not the server's. */
const isLocalDatabase = () => /\/\/([^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(process.env.MONGO_URI || '');

/*
 * The one configuration that must never run: the LIVE agent's key against a
 * local database. The live key is the one WhatsApp already sends with
 * (WHATSAPP_API_KEY), so the same key next to a local MONGO_URI means a
 * development catalogue is about to replace the live menu, and local test
 * orders are about to be announced to real customers.
 *
 * On the server both keys are the same agent and the database is not local, so
 * nothing here applies. EVERYSECOND_ALLOW_LIVE_AGENT_ON_LOCAL_DB=true is the
 * deliberate override.
 */
const unsafeReason = () => {
    const key = API_KEY();
    if (!key || process.env.EVERYSECOND_ALLOW_LIVE_AGENT_ON_LOCAL_DB === 'true') return '';
    if (isLocalDatabase() && key === (process.env.WHATSAPP_API_KEY || '').trim()) {
        return 'EVERYSECOND_API_KEY is the live agent\'s key (same as WHATSAPP_API_KEY) but MONGO_URI is a local database — use a test agent\'s key here';
    }
    return '';
};

let warned = false;
const isConfigured = () => {
    if (!API_KEY()) return false;
    const reason = unsafeReason();
    if (reason && !warned) {
        warned = true;
        console.error(`[everysecond] chat commerce is OFF: ${reason}.`);
    }
    return !reason;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One call. JSON in and out; a FormData body (a voice note) goes as multipart.
 * Throws an Error carrying `.status` and `.data` on anything but 2xx.
 */
const api = async (method, path, body, { timeoutMs = 30_000 } = {}) => {
    const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
    for (let attempt = 0; ; attempt += 1) {
        const res = await fetch(`${BASE_URL()}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${API_KEY()}`,
                Accept: 'application/json',
                ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 429 && attempt < 3) {
            await sleep((Number(res.headers.get('retry-after')) || 10) * 1000);
            continue;
        }
        const raw = await res.text();
        let data = null;
        try {
            data = raw ? JSON.parse(raw) : null;
        } catch {
            data = raw;
        }
        if (!res.ok) {
            const reason = (data && (data.message || data.error)) || `HTTP ${res.status}`;
            const err = new Error(`EverySecond ${method} ${path}: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }
};

module.exports = { api, isConfigured, sleep, unsafeReason, isLocalDatabase };
