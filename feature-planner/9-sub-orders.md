# 9 - Sub-Orders (Per-Vendor Order Splitting)

> Status: Implemented · Created: 2026-08-16 · Updated: 2026-08-17
>
> Two decisions were refined during implementation, both recorded in the Decision Log:
> **when** the Bosta shipment is created (it depends on whether Smart Label is on), and
> **when** the allocation freezes (at the moment a delivery is actually created, which is
> the same thing expressed precisely). Nothing else changed.

## Overview

Today a ReadyCar order is a single indivisible unit: one status, one dispatch gate,
one completion event. That does not match reality. A basket bought from three stores
becomes three physically separate parcels, collected from three different pickup
locations by Bosta, arriving on three different days. Because the system only knows
one status, **one slow vendor freezes everybody** — nothing at all can be sent to
Bosta until every vendor has reviewed their items, a vendor whose parcel was
delivered on Monday is not paid until the last vendor's parcel arrives on Friday, and
a customer holding merchandise in their hands sees "Picked up from business" on
screen.

This feature splits every order into **sub-orders — one per (vendor, pickup branch)**.
The order stays a single financial entity: one price, one payment, one coupon, one
loyalty snapshot, one shipping total shown at checkout. But **fulfilment, status,
control, money release, and returns all move down to the sub-order**, so each vendor's
part of the order lives and finishes on its own schedule.

---

## Goal & Success

- **Goal:** Make the unit of fulfilment control the sub-order, not the order, so no
  vendor can block another — while the customer still experiences one order, one
  price, and one payment.

- **Primary user value:**
  - **Customer** — sees exactly what is happening to each part of their order, which
    store it belongs to, when it arrives, and what each courier will ask them to pay.
    They can return a delivered part without waiting for the rest.
  - **Vendor** — an unambiguous three-step task list for their own parcel, and money
    that clears when *their* parcel is delivered.
  - **Admin** — a queue of exactly the sub-orders that need a human, and pickups they
    can book with photo evidence in front of them.

- **Success looks like:**
  1. A ready vendor's parcel reaches Bosta without waiting for any other vendor.
  2. A vendor's earnings clear from their own delivery date.
  3. A customer can open a return on a delivered sub-order while another is in transit.
  4. The sum of what all couriers collect on a cash order equals the order total
     exactly — which is **not** true today.
  5. No screen shows a status that contradicts what the customer physically has.
  6. **Nothing about the split is a surprise.** The customer learns at checkout — before
     paying — that the order arrives as separate parcels, how shipping was priced for
     each one, and exactly what each courier will ask them for.

---

## User Types & Permissions

| Role | Create | View | Edit | Delete | Notes |
| ---- | :----: | :--: | :--: | :----: | ----- |
| **Customer** | — | At checkout: parcel count, per-parcel shipping, per-courier cash amounts. After: own orders + every sub-order in them, with vendor name | — | Cancel own sub-order **only while no pickup is booked** | Never sees other customers' data, vendor cost, or commission |
| **Vendor** | — | Only their own sub-orders and only the items in them | Advance their sub-order through the 3 stages; set item availability + decline reason; upload parcel photos; assign tracking number | Request cancellation (admin approves) **only while no pickup is booked** | Cannot see other vendors on the same order, nor the order total |
| **Admin** | Creates a sub-order implicitly by moving an item to another vendor | Everything | Full edit while intervention is open; limited status override after dispatch, with a mandatory reason | Cancel any sub-order; cancel the order (cancels only the not-yet-delivered parts) | The only role that can resolve a declined item |

**Ownership / role-change rules**

- A sub-order belongs to exactly one **(vendor, pickup branch)** pair and never changes owner.
- Moving an item to a different vendor does not transfer the sub-order — it **removes
  the item from one sub-order and creates or joins another**.
- If a vendor's account is suspended mid-order, their sub-orders freeze into admin
  intervention; the rest of the order continues.

---

## User Journeys

### Entry points

| Role | Where they enter |
| --- | --- |
| Customer | **Checkout — the split is disclosed here first, before payment**; then Profile → My Orders → an order card; also from a partial-delivery notification |
| Vendor | Vendor dashboard → Orders, opened on the stage tab that needs them |
| Admin | Admin → Orders (an order), Admin → Pickups (a branch), or the "Needs your attention" queue |

### Happy path — vendor (the core new journey)

A three-stage progress bar sits at the top of every sub-order the vendor opens.

**Stage ① — Confirm products**

1. The vendor sees only their own items on this sub-order.
2. Each item has two buttons: **Available** / **Not available**. Pressing either
   **saves immediately** — there is no separate submit step.
3. **Not available** opens a **mandatory reason** field. The admin needs this text to
   explain the situation to the customer.
4. A **"All available"** button at the top confirms every item at once.
5. When no item is left unreviewed, the **"Confirm product availability"** button unlocks.
6. Pressing it — **with every item marked available** — creates the Bosta delivery
   automatically and advances to stage ②.
7. Pressing it with **any item declined** does not advance. The sub-order freezes and
   moves to the admin's intervention queue (see *Alternate paths*).

**Stage ② — Assign tracking number**

The screen shows one of two options, decided by whether Smart Label is switched on
for the site. The two need the tracking number at **opposite ends of this stage**, so the
shipment is created at whichever moment gives the vendor a number to work with:

| Smart Label | The Bosta shipment is created | Why |
| --- | --- | --- |
| **Off** | at the end of stage ① | Bosta mints the number, so the printable waybill exists by the time the vendor reaches stage ② |
| **On** | the moment the vendor scans | The label is already stuck on the parcel; the shipment is created carrying *that* number, so no second number is ever minted |

- **Smart Label on** — "Scan the label" (or type the number).
- **Smart Label off** — "Download the waybill and stick it on the parcel," then confirm.

Neither path involves the admin: their role is the pickup, not the dispatch.
Completing either advances to stage ③.

**Stage ③ — Ready for pickup**

1. The vendor uploads **1 to 5 photos** of the parcel. At least one is required.
2. Pressing **"Confirm ready for pickup"** marks the sub-order ready.
3. It now appears in the admin's Pickups module for its branch, with its photos and
   tracking number attached.

From here Bosta drives the status: pickup scheduled → picked up → in transit → out for
delivery → delivered.

### Happy path — customer

**At checkout — before paying**

1. The basket states plainly how many separate parcels the order will arrive in, and
   that each is delivered by its own courier on its own day.
2. The shipping line is **expandable**, showing what each parcel's shipping was priced
   at and which store and branch it belongs to. The single total remains the headline
   number; the breakdown explains it rather than replacing it.
3. On cash on delivery, a second block lists **exactly what each courier will collect**,
   with the parts adding up to the order total in front of the customer.
4. Then the normal payment step, unchanged.

**After the order exists**

1. Opens an order and sees one header (reference, total, and a progress counter) with
   a card per sub-order beneath it.
2. Each card carries the **vendor name and branch**, the items in it, its own status,
   its own tracking, and — on cash orders — **the exact amount that courier will ask for**.
3. A push/WhatsApp notification arrives per partial delivery, naming the vendor and
   how many parcels remain.
4. When a card reaches *Delivered*, a **Request return** button appears on that card
   only, with its own return window counted from that card's delivery date.

### Happy path — admin

1. Opens an order and sees a card per sub-order, each showing its stage, tracking,
   parcel photos, commission, and action buttons.
2. Opens Pickups and sees, per branch, the list of sub-orders ready today with their
   photos — reviews them, then books the courier for the parcels they accept.

### Alternate paths

| Situation | What happens |
| --- | --- |
| **Any item declined** (partial or all) | Sub-order freezes; enters the admin queue with the vendor's reason. The vendor cannot proceed. |
| **Admin resolves — replace from the same vendor** | The item returns to that sub-order at stage ①; the vendor must confirm it again. |
| **Admin resolves — replace from a different vendor** | The item leaves this sub-order and **joins or creates the other vendor's sub-order**, starting at stage ① there. Shipping is re-quoted. |
| **Admin resolves — remove the item** | The item's value is refunded to the customer's wallet (or deducted from the COD if not yet dispatched). |
| **Admin resolves — cancel the sub-order** | Its share is refunded to the wallet; its loyalty points are returned; the rest of the order continues. |
| **Vendor misses the deadline** | The sub-order is flagged *overdue* in the admin list; the vendor receives a reminder before the deadline expires. It is **never auto-cancelled**. |
| **Sub-order goes to exception** | Only that card turns red. The order keeps progressing on the other sub-orders. |
| **Sub-order returned to the vendor** | Only that sub-order closes as returned; the rest is unaffected. |

### Exit / confirmation

- **Vendor** — the progress bar shows all three stages complete and the sub-order moves
  to the "On the way" tab.
- **Customer** — every card reads *Delivered*, the header reads *Completed*, and the
  return window on each card counts down from its own delivery date.
- **Admin** — the sub-order leaves the intervention and pickup queues.

---

## UX & Layout

### Customer — checkout

The order summary gains two disclosures. Neither adds a step; both sit inside the
summary the customer already reads.

```
──────────────────────────────────────────────
 Your order arrives as 3 separate parcels
 Each has its own courier and its own day.
──────────────────────────────────────────────
 Items                              1,500 EGP
 Coupon SAVE10                       −150 EGP
──────────────────────────────────────────────
 Shipping                             100 EGP  ▾
    Al-Masry Auto Parts · Nasr City       40
    Al-Masry Auto Parts · Giza            30
    Al-Ahram Auto                         30
──────────────────────────────────────────────
 Total                              1,450 EGP

 ── Cash on delivery ──────────────────────────
 What each courier will collect:
    Al-Masry Auto Parts · Nasr City   620 EGP
    Al-Masry Auto Parts · Giza        347 EGP
    Al-Ahram Auto                     483 EGP
                                    ──────────
                                    1,450 EGP
```

- The **parcel-count line** is always visible whenever the basket spans more than one
  (vendor, branch) — it is the sentence that makes everything afterwards unsurprising.
- The **shipping breakdown is collapsed by default** and expandable. The customer who
  does not care sees one number; the customer who wonders "why 100?" gets the answer
  without contacting support.
- The **cash-on-delivery block only appears when cash is the chosen method**, and its
  parts visibly sum to the total. This is what turns "three couriers asked me for three
  different amounts" from a complaint into something the customer already agreed to.
- A single-vendor basket shows none of this — no parcel-count line, no breakdown, no
  per-courier block. Nothing changes for the majority of orders.

### Customer — order detail

One order header, then **a card per sub-order**.

```
──────────────────────────────────────
 Order #REF-A3F9        ● Partially delivered
 15 August              1 of 3 delivered
 Total: 1,450 EGP
──────────────────────────────────────
 ┌────────────────────────────────────┐
 │ Al-Masry Auto Parts   ✓ Delivered  │
 │ 13 Aug · Tracking 78493021         │
 │ ▪ Oil filter  ×2                   │
 │ ▪ Brake set   ×1                   │
 │ Paid: 966 EGP        [Request return]│
 └────────────────────────────────────┘
 ┌────────────────────────────────────┐
 │ Al-Ahram Auto        🚚 In transit  │
 │ Due 17 Aug · Tracking 78493100     │
 │ ▪ Battery ×1                       │
 │ Courier will collect: 483 EGP      │
 └────────────────────────────────────┘
```

- **Primary actions:** *Request return* and *Cancel* live **inside the card they act
  on** — never in the header — so it is impossible to cancel the wrong parcel.
- **Cancel** is only rendered while no pickup is booked for that sub-order.
- **Mobile:** cards stack full-width. Tabs were rejected — the customer must be able to
  see the whole picture in one scroll.

### Vendor — sub-order detail

A three-stage progress bar pinned at the top, the active stage expanded and the others
collapsed. The single primary action for the current stage is a full-width button at
the bottom of the stage, disabled until its requirements are met, with the reason it is
disabled written next to it ("Upload at least one photo").

**Vendor — orders list:** tabs by stage with counts —
*Needs review (3) · Needs tracking (1) · Needs photos (2) · On the way · Delivered.*
The vendor lands on the leftmost non-empty tab, so the next thing to do is always the
first thing they see.

### Admin — order detail

The existing vendor groups become **sub-order cards**, each carrying: the stage
indicator, status, item count and totals, commission, parcel photo thumbnails, the AWB
link, and its own action buttons. An orange banner at the top of the page counts the
sub-orders waiting for intervention and links to the first one.

### Admin — pickups

Per branch, above the *Book courier* button, the list of sub-orders ready today —
each with its reference, photo thumbnails, and tracking number — plus a muted line for
those not yet ready. The button states how many parcels it is booking.

### Navigation placement

No new top-level navigation. Sub-orders are always reached through the order they
belong to, from all three sides.

### Cognitive-load notes

- The vendor is never shown a form with more than one decision at a time.
- Buttons save on press; there is no draft state to lose and no submit step to forget.
- The customer sees a counter ("1 of 3 delivered") rather than a single status word,
  because one word cannot describe three parcels honestly.

---

## States

- **Empty** — a vendor with no sub-orders in the active tab sees the tab's own message
  ("Nothing waiting for tracking numbers") rather than a generic empty state.
- **Loading** — cards render as skeletons in place; the order header and totals appear
  first, since they are already known.
- **Success** — advancing a stage animates the progress bar forward and confirms
  inline. No modal, no page reload.
- **Error**
  - *Bosta refused to create the shipment* — the sub-order stays at stage ① with the
    provider's reason shown, and the vendor can retry. Nothing else in the order is
    affected.
  - *Photo upload failed* — the stage stays open and already-uploaded photos survive.
  - *Sub-order in exception* — the customer's card turns red, states the reason in
    plain language, and offers **Contact support**, which opens a ticket already linked
    to that sub-order.
- **Partial / missing data**
  - At checkout, if a shipping leg cannot be priced for one group, the breakdown names
    that group and says so rather than silently showing a smaller total than will be
    charged.
  - A sub-order with no tracking number yet shows "Preparing" instead of a blank field.
  - A legacy order migrated without parcel photos shows "No photos (order predates this
    feature)" rather than an empty gallery.
  - A vendor whose branch has no Bosta location shows an admin-only warning that this
    pickup must be arranged by hand.

---

## Business Rules

### Status transitions

**Sub-order**

| Status | Meaning | Entered by |
| --- | --- | --- |
| `pending_review` | Vendor has unreviewed items | Order placement |
| `awaiting_tracking` | All items available; Bosta delivery created | Vendor presses *Confirm product availability* |
| `awaiting_handover` | Tracking number assigned; photos required | Vendor scans label / downloads AWB |
| `ready_for_pickup` | Photos uploaded; visible in Pickups | Vendor presses *Confirm ready for pickup* |
| `pickup_scheduled` → `picked_up` → `in_transit` → `out_for_delivery` → `delivered` | — | **Bosta only** |
| `needs_admin` | Any item declined, or vendor suspended | Automatic |
| `cancelled` | — | Vendor request + admin approval, admin, or customer |
| `returned` | Parcel came back to the vendor | Bosta |
| `exception` | Bosta problem state | Bosta |

**Order (derived, never set directly)**

`pending` → `processing` → `partially_shipped` → `partially_delivered` → `completed`,
plus `cancelled` and `exception`. Two new values — `partially_shipped` and
`partially_delivered` — exist so the admin can filter for them. Every screen renders
them alongside a counter: *"1 of 3 delivered."*

- `completed` **only** when every sub-order is `delivered`.
- A sub-order in `exception`, `returned`, or `cancelled` is **excluded** from the
  rollup rather than poisoning it — the order keeps progressing on the rest.
- The order is `cancelled` only when **every** sub-order is cancelled.

### Validations

1. **Stage ① cannot complete with a declined item.** Any decline routes to `needs_admin`.
2. **A decline requires a written reason.** The admin uses that text with the customer.
3. **Stage ③ requires at least one photo, maximum five.**
3a. **Every return request requires at least one photo, maximum six** — whatever the reason.
    Evidence used to be demanded only for the fault-implying reasons, which left
    "changed my mind" on a scratched item with nothing on file. It also pairs with the
    parcel photos the vendor takes at handover: one picture of the box leaving the store,
    one of the goods coming back.
4. **Cancellation requires that no pickup is booked for that sub-order.** Once booked,
   the cancel action is hidden from both the vendor and the customer.
5. **Financial allocation freezes when the first Bosta delivery is created.** From that
   moment the split of shipping, coupon and loyalty discount across sub-orders is fixed.
   Later cancellations refund their own frozen share and never re-price the surviving
   sub-orders — because Bosta offers no way to change a COD amount after a delivery
   exists, and because those figures were shown to the customer at checkout before they
   paid. (In practice that is the end of stage ① with Smart Label off, and the scan in
   stage ② with it on — see the table above.)
6. **The admin cannot edit an order after the allocation freezes**, except to cancel a
   sub-order. Intervention must be resolved before the first vendor dispatches.
7. **A coupon is re-validated only on a customer-initiated cancellation.** If the
   remaining merchandise falls below the coupon's minimum, the coupon is dropped and
   the refund is computed without it. A cancellation caused by a vendor or the admin
   never costs the customer their discount.
8. **COD per sub-order** = its merchandise + its shipping share − its coupon share −
   its loyalty share. The sum across all sub-orders equals `total_price` exactly.
9. **Shipping is quoted per sub-order** (split legs) and presented to the customer as a
   single total at checkout.
10. **Admin status override after dispatch** is limited to closing a sub-order
    (delivered / returned / cancelled) and always requires a written reason recorded in
    the history.
11. **An order-total change on a prepaid order:** a decrease is refunded to the wallet
    immediately; an increase is added to that sub-order's COD and collected on delivery.
12. **The split must be disclosed at checkout, never only afterwards.** A basket spanning
    more than one (vendor, branch) must state the parcel count and expose the per-parcel
    shipping breakdown before the customer commits to payment.
13. **On cash on delivery, the per-courier amounts must be shown at checkout and must
    visibly sum to the order total.** A customer must never first learn that they owe
    three different amounts when the first courier is at the door.
14. **Every amount disclosed at checkout is the one that is charged.** The figures shown
    are the same allocation that is frozen at first dispatch (rule 5) and sent to Bosta
    as each parcel's COD — there is no second, different calculation behind the scenes.

### Notifications

| Recipient | Trigger | Content |
| --- | --- | --- |
| Customer | A sub-order is delivered | Names the vendor and how many parcels remain |
| Customer | A sub-order is out for delivery (cash orders) | The exact amount that courier will collect |
| Customer | A sub-order enters exception | Plain-language reason plus a support link |
| Vendor | Deadline approaching | Which stage they are stuck on and how long is left |
| Vendor | Admin resolves an intervention on their sub-order | What changed and that action is needed again |
| Admin | Any decline, overdue sub-order, or exception | Enters the single "Needs your attention" queue with its reason |

The existing order-confirmation message at placement is unchanged — one message, one
order.

### On cancel / delete / restore

- **Vendor-requested cancellation** — an admin approval step. On approval the system
  terminates the Bosta delivery, releases the smart label, refunds that sub-order's
  frozen share to the wallet, returns its loyalty points, and marks it `cancelled`.
- **Customer cancellation** — same effects, plus coupon re-validation (rule 7).
- **Cancelling the whole order** — cancels only the sub-orders that are not yet
  delivered. Delivered ones stay; the customer uses the normal return flow for those.
  The order is then shown as partially cancelled.
- **Deleting an order** — unchanged, admin only, and only before dispatch.

### Concurrent / conflicting actions

- **A Bosta webhook and an admin override race.** Bosta wins for forward progress; an
  admin's manual close wins only if it is more advanced than what Bosta reports, and is
  recorded with its reason either way.
- **Two admins resolving the same intervention.** The first resolution wins; the second
  is refused with the sub-order's current state shown.
- **A vendor advancing a stage while an admin is editing.** The freeze rule settles it:
  once any sub-order dispatches, editing is closed, so the two cannot overlap on money.
- **A pickup being booked while a customer presses cancel.** The booking wins; the
  cancel is refused and the customer is told the parcel is already scheduled.

---

## Edge Cases

**Rare or invalid operations**

- One vendor shipping from two branches → **two independent sub-orders**, each with its
  own stepper, tracking number, photos, earnings row, and return window. The customer
  sees the vendor's name twice with different branches.
- A vendor declines every item → same path as a partial decline: freeze and hand to the
  admin, who may source a replacement from another vendor.
- An admin replaces an item with one from a vendor whose sub-order has already been
  dispatched → a **new** sub-order is created for that vendor rather than reopening the
  dispatched one.
- Bosta rejects the delivery at stage ① → the vendor stays at stage ① with the reason
  and can retry; no other sub-order is touched.
- A vendor stalls for weeks at stage ② → flagged overdue, never auto-cancelled; a live
  Bosta delivery exists, so only an admin cancellation may terminate it.

**Abuse scenarios**

- *Coupon erosion.* A customer cancels sub-orders until the remainder falls below the
  coupon minimum → re-validation on customer-initiated cancellation drops the coupon.
- *Free-shipping erosion.* Same mechanism, same guard.
- *Vendor gaming photos.* Photos are timestamped and attributed; the admin can refuse a
  parcel at the pickup stage.
- *Vendor cancelling to dodge a bad-margin order.* Cancellation is a request, not an
  action, and every request is recorded against the vendor.

**Data-consistency risks**

- *COD drift.* Bosta exposes no way to update a delivery's COD after creation
  (`bostaService` offers only `createDelivery` and `terminateDelivery`). The freeze rule
  is the mitigation — see the Decision Log.
- *Split rounding.* Shares are allocated at the smallest currency unit using the
  existing largest-remainder method, so the parts sum to the total with no drift.
- *Migration ambiguity.* A legacy order whose shipments do not record item ids cannot be
  split with confidence and is migrated as a single sub-order containing everything.
- *Duplicate earnings.* An earnings row is keyed per sub-order and created once, on that
  sub-order's own delivery.

**Permission conflicts**

- A vendor must never see another vendor's items, totals, or the order total. Sub-orders
  make this structural rather than a filter applied at read time.
- A customer must not see commission or vendor cost anywhere on a sub-order card.
- A vendor must not see the customer's full address before their sub-order reaches
  stage ② — the current rule is unchanged.

---

## Decision Log

### Sub-orders are embedded in the order, not separate orders

- **Decision:** One order document keeps one price, one payment, one coupon, and one
  loyalty snapshot. Sub-orders are a structure inside it.
- **Reason:** Everything financial is already order-level and singular. Splitting into
  separate order documents would force one payment, one coupon, and one loyalty spend to
  be distributed across N documents — a far harder problem than the one being solved,
  and one that risks real money.
- **Alternatives considered:** True separate orders per vendor (rejected: distributed
  money handling); display-only grouping (rejected: does not remove the dispatch gate).
- **Impact:** The customer's single-order experience is preserved for free. Reporting
  and refunds keep working against one document.

### The sub-order is (vendor + branch), not vendor

- **Decision:** A vendor shipping from two branches gets two sub-orders.
- **Reason:** Each branch is a physically separate parcel with its own pickup, tracking
  number, photo, and delivery date. One stepper cannot honestly represent two parcels.
- **Alternatives considered:** One sub-order per vendor holding several shipments
  (rejected: the stepper becomes ambiguous and the return window undefined); forcing the
  vendor to consolidate into one branch (rejected: blocks vendors with distributed stock).
- **Impact:** Earnings and returns must also become per sub-order — accepted
  deliberately (next entry).

### Earnings and returns move to the sub-order

- **Decision:** Both the earnings ledger and return requests are keyed per sub-order
  rather than per (order, vendor).
- **Reason:** With per-branch sub-orders, a single per-vendor row cannot answer "which
  delivery date?" when two branches arrive four days apart. Keeping them per vendor
  would reintroduce exactly the blocking this feature exists to remove — a vendor's
  first branch waiting on their second.
- **Alternatives considered:** Keeping the money per vendor and clearing on the last
  delivery (rejected: the same blocking, one level down).
- **Impact:** The largest data-migration cost in this feature, and the reason existing
  orders must be converted rather than left on the old model.

### The shipment is created at whichever moment yields a usable tracking number

- **Decision:** With Smart Label **off**, the Bosta delivery is created as the vendor
  finishes stage ①, so the printable waybill exists by the time they reach stage ②. With
  Smart Label **on**, it is created at the scan in stage ②, carrying the number already
  stuck on the parcel. Neither path involves the admin.
- **Reason:** The plan first said "created at the end of stage ①" for both modes. That is
  incoherent for Smart Label: if Bosta had already minted a number, scanning a pre-printed
  label afterwards would leave two numbers on one parcel. The two modes genuinely need the
  number at opposite ends of stage ②.
- **Alternatives considered:** Always creating at stage ① and ignoring the scanned number
  (rejected: defeats the point of Smart Label, which exists so that no waybill is printed);
  always creating at stage ③ (rejected: the vendor would photograph an unlabelled parcel
  and stick the label on afterwards).
- **Impact:** The admin's role really is only the pickup on both paths, which is what the
  approved decision asked for. It also makes the freeze rule below precise — it fires when
  a delivery actually exists, rather than at a stage number.

### The financial allocation freezes when the first delivery is created

- **Decision:** The moment the first Bosta delivery on an order exists, the split of
  shipping, coupon, and loyalty across sub-orders is frozen. Later cancellations refund
  their own frozen share and never re-price the survivors. The admin cannot edit the
  order after that point, only cancel.
- **Reason:** Two independent facts force it. Bosta exposes only `createDelivery` and
  `terminateDelivery`, so a COD amount cannot be restated once a delivery exists — without
  the freeze, cancelling one sub-order would re-allocate shipping and coupon shares onto a
  sibling whose COD is already locked at Bosta, and the courier would collect the wrong
  amount (hundreds of pounds on a typical basket). And the same figures were shown to the
  customer at checkout before they paid, so they cannot quietly change afterwards either.
- **Alternatives considered:** Deferring delivery creation to stage ③ (rejected: the
  vendor would have to stick the label on after photographing the parcel); terminating
  and recreating the delivery on every change (rejected: a new tracking number each time,
  forcing the vendor to re-print or re-scan).
- **Impact:** Interventions must be resolved **before** the first vendor dispatches. In
  the rare case where a later cancellation shifts the true shipping burden, the store
  absorbs the difference rather than surprising the customer at the door.

### Coupons are re-validated only when the customer cancels

- **Decision:** A customer-initiated cancellation that drops the order below a coupon's
  minimum drops the coupon. A vendor- or admin-initiated cancellation never does.
- **Reason:** A customer must not lose a discount because a vendor ran out of stock, and
  the store must not fund an unearned discount when the customer chose to shrink the
  order.
- **Alternatives considered:** Always re-validate (rejected: punishes customers for
  vendor failures — a guaranteed complaint); never re-validate (rejected: an exploitable
  gap once customers can cancel parts).
- **Impact:** The refund calculation must know **who** initiated the cancellation.

### COD carries its share of shipping and discounts

- **Decision:** Each sub-order's cash-on-delivery amount is its merchandise plus its
  shipping share, minus its coupon and loyalty shares. The sum equals the order total.
- **Reason:** Today the couriers collect merchandise only — so the store never collects
  shipping on cash orders, and the customer is charged the value of a coupon they were
  granted. It is invisible now because there is one blended number; per-sub-order cards
  make it visible on every order.
- **Alternatives considered:** Putting all shipping on the first parcel (rejected:
  breaks if that parcel is returned); leaving the calculation as-is (rejected: a known
  revenue leak that sub-orders would put in front of every customer).
- **Impact:** Fixes an existing defect that is independent of this feature. The
  allocation reuses the share arithmetic already written for refunds.

### Shipping and cash are itemised per parcel at checkout

- **Decision:** A multi-vendor basket states its parcel count at checkout, exposes an
  expandable per-parcel shipping breakdown, and — on cash on delivery — lists exactly
  what each courier will collect, summing to the total. A single-vendor basket shows
  none of it.
- **Reason:** Splitting an order is only disruptive if it is a surprise. Once the
  customer has read "3 parcels, 3 couriers, these amounts" *before* paying, the whole
  feature stops being something that happens to them and becomes something they agreed
  to. It also removes the single most likely support call this feature would otherwise
  create: *"why is the courier asking me for a different number?"*
- **Alternatives considered:** Showing one blended shipping figure and explaining the
  split only in the order details afterwards (rejected: the customer discovers the split
  after committing, which is exactly the surprise to avoid); always showing the
  breakdown expanded (rejected: adds noise to every single-vendor order and most
  multi-vendor ones, where the customer only wants the total).
- **Impact:** Makes the per-parcel allocation a **customer-facing promise**, not just an
  internal calculation. It is therefore also the reason the allocation must freeze
  (see the freeze decision) — a number shown before payment cannot quietly change after.

### The vendor works a three-stage wizard, not a status dropdown

- **Decision:** Confirm products → assign tracking → confirm ready, with the availability
  and photo requirements as gates inside the stages rather than statuses of their own.
- **Reason:** The admin only needs one answer from the vendor — "can I put this on
  today's pickup?" — and all three stages serve that one question. A longer status list
  would clutter every dashboard without answering anything more.
- **Alternatives considered:** Seven separate statuses (rejected: dashboard noise);
  reusing the existing order statuses with checkmarks (rejected: gives the vendor no
  sense of a path to follow).
- **Impact:** Stage completion is the natural place for the deadline to be measured.

### Item review saves on press

- **Decision:** Availability buttons write immediately; there is no submit step. A
  decline opens a mandatory reason. An "All available" button confirms everything at once.
- **Reason:** The current toggle-then-submit pattern loses work and leaves the admin
  guessing why an item was declined.
- **Alternatives considered:** Keeping the submit button (rejected: the source of the
  complaint); adding a "partial quantity" option (rejected for now — it opens a whole
  price-difference workflow; recorded as an open question).
- **Impact:** The admin's "vendor finished reviewing" signal becomes simply "no item is
  left unreviewed."

### Existing orders are all migrated

- **Decision:** Every live order converts to sub-orders at release, with each sub-order's
  status derived from its actual shipment state.
- **Reason:** Two order shapes in one admin list is a support burden that outlasts the
  release and makes every bug report ambiguous.
- **Alternatives considered:** New orders only (rejected: two UIs indefinitely);
  migrating only undispatched orders (rejected: the same split-brain, smaller).
- **Impact:** Migration must be reversible and must be rehearsed against a copy of live
  data before release.

---

## Open Questions

- [ ] What is the default deadline value, and is it measured from order placement or
      from when the sub-order first becomes actionable to the vendor?
- [ ] Should the deadline be overridable per vendor (a vendor whose goods are made to
      order needs longer), or is one global number enough for now?
- [ ] "Partial quantity available" (vendor has 1 of 2) was deferred. Is it needed in v1,
      or does the admin-intervention path cover it well enough?
- [ ] Exactly which Bosta exception reasons are shown to the customer verbatim, and
      which are replaced with a neutral message?
- [ ] Do parcel photos need a retention limit, and who may delete them after delivery?
- [ ] Should the admin be able to reject parcel photos and push a sub-order back to
      stage ③, or only exclude it from today's pickup?
- [ ] Does the customer's Cancel button need a reason field, and should repeated
      cancellations be rate-limited?
- [ ] Should the vendor see the customer's phone number at stage ②, or stay on the
      current rule?
- [ ] How are family and friend orders presented — does the recipient see per-sub-order
      cards, or only the payer?
- [ ] What happens to a sub-order whose vendor is hard-deleted (feature 1) while the
      parcel is in transit?
