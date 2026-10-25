const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { Ticket } = require('../models/tickets');
const { User } = require('../models/users');
const { isTokenStaleAfterPasswordChange } = require('../middleware/authMiddleware');
const presence = require('./presenceService');

let io = null;

/* ------------------ Cookie parsing helper ------------------ */
const parseCookies = (cookieHeader) => {
    const out = {};
    if (!cookieHeader) return out;
    cookieHeader.split(';').forEach((pair) => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        if (key) out[key] = decodeURIComponent(val);
    });
    return out;
};

/* ------------------ Verify handshake cookie → identity ------------------
 * Mirrors Backend/middleware/authMiddleware.js: admin_token uses
 * JWT_SECRET_ADMIN; otherwise the `token` cookie is tried against the
 * vendor/user secrets.
 */
const identifyFromCookies = (cookies) => {
    if (cookies.admin_token) {
        try {
            const decoded = jwt.verify(cookies.admin_token, process.env.JWT_SECRET_ADMIN);
            if (decoded.role === 'admin') {
                return { id: null, role: 'admin', name: decoded.username || 'Admin' };
            }
        } catch (_) { /* fall through */ }
    }

    if (cookies.token) {
        const candidates = [
            { secret: process.env.JWT_SECRET_VENDOR, role: 'vendor' },
            { secret: process.env.JWT_SECRET_USER, role: 'user' },
        ];
        for (const { secret, role } of candidates) {
            try {
                const decoded = jwt.verify(cookies.token, secret);
                if (decoded.role === role) {
                    return { id: String(decoded.id), role, name: decoded.name || null, iat: decoded.iat };
                }
            } catch (_) { /* try next */ }
        }
    }

    return null;
};

/* ------------------ Initialize Socket.IO ------------------ */
const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: process.env.FRONTEND_URL || 'http://localhost:3000',
            credentials: true,
        },
    });

    // Authenticate every connection via the handshake cookies
    io.use(async (socket, next) => {
        const cookies = parseCookies(socket.handshake.headers.cookie);
        const identity = identifyFromCookies(cookies);
        if (!identity) {
            return next(new Error('Not authorized'));
        }
        // A customer's socket counts them as online (presenceService), so it gets the same
        // account checks as `protect`: the account still exists and the token was not issued
        // before the last password change.
        if (identity.role === 'user') {
            try {
                const account = await User.findById(identity.id).select('password_changed_at').lean();
                if (!account || isTokenStaleAfterPasswordChange(account, identity)) {
                    return next(new Error('Not authorized'));
                }
            } catch (_) {
                return next(new Error('Not authorized'));
            }
        }
        socket.data.user = identity;
        next();
    });

    presence.startPresence();

    io.on('connection', (socket) => {
        const { user } = socket.data;

        // Online status for the abandoned-cart reminders: one Redis member per open socket.
        if (user.role === 'user' && user.id) {
            presence.trackSocket(socket.id, user.id);
            socket.on('disconnect', () => presence.untrackSocket(socket.id));
        }

        // Client requests to join a ticket conversation room
        socket.on('ticket:join', async (ticketId) => {
            try {
                if (!ticketId) return;

                // Admins may join any ticket; vendors/users only their own
                if (user.role === 'admin') {
                    socket.join('ticket:' + ticketId);
                    return;
                }

                const ticket = await Ticket.findById(ticketId).select('authorId authorRole').lean();
                if (
                    ticket &&
                    String(ticket.authorId) === user.id &&
                    ticket.authorRole === user.role
                ) {
                    socket.join('ticket:' + ticketId);
                }
            } catch (_) { /* ignore join errors */ }
        });

        socket.on('ticket:leave', (ticketId) => {
            if (ticketId) socket.leave('ticket:' + ticketId);
        });
    });

    return io;
};

/* ------------------ Broadcast helper ------------------ */
const emitToTicket = (ticketId, event, payload) => {
    if (!io) return;
    io.to('ticket:' + String(ticketId)).emit(event, payload);
};

module.exports = { initSocket, emitToTicket };
