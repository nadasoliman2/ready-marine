# 3 - Invite Friends and Buy for a Friend

> Status: Core product flow confirmed · Created: 2026-07-27 · Updated: 2026-07-27 · No implementation changes included

## Product Summary

Add a **Friends** area to the customer profile. A customer can invite another
customer using an email address or phone number. The invited customer receives
an in-app invitation and explicitly accepts or declines it.

After acceptance, the relationship is mutual. Either customer can buy parts for
the other customer, using only a delivery address the recipient explicitly
shared with that friend.

Both customers must select which of their own saved addresses they share with
the other customer:

- A selects A's addresses that B may use when buying a gift for A.
- B selects B's addresses that A may use when buying a gift for B.
- Neither side selects, edits, or manages the other side's addresses.

For a friend order:

- The customer starting checkout is the **payer**.
- The selected friend is the **recipient / beneficiary**.
- Payment is **online only**.
- No real marketplace order is created until the payment provider confirms that
  payment succeeded.
- The payer owns all financial actions. The recipient gets read-only visibility
  into delivery and tracking.

Arabic customer-facing terminology:

| English | Arabic |
| --- | --- |
| Friends | الأصدقاء |
| Invite a friend | دعوة صديق |
| Friend request | طلب صداقة |
| Buy for a friend | اشتري لصديق |
| Paying customer | الدافع |
| Recipient | المستلم |
| Shared addresses | العناوين المشتركة |
| Online payment only | الدفع أونلاين فقط |

## Confirmed Product Decision

The Project Owner confirmed the required flow:

> Ahmed chooses products for Sara, ships them to Sara, and Ahmed pays online.

Therefore:

- The buyer selects the products.
- The buyer starts and completes online payment.
- The friend is the recipient.
- Delivery goes to the friend's authorized address.
- The buyer owns cancellation, return, refund, and all other financial actions.
- The friend gets read-only order and shipment tracking.
- There is no approval or **Ask a friend to pay** step in the MVP.
- Friendship is mutual: either customer can be the buyer or recipient on a
  different order.
- Address access is mutual in capability but directional in data: each customer
  explicitly chooses which of their own addresses the other customer may use.

The alternative flow where the recipient prepares a cart and asks a friend to
pay is explicitly outside the current feature scope.

## Existing ReadyCar Assessment

### Capabilities to reuse

- Customer lookup already supports email or phone.
- Email and phone are unique on customer accounts.
- Customer in-app notifications and unread counts already exist.
- Profile tabs and Arabic/English localization already exist.
- Saved addresses already have stable subdocument IDs and delivery-zone data.
- Checkout already recalculates product, coupon, stock, shipping, and totals on
  the server.
- Hosted online payment through Fawaterak already creates a payment first and an
  order after confirmed payment.
- Payment confirmation already handles redirects, webhooks, and repeated
  confirmation calls.
- The existing family feature contains useful patterns for invitation tokens,
  address sharing, provenance, notifications, and payment idempotency.

### Existing family functionality that does not fit as-is

- Family membership is hierarchical: one organizer and multiple members.
- An account may have only one active family membership.
- Family invitations accept email only.
- Family relationships include son, daughter, spouse, and similar labels.
- The current family purchase flow is member request → organizer approval.
- The organizer can currently choose cash on delivery or online payment.

Friendship must instead be:

- Symmetric after acceptance.
- Many-to-many: a customer can have multiple friends.
- Identified by email **or** phone.
- Free of organizer/member and family-relationship roles.
- Online-only for orders placed for a friend.

### Recommended code strategy

If the Family feature has not been released and it was built for this same
business requirement, refactor it into Friends instead of maintaining two
overlapping concepts.

If Family is a separate released feature, add Friends as separate models and
routes, while extracting shared invitation, notification, address-authorization,
and payment helpers. Do not rename live Family collections in place.

## Roles and Ownership

| Capability | Payer | Recipient friend | Other customer | Vendor/Admin |
| --- | :---: | :---: | :---: | :---: |
| Send/accept a friend request | ✓ | ✓ | — | — |
| Share own addresses | ✓ | ✓ | — | — |
| View explicitly shared addresses | ✓ | ✓ | — | — |
| Edit another person's address | — | — | — | — |
| Start an order for a friend | ✓ | — | — | — |
| Pay for the order | ✓ | — | — | — |
| Manage refund/cancellation | ✓ | — | — | Existing access |
| Track delivery | ✓ | Read-only | — | Existing access |

Financial ownership is always explicit:

- `Order.user_id = payer_user_id`
- `Order.paid_by_user_id = payer_user_id`
- `Order.ordered_for_user_id = recipient_user_id`
- Refunds return to the payer's original payment method.
- The shipping address is a snapshot of an address owned by the recipient.

## Journey 1: Invite a Friend

1. Customer opens **Profile → Friends**.
2. Customer enters one value in **Email or phone number**.
3. Customer selects one or more of their own saved addresses to share with the
   invited friend.
4. Backend normalizes the identifier using the same rules as
   login/registration.
5. Backend blocks inviting the current account.
6. If a matching customer exists, create a pending friend invitation and an
   in-app notification for that customer.
7. The recipient opens the notification and sees the sender's safe public
   profile: name and avatar only.
8. To accept, the recipient selects one or more of their own saved addresses to
   share back with the sender.
9. Acceptance creates one active symmetric friendship and persists the two
   directional address-sharing lists.
10. Both customers receive an in-app confirmation.

Opening a notification must never auto-accept a friend request.

If either customer has no saved address, direct them to create one before they
can send or accept the invitation.

### Existing vs non-existing accounts

The requirement specifically says the invitation is sent **inside the website**.
The cleanest MVP is therefore to invite existing ReadyCar customers only.

To avoid exposing whether an email or phone is registered, return generic copy:

> If this person has a ReadyCar account, they will receive your invitation.

Optional later behavior for non-existing customers:

- Store an invitation claim against a hashed normalized identifier.
- Send an email or SMS deep link.
- Attach the pending invitation after verified registration.

SMS delivery is not required for the in-app-only MVP.

### Invitation rules

- One pending invitation per unordered customer pair.
- If B has already invited A, show that incoming request to A instead of
  creating a second request.
- Existing active friendship returns `ALREADY_FRIENDS`.
- A declined/cancelled request may be resent after a cooldown.
- Invitations expire after seven days.
- Sender can cancel a pending invitation.
- Recipient can decline.
- Either user can remove an active friendship.
- Blocking is strongly recommended before public rollout, even if hidden behind
  a simple **Block** action in the first release.

## Journey 2: Share Delivery Addresses

Each customer controls which of their own saved addresses a particular friend
may use. Initial address selection is required from both sides while creating
the friendship:

- The sender selects their shared addresses before sending the invitation.
- The recipient selects their shared addresses before accepting it.
- After acceptance, both can change their own sharing list at any time.

1. Open a friend card.
2. Select **Manage shared addresses**.
3. Select zero or more of the current customer's saved addresses.
4. Explain that the friend can view and select these addresses only when buying
   for them.
5. Save the access list.

Rules:

- Sharing is directional. A sharing with B does not mean B shares with A.
- Each direction must initially contain at least one address.
- The viewer cannot edit, delete, or create an address for its owner.
- Unsharing takes effect immediately for future checkouts.
- If a customer later removes every shared address, the friendship remains
  active, but the other customer cannot buy a gift for them until an address is
  shared again.
- Address ownership and sharing are rechecked on the backend at preview,
  payment creation, and final order conversion.
- Notifications should not contain full address text.
- If a shared address is deleted, its share record becomes invalid
  automatically and cannot be used.

For privacy, the friend list can initially show only an address label and city.
Show full delivery details only inside the authorized friend checkout.

## Journey 3: Buy Parts for a Friend

### Checkout entry

Reuse the normal cart and product browsing experience. At checkout add:

> Who is this order for?

Options:

- **Myself**
- A list of active friends who have shared at least one address

Because friendship is symmetric, either side can appear as the buyer. The
checkout always derives the current role from the specific order:

- Signed-in customer = buyer and payer.
- Selected friend = recipient.

When the customer selects a friend:

- Switch checkout context to `friend`.
- Show the selected friend's name and avatar.
- Show only that friend's addresses explicitly shared with the payer.
- Hide **Add new address** and every address edit/delete action.
- Reuse live shipping quotation.
- Reuse coupons, but validate eligibility against the payer.
- Hide cash on delivery.
- Show **Online payment only for orders placed for friends**.
- Change the final action to **Pay online for [friend name]**.

If the friend has not shared an address, disable the friend checkout and show:

> Ask Sara to share a delivery address with you first.

### Server-authoritative preview

The preview endpoint receives only:

- Cart/product identifiers and quantities
- `friend_id`
- `recipient_address_id`
- Shipping method
- Coupon code, if any

The backend must derive the payer from the authenticated session, then verify:

1. The friendship is active.
2. Neither account has blocked the other.
3. The address belongs to the selected friend.
4. That address is currently shared with the payer.
5. Products, variants, quantities, stock, and bundles are valid.
6. Coupon eligibility belongs to the payer.
7. The shipping method is currently available.
8. Totals are freshly recalculated.

The browser's names, prices, totals, payer ID, recipient ID, and address snapshot
must never be trusted as authority.

## Journey 4: Online Payment and Order Creation

1. Payer confirms **Pay online for Sara**.
2. Backend repeats authorization and pricing checks.
3. Create an `OrderPayment` with immutable friend-checkout context.
4. Redirect to the hosted Fawaterak payment page.
5. Confirm settlement using the provider response/webhook.
6. Recheck the payment amount against the server-calculated amount.
7. Create one real `Order` only after confirmed payment.
8. Mark the payment as converted and link it to the created order.
9. Notify payer and recipient.
10. Redirect the payer to order details.

There must be no `place-cod` endpoint for friend checkout. Hiding COD in the UI
is not sufficient; the backend must reject it with `FRIEND_ORDER_ONLINE_ONLY`.

### Failed, abandoned, or duplicate payment

- Failed/abandoned payment creates no order.
- Payer can retry by creating a fresh hosted invoice from the same live preview.
- A paid invoice is converted at most once.
- Repeated redirects, button clicks, and webhook delivery return the existing
  order rather than creating duplicates.
- If payment is confirmed but order creation fails, mark the payment
  `paid_order_failed` for operational recovery; never ask the customer to pay
  again.

## Resulting Order Experience

### Payer view

The payer sees the order in normal order history with:

> Ordered for Sara · Paid by you

The payer can access:

- Full order detail
- Payment record
- Cancellation where normally allowed
- Return/refund actions
- Shipment tracking

### Recipient view

The recipient gets an in-app notification and a separate read-only list:

> Orders for me

The recipient can access:

- Order reference
- Purchased items
- Delivery address summary
- Fulfilment and shipment status
- Tracking link

The recipient cannot access:

- Payment details beyond a simple **Paid online** label
- Card/provider references
- Refund controls
- Payer's other orders or saved addresses

### Vendor/admin view

Fulfilment remains a normal paid ReadyCar order. Vendor screens do not need
friendship details. Admin order detail may show payer and recipient for support
and audit purposes.

## State Machines

### Friend invitation

```text
pending
├── accepted  → active friendship
├── declined
├── cancelled
└── expired
```

### Friend online checkout

```text
payment_pending
├── failed / expired        → no order
├── paid_order_failed       → recovery queue
└── paid
    └── order_created       → one immutable order
```

The direct **Buy for a friend** MVP does not need a separate order-request
state machine.

## Recommended Data Model

### `Friendship`

```js
{
  user_low_id: ObjectId,
  user_high_id: ObjectId,
  initiated_by_user_id: ObjectId,
  status: 'active' | 'removed' | 'blocked',
  blocked_by_user_id: ObjectId | null,
  accepted_at: Date,
  ended_at: Date | null,
  created_at: Date,
  updated_at: Date
}
```

Always sort the two customer IDs before persistence and create a unique index on
`{ user_low_id, user_high_id }`. This makes friendship symmetric and prevents
duplicate A↔B / B↔A records.

### `FriendInvitation`

```js
{
  sender_user_id: ObjectId,
  recipient_user_id: ObjectId,
  identifier_type: 'email' | 'phone',
  identifier_masked: String,
  sender_shared_address_ids: [ObjectId],
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired',
  expires_at: Date,
  responded_at: Date | null,
  created_at: Date,
  updated_at: Date
}
```

For existing-account in-app invitations, authorization should use
`recipient_user_id`, not the raw identifier. Keep only a masked identifier if it
is useful for the sender's pending-invitation display.

Create a unique partial index for a pending unordered pair.

### `FriendAddressShare`

```js
{
  friendship_id: ObjectId,
  owner_user_id: ObjectId,
  viewer_user_id: ObjectId,
  address_id: ObjectId,
  created_at: Date
}
```

Unique index:

```js
{ friendship_id: 1, owner_user_id: 1, viewer_user_id: 1, address_id: 1 }
```

The address remains embedded on `User`. The share record grants selection
permission only and never becomes a copy of the address.

### Existing `OrderPayment` additions

```js
{
  checkout_context: 'self' | 'friend',
  friendship_id: ObjectId | null,
  ordered_for_user_id: ObjectId | null,
  recipient_address_id: ObjectId | null
}
```

The existing `checkout_payload` should contain a server-built address and item
snapshot. A client-provided payload is not sufficient.

### Existing `Order` additions

```js
{
  friendship_id: ObjectId | null,
  paid_by_user_id: ObjectId | null,
  ordered_for_user_id: ObjectId | null
}
```

`user_id` remains the payer to preserve compatibility with current financial,
refund, and order-history logic.

## Recommended API Surface

### Friends and invitations

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/users/friends` | Active friends plus incoming/outgoing requests |
| `POST` | `/api/users/friends/invitations` | Invite by email/phone and select sender addresses |
| `POST` | `/api/users/friends/invitations/:id/accept` | Accept and select recipient addresses |
| `POST` | `/api/users/friends/invitations/:id/decline` | Recipient declines |
| `DELETE` | `/api/users/friends/invitations/:id` | Sender cancels |
| `DELETE` | `/api/users/friends/:friendId` | Remove friendship |
| `POST` | `/api/users/friends/:friendId/block` | Block friendship/customer |

### Address sharing

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/users/friends/:friendId/shared-addresses` | Addresses the friend shared with caller |
| `PUT` | `/api/users/friends/:friendId/my-shared-addresses` | Replace caller's addresses shared to friend |

### Checkout and payment

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/orders/friend-checkout/preview` | Authoritative price and shipping preview |
| `POST` | `/api/orders/friend-checkout/create-payment` | Create hosted online invoice |
| `POST` | `/api/orders/friend-checkout/confirm-payment` | Confirm redirect idempotently |

The existing payment webhook should also convert friend payments. Redirect
confirmation is a convenience, not the only source of truth.

## Profile and Notification UX

Add **Friends** to the customer profile navigation. The tab order should be:

1. Incoming friend requests
2. Friends
3. Pending invitations
4. Invite a friend

Each friend card shows:

- Avatar and name
- Whether each side has shared a usable address
- **Buy for this friend**
- **Manage my shared addresses**
- **Remove friend**

Recommended customer notification types:

- `friend_invitation_received`
- `friend_invitation_accepted`
- `friend_invitation_declined`
- `friendship_removed`
- `friend_address_access_changed`
- `friend_order_paid`
- `friend_order_created`
- `friend_order_payment_failed`

Friend-invitation notifications must deep-link to the Friends tab or a dedicated
request review screen.

## Security and Privacy

- Protect every route with a customer session.
- Normalize email and phone exactly as authentication does.
- Do not expose whether an arbitrary email/phone has an account.
- Rate-limit invite creation, acceptance, and resend.
- Never allow admin/vendor sessions to participate as customer friends.
- Return `404` for friendship/order resources the caller is not party to.
- Derive payer from the session; never accept `payer_user_id` from the client.
- Resolve recipient from an active friendship; never trust a free user ID.
- Recheck address ownership/share permission at every sensitive transition.
- Never expose another customer's cart, garage, phone, email, or unshared
  addresses merely because they are a friend.
- Record audit logs for invite acceptance, address sharing, friendship removal,
  payment conversion, and refund.
- Consider a maximum active-friend count and invitation velocity limit to reduce
  spam.

## Edge Cases

- Inviting yourself by alternate formatting of the same email/phone.
- A invites B while B already has a pending invitation to A.
- Friendship is removed while payer is on checkout.
- Recipient unshares or deletes the address during hosted payment.
- Recipient changes the address after payment but before conversion.
- Product price or stock changes before payment creation.
- Payment succeeds after the friendship is removed.
- Duplicate provider webhook and redirect confirmation arrive together.
- Payer blocks recipient after the order is created.
- Recipient account is deleted while an order is in transit.
- Payer account is deleted while a refund is pending.

For a payment already confirmed by the provider, use the immutable server-built
checkout snapshot to finish order conversion even if friendship/address state
changes during the external payment round trip. Friendship must be active when
the payment is **created**, but revoking it after funds are captured must not
strand a paid transaction.

## MVP Scope

### Include

- Existing customer → existing customer in-app invitation.
- Email or phone input.
- Explicit accept/decline/cancel.
- Symmetric multiple friendships.
- Directional saved-address sharing.
- Buy-for-friend checkout.
- Online payment only.
- Order creation after confirmed payment.
- Payer ownership and recipient read-only tracking.
- Arabic and English copy.
- In-app notifications, unread badges, rate limiting, audit logs, and
  idempotency.

### Defer

- Inviting people without ReadyCar accounts by SMS/email.
- Contact-list import.
- Social discovery or searching by name.
- Asking a friend to pay for a prepared cart.
- Splitting payment between friends.
- Wallet transfers or stored balance.
- Shared carts and real-time collaborative shopping.
- Multiple recipients in one order.
- Friend groups.

## Delivery Plan

### Phase 0: Confirm product behavior

- **Confirmed:** the person starting checkout selects the products and pays.
- **Confirmed:** the selected friend is the recipient and can track the order
  read-only.
- **Confirmed:** friend orders use online payment only.
- **Confirmed:** either side can buy a gift for the other.
- **Confirmed:** both sides select which of their own existing addresses they
  share with the other side.
- Confirm existing-account-only invitations for the MVP.
- Confirm whether the current Family feature will be replaced or remain
  separate.

Exit criterion: the remaining invitation and Family migration decisions are
approved.

### Phase 1: Friendship foundation

- Add friendship and invitation models/indexes.
- Add normalized email/phone invite service.
- Add accept, decline, cancel, remove, and block authorization.
- Add in-app notifications and audit events.
- Add API contract tests for duplicate and reverse-pair invitations.

Exit criterion: two test customers can safely become and stop being friends.

### Phase 2: Profile and address sharing

- Add Profile → Friends UI.
- Add incoming, active, and outgoing invitation states.
- Add directional address-sharing controls.
- Add privacy-safe address API shapes.
- Add Arabic/English copy and responsive states.

Exit criterion: an authorized friend can read only explicitly shared addresses.

### Phase 3: Friend checkout

- Add **Who is this order for?** selection.
- Add friend address and shipping selection.
- Add server-authoritative preview.
- Hide COD and reject it server-side.
- Handle friendship/address/product changes before invoice creation.

Exit criterion: a friend checkout can produce a valid online-payment preview and
cannot reach COD.

### Phase 4: Payment conversion and order visibility

- Extend `OrderPayment` and `Order` provenance.
- Convert confirmed payments idempotently.
- Add paid-order recovery.
- Add payer order label and recipient read-only order list/detail.
- Add notifications and admin support context.

Exit criterion: one successful payment creates exactly one order owned by the
payer and visible read-only to the recipient.

### Phase 5: QA and controlled rollout

- End-to-end test with Fawaterak sandbox.
- Test duplicate webhooks, abandoned redirects, stock changes, and permission
  revocation.
- Add a feature flag for customer rollout.
- Monitor invitation conversion, payment failures, and paid-order recovery.

Exit criterion: no duplicate orders/payments and no unauthorized address/order
access in the release checklist.

## Acceptance Criteria

### Invitation

- Customer can enter either a valid email or a valid phone.
- Sender must select at least one of their own addresses before inviting.
- A generic response prevents account enumeration.
- Matching customer receives an in-app request.
- Only the intended recipient can accept or decline.
- Recipient must select at least one of their own addresses before accepting.
- Accepting creates one mutual active friendship.
- Reverse/duplicate invitations do not create duplicate friendships.

### Address privacy

- Each customer chooses which addresses each friend may use.
- Each side can buy for the other using the recipient's directional sharing
  list.
- A friend cannot view unshared addresses.
- A friend cannot modify another customer's addresses.
- Deleted/unshared addresses cannot start a new payment.

### Checkout

- Payer can select an active friend with a shared address.
- Product, stock, coupon, shipping, and total are recalculated by the backend.
- COD is absent from the UI and rejected by the API.
- The hosted invoice belongs to the authenticated payer.

### Payment and order

- Failed or abandoned payment creates no order.
- Confirmed online payment creates exactly one order.
- Payer owns order, refund, and cancellation controls.
- Recipient gets read-only tracking without financial data.
- Duplicate webhooks and redirects return the same order.
- Paid-but-unconverted payments appear in an operational recovery path.

### Authorization

- Removing/blocking a friendship prevents new friend checkouts.
- A third customer cannot read the friendship, shared addresses, payment, or
  order.
- Vendors receive only normal fulfilment data.

## Analytics

Recommended events:

- `friend_invite_submitted`
- `friend_invite_matched_existing_account`
- `friend_invite_accepted`
- `friend_invite_declined`
- `friend_address_shared`
- `friend_checkout_started`
- `friend_checkout_blocked_no_address`
- `friend_payment_started`
- `friend_payment_succeeded`
- `friend_payment_failed`
- `friend_order_created`

Do not send raw email, phone, address, or names in analytics properties.

Primary funnel:

```text
Invite submitted
→ Invitation viewed
→ Friendship accepted
→ Address shared
→ Friend checkout started
→ Online payment succeeded
→ Order created
```
