# Arrive Shipping — Integration Plan (courier switch + adapter)

> Status 2026-09-14: API credentials received and **verified** (`getAllSectors` returns 522 sectors
> with both JSON and form bodies; `getCurrentStatus` answers `[]` for an unknown waybill).
> Credentials live in `Backend/.env` (`ARRIVE_API_USER`, `ARRIVE_API_PASSWORD`,
> `ARRIVE_WEBHOOK_SECRET`, `ARRIVE_BASE_URL`) and nowhere else.
> Background research: `Backend/docs/ARRIVE_INTEGRATION.md`, open questions:
> `feature-planner/12-arrive-shipping-questions.md`. Nothing from either is implemented yet —
> there is no `services/couriers/` directory and every fulfilment path calls `bostaService` directly.

## 1. Goal

Ready Car ships with Bosta today. Add Arrive as a second courier so that:

- the admin picks a **default courier** in Shipping Settings, and
- the admin can **override the courier per parcel** before it is dispatched, and
- every parcel already in flight **keeps the courier it was created with** (the provider is
  stamped on the shipment row, exactly like `services/paymentGateway.js` stamps `provider`
  on a payment), and
- nothing about Bosta parcels changes.

Tala (Accurate) was researched too; the adapter shape below leaves room for it but it is out of scope.

## 2. What Arrive gives us and what it does not

| Capability | Bosta | Arrive | Consequence in our system |
|---|---|---|---|
| Create shipment | API | API (`addShipment`, bulk ≤1000) | adapter `createShipment` |
| Tracking push | webhook (with event time) | webhook (`status_id`, **no event time**) | ordering guard by status rank, not time |
| Tracking pull | per delivery | `getCurrentStatus` ≤50 waybills / request, **name only** | sweep in batches, map by Arabic name |
| Status detail | — | `statusHistory` per waybill (has `date_created`, `reason`) | fetched on exception only |
| Cancel | API | **none** (manual request in portal, charged full delivery fee) | cancel marks parcel "cancel at Arrive by hand" |
| Pickup booking | API + slots | **none** (creation itself is status 1 "pickup request") | Pickups screen hidden for Arrive parcels |
| Sender per shipment | pickup locations | **none** (one account address: Loran, Alexandria) | see Q1 — biggest open decision |
| Waybill PDF | API | **none** (`waybill` + `qr_code` returned) | we render our own label |
| Pricing API | yes | **none** — tariff captured in `docs/arrive-tariff.json` (17 groups) | frozen tariff file, same as `bostaTariff.js` |
| Destination | city (28) | **sector** (district, 522) or free-text `keyword` | sector picker at dispatch (phase 1), at checkout (phase 2) |
| Dedupe | `uniqueBusinessReference` | unknown (`order_id` is free text) | "uncertain dispatch" guard, never blind retry |
| Rate limit | — | 50 requests / minute | in-process token bucket shared by all Arrive calls |

## 3. Architecture

### 3.1 Settings and choice

- `ShippingSettings.courier_provider: "bosta" | "arrive"` (default `bosta`). Shown as a radio
  "Default courier" at the top of `admin/dashboard/shipping/settings`, with a per-courier
  status line (credentials present, webhook URL to give the courier, last sector sync).
- `sub_orders[].courier: "bosta" | "arrive" | null`. `null` means "use the default at
  dispatch time". Set by the admin from the parcel card (dropdown, visible until the parcel
  has a tracking number). The Send confirm names the courier that will be used.
- `sub_orders[].courier_sector_id` (Arrive only) chosen or auto-suggested at dispatch.
- Resolution rule, one function: `courierFor(sub, settings) = sub.courier || settings.courier_provider`.
  Used by the vendor-driven dispatch (`confirmItems`, `assignTracking`), the admin single-parcel
  Send, and the bulk "ready" action.
- Once a shipment exists, `shipments[].provider` is the only source of truth for that parcel.
  Webhooks, sweeps, labels, costs and cancels read it from the row, never from settings.

### 3.2 Adapter layer `Backend/services/couriers/`

```
index.js        courierFor(), get(provider) → adapter, PROVIDERS, capabilities lookup
bosta.js        thin wrapper around the existing bostaService / bostaStatusMap (no behaviour change)
arrive/
  client.js     HTTP client: base URL, user/password in body, retry on 5xx/timeout, 50/min bucket
  adapter.js    createShipment, track(waybills[]), statusHistory(waybill), capabilities
  statusMap.js  status_id → parcel status; Arabic name → status_id (for getCurrentStatus)
  tariff.js     docs/arrive-tariff.json + sector→group lookup, weight surcharge
  label.js      HTML label (waybill Code128 + qr_code QR + sender/receiver/COD/ref)
```

Every adapter exposes the same surface:

```
capabilities   { cancelApi, pickupApi, labelApi, perParcelSender, smartLabel, needsSector }
createShipment(order, sub, ctx) → { provider_shipment_id, tracking_number, extra }
cancelShipment(shipment)        → throws NOT_SUPPORTED for Arrive
track(shipments[])              → [{ shipment, raw_state, mapped_status, event_at|null }]
label(shipment)                 → { type: 'pdf', buffer } | { type: 'html', html }
cost(order, sub, shipment)      → { send, extra_cod, rto, priced, group }
```

`capabilities` drives the UI: no "Book pickup", "Cancel at courier" or "Download AWB" button is
rendered for a courier that cannot do it, instead a plain instruction is shown.

### 3.3 Document changes (additive, no migration)

`shipments[]` gains: `provider` (default `"bosta"` for existing rows via schema default),
`tracking_number`, `provider_shipment_id`, `provider_status`, `provider_payload` (qr_code etc.).
The existing `bosta_*` fields stay and keep being written for Bosta shipments. The parcel views
(`toPublicSubOrder`, vendor and customer) expose generic `courier`, `tracking_number`,
`tracking_url`; the frontends switch to those with a fallback to `bosta_tracking_number`.

`sub_orders[]` gains `courier`, `courier_sector_id`, `dispatch_attempt` (see 3.6).
`shipments[].courier_cost` gains `provider` and `group` (Arrive pricing group name).

New collection `arrive_sectors` (`id`, `name`, `gov_name`, `key_words`, `synced_at`), seeded from
the live API (`getAllSectors`) by a script and an admin "Resync sectors" button; the JSON dump is
the fallback only. Includes the 9 "unserved" sectors flagged `serviceable: false`.

### 3.4 Creating an Arrive shipment (field mapping)

| Arrive field | From |
|---|---|
| `sector_id` | `sub.courier_sector_id`; if absent, suggestion from city → group + address keywords; if still absent send `keyword` = Arabic city name and flag the parcel "sector guessed" |
| `phone_1` / `phone_2` | recipient phone normalised to 11 digits (`+20` stripped, leading 0 restored) |
| `service_type` | `1` (deliver + collect); returns use `3` (phase 2) |
| `price` | cash orders: `round(sub.cod_amount)` (Arrive takes an int); prepaid: `0` (**Q3**) |
| `address` | `order.shipping_address.full_address` + city |
| `client_name` | recipient name |
| `product_name` | first item title, truncated 250 |
| `product_desc` | all items "qty × title" |
| `quantity` | item count |
| `weight` | Σ item weights, default weight for products without one (setting) — "N kg" |
| `notes` | `Order REF-x-1 · Vendor: <store> · Pickup: <branch address>` — the only place the vendor branch can be stated (**Q1**) |
| `order_id` | `<order_id>-<sub_id>[-rN]` — same reference family as Bosta, reactivation-safe |
| `email` | flyer / smart label number if one is scanned (**Q4**) |
| `client_id` | omitted |

Response: `waybill` → `tracking_number`, `id` → `provider_shipment_id`, `qr_code` kept in
`provider_payload`. Public tracking link: `https://arrive-shipping.com/track.php?waybill=<waybill>`.

### 3.5 Status mapping (webhook `status_id` and `getCurrentStatus` names)

| Arrive | Parcel status |
|---|---|
| 1, 330 | `pickup_scheduled` |
| 2, 16 | `picked_up` |
| 3, 125, 600, 24, 39, 26, 450, 34 | `in_transit` |
| 4, 45, 46, 47 | `out_for_delivery` |
| 5, 33 | `delivered` |
| 18 (partial delivery) | `delivered` + admin attention flag |
| 6, 900, 1200, 13, 19, 20, 25, 1100, 1150, 100, 110, 120, 43, 220, 150 | `exception` (reason from `statusHistory`) |
| 7, 27, 28, 31, 135 (return in progress) | `exception` with "returning to sender" note |
| 14, 8, 105 (custody back with shipper) | `returned` (final) |
| 800, 1250 (cancelled at Arrive) | `exception` + attention "Arrive cancelled this — cancel the parcel here to refund". Never auto-refunds. |
| 17, 22, 21 (exchange / partial return) | `exception` + attention |
| 29, 30, 700, 1500 | informational: history line only, status unchanged |

Ordering guard: a webhook carries no time, so a status may only move a parcel **forward** in
`FORWARD_ORDER` or into a terminal/exception state; `delivered` and `returned` are never
overwritten by a later "in transit". Webhook route: `POST /api/webhooks/arrive/:secret`
(same secret-in-path pattern as Bosta). Sweep: every 20 minutes, all live Arrive shipments,
`getCurrentStatus` in chunks of 50, at most 40 calls per minute.

### 3.6 Idempotency without a dedupe field

Before calling `addShipment`, stamp `sub.dispatch_attempt = { provider, reference, at }` and
save. On success clear it. If the call times out or the process dies, the next dispatch
attempt sees the stamp and **refuses**: the admin gets "A shipment may already exist at Arrive
for reference X — check the portal, then either enter the waybill or clear the attempt".
Bosta keeps its `uniqueBusinessReference` behaviour.

### 3.7 Cancellation and reactivation

- Cancel of an Arrive parcel: no API, so `cancelSubOrder` records `stranded_tracking`
  and the parcel history says "request cancellation of waybill W in the Arrive portal".
  The admin attention queue lists it until an admin ticks "done at Arrive".
- Cancellation is charged the full delivery fee once the parcel is with Arrive, so the
  customer/vendor cancel window for Arrive parcels closes **at dispatch**, not at pickup
  booking (**Q5**).
- Reactivation already retires the old shipment row (`superseded_at`) and creates a new
  delivery with a `-rN` reference; that works unchanged for Arrive.

### 3.8 Labels

We render an HTML/PDF label ourselves (10×15): Code128 barcode of the waybill, QR of
`qr_code`, sender (vendor branch name, phone, address), receiver, COD amount, order
reference, item count, Arrive logo text. Vendor stage ② "Download the waybill" serves it
for Arrive parcels. Needs Arrive's OK that drivers accept it (**Q4**).
Libraries: `bwip-js` (barcode) and `qrcode` on the backend, both small, no native deps.

### 3.9 Cost

`courierCostService` becomes provider-aware: Bosta path unchanged; Arrive path reads
`arrive/tariff.js` (group by sector → delivery fee, +5 EGP/kg over 2 kg, VAT assumption to
confirm), `rto` = 20 on return (**Q8** — refuse fee vs 20 is unconfirmed, so `priced:false`
on RTO until confirmed). Finance reports get a courier column.

### 3.10 Pickup

No API. Parcels dispatched to Arrive skip the Pickups screen; the admin dashboard shows
"Arrive parcels awaiting pickup" grouped by vendor branch with the day's count, so a
manual portal request can be raised if Arrive requires one (**Q2**).

## 4. Delivery phases

**Phase 0 — foundation (no customer impact)**
env + settings switch + `sub.courier` override + adapter skeleton with Bosta wrapped +
`arrive_sectors` sync + admin UI (default courier, per-parcel dropdown, sector picker).
Everything still dispatches to Bosta unless a parcel is explicitly set to Arrive.

**Phase 1 — Arrive live**
createShipment + label + webhook + sweep + cost + cancel/attention handling + vendor and
customer views showing courier and tracking link. Ends with **one real test shipment** to the
Ready Car office (costs one delivery fee) that you confirm before the switch is offered.

**Phase 2 — polish**
district (sector) capture at checkout, returns via `service_type 3`, bulk create for the
"ready" action, automatic fallback to Bosta for unserved sectors.

Each phase: DB dump + code tarball first, isolated run against a restored DB copy with the
Arrive HTTP client stubbed (same harness as the reactivation work), then rebuild containers.

## 5. Open questions (answers change the build)

Blocking for Phase 1:

1. **Sender / pickup for a multi-vendor marketplace.** Arrive's PDF has no per-shipment
   sender and the account has one pickup address (Loran, Alexandria). Does Arrive collect
   from each vendor's branch, or do vendors deliver to the Ready Car office first? The second
   option means a new "handed to Ready Car" step for vendors.

   **Update 2026-09-14:** their portal's own add-shipment form DOES carry four "الراسل الفرعى"
   (sub-sender) fields — `sender_name`, `sender_phone`, `sender_address`, `sender_sector` —
   and the shipments list has a "منطقة الراسل الفرعى" column, which was empty on our first
   real parcel (ARV48671) because we were only writing the sender into `notes`. We now send
   all four on every create, resolving the vendor branch to an Arrive sector the same way the
   destination is resolved (a low-confidence match is omitted rather than guessed).
   **Still to confirm with Arrive:** does their *API* honour those field names, or only the
   portal form? Verify by checking that the "منطقة الراسل الفرعى" column is filled on the next
   parcel; if it stays empty, ask them to enable the fields on the API.
2. **Is creating the shipment the pickup request?** New shipments start at status 1
   "pickup request". Is a separate portal request needed, and what is the daily cut-off?
3. **Prepaid orders.** Send `price = 0` for wallet/card orders? Is there a fee on `price = 0`?
4. **Label.** Will drivers accept our printed label (waybill barcode + QR)? Or are the
   numbered flyers (`email` field) mandatory, and do we have flyer stock?
5. **Cancel window.** Close customer/vendor cancellation of Arrive parcels at dispatch
   (recommended, because a cancel after dispatch costs the full fee), or keep it open and
   absorb the fee?
6. **Webhook.** Give Arrive `https://readycar.store/api/webhooks/arrive/<secret>`. Who
   registers it, and do they retry on a non-200?

Decisions for you (defaults I will use unless you say otherwise):

7. Courier choice = **global default + per-parcel admin override** (not per vendor, not
   per city). Pilot with default = Bosta and hand-picked parcels on Arrive.
8. Unserved Arrive sectors (Sharm, Dahab, Arish, Rafah, Sheikh Zuweid, Kharga, New
   Capital…) → dispatch to Arrive is refused with a message; automatic Bosta fallback in Phase 2.
9. Products without a weight → default 1 kg (setting), parcel flagged "weight estimated".
10. Arrive tariff and 5 EGP/kg surcharge treated as contract prices from
    `docs/arrive-tariff.json` until Arrive confirms in writing.

Nice to have from Arrive: numeric `status_id` and `date_created` in `getCurrentStatus`,
confirmation whether `order_id` dedupes, and refuse-fee clarification (delivery fee, 20, or both).

## 6. Decisions taken (2026-09-14, from Ready Car)

1. Arrive collects from **each vendor branch** — the branch address and phone go in `notes`.
2. Creation is treated as the pickup request (Arrive status 1); no separate request. Cut-off unknown.
3. Prepaid (wallet/card) orders are sent with `price = 0`.
4. Arrive will supply a label design; until then the label is rendered by us (`services/couriers/arrive/label.js`) from `waybill` + `qr_code`. Swapping the design only touches that file.
5. Cancellation of an Arrive parcel closes at dispatch (customer and vendor); admin cancel flags the waybill for a manual request in the Arrive portal.
6. Webhook URL is shown on Shipping Settings → Default courier → Arrive, and must be registered by Arrive.

Implemented in this pass (Phase 0 + Phase 1): courier switch (`ShippingSettings.courier_provider`),
per-parcel override + Arrive area picker on the admin order page, `services/couriers/*`, Arrive
create/track/webhook/sweep/label/cost, uncertain-send guard, courier-neutral views. Phase 2
(checkout district capture, returns via service_type 3, bulk create, Bosta fallback) is still open.

## 7. Test plan and results (2026-09-14)

Two automated suites, both run on an isolated copy of the production database with Arrive
stubbed (never the real API for writes; `getAllSectors` was called live read-only once):

**In-process** (`scratchpad/arrive_test.js`, services called directly): sector sync/search/
suggestion, settings switch + cache, per-parcel override, Arrive dispatch payload (sector, price 0
for prepaid / COD for cash, phone normalisation, notes with branch, `-rN` reference), label render,
webhook mapping (#4, #700 informational, #33 delivered, regression guard, #800 attention), sweep by
Arabic name, cancel without API call, reactivate on Arrive, timeout vs 4xx handling, attach waybill,
Bosta path unchanged. **All pass.**

**HTTP end-to-end** (`scratchpad/arrive_e2e.js`, real backend container + mock Arrive server on
the compose network, admin/vendor/customer JWTs): `GET /admin/couriers`, settings validation,
sector sync/search/unserved, customer shipping quote identical under either default courier,
full vendor flow (approve → confirm → label HTML → tracking → ready → handover) on Arrive with
Smart Label ON globally, pickup summary lists Arrive parcels separately, courier locked after
dispatch, customer cancel blocked, customer tracking view, webhook secret/JSON/array/PHP-form
bodies, exception reason on timeline, attention queue, delivered + order completed, unknown
waybill, commission ledger priced from the Arrive tariff, subsidy report by courier, auto area
from Arabic address, bulk "ready" send with COD, sweep, admin cancel → manual-cancel reminder →
done, reactivate, 504 timeout → attempt stamp → blocked → clear → resend `-r1`, 400 rejection,
legacy Bosta parcels untouched, zero Bosta calls. **All pass.**

Bugs found by the tests and fixed:
- Stage ③ "ready" and stage ④ "handover" checked the Bosta-only tracking field → Arrive parcels could never be marked ready.
- Commission ledger / vendor finance derived shipping cost from the Bosta tariff for every parcel → Arrive parcels showed cost 0 and an inflated margin. Now read from `courier_cost`.
- Subsidy report grouped Arrive parcels under "Sector null" → `by_courier` added, Arrive rows labelled by area group.
- Pickup summary and manual Bosta pickup booking would have put Arrive parcels on a Bosta pickup → excluded, listed as `other_courier_parcels`.
- Reactivation reported `previous_tracking: null` for Arrive.
- Legacy shipment rows read with `.lean()` had no `provider` → the view now treats them as Bosta.
- Manual courier cancellation had no follow-up → `courier_cancel_pending` flag + attention queue + "done" endpoint.
- Webhook accepted only JSON → PHP-style form bodies rebuilt.
- Customer tracking, family and friend order views carried only `bosta_tracking_number` → generic fields added.

Known limitations (unchanged): returns still ship back via Bosta; no district capture at checkout; no bulk Arrive create.
