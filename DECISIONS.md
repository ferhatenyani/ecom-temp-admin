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
[ ]  4. Products — detail + form
[ ]  5. Customers — list + detail
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
