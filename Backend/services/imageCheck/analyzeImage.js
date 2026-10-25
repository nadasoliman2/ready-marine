const sharp = require('sharp');

/**
 * What is wrong with one product picture, measured — no model, no network, ~20 ms.
 *
 * The picture is decoded once at full size for its real dimensions, then worked on as a
 * 256-pixel copy (on white, so a transparent background reads as the white it shows as):
 *
 *   border_white  share of the outer 3% that is near-white — the shop's look is "on white"
 *   fill          the product's box against the picture, when the background is white
 *   offset        how far that box sits from the centre (0 = centred, 1 = at an edge)
 *   sharpness     how crisp the picture is at the size a customer sees it (0 soft – 100 crisp)
 *   brightness / contrast of the product
 *   dhash         a 64-bit look-alike fingerprint: the same picture reused across many
 *                 products (a placeholder, a logo, a stock banner) has the same one
 */

const WORK = 256;
const SHARP_SIDE = 1024;
const NEAR_WHITE_MIN = 235;
const NEAR_WHITE_SPREAD = 16;

const isWhite = (r, g, b) => {
    const mn = Math.min(r, g, b);
    return mn >= NEAR_WHITE_MIN && Math.max(r, g, b) - mn <= NEAR_WHITE_SPREAD;
};

/**
 * Crété's no-reference blur measure, 0 (crisp) to 1 (fully blurred): the share of the
 * picture's neighbour-to-neighbour variation that a 9-tap average does NOT remove.
 */
const blurEffect = (g, w, h) => {
    const K = 9;
    const half = 4;
    let worst = 0;
    for (const vertical of [true, false]) {
        const len = vertical ? h : w;
        const lines = vertical ? w : h;
        const at = vertical ? (line, k) => k * w + line : (line, k) => line * w + k;
        let sumF = 0;
        let sumV = 0;
        const blurred = new Float32Array(len);
        for (let line = 0; line < lines; line += 1) {
            // running 9-tap average along the line, edges clamped
            let acc = 0;
            for (let k = -half; k <= half; k += 1) acc += g[at(line, Math.min(len - 1, Math.max(0, k)))];
            for (let k = 0; k < len; k += 1) {
                blurred[k] = acc / K;
                acc += g[at(line, Math.min(len - 1, k + half + 1))] - g[at(line, Math.max(0, k - half))];
            }
            for (let k = 1; k < len; k += 1) {
                const dF = Math.abs(g[at(line, k)] - g[at(line, k - 1)]);
                const dB = Math.abs(blurred[k] - blurred[k - 1]);
                sumF += dF;
                sumV += Math.max(0, dF - dB);
            }
        }
        const b = sumF > 0 ? (sumF - sumV) / sumF : 1;
        if (b > worst) worst = b;
    }
    return worst;
};

/** dHash: 9×8 grey, each pixel brighter than its right neighbour → one bit. */
const dhashOf = async (input) => {
    const { data } = await sharp(input).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    let hex = '';
    for (let y = 0; y < 8; y += 1) {
        let byte = 0;
        for (let x = 0; x < 8; x += 1) byte = (byte << 1) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1 : 0);
        hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
};

const analyzeBuffer = async (buffer) => {
    const base = sharp(buffer, { failOn: 'none', limitInputPixels: 60_000_000 });
    const meta = await base.metadata();
    if (!meta.width || !meta.height) throw Object.assign(new Error('not an image'), { code: 'UNREADABLE' });
    // EXIF orientations 5–8 are stored on their side.
    const swap = meta.orientation >= 5;
    const width = swap ? meta.height : meta.width;
    const height = swap ? meta.width : meta.height;

    const flat = sharp(buffer, { failOn: 'none', limitInputPixels: 60_000_000 }).rotate().flatten({ background: '#ffffff' });

    // ---- the small copy: background, framing, light ----
    const { data, info } = await flat.clone().resize(WORK, WORK, { fit: 'inside', withoutEnlargement: false })
        .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const band = Math.max(2, Math.round(Math.min(W, H) * 0.03));
    let borderTotal = 0;
    let borderWhite = 0;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    let lumSum = 0, lumSq = 0, contentCount = 0;
    for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
            const i = (y * W + x) * 3;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const white = isWhite(r, g, b);
            if (x < band || y < band || x >= W - band || y >= H - band) {
                borderTotal += 1;
                if (white) borderWhite += 1;
            }
            if (!white) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                lumSum += lum;
                lumSq += lum * lum;
                contentCount += 1;
            }
        }
    }
    const borderWhiteShare = borderTotal ? borderWhite / borderTotal : 0;
    const contentShare = contentCount / (W * H);
    const hasBox = x1 >= x0 && y1 >= y0;
    const boxW = hasBox ? (x1 - x0 + 1) / W : 0;
    const boxH = hasBox ? (y1 - y0 + 1) / H : 0;
    // How much of the frame the product fills, measured as a square frame would show it.
    const side = Math.max(W, H);
    const fill = hasBox ? Math.max((x1 - x0 + 1) / side, (y1 - y0 + 1) / side) : 0;
    const cx = hasBox ? (x0 + x1 + 1) / 2 / W : 0.5;
    const cy = hasBox ? (y0 + y1 + 1) / 2 / H : 0.5;
    const offset = Math.min(1, Math.max(Math.abs(cx - 0.5), Math.abs(cy - 0.5)) * 2);
    const brightness = contentCount ? lumSum / contentCount : 255;
    const contrast = contentCount ? Math.sqrt(Math.max(0, lumSq / contentCount - (lumSum / contentCount) ** 2)) : 0;

    // ---- sharpness, as a customer sees it: at 1024 px on the long side ----
    // Crété et al. 2007, "The blur effect": blur the picture a little more and see how much
    // its edges change. A sharp picture loses a lot; one that is already soft barely moves.
    // It looks only at differences between neighbours, so a plain white background and flat
    // logos neither help nor hurt, and a small photo stretched to fill the page reads soft.
    const grey = await flat.clone().greyscale().resize(SHARP_SIDE, SHARP_SIDE, { fit: 'inside', withoutEnlargement: false })
        .raw().toBuffer({ resolveWithObject: true });
    const sharpness = Math.round((1 - blurEffect(grey.data, grey.info.width, grey.info.height)) * 1000) / 10;

    return {
        width,
        height,
        format: meta.format || null,
        bytes: buffer.length,
        has_alpha: !!meta.hasAlpha,
        border_white: Math.round(borderWhiteShare * 1000) / 1000,
        content: Math.round(contentShare * 1000) / 1000,
        fill: Math.round(fill * 1000) / 1000,
        box: hasBox ? [Math.round(boxW * 1000) / 1000, Math.round(boxH * 1000) / 1000] : null,
        offset: Math.round(offset * 1000) / 1000,
        sharpness,
        brightness: Math.round(brightness),
        contrast: Math.round(contrast),
        dhash: await dhashOf(await flat.clone().resize(64, 64, { fit: 'fill' }).png().toBuffer()),
    };
};

module.exports = { analyzeBuffer, dhashOf };
