/**
 * HTTP client for Arrive Shipping's `api/shipment.php`.
 *
 * One endpoint, an `action` query parameter, credentials in the JSON body. Answers come back
 * either as `{ "response": [...] }` or as a bare array (`getAllSectors` does the latter), and
 * a wrong credential is a 401 with the text "User Not found".
 *
 * Two things the caller must never have to think about:
 *   · the 50 requests / minute limit — a token bucket below paces every call, including the
 *     polling sweep, so a burst of webhook-driven look-ups cannot lock the account out;
 *   · retries — safe only for READ actions. `addShipment` is never retried here: Arrive has no
 *     duplicate-reference guard, so a retried create can mean two parcels billed for one order.
 */
const BASE_URL = (process.env.ARRIVE_BASE_URL || "https://arrive-shipping.com").replace(/\/+$/, "");
const API_USER = process.env.ARRIVE_API_USER || "";
const API_PASSWORD = process.env.ARRIVE_API_PASSWORD || "";
const TIMEOUT_MS = 25 * 1000;

const RATE_LIMIT = 45;         // a little under Arrive's 50/min
const WINDOW_MS = 60 * 1000;
const stamps = [];

const isConfigured = () => !!(API_USER && API_PASSWORD);

async function waitForSlot() {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > WINDOW_MS) stamps.shift();
    if (stamps.length < RATE_LIMIT) { stamps.push(now); return; }
    await new Promise((r) => setTimeout(r, WINDOW_MS - (now - stamps[0]) + 50));
  }
}

class ArriveError extends Error {
  constructor(message, { status = null, body = null, action = null } = {}) {
    super(message);
    this.name = "ArriveError";
    this.status = status;
    this.body = body;
    this.action = action;
  }
}

/** Unwrap Arrive's two answer shapes into the payload, or throw with the server's words. */
function unwrap(json, action, status) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    if (Array.isArray(json.response)) return json.response;
    if (json.response && typeof json.response === "object") return [json.response];
    const msg = json.error || json.message || json.msg;
    if (msg) throw new ArriveError(`Arrive ${action}: ${msg}`, { status, body: json, action });
    return json;
  }
  if (typeof json === "string") throw new ArriveError(`Arrive ${action}: ${json}`, { status, body: json, action });
  return json;
}

async function callOnce(action, body) {
  if (!isConfigured()) throw new ArriveError("Arrive API credentials are not configured (ARRIVE_API_USER / ARRIVE_API_PASSWORD)", { action });
  await waitForSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/shipment.php?action=${encodeURIComponent(action)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ user: API_USER, password: API_PASSWORD, ...body }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { json = text; }
    if (!res.ok) {
      const msg = typeof json === "string" ? json : (json?.error || json?.message || text);
      throw new ArriveError(`Arrive ${action} failed (${res.status}): ${String(msg).slice(0, 300)}`, { status: res.status, body: json, action });
    }
    return unwrap(json, action, res.status);
  } catch (err) {
    if (err.name === "AbortError") throw new ArriveError(`Arrive ${action} timed out after ${TIMEOUT_MS / 1000}s`, { action, status: 0 });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const isTransient = (err) => err?.status === 0 || (err?.status >= 500) || /ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(err?.message || "");

/** Read actions: retried on transport failures and 5xx. */
async function read(action, body = {}, { retries = 2 } = {}) {
  let last;
  for (let i = 0; i <= retries; i += 1) {
    try { return await callOnce(action, body); }
    catch (err) {
      last = err;
      if (!isTransient(err) || i === retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

/** Write actions: exactly one attempt. The caller decides what an uncertain outcome means. */
const write = (action, body = {}) => callOnce(action, body);

module.exports = { read, write, isConfigured, ArriveError, BASE_URL };
