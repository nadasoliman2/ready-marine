/**
 * Send one test message through a template and report whether it actually
 * ARRIVED — not merely whether the provider accepted it.
 *
 * This distinction matters: EverySecond returns HTTP 201 and a WhatsApp message
 * id for messages that Meta accepts but never delivers (notably AUTHENTICATION
 * templates, whose mandatory copy-code button parameter the send API cannot
 * express). Such a message sits at `sent` forever with no error, so "the API
 * returned success" is not evidence the customer received anything.
 *
 * Usage:
 *   node scripts/checkWhatsappTemplate.js <templateId> <phone> [var1] [var2] ... [--button=<value>]
 *
 * Examples:
 *   node scripts/checkWhatsappTemplate.js 1 201211227348 123456
 *   node scripts/checkWhatsappTemplate.js 42 201211227348 زياد REF-123 --button=https://readycar.store/review/abc
 *
 * For a template with a DYNAMIC url button, pass --button. This provider
 * validates that field as a full public URL rather than the bare suffix Meta
 * normally expects, so try the full URL first and the suffix as a fallback.
 */
require('dotenv').config();
const https = require('https');

const rawArgs = process.argv.slice(2);
const buttonArg = rawArgs.find((a) => a.startsWith('--button='));
const buttonValue = buttonArg ? buttonArg.slice('--button='.length) : null;
const [templateIdArg, phoneArg, ...vars] = rawArgs.filter((a) => !a.startsWith('--'));

if (!templateIdArg || !phoneArg) {
    console.error('Usage: node scripts/checkWhatsappTemplate.js <templateId> <phone> [var1] [var2] ...');
    process.exit(1);
}

const KEY = process.env.WHATSAPP_API_KEY;
if (!KEY) {
    console.error('WHATSAPP_API_KEY is not set.');
    process.exit(1);
}

const HOST = 'everysecond.ai';
const PREFIX = '/api/v1/whatsapp';
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 6000;

const request = (method, path, body) => new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
        hostname: HOST,
        path,
        method,
        headers: {
            Authorization: `Bearer ${KEY}`,
            Accept: 'application/json',
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
    }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
            let parsed = {};
            try { parsed = JSON.parse(data || '{}'); } catch (_) { parsed = { error: data }; }
            resolve({ status: res.statusCode, body: parsed });
        });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const templateId = Number(templateIdArg);
    const phone = String(phoneArg).replace(/\D/g, '');

    // 1. Inspect what the template expects.
    const schemaRes = await request('GET', `${PREFIX}/templates/${templateId}/schema`);
    const schema = schemaRes.body?.data;
    if (!schema) {
        console.error(`Template ${templateId} not found:`, JSON.stringify(schemaRes.body));
        process.exit(1);
    }

    const required = (schema.variables || []).filter((v) => v.required);
    console.log(`Template ${templateId}: ${schema.name}`);
    console.log(`  category        : ${schema.category}`);
    console.log(`  status          : ${schema.status}`);
    console.log(`  variables       : ${required.length} required (${required.map((v) => v.key).join(', ') || 'none'})`);
    console.log(`  header media    : ${schema.header?.media_required ? 'REQUIRED' : 'no'}`);
    console.log(`  dynamic button  : ${schema.button?.has_dynamic_url ? 'yes' : 'no'}`);

    if (schema.button?.has_dynamic_url && !buttonValue) {
        console.log('\n  ⚠  This template has a DYNAMIC url button but no --button= was supplied.');
        console.log('     The message will likely be rejected or arrive with a broken link.');
    }
    if (buttonValue && !schema.button?.has_dynamic_url) {
        console.log('\n  ⚠  --button= supplied, but this template has no dynamic url button. It will be ignored.');
    }

    if (schema.category === 'AUTHENTICATION') {
        console.log('\n  ⚠  AUTHENTICATION templates require a copy-code/one-tap button parameter');
        console.log('     that this provider\'s send API cannot supply. Expect the message to be');
        console.log('     accepted but never delivered. Use a UTILITY template for codes instead.');
    }

    if (vars.length < required.length) {
        console.error(`\nTemplate needs ${required.length} variable(s); ${vars.length} supplied.`);
        process.exit(1);
    }

    // 2. Send.
    const variables = {};
    required.forEach((v, i) => { variables[v.key] = String(vars[i]); });

    console.log(`\nSending to ${phone} ...`);
    const recipient = { phone, variables };
    if (buttonValue) recipient.button_url = buttonValue;

    const sendRes = await request('POST', `${PREFIX}/send`, {
        name: `Template check #${templateId}`,
        template_id: templateId,
        recipients: [recipient],
    });

    if (sendRes.status !== 201 || !sendRes.body?.data?.id) {
        console.error('  Send rejected:', JSON.stringify(sendRes.body));
        process.exit(1);
    }
    const campaignId = sendRes.body.data.id;
    console.log(`  accepted — campaign ${campaignId} (this only means QUEUED)`);

    // 3. Poll for a real delivery receipt.
    console.log('\nWaiting for a delivery receipt ...');
    let last = null;
    for (let i = 1; i <= POLL_ATTEMPTS; i++) {
        await sleep(POLL_INTERVAL_MS);
        const res = await request('GET', `${PREFIX}/campaigns/${campaignId}/recipients`);
        const row = res.body?.data?.[0];
        last = row?.status || 'unknown';
        console.log(`  ${String(i * POLL_INTERVAL_MS / 1000).padStart(3)}s → ${last}${row?.error ? ` (error: ${row.error})` : ''}`);
        if (last === 'delivered' || last === 'read' || last === 'failed') break;
    }

    console.log('');
    if (last === 'delivered' || last === 'read') {
        console.log(`✅ Template ${templateId} DELIVERS. Safe to use.`);
        process.exit(0);
    }
    if (last === 'failed') {
        console.log(`❌ Template ${templateId} FAILED to send.`);
        process.exit(1);
    }
    console.log(`❌ Template ${templateId} was accepted but NEVER DELIVERED (stuck at "${last}").`);
    console.log('   Do not use this template for customer-facing messages.');
    process.exit(1);
})().catch((err) => {
    console.error('Check failed:', err.message);
    process.exit(1);
});
