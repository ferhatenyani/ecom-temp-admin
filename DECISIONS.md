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
[x]  7. Coupons — list + form
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
its classNames is not migrated. `grep -rL 'ui-' --include=*.tsx app/` — **90
files left.**

---

## Standing rules these six pages established

Apply these to every remaining screen unless something measured says otherwise.

| Rule | Why |
| --- | --- |
| **Sorting ships only with a positive control** — and the control must not be the collection's *default* ordering. Products and coupons. | Two values agreeing *with each other* proves nothing, and a value that is already the resting order proves nothing either — `date` on coupons tied on every row and answered the bare listing, which is how "validated then ignored" got recorded for a working sort. Absence of a positive control is not evidence of absence: go and take one. Orders, customers and inventory still ship none. |
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

**And that cuts both ways — it did, on coupons.** The mock ignored an `orderby`
the router honours, invented a `"Read-only."` refusal the API never sends, and
wrote its own wording for a restriction error; a screen was then built to all
three. A harness that is *stricter* than the API is not the safe direction, it
is just the quieter one: it grows error paths production never takes and hides
controls that work. So the honesty audit runs in both directions, and anything
this file records as measured carries the request that measured it.

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

## 7. Coupons — list + form

- List: `DataTable`/`RecordList` + `columns.tsx`, status `FilterTabs` — three
  states, the first sending nothing, because absent means publish AND draft.
  Search, and it matches the **code only**; the placeholder says so. **Sorting
  ships** — the second screen to carry it, and the first whose control is backed
  by a positive control in the API's own suite. Re-measured 2026-08-25: all four
  `orderby` values sort in both directions, `usage` numerically, `order`
  defaulting to `desc`; the mock and its suite sort too, with a fixture whose
  `usage_count: 9` against 305's `37` catches a lexical regression. `code`,
  `usage` and `id` carry a `sortKey`; the other six do not, because the API
  cannot sort them. **`date` gets no column and no control** — it is
  `date_created`, the list's only date is `expires` (`date_expires`), and adding
  a column to hang a sort on is chrome; it stays the resting order, which the
  third header click returns to by dropping `orderby`. `date` is also what proved
  nothing either way — the shop's four coupons share one `post_date`, so both
  directions tie — and using it as its own control is how "validated then
  ignored" got recorded. No sort below `md`: `RecordList` takes no sort props,
  and that is correct rather than a gap.
  No peek, no bulk, no export — coupons is not in `EXPORT_SUBJECTS`.
- Create ships as a `PageHeader` primary: `POST /coupons` **is** allowlisted,
  unlike products.
- `per_page` moved into the URL on the customers shape, so `TableFooter` is used
  as-is; a stale `?per_page=37` falls back rather than travelling.
- Form: **one component** for `/new` and `/{id}`, `PageBody width="form"` (640)
  rather than `DetailGrid` — §2.3 puts coupon in the form row and this screen
  has no read-only report half. `usage_count` is a `ReadOnlyField` beside the
  limit it counts against, which is the only place the number means anything.
- Delete in a header `Menu` → `ConfirmDialog`; permanent delete requires typing
  the code. Restriction picker is a `Drawer`, search **submit-gated** — it fired
  a request per keystroke and the form can open it four times.
- Omitted: peek, bulk, export, a `date`/created column, and any `status=trash`
  request (a 400).

**The two recorded bugs, both fixed and both verified on screen:**
1. A 400 on a restriction id rendered nowhere — a silent failed save. The orphan
   fallback only fired for keys *not* in the draft, and `product_ids` is in it.
   `ErrorSummary` is wired; saving coupon 305 now names the offending id.
2. The rows mixed draft counts with saved names. The form now holds one
   `id → {name, missing}` map, seeded from `restrictions` and extended by every
   picker commit. An id in neither source renders as its id and does **not**
   claim `missing` — that flag is an API fact, not a fallback.

**A third, found in the captures and older than this branch:** `restriction.any`
("Tous") rendered for an empty list on all four rows. On the two *exclusion* rows
that states the inverse of the fact — every coupon in the shop, including a blank
one, claimed all products were excluded. Split into `restriction.none`.

**Four `Form.tsx` extensions, so the next screen inherits them:** `CheckRow`
gains `secondary`/`badge` (it took `label: string` only, so wiring the picker
through it would have silently dropped the SKU, the `noSku` fallback and the
draft badge); `NumberField` gains `name`; `DateField` gains `echo`, which is the
only defence against Chromium rendering `mm/dd/yyyy` in Arabic; `SaveBar` gains
`persistent`. **`SaveBar` also stopped offering discard on a clean form** — it
gated on `onDiscard` alone, which was the same test as `dirty` until `persistent`
existed, and a persistent bar then offered "Annuler les modifications" against
nothing to annul.

**`Card`, not `Section`.** `Section` is sized to sit inside an overlay at
`--text-subheading`; a card on a page takes `--text-heading`, and `Card` is the
box model `FormSkeleton` is measured against, which is what makes the two form
`loading.tsx` files match first paint.

**The trashed coupon stays editable.** `GET /{id}` is 200 with `status:"trash"`,
the picker offers only the two live states, so the form opens coerced to `draft`
and *clean*. Saving is the restore path and it is the only one this panel has —
gating it on dirtiness would mean editing an unrelated field first. Its banner
names the state and says what saving does. That is `persistent`'s second caller.

**`e2e/coupons.spec.ts`: 15 tests before, 15 after, titles identical.** The row
helper resolved rows through `a[href*="/coupons/"]`, but that anchor lives only
in the table, which is `hidden md:block` — and every Playwright project bar one
is phone-sized, so `toBeVisible()` failed before any test reached its own
assertion. `tbody tr, li.ui-card` filtered to visible fixes ten tests at once.
The live codes stay: the suite runs against the shop, not the mock.

**Measurements that survived:** `amount: "0.00"` is a real coupon while a zero
threshold is stored as null and can never read back as `"0.00"`. `date_expires`
is written `Y-m-d` and read back full ISO, so only `expiryInputValue()` may put
it in a control. `missing` is on every restriction row. The code folds on
keystroke so the 409 names a code the person recognises.

**Corrected 2026-08-25:** coupons and products share one read-only rule — the key
is **dropped in silence**, and only a genuinely unknown key is a 400. The whole
GET body PATCHes back, `restrictions` included. They differ only in the ending: a
body left with nothing supported is a coupon's 200 no-op and a product's 400. The
named subset `CouponForm` sends is still right, but as caution, not as the API's
requirement. And the restriction refusal is `"No product with id 8842."`,
pluralising to `ids` and reading `"No product category"` on the category arm — the
sentence quoted here and in `CouponForm` until now was the mock's invention.

---

## Carried forward — teardown owns these

- **`Toast` is still on retired iOS classes**, and `.toast-anchor` holds it 68px
  off the bottom to clear a tab bar that no longer exists. Panel-wide.
- **`.save-bar` stays in `globals.css`** — **six** unmigrated forms use it, and
  they are `fixed` with no block-end, so deleting the rule would unstick their
  bars rather than remove them.
- **`RowSkeleton.tsx` stays** — **seven** unmigrated screens import it.
- **`e2e/customers.spec.ts:57,115` has the coupons row-helper bug**, unfixed: it
  asserts `toBeVisible()` on an anchor that only the `md`+ table renders, on a
  phone project. It has never surfaced because the suite is env-gated and has
  never run here. The fix is the `tbody tr, li.ui-card` helper coupons now uses.
- **A sort can outlive the column that shows it.** `id` on coupons is
  `optional: true`, so sorting by it and then hiding the column leaves the list
  ordered by something no header claims. Weaker than §2's products defect — there
  the *default* `orderby` sat on a hidden column, so every first paint lied;
  here the resting order is `date`, which no column claims either way, so
  "none" on every visible header stays true and reaching the gap takes a
  deliberate sort-then-hide. `DataTable` wants a rule about it.
- **Five mock-vs-API divergences found by the coupons honesty audit**, none
  fixed, all outside that branch: `PATCH {"code":""}` is a 200 that blanks a
  coupon's identity while `POST` refuses the same value (**measure this one
  first** — it is the destructive arm); both picker routes validate nothing but
  `per_page` where `/coupons` 400s the same input; `email_restrictions` accepts
  strings that are not addresses; `/products` reads `orderby=""` as a fifth
  value where `checkSort`, `filterCouponStatus` and `searchRows` all read it as
  absence; and `per_page=0`, `per_page=abc` and `page=0` are silent 200s while
  `per_page=101` is a 400.
- `ConfirmDialog` focuses its × button rather than Cancel, contradicting §3.1.
  Radix's `FocusScope` wins over `autoFocus`; needs a second focus prop.
- The sticky first column has no divider at its frozen edge.
- `@hookform/resolvers` is imported nowhere; `react-hook-form` only by the login
  form.
- `movementReasonHint` has no caller in either message file.
