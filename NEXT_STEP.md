# Next: `feat/analytics` — step 13, plus the envelope sweep

Continue the admin panel in this repo (`~/projects/ecom-admin`). The backend is
`~/projects/ecom-temp`, finished and running at `http://localhost:8090`.

## Read first

- **ADMIN_PANEL.md** — Parts II–VII are the spec. Read the `> **Corrected in the build:**` blocks;
  there are **forty-three**, and that is how this project records where the spec was wrong. Keep the
  convention: when the build proves the spec wrong, correct it in place with a note carrying the
  measurement.
- **ADMIN_PANEL.md → Dashboard (line ~1222) and Analytics (~1858).** Twenty-two lines for seven
  reports, and the paragraph about the date-range control describes a parameter that does nothing.
  See below.
- **README.md** — how to run it, the credentials, and the things that will bite. The operator errors
  at the end of the testing section are real: one of them cost a 25-minute WebKit run last branch.
- `~/projects/ecom-temp/docs/API.md` → Analytics.

## What already exists

Steps 5–12 are merged: shell, session and the credential boundary, the pattern set, orders, products
with facets, inventory, customers and coupons, and shipping with payments and COD.

- `components/primitives/` — GroupedList, Segmented, Sheet, ActionSheet, Toast, StatusBadge, Button,
  Icon, `Ltr`/`Isolate`, and `Field`.
- `components/patterns/` — Scaffold, TabBar/Sidebar, States, QueryProvider, FilterSheet.
- `lib/api/browser.ts` — the client-side envelope reader (`acRead`, `acWrite`, `BrowserApiError`).
- `lib/cod.ts`'s `CodFigure` and `lib/customers.ts`'s `StatFigure` — a figure that **cannot be
  printed without its scope**. Analytics is where this pattern earns its keep; copy the shape.
- `lib/shipping.ts` — the vocabulary / row-helper split, most recently applied.

`Ltr` is for a bare identifier only. `Isolate` for a formatted date and for any translated sentence
sharing an element with a number. `components/primitives/Ltr.tsx` carries the measurement.

The proxy allowlist in `lib/api/allowlist.ts` is a whitelist of exact route patterns. **No
`/analytics/*` route is on it.** Add exactly the ones your screens call, with a unit test asserting
both the additions and what stays refused.

## The task

`feat/analytics` — the dashboard and the seven reports. **Two commits**, the second unclaimed work
that is genuinely owed:

1. **Step 13.** `overview`, `revenue`, `orders`, `products`, `customers`, `shipping`, `cod`.
2. **The envelope sweep.** `orders/query.ts` and `products/query.ts` still hand-roll the reader
   `lib/api/browser.ts` provides — the differences between the copies were never intentional. Its own
   commit, with the e2e suite as the proof.

## What I measured, 2026-08-21, against the live API

Do not take these on trust — re-measure. But start from them, because two contradict the spec.

### The date range is `?range=` only, and the spec's parameter is a trap

Six presets: `today, yesterday, 7d, 30d, 90d, custom`. `custom` **requires** `date_from` and
`date_to`; the 366-day cap and a reversed pair are both real refusals:

```
range=custom                          400 {"fields":{"date_from":"Required when range is custom.", …}}
range=custom&…10 days                 200 preset=custom  days=10
range=custom&…966 days                400 {"fields":{"date_from":"A custom range covers at most 366 days."}}
range=custom&date_from>date_to        400 {"fields":{"date_from":"Must not be later than date_to."}}
range=400d  /  range=zzz              400 {"params":{"range":"range is not one of today, …, and custom."}}
```

**`date_from`/`date_to` sent *without* `range=custom` are silently ignored** — measured on all four
spellings, including a valid ten-day window, every one answering **200 with the 30-day default**. A
date picker that sends only the dates shows the operator their chosen window and thirty days of data.
So: always send `range`, and **render `data.range` back** rather than what the picker holds. Note the
two error shapes on one endpoint — a bad `range` is `details.params`, a bad date is `details.fields`.

### The money gate is unexercisable, and must be built anyway

`meta.money_visible` is `true` for **both** tiers and `/analytics/revenue` is **200** for both, because
the two-tier collapse gave Manager `ac_view_analytics` *and* `ac_manage_orders`. The spec's "403
without `ac_manage_orders`" and its required e2e ("a Support Agent's dashboard with no money")
describe a state no credential can now reach.

Build the gate regardless — the API still enforces it and a third tier brings the state straight
back. Cover it where it is coverable: `canSeeMoney()` is a pure predicate (unit), and the layout can
be rendered against a synthetic identity (component). State the e2e gap; do not silently skip it.

`meta.money_requires` is `"ac_manage_orders"` — **not in the spec**. Render the forbidden wording from
the response, the same discipline as rendering a 409's `allowed` list.

### `unavailable` is an object of reasons, in English

Not a list of names. On `/analytics/revenue`, three keys — `shipping_cost`, `payment_fees`, `margin` —
each mapped to a full sentence explaining *why*, e.g. *"Gateway fees are not summable across
providers. `ac_payment_transactions` has no fee column by design…"*. `/analytics/shipping` carries
`shipping_cost` alone.

This is the facet `scope_note` problem again: the panel is fr/ar and the sentence is English. Render a
localised line keyed on the **key**, and fall back to the API's sentence for a key you have no wording
for — rendering the raw note always puts an English paragraph at the foot of an Arabic sheet.

### Figures that do not divide, in four places

| Report | The pair | Why |
|---|---|---|
| `revenue` | `orders_placed` 844 vs `orders_counted` **289** | only some orders are counted into money |
| `revenue` | `net` 719 700 vs `collected` 145 150 | earned versus actually received |
| `cod` | `by_status.confirmed` 74 vs `confirmed_orders` 111 | current state versus ever-confirmed |
| `shipping` | attributed wilayas vs `unattributed` | see below |

`excluded_currencies` — which the spec says names the rest — was **absent** from every response. So
the 844 → 289 gap is *not* explained by the field the spec points at. Find what actually explains it
before labelling it; `/analytics/orders` carries `counted_as_revenue`, which is the likely half.

### The wilaya chart is mostly one slice, and it says why

`unattributed` is `{orders: 249, revenue: "652400.00", reason: "Orders with no shipment carry no
canonical wilaya; an order address stores it as free text, which is never guessed at."}` — against
**844 orders and 719 700 net**. So the unattributed slice is larger than every attributed wilaya
combined, and a chart that renders it as a nameless wedge reads as a bug. `by_wilaya` rows carry
`name` and `name_ar`; Algiers is still the English exonym `"Algiers"` by design (README says why).

### Also measured

`meta.cache_ttl` is 60 and the API caches server-side — **do not add a shorter client refetch on top
of it.** All seven routes answer 200 for both tiers. `/analytics/products` returns `best_sellers`,
`best_sellers_limit` and `low_stock`; `total_sales` is 0–2 across the whole catalogue, so a
best-sellers chart has almost no signal — say so rather than drawing a flat bar chart.

## Not measured — measure it yourself

What explains 844 vs 289; whether `excluded_currencies` ever appears; whether `range=today` on a shop
with no orders today returns zeros or omits blocks; whether the cache key varies by capability (it
must, or a money payload could be served to a caller without the gate — `docs/SECURITY_AUDIT.md`
claims it does); what `/analytics/products` does when `best_sellers` is empty.

## Method — it is what produced everything good so far

- **Measure, don't remember.** Every shape assumption that came from the spec rather than a request
  has been wrong at least once, including two above.
- **Every negative test carries a positive control.** A refusal and an unreachable route look
  identical from outside; so do an ignored parameter and an honoured one.
- **Every sweep carries a floor.** A grep that matches nothing must not report success.
- **Look at the render, not the code.** Last branch shipped clean source, green types and a passing
  unit suite; the screenshots found a row action rendering *on top of* a money figure at 390 px and a
  tariff row reading "National · National". Neither failed a test that existed.
- **Charts follow the `dataviz` skill.** Flat fills, no gradient areas, no shadows on bars. Axis
  direction mirrors in RTL; the numbers on it do not.
- Invoke `/impeccable` before any UI and `/apple-design` for the platform grammar.

## Before you write a line of UI

`AGENTS.md` is not boilerplate. This is Next.js 16.3.1, not 15. `proxy.ts` not `middleware.ts`;
`next/root-params` unusable under Turbopack (use `getLocale()`); `params`/`searchParams`/`cookies()`
are Promises; no `eslint` key in `next.config`; `app/layout.tsx` emits no `<html>`/`<body>`. Restart
`next dev` after switching branches, and `rm -rf .next` before believing a routing error only one
screen shows.

## Definition of done

`./scripts/test.sh` green — types, design, unit, e2e — plus:

- Both locales, at 390 and 440 px and on a desktop. 390 is the floor, not the typical width.
- `npx playwright test --project=phone-webkit` green. **105/105 today** (verified 2026-08-20) and not
  in the default run. **Export all four credentials** — with only two, nine tests skip and it reports
  96 passed, which is not the same thing as green.
- `scripts/check-design.sh` passes with its floor raised to match the new file count (123 today,
  floor 117).
- `npm run shots` green — **304 assertions today**, and extend it. A screenshot script that does not
  visit your screens reports a pass for work it did not check.
- The five states built as part of each screen, not afterwards.
- Every id, money figure and percentage on screen in `<Ltr>`; every formatted date in `<Isolate>`;
  every translated sentence carrying a number in `<Isolate>`, never `<Ltr>`.
- The allowlist grows by exactly the routes the new screens call, with a unit test asserting the
  additions and what stays refused.
- **Mint credentials immediately before an e2e run, and never while one is running.**
  `scripts/test.sh` mints four; `mint-credential.sh` deletes the account's previous Application
  Passwords, so anything exported earlier is already dead. This cost a full run last branch and the
  failures looked exactly like a broken login.
- **The log is the authority, not the exit code.** A background runner reported exit 0 twice for a
  run whose own summary said `failed:`.

## Still open, not for this branch

`feat/product-options` (§83's editor — three group types, caps, positional error paths, and the
measured hazard that saving a product deletes the groups `options_problems` warns about); the
attributes screen's write path; `POST /inventory/bulk`; a wilaya's French name (a new column, not an
edit — README says why); and `Field`'s `hint` rendering inside its `<label>`, so it joins the
control's accessible name while `FieldError` uses `aria-describedby` — shared by every form in the
panel, so it is its own change.

## Git

Branch `feat/analytics`, commit, merge into `main` locally with `--no-ff`. **Never push.**

Ask before building if anything is ambiguous — eight sessions running, asking up front has materially
improved the result. On this branch the question I would ask first: **the money gate has no role that
can reach it.** Build the two-card-set layout and cover it at unit and component level with the e2e
gap stated, or reinstate a narrow third role in `ecom-temp` purely so the state is reachable?
