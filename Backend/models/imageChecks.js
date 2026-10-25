const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ Image Check ------------------
 *
 * One product picture, measured once (services/imageCheckService.js). Keyed by the
 * picture's URL: an uploaded picture never changes under its name, so a measurement holds
 * until `version` (the analyser's) moves on. Products are not touched by any of this.
 */
const imageCheckSchema = new Schema(
    {
        url: { type: String, required: true, unique: true },
        version: { type: Number, required: true },
        status: { type: String, enum: ["ok", "broken", "unreachable"], required: true },
        error: { type: String, default: null },
        // measurements (services/imageCheck/analyzeImage.js)
        width: Number,
        height: Number,
        format: String,
        bytes: Number,
        has_alpha: Boolean,
        border_white: Number,
        content: Number,
        fill: Number,
        offset: Number,
        sharpness: Number,
        brightness: Number,
        contrast: Number,
        dhash: { type: String, index: true },
        attempts: { type: Number, default: 0 },
        // an unreachable picture (someone else's server down) is tried again after this
        retry_at: { type: Date, default: null },
        analyzed_at: { type: Date, default: Date.now },
    },
    { versionKey: false }
);

const ImageCheck = mongoose.model("ImageCheck", imageCheckSchema);

module.exports = { ImageCheck };
