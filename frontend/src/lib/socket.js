import { io } from 'socket.io-client';

// Derive the socket origin from the API base URL (strip the trailing /api).
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const SOCKET_URL = API_URL.replace(/\/api\/?$/, '');

let socket = null;

/**
 * Returns a shared singleton socket connection (cookie-authenticated).
 */
export function getSocket() {
    if (typeof window === 'undefined') return null;
    if (!socket) {
        socket = io(SOCKET_URL, {
            withCredentials: true,
            transports: ['websocket', 'polling'],
        });
    }
    return socket;
}

/**
 * Close the shared connection (sign-out). The next getSocket() opens a fresh one with the
 * cookies of whoever is signed in then — a socket authenticates only when it connects.
 */
export function disconnectSocket() {
    if (!socket) return;
    socket.disconnect();
    socket = null;
}

/**
 * Join a ticket conversation room to receive live updates.
 */
export function joinTicket(ticketId) {
    const s = getSocket();
    if (s && ticketId) s.emit('ticket:join', ticketId);
}

/**
 * Leave a ticket conversation room.
 */
export function leaveTicket(ticketId) {
    const s = getSocket();
    if (s && ticketId) s.emit('ticket:leave', ticketId);
}
