const mongoose = require("mongoose");
const { Schema } = mongoose;

/*
 * EverySecond chat-commerce state (Backend/docs/EVERYSECOND_CHAT_COMMERCE.md).
 *
 *   everysecondevents — every webhook delivery we accepted, keyed by
 *     EverySecond's event id. The unique key is the deduplication: a retry or a
 *     manual resend carries the same id, so it is stored and applied once. Kept
 *     as a log too — "the bot took an order and nothing happened" is answered by
 *     reading it.
 *
 *   everysecondmenuitems — a hash of what was last pushed for each menu item.
 *     The catalogue sync compares against it and sends only what changed, which
 *     keeps a large catalogue inside the 120-requests-a-minute limit.
 */

const eventSchema = new Schema(
  {
    event_id: { type: String, required: true, unique: true },
    event: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ["received", "processed", "ignored", "failed"], default: "received", index: true },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: "" },
    processed_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

const menuItemSchema = new Schema(
  {
    external_id: { type: String, required: true, unique: true },
    hash: { type: String, default: "" },
    synced_at: { type: Date, default: null },
    error: { type: String, default: "" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

const EverySecondEvent = mongoose.model("EverySecondEvent", eventSchema, "everysecondevents");
const EverySecondMenuItem = mongoose.model("EverySecondMenuItem", menuItemSchema, "everysecondmenuitems");

/** Store a delivery once. Returns the stored event, or null when it was a duplicate. */
const recordEvent = async ({ eventId, event, payload }) => {
  try {
    return (await EverySecondEvent.create({ event_id: eventId, event, payload })).toObject();
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
};

const markEvent = (eventId, status, error = "") =>
  EverySecondEvent.findOneAndUpdate(
    { event_id: eventId },
    { $set: { status, error, processed_at: new Date() }, $inc: { attempts: 1 } },
    { new: true }
  ).lean();

/** Deliveries that failed to apply (or were never picked up) and are worth another go. */
const findRetryableEvents = ({ olderThan, maxAttempts = 5, limit = 20 }) =>
  EverySecondEvent.find({
    status: { $in: ["received", "failed"] },
    attempts: { $lt: maxAttempts },
    updated_at: { $lte: olderThan },
  })
    .sort({ created_at: 1 })
    .limit(limit)
    .lean();

module.exports = {
  EverySecondEvent,
  EverySecondMenuItem,
  recordEvent,
  markEvent,
  findRetryableEvents,
};
