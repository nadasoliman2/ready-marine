const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../public/uploads/products');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT = ['.jpeg', '.jpg', '.png', '.webp'];
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * The first four bytes of each format we accept, and where to look.
 *
 * This is what actually decides whether a file is an image. The browser's declared
 * mimetype is a claim, not evidence: it can be forged by anything that is not a browser,
 * and — the reason this exists — it is also WRONG on ordinary machines. A Windows install
 * with no WebP association attached sends `application/octet-stream` for a perfectly valid
 * .webp, so a check that trusted the claim rejected real images while a renamed .exe with
 * the right header would have walked straight through.
 */
const SIGNATURES = [
    { ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { ext: '.png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
    {
        ext: '.webp',
        // RIFF....WEBP — the container tag sits at byte 8, after the 4-byte length.
        test: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP',
    },
];

const looksLikeImage = (filePath) => {
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        const head = Buffer.alloc(12);
        const read = fs.readSync(fd, head, 0, 12, 0);
        if (read < 12) return false;
        return SIGNATURES.some((s) => s.test(head));
    } catch {
        return false;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        // Keep the extension lowercase: some phones produce `.JPG`, and the same file
        // uploaded twice should not produce two differently-cased URLs.
        cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
    },
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_BYTES },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const mime = String(file.mimetype || '').toLowerCase();

        // EITHER signal is enough to get through this gate, because either one alone is
        // unreliable: the mimetype can be missing or generic, and a file can arrive with
        // no extension at all. Neither is trusted as proof — the bytes are checked after
        // the write, and that is the check that actually decides.
        if (ALLOWED_EXT.includes(ext) || ALLOWED_MIME.includes(mime)) return cb(null, true);

        const err = new Error(`"${file.originalname}" is not a supported image. Use JPG, PNG or WebP.`);
        err.code = 'UNSUPPORTED_FILE_TYPE';
        return cb(err);
    },
});

// Upload Single or Multiple Images
router.post(
    '/',
    upload.fields([
        { name: 'images', maxCount: 10 },
        { name: 'image', maxCount: 10 },
    ]),
    (req, res) => {
        const files = [
            ...((req.files && req.files.images) || []),
            ...((req.files && req.files.image) || []),
        ];

        if (files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded' });
        }

        // Now that the bytes are on disk, ask them what they are. Anything that fails is
        // removed immediately rather than left in a publicly served directory.
        const rejected = [];
        const accepted = [];
        for (const file of files) {
            if (looksLikeImage(file.path)) {
                accepted.push(file);
            } else {
                rejected.push(file.originalname);
                fs.promises.unlink(file.path).catch(() => {});
            }
        }

        if (accepted.length === 0) {
            return res.status(400).json({
                message: `Not a valid image file: ${rejected.join(', ')}. Use JPG, PNG or WebP.`,
                code: 'INVALID_IMAGE',
            });
        }

        const baseUrl = process.env.BACKEND_PUBLIC_URL || (req.protocol + '://' + req.get('host'));
        const fileUrls = accepted.map((file) => ({
            url: baseUrl + '/uploads/products/' + file.filename,
            is_primary: false, // the frontend can decide which one is primary
        }));

        res.status(200).json({
            message: 'Images uploaded successfully',
            images: fileUrls,
            url: fileUrls[0].url,
            // Named so a partly-successful upload is visible instead of silently dropping
            // files the caller believed had gone up.
            ...(rejected.length ? { rejected } : {}),
        });
    },
);

/**
 * Multer reports a rejected file by THROWING, which lands here and not in the handler
 * above. Without this the client got a 500 and a stack-shaped body, so every upload
 * problem — wrong type, too large, too many — looked identical and looked like a server
 * fault. These are all the caller's input, so they are 400s that say what to change.
 */
router.use((err, req, res, next) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            message: `That image is larger than ${MAX_BYTES / (1024 * 1024)}MB. Please compress it and try again.`,
            code: 'FILE_TOO_LARGE',
        });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ message: 'Too many files in one upload. Send 10 or fewer.', code: err.code });
    }
    if (err.code === 'UNSUPPORTED_FILE_TYPE') {
        return res.status(400).json({ message: err.message, code: err.code });
    }

    console.error('[Upload]', err.message);
    return res.status(500).json({ message: 'The upload could not be completed.' });
});

module.exports = router;
