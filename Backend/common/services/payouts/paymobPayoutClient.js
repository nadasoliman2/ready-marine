/**
 * HTTP client for the Paymob Payouts API ("Paymob Send") — the OUTBOUND side of Paymob.
 *
 * Not to be confused with `paymobService`, which talks to Paymob Accept (card / wallet
 * collection from customers). Different host, different credentials, different account.
 *
 *   token     POST {BASE}/o/token/                    OAuth2 password grant, Basic client auth
 *   disburse  POST {BASE}/disburse/                   one transfer to one recipient
 *   inquire   GET  {BASE}/transaction/inquire/        status by transaction id / client reference
 *   budget    GET  {BASE}/budget/inquire/             our remaining balance at Paymob
 *
 * BASE is https://stagingpayouts.paymobsolutions.com/api/secure on staging and
 * https://payouts.paymobsolutions.com/api/secure in production (docs:
 * https://payouts.paymobsolutions.com/docs/).
 *
 * Three rules the caller must never have to think about:
 *   · The access token lives 60 minutes. It is cached and refreshed here; a 401 on any call
 *     gets exactly one fresh token and one retry — a 401 means Paymob rejected the request
 *     before processing it, so repeating it cannot move money twice.
 *   · `disburse` is NEVER retried for any other reason. A timeout or a 5xx may mean the
 *     money already left; the error says so (`uncertain: true`) and the caller resolves it by
 *     inquiry, never by sending again.
 *   · Inquiry and budget are throttled by Paymob at 5 requests / minute. A local bucket
 *     paces them below that so a burst of refreshes cannot lock the account out.
 *
 * The inquiry endpoint is a GET that carries a JSON body. `fetch` refuses to send a body on
 * a GET, so requests go through Node's own https module.
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");

const cfg = () => ({
  baseUrl: (process.env.PAYMOB_PAYOUT_BASE_URL || "").replace(/\/+$/, ""),
  clientId: process.env.PAYMOB_PAYOUT_CLIENT_ID || "",
  clientSecret: process.env.PAYMOB_PAYOUT_CLIENT_SECRET || "",
  username: process.env.PAYMOB_PAYOUT_USERNAME || "",
  password: process.env.PAYMOB_PAYOUT_PASSWORD || "",
});

const isConfigured = () => {
  const c = cfg();
  return !!(c.baseUrl && c.clientId && c.clientSecret && c.username && c.password);
};

/** "staging" | "production" | "custom" — shown on the admin screen so nobody mistakes one for the other. */
const environment = () => {
  const { baseUrl } = cfg();
  if (!baseUrl) return null;
  if (/stagingpayouts\./i.test(baseUrl)) return "staging";
  if (/\/\/payouts\.paymobsolutions\.com/i.test(baseUrl)) return "production";
  return "custom";
};

const DISBURSE_TIMEOUT_MS = 60 * 1000;
const READ_TIMEOUT_MS = 25 * 1000;

class PaymobPayoutError extends Error {
  /**
   * @param {boolean} uncertain  true when the request may have reached Paymob and been
   *                             acted on (timeout, dropped connection, 5xx). The caller
   *                             must then treat the transfer as "maybe sent".
   */
  constructor(message, { status = null, body = null, uncertain = false, code = null } = {}) {
    super(message);
    this.name = "PaymobPayoutError";
    this.status = status;
    this.body = body;
    this.uncertain = uncertain;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/*  Raw transport                                                     */
/* ------------------------------------------------------------------ */

// Network failures that happen BEFORE a request can have been delivered: nothing reached
// Paymob, so nothing can have been paid.
const PRE_SEND_ERRORS = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "CERT_HAS_EXPIRED"]);

function rawRequest(method, urlString, { headers = {}, body = null, timeoutMs = READ_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlString); } catch (e) { return reject(new PaymobPayoutError(`Bad Paymob URL: ${urlString}`)); }
    const lib = url.protocol === "http:" ? http : https;
    const payload = body == null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const req = lib.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          Accept: "application/json",
          ...headers,
          ...(payload ? { "Content-Length": payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
          resolve({ status: res.statusCode, json, text });
        });
        res.on("error", (err) => reject(Object.assign(err, { afterSend: true })));
      }
    );
    let sent = false;
    req.on("finish", () => { sent = true; });
    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`), { code: "ETIMEDOUT", afterSend: sent }));
    });
    req.on("error", (err) => reject(Object.assign(err, { afterSend: err.afterSend ?? sent })));
    if (payload) req.write(payload);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/*  Token                                                             */
/* ------------------------------------------------------------------ */

const token = { access: null, refresh: null, expiresAt: 0 };
let tokenFlight = null;

async function requestToken(form) {
  const c = cfg();
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
  const res = await rawRequest("POST", `${c.baseUrl}/o/token/`, {
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (res.status !== 200 || !res.json?.access_token) {
    const why = res.json?.error_description || res.json?.error || res.text?.slice(0, 200) || `HTTP ${res.status}`;
    throw new PaymobPayoutError(`Paymob Payouts login failed: ${why}`, { status: res.status, body: res.json, code: "AUTH_FAILED" });
  }
  token.access = res.json.access_token;
  token.refresh = res.json.refresh_token || null;
  token.expiresAt = Date.now() + (Number(res.json.expires_in) || 3600) * 1000;
  return token.access;
}

async function getAccessToken({ force = false } = {}) {
  if (!isConfigured()) {
    throw new PaymobPayoutError(
      "Paymob Payouts is not configured (PAYMOB_PAYOUT_BASE_URL / CLIENT_ID / CLIENT_SECRET / USERNAME / PASSWORD).",
      { code: "NOT_CONFIGURED" }
    );
  }
  if (!force && token.access && Date.now() < token.expiresAt - 60 * 1000) return token.access;
  if (tokenFlight) return tokenFlight;
  tokenFlight = (async () => {
    try {
      if (token.refresh && !force) {
        try {
          return await requestToken({ grant_type: "refresh_token", refresh_token: token.refresh });
        } catch (_) { /* refresh tokens are single-use; fall back to a fresh login */ }
      }
      const c = cfg();
      return await requestToken({ grant_type: "password", username: c.username, password: c.password });
    } finally {
      tokenFlight = null;
    }
  })();
  return tokenFlight;
}

/* ------------------------------------------------------------------ */
/*  Throttle for the 5 / minute endpoints                             */
/* ------------------------------------------------------------------ */

const READ_LIMIT = 4; // under Paymob's 5 / minute
const WINDOW_MS = 60 * 1000;
const readStamps = [];

async function waitForReadSlot() {
  for (;;) {
    const now = Date.now();
    while (readStamps.length && now - readStamps[0] > WINDOW_MS) readStamps.shift();
    if (readStamps.length < READ_LIMIT) { readStamps.push(now); return; }
    await new Promise((r) => setTimeout(r, WINDOW_MS - (now - readStamps[0]) + 100));
  }
}

/** One authenticated JSON call; on 401 a fresh token and ONE retry. */
async function authed(method, path, body, { timeoutMs } = {}) {
  const c = cfg();
  let access = await getAccessToken();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await rawRequest(method, `${c.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body,
      timeoutMs,
    });
    const unauthorised = res.status === 401 || String(res.json?.status_code) === "401";
    if (unauthorised && attempt === 0) {
      access = await getAccessToken({ force: true });
      continue;
    }
    return res;
  }
  // unreachable
  return null;
}

/* ------------------------------------------------------------------ */
/*  Endpoints                                                         */
/* ------------------------------------------------------------------ */

/**
 * Send one transfer. Resolves with Paymob's answer whatever it says (success, pending or a
 * business failure are all ANSWERS); rejects only when no answer exists, with `uncertain`
 * telling the caller whether the money may have moved anyway.
 */
async function disburse(payload) {
  let res;
  try {
    res = await authed("POST", "/disburse/", payload, { timeoutMs: DISBURSE_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof PaymobPayoutError) throw err; // not configured / login failed: nothing was sent
    const preSend = PRE_SEND_ERRORS.has(err.code) || err.afterSend === false;
    throw new PaymobPayoutError(`Paymob disburse: ${err.message}`, { uncertain: !preSend, code: err.code || "NETWORK" });
  }
  // A 5xx or a gateway error may have been raised after the transfer was booked.
  if (res.status >= 500 || res.status === 0) {
    throw new PaymobPayoutError(`Paymob disburse answered HTTP ${res.status}`, {
      status: res.status, body: res.json || res.text?.slice(0, 500), uncertain: true, code: "HTTP_5XX",
    });
  }
  // 429: throttled before processing. Anything else non-JSON is an answer we cannot read.
  if (res.status === 429) {
    throw new PaymobPayoutError("Paymob disburse was throttled (429); nothing was sent.", { status: 429, body: res.json, code: "THROTTLED" });
  }
  if (!res.json || typeof res.json !== "object") {
    throw new PaymobPayoutError(`Paymob disburse returned an unreadable answer (HTTP ${res.status})`, {
      status: res.status, body: res.text?.slice(0, 500), uncertain: true, code: "UNREADABLE",
    });
  }
  return { httpStatus: res.status, body: res.json };
}

/**
 * Transaction status by Paymob transaction ids and/or our client_reference_id values
 * (the endpoint accepts either, mixed). Returns the `results` array — follows `next` pages.
 */
async function inquire(ids, { bank = false } = {}) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  if (list.length === 0) return [];
  const results = [];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    let page = 1;
    for (;;) {
      await waitForReadSlot();
      const res = await authed("GET", `/transaction/inquire/${page > 1 ? `?page=${page}` : ""}`, {
        transactions_ids_list: chunk,
        ...(bank ? { bank_transactions: true } : {}),
      });
      if (res.status === 429 || String(res.json?.status_code) === "429") {
        throw new PaymobPayoutError("Paymob inquiry throttled (429)", { status: 429, body: res.json, code: "THROTTLED" });
      }
      if (res.status !== 200 || !res.json) {
        throw new PaymobPayoutError(`Paymob inquiry failed (HTTP ${res.status})`, { status: res.status, body: res.json || res.text?.slice(0, 300) });
      }
      results.push(...(Array.isArray(res.json.results) ? res.json.results : []));
      if (!res.json.next) break;
      page += 1;
    }
  }
  return results;
}

/**
 * The top-ups loaded into our Payouts budget — from the portal or the API, every status —
 * newest first, following the pages. Each: id, amount (a string), currency, transfer_type
 * (from_bank_transfer | from_bank_deposit | from_accept_balance), status (pending | approved
 * | rejected | initiated), accept_balance_transfer_id, bank_reference, created_at, updated_at.
 */
async function topups({ pageSize = 100 } = {}) {
  const results = [];
  for (let page = 1; page <= 50; page += 1) {
    await waitForReadSlot();
    const res = await authed("GET", `/topup/inquire/?page=${page}&page_size=${pageSize}`);
    if (res.status === 429 || String(res.json?.status_code) === "429") {
      throw new PaymobPayoutError("Paymob top-up inquiry throttled (429)", { status: 429, body: res.json, code: "THROTTLED" });
    }
    if (res.status !== 200 || !res.json) {
      throw new PaymobPayoutError(`Paymob top-up inquiry failed (HTTP ${res.status})`, { status: res.status, body: res.json || res.text?.slice(0, 300) });
    }
    const list = res.json.results?.topup_requests;
    results.push(...(Array.isArray(list) ? list : []));
    if (!res.json.next) break;
  }
  return results;
}

/** Our remaining balance at Paymob, as a number in EGP (null if unreadable). */
async function budget() {
  await waitForReadSlot();
  const res = await authed("GET", "/budget/inquire/");
  if (res.status !== 200 || !res.json) {
    throw new PaymobPayoutError(`Paymob budget inquiry failed (HTTP ${res.status})`, { status: res.status, body: res.json });
  }
  let amount = Number(res.json.current_balance);
  if (!Number.isFinite(amount)) {
    const m = String(res.json.current_budget || "").match(/([\d,.]+)/);
    amount = m ? Number(m[1].replace(/,/g, "")) : null;
  }
  return { balance: amount, currency: res.json.currency || "EGP", raw: res.json };
}

module.exports = {
  PaymobPayoutError,
  isConfigured,
  environment,
  getAccessToken,
  disburse,
  inquire,
  topups,
  budget,
};
