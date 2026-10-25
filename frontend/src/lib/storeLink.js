/**
 * Links to a vendor's store page.
 *
 * `store_username` is free text on this install — 44 stores carry spaces ("x-turbo auto
 * parts"), a "#" ("#el-mohandes"), Arabic, or an apostrophe. Put in a URL as-is, a space
 * ends the link wherever it is pasted (WhatsApp opened "/store/x-turbo"), and a "#" turns
 * the rest into a fragment the server never sees. Every store link is built here, encoded.
 */
export const storePath = (username) => `/store/${encodeURIComponent(String(username || ''))}`;

/**
 * What goes after /store/ for a vendor: its clean slug ("x-turbo-auto-parts") when the API
 * sent one, else the username (encoded by storePath, and still resolved by the server).
 */
export const storeKey = (vendor) => vendor?.store_slug || vendor?.store_username || '';

/** The same, absolute — for anything shared outside the site. */
export const storeUrl = (username, origin = '') => `${String(origin || '').replace(/\/$/, '')}${storePath(username)}`;

/**
 * The username back out of the route segment. Next can hand the segment over still
 * percent-encoded; decoding twice is harmless for real usernames, and a malformed
 * sequence is returned as it came rather than throwing.
 */
export const decodeStoreParam = (value) => {
    let v = String(value || '');
    for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(v); i += 1) {
        try { v = decodeURIComponent(v); } catch { break; }
    }
    return v;
};
