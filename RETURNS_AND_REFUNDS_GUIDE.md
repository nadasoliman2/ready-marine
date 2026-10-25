# ReadyCar — Returns & Refunds Module

## Complete Guide for Customers, Vendors & Admins

---

## Table of Contents

1. [Overview](#1-overview)
2. [Return Policy](#2-return-policy)
3. [The Complete Flow at a Glance](#3-the-complete-flow-at-a-glance)
4. [For Customers](#4-for-customers)
5. [For Vendors](#5-for-vendors)
6. [For Admins](#6-for-admins)
7. [Refund Calculation](#7-refund-calculation)
8. [Status Reference](#8-status-reference)
9. [Frequently Asked Questions](#9-frequently-asked-questions)

---

## 1. Overview

The Returns & Refunds module allows customers to request returns on delivered orders, vendors to review those requests, and admins to make final decisions and process refunds.

**Key principles:**
- Returns are handled **per item**, not per entire order.
- Each return request covers items from **one vendor only**. If a customer needs to return items from multiple vendors, they create separate return requests.
- Every return goes through a **two-step review**: first the vendor, then the admin.
- Refunds are processed **manually** by the admin (via Fawaterak dashboard for card payments, or bank transfer for cash-on-delivery orders).

---

## 2. Return Policy

| Rule | Detail |
|------|--------|
| **Return window** | 14 days from the date the order was delivered |
| **Eligible orders** | Only orders with status **"Completed"** |
| **Eligible items** | Only items that were **approved** during the order supervision phase |
| **Condition** | Products must be in their original condition with original packaging |
| **Evidence required** | Photo/video evidence is **mandatory** for: Defective, Wrong Item, Not as Described |
| **Evidence optional** | Changed Mind, Other |
| **Partial returns** | Customers can return some items from an order, or even a partial quantity of a single item (e.g., 2 out of 5 units) |

### Fault Types

| Fault Type | Who bears shipping cost | Refund scope |
|------------|------------------------|--------------|
| **Vendor Fault** (defective, wrong item) | Vendor — shipping cost is included in refund | Full item refund + proportional shipping |
| **Customer Fault** (changed mind) | Customer — shipping cost is NOT refunded | Item refund only, no shipping |

---

## 3. The Complete Flow at a Glance

```
CUSTOMER                    VENDOR                     ADMIN
────────                    ──────                     ─────
1. Creates return     ───>  2. Reviews request
   request                     (approve/reject)  ───>  3. Final review
                                                          (approve/reject + set fault type)
                                                       4. Creates return shipment (Bosta)
                                                          OR vendor/admin confirms
                                                          receipt directly
CUSTOMER                    VENDOR
────────                    ──────
5. Bosta picks up     <───  6. Receives returned
   items from customer         goods & confirms

                                                       ADMIN
                                                       ─────
                                                       7. Creates refund
                                                          (calculates amount)
                                                       8. Processes refund externally
                                                          (Fawaterak / bank transfer)
                                                       9. Marks refund as completed

CUSTOMER
────────
10. Receives refund
```

---

## 4. For Customers

### 4.1 How to Request a Return

1. **Go to your Dashboard** > **Returns** page, or navigate from your order.
2. **Click "Return Request"** and select the order you want to return items from.
   - Direct URL: `/profile/returns/request/[orderId]`
3. **Select the items** you want to return by checking the checkboxes next to each item.
   - You can adjust the **quantity** if you only want to return some units.
   - All selected items must be from the **same vendor**. If you need to return items from different vendors, submit separate requests.
4. **Choose a reason** for the return:
   - **Defective Product** — The item arrived broken or doesn't work
   - **Wrong Item Received** — You received a different item than what you ordered
   - **Not as Described** — The item doesn't match the product listing
   - **Changed Mind** — You no longer want the item
   - **Other** — Any other reason
5. **Upload evidence photos** (required for Defective, Wrong Item, Not as Described).
   - Take clear photos showing the issue.
   - You can upload multiple photos.
6. **Add details** (optional) — Describe the problem in your own words.
7. **Submit** the return request.

### 4.2 What Happens After You Submit

| Step | What happens | What you see |
|------|-------------|--------------|
| 1 | Your request is sent to the vendor | Status: **Pending Vendor Review** |
| 2 | Vendor approves or rejects, then admin reviews | Status: **Pending Admin Review** |
| 3a | If approved, a return shipment may be scheduled | Status: **Return Shipping** — Bosta will pick up from your address |
| 3b | If rejected | Status: **Rejected** — You'll see the reason |
| 4 | Goods received by vendor | Status: **Return Received** |
| 5 | Admin creates and processes refund | Status: **Refund Processing** |
| 6 | Refund issued | Status: **Completed** |

### 4.3 Cancelling a Return

- You can **cancel** a return request **only** while it's still in **"Pending Vendor Review"** status.
- Once the vendor has reviewed it, cancellation is no longer possible.
- To cancel: go to the return detail page and click **"Cancel Return Request"**.

### 4.4 Tracking Your Return Shipment

- Once a return shipment is created, you'll see the **Bosta tracking number** on the return detail page.
- The tracking status updates automatically.

### 4.5 How You Receive Your Refund

| Original payment method | How you get refunded |
|------------------------|---------------------|
| **Credit Card / Wallet** (via Fawaterak) | Refunded to the same payment method. May take a few business days. |
| **Cash on Delivery** | Refunded via **bank transfer**. The admin will process this manually. |

### 4.6 Where to Find Your Returns

- **Dashboard** > **Returns** — shows all your return requests with their current status.
- Click any return to see full details, evidence, tracking, and history timeline.

---

## 5. For Vendors

### 5.1 How You Get Notified

- When a customer requests a return on one of your items, you'll receive an **in-app notification** in your dashboard.
- The notification shows the return number, customer name, items, and reason.

### 5.2 Viewing Return Requests

- Go to **Dashboard** > **Returns**.
- You'll see a banner if you have pending returns awaiting your review.
- Filter by status to focus on what needs attention.

### 5.3 Reviewing a Return Request

1. Click on the return request to open the detail page.
2. Review the customer's:
   - **Items** being returned (product, quantity, price)
   - **Reason** for the return
   - **Evidence photos** (if provided)
   - **Additional details** from the customer
3. **Make your decision:**
   - **Approve** — You agree the return is valid. Click "Approve".
   - **Reject** — You believe the return is not valid. Enter a **reason for rejection** (required), then click "Reject".

> **Important:** Your decision is not final. After you review, the request is **automatically escalated to the admin** for a final decision. The admin sees your decision and notes.

### 5.4 Confirming Receipt of Returned Goods

- When the customer ships the items back, and you physically receive them:
  1. Go to the return detail page.
  2. Click **"Confirm Goods Received"**.
- This confirms to the admin that the items are back and a refund can be processed.

### 5.5 Impact on Your Earnings

- When a refund is completed, the **commission on the refunded items is reversed**.
- You'll receive an in-app notification showing the commission adjustment amount.
- The reversal is reflected in your vendor supervision totals for that order.

### 5.6 What You Cannot Do

- You **cannot** approve or reject a return after the admin has reviewed it.
- You **cannot** process refunds — only the admin handles refund creation and processing.
- You **cannot** cancel a customer's return request.

---

## 6. For Admins

### 6.1 Dashboard Overview

- Go to **Admin Dashboard** > **Returns & Refunds** in the sidebar.
- The returns list shows all return requests with:
  - Filters: status, vendor, search by return number
  - Stats badges showing counts by status
  - Link to the **Refunds** page

### 6.2 Reviewing Return Requests

1. Open a return request from the list.
2. Review:
   - **Items** being returned
   - **Customer's reason** and evidence
   - **Vendor's review** (approved/rejected with notes)
3. **Make the final decision:**
   - **Approve:**
     - Select the **Fault Type**: "Vendor Fault" or "Customer Fault"
     - This determines whether shipping costs are included in the refund
     - Add optional notes
   - **Reject:**
     - The return is closed
     - The customer sees it as "Rejected"
     - The order items' return status resets to normal

### 6.3 Managing Return Shipping

After approving a return, you have two options:

**Option A: Create a Bosta return shipment**
1. Click **"Create Return Shipment"** on the return detail page.
2. Bosta creates a reverse delivery: picks up from customer's address, delivers to vendor's address.
3. Track the shipment status via the **"Refresh Tracking"** button.
4. When Bosta confirms delivery, the status auto-advances to "Return Received".

**Option B: Confirm receipt directly**
- If the vendor or customer handles the return shipping externally (e.g., in-person drop-off), click **"Confirm Receipt"** to skip the Bosta step.

### 6.4 Creating a Refund

**Prerequisites:**
- Return status must be **"Return Received"** or **"Approved"**
- Fault type must be set (not "Undetermined")
- No existing refund for this return

**Steps:**
1. On the return detail page, scroll to the **"Create Refund"** section.
2. Optionally set a **Restocking Fee** (deducted from the refund amount). Default is 0.
3. Add optional notes.
4. Click **"Create Refund"**.

The system automatically calculates:
- Item refund amounts (proportional to quantity returned)
- Coupon discount reversal (proportional)
- Shipping refund (only for vendor_fault)
- Commission reversal

### 6.5 Processing a Refund

After creating a refund, you need to **process it externally** then confirm in the system:

**Step 1: Start Processing**
- Go to the refund detail page (linked from the return page, or from **Admin > Refunds**).
- Click **"Start Processing"**.
- The system tells you how to process based on the payment method.

**Step 2: Process externally**

| Original Payment | What to do |
|-----------------|-----------|
| **Credit Card / Wallet** | Go to the **Fawaterak dashboard**, find the original invoice, and issue a refund for the calculated amount. |
| **Cash on Delivery** | Process a **bank transfer** to the customer's bank account for the refund amount. |

**Step 3: Mark as Completed**
- Come back to the refund detail page.
- For bank transfers: enter the bank details (bank name, account holder, account number).
- Click **"Confirm Completed"**.

**If the refund fails:**
- Click **"Failed"**, enter the failure reason.
- You can then retry by clicking **"Retry Processing"**.

### 6.6 What Happens When a Refund is Completed

The system automatically:
1. Marks the return request as **"Completed"**
2. Updates the order items' return status to **"Refunded"**
3. **Reverses the commission** on the vendor's supervision (reduces their total_amount and total_commission)
4. If **all items** in the order are refunded, marks the order transaction as **"Refunded"**
5. **Restocks inventory** — increments product variant stock and decrements sold_count
6. **Notifies the vendor** about the commission adjustment

### 6.7 Refunds List

- Access via **Admin > Returns & Refunds > View Refunds** button, or directly at `/admin/dashboard/refunds`.
- Filter by status: Pending, Processing, Completed, Failed.
- Each refund shows: refund number, linked return, customer, vendor, amount, method, status.

### 6.8 Analytics

- Available at the **Returns & Refunds** page via the admin API.
- Shows: total refunds, total amount refunded, commission reversed, refunds by status, top return reasons.

---

## 7. Refund Calculation

The refund amount is calculated automatically by the system. Here's exactly how it works:

### 7.1 Per-Item Calculation

For each item being returned:

```
Line Total = quantity_returning x unit_price
```

### 7.2 Coupon Discount Reversal

If the original order had a coupon discount:

```
Item's Full Total = quantity_purchased x unit_price
Item's Discount Share = (Item's Full Total / Eligible Subtotal) x Total Discount
Returning Discount Share = Item's Discount Share x (quantity_returning / quantity_purchased)
```

The customer is refunded what they **actually paid** (after discount), not the full list price.

### 7.3 Effective Refund

```
Effective Refund = Line Total - Returning Discount Share
```

### 7.4 Shipping Refund (Vendor Fault Only)

If the fault type is **"Vendor Fault"**, the customer also gets a proportional share of the shipping cost back:

```
Shipping Share = Vendor's Shipping Cost x (Line Total / All Vendor Items Total)
```

If the fault type is **"Customer Fault"**, shipping share = 0.

### 7.5 Commission Reversal

The platform's commission on the refunded amount is also reversed:

```
Commission Reversal = Effective Refund x (Commission Rate / 100)
```

This reduces the vendor's commission for that order.

### 7.6 Final Refund Amount

```
Total Refund = Sum of (Effective Refund + Shipping Share) for all items - Restocking Fee
```

### 7.7 Example

| | Value |
|---|---|
| Item price | 500 EGP |
| Quantity purchased | 2 |
| Quantity returning | 1 |
| Order coupon discount | 100 EGP (on total order of 1000 EGP) |
| Commission rate | 10% |
| Vendor shipping cost | 60 EGP |
| Fault type | Vendor Fault |

**Calculation:**
- Line Total = 1 x 500 = **500 EGP**
- Item's full total = 2 x 500 = 1000
- Item's discount share = (1000 / 1000) x 100 = 100
- Returning discount share = 100 x (1/2) = **50 EGP**
- Effective refund = 500 - 50 = **450 EGP**
- Shipping share = 60 x (500 / 1000) = **30 EGP**
- Commission reversal = 450 x 0.10 = **45 EGP** (deducted from vendor earnings)
- **Total refund to customer = 450 + 30 = 480 EGP**

---

## 8. Status Reference

### 8.1 Return Request Statuses

| Status | Meaning | Who acts next |
|--------|---------|--------------|
| **Pending Vendor Review** | Waiting for vendor to review | Vendor |
| **Vendor Approved** | Vendor agreed (auto-escalates) | System/Admin |
| **Vendor Rejected** | Vendor disagreed (auto-escalates) | System/Admin |
| **Pending Admin Review** | Waiting for admin's final decision | Admin |
| **Approved** | Admin approved the return | Admin (ship or confirm) |
| **Rejected** | Admin rejected — return closed | No one (final) |
| **Return Shipping** | Bosta pickup in progress | Bosta/System |
| **Return Received** | Goods received by vendor | Admin (create refund) |
| **Refund Processing** | Refund has been created, awaiting processing | Admin |
| **Completed** | Refund issued — return closed | No one (final) |
| **Cancelled** | Customer cancelled the request | No one (final) |

### 8.2 Refund Statuses

| Status | Meaning | Who acts next |
|--------|---------|--------------|
| **Pending** | Refund created, not yet started | Admin |
| **Processing** | Admin is processing externally | Admin |
| **Completed** | Refund issued to customer | No one (final) |
| **Failed** | Processing failed, can be retried | Admin |

### 8.3 Order Item Return Statuses

Each item in an order tracks its own return progress:

| Status | Meaning |
|--------|---------|
| **none** | No return requested |
| **return_requested** | Customer submitted a return for this item |
| **return_approved** | Admin approved the return |
| **return_in_progress** | Return shipment is in transit |
| **returned** | Item received back by vendor |
| **refunded** | Refund completed for this item |

---

## 9. Frequently Asked Questions

### For Customers

**Q: Can I return part of my order?**
A: Yes. You can select specific items and even partial quantities to return.

**Q: What if my order has items from different vendors?**
A: Create a separate return request for each vendor. The system enforces this — you'll see a message if you try to mix vendors.

**Q: Can I cancel my return request?**
A: Only while it's still "Pending Vendor Review". After the vendor reviews it, you cannot cancel.

**Q: How long does the refund take?**
A: After the admin completes the refund, credit card refunds may take 3-7 business days to appear. Bank transfers depend on the bank.

**Q: What if I missed the 14-day window?**
A: The system will not allow you to create a return request after 14 days from delivery. Contact support for exceptional cases.

**Q: Do I get shipping costs back?**
A: Only if the return is due to a vendor fault (defective product, wrong item). If you changed your mind, shipping costs are not refunded.

---

### For Vendors

**Q: Can I override the admin's decision?**
A: No. The admin has the final say. Your review is advisory — it helps the admin make an informed decision.

**Q: What if I disagree with the admin's approval?**
A: Contact the admin team directly. The system records your rejection notes so the admin can see your perspective.

**Q: Does a refund affect my existing commission?**
A: Yes. The commission on the refunded items is reversed (reduced from your total). You'll receive a notification showing the exact amount.

**Q: Do I need to restock the returned items manually?**
A: No. The system automatically restocks the product variant inventory and adjusts the sold count when the refund is completed.

---

### For Admins

**Q: Can I create a refund without a return shipment?**
A: Yes. You can approve a return, then "Confirm Receipt" directly (skipping Bosta), and then create the refund. This is useful for in-store returns or when the vendor already has the items.

**Q: What if Fawaterak doesn't have a refund button for this invoice?**
A: Process the refund through whatever method is available (manual bank transfer, store credit, etc.), then mark it as completed in the system with notes about how it was processed.

**Q: Can I adjust the refund amount?**
A: You can set a **restocking fee** when creating the refund, which reduces the total. The rest of the calculation is automatic and based on the actual prices/discounts from the original order.

**Q: What happens if I mark a refund as "Failed"?**
A: The return stays in "Refund Processing" status. You can click "Retry Processing" to try again. The customer is not affected until you mark it as "Completed".

**Q: Can a customer submit multiple returns on the same order?**
A: Yes, as long as the items haven't already been returned. The system tracks returned quantities per item and prevents duplicate returns.

---

## Navigation Quick Reference

| Role | Page | URL |
|------|------|-----|
| Customer | My Returns | `/profile/returns` |
| Customer | Create Return | `/profile/returns/request/[orderId]` |
| Customer | Return Detail | `/profile/returns/[id]` |
| Vendor | Return Requests | `/dashboard/returns` |
| Vendor | Return Detail | `/dashboard/returns/[id]` |
| Admin | Returns List | `/admin/dashboard/returns` |
| Admin | Return Detail | `/admin/dashboard/returns/[id]` |
| Admin | Refunds List | `/admin/dashboard/refunds` |
| Admin | Refund Detail | `/admin/dashboard/refunds/[id]` |

---

*This document covers the ReadyCar Returns & Refunds module as implemented. For technical details or API documentation, refer to the codebase or contact the development team.*
