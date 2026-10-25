/**
 * What the payment gateway kept from a payment it collected for us.
 *
 * Neither provider states its fee when the payment is created; it appears only on the
 * record read back after the customer pays, and the two spell it differently:
 *
 *   Fawaterak — `commission`, the fee INCLUDING VAT, in EGP, with `onecommision.amount`
 *     carrying the same figure. Verified on live payments: a 100 EGP card payment reads
 *     4.56, which is the 2% + 2 EGP card rate with 14% VAT on top.
 *
 *   Paymob — `accept_fees_cents_int` (PIASTRES), or `accept_fees` / `merchant_commission`
 *     in pounds. Which one is populated depends on the account's settlement
 *     configuration, so all three are tried.
 *     ⚠️ NOT yet verified against a live transaction: every one of these fields reads 0
 *     in Paymob's published sample because that sample is a test payment. Confirm on the
 *     first real Paymob payment and delete this warning.
 *
 * Each payment keeps every confirmation payload it was told about in `webhook_payloads`,
 * with the provider's own record of the payment under `raw`. This reads the fee out of
 * that history. It returns null — never zero — when no payload carries a fee, so a report
 * can say "N payments could not be costed" instead of quietly booking them as free.
 *
 * Provider is detected from the payload rather than passed in: the payloads outlive any
 * switch, and a report covering a month that spans the migration has to cost Fawaterak
 * rows and Paymob rows side by side.
 *
 * @param {Array<object>} payloads  a record's `webhook_payloads`
 * @returns {number|null}
 */
const gatewayFeeFromPayloads = (payloads = []) => {
    // Latest first: a payment confirmed twice (redirect, then webhook) carries the same
    // fee in both, but the later record is the one the provider considers final.
    for (let i = (payloads || []).length - 1; i >= 0; i -= 1) {
        const raw = payloads[i]?.raw || payloads[i] || {};

        // Paymob states the fee in piastres in its integer field, so it is read and
        // converted on its own rather than being mixed in with the pound-denominated
        // candidates below.
        const piastres = Number(raw.accept_fees_cents_int);
        if (raw.accept_fees_cents_int !== null && raw.accept_fees_cents_int !== undefined
            && raw.accept_fees_cents_int !== "" && Number.isFinite(piastres) && piastres > 0) {
            return Number((piastres / 100).toFixed(2));
        }

        const candidates = [
            raw.commission, raw.onecommision?.amount,   // Fawaterak
            raw.accept_fees, raw.merchant_commission,   // Paymob
        ];
        for (const value of candidates) {
            const fee = Number(value);
            if (value !== null && value !== undefined && value !== "" && Number.isFinite(fee)) {
                return Number(fee.toFixed(2));
            }
        }
    }
    return null;
};

/**
 * Fawaterak's published rate, applied to every hosted payment it collects for us — an
 * order, a wallet top-up, a vendor subscription, a packaging order — the same way:
 * 2% of the amount plus 2 EGP, with 14% VAT on top of the fee.
 *
 * Checked against every live payment that did record its commission: 100 EGP reads 4.56,
 * 504.10 reads 13.77, 283.50 reads 8.74 — each one exactly (amount × 2% + 2) × 1.14.
 */
const FAWATERAK_TARIFF = Object.freeze({ percent: 0.02, fixed: 2, vat: 0.14 });

/** What Fawaterak keeps from `amount` EGP at its published rate, VAT included. */
const estimateFawaterakFee = (amount) => {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return 0;
    const t = FAWATERAK_TARIFF;
    return Number(((a * t.percent + t.fixed) * (1 + t.vat)).toFixed(2));
};

/**
 * The fee on one payment: the provider's own figure when it recorded one, the tariff
 * estimate when it did not.
 *
 * Older wallet top-ups stored only our own confirmation summary (invoice id, method,
 * date) and never the provider's record, so they carry no `commission` — but they were
 * charged exactly like every other payment. Pricing them off the tariff is what lets the
 * collection-cost line and the gateway balance be read as the real bill instead of a
 * floor. `estimated: true` says which figures came from the tariff rather than the
 * statement, so a screen can still say so.
 *
 * Paymob has no confirmed rate on this account, so a Paymob payment without a recorded
 * fee stays `null` — unknown, not guessed.
 *
 * @param {{ payloads?: Array<object>, amount?: number, provider?: string }} p
 * @returns {{ fee: number|null, estimated: boolean }}
 */
const gatewayFeeFor = ({ payloads = [], amount = 0, provider = "fawaterak" } = {}) => {
    const recorded = gatewayFeeFromPayloads(payloads);
    if (recorded !== null) return { fee: recorded, estimated: false };
    if ((provider || "fawaterak") === "fawaterak") return { fee: estimateFawaterakFee(amount), estimated: true };
    return { fee: null, estimated: false };
};

module.exports = { gatewayFeeFromPayloads, gatewayFeeFor, estimateFawaterakFee, FAWATERAK_TARIFF };
