const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');
const { 
    getVendorProfile, 
    updateVendorProfile,
    getVendorProducts, 
    getVendorProductById,
    addProduct, 
    updateProduct, 
    deleteProduct,
    getVendorOrders,
    getVendorOrderCounts,
    getVendorDashboardStats,
    updateVendorOrderStatus
} = require('../services/vendorService');
const { processBulkUpload, processBulkJsonUpload, previewBulkUpload } = require('../services/bulkUploadService');
const catalogService = require('../services/catalogService');
const {
    getVendorBundles,
    getVendorBundleById,
    getEligibleProducts,
    addBundle,
    updateBundle,
    deleteBundle,
} = require('../services/bundleService');

// Multer: in-memory storage, 5MB limit, xlsx only
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.xlsx') {
            return cb(new Error('Only .xlsx files are accepted.'));
        }
        cb(null, true);
    },
});

/**
 * @desc    Get vendor profile
 * @route   GET /api/vendors/profile
 */
router.get('/profile', protect('vendor'), async (req, res) => {
    try {
        const profile = await getVendorProfile(req.user._id);
        res.json(profile);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Update vendor profile
 * @route   PUT /api/vendors/profile
 */
router.put('/profile', protect('vendor'), async (req, res) => {
    try {
        const profile = await updateVendorProfile(req.user._id, req.body);
        res.json({ message: 'Profile updated successfully', profile });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Get vendor's products
 * @route   GET /api/vendors/products
 */
router.get('/products', protect('vendor'), async (req, res) => {
    try {
        const products = await getVendorProducts(req.user._id);
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Get one vendor product, including drafts
 * @route   GET /api/vendors/products/:id
 */
router.get('/products/:id([0-9a-fA-F]{24})', protect('vendor'), async (req, res) => {
    try {
        const product = await getVendorProductById(req.user._id, req.params.id);
        if (!product) return res.status(404).json({ message: 'Product not found' });
        res.json({ product });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Add a product
 * @route   POST /api/vendors/products
 */
router.post('/products', protect('vendor'), async (req, res) => {
    try {
        const product = await addProduct(req.user._id, req.body);
        res.status(201).json({ message: 'Product added successfully', product });
    } catch (error) {
        // The one catalog rule a vendor can hit: a second product on an entry
        // they already sell. The existing product's id rides along so the UI can
        // send them straight to it.
        if (error.code === 'DUPLICATE_CATALOG_PRODUCT') {
            return res.status(409).json({ message: error.message, code: error.code, productId: error.productId });
        }
        res.status(400).json({ message: error.message });
    }
});

/* ------------------------- Master catalog (vendor) -------------------------
   The search gate every add path opens with. Vendors read the catalog and
   nothing more: they cannot create, edit or delete an entry, and the link their
   product ends up carrying is never shown to them. */

/**
 * @desc    Search the catalog (approved + suggested entries)
 * @route   GET /api/vendors/catalog/search
 */
router.get('/catalog/search', protect('vendor'), async (req, res) => {
    try {
        const result = await catalogService.searchCatalogForVendor(req.user._id, {
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
 * @desc    The categories and brands the catalog actually holds, for the search filters
 * @route   GET /api/vendors/catalog/filters
 *
 * Declared BEFORE the /:id route below: `filters` would otherwise be read as an id and
 * fall through to a 404. The id route is digit-constrained, so this is belt and braces,
 * but the order is the thing that makes it safe rather than the pattern.
 */
router.get('/catalog/filters', protect('vendor'), async (req, res) => {
    try {
        // Each list narrows to the other selection, so a vendor who picks a category is
        // offered only the brands that work in it, and the other way round.
        res.json(await catalogService.getCatalogFacets({
            category_id: req.query.category_id,
            product_brand_id: req.query.product_brand_id,
        }));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    One entry, with the product fields it pre-fills
 * @route   GET /api/vendors/catalog/:id
 */
router.get('/catalog/:id([0-9a-fA-F]{24})', protect('vendor'), async (req, res) => {
    try {
        const entry = await catalogService.getSelectableEntry(req.params.id);
        if (!entry) return res.status(404).json({ message: 'Catalog entry not found' });

        const existingProductId = await catalogService.findVendorProductOnEntry(req.user._id, entry._id);
        res.json({
            entry,
            prefill: catalogService.buildPrefillFromEntry(entry),
            vendor_product_id: existingProductId,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Update a product
 * @route   PUT /api/vendors/products/:id
 */
router.put('/products/:id', protect('vendor'), async (req, res) => {
    try {
        const product = await updateProduct(req.user._id, req.params.id, req.body);
        res.json({ message: 'Product updated successfully', product });
    } catch (error) {
        console.error('Update Product Error:', error);
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Delete a product
 * @route   DELETE /api/vendors/products/:id
 */
router.delete('/products/:id', protect('vendor'), async (req, res) => {
    try {
        const product = await deleteProduct(req.user._id, req.params.id);
        res.json({ message: 'Product deleted successfully', product });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/* ------------------------------ Bundles ------------------------------ */

/**
 * @desc    Vendor's own published products (for the bundle builder picker)
 * @route   GET /api/vendors/bundles/eligible-products
 */
router.get('/bundles/eligible-products', protect('vendor'), async (req, res) => {
    try {
        const products = await getEligibleProducts(req.user._id);
        res.json({ products });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    List the vendor's bundles
 * @route   GET /api/vendors/bundles
 */
router.get('/bundles', protect('vendor'), async (req, res) => {
    try {
        const bundles = await getVendorBundles(req.user._id);
        res.json({ bundles });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Get one bundle (including drafts)
 * @route   GET /api/vendors/bundles/:id
 */
router.get('/bundles/:id([0-9a-fA-F]{24})', protect('vendor'), async (req, res) => {
    try {
        const bundle = await getVendorBundleById(req.user._id, req.params.id);
        if (!bundle) return res.status(404).json({ message: 'Bundle not found' });
        res.json({ bundle });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Create a bundle
 * @route   POST /api/vendors/bundles
 */
router.post('/bundles', protect('vendor'), async (req, res) => {
    try {
        const bundle = await addBundle(req.user._id, req.body);
        res.status(201).json({ message: 'Bundle created successfully', bundle });
    } catch (error) {
        res.status(400).json({ message: error.message, code: error.code });
    }
});

/**
 * @desc    Update a bundle
 * @route   PUT /api/vendors/bundles/:id
 */
router.put('/bundles/:id', protect('vendor'), async (req, res) => {
    try {
        const bundle = await updateBundle(req.user._id, req.params.id, req.body);
        res.json({ message: 'Bundle updated successfully', bundle });
    } catch (error) {
        res.status(400).json({ message: error.message, code: error.code });
    }
});

/**
 * @desc    Delete a bundle
 * @route   DELETE /api/vendors/bundles/:id
 */
router.delete('/bundles/:id', protect('vendor'), async (req, res) => {
    try {
        const bundle = await deleteBundle(req.user._id, req.params.id);
        res.json({ message: 'Bundle deleted successfully', bundle });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Bulk upload products via Excel
 * @route   POST /api/vendors/products/bulk-upload
 */
router.post('/products/bulk-upload', protect('vendor'), (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ message: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded. Please attach an .xlsx file with field name "file".' });
        }
        const result = await processBulkUpload(req.file.buffer, req.user._id);
        res.status(200).json(result);
    } catch (error) {
        console.error('Bulk Upload Error:', error);
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Parse an Excel file and propose a catalog entry per row — saves nothing.
 *          Feeds the "Review links" screen that sits between upload and save.
 * @route   POST /api/vendors/products/bulk-upload/preview
 */
router.post('/products/bulk-upload/preview', protect('vendor'), (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ message: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded. Please attach an .xlsx file with field name "file".' });
        }
        const result = await previewBulkUpload(req.file.buffer, req.user._id);
        res.status(200).json(result);
    } catch (error) {
        console.error('Bulk Upload Preview Error:', error);
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Save the rows a vendor confirmed on the "Review links" screen.
 *          Same processing as the grid, with the row cap raised: an Excel file
 *          has no advertised product-count limit, the grid caps itself at 200.
 * @route   POST /api/vendors/products/bulk-upload/save
 */
router.post('/products/bulk-upload/save', protect('vendor'), async (req, res) => {
    try {
        const { products } = req.body;
        const result = await processBulkJsonUpload(products, req.user._id, { maxProducts: 2000 });
        res.status(200).json(result);
    } catch (error) {
        console.error('Reviewed Bulk Upload Error:', error);
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Bulk create products from the online entry grid (JSON)
 * @route   POST /api/vendors/products/bulk-json
 */
router.post('/products/bulk-json', protect('vendor'), async (req, res) => {
    try {
        const { products } = req.body;
        const result = await processBulkJsonUpload(products, req.user._id);
        res.status(200).json(result);
    } catch (error) {
        console.error('Bulk JSON Upload Error:', error);
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Download the bulk upload Excel template
 * @route   GET /api/vendors/products/bulk-template
 */
router.get('/products/bulk-template', protect('vendor'), async (req, res) => {
    try {
        const { generateBulkUploadTemplate } = require('../services/bulkUploadService');
        const lang = req.query.lang === 'ar' ? 'ar' : 'en';
        const buffer = await generateBulkUploadTemplate(lang);

        const filename = lang === 'ar' ? 'product_bulk_upload_template_ar.xlsx' : 'product_bulk_upload_template.xlsx';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        console.error('Template Generation Error:', error);
        res.status(500).json({ message: 'Failed to generate template' });
    }
});

/**
 * @desc    Get vendor's Bosta pickups
 * @route   GET /api/vendors/pickups?date=YYYY-MM-DD
 */
router.get('/pickups', protect('vendor'), async (req, res) => {
    try {
        const { BostaPickup } = require('../models/bostaPickups');
        const filter = { vendor_id: req.user._id };
        if (req.query.date) filter.scheduled_date = req.query.date;
        const pickups = await BostaPickup.find(filter).sort({ scheduled_date: -1 }).lean();
        res.json({ success: true, pickups });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Get vendor orders
 * @route   GET /api/vendors/orders
 */
router.get('/orders', protect('vendor'), async (req, res) => {
    try {
        const isRevised = req.query.revised === 'true';
        const orders = await getVendorOrders(req.user._id, isRevised);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    The vendor's dashboard summary — sales, orders, returns, reviews,
 *          products and earnings over a chosen window. Also the source of the
 *          dashboard's PDF report, which is why one call returns all of it.
 * @route   GET /api/vendors/stats?range=7d|30d|90d|12m|all
 */
router.get('/stats', protect('vendor'), async (req, res) => {
    try {
        // An unknown range falls back to the default rather than 400ing: this
        // is a read-only summary, and a stale bookmark should still render.
        const stats = await getVendorDashboardStats(req.user._id, { range: req.query.range });
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    The vendor's sales report: one row per parcel — order value, commission, net,
 *          the order's date and status — with totals (services/vendorSalesReportService.js)
 * @route   GET /api/vendors/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&status=all|in_progress|delivered|returned|cancelled
 */
router.get('/reports/sales', protect('vendor'), async (req, res) => {
    try {
        const { buildSalesReport } = require('../services/vendorSalesReportService');
        res.json({ success: true, ...(await buildSalesReport(req.user._id, req.query)) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    The same report as an Excel file
 * @route   GET /api/vendors/reports/sales/export (same query)
 */
router.get('/reports/sales/export', protect('vendor'), async (req, res) => {
    try {
        const { buildSalesReportWorkbook } = require('../services/vendorSalesReportService');
        const { workbook, filename } = await buildSalesReportWorkbook(req.user._id, req.query);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Get vendor order counts
 * @route   GET /api/vendors/orders/counts
 */
router.get('/orders/counts', protect('vendor'), async (req, res) => {
    try {
        const counts = await getVendorOrderCounts(req.user._id);
        res.json({ success: true, counts });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Update vendor order items status
 * @route   PUT /api/vendors/orders/:id
 */
router.put('/orders/:id', protect('vendor'), async (req, res) => {
    try {
        const { items, fulfillment_location } = req.body;
        const order = await updateVendorOrderStatus(req.user._id, req.params.id, items, fulfillment_location);
        res.json({ message: 'Order supervision updated', order });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/* ================================================================== */
/*  SUB-ORDERS — the vendor's own parcels                             */
/* ================================================================== */

const subOrderFlow = require('../services/subOrderFlowService');
const {
    getVendorSubOrders,
    getVendorSubOrder,
} = require('../services/vendorService');

/** Turn a flow-service error into the status code it asked for. */
const flowError = (res, err) => {
    const status = err.status || 400;
    res.status(status).json({ success: false, code: err.code || 'SUB_ORDER_ERROR', message: err.message });
};

/**
 * @desc    This vendor's parcels, grouped by the stage each is waiting on
 * @route   GET /api/vendors/sub-orders?tab=needs_review
 */
router.get('/sub-orders', protect('vendor'), async (req, res) => {
    try {
        const result = await getVendorSubOrders(req.user._id, { tab: req.query.tab || null });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    One parcel in full — stepper state, items, tracking, photos, earnings
 * @route   GET /api/vendors/orders/:orderId/sub-orders/:subOrderId
 */
router.get('/orders/:orderId/sub-orders/:subOrderId', protect('vendor'), async (req, res) => {
    try {
        const sub = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({ success: true, sub_order: sub });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
});

/**
 * @desc    A combined company order: every person's order inside it, for packing and labels
 * @route   GET /api/vendors/company-batches/:batchId
 */
router.get('/company-batches/:batchId', protect('vendor'), async (req, res) => {
    try {
        const batch = await require('../services/companyBatchService').vendorBatchView(req.user._id, req.params.batchId);
        res.json({ success: true, batch });
    } catch (error) {
        flowError(res, error);
    }
});

/* ---- Stage 1: confirm products ---- */

/**
 * @desc    Mark one item available or not. Saves on press — there is no submit step.
 * @route   PUT /api/vendors/orders/:orderId/sub-orders/:subOrderId/items/:itemId
 */
router.put('/orders/:orderId/sub-orders/:subOrderId/items/:itemId', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        const { sub } = await subOrderFlow.reviewItem({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            itemId: req.params.itemId,
            available: req.body.available === true || req.body.available === 'true',
            reason: req.body.reason || '',
            actor,
            vendorId: req.user._id,
        });
        const view = await getVendorSubOrder(req.user._id, req.params.orderId, sub._id);
        res.json({ success: true, sub_order: view });
    } catch (error) {
        flowError(res, error);
    }
});

/**
 * @desc    Accept the whole parcel in one press. With `confirm` the same call also leaves
 *          stage 1, so the vendor who has everything in stock is one press from done
 *          instead of two.
 * @route   POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/approve-all
 */
router.post('/orders/:orderId/sub-orders/:subOrderId/approve-all', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        await subOrderFlow.approveAllItems({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            actor,
            vendorId: req.user._id,
        });

        const alsoConfirm = req.body?.confirm === true || req.body?.confirm === 'true';
        if (alsoConfirm) {
            await subOrderFlow.confirmItems({
                orderId: req.params.orderId,
                subOrderId: req.params.subOrderId,
                actor,
                vendorId: req.user._id,
            });
        }

        const view = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        // No message: the dashboard is bilingual and says this in the vendor's own language.
        res.json({ success: true, confirmed: alsoConfirm, sub_order: view });
    } catch (error) {
        flowError(res, error);
    }
});

/**
 * @desc    Refuse the whole parcel in one press, with one reason covering every line. Parks
 *          it with the website team exactly as an item-by-item refusal does.
 * @route   POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/decline-all
 */
router.post('/orders/:orderId/sub-orders/:subOrderId/decline-all', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        await subOrderFlow.declineAllItems({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            reason: req.body?.reason || '',
            actor,
            vendorId: req.user._id,
        });
        const view = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({ success: true, parked: true, sub_order: view });
    } catch (error) {
        flowError(res, error);
    }
});

/**
 * @desc    Leave stage 1. Everything available advances the parcel (and, with Smart Label
 *          off, creates its Bosta shipment so there is a waybill to print). Anything
 *          declined parks it for the website team instead.
 * @route   POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/confirm-items
 */
router.post('/orders/:orderId/sub-orders/:subOrderId/confirm-items', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        const { parked } = await subOrderFlow.confirmItems({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            actor,
            vendorId: req.user._id,
        });
        const view = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({
            success: true,
            parked,
            message: parked
                ? 'Thanks — the website team will contact the customer about the unavailable items.'
                : 'Products confirmed.',
            sub_order: view,
        });
    } catch (error) {
        flowError(res, error);
    }
});

/* ---- Stage 2: assign tracking number ---- */

/**
 * @desc    Scan a Smart Label, or acknowledge the waybill Bosta already minted
 * @route   POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/tracking
 */
router.post('/orders/:orderId/sub-orders/:subOrderId/tracking', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        await subOrderFlow.assignTracking({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            trackingNumber: req.body.tracking_number || null,
            actor,
            vendorId: req.user._id,
        });
        const view = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({ success: true, sub_order: view });
    } catch (error) {
        flowError(res, error);
    }
});

/**
 * @desc    No sticker to scan: create the shipment with a Bosta-minted number so the
 *          waybill can be printed instead. The alternative to scanning, not a replacement.
 * @route   POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/shipment
 */
router.post('/orders/:orderId/sub-orders/:subOrderId/shipment', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        await subOrderFlow.createPrintedShipment({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            actor,
            vendorId: req.user._id,
        });
        const view = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({ success: true, sub_order: view });
    } catch (error) {
        flowError(res, error);
    }
});

/**
 * @desc    The printable waybill for this parcel. Vendor-facing, because with Smart Label
 *          off the vendor is the one who prints and sticks it on.
 * @route   GET /api/vendors/orders/:orderId/sub-orders/:subOrderId/awb
 */
router.get('/orders/:orderId/sub-orders/:subOrderId/awb', protect('vendor'), async (req, res) => {
    try {
        const { Order } = require('../models/orders');
        const bostaService = require('../services/bostaService');

        const order = await Order.findById(req.params.orderId).lean();
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        const sub = (order.sub_orders || []).find((x) => x._id.toString() === req.params.subOrderId);
        if (!sub) return res.status(404).json({ success: false, message: 'Parcel not found' });
        if (sub.vendor_id?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'This parcel belongs to another vendor' });
        }

        const shipment = require('../services/subOrderService').liveShipmentFor(order, sub);
        if (!shipment || !(shipment.tracking_number || shipment.bosta_delivery_id)) {
            return res.status(400).json({ success: false, message: 'This parcel has no shipment yet' });
        }

        // Bosta answers with its PDF; an Arrive label is rendered by us as a printable page.
        const label = await require('../services/couriers/labels').labelForShipment(order, sub, shipment);
        res.setHeader('Content-Type', label.contentType);
        res.setHeader('Content-Disposition', `inline; filename="${label.filename}"`);
        res.send(label.body);
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

/* ---- Stage 3: ready for pickup ---- */

/**
 * @desc    Attach photos of the sealed parcel (1–5). Evidence the admin reviews before
 *          booking a courier, and the record if the customer later disputes what arrived.
 * @route   POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/photos
 */
router.post('/orders/:orderId/sub-orders/:subOrderId/photos', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        const { added, skipped } = await subOrderFlow.addParcelPhotos({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            urls: req.body.urls || req.body.url,
            actor,
            vendorId: req.user._id,
        });
        const view = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({ success: true, added, skipped, sub_order: view });
    } catch (error) {
        flowError(res, error);
    }
});

/**
 * @desc    Remove a parcel photo (only while no courier is booked)
 * @route   DELETE /api/vendors/orders/:orderId/sub-orders/:subOrderId/photos/:photoId
 */
router.delete('/orders/:orderId/sub-orders/:subOrderId/photos/:photoId', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        await subOrderFlow.removeParcelPhoto({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            photoId: req.params.photoId,
            actor,
            vendorId: req.user._id,
        });
        const view = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({ success: true, sub_order: view });
    } catch (error) {
        flowError(res, error);
    }
});

/**
 * @desc    Finish stage 3 — the vendor says the parcel is sealed and waiting for a courier.
 *          Photos are welcome but not required.
 * @route   POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/ready
 */
router.post('/orders/:orderId/sub-orders/:subOrderId/ready', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        await subOrderFlow.markReadyForPickup({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            actor,
            vendorId: req.user._id,
        });
        const view = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({ success: true, sub_order: view });
    } catch (error) {
        flowError(res, error);
    }
});

/**
 * @desc    Stage 4 — the vendor confirms a Bosta courier actually took the parcel. Until this
 *          (or Bosta's own webhook) says so, no screen may claim the parcel has left the store.
 * @route   POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/handover
 */
router.post('/orders/:orderId/sub-orders/:subOrderId/handover', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        await subOrderFlow.confirmHandover({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            actor,
            vendorId: req.user._id,
        });
        const view = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({ success: true, sub_order: view });
    } catch (error) {
        flowError(res, error);
    }
});

/**
 * @desc    Ask the website team to cancel this parcel. A request, never an action — and only
 *          while no courier has been booked for it.
 * @route   POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/cancel-request
 */
router.post('/orders/:orderId/sub-orders/:subOrderId/cancel-request', protect('vendor'), async (req, res) => {
    try {
        const actor = await subOrderFlow.vendorActor(req.user._id);
        await subOrderFlow.requestCancellation({
            orderId: req.params.orderId,
            subOrderId: req.params.subOrderId,
            reason: req.body.reason,
            actor,
            vendorId: req.user._id,
        });
        const view = await getVendorSubOrder(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({ success: true, sub_order: view });
    } catch (error) {
        flowError(res, error);
    }
});

/* ================================================================== */
/*  SMART LABEL                                                       */
/* ================================================================== */

const smartLabelService = require('../services/smartLabelService');

/**
 * @desc    Scan a pre-printed Bosta label onto this vendor's shipment
 * @route   POST /api/vendors/orders/:id/smart-label
 */
router.post('/orders/:id/smart-label', protect('vendor'), async (req, res) => {
    try {
        const label = await smartLabelService.scanLabel({
            orderId: req.params.id,
            // Always the caller's own vendor id — a vendor cannot label another vendor's
            // parcel in a shared order, whatever the body says.
            vendorId: req.user._id,
            trackingNumber: req.body.tracking_number,
            actor: { role: 'vendor', id: req.user._id },
        });
        res.json({ success: true, smart_label: label });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Release this vendor's scanned label so it can be used on another parcel
 * @route   DELETE /api/vendors/orders/:id/smart-label
 */
router.delete('/orders/:id/smart-label', protect('vendor'), async (req, res) => {
    try {
        const result = await smartLabelService.unlinkLabel({
            orderId: req.params.id,
            vendorId: req.user._id,
            actor: { role: 'vendor', id: req.user._id },
        });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

/* ================================================================== */
/*  RETURNS                                                           */
/* ================================================================== */

const {
    getReturnRequestsForVendor,
    getReturnCounts: getReturnCountsService,
    getReturnRequestById: getReturnById,
    vendorReviewReturn,
    confirmReturnReceived,
} = require('../services/returnService');

/**
 * @desc    List return requests for this vendor
 * @route   GET /api/vendors/returns
 */
router.get('/returns', protect('vendor'), async (req, res) => {
    try {
        const { page, limit, status } = req.query;
        const result = await getReturnRequestsForVendor(req.user._id, { page, limit, status });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Get return counts by status
 * @route   GET /api/vendors/returns/counts
 */
router.get('/returns/counts', protect('vendor'), async (req, res) => {
    try {
        const counts = await getReturnCountsService({ vendor_id: req.user._id });
        res.json({ success: true, counts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Get single return request
 * @route   GET /api/vendors/returns/:id
 */
router.get('/returns/:id', protect('vendor'), async (req, res) => {
    try {
        const ret = await getReturnById(req.params.id);
        if (!ret || ret.vendor_id._id.toString() !== req.user._id.toString()) {
            return res.status(404).json({ success: false, message: 'Return request not found' });
        }
        res.json({ success: true, return_request: ret });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Vendor approve/reject return
 * @route   PUT /api/vendors/returns/:id/review
 */
router.put('/returns/:id/review', protect('vendor'), async (req, res) => {
    try {
        const { decision, notes } = req.body;
        const ret = await vendorReviewReturn(req.params.id, req.user._id, { decision, notes });
        res.json({ success: true, return_request: ret });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'VENDOR_MISMATCH' ? 403
            : error.code === 'INVALID_RETURN_STATUS' ? 400
            : error.code === 'INVALID_INPUT' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Vendor confirms returned goods received
 * @route   POST /api/vendors/returns/:id/confirm-receipt
 */
router.post('/returns/:id/confirm-receipt', protect('vendor'), async (req, res) => {
    try {
        const ret = await getReturnById(req.params.id);
        if (!ret || ret.vendor_id._id.toString() !== req.user._id.toString()) {
            return res.status(404).json({ success: false, message: 'Return request not found' });
        }
        const updated = await confirmReturnReceived(req.params.id, { role: 'vendor', label: 'Vendor' });
        res.json({ success: true, return_request: updated });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_RETURN_STATUS' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/* ------------------------------------------------------------------ */
/*  Earnings Wallet & Withdrawals                                     */
/* ------------------------------------------------------------------ */
const { Seller } = require('../models/sellers');
const { getWalletSummary, getEarningsHistory } = require('../services/vendorEarningsService');
const {
    createWithdrawal,
    cancelWithdrawal,
    listVendorWithdrawals,
} = require('../services/withdrawalService');
const vendorPayouts = require('../services/vendorPayoutService');
const payoutMethods = require('../services/payouts/payoutMethods');

const payoutErrorStatus = (error) => ({
    NOT_FOUND: 404,
    INVALID_INPUT: 400,
    INVALID_AMOUNT: 400,
    BELOW_MINIMUM: 400,
    WRONG_PASSWORD: 401,
    INVALID_STATUS: 409,
    WITHDRAWAL_EXISTS: 409,
    PAYOUTS_ON_HOLD: 409,
    NO_PAYOUT_METHOD: 409,
    NOTHING_PAYABLE: 409,
    NOTHING_TO_TRANSFER: 409,
    BUSY: 409,
}[error.code] || 500);

/**
 * @desc    Get vendor wallet summary (balances + counts)
 * @route   GET /api/vendors/wallet
 */
router.get('/wallet', protect('vendor'), async (req, res) => {
    try {
        const summary = await getWalletSummary(req.user._id);
        // What a request made now would pay: every settled order, less what the wallet
        // already owes. Shown on the button so the vendor knows before asking.
        const preview = await vendorPayouts.previewPayout(req.user._id).catch(() => null);
        const { getScheduleForVendor, effectiveHoldDays } = require('../services/payoutScheduleService');
        const settlementDays = effectiveHoldDays(await getScheduleForVendor(req.user._id));
        res.json({
            success: true,
            ...summary,
            settlement_days: settlementDays,
            withdrawable: preview
                ? {
                    orders: preview.earning_count,
                    gross: preview.gross,
                    deductions: preview.deductions,
                    amount: preview.amount,
                }
                : null,
            payout_method: preview?.payout_method || null,
            payout_method_complete: !!preview?.payout_method_complete,
            payout_hold: preview?.payout_hold ? { reason: preview.payout_hold.reason, at: preview.payout_hold.at } : null,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Get vendor earnings ledger (paginated, filter by status)
 * @route   GET /api/vendors/wallet/earnings
 */
router.get('/wallet/earnings', protect('vendor'), async (req, res) => {
    try {
        const { status, page, limit } = req.query;
        const result = await getEarningsHistory(req.user._id, { status, page, limit });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Create a withdrawal request
 * @route   POST /api/vendors/wallet/withdrawals
 */
router.post('/wallet/withdrawals', protect('vendor'), async (req, res) => {
    try {
        // Always for every settled order (see withdrawalService.createWithdrawal); a posted
        // `amount` from an older screen is ignored rather than trusted.
        const { channel, notes } = req.body;
        const withdrawal = await createWithdrawal(req.user._id, { channel, notes });
        res.status(201).json({ success: true, withdrawal });
    } catch (error) {
        res.status(payoutErrorStatus(error)).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    List vendor's own withdrawal requests
 * @route   GET /api/vendors/wallet/withdrawals
 */
router.get('/wallet/withdrawals', protect('vendor'), async (req, res) => {
    try {
        const { status, page, limit } = req.query;
        const result = await listVendorWithdrawals(req.user._id, { status, page, limit });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Where payouts are sent, plus the choices (issuers, bank lists) for the form
 * @route   GET /api/vendors/wallet/payout-method
 */
router.get('/wallet/payout-method', protect('vendor'), async (req, res) => {
    try {
        const current = await vendorPayouts.getPayoutMethod(req.user._id);
        res.json({
            success: true,
            ...current,
            options: {
                issuers: payoutMethods.ISSUERS.map((id) => ({ id, label: payoutMethods.ISSUER_LABELS[id] })),
                wallet_issuers: payoutMethods.WALLET_ISSUERS,
                bank_codes: {
                    bank_card: payoutMethods.BANK_CARD_CODES,
                    instant_bank: payoutMethods.INSTANT_BANK_CODES,
                },
                min_amount: payoutMethods.MIN_AMOUNT,
            },
        });
    } catch (error) {
        res.status(payoutErrorStatus(error)).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Save where payouts are sent. Needs the account password.
 * @route   PUT /api/vendors/wallet/payout-method   { type, issuer, msisdn | bank_card_number+bank_code+full_name, password }
 */
router.put('/wallet/payout-method', protect('vendor'), async (req, res) => {
    try {
        const { password, ...method } = req.body || {};
        const saved = await vendorPayouts.setPayoutMethod(req.user._id, method, password);
        res.json({ success: true, ...saved });
    } catch (error) {
        res.status(payoutErrorStatus(error)).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    One payout of this vendor's, as an invoice
 * @route   GET /api/vendors/wallet/payouts/:id
 */
router.get('/wallet/payouts/:id', protect('vendor'), async (req, res) => {
    try {
        const invoice = await vendorPayouts.getPayoutInvoice(req.params.id, { vendorId: req.user._id });
        res.json({ success: true, ...invoice });
    } catch (error) {
        res.status(payoutErrorStatus(error)).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Cancel a pending withdrawal request
 * @route   POST /api/vendors/wallet/withdrawals/:id/cancel
 */
router.post('/wallet/withdrawals/:id/cancel', protect('vendor'), async (req, res) => {
    try {
        const withdrawal = await cancelWithdrawal(req.user._id, req.params.id);
        res.json({ success: true, withdrawal });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_STATUS' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/* ------------------------------------------------------------------ */
/*  Ad Requests (banner / product visibility / featured vendor)       */
/* ------------------------------------------------------------------ */
const { createAdRequest, cancelAdRequest, listVendorAds } = require('../services/adService');

/**
 * @desc    Create an ad request (any type)
 * @route   POST /api/vendors/ads
 */
router.post('/ads', protect('vendor'), async (req, res) => {
    try {
        const { type, subject_type, product_id, banner_image, link_url, placements, vendor_placements, vendor_note } = req.body;
        const ad = await createAdRequest(req.user._id, {
            type, subject_type, product_id, banner_image, link_url, placements, vendor_placements, vendor_note,
        });
        res.status(201).json({ success: true, ad });
    } catch (error) {
        const status = error.code === 'INVALID_INPUT' ? 400
            : error.code === 'NOT_FOUND' ? 404
            : error.code === 'SUBSCRIPTION_REQUIRED' ? 403
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    List vendor's own ad requests
 * @route   GET /api/vendors/ads
 */
router.get('/ads', protect('vendor'), async (req, res) => {
    try {
        const { status, page, limit } = req.query;
        const result = await listVendorAds(req.user._id, { status, page, limit });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    What one of the vendor's own ads did: impressions, clicks, actions.
 * @route   GET /api/vendors/ads/:id/analytics?from&to
 */
router.get('/ads/:id/analytics', protect('vendor'), async (req, res) => {
    try {
        const { AdRequest } = require('../models/ads');
        const { getAdAnalytics } = require('../services/adAnalyticsService');
        const owned = await AdRequest.exists({ _id: req.params.id, vendor_id: req.user._id });
        if (!owned) return res.status(404).json({ success: false, message: 'Ad request not found' });
        const report = await getAdAnalytics(req.params.id, { from: req.query.from, to: req.query.to });
        res.json({ success: true, ...report });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Cancel a pending ad request
 * @route   POST /api/vendors/ads/:id/cancel
 */
router.post('/ads/:id/cancel', protect('vendor'), async (req, res) => {
    try {
        const ad = await cancelAdRequest(req.user._id, req.params.id);
        res.json({ success: true, ad });
    } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'INVALID_STATUS' ? 400
            : 500;
        res.status(status).json({ success: false, message: error.message, code: error.code });
    }
});

/**
 * @desc    Public: Get vendors for vendor directory or homepage slider
 * @route   GET /api/vendors/public?placement=page|home
 * @access  Public — no auth required
 */
router.get('/public', async (req, res) => {
    try {
        const { Product } = require('../models/products');
        const placement = req.query.placement === 'home' ? 'home' : 'page';
        const isHome = placement === 'home';
        const visibilityField = isHome ? 'public_show_on_home' : 'public_show_on_vendors_page';
        // The public directory should follow the same manual ordering as the
        // homepage slider, while keeping its own visibility toggle.
        const orderField = 'public_home_order';
        const limit = Math.min(Math.max(Number(req.query.limit) || (isHome ? 12 : 100), 1), 100);

        const selectFields = 'store_name store_username store_slug store_image locations created_at completed_orders_count rating reviews_count public_show_on_vendors_page public_vendors_page_order public_show_on_home public_home_order';
        const visibilityMatch = isHome ? true : { $ne: false };
        const getHomeOrder = (vendor) => {
            const order = Number(vendor.public_home_order);
            return Number.isFinite(order) ? order : 0;
        };
        const sortByHomeOrder = (a, b) => {
            const orderDiff = getHomeOrder(a) - getHomeOrder(b);
            if (orderDiff !== 0) return orderDiff;
            return String(a.store_name || '').localeCompare(String(b.store_name || ''));
        };
        const sortForPlacement = isHome
            ? sortByHomeOrder
            : (a, b) => {
                const homeVisibilityDiff = Number(b.public_show_on_home === true) - Number(a.public_show_on_home === true);
                if (homeVisibilityDiff !== 0) return homeVisibilityDiff;
                return sortByHomeOrder(a, b);
            };
        const organic = await Seller.find({
            status: 'active',
            subscription_status: { $in: ['active', 'trial_active'] },
            [visibilityField]: visibilityMatch,
        })
            .select(selectFields)
            .sort(isHome
                ? { [orderField]: 1, store_name: 1 }
                : { public_show_on_home: -1, [orderField]: 1, store_name: 1 })
            .limit(limit)
            .lean();

        // Merge in vendors with a live featured-vendor ad for this placement.
        // They remain flagged, then the final list is sorted by the homepage order.
        const { getActiveFeaturedVendorAds } = require('../services/adService');
        const adPlacement = placement === 'home' ? 'home' : 'vendors_page';
        const featuredAds = await getActiveFeaturedVendorAds(adPlacement);
        let featured = [];
        if (featuredAds.length) {
            const docs = await Seller.find({
                _id: { $in: featuredAds.map(a => a.vendor_id) },
                status: 'active',
                subscription_status: { $in: ['active', 'trial_active'] },
            }).select(selectFields).lean();
            const docMap = new Map(docs.map(v => [String(v._id), v]));
            // The ad travels with the vendor so the card can report the ad's impressions and clicks.
            featured = featuredAds
                .map(a => { const v = docMap.get(String(a.vendor_id)); return v ? { ...v, sponsored: true, ad_id: String(a.ad_id), ad_placement: adPlacement } : null; })
                .filter(Boolean);
        }

        const featuredSet = new Set(featured.map(v => String(v._id)));
        const vendors = [...featured, ...organic.filter(v => !featuredSet.has(String(v._id)))]
            .sort(sortForPlacement)
            .slice(0, limit);

        const productCounts = await Product.aggregate([
            {
                $match: {
                    vendor_id: { $in: vendors.map(vendor => vendor._id) },
                    status: 'published',
                },
            },
            { $group: { _id: '$vendor_id', product_count: { $sum: 1 } } },
        ]);
        const countMap = new Map(productCounts.map(item => [String(item._id), item.product_count]));

        res.json({
            success: true,
            vendors: vendors.map(vendor => ({
                ...vendor,
                product_count: countMap.get(String(vendor._id)) || 0,
                // Cached on the seller and refreshed whenever a parcel is delivered or
                // returned — see services/vendorStatsService.js. Defaulted here so a
                // vendor created before the field existed reads as 0 rather than
                // undefined, which the storefront would render as a blank badge.
                completed_orders_count: vendor.completed_orders_count || 0,
                rating: vendor.rating || 0,
                reviews_count: vendor.reviews_count || 0,
            })),
        });
    } catch (error) {
        console.error('Public vendors list error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Public: Get vendor store info + products (filtered + paginated)
 * @route   GET /api/vendors/public/:username
 * @access  Public — no auth required
 */
router.get('/public/:username', async (req, res) => {
    try {
        const { Seller } = require('../models/sellers');
        const { getAllProducts, getFilterMetadata } = require('../services/productService');

        // A POSITIVE projection, not `-password`. Excluding one secret by name still ships
        // every other one: this route was returning the store's payout bank details and its
        // wallet balances to anyone who opened the shop page.
        // The clean slug first (/store/x-turbo-auto-parts), then the raw username, so every
        // link shared before slugs existed still opens the right store.
        const key = String(req.params.username || '').trim().toLowerCase();
        const vendor = await Seller.findOne({ $or: [{ store_slug: key }, { store_username: key }] }).select(
            'store_name store_username store_slug store_image locations created_at status subscription_status '
            + 'completed_orders_count rating reviews_count phone email'
        );

        if (!vendor) {
            return res.status(404).json({ message: 'Store not found' });
        }

        // Block access if vendor subscription is not active (expired or cancelled)
        if (!['active', 'trial_active'].includes(vendor.subscription_status)) {
            return res.status(404).json({ message: 'Store not found' });
        }

        // Pass all query params + force vendor_id scope
        const result = await getAllProducts({
            ...req.query,
            vendor_id: vendor._id.toString()
        });

        // The store's own rating feed, so the page renders its reputation without a
        // second round trip.
        const reviewService = require('../services/reviewService');
        const reviews = await reviewService.getVendorReviews(vendor._id, { limit: 10 })
            .catch(() => null);

        res.json({
            vendor,
            reviews,
            products: result.products,
            pagination: result.pagination
        });
    } catch (error) {
        console.error('Public vendor route error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
