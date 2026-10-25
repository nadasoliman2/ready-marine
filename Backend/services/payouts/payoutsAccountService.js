/**
 * Our Paymob Payouts account — the budget vendors are paid from — as a statement.
 *
 * WHAT MOVES IT. Money comes in only as top-ups (from the bank, or from the Paymob Accept
 * balance we collect through). Money goes out with every transfer to a vendor, plus Paymob's
 * fee and its VAT, which Ready Car bears. Paymob lists the top-ups (topup/inquire) and
 * answers for every transfer, so the whole statement can come from Paymob's own figures.
 *
 * WHAT A TRANSFER COSTS THE BUDGET, by what happened to it at Paymob:
 *   sent and paid, or still on its way    amount + fee + VAT
 *   rejected after Paymob accepted it     fee + VAT: the amount comes back, the fee does not
 *                                         (checked 2026-10-18: one rejected bank transfer
 *                                         left exactly its 11.40 EGP fee missing)
 *   refused before Paymob accepted it     nothing (no transaction id: it never existed there)
 *   sent to the staging server            nothing: no real money moved
 *
 * THE CHECK. The balance this adds up to is set beside Paymob's own (budget/inquire). Equal,
 * the books are right; a difference is something not recorded — usually a top-up Paymob has
 * not listed yet, or money that was in the budget before these records start.
 */

const { PayoutsTopup } = require("../../models/payoutsTopups");
const { GatewayPayout } = require("../../models/gatewayPayouts");
const { WithdrawalRequest } = require("../../models/withdrawalRequests");
const { recordAuditLog } = require("../../models/auditLog");
const paymob = require("./paymobPayoutClient");

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

const SOURCE_OF = {
    from_bank_transfer: "bank_transfer",
    from_bank_deposit: "bank_deposit",
    from_accept_balance: "accept_balance",
};
const SOURCES = ["bank_transfer", "bank_deposit", "accept_balance", "other"];
const STATUSES = ["pending", "initiated", "approved", "rejected"];

/** A hand-entered top-up is taken as Paymob's listed one when the amount matches within this. */
const MATCH_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  A top-up from the Paymob Accept balance leaves that balance        */
/* ------------------------------------------------------------------ */

/**
 * The treasury's Paymob (Accept) balance is what Paymob collected for us less what it sent
 * on. A top-up "from Accept balance" is money sent on — to our own Payouts budget — so it is
 * a transfer out of Accept, and the treasury's statement must show it. Kept in step with the
 * top-up: made while it is approved, removed when it is not.
 */
const syncAcceptTransfer = async (topup) => {
    const counts = topup.status === "approved" && topup.source === "accept_balance";
    const existing = await GatewayPayout.findOne({ payouts_topup_id: topup._id });
    if (!counts) {
        if (existing) await GatewayPayout.deleteOne({ _id: existing._id });
        return;
    }
    const fields = {
        provider: "paymob",
        amount: round2(topup.amount),
        received_at: topup.topped_up_at || new Date(),
        reference: topup.paymob_topup_id ? `Payouts top-up #${topup.paymob_topup_id}` : (topup.reference || ""),
        notes: "اتحوّل لرصيد Paymob Payouts (تحويلات التجار)",
        destination: "paymob_payouts",
        payouts_topup_id: topup._id,
        recorded_by_name: topup.origin === "paymob" ? "Paymob" : (topup.recorded_by_name || "Admin"),
    };
    if (existing) await GatewayPayout.updateOne({ _id: existing._id }, { $set: fields });
    else await GatewayPayout.create(fields);
};

/* ------------------------------------------------------------------ */
/*  Sync from Paymob                                                   */
/* ------------------------------------------------------------------ */

let lastSync = null; // { at, ok, created, updated, linked, error }

const toDate = (v) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * Copy every top-up Paymob lists. New ones are added; known ones take Paymob's latest status
 * (pending → approved). A new approved one first looks for a hand-entered row of the same
 * amount, near the same date, not yet linked — that is the same money, typed in before Paymob
 * listed it, so it is linked rather than counted twice.
 */
const syncTopups = async () => {
    if (!paymob.isConfigured()) return { configured: false };
    const summary = { at: new Date(), ok: true, listed: 0, created: 0, updated: 0, linked: 0 };
    try {
        const listed = await paymob.topups();
        summary.listed = listed.length;

        for (const t of listed) {
            const id = Number(t.id);
            if (!Number.isFinite(id)) continue;
            const status = STATUSES.includes(t.status) ? t.status : "pending";
            const fields = {
                amount: round2(t.amount),
                source: SOURCE_OF[t.transfer_type] || "other",
                status,
                // The budget is credited when Paymob approves the top-up.
                topped_up_at: status === "approved" ? (toDate(t.updated_at) || toDate(t.created_at)) : null,
                paymob_created_at: toDate(t.created_at),
                rejection_reason: t.reason || "",
                reference: t.bank_reference || (t.accept_balance_transfer_id ? `Accept #${t.accept_balance_transfer_id}` : ""),
                raw: t,
            };

            let topup = await PayoutsTopup.findOne({ paymob_topup_id: id });
            if (topup) {
                // A hand-entered row keeps its own date and notes; Paymob's status and amount win.
                if (topup.origin === "manual") delete fields.topped_up_at;
                const changed = topup.status !== fields.status || topup.amount !== fields.amount
                    || ("topped_up_at" in fields && String(topup.topped_up_at || "") !== String(fields.topped_up_at || ""));
                if (changed) {
                    Object.assign(topup, fields);
                    await topup.save();
                    summary.updated += 1;
                }
            } else {
                const near = fields.topped_up_at || fields.paymob_created_at || new Date();
                const manual = await PayoutsTopup.findOne({
                    origin: "manual",
                    paymob_topup_id: null,
                    amount: fields.amount,
                    topped_up_at: { $gte: new Date(near.getTime() - MATCH_WINDOW_MS), $lte: new Date(near.getTime() + MATCH_WINDOW_MS) },
                }).sort({ topped_up_at: 1 });
                if (manual) {
                    manual.paymob_topup_id = id;
                    manual.status = fields.status;
                    manual.source = fields.source;
                    manual.paymob_created_at = fields.paymob_created_at;
                    manual.rejection_reason = fields.rejection_reason;
                    manual.raw = t;
                    if (!manual.reference) manual.reference = fields.reference;
                    topup = await manual.save();
                    summary.linked += 1;
                } else {
                    topup = await PayoutsTopup.create({ ...fields, paymob_topup_id: id, origin: "paymob", recorded_by_name: "Paymob" });
                    summary.created += 1;
                }
            }
            await syncAcceptTransfer(topup);
        }
    } catch (err) {
        summary.ok = false;
        summary.error = err.message;
    }
    lastSync = summary;
    return summary;
};

/* ------------------------------------------------------------------ */
/*  Paymob's own balance                                               */
/* ------------------------------------------------------------------ */

// Paymob allows 5 reads a minute between balance, top-ups and transfer checks; the screen
// reuses a reading for a minute rather than spend one on every open.
let budgetCache = null; // { at, value }
const BUDGET_TTL_MS = 60 * 1000;

const readBudget = async ({ fresh = false } = {}) => {
    if (!paymob.isConfigured()) return { configured: false };
    if (!fresh && budgetCache && Date.now() - budgetCache.at < BUDGET_TTL_MS) return budgetCache.value;
    try {
        const b = await paymob.budget();
        const value = { configured: true, environment: paymob.environment(), balance: b.balance, currency: b.currency, read_at: new Date() };
        budgetCache = { at: Date.now(), value };
        return value;
    } catch (err) {
        return { configured: true, environment: paymob.environment(), balance: null, error: err.message };
    }
};

/* ------------------------------------------------------------------ */
/*  The statement                                                      */
/* ------------------------------------------------------------------ */

const TRANSFER_SELECT = "withdrawal_number amount status vendor_id gateway.transaction_id gateway.disbursement_status gateway.fees gateway.vat gateway.sent_at gateway.environment created_at";

/** What one transfer took out of the budget (see the table at the top), or null for nothing. */
const transferRow = (w) => {
    const g = w.gateway || {};
    if (!g.transaction_id || g.environment === "staging") return null;
    const fee = g.fees == null && g.vat == null ? null : round2((g.fees || 0) + (g.vat || 0));
    const vendor = w.vendor_id?.store_name || w.vendor_id?.store_username || "";
    const base = {
        at: g.sent_at || w.created_at,
        payout_id: w._id,
        payout_number: w.withdrawal_number,
        vendor,
        fee,
        fee_unknown: fee === null,
    };
    if (w.status === "failed") {
        // Paymob accepted it and the bank refused it: the amount came back, the fee did not.
        return { ...base, kind: "fee", amount: 0, net: round2(-(fee || 0)) };
    }
    if (!["paid", "processing"].includes(w.status)) return null;
    return { ...base, kind: "transfer", amount: round2(w.amount), net: round2(-(w.amount + (fee || 0))) };
};

/**
 * Every movement of the budget, newest first, each with the balance after it; Paymob's own
 * balance beside the result, and the top-ups Paymob has not approved yet.
 */
const getStatement = async ({ page = 1, limit = 60, freshBalance = false } = {}) => {
    const [topups, transfers, live] = await Promise.all([
        PayoutsTopup.find({}).sort({ topped_up_at: 1, createdAt: 1 }).lean(),
        WithdrawalRequest.find({ channel: "paymob", "gateway.transaction_id": { $ne: null } })
            .select(TRANSFER_SELECT)
            .populate({ path: "vendor_id", select: "store_name store_username" })
            .lean(),
        readBudget({ fresh: freshBalance }),
    ]);

    const rows = [];
    for (const t of topups) {
        if (t.status !== "approved") continue;
        rows.push({
            kind: "topup",
            id: t._id,
            at: t.topped_up_at || t.createdAt,
            amount: round2(t.amount),
            fee: null,
            net: round2(t.amount),
            source: t.source,
            origin: t.origin,
            paymob_topup_id: t.paymob_topup_id,
            reference: t.reference,
            notes: t.notes,
        });
    }
    for (const w of transfers) {
        const row = transferRow(w);
        if (row) rows.push(row);
    }

    rows.sort((a, b) => new Date(a.at) - new Date(b.at));
    let balance = 0;
    for (const row of rows) {
        balance = round2(balance + row.net);
        row.balance = balance;
    }
    rows.reverse();

    const sum = (kind, field) => round2(rows.filter((r) => r.kind === kind).reduce((s, r) => s + (r[field] || 0), 0));
    const start = (Math.max(1, page) - 1) * limit;

    return {
        live,
        balance,
        difference: Number.isFinite(live.balance) ? round2(live.balance - balance) : null,
        totals: {
            topped_up: sum("topup", "amount"),
            transferred: sum("transfer", "amount"),
            fees: round2(rows.filter((r) => r.kind !== "topup").reduce((s, r) => s + (r.fee || 0), 0)),
            fees_unknown: rows.filter((r) => r.fee_unknown).length,
        },
        // Listed by Paymob and not money yet.
        waiting: topups
            .filter((t) => t.status === "pending" || t.status === "initiated")
            .map((t) => ({ id: t._id, amount: t.amount, source: t.source, status: t.status, at: t.paymob_created_at || t.createdAt, paymob_topup_id: t.paymob_topup_id })),
        rejected: topups.filter((t) => t.status === "rejected").length,
        last_sync: lastSync,
        total: rows.length,
        page,
        limit,
        rows: rows.slice(start, start + limit),
    };
};

/* ------------------------------------------------------------------ */
/*  Entered by hand                                                    */
/* ------------------------------------------------------------------ */

/**
 * A top-up the admin knows about before Paymob lists it. When Paymob does, the sync links
 * this row (same amount, within five days) instead of adding the money a second time.
 */
const recordTopup = async ({ amount, topped_up_at, source = "other", reference = "", notes = "", adminId = null, adminLabel = "Admin" } = {}) => {
    if (!(Number(amount) > 0)) throw new Error("اكتب المبلغ اللي اتشحن");
    if (!SOURCES.includes(source)) throw new Error("Unknown source");
    const at = topped_up_at ? new Date(topped_up_at) : new Date();
    if (Number.isNaN(at.getTime())) throw new Error("Invalid date");

    const topup = await PayoutsTopup.create({
        amount: round2(amount),
        topped_up_at: at,
        source,
        status: "approved",
        origin: "manual",
        reference: String(reference || "").trim(),
        notes: String(notes || "").trim(),
        recorded_by: adminId || null,
        recorded_by_name: adminLabel,
    });
    await syncAcceptTransfer(topup);

    await recordAuditLog({
        action: "payouts_topup_recorded",
        actor: { role: "admin", label: adminLabel },
        target_type: "payouts_topup",
        target_id: topup._id,
        target_snapshot: { amount: topup.amount, source, reference: topup.reference },
    });
    return topup.toObject();
};

/** Undo a hand-entered top-up. One Paymob lists is Paymob's record, and stays. */
const deleteTopup = async (id, { adminLabel = "Admin" } = {}) => {
    const topup = await PayoutsTopup.findById(id);
    if (!topup) throw new Error("Top-up not found");
    if (topup.paymob_topup_id) throw new Error("ده شحن مسجّل عند Paymob نفسها، مينفعش يتمسح من هنا.");

    await GatewayPayout.deleteMany({ payouts_topup_id: topup._id });
    await PayoutsTopup.deleteOne({ _id: topup._id });

    await recordAuditLog({
        action: "payouts_topup_deleted",
        actor: { role: "admin", label: adminLabel },
        target_type: "payouts_topup",
        target_id: topup._id,
        target_snapshot: { amount: topup.amount, source: topup.source, reference: topup.reference },
    });
    return { deleted: true };
};

module.exports = {
    SOURCES,
    syncTopups,
    readBudget,
    getStatement,
    recordTopup,
    deleteTopup,
};
