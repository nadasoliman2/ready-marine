const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const catalogService = require('../services/catalogService');
const catalogMatchService = require('../services/catalogMatchService');

/**
 * Master catalog — admin surface.
 *
 * The catalog is an admin-only entity. Vendors read it through the search gate
 * and nothing else; everything that shapes it — creating, editing, approving a
 * suggestion, merging duplicates, archiving — lives here, along with the
 * "which merchants carry this, at what price" analytics that are deliberately
 * never exposed to vendors.
 */

const ID = ':id([0-9a-fA-F]{24})';

/**
 * @desc    Per-status counts (drives the Suggestions tab badge)
 * @route   GET /api/admin/catalog/counts
 */
/**
 * @desc    The categories and brands present in the catalog, for the search filters
 * @route   GET /api/admin/catalog/filters
 */
router.get('/filters', protect('admin'), async (req, res) => {
    try {
        res.json(await catalogService.getCatalogFacets({
            status: req.query.status,
            category_id: req.query.category_id,
            product_brand_id: req.query.product_brand_id,
        }));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get('/counts', protect('admin'), async (req, res) => {
    try {
        res.json(await catalogService.getStatusCounts());
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    List entries for a tab (approved / suggested / archived / all)
 * @route   GET /api/admin/catalog
 */
router.get('/', protect('admin'), async (req, res) => {
    try {
        const result = await catalogService.listEntries({
            status: req.query.status,
            q: req.query.q,
            category_id: req.query.category_id,
            product_brand_id: req.query.product_brand_id,
            page: req.query.page,
            limit: req.query.limit,
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Create an entry (admin-authored entries are approved immediately)
 * @route   POST /api/admin/catalog
 */
router.post('/', protect('admin'), async (req, res) => {
    try {
        const entry = await catalogService.createEntry(req.body, { role: 'admin' });
        res.status(201).json({ message: 'Catalog entry created', entry });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    One entry with its vendor analytics
 * @route   GET /api/admin/catalog/:id
 */
router.get(`/${ID}`, protect('admin'), async (req, res) => {
    try {
        const detail = await catalogService.getEntryDetail(req.params.id);
        if (!detail) return res.status(404).json({ message: 'Catalog entry not found' });
        res.json(detail);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Entries that look like this one — the merge candidates on a suggestion
 * @route   GET /api/admin/catalog/:id/similar
 */
router.get(`/${ID}/similar`, protect('admin'), async (req, res) => {
    try {
        const detail = await catalogService.getEntryDetail(req.params.id);
        if (!detail) return res.status(404).json({ message: 'Catalog entry not found' });
        res.json({ similar: await catalogService.findSimilarEntries(detail.entry) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    The similar entries of a page of suggestions in one request — { similar: { id: [...] } }.
 *          One request per card sent up to 200 at once, and nginx refused them (429).
 * @route   POST /api/admin/catalog/similar   body: { ids: [...] }, at most 100
 */
router.post('/similar', protect('admin'), async (req, res) => {
    try {
        res.json({ similar: await catalogService.findSimilarForEntries(req.body?.ids) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Edit an entry. Never propagates: linked products keep the copy they
 *          were created with, so nothing published changes under a vendor.
 * @route   PUT /api/admin/catalog/:id
 */
router.put(`/${ID}`, protect('admin'), async (req, res) => {
    try {
        const entry = await catalogService.updateEntry(req.params.id, req.body);
        res.json({ message: 'Catalog entry updated', entry });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Approve a suggestion, optionally after editing it
 * @route   POST /api/admin/catalog/:id/approve
 */
router.post(`/${ID}/approve`, protect('admin'), async (req, res) => {
    try {
        const entry = await catalogService.approveEntry(req.params.id, req.body?.edits || null);
        res.json({ message: 'Catalog entry approved', entry });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Merge this entry into another. Products move silently; their own data
 *          is untouched — only the link is corrected.
 * @route   POST /api/admin/catalog/:id/merge
 */
router.post(`/${ID}/merge`, protect('admin'), async (req, res) => {
    try {
        const result = await catalogService.mergeEntry(req.params.id, req.body?.target_id);
        res.json({ message: `Merged. ${result.moved} product(s) moved.`, moved: result.moved, target: result.target });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Archive — disappears from vendor search; linked products stay live
 * @route   POST /api/admin/catalog/:id/archive
 */
router.post(`/${ID}/archive`, protect('admin'), async (req, res) => {
    try {
        const entry = await catalogService.archiveEntry(req.params.id);
        res.json({ message: 'Catalog entry archived', entry });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Reject a suggestion — it leaves the queue and is never offered again.
 * @route   POST /api/admin/catalog/:id/reject
 */
router.post(`/${ID}/reject`, protect('admin'), async (req, res) => {
    try {
        const entry = await catalogService.rejectEntry(req.params.id);
        res.json({ message: 'Suggestion rejected', entry });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Restore an archived entry (or a rejected suggestion, back to the queue)
 * @route   POST /api/admin/catalog/:id/restore
 */
router.post(`/${ID}/restore`, protect('admin'), async (req, res) => {
    try {
        const entry = await catalogService.restoreEntry(req.params.id);
        res.json({ message: 'Catalog entry restored', entry });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Hard delete — refused for any entry with linked products
 * @route   DELETE /api/admin/catalog/:id
 */
router.delete(`/${ID}`, protect('admin'), async (req, res) => {
    try {
        await catalogService.deleteEntry(req.params.id);
        res.json({ message: 'Catalog entry deleted' });
    } catch (error) {
        const status = error.code === 'ENTRY_HAS_PRODUCTS' ? 409 : 400;
        res.status(status).json({ message: error.message, code: error.code });
    }
});

/**
 * @desc    Point a product at a different entry, or at none. The admin's fix for
 *          a product that was edited into something else after being linked.
 * @route   PUT /api/admin/catalog/products/:productId/link
 */
router.put('/products/:productId([0-9a-fA-F]{24})/link', protect('admin'), async (req, res) => {
    try {
        const entryId = req.body?.catalog_entry_id ?? null;
        const linked = await catalogService.relinkProduct(req.params.productId, entryId);
        res.json({ message: linked ? 'Product relinked' : 'Product unlinked', catalog_entry_id: linked });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Linked products missing images or a brand — the data-entry worklists.
 * @route   GET /api/admin/catalog/linked-gaps?gap=images|brand&q=&page=&limit=
 */
router.get('/linked-gaps', protect('admin'), async (req, res) => {
    try {
        res.json(await catalogService.listLinkedGaps({
            gap: req.query.gap,
            q: req.query.q,
            page: req.query.page,
            limit: req.query.limit,
        }));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Pull the linked entry's images onto the product (additive; entry primary wins).
 * @route   POST /api/admin/catalog/products/:productId/import-images
 */
router.post('/products/:productId([0-9a-fA-F]{24})/import-images', protect('admin'), async (req, res) => {
    try {
        const result = await catalogService.importImagesFromEntry(req.params.productId);
        res.json({ message: 'Images imported', ...result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Pull the linked entry's brand onto the product.
 * @route   POST /api/admin/catalog/products/:productId/import-brand
 */
router.post('/products/:productId([0-9a-fA-F]{24})/import-brand', protect('admin'), async (req, res) => {
    try {
        const result = await catalogService.importBrandFromEntry(req.params.productId);
        res.json({ message: 'Brand imported', ...result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/* ------------------ Link suggestions ------------------
 *
 * The catalog matcher's proposals (services/catalogMatchService.js): for a product, the
 * entries it most likely is, each with a level (strong / likely / possible) and the reasons.
 */

/**
 * @desc    Proposals for a page of products at once — { matches: { productId: [entry…] } }
 * @route   POST /api/admin/catalog/match/products   body: { ids: [...] }, at most 100
 */
router.post('/match/products', protect('admin'), async (req, res) => {
    try {
        res.json({ matches: await catalogMatchService.matchProducts(req.body?.ids, { limit: Math.min(Number(req.body?.limit) || 3, 10) }) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Proposals for one product (its review page)
 * @route   GET /api/admin/catalog/match/products/:productId
 */
router.get('/match/products/:productId([0-9a-fA-F]{24})', protect('admin'), async (req, res) => {
    try {
        const matches = await catalogMatchService.matchProducts([req.params.productId], { limit: 5 });
        res.json({ matches: matches[req.params.productId] || [] });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Linked products that do not read like their entry — a link to look at again
 * @route   GET /api/admin/catalog/link-review?page=&limit=
 */
router.get('/link-review', protect('admin'), async (req, res) => {
    try {
        res.json(await catalogMatchService.reviewLinks({ page: req.query.page, limit: req.query.limit }));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    The flagged link is right: take it off the review list
 * @route   POST /api/admin/catalog/link-review/:productId/keep
 */
router.post('/link-review/:productId([0-9a-fA-F]{24})/keep', protect('admin'), async (req, res) => {
    try {
        res.json({ message: 'Link kept', ...(await catalogMatchService.keepLink(req.params.productId)) });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/* ------------------ Unlinked vendor products ------------------
 *
 * The worklist behind the catalog's fourth tab: vendor products that never got
 * attached to an entry. Two ways out for each — publish it as a new template, or
 * point it at a template the catalog already has.
 */

/**
 * @desc    Categories and brands present among unlinked products, for that tab's filters
 * @route   GET /api/admin/catalog/unlinked-products/filters
 *
 * Separate from /catalog/filters on purpose: that one describes catalog ENTRIES and this
 * one describes PRODUCTS, and the brands that fill this worklist are exactly the ones the
 * catalog does not cover.
 */
router.get('/unlinked-products/filters', protect('admin'), async (req, res) => {
    try {
        res.json(await catalogService.getUnlinkedProductFacets({
            status: req.query.status || 'all',
            category_id: req.query.category_id,
            product_brand_id: req.query.product_brand_id,
        }));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Vendor products with no catalog entry, filtered by the PRODUCT's status.
 * @route   GET /api/admin/catalog/unlinked-products
 */
router.get('/unlinked-products', protect('admin'), async (req, res) => {
    try {
        const [list, counts] = await Promise.all([
            catalogService.listUnlinkedProducts({
                status: req.query.status || 'all',
                q: req.query.q || '',
                category_id: req.query.category_id,
                product_brand_id: req.query.product_brand_id,
                with_match: req.query.with_match,
                page: req.query.page,
                limit: req.query.limit,
            }),
            catalogService.getUnlinkedProductCounts(),
        ]);
        res.json({ ...list, counts });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    The entry form prefilled from a product, for review before publishing.
 * @route   GET /api/admin/catalog/unlinked-products/:productId/draft
 */
router.get('/unlinked-products/:productId([0-9a-fA-F]{24})/draft', protect('admin'), async (req, res) => {
    try {
        res.json(await catalogService.buildEntryDraftFromProduct(req.params.productId));
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
});

/**
 * @desc    Publish the product as a new approved template and link it.
 * @route   POST /api/admin/catalog/unlinked-products/:productId/publish
 */
router.post('/unlinked-products/:productId([0-9a-fA-F]{24})/publish', protect('admin'), async (req, res) => {
    try {
        const { entry, filled, product_status } = await catalogService.publishProductAsEntry(
            req.params.productId, req.body || {},
        );
        res.status(201).json({
            message: 'Template published and product linked',
            entry, filled, product_status,
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Link the product to an entry the catalog already has.
 * @route   POST /api/admin/catalog/unlinked-products/:productId/link
 */
router.post('/unlinked-products/:productId([0-9a-fA-F]{24})/link', protect('admin'), async (req, res) => {
    try {
        const result = await catalogService.linkUnlinkedProduct(
            req.params.productId, req.body?.catalog_entry_id,
        );
        res.json({ message: 'Product linked', ...result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Take a product off the unlinked worklist for good.
 * @route   POST /api/admin/catalog/unlinked-products/:productId/dismiss
 */
router.post('/unlinked-products/:productId([0-9a-fA-F]{24})/dismiss', protect('admin'), async (req, res) => {
    try {
        const result = await catalogService.dismissUnlinkedProduct(req.params.productId);
        res.json({ message: 'Product dismissed', ...result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

module.exports = router;
