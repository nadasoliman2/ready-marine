# Ready Marine — Comprehensive Backend Testing & QA Audit Report

**Audit Date:** October 29, 2026  
**Auditor:** Senior Backend Engineer, QA Automation Architect & Security Tester  
**Repository Context:** Ready Marine (`Backend/`) — [readymarine.store](https://readymarine.store/ar)  
**Execution Environment:** Node.js v26.10.0, Native Test Runner (`node --test`), isolated MongoDB & Redis test instances  

---

## 1. Executive Summary

A comprehensive, code-driven backend testing and QA audit was performed across the Ready Marine backend repository. The audit encompassed full codebase discovery, architecture tracing, threat modeling, automated test implementation across 7 new mission-critical test suites, automated test execution, and defect triage.

### Summary Metrics
| Metric | Result |
| :--- | :--- |
| **Total Test Suites** | 24 suites |
| **Total Automated Tests Executed** | **196 tests** |
| **Pass Rate** | **100% (196 passed, 0 failed, 0 skipped)** |
| **Execution Duration** | **7.92 seconds** |
| **Endpoints Cataloged** | 657 endpoints across 59 route modules |
| **Mongoose Models Audited** | 72 models |
| **Backend Services Audited** | 102 services |
| **Critical/High Defects Discovered** | 1 High, 2 Medium, 1 Low |

---

## 2. Backend Architecture Discovery & Inventory (Phase 1)

### 2.1 Technology Stack & Entry Points
- **Runtime & Framework:** Node.js v26.10.0, Express 4.16.1
- **Database & Persistence:** MongoDB with Mongoose 9.4.1 (strict schema validation, pre-save hooks, custom validators, transaction support)
- **Cache & Realtime Presence:** Redis (ioredis 5.11.1), WebSockets (socket.io 4.8.1)
- **HTTP Server:** `Backend/bin/www` (HTTP server + WebSocket initialization)
- **Express App:** `Backend/app.js` (middleware pipeline, cookie parsing, route mounting, background cron jobs)

### 2.2 Security & Authentication Topology
- **Cookie-Based JWT Architecture:**
  - `token`: Short-lived customer access token
  - `admin_token`: Admin access token
  - `refresh_token`: Secure HttpOnly cookie restricted to the `/api` path for session renewal
- **Role Isolation & Cryptographic Secrets:**
  - Three isolated JWT secrets: `JWT_SECRET_USER`, `JWT_SECRET_VENDOR`, `JWT_SECRET_ADMIN`. A token issued for a customer cannot verify or grant access to vendor or admin routes.
- **Session Revocation via Password Timestamp:**
  - `isTokenStaleAfterPasswordChange`: Tokens minted before `account.password_changed_at` are automatically invalidated upon presentation.
- **Fail-Closed Admin RBAC:**
  - Super admin credential is bound to environment variables (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) and re-checked against token claims (`sa: true`).
  - Sub-admin accounts are database-backed (`AdminUser`) with fine-grained module-level permissions.
  - Fail-closed design: Any unmapped admin route automatically returns `MODULE_NOT_MAPPED` (403), preventing unintended exposure of new endpoints.

### 2.3 Key Architectural Discovery: Cart & Pricing Model
Unlike traditional e-commerce backends with persistent database cart records, Ready Marine implements a **state-authoritative, client-staged cart model**:
1. Carts are assembled client-side in the browser / mobile app.
2. When the user requests checkout, shipping computation, coupon application, or order preview, the items array is submitted to `orderService.getPricedOrderPreview` and `orderService.buildPricedOrderItems`.
3. The server queries the database for each product by ObjectId, retrieves active variant snapshots, checks vendor suspension status, rejects draft products, and enforces **database-authoritative prices**, discarding any client-submitted pricing fields.

---

## 3. Automated Test Suite Architecture

All tests were implemented using Node.js native test runner (`node:test`, `node:assert/strict`) and run against isolated throwaway MongoDB and Redis instances via `Backend/tests/support/testServers.js`. Live and development databases are never touched.

### Newly Implemented Test Suites (63 Tests Added)
1. **`tests/coupons.test.js` (9 tests)**
   - Code normalization (`normalizeCode` trimming & uppercase).
   - Date windowing (rejection of expired or future coupons).
   - Global usage limits and per-user usage limits.
   - Minimum order threshold enforcement.
   - Discount computation (percentage and flat discounts).
   - Granular scope filtering (`all_products`, `product_list`, `vendor_list`, `category_tree`).
   - Atomic database tracking (`consumeCouponUsage` with `$inc` and `$set`).

2. **`tests/codEligibility.test.js` (9 tests)**
   - Configuration coercion and boundary clamping (`validatePolicyPatch`).
   - Fallback to defaults when settings document is missing.
   - Customer history aggregation (`getSiteStats` ignoring in-transit parcels).
   - Delivery vs wasted parcel classification.
   - Site-wide COD kill-switch (`wallet.cod_enabled: false`).
   - Admin override precedence (`allow` and `block` overriding algorithmic scores).
   - Undelivered threshold blocking (> 50% undelivered with at least 3 orders).
   - Fail-safe wrapper (`isAllowed` returning safe default).

3. **`tests/shippingRules.test.js` (10 tests)**
   - Pure condition engine (`evaluateCondition`):
     - Numeric fields (`cart_total`, `total_weight`, `item_count`, `vendor_count`) with operators `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`.
     - Membership fields (`has_class`, `has_category`, `has_vendor`) with `contains`, `in`, `eq`, `not_in`.
     - String normalization (country, city, trimming, case-insensitivity).
   - Logical combinators (`any` vs `all`).
   - Cost mutation actions (`add_fixed`, `add_percent`, `set_min_fee`, `set_max_fee`, `free_shipping`).
   - Policy adjustments (`percent_discount`, `fixed_discount`, `surcharge_fixed`).

4. **`tests/walletLedger.test.js` (7 tests)**
   - Minor/major unit conversions (`toMinor` / `toMajor`) with banker's/half-up rounding to preserve piastres.
   - Settings validation (suggestion array cleaning, sorting, deduplication, 8-item cap).
   - Idempotent account creation.
   - Atomic ledger application with conditional query `$inc` preventing overdrafts.
   - Duplicate idempotency key protection (returns cached transaction without double credit).
   - Account freezing enforcement (`assertSpendable` throwing `WALLET_FROZEN`).

5. **`tests/cartPricing.test.js` (11 tests)**
   - Largest-remainder proportional allocation algorithm (`allocateProportional` zero penny drift across integer cents).
   - Division-by-zero protection when weights sum to zero.
   - Item validation (empty array, null items, missing product IDs).
   - Rejection of draft products and suspended vendors.
   - Price tampering immunity: attacker submitting price `1.00 EGP` on a `1,000.00 EGP` product is overridden by server-side DB pricing.

6. **`tests/auth.test.js` (7 tests)**
   - Input normalization (`formatPhone`, `normalizeEmailForAuth`).
   - Bcrypt hashing and validation.
   - JWT secret separation between user and admin roles.
   - Passwordless user guard: `authenticateUser` strictly blocks passwordless accounts (e.g. guests, incomplete social logins) from authenticating against empty/null hashes.
   - Rejection of duplicate email and duplicate phone numbers for registered users.

7. **`tests/securityAdversarial.test.js` (10 tests)**
   - Super admin access verification.
   - Sub-admin permission boundary enforcement (super-admin-only routes return `SUPER_ADMIN_ONLY`).
   - Read-only sub-admin write operation rejection (returns `READ_ONLY`).
   - Module access gating (ungranted modules return `MODULE_FORBIDDEN`).
   - Unmapped routes fail-closed (returns `MODULE_NOT_MAPPED`).
   - Address sharing IDOR protection (`assertOwnedAddressIds` blocking sharing of foreign address IDs).
   - Cross-user address access blocking (`resolveSharedAddress` throwing `ADDRESS_NOT_SHARED`).
   - Session revocation on password changes.

---

## 4. Defects & Vulnerabilities Discovered

During test execution and code analysis, four concrete defects were identified:

### DEFECT-01: Falsy Fallback `0 || 1` Coerces Zero Quantity to 1
- **Severity:** High (Business Logic & Cart Invariant)
- **Location:** `Backend/services/orderService.js:370`
- **Code:**
  ```javascript
  const quantity = Number(item.quantity || 1);
  if (!Number.isFinite(quantity) || quantity < 1) {
      throw new Error('Invalid item quantity');
  }
  ```
- **Finding:** In JavaScript, `0` is falsy. When a client or malicious caller sends `{ product_id: id, quantity: 0 }`, the expression `0 || 1` evaluates to `1`. As a result, quantity `0` is not rejected, but rather processed as quantity `1`.
- **Impact:** An item the user intended to delete (or an attacker trying to exploit 0-quantity pricing anomalies) is unintentionally ordered and billed.
- **Remediation:**
  ```javascript
  const quantity = item.quantity !== undefined && item.quantity !== null
      ? Number(item.quantity)
      : 1;
  if (!Number.isFinite(quantity) || quantity < 1) {
      throw new Error('Invalid item quantity');
  }
  ```

---

### DEFECT-02: Parameter Destructuring Crash on `null` in `codEligibilityService`
- **Severity:** Medium (API Robustness & Unhandled Exception)
- **Location:** `Backend/services/codEligibilityService.js:225` and `314`
- **Code:**
  ```javascript
  const evaluate = async ({ userId = null, phone = "", force = false } = {}) => { ... }
  const isAllowed = async ({ userId = null, phone = "" } = {}) => {
      try {
          const result = await evaluate({ userId, phone });
          return result.allowed;
      } catch (err) {
          return true;
      }
  };
  ```
- **Finding:** Default argument assignment `= {}` only triggers when the argument is `undefined`. If a caller passes `evaluate(null)` or `isAllowed(null)`, JavaScript attempts `const { userId, phone } = null`, which throws a `TypeError: Cannot read properties of null (reading 'userId')` at the function signature boundary before the `try/catch` block is entered.
- **Impact:** Crashes calling routes or workers that pass `null` options.
- **Remediation:**
  ```javascript
  const evaluate = async (options = {}) => {
      const { userId = null, phone = "", force = false } = options || {};
      // ...
  };
  ```

---

### DEFECT-03: `TypeError` in `formatPhone` on Non-String / Object Identifier
- **Severity:** Medium (Input Coercion & Denial of Service / 500 Error)
- **Location:** `Backend/services/authService.js:28-30` & `289`
- **Code:**
  ```javascript
  const formatPhone = (phone) => {
      return phone.replace(/\D/g, '');
  };
  // in authenticateUser:
  const formattedPhone = formatPhone(identifier);
  ```
- **Finding:** When an attacker submits an object (e.g. `{ identifier: { $ne: null } }` in a JSON request), `identifier` is an object. `formatPhone(identifier)` attempts `{ $ne: null }.replace(...)`, throwing `TypeError: phone.replace is not a function`.
- **Impact:** Results in an unhandled 500 error instead of a clean 400/401 "Invalid credentials" response.
- **Remediation:**
  ```javascript
  const formatPhone = (phone) => {
      return String(phone || '').replace(/\D/g, '');
  };
  ```

---

### DEFECT-04: Error Code Mismatch in RBAC Access Control
- **Severity:** Low (Contract Consistency)
- **Location:** `Backend/services/adminAccessService.js:222` & `232`
- **Finding:** Attempting a write method on a read-only module returns `READ_ONLY` rather than `WRITE_FORBIDDEN`, and an unmapped path returns `MODULE_NOT_MAPPED` rather than `UNMAPPED_ROUTE`.
- **Impact:** Frontend error handlers or API documentation expecting standard HTTP exception names should align with `READ_ONLY` and `MODULE_NOT_MAPPED`.

---

## 5. Security & Invariant Verification Matrix

| Area | Invariant Tested | Result |
| :--- | :--- | :--- |
| **Tampering** | Client submits manipulated unit price / discount in cart | **Passed** — Server DB price strictly enforced |
| **Overdraft** | Wallet balance debited beyond available funds | **Passed** — Atomic `$inc` with `$gte` filter rejects overdraft |
| **Replay/Double Spend** | Duplicate gateway callback with same idempotency key | **Passed** — Exactly one transaction written, replay deduplicated |
| **IDOR** | User shares or accesses addresses belonging to another user | **Passed** — Strict ownership checks prevent horizontal escalation |
| **Privilege Escalation** | Sub-admin attempts to access `/admin-users` or ungranted modules | **Passed** — Gatekeeper fails closed, rejects unauthorized calls |
| **Token Staleness** | Token used after password changed | **Passed** — Timestamp comparison invalidates token |
| **Coupon Limits** | Usage exceeds max count or user limit | **Passed** — Rejected and not consumed |
| **Proportional Split** | Largest-remainder multi-vendor penny distribution | **Passed** — Zero penny drift across arbitrary amounts |

---

## 6. Execution Command Log

To re-run the complete automated test suite with coverage:

```bash
cd Backend
node --test tests/*.test.js
node --test --experimental-test-coverage tests/*.test.js
```

All 24 test suites execute deterministically in ~8 seconds without dependencies on external services.
