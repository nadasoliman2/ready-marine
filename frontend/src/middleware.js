import { NextResponse } from 'next/server';
import { DEFAULT_LOCALE, isLocale, isPagePath, localeOfPath, stripLocale } from './lib/locale';

/**
 * Rescue the WhatsApp button links that arrive with the site's own origin
 * pasted in front of them.
 *
 * The invitation and review templates both use a Meta DYNAMIC URL button, whose
 * delivered link is always `<template base> + <variable>`. The template base is
 * the bare domain (`https://readycar.store/`), and the provider — EverySecond —
 * refuses anything but a complete public URL in `button_url`:
 *
 *     button_url: "invite/<token>"  → 422 "button_url must be a public URL"
 *
 * So the only value it accepts is the full link, and the customer receives the
 * two concatenated:
 *
 *     https://readycar.store/https:/readycar.store/invite/<token>
 *
 * Nothing in the send path can produce a clean link while both of those hold,
 * and every link already sent is out there in that shape. This middleware makes
 * them work: any path that ENDS in `/invite/<token>` or `/review/<token>` AND
 * has something in front of it is forwarded to the real page. The canonical
 * `/invite/<token>` has nothing in front once the language is taken off, so it
 * cannot match its own rule — there is no redirect loop to guard against.
 *
 * The vendor's new-order message rides the same kind of button, and its link is
 * a dashboard page rather than a token — so the pasted origin itself is matched
 * too (`/https:/<host>/<real path>`), and whatever follows it is the destination.
 * It is only ever a path on this site: the host in front is thrown away, never
 * followed.
 *
 * A 307 rather than a 308: the mangled URL is a delivery accident, not an
 * address worth caching in the invitee's browser for good.
 */
const RESCUABLE = /^\/.*?\/(invite|review)\/([^/]+)\/?$/;
const PASTED_ORIGIN = /^\/https?:\/+[^/]+(\/.*)$/;

const LANGUAGE_COOKIE = 'language';
const ONE_YEAR = 60 * 60 * 24 * 365;

/** The language a URL without one should open in: `?lang=`, then the saved choice. */
const preferredLocale = (request) => {
    const asked = request.nextUrl.searchParams.get('lang');
    if (isLocale(asked)) return asked;
    const saved = request.cookies.get(LANGUAGE_COOKIE)?.value;
    return isLocale(saved) ? saved : DEFAULT_LOCALE;
};

/**
 * Send the browser to `path` in `locale`, keeping the query string but not `?lang=`, which
 * the path now says. A 307: which language a bare URL opens in depends on the visitor.
 */
const redirectTo = (request, path, locale) => {
    const url = request.nextUrl.clone();
    url.pathname = localeOfPath(path) ? path : `/${locale}${path === '/' ? '' : path}`;
    url.searchParams.delete('lang');
    return NextResponse.redirect(url, 307);
};

/**
 * Every page's URL starts with its language (`lib/locale.js`).
 *
 * - `/ar/products` is served from the route at `/products`, with the `language` cookie set
 *   to `ar` on the request — the root layout renders from that cookie — and saved on the
 *   response, so the URL is what decides the language.
 * - `/products` (an old link, an email, a WhatsApp message, the backend's redirects) is sent
 *   to `/<the visitor's language>/products`.
 * - `?lang=ar` (product links shared before the language moved into the path) switches the
 *   language and is dropped.
 */
export function middleware(request) {
    // The rewrite below comes back through here for the path it rewrote to (`/products`,
    // which has no language and would be redirected again). It still carries the headers
    // this function set on it, so let it through.
    if (request.headers.has('x-locale') && request.headers.has('x-pathname')) return NextResponse.next();

    const { pathname } = request.nextUrl;
    const locale = localeOfPath(pathname);
    const path = stripLocale(pathname);

    const match = path.match(RESCUABLE);
    const pasted = match ? null : path.match(PASTED_ORIGIN);
    if (match || pasted) {
        const target = match ? `/${match[1]}/${match[2]}` : pasted[1];
        return redirectTo(request, target, locale || preferredLocale(request));
    }

    if (!isPagePath(path)) return NextResponse.next();

    const asked = request.nextUrl.searchParams.get('lang');
    if (!locale || isLocale(asked)) return redirectTo(request, path, isLocale(asked) ? asked : preferredLocale(request));

    const saved = request.cookies.get(LANGUAGE_COOKIE)?.value;
    // Opened by the visitor themselves — typed, a bookmark, the browser's history or its
    // address-bar suggestions (`Sec-Fetch-Site: none`) — the language they chose wins over the
    // one in the URL. Safari offers the `/en/...` page visited before switching, and reopening
    // the site from it opened in English every time. A link followed from another site or
    // from within this one still decides.
    if (isLocale(saved) && saved !== locale && request.headers.get('sec-fetch-site') === 'none'
        && request.headers.get('sec-fetch-dest') === 'document') {
        return redirectTo(request, path, saved);
    }
    request.cookies.set(LANGUAGE_COOKIE, locale);
    const headers = new Headers(request.headers);
    headers.set('x-locale', locale);
    headers.set('x-pathname', path);

    const url = request.nextUrl.clone();
    url.pathname = path;
    const response = NextResponse.rewrite(url, { request: { headers } });
    // Saved only when a page is opened (`Sec-Fetch-Dest: document`), not for the router's own
    // fetches — its prefetches load links in the background, and a `/en/...` one still in
    // flight when the visitor switched to Arabic answered afterwards and put the saved choice
    // back to English. (Next strips its RSC and prefetch headers before middleware, so the
    // browser's header is what tells them apart. A browser without it is treated as a page.)
    // The router's navigations need nothing here: the app saves the language the URL carries.
    const dest = request.headers.get('sec-fetch-dest');
    const opensPage = !dest || dest === 'document';
    if (saved !== locale && opensPage) {
        response.cookies.set(LANGUAGE_COOKIE, locale, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' });
    }
    return response;
}

/**
 * Every page. Next's assets, the API, uploads and files (anything with a dot: `/logo.png`,
 * `/sitemap.xml`) never enter the middleware — except a pasted origin, whose host has a dot.
 */
export const config = {
    matcher: ['/((?!_next|api|uploads|.*\\..*).*)', '/(https?:/.*)', '/(en|ar)/(https?:/.*)'],
};
