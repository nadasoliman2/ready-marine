const mongoose = require("mongoose");

const { Schema } = mongoose;

const emailVerificationSchema = new Schema(
    {
        role: { type: String, enum: ["user", "vendor"], required: true, index: true },
        email: { type: String, required: true, lowercase: true, trim: true, index: true },
        phone: { type: String, required: true, trim: true, index: true },
        store_username: { type: String, lowercase: true, trim: true, index: true, default: null },
        payload: { type: Schema.Types.Mixed, required: true },
        token_hash: { type: String, required: true, unique: true },
        // How this registration is being proved: an emailed link, an emailed
        // code, or a WhatsApp code. A resend has to reach the same place by the
        // same route, and only the record knows which that was.
        channel: { type: String, enum: ['email_link', 'email_otp', 'whatsapp'], default: 'email_link' },
        expires_at: { type: Date, required: true },
        created_at: { type: Date, default: Date.now },
    },
    {
        timestamps: false,
    }
);

emailVerificationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const EmailVerification = mongoose.model("EmailVerification", emailVerificationSchema);

const createEmailVerification = async (verificationData) => {
    return await EmailVerification.create(verificationData);
};

const deleteExistingPendingVerification = async ({ role, email, phone, store_username }) => {
    const or = [{ email }, { phone }];

    if (store_username) {
        or.push({ store_username });
    }

    return await EmailVerification.deleteMany({ role, $or: or });
};

const findEmailVerificationByTokenHash = async (tokenHash) => {
    return await EmailVerification.findOne({
        token_hash: tokenHash,
        expires_at: { $gt: new Date() },
    });
};

const findEmailVerificationById = async (id) => {
    return await EmailVerification.findById(id);
};

const deleteEmailVerificationById = async (id) => {
    return await EmailVerification.findByIdAndDelete(id);
};

module.exports = {
    EmailVerification,
    createEmailVerification,
    deleteExistingPendingVerification,
    findEmailVerificationByTokenHash,
    findEmailVerificationById,
    deleteEmailVerificationById,
};
