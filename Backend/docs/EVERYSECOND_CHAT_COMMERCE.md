# EverySecond chat commerce

The AI agent on EverySecond sells Ready Car's catalogue in chat — WhatsApp,
Messenger, Instagram and the website's own chat window — and the orders it takes
are placed here as normal cash-on-delivery orders.

EverySecond has no way to call our API on its own initiative. It knows what we
push to it, and it tells us what happened by webhook. So data moves four ways:

```
catalogue  ──►  agent's menu        syncCatalog()               every EVERYSECOND_SYNC_MINUTES, changes only
agent      ──►  store, before sale  validateOrder()             order.validate webhook, synchronous, ≤ 4 s
agent      ──►  store, after sale   receiveEvent()              order.created / failed / cancelled, stored once
store      ──►  customer, in chat   sweepStatusAnnouncements()  every minute
```

On top of that, the website chat window is a backend proxy to EverySecond's Chat
API, and the website cart and the chat basket are kept in step both ways.

## Files

| Where | What |
|---|---|
| `services/everysecond/helpers.js` | Pure rules: external ids, webhook signature, product → menu item, address → governorate, status map, customer-facing lines. Tested in `tests/everysecond.test.js`. |
| `services/everysecond/client.js` | The API client (one key, 120 requests/min, waits out a 429). |
| `services/everysecond/catalogSync.js` | Catalogue → menu, diffed by hash. |
| `services/everysecond/orders.js` | `order.validate`, order events, the catch-up import, status announcements. |
| `services/everysecond/assistant.js` | The website chat proxy (`/api/assistant`). |
| `services/everysecond/index.js` | Status for the admin, webhook registration. |
| `models/everysecond.js` | `everysecondevents` (webhook log + dedupe) and `everysecondmenuitems` (pushed hashes). |
| `models/orders.js` | `source` and `chat` on an order. |
| `routes/everysecondWebhook.js` | `POST /api/webhooks/everysecond` — mounted before `express.json()`. |
| `routes/assistant.js` | `/api/assistant/*` — the chat window's endpoints. |
| `routes/adminEverysecond.js` | `GET /api/admin/everysecond/status`, `POST /api/admin/everysecond/sync[?reconcile=1]`. |
| `app.js` | Mounts the above and schedules the two jobs. |
| `frontend/src/components/chat/*` | The chat window (replaces EverySecond's embedded launcher). |

## Catalogue sync

- **What is on the menu:** every `published` product of a vendor that is not
  suspended and has an active subscription — the same rule as the storefront. A
  product with variants becomes one item per variant.
- **External id:** the product `_id`, or `<productId>~<variantId>`. Stable when a
  vendor renames the product or its slug.
- **Each item carries:** name (EN/AR), a description with brand, part type,
  subtitle, **fitment** ("Fits: Toyota Corolla 2015–2020" / "Universal fit") and
  part number, category, list price and offer price, availability, photo
  (`image_url`) and the product page link (`product_url`). Photo + link are what
  the agent's product cards are built from; only `https` URLs are sent.
- **Only changes are sent.** Each item is hashed; a run where nothing changed
  costs one query and no requests. Stock and price changes need no hook — they
  change the hash wherever they were edited.
- **Removals:** a product that goes back to draft, loses its vendor, or is
  deleted is removed from the menu on the next run.
- **Reconcile:** the first run after startup compares against what EverySecond
  actually holds (removes what another environment left there). Also
  `npm run everysecond:sync -- --reconcile`.

## Orders taken in chat

Chat orders are **cash on delivery only**. Wallet, points and coupons are never
spent from a chat.

1. **`order.validate`, stage `quote`** — the basket changed. We answer with our
   unit prices, what is available and, once the governorate is known, our
   shipping fee and total. This is what the agent reads back to the customer.
2. **`order.validate`, stage `place`** — the customer said yes. The order is
   created through `orderService.placeOrder` (same pricing, vendors, parcels,
   shipping, COD eligibility and WhatsApp confirmation as a web order) and its
   reference (`REF-…`) is returned as `merchant_ref`. A refusal the customer can
   act on is returned as `ok:false` with a line in their language: no valid
   mobile number, no governorate, cash on delivery not available for that
   number, area not covered, item no longer sellable, pickup.
3. **`order.created`** links EverySecond's order to ours (`chat.es_order_id`).
   If the validation never reached us (no webhook, a timeout), the order is
   placed now; if it cannot be, EverySecond's order is cancelled and the
   customer is told in the chat.
4. **`order.failed` / `order.cancelled`** cancel ours while it is still pending.
5. **Catch-up** — every minute the newest EverySecond orders are read and any
   that never reached us are imported. This is what makes a missed webhook, or a
   development machine EverySecond cannot call, still end in a real order.

Only an explicit `ok:false` stops a sale. No answer in time is treated by
EverySecond as having no webhook at all, so a slow or broken backend never blocks
the agent — the catch-up places the order afterwards.

**Whose account:** a signed-in website customer's chat carries their id
(`web:user:<id>`), so the order is theirs. Otherwise the phone decides — the
account that already has the number, or a new guest account, exactly as guest
checkout creates. A chat order spends nothing from the account, and its
confirmation goes to that number on WhatsApp before anything ships.

**Governorate:** the delivery zones on EverySecond are Egypt's governorates, with
Arabic and English aliases. The zone the agent matched is resolved against our
`cities` table, so shipping is priced exactly as at web checkout.

**Status updates:** the order status is derived from its parcels and changes in
many places (couriers, vendors, admins). One sweep reads it and tells the
customer in the same chat: `processing/confirmed → confirmed`,
`ready/pickup_scheduled/picked_up → preparing`,
`in_transit/out_for_delivery/partially_shipped → out_for_delivery`,
`completed → delivered`, `cancelled → cancelled`. Forward only, once each.

## The website chat window

The browser only talks to `/api/assistant/*`; the agent's key never leaves the
server.

| Frontend | Backend | EverySecond |
|---|---|---|
| `GET /assistant/messages` | history + open basket | `GET /chats?external_id=`, `GET /chats/{id}/messages`, `GET /chats/{id}/cart` |
| `POST /assistant/messages` | one message, the reply | `POST /chats`, `POST /chats/{id}/messages` |
| `POST /assistant/voice` | a voice note (raw audio body) | `POST /chats/{id}/messages` (multipart `audio`) |
| `PUT /assistant/cart` | website cart → chat basket | `PUT /chats/{id}/cart` |
| `DELETE /assistant/cart` | ordered on the website | `DELETE /chats/{id}/cart` |
| `DELETE /assistant/messages` | new conversation | `DELETE /chats/{id}` |

- A signed-in customer is `web:user:<id>`; a guest is `web:anon:<random id kept
  in the browser>`.
- Limits (in memory, per process): 12 messages / 5 min per person, 60 / 10 min
  per IP, `EVERYSECOND_WEB_CHAT_DAILY_LIMIT` a day site-wide; cart writes 30 /
  5 min per person.
- Every reply carries `products` (the cards), `cart` and `order`. Our products are
  joined on, so a card links to the product page in the customer's language and
  its "Add to cart" button adds the real product to the website cart.
- **Two carts, one basket.** What the agent adds is applied to the website cart
  as a difference; the website cart is put into the basket a moment after it
  changes and always before the customer writes. An order on the website closes
  the chat basket; an order in the chat takes its lines out of the website cart.
  `EVERYSECOND_CART_TWO_WAY=false` keeps only chat → website.

## Configuration

All in `Backend/.env` (see the root `.env.example`):

| Variable | |
|---|---|
| `EVERYSECOND_API_KEY` | The selling agent's key. Blank = feature off. Separate from `WHATSAPP_API_KEY`. |
| `EVERYSECOND_WEBHOOK_SECRET` | `whsec_…` printed by the register script. |
| `EVERYSECOND_SYNC_MINUTES` | Default 10. `0` turns the timer off. |
| `EVERYSECOND_PRODUCT_LOCALE` | `ar` (default) or `en` — language of the product links. |
| `EVERYSECOND_MAX_QTY_PER_ORDER` | Optional per-order cap for every item. |
| `EVERYSECOND_WEB_CHAT_DAILY_LIMIT` | Default 1000. `0` = no cap. |
| `EVERYSECOND_CART_TWO_WAY` | Default true. |
| `EVERYSECOND_SITE_URL` | Development only: the public https site product links point at. |

> **Never put the live agent's key in a development `.env`.** The first sync
> after startup reconciles — a development database would replace the live menu
> with its own products. Use a test agent locally.

The backend enforces this: when `EVERYSECOND_API_KEY` equals `WHATSAPP_API_KEY`
(the live agent) while `MONGO_URI` points at this machine, the feature stays off
and says why in the log. `EVERYSECOND_ALLOW_LIVE_AGENT_ON_LOCAL_DB=true` is the
deliberate override.

| Machine | `EVERYSECOND_API_KEY` | `WHATSAPP_API_KEY` | `EVERYSECOND_WEBHOOK_SECRET` |
|---|---|---|---|
| Development (local Mongo) | the **test** agent's key | the live agent's key (unchanged) | blank — EverySecond cannot call localhost |
| Server | the **live** agent's key | the same live key | set, from the register script |

`npm run everysecond:check` reads the setup and says what is wrong: which agent
the key belongs to, whether Orders is on, branches, menu items, the webhook. It
changes nothing and never prints a key.

## Going live

On EverySecond (the agent's screen and the Orders screen):
1. Enable **Orders** on the agent; currency EGP; product photos = "cards with
   every recommendation".
2. One branch ("Ready Car — Online orders") and the 28 governorates as delivery
   zones with their Arabic aliases, fee 0 (our `order.validate` answer is the fee
   the customer is quoted).
3. The agent's instructions for chat commerce (fitment rule, the order flow,
   cash on delivery only) and the knowledge base.
4. Generate the agent's API key (Integrations).

On the server:
1. `EVERYSECOND_API_KEY=…` in `Backend/.env`.
2. `npm run everysecond:register-webhook -- https://readycar.store/api/webhooks/everysecond`
   and put the printed `EVERYSECOND_WEBHOOK_SECRET=…` in `Backend/.env`.
3. `docker compose up -d --build backend frontend`.
4. `GET /api/admin/everysecond/status` — `configured`, `webhook_secret_set`,
   `last_sync` and the menu count.

## Commands

```bash
npm run everysecond:check                # is this machine set up correctly? (read-only)
npm run test:everysecond                 # the pure rules
npm run everysecond:sync [-- --reconcile]
npm run everysecond:register-webhook -- https://<domain>/api/webhooks/everysecond
npm run everysecond:register-webhook -- --list
```

## Not in this round

- Online payment from the chat (a payment link). Card customers finish on the
  website; their basket is already in the cart.
- WhatsApp abandoned-cart messages.
- Bundles are not on the agent's menu.
- An admin screen for the status endpoint.
