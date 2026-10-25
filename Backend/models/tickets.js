const mongoose = require('mongoose');

const { Schema } = mongoose;

/* ------------------ Message Sub-schema ------------------ */
const messageSchema = new Schema({
    senderRole: {
        type: String,
        enum: ['vendor', 'user', 'admin'],
        required: true,
    },
    senderId: {
        type: Schema.Types.ObjectId,
        required: function() { return this.senderRole !== 'admin'; },
    },
    senderName: {
        type: String,
        required: true,
    },
    content: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
}, { _id: true });

/* ------------------ Ticket Schema ------------------ */
const ticketSchema = new Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 255,
        },
        description: {
            type: String,
            required: true,
            trim: true,
        },

        // Author
        authorId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        authorRole: {
            type: String,
            enum: ['vendor', 'user'],
            required: true,
            index: true,
        },
        authorName: {
            type: String,
            required: true,
        },

        // Status & Priority
        status: {
            type: String,
            enum: ['open', 'pending', 'resolved', 'closed'],
            default: 'open',
            index: true,
        },
        priority: {
            type: String,
            enum: ['low', 'medium', 'high', 'urgent'],
            default: 'medium',
            index: true,
        },

        // Category
        category: {
            type: String,
            enum: ['account', 'order', 'product', 'payment', 'technical', 'other'],
            default: 'other',
        },

        // The order this ticket is about, when it is about one. The reference is
        // snapshotted so the support screen can name the order without a join, and the
        // id lets it jump straight to it.
        order_id: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
        order_reference: { type: String, default: null },

        // Thread of messages (replies)
        messages: [messageSchema],

        // Assigned admin (optional)
        assignedTo: {
            type: Schema.Types.ObjectId,
            default: null,
        },
        assignedToName: {
            type: String,
            default: null,
        },

        // Internal notes (admin only)
        adminNote: {
            type: String,
            default: null,
        },

        // True when an admin started this conversation with a vendor
        initiatedByAdmin: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true, // adds createdAt & updatedAt
    }
);

// Compound index for filtering author's tickets
ticketSchema.index({ authorId: 1, authorRole: 1, createdAt: -1 });

const Ticket = mongoose.model('Ticket', ticketSchema);

module.exports = { Ticket };
