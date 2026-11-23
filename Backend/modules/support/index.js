const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const supportController = require('./support.controller');
const supportService = require('./support.service');
const { Ticket } = require('../../models/tickets');
const { ContactInquiry } = require('../../models/contact_inquiries');

// Tickets router (mounted at /api/tickets)
const ticketsRouter = express.Router();
ticketsRouter.get('/', protect('vendor', 'user'), supportController.getTickets);
ticketsRouter.post('/', protect('vendor', 'user'), supportController.createTicket);
ticketsRouter.get('/:id', protect('vendor', 'user'), supportController.getTicket);
ticketsRouter.post('/:id/messages', protect('vendor', 'user'), supportController.replyTicket);

// Contact router (mounted at /api/contact)
const contactRouter = express.Router();
contactRouter.post('/', supportController.submitContactInquiry);

module.exports = {
    router: ticketsRouter,
    ticketsRouter,
    contactRouter,
    Ticket,
    ContactInquiry,
    supportService,
    supportController,
};
