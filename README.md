# ecom-admin

The staff admin panel for the Algerian headless-commerce backend. Built from
[ADMIN_PANEL.md](ADMIN_PANEL.md), which is the specification and the place corrections get written
back to; [PRODUCT.md](PRODUCT.md) holds the product truth behind it.

Next.js 16.3 App Router, React 19.2, TypeScript strict, Tailwind v4 with token-only theming,
`next-intl` for French and Arabic with full RTL, TanStack Query v5, `jose` for the sealed session
cookie. No component library.

## What exists

The shell, the credential boundary, Orders end to end, Products, Inventory, Customers and
Coupons, Shipping with Payments and cash on delivery, and the Dashboard with the six analytics
reports.

```
/[locale]/login              sign in with a WordPress Application Password
/[locale]/orders             list — filters in the URL, 30 s poll, five states
/[locale]/orders/[id]        detail — summary, items, totals, customer, parcels, payments,
                             COD with its attempt log, and the timeline, plus the status
                             transition, which renders the API's 409
/[locale]/products           list — nine filters, facets, a filter sheet, the URL as state
/[locale]/products/[id]      detail — the whole object as a form, variations read-only,
                             trash and permanent delete with different confirmations
/[locale]/inventory          low stock by default, then the full list, then the ledger —
                             one route, three views, plus the SKU lookup
/[locale]/inventory/[id]     the quantity, the adjustment, the stock settings,
                             and this item's own movements
/[locale]/customers          list — search, two sorts, and what the API cannot filter
/[locale]/customers/[id]     detail — identity, the statistics report, the consent
                             record, addresses, and this customer's orders
/[locale]/coupons            list — search, status, and the zero-amount case
/[locale]/coupons/[id]       the whole coupon as a form, with the restriction picker
/[locale]/coupons/new        the same form against an empty coupon
/[locale]/shipping           the tariff with its own resolver, and the parcels
/[locale]/payments           the transactions ledger, and the COD funnel beside it
/[locale]/dashboard          the overview as seven cards, each one a link into the list
                             behind its figure — two card sets, chosen by canSeeMoney()
/[locale]/analytics          six reports behind one date range — revenue, orders, products,
                             customers, shipping, COD
/[locale]/more               the tab bar holds five; this is the overflow
```

`fr` and `ar` are both complete, at 390–440 px and on a desktop. The options editor (§83) is its own
branch — the specification calls it the hardest component in the panel — and so is editing attributes
and categories. Content and Settings are later branches, and `/more` renders those destinations as
visibly not-yet-built rather than as links that 404. **Every tab in the bar now navigates** — Dashboard
was the last placeholder.

Five things were fixed in `ecom-temp` on `feat/coupon-pickers` while building the customers branch,
because the screens were not buildable as specified. They are listed under **Owed to the backend, and
paid** below.

## Running it

The backend must be up first — see `~/projects/ecom-temp`. It answers on `:8090`.

```bash
cp .env.example .env.local        # then set SESSION_SECRET to 32+ characters
npm install
npm run dev                       # http://localhost:3001/fr/orders
```

Sign-in needs a real staff Application Password, because every staff member authenticates as
themselves — there is no service account, by design, so the audit trail names a person.

```bash
CRED=$(scripts/mint-credential.sh ac_super_admin)
echo "$CRED"                      # login:password
```

## Testing

```bash
npm test                          # types → design → unit → e2e
npm run test:design               # the non-negotiables, with a floor and a self-check
npm run test:unit                 # formatters, error mapping, envelope, seal, allowlist
npm run test:e2e                  # four device widths × both locales
npm run shots -- <user> <pass>    # captures + assertions into .impeccable/review/
```

`scripts/test.sh` mints **four** credentials and clears the API's rate-limit counters first — the suite
provokes a login failure on purpose, and the failed-login bucket would otherwise refuse the correct
password for the next fifteen minutes. It also runs `scripts/seed-attributes.mjs`, because the facet
tests need a global attribute to count and this shop shipped with none; the seed is idempotent and
takes a few seconds. `scripts/seed-shipping-rules.mjs` runs beside it for the same reason —
`GET /shipping/rules` answered `[]`, so `/shipping/rates` could only ever answer `[]` too and the
resolver had nothing to resolve. Three rules (national 800, wilaya 16 at 500, commune 484 at 350)
make commune-beats-wilaya-beats-national observable, and the suite asserts those figures.

The fourth credential is a **Manager**, and it is the only one of the four that still describes a
live account: the two-tier collapse retired `ac_support_agent` and `ac_marketing_manager`, which
still mint (`set_role()` bypasses the API) and whose suites still pass, but which now name a
configuration production does not have. A Manager is 200 on shipping and COD and **403 on
payments** — one credential carrying a real refusal and a real success.

`npm run shots` captures into `.impeccable/review/` and asserts **384 things a screenshot cannot
show** — that the Arabic face loaded rather than falling back, that a bar grows from the reading edge
in both directions, that every figure names its scope, and that none of the API's English sentences
reached the screen.

The e2e suite runs on Chromium at current iPhone widths — **492 tests** across four widths and both
locales. `--project=phone-webkit` is the honest engine and is **123/123** (verified 2026-08-21), kept out
of the default run because its system libraries are 231 apt packages behind root. Export all
**four** credentials before running it by hand — with only two, nine forbidden-fixture tests skip
and the run reports fewer passes, which is not the same thing as green. A run that reports any skips
is a run that did not test what you think it did.

Two operator errors are worth naming, because both invalidated a run and both looked like code
defects. **Minting a credential while a suite is running** kills that suite's credential — the same
hazard the note below describes, from the other direction. And **editing a spec or a component while a
suite runs against `next dev`** changes the code under the test: it produced twenty failures across
orders and products that vanished on a clean run. WebKit's own finding was real and is fixed: it
hydrates slowly enough that a click can land on a still-disabled control, which is why the picker
tests assert `toBeEnabled()` first.
Install them once with `sudo env "PATH=$PATH" npx playwright install-deps webkit` — plain `sudo npx`
cannot see an nvm-installed node — then run the project by name.

**`mint-credential.sh` deletes the account's previous Application Passwords**, by design: one
credential per account, because an old one left behind is a working key nobody is tracking. So
`scripts/test.sh` minting its own invalidates any `AC_STAFF_PASS` you exported earlier, and a WebKit
run started with the stale one fails at the login form with *"Nom d'utilisateur ou mot de passe
d'application incorrect"* — which reads exactly like a broken sign-in. Mint immediately before the
run, or let `test.sh` mint and export nothing yourself.

## The rules that are enforced, not just written down

`scripts/check-design.sh` fails the build on any of these, scans 139 files, and asserts a floor plus a
positive control on its own patterns — a grep that matches nothing must not report success.

- No gradients, no accent bars, no component library, no generic fonts.
- No colour outside `styles/tokens.css`. One exception, `lib/theme-color.ts`, named in the script with
  its reason and asserted by a unit test.
- No arbitrary Tailwind values.
- Logical properties only: `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`, never `ml-`/`pr-`/`left-`.
- No `shadow-` outside `Sheet`, `Popover` and `ActionSheet`.

The charts obey the same rules, which decides what they are. Every analytics chart here is a
**single-series magnitude** comparison, so the `dataviz` form heuristic gives one answer for all of
them — a bar, one hue, no legend — and that is also the only answer this token set can give honestly:
a categorical palette needs seven or eight hues that survive a colour-vision check, `tokens.css` has
five semantic colours reserved for status, and inventing more would put colour literals in a
repository whose design script fails on them. Identity is carried by the label and by the tonal badge
beside it, never by the bar, and **every bar prints its value as text on the same row**, so the table
view is built in rather than bolted beside it.

## Things worth knowing before changing anything

Measured against the live API, and each one is written up in ADMIN_PANEL.md as a
`> **Corrected in the build:**` note beside the passage it corrects.

- **A 401 is detected by status, never by `error.code`** — a wrong password answers
  `incorrect_password`, a suspended account `account_suspended`. Only a 401 clears the session; a 403
  is a screen state.
- **`/orders` has no `wilaya` filter**, and unknown query parameters are ignored with a 200 rather than
  refused. `?status=` takes one value; `?per_page=500` is a 400, not a clamp.
- **The 409 body is the authority** on which status moves are legal. `allowed: []` means the order is
  finished. The panel carries no transition table.
- **`notes[].created_at` has no UTC offset** while `order.date_created` does — `new Date()` silently
  shifts the first by the host's offset.
- **Timeline summaries contain HTML entities** (`99&rarr;98`), decoded to text and never to HTML.
- **`/settings` publishes no timezone.** `NEXT_PUBLIC_SHOP_TIMEZONE` does, defaulting to
  `Africa/Algiers`.
- **Money needs `fr-DZ`**, not `fr` — a bare `fr` renders `DZD` where the shop says `DA`.
- **Zod parses responses on the server**, where its weight is free. It cost 60 KB gzipped in the
  browser on a two-field login form.
- **390 × 844 is the floor, not the target** — it is the narrowest iPhone Apple still sells.
- **A facet is a set of counts, not a vocabulary.** Zero-count values are omitted, so the filter
  sheet's choices come from `/product-categories` and `/attributes/{id}/terms` and the facet only
  supplies the numbers. The category facet also does not exclude its own filter, unlike the attribute,
  stock and price facets, so picking a category would otherwise hide every other category.
- **`?category=` matches term ids; `?attributes[…]` matches term slugs.** Keying both by slug renders
  a `0` beside every category and nothing errors.
- **A duplicate SKU is a 409 with `details.sku`**, not a 400 with `details.fields` — and a PATCH
  carrying only read-only fields is a 400 with no `details` at all.
- **A trashed product still reads back as 200** with `status: "trash"`; only `?force=true` gives a 404.
- **Product ids are not stable.** The backend's own suites recreate their fixtures, so tests and
  scripts find a product by SKU.
- **`GET /inventory` hides variations by default.** `include_variations` defaults to `false` — 28 rows
  against 33 — while `/inventory/low-stock` always includes them, so with the default the low-stock
  screen shows a row the full list denies exists.
- **`null` stock is not zero stock.** 8 of 28 rows are untracked; rendering both as `0` is how someone
  reorders what they already have. `low_stock_amount` is per product (2 on 27 rows, 5 on one) — there
  is no shop-wide threshold anywhere.
- **An adjustment targets `stock_managed_by_id`, not the row that was tapped.** They are equal on every
  row in this shop today and would diverge the moment a variable product tracked stock at the parent.
- **The stock ledger cannot name its actor.** `GET /users/{id}` is Super Admin only and `/audit-logs`
  stops at Admin, carries no movement id, and covers 13 rows of 1154. The row renders *an order*, *you*,
  *a colleague* or *unknown* — never a bare id — and `?actor_id=` survives as a filter.
- **The movement reason vocabulary is the union of two endpoints**, nine values; the adjust endpoint
  accepts six of them and the summary reports seven. Built from either alone, a picker 400s or a legend
  goes missing. `lib/movement-reason.ts`.
- **`Ltr` is for identifiers; `Isolate` is for formatted dates.** `Intl` puts U+200F marks in an Arabic
  date, and forcing `dir="ltr"` over them renders `17ص 12:03 .2026/08/`. Eight pre-existing date sites
  on the orders and products screens had it.
- **`truncate` clips from the wrong end when the text's language is not the page's.** A French product
  name in the Arabic list read *"…eau en bois d'olivier, 40 cm"* — `text-overflow` clips at the
  paragraph's end, which in RTL is the left. `dir="auto"` on the text element fixes it and moves
  nothing when the text fits. Applied on the inventory rows; **still owed on every other `truncate`
  holding user content** — the orders and products lists and `Scaffold`'s collapsed title all have it.
- **Form controls are disabled until hydration.** A keystroke landing before React takes over changes
  the DOM and never reaches state, so the form never goes dirty — measured on WebKit, invisible on
  Chromium. `lib/use-hydrated.ts`, applied inside `Field`.
- **`app/not-found.tsx` emits its own `<html>` and `<body>`**, and is the only file in the panel that
  does. `app/layout.tsx` returns bare `children` on purpose — `lang` and `dir` need a locale the root
  has not got — so anything rendering outside `app/[locale]/layout.tsx` has no document tags, and
  Next's built-in global not-found is exactly that. Every mistyped address answered with a runtime
  error, *"Missing `<html>` and `<body>` tags in the root layout"*, instead of a 404. An
  `app/[locale]/not-found.tsx` does **not** fix it: measured on 16.3.1, a path that resolves to no page
  never matches the `[locale]` segment, so Next walks straight to the root boundary.
- **The forbidden fixture is per screen, not per branch.** A **Support Agent reads customers** — they
  hold `ac_manage_customers`, the thinnest role in the system holding anything — and is 403 on
  coupons; a **Marketing Manager** is the exact inverse. `scripts/test.sh` mints three credentials.
- **Staff roles are now two tiers — Super Admin and Manager** (`ecom-temp`, `feat/two-tier-roles`,
  2026-08-20). The other five are *retired*: still defined, still published by `GET /roles` with an
  `assignable` flag, never granted. Deleting them would have stranded 43 live accounts on **zero
  capabilities**, because `remove_role()` does not touch `wp_capabilities` usermeta. The panel needed
  no change — every gate is a capability, never a role — and pre-collapse Application Passwords still
  authenticate. But **both compound rules stopped discriminating**: Manager holds `ac_view_analytics`
  and `ac_manage_orders`, so `canSeeMoney()` is true for everyone and `meta.money_visible` is never
  false; Manager holds no marketing capability, so the draft-but-cannot-send state has no role. The
  live forbidden fixture is a **Manager** — 403 on payments, campaigns, marketing, settings, users and
  audit logs. `mint-credential.sh` still assigns retired roles because `set_role()` bypasses the API,
  so the old fixtures keep passing while describing a configuration production no longer has.
- **`?search=` on customers matches login, email and display name — never the name.** Proven with a
  positive control: a customer given the names `Zqxwvu Plmokn` returned 0 rows for `Zqxwvu` and 1 for
  their username. Amina Benali cannot be found by typing her name, so the field says what it matches.
- **12 of the 16 customers have no name at all**, and `orderby=display_name` sorts by a key the
  payload never carries.
- **The customer detail is the list row plus `statistics`.** The first collection here where the two
  routes differ, so `CustomerDetail` is its own type. Two of the report's figures do not divide:
  revenue and the average count only *completed* orders against a `total_orders` that counts all.
- **`total_revenue` is not gated by the API** — a Support Agent reads it with a 200. The panel gates
  it anyway, because `canSeeMoney()` needs `ac_manage_orders` and that role cannot open one of the
  orders behind the figure.
- **A coupon's `amount: "0.00"` is real** (zero off, free shipping) **while a threshold's zero is
  not** — the API folds it to null. Null-versus-zero running both directions on one object.
- **`date_expires` is written `Y-m-d` and read back as ISO.** A date input bound to the response
  renders empty and then clears the field on the next save.
- **A duplicate coupon code is a 409 with `details.code`**, carrying the lower-cased form that
  actually collided.
- **`Ltr` is for a bare identifier only.** Wrapped around a *translated sentence* it forces the
  direction too, and sixteen call sites laid an Arabic count out from the left. `Isolate` for
  anything sharing an element with a translated word. Money and percentages render identically under
  both — measured by glyph position — so those stay `Ltr`.
- **A `fixed bottom-0` save bar lands under the tab bar** and the save button becomes untappable.
  `.save-bar` already exists for this.
- **`/settings` does publish `store.currency`** (`DZD`), unlike the timezone. `SHOP_CURRENCY` is a
  constant until a screen needs `/settings` for its own sake.
- **A stale `next dev` will invent this same error.** Switching branches under a running dev server
  leaves Turbopack with a route entry for a directory that disappeared, and the route then renders as
  unmatched — which looked exactly like the bug above on a page that was fine. `rm -rf .next` and
  restart before believing a routing error that only one screen shows.
- **Killing `next dev` mid-generation corrupts the types it writes, and `tsc` fails in *your* code's
  name.** `tsconfig.json` includes `.next/dev/types/**/*.ts`, and a dev server interrupted while
  regenerating them leaves a torn file — measured 2026-08-21: `routes.d.ts` had its whole closing
  block written twice, and `npx tsc --noEmit` reported *"Unterminated regular expression literal"*
  against a generated file nobody wrote. The stage fails, the branch looks broken, and nothing in the
  source is wrong. Same remedy: stop the dev server, `rm -rf .next`, re-run. A `rm -rf .next` that is
  itself interrupted leaves the corrupt file in place, so check that the directory is actually gone.

- **The shipment label is `metadata.label`** (and `metadata.labels`), not a top-level field, and no
  shipment in this shop carries one — `manual` is the only configured provider and issues none. But
  `metadata` is emitted verbatim, so a courier adapter puts a credential to a customer's name, phone
  and address into the panel's JSON the day it is switched on. `stripLabelUrls()` runs server-side
  and passes the *names* of the stripped keys so a button can exist without the URL;
  `/api/label/[id]` re-reads the shipment and streams the bytes.
- **A shipment's 409 carries no `allowed` list**, unlike an order's — `is_live` is the whole rule.
  The one place the panel cannot render what the server would have said.
- **`?is_live=` is accepted and ignored.** *Live parcels only* is not a request the API can answer.
- **`sync` is a 409 while the parcel is live and a 200 once it is finished** — the terminal check
  short-circuits before the provider is asked.
- **There is no `PATCH` on a payment.** `paid → refunded` cannot be triggered or observed from here.
  `verify` answers `{report, transaction}`, and `report.amount` can be `""`.
- **`POST /orders/{id}/payments` opens a real checkout** and returns a live `pay.chargily.dz` link.
  Off the allowlist deliberately, with the reason in a unit test.
- **`PATCH /orders/{id}/cod` takes the whole GET object back.** Read-only fields are dropped
  silently. Three collections, three rules — a coupon's `{}` is a no-op, a customer's address merges.
- **`allowed_outcomes` cannot see the order's status**, which is checked first and refuses on its own.
- **`by_status.confirmed` is 74 and `confirmed_orders` is 111 in one payload**, both correct. Scope
  every figure or the reader concludes one is broken.
- **`Omit` on a Zod `looseObject` erases every known field** — the index signature makes `keyof`
  swallow the exclusion. Intersect instead.
- **A row's action can render on top of the figure beside it.** `Button` sets no width; a long label
  at 390 px covered the money. `shots.mjs` asserts it geometrically now.
- **A `Field`'s `hint` is inside its `<label>`**, so it becomes part of the accessible name and
  changes as the hint does — while `FieldError` uses `aria-describedby`. Shared by every form; noted
  rather than changed.

- **Analytics takes `?range=` and nothing else.** Six presets; `custom` requires `date_from` **and**
  `date_to`. The dates sent *without* `range=custom` are **accepted and ignored** — 200 with the
  thirty-day default, measured on four spellings including a valid ten-day window. So the panel always
  sends `range`, and every screen renders `data.range` rather than what the picker holds. One endpoint,
  two error shapes: a bad `range` is `details.params`, a bad date is `details.fields`.
- **Money is omitted key by key, not nulled.** Without `ac_manage_orders`, `/analytics/revenue` is
  403 and the other six drop `overview.revenue`, `orders.average_order_value`, `orders.currency`,
  `best_sellers[].revenue`, `by_wilaya[].revenue`, `unattributed.revenue`, `shipping_revenue` and
  `currency`. Every money field in the schema is `.optional()` for that reason. `meta.money_requires`
  names the capability and is not in the spec; the forbidden screen renders what the response said.
- **The money gate is reachable in tests, and not in production.** Both live tiers hold
  `ac_manage_orders`, but `GET /roles` still publishes three retired roles holding `ac_view_analytics`
  without it, and `scripts/test.sh` already mints one as `AC_LIMITED_*` (a Support Agent). The e2e
  suite covers the gate with it, against the live API, with a Super Admin as the positive control.
- **844 placed against 289 counted is a *status* exclusion, not `excluded_currencies`.** The counted
  set is `processing + on-hold + completed + refunded` (160+1+45+83), and `refunded` is in on purpose.
  `excluded_currencies` was absent from every response and would explain a different gap.
  `countedReconciliation()` carries a `proves` flag, and the screen states the explanation only where
  the sum actually holds.
- **An empty window is zeros, not omitted blocks.** `range=today` answers 200 with every key present
  and every figure `0`, so a report has to say the window was quiet or it reads as one that failed.
  `/analytics/products` is the exception: `low_stock` is not range-scoped.
- **`unavailable` is an object of English sentences**, one per key, and `unattributed.reason` is
  another. Both are rendered as localised lines keyed on the *key*, with the API's text as the
  fallback for a key the panel has no wording for. Rendering the raw note puts an English paragraph in
  the middle of an Arabic sheet — which it did, until the capture showed it.
- **`formatRate` and `formatPercent` take different inputs and differ by 100×.** Analytics sends
  `"0.2109"` meaning 21 %; a coupon sends `"10.00"` meaning 10 %. Feeding a rate to `formatPercent`
  renders `0,21 %` — plausible, wrong by two orders of magnitude, and it never looks like a bug.
- **`guest_orders` is two different numbers in one payload** — 389 in the orders block, 185 in the
  customers block, both correct and scoped differently. `customers` is accounts that ordered in the
  window (9), not the shop's customers (16).
- **The analytics cache key varies by capability**, verified in both directions inside one 60 s TTL
  window rather than taken from `docs/SECURITY_AUDIT.md`. `meta.cache_ttl` is 60 and no client refetch
  is layered on top of it.
- **`Ltr` around a full-width cell forces the cell's direction, not just the identifier's.** The
  provider name and its count both landed at the left edge of an Arabic row. Wrap the identifier, never
  the cell.
- **`details.params` has two shapes and only one is a message.** For a bad value it is an object
  keyed by parameter (`{"per_page": "per_page must be between 1 and 100"}`); for a *missing* required
  parameter it is an array of names (`{"params": ["sku"]}`, measured on `/inventory/lookup`).
  `Object.values` of an array returns its elements, so the second shape renders `sku` as though it
  were an explanation. `lib/api/browser.ts` falls through to the generic message instead — and is now
  the only reader in the panel, `orders/query.ts` and `products/query.ts` included. Their private
  copies had each drifted: orders dropped `details` entirely and showed *"Invalid parameter(s):
  per_page"* where the API had said what the range was, and products mishandled the array. Both are
  asserted in `tests/boundary.test.ts`.

## Owed to the backend, and paid

Fixed in `ecom-temp` on `feat/coupon-pickers` while building the customers branch. Each one is here
because the panel could not be built honestly without it.

- **The consent row was not buildable as specified.** ADMIN_PANEL.md asks for "a read-only row with
  the date and the reason"; there was no date, the refusal was a generic `"Unknown field."`, and 0 of
  16 customers had ever consented. `marketing_consent_at` turned out to be **stored since §85 and
  never presented**. Now emitted with `marketing_consent_source`, refused by name with the shopper's
  own route, and one seeded shopper consents. Written on a withdrawal too, and only on an actual
  change.
- **The restriction picker needed two routes.** `/products` and `/product-categories` are
  `ac_manage_products`, which a Marketing Manager does not hold — so the role whose job coupons are
  could not see what a coupon applied to. `GET /coupons/eligible-products` and
  `/coupons/eligible-categories` sit behind `ac_manage_coupons` and carry id, name, SKU and status
  only: strictly less than the catalogue, rather than the catalogue behind a second capability.
- **A single coupon carries its restrictions resolved**, with `missing: true` on an id that no longer
  resolves rather than dropping the row — a client that dropped it would delete the restriction on
  the next save.
- **Restriction ids were stored unchecked.** `{"product_ids": [999999]}` answered 200 and the coupon
  applied to nothing while looking exactly like one that worked. Now a 400 per field.
- **A negative threshold silently erased a real one.** `{"minimum_amount": "-1"}` answered 200 and
  cleared a 15 000 DA minimum, because the clearing arm read `<= 0.0` and swallowed every negative
  before the "Must not be negative." check could see it.

## Open, and owed to the backend

- `/settings` could reasonably publish `store.timezone`.
- **A movement has no readable actor for most of the staff who can read it.** `ac_manage_inventory` is
  held by four roles; `GET /users/{id}` is Super Admin only and `/audit-logs` stops at Admin. Either a
  movement could carry `actor_login` the way an audit row already does, or a narrow
  `GET /users/{id}/display-name` could sit behind `ac_manage_inventory`. Until then the ledger shows
  what it can prove, which is documented in `movementActor()`.
- **`inventory.adjusted` audit rows carry no movement id**, so the two records of the same event cannot
  be joined except by heuristic.

## Not built on the inventory branch, and why

- **`POST /inventory/bulk`.** A batch stocktake is its own screen — 100 items, per-item results in a
  200 that can be entirely failures — and the proxy allowlist refuses the route with a unit test
  saying so, because a route no screen reaches must not be reachable by guessing a URL.
- **A summary over a *chosen* window.** `/movements/summary` takes `date_from`/`date_to` and the ledger
  passes whatever the filter sheet holds, but there is no month-picker or comparison; the strip states
  its own scope instead of implying a period nobody set.
- **A wilaya's `name` is the English exonym for 16** — *Algiers*, not *Alger* — so the French locale
  renders an English place name for the capital. **Not** a data fix: `data/algeria/wilayas.json` says
  in its own `source` field that the Latin names follow ISO 3166-2 to match WooCommerce's DZ state
  list, and `WC()->countries->get_states('DZ')['DZ-16']` is indeed `Algiers`. The slug is derived from
  that name, so renaming it changes a join key that provider destinations are stored against, and
  `DestinationMatcherTest` asserts the current value. A French display name would be a new field, not
  an edit to this one.

Fixed in `ecom-temp` on `fix/products-support` while building this branch:

- `name_ar` was blank for **Algiers (16)** and **Oran (31)**, and the cause was the API test suite:
  `tests/Api/locations.php` upserts those two wilayas with "real codes and real names" and no
  `name_ar`, which the upsert writes as `''`. The fixture now carries both Arabic names and the suite
  asserts that no wilaya lost one — the row-count check beside it passed a blanked column unchanged.
- `orderby=price|sku|id|popularity|rating` were accepted and silently ignored, returning date order.
- `PATCH /products/{id}` answered 500 on a variable product whenever the body carried `attributes`.
