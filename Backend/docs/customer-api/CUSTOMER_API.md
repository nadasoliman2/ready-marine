# ReadyCar Customer API

Every HTTP endpoint the **customer** side of ReadyCar uses: the shopper's web storefront or a mobile app. It covers signing in, browsing, cart and checkout, payment, tracking, returns, reviews, wallet and points, family, friends, notifications, support, and the employee side of company accounts.

**Not covered:** vendor (store) endpoints, admin dashboard endpoints, and the company manager portal (`/api/company`).

Written from the backend code at commit `3fa238a` (2026-10-11). Most catalog examples come from the live API. When the code changes, this file has to be updated by hand.

**Postman:** `ReadyCar-Customer-API.postman_collection.json` in this folder has every request below, in the same order. Each request carries its full description from this file and the documented responses as saved examples. Import it, sign in with one of the sign-in requests, and Postman keeps the session cookie for the following requests.

---

## Contents

- [1. Basics](#1-basics)
- [2. Customer journeys](#2-customer-journeys)
- [3. Sign-in and account](#3-sign-in-and-account)
  - [Sign up and sign in](#sign-up-and-sign-in)
  - [Guest checkout](#guest-checkout)
  - [Password reset](#password-reset)
  - [Email and phone verification](#email-and-phone-verification)
  - [Profile](#profile)
  - [Addresses](#addresses)
  - [My garage and recommendations](#my-garage-and-recommendations)
- [4. Catalog](#4-catalog)
  - [Products](#products)
  - [Bundles](#bundles)
  - [Services](#services)
  - [Stores](#stores)
  - [Ads](#ads)
- [5. Site content](#5-site-content)
- [6. Cart, shipping and checkout](#6-cart-shipping-and-checkout)
  - [Cart](#cart)
  - [Shipping](#shipping)
  - [Checkout](#checkout)
  - [Buying for a friend](#buying-for-a-friend)
  - [Payment provider callbacks](#payment-provider-callbacks)
- [7. After the order](#7-after-the-order)
  - [My orders and parcels](#my-orders-and-parcels)
  - [Returns](#returns)
  - [Reviews](#reviews)
- [8. Wallet and points](#8-wallet-and-points)
  - [Wallet](#wallet)
  - [Loyalty points](#loyalty-points)
- [9. Family](#9-family)
  - [Family group](#family-group)
  - [Family order requests](#family-order-requests)
  - [Family invitation links](#family-invitation-links)
- [10. Friends](#10-friends)
  - [Friends list](#friends-list)
  - [Friend invitation links](#friend-invitation-links)
  - [Invitation link resolver](#invitation-link-resolver)
- [11. Notifications and support](#11-notifications-and-support)
  - [Notifications](#notifications)
  - [Support tickets](#support-tickets)
- [12. Company accounts (employee side)](#12-company-accounts-employee-side)
  - [My company](#my-company)
  - [Company invitation links](#company-invitation-links)
- [13. Uploads](#13-uploads)
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
- Responses are JSON and gzip-compressed.
- IDs are 24-character hex MongoDB ObjectIds. Dates are ISO-8601 UTC strings.
- Some collections use `created_at`; others use `createdAt` / `updatedAt`. Each endpoint shows which.
- Many endpoints return a whole database document. Those carry fields you can ignore, such as `__v`. Read only the fields documented for the endpoint.

### Authentication

The session is a JWT in an **httpOnly cookie named `token`**. The server never reads an `Authorization` header.

- **Web:** send every request with credentials (`fetch(url, { credentials: 'include' })`). CORS allows only `https://readycar.store`.
- **Mobile app:** keep a cookie jar. Store the `Set-Cookie` from the sign-in response and send it back on every request.
- Customers and vendors use the same cookie name. Signing in as one replaces the other on that device.
- `POST /api/auth/logout` clears the cookie.

These endpoints set the cookie:

| Endpoint | JWT lifetime | Cookie |
|---|---|---|
| `POST /api/auth/login-user`, `POST /api/auth/google`, `POST /api/auth/otp-login/verify` | 1 day; 30 days with `remember_me` | Session cookie; 30 days with `remember_me` |
| `POST /api/auth/verify-registration-otp`, `GET`/`POST /api/auth/verify-email`, `POST /api/auth/google/complete` | 1 day | Session cookie |
| `POST /api/auth/guest/session` | 7 days | 30 days (outlives the token) |
| `POST /api/family-invitations/:token/accept-with-registration`, `POST /api/company-invitations/:token/accept-with-registration` | 1 day | Session cookie |
| `POST /api/family-invitations/:token/accept-with-code`, `POST /api/company-invitations/:token/accept-with-code` | 30 days | Session cookie |
| `POST /api/friend-invitations/:token/accept` | 30 days | 30 days |

**Changing the password signs out every session, the current one included.** This applies to `PUT /api/users/change-password`, `POST /api/auth/guest/password` and both password resets. None of them issues a new cookie, so send the customer to sign in again.

When a protected endpoint refuses the session, the body is `{ "message": "..." }` with no `code`:

| Status | `message` |
|---|---|
| `401` | `Not authorized, no token provided` |
| `401` | `Not authorized, token failed` (invalid or expired token, or a vendor token on a customer-only route) |
| `401` | `Not authorized, user not found` |
| `401` | `Not authorized, password was changed` |
| `403` | `Not authorized for this role` |

Each endpoint below has an **Auth** line:

| Auth | Meaning |
|---|---|
| Public | No session needed. |
| Optional user | Works without a session. A customer session, if present, is read. |
| User | Needs a customer session. Unconfirmed guests are allowed. |
| User, confirmed | Needs a customer session and refuses an unconfirmed guest (see the next section). |
| User or Vendor | Shared with the store side. Documented here from the customer's view. |
| Server-to-server | Called by a payment provider, never by the app. |

### Guest accounts

A shopper can check out without signing up. `POST /api/auth/guest/session` turns the name and phone typed at checkout into a passwordless account and signs it in. Until the phone is confirmed with the WhatsApp code (`POST /api/auth/guest/confirm`), the account is an **unconfirmed guest**.

A phone number is not a secret, so an unconfirmed guest's session must not reveal anything the account has stored:

- Routes marked **User, confirmed** answer `403 { "code": "GUEST_NOT_CONFIRMED", "message": "Confirm the code we sent to your WhatsApp to access your account." }`.
- `GET /api/users/profile` returns a reduced profile instead of refusing, because checkout needs it.
- An unconfirmed guest can place **cash** and **card** orders. Wallet and company-account payments are refused, and points are always 0.

Confirming the code turns the guest into a normal account, and its earlier orders, addresses and points become visible.

### Errors

The error body differs by router. Always read `code` when it is present, then fall back to `message`.

| Where | Body |
|---|---|
| Most routes | `{ "message": "..." }` |
| Guest checkout, code sign-in, WhatsApp password reset, wallet, payment confirm, returns | `{ "success": false, "code": "...", "message": "..." }` |
| Family, friends, invitations, verification, Google sign-in, reviews, company | `{ "code": "...", "message": "..." }` |
| Settings, pages, articles, contact, stores, tickets | `{ "success": false, "message": "..." }` |
| Form validation (register, login, reset, contact) | `400 { "message": "<all messages joined>", "errors": [{ "type", "value", "msg", "path", "location" }] }` |
| Wrong one-time code | adds `"attempts_remaining": n` |
| Unknown route | `404 { "message": "Not Found", "error": {} }` |

### Rate limits

Some endpoints are rate-limited (shown on each endpoint). A limit is counted per account when the customer is signed in, otherwise per IP. Each server process keeps its own counters.

Over the limit the server answers `429 { "code": "RATE_LIMITED", "message": "Too many requests. Please try again in N seconds." }` with a `Retry-After` header in seconds.

### One-time codes (WhatsApp and email)

Registration, code sign-in, guest confirmation, password reset by WhatsApp, contact verification and invitations all use the same code rules:

- 6 digits, valid for **10 minutes**. Only the newest code works, and each code works once.
- A new code can be requested **120 seconds** after the last one. Sooner gives `429 OTP_RESEND_COOLDOWN` with `Retry-After`.
- At most **5 codes** in a row (the first plus 4 resends). More gives `429 OTP_RESEND_LIMIT`.
- **5 wrong tries** burn the code: `429 OTP_TOO_MANY_ATTEMPTS`.
- Other answers: `400 OTP_INVALID_FORMAT` (not 6 digits), `400 OTP_INCORRECT` (with `attempts_remaining`), `404 OTP_NOT_FOUND`, `410 OTP_EXPIRED`, `409 OTP_ALREADY_USED`, `502 OTP_DELIVERY_FAILED`.
- Phone codes go by WhatsApp; email codes by email.

### Phone numbers and emails

- **Registration, Google sign-up, contact verification:** non-digits are removed and at least 10 digits are needed. Any country.
- **Guest checkout, guest lookup, code sign-in, WhatsApp password reset, invitations:** must be an Egyptian mobile. `01XXXXXXXXX`, `+201XXXXXXXXX` and `00201XXXXXXXXX` are all accepted. Guest accounts store `01XXXXXXXXX`.
- **Emails are normalised** before they are saved or looked up. Everything is lowercased. For Gmail, dots and `+tag` are removed and `googlemail.com` becomes `gmail.com`. For Outlook, Hotmail, Live, MSN, iCloud and Proton, `+tag` is removed. The email the server sends back can differ from what was typed.
- **Password length:** at least 6 characters on registration, Google sign-up and guest set-password; at least 8 on both password resets.

### Money

- Amounts are plain numbers in **Egyptian pounds (EGP)**, not piastres, rounded to 2 decimals. `GET /api/settings` → `settings.currency` is `"EGP"`.
- A product's selling price is `discount_price ?? price`. For a variant: `variant.discount_price ?? variant.price ?? product.discount_price ?? product.price`.
- The server prices every basket itself. Prices and totals sent by the app are ignored.
- **Checkout total** = `max(0, subtotal − coupon − points) + shipping`. Points never pay for shipping.

### Languages

- Content comes in pairs: `title_en` / `title_ar`, `description_en` / `description_ar`, `slug_en` / `slug_ar`, and so on. Either side may be empty.
- Reference data (categories, cities, shipping methods) uses `name` (English) and `name_ar`. Car makes have only `name`.
- Endpoints that send a message (WhatsApp, email) take `language`: `"ar"`, or anything else for English.
- Notifications come back already translated, in `?language=` or the account's `preferred_language`.

### Images

- Image URLs come in two forms, sometimes in the same response: absolute (`https://readycar.store/uploads/products/...jpg`) and relative (`/uploads/categories/...webp`). Prefix relative ones with `https://readycar.store`.
- Add `?w=160`, `?w=320`, `?w=480` or `?w=800` to any `/uploads/...` `.jpg`, `.jpeg`, `.png` or `.webp` to get a resized WebP copy. Any other width serves the original.

### Pagination

- Products, services, articles, notifications, tickets, wallet, points and returns take `?page=` (from 1) and `?limit=`, and return a `pagination` object: `{ total, page, pages, limit }`.
- Defaults and maximums differ per endpoint and are listed on each one. Some have no maximum, and `page=0` gives a `500` on products, services and articles.
- Home page rows and banners take only `?limit=`.

### Orders and parcels

- An **order** is one payment: one total (`total_price`), one `transaction`, one coupon, one points discount.
- Each order is split into **parcels** (`sub_orders[]`), one per store and pickup branch. Each parcel ships, is tracked, cancelled and returned on its own. Its reference is the order reference plus `-1`, `-2`, and so on.
- Each parcel has its own share of the money (`merchandise_total`, `shipping_share`, `coupon_share`, `loyalty_share`). Its `cod_amount` is what the courier collects on a cash order. The `cod_amount` values of all parcels add up to `total_price`.
- `GET /api/users/orders` adds a ready-made `parcels[]` list and a `journey` (progress steps) to each order for the UI.
- Order reference: `REF-XXXXXXXX` for cash and wallet orders. Card orders use the payment provider's reference.

All status values are listed in [Appendix A](#appendix-a-status-values).

### Online payment: the app must confirm

Card payments go through a hosted payment page (Fawaterak or Paymob). **No order exists until the app confirms the payment.** The flow is the same for orders, buying for a friend, family requests and wallet top-ups:

1. Create the payment. For example, `POST /api/orders` with `"payment_method": "credit_card"` answers `{ "requiresPayment": true, "paymentUrl": "...", "payment": { "id": "..." } }`. Keep `payment.id`.
2. Open `paymentUrl` in a browser or WebView.
3. The provider sends the browser back to a ReadyCar web page, for example `https://readycar.store/checkout?payment=success&paymentId=<id>`. **This URL proves nothing.** Do not show "paid" because of it.
4. **Call the confirm endpoint** with the id from step 1: `POST /api/orders/confirm-payment { "paymentId": "<id>" }`. The server asks the provider directly.
   - `"status": "paid"` → the order is created and returned.
   - `"status": "pending"` → not paid yet. Retry with backoff for a short time, then show "payment not completed".
5. Call confirm every time the customer comes back, whatever `?payment=` says. Once paid, calling it again returns the same order. Do not send two confirm calls at the same moment for the same payment.

**Why this matters:** in production the Fawaterak "paid" webhook is rejected, and no background job turns a paid order payment into an order. If the app never calls confirm, the customer is charged and gets no order.

The confirm endpoint for each flow:

| Flow | Create | Confirm |
|---|---|---|
| Order | `POST /api/orders` | `POST /api/orders/confirm-payment` |
| Buying for a friend | `POST /api/orders/friend-checkout/create-payment` | `POST /api/orders/confirm-payment` (the friend-checkout confirm is broken today; see its entry) |
| Family request | `POST /api/users/family/order-requests/:id/create-payment` | `POST /api/users/family/order-requests/:id/confirm-payment` |
| Wallet top-up | `POST /api/users/wallet/topups` | `POST /api/users/wallet/topups/confirm` (a daily job also credits missed top-ups) |

---

## 2. Customer journeys

Which endpoints each screen calls, in order. Details are in the sections that follow.

**Open the app**
1. `GET /api/settings` for currency, contact details, logos, and the loyalty and wallet switches.
2. `GET /api/auth/me` to learn who is signed in (`401` means nobody).
3. `GET /api/users/verification/status` if signed in, to ask for an unconfirmed email or phone.

**Sign up**
1. `POST /api/auth/register-user` with `verification_channel: "whatsapp"` (a code) or the default email link.
2. Code: `POST /api/auth/verify-registration-otp` (resend: `POST /api/auth/resend-registration-otp`). Email: the link opens `GET /api/auth/verify-email`.
3. The account is created and signed in.

**Sign in**
- Password: `POST /api/auth/login-user` (email or phone + password).
- WhatsApp code: `POST /api/auth/otp-login/send` → `POST /api/auth/otp-login/verify`.
- Google: `GET /api/auth/google/config` → `POST /api/auth/google`. A new customer gets `signup_required` and finishes with `POST /api/auth/google/complete` (adds a phone).
- Forgot password: `POST /api/auth/forgot-password` (email link) → `POST /api/auth/reset-password`, or `POST /api/auth/forgot-password/otp` → `POST /api/auth/reset-password/otp`.

**Browse and search**
- Home: `GET /api/ads/homepage-banners`, `GET /api/products/landing/:section`, `GET /api/ads/promoted-products`, `GET /api/bundles/landing`, `GET /api/vendors/public?placement=home`, `GET /api/services/featured`, `GET /api/corporate-clients`.
- Menus and filters: `GET /api/products/filters`, then `GET /api/products/car-brands/:id/models` when a car make is picked.
- Home page search: car make, model, year and a product type (`filters.productTypes`) → `GET /api/products?car_brand_id=…&car_model_id=…&car_year=…&type_id=…`; the shop shows the type's `category_ids` as cards.
- Search box: `GET /api/products/suggest?q=` on every pause in typing (wait about 120 ms, cancel the previous request), then `GET /api/products?search=` for the full results.
- Shop: `GET /api/products` with query filters.
- Product page: `GET /api/products/slug/:slug` and `GET /api/reviews/product/:productId`.
- Store page: `GET /api/vendors/public/:username`.
- For every item that has an `ad_id`, report impressions and clicks with `POST /api/ads/events`.

**My garage**
`POST /api/users/cars` → `GET /api/users/recommendations` and `GET /api/products?car_brand_id=…&car_model_id=…&car_year=…`.

**Checkout as a guest**
1. `POST /api/auth/guest/lookup` when the phone field loses focus. If the number has an account, offer sign-in by code instead.
2. `POST /api/auth/guest/session` with name and phone (sets the cookie).
3. Continue with the normal checkout below.
4. After the order: `POST /api/auth/guest/confirm/send` → `POST /api/auth/guest/confirm`, then optionally `POST /api/auth/guest/password`.

**Checkout**
1. Cart: kept in the app, and saved for a signed-in customer with `POST /api/users/cart` (read back with `GET /api/users/cart`).
2. Address: `GET /api/users/profile` (saved addresses), `GET /api/shipping/zones` (country and city picker). A new address is saved automatically when the order is placed.
3. Shipping options: `POST /api/shipping/quote`.
4. Coupon: `POST /api/coupons/validate`.
5. Final price, points, wallet, COD: `POST /api/orders/preview`. Always send `shipping_destination`, or shipping is priced at 0.
6. Place: `POST /api/orders`.
   - `cash` or `wallet`: the order is created at once.
   - `credit_card`: open `paymentUrl`, then `POST /api/orders/confirm-payment` (see [Online payment](#online-payment-the-app-must-confirm)).
   - Wallet balance too low (`402`): top up with `POST /api/users/wallet/topups` using the `shortfall` amount.

**After the order**
- List and status: `GET /api/users/orders`. Tracking: `GET /api/users/orders/:id/tracking`.
- Cancel one parcel: `POST /api/users/orders/:id/sub-orders/:subOrderId/cancel`.
- Return: upload photos with `POST /api/upload`, then `POST /api/returns`. Follow it with `GET /api/returns`, `GET /api/returns/:id` and `GET /api/returns/:id/tracking`.
- Review: the WhatsApp link, or `POST /api/users/orders/:id/parcels/:subOrderId/review-link`, opens `GET /api/reviews/invite/:token` → `POST /api/reviews/invite/:token/images` → `POST /api/reviews/invite/:token`.
- Help: `POST /api/tickets`, then `GET /api/tickets/:id` and `POST /api/tickets/:id/messages`.

**Wallet and points**
- Wallet: `GET /api/users/wallet`, `GET /api/users/wallet/transactions`, `POST /api/users/wallet/topups` → `POST /api/users/wallet/topups/confirm`.
- Points: `GET /api/users/loyalty`, `GET /api/users/loyalty/transactions`. Spend them with `redeem_points` on the preview and the order.

**Family**
- The organizer invites: `POST /api/users/family/invitations`. The invitee opens the link: `GET /api/family-invitations/:token`, then accepts (signed in, by registering, or by WhatsApp code).
- A member asks the organizer to pay: `POST /api/users/family/order-requests`.
- The organizer reviews and pays: `GET /api/users/family/order-requests/:id` → `.../approve` → `.../checkout-preview` → `.../place-cod` or `.../create-payment` → `.../confirm-payment`.

**Friends**
- Invite: `POST /api/users/friends/invitations`. An existing customer answers from the Friends tab (`.../invitations/:id/accept`). A new number answers from the link: `GET /api/friend-invitations/:token` → `.../send-code` → `.../accept`.
- Buy for a friend: `GET /api/users/friends/purchasable` → `GET /api/users/friends/:friendId/shared-addresses` → `POST /api/orders/friend-checkout/preview` → `.../create-payment` → confirm.
- A link that starts with `/invite/<token>` can be any invitation type: call `GET /api/invitations/:token/resolve` first.

**Notifications**
Poll `GET /api/users/notifications/count` for the badge. Notifications are not pushed over the socket.

---

## 3. Sign-in and account

### Sign up and sign in

#### `POST /api/auth/register-user`
The customer submits the sign-up form. No account exists yet. The server stores a pending registration and either emails a confirmation link or sends a 6-digit WhatsApp code. The account is created by `GET`/`POST /api/auth/verify-email` (link) or `POST /api/auth/verify-registration-otp` (code). A new submission for the same email or phone replaces any earlier pending one.

- **Auth:** Public

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Trimmed, non-empty. |
| `email` | string | yes | Must be a valid email. Canonicalised. Must not belong to another customer. |
| `phone` | string | yes | Non-digits stripped. At least 10 digits. Must not match an existing customer's digits exactly. |
| `password` | string | yes | At least 6 characters. |
| `verification_channel` | string | no | `"whatsapp"` sends a code to `phone`. Anything else sends an email link. |
| `language` | string | no | `"ar"` or `"en"` (default). Sets the language of the email or WhatsApp message. |

Example body:
```json
{
  "name": "Mona Adel",
  "email": "mona@example.com",
  "phone": "01012345678",
  "password": "secret123",
  "verification_channel": "whatsapp",
  "language": "ar"
}
```

**Response `201`** (WhatsApp):
```json
{
  "message": "We sent a 6-digit code to your WhatsApp number. Enter it to finish creating your account.",
  "verification": {
    "email": "monaadel@gmail.com",
    "role": "user",
    "channel": "whatsapp",
    "verification_id": "6708f3a1c2b4e5d6f7a81234",
    "masked_destination": "*******5678",
    "expires_at": "2026-10-11T10:10:00.000Z",
    "resend_available_at": "2026-10-11T10:02:00.000Z"
  }
}
```
With the email channel, `message` is `"Verification email sent. Please verify your email to complete registration."` and `verification` is `{ "email", "role": "user", "channel": "email", "expires_at" }`. `expires_at` is the link expiry, 24 h by default.

**Errors:**
- `400` — validation failed (`{message, errors[]}`). Causes include `Email already in use` and `Phone already in use`. The phone check also matches an unclaimed guest whose number was typed the same way, so such a guest cannot claim the account here (see [Known issues](#appendix-c-known-issues)).
- `400` — the service found the email or phone taken (`{message}`).
- `500` — `phone` was missing or not a string (sanitizer crash), or another unexpected error.
- `502` — `OTP_DELIVERY_FAILED` (WhatsApp send failed), or `Could not send verification email: …`. The pending record is deleted, so the customer can retry.
- `429` — `OTP_RESEND_COOLDOWN` / `OTP_RESEND_LIMIT`. This is unlikely, because each submission creates a new pending record.

#### `POST /api/auth/verify-registration-otp`
The customer enters the 6-digit code from the registration screen. This creates the account and signs them in.
- **Guest claim:** if an unclaimed guest already owns this phone, that account is upgraded in place, so its orders, addresses and points carry over.
- **Verified stamp:** only the channel the code went to is marked verified. A WhatsApp code sets `phone_verified_at`.
- **Cookie:** sets `token` as a session cookie with a 1-day JWT.

This endpoint is shared with vendor registrations, which return `role: "vendor"` and a `vendor` object instead.

- **Auth:** Public
- **Rate limit:** 30 per 10 min per IP (`register_otp_verify`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `verification_id` | string | yes | From `register-user`. Must be a valid ObjectId. |
| `code` | string | yes | Exactly 6 digits. |

**Response `200`**:
```json
{
  "message": "Verified. Your account has been created.",
  "role": "user",
  "user": {
    "id": "6708f3c9c2b4e5d6f7a81290",
    "name": "Mona Adel",
    "email": "monaadel@gmail.com",
    "profile_image": null,
    "role": "user",
    "cars": []
  }
}
```

**Errors** (`{code, message, attempts_remaining?}`):
- `404` — `VERIFICATION_NOT_FOUND`: id missing or malformed.
- `410` — `VERIFICATION_EXPIRED`: pending record gone or past its expiry.
- `400` — `OTP_INVALID_FORMAT`; `OTP_INCORRECT` (with `attempts_remaining`).
- `404` — `OTP_NOT_FOUND`.
- `410` — `OTP_EXPIRED`.
- `409` — `OTP_ALREADY_USED`.
- `429` — `OTP_TOO_MANY_ATTEMPTS`; `RATE_LIMITED`.
- `400` — `Email already in use` / `Phone already in use` (no `code`): taken while the registration was pending.

#### `POST /api/auth/resend-registration-otp`
"Send the code again" on the registration code screen. The code goes to the same place and by the same channel as the original.

- **Auth:** Public
- **Rate limit:** 10 per hour per IP (`register_otp_resend`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `verification_id` | string | yes | From `register-user`. |
| `language` | string | no | `"ar"` or `"en"`. |

**Response `200`**:
```json
{
  "message": "A new code is on its way.",
  "verification": {
    "channel": "whatsapp",
    "verification_id": "6708f3a1c2b4e5d6f7a81234",
    "masked_destination": "*******5678",
    "expires_at": "2026-10-11T10:14:00.000Z",
    "resend_available_at": "2026-10-11T10:06:00.000Z"
  }
}
```

**Errors** (`{code, message}`):
- `404` — `VERIFICATION_NOT_FOUND`.
- `410` — `VERIFICATION_EXPIRED`.
- `409` — `VERIFICATION_NOT_OTP`: this registration is confirmed by an emailed link, not a code.
- `429` — `OTP_RESEND_COOLDOWN` (with a `Retry-After` header); `OTP_RESEND_LIMIT`; `RATE_LIMITED`.
- `502` — `OTP_DELIVERY_FAILED`.

#### `GET /api/auth/verify-email`
The link in the registration email. On success the server creates the account (or claims an unclaimed guest with the same phone), stamps `email_verified_at`, sets the `token` cookie (session cookie, 1-day JWT) and redirects to the storefront login page. This endpoint is shared with vendor email-link registrations.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | string | yes | The raw token from the email link. |

**Response `302`**: redirects to `${FRONTEND_URL}/login?verified=1&role=customer&auto=1`.

**Errors:**
- Any failure (missing, invalid or expired token; email or phone taken in the meantime) redirects to `${FRONTEND_URL}/login?verified=0`. No error body is returned.

#### `POST /api/auth/verify-email`
The JSON version of the email link, for API clients. Same effect as the `GET`: creates the account, stamps `email_verified_at` and sets the cookie. Shared with vendors.

- **Auth:** Public

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | string | yes | The raw token from the email link. |

**Response `200`**:
```json
{
  "message": "Email verified successfully. Your account has been created.",
  "role": "user",
  "user": {
    "id": "6708f3c9c2b4e5d6f7a81290",
    "name": "Mona Adel",
    "email": "monaadel@gmail.com",
    "profile_image": null,
    "role": "user",
    "cars": []
  }
}
```

**Errors** (`{message}`):
- `400` — `Verification token is required`; `Verification link is invalid or expired`; `Email already in use` / `Phone already in use`.
- `500` — anything else.

#### `POST /api/auth/login-user`
The customer signs in with a password. The identifier can be an email or a phone number in any stored format. A passwordless account (unclaimed guest, or a guest who never set a password) always gets `Invalid credentials`. Sets the `token` cookie.

- **Auth:** Public

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `identifier` | string | yes | Email or phone. The validator message mentions "username", but customers have none. |
| `password` | string | yes | Non-empty. |
| `remember_me` | boolean \| `"true"` | no | `true` gives a 30-day JWT and a 30-day cookie. Otherwise the JWT lasts 1 day and the cookie is a session cookie. |

Example body:
```json
{
  "identifier": "01012345678",
  "password": "secret123",
  "remember_me": true
}
```

**Response `200`**:
```json
{
  "message": "Login successful",
  "user": {
    "id": "66f0b8d2a4c3e21f9b7a1c55",
    "name": "Mona Adel",
    "email": "monaadel@gmail.com",
    "profile_image": "/uploads/users/profile-1760170000000-123456789.jpg",
    "role": "user",
    "cars": [
      {
        "_id": "66f0c01aa4c3e21f9b7a1d10",
        "car_brand_id": "64b7e2f1a1b2c3d4e5f60711",
        "car_brand_name": "Hyundai",
        "car_model_id": "64b7e2f1a1b2c3d4e5f60822",
        "car_model_name": "Elantra",
        "year": 2019
      }
    ]
  }
}
```

**Errors** (`{message}`):
- `400` — validation (`{message, errors[]}`).
- `401` — `Invalid credentials`.
- `500` — unexpected error.

#### `GET /api/auth/google/config`
The login and sign-up screens call this to decide whether to show the "Continue with Google" button.

- **Auth:** Public

**Response `200`**:
```json
{ "enabled": true }
```

#### `POST /api/auth/google`
The customer finishes the Google popup and the browser posts the Google ID token.
- **Existing customer:** if the token matches a customer by `google_id` or email, they are signed in. The cookie is set, the Google id is linked, the Google picture is copied if they have no photo, and `email_verified_at` is stamped.
- **New customer:** the response is a `signup_required` handoff instead, because Google never supplies a phone number. No cookie is set. The handoff is finished with `/api/auth/google/complete`.

- **Auth:** Public
- **Rate limit:** 30 per 10 min per IP (`google_auth`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `credential` | string | yes | Google Identity Services ID token. It must be RS256-signed by Google, have `aud` equal to `GOOGLE_CLIENT_ID`, be unexpired, and carry a Google-verified email. |
| `role` | string | no | Omit it, or send `"user"`. `"vendor"` switches to the store flow, which is not covered here. |
| `remember_me` | boolean \| `"true"` | no | Same as `login-user`. |

**Response `200`** (signed in):
```json
{
  "message": "Login successful",
  "status": "authenticated",
  "role": "user",
  "user": {
    "id": "66f0b8d2a4c3e21f9b7a1c55",
    "name": "Mona Adel",
    "email": "monaadel@gmail.com",
    "profile_image": "https://lh3.googleusercontent.com/a/ACg8ocK...",
    "role": "user",
    "cars": []
  }
}
```

**Response `200`** (no account yet; no cookie set):
```json
{
  "status": "signup_required",
  "role": "user",
  "signup_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "profile": { "name": "Mona Adel", "email": "monaadel@gmail.com", "picture": "https://lh3.googleusercontent.com/a/ACg8ocK..." }
}
```
`signup_token` is valid for 30 minutes.

**Errors** (`{code, message}`):
- `400` — `GOOGLE_TOKEN_MISSING`; `GOOGLE_EMAIL_MISSING`; `GOOGLE_EMAIL_UNVERIFIED`.
- `401` — `GOOGLE_TOKEN_INVALID`; `GOOGLE_TOKEN_EXPIRED`.
- `502` — `GOOGLE_UNREACHABLE`: Google's signing keys could not be fetched.
- `503` — `GOOGLE_NOT_CONFIGURED`: no `GOOGLE_CLIENT_ID`.
- `429` — `RATE_LIMITED`.
- `500` — `GOOGLE_AUTH_ERROR`: anything else.

#### `POST /api/auth/google/complete`
The customer adds a phone number (and optionally a password) after a `signup_required` answer. This creates the account and signs them in.
- **Verified stamps:** `email_verified_at` is set (Google vouched for the email). `phone_verified_at` stays null, so the app later prompts for a WhatsApp code.
- **No password given:** a random password hash is stored. "Forgot password" is how the customer adds a real one.
- **Already created:** if the account already exists (made in another tab), that session is returned instead.
- **Cookie:** set as a session cookie with a 1-day JWT.
- **Role:** which fields matter is decided by the role inside `signup_token`, not by the body.

- **Auth:** Public
- **Rate limit:** 20 per 10 min per IP (`google_signup_complete`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `signup_token` | string | yes | From `POST /api/auth/google`. |
| `phone` | string | yes | Non-digits stripped. At least 10 digits. |
| `password` | string | no | If given, at least 6 characters. |
| `language` | string | no | `"ar"` or `"en"`. Saved as `preferred_language`. |

**Response `201`**:
```json
{
  "message": "Your account has been created.",
  "status": "authenticated",
  "role": "user",
  "user": {
    "id": "6708f5e0c2b4e5d6f7a812f0",
    "name": "Mona Adel",
    "email": "monaadel@gmail.com",
    "profile_image": "https://lh3.googleusercontent.com/a/ACg8ocK...",
    "role": "user",
    "cars": []
  }
}
```

**Errors** (`{code, message}`):
- `410` — `GOOGLE_SIGNUP_EXPIRED`: token missing, invalid or older than 30 min.
- `400` — `INVALID_PHONE`; `WEAK_PASSWORD`.
- `409` — `PHONE_IN_USE`: exact-digits match on any customer, including an unclaimed guest, which is not claimed here.
- `429` — `RATE_LIMITED`.

#### `POST /api/auth/otp-login/send`
"Sign in with a WhatsApp code" for an existing account, for example from the checkout phone field. The answer is the same whether or not the number has an account, so the endpoint cannot be used to look up numbers. No code is sent to unknown numbers or unclaimed guests.

- **Auth:** Public
- **Rate limit:** 10 per hour per IP (`otp_login_send`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `phone` | string | yes | Must be an Egyptian mobile. An invalid number still gets the generic success answer. |
| `language` | string | no | `"ar"` or `"en"`. |

Example body:
```json
{
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
When nothing was sent, `verification` is only `{ "sent": true, "masked_destination": "*******5678" }`.

**Errors** (`{success:false, code, message}`):
- `429` — `OTP_RESEND_COOLDOWN` (with `Retry-After`); `OTP_RESEND_LIMIT`; `RATE_LIMITED`.

#### `POST /api/auth/otp-login/verify`
The customer enters the sign-in code. Sets the `token` cookie and stamps `phone_verified_at` if it was missing. A number with no account fails exactly like a wrong code.

- **Auth:** Public
- **Rate limit:** 30 per 10 min per IP (`otp_login_verify`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `phone` | string | yes | Must be an Egyptian mobile. |
| `code` | string | yes | Exactly 6 digits. |
| `remember_me` | any | no | Any truthy value gives a 30-day JWT and cookie; even the string `"false"` counts as true. Otherwise 1 day and a session cookie. |

Example body:
```json
{
  "phone": "01012345678",
  "code": "123456",
  "remember_me": true
}
```

**Response `200`**:
```json
{
  "success": true,
  "user": {
    "id": "66f0b8d2a4c3e21f9b7a1c55",
    "name": "Mona Adel",
    "email": "monaadel@gmail.com",
    "profile_image": null,
    "role": "user",
    "account_status": "active",
    "is_guest": false,
    "cars": []
  }
}
```

**Errors** (`{success:false, code, message, attempts_remaining?}`):
- `400` — `OTP_INCORRECT`: an invalid or unknown number, or a wrong code; a wrong code adds `attempts_remaining`. Also `OTP_INVALID_FORMAT`.
- `404` — `OTP_NOT_FOUND`.
- `410` — `OTP_EXPIRED`.
- `409` — `OTP_ALREADY_USED`.
- `429` — `OTP_TOO_MANY_ATTEMPTS`; `RATE_LIMITED`.

#### `GET /api/auth/me`
The app calls this on load to find out who is signed in. It also drives the prompt asking the customer to confirm whichever contact detail is still unverified. Shared with vendors, whose response is `{ "role": "vendor", "vendor": { … } }`. It does not redact for an unclaimed guest.

- **Auth:** User or Vendor

**Response `200`** (customer):
```json
{
  "role": "user",
  "user": {
    "id": "66f0b8d2a4c3e21f9b7a1c55",
    "name": "Mona Adel",
    "email": "monaadel@gmail.com",
    "phone": "01012345678",
    "profile_image": "/uploads/users/profile-1760170000000-123456789.jpg",
    "role": "user",
    "cars": [],
    "email_verified": true,
    "phone_verified": false
  }
}
```

**Errors:**
- `401` / `403` — session refused (see [Authentication](#authentication)).

#### `POST /api/auth/logout`
"Sign out". Clears the `token` cookie. Shared with vendors.

- **Auth:** Public (no session needed)

**Response `200`**:
```json
{ "message": "Logged out successfully" }
```

### Guest checkout

#### `POST /api/auth/guest/lookup`
Called when the customer leaves the phone field at checkout, to offer a returning customer their own account. The answer is only a pair of booleans.

- **Exists:** `exists` is true only for an account someone can sign in to. An unclaimed guest reports `false`.
- **Password:** `can_use_password` is true when the account has a password hash.

- **Auth:** Public
- **Rate limit:** 20 per 10 min per IP (`guest_phone_lookup`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `phone` | string | yes | An invalid number answers `{exists:false, can_use_password:false}`. |

**Response `200`**:
```json
{ "exists": true, "can_use_password": true }
```

**Errors:**
- `429` — `RATE_LIMITED`. Every other failure answers `{ "exists": false, "can_use_password": false }`.

#### `POST /api/auth/guest/session`
The customer types their name and phone at checkout without an account.
- **New number:** creates a passwordless guest account.
- **Unclaimed guest with this number:** reuses it, refreshing the name.

Either way it sets the `token` cookie (30-day Max-Age, 7-day JWT). If the number belongs to a real account, the call is refused and the screen should offer a sign-in code instead.

- **Auth:** Public
- **Rate limit:** 10 per 10 min per IP (`guest_session`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Trimmed, non-empty. |
| `phone` | string | yes | Must be an Egyptian mobile. Stored as `01XXXXXXXXX`. |
| `language` | string | no | `"ar"` or `"en"`. Saved as `preferred_language` on a new guest. |

Example body:
```json
{
  "name": "Ahmed Samir",
  "phone": "01112345678",
  "language": "ar"
}
```

**Response `201`**:
```json
{
  "success": true,
  "user": {
    "id": "6708f7b2c2b4e5d6f7a81355",
    "name": "Ahmed Samir",
    "email": null,
    "phone": "01112345678",
    "profile_image": null,
    "role": "user",
    "account_status": "guest",
    "phone_verified_at": null,
    "is_guest": true,
    "cars": []
  }
}
```

**Errors** (`{success:false, code, message}`):
- `400` — `GUEST_NAME_REQUIRED`; `GUEST_PHONE_INVALID`.
- `409` — `ACCOUNT_EXISTS`: the number belongs to a claimed account. Send a sign-in code instead.
- `429` — `RATE_LIMITED`.

#### `POST /api/auth/guest/confirm/send`
The order-confirmation screen asks the guest to confirm their number and sends a WhatsApp code to the account's phone. It works for any signed-in customer whose phone is not yet verified.

- **Auth:** User
- **Rate limit:** 10 per hour per account (`guest_confirm_send`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `language` | string | no | `"ar"` or `"en"`. |

**Response `200`**:
```json
{
  "success": true,
  "verification": {
    "channel": "whatsapp",
    "masked_destination": "*******5678",
    "expires_at": "2026-10-11T10:10:00.000Z",
    "resend_available_at": "2026-10-11T10:02:00.000Z"
  }
}
```

**Errors** (`{success:false, code, message}`):
- `409` — `PHONE_ALREADY_VERIFIED`.
- `429` — `OTP_RESEND_COOLDOWN` (with `Retry-After`); `OTP_RESEND_LIMIT`; `RATE_LIMITED`.
- `502` — `OTP_DELIVERY_FAILED`.
- `401` — `protect` failures.

#### `POST /api/auth/guest/confirm`
The guest enters the code. This claims the account: it sets `phone_verified_at`, sets `account_status` to `"active"`, and stamps `guest_phone_confirmed_at` on every guest order of this account. From then on the account's addresses, orders and points are visible to this session.

- **Auth:** User
- **Rate limit:** 30 per 10 min per account (`guest_confirm_verify`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `code` | string | yes | Exactly 6 digits. |

**Response `200`**:
```json
{
  "success": true,
  "already_confirmed": false,
  "user": {
    "id": "6708f7b2c2b4e5d6f7a81355",
    "name": "Ahmed Samir",
    "email": null,
    "phone": "01112345678",
    "profile_image": null,
    "role": "user",
    "account_status": "active",
    "phone_verified_at": "2026-10-11T10:03:12.000Z",
    "is_guest": false,
    "cars": []
  }
}
```
If the phone was already verified, the response is `already_confirmed: true` with the current user. No code is checked in that case.

**Errors** (`{success:false, code, message, attempts_remaining?}`):
- `400` — `OTP_INVALID_FORMAT`; `OTP_INCORRECT` (with `attempts_remaining`).
- `404` — `OTP_NOT_FOUND`.
- `410` — `OTP_EXPIRED`.
- `409` — `OTP_ALREADY_USED`.
- `429` — `OTP_TOO_MANY_ATTEMPTS`; `RATE_LIMITED`.

#### `POST /api/auth/guest/password`
An optional step on the confirmation screen: the confirmed guest sets a password so they can sign in with it later. It is refused until the phone is confirmed. Setting the password stamps `password_changed_at`, which signs out the current session too (see [Authentication](#authentication)).

- **Auth:** User
- **Rate limit:** 10 per hour per account (`guest_set_password`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `password` | string | yes | At least 6 characters. |

**Response `200`**:
```json
{ "success": true, "message": "Password set. You can now sign in with it." }
```

**Errors** (`{success:false, code, message}`):
- `403` — `PHONE_NOT_VERIFIED`.
- `400` — `PASSWORD_TOO_SHORT`.
- `409` — `PASSWORD_ALREADY_SET`.
- `429` — `RATE_LIMITED`.

### Password reset

#### `POST /api/auth/forgot-password`
"Forgot password" by email. If a customer account has this email, a reset link is emailed: `${FRONTEND_URL}/reset-password?token=…&role=user`, valid 60 min (`PASSWORD_RESET_TOKEN_TTL_MINUTES`). The answer is identical whether or not the account exists. Another request within 60 s (`PASSWORD_RESET_RESEND_COOLDOWN_SECONDS`) sends nothing new. Shared with vendors via `role`.

- **Auth:** Public

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `role` | string | yes | `"user"` for customers. `"vendor"` is the store flow. |
| `email` | string | yes | Must be a valid email. Canonicalised. |
| `language` | string | no | `"ar"` or `"en"`. |

**Response `200`**:
```json
{ "message": "If an account exists for this email, a password reset link has been sent." }
```

**Errors:**
- `400` — validation (`{message, errors[]}`).
- `500` — unexpected error. A failed email send is logged and still answers 200.

#### `POST /api/auth/reset-password`
The customer opens the emailed link and chooses a new password. On success: the new password is saved, `password_changed_at` is set (signing out every existing session), and all outstanding reset links are retired. No cookie is set; the customer signs in afterwards.

- **Auth:** Public

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | string | yes | From the link's `token` query parameter. |
| `password` | string | yes | At least 8 characters. |

**Response `200`**:
```json
{ "role": "user", "message": "Password has been reset successfully." }
```

**Errors** (`{message}`):
- `400` — validation (`{message, errors[]}`); `Password reset link is invalid or expired`.
- `500` — unexpected error.

#### `POST /api/auth/forgot-password/otp`
"Forgot password" by WhatsApp, as an alternative to email. If the number belongs to a customer, a 6-digit code is sent. Unclaimed guests are excluded. The answer is the same whether or not the account exists. Shared with vendors via `role`.

- **Auth:** Public
- **Rate limit:** 10 per hour per IP (`password_reset_otp_send`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `role` | string | no | `"vendor"` is the store flow. Anything else, including omitting it, means customer. |
| `phone` | string | yes | Must be an Egyptian mobile. |
| `language` | string | no | `"ar"` or `"en"`. |

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
When nothing was sent (unknown number, or a delivery failure), `verification` is only `{ "sent": true, "masked_destination": "..." }`.

**Errors** (`{success:false, code, message}`):
- `400` — `INVALID_PHONE`: not an Egyptian mobile.
- `429` — `OTP_RESEND_COOLDOWN` (with `Retry-After`); `OTP_RESEND_LIMIT`; `RATE_LIMITED`.

#### `POST /api/auth/reset-password/otp`
The customer enters the WhatsApp code and a new password. On success:
- the password is saved and `password_changed_at` is set, which signs out other sessions;
- `phone_verified_at` is stamped if it was missing;
- any emailed reset links are retired.

No cookie is set. An unknown number fails exactly like a wrong code.

- **Auth:** Public
- **Rate limit:** 30 per 10 min per IP (`password_reset_otp_verify`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `role` | string | no | As above. |
| `phone` | string | yes | Must be an Egyptian mobile. |
| `code` | string | yes | Exactly 6 digits. |
| `password` | string | yes | At least 8 characters. |

**Response `200`**:
```json
{ "success": true, "role": "user", "message": "Password has been reset successfully." }
```

**Errors** (`{success:false, code, message, attempts_remaining?}`):
- `400` — `WEAK_PASSWORD`; `OTP_INCORRECT` (unknown number, or a wrong code with `attempts_remaining`); `OTP_INVALID_FORMAT`.
- `404` — `OTP_NOT_FOUND`.
- `410` — `OTP_EXPIRED`.
- `409` — `OTP_ALREADY_USED`.
- `429` — `OTP_TOO_MANY_ATTEMPTS`; `RATE_LIMITED`.

### Email and phone verification

All four routes are shared with vendors. Both the account and its role come from the session, never from the body. Error body: `{code, message, attempts_remaining?}`.

#### `GET /api/users/verification/status`
The post-login prompt calls this to decide what, if anything, to ask the customer to confirm. It also lets the prompt resume a staged email or phone change.

- **Auth:** User or Vendor

**Response `200`**:
```json
{
  "email": "monaadel@gmail.com",
  "phone": "01012345678",
  "email_verified": true,
  "phone_verified": false,
  "pending_email": null,
  "pending_phone": "01098765432",
  "fully_verified": false,
  "resend_cooldown_seconds": 120
}
```

**Errors:**
- `404` — `USER_NOT_FOUND`.
- `401` / `403` — `protect` failures.

#### `POST /api/users/verification/send`
Sends a code to confirm the email (by email) or the phone (by WhatsApp).
- **With `value`:** the new email or phone is first staged in `pending_email` / `pending_phone`, and the code goes there. The live value is untouched until the code is confirmed.
- **Without `value`:** the code goes to the staged value if there is one, otherwise to the live value.

- **Auth:** User or Vendor
- **Rate limit:** 15 per hour per account (`contact_verify_send`)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `target` | string | yes | `"email"` or `"phone"`. |
| `value` | string | no | A replacement value. Email must be valid and is canonicalised. Phone has non-digits stripped and needs at least 10 digits. It must not be live or pending on another account of the same role. If it equals the current value, nothing is staged. |
| `language` | string | no | `"ar"` or `"en"`. |

Example body:
```json
{
  "target": "phone",
  "value": "01098765432",
  "language": "ar"
}
```

**Response `200`**:
```json
{
  "message": "Verification code sent.",
  "target": "phone",
  "channel": "whatsapp",
  "masked_destination": "*******5432",
  "expires_at": "2026-10-11T10:10:00.000Z",
  "resend_available_at": "2026-10-11T10:02:00.000Z",
  "delivery_reference": "184223"
}
```
`delivery_reference` is the WhatsApp provider's campaign id, or `null` (email codes are always `null`).

**Errors:**
- `400` — `INVALID_TARGET`; `INVALID_EMAIL`; `INVALID_PHONE`; `OTP_DESTINATION_REQUIRED` (no email or phone on file).
- `409` — `EMAIL_IN_USE`; `PHONE_IN_USE`.
- `404` — `USER_NOT_FOUND`.
- `429` — `OTP_RESEND_COOLDOWN` (with `Retry-After`); `OTP_RESEND_LIMIT`; `RATE_LIMITED`.
- `502` — `OTP_DELIVERY_FAILED`.

#### `POST /api/users/verification/confirm`
The customer enters the code. This stamps `email_verified_at` or `phone_verified_at`. If a staged value exists and this code was sent to it, the staged value replaces the live one. Writes an audit-log entry.

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
  "email": "monaadel@gmail.com",
  "phone": "01098765432",
  "email_verified": true,
  "phone_verified": true
}
```

**Errors:**
- `400` — `INVALID_TARGET`; `OTP_INVALID_FORMAT`; `OTP_INCORRECT` (with `attempts_remaining`).
- `404` — `OTP_NOT_FOUND`; `USER_NOT_FOUND`.
- `410` — `OTP_EXPIRED`.
- `409` — `OTP_ALREADY_USED`; `EMAIL_IN_USE` / `PHONE_IN_USE` (claimed by another account between send and confirm).
- `429` — `OTP_TOO_MANY_ATTEMPTS`; `RATE_LIMITED`.

#### `POST /api/users/verification/cancel`
The customer abandons a staged email or phone change. Clears the pending value and any outstanding code for that target.

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

### Profile

#### `GET /api/users/profile`
Loads the profile page. Checkout also calls it to prefill saved addresses. It returns the whole user document without `password`.

For an unclaimed guest it returns a redacted stub instead of refusing, because checkout runs on a guest session.

- **Auth:** User (redacted for an unclaimed guest)

**Response `200`** (full user document):
```json
{
  "_id": "66f0b8d2a4c3e21f9b7a1c55",
  "name": "Mona Adel",
  "email": "monaadel@gmail.com",
  "phone": "01012345678",
  "profile_image": "/uploads/users/profile-1760170000000-123456789.jpg",
  "password_changed_at": null,
  "created_at": "2026-09-02T14:20:11.000Z",
  "account_status": "active",
  "preferred_language": "ar",
  "email_verified_at": "2026-09-02T14:25:00.000Z",
  "phone_verified_at": null,
  "cod_risk": {
    "override": null,
    "override_reason": "",
    "override_by": "",
    "override_at": null,
    "bosta_ranking": null,
    "bosta_delivered": null,
    "bosta_returned": null,
    "bosta_checked_at": null
  },
  "pending_email": null,
  "pending_phone": null,
  "addresses": [
    {
      "_id": "66f0bf11a4c3e21f9b7a1cf0",
      "recipient_name": "Mona Adel",
      "phone": "01012345678",
      "full_address": "12 El-Tahrir St, Dokki",
      "label": "Home",
      "shipping_country": "Egypt",
      "shipping_city": "Giza",
      "is_default": true
    }
  ],
  "cart": {
    "updated_at": "2026-10-10T19:02:44.000Z",
    "items": [
      { "_id": "6708e0aac2b4e5d6f7a80f01", "product_id": "66e9a1b2c3d4e5f6a7b8c9d0", "variant_id": null, "quantity": 2 }
    ]
  },
  "cars": [
    {
      "_id": "66f0c01aa4c3e21f9b7a1d10",
      "car_brand_id": "64b7e2f1a1b2c3d4e5f60711",
      "car_brand_name": "Hyundai",
      "car_model_id": "64b7e2f1a1b2c3d4e5f60822",
      "car_model_name": "Elantra",
      "year": 2019
    }
  ],
  "__v": 4
}
```
`google_id` is also present when the account is linked to Google. Each cart item's `bundle_id` is set for bundle lines.

**Response `200`** (unclaimed guest):
```json
{
  "_id": "6708f7b2c2b4e5d6f7a81355",
  "name": "Ahmed Samir",
  "email": null,
  "phone": "01112345678",
  "profile_image": null,
  "account_status": "guest",
  "is_guest": true,
  "addresses": [],
  "cars": []
}
```

**Errors:**
- `500` — unexpected error.

#### `PUT /api/users/profile`
The customer saves the edit-profile form. Only the fields sent are written; keys left out are untouched.
- **No verification:** `email` and `phone` are written directly, with no code, and `email_verified_at` / `phone_verified_at` are not reset. The verified way to change them is `POST /api/users/verification/send` with `value`.
- **Guests:** not guarded, and the response is not redacted for an unclaimed guest.

- **Auth:** User

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | no | An empty string fails the schema's `required` rule, which gives a 500. |
| `email` | string | no | Canonicalised. Refused if another customer has it. |
| `phone` | string | no | Stored as sent (no formatting). A duplicate hits the unique index, which gives a 500. |
| `preferred_language` | string | no | Only `"en"` or `"ar"` is applied. Any other value is ignored. |

Example body:
```json
{
  "name": "Mona Adel",
  "preferred_language": "ar"
}
```

**Response `200`**:
```json
{
  "message": "Profile updated successfully",
  "profile": { "_id": "66f0b8d2a4c3e21f9b7a1c55", "name": "Mona A. Adel", "email": "monaadel@gmail.com", "phone": "01012345678", "preferred_language": "en", "addresses": [], "cars": [] }
}
```
`profile` is the full user document without `password`, the same shape as `GET /api/users/profile`. It is abridged here.

**Errors** (`{message}`):
- `409` — `This email is already used by another account`.
- `500` — validation or duplicate-key errors, and anything else.

#### `PUT /api/users/profile-photo`
The customer uploads a new profile photo (multipart). The file is saved under `/uploads/users/` and its relative path is stored in `profile_image`. Not guarded for guests.

- **Auth:** User

**Body** (`multipart/form-data`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `profile_image` | file | yes | Must be jpeg, jpg, png or webp; both the extension and the MIME type must match. Maximum 3 MB. |

**Response `200`**:
```json
{
  "message": "Profile photo updated successfully",
  "profile": { "_id": "66f0b8d2a4c3e21f9b7a1c55", "name": "Mona Adel", "profile_image": "/uploads/users/profile-1760171234567-845120394.webp" }
}
```
`profile` is the full user document without `password`. It is abridged here.

**Errors** (`{message}`):
- `400` — `No file uploaded`; `Images only (jpeg, jpg, png, webp)!`; multer errors such as `File too large`.
- `500` — unexpected error.

#### `PUT /api/users/change-password`
The customer changes their password from settings. Sets `password_changed_at`, which signs out every session including this one, and no new cookie is issued (see [Authentication](#authentication)).

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `oldPassword` | string | yes | camelCase. |
| `newPassword` | string | yes | camelCase. No length rule is enforced. |

**Response `200`**:
```json
{ "message": "Password changed successfully" }
```

**Errors** (`{message}`):
- `400` — `Please provide old and new passwords`.
- `401` — `Incorrect old password`.
- `500` — anything else. This includes an account with no stored password hash, such as a claimed guest who never set one; bcrypt throws (unverified in practice).

### Addresses

Each endpoint returns the customer's whole `addresses` array after the change.

#### `POST /api/users/addresses`
The customer saves a new delivery address, from the address book or checkout. The first address becomes the default automatically. Sending `is_default: true` clears the flag on the others. Not guarded for unclaimed guests, so the response returns that account's entire address book (see [Known issues](#appendix-c-known-issues)).

- **Auth:** User

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `recipient_name` | string | yes | Required by the schema. |
| `phone` | string | yes | Required by the schema. Not formatted. |
| `full_address` | string | yes | Required by the schema. |
| `label` | string | no | e.g. `"Home"`. Trimmed. Default `""`. |
| `shipping_country` | string | no | e.g. `"Egypt"`. |
| `shipping_city` | string | no | e.g. `"Giza"`. Not checked against the city list. |
| `is_default` | boolean | no | |

Example body:
```json
{
  "recipient_name": "Mona Adel",
  "phone": "01012345678",
  "full_address": "12 El-Tahrir St, Dokki",
  "label": "Home",
  "shipping_country": "Egypt",
  "shipping_city": "Giza",
  "is_default": true
}
```

**Response `201`**:
```json
{
  "message": "Address added successfully",
  "addresses": [
    {
      "_id": "66f0bf11a4c3e21f9b7a1cf0",
      "recipient_name": "Mona Adel",
      "phone": "01012345678",
      "full_address": "12 El-Tahrir St, Dokki",
      "label": "Home",
      "shipping_country": "Egypt",
      "shipping_city": "Giza",
      "is_default": true
    }
  ]
}
```

**Errors** (`{message}`):
- `500` — every failure, including a missing required field (Mongoose validation message).

#### `PUT /api/users/addresses/:id`
The customer edits a saved address. Fields are merged into the existing address. `is_default: true` clears the flag on the others.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | `addresses[]._id` |

**Body:** any subset of the fields of `POST /api/users/addresses`.

**Response `200`**:
```json
{ "message": "Address updated successfully", "addresses": [ { "_id": "66f0bf11a4c3e21f9b7a1cf0", "recipient_name": "Mona Adel", "phone": "01012345678", "full_address": "14 El-Tahrir St, Dokki", "label": "Home", "shipping_country": "Egypt", "shipping_city": "Giza", "is_default": true } ] }
```

**Errors** (`{message}`):
- `500` — `Address not found`, validation errors, and anything else. All failures return 500.

#### `DELETE /api/users/addresses/:id`
The customer deletes a saved address. If the default was removed, the first remaining address becomes the default. An unknown id is a no-op that still returns 200.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | `addresses[]._id` |

**Response `200`**:
```json
{ "message": "Address deleted successfully", "addresses": [] }
```

**Errors:**
- `500` — unexpected error.

### My garage and recommendations

#### `POST /api/users/cars`
The customer adds a car to "My garage". This drives compatibility filtering and recommendations. A garage holds at most 5 cars, and the same model and year cannot be added twice. Brand and model ids are not checked against the catalogue. Not guarded for unclaimed guests.

- **Auth:** User

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `car_brand_id` | ObjectId | yes | |
| `car_brand_name` | string | yes | |
| `car_model_id` | ObjectId | yes | |
| `car_model_name` | string | yes | |
| `year` | number | yes | Coerced with `Number()`. |

Example body:
```json
{
  "car_brand_id": "64b7e2f1a1b2c3d4e5f60711",
  "car_brand_name": "Hyundai",
  "car_model_id": "64b7e2f1a1b2c3d4e5f60822",
  "car_model_name": "Elantra",
  "year": 2019
}
```

**Response `201`**:
```json
{
  "message": "Car added successfully",
  "cars": [
    {
      "_id": "66f0c01aa4c3e21f9b7a1d10",
      "car_brand_id": "64b7e2f1a1b2c3d4e5f60711",
      "car_brand_name": "Hyundai",
      "car_model_id": "64b7e2f1a1b2c3d4e5f60822",
      "car_model_name": "Elantra",
      "year": 2019
    }
  ]
}
```

**Errors** (`{message}`):
- `400` — `Maximum of 5 cars allowed`; `This car is already in your garage`; Mongoose validation message for a missing or invalid field.

#### `DELETE /api/users/cars/:id`
The customer removes a car from the garage. An unknown id is a no-op that still returns 200.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | `cars[]._id` |

**Response `200`**:
```json
{ "message": "Car removed successfully", "cars": [] }
```

**Errors:**
- `500` — unexpected error.

#### `GET /api/users/recommendations`
The "Picked for your car" row (home page) and the profile's recommendations tab. It returns published products from active vendors (not suspended, subscription `active` or `trial_active`), from two pools:
- **car**: parts made for a car in the garage (whole brand, the model for all years, or the model for that year);
- **universal**: products that fit any car (`is_universal: true`).

The two are mixed 60/40: in every ten, six from the car pool and four universal, spread through (car, car, universal, car, universal, …). When one pool runs out, the other fills the rest. Each pool is ordered by `sold_count` descending, then newest first. Products the customer ordered in the last 30 days (orders not cancelled, lines not declined by the vendor) are left out. Both lists are empty when the garage is empty.

The answer is sent with `Cache-Control: private, no-store`.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | number | no | Default 5, clamped to 1–20. Non-numbers and `0` fall back to 5. |

**Response `200`**. `products`: whole Product documents (`.lean()`), each with one more field, `fit`: `"car"` (made for a garage car) or `"universal"`. `cars`: the garage cars, named (`"Toyota Corolla 2020"`), for the row's subtitle.
- `category_id` and `product_brand_id` are populated.
- `vendor_id` is populated with public fields only: `store_name`, `store_username`, `store_slug`, `store_image`, `status`, `subscription_status`, `completed_orders_count`, `rating`, `reviews_count`, `auto_publish_products`, `created_at`.

Abridged example:
```json
{
  "products": [
    {
      "_id": "66e9a1b2c3d4e5f6a7b8c9d0",
      "fit": "car",
      "title_en": "Front Brake Pads – Hyundai Elantra",
      "title_ar": "تيل فرامل أمامي – هيونداي إلنترا",
      "slug_en": "front-brake-pads-hyundai-elantra",
      "sku": "BP-ELN-19",
      "price": 750,
      "discount_price": 690,
      "status": "published",
      "is_universal": false,
      "sold_count": 41,
      "rating": 4.6,
      "reviews_count": 12,
      "stock_status": "instock",
      "images": [{ "url": "https://readycar.store/uploads/products/product-1726000000000-1.jpg", "is_primary": true }],
      "compatible_cars": [{ "brand_id": "64b7e2f1a1b2c3d4e5f60711", "brand_name": "Hyundai", "all_models": false, "models": [{ "model_id": "64b7e2f1a1b2c3d4e5f60822", "model_name": "Elantra", "years": [2017, 2018, 2019], "all_years": false }] }],
      "category_id": { "_id": "64a0c1d2e3f4a5b6c7d8e9f0", "name": "Brakes", "name_ar": "فرامل" },
      "product_brand_id": { "_id": "64a0c1d2e3f4a5b6c7d8e9aa", "name": "Brembo" },
      "vendor_id": { "_id": "66d1f0a1b2c3d4e5f6a7b8c9", "store_name": "Auto Parts Cairo", "store_username": "autopartscairo", "status": "active", "subscription_status": "active" }
    }
  ],
  "cars": ["Hyundai Elantra 2019"]
}
```
`category_id` and `product_brand_id` are the whole populated category and brand documents. Only their `name` fields are shown here.

**Errors:**
- `500` — unexpected error.

---

## 4. Catalog

### Products

#### `GET /api/products/categories`
Full tree of active categories for the category menu and category pages. Each level is sorted by `sort_order`, then `name`. Only active categories are loaded, so an active child of an inactive parent does not appear anywhere.

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
Reference data the shop filters, home page and garage need: the category tree, car makes and product brands. It is cached in memory for 5 minutes per `parts`/`detail` combination (cleared whenever an admin edits this data) and sent with `Cache-Control: public, max-age=120`. By default car makes come **without** their models; fetch one make's models from `/car-brands/:id/models`.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `parts` | string | No | Comma-separated subset of `categories`, `carBrands`, `productBrands`, `productTypes` (case-sensitive). Omitted or empty = all four. Unknown names are ignored. If none of the names is valid, the response is `{}`. |
| `detail` | string | No | `full` embeds every make's `models[].years[]` (about 2 MB uncompressed). Any other value = slim: makes without `models`, plus `model_count`. Only the vendor product forms need `full`. |

**Response `200`:**
```json
{
  "categories": [
    { "_id": "6a05bf082edec79ade4e79b1", "name": "Car Accessories", "name_ar": "إكسسوارات السيارات", "parent_id": null, "image": "/uploads/categories/car-accessories-891f8b1e7b.webp", "sort_order": 0, "is_active": true, "subcategories": [] }
  ],
  "carBrands": [
    { "_id": "6a05bf09876db3938e6e5f4c", "name": "Acura", "image": "/uploads/car_brands/acura-08ef554248.png", "is_featured": false, "createdAt": "2026-05-14T12:24:41.301Z", "updatedAt": "2026-05-14T12:24:41.301Z", "__v": 0, "model_count": 12 }
  ],
  "productBrands": [
    { "_id": "6a05bf09876db3938e6e5f4c", "name": "Acura", "image": "/uploads/car_brands/acura-08ef554248.png", "categories": [], "source": "CarBrand", "is_car_brand": true },
    { "_id": "6a84f8ac572abc6c77dc9165", "name": "ago parts pro", "createdAt": "2026-08-19T00:28:28.218Z", "updatedAt": "2026-08-19T00:28:28.218Z", "__v": 0, "source": "Brand", "is_car_brand": false }
  ]
}
```
- `categories` is the same tree as `/categories`. Each category also carries `type_ids`: the product types it is offered under.
- `productTypes` are the broad, shopper-facing groupings the home page's search offers (Spare parts, Routine maintenance, Accessories, Car care, Tools, Tyres & wheels): `[{ _id, name, name_ar, image, sort_order, category_ids, product_count }]`, sorted by `sort_order`. `category_ids` are the categories assigned to the type (any level; a category can be in several types), shown as the type's cards. Only active types with live products are listed. Filter the shop by one with `GET /api/products?type_id=`.
- `productBrands` merges hand-entered brands (`source: "Brand"`) and every car make (`source: "CarBrand"`) into one list sorted by name. A make whose name also exists as a hand-entered brand appears once, as the hand-entered one.
- A brand's `categories` lists the category ids it is tagged for. An empty or missing list means "untagged, show everywhere".
- With `detail=full`, each car brand has `models: [{ _id, name, years: [{ year }] }]` and no `model_count`.

**Errors:**
- `500` — `{message}`.

#### `GET /api/products/car-brands/:id/models`
Models and years for one car make. The "pick your car" flow and the garage call it after the customer picks a make. Sent with `Cache-Control: public, max-age=300`.

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

#### `GET /api/products`
The shop / search results / category listing. It returns published products from active, subscribed vendors, in the shop's own order by default ("featured", below) — or by best match when `search` is given and `sort` is not. On page 1, when no `vendor_id` is given, live sponsored products are put at the top (on a search, only those that match it). The placement is `category_top` (limited to the category subtree) when `category_id` is set, otherwise `shop_top`. Each sponsored item displaces an organic one, and the list is cut back to `limit`. `pagination.total` counts only organic matches, and organic items pushed off page 1 are not moved to page 2.

**The featured order** (the default without a search): products that have sold first, most sold first (then newest); then all the others, taking turns between the top-level categories (accessories, mechanical parts, engine, …) and, inside each, between its own categories, newest first inside a category. So a page shows many kinds of product rather than one vendor's latest upload. The order of a list is worked out once and kept for a minute, so its pages never repeat or skip a product.

**What fits the car comes first.** When there is a car to fit, the list opens with the products that fit it, then everything else. The car is the one in `car_brand_id` / `car_model_id` / `car_year` if given; otherwise, for a signed-in customer, every car in their garage. The fitting products are two pools mixed 60/40, as in [`GET /api/users/recommendations`](#get-apiusersrecommendations): parts made for the car (six in every ten) and universal products (four). Each pool, and the rest after them, keeps the order of `sort` (the featured order by default). Products the customer ordered in the last 30 days are not put first; they stay in the rest. Sponsored products on such a list are only the ones that fit. Without a car to fit (a visitor with no car filter, a customer with an empty garage), the order is unchanged.

- **Auth:** Public. The customer's sign-in cookie is read when present (for the garage); without it, or with any other account's cookie, the list is the visitor's. A signed-in customer's answer is sent with `Cache-Control: private, no-store`.

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | integer | No | Default `1`. Must be ≥ 1 (`0` → 500). |
| `limit` | integer | No | Default `12`. No maximum. `0` returns all matches, with `pages: null`. |
| `search` | string | No | The same matching as `GET /api/products/suggest` (below): every word must match the title, subtitle, brand, category, SKU, part number or GTIN, in any order, with Arabic letter variants folded, a leading "ال" ignored and small typos forgiven. Part numbers also match without their dashes. Combines with every other filter, the car filters included. |
| `category_id` | ObjectId | No | Matches this category **and all its descendants**. |
| `type_id` | ObjectId | No | A product type from `filters.productTypes`: the products of its categories and everything under them. With `category_id` too, that category within the type (a card opened from the type's list). An unknown or hidden type gives an empty list. |
| `product_brand_id` | ObjectId | No | Exact brand. May be a hand-entered brand or a car make (see `filters.productBrands`). |
| `vendor_id` | ObjectId | No | Only this vendor's products. If the vendor is suspended or not subscribed, the result is empty (`total: 0, pages: 0`). Disables sponsored injection. |
| `car_brand_id` | ObjectId | No | Car compatibility (see below). Universal products (`is_universal: true`) always match a car filter. |
| `car_model_id` | ObjectId | No | Needs `car_brand_id`. Model `_id` from `/car-brands/:id/models`. |
| `car_year` | integer | No | Needs `car_brand_id` **and** `car_model_id`. |
| `min_price` | number | No | Inclusive. Compared with the effective price `discount_price ?? price` (EGP). Empty string = not set. |
| `max_price` | number | No | Inclusive, same price as `min_price`. |
| `sort` | string | No | Omitted: best match for a search, else `featured`. `featured` (below), `relevance` (best match; only with `search`), `newest` (`created_at` desc), `price_low` (`price` asc), `price_high` (`price` desc), `rating` (`rating` desc), `sold` (`sold_count` desc, then newest). Unknown values sort as `newest`. Price sorts use the **base** `price`, not the discounted one. |
| `for_girls` | `"true"` | No | Only the "Girls" collection (`for_girls: true`). Any other value is ignored. |
| `for_trunk` | `"true"` | No | Only "car trunk essentials" (`for_trunk: true`). Any other value is ignored. |

Car compatibility. A product matches when `is_universal` is true, or when one of its `compatible_cars` entries matches the filter:
- **brand only:** any entry for that brand.
- **brand + model:** the brand with `all_models: true`, or an entry for that model.
- **brand + model + year:** the brand with `all_models: true`, or that model with `all_years: true`, or that model with the year listed in `years`.
- **brand + year without a model:** as brand only.
- **Model or year without a brand:** only universal products match.

**Response `200`:** product documents (lean) with `category_id`, `product_brand_id` and `vendor_id` populated. The category is populated one level only (`parent_id` stays an id). When the list was ordered for a car (above), each product put first has `fit`: `"car"` or `"universal"`; and when the car came from the customer's garage, the answer also has `fit_for`: the garage cars, named (`["Toyota Corolla 2020"]`), so the shop can say whose car it is ordering for.
```json
{
  "products": [
    {
      "_id": "6ac60cc079bcca7bf9036f53",
      "vendor_id": {
        "_id": "6a4cc23b09b828853234f32a",
        "store_name": "El Bhrawy motors",
        "store_username": "el bhrawy",
        "store_slug": "el-bhrawy",
        "store_image": "/uploads/store-images/store-6a4cc23b09b828853234f32a-1791197453336.jpeg",
        "status": "active",
        "subscription_status": "active",
        "auto_publish_products": false,
        "completed_orders_count": 0,
        "rating": 0,
        "reviews_count": 0,
        "created_at": "2026-07-07T09:09:15.292Z"
      },
      "category_id": { "_id": "6a05bf082edec79ade4e7a1b", "name": "Transmission", "name_ar": "ناقل الحركة", "parent_id": "6a05bf082edec79ade4e7a18", "image": "/uploads/categories/transmission-318fc47e80.webp", "sort_order": 0, "is_active": true },
      "product_brand_id": { "_id": "6ac60ab279bcca7bf9036b83", "name": "kor-tec", "image": "https://readycar.store/uploads/products/product-1791363759704-588077197.jpg", "categories": ["6a05bf082edec79ade4e7a55"] },
      "product_brand_source": "Brand",
      "catalog_entry_id": null,
      "title_en": "KOR-TEC CV Skoda A5 (outer) made in Malaysia",
      "title_ar": "كوبلن خارجي سكودا A5 - باسات 2004-2009",
      "subtitle_en": "KOR-TEC CV joint Skoda A5 Malaysia",
      "subtitle_ar": "صناعه ماليزي كوبلن خارجي Skoda A5",
      "description_en": "KOR-TEC CV Joint - Item 1910. ...",
      "description_ar": "كوبلن خارجي سكودا A5 ...",
      "slug_en": "kor-tec-cv-skoda-a5-outer-made-in-malaysia-el-bhrawy-motors",
      "slug_ar": "كوبلن-خارجي-سكود-صناعه-ماليزي-ا-a5-باسات-2004-2009-فولكس-كادي-el-bhrawy-motors",
      "sku": "SUS-KORTEC-CV-1910",
      "part_number": "0602-0007",
      "gtin": "",
      "part_type": "oem",
      "price": 1160,
      "discount_type": "percentage",
      "discount_value": 5,
      "discount_price": 1102,
      "status": "published",
      "is_published": false,
      "is_active": true,
      "is_universal": false,
      "for_girls": false,
      "for_trunk": false,
      "sold_count": 0,
      "rating": 0,
      "reviews_count": 0,
      "stock_management": false,
      "stock_status": "instock",
      "quantity": 0,
      "images": [
        { "_id": "6ac60e5a79bcca7bf9037072", "url": "https://readycar.store/uploads/products/product-1791364697313-727922615.jpg", "is_primary": true }
      ],
      "compatible_cars": [
        {
          "brand_id": "6a05bf0c876db3938e6f8f9e",
          "brand_name": "Skoda",
          "all_models": false,
          "models": [{ "model_id": "6a05bf0c876db3938e6fa1f8", "model_name": "Octavia", "years": [2004, 2005, 2006], "all_years": false }]
        }
      ],
      "variation_types": [
        { "_id": "6ac6...a1", "name": "Side", "options": [{ "_id": "6ac6...a2", "value": "Left" }] }
      ],
      "variants": [
        {
          "_id": "6ac6...a3",
          "price": null,
          "discount_type": null,
          "discount_value": null,
          "discount_price": null,
          "stock": 4,
          "selected_options": [{ "type_id": "6ac6...a1", "type_name": "Side", "option_id": "6ac6...a2", "option_value": "Left" }]
        }
      ],
      "weight": null,
      "dimensions": { "length": 20, "width": 10, "height": 10 },
      "shipping_class_id": null,
      "subscription_hidden_at": null,
      "modified_after_subscription_restore": false,
      "catalog_dismissed_at": null,
      "created_at": "2026-10-07T09:11:28.291Z",
      "__v": 0
    }
  ],
  "pagination": { "total": 1442, "page": 1, "pages": 121, "limit": 12 }
}
```
- Field meanings:
  - `part_type` is `original` | `oem` | `aftermarket` | `null`.
  - `stock_status` is `instock` | `outofstock` | `onbackorder`.
  - `weight` is in kg; `dimensions` is in cm and may be missing.
  - The primary image is always `images[0]`.
  - In a variant, `price: null` means "use the product price".
  - `variation_types` and `variants` are usually `[]`. The variant values in the example are illustrative.
- Sponsored items have the same shape plus `"sponsored": true, "ad_id": "…", "ad_number": "AD-1A2B3C4D", "ad_placement": "shop_top" | "category_top"`.

**Errors:**
- `500` — `{message}` carrying the raw database error. Causes: a malformed ObjectId in `category_id`, `product_brand_id`, `vendor_id` or a car id; `page` < 1.

#### `GET /api/products/suggest`
Search-as-you-type for the search box: called on every pause in typing, it answers from an in-memory index of the live catalogue (rebuilt in the background once a minute), typically in a few milliseconds. It returns the best-matching products, plus categories, brands and car makes/models that match, and how many products the full search (`GET /api/products?search=`) would return.

How words match: every query word must match a word of the entry — the same word, its start (the last word is the one still being typed), a word containing it, or a word one or two typos away (a swap of two letters counts as one). Text is folded first: lower case, أ/إ/آ → ا, ة → ه, ى/ئ → ي, ؤ → و, diacritics and tatweel removed, Arabic digits as digits, and a leading "ال" ignored. A SKU, part number or GTIN also matches with its dashes and spaces left out (`esdrh 0202` finds `ESDRH0202`). Products rank by match quality, a title that starts with the query, and sales. Car makes also match their Arabic names (تويوتا, هيونداي, مرسيدس, …).

- **Auth:** Public
- Sent with `Cache-Control: public, max-age=30`.

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `q` | string | Yes | What has been typed so far. Cut to 100 characters. Empty, or only punctuation, gives empty lists. |
| `limit` | integer | No | Products to return. Default `6`, clamped to 1–12. |

**Response `200`:**
```json
{
  "query": "braek pads",
  "products": [
    {
      "_id": "6ac60cc079bcca7bf9036f60",
      "title_en": "D-NAO Brake Pads for MG ZS",
      "title_ar": "تيل خلفي ZS - D-NAO",
      "slug_en": "d-nao-brake-pads-for-mg-zs-x-turbo-auto-parts",
      "slug_ar": "تيل-خلفي-zs-d-nao-x-turbo-auto-parts",
      "image": "https://readycar.store/uploads/products/product-1791364697313-727922615.jpg",
      "price": 950,
      "discount_price": null,
      "store_name": "X-Turbo Auto Parts",
      "sold_count": 3,
      "rating": 0,
      "created_at": "2026-10-07T09:11:28.291Z"
    }
  ],
  "categories": [
    { "_id": "6a05bf082edec79ade4e7a40", "name": "Brakes", "name_ar": "الفرامل", "parent_name": "Mechanical Parts", "parent_name_ar": "القطع الميكانيكية", "image": "/uploads/categories/brakes.webp", "count": 51 }
  ],
  "brands": [
    { "_id": "6ac60ab279bcca7bf9036b83", "name": "kor-tec", "image": null, "count": 24 }
  ],
  "cars": [
    { "car_brand_id": "6a05bf0c876db3938e6f8f9e", "car_model_id": "6a05bf0c876db3938e6fa1f8", "brand_name": "Toyota", "model_name": "Corolla", "image": "/uploads/car_brands/toyota.png" }
  ],
  "total": 50,
  "corrected": "brake pads"
}
```
- `products` are ordered best first. Link them to `/product/<slug_ar or slug_en>`, in the visitor's language.
- `categories` (at most 3) and `brands` (at most 2) only include ones that hold live products; `count` is how many (a category counts its subcategories too). Link to `/products?category_id=` / `/products?product_brand_id=`.
- `cars` (at most 3): a make (`car_model_id: null`), or a model when the words name it. Link to `/products?car_brand_id=…&car_model_id=…`.
- `total` is the number of products `GET /api/products?search=<q>` would return.
- `corrected` is set when a word matched only as a typo: the query as the index understood it, for a "did you mean" row. Otherwise `null`.
- A brand-new product shows up within about a minute (the index refresh).

**Errors:**
- `500` — `{message}` (the index could not be built).

#### `GET /api/products/landing/:section`
Home page product rows. Live sponsored products for that row's ad placement are put first and the row is cut to `limit`.

- **Auth:** Public

**Path params / Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `section` (path) | string | Yes | `most-sold` (by `sold_count` desc, then newest), `new-arrivals` (newest), `special-offers` (biggest discount % first, then newest; only products with a discount on the product or on any variant). Any other value returns `{products: []}`. |
| `limit` (query) | integer | No | Default `8`, clamped to 1–24. |

**Response `200`:** product objects shaped as in `GET /api/products`. `special-offers` items also carry the computed `discount_percentage`, `base_discount_percentage`, `variant_discount_percentage` and `variant_discount_percentages[]` (floats, 0–100).
```json
{
  "products": [
    {
      "_id": "6ac60cc079bcca7bf9036f53",
      "title_en": "KOR-TEC CV Skoda A5 (outer) made in Malaysia",
      "price": 1160,
      "discount_price": 1102,
      "images": [{ "url": "https://readycar.store/uploads/products/product-1791364697313-727922615.jpg", "is_primary": true }],
      "vendor_id": { "_id": "6a4cc23b09b828853234f32a", "store_name": "El Bhrawy motors", "store_slug": "el-bhrawy" },
      "discount_percentage": 29.166666666666668,
      "base_discount_percentage": 29.166666666666668,
      "variant_discount_percentage": 0,
      "variant_discount_percentages": []
    }
  ]
}
```
(The example is trimmed: every product field from the list endpoint is present.)

**Errors:**
- `500` — `{message}`.

#### `GET /api/products/slug/:slug`
Product detail page opened by its URL slug (English or Arabic). Only returns a product that is published and whose vendor is active and subscribed.

- **Auth:** Public

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | Yes | Matches `slug_en` or `slug_ar`. Percent-encode Arabic. |

**Response `200`:** the full product document (all fields as in the list), with richer population:
- `category_id` is populated **with its parent chain**: `category_id.parent_id` and `category_id.parent_id.parent_id`, which is enough for a 3-level breadcrumb.
- `product_brand_id` is populated.
- `vendor_id` is populated with the public vendor projection.
```json
{
  "_id": "6ac60cc079bcca7bf9036f53",
  "title_en": "KOR-TEC CV Skoda A5 (outer) made in Malaysia",
  "slug_en": "kor-tec-cv-skoda-a5-outer-made-in-malaysia-el-bhrawy-motors",
  "price": 1160,
  "discount_price": 1102,
  "category_id": {
    "_id": "6a05bf082edec79ade4e7a1b",
    "name": "Transmission",
    "name_ar": "ناقل الحركة",
    "parent_id": {
      "_id": "6a05bf082edec79ade4e7a18",
      "name": "Transmission System",
      "name_ar": "نظام نقل الحركة",
      "parent_id": { "_id": "6a05bf082edec79ade4e7a09", "name": "Mechanical Parts", "name_ar": "القطع الميكانيكية", "parent_id": null, "image": "/uploads/categories/mechanical-parts-c63f774f53.webp", "sort_order": 1100, "is_active": true }
    }
  },
  "product_brand_id": { "_id": "6ac60ab279bcca7bf9036b83", "name": "kor-tec" },
  "vendor_id": { "_id": "6a4cc23b09b828853234f32a", "store_name": "El Bhrawy motors", "store_slug": "el-bhrawy", "status": "active", "subscription_status": "active", "rating": 0, "reviews_count": 0, "completed_orders_count": 0 },
  "images": [{ "_id": "6ac60e5a79bcca7bf9037072", "url": "https://readycar.store/uploads/products/product-1791364697313-727922615.jpg", "is_primary": true }],
  "compatible_cars": [],
  "variants": [],
  "__v": 0
}
```
(Trimmed. Reviews are not included; fetch them from `/api/reviews/product/:productId`.)

**Errors:**
- `404` — `{message: "Product not found"}`: no match, not published, or vendor inactive.
- `500` — `{message}`.

#### `GET /api/products/:id`
The same product detail, looked up by id. The same visibility rules apply.

- **Auth:** Public

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | The route only matches 24 hex characters. Anything else falls through to the generic `404 {message: "Not Found"}`. |

**Response `200`:** identical to `GET /api/products/slug/:slug`.

**Errors:**
- `404` — `{message: "Product not found"}`.
- `500` — `{message}`.

### Bundles

A bundle is a vendor's kit of two or more of its own products, sold together at a bundle price. The price is never stored: it is recomputed on every read from the members' current effective prices (`pricing_mode`: `fixed` = `pricing_value` is the total; `percent` = % off the combined price; `amount` = flat EGP off the combined price).

#### `GET /api/bundles/landing`
Home page bundle row: published bundles from active vendors, newest first. Bundles that are not currently purchasable are filtered out after the limit is applied, so the row can come back shorter than `limit`.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | No | Default `8`, clamped to 1–24 (`0` or non-numeric → 8). |

**Response `200`:**
```json
{
  "bundles": [
    {
      "_id": "6ac7a0c179bcca7bf9031111",
      "vendor_id": { "_id": "6a4cc23b09b828853234f32a", "store_name": "El Bhrawy motors", "store_username": "el bhrawy", "store_image": "/uploads/store-images/store-6a4cc23b09b828853234f32a-1791197453336.jpeg", "status": "active", "subscription_status": "active" },
      "title_en": "Front brake kit",
      "title_ar": "طقم فرامل أمامي",
      "subtitle_en": "Pads + discs",
      "subtitle_ar": "تيل + طنابير",
      "description_en": "...",
      "description_ar": "...",
      "slug_en": "front-brake-kit-el-bhrawy-motors",
      "slug_ar": "طقم-فرامل-أمامي-el-bhrawy-motors",
      "images": [{ "_id": "6ac7a0c179bcca7bf9031112", "url": "https://readycar.store/uploads/products/product-1791400000000-1.jpg", "is_primary": true }],
      "members": [
        {
          "_id": "6ac7a0c179bcca7bf9031113",
          "product_id": { "_id": "6ac60cc079bcca7bf9036f53", "title_en": "Brake pads", "title_ar": "تيل فرامل", "subtitle_en": "...", "subtitle_ar": "...", "slug_en": "brake-pads-el-bhrawy-motors", "slug_ar": "...", "images": [], "price": 600, "discount_price": null, "status": "published", "variants": [], "is_active": true, "vendor_id": "6a4cc23b09b828853234f32a" },
          "variant_id": null,
          "quantity": 1
        }
      ],
      "pricing_mode": "percent",
      "pricing_value": 10,
      "status": "published",
      "is_published": true,
      "is_active": true,
      "sold_count": 0,
      "created_at": "2026-10-08T10:00:00.000Z",
      "__v": 0,
      "pricing": {
        "combined": 1500,
        "effective": 1350,
        "savings": 150,
        "memberBreakdown": [
          { "product_id": "6ac60cc079bcca7bf9036f53", "variant_id": null, "quantity": 1, "effective_unit": 600, "line_total": 600, "product": { "_id": "6ac60cc079bcca7bf9036f53", "title_en": "Brake pads", "price": 600, "discount_price": null } }
        ]
      },
      "is_purchasable": true,
      "member_count": 2
    }
  ]
}
```
- `pricing.memberBreakdown[].product` repeats the populated member product.
- Members whose product no longer exists are skipped in `memberBreakdown`.
- The example is built from the model and service code: no bundle was live on the server to copy.

**Errors:**
- `500` — `{message}`.

#### `GET /api/bundles/slug/:slug`
Bundle detail page by slug.

- **Auth:** Public

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | Yes | Matches `slug_en` or `slug_ar`. |

**Response `200`:** `{ "bundle": { ...same object as one landing item... } }`. Unlike the landing row, an unpurchasable bundle **is** returned, with `is_purchasable: false`. That happens when a member product is no longer published or active, belongs to another vendor, or its pinned variant is gone. Disable "add to cart" in that case.

**Errors:**
- `404` — `{message: "Bundle not found"}`: not published, or vendor inactive.
- `500` — `{message}`.

#### `GET /api/bundles/:id`
Bundle detail by id.

- **Auth:** Public

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | Yes | Only 24-hex values match this route. |

**Response `200`:** `{ "bundle": { ... } }`, as for `/slug/:slug`.

**Errors:**
- `404` — `{message: "Bundle not found"}`.
- `500` — `{message}`.

### Services

Services are listings for workshops and car-care providers: contact details and locations, not purchasable items. Only `status: 'active'` services are ever returned.

#### `GET /api/services`
The services directory, with search.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | integer | No | Default `1`. |
| `limit` | integer | No | Default `12`. No maximum. |
| `search` | string | No | Case-insensitive regex (not escaped) over `title_*`, `description_*`, `vendor_name_*`, `vendor_location_*`, `locations.name_*` and `locations.link`. |
| `featured` | `"true"` \| `"false"` | No | Filter on `featured`. |
| `sort` | string | No | `newest` (default), `oldest`, `featured` (featured first, then newest). |
| `status` | — | — | Ignored: the route always forces `active`. |

**Response `200`:** whole Service documents (lean).
```json
{
  "services": [
    {
      "_id": "6a6faa54a84a353e9c6a9219",
      "title_en": "FixZone W&A Car Service | Complete Automotive Maintenance",
      "title_ar": "FixZone W&A Car Service | صيانة سيارات متكاملة باحترافية",
      "description_en": "At FixZone W&A Car Service, we provide complete automotive maintenance ...",
      "description_ar": "في FixZone W&A Car Service بنوفر لك كل خدمات صيانة وإصلاح السيارات ...",
      "vendor_name_en": "FixZone W&A Car Service",
      "vendor_name_ar": "FixZone W&A Car Service",
      "vendor_location_en": "107 El-Daght El-Aaly St., Hadayek Al Ahram, Giza",
      "vendor_location_ar": "107 شارع الضغط العالي، حدائق الأهرام",
      "locations": [
        { "_id": "6a6faaf7a84a353e9c6a9233", "name_en": "107 El-Daght El-Aaly St., Hadayek Al Ahram, Giza", "name_ar": "107 شارع الضغط العالي، حدائق الأهرام", "link": "https://maps.google.com/?q=29.963877,31.101185" }
      ],
      "phones": ["+201127800070"],
      "whatsapp_numbers": ["201127800070"],
      "social_links": [{ "_id": "6a6faaf7a84a353e9c6a9235", "platform": "facebook", "url": "https://www.facebook.com/share/1L7atgXpqv/" }],
      "images": [{ "_id": "6a6faa54a84a353e9c6a921b", "url": "https://readycar.store/uploads/products/product-1785702951931-61544086.png", "is_primary": true }],
      "slug_en": "fixzone-w-a-car-service-complete-automotive-maintenance",
      "slug_ar": "fixzone-w-a-car-service-صيانة-سيارات-متكاملة-باحترافية",
      "status": "active",
      "featured": true,
      "show_in_banner_ad_slider": true,
      "price": null,
      "created_at": "2026-08-02T20:36:36.551Z",
      "__v": 0
    }
  ],
  "pagination": { "total": 9, "page": 1, "pages": 1, "limit": 12 }
}
```
- `social_links[].platform` is one of `facebook`, `instagram`, `tiktok`, `x`, `youtube`, `linkedin`, `website`, `other`.
- `whatsapp_numbers` are digits only (for `wa.me` links); `phones` may keep a leading `+`.
- `price` is EGP or `null`.

**Errors:**
- `500` — `{message}` (e.g. an invalid regex in `search`).

#### `GET /api/services/featured`
Services marked `featured`, newest first, for the home page.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | No | Default `6`. No maximum. `0` = no limit. |

**Response `200`:**
```json
{ "services": [ { "_id": "6a6faa54a84a353e9c6a9219", "title_en": "FixZone W&A Car Service | Complete Automotive Maintenance", "featured": true, "images": [{ "url": "https://readycar.store/uploads/products/product-1785702951931-61544086.png", "is_primary": true }] } ] }
```
(Whole Service documents, as in `GET /api/services`.)

**Errors:**
- `500` — `{message}`.

#### `GET /api/services/banner-ads`
Services flagged `show_in_banner_ad_slider`, newest first. These are the same services that `/api/ads/homepage-banners` mixes into the home slider.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | No | Default `6`. No maximum. |

**Response `200`:** `{ "services": [ ...whole Service documents... ] }`, same shape as `/featured`.

**Errors:**
- `500` — `{message}`.

#### `GET /api/services/slug/:slug`
Service detail page.

- **Auth:** Public

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | Yes | Matches `slug_en` or `slug_ar`. |

**Response `200`:** a single Service document (no wrapper), same fields as in the list.

**Errors:**
- `404` — `{message: "Service not found"}`: no match, or the service is inactive.
- `500` — `{message}`.

### Stores

#### `GET /api/vendors/public`
The stores directory, or the home page store slider. It lists active, subscribed vendors that are visible in that placement. Vendors with a live `featured_vendor` ad for the placement are merged in and flagged `sponsored`, even if their visibility toggle hides them from that placement. **Sorting is not changed by the ad.** The order is:
- `placement=home`: by `public_home_order`, then store name.
- Directory: home-visible stores first, then `public_home_order`, then name.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `placement` | string | No | `home` = home slider (vendors with `public_show_on_home: true`). Anything else = directory (vendors without `public_show_on_vendors_page: false`). |
| `limit` | integer | No | Default `12` for home and `100` for the directory, clamped to 1–100. |

**Response `200`:**
```json
{
  "success": true,
  "vendors": [
    {
      "_id": "6a4cc23b09b828853234f32a",
      "store_name": "El Bhrawy motors",
      "store_username": "el bhrawy",
      "store_slug": "el-bhrawy",
      "store_image": "/uploads/store-images/store-6a4cc23b09b828853234f32a-1791197453336.jpeg",
      "locations": [
        { "_id": "6a4cc23b09b828853234f32b", "address": "<pickup address>", "shipping_country": "Egypt", "shipping_city": "Qena", "is_default": true, "bosta_location_id": "<bosta location id>" }
      ],
      "created_at": "2026-07-07T09:09:15.292Z",
      "completed_orders_count": 0,
      "rating": 0,
      "reviews_count": 0,
      "public_show_on_vendors_page": true,
      "public_vendors_page_order": 0,
      "public_show_on_home": true,
      "public_home_order": 0,
      "product_count": 56
    }
  ]
}
```
- `product_count` counts the store's `published` products.
- `rating` and `reviews_count` cover **store** reviews, not product reviews.
- `completed_orders_count` counts delivered parcels that the customer kept.
- Sponsored entries also carry `"sponsored": true, "ad_id": "…", "ad_placement": "home" | "vendors_page"`.

**Errors:**
- `500` — `{success: false, message}`.

#### `GET /api/vendors/public/:username`
A store page: the store's profile, its first 10 approved store reviews, and a page of its products. Every product-list query parameter from `GET /api/products` works here (`page`, `limit`, `search`, `category_id`, car filters, price range, `sort`, …). `vendor_id` is forced to this store, so there is no sponsored injection.

- **Auth:** Public

**Path params / Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `username` (path) | string | Yes | `store_slug` (tried first) or `store_username`. Trimmed and lowercased. Percent-encode spaces in legacy usernames. |
| *(query)* | — | No | Same as `GET /api/products`, except `vendor_id`, which is ignored. |

**Response `200`:**
```json
{
  "vendor": {
    "_id": "6a4cc23b09b828853234f32a",
    "store_name": "El Bhrawy motors",
    "store_username": "el bhrawy",
    "store_slug": "el-bhrawy",
    "store_image": "/uploads/store-images/store-6a4cc23b09b828853234f32a-1791197453336.jpeg",
    "email": "store@example.com",
    "phone": "+2010XXXXXXXX",
    "locations": [
      { "_id": "6a4cc23b09b828853234f32b", "address": "<pickup address>", "shipping_country": "Egypt", "shipping_city": "Qena", "is_default": true, "bosta_location_id": "<bosta location id>" }
    ],
    "status": "active",
    "subscription_status": "active",
    "created_at": "2026-07-07T09:09:15.292Z",
    "completed_orders_count": 0,
    "rating": 0,
    "reviews_count": 0
  },
  "reviews": {
    "reviews": [],
    "summary": { "rating": 0, "count": 0, "breakdown": { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } },
    "pagination": { "page": 1, "limit": 10, "total": 0, "pages": 0 }
  },
  "products": [ { "_id": "6ac60cc079bcca7bf9036f53", "title_en": "KOR-TEC CV Skoda A5 (outer) made in Malaysia", "price": 1160, "discount_price": 1102 } ],
  "pagination": { "total": 56, "page": 1, "pages": 5, "limit": 12 }
}
```
- `reviews` has the same shape as `GET /api/reviews/vendor/:vendorId`. It is `null` if that lookup failed. Fetch more pages from that endpoint.
- `products` items have the full product-list shape.
- The store's real email and phone are redacted in this example.
- A store whose `status` is `suspended` but whose subscription is still active returns `200` with its profile and an empty product list. Only the subscription status is checked for the 404.

**Errors:**
- `404` — `{message: "Store not found"}`: no store matches, or `subscription_status` is not `active`/`trial_active`.
- `500` — `{message}` (e.g. an invalid id or regex in the product filters).

### Ads

An ad is live when it is `approved` and now is between its `start_date` and `end_date`. There are three ad types: `banner`, `product_visibility` (sponsored products) and `featured_vendor` (sponsored stores in `/api/vendors/public`).

#### `GET /api/ads/banners`
Live vendor banner ads, newest `start_date` first. The home page uses `/homepage-banners` instead; this is the raw list.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | No | Default `20`. No maximum. |

**Response `200`:**
```json
{
  "banners": [
    { "_id": "6ac5f1d279bcca7bf9030a01", "ad_number": "AD-1A2B3C4D", "banner_image": "https://readycar.store/uploads/ads/banner-1791300000000.jpg", "link_url": "https://readycar.store/store/el-bhrawy", "start_date": "2026-10-01T00:00:00.000Z", "subject_type": "store" }
  ]
}
```
`subject_type` is `product` | `store` | `custom` | `service`.

**Errors:**
- `500` — `{message}`.

#### `GET /api/ads/homepage-banners`
The home page slider. Live banner ads that have an image, plus active services flagged for the slider that have an image, are pooled and sorted newest first. The pool is dealt round-robin into "shifts" of at most `limit` slides. The shift shown is chosen from the clock (shift length `BANNER_SHIFT_MINUTES`, default 60), so every server instance shows the same shift and every advertiser gets time on screen. The `Cache-Control` header expires at the next shift change: `public, max-age=min(60, secondsLeft), s-maxage=min(300, secondsLeft), must-revalidate`.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | No | Slides per shift. Default and maximum `25`. |

**Response `200`:** each slide is either `kind: "ad"` (`id`, `image`, `link`) or `kind: "service"` (`id`, `service`). The `service` is a trimmed Service object: descriptions cut to 320 characters, only the first `locations` entry, and only the primary image in `images`.
```json
{
  "slides": [
    { "kind": "ad", "id": "6ac5f1d279bcca7bf9030a01", "image": "https://readycar.store/uploads/ads/banner-1791300000000.jpg", "link": "https://readycar.store/store/el-bhrawy" },
    {
      "kind": "service",
      "id": "6a6a3bb294b89711030d11c4",
      "service": {
        "_id": "6a6a3bb294b89711030d11c4",
        "title_en": "GO Protection Egypt | Premium Car Protection Films",
        "title_ar": "...",
        "description_en": "professional exterior and interior protection ...",
        "description_ar": "...",
        "vendor_name_en": "GO Protection Egypt",
        "vendor_name_ar": "...",
        "vendor_location_en": "...",
        "vendor_location_ar": "...",
        "locations": [{ "_id": "6a6a6646a760b920c19a51c2", "name_en": "Al Nozha Road, Beside Talat Mostafa Hospital, Alexandria, Egypt", "name_ar": "طريق النزهة بجوار مستشفى طلعت مصطفى، الإسكندرية، مصر", "link": "https://maps.app.goo.gl/S1jASVnttaP6WV2K9" }],
        "slug_en": "go-protection-egypt-premium-car-protection-films",
        "slug_ar": "...",
        "price": null,
        "created_at": "2026-07-29T17:36:50.000Z",
        "images": [{ "url": "https://readycar.store/uploads/products/product-1785346607394-146994903.png", "is_primary": true }]
      }
    }
  ],
  "total_candidates": 9,
  "shift_count": 1,
  "active_shift": 1,
  "shift_duration_minutes": 60,
  "next_shift_at": "2026-10-11T17:00:00.000Z"
}
```
- `active_shift` is 1-based.
- An ad slide's `id` is the ad's `_id`: report it as `ad_id` to `/api/ads/events`.

**Errors:**
- `500` — `{message}`.

#### `GET /api/ads/promoted-products`
The home page "Promoted Products" row: products with a live `product_visibility` ad on the `promoted_section` placement, newest ad first. Only published products from active vendors appear.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | No | Default `8`, clamped to 1–24. |

**Response `200`:** product objects shaped as in `GET /api/products`, each with `sponsored: true`, `ad_id`, `ad_number`, `ad_placement: "promoted_section"`.
```json
{
  "products": [
    { "_id": "6ac60cc079bcca7bf9036f53", "title_en": "KOR-TEC CV Skoda A5 (outer) made in Malaysia", "price": 1160, "discount_price": 1102, "sponsored": true, "ad_id": "6ac5f1d279bcca7bf9030a02", "ad_number": "AD-9F8E7D6C", "ad_placement": "promoted_section" }
  ]
}
```

**Errors:**
- `500` — `{message}`.

#### `POST /api/ads/events`
Ad telemetry: the app reports, in batches, impressions, clicks and later actions for anything that carries an `ad_id`. It **always answers `204`**, even when every row is rejected or the database write fails. Invalid rows are dropped silently. Within one batch an impression counts once per `ad_id` + `placement`. The same `viewer_id` seeing the same ad in the same placement again within 60 s is not counted.

- **Auth:** Optional user. A valid customer cookie attaches `user_id` to the rows.
- **Rate limit:** 60 requests per minute, keyed by `viewer_id` (first 64 characters), or by IP when there is no `viewer_id`.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `viewer_id` | string | No | Stable anonymous id for the device or browser (max 64 characters). The `x-viewer-id` header is used if the field is absent. Needed for impression de-duplication and unique-viewer counts. |
| `referrer` | string | No | Falls back to the `Referer` header. Clipped to 300 characters. |
| `events` | array | Yes | At most 50 rows are read; extra rows are ignored. |
| `events[].ad_id` | ObjectId | Yes | Must be an existing ad. |
| `events[].event` | string | Yes | `impression` \| `click` \| `action`. |
| `events[].action` | string | For `action` | `open`, `view_product`, `add_to_cart`, `buy_now`, `checkout`, `order_placed`, `visit_store`, `whatsapp`, `call`, `view_service`. A `click` without an action is stored as `open`. An `action` row without a valid action is dropped. |
| `events[].placement` | string | No | Where it was shown, e.g. `shop_top`, `home`. Max 60 characters. |
| `events[].page` | string | No | Page path. Max 300 characters. |
| `events[].target` | string | No | What the click pointed at. Max 300 characters. |

```json
{
  "viewer_id": "v_8f3c2a91d0",
  "events": [
    { "ad_id": "6ac5f1d279bcca7bf9030a02", "event": "impression", "placement": "promoted_section", "page": "/" },
    { "ad_id": "6ac5f1d279bcca7bf9030a02", "event": "click", "placement": "promoted_section", "page": "/", "target": "/product/kor-tec-cv-skoda-a5-outer-made-in-malaysia-el-bhrawy-motors" }
  ]
}
```

**Response `204`:** no body.

**Errors:**
- `429` — rate limit exceeded (`{code: "RATE_LIMITED", message}` + `Retry-After`).

---

## 5. Site content

#### `GET /api/settings`
Global storefront settings: currency, contact details, header and footer text, logos, social links, and the loyalty and wallet switches. Read once at app start. If no settings document exists yet, one is created with defaults.

- **Auth:** Public

No parameters.

**Response `200`:** `{success, settings}`, where `settings` is the **whole** SiteSettings document.
```json
{
  "success": true,
  "settings": {
    "_id": "6a05b02253be6b31da7fed30",
    "currency": "EGP",
    "header_phone": "+20 10 35983229",
    "footer_phones": ["+20 10 35983229"],
    "footer_emails": ["info@tech-oriented.digital"],
    "contact_email": "info@tech-oriented.digital",
    "contact_telephone": "+20 10 35983229",
    "contact_address": "696 El Houria St. Louran-Alexandria,Egypt",
    "header_text_en": "Welcome to Ready Car",
    "header_text_ar": "مرحباً بكم في ريدي كار",
    "footer_text_en": "Everything your car needs, ready in one place",
    "footer_text_ar": "...",
    "locations_en": ["Egypt"],
    "locations_ar": ["مصر"],
    "logo_url": "https://readycar.store/uploads/branding/logo-1779145510639.png",
    "logo_light_url": "https://readycar.store/uploads/branding/logo_light-1779145533581.png",
    "favicon_url": "https://readycar.store/uploads/branding/favicon-1779144830420.png",
    "social_links": { "facebook": "https://www.facebook.com/tech.oriented.ready.car/", "instagram": "https://www.instagram.com/tech.oriented.ready.car/", "twitter": "", "youtube": "https://www.youtube.com/@tech-oriented-ready-car", "linkedin": "", "tiktok": "https://www.tiktok.com/@ready_car", "whatsapp": "+201055661614" },
    "loyalty": { "enabled": true, "earning_enabled": true, "redemption_enabled": true, "activated_at": "2026-08-12T18:31:26.352Z", "spend_per_point": 100, "point_value": 0.25, "min_redeem_points": 1, "max_redemption_percent": 50, "allow_with_coupons": true, "points_expiry_days": 180 },
    "wallet": { "enabled": true, "topup_enabled": true, "cod_enabled": true, "online_payment_enabled": true, "topup_suggestions": [100, 250, 500, 1000], "activated_at": "2026-08-12T18:26:12.965Z" },
    "bundle_approval_required": true,
    "commission_settings": { "type": "fixed", "fixed_rate": 0, "category_rates": [] },
    "payout_schedule": { "enabled": true, "frequency": "daily", "weekday": 1, "interval_weeks": 1, "anchor_date": null, "hold_days": 14 },
    "cod_policy": { "enabled": true, "min_finished_orders": 3, "max_undelivered_percent": 50, "use_bosta_ranking": true, "min_bosta_ranking": 30, "ranking_cache_hours": 12 },
    "payments": { "provider": "fawaterak", "paymob_pilot_user_ids": [] },
    "createdAt": "2026-05-14T11:21:06.600Z",
    "updatedAt": "2026-10-01T09:00:00.000Z",
    "__v": 0
  }
}
```
- Loyalty: `spend_per_point` is EGP of spend per 1 point; `point_value` is the EGP discount per point.
- The last block of fields (`bundle_approval_required` through `payments`) is internal configuration that a customer app does not need.

**Errors:**
- `500` — `{success: false, message}`.

#### `GET /api/pages/:slug`
A static content page: privacy policy, terms, shipping policy and similar.

- **Auth:** Public

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | Yes | Exact match. Slugs on this install: `privacy-policy`, `shipping-policy`, `delivery-and-return`, `terms-and-conditions`. |

**Response `200`:**
```json
{
  "success": true,
  "page": {
    "_id": "6a05b02253be6b31da7fed33",
    "slug": "privacy-policy",
    "title_en": "Privacy Policy",
    "title_ar": "سياسة الخصوصية",
    "content_en": "Last updated: July 28, 2026\nWelcome to Ready Car.\n...",
    "content_ar": "آخر تحديث: 28 يوليو 2026\n...",
    "createdAt": "2026-05-14T11:21:06.637Z",
    "updatedAt": "2026-08-02T18:23:42.626Z",
    "__v": 0
  }
}
```
On this install the content is plain text with `\n` line breaks. Whether HTML is ever stored is unverified.

**Errors:**
- `404` — `{success: false, message: "Page not found"}`.
- `500` — `{success: false, message: "Server error"}`.

#### `GET /api/articles`
Blog / articles list. Only published articles, sorted by `published_at` desc, then `created_at` desc.

- **Auth:** Public

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | integer | No | Default `1`. |
| `limit` | integer | No | Default `12`. No maximum. |
| `search` | string | No | Case-insensitive regex (not escaped) over `title_en`, `title_ar`, `excerpt_en`, `excerpt_ar`. |
| `tag` | string | No | Exact match against one entry of `tags`. |
| `category` | string | No | Exact match on `category`. |

**Response `200`:** whole Article documents, **including the full HTML `content_en`/`content_ar`**. There is no `success` key on this route.
```json
{
  "articles": [
    {
      "_id": "6acb94c44cd4947ddcc7439a",
      "title_en": "What preventive maintenance checks can help you catch minor car issues before they become major repairs?",
      "title_ar": "إيه فحوصات الصيانة الوقائية اللي تساعدك تكتشف مشاكل العربية قبل ما تكبر؟",
      "content_en": "<h1><strong>...</strong></h1>...",
      "content_ar": "<h1 class=\"ql-direction-rtl ql-align-right\">...</h1>...",
      "excerpt_en": "",
      "excerpt_ar": "",
      "slug_en": "what-preventive-maintenance-checks-can-help-you-catch-minor-car-issues-before-they-become-major-repairs",
      "slug_ar": "إيه-فحوصات-الصيانة-الوقائية-اللي-تساعدك-تكتشف-مشاكل-العربية-قبل-ما-تكبر",
      "featured_image": "https://readycar.store/uploads/products/product-1791726782415-222066510.png",
      "author_name": "",
      "status": "published",
      "tags": [],
      "category": "",
      "meta_title_en": "What preventive maintenance checks can help you ...",
      "meta_title_ar": "إيه فحوصات الصيانة الوقائية ...",
      "meta_description_en": "Learn the key preventive car maintenance checks ...",
      "meta_description_ar": "اعرف أهم فحوصات الصيانة الوقائية ...",
      "keywords": [],
      "canonical_url": "",
      "published_at": "2026-10-11T13:53:08.394Z",
      "view_count": 0,
      "created_at": "2026-10-11T13:53:08.396Z",
      "__v": 0
    }
  ],
  "pagination": { "total": 28, "page": 1, "pages": 3, "limit": 12 }
}
```
Content is HTML from a Quill editor: `ql-*` classes, inline styles.

**Errors:**
- `500` — `{success: false, message: "Server error"}` (e.g. an invalid regex in `search`).

#### `GET /api/articles/slug/:slug`
A single article. Every successful call **increments `view_count`**, and the returned document already includes the increment.

- **Auth:** Public

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | Yes | Matches `slug_en` or `slug_ar`. Published articles only. |

**Response `200`:** `{ "success": true, "article": { ...same fields as a list item... } }`

**Errors:**
- `404` — `{success: false, message: "Article not found"}`.
- `500` — `{success: false, message: "Server error"}`.

#### `GET /api/corporate-clients`
Logos for the home page "corporate clients" strip: active companies that have a logo and have not turned off `show_logo_on_homepage`, oldest first. Sent with `Cache-Control: public, max-age=300`.

- **Auth:** Public

No parameters.

**Response `200`:**
```json
{ "success": true, "clients": [ { "_id": "6ab1c0d279bcca7bf9032001", "name": "Acme Logistics", "logo": "/uploads/companies/logo-1790000000000.png" } ] }
```
The list is empty on the live install today. The example values are illustrative, and the logo path format is unverified.

**Errors:**
- `500` — `{success: false, message}`.

#### `POST /api/contact`
The "Contact us" form. Creates an inquiry with status `new` for the admin inbox.

- **Auth:** Public
- **Rate limit:** none.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | Trimmed, must not be empty. |
| `email` | string | Yes | Must be a valid email. Normalised by express-validator `normalizeEmail()` (lowercased; Gmail dots and `+tags` removed). |
| `subject` | string | Yes | Trimmed, must not be empty. |
| `message` | string | No | Trimmed. Defaults to `""`. |

**Response `201`:**
```json
{ "success": true, "message": "Your inquiry has been received.", "inquiry": { "id": "6acb9a0179bcca7bf9033001", "status": "new" } }
```

**Errors:**
- `400` — `{success: false, message: "<all messages joined by spaces>", errors: [{type, value, msg, path, location}]}`. Messages are `Your name is required`, `A valid email is required` and `Subject is required`.
- `500` — `{success: false, message}`.

---

## 6. Cart, shipping and checkout

### Cart

#### `GET /api/users/cart`
Loads the signed-in customer's saved cart, with display data and current prices. Lines whose product is a draft, whose vendor is suspended, or whose bundle is no longer purchasable are left out. Not guarded for unclaimed guests.

- **Auth:** User

**Response `200`** (array of lines):
```json
[
  {
    "product": {
      "_id": "66e9a1b2c3d4e5f6a7b8c9d0",
      "title_en": "Front Brake Pads – Hyundai Elantra",
      "title_ar": "تيل فرامل أمامي – هيونداي إلنترا",
      "price": 690,
      "image": "https://readycar.store/uploads/products/product-1726000000000-1.jpg",
      "slug_en": "front-brake-pads-hyundai-elantra",
      "slug_ar": "تيل-فرامل-امامي-هيونداي-النترا"
    },
    "variant": { "_id": "66e9a1b2c3d4e5f6a7b8c9e1", "label": "Ceramic", "price": 720 },
    "quantity": 2
  },
  {
    "is_bundle": true,
    "bundle_id": "66fa0c1d2e3f4a5b6c7d8e9f",
    "bundle": {
      "_id": "66fa0c1d2e3f4a5b6c7d8e9f",
      "title_en": "Oil Change Kit",
      "title_ar": "طقم تغيير زيت",
      "slug_en": "oil-change-kit",
      "slug_ar": "طقم-تغيير-زيت",
      "image": "https://readycar.store/uploads/products/product-1727000000000-2.jpg",
      "price": 1250,
      "member_count": 3
    },
    "quantity": 1
  }
]
```
For a product line, `price` is the variant's discounted or regular price, otherwise the product's `discount_price ?? price`. `variant` is `null` when there is none.

**Errors:**
- `500` — unexpected error.

#### `POST /api/users/cart`
Replaces the whole saved cart with what the browser holds. It is called whenever the local cart changes for a signed-in customer. Lines that cannot be bought are dropped silently. Not guarded for unclaimed guests.

- **Auth:** User

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | array | yes | If missing or not an array, the cart is emptied. |
| `items[].product._id` / `items[].product.id` / `items[].product_id` | ObjectId | for product lines | Draft products and products of suspended vendors are dropped. |
| `items[].variant._id` / `items[].variant_id` | ObjectId | no | Not checked against the product's variants. |
| `items[].bundle._id` / `items[].bundle.id` / `items[].bundle_id` | ObjectId | for bundle lines | Used only when no product id is present. Unpurchasable bundles are dropped. |
| `items[].quantity` | number | yes | At least 1 (schema). Bundle lines are coerced to at least 1. A product line below 1 gives a 500. |

Example body:
```json
{
  "items": [
    {
      "product_id": "66e9a1b2c3d4e5f6a7b8c9d0",
      "variant_id": null,
      "quantity": 2
    },
    {
      "bundle_id": "66fa0c1d2e3f4a5b6c7d8e9f",
      "quantity": 1
    }
  ]
}
```

**Response `200`**: the resulting cart, same shape as `GET /api/users/cart`.

**Errors:**
- `500` — validation or unexpected error.

### Shipping

#### `GET /api/shipping/zones`
Country → city picker for the checkout address form, built from the active shipping zones, plus the global shipping flags.

- **Auth:** Public

No parameters.

**Response `200`:**
```json
{
  "tree": [
    {
      "country": "Egypt",
      "country_ar": "مصر",
      "has_whole_country_option": false,
      "cities": [
        { "city": "Alexandria", "city_ar": "الاسكندريه" },
        { "city": "Assuit", "city_ar": "اسيوط" }
      ]
    }
  ],
  "config": {
    "enabled": true,
    "multi_vendor_mode": "split",
    "single_country": "Egypt",
    "single_country_ar": "مصر",
    "single_country_has_wildcard": false
  }
}
```
- Countries and cities are sorted alphabetically (English).
- `has_whole_country_option: true` means some zone covers the whole country, so a city outside the list can still be quoted.
- The `single_country*` fields are non-null only when exactly one country is configured; the UI can then skip the country field.
- `multi_vendor_mode` is `split` (each vendor's parcel priced separately) or `combined`.

**Errors:**
- `400` — `{message}`.

#### `GET /api/shipping/cities`
The canonical list of courier (Bosta) cities, sorted by `name`. Address `shipping_city` values must use these English names.

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

#### `GET /api/shipping/classes`
Active shipping classes, sorted by name. The route comment says it is for the vendor/admin product form, but it is public. Customers only need it to show a product's `shipping_class_id` by name.

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

#### `POST /api/shipping/quote`
Checkout shipping options and costs for a cart and destination. The engine finds the best-matching active zone for the destination (an exact city match beats a whole-country match, then lower `priority` wins). It prices every active method in that zone, applies the shipping policies, and splits the cost per vendor. Results are cached in memory for `cache_ttl_seconds` (default 300) per cart, destination and config version.

- **Auth:** User (`token` cookie, role `user`; guest-checkout sessions qualify)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | array | Yes | Cart lines. Lines whose product is unknown are skipped. |
| `items[].product_id` | ObjectId | Yes* | The engine also accepts `product` (id or `{_id}`). *Leave it out on a bundle line. |
| `items[].variant_id` | ObjectId | No | Also accepted as `variant._id`. Without it, the first variant's price is used. |
| `items[].quantity` | integer | No | Also accepted as `qty`. Default and minimum 1. |
| `items[].bundle_id` | ObjectId | No | A bundle line with no product id is expanded into its members × quantity. Also accepted as `bundle._id`. |
| `items[].unit_price` | number | No | Overrides the server-side price for subtotal-based rules (unverified whether clients should send it; checkout recomputes server-side). |
| `destination.country` | string | Yes | English country name, e.g. `"Egypt"`. Without it no zone can match. |
| `destination.city` | string | No | English city name from `/cities`. Matched case-insensitively. |

```json
{
  "items": [{ "product_id": "6ac60cc079bcca7bf9036f53", "quantity": 2 }],
  "destination": { "country": "Egypt", "city": "Alexandria" }
}
```

**Response `200`:** real output for the body above.
```json
{
  "enabled": true,
  "zone": { "_id": "6a8b2fc0d58ebb25a8fcbd45", "name": "Egypt — Alexandria & Behira", "name_ar": "مصر — الإسكندرية والبحيرة" },
  "mode": "split",
  "available_methods": [
    {
      "id": "6a8b2fc0d58ebb25a8fcbd48",
      "name": "Bosta standard delivery",
      "name_ar": "توصيل بوسطة القياسي",
      "type": "rule_engine",
      "total_cost": 42.33,
      "eta_min": 2,
      "eta_max": 4,
      "adjustments": [{ "source": "base", "label": "Vendor shipping", "amount": 42.33 }],
      "policies_applied": [],
      "warnings": [],
      "per_vendor": [
        {
          "vendor_id": "6a4cc23b09b828853234f32a",
          "cost": 42.33,
          "adjustments": [
            { "source": "base", "label": "Base cost", "amount": 40 },
            { "source": "policy", "label": "Bosta extra-COD surcharge · surcharge_percent_above", "amount": 2.3256 }
          ]
        }
      ]
    }
  ],
  "settings": { "enabled": true, "multi_vendor_mode": "split" }
}
```
- Fields:
  - `type` is `flat` | `weight_tier` | `class_based` | `rule_engine`.
  - `eta_min`/`eta_max` are days, or `null`.
  - `total_cost` is in EGP.
  - In `split` mode, `adjustments` holds one "Vendor shipping" line per vendor and the real breakdown is in `per_vendor[].adjustments`. In `combined` mode, `per_vendor` is a proportional split of the total with empty `adjustments`.
  - `policies_applied[]` items are `{policy_id, name, action, amount, ...}`.
- Other outcomes:
  - **Shipping disabled:** `{enabled: false, zone: null, mode, available_methods: [], settings: {enabled: false, multi_vendor_mode}}`.
  - **No zone matched, `no_zone_behavior: block`:** `{enabled: true, blocked: true, zone: null, available_methods: [], ...}`. The destination cannot be shipped to.
  - **No zone matched, `free` or `flat`:** `zone: null` with one synthetic method, `id: "__free__"` ("Free shipping" / "شحن مجاني", cost 0) or `id: "__no_zone_flat__"` ("Standard shipping" / "الشحن القياسي", the configured flat cost).

**Errors:**
- `401` — `{message: "Not authorized, no token provided"}` / `"Not authorized, token failed"` / `"Not authorized, user not found"` / `"Not authorized, password was changed"`.
- `400` — `{message}` on any engine error.

### Checkout

**Is cash on delivery allowed?** `POST /api/orders/preview` answers with `cod.allowed`; placing the order checks again against `shipping_address.phone`. Cash is refused when the store has it switched off, or when an admin blocked the customer. Otherwise it is refused when either test fails:

- **Our history:** the customer (matched by account or delivery phone) has at least 3 finished orders, and more than 50 % of them never reached the customer (refused at the door, or cancelled after the courier took them).
- **Bosta's rating** of the phone number is below 30.

A first-time customer is never refused, and neither is anyone when Bosta does not answer. The customer is only told "not available": `400 { "message": "Cash on delivery is not available for this account. Please pay online." }`.

#### `POST /api/orders/preview`
The checkout screen asks for the authoritative price of the current basket, before the customer pays. It is read-only: nothing is reserved, charged or stored, and placement re-prices from scratch. It returns totals, the per-parcel split, the coupon and loyalty outcome, the wallet position for this total, the prepaid methods on offer, the company-account option and whether cash on delivery is allowed.

- **Auth:** User (unconfirmed guests allowed; their wallet is reported as disabled)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | array | yes | At least one line. |
| `items[].product_id` | ObjectId | yes* | Also read from `items[].product._id` / `.id`. |
| `items[].variant_id` | ObjectId | no | Also `items[].variant._id`. Unknown or missing → the product's first variant. |
| `items[].variant_label` | string | no | If sent, stored as the order line's label as-is (not checked against the variant); otherwise built from the variant's options. |
| `items[].quantity` | number ≥ 1 | no | Default 1. |
| `items[].bundle_id` | ObjectId | yes* | *Instead of `product_id` for a bundle line (also `items[].bundle._id`). Expanded server-side into member lines; whole bundle refused if any member is unavailable. |
| `coupon_code` | string | no | Case-insensitive. An invalid/inapplicable code fails the whole preview with `400`. |
| `redeem_points` | integer | no | Points the customer *asks* to use. Clamped server-side (see [Loyalty points](#loyalty-points)). Default 0. |
| `shipping_destination` | object | no | `{ "country": "Egypt", "city": "Giza" }`. **Without it shipping is 0.** |
| `shipping_method_id` | string | no | From `POST /api/shipping/quote`. Omitted → cheapest active method in the zone. |
| `shipping_address` | object | no | Only `shipping_address.phone` is read here, for the COD check (falls back to `shipping_destination.phone`, then the account phone). Send the delivery phone so `cod.allowed` matches placement. |
| `company` | object | no | Company-account selection: `{ company_id, beneficiary: "employee"\|"car", car_id, office_id, delivery_mode: "instant"\|"consolidate", ship_now_vendor_ids[] }`. |

Example body:
```json
{
  "items": [
    {
      "product_id": "66d9a7b1c2d3e4f5a6b7c8d9",
      "variant_id": "66d9a7b1c2d3e4f5a6b7c8da",
      "quantity": 2
    }
  ],
  "shipping_destination": {
    "country": "Egypt",
    "city": "Giza"
  },
  "shipping_method_id": "66c3d4e5f6a7b8c9d0e1f2a3",
  "shipping_address": {
    "phone": "01012345678"
  }
}
```

Provenance fields (`family_id`, `friendship_id`, `paid_by_user_id`, `ordered_for_user_id`, …) are stripped.

**Response `200`:**
```json
{
  "success": true,
  "totals": {
    "subtotal": 1200,
    "coupon_discount": 120,
    "loyalty_discount": 50,
    "items_total": 1030,
    "shipping": 25,
    "total": 1055
  },
  "coupon": { "code": "SAVE10" },
  "loyalty": {
    "enabled": true,
    "redemption_enabled": true,
    "earning_enabled": true,
    "available_points": 340,
    "pending_points": 0,
    "requested_points": 100,
    "redeemed_points": 100,
    "discount": 50,
    "max_points": 340,
    "max_discount": 170,
    "blocked_reason": null,
    "estimated_earn_points": 41,
    "point_value": 0.5,
    "spend_per_point": 25,
    "min_redeem_points": 1,
    "max_redemption_percent": 50,
    "currency": "EGP"
  },
  "delivery": {
    "parcel_count": 1,
    "is_split": false,
    "parcels": [
      {
        "vendor_name": "Cairo Auto Parts",
        "fulfillment_location": "Nasr City branch",
        "item_count": 1,
        "merchandise_total": 1200,
        "shipping": 25,
        "coupon_share": 120,
        "loyalty_share": 50,
        "amount_due_on_delivery": 1055
      }
    ],
    "cod_total": 1055
  },
  "wallet": {
    "enabled": true,
    "available": 200,
    "shortfall": 855,
    "sufficient": false,
    "status": "active",
    "currency": "EGP"
  },
  "payment_methods": ["wallet", "credit_card"],
  "company": { "eligible": false },
  "cod": { "allowed": true }
}
```
- `coupon` is `null` without a coupon. `wallet` is `{ "enabled": false }` when wallet checkout is off or for an unconfirmed guest.
- `delivery.parcels[].amount_due_on_delivery` is what that courier collects **on a cash order**. `is_split` is true from 2 parcels.
- `company` is `{ "eligible": false }` for non-members. For members it carries `eligible`, `available`, `reason`, `company`, `companies[]`, `offices[]`, `limit`, `remaining`, `company_amount`, `personal_amount`, `delivery_mode`, `consolidation`, … (company manager portal, not covered here).

**Errors:**
- `400` — `{ "success": false, "message": "…" }` for any pricing failure: no items (`Order must contain at least one item`), product not found / draft / vendor suspended, invalid quantity, bundle unavailable, coupon errors (`Invalid coupon code`, `Coupon is inactive or expired`, `Coupon usage limit reached`, `You already reached this coupon usage limit`, `Minimum order amount for this coupon is …`, `Coupon is not applicable to items in your cart`), shipping (`We do not ship to the selected location yet.`, `The selected shipping method is no longer available…`). No `code` field.

#### `POST /api/coupons/validate`
The customer types a coupon code at checkout. The server prices the basket with that coupon and reports the discount. Read-only: usage is only counted when an order is actually created.

- **Auth:** User

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `code` | string | yes | Trimmed, upper-cased. |
| `items` | array | yes | Same item shape as `POST /api/orders/preview`. Non-empty. |

Example body:
```json
{
  "code": "SAVE10",
  "items": [
    {
      "product_id": "66d9a7b1c2d3e4f5a6b7c8d9",
      "quantity": 2
    }
  ]
}
```

**Response `200`:**
```json
{
  "success": true,
  "coupon": {
    "_id": "66e1f0c2a1b2c3d4e5f60718",
    "code": "SAVE10",
    "name": "10% off brakes",
    "discount_type": "percent",
    "discount_value": 10,
    "scope_type": "category_tree",
    "vendor_share_percent": 0
  },
  "pricing": {
    "subtotal": 1200,
    "eligible_subtotal": 1200,
    "discount_amount": 120,
    "final_total": 1080
  },
  "eligible_item_ids": ["66d9a7b1c2d3e4f5a6b7c8d9"]
}
```
- `discount_type`: `percent` | `fixed`. `scope_type`: `all_products` | `category_tree` | `product_list` | `vendor_list`. The discount applies only to `eligible_subtotal` and is capped at it. `final_total` is merchandise minus the coupon, **before** points and shipping. `min_order_amount` is checked against the full merchandise `subtotal`. `eligible_item_ids` are product ids.

**Errors:**
- `400` — `{ "message": "Coupon code is required" }`, `"Cart items are required"`, `"Coupon is not applicable"`, or any coupon/pricing message listed under the preview. No `code` field.

#### `POST /api/orders`
The customer presses "Place order". The server re-prices the basket and branches on `payment_method`:
- `cash`: COD-eligibility check, points spent, order created.
- `wallet`: balance checked, then debited atomically before the order is written. The order is born `paid`.
- `credit_card`: creates a hosted payment and holds the points. **No order is created.** The client must redirect to `paymentUrl` and then call `POST /api/orders/confirm-payment`.
- `company_account`: billed to the employer.

On success it also: removes the bought lines from the server cart (unless `checkout_source` is `buy_now`), counts the coupon use, notifies vendors, sends the WhatsApp order confirmation, and saves a new delivery address to the account. Not idempotent: each call is a new order (cash/wallet) or a new invoice (card).

- **Auth:** User. Unconfirmed guests can place `cash` and `credit_card` orders; `wallet` and `company_account` get `403 GUEST_NOT_CONFIRMED`; `redeem_points` is forced to 0.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `shipping_address` | object | yes | `{ recipient_name, phone, full_address }` (all strings, all required by the model; other keys dropped). `phone` is the courier's number and the COD identity. |
| `items` | array | yes | Same shape as the preview. |
| `payment_method` | string | no | `cash` (default) \| `credit_card` \| `wallet` \| `company_account` (\| `bank_transfer`, offered by no screen; see [Known issues](#appendix-c-known-issues)). Anything else → `400` validation error. |
| `coupon_code` | string | no | |
| `redeem_points` | integer | no | Request; clamped. Ignored (0) for unconfirmed guests. |
| `shipping_destination` | object | no | `{ country, city }`. **Required for shipping to be charged.** |
| `shipping_method_id` | string | no | |
| `checkout_source` | string | no | `cart` (default) \| `cart_selected` \| `buy_now`. Anything except `buy_now` removes the purchased lines from the saved cart. |
| `company` | object | with `company_account` | `{ company_id, beneficiary: "employee"\|"car", car_id, office_id, delivery_mode, ship_now_vendor_ids[] }`. |

Example body:
```json
{
  "shipping_address": {
    "recipient_name": "Ahmed Ali",
    "phone": "01012345678",
    "full_address": "12 Tahrir St, Dokki, Giza"
  },
  "items": [
    {
      "product_id": "66d9a7b1c2d3e4f5a6b7c8d9",
      "variant_id": "66d9a7b1c2d3e4f5a6b7c8da",
      "quantity": 2
    }
  ],
  "payment_method": "credit_card",
  "shipping_destination": {
    "country": "Egypt",
    "city": "Giza"
  },
  "shipping_method_id": "66c3d4e5f6a7b8c9d0e1f2a3",
  "checkout_source": "cart"
}
```

`total_price` and provenance fields sent by the client are ignored or stripped.

**Response `201`** (cash, wallet, company — the order exists):
```json
{
  "success": true,
  "message": "Order placed successfully",
  "order": {
    "_id": "66f1c2a9e4b0a1b2c3d4e5f6",
    "user_id": "66a01b2c3d4e5f6a7b8c9d0e",
    "status": "pending",
    "placed_as_guest": false,
    "guest_phone_confirmed_at": null,
    "shipping_address": {
      "recipient_name": "Ahmed Ali",
      "phone": "01012345678",
      "full_address": "12 Tahrir St, Dokki, Giza"
    },
    "items": [
      {
        "_id": "66f1c2a9e4b0a1b2c3d4e5f7",
        "product_id": "66d9a7b1c2d3e4f5a6b7c8d9",
        "product_title": "Front brake pads",
        "product_image": "/uploads/products/pads.webp",
        "variant_id": "66d9a7b1c2d3e4f5a6b7c8da",
        "variant_label": "Default",
        "quantity": 2,
        "unit_price": 600,
        "vendor_id": "66b2c3d4e5f6a7b8c9d0e1f2",
        "vendor_status": "pending",
        "sub_order_id": "66f1c2a9e4b0a1b2c3d4e5f8",
        "bundle_id": null,
        "is_bundle_member": false,
        "return_status": "none"
      }
    ],
    "sub_orders": [
      {
        "_id": "66f1c2a9e4b0a1b2c3d4e5f8",
        "reference": "REF-K3J9QX2A-1",
        "vendor_id": "66b2c3d4e5f6a7b8c9d0e1f2",
        "fulfillment_location": "Nasr City branch",
        "status": "pending_review",
        "merchandise_total": 1200,
        "shipping_share": 25,
        "coupon_share": 120,
        "loyalty_share": 50,
        "cod_amount": 1055,
        "deadline_at": "2026-10-13T10:00:00.000Z",
        "tracking_number": null,
        "delivered_at": null
      }
    ],
    "shipping": {
      "enabled": true,
      "mode": "combined",
      "destination": { "country": "Egypt", "city": "Giza" },
      "method_id": "66c3d4e5f6a7b8c9d0e1f2a3",
      "method_name": "Standard",
      "total_cost": 25,
      "per_vendor": [{ "vendor_id": "66b2c3d4e5f6a7b8c9d0e1f2", "cost": 25, "adjustments": [] }]
    },
    "total_price": 1055,
    "coupon_code": "SAVE10",
    "coupon_discount_amount": 120,
    "loyalty": {
      "payer_user_id": "66a01b2c3d4e5f6a7b8c9d0e",
      "redeemed_points": 100,
      "redemption_discount": 50,
      "earn_points_pending": 41,
      "eligible_amount": 1030
    },
    "transaction": {
      "amount": 1055,
      "payment_method": "cash",
      "status": "pending",
      "reference": "REF-K3J9QX2A",
      "provider": null,
      "wallet_transaction_id": null,
      "paid_at": null
    },
    "created_at": "2026-10-11T10:00:00.000Z"
  }
}
```
`order` is the **whole Mongoose order document**, trimmed here. It also contains internal fields an app should ignore: `commission_rate`/`commission_amount` on items, `commission_total`, `coupon_vendor_share`/`coupon_platform_share` and `history` on sub-orders, `vendor_supervisions`, `history`, `customer_confirmation`, `shipments`. A wallet order has `transaction.status: "paid"`, `provider: "wallet"` and a `wallet_transaction_id`.

**Response `201`** (`credit_card` — hosted payment created, **no order yet**):
```json
{
  "success": true,
  "requiresPayment": true,
  "message": "Payment invoice created successfully",
  "paymentUrl": "https://app.fawaterk.com/invoice/1234567/abcd",
  "payment": {
    "id": "66f1c3b0e4b0a1b2c3d4e600",
    "status": "pending",
    "invoiceId": "1234567",
    "invoiceKey": "abcdEFGH1234"
  }
}
```
Keep `payment.id`: it is what `POST /api/orders/confirm-payment` needs. On Paymob `invoiceId` is the Paymob order id and `invoiceKey` the intention id (`pi_…`).

**Errors:**
- `400` — `{ "message": "…" }` (no `code`): `Shipping address is required`, any pricing/coupon/shipping message from the preview, `Cash on delivery is not available for this account. Please pay online.`, model validation (unknown `payment_method`), gateway failures (`… did not return a payment URL`), points spent elsewhere in the meantime.
- `402` — `{ "success": false, "code": "INSUFFICIENT_BALANCE", "message": "Your wallet balance is not enough for this order", "wallet": { "required": 1055, "available": 200, "shortfall": 855, "currency": "EGP" } }`. If the balance moved during placement, `wallet` holds only `available` and `currency`. Offer a top-up of `shortfall`.
- `403` — `GUEST_NOT_CONFIRMED` for `wallet` / `company_account` from an unconfirmed guest.
- `409` — `ONLINE_PAYMENT_DISABLED` (gateway withdrawn); `WALLET_DISABLED`; `PRICE_CHANGED` (company order total moved). Company refusals `LIMIT_USED_UP`, `LIMIT_NOT_ENOUGH`, `COMPANY_CAP_REACHED`, `COMPANY_WALLET_INSUFFICIENT`, `COMPANY_ALLOCATION_EXCEEDED` come back as `{ success: false, code, message, details? }` with `details: { total, remaining }`. Other company context codes (e.g. `COMPANY_SUSPENDED`, `EMPLOYEE_DEACTIVATED`) use their own status.
- `423` — `{ "success": false, "code": "WALLET_FROZEN", "message": "This wallet is temporarily on hold. Please contact support." }`.

#### `POST /api/orders/confirm-payment`
Called after the customer comes back from the hosted payment page. **Mandatory:** in production this call is what creates the order. The server finds the payment by id (scoped to the caller), asks the provider whether it was paid, and never trusts the redirect's `?payment=` flag.
- If paid: re-prices the basket, refusing if the total moved; creates the order with `transaction.status: "paid"`; turns held points into a spend; returns the order.
- If not paid yet: returns `status: "pending"`.

Safe to call again once paid (returns the existing order). Do not call it concurrently for the same payment.

- **Auth:** User (unconfirmed guests allowed)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `paymentId` | ObjectId | one of the two | `payment.id` from `POST /api/orders` (also the `paymentId` query param on the return URL). |
| `invoice_id` | string | one of the two | Provider invoice id. If both are sent and the payment already has a different `invoice_id` → `INVOICE_MISMATCH`. |

Example body:
```json
{
  "paymentId": "66f1c3b0e4b0a1b2c3d4e600"
}
```

**Response `200`** (paid):
```json
{
  "success": true,
  "status": "paid",
  "message": "Payment confirmed and order created",
  "order": {
    "_id": "66f1c4d2e4b0a1b2c3d4e650",
    "status": "pending",
    "total_price": 1055,
    "sub_orders": [{ "reference": "1234567-1", "status": "pending_review", "cod_amount": 1055 }],
    "transaction": {
      "amount": 1055,
      "payment_method": "credit_card",
      "status": "paid",
      "reference": "1234567",
      "provider": "fawaterak",
      "payment_id": "66f1c3b0e4b0a1b2c3d4e600",
      "invoice_id": "1234567",
      "paid_at": "2026-10-11T10:04:31.000Z"
    }
  }
}
```
- The message is `"Payment was already confirmed"` on a repeat call. `order` is the full order document (same shape as `POST /api/orders`). A company order is `payment_method: "company_account"`. For a family-request payment that another call already converted, `order` may be just the order id.

**Response `200`** (not paid yet):
```json
{ "success": true, "status": "pending", "message": "Payment is not confirmed yet" }
```
The status is always `"pending"` when the provider does not report paid, including for a declined or abandoned payment. Retry with backoff. Stop after a reasonable time and show "payment not completed".

**Errors:** `{ "success": false, "code": "…", "message": "…" }`
- `400` — `PAYMENT_REFERENCE_REQUIRED` (neither field sent); `INVOICE_MISMATCH`; anything else, including a provider read failure, or order creation failing after capture (payment becomes `paid_order_failed`; `code` may be absent).
- `404` — `PAYMENT_NOT_FOUND` (not this customer's payment).
- `409` — `AMOUNT_MISMATCH`: the customer paid, but the basket total has changed since (price, coupon, shipping). No order is created, holds are released and the payment is marked `amount_mismatch`. This is a support/refund case.

### Buying for a friend

Mounted at `/api/orders/friend-checkout`. The payer is always the session user. The recipient must be an active friend who shares at least one address with the payer. Delivery goes to the friend's shared address. **Cash on delivery is impossible:** only `wallet` and `credit_card` are accepted. The order is owned by the payer (`user_id` = `paid_by_user_id`), with `ordered_for_user_id` = the friend. Coupon and points belong to the payer.

#### `POST /api/orders/friend-checkout/preview`
The payer picks a friend, one of the friend's shared addresses, and a shipping method. The server checks the friendship and the address share, quotes shipping for the address and prices the basket. Read-only.

- **Auth:** User

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `friend_id` | ObjectId | yes | The friend's user id. |
| `recipient_address_id` | ObjectId | yes | One of the friend's addresses shared with the payer. |
| `items` | array | yes | Same shape as `POST /api/orders/preview`. |
| `shipping_method_id` | string | no | Must be one of `available_methods[].id`. **If omitted, the preview (and payment) is priced with no shipping.** |
| `coupon_code` | string | no | Evaluated against the payer. |
| `redeem_points` | integer | no | The payer's points. |
| `payment_method` | string | no | If present must be `credit_card` or `wallet`. |

Example body:
```json
{
  "friend_id": "66a1b2c3d4e5f6a7b8c9d0e1",
  "recipient_address_id": "66a2b3c4d5e6f7a8b9c0d1e2",
  "items": [
    {
      "product_id": "66d9a7b1c2d3e4f5a6b7c8d9",
      "quantity": 1
    }
  ],
  "shipping_method_id": "66c3d4e5f6a7b8c9d0e1f2a3",
  "payment_method": "credit_card"
}
```

**Response `200`:**
```json
{
  "recipient": { "_id": "66a1…", "name": "Omar Hassan", "profile_image": null },
  "address": {
    "_id": "66a2…",
    "label": "Home",
    "recipient_name": "Omar Hassan",
    "phone": "01198765432",
    "full_address": "5 Nile St, Maadi, Cairo",
    "shipping_country": "Egypt",
    "shipping_city": "Cairo"
  },
  "destination": { "country": "Egypt", "city": "Cairo" },
  "available_methods": [
    { "id": "66c3…", "name": "Standard", "name_ar": "عادي", "type": "flat", "total_cost": 25, "eta_min": 2, "eta_max": 4, "adjustments": [], "policies_applied": [], "warnings": [], "per_vendor": [] }
  ],
  "selected_method": { "id": "66c3…", "name": "Standard", "total_cost": 25 },
  "blocked_no_zone": false,
  "coupon_applied": false,
  "coupon": null,
  "totals": { "subtotal": 1200, "discount": 0, "loyalty_discount": 0, "shipping": 25, "total": 1225 },
  "loyalty": { "enabled": true, "redeemed_points": 0, "discount": 0, "available_points": 340, "max_points": 340, "blocked_reason": null },
  "currency": "EGP",
  "payment_methods": ["wallet", "credit_card"],
  "online_payment_only": true,
  "wallet": { "enabled": true, "available": 2000, "shortfall": 0, "sufficient": true, "status": "active", "currency": "EGP" }
}
```
- No `success` field. `loyalty` has the same shape as the main preview (trimmed here). `selected_method` is `null` when none was chosen. `blocked_no_zone: true` means shipping to this address is not offered. `wallet` is `{ "enabled": false }` when wallet checkout is off. This preview does not return a parcel breakdown.

**Errors:** `{ "code": "…", "message": "…" }`
- `400` — `EMPTY_CART`, `SHIPPING_METHOD_INVALID`, `FRIEND_ORDER_ONLINE_ONLY`, `SHIPPING_NO_ZONE`; any pricing/coupon failure as `FRIEND_CHECKOUT_ERROR`.
- `403` — `ADDRESS_NOT_SHARED`.
- `404` — `FRIENDSHIP_NOT_FOUND` (also for blocked/removed friends), `OWNER_NOT_FOUND`.
- `409` — `NO_SHARED_ADDRESS`, `ADDRESS_UNAVAILABLE`.

#### `POST /api/orders/friend-checkout/create-payment`
The payer pays for the friend's order. The server repeats every check from the preview and then:
- **Wallet:** places the order immediately, debits the payer's wallet and notifies both people.
- **Card:** creates a hosted payment and holds the payer's points. **No order exists until confirmed.**

If `payment_method` is omitted it defaults to `wallet` when the wallet is live, otherwise `credit_card`.

- **Auth:** User
- **Rate limit:** 10 requests / minute per user (`429 { "code": "RATE_LIMITED", "message": "Too many requests. Please try again in N seconds." }` + `Retry-After` header)

**Body:** same as `POST /api/orders/friend-checkout/preview`.

**Response `201`** (wallet — order placed):
```json
{
  "success": true,
  "requiresPayment": false,
  "recipient": { "_id": "66a1…", "name": "Omar Hassan", "profile_image": null },
  "order": { "_id": "66f1…", "status": "pending", "total_price": 1225, "ordered_for_user_id": "66a1…", "paid_by_user_id": "66a0…", "transaction": { "payment_method": "wallet", "status": "paid" } }
}
```
`order` is the full order document (see `POST /api/orders`).

**Response `201`** (card — redirect needed):
```json
{
  "success": true,
  "requiresPayment": true,
  "paymentUrl": "https://app.fawaterk.com/invoice/1234568/efgh",
  "recipient": { "_id": "66a1…", "name": "Omar Hassan", "profile_image": null },
  "payment": { "id": "66f1c5e0e4b0a1b2c3d4e700", "status": "pending", "invoiceId": "1234568" }
}
```
After paying, the provider returns to `${FRONTEND_URL}/checkout?payment=<status>&paymentId=<id>&context=friend`.

**Errors:** all errors from the friend preview, plus:
- `402` — `{ "code": "INSUFFICIENT_BALANCE", "message": "Your wallet balance is not enough for this operation" }` (no shortfall figures here; use the preview's `wallet.shortfall`).
- `409` — `WALLET_DISABLED`, `ONLINE_PAYMENT_DISABLED`.
- `423` — `WALLET_FROZEN`.
- `429` — `RATE_LIMITED`.

#### `POST /api/orders/friend-checkout/confirm-payment`
Meant to be called after the card redirect for a friend payment (`context=friend`), to turn the paid payment into the order. If the payment has already become an order, it returns that order's id.

> **Currently broken** (see [Known issues](#appendix-c-known-issues)). For a payment that has not yet been converted, it fails with `400 { "code": "FRIEND_CHECKOUT_ERROR", "message": "confirmFawaterakOrderPayment is not a function" }`. From code reading, `POST /api/orders/confirm-payment` with the same `paymentId` does work for friend payments, and returns the generic `{ status, order }` shape.

- **Auth:** User

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `paymentId` | ObjectId | yes | `payment.id` from create-payment. The lookup is by this id only (must be the caller's friend payment). |
| `invoice_id` | string | no | Passed through to the provider check. |

Example body:
```json
{
  "paymentId": "66f1c5e0e4b0a1b2c3d4e700"
}
```

**Response `200`** (already converted / paid):
```json
{ "success": true, "status": "paid", "order_id": "66f1c6f1e4b0a1b2c3d4e750", "message": "Payment was already confirmed" }
```
On a first successful conversion the message would be `"Payment confirmed and order created"`. If the provider says unpaid, the intended response is `{ "success": true, "status": "pending", "message": "Payment is not confirmed yet" }`, and the payer is also sent a "Payment did not complete" notification each time.

**Errors:** `{ "code": "…", "message": "…" }`
- `400` — `FRIEND_CHECKOUT_ERROR` (see the defect above; also a malformed id).
- `404` — `PAYMENT_NOT_FOUND`.

### Payment provider callbacks

None of these are called by the app. They are listed so app developers know what lands where.

#### `GET /api/payments/paymob/return`
The **browser redirect** after a Paymob payment. Paymob sends the customer's browser here after every Paymob payment (orders, wallet top-ups and vendor flows share this one URL). The route **settles nothing**. It works out which of our records the payment belongs to and 302-redirects the browser to the page that started the payment. That page (or the app) must then call the matching confirm endpoint.

- **Auth:** Public (browser redirect from Paymob; no session needed)

**Query** (set by Paymob, flat)

| Field | Type | Required | Notes |
|---|---|---|---|
| `success` | `"true"`/`"false"` | yes | |
| `pending` | `"true"`/`"false"` | yes | Kiosk / in-progress payments. |
| `order` or `order_id` | string | yes | Paymob's numeric order id (= our `invoiceId`). Both spellings accepted. |
| `merchant_order_id` | string | no | Our reference `flow:recordId:attempt`, e.g. `order:66f1c3b0e4b0a1b2c3d4e600:1`, `wallet:<topupId>:1`. Not always sent; the order id is the fallback. |
| `id` | string | no | Paymob transaction id. |
| `hmac` | string | no | HMAC-SHA512 over Paymob's 20 fields (`amount_cents`, `created_at`, `currency`, `error_occured`, `has_parent_transaction`, `id`, `integration_id`, `is_3d_secure`, `is_auth`, `is_capture`, `is_refunded`, `is_standalone_payment`, `is_voided`, `order`, `owner`, `pending`, `source_data.pan`, `source_data.sub_type`, `source_data.type`, `success`). Checked, but **only logged** when invalid: the redirect still happens. |

**Behaviour:** `status = "success"` if `success=true` and `pending=false`, else `"pending"` if `pending=true`, else `"failed"`. The record is found by `merchant_order_id`, falling back to a lookup of `invoice_id` = `order` across order payments, top-ups, subscriptions and supply orders.

**Response `302`:** `Location` header, no body. Customer-flow targets:

| Matched record | Redirect |
|---|---|
| Order payment | `${FRONTEND_URL}/checkout?payment=<status>&paymentId=<OrderPayment id>` |
| Friend order payment | same, plus `&context=friend` |
| Family-request payment | `${FRONTEND_URL}/family/requests/<requestId>?payment=<status>&paymentId=<id>` |
| Wallet top-up | `${FRONTEND_URL}<return_path>?topup=<status>&topupId=<id>` (`return_path` default `/profile?tab=wallet`, or `/checkout` for checkout-started top-ups) |
| Nothing matched | `${FRONTEND_URL}/?payment=<status>` |
| Internal error | `${FRONTEND_URL}/?payment=failed` |

Then call `POST /api/orders/confirm-payment { paymentId }`, `POST /api/orders/friend-checkout/confirm-payment`, or `POST /api/users/wallet/topups/confirm { topupId }` respectively. A forged `?payment=success` only produces a redirect.

**Errors:** none returned to the browser. Every path redirects.

#### `POST /api/payments/paymob/webhook`
Server-to-server "transaction processed" callback from Paymob. It is the only Paymob path that settles money on its own. A paid order payment becomes an order and a paid top-up is credited, using the same idempotent settle functions the confirm endpoints use. Kiosk "reference issued" callbacks (`pending: true`) and failed transactions are recorded on the record and leave it pending.

- **Auth:** Server-to-server (HMAC-SHA512 in query `?hmac=`, over `body.obj`)

**Body:** Paymob's JSON `{ "type": "TRANSACTION", "obj": { "id", "success", "pending", "amount_cents", "order": { "id", "merchant_order_id" }, "source_data": { "type", "sub_type", "pan" }, … } }`.

**Response `200`:** `{ "success": true }` when settled; `{ "success": true, "pending": true }` for a pending transaction; `{ "success": true, "ignored": true, "reason": "…" }` when there is no matching record, the record belongs to Fawaterak, or the transaction did not succeed.

**Errors:**
- `401` — invalid or missing signature.
- `500` — settlement threw (e.g. amount mismatch, order creation failed). Paymob retries.

#### `POST /api/orders/fawaterak/webhook_json`
Server-to-server Fawaterak "paid" callback for order payments. When accepted it creates the order exactly like a successful confirm. **In production this webhook is rejected (`401`)**, so order creation depends on the app calling `POST /api/orders/confirm-payment`.

- **Auth:** Server-to-server (`hashKey` = HMAC-SHA256 of `InvoiceId=…&InvoiceKey=…&PaymentMethod=…` with the vendor or API key)

**Body:** Fawaterak's payload: `hashKey`, `invoice_id`, `invoice_key`, `payment_method`, `invoice_status`, `pay_load` (JSON carrying our `orderPaymentId`).

**Response `200`:** `{ "success": true }`. Or `{ "success": true, "ignored": true }` when `invoice_status` is not `paid`, or `{ "success": true, "ignored": true, "reason": "record belongs to another provider" }`.

**Errors:**
- `401` — `{ "success": false, "message": "Invalid webhook signature" }`.
- `404` — payment not found.
- `500` — settlement failed.

#### `POST /api/users/wallet/fawaterak/webhook_json`
Server-to-server Fawaterak "paid" callback for wallet top-ups. It credits the wallet once, idempotent with the confirm endpoint and the sweep. Subject to the same production `401` problem.

- **Auth:** Server-to-server (same `hashKey` scheme as above; `pay_load` carries `walletTopupId`)

**Response `200`:** `{ "success": true }` / `{ "success": true, "ignored": true[, "reason"] }`.

**Errors:**
- `401` — invalid signature.
- `404` — `{ "success": false, "message": "Top-up not found" }`.
- `500` — credit failed (top-up marked `paid_credit_failed`).

---

## 7. After the order

### My orders and parcels

#### `GET /api/users/orders`
The "My orders" page. Returns every order of the customer, newest first, with no pagination. Each element is the whole order document (`.lean()`) plus three computed fields.

**Main stored fields:**
- **Identity and state:** `_id`, `user_id`, `status`, `created_at`, `delivered_at`.
- **What was bought:** `items[]`, `shipping_address`, `shipping`.
- **Money:** `total_price`, `transaction` (`payment_method`, `status`, `reference`, `amount`, `paid_at`, …), `loyalty`.
- **Coupon:** `coupon_code`, `coupon_discount_amount`.
- **Parcels and shipping:** `sub_orders[]`, `shipments[]`.
- **Other:** `history[]`, `placed_as_guest`, `guest_phone_confirmed_at`.

Each `items[]` entry also gets `product_slug`, `product_sku` and `product_part_number`.

**Computed fields:**
- `parcels[]`: one card per vendor parcel, with the vendor name, a journey ladder, cancel eligibility and review state.
- `parcel_summary`
- `journey`: the order-level 7-step ladder (`placed → preparing → ready → with_courier → in_transit → out_for_delivery → delivered`). It is `null` on legacy orders that have no parcels.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Response `200`** (one order, abridged; raw `sub_orders`, `shipments` and `history` omitted):
```json
[
  {
    "_id": "6702a1e9c3b4a5d6e7f80900",
    "user_id": "66f0b8d2a4c3e21f9b7a1c55",
    "status": "partially_shipped",
    "created_at": "2026-10-01T09:10:00.000Z",
    "total_price": 2190,
    "shipping_address": { "recipient_name": "Mona Adel", "phone": "01012345678", "full_address": "12 El-Tahrir St, Dokki" },
    "coupon_code": "WELCOME10",
    "coupon_discount_amount": 150,
    "transaction": { "amount": 2190, "payment_method": "cash", "status": "pending", "reference": "REF-7K2M9QXA" },
    "items": [
      {
        "_id": "6702a1e9c3b4a5d6e7f80901",
        "product_id": "66e9a1b2c3d4e5f6a7b8c9d0",
        "product_title": "Front Brake Pads – Hyundai Elantra",
        "product_image": "https://readycar.store/uploads/products/product-1726000000000-1.jpg",
        "variant_label": "",
        "quantity": 2,
        "unit_price": 690,
        "vendor_id": "66d1f0a1b2c3d4e5f6a7b8c9",
        "vendor_status": "approved",
        "sub_order_id": "6702a1f0c3b4a5d6e7f80912",
        "return_status": "none",
        "product_slug": "front-brake-pads-hyundai-elantra",
        "product_sku": "BP-ELN-19",
        "product_part_number": "58101-F2A00"
      }
    ],
    "parcels": [
      {
        "_id": "6702a1f0c3b4a5d6e7f80912",
        "reference": "REF-7K2M9QXA-1",
        "status": "in_transit",
        "raw_status": "in_transit",
        "company_batch": null,
        "return_state": { "key": "none", "returned": 0, "total": 1 },
        "journey": {
          "steps": [
            { "key": "pending_review", "owner": "vendor", "state": "done", "at": "2026-10-01T09:10:00.000Z" },
            { "key": "in_transit", "owner": "bosta", "state": "current", "at": "2026-10-02T13:40:00.000Z" }
          ],
          "ending": null,
          "current_index": 7
        },
        "vendor_id": "66d1f0a1b2c3d4e5f6a7b8c9",
        "vendor_name": "Auto Parts Cairo",
        "fulfillment_location": "Nasr City branch",
        "items": [],
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
        "tracking_history": [{ "state": "PICKED_UP", "timestamp": "2026-10-02T11:05:00.000Z", "notes": "" }],
        "bosta_status": "IN_TRANSIT",
        "parcel_photos": [],
        "delivered_at": null,
        "cancelled_at": null,
        "cancel_reason": "",
        "can_cancel": false,
        "cancel_blocked_reason": "The courier has already collected this parcel",
        "cancel_blocked_reason_ar": "المندوب استلم الطرد ده بالفعل",
        "reactivation_count": 0,
        "reactivated_at": null,
        "created_at": "2026-10-01T09:10:00.000Z",
        "amount_due_on_delivery": 1450,
        "review": null
      }
    ],
    "parcel_summary": { "total": 2, "delivered": 0, "cancelled": 0 },
    "journey": {
      "steps": [
        { "key": "placed", "owner": "order", "state": "done", "at": "2026-10-01T09:10:00.000Z" },
        { "key": "preparing", "owner": "order", "state": "current", "at": null }
      ],
      "ending": null,
      "current_index": 1
    }
  }
]
```

**Parcel fields:**
- `items` holds the raw order items in that parcel. It is left empty above for brevity.
- `journey.steps` has one entry per rung: 10, or 11 when the parcel waits in a company batch. Each step's `state` is one of `done`, `skipped`, `current`, `stopped`, `todo`.
- `review` is `null` until the parcel is delivered. After that it is `{ "can_review": bool, "submitted": bool }`.
- `amount_due_on_delivery` is `cod_amount` on a cash order and `0` otherwise.
- `company_batch` is an object when the parcel is in a company consolidation batch. While waiting it carries `batch: { waiting_count, target_count, deadline_at, office_name, closing }`.

**Errors:**
- `500` — unexpected error.

#### `GET /api/users/orders/:id/tracking`
The tracking view for one order: one card per parcel, plus the legacy `shipments` list.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | Must be one of the caller's own orders. |

**Response `200`**:
```json
{
  "success": true,
  "shipments": [
    {
      "_id": "6702b0c1c3b4a5d6e7f80a01",
      "sub_order_id": "6702a1f0c3b4a5d6e7f80912",
      "provider": "bosta",
      "tracking_number": "71234567",
      "bosta_tracking_number": "71234567",
      "bosta_status": "IN_TRANSIT",
      "pickup_address": { "address": "45 Abbas El Akkad, Nasr City", "city": "Cairo", "zone": "", "district": "" },
      "items": ["6702a1e9c3b4a5d6e7f80901"],
      "sent_at": "2026-10-01T15:00:00.000Z",
      "last_tracked_at": "2026-10-02T13:40:00.000Z",
      "tracking_history": [{ "state": "PICKED_UP", "timestamp": "2026-10-02T11:05:00.000Z", "notes": "" }]
    }
  ],
  "parcels": [],
  "order_status": "partially_shipped",
  "payment_method": "cash",
  "parcel_summary": { "total": 2, "delivered": 0, "cancelled": 0 }
}
```
`parcels[]` has the same shape as in `GET /api/users/orders` but without `review`. `pickup_address` is the vendor branch the courier collects from.

**Errors:**
- `404` — `Order not found`: not the caller's order.
- `500` — unexpected error, including a malformed `id` (CastError).

#### `POST /api/users/orders/:id/sub-orders/:subOrderId/cancel`
The customer cancels one parcel. This is allowed until the courier has the box, or until dispatch for an Arrive parcel, and not for parcels sealed in a company combined parcel. Side effects:
- The courier delivery is cancelled with the courier: Bosta deliveries are terminated, and Arrive parcels are flagged for staff to cancel by hand.
- The parcel is detached from any booked pickup visit.
- **Coupon:** it is re-checked against what is left. If the order drops below the coupon minimum, the coupon is removed and this parcel's coupon share is subtracted from the refund.
- **Refund:** a prepaid (wallet or card, paid) parcel is refunded to the wallet. A company-account parcel is refunded to the company.
- **Points:** redeemed points are restored in proportion to the parcel.
- The vendor and the customer are notified.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | The caller's order. |
| `subOrderId` | ObjectId | yes | A parcel (`sub_orders[]._id`, the same as `parcels[]._id`) on that order. |

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | no | Defaults to `"Cancelled by the customer"`. |

**Response `200`**:
```json
{
  "success": true,
  "refunded": 0,
  "points_restored": 0,
  "coupon_dropped": true,
  "message": "Parcel cancelled. Your coupon no longer applies to what is left, so it was removed from the order."
}
```
Without a dropped coupon, `message` is `"Parcel cancelled."`. `refunded` is the amount returned to the wallet or company. It is `0` for cash orders, or when the refund call failed (failures are logged).

**Errors** (`{success:false, code?, message}`):
- `404` — `Order not found` (no `code`): not the caller's order.
- `404` — `SUB_ORDER_NOT_FOUND`.
- `400` — `ALREADY_CANCELLED`; `CANCEL_WINDOW_CLOSED` (`message` gives the reason, e.g. `The courier has already collected this parcel`); `CANCEL_FAILED` (fallback, e.g. a malformed id).
- `409` — `BATCH_CLOSING`, or another company-batch code: the parcel's batch is being released to the vendor.

#### `POST /api/users/orders/:id/parcels/:subOrderId/review-link`
The "Rate this parcel" button on a delivered parcel. Returns a link to the same review page the WhatsApp review message opens. Repeated calls add another live token to the same invite, so earlier links keep working. Invites last 30 days (`REVIEW_INVITE_TTL_DAYS`).

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | The caller's order. |
| `subOrderId` | ObjectId | yes | A parcel on that order. |

**Response `200`**:
```json
{
  "submitted": false,
  "url": "https://readycar.store/review/3f9c2b7e1a0d4c5b8e6f7a2d9c1b0e4f5a6d7c8b9e0f1a2b",
  "path": "/review/3f9c2b7e1a0d4c5b8e6f7a2d9c1b0e4f5a6d7c8b9e0f1a2b"
}
```
If the parcel is already rated, the response is `{ "submitted": true }`.

**Errors** (`{message, code}`):
- `404` — `ORDER_NOT_FOUND` (also for malformed ids); `PARCEL_NOT_FOUND`.
- `409` — `PARCEL_NOT_DELIVERED`; `NOTHING_TO_REVIEW` (every line declined or returned).
- `500` — unexpected error.

### Returns

Mounted at `/api/returns`. One request covers items from a single delivered parcel. Refunds are issued by the store team later. The default destination follows the original payment (see `default_refund_method`).

- The parcel must be `delivered`, and the request must come within **14 days** of that parcel's delivery.
- Every request needs 1 to 6 photo or video URLs as evidence. Upload images first with `POST /api/upload`.
- Only items the store approved (`vendor_status: "approved"`) can be returned. Quantities add up across all open returns.
- Default `fault_type` by `reason`: `defective`, `wrong_item` and `not_as_described` → `vendor_fault`; `changed_mind` → `customer_fault`; `other` → `undetermined`.

#### `POST /api/returns`
The customer asks to return items from a delivered parcel. The request must come within 14 days of that parcel's delivery and include photo/video evidence. Creates the request in `pending_vendor_review`, marks the items `return_requested`, re-derives the order status (e.g. `return_requested`), and notifies the vendor.

- **Auth:** User

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `order_id` | ObjectId | yes | Must be the caller's order. |
| `items` | array | yes | At least one. All from the **same parcel**. |
| `items[].order_item_id` | ObjectId | yes | `order.items[]._id`. Item must have `vendor_status: "approved"`. |
| `items[].quantity_returning` | integer | no | Defaults to the full purchased quantity. Cannot exceed what is not already in an open/finished return. |
| `reason` | string | yes | `defective` \| `wrong_item` \| `not_as_described` \| `changed_mind` \| `other`. |
| `reason_details` | string | no | Free text. |
| `evidence` | array | yes | 1–6 entries, each a URL string or `{ "url": "…" }`. Duplicates and blanks dropped. `type` (`image`/`video`) inferred from the extension (`.mp4 .mov .webm .m4v .avi` = video). Images can be uploaded via `POST /api/upload`. |
| `fault_type` | string | no | `vendor_fault` \| `customer_fault` \| `undetermined`. Default derived from `reason`. |

Example body:
```json
{
  "order_id": "66f1c2a9e4b0a1b2c3d4e5f6",
  "items": [
    {
      "order_item_id": "66f1c2a9e4b0a1b2c3d4e5f7",
      "quantity_returning": 1
    }
  ],
  "reason": "defective",
  "reason_details": "One pad is cracked",
  "evidence": [
    "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg"
  ]
}
```

**Response `201`:**
```json
{
  "success": true,
  "return_request": {
    "_id": "66f1e0a1e4b0a1b2c3d4ea00",
    "return_number": "RET-9F3A1C7B",
    "order_id": "66f1c2a9e4b0a1b2c3d4e5f6",
    "user_id": "66a01b2c3d4e5f6a7b8c9d0e",
    "vendor_id": "66b2c3d4e5f6a7b8c9d0e1f2",
    "sub_order_id": "66f1c2a9e4b0a1b2c3d4e5f8",
    "items": [
      {
        "_id": "66f1e0a1e4b0a1b2c3d4ea01",
        "order_item_id": "66f1c2a9e4b0a1b2c3d4e5f7",
        "product_id": "66d9a7b1c2d3e4f5a6b7c8d9",
        "product_title": "Front brake pads",
        "product_image": "/uploads/products/pads.webp",
        "variant_label": "Default",
        "quantity_purchased": 2,
        "quantity_returning": 1,
        "unit_price": 600
      }
    ],
    "reason": "defective",
    "reason_details": "One pad is cracked",
    "evidence": [{ "_id": "66f1…", "url": "/uploads/returns/crack.jpg", "type": "image", "uploaded_at": "2026-10-11T11:00:00.000Z" }],
    "status": "pending_vendor_review",
    "fault_type": "vendor_fault",
    "vendor_review": { "decision": null, "notes": "", "reviewed_at": null },
    "admin_review": { "decision": null, "notes": "", "reviewed_at": null, "reviewed_by": null },
    "refund_id": null,
    "return_window_deadline": "2026-10-20T14:00:00.000Z",
    "history": [{ "action": "return_created", "title": "Return request created", "actor_role": "user", "actor_label": "Customer", "created_at": "2026-10-11T11:00:00.000Z" }],
    "created_at": "2026-10-11T11:00:00.000Z",
    "updated_at": "2026-10-11T11:00:00.000Z"
  }
}
```
The whole return document is returned. Items also carry `commission_rate` / `commission_amount`.

**Errors:** `{ "success": false, "message": "…", "code": "…" }`
- `400` — `ORDER_NOT_ELIGIBLE` (parcel not delivered, or the parcel could not be determined); `RETURN_WINDOW_EXPIRED`; `EVIDENCE_REQUIRED`; `MULTI_VENDOR_RETURN`; `INVALID_ITEMS` (unknown item, item not approved, quantity too high, no items).
- `404` — `ORDER_NOT_FOUND` (missing, or not the caller's).
- `409` — `ITEM_ALREADY_RETURNED`.
- `500` — `TOO_MUCH_EVIDENCE` (> 6) and `MULTI_PARCEL_RETURN` (items from two parcels) arrive as 500 because the route does not map them. So do an invalid `reason` and a malformed `order_id` (no `code`).

#### `GET /api/returns`
The customer's return requests, newest first.

- **Auth:** User

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | integer | no | Default 1. |
| `limit` | integer | no | Default 20 (no maximum enforced). |
| `status` | string | no | Any return status (see [Appendix A](#returns-1)). |

**Response `200`:**
```json
{
  "success": true,
  "returns": [
    {
      "_id": "66f1e0a1e4b0a1b2c3d4ea00",
      "return_number": "RET-9F3A1C7B",
      "order_id": "66f1c2a9e4b0a1b2c3d4e5f6",
      "vendor_id": { "_id": "66b2c3d4e5f6a7b8c9d0e1f2", "store_name": "Cairo Auto Parts" },
      "sub_order_id": "66f1c2a9e4b0a1b2c3d4e5f8",
      "items": [{ "order_item_id": "66f1c2a9e4b0a1b2c3d4e5f7", "product_title": "Front brake pads", "quantity_returning": 1, "unit_price": 600 }],
      "reason": "defective",
      "status": "pending_vendor_review",
      "return_window_deadline": "2026-10-20T14:00:00.000Z",
      "created_at": "2026-10-11T11:00:00.000Z"
    }
  ],
  "pagination": { "total": 1, "page": 1, "pages": 1, "limit": 20 }
}
```
Each entry is the full return document (trimmed here), with `vendor_id` populated to `{ _id, store_name }`.

**Errors:**
- `500` — server error.

#### `GET /api/returns/:id`
The customer opens one return request.

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | Return request id. |

**Response `200`:**
```json
{
  "success": true,
  "return_request": {
    "_id": "66f1e0a1e4b0a1b2c3d4ea00",
    "return_number": "RET-9F3A1C7B",
    "user_id": { "_id": "66a01b2c3d4e5f6a7b8c9d0e", "name": "Ahmed Ali", "email": null, "phone": "01012345678" },
    "vendor_id": { "_id": "66b2c3d4e5f6a7b8c9d0e1f2", "store_name": "Cairo Auto Parts", "email": "store@example.com", "phone": "01000000000" },
    "status": "approved",
    "items": [{ "product_title": "Front brake pads", "quantity_returning": 1, "unit_price": 600 }],
    "return_shipment": { "bosta_tracking_number": "7234561", "bosta_status": "Picked up", "tracking_history": [] },
    "original_payment_method": "cash",
    "default_refund_method": "store_credit"
  }
}
```
- The full return document, plus `original_payment_method` (the order's `transaction.payment_method`) and `default_refund_method`: `store_credit` (wallet orders; cash orders when the wallet is live), `original_payment` (card), `bank_transfer` (cash when the wallet is off, or bank transfer), `company_account`.

**Errors:**
- `404` — `{ "success": false, "message": "Return request not found" }` (missing or not the caller's).
- `500` — malformed id.

#### `POST /api/returns/:id/cancel`
The customer withdraws a return request. This is only possible while it is still `pending_vendor_review`. The items go back to `return_status: "none"` and the order status is re-derived.

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | Return request id. |

**Response `200`:**
```json
{
  "success": true,
  "return_request": { "_id": "66f1e0a1e4b0a1b2c3d4ea00", "return_number": "RET-9F3A1C7B", "status": "cancelled", "updated_at": "2026-10-11T12:00:00.000Z" }
}
```
The full return document is returned (trimmed).

**Errors:** `{ "success": false, "message": "…", "code": "…" }`
- `400` — `INVALID_RETURN_STATUS` (`Return can only be cancelled while pending vendor review`).
- `404` — `NOT_FOUND` (missing or not the caller's).
- `500` — malformed id.

#### `GET /api/returns/:id/tracking`
The customer checks where the returned goods are once a return courier is booked.

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ObjectId | yes | Return request id. |

**Response `200`:**
```json
{
  "success": true,
  "return_number": "RET-9F3A1C7B",
  "status": "return_shipping",
  "return_shipment": {
    "bosta_delivery_id": "65abc…",
    "bosta_tracking_number": "7234561",
    "bosta_status": "In transit",
    "pickup_address": { "address": "12 Tahrir St, Dokki", "city": "Giza", "zone": "Dokki" },
    "dropoff_address": { "address": "Nasr City branch", "city": "Cairo", "zone": "Nasr City", "district": "" },
    "sent_at": "2026-10-12T09:00:00.000Z",
    "received_at": null,
    "last_tracked_at": "2026-10-12T15:00:00.000Z",
    "tracking_history": [{ "state": "Picked up", "timestamp": "2026-10-12T11:00:00.000Z", "notes": "" }],
    "error": null
  }
}
```
`return_shipment` is `null` until a return shipment exists.

**Errors:**
- `404` — `Return request not found`.
- `500` — malformed id.

### Reviews

Reviews are verified-purchase only and moderated. A customer reviews through a **single-use invite token**: one invite per delivered parcel. The token arrives in a WhatsApp link `https://readycar.store/review/<token>`. A signed-in customer can also get a fresh token from `POST /api/users/orders/:id/parcels/:subOrderId/review-link`, which is documented with the account/orders endpoints. The invite routes need no login: the token is the credential. Everything submitted is stored as `pending` and appears publicly only after an admin approves it. Product reviews and store (vendor) reviews are separate: `target_type` `product` | `vendor`.

#### `GET /api/reviews/product/:productId`
Approved reviews and the star summary for a product page, newest first.

- **Auth:** Public

**Path params / Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `productId` (path) | ObjectId | Yes | An invalid id returns an empty result, not an error. |
| `page` (query) | integer | No | Default `1`, minimum 1. |
| `limit` (query) | integer | No | Default `10`, clamped to 1–50. |

**Response `200`:**
```json
{
  "reviews": [
    {
      "rating": 5,
      "comment": "مطابق للوصف والتغليف ممتاز",
      "images": ["https://readycar.store/uploads/reviews/review-1791400000000-123456789.jpg"],
      "author": "Ahmed",
      "created_at": "2026-10-05T14:22:10.000Z",
      "verified_purchase": true
    }
  ],
  "summary": { "rating": 4.67, "count": 3, "breakdown": { "1": 0, "2": 0, "3": 0, "4": 1, "5": 2 } },
  "pagination": { "page": 1, "limit": 10, "total": 3, "pages": 1 }
}
```
- `author` is the first word of the reviewer account's **current** name. It is `"عميل"` ("customer") when the account was deleted or no name is known.
- The reviewer's account id is never returned.
- For an invalid `productId` the shape is `{reviews: [], summary: {rating: 0, count: 0, breakdown: {}}, pagination: {page: 1, pages: 0, total: 0}}`.

**Errors:**
- `400` — `{code: "REVIEW_ERROR", message}` on an unexpected failure (this router maps every uncoded error to 400).

#### `GET /api/reviews/vendor/:vendorId`
Approved **store** reviews (packing, speed, service) for a store page. Same shape as the product feed. Product reviews are not included.

- **Auth:** Public

**Path params / Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `vendorId` (path) | ObjectId | Yes | Seller `_id`. An invalid id returns an empty result. |
| `page` (query) | integer | No | Default `1`. |
| `limit` (query) | integer | No | Default `10`, clamped to 1–50. |

**Response `200`:** identical shape to `GET /api/reviews/product/:productId`.

**Errors:**
- `400` — `{code: "REVIEW_ERROR", message}` on an unexpected failure.

#### `GET /api/reviews/invite/:token`
Opens the review form. It returns the parcel's products and stores to rate, prefilled with anything the customer already submitted for this order. It deliberately exposes no address, totals or payment data.

- **Auth:** Public (the token is the credential)
- **Rate limit:** 30 requests per minute per IP.

**Path params**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | string | Yes | Raw token from the review link. |

**Response `200`:**
```json
{
  "reference": "REF-A3F9-1",
  "customer_name": "Ahmed Mohamed",
  "delivered_at": "2026-10-04T11:30:00.000Z",
  "expires_at": "2026-10-18T11:30:00.000Z",
  "max_images": 3,
  "items": [
    {
      "product_id": "6ac60cc079bcca7bf9036f53",
      "vendor_id": "6a4cc23b09b828853234f32a",
      "title": "KOR-TEC CV Skoda A5 (outer) made in Malaysia",
      "image": "https://readycar.store/uploads/products/product-1791364697313-727922615.jpg",
      "variant_label": "",
      "rating": 0,
      "comment": "",
      "images": []
    }
  ],
  "vendors": [
    {
      "vendor_id": "6a4cc23b09b828853234f32a",
      "store_name": "El Bhrawy motors",
      "store_username": "el bhrawy",
      "store_image": "/uploads/store-images/store-6a4cc23b09b828853234f32a-1791197453336.jpeg",
      "rating": 0,
      "comment": "",
      "images": []
    }
  ]
}
```
- `reference` is the parcel reference. It falls back to the order reference, then to the order id.
- `items` has one entry per product. It excludes lines the vendor declined and lines that were returned or refunded.
- `rating: 0` means not yet rated.
- `customer_name` is the delivery recipient's name.

**Errors:**
- `404` — `{code: "INVITE_NOT_FOUND", message}`: unknown token, or the order is gone.
- `409` — `{code: "INVITE_ALREADY_USED", message: "You have already reviewed this order. Thank you!"}`.
- `410` — `{code: "INVITE_EXPIRED", message: "This review link has expired"}`.
- `429` — rate limited.

#### `POST /api/reviews/invite/:token/images`
Uploads photos for the review being written. The token is checked **before** any file is saved. Only URLs returned by this endpoint are accepted later in the submit call.

- **Auth:** Public (the token is the credential)
- **Rate limit:** 30 requests per hour per IP.

**Body:** `multipart/form-data`

| Field | Type | Required | Notes |
|---|---|---|---|
| `images` | file(s) | Yes | Up to 3 files per request. Max 5 MB each. Extension **and** MIME subtype must be `jpeg`, `jpg`, `png` or `webp`. |

**Response `200`:**
```json
{ "images": [ { "url": "https://readycar.store/uploads/reviews/review-1791400000000-123456789.jpg" } ] }
```

**Errors:**
- `400` — `{code: "UPLOAD_FAILED", message}`: wrong type (`"Images only (jpeg, jpg, png, webp)"`), over 5 MB (`"Each image must be 5MB or smaller"`), or more than 3 files.
- `400` — `{code: "NO_FILE", message: "No image uploaded"}`.
- `404` / `409` / `410` — invite errors, as for `GET /invite/:token`.
- `429` — rate limited.

#### `POST /api/reviews/invite/:token`
Submits the ratings. Each entry is upserted, keyed by order + target, so submitting again replaces earlier reviews and sends them back to moderation. The link stops working after a successful submit. Product ratings and store ratings both go in the same `reviews` array.

- **Auth:** Public (the token is the credential)
- **Rate limit:** 20 requests per hour per IP.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `reviews` | array | Yes | At least one valid entry. |
| `reviews[].target_type` | string | No | `vendor` for a store review. Anything else, or absent, means a product review. |
| `reviews[].product_id` | ObjectId | For product reviews | Must be one of the invite's `items[].product_id`. |
| `reviews[].vendor_id` | ObjectId | For store reviews | Must be one of the invite's `vendors[].vendor_id`. Ignored on product reviews: the server takes it from the order. |
| `reviews[].rating` | integer | Yes | 1–5. |
| `reviews[].comment` | string | No | Trimmed and cut to 1000 characters. |
| `reviews[].images` | array of string or `{url}` | No | At most 3 are kept. Any URL that is not a `/uploads/reviews/<file>` path from the upload endpoint is silently dropped, and so are duplicates. |

```json
{
  "reviews": [
    { "product_id": "6ac60cc079bcca7bf9036f53", "rating": 5, "comment": "مطابق للوصف", "images": ["https://readycar.store/uploads/reviews/review-1791400000000-123456789.jpg"] },
    { "target_type": "vendor", "vendor_id": "6a4cc23b09b828853234f32a", "rating": 4, "comment": "Fast shipping" }
  ]
}
```

**Response `200`:**
```json
{
  "message": "Thank you! Your review will appear once it has been checked.",
  "submitted": 2,
  "products": 1,
  "vendors": 1,
  "pending_moderation": true
}
```

**Errors:**
- `400` — `{code: "PRODUCT_NOT_IN_ORDER"}`: a product is not reviewable on this parcel. The whole request is rejected.
- `400` — `{code: "VENDOR_NOT_IN_ORDER"}`: a store is not part of this parcel.
- `400` — `{code: "INVALID_RATING", message: "Each rating must be between 1 and 5 stars"}`.
- `400` — `{code: "NO_RATINGS", message: "Rate at least one product"}`: `reviews` is empty or missing.
- `404` / `409` / `410` — invite errors, as for `GET /invite/:token`.
- `429` — rate limited.

---

## 8. Wallet and points

### Wallet

Mounted at `/api/users/wallet`. Store credit belongs to the session user only: no route takes a user id. Paying from the wallet happens through `POST /api/orders` with `payment_method: "wallet"`.

- The balance to show is `available` (equal to `spendable`). `reserved` is not used by checkout today.
- A `frozen` wallet can neither pay (`423 WALLET_FROZEN`) nor be topped up.
- Refunds of wallet orders go back to the wallet. Refunds of cash orders also go to the wallet while the wallet is switched on.

#### `GET /api/users/wallet`
The customer opens their wallet screen: balance, whether top-ups are possible, and the suggested top-up amounts. Creates an empty wallet account on first call.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Response `200`:**
```json
{
  "success": true,
  "enabled": true,
  "topup_enabled": true,
  "online_payment_enabled": true,
  "topup_suggestions": [100, 250, 500, 1000],
  "balances": {
    "available": 200,
    "reserved": 0,
    "spendable": 200,
    "currency": "EGP",
    "status": "active",
    "frozen_reason": "",
    "lifetime": { "topped_up": 500, "spent": 300, "refunded": 0 }
  }
}
```
- `enabled`: wallet checkout is live. `topup_enabled` is false when top-ups are switched off **or** the wallet is frozen. `online_payment_enabled` tells whether the card gateway is still offered at checkout (always true when the wallet is off). `balances.status`: `active` | `frozen`.

**Errors:**
- `403` — `GUEST_NOT_CONFIRMED`.
- `500` — `{ "success": false, "message": "…" }`.

#### `GET /api/users/wallet/transactions`
The customer's wallet statement, newest first.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | integer | no | Default 1. |
| `limit` | integer | no | Default 20, max 100. |
| `type` | string | no | `topup` \| `purchase` \| `purchase_refund` \| `refund_credit` \| `admin_credit` \| `admin_debit` (also `purchase_reserve`, `purchase_release`, unused by checkout today). |

**Response `200`:**
```json
{
  "success": true,
  "transactions": [
    {
      "_id": "66f1d0a1e4b0a1b2c3d4e800",
      "type": "purchase",
      "amount": 300,
      "currency": "EGP",
      "balance_after": 200,
      "reason": "Order paid from wallet",
      "actor": { "role": "system", "label": "System" },
      "created_at": "2026-10-10T18:22:00.000Z",
      "order": { "_id": "66f1…", "reference": "REF-7HQ2M9PL" }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 3, "pages": 1 }
}
```
`amount` is always positive. The direction comes from `type`. `order` is `null` for top-ups and adjustments.

**Errors:**
- `403` — `GUEST_NOT_CONFIRMED`.
- `500` — server error.

#### `GET /api/users/wallet/topups`
The customer's top-up attempts (paid or not), newest first. Personal top-ups only; company wallet top-ups are excluded.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | integer | no | Default 1. |
| `limit` | integer | no | Default 10, max 50. |

**Response `200`:**
```json
{
  "success": true,
  "topups": [
    {
      "_id": "66f1d1b2e4b0a1b2c3d4e810",
      "amount": 855,
      "currency": "EGP",
      "status": "pending",
      "payment_method": null,
      "payment_url": "https://app.fawaterk.com/invoice/1234569/ijkl",
      "created_at": "2026-10-11T09:58:00.000Z",
      "paid_at": null
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 1, "pages": 1 }
}
```
`payment_url` is only present while `status` is `pending` (so an unfinished top-up can be resumed). Otherwise it is `null`.

**Errors:**
- `403` — `GUEST_NOT_CONFIRMED`.
- `500` — server error.

#### `POST /api/users/wallet/topups`
The customer adds money to the wallet: a typed amount, or exactly the `shortfall` checkout reported. Creates a top-up record and a hosted payment, and returns its URL. Nothing is credited until confirmed. Abandoning it costs nothing.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `amount` | number | yes | EGP, > 0 (rounded to the piastre). |
| `origin` | string | no | `wallet` (default) \| `checkout` \| `friend_checkout` \| `family_request`. Unknown → `wallet`. |
| `return_path` | string | no | Relative path to come back to after paying (must start with a single `/`, no `://`). Invalid or missing → `/checkout` for `checkout`/`friend_checkout`, else `/profile?tab=wallet`. |

Example body:
```json
{
  "amount": 500,
  "origin": "wallet"
}
```

**Response `201`:**
```json
{
  "success": true,
  "paymentUrl": "https://app.fawaterk.com/invoice/1234569/ijkl",
  "topup": { "id": "66f1d1b2e4b0a1b2c3d4e810", "amount": 855, "currency": "EGP", "status": "pending" }
}
```
After paying, the provider returns to `${FRONTEND_URL}<return_path>?topup=<success|failed|pending>&topupId=<id>`. Then call `POST /api/users/wallet/topups/confirm`.

**Errors:** `{ "success": false, "code": "…", "message": "…" }`
- `400` — `INVALID_AMOUNT`; `PAYMENT_URL_MISSING` and gateway failures.
- `403` — `GUEST_NOT_CONFIRMED`.
- `404` — `USER_NOT_FOUND`.
- `409` — `TOPUP_DISABLED`.
- `423` — `WALLET_FROZEN`.

#### `POST /api/users/wallet/topups/confirm`
Called when the customer returns from the top-up payment page. **Call it every time.** The server re-reads the payment from the provider and credits the wallet exactly once. If the provider has not reported it paid yet, it answers `pending`. Safe to repeat: the second call reports "already credited". A daily sweep credits missed top-ups later as a backstop.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `topupId` | ObjectId | one of the two | `topup.id` from create (also `topupId` on the return URL). |
| `invoice_id` | string | one of the two | Provider invoice id. |

Example body:
```json
{
  "topupId": "66f1d1b2e4b0a1b2c3d4e810"
}
```

**Response `200`** (credited):
```json
{
  "success": true,
  "status": "paid",
  "message": "Wallet topped up successfully",
  "amount": 855,
  "balances": {
    "available": 1055,
    "reserved": 0,
    "spendable": 1055,
    "currency": "EGP",
    "status": "active",
    "frozen_reason": "",
    "lifetime": { "topped_up": 1355, "spent": 300, "refunded": 0 }
  }
}
```
The message is `"Top-up was already credited"` on a repeat call.

**Response `200`** (not paid yet):
```json
{ "success": true, "status": "pending", "message": "Top-up is not confirmed yet" }
```

**Errors:** `{ "success": false, "code": "…", "message": "…" }`
- `400` — `TOPUP_REFERENCE_REQUIRED`; provider read failure.
- `403` — `GUEST_NOT_CONFIRMED`.
- `404` — `TOPUP_NOT_FOUND`.

### Loyalty points

Mounted at `/api/users/loyalty`. Read-only for the customer. Points are spent through `redeem_points` on the checkout endpoints.

The admin sets the rules. Read the live values from `rules` in `GET /api/users/loyalty` (also in `GET /api/settings` → `settings.loyalty`); the numbers in the examples below are only examples.

- **Earning:** `floor(items_total / spend_per_point)` points, on the merchandise left after coupon and points. Shipping earns nothing. Points arrive as **pending** once the last parcel has stopped moving, and become available 14 days (the return window) after the last delivery, if no return is open. Points always go to the payer, also on orders for a friend or a family member.
- **Spending:** send `redeem_points` on the preview and the order. The server lowers it to the smallest of: the balance, and `floor(cap / point_value)`, where `cap` = merchandise after coupon × `max_redemption_percent`. Below `min_redeem_points` nothing is redeemed. The outcome comes back as `redeemed_points`, `discount` and `blocked_reason` (`REDEMPTION_DISABLED`, `COUPON_STACKING_DISABLED`, `BELOW_MINIMUM` or `null`).
- Cash and wallet orders spend the points at once. Card orders hold them until the payment is confirmed, and give them back if it fails or expires.

#### `GET /api/users/loyalty`
The customer opens "My points": balances, their money value, and the program rules.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Response `200`:**
```json
{
  "success": true,
  "enabled": true,
  "balances": {
    "available_points": 340,
    "pending_points": 41,
    "reserved_points": 0,
    "lifetime_earned_points": 520,
    "lifetime_redeemed_points": 180
  },
  "value": { "available": 170, "pending": 20.5, "reserved": 0, "currency": "EGP" },
  "rules": {
    "earning_enabled": true,
    "redemption_enabled": true,
    "spend_per_point": 25,
    "point_value": 0.5,
    "min_redeem_points": 1,
    "max_redemption_percent": 50,
    "allow_with_coupons": true,
    "points_expiry_days": null,
    "return_window_days": 14,
    "currency": "EGP"
  }
}
```
- `pending_points` are earned on delivered orders and still inside the return window. `reserved_points` are held by an open card payment. `value.*` = points × `point_value`.

**Errors:**
- `403` — `GUEST_NOT_CONFIRMED`.
- `500` — server error.

#### `GET /api/users/loyalty/transactions`
The customer's points history, newest first.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | integer | no | Default 1. |
| `limit` | integer | no | Default 20, max 100. |
| `type` | string | no | `earn_pending` \| `earn_release` \| `earn_reverse` \| `redeem_reserve` \| `redeem_release` \| `redeem_consume` \| `redeem_restore` \| `admin_credit` \| `admin_debit` \| `expire` (unused). |

**Response `200`:**
```json
{
  "success": true,
  "transactions": [
    {
      "_id": "66f1d2c3e4b0a1b2c3d4e900",
      "type": "redeem_consume",
      "points": 100,
      "monetary_value": 50,
      "balance_deltas": { "available": -100, "pending": 0, "reserved": 0 },
      "reason": "Points redeemed at checkout",
      "actor": { "role": "system", "label": "System" },
      "available_at": null,
      "created_at": "2026-10-11T10:00:00.000Z",
      "settings_snapshot": { "spend_per_point": 25, "point_value": 0.5, "currency": "EGP" },
      "order": { "_id": "66f1c2a9e4b0a1b2c3d4e5f6", "reference": "REF-K3J9QX2A", "total_price": 1055 }
    }
  ],
  "pagination": { "total": 7, "page": 1, "limit": 20, "pages": 1 }
}
```
`points` is always positive. The effect is in `balance_deltas`. `available_at` is set on `earn_pending` rows (when they become spendable).

**Errors:**
- `403` — `GUEST_NOT_CONFIRMED`.
- `500` — server error.

---

## 9. Family

A family has one **organizer** and any number of **members**. Members never use their own addresses: they order to the organizer addresses the organizer shares with them, and the organizer approves and pays.

- A customer can be in only one family at a time, in either role. The family is created when the organizer sends the first invitation. The organizer cannot leave; they remove members instead.
- At most 20 pending invitations per family. `relationship` is a label only and gives no extra rights.
- Invitations expire after **7 days**. Resending gives a new link, and earlier links stop working.
- An email invitation links to `https://readycar.store/family/invitation/<token>`. A phone invitation goes by WhatsApp and links to `https://readycar.store/invite/<token>`. A number with no account gets a placeholder account.
- Accepting, declining or cancelling an invitation destroys its token. After that, opening the link returns `404 INVITATION_NOT_FOUND`.
- An order request is **not** an order. No order or payment exists until the organizer pays. A request expires **48 hours** after it is sent, and the clock restarts when the organizer approves.

### Family group

#### `GET /api/users/family`
Loads the Family tab. The response depends on the caller's role. Pending invitations past their expiry are marked `expired` first. A customer in no family gets `{ "role": null, "family": null }`.

- **Auth:** User

**Response `200` (organizer):**
```json
{
  "role": "organizer",
  "family": { "_id": "66f1a…", "name": "Ahmed Ali's family", "status": "active" },
  "organizer": { "_id": "66e0b…", "name": "Ahmed Ali", "email": "ahmed@example.com", "profile_image": null },
  "addresses": [
    { "_id": "66e0c…", "label": "Home", "recipient_name": "Ahmed Ali", "phone": "01012345678", "full_address": "12 Tahrir St, Dokki", "shipping_country": "Egypt", "shipping_city": "Giza" }
  ],
  "members": [
    {
      "_id": "66f2d…",
      "user": { "_id": "66e9f…", "name": "Omar Ahmed", "email": "omar@example.com", "profile_image": null },
      "relationship": "son",
      "shared_address_ids": ["66e0c…"],
      "joined_at": "2026-09-20T10:12:00.000Z"
    }
  ],
  "invitations": [
    { "_id": "66f3a…", "email": "sara@example.com", "relationship": "daughter", "shared_address_ids": [], "created_at": "2026-10-01T08:00:00.000Z", "last_sent_at": "2026-10-01T08:00:00.000Z", "expires_at": "2026-10-08T08:00:00.000Z" }
  ]
}
```
`members[]._id` is the **membership** id. The member endpoints below take this id as `:memberId`. Each `invitations[]` item has `email` but no `phone` or `channel`, so a WhatsApp invitation shows `email: null`.

**Response `200` (member):**
```json
{
  "role": "member",
  "family": { "_id": "66f1a…", "name": "Ahmed Ali's family", "status": "active" },
  "organizer": { "_id": "66e0b…", "name": "Ahmed Ali", "email": "ahmed@example.com", "profile_image": null },
  "membership": { "_id": "66f2d…", "relationship": "son", "joined_at": "2026-09-20T10:12:00.000Z" },
  "shared_addresses": [
    { "_id": "66e0c…", "label": "Home", "recipient_name": "Ahmed Ali", "phone": "01012345678", "full_address": "12 Tahrir St, Dokki", "shipping_country": "Egypt", "shipping_city": "Giza" }
  ]
}
```

#### `GET /api/users/family/shared-addresses`
The organizer addresses a member may pick at family checkout. They are read from the organizer's live address book, filtered by this member's permission. A caller who is not a member (no family, or the organizer) gets `{ "organizer": null, "addresses": [] }`.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Response `200`:**
```json
{
  "organizer": { "_id": "66e0b…", "name": "Ahmed Ali", "profile_image": null },
  "relationship": "son",
  "addresses": [
    { "_id": "66e0c…", "label": "Home", "recipient_name": "Ahmed Ali", "phone": "01012345678", "full_address": "12 Tahrir St, Dokki", "shipping_country": "Egypt", "shipping_city": "Giza" }
  ]
}
```
`organizer` has no `email` key here, because this lookup does not select the email field.

#### `POST /api/users/family/invitations`
The organizer invites someone by email or Egyptian mobile number. If the caller is in no family yet, a family is created with them as organizer.
- An email gets an invitation email.
- A phone number gets a WhatsApp message. A number with no account first gets a placeholder guest account.
- If the invitee's account has the other channel too, a best-effort copy goes there.

The invitation expires after 7 days. A family can have at most 20 pending invitations.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)
- **Rate limit:** 20 per hour per user

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `identifier` | string | one of these two | Email or Egyptian mobile. Takes precedence over `email`. |
| `email` | string | one of these two | Legacy name for the identifier; may also hold a phone number. |
| `relationship` | string | no | `son, daughter, husband, wife, parent, sibling, other`. Unknown values become `other`. |
| `shared_address_ids` | string[] | no | Ids of the organizer's own addresses to share. Every id must belong to the caller. |
| `language` | `'ar'` \| `'en'` | no | Language of the invitation message. May also be sent as a query param. Default `en`. |

Example body:
```json
{
  "identifier": "01098765432",
  "relationship": "daughter",
  "shared_address_ids": [
    "66e0c1a2b3c4d5e6f7a8b9c0"
  ],
  "language": "ar"
}
```

**Response `201`:**
```json
{
  "message": "Invitation sent. We will let you know when they join.",
  "invitation": {
    "_id": "66f3a…",
    "email": null,
    "phone": "01098765432",
    "channel": "whatsapp",
    "identifier_masked": "*******5432",
    "relationship": "daughter",
    "shared_address_ids": ["66e0c…"],
    "created_at": "2026-10-11T09:00:00.000Z",
    "last_sent_at": "2026-10-11T09:00:00.000Z",
    "expires_at": "2026-10-18T09:00:00.000Z"
  }
}
```

**Errors:**
- `400` — not a valid email or Egyptian mobile (`INVALID_IDENTIFIER`); the identifier is the caller's own (`CANNOT_INVITE_SELF`); an address id is not the caller's (`ADDRESS_NOT_OWNED`)
- `404` — caller account not found (`USER_NOT_FOUND`)
- `409` — caller is a *member* of another family (`ALREADY_IN_FAMILY`); invitee is already in this family (`ALREADY_MEMBER`); an invitation to this identifier is already pending (`INVITATION_EXISTS`)
- `429` — 20 invitations already pending (`PENDING_INVITE_LIMIT`); limiter hit (`RATE_LIMITED`)
- `502` — the WhatsApp or email send failed (`INVITE_DELIVERY_FAILED` / `EMAIL_DELIVERY_FAILED`). The invitation is deleted.
- `503` — the WhatsApp template is not configured (`INVITE_DELIVERY_UNAVAILABLE`)

#### `POST /api/users/family/invitations/:id/resend`
The organizer re-sends a pending invitation on the channel it first went out on, plus the other channel when the invitee has it. The token is replaced, so earlier links stop working, and `expires_at` becomes now + 7 days.

- **Auth:** User
- **Rate limit:** 20 per hour per user

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | ObjectId | yes | Invitation id from `GET /api/users/family`. |

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `language` | `'ar'` \| `'en'` | no | Message language. Default `en`. |

**Response `200`:**
```json
{
  "message": "Invitation sent again.",
  "invitation": { "_id": "66f3a…", "expires_at": "2026-10-18T09:00:00.000Z", "last_sent_at": "2026-10-11T09:00:00.000Z" }
}
```

**Errors:**
- `403` — caller is not an organizer (`NOT_ORGANIZER`)
- `404` — not an invitation of this family (`INVITATION_NOT_FOUND`)
- `409` — invitation is no longer `pending`, including once it has been marked `expired` (`INVITATION_NOT_PENDING`)
- `503` — WhatsApp not configured (`INVITE_DELIVERY_UNAVAILABLE`)
- `400` — an email send failure surfaces as `FAMILY_ERROR` (no status set)

#### `DELETE /api/users/family/invitations/:id`
The organizer cancels a pending invitation. The token is burned, so a landing page that is already open can no longer accept it.

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | ObjectId | yes | Invitation id. |

**Response `200`:**
```json
{ "message": "Invitation cancelled.", "invitation": { "_id": "66f3a…", "status": "revoked" } }
```

**Errors:**
- `403` — `NOT_ORGANIZER`
- `404` — `INVITATION_NOT_FOUND`
- `409` — `INVITATION_NOT_PENDING`

#### `PUT /api/users/family/members/:memberId/addresses`
The organizer replaces the set of their addresses a member may use. The member gets an in-app `family_address_access_changed` notification (a count only, no address text).

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `memberId` | ObjectId | yes | **Membership** id (`members[]._id`), not the user id. |

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `shared_address_ids` | string[] | no | Full replacement list. Omitted or `[]` unshares everything. |

**Response `200`:**
```json
{ "message": "Shared addresses updated.", "shared_address_ids": ["66e0c…"] }
```

**Errors:**
- `400` — an id is not one of the organizer's addresses (`ADDRESS_NOT_OWNED`)
- `403` — `NOT_ORGANIZER`
- `404` — not an active member of this family (`MEMBER_NOT_FOUND`)

#### `DELETE /api/users/family/members/:memberId`
The organizer removes a member. The member loses address access at once. Their unpaid requests (`pending_approval`, `approved_payment_needed`) become `withdrawn`; requests already converted to orders are kept. The member gets an in-app `family_member_removed` notification.

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `memberId` | ObjectId | yes | Membership id. |

**Response `200`:**
```json
{ "message": "Family member removed.", "removed": true, "cancelled_requests": 1 }
```

**Errors:**
- `403` — `NOT_ORGANIZER`
- `404` — `MEMBER_NOT_FOUND`

#### `POST /api/users/family/leave`
A member leaves their family. Address access and open requests end the same way as on removal. The organizer gets an in-app `family_member_left` notification.

- **Auth:** User

**Response `200`:**
```json
{ "message": "You left the family.", "left": true, "cancelled_requests": 0 }
```

**Errors:**
- `403` — caller is in no family (`NOT_FAMILY_MEMBER`)
- `409` — caller is the organizer (`ORGANIZER_CANNOT_LEAVE`)

### Family order requests

#### `POST /api/users/family/order-requests`
A member sends their cart (or a buy-now item) to the organizer for approval. This creates **no** order and **no** payment. The server prices every line itself and ignores totals sent by the client. Coupon eligibility is checked against the member here, as an estimate only.
- The submitted lines are removed from the member's cart, unless `checkout_source` is `'buy_now'`.
- The organizer gets an in-app `family_order_request_received` notification and an email.
- The request expires after `FAMILY_REQUEST_EXPIRY_HOURS` (default 48 h).

- **Auth:** User
- **Rate limit:** 30 per 10 minutes per user

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `items` | object[] | yes | Cart-shaped lines: `{product_id, variant_id?, quantity}` or `{bundle_id, quantity}`. Nested `product._id` / `bundle._id` / `variant._id` are also accepted. |
| `organizer_address_id` | ObjectId | yes | Must be an organizer address currently shared with the member. |
| `shipping_method_id` | string | when methods exist | Must be one of the methods quoted for the address. Required whenever the destination has a country and at least one method is offered. |
| `shipping_destination` | object | no | `{country, city}` fallback, used only when the address has no `shipping_country` / `shipping_city`. |
| `coupon_code` | string | no | Re-checked against the organizer before payment. |
| `member_note` | string | no | Cut to 200 characters. |
| `checkout_source` | string | no | `'buy_now'` leaves the member's cart untouched. |

Example body:
```json
{
  "items": [
    {
      "product_id": "66d9a7b1c2d3e4f5a6b7c8d9",
      "quantity": 2
    }
  ],
  "organizer_address_id": "66e0c1a2b3c4d5e6f7a8b9c0",
  "shipping_method_id": "65f0a1b2c3d4e5f6a7b8c9d0",
  "member_note": "For the Corolla"
}
```

**Response `201`:**
```json
{
  "request": {
    "_id": "6701a…",
    "status": "pending_approval",
    "family_id": "66f1a…",
    "organizer": null,
    "requester": null,
    "items": [
      { "_id": "6701b…", "product_id": "65aa…", "variant_id": null, "bundle_id": null, "quantity": 2, "title": "Brake pads – front", "image": "/uploads/products/pads.webp", "variant_label": "", "estimated_unit_price": 450, "removed_at_approval": false }
    ],
    "shipping_address": { "recipient_name": "Ahmed Ali", "phone": "01012345678", "full_address": "12 Tahrir St, Dokki", "label": "Home" },
    "organizer_address_id": "66e0c…",
    "shipping_destination": { "country": "Egypt", "city": "Giza" },
    "shipping_method_id": "65f0…",
    "shipping_method": { "id": "65f0…", "name": "Standard", "name_ar": "عادي", "total_cost": 60 },
    "coupon_code": "",
    "estimated_subtotal": 900,
    "estimated_discount": 0,
    "estimated_shipping": 60,
    "estimated_total": 960,
    "member_note": "For the Corolla",
    "decline_reason": "",
    "decline_note": "",
    "converted_order_id": null,
    "expires_at": "2026-10-13T09:00:00.000Z",
    "approved_at": null,
    "declined_at": null,
    "withdrawn_at": null,
    "created_at": "2026-10-11T09:00:00.000Z"
  }
}
```
This is the standard **request shape**. The other request endpoints return it too. On this endpoint `organizer` and `requester` are `null`; list and detail fill them as `{_id, name, profile_image}`.

**Errors:**
- `403` — caller is not a family member (`NOT_FAMILY_MEMBER`); the address is not shared with them (`ADDRESS_NOT_SHARED`)
- `400` — `items` empty (`EMPTY_REQUEST`); no valid shipping method chosen (`SHIPPING_METHOD_INVALID`); pricing failures such as an unavailable product or a bad quantity (`FAMILY_ERROR`, with the pricing message)
- `404` — organizer account gone (`OWNER_NOT_FOUND`)
- `409` — address missing or deleted (`ADDRESS_UNAVAILABLE`)

#### `GET /api/users/family/order-requests`
Lists up to 100 requests (newest first) where the caller is the organizer or the requester. They come split by side. Being party to a request is enough; no active membership is needed.

- **Auth:** User

**Query**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | string | no | Exact status filter. |

**Response `200`:**
```json
{
  "incoming": [
    { "_id": "6701a…", "status": "pending_approval", "organizer": { "_id": "66e0b…", "name": "Ahmed Ali", "profile_image": null }, "requester": { "_id": "66e9f…", "name": "Omar Ahmed", "profile_image": null }, "items": [], "estimated_total": 960, "expires_at": "2026-10-13T09:00:00.000Z", "created_at": "2026-10-11T09:00:00.000Z", "viewer_role": "organizer" }
  ],
  "outgoing": []
}
```
Each entry is the full request shape plus `viewer_role` (trimmed above). `incoming` holds the requests where the caller is the organizer; `outgoing` holds the ones the caller sent.

#### `GET /api/users/family/order-requests/:id`
Request detail for either party.
- For the organizer, while the status is `pending_approval` or `approved_payment_needed`, the request is also re-priced against the live catalogue. The organizer then gets `revalidation`, the payment methods on offer and their wallet standing.
- Once converted, both sides get a read-only `order` summary for tracking. It contains no payment or vendor data and only the recipient's name and city, not the full address.

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | ObjectId | yes | Request id. |

**Response `200` (organizer, pending):**
```json
{
  "request": { "_id": "6701a…", "status": "pending_approval", "estimated_total": 960 },
  "viewer_role": "organizer",
  "relationship": "son",
  "currency": "EGP",
  "revalidation": {
    "address": { "_id": "66e0c…", "label": "Home", "recipient_name": "Ahmed Ali", "phone": "01012345678", "full_address": "12 Tahrir St, Dokki" },
    "available_addresses": [
      { "_id": "66e0c…", "label": "Home", "recipient_name": "Ahmed Ali", "phone": "01012345678", "full_address": "12 Tahrir St, Dokki", "shipping_country": "Egypt", "shipping_city": "Giza", "is_default": true }
    ],
    "destination": { "country": "Egypt", "city": "Giza" },
    "available_methods": [
      { "id": "65f0…", "name": "Standard", "name_ar": "عادي", "type": "flat", "total_cost": 60, "eta_min": 2, "eta_max": 4, "adjustments": [], "policies_applied": [], "warnings": [], "per_vendor": [] }
    ],
    "selected_method": { "id": "65f0…", "name": "Standard", "total_cost": 60 },
    "shipping_available": true,
    "coupon_applied": false,
    "items": [
      { "item_id": "6701b…", "title": "Brake pads – front", "image": "/uploads/products/pads.webp", "variant_label": "", "quantity": 2, "requested_unit_price": 450, "current_unit_price": 470, "available": true, "unavailable_reason": "" }
    ],
    "requested": { "subtotal": 900, "discount": 0, "shipping": 60, "total": 960 },
    "current": { "subtotal": 940, "discount": 0, "shipping": 60, "total": 1000 },
    "changes": [
      { "type": "price_changed", "item_id": "6701b…", "title": "Brake pads – front", "requested": 450, "current": 470 },
      { "type": "total_changed", "requested": 960, "current": 1000 }
    ],
    "has_material_changes": true,
    "purchasable": true
  },
  "payment_methods": ["wallet", "credit_card"],
  "wallet": { "enabled": true, "available": 1200, "shortfall": 0, "sufficient": true, "status": "active", "currency": "EGP" }
}
```
- `changes[].type` is one of `item_unavailable`, `price_changed`, `coupon_invalid`, `shipping_unavailable`, `shipping_method_changed`, `shipping_cost_changed`, `total_changed`.
- When the wallet is off, `wallet` is `{ "enabled": false }`.
- If re-pricing throws, `revalidation` is `{ "error": "…", "code": "…" }` instead.
- Once converted, the response adds an `order` object: `{_id, reference, status, created_at, delivered_at, total_price, delivery_summary: {recipient_name, city, country}, items: [{product_title, product_image, variant_label, quantity, unit_price, return_status}], shipments: [{provider, tracking_number, bosta_tracking_number, bosta_status, tracking_history}]}`.

**Errors:**
- `404` — unknown id, or the caller is neither organizer nor requester (`REQUEST_NOT_FOUND`)

#### `POST /api/users/family/order-requests/:id/withdraw`
The member who sent the request withdraws it. This only works before payment starts (`pending_approval` or `approved_payment_needed`). The organizer gets an in-app `family_order_request_withdrawn` notification.

- **Auth:** User

**Response `200`:**
```json
{ "request": { "_id": "6701a…", "status": "withdrawn", "withdrawn_at": "2026-10-11T10:00:00.000Z" } }
```
The `request` object is the full request shape, trimmed here.

**Errors:**
- `403` — caller is the organizer, not the requester (`NOT_REQUESTER`)
- `404` — `REQUEST_NOT_FOUND`
- `409` — status does not allow withdrawing (`REQUEST_NOT_WITHDRAWABLE`)

#### `POST /api/users/family/order-requests/:id/decline`
The organizer declines a request in `pending_approval` or `approved_payment_needed`. The member gets an in-app `family_order_request_declined` notification and, if they have an email address, an email.

- **Auth:** User

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string | no | `too_expensive, wrong_products, wrong_address, order_later, other`. Unknown values become `other`. |
| `note` | string | no | Cut to 300 characters. |

**Response `200`:**
```json
{ "request": { "_id": "6701a…", "status": "declined", "decline_reason": "too_expensive", "decline_note": "Let's wait for the sale", "declined_at": "2026-10-11T10:00:00.000Z" } }
```

**Errors:**
- `403` — `NOT_ORGANIZER`
- `404` — `REQUEST_NOT_FOUND`
- `409` — already handled (`REQUEST_ALREADY_HANDLED`)

#### `POST /api/users/family/order-requests/:id/approve`
The organizer approves. The request moves to `approved_payment_needed` and the expiry window restarts. **No order is created.**
- The organizer may drop unavailable lines.
- If prices, availability or shipping changed since the request was sent, the organizer must re-send with `acknowledged_changes: true`.
- Approving a request that is already approved does nothing and returns it again.
- The member gets an in-app `family_order_request_approved` notification.

- **Auth:** User
- **Rate limit:** 20 per minute per user

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `remove_item_ids` | string[] | no | Request line `_id`s to mark `removed_at_approval`. |
| `acknowledged_changes` | boolean | no | Must be `true` when there are material changes. |

**Response `200`:**
```json
{
  "request": { "_id": "6701a…", "status": "approved_payment_needed", "approved_at": "2026-10-11T10:00:00.000Z", "expires_at": "2026-10-13T10:00:00.000Z" },
  "revalidation": { "current": { "subtotal": 940, "discount": 0, "shipping": 60, "total": 1000 }, "changes": [], "purchasable": true }
}
```
`revalidation` has the same shape as in the detail endpoint. When the request was already approved, the response is `{ request, alreadyApproved: true }`.

**Errors:**
- `403` — `NOT_ORGANIZER`
- `404` — `REQUEST_NOT_FOUND`
- `409`, one of:
  - not in `pending_approval` (`REQUEST_ALREADY_HANDLED`)
  - every line removed (`EMPTY_REQUEST`)
  - nothing purchasable left (`REQUEST_NOT_PURCHASABLE`)
  - changes not acknowledged (`CHANGES_NEED_ACKNOWLEDGEMENT`). The body carries `details: { changes, current }`.
  - organizer address deleted (`ADDRESS_UNAVAILABLE`)
- `410` — window passed. The request is marked `expired` (`REQUEST_EXPIRED`).

#### `GET /api/users/family/order-requests/:id/checkout-preview`
Data for the organizer's checkout screen. The request is re-priced against the live catalogue, optionally with a different address or shipping method.

- **Auth:** User

**Query**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `address_id` | ObjectId | no | Any of the organizer's own addresses. Defaults to the address the member chose. |
| `shipping_method_id` | string | no | Defaults to the request's method. If that method is gone, the cheapest offered one is used. |

**Response `200`:**
```json
{
  "request": { "_id": "6701a…", "status": "approved_payment_needed", "requester": { "_id": "66e9f…", "name": "Omar Ahmed", "profile_image": null } },
  "revalidation": { "current": { "subtotal": 940, "discount": 0, "shipping": 60, "total": 1000 }, "purchasable": true },
  "payment_methods": ["wallet", "credit_card"],
  "wallet": { "enabled": true, "available": 1200, "shortfall": 0, "sufficient": true, "status": "active", "currency": "EGP" },
  "requester": { "name": "Omar Ahmed", "profile_image": null },
  "relationship": "son",
  "relationship_label": { "en": "son", "ar": "ابن" },
  "currency": "EGP"
}
```
For a request that is already converted, the response is `{ request, already_placed: true }`.

**Errors:**
- `403` — `NOT_ORGANIZER`
- `404` — `REQUEST_NOT_FOUND`
- `409` — status is not `approved_payment_needed` or `payment_in_progress` (`REQUEST_NOT_PAYABLE`); chosen address missing (`ADDRESS_UNAVAILABLE`)

#### `POST /api/users/family/order-requests/:id/place-cod`
The organizer pays cash on delivery. This creates exactly one real order on the organizer's account at once (`checkout_source: 'family_request'`). Repeat clicks return the existing order; if two calls race, the losing order is discarded. Both sides get an in-app `family_order_placed` notification.

- **Auth:** User
- **Rate limit:** 10 per minute per user

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `address_id` | ObjectId | no | Override delivery address (organizer's own). |
| `shipping_method_id` | string | no | Override shipping method. |

**Response `201`:**
```json
{
  "success": true,
  "message": "Order placed successfully.",
  "order_id": "6702c…",
  "order": { "_id": "6702c…", "total_price": 1000, "status": "pending" },
  "request": { "_id": "6701a…", "status": "order_placed", "converted_order_id": "6702c…" }
}
```
`order` is the full Order document. When the request was already placed, the response is **`200`** `{ success: true, message: "This request was already placed.", order_id, alreadyPlaced: true }`.

**Errors:**
- `403` — `NOT_ORGANIZER`
- `404` — `REQUEST_NOT_FOUND`
- `409` — not in `approved_payment_needed` (`REQUEST_NOT_PAYABLE`); not purchasable (`REQUEST_NOT_PURCHASABLE`)
- `410` — `REQUEST_EXPIRED`
- `400` — COD not allowed for this account or delivery phone, and other order-placement failures (`FAMILY_ERROR`)

#### `POST /api/users/family/order-requests/:id/create-payment`
The organizer pays online. With `payment_method: 'wallet'` the order is created and paid from the wallet at once. Otherwise a hosted invoice is opened, the request moves to `payment_in_progress`, and **no order** exists until the payment is confirmed. The invoice is billed to the organizer.

- **Auth:** User
- **Rate limit:** 10 per minute per user

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `payment_method` | `'wallet'` \| `'credit_card'` | no | Defaults to `wallet` when the wallet is enabled, otherwise `credit_card`. Any value other than `wallet` takes the hosted-invoice path. |
| `address_id` | ObjectId | no | Override delivery address. |
| `shipping_method_id` | string | no | Override shipping method. |

Example body:
```json
{
  "payment_method": "credit_card"
}
```

**Response `201` (card):**
```json
{
  "success": true,
  "requiresPayment": true,
  "paymentUrl": "https://…/invoice/…",
  "payment": { "id": "6702d…", "status": "pending", "invoiceId": "123456" }
}
```

**Response `201` (wallet):**
```json
{ "success": true, "requiresPayment": false, "order_id": "6702c…", "order": { "_id": "6702c…" }, "request": { "_id": "6701a…", "status": "order_placed" } }
```
When the request was already placed, the response is `200` `{ success: true, alreadyPlaced: true, order_id }`.

**Errors:**
- `402` — wallet balance too low (`INSUFFICIENT_BALANCE`)
- `423` — wallet frozen (`WALLET_FROZEN`)
- `403` — `NOT_ORGANIZER`
- `404` — `REQUEST_NOT_FOUND`
- `409`, one of:
  - `REQUEST_NOT_PAYABLE`
  - `REQUEST_NOT_PURCHASABLE`
  - wallet chosen but off (`WALLET_DISABLED`)
  - card chosen but online payment switched off (`ONLINE_PAYMENT_DISABLED`)
- `410` — `REQUEST_EXPIRED`
- `400` — gateway failures, such as a missing payment URL (`PAYMENT_URL_MISSING`) or others (`FAMILY_ERROR`)

#### `POST /api/users/family/order-requests/:id/confirm-payment`
Called after the payment provider sends the browser back. The payment is re-read from the provider. If paid, the order is created exactly once, and repeat calls return the same order. **If the provider does not report the payment as paid yet**, the request goes back to `approved_payment_needed`, and the organizer gets an in-app `family_order_payment_failed` notification ("Payment did not complete").

- **Auth:** User (the request's organizer only)

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `paymentId` | ObjectId | one of these two | `paymentId` from the return URL. |
| `invoice_id` | string | one of these two | Provider invoice id. |

Example body:
```json
{
  "paymentId": "6702d1a2b3c4d5e6f7a8b9c0"
}
```

**Response `200` (paid):**
```json
{ "success": true, "status": "paid", "order_id": "6702c…", "request_status": "order_placed" }
```
Other `200` responses:
- Request already converted: `{ success: true, status: "paid", alreadyPaid: true, order_id }`.
- Not settled: `{ success: true, status: "pending", message: "Payment is not confirmed yet" }`.

**Errors:**
- `404` — not a request of this organizer (`REQUEST_NOT_FOUND`)
- `400` — neither reference sent (`PAYMENT_REFERENCE_REQUIRED`); no such payment for this user (`PAYMENT_NOT_FOUND`); invoice id does not match the payment (`INVOICE_MISMATCH`)

#### `POST /api/users/family/order-requests/:id/payment-failed`
Called when the provider redirect reports a failed or abandoned payment. If the request is in `payment_in_progress`, it goes back to `approved_payment_needed` and the organizer gets `family_order_payment_failed`. It never creates or cancels an order.

- **Auth:** User (the request's organizer only)

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string | no | Appended to the notification text. |

**Response `200`:**
```json
{ "success": true, "status": "approved_payment_needed", "order_id": null }
```

**Errors:**
- `404` — `REQUEST_NOT_FOUND`

### Family invitation links

The token is the raw 64-hex-character value from the invitation link, passed as the `:token` path segment. Opening the link never accepts the invitation.

#### `GET /api/family-invitations/:token`
Preview for the invitation landing page. It shows only the organizer, relationship, expiry and the invited email (or a masked phone), never addresses or members. If a customer session is present it is read, to tell whether the signed-in email matches. A vendor or admin session is ignored.

- **Auth:** Public (reads a customer session if one is present)
- **Rate limit:** 30 per minute per IP

**Response `200`:**
```json
{
  "invitation": {
    "email": "sara@example.com",
    "phone_masked": null,
    "channel": "email",
    "relationship": "daughter",
    "expires_at": "2026-10-18T09:00:00.000Z",
    "shared_address_count": 1
  },
  "organizer": { "name": "Ahmed Ali", "profile_image": null },
  "invited_account_exists": false,
  "signed_in_email_matches": null,
  "needs_account_setup": false
}
```
- For a WhatsApp invitation, `email` is `null`, `phone_masked` is set (e.g. `"*******5432"`) and `signed_in_email_matches` is always `null`.
- `needs_account_setup: true` means the invited number's account is still an unclaimed placeholder, so the page must also ask for a name.

**Errors:**
- `404` — unknown token, or one already used, declined or revoked (all burned) (`INVITATION_NOT_FOUND`)
- `410` — `INVITATION_EXPIRED`; family dissolved (`FAMILY_UNAVAILABLE`)

#### `POST /api/family-invitations/:token/accept`
Accept with the signed-in customer account. For an email invitation, the account's email must equal the invited one. For a WhatsApp invitation, the account must be the one the number resolves to. The organizer gets an in-app `family_invitation_accepted` notification.

- **Auth:** User (cookie read through `optionalUser`; no session → 401 `SIGN_IN_REQUIRED`)
- **Rate limit:** 20 per 10 minutes per IP

**Response `200`:**
```json
{ "joined": true }
```

**Errors:**
- `401` — no customer session (`SIGN_IN_REQUIRED`). A vendor session counts as no session.
- `403` — an `admin_token` cookie is present (`STAFF_SESSION`); wrong email (`EMAIL_MISMATCH`); wrong account for a WhatsApp invitation (`ACCOUNT_MISMATCH`)
- `409` — account already in a family (`ALREADY_IN_FAMILY`)
- `404` — `INVITATION_NOT_FOUND`
- `410` — `INVITATION_EXPIRED`

#### `POST /api/family-invitations/:token/accept-with-registration`
Accept an **email** invitation by creating a new account for the invited address. The link counts as proof of the mailbox, so no verification email is sent. The account is created, joined to the family and signed in: the response sets the `token` cookie, a browser-session cookie holding a 1-day JWT. Friend invitations waiting for this email are converted.

- **Auth:** Public
- **Rate limit:** 10 per hour per IP

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Full name. |
| `phone` | string | yes | Must pass `formatPhone`. |
| `password` | string | yes | At least 8 characters. |
| `language` | `'ar'` \| `'en'` | no | Stored as `preferred_language`. |

**Response `201`:**
```json
{
  "joined": true,
  "user": { "id": "6703a…", "name": "Sara Ahmed", "email": "sara@example.com", "profile_image": null, "role": "user", "cars": [] }
}
```

**Errors:**
- `400` — `NAME_REQUIRED`, `WEAK_PASSWORD`, `PHONE_REQUIRED`
- `403` — `STAFF_SESSION`
- `409` — the email already has an account (`EMAIL_IN_USE`); phone taken (`PHONE_IN_USE`); `ALREADY_IN_FAMILY` (the new account is then deleted)
- `404` / `410` — token lookup errors
- (unverified) This route does not check the channel. On a WhatsApp invitation (`email: null`) it probably returns `EMAIL_IN_USE`, because `User.exists({email: null})` also matches accounts that have no email.

#### `POST /api/family-invitations/:token/send-code`
Sends the 6-digit WhatsApp code that proves the invitee holds the invited number. **WhatsApp invitations only.** The code lasts 10 minutes, a resend has to wait 120 s, and at most 5 codes can be issued (env-configurable).

- **Auth:** Public
- **Rate limit:** 10 per hour per IP

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `language` | `'ar'` \| `'en'` | no | Message language. |

**Response `200`:**
```json
{
  "success": true,
  "verification": { "channel": "whatsapp", "masked_destination": "*******5432", "expires_at": "2026-10-11T09:10:00.000Z", "resend_available_at": "2026-10-11T09:02:00.000Z" }
}
```

**Errors:**
- `409` — email invitation (`WRONG_CHANNEL`)
- `429` — still in cooldown (`OTP_RESEND_COOLDOWN`, with a `Retry-After` header); too many codes (`OTP_RESEND_LIMIT`)
- `502` — WhatsApp send failed (`OTP_DELIVERY_FAILED`)
- `404` / `410` — token lookup errors

#### `POST /api/family-invitations/:token/accept-with-code`
Accept a WhatsApp invitation with the code. The account is claimed if it is still a placeholder (marked active and phone-verified, with the name set), joined to the family and signed in. The `token` cookie is set as a browser-session cookie holding a 30-day JWT. The organizer gets `family_invitation_accepted`. If the join fails because the account is already in another family, the account still stays claimed.

- **Auth:** Public
- **Rate limit:** 30 per 10 minutes per IP

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes | 6 digits. |
| `name` | string | when `needs_account_setup` | Only overwrites the placeholder name. |
| `language` | `'ar'` \| `'en'` | no | Accepted but not used. |

**Response `201`:**
```json
{
  "joined": true,
  "user": { "id": "6703b…", "name": "Sara Ahmed", "email": null, "phone": "01098765432", "profile_image": null, "role": "user", "account_status": "active", "phone_verified_at": "2026-10-11T09:05:00.000Z", "is_guest": false, "cars": [] }
}
```

**Errors:**
- `400` — `NAME_REQUIRED`; `OTP_INVALID_FORMAT`; wrong code (`OTP_INCORRECT`, body includes `attempts_remaining`)
- `403` — `STAFF_SESSION`
- `404` — no active code (`OTP_NOT_FOUND`)
- `409` — `WRONG_CHANNEL`; `OTP_ALREADY_USED`; `ALREADY_IN_FAMILY`
- `410` — `OTP_EXPIRED`
- `429` — `OTP_TOO_MANY_ATTEMPTS` (5 wrong attempts)

#### `POST /api/family-invitations/:token/decline`
Declines the invitation. No proof is needed. The token is burned, and the organizer gets an in-app `family_invitation_declined` notification.

- **Auth:** Public
- **Rate limit:** 20 per 10 minutes per IP

**Response `200`:**
```json
{ "declined": true }
```

**Errors:**
- `404` — unknown or burned token (`INVITATION_NOT_FOUND`)
- `410` — `INVITATION_EXPIRED`

---

## 10. Friends

Friends can buy for each other and have it delivered to the friend's address. Each side must share at least one of their own addresses.

- Limits: 100 friends, 20 pending sent invitations. At most one pending invitation per pair, in either direction.
- Invitations expire after **7 days** and cannot be resent.
- How an invitation arrives:
  - An existing customer gets an in-app request and answers it from the Friends tab (`/api/users/friends/invitations/:id/...`).
  - A new phone number gets a WhatsApp link (`/invite/<token>`) and answers it through `/api/friend-invitations/:token/...`.
  - An email with no account gets a sign-up link. The invitation appears in-app once that email registers.
- Blocking has no undo. A blocked pair cannot invite each other, and the sender is not told.
- Removing or blocking a friend stops address sharing in both directions. Orders already placed are kept.

### Friends list

#### `GET /api/users/friends`
Loads the Friends tab: the caller's addresses, incoming requests, active friends with what each side shares, and the caller's outgoing invitations. Pending invitations past their expiry are marked `expired` first.

- **Auth:** User

**Response `200`:**
```json
{
  "has_own_address": true,
  "my_addresses": [
    { "_id": "66e0c…", "label": "Home", "recipient_name": "Ahmed Ali", "phone": "01012345678", "full_address": "12 Tahrir St, Dokki", "shipping_country": "Egypt", "shipping_city": "Giza", "is_default": true }
  ],
  "incoming_requests": [
    { "_id": "6704a…", "sender": { "_id": "66ea1…", "name": "Karim Said", "profile_image": null }, "created_at": "2026-10-10T12:00:00.000Z", "expires_at": "2026-10-17T12:00:00.000Z" }
  ],
  "friends": [
    {
      "friendship_id": "6704b…",
      "friend": { "_id": "66ea2…", "name": "Mona Adel", "profile_image": null },
      "since": "2026-09-01T09:00:00.000Z",
      "addresses_shared_with_me": [ { "_id": "66eb0…", "label": "Work", "shipping_city": "Cairo" } ],
      "my_shared_address_ids": ["66e0c…"],
      "can_buy_for_them": true
    }
  ],
  "outgoing_invitations": [
    { "_id": "6704c…", "identifier_type": "phone", "identifier_masked": "*******1122", "created_at": "2026-10-09T08:00:00.000Z", "expires_at": "2026-10-16T08:00:00.000Z" }
  ]
}
```
`friend._id` is the friend's **user id**. Use it as `:friendId` in the endpoints below. In this list, a shared address shows only its label and city.

#### `GET /api/users/friends/purchasable`
Friends the caller can buy for right now: active, and sharing at least one address that still exists. This feeds the recipient picker at checkout.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)

**Response `200`:**
```json
{
  "friends": [
    { "_id": "66ea2…", "name": "Mona Adel", "profile_image": null, "friendship_id": "6704b…", "shared_address_count": 1, "can_buy_for_them": true }
  ]
}
```
Every active friend is listed, including those with `can_buy_for_them: false`.

#### `GET /api/users/friends/orders-for-me`
Orders that a friend bought for the caller: the last 50, newest first. Read-only, with no price or payment details.

- **Auth:** User

**Response `200`:**
```json
{
  "orders": [
    {
      "_id": "6705a…",
      "reference": "RC-10293",
      "status": "shipped",
      "created_at": "2026-10-05T10:00:00.000Z",
      "delivered_at": null,
      "paid_online": true,
      "paid_by": { "_id": "66ea2…", "name": "Mona Adel", "profile_image": null },
      "items": [ { "product_title": "Oil filter", "product_image": "/uploads/products/filter.webp", "variant_label": "", "quantity": 1 } ],
      "delivery_summary": { "recipient_name": "Ahmed Ali", "city": "Giza", "country": "Egypt" },
      "shipments": [ { "provider": "bosta", "tracking_number": "5523…", "bosta_tracking_number": "5523…", "bosta_status": "IN_TRANSIT", "tracking_history": [] } ]
    }
  ]
}
```

#### `POST /api/users/friends/invitations`
Invite someone by email or Egyptian mobile, whether or not they have an account. The sender must share at least one of their own addresses. The response is the same whatever happens, so nothing is revealed about the invitee.
- **Existing customer:** in-app `friend_invitation_received`, plus copies to their WhatsApp and email.
- **Unclaimed guest or new number:** a WhatsApp link (a placeholder account is created for a new number), plus an email copy when the account has an address.
- **Email with no account:** held, and the person is emailed a `/register` link.
- **Blocked pair, or an invitation already pending from the caller:** silently does nothing.

- **Auth:** User, confirmed (403 `GUEST_NOT_CONFIRMED` for an unconfirmed guest)
- **Rate limit:** 20 per hour per user

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `identifier` | string | yes | Email or Egyptian mobile. |
| `shared_address_ids` | string[] | yes | At least one of the caller's own address ids. Applied when the invitation is accepted. |
| `language` | `'ar'` \| `'en'` | no | Message language. |

Example body:
```json
{
  "identifier": "01011221122",
  "shared_address_ids": [
    "66e0c1a2b3c4d5e6f7a8b9c0"
  ],
  "language": "ar"
}
```

**Response `201`:**
```json
{ "code": "INVITE_SENT", "identifier_masked": "*******1122", "message": "Invitation sent." }
```

**Errors:**
- `400` — `INVALID_IDENTIFIER`; no address shared (`SHARE_ADDRESS_REQUIRED`); `ADDRESS_NOT_OWNED`; `CANNOT_INVITE_SELF`
- `404` — `USER_NOT_FOUND`
- `409` — caller has no saved address (`NO_SAVED_ADDRESS`); 100 friends already (`FRIEND_LIMIT_REACHED`); `ALREADY_FRIENDS`; the other person already invited the caller (`INCOMING_REQUEST_EXISTS`)
- `429` — 20 pending invitations (`PENDING_INVITE_LIMIT`); `RATE_LIMITED`
- `502` — WhatsApp send failed (`INVITE_DELIVERY_FAILED`)
- `503` — WhatsApp not configured (`INVITE_DELIVERY_UNAVAILABLE`)

#### `POST /api/users/friends/invitations/:id/accept`
The recipient accepts an in-app request and shares at least one of their own addresses back. This creates or reactivates the pair's friendship row and both sets of shares. The sender's original offer is re-checked against the addresses they still have. The sender gets an in-app `friend_invitation_accepted` notification.

- **Auth:** User
- **Rate limit:** 30 per 10 minutes per user

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | ObjectId | yes | `incoming_requests[]._id`. |

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `shared_address_ids` | string[] | yes | At least one of the caller's own address ids. |

Example body:
```json
{
  "shared_address_ids": [
    "66e0c1a2b3c4d5e6f7a8b9c0"
  ]
}
```

**Response `200`:**
```json
{
  "message": "You are now friends.",
  "friendship_id": "6704b…",
  "friend": { "_id": "66ea1…", "name": "Karim Said", "profile_image": null },
  "sender_shared_address_count": 1
}
```
`sender_shared_address_count: 0` means the sender's offered addresses have since been deleted.

**Errors:**
- `400` — `SHARE_ADDRESS_REQUIRED`; `ADDRESS_NOT_OWNED`
- `404` — not addressed to the caller (`INVITATION_NOT_FOUND`); sender deleted (`USER_NOT_FOUND`)
- `409` — `INVITATION_NOT_PENDING`; `NO_SAVED_ADDRESS`; `FRIEND_LIMIT_REACHED`; pair is blocked (`FRIENDSHIP_BLOCKED`)
- `410` — `INVITATION_EXPIRED`

#### `POST /api/users/friends/invitations/:id/decline`
The recipient declines an in-app request. The sender gets an in-app `friend_invitation_declined` notification.

- **Auth:** User

**Response `200`:**
```json
{ "declined": true }
```

**Errors:**
- `404` — `INVITATION_NOT_FOUND`
- `409` — `INVITATION_NOT_PENDING`
- `410` — `INVITATION_EXPIRED`

#### `DELETE /api/users/friends/invitations/:id`
The sender cancels their own pending invitation. Nobody is notified.

- **Auth:** User

**Response `200`:**
```json
{ "cancelled": true }
```

**Errors:**
- `404` — not sent by the caller (`INVITATION_NOT_FOUND`)
- `409` — `INVITATION_NOT_PENDING`
- `410` — `INVITATION_EXPIRED`

#### `GET /api/users/friends/:friendId/shared-addresses`
The full delivery details of the addresses this friend shares with the caller, for friend checkout.

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `friendId` | ObjectId | yes | Friend's user id. |

**Response `200`:**
```json
{
  "friendship_id": "6704b…",
  "friend": { "_id": "66ea2…", "name": "Mona Adel", "profile_image": null },
  "addresses": [
    { "_id": "66eb0…", "label": "Work", "recipient_name": "Mona Adel", "phone": "01122334455", "full_address": "5 Nile Corniche, Maadi", "shipping_country": "Egypt", "shipping_city": "Cairo" }
  ]
}
```

**Errors:**
- `404` — no active friendship. Removed and blocked friendships look the same as none (`FRIENDSHIP_NOT_FOUND`).

#### `GET /api/users/friends/:friendId/my-shared-addresses`
All of the caller's own addresses, each marked with whether it is shared with this friend.

- **Auth:** User

**Response `200`:**
```json
{
  "addresses": [
    { "_id": "66e0c…", "label": "Home", "recipient_name": "Ahmed Ali", "phone": "01012345678", "full_address": "12 Tahrir St, Dokki", "shipping_country": "Egypt", "shipping_city": "Giza", "is_default": true, "is_shared": true }
  ],
  "shared_address_ids": ["66e0c…"]
}
```

**Errors:**
- `404` — `FRIENDSHIP_NOT_FOUND`

#### `PUT /api/users/friends/:friendId/my-shared-addresses`
Replaces which of the caller's addresses this friend may use. An empty list stops sharing. The friend gets an in-app `friend_address_access_changed` notification (a count only).

- **Auth:** User

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `shared_address_ids` | string[] | no | Full replacement list. Defaults to `[]`. |

**Response `200`:**
```json
{ "message": "Shared addresses updated.", "shared_address_ids": ["66e0c…"] }
```

**Errors:**
- `400` — `ADDRESS_NOT_OWNED`
- `404` — `FRIENDSHIP_NOT_FOUND`

#### `DELETE /api/users/friends/:friendId`
Ends an active friendship. Address shares are deleted in both directions; completed orders are kept. The other person gets an in-app `friendship_removed` notification.

- **Auth:** User

**Response `200`:**
```json
{ "removed": true, "revoked_address_shares": 2 }
```

**Errors:**
- `404` — `FRIENDSHIP_NOT_FOUND`

#### `POST /api/users/friends/:friendId/block`
Blocks a customer the caller has a friendship row with, in any state. Shares in both directions are deleted and pending invitations between the two are cancelled. The blocked person is not told. There is no unblock endpoint.

- **Auth:** User

**Response `200`:**
```json
{ "blocked": true }
```

**Errors:**
- `404` — the two never had a friendship row (`FRIENDSHIP_NOT_FOUND`)

### Friend invitation links

Only invitations with `channel: 'whatsapp'` can be reached here: those sent to an unclaimed guest or a new number. The `:token` is the raw value from the `/invite/<token>` link. Friend tokens stay valid after an answer, so the lookup reports precise states. Lookup errors on every route:
- `404` — `INVITATION_NOT_FOUND`
- `409` — `INVITATION_ALREADY_ACCEPTED`; declined or cancelled (`INVITATION_CLOSED`)
- `410` — `INVITATION_EXPIRED`

#### `GET /api/friend-invitations/:token`
Preview for the landing page: who is inviting and how many addresses they offer. It never shows the addresses themselves or anything about the invited account.

- **Auth:** Public
- **Rate limit:** 30 per minute per IP

**Response `200`:**
```json
{
  "invitation_id": "6704c…",
  "expires_at": "2026-10-16T08:00:00.000Z",
  "inviter": { "_id": "66e0b…", "name": "Ahmed Ali", "profile_image": null },
  "sender_shared_address_count": 1,
  "invited_masked": "*******1122",
  "needs_account_setup": true,
  "recipient_has_address": false
}
```
- `needs_account_setup: true` means the page should ask for a name.
- `recipient_has_address: false` means the page **must** collect an address and send it with the accept call.

**Errors:**
- `404` — inviter account deleted (`USER_NOT_FOUND`), plus the lookup errors above

#### `POST /api/friend-invitations/:token/send-code`
Sends the WhatsApp code to the invited number. The OTP rules are the same as for the family `send-code` (10 min life, 120 s resend wait, 5 codes at most).

- **Auth:** Public
- **Rate limit:** 10 per hour per IP

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `language` | `'ar'` \| `'en'` | no | Message language. |

**Response `200`:**
```json
{
  "success": true,
  "verification": { "channel": "whatsapp", "masked_destination": "*******1122", "expires_at": "2026-10-11T09:10:00.000Z", "resend_available_at": "2026-10-11T09:02:00.000Z" }
}
```

**Errors:**
- `429` — `OTP_RESEND_COOLDOWN` (with `Retry-After`); `OTP_RESEND_LIMIT`
- `502` — `OTP_DELIVERY_FAILED`
- lookup errors above

#### `POST /api/friend-invitations/:token/accept`
Accept with the code. The number is proved, the account is claimed if needed, and an address is added if the account has none. Then the normal acceptance runs, sharing **all** of the recipient's addresses back. The response signs the invitee in: the `token` cookie has a 30-day `maxAge` and holds a 30-day JWT. The sender gets `friend_invitation_accepted`.

- **Auth:** Public
- **Rate limit:** 30 per 10 minutes per IP

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes | 6 digits. |
| `name` | string | no | Only used while the account is an unclaimed placeholder. Also used as the new address's recipient name. |
| `address` | object | when the account has no address | `{ full_address (required), shipping_country?, shipping_city? }`. Saved as the default address, with the account phone. |
| `language` | `'ar'` \| `'en'` | no | Accepted but not used. |

Example body:
```json
{
  "code": "123456",
  "name": "Mona Adel",
  "address": {
    "full_address": "5 Nile Corniche, Maadi",
    "shipping_country": "Egypt",
    "shipping_city": "Cairo"
  }
}
```

**Response `200`:**
```json
{
  "success": true,
  "friendship_id": "6704b…",
  "friend": { "_id": "66e0b…", "name": "Ahmed Ali", "profile_image": null },
  "sender_shared_address_count": 1,
  "user": { "id": "6703c…", "name": "Mona Adel", "email": null, "phone": "01011221122", "profile_image": null, "role": "user", "account_status": "active", "phone_verified_at": "2026-10-11T09:05:00.000Z", "is_guest": false, "cars": [] }
}
```

**Errors:**
- `400` — wrong code (`OTP_INCORRECT`, with `attempts_remaining`); `OTP_INVALID_FORMAT`; no address supplied for an account without one (`ADDRESS_REQUIRED`). This last check runs **after** the code is used up and the account claimed, so a retry needs a new code. Send the address on the first try.
- `404` — `OTP_NOT_FOUND`
- `409` — `OTP_ALREADY_USED`; `FRIEND_LIMIT_REACHED`; `FRIENDSHIP_BLOCKED`
- `410` — `OTP_EXPIRED`
- `429` — `OTP_TOO_MANY_ATTEMPTS`
- lookup errors above

#### `POST /api/friend-invitations/:token/decline`
Declines without a code. The sender gets `friend_invitation_declined`.

- **Auth:** Public
- **Rate limit:** 20 per 10 minutes per IP

**Response `200`:**
```json
{ "declined": true }
```

**Errors:**
- lookup errors above

### Invitation link resolver

#### `GET /api/invitations/:token/resolve`
The `/invite/<token>` page calls this to learn which kind of invitation a token belongs to, so it can forward to the right landing page. It looks for the token hash in friend, family and company invitations, in that order.

- **Auth:** Public
- **Rate limit:** 30 per minute per IP

**Response `200`:**
```json
{ "kind": "friend", "redirect": "/profile?tab=friends" }
```
- `kind` is `friend`, `family` or `company`.
- `redirect` appears only for an in-app friend request, which the recipient answers from their Friends tab and not from the token page.
- A friend invitation resolves in any status. Family and company tokens burned by accept, decline or revoke no longer resolve.

**Errors:**
- `404` — no invitation has this token (`INVITATION_NOT_FOUND`)
- `500` — `RESOLVE_FAILED`

---

## 11. Notifications and support

**Live ticket updates (Socket.io).** Connect to `https://readycar.store` (path `/socket.io`) with credentials, so the `token` cookie is sent. A connection without a valid session is refused.

| Direction | Event | Payload |
|---|---|---|
| App → server | `ticket:join` | `ticketId` (string). Only the ticket's author can join. There is no reply. |
| App → server | `ticket:leave` | `ticketId` |
| Server → app | `ticket:updated` | The full ticket, sent after any new reply on it. |

Only tickets use the socket. Notifications are not pushed: poll `GET /api/users/notifications/count`.

### Notifications

#### `GET /api/users/notifications`
The caller's in-app notifications, newest first, already localized. These are never pushed over the socket.

- **Auth:** User

**Query**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | number | no | Default 1. |
| `limit` | number | no | Default 20, max 50. |
| `read` | `'true'` \| `'false'` | no | Filter by read state. Any value other than `'true'` means unread only. |
| `language` | `'ar'` \| `'en'` | no | Defaults to the account's `preferred_language`. |

**Response `200`:**
```json
{
  "notifications": [
    {
      "_id": "6706a…",
      "type": "family_order_request_received",
      "title": "New order request",
      "message": "Omar Ahmed sent an order request with 1 item, estimated EGP 960.00.",
      "link": "/family/requests/6701a…",
      "data": { "request_id": "6701a…" },
      "read": false,
      "createdAt": "2026-10-11T09:00:01.000Z"
    }
  ],
  "pagination": { "total": 14, "page": 1, "limit": 20, "pages": 1 }
}
```

**Errors:**
- `500` — `{ message }`

#### `GET /api/users/notifications/count`
The unread count for the bell badge.

- **Auth:** User

**Response `200`:**
```json
{ "count": 3 }
```

**Errors:**
- `500` — `{ message }`

#### `PUT /api/users/notifications/:id/read`
Marks one of the caller's notifications as read.

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | ObjectId | yes | Notification id. |

**Response `200`:**
```json
{ "success": true }
```

**Errors:**
- `404` — not found, or not the caller's (`{ message: "Notification not found" }`)
- `500` — e.g. an id that is not a valid ObjectId (`{ message }`)

#### `PUT /api/users/notifications/read-all`
Marks every unread notification of the caller as read.

- **Auth:** User

**Response `200`:**
```json
{ "success": true }
```

**Errors:**
- `500` — `{ message }`

### Support tickets

The same router serves customers and vendors. A customer only ever sees tickets they wrote (`authorRole: 'user'`). Error bodies here are `{ success: false, message }`, with no `code`. For live replies, join the ticket's socket room and listen for `ticket:updated` (see the socket table above).

#### `POST /api/tickets`
Opens a support ticket. It can be linked to one of the caller's own orders, which forces the category to `order`. Nobody is notified.

- **Auth:** User or Vendor

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | yes | Trimmed, max 255 characters. |
| `description` | string | yes | Trimmed. |
| `category` | string | no | `account, order, product, payment, technical, other`. Default `other`. Ignored when `order_id` is set. |
| `priority` | string | no | `low, medium, high, urgent`. Default `medium`. |
| `order_id` | ObjectId | no | Must be an order the customer placed (`user_id` = caller). |

Example body:
```json
{
  "title": "Wrong part delivered",
  "description": "I received rear pads instead of front.",
  "priority": "medium",
  "order_id": "6702c1a2b3c4d5e6f7a8b9c0"
}
```

**Response `201`:**
```json
{
  "success": true,
  "ticket": {
    "_id": "6707a…",
    "title": "Wrong part delivered",
    "description": "I received rear pads instead of front.",
    "category": "order",
    "priority": "medium",
    "order_id": "6702c…",
    "order_reference": "RC-10293",
    "authorId": "66e0b…",
    "authorRole": "user",
    "authorName": "Ahmed Ali",
    "status": "open",
    "messages": [],
    "assignedTo": null,
    "assignedToName": null,
    "adminNote": null,
    "initiatedByAdmin": false,
    "createdAt": "2026-10-11T09:00:00.000Z",
    "updatedAt": "2026-10-11T09:00:00.000Z"
  }
}
```

**Errors:**
- `400` — title missing; description missing; `order_id` is not an ObjectId (`Invalid order`)
- `404` — the order is not the caller's (`Order not found`)
- `500` — e.g. a `category` or `priority` outside the enum (Mongoose validation)

#### `GET /api/tickets`
The caller's tickets, newest first.

- **Auth:** User or Vendor

**Query**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | string | no | `open, pending, resolved, closed`. |
| `priority` | string | no | `low, medium, high, urgent`. |
| `page` | number | no | Default 1. |
| `limit` | number | no | Default 20. No upper limit is enforced. |

**Response `200`:**
```json
{
  "success": true,
  "tickets": [
    {
      "_id": "6707a…",
      "title": "Wrong part delivered",
      "status": "pending",
      "priority": "medium",
      "category": "order",
      "messages": [ { "_id": "6707b…", "senderRole": "admin", "senderId": "6707c…", "senderName": "support", "content": "We are checking with the vendor.", "createdAt": "2026-10-11T10:00:00.000Z" } ],
      "createdAt": "2026-10-11T09:00:00.000Z",
      "updatedAt": "2026-10-11T10:00:00.000Z"
    }
  ],
  "pagination": { "total": 1, "page": 1, "pages": 1, "limit": 20 }
}
```

**Errors:**
- `500` — `{ success: false, message }`

#### `GET /api/tickets/:id`
One of the caller's tickets with the full message thread. Returns the whole document, **including `adminNote`, `assignedTo` and `assignedToName`**.

- **Auth:** User or Vendor (owner only)

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | ObjectId | yes | Ticket id. |

**Response `200`:**
```json
{ "success": true, "ticket": { "_id": "6707a…", "title": "Wrong part delivered", "status": "pending", "messages": [], "adminNote": null } }
```
`ticket` is the full ticket document, with the same fields as in the create response.

**Errors:**
- `400` — `Invalid ticket ID`
- `404` — `Ticket not found` (also when the ticket belongs to someone else)
- `500` — `{ success: false, message }`

#### `POST /api/tickets/:id/messages`
The customer replies on their own ticket. A `resolved` ticket goes back to `open`; a `closed` one refuses replies. `ticket:updated` is emitted to room `ticket:<id>` with the full updated ticket.

- **Auth:** User or Vendor (owner only)

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `content` | string | yes | Trimmed. |

**Response `200`:**
```json
{
  "success": true,
  "ticket": {
    "_id": "6707a…",
    "status": "open",
    "messages": [ { "_id": "6707d…", "senderRole": "user", "senderId": "66e0b…", "senderName": "Ahmed Ali", "content": "Any update?", "createdAt": "2026-10-11T11:00:00.000Z" } ]
  }
}
```

**Errors:**
- `400` — `Invalid ticket ID`; `Message content is required`; ticket is closed
- `404` — `Ticket not found`
- `500` — `{ success: false, message }`

---

## 12. Company accounts (employee side)

An **employee** of a company account can order on the company's balance within a monthly limit. These endpoints are the employee's own view. Managers use the company portal (`/api/company`), which is not covered here.

- A person can belong to several companies, but to each only once. There is no "leave" endpoint: managers pause or remove employees.
- Company invitations expire after **14 days**. An email invitation links to `https://readycar.store/company/invitation/<token>`; a WhatsApp one to `https://readycar.store/invite/<token>`. Accepting, declining or cancelling destroys the token.

### My company

These are the routes for an employee's view of the company accounts they belong to. Errors are `{ code, message }`. A thrown error with no status becomes **500**. The manager portal is `/api/company` and is out of scope.

#### `GET /api/users/company`
Each company the caller belongs to (oldest membership first), with their monthly limit and what is left of it, office, group and the modes on offer. For a manager, the active company cars are also listed. There is no "leave" endpoint.

- **Auth:** User

**Response `200`:**
```json
{
  "membership": { "company": { "_id": "6708a…", "name": "Nile Logistics" } },
  "memberships": [
    {
      "company": { "_id": "6708a…", "name": "Nile Logistics", "org_type": "company", "billing_mode": "monthly", "has_invoices": true, "has_wallet": false, "wallet_balance": 0, "status": "active", "ended_at": null },
      "is_employee": true,
      "is_manager": false,
      "joined_at": "2026-09-02T08:00:00.000Z",
      "deactivated": false,
      "limit": 3000,
      "limit_source": "group",
      "spent": 1250,
      "remaining": 1750,
      "month": "2026-10",
      "renews_on": "2026-11-01",
      "group": { "name": "Drivers" },
      "office": { "name": "HQ – Nasr City", "full_address": "90 Abbas El Akkad St, Nasr City" },
      "modes": { "consolidate": true, "instant": true },
      "can_order_on_company": true,
      "cars": []
    }
  ]
}
```
- `membership` is the same object as `memberships[0]`, trimmed above.
- Someone in no company gets `{ "membership": null, "memberships": [] }`.
- `limit_source` is `override`, `group`, `default`, or `null` for a non-employee.
- `month` and the renewal date use Cairo time.
- `cars[]` (managers only) is `{_id, car_brand_id, car_brand_name, car_model_id, car_model_name, year, plate}`.

**Errors:**
- `500` — unexpected (`COMPANY_ERROR`)

#### `GET /api/users/company/orders`
The caller's own ledger rows on company accounts (charges and credits), newest first, each with its order. A charge row may offer a "settle" action.

- **Auth:** User

**Query**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | number | no | Default 50, max 200. |

**Response `200`:**
```json
{
  "rows": [
    {
      "_id": "6709a…",
      "kind": "charge",
      "created_at": "2026-10-03T12:00:00.000Z",
      "month": "2026-10",
      "amount": 850,
      "personal_amount": 0,
      "company_name": "Nile Logistics",
      "order": {
        "_id": "6702e…",
        "reference": "RC-10301",
        "status": "processing",
        "total": 850,
        "items": [ { "title": "Air filter", "variant": "", "quantity": 1, "unit_price": 790 } ],
        "settle": { "amount": 850, "blocked": null, "settled": false }
      }
    }
  ]
}
```
- `kind` is `charge` or `credit`.
- `amount` is the company's share; credit rows carry a negative amount.
- `settle` is `null` on credit rows. `settle.blocked` is `null` when the action is available, otherwise `ORDER_NOT_PAID` or `NOTHING_TO_SETTLE`.

**Errors:**
- `500` — `COMPANY_ERROR`

#### `GET /api/users/company/batches`
The caller's parcels from consolidate-mode company orders (the 20 most recent orders) that joined a shipping batch: waiting, released, or taken out.

- **Auth:** User

**Response `200`:**
```json
{
  "rows": [
    {
      "order_id": "6702e…",
      "order_reference": "RC-10301",
      "sub_order_id": "6702f…",
      "reference": "RC-10301-1",
      "vendor_name": "Turbo Auto Parts",
      "vendor_username": "turbo",
      "vendor_slug": "turbo-auto-parts",
      "items": [ { "title": "Air filter", "quantity": 1 } ],
      "waiting": true,
      "status": "held_in_batch",
      "left_reason": null,
      "joined_at": "2026-10-03T12:00:00.000Z",
      "released_at": null,
      "standalone_shipping": 60,
      "savings": 0,
      "batch": { "status": "open", "waiting_count": 2, "target_count": 3, "deadline_at": "2026-10-05T12:00:00.000Z", "office_name": "HQ – Nasr City", "close_reason": null }
    }
  ]
}
```
- `left_reason` is `cancelled`, `ship_now` or `null`.
- `batch.status` is `open`, `closing`, `closed` or `cancelled`.
- `close_reason` is `count`, `time`, `admin` or `null`.

**Errors:**
- `500` — `COMPANY_ERROR`

#### `POST /api/users/company/orders/:orderId/parcels/:subOrderId/ship-now`
The customer who placed the order takes one waiting parcel out of its batch, and it ships alone at the full shipping already paid. The vendor gets a new-order notification and WhatsApp.

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `orderId` | ObjectId | yes | Must be the caller's company order. |
| `subOrderId` | ObjectId | yes | The parcel (sub-order) id. |

**Response `200`:**
```json
{ "ok": true }
```

**Errors:**
- `404` — not the caller's company order (`ORDER_NOT_FOUND`); unknown parcel (`SUB_ORDER_NOT_FOUND`)
- `409` — parcel is not `held_in_batch` (`NOT_WAITING`); batch is closing right now (`BATCH_CLOSING`)

#### `POST /api/users/company/orders/:orderId/settle`
The employee pays the company's remaining share of their own company order from their **own wallet**. The company is credited, and the amount goes back onto the employee's limit for that month (unless the month is already invoiced). From then on, refunds for the order go to the employee. Safe to retry.

- **Auth:** User

**Path params**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `orderId` | ObjectId | yes | The employee's own company order. |

**Response `200`:**
```json
{ "amount": 850, "limit_restored": true, "credited_month": "2026-10" }
```

**Errors:**
- `403` — not a company order (`NOT_COMPANY_ORDER`); not the caller's employee order (`NOT_YOUR_COMPANY_ORDER`)
- `404` — `ORDER_NOT_FOUND`
- `409` — the order's personal-part payment has not completed (`ORDER_NOT_PAID`); nothing left to pay (`NOTHING_TO_SETTLE`)
- `500` — wallet short (`INSUFFICIENT_BALANCE`) or frozen (`WALLET_FROZEN`). The wallet error sets no HTTP status, so it falls through to 500 (unverified as intended).

### Company invitation links

An employee or manager invitation is answered the same way as a family one. The `:token` comes from `${FRONTEND_URL}/company/invitation/<token>` (email) or `/invite/<token>` (WhatsApp). Lookup errors on every token route:
- `404` — unknown or burned token (`INVITATION_NOT_FOUND`)
- `410` — `INVITATION_EXPIRED` (14-day TTL); company ended or missing (`COMPANY_UNAVAILABLE`)
- The `INVITATION_REVOKED`, `INVITATION_ALREADY_ACCEPTED` and `INVITATION_DECLINED` codes exist, but can't be reached once the token is burned.

#### `GET /api/company-invitations/:token`
Landing-page preview: the company, the role and, for an employee, their monthly limit and office.

- **Auth:** Public (reads a customer session if one is present)
- **Rate limit:** 30 per minute per IP

**Response `200`:**
```json
{
  "invitation": { "role": "employee", "email": "omar@nile.example", "phone_masked": null, "channel": "email", "expires_at": "2026-10-25T09:00:00.000Z" },
  "company": { "name": "Nile Logistics", "org_type": "company" },
  "employee_terms": { "limit": 3000, "office_name": "HQ – Nasr City" },
  "invited_account_exists": true,
  "signed_in_matches": true,
  "signed_in_other_company": false,
  "needs_account_setup": false
}
```
- `employee_terms` is `null` for a manager invitation.
- `signed_in_matches` is `null` without a session. With one, it compares the email for an email invitation and the account id for a WhatsApp one.
- `signed_in_other_company` is always `false` and kept only for old screens.

#### `POST /api/company-invitations/:token/accept`
Accept with the signed-in account that owns the invited email or number. If the caller already belongs to this company in the other role, that role is added to the existing membership. The other managers get `company_invitation_accepted`.

- **Auth:** User (cookie read through `optionalUser`; no session → 401 `SIGN_IN_REQUIRED`)
- **Rate limit:** 20 per 10 minutes per IP

**Response `200`:**
```json
{ "joined": true, "role": "employee", "redirect": "/profile?tab=company" }
```
For a manager, `redirect` is `/company`.

**Errors:**
- `401` — `SIGN_IN_REQUIRED`
- `403` — `STAFF_SESSION`; `EMAIL_MISMATCH`; `ACCOUNT_MISMATCH`
- `409` — on a wallet company, employee limits would exceed the balance (`COMPANY_ALLOCATION_EXCEEDED`); duplicate active membership race (`ALREADY_IN_COMPANY`)
- lookup errors above

#### `POST /api/company-invitations/:token/accept-with-registration`
Accept an **email** invitation by creating the account for the invited address, with no extra verification email. The response sets the `token` cookie (browser-session cookie, 1-day JWT). Friend invitations waiting for this email are converted.

- **Auth:** Public
- **Rate limit:** 10 per hour per IP

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Full name. |
| `phone` | string | yes | Must pass `formatPhone`. |
| `password` | string | yes | At least 8 characters. |
| `language` | `'ar'` \| `'en'` | no | Stored as `preferred_language`. |

**Response `201`:**
```json
{
  "joined": true,
  "role": "employee",
  "redirect": "/profile?tab=company",
  "user": { "id": "670aa…", "name": "Omar Hassan", "email": "omar@nile.example", "profile_image": null, "role": "user", "cars": [] }
}
```

**Errors:**
- `400` — `NAME_REQUIRED`, `WEAK_PASSWORD`, `PHONE_REQUIRED`
- `403` — `STAFF_SESSION`
- `409` — WhatsApp invitation (`WRONG_CHANNEL`); `EMAIL_IN_USE`; `PHONE_IN_USE`; `COMPANY_ALLOCATION_EXCEEDED` (the new account is then deleted)
- lookup errors above

#### `POST /api/company-invitations/:token/send-code`
Sends the WhatsApp code for a WhatsApp invitation. The OTP rules are the same as for family.

- **Auth:** Public
- **Rate limit:** 10 per hour per IP

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `language` | `'ar'` \| `'en'` | no | Message language. |

**Response `200`:**
```json
{
  "success": true,
  "verification": { "channel": "whatsapp", "masked_destination": "*******7788", "expires_at": "2026-10-11T09:10:00.000Z", "resend_available_at": "2026-10-11T09:02:00.000Z" }
}
```

**Errors:**
- `409` — email invitation (`WRONG_CHANNEL`)
- `429` — `OTP_RESEND_COOLDOWN` (with `Retry-After`); `OTP_RESEND_LIMIT`
- `502` — `OTP_DELIVERY_FAILED`
- lookup errors above

#### `POST /api/company-invitations/:token/accept-with-code`
Accept a WhatsApp invitation with the code. The account is claimed if it is still a placeholder, and the membership is attached. The `token` cookie is set as a browser-session cookie holding a 30-day JWT. If the join fails, the account stays claimed.

- **Auth:** Public
- **Rate limit:** 30 per 10 minutes per IP

**Body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes | 6 digits. |
| `name` | string | when `needs_account_setup` | Only overwrites a placeholder name. |

**Response `201`:**
```json
{
  "joined": true,
  "role": "employee",
  "redirect": "/profile?tab=company",
  "user": { "id": "670ab…", "name": "Mahmoud Fathy", "email": null, "phone": "01033447788", "profile_image": null, "role": "user", "account_status": "active", "phone_verified_at": "2026-10-11T09:05:00.000Z", "is_guest": false, "cars": [] }
}
```

**Errors:**
- `400` — `NAME_REQUIRED`; `OTP_INVALID_FORMAT`; `OTP_INCORRECT` (with `attempts_remaining`)
- `403` — `STAFF_SESSION`
- `404` — `OTP_NOT_FOUND`
- `409` — `WRONG_CHANNEL`; `OTP_ALREADY_USED`; `COMPANY_ALLOCATION_EXCEEDED`; `ALREADY_IN_COMPANY`
- `410` — `OTP_EXPIRED`
- `429` — `OTP_TOO_MANY_ATTEMPTS`
- lookup errors above

#### `POST /api/company-invitations/:token/decline`
Declines without proof. The token is burned, and the company's managers get `company_invitation_declined`.

- **Auth:** Public
- **Rate limit:** 20 per 10 minutes per IP

**Response `200`:**
```json
{ "declined": true }
```

**Errors:**
- lookup errors above

---

## 13. Uploads

#### `POST /api/upload`
Generic image upload. Customers use it from the return-request page (`/profile/returns/request/[orderId]`) to attach photos before submitting a return. Vendor product forms use it as well.
- **No auth:** the router has no auth middleware at all.
- **Storage:** files are saved under `/uploads/products/`.
- **Content check:** every file's first bytes are checked. A file that is not really JPG, PNG or WebP is deleted and listed in `rejected`.

- **Auth:** Public (no auth middleware)

**Body** (`multipart/form-data`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `images` | file[] | one of the two | At most 10 files in this field. |
| `image` | file[] | one of the two | At most 10 files in this field. |

Each file may be at most 5 MB. A file gets past the first filter if either its extension or its MIME type is JPG, PNG or WebP. The magic-byte check then decides.

**Response `200`**:
```json
{
  "message": "Images uploaded successfully",
  "images": [
    { "url": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg", "is_primary": false }
  ],
  "url": "https://readycar.store/uploads/products/product-1760180000000-512340987.jpg"
}
```
`url` repeats the first image. The base is `BACKEND_PUBLIC_URL`, or the request's own host. `rejected: ["name.jpg"]` is added when some files failed the content check.

**Errors** (`{message, code?}`):
- `400` — `No files uploaded`.
- `400` — `INVALID_IMAGE`: every file failed the content check.
- `400` — `FILE_TOO_LARGE`.
- `400` — `UNSUPPORTED_FILE_TYPE`.
- `400` — `LIMIT_FILE_COUNT` / `LIMIT_UNEXPECTED_FILE`. The message is "Too many files in one upload. Send 10 or fewer.", even when the real cause is a wrong field name.
- `500` — `The upload could not be completed.`

---

## Appendix A: Status values

### Order `status`

The server derives it from the parcels; the app never sets it.

| Value | Meaning for the customer |
|---|---|
| `pending` | Placed; the store is reviewing it. |
| `processing`, `confirmed`, `ready`, `pickup_scheduled`, `picked_up`, `in_transit`, `out_for_delivery` | Every live parcel has reached at least this step. |
| `partially_shipped` | Some parcels are on the way; none delivered yet. |
| `partially_delivered` | At least one parcel delivered; others still moving. |
| `partially_cancelled` | Some parcels cancelled; the rest delivered. |
| `completed` | Every live parcel delivered. |
| `return_requested`, `return_in_progress`, `partially_returned`, `returned`, `refunded` | A return is open or finished on a delivered order. |
| `exception` | A courier problem. |
| `cancelled` | Every parcel cancelled. |

### Parcel (sub-order) `status`

| Value | Meaning for the customer |
|---|---|
| `pending_review` | The store is checking the items. |
| `awaiting_tracking`, `awaiting_handover` | The store is preparing the parcel. |
| `ready_for_pickup` | Packed, waiting for the courier. |
| `pickup_scheduled` | Courier visit booked. |
| `handed_to_courier`, `picked_up` | With the courier. |
| `in_transit` | On the way. |
| `out_for_delivery` | Out for delivery today. |
| `delivered` | Delivered. |
| `returned` | Came back undelivered. |
| `exception` | A courier problem. |
| `needs_admin` | An item was declined; the team will contact the customer. |
| `cancelled` | Cancelled. |
| `held_in_batch`, `in_batch_parcel` | Company accounts only: waiting to ship together with colleagues' parcels. |

The UI journey groups these into: `placed → preparing → ready → with_courier → in_transit → out_for_delivery → delivered`.

### Payment

| Field | Values |
|---|---|
| `order.transaction.payment_method` | `cash` (cash on delivery, the default), `credit_card` (any hosted payment: card, mobile wallet, instalments), `wallet`, `company_account`, `bank_transfer` (no screen offers it). `"cod"` is not a valid value. |
| `order.transaction.status` | `pending` (cash, nothing collected yet), `paid`, `failed`, `refunded` |
| Card payment record (`payment.status`) | `pending`, `paid` (order created), `failed` (payment page could not be opened), `expired` (abandoned), `paid_order_failed` (money taken, order not created: support case), `amount_mismatch` (money taken but the basket total changed: support case) |
| Wallet top-up `status` | `pending`, `paid`, `failed`, `expired`, `paid_credit_failed` (money taken, wallet not credited: support case) |
| Wallet account `status` | `active`, `frozen` |

### Returns

| Field | Values |
|---|---|
| Return request `status` | `pending_vendor_review` (customer can still cancel) → `vendor_approved` / `vendor_rejected` → `pending_admin_review` → `approved` / `rejected` → `return_shipping` → `return_received` → `refund_processing` → `completed`. `cancelled` = withdrawn by the customer. |
| Order item `return_status` | `none`, `return_requested`, `return_approved`, `return_in_progress`, `returned`, `refunded` |
| `reason` | `defective`, `wrong_item`, `not_as_described`, `changed_mind`, `other` |
| `fault_type` | `vendor_fault`, `customer_fault`, `undetermined` |
| `default_refund_method` | `store_credit`, `original_payment`, `bank_transfer`, `company_account` |

### Family, friends, invitations, tickets

| Field | Values |
|---|---|
| Family membership `role` | `organizer`, `member` |
| Family membership `status` | `active`, `left`, `removed` |
| Family `relationship` | `son`, `daughter`, `husband`, `wife`, `parent`, `sibling`, `other` |
| Family order request `status` | `pending_approval`, `declined`, `withdrawn`, `expired`, `approved_payment_needed`, `payment_in_progress`, `order_placed` |
| Family request `decline_reason` | `too_expensive`, `wrong_products`, `wrong_address`, `order_later`, `other` |
| Friendship `status` | `active`, `removed`, `blocked` |
| Friend invitation `status` | `pending`, `accepted`, `declined`, `cancelled`, `expired` |
| Family / company invitation `status` | `pending`, `accepted`, `declined`, `expired`, `revoked` |
| Ticket `status` | `open`, `pending` (support replied), `resolved`, `closed` |
| Ticket `priority` | `low`, `medium`, `high`, `urgent` |
| Ticket `category` | `account`, `order`, `product`, `payment`, `technical`, `other` |

### Catalog

| Field | Values |
|---|---|
| Product `part_type` | `original`, `oem`, `aftermarket`, `null` |
| Product `stock_status` | `instock`, `outofstock`, `onbackorder` |
| Product `discount_type` | `fixed`, `percentage`, `null` |
| Bundle `pricing_mode` | `fixed`, `percent`, `amount` |
| Ad event `event` | `impression`, `click`, `action` |
| Shipping method `type` | `flat`, `weight_tier`, `class_based`, `rule_engine` |

---

## Appendix B: Notification types

`GET /api/users/notifications` returns these `type` values. Each notification also has a translated `title` and `message`, a web `link` and a small `data` object.

| Area | Types |
|---|---|
| Family | `family_invitation_accepted`, `family_invitation_declined`, `family_member_removed`, `family_member_left`, `family_address_access_changed`, `family_order_request_received`, `family_order_request_approved`, `family_order_request_declined`, `family_order_request_withdrawn`, `family_order_request_expiring`, `family_order_request_expired`, `family_order_payment_failed`, `family_order_placed` |
| Friends | `friend_invitation_received`, `friend_invitation_accepted`, `friend_invitation_declined`, `friendship_removed`, `friend_address_access_changed`, `friend_order_paid`, `friend_order_created`, `friend_order_payment_failed` |
| Points | `loyalty_points_available`, `loyalty_points_adjusted` |
| Wallet | `wallet_topped_up`, `wallet_refund_credited`, `wallet_order_paid`, `wallet_order_refunded`, `wallet_adjusted`, `wallet_status_changed` |
| Parcels | `sub_order_out_for_delivery`, `sub_order_delivered`, `sub_order_cancelled`, `sub_order_reactivated` |
| Company | `company_invitation_accepted`, `company_invitation_declined`, `company_member_left`, `company_member_removed`, `company_role_changed`, `company_member_deactivated`, `company_member_reactivated`, `company_batch_released`, `company_invoice_issued`, `company_invoice_withdrawn`, `company_cap_alert`, `company_contract_ended`, `company_refund_sent`, `company_invoice_reminder`, `company_invoice_overdue`, `company_payment_recorded`, `company_payment_rejected`, `company_suspended`, `company_billing_mode_changed`, `company_reactivated` |

`family_order_payment_needed` also exists in the list, but nothing sends it.

---

## Appendix C: Known issues

Found in the code while writing this file. App developers should code around them; the backend team should fix them. Each one is also noted on its endpoint.

**Broken**
- `POST /api/orders/friend-checkout/confirm-payment` fails for every payment not yet turned into an order: `400 FRIEND_CHECKOUT_ERROR "confirmFawaterakOrderPayment is not a function"`. The function was renamed to `confirmOrderPayment` and this caller was not updated. The web checkout calls this endpoint, so a card payment for a friend does not become an order. Workaround: `POST /api/orders/confirm-payment` with the same `paymentId`.

**Data the customer should not receive**
- `POST /api/upload` needs no sign-in, and it keeps the file extension the client sent. A file named `.html` or `.svg` that starts with image bytes is saved and served from `https://readycar.store/uploads/...` as a web page: a likely stored-XSS hole on the main domain.
- Order responses (`GET /api/users/orders`, `POST /api/orders`) include store commission (`commission_rate`, `commission_amount`, `commission_total`) and the raw payment provider data (`transaction.provider_payload`). Return requests also include item commission.
- `GET /api/users/profile` includes `cod_risk`, with the admin's override reason and name.
- `GET /api/tickets/:id` and the `ticket:updated` socket event include the admin-only fields `adminNote`, `assignedTo` and `assignedToName`.
- `GET /api/settings` returns internal configuration: commission, payout schedule, COD policy, Paymob pilot user ids.
- `GET /api/vendors/public/:username` returns the store's phone and email. Both store endpoints return the pickup address and Bosta location id. `GET /api/returns/:id` returns the store's email and phone.
- `POST /api/orders/preview` shows an unconfirmed guest's points balance.
- Several routes neither refuse nor reduce data for an unconfirmed guest: `PUT /api/users/profile` and `PUT /api/users/profile-photo` (full profile back), `POST /api/users/addresses` (full address book back), `GET` / `POST /api/users/cart`, `POST /api/users/cars`, `GET /api/auth/me`.

**Wrong results**
- `GET /api/products`: `sort=price_low|price_high` sorts by the base price, but `min_price` / `max_price` filter by the discounted price.
- `search` on services and articles is used as a raw regular expression: `(` gives a `500`.
- `page=0` gives a `500`, and `limit` has no maximum on products, services and articles.
- Shipping is priced at 0 when `shipping_destination` is missing (orders), or when `shipping_method_id` is missing (buying for a friend).
- `POST /api/orders/confirm-payment` is not safe against two calls at the same moment: both can create an order.
- `payment_method: "bank_transfer"` on `POST /api/orders` skips the COD eligibility check and ships with nothing to collect.
- `POST /api/auth/register-user` refuses a guest who registers with the phone typed exactly as before (`Phone already in use`), so the guest cannot claim the account this way. A missing `phone` gives `500` instead of `400`.
- `PUT /api/users/change-password` has no minimum length; other password endpoints need 6 or 8 characters.
- `POST /api/returns`: `TOO_MUCH_EVIDENCE`, `MULTI_PARCEL_RETURN`, an invalid `reason` and a malformed `order_id` come back as `500`.
- `POST /api/users/company/orders/:orderId/settle`: a short or frozen wallet comes back as `500`.
- `POST /api/friend-invitations/:token/accept`: when the account has no address and none is sent, the code is already used up before the `ADDRESS_REQUIRED` error, so the retry needs a new code.
- `POST /api/family-invitations/:token/accept-with-registration` does not check the channel; on a WhatsApp invitation it most likely answers `EMAIL_IN_USE`.
- The "invitation declined" notification for a WhatsApp family invitation reads "Your invitation to null was declined."
- `family_order_request_expiring` is sent again every hour during a request's last 6 hours.
- `POST /api/contact` has no rate limit.
- Wallet top-ups still work when wallet checkout is switched off.
- The friend-checkout preview falls back to the currency `QAR` when the site currency is not set.

---

## Appendix D: Endpoint index

All 163 endpoints in this file, in the order they appear.

**3. Sign-in and account**

| Method | Path | Auth |
|---|---|---|
| `POST` | [`/api/auth/register-user`](#post-apiauthregister-user) | Public |
| `POST` | [`/api/auth/verify-registration-otp`](#post-apiauthverify-registration-otp) | Public |
| `POST` | [`/api/auth/resend-registration-otp`](#post-apiauthresend-registration-otp) | Public |
| `GET` | [`/api/auth/verify-email`](#get-apiauthverify-email) | Public |
| `POST` | [`/api/auth/verify-email`](#post-apiauthverify-email) | Public |
| `POST` | [`/api/auth/login-user`](#post-apiauthlogin-user) | Public |
| `GET` | [`/api/auth/google/config`](#get-apiauthgoogleconfig) | Public |
| `POST` | [`/api/auth/google`](#post-apiauthgoogle) | Public |
| `POST` | [`/api/auth/google/complete`](#post-apiauthgooglecomplete) | Public |
| `POST` | [`/api/auth/otp-login/send`](#post-apiauthotp-loginsend) | Public |
| `POST` | [`/api/auth/otp-login/verify`](#post-apiauthotp-loginverify) | Public |
| `GET` | [`/api/auth/me`](#get-apiauthme) | User or Vendor |
| `POST` | [`/api/auth/logout`](#post-apiauthlogout) | Public |
| `POST` | [`/api/auth/guest/lookup`](#post-apiauthguestlookup) | Public |
| `POST` | [`/api/auth/guest/session`](#post-apiauthguestsession) | Public |
| `POST` | [`/api/auth/guest/confirm/send`](#post-apiauthguestconfirmsend) | User |
| `POST` | [`/api/auth/guest/confirm`](#post-apiauthguestconfirm) | User |
| `POST` | [`/api/auth/guest/password`](#post-apiauthguestpassword) | User |
| `POST` | [`/api/auth/forgot-password`](#post-apiauthforgot-password) | Public |
| `POST` | [`/api/auth/reset-password`](#post-apiauthreset-password) | Public |
| `POST` | [`/api/auth/forgot-password/otp`](#post-apiauthforgot-passwordotp) | Public |
| `POST` | [`/api/auth/reset-password/otp`](#post-apiauthreset-passwordotp) | Public |
| `GET` | [`/api/users/verification/status`](#get-apiusersverificationstatus) | User or Vendor |
| `POST` | [`/api/users/verification/send`](#post-apiusersverificationsend) | User or Vendor |
| `POST` | [`/api/users/verification/confirm`](#post-apiusersverificationconfirm) | User or Vendor |
| `POST` | [`/api/users/verification/cancel`](#post-apiusersverificationcancel) | User or Vendor |
| `GET` | [`/api/users/profile`](#get-apiusersprofile) | User |
| `PUT` | [`/api/users/profile`](#put-apiusersprofile) | User |
| `PUT` | [`/api/users/profile-photo`](#put-apiusersprofile-photo) | User |
| `PUT` | [`/api/users/change-password`](#put-apiuserschange-password) | User, confirmed |
| `POST` | [`/api/users/addresses`](#post-apiusersaddresses) | User |
| `PUT` | [`/api/users/addresses/:id`](#put-apiusersaddressesid) | User, confirmed |
| `DELETE` | [`/api/users/addresses/:id`](#delete-apiusersaddressesid) | User, confirmed |
| `POST` | [`/api/users/cars`](#post-apiuserscars) | User |
| `DELETE` | [`/api/users/cars/:id`](#delete-apiuserscarsid) | User, confirmed |
| `GET` | [`/api/users/recommendations`](#get-apiusersrecommendations) | User, confirmed |

**4. Catalog**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/products/categories`](#get-apiproductscategories) | Public |
| `GET` | [`/api/products/filters`](#get-apiproductsfilters) | Public |
| `GET` | [`/api/products/car-brands/:id/models`](#get-apiproductscar-brandsidmodels) | Public |
| `GET` | [`/api/products`](#get-apiproducts) | Public |
| `GET` | [`/api/products/suggest`](#get-apiproductssuggest) | Public |
| `GET` | [`/api/products/landing/:section`](#get-apiproductslandingsection) | Public |
| `GET` | [`/api/products/slug/:slug`](#get-apiproductsslugslug) | Public |
| `GET` | [`/api/products/:id`](#get-apiproductsid) | Public |
| `GET` | [`/api/bundles/landing`](#get-apibundleslanding) | Public |
| `GET` | [`/api/bundles/slug/:slug`](#get-apibundlesslugslug) | Public |
| `GET` | [`/api/bundles/:id`](#get-apibundlesid) | Public |
| `GET` | [`/api/services`](#get-apiservices) | Public |
| `GET` | [`/api/services/featured`](#get-apiservicesfeatured) | Public |
| `GET` | [`/api/services/banner-ads`](#get-apiservicesbanner-ads) | Public |
| `GET` | [`/api/services/slug/:slug`](#get-apiservicesslugslug) | Public |
| `GET` | [`/api/vendors/public`](#get-apivendorspublic) | Public |
| `GET` | [`/api/vendors/public/:username`](#get-apivendorspublicusername) | Public |
| `GET` | [`/api/ads/banners`](#get-apiadsbanners) | Public |
| `GET` | [`/api/ads/homepage-banners`](#get-apiadshomepage-banners) | Public |
| `GET` | [`/api/ads/promoted-products`](#get-apiadspromoted-products) | Public |
| `POST` | [`/api/ads/events`](#post-apiadsevents) | Optional user |

**5. Site content**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/settings`](#get-apisettings) | Public |
| `GET` | [`/api/pages/:slug`](#get-apipagesslug) | Public |
| `GET` | [`/api/articles`](#get-apiarticles) | Public |
| `GET` | [`/api/articles/slug/:slug`](#get-apiarticlesslugslug) | Public |
| `GET` | [`/api/corporate-clients`](#get-apicorporate-clients) | Public |
| `POST` | [`/api/contact`](#post-apicontact) | Public |

**6. Cart, shipping and checkout**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/users/cart`](#get-apiuserscart) | User |
| `POST` | [`/api/users/cart`](#post-apiuserscart) | User |
| `GET` | [`/api/shipping/zones`](#get-apishippingzones) | Public |
| `GET` | [`/api/shipping/cities`](#get-apishippingcities) | Public |
| `GET` | [`/api/shipping/classes`](#get-apishippingclasses) | Public |
| `POST` | [`/api/shipping/quote`](#post-apishippingquote) | User |
| `POST` | [`/api/orders/preview`](#post-apiorderspreview) | User |
| `POST` | [`/api/coupons/validate`](#post-apicouponsvalidate) | User |
| `POST` | [`/api/orders`](#post-apiorders) | User |
| `POST` | [`/api/orders/confirm-payment`](#post-apiordersconfirm-payment) | User |
| `POST` | [`/api/orders/friend-checkout/preview`](#post-apiordersfriend-checkoutpreview) | User |
| `POST` | [`/api/orders/friend-checkout/create-payment`](#post-apiordersfriend-checkoutcreate-payment) | User |
| `POST` | [`/api/orders/friend-checkout/confirm-payment`](#post-apiordersfriend-checkoutconfirm-payment) | User |
| `GET` | [`/api/payments/paymob/return`](#get-apipaymentspaymobreturn) | Public |
| `POST` | [`/api/payments/paymob/webhook`](#post-apipaymentspaymobwebhook) | Server-to-server |
| `POST` | [`/api/orders/fawaterak/webhook_json`](#post-apiordersfawaterakwebhook_json) | Server-to-server |
| `POST` | [`/api/users/wallet/fawaterak/webhook_json`](#post-apiuserswalletfawaterakwebhook_json) | Server-to-server |

**7. After the order**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/users/orders`](#get-apiusersorders) | User, confirmed |
| `GET` | [`/api/users/orders/:id/tracking`](#get-apiusersordersidtracking) | User, confirmed |
| `POST` | [`/api/users/orders/:id/sub-orders/:subOrderId/cancel`](#post-apiusersordersidsub-orderssuborderidcancel) | User, confirmed |
| `POST` | [`/api/users/orders/:id/parcels/:subOrderId/review-link`](#post-apiusersordersidparcelssuborderidreview-link) | User, confirmed |
| `POST` | [`/api/returns`](#post-apireturns) | User |
| `GET` | [`/api/returns`](#get-apireturns) | User |
| `GET` | [`/api/returns/:id`](#get-apireturnsid) | User |
| `POST` | [`/api/returns/:id/cancel`](#post-apireturnsidcancel) | User |
| `GET` | [`/api/returns/:id/tracking`](#get-apireturnsidtracking) | User |
| `GET` | [`/api/reviews/product/:productId`](#get-apireviewsproductproductid) | Public |
| `GET` | [`/api/reviews/vendor/:vendorId`](#get-apireviewsvendorvendorid) | Public |
| `GET` | [`/api/reviews/invite/:token`](#get-apireviewsinvitetoken) | Public |
| `POST` | [`/api/reviews/invite/:token/images`](#post-apireviewsinvitetokenimages) | Public |
| `POST` | [`/api/reviews/invite/:token`](#post-apireviewsinvitetoken) | Public |

**8. Wallet and points**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/users/wallet`](#get-apiuserswallet) | User, confirmed |
| `GET` | [`/api/users/wallet/transactions`](#get-apiuserswallettransactions) | User, confirmed |
| `GET` | [`/api/users/wallet/topups`](#get-apiuserswallettopups) | User, confirmed |
| `POST` | [`/api/users/wallet/topups`](#post-apiuserswallettopups) | User, confirmed |
| `POST` | [`/api/users/wallet/topups/confirm`](#post-apiuserswallettopupsconfirm) | User, confirmed |
| `GET` | [`/api/users/loyalty`](#get-apiusersloyalty) | User, confirmed |
| `GET` | [`/api/users/loyalty/transactions`](#get-apiusersloyaltytransactions) | User, confirmed |

**9. Family**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/users/family`](#get-apiusersfamily) | User |
| `GET` | [`/api/users/family/shared-addresses`](#get-apiusersfamilyshared-addresses) | User, confirmed |
| `POST` | [`/api/users/family/invitations`](#post-apiusersfamilyinvitations) | User, confirmed |
| `POST` | [`/api/users/family/invitations/:id/resend`](#post-apiusersfamilyinvitationsidresend) | User |
| `DELETE` | [`/api/users/family/invitations/:id`](#delete-apiusersfamilyinvitationsid) | User |
| `PUT` | [`/api/users/family/members/:memberId/addresses`](#put-apiusersfamilymembersmemberidaddresses) | User |
| `DELETE` | [`/api/users/family/members/:memberId`](#delete-apiusersfamilymembersmemberid) | User |
| `POST` | [`/api/users/family/leave`](#post-apiusersfamilyleave) | User |
| `POST` | [`/api/users/family/order-requests`](#post-apiusersfamilyorder-requests) | User |
| `GET` | [`/api/users/family/order-requests`](#get-apiusersfamilyorder-requests) | User |
| `GET` | [`/api/users/family/order-requests/:id`](#get-apiusersfamilyorder-requestsid) | User |
| `POST` | [`/api/users/family/order-requests/:id/withdraw`](#post-apiusersfamilyorder-requestsidwithdraw) | User |
| `POST` | [`/api/users/family/order-requests/:id/decline`](#post-apiusersfamilyorder-requestsiddecline) | User |
| `POST` | [`/api/users/family/order-requests/:id/approve`](#post-apiusersfamilyorder-requestsidapprove) | User |
| `GET` | [`/api/users/family/order-requests/:id/checkout-preview`](#get-apiusersfamilyorder-requestsidcheckout-preview) | User |
| `POST` | [`/api/users/family/order-requests/:id/place-cod`](#post-apiusersfamilyorder-requestsidplace-cod) | User |
| `POST` | [`/api/users/family/order-requests/:id/create-payment`](#post-apiusersfamilyorder-requestsidcreate-payment) | User |
| `POST` | [`/api/users/family/order-requests/:id/confirm-payment`](#post-apiusersfamilyorder-requestsidconfirm-payment) | User |
| `POST` | [`/api/users/family/order-requests/:id/payment-failed`](#post-apiusersfamilyorder-requestsidpayment-failed) | User |
| `GET` | [`/api/family-invitations/:token`](#get-apifamily-invitationstoken) | Public |
| `POST` | [`/api/family-invitations/:token/accept`](#post-apifamily-invitationstokenaccept) | User |
| `POST` | [`/api/family-invitations/:token/accept-with-registration`](#post-apifamily-invitationstokenaccept-with-registration) | Public |
| `POST` | [`/api/family-invitations/:token/send-code`](#post-apifamily-invitationstokensend-code) | Public |
| `POST` | [`/api/family-invitations/:token/accept-with-code`](#post-apifamily-invitationstokenaccept-with-code) | Public |
| `POST` | [`/api/family-invitations/:token/decline`](#post-apifamily-invitationstokendecline) | Public |

**10. Friends**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/users/friends`](#get-apiusersfriends) | User |
| `GET` | [`/api/users/friends/purchasable`](#get-apiusersfriendspurchasable) | User, confirmed |
| `GET` | [`/api/users/friends/orders-for-me`](#get-apiusersfriendsorders-for-me) | User |
| `POST` | [`/api/users/friends/invitations`](#post-apiusersfriendsinvitations) | User, confirmed |
| `POST` | [`/api/users/friends/invitations/:id/accept`](#post-apiusersfriendsinvitationsidaccept) | User |
| `POST` | [`/api/users/friends/invitations/:id/decline`](#post-apiusersfriendsinvitationsiddecline) | User |
| `DELETE` | [`/api/users/friends/invitations/:id`](#delete-apiusersfriendsinvitationsid) | User |
| `GET` | [`/api/users/friends/:friendId/shared-addresses`](#get-apiusersfriendsfriendidshared-addresses) | User |
| `GET` | [`/api/users/friends/:friendId/my-shared-addresses`](#get-apiusersfriendsfriendidmy-shared-addresses) | User |
| `PUT` | [`/api/users/friends/:friendId/my-shared-addresses`](#put-apiusersfriendsfriendidmy-shared-addresses) | User |
| `DELETE` | [`/api/users/friends/:friendId`](#delete-apiusersfriendsfriendid) | User |
| `POST` | [`/api/users/friends/:friendId/block`](#post-apiusersfriendsfriendidblock) | User |
| `GET` | [`/api/friend-invitations/:token`](#get-apifriend-invitationstoken) | Public |
| `POST` | [`/api/friend-invitations/:token/send-code`](#post-apifriend-invitationstokensend-code) | Public |
| `POST` | [`/api/friend-invitations/:token/accept`](#post-apifriend-invitationstokenaccept) | Public |
| `POST` | [`/api/friend-invitations/:token/decline`](#post-apifriend-invitationstokendecline) | Public |
| `GET` | [`/api/invitations/:token/resolve`](#get-apiinvitationstokenresolve) | Public |

**11. Notifications and support**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/users/notifications`](#get-apiusersnotifications) | User |
| `GET` | [`/api/users/notifications/count`](#get-apiusersnotificationscount) | User |
| `PUT` | [`/api/users/notifications/:id/read`](#put-apiusersnotificationsidread) | User |
| `PUT` | [`/api/users/notifications/read-all`](#put-apiusersnotificationsread-all) | User |
| `POST` | [`/api/tickets`](#post-apitickets) | User or Vendor |
| `GET` | [`/api/tickets`](#get-apitickets) | User or Vendor |
| `GET` | [`/api/tickets/:id`](#get-apiticketsid) | User or Vendor |
| `POST` | [`/api/tickets/:id/messages`](#post-apiticketsidmessages) | User or Vendor |

**12. Company accounts (employee side)**

| Method | Path | Auth |
|---|---|---|
| `GET` | [`/api/users/company`](#get-apiuserscompany) | User |
| `GET` | [`/api/users/company/orders`](#get-apiuserscompanyorders) | User |
| `GET` | [`/api/users/company/batches`](#get-apiuserscompanybatches) | User |
| `POST` | [`/api/users/company/orders/:orderId/parcels/:subOrderId/ship-now`](#post-apiuserscompanyordersorderidparcelssuborderidship-now) | User |
| `POST` | [`/api/users/company/orders/:orderId/settle`](#post-apiuserscompanyordersorderidsettle) | User |
| `GET` | [`/api/company-invitations/:token`](#get-apicompany-invitationstoken) | Public |
| `POST` | [`/api/company-invitations/:token/accept`](#post-apicompany-invitationstokenaccept) | User |
| `POST` | [`/api/company-invitations/:token/accept-with-registration`](#post-apicompany-invitationstokenaccept-with-registration) | Public |
| `POST` | [`/api/company-invitations/:token/send-code`](#post-apicompany-invitationstokensend-code) | Public |
| `POST` | [`/api/company-invitations/:token/accept-with-code`](#post-apicompany-invitationstokenaccept-with-code) | Public |
| `POST` | [`/api/company-invitations/:token/decline`](#post-apicompany-invitationstokendecline) | Public |

**13. Uploads**

| Method | Path | Auth |
|---|---|---|
| `POST` | [`/api/upload`](#post-apiupload) | Public |
