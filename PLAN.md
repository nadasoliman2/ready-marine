# Subscription-Based Vendor Marketplace — Implementation Plan

## Project: ReadyCar
## Date: 2026-05-08
## Status: Analysis Complete — Ready to Build

---

## Current State Assessment

The backend subscription infrastructure is **~70% built**. The core lifecycle logic (purchase, renew, expire, cancel, product unpublishing/republishing, trial eligibility) is already implemented. The missing pieces are spread across backend enhancement, frontend UI, and notification/database persistence.

---

## What's Already Implemented

### Backend (Existing)
- `SubscriptionPackage` model — name, description, price, billing_period, max_products, status, is_free_trial, trial_days
- `VendorSubscription` model — vendor_id, package_id, started_at, expires_at, status, auto_renew, is_free_trial, cancelled_at, cancellation_reason
- `Seller.subscription_status` — enum: active, trial_active, not_subscribed, expired, cancelled, suspended
- `Seller.suspension_reason`, `suspension_date`, `suspended_by` fields
- `Product.is_published`, `Product.status` — used for subscription gating
- `subscriptionService.js` — package CRUD
- `vendorSubscriptionService.js` — full lifecycle: purchase, renew, resubscribe, expireOldSubscriptions, cancelVendorSubscription, hasUsedFreeTrial, republishVendorProducts, unpublishAllVendorProducts
- `notificationService.js` — console logging for: subscription_activated, subscription_expiring_soon, subscription_expired, account_suspended, renewal_successful, subscription_cancelled
- `subscriptionMiddleware.js` — requireSubscription, requireProductQuota guards
- `subscriptionPackages.js` route — full CRUD (admin)
- `subscriptions.js` route — vendor endpoints (status, packages, free-trial check, purchase, renew, resubscribe)
- `admin.js` routes — vendor subscription status view, suspend, cancel, not-subscribed list, store image upload
- Cron job in `app.js` — daily expiration check + 7/3/1-day reminders

---

## What's Missing

### Backend Gaps
1. **Missing notification types**: `trial_activated`, `product_visibility_restored`, `account_became_not_subscribed`
2. **In-app notification persistence**: no `Notification` model — console logs only
3. **Admin subscription monitoring dashboard** — backend endpoint for paginated subscription list with full filtering (status, package, vendor, trial usage, expiration date)
4. **Trial activation notification** — existing `subscription_activated` doesn't distinguish trial vs paid
5. **Product modification tracking** — no field to detect if product was edited after subscription ended (re-review trigger)
6. **Cron job accuracy** — currently `setInterval` instead of proper node-cron

### Frontend Gaps (Admin)
1. **Admin Subscription Packages page** — create/edit/delete/toggle packages
2. **Admin Subscriptions management page** — view all subscriptions with filters, status tabs
3. **Admin Vendors page enhancements** — filter by subscription_status, show subscription status badge, show suspension metadata
4. **Admin Vendor Suspension modal** — reason input, suspension metadata display
5. **Admin Vendor Creation/Edit** — store image upload

### Frontend Gaps (Vendor Dashboard)
1. **Vendor Subscription Status page** — current plan, product count, remaining slots, expiration date
2. **Vendor Packages Browse page** — list active packages with pricing, features
3. **Vendor Subscription Purchase/Activate flow** — free trial activation, paid purchase
4. **Vendor Resubscribe page** — product selection when plan supports fewer products than previously published
5. **Vendor Subscription Expiring Banner** — alert on dashboard when within 7/3/1 days
6. **In-app Notifications dropdown** — bell icon with notification list

---

## Implementation Plan

### Phase 1: Backend — Notification & Data Enhancements

#### 1.1 Notification Model
**File**: `Backend/models/notifications.js` (new)

Store in-app notifications in DB for vendor dashboard consumption.

```js
{
  vendor_id: ObjectId,
  type: String,       // 'trial_activated' | 'subscription_activated' | 'subscription_expiring_soon' | 'subscription_expired' | 'subscription_cancelled' | 'account_became_not_subscribed' | 'product_visibility_restored' | 'account_suspended'
  title: String,
  message: String,
  data: Object,       // raw payload
  read: Boolean,
  createdAt: Date
}
```

**Route**: `Backend/routes/notifications.js` (new)
- `GET /api/vendors/notifications` — list vendor notifications (paginated, filter read/unread)
- `PUT /api/vendors/notifications/:id/read` — mark single as read
- `PUT /api/vendors/notifications/read-all` — mark all as read
- `GET /api/vendors/notifications/count` — unread count for bell badge

**Service**: `Backend/services/notificationService.js` — update `sendSubscriptionNotification` to persist to DB (not just console log).

---

#### 1.2 Product Modification Tracking
**File**: `Backend/models/products.js` — add fields:
```js
subscription_hidden_at: Date,    // when product was hidden due to subscription expiry
last_modified_after_subscription_restore: Boolean  // default false
```

**File**: `Backend/services/vendorSubscriptionService.js`:
- `unpublishAllVendorProducts` — set `subscription_hidden_at = new Date()` and `last_modified_after_subscription_restore = false`
- `resubscribeAfterEnd` — when republishing products, check `last_modified_after_subscription_restore`. If `false` and `is_published: true`, publish directly (no re-review). If `true`, set `status: 'pending'`.
- `republishVendorProducts` — only republish products where `last_modified_after_subscription_restore === false`

**Product update route** (`Backend/routes/vendors.js`): When a vendor edits a product that was `subscription_hidden_at` set, mark `last_modified_after_subscription_restore = true` so it goes back to pending review.

---

#### 1.3 Cron Job Upgrade
**File**: `Backend/package.json` — add `node-cron` dependency

**File**: `Backend/app.js` — replace `setInterval` with proper `node-cron` schedule:
```js
cron.schedule('0 0 * * *', async () => { ... }); // daily at midnight
```

---

#### 1.4 Admin Subscription Monitoring — Enhanced Backend
**File**: `Backend/services/vendorSubscriptionService.js` — add:
```js
const getAllSubscriptionsAdminEnhanced = async ({ vendorId, packageId, status, is_free_trial, trial_used, expires_before, expires_after, page, limit }) => {
  // full filter support including trial_used check, expiration date range
};
```

Also add `getAllVendorsAdmin = async ({ subscription_status, q, page, limit })` to `Seller` model for the enhanced admin vendor list.

---

### Phase 2: Frontend — Admin Dashboard

#### 2.1 Admin Subscription Packages Page
**File**: `frontend/src/app/admin/subscription-packages/page.jsx`

Features:
- List all packages in a table with status badges (active/inactive)
- Create package modal/form: name, description, price, billing_period, max_products, is_free_trial toggle, trial_days
- Edit package modal — same fields
- Toggle active/inactive with confirmation
- Delete with confirmation (warn if vendors are using it)
- Package type badge (Paid Monthly / Paid Yearly / Free Trial)

#### 2.2 Admin Subscriptions Management Page
**File**: `frontend/src/app/admin/subscriptions/page.jsx`

Features:
- Tabs: All | Active | Expired | Cancelled | Trial Active
- Table columns: Vendor, Package, Status, Billing, Started, Expires, Trial Used
- Filters: by vendor name, by package, expiration date range
- Search by vendor/store name
- Pagination (20 per page)
- Click row → vendor subscription detail drawer/modal

#### 2.3 Admin Vendor List Enhancements
**File**: `frontend/src/app/admin/vendors/page.jsx` (create if not exists)

Features:
- Table with columns: Store Name, Email, Status, Subscription Status, Joined, Actions
- Filter tabs: All | Active | Suspended | Not Subscribed | Expired | Cancelled | Trial Active
- Search by store name/email
- Suspension column shows suspension_reason on hover/tooltip
- "View Details" → opens vendor detail page
- "Suspend" button with reason modal
- "Reactivate" button for suspended vendors
- "Subscription" button → links to vendor's subscription detail

#### 2.4 Admin Vendor Detail Page
**File**: `frontend/src/app/admin/vendors/[id]/page.jsx`

Features:
- Vendor info card: name, store name, email, phone, address, store image
- Subscription status card: current plan, status badge, expiration, product count/max
- Suspension metadata card (if applicable): reason, date, admin responsible
- Action buttons: Edit vendor, Upload store image, Suspend/Reactivate, Cancel subscription
- Recent subscription history table

#### 2.5 Admin Vendor Suspension Modal
- Required reason textarea (min 10 characters)
- Confirm button with warning text
- On success: show toast, update UI

#### 2.6 Admin Vendor Creation — Store Image Upload
Enhance the existing add/edit vendor form to include:
- Drag-and-drop store image upload
- Image preview
- Remove image button
- Replace existing `store_image` text field with upload widget

---

### Phase 3: Frontend — Vendor Dashboard

#### 3.1 Vendor Subscription Status Page
**File**: `frontend/src/app/dashboard/subscription/page.jsx`

Features:
- Current plan card: package name, billing period, status badge, expiration countdown
- Product usage card: "X of Y published products", progress bar, remaining slots
- Quick action buttons: "Renew Subscription", "View Packages", "Upgrade Plan"
- If no subscription: prominent CTA to browse packages
- Subscription history accordion/list

#### 3.2 Vendor Subscription Expiring Banner
**File**: `frontend/src/components/dashboard/SubscriptionBanner.jsx`

Global banner (shown on all dashboard pages when within 7 days):
- Appears when `subscriptionStatus === 'active'` AND `expires_at - now <= 7 days`
- Shows: "Your subscription expires in X days. Renew now to keep your products live."
- "Renew Now" button → goes to subscription page
- Dismiss option (stored in localStorage)

#### 3.3 Vendor Packages Browse Page
**File**: `frontend/src/app/dashboard/subscription/packages/page.jsx`

Features:
- Grid of package cards: name, description, price, billing period, max products
- "Current Plan" badge on active package
- "Free Trial" badge, disabled if already used
- "Select Plan" button → goes to purchase flow
- Comparison table below cards (optional)

#### 3.4 Vendor Subscription Purchase Flow
**File**: `frontend/src/app/dashboard/subscription/purchase/[packageId]/page.jsx`

Features:
- Package summary card
- Billing period selector (Monthly / Yearly) — if applicable
- Price breakdown
- "Activate Free Trial" (if trial) or "Subscribe Now" button
- On submit → call `POST /api/vendors/subscription/purchase`
- On success → redirect to subscription status page with success message
- On error → show error message (e.g., "Free trial already used", "Product limit exceeded")

#### 3.5 Vendor Resubscribe — Product Selection
**File**: `frontend/src/app/dashboard/subscription/resubscribe/[packageId]/page.jsx`

Features (shown only when `code === 'SELECT_PRODUCTS_REQUIRED'`):
- Explanation text: "Your new plan supports X products. You have Y products previously approved. Please select up to X to keep published."
- Product list with checkboxes — fetched from API response `allProducts`
- Max selectable count validation
- Selected count indicator
- "Activate Subscription" button
- Call `POST /api/vendors/subscription/resubscribe` with `selectedProductIds`

#### 3.6 Vendor Notifications Bell
**File**: `frontend/src/components/dashboard/NotificationBell.jsx`

Features:
- Bell icon in dashboard header/nav
- Badge with unread count
- Dropdown panel showing last 10 notifications
- Each notification: icon by type, title, message, relative time, read/unread styling
- "Mark all as read" button
- "View all" link → notifications page
- Real-time polling (every 60s) or SWR refresh

#### 3.7 Vendor Notifications Page
**File**: `frontend/src/app/dashboard/notifications/page.jsx`

Features:
- Full notification list with infinite scroll
- Filter: All / Unread
- Mark individual/all as read
- Notification type icons and colors
- Relative timestamps

---

### Phase 4: Backend — Final Polish

#### 4.1 Missing Notification Types
**File**: `Backend/services/notificationService.js`

Add to `sendSubscriptionNotification`:
- `trial_activated` — when a free trial is activated (can reuse subscription_activated with is_free_trial flag, but add distinct title/message)
- `product_visibility_restored` — when subscription renews and products republish
- `account_became_not_subscribed` — when subscription expires and vendor transitions to not_subscribed

#### 4.2 Vendor Subscription Status Route Enhancement
**File**: `Backend/routes/subscriptions.js`

`GET /api/vendors/subscription/status` — add:
- `isExpiringSoon` — boolean, true if expires within 7 days
- `daysUntilExpiry` — number
- `subscriptionHistory` — last 3 subscriptions (paginated)

#### 4.3 Public Product Listing — Subscription Gate
**File**: `Backend/services/productService.js`

Ensure `getAllProducts` and `getProductBySlug` filter out products where:
- Vendor `subscription_status` is NOT `active` or `trial_active`, OR
- Vendor `status` is `suspended`, OR
- Vendor `suspension_reason` is set

This prevents expired/cancelled vendors from appearing in public marketplace.

---

## File Summary

### New Backend Files
| File | Purpose |
|------|---------|
| `models/notifications.js` | Notification DB model |
| `routes/notifications.js` | Vendor notification CRUD |
| `middleware/notificationMiddleware.js` | Optional: attach unread count to req |

### Modified Backend Files
| File | Changes |
|------|---------|
| `models/products.js` | Add `subscription_hidden_at`, `last_modified_after_subscription_restore` |
| `models/sellers.js` | Add `getAllVendorsAdmin` helper |
| `services/vendorSubscriptionService.js` | Track product modification, add trial notification, enhance resubscribe |
| `services/notificationService.js` | Persist to DB, add missing notification types |
| `routes/vendors.js` | Track product modification on edit |
| `routes/subscriptions.js` | Add `daysUntilExpiry`, `isExpiringSoon`, history |
| `services/productService.js` | Filter by vendor subscription status |
| `app.js` | node-cron, register notifications route |
| `package.json` | Add `node-cron` |

### New Frontend Files
| File | Purpose |
|------|---------|
| `app/admin/subscription-packages/page.jsx` | Admin package management |
| `app/admin/subscriptions/page.jsx` | Admin subscription monitoring |
| `app/admin/vendors/page.jsx` | Admin vendor list with filters |
| `app/admin/vendors/[id]/page.jsx` | Admin vendor detail |
| `app/dashboard/subscription/page.jsx` | Vendor subscription status |
| `app/dashboard/subscription/packages/page.jsx` | Vendor browse packages |
| `app/dashboard/subscription/purchase/[packageId]/page.jsx` | Purchase/activate flow |
| `app/dashboard/subscription/resubscribe/[packageId]/page.jsx` | Product selection on resubscribe |
| `app/dashboard/notifications/page.jsx` | Vendor notifications list |
| `components/dashboard/SubscriptionBanner.jsx` | Expiring subscription alert |
| `components/dashboard/NotificationBell.jsx` | Notification bell + dropdown |
| `lib/api.js` (or augment) | API client functions for subscriptions/notifications |

### Modified Frontend Files
| File | Changes |
|------|---------|
| `app/dashboard/layout.jsx` | Add SubscriptionBanner, NotificationBell to nav |
| `app/admin/layout.jsx` | Add subscriptions nav item |
| `app/admin/vendors/page.jsx` | Enhance existing or create |
| `app/admin/vendors/[id]/page.jsx` | Enhance existing or create |
| `context/...` | Add AuthContext refresh for subscription status |

---

## Implementation Order

1. **Phase 1.1** — Notification model + DB persistence
2. **Phase 1.2** — Product modification tracking fields
3. **Phase 1.3** — Cron upgrade + missing notification types
4. **Phase 1.4** — Enhanced admin subscription endpoints
5. **Phase 2.1** — Admin subscription packages page
6. **Phase 2.2** — Admin subscriptions management page
7. **Phase 2.3–2.5** — Admin vendor list + detail + suspension UI
8. **Phase 2.6** — Admin vendor creation store image upload
9. **Phase 3.1** — Vendor subscription status page
10. **Phase 3.2** — Vendor expiring banner
11. **Phase 3.3** — Vendor packages browse
12. **Phase 3.4** — Vendor purchase flow
13. **Phase 3.5** — Vendor resubscribe product selection
14. **Phase 3.6–3.7** — Vendor notification bell + page
15. **Phase 4.1–4.3** — Backend final polish

---

## Technical Notes

- Frontend uses **Next.js** with Tailwind CSS — follow existing component patterns
- Admin uses plain fetch/custom hooks (no Axios needed, check existing patterns)
- Backend is Express.js with Mongoose — follow existing service/route patterns
- All subscription status checks should use the existing `subscriptionMiddleware.js` guards
- Product visibility enforcement on the public marketplace should happen at the `productService.js` level (not just auth-gated routes) so even direct links to expired vendor products return 404
- The `subscriptionMiddleware.requireProductQuota` should be used on the product publish endpoint, not just the add endpoint
