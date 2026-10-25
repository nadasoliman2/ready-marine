# 14 - Corporate Accounts

> Status: Built — all 5 phases, plus the project owner's decisions of 29 Sep 2026 · Created: 2026-09-28 · Updated: 2026-09-29
> English edition of [14-corporate-accounts.md](./14-corporate-accounts.md). Both files describe the same feature — keep them in sync.
>
> This document is business and UX requirements only — it contains no technical design.

## Implementation status

The build is split into five phases, each of which works on its own:

| Phase | What it contains | Status |
| --- | --- | --- |
| 1 · Foundation | Companies, managers, invitations (email + WhatsApp + Excel), groups and limits, offices, company cars, the company portal, the "My company" tab, the admin Companies section and consolidation settings | ✅ Built |
| 2 · Ordering on the company account | Payment method, limits and cap (the company pays a whole order or none of it), company-car orders, office delivery, returns and cancellations, ledger + Excel (instant mode only) | ✅ Built |
| 3 · Consolidation | Batches, the two checkout cards, hold/split/return, batch tracking, the consolidated parcel | ✅ Built |
| 4 · Invoicing and collection | Monthly invoice, payments and receipts, overdue and suspension | ✅ Built |
| 5 · Admin statistics | Company and consolidation figures | ✅ Built |

**Adjusted during implementation to fit the existing system:**
- **There is no SMS provider** — an invitation to a mobile number goes over **WhatsApp** (as Family invitations do); an email goes by email.
- **There is no server-side PDF library** — the invoice (phase 4) will be a page saved as PDF from the browser (the vendor-report approach, which renders Arabic correctly), and the email carries a link to it rather than an attachment.
- **A manager signs in with their normal ReadyCar account** and finds "Company portal" in their account menu — not a separate account like a vendor's.
- **Limits and the cap are held at the same moment they are checked,** so two orders in the same second cannot both go over the limit.
- **The combined parcel at the courier:** one order in the batch (the first to join) becomes the **"main parcel"** — it gets the waybill or Smart Label, and its shipment carries every order's items. The others have no shipment of their own; their status follows the main parcel until it is delivered, and then each order is recorded as delivered on its own (vendor earnings, points and notification for each).
- **The vendor confirms each order separately** (each is a different customer), and the shipment is created once, after the last one is confirmed. If an item is declined, the whole parcel waits until the website team resolves it.
- **Customer labels:** a printable page with one label per customer (name, order number, items) to stick on their bag inside the parcel.
- **Once an order is packed in the combined parcel it can no longer be cancelled with a click** — it comes back as a return after delivery. While it is still waiting in the batch it can be cancelled or "shipped now" as usual.
- **The admin can close any waiting batch early** from the company page ("Batches" tab).
- **The savings shown to the company** = the savings of orders that were not cancelled, minus any shipping difference the company absorbed when an order left a batch after it closed.
- **The invoice issues itself on the 1st of the month** (an hour after midnight, Cairo time) for every order **placed** in the month before, whatever its state. An order still waiting in a batch is billed at the full shipping held for it; what the batch saves when it closes comes off the next invoice as a "consolidation saving — earlier month" line. Numbered like `INV-202608-0001`.
- **One line per order:** charged → shipping saved → returned before the invoice → what the company pays. Below them, separate lines for earlier-month adjustments, shipping differences and any carried credit.
- **Once issued, the month is closed:** a return, cancellation or charge on one of its orders is booked on the current month and appears on the next invoice; limits are not touched.
- **A negative invoice** (more returned than bought) has nothing due; the balance comes off the next invoice.
- **Due date** = the end of the day (Cairo time) that many payment-term days after issue.
- **The bank details printed on invoices**, and how many days before the due date the first reminder goes (default 3), are set in the admin's corporate-account settings.
- **Transfer receipts** are an image or a PDF up to 8 MB, stored so only the company itself and the admin can open them. An amount cannot exceed what is left on the invoice; the admin may correct the amount when confirming, or reject with a reason the company sees.
- **A pause for being late** lifts itself once the late invoice is paid. If the admin resumes the company by hand before payment, that counts as extra time (the company's grace days, at least 3) before the system pauses it again.
- **Treasury:** now shows "owed by companies" (invoiced and how much is overdue, plus this month's orders not invoiced yet) on its own, never added to money held by gateways and couriers. Confirmed transfers count as collected on their transfer date.
- **Admin statistics** (every company together from the "Statistics" button, one company from its "Statistics" tab): month by month for up to 24 months, in four parts — money (including the share of invoices paid on time), activity, shipping and consolidation, and top vendors and products — exportable to Excel or printed as PDF.
  - **The month** is the order month (the same as the limit and the invoice); **batches** count in the month they closed.
  - **Limit and cap usage** are measured against today's limits and caps, because their history is not recorded.
  - **"ReadyCar saved (estimate)"** = parcels saved × the average cost of an ordinary parcel (from the cost recorded on shipments) − the savings given back to companies. It shows "—" until real parcels have shipped.
  - **An N and T tuning hint:** when most batches close with one order, mostly on time, or fill very fast, the page suggests which way to move — a suggestion only; nothing changes by itself.
  - **The companies list** now also shows this month's orders, how many employees ordered, and cap usage.

**The project owner's decisions of 29 Sep 2026 (applied):**
- **The invoice on the 1st of the month** for every order placed in the month before (above).
- **The payment grace period is per company** — it already was: payment terms and overdue grace days are set on each company.
- **Loyalty points go to the person who placed the order** — personal orders and company orders alike, on the whole order (already so).
- **The company pays a whole order or none of it:** an order bigger than what is left of the limit (or the company cap) is refused on the company account, and the employee places it from their own account with another payment method. No splitting, no paying the difference.
- **An employee who leaves the job:** the manager **pauses** them (a reversible "Pause ordering" button, one by one or in bulk) — they can no longer order on the company account; their history, group and limit stay; orders already placed continue. The employee's own "leave" button is removed.
- **Change history per employee:** who changed their limit, group or office (from → to), who paused or resumed them, and when — a "History" button on the employee's row in the portal, and on the admin's employees tab. Group and office names are saved as they were at the time.
- **One person can belong to several companies.** They choose which company pays at checkout; each company has its own limit, offices and invoice. A manager of more than one company switches between them from a list in the portal sidebar.

**The last open questions, closed (29 Sep 2026, applied):**
- **Ending a contract:** an "End contract" button on the admin's company page (with a confirmation that asks for the company's name). At once: no new orders, pending invitations cancelled, employees released as ordinary customers (and told), managers keep the portal for invoices and payments, orders already placed (waiting in batches too) carry on. The final invoice is issued immediately for everything not invoiced yet, the current month included. Returns or batch savings that arrive afterwards go on a settlement statement on the next 1st; the company's credit is set first against its unpaid invoices, and what is left is owed back — the admin transfers it and records it. The end cannot be undone.
- **Cap alert:** the managers are told (in the portal and by email) when the month's spend passes 80% of the cap, and when the cap is used up (reached, or an order refused for the cap past 80%). Once per month per cap value — raising the cap re-arms them. The admin companies list colours the cap share amber past 80% and red when used up.
- **Company cars in "Fits my car":** a company car is now picked from the site's make/model/year list (like a garage car). Managers see their company cars next to their garage in the shop's "Fits my car" pickers and the product page's fitment report; picking one while shopping pre-selects that car (and its company) at checkout.
- **A combined parcel dearer than separate ones:** the batch is not combined — each order ships on its own at the shipping it was charged. Nobody loses.
- **Found while building:** notifications "to the admin" across the whole system are stored where no admin screen reads them, so they reach no one. Not changed here; the admin sees company alerts in the lists and the company page instead.

## Overview

ReadyCar is opening a new sales channel for companies. **Only we** (the admin) create a company
account, from the dashboard. A company has one or more Account Managers and brings its employees
in by uploading a list of emails or phone numbers; each person receives an invitation to join.
Every employee has a **monthly limit** to spend on the company's account — the company default,
the limit of the group they belong to, or a personal limit. A manager can also order parts **for
the company's own cars**.

The company does not pay per order. It pays ReadyCar **one invoice at the end of every month** for
everything ordered on its account. So the company gets a **ledger** showing who took what, for how
much, when, and how much each employee has spent — and the **admin gets a ledger** showing, per
company, what has been paid, what is still owed, and how many orders it has placed.

Shipping is currently subsidised by ReadyCar and runs at a loss, so the feature includes a
**"Consolidate to office" mode**: orders from employees of the same company, from the same vendor,
wait for a short while and ship as **one parcel** to the company's office, with that parcel's
shipping split between them. The employee sees how much they will save while ordering, and the
company sees how much it has saved — so both choose it more often.

---

## Goal & Success

- **Goal:** Companies order from ReadyCar often and regularly, because the employee gets a perk:
  order against the company's limit (and the company settles it with them internally — a salary
  deduction or whatever scheme it runs).
- **Important secondary goal:** Most company orders are delivered to the office and consolidated,
  so there are fewer parcels and less shipping subsidy for ReadyCar to carry.
- **Primary user value:**
  - **Employee** — orders parts for their personal car without paying at the time, and saves on
    shipping by waiting for colleagues.
  - **Company** — a perk for its staff under its full control (limits, groups, cap), one clear
    invoice a month, and parts for its own fleet from the same place.
  - **ReadyCar** — steady monthly revenue from large customers, and fewer parcels.
- **Success looks like** (all of these matter):
  1. Companies order every month; their number grows and they don't churn.
  2. A large share of company orders is delivered to the office and consolidated.
  3. Month-end invoices are paid on time.
  4. Employees use a large part of the limit available to them.

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Company** | A B2B customer created by the admin. Pays a monthly invoice |
| **Manager** (Account Manager) | Someone who runs the company account from the company portal. There can be several |
| **Employee** | A regular ReadyCar customer who joined the company through an invitation. Orders against their limit |
| **Office** | One of the company's addresses (a company can have several). Every employee belongs to one office |
| **Group** | A set of employees who share the same limit |
| **Limit** | The most an employee can spend on the company's account per month, **shipping included** |
| **Company cap** | The most the whole company can spend per month. Set by the admin |
| **Company cars** | Cars owned by the company; the manager registers them and orders parts for them |
| **Consolidate-to-office mode** | The order waits in a batch with colleagues' orders from the same vendor and ships as one parcel to the office |
| **Instant mode** | The order moves immediately with full shipping, to home or to the office |
| **Batch** | The orders waiting for the same (office × vendor). Closes on a count or on time |
| **Hold** | The amount held from the limit at order time (products + full shipping) until the batch closes |
| **Monthly invoice** | A statement of everything ordered on the company's account in a month |

---

## User Types & Permissions

| Role | Create | View | Edit | Delete | Notes |
| ---- | :----: | :--: | :--: | :----: | ----- |
| **ReadyCar admin** | The company + its first manager (one form); can add a manager at any time | All companies, and every ledger, invoice, payment and statistic | Monthly cap, payment terms, overdue grace period, global consolidation settings and per-company override, recording payments, suspending/reactivating a company | — (ending a contract: open question) | The only role that creates companies. Confirms transfer receipts uploaded by the company |
| **Company manager** | Invites employees (Excel or manual), creates groups, adds offices and cars, adds other managers | Their own company portal only: employees, ledger, invoices, savings | Default limit, groups and their limits, per-employee overrides, assigning employees to groups and offices, which modes are available | Remove an employee, cancel an invitation, remove a manager (at least one must remain) | All managers have the same permissions. Orders **for company cars only**; for a personal limit, the company adds them as an employee on the same account |
| **Employee** | Orders on the company's account within the limit (an order above what is left is placed from their own account) | Limit and remaining balance, their company-paid orders, their waiting batches | Chooses the mode per order (or per parcel) | Cancels or rushes their order while it waits in a batch | May belong to several companies and picks which one pays at checkout. Orders they paid for themselves are **never** visible to the company |
| **Vendor** | — | Receives the orders **after** the batch closes. A batch appears as **one consolidated parcel** holding each employee's order separately | Confirms each order's items on its own, and prepares one parcel with one waybill | — | A clear alert: pack each employee's items separately with their details on it, then all of them in one parcel carrying the Smart Label or the waybill |

_Ownership / role-change rules:_

- The employee signs in with **their normal ReadyCar account** (or creates one from the
  invitation). The company account appears to them as a payment method called "On company
  account", and they can still buy for themselves with their own money at any time.
- The manager role is attached to the person's ReadyCar account. One person, one login: if the
  company also adds them as an employee, they get a personal limit and keep a "Company portal"
  button.
- A person can belong to several companies at once (an invitation from a second company is
  accepted normally). At checkout they choose which company pays; each has its own limit.
- **When an employee leaves the job, the manager pauses them** ("Pause ordering"): they can no
  longer order on the company account until resumed; their history, group and limit stay. The
  employee has no "leave" button of their own.
- When the company removes an employee: from that moment they cannot place new orders on the
  company account, but everything they ordered while employed (including orders waiting in a
  batch) **continues and is billed to the company**. The manager sees these open orders before
  confirming the removal.
- If a manager is removed, the company-car orders they placed continue as normal.

---

## User Journeys

### Entry points

| Who | Where from |
| --- | --- |
| Admin | A new section in the admin dashboard: **Companies** |
| Manager | The activation email the first time → afterwards every sign-in lands them straight in the **company portal** |
| Employee | The invitation link (email or WhatsApp depending on the contact) → after joining: the limit badge in the header, a **"My company"** tab in the profile, and "On company account" on the checkout page |

### Happy path — the admin creates a company

1. Admin → Companies → "New company".
2. One form: company name, commercial registration, tax card, first office (address), monthly
   cap, payment terms (default 15 days), and the first manager's details (name + email + phone).
3. Save → the company is active and the manager receives an email to set a password and sign in
   (if they already have a ReadyCar account, they sign in with it and the role is added to it).

### Happy path — the manager sets up the company

1. First sign-in → a **setup checklist** (4 steps with ✓ marks): confirm the office, set the
   default limit, enable the modes, add employees.
2. **Add employees** → choose: upload Excel (from a template we provide) or add manually.
3. On upload: a **preview screen** where each row is marked (valid / duplicate / already a
   member / invalid email or phone / group doesn't exist). Fix the row in place or skip it →
   "Send 47 invitations".
4. Create groups with limits and assign employees (from the employees table, selecting several at
   once).
5. (Optional) Add more offices and register company cars.

### Happy path — an employee joins

1. The invitation arrives → they open the link.
2. Sign in or create an account (the invited email or phone is pre-filled). **They must accept
   with the account that owns the invited contact** — the link alone is not enough if it was
   forwarded to someone else.
3. **Acceptance page:** company name, their limit, their office, and a clear note: "The company
   will see the orders you place on its account only — your personal purchases will not be
   visible to it". Two buttons: **Join** / **Decline**.
4. After accepting: a **short walkthrough** explaining the two modes (consolidate and instant)
   and how consolidating saves money.

### Happy path — an employee orders in consolidate mode (the most important journey)

1. They shop as usual. The header badge reminds them: "Company X · 1,250 EGP left".
2. Checkout → payment method: **On company account**.
3. **Delivery method: two cards side by side, with numbers** (stacked on mobile):

   ```
   ┌── Consolidate to office ─┐ ┌── Instant ────────────┐
   │ ★ Save up to 40 EGP      │ │                       │
   │ Shipping: 20 – 60 EGP    │ │ Shipping: 60 EGP      │
   │ Arrives: within 3-4 days │ │ Arrives: 1-2 days     │
   │ Where: Maadi office      │ │ Where: Home ▾         │
   │                          │ │                       │
   │ 2 colleagues waiting on  │ │                       │
   │ this vendor ← how?       │ │                       │
   └──────────────────────────┘ └───────────────────────┘
   ```

   - The choice applies to **the whole order**. Below it, a collapsed "Customise per parcel" for
     someone who wants to rush just one parcel.
   - For each vendor in the cart, the state of its batch is shown: **the count + the latest
     departure time + their share, without names**. For example: "2 colleagues have ordered from
     this vendor. If you join, the batch completes and ships immediately and your share is
     20 EGP. If it doesn't complete, it ships Sunday at 3 PM at the latest."
   - A clear line: "We'll hold 60 EGP of shipping from your limit now; whatever is saved comes
     back to you as soon as the batch closes."
4. If the order + hold exceeds what is left of the limit: "On company account" is closed for this
   order with the reason, and the employee pays with another method from their own account (or
   trims the basket). The company pays a whole order or none of it.
   Someone in several companies first picks **which company pays**.
5. Confirmation → **batch tracking page**: a "2 of 3" progress bar, a countdown to the latest
   departure time, a **"Ship it now"** button, a **"Cancel"** button, and a **"Tell your
   colleagues"** button that sends the vendor's link over WhatsApp so the batch fills faster.

### Happy path — a batch closes

1. The batch closes as soon as **either** of these happens: the count is reached, or the time
   runs out.
2. Shipping is priced for the consolidated parcel and split (see the splitting rules below).
3. Each employee is notified: "Your batch closed — your shipping share is 20 EGP, 40 EGP has
   been returned to you".
4. The orders go to the vendor and follow the normal order flow (sub-orders) as one parcel to the
   office.
5. A notification when the parcel ships, and another when it reaches the office.

### Happy path — a manager orders for a company car

1. They shop with their account as usual → checkout → "On company account".
2. **Who is this order for?** → "A company car" and they pick the car (and if they are also an
   employee: "Me — from my limit").
3. The same two modes: consolidate to office (the order joins the same batch as the employees'
   orders and counts toward it) or instant.
4. The only limit is the **company's monthly cap**.

### Happy path — month end

1. The month ends → on **the 1st** the invoice is issued for every order placed in the month.
   An order still waiting in a batch is on it at full shipping; its saving comes off the next
   invoice once the batch closes.
2. The manager gets an email + a notification in the portal; the invoice PDF and the ledger
   Excel are ready (the Excel includes a per-employee totals sheet for payroll deductions).
3. A reminder before the due date and one on the day.
4. The company pays by bank transfer → (optionally) uploads a photo of the receipt from the portal
   → the admin confirms and records the payment (amount, date, reference number, receipt).
   Partial payments are allowed.
5. The invoice becomes "Paid".

### Alternate paths

- **The employee rushes:** "Ship it now" → the order leaves the batch and ships instantly with
  full shipping to the same address. The hold was full shipping already, so no extra money is
  needed.
- **The employee cancels while waiting:** the whole amount comes back to the limit and the batch
  count drops by one.
- **Instant mode:** no waiting and no batch; full shipping; delivered to home or the office, the
  employee chooses.
- **Limit used up / order bigger than what is left / company cap used up / company suspended /
  employee paused:** "On company account" is shown
  **disabled with the reason** in plain words ("Your limit renews on 1 October"), and personal
  payment remains available. If the reason is an overdue invoice, the employee only sees
  "Ordering on the company account is temporarily paused" — the reason is not disclosed.
- **The employee declined or the invitation expired:** the manager sees it in the table and can
  "Resend" to one person or to everyone expired at once.

### Exit / confirmation

- **Employee:** the order confirmation page shows the mode, the batch state, the amount held from
  the limit, and what is left after this order.
- **Manager:** the home page updates (spend, savings, active employees).
- **Admin:** the company appears in the list with its status and figures.

---

## UX & Layout

### Company portal (separate, like the vendor portal)

- **Sidebar:** Home · Employees · Groups · Offices · Company cars · Purchases (ledger) ·
  Invoices · Settings.
- **Home:**
  - **4 figures** at the top: this month's spend against the cap · the invoice due and its due
    date · **shipping savings this month** ("You saved 1,240 EGP — 31 fewer parcels") · active
    employees out of those registered.
  - Below them, a **"Needs your attention"** list: expired invitations, employees without a
    group, an invoice nearing its due date.
  - First time: the **setup checklist** in place of "Needs your attention"; it disappears once
    done.
- **Employees:** one table — name, status (joined / paused / pending / expired / declined), group,
  office, limit, spend this month. Per row: edit, **history**, **pause / resume**, remove.
  Selecting rows → bulk actions: move to group, move to office, pause, resume, remove. An **"Add employees"** button at the top right opens a choice:
  upload Excel or add manually.
- **Groups:** group name, limit, number of employees. The default limit is set in Settings. An
  override for a specific employee is set from their row in the employees table.
- **Offices:** address, number of employees assigned.
- **Company cars:** make, model and year (from the site's list, like a garage car), plate number,
  and spend per car.
- **Purchases (ledger):** every order on the company's account: who (employee or car), what (the
  products), how much (the company's share), shipping ("would have been 60, paid 20"), when, the
  mode, and the status. Filters by month, employee, group and car. An **"Employee summary"** tab:
  how much each employee spent this month. An Excel export button.
- **Invoices:** the list of months with their status (accruing / issued / partially paid / paid
  / overdue), the PDF, and uploading the transfer receipt.
- **Settings:** default limit, available modes (consolidate / instant), adding managers.
- **A manager of several companies** switches between them from a list at the top of the sidebar.

### Employee side

- **Header:** a small badge with the company name and "X EGP left". It opens the "My company" tab.
- **"My company" tab in the profile:** a card per company (limit, what's left, renewal, office,
  group); waiting batches with their state; my orders on the company account (with the company
  name when there are several). A paused employee sees that ordering is paused.
- **Checkout page:** "Which company pays?" (for someone in several), the two mode cards, the batch
  state per vendor, and the hold and the balance after this order.
- **Batch tracking page:** the progress bar, the countdown, and the "Ship it now", "Cancel" and
  "Tell your colleagues" buttons.

### Admin dashboard — a new "Companies" section

- **Companies list:** money columns (invoiced, paid, outstanding, overdue) and activity columns
  (orders this month, active employees, cap usage), plus status.
- **Company page with tabs:** Overview · Employees · Orders · Invoices & payments · Settings (cap,
  payment terms, overdue grace period, consolidation override, suspend/reactivate).
- **Global consolidation settings:** order count and waiting hours.
- **A statistics dashboard across all companies** (see the reporting section).

### Primary actions & button placement

- The primary action on each company-portal page is a single button at the top right ("Add
  employees", "New group", "Add car").
- Bulk actions appear in a bar above the table once one or more rows are selected.
- On the checkout page: the two cards come before the "Confirm order" button, and the held amount
  is written next to the button.

### Mobile vs desktop

- **Employee: mobile first.** Choosing the mode, tracking the batch and the limit are designed for
  mobile first (the two cards stack).
- **Company portal: desktop first** (tables and Excel), and it works on mobile with tables turning
  into cards.

### Cognitive-load notes

- The employee doesn't need to understand "batch" or "hold" as terms — the card states the
  outcome in EGP and a time.
- The single promise that must come across: **"You'll never pay more than instant, and whatever
  is saved comes back to you."**
- No colleague names anywhere — numbers only.
- "How?" next to the card opens a short explanation with an example.

---

## States

- **Empty:**
  - New company: the setup checklist.
  - Empty employees table: "No employees yet" + the two buttons (Excel / manual).
  - An employee who hasn't ordered yet: the "My company" tab shows the full limit and a "Start
    shopping" button.
  - No batch yet for a vendor: "You'll be the first — the batch ships when it reaches 3 or at
    [time] at the latest".
- **Loading:** skeletons for tables and cards. The batch state on the checkout page loads on its
  own without blocking the page.
- **Success:**
  - Invitations sent: "47 invitations sent" + a link to the employees table.
  - Order confirmed: the mode, the batch state, and the hold.
  - Batch closed: a notification with the amount returned.
- **Error:**
  - Excel errors are shown row by row on the preview screen.
  - "On company account" disabled with a clear reason (limit / cap / suspension).
  - If the batch closed while you were paying: the confirmation page says clearly that your order
    started a new batch and shows the new time.
- **Partial / missing data:**
  - Employee without a group → gets the default limit and appears under "Needs your attention".
  - This month's invoice → status "accruing" until the 1st of next month.
  - The arrival estimate in consolidate mode is shown as a range, not a specific day.

---

## Business Rules

### 1) The company and its managers

- Only the admin creates a company. The form includes the first manager.
- A manager can add other managers with the same permissions. The admin can add a manager at any
  time.
- **At least one manager** must remain.
- A manager orders **for company cars only**. A personal limit comes only if the company adds
  them as an employee.

### 2) Invitations and joining

- Adding: an **Excel file** (columns: name, email or phone, group — optional) or **manually**.
- Before sending: a **preview** with a mark on every row (valid / duplicate within the file /
  already a member / invalid contact / group doesn't exist). Fix or skip.
- The invitation goes to the contact entered (email or phone), as the existing invitation system
  does.
- An invitation is **valid for 14 days**, then becomes "expired", and the manager can resend it
  (to one person or to all).
- Acceptance must be **with the account that owns the invited contact**.
- The acceptance page contains the privacy note, and the employee must press "Join".
- A person may belong to **several companies**; an invitation from another company is fine.

### 3) Limits, groups and the cap

- The limit is **monthly**: it renews in full **on the 1st of every month**, and anything unspent
  **is lost**.
- The limit **includes shipping** (products + shipping − discounts).
- **3 levels, the most specific wins:** the employee's override ← the group's limit ← the
  company's default limit.
- **Changing a limit or moving someone to another group mid-month takes effect immediately, with
  no retroactive effect:** remaining = new limit − what was spent this month, floored at zero.
  Orders already placed are not cancelled. The manager sees a warning before saving: "3 employees
  have spent more than the new limit".
- **No approval:** any order within the limit goes through immediately.
- **The company's monthly cap** (set by the admin): the total of everything on the company's
  account — employees + cars — **including amounts held in waiting batches**. Once the cap is used
  up, nothing more can be ordered on the company account until next month. The difference returned
  when a batch closes frees up cap.
- **All or nothing:** the company covers the whole order (products + shipping held − discounts)
  when it fits in both what's left of the employee's limit and what's left of the company cap.
  Otherwise the order is refused on the company account and the employee pays from their own
  account.

### 4) Paying on the company account

- "On company account" is a payment method on the checkout page.
- **Above what is left of the limit:** the order is refused on the company account — no
  splitting and no paying the difference. The employee places it from their own account with any
  normal payment method (or trims the basket).
- **Several companies:** the person chooses which company pays; that company's limit, cap,
  offices and invoice apply.
- **A paused employee** cannot order on that company's account.
- **Company-car orders:** entirely on the company; the only limit is the cap. If the cap doesn't
  cover it, the order can't be placed (there is no personal payment).
- **Coupons work as usual**, at the same site prices. The discount reduces both what is taken
  from the limit and what is billed to the company.

### 5) Delivery modes

- The company enables one or both modes in Settings; at least one must stay enabled.
- **The employee (or the manager, for a car order) chooses** the mode per order and can change it
  for a specific parcel.
- **Consolidate to office:** delivery to the office the employee belongs to (or the office the
  manager picks for a car order).
- **Instant:** full shipping, no waiting, to **the home address or the office**, the employee
  chooses.

### 6) Consolidation (batches)

- **A batch = (company office × vendor).** If a vendor has more than one pickup branch, each
  branch is a separate batch, because one parcel has to be collected from one place.
- An order is split into parts by vendor, as today, and each part joins its vendor's batch.
  **The count is in order parts** in the batch (an employee's order and a car order count the
  same).
- The order waits in the batch **before the vendor sees it**. The vendor receives the orders
  after the batch closes.
- **A batch closes** as soon as either of these happens:
  - **The count is reached** (N orders) → it closes at that instant. Any order after that starts a
    new batch.
  - **The time runs out** (T hours from the first order that entered the batch) → it ships with
    whatever it has, even a single order.
- Hours are **calendar hours** (every day, including Fridays and public holidays).
- **Settings:** N and T are a global admin setting, and the admin can **override them for a
  company**.
- **Holding the limit at order time:** the products + **full shipping** (what this order would
  cost to ship on its own). This guarantees the employee can never exceed the limit.
- **Splitting the shipping when the batch closes:**
  - The consolidated parcel's shipping is priced with the normal shipping rules on its whole
    contents.
  - **Base rule: split equally by the number of orders** — even if the batch closed with fewer
    than N (it is split between whoever is in it). Full shipping is charged only when the order is
    alone in the batch.
  - **Exception:** if an equal split would make any order's share larger than its own
    standalone shipping, that whole batch is instead **split in proportion to each order's own
    shipping**: each person pays a share of the consolidated parcel's shipping in proportion to
    what their order would cost to ship on its own. That way each person carries the difference
    their own shipment caused, and nobody pays more than instant.
- **The difference is returned when the batch closes:** (held − actual share) goes back **to the
  limit** and comes off the company's bill. If the order's month has already been invoiced, it
  comes off the next invoice as a credit instead (the old month's limit is not touched).
- **While waiting:** they can **cancel** (the full amount comes back) or **"Ship it now"** (it
  leaves the batch and ships instantly with full shipping to the same address).
- **Rejection or cancellation after the batch has closed** (e.g. the vendor rejects because the
  item is out of stock): the rejected order is refunded, and the others' share would go up — **the
  company absorbs that increase on its invoice** as a "shipping difference" line, without taking
  anything more from anyone's limit. An amount we told the employee had been returned is never
  taken back.
- **Savings:**
  - Per order: (its standalone shipping) − (its actual share).
  - Per company per month: the sum of its orders' savings + the number of parcels saved (order
    parts in batches − number of batches).
  - For the employee at order time: "Save up to X" = full shipping − (full shipping ÷ N).

#### Example (confirmed with the project owner)

Company X, settings: 3 orders or 48 hours.

| Employee | Ordered from |
| --- | --- |
| Ahmed | A and B |
| Sara | A |
| Mona | A and C |

- **Vendor A:** 3 orders → count reached → ships **as one parcel immediately**.
- **Vendor B:** one order → waits 48 hours → ships on its own.
- **Vendor C:** same as B.
- **Result:** 3 parcels instead of 5.

#### Hold and refund example

- An employee has 500 EGP left and orders 200 EGP + a 60 EGP shipping hold = 260. The batch
  closes with 3 and shipping is 60 → their share is 20 → **40 EGP goes back to the limit**. The
  company is billed 220.
- An employee has 100 EGP left and orders 80 + a 60 hold = 140 → more than what is left, so it is
  **refused on the company account**; they place it from their own account.

#### Exception example (the heavy shipment)

Sara orders a filter (60 to ship on its own), and two colleagues order batteries (120 each on
their own), 300 in total if shipped separately. The consolidated parcel costs 250 → an equal split
would be 83 each, more than Sara's 60 → this batch is split in proportion to each person's own
shipping: **Sara 50, each battery 100**.

### 7) Returns and cancellations

- A return or cancellation on a company order **comes off the company's invoice**:
  - **In the same month (before the invoice):** the amount goes back to the employee's limit and
    comes off the invoice.
  - **After the invoice has been issued:** it appears as **a credit on next month's invoice**, and
    the limit is not affected.

### 8) The monthly invoice and collection

- An order goes on **the invoice of the month it was placed in** (the same month as the limit).
- The invoice **is issued on the 1st of the next month** (an hour after midnight) for every order
  placed in the month, whatever its state. An order still waiting in a batch is billed at its full
  shipping; the saving comes off the next invoice when the batch closes.
- Invoice contents: a line per order (the company's share: products + shipping share − discount),
  car orders, credits from earlier months' returns, shipping differences absorbed by the company,
  the total, and a **shipping savings** line.
- **Payment terms and the overdue grace period:** set by the admin per company; the default is
  **15 days** from the invoice date, and 7 grace days.
- **Payment method:** bank transfer. The admin records it (amount, date, reference number,
  receipt). The company can upload a photo of the receipt from its portal and the admin confirms.
  **Partial payments are allowed**, and the invoice shows the outstanding amount.
- **Late payment:** a reminder before the due date and on the day → after **a grace period set by
  the admin** without payment, **ordering on the company account is paused** until the overdue
  amount is paid. Employees can still order with their own money.
- **The admin can suspend any company manually** at any time.
- **Suspension (for any reason) only blocks new orders** — waiting batches continue and are
  billed.
- The invoice is a **statement / demand for payment**, not an electronic tax invoice.

### 9) Ledgers and reporting

**For the company**
- The company sees **company-paid orders only, in full detail**: who (employee or car), what, how
  much, when, the mode, and shipping before and after consolidation. Orders the employee paid for
  entirely themselves **never appear**.
- A per-employee summary: spend this month, what's left, number of orders.
- Spend per company car.
- Export: **Excel for the ledger** (with a per-employee totals sheet for payroll deductions) and
  **PDF for the invoice**.

**For the admin** (per company and across all companies, month by month):
- **Money:** invoiced, paid, outstanding, overdue and for how long, cap usage.
- **Activity:** number of orders, total sales, average order value, active employees out of those
  registered, limit usage.
- **Shipping:** share of orders delivered to the office, batches closed on count vs on time,
  parcels saved, savings in EGP for companies, and shipping subsidy saved for ReadyCar. **These
  are the numbers you tune N and T with.**
- **Vendors and products** most ordered per company.
- The same exports: Excel and PDF.

### 10) Notifications

| To | When | Where |
| --- | --- | --- |
| Invitee | The invitation, and a reminder on resend | Email or WhatsApp, depending on the contact |
| Employee | Joined; batch closed (+ the amount returned); parcel shipped; parcel reached the office; order rejected or cancelled; limit renewed on the 1st; paused / resumed; removed from the company | In-site + email |
| Manager | Invoice issued; reminder before the due date and on the day; overdue and suspension; payment recorded; 80% of the cap and cap used up; contract ended; refund transferred | In the portal + email |
| Admin | A company uploaded a transfer receipt; an invoice is overdue | In the admin dashboard |

### Status transitions

- **Invitation:** sent → accepted / declined / expired (14 days) / cancelled (by the manager).
  Resending an expired invitation starts a new 14 days.
- **Employee:** invited → active ⇄ paused → removed. Every change (limit, group, office, pause,
  resume) is recorded with who and when.
- **Company:** active ⇄ suspended (overdue or manual). A suspension caused by late payment lifts
  once the overdue amount is paid. Either → contract ended (by the admin, final).
- **Batch:** open → closed on count / closed on time → (the normal order flow).
- **Order in consolidate mode:** waiting in batch → sent to vendor / cancelled / switched to
  instant.
- **Invoice:** month open → issued (on the 1st) → partially paid → paid. Past the due date:
  overdue.

### Validations

- Contact: a valid email or a valid Egyptian mobile number.
- No invitation to someone already a member, or who has a live invitation from the same company.
- Limits and the cap are positive numbers. An override can be zero (meaning the employee is
  blocked from ordering).
- A car's plate number is unique within the company.
- At least one office, at least one enabled mode, and at least one manager.
- The limit and the cap are checked **at the moment the order is confirmed**, not when the
  checkout page opens.

### Concurrent / conflicting actions

- **Two people complete the count at the same instant:** the batch closes with the first N, and
  anyone after them starts a new batch; the confirmation page makes this clear.
- **The employee cancels at the instant the batch closes:** if the batch hasn't closed yet, it is
  a normal cancellation. If it has, the "cancellation after closing" rule applies (the company
  absorbs the shipping difference for the others) together with the normal cancellation rules.
- **The manager changes the limit while the employee is on the checkout page:** the new limit is
  what applies at confirmation.
- **Two managers edit the same employee:** last save wins.

---

## Edge Cases

- **Rare or invalid operations:**
  - An invitation sent to a number registered to someone else's account → they must accept with
    the account that owns the number.
  - An employee in a batch is removed by the company → the order continues and is billed to the
    company.
  - An order placed on the 30th in a batch that closes on the 2nd → it goes on the invoice of the
    month it was placed in at full shipping (issued on the 1st), and its saving comes off the
    next invoice.
  - A batch containing orders from two months → each order goes on its own month's invoice.
  - A batch containing car orders only → normal.
  - A vendor with several branches → each branch is its own batch.
- **Abuse scenarios:**
  - An employee places several small orders from the same vendor to fill the count alone → no
    loss: it's one parcel and they pay all the shares.
  - An invitation link forwarded to someone else → acceptance requires the account that owns the
    contact.
  - An employee returns items to get cash → the money goes back to the company invoice and the
    limit, not as cash.
  - A manager ordering large amounts for cars → the monthly cap protects us.
- **Data-consistency risks:**
  - Held vs actual: the cap and the limit must count amounts held in waiting batches, and release
    the difference the moment a batch closes.
  - A batch saving that arrives after its month's invoice must come off the next invoice — never
    edit an issued invoice.
  - The shipping difference absorbed by the company (rejection after closing) must appear as its
    own line on the invoice.
  - A return after the invoice → a credit next month, not an edit to an issued invoice.
- **Permission conflicts:**
  - A manager who is also an employee → the ledger separates their personal spend from car spend.
  - A removed manager with open car orders → they continue.
  - An employee moved to another office with an order in a batch → the order continues to the old
    office.

---

## Out of Scope

- **Sorting the parcel inside the company** once it reaches the office — the company's job.
  (Packing at the vendor is decided: each employee separately with a label bearing their name,
  all of them in one parcel.)
- **Electronic tax invoicing** (the Egyptian Tax Authority system). The invoice here is a
  statement only.
- Paying the invoice online by card from the company portal.
- Manager approval of orders.

---

## Decision Log

### The employee chooses the mode, not the company
- **Decision:** The company enables the available modes, and the employee chooses per order.
- **Reason:** The money comes out of the employee's limit, so they are the one motivated to save.
- **Alternatives considered:** The company imposes one mode on everyone.
- **Impact:** The checkout page must explain both modes in numbers — it is the most important
  screen of the feature.

### Hold full shipping and return the difference
- **Decision:** At order time we hold the products + the order's standalone shipping, and the
  difference comes back when the batch closes.
- **Reason:** The employee can never exceed the limit whatever happens in the batch, and the
  amount that comes back is a pleasant surprise.
- **Alternatives considered:** Hold only the expected share — exceeds the limit if nobody joins.
- **Impact:** The cap and the limit count held amounts. A saving that arrives after the month's invoice comes off the next one.

### Split shipping equally, unless it's unfair to someone
- **Decision:** The base is an equal split by number of orders (even for a short batch). If an
  equal split would make any order pay more than its standalone shipping, that batch is split in
  proportion to each order's own shipping.
- **Reason:** Equal is the easiest to explain. The exception keeps the promise "you'll never pay
  more than instant", and each person carries the difference their own shipment caused (the
  project owner's decision).
- **Alternatives considered:** Always by weight, by order value, or the company/ReadyCar absorbs
  the excess.
- **Impact:** "Save up to X" at order time is an estimate; the final figure comes when the batch
  closes.

### Rejection after closing is on the company
- **Decision:** The increase in the others' shipping caused by a rejection or cancellation after
  closing is absorbed by the company on its invoice.
- **Reason:** An amount the employee was told had been returned is never taken back — the
  employee's trust in the mode matters more.
- **Alternatives considered:** ReadyCar absorbs it, or it is deducted from the others.
- **Impact:** A "shipping difference" line on the invoice.

### Returned difference: wallet first, then the limit _(superseded 29 Sep 2026)_
- **Superseded by "The company pays a whole order or none of it"** — a company order has no
  personal part any more, so the whole difference goes back to the limit.
- **Decision (original):** Whatever the employee paid out of pocket comes back to their ReadyCar wallet
  first, and the rest to the limit.
- **Reason:** Their money comes back to them, with no refund fees on the card.
- **Alternatives considered:** Always to the limit (the company benefits from the employee's
  money), or back to the card.
- **Impact:** Depends on the wallet (see Open Questions).

### Invoice by order month, issued after batches close _(superseded 29 Sep 2026)_
- **Superseded by "The invoice on the 1st of the month"** below.
- **Decision (original):** An order goes on the invoice of the month it was placed, and the invoice waits
  for the month's last batch.
- **Reason:** Same cycle as the limit, and the invoice is issued with final figures, no
  adjustments.
- **Alternatives considered:** Month of delivery, or an invoice on the 1st with adjustments next
  month.
- **Impact:** The invoice is issued at most the waiting time after the 1st.

### A monthly company cap set by the admin
- **Decision:** The admin sets a cap per company, covering employees, cars and held amounts.
- **Reason:** We collect at month end, meaning we extend credit to the company; the cap protects
  us.
- **Alternatives considered:** The limits are enough.
- **Impact:** A "Company cap used up" message on the checkout page.

### Global consolidation settings + per-company override
- **Decision:** N and T are global, and the admin can change them for a company.
- **Reason:** A company with 500 employees is not the same as one with 20.
- **Alternatives considered:** One value for everyone, or per-vendor overrides as well.
- **Impact:** A global settings page + a field in each company's settings.

### Calendar hours
- **Decision:** Waiting hours count every day.
- **Reason:** Easy to explain: "Ships Sunday at 3 PM at the latest".
- **Alternatives considered:** Working hours only.
- **Impact:** Fridays and holidays reduce the chance of consolidating — watch it in the
  statistics.

### Suspension doesn't cancel waiting batches
- **Decision:** Suspension blocks new orders only.
- **Reason:** The employee isn't at fault.
- **Alternatives considered:** Cancel waiting batches.
- **Impact:** A suspended company can accrue more debt, but only up to the value of its waiting
  batches.

### The manager orders for company cars
- **Decision:** (added during planning) The manager orders parts for the registered company cars,
  against the cap only, with the same two modes, and these orders join batches and count toward
  them.
- **Reason:** The company buys for its fleet from the same place and on the same invoice, and more
  orders in batches means faster consolidation.
- **Alternatives considered:** A free-text note instead of registering cars, a separate car
  budget, or car orders always instant.
- **Impact:** A "Company cars" page, and a "Who is this order for?" choice on the manager's
  checkout.

### The company sees company-paid orders only
- **Decision:** In full detail (who, what, how much, when); personal purchases are never shown.
- **Reason:** The company needs to know who took what for salary deductions, and the employee
  needs reassurance about their privacy.
- **Alternatives considered:** Totals without products.
- **Impact:** The privacy note on the acceptance page.

### Colleague names are never shown
- **Decision:** The employee sees how many are waiting, not who.
- **Reason:** We don't reveal who ordered what.
- **Alternatives considered:** Show names (more motivating).
- **Impact:** The "Tell your colleagues" button makes up for the motivation.

---

### An employee can leave the company themselves _(superseded 29 Sep 2026)_
- **Superseded by "The manager pauses an employee who left"** below.
- **Decision (original):** A "Leave the company account" button in the "My company" tab, with the same rules as removal: open orders continue and are billed to the company, and the managers are told. The last manager cannot leave.
- **Reason:** Someone invited by a new company is not stuck waiting for an old one that no longer answers.
- **Alternatives considered:** Only a manager can remove them.
- **Impact:** A button in "My company" and a notification to the managers.

### Loyalty points on the whole order
- **Decision:** The employee earns loyalty points on the whole company order, not only the personal part.
- **Reason:** It encourages employees to use their limit — the core goal of the feature.
- **Alternatives considered:** Only on the personal part, or no points at all.
- **Impact:** ReadyCar rewards money the company paid. Built in phase 2.

### Loyalty points can pay part of a company order
- **Decision:** The employee may redeem their points on an order on the company account; the discount lowers the total, so it saves their limit and the company's bill.
- **Reason:** The employee stretches their limit with their points — one more reason to order.
- **Alternatives considered:** Points on personal orders only.
- **Impact:** The company's share is worked out after the points discount.

### Partial refunds split in proportion _(superseded 29 Sep 2026)_
- **Superseded by "The company pays a whole order or none of it"** — there is nothing to split.
- **Decision (original):** If the company covered 80% of an order and the employee 20%, any return or parcel cancellation splits the same way: 80% comes off the company's invoice and back to the limit (in the order's month), 20% to the employee's wallet.
- **Reason:** Fair, clear, and computed automatically.
- **Alternatives considered:** The employee's money first, or the company's first.
- **Impact:** The same rule applies when an admin reinstates a cancelled parcel: the company is charged its share again, and the wallet only the personal part.

### The invoice on the 1st of the month (29 Sep 2026)
- **Decision:** The statement is issued on the 1st for every order **placed** in the month before,
  whatever its state. An order still in a batch is billed at full shipping, and the batch's saving
  comes off the next invoice.
- **Reason:** A fixed, predictable date for the company (the project owner's decision; "closed"
  means placed).
- **Alternatives considered:** Wait for the month's batches to close (a later, moving date).
- **Impact:** A "consolidation saving — earlier month" line on invoices.

### The company pays a whole order or none of it (29 Sep 2026)
- **Decision:** An order above what is left of the limit (or the cap) is refused on the company
  account; the employee places it from their own account.
- **Reason:** Less complication (the project owner's words): no split payments, no wallet or card
  top-ups, no proportional refunds.
- **Alternatives considered:** The company covers what is left and the employee pays the difference
  online (the phase-2 design).
- **Impact:** A clear message at checkout; refunds and savings go back to the limit only.

### The manager pauses an employee who left (29 Sep 2026)
- **Decision:** A reversible "Pause ordering" for the manager (per row or in bulk); the employee's
  own "leave" button is removed.
- **Reason:** The company is the one that knows someone left, and pausing keeps their history and
  settings in case they come back.
- **Alternatives considered:** Remove only; let the employee leave by themselves.
- **Impact:** A "Paused" status, notifications to the employee, and the reason at checkout.

### Change history per employee (29 Sep 2026)
- **Decision:** Record who changed an employee's limit, group or office (from → to), who paused or
  resumed them, and when; shown to the company's managers and the admin.
- **Reason:** Settles disputes ("who lowered my limit?").
- **Alternatives considered:** No history.
- **Impact:** A "History" button on each employee.

### One person, several companies (29 Sep 2026)
- **Decision:** A person may be in several companies and picks which pays at checkout; a manager of
  several switches between them in the portal.
- **Reason:** Real life — people work for more than one employer.
- **Alternatives considered:** One company at a time (the original rule).
- **Impact:** A company picker at checkout and in the portal; each company keeps its own limit,
  ledger and invoice.

### Loyalty points to the person who ordered (confirmed 29 Sep 2026)
- **Decision:** Points go to whoever placed the order — personal orders and company orders alike.
- **Impact:** None — already built that way.

### Ending a contract: final invoice at once, credit against debt, the rest refunded (29 Sep 2026)
- **Decision:** The admin ends the contract; the final invoice is issued immediately. Afterwards,
  returns and batch savings are set first against unpaid invoices and the remainder is transferred
  back to the company by the admin, who records it.
- **Reason:** The company settles and leaves without waiting for the month to end, and money owed
  either way is closed off cleanly.
- **Alternatives considered:** The final invoice on the normal 1st; keeping the credit on file.
- **Impact:** An "End contract" action, a settlement card and "Record a refund" on the admin's
  company page, and "final" / "after the end" labels on invoices.

### Cap alert at 80% and when used up (29 Sep 2026)
- **Decision:** Two alerts a month at most, to the managers; the admin list shows the same colours.
- **Alternatives considered:** 80% only; a share each manager chooses; no alert.

### Company cars in "Fits my car" (29 Sep 2026)
- **Decision:** Company cars are picked from the make/model/year list and appear next to the garage
  for their managers; checkout picks the car they were shopping for.
- **Alternatives considered:** A warning at checkout only; nothing.

### A dearer combined parcel is not combined (29 Sep 2026)
- **Decision:** When shipping them together would cost more than separately, each order ships on
  its own at its own shipping.
- **Alternatives considered:** ReadyCar absorbs the difference; the company absorbs it.

## Open Questions

- [x] **Wallet switched off:** no longer applies — since 29 Sep 2026 a company order has no
  personal part, so nothing from it is returned to the wallet.
- [x] **Starting values:** decided — **3 orders or 48 hours**, and a 7-day overdue grace period.
- [x] **Batch deadline when the first order is cancelled:** decided — **it does not change**; the
  time that was given is a promise.
- [x] **Changing N or T while batches are open:** decided — **applies to new batches only**.
- [x] **Consolidated parcel costs more than the separate parcels combined:** decided — **the batch is
  not combined**; each order ships on its own at the shipping it was charged.
- [x] **Loyalty points:** decided — **on the whole order** (see the Decision Log).
- [x] **Employee leaving the company on their own:** decided — **no; the manager pauses them** (see the Decision Log, 29 Sep 2026).
- [x] **Editing or deleting an office with waiting batches:** decided — **editing is allowed** (it applies to batches not yet shipped), **deleting is blocked** until its batches close.
- [x] **Ending a contract with a company:** decided — **final invoice at once**; later returns and
  savings are set against what is unpaid and **the rest is transferred back** (see the Decision Log).
- [x] **The vendor's experience with a consolidated parcel:** decided — **a batch is one parcel
  holding separate orders**, one per employee, with the packing alert and a button that prints a
  label per employee (name, order number, company, office).
- [x] **Change history:** decided — **yes**: limit, group, office, pause and resume, with who and
  when (see the Decision Log).
- [x] **Cap alert:** decided — **at 80% and when used up**, to the managers (portal + email).
- [x] **Filtering parts by company car:** decided — **company cars appear like "My garage"** in the
  shop's car pickers, and checkout picks the car.
- [ ] **Admin notifications (system-wide):** messages "to the admin" are not shown on any admin
  screen today. Build an admin notification bell?
