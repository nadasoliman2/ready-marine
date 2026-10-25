/**
 * Invitation resolver — the one landing path every WhatsApp invitation uses.
 * Mounted at /api/invitations.
 *
 * Exists for a constraint outside this codebase: a WhatsApp template declares a
 * single fixed base URL for its button, and Meta verifies that the delivered
 * link begins with it. Friends and Family have separate landing pages, so
 * without a shared prefix the template's base would have to be the bare domain.
 *
 * Rather than move either page — and break every link already sent — the button
 * points at `/invite/<token>` and this endpoint says which page that token
 * belongs to. It answers for invitations in ANY state: an expired or already
 * accepted one still resolves, so the invitee lands on the page that can
 * actually explain what happened to it.
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { rateLimit } = require('../middleware/rateLimit');
const { FriendInvitation } = require('../models/friendships');
const { FamilyInvitation } = require('../models/families');
const { CompanyInvitation } = require('../models/companies');

/** Every invitation kind hashes its token the same way, so one digest looks up all of them. */
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * @desc    Which kind of invitation is this token?
 * @route   GET /api/invitations/:token/resolve
 *
 * Returns `{ kind: 'friend' | 'family' | 'company' }` and nothing else. Reaching a positive
 * answer requires already holding a 32-byte token, and knowing which of two
 * pages to open discloses nothing that page would not immediately show anyway.
 */
router.get(
    '/:token/resolve',
    rateLimit({ name: 'invite_resolve', windowMs: 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            const tokenHash = hashToken(req.params.token);

            // Only `token_hash` is compared — never the raw token, which is not
            // stored anywhere and exists only in the message that carried it.
            const friend = await FriendInvitation.findOne({ token_hash: tokenHash }).select('channel').lean();
            if (friend) {
                // An in-app request (the invitee already has an account) is answered from
                // their Friends tab, not from the token page — that page is only for
                // proving a number and claiming a guest account.
                return res.json(friend.channel === 'in_app'
                    ? { kind: 'friend', redirect: '/profile?tab=friends' }
                    : { kind: 'friend' });
            }
            if (await FamilyInvitation.exists({ token_hash: tokenHash })) {
                return res.json({ kind: 'family' });
            }
            if (await CompanyInvitation.exists({ token_hash: tokenHash })) {
                return res.json({ kind: 'company' });
            }

            return res.status(404).json({
                code: 'INVITATION_NOT_FOUND',
                message: 'This invitation link is not valid',
            });
        } catch (error) {
            res.status(500).json({ code: 'RESOLVE_FAILED', message: error.message });
        }
    }
);

module.exports = router;
