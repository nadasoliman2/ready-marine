const supportService = require('./support.service');

/**
 * GET /api/tickets
 */
const getTickets = async (req, res) => {
    try {
        const { status, priority, page = 1, limit = 20 } = req.query;
        const result = await supportService.listTickets({
            userId: req.user._id,
            userRole: req.userRole,
            status,
            priority,
            page,
            limit,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/tickets/:id
 */
const getTicket = async (req, res) => {
    try {
        const ticket = await supportService.getTicketById(req.params.id, req.user._id, req.userRole);
        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
        res.json({ success: true, ticket });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/tickets
 */
const createTicket = async (req, res) => {
    try {
        const ticket = await supportService.createTicket({
            user: req.user,
            userRole: req.userRole,
            ...req.body,
        });
        res.status(201).json({ success: true, ticket });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/tickets/:id/messages
 */
const replyTicket = async (req, res) => {
    try {
        const ticket = await supportService.replyToTicket({
            ticketId: req.params.id,
            user: req.user,
            userRole: req.userRole,
            content: req.body?.content,
        });
        res.json({ success: true, ticket });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/contact
 */
const submitContactInquiry = async (req, res) => {
    try {
        const { name, email, phone, subject, message } = req.body || {};
        if (!name || !email || !phone || !subject) {
            return res.status(400).json({ success: false, message: 'Name, email, phone, and subject are required' });
        }
        const cleanPhone = String(phone).trim();
        if (cleanPhone.length < 7) {
            return res.status(400).json({ success: false, message: 'Please enter a valid phone number' });
        }
        const inquiry = await supportService.submitContactInquiry({
            name: String(name).trim(),
            email: String(email).trim().toLowerCase(),
            phone: cleanPhone,
            subject: String(subject).trim(),
            message: message ? String(message).trim() : '',
        });
        res.status(201).json({
            success: true,
            message: 'Your inquiry has been received.',
            inquiry: { id: inquiry._id, status: inquiry.status },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    getTickets,
    getTicket,
    createTicket,
    replyTicket,
    submitContactInquiry,
};
