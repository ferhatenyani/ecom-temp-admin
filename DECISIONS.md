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
[x]  8. Shipping — parcels list + rules route
[x]  9. Payments
[x] 10. Dashboard
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
its classNames is not migrated. `grep -rL 'ui-' --include=*.tsx app/` — **79
files left.**

---

## Standing rules these pages established

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
| **A picker over a working filter ships only when the allowlisted enumeration is complete.** Payments yes, shipping no. | Both parameters work and neither is validated — a wrong value is a silent 200 with 0 rows, not a refusal, so the *picker* is the only thing that can keep a typo unreachable. `/payments/methods` lists both values the collection carries, so it can; `/shipping/providers` lists one of two, so it cannot and shipping ships no provider filter. The test is the enumeration, never the parameter. |
| **A translated word for a shop's own vocabulary, a brand for a brand.** | `providerLabel`'s message key → API `label` → raw name, now in two places. `manual` and `cod` are states of this shop and read in the reader's language; `acfake` and `chargily` keep what their own side of the wire calls them. Nobody translates "Yalidine". |
| **A figure links only where its reader is not refused, and a figure with no honest destination renders unlinked.** Dashboard. | The same rule the nav and every disabled control follow, reaching a *number*. A link to a 403 is a control that cannot act, and a link to the wrong list is worse than none — `awaiting` counts two statuses the API cannot filter together and led to a list of half its own value. The figure always stays: a refused destination is not a refused number. A type that made the destination mandatory is what produced both defects, so "this cannot be drilled into" has to be representable. |

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
- **Sorting ships here on five columns** — name, SKU, created, price and id,
  both directions each. `popularity` sorts and gets no header: the API orders by
  `total_sales` and emits it on no response, so there is no cell to put under the
  label. It stays reachable by URL, as `customers` treats the two `orderby`
  values it accepts and does not offer. `menu_order` and `rating` are out —
  every product carries 0 for both, so neither control could act.

**This said "five combinations, name ascending only" until 2026-08-25, and had
been wrong for two branches.** The 2026-08-18 measurement was real; the backend
repair outgrew it and nothing re-took it, because the backend suite stayed green
on a fixture where id, title, sku and price all produced one identical sequence —
so any of them could stand in for another, and its stated control compared price
*ascending* against date *descending*, which differ even when `orderby` is
ignored outright. Re-measured over the full catalogue against each field's own
implied order: `date` 16 distinct, `id` 28, `title` 28, `price` 21, `sku` 28,
`popularity` 13. `title desc` — recorded here as never measured — had been
working the whole time.
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

## 8. Shipping — parcels list + rules route

**Split into two routes, and `/shipping` flipped to the parcels.** `query.ts`
justified one route by a tab-bar slot the section could not spend twice;
`layout.tsx` replaced that bar with `AppShell`, so the reason expired. What is
left is the shape `/inventory` and `/inventory/movements` already take —
different data, different filters, its own writes. `?view=rules` **redirects** to
`/shipping/rules`, between the session check and the capability gate, because the
flip means an old bookmark now names a different screen. `nav-tree.ts` keeps its
single `/shipping` entry; the tariff is reached from the parcels header.

- **Parcels list**: `DataTable`/`RecordList` + one `columns.tsx`, status
  `FilterTabs` (ten values plus "all", the first sending nothing), and an
  **order-number lookup** — submit-gated, digits only, non-digits stripped rather
  than refused so a pasted "Commande 4586" means 4586. `per_page` in the URL on
  the coupons/customers shape. Stale marker present: it holds a client cache and
  it writes, so both halves of §3.7 bite.
- **No provider filter**, and the parameter works (87 `manual` / 42 `acfake` of
  129). `GET /shipping/providers` returns **only `manual`**, so a picker built
  from the sole allowlisted enumeration cannot offer the value that matters, and
  a free-text box is not a filter here — `?provider=zzz` is a silent 200 with 0
  rows, not a refusal.
- **No `is_live` filter** — re-measured 2026-08-25 with a live row present:
  `?is_live=true` returned all 130. **No sorting and no `aria-sort` anywhere**:
  nine `orderby` values × both directions were byte-identical to
  `?bogus_param=1`, and **`?orderby=zzz` is a 200** — it never reaches a
  validator. 100 distinct ids on page one, so nothing ties. No bulk, no export
  (shipping is not in `EXPORT_SUBJECTS`).
- **The parcel drawer is the record's only surface.** No detail route, and
  `GET /shipments/{id}` is key-identical to the list row, so it costs no request
  bar the commune name. Whole row opens it; no trailing `Menu`.
- **`is_live` is not rendered as a marker.** It equals
  `!isTerminalShipmentStatus(status)` on 129 of 129 rows — the badge is the same
  fact. This deletes the §3.5 defect at `ShipmentRow.tsx:83-85` rather than
  promoting it to a badge.
- **On a terminal parcel there are no write controls and one line says why** —
  not a disabled control, and in this shop that is every row. The 409 those
  buttons would produce carries **no `allowed` list**, unlike an order's, which
  is why the picker is hidden rather than offered-and-refused.
- **`sync` is not rendered at all.** Measured in all three states it can be in:
  409 `sync_unsupported` on a live `manual` parcel, a **200 that changes nothing**
  on a terminal one, and `manual` is the only provider the panel can enumerate.
  There is no state in which it acts.
- **Every terminal status move is confirmed; only two are coloured danger.** A
  first draft marked all four `destructive` on the `Menu` and rendered **"Livré"
  in `--color-danger-fg`** — the one outcome everybody wants, in the panel's
  colour for *something is wrong*. The flag now follows the outcome and the
  dialog still fires for all four.
- **Rules route**: `PageBody width="split"` — rules list in main, resolver in the
  aside. Ordered by the server's `specificity`, never derived. Form is a `Modal`
  size `md` (eight controls, nothing behind it being read from — that is what
  makes `CreateParcelDrawer` a drawer and this not one). No `Section`: it is a
  bordered group at `gap-1` sized for check rows, and eight labelled fields need
  no internal border. `provider` is a `Select` fed by `/shipping/providers` plus
  an "any" option — it **is writable and validated**, and the picker is what keeps
  `Unknown provider "acfake".` unreachable, which is why nothing reads
  `details.available` and nothing should.
- **Delete → `ConfirmDialog`, danger, no type-to-confirm, and DESIGN.md §3.1 was
  amended in the same edit.** §3.1 asks for the record's identifier to be typed;
  a rule's only identifier is a database key the list deliberately never shows.
  The dialog names it the way the row does — scope, place, amount.
- **The resolver stays**, because it is why the editor exists. `.tone-warning` is
  gone; a server/local disagreement is a `Notice`. `/shipping/rates` 400s without
  **both** parameters, so the answer area is an empty state until both are set,
  not a disabled control. **No stale marker here** — server-fetched, every write
  ends in `router.refresh()`, and the resolver re-requests per selection.

**Three defects found by driving a real browser, which the capture harness
cannot see — two of them primitive fixes older than this branch:**

1. **`TableFooter`'s page indicator reordered in Arabic: page 1 of 7 rendered as
   "7 / 1".** `ui.table.pageOf` is `"{page} / {pages}"`, and the
   spaces around the slash break what would otherwise be one bidi number run, so
   an RTL paragraph swaps the two figures and tells the reader they are on the
   last page. A wrong number, not an ugly one. **It survived two branches because
   every Arabic list captured before this one had exactly one page** — "1 / 1" is
   symmetric, so the bug and the fix render identically; `/products` in Arabic
   had been showing "2 / 1" the whole time. Shipping is the run's first fixture
   with seven pages. Fixed in the primitive with `Ltr`, so orders, products,
   customers, coupons, inventory, inventory/movements and shipping all inherit
   it. **The lesson is the fixture, not the wrap:** a bidi assertion taken on a
   one-page, one-row or one-item collection proves nothing, because the broken
   order and the correct one are the same string.
2. **There was no keyboard path to the parcel drawer at `md`+.** `DataTable`
   hangs `onRowClick` off the `<tr>`, and a `<tr>` is not focusable; below `md`
   that is invisible because `RecordList` draws a stretched overlay button
   carrying `rowLabel`. Measured at 1440: one focusable per row, the anchor to
   `/orders/{id}`, which goes somewhere else. Coupons and customers are unaffected
   — there the row's anchor *is* its purpose — but here the drawer is the
   parcel's only record surface and it was mouse-only. The identifying cell is a
   real `<button>` now, not a stretched overlay, because the row already contains
   the order anchor and two interactive elements must not nest.
   **And it did not fix focus restoration for free.** Escape from a
   pointer-opened drawer still landed on `<body>`, because `useOpenerFocus`
   restores to whatever held focus at open and a click on a `<tr>` leaves that as
   `<body>`. Naming the opener explicitly is the fix, and it has to be **latched**
   in the drawer: Radix fires `onCloseAutoFocus` *after* `onOpenChange`, so a
   `returnFocusTo` derived from the open parcel is already `undefined` by the time
   it is read — which is exactly why the first attempt passed every keyboard
   assertion and still failed on the mouse. `useOpenerFocus` also gained a
   **rendered** check (`getClientRects().length`) rather than `isConnected`: with
   both presentations always in the DOM, a caller naming a control in the `md`+
   table hands it a connected, findable, `display: none` node on a phone, where
   `focus()` is a silent no-op and the fallback has already been cancelled.
3. **The provider label was English inside both localised panels.** The API's
   `label` for `manual` is "In-house delivery", and it rendered on most parcel
   rows and three times on the rules card in French *and* Arabic. It is data, but
   so is a shipment's `status`, which the panel has always translated. So
   `providerLabel` became **message key → API `label` → raw `name`**: `manual`
   reads properly in both locales, `acfake` still renders as itself rather than
   as a string the panel invented, and a real courier configured later is shown
   under its own brand — nobody translates "Yalidine". Applied at all six call
   sites including the two on the order detail. **The filter decision does not
   change**: there is still no provider filter, for the reason above.

**Two `lib/` fixes, both extending the primitive rather than working around it:**

1. **`ApiError.params` had no `Array.isArray` guard**, so `/shipping/rates`'
   bare-array `details.params` read back as `{"0":"wilaya_id","1":"commune_id"}` —
   parameter *names* posing as messages under numeric keys. `lib/api/browser.ts`
   has guarded both of its readers since the inventory branch; the server-side
   reader now matches, on `fields` as well as `params`. Every caller was checked:
   `analytics/page.tsx:147` is the only one, and it reads `.params?.range`.
   `tests/mock-api.test.ts` **asserted the broken shape as the behaviour**, which
   is how it survived — the mock could reproduce the wire and not fix the reader.
2. **`lib/shipment-status.ts` claimed the API lists statuses alphabetically.**
   Measured false: both refusals use the **physical** order — `"status is not one
   of pending, created, …, and failed."` and `"Must be one of: pending, created,
   …, failed."`. They differ in punctuation and in nothing else.

**Commune names came back on the rules list** after a first draft dropped them:
without one, a commune rule and a wilaya rule for the same wilaya both read
"Alger" and differ only by their badge — the exact ambiguity the resolver exists
to settle. One `useQueries` over the *distinct wilayas the tariff mentions* (one
request on this shop), and `placeOf` is passed down to the resolver so the winner
and the rules it beat are named with the same words.

**i18n**: the `shipping` namespace is shared — 21 of its keys are read by
`orders/[id]/ParcelsSection.tsx` and `CreateParcelDrawer.tsx`, and
`shipmentStatus` by `analytics/ShippingView.tsx`; none was renamed or removed.
Seven keys lost their last caller and went: `back`, `cancel`, `finished` (already
orphaned), `live` (the marker that is the badge spelled twice), `syncNow` (the
control that cannot act), and `tabShipments`/`parcels` (the retired Segmented).
`orderLink`, `label` and `source` were orphans and are now used. Added
`states.capability.ac_manage_shipping`, which was **missing** — the forbidden
state was falling back to printing the raw capability slug.

**`e2e/shipping.spec.ts`: 14 tests before, 14 after, titles identical.** Eight
belong to this screen and were updated for the new routes and selectors; the
orders-detail and payments tests were not touched. `:154`'s `button` row selector
became the `tbody tr, li.ui-card` visible-filtered helper coupons introduced. Two
selectors had to be **scoped** rather than merely moved: the drawer's "Suivi" and
"Transporteur" collide with the table's own column headers, and `/^Commune/`
collides with every commune-scoped rule row, whose stretched overlay button is
named "Commune · Alger · 350,00 DA".

---

## 9. Payments — ledger + COD funnel

**One route, and the two-readership property is why.** The ledger and the funnel
look like the inventory/shipping split — two datasets on one URL — and they are
not: that split needs *different data + own filters + own writes*, and
`GET /cod/statistics` takes no parameters, returns one object and is read-only.
What it would cost is the thing the page is for. Measured 2026-08-26: a **Manager
is 403 on `/payments`, `/payments/methods` and `/payments/{id}` and 200 on
`/cod/statistics`.** They land here, get a forbidden box naming the capability
where the ledger was, and read the whole report underneath it. `nav-tree.ts`
keeps its single entry.

Which is also why the funnel is a full-width block **below** the ledger rather
than a 360px aside: for that reader the report *is* the page, and an aside would
squeeze it into a third of the screen for the benefit of a table they cannot see.
Three cards — figures / current breakdown / rates — 1-up at 340, 2-up at `md`,
3-up at `xl`.

- **`DataTable`/`RecordList` + one `columns.tsx`**: `#id` (the drawer opener),
  order, method, amount, status, created. Nothing is `optional`. The amount is
  formatted with the **payment's own `currency`**, never `SHOP_CURRENCY` — a
  transaction carries one, like an order and unlike a product.
- **Four filter dimensions in one `FilterRow`, and no drawer.** Products needed
  one at nine; four fit a row and a drawer would put a modal between a person and
  a filter that was already on screen. Status is seven tabs, the first sending
  nothing — and here that is load-bearing rather than tidy, because **`?status=`
  is a 400 on this collection**, not an absence. `per_page` in the URL on the
  coupons/customers/shipping shape.
- **`FilterChips` was built, reviewed and dropped.** Four of them shipped in a
  first draft — order, method, and the two date bounds — and every one restated a
  control standing six inches above it. The argument that kept them was the
  dates: a native date input follows the *browser's* locale and renders
  `mm/dd/yyyy` in the Arabic panel, so a chip looked like the only place the
  applied bound was legible. **`echo` had already answered that**, two lines away
  in the same file, printing each bound in the page's own language directly under
  its own picker. With that gone the chips were four buttons repeating the four
  controls above them, and the status filter had already been excluded from the
  row for precisely that reason — the reason applies to all five. This is
  shipping's and coupons' rule holding at four dimensions rather than two;
  products ships chips because its seven live behind a **closed** drawer, where
  nothing is visible until it is opened. What survived is the one affordance no
  individual control offers: a single **clear-filters** button, rendered only
  when something is filtered (§3.3 — a control that cannot act is not rendered),
  dropping every dimension while keeping `perPage`. It is the same control, the
  same words and the same handler the no-results empty state offers.
- **The method picker ships where shipping's provider filter did not**, and the
  difference is the enumeration rather than the parameter — see the standing rule.
  `/payments/methods` lists `cod` and `chargily`, which sum to all 45 rows.
- **Peek drawer, yes.** `GET /payments/{id}` is **value**-identical to the list
  row — all eleven keys — so it costs no request. It earns its place on
  `metadata`, which is the record's only surface and arrives in three measured
  shapes; the failed row's `{"error":"conflict"}` is the only place a failed
  payment says *why*. Keys are printed as the provider spells them: only the key
  *sets* are measured, so formatting `fees` as money would be guessing.
- **Verify lives in the drawer with no `ConfirmDialog`.** It asks the provider a
  question and records the truthful answer; it cannot make something false true,
  and `orders/[id]/PaymentsSection.tsx` already offers it bare — two surfaces
  offering one action must behave the same. Its answer is `{report, transaction}`
  and `report.amount`/`report.currency` come back **empty**, so the report is
  never formatted as money and `report.provider_status` is what it shows.
- **The identifying cell is a real `<button>`**, not `onRowClick` alone and not a
  stretched overlay: the row also carries an anchor to `/orders/{id}` and two
  interactive elements must not nest. `returnFocusTo` is **latched** in the
  drawer, because Radix fires `onCloseAutoFocus` *after* `onOpenChange`. Driven
  in a real browser: Escape returns to `#payment-opener-5231` from a pointer
  open at 1440, to `#payment-opener-5230` from a keyboard open, and to
  `RecordList`'s own overlay button at 340.
- Stale marker on the ledger (client cache **and** it writes); none on the funnel,
  which is a Server Component with no writes and says so in its own docblock.
  `loading.tsx` matches first paint, including the label-over-control geometry of
  the three pickers.

**Nothing sorts, and no `aria-sort` is claimed.** Eleven `orderby` values × both
directions were byte-identical to the bare listing and to `?bogus_param=1`;
`sort`, `sort_by`, `order_by` and `orderby[]` likewise. The strong negative:
**`?orderby=zzz` is a 200**, so it never reaches a validator. Ties are excluded —
45 rows, 45 distinct ids, 45 distinct stamps.

**Also not shipped, each measured rather than assumed.** **No search box** —
`?search=zzz` returns all 45; it is not a parameter of this route. **No
`reference` filter**, and it *is* honoured (`AC-1`→42, and `AC`/`AC-`/`AC-11`→0,
so exact and not a prefix): the column holds two distinct values across 45 rows,
it is an opaque provider string the operator has no source for, and a typo is a
silent 200. It is shown on the record, where it can be read. **No bulk, no
export** — payments is not in `EXPORT_SUBJECTS`. **No create**, which is why
`PageHeader` carries no primary: `POST /orders/{id}/payments` mints a real
customer checkout link and the allowlist refuses it deliberately.

**The dates cut on the UTC day, not the shop's timezone.** Both bounds are
inclusive; a row stamped `23:07:26Z` — 00:07 the next day in Africa/Algiers — is
included by `date_to` of the earlier day. `2026-13-45` matches the pattern and is
a 200 with 0 rows: the router validates the shape and never the calendar, and the
panel does not get to be stricter than the API it is a client of.

**Three defects fixed, two of them older than this branch:**

1. **The empty state and the error state printed the same string.** `noPayments`
   served both a failed request and a shop with nothing in it, so the one case
   where retrying helps was indistinguishable from the one where it never will.
   That is the inventory #2 defect recurring; it is now `ErrorState` with the
   API's own sentence and a retry, against three empty states — past-the-last-page
   (which offers the way back, the inventory #3 lesson), no-results-for-filters,
   and no-transactions-at-all, which correctly offers nothing.
2. **`states.capability.ac_manage_payments` did not exist**, so the one screen in
   the panel a live tier is genuinely refused on printed the raw slug at them.
   The same hole the shipping branch found for `ac_manage_shipping`, one branch
   later. Visible on the `MOCK_IDENTITY=reduced` capture, which now reads
   "Cette section demande la permission Paiements."
3. **The provider label was English inside both localised panels**, again. The
   API's label for `cod` is "Cash on delivery", and the old screen resolved it as
   `methods.find(…)?.label ?? name` — exactly what `ShipmentRow` used to do — so
   it rendered on 43 of 45 ledger rows and on every cash transaction of the order
   detail. `lib/payments.ts` mirrors `lib/shipping.ts:149-158`: message key → API
   `label` → raw name. Applied at **both** call sites, so the order detail is
   fixed too. `chargily` has no key on purpose and keeps its brand.

**Two primitives extended rather than forked.** `DataRow` gained `hint`, a second
line under the label — the COD scope needs a slot and `label` is a `string`;
concatenating produced "Actuellement confirmées · état actuel", one run of text
where the eye wants a label and a qualifier. `analytics/CodView.tsx` renders the
same five figures and inherits it. `FilterRow` gained `align`: every filter row
before this held only unlabelled controls, and a `Select` and two `DateField`s
are a label over a box, so centred they put four controls on three baselines.

**i18n**: the `payments`, `cod`, `paymentStatus` and `codStatus` namespaces are
shared with `orders/[id]/PaymentsSection.tsx`, `CodSection.tsx` and
`analytics/CodView.tsx`; nothing they read was renamed or removed. Of the eleven
`payments` keys that had no caller, nine are now wired and **two went**: `back`
(a list page has no back link) and `verifying` (`Button` holds its label under
`loading`, so nothing could ever have read it). Added `paymentProvider` with one
key, `states.capability.ac_manage_payments`, and `a11y.paymentNumber`. Key parity
verified: 1 831 keys in each file, no orphans in the namespace, no missing keys.

**`e2e/shipping.spec.ts`: 14 tests before, 14 after, titles identical.** One
assertion changed — `:311`'s `getByRole("heading", { name: "Transactions" })` was
a `ListGroup`'s `<h2>` and the redesign has no heading over the table, so it is
`getByTestId("payments-count")`, which is rendered only past the capability gate
exactly as `parcels-count` is in the test above it. **The four payments tests
stay in this file rather than moving to `e2e/payments.spec.ts`**, and that is a
judgement rather than laziness: `:266`'s positive control is `/fr/shipping`'s own
count, so moving it would take a shipping assertion out of the shipping spec, and
moving only the other three would split a `describe` whose whole point is a
Manager reaching one subject and not the other **in one run**. The ten
shipping-owned tests were not touched.

---

## 10. `DataTable` — the row opener

**Carried forward for three branches, and it was worse than the ledger recorded.**
The entry below sat under "Carried forward" as a duplication complaint: `DataTable`
hangs `onRowClick` off the `<tr>`, a `<tr>` is not focusable, and shipping then
payments each worked around it locally. It closed with a claim that turns out to
be false, and the correction is the reason this section exists rather than a
tidy-up:

> every earlier list happened to carry an anchor that *was* the row's purpose, so
> the missing path never cost anything

**Not true for orders and products.** All seven `onRowClick` callers were driven
in Chromium at 1440 on 2026-08-26, counting the focusables in a row:

```
/orders      peek drawer   INPUT (bulk checkbox) + BUTTON "Actions"   ** NO KEYBOARD PATH **
/products    peek drawer   INPUT (bulk checkbox) + BUTTON "Actions"   ** NO KEYBOARD PATH **
/payments    peek drawer   BUTTON "#5231" + A /orders/1023            worked around locally
/shipping    peek drawer   BUTTON "ACFAKE7023" + A /orders/1023       worked around locally
/coupons     navigates     A /coupons/307                             the anchor IS the purpose
/customers   navigates     A /customers/20                            fine
/inventory   navigates     A /inventory/207                           fine
```

Orders and products carry two focusables per row and **neither is an opener**: the
checkbox selects, and the Actions menu is a menu. Their peek was mouse-only at
`md`+ — a live defect against §5, not merely an undefended primitive — and it was
the *first* screen in the run, shipped before the shipping branch ever measured
the pattern. And both drawers rendered a bare `<Drawer>`, so even given an opener
Escape from a pointer open landed on `<body>`.

**The primitive now renders the opener.** `DataTable` takes
`rowOpenerId?: (row) => string`; with it and `onRowClick` both set, the table wraps
the identifying cell's content in a real `<button>` carrying that id, stopping
propagation. Absent, nothing is wrapped — the three navigating lists already put a
real anchor there and a button around an anchor is nested interactive content,
which is exactly what payments and shipping chose the cell over a stretched
overlay to avoid. `rowOpenerId(scope, key)` is exported from the same file, so the
four screens share one definition instead of four spellings of
`` `…-opener-${id}` ``.

**The other half is a measurement, not a type.** The ledger asked for "either it
renders the opener itself, or it refuses `onRowClick` without one". A type-level
requirement gives three false positives — coupons, customers and inventory have a
legitimate opener — and would teach people to pass a value to silence a compiler.
So after mount, in development only, the table asks whether the first row's
**identifying cell** holds a tab stop and `console.error`s naming the table if
not. The identifying cell rather than the whole row is the load-bearing part: a
row-actions `Menu` is a focusable and is not an opener, so a whole-row check would
have passed the two screens this exists to have caught. One row, one
`querySelector`, `NODE_ENV`-guarded so it is dead code in production.

**And the latch moved to `useLatchedOpener` in `Overlay.tsx`**, beside
`useOpenerFocus`, where the reason lives: Radix fires `onCloseAutoFocus` *after*
`onOpenChange`, so a `returnFocusTo` derived from the open record is already
`undefined` when it is read. Only the **pointer** path depends on it — on the
keyboard the opener also held focus at open, so `useOpenerFocus`'s recorded
fallback is already correct — which is why shipping's first attempt passed every
keyboard assertion and still failed on the mouse. The two peeks that come from a
URL parameter need it most: closing clears `?peek=` and the component re-renders
with a null record before focus is restored.

Both orders and products now hand focus back to the row they were opened from,
including from the row-actions menu's "preview" item, which previously dropped to
`<body>` because Radix unmounts the item on select. Payments and shipping are
byte-identical in behaviour; the only markup change is shipping's `max-w-56` cap,
which moved from the hand-rolled button onto the `Ltr` that truncates inside it,
so the rendered box is the same.

---

## 11. Dashboard — seven figures over one window

**The section numbers have run one ahead of the checklist since `DataTable` took
§10**, which is a screen-shaped entry in a list of screens and is not one. This is
checklist item **10**. Nothing renumbered, because every reference already
written points at the numbers as they stand.

**One route, full width capped 1440** (`PageBody width="wide"`, §2.3's analytics
row) rather than the `max-w-3xl` §0 retires by name. Seven cards 1-up at the floor,
2-up at `sm`, 4-up at `lg`, the lead card double-width — which is what makes seven
cards **two full rows** instead of two rows with a hole in the second.

- **`StatGroup`/`Stat` built, and this is the branch that owed them.** §3.2 has
  specified them since the redesign began; `customers/[id]/StatisticsCard.tsx:34`
  and `payments/CodFunnel.tsx:28` each recorded "the analytics iteration owns it"
  and shipped scope-labelled `DataRow`s instead — correctly, both times, because
  those two payloads are pairs of figures that look like one figure. **And
  `StatSkeleton` had sat in `Skeleton.tsx` with no consumer**, which is a
  placeholder nobody had ever held against a real box: it was `p-5 gap-3` around
  `h-3`/`h-7`/`h-3`, and all five numbers were wrong. It now carries `Stat`'s own
  geometry — 16px of shift per tile, 112px across seven.
- **§3.2 amended: the delta slot holds a scope.** No comparison period exists in
  any of the seven payloads — no `previous`, no `change`, no series — so a delta
  would be invented. The slot takes the scope instead, which this screen needs
  three times over: `net` (booked) beside `collected` (taken), `orders_placed`
  901 beside `completed` 56 and `counted_as_revenue` 323, and
  `customers.customers` 9 — *accounts that ordered in the window* — beside 209
  `guest_orders`. The customers lesson (§5), then the payments lesson (§9), now
  the third time.
- **`low_stock` says it is current state, and the footer no longer lies.**
  Measured flat at 3 across a 90× window while `customers` moves 0→5→9: it is the
  one figure under the range control that the range does not move. Its scope line
  says so, and `dashboardNote` — which read "chaque carte … sur la période
  affichée" — now names the exception rather than claiming every figure is
  window-scoped.
- **Drill-through is capability-gated, and `DashboardCard.href` became optional
  to allow it.** The type used to "make a card without a destination
  unrepresentable", enforcing ADMIN_PANEL.md's *a number that cannot be drilled
  into is decoration*. The rule is right about decoration; the enforcement
  produced two defects. It forced `awaiting` — `pending + processing` — to link
  `?status=processing`, **half its own number**, because `?status=processing,pending`
  is a measured 400. And it forced four of a Support Agent's seven cards to link
  to a 403: that credential is refused on `/orders` and `/inventory` and 200 on
  `/customers`. So a figure with no honest destination renders **unlinked** — the
  number still shows, because the reader is entitled to it — and never a link to
  a refusal, never a disabled link. `awaiting` ships linkless for everyone. The
  two reasons stay distinguishable in the type (`requires` set with no `href` is
  a refusal; neither is a figure nothing can filter), which is what lets each be
  explained in its own words and only where it applies.
- **A caveat goes on the card that needs it; only the reader-shaped one is a
  footnote.** A first draft put four lines of prose under a seven-card grid, two
  of them answering the same question — *why has this card no chevron?* — about
  different cards. `awaiting`'s answer moved into its own **scope line**, which is
  where `low_stock` already carries its exception and where the reader is already
  looking. What is left below the grid is three lines at most: the window scope
  with `low_stock`'s exception, the report-vs-list asymmetry, and the
  refused-list line, which renders only for a reader some card is actually
  refused to. `analytics.noteAwaiting` went with it, rather than a second key
  being added beside the one it duplicated. Restraint applies to words as much as
  to decoration.
- **The three `/analytics?view=` links carry the range; the list links cannot,
  and the screen says so.** `/orders`, `/customers` and `/inventory` have no date
  parameter at all — appending one would be the panel writing a filter the API
  ignores, which is this run's oldest rule. Left unstated it reads as an
  unfinished control rather than as a property of the API.
- **New `components/ui/RangeControl.tsx`; the old one left untouched.**
  `components/patterns/RangeControl.tsx` builds its custom window in a `Sheet` —
  §0-retired, §7-forbidden — and is **shared with `/analytics`**, which is item 11.
  Migrating it in place would migrate a screen this branch does not own. The new
  one is `FilterTabs` over the six presets (the same strip the status filters are,
  scrolling rather than wrapping at 340) plus a `Modal` for the custom pair.
  **A `Modal` and not a `Popover`**, and §3.1 lists both: it puts "date ranges"
  under `Popover` and then rules that a `Popover` never holds a form that can fail
  validation. This one fails three ways, all the API's own, so the second rule
  wins — the first is describing a calendar you pick a day out of.
  `FilterTabs` gained `opensDialog`, so the one tab in the strip that collects
  input before filtering announces `aria-haspopup="dialog"` instead of looking
  identical to the five that apply immediately.
- **No chart, and the absence is the decision.** `orders.by_status` is the only
  distribution in the payload and it is exactly what `/analytics?view=orders`
  draws — a second copy of one report, on the screen whose job is to hand people
  off to it.
- **No stale banner; an "as of" line instead, and §3.7 carries the extension.**
  The screen rendered `StaleBanner` behind `!navigator.onLine` — an offline marker
  on a page with no writes to disable, which is `CodFunnel`'s reasoning. What is
  true is different: the report sits behind a **60-second server cache**
  (`meta.cache_ttl`, and two live requests six seconds apart returned one
  `generated_at`), so a Server Component can legitimately hold figures older than
  the navigation, by a published amount. That is a timestamp, not a warning state.
  Rendered with `formatDate` rather than `formatWhen` **for a mechanical reason**:
  a relative time computed from `new Date()` on the server and again on the client
  differs the moment a rounding boundary falls between them, which is a hydration
  error the capture harness fails on.
- **The error state reads the refusal instead of discarding it.** `page.tsx` ended
  in `.catch(() => null)`, so a 400 on a malformed custom window and a dead
  network produced the same screen and neither said what happened. Two of the
  three fields are load-bearing now: **status**, because a 403 is a forbidden
  state and not an error state, and **message**, because this route answers with
  two different refusal shapes — `details.params.range` for a bad preset and
  `details.fields.date_*` for a bad custom window, with a different top-level
  sentence on each path — so `apiMessage` alone is "The reporting range is
  invalid." and the useful half is in the details. A bad `range` cannot arrive
  (`rangeFromParams` resolves an unknown preset to the API's own default); a bad
  custom *window* can, by URL, which is why the path is real rather than
  defensive.
- **And the sentence is the panel's own wherever the panel has one.** A first
  draft rendered the API's English into a French and Arabic screen — "The
  reporting range is invalid. Required when range is custom." — which is the
  **fourth** time this run has fixed that class, after the provider labels,
  `unavailable` and `scope_note`. What "surface the API's own message" protects is
  the *information*, never the provider's English, and all three refusals this
  route makes about a custom window are already mirrored in
  `customRangeProblem()` with localised copy the range control renders while
  somebody is still typing. So the panel asks **its own mirror** which refusal
  this is rather than parsing the API's prose for it — a sentence can be reworded
  upstream, a window is a fact — and consults it only when `details.fields` names
  one of the two dates, so an unrelated 400 can never be answered with a sentence
  about a window. `ErrorState.detail` stays the slot for genuinely foreign text
  and gets the API's own words only when the mirror has none, which is exactly
  `unavailableLines()`'s rule. **"Unreachable through the controls" is not a
  defence** — it was said about two of the previous three.
- **The empty window keeps its cards.** `range=today` answers 200 with every
  figure zero, so the screen says the window was quiet rather than reading as a
  report that failed. The `EmptyState` sits **above** the grid rather than
  replacing it, and that is `low_stock` again: it is a real figure inside an empty
  window, and an empty state that swallowed the grid would hide the one number
  still worth reading. §3.7's distinction applies with the window as the filter,
  so it offers to widen — to the widest preset the API has, and on `90d` the
  action is not rendered rather than rendered doing nothing.
- **`nav-tree.ts:62` gave `/dashboard` no capability** while the route refuses
  without `ac_view_analytics` — a nav entry whose only possible outcome for some
  sessions was the forbidden screen, against the rule that file's own docblock
  states. `/analytics` beside it had held the capability all along.
- `loading.tsx` matches first paint: the header block, the six-preset strip over
  the applied-window line, the "as of" line, seven tiles with the lead one
  double-width, and the three footnotes.

**i18n**: the `analytics` namespace is **shared with `/analytics`** (item 11) and
nothing it reads was renamed or removed — checked key by key. Six keys added
(`cardsLabel`, `asOf`, `asOfCached`, `emptyWindowDetail`, `noteRange`,
`noteForbidden`), three rewritten (`dashboardNote`, `cardScope.low_stock`,
`cardScope.awaiting`), and one — `noteAwaiting` — added and then **removed** when
its sentence moved onto the card's own scope line, rather than left beside the
key that now says the same thing. `errorMissing`, `errorReversed` and
`errorTooLong` gained a second caller in the error state and are the reason no
new key was needed for it. Nothing lost its last caller. **1 837 keys in each
file, at exact parity.**

**`tests/setup.ts` gained a `scrollIntoView` no-op.** jsdom implements no layout
and therefore no `Element.scrollIntoView`; `FilterTabs` calls one to keep the
active tab in view when a filter is restored from a URL. Stubbed in the harness
beside the `IntersectionObserver` no-op rather than guarded inside the primitive —
a `typeof … === "function"` check there would be defensive code for a browser that
does not exist. It had never surfaced because no component test had rendered a
`FilterTabs` before; the dashboard's is the first.

**`e2e/analytics.spec.ts`: 18 tests before, 18 after, titles identical.** Three of
the four dashboard tests changed and the fourth (`:73`, one request) needed
nothing — its selector is the card test id, which did not move. `:50`'s "every
card carries an `href` matching `/^\/fr\//`" became **"every card that has a link
points into the panel"**, which is the same guarantee correctly scoped now that
some cards are deliberately linkless, plus a floor on how many links there must be
so the scoped form cannot pass vacuously on a grid of seven plain cards. `:288`
gained `card-net` containing "DA" — the positive half of `:316`'s
`not.toMatch(/\bDA\b/)`, which without it would also pass on a screen that
rendered no figure at all. `:316` keeps all five of its assertions and adds the
second gate: the four cards this credential is refused on are visible, are not
anchors, and carry no `href` — asserted on the element, because a disabled-looking
anchor is still one the keyboard follows — against `card-customers`, which is
`/fr/customers` because that is the collection the same credential is 200 on. The
other fourteen belong to `/analytics` and were not touched.

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
- **The five mock-vs-API divergences from the coupons honesty audit: measured,
  and four were real.** Fixed in `scripts/mock-api.mjs`: the empty `code` (a 200
  that blanked a coupon's identity — the destructive one); `email_restrictions`
  accepting non-addresses; `orderby=""`/`order=""` read as absence, which is a
  400 on every collection that validates a sort; and the four unrefused
  `per_page`/`page` edges, now in the shared `paginate()` so the pickers refuse
  them too. **The picker one was not a defect** — measured 2026-08-25, the
  pickers really do validate nothing but paging, and their docblock now says so
  with the date so a third audit does not re-open it.
  Four more surfaced while measuring, all fixed: `oxford()` wrote a two-value
  enum as `asc, and desc` where WordPress writes `asc and desc`;
  `/products?status=` was a 200 where it is a 400 (`""` is in the coupon status
  enum and not the product one, which is also why `/coupons?status=` stays a
  200); `?per_page=`/`?page=` are type refusals rather than absences; and **every
  enum message in the file was missing its full stop.** The three refusal
  families are now written down and differ — enum and type sentences end in `.`,
  range sentences do not — behind one `notOneOf()` helper so the next enum
  cannot drift.
- **Every error `code` in the mock was WordPress's, not the wire's.** Found by
  diffing live against the mock request-for-request rather than by reading
  either: all fourteen parameter refusals answered `rest_invalid_param`, a code
  no client can receive, because `ErrorNormalizer.php:31-32` maps it to
  `invalid_request` on the way out. The wire vocabulary is four values —
  `invalid_request`, `not_found`, `conflict`, `unauthenticated`. It survived
  because **every assertion compared the sentence and none compared the code**;
  no screen branches on it today, which was checked rather than assumed. That
  request-for-request diff is now the thing to run on any collection before
  trusting it — it caught in one pass what three readings of the file had not.

  **Corrected 2026-08-26: those four are what a *parameter refusal* can carry,
  not the whole wire vocabulary.** `ErrorNormalizer` rewrites WordPress's
  parameter codes and leaves a controller-raised **domain** code alone, so the
  two sets are different things. A Manager refused `/payments` answers
  `forbidden` — the second domain code found outside the four, after
  `sync_unsupported`. Neither is a hole in the list; the list was about the wrong
  half of the surface. The count is the trap: "four values" reads like an
  enumeration of everything and is an enumeration of one family.
- **The mock's `DEFAULT_PER_PAGE` was 10 and every collection in the API answers
  20.** Checked on nine of them, 2026-08-26. Quieter than a permissive mock and
  the same class of defect: a screen that forgot to send `per_page` would have
  rendered ten rows against the harness and twenty against the shop, so every
  340px overflow assertion was watching a table half the real width. Fixed on the
  payments branch.
- **`list()` gave every collection the full paging envelope; the API has three
  shapes.** Measured 2026-08-26: none at all on `/payments/methods` and
  `/shipping/providers`, `{total}` alone on `/locations/wilayas`, paging on the
  rest. Now `enumeration()`, `counted()` and `list()`, chosen by naming one so a
  fourth enumeration inherits the right shape rather than the commonest.
  **Six routes remain on `list()` with their live shape unverified** — the four
  order sub-resources, `/shipping/rates` and `/attributes` — and they are named
  in its docblock. They are the next request-for-request diff.
  Separately, `/locations/wilayas` holds **58 rows in the mock against 69 live**;
  that is fixture completeness rather than envelope shape, and nothing on any
  migrated screen reads past the ones it has.
- **Re-measure every collection's `orderby` before trusting it.** Two of them
  were recorded dead and were not, and in both cases the record outlived a
  backend repair rather than ever having been wrong. `/orders`, `/customers`,
  `/customers/{id}/orders` and `/notifications` all still carry "accepted and
  ignored" from dates nobody has revisited. The check is cheap and the shape is
  known: compare each value's full id sequence against **the order its own field
  implies**, never against the collection's default, and count the distinct
  values so a fixture that ties on every row cannot pass as proof.
- `ConfirmDialog` focuses its × button rather than Cancel, contradicting §3.1.
  Radix's `FocusScope` wins over `autoFocus`; needs a second focus prop.
  **Still true, and now visible on a screenshot** — the shipping rule-delete
  dialog opens with the focus ring on ×, which is the one control that is not the
  safe default. Unchanged here because it is a primitive fix affecting every
  destructive dialog in the panel.
- The sticky first column has no divider at its frozen edge.
- ~~**`DataTable.onRowClick` still hands its caller a `<tr>` and no keyboard
  path.**~~ **Closed — see §10**, which also corrects this entry's claim that
  "every earlier list happened to carry an anchor that *was* the row's purpose".
  Orders and products did not: their peek was measured mouse-only at `md`+, so
  this was a live defect on two shipped screens and not only an undefended
  primitive. `DataTable` now renders the opener from `rowOpenerId`, warns in
  development when a clickable row has none, and the latch lives in
  `useLatchedOpener`.
- **`POST /orders/{id}/cod/attempts` is the last create still pinned at 200 and
  never measured.** Three of the four were measured on 2026-08-25 and all three
  answered **201** — `/shipping/rules`, `/coupons`, `/orders/{id}/shipments` — so
  200 is now the odd one rather than the safe default. It is unmeasured because
  provoking it is **irreversible, not because it is unreachable**: a coupon can be
  force-deleted and a parcel cancelled, but a recorded delivery attempt cannot be
  un-recorded. Whoever is willing to spend one on a disposable order should take
  it.
- **The API names a legal set in `details.available` and nothing reads it.** A
  rule refusing an unregistered provider answers `{"fields":{"provider":"Unknown
  provider \"acfake\"."},"available":["manual"]}` — `available` a *sibling* of
  `fields`, not a member. It is the service a 409's `allowed` array performs for
  order transitions, and `ApiError` exposes `fields` and `params` and nothing
  else. Not wired on shipping deliberately: the provider picker is what keeps that
  refusal unreachable. A screen that ever lets someone type a provider will need
  it.
- ~~**`GET /analytics/shipping` is the one allowlisted route on this subject still
  answering `rest_no_route`**~~ — **struck 2026-08-26: it answers 200 with a full
  payload**, `{range, shipments{total, by_status{…}}, …}`, and does so for a
  Support Agent as well as a Super Admin. The record outlived a backend repair
  rather than ever having been wrong, which is the *third* time that has happened
  on this run after the two `orderby` cases — and it is the same failure mode each
  time: a measurement is written down, the backend moves, and nothing re-takes it
  because the note reads like a property of the API rather than a dated
  observation. It stays unimplemented in the mock and listed `UNCOVERED`; the
  analytics branch (item 11) owns building it, and now has one less excuse.

  The general lesson is worth more than the entry: **a "this route is broken"
  note needs a date and a re-check, exactly as a "this parameter is ignored" note
  does.** Absence of capability is not more durable than presence of it.
- `@hookform/resolvers` is imported nowhere; `react-hook-form` only by the login
  form.
- `movementReasonHint` has no caller in either message file. So do `cod.turnOff`
  and `cod.reasonPlaceholder` — both predate the payments branch (checked against
  `main`) and both belong to `orders/[id]/CodSection.tsx`, which is unmigrated.
- **Nothing in the panel meets §5's 44px touch target, and it is the primitives
  rather than any screen.** Driven at 340 under a coarse pointer, measuring the
  union of each control's own box and its `::after` — because §5 says the hit
  area comes from a pseudo-element, so `getBoundingClientRect()` alone measures
  the wrong thing. Offenders, every one shared: `FilterTabs`'s `ui-tab` at
  `min-h-10` (40px), `SearchField` at `min-h-9` (36px), `TableFooter`'s per-page
  `<select>` at `min-h-7` (28px), `AppShell`'s three theme buttons at `size-7`
  (28px), and the `sr-only` skip link at 24px. The last three fail even the 32px
  **pointer** floor. Measured identically on `/payments` (13) and `/shipping`
  (18, the difference being its own extra tabs), so this has been true of every
  migrated list since orders and no screen introduced it. `.ui-tap` exists and
  gives icon buttons their 44px; these controls simply never got it.
- **Two docblocks name a file that no longer exists.** `scripts/mock-api.mjs:3041`
  and `tests/mock-api.test.ts:435` both explain the English-label defect by
  pointing at `PaymentsScreen.tsx`, which the payments branch deleted and whose
  defect it fixed. The prose is now stale in a file the branch was told not to
  touch — both are done and committed — so it is recorded here rather than
  edited. The measurement they carry (`cod` → "Cash on delivery") is still right
  and is still what the fixture asserts; only the sentence about who renders it
  wrongly has expired. `lib/payments.ts` is the file to name.
