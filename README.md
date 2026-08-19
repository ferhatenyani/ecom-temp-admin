# ecom-admin

The staff admin panel for the Algerian headless-commerce backend. Built from
[ADMIN_PANEL.md](ADMIN_PANEL.md), which is the specification and the place corrections get written
back to; [PRODUCT.md](PRODUCT.md) holds the product truth behind it.

Next.js 16.3 App Router, React 19.2, TypeScript strict, Tailwind v4 with token-only theming,
`next-intl` for French and Arabic with full RTL, TanStack Query v5, `jose` for the sealed session
cookie. No component library.

## What exists

The shell, the credential boundary, Orders end to end, Products, Inventory, Customers and Coupons.

```
/[locale]/login              sign in with a WordPress Application Password
/[locale]/orders             list — filters in the URL, 30 s poll, five states
/[locale]/orders/[id]        detail — summary, items, totals, customer, COD, timeline
                             plus the status transition, which renders the API's 409
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
/[locale]/more               the tab bar holds five; this is the overflow
```

`fr` and `ar` are both complete, at 390–440 px and on a desktop. The options editor (§83) is its own
branch — the specification calls it the hardest component in the panel — and so is editing attributes
and categories. Everything else in Part V is a later branch, and `/more` renders those destinations
as visibly not-yet-built rather than as links that 404.

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

`scripts/test.sh` mints its own credentials and clears the API's rate-limit counters first — the suite
provokes a login failure on purpose, and the failed-login bucket would otherwise refuse the correct
password for the next fifteen minutes. It also runs `scripts/seed-attributes.mjs`, because the facet
tests need a global attribute to count and this shop shipped with none; the seed is idempotent and
takes a few seconds.

The e2e suite runs on Chromium at current iPhone widths — **364 tests** across four widths and both
locales. `--project=phone-webkit` is the honest engine and is **91/91** (verified 2026-08-19), kept out
of the default run because its system libraries are 231 apt packages behind root.

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

`scripts/check-design.sh` fails the build on any of these, scans 60 files, and asserts a floor plus a
positive control on its own patterns — a grep that matches nothing must not report success.

- No gradients, no accent bars, no component library, no generic fonts.
- No colour outside `styles/tokens.css`. One exception, `lib/theme-color.ts`, named in the script with
  its reason and asserted by a unit test.
- No arbitrary Tailwind values.
- Logical properties only: `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`, never `ml-`/`pr-`/`left-`.
- No `shadow-` outside `Sheet`, `Popover` and `ActionSheet`.

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
