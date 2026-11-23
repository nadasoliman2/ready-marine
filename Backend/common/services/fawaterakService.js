const crypto = require("crypto");
const https = require("https");

const getMode = () => (process.env.FAWATERAK_MODE === "live" ? "live" : "sandbox");

const getBaseUrl = () => {
    const explicit = getMode() === "live" ? process.env.FAWATERAK_LIVE_BASE_URL : process.env.FAWATERAK_SANDBOX_BASE_URL;
    return (explicit || process.env.FAWATERAK_BASE_URL || "https://staging.fawaterk.com").replace(/\/$/, "");
};

const getApiKey = () => process.env.FAWATERAK_API_KEY || process.env.FAWATERAK_API_LINK;

const getVendorKey = () => process.env.FAWATERAK_VENDOR_KEY || process.env.FAWATERAK_PROVIDED_APIKEY;

const getCurrency = () => process.env.FAWATERAK_CURRENCY || "EGP";

const formatProviderMessage = (value, fallback = "Fawaterak request failed") => {
    if (!value) return fallback;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
        return value.map(item => formatProviderMessage(item, "")).filter(Boolean).join(", ") || fallback;
    }
    if (typeof value === "object") {
        return Object.entries(value)
            .map(([key, item]) => {
                const formatted = formatProviderMessage(item, "");
                return formatted ? `${key}: ${formatted}` : key;
            })
            .filter(Boolean)
            .join(", ") || fallback;
    }
    return String(value);
};

const requestJson = ({ method = "GET", path, body }) => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("FAWATERAK_API_KEY is not configured");

    const url = new URL(`${getBaseUrl()}${path}`);
    const payload = body ? JSON.stringify(body) : null;

    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: url.hostname,
                path: `${url.pathname}${url.search}`,
                method,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                    ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
                },
            },
            (res) => {
                let data = "";
                res.on("data", chunk => { data += chunk; });
                res.on("end", () => {
                    let parsed = {};
                    if (data) {
                        try {
                            parsed = JSON.parse(data);
                        } catch (error) {
                            parsed = { message: data };
                        }
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                        return;
                    }

                    const message = formatProviderMessage(parsed?.message || parsed?.error || parsed);
                    const err = new Error(message);
                    err.providerResponse = parsed;
                    err.statusCode = res.statusCode;
                    reject(err);
                });
            }
        );

        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
};

const createInvoiceLink = async (payload) => {
    return await requestJson({
        method: "POST",
        path: "/api/v2/createInvoiceLink",
        body: payload,
    });
};

const getInvoiceData = async (invoiceId) => {
    return await requestJson({
        method: "GET",
        path: `/api/v2/getInvoiceData/${encodeURIComponent(invoiceId)}`,
    });
};

/**
 * Fawaterak signs its "paid" webhook with HMAC-SHA256 over three fields. The secret is the
 * account's vendor key; the API key is accepted as well, because the two are easy to
 * confuse when the dashboard is set up and a rejected webhook is silent — the only trace
 * is a 401 in the access log and an order that never moves. Both are secrets we hold, so
 * matching either proves the call came from Fawaterak.
 *
 * Every rejection is logged with what was missing — never the keys themselves — so the
 * next one can be diagnosed from the log instead of guessed at.
 */
const verifyPaidWebhookHash = (payload = {}) => {
    const received = payload.hashKey ? String(payload.hashKey) : "";
    const secrets = [...new Set([getVendorKey(), getApiKey()].filter(Boolean))];

    if (!secrets.length || !received) {
        console.warn("[Fawaterak] Webhook rejected: " + (!secrets.length ? "no vendor/API key configured" : "payload carries no hashKey"), {
            invoice_id: payload.invoice_id ?? null,
            fields: Object.keys(payload || {}),
        });
        return false;
    }

    const queryParam = `InvoiceId=${payload.invoice_id}&InvoiceKey=${payload.invoice_key}&PaymentMethod=${payload.payment_method}`;
    for (const secret of secrets) {
        const expected = crypto.createHmac("sha256", secret).update(queryParam).digest("hex");
        if (received.length !== expected.length) continue;
        if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))) return true;
    }

    console.warn("[Fawaterak] Webhook rejected: hashKey does not match either configured key", {
        invoice_id: payload.invoice_id ?? null,
        invoice_key_present: Boolean(payload.invoice_key),
        payment_method: payload.payment_method ?? null,
        hash_length: received.length,
    });
    return false;
};

module.exports = {
    createInvoiceLink,
    getInvoiceData,
    getCurrency,
    getMode,
    verifyPaidWebhookHash,
};
