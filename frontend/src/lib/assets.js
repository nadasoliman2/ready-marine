const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export const apiOrigin = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');

export const resolveAssetUrl = (url) => {
    if (!url) return '';
    if (/^(https?:)?\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) return url;
    if (url.startsWith('/')) return `${apiOrigin}${url}`;
    return url;
};

/**
 * A smaller copy of an uploaded image for places that show it small (cards, tables,
 * the cart). The backend renders and caches `?w=` copies of anything under /uploads;
 * if it ever can't, the same URL simply serves the original, so this can only ever
 * make an image lighter, never break it. Images hosted anywhere else are left alone.
 */
export const thumbUrl = (url, width = 480) => {
    // Anything that is not an uploaded image goes back exactly as it came in.
    if (!url || typeof url !== 'string' || !url.includes('/uploads/') || url.includes('?')) return url;
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    return `${url}?w=${width}`;
};
