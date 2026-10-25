const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  createReturnRequest,
  getReturnRequestsForUser,
  getReturnRequestById,
  cancelReturnRequest,
} = require("../services/returnService");

/**
 * @desc    Create a return request
 * @route   POST /api/returns
 * @access  User
 */
router.post("/", protect("user"), async (req, res) => {
  try {
    const { order_id, items, reason, reason_details, evidence, fault_type } = req.body;
    const ret = await createReturnRequest({
      userId: req.user._id,
      orderId: order_id,
      items,
      reason,
      reason_details,
      evidence,
      fault_type,
    });
    res.status(201).json({ success: true, return_request: ret });
  } catch (error) {
    const status = error.code === "ORDER_NOT_FOUND" ? 404
      : error.code === "RETURN_WINDOW_EXPIRED" ? 400
      : error.code === "ITEM_ALREADY_RETURNED" ? 409
      : error.code === "ORDER_NOT_ELIGIBLE" ? 400
      : error.code === "EVIDENCE_REQUIRED" ? 400
      : error.code === "MULTI_VENDOR_RETURN" ? 400
      : error.code === "INVALID_ITEMS" ? 400
      : 500;
    res.status(status).json({ success: false, message: error.message, code: error.code });
  }
});

/**
 * @desc    List user's return requests
 * @route   GET /api/returns
 * @access  User
 */
router.get("/", protect("user"), async (req, res) => {
  try {
    const { page, limit, status } = req.query;
    const result = await getReturnRequestsForUser(req.user._id, { page, limit, status });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @desc    Get single return request
 * @route   GET /api/returns/:id
 * @access  User
 */
router.get("/:id", protect("user"), async (req, res) => {
  try {
    const ret = await getReturnRequestById(req.params.id);
    if (!ret || ret.user_id._id.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: "Return request not found" });
    }
    res.json({ success: true, return_request: ret });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @desc    Cancel return request
 * @route   POST /api/returns/:id/cancel
 * @access  User
 */
router.post("/:id/cancel", protect("user"), async (req, res) => {
  try {
    const ret = await cancelReturnRequest(req.params.id, req.user._id);
    res.json({ success: true, return_request: ret });
  } catch (error) {
    const status = error.code === "NOT_FOUND" ? 404
      : error.code === "INVALID_RETURN_STATUS" ? 400
      : 500;
    res.status(status).json({ success: false, message: error.message, code: error.code });
  }
});

/**
 * @desc    Get return shipment tracking
 * @route   GET /api/returns/:id/tracking
 * @access  User
 */
router.get("/:id/tracking", protect("user"), async (req, res) => {
  try {
    const ret = await getReturnRequestById(req.params.id);
    if (!ret || ret.user_id._id.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: "Return request not found" });
    }
    res.json({
      success: true,
      return_number: ret.return_number,
      status: ret.status,
      return_shipment: ret.return_shipment || null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
