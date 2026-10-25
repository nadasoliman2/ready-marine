# Deploying feature 9 — Sub-orders (per-vendor order splitting)

Hand this file to whoever (or whatever) runs the production deploy.

---

## Prompt

> You are deploying a change to ReadyCar, a multivendor car-parts store (Node/Express +
> MongoDB backend in `Backend/`, Next.js frontend in `frontend/`). Read this whole brief
> before running anything.
>
> ### What the change does
>
> An order used to be one indivisible unit: one status, one dispatch gate, one completion
> event. That did not match reality — a basket bought from three stores becomes three
> physical parcels, collected by Bosta from three different pickup branches, arriving on
> three different days. Because there was only one status, **one slow vendor froze
> everybody**: nothing could be sent to Bosta until every vendor had reviewed their items, a
> vendor whose parcel was delivered on Monday was not paid until the last vendor arrived on
> Friday, and a customer holding goods in their hands saw "Picked up from business".
>
> Every order is now split into **sub-orders (parcels) — one per (vendor, pickup branch)**.
> The order stays a single financial entity: one price, one payment, one coupon, one
> loyalty snapshot, one shipping total at checkout. Fulfilment, status, money release and
> returns all moved down to the parcel.
>
> The full requirements document is `feature-planner/9-sub-orders.md`. Read it if any
> decision below seems arbitrary — every one of them is explained there.
>
> ### Your job, in order
>
> **1. Take a database backup.** The migration writes to `orders`, `vendorearnings`,
> `returnrequests` and `refunds`, and drops an index. Do not skip this.
>
> **2. Deploy the code first, then migrate.** In that order, and not the reverse: the
> migration script imports the new Order model, so the code has to be on disk. Orders that
> have not been migrated yet keep working on legacy fallback paths that were written for
> exactly this window, so a gap between the two steps is safe.
>
> **3. Run the migration as a dry run and READ THE OUTPUT.**
>
> ```bash
> cd Backend
> node scripts/migrateOrdersToSubOrders.js
> ```
>
> It writes nothing and reports what it would do. Two lines in that output need a human:
>
> - **"found the legacy UNIQUE index"** — expected, and it must be dropped. Earnings moved
>   from one row per (order, vendor) to one row per (order, parcel). Mongoose only ever
>   creates indexes, never drops ones a schema stopped declaring, and this project calls no
>   `syncIndexes()` — so the old unique constraint survives the deploy and forbids the one
>   thing the split exists to allow: a vendor shipping two parcels from two branches of one
>   order. Left in place, the second parcel's earnings fail with E11000 and **that vendor is
>   silently never paid for it**. The `--apply` run drops it.
>
> - **"NOTE: N dispatched order(s) had a COD at Bosta that differs from the correct split"**
>   — this is a pre-existing defect being surfaced, not one the migration causes. The old
>   code sent Bosta only the vendor's merchandise as the cash-on-delivery amount: no
>   shipping, no coupon deduction, no loyalty deduction. So on cash orders the store never
>   collected shipping, and customers were charged the value of coupons they had been
>   granted. **These historical orders are NOT corrected** — Bosta exposes no API to restate
>   a live delivery's COD. Report the number to the business owner; it is theirs to decide
>   whether to chase. All NEW orders are correct.
>
> **4. Apply the migration.**
>
> ```bash
> node scripts/migrateOrdersToSubOrders.js --apply
> ```
>
> It is idempotent — an order that already has parcels is skipped, so a re-run after a
> partial failure resumes safely. It exits non-zero if any order failed; if that happens,
> read the `FAILED <id>` lines, fix, and re-run.
>
> **5. Switch shipping to per-parcel pricing — but show the numbers first.**
>
> ```bash
> node scripts/setSplitShippingMode.js            # prints the price impact, writes nothing
> ```
>
> Shipping has two modes. `combined` prices the whole basket once and apportions that figure
> across the parcels. `split` prices each parcel on its own leg and sums them. The store
> owner has asked for `split`, because three parcels are three real deliveries that Bosta
> bills for — under `combined` the store absorbs two of them.
>
> **This raises prices for customers on multi-vendor orders.** The method's `base_cost`,
> `min_fee` and `max_fee` apply per parcel, so a three-vendor basket pays roughly three
> times what it did. The dry run prints the exact before/after for the live methods.
> **Show that table to the store owner and get a yes before applying.** Then:
>
> ```bash
> node scripts/setSplitShippingMode.js --apply
> ```
>
> Existing orders are unaffected — each carries a frozen shipping snapshot and is never
> re-quoted. Restart the API afterwards so its in-process quote cache clears.
>
> **6. Restart the API.** A new hourly cron (`runSubOrderDeadlineSweep`) is registered in
> `app.js` and only starts on boot. It reminds vendors before their deadline and flags late
> parcels for the admin queue; it never cancels anything.
>
> ### Verify, in this order
>
> 1. **Checkout, multi-vendor basket, cash.** The summary must state "Your order arrives as
>    N separate parcels", show an expandable shipping breakdown, and list what each courier
>    will collect. **Those per-courier amounts must add up to the order total exactly** — that
>    is the single invariant this whole feature promises. A single-vendor basket must show
>    none of it.
> 2. **Vendor dashboard → Parcels.** Tabs named for the action, landing on the first one
>    with work in it. Open a parcel: a three-stage progress bar, availability buttons that
>    save on press, and a decline that demands a reason.
> 3. **Confirm availability on one vendor's parcel only.** It must go to Bosta on its own,
>    while another vendor on the same order is still reviewing. That is the whole point — if
>    it refuses, stop and report.
> 4. **Admin → Parcels Needing You.** The queue of declines, late vendors, delivery
>    exceptions and cancellation requests, each with the customer's phone number on it.
> 5. **Admin → Pickups.** Ready parcels listed with the vendor's photos, reviewable before
>    the courier is booked.
> 6. **A customer order with parcels in different states** must show the counter
>    ("1 of 3 delivered"), never a single misleading word.
>
> ### Do not
>
> - **Do not re-run the migration with `--apply` expecting it to fix amounts on already
>   migrated orders.** It skips them by design. Money on a dispatched order is frozen
>   deliberately: Bosta cannot restate a COD, and those figures were shown to the customer
>   before they paid.
> - **Do not flip shipping to `split` without the owner's sign-off.** It is a customer-facing
>   price rise, not a technical toggle.
> - **Do not try to "fix" the historical COD mismatches.** There is no API for it.
> - **Do not skip the index drop.** It fails silently and costs vendors money.
>
> ### If something looks wrong
>
> - Vendor earnings missing on a two-branch order → the legacy index was not dropped. The
>   server logs say so explicitly. Re-run the migration with `--apply`.
> - A vendor cannot scan a Smart Label on the second parcel of an order → check the order's
>   status is one of the values in `PRE_DISPATCH_ORDER_STATUSES` in
>   `Backend/services/smartLabelService.js`.
> - Shipping totals unchanged after step 5 → the API was not restarted, or the settings row
>   still says `combined`. Re-run the script's dry run to see the stored value.

---

## One-paragraph version, if the agent only reads one thing

> Deploy the code, back up the database, then run
> `node Backend/scripts/migrateOrdersToSubOrders.js` (dry run) and read its output — it will
> report a legacy unique index that MUST be dropped (otherwise vendors shipping from two
> branches are silently never paid) and a count of historical orders whose cash-on-delivery
> amount at Bosta is wrong from a pre-existing bug that cannot be corrected. Then run it
> with `--apply`. Then run `node Backend/scripts/setSplitShippingMode.js`, show the printed
> price table to the store owner, and only apply it with their approval — it raises shipping
> prices on multi-vendor orders. Restart the API. Verify that on a multi-vendor cash
> checkout, the per-courier amounts add up to the order total exactly.
