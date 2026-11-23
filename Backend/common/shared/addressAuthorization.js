/**
 * Address-sharing authorization shared by the Family and Friends features.
 *
 * Both features let one customer select a delivery address that belongs to
 * ANOTHER customer. The two store the permission differently — Family keeps a
 * `shared_address_ids` array on the membership, Friends keeps one
 * `FriendAddressShare` row per grant — so this module takes the permission set
 * as an argument and owns only the invariants that must never differ:
 *
 *   1. The address must still exist on its OWNER. A deleted address is gone,
 *      not merely unshared.
 *   2. The address must be in the viewer's permission set RIGHT NOW. Sharing is
 *      re-checked at every sensitive transition, never cached in a session.
 *   3. The viewer never receives an edit affordance, and the backend never
 *      accepts an address the viewer supplies as authority.
 */
const { User } = require('../../models/users');

const authorizationError = (code, message, status = 403) => {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    return err;
};

/** Fields a viewer may see for someone else's address, inside an authorized checkout. */
const sharedAddressShape = (address) => ({
    _id: address._id,
    label: address.label || '',
    recipient_name: address.recipient_name,
    phone: address.phone,
    full_address: address.full_address,
    shipping_country: address.shipping_country || null,
    shipping_city: address.shipping_city || null,
});

/**
 * Reduced shape for friend LISTS, where full delivery details are not needed.
 * Only a label and a city — enough to tell addresses apart, not enough to
 * disclose where someone lives to a browsing session.
 */
const addressGlanceShape = (address) => ({
    _id: address._id,
    label: address.label || '',
    shipping_city: address.shipping_city || null,
});

/**
 * Load an owner and the subset of their addresses currently shared with a viewer.
 *
 * @param {ObjectId} ownerUserId  Whose address book to read.
 * @param {Set<string>} sharedIds Address ids the viewer is permitted to use.
 */
const listSharedAddresses = async (ownerUserId, sharedIds) => {
    const owner = await User.findById(ownerUserId).select('name profile_image addresses');
    if (!owner) return { owner: null, addresses: [] };

    return {
        owner,
        addresses: (owner.addresses || [])
            .filter((address) => sharedIds.has(address._id.toString()))
            .map(sharedAddressShape),
    };
};

/**
 * Resolve exactly one of an owner's addresses, enforcing existence and sharing.
 * Throws a distinct code for each failure so the UI can offer the right next
 * step: pick another address vs ask the owner to share one.
 */
const resolveSharedAddress = async (ownerUserId, addressId, sharedIds) => {
    const owner = await User.findById(ownerUserId).select('name email phone addresses preferred_language');
    if (!owner) throw authorizationError('OWNER_NOT_FOUND', 'That customer no longer exists', 404);

    const address = (owner.addresses || []).find((entry) => entry._id.toString() === String(addressId));
    if (!address) {
        throw authorizationError('ADDRESS_UNAVAILABLE', 'That delivery address is no longer available', 409);
    }

    if (!sharedIds.has(address._id.toString())) {
        throw authorizationError('ADDRESS_NOT_SHARED', 'That address is not shared with you', 403);
    }

    return { owner, address };
};

/**
 * Validate that every id in a list really belongs to the customer doing the
 * sharing. Prevents a caller from "sharing" an address id they do not own.
 */
const assertOwnedAddressIds = (owner, addressIds = []) => {
    const owned = new Set((owner.addresses || []).map((address) => address._id.toString()));
    const requested = [...new Set((addressIds || []).map(String))];

    if (requested.some((id) => !owned.has(id))) {
        throw authorizationError(
            'ADDRESS_NOT_OWNED',
            'One or more addresses do not belong to you',
            400
        );
    }

    return requested;
};

/** Snapshot written onto an order — the delivery facts, nothing more. */
const toShippingAddressSnapshot = (address) => ({
    recipient_name: address.recipient_name,
    phone: address.phone,
    full_address: address.full_address,
});

module.exports = {
    authorizationError,
    sharedAddressShape,
    addressGlanceShape,
    listSharedAddresses,
    resolveSharedAddress,
    assertOwnedAddressIds,
    toShippingAddressSnapshot,
};
