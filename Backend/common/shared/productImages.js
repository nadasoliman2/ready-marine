/**
 * Keep "primary image" meaning the same thing everywhere.
 *
 * The flag `is_primary` is only half of how this codebase asks for a product's main image.
 * The other half is `images[0]`, and that half is used by almost everything a customer or
 * an admin actually looks at: the storefront card, the cart line, the vendor and admin
 * product tables, the pending-approval grid, the order line thumbnails, and the opening
 * slide of the product gallery (`selectedImage` starts at 0).
 *
 * So a "Set as Primary" button that flipped the flag without touching the order saved
 * perfectly and changed nothing anybody could see — which is indistinguishable from a
 * button that does not work.
 *
 * Normalising the array on write, rather than correcting each reader, is what stops the two
 * readings from drifting apart again: after this the flag and the first element always name
 * the same image, including for code written later that reaches for `images[0]` without
 * knowing the flag exists.
 */

/**
 * Return the images with exactly one primary, placed first. Order is otherwise preserved.
 *
 * Anything that is not a non-empty array is handed back untouched: an update that does not
 * mention images must not be turned into one that clears them.
 */
const normalizeProductImages = (images) => {
    if (!Array.isArray(images) || images.length === 0) return images;

    const marked = images.findIndex((img) => img && img.is_primary);
    // No flag anywhere — the first image is the primary, which is exactly what every
    // `images[0]` fallback in the codebase already assumed it was.
    const chosen = marked >= 0 ? marked : 0;

    const normalized = images.map((img, i) => ({
        // Mongoose subdocuments arrive on some paths and plain objects on others.
        ...(typeof img?.toObject === 'function' ? img.toObject() : img),
        is_primary: i === chosen,
    }));

    const [primary] = normalized.splice(chosen, 1);
    normalized.unshift(primary);
    return normalized;
};

module.exports = { normalizeProductImages };
