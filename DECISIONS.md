# DECISIONS.md — the redesign ledger

What was decided for each screen, and what was left out and why. `DESIGN.md`
says how the panel looks; this says what we chose.

**The rule the whole run follows:** this API accepts parameters and silently
ignores them. Five `orderby` values on `/products` once returned byte-identical
results. So a control ships only when someone measured it working — anything
unverified is treated as broken, and its absence is recorded here rather than
left looking like an oversight.

---

## Checklist — 41 route pages

```
[x]  0. Harness — mock API + capture script
[x]  1. Orders — list        (inherited; merged before this run)
[x]  2. Products — list
[x]  3. Orders — detail
[x]  4. Products — detail + form
[x]  5. Customers — list + detail
[x]  6. Inventory — list + detail + ledger
[ ]  7. Coupons — list + form        (mock done, screens not built)
[ ]  8. Shipping
[ ]  9. Payments
[ ] 10. Dashboard
[ ] 11. Analytics — revenue / orders / products / customers / shipping / COD
[ ] 12. Content — pages, page form, banners, FAQs, homepage, menus, index
[ ] 13. Media
[ ] 14. Marketing — campaigns, composer, segments, config, templates
[ ] 15. Notifications — list + detail
[ ] 16. Staff — list, detail, new
[ ] 17. Settings
[ ] 18. Transfer
[ ] 19. Audit
[ ] 20. Login + not-found
[ ] 21. TEARDOWN
```

Progress check that does not depend on this list: a file with no `ui-` prefix in
its classNames is not migrated. `grep -rL 'ui-' --include=*.tsx app/` — **94
files left.**

---

## Standing rules these six pages established

Apply these to every remaining screen unless something measured says otherwise.

| Rule | Why |
| --- | --- |
| **Sorting ships only with a positive control.** Products only. | Two values agreeing *with each other* proves nothing. Orders, customers and inventory ship none. |
| **A peek drawer is a judgement, not a default.** | Free only when `GET /{id}` returns the list row exactly. Orders and products yes; customers, inventory, coupons no. |
| **A detail screen's primary action goes in `PageHeader`.** | Below `lg` the aside drops beneath a variable-length list. |
| **A long form's save is a sticky bar that appears when dirty.** | §3.4 legislates it separately from the header rule. |
| **No bulk write without a measured endpoint.** | `POST /products/bulk` and `/inventory/bulk` are both refused by the allowlist and asserted refused in tests. |
| **A control that cannot act is not rendered.** | Same principle the nav uses for capabilities. |
| **Copy never names a screen or action that does not exist.** | Three such strings were found and fixed; one had just been written. |

---

## 0. Harness

The thing every screen is verified with. The e2e suite needs live credentials
nobody has here, and a passing `next build` proved insufficient — a previous
session shipped a broken stylesheet past a green build.

- `scripts/mock-api.mjs` — dependency-free `node:http` shop API, seeded and
  deterministic so screenshots are stable.
- `scripts/capture.mjs` — mints a session cookie, starts the mock and the built
  panel, drives Chromium through every route at 340/768/1440 × light/dark ×
  fr/ar. Asserts zero console errors, no horizontal overflow, that the
  stylesheet loaded, that Plex resolved, and that **light and dark compute
  different backgrounds**.
- `tests/mock-api.test.ts` — parses every mocked response with the real Zod
  schema and the real `unwrap()`, and fails if a schema is neither exercised nor
  listed `UNCOVERED` with a reason.

**It reproduces the API's dishonesty on purpose.** `orderby` is accepted and
ignored where the live router ignores it, so nobody can verify a sort against
the harness and ship one that does nothing.

**Proof it works:** with the dark token block disabled, all 12 per-capture
assertions passed. Only the cross-capture light-vs-dark comparison caught it.

---

## 1. Orders — list *(inherited)*

- `DataTable` at `md`+, `RecordList` below, one column definition feeding both.
- Filters: status tabs and search, both measured. Sorting: none.
- Bulk: export only, client-side from rows in memory.
- Peek drawer at `?peek=id` — free, both routes return the same object.
- Polls at 30s, paused when hidden. Reads are 600/min shared across tabs.

---

## 2. Products — list

- Nine filter dimensions: status tabs and search in the toolbar, the other seven
  in a `Drawer` with draft-then-apply, so one refetch per intent rather than one
  per checkbox. Chips are one per **value**.
- **Sorting ships here and nowhere else** — five combinations were re-measured
  after a backend repair. Name ascending only; nobody ever measured `title desc`.
- Bulk: export only. `POST /products/bulk` does not exist in any verifiable form.
- Omitted: thumbnail column (every product has `image: null`), separate SKU box,
  create action (`POST /products` is not allowlisted).

**Four defects fixed in `DataTable`, all already live on Orders:** sortable
headers losing their uppercase; `aria-sort` announcing sortability on columns
nothing could sort; the column picker and density toggle rendering below `md`
where `RecordList` — which takes neither prop — is what shows; and 51px rows
against the 48px spec. Also added the sticky first column §3.2 always specified.

---

## 3. Orders — detail

Sets the detail patterns for ~20 later screens.

- Two-column at `lg`+: main `1fr` + 360px aside, aside **below** main on
  collapse. Built `DetailGrid`, `Card`/`DataList`/`DataRow`, `CardSkeleton`,
  `PageBody width="split"`. Flex, not grid — an arbitrary value fails the build.
- Main: items, timeline, notes, parcels, payments. Aside: status, dates,
  customer, COD.
- Status picker is a `Menu`; destructive moves go through `ConfirmDialog`. The
  panel holds no transition table — the API is the authority and its 409 says
  what is legal.
- Omitted: the line-item editor (contract never measured), a Cancel button
  (`/orders/{id}/cancel` is not allowlisted), `stock_reduced`, `needs_payment`.

**Fixed panel-wide:** focus restoration. Radix restores focus to
`Dialog.Trigger`, which no overlay here renders, so Escape dropped focus to
`<body>` from every Modal, Drawer and ConfirmDialog in the app.

**DESIGN.md §2.2/§2.4 amended** — they put the breadcrumb in a top bar that is
`lg:hidden`, so at `lg`+ the screen had no way back to the list.

---

## 4. Products — detail + form

- `DetailGrid`, editable body in main, publication and categories in the aside,
  sticky save bar when dirty.
- Categories and SEO became writable; SEO always sends the **complete** object
  because partial behaviour is unmeasured.
- Omitted: options editor (every spec number unmeasured), media picker (Product
  Managers are 403 on `/media`), variation and attribute writes (attributes wipe
  every variation's attribute map), `sale_price <= regular_price` (nothing
  measured whether the API rejects it).

**The `options_problems` banner was lying** — it warned that saving destroys the
broken option groups, but the form never sends `options`. The copy was fixed
rather than the screen, because the alternative was a price edit silently
deleting option groups as a side effect.

**`.ui-tap::after` had its LTR/RTL transforms swapped**, so every icon button in
the panel had its 44px hit area entirely on one side. Caught by the harness's
overflow assertion; invisible to build, lint and tests.

**The form layer was not a superset of the one it replaced.** `Form.tsx` had
dropped `Field.tsx`'s hydration guard — which exists because a keystroke landing
before hydration silently loses the edit, measured on WebKit on this screen — and
lost `Select<T>`'s generic, which gives 17 screens compile-time proof a value is
in its option union. Both restored, plus `DateField`, `ReadOnlyField`,
blur-then-change validation, `ErrorSummary` and `SaveBar`. Also: every control
was 36px on touch against the 44px §3.4 and §5 both require.

---

## 5. Customers — list + detail

- List: search only, and the absence is the design — that is the entire measured
  parameter set. Detail: `DetailGrid`, report and orders in main, identity and
  consent in the aside.
- **No peek** — the detail is the row plus `statistics`, which is exactly what
  you would open a preview for. The identifying cell is a real anchor instead.
- **Sorting removed after a first draft shipped it.** Nothing records a positive
  control. `query.ts`'s prose was corrected — it recorded two values as
  byte-identical *to each other* without noting that proves neither works.
- Statistics render as scope-labelled rows, not a 4-up stat block: `total_orders`
  beside `total_revenue` invites arithmetic the API does not do.
- Omitted: any write, a row-actions menu, tabs, `StatGroup`/`Stat`.

**Fixed in primitives:** money values clipping mid-number at 340px in `DataRow`
("7 100,0" for "7 100,00 DA" — a wrong number, not an ugly one), and
`SearchField` using a drop shadow where §3.4 specifies a focus ring.

**DESIGN.md §3.7 amended** — the stale marker is required where data can age,
which is not every screen. A Server Component with no writes, no polling and no
refresh cannot hold data older than its own navigation.

---

## 6. Inventory — list + detail + ledger

- Ledger moved to its own route `/inventory/movements` — different data, own
  filters, own page size. No nav entry; reached from the list header and each
  item.
- Low stock stays a tab, but it is a different endpoint taking pagination only,
  so on that tab the search and filter controls are **not rendered**.
- Adjust form is an inline card, not an overlay: one of its 409s is fixed by the
  settings card one section below.
- No peek (would be free, but the reason to open a row is to adjust it), no
  sorting, no bulk.

**Three bugs fixed, each needing a fixture that did not exist:**
1. The item ledger filtered by the tapped id rather than `adjustTarget()` —
   `lib/inventory.ts` says this "comes back empty while stock demonstrably
   moved". Invisible until a delegated-stock fixture existed.
2. One `SectionError` served both "request failed" and "nothing has moved".
3. A report paged past its last page had no way back.

**Two live bugs found on the way:** `SkuLookup`'s refocus called `focus()` on a
still-disabled input, so it never ran; and `ITEM_MOVEMENTS_PER_PAGE` exported
from a `"use client"` module reached a Server Component as a client *reference*,
so `per_page` went out as `[object Object]` and the ledger silently showed nine
rows instead of five.

---

## 7. Coupons — mock done, screens not built

The write surface is mocked and verified. `search` and three-state `status` now
filter, `eligible-products`/`eligible-categories` are served, and the writes
reproduce rules that are **not** the product rules — a read-only key is refused
rather than dropped, `PATCH {}` is a 200 no-op, and a duplicate code is a 409
under `details.code` carrying the lower-cased form. Fixtures exist for a stale
restriction, a trashed coupon and a non-zero usage count.

**Decisions already resolved** (from the scout; build to them):

- List: `DataTable`/`RecordList` + `columns.tsx`, status `FilterTabs` — three
  states, the first sending nothing, because absent means publish AND draft.
  Search. **No sorting** — `orderby` is validated with no positive control.
- **No peek** — the detail is the row plus `restrictions`, the test customers
  failed. Identifying cell is a real `<a href>`, table presentation only.
- **One component** for `/new` and `/{id}`, not two.
- **`PageBody width="form"` (640), not `DetailGrid`** — §2.3 lists coupon in the
  form row, and unlike products this screen has no read-only report half.
- Restriction picker: a **`Drawer`** with real checkboxes via `Form.tsx`'s
  `CheckRow` (the current `role="checkbox"` on a `<button>` is what the new form
  layer retires), and its search **submit-gated** — it currently fires a request
  per keystroke and can be opened four times per form.
- Sticky `SaveBar` when dirty. Delete in a header `Menu` → `ConfirmDialog`;
  permanent delete requires typing the identifier.
- `loading.tsx` for all three routes. Drop the list's `StaleBanner` (no writes to
  disable). Delete the dead `coupons.percentValue` key.

**Two real bugs to fix:**
1. **A 400 on a restriction id renders nowhere — a silent failed save.** Errors
   are keyed by field, the restriction rows render none, and the orphan fallback
   only fires for keys *not* in the draft. `product_ids` is in the draft. Wire
   `ErrorSummary`; the mock produces this refusal, so verify it lands.
2. The restriction rows **mix draft counts with saved names** — add a product to
   a field that already had one and it shows the old names beside the new count.

**Measurements that must survive:** `amount: "0.00"` is a real coupon while a
zero threshold is stored as null and can never read back as `"0.00"` — both
directions on one object. `date_expires` is written `Y-m-d` and read back full
ISO, so only `expiryInputValue()` may put it in a control. `missing` is on every
restriction row, not just broken ones, because filtering stale ids out would
silently delete them on the next save. The code folds on keystroke so the 409
names a code the person recognises.

---

## Carried forward — teardown owns these

- **`Toast` is still on retired iOS classes**, and `.toast-anchor` holds it 68px
  off the bottom to clear a tab bar that no longer exists. Panel-wide.
- **`.save-bar` stays in `globals.css`** — eight unmigrated forms use it, and
  they are `fixed` with no block-end, so deleting the rule would unstick their
  bars rather than remove them.
- **`RowSkeleton.tsx` stays** — eight unmigrated screens import it.
- `ConfirmDialog` focuses its × button rather than Cancel, contradicting §3.1.
  Radix's `FocusScope` wins over `autoFocus`; needs a second focus prop.
- The sticky first column has no divider at its frozen edge.
- `@hookform/resolvers` is imported nowhere; `react-hook-form` only by the login
  form.
- `movementReasonHint` has no caller in either message file.
