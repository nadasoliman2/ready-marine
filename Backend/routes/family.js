/**
 * Family Router — organizer/member family management and order requests.
 * Mounted at /api/users/family. Every endpoint requires a CUSTOMER session;
 * family, membership, and address authority are re-resolved server-side on
 * each call, never taken from the request body.
 */
const express = require('express');
const router = express.Router();
const { protect, denyUnclaimedGuest } = require('../middleware/authMiddleware');
const { rateLimit } = require('../middleware/rateLimit');
const familyService = require('../services/familyService');
const requestService = require('../services/familyOrderRequestService');
const { FamilyOrderRequest } = require('../models/familyOrderRequests');

/** Map a domain error's `code` onto an HTTP status; default to 400. */
const fail = (res, error) => {
    const status = error.status || 400;
    const body = { code: error.code || 'FAMILY_ERROR', message: error.message };
    if (error.details) body.details = error.details;
    return res.status(status).json(body);
};

const requestLanguage = (req) => (req.body?.language === 'ar' || req.query?.language === 'ar' ? 'ar' : 'en');

/* ------------------------------------------------------------------ */
/* Family + membership                                                 */
/* ------------------------------------------------------------------ */

/**
 * @desc    Family overview shaped for the caller's role (organizer or member)
 * @route   GET /api/users/family
 */
router.get('/', protect('user'), async (req, res) => {
    try {
        res.json(await familyService.getFamilyOverview(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Addresses the organizer has shared with the calling member
 * @route   GET /api/users/family/shared-addresses
 */
router.get('/shared-addresses', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        res.json(await familyService.getSharedAddressesForMember(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Invite a family member by email
 * @route   POST /api/users/family/invitations
 */
router.post(
    '/invitations',
    protect('user'),
    denyUnclaimedGuest,
    rateLimit({ name: 'family_invite', windowMs: 60 * 60 * 1000, max: 20 }),
    async (req, res) => {
        try {
            const result = await familyService.inviteFamilyMember(
                req.user._id,
                {
                    // `email` stays accepted under its own name so nothing that
                    // already calls this breaks; `identifier` is the one that may
                    // also be a mobile number.
                    email: req.body?.email,
                    identifier: req.body?.identifier,
                    relationship: req.body?.relationship,
                    shared_address_ids: req.body?.shared_address_ids,
                },
                { language: requestLanguage(req) }
            );
            res.status(201).json({
                // Generic success wording — it must not reveal whether the
                // invited email already has a ReadyCar account.
                message: 'Invitation sent. We will let you know when they join.',
                ...result,
            });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Resend a pending invitation with a fresh single-use token
 * @route   POST /api/users/family/invitations/:id/resend
 */
router.post(
    '/invitations/:id/resend',
    protect('user'),
    rateLimit({ name: 'family_invite_resend', windowMs: 60 * 60 * 1000, max: 20 }),
    async (req, res) => {
        try {
            const result = await familyService.resendInvitation(req.user._id, req.params.id, {
                language: requestLanguage(req),
            });
            res.json({ message: 'Invitation sent again.', ...result });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Cancel a pending invitation
 * @route   DELETE /api/users/family/invitations/:id
 */
router.delete('/invitations/:id', protect('user'), async (req, res) => {
    try {
        const result = await familyService.revokeInvitation(req.user._id, req.params.id);
        res.json({ message: 'Invitation cancelled.', ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Replace which of the organizer's addresses a member may use
 * @route   PUT /api/users/family/members/:memberId/addresses
 */
router.put('/members/:memberId/addresses', protect('user'), async (req, res) => {
    try {
        const result = await familyService.updateMemberSharedAddresses(
            req.user._id,
            req.params.memberId,
            req.body?.shared_address_ids || []
        );
        res.json({ message: 'Shared addresses updated.', ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Remove a member from the family
 * @route   DELETE /api/users/family/members/:memberId
 */
router.delete('/members/:memberId', protect('user'), async (req, res) => {
    try {
        const result = await familyService.removeMember(req.user._id, req.params.memberId);
        res.json({ message: 'Family member removed.', ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Leave the family (members only)
 * @route   POST /api/users/family/leave
 */
router.post('/leave', protect('user'), async (req, res) => {
    try {
        const result = await familyService.leaveFamily(req.user._id);
        res.json({ message: 'You left the family.', ...result });
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/* Order requests                                                      */
/* ------------------------------------------------------------------ */

/**
 * @desc    Member submits an order request (creates NO order and NO payment)
 * @route   POST /api/users/family/order-requests
 */
router.post(
    '/order-requests',
    protect('user'),
    rateLimit({ name: 'family_request_submit', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            const result = await requestService.submitOrderRequest(req.user._id, req.body || {});
            res.status(201).json(result);
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Requests the caller is party to, split into incoming/outgoing
 * @route   GET /api/users/family/order-requests
 */
router.get('/order-requests', protect('user'), async (req, res) => {
    try {
        res.json(await requestService.listRequestsForUser(req.user._id, { status: req.query.status }));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Request detail (organizers also get live repricing + change list)
 * @route   GET /api/users/family/order-requests/:id
 */
router.get('/order-requests/:id', protect('user'), async (req, res) => {
    try {
        res.json(await requestService.getRequestDetail(req.user._id, req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Member withdraws their own request before payment starts
 * @route   POST /api/users/family/order-requests/:id/withdraw
 */
router.post('/order-requests/:id/withdraw', protect('user'), async (req, res) => {
    try {
        res.json(await requestService.withdrawRequest(req.user._id, req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Organizer declines a request, optionally with a reason and note
 * @route   POST /api/users/family/order-requests/:id/decline
 */
router.post('/order-requests/:id/decline', protect('user'), async (req, res) => {
    try {
        res.json(await requestService.declineRequest(req.user._id, req.params.id, {
            reason: req.body?.reason,
            note: req.body?.note,
        }));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Organizer approves — moves to "payment needed", creates NO order
 * @route   POST /api/users/family/order-requests/:id/approve
 */
router.post(
    '/order-requests/:id/approve',
    protect('user'),
    rateLimit({ name: 'family_request_approve', windowMs: 60 * 1000, max: 20 }),
    async (req, res) => {
        try {
            res.json(await requestService.approveRequest(req.user._id, req.params.id, {
                remove_item_ids: req.body?.remove_item_ids || [],
                acknowledged_changes: !!req.body?.acknowledged_changes,
            }));
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Focused organizer checkout data, re-priced against live catalogue
 * @route   GET /api/users/family/order-requests/:id/checkout-preview
 */
router.get('/order-requests/:id/checkout-preview', protect('user'), async (req, res) => {
    try {
        res.json(await requestService.getCheckoutPreview(req.user._id, req.params.id, {
            address_id: req.query.address_id || null,
            shipping_method_id: req.query.shipping_method_id || null,
        }));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Organizer confirms cash on delivery — creates exactly one real order
 * @route   POST /api/users/family/order-requests/:id/place-cod
 */
router.post(
    '/order-requests/:id/place-cod',
    protect('user'),
    rateLimit({ name: 'family_request_cod', windowMs: 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const result = await requestService.placeCodOrder(req.user._id, req.params.id, {
                address_id: req.body?.address_id || null,
                shipping_method_id: req.body?.shipping_method_id || null,
            });
            res.status(result.alreadyPlaced ? 200 : 201).json({
                success: true,
                message: result.alreadyPlaced ? 'This request was already placed.' : 'Order placed successfully.',
                ...result,
            });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Organizer starts an online payment — creates NO order yet
 * @route   POST /api/users/family/order-requests/:id/create-payment
 */
router.post(
    '/order-requests/:id/create-payment',
    protect('user'),
    rateLimit({ name: 'family_request_pay', windowMs: 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const result = await requestService.createRequestPayment(req.user._id, req.params.id, {
                address_id: req.body?.address_id || null,
                shipping_method_id: req.body?.shipping_method_id || null,
                // Which route the organizer chose on the approval screen.
                payment_method: req.body?.payment_method || null,
            });

            if (result.alreadyPlaced) {
                return res.json({ success: true, alreadyPlaced: true, order_id: result.order_id });
            }

            // Wallet checkout already produced the order — there is nothing to
            // redirect to, and the request is converted.
            if (result.mode === 'wallet') {
                return res.status(201).json({
                    success: true,
                    requiresPayment: false,
                    order_id: result.order_id,
                    order: result.order,
                    request: result.request,
                });
            }

            res.status(201).json({
                success: true,
                requiresPayment: true,
                paymentUrl: result.payment.payment_url,
                payment: {
                    id: result.payment._id,
                    status: result.payment.status,
                    invoiceId: result.payment.invoice_id,
                },
            });
        } catch (error) {
            // Let the organizer top up the exact shortfall instead of showing a
            // dead end on a request that is otherwise ready to go.
            if (error.code === 'INSUFFICIENT_BALANCE' || error.code === 'WALLET_FROZEN') {
                return res.status(error.code === 'WALLET_FROZEN' ? 423 : 402).json({
                    code: error.code,
                    message: error.message,
                });
            }
            fail(res, error);
        }
    }
);

/**
 * @desc    Confirm an online payment after the provider redirect. Idempotent —
 *          repeated calls return the same order instead of creating another.
 * @route   POST /api/users/family/order-requests/:id/confirm-payment
 */
router.post('/order-requests/:id/confirm-payment', protect('user'), async (req, res) => {
    try {
        const request = await FamilyOrderRequest.findOne({
            _id: req.params.id,
            organizer_user_id: req.user._id,
        });
        if (!request) return res.status(404).json({ code: 'REQUEST_NOT_FOUND', message: 'Order request not found' });

        if (request.converted_order_id) {
            return res.json({ success: true, status: 'paid', alreadyPaid: true, order_id: request.converted_order_id });
        }

        const { confirmOrderPayment } = require('../services/orderPaymentService');
        const result = await confirmOrderPayment({
            userId: req.user._id,
            paymentId: req.body?.paymentId,
            invoiceId: req.body?.invoice_id,
        });

        if (result.status !== 'paid') {
            // Not settled — put the request back so it can be resumed.
            await requestService.onFamilyPaymentFailed(request._id);
            return res.json({ success: true, status: result.status, message: 'Payment is not confirmed yet' });
        }

        const fresh = await FamilyOrderRequest.findById(request._id).select('converted_order_id status');
        res.json({
            success: true,
            status: 'paid',
            order_id: fresh?.converted_order_id || result.order?._id || null,
            request_status: fresh?.status,
        });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Provider redirect reported a failed/abandoned payment — reopen the
 *          request for payment. Never creates or cancels an order.
 * @route   POST /api/users/family/order-requests/:id/payment-failed
 */
router.post('/order-requests/:id/payment-failed', protect('user'), async (req, res) => {
    try {
        const request = await FamilyOrderRequest.findOne({
            _id: req.params.id,
            organizer_user_id: req.user._id,
        });
        if (!request) return res.status(404).json({ code: 'REQUEST_NOT_FOUND', message: 'Order request not found' });

        await requestService.onFamilyPaymentFailed(request._id, req.body?.reason || '');
        const fresh = await FamilyOrderRequest.findById(request._id).select('status converted_order_id');
        res.json({ success: true, status: fresh.status, order_id: fresh.converted_order_id || null });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
