# 6 - Customer Wallet (Store Credit)

> Status: Implemented · Created: 2026-08-09 · Updated: 2026-08-10 · Ships behind an admin kill switch, default OFF

## Confirmed Requirement

ReadyCar customers no longer pay the payment gateway directly at checkout.
Instead each account holds a **wallet** of store credit:

- The customer tops the wallet up through the payment gateway (Fawaterak).
- Orders are paid from that credit.
- **Every refund** — from a return or a cancellation — comes back to the wallet
  rather than to a card or a bank account.

## Approved Decisions

| Decision | Approved behavior |
| --- | --- |
| Checkout methods | **Wallet + Cash on delivery.** The card disappears from checkout; the gateway now only funds the wallet |
| Insufficient balance | Checkout offers a **one-tap top-up of the exact shortfall**, and returns the customer to checkout with the basket intact |
| Custom top-up | The customer may always type any amount instead. **No minimum and no maximum** |
| Withdrawals | **Not possible.** Credit is spendable on ReadyCar only, and this is stated next to every balance, not buried in terms |
| Refund destination | **All refunds go to the wallet** while the feature is live, including cash-on-delivery orders. Switched off, refunds keep their original manual routing — except an order paid FROM the wallet, which always returns there |
| Expiry | Wallet credit **never expires** |
| Scope | Customer flows only: normal checkout, **friend checkout**, **family order requests**. Vendor subscriptions are unchanged |
| Admin controls | Manual credit/debit with a mandatory reason · view any wallet + full ledger · freeze/unfreeze · global kill switch |

## How the money moves

```
Gateway ──topup──▶ WALLET ──purchase──▶ Order
                     ▲                    │
                     └──── refund ────────┘
                       (returns, cancellations, COD — all of them)
```

The wallet is the only place customer money now enters, sits, and leaves.

## Architecture

Built to mirror the existing loyalty system, because the two answer the same
question in different units. The difference that drove every design decision is
that **loyalty points are a reward the store issues, while wallet credit is the
customer's own money.**

### Data model

| Collection | Purpose |
| --- | --- |
| `walletAccounts` | One per customer. `available` + `reserved` balances, lifetime counters, `active`/`frozen` status |
| `walletTransactions` | The immutable ledger. One row per movement, with a unique `idempotency_key` and the running balance after it |
| `walletTopups` | One per hosted gateway invoice that puts money in |

### Three invariants

1. **The ledger is the truth.** `walletAccounts` is a cache. Every balance
   change writes a transaction explaining it, and a balance that cannot be
   explained is rolled back rather than kept.

2. **Every operation is idempotent.** Mongo runs standalone here, so there are
   no multi-document transactions. Correctness comes from a conditional atomic
   `$inc` (the overdraft guard is a *query condition*, so it is enforced by the
   database rather than by a read-then-write two requests can both pass) plus a
   unique idempotency key. The gateway's redirect and its webhook confirm the
   same top-up simultaneously as a matter of routine.

3. **Money is integers.** Balances are stored in **minor units (piastres)**,
   never floating-point pounds. `$inc` on a double accumulates representation
   error, and the failure that produces is the worst kind: the customer is shown
   100.00, tries to spend 100.00, and is told they have insufficient funds.

### Ordering that matters

Wallet payment is taken **before the order document is created**, mirroring how
cash-on-delivery spends loyalty points. If the balance moved since the price
preview, the conditional debit fails and no order exists. Creating the order
first and charging afterwards can produce an order nobody paid for — the one
outcome that must be impossible. If order creation then fails for any other
reason, a compensating ledger entry returns the money.

## Key files

**Backend**

| File | Role |
| --- | --- |
| `models/walletAccounts.js` · `walletTransactions.js` · `walletTopups.js` | The data model |
| `services/walletService.js` | The **only** writer of customer credit. All rules live here |
| `services/walletTopupService.js` | Gateway round trip, webhook, redirect confirmation, recovery sweep |
| `routes/wallet.js` | Customer endpoints (`/api/users/wallet`) |
| `routes/adminWallet.js` | Admin endpoints (`/api/admin/wallet`) |
| `services/accountDeletionService.js` | Blocks deletion while a balance is held; cleans up records once settled |
| `scripts/addWalletTermsClause.js` | Idempotent migration adding the wallet clause to the live Terms page |
| `services/orderService.js` | Wallet charge at placement; cancellation refunds to wallet |
| `services/refundService.js` | Refunds settle as `store_credit` and are credited automatically while the wallet is live |
| `services/friendCheckoutService.js` · `familyOrderRequestService.js` | Pay from the payer's wallet |

**Frontend**

| File | Role |
| --- | --- |
| `components/wallet/WalletTab.jsx` | Profile → My Wallet: balance, top-up, full statement |
| `app/checkout/page.jsx` | Wallet payment option, shortfall panel, top-up round trip |
| `app/admin/dashboard/wallets/page.jsx` | Admin: liability, settings, search, adjust, freeze, exceptions |
| `lib/walletLocalization.js` | EN/AR copy |

## Notable behaviours

**A freeze pauses activity, it does not seize money.** Frozen wallets cannot
spend or top up. Refunds and admin corrections still land, because withholding
money a customer is already owed is not something a flag should decide.

**The kill switch does not strand balances.** Turning `wallet.enabled` off
returns checkout to charging the gateway directly. Existing balances, history,
and refunds into the wallet all keep working.

**Refunds became one rule instead of three.** Previously a card refund meant a
manual trip to the Fawaterak dashboard and a cash refund meant a hand-keyed bank
transfer. Now `processRefund` credits the wallet and completes in a single
click, with no external step.

**Paid-but-not-credited is a first-class state.** If the gateway captures money
and the credit fails, the top-up is marked `paid_credit_failed` and surfaces on
a dedicated admin screen. A daily sweep also re-reads pending invoices from the
provider and credits any that were genuinely paid but whose webhook never
arrived — nothing else in the system would ever notice those. An admin can also
resolve one directly with **Verify & credit**, which re-reads the invoice from
the provider first, so a row that was never actually paid cannot be credited.

## Verification performed

**85 automated checks, all passing**, against a real MongoDB.

- **30/30 ledger** — conversion exactness, replayed and *concurrent* top-up
  confirmations crediting once, overdraft rejection, two simultaneous spends of
  the same credit resolving to exactly one winner, frozen-wallet rules,
  mandatory adjustment reasons, ledger summing to the cached balance.
- **17/17 orders** — unfunded placement refused with no order created, exact
  shortfall, wallet payment with correct linkage, cancellation returning the
  full amount, repeated cancellation refunding once, COD left untouched.
- **22/22 refunds & deletion** — return → refund → wallet in one admin action,
  a completed refund refusing to reprocess, the feature flag correctly gating
  refund routing, a wallet-paid order still refunding to the wallet with the
  flag off, deletion refused while a balance is held, and deletion leaving no
  orphaned wallet records once settled.
- **16/16 gift orders** — a broke payer refused *even though the recipient is
  funded*, the payer's balance charged and the recipient's untouched, the
  beneficiary recorded in the ledger, cancellation refunding the payer, a
  frozen payer refused, and the preview falling back to the gateway when the
  feature is off.
- **9/9 HTTP** — authentication scoping on every endpoint, forged webhook
  signature rejected, top-up amount validation.
- Backend boots; frontend production build compiles clean.

### Still not covered by tests

- **The live Fawaterak round trip.** Invoice creation, the redirect, and the
  signed webhook have never run against the real provider — that needs live
  credentials and real money. This is the largest remaining unknown.
- **Manual UI walkthrough.** Every screen builds and is wired, but no one has
  clicked through them in a browser.

## Rollout

1. Deploy. The wallet is **off by default** — nothing changes for customers.
2. Admin → Customer Wallets → enable **Wallet checkout**.
3. Checkout switches to Wallet + Cash on delivery; refunds begin settling to
   wallets automatically.

Before step 2, run the terms migration:

```
node scripts/addWalletTermsClause.js            # dry run
node scripts/addWalletTermsClause.js --apply    # write
```

To roll back, switch `enabled` off. Balances are preserved and remain visible to
customers, and refunds continue to land.

## Resolved since first implementation

- **Refund routing was not gated on the feature flag.** Refunds became store
  credit the moment the code deployed, before the wallet was switched on —
  handing customers credit they could not spend, since checkout was still on
  the gateway. Now gated, with one deliberate exception: an order paid FROM the
  wallet always refunds there, flag or no flag, because there is no card charge
  to reverse.
- **Account deletion with a balance.** A hard delete now REFUSES while the
  customer holds credit, with the amount surfaced in the admin modal and the
  button disabled. The cascade would otherwise have destroyed both the balance
  and the ledger proving it existed. Once settled through the ordinary
  adjustment flow (which forces a reason), deletion proceeds and removes the
  wallet and loyalty records — which were previously left orphaned.
- **Paid-but-uncredited top-ups** now have a one-click **Verify & credit**
  button. It re-reads the invoice from Fawaterak before crediting, so a row
  that was never actually paid cannot be credited by mistake.
- **Terms & Conditions** now carry clause 7.1 (Wallet / Store Credit) in both
  English and Arabic, stating plainly that credit is not redeemable for cash,
  not transferable, and cannot be withdrawn. Apply with
  `node scripts/addWalletTermsClause.js --apply` — a targeted, idempotent
  migration, deliberately NOT the page seeder, which would overwrite every
  policy page and discard CMS edits.

## Open items

- **Vendor-side wallet** was explicitly de-scoped. Vendor subscriptions still
  charge the gateway directly.
- **A live gateway test** should be run in sandbox before enabling the feature,
  since the provider round trip is the one path automated tests cannot reach.
