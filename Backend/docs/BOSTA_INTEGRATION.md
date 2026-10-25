# Bosta integration — order status sync

How an order's status is driven by Bosta after it is dispatched, and how to configure it.

## Lifecycle

```
pending → processing → confirmed → ready      ← admin-driven (manual)
                                     │  (sent to Bosta: shipments + pickup created)
                                     ▼
pickup_scheduled → picked_up → in_transit → out_for_delivery → completed   ← Bosta-driven
                                     │
                                     └→ returned / exception / cancelled    ← Bosta-driven
```

- Up to and including `ready`, the admin sets the status manually.
- Setting `ready` (admin route `PUT /api/admin/orders/:id/status`) calls `sendOrderToBosta`, which
  creates one Bosta delivery per vendor pickup group and schedules pickups.
- **After dispatch the status is controlled solely by Bosta** and cannot be changed manually by the
  admin (`orderService.updateOrderStatus` rejects edits once the order has Bosta tracking numbers).

## How status updates arrive

Two independent paths, both funnelling through the single mapping in
[`services/bostaStatusMap.js`](../services/bostaStatusMap.js):

1. **Webhook** — `POST /api/webhooks/bosta/:secret` ([`routes/bostaWebhook.js`](../routes/bostaWebhook.js)).
   Bosta posts a delivery status update; we map it and update the order.
2. **Polling fallback** — a cron (`*/20 * * * *` in [`app.js`](../app.js)) runs
   `sweepActiveBostaOrders()`, polling Bosta tracking for every dispatched, non-terminal order.
   This guarantees orders still progress even if a webhook is missed or not configured.

### Webhook payload (verified)

Bosta POSTs a flat JSON body where **`state` is a bare numeric code** (not an object or string):

```json
{
  "_id": "Hk3l9...",
  "trackingNumber": 12345678,
  "state": 45,
  "type": "SEND",
  "timeStamp": 1719139200000,
  "deliveryPromiseDate": "23-06-2026",
  "numberOfAttempts": 0,
  "cod": 0,
  "isConfirmedDelivery": true,
  "businessReference": "<order_id-vendor_id-idx>"
}
```

On an exception (state 47) the body also carries `exceptionReason` / `exceptionCode`. `type` is one of
`SEND`, `EXCHANGE`, `CUSTOMER_RETURN_PICKUP`, `RTO`, `SIGN_AND_RETURN`, `FXF_SEND`. Forward orders are
`SEND`; our return shipments are `CUSTOMER_RETURN_PICKUP`.

### State mapping

The numeric `state` code is the source of truth (`bostaStatusMap.js`). Key codes:

| Bosta state code → name                                              | Internal order status |
|----------------------------------------------------------------------|-----------------------|
| 10 Pickup requested / 11 Waiting for route / 20 Route Assigned       | `pickup_scheduled`    |
| 21 Picked up from business / 24 Received at warehouse / 22·23 from consignee | `picked_up`    |
| 30 In transit between Hubs                                           | `in_transit`          |
| 40 Picking up / 41 Picked up (heading to customer)                   | `out_for_delivery`    |
| 45 Delivered                                                         | `completed` (sets `delivered_at`) |
| 46 Returned to business / 60 Returned to stock                       | `returned`            |
| 49 Canceled                                                          | `cancelled`           |
| 47 Exception / 48 Terminated / 100 Lost / 101 Damaged / 102 Investigation / 103 Awaiting action / 105 On hold | `exception` |

(104 Archived is intentionally left unmapped so it can't regress a finished order.) **Return shipments**
(`CUSTOMER_RETURN_PICKUP`) are considered received by the vendor at state **46 Returned to business**.
The GET tracking endpoint used by the polling sweep returns named states, which the same module also
maps (value-string table) as a fallback.

For multi-vendor orders (multiple shipments) the order reflects the **least-advanced** shipment, and
only reaches `completed` when **every** shipment is delivered. Completion sets `delivered_at`, which
starts the 14-day vendor-earnings clearance and the return window.

The frontend uses the shared [`frontend/src/lib/orderStatus.js`](../../frontend/src/lib/orderStatus.js)
so admin, customer, and vendor views show identical, bilingual labels.

## Configuration

Set in the Backend environment (see `.env.example`):

- `BOSTA_BASE_URL` — `https://app.bosta.co`
- `BOSTA_API_KEY` — business API key
- `BOSTA_WEBHOOK_URL` — public HTTPS URL **including the secret**, e.g.
  `https://your-domain.com/api/webhooks/bosta/<BOSTA_WEBHOOK_SECRET>` (must be a real domain; Bosta
  rejects IPs/localhost)
- `BOSTA_WEBHOOK_SECRET` — random secret, verified on every webhook call

### Registering the webhook

Bosta's create-delivery request accepts an optional **per-delivery `webhookUrl`** field (documented in
Bosta's SDK as receiving a "webhookStateUpdate" POST on every state change). `sendOrderToBosta` already
attaches `webhookUrl` (= `BOSTA_WEBHOOK_URL`) to each delivery, so no business-level dashboard config is
strictly required — Bosta POSTs status updates to that URL per delivery.

Notes:
- The URL must be a real HTTPS domain with a TLD (Bosta rejects IPs/localhost). Put the secret in the
  path: `https://your-domain.com/api/webhooks/bosta/<BOSTA_WEBHOOK_SECRET>`.
- Bosta does **not** sign webhooks (no HMAC), which is why the shared secret in the URL is the
  verification mechanism.
- The webhook body is forwarded to `extractBostaState`, which reads `state.value` (string) and/or the
  numeric `state.code` from whatever shape Bosta sends.
- The 20-minute polling sweep is the safety net: statuses stay correct even if a webhook is delayed,
  dropped, or the account requires manual webhook enablement by Bosta support.

If you can capture one real webhook POST body (e.g. via a request-bin during a test delivery), share it
and the parser can be pinned to the exact shape.
