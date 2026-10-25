# 1 - User & Vendor Hard Delete

> Status: Planned · Created: 2026-06-21

## Overview

A permanent, non-recoverable ("hard") delete action in the admin dashboard that lets a super-admin completely remove a **user** or **vendor** account — and all of its related data — from the system. It exists for situations where deactivation isn't enough: confirmed fraud or spam, GDPR / data-removal requests, and purging test accounts. Because the action is irreversible and cascades to connected records, it is gated, guarded, logged, and restricted to the highest admin tier.

## Goal & Success

- **Goal:** Give super-admins a reliable way to permanently purge an account and its associated data when soft-delete/deactivation is insufficient.
- **Primary user value:** Admins can fully honor data-removal requests and remove bad actors without leaving orphaned or broken records behind.
- **Success looks like:** A super-admin can permanently delete a deactivated user or vendor in a few clicks; the account and all related records are gone; the action is recorded in the audit log; protected accounts cannot be deleted; and accidental deletions are effectively prevented by the gating and confirmation safeguards.

## User Types & Permissions

| Role | Create | View | Edit | Delete | Notes |
| ---- | :----: | :--: | :--: | :----: | ----- |
| Super-admin | — | ✓ | — | ✓ | Only role that can hard-delete a user/vendor. Cannot delete own account or other admin accounts. |
| Admin (non-super) | — | ✓ | — | ✗ | Can view accounts but the hard-delete action is hidden/disabled. |
| Vendor | — | — | — | ✗ | Subject of deletion; no access to this feature. |
| User | — | — | — | ✗ | Subject of deletion; no access to this feature. |

_Ownership / role-change rules:_ Admin and super-admin accounts are protected and can never be hard-deleted through this feature. Self-deletion is blocked.

## User Journeys

- **Entry points:** The individual user/vendor **account detail page** in the admin dashboard, within a dedicated "Danger Zone" section.
- **Happy path:**
  1. Super-admin opens the detail page of an account that has already been **soft-deleted / deactivated**.
  2. In the "Danger Zone" section, they click **Permanently delete account**.
  3. A modal opens showing a clear warning plus an **impact preview** — exactly what will be removed (e.g. "this vendor and their 12 ads, 4 reviews, 30 messages").
  4. The admin **types the account's name/email (or the word DELETE)** to enable the final delete button.
  5. They click delete; the button shows a spinner and disables while the cascade runs (all-or-nothing).
  6. On success, the modal closes, the admin is redirected to the users/vendors list, and a confirmation toast appears ("Account permanently deleted").
- **Alternate paths:**
  - Account is **not yet soft-deleted** → hard-delete action is unavailable; admin must deactivate first.
  - Account is **protected** (admin/super-admin or self) → action hidden/blocked with an explanatory message.
  - Admin cancels the modal → nothing happens.
  - Delete **fails or rolls back** → inline error in the modal, admin can retry or cancel.
- **Exit / confirmation:** Redirect to the list view with a success toast; the deleted record no longer appears.

## UX & Layout

- **Screen / page structure:** A clearly separated, visually distinct "Danger Zone" section at the bottom of the account detail page. The destructive action is intentionally placed away from common/quick-click controls.
- **Primary actions & button placement:** A single **Permanently delete account** button in the Danger Zone. Clicking opens a **modal dialog** containing: the warning, the per-record impact preview with counts, the type-to-confirm field, and the final (initially disabled) delete button alongside a cancel button.
- **Navigation placement:** Reached via the existing users/vendors management list → account detail. No new top-level nav item.
- **Mobile vs desktop:** Primarily a desktop admin workflow; the modal and Danger Zone should remain usable and legible on smaller screens.
- **Cognitive-load notes / simplifications:** Three deliberate friction points — (1) must be deactivated first, (2) type-to-confirm, (3) explicit impact preview — are intentional for an irreversible action. The impact preview converts an abstract "this is permanent" into concrete, informed consent.

## States

- **Empty:** N/A for the action itself; if an account has no related records, the impact preview shows just the account (no counts).
- **Loading:** Delete button shows a spinner and is disabled to prevent double-submission; the modal stays open until the cascade completes.
- **Success:** Modal closes, redirect to the users/vendors list, confirmation toast ("Account permanently deleted"); deleted record removed from the list.
- **Error:** Inline error message inside the modal with a clear reason (e.g. "Cannot delete: admin accounts are protected" or "Delete failed — nothing was removed"); admin can retry or cancel. Because deletes are all-or-nothing, a failure leaves the account fully intact.
- **Partial / missing data:** Not a permitted end state — partial cascade failures roll back entirely (see Business Rules). If impact counts can't be loaded, show the generic permanent-deletion warning rather than blocking.

## Business Rules

- **Status transitions:** `active` → (soft-delete/deactivate) → `deactivated` → (hard delete) → **permanently removed**. Hard delete is only available from the `deactivated` state.
- **Validations:**
  - Requester must be a super-admin.
  - Target must already be soft-deleted/deactivated.
  - Target must not be a protected account (admin/super-admin) and must not be the requester themselves.
  - Type-to-confirm input must match before the delete button enables.
- **Notifications:** No notification is sent to the deleted account holder. Every hard delete is written to an **admin audit log** capturing who deleted whom and when.
- **On publish / delete / restore:**
  - **Delete = cascade:** permanently removes the account **and all related records** — ads/listings, orders, reviews, transactions, messages, and any other connected data.
  - There is **no restore** — the action is irreversible by design.
  - Any **active session** for the deleted account is invalidated immediately (force-logout on next action).
  - The account's **email/identifier is freed** and may be used for a fresh registration.
- **Concurrent / conflicting actions:** The delete is **all-or-nothing** — if any part of the cascade fails, the entire operation rolls back and nothing is deleted. (Concurrent edits to the same account during deletion are resolved in favor of the all-or-nothing transaction; see Open Questions for fine-grained locking.)

## Edge Cases

- Rare or invalid operations:
  - Attempting to hard-delete an account that was never soft-deleted → blocked.
  - Attempting to delete a protected admin/super-admin or one's own account → blocked.
  - Two admins acting on the same account simultaneously → all-or-nothing transaction prevents partial state.
- Abuse scenarios:
  - A malicious or compromised admin mass-deleting accounts → mitigated by super-admin-only access, the soft-delete gate, type-to-confirm, and the audit log. (Re-registration of freed emails is allowed — see Open Questions on whether known-bad emails should be blocklisted.)
- Data-consistency risks:
  - **Cascade removes shared history** — e.g. a buyer's order tied to a deleted vendor is also deleted. Accepted tradeoff per product decision.
  - Partial cascade failure leaving orphans → prevented by all-or-nothing rollback.
- Permission conflicts:
  - Non-super admins must not see or trigger the action.
  - Self-deletion and admin-on-admin deletion are explicitly disallowed.

## Decision Log

### Cascade delete all related data
- **Decision:** Hard delete permanently removes the account and every connected record (ads, orders, reviews, transactions, messages).
- **Reason:** Produces a clean, complete removal suitable for fraud purges and full data-removal requests.
- **Alternatives considered:** Block delete while related records exist (safest, keeps history); anonymize and reassign records to a "Deleted user/vendor" placeholder (preserves history).
- **Impact (UX / product / future):** Most destructive option — wipes shared history such as a buyer's order tied to a deleted vendor. Revisit if buyer-side history needs to be preserved; anonymization is the natural fallback.

### Super-admin-only access
- **Decision:** Only super-admins can hard-delete accounts.
- **Reason:** Restricts an irreversible, high-blast-radius action to the most trusted tier.
- **Alternatives considered:** Any admin (simpler, riskier); single-tier admin system.
- **Impact:** Requires a super-admin role distinction in the admin system.

### Soft-delete gate before hard delete
- **Decision:** An account must be deactivated/soft-deleted before it can be hard-deleted.
- **Reason:** Adds a deliberate two-step safety barrier against impulsive permanent deletion.
- **Alternatives considered:** Independent hard delete (one step); no soft delete at all.
- **Impact:** Assumes a soft-delete/deactivation state already exists or will exist.

### Type-to-confirm safeguard
- **Decision:** Admin must type the account name/email (or DELETE) to enable the final delete.
- **Reason:** Strong guard against accidental clicks for an irreversible action.
- **Alternatives considered:** Simple yes/cancel dialog; confirm + mandatory reason field.
- **Impact:** Slightly more friction; greatly reduces accidental deletions.

### No holder notification, but audit-logged
- **Decision:** Don't notify the deleted account holder; record the action in an admin audit log.
- **Reason:** Notifying a removed account adds little value; accountability is preserved via the log.
- **Alternatives considered:** Email the account holder; no logging at all.
- **Impact:** Requires an admin audit log capability.

### All-or-nothing execution
- **Decision:** If any part of the cascade fails, roll back entirely — nothing is deleted.
- **Reason:** Prevents half-deleted, broken accounts and orphaned data.
- **Alternatives considered:** Best-effort with a leftovers report.
- **Impact:** A failure leaves the account fully intact; admin retries cleanly.

### Force-logout & free the email
- **Decision:** Invalidate the deleted account's active sessions immediately; free its email for reuse.
- **Reason:** Clean break for a removed account; true hard delete releases the identifier.
- **Alternatives considered:** Let sessions expire naturally; blocklist the email to prevent re-registration.
- **Impact:** A previously deleted (possibly fraudulent) user can re-register with the same email — see Open Questions.

## Open Questions

- [ ] Should known-bad / fraudulent emails be added to a blocklist to prevent re-registration, despite the general "email is freed" rule? (Selected default frees the email.)
- [ ] What is the exact, complete list of related record types the cascade must cover (confirm nothing connected is missed: ad requests, fares/payments, slider/featured placements, etc.)?
- [ ] Should the type-to-confirm value be the account's email, name, or a fixed word like DELETE? (Pick one for consistency.)
- [ ] Do we want an optional reason field captured in the audit log even though notifications are off?
- [ ] Locking behavior for an account being edited by another admin at the moment of deletion (beyond all-or-nothing rollback)?
- [ ] Any data-retention or legal requirement to keep certain records (e.g. financial/transaction records) even on hard delete?
