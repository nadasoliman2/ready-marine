# Guest Checkout

Accounts created silently from the shipping form. The customer never sees the
word "account" — they fill in the name, phone, and address an order needs
anyway, and those fields become a `User` with `account_status: 'guest'` and no
password.

## ⚠️ Deploy step — run this BEFORE the code goes out

```bash
node scripts/migrateGuestCheckoutIndexes.js            # dry run, reports only
node scripts/migrateGuestCheckoutIndexes.js --apply    # writes
```

**This is not optional.** The `users` collection carries a plain
`unique` index on `email`. Under that index the *first* account without an email
claims the single "missing" slot, and **every guest created after it fails with
a duplicate-key error** — meaning the second guest checkout of the day, and
every one after, silently cannot complete.

A `sparse` index does not fix it either: sparse skips only an *absent* field,
while an explicit `null` is a value and is still indexed. The migration replaces
it with a **partial** index restricted to documents whose email is a string, so
absent and null are both outside the index.

The script is idempotent, refuses to run if real duplicate emails exist (dropping
the unique index over dirty data would silently legalise them), and also stamps
`account_status: 'active'` onto every pre-existing account.

Mongoose's `autoIndex` will *not* do this for you — it issues `createIndex` for
the new definition, MongoDB rejects it with `IndexOptionsConflict` because the
name `email_1` is taken by different options, and the old index stays.

## The disclosure rule

The one invariant the whole feature rests on:

> An account with `account_status: 'guest'` and no `phone_verified_at`
> **discloses nothing** — no saved addresses, no order history, no profile,
> no points, no wallet.

A guest account is addressed by phone number alone, and a phone number is not a
secret. A session on one proves only that somebody typed a number into a form,
so it is worth exactly what the visitor typed themselves and nothing the account
may have accumulated.

Enforced in two layers that do not depend on each other:

| Layer | Where |
|---|---|
| The predicate | `guestDisclosureBlocked()` in `services/guestCheckoutService.js` |
| The request flag | `req.isUnclaimedGuest`, set by `protect()` on every authenticated request |
| The route guard | `denyUnclaimedGuest` in `middleware/authMiddleware.js` |

`GET /users/profile` **redacts** rather than 403s, because checkout itself runs
on a guest session and needs that call to succeed. Everything whose entire
purpose is handing back accumulated data (`/users/orders`, `/loyalty`,
`/wallet`, `/users/recommendations`, family and friend discovery) is refused
outright with `code: 'GUEST_NOT_CONFIRMED'`.

Confirming the WhatsApp code is the **only** transition out of this state.

## Why the code comes after the order

Nothing blocks placing an order. A code demanded before the button is one more
wall between a customer and a purchase; the same code offered on the
confirmation screen is answered by someone who has already committed.

An unconfirmed order is still a real order — it simply carries an unverified
phone, which is the flag ops wants on a cash order anyway:

```js
Order.find({ placed_as_guest: true, guest_phone_confirmed_at: null })
```
(indexed) — *"which COD orders are going to a number nobody has answered on?"*

## Phone numbers are identity now

`formatPhone` only strips non-digits, so `01012345678`, `+201012345678`, and
`00201012345678` used to reach the database as three different strings. Harmless
while a phone was a stored attribute; **not** harmless once the number alone
decides whether we resume an account or create one.

`services/shared/phone.js` provides:

- `canonicalPhone(raw)` — the single form guest checkout **writes** (`01XXXXXXXXX`,
  chosen because it is what the checkout form validates and what most existing
  rows already hold).
- `phoneLookupVariants(raw)` — every form the same number could already be
  stored as, for `$in` **reads**. This is what makes pre-existing rows findable
  without a migration that rewrites live phone numbers.

## Flows

**New customer** — types name + phone → `POST /auth/guest/session` creates the
account and sets the cookie → shipping quote and price preview now work → places
the order → success screen sends the code → confirming claims the account →
optional password, offered last.

**Returning customer** — the phone field's `onBlur` calls
`POST /auth/guest/lookup` (bare `{exists, can_use_password}`, hard rate-limited).
A hit shows an inline offer, never a modal, to sign in with a WhatsApp code.

**A number that already has an account** — `POST /auth/guest/session` refuses
with `409 ACCOUNT_EXISTS`. This is the feature's one catastrophic failure mode
if it ever stops refusing: handing out a session for a real account on nothing
but a typed number. The screen turns the refusal into "confirm with a code" or
"use a different number" — never into a dead end, and never into a fake
"continue anyway" that would fail again at the button.

**A guest who later registers properly** — `assertUserIsUnique` reports the
unclaimed guest back instead of throwing, and `claimGuestAccount` upgrades that
row in place. Without this, registering would hit "Phone already in use" against
an account they cannot sign in to, and their guest orders would be stranded.

## Security notes

- A passwordless account can never authenticate: `authenticateUser` refuses
  before reaching bcrypt, so "no password" is never one quirk away from "any
  password".
- `POST /auth/guest/password` is gated on `phone_verified_at`. Ungated it would
  be a complete takeover primitive — type a stranger's number, take the session,
  set a password, keep the account.
- An unconfirmed guest may spend only money that arrives with the order:
  `payment_method: 'wallet'` is refused and `redeem_points` is forced to 0 in the
  route, independently of the screen never offering them.
- `POST /auth/otp-login/send` always reports success. It is reachable from an
  open checkout page, so a truthful "no such account" would make it a
  phone-number oracle.
- Password reset is email-only, and guests have no email — so there is no path
  to a guest account through it.

---

# Inviting people who have no account

The same pattern, applied to Friends and Family. Both features could previously
only reach people who were already customers: Family emailed a token to an
address that might resolve to nobody, and Friends looked the person up, found
nothing, and **silently did nothing at all** while telling the sender it had
worked.

## How it works now

A mobile number with no account gets a **placeholder guest account** created for
it — the same kind of row checkout creates — and the invitation points at it
normally. Everything downstream (friendships, memberships, address shares,
buying for each other) keeps working against a real `user_id`, because that is
what it gets. What changes is only delivery and proof:

| Invitee | Delivery | Proof |
|---|---|---|
| Existing customer | in-app notification (unchanged) | their session |
| Phone, no account | WhatsApp link + token | code to that number |
| Email, no account | emailed token (unchanged) | the mailbox |

**Email cannot anchor a placeholder.** `phone` is the required, unique field on
a user, so an email invitation to a stranger keeps its original shape — a token
to a mailbox, claimed by whoever signs in with it.

## Opening the link is not accepting

A WhatsApp message can be forwarded, screenshotted, or land in a group. Accepting
grants read access to the **inviter's saved addresses**, so the token gets you a
preview and nothing more; the code sent to the invited number is what accepts.

The preview is deliberately thin — inviter name and avatar, a count of addresses
being shared, and a masked identifier. Never an address, never a full number.

## What each side asks for

- **Friends** — name + address + code. A friendship is symmetric, and a friend
  with no address on file cannot be bought for, so the address is collected at
  the one moment they are certainly paying attention.
- **Family** — name + code. A member orders against the **organizer's** shared
  addresses and never their own, so asking for one would collect something the
  feature does not use.

Neither ever asks for a password.

## Spam controls

Inviting a stranger's number creates a row and sends a WhatsApp message, which
makes both invite endpoints capable of messaging arbitrary numbers. Three layers:

- `MAX_PENDING_INVITATIONS = 20` per sender (Friends) / per family, counting only
  invitations still awaiting an answer.
- Route rate limits: 20 invitations per hour per account.
- `denyUnclaimedGuest` on both invite routes — an unconfirmed guest cannot invite
  anyone at all.

## The link, and why there is only one path

Every WhatsApp invitation points at **`/invite/<token>`**, regardless of feature.

That is a constraint from outside this codebase: a WhatsApp template declares ONE
fixed base URL for its button, and Meta verifies the delivered link begins with
it. Friends and Family have separate landing pages, so without a shared prefix
the template's base would have to be the bare domain.

`/invite/<token>` is a **server component** that asks
`GET /api/invitations/:token/resolve` which kind the token is and issues a 307 to
the existing page. Neither landing page moved, so links already sent under
`/friends/invitation/…` and `/family/invitation/…` keep working. The resolver
answers for invitations in any state, so an expired link still reaches the page
that can explain it rather than a 404.

## Configuration

```
WHATSAPP_INVITE_TEMPLATE_ID=47      # readycar_invitation (UTILITY, ar)
```

Template **47** in the EverySecond account: two variables (inviter name, one
context line) and a required **dynamic URL button**. Defaulted in code the way
every other template id here is, so a fresh environment works unconfigured.

### The mangled button link, and the rescue

That button's base was created as the **bare domain** (`https://readycar.store/`),
not `https://readycar.store/invite/{{1}}`. The provider, in turn, refuses a bare
suffix in `button_url` — sending `invite/<token>` returns
`422 button_url must be a public URL` — so the only accepted value is the whole
link, and WhatsApp delivers the two concatenated:

```
https://readycar.store/https:/readycar.store/invite/<token>   → 404
```

Nothing on the send side can produce a clean link while both of those hold, and
links already sent are out there in that shape. `frontend/src/middleware.js`
therefore forwards any path ending in `/invite/<token>` — or `/review/<token>`,
whose template (42) has the same shape and was not separately verified — to the
real page with a 307. The
canonical paths have nothing in front of the token, so they never match their
own rule.

The provider does not validate `button_url` against the template's base at all —
`https://example.com/foo` is accepted — so it substitutes the value verbatim and
never strips the base Meta prepends. That means **no** value we can send yields a
clean link: getting one requires the provider to pass the path-suffix instead of
the whole URL (a support request on their side). The middleware is the fix that
is ours to make, and it keeps working whether or not they change anything.

Probe the provider's validation without sending a message by posting a send with
a deliberately invalid phone (`'2011'`) — a 422 that only complains about the
phone means the `button_url` passed validation.

If the id is ever pointed at nothing, WhatsApp invitations are refused with
`INVITE_DELIVERY_UNAVAILABLE` and the invitation row is deleted — so the sender
retries cleanly instead of being told to "resend" something that never left.
Invitations to existing customers and to email addresses are unaffected.

`resendInvitation` re-sends over the channel the invitation was originally sent
by. A WhatsApp invitation carries no email address, so mailing it would have
delivered to nobody while reporting success.

No migration is required: `FamilyInvitation.email` becomes nullable and its index
was never unique, and the new `FriendInvitation` fields all default.
