const friendsRouter = require('./friends.router');
const friendInvitationsRouter = require('./friend_invitations.router');
const friendCheckoutRouter = require('./friend_checkout.router');
const invitationsRouter = require('./invitations.router');
const friendService = require('./friend.service');
const friendCheckoutService = require('./friend_checkout.service');
const friendModel = require('../../models/friendships');

module.exports = {
    router: friendsRouter,
    friendsRouter,
    friendInvitationsRouter,
    friendCheckoutRouter,
    invitationsRouter,
    friendService,
    friendCheckoutService,
    ...friendModel
};
