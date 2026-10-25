/**
 * The `?redirect=` a page was opened with, if it is a path on this site; otherwise the
 * fallback. Only `/…` is accepted — never `//host` or a full URL — so a crafted link to the
 * login or signup page cannot send someone to another site after they sign in.
 */
export const safeRedirect = (fallback) => {
    if (typeof window === 'undefined') return fallback;
    const value = new URLSearchParams(window.location.search).get('redirect');
    return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : fallback;
};
