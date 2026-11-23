const mongoose = require('mongoose');
const { Ticket } = require('../../models/tickets');
const { ContactInquiry } = require('../../models/contact_inquiries');
const { emitToTicket } = require('../../common/services/socket');

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

/**
 * List tickets for user/vendor
 */
const listTickets = async ({ userId, userRole, status, priority, page = 1, limit = 20 }) => {
    const filter = {
        authorId: userId,
        authorRole: userRole,
    };

    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    const total = await Ticket.countDocuments(filter);
    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
    const tickets = await Ticket.find(filter)
        .select('title status priority category createdAt updatedAt messages')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean();

    return {
        tickets,
        pagination: {
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit)),
            limit: Number(limit),
        },
    };
};

/**
 * Get single ticket
 */
const getTicketById = async (id, userId, userRole) => {
    if (!isObjectId(id)) throw new Error('Invalid ticket ID');
    const filter = { _id: id };
    if (userId) {
        filter.authorId = userId;
        filter.authorRole = userRole;
    }
    return Ticket.findOne(filter).lean();
};

/**
 * Create ticket
 */
const createTicket = async ({ user, userRole, title, description, category, priority, order_id }) => {
    if (!title?.trim()) throw new Error('Title is required');
    if (!description?.trim()) throw new Error('Description is required');

    let linkedOrder = null;
    if (order_id) {
        if (!isObjectId(String(order_id))) throw new Error('Invalid order');
        const { Order } = require('../../models/orders');
        const ownerFilter = userRole === 'vendor'
            ? { $or: [{ 'sub_orders.vendor_id': user._id }, { 'vendor_supervisions.vendor_id': user._id }, { 'items.vendor_id': user._id }] }
            : { user_id: user._id };
        linkedOrder = await Order.findOne({ _id: order_id, ...ownerFilter }).select('_id transaction.reference').lean();
        if (!linkedOrder) throw new Error('Order not found');
    }

    const ticket = await Ticket.create({
        title: title.trim(),
        description: description.trim(),
        category: linkedOrder ? 'order' : (category || 'other'),
        priority: priority || 'medium',
        order_id: linkedOrder?._id || null,
        order_reference: linkedOrder ? (linkedOrder.transaction?.reference || String(linkedOrder._id).slice(-8).toUpperCase()) : null,
        authorId: user._id,
        authorRole: userRole,
        authorName: user.name || user.store_name || user.email || 'Unknown',
        messages: [],
        status: 'open',
    });

    return ticket;
};

/**
 * Reply to ticket
 */
const replyToTicket = async ({ ticketId, user, userRole, content }) => {
    if (!isObjectId(ticketId)) throw new Error('Invalid ticket ID');
    if (!content?.trim()) throw new Error('Message content is required');

    const ticket = await Ticket.findOne({
        _id: ticketId,
        authorId: user._id,
        authorRole: userRole,
    });

    if (!ticket) throw new Error('Ticket not found');
    if (ticket.status === 'closed') throw new Error('This ticket is closed and cannot receive new replies');

    if (ticket.status === 'resolved') ticket.status = 'open';

    ticket.messages.push({
        senderRole: userRole,
        senderId: user._id,
        senderName: user.name || user.store_name || user.email || 'Unknown',
        content: content.trim(),
    });

    await ticket.save();

    const updated = await Ticket.findById(ticket._id).lean();
    emitToTicket(ticket._id, 'ticket:updated', updated);

    try {
        const { createNotification } = require('../../models/notifications');
        const { User } = require('../../models/users');
        const admins = await User.find({ role: 'admin' }).select('_id').lean();
        const authorDisplayName = user.name || user.store_name || user.email || 'Author';
        await Promise.allSettled(
            admins.map((a) =>
                createNotification(
                    a._id,
                    'ticket_reply',
                    'رد جديد على تذكرة دعم',
                    `قام ${authorDisplayName} بالرد على التذكرة: "${ticket.title}"`,
                    { link: `/admin/dashboard/tickets/${ticket._id}`, ticketId: String(ticket._id) }
                )
            )
        );
    } catch (adminNotifyErr) {
        console.error('[Ticket Reply] Admin notification failed:', adminNotifyErr.message);
    }

    return updated;
};

/**
 * Submit contact inquiry
 */
const submitContactInquiry = async (data) => {
    return ContactInquiry.create({
        name: data.name,
        email: data.email,
        phone: data.phone,
        subject: data.subject,
        message: data.message || '',
    });
};

module.exports = {
    listTickets,
    getTicketById,
    createTicket,
    replyToTicket,
    submitContactInquiry,
};
