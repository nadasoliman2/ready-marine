const { randomUUID } = require('crypto');
const { Order } = require('../../models/orders');

// Serialize courier side effects across workers and reject an order loaded before a
// competing operation saved. A crashed operation can be retried after ten minutes;
// transfer checkpoints and Arrive's dispatch_attempt still prevent a blind create.
async function withOperation(order, work, existingToken = null) {
  if (existingToken) return work(existingToken);
  const token = randomUUID();
  const now = new Date();
  const claimed = await Order.updateOne({
    _id: order._id, __v: order.__v,
    $or: [
      { courier_operation: null },
      { 'courier_operation.at': { $lt: new Date(now.getTime() - 10 * 60 * 1000) } },
    ],
  }, { $set: { courier_operation: { token, at: now } }, $inc: { __v: 1 } });
  if (!claimed.modifiedCount) {
    throw Object.assign(new Error('Another courier operation changed this order or is still running. Refresh before trying again.'), { status: 409 });
  }
  // Even a failed/uncertain API call invalidates documents loaded before it. In
  // particular, a stale automatic Arrive send must see the persisted dispatch_attempt.
  order.__v = Number(order.__v || 0) + 1;
  if (order.unmarkModified) order.unmarkModified('__v');
  const previousWhere = order.$where;
  order.$where = { ...previousWhere, 'courier_operation.token': token };
  try {
    return await work(token);
  } finally {
    order.$where = previousWhere;
    await Order.updateOne({ _id: order._id, 'courier_operation.token': token }, { $set: { courier_operation: null } });
  }
}

module.exports = { withOperation };
