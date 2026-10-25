const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Ticket } = require('../models/tickets');
const { protect } = require('../middleware/authMiddleware');
const { emitToTicket } = require('../services/socket');

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

/* ------------------ Helpers ------------------ */
const paginate = (query, page = 1, limit = 20) => {
    const skip = (Math.max(1, Number(page)) - 1) * limit;
    return query.skip(skip).limit(limit);
};

/* ------------------ Create Ticket ------------------ */
/**
 * @desc    Create a new support ticket
 * @route   POST /api/tickets
 * @access  Private (vendor | user)
 */
router.post('/', protect('vendor', 'user'), async (req, res) => {
    try {
        const { title, description, category, priority, order_id } = req.body;

        if (!title?.trim()) {
            return res.status(400).json({ success: false, message: 'Title is required' });
        }
        if (!description?.trim()) {
            return res.status(400).json({ success: false, message: 'Description is required' });
        }

        // A ticket may point at one order — but only one the author is actually party to:
        // the customer who placed it, or a vendor with a parcel in it.
        let linkedOrder = null;
        if (order_id) {
            if (!mongoose.Types.ObjectId.isValid(String(order_id))) {
                return res.status(400).json({ success: false, message: 'Invalid order' });
            }
            const { Order } = require('../models/orders');
            const ownerFilter = req.userRole === 'vendor'
                ? { $or: [{ 'sub_orders.vendor_id': req.user._id }, { 'vendor_supervisions.vendor_id': req.user._id }, { 'items.vendor_id': req.user._id }] }
                : { user_id: req.user._id };
            linkedOrder = await Order.findOne({ _id: order_id, ...ownerFilter }).select('_id transaction.reference').lean();
            if (!linkedOrder) {
                return res.status(404).json({ success: false, message: 'Order not found' });
            }
        }

        const ticket = await Ticket.create({
            title: title.trim(),
            description: description.trim(),
            category: linkedOrder ? 'order' : (category || 'other'),
            priority: priority || 'medium',
            order_id: linkedOrder?._id || null,
            order_reference: linkedOrder ? (linkedOrder.transaction?.reference || String(linkedOrder._id).slice(-8).toUpperCase()) : null,
            authorId: req.user._id,
            authorRole: req.userRole,
            authorName: req.user.name || req.user.store_name || req.user.email || 'Unknown',
            messages: [],
            status: 'open',
        });

        res.status(201).json({ success: true, ticket });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------ List Own Tickets ------------------ */
/**
 * @desc    List tickets for the authenticated vendor or user
 * @route   GET /api/tickets
 * @access  Private (vendor | user)
 */
router.get('/', protect('vendor', 'user'), async (req, res) => {
    try {
        const { status, priority, page = 1, limit = 20 } = req.query;

        const filter = {
            authorId: req.user._id,
            authorRole: req.userRole,
        };

        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        const total = await Ticket.countDocuments(filter);
        const tickets = await paginate(
            Ticket.find(filter)
                .select('title status priority category createdAt updatedAt messages')
                .sort({ createdAt: -1 }),
            page,
            limit
        ).lean();

        res.json({
            success: true,
            tickets,
            pagination: {
                total,
                page: Number(page),
                pages: Math.ceil(total / limit),
                limit: Number(limit),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------ Get Single Ticket ------------------ */
/**
 * @desc    Get a single ticket (owner only)
 * @route   GET /api/tickets/:id
 * @access  Private (vendor | user — owner)
 */
router.get('/:id', protect('vendor', 'user'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid ticket ID' });
        }

        const ticket = await Ticket.findOne({
            _id: req.params.id,
            authorId: req.user._id,
            authorRole: req.userRole,
        }).lean();

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        res.json({ success: true, ticket });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ------------------ Reply to Ticket ------------------ */
/**
 * @desc    Add a reply message to a ticket
 * @route   POST /api/tickets/:id/messages
 * @access  Private (vendor | user — owner)
 */
router.post('/:id/messages', protect('vendor', 'user'), async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid ticket ID' });
        }

        const { content } = req.body;
        if (!content?.trim()) {
            return res.status(400).json({ success: false, message: 'Message content is required' });
        }

        const ticket = await Ticket.findOne({
            _id: req.params.id,
            authorId: req.user._id,
            authorRole: req.userRole,
        });

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        if (ticket.status === 'closed') {
            return res.status(400).json({ success: false, message: 'This ticket is closed and cannot receive new replies' });
        }

        // If ticket was resolved and author replies, reopen it
        if (ticket.status === 'resolved') {
            ticket.status = 'open';
        }

        ticket.messages.push({
            senderRole: req.userRole,
            senderId: req.user._id,
            senderName: req.user.name || req.user.store_name || req.user.email || 'Unknown',
            content: content.trim(),
        });

        await ticket.save();

        const updated = await Ticket.findById(ticket._id).lean();
        emitToTicket(ticket._id, 'ticket:updated', updated);
        res.json({ success: true, ticket: updated });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
