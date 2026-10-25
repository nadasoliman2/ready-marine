# Paymob integration

ReadyCar takes online payments through **one of two** gateways — Fawaterak or Paymob —
chosen by an admin switch. This is the Paymob half: what it needs configured, how it
differs from Fawaterak, and where each piece lives in the code.

Product decisions and their reasoning: `feature-planner/11-paymob-integration.md`.

---

## 1. The switch

`SiteSettings.payments.provider` — `fawaterak` (default) or `paymob`.
Admin → Wallets → **Payment gateway**. API: `GET/PUT /api/admin/payments/settings`.

**The rule that everything else follows:** the switch is read **only when a payment is
created**. Every later step — the redirect confirmation, the webhook, the nightly sweeps —
reads `provider` off the payment record. Flipping the switch while a customer is sitting
on a Fawaterak page cannot orphan that payment.

`payments.paymob_pilot_user_ids` routes named accounts to Paymob while the switch still
says Fawaterak. That is how Paymob gets rehearsed on the live server without a customer
noticing. Empty it once the switch itself is flipped.

The switch **refuses** to move to a provider whose credentials are blank
(`PROVIDER_NOT_CONFIGURED`), because the first symptom would otherwise be a customer's
failed checkout.

---

## 2. Credentials

All from the **Accept Dashboard**, all into `Backend/.env` (loaded via `env_file` in
`docker-compose.yml`). Mind the test/live toggle in the dashboard's top right.

### Settings → Developers → API Keys

| Env | Dashboard | Notes |
|---|---|---|
| `PAYMOB_SECRET_KEY_TEST` / `_LIVE` | Secret key | Different per mode (`sk_test_…` / `sk_live_…`) |
| `PAYMOB_PUBLIC_KEY_TEST` / `_LIVE` | Public key | Different per mode |
| `PAYMOB_API_KEY` | API key | **Same** for both modes. Only used to mint auth tokens for transaction inquiry |
| `PAYMOB_HMAC_SECRET` | Account/profile page | Signs every callback. Without it every webhook is rejected |

### Settings → Payment Integrations

One numeric id per method per mode — eight in total:

```
PAYMOB_INTEGRATION_CARD_TEST     PAYMOB_INTEGRATION_CARD_LIVE      (required)
PAYMOB_INTEGRATION_WALLET_TEST   PAYMOB_INTEGRATION_WALLET_LIVE
PAYMOB_INTEGRATION_KIOSK_TEST    PAYMOB_INTEGRATION_KIOSK_LIVE
PAYMOB_INTEGRATION_BNPL_TEST     PAYMOB_INTEGRATION_BNPL_LIVE
```

A blank method is simply not offered — a store not yet approved for valU still takes
cards. An id from the **wrong mode** is rejected by Paymob with a 404 that names neither
the id nor the mode, which is why `getMode()` picks the suffix rather than the caller.

### Non-secret config (in `docker-compose.yml`)

```
PAYMOB_MODE=test|live          PAYMOB_BASE_URL=https://accept.paymob.com
PAYMOB_CURRENCY=EGP            PAYMOB_CHECKOUT_URL=https://eg.checkout.paymob.com
```

Never list a secret in compose's `environment:` block — it would override the `env_file`
with an empty value whenever the shell does not export it.

---

## 3. Callback URLs — the constraint that shaped the design

Paymob honours a per-request `notification_url` / `redirection_url` **only for CARD
integration ids**. Mobile wallet, kiosk and BNPL use whatever is saved against the
integration id in Paymob's dashboard — **one URL for the whole merchant account**.

So the four per-flow webhook routes Fawaterak uses cannot carry over. Paymob gets one
endpoint each, and dispatches on a reference we mint:

```
POST  /api/payments/paymob/webhook    settles money (routes/paymobWebhook.js)
GET   /api/payments/paymob/return     routes the browser, settles nothing
```

**On every one of the eight Integration IDs**, set:

| Field | Value |
|---|---|
| Webhook URL | `https://<domain>/api/payments/paymob/webhook` |
| Redirect URL | `https://<domain>/api/payments/paymob/return` |

Same pair for test and live — each payment record carries its own `provider_mode`, so the
server knows which is which. The admin screen prints both URLs with a copy button.

---

## 4. The reference

Every Paymob payment carries `special_reference`, which Paymob echoes back as
`merchant_order_id`:

```
flow:recordId:attempt      e.g.  wallet:68b3f1a2c4d5e6f708192a3b:1
flow ∈ order | wallet | sub | supply
```

The attempt counter is load-bearing: Paymob **rejects a reference it has seen before**,
and `supplyService.retryPayment` reopens a payment on the same order row
(`SupplyOrder.payment.attempt`). A fixed reference would make every retry fail at the
provider.

`paymentFlows.js` turns a reference into `{ load, settle, returnUrl }` for that flow. When
the reference is absent — the browser redirect does not reliably carry it — it falls back
to Paymob's numeric order id, which every flow stores in `invoice_id`.

---

## 5. Field mapping

The four flows persist the same field names under both providers:

| Record field | Fawaterak | Paymob |
|---|---|---|
| `provider` | `fawaterak` | `paymob` |
| `invoice_id` | `invoiceId` | `intention_order_id` (the Paymob order id) |
| `invoice_key` | `invoiceKey` | intention id (`pi_…`) |
| `provider_reference` | `invoiceId` | `special_reference` |
| `payment_url` | `data.url` | assembled: `…/?publicKey=…&clientSecret=…` |

---

## 6. The calls

```
Create      POST https://accept.paymob.com/v1/intention/
            Authorization: Token sk_live_…
            amount is in PIASTRES (150.50 EGP → 15050)
            items must sum exactly to amount, or one balance line is sent instead
            billing_data.first_name / last_name / email / phone_number all required

Checkout    https://eg.checkout.paymob.com/?publicKey=pk_live_…&clientSecret=egy_csk_…

Inquire     POST /api/auth/tokens                         { api_key }        → token
            POST /api/ecommerce/orders/transaction_inquiry { auth_token, order_id }
            (the "the webhook never came" path; tokens cached ~45 min)

Refund      POST /api/acceptance/void_refund/refund  { transaction_id, amount_cents }
            Authorization: Token sk_live_…
            NOT wired up — refunds are still issued by hand from the dashboard.
```

---

## 7. HMAC

`HMAC-SHA512` over the **values** of twenty fields concatenated with **no separator**, in
a fixed order that is not alphabetical. The list lives in `paymobService.HMAC_FIELDS` and
is copied from the docs verbatim — reordering it silently rejects every real callback.

Two shapes, differing in exactly two places:

| | webhook (POST, JSON) | redirect (GET, query) |
|---|---|---|
| transaction | `obj.id` | `id` |
| order | `obj.order.id` | `order_id`, or `order` — both accepted |
| signature | query param `?hmac=` | query param `?hmac=` |

Verified against Paymob's own published sample string in both shapes.

---

## 8. Payment methods per flow

| Flow | card | mobile wallet | kiosk | BNPL | expiry |
|---|:--:|:--:|:--:|:--:|---|
| `order` | ✅ | ✅ | ❌ | ✅ | 6 h |
| `wallet` (top-up) | ✅ | ✅ | ✅ | ❌ | 48 h |
| `sub` | ✅ | ✅ | ❌ | ❌ | 6 h |
| `supply` | ✅ | ✅ | ❌ | ❌ | 6 h |

**Kiosk is on wallet top-ups only, and never on an order.** A kiosk payment issues a
reference the customer may redeem days later. A basket cannot survive that wait — prices
and stock move, and `assertAmountMatches` would refuse to build the order *after* the
customer had handed over cash. Funding a wallet has no basket to go stale, and the
customer then pays the order from their balance instantly.

That is also why wallet top-ups get a 48-hour window (`TOPUP_TTL_HOURS`) while the rest
get six. The cost is cosmetic: an abandoned card top-up shows as pending for two days.

Kiosk payments also arrive `pending: true` before any money moves. The webhook records
that payload for support and leaves the row pending — settling on it would credit a wallet
nobody has funded.

---

## 9. Testing

Paymob has a **real test mode**, unlike Fawaterak whose two mode URLs both point at
production. Money-moving paths can be rehearsed here.

```
Mastercard  5123456789012346   01/39  CVV 123   Test Account
Mastercard  5123450000000008   01/39  CVV 123   Test Account
Visa        4111111111111111   01/39  CVV 123   Test Account
Wallet      01010101010        MPin 123456  OTP 123456
```

Rehearsal on the live server: keep the switch on Fawaterak, set `PAYMOB_MODE=test`, and
put an admin's user id in **Paymob pilot accounts**. Their payments go to Paymob test;
everyone else's go to Fawaterak live.

---

## 10. Known-unverified

1. **Which field carries Paymob's fee.** `gatewayFee.js` tries
   `accept_fees_cents_int` (piastres), then `accept_fees`, then `merchant_commission`.
   All three read `0` in Paymob's published sample because the sample is a test payment.
   **Confirm on the first live payment and delete the warning in that file**, the way the
   Fawaterak fee was confirmed at 4.56 on a 100 EGP card payment.
2. **BNPL redirect.** Docs say `redirection_url` is honoured for card and wallet only. The
   dashboard-configured Redirect URL covers it either way, but confirm by testing.
3. **Kiosk callbacks.** Expected: one `pending` callback when the reference is issued, one
   success when cash is paid. Confirm the first is actually sent.
4. **Kiosk reference lifetime** vs our 48-hour window — lengthen `FLOWS.wallet.expiryHours`
   if Paymob's reference outlives it.
5. **Paymob's commission schedule** is not published; get it from the account manager.

---

## Files

| Path | Role |
|---|---|
| `services/paymobService.js` | The wire protocol: intentions, inquiry, HMAC. Knows nothing about our flows |
| `services/paymentGateway.js` | One door in front of both providers; owns the switch and the reference format |
| `services/paymentFlows.js` | Registry mapping a reference to load / settle / returnUrl |
| `routes/paymobWebhook.js` | The two shared Paymob callbacks |
| `routes/adminPayments.js` | The admin switch API |
| `services/shared/gatewayFee.js` | Reads either provider's fee out of stored payloads |
