/**
 * Single-claim conversion guard shared by the Family and Friends features.
 *
 * Both features turn a pre-order object into exactly one real `Order`, and both
 * can be raced: a double-clicked button, a browser refresh, a provider redirect
 * arriving alongside its webhook, or a webhook delivered twice.
 *
 * The guard is a conditional update, not a read-then-write. Mongo evaluates the
 * filter and the write atomically, so of N concurrent callers exactly one sees
 * `won: true`. Everyone else must discard the order they built rather than
 * leave a duplicate behind — `claimConversion` cannot do that for them, because
 * only the caller knows what it created.
 */

/**
 * Atomically claim a document for conversion.
 *
 * @param {Model}  Model     Mongoose model holding the claim field.
 * @param {*}      id        Document id to claim.
 * @param {object} update    Fields to set when the claim succeeds.
 * @param {string} claimField Field that must still be null to win. Default `converted_order_id`.
 * @returns {{won: boolean, document: object|null}}
 */
const claimConversion = async (Model, id, update, claimField = 'converted_order_id') => {
    const document = await Model.findOneAndUpdate(
        { _id: id, [claimField]: null },
        { ...update, updated_at: new Date() },
        { returnDocument: 'after' }
    );

    return { won: !!document, document };
};

/**
 * Discard an order that lost a conversion race.
 *
 * Deliberately fail-safe: if the cleanup itself errors we log and continue,
 * because the caller is already on a success path for the winning order and
 * must not surface a failure to the customer. A stranded order row is an
 * operational cleanup task; a failed checkout is a lost sale.
 */
const discardLosingOrder = async (orderId) => {
    if (!orderId) return;
    try {
        const { Order } = require('../../models/orders');
        await Order.deleteOne({ _id: orderId });
    } catch (err) {
        console.error(`[ConversionGuard] could not discard duplicate order ${orderId}:`, err.message);
    }
};

module.exports = { claimConversion, discardLosingOrder };
