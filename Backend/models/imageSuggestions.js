const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ Image Suggestion ------------------
 *
 * A cleaner picture the image studio offers for a product, waiting for an admin to take it
 * or leave it (services/imageStudioService.js). Nothing here touches a product until the
 * admin applies it.
 *
 *   kind 'enhance'  one of the product's own pictures, made white-background, square and
 *                   sharper; `source_url` is that picture as the product holds it
 *   kind 'web'      a picture the admin picked from a web search for a product with no (or
 *                   too few) pictures; `source_url` is our saved copy, `web` says where from
 *
 * `options` are the candidates, best first: a cut-out photo also gets the whole photo on
 * white as a second option, because a cut-out can go wrong and the admin must be able to
 * pick the safe one.
 */
const optionSchema = new Schema(
    {
        url: { type: String, required: true },
        mode: { type: String, enum: ["white", "alpha", "cutout", "pad"], required: true },
        upscaled: { type: Boolean, default: false },
    },
    { _id: false }
);

const imageSuggestionSchema = new Schema(
    {
        product_id: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
        kind: { type: String, enum: ["enhance", "web"], default: "enhance" },
        source_url: { type: String, required: true },
        status: {
            type: String,
            enum: ["queued", "processing", "ready", "applied", "dismissed", "failed"],
            default: "queued",
            index: true,
        },
        options: { type: [optionSchema], default: [] },
        // How sure the cut-out is: 'medium' / 'low' ask the admin to look before taking it.
        confidence: { type: String, enum: ["high", "medium", "low", null], default: null },
        notes: { type: [String], default: [] },
        // What was wrong with the original: size, background, framing, score (0-100).
        source_report: { type: Schema.Types.Mixed, default: null },
        web: {
            type: new Schema(
                {
                    image_url: String,
                    page_url: String,
                    title: String,
                    domain: String,
                    query: String,
                },
                { _id: false }
            ),
            default: undefined,
        },
        chosen_url: { type: String, default: null },
        kept_original: { type: Boolean, default: null },
        error: { type: String, default: null },
        attempts: { type: Number, default: 0 },
        // Not before this time: a busy image service puts the job back with a short wait.
        run_after: { type: Date, default: null },
        requested_by: { type: String, default: "auto" },
        decided_by: { type: String, default: null },
        decided_at: { type: Date, default: null },
    },
    { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

imageSuggestionSchema.index({ product_id: 1, source_url: 1, kind: 1 });
imageSuggestionSchema.index({ status: 1, run_after: 1, created_at: 1 });

const ImageSuggestion = mongoose.model("ImageSuggestion", imageSuggestionSchema);

module.exports = { ImageSuggestion };
