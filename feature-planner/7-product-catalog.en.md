# 7 - Product Catalog (Master Catalog)

> Status: Planned · Created: 2026-08-11
> English edition of [7-product-catalog.md](./7-product-catalog.md). Both files describe the same feature — keep them in sync.

## Overview

Today every vendor creates a fully independent product: title, description, images, category, brand, car compatibility, variations, price, stock. The same oil filter gets written 20 times in 20 different ways, and nothing in the system knows those 20 records are the same product.

This feature separates **"what the product is"** from **"the vendor's offer on it"**. Admins build a **central catalog** holding the product description (title, description, images, category, brand, compatibility, variation types). When a vendor adds a product they search the catalog first: if they find it, they pick it — the data lands pre-filled and they only enter price and stock; if they don't find it, a permanently visible option lets them **add a new product**, which also creates a **suggested catalog entry** for admin review.

The result: vendors add a product in two steps instead of a long form, and the business finally knows **which merchants carry a given product, and at what price**.

## Goal & Success

- **Goal:** Cut the number of steps a vendor takes to list a product, and build a central product-identity layer that makes analytics possible at all.
- **Primary user value:** The vendor picks the product from a ready-made list and enters price and stock — instead of writing a title and description, uploading images, and defining car compatibility from scratch every single time.
- **Success looks like:** No numeric success metric was requested. The working criterion: the share of new products linked to a catalog entry grows over time, and an admin can open any entry and see the list of vendors and their prices.
- **Priority when decisions conflict:** **Vendor speed wins.** If an option improves data cleanliness but adds a step for the vendor, we favour the lower-friction option.

## User Types & Permissions

### Catalog Entry

| Role | Create | View | Edit | Delete | Notes |
| ---- | :----: | :--: | :--: | :----: | ----- |
| Admin | ✅ | ✅ all entries + analytics | ✅ | ⚠️ archive or merge only | Hard delete only for entries with no linked products |
| Vendor | ⚠️ indirectly | ✅ approved + suggested, in search only | ❌ | ❌ | "Add new product" creates a **suggested** entry, not an approved one |
| Customer | ❌ | ❌ | ❌ | ❌ | The catalog is not exposed in the storefront in this release |

### Vendor Product

| Role | Create | View | Edit | Delete | Notes |
| ---- | :----: | :--: | :--: | :----: | ----- |
| Vendor | ✅ | ✅ own products | ✅ **all fields**, including those from the catalog | ✅ | The link persists even after editing |
| Admin | ✅ | ✅ all | ✅ | ✅ | Can also change or remove any product's link to an entry |

_Ownership / role-change rules:_

- **The catalog owns:** title, subtitle, description, images, category, brand, part number, GTIN, car compatibility, and variation types (sizes/colours).
- **The vendor owns:** price, discount, stock, their own SKU, publish status, and the price/stock of each variant.
- **The catalog pre-fills, it does not govern.** Entry data is copied into the vendor's product at creation time only. After that the vendor's product is an independent copy they may edit freely, and the link remains purely for analytics.
- **A catalog entry belongs to the platform** from the moment it is created — even when it was generated from one vendor's data. Vendors are shown a clear notice about this when adding a new product.

## User Journeys

### Single product add (primary path)

- **Entry points:** The "Add product" button in the vendor dashboard → My Products.

- **Happy path:**
  1. The vendor clicks "Add product" → a **full search page** opens (not the form).
  2. They type into the large search field — results appear as cards (image + title + category + brand).
  3. They select an entry → they land on a **condensed form**: a product summary card at the top (image + title + category + "Change product" button), then **Price** and **Stock** only, then a collapsed section "▾ Edit the rest of the details".
  4. They enter price and stock → "Submit for review".
  5. The product enters `pending` like any product, linked to the catalog entry.

- **Alternate paths:**
  - **Not found:** They click the sticky bottom bar "➕ Can't find it? Add a new product" → the existing full form opens → on save: their product is created as usual **and** a **suggested** catalog entry is created and linked to it.
  - **Search returns nothing:** A reassuring message plus a large "Add a new product" button (see States).
  - **Wants to edit catalog data:** They expand "▾ Edit the rest of the details" and change whatever they want — fully permitted, and the link persists.
  - **Already has a product on this entry:** The entry still appears in results, badged "You already have a product on this", and its button becomes "Open your product" instead of "Select" — they cannot create a second one.

- **Exit / confirmation:** The same product-created success message as today. The vendor is given no indication that their product is "linked" — the link is internal.

### Bulk online entry (bulk-entry — the row grid)

- **Entry points:** The existing grid page, with no change to the grid itself.
- **Happy path:**
  1. The "➕ Add row" button opens a **multi-select search popup** (instead of appending a blank row).
  2. The vendor searches and ticks ✅ what they want — they can run several searches and selections accumulate, with a footer counter reading "3 selected".
  3. They click "Add to grid" → each entry becomes its own **pre-filled row**, leaving only price and stock to enter.
  4. Inside the same popup, an "➕ New product" button appends a **blank row** exactly as today.
- **Why a popup rather than a grid cell:** to deliberately interrupt the vendor and force them past the catalog — an extra grid column would simply be ignored. And **multi-select** so a vendor adding 20 products doesn't open and close a popup 20 times.

### Excel upload (bulk-upload)

- **Entry points:** The existing upload page and template — **no new columns**.
- **Happy path:**
  1. The vendor uploads their file unchanged.
  2. A new **"Review links"** screen appears before the final save: the system proposes an entry per row (from part number, brand and title) and shows counters — "45 rows · 38 matched · 7 need you".
  3. Per row: **[Confirm]** / **[Change]** (opens search) / **[New product]**.
  4. **Any field missing from an Excel row is auto-filled from the matched entry** — so a vendor uploading a file with only SKU, price and stock gets the rest from the catalog and the row passes validation.
  5. "Approve all and save" → saving proceeds with the existing per-row success/failure handling.
- **Alternate paths:** Rows marked "New product" create suggested entries — **exactly the same rule as the single-add path**.

### Admin builds and reviews

- **Entry points:** A new top-level sidebar item, **"Catalog"**, next to "Products", with tabs: **All entries** · **Suggestions** (with a count badge) · **Archived**.
- **Happy path (create):** The admin adds an entry with at minimum a title and a category, filling in the rest whenever they can.
- **Happy path (review a suggestion):**
  1. Open the "Suggestions" tab → each suggestion is a card showing its data **alongside automatically computed "similar entries"**, each with its vendor count.
  2. Click **"Merge into this"** → the suggestion is removed and the vendor's product moves to the original entry **silently**.
  3. Or click **"Approve as new entry"** — and they may **edit its data first** (change the title, replace the images, fix the category) before it enters the catalog.
- **Important:** Whichever they choose, **the vendor's product is not changed at all** — only the link is corrected.

## UX & Layout

- **Screen / page structure:**
  - **Search gate (vendor):** A standalone page, a large centred search field, results as cards beneath it. No distractions, and the message is unmistakable: "search first".
  - **Condensed form (vendor):** Product summary card → Price → Stock → collapsed "Edit the rest of the details" → submit button.
  - **Bulk grid:** **Unchanged.** The only difference is that the add-row button opens a popup.
  - **"Review links" screen (Excel):** Counters at the top, then a list of rows, each showing what the vendor wrote ← the proposed entry, with the decision buttons.
  - **Entry page (admin):** Stat cards at the top (vendor count · lowest price · average · highest · total stock · total sales), and beneath them a **vendors table** (vendor · price · stock · product status) sorted by price.

- **Primary actions & button placement:**
  - The **"➕ Can't find it? Add a new product"** option is a **sticky bottom bar** on the search page, visible at all times regardless of results. It is not placed above the results (so vendors look at the catalog first) and not at the end of the list (so it doesn't get lost when there are 50 results).
  - In the popup: "➕ New product" and "Add to grid" sit in a footer bar next to the selection counter.
  - The "Change product" button lives inside the summary card on the condensed form.

- **Navigation placement:** A top-level "Catalog" item in the admin sidebar next to "Products" — deliberately presented as an entity distinct from vendor products, since that separation is the whole point of the feature.

- **Mobile vs desktop:** The full search page and the sticky bottom bar were chosen specifically so they work on mobile without scrolling. The bulk grid and the "Review links" screen remain primarily desktop experiences, as they are today.

- **Cognitive-load notes / simplifications:**
  - The biggest win is **hiding the long form** behind "▾ Edit the rest of the details" — the vendor sees two required fields.
  - The link itself is **completely hidden from the vendor** — no 🔗 badge, no "unlink" button. The link affects them in no way (no auto-updates, no notifications, no editing restrictions), so surfacing it would raise questions and anxiety for no benefit.
  - Suggested entries appear in search results **badged** ("Under review") so vendors understand they aren't approved yet but can still select them.

- **States:**
- **Empty (catalog empty / no results):** A reassuring, positively framed message — "We couldn't find a product by that name — that's completely normal. Add it and it'll be available to everyone from now on" — plus a large "Add a new product" button. It is critical that the vendor doesn't feel they did something wrong or that the site is broken, because this will be the **dominant state for the first few months**.
- **Loading:** Search results load within the results area without the page jumping; the search field stays active and focused.
- **Success:** The existing product-created success messages — no additional catalog messaging.
- **Error:** If search fails technically, show an error with a retry, **and keep the sticky "Add a new product" bar working** — a broken search must never block a vendor from working.
- **Partial / missing data:** Incomplete entries (no images, no description) are accepted; they pre-fill what they have and the vendor completes the rest. Existing publish validations are unchanged (at least one image, one complete language set, universal or explicit compatibility).

## Business Rules

- **Status transitions (catalog entry):**
  - `suggested` → `approved` (admin approved it, and may edit its data before approving)
  - `suggested` → `merged` (removed, its products moved to another entry)
  - `approved` → `archived` (disappears from vendor search; existing links persist)
  - `archived` → `approved` (restore)
  - Hard delete: **only for entries with no linked products**.
- **Status transitions (vendor product):** **No change whatsoever.** A product created from the catalog still goes through `pending` like any other. The catalog saves authoring time, not approval time.
- **Validations:**
  - An entry is accepted with **title + category** only; every other field is optional.
  - **There is no unique identity key** (neither part number nor GTIN is required) — the admin is the arbiter of duplication.
  - **One product per (vendor + entry)** — a vendor cannot create a second one on the same entry and is redirected to their existing product.
  - The vendor may edit **every** catalog-derived field without restriction.
- **Notifications:** **None at all** — not to vendors, not as system notifications. Suggested entries are internal admin work. The only visible signal is a **count badge** on the admin "Suggestions" tab (a UI counter, not a notification).
- **On publish / delete / restore:**
  - **Admin edits an approved entry → no update propagates to linked products.** The edited data affects only products that select that entry afterwards.
  - **Admin merges a suggestion into an existing entry → the products move to the original entry silently**, and their own data is untouched.
  - **Archiving an entry →** it disappears from vendor search; linked products stay live, published, and included in analytics.
  - **A vendor deletes their product →** the entry remains and the vendor count decreases.
- **Concurrent / conflicting actions:**
  - Two vendors add the same missing product simultaneously → two suggestions; the admin merges them.
  - Admin merges a suggestion while the vendor edits their product → no conflict, because merging touches only the link, not the data.
  - A vendor selects an entry while an admin archives it → the product saves and links normally; archiving only blocks new selections.

## Edge Cases

**Rare or invalid operations:**
- A vendor edits a linked product until it becomes something else entirely (picks "oil filter" and turns it into "brake kit"): **the admin catches this during product review** — the review screen shows the linked entry beside the vendor's data, and they can change or remove the link. There is no automatic unlinking.
- A suggested entry was created from a vendor product that was then rejected: the suggestion stays in the review queue and the admin archives it.
- An entry with no linked products: eligible for hard delete.

**Abuse scenarios:**
- A vendor clicks "Add new product" every time to bypass the catalog → floods the admin with suggestions. Mitigation: suggestions appear in vendor search (so others find them), and "similar entries" makes merging cheap. If the behaviour grows, it needs a new decision.
- A vendor edits their data to stand out from other vendors on the same entry: explicitly permitted (the vendor owns their copy) — but it makes a unified customer-facing product page impossible later without revisiting this decision.

**Data-consistency risks:**
- **The biggest risk:** there is no unique identity key, so catalog cleanliness depends entirely on admin attention. The only mitigation is that suggestions surface in vendor search, so duplication is suppressed at the source before it reaches the admin. **This decision should be revisited after the first three months** if the catalog starts filling with duplicates.
- Vendors editing freely means data accumulating under one entry can look inconsistent. Acceptable, because analytics depend on the **link**, not on text matching.
- Legacy products (thousands) and products from unlinked paths stay outside analytics until an admin links them.
- A product linked to an archived entry: still counted in analytics and still shown in the vendors table.

**Permission conflicts:**
- Vendors have no authority over any catalog entry, including one generated from their own data.
- Competitor data and pricing are **never exposed to vendors** — admin only.

## Decision Log

### The catalog pre-fills, it does not govern
- **Decision:** Entry data is copied into the vendor's product at creation time only, and the vendor may edit everything afterwards. Admin edits to an entry **do not propagate** to linked products.
- **Reason:** Prevents any surprise for the vendor or the customer — a published product never changes without its owner knowing. It keeps the link a pure analytics tool rather than a control channel.
- **Alternatives considered:** Update only the fields the vendor never touched; notify the vendor and let them opt in.
- **Impact:** The feature can ship with no merge/conflict logic and no notification screens. The cost: existing products don't improve on their own as the catalog improves.

### Search is a mandatory gate, not an option
- **Decision:** "Add product" opens a full search page before any form. In the bulk grid, "Add row" opens a search popup.
- **Reason:** With two parallel buttons, most vendors would click "from scratch" out of habit, the catalog would stay empty, and the feature would die.
- **Alternatives considered:** Two parallel buttons; a search field above the existing form; a catalog cell inside the grid.
- **Impact:** One extra step for a vendor who already knows their product isn't listed, offset by the always-visible "Add a new product" bar.

### Multi-select popup in the bulk grid
- **Decision:** A single multi-select popup generating one row per selected entry, with the grid itself unchanged.
- **Reason:** The popup interrupts the vendor by force (a grid cell would not), and multi-select avoids the "open and close 20 times" penalty.
- **Alternatives considered:** A search field in every row; one-at-a-time popup; a separate collection screen before the grid.
- **Impact:** Preserves a single mental model across every add path: **every product starts from search**.

### A matching screen after Excel upload, not a new column
- **Decision:** The template is unchanged. After upload, a "Review links" screen proposes an entry per row and the vendor confirms / changes / marks it new. Missing row fields are filled from the matched entry.
- **Reason:** Zero effort in the file plus clean data — and it reduces row failures, since gaps are covered by the catalog.
- **Alternatives considered:** An "entry code" column plus a reference sheet (nobody would use it); silent auto-linking (wrong links would pass unnoticed).
- **Impact:** An entirely new screen in the upload flow. Needs thought for files with hundreds of rows (open question).

### The link is completely hidden from the vendor
- **Decision:** No 🔗 badge, no "unlink" button, no indication anywhere in the vendor's product list.
- **Reason:** The link affects the vendor in no way, so surfacing it would only prompt "what does this mean, and is it bad?" with nothing in return.
- **Alternatives considered:** A small icon; a badge plus an unlink button (which would hand vendors a button that breaks analytics).
- **Impact:** Every decision in this feature must stay invisible to the vendor. The moment we add auto-updates or editing restrictions, this decision must be reversed.

### A suggested entry belongs to the platform
- **Decision:** A suggestion carries the data and images of the vendor who added it and appears to other vendors in search badged "Under review". The admin may edit its data and images at approval time. The originating vendor's product is unchanged and simply stays linked.
- **Reason:** A spare part has no author, and a filter photo comes from the manufacturer anyway. Vendors receive a clear notice at add time that this data will enter the platform catalog.
- **Alternatives considered:** Show suggestions with name and category only, no images; hide suggestions entirely until approved.
- **Impact:** The catalog builds quickly from vendor work from day one. If an image-rights complaint ever arises, this is the decision to revisit.

### Linked entries cannot be deleted
- **Decision:** Archive or merge only. Hard delete is reserved for empty entries.
- **Reason:** A single click could otherwise remove 12 products from analytics (or from the store) — an unjustifiable risk.
- **Alternatives considered:** Delete and orphan the products; cascade delete.
- **Impact:** Historical analytics stay intact no matter how much catalog cleanup happens.

### Analytics are admin-only
- **Decision:** "Which merchants carry this and at what price" is confined to the admin dashboard.
- **Reason:** Exposing competitor pricing (even anonymised) invites a price war, and worse, gives vendors a reason to avoid catalog linking altogether so they don't appear.
- **Alternatives considered:** An anonymised hint to vendors (market average); full transparency.
- **Impact:** The feature stays commercially neutral. Any future opening-up to vendors must be measured against its effect on the linking rate.

## Open Questions

- [ ] Numeric success metric: what share of new products should be catalog-linked, and by when?
- [ ] Legacy products (thousands): how will admins link them in practice? Is an "unlinked" filter enough, or do we need automatic suggestions and bulk linking?
- [ ] The Excel "Review links" screen: how does it behave with a 500-row file? (Grouping, pagination, "auto-approve all matched"?)
- [ ] Languages: must an entry be filled in both Arabic and English, or is one enough? And what happens when the vendor publishes in one language and the entry is in the other?
- [ ] Catalog entries carry car compatibility — how is it handled when the vendor marks the product "universal" but the entry lists specific cars (or vice versa)?
- [ ] The "no unique identity key" decision: when and on what signal do we revisit it? (Proposed: after three months, or once the duplicate rate crosses a threshold.)
- [ ] Suspended or deleted vendors: do their products stay in the vendors table and average calculations, or drop out?
- [ ] Will the catalog ever be exposed to customers (a unified product page listing every vendor)? If so, the "vendors may edit freely" decision must be revisited first.
