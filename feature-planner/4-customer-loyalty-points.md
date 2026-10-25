# 4 - Customer Loyalty Points

> Status: MVP business rules confirmed · Created: 2026-07-27 · Updated: 2026-07-28 · No implementation changes included

## Confirmed Requirement

ReadyCar customers earn loyalty points from purchases. The Admin controls:

- The earning rate, for example: every EGP 25 of eligible spend earns 1 point.
- The redemption value, for example: 1 point deducts EGP 0.50.
- Whether the loyalty program is active.

Customers can use available points as a discount on later purchases.

## Approved MVP Decisions

The following business rules are confirmed:

| Decision | Approved behavior |
| --- | --- |
| Earning availability | Pending at delivery, available after the 14-day return window |
| Earning base | Merchandise after coupon and loyalty discounts |
| Shipping | Does not earn points and cannot be paid with points |
| Rounding | Integer points using `floor` per order; no carried remainder |
| Maximum redemption | 50% of eligible merchandise |
| Minimum redemption | Admin-configurable; default 1 point |
| Coupon stacking | Coupon and points can be used together; coupon is applied first |
| COD | Points can be used and are restored if the order is cancelled |
| Online payment | Points are reserved during payment and released on failure/expiry |
| Expiration | Points do not expire in the MVP |
| Historical orders | No retroactive points |
| Eligible catalogue | Normal products and bundles; no shipping, fees, or subscriptions |
| Gift orders | Points belong to the buyer/payer, not the recipient |
| Manual adjustments | Admin can credit/debit with a mandatory reason and Audit Log |
| Rate changes | New rates apply prospectively; historical transactions keep snapshots |

When Admin changes the redemption value, an existing balance keeps the same
number of points but its current EGP value changes to the new active rate.
Example: 100 existing points are worth EGP 50 at EGP 0.50 per point, then worth
EGP 25 if Admin changes the active value to EGP 0.25. The Admin UI must warn
about this impact before saving.

## Approved Product Definition

For the MVP:

- Points belong to the **paying customer**.
- Points are calculated from merchandise value after discounts.
- Shipping charges do not earn points.
- Redeemed points do not earn more points.
- A delivered order creates pending points.
- Pending points become available after ReadyCar's 14-day return window, as long
  as no active return blocks settlement.
- Cancelled, failed, or unpaid orders earn no points.
- Points used on a cancelled/refunded order are restored according to the
  refunded merchandise.
- Gift orders earn and spend the buyer/payer's points, not the recipient's.

## Business Rules and Rationale

### 1. Earning trigger

When should points become spendable?

Options:

1. Immediately after order creation/payment.
2. When the order is delivered (`completed`).
3. After delivery plus the return window.

Approved: show points as **Pending** at delivery, then make them **Available**
after the current 14-day return window. This prevents earning, spending, and
then returning the original purchase.

### 2. Eligible order amount

Should points be calculated on:

- Product subtotal before discounts?
- Product subtotal after coupon?
- Amount after coupon and loyalty redemption?
- Shipping?
- Taxes, if added later?

Approved formula:

```text
eligible_amount =
  product_subtotal
  - coupon_discount
  - loyalty_discount
  - refunded_product_amount
```

Shipping is excluded.

### 3. Rounding and spend remainder

For EGP 25 = 1 point, what happens to an EGP 49 order?

- `floor per order`: 1 point and EGP 24 is discarded.
- `carry remainder`: 1 point and EGP 24 carries to the next purchase.
- `fractional points`: 1.96 points.

Approved MVP: integer points with `floor per order`. It is easiest to explain
and audit. Carrying spend remainder can be added later if the business wants it.

### 4. Redemption limits

Decide:

- Minimum points required to redeem.
- Maximum percentage of an order payable with points.
- Whether points can cover 100% of products.
- Whether shipping can be paid with points.
- Whether a minimum cash/card amount must remain.

Approved MVP:

- Minimum redemption: configurable by Admin.
- Maximum redemption: configurable percentage, default 50% of eligible
  merchandise.
- Points cannot discount shipping.
- If the order has shipping, shipping remains payable normally.

The percentage cap avoids a zero-value checkout path until wallet-only orders
are deliberately supported.

### 5. Coupon stacking

Can a customer use a coupon and points together?

Approved: yes. Apply the coupon first, then loyalty points. Earn new points
only from the remaining merchandise amount actually paid.

### 6. Supported payment methods

Should points work with:

- Online/card orders?
- Cash on delivery?
- Buy-for-friend online orders?

Approved:

- Normal checkout: online and COD.
- Buy for a friend: online only, following the confirmed Friends rule.
- Points always belong to the payer.

For online payment, reserve points while the hosted invoice is active. For COD,
consume them when the order is placed and restore them if the order is
cancelled.

### 7. Expiration

Do points expire?

Approved MVP: no expiry. If expiry is required later, use an explicit validity
period such as 12 months and redeem oldest point batches first.

### 8. Admin rate changes

If Admin changes:

- Earning rate from EGP 25 to EGP 50 per point.
- Redemption value from EGP 0.50 to EGP 0.25 per point.

Do existing points retain their old value?

Approved MVP:

- Completed loyalty operations keep a settings snapshot for audit.
- New earning operations use the active earning rate.
- Points are valued using the active redemption value at checkout.
- Admin sees a warning that changing point value changes the value of every
  existing balance.
- Every settings change is audit logged.

Preserving a different monetary value for every historical point batch is
possible but substantially increases accounting complexity.

### 9. Returns and refunds

Confirm behavior for:

- Full return.
- Partial item return.
- Returning an order that earned points.
- Returning an order that used points.

Approved:

- Pending earned points are reduced before they become available.
- A completed refund reverses earned points proportionally to the refunded
  eligible product value.
- Loyalty discount allocated to returned items is restored as points.
- The cash/card refund contains only the amount actually paid in money.
- Shipping refund follows the existing return policy and does not create points.

### 10. Scope and exclusions

Confirm whether every product/vendor/category earns points.

Approved MVP: every normal purchasable product and bundle earns points.
Subscriptions, shipping, fees, refunds, and manually created financial records
do not.

### 11. Existing orders

Should old orders receive points when the feature launches?

Approved: no retroactive earning. Only orders created after the program's
activation timestamp participate.

### 12. Manual adjustments

Should Admin be able to add/remove points for customer support?

Approved: yes, with:

- Mandatory reason.
- Admin identity.
- Before/after balance.
- Immutable audit transaction.
- No direct editing of the balance field.

## Customer Flow

### Earning

1. Customer places an order.
2. Checkout shows expected points:

   > Earn approximately 20 points after this order is delivered.

3. Failed/cancelled orders create no earned points.
4. When every shipment is delivered and the order becomes `completed`, create a
   pending earn transaction.
5. Profile shows the points under **Pending points**.
6. After the 14-day return window, release the remaining eligible points.
7. Notify the customer:

   > 20 points are now available.

Points displayed before settlement are estimates. The backend is authoritative.

### Redemption

1. Checkout loads the customer's available balance.
2. Customer enables **Use my points**.
3. Customer chooses a number of points or **Use maximum**.
4. Backend returns an updated authoritative preview.
5. Summary shows:

```text
Products                     EGP 300.00
Coupon                       -EGP 25.00
Loyalty points (20 points)   -EGP 10.00
Shipping                      EGP 40.00
Total                         EGP 305.00
```

6. Points are reserved atomically before starting online payment.
7. Successful payment consumes the reservation.
8. Failed/expired payment releases it.
9. The final order stores the number of points and their monetary discount.

### Profile

Add **My Points / نقاطي** to the customer profile with:

- Available points.
- Pending points.
- Reserved points, shown only when relevant.
- Current approximate monetary value.
- Earning and redemption rules.
- Transaction history.
- Order/reference link for each transaction.
- Expiration dates if expiry is enabled later.

## Example

Admin settings:

```text
Every EGP 25 eligible spend = 1 point
1 point = EGP 0.50 discount
Maximum redemption = 50% of eligible merchandise
```

### First order

```text
Products                  EGP 620
Coupon                    EGP 70
Shipping                  EGP 50
Eligible earning amount   EGP 550
Points earned             floor(550 / 25) = 22 points
```

The customer pays EGP 600. The 22 points become pending after delivery, then
available after the return window. Their current redemption value is EGP 11.

### Later order

```text
Products                  EGP 300
Coupon                    EGP 25
20 redeemed points        EGP 10
Shipping                  EGP 40
Final payment             EGP 305
New eligible amount       EGP 265
New points                floor(265 / 25) = 10 points
```

The customer does not earn points on shipping, coupon discount, or loyalty
discount.

## Balance States

Do not store only `User.points`. The wallet needs three balances:

```text
pending   → earned but not spendable
available → spendable
reserved  → held by an active checkout/payment
```

Typical transitions:

```text
Order delivered
→ earn_pending
→ return window closes
→ earn_release
→ available balance increases

Checkout starts
→ redeem_reserve
├── payment failed/expired → redeem_release
└── payment/order succeeds → redeem_consume

Order cancelled/refunded
→ redeemed points restored where applicable
→ earned points reduced/reversed where applicable
```

## Recommended Data Model

### `LoyaltyAccount`

```js
{
  user_id: ObjectId,
  available_points: Number,
  pending_points: Number,
  reserved_points: Number,
  lifetime_earned_points: Number,
  lifetime_redeemed_points: Number,
  created_at: Date,
  updated_at: Date
}
```

Use one unique account per customer.

### `LoyaltyTransaction`

```js
{
  user_id: ObjectId,
  account_id: ObjectId,
  type:
    'earn_pending' |
    'earn_release' |
    'earn_reverse' |
    'redeem_reserve' |
    'redeem_release' |
    'redeem_consume' |
    'redeem_restore' |
    'admin_credit' |
    'admin_debit' |
    'expire',
  points: Number,
  monetary_value: Number,
  order_id: ObjectId | null,
  payment_id: ObjectId | null,
  refund_id: ObjectId | null,
  source_transaction_id: ObjectId | null,
  idempotency_key: String,
  settings_snapshot: {
    spend_per_point: Number,
    point_value: Number,
    currency: String
  },
  available_at: Date | null,
  reason: String,
  actor: Object,
  created_at: Date
}
```

The transaction ledger is immutable. Corrections create compensating
transactions instead of editing old entries.

Create a unique index on `idempotency_key`. Examples:

```text
order:<orderId>:earn-pending
order:<orderId>:earn-release
payment:<paymentId>:redeem-reserve
payment:<paymentId>:redeem-consume
refund:<refundId>:earn-reverse
refund:<refundId>:redeem-restore
```

### `SiteSettings.loyalty`

```js
{
  enabled: Boolean,
  activated_at: Date,
  spend_per_point: Number,       // 25
  point_value: Number,           // 0.50
  min_redeem_points: Number,
  max_redemption_percent: Number,
  exclude_shipping: Boolean,
  allow_with_coupons: Boolean,
  points_expiry_days: Number | null
}
```

Validation:

- `spend_per_point > 0`
- `point_value > 0`
- `min_redeem_points >= 0`
- `max_redemption_percent` between 0 and 100

### Existing `Order` additions

```js
{
  loyalty: {
    payer_user_id: ObjectId,
    eligible_amount: Number,
    earn_points_pending: Number,
    earned_points_released: Number,
    redeemed_points: Number,
    redemption_discount: Number,
    spend_per_point_snapshot: Number,
    point_value_snapshot: Number
  }
}
```

Order totals, vendor commissions, refund calculations, and provider payment
amounts must use the loyalty-discounted amount.

### Existing `OrderPayment` additions

```js
{
  loyalty_reservation_id: ObjectId | null,
  redeemed_points: Number,
  loyalty_discount: Number
}
```

This binds a hosted invoice to exactly one point reservation.

## API Surface

### Customer

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/users/loyalty` | Balance, current value, and rules |
| `GET` | `/api/users/loyalty/transactions` | Paginated ledger history |
| `POST` | `/api/orders/preview` | Include requested loyalty points in authoritative preview |

Existing order/payment endpoints should accept `redeem_points`, but always
recalculate the allowed amount server-side.

### Admin

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/loyalty/settings` | Read loyalty configuration |
| `PUT` | `/api/admin/loyalty/settings` | Update configuration with audit log |
| `GET` | `/api/admin/loyalty/accounts` | Search balances and activity |
| `GET` | `/api/admin/loyalty/accounts/:userId` | Account and ledger detail |
| `POST` | `/api/admin/loyalty/accounts/:userId/adjust` | Credit/debit with reason |

## Admin Panel

Add **Loyalty Program / برنامج الولاء** with:

- Enable/disable program.
- EGP spend required per point.
- Monetary value per point.
- Minimum redeemable points.
- Maximum redemption percentage.
- Coupon stacking toggle.
- Expiration setting if required.
- Live calculation preview:

  > An EGP 500 eligible purchase earns 20 points, currently worth EGP 10.

- Total outstanding available/pending points.
- Total points earned/redeemed.
- Customer balance search.
- Manual adjustment form with mandatory reason.
- Settings-change audit history.

Disabling earning should not delete existing balances. Decide separately
whether redemption remains enabled; preferably expose two toggles:

- `earning_enabled`
- `redemption_enabled`

## Integration with Existing ReadyCar

- Order completion is already derived after all Bosta shipments are delivered.
- The existing return window is 14 days from `delivered_at`.
- Partial returns and proportional coupon reversal already exist.
- Loyalty reversal/restoration should attach to the completed refund flow.
- `SiteSettings` already holds global Admin-managed financial configuration.
- Checkout already has a server-authoritative subtotal, coupon discount,
  shipping total, and final total.
- Gift orders already keep the payer as `Order.user_id`; therefore loyalty
  belongs to the payer without changing refund ownership.

The two important integration hooks are:

1. `order.status` becomes `completed` → create pending earn transaction.
2. Refund becomes `completed` → reverse earned points and restore redeemed
   points proportionally.

Both hooks must be idempotent because Bosta webhooks, polling, and Admin actions
can repeat.

## Security and Accounting Rules

- Derive loyalty owner from authenticated payer/order owner.
- Never trust points, point value, discounts, or balances from the browser.
- Reserve points with an atomic `available_points >= requested_points`
  condition to prevent spending the same balance in two tabs.
- Use an immutable ledger and unique idempotency keys.
- Record rate/value snapshots on every financial operation.
- Admin cannot directly overwrite a balance.
- Refund cash only for the monetary amount actually paid.
- Restore loyalty discount as points, not cash.
- Keep loyalty data when an account is deactivated for financial audit.
- Do not expose another customer's loyalty balance, including friends or gift
  recipients.

## Delivery Phases

### Phase 0: Product decisions

Completed:

- Earning availability timing confirmed.
- Eligible amount and shipping exclusion confirmed.
- Rounding behavior confirmed.
- Redemption minimum/maximum confirmed.
- Coupon stacking confirmed.
- COD support confirmed.
- No expiry confirmed.
- Effect of Admin rate changes confirmed.
- No retroactive orders confirmed.

Exit criterion: complete.

### Phase 1: Ledger and Admin settings

- Add settings, account, ledger, indexes, and audit logging.
- Add Admin settings and customer balance search.
- Add atomic credit/debit/reserve/release service.
- Add idempotency tests.

### Phase 2: Earning

- Calculate estimated earning during preview.
- Create pending points at completed delivery.
- Release after return window.
- Add pending/available UI and notifications.

### Phase 3: Redemption

- Add checkout control and authoritative recalculation.
- Add online reservation/consume/release.
- Add COD consume/restore if approved.
- Store order/payment snapshots.

### Phase 4: Returns and operations

- Allocate loyalty discount across returned items.
- Reverse earned points.
- Restore redeemed points.
- Add manual recovery/admin adjustment tools.
- Test full and partial refund scenarios.

## Acceptance Criteria

### Earning

- Only eligible completed orders earn points.
- Shipping and discounts do not earn points.
- The earning formula uses the order's settings snapshot.
- Duplicate delivery events cannot duplicate points.
- Gift-order points belong to the payer.

### Redemption

- Customer cannot redeem more than available balance or configured limit.
- Two parallel checkouts cannot spend the same points.
- Coupon and points calculation follows the configured order.
- Failed/expired online payments release reserved points.
- COD cancellation restores consumed points.

### Returns

- Full and partial refunds reverse earned points correctly.
- Redeemed points allocated to returned items are restored.
- Cash refund never includes the loyalty-funded amount.
- Repeated refund processing does not duplicate reversals/restorations.

### Admin and audit

- Invalid rates and values cannot be saved.
- Settings changes do not rewrite historical transactions.
- Manual adjustments require a reason and create an immutable ledger entry.
- Disabling the program does not erase balances or history.
