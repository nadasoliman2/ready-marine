/**
 * One inbox, one spelling.
 *
 * Several providers deliver different spellings of an address to the same inbox:
 *   · Gmail ignores dots and everything after "+" — f.a.r.e.s+shop@gmail.com IS
 *     fares@gmail.com — and googlemail.com is gmail.com;
 *   · Outlook/Hotmail/Live, iCloud and Proton deliver "name+anything@" to "name@".
 * If the site stores them as typed, one person ends up with two accounts that
 * email sign-in can only ever reach one of (which happened). So every email is
 * stored, and every lookup is made, in this canonical form — enforced in the User
 * and Seller schemas themselves, so no code path can write or search around it.
 *
 * Pure and dependency-free on purpose: the models import it.
 */
const PLUS_ADDRESSING_DOMAINS = new Set([
    'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'icloud.com', 'me.com', 'mac.com',
    'protonmail.com', 'proton.me', 'pm.me',
]);

const canonicalEmail = (email) => {
    if (email === null || email === undefined) return email;
    const value = String(email).trim().toLowerCase();
    if (!value) return value;
    const at = value.lastIndexOf('@');
    if (at <= 0 || at === value.length - 1) return value;

    let local = value.slice(0, at);
    let domain = value.slice(at + 1);
    if (domain === 'googlemail.com') domain = 'gmail.com';

    if (domain === 'gmail.com') {
        local = local.split('+')[0].replace(/\./g, '');
    } else if (PLUS_ADDRESSING_DOMAINS.has(domain)) {
        local = local.split('+')[0];
    }
    return local ? `${local}@${domain}` : value;
};

module.exports = { canonicalEmail, PLUS_ADDRESSING_DOMAINS };
