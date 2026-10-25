const mongoose = require("mongoose");

const { Schema } = mongoose;

const passwordResetTokenSchema = new Schema(
    {
        role: { type: String, enum: ["user", "vendor"], required: true, index: true },
        account_id: { type: Schema.Types.ObjectId, required: true, index: true },
        email: { type: String, required: true, lowercase: true, trim: true, index: true },
        token_hash: { type: String, required: true, unique: true },
        expires_at: { type: Date, required: true },
        used_at: { type: Date, default: null },
        created_at: { type: Date, default: Date.now },
    },
    {
        timestamps: false,
    }
);

passwordResetTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
passwordResetTokenSchema.index({ role: 1, account_id: 1, used_at: 1 });

const PasswordResetToken = mongoose.model("PasswordResetToken", passwordResetTokenSchema);

const createPasswordResetToken = async (tokenData) => {
    return await PasswordResetToken.create(tokenData);
};

const deletePendingPasswordResetTokens = async ({ role, account_id }) => {
    return await PasswordResetToken.deleteMany({ role, account_id, used_at: null });
};

const findRecentPasswordResetToken = async ({ role, account_id, since }) => {
    return await PasswordResetToken.findOne({
        role,
        account_id,
        used_at: null,
        created_at: { $gt: since },
        expires_at: { $gt: new Date() },
    }).sort({ created_at: -1 });
};

const findPasswordResetTokenByHash = async (tokenHash) => {
    return await PasswordResetToken.findOne({
        token_hash: tokenHash,
        used_at: null,
        expires_at: { $gt: new Date() },
    });
};

const markPasswordResetTokenUsed = async (id) => {
    return await PasswordResetToken.findByIdAndUpdate(id, { used_at: new Date() });
};

module.exports = {
    PasswordResetToken,
    createPasswordResetToken,
    deletePendingPasswordResetTokens,
    findRecentPasswordResetToken,
    findPasswordResetTokenByHash,
    markPasswordResetTokenUsed,
};
