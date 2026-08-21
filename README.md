# ecom-admin

The staff admin panel for the Algerian headless-commerce backend. Built from
[ADMIN_PANEL.md](ADMIN_PANEL.md), which is the specification and the place corrections get written
back to; [PRODUCT.md](PRODUCT.md) holds the product truth behind it.

Next.js 16.3 App Router, React 19.2, TypeScript strict, Tailwind v4 with token-only theming,
`next-intl` for French and Arabic with full RTL, TanStack Query v5, `jose` for the sealed session
cookie. No component library.

## What exists

The shell, the credential boundary, Orders end to end, Products, Inventory, Customers and
Coupons, Shipping with Payments and cash on delivery, the Dashboard with the six analytics
reports, the CMS with its media library, and the notification queue.

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
/[locale]/content            the hub — six destinations, each with its count
/[locale]/content/pages      the index the backend was paid for, with the draft
                             a single read cannot distinguish from a missing page
/[locale]/content/pages/…    the whole page as a form, path-addressed, with the
                             rename warning before the save and the SEO block inside it
/[locale]/content/homepage   the document edited whole — reorder, add, remove,
                             and the drop report for the sections it could not read
/[locale]/content/banners    grouped by placement, ordered within it
/[locale]/content/faqs       one list, many categories, and the category manager
/[locale]/content/menus      primary and footer, two levels, and the location
                             that has no menu until you save one
/[locale]/media              the library — a grid, an upload with a percentage,
                             and five distinguishable refusals
/[locale]/notifications      the queue — did it send? four states derived from three
                             fields, a channel and date filter, and no sort control
                             because the API has none
/[locale]/notifications/[id] the frozen message quoted as a record, and a retry that
                             is a 202 saying what it did *not* do
/[locale]/more               the tab bar holds five; this is the overflow
```

`fr` and `ar` are both complete, at 390–440 px and on a desktop. The options editor (§83) is its own
branch — the specification calls it the hardest component in the panel — and so is editing attributes
and categories. Settings is a later branch, and `/more` renders it as visibly not-yet-built rather
than as a link that 404s. **Every tab in the bar now navigates** — Dashboard was the last placeholder.

**Step 14 is three branches, not one**, and the seam is the capability rather than the subject.
Part X's line reads "CMS, media, marketing, campaigns, notifications"; `feat/content` is the first
third and Part X now records the split with its reasoning:

- **14a `feat/content`** — the CMS and media. `ac_manage_content`, which after the two-tier collapse
  is Super Admin alone, so a **Manager is a genuine forbidden fixture for every screen on the branch**.
- **14b `feat/notifications`** — the queue. **DONE.** **`ac_manage_customers`**, not content: a
  notification row holds a customer's address and the frozen body of their order confirmation, and §90
  gates it there deliberately. A Manager is **200** on `/notifications`, so 14a's fixture does not
  transfer — the live refusal is a **Marketing Manager**, 403 on all three notification routes and on
  `/customers` besides, while a Support Agent reads both. Two things had to exist first: a backend
  branch for the two filters the customer tab needs, and a seed, because every row in the queue was
  `pending`.
- **14c `feat/campaigns`** — marketing, segments, templates, the composer. `ac_manage_marketing`, and
  last on purpose: all three collections answered **0 rows**, so it needs its own seed before an
  assertion means anything, and the specification calls the composer the second-hardest screen here.

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

`scripts/test.sh` mints **four** credentials, and the **failed-login** bucket is cleared by
Playwright's own `globalSetup` (`e2e/rate-limit.ts`, wired in `playwright.config.ts`) rather than by
`test.sh` itself — the suite provokes a login failure on purpose, and that bucket is 10 failures per
15 minutes per IP, after which a *correct* password is refused too. Note the scope: it clears the
login bucket and not the 600-a-minute **read** limit, which is per credential and therefore fresh
every run because the credentials are. It also runs `scripts/seed-attributes.mjs`, because the facet
tests need a global attribute to count and this shop shipped with none; the seed is idempotent and
takes a few seconds. `scripts/seed-shipping-rules.mjs` runs beside it for the same reason —
`GET /shipping/rules` answered `[]`, so `/shipping/rates` could only ever answer `[]` too and the
resolver had nothing to resolve. Three rules (national 800, wilaya 16 at 500, commune 484 at 350)
make commune-beats-wilaya-beats-national observable, and the suite asserts those figures.

`scripts/seed-cms.mjs` is the third, and it does more than seed. `GET /cms/homepage` answered
`{"sections": []}`, so the homepage editor and its drop report were built against a document with
nothing in it — and **the drop report cannot be provoked through the API at all**, because the only
route that writes the document is the one that refuses to write a malformed one. So the seed writes
the option underneath the API with `wp eval`, the way `mint-credential.sh` already does for the one
thing the API deliberately does not do. It also **deleted 78 pages**: not suffixed copies, but 53 rows
that all answered to `ac-unpublished` and 27 to `conditions`, because `wp_unique_post_slug()` does not
run for a draft. A path is the only address `/cms/pages/{path}` has, so `get_page_by_path()` reached
one of each and the rest could not be read, written or deleted at all.

`scripts/seed-notifications.mjs` is the fourth, and it is the one that is **not optional on a
repeat run**. Measured before it existed, `GET /notifications` was 39 rows of which **every single
one was `pending`** — no `sent`, no `failed`, `last_error` and `sent_at` null on all of them, one
channel. A screen whose entire purpose is "did it send?" had nothing that had ever sent, so retry,
the failure state and the channel filter were all unassertable. And `tests/Api/notifications.php` on
the backend `DELETE`s the whole table before it asserts anything, so any backend suite run empties
the queue completely; re-running this is how the rows come back.

Most of what it produces is produced by **running the system**, not by writing rows. The attempts and
their errors come from the real drain — this stack has no SMTP service and `EmailChannel` is
registered unconditionally, so `wp algerian-commerce send-notifications` fails honestly and leaves
`attempts: 1` with `last_error: "wp_mail() did not accept the message."`, which `EmailChannel`'s own
docblock states is correct behaviour rather than a test failure. `sent`, `failed` and the clean
`pending` rows are set with `markSent()`, `markFailed()` and `requeue()`, which are the drain's and
the retry's own methods. Only **two** things go underneath: a payload that will not decode (nothing
running can write one — `notify()` uses `wp_json_encode()`) and an `sms` row (there is no `sms`
channel to queue one, and without it `?channel=` is a control with one value).

The drain takes the oldest pending rows **globally**, so it cannot be aimed at this script's own
rows. It therefore carries the ids it created between its two steps and `requeue()`s everything
pending that is not one of them — putting the rest of the shop back exactly as found, which is what
makes running it on every `test.sh` harmless rather than a slow march towards marking the whole queue
failed.

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
locales as of the content branch, plus `e2e/notifications.spec.ts`, which is **8 tests verified on
`--project=phone` only**. That file is deliberately small and the four-width total is deliberately
**not** re-verified on this branch: everything about the queue that a schema can answer is answered
in `tests/notification-schema.test.ts` against captured payloads, and what is left for a browser is
the capability refusal, the allowlist, the retry reaching the screen and the customer tab rendering.
The unit suite is at **307**. `--project=phone-webkit` is the honest engine and is **123/123**
(verified 2026-08-21), kept out of the default run because its system libraries are 231 apt packages
behind root.

Export all **four** credentials before running it by hand — with only two, nine forbidden-fixture tests skip
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

`scripts/check-design.sh` fails the build on any of these, scans 179 files, and asserts a floor plus a
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
- **A notification's `status` does not say what happened to it.** A retryable failure leaves the row
  **`pending`** with the attempt counted and the error recorded, so a queue read as three statuses
  shows a row the drain has already choked on as though nothing had touched it. Four states are
  derived from `status`, `attempts` and `last_error`; see `queueState()`.
- **`last_error` is our sentence, not the mail server's**, despite what `NotificationPresenter`'s
  docblock says: `EmailChannel` only ever sees `wp_mail()` return a boolean. It is still quoted rather
  than translated, because a plugin filtering `wp_mail` can return anything.
- **A notification's `created_at` and `sent_at` both carry `+00:00`**, unlike `notes[].created_at`
  above — `NotificationPresenter::time()` is `gmdate('c')` for both.
- **The frozen message is bilingual and renders verbatim.** A French salutation over an English
  sentence, out of `NotificationMessages`. It is a record of what was queued, not panel copy, so it is
  framed as a quotation with `dir="auto"` and never translated.
- **`?orderby=` and `?order=` are not parameters on `/notifications`**, and `?orderby=nonsense` is a
  200 rather than a 400. `?event=` and `?audience=` are likewise accepted and ignored, which is why
  the queue offers no sort control and no event filter.
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

Added by the content build:

- **A page could not be listed at all.** `GET /cms/pages` was not a route — §89 shipped a complete
  write surface over a read surface that could address one page and enumerate none. Paid on
  `ecom-temp`'s `feat/cms-page-index`; see **Owed to the backend, and paid**.
- **A draft and a missing page are the same 404 with the same message.** `?status=` *filters* a single
  read rather than widening it, so `"No page at that path."` covers both — and WordPress creates
  `privacy-policy` as a draft, so that is exactly what it answered about a page sitting right there.
  **The index is the only place the two separate**, which is the argument for it over a path box.
- **Every content list asks for `?status=any`, which inverts the panel's own habit.** Everywhere else
  the absence of `?status=` means everything; on these routes it means **publish only**, so a screen
  that sent nothing would hide the drafts somebody opened it to finish.
- **Two pages can share a path, and a path is the only address.** `wp_unique_post_slug()` does not run
  for a draft: 53 pages answered to `ac-unpublished` and 27 to `conditions`, unsuffixed, and
  `get_page_by_path()` resolves one of each — the other 78 were unreachable through the API entirely.
  `collidingPaths()` marks them and the index refuses to link them, because opening the fourteenth row
  would open the first and saving would write over somebody else's page.
- **The shop's own pages are not editorial content, and they are not one kind of thing.** `cart`,
  `checkout` and `my-account` have a block or a shortcode for a body; `privacy-policy` is real prose
  and *is* option-referenced; `refund_returns` is prose referenced by nothing. `SystemPages` splits
  them by option rather than by a list of paths, and the delete refusal lives on the API so it holds
  for every caller rather than only for this panel.
- **`?search=` matches the title and the body, never the path.** `WP_Query`'s `s` does not search
  `post_name`. The field says so — the same treatment `/customers` gets.
- **WordPress texturizes what it stores, so a title never reads back as it was written.**
  `Soldes d'été` comes back with its apostrophe as character reference 8217. `decodeEntities` on every
  title — and the seed learned it the hard way, creating a duplicate banner on its second run.
- **`content` and `excerpt` read back as rendered HTML and PATCH back without accumulating a wrapper**,
  verified over three round trips. That is what makes binding a form straight to the response safe
  here where a coupon's `date_expires` made it unsafe there.
- **The homepage drop report cannot be provoked through the API**, because the only route that writes
  the document is the one that refuses to write a bad one. `scripts/seed-cms.mjs` writes the option
  underneath it with `wp eval`. **`meta` is absent entirely** when there is nothing to report — not an
  empty array, so code that destructured `meta.problems` would throw on the healthy case.
- **Saving the homepage repairs it by discarding what was dropped**, since the editor only ever sees
  what survived the read. Gated behind a confirmation naming the count.
- **`meta.problems` positions are 1-based over the *stored* document**, not over the surviving
  sections, so "Section 6" is not the sixth row on screen. The seed interleaves its malformed sections
  rather than appending them, so an off-by-one here is visible.
- **One endpoint, two error shapes, and only one is positional**: a bad section is `sections[2].type`,
  more than fifty is a flat `sections`. Binding every homepage error to a row index drops the cap.
- **The eleven homepage section types are published nowhere** — they were read out of a 400.
  `unknownSectionTypes()` renders a type this build has no name for as itself rather than as a blank.
- **`PUT /cms/menus/{location}` creates and assigns a missing menu**, so an unassigned location is an
  empty state with a working action rather than an error. `GET` on it is a 404 with its own message,
  which is a different fact from a location that was never registered.
- **`POST /media` fails five distinguishable ways, not two.** The fifth — a JPEG renamed `.png`, 415
  with both `extension` and `detected` — needs its own wording, because "only jpg, png and webp are
  accepted" reads as false to somebody looking at a `.png`. The first measurement got this wrong: a
  48-byte fake PDF tripped `MIN_BYTES = 64` before the sniffer ran, and only a 5.4 KB control showed
  the real answer.
- **`sizes` is empty on every fixture in this shop** — 30×20 images, below WordPress's thumbnail
  thresholds — so `sizes[0]` works in production and fails in every test. `url` always exists.
- **Upload progress means `XMLHttpRequest`.** `fetch` cannot report it on any mobile browser this
  panel targets, and the specification is explicit that a spinner without a percentage is unacceptable
  here. The bar stops at *sent* and goes indeterminate for the server's sniff-and-write.
- **Drag-ordering is specified and is not what shipped.** HTML5 drag-and-drop fires no `dragstart`
  from a touch pointer and `draggable` takes no key events, so at the 390 px floor it is decoration and
  to a keyboard it is nothing. iOS ships both a drag *and* move-up/move-down accessibility actions;
  this panel ships the half that works everywhere. `components/patterns/MoveControls.tsx`.
- **`Field`'s `hint` was part of the accessible name** — inside the `<label>`, so a field announced as
  its label plus a whole sentence, and the name *changed* as the hint changed. Fixed on this branch as
  its own commit, with `tests/field.test.tsx` asserting the accessibility tree rather than the markup:
  8 of its 10 assertions fail against the previous version, which is the control that makes them worth
  keeping.

## Owed to the backend, and paid

Each one is here because the panel could not be built honestly without it.

Fixed in `ecom-temp` on **`feat/cms-page-index`** while building the content branch:

- **A page could not be listed.** §89 registered `POST /cms/pages` and `GET, PATCH, DELETE
  /cms/pages/{path}` — a complete write surface over a read surface with no index — so the Pages
  screen had nothing to open on, and a draft could not be told from a path that does not exist,
  because both are `"No page at that path."`. `GET /cms/pages` adds `?status=`, `?search=` and
  pagination, ordered by title, with a row carrying `path`/`title`/`status` and deliberately not
  `content`, `seo` or `excerpt` — a whole page body and a `SeoResolver` pass per row would cost what
  opening every page at once costs, and the omission is asserted so it cannot drift back.
- **A listing has to decide what a page *is*, and §89 never had to.** `SystemPages` splits the pages
  nobody wrote into two sets derived from options WordPress and WooCommerce already store: the
  **functional** ones (`shop`, `cart`, `checkout`, `my-account`, the front and posts pages) are
  omitted from the index with `meta.excluded_system` reporting the count, and **any** option-referenced
  page — which adds `privacy-policy` and the terms page, both real prose somebody must be able to
  edit — refuses `DELETE` with a 409 naming the option. **`?force=true` does not override it**, unlike
  the children guard: reparenting children is recoverable, while leaving
  `woocommerce_checkout_page_id` pointing at nothing makes WooCommerce report a missing page rather
  than a broken setting. The refusal is on the API rather than in this panel, so it holds for every
  caller. `tests/Api/cms.php` grew 155 → **169** assertions, each with its positive control.

Fixed in `ecom-temp` on **`feat/notification-filters`** while building the notifications branch:

- **A customer's own notifications were not readable in one request.** §90 shipped four filters and
  argued for `dedupe_key` as the one that matters — correctly, since the key is `event:subject_id` by
  construction. But it is exact-match only (`?dedupe_key=payment.received` → 0 rows) and it cannot
  express a set, so "everything sent to this person" and "everything about this order" had no filter
  at all. Measured before the branch, `?recipient=`, `?subject_id=`, `?event=` and `?audience=` were
  **accepted and silently ignored** — §65's failure mode, where a filter that does not filter looks
  exactly like a collection that all matches. The customer-detail tab would have cost one request per
  order per event name, four guesses per order, on names the panel would have had to hard-code.
  `?recipient=` and `?subject_id=` are two clauses in `buildWhere()` and two `args` entries, no
  migration; `tests/Api/notifications.php` went 56 → **67**. Neither widens disclosure — both columns
  are already on every list row and the route is `ac_manage_customers` throughout — and `recipient` is
  deliberately *not* validated as an email, because §29's other four channels would put a phone number
  in that column. `event` and `audience` stay unfilterable: `dedupe_key`'s left half is the event, and
  `audience` is separated by `recipient`.

Fixed in `ecom-temp` on `feat/coupon-pickers` while building the customers branch:

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

## Found on the notifications branch, and not fixed here

Two defects this branch surfaced that are wider than it. Both are recorded rather than fixed, because
fixing either means touching a dozen screens this branch has no business editing.

- **`formatWhen` cannot be server-rendered, and a dozen screens call it unguarded.** It is relative
  under 24 hours, so a row timestamped a minute ago renders "il y a une minute" on the server and
  "il y a 2 minutes" on the client — React reports a hydration mismatch and regenerates the tree. The
  notification queue is the only screen that shows it today, because it is the only one whose rows are
  *minutes* old (the seed writes them at run time); everywhere else the data is hours or days old and
  `formatWhen` falls back to the absolute form past 24 hours, so the mismatch never occurs. Fixed here
  with `useHydrated()` — absolute on the server, relative once the client owns the DOM — in
  `NotificationRow` alone. The other call sites are latent and would surface the day any of them shows
  fresh data.

- **A `.` in a message key is a path separator to `next-intl`, and nothing warns loudly.**
  `t("event.order.placed")` resolves `notifications` → `event` → `order` → `placed`, so a flat
  `"order.placed"` key never matches and the unresolved key path renders as text. All eight event
  labels were missing in both locales while **seven of eight e2e tests passed** — every row carried a
  plausible amount of writing and only the test matching a label exactly noticed. The dev log had
  `MISSING_MESSAGE` sixteen times throughout. `eventMessageKey()` underscores them, and
  `tests/notification-schema.test.ts` now asserts that no key in the namespace carries a dot and that
  every event, state, status, channel and audience resolves in both locales — a floor that costs
  milliseconds and needs no browser. **Any API vocabulary used as a message key has this hazard.**

## Open, and owed to the backend

- `/settings` could reasonably publish `store.timezone`.
- **`GET /notifications` has no summary.** The pending/sent/failed counts exist only on the CLI drain's
  `--summary`, so a queue-wide breakdown would cost one request per state. The panel counts the page it
  is holding and the label says so; a `meta.summary` block would let the screen answer "how healthy is
  the queue" rather than "how healthy is this page of it".
- **A movement has no readable actor for most of the staff who can read it.** `ac_manage_inventory` is
  held by four roles; `GET /users/{id}` is Super Admin only and `/audit-logs` stops at Admin. Either a
  movement could carry `actor_login` the way an audit row already does, or a narrow
  `GET /users/{id}/display-name` could sit behind `ac_manage_inventory`. Until then the ledger shows
  what it can prove, which is documented in `movementActor()`.
- **`inventory.adjusted` audit rows carry no movement id**, so the two records of the same event cannot
  be joined except by heuristic.
- **`ac_manage_content` guards the media *reads* as well as the writes**, which makes the gap
  ADMIN_PANEL.md documents wider than it says. A Product Manager deliberately cannot upload —
  `MediaService`'s docblock argues it — but the "attach an image that already exists" path the same
  section describes as theirs is not reachable either: measured, a Manager is **403 on `GET /media`**.
  A read-only media capability, or `ac_manage_products` on the reads, would make the picker buildable
  for the role that needs it. Until then `MediaPicker` renders the refusal naming the capability,
  which is honest and is not the affordance the specification asks for.
- **An attachment has no back-reference.** Nothing in the API answers "what uses this image?", so the
  media library cannot offer a delete it can explain. A `usage` block on `GET /media/{id}` — the
  banners, pages and homepage sections pointing at it — is what would make one possible.
- **A menu item cannot be resolved to a name.** The reader returns `object_id` for a page, category or
  product and nothing else, so the menu editor renders `#4192` where a person expects a product name.
  The page items are addressable by path and the rest are not; `GET /cms/menus/{location}` could carry
  the resolved label the way a coupon's restrictions now do.

## Not built on the content branch, and why

- **`DELETE /media/{id}`.** The route exists and `ac_manage_content` allows it, and it is off the
  proxy allowlist with a unit test saying so. Nothing in this API tells the panel what an attachment
  is used by — a banner's `image`, a page thumbnail and a homepage section all reference one with no
  back-reference anywhere — so the library cannot answer "what would this break?". An irreversible
  action a screen cannot explain is worse than one it does not offer.
- **Marketing, campaigns and notifications.** Part X's step-14 line names them; they are 14b and 14c
  and the reasoning is above and in Part X. Every route for all three stays off the allowlist, with a
  unit test asserting the refusal, because a route no screen calls must not be reachable by guessing
  a URL.
- **A rich-text editor.** `content` and `answer` are `<textarea>`s holding the stored HTML. That is
  deliberate for this branch rather than a shortcut: the API sanitises **on save**, so the panel's job
  is to render the stored result back, and an editor with its own model of the document is the thing
  most likely to show the author something other than what is stored. A WYSIWYG that round-trips
  `wp_kses`'s output faithfully is its own piece of work.
- **A page's featured image.** `image_id` is accepted on `PATCH /cms/pages` and the media picker
  exists, but the page form does not offer it: no screen in this panel renders a page thumbnail, so it
  would be a control whose effect is invisible from here. Banners take theirs because a banner *is*
  its image.

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
