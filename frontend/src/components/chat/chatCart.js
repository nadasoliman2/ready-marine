/*
 * The two carts — the chat assistant's basket and the website cart — kept in
 * step (Backend/docs/EVERYSECOND_CHAT_COMMERCE.md). Pure functions, so the
 * widget's effects stay small.
 *
 * A basket line from the backend: { externalId, name, qty, unitPrice, lineTotal,
 * image, slugEn, slugAr, cart: { product, variant } | null }. `cart` is what the
 * storefront's addToCart needs; a line without it is not one of our products
 * and stays in the chat only.
 */

const lineKeyOf = (ref) => (ref?.variant?._id ? `${ref.product._id}__${ref.variant._id}` : String(ref?.product?._id || ''));

/**
 * What one of the assistant's turns changed, as website-cart changes. Only the
 * difference is applied — never the whole basket — so reloading the page or
 * opening the chat on another device adds nothing twice, and what the customer
 * put in the cart themselves is left alone. When the basket becomes an order,
 * its lines leave the website cart: they were bought.
 */
export function siteCartChanges(previous, next) {
    const changes = new Map();
    const tally = (cart, sign) => {
        for (const line of cart?.items || []) {
            if (!line.cart?.product?._id) continue;
            const key = lineKeyOf(line.cart);
            const entry = changes.get(key) || { ref: line.cart, delta: 0 };
            entry.delta += sign * line.qty;
            changes.set(key, entry);
        }
    };
    tally(previous, -1);
    tally(next, 1);
    return [...changes.values()].filter((c) => c.delta !== 0);
}

/** The website cart as basket input — products only; bundles are not on the agent's menu. */
export function basketLinesOf(cartItems) {
    return (cartItems || []).flatMap((item) => {
        if (item?.is_bundle || item?.bundle_id || !item?.product?._id) return [];
        return [{ productId: String(item.product._id), variantId: item.variant?._id ? String(item.variant._id) : null, qty: Number(item.quantity) || 1 }];
    });
}

/** The chat basket's lines that are our products, in the same shape. */
export function chatBasketLines(cart) {
    return (cart?.items || []).flatMap((line) => (line.cart?.product?._id
        ? [{ productId: String(line.cart.product._id), variantId: line.cart.variant?._id ? String(line.cart.variant._id) : null, qty: line.qty }]
        : []));
}

const basketKey = (line) => `${line.productId}${line.variantId ? `~${line.variantId}` : ''}`;

/**
 * An order-free fingerprint of a basket. With `refusals`, lines EverySecond
 * already refused are left out and capped ones count at their cap, so a cart
 * that differs only by what the chat cannot take is not sent again and again.
 */
export function basketSignature(lines, refusals) {
    const qty = new Map();
    for (const line of lines) {
        const key = basketKey(line);
        if (refusals?.skip.has(key)) continue;
        qty.set(key, (qty.get(key) || 0) + line.qty);
    }
    return [...qty.entries()].map(([k, n]) => `${k}:${Math.min(n, refusals?.caps.get(k) ?? n)}`).sort().join('|');
}

export const noRefusals = () => ({ skip: new Set(), caps: new Map() });

export function refusalsOf(res) {
    return {
        skip: new Set((res?.skipped || []).map(basketKey)),
        caps: new Map((res?.adjusted || []).filter((a) => a.qty != null).map((a) => [basketKey(a), Number(a.qty)])),
    };
}

/** Lines a turn added (by quantity) — what the fly-to-cart animation shows. A new basket id starts from empty. */
export function addedLines(previous, next) {
    const sum = (items) => {
        const out = new Map();
        for (const line of items || []) {
            const key = line.externalId || line.name;
            const existing = out.get(key);
            out.set(key, { ...line, qty: (existing?.qty || 0) + line.qty });
        }
        return out;
    };
    const before = sum(previous && next && previous.id === next.id ? previous.items : []);
    return [...sum(next?.items).values()].flatMap((line) => {
        const qty = line.qty - (before.get(line.externalId || line.name)?.qty || 0);
        return qty > 0 ? [{ ...line, qty }] : [];
    });
}

/* ---------- the guest's chat session ---------- */

const SESSION_KEY = 'readycar-chat-session';

export function storedSession() {
    try {
        const id = window.localStorage.getItem(SESSION_KEY) || '';
        return /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : '';
    } catch {
        return '';
    }
}

/** The guest's session id, created on first use — so browsing never opens a conversation. */
export function ensureSession() {
    const existing = storedSession();
    if (existing) return existing;
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, '')
        : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    try {
        window.localStorage.setItem(SESSION_KEY, id);
    } catch {
        // Private mode: the conversation lasts as long as the page.
    }
    return id;
}

export function forgetSession() {
    try {
        window.localStorage.removeItem(SESSION_KEY);
    } catch {
        // nothing stored
    }
}
