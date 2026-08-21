# Next: `feat/product-options` — §83's editor, the hardest component in the panel

Continue the admin panel in this repo (`~/projects/ecom-admin`). The backend is
`~/projects/ecom-temp`, finished and running at `http://localhost:8090`.

## Read first

- **ADMIN_PANEL.md** — Parts II–VII are the spec. Read the `> **Corrected in the build:**` blocks;
  there are **sixty**, plus one `> **Verified in the build:**` where a claim was checked and held.
  That is how this project records where the spec was wrong. Keep the convention: when the build
  proves the spec wrong, correct it in place with a note carrying the measurement.
- **ADMIN_PANEL.md → Products (line ~1499).** Eight lines for the editor, and one correction block
  under them about `options_problems`. The eight lines are accurate as far as they go and they do not
  go far enough; see below.
- `~/projects/ecom-temp/docs/API.md` → **Configurable options — §83**, and the two paragraphs after
  it about carts. The cart half is not this branch's work and it is the reason the editor is
  dangerous — read it anyway.
- **README.md** — how to run it, the credentials, and the things that will bite. The operator errors
  at the end of the testing section are real; the newest one cost a diagnosis cycle last branch and
  reads as a compile error in your own source.

## What already exists

Steps 5–13 are merged: shell, session and the credential boundary, the pattern set, orders, products
with facets, inventory, customers and coupons, shipping with payments and COD, and the dashboard with
the six analytics reports.

- `components/primitives/` — GroupedList, Segmented, Sheet, ActionSheet, Toast, StatusBadge, Button,
  Icon, `Ltr`/`Isolate`, `Bar`, and `Field` (which now has `DateField`).
- `components/patterns/` — Scaffold, TabBar/Sidebar, States, QueryProvider, FilterSheet, RangeControl.
- `lib/api/browser.ts` — **the only envelope reader in the panel.** `orders/query.ts` and
  `products/query.ts` were swept into it last branch; do not hand-roll a fetch.
- `app/[locale]/(panel)/products/[id]/ProductDetail.tsx` — the form the editor has to live inside. It
  already renders the `options_problems` warning, including the line about saving destroying the
  evidence. It does **not** render `options` at all.
- `lib/api/schemas/product.ts` — `options` is `looseObject({groups: array(looseObject({id}))})`,
  which is enough not to break and nowhere near enough to edit. Widening it is step one.
- `lib/analytics.ts` and `lib/shipping.ts` — the vocabulary / row-helper split, most recently applied.
  `RevenueFigure`, `CodFigure` and `StatFigure` are the same pattern three times: a figure that
  cannot be printed without its scope.

`Ltr` is for a bare identifier only. `Isolate` for a formatted date and for any translated sentence
sharing an element with a number. **`Ltr` around a full-width cell forces the cell's direction, not
just the identifier's** — that one was found by looking at an Arabic screenshot, not at the markup.

The proxy allowlist in `lib/api/allowlist.ts` is a whitelist of exact route patterns. `PATCH
/products/{id}` is already on it and is the only route an option set is written through. **`/media`
is not on it**, and see below for why that is a decision rather than an oversight.

## The task

`feat/product-options` — §83's editor. **Two commits**, the second unclaimed work that is genuinely
owed:

1. **The editor.** Three group types, the caps, the positional error paths, and the identifier
   hazard below.
2. **`Field`'s `hint` rendering.** It is inside the `<label>`, so it joins the control's accessible
   name and changes as the hint does, while `FieldError` uses `aria-describedby`. Shared by every
   form in the panel, which is why it has been deferred three times and why it is its own commit.

## What I measured, 2026-08-21, against the live API

Do not take these on trust — re-measure. But start from them, because four are not in either
specification.

### Zero of the 28 products carry an option set

Same as when the products branch measured it. So the editor is built against a shape nothing in the
shop has, and **you need a seed script** — `scripts/seed-attributes.mjs` and
`scripts/seed-shipping-rules.mjs` are the precedent, both idempotent, both run by `scripts/test.sh`.
Without one, every e2e assertion about this screen is an assertion about an empty state.

`options`, `bundle` and `options_problems` are **absent keys**, not nulls, on a product without one.

### The positional error paths are real, and they are the whole difficulty

Every one of these was provoked. Map them onto the form's field paths exactly or the error lands
nowhere:

```
options.groups[0].choices[2].price_delta   "Must be a number."
options.groups[0].choices[0].image_id      "999999 is not an image attachment."
options.groups[0].items[0].product_id      "No product with id 999999."
options.groups[0].items[0].quantity        "Must be between 1 and 999."
options.groups[1].id                       "Duplicate group id \"dup\"."
options.groups[0].type                     "Must be one of: choice, text, bundle."
options.groups[0].max_length               "Must be between 1 and 500."
```

**Three different mistakes land on `options.groups[0].min`**, and only one of them is a `min`:

```
required: true, min: 0   → "A required group needs a min of at least 1."
min: 2, max: 1           → "Cannot be greater than max."
```

So the error→control mapping is many-to-one, and a form that binds `min` errors to the `min` input
will show "a required group needs a min of at least 1" under a field the person did not touch. Decide
where each of those actually belongs before writing the binding.

### A cap is reported on the collection, not on a row

20 groups, 50 choices, 20 components — all confirmed at the boundary, 20 passing and 21 refused:

```
options.groups                 "At most 20 groups."
options.groups[0].choices      "At most 50 choices."
options.groups[0].items        "At most 20 components."
options.groups[0].choices      "A choice group needs at least one choice."
```

None of those has an index. **The form needs an error slot on each collection**, not only on its
rows, and an editor built as a list of row-bound fields has nowhere to put them.

### One 400 carries many errors at once, all inside one group

Undocumented, and found by accident while probing the component cap: **a bundle refuses the same
product listed twice** — and it reports every duplicate index in one response.

```
items: [18, 18, 18, 19, 19]  → 400 with three field errors:
  options.groups[0].items[1].product_id  "The same component is listed twice."
  options.groups[0].items[2].product_id
  options.groups[0].items[4].product_id
```

A 20-component group of the same product produced nineteen. The form has to render an arbitrary
number of simultaneous errors inside one group.

### `bundle` is flattened across every bundle group, and `available` is the product's

Two bundle groups came back as **one** top-level `bundle` with the union of both item lists and a
single `available: 12`. It is computed on every read as the minimum the components allow and is never
stored.

So `available` does not belong to a group, and rendering it beside one is a lie the moment a second
bundle group exists. Measured: one group drawing 2× product 18 gave `available: 60`; adding a second
drawing 5× product 19 changed the whole product's figure to 12.

### A group id is an identifier the shopper's cart depends on

```
id: "Gravure spéciale"  → 400  "Must be 1–32 characters of a–z, 0–9, hyphen or underscore."
id: ""                  → the same
```

It is required, it is not generated, and it rejects the French label an operator will want to type.
And it is what `POST /cart/items` sends — `{"wrap": "gold"}` — so **renaming a group id on a product
with live carts is not a rename, it is a break.** `meta.problems` appears on the cart line and
`POST /checkout` refuses until the shopper chooses again. The editor has to either generate the id
from the label and lock it after the first save, or expose it as an identifier field with that
warning beside it. That is the design decision of this branch.

### The Manager tier can write an option set and cannot browse images for it

```
Manager  PATCH /products/89 with options   200
Manager  GET   /media                      403
Manager  GET   /products/89, /attributes   200
```

`/media` is `ac_manage_content` **on all five routes, including the reads** — `MediaService`'s own
docblock explains the upload half and calls the gap deliberate: a Product Manager "cannot upload,
only attach an image that already exists". But `choice.image_id` is exactly that attach path, and
there is no way to discover an id without the capability. **The documented fallback is unreachable
for the role it was designed for.**

`GET /media` works for a Super Admin — 41 items, paginated, carrying `id`, `title`, `alt`, `url`,
`mime_type`, `width`, `height`. This is the `feat/coupon-pickers` argument arriving in a second place:
`/coupons/eligible-products` exists because a Marketing Manager was 403 on `/products` while holding
`ac_manage_coupons`. See the question at the bottom.

### Also measured

`options: null` clears the set and both `options` and `bundle` disappear from the response.
A bundle drawing on a product that does not track stock still returns an `available`.
Negative `price_delta` is accepted, as the spec says.

## Not measured — measure it yourself

Whether `price_delta` has bounds of its own, and what a negative one larger than the product's price
does. Whether a `choice` id has the same charset rule as a group id. What `GET /products?facets=` does
with a product carrying an option set. Whether `bundle.available` accounts for a component that is
itself a bundle. What the editor should do with a product whose `options_problems` is non-empty —
the warning already says saving destroys the evidence, and the editor is the thing that saves.

## Method — it is what produced everything good so far

- **Measure, don't remember.** Every shape assumption that came from the spec rather than a request
  has been wrong at least once. Four above are new.
- **Every negative test carries a positive control.** A refusal and an unreachable route look
  identical from outside; so do an ignored parameter and an honoured one. 20 groups passing is what
  makes 21 refused a cap rather than a coincidence.
- **Every sweep carries a floor.** A grep that matches nothing must not report success. Where a
  screen *explains* a number, prove the explanation on the payload and let it fall back to stating
  the gap — `countedReconciliation()`'s `proves` flag is the pattern.
- **Look at the render, not the code.** Last branch shipped clean source, green types and a passing
  unit suite; the captures found an English paragraph across the middle of the Arabic sheet, a
  provider name at the wrong end of an RTL row, and an orphaned colon. None failed a test that
  existed.
- Invoke `/impeccable` before any UI and `/apple-design` for the platform grammar. There are no new
  charts here, so `dataviz` is not needed — but if you add one, every chart in this panel is
  single-series magnitude drawn as a bar with its value printed as text, and README says why.

## Before you write a line of UI

`AGENTS.md` is not boilerplate. This is Next.js 16.3.1, not 15. `proxy.ts` not `middleware.ts`;
`next/root-params` unusable under Turbopack (use `getLocale()`); `params`/`searchParams`/`cookies()`
are Promises; no `eslint` key in `next.config`; `app/layout.tsx` emits no `<html>`/`<body>`. Restart
`next dev` after switching branches, and `rm -rf .next` before believing a routing error only one
screen shows — **or a type error in a file you did not write.** A dev server killed mid-generation
leaves a torn `.next/dev/types/routes.d.ts`, `tsconfig.json` includes it, and `tsc` then fails with a
syntax error against generated code. Check the directory is actually gone; an interrupted `rm -rf`
leaves the bad file behind.

## Definition of done

`./scripts/test.sh` green — types, design, unit, e2e — plus:

- Both locales, at 390 and 440 px and on a desktop. 390 is the floor, not the typical width. A
  twenty-group editor at 390 px is the hardest layout in the panel; draw it there first.
- `npx playwright test --project=phone-webkit` green. **123/123 today** (verified 2026-08-21) and not
  in the default run. **Export all four credentials** — with only two, nine tests skip. A run
  reporting any skip is a run that did not test what its number suggests.
- `scripts/check-design.sh` passes with its floor raised to match the new file count (139 source
  files today, 141 scanned, floor 133).
- `npm run shots` green — **384 assertions today**, and extend it. A screenshot script that does not
  visit your screens reports a pass for work it did not check.
- The five states built as part of each screen, not afterwards.
- Every id, money figure and percentage on screen in `<Ltr>`; every formatted date in `<Isolate>`;
  every translated sentence carrying a number in `<Isolate>`, never `<Ltr>`. And `<Ltr>` around the
  identifier, never around the cell holding it.
- The allowlist grows by exactly the routes the new screens call, with a unit test asserting the
  additions and what stays refused.
- **Mint credentials immediately before an e2e run, and never while one is running.**
  `scripts/test.sh` mints four; `mint-credential.sh` deletes the account's previous Application
  Passwords, so anything exported earlier is already dead.
- **The log is the authority, not the exit code** — and it cuts both ways. A background runner has
  reported exit 0 for a run whose own summary said `failed:`, and last branch a `failed: types` turned
  out to be a corrupt generated file rather than the source. Read the summary, then find out which.

## Still open, not for this branch

The attributes and categories write path; `POST /inventory/bulk`; a wilaya's French name (a new
column, not an edit — README says why); Part VI's service worker; and everything after Products in
Part V — Content, Media, Marketing, Campaigns, Notifications, Import/export, Settings, Users, Audit.

New from the analytics branch:

- **The analytics screens render a courier's raw key** (`manual`, `acfake`) because
  `/shipping/providers` is `ac_manage_shipping` and analytics is `ac_view_analytics` alone. Fetching
  it would 403 for exactly the reader the report exists for. A narrow provider-label route, or the
  label carried on the analytics payload, would fix it. Owed to the backend, not to the panel.
- **The dashboard has no deltas and no sparklines**, because the API publishes no comparison period
  and no time series. The `dataviz` stat-tile contract makes both optional and the cards say nothing
  false — but "up or down from last month" is the first question anyone asks a dashboard, and no
  endpoint can answer it. That is a backend change, not a screen.
- `/export/orders` and the other export routes stay off the allowlist with a unit test saying so.
  They are the neighbouring feature to analytics — the same figures, as a file — and they are their
  own screen.

## Git

Branch `feat/product-options`, commit, merge into `main` locally with `--no-ff`. **Never push.**

Ask before building if anything is ambiguous — nine sessions running, asking up front has materially
improved the result, and last branch the question I asked had a **third** answer neither option
offered. On this branch the question I would ask first: **the group id.** It is a shopper-facing
identifier that the operator has to author, it rejects the French label they will type, and changing
it after the fact breaks live carts. Generate it from the label and lock it after the first save, or
expose it as an editable identifier with the warning beside it?

And the one behind it: **a Manager can write `choice.image_id` and cannot browse `/media` to find
one.** Ship the image picker as Super-Admin-only with a stated degradation, or pay the backend the
way `feat/coupon-pickers` did and add a narrow media-read route under `ac_manage_products`?
