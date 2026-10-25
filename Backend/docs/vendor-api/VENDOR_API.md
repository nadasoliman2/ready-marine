# ReadyCar Vendor API

Every HTTP endpoint the **store (vendor)** side of ReadyCar uses: the vendor dashboard on the website, or a separate vendor app. It covers opening a store and signing in, the store profile, products, bundles and ads, receiving and shipping orders, returns, earnings and payouts, the platform subscription, packaging supplies, notifications and support.

**Not covered:** customer endpoints (see the Customer API reference), the admin dashboard, and the company manager portal.

Written from the backend code at commit `f2211b5` (2026-10-11). Responses were built from the code with placeholder store data. When the code changes, this file has to be updated by hand.

**Postman:** `ReadyCar-Vendor-API.postman_collection.json` in this folder has every request below, in the same order. Each request carries its full description from this file and the documented responses as saved examples. Import it, sign in with `POST /api/auth/login-vendor`, and Postman keeps the session cookie for the following requests.

---

## Contents

- [1. Basics](#1-basics)
- [2. Store journeys](#2-store-journeys)
- [3. Sign-in and account](#3-sign-in-and-account)
  - [Sign up and sign in](#sign-up-and-sign-in)
  - [Password reset](#password-reset)
  - [Email and phone verification](#email-and-phone-verification)
  - [Store profile](#store-profile)
- [4. Products](#4-products)
  - [Products](#products)
  - [Catalogue](#catalogue)
  - [Bulk upload](#bulk-upload)
  - [Reference data and image upload](#reference-data-and-image-upload)
- [5. Bundles and ads](#5-bundles-and-ads)
  - [Bundles](#bundles)
  - [Ads](#ads)
- [6. Orders and shipping](#6-orders-and-shipping)
  - [Dashboard](#dashboard)
  - [Parcels](#parcels)
  - [Reviewing items](#reviewing-items)
  - [Preparing and shipping](#preparing-and-shipping)
  - [Smart labels](#smart-labels)
- [7. Returns](#7-returns)
- [8. Earnings and payouts](#8-earnings-and-payouts)
  - [Earnings and wallet](#earnings-and-wallet)
  - [Payouts](#payouts)
- [9. Subscription](#9-subscription)
- [10. Packaging supplies](#10-packaging-supplies)
- [11. Notifications and support](#11-notifications-and-support)
  - [Notifications](#notifications)
  - [Support tickets](#support-tickets)
- [12. Payment provider callbacks](#12-payment-provider-callbacks)
- [Appendix A: Status values](#appendix-a-status-values)
- [Appendix B: Notification types](#appendix-b-notification-types)
- [Appendix C: Known issues](#appendix-c-known-issues)
- [Appendix D: Endpoint index](#appendix-d-endpoint-index)

---

## 1. Basics

### Base URL

| | |
|---|---|
| API | `https://readycar.store/api`. Every path in this file already starts with `/api`, so prefix it with `https://readycar.store`. |
| Uploaded files | `https://readycar.store/uploads/...` |
| Local / server | Backend container `readycar_backend` on port `4001`. |

### Requests and responses

- Request bodies are JSON (`Content-Type: application/json`, up to 10 MB). File uploads are `multipart/form-data`.
- Responses are JSON and gzip-compressed, except the waybill (`GET .../awb`, PDF or HTML) and the bulk-upload template (an `.xlsx` file).
- IDs are 24-character hex MongoDB ObjectIds. Dates are ISO-8601 UTC strings.
- Some collections use `created_at`; others use `createdAt` / `updatedAt`. Each endpoint shows which.
- Many endpoints return a whole database document. Those carry fields you can ignore, such as `__v`. Read only the fields documented for the endpoint.

### Authentication

The session is a JWT in an **httpOnly cookie named `token`** (role `vendor`). The server never reads an `Authorization` header.

- **Web:** send every request with credentials (`fetch(url, { credentials: 'include' })`). CORS allows only `https://readycar.store`.
- **App:** keep a cookie jar. Store the `Set-Cookie` from the sign-in response and send it back on every request.
- Stores and customers use the same cookie name. Signing in as one replaces the other on that device.
- `POST /api/auth/logout` clears the cookie.

These endpoints set the cookie for a store:

| Endpoint | JWT lifetime | Cookie |
|---|---|---|
| `POST /api/auth/login-vendor`, `POST /api/auth/google` (existing store) | 1 day; 30 days with `remember_me` | Session cookie; 30 days with `remember_me` |
| `POST /api/auth/verify-registration-otp`, `POST /api/auth/google/complete` | 1 day | Session cookie |

**Changing the password signs out every session, the current one included.** Both password resets work this way, and neither issues a new cookie, so send the owner to sign in again.

When a protected endpoint refuses the session, the body is `{ "message": "..." }` with no `code`:

| Status | `message` |
|---|---|
| `401` | `Not authorized, no token provided` |
| `401` | `Not authorized, token failed` (invalid or expired token, or a customer token on some routes) |
| `401` | `Not authorized, user not found` |
| `401` | `Not authorized, password was changed` |
| `403` | `Not authorized for this role` (a customer session on a store route) |

**Watch out:** `PUT /api/vendors/wallet/payout-method` answers a wrong password with `401` and `code: "WRONG_PASSWORD"`. The session is still valid. Check `code` before treating a `401` as "signed out".

Each endpoint below has an **Auth** line:

| Auth | Meaning |
|---|---|
| Public | No session needed. |
| Vendor | Needs a store session. |
| User or Vendor | Shared with customers. Documented here from the store's view. |
| Server-to-server | Called by a payment provider, never by the app. |

### Store status and subscription

A store has two separate states. The app must read both and decide what to show, because **the server does not block most routes for either one**.

**Account `status`:** `active` or `suspended`. A store is `active` from the moment it is created; there is no approval step.
- An admin suspension hides the store's page, products and bundles from customers, and blocks Google sign-in (`403 ACCOUNT_SUSPENDED`).
- It does **not** block password sign-in (the response carries `status: "suspended"`) or any store endpoint. Read `status` from the sign-in response or `GET /api/auth/me`, and show the suspended state yourself.

**`subscription_status`:** `active`, `trial_active`, `not_subscribed` (the default, and what the expiry job writes), `cancelled`, `suspended` (set with an admin suspension), `expired` (exists but nothing writes it). Read it from `GET /api/vendors/profile` or `GET /api/vendors/subscription/status`.

| Needs a live subscription | Works without one |
|---|---|
| Creating a product (`POST /api/vendors/products`, even as a draft), and submitting past the plan's `max_products` | Editing existing products, orders and shipping, returns |
| Creating a bundle | Wallet, payouts, packaging supplies |
| Ads other than service ads | Notifications, support, profile |
| Appearing to customers: the store page, product feeds, the stores page, the home slider | |

- Every new store gets the free-trial package automatically, if one is active (`subscription_status: "trial_active"`).
- **When a subscription ends** (daily job at midnight): every published product and bundle goes back to `draft` and disappears from the shop, the store becomes `not_subscribed`, and the store is notified. Reminders go out 7, 3 and 1 day before.
- **When it starts again** (purchase, renew, resubscribe): the hidden products come back without review, unless the store edited them meanwhile.

### Errors

The error body differs by router. Always read `code` when it is present, then fall back to `message`.

| Where | Body |
|---|---|
| Profile, sign-up and sign-in, legacy orders, dashboard stats | `{ "message": "..." }` |
| Parcels, returns (review, receipt), wallet, payouts, subscription, supplies, WhatsApp password reset | `{ "success": false, "code": "...", "message": "..." }` |
| Registration code, Google sign-in, contact verification | `{ "code": "...", "message": "..." }` |
| Notifications, tickets, smart labels, pickups, return lists | `{ "success": false, "message": "..." }` |
| Form validation (register, login, reset) | `400 { "message": "<all messages joined>", "errors": [{ "type", "value", "msg", "path", "location" }] }` |
| Wrong one-time code | adds `"attempts_remaining": n` |
| Unknown route | `404 { "message": "Not Found", "error": {} }` |

Some failures that should be `400` come back as `500`, for example a malformed id on several routes. They are listed per endpoint.

### Rate limits

Almost no store endpoint is rate-limited: only the shared sign-in code, Google and verification endpoints are (shown on each). Over a limit the server answers `429 { "code": "RATE_LIMITED", "message": "Too many requests. Please try again in N seconds." }` with a `Retry-After` header.

### One-time codes (WhatsApp and email)

Registration, WhatsApp password reset and contact verification use the same code rules:

- 6 digits, valid for **10 minutes**. Only the newest code works, and each code works once.
- A new code can be requested **120 seconds** after the last one. Sooner gives `429 OTP_RESEND_COOLDOWN` with `Retry-After`.
- At most **5 codes** in a row. More gives `429 OTP_RESEND_LIMIT`.
- **5 wrong tries** burn the code: `429 OTP_TOO_MANY_ATTEMPTS`.
- Other answers: `400 OTP_INVALID_FORMAT`, `400 OTP_INCORRECT` (with `attempts_remaining`), `404 OTP_NOT_FOUND`, `410 OTP_EXPIRED`, `409 OTP_ALREADY_USED`, `502 OTP_DELIVERY_FAILED`.

### Phone numbers and emails

- A store's phone is stored as typed digits. Sign-in by phone matches those digits exactly: a store saved as `01012345678` is not found with `+201012345678`.
- WhatsApp password reset needs an Egyptian mobile (`01XXXXXXXXX`, `+201XXXXXXXXX` or `00201XXXXXXXXX`).
- Emails are normalised before they are saved or looked up (lowercased; for Gmail, dots and `+tag` are removed). The email the server sends back can differ from what was typed.
- Password: at least 6 characters on sign-up, at least 8 on both password resets.
- Change the email or phone through `/api/users/verification` (with a code), not through `PUT /api/vendors/profile`.

### Money

- Amounts are plain numbers in **Egyptian pounds (EGP)**, not piastres, rounded to 2 decimals.
- A parcel's `merchandise_total` is the goods at list price. ReadyCar keeps a commission (`commission_amount` per item, `commission_total` per parcel).
- **What the store earns per delivered parcel:** `net_amount = merchandise − store's share of the coupon − commission`. Shipping is never part of it.
- A parcel's `cod_amount` is what the courier collects **only on a cash order**. On card, wallet and company orders the courier collects 0, even though `cod_amount` is still filled in.

### Images

- Upload images with `POST /api/upload` first, then send the returned URLs (product images, store image, parcel photos).
- Image URLs come absolute (`https://readycar.store/uploads/...`) or relative (`/uploads/...`). Prefix relative ones with `https://readycar.store`.
- Add `?w=160`, `?w=320`, `?w=480` or `?w=800` to any `/uploads/...` `.jpg`, `.jpeg`, `.png` or `.webp` to get a resized WebP copy.

### Orders and parcels

A customer's order is split into **parcels** (`sub_orders[]`), one per store and pickup branch. A store only ever works with its own parcels; it never sees the order total or other stores' items.

The store moves each parcel through these steps:

| Step | Parcel `status` | What the store does | Call | Next `status` |
|---|---|---|---|---|
| 1. Review | `pending_review` | Mark each item available or not. | `PUT .../items/:itemId`, `approve-all`, `decline-all` | stays `pending_review` |
| 1. Review | `pending_review` | Confirm once every item is decided. | `confirm-items` (or `approve-all` with `confirm: true`) | all approved → `awaiting_tracking` (the courier shipment is created now, unless Smart Label applies). Any declined → `needs_admin`. |
| — | `needs_admin` | Wait: the ReadyCar team calls the customer, then sends the parcel back to review or cancels it. | — | `pending_review` or `cancelled` |
| 2. Waybill | `awaiting_tracking` | Print the waybill (`awb`) and stick it on, or scan a Smart Label sticker. | `awb`, `tracking` (Smart Label: `tracking` with the sticker, or `shipment` then `awb` then `tracking`) | `awaiting_handover` |
| 3. Seal | `awaiting_handover` | Seal the parcel; photos are optional (up to 5). | `photos`, then `ready` | `ready_for_pickup` |
| 4. Courier | `ready_for_pickup` / `pickup_scheduled` | Hand the box to the courier. ReadyCar books the Bosta visit. | `handover` | `handed_to_courier` |
| 5. On the way | `handed_to_courier` → `picked_up` → `in_transit` → `out_for_delivery` → `delivered` | Nothing; the courier updates it. | — | also `returned` or `exception` |

- **Deadline:** every parcel has a `deadline_at` (order time + 48 hours by default) to reach `ready_for_pickup`. A reminder comes 12 hours before. After it, the parcel is flagged `is_overdue`; it is never cancelled automatically.
- **Customer details:** the delivery name, phone and address are hidden while the parcel is in review (`shipping_address: null`) and appear after confirmation. They are also printed on the waybill.
- **Couriers:** ReadyCar chooses the courier (Bosta by default, or Arrive). The store never picks it.
- **Cancelling:** the store cannot cancel a parcel. `cancel-request` asks the ReadyCar team, until the courier has the box.
- **Company orders:** a parcel with `status: "held_in_batch"` is waiting to ship together with colleagues' orders and is hidden from the store until the batch closes.

The parcel list (`GET /api/vendors/sub-orders`) groups parcels into tabs by the action they wait for. All status values are in [Appendix A](#appendix-a-status-values).

### Online payment: the app must confirm

Paying for a subscription or for packaging supplies goes through a hosted payment page (Fawaterak or Paymob). **Nothing is activated until the app confirms.**

1. Create the payment and keep its id (`payment.id` for a subscription, `order._id` for supplies). Open the returned payment URL.
2. The provider sends the browser back to a ReadyCar page, for example `https://readycar.store/dashboard/subscription?payment=success&paymentId=<id>`. **This URL proves nothing.**
3. **Call the confirm endpoint** with the id from step 1, every time, whatever `?payment=` says. `"status": "paid"` means activated; `"status": "pending"` means not paid yet, so retry with backoff for a short time.

| Flow | Create | Confirm | Background job |
|---|---|---|---|
| Subscription | `POST /api/vendors/subscription/purchase` (or `renew`, `resubscribe`, `change-plan`) | `POST /api/vendors/subscription/confirm-payment { "paymentId" }` | **None.** If the app never confirms, the store pays and the plan is never activated. |
| Packaging supplies | `POST /api/vendors/supplies/orders` | `POST /api/vendors/supplies/orders/:id/confirm-payment` | Hourly; it settles orders the app missed. |

In production the Fawaterak "paid" webhook is rejected, which is why the confirm call matters.

### Notifications

Store notifications are stored in English, with no link, and are **not pushed**. Poll `GET /api/vendors/notifications/count` for the badge. Only support tickets have live updates (Socket.io; see [Support tickets](#support-tickets)).

---

## 2. Store journeys

Which endpoints each screen calls, in order. Details are in the sections that follow.

**Open a store**
1. `GET /api/shipping/cities` for the city list (the branch city must match a city `name` exactly).
2. `POST /api/auth/register-vendor` → a 6-digit code by email (default) or WhatsApp.
3. `POST /api/auth/verify-registration-otp` (resend: `POST /api/auth/resend-registration-otp`). The store is created, signed in, and gets the free trial if one exists.
4. Google instead: `POST /api/auth/google` with `role: "vendor"` → `signup_required` → `POST /api/auth/google/complete` with the store details.
5. Confirm the other contact detail: `GET /api/users/verification/status` → `POST /api/users/verification/send` → `POST /api/users/verification/confirm`.

**Sign in**
- `POST /api/auth/login-vendor` (email, store username or phone + password), then `GET /api/auth/me` and `GET /api/vendors/profile`. Check `status` and `subscription_status`.
- Forgot password: `POST /api/auth/forgot-password` with `role: "vendor"` → `POST /api/auth/reset-password`, or `POST /api/auth/forgot-password/otp` → `POST /api/auth/reset-password/otp`.

**Set up the store**
- Profile and pickup branches: `GET /api/vendors/profile` → `PUT /api/vendors/profile` (send back each branch's `_id` and `bosta_location_id`).
- Payout destination: `GET /api/vendors/wallet/payout-method` → `PUT /api/vendors/wallet/payout-method`.

**Add products**
1. Reference data: `GET /api/products/filters?detail=full` (categories, car makes with models, brands), `GET /api/shipping/classes`.
2. Images: `POST /api/upload`.
3. One product: `POST /api/vendors/products`. Or pick from the shared catalogue: `GET /api/vendors/catalog/search` → `GET /api/vendors/catalog/:id` → `POST /api/vendors/products`.
4. Many products: `GET /api/vendors/products/bulk-template` → fill the Excel file → `POST /api/vendors/products/bulk-upload/preview` → `POST /api/vendors/products/bulk-upload/save`.
5. Manage: `GET /api/vendors/products`, `PUT /api/vendors/products/:id`, `DELETE /api/vendors/products/:id`.

**Handle a new order** (every day)
1. Poll `GET /api/vendors/notifications/count`; `new_order_received` means a new parcel.
2. `GET /api/vendors/sub-orders?tab=needs_review` → open one with `GET /api/vendors/orders/:orderId/sub-orders/:subOrderId`.
3. Review: `POST .../approve-all` with `confirm: true`, or decide item by item and `POST .../confirm-items`.
4. Waybill: `GET .../awb` (print it), then `POST .../tracking`.
5. Seal: `POST .../photos` (optional, after `POST /api/upload`), then `POST .../ready`.
6. When the courier takes it: `POST .../handover`.
7. If something goes wrong: `POST .../cancel-request`, or open a ticket with `POST /api/tickets`.

**Handle a return**
`GET /api/vendors/returns` → `GET /api/vendors/returns/:id` → `PUT /api/vendors/returns/:id/review` → when the goods are back, `POST /api/vendors/returns/:id/confirm-receipt`.

**Get paid**
`GET /api/vendors/wallet` (balance and what a withdrawal would pay now) → `POST /api/vendors/wallet/withdrawals` → follow it with `GET /api/vendors/wallet/withdrawals` and `GET /api/vendors/wallet/payouts/:id`. Earnings per parcel: `GET /api/vendors/wallet/earnings`.

**Subscription**
`GET /api/vendors/subscription/status` → `GET /api/vendors/subscription/packages` → `POST /api/vendors/subscription/purchase` (or `renew`, `resubscribe`, `change-plan`) → open `paymentUrl` → `POST /api/vendors/subscription/confirm-payment`.

**Packaging supplies**
`GET /api/vendors/supplies/catalogue` → `POST /api/vendors/supplies/orders` → if `payment_url` is not `null`, open it → `POST /api/vendors/supplies/orders/:id/confirm-payment`.

**Ads and bundles**
- Ads: `POST /api/vendors/ads` → `GET /api/vendors/ads` → `GET /api/vendors/ads/:id/analytics`.
- Bundles: `GET /api/vendors/bundles/eligible-products` → `POST /api/vendors/bundles`.

---

## 3. Sign-in and account

### Sign up and sign in

#### `POST /api/auth/register-vendor`
The owner submits the "open a store" form. No store exists yet. The server stores a pending registration and sends a 6-digit code by email (default) or WhatsApp; the store is created by `POST /api/auth/verify-registration-otp`. Stores never get an email link. No cookie is set. The pending record lives 24 h (`EMAIL_VERIFICATION_TOKEN_TTL_MINUTES`). Any earlier pending vendor registration sharing the email, phone or store username is deleted.

- **Auth:** Public

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Owner's name. Trimmed, non-empty. |
| `store_name` | string | yes | Trimmed, non-empty. |
| `store_username` | string | yes | Trimmed, lowercased, unique among stores. No format rule: spaces, Arabic and symbols are accepted. It is also a login identifier. The public link uses `store_slug`, which is generated from it. |
| `email` | string | yes | Valid email. Canonicalised (see [Phone numbers and emails](#phone-numbers-and-emails)). Unique among stores; a customer account with the same email does not conflict. |
| `phone` | string | yes | Non-digits stripped. Must be non-empty after stripping. No minimum length, no country check. Unique among stores by exact digits. Missing or not a string → `500`. |
| `password` | string | yes | At least 6 characters. |
| `address` | string | yes | Trimmed. The validator needs 5+ characters, but the service needs 6 (exactly 5 → `500`). It becomes the default pickup branch. |
| `shipping_city` | string | yes | Must equal a city `name` from `GET /api/shipping/cities` exactly (English, case-sensitive, e.g. `"Cairo"`, `"Giza"`, `"Alexandria"`). |
| `shipping_country` | string | no | Free text stored on the branch, e.g. `"Egypt"`. |
| `locations` | array | no | Replaces `address` / `shipping_city` as the branch list (the scalars are still required by the validator). Items: `{ address, shipping_city, shipping_country?, is_default?, bosta_location_id? }`. Each needs a 6+ character address and a supported city. The "exactly one default" rule is not applied here. Do not send `bosta_location_id` (see [Known issues](#appendix-c-known-issues)). |
| `verification_channel` | string | no | `"whatsapp"` sends the code to `phone` by WhatsApp. Anything else sends it to `email`. |
| `language` | string | no | `"ar"`, or anything else for English. Language of the code message. |

Example body:
```json
{
  "name": "Karim Hassan",
  "store_name": "Cairo Auto Parts",
  "store_username": "cairoautoparts",
  "email": "karim.store@example.com",
  "phone": "01012345678",
  "password": "secret123",
  "address": "12 Abbas El Akkad St, Nasr City",
  "shipping_city": "Cairo",
  "shipping_country": "Egypt",
  "verification_channel": "whatsapp",
  "language": "ar"
}
```

**Response `201`** (email code):
```json
{
  "message": "We sent a 6-digit code to your email. Enter it to finish creating your store.",
  "verification": {
    "email": "karim.store@example.com",
    "role": "vendor",
    "channel": "email_otp",
    "verification_id": "6708f3a1c2b4e5d6f7a81234",
    "masked_destination": "ka*********@example.com",
    "expires_at": "2026-10-11T10:10:00.000Z",
    "resend_available_at": "2026-10-11T10:02:00.000Z"
  }
}
```
With `"verification_channel": "whatsapp"`, `message` is `"We sent a 6-digit code to your WhatsApp number. Enter it to finish creating your store."`, `channel` is `"whatsapp"` and `masked_destination` looks like `"*******5678"`. `expires_at` is the code's expiry (10 min), not the pending record's.

**Errors:**
- `400` — validation (`{message, errors[]}`): `Owner name is required`, `Store name is required`, `Store username is required`, `Invalid email format`, `Phone is required`, `Address is required`, `Address must be at least 5 characters`, `City is required`, `"<city>" is not a supported shipping city`, `Password must be at least 6 characters`, `Store username already in use`, `Email already in use`, `Phone already in use`.
- `400` — the service found the username, email or phone taken (`{message}`).
- `500` — `{message}` with no `code`:
  - the code could not be sent (`Could not send the email code: …` / `Could not send the WhatsApp code: …`); the pending record is deleted, so a retry is clean;
  - a branch failed the service check (`Address "…" is too short — Bosta needs at least 6 characters.`, `Location "…" has no city. …`, `"<city>" is not a supported shipping city.`, `Every location needs an address.`);
  - `phone` missing or not a string (`{message, error:{}}`).

#### `POST /api/auth/verify-registration-otp`
The owner enters the 6-digit code on the registration screen. This creates the store and signs the owner in.
- **Store creation:** the `Seller` is created with `status: "active"`. Only the channel the code went to is marked verified: an email code sets `email_verified_at`, a WhatsApp code sets `phone_verified_at`.
- **Bosta:** each branch is registered as a Bosta pickup location. A failure is logged and retried by the hourly sweep.
- **Free trial:** assigned if one is configured (see [Store status and subscription](#store-status-and-subscription)).
- **Cookie:** `token` is set as a session cookie with a 1-day JWT.
- **Shared endpoint:** customers use it too, with a different response.

- **Auth:** Public
- **Rate limit:** 30 per 10 min per IP (`register_otp_verify`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `verification_id` | string | yes | From `register-vendor`. Must be a valid ObjectId. |
| `code` | string | yes | Exactly 6 digits. |

**Response `200`**:
```json
{
  "message": "Verified. Your store has been created.",
  "role": "vendor",
  "vendor": {
    "id": "6708f3c9c2b4e5d6f7a81290",
    "store_name": "Cairo Auto Parts",
    "store_username": "cairoautoparts",
    "email": "karim.store@example.com",
    "status": "active",
    "subscription_status": "trial_active",
    "role": "vendor"
  },
  "subscription": {
    "_id": "6708f3c9c2b4e5d6f7a812a0",
    "vendor_id": "6708f3c9c2b4e5d6f7a81290",
    "package_id": "66a0b1c2d3e4f5a6b7c8d9e0",
    "started_at": "2026-10-11T10:03:12.000Z",
    "expires_at": "2026-11-10T10:03:12.000Z",
    "status": "active",
    "auto_renew": false,
    "is_free_trial": true,
    "expiry_reminders_sent": [],
    "is_admin_grant": false,
    "cancelled_at": null,
    "cancellation_reason": null,
    "createdAt": "2026-10-11T10:03:12.000Z",
    "updatedAt": "2026-10-11T10:03:12.000Z",
    "__v": 0
  }
}
```
`subscription` is the new free-trial `VendorSubscription` document (`package_id` not populated), or `null` when no free-trial package is active. In that case `vendor.subscription_status` is `"not_subscribed"`.

**Errors** (`{code, message, attempts_remaining?}`):
- `404` — `VERIFICATION_NOT_FOUND`: id missing or malformed.
- `410` — `VERIFICATION_EXPIRED`: pending record gone or past its expiry.
- `400` — `OTP_INVALID_FORMAT`; `OTP_INCORRECT` (with `attempts_remaining`).
- `404` — `OTP_NOT_FOUND`.
- `410` — `OTP_EXPIRED`.
- `409` — `OTP_ALREADY_USED`.
- `429` — `OTP_TOO_MANY_ATTEMPTS`; `RATE_LIMITED`.
- `400` — `Store username already in use` / `Email already in use` / `Phone already in use` (no `code`): taken while the registration was pending. The code is already spent at this point.
- `500` — anything else (e.g. a duplicate-key race).

#### `POST /api/auth/resend-registration-otp`
"Send the code again" on the registration code screen. The code goes to the same destination by the same channel as the original.

- **Auth:** Public
- **Rate limit:** 10 per hour per IP (`register_otp_resend`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `verification_id` | string | yes | From `register-vendor`. |
| `language` | string | no | `"ar"` or English. |

**Response `200`**:
```json
{
  "message": "A new code is on its way.",
  "verification": {
    "channel": "email_otp",
    "verification_id": "6708f3a1c2b4e5d6f7a81234",
    "masked_destination": "ka*********@example.com",
    "expires_at": "2026-10-11T10:14:00.000Z",
    "resend_available_at": "2026-10-11T10:06:00.000Z"
  }
}
```

**Errors** (`{code, message}`):
- `404` — `VERIFICATION_NOT_FOUND`.
- `410` — `VERIFICATION_EXPIRED`.
- `429` — `OTP_RESEND_COOLDOWN` (with `Retry-After`); `OTP_RESEND_LIMIT`; `RATE_LIMITED`.
- `502` — `OTP_DELIVERY_FAILED`.
- (`409 VERIFICATION_NOT_OTP` exists for customer email-link registrations; a vendor registration never has that channel.)

#### `GET /api/auth/verify-email`
The link in a registration email. **Effectively customer-only today:** a vendor registration is always confirmed by a code, and its link token is never sent. If a pending vendor record with a known token did reach this endpoint, it would create the store exactly as `verify-registration-otp` does: email marked verified, cookie set (session cookie, 1-day JWT). It would then redirect to the vendor login page.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | string | yes | Raw token from the email link. |

**Response `302`**: on success, redirects to `${FRONTEND_URL}/login?verified=1&role=vendor&auto=1`.

**Errors:**
- Any failure redirects to `${FRONTEND_URL}/login?verified=0` (live: `https://readycar.store/login?verified=0`). No body.

#### `POST /api/auth/verify-email`
The JSON version of the email link. Same caveat as the `GET`: no vendor registration produces a usable token today. On success for a vendor record, it would return the same body as `verify-registration-otp`, with the message below.

- **Auth:** Public

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | string | yes | Raw token from the email link. |

**Response `200`**:
```json
{
  "message": "Email verified successfully. Your account has been created.",
  "role": "vendor",
  "vendor": { "id": "6708f3c9c2b4e5d6f7a81290", "store_name": "Cairo Auto Parts", "store_username": "cairoautoparts", "email": "karim.store@example.com", "status": "active", "subscription_status": "trial_active", "role": "vendor" },
  "subscription": null
}
```

**Errors** (`{message}`):
- `400` — `Verification token is required`; `Verification link is invalid or expired`; `… already in use`.
- `500` — anything else.

#### `POST /api/auth/login-vendor`
The owner signs in to the dashboard with a password. Sets the `token` cookie. **A suspended store is signed in normally**, and the dashboard must check `vendor.status`.

- **Auth:** Public

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `identifier` | string | yes | Store email (canonicalised), store username (case-insensitive, trimmed), or phone. The phone has non-digits stripped and must match the stored digits exactly: `+201012345678` does not find a store saved as `01012345678`. |
| `password` | string | yes | Non-empty. |
| `remember_me` | boolean \| `"true"` | no | `true` gives a 30-day JWT and a 30-day cookie. Otherwise the JWT lasts 1 day and the cookie is a session cookie. |

Example body:
```json
{
  "identifier": "karim.store@example.com",
  "password": "secret123",
  "remember_me": true
}
```

**Response `200`**:
```json
{
  "message": "Login successful",
  "vendor": {
    "id": "6708f3c9c2b4e5d6f7a81290",
    "store_name": "Cairo Auto Parts",
    "email": "karim.store@example.com",
    "status": "active",
    "role": "vendor"
  }
}
```
No `store_username`, `phone` or `subscription_status` here. Call `GET /api/auth/me` for those, and `GET /api/vendors/profile` for the subscription status.

**Errors** (`{message}`):
- `400` — validation (`{message, errors[]}`): `Email, phone, or username is required`, `Password is required`.
- `401` — `Invalid credentials`.
- `500` — unexpected error.

#### `POST /api/auth/google`
The owner finishes the Google popup on the vendor login page. The browser posts the Google ID token with `role: "vendor"`. (`GET /api/auth/google/config` → `{ "enabled": true }` tells the page whether to show the button.)
- **Existing store:** if a store matches by `google_id` or email, the owner is signed in. The Google id is linked and `email_verified_at` is stamped if missing.
- **No store:** a `signup_required` handoff is returned, and no cookie is set. Finish it with `/api/auth/google/complete`, which collects the store details.

- **Auth:** Public
- **Rate limit:** 30 per 10 min per IP (`google_auth`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `credential` | string | yes | Google Identity Services ID token (RS256 by Google, `aud` = `GOOGLE_CLIENT_ID`, unexpired, Google-verified email). |
| `role` | string | yes for stores | Must be exactly `"vendor"`. Anything else runs the customer flow. |
| `remember_me` | boolean \| `"true"` | no | Same as `login-vendor`. |

Example body:
```json
{
  "credential": "<Google ID token>",
  "role": "vendor",
  "remember_me": true
}
```

**Response `200`** (signed in):
```json
{
  "message": "Login successful",
  "status": "authenticated",
  "role": "vendor",
  "vendor": {
    "id": "6708f3c9c2b4e5d6f7a81290",
    "store_name": "Cairo Auto Parts",
    "store_username": "cairoautoparts",
    "email": "karim.store@example.com",
    "status": "active",
    "subscription_status": "trial_active",
    "role": "vendor"
  }
}
```

**Response `200`** (no store yet; no cookie):
```json
{
  "status": "signup_required",
  "role": "vendor",
  "signup_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "profile": { "name": "Karim Hassan", "email": "karim.store@example.com", "picture": "https://lh3.googleusercontent.com/a/ACg8ocK..." }
}
```
`signup_token` is valid for 30 minutes and can only create a store.

**Errors** (`{code, message}`):
- `403` — `ACCOUNT_SUSPENDED`: the store is suspended.
- `400` — `GOOGLE_TOKEN_MISSING`; `GOOGLE_EMAIL_MISSING`; `GOOGLE_EMAIL_UNVERIFIED`.
- `401` — `GOOGLE_TOKEN_INVALID`; `GOOGLE_TOKEN_EXPIRED`.
- `502` — `GOOGLE_UNREACHABLE`.
- `503` — `GOOGLE_NOT_CONFIGURED`.
- `429` — `RATE_LIMITED`.
- `500` — `GOOGLE_AUTH_ERROR`: anything else.

#### `POST /api/auth/google/complete`
The owner fills in the store details after a vendor `signup_required` answer. This creates the store and signs the owner in. The fields that matter are chosen by the role inside `signup_token`, not by the body.
- **Created like a registration:** same uniqueness, branch check, Bosta link and free trial as `register-vendor`, but no code is sent.
- **Verified stamps:** `email_verified_at` is set; `phone_verified_at` stays null.
- **No password given:** a random password hash is stored, and "forgot password" adds a real one.
- **Already created:** if the store already exists (by `google_id` or email), that session is returned instead, without `subscription`.
- **Cookie:** session cookie with a 1-day JWT.

- **Auth:** Public
- **Rate limit:** 20 per 10 min per IP (`google_signup_complete`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `signup_token` | string | yes | From `POST /api/auth/google` with `role: "vendor"`. |
| `phone` | string | yes | Non-digits stripped. At least 10 digits. |
| `password` | string | no | If given, at least 6 characters. |
| `store_name` | string | yes | Trimmed, non-empty. |
| `store_username` | string | yes | Trimmed, lowercased. Must be unique (a clash gives `500`, see Errors). |
| `address` | string | yes | Trimmed. At least 6 characters. Becomes the default branch. |
| `shipping_city` | string | yes | Exact city `name` from `GET /api/shipping/cities`. |
| `shipping_country` | string | no | Free text. |
| `language` | string | no | Accepted but unused for stores. |

Example body:
```json
{
  "signup_token": "<signup_token>",
  "phone": "01012345678",
  "password": "secret123",
  "store_name": "Cairo Auto Parts",
  "store_username": "cairoautoparts",
  "address": "12 Abbas El Akkad St, Nasr City",
  "shipping_city": "Cairo",
  "shipping_country": "Egypt"
}
```

**Response `201`**:
```json
{
  "message": "Your account has been created.",
  "status": "authenticated",
  "role": "vendor",
  "vendor": {
    "id": "6708f5e0c2b4e5d6f7a812f0",
    "store_name": "Cairo Auto Parts",
    "store_username": "cairoautoparts",
    "email": "karim.store@example.com",
    "status": "active",
    "subscription_status": "trial_active",
    "role": "vendor"
  },
  "subscription": { "_id": "6708f5e0c2b4e5d6f7a81300", "package_id": "66a0b1c2d3e4f5a6b7c8d9e0", "status": "active", "is_free_trial": true, "expires_at": "2026-11-10T10:05:00.000Z" }
}
```
`subscription` is the full `VendorSubscription` document (as in `verify-registration-otp`) or `null`.

**Errors** (`{code, message}`):
- `410` — `GOOGLE_SIGNUP_EXPIRED`: token missing, invalid or older than 30 min.
- `400` — `INVALID_PHONE`; `WEAK_PASSWORD`; `STORE_NAME_REQUIRED`; `STORE_USERNAME_REQUIRED`; `ADDRESS_REQUIRED`.
- `500` — `GOOGLE_AUTH_ERROR` for:
  - an address under 6 characters, or a missing or unsupported city;
  - `Store username already in use` / `Phone already in use`.
- `429` — `RATE_LIMITED`.

#### `GET /api/auth/me`
The dashboard calls this on load to find out who is signed in, whether the store is suspended, and which contact detail still needs confirming.

- **Auth:** User or Vendor

**Response `200`** (vendor):
```json
{
  "role": "vendor",
  "vendor": {
    "id": "6708f3c9c2b4e5d6f7a81290",
    "store_name": "Cairo Auto Parts",
    "store_username": "cairoautoparts",
    "email": "karim.store@example.com",
    "phone": "01012345678",
    "status": "active",
    "role": "vendor",
    "email_verified": true,
    "phone_verified": false
  }
}
```
No `subscription_status`. Read it from `GET /api/vendors/profile`.

**Errors** (`{message}`):
- `401` — `Not authorized, no token provided` / `token failed` / `user not found` / `password was changed`.

#### `POST /api/auth/logout`
"Sign out" in the dashboard. Clears the `token` cookie. The JWT itself is not revoked and stays valid until it expires.

- **Auth:** Public (no session needed)

**Response `200`**:
```json
{ "message": "Logged out successfully" }
```

### Password reset

#### `POST /api/auth/forgot-password`
"Forgot password" by email on the vendor login page.
- **Link:** if a store has this email, a reset link is emailed: `${FRONTEND_URL}/reset-password?token=…&role=vendor`, valid 60 min. The email greets the owner's `name`.
- **Same answer either way:** the response is identical whether or not the store exists.
- **Cooldown:** another request within 60 s sends nothing new.

- **Auth:** Public

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `role` | string | yes | `"vendor"`. (`"user"` is the customer flow; anything else fails validation.) |
| `email` | string | yes | Valid email. Canonicalised. Looked up among stores only. |
| `language` | string | no | `"ar"` or English. |

Example body:
```json
{
  "role": "vendor",
  "email": "karim.store@example.com",
  "language": "ar"
}
```

**Response `200`**:
```json
{ "message": "If an account exists for this email, a password reset link has been sent." }
```

**Errors:**
- `400` — validation (`{message, errors[]}`): `Account type is required`, `Invalid email format`.
- `500` — unexpected error. A failed email send is logged and still answers `200`.

#### `POST /api/auth/reset-password`
The owner opens the emailed link and sets a new password. The store comes from the token, not the body.
- **On success:** the password is saved, `password_changed_at` is set (signing out every store session, the current one included), and all outstanding reset links are retired.
- **No cookie** is set; the owner signs in again.

- **Auth:** Public

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | string | yes | The link's `token` query parameter. |
| `password` | string | yes | At least 8 characters. |

**Response `200`**:
```json
{ "role": "vendor", "message": "Password has been reset successfully." }
```

**Errors** (`{message}`):
- `400` — validation (`{message, errors[]}`): `Reset token is required`, `Password must be at least 8 characters`; `Password reset link is invalid or expired` (also when the store's email changed since the link was sent).
- `500` — unexpected error.

#### `POST /api/auth/forgot-password/otp`
"Forgot password" by WhatsApp. If the number belongs to a store, a 6-digit code is sent to the store's phone on file. The answer is the same whether or not a store exists. Only Egyptian mobiles work, so a store registered with a foreign number cannot use this.

- **Auth:** Public
- **Rate limit:** 10 per hour per IP (`password_reset_otp_send`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `role` | string | yes for stores | `"vendor"`. Anything else, or omitting it, means customer. |
| `phone` | string | yes | Egyptian mobile in any of `01XXXXXXXXX`, `+201XXXXXXXXX`, `00201XXXXXXXXX`. Matched against every stored spelling of the number. |
| `language` | string | no | `"ar"` or English. |

Example body:
```json
{
  "role": "vendor",
  "phone": "01012345678",
  "language": "ar"
}
```

**Response `200`**:
```json
{
  "success": true,
  "verification": {
    "sent": true,
    "masked_destination": "*******5678",
    "expires_at": "2026-10-11T10:10:00.000Z",
    "resend_available_at": "2026-10-11T10:02:00.000Z"
  }
}
```
When nothing was sent (unknown number, or a delivery failure), `verification` is only `{ "sent": true, "masked_destination": "*******5678" }`.

**Errors** (`{success:false, code, message}`):
- `400` — `INVALID_PHONE`: not an Egyptian mobile.
- `429` — `OTP_RESEND_COOLDOWN` (with `Retry-After`); `OTP_RESEND_LIMIT`; `RATE_LIMITED`.

#### `POST /api/auth/reset-password/otp`
The owner enters the WhatsApp code and a new password.
- **On success:** the password is saved, `password_changed_at` is set (signs out every store session), `phone_verified_at` is stamped if missing, and emailed reset links are retired.
- **No cookie** is set.
- **Unknown number:** fails exactly like a wrong code.

- **Auth:** Public
- **Rate limit:** 30 per 10 min per IP (`password_reset_otp_verify`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `role` | string | yes for stores | `"vendor"`. |
| `phone` | string | yes | Egyptian mobile. |
| `code` | string | yes | Exactly 6 digits. |
| `password` | string | yes | At least 8 characters. |

Example body:
```json
{
  "role": "vendor",
  "phone": "01012345678",
  "code": "123456",
  "password": "newsecret123"
}
```

**Response `200`**:
```json
{ "success": true, "role": "vendor", "message": "Password has been reset successfully." }
```

**Errors** (`{success:false, code, message, attempts_remaining?}`):
- `400` — `WEAK_PASSWORD`; `OTP_INCORRECT` (unknown or invalid number, or a wrong code with `attempts_remaining`); `OTP_INVALID_FORMAT`.
- `404` — `OTP_NOT_FOUND`.
- `410` — `OTP_EXPIRED`.
- `409` — `OTP_ALREADY_USED`.
- `429` — `OTP_TOO_MANY_ATTEMPTS`; `RATE_LIMITED`.
- `500` — `GUEST_CHECKOUT_FAILED`: any uncoded failure (e.g. the store document fails validation on save).

### Email and phone verification

The same four routes serve customers and stores. For a vendor session they read and write the `Seller` document, and every code is scoped to `account_role: "vendor"`, so a store's code can never be spent on a customer account. Codes are addressed to the store name. The dashboard uses these after the first login to confirm whichever detail registration did not prove: email for a WhatsApp signup, phone for an email or Google signup. Error body: `{code, message, attempts_remaining?}`. An uncoded failure answers `400 VERIFICATION_ERROR`.

#### `GET /api/users/verification/status`
The dashboard's "confirm your details" prompt calls this to decide what to ask for. It also lets the prompt resume a staged change.

- **Auth:** User or Vendor

**Response `200`**:
```json
{
  "email": "karim.store@example.com",
  "phone": "01012345678",
  "email_verified": true,
  "phone_verified": false,
  "pending_email": null,
  "pending_phone": null,
  "fully_verified": false,
  "resend_cooldown_seconds": 120
}
```

**Errors:**
- `404` — `USER_NOT_FOUND`.
- `401` / `403` — `protect` failures (`{message}`).

#### `POST /api/users/verification/send`
Sends a code to confirm the store's email (by email) or phone (by WhatsApp).
- **With `value`:** the replacement is staged in `pending_email` / `pending_phone` and the code goes there. The live value is untouched until confirmed.
- **Without `value`:** the code goes to the staged value if there is one, otherwise to the live value.

- **Auth:** User or Vendor
- **Rate limit:** 15 per hour per account (`contact_verify_send`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `target` | string | yes | `"email"` or `"phone"`. |
| `value` | string | no | Replacement. Email must be valid and is canonicalised. Phone has non-digits stripped and needs 10+ digits (stored as digits only, e.g. `201098765432` if typed with `+20`). Must not be live or pending on another **store**. Equal to the current value → nothing staged. |
| `language` | string | no | `"ar"` or English. |

Example body:
```json
{
  "target": "email",
  "value": "karim.new@example.com",
  "language": "ar"
}
```

**Response `200`**:
```json
{
  "message": "Verification code sent.",
  "target": "phone",
  "channel": "whatsapp",
  "masked_destination": "*******5678",
  "expires_at": "2026-10-11T10:10:00.000Z",
  "resend_available_at": "2026-10-11T10:02:00.000Z",
  "delivery_reference": "184223"
}
```
`delivery_reference` is the WhatsApp provider's campaign id, or `null` (always `null` for email).

**Errors:**
- `400` — `INVALID_TARGET`; `INVALID_EMAIL`; `INVALID_PHONE`; `OTP_DESTINATION_REQUIRED`.
- `409` — `EMAIL_IN_USE`; `PHONE_IN_USE`.
- `404` — `USER_NOT_FOUND`.
- `429` — `OTP_RESEND_COOLDOWN` (with `Retry-After`); `OTP_RESEND_LIMIT`; `RATE_LIMITED`.
- `502` — `OTP_DELIVERY_FAILED`.

#### `POST /api/users/verification/confirm`
The owner enters the code. This stamps `email_verified_at` or `phone_verified_at`. If a staged value exists and the code was sent to it, the staged value replaces the live one. Writes an audit-log entry (`contact_email_verified` / `contact_phone_verified`, actor role `vendor`). A new phone is not pushed to the Bosta pickup contact.

- **Auth:** User or Vendor
- **Rate limit:** 30 per 10 min per account (`contact_verify_confirm`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `target` | string | yes | `"email"` or `"phone"`. |
| `code` | string | yes | Exactly 6 digits. |

**Response `200`**:
```json
{
  "message": "Verified successfully.",
  "target": "phone",
  "verified": true,
  "email": "karim.store@example.com",
  "phone": "01012345678",
  "email_verified": true,
  "phone_verified": true
}
```

**Errors:**
- `400` — `INVALID_TARGET`; `OTP_INVALID_FORMAT`; `OTP_INCORRECT` (with `attempts_remaining`); `VERIFICATION_ERROR` (save failed for another reason).
- `404` — `OTP_NOT_FOUND`; `USER_NOT_FOUND`.
- `410` — `OTP_EXPIRED`.
- `409` — `OTP_ALREADY_USED`; `EMAIL_IN_USE` / `PHONE_IN_USE` (claimed by another store between send and confirm).
- `429` — `OTP_TOO_MANY_ATTEMPTS`; `RATE_LIMITED`.

#### `POST /api/users/verification/cancel`
The owner abandons a staged email or phone change. Clears the pending value and any outstanding code for that target.

- **Auth:** User or Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `target` | string | yes | `"email"` or `"phone"`. |

**Response `200`**:
```json
{ "target": "phone", "cancelled": true }
```

**Errors:**
- `400` — `INVALID_TARGET`.
- `404` — `USER_NOT_FOUND`.

### Store profile

#### `GET /api/vendors/profile`
The dashboard's store settings page loads the store record. It is also the only vendor endpoint in this file that returns `subscription_status`. The response is the **whole `Seller` document** without `password` (and without `payout_lock_until`). The main fields are below.

- **Auth:** Vendor

**Response `200`**:
```json
{
  "_id": "6708f3c9c2b4e5d6f7a81290",
  "name": "Karim Hassan",
  "store_name": "Cairo Auto Parts",
  "store_username": "cairoautoparts",
  "store_slug": "cairoautoparts",
  "email": "karim.store@example.com",
  "phone": "01012345678",
  "locations": [
    {
      "_id": "6708f3c9c2b4e5d6f7a81291",
      "address": "12 Abbas El Akkad St, Nasr City",
      "shipping_country": "Egypt",
      "shipping_city": "Cairo",
      "is_default": true,
      "bosta_location_id": "aB3dE5fG7"
    }
  ],
  "store_image": "https://readycar.store/uploads/products/product-1760170000000-123456789.jpg",
  "password_changed_at": null,
  "status": "active",
  "email_verified_at": "2026-10-11T10:03:12.000Z",
  "phone_verified_at": null,
  "pending_email": null,
  "pending_phone": null,
  "subscription_id": "6708f3c9c2b4e5d6f7a812a0",
  "subscription_status": "trial_active",
  "subscription_reason": null,
  "subscription_date": null,
  "suspension_reason": null,
  "suspension_date": null,
  "suspended_by": null,
  "commission_settings": { "is_custom": false, "type": "fixed", "fixed_rate": 0, "category_rates": [] },
  "auto_publish_products": false,
  "public_show_on_vendors_page": true,
  "public_vendors_page_order": 0,
  "public_show_on_home": false,
  "public_home_order": 0,
  "wallet": {
    "available_balance": 0,
    "pending_balance": 0,
    "reserved_balance": 0,
    "frozen_balance": 0,
    "total_withdrawn": 0,
    "total_spent_on_supplies": 0,
    "last_recomputed_at": null
  },
  "completed_orders_count": 0,
  "rating": 0,
  "reviews_count": 0,
  "default_bank_details": { "bank_name": null, "account_holder": null, "account_number": null, "iban": null },
  "payout_method": { "type": null, "issuer": null, "msisdn": null, "bank_card_number": null, "bank_code": null, "full_name": null, "updated_at": null },
  "payout_hold": { "active": false, "reason": null, "by": null, "at": null },
  "payout_schedule": { "enabled": false, "frequency": null, "weekday": null, "interval_weeks": null, "anchor_date": null, "hold_days": null },
  "created_at": "2026-10-11T10:03:12.000Z",
  "__v": 0
}
```
- **`google_id`** appears only when Google is linked.
- **`store_slug`** is the public link (`/store/<store_slug>`). It is generated by the server and never sent by the client.
- **`store_image`** is whatever URL was saved: typically an absolute `/uploads/products/...` URL from `POST /api/upload`, or a relative `/uploads/store-images/...` set by an admin.
- **Visibility flags** (`public_show_on_vendors_page` / `public_show_on_home` and their `_order` fields) are set by the plan or by an admin. The vendor cannot change them.

**Errors:**
- `401` / `403` — `protect` failures (`{message}`).
- `500` — `{message}`.

#### `PUT /api/vendors/profile`
The owner saves the store settings page: owner and store names, username, contact details, store image and pickup branches. Only the seven fields below are read; anything else (visibility flags, `status`, `store_slug`, `auto_publish_products`, `commission_settings`, …) is ignored.

How the update is applied:
- **Partial:** each field is written only when present.
- **Branches replace the whole list:** sending `locations` replaces every branch.
- **Bosta sync:** every branch sent is synced to Bosta. A branch with a `bosta_location_id` updates that Bosta location; a branch without one creates a new Bosta location. A Bosta failure is logged and does not fail the save.
- **Changing `store_username`** regenerates `store_slug`.
- **Email and phone change immediately, with no code**, and the verified stamps are not cleared (see [Known issues](#appendix-c-known-issues)). The dashboard should use `/api/users/verification` for contact changes instead.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | no | Owner's name. Must be non-empty if sent (schema `required`). |
| `store_name` | string | no | Must be non-empty if sent. |
| `store_username` | string | no | Lowercased and trimmed. Unique among stores. No format rule. It is a login identifier, and changing it moves the store's public link. Must be a string. |
| `email` | string | no | Canonicalised, unique among stores. No format validation. |
| `phone` | string | no | Trimmed only (not digit-stripped). Unique by exact string. Must be a string. |
| `store_image` | string \| null | no | Image URL, usually from `POST /api/upload`. Not validated. |
| `locations` | array | no | The full branch list. Each item: `address` (string, 6+ characters after trim), `shipping_city` (exact name from `GET /api/shipping/cities`), `shipping_country` (string, optional), `is_default` (boolean; exactly one item must be `true`), `bosta_location_id` (send back the value from `GET`, or a new Bosta location is created), `_id` (send back to keep the branch id). An empty array should be rejected by the schema's "at least one location" validator (unverified on this update path). |

Example body:
```json
{
  "store_name": "Cairo Auto Parts",
  "store_image": "https://readycar.store/uploads/products/product-1760170000000-123456789.jpg",
  "locations": [
    {
      "_id": "6708f3c9c2b4e5d6f7a81291",
      "address": "12 Abbas El Akkad St, Nasr City",
      "shipping_country": "Egypt",
      "shipping_city": "Cairo",
      "is_default": true,
      "bosta_location_id": "<value from GET /profile>"
    }
  ]
}
```

**Response `200`**:
```json
{
  "message": "Profile updated successfully",
  "profile": {
    "_id": "6708f3c9c2b4e5d6f7a81290",
    "name": "Karim Hassan",
    "store_name": "Cairo Auto Parts",
    "store_username": "cairoautoparts",
    "store_slug": "cairoautoparts",
    "email": "karim.store@example.com",
    "phone": "01012345678",
    "store_image": "https://readycar.store/uploads/products/product-1760170000000-123456789.jpg",
    "locations": [
      { "_id": "6708f3c9c2b4e5d6f7a81291", "address": "12 Abbas El Akkad St, Nasr City", "shipping_country": "Egypt", "shipping_city": "Cairo", "is_default": true, "bosta_location_id": "aB3dE5fG7" },
      { "_id": "6709a0b1c2d3e4f5a6b7c8d9", "address": "45 Mourad St, Dokki", "shipping_country": "Egypt", "shipping_city": "Giza", "is_default": false, "bosta_location_id": "hJ2kL4mN6" }
    ],
    "status": "active",
    "subscription_status": "trial_active"
  }
}
```
`profile` is the whole updated `Seller` document, the same shape as `GET /api/vendors/profile` (shortened here).

**Errors** (all `400 {message}`):
- `Exactly one location must be set as default.`
- `Every location needs an address.`; `Address "…" is too short — Bosta needs at least 6 characters.`; `Location "…" has no city. Pick the city it ships from.`; `"<city>" is not a supported shipping city.`
- `Store username is already taken`; `Email is already taken`; `Phone number is already taken`.
- A Mongoose validation or cast error, e.g. an empty `store_name`, `locations: []`, or `locations` that is not an array. The message is Mongoose's own (unverified wording).
- A `TypeError` message when `store_username` or `phone` is not a string.
- A duplicate-key message on a uniqueness race.

---

## 4. Products

A product goes `draft` → `pending` (waiting for ReadyCar's review) → `published`. A store with `auto_publish_products` (set by an admin) skips the review.

- Sending `status: "published"` (or `"pending"`) submits the product, and the server checks it is complete: part type, one full language set (title, subtitle and description), a price above 0, a category, and at least one image.
- An edit **without** `status` changes a live product and it stays live without review. Send `status` whenever the change should be reviewed.
- A product is visible to customers only while it is `published` and the store is not suspended and has a live subscription.
- Most "Add product" flows start from the shared catalogue: pick an entry, and the form is pre-filled. The store still sets its own price, stock and SKU.

### Products

#### `GET /api/vendors/products`
The store's product table in the dashboard. Returns every product of the store (drafts, pending and published), newest first.

- **Auth:** Vendor

No parameters. No pagination.

**Response `200`:** a bare array of Product documents. `category_id` and `product_brand_id` are populated; `vendor_id` is a plain id.
```json
[
  {
    "_id": "6ac60cc079bcca7bf9036f53",
    "vendor_id": "6a5000000000000000000001",
    "category_id": { "_id": "6a05bf082edec79ade4e7a1b", "name": "Transmission", "name_ar": "ناقل الحركة", "parent_id": "6a05bf082edec79ade4e7a18", "image": "/uploads/categories/transmission-318fc47e80.webp", "sort_order": 0, "is_active": true },
    "product_brand_id": { "_id": "6ac60ab279bcca7bf9036b83", "name": "kor-tec", "image": "https://readycar.store/uploads/products/product-1791363759704-588077197.jpg", "categories": ["6a05bf082edec79ade4e7a55"] },
    "product_brand_source": "Brand",
    "catalog_entry_id": null,
    "title_en": "CV Joint (outer)",
    "title_ar": "كوبلن خارجي",
    "subtitle_en": "Outer CV joint",
    "subtitle_ar": "كوبلن خارجي",
    "description_en": "Outer CV joint.",
    "description_ar": "كوبلن خارجي.",
    "slug_en": "cv-joint-outer-example-motors",
    "slug_ar": "كوبلن-خارجي-example-motors",
    "sku": "SKU-EX-1910",
    "part_number": "0602-0007",
    "gtin": "",
    "part_type": "oem",
    "price": 1160,
    "discount_type": "percentage",
    "discount_value": 5,
    "discount_price": 1102,
    "status": "published",
    "is_published": true,
    "is_active": true,
    "subscription_hidden_at": null,
    "modified_after_subscription_restore": false,
    "catalog_dismissed_at": null,
    "is_universal": false,
    "for_girls": false,
    "for_trunk": false,
    "sold_count": 0,
    "rating": 0,
    "reviews_count": 0,
    "stock_management": true,
    "stock_status": "instock",
    "quantity": 12,
    "images": [{ "_id": "6ac60e5a79bcca7bf9037072", "url": "https://readycar.store/uploads/products/product-1791364697313-727922615.jpg", "is_primary": true }],
    "compatible_cars": [
      { "brand_id": "6a05bf0c876db3938e6feeca", "brand_name": "Volkswagen", "all_models": false,
        "models": [{ "model_id": "6a05bf0c876db3938e6fef4d", "model_name": "Passat", "years": [2004, 2005], "all_years": false }] }
    ],
    "variation_types": [],
    "variants": [],
    "weight": 1.2,
    "dimensions": { "length": 30, "width": 20, "height": 10 },
    "shipping_class_id": null,
    "created_at": "2026-10-07T09:11:28.291Z",
    "__v": 0
  }
]
```

**Errors:**
- `500` — `{message}`.

#### `GET /api/vendors/products/:id`
Loads one of the store's products into the edit form, whatever its status (drafts included).

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | Must be 24 hex characters, or the route does not match (`404 Not Found`). |

**Response `200`:** `{ product }`, the same document as in the list, with `category_id`, `product_brand_id` **and `vendor_id`** populated. `vendor_id` is the full Seller document, including `password` (hash), `wallet`, `commission_settings`, `payout_method` and `default_bank_details`; see [Known issues](#appendix-c-known-issues). Read only `vendor_id._id` / `store_name`.
```json
{
  "product": {
    "_id": "6ac60cc079bcca7bf9036f53",
    "vendor_id": {
      "_id": "6a5000000000000000000001",
      "store_name": "Example Motors",
      "store_username": "example-motors",
      "email": "store@example.com",
      "phone": "01000000000",
      "password": "$2b$10$…",
      "auto_publish_products": false,
      "subscription_status": "active",
      "wallet": { "available_balance": 0, "pending_balance": 0 }
    },
    "category_id": { "_id": "6a05bf082edec79ade4e7a1b", "name": "Transmission", "name_ar": "ناقل الحركة" },
    "title_en": "CV Joint (outer)",
    "status": "draft",
    "price": 1160
  }
}
```

**Errors:**
- `404` — `{message: "Product not found"}`: no such product in this store.
- `500` — `{message}`.

#### `POST /api/vendors/products`
Saves the "Add product" form, either from scratch or after picking a catalogue entry (`catalog_entry_id`). "Save as draft" sends `status: "draft"`; "Publish" sends `status: "published"`. The server decides the real status: `published` if the store has `auto_publish_products`, otherwise `pending` (admin review).

- **Auth:** Vendor, active subscription. The check runs **even for drafts**. Without one: `400 {message: "No active subscription found. Please subscribe to a package to publish products."}` (no `code`).

**Body** (JSON)

| Field | Type | Required | Notes |
|---|---|---|---|
| `title_en`, `subtitle_en`, `description_en` | string | to submit: one full set | A submit needs all three in English **or** all three in Arabic. Titles and subtitles are trimmed. |
| `title_ar`, `subtitle_ar`, `description_ar` | string | to submit: one full set | As above. |
| `sku` | string | No | Default `SKU-<base36 timestamp>`. Not unique in the schema. |
| `part_number` | string | No | Manufacturer part number. Used by catalogue matching. |
| `gtin` | string | No | Barcode / EAN / UPC. |
| `part_type` | string | to submit | `original`, `oem` or `aftermarket`. Also accepted: `genuine`, `o.e.m`, `after market`, `after-market`, `أصلي`, `اصلي`, `أورجينال`, `تجاري`, `بديل` and similar; case-insensitive. Anything else becomes `null`. A submit without a valid value fails. |
| `price` | number | Yes, even for a draft | EGP. Required by the schema, so a draft without it fails with `Price is required`. A submit needs `> 0`. |
| `discount_type` | string | No | `fixed` or `percentage`. Also `percent`, `%` (→ percentage) and `amount` (→ fixed). `""`, `none`, `no` or `null` mean no discount. |
| `discount_value` | number | with `discount_type` | Fixed: `> 0` and less than `price`. Percentage: `> 0` and `< 100`. Ignored when there is no type. |
| `discount_price` | number | — | Derived; do not send. Recomputed on save. |
| `category_id` | ObjectId | Yes, even for a draft | From `GET /api/products/categories`. Should be a leaf category; this path does not check that, nor that the category exists or is active. `""` gives a cast error. |
| `product_brand_id` | ObjectId | No | A hand-entered brand or a car make, from `filters.productBrands`. `""` → `null`. Existence is not checked. `product_brand_source` (`Brand` / `CarBrand`) is set by the server. |
| `is_universal` | boolean | No | `true` = fits every car. Forced to `true` when `compatible_cars` is empty. |
| `compatible_cars` | array | when not universal | `[{ brand_id, brand_name, all_models, models: [{ model_id, model_name, years: [Number], all_years }] }]`. `brand_id`, `brand_name`, `model_id` and `model_name` are required by the schema. Names are stored as sent (not looked up). Ids come from `filters?detail=full` or `/car-brands/:id/models`. |
| `variation_types` | array | No | `[{ name, options: [{ value }] }]`, e.g. Size → S/M/L. The server mints `_id`s for types and options. |
| `variants` | array | No | `[{ price, discount_type, discount_value, stock, selected_options: [{ type_name, option_value }] }]`. `price: null` = use the product price. A variant's discount applies to `variant.price ?? price`, with the same rules as the product discount. When both `variation_types` and `variants` are sent, the server fills each `selected_options[].type_id` / `option_id` by exact (case-sensitive) name match. |
| `stock_management` | boolean | No | Default `true`. |
| `quantity` | number | No | Product-level stock when there are no variants. Default `null`. |
| `stock_status` | string | No | `instock` (default), `outofstock` or `onbackorder`. |
| `weight` | number | No | kg. `""`, negative or non-numeric → `null`. |
| `dimensions` | object | No | `{ length, width, height }` in cm. Each `""`/negative/non-numeric value → `null`. All three null → the field is not stored. |
| `shipping_class_id` | ObjectId | No | From `GET /api/shipping/classes`. `""` → `null`. |
| `images` | array | to submit: ≥ 1 | `[{ url, is_primary }]`, URLs from `POST /api/upload`. The server keeps one primary (the first flagged, else index 0) and moves it to index 0. URLs are not checked. |
| `for_girls` | boolean | No | Lists the product on the "Girls" collection page. Default `false`. |
| `for_trunk` | boolean | No | Lists the product on the "Car Trunk" page (jack, warning triangle, first-aid kit…). Default `false`. |
| `status` | string | No | Omitted or `draft` → saved as `draft`. Any other value → submit: completeness is validated, the plan limit is checked, and the product becomes `published` (auto-publish store) or `pending`. |
| `catalog_entry_id` | ObjectId | No | The catalogue entry picked in `/catalog/search`. Taken out of the body and linked after the save. A merged entry is followed to the surviving one. Without it, a product that is complete and `published` becomes a new `suggested` catalogue entry for admin review. |

Set by the server, whatever is sent: `vendor_id` (from the session), `status`, `is_published`, `slug_en` / `slug_ar`, `discount_price`, `product_brand_source`, image order. **Not protected** (accepted if sent; see [Known issues](#appendix-c-known-issues)): `sold_count`, `rating`, `reviews_count`, `created_at`, `is_active`, `subscription_hidden_at`, `modified_after_subscription_restore`, `catalog_dismissed_at`.

**Slugs:** for each language that has a title, the slug is `<title>-<store_name or store_username>`, lowercased. English keeps `a-z0-9`; Arabic keeps Arabic letters plus `a-z0-9`. Every other run of characters becomes `-`. On collision, `-1`, `-2` and so on is appended. Drafts get slugs too.

**Submit checks**, in order (each fails with `400 {message}`):
1. Part type. Message: `Choose the part type: Original, OEM or Aftermarket.`
2. One full language set.
3. `price > 0`.
4. `category_id` present.
5. At least one image.
6. Plan limit.

```json
{
  "title_en": "Front Brake Pads", "subtitle_en": "Ceramic, low dust", "description_en": "Set of 4 ceramic pads.",
  "sku": "BP-001", "part_number": "04465-02220", "part_type": "aftermarket",
  "price": 950, "discount_type": "percentage", "discount_value": 10,
  "category_id": "6a05bf082edec79ade4e7a1b", "product_brand_id": "",
  "is_universal": false,
  "compatible_cars": [{ "brand_id": "6a05bf0c876db3938e6feeca", "brand_name": "Volkswagen", "all_models": false,
    "models": [{ "model_id": "6a05bf0c876db3938e6fef4d", "model_name": "Passat", "years": [2018, 2019], "all_years": false }] }],
  "stock_management": true, "quantity": 20, "stock_status": "instock",
  "weight": 1.5, "dimensions": { "length": 25, "width": 15, "height": 8 }, "shipping_class_id": "",
  "images": [{ "url": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg", "is_primary": true }],
  "for_girls": false, "for_trunk": false,
  "status": "published"
}
```

**Response `201`:** the saved product. Nothing is populated, and `catalog_entry_id` shows the link (or `null`).
```json
{
  "message": "Product added successfully",
  "product": {
    "_id": "6ad0000000000000000000a1",
    "vendor_id": "6a5000000000000000000001",
    "category_id": "6a05bf082edec79ade4e7a1b",
    "product_brand_id": null,
    "product_brand_source": "Brand",
    "catalog_entry_id": null,
    "title_en": "Front Brake Pads",
    "slug_en": "front-brake-pads-example-motors",
    "sku": "BP-001",
    "part_type": "aftermarket",
    "price": 950,
    "discount_type": "percentage",
    "discount_value": 10,
    "discount_price": 855,
    "status": "pending",
    "is_published": false,
    "is_universal": false,
    "images": [{ "_id": "6ad0000000000000000000a2", "url": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg", "is_primary": true }],
    "created_at": "2026-10-11T10:00:00.000Z"
  }
}
```

**Errors:**
- `400` — no active subscription (message above).
- `400` — submit check failed, e.g. `Please fill in all required fields in at least one language (English or Arabic): title, subtitle, and description.`, `Price is required and must be greater than zero.`, `Category is required.`, `At least one product image is required.`
- `400` — plan limit: `Product limit reached. Your plan (<name>) allows <n> published products. Upgrade or unpublish existing products to add more.` (only on submit; counts `published` products).
- `400` — discount invalid, e.g. `The fixed discount amount must be less than the price.`, `Discount percentage must be less than 100%.`, `Variant 2: …`.
- `400` — Mongoose validation or cast error, e.g. `Product validation failed: price: Price is required`, or `Cast to ObjectId failed for value "" … at path "category_id"`.
- `409` — `DUPLICATE_CATALOG_PRODUCT`: `{ message: "You already have a product on this catalog entry.", code, productId }`. Send the vendor to `productId`.

None of the `400`s carries a `code`.

#### `PUT /api/vendors/products/:id`
Saves the edit form, or the publish/unpublish toggle in the product table (`{ "status": "draft" | "published" }`). Partial update: only the fields sent are written (`$set`).

- **Auth:** Vendor (no subscription or plan-limit check)

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | One of the store's products. No format constraint; a malformed id gives a cast error. |

**Body:** any field from `POST /products`, with these differences.

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | string | No | `published` or `pending` → submit: the stored product merged with the body must pass the submit checks (no plan-limit check). The result is `published` (auto-publish store, also sets `is_published`) or `pending`. `draft` → unpublish now. Omitted → status unchanged and **no re-review**, even on a live product. |
| `part_type` | string | No | If sent, it must be a valid value; `""` or unknown → `400`. It cannot be cleared. |
| `price` | number | No | A new price re-derives the stored discount (and variant discounts) against it. Not range-checked unless submitting (see [Known issues](#appendix-c-known-issues)). |
| `discount_type` / `discount_value` | | No | Validated against the new price if sent, else against the stored price. |
| `images` | array | No | Omit to keep the stored images. An empty array is stored as empty. |
| `dimensions` | object | No | All-empty values do not clear stored dimensions. |
| `title_en` / `title_ar` | string | No | A changed title regenerates that slug (the old URL stops working). A product with no slug gets one from its title. |
| `vendor_id`, `is_published`, `catalog_entry_id` | — | — | Dropped. The catalogue link can only be changed by an admin. |

Example body:
```json
{
  "price": 900,
  "discount_type": "percentage",
  "discount_value": 5,
  "status": "published"
}
```

If the product was hidden by a subscription lapse (`subscription_hidden_at` set), any edit sets `modified_after_subscription_restore: true`. Renewal will then leave it in `draft`, and it must be re-submitted.

**Response `200`:** `{ message: "Product updated successfully", product }`, the updated document, not populated. A status change is also written to the product audit log.

**Errors:**
- `400` — `Product not found or unauthorized`.
- `400` — submit check, part type or discount messages, as on create (no `code`).
- `400` — Mongoose validation or cast error, e.g. a `status` outside `draft`/`pending`/`published`.

#### `DELETE /api/vendors/products/:id`
The "Delete" action in the product table. A hard delete: the document is removed. Nothing checks for bundles, ads or carts that reference it.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | One of the store's products. |

**Response `200`:** the deleted document.
```json
{ "message": "Product deleted successfully", "product": { "_id": "6ad0000000000000000000a1", "title_en": "Front Brake Pads", "status": "draft" } }
```

**Errors:**
- `500` — `{message: "Product not found or unauthorized"}` (not-found comes back as 500), or a cast error for a malformed id.

### Catalogue

The shared master catalogue describes parts (title, images, category, brand, compatibility, variation types). Every "Add product" flow in the dashboard starts with a catalogue search. Picking an entry pre-fills the form; the vendor still sets price, stock and SKU. Vendors can only read the catalogue. Entries with status `approved` and `suggested` are searchable.

#### `GET /api/vendors/catalog/search`
The search box at the top of "Add product". Each result says whether this store already sells the entry, so the UI can show "Open your product" instead of "Select".

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `q` | string | No | Case-insensitive substring match on `title_en`, `title_ar`, `subtitle_en`, `subtitle_ar`, `part_number`, `gtin`. Regex characters are escaped. Empty = browse. |
| `category_id` | ObjectId | No | Exact category (not its subtree). Invalid ids are ignored. |
| `product_brand_id` | ObjectId | No | Exact brand. Invalid ids are ignored. |
| `page` | integer | No | Default 1, minimum 1. |
| `limit` | integer | No | Default 20, clamped to 1–50. |

Sort: `approved` entries first, then `suggested`; newest first within each.

**Response `200`:** each entry is the full CatalogEntry document (`category_id` and `product_brand_id` populated) plus `vendor_product_id`.
```json
{
  "entries": [
    {
      "_id": "6ab1000000000000000000c1",
      "title_en": "Front Brake Pads",
      "title_ar": "تيل فرامل أمامي",
      "subtitle_en": "Ceramic",
      "subtitle_ar": "سيراميك",
      "description_en": "Set of 4 pads.",
      "description_ar": "طقم 4 قطع.",
      "category_id": { "_id": "6a05bf082edec79ade4e7a1b", "name": "Brake Pads", "name_ar": "تيل الفرامل" },
      "product_brand_id": { "_id": "6ac60ab279bcca7bf9036b83", "name": "kor-tec" },
      "product_brand_source": "Brand",
      "part_number": "04465-02220",
      "gtin": "",
      "images": [{ "_id": "6ab1000000000000000000c2", "url": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg", "is_primary": true }],
      "is_universal": true,
      "compatible_cars": [],
      "variation_types": [],
      "status": "approved",
      "merged_into": null,
      "created_by_role": "vendor",
      "created_by_vendor_id": "6a5000000000000000000009",
      "source_product_id": "6ad0000000000000000000f1",
      "created_at": "2026-09-01T08:00:00.000Z",
      "updated_at": "2026-09-02T08:00:00.000Z",
      "__v": 0,
      "vendor_product_id": null
    }
  ],
  "pagination": { "total": 1, "page": 1, "pages": 1, "limit": 20 }
}
```
- `vendor_product_id` is the id of this store's product on the entry, or `null`.
- `status: "suggested"` means the entry is still under admin review. It is still selectable.
- `created_by_role`, `created_by_vendor_id` and `source_product_id` are admin-only provenance (see [Known issues](#appendix-c-known-issues)).

**Errors:**
- `500` — `{message}`.

#### `GET /api/vendors/catalog/filters`
The category and brand dropdowns beside the catalogue search. They list only categories and brands that actually have searchable entries, with counts. Each list narrows to the other selection.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `category_id` | ObjectId | No | With it, `brands` counts only entries in this category, and drops brands whose category tags exclude it. Untagged brands stay. |
| `product_brand_id` | ObjectId | No | With it, `categories` counts only this brand's entries and, if the brand has category tags, keeps only those categories (and their subtrees). |

**Response `200`:** each list sorted by `count`, highest first. Brands have one name, copied into both fields.
```json
{
  "categories": [{ "_id": "6a05bf082edec79ade4e7a1b", "count": 12, "name_en": "Brake Pads", "name_ar": "تيل الفرامل" }],
  "brands": [{ "_id": "6ac60ab279bcca7bf9036b83", "count": 4, "name_en": "kor-tec", "name_ar": "kor-tec" }]
}
```

**Errors:**
- `500` — `{message}`.

#### `GET /api/vendors/catalog/:id`
Opens the condensed "Add product" form after the vendor picks an entry: the entry, the product fields it pre-fills, and the store's existing product on it, if any.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | 24 hex characters, or the route does not match (`404 Not Found`). A `merged` entry is followed to the entry it was merged into. `archived` and `rejected` entries are returned too. |

**Response `200`:**
```json
{
  "entry": { "_id": "6ab1000000000000000000c1", "title_en": "Front Brake Pads", "status": "approved", "category_id": { "_id": "6a05bf082edec79ade4e7a1b", "name": "Brake Pads" } },
  "prefill": {
    "title_en": "Front Brake Pads", "title_ar": "تيل فرامل أمامي",
    "subtitle_en": "Ceramic", "subtitle_ar": "سيراميك",
    "description_en": "Set of 4 pads.", "description_ar": "طقم 4 قطع.",
    "category_id": "6a05bf082edec79ade4e7a1b",
    "product_brand_id": "6ac60ab279bcca7bf9036b83",
    "part_number": "04465-02220", "gtin": "",
    "images": [{ "url": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg", "is_primary": true }],
    "is_universal": true,
    "compatible_cars": [],
    "variation_types": [{ "name": "Size", "options": [{ "value": "S" }, { "value": "M" }] }]
  },
  "vendor_product_id": null
}
```
- `entry` is the same document shape as in search.
- `prefill` is ready to merge into the product form. It has no sub-document `_id`s, and empty strings stand in for missing values.
- Post the product with `catalog_entry_id: entry._id`.
- When `vendor_product_id` is set, a create on this entry will answer `409 DUPLICATE_CATALOG_PRODUCT`.

**Errors:**
- `404` — `{message: "Catalog entry not found"}`.
- `500` — `{message}`.

### Bulk upload

The store can add many products at once in two ways:

- **Excel** — a downloaded template. The dashboard flow is `GET /products/bulk-template` → fill in → `POST /products/bulk-upload/preview` (parse and propose catalogue matches; nothing is saved) → the vendor confirms or changes each match → `POST /products/bulk-upload/save`. `POST /products/bulk-upload` is the older one-shot path, without review.
- **Online grid** — `POST /products/bulk-json`.

All paths share one per-row validator (below). Valid rows are saved. **Invalid rows are still saved as drafts** with whatever fields passed, and reported in `failed`. Requested status `published` becomes `published` on an auto-publish store, otherwise `pending`; anything else becomes `draft`. No bulk path checks the subscription or the plan limit.

**Row rules** (all paths). Each problem becomes `{ field, message }` in that row's `errors`:

| Field | Rule |
|---|---|
| `SKU` | Required. |
| `Price` | Required, `> 0`. |
| `Is Universal?` | Required, `TRUE` / `FALSE` (a boolean in JSON). |
| `Part Type` | Required: Original / OEM / Aftermarket, aliases as on the form. |
| `Content` | All three of title, subtitle and description in English **or** in Arabic. |
| `Category` | Required. Must exist and be a **leaf** category. |
| `Product Brand` | Optional. Must exist if given. |
| `Compatible Cars` | Each brand, model and year must exist (names are filled in from the database). Must be filled when not universal, and empty when universal. |
| `Discount Type` / `Discount Value` | Same discount rules as the form. A value with no type is an error. |
| `Variants` | Each `Type=Value` must match a declared option, case-insensitive. Variant discounts follow the same rules. |
| `Quantity` | A non-negative integer when stock management is on and there are no variants. With variants, `quantity` is set to `null`. |
| `Catalog` | Duplicate entry: the store already sells the matched entry, or the batch uses it twice. |
| `Database` | Save error on an otherwise valid row. Nothing is saved for that row. |
| Shipping class | An unknown shipping class is ignored, not an error. |

Images are not required.

**Response `200`** (the same shape for `bulk-upload`, `save` and `bulk-json`; `200` even when every row failed):
```json
{
  "succeeded": [{ "row": 6, "_id": "6ad0000000000000000000b1", "title": "Front Brake Pads", "sku": "BP-001" }],
  "failed": [
    {
      "row": 7,
      "sku": "BP-002",
      "title": "Rear Brake Pads",
      "errors": [{ "field": "Category", "message": "Category \"Brakes\" has subcategories — choose a final (most specific) category." }],
      "savedAsDraft": true,
      "draftId": "6ad0000000000000000000b2"
    }
  ]
}
```
- `row` is the Excel row number on the one-shot path. On `save` and `bulk-json` it is the 1-based position in `products[]`.
- On a `Database` failure, `savedAsDraft` is `false` and there is no `draftId`.

#### `GET /api/vendors/products/bulk-template`
The "Download template" button. Builds the Excel template on the fly with live dropdown lists.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `lang` | string | No | `ar` → Arabic labels, hints and right-to-left sheet. Anything else → English. Dropdown values stay in English either way. |

**Response `200`:** the file itself, not JSON.
- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename="product_bulk_upload_template.xlsx"` (`product_bulk_upload_template_ar.xlsx` for `ar`)

The workbook has these sheets:
- **`Products`** — where rows go. Rows 1–5 are headers; data starts at **row 6**. 200 rows are pre-formatted; there is no row limit.
- **`Instructions`**
- **`Car Brands (Reference)`** — car make id, make name, model id, model name, years.
- **`Lists`** — very hidden; the source of the dropdowns: leaf active categories as full paths, brands, shipping classes.

**`Products` columns.** The parser reads columns by position, so the order must not change.

| Col | Header | Required | Format |
|---|---|---|---|
| A | SKU | Yes | Text. |
| B | Part Number | No | |
| C | GTIN | No | |
| D–F | Title / Subtitle / Description (EN) | one full set | |
| G–I | Title / Subtitle / Description (AR) | one full set | |
| J | Price | Yes | Number, EGP. |
| K | Discount Type | No | `fixed` / `percentage` (dropdown). |
| L | Discount Value | No | Amount off, or percent off. |
| M | Status | No | `draft` / `published`. Blank or other → `draft`. |
| N | Category Path | Yes | Dropdown, e.g. `Brakes > Brake Pads`. The English or Arabic path, or a raw category id. |
| O | Product Brand | No | Dropdown name, or a brand id. |
| P | Is Universal? | Yes | `TRUE` / `FALSE`. |
| Q | Compatible Cars | when not universal | `BRAND_ID:MODEL_ID:2019,2020 \| BRAND_ID:MODEL_ID:ALL`. Ids only, from the reference sheet. |
| R | Stock Mgmt | No | `TRUE` / `FALSE`. Blank → `TRUE`. |
| S | Quantity | when tracked and no variants | Integer. |
| T | Stock Status | No | `instock` (default) / `outofstock` / `onbackorder`. |
| U | Image URLs | No | Comma-separated full URLs. A `*` straight after a URL marks it primary. |
| V | Options | No | `Color:Red,Blue ; Size:S,M`. |
| W | Variants | No | `Color=Red\|Size=S::price=49.99::discount_type=percentage::discount_value=20::stock=10 \|\| Color=Blue::stock=5`. Older `discount_price=` is converted to a fixed discount. |
| X | Weight (kg) | No | Number. |
| Y | Dimensions (cm) | No | `LxWxH`; `x`, `*`, `,` or `×` separators. |
| Z | Shipping Class | No | Dropdown name (English or Arabic), or an id. |
| AA | Part Type | Yes | `Original` / `OEM` / `Aftermarket`. |

The `for_girls` / `for_trunk` flags are not in the sheet; Excel rows always get `false`. Older templates with a single "Discount Price" column (detected from the row-4 header in column K) are still accepted. The sale price is converted to an equivalent fixed discount. Those sheets have no Part Type column, so their rows fail with a pointer to the new template.

**Errors:**
- `500` — `{message: "Failed to generate template"}`.

#### `POST /api/vendors/products/bulk-upload/preview`
"Upload file" on the bulk-upload page. Parses the workbook and proposes one catalogue entry per row for the "Review links" screen. **Saves nothing.**

- **Auth:** Vendor

**Body** (`multipart/form-data`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | file | Yes | One `.xlsx` file (checked by extension only), at most 5 MB, kept in memory. It must contain a sheet named `Products`. |

**Matching:** candidates are `approved` and `suggested` entries (up to 5,000). The first rule that matches wins:
1. Same part number, ignoring punctuation and case.
2. Same GTIN.
3. Best title-word overlap, at least 60% of the shorter title. A matching brand adds 0.1; a different brand rules the entry out.

Nothing is linked automatically.

**Response `200`:**
```json
{
  "rows": [
    {
      "row": 6,
      "data": {
        "sku": "BP-001", "part_number": "04465-02220", "gtin": null,
        "part_type": "aftermarket", "part_type_raw": "Aftermarket",
        "title_en": "Front Brake Pads", "subtitle_en": "Ceramic", "description_en": "Set of 4 pads.",
        "title_ar": null, "subtitle_ar": null, "description_ar": null,
        "price": 950, "discount_type": null, "discount_value": null, "status": "published",
        "category_id": "6a05bf082edec79ade4e7a1b", "category_raw": "Brakes > Brake Pads",
        "product_brand_id": null, "product_brand_raw": "",
        "is_universal": true, "compatible_cars": [],
        "stock_management": true, "quantity": 20, "stock_status": "instock",
        "weight": 1.5, "dimensions": { "length": 25, "width": 15, "height": 8 },
        "shipping_class_id": null, "shipping_class_raw": "",
        "for_girls": false, "for_trunk": false,
        "variation_types": [], "variants": [],
        "images": [{ "url": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg", "is_primary": true }]
      },
      "summary": { "sku": "BP-001", "title": "Front Brake Pads", "part_number": "04465-02220", "part_type": "aftermarket", "price": 950 },
      "match": {
        "entry_id": "6ab1000000000000000000c1",
        "title": "Front Brake Pads",
        "image": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg",
        "category": "Brake Pads",
        "brand": "kor-tec",
        "status": "approved",
        "reason": "part_number"
      }
    }
  ],
  "counters": { "total": 1, "matched": 1, "unmatched": 0 }
}
```
- `row` is the Excel row.
- `data` is the parsed row, in the shape `/bulk-upload/save` accepts. Post it back with `catalog_entry_id` set to the confirmed entry, or `null` for "new product".
- `match.reason` is `part_number`, `gtin` or `title`. `match` is `null` when nothing matched.
- An unrecognised Category or Brand cell comes back with `category_id` / `product_brand_id` `null`. Its text survives only in `*_raw`, and `save` does not read that (see [Known issues](#appendix-c-known-issues)).

**Errors** (`400 {message}`):
- `Only .xlsx files are accepted.`
- `File too large` (over 5 MB)
- `Unexpected field` (wrong field name)
- `No file uploaded. Please attach an .xlsx file with field name "file".`
- `Invalid .xlsx file — could not parse the workbook.`
- `Sheet named "Products" not found in the uploaded file.`
- `No data rows found (data must start at row 6).`

#### `POST /api/vendors/products/bulk-upload/save`
"Save" on the "Review links" screen. It saves the rows the vendor confirmed, each with the chosen catalogue entry.

- **Auth:** Vendor

**Body** (JSON)

| Field | Type | Required | Notes |
|---|---|---|---|
| `products` | array | Yes | 1–**2000** rows, each a preview `data` object plus `catalog_entry_id`. Field rules are as in `/bulk-json`. |
| `products[].catalog_entry_id` | ObjectId | No | Confirmed entry. Its catalogue fields fill any blank fields in the row, and the vendor's values win; the filled row must then pass the row rules. `null` = new product: it becomes a catalogue suggestion if it is published and complete. |

Example body:
```json
{
  "products": [
    {
      "sku": "BP-001",
      "part_type": "aftermarket",
      "title_en": "Front Brake Pads",
      "subtitle_en": "Ceramic",
      "description_en": "Set of 4 pads.",
      "price": 950,
      "status": "published",
      "category_id": "6a05bf082edec79ade4e7a1b",
      "is_universal": true,
      "stock_management": true,
      "quantity": 20,
      "catalog_entry_id": null
    }
  ]
}
```

**Response `200`:** the bulk result above. `row` = position in `products[]` (1-based).

**Errors** (`400 {message}`):
- `No products provided.`
- `Too many products: <n>. Maximum is 2000 per submission.`
- `Vendor not found.`

#### `POST /api/vendors/products/bulk-json`
"Save all" on the online bulk-entry grid. The grid caps itself at 200 rows, and so does the server.

- **Auth:** Vendor

**Body** (JSON): `{ "products": [ … ] }`, 1–**200** rows. Each row:

| Field | Type | Required | Notes |
|---|---|---|---|
| `sku` | string | Yes | |
| `part_number`, `gtin` | string | No | |
| `part_type` | string | Yes | As on the form. `part_type_raw` (optional) is only used in the error text. |
| `title_en`, `subtitle_en`, `description_en`, `title_ar`, `subtitle_ar`, `description_ar` | string | one full set | |
| `price` | number | Yes | `> 0`. |
| `discount_type`, `discount_value` | | No | As on the form. |
| `status` | string | No | `draft` or `published`. Anything else, including `pending`, → `draft`. |
| `category_id` | ObjectId | Yes | Must be a leaf. A malformed id is reported as "required". |
| `product_brand_id` | ObjectId | No | Must exist. |
| `is_universal` | boolean | Yes | A non-boolean is an error. |
| `compatible_cars` | array | when not universal | Same shape as the form. `brand_name` / `model_name` are filled from the database. |
| `stock_management` | boolean | No | Non-boolean → `true`. |
| `quantity` | integer | when tracked and no variants | |
| `stock_status` | string | No | Default `instock`. |
| `images` | array | No | `[{ url, is_primary }]`, stored as sent (not normalised). |
| `variation_types`, `variants` | array | No | Same shapes as the form. Option matching is case-insensitive. |
| `weight` | number | No | |
| `dimensions` | object | No | `{ length, width, height }`. |
| `shipping_class_id` | ObjectId | No | Unknown → ignored. |
| `for_girls`, `for_trunk` | boolean | No | |
| `catalog_entry_id` | ObjectId | No | Entry picked in the grid's catalogue popup. Same behaviour as in `save`. |

Example body:
```json
{
  "products": [
    {
      "sku": "BP-001",
      "part_type": "aftermarket",
      "title_en": "Front Brake Pads",
      "subtitle_en": "Ceramic",
      "description_en": "Set of 4 pads.",
      "price": 950,
      "status": "published",
      "category_id": "6a05bf082edec79ade4e7a1b",
      "is_universal": true,
      "stock_management": true,
      "quantity": 20,
      "images": [
        {
          "url": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg",
          "is_primary": true
        }
      ]
    }
  ]
}
```

**Response `200`:** the bulk result above.

**Errors** (`400 {message}`):
- `No products provided.`
- `Too many products: <n>. Maximum is 200 per submission.`

#### `POST /api/vendors/products/bulk-upload`
One-shot Excel import: it parses and saves in one call, with no review step. The vendor dashboard no longer calls it (it uses preview → save), but the route is live. Rows are never linked to a catalogue entry; each complete published row becomes a suggestion.

- **Auth:** Vendor

**Body** (`multipart/form-data`): `file`, as in preview. There is no row limit.

**Response `200`:** the bulk result above. `row` = Excel row number. This path correctly reports "Discount Value without Discount Type", unknown brands and unknown categories.

**Errors:** the same `400 {message}` list as preview.

### Reference data and image upload

Shared public endpoints. The product form, bundle builder and bulk grid load these before they render.

#### `GET /api/products/categories`
The full tree of active categories, used by the nested category picker in the product form. Each level is sorted by `sort_order`, then `name`. Only active categories are loaded, so an active child of an inactive parent does not appear anywhere. A product should be filed under a **leaf** (a node with empty `subcategories`). The bulk paths enforce this; the single form does not.

- **Auth:** Public

No parameters.

**Response `200`:** a bare array of root categories. Each node is the full Category document plus a recursive `subcategories` array.
```json
[
  {
    "_id": "6a05bf082edec79ade4e79b1",
    "name": "Car Accessories",
    "name_ar": "إكسسوارات السيارات",
    "parent_id": null,
    "image": "/uploads/categories/car-accessories-891f8b1e7b.webp",
    "sort_order": 0,
    "is_active": true,
    "createdAt": "2026-05-14T12:24:40.744Z",
    "updatedAt": "2026-05-14T12:24:40.744Z",
    "__v": 0,
    "subcategories": [
      {
        "_id": "6a9c06bd7ec1f59e3855c7bd",
        "name": "Car Furniture",
        "name_ar": "أثاث السيارات",
        "parent_id": "6a05bf082edec79ade4e79b1",
        "image": "https://readycar.store/uploads/products/product-1788776429048-865360031.webp",
        "sort_order": 0,
        "is_active": true,
        "createdAt": "2026-09-05T12:10:37.177Z",
        "updatedAt": "2026-09-07T10:20:33.981Z",
        "__v": 0,
        "subcategories": []
      }
    ]
  }
]
```

**Errors:**
- `500` — database error, `{message}`.

#### `GET /api/products/filters`
Everything the product form needs in one call: the category tree, car makes (for the compatibility builder) and product brands (for the brand picker). The vendor and admin product forms call it with **`detail=full`**, because the compatibility builder lets the vendor tick models and years across several makes at once. The response is cached in memory for 5 minutes per `parts`/`detail` combination (cleared whenever an admin edits this data) and sent with `Cache-Control: public, max-age=120`.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `parts` | string | No | Comma-separated subset of `categories`, `carBrands`, `productBrands`, `productTypes` (case-sensitive). Omitted or empty = all four. Unknown names are ignored. If none of the names is valid, the response is `{}`. |
| `detail` | string | No | `full` embeds every make's `models[].years[]`: 115 makes, about 3,400 models and 111,000 model-years, about 2 MB uncompressed. Any other value = slim: makes without `models`, plus `model_count`. |

**Response `200`** (`detail=full`):
```json
{
  "categories": [
    { "_id": "6a05bf082edec79ade4e79b1", "name": "Car Accessories", "name_ar": "إكسسوارات السيارات", "parent_id": null, "image": "/uploads/categories/car-accessories-891f8b1e7b.webp", "sort_order": 0, "is_active": true, "subcategories": [] }
  ],
  "carBrands": [
    { "_id": "6a05bf09876db3938e6e5f4c", "name": "Acura", "image": "/uploads/car_brands/acura-08ef554248.png", "is_featured": false,
      "models": [{ "_id": "6a05bf09876db3938e6e5f4d", "name": "ADX", "years": [{ "year": 2024 }, { "year": 2025 }] }],
      "createdAt": "2026-05-14T12:24:41.301Z", "updatedAt": "2026-05-14T12:24:41.301Z", "__v": 0 }
  ],
  "productBrands": [
    { "_id": "6a05bf09876db3938e6e5f4c", "name": "Acura", "image": "/uploads/car_brands/acura-08ef554248.png", "categories": [], "source": "CarBrand", "is_car_brand": true },
    { "_id": "6a84f8ac572abc6c77dc9165", "name": "ago parts pro", "createdAt": "2026-08-19T00:28:28.218Z", "updatedAt": "2026-08-19T00:28:28.218Z", "__v": 0, "source": "Brand", "is_car_brand": false }
  ]
}
```
- `categories` is the same tree as `/categories`. Each category also carries `type_ids`: the product types it is offered under.
- `productTypes` are the broad, shopper-facing groupings the home page's search offers (Spare parts, Routine maintenance, Accessories, Car care, Tools, Tyres & wheels): `[{ _id, name, name_ar, image, sort_order, category_ids, product_count }]`, sorted by `sort_order`. `category_ids` are the categories assigned to the type (any level; a category can be in several types), shown as the type's cards. Only active types with live products are listed. Filter the shop by one with `GET /api/products?type_id=`.
- `carBrands[]._id` and `models[]._id` are the `brand_id` / `model_id` for `compatible_cars`; `name` fills `brand_name` / `model_name`.
- `productBrands` merges hand-entered brands (`source: "Brand"`) and every car make (`source: "CarBrand"`) into one list sorted by name. Either kind of `_id` goes in `product_brand_id`. A make whose name also exists as a hand-entered brand appears once, as the hand-entered one.
- A brand's `categories` lists the category ids it is tagged for. An empty or missing list means "untagged, show everywhere". Use it to narrow the brand picker to the chosen category.
- Without `detail=full`, car brands have no `models` and carry `model_count` instead.

**Errors:**
- `500` — `{message}`.

#### `GET /api/products/car-brands/:id/models`
Models and years for one car make. Use it when a form needs only one make expanded, instead of loading `filters?detail=full`. Sent with `Cache-Control: public, max-age=300`.

- **Auth:** Public

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | Car make `_id` from `filters.carBrands`. |

**Response `200`:**
```json
{
  "_id": "6a05bf09876db3938e6e5f4c",
  "name": "Acura",
  "name_ar": "",
  "models": [
    { "_id": "6a05bf09876db3938e6e5f4d", "name": "ADX", "years": [{ "year": 2024 }, { "year": 2025 }] }
  ]
}
```

**Errors:**
- `404` — `{message: "Car brand not found"}`: the id is not a valid ObjectId, or no such make exists.
- `500` — `{message}`.

#### `GET /api/shipping/classes`
Active shipping classes, sorted by name, for the "Shipping class" selector in the product form. The selected `_id` goes in `shipping_class_id`. The server does not check that the class exists or is active. The bulk template's dropdown lists inactive classes as well.

- **Auth:** Public

No parameters.

**Response `200`:**
```json
{
  "classes": [
    { "_id": "6a05b022898075945d70afe2", "name": "Fragile", "name_ar": "قابل للكسر", "description": "Items needing careful handling." }
  ]
}
```

**Errors:**
- `400` — `{message}`.

#### `GET /api/shipping/cities`
The canonical list of courier (Bosta) cities, sorted by `name`. No product field uses it. It matters to the store because every pickup location in the store profile needs `shipping_city` to be one of these English names, or the profile save is refused. No dashboard page was found calling this endpoint.

- **Auth:** Public

No parameters.

**Response `200`:**
```json
{
  "cities": [
    { "_id": "6a0b904febc9647c8e159090", "name": "Alexandria", "name_ar": "الاسكندريه", "bosta_code": "EG-02", "bosta_sector": 2, "country": "Egypt", "country_ar": "مصر", "__v": 0 }
  ]
}
```
There are 28 cities on this install.

**Errors:**
- `400` — `{message}`.

#### `POST /api/upload`
Image upload behind the product form's image uploader (field `images`), the bundle builder and ad banners. Upload first, then put the returned URLs into `images[]` (or `banner_image`). The uploader sends every image with `is_primary: false`; the form decides which is primary.

- **Auth:** Public (the router has no auth middleware)

**Body** (`multipart/form-data`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `images` | file[] | one of the two | At most 10 files in this field. |
| `image` | file[] | one of the two | At most 10 files in this field. |

- Each file may be at most 5 MB.
- A file gets past the first filter if either its extension or its MIME type is JPG, PNG or WebP.
- After the write, the first bytes decide: a file that is not really JPG, PNG or WebP is deleted and listed in `rejected`.
- Files are saved under `/uploads/products/` as `product-<timestamp>-<random><original extension, lowercased>`.

**Response `200`:**
```json
{
  "message": "Images uploaded successfully",
  "images": [
    { "url": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg", "is_primary": false }
  ],
  "url": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg"
}
```
- `url` repeats the first image.
- The base is `BACKEND_PUBLIC_URL`, or the request's own host.
- `rejected: ["name.jpg"]` is added when some files failed the content check.

**Errors** (`{message, code?}`):
- `400` — `No files uploaded`.
- `400` — `INVALID_IMAGE`: every file failed the content check.
- `400` — `FILE_TOO_LARGE`.
- `400` — `UNSUPPORTED_FILE_TYPE`.
- `400` — `LIMIT_FILE_COUNT` / `LIMIT_UNEXPECTED_FILE`. The message is "Too many files in one upload. Send 10 or fewer.", even when the real cause is a wrong field name.
- `500` — `The upload could not be completed.`

---

## 5. Bundles and ads

### Bundles

A bundle is a set of at least 2 of the store's own **published** products (optionally pinned to a variant, with a quantity), sold together at one price. Its price is always recomputed from the members' current effective prices.

| `pricing_mode` | `pricing_value` means | Effective price |
|---|---|---|
| `fixed` | Total price for the set | `max(0, value)` |
| `percent` | % off the combined price | `combined × (1 − clamp(value, 0, 100) / 100)` |
| `amount` | Flat amount off | `max(0, combined − value)` |

A bundle does not use a product slot in the plan.

#### `GET /api/vendors/bundles/eligible-products`
The product picker in the bundle builder: the store's `published` products.

- **Auth:** Vendor

No parameters.

**Response `200`:**
```json
{
  "products": [
    {
      "_id": "6ac60cc079bcca7bf9036f53",
      "title_en": "CV Joint (outer)",
      "title_ar": "كوبلن خارجي",
      "images": [{ "_id": "6ac60e5a79bcca7bf9037072", "url": "https://readycar.store/uploads/products/product-1791364697313-727922615.jpg", "is_primary": true }],
      "price": 1160,
      "discount_price": 1102,
      "variants": [],
      "variation_types": []
    }
  ]
}
```
Newest first. A product with `is_active: false` is listed, but it fails member validation.

**Errors:**
- `500` — `{message}`.

#### `GET /api/vendors/bundles`
The store's bundles list (all statuses), newest first, each with live pricing.

- **Auth:** Vendor

No parameters.

**Response `200`:**
```json
{
  "bundles": [
    {
      "_id": "6ae0000000000000000000d1",
      "vendor_id": "6a5000000000000000000001",
      "title_en": "Brake Service Kit",
      "title_ar": "طقم صيانة الفرامل",
      "subtitle_en": "Pads + fluid",
      "subtitle_ar": "تيل + زيت",
      "description_en": "Everything for a front brake job.",
      "description_ar": "كل ما تحتاجه لصيانة الفرامل الأمامية.",
      "slug_en": "brake-service-kit-example-motors",
      "slug_ar": "طقم-صيانة-الفرامل-example-motors",
      "images": [{ "_id": "6ae0000000000000000000d2", "url": "https://readycar.store/uploads/products/product-1760180000000-1.jpg", "is_primary": true }],
      "members": [
        {
          "_id": "6ae0000000000000000000d3",
          "product_id": { "_id": "6ad0000000000000000000a1", "title_en": "Front Brake Pads", "title_ar": "تيل فرامل أمامي", "images": [], "price": 950, "discount_price": 855, "status": "published", "variants": [] },
          "variant_id": null,
          "quantity": 1
        }
      ],
      "pricing_mode": "percent",
      "pricing_value": 10,
      "status": "published",
      "is_published": true,
      "is_active": true,
      "subscription_hidden_at": null,
      "modified_after_subscription_restore": false,
      "sold_count": 0,
      "created_at": "2026-10-01T09:00:00.000Z",
      "__v": 0,
      "pricing": {
        "combined": 1105,
        "effective": 994.5,
        "savings": 110.5,
        "memberBreakdown": [
          { "product_id": "6ad0000000000000000000a1", "variant_id": null, "quantity": 1, "effective_unit": 855, "line_total": 855, "product": { "_id": "6ad0000000000000000000a1", "title_en": "Front Brake Pads" } }
        ]
      }
    }
  ]
}
```
- `members[].product_id` is populated with `title_en`, `title_ar`, `images`, `price`, `discount_price`, `status` and `variants`.
- A member whose product was deleted shows `product_id: null` and is left out of `pricing`.
- `memberBreakdown[].product` repeats the populated member product.

**Errors:**
- `500` — `{message}`.

#### `GET /api/vendors/bundles/:id`
Loads one bundle into the bundle editor, drafts included.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | 24 hex characters, or the route does not match (`404 Not Found`). |

**Response `200`:** `{ bundle }`, the same shape as a list item. Members are also populated with `vendor_id` and `is_active`.

**Errors:**
- `404` — `{message: "Bundle not found"}`.
- `500` — `{message}`.

#### `POST /api/vendors/bundles`
Saves the bundle builder. "Save as draft" sends `status: "draft"`. "Publish" sends any other status, which validates the bundle. The result is `pending` when approval is required (the global setting, default on) and the store does not auto-publish; otherwise it is `published`.

- **Auth:** Vendor, active subscription. Without one: `400 { message: "No active subscription found. Please subscribe to a package to publish products.", code: "NO_SUBSCRIPTION" }`.

**Body** (JSON)

| Field | Type | Required | Notes |
|---|---|---|---|
| `title_en`, `subtitle_en`, `description_en` | string | to submit: one full set | All three in English **or** all three in Arabic. |
| `title_ar`, `subtitle_ar`, `description_ar` | string | to submit: one full set | |
| `images` | array | to submit: ≥ 1 | `[{ url, is_primary }]`. Not normalised. |
| `members` | array | Yes (≥ 2, even for a draft) | `[{ product_id, variant_id, quantity }]`. `variant_id` defaults to `null` (the first variant at checkout). `quantity` defaults to 1, minimum 1. On submit, every member must be one of this store's `published` products with `is_active !== false`, and a pinned variant must exist. Drafts only check the count. |
| `pricing_mode` | string | No | `fixed` (default), `percent` or `amount`. |
| `pricing_value` | number | to submit | `≥ 0`. `percent` must be 0–100. There is no check against the combined price (see [Known issues](#appendix-c-known-issues)). |
| `status` | string | No | Omitted or `draft` → `draft`. Any other value → submit. |

The server sets `vendor_id`, `status`, `is_published`, `slug_en` and `slug_ar`. Slugs are generated as for products, with uniqueness checked among bundles.

```json
{
  "title_en": "Brake Service Kit", "subtitle_en": "Pads + fluid", "description_en": "Everything for a front brake job.",
  "images": [{ "url": "https://readycar.store/uploads/products/product-1760180000000-1.jpg", "is_primary": true }],
  "members": [{ "product_id": "6ad0000000000000000000a1", "quantity": 1 }, { "product_id": "6ad0000000000000000000a5", "quantity": 2 }],
  "pricing_mode": "percent", "pricing_value": 10,
  "status": "published"
}
```

**Response `201`:** `{ message: "Bundle created successfully", bundle }`. The document is not populated and has no `pricing`.

**Errors** (`400 { message, code }`):
- `NO_SUBSCRIPTION`.
- `INCOMPLETE_BUNDLE`, one of:
  - `Please fill title, subtitle and description in at least one language (English or Arabic).`
  - `A bundle must contain at least two products.`
  - `Invalid pricing mode.`
  - `A valid bundle price is required.`
  - `At least one bundle image is required.`
- `INVALID_BUNDLE_MEMBER` — `A selected product no longer exists.` or `A selected product variant no longer exists.`
- `MEMBER_WRONG_VENDOR` — `All bundle products must belong to you.`
- `MEMBER_NOT_PUBLISHED` — `Product "<title>" must be published and active to include it in a bundle.`
- No `code` — Mongoose validation, e.g. `Bundle validation failed: members: A bundle must contain at least two products.` or `Percentage discount must be between 0 and 100.`

#### `PUT /api/vendors/bundles/:id`
Saves the bundle editor. A partial update (`$set`).

- **Auth:** Vendor (no subscription check)

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | One of the store's bundles. No format constraint. |

**Body:** any field from `POST /bundles`.
- `status: "published"` or `"pending"` validates the stored bundle merged with the body (completeness and the member rules). The result is `pending` (approval required, no auto-publish) or `published` (also sets `is_published`).
- `status: "draft"` unpublishes.
- Without `status`, a live bundle stays live with no review or member check.
- A changed title regenerates its slug.
- `vendor_id` and `is_published` are dropped.
- The model's ≥ 2 members and percent ≤ 100 rules do **not** run on this path.

**Response `200`:** `{ message: "Bundle updated successfully", bundle }`, not populated.

**Errors** (`400 { message, code }`):
- No `code` — `Bundle not found or unauthorized`.
- `INCOMPLETE_BUNDLE`, `INVALID_BUNDLE_MEMBER`, `MEMBER_WRONG_VENDOR`, `MEMBER_NOT_PUBLISHED` — as on create (submit only).
- No `code` — cast or enum validation errors.

#### `DELETE /api/vendors/bundles/:id`
Deletes a bundle (hard delete).

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | One of the store's bundles. |

**Response `200`:** `{ message: "Bundle deleted successfully", bundle }`, the deleted document.

**Errors:**
- `500` — `{message: "Bundle not found or unauthorized"}` (not-found comes back as 500), or a cast error.

### Ads

The store requests an ad and an admin approves it and sets the dates it runs. There is no payment in the API: pricing is agreed off-platform. The three types:

| `type` | What it does | Placement field |
|---|---|---|
| `banner` | An image in the home page banner slider, linking to `link_url`. | — |
| `product_visibility` | Pushes one of the store's published products into listings and sections, labelled "Sponsored". Shown only while the store is active and subscribed. | `placements`: `category_top`, `shop_top`, `promoted_section`, `most_sold`, `new_arrivals`, `special_offers` |
| `featured_vendor` | Shows the store in the home page store slider and/or the stores directory. | `vendor_placements`: `home`, `vendors_page` |

Statuses: `pending`, `approved`, `rejected`, `cancelled`, `expired`. An `approved` ad is **live** only between `start_date` and `end_date`; before `start_date` it is scheduled. Ended ads are switched to `expired` by a nightly job.

#### `POST /api/vendors/ads`
"Request ad" in the dashboard's Ads section. Creates a `pending` request with a random `ad_number` (`AD-` plus 8 hex characters).

- **Auth:** Vendor. Every type needs `subscription_status` `active` or `trial_active`, except a banner with `subject_type: "service"`. Without one: `403 SUBSCRIPTION_REQUIRED`.

**Body** (JSON)

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string | No | `banner` (default), `product_visibility` or `featured_vendor`. An unknown value → `banner`. |
| `subject_type` | string | No | Banner only. What it promotes: `product`, `store`, `custom` (default) or `service`. Unknown → `custom`. |
| `banner_image` | string | banner: Yes | Image URL, normally from `POST /api/upload`. Not checked. |
| `link_url` | string | banner: Yes | Must start with `http://`, `https://` or `/`. |
| `product_id` | ObjectId | product_visibility: Yes | Must be one of this store's `published` products. On a banner it is stored without checks. |
| `placements` | string[] | product_visibility: ≥ 1 | Values from the table above. Unknown values are dropped. |
| `vendor_placements` | string[] | featured_vendor: ≥ 1 | `home`, `vendors_page`. Unknown values are dropped. |
| `vendor_note` | string | No | A free note for the off-platform arrangement (budget, dates wanted). |

Fields that do not belong to the chosen type are ignored.

```json
{ "type": "product_visibility", "product_id": "6ad0000000000000000000a1", "placements": ["shop_top", "special_offers"], "vendor_note": "Two weeks from the 15th." }
```

**Response `201`:** the AdRequest document.
```json
{
  "success": true,
  "ad": {
    "_id": "6af0000000000000000000e1",
    "ad_number": "AD-3F9A12BC",
    "vendor_id": "6a5000000000000000000001",
    "type": "product_visibility",
    "subject_type": "custom",
    "product_id": "6ad0000000000000000000a1",
    "placements": ["shop_top", "special_offers"],
    "vendor_note": "Two weeks from the 15th.",
    "status": "pending",
    "start_date": null,
    "end_date": null,
    "admin_review": { "decision": null, "notes": "", "reviewed_at": null, "reviewed_by": null },
    "rejection_reason": null,
    "history": [
      { "_id": "6af0000000000000000000e2", "action": "ad_requested", "title": "Ad requested", "details": "Vendor submitted a product visibility ad request.", "actor_role": "vendor", "actor_label": "Vendor", "metadata": {}, "created_at": "2026-10-11T10:00:00.000Z" }
    ],
    "created_at": "2026-10-11T10:00:00.000Z",
    "updated_at": "2026-10-11T10:00:00.000Z"
  }
}
```

**Errors** (`{ success: false, message, code }`):
- `400` — `INVALID_INPUT`, one of:
  - `A banner image is required`
  - `A valid destination link is required`
  - `A product is required`
  - `Select at least one placement`
  - `Only published products can be advertised`
- `403` — `SUBSCRIPTION_REQUIRED`: `An active subscription is required to request this ad type. Subscribe first to add products, then advertise.`
- `404` — `NOT_FOUND`: `Product not found` (not this store's product).
- `500` — no `code`: anything else, e.g. a malformed `product_id`.

#### `GET /api/vendors/ads`
The store's ad requests, newest first, each with impression/click totals.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | string | No | `pending`, `approved`, `rejected`, `cancelled` or `expired`. Not validated. |
| `page` | integer | No | Default 1. |
| `limit` | integer | No | Default 20. No maximum; `0` returns everything (`pages: null`). |

**Response `200`:** AdRequest documents (as on create) plus `stats`.
```json
{
  "success": true,
  "ads": [
    {
      "_id": "6af0000000000000000000e1",
      "ad_number": "AD-3F9A12BC",
      "type": "product_visibility",
      "product_id": "6ad0000000000000000000a1",
      "placements": ["shop_top", "special_offers"],
      "status": "approved",
      "start_date": "2026-10-15T00:00:00.000Z",
      "end_date": "2026-10-29T00:00:00.000Z",
      "admin_review": { "decision": "approved", "notes": "", "reviewed_at": "2026-10-12T09:00:00.000Z", "reviewed_by": "admin-user" },
      "rejection_reason": null,
      "history": [],
      "created_at": "2026-10-11T10:00:00.000Z",
      "updated_at": "2026-10-12T09:00:00.000Z",
      "stats": { "impressions": 1520, "clicks": 38, "actions": 6, "ctr": 2.5 }
    }
  ],
  "pagination": { "total": 1, "page": 1, "pages": 1, "limit": 20 }
}
```
`stats.ctr` is a percentage with 2 decimals. `product_id` is not populated.

**Errors:**
- `500` — `{ success: false, message }`.

#### `GET /api/vendors/ads/:id/analytics`
The analytics page for one of the store's ads: impressions, unique viewers, clicks and follow-up actions, broken down by day, placement, action, device, page and audience.

- **Auth:** Vendor (the ad must belong to the store)

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | The ad's `_id`. A malformed id → `500`. |

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `from` | date | No | ISO date. Default: the ad's whole life. Unparseable → ignored. |
| `to` | date | No | ISO date, inclusive up to 23:59:59.999 server time. |

**Response `200`:**
```json
{
  "success": true,
  "ad": {
    "_id": "6af0000000000000000000e1",
    "ad_number": "AD-3F9A12BC",
    "type": "product_visibility",
    "status": "approved",
    "start_date": "2026-10-15T00:00:00.000Z",
    "end_date": "2026-10-29T00:00:00.000Z",
    "subject_type": "custom",
    "placements": ["shop_top", "special_offers"]
  },
  "range": { "from": null, "to": null },
  "totals": {
    "impressions": 1520,
    "unique_viewers": 980,
    "clicks": 38,
    "unique_clickers": 31,
    "ctr": 2.5,
    "actions": 6,
    "engagement_rate": 3.16,
    "last_event_at": "2026-10-20T18:42:11.000Z"
  },
  "by_day": [{ "day": "2026-10-15", "impressions": 210, "clicks": 5, "actions": 1 }],
  "by_placement": [{ "placement": "shop_top", "impressions": 900, "clicks": 20, "actions": 3, "ctr": 2.22 }],
  "by_action": [{ "action": "open", "count": 38 }, { "action": "add_to_cart", "count": 4 }],
  "by_device": [{ "device": "mobile", "impressions": 1100, "clicks": 30, "actions": 5 }],
  "by_page": [{ "page": "/shop", "impressions": 900 }],
  "audience": {
    "signed_in": { "impressions": 400, "clicks": 12, "actions": 4 },
    "guest": { "impressions": 1120, "clicks": 26, "actions": 2 }
  }
}
```
- `ad.subject_type` is always present (`custom` on non-banner ads). `ad.link_url` appears on banners only.
- `ad.placements` is `vendor_placements` for a featured-vendor ad.
- `ctr` = clicks / impressions × 100. `engagement_rate` = unique clickers / unique viewers × 100.
- `by_day` days are UTC dates.
- `by_action.action` is one of `open`, `view_product`, `add_to_cart`, `buy_now`, `checkout`, `order_placed`, `visit_store`, `whatsapp`, `call`, `view_service`.
- `by_device.device` is `mobile`, `tablet`, `desktop` or `unknown`.
- `by_page` is the top 10 pages by impressions.

**Errors:**
- `404` — `{ success: false, message: "Ad request not found" }`: not this store's ad.
- `500` — `{ success: false, message }`, including a malformed id.

#### `POST /api/vendors/ads/:id/cancel`
"Cancel request" on a pending ad. Only `pending` requests can be cancelled. An approved ad can only be taken down by an admin.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | The ad's `_id`. |

No body.

**Response `200`:** `{ success: true, ad }`, with `status: "cancelled"` and an `ad_cancelled` history entry added.

**Errors** (`{ success: false, message, code }`):
- `404` — `NOT_FOUND`: `Ad request not found` (missing, or another store's ad).
- `400` — `INVALID_STATUS`: `Only pending ad requests can be cancelled`.
- `500` — malformed id or other error.

---

## 6. Orders and shipping

Work with **parcels**: the list is `GET /api/vendors/sub-orders` and each action is under `/api/vendors/orders/:orderId/sub-orders/:subOrderId/...`. The step-by-step flow is in [Orders and parcels](#orders-and-parcels) under Basics.

`GET /api/vendors/orders` and `PUT /api/vendors/orders/:id` are **legacy** endpoints from before orders were split into parcels. New clients should not use them.

Every parcel action answers `{ "success": true, "sub_order": { … } }` with the updated parcel, or `{ "success": false, "code", "message" }`. None of these routes checks the subscription.

### Dashboard

#### `GET /api/vendors/stats`
The vendor's landing screen and the source of its PDF report, in one call. Sales, order, customer and top-product figures count only this vendor's **delivered** parcels, dated by delivery and net of refunds. Parcels still at the store or on the road are reported separately under `in_flight`.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `range` | string | no | `7d`, `30d` (default), `90d`, `12m`, `all`. Anything else falls back to `30d`. Series buckets are days for 7d/30d, weeks (labelled by Monday) for 90d, months for 12m/all. |

**Response `200`:**
```json
{
  "success": true,
  "stats": {
    "range": { "key": "30d", "days": 30, "granularity": "day", "from": "2026-09-12T00:00:00.000Z", "to": "2026-10-11T16:40:00.000Z", "comparable": true },
    "store": { "name": "Example Auto Parts", "member_since": "2025-11-02T10:00:00.000Z" },
    "sales": {
      "basis": "delivered",
      "lifetime": 48250, "completed": 48250, "this_month": 6120,
      "period": 9340, "previous_period": 7900, "growth_pct": 18.2,
      "commission": 934, "coupon_share": 50, "net": 8356, "shipping": 450,
      "avg_order_value": 778.33
    },
    "orders": {
      "basis": "delivered",
      "lifetime": 61, "completed": 61, "this_month": 8,
      "period": 12, "previous_period": 10, "growth_pct": 20,
      "awaiting_action": 2, "cancelled": 1, "returned": 0, "units_sold": 19
    },
    "parcels": [{ "status": "delivered", "count": 12 }],
    "in_flight": {
      "at_vendor": {
        "parcels": 3, "orders": 3, "merchandise": 2100, "collectable": 2250,
        "by_status": { "pending_review": { "parcels": 2, "merchandise": 1400, "collectable": 1500 } }
      },
      "in_transit": { "parcels": 1, "orders": 1, "merchandise": 690, "collectable": 740, "by_status": {} }
    },
    "customers": { "unique": 11, "repeat": 1, "repeat_pct": 9.1 },
    "products": { "total": 140, "published": 120, "pending": 5, "draft": 15, "rejected": 0, "out_of_stock": 7, "low_stock": 12 },
    "earnings": { "available": 3200, "pending": 5100, "reserved": 0, "withdrawn": 20000 },
    "returns": { "total": 2, "awaiting_vendor": 1, "in_progress": 1, "completed": 0, "rejected": 0, "rate_pct": 16.7 },
    "reviews": { "rating": 4.6, "count": 23, "distribution": [{ "star": 5, "count": 18, "pct": 78 }] },
    "top_products": [{ "product_id": "66e9a1b2c3d4e5f6a7b8c9d0", "title": "Front Brake Pads", "image": "https://readycar.store/uploads/products/product-1.jpg", "units": 6, "revenue": 4140 }],
    "series": [{ "date": "2026-10-11", "sales": 690, "orders": 1 }],
    "recent_orders": [{ "_id": "6702a1e9c3b4a5d6e7f80900", "reference": "REF-7K2M9QXA", "status": "processing", "created_at": "2026-10-11T09:10:00.000Z", "total": 1380 }]
  }
}
```

- `growth_pct` is `null` when there is no earlier period (`all`) or the earlier period was 0.
- `sales.net` = `period − coupon_share − commission`, before shipping.
- `orders.awaiting_action` is the `pending` count from `GET /orders/counts`.
- `orders.cancelled` / `returned` count whole orders by **order** status, created in the period.
- `parcels` counts this vendor's parcels created in the period, by status.
- `in_flight` ignores `range`. `at_vendor` covers `pending_review`, `awaiting_tracking`, `awaiting_handover`, `ready_for_pickup` and `needs_admin`. `in_transit` covers `handed_to_courier`, `pickup_scheduled`, `picked_up`, `in_transit`, `out_for_delivery` and `exception`. `collectable` sums `cod_amount`, including on prepaid orders.
- `earnings` are the cached wallet balances.
- `reviews.distribution` counts approved store reviews over the store's whole life.
- `recent_orders` is the last 5 orders with this vendor on them, in any state. `total` is the vendor's supervision `total_amount`.

**Errors:**
- `500` — `{ "message": "..." }` on any failure.

#### `GET /api/vendors/reports/sales`
The sales report: one row per parcel of this vendor's (an order can hold several vendors' parcels; each vendor sees only their own), with its value, ReadyCar's commission, the vendor's net, the order's date and the parcel's status, and the totals. Parcels still waiting in a company's batch are left out, as everywhere the vendor looks.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | no | The order's date, Cairo days, included. |
| `to` | `YYYY-MM-DD` | no | Included. Without `from` and `to`, every order. |
| `status` | string | no | `all` (default), `in_progress` (anything not delivered, returned or cancelled), `delivered`, `returned`, `cancelled`. |

**Response `200`:**
```json
{
  "success": true,
  "from": "2026-09-01", "to": "2026-09-30", "status": "all",
  "rows": [
    {
      "order_id": "6a8f2c0e1b2c3d4e5f6a7b8c", "sub_order_id": "6a8f2c0e1b2c3d4e5f6a7b8d",
      "reference": "REF-F328M31G-1", "created_at": "2026-09-27T10:12:00.000Z",
      "status": "delivered", "delivered_at": "2026-09-29T14:00:00.000Z",
      "items": [{ "title": "Fast Charging Cable 240 Watt", "variant": "Default", "quantity": 1 }],
      "value": 194, "commission": 19.4, "deductions": 0, "net": 174.6,
      "earning_status": "available", "paid_out": false
    }
  ],
  "totals": { "orders": 6, "cancelled": 1, "value": 1422, "commission": 141.24, "deductions": 0, "net": 1280.76 }
}
```

- `value` is the parcel's merchandise (shipping is not the vendor's sale).
- Once delivered, the money is the parcel's earning, so a return shows: `commission` is net of what a return gave back and `net` is the earning's `effective_net`. Before delivery, `net` = `value` − the vendor's share of a coupon − `commission`, which is what the earning will be.
- `deductions` = `value − commission − net`: the vendor's coupon share, or what a return refunded. Usually 0.
- A cancelled parcel is listed with `commission` and `net` 0, and is not counted in `totals` (`totals.cancelled` says how many were left out).
- `reference` is the parcel's reference, or `#` and the order id's last 8 characters for an order without one.
- `earning_status` is the earning's status (`pending`, `available`, `reversed`) or `null` before delivery; `paid_out` is true once it went out in a payout.
- Newest order first.

**Errors:**
- `500` — `{ "message": "..." }`.

#### `GET /api/vendors/reports/sales/export`
The same report as an Excel file (`.xlsx`, Arabic, right to left): one line per parcel, then the totals. Same query. A "deductions" column is added only when some row has one.

- **Auth:** Vendor
- **Response `200`:** the file, `Content-Disposition: attachment; filename="readycar-sales-<from>_to_<to>.xlsx"` (`readycar-sales-all.xlsx` with no dates).

**Errors:**
- `500` — `{ "message": "..." }` (JSON, before the file starts).

#### `GET /api/vendors/orders/counts`
How many orders are waiting for this vendor's item review and how many are already reviewed, for the sidebar badge. Counted from `order.vendor_supervisions`. Orders whose status is `cancelled` or `returned` are left out, and so are orders where one of this vendor's parcels is still held in a company batch.

- **Auth:** Vendor

**Response `200`:**
```json
{ "success": true, "counts": { "pending": 2, "supervised": 57, "total": 59 } }
```

- `pending`: at least one of the vendor's items on the order is still `vendor_status: "pending"`.
- `supervised`: every one of the vendor's items is approved or declined (across all their branches on that order).

**Errors:**
- `500` — `{ "message": "..." }`.

### Parcels

#### `GET /api/vendors/orders`
**Legacy** order list, kept from before orders were split into parcels. It is built from `vendor_supervisions`. New screens should use `GET /api/vendors/sub-orders`. It returns orders newest first, with only this vendor's items and shipments, and no pagination.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `revised` | string | no | `"true"` → orders whose supervision is `supervised`; anything else → `pending`. |

**Response `200`** (a bare array):
```json
[
  {
    "_id": "6702a1e9c3b4a5d6e7f80900",
    "status": "processing",
    "reference": "REF-7K2M9QXA",
    "created_at": "2026-10-11T09:10:00.000Z",
    "vendor_total": 1380,
    "vendor_supervision_status": "supervised",
    "fulfillment_location": "12 Example St, Nasr City",
    "items": [
      {
        "_id": "6702a1e9c3b4a5d6e7f80901",
        "product_id": "66e9a1b2c3d4e5f6a7b8c9d0",
        "product_title": "Front Brake Pads",
        "product_image": "https://readycar.store/uploads/products/product-1.jpg",
        "variant_id": "66e9a1b2c3d4e5f6a7b8c9d1",
        "variant_label": "Default",
        "quantity": 2,
        "unit_price": 690,
        "vendor_id": "66d1f0a1b2c3d4e5f6a7b8c9",
        "vendor_status": "approved",
        "vendor_note": "",
        "sub_order_id": "6702a1f0c3b4a5d6e7f80912",
        "commission_rate": 10,
        "commission_amount": 138,
        "return_status": "none",
        "product_slug": "front-brake-pads",
        "product_sku": "BP-001",
        "product_part_number": "58101-F2A00"
      }
    ],
    "shipments": [],
    "smart_label_enabled": false,
    "smart_label": null,
    "smart_label_scannable": false
  }
]
```

- `shipments` are the raw shipment rows for this vendor (see [Known issues](#appendix-c-known-issues): they include ReadyCar's courier costs).
- `smart_label` is `{ tracking_number, status, scanned_at, scanned_by_label }` or `null`.
- `smart_label_scannable` is true when Smart Label is on, the vendor's parcel goes with Bosta, the supervision is `supervised`, at least one item is approved, and no live shipment carries a sticker yet.
- Orders whose parcels for this vendor are all `held_in_batch` are left out.

**Errors:**
- `500` — `{ "message": "..." }`.

#### `PUT /api/vendors/orders/:id`
**Legacy** bulk item review for orders that predate parcels. Any order that has parcels, which is every order since the sub-order migration, is refused. Use the parcel review endpoints instead.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | Order id. Not checked against the vendor (see [Known issues](#appendix-c-known-issues)). |

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | array | yes, if the vendor has items on the order | `[{ "itemId": "<order item _id>", "status": "approved" \| "declined" \| "pending", "note": "..." }]`. Only the vendor's own items are touched. |
| `fulfillment_location` | string | no | Sets the supervision's branch. Omitting it sets the branch to `undefined` on a legacy order. |

On a legacy order, once every one of the vendor's items is reviewed, the supervision becomes `supervised`. When every item on the order is approved, the order auto-advances to `processing` and the customer gets the processing confirmation. A Smart Label reserved for a vendor with no approved items left is released.

**Response `200`:**
```json
{ "message": "Order supervision updated", "order": { "_id": "6702a1e9c3b4a5d6e7f80900", "status": "processing", "items": [], "vendor_supervisions": [], "shipping_address": { "recipient_name": "Customer Name", "phone": "01000000000", "full_address": "Placeholder St, Cairo" } } }
```
`order` is the whole Mongoose order document (all fields of `models/orders.js`), abridged here.

**Errors:**
- `400` — `{ "message": "This order is organised into parcels. Open the parcel you want and confirm its items there." }` on any order with `sub_orders`.
- `400` — `{ "message": "Order not found" }`, a Mongoose validation message (for example an invalid `status`), or a `TypeError` message when `items` is missing.

#### `GET /api/vendors/sub-orders`
The vendor's parcel list, grouped into tabs by the action each parcel is waiting for. It includes every one of the vendor's parcels across all orders, newest order first, and leaves out `cancelled` and `held_in_batch` parcels. There is no pagination. Customer details are not included.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tab` | string | no | `needs_review`, `needs_tracking`, `needs_sealing`, `waiting_pickup`, `on_the_way`, `delivered`, `blocked`. Unknown or missing → all rows. `counts` always covers every tab. |

**Response `200`** (one row; the parcel fields are the same as `GET` parcel below, minus `shipping_address`, `courier_label` override, `smart_label_enabled` and `earning`):
```json
{
  "success": true,
  "sub_orders": [
    {
      "_id": "6702a1f0c3b4a5d6e7f80912",
      "reference": "REF-7K2M9QXA-1",
      "status": "pending_review",
      "raw_status": "pending_review",
      "items": [],
      "item_count": 1,
      "merchandise_total": 1380,
      "cod_amount": 1450,
      "commission_total": 138,
      "coupon_vendor_share": 0,
      "deadline_at": "2026-10-13T09:10:00.000Z",
      "is_overdue": false,
      "order_id": "6702a1e9c3b4a5d6e7f80900",
      "order_reference": "REF-7K2M9QXA",
      "order_created_at": "2026-10-11T09:10:00.000Z",
      "payment_method": "cash",
      "tab": "needs_review",
      "batch": null,
      "progress": { "stage": 1, "items_total": 1, "items_reviewed": 0, "items_declined": 0, "photo_count": 0, "tracking_mode": "print_awb", "can_scan_label": false, "rides_in_lead": null, "blocked_reason": "1 item(s) still need a decision", "can_advance": false },
      "courier": "bosta",
      "vendor_review": { "key": "awaiting_review", "total": 1, "approved": 0, "declined": 0, "pending": 1 },
      "pickup": null,
      "earning_estimate": 1242
    }
  ],
  "counts": { "needs_review": 1, "needs_tracking": 0, "needs_sealing": 0, "waiting_pickup": 0, "on_the_way": 2, "delivered": 40, "blocked": 0 },
  "tabs": [{ "key": "needs_review", "label_en": "Needs review", "label_ar": "محتاج مراجعة", "statuses": ["pending_review"] }],
  "smart_label_enabled": false
}
```

- `batch` (company consolidation) is `{ batch_id, role: "lead"|"rider", company_name, office_name, order_count, lead_order_id, lead_sub_order_id, lead_reference, dispatched, confirmed_count }` or `null`.
- `pickup` is `{ scheduled_date, scheduled_time_slot, status, location_address, reference }` (read live from the Bosta pickup) or `null`.
- `smart_label_enabled` at the top is the global setting.

**Errors:**
- `500` — `{ "success": false, "message": "..." }`.

#### `GET /api/vendors/orders/:orderId/sub-orders/:subOrderId`
One parcel in full: stepper state, items, tracking, photos, money, earning, and the delivery contact once the parcel is past review. Every parcel action below returns this same object as `sub_order`.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `orderId` | ObjectId | yes | Order id. |
| `subOrderId` | ObjectId | yes | Parcel id (`sub_orders[]._id`). |

**Response `200`:**
```json
{
  "success": true,
  "sub_order": {
    "_id": "6702a1f0c3b4a5d6e7f80912",
    "reference": "REF-7K2M9QXA-1",
    "status": "awaiting_handover",
    "raw_status": "awaiting_handover",
    "company_batch": null,
    "return_state": { "key": "none", "returned": 0, "total": 1 },
    "journey": {
      "steps": [
        { "key": "pending_review", "owner": "vendor", "state": "done", "at": "2026-10-11T09:10:00.000Z" },
        { "key": "awaiting_handover", "owner": "vendor", "state": "current", "at": "2026-10-11T10:02:00.000Z" }
      ],
      "ending": null,
      "current_index": 2
    },
    "vendor_id": "66d1f0a1b2c3d4e5f6a7b8c9",
    "vendor_name": null,
    "fulfillment_location": "12 Example St, Nasr City",
    "items": [
      {
        "_id": "6702a1e9c3b4a5d6e7f80901",
        "product_id": "66e9a1b2c3d4e5f6a7b8c9d0",
        "product_title": "Front Brake Pads",
        "product_image": "https://readycar.store/uploads/products/product-1.jpg",
        "variant_label": "Default",
        "quantity": 2,
        "unit_price": 690,
        "vendor_status": "approved",
        "vendor_note": "",
        "sub_order_id": "6702a1f0c3b4a5d6e7f80912",
        "commission_rate": 10,
        "commission_amount": 138,
        "return_status": "none",
        "product_slug": "front-brake-pads",
        "product_sku": "BP-001",
        "product_part_number": "58101-F2A00"
      }
    ],
    "item_count": 1,
    "cod_amount": 1450,
    "merchandise_total": 1380,
    "shipping_share": 70,
    "coupon_share": 0,
    "loyalty_share": 0,
    "bosta_tracking_number": "71234567",
    "smart_label_barcode": null,
    "courier": "bosta",
    "courier_label": "Bosta",
    "courier_label_ar": "بوسطة",
    "tracking_number": "71234567",
    "tracking_url": "https://bosta.co/tracking-shipments?shipment-number=71234567",
    "courier_sector_id": null,
    "courier_sector_name": "",
    "tracking_history": [{ "state": "Pickup requested", "timestamp": "2026-10-11T10:02:00.000Z", "notes": "Shipment created" }],
    "bosta_status": "Pickup requested",
    "parcel_photos": [],
    "delivered_at": null,
    "cancelled_at": null,
    "cancel_reason": "",
    "can_cancel": true,
    "cancel_blocked_reason": null,
    "cancel_blocked_reason_ar": null,
    "reactivation_count": 0,
    "reactivated_at": null,
    "created_at": "2026-10-11T09:10:00.000Z",
    "commission_total": 138,
    "coupon_vendor_share": 0,
    "coupon_platform_share": 0,
    "deadline_at": "2026-10-13T09:10:00.000Z",
    "is_overdue": false,
    "needs_admin_reason": "",
    "needs_admin_since": null,
    "cancel_request": { "requested_at": null, "requested_by_role": null, "requested_by_label": null, "reason": "" },
    "items_confirmed_at": "2026-10-11T10:02:00.000Z",
    "tracking_assigned_at": "2026-10-11T10:02:00.000Z",
    "ready_at": null,
    "handed_over_at": null,
    "handed_over_by_label": "",
    "allocation_frozen_at": "2026-10-11T10:02:00.000Z",
    "pickup_id": null,
    "pickup_booked_at": null,
    "shipment_id": "6702a2b0c3b4a5d6e7f80999",
    "can_reactivate": false,
    "can_change_courier": false,
    "courier_cancel_pending": null,
    "courier_override": "bosta",
    "courier_transfer": null,
    "courier_transfer_blocked_reason": null,
    "courier_transfer_blocked_reason_ar": null,
    "dispatch_attempt": null,
    "status_before_cancel": null,
    "cancellations": [],
    "history": [{ "_id": "6702a2b0c3b4a5d6e7f8099a", "action": "sub_order_tracking_assigned", "title": "Tracking number assigned", "details": "Tracking 71234567 (Bosta). Photograph the sealed parcel to finish.", "actor_role": "vendor", "actor_label": "Example Auto Parts", "metadata": {}, "created_at": "2026-10-11T10:05:00.000Z" }],
    "order_id": "6702a1e9c3b4a5d6e7f80900",
    "order_reference": "REF-7K2M9QXA",
    "order_created_at": "2026-10-11T09:10:00.000Z",
    "payment_method": "cash",
    "shipping_address": { "recipient_name": "Customer Name", "phone": "01000000000", "full_address": "Placeholder St, Cairo" },
    "tab": "needs_sealing",
    "batch": null,
    "progress": { "stage": 3, "items_total": 1, "items_reviewed": 1, "items_declined": 0, "photo_count": 0, "tracking_mode": "print_awb", "can_scan_label": false, "rides_in_lead": null, "blocked_reason": null, "can_advance": true },
    "vendor_review": { "key": "accepted", "total": 1, "approved": 1, "declined": 0, "pending": 0 },
    "pickup": null,
    "smart_label_enabled": false,
    "earning": {
      "status": "not_yet_earned",
      "gross_amount": 1380,
      "coupon_share": 0,
      "commission_amount": 138,
      "net_amount": 1242,
      "effective_net": 0,
      "clearable_at": null,
      "has_open_return": false
    }
  }
}
```

- `status` is where the parcel really is. A company-batch rider reads as its lead's status; `raw_status` is the stored value.
- `journey.steps[].state` is one of `done`, `skipped`, `current`, `stopped`, `todo`. `owner` is `vendor`, `platform`, `bosta` or `arrive`. `ending` is set for `cancelled`, `returned`, `exception` and `needs_admin`.
- `shipping_address` is `null` while `status` is `pending_review` or `needs_admin`.
- `vendor_name` is always `null` in vendor views.
- `courier` / `courier_label` are the parcel's courier, falling back to the current default.
- `progress.tracking_mode` is `print_awb` when a shipment already exists or Smart Label does not apply, otherwise `scan_label`.
- `progress.can_scan_label`: Smart Label applies, the parcel is Bosta, no sticker yet, not a batch rider.
- `progress.blocked_reason` explains a disabled button, for example `"1 item(s) still need a decision"`, `"Unavailable items — the website team will take it from here"`, `"N of the M orders in this combined parcel still need to be confirmed"`, or the "Smart Sticker or waybill" sentence.
- `batch` is the full company-batch view (see `GET /company-batches/:batchId`) or `null`.
- `earning`, once delivered, is the stored `VendorEarning`: `status` `pending`, `available` or `reversed`, with `clearable_at` and `has_open_return`.
- `cod_amount` is what the courier collects only when `payment_method` is `cash`.

**Errors** (all `404 { "success": false, "message": "..." }`):
- `404` — `Order not found`, `Parcel not found` (also for a parcel still `held_in_batch`), `This parcel belongs to another vendor`, or a cast error message for a malformed id.

#### `GET /api/vendors/company-batches/:batchId`
A combined company order (consolidation to an office): every colleague's order packed into one parcel, for packing and labelling. Only the batch's own vendor can see it, and only once the batch has closed.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `batchId` | ObjectId | yes | From `batch.batch_id` / `company_batch.batch_id` on a parcel. |

**Response `200`:**
```json
{
  "success": true,
  "batch": {
    "_id": "6702c0d1c3b4a5d6e7f81000",
    "company_name": "Example Company",
    "office": { "name": "Head office", "recipient_name": "Office Contact", "phone": "01000000000", "full_address": "Placeholder Office St, Cairo" },
    "closed_at": "2026-10-11T08:00:00.000Z",
    "order_count": 3,
    "confirmed_count": 2,
    "dispatched": false,
    "lead": { "order_id": "6702a1e9c3b4a5d6e7f80900", "sub_order_id": "6702a1f0c3b4a5d6e7f80912", "reference": "REF-7K2M9QXA", "status": "awaiting_tracking", "tracking_number": null },
    "members": [
      {
        "order_id": "6702a1e9c3b4a5d6e7f80900",
        "sub_order_id": "6702a1f0c3b4a5d6e7f80912",
        "reference": "REF-7K2M9QXA",
        "display_name": "Employee Name",
        "is_lead": true,
        "status": "awaiting_tracking",
        "dropped": false,
        "items": [{ "_id": "6702a1e9c3b4a5d6e7f80901", "title": "Front Brake Pads", "variant": "", "quantity": 2, "vendor_status": "approved" }]
      }
    ]
  }
}
```

- `office` is `{ name }` only when the office no longer exists on the company.
- `order_count` / `confirmed_count` cover live members. "Confirmed" means past `held_in_batch`, `pending_review` and `needs_admin`.
- The lead ships only when `confirmed_count === order_count`. Riders answer `409 RIDES_IN_BATCH` on shipping calls.

**Errors:**
- `404` — `BATCH_NOT_FOUND` "Combined order not found": the batch does not exist, is another vendor's, or is not `closed`.
- `400` — `SUB_ORDER_ERROR` for a malformed id.

### Reviewing items

Stage 1. Each call saves immediately; there is no submit step. Every response carries the updated parcel as `sub_order` (shape of `GET` parcel).

#### `PUT /api/vendors/orders/:orderId/sub-orders/:subOrderId/items/:itemId`
The store owner marks one line available or not available. Nothing moves until `confirm-items`. A decline needs a reason, because the website team reads that text to the customer.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `orderId`, `subOrderId` | ObjectId | yes | The parcel. |
| `itemId` | ObjectId | yes | `items[]._id`; must belong to this parcel. |

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `available` | boolean | yes | `true` or `"true"` → `approved`. Any other value (missing included) → `declined`. |
| `reason` | string | when declining | Stored in `vendor_note`. Cleared on approve. |

Example body:
```json
{
  "available": false,
  "reason": "Out of stock"
}
```

**Response `200`:**
```json
{ "success": true, "sub_order": { "_id": "6702a1f0c3b4a5d6e7f80912", "status": "pending_review", "vendor_review": { "key": "in_progress", "total": 2, "approved": 1, "declined": 0, "pending": 1 } } }
```

**Errors** (`{ "success": false, "code", "message" }`):
- `404` — `ORDER_NOT_FOUND`, `SUB_ORDER_NOT_FOUND` ("Parcel not found on this order"), `ITEM_NOT_FOUND` ("Item not found on this parcel").
- `403` — `FORBIDDEN` "This parcel belongs to another vendor".
- `400` — `WRONG_STAGE` "This parcel has moved past the review stage" (status other than `pending_review` / `needs_admin`).
- `400` — `ORDER_LOCKED`: the parcel is `needs_admin` and the order's allocation is frozen because another parcel was already dispatched.
- `400` — `REASON_REQUIRED` "Please say why this item is not available".

#### `POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/approve-all`
Accept every line of the parcel in one press. With `confirm: true` the same call also runs `confirm-items`, so the parcel leaves stage 1 and, unless Smart Label applies, its courier shipment is created now.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `confirm` | boolean | no | `true` / `"true"` → also confirm (see `confirm-items`). |

Example body:
```json
{
  "confirm": true
}
```

**Response `200`:**
```json
{ "success": true, "confirmed": true, "sub_order": { "_id": "6702a1f0c3b4a5d6e7f80912", "status": "awaiting_tracking", "tracking_number": "71234567", "items_confirmed_at": "2026-10-11T10:02:00.000Z" } }
```
There is no `message` field; the dashboard writes it in the vendor's language.

**Errors:**
- `404` `ORDER_NOT_FOUND` / `SUB_ORDER_NOT_FOUND`; `403` `FORBIDDEN`.
- `400` `WRONG_STAGE` "This parcel has moved past the review stage".
- With `confirm: true`: every `confirm-items` error. The approvals are already saved when confirming fails.

#### `POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/decline-all`
Refuse the whole parcel with one reason, which is written onto every line. Then it confirms, which parks the parcel in `needs_admin` for the website team. Nothing is sent to a courier.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | yes | One reason for every line. |

Example body:
```json
{
  "reason": "Out of stock"
}
```

**Response `200`:**
```json
{ "success": true, "parked": true, "sub_order": { "_id": "6702a1f0c3b4a5d6e7f80912", "status": "needs_admin", "needs_admin_reason": "Front Brake Pads: Out of stock", "shipping_address": null } }
```

**Errors:**
- `400` `REASON_REQUIRED` "Please say why this parcel cannot be fulfilled" (checked before the parcel is loaded).
- `404` `ORDER_NOT_FOUND` / `SUB_ORDER_NOT_FOUND`; `403` `FORBIDDEN`.
- `400` `WRONG_STAGE`; `400` `EMPTY_PARCEL` "This parcel has no items".

#### `POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/confirm-items`
Leave stage 1. If every item is approved, the parcel moves to `awaiting_tracking`. When Smart Label does not apply (setting off, or an Arrive parcel), the courier shipment is created in the same call: the tracking number is minted, the COD is sent to the courier, and the order's money split freezes. If any item is declined, the parcel parks in `needs_admin` and the admins are notified (see [Known issues](#appendix-c-known-issues)).

- **Auth:** Vendor

No body.

**Response `200`:**
```json
{ "success": true, "parked": false, "message": "Products confirmed.", "sub_order": { "_id": "6702a1f0c3b4a5d6e7f80912", "status": "awaiting_tracking", "tracking_number": "71234567", "tracking_assigned_at": "2026-10-11T10:02:00.000Z" } }
```

- When parked: `"parked": true` and `"message": "Thanks — the website team will contact the customer about the unavailable items."`.
- Company-batch parcels move to `awaiting_tracking` without a shipment. The lead's single shipment is created when the last order in the batch is confirmed.

**Errors:**
- `404` `ORDER_NOT_FOUND` / `SUB_ORDER_NOT_FOUND`; `403` `FORBIDDEN`.
- `400` `CANCELLED` "This parcel is cancelled".
- `400` `WRONG_STAGE` "This parcel has already been confirmed".
- `400` `EMPTY_PARCEL`.
- `400` `ITEMS_PENDING` "N item(s) still need a decision".
- `400` `BOSTA_CREATE_FAILED` "Products confirmed, but the shipment could not be created: … Please try again." The parcel stays at `pending_review` and can be retried. The same code is used for Arrive failures, for example a missing destination city or sector, or "Resolve the previous shipment attempt before sending again".

### Preparing and shipping

Stages 2–4. Each action returns `{ "success": true, "sub_order": <GET parcel shape> }` unless noted, with errors as `{ "success": false, "code", "message" }`. Every action also answers `404 ORDER_NOT_FOUND`, `404 SUB_ORDER_NOT_FOUND`, `403 FORBIDDEN` (another vendor's parcel) and `400 SUB_ORDER_ERROR` (malformed id). Those are not repeated below.

#### `POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/tracking`
Finish stage 2, which moves the parcel to `awaiting_handover`. What happens depends on Smart Label and on whether a shipment already exists:

- **Smart Label off, or Arrive** (shipment created in stage 1): no body needed. This records that the printed waybill is on the box. `tracking_number` is ignored. If the shipment is somehow missing, it is created now.
- **Smart Label on, shipment already exists** (printed route via `shipment`): no body → advance. With `tracking_number` → the sticker is linked to the live Bosta delivery (a call to Bosta) and then the parcel advances.
- **Smart Label on, no shipment yet**: `tracking_number` is required. The sticker is reserved locally, the Bosta delivery is created and the sticker linked to it, and the money split freezes.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tracking_number` | string | Smart Label on with no shipment yet | What the scanner read, used verbatim (no format check). It is the sticker barcode; Bosta mints the tracking number. |

**Response `200`:**
```json
{ "success": true, "sub_order": { "_id": "6702a1f0c3b4a5d6e7f80912", "status": "awaiting_handover", "tracking_number": "71234567", "smart_label_barcode": "SL00012345", "tracking_assigned_at": "2026-10-11T10:05:00.000Z" } }
```

**Errors:**
- `400` `CANCELLED`; `400` `NEEDS_ADMIN` "This parcel is waiting for the website team".
- `409` `RIDES_IN_BATCH` (batch rider); `409` `BATCH_WAITING`; `409` `BATCH_NOT_READY` or the batch service's own code (lead whose colleagues are not all confirmed).
- `400` `WRONG_STAGE` "This parcel is not at the tracking-number stage" (status is not `awaiting_tracking`).
- `400` `TRACKING_REQUIRED` "A Smart Sticker or a waybill (بوليصة) must exist on this parcel — scan the sticker, or create the shipment and print its waybill".
- `400` `SUB_ORDER_ERROR` — no shipment yet, and the sticker was refused when reserving it. Examples: "This label is already registered on order #REF-…. Use another label.", "Bosta does not accept this sticker: …", "Smart Label scanning is not enabled.", "This shipment already carries label X. Unlink it before scanning another." (the last one comes from a label reserved with `POST /orders/:id/smart-label`).
- `400` `BOSTA_CREATE_FAILED` "The shipment could not be created: …" The sticker is released; the parcel stays at `awaiting_tracking`.
- `400` `STICKER_REFUSED` — two cases. (1) A shipment already exists and the scanned sticker was refused for any reason (same messages as above). (2) The delivery was created in this call but Bosta would not link the sticker: "Shipment N was created, but Bosta did not accept sticker X: … Scan another sticker or print the waybill." In both cases the shipment is kept and saved, and the parcel stays at `awaiting_tracking`. The vendor scans another sticker or calls again with no body.

#### `POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/shipment`
The other way out of stage 2 when Smart Label is on but there is no sticker: Bosta mints the tracking number so the waybill can be printed. Any sticker reserved for this parcel is released first. The parcel **stays at `awaiting_tracking`**. Print with `awb`, then call `tracking` with no body. This call creates the courier delivery and freezes the order's money split.

- **Auth:** Vendor

No body.

**Response `200`:**
```json
{ "success": true, "sub_order": { "_id": "6702a1f0c3b4a5d6e7f80912", "status": "awaiting_tracking", "tracking_number": "71234567", "progress": { "stage": 2, "tracking_mode": "print_awb", "can_scan_label": true, "can_advance": true } } }
```

**Errors:**
- `400` `CANCELLED`; `400` `NEEDS_ADMIN`.
- `409` `RIDES_IN_BATCH` / `BATCH_WAITING` / `BATCH_NOT_READY`.
- `400` `WRONG_STAGE` "This parcel is not at the tracking-number stage".
- `400` `ALREADY_DISPATCHED` "This parcel already has a shipment". This always happens when Smart Label is off, because stage 1 already created the shipment.
- `400` `BOSTA_CREATE_FAILED` "The shipment could not be created: …"

#### `GET /api/vendors/orders/:orderId/sub-orders/:subOrderId/awb`
The printable waybill for the parcel, which the vendor prints and sticks on the box. It needs a live shipment. The status is not checked.

- **Auth:** Vendor

**Response `200`:** not JSON.

| Courier | `Content-Type` | `Content-Disposition` | Body |
|---|---|---|---|
| Bosta | `application/pdf` | `inline; filename="awb-<tracking>.pdf"` | Bosta's AWB PDF (fetched from Bosta, base64-decoded). |
| Arrive | `text/html; charset=utf-8` | `inline; filename="arrive-<waybill>.html"` | Self-contained 10×15 cm page with a Print button: Code128 of the waybill, QR of Arrive's `qr_code`, receiver name/phone/address/area, COD (whole pounds), sender store/phone/branch, item summary, parcel reference. |

Both include the customer's name, phone and address.

**Errors** (`{ "success": false, "message": "..." }`, no `code`):
- `404` — `Order not found`, `Parcel not found`.
- `403` — `This parcel belongs to another vendor`.
- `400` — `This parcel has no shipment yet` (also for batch riders), `This parcel has no Bosta delivery to print`, `Bosta did not return an AWB for this shipment`, or any Bosta error message.

#### `POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/photos`
Attach photos of the sealed parcel: the vendor's evidence if the customer later disputes what arrived, which the admin can review before booking a courier. Optional. At most 5 per parcel; extras are skipped, not refused. Upload the files first with `POST /api/upload`, then send the returned URLs here.

- **Auth:** Vendor

**Body** (JSON)

| Field | Type | Required | Notes |
|---|---|---|---|
| `urls` | string[] | yes (or `url`) | Image URLs from `POST /api/upload` (`images[].url`). Stored verbatim; not validated. |
| `url` | string | alternative | A single URL. |

Example body:
```json
{
  "urls": [
    "https://readycar.store/uploads/products/product-1728640000000-123456789.jpg"
  ]
}
```

Upload step (`POST /api/upload`, multipart): field `images` or `image` (each up to 10 files), JPG/PNG/WebP checked by file signature, max 5 MB each. It answers `{ "message", "images": [{ "url", "is_primary": false }], "url" }`. Errors: `400 FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `INVALID_IMAGE`, `LIMIT_FILE_COUNT`.

**Response `200`:**
```json
{
  "success": true,
  "added": 2,
  "skipped": 0,
  "sub_order": {
    "_id": "6702a1f0c3b4a5d6e7f80912",
    "status": "awaiting_handover",
    "parcel_photos": [{ "_id": "6702a3c0c3b4a5d6e7f80a01", "url": "https://readycar.store/uploads/products/product-1728640000000-123456789.jpg", "uploaded_at": "2026-10-11T10:10:00.000Z", "uploaded_by_label": "Example Auto Parts" }]
  }
}
```

**Errors:**
- `409` `RIDES_IN_BATCH` / `BATCH_WAITING`.
- `400` `WRONG_STAGE` "This parcel is not ready to be photographed yet" (only `awaiting_handover` and `ready_for_pickup`).
- `400` `NO_PHOTOS` "No photo was uploaded".
- `400` `TOO_MANY_PHOTOS` "A parcel can carry at most 5 photos" (when 5 are already attached).

#### `DELETE /api/vendors/orders/:orderId/sub-orders/:subOrderId/photos/:photoId`
Remove one parcel photo. This is refused once an admin has booked a courier for the parcel (`pickup_booked_at` set). Removing the last photo does not undo `ready`.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `photoId` | ObjectId | yes | `parcel_photos[]._id`. |

**Response `200`:**
```json
{ "success": true, "sub_order": { "_id": "6702a1f0c3b4a5d6e7f80912", "parcel_photos": [] } }
```

**Errors:**
- `400` `PICKUP_BOOKED` "A courier is already booked for this parcel".
- `404` `PHOTO_NOT_FOUND` "Photo not found".

#### `POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/ready`
Finish stage 3: the vendor says the parcel is sealed and waiting at the branch. The parcel moves to `ready_for_pickup`, `is_overdue` is cleared, and the parcel appears in the admin's Pickups module. **No courier is booked by this call**, and nobody is notified. Photos are not required. Calling it again on a parcel already `ready_for_pickup` is a no-op that answers `200`.

- **Auth:** Vendor

No body.

**Response `200`:**
```json
{ "success": true, "sub_order": { "_id": "6702a1f0c3b4a5d6e7f80912", "status": "ready_for_pickup", "ready_at": "2026-10-11T10:12:00.000Z", "is_overdue": false, "tab": "waiting_pickup", "progress": { "stage": 4 } } }
```

**Errors:**
- `409` `RIDES_IN_BATCH` / `BATCH_WAITING`.
- `400` `WRONG_STAGE` "Assign a tracking number to this parcel first" (status is not `awaiting_handover`).
- `400` `NO_TRACKING` (the "Smart Sticker or waybill" sentence).

#### `POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/handover`
Stage 4: the vendor confirms a courier physically took the parcel. The parcel moves to `handed_to_courier` (the order reads `picked_up`), with `handed_over_at` and `handed_over_by_label` stamped and `is_overdue` cleared. It is accepted from `ready_for_pickup` too, because a courier may arrive before anyone booked one. Nothing is sent to the courier; the courier's own scan later moves the parcel to `picked_up`. Calling it on a parcel already at `handed_to_courier` or beyond (`picked_up`, `in_transit`, `out_for_delivery`, `delivered`) answers `200` and changes nothing. Once handed over, the parcel can no longer be cancelled.

- **Auth:** Vendor

No body.

**Response `200`:**
```json
{ "success": true, "sub_order": { "_id": "6702a1f0c3b4a5d6e7f80912", "status": "handed_to_courier", "handed_over_at": "2026-10-12T09:30:00.000Z", "handed_over_by_label": "Example Auto Parts", "can_cancel": false, "tab": "on_the_way" } }
```

**Errors:**
- `409` `RIDES_IN_BATCH` / `BATCH_WAITING`.
- `400` `WRONG_STAGE` "Mark this parcel ready for pickup first" (status is not `ready_for_pickup` or `pickup_scheduled`).
- `400` `NO_TRACKING`.

#### `POST /api/vendors/orders/:orderId/sub-orders/:subOrderId/cancel-request`
Ask the website team to cancel this parcel, for example when stock ran out after confirming. It is a request only: the parcel's status does not change and the vendor can keep working on it. An admin decides, and if the admin cancels, the delivery is terminated, any pickup is trimmed, and the customer is refunded or not charged. The window stays open until the courier has the box. For an Arrive parcel it closes as soon as the shipment exists.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | yes | Shown to the admin. |

Example body:
```json
{
  "reason": "Last unit was damaged"
}
```

**Response `200`:**
```json
{ "success": true, "sub_order": { "_id": "6702a1f0c3b4a5d6e7f80912", "status": "ready_for_pickup", "cancel_request": { "requested_at": "2026-10-11T11:00:00.000Z", "requested_by_role": "vendor", "requested_by_label": "Example Auto Parts", "reason": "Last unit was damaged" } } }
```

**Errors:**
- `400` `CANCEL_WINDOW_CLOSED`, with the parcel's reason, for example "This parcel is already cancelled", "The courier has already collected this parcel", "This parcel has already been delivered — request a return instead", "This parcel is already with Arrive — contact the website team to cancel it", or the combined-company-parcel sentence.
- `400` `REASON_REQUIRED` "Please give a reason".
- `400` `ALREADY_REQUESTED` "A cancellation request is already open".

#### `GET /api/vendors/pickups`
The Bosta courier visits booked for this vendor's branches, newest date first. Each row is a whole `BostaPickup` document. There is no pagination.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `date` | string | no | `YYYY-MM-DD`, exact match on `scheduled_date`. Not validated. |

**Response `200`:**
```json
{
  "success": true,
  "pickups": [
    {
      "_id": "6702d0e1c3b4a5d6e7f82000",
      "bosta_pickup_id": "PK123456",
      "bosta_location_id": "loc_abc123",
      "location_address": "12 Example St, Nasr City",
      "vendor_id": "66d1f0a1b2c3d4e5f6a7b8c9",
      "vendor_name": "Example Auto Parts",
      "scheduled_date": "2026-10-12",
      "scheduled_time_slot": "10:00 to 13:00",
      "contact_person": { "name": "Store Contact", "phone": "01000000000", "email": "store@example.com" },
      "status": "scheduled",
      "bosta_state": "Requested",
      "last_refreshed_at": null,
      "order_ids": ["6702a1e9c3b4a5d6e7f80900"],
      "parcel_count": 1,
      "pickup_fee": 25,
      "has_fragile": false,
      "has_big_items": false,
      "created_at": "2026-10-11T12:00:00.000Z",
      "created_by": "admin",
      "__v": 0
    }
  ]
}
```

- `status`: `scheduled`, `picked_up`, `cancelled`, `failed`.
- `pickup_fee` is what Bosta bills ReadyCar for the visit (see [Known issues](#appendix-c-known-issues)).
- Arrive parcels never appear here.

**Errors:**
- `400` — `{ "success": false, "message": "..." }`.

### Smart labels

Order-level endpoints from before parcels existed. A label is held per (order, vendor), not per parcel. The parcel flow scans through `POST .../tracking` instead. These two calls do not change any parcel's status. Errors are `400 { "success": false, "message": "..." }` with no `code`.

#### `POST /api/vendors/orders/:id/smart-label`
Scan a pre-printed Bosta Smart Sticker onto this vendor's shipment on an order. If no shipment exists yet, the number is **reserved locally** (`status: "reserved"`). If the vendor's live Bosta shipment exists without a sticker, the sticker is linked to it at Bosta right away (`status: "dispatched"`). Bosta is asked first whether the sticker is valid and free. The vendor id always comes from the session.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tracking_number` | string | yes | Scanned sticker barcode, verbatim. |

Example body:
```json
{
  "tracking_number": "SL00012345"
}
```

**Response `200`:**
```json
{
  "success": true,
  "smart_label": {
    "_id": "6702e0f1c3b4a5d6e7f83000",
    "tracking_number": "SL00012345",
    "order_id": "6702a1e9c3b4a5d6e7f80900",
    "vendor_id": "66d1f0a1b2c3d4e5f6a7b8c9",
    "fulfillment_location": "12 Example St, Nasr City",
    "status": "reserved",
    "scanned_by_role": "vendor",
    "scanned_by_label": "Example Auto Parts",
    "scanned_at": "2026-10-11T10:04:00.000Z",
    "dispatched_at": null,
    "__v": 0
  }
}
```

**Errors** (all `400`):
- `Smart Label scanning is not enabled.`
- `No label was scanned.`
- `Order not found`
- `This order can no longer be labelled — it has already left for delivery.` (the order status is not `pending`, `processing`, `confirmed`, `ready`, `partially_shipped` or `partially_delivered`)
- `This vendor has no items on this order.`
- `This shipment already carries sticker X and cannot be relabelled.`
- `This shipment is with another courier and cannot take a Bosta sticker.`
- `This order ships inside the combined parcel of order REF-… — it travels under that parcel's sticker.`
- `Smart Label works with Bosta only — this parcel is going out with Arrive. Print the waybill instead.`
- `Review your items on this order before scanning a label.` (supervision not `supervised`)
- `There is nothing to ship for this vendor — no approved items.`
- `This shipment already carries label X. Unlink it before scanning another.`
- `This label is already registered on order #REF-…. Use another label.` / `This label is already on order #REF-…. Use another label.` / `This label is already in use. Use another label.`
- `Bosta does not accept this sticker: …`
- A Bosta error message from linking a sticker to a live shipment.

#### `DELETE /api/vendors/orders/:id/smart-label`
Release this vendor's **reserved** sticker on an order so it can be scanned onto another parcel. This is refused once the number is on a live shipment at Bosta.

- **Auth:** Vendor

No body.

**Response `200`:**
```json
{ "success": true, "tracking_number": "SL00012345" }
```

**Errors** (all `400`):
- `Order not found`
- `This shipment has no scanned label.`
- `This label is already on a shipment at Bosta. Cancel that shipment on Bosta to release the number.`

---

## 7. Returns

A customer return covers one store's items from one parcel. The vendor gives an opinion, the admin decides, and the vendor confirms when the goods are back. The statuses are listed in [Appendix A](#returns).

#### `GET /api/vendors/returns`
This vendor's return requests, newest first, paginated.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | number | no | Default 1 (values below 1 read as 1). |
| `limit` | number | no | Default 20, no maximum. |
| `status` | string | no | Exact return `status`; not validated. |

**Response `200`:**
```json
{
  "success": true,
  "returns": [
    {
      "_id": "6702f1a2c3b4a5d6e7f84000",
      "return_number": "RET-1A2B3C4D",
      "order_id": "6702a1e9c3b4a5d6e7f80900",
      "user_id": { "_id": "66f0b8d2a4c3e21f9b7a1c55", "name": "Customer Name", "email": "customer@example.com" },
      "vendor_id": "66d1f0a1b2c3d4e5f6a7b8c9",
      "sub_order_id": "6702a1f0c3b4a5d6e7f80912",
      "items": [{ "_id": "6702f1a2c3b4a5d6e7f84001", "order_item_id": "6702a1e9c3b4a5d6e7f80901", "product_id": "66e9a1b2c3d4e5f6a7b8c9d0", "product_title": "Front Brake Pads", "product_image": "https://readycar.store/uploads/products/product-1.jpg", "variant_id": "66e9a1b2c3d4e5f6a7b8c9d1", "variant_label": "Default", "quantity_purchased": 2, "quantity_returning": 1, "unit_price": 690, "commission_rate": 10, "commission_amount": 69 }],
      "reason": "defective",
      "reason_details": "Squeaks after one day",
      "evidence": [{ "_id": "6702f1a2c3b4a5d6e7f84002", "url": "https://readycar.store/uploads/products/product-2.jpg", "type": "image", "uploaded_at": "2026-10-15T08:00:00.000Z" }],
      "status": "pending_vendor_review",
      "fault_type": "vendor_fault",
      "vendor_review": { "decision": null, "notes": "", "reviewed_at": null },
      "admin_review": { "decision": null, "notes": "", "reviewed_at": null, "reviewed_by": null },
      "refund_id": null,
      "return_window_deadline": "2026-10-26T10:00:00.000Z",
      "history": [{ "_id": "6702f1a2c3b4a5d6e7f84003", "action": "return_created", "title": "Return request created", "details": "Customer requested return for 1 item(s). Reason: defective", "actor_role": "user", "actor_label": "Customer", "metadata": {}, "created_at": "2026-10-15T08:00:00.000Z" }],
      "created_at": "2026-10-15T08:00:00.000Z",
      "updated_at": "2026-10-15T08:00:00.000Z",
      "__v": 0
    }
  ],
  "pagination": { "total": 1, "page": 1, "pages": 1, "limit": 20 }
}
```

- Each row is the whole `ReturnRequest` document with `user_id` populated (`name`, `email`).
- `return_shipment` appears once a return shipment exists (see `GET /returns/:id`).
- `reason`: `defective`, `wrong_item`, `not_as_described`, `changed_mind`, `other`. `fault_type`: `vendor_fault`, `customer_fault`, `undetermined`.

**Errors:**
- `500` — `{ "success": false, "message": "..." }`.

#### `GET /api/vendors/returns/counts`
How many of this vendor's returns are in each status, for tabs and badges.

- **Auth:** Vendor

**Response `200`:**
```json
{
  "success": true,
  "counts": {
    "pending_vendor_review": 1, "vendor_approved": 0, "vendor_rejected": 0,
    "pending_admin_review": 1, "approved": 0, "rejected": 0,
    "return_shipping": 0, "return_received": 0, "refund_processing": 0,
    "completed": 3, "cancelled": 1, "total": 6
  }
}
```
`vendor_approved` and `vendor_rejected` are always 0 (never stored). `total` includes `cancelled`.

**Errors:**
- `500` — `{ "success": false, "message": "..." }`.

#### `GET /api/vendors/returns/:id`
One return request in full, for the vendor's review screen. It includes the customer's contact details.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | Return request id. |

**Response `200`** (same document as a list row, with these differences):
```json
{
  "success": true,
  "return_request": {
    "_id": "6702f1a2c3b4a5d6e7f84000",
    "return_number": "RET-1A2B3C4D",
    "user_id": { "_id": "66f0b8d2a4c3e21f9b7a1c55", "name": "Customer Name", "email": "customer@example.com", "phone": "01000000000" },
    "vendor_id": { "_id": "66d1f0a1b2c3d4e5f6a7b8c9", "name": "Store Owner", "store_name": "Example Auto Parts", "email": "store@example.com", "phone": "01000000001" },
    "status": "return_shipping",
    "return_shipment": {
      "bosta_delivery_id": "dlv_abc123",
      "bosta_tracking_number": "79876543",
      "bosta_status": "Pickup requested",
      "pickup_address": { "address": "Placeholder St, Cairo", "city": "Cairo" },
      "dropoff_address": { "address": "12 Example St, Nasr City", "city": "Cairo" },
      "sent_at": "2026-10-16T09:00:00.000Z",
      "received_at": null,
      "tracking_history": [{ "state": "Pickup requested", "timestamp": "2026-10-16T09:00:00.000Z", "notes": "Return shipment created" }]
    },
    "original_payment_method": "cash",
    "default_refund_method": "store_credit"
  }
}
```

- `user_id` adds `phone`, and `vendor_id` is populated.
- `return_shipment.pickup_address` is the customer's address; `dropoff_address` is the vendor's branch.
- `default_refund_method`: `store_credit`, `original_payment`, `bank_transfer`, `company_account`.

**Errors:**
- `404` — `{ "success": false, "message": "Return request not found" }` (missing, or another vendor's).
- `500` — a malformed id, or a return whose vendor no longer exists.

#### `PUT /api/vendors/returns/:id/review`
The store owner approves or rejects a return. It is an opinion, not the decision: the request is escalated to the admin at once, and the response already shows `pending_admin_review`. If both the vendor and the admin approve, a Bosta return pickup from the customer is booked automatically when the admin approves. Nobody is notified by this call.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `decision` | string | yes | `approved` or `rejected`. |
| `notes` | string | no | Shown to the admin. Not required for a rejection, although the returns guide says it is. |

Example body:
```json
{
  "decision": "approved",
  "notes": "Confirmed a faulty batch"
}
```

**Response `200`** (the updated document, not populated):
```json
{
  "success": true,
  "return_request": {
    "_id": "6702f1a2c3b4a5d6e7f84000",
    "return_number": "RET-1A2B3C4D",
    "user_id": "66f0b8d2a4c3e21f9b7a1c55",
    "vendor_id": "66d1f0a1b2c3d4e5f6a7b8c9",
    "status": "pending_admin_review",
    "vendor_review": { "decision": "approved", "notes": "Confirmed a faulty batch", "reviewed_at": "2026-10-15T12:00:00.000Z" },
    "history": [
      { "action": "vendor_approved", "title": "Vendor approved return", "actor_role": "vendor", "actor_label": "Vendor", "created_at": "2026-10-15T12:00:00.000Z" },
      { "action": "escalated_to_admin", "title": "Escalated to admin", "actor_role": "system", "actor_label": "System", "created_at": "2026-10-15T12:00:00.000Z" }
    ],
    "updated_at": "2026-10-15T12:00:00.000Z"
  }
}
```

**Errors** (`{ "success": false, "message", "code" }`), checked in this order:
- `404` `NOT_FOUND` "Return request not found".
- `403` `VENDOR_MISMATCH` "This return does not belong to your store".
- `400` `INVALID_RETURN_STATUS` "Return is not pending vendor review".
- `400` `INVALID_INPUT` "Decision must be 'approved' or 'rejected'".
- `500` — anything else, a malformed id included.

#### `POST /api/vendors/returns/:id/confirm-receipt`
The store owner confirms the returned goods arrived back at the store. The return moves to `return_received`, the order items' `return_status` becomes `returned`, the order status is recomputed, and the store's completed-orders count is refreshed. The admin then processes the refund. This is accepted at `return_shipping`, and also at `approved` for returns brought back outside Bosta. Bosta's own "returned to business" event does the same thing automatically.

- **Auth:** Vendor

No body.

**Response `200`** (the updated document, not populated):
```json
{
  "success": true,
  "return_request": {
    "_id": "6702f1a2c3b4a5d6e7f84000",
    "return_number": "RET-1A2B3C4D",
    "status": "return_received",
    "return_shipment": { "bosta_tracking_number": "79876543", "received_at": "2026-10-17T14:00:00.000Z" },
    "history": [{ "action": "return_received", "title": "Return goods received", "details": "Vendor/admin confirmed receipt of returned items", "actor_role": "vendor", "actor_label": "Vendor", "created_at": "2026-10-17T14:00:00.000Z" }],
    "updated_at": "2026-10-17T14:00:00.000Z"
  }
}
```
A `return_received_by_vendor` notification is sent to the vendor's own feed. The customer is not notified.

**Errors:**
- `404` — `{ "success": false, "message": "Return request not found" }` (missing, or another vendor's; no `code`).
- `400` `INVALID_RETURN_STATUS` "Return must be in shipping or approved status to confirm receipt".
- `500` — anything else, a malformed id included.

---

## 8. Earnings and payouts

**Earnings.** Each delivered parcel creates one earning row: `net_amount = merchandise − store's coupon share − commission` (shipping is never included).
- It starts `pending` and becomes `available` after the hold period: at least 14 days (the return window), or more if ReadyCar set a longer hold. A daily job at midnight does this.
- It stays `pending` while a return on that parcel is open, and becomes `reversed` if the parcel is cancelled or fully refunded.
- An admin can freeze a row; frozen money shows as `frozen_balance` and is not paid.

**Withdrawals.**
- A request always covers **every** available, unpaid, unfrozen parcel, minus anything the store owes (for example packaging bought from the wallet). The `amount` sent by the client is ignored.
- One open request at a time. It waits as `pending` until an admin approves it, and is then sent through Paymob at once.
- ReadyCar pays the Paymob fees, so the store receives the full `amount`.
- `instant_bank` transfers need at least 112 EGP. There is no other minimum.

**Payout methods** (Paymob Payouts only; there is no InstaPay):

| `type` | Required fields |
|---|---|
| `wallet` | `issuer`: `vodafone`, `etisalat`, `orange` or `bank_wallet`; `msisdn`: an Egyptian mobile |
| `account` | `issuer`: `bank_card` or `instant_bank`; `bank_code`; `bank_card_number` (the account number); `full_name` |
| `iban` | as `account`, with `bank_card_number` = `EG` + 27 digits |
| `card` | `bank_card_number` (16–19 digits), `bank_code`, `full_name` |

`full_name` needs at least 5 characters and 2 words, as the bank has it. `bank_code` must come from the list for the chosen issuer (`GET /api/vendors/wallet/payout-method` → `options.bank_codes`).

### Earnings and wallet

#### `GET /api/vendors/wallet`
The store owner opens the wallet page. It recomputes the cached balances from the ledger first, then returns what one withdrawal request made now would pay, where it would go, and any admin hold.

- **Auth:** Vendor

**Query:** none.

**Response `200`:**
```json
{
  "success": true,
  "wallet": {
    "available_balance": 1250.5,
    "pending_balance": 830,
    "reserved_balance": 0,
    "frozen_balance": 0,
    "total_withdrawn": 4200,
    "total_spent_on_supplies": 85,
    "last_recomputed_at": "2026-10-11T08:00:00.000Z"
  },
  "counts": { "pending_earnings": 3, "available_earnings": 12, "open_withdrawals": 0 },
  "settlement_days": 14,
  "withdrawable": { "orders": 4, "gross": 1250.5, "deductions": 0, "amount": 1250.5 },
  "payout_method": {
    "type": "wallet",
    "issuer": "vodafone",
    "label": { "en": "Vodafone Cash", "ar": "فودافون كاش" },
    "bank_code": null,
    "bank_name": null,
    "full_name": null,
    "account": "010•••••678"
  },
  "payout_method_complete": true,
  "payout_hold": null
}
```
- `withdrawable` is the preview of `POST /wallet/withdrawals`. `amount` can be ≤ 0 when the wallet owes more than the parcels cover. It is `null` if the preview failed.
- `payout_hold` is `{ "reason": "...", "at": "<date>" }` while an admin hold is on.
- `available_balance` can be negative.

**Errors:**
- `500` — `{ success: false, message }`.

#### `GET /api/vendors/wallet/earnings`
The earnings ledger: one row per delivered parcel, newest first. Each row is the whole `VendorEarning` document.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | string | no | `pending`, `available` or `reversed`. Not validated. Frozen rows are not a status: read `frozen.active`. |
| `page` | number | no | Default 1. |
| `limit` | number | no | Default 20. No maximum; `0` returns all rows. |

**Response `200`:**
```json
{
  "success": true,
  "earnings": [
    {
      "_id": "66f2a1c0e4b0a1b2c3d4e701",
      "order_id": "66f1c3b0e4b0a1b2c3d4e600",
      "sub_order_id": "66f1c3b0e4b0a1b2c3d4e601",
      "vendor_id": "66e0aa00e4b0a1b2c3d4e100",
      "gross_amount": 500,
      "coupon_share": 0,
      "commission_amount": 75,
      "net_amount": 425,
      "reversed_net": 0,
      "reversed_commission": 0,
      "reversed_coupon": 0,
      "effective_net": 425,
      "status": "pending",
      "payment_method": "cash",
      "payout_id": null,
      "payout_status": null,
      "paid_at": null,
      "frozen": { "active": false, "reason": null, "by": null, "at": null },
      "early_release": { "at": null, "by": null, "reason": null, "payout_id": null, "undone_at": null },
      "hold_days": 14,
      "delivered_at": "2026-10-05T12:30:00.000Z",
      "clearable_at": "2026-10-19T12:30:00.000Z",
      "cleared_at": null,
      "has_open_return": false,
      "history": [
        {
          "_id": "66f2a1c0e4b0a1b2c3d4e702",
          "action": "earning_created",
          "title": "Earning recorded",
          "details": "Net 425 EGP recorded for delivered parcel REF-AB12CD34-1. Held until 2026-10-19.",
          "actor_role": "system",
          "actor_label": "System",
          "created_at": "2026-10-05T12:30:01.000Z"
        }
      ],
      "created_at": "2026-10-05T12:30:01.000Z",
      "updated_at": "2026-10-05T12:30:01.000Z"
    }
  ],
  "pagination": { "total": 15, "page": 1, "pages": 1, "limit": 20 }
}
```
- `payout_status`: `null` (unpaid), `requested`, `processing` or `paid`.
- Older rows may have `payout_id` set and `payout_status: null`. Read those as paid.
- `early_release` is set when an admin paid the parcel before `clearable_at`.

**Errors:**
- `500` — `{ success: false, message }`. A non-numeric `limit` probably lands here too (unverified).

### Payouts

#### `POST /api/vendors/wallet/withdrawals`
The store owner asks to be paid. The request always covers every settled, unpaid, unfrozen parcel, less what the wallet already owes. Those parcels are claimed at once, so an admin cannot pay them twice. The request waits as `pending` until an admin approves it, and is sent through Paymob to the saved payout method the moment it is approved. Paymob is the only way: there is no bank transfer by hand.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `channel` | string | no | Only `"paymob"`, which is also the default. Any other value is refused. |
| `notes` | string | no | |
| `bank_details` | object | — | **Ignored.** |
| `amount` | number | — | **Ignored.** The amount is always computed. |

Example body:
```json
{
  "channel": "paymob"
}
```

**Response `201`:** `withdrawal` is the whole `WithdrawalRequest` document. It is not masked: `payout_method` carries the full number.
```json
{
  "success": true,
  "withdrawal": {
    "_id": "66f3b2d0e4b0a1b2c3d4e900",
    "withdrawal_number": "WD-1A2B3C4D",
    "vendor_id": "66e0aa00e4b0a1b2c3d4e100",
    "amount": 1250.5,
    "gross_amount": 1250.5,
    "deductions": 0,
    "initiated_by": "vendor",
    "channel": "paymob",
    "payout_method": {
      "issuer": "vodafone",
      "msisdn": "01012345678",
      "bank_card_number": null,
      "bank_code": null,
      "bank_name": null,
      "full_name": null
    },
    "gateway": {
      "provider": "paymob",
      "client_reference_id": "0b6f6c1e-3f7a-4b8e-9a51-2a8c0f1d9e77",
      "transaction_id": null,
      "sent_at": null,
      "outcome_unknown": false,
      "needs_review": false
    },
    "lines": [
      {
        "earning_id": "66f2a1c0e4b0a1b2c3d4e701",
        "order_id": "66f1c3b0e4b0a1b2c3d4e600",
        "sub_order_id": "66f1c3b0e4b0a1b2c3d4e601",
        "reference": "REF-AB12CD34-1",
        "delivered_at": "2026-09-20T12:30:00.000Z",
        "clearable_at": "2026-10-04T12:30:00.000Z",
        "gross_amount": 500,
        "coupon_share": 0,
        "commission_amount": 75,
        "reversed_net": 0,
        "amount": 425,
        "paid_early": false
      }
    ],
    "earning_ids": ["66f2a1c0e4b0a1b2c3d4e701"],
    "scheduled_for": "2026-10-11T00:00:00.000Z",
    "status": "pending",
    "history": [ { "action": "withdrawal_requested", "title": "Withdrawal requested", "details": "4 order(s): 1250.5 EGP = 1250.5 EGP via Paymob (Vodafone Cash)." } ],
    "created_at": "2026-10-11T08:05:00.000Z",
    "updated_at": "2026-10-11T08:05:00.000Z"
  }
}
```

**Errors:** `{ success: false, message, code }`
- `400` — `INVALID_INPUT`: a `channel` other than `paymob`.
- `400` — `BELOW_MINIMUM`: the method is `instant_bank` and the amount is under 112 EGP.
- `404` — `NOT_FOUND`: vendor not found.
- `409` — `WITHDRAWAL_EXISTS`: a vendor request is already `pending`, `approved` or `processing`.
- `409` — `PAYOUTS_ON_HOLD`: an admin hold is on; the message includes the reason.
- `409` — `NOTHING_PAYABLE`: there are no settled parcels.
- `409` — `NO_PAYOUT_METHOD`: no complete payout method saved yet (`PUT /api/vendors/wallet/payout-method`).
- `409` — `NOTHING_TO_TRANSFER`: the amount after deductions is ≤ 0.
- `409` — `BUSY`: another payout for this vendor is being prepared; retry shortly.
- `409` — `INVALID_STATUS`: a parcel changed while the request was prepared; reload.
- `500` — other errors.

#### `GET /api/vendors/wallet/withdrawals`
The store's payout history, newest first. It includes requests the vendor made and payouts an admin sent (`initiated_by: "admin"`). Draft records are hidden.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | string | no | Any withdrawal status. `draft` is not blocked (see [Known issues](#appendix-c-known-issues)). |
| `page` | number | no | Default 1. |
| `limit` | number | no | Default 20. No maximum. |

**Response `200`:** Each row is the document without `history`, `gateway.attempts` and `gateway.client_reference_id`. `payout_method` is replaced by a masked `destination`, and the `bank_details` numbers are masked.
```json
{
  "success": true,
  "withdrawals": [
    {
      "_id": "66f3b2d0e4b0a1b2c3d4e900",
      "withdrawal_number": "WD-1A2B3C4D",
      "amount": 1250.5,
      "gross_amount": 1250.5,
      "deductions": 0,
      "initiated_by": "vendor",
      "channel": "paymob",
      "status": "paid",
      "destination": {
        "type": "wallet",
        "issuer": "vodafone",
        "label": { "en": "Vodafone Cash", "ar": "فودافون كاش" },
        "bank_code": null,
        "bank_name": null,
        "full_name": null,
        "account": "010•••••678"
      },
      "gateway": {
        "provider": "paymob",
        "transaction_id": "8f2c1a",
        "disbursement_status": "successful",
        "status_code": "200",
        "status_description": "Transaction received and validated successfully.",
        "fees": 5,
        "vat": 0.7,
        "sent_at": "2026-10-11T09:00:00.000Z",
        "outcome_unknown": false,
        "needs_review": false
      },
      "bank_details": { "bank_name": null, "account_holder": null, "account_number": null, "iban": null, "notes": "" },
      "lines": [ { "reference": "REF-AB12CD34-1", "amount": 425, "paid_early": false } ],
      "earning_ids": ["66f2a1c0e4b0a1b2c3d4e701"],
      "admin_review": { "decision": "approved", "notes": "", "reviewed_at": "2026-10-11T09:00:00.000Z", "reviewed_by": "finance1" },
      "rejection_reason": null,
      "paid_at": "2026-10-11T09:00:05.000Z",
      "payment_reference": null,
      "scheduled_for": "2026-10-11T00:00:00.000Z",
      "created_at": "2026-10-11T08:05:00.000Z",
      "updated_at": "2026-10-11T09:00:05.000Z"
    }
  ],
  "pagination": { "total": 7, "page": 1, "pages": 1, "limit": 20 }
}
```
- `destination` is `null` for a manual transfer. Read `bank_details` instead.
- In `bank_details`, `account_number` is masked keeping 3 characters at each end, `iban` keeping 4.

**Errors:**
- `500` — `{ success: false, message }`.

#### `GET /api/vendors/wallet/payout-method`
Loads the "where should we send your money" form: the saved method in full, plus the choices the form offers. The full number is returned so the form can be edited.

- **Auth:** Vendor

**Query:** none.

**Response `200`:**
```json
{
  "success": true,
  "method": {
    "type": "account",
    "issuer": "instant_bank",
    "msisdn": null,
    "bank_card_number": "100012345678",
    "bank_code": "CIB",
    "full_name": "Ahmed Mohamed Ali",
    "updated_at": "2026-10-01T09:12:00.000Z",
    "label": { "en": "Bank account — Fast transfer (minutes to hours)", "ar": "حساب بنكي — تحويل سريع (دقايق لساعات)" },
    "bank_name": "Commercial International Bank - Egypt S.A.E",
    "account": "100012345678"
  },
  "complete": true,
  "payout_hold": null,
  "options": {
    "issuers": [
      { "id": "vodafone", "label": { "en": "Vodafone Cash", "ar": "فودافون كاش" } },
      { "id": "instant_bank", "label": { "en": "Fast transfer (minutes to hours)", "ar": "تحويل سريع (دقايق لساعات)" } }
    ],
    "wallet_issuers": ["vodafone", "etisalat", "orange", "bank_wallet"],
    "bank_codes": {
      "bank_card": { "CIB": "Commercial International Bank - Egypt S.A.E", "MIDB": "MIDBANK" },
      "instant_bank": { "CIB": "Commercial International Bank - Egypt S.A.E", "MIDBANK": "MIDBANK" }
    },
    "min_amount": { "instant_bank": 112 }
  }
}
```
- `method` is `null` when nothing is saved.
- `complete` says whether the saved method passes validation today.
- `options.issuers` lists all six issuers: `vodafone`, `etisalat`, `orange`, `bank_wallet`, `bank_card`, `instant_bank`.
- The two `bank_codes` lists differ. Send a code from the list that matches the chosen issuer.

**Errors:**
- `404` — `NOT_FOUND`: vendor not found.
- `500` — other errors.

#### `PUT /api/vendors/wallet/payout-method`
The store owner saves where payouts go. This needs the account password. The saved method replaces the old one, and the vendor gets a `payout_method_changed` notification naming the old and new destinations. Requests already made keep the destination they copied when they were created.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `password` | string | yes | The vendor's account password. |
| `type` | string | yes* | `wallet`, `account`, `iban` or `card`. *Can be left out for legacy shapes; it is then inferred from `issuer` and the number. |
| `issuer` | string | yes | `wallet`: `vodafone`, `etisalat`, `orange` or `bank_wallet`. `account` / `iban`: `bank_card` (standard, about 2 working days) or `instant_bank` (fast; minimum 112 EGP per payout). `card`: always stored as `bank_card`. |
| `msisdn` | string | `wallet` | Egyptian mobile; stored as `01XXXXXXXXX`. |
| `bank_card_number` | string | `account` / `iban` / `card` | Account number: 6–29 digits (`bank_card`) or 6–20 (`instant_bank`). IBAN: `EG` + 27 digits. Card: 16–19 digits. |
| `bank_code` | string | `account` / `iban` / `card` | A key from the issuer's list in `options.bank_codes`. Case-sensitive. |
| `full_name` | string | `account` / `iban` / `card` | At least 5 characters and 2 words, exactly as the bank has it. Optional for `wallet`. |

Example body:
```json
{
  "password": "secret123",
  "type": "wallet",
  "issuer": "vodafone",
  "msisdn": "01012345678"
}
```

**Response `200`:** the same `method`, `complete` and `payout_hold` as the GET, without `options`.
```json
{
  "success": true,
  "method": {
    "type": "wallet",
    "issuer": "vodafone",
    "msisdn": "01012345678",
    "bank_card_number": null,
    "bank_code": null,
    "full_name": null,
    "updated_at": "2026-10-11T08:00:00.000Z",
    "label": { "en": "Vodafone Cash", "ar": "فودافون كاش" },
    "bank_name": null,
    "account": "01012345678"
  },
  "complete": true,
  "payout_hold": null
}
```

**Errors:** `{ success: false, message, code }`
- `400` — `INVALID_INPUT`: a sentence the vendor can act on. For example "Choose how you want to receive your money.", "Choose which wallet this number is on.", "Enter the IBAN: EG followed by 27 digits.", "Choose the bank from the list."
- `401` — `WRONG_PASSWORD`: the password is missing or wrong. **The session is still valid.**
- `404` — `NOT_FOUND`: vendor not found.
- `500` — other errors.

#### `GET /api/vendors/wallet/payouts/:id`
One payout (or withdrawal request) shown as an invoice: who was paid, where to, for which parcels, and Paymob's status. Account numbers are masked.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | A withdrawal `_id` from the list. |

**Response `200`:**
```json
{
  "success": true,
  "invoice": {
    "number": "WD-1A2B3C4D",
    "issued_at": "2026-10-11T08:05:00.000Z",
    "paid_at": "2026-10-11T09:00:05.000Z",
    "status": "paid",
    "initiated_by": "vendor",
    "channel": "paymob",
    "destination": {
      "type": "wallet",
      "issuer": "vodafone",
      "label": { "en": "Vodafone Cash", "ar": "فودافون كاش" },
      "bank_code": null,
      "bank_name": null,
      "full_name": null,
      "account": "010•••••678"
    },
    "payment_reference": "8f2c1a",
    "gross_amount": 1250.5,
    "deductions": 0,
    "amount": 1250.5,
    "notes": "",
    "rejection_reason": null
  },
  "vendor": { "name": "Ahmed Mohamed", "store_name": "Example Auto Parts", "email": "store@example.com", "phone": "01000000000" },
  "lines": [ { "earning_id": "66f2a1c0e4b0a1b2c3d4e701", "reference": "REF-AB12CD34-1", "gross_amount": 500, "coupon_share": 0, "commission_amount": 75, "reversed_net": 0, "amount": 425 } ],
  "gateway": {
    "transaction_id": "8f2c1a",
    "disbursement_status": "successful",
    "status_description": "Transaction received and validated successfully.",
    "sent_at": "2026-10-11T09:00:00.000Z",
    "outcome_unknown": false,
    "needs_review": false
  },
  "history": [ { "action": "withdrawal_requested", "title": "Withdrawal requested", "created_at": "2026-10-11T08:05:00.000Z" } ]
}
```
- For a manual transfer, `destination` is `{ label: { en: "Bank transfer", ar: "تحويل بنكي" }, bank_name, full_name, account (masked) }` and `gateway` is `null`.
- `outcome_unknown: true` means the transfer was sent and Paymob has not answered yet. It is checked automatically and never re-sent.

**Errors:**
- `404` — `NOT_FOUND`: no such payout, it is a draft, or it belongs to another vendor.
- `500` — a malformed id.

#### `POST /api/vendors/wallet/withdrawals/:id/cancel`
The store owner withdraws a request an admin has not reviewed yet. The claimed parcels go back to the wallet as unpaid.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | The withdrawal `_id`. |

**Body:** none.

**Response `200`:** `withdrawal` is the whole updated document, with `status: "cancelled"`.
```json
{
  "success": true,
  "withdrawal": { "_id": "66f3b2d0e4b0a1b2c3d4e900", "withdrawal_number": "WD-1A2B3C4D", "amount": 1250.5, "status": "cancelled", "updated_at": "2026-10-11T08:20:00.000Z" }
}
```

**Errors:** `{ success: false, message, code }`
- `400` — `INVALID_STATUS`: not `pending` (already approved, sent, paid, rejected or cancelled). This includes an approval that won a race.
- `404` — `NOT_FOUND`: no such withdrawal, or another vendor's.
- `500` — a malformed id, or another error.

---

## 9. Subscription

Which call to use:

| Situation | Call |
|---|---|
| No active subscription (new store without a trial) | `POST /purchase` |
| The subscription ended (expired or cancelled) | `POST /resubscribe` (or `POST /purchase`) |
| Extend the current plan | `POST /renew` |
| Switch to another plan while one is active, including trial → paid | `POST /change-plan` |

- A free-trial package activates at once; each store can have one free trial ever (`GET /free-trial`).
- Every paid call returns `paymentUrl` and `payment.id`. Open the URL, then **always** call `POST /confirm-payment` (see [Online payment](#online-payment-the-app-must-confirm)).
- Send the package's own `billing_period`; the price is always the package price.

#### `GET /api/vendors/subscription/status`
The subscription page header: the live subscription and its package, how many products are published against the limit, and whether expiry is near.

- **Auth:** Vendor

**Query:** none.

**Response `200`** (active):
```json
{
  "success": true,
  "hasActive": true,
  "subscription": {
    "_id": "66e0ab00e4b0a1b2c3d4e200",
    "started_at": "2026-09-15T10:00:00.000Z",
    "expires_at": "2026-10-15T10:00:00.000Z",
    "status": "active",
    "is_free_trial": false
  },
  "package": {
    "_id": "66d0aa00e4b0a1b2c3d4e050",
    "name": "Basic",
    "description": "Up to 100 products",
    "price": 299,
    "billing_period": "monthly",
    "max_products": 100,
    "is_free_trial": false,
    "trial_days": 0
  },
  "publishedCount": 42,
  "maxProducts": 100,
  "remaining": 58,
  "subscriptionStatus": "active",
  "isExpiringSoon": true,
  "daysUntilExpiry": 4
}
```
- With no active subscription: `hasActive: false`, `subscription: null`, `package: null`, `maxProducts: 0`, `remaining: 0`, `isExpiringSoon: false`, `daysUntilExpiry: null`. `subscriptionStatus` is then the seller's value (`not_subscribed`, `cancelled`, `suspended`, …).
- `isExpiringSoon` is true when 0 < `daysUntilExpiry` ≤ 7.
- `publishedCount` counts products with `status: published`.
- `package` has no `name_ar`.

**Errors:**
- `500` — `{ success: false, message }`.

#### `GET /api/vendors/subscription/packages`
The plans a vendor can buy: every `active` package, cheapest first. Free-trial packages are included even if this vendor has already used their trial. Use `GET /free-trial` to hide them.

- **Auth:** Vendor

**Query:** none.

**Response `200`:** `packages` holds whole `SubscriptionPackage` documents.
```json
{
  "success": true,
  "packages": [
    {
      "_id": "66d0aa00e4b0a1b2c3d4e050",
      "name": "Basic",
      "name_ar": "الأساسية",
      "description": "Up to 100 products",
      "description_ar": "حتى 100 منتج",
      "price": 299,
      "billing_period": "monthly",
      "max_products": 100,
      "status": "active",
      "is_free_trial": false,
      "trial_days": 0,
      "grants_vendors_page": true,
      "grants_home_slider": false,
      "createdAt": "2026-05-01T10:00:00.000Z",
      "updatedAt": "2026-05-01T10:00:00.000Z"
    }
  ]
}
```
- `billing_period` is `monthly`, `yearly` or `trial`; free-trial packages always have `price: 0` and `billing_period: "trial"`.
- `grants_*` are the visibility perks applied while subscribed.

**Errors:**
- `500` — `{ success: false, message }`.

#### `GET /api/vendors/subscription/free-trial`
Tells the plan picker whether this vendor has already had a free trial. Any past subscription with `is_free_trial` counts, including the one given automatically at sign-up.

- **Auth:** Vendor

**Query:** none.

**Response `200`:**
```json
{ "success": true, "usedFreeTrial": true }
```

**Errors:**
- `500` — `{ success: false, message }`.

#### `POST /api/vendors/subscription/purchase`
A store with no active subscription buys a plan.
- **Free trial:** activates at once. A subscription is created, hidden products are republished, the seller becomes `trial_active`, and package perks are applied.
- **Paid plan:** creates a pending `SubscriptionPayment` and a hosted payment page. Nothing changes until `POST /confirm-payment` (or the Paymob webhook) finds it paid.

A vendor on a trial or a paid plan gets `ALREADY_SUBSCRIBED` and must use `/change-plan`.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `packageId` | ObjectId | yes | From `GET /packages`. |
| `billing_period` | string | no | `"yearly"` sets a 12-month subscription; anything else, 1 month. Default `monthly`. **The price is always `package.price`.** Send the package's own `billing_period` (see [Known issues](#appendix-c-known-issues)). |

Example body:
```json
{
  "packageId": "66d0aa00e4b0a1b2c3d4e050",
  "billing_period": "monthly"
}
```

**Response `201`** (paid plan):
```json
{
  "success": true,
  "requiresPayment": true,
  "message": "Payment invoice created successfully",
  "paymentUrl": "https://app.fawaterk.com/link/AbC123",
  "payment": {
    "id": "66f4c3e0e4b0a1b2c3d4ea00",
    "status": "pending",
    "invoiceId": "1234567",
    "invoiceKey": "AbC123xyz"
  }
}
```
Keep `payment.id` and open `paymentUrl`. The browser comes back to `${FRONTEND_URL}/dashboard/subscription?payment=<status>&paymentId=<id>`. Then call `POST /api/vendors/subscription/confirm-payment`.

**Response `201`** (free trial):
```json
{
  "success": true,
  "message": "Subscription activated successfully",
  "subscription": {
    "_id": "66f4c3e0e4b0a1b2c3d4ea10",
    "vendor_id": "66e0aa00e4b0a1b2c3d4e100",
    "package_id": "66d0aa00e4b0a1b2c3d4e051",
    "started_at": "2026-10-11T08:00:00.000Z",
    "expires_at": "2026-10-25T08:00:00.000Z",
    "status": "active",
    "is_free_trial": true,
    "is_admin_grant": false,
    "auto_renew": false,
    "expiry_reminders_sent": [],
    "cancelled_at": null,
    "cancellation_reason": null,
    "createdAt": "2026-10-11T08:00:00.000Z",
    "updatedAt": "2026-10-11T08:00:00.000Z"
  }
}
```
A trial lasts `trial_days` days, or 1 month (12 with `yearly`) when `trial_days` is 0.

**Errors:** `{ success: false, code, message }`
- `400` — `packageId is required` (no `code`).
- `400` — `PACKAGE_INACTIVE`.
- `400` — `INVALID_AMOUNT`: a paid package priced 0.
- `400` — `PAYMENT_URL_MISSING`, or a provider error with no `code`.
- `400` — a malformed `packageId` (no `code`).
- `404` — `PACKAGE_NOT_FOUND`.
- `409` — `ALREADY_SUBSCRIBED`: an active subscription exists, trial included.
- `409` — `FREE_TRIAL_ALREADY_USED`.

#### `POST /api/vendors/subscription/renew`
The store owner extends the current subscription on the same package, at the package's current price. Always paid. When the payment is confirmed:
- `expires_at` moves forward 1 month (12 with `yearly`) from the current expiry if that is still ahead, otherwise from now;
- the seller becomes `active`;
- hidden products are republished.

This works only while the subscription row is still `active`. That includes the hours between `expires_at` and the midnight expiry run. After that run, use `/resubscribe` or `/purchase`.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `billing_period` | string | no | As in `/purchase`. Default `monthly`. |

Example body:
```json
{
  "billing_period": "monthly"
}
```

**Response `200`** (not 201):
```json
{
  "success": true,
  "requiresPayment": true,
  "message": "Renewal payment invoice created successfully",
  "paymentUrl": "https://app.fawaterk.com/link/AbC124",
  "payment": { "id": "66f4c3e0e4b0a1b2c3d4ea01", "status": "pending", "invoiceId": "1234568", "invoiceKey": "AbC124xyz" }
}
```

**Errors:** `{ success: false, code, message }`
- `400` — `INVALID_AMOUNT`: the current package is a free trial ("Renewal package amount must be greater than zero"). A trial vendor must use `/change-plan`.
- `400` — `PAYMENT_URL_MISSING`, or a provider error.
- `404` — `NO_SUBSCRIPTION`: no active subscription.

#### `POST /api/vendors/subscription/resubscribe`
A store whose subscription ended (expired or cancelled) subscribes again, possibly to a different package. A free-trial package activates at once; a paid one returns a payment link. On activation:
- a new subscription is created;
- hidden products are republished;
- the seller becomes `active` (or `trial_active`), and `sellers.status` is set to `active`;
- a `product_visibility_restored` notification says how many products came back.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `packageId` | ObjectId | yes | |
| `billing_period` | string | no | As in `/purchase`. |
| `selectedProductIds` | ObjectId[] | when asked | Products to keep published, 1 to `max_products` of them. Needed only after a `SELECT_PRODUCTS_REQUIRED` answer. Stored on the payment and applied on activation. **The selection is currently undone on activation** (see [Known issues](#appendix-c-known-issues)). |

Example body:
```json
{
  "packageId": "66d0aa00e4b0a1b2c3d4e050",
  "billing_period": "monthly"
}
```

**Response `201`:**
- Paid: the same shape as `/purchase`.
- Free trial: `{ "success": true, "message": "Account reactivated and subscription activated", "subscription": { … } }`.

**Errors:** `{ success: false, code, message, ...extras }`
- `400` — `packageId is required` (no `code`).
- `400` — `PACKAGE_NOT_FOUND`: missing or inactive package (400 here, not 404).
- `400` — `SELECT_PRODUCTS_REQUIRED`: more previously approved products than the plan allows. Adds the extras below.
- `400` — `INVALID_AMOUNT`, `PAYMENT_URL_MISSING`, or a provider error.
- `409` — `FREE_TRIAL_ALREADY_USED`.

`SELECT_PRODUCTS_REQUIRED` extras:
```json
{
  "success": false,
  "code": "SELECT_PRODUCTS_REQUIRED",
  "message": "You have 120 products previously approved for publishing but this plan only allows 100. Please select up to 100 products to keep published.",
  "excessCount": 20,
  "maxProducts": 100,
  "allProducts": [ { "_id": "66c0aa00e4b0a1b2c3d4e300", "title": "Brake pads — Corolla 2018" } ]
}
```
The check does not refuse a vendor who still has an active subscription (see [Known issues](#appendix-c-known-issues)).

#### `POST /api/vendors/subscription/change-plan`
The store owner switches the live subscription (trial or paid) to another package. This is also how a trial vendor upgrades to a paid plan. When the payment is confirmed, or at once for a free-trial target:
- the old subscription is cancelled with the reason "Changed subscription plan";
- a new one starts **now** with a full period, and unused days are not credited;
- the seller becomes `active` / `trial_active`;
- the new package's perks are applied.

On a downgrade below the current published count, the products not selected are hidden. An upgrade does not republish anything.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `packageId` | ObjectId | yes | Must differ from the current package. |
| `billing_period` | string | no | As in `/purchase`. |
| `selectedProductIds` | ObjectId[] | when asked | Products to keep published when `status: published` products outnumber the new `max_products`. |

Example body:
```json
{
  "packageId": "66d0aa00e4b0a1b2c3d4e051",
  "billing_period": "monthly"
}
```

**Response `201`:**
- Paid: the same shape as `/purchase`.
- Free trial: `{ "success": true, "message": "Subscription plan changed successfully", "subscription": { … } }`.

**Errors:** `{ success: false, code, message, ...extras }`
- `400` — `packageId is required` (no `code`).
- `400` — `PACKAGE_NOT_FOUND`: missing or inactive package.
- `400` — `SELECT_PRODUCTS_REQUIRED`: the same extras as `/resubscribe`, counted over `status: published` products.
- `400` — `INVALID_AMOUNT`, `PAYMENT_URL_MISSING`, or a provider error.
- `404` — `NO_SUBSCRIPTION`.
- `409` — `SAME_PACKAGE`.
- `409` — `FREE_TRIAL_ALREADY_USED`.

#### `POST /api/vendors/subscription/confirm-payment`
The vendor is back from the payment page. The server asks the provider (Fawaterak or Paymob, whichever is stored on the payment) whether the invoice is paid. If it is, it runs the stored action (purchase, renew, resubscribe or change_plan) and marks the payment `paid`.

**This is the only way a Fawaterak subscription payment is activated:** the webhook is rejected in production and no sweep exists. Call it on every return, whatever `?payment=` says, and retry with backoff while it answers `pending`. Calling it again after `paid` is safe. Do not send two at once: renewals are not race-safe.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `paymentId` | ObjectId | one of the two | `payment.id` from the purchase / renew / resubscribe / change-plan answer, or `paymentId` from the return URL. |
| `invoice_id` | string | one of the two | The provider invoice id, if the return URL carries one. If both are sent, they must belong to the same payment. |

Example body:
```json
{
  "paymentId": "66f4c3e0e4b0a1b2c3d4ea00"
}
```

**Response `200`:**
```json
{ "success": true, "status": "paid", "message": "Payment confirmed and subscription activated" }
```
- `message` is `"Payment was already confirmed"` on a repeat call.
- Not paid yet: `{ "success": true, "status": "pending", "message": "Payment is not confirmed yet" }`.
- The subscription itself is not returned. Call `GET /status` afterwards.

**Errors:** `{ success: false, code, message }`
- `400` — `PAYMENT_REFERENCE_REQUIRED`: neither field was sent, or a Fawaterak payment has no invoice id (the invoice was never created).
- `400` — `INVOICE_MISMATCH`.
- `400` — activation failed after the provider reported the payment paid: `ALREADY_SUBSCRIBED`, `NO_SUBSCRIPTION`, `SELECT_PRODUCTS_REQUIRED`, `PACKAGE_NOT_FOUND`, … The payment stays `pending` with `activation_error`, and support must step in.
- `400` — a provider error or a malformed `paymentId`.
- `404` — `PAYMENT_NOT_FOUND`: no such payment for this vendor.

---

## 10. Packaging supplies

Packaging the store can order from ReadyCar (poly mailers, boxes, stickers, labels). Prices are per pack. No subscription is needed.

The store's available earnings pay first; a payment page covers the rest. When earnings cover everything, the order is paid at once and `payment_url` is `null`.

The whole `vendorRouter` sits behind `vendorRouter.use(protect('vendor'))`, except the Fawaterak webhook, which is declared before that line and is public. No subscription is required to buy supplies.

#### `GET /api/vendors/supplies/catalogue`
The packaging shop: every active supply item. Prices are **per pack**; `pack_size` says how many pieces are in a pack.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `category` | string | no | `poly_mailer`, `box`, `sticker`, `label` or `other`. `all` or no value means every category. Not validated. |

**Response `200`:** `products` holds whole `SupplyProduct` documents, sorted by `sort_order`, then `category`, then `price`.
```json
{
  "success": true,
  "products": [
    {
      "_id": "66b0aa00e4b0a1b2c3d4e400",
      "name": "Medium poly mailer",
      "name_ar": "فلير متوسط",
      "description": "",
      "description_ar": "",
      "category": "poly_mailer",
      "dimensions": "35 × 40 cm",
      "price": 4.5,
      "pack_size": 10,
      "unit_label": "piece",
      "unit_label_ar": "قطعة",
      "min_order_quantity": 1,
      "max_order_quantity": null,
      "image": "",
      "is_active": true,
      "sort_order": 11,
      "createdAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-01T10:00:00.000Z"
    }
  ]
}
```
`max_order_quantity: null` means no ceiling. There is no stock count: an inactive item is out of stock.

**Errors:**
- `400` — `{ success: false, code: "SUPPLY_ERROR", message }` on any failure.

#### `GET /api/vendors/supplies/orders`
The vendor's supply orders, newest first. Each row is the whole `SupplyOrder` document, the same shape as the `order` in `POST /orders` below.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | number | no | Default 1. |
| `limit` | number | no | Default 20, maximum 100. |

There is no status filter.

**Response `200`:**
```json
{
  "success": true,
  "orders": [ { "_id": "66f5d4f0e4b0a1b2c3d4eb00", "order_number": "SUP-9F3A1C2B", "total": 90, "payment_status": "paid", "status": "sent" } ],
  "pagination": { "page": 1, "limit": 20, "total": 3, "pages": 1 }
}
```
The `pagination` keys are ordered `page, limit, total, pages`.

**Errors:**
- `400` — `SUPPLY_ERROR`.

#### `POST /api/vendors/supplies/orders`
The store owner orders packaging. The server prices every line from the catalogue (prices sent by the client are ignored).
- The earnings wallet pays as much as it can.
- A hosted invoice covers the rest.
- A wallet share is held by the order row itself, so a cancelled or failed order releases it with no ledger entry.
- A wallet-only order is `paid` immediately and the admins are notified. A part-online order is `awaiting_online` until its payment is confirmed.

- **Auth:** Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | array | yes | `[{ "product_id": "<SupplyProduct id>", "quantity": 2 }]`. `quantity` is in packs and rounded down. Lines with quantity < 1 are skipped. An unknown or inactive `product_id` fails the whole order. |
| `vendor_note` | string | no | Cut to 500 characters. |
| `delivery_method` | string | no | `with_pickup` (default), `courier` or `handover`. Any other value fails validation (`400 SUPPLY_ERROR`). |

Example body:
```json
{
  "items": [
    {
      "product_id": "66b0aa00e4b0a1b2c3d4e400",
      "quantity": 2
    }
  ],
  "delivery_method": "with_pickup",
  "vendor_note": ""
}
```

**Response `201`:**
```json
{
  "success": true,
  "order": {
    "_id": "66f5d4f0e4b0a1b2c3d4eb00",
    "order_number": "SUP-9F3A1C2B",
    "vendor_id": "66e0aa00e4b0a1b2c3d4e100",
    "items": [
      {
        "_id": "66f5d4f0e4b0a1b2c3d4eb01",
        "product_id": "66b0aa00e4b0a1b2c3d4e400",
        "name": "Medium poly mailer",
        "name_ar": "فلير متوسط",
        "dimensions": "35 × 40 cm",
        "category": "poly_mailer",
        "quantity": 20,
        "unit_price": 4.5,
        "pack_size": 10,
        "unit_label": "piece",
        "unit_label_ar": "قطعة",
        "line_total": 90
      }
    ],
    "total": 90,
    "wallet_amount": 60,
    "online_amount": 30,
    "payment_status": "awaiting_online",
    "settled_at": null,
    "payment": {
      "provider": "fawaterak",
      "provider_mode": "live",
      "invoice_id": "1234569",
      "invoice_key": "XyZ789",
      "payment_url": "https://app.fawaterk.com/link/XyZ789",
      "payment_method": null,
      "provider_reference": "1234569",
      "attempt": 1,
      "paid_at": null,
      "error": null,
      "raw_response": { "status": "success", "data": { "invoiceId": 1234569, "invoiceKey": "XyZ789", "url": "https://app.fawaterk.com/link/XyZ789" } },
      "webhook_payloads": []
    },
    "status": "pending",
    "ship_to": { "contact_name": "Ahmed Mohamed", "phone": "01000000000", "address": "12 Example St", "city": "Cairo" },
    "delivery": { "method": "with_pickup", "tracking_number": "", "notes": "", "sent_at": null, "delivered_at": null },
    "vendor_note": "",
    "admin_note": "",
    "rejection_reason": "",
    "history": [ { "action": "order_placed", "title": "Order placed", "details": "1 item(s), 90 EGP — 60 from wallet, 30 online." } ],
    "createdAt": "2026-10-11T08:30:00.000Z",
    "updatedAt": "2026-10-11T08:30:01.000Z"
  },
  "payment_url": "https://app.fawaterk.com/link/XyZ789"
}
```
- `payment_url: null` means the wallet paid the whole order (`payment_status: "paid"`).
- Otherwise, open the URL. The browser returns to `${FRONTEND_URL}/dashboard/supplies?payment=<status>&orderId=<order._id>`. Then call `POST /orders/:id/confirm-payment`.
- `ship_to` is copied from the vendor's default branch.

**Errors:** `{ success: false, code, message }`
- `400` — `EMPTY_ORDER`: no items, or every quantity < 1.
- `400` — `ITEM_UNAVAILABLE`.
- `400` — `BELOW_MIN` / `ABOVE_MAX`: outside the item's `min_order_quantity` / `max_order_quantity`.
- `400` — `INVALID_TOTAL`.
- `400` — `PAYMENT_START_FAILED`: the invoice could not be created. **The order is still kept**, with `payment_status: "failed"` and the wallet hold released. Its id is not in the error; find it in `GET /orders` and retry with `/pay`.
- `400` — `PAYMENT_URL_MISSING`: the order is kept, `awaiting_online`.
- `400` — `SUPPLY_ERROR`: for example a bad `delivery_method`.
- `404` — `VENDOR_NOT_FOUND`.
- `409` — `WALLET_CHANGED`: a parallel spend pushed the wallet negative. This order was voided (`cancelled`); try again.

#### `POST /api/vendors/supplies/orders/:id/pay`
Resumes the payment of an unpaid order: one whose invoice failed to open, or one the vendor walked away from.
- If the order is `awaiting_online` and already has a page, the stored `payment_url` is returned as it is.
- Otherwise the wallet share is held again and a new invoice is opened, with a new Paymob attempt number.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | The supply order `_id`. |

**Body:** none.

**Response `200`:**
```json
{ "success": true, "order": { "_id": "66f5d4f0e4b0a1b2c3d4eb00", "payment_status": "awaiting_online", "payment": { "attempt": 2, "payment_url": "https://app.fawaterk.com/link/XyZ790" } }, "payment_url": "https://app.fawaterk.com/link/XyZ790" }
```
`order` is the whole document.

**Errors:** `{ success: false, code, message }`
- `400` — `ALREADY_PAID`.
- `400` — `ORDER_CLOSED`: the order is `cancelled` or `rejected`.
- `400` — `PAYMENT_START_FAILED` or `PAYMENT_URL_MISSING`.
- `400` — `SUPPLY_ERROR`: a malformed id.
- `404` — `NOT_FOUND`: no such order, or another vendor's.

#### `POST /api/vendors/supplies/orders/:id/confirm-payment`
The vendor is back from the payment page. The server re-reads the online half from the provider stored on the order and settles the order if it is paid: `payment_status` becomes `paid`, the wallet share moves from reserved to spent, and the admins are notified. Nothing from the browser is trusted.

Call this on every return. An hourly sweep settles any order it misses, so a vendor who closes the tab is still settled within about an hour.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | `orderId` from the return URL. |

**Body:** none.

**Response `200`:**
```json
{ "success": true, "status": "paid", "alreadyPaid": false, "order": { "_id": "66f5d4f0e4b0a1b2c3d4eb00", "payment_status": "paid", "settled_at": "2026-10-11T08:35:00.000Z", "status": "pending" } }
```
`order` is the whole document. Values of `status`:
- `"paid"` — settled now, or `alreadyPaid: true` if it was settled earlier.
- `"pending"` — the provider has no payment yet, or no invoice was ever opened. Retry with backoff.
- Any other value is the order's own `payment_status` (`failed`, `cancelled`) when the order is not waiting for a payment: offer `/pay` or show it as closed.

**Errors:** `{ success: false, code, message }`
- `400` — a provider read error, or a malformed id (`SUPPLY_ERROR` or `PAYMENT_REFERENCE_REQUIRED`).
- `404` — `NOT_FOUND`: no such order, or another vendor's.

#### `POST /api/vendors/supplies/orders/:id/cancel`
The store owner withdraws an order before the admin approves it. Setting `status` and `payment_status` to `cancelled` returns the wallet share to the wallet. **An online share already paid is not refunded** (see [Known issues](#appendix-c-known-issues)).

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | The supply order `_id`. |

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | no | Default "Cancelled by the vendor"; cut to 300 characters. Saved as `rejection_reason`. |

Example body:
```json
{
  "reason": "Ordered by mistake"
}
```

**Response `200`:**
```json
{ "success": true, "order": { "_id": "66f5d4f0e4b0a1b2c3d4eb00", "status": "cancelled", "payment_status": "cancelled", "rejection_reason": "Ordered by mistake" } }
```
`order` is the whole document.

**Errors:** `{ success: false, code, message }`
- `400` — `TOO_LATE`: not `pending` any more (approved, sent, delivered, rejected or cancelled). "Ask support to cancel it."
- `400` — `SUPPLY_ERROR`: a malformed id.
- `404` — `NOT_FOUND`: no such order, or another vendor's.

---

## 11. Notifications and support

### Notifications

In-app notices for the store: new orders, parcel deadlines and cancellations, returns and refunds, earnings and payouts, subscription lifecycle, ads, supply orders and courier bookings.
- **Format:** each one is stored with a ready-made English `title` and `message` and a free-form `data` object. There is no translation and no `link`.
- **Not pushed:** poll `/count`.
- **Errors:** `{ "success": false, "message" }`.

Types a store can receive (from the model enum; `account_reactivated` and `product_limit_warning` have message templates, but no code sends them):
- **Subscription and account:** `subscription_activated`, `trial_activated`, `subscription_expiring_soon`, `subscription_expired`, `subscription_cancelled`, `account_became_not_subscribed`, `account_suspended`, `account_reactivated`, `product_visibility_restored`, `renewal_successful`, `product_limit_warning`.
- **Orders and parcels:** `new_order_received`, `company_batch_received`, `sub_order_cancelled`, `sub_order_overdue`, `sub_order_deadline_soon`, `courier_transferred`, `pickup_scheduled`.
- **Returns and refunds:** `return_request_received`, `return_admin_approved`, `return_admin_rejected`, `return_shipment_created`, `return_received_by_vendor`, `refund_processing`, `refund_completed`.
- **Money:** `earnings_available`, `earnings_clawback`, `withdrawal_approved`, `withdrawal_rejected`, `withdrawal_paid`, `payout_paid`, `payout_processing`, `payout_failed`, `payout_method_changed`, `earning_frozen`, `earning_unfrozen`, `payouts_paused`, `payouts_resumed`.
- **Ads and supplies:** `ad_approved`, `ad_rejected`, `supply_order_approved`, `supply_order_rejected`, `supply_order_sent`, `supply_order_delivered`.
- **Admin-only types in the same enum** (sent to admin accounts, not stores): `company_receipt_uploaded`, `company_cap_alert`, `company_invoice_overdue`, `supply_order_placed`, `bosta_bundle_low`, `bosta_bundle_expiring`, `bosta_bundle_depleted`, `sub_order_needs_admin`.

#### `GET /api/vendors/notifications`
The dashboard's notification list, newest first.

- **Auth:** Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | number | no | Default 1. |
| `limit` | number | no | Default 20. No maximum. |
| `read` | string | no | `"true"` → read only. Any other value → unread only. Omit for all. |

**Response `200`**:
```json
{
  "success": true,
  "notifications": [
    {
      "_id": "6709b1c2d3e4f5a6b7c8d901",
      "vendor_id": "6708f3c9c2b4e5d6f7a81290",
      "type": "new_order_received",
      "title": "New Order Received",
      "message": "Order #REF-8K2M4Q7Z is waiting for your review. 2 items assigned to your store.",
      "data": { "order_id": "6709b1a0d3e4f5a6b7c8d800", "reference": "REF-8K2M4Q7Z", "vendor_total": 1450, "item_count": 2 },
      "read": false,
      "createdAt": "2026-10-11T11:20:00.000Z",
      "__v": 0
    },
    {
      "_id": "6708f3c9c2b4e5d6f7a812b0",
      "vendor_id": "6708f3c9c2b4e5d6f7a81290",
      "type": "trial_activated",
      "title": "Free Trial Activated",
      "message": "Your free trial for \"Starter Trial\" has been activated. It expires on November 10, 2026. Make the most of your 30 days!",
      "data": { "packageName": "Starter Trial", "packageNameAr": "تجربة مجانية", "price": 0, "trialDays": 30, "expiresAt": "2026-11-10T10:03:12.000Z" },
      "read": true,
      "createdAt": "2026-10-11T10:03:12.000Z",
      "__v": 0
    }
  ],
  "pagination": { "total": 2, "page": 1, "pages": 1, "limit": 20 }
}
```
`data` differs per type and is whatever the sender passed. Common keys: `order_id`, `sub_order_id`, `reference`, `return_number`, `amount`.

**Errors:**
- `500` — `{success:false, message}` (e.g. a non-numeric `page` or `limit`, unverified).

#### `GET /api/vendors/notifications/count`
The badge on the dashboard bell. Poll it, since nothing is pushed.

- **Auth:** Vendor

**Response `200`**:
```json
{ "success": true, "unreadCount": 3 }
```

**Errors:**
- `500` — `{success:false, message}`.

#### `PUT /api/vendors/notifications/:id/read`
The owner opens or clicks one notification. Marks it read.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | Notification id. Must belong to this store. |

**Response `200`**:
```json
{
  "success": true,
  "notification": {
    "_id": "6709b1c2d3e4f5a6b7c8d901",
    "vendor_id": "6708f3c9c2b4e5d6f7a81290",
    "type": "new_order_received",
    "title": "New Order Received",
    "message": "Order #REF-8K2M4Q7Z is waiting for your review. 2 items assigned to your store.",
    "data": { "order_id": "6709b1a0d3e4f5a6b7c8d800", "reference": "REF-8K2M4Q7Z", "vendor_total": 1450, "item_count": 2 },
    "read": true,
    "createdAt": "2026-10-11T11:20:00.000Z",
    "__v": 0
  }
}
```

**Errors:**
- `404` — `Notification not found` (also another store's notification).
- `500` — malformed `id` (cast error).

#### `PUT /api/vendors/notifications/read-all`
"Mark all as read".

- **Auth:** Vendor

**Response `200`**:
```json
{ "success": true, "message": "All notifications marked as read" }
```

**Errors:**
- `500` — `{success:false, message}`.

#### `DELETE /api/vendors/notifications/:id`
The owner dismisses one notification. The delete is permanent. There is no "delete all" route.

- **Auth:** Vendor

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | Notification id. Must belong to this store. |

**Response `200`**:
```json
{ "success": true, "message": "Notification deleted" }
```

**Errors:**
- `404` — `Notification not found`.
- `500` — malformed `id`.

### Support tickets

The same router serves customers and stores. A store only ever sees tickets whose `authorId` is the store and `authorRole` is `"vendor"`.
- **Store-specific behaviour:**
  - A store can link a ticket to any order it has a parcel or items in.
  - Admins can open a ticket **on a store's behalf** (`POST /api/admin/tickets`, `initiatedByAdmin: true`, the first message from the admin). It shows up in the store's list like any other.
  - Nothing notifies the store about a new admin ticket or an admin reply, except `ticket:updated` for a client already in the ticket's room.
- **Errors:** `{ success: false, message }`, with no `code`. No rate limits.

**Live updates (Socket.io)**, with a store session cookie:

| Direction | Event | Payload |
|---|---|---|
| Dashboard → server | `ticket:join` | `ticketId` (string). Joins only the store's own tickets. No reply either way. |
| Dashboard → server | `ticket:leave` | `ticketId` |
| Server → dashboard | `ticket:updated` | The full ticket (same shape as `GET /api/tickets/:id`, including `adminNote`). Sent after a store reply or an admin reply. Not sent when an admin changes status, priority or assignment. |

#### `POST /api/tickets`
The owner opens a support ticket from the dashboard, optionally about one order. Nobody is notified.

- **Auth:** User or Vendor

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Trimmed, max 255 characters. |
| `description` | string | yes | Trimmed. |
| `category` | string | no | `account, order, product, payment, technical, other`. Default `other`. Forced to `order` when `order_id` is set. |
| `priority` | string | no | `low, medium, high, urgent`. Default `medium`. |
| `order_id` | ObjectId | no | The **order** id (not the parcel id). For a store it must be an order where the store has a parcel (`sub_orders.vendor_id`), a supervision (`vendor_supervisions.vendor_id`) or an item (`items.vendor_id`). |

Example body:
```json
{
  "title": "Courier did not show up for pickup",
  "description": "The Bosta pickup booked for today did not come.",
  "priority": "medium",
  "order_id": "6709b1a0d3e4f5a6b7c8d800"
}
```

**Response `201`:**
```json
{
  "success": true,
  "ticket": {
    "_id": "6709c2d3e4f5a6b7c8d9e012",
    "title": "Courier did not show up for pickup",
    "description": "Bosta pickup for parcel REF-8K2M4Q7Z-1 was booked for today but nobody came.",
    "category": "order",
    "priority": "medium",
    "order_id": "6709b1a0d3e4f5a6b7c8d800",
    "order_reference": "REF-8K2M4Q7Z",
    "authorId": "6708f3c9c2b4e5d6f7a81290",
    "authorRole": "vendor",
    "authorName": "Karim Hassan",
    "status": "open",
    "messages": [],
    "assignedTo": null,
    "assignedToName": null,
    "adminNote": null,
    "initiatedByAdmin": false,
    "createdAt": "2026-10-11T12:00:00.000Z",
    "updatedAt": "2026-10-11T12:00:00.000Z",
    "__v": 0
  }
}
```
- **`authorName`** is the owner's personal `name`. It falls back to `store_name` only when `name` is empty, which the schema does not allow.
- **`order_reference`** is the order's `transaction.reference`, or the last 8 characters of its id in upper case.

**Errors:**
- `400` — `Title is required`; `Description is required`; `Invalid order` (`order_id` is not an ObjectId).
- `404` — `Order not found` (the store has no part in that order).
- `500` — e.g. `category` or `priority` outside the enum (Mongoose validation).

#### `GET /api/tickets`
The store's tickets, newest first, including ones an admin opened for the store.

- **Auth:** User or Vendor

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | string | no | `open, pending, resolved, closed`. |
| `priority` | string | no | `low, medium, high, urgent`. |
| `page` | number | no | Default 1. |
| `limit` | number | no | Default 20. No upper limit. |

**Response `200`:**
```json
{
  "success": true,
  "tickets": [
    {
      "_id": "6709d3e4f5a6b7c8d9e0f123",
      "title": "Please update your store address",
      "status": "open",
      "priority": "high",
      "category": "account",
      "messages": [
        { "_id": "6709d3e4f5a6b7c8d9e0f124", "senderRole": "admin", "senderId": "6709d3e4f5a6b7c8d9e0f125", "senderName": "support", "content": "Your pickup address is missing the building number.", "createdAt": "2026-10-11T09:00:00.000Z" }
      ],
      "createdAt": "2026-10-11T09:00:00.000Z",
      "updatedAt": "2026-10-11T09:00:00.000Z"
    }
  ],
  "pagination": { "total": 1, "page": 1, "pages": 1, "limit": 20 }
}
```
- **Fields** are only `_id`, `title`, `status`, `priority`, `category`, `messages`, `createdAt` and `updatedAt`. `initiatedByAdmin` and `order_reference` are not included, so an admin-opened ticket is only recognisable by its first message being from `admin`.
- **Admin messages:** `senderName` is the admin's login username. `senderId` is a random id.

**Errors:**
- `500` — `{ success: false, message }` (e.g. non-numeric `limit`).

#### `GET /api/tickets/:id`
One of the store's tickets with the full thread. Returns the whole document, **including `adminNote`, `assignedTo` and `assignedToName`**.

- **Auth:** User or Vendor (owner only)

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | Ticket id. |

**Response `200`:**
```json
{
  "success": true,
  "ticket": {
    "_id": "6709d3e4f5a6b7c8d9e0f123",
    "title": "Please update your store address",
    "description": "Your pickup address is missing the building number.",
    "category": "account",
    "priority": "high",
    "order_id": null,
    "order_reference": null,
    "authorId": "6708f3c9c2b4e5d6f7a81290",
    "authorRole": "vendor",
    "authorName": "Cairo Auto Parts",
    "status": "open",
    "initiatedByAdmin": true,
    "messages": [
      { "_id": "6709d3e4f5a6b7c8d9e0f124", "senderRole": "admin", "senderId": "6709d3e4f5a6b7c8d9e0f125", "senderName": "support", "content": "Your pickup address is missing the building number.", "createdAt": "2026-10-11T09:00:00.000Z" }
    ],
    "assignedTo": null,
    "assignedToName": null,
    "adminNote": null,
    "createdAt": "2026-10-11T09:00:00.000Z",
    "updatedAt": "2026-10-11T09:00:00.000Z",
    "__v": 0
  }
}
```
For admin-opened tickets, `authorName` is the store name.

**Errors:**
- `400` — `Invalid ticket ID`.
- `404` — `Ticket not found` (also another account's ticket).
- `500` — `{ success: false, message }`.

#### `POST /api/tickets/:id/messages`
The owner replies on one of the store's tickets, including admin-opened ones. A `resolved` ticket goes back to `open`; a `closed` ticket refuses replies. `ticket:updated` is emitted to room `ticket:<id>` with the full updated ticket.

- **Auth:** User or Vendor (owner only)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `content` | string | yes | Trimmed, non-empty. |

**Response `200`:**
```json
{
  "success": true,
  "ticket": {
    "_id": "6709d3e4f5a6b7c8d9e0f123",
    "status": "open",
    "messages": [
      { "_id": "6709d3e4f5a6b7c8d9e0f124", "senderRole": "admin", "senderId": "6709d3e4f5a6b7c8d9e0f125", "senderName": "support", "content": "Your pickup address is missing the building number.", "createdAt": "2026-10-11T09:00:00.000Z" },
      { "_id": "6709e4f5a6b7c8d9e0f1a234", "senderRole": "vendor", "senderId": "6708f3c9c2b4e5d6f7a81290", "senderName": "Karim Hassan", "content": "Updated, building 12.", "createdAt": "2026-10-11T13:00:00.000Z" }
    ]
  }
}
```
`ticket` is the full document (shortened here). A store reply leaves `open` and `pending` as they are; only `resolved` goes back to `open`.

**Errors:**
- `400` — `Invalid ticket ID`; `Message content is required`; `This ticket is closed and cannot receive new replies`.
- `404` — `Ticket not found`.
- `500` — `{ success: false, message }`.

---

## 12. Payment provider callbacks

None of these is called by the vendor dashboard or app. They are listed so client developers know where the browser lands and what settles money.

#### `GET /api/payments/paymob/return`
The **browser redirect** after a Paymob payment, shared by every flow. The query parameters, the HMAC check (logged only) and the record lookup are as in the Customer API reference. This entry covers only the two vendor flows.

The route **settles nothing**. It finds the record and sends a 302 to the page that started the payment. That page must then call the matching confirm endpoint. On Fawaterak, the provider sends the browser straight to the same frontend URLs (our success / fail / pending links), without passing through this route. Whether Fawaterak adds its own query parameters is unverified; the dashboard reads `invoice_id` when present.

- **Auth:** Public (browser redirect from Paymob)

**Query:** set by Paymob: `success`, `pending`, `order` / `order_id`, `merchant_order_id`, `id`, `hmac`.
- `merchant_order_id` is `sub:<SubscriptionPayment id>:1` for subscriptions, and `supply:<SupplyOrder id>:<attempt>` for supplies.
- When it is missing, the record is found by Paymob's order id in `SubscriptionPayment.invoice_id` / `SupplyOrder.payment.invoice_id`.

**Response `302`:** `<status>` is `success` (`success=true` and `pending=false`), `pending` (`pending=true`) or `failed`.

| Matched record | `Location` | The client then calls |
|---|---|---|
| Subscription payment | `${FRONTEND_URL}/dashboard/subscription?payment=<status>&paymentId=<SubscriptionPayment id>` | `POST /api/vendors/subscription/confirm-payment { "paymentId": "<paymentId>" }` |
| Supply order | `${FRONTEND_URL}/dashboard/supplies?payment=<status>&orderId=<SupplyOrder id>` | `POST /api/vendors/supplies/orders/<orderId>/confirm-payment` |
| Nothing matched | `${FRONTEND_URL}/?payment=<status>` | — |
| Internal error | `${FRONTEND_URL}/?payment=failed` | — |

Call the confirm endpoint whatever `?payment=` says. A forged `?payment=success` gets only a redirect. On Paymob, the server-to-server `POST /api/payments/paymob/webhook` (see the Customer API reference) also settles both vendor flows with the same idempotent functions.

**Errors:** none. Every path redirects.

#### `POST /api/vendors/subscription/fawaterak/webhook_json`
Server-to-server Fawaterak "paid" callback for subscription payments. When accepted, it activates the payment exactly like a successful confirm. **In production this webhook is rejected (`401`)**, and there is no subscription sweep. Activation therefore depends on the vendor's client calling `POST /api/vendors/subscription/confirm-payment`.

- **Auth:** Server-to-server (`hashKey` = HMAC-SHA256 of `InvoiceId=…&InvoiceKey=…&PaymentMethod=…`, keyed with the Fawaterak vendor key or API key)

**Body:** Fawaterak's payload: `hashKey`, `invoice_id`, `invoice_key`, `payment_method`, `invoice_status`, and `pay_load` (an object or a JSON string) carrying `subscriptionPaymentId`, `vendorId`, `action` and `reference`. The payment is found by `pay_load.subscriptionPaymentId`, falling back to `invoice_id` / `invoice_key`.

**Response `200`:**
- `{ "success": true }` when activated, or already paid.
- `{ "success": true, "ignored": true }` when `invoice_status` is not `paid`.
- `{ "success": true, "ignored": true, "reason": "record belongs to another provider" }`.

**Errors:**
- `401` — `{ "success": false, "message": "Invalid webhook signature" }`.
- `404` — `{ "success": false, "message": "Payment not found" }`.
- `500` — activation threw. The error is stored in `activation_error`, and Fawaterak retries.

#### `POST /api/vendors/supplies/fawaterak/webhook_json`
Server-to-server Fawaterak "paid" callback for supply orders. It is declared before the router's `protect`, so it is public. It settles the order with the same idempotent `settlePaidOrder` that confirm and the sweep use. In production it is subject to the same `401` rejection, which the hourly sweep and `confirm-payment` cover.

- **Auth:** Server-to-server (same `hashKey` scheme; `pay_load` carries `supplyOrderId` and `vendorId`)

**Body:** Fawaterak's payload, as above. The order is found by `pay_load.supplyOrderId`, falling back to `payment.invoice_id` / `payment.invoice_key`.

**Response `200`:**
- `{ "success": true }` when settled.
- `{ "success": true, "ignored": true }` when `invoice_status` is not `paid`.
- `{ "success": true, "ignored": true, "reason": "record belongs to another provider" }`.

**Errors:**
- `401` — `{ "success": false, "message": "Invalid webhook signature" }`.
- `404` — `{ "success": false, "message": "Order not found" }`.
- `500` — settlement failed.

---

## Appendix A: Status values

### Parcels

| Field | Values |
|---|---|
| Parcel `status` | `pending_review`, `needs_admin`, `awaiting_tracking`, `awaiting_handover`, `ready_for_pickup`, `pickup_scheduled`, `handed_to_courier`, `picked_up`, `in_transit`, `out_for_delivery`, `delivered`, `returned`, `exception`, `cancelled`, `held_in_batch`, `in_batch_parcel`. What each one asks of the store is in [Orders and parcels](#orders-and-parcels). |
| Parcel list `tab` | `needs_review` (`pending_review`), `needs_tracking` (`awaiting_tracking`), `needs_sealing` (`awaiting_handover`), `waiting_pickup` (`ready_for_pickup`, `pickup_scheduled`), `on_the_way` (`handed_to_courier`, `picked_up`, `in_transit`, `out_for_delivery`), `delivered`, `blocked` (`needs_admin`, `exception`, `returned`) |
| Item `vendor_status` | `pending`, `approved`, `declined` |
| Parcel `vendor_review.key` | `awaiting_review`, `in_progress`, `accepted`, `partially_accepted`, `rejected` |
| `progress.stage` | 1 review, 2 waybill, 3 seal, 4 courier, 5 on the way |
| `progress.tracking_mode` | `print_awb`, `scan_label` |
| `journey.steps[].state` | `done`, `skipped`, `current`, `stopped`, `todo` |
| Courier | `bosta`, `arrive` |
| Pickup `status` | `scheduled`, `picked_up`, `cancelled`, `failed` |
| Smart label `status` | `reserved`, `dispatched` |
| Order `transaction.payment_method` (on every parcel as `payment_method`) | `cash`, `credit_card`, `wallet`, `company_account`, `bank_transfer` |

### Products, bundles and ads

| Field | Values |
|---|---|
| Product / bundle `status` | `draft`, `pending` (waiting for admin review), `published` |
| Product `is_published` | `true` once approved at least once; it stays `true` when the product goes back to draft |
| Product `part_type` | `original`, `oem`, `aftermarket` |
| Product `stock_status` | `instock`, `outofstock`, `onbackorder` |
| Product `discount_type` | `fixed`, `percentage` |
| Bundle `pricing_mode` | `fixed`, `percent`, `amount` |
| Ad `type` | `banner`, `product_visibility`, `featured_vendor` |
| Ad `status` | `pending`, `approved`, `rejected`, `cancelled`, `expired` |
| Ad `subject_type` (banners) | `product`, `store`, `custom`, `service` |
| Ad `placements` | `category_top`, `shop_top`, `promoted_section`, `most_sold`, `new_arrivals`, `special_offers` |
| Ad `vendor_placements` | `home`, `vendors_page` |
| Catalogue entry `status` | `approved`, `suggested` (both selectable), `merged`, `archived`, `rejected` |

### Returns

| Field | Values |
|---|---|
| Return `status` | `pending_vendor_review` (the store reviews) → `pending_admin_review` → `approved` / `rejected` → `return_shipping` → `return_received` → `refund_processing` → `completed`. `cancelled` = withdrawn by the customer. `vendor_approved` / `vendor_rejected` exist but are never stored. |
| `vendor_review.decision` | `approved`, `rejected` |
| `reason` | `defective`, `wrong_item`, `not_as_described`, `changed_mind`, `other` |
| `fault_type` | `vendor_fault`, `customer_fault`, `undetermined` |

### Money

| Field | Values |
|---|---|
| Earning `status` | `pending` (held), `available` (can be withdrawn), `reversed` (parcel cancelled or fully refunded) |
| Earning `payout_status` | `null` (not paid), `requested`, `processing`, `paid` |
| Withdrawal / payout `status` | `pending`, `approved`, `processing`, `paid`, `failed`, `rejected`, `cancelled` (`draft` is internal) |
| Withdrawal `channel` | `paymob`; `manual` only on payouts an admin recorded |
| Withdrawal `initiated_by` | `vendor`, `admin` |
| Payout method `type` | `wallet`, `account`, `iban`, `card` |
| Payout `issuer` | `vodafone`, `etisalat`, `orange`, `bank_wallet` (mobile wallets); `bank_card` (bank, about 2 working days), `instant_bank` (fast, minimum 112 EGP) |
| Subscription `status` | `active`, `expired`, `cancelled` |
| Store `subscription_status` | `active`, `trial_active`, `not_subscribed`, `cancelled`, `suspended`, `expired` |
| Package `billing_period` | `monthly`, `yearly`, `trial` |
| Supply order `payment_status` | `awaiting_online` (wallet share held, invoice open), `paid`, `failed`, `cancelled` (`unpaid` is unused) |
| Supply order `status` | `pending` → `approved` → `sent` → `delivered`; or `rejected` / `cancelled` |
| Supply `category` | `poly_mailer`, `box`, `sticker`, `label`, `other` |
| Supply `delivery_method` | `with_pickup`, `courier`, `handover` |

### Account and support

| Field | Values |
|---|---|
| Store `status` | `active`, `suspended` |
| Ticket `status` | `open`, `pending` (support replied), `resolved`, `closed` |
| Ticket `priority` | `low`, `medium`, `high`, `urgent` |
| Ticket `category` | `account`, `order`, `product`, `payment`, `technical`, `other` |

---

## Appendix B: Notification types

`GET /api/vendors/notifications` returns these `type` values. Each notification has an English `title` and `message` and a `data` object whose keys depend on the type (often `order_id`, `sub_order_id`, `reference`, `return_number`, `amount`).

| Area | Types |
|---|---|
| Subscription and account | `subscription_activated`, `trial_activated`, `subscription_expiring_soon`, `subscription_expired`, `subscription_cancelled`, `account_became_not_subscribed`, `account_suspended`, `product_visibility_restored`, `renewal_successful` |
| Orders and parcels | `new_order_received`, `company_batch_received`, `sub_order_cancelled`, `sub_order_overdue`, `sub_order_deadline_soon`, `courier_transferred`, `pickup_scheduled` |
| Returns and refunds | `return_request_received`, `return_admin_approved`, `return_admin_rejected`, `return_shipment_created`, `return_received_by_vendor`, `refund_processing`, `refund_completed` |
| Money | `earnings_available`, `earnings_clawback`, `withdrawal_approved`, `withdrawal_rejected`, `withdrawal_paid`, `payout_paid`, `payout_processing`, `payout_failed`, `payout_method_changed`, `earning_frozen`, `earning_unfrozen`, `payouts_paused`, `payouts_resumed` |
| Ads and supplies | `ad_approved`, `ad_rejected`, `supply_order_approved`, `supply_order_rejected`, `supply_order_sent`, `supply_order_delivered` |

`account_reactivated` and `product_limit_warning` also exist in the list, but nothing sends them.

---

## Appendix C: Known issues

Found in the code while writing this file. Client developers should code around them; the backend team should fix them. Most are also noted on their endpoint.

**Security: fix first**
- `PUT /api/vendors/profile` trusts a `bosta_location_id` sent by the client and updates that Bosta pickup location with this store's address and contact. Every store's id is public on `GET /api/vendors/public`, so one store can take over another store's Bosta pickups. `POST /api/auth/register-vendor` accepts the same field.
- `POST /api/upload` needs no sign-in and keeps the file extension the client sent. A file named `.html` or `.svg` that starts with image bytes is saved and served from `https://readycar.store/uploads/...` as a web page: a likely stored-XSS hole on the main domain.
- `GET /api/vendors/products/:id` returns the whole store record inside `vendor_id`, including the **password hash**, wallet, commission and bank details.
- The legacy `PUT /api/vendors/orders/:id` does not check that the order belongs to the store. On an order without parcels it returns the whole order: the customer's address and phone, and other stores' items.
- A suspended store can still sign in with its password and use every store endpoint. Buying, resubscribing or changing a plan sets `status: "active"` again, so a store can lift its own suspension.
- The subscription length comes from the client: `billing_period: "yearly"` gives 12 months for the price of a monthly package.
- `POST /api/auth/register-vendor` deletes every pending store registration with the same email, phone or username, so anyone can cancel someone else's sign-up in progress.
- `PUT /api/vendors/profile` changes the email and phone without a code and keeps them marked as verified.
- Products and bundles accept any field in the body: a store can set its own `sold_count`, `rating`, `reviews_count` and `created_at`, which customers see and which drive "most sold" and "newest". `PUT /api/vendors/products/:id` also accepts a negative `price` and a raw `discount_price`.
- `POST /api/auth/login-vendor` and the password check on `PUT /api/vendors/wallet/payout-method` have no rate limit.

**Data the store should not receive**
- Parcel views include admin-only fields: the full history with admin notes and names, `cancellations`, `courier_cancel_pending` (with the fee ReadyCar will pay), `courier_transfer`, `dispatch_attempt`.
- The legacy `GET /api/vendors/orders` returns ReadyCar's courier costs (`courier_cost`, `bosta_cost`), `cod_settlement` and `provider_payload`. `GET /api/vendors/pickups` returns `pickup_fee`.
- Return requests show the customer's email, phone and address from the moment they arrive.
- Catalogue entries show which store suggested them (`created_by_vendor_id`, `source_product_id`).
- The withdrawals list includes admin usernames and Paymob's fees; ads include admin usernames. Account numbers are masked in some responses and returned in full in others.
- Tickets include `adminNote`, `assignedTo` and `assignedToName`.

**Broken**
- Subscription payments have no background job. A paid subscription that the app never confirms is never activated. A payment that is paid but fails to activate (for example a renewal paid after the plan expired) stays `pending` with `activation_error`, with no automatic recovery or refund.
- Admin alerts for parcels sent to `needs_admin`, cancel requests and overdue parcels reach nobody (the code looks for admins in the customer table). The parcels still show in the admin queue.
- Arrive parcels most likely jump to `pickup_scheduled` as soon as the shipment exists, so `tracking`, `photos` and `ready` answer `WRONG_STAGE` and only `handover` works (from the code; not checked live).
- A return the store never reviews stays in `pending_vendor_review` for ever: there is no deadline and no admin override.
- A store's cancel request can never be declined or withdrawn.
- A Smart Label reserved with `POST /api/vendors/orders/:id/smart-label` makes `POST .../tracking` fail on that parcel until it is released.
- Cancelling a supply order already paid online refunds only the wallet share. A cancelled supply order can later be marked paid again by the provider webhook, which takes the wallet share a second time.

**Rules that are not enforced**
- The subscription and the plan's product limit are checked only by `POST /api/vendors/products`. `PUT /api/vendors/products/:id` and every bulk upload skip both. `middleware/subscriptionMiddleware.js` is not used anywhere.
- A store can approve and confirm a parcel that is waiting in `needs_admin`, so it ships without the ReadyCar team's decision.
- A bundle can be priced at 0 (`amount` ≥ the combined price, `fixed` 0, or `percent` over 100 on update).
- `POST /api/vendors/subscription/resubscribe` can create a second active subscription, and the products the store chose to keep are all republished anyway. `change-plan` drops the days left on the old plan.
- Two confirm calls at the same moment can extend a subscription twice.
- Parcel photos can be deleted after handover when no Bosta pickup was booked (every Arrive parcel), and their URLs are not checked.

**Wrong results**
- Every parcel's `cod_amount` and the dashboard's `collectable` count prepaid orders too, where the courier collects 0.
- Product routes set error codes (`INCOMPLETE_PRODUCT`, `NO_SUBSCRIPTION`, …) internally but send only `message`.
- Bulk upload, preview then save: a discount value with no type is saved at full price, and an unknown brand is dropped, with no error. Invalid rows are saved as drafts; uploading the same file twice creates every product twice.
- `GET /api/vendors/returns?status=vendor_approved` (or `vendor_rejected`) is always empty.
- Renewing republishes products the store had unpublished on purpose.
- No stock check or stock decrease was found at checkout (not checked live).
- `GET /api/vendors/sub-orders`, `GET /api/vendors/products` and `GET /api/vendors/pickups` have no pagination; several other lists have no `limit` maximum.
- A malformed id gives `500` on many routes, and "not found" gives `500` on `DELETE` for products and bundles.
- `POST /api/vendors/returns/:id/confirm-receipt` notifies the store instead of the customer.
- Store notifications are English only.

---

## Appendix D: Endpoint index

All 110 endpoints in this file, in the order they appear.

**3. Sign-in and account**

| Method | Path | Auth |
|---|---|---|
| `POST` | [`/api/auth/register-vendor`](#post-apiauthregister-vendor) | Public |
| `POST` | [`/api/auth/verify-registration-otp`](#post-apiauthverify-registration-otp) | Public |
| `POST` | [`/api/auth/resend-registration-otp`](#post-apiauthresend-registration-otp) | Public |
| `GET` | [`/api/auth/verify-email`](#get-apiauthverify-email) | Public |
| `POST` | [`/api/auth/verify-email`](#post-apiauthverify-email) | Public |
| `POST` | [`/api/auth/login-vendor`](#post-apiauthlogin-vendor) | Public |
| `POST` | [`/api/auth/google`](#post-apiauthgoogle) | Public |
| `POST` | [`/api/auth/google/complete`](#post-apiauthgooglecomplete) | Public |
| `GET` | [`/api/auth/me`](#get-apiauthme) | User or Vendor |
| `POST` | [`/api/auth/logout`](#post-apiauthlogout) | Public |
| `POST` | [`/api/auth/forgot-password`](#post-apiauthforgot-password) | Public |
| `POST` | [`/api/auth/reset-password`](#post-apiauthreset-password) | Public |
| `POST` | [`/api/auth/forgot-password/otp`](#post-apiauthforgot-passwordotp) | Public |
| `POST` | [`/api/auth/reset-password/otp`](#post-apiauthreset-passwordotp) | Public |
| `GET` | [`/api/users/verification/status`](#get-apiusersverificationstatus) | User or Vendor |
| `POST` | [`/api/users/verification/send`](#post-apiusersverificationsend) | User or Vendor |
| `POST` | [`/api/users/verification/confirm`](#post-apiusersverificationconfirm) | User or Vendor |
| `POST` | [`/api/users/verification/cancel`](#post-apiusersverificationcancel) | User or Vendor |
| `GET` | [`/api/vendors/profile`](#get-apivendorsprofile) | Vendor |
| `PUT` | [`/api/vendors/profile`](#put-apivendorsprofile) | Vendor |

**4. Products**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/vendors/products`](#get-apivendorsproducts) | Vendor |
| `GET` | [`/api/vendors/products/:id`](#get-apivendorsproductsid) | Vendor |
| `POST` | [`/api/vendors/products`](#post-apivendorsproducts) | Vendor, active subscription |
| `PUT` | [`/api/vendors/products/:id`](#put-apivendorsproductsid) | Vendor |
| `DELETE` | [`/api/vendors/products/:id`](#delete-apivendorsproductsid) | Vendor |
| `GET` | [`/api/vendors/catalog/search`](#get-apivendorscatalogsearch) | Vendor |
| `GET` | [`/api/vendors/catalog/filters`](#get-apivendorscatalogfilters) | Vendor |
| `GET` | [`/api/vendors/catalog/:id`](#get-apivendorscatalogid) | Vendor |
| `GET` | [`/api/vendors/products/bulk-template`](#get-apivendorsproductsbulk-template) | Vendor |
| `POST` | [`/api/vendors/products/bulk-upload/preview`](#post-apivendorsproductsbulk-uploadpreview) | Vendor |
| `POST` | [`/api/vendors/products/bulk-upload/save`](#post-apivendorsproductsbulk-uploadsave) | Vendor |
| `POST` | [`/api/vendors/products/bulk-json`](#post-apivendorsproductsbulk-json) | Vendor |
| `POST` | [`/api/vendors/products/bulk-upload`](#post-apivendorsproductsbulk-upload) | Vendor |
| `GET` | [`/api/products/categories`](#get-apiproductscategories) | Public |
| `GET` | [`/api/products/filters`](#get-apiproductsfilters) | Public |
| `GET` | [`/api/products/car-brands/:id/models`](#get-apiproductscar-brandsidmodels) | Public |
| `GET` | [`/api/shipping/classes`](#get-apishippingclasses) | Public |
| `GET` | [`/api/shipping/cities`](#get-apishippingcities) | Public |
| `POST` | [`/api/upload`](#post-apiupload) | Public |

**5. Bundles and ads**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/vendors/bundles/eligible-products`](#get-apivendorsbundleseligible-products) | Vendor |
| `GET` | [`/api/vendors/bundles`](#get-apivendorsbundles) | Vendor |
| `GET` | [`/api/vendors/bundles/:id`](#get-apivendorsbundlesid) | Vendor |
| `POST` | [`/api/vendors/bundles`](#post-apivendorsbundles) | Vendor, active subscription |
| `PUT` | [`/api/vendors/bundles/:id`](#put-apivendorsbundlesid) | Vendor |
| `DELETE` | [`/api/vendors/bundles/:id`](#delete-apivendorsbundlesid) | Vendor |
| `POST` | [`/api/vendors/ads`](#post-apivendorsads) | Vendor |
| `GET` | [`/api/vendors/ads`](#get-apivendorsads) | Vendor |
| `GET` | [`/api/vendors/ads/:id/analytics`](#get-apivendorsadsidanalytics) | Vendor |
| `POST` | [`/api/vendors/ads/:id/cancel`](#post-apivendorsadsidcancel) | Vendor |

**6. Orders and shipping**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/vendors/stats`](#get-apivendorsstats) | Vendor |
| `GET` | [`/api/vendors/reports/sales`](#get-apivendorsreportssales) | Vendor |
| `GET` | [`/api/vendors/reports/sales/export`](#get-apivendorsreportssalesexport) | Vendor |
| `GET` | [`/api/vendors/orders/counts`](#get-apivendorsorderscounts) | Vendor |
| `GET` | [`/api/vendors/orders`](#get-apivendorsorders) | Vendor |
| `PUT` | [`/api/vendors/orders/:id`](#put-apivendorsordersid) | Vendor |
| `GET` | [`/api/vendors/sub-orders`](#get-apivendorssub-orders) | Vendor |
| `GET` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId`](#get-apivendorsordersorderidsub-orderssuborderid) | Vendor |
| `GET` | [`/api/vendors/company-batches/:batchId`](#get-apivendorscompany-batchesbatchid) | Vendor |
| `PUT` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/items/:itemId`](#put-apivendorsordersorderidsub-orderssuborderiditemsitemid) | Vendor |
| `POST` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/approve-all`](#post-apivendorsordersorderidsub-orderssuborderidapprove-all) | Vendor |
| `POST` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/decline-all`](#post-apivendorsordersorderidsub-orderssuborderiddecline-all) | Vendor |
| `POST` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/confirm-items`](#post-apivendorsordersorderidsub-orderssuborderidconfirm-items) | Vendor |
| `POST` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/tracking`](#post-apivendorsordersorderidsub-orderssuborderidtracking) | Vendor |
| `POST` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/shipment`](#post-apivendorsordersorderidsub-orderssuborderidshipment) | Vendor |
| `GET` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/awb`](#get-apivendorsordersorderidsub-orderssuborderidawb) | Vendor |
| `POST` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/photos`](#post-apivendorsordersorderidsub-orderssuborderidphotos) | Vendor |
| `DELETE` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/photos/:photoId`](#delete-apivendorsordersorderidsub-orderssuborderidphotosphotoid) | Vendor |
| `POST` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/ready`](#post-apivendorsordersorderidsub-orderssuborderidready) | Vendor |
| `POST` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/handover`](#post-apivendorsordersorderidsub-orderssuborderidhandover) | Vendor |
| `POST` | [`/api/vendors/orders/:orderId/sub-orders/:subOrderId/cancel-request`](#post-apivendorsordersorderidsub-orderssuborderidcancel-request) | Vendor |
| `GET` | [`/api/vendors/pickups`](#get-apivendorspickups) | Vendor |
| `POST` | [`/api/vendors/orders/:id/smart-label`](#post-apivendorsordersidsmart-label) | Vendor |
| `DELETE` | [`/api/vendors/orders/:id/smart-label`](#delete-apivendorsordersidsmart-label) | Vendor |

**7. Returns**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/vendors/returns`](#get-apivendorsreturns) | Vendor |
| `GET` | [`/api/vendors/returns/counts`](#get-apivendorsreturnscounts) | Vendor |
| `GET` | [`/api/vendors/returns/:id`](#get-apivendorsreturnsid) | Vendor |
| `PUT` | [`/api/vendors/returns/:id/review`](#put-apivendorsreturnsidreview) | Vendor |
| `POST` | [`/api/vendors/returns/:id/confirm-receipt`](#post-apivendorsreturnsidconfirm-receipt) | Vendor |

**8. Earnings and payouts**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/vendors/wallet`](#get-apivendorswallet) | Vendor |
| `GET` | [`/api/vendors/wallet/earnings`](#get-apivendorswalletearnings) | Vendor |
| `POST` | [`/api/vendors/wallet/withdrawals`](#post-apivendorswalletwithdrawals) | Vendor |
| `GET` | [`/api/vendors/wallet/withdrawals`](#get-apivendorswalletwithdrawals) | Vendor |
| `GET` | [`/api/vendors/wallet/payout-method`](#get-apivendorswalletpayout-method) | Vendor |
| `PUT` | [`/api/vendors/wallet/payout-method`](#put-apivendorswalletpayout-method) | Vendor |
| `GET` | [`/api/vendors/wallet/payouts/:id`](#get-apivendorswalletpayoutsid) | Vendor |
| `POST` | [`/api/vendors/wallet/withdrawals/:id/cancel`](#post-apivendorswalletwithdrawalsidcancel) | Vendor |

**9. Subscription**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/vendors/subscription/status`](#get-apivendorssubscriptionstatus) | Vendor |
| `GET` | [`/api/vendors/subscription/packages`](#get-apivendorssubscriptionpackages) | Vendor |
| `GET` | [`/api/vendors/subscription/free-trial`](#get-apivendorssubscriptionfree-trial) | Vendor |
| `POST` | [`/api/vendors/subscription/purchase`](#post-apivendorssubscriptionpurchase) | Vendor |
| `POST` | [`/api/vendors/subscription/renew`](#post-apivendorssubscriptionrenew) | Vendor |
| `POST` | [`/api/vendors/subscription/resubscribe`](#post-apivendorssubscriptionresubscribe) | Vendor |
| `POST` | [`/api/vendors/subscription/change-plan`](#post-apivendorssubscriptionchange-plan) | Vendor |
| `POST` | [`/api/vendors/subscription/confirm-payment`](#post-apivendorssubscriptionconfirm-payment) | Vendor |

**10. Packaging supplies**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/vendors/supplies/catalogue`](#get-apivendorssuppliescatalogue) | Vendor |
| `GET` | [`/api/vendors/supplies/orders`](#get-apivendorssuppliesorders) | Vendor |
| `POST` | [`/api/vendors/supplies/orders`](#post-apivendorssuppliesorders) | Vendor |
| `POST` | [`/api/vendors/supplies/orders/:id/pay`](#post-apivendorssuppliesordersidpay) | Vendor |
| `POST` | [`/api/vendors/supplies/orders/:id/confirm-payment`](#post-apivendorssuppliesordersidconfirm-payment) | Vendor |
| `POST` | [`/api/vendors/supplies/orders/:id/cancel`](#post-apivendorssuppliesordersidcancel) | Vendor |

**11. Notifications and support**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/vendors/notifications`](#get-apivendorsnotifications) | Vendor |
| `GET` | [`/api/vendors/notifications/count`](#get-apivendorsnotificationscount) | Vendor |
| `PUT` | [`/api/vendors/notifications/:id/read`](#put-apivendorsnotificationsidread) | Vendor |
| `PUT` | [`/api/vendors/notifications/read-all`](#put-apivendorsnotificationsread-all) | Vendor |
| `DELETE` | [`/api/vendors/notifications/:id`](#delete-apivendorsnotificationsid) | Vendor |
| `POST` | [`/api/tickets`](#post-apitickets) | User or Vendor |
| `GET` | [`/api/tickets`](#get-apitickets) | User or Vendor |
| `GET` | [`/api/tickets/:id`](#get-apiticketsid) | User or Vendor |
| `POST` | [`/api/tickets/:id/messages`](#post-apiticketsidmessages) | User or Vendor |

**12. Payment provider callbacks**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/payments/paymob/return`](#get-apipaymentspaymobreturn) | Public |
| `POST` | [`/api/vendors/subscription/fawaterak/webhook_json`](#post-apivendorssubscriptionfawaterakwebhook_json) | Server-to-server |
| `POST` | [`/api/vendors/supplies/fawaterak/webhook_json`](#post-apivendorssuppliesfawaterakwebhook_json) | Server-to-server |
