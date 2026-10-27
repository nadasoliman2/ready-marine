/**
 * Is chat commerce set up correctly on this machine?
 *
 *   npm run everysecond:check
 *
 * Read-only: it looks at Backend/.env and asks EverySecond which agent the key
 * belongs to and what that agent has (orders module, branches, menu, webhooks).
 * It never prints a key — only its last four characters — and changes nothing.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { unsafeReason, isLocalDatabase } = require('../services/everysecond/client');

const key = (process.env.EVERYSECOND_API_KEY || '').trim();
const base = (process.env.EVERYSECOND_BASE_URL || 'https://everysecond.ai/api/v1').replace(/\/+$/, '');
const tail = (v) => (v ? `…${v.slice(-4)}` : '(empty)');
const ok = (msg) => console.log(`  ✔ ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);
const bad = (msg) => { console.log(`  ✘ ${msg}`); process.exitCode = 1; };

const get = async (path) => {
    const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, data };
};

(async () => {
    console.log('\nEnvironment (Backend/.env)');
    console.log(`  database:            ${isLocalDatabase() ? 'LOCAL (development machine)' : 'remote / server'}`);
    console.log(`  EVERYSECOND_API_KEY: ${tail(key)}`);
    console.log(`  WHATSAPP_API_KEY:    ${tail((process.env.WHATSAPP_API_KEY || '').trim())}  (live agent — WhatsApp templates)`);
    console.log(`  webhook secret:      ${process.env.EVERYSECOND_WEBHOOK_SECRET ? 'set' : 'not set'}`);
    console.log(`  sync every:          ${process.env.EVERYSECOND_SYNC_MINUTES ?? 10} min`);
    console.log(`  product links:       ${(process.env.EVERYSECOND_SITE_URL || process.env.FRONTEND_URL || 'https://readymarine.store')}/${process.env.EVERYSECOND_PRODUCT_LOCALE === 'en' ? 'en' : 'ar'}/product/<slug>`);
    console.log(`  cart two-way:        ${process.env.EVERYSECOND_CART_TWO_WAY !== 'false'}`);

    console.log('\nChecks');
    if (!key) {
        bad('EVERYSECOND_API_KEY is empty — chat commerce is off. Generate the agent\'s key on EverySecond → Integrations and paste it in Backend/.env.');
        return;
    }
    if (!/^es_[A-Za-z0-9]{32}$/.test(key)) warn('the key does not look like an EverySecond key (es_ + 32 characters) — check for spaces or quotes');
    const reason = unsafeReason();
    if (reason) bad(`${reason}. The backend keeps the feature OFF in this state.`);
    else ok(isLocalDatabase() ? 'the key is not the live agent\'s key — safe to sync a local database' : 'server database — the live agent\'s key is expected here');
    if (!/^https:\/\//.test(process.env.EVERYSECOND_SITE_URL || process.env.FRONTEND_URL || 'https://readymarine.store')) {
        warn('FRONTEND_URL is not https — product links would be dropped. Set EVERYSECOND_SITE_URL=https://readymarine.store');
    }

    const agent = await get('/agent');
    if (agent.status === 401 || agent.status === 403) return bad(`EverySecond refused the key (HTTP ${agent.status}) — it was rotated or mistyped.`);
    if (agent.status !== 200) return bad(`EverySecond answered HTTP ${agent.status} for /agent.`);
    const a = agent.data?.agent || agent.data?.data || agent.data || {};
    ok(`the key belongs to agent "${a.name || a.identity || '?'}" (id ${a.id ?? '?'}, status ${a.status || '?'})`);
    if (isLocalDatabase() && a.status === 'live') warn('this agent is LIVE and the database is local — make sure it is not an agent real customers talk to');

    const branches = await get('/orders/branches');
    if (branches.status === 403) bad('the Orders module is OFF for this agent — enable "Orders agent" on its screen.');
    else if (branches.status === 200) {
        const rows = branches.data?.data || branches.data?.branches || [];
        (rows.length === 1 ? ok : warn)(`${rows.length} branch(es): ${rows.map((b) => b.name).join(', ') || '—'}${rows.length === 1 ? '' : ' (one branch is expected)'}`);
    } else warn(`/orders/branches answered HTTP ${branches.status}`);

    const menu = await get('/orders/menu/items?per_page=1');
    if (menu.status === 200) {
        const total = menu.data?.meta?.total ?? (menu.data?.data || []).length;
        (total > 0 ? ok : warn)(`${total} synced item(s) on the agent's menu${total > 0 ? '' : ' — run: npm run everysecond:sync -- --reconcile'}`);
    } else if (menu.status !== 403) warn(`/orders/menu/items answered HTTP ${menu.status}`);

    const hooks = await get('/webhooks');
    if (hooks.status === 200) {
        const rows = (hooks.data?.data || hooks.data?.webhooks || []).filter((h) => /\/api\/webhooks\/everysecond/.test(h.url || ''));
        if (rows.length && process.env.EVERYSECOND_WEBHOOK_SECRET) ok(`webhook registered: ${rows[0].url}`);
        else if (rows.length) bad(`webhook registered (${rows[0].url}) but EVERYSECOND_WEBHOOK_SECRET is empty — deliveries are refused.`);
        else if (isLocalDatabase()) ok('no webhook — fine locally (EverySecond cannot call localhost; orders are imported by the every-minute catch-up)');
        else warn('no webhook registered — run: npm run everysecond:register-webhook -- https://<domain>/api/webhooks/everysecond');
    }
    console.log('');
})().catch((err) => bad(err.message));
