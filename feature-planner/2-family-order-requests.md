# 2 - Family Order Requests

> Status: Planned · UX Defined · Created: 2026-07-26

## Overview

The Family feature lets a ReadyCar customer become a **Family Organizer**, invite trusted family members by email, share selected delivery addresses with them, and receive purchase requests from them.

A family member can browse and prepare products using their own account, select one of the organizer's explicitly shared addresses, choose a shipping option, and send the selection to the organizer for approval. No payment is collected and no marketplace order is created at this stage.

The organizer reviews the request, approves or declines it, and, when approving, continues directly to checkout to choose online/card payment or cash on delivery. A real ReadyCar order is created only after COD confirmation or successful online payment.

This distinction is fundamental:

- A **Family Order Request** is a private approval object shared between two customer accounts.
- A real **Order** is created only after organizer approval and payment selection.
- ReadyCar's existing vendor product-approval process begins only after the real order is created.

---

## Goal & Success

- **Goal:** Let family members conveniently prepare purchases for a trusted organizer without exposing payment information or placing unauthorized orders.
- **Primary member value:** A family member can request needed products using the organizer's approved delivery addresses without coordinating product links manually.
- **Primary organizer value:** The organizer keeps full control over addresses, approval, payment method, refunds, and other financial actions.
- **Success looks like:**
  - An organizer can invite and manage family members from Profile → Family.
  - An invited person can accept with an existing customer account or create a customer account from the invitation.
  - The organizer controls which saved addresses each member may use.
  - A member can prepare and submit a request without payment.
  - The organizer receives a clear notification, reviews the request, and approves or declines it.
  - Approval takes the organizer into a focused checkout that supports COD and online/card payment.
  - The final order is owned by the organizer but remains trackable by the requesting member.
  - No request can accidentally create duplicate payments or orders.

---

## Existing ReadyCar Alignment

The feature should extend existing customer flows rather than create a separate shopping system.

### Existing capabilities to reuse

- URL-based customer profile tabs.
- Customer registration, email verification, login, and login redirect support.
- Saved customer addresses with recipient name, phone, full address, delivery country/city, and default selection.
- Personal carts and selected-cart checkout.
- Server-side product, coupon, price, stock, shipping, and total recalculation.
- Cash on delivery and hosted online payment.
- Order history, shipment tracking, returns, and refunds.
- Branded English and Arabic transactional emails.

### Missing capabilities to add

- Durable family and membership records.
- Secure family invitations.
- Per-member shared-address permissions.
- A pre-order family approval object.
- Customer-facing in-app notifications and unread counts.
- Family provenance on a completed order.
- Invitation-aware registration and login redirects.
- A preferred notification language on customer accounts.
- Optional friendly address labels such as Home, Work, or Parents' Home.

### Important constraint

The existing cart is personal and partly persisted in browser storage. It must not become the shared object between the member and organizer. A submitted family request must be copied into a durable server-side record.

---

## Terminology & Copy

Use friendly, authority-neutral terminology:

| English | Arabic |
| --- | --- |
| Family | العائلة |
| Family Organizer | مسؤول العائلة |
| Family Member | فرد العائلة |
| Order Request | طلب شراء |
| Requests Needing Attention | طلبات تحتاج إلى مراجعتك |
| Send for Approval | إرسال للموافقة |
| Approve and Continue to Payment | الموافقة والمتابعة للدفع |
| Decline Request | رفض الطلب |
| Shared Addresses | العناوين المشتركة |
| Approved — Payment Needed | تمت الموافقة — بانتظار الدفع |

Prefer **Family Organizer** over **Head of Family** in the UI. The organizer still has the requested authority but the language is clearer and more inclusive.

For relationship selection, use:

> What is this person's relationship to you?

The requested options are:

- Son
- Daughter
- Husband
- Wife

Recommended additional options:

- Parent
- Sibling
- Other

Relationship is descriptive only. Permissions are determined by the Organizer and Member roles, not by relationship or gender.

---

## User Types & Permissions

| Capability | Organizer | Member | Unauthenticated Invitee | Vendor/Admin |
| --- | :---: | :---: | :---: | :---: |
| Create a family | ✓ | — | — | — |
| Invite members | ✓ | — | — | — |
| Resend/revoke invitations | ✓ | — | — | — |
| Remove members | ✓ | — | — | — |
| Select addresses to share | ✓ | — | — | — |
| View shared organizer addresses | Own | Read-only | — | — |
| Edit organizer addresses | ✓ | — | — | — |
| Submit an order request | — | ✓ | — | — |
| Withdraw a pending request | — | ✓ | — | — |
| Approve/decline a request | ✓ | — | — | — |
| Choose payment method | ✓ | — | — | — |
| Track resulting order | ✓ | Read-only | — | Existing fulfillment access |
| Manage payment/refund/return | ✓ | — | — | Existing role access |
| Accept/decline invitation | — | — | ✓ | — |

Only customer accounts can participate in families. A vendor or admin session opening an invitation must be prompted to switch to a customer account.

---

## Information Architecture

### Primary location

Add a new **Family** tab to the existing customer Profile navigation.

Recommended customer tab order:

1. Personal Information
2. ReadyCar Recommendations
3. Addresses
4. My Garage
5. Orders
6. Family
7. Security

If usability testing shows approval requests are hard to discover, move Family directly above Orders.

### Secondary entry points

- Add `Family` to the customer account dropdown in the storefront header.
- Add a customer notification bell near the account/cart controls.
- Show an unread badge on the Family tab when requests require organizer action.
- All family emails should deep-link directly to the relevant invitation or request.

Do not add Family to the global shopping navigation. This is an account-management and approval feature, not a product category.

---

## Family Tab UX

### Organizer view

Display sections in this order:

1. **Requests needing attention**
2. **Family members**
3. **Pending invitations**
4. **Shared-address permissions**
5. **Family settings**

The approval queue is time-sensitive and must appear before member administration, especially on mobile.

#### Empty state

> Invite trusted family members so they can prepare orders for you. You review every request and choose how to pay.

Primary action: **Invite family member**

The family can be created implicitly when the organizer sends the first invitation. A separate multi-step “Create family” wizard is unnecessary for the MVP.

### Member view

Display:

1. **Family organizer card**
2. **My family requests**
3. **Shared addresses**
4. **Leave family**

The organizer card should show the organizer's name, avatar when available, relationship label, and the number of available shared addresses.

### Status presentation

Use text and iconography in addition to color:

- Pending approval — clock
- Approved/payment needed — credit card
- Payment in progress — spinner/processing
- Order placed — check
- Declined — X
- Withdrawn/expired — neutral archive/clock

---

## Journey 1: Invite a Family Member

### Organizer flow

1. Organizer opens Profile → Family.
2. Organizer selects **Invite family member**.
3. A modal or mobile sheet opens.
4. Organizer enters:
   - Email address
   - Relationship
   - One or more addresses to share
5. A privacy explanation states:
   - The member can view and select only the shared addresses.
   - The member cannot edit or delete organizer addresses.
   - No payment method will be shared.
6. Organizer selects **Send invitation**.
7. The modal closes and a pending invitation card appears.
8. A confirmation toast says:

   > Invitation sent. We will let you know when they join.

### Pending invitation card

Show:

- Invited email
- Relationship
- Sent date
- Expiration date
- `Resend`
- `Cancel invitation`

### Validation and recovery

- Invalid email → inline error.
- Inviting own email → block with a clear message.
- Existing pending invite → show it and offer Resend instead of creating a duplicate.
- Existing member → explain that the person is already in the family.
- Email is already in another family → do not expose this before acceptance; invitation acceptance can explain the membership conflict privately.
- Email delivery failure → keep the modal open and allow retry.

The invite API should use a generic success response so it does not reveal whether an email already has a ReadyCar account.

---

## Journey 2: Accept or Decline an Invitation

### Invitation email

Recommended subject:

> Ahmed invited you to join their ReadyCar family

The email should communicate:

- Organizer name
- Assigned relationship
- What acceptance enables
- That only selected addresses are shared
- That payment information is never shared
- Invitation expiration
- Primary **Review invitation** action

### Invitation landing page

Show:

> Ahmed invited you to join their ReadyCar family as their son.

Actions:

- **Accept invitation**
- **Decline**

Opening the link must never accept the invitation automatically.

### Existing customer account

1. If not signed in, show **Sign in to accept**.
2. Prefill or lock the invited email where appropriate.
3. Preserve the invitation token through login.
4. Return to the invitation after successful login.
5. Require explicit acceptance.

### Wrong customer account

If the signed-in account email does not match:

> This invitation was sent to another email address.

Provide **Switch account**. Do not expose family or address information to the wrong account.

### No customer account

Show a shortened customer registration form:

- Full name
- Invited email, locked
- Phone number
- Password

Do not show the customer/vendor role selector.

Recommended behavior:

- The secure invitation proves control of the invited email.
- Create the customer account, accept the invitation, and sign the user in atomically.
- Avoid sending a second email-verification link after the user already arrived through the secure invitation.

Phone uniqueness and password rules must use the existing registration validation.

### Invitation states

`pending → accepted | declined | expired | revoked`

Invitation tokens must be hashed, single-use, and expire after seven days.

---

## Journey 3: Prepare and Submit a Family Order Request

### Entry from normal shopping

The member browses, chooses variants, adds products, and selects cart items using existing ReadyCar behavior.

At the top of checkout add:

> Who is this order for?

Options:

- **Myself**
- **Ahmed — Family Organizer**

The existing checkout remains unchanged when `Myself` is selected.

### Family checkout mode

When the organizer is selected:

- Display only addresses explicitly shared with this member.
- Show address labels, recipient, location, and delivery zone.
- Keep addresses read-only.
- Hide **Add new address**.
- Reuse the existing shipping-method quotation.
- Allow a member to change only the selected shared address and shipping method.
- Replace Payment Method with an Approval section.
- Allow an optional note with a small character limit, such as 200 characters.
- Change the main action to **Send to Ahmed for approval**.

### Summary wording

Use **Estimated total**, not Total.

Show:

> No payment will be taken now. Prices, availability, discounts, and shipping will be checked again before payment.

Coupons can be included in a request, but they are not guaranteed. Coupon validity and ownership must be checked again for the organizer before payment.

### Submission behavior

1. Recalculate the estimate on the backend.
2. Save the durable family request.
3. Notify the organizer.
4. Remove only the submitted items from the member's cart.
5. Show success:

   > Your request was sent to Ahmed.

6. Provide:
   - **View request**
   - **Continue shopping**

No real `Order`, vendor supervision, shipment, earnings, or payment object is created during request submission.

### No shared addresses

If the organizer has not shared an address:

> Ahmed has not shared a delivery address with you yet.

Provide **Ask organizer to share an address** or a simple instruction. Do not let the member add an address on the organizer's behalf.

---

## Journey 4: Organizer Reviews the Request

### Notification entry points

Notify the organizer through:

- Customer notification bell
- Family-tab badge
- Email

Email action: **Review request**

### Request detail

Show:

- Requester name, avatar, and relationship
- Submitted date/time
- Optional member note
- Product image, name, variant, quantity, and requested price
- Selected shared address
- Shipping method
- Product subtotal
- Requested coupon/discount
- Shipping estimate
- Estimated total
- Any detected availability, quantity, price, coupon, or shipping changes

Primary actions:

- **Decline**
- **Approve and continue to payment**

Do not use an unexplained generic `Approve` action because approval does not yet mean the final order has been placed.

### Decline experience

Decline opens a small dialog with optional quick reasons:

- Too expensive
- Wrong products
- Wrong address
- I will order later
- Other

An optional note can be sent to the member. Decline should be one confirmation step, not a high-friction destructive workflow.

### Changes since submission

Before enabling approval, reprice and revalidate the request.

If anything changed, show a comparison:

| Item | Requested | Current |
| --- | ---: | ---: |
| Product price | QAR 100 | QAR 115 |
| Shipping | QAR 20 | QAR 25 |
| Total | QAR 120 | QAR 140 |

Require the organizer to acknowledge material changes.

If an item is unavailable, allow the organizer to remove the unavailable item and continue, or decline the entire request. The member's original request should remain visible in history for clarity.

---

## Journey 5: Approval and Payment

### Focused organizer checkout

After **Approve and continue to payment**, open a focused checkout hydrated from the server-side family request.

The organizer can:

- Confirm or change to another address shared with that member.
- Confirm/change the shipping method.
- Review updated items and totals.
- Choose cash on delivery.
- Choose online/card payment.

The requester and family context should remain visible:

> Requested by Sara, your daughter

### Cash on delivery

Final action:

> Place order with cash on delivery

After confirmation:

- Create the real order under the organizer.
- Convert the family request to `order_placed`.
- Notify the member.
- Redirect the organizer to order details.

### Online/card payment

Final action:

> Pay securely now

Behavior:

1. Mark the family request `payment_in_progress`.
2. Create the existing payment record under the organizer.
3. Redirect to the hosted payment provider.
4. Create the real order only after confirmed payment.
5. Convert the request to `order_placed`.
6. Notify both users.

If payment fails or is abandoned:

- Return the request to `approved_payment_needed`.
- Show **Resume payment**.
- Do not create a real order.

### Idempotency

Approval, payment initialization, payment confirmation, and order conversion must be idempotent. Refreshes, duplicate webhook calls, or double-clicks must never create duplicate payments or orders.

---

## Resulting Order Experience

### Ownership

The real order belongs to the organizer:

- `Order.user_id = organizer_user_id`
- `Order.requested_by_user_id = member_user_id`
- `Order.family_order_request_id = request_id`
- `Order.family_id = family_id`

The organizer owns:

- Payment
- COD commitment
- Cancellation decisions
- Returns
- Refunds
- Financial communication

### Member visibility

The requesting member gets read-only access to:

- Order reference
- Items
- Delivery address summary
- Order status
- Shipment tracking

Show:

> Ordered for Ahmed · Requested by you

For the MVP, the member cannot initiate cancellation, return, refund, or payment changes.

### Vendor visibility

Vendors receive and process a normal ReadyCar order. Family relationships and approval history are not needed for fulfillment and should not be exposed.

### Avoiding approval confusion

There are two separate approval stages:

1. **Family approval:** organizer approval before payment.
2. **Vendor review:** existing vendor item approval after the real order is placed.

Always identify the actor:

- Waiting for Ahmed's approval
- Approved by Ahmed — payment needed
- Order placed — awaiting vendor review

Never display only “Waiting for approval.”

---

## Request State Machine

```text
pending_approval
├── declined
├── withdrawn
├── expired
└── approved_payment_needed
    ├── expired
    └── payment_in_progress
        ├── approved_payment_needed   (failed or abandoned)
        └── order_placed
```

### State behavior

| State | Organizer action | Member action |
| --- | --- | --- |
| Pending approval | Review, approve, decline | View, withdraw |
| Approved — payment needed | Continue payment, optionally decline/cancel | View |
| Payment in progress | Complete/recover payment | View |
| Order placed | Manage order | Track order |
| Declined | View reason | View, shop again |
| Withdrawn | View | View |
| Expired | View | View, recreate request |

Pending or approved-but-unpaid requests should expire after a configurable duration. Recommended initial value: 48 hours.

---

## Notifications

### Customer notification types

- `family_invitation_accepted`
- `family_invitation_declined`
- `family_member_removed`
- `family_address_access_changed`
- `family_order_request_received`
- `family_order_request_approved`
- `family_order_request_declined`
- `family_order_request_withdrawn`
- `family_order_request_expiring`
- `family_order_payment_needed`
- `family_order_payment_failed`
- `family_order_placed`

### Delivery rules

- Invitation → email.
- New request → organizer email + in-app.
- Approve/decline → member in-app; email for decline and payment-needed if useful.
- Payment failure → organizer in-app immediately.
- Order placed → both in-app; standard order communication continues.
- Address permission change → member in-app.

Avoid emailing on every minor state change. Email should be reserved for actions requiring attention or important final outcomes.

### Language

Add a preferred notification language to customer accounts. Emails and notifications should use the recipient's preference, not the sender's current browser language.

---

## Recommended Data Model

### `Family`

```js
{
  name: String,
  organizer_user_id: ObjectId,
  status: 'active' | 'dissolved',
  created_at: Date,
  updated_at: Date
}
```

### `FamilyMembership`

```js
{
  family_id: ObjectId,
  user_id: ObjectId,
  role: 'organizer' | 'member',
  relationship: String,
  shared_address_ids: [ObjectId],
  status: 'active' | 'left' | 'removed',
  joined_at: Date,
  ended_at: Date
}
```

Use a unique active-membership constraint so a customer cannot silently join multiple families in the MVP.

### `FamilyInvitation`

```js
{
  family_id: ObjectId,
  invited_by_user_id: ObjectId,
  email: String,
  relationship: String,
  shared_address_ids: [ObjectId],
  token_hash: String,
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked',
  expires_at: Date,
  accepted_by_user_id: ObjectId,
  created_at: Date,
  updated_at: Date
}
```

Normalize emails using the same authentication normalization used by ReadyCar registration and login.

### `FamilyOrderRequest`

```js
{
  family_id: ObjectId,
  organizer_user_id: ObjectId,
  requester_user_id: ObjectId,

  items: [{
    product_id: ObjectId,
    variant_id: ObjectId,
    quantity: Number,
    product_title_snapshot: String,
    product_image_snapshot: String,
    variant_label_snapshot: String,
    estimated_unit_price: Number
  }],

  organizer_address_id: ObjectId,
  shipping_address_snapshot: Object,
  shipping_destination: Object,
  shipping_method_id: ObjectId,
  shipping_method_snapshot: Object,

  coupon_code: String,
  estimated_subtotal: Number,
  estimated_discount: Number,
  estimated_shipping: Number,
  estimated_total: Number,

  member_note: String,
  decline_reason: String,
  decline_note: String,

  status: String,
  approved_at: Date,
  declined_at: Date,
  withdrawn_at: Date,
  expires_at: Date,
  converted_order_id: ObjectId,

  created_at: Date,
  updated_at: Date
}
```

Save display snapshots for historical clarity, but never trust estimated prices for final payment.

### Existing model additions

#### User

- `preferred_language`
- Optional address `label`

#### Order

- `family_id`
- `family_order_request_id`
- `requested_by_user_id`

#### OrderPayment

- Optional `family_order_request_id`

The payment and final order `user_id` must always be the organizer.

---

## Recommended API Surface

Exact naming can follow project conventions, but the responsibilities should remain separated.

### Family and membership

- `GET /api/users/family`
- `POST /api/users/family/invitations`
- `POST /api/users/family/invitations/:id/resend`
- `DELETE /api/users/family/invitations/:id`
- `GET /api/family-invitations/:token`
- `POST /api/family-invitations/:token/accept`
- `POST /api/family-invitations/:token/decline`
- `PUT /api/users/family/members/:memberId/addresses`
- `DELETE /api/users/family/members/:memberId`
- `POST /api/users/family/leave`

### Requests

- `POST /api/users/family/order-requests`
- `GET /api/users/family/order-requests`
- `GET /api/users/family/order-requests/:id`
- `POST /api/users/family/order-requests/:id/withdraw`
- `POST /api/users/family/order-requests/:id/decline`
- `POST /api/users/family/order-requests/:id/approve`
- `GET /api/users/family/order-requests/:id/checkout-preview`
- `POST /api/users/family/order-requests/:id/place-cod`
- `POST /api/users/family/order-requests/:id/create-payment`

### Customer notifications

- `GET /api/users/notifications`
- `GET /api/users/notifications/count`
- `PUT /api/users/notifications/:id/read`
- `PUT /api/users/notifications/read-all`

### Authorization principle

Never accept an arbitrary organizer ID from the client as proof of authority. Every request must resolve the family, membership, organizer, and address permissions on the backend.

---

## Business Rules

### Membership

- One organizer per family in the MVP.
- One active family membership per customer account.
- Only the organizer may invite or remove members.
- Only the organizer may choose shared addresses.
- A member may leave voluntarily.
- Removing or leaving immediately revokes future address access.
- Membership changes do not remove completed order history.

### Addresses

- Only explicitly shared address IDs are visible to a member.
- Members cannot create, edit, delete, or set defaults on organizer addresses.
- A request stores an address snapshot so its history remains understandable.
- Final checkout still verifies that the organizer owns the address.
- If an address has been deleted or unshared, the organizer must choose a valid address before payment.

### Requests

- Requests must contain at least one purchasable item.
- A member can submit only to their active organizer.
- A request cannot directly call the normal order-placement route as the organizer.
- Members can withdraw only before payment starts.
- Organizer approval does not itself create a real order.
- Final checkout always recalculates price, discounts, availability, and shipping.
- Expired requests cannot be paid without refreshing/recreating them.

### Payment and orders

- COD confirmation creates the order immediately.
- Online payment creates the order only after provider confirmation.
- Organizer is the payment customer and order owner.
- A request can convert to at most one real order.
- The existing vendor-review and fulfillment lifecycle remains unchanged.

### Returns and refunds

- Organizer controls returns and refunds in the MVP.
- Refunds return to the organizer's original payment context.
- Member has read-only order and shipment tracking access.

---

## Security & Privacy

- Hash invitation tokens in the database.
- Make tokens single-use and time-limited.
- Rate-limit invite, resend, acceptance, approval, and payment initialization.
- Require invitation email to match the accepting customer account.
- Do not expose member, organizer, family, or address data before authorization.
- Return only authorized shared addresses to the member.
- Re-check membership and address permission on every request operation.
- Do not put full address information in notification previews.
- Log organizer approval, decline, membership removal, and address-permission changes.
- Protect conversion with database-level uniqueness or transactions.
- Ensure payment callbacks can be replayed safely.
- Use generic invite responses to prevent customer-account enumeration.

### Child-account consideration

Son and Daughter are relationship labels only in the MVP. If ReadyCar intends to support accounts owned by minors, age verification, guardian consent, privacy, account recovery, and legal requirements need a separate feature decision before launch.

---

## Empty, Loading, Success, and Error States

### Family empty

- Illustration/icon
- Explanation
- **Invite family member**

### No pending requests

> You have no requests waiting for approval.

### Member has no shared addresses

> Your organizer has not shared a delivery address with you yet.

### Loading

- Skeleton family cards.
- Disable submit/approve/pay buttons during mutation.
- Maintain the current page rather than blanking the entire profile.

### Invitation success

> Invitation sent.

### Request success

> Your request was sent to Ahmed.

### Approval success before payment

> Request approved. Choose how you would like to pay.

### Order success

> Order placed successfully. Sara can now track it from her family requests.

### Common errors

- Invitation expired
- Invitation revoked
- Wrong signed-in account
- Member already belongs to a family
- Address no longer shared
- Product unavailable
- Price changed
- Shipping unavailable
- Coupon invalid
- Request already handled
- Payment failed
- Request already converted to an order

Error messages should always provide the next useful action.

---

## Edge Cases

### Invitations

- Organizer invites themselves.
- Same email is invited more than once.
- Invitee is already an active member.
- Invitee belongs to another family.
- Invitee opens the link while signed into a different customer account.
- Invitee opens it while signed in as vendor/admin.
- Invitation is opened after expiry.
- Organizer revokes the invitation while the landing page is open.
- Registration phone number already belongs to another customer.

### Addresses

- Organizer deletes the selected address after request submission.
- Organizer unshares the address after request submission.
- Address has no valid delivery zone.
- Organizer changes recipient phone or address text.
- A shared address is marked non-default later.

### Products and pricing

- Product becomes draft/unpublished.
- Vendor becomes suspended.
- Variant is deleted or unavailable.
- Quantity exceeds availability.
- Price or discount changes.
- Coupon expires or is not valid for the organizer.
- Shipping cost/method changes.
- A multi-vendor request becomes partially unavailable.

### Approval and payment

- Organizer and member act on the request simultaneously.
- Organizer approves in two browser tabs.
- Organizer abandons hosted payment.
- Provider redirects without webhook, or webhook arrives before redirect.
- Duplicate provider webhook.
- COD submission is double-clicked.
- Organizer is removed/suspended between request and payment.

### Membership lifecycle

- Member leaves with pending requests.
- Organizer removes a member with pending requests.
- Organizer dissolves the family.
- Organizer account is deleted.
- Member account is deleted.
- Completed family order remains active after membership ends.

Recommended behavior: pending and approved-but-unpaid requests are cancelled when membership ends; completed orders remain intact.

---

## MVP Scope

### Include

- One organizer and multiple members.
- One active family per customer.
- Family tab for organizer and member.
- Email invitation with existing/new-account acceptance.
- Explicit per-member address sharing.
- Friendly address labels.
- Family checkout mode.
- Server-side order-request persistence.
- Approve, decline, withdraw, and expire states.
- Customer in-app notifications and email alerts.
- Organizer COD and online/card payment.
- Resulting order provenance.
- Organizer full order access.
- Member read-only order and shipment tracking.
- English and Arabic UX and email copy.
- Audit events and idempotent conversion.

### Defer

- Multiple organizers.
- Multiple active families per account.
- Member-to-member requests.
- Shared payment cards.
- Saved-card sharing.
- Spending limits.
- Automatic approvals.
- Recurring requests.
- Family chat.
- Partial per-item organizer approval beyond removing unavailable items.
- Member-initiated returns/refunds.
- Child/guardian account controls.

---

## Suggested Delivery Phases

### Phase 1: Family foundation

- Family, membership, and invitation models.
- Invite, accept, decline, resend, and revoke APIs.
- Invitation-aware login/registration.
- Family tab member management.
- Shared-address permissions.
- Branded bilingual invitation emails.

### Phase 2: Request preparation

- Family recipient selector in checkout.
- Read-only shared-address selection.
- Request estimate and optional note.
- Family order-request model and APIs.
- Member request history.

### Phase 3: Approval and conversion

- Organizer approval queue and request detail.
- Decline reasons.
- Repricing/change comparison.
- Focused organizer checkout.
- COD conversion.
- Online payment conversion.
- Order provenance and member tracking.

### Phase 4: Notifications, resilience, and polish

- General customer notification model and bell.
- Email/in-app status notifications.
- Expiration reminders and cleanup job.
- Idempotency protections and concurrency testing.
- Analytics instrumentation.
- Accessibility, Arabic RTL, and mobile usability passes.

---

## Acceptance Criteria

### Invitation

- Organizer can invite a valid email with a relationship and shared addresses.
- Invitee can accept using the exact invited customer email.
- New invitee can create a customer account without losing invitation context.
- Wrong account, expired token, revoked token, and duplicate acceptance are handled safely.
- Member sees only explicitly shared addresses after acceptance.

### Request

- Member can select organizer as checkout recipient.
- Member cannot add or edit organizer addresses.
- Member can select products, shared address, shipping, and optional note.
- Submission creates a family request but not an Order or OrderPayment.
- Submitted cart items are removed only after successful request creation.
- Organizer receives an actionable notification.

### Approval

- Organizer sees accurate request details and requester identity.
- Current pricing, stock, coupon, and shipping are recalculated.
- Material changes are clearly shown.
- Organizer can decline with an optional reason.
- Approve continues to organizer payment selection.

### Payment and order

- COD creates exactly one real order.
- Successful online payment creates exactly one real order.
- Failed/abandoned payment creates no order and can be resumed.
- Resulting order belongs to organizer and references requester/request.
- Member can track but cannot perform financial actions.
- Vendor receives a normal order without family-private data.

### Security

- Unauthorized users cannot view invitations, requests, addresses, or resulting family orders.
- Address permissions are enforced on the backend.
- Invitation and conversion actions are rate-limited and idempotent.
- Repeated approval/payment/webhook calls cannot duplicate an order.

---

## Analytics & Success Metrics

Track:

- Family tab visits.
- Invite modal opened.
- Invitation sent.
- Invitation delivery failure.
- Invitation accepted/declined/expired.
- Time from invite sent to accepted.
- Family checkout mode selected.
- Request submitted.
- Request withdrawn.
- Request approved/declined/expired.
- Time from submission to organizer decision.
- Approved request reaching payment.
- Payment success/failure/abandonment.
- Request-to-order conversion rate.
- Family order return/refund rate.
- Support contacts related to invitations, addresses, or approvals.

Primary funnel:

```text
Invitation sent
→ Invitation accepted
→ First request submitted
→ Request approved
→ Payment/COD completed
→ Order placed
```

Segment usability and conversion by:

- English vs Arabic
- Mobile vs desktop
- Existing account vs newly registered invitee
- COD vs online payment

---

## Usability Testing

Before full rollout, test with English and Arabic mobile users across both roles.

Key tasks:

1. Organizer invites a family member and shares one of several addresses.
2. Invitee accepts with an existing account.
3. Invitee accepts by creating a new account.
4. Member submits a request for the organizer.
5. Organizer notices the request without being told where it is.
6. Organizer identifies a price change and completes COD.
7. Organizer resumes an abandoned online payment.
8. Member tracks the resulting order.

Watch for:

- Confusion over who “Son/Daughter” describes.
- Confusion between request submission and order placement.
- Confusion between family approval and vendor approval.
- Accidental expectation that the member can see payment information.
- Difficulty finding pending requests.
- Difficulty distinguishing estimated and final totals.
- Arabic RTL layout issues in status timelines and price comparisons.

---

## Decision Log

### Use a pre-order request, not a pending real order

- **Decision:** A member creates a `FamilyOrderRequest`; a real `Order` exists only after organizer payment/COD confirmation.
- **Reason:** Prevents unpaid requests from reaching vendors, shipping, commissions, and fulfillment.
- **Alternatives considered:** Create a normal pending order and add family approval status.
- **Impact:** Requires a new model but produces a much clearer and safer lifecycle.

### Organizer owns the final order

- **Decision:** The organizer is the final order/payment owner; the requester is stored as provenance.
- **Reason:** The organizer approves the purchase, chooses payment, and owns refunds and financial obligations.
- **Alternatives considered:** Member owns the order while organizer is only payer.
- **Impact:** Member needs explicit read-only tracking authorization.

### Explicit per-address sharing

- **Decision:** Organizer selects which addresses each member can use.
- **Reason:** Saved addresses contain sensitive recipient, phone, and location information.
- **Alternatives considered:** Share every organizer address automatically.
- **Impact:** Adds one permission step to invitation/member management but protects privacy.

### One active family per account in MVP

- **Decision:** A customer can belong to one active family.
- **Reason:** Avoids ambiguous organizers, address sources, approval routing, and notification complexity.
- **Alternatives considered:** Multiple families with an organizer selector.
- **Impact:** Simpler UX and authorization; can be expanded later.

### Relationship is descriptive, not authorization

- **Decision:** Son, Daughter, Husband, Wife, and other labels do not alter permissions.
- **Reason:** Permissions should be predictable and role-based.
- **Alternatives considered:** Different privileges per relationship.
- **Impact:** Future spending limits or child controls must be separate explicit features.

### Revalidate before payment

- **Decision:** Prices, availability, coupon, and shipping are recalculated during organizer review/payment.
- **Reason:** Requests may remain pending while marketplace data changes.
- **Alternatives considered:** Lock all values at request time.
- **Impact:** UX must clearly show requested-versus-current changes.

### Organizer-only financial controls in MVP

- **Decision:** Member can track the order but cannot cancel, return, refund, or modify payment.
- **Reason:** Financial authority should remain with the approving/paying account.
- **Alternatives considered:** Let requester manage returns.
- **Impact:** Some family coordination remains outside ReadyCar; can be expanded later.

### Invitation-aware registration

- **Decision:** New users register through a shortened customer-only flow with invited email locked.
- **Reason:** Prevents context loss, role confusion, and a redundant second email-verification loop.
- **Alternatives considered:** Send invitee to standard registration and require them to reopen the invitation.
- **Impact:** Authentication service needs an atomic create-account-and-accept path.

---

## Open Questions

- [ ] Confirm whether ReadyCar wants the UI term **Family Organizer** or **Head of Family**.
- [ ] Confirm the full relationship list beyond Son, Daughter, Husband, and Wife.
- [ ] Confirm whether invitation acceptance itself can count as email verification for a new account.
- [ ] Confirm one active family per customer for the MVP.
- [ ] Confirm the request expiration duration; recommended default is 48 hours.
- [ ] Confirm whether organizers can edit quantities/remove available products, or only remove unavailable items before payment.
- [ ] Confirm whether coupons entered by members should carry into organizer checkout.
- [ ] Confirm whether members should receive email for every decline or only in-app notification.
- [ ] Confirm organizer-only returns/refunds for the MVP.
- [ ] Confirm whether a member can recreate a declined/expired request with one action.
- [ ] Confirm whether family order tracking should appear in the normal Orders tab, the Family tab, or both.
- [ ] Confirm whether actual minor-owned accounts are in scope; if yes, create a separate guardian/consent plan before implementation.
