const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    idempotency_key: { type: String, required: true },
    kind: { type: String, enum: ['topup', 'purchase', 'refund', 'reversal', 'settlement', 'invoice'], required: true },
    delta_minor: { type: Number, required: true },
    balance_after_minor: { type: Number, required: true },
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    topup_id: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletTopup', default: null },
    reason: { type: String, default: '' },
    created_at: { type: Date, default: Date.now },
});
schema.index({ company_id: 1, idempotency_key: 1 }, { unique: true });
schema.index({ company_id: 1, created_at: -1 });
module.exports = { CompanyWalletTransaction: mongoose.model('CompanyWalletTransaction', schema) };
