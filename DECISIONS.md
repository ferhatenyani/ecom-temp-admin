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
[x] 11. Analytics — revenue / orders / products / customers / shipping / COD
[x] 12. Content — pages, page form, banners, FAQs, homepage, menus, index
[x] 13. Media
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
its classNames is not migrated. `grep -rL 'ui-' --include=*.tsx app/` — **50
files left**, down from 53 after the content branch. Read it as an **upper
bound**: the heuristic starts producing false positives exactly as the migration
succeeds, because a fully migrated screen whose every class comes from a
primitive contains no `ui-` string of its own. Content added none, and neither
did media — its four files all carry one, and `UploadSheet.tsx` was deleted
rather than migrated — but `CustomersView.tsx` and `CodView.tsx` still do not.

---

## Standing rules these pages established

Apply these to every remaining screen unless something measured says otherwise.

| Rule | Why |
| --- | --- |
| **Sorting ships only with a positive control** — and the control must not be the collection's *default* ordering. Products, coupons and media. | Two values agreeing *with each other* proves nothing, and a value that is already the resting order proves nothing either — `date` on coupons tied on every row and answered the bare listing, which is how "validated then ignored" got recorded for a working sort. Absence of a positive control is not evidence of absence: go and take one. **Media is what that last sentence costs when nobody acts on it** — §14 recorded a working sort *and* a working search as broken for a fortnight, and both took one request each to disprove. "Treated as broken" is a holding position, not a verdict. Orders, customers and inventory still ship none. |
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

## 12. Analytics — six reports over one window

Checklist item **11**; the section numbers still run one ahead because §10 is
`DataTable`'s row opener, which is not a screen.

**One route, `?view=`, and the window is the whole reason.** The six reports share
a date range; six routes would mean six copies of the control and a window that
resets on every move between reports — a person comparing COD confirmation
against shipping delivery over the same fortnight would set the fortnight twice.
`query.ts`'s contract is unchanged: six views, `DEFAULT_VIEW = "revenue"`, an
unknown view falls back, defaults omitted from the URL.

- **Two controls, and they are deliberately not peers.** The report selector is
  *navigation* — which report am I reading — and the range is a *filter* over
  whichever one that lands on. Two identical `FilterTabs` strips stacked would
  flatten that into two filters of equal rank, which is the one thing this screen
  had to get right. So **`FilterTabs` gained `variant`** rather than this screen
  hand-rolling a second control: `tabs` is the default and unchanged (full-bleed,
  closed by a rule, the selected label underlined in ink — every list's own
  primary axis) and `chips` is new (a *labelled* group of pills inside the content
  column, no bleed, no rule). The selector takes the first, the range the second,
  in the dashboard's vertical order.
  The old screen hand-rolled six `<button aria-pressed>` on `.pill-row` and
  `.tonal` — both retired, and `.tonal` measured at 1.98:1.

  **`RangeControl` renders `chips` unconditionally, and `/dashboard` moved onto
  it — the variant is not a prop.** A first version left the dashboard on the
  default strip and defended the difference by *rank*: there the window is the
  only control on the screen and therefore is its axis. That is true and it is
  not the objection. The objection is **positional**: the dashboard's strip sits
  in the same slot — directly under `PageHeader`, bleeding the gutter, the
  selected label underlined in ink — that `/analytics` uses for its **report
  tabs**, so the identical control in the identical position would mean *which
  period* on one screen and *which report* on the other, one nav item apart. Rank
  does not rescue that. Unified downward instead, and the rule is now one sentence
  that holds panel-wide: **a full-bleed underlined strip under the header always
  means which view; a labelled "Période" chip group always means the window.**
  It is not a prop because there is no screen on which the second half is wrong.
  The dashboard loses nothing and gains the visible label, which is a straight
  improvement on six bare words under a title; `dashboard/loading.tsx` was
  re-measured to the 36px chip band in the same edit.
- **`PageBody width="wide"`, and report sections 1-up at the floor, 2-up at `lg`.**
  §2.3's 1440 analytics cap; the screen was the last one still rendering a 768px
  stripe down the middle of a monitor. Two columns is the honest maximum — a
  section is a list of labelled figures and a third column would put a wilaya's
  name under 200px. `items-start`, because the sections differ wildly in length
  and a stretched short card is a card with a large empty foot.
- **A headline `StatGroup` on four reports of six, and the two absences are the
  payloads.** `products` leads on one figure because it has one — `low_stock`,
  which the range does not move — and `cod` leads on none: it is five figures of
  one kind, two of which are the same word at two scopes, which is exactly the
  case `payments/CodFunnel.tsx` argued out of a stat block and into scope-labelled
  `DataRow`s. That argument survives `Stat` gaining a scope slot, because the COD
  scope is not a qualifier on a headline, it is the thing that tells two rows
  apart. The two surfaces now render that payload identically.
- **`Figure` wraps `Stat` and makes `scope` required, which is the old
  `FigureRow.scope` enforcement kept through the migration.** `Stat.scope` is
  optional and correctly so — a dashboard card whose scope would restate its label
  is right not to pass one — and on this screen it is never optional. That
  enforcement is *why* the screen never shipped a bare pair in three iterations,
  and there are six traps here: `orders_placed` 901 against `orders_counted` 323;
  `net` against `collected`; `guest_orders` **422 on the orders report and 209 on
  the customers one**, all statuses against counted only; `by_status.confirmed` 84
  against `confirmed_orders` 126, now against ever; `customers` 9, meaning accounts
  that ordered *in this window*; and `low_stock` 3, which is current state. The
  seventh is not a figure — `unattributed.orders` **281 against 42 across both
  named wilayas** — so it carries its scope as the section's own footnote, naming
  the imbalance rather than leaving the reader to add the rows up.
- **`components/ui/Bar.tsx` is new, and `.bar-track` / `.bar-fill` /
  `.bar-fill-muted` kept their class names.** `e2e/analytics.spec.ts:437` measures
  the fill's rectangle against its track's by raw class, which is the suite's only
  proof that an RTL bar grows from the right rather than merely claiming to; a
  rename would take that with it, and a bidi assertion cannot be rewritten as an
  assertion about markup. Only the three colours moved to the `ui` tokens — and
  **the mark is ink rather than accent**, because §3.3 and §8 both reserve the
  accent for links, focus and selection, and a blue bar directly under a
  blue-underlined tab strip reads as a second selection state rather than as data.
  `hasRankingSignal` still decides whether a chart is drawn at all, and the wilaya
  `muted` fill still marks a different *kind* of row rather than a smaller one.
  Two fixes the primitive gained on the way, both from reading captures:
  **`share: null`** for a set with no ranking (a share of 0 would draw ten
  identical 2px nubs, because the fill has a 2px floor so that one order out of
  379 is not an invisible track), and **a genuine zero draws no mark at all** —
  `returning: 0` rendered that same nub, which says *a little* in the one place a
  bar is allowed to carry a number. Seen on the Arabic capture at 768.
- **DESIGN.md §3.5 amended, and §8's checklist line with it.** Both said "no
  coloured bar of any kind" while §3.2 has specified a bar chart since the
  redesign began, so a careful reader meets both rules on one page and has to
  guess. The enforcement settles it and always did — `border-{l,r,s,e}-{2,4,8}`
  is a **border** on a row's leading edge, standing in for a status the row should
  have spelled out. A decorative bar encodes meaning in a colour and nowhere else;
  a data mark's length *is* the datum and its value is printed as text beside it.
  The word "decorative" was always meant and was never written.
- **`best_sellers_limit` is 10, published and not adjustable, and the footnote
  says so.** Measured: `limit=3`, `per_page=3` and `best_sellers_limit=3` each
  answer ten rows with the field still reading 10. So there is no "show more" —
  and the absence is *stated* where the limit is rendered rather than left looking
  like an unfinished control, which is this run's oldest rule wearing its other
  face.
- **Two links are capability-gated, which the old screen did not do.** The
  best-seller rows led to `/products/{id}` and the low-stock figure to
  `/inventory` for every reader. A Support Agent is **403 on `/inventory`** —
  measured on the dashboard branch — so that figure now renders unlinked, and the
  product names render as plain text without `ac_manage_products`. The figure
  always stays: a refused destination is not a refused number. The low-stock link
  also drops at **zero**, because there is nothing to open.
- **The money gate is unchanged in behaviour, because it was already right.** The
  panel *asks* `/analytics/revenue` and renders the refusal: `ForbiddenState`
  **inside** the report box, with the toolbar, the report tabs and the range
  control all still live, so the reader can move to a report they can read. The
  capability comes from **`meta.money_requires`** with `canSeeMoney()` only as the
  fallback for a 403 body that carries no meta. The other five degrade in place —
  measured, a Support Agent gets 200 with zero money keys anywhere, nested
  included, and `money_visible: false`. Verified on the `MOCK_IDENTITY=support`
  captures of all four reachable reports: no `DA` anywhere, no currency-shaped
  hole, and the wilaya rows keep their share and drop their revenue.
- **`StaleBanner` dropped; an "as of" line instead.** It fired on `!useOnline()`,
  which is an offline marker on a page with no writes to disable and no client
  cache to go stale — §3.7 as amended on the customers and dashboard branches.
  What is true is different and published: the reports sit behind a **60-second
  server cache**, and `meta.cache_ttl` was *fetched by this page and never read*.
  It is read now, in the dashboard's own two keys, rendered with `formatDate`
  rather than `formatWhen` for the mechanical reason that a relative time computed
  on both sides of hydration differs across a rounding boundary.
- **The empty window keeps the report.** It used to *replace* it; it now sits
  above it, which is the dashboard's arrangement and `products` is why — its
  `low_stock` is a real figure inside an empty window, and an empty state that
  swallowed the report would hide the one number still worth reading. That also
  let `products` **join** the emptiness check it used to be excluded from, and it
  is the one view that renders `emptyWindowDetail`, because it is the only one the
  sentence is about. The offer widens to `90d` and is not rendered there.
- **The error state stopped rendering the API's English into a French and Arabic
  panel.** This screen has printed `details.params.range` and
  `details.fields.date_*` raw since it shipped — "The reporting range is invalid.
  Required when range is custom." — which is the class of defect the dashboard
  branch fixed as its fourth instance. It now asks `customRangeProblem()`, the
  panel's own mirror of all three refusals, and only when `details.fields` names
  one of the two dates, so an unrelated 400 can never be answered with a sentence
  about a window. `ErrorState.detail` keeps the API's words where the mirror has
  none, and the state gained the retry it never had.
- **`loading.tsx` draws the screen.** It was `SkeletonRows rows={6}` inside a
  `max-w-3xl` stripe against a real paint of a headline row and two to five titled
  sections at 1440. It now draws the header, both strips at their measured heights,
  the applied-window line, the "as of" line, four tiles and two titled cards —
  which is the shape of four reports of six and of `revenue`, the default view.
  It cannot do better: `loading.tsx` receives no `searchParams`, so it cannot know
  which report is coming. `products` and `cod` settle by one row rather than by the
  whole page.

**i18n**: the `analytics` namespace is **shared with `/dashboard`** and nothing it
reads was renamed or removed — checked key by key against `DashboardScreen`,
`RangeControl` and the dashboard's `loading.tsx`. Seven keys added (six `scope.*`
for the guest, first-order, prior-order and two parcel populations, plus
`byWilayaNote`), one rewritten (`bestSellersLimit`, which now states that the
limit is the API's), and **six removed for losing their last caller**:
`revenueHeadline`, `ordersHeadline`, `customersHeadline` and `shippingHeadline`
were `ListGroup` titles the `StatGroup` replaced, `lowStockTitle` duplicated
`lowStockLabel` once the figure became a tile, and `lowStockNone` served an empty
state that a tile reading `0` says better. Four `cardScope.*` keys gained a second
caller here, which is why no new scope key was written for `net`, `customers`,
`low_stock` or the two shipping rates — a reader arriving from a dashboard card
meets the same sentence on the report it opens. **1 838 keys in each file, at
exact parity.**

### Four carried-forward items cleared on this branch

**1. The 44px touch target, panel-wide — and it is now measured rather than
argued.** The ledger listed five offenders and the fix is `.ui-field`'s shape:
everything behind `@media (pointer: coarse)`, or on a pseudo-element, so no
pointer layout moves. Driven in Chromium in three modes, taking the union of each
control's own box and its `::after` — because §5 says the hit area comes from a
pseudo-element, so `getBoundingClientRect()` alone measures the wrong thing:

```
                              pointer:fine   coarse/phone   coarse/tablet
  .ui-tab      (was 40)         63 × 40        63 × 44        63 × 44
  .ui-chip     (new, 36)        94 × 36        94 × 44        94 × 44
  SearchField  (was 36)        282 × 36       312 × 44       282 × 44
  per-page select (was 28)      58 × 28  !!    58 × 44        58 × 44
  theme button (was 28)         32 × 32        (in a closed drawer)  44 × 44
  skip link    (was 22)        145 × 44       145 × 44       145 × 44
  floor                             32             44             44
```

Each by the mechanism its element allows. `.ui-tab` and `.ui-chip` grow their own
box, because they are text controls with nothing to keep small. `SearchField`'s
input took `.ui-field` — identical at 36px on a pointer, so nothing moved, and
it is the utility that exists to answer "which pointer is this person using",
which hard-coding `min-h-9` had bypassed. The three theme buttons took `.ui-tap`,
which is §5's own prescription — the drawn box stays `size-7` and only the hit
area grows, so the sidebar foot does not move.

**Two of the five were not what the ledger said they were.** The skip link's 22px
is not the `sr-only` state, which is 1×1px and correctly has no target at all —
it is the **focused** state, where `.focus\:not-sr-only:focus` sets `padding: 0`
at a higher specificity than the unconditional `px-4 py-3` and silently ate 24px
of block padding. `focus:min-h-11` fixes it without a specificity fight, because
`min-block-size` is the one property `not-sr-only` does not reset. And the theme
buttons failed the **pointer** floor as well as the touch one, which the
pseudo-element closes at both.

**The per-page `<select>` stays 28px on a pointer, 4px under §5's floor, and that
is a recorded residual rather than an oversight.** A `<select>` is a replaced
element rendered from a UA shadow tree, so `::after` never paints on one, and a
pseudo-element on a *wrapper* would be worse than nothing — hit-testing routes to
the originating element, so the extra ring would swallow taps that opened no
dropdown. Closing it means growing the control, which grows the footer row on all
seven shipped list screens. See Carried forward.

**Proved by an A/B rather than asserted**: `/orders` and `/payments` were captured
with the touch changes in place and again with only those changes neutralised —
36 PNGs across 340/768/1440 × light/dark × fr/ar, **all 36 byte-identical**.

**2. `ConfirmDialog` now focuses Cancel, and `autoFocus` could never have done
it.** §3.1 has required it since the redesign and `ConfirmDialog`'s own docblock
asserted it as rule 2; both were false on every destructive dialog in the panel.
Radix's `FocusScope` moves focus after mount to the first tabbable node in the
content, which is always `OverlayFrame`'s × — the one control that is not the safe
default. `Modal.initialFocus` is the second focus prop the ledger said it needed:
an **id** to match `returnFocusTo`, honoured in `onOpenAutoFocus` by
`preventDefault()` (which is what `FocusScope` checks before doing its own
focusing) and an explicit `focus()`, and only while the named node is *rendered* —
cancelling the default and then focusing nothing puts focus on `<body>`, which is
worse than the × it replaced. Driven in Chromium from a `Menu` item, which is the
hard path since Radix unmounts the item on select: `rules · delete → BUTTON
"Annuler"` and `coupon · delete (type-to-confirm) → BUTTON "Annuler"`, against
`BUTTON "Fermer"` on a build with the change reverted.

**3. Three orphan message keys removed**, verified against `main` as predating
this branch and confirmed to have no caller in `app/`, `components/`, `lib/`,
`e2e/` or `tests/`: `movementReasonHint` (three sub-keys), `cod.turnOff` and
`cod.reasonPlaceholder`. **1 833 keys in each file, at exact parity.**

**4. Two stale docblocks repointed at `lib/payments.ts`.** `scripts/mock-api.mjs`
and `tests/mock-api.test.ts` both explained the English-label defect by naming
`PaymentsScreen.tsx`, which the payments branch deleted and whose defect it fixed.
Prose only — no fixture and no assertion was touched, and the measurement they
carry (`cod` → "Cash on delivery") is still exactly what the fixture asserts.

**The `grep -rL 'ui-'` progress check now over-reports by two, and it is the check
that is wrong rather than the files.** It reads 71 unmigrated `.tsx` under `app/`,
down from 79 — but `CustomersView.tsx` and `CodView.tsx` are fully migrated and
contain no `ui-` string at all, because every class they render comes from
`Card`, `DataList`, `DataRow`, `BarList`, `BarRow` and `Figure` rather than from a
className they wrote. That is the *end state* the heuristic exists to move screens
towards, so it starts producing false positives exactly as the migration
succeeds. The real count is 69. Read it as an upper bound from here on.

**`e2e/analytics.spec.ts`: 18 tests before, 18 after, titles identical, and the
fourteen that belong to this screen needed one comment fixed and nothing else.**
That is the outcome the selectors were chosen for rather than a claim that nothing
moved: `report-<view>` is still produced at exactly one place, `range-applied`
already came from `ui/RangeControl.tsx` and survived the swap, both strips are
still `<button>`s carrying the same French labels, `.bar-fill` kept its class, and
the first `[data-numeric]` inside `report-revenue` is still an `Ltr`-wrapped money
figure rather than an `Isolate`-wrapped sentence. The one edit is `:168`'s comment,
which said "the sheet's description" about a control that is now a `Modal` — the
`Sheet` is §8-forbidden and the word would have sent the next reader looking for
one. The four dashboard tests were not touched.

---

## 13. Content — three kinds of work under one capability

Checklist item **12**; the section numbers still run one ahead because §10 is
`DataTable`'s row opener, which is not a screen.

**The item was framed as one screen and is three.** The scout said so before any
code was written and was right: the seven routes share a capability and a URL
prefix and **nothing else** — no query contract, no envelope, no row shape.
`content/page.tsx`'s own docblock had been arguing it since it was written. What
they actually are: **pages**, a real paged list plus a real form (the `coupons`
shape); **banners and FAQs**, small unpaged collections reordered in place with
no save bar; **homepage and menus**, whole-document `PUT` editors with a dirty
save bar, positional errors and caps. They ship as eight routes, not one with a
`?view=` — this is the shipping/inventory case rather than the analytics one,
because analytics' six reports share a **window** and these six share nothing a
control could sit above.

**The index survives, and its old justification did not.** It defended itself
against a `Segmented` control, which §0 retires, so that argument expired with
the control. What replaces it: `/inventory` and `/shipping` reach their second
route from the first's header, which is right for two and is chrome at six; and
six destinations sharing a prefix are not a sidebar group, because `AppShell`'s
tree is by domain. What earns the navigation is the **count** — "Bannières 5"
tells somebody whether to go in. New `NavList`/`NavRow` in `Card.tsx`: a real
`<ul>` of real anchors. Not `Stat`, because a count here is a hint on a
destination rather than a metric, and at `--text-display` it would claim to be
the reason the screen exists. `hubNote` lost its first sentence, which listed the
six rows sitting directly under it.

**`/media` is on the index and in the sidebar, and both are honest.**
`nav-tree.ts` files it under *catalog* because most of that library is product
photographs; the index files it under *content* because it is also where a
banner's picture comes from. Two front doors to one screen is what
`/inventory/movements` already has. Recorded rather than "fixed" — removing
either takes a true statement off a screen.

### Pages

- `DataTable`/`RecordList` + one `columns.tsx`: title (a real anchor), path,
  modified, and `id` behind the picker. Status is a **badge on the title, not a
  column** — the coupons argument, and stronger here, because this list opens at
  `?status=any` so drafts sit among published pages and `publish` is most of the
  shop.
- **The status tabs are inverted and that is the screen's one real trap.** On
  `/cms/*` the absence of `?status=` means **publish only**, so "all" is an
  explicit `?status=any` and it is `publish` that is the filter. The tab omitted
  from the URL is therefore `any`, which is the opposite of every other list.
- **`PER_PAGE` 50 → 20.** 50 was neither the API's figure (measured at 20 across
  nine collections) nor the panel's (every migrated list opens at 20), and it had
  a quiet cost: this shop sits under it, so **the pager had never once been
  exercised** — a rendered control with no fixture behind it. The mock now seeds
  62 pages and both readings page.
- **No sorting, and the reason changed from "none" to "unmeasured".** `query.ts`
  said "There is no `orderby`. The index is ordered by title on the server",
  which is a statement about the route's *default* and was being read as a
  measurement of the *parameter*. Nothing in this repo records `orderby` on any
  `/cms/` collection either way. The difference is load-bearing: "ignored" closes
  the question, "unmeasured" leaves it open, and this run has twice found a
  control recorded dead that the backend had since repaired. `query.ts` now names
  the measurement to take.
- **A colliding row is inert, and `DataTable` grew `rowClickable` to make it so.**
  Two pages can share a `path` — `wp_unique_post_slug()` does not run for a draft
  — so `get_page_by_path()` resolves one and the panel cannot tell which;
  following any of them is a coin flip that ends in editing somebody else's page.
  The alternative was a table-level `onRowClick` that silently no-ops on some
  rows, which is a dead control wearing a live one's hover fill and pointer
  cursor. The opt-out is honoured in **all three** places the affordance lives:
  the `<tr>` and its hover state, the identifying cell's opener button, and
  `RecordList`'s stretched overlay. **`useOpenerAssertion` had to learn about it
  too** — it reads the *first* row, so a correct collision row in first position
  would `console.error` about a row doing exactly the right thing, and the
  capture harness fails on a console error. This is the run's first fixture for
  that branch at all: the seed had deleted the 78 colliding pages, so the code
  path had been rendering to nobody since it was written.
- No peek (`GET /{id}` carries `content`, `excerpt` and the whole resolved `seo`
  block — the index is deliberately less than a page and the backend asserts the
  omission), no bulk, no export (`content` is not in `EXPORT_SUBJECTS`).

### The page form

- `PageBody width="form"`, `Card` sections, `SaveBar` when dirty, `ErrorSummary`
  with orphan failures as text. Delete moved from a "danger" group at the foot of
  the form into the header `Menu` → `ConfirmDialog`.
- **No type-to-confirm, and the first draft had it.** §3.1 asks for the record's
  identifier on an **irreversible** act; `DELETE /cms/pages/{path}` is the
  *trash*, and `deleteConfirmBody` says so in as many words. A typed path against
  copy promising recoverability is a guard arguing with its own dialog, and it is
  how typing becomes something people do without reading. The dialog names the
  record instead — §3.1 as amended on shipping. **Agent E reached the same
  conclusion from a different direction and it is the stronger one:**
  WordPress texturizes these strings, so a banner called "Soldes d'été" carries
  U+2019 and **cannot be typed from the screen at all**. A guard nobody can
  satisfy is a dead end with a text box in it.
- The rename confirmation is `tone="primary"`, not destructive: a rename is undone
  by renaming back. What it costs is every existing link, which is why it is
  confirmed at all, and the body names both paths.

### Banners, FAQs, and the nested sheet

- List + reorder + a `Drawer` per record. **FAQ categories became their own
  route**, `/content/faqs/categories`: they were a `Sheet` nested inside another
  `Sheet`, and §3.1 rules on it directly — *"Never nested. A modal that needs a
  second modal is a modal that needs steps."* A route is the honest version of
  "steps" here, and it is the one screen on this branch whose forbidden state
  could not previously exist, because it had no URL to be refused at.
- **The image picker is a step inside the banner drawer, not a second overlay.**
  `patterns/MediaPicker` wrapped itself in a `Sheet` and its only caller opened it
  from inside another one. Promoted to `components/ui/MediaPicker.tsx` as a
  **panel with no chrome**, so the drawer body swaps to it and back — and so item
  13's full-page media screen can render the identical grid with no overlay.
- **No `placement` filter, ever.** `placement` is a free string on the API's side
  by design, so the allowlisted enumeration is *definitionally* incomplete and
  DECISIONS' picker rule refuses it. The client-side grouping stays and the
  footnote says why. No `?category=` filter on FAQs — never measured.

### The two document editors

- `PageBody width="detail"` (768). Not `form` (640): a JSON textarea and a
  two-level tree are not a column of labelled fields.
- The homepage's drop report is a `Notice` — the *kind* of each problem in the
  reader's language, the API's English beside it as `dir="ltr"` detail, and the
  position stated as **1-based over the stored document**, which the copy says
  out loud because "Section 6" is not the sixth row on screen. Both error shapes
  still land: the flat `sections` cap through `ErrorSummary`, the positional
  `sections[n].type` bound to its row. Save stays gated behind a `ConfirmDialog`
  naming the count that saving destroys.
- **`dataHint` was printed nine times and is now printed once.** Every section
  carries the identical sentence — the API defines no schema per type — so
  binding it to the control put nine copies of one fact down a nine-card
  document. It sits once, above the list, where it is read before the first
  textarea rather than beside the ninth. Restraint applies to words.
- Menus: the location is a `FilterTabs` in the **`tabs` variant**, because the
  panel-wide rule is that a full-bleed underlined strip under the header always
  means *which view*. `key={location}` kept, `isAllowedMenuUrl` kept, and an
  unassigned location is still an `EmptyState` with a working action — `PUT`
  creates and assigns.

### Five defects the build found, none of them in the brief

1. **The status filter corrupts `position` exactly as truncation does.** This is
   the one the orchestrator missed outright. `?status=publish` returns the
   collection's positions with the drafts **missing from the middle** (`0, 2, 3`),
   so `positionWrites()` reports writes for rows nobody moved and lands them on a
   draft's slot. The predicate is `reorderBlock()` returning
   `"truncated" | "filtered" | null` — two facts, two remedies, two sentences —
   and truncation wins when both hold, because clearing the filter would not give
   the control back. `tests/cms-reorder.test.ts` reproduces both corruptions
   rather than asserting the fix.
2. **Banner reorder wrote group-local indices onto a collection-wide dense
   sequence**, so two placements would each get a row at `position: 0`.
3. **"Rétablir" on menus was inert.** It called `refetch()`, but `MenuDraft` seeds
   state at mount and its `key` is the location, so the same location never
   remounts and the initialiser never re-ran.
4. **The homepage type `Select` coerced an unknown type to `SECTION_TYPES[0]`** —
   a section stored as `carousel` displayed as "Bandeau principal".
5. **A FAQ category with no FAQs was deleted with no confirmation at all.** The
   dialog only appeared on the 409, so the one silent irreversible path was the
   unguarded one.

### The harness, which is most of the branch

`/cms/*` and `/media` were **entirely unmocked** — both listed `UNCOVERED` — so
every Content screen photographed as its error state and none of the five states
existed for any of the seven. Precedent held: the mock landed before the screens,
as it did on shipping, payments and analytics.

- **A fourth identity, `no_content`**, exactly `full` minus `ac_manage_content`.
  All three existing identities held it, so the branch's *defining* fixture — the
  Manager refused on all eight screens — was unreachable. `reduced` was
  deliberately not repurposed: its docblock argues at length that it is not "a
  Manager" and that its delta is exactly the two 403s that were seen.
- **`MOCK_HOMEPAGE` (`report` | `empty` | `future`)**, because the empty document
  and the twelfth section type are reachable by neither a route nor an identity —
  the screen takes no parameters and its server component forwards none.
- Fixtures the code paths had been waiting for: the `ac-unpublished` collision
  pair, 62 pages so the pager runs, drops interleaved at stored positions **2, 4,
  6** so an off-by-one is visible, an FAQ category at `count: 0`, a 110-character
  Arabic question, entity 8217 on two titles, a 62-character path.
- **The twelfth section type is a hypothesis and is labelled one.** The measured
  reader *drops* an unknown type and reports it; serving one intact by default
  would be the mock passing what the shop discards. It is behind
  `MOCK_HOMEPAGE=future`, modelled consistently on both sides of the wire.
- **The honesty audit found the brief wrong in both directions.** More permissive
  than the record: `GET /cms/pages/{shop,cart,checkout,my-account}` answers 200
  (only the *index* omission is measured, not addressability); `meta.excluded_system`
  is computed against the status filter; `embeddedImage` is reachable only through
  a write nobody measured resolving. Stricter than the record: id refusals on
  `image_id`, menu `object_id` and FAQ `categories` — the shape is measured on
  coupons, not here. Six refusal sentences are the mock's own invention, patterned
  on the one measured `"The coupon is invalid."`, and each is flagged at its site;
  the drop-report sentences, the eleven-name enum, both 404s and every
  `notOneOf()` enum are verbatim from the record.

### Verified rather than reported

Every visual and structural claim on this branch arrived **unverified** — the
screens agent wrote them without a harness and said so. Driven in Chromium
afterwards, at 1440 and at 340:

```
  focus after Escape, POINTER open   banners  -> BUTTON#banner-opener-7301
                                     faqs     -> BUTTON#faq-opener-8101
  focus after Escape, keyboard open  both     -> the same opener
  Reorder hit area (box ∪ ::after)            -> 44 × 44
  TableFooter select                          -> 58 × 32
  TableFooter pager buttons                   -> 28 × 28 box, 32px ::after
  scrollWidth at 340, 9 routes, fr + ar       -> 340 vs 340, no overflow
```

The pointer path is the one that matters: it passes every keyboard assertion even
when broken, which is how the shipping branch shipped a drawer nobody could
escape from. 168 captures clean across nine routes plus two controls, at
340/768/1440 × light/dark × fr/ar, plus the `no_content` run.

**One defect the captures found and the code review would not have.** The three
Pages forbidden states rendered a **back link to `/content`** — a route gated on
the same capability the reader had just been refused for, so the link could only
ever reach another "Accès refusé". A link to a 403 is a control that cannot act.
Agent E's five screens had it right; the orchestrator's three did not.

**i18n**: **1 866 keys in each file, at exact parity, and zero orphans in the
`content` namespace** — checked by a scan that resolves dynamic lookups, because
19 of its keys have no literal caller and are all `t(\`homepage.problem${…}\`)`
templates. `content.moveUp`/`moveDown` were **not** removed: their last caller is
`components/patterns/MoveControls.tsx`, which teardown owns. `states.offlineWrites`
gained its first caller. `a11y.pageName` and `ui.reorder.{up,down}` are new.

**`e2e/content.spec.ts`: 24 test declarations before, 24 after** (31 at runtime —
the Manager describe loops eight paths now, having gained the categories route,
which is a *new screen* rather than a new assertion about an old one). One title
changed and it is recorded rather than quiet: `"is reachable from More, which
used to render it as unbuilt"` became `"is reachable from the panel
navigation"` — `/more` still resolves and **nothing in the panel links to it**,
so the test was asserting "Content is reachable from the navigation" through a
screen no reader arrives at. `selectSegment()` kept its name and lost its body:
`Segmented`'s `sr-only` radio needed a `<label>` click, and `FilterTabs` draws a
real `<button>`. The suite gained the `tbody tr, li.ui-card` row helper, because
moving Pages to `DataTable` introduced the coupons trap — every project bar one
is phone-sized and the anchor lives only in the `md`+ table.

---

## 14. Media — the screen with no table

Checklist item **13**; the section numbers still run one ahead because §10 is
`DataTable`'s row opener, which is not a screen.

**The absence of a `DataTable` is the decision, not a gap.** §3.2's table
contract is rows of fields, and for a picture the picture *is* the identifying
cell — a 44px thumbnail beside a generated filename is a worse way to find an
image than four columns of images. So the record's fields live in the peek and
the grid holds an image plus one line. DESIGN.md §3.2 gained `MediaGrid` as a
contract, because a rule that a page must not fork a primitive only helps if the
primitive exists.

- **Extended, not forked.** `components/ui/MediaPicker.tsx` already drew the
  grid, the pager and four of the five states for one caller. The tiles and the
  pager moved to `components/ui/MediaGrid.tsx`; the picker kept its request, its
  states and `onPick`, and came out behaviourally unchanged for
  `BannerDrawer.tsx` — driven in Chromium: 20 tiles, `media.pickTitle` intact,
  pick returns to the form with the thumbnail attached, no console error. Its
  docblock claimed an **`onCancel` prop that has never existed**; corrected.
- **`PER_PAGE` 30 → 20**, in `lib/media.ts` and shared by both readers. 20 is the
  API's measured default across nine collections and what every migrated list
  opens at. 41 rows is three pages, so this screen's pager has a fixture for the
  first time.
- **Tiles are real `<button>`s on `rowOpenerId`'s id shape**, scoped `media` and
  `media-pick`. `alt` is *not* the label: one fixture carries `alt: ""` and a
  label built on it would leave a tile unnamed. `title` falls back to `filename`,
  which is `Ltr`-wrapped only in that branch — a title is prose, a filename is an
  identifier. The `<img>` is `alt=""`, because the text inside the button is
  already the control's accessible name.
- **The columns are a named variant rather than a viewport query**, and that is
  forced: Tailwind's breakpoints are the viewport's and the picker renders inside
  a 520px `Drawer`, where the page's `xl:grid-cols-6` would draw 78px tiles.
- **A placeholder sits behind the picture.** A slow image and a broken one are
  indistinguishable before `onerror` and unrecoverable after it, so both read as
  "no picture" rather than as a torn box.

### The peek, and the defect it uncovered

`MediaPresenter::toArrayList` is `array_map(toArray)`, so `GET /media/{id}` is
the list row exactly and the drawer is free by the standing rule.

**Resolving it only from the page in memory made the URL a dead link, and the
harness's own capture target proved it.** The collection rests **newest first**,
so `?peek=5001` — the oldest attachment, and the id the brief pinned into
`capture.mjs` — sits on page **three**: the first capture rendered a library with
no drawer and nothing said so. `?peek=` is shareable and bookmarkable or it is
nothing, so a miss now falls through to `GET /media/{id}`, `retry: false`, and an
id naming no attachment opens nothing at all — the library behind it is intact
and there is no error state to put on a screen that is working.

**`/orders` and `/products` carry the same shape** (`OrdersList.tsx:162`,
`ProductsList.tsx:244`) and are latent for the same reason: on those screens the
id got into the URL by somebody clicking a visible row, so only a shared or
bookmarked link reaches it. Not fixed here — this branch does not own them.

`useLatchedOpener` throughout, and the `?peek=` shape is the one that needs it
most: closing clears the parameter and re-renders with a null record *before*
Radix fires `onCloseAutoFocus`. Measured on both paths rather than reasoned
about, because the pointer path is the one that matters — it passes every
keyboard assertion even when broken.

### The drawer's edit, which is measured rather than assumed

`~/projects/ecom-temp/**/tests/Api/media.php:387-435` positively controls it and
asserts the edit reads back. Re-measured against the harness in a browser:

```
  save disabled at open      true, titled "Aucune modification à enregistrer."
  dirty → enabled            true;  reverted → disabled again
  PATCH one moved field      {"alt":"Tapis berbère"}      → reads back
  PATCH an emptied field     {"caption":null}             → reads back ""
```

- **A save that changes nothing is a refusal, not a no-op** — `{}` is a 400
  `invalid_request` — so only the fields that moved are sent and the control is
  disabled with the reason on it. Disabled rather than absent: a Save button that
  appeared and vanished under the cursor while somebody typed is worse than one
  that waits, and §3.3 removes a control that *cannot* act, which this one can as
  soon as a character changes.
- **An emptied field sends `null`, never `""`.** `null` is the documented clear.
- **`file` is not rendered as a control at all.** Its refusal names the remedy —
  "The stored file cannot be replaced; upload a new one." — so a disabled field
  beside the editable three would stand exactly where the one thing somebody
  might come here to do is impossible.
- The drawer's title is the **panel's** name and not the record's, which inverts
  every other peek in this run. The record's title is an editable control in this
  body, so a header built from it would draw a second, stale copy of a field's
  value directly above the field, disagreeing with what somebody is typing.
- **No client-side length rule.** `MediaInput::MAX_LENGTH` is 500 and was read
  out of the backend, not measured over the wire; the 400 binds to its own field
  and says the limit in the API's own words.
- `date_modified` is **not** rendered: it equals `date_created` on all 41
  fixtures and is moved only by this drawer's own write. `uploaded_by` is not
  either — there is no route that turns the staff id into a name, and printing a
  primary key at a shopkeeper is the shipping-rule argument again.

### Upload, as a `Modal`

§3.1: a task that must be finished or abandoned, with nothing behind it being
read from. Success is 201, and any 2xx **carrying a row** is accepted — a client
that refused a 200 would invent a failure out of a success. What it no longer
does is call an empty 2xx a win: the screen this replaces returned silently when
`data` was missing, leaving the modal open with no progress, no error and nothing
to press.

- **`precheck` warns and no longer blocks.** The old sheet disabled the button on
  any local verdict, which makes the browser the authority — and `lib/media.ts`
  argues at length that it is not: the cap is raisable with `AC_MEDIA_MAX_BYTES`
  and PHP's own limit can be lower than either, so a client trusting its own
  arithmetic is wrong in both directions. A local verdict is a `warning` and the
  server's is a `danger`, and the two titles say which is which. Driven: a `.gif`
  raises the advisory, the button stays live, the send answers 415 and the notice
  becomes the refusal.
- **`UploadSheet.tsx:178` returned `value.message` — raw API English — as its
  default**, the class of defect this run has now fixed five times. The *kind* is
  said in the reader's language and the API's sentence sits under it as
  `dir="ltr"` detail: the untranslated half is evidence, not copy.
- `FileField` is new in `components/ui/Form.tsx` rather than in the page.
  `FieldFrame`, `describedBy`, `borderFor`, `.ui-field`'s geometry and the
  pre-hydration guard are all private to that module, so a page wanting a
  labelled file input would have re-implemented five things. One caller today;
  the shape is the layer's.

### Not shipped, each absence recorded

- ~~**No delete.** The route exists and the capability allows it;
  `lib/api/allowlist.ts:266-273` refuses it and `tests/boundary.test.ts:487` pins
  it shut, because an attachment has no back-reference anywhere in this API and
  the panel cannot say what a delete would break. Not rendered, not disabled.~~
  **Corrected 2026-08-28 — the API grew the back-reference; see below.**
- ~~**No sorting, no `aria-sort` anywhere.** The only control taken on `orderby`
  is negative (`rand` → 400) and `date desc` is the resting order, so the
  standing rule's positive control does not exist.~~ **Corrected 2026-08-28 —
  both controls now ship; see below.**
- **No `type` filter**, though the parameter works. No allowlisted enumeration of
  what a library can *hold* exists — `ACCEPTED_MIME` is what the panel can
  upload, definitionally a subset — and all 41 rows are `image/*`, so the control
  has one non-empty value. A control that can only answer "all of them" cannot
  act.
- ~~**No search box.** `search` is honoured in backend code and has no control at
  all, here or in the backend suite. Unmeasured is treated as broken.~~
  **Corrected 2026-08-28.**
- **No bulk, no export** — media is not in `EXPORT_SUBJECTS`.
- ~~**One empty state, and the missing half has no producer.**~~ **Corrected
  2026-08-28: the search is its producer, and both halves now ship.** DESIGN.md
  §3.7's amendment keeps its force and its example is corrected in place.

### The two absences that were wrong, measured and shipped 2026-08-28

**Neither parameter was broken; neither had been asked.** The entries above read
"unmeasured, therefore treated as broken", which is the standing rule doing its
job — and the rule's other half, which those entries did not act on, is that the
absence of a positive control is not evidence of absence: go and take one. Taken,
against the live API, 43 rows:

```
orderby=date&order=asc    sorts, and DIFFERS from the resting order   positive control
orderby=id&order=asc      sorts, differs from the bare listing        positive control
date desc / id desc       byte-identical to the bare listing          prove nothing alone
orderby=title             UNPROVABLE — 42 of 43 rows are titled "Tapis"
?orderby=zzz              400 invalid_request                         validated, not ignored
?bogus_param=1            = the bare listing                          the control holds

search=woocommerce-placeholder   1 of 43     discriminating positive control
search=zzzqqq                    0 of 43
search=<filename stem>           0 of 43     search does NOT reach filenames
search=<slug>                    0 of 43     nor slugs
search=""                       43 of 43     absence
search + per_page=1             200, meta.total 1   combines with paging
```

- **Sort ships on `date`, two directions.** Not `id`: it sorts, and on this
  collection id order and date order are the same fact, so a second control would
  be two spellings of one answer — chrome on a band that costs the same as a
  control which means something. ~~Not `title`: unprovable on the only fixture
  that exists, and unmeasured stays broken. **The measurement `title` still
  needs** is a fixture with distinct titles — three or more rows sorting
  differently from both their ids and their dates — then `orderby=title&order=asc`
  against the bare listing.~~ **Corrected 2026-08-28 — the fixture was built and
  the measurement taken; see below.** Recorded in `media/query.ts`, which carries
  every request above.
- **The resting order sends no `orderby` at all**, the way every other list's
  first tab sends nothing. `date desc` was measured byte-identical to the bare
  listing, so asking for it explicitly is a parameter that changes nothing in
  every URL for ever — and the second press of the "newest first" chip is then a
  genuine return to rest rather than a re-request.
- **The sort control is `FilterTabs` in `chips`, not the strip** — §12's rule
  applied without an exception: a full-bleed underlined strip under the header
  always means *which view*, and this screen has none. **No `aria-sort`**: it is a
  table-header attribute and there is no table here. `aria-current` on a labelled
  `nav` is what these are.
- **Search is submit-gated**, on §7's coupons pattern, and **the placeholder names
  its own scope** — which matters more here than on any list in the panel, because
  a tile whose title is empty is labelled with its *filename* and the filename is
  measured **not** to be searchable. A reader typing what a tile says would get
  nothing back with nothing on screen to say why. `empty.noResults` repeats it.
- **The copy states the measured negative and not an unmeasured exclusion.** It
  says the search covers the title and not the filename — both directions
  measured. It does *not* say "the title only": `WP_Query`'s `s` is a LIKE over
  `post_title`, `post_excerpt` and `post_content`, so the caption is plausibly
  matched and nobody has run that request. Coupons' "porte sur le code, pas sur
  la description" is the sentence's shape, not a licence to claim an exclusion
  this collection has not answered.
- **What search reaches is worth more than "titles".** WordPress derives
  `post_title` from the uploaded filename, and the one fixture row nobody has
  renamed has `title === filename stem` — so searching by title does reach what a
  person typed when they uploaded the file, until somebody edits the title in the
  drawer.
- **Both live in the URL and both reset paging.** `page` stays local state, as it
  was: `?peek=` is worth sharing and a page number on this screen still is not,
  and page 3 of a re-sorted library is a different set of rows rather than the
  same ones rearranged. `page.tsx` now reads `searchParams`, so a shared
  `/media?search=…` paints the searched library instead of painting the whole one
  and flipping.
- **`MediaPicker` grew neither**, and the shared grid needed no new props to keep
  it that way — the toolbar lives in `MediaLibrary`'s `PageHeader`, not inside
  `MediaGrid`. A search box and a sort strip in 520px of a drawer somebody opened
  to attach one picture is a filter UI inside a picker.
- **`loading.tsx` grew the band**, drawn from `.ui-chip` and `.ui-field`'s own
  utilities so it matches at 36px on a pointer and 44px on touch rather than only
  on a laptop.

### A→Z and delete, both shipped 2026-08-28 against a ledger that was stale

Two entries above are struck. Neither was wrong when it was written; both stopped
being true, one because somebody built the fixture and one because the API grew a
route. That is the same lesson §3.7's amendment carries: *"unmeasured is treated
as broken" is a holding position, and so is "the API cannot answer this".*

**Four sort chips, extended from two.** `title` was unprovable while 42 of 43 rows
were titled "Tapis". Five rows spread across the id range were renamed to titles
whose alphabetical order matches neither their ids nor their dates, measured, and
the originals restored:

```
title asc  -> 761, 3035, 1658, 4234, 4    exactly alphabetical, differs from the
                                          bare listing
title desc -> 4, 4234, 1658, 3035, 761    the exact reverse
```

That is a positive control on the axis itself in both directions, which is more
than `date` has — `date desc` **is** the resting order and can only be proved by
its opposite differing. So: newest · oldest · A→Z · Z→A, four flat chips in the
existing labelled group, because each is a complete answer to "in what order" and
one of the four combinations a field-plus-direction pair would offer (`id`) does
not ship. Resting is still **no `orderby` at all**. The toolbar band does not
change height — the group scrolls rather than wraps — so `loading.tsx` grew two
pills and a scroll container and nothing else. Measured: 86px at 1440, both
before and after; page overflow 0 at 340 in `fr` and `ar`.

**Delete, and `GET /media/{id}/usage` is the reason it is now explicable.**
`MediaUsageRepository` reads the five stores this codebase can put an attachment
id in and reports `checked` and `incomplete` beside `total`:

```jsonc
{"total": 1,
 "references":[{"kind":"product","id":4849,"title":"Imported Lamp","slot":"featured_image"}],
 "checked":["featured_image","gallery","option_choice_image","seo_image","store_logo"],
 "incomplete":["homepage_section_data","content_html"]}
// 404 not_found for an unknown id **and for a post id that is not an attachment**
// 400 invalid_request on id=0; 401; ac_manage_content
```

- **`DELETE` is permanent** — `wp_delete_attachment($id, true)` — and is
  deliberately **not** refused for an image in use: a hard refusal would make a
  deliberately-unused picture undeletable, so the endpoint informs and the
  operator decides. The mock reproduces that rather than inventing a 409.
- **Header `Menu` → `ConfirmDialog`, the coupons shape**, with the **filename**
  typed. §3.1's identifier rule, and unlike the content branch's texturized titles
  a filename is typeable — `UploadPolicy::storedFilename()` emits `[a-z0-9-]` and
  a dot. Driven: disabled before typing, disabled on a wrong string, live on the
  filename; Cancel takes initial focus; Escape returns focus to the menu trigger
  and leaves the drawer open.
- **The dialog fetches usage when it opens**, with all four states on screen —
  checking, could-not-check, none known, and a list. A failed read renders a
  `role="alert"` `Notice` carrying the API's own sentence and **leaves the confirm
  live**, because the API does not refuse either.
- **The copy says *known*.** `total: 0` reads "no known use of this file", never
  "safe", and one line beside every state says that a picture placed inside page
  content or inside a homepage section cannot be seen from here — `ContentHtml`
  permits `<img>`, so an embedded image is a URL and not an id. `kind` and `slot`
  are translated where the panel has a word and printed raw where it does not:
  `MediaUsageRepository::KINDS` falls through to the raw post type on purpose, so
  an enum at the boundary would throw on the fifth kind the endpoint exists to
  surface.
- **A reference `title` is `post_title` read straight out of the database**, so it
  arrives texturized and goes through `decodeEntities` like every other title in
  this drawer. Found in the harness, not reasoned about.
- **Three defects the browser found and the code did not.** The invalidation after
  a delete re-asked `GET /media/{id}` and `GET /media/{id}/usage` for the row that
  had just stopped existing — two 404s in the console, every time — because a
  `setState` has not re-rendered when an invalidation on the next line runs.
  Pressing **back** onto the `?peek=` the delete navigated away from re-opened a
  drawer on the deleted file out of cache. And deleting the only row on a page
  left the reader on "no files yet" over a library of forty. A `deleted` set, a
  library-only invalidation and a one-step page-back close all three; the usage
  query's key sits outside the `media` prefix for the same reason.
- **The mock's honesty audit found one of its own.** `wp_delete_attachment()`
  deletes the `_thumbnail_id` rows pointing at the attachment and **only** those,
  so a banner whose picture is deleted reads back `image: null`; the mock froze the
  resolved object at write time and kept serving a thumbnail URL that now 404s.
  Fixed, and the gallery and option-set ids are deliberately left dangling because
  that is what the shop really has. `MEDIA_LOGO_ID` and the shop name beside it are
  **invented** and flagged at their site — there is no settings document in the
  mock to read a logo from, and without one `store_logo` is a scope the harness
  could never demonstrate.

Verified in Chromium against the harness: 12/12 captures clean on `/media`; the
whole delete flow with **zero** console errors and zero failed requests; the count
41 → 40; `?peek=` cleared; a `Toast`, not a banner; `ar` renders the dialog in
Arabic with no key on screen. i18n **1 902 keys in each file, exact parity** —
27 added, `sort.asc` and `sort.desc` removed for losing their last caller.

**Where the brief was wrong, and it is small.** It gives `kind` as a five-value
enum; `MediaUsageRepository::KINDS` falls through to the raw post type for
anything else, and `incomplete` is not the fixed pair either — `find()` appends a
*scope* name to it when that scope hits `MAX_MATCHES` (100), so a value in
`checked` can appear in `incomplete` too. Both are parsed as open vocabularies.
The brief also omits the delete's own body, `{"id": <id>, "deleted": true}`.

### Two boundary defects the harness audit surfaced, both `MediaPresenter`

1. **`sizes` was declared an array of `{name, url, width, height}`;
   `MediaPresenter::sizes()` returns a map keyed by size name of
   `{width, height, mime_type}`.** No `url`, no `name`, and not an array. It
   parsed only because an empty PHP map serialises as `[]` and every attachment
   in this shop is 30×20 — below every thumbnail threshold. The day one sub-size
   existed, **every media response in the panel would have thrown at the
   boundary**: the library, the picker, and the banner strip behind it. Both
   serialisations now parse and normalise to the map; a *populated* array is
   refused rather than tolerated, because it is not something PHP can emit here
   and accepting it is the permissive direction. Asserted directly, since the
   fixture cannot exist.
2. **`embeddedImage` required `url` and `MediaPresenter::image()` has never sent
   one** — it sends `{id, src, thumbnail, alt}`. A banner with a picture threw,
   latent only because `image` is null on every seeded row. **The two sources
   disagree and neither is measured over the wire**: the presenter says `src`,
   the harness resolves `{id, url, alt, width, height}`, which is this schema's
   own old guess handed back at it. So `id` is the only required key, every
   carrier of the picture is optional, and `embeddedImageSrc` in `lib/cms.ts` is
   the one place that decides which wins — structurally typed, so that file keeps
   its no-Zod-in-the-browser property. A request-for-request diff on
   `/cms/banners` is what would settle it, and the harness owns its half.

### Verified in a browser, not reported

```
  focus after Escape, POINTER open    1440/390 × fr/ar -> BUTTON#media-opener-5041
  focus after Escape, keyboard open   1440/390 × fr/ar -> the same tile
  drawer box                          1440: x=920 w=520 right=1440 · 340: full bleed
  tile hit area, 340 coarse                            -> 148 × 172
  pager button (box ∪ ::after), coarse                 -> 28px box, 44px ::after
  340 page 2, the 80-char unbreakable title            -> 507px of text in a
                                                          148px box, clipped;
                                                          scrollWidth 340 = client
```

36 captures clean across `/media`, `/media?peek=5001` and the `no_content` run,
at 340/768/1440 × light/dark × fr/ar, plus `MOCK_MEDIA=empty`.

**i18n**: **1 870 keys in each file, exact parity.** Seven added
(`noChanges`, `chosenFile`, `percent`, `field.dimensionsValue`, `field.url`,
`refusal.title`, `refusal.advisoryTitle`), three removed for losing their last
caller (`cancel`, `previousPage`, `nextPage` — the pager borrows `ui.table`'s,
being the same control doing the same job). `media.pickTitle` untouched: its live
reader is `BannerDrawer.tsx:168`. The four non-message strings the old screen
rendered — `{page} / {pageCount}`, `{width} × {height}`, `{n} %` and the raw API
default — are all gone.

**`e2e/content.spec.ts`: 24 test declarations before, 24 after**, titles
byte-identical. Selectors only: `ul button` → `ul li button`, and the count moved
to the header's subtitle under the same testid. It stays in this file because
`/media` is inside the Manager forbidden loop over eight paths and cannot move —
the payments judgement (§9) for the same reason.

**Where the brief was wrong.** `/media?peek=5001` was pinned into `capture.mjs`
without checking which page that id lands on; it is the oldest row against a
newest-first collection, so it is on page three. The capture is now honest
because the screen fetches the record, but **5022** or higher would exercise the
in-memory path instead, and only the harness's owner can change that. Everything
else in the brief held.

### Re-verified independently, and one harness defect that fell out of it

Every claim above was re-driven from a scratch script outside the repo. All held.
Three things the screens agent could not have seen:

1. **`capture.mjs` photographed the peek drawer mid-slide, and the PNG read as a
   clipped drawer.** The 400ms after `networkidle` is sized for a font swap, not
   for *hydrate → fetch the record → mount an overlay → slide it in*; and
   `networkidle` cannot cover that chain, because the query fires after hydration
   once the network has already gone quiet. `/media?peek=5001` is the run's first
   capture of an overlay opened from a URL parameter, so nothing had exposed it.
   Driven with a 900ms settle the same drawer measures `x=920 w=520 right=1440`,
   zero overflow — **the screen was right and the harness was early.** Fixed with
   `animations: "disabled"` on the screenshot, which pins every running transition
   to its end state; raising the timeout would trade a wrong frame for a slower
   run and still race whatever is slowest on the day. Every future overlay capture
   inherits it.
2. **The Arabic count line renders `41 من 20–1` and that is correct**, which is
   worth writing down because it looks exactly like the `pageOf` defect shipping
   fixed and the next reader will flag it. Read the way an Arabic reader reads it —
   right to left — it is `1`, `–`, `20`, `من`, `41`. The two are different cases:
   `pageOf` is a bare pair of figures round a slash with no word to anchor the
   run, so a visual `7 / 1` genuinely reads as page 7 of 1; `range` carries `من`,
   which makes it an Arabic sentence and bidi handling it is bidi working. Wrapping
   it in `Ltr` would be the bug — it would force the Arabic preposition into an
   LTR run. Measured on `/media`, `/shipping` and `/products`: all three identical.
3. **A capture of this screen cannot catch a per-tile `src` bug, and the fixture
   is right anyway.** All 41 tiles photograph as the same red rectangle, so a
   screen that rendered `rows[0].url` forty-one times would look identical to a
   correct one. The instinct to vary the fixture colours is wrong: the colour is
   the *backend's* — `tests/Api/media.php`'s `ac_jpeg_bytes()` fills 30×20 with
   rgb(190,40,40) — so varying them would have the mock showing a library the shop
   does not have. Closed by measurement instead of by fixture: driven in Chromium,
   **20 tiles, 20 distinct `src`, 0 broken**. The blind spot stays; it is the
   honest cost of a faithful fixture, and this is the check that covers it.

**One residual, recorded with its uncertainty rather than a guess.** The native
`<input type="file">` renders its own button and status text — "Choose File" / "No
file chosen" — in the *browser's* language, not the page's, and `FileField` keeps
the UA control deliberately (a `<label>` driving a hidden input loses the
control's keyboard behaviour on two engines). The panel's answer is the one
`DateField` already established: an **echo**, so a chosen file is named in the
reader's language under the control. What remains English is the empty state.
Whether a real French Chrome renders it in French is **not settled here** — this
Playwright build ships English-only resources and shows English even under
`--lang=fr-FR`, which is a property of the harness's browser and not evidence
either way.

---

## Carried forward — teardown owns these

- **Every French timestamp in the panel reads "6:32 AM", and it is one line in
  `lib/format/date.ts`.** Found on the media drawer's `Téléversé` row and then
  measured properly: `DATE_LOCALE.fr` is **`fr-DZ`**, and CLDR's `fr-DZ` resolves
  to `hourCycle: h12` with the English `AM`/`PM` day-period names. `fr` and
  `fr-FR` are both `h23`. Arabic is **correct** and must not be touched — `ar-DZ`
  is h12 with `ص`/`م`, which is right for Arabic.

  ```
  fr      h23  4 août 2026, 06:32     ← what French should render
  fr-DZ   h12  4 août 2026, 6:32 AM   ← what the panel renders
  ar-DZ   h12  04‏/08‏/2026، 6:32 ص     ← correct, leave alone
  ```

  Driven in the built panel: the page's own `Intl` with `document.documentElement.lang`
  gives `06:32` while the panel prints `6:32 AM`, so it is the locale string and
  nothing else. `fr-DZ` is deliberate and right for **money** (`26 350,00 DA`) —
  `lib/format/money.ts:19` argues it — and `date.ts` mirrored the choice without
  the hour cycle being part of what it was choosing. Nothing pins `AM` in any test.

  **Not fixed here, and the reason is scope rather than doubt**: 139 `formatDate`
  /`formatWhen` call sites, so it re-captures the whole panel, and fixing it only
  on this screen would make media the one French screen that disagreed with the
  other eight. The remedy is `fr: "fr-DZ-u-hc-h23"` plus an A/B of the French
  captures — the shape the content branch used for `min-h-8`. Media ships
  consistent with the panel it is joining.
- **`?peek=` resolves only from the page in memory on `/orders` and `/products`**
  (`OrdersList.tsx:162`, `ProductsList.tsx:244`) — the defect §14 fixed on media,
  latent on both. A peeked id that is not on the current page opens nothing, so a
  shared or bookmarked peek link is dead; reaching it by clicking a visible row
  always works, which is why nobody has seen it. The fix is media's: fall through
  to `GET /{id}` on a miss. Not touched — this branch does not own those screens.

- ~~**`Toast` is still on retired iOS classes**, and `.toast-anchor` holds it 68px
  off the bottom to clear a tab bar that no longer exists.~~ **Closed on the
  content branch, and the 68px was the least of it.** Measured rather than
  assumed: the old anchor dropped to `1.5rem` at `md`, so the tab-bar clearance
  was **phone-only** and 1440 was already correct. What was wrong at *every*
  width is what nobody had written down — it was centred everywhere (§3.1 wants
  inline-end at `sm`+), translucent `color(srgb 1 1 1 / .88)` with
  `box-shadow: none`, and **errors expired at 4.3s against §3.1's 6s**. Now
  `bg-ui-surface` + border + `shadow-ui-sm`, tone in the icon only, 4s/6s.
  Public props unchanged across **33 importers**; none was touched. The lesson is
  the ledger's own: a carried entry describes what somebody noticed, not what is
  wrong, and it goes stale in the direction of *understating*.
- **`.save-bar` stays in `globals.css`** — **six** unmigrated forms use it, and
  they are `fixed` with no block-end, so deleting the rule would unstick their
  bars rather than remove them.
- **`RowSkeleton.tsx` stays** — **seven** unmigrated screens import it.
- **Three files in `primitives/` and `patterns/` now have no importer at all, and
  they are the first genuinely dead ones rather than under-defended ones.**
  `components/patterns/MoveControls.tsx` and `components/patterns/MediaPicker.tsx`
  joined `primitives/Bar.tsx` on the content branch: the first was promoted to
  `components/ui/Reorder.tsx` with both of its measurements intact, the second to
  `components/ui/MediaPicker.tsx` as a panel. **Their message keys go with them
  and are deliberately still in the files**: `content.moveUp`/`moveDown` have
  exactly one caller left — `MoveControls.tsx` — so removing the keys would leave
  a source file reading a key that does not exist. Teardown deletes the three
  files and those two keys in one edit. **`patterns/MediaPicker.tsx` read
  `media.empty` and that key became an object on 2026-08-28**, when the library
  grew a no-results state; its one call is repointed to `media.empty.none` for
  the same reason the keys stayed — a dead file must still be a *correct* dead
  file, or the next reader cannot tell a retirement from a bug. `patterns/TabBar.tsx` has had none since
  the shell landed, and it is the only thing that still links `/more`, which two
  `e2e/content.spec.ts` tests were asserting against until this branch.
  **`tests/cms.test.ts` was importing `moveItem` from the retired copy**, so the
  five reorder assertions were covering dead code while `ui/Reorder`'s own
  implementation had none; repointed, 787 still pass.
- **`components/primitives/Bar.tsx` now has no importer at all.** The analytics
  branch was its only caller and `components/ui/Bar.tsx` replaced it. It is left
  in place under the rule that teardown owns `primitives/`, but unlike
  `RowSkeleton` it is not defending anything: nothing renders it, and it would
  now render in the *new* colours anyway, since `.bar-track`/`.bar-fill` were
  retuned to the `ui` tokens under their own names. It is the first genuinely
  dead file in that directory rather than an under-defended one, and it should be
  the first thing teardown deletes.
- ~~**`e2e/customers.spec.ts:57,115` has the coupons row-helper bug**, unfixed.~~
  **Closed on the content branch, and the entry was half right.** `:58` was
  genuinely broken. `:116` is `toContainText`, which reads `textContent` and never
  checked visibility — it *passed*, while asserting about a node nobody on a phone
  project can see, which is the quieter half of the same defect. Both converted to
  coupons' `rows()` helper; the three `toHaveCount` assertions were left alone,
  because a count is DOM-based and 16 is 16 at every width. 14 tests before, 14
  after, titles byte-identical.
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
- ~~`ConfirmDialog` focuses its × button rather than Cancel, contradicting
  §3.1.~~ **Closed on the analytics branch — see §12.** `Modal.initialFocus` is
  the second focus prop this entry asked for, and the fix was driven in Chromium
  from a `Menu` item rather than reasoned about.

  **It surfaced a second, narrower defect — and the *symptom* recorded here was
  wrong.** Closed on the content branch. The entry read:

  > Escape from the shipping rule-delete dialog drops focus to `<body>`. Measured on both a
  patched and an unpatched build, so it predates the focus fix and is not a
  regression from it. The cause is §10's latch, unapplied at one call site:
  `RulesScreen.tsx:404` derives `returnFocusTo` from `confirm.target`, and Radix
  fires `onCloseAutoFocus` *after* `onOpenChange`, so the target is already null
  and the id is `undefined` by the time it is read. `useLatchedOpener` is the
  one-line fix and it already exists. **It is the only caller with this shape** —
  the other ten `returnFocusTo` call sites were surveyed and each passes either a
  stable id (`triggerId`, `menuTriggerId`, `fieldId(picker)`) or an already-latched
  one. **The diagnosis was right and the consequence was not.** Driven on
  isolated builds at 390/1440 × fr/ar × mouse/keyboard, with `getElementById` and
  `HTMLElement.focus` hooked: `returnFocusTo` really is `undefined` at close —
  `getElementById` is never called — but focus lands on `#rule-menu-164` in
  **16 of 16 cells, never `<body>`**. Radix's `DropdownMenu` restores focus to its
  *trigger* before the dialog records its opener, so `useOpenerFocus`'s recorded
  fallback catches it; §10's "a menu item does not survive" does not apply,
  because the recorded node is the trigger and not the item. `useLatchedOpener`
  was applied anyway — a named path that is dead code reads as a live one — and
  all **eleven** call sites were re-surveyed rather than trusted (the entry said
  ten): four already latched, four on a stable `useId()`, one fixed, and the one
  with the same derivation shape (`CouponForm` → `RestrictionPicker`) was driven
  in a browser and works, because the whole subtree unmounts instead of
  re-rendering with `undefined`, so React hands the unmount handler the last
  committed props.

  **The reusable part is the failure mode**: a defect was carried for two branches
  on a symptom nobody had reproduced. The diagnosis was sound and the sentence
  attached to it was invented, which is the same class as the "provider label"
  and "route is broken" entries — a note that reads like a property of the system
  and is really a dated guess.
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
- ~~**`POST /media` is a 404 in the mock, named rather than hidden.** It is
  `multipart/form-data` and the mock's shell parses JSON, so all five measured
  failure shapes would be unreachable behind a handler that pretended. Item 13
  owns it, along with `mediaSize`, which has no fixture because `sizes` is empty
  on all 41 attachments — measured.~~ **Both closed — see §14.** The upload
  landed in the harness commit; the schema half was worse than "no fixture" and
  the entry understated it in the way this file's own lesson predicts. `sizes`
  was not merely unexercised, it was declared as **the wrong shape** — an array
  of `{name, url, width, height}` against `MediaPresenter::sizes()`'s map keyed
  by size name of `{width, height, mime_type}` — and it parsed only because an
  empty PHP map serialises as `[]`. A missing fixture and a field nobody has to
  be right about are not the same thing.
- **Six refusal sentences in the CMS mock are the mock's own words**, patterned on
  the one measured `"The coupon is invalid."` and flagged at each site. The
  coupons branch is why that matters: a screen was built to a `"Read-only."`
  refusal the API never sends. The request-for-request diff against the live
  router is what would settle them, and it has not been run on this subject.
- **`states.capability.ac_manage_marketing` did not exist** — the third instance
  of that hole after `ac_manage_shipping` and `ac_manage_payments`, so the
  Marketing section's forbidden state printed the raw slug at the reader.
  **Closed on the content branch**; all 13 slugs in `lib/capabilities.ts` are now
  covered and none exists without a slug. Three branches found it three times,
  which suggests the check belongs in `check-design.sh` rather than in a person.
- `@hookform/resolvers` is imported nowhere; `react-hook-form` only by the login
  form.
- ~~`movementReasonHint` has no caller in either message file. So do
  `cod.turnOff` and `cod.reasonPlaceholder`.~~ **Closed on the analytics branch —
  all three removed from both files, parity re-verified at 1 833 keys.** They
  belonged to `orders/[id]/CodSection.tsx`, which is unmigrated and reads neither:
  a key an unmigrated screen does not call is an orphan now and would have to be
  written again anyway when that screen is rebuilt to a measured contract.
- ~~**Nothing in the panel meets §5's 44px touch target, and it is the primitives
  rather than any screen.**~~ **Closed on the analytics branch — see §12**, with
  the measurement table and an A/B proving 36 captures of `/orders` and
  `/payments` byte-identical. **One residual stays open: `TableFooter`'s per-page
  `<select>` is 28px on a pointer, 4px under §5's 32px floor.** It cannot borrow
  `.ui-tap` — a `<select>` is a replaced element and `::after` never paints on
  one — so closing it means growing the control, which grows the footer row on all
  seven shipped list screens. The remedy is `min-h-8` on the select plus a
  re-capture of every list; it is a one-line change with a seven-screen blast
  radius, which is why it is here rather than in §12. **Closed on the content
  branch**: `min-h-8`, proved by an A/B of **84 byte-compared captures** from two
  trees differing only in those six files — all 84 differ, 64 grew exactly 4px,
  and a pixel diff of the 20 that kept their dimensions confines every changed
  pixel to a 46–48px band, the footer strip. Two corrections to this entry while
  it was being closed: it is **8** shipped screens, not seven (`/inventory/movements`
  was missed), and the footer row **does** grow — 49 → 53px — because the pager's
  `IconButton size="sm"` is 28px, so the select was never the tall control.

  **The residual it leaves is a 4px *drawn* difference, not a §5 failure**, and
  the distinction is this file's oldest method. A 32px select now sits beside
  28px pagination buttons; measured in Chromium, those buttons carry a **32px
  `::after`**, so their hit area meets §5's pointer floor exactly as §5
  prescribes — *"a 20px icon gets a 44px hit area from a pseudo-element, never by
  growing the icon"*. An agent reported them as a new violation having measured
  `getBoundingClientRect()` alone, which is the error §12's own table warns
  against two paragraphs above. Growing them would ripple `IconButton` panel-wide
  to fix an appearance. The original entry follows, because its *method* is the
  reusable part:

  **Nothing in the panel meets §5's 44px touch target, and it is the primitives
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
- ~~**Two docblocks name a file that no longer exists.**~~ **Closed on the
  analytics branch**, which was given those two files unlocked for exactly this.
  Both now name `lib/payments.ts`. Prose only: no fixture and no assertion moved,
  and the measurement they carry (`cod` → "Cash on delivery") is still what the
  fixture asserts.
