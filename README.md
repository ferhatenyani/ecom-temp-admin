# ecom-admin

The staff admin panel for the Algerian headless-commerce backend. Built from
[ADMIN_PANEL.md](ADMIN_PANEL.md), which is the specification and the place corrections get written
back to; [PRODUCT.md](PRODUCT.md) holds the product truth behind it.

Next.js 16.3 App Router, React 19.2, TypeScript strict, Tailwind v4 with token-only theming,
`next-intl` for French and Arabic with full RTL, TanStack Query v5, `jose` for the sealed session
cookie. No component library.

## What exists

The shell, the credential boundary, Orders end to end, Products, and Inventory.

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
```

`fr` and `ar` are both complete, at 390–440 px and on a desktop. The options editor (§83) is its own
branch — the specification calls it the hardest component in the panel — and so is editing attributes
and categories. Everything else in Part V is a later branch, and the tab bar renders those
destinations as visibly not-yet-built rather than as links that 404.

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

The e2e suite runs on Chromium at current iPhone widths. `--project=phone-webkit` is the honest
engine, kept out of the default run because its system libraries are 231 apt packages behind root.
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
