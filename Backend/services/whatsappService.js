const https = require("https");
const { URL } = require("url");

/**
 * EverySecond.ai WhatsApp Outbound API client.
 * Reference: https://everysecond.ai/docs/whatsapp-api
 *
 * Shape of the provider, and why this client looks the way it does:
 *
 *  - `POST /send` creates and dispatches a CAMPAIGN. `name` is the campaign's
 *    label in the provider dashboard — not a sender name — so it is built per
 *    message from the order reference, otherwise every confirmation collapses
 *    into an indistinguishable list of identically-named campaigns.
 *  - Template variables are keyed by placeholder index AS STRINGS: {"1":"..."}.
 *  - Phone numbers are normalized by the provider to international WITHOUT a
 *    leading "+", and validated offline against per-country length rules.
 *  - A 2xx means QUEUED, not delivered. There are no delivery webhooks; the
 *    only source of delivery truth is polling `GET /campaigns/{id}`, which is
 *    why the campaign id is returned to the caller to persist.
 */

const API_KEY = process.env.WHATSAPP_API_KEY || "";
const BASE_URL = process.env.WHATSAPP_BASE_URL || "https://everysecond.ai";
const TEMPLATE_ID = Number(process.env.WHATSAPP_TEMPLATE_ID || 19);
const COUNTRY_CODE = String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "20");
const ACCOUNT_ID = process.env.WHATSAPP_ACCOUNT_ID ? Number(process.env.WHATSAPP_ACCOUNT_ID) : null;
// Prefix for the campaign name shown in the provider dashboard.
const CAMPAIGN_PREFIX = process.env.WHATSAPP_SENDER_NAME || "Ready Marine";

const API_PREFIX = "/api/v1/whatsapp";
/** Provider cap on the campaign `name` field. */
const MAX_CAMPAIGN_NAME = 255;
/**
 * Meta caps a template body parameter at 1024 characters and rejects any
 * parameter containing a newline, a tab, or 4+ consecutive spaces.
 */
const MAX_VARIABLE_LENGTH = 1024;

/**
 * Build a request path that tolerates `WHATSAPP_BASE_URL` being set to either
 * the host root or the documented API base (`.../api/v1/whatsapp`) — the docs
 * call the latter the "Base URL", so operators will reasonably paste it.
 */
const resolveApiPath = (segment) => {
    const { pathname } = new URL(BASE_URL);
    const base = pathname.replace(/\/+$/, "").replace(new RegExp(`${API_PREFIX}$`), "");
    return `${base}${API_PREFIX}${segment}`;
};

const request = ({ method, path, body = null }) => {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        // Honour an explicit port so a staging proxy or a local mock endpoint
        // can be pointed at via WHATSAPP_BASE_URL instead of silently hitting 443.
        const { hostname, port } = new URL(BASE_URL);

        const req = https.request(
            {
                hostname,
                ...(port ? { port: Number(port) } : {}),
                path,
                method,
                timeout: 15000,
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${API_KEY}`,
                    ...(payload
                        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
                        : {}),
                },
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => {
                    let parsed = {};
                    if (data) {
                        try {
                            parsed = JSON.parse(data);
                        } catch (error) {
                            parsed = { error: data };
                        }
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                        return;
                    }

                    reject(buildProviderError(res, parsed));
                });
            }
        );

        req.on("timeout", () => req.destroy(new Error("WhatsApp provider request timed out")));
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
};

/**
 * Turn a provider error response into an actionable Error.
 *
 * The provider returns `{ error, details: [...] }`, where `details` carries the
 * specific fixable problems on a 422 (wrong variable count, bad phone, missing
 * header media). Dropping it — as a naive `err.message` would — throws away the
 * only part of the response that says what to fix.
 */
const buildProviderError = (res, parsed) => {
    const status = res.statusCode;
    const details = Array.isArray(parsed?.details) ? parsed.details.filter(Boolean) : [];

    const reason = {
        401: "WhatsApp API key is missing or invalid",
        402: "WhatsApp provider reports insufficient credits",
        422: "WhatsApp provider rejected the request",
        429: "WhatsApp provider rate limit reached",
    }[status];

    const base = parsed?.error || parsed?.message || reason || `WhatsApp provider request failed (HTTP ${status})`;
    const suffix = details.length ? ` — ${details.join("; ")}` : "";

    const error = new Error(`${base}${suffix}`);
    error.status = status;
    error.details = details;
    // Documented on 429; lets a caller schedule a retry instead of guessing.
    if (status === 429) error.retryAfterSeconds = Number(res.headers["retry-after"]) || null;
    error.rateLimit = {
        limit: Number(res.headers["x-ratelimit-limit"]) || null,
        remaining: Number(res.headers["x-ratelimit-remaining"]) || null,
    };
    return error;
};

/**
 * Normalize a phone number to the provider's canonical form: international
 * digits with NO leading "+", e.g. "01207256335" → "201207256335".
 *
 * The provider also normalizes and validates server-side, so this is a
 * best-effort local pass that keeps obviously-broken input from consuming a
 * request; `country_code` is sent alongside so the provider applies the correct
 * per-country rules regardless.
 */
const normalizePhone = (raw) => {
    let digits = String(raw || "").replace(/\D/g, "");
    if (!digits) return "";

    // Drop an international "00" access prefix.
    if (digits.startsWith("00")) digits = digits.slice(2);

    if (digits.startsWith("0")) {
        // Local format: 01012345678 → 20 1012345678
        digits = COUNTRY_CODE + digits.slice(1);
    } else if (!digits.startsWith(COUNTRY_CODE)) {
        digits = COUNTRY_CODE + digits;
    }

    return digits;
};

/**
 * Make a value safe to use as a WhatsApp template parameter.
 *
 * Product titles and item summaries are vendor-authored free text, so they can
 * carry newlines or runs of spaces. Meta rejects the whole message for those,
 * which would surface as an opaque 422 — collapse whitespace and cap length
 * instead of losing the notification.
 */
const sanitizeVariable = (value) => {
    const flattened = String(value ?? "").replace(/\s+/g, " ").trim();
    return flattened.length > MAX_VARIABLE_LENGTH
        ? `${flattened.slice(0, MAX_VARIABLE_LENGTH - 1)}…`
        : flattened;
};

/** Coerce variables to the documented `{ "1": "value" }` string-keyed shape. */
const buildVariables = (variables = {}) => {
    const out = {};
    for (const [key, value] of Object.entries(variables)) {
        out[String(key)] = sanitizeVariable(value);
    }
    return out;
};

const isConfigured = () => !!API_KEY;

/**
 * Send a WhatsApp template message.
 *
 * @param {object} args
 * @param {string} args.phone             Recipient number in any format.
 * @param {Record<string|number,string>} args.variables Template placeholders, keyed by index.
 * @param {string} [args.campaignName]    Dashboard label; defaults to a generic one.
 * @param {number} [args.templateId]      Overrides WHATSAPP_TEMPLATE_ID.
 * @param {string} [args.countryCode]     Per-recipient country override.
 * @param {string} [args.recipientName]   Dashboard-only label for the recipient.
 * @param {string} [args.buttonUrl]       Full URL for a template whose CTA is a
 *        DYNAMIC url button. This provider validates the field as a complete
 *        public URL rather than the bare suffix Meta itself expects.
 * @param {string} [args.headerMediaUrl]  Media URL when the template's header requires one.
 * @returns {{skipped?: boolean, campaignId?: number, status?: string, raw?: object}}
 * @throws on missing config, invalid phone, or a non-2xx provider response.
 *         Callers treat notification failure as non-fatal and swallow it.
 */
const sendTemplateMessage = async ({
    phone,
    variables,
    campaignName,
    templateId,
    countryCode,
    recipientName,
    buttonUrl,
    headerMediaUrl,
} = {}) => {
    if (!isConfigured()) {
        console.warn("[WhatsApp] WHATSAPP_API_KEY not set — skipping send");
        return { skipped: true };
    }

    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error("Invalid recipient phone number");

    const recipient = {
        phone: normalized,
        variables: buildVariables(variables),
        country_code: String(countryCode || COUNTRY_CODE),
    };
    if (recipientName) recipient.name = sanitizeVariable(recipientName).slice(0, 255);
    if (buttonUrl) recipient.button_url = String(buttonUrl);
    if (headerMediaUrl) recipient.header_media_url = String(headerMediaUrl);

    const body = {
        // Campaign label, capped by the provider at 255 characters.
        name: sanitizeVariable(campaignName || `${CAMPAIGN_PREFIX} notification`).slice(0, MAX_CAMPAIGN_NAME),
        template_id: Number(templateId || TEMPLATE_ID),
        recipients: [recipient],
    };
    if (ACCOUNT_ID) body.account_id = ACCOUNT_ID;

    const response = await request({ method: "POST", path: resolveApiPath("/send"), body });
    const data = response?.data || {};

    return {
        campaignId: data.id ?? null,
        // "queued" — delivery is confirmed later, only via getCampaignStatus().
        status: data.status || "queued",
        totalRecipients: data.total_recipients ?? 1,
        raw: response,
    };
};

/**
 * Template structure and variable requirements.
 * Useful for verifying that the configured template still expects the
 * placeholder indexes this codebase sends before a template edit breaks sends.
 */
const getTemplateSchema = async (templateId = TEMPLATE_ID) => {
    if (!isConfigured()) return { skipped: true };
    const response = await request({
        method: "GET",
        path: resolveApiPath(`/templates/${Number(templateId)}/schema`),
    });
    return response?.data || response;
};

/**
 * Poll delivery progress. There are no delivery webhooks — this is the only
 * way to learn whether a queued message actually reached the customer.
 */
const getCampaignStatus = async (campaignId) => {
    if (!isConfigured()) return { skipped: true };
    if (!campaignId) throw new Error("campaignId is required");

    const response = await request({
        method: "GET",
        path: resolveApiPath(`/campaigns/${encodeURIComponent(campaignId)}`),
    });
    const data = response?.data || {};

    return {
        id: data.id ?? null,
        status: data.status || null,
        sent: data.sent ?? 0,
        delivered: data.delivered ?? 0,
        read: data.read ?? 0,
        failed: data.failed ?? 0,
        progressPercent: data.progress_percent ?? 0,
        raw: response,
    };
};

module.exports = {
    sendTemplateMessage,
    getTemplateSchema,
    getCampaignStatus,
    normalizePhone,
    sanitizeVariable,
    isConfigured,
};
