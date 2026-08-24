# DECISIONS.md — the redesign ledger

One block per screen, appended as it is built and merged. Never rewritten.
`DESIGN.md` says how the panel looks; this file says what was decided for each
screen and, more usefully, what was **left out** and why.

The rule the whole run follows: **this API accepts parameters and silently
ignores them.** Five `orderby` values on `/products` returned byte-identical id
sequences. So a control ships only when someone measured it working. Anything
unverified is treated as not working, and its absence is recorded here rather
than left to look like an oversight.

---

## Checklist — 41 route pages

```
[x]  0. Harness — mock API, capture script, this file
[x]  1. Orders — list        (inherited; merged before this run began)
[x]  2. Products — list
[x]  3. Orders — detail
[x]  4. Products — detail + form
[x]  5. Customers — list + detail
[ ]  6. Inventory — list + detail
[ ]  7. Coupons — list + form
[ ]  8. Shipping
[ ]  9. Payments
[ ] 10. Dashboard
[ ] 11. Analytics — revenue
[ ] 11. Analytics — orders
[ ] 11. Analytics — products
[ ] 11. Analytics — customers
[ ] 11. Analytics — shipping
[ ] 11. Analytics — COD
[ ] 12. Content — pages list
[ ] 12. Content — page form
[ ] 12. Content — banners
[ ] 12. Content — FAQs
[ ] 12. Content — homepage
[ ] 12. Content — menus
[ ] 12. Content — index
[ ] 13. Media
[ ] 14. Marketing — campaigns list
[ ] 14. Marketing — composer
[ ] 14. Marketing — segments
[ ] 14. Marketing — config
[ ] 14. Marketing — templates
[ ] 15. Notifications — list + detail
[ ] 16. Staff — list, detail, new
[ ] 17. Settings
[ ] 18. Transfer
[ ] 19. Audit
[ ] 20. Login + not-found
[ ] 21. TEARDOWN
```

Progress check that does not depend on this list: a file with no `ui-` prefix in
its classNames is not migrated. `grep -L 'ui-' app/**/*.tsx`.

---

## 0. Harness — 2026-08-23

Not a screen. The thing every later screen is verified with.

- **Why:** the e2e suite needs live shop credentials nobody has in this
  environment, and a previous session proved a passing `next build` is not
  sufficient — it once passed with a completely broken stylesheet, off a stale
  `.next` cache. So verification had to become something that renders the page.
- `scripts/mock-api.mjs` — a dependency-free `node:http` shop API. Deterministic
  data, seeded, so a screenshot is stable between runs.
- `scripts/capture.mjs` — mints an `ac_admin_session` cookie with `jose` from
  `SESSION_SECRET`, then per route screenshots 340/768/1440 × light/dark × fr/ar
  and asserts zero console errors, zero page errors, and
  `documentElement.scrollWidth === clientWidth` at every width.
- **Mirrors the API's dishonesty on purpose:** the mock accepts `orderby` and
  `order` and ignores them, exactly as measured against the live router. An
  agent must not be able to "verify" a sort control against the harness and ship
  one that does nothing in production.
- **Omitted deliberately:** write endpoints beyond what a screen reads. The mock
  grows one route group per page, the way `lib/api/allowlist.ts` does; a route
  no screen calls is not mocked, so a screen calling something nobody reviewed
  fails loudly instead of quietly succeeding.
- **Notes:** the harness asserts the mock actually received requests. Without
  that, a panel still pointed at `localhost:8090` renders error states at every
  breakpoint and the capture passes on twelve screenshots of nothing.

---

## 1. Orders — list — inherited

Merged before this run began, in `f126fcf`, and reconstructed here from its own
source comments so the ledger is not missing its reference screen.

- Layout: `PageHeader` + `PageBody width="full"`; `DataTable` at `md`+ and
  `RecordList` below, one column definition feeding both.
- Columns / sections: number · customer · place · created · total · status by
  default; items, payment, modified and id behind the column picker. `place` is
  filled on ~8% of orders by wilaya and 27% by city and is still default,
  because a dispatcher scans for it; `payment_method_title` is optional because
  it is a long string saying the same thing on nearly every row.
- Filters: status tabs and search — **both measured**. `?status=processing,pending`
  is a 400, which is why the tabs are single-select; `?search=Nadia` takes 633
  rows to 92.
- Sorting: **none.** The columns carry `sortKey` and the primitive supports it,
  but `orderby` on this collection was never verified and has a measured history
  of being accepted and ignored.
- Bulk: export only, built client-side from rows in memory —
  `/api/export/orders` forwards only `limit` and cannot be asked for a set of
  ids, and widening it is a security-surface change for a convenience.
- Row click: drawer peek at `?peek=id`. Free, because `GET /orders/{id}` returns
  the same object as the list row.
- Omitted deliberately: date-range filter — `date_from`/`date_to` exist in
  `collectionParams()` and are unverified against the same failure mode.
- Notes: it is the one list that polls, at 30 s, paused when the document is
  hidden. Nothing below 30 s — reads are 600/min per credential and shared
  across every tab a person has open.
- **Debt it left, found while scouting page 3:** `e2e/orders.spec.ts` still
  asserts old-system markup — ten `a[href*="/orders/"]` row-anchor selectors
  against a `DataTable` that emits no anchor at all, plus a
  `getByRole("radiogroup")` and a `span.tonal`. Being fixed with the Orders
  detail, which owns that file. `orders/OrderRow.tsx` is also dead — nothing
  imports it — and goes in the teardown.

---

## 2. Products — list — 2026-08-24

- Layout: `PageHeader` + `PageBody width="full"`; `DataTable` at `md`+,
  `RecordList` below, one `columns.tsx` feeding both. Same shape as Orders.
- Columns / sections: name · sku · created · stock · price · status by default;
  category, type, featured, id and modified behind the picker.
- Filters: status tabs (single-select — `?status=draft,publish` is a 400) and
  search in the toolbar; the other seven dimensions in a `Drawer` behind one
  Filters button carrying a count. Draft-then-apply, so one history entry and
  one refetch per intent rather than one per checkbox — the best thing about the
  screen this replaces, and it survived. Chips are one per **value**, so
  removing "Laine" does not also remove "Coton". `trash` is not a tab:
  `?status=trash` is a 400, though a trashed product still reads back 200.
- Sorting: **ships, and this is the only screen in the run where it does.**
  `lib/product-status.ts:64-86` records that the silent-ignore was repaired in
  the backend and exactly five combinations were re-measured — date desc, date
  asc, title asc, price asc, price desc. So: name ascending **only** (nobody
  ever measured `title desc`), created both, price both. Nothing else.
- Bulk: **export only — no bulk endpoint.** The brief for this run asserted
  `POST /products/bulk` exists and it does not: one word in one shorthand list
  in `ADMIN_PANEL.md:1477`, no verb, no body, no response shape, no measurement,
  and `lib/api/allowlist.ts` plus `tests/boundary.test.ts:196` both assert it
  must stay unreachable. Nothing was added to the allowlist.
- Row click: drawer peek at `?peek=id`. Free — `lib/api/schemas/product.ts:8-12`
  measures the two key sets identical across all 28 products.
- Omitted deliberately:
  - **Thumbnail column** — every product in this shop has `image: null`, so it
    would be a column of empty squares.
  - **A separate SKU box** — `search` already covers name and SKU. The `sku`
    param still works end to end and still renders a removable chip.
  - **A create action on the no-data empty state** — `POST /products` is not
    allowlisted and no screen creates a product.
  - **`title desc`** — see sorting.
- Notes: four defects surfaced that were **already live on Orders** and are
  fixed in the primitive, so Orders inherits all of them.
  1. Sortable column headers lost their uppercase — a `<th>` computes
     `uppercase` but a nested `<button>` does not inherit it, so the header row
     read `PRODUIT · SKU · CRÉÉ · STOCK · PRIX · STATUT` with the sortable ones
     in mixed case. The rule moved to `.ui-th, .ui-th button` in `globals.css`.
  2. `aria-sort` was gated on `column.sortKey` alone rather than on a handler
     existing. Orders declares `sortKey` on three columns and deliberately
     passes no `onSortChange`, so those headers announced `aria-sort="none"` —
     which in ARIA means *sortable, currently unsorted*. The table was telling a
     screen reader it could be sorted by columns nothing on screen can sort.
  3. The column picker and density toggle rendered below `md`, where
     `RecordList` — which takes neither `visible` nor `density` — is what shows.
     Two controls that changed nothing. Now `md:flex` in the primitive.
  4. Rows were 51px against DESIGN.md §1.4's 48, because inline cell content
     makes the row height a line box and a badge and an icon-only button hang
     below the baseline. Cells are flex now; measured 48/49 on both screens.
  Also: `created` is in the default column set specifically because `aria-sort`
  lives on the header — hidden, it meant no header carried the sort state while
  the panel had explicitly sent `orderby=date&order=desc`.
  Focus restoration was broken panel-wide, not just here: Radix's modal
  `Dialog.Content` restores focus to `Dialog.Trigger`, which no overlay in this
  panel renders, so Escape dropped focus to `<body>` from every Modal, Drawer
  and ConfirmDialog. Fixed in `Overlay`.
  DESIGN.md §3.4 was amended: a form section heading inside an overlay drops to
  `--text-subheading`, because `OverlayFrame` gives the overlay's own title
  `--text-heading` and a section under it otherwise renders at exactly the size
  and weight of that title.
- **Known gap, deliberate:** the sticky first column has no divider at its
  frozen edge. Mid-scroll in Arabic the neighbouring header is cut mid-word,
  which reads slightly like clipped text. An always-on hairline would put a
  permanent vertical rule into all eighteen remaining list tables at every
  width, and a scroll-driven one needs a scroll listener in the primitive.
  Deferred rather than decided here.

---

## 3. Orders — detail — 2026-08-24

The screen that sets the detail patterns for the ~20 detail screens after it.

- Layout: two-column at `lg`+ — main `1fr` plus a 360px aside, aside **below**
  main when it collapses. Built as `components/ui/Detail.tsx` (`DetailGrid`)
  plus `components/ui/Card.tsx` (`Card`, `DataList`, `DataRow`), because it did
  not exist as a primitive and twenty screens need exactly it. `PageBody` gains
  `width="split"`, capped 1152 = 768 + 24 + 360.
  It is **flex, not grid**: `grid-cols-[minmax(0,1fr)_360px]` is an arbitrary
  value and §7 fails the build on one. `flex-1` + `lg:w-90` is the same
  geometry off the spacing scale.
- Columns / sections: main is items+totals · timeline · customer notes ·
  parcels · payments — the wide, tabular, unboundedly-growing things. Aside is
  status · dates · payment method · customer · COD — fixed-height reference
  material read while scanning main.
- **The primary action lives in `PageHeader`, never in the aside. This is now
  the rule for every detail screen in the run.** Below `lg` the aside drops
  beneath a variable-length item list, and the panel's most-used control cannot
  sit at the bottom of a page whose length is data-dependent.
- Status picker: a `Menu` of candidate moves; `cancelled` and `refunded` go
  through `ConfirmDialog` with a label naming the act. The panel holds no
  transition table — the API is the authority, and after the first 409 the menu
  narrows to the server's own `allowed` list.
- 409 refusal: inline `role="alert"` above the grid, and it stays. Never a toast.
- Bulk: n/a.
- Row click: n/a.
- Omitted deliberately:
  - **The line-item editor.** `is_editable` exists and ADMIN_PANEL.md specifies
    the behaviour, but the `PATCH /orders/{id}` line-items contract has never
    been measured.
  - **A Cancel button.** `ADMIN_PANEL.md:1402` lists `/orders/{id}/cancel`; it
    is not allowlisted, not mocked and called by nothing.
  - **`stock_reduced`**, which is schema'd and documented and would need an
    invented meaning to render.
  - **`needs_payment`.** Tried, then removed: the restatement is honest but not
    news, because the status badge and the transaction statuses already carry
    it, and the one thing worth saying — whether an unsettled transaction will
    ever settle — is exactly what the flag cannot say.
- Notes:
  - Line items are a plain semantic `<table>` in a bordered section, not
    `DataTable`. Selection, column picker, density, pagination, sorting and a
    row menu are all unwanted for a fixed 1–3 row list, and §3.2's contract is
    about list *screens*. If a second detail screen needs the same thing, that
    is when it becomes a primitive.
  - **DESIGN.md §2.2/§2.4 were wrong and are amended.** They put the breadcrumb
    in the top bar at `lg`+, but `AppShell` renders that bar `lg:hidden` — at
    `lg`+ there is a sidebar and no bar at all, so the screen had no way back to
    the list. `PageHeader`'s `back` link now shows at every width.
  - **Focus restoration was broken panel-wide**, not just here, and is fixed in
    `Overlay`: Radix's modal `Dialog.Content` restores focus to
    `Dialog.Trigger`, which no overlay in this panel renders, so Escape dropped
    focus to `<body>` from every Modal, Drawer and ConfirmDialog in the app. A
    `Menu`-opened `ConfirmDialog` needed more than that — the menu item Radix
    unmounts on select cannot be restored to — hence a `returnFocusTo` prop.
  - A COD switch that disabled itself while its own PATCH was in flight dropped
    focus to `<body>` with nothing to restore it to. Fixed.
  - Prose was cut from seven sentences to four, one per card. "Restraint and
    finish, not more chrome" applies to words as much as to decoration, and the
    Articles footnote had leaked engineering rationale — *its write contract was
    never measured* — onto a shopkeeper's screen. That reasoning moved into the
    file's docblock, where the rest of this project keeps it.
  - `e2e/orders.spec.ts` was **already broken before this branch**: the list
    migration left ten `a[href*="/orders/"]` selectors against a `DataTable`
    that emits no anchor, plus a `getByRole("radiogroup")` and a `span.tonal`.
    Both the list and the detail assertions are fixed here. One test added; none
    deleted.
- **Found, not fixed:** DESIGN.md §3.1 says `ConfirmDialog` focuses Cancel by
  default; measured, Radix's `FocusScope` focuses the header Close button first.
  Both are non-destructive so the guard against Enter-on-an-unread-dialog holds.
  Fixing it needs a second focus prop on `Modal`.

---

## 4. Products — detail + form — 2026-08-24

The panel's only real editing surface, and the screen that finished the form
layer.

- Layout: `DetailGrid`. Main is identity · pricing · stock · descriptions · SEO ·
  attributes (read-only) · variations (read-only). Aside is publication ·
  categories · the saved record's dates and id. §2.3's "Form, 640px" row means a
  page that is *only* a form; a product detail is a detail screen that happens
  to contain inputs, and the peek drawer already covers the glanceable half.
- **Save is a sticky bar that appears only when dirty, not a header primary
  action — and that deliberately differs from the orders detail.** The header
  rule established on page 3 is about a control acting on the record's *state*;
  §3.4 legislates a long form's save separately. Coupons, settings, staff-new
  and the content page form inherit this one.
- Filters / sorting / bulk: n/a.
- Row click: n/a.
- Writes: categories became a writable multi-select — measured writable, the
  vocabulary was already fetched, and it was the cheapest real feature here.
  SEO writable, always sending the **complete** `seo` object because partial
  behaviour is unmeasured, with `overrides[]` surfaced so a person can see which
  fields stopped being derived.
- Omitted deliberately:
  - **The options editor.** ADMIN_PANEL.md calls it the hardest component in the
    panel and every number in its spec is unmeasured — no product in this shop
    has an option set.
  - **The media picker**, for three independent reasons: a Product Manager is
    403 on `GET /media`, every product has `image: null`, and the list branch
    already dropped the thumbnail column for the same reason. The absence is
    stated on screen so it does not read as a missing feature.
  - **Variation writes** — `POST /products/{id}/variations` is allowlist-refused
    and `tests/boundary.test.ts:197` asserts it.
  - **Attribute writes** — sending `attributes` on a variable product wipes every
    variation's attribute map, measured on products 12 and 21.
  - **A `sale_price <= regular_price` rule.** Nothing has measured whether the
    API rejects it, and a client rule the server does not hold is the same
    defect as a control that does nothing. Client rules also never block submit:
    a disabled Save would make the 400 fan-out unreachable, and the API stays
    the authority.
- Notes:
  - **The `options_problems` banner was a lie and the copy was fixed rather than
    the screen.** It told the reader that saving destroys the broken option
    groups; the `Draft` never sends `options`, so this screen's save cannot
    trigger that repair. Making the screen match the old copy would have meant a
    price edit silently deleting two option groups as a side effect — a
    destructive act nobody asked for, which §3.1 would gate behind a
    `ConfirmDialog` anyway.
  - **Three strings named destinations that do not exist**, and one of them was
    written on this branch, in that same banner. There is no Attributs screen in
    this panel and none on the 41-page checklist; variations are editable
    nowhere. Copy that sends someone to a screen they cannot reach is worse than
    saying nothing — it reads as a missing feature rather than a deliberate
    absence. All three now state the true scope: read-only *in the panel*.
  - **`.ui-tap::after` had its LTR and RTL transforms swapped**, so every icon
    button in the panel had its 44px hit area sitting entirely to one side of
    the control. Pre-existing and invisible for as long as every icon button
    happened to have a wider control after it; this header's is last, so the
    overhang joined the document's scroll width and the capture failed
    `777 ≠ 768`. Caught by the harness, findable by nothing else here.
  - `.save-bar` stays in `globals.css`: eight unmigrated forms still use it, and
    they are `fixed inset-x-0` with no block-end of their own, so deleting the
    rule would unstick their bars to the top of the viewport rather than remove
    them. Teardown owns it.
  - The attribute-terms requests used to fire serially *after* the main
    `Promise.all`. They are folded in, and skipped entirely unless the product
    carries a global attribute — `/products/104` now fires zero `/attributes`
    requests where it fired three.
- **Found, not fixed:** `ConfirmDialog` focuses its × button rather than Cancel,
  contradicting §3.1. Radix's `FocusScope` wins over `autoFocus`. Harmless —
  both are non-destructive — but it needs a second focus prop on `Modal`.


---

## 5. Customers — list + detail — 2026-08-24

The first screen in the run where the peek default does not apply, and the first
whose detail is a *report* rather than a form.

- Layout — list: `PageHeader` + `PageBody width="full"`; `DataTable` at `md`+,
  `RecordList` below, one `columns.tsx` feeding both.
- Layout — detail: `PageBody width="split"` + `DetailGrid`. Main is the
  statistics report, this customer's orders and their notification queue; the
  aside is identity, consent and the two addresses.
- Columns / sections: client · e-mail · phone · registered · id by default;
  city, consent and modified behind the picker. `is_paying_customer` is a badge
  beside the name rather than a column of its own — 4 of 16 carry it, **there is
  no filter for it**, and under a header a sparse column reads as missing data.
- Filters: **search, and nothing else, and the absence is the design.**
  `query.ts` measures the whole parameter set — `search`, `orderby`, `order`,
  pagination. No paying filter, no date range, no consent filter, and an unknown
  parameter answers 200 with the full result set (`?role=administrator` returns
  all 16 rows), so any other control would be indistinguishable from one that
  works. No chip row either: with one filter the chip repeats the term already
  visible in the box beside it.
- Sorting: **none, and this is Orders' position rather than Products'.** The
  first draft shipped `registered` and `user_email` as sortable headers; they
  are removed. `orderby` is accepted and validated on this collection
  (`?orderby=zzz` is a 400), and **nothing anywhere records a positive
  control** — no measurement showing either value returns a different id
  sequence from the unparameterised request. What `query.ts` records is that
  `display_name` and `user_email` were byte-identical **to each other**, with a
  genuine data explanation (every `display_name` is the username, every username
  is the local part of the e-mail); two values agreeing with each other says
  nothing about whether either agrees with the default order. Products ships
  headers off five combinations re-measured after a backend repair; Orders ships
  none for exactly this reason. `registered` stays in the default column set on
  its own merits — the list is already in that order and it is worth seeing —
  not as a control. `ORDERBY`, `ACCEPTED_ORDERBY` and the `queryFromParams`
  guard all stay: a stale or hand-edited `?orderby=` must still not provoke a
  400 the screen renders as an error. Passing no `onSortChange` also keeps
  `aria-sort` off the headers, which the primitive gates on a handler existing.
- Row click: **navigates. No peek drawer, and this is the first screen where the
  default is wrong.** `lib/api/schemas/customer.ts:7-13` measures that the
  detail is the row **plus `statistics`** — the first collection here where the
  two routes disagree — so a free preview would show nothing the row lacks, and
  a useful one costs a request per open against a 600/min budget shared across
  every open tab. The identifying cell is therefore a real `<a href>`, which is
  the keyboard path and the middle click the peek was providing. It lives only
  in the table: both presentations are in the DOM at every width, so an anchor
  in each would double every `a[href*="/customers/"]` the suite counts.
- Detail data: page one of the orders and of the notification queue are fetched
  **server-side**, in parallel, each caught alone — `null` (this section could
  not load) distinct from `[]` (there is nothing here), the order detail's
  arrangement. Both are conditional: the orders read is skipped when
  `statistics.total_orders` is 0 (11 of 16), the notifications read when there
  is no address to join on. The two small client components exist only for their
  pagers. A side effect worth knowing: `scripts/capture.mjs`'s docblock says a
  capture of `/customers/24` reaches neither sub-resource because both were
  behind tabs. It now reaches both — the harness serves 12 requests each.
- Omitted deliberately:
  - **A row-actions `Menu`** — it would hold one item. No write ships and no
    delete route exists, so the 40px column would repeat the row click.
  - **Tabs** — `Segmented` is retired and nothing replaces it. Three stacked
    cards, because a tab hides content behind a click on a screen that is empty
    for 11 of the 16.
  - **`StatGroup`/`Stat`** — DESIGN.md §3.2 specifies them and they do not
    exist. Their consumers are the six analytics screens, and building a
    primitive on the one screen that has just been told not to use it would be
    speculative. See the next item for why this screen must not use it.
  - **A 4-up stat row** — `lib/api/schemas/customer.ts:119-137` is explicit:
    `total_orders` sits beside `total_revenue`, and dividing them is arithmetic
    the API does not do (revenue counts only the *completed* orders). Four bare
    numbers under four short labels is the single layout most likely to invite
    that. Scope-labelled `DataRow`s and the footnote instead.
  - **Any write** — `PATCH /customers/{id}` is allowlisted, specified and has
    never been built. `marketing_consent` in particular is refused on PATCH *by
    design*, so the consent card is a value with a stated reason naming the
    shopper's own route, never a disabled toggle.
  - **A selection column and a client-side selection export** — the products
    list has both; here the header's `/api/export/customers` link is the whole
    of it. Selection would exist to offer a second export of the same rows.
  - **A stale marker**, which is the one §3.7 item this detail does not carry.
    The marker exists to pair an age with the writes it disables; there are no
    writes, nothing polls, and there is no refresh control, so the data is
    exactly as old as the navigation that fetched it.
- **The 340px money clipping, and what it actually was.** The brief reported the
  statistics money rows clipping mid-number at 340 — "7 100,0" for `7 100,00 DA`
  — found by capturing the detail for the first time. Reproduced and traced: the
  cause is a three-instruction geometry that both `ListValueRow` (the retired
  row that was captured) and `DataRow` share — `shrink-0` on the label,
  `min-w-0` on the value, no wrapping — which adds up to *the label always
  wins*, and `Card`'s `overflow-hidden` does the cutting. `dd.scrollWidth`
  equals `clientWidth` throughout, so nothing measures it but the text's own
  extent.
  Fixed in `DataRow`, so all ~20 detail screens inherit it: the row is
  `flex-wrap` with `gap-y`, the label takes `min-w-0` instead of `shrink-0`, the
  value takes `ms-auto` (which replaces `justify-between` and still works on a
  line of one) and `break-words`. Measured at 340 on `/customers/24`, both
  halves forced to the retired row's `--text-body`: the old geometry clips 6px
  off `‏7.100,00 د.ج.‏` in Arabic, the new one wraps the value onto its own line
  and clips nothing (41px → 67px row). At `DataRow`'s own 13/14px the French
  rows have 38px and 53px of slack and never clipped — which is why this is a
  structural fix rather than a type-size one.
- Notes:
  - **`CustomerRow.tsx` and `CustomerDetail.tsx` are gone.** The first was a
    retired-primitive row and its name-kind styling moved into `columns.tsx`;
    the second was 660 lines defining eight components inside one function body,
    re-created every render, now six files.
  - The cross-screen `RowSkeleton` import from `../inventory` is broken. The
    list uses `TableSkeleton`/`RecordListSkeleton`.
  - **The notifications section shares the reader and no longer the row.**
    `notifications/query.ts` is data and sharing it is correct; `NotificationRow`
    is UI built on retired primitives, and importing it would have left an island
    of them inside a migrated detail.
  - `query.ts` gained `perPage`, and page and per-page both live in the URL here
    rather than in component state as on products — one filter makes the URL
    short enough that the reading position is worth carrying.
  - Two table columns had no width cap, which an auto-layout `white-space:
    nowrap` table turns into a column as wide as its widest cell:
    "Abdelkrim-Mohammed-El-Hadj Benyoucef-Bouchentouf-Belkacemi" took the table
    425px past its own container at 768 and 9px past it at 1440. Capped at
    `max-w-64`; the inner scroll is now 247px at 768, against products' 328 and
    orders' 207 at the same width.
  - The record card measured 94px against `RecordListSkeleton`'s 96 — 12px of
    shift across the six it draws — because the third line held no
    `--text-compact` child and the taller child wins the line box. The trailing
    id carries it now.
  - Seven notification links on customer 24 all read "Commande confirmée": the
    queue holds one row per event per order, so the visible label repeats by
    construction. They carry an `aria-label` naming the event *and* its date.
  - Message keys that lost their last caller are deleted: `previousPage`,
    `nextPage`, `sortLabel`, `sort.*`, `tabLabel`, `tab.*`, `orders.previous`,
    `orders.next`, `orders.never` and `consent.label`.
- **The brief asked for sorting and it is not here.** Raised rather than
  complied with, and accepted: `scripts/mock-api.mjs:3512-3534` states the
  opposite of the brief in as many words — it validates `orderby` and then
  ignores it, deliberately, "because nothing measured says either sort does
  anything, and a mock that sorted would let an agent verify a control against
  the harness and ship one that does not work." Whoever measures `orderby` on
  `/customers` next can settle it; the primitive is ready and the column
  definitions need one field each.
- **Found and fixed in the primitive, so Products inherits it:** `SearchField`
  gave its focused state `focus-within:shadow-ui-sm` — the *popover* elevation
  token standing in for a focus indicator — where §3.4 specifies an accent
  border plus a 3px `--color-selection` ring, and §5 makes focus visibility a
  floor rather than a preference. Neither `.ui-ring` nor `.ui-ring-peer` reaches
  it: the border is on the `<form>` and the focus lands on the `<input>` inside,
  whose own outline is suppressed. `.ui-ring-within` is the third member of that
  family in `globals.css`. Both search fields in the panel now show the ring.
