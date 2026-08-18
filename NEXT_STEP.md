# Next step — `feat/products`

Paste this into a fresh chat.

---

Continue the admin panel in this repo (`~/projects/ecom-admin`). The backend is `~/projects/ecom-temp`,
finished and running at `http://localhost:8090`.

## Read first

- `ADMIN_PANEL.md` in this repo — Parts II–VII are the spec. Part I is backend work, already done.
  **Read the `> **Corrected in the build:**` blocks.** That is how this project records where the spec
  was wrong, and there are now sixteen of them from the orders branch. Several will save you an hour
  each. Keep using the convention: when the build proves the spec wrong, correct it in place with a
  note carrying the measurement.
- `README.md` — how to run it, the credentials, and the short list of things that will bite.
- `~/projects/ecom-temp/docs/API.md` — the contract. "Products", "Global attributes — §88",
  "Listing, filtering and facets — §82" and "Configurable options — §83" are the ones that matter here.

## What already exists

`feat/panel-bootstrap` is merged: the shell, the credential boundary, and Orders end to end in both
locales. Reuse it rather than rebuilding it.

- `components/primitives/` — `GroupedList`, `Segmented`, `Sheet` (Radix, bottom sheet on mobile and
  centred modal at md), `ActionSheet`, `Toast`, `StatusBadge`, `Button`, `Icon` (sprite), `Ltr`.
- `components/patterns/` — `Scaffold` (collapsing large title), `TabBar`/`Sidebar`, `States` (all five),
  `QueryProvider`.
- `lib/api/` — `client`, `envelope`, `errors` (the status→behaviour mapping), `allowlist`, `schemas/`.
- `lib/format/` — `money`, `date`, `html`. `lib/capabilities.ts` for the named predicates.
- `scripts/` — `check-design.sh`, `test.sh`, `mint-credential.sh`, `reset-rate-limit.sh`, `shots.mjs`.

Two primitives the orders screen did not need and products does: a **Field** set for forms, and a
**filter sheet** built on the existing `Sheet`.

## The task

**`feat/products` — Part X step 9: the list with facets, and the detail.**

Scope it to list + detail + the pieces below. **Leave the `options` editor out** and give it its own
branch; the spec calls it the hardest component in the panel and it will otherwise swallow the whole
branch.

What must be right, all of it from the spec's own warnings:

- **Nine filters plus facets.** On mobile the filter bar is a horizontally scrolling row of pills that
  opens the filter sheet; selected filters render as removable chips above the list.
- **A facet's counts exclude its own filter.** With `pa_size=m` selected the size facet still reports
  `l` and `xl`. Render every value in a group, zero-count ones included, so a selection never creates a
  dead end.
- **Counts are published-only; the list includes drafts.** Seven rows beside a count of six is correct.
  Render `scope_note` beside the facet block, or someone will "fix" it into something wrong.
- **Groups cap at 50** with `truncated` and `total_values`. Show "50 sur 128"; a bounded list that does
  not say so reads as complete.
- **GET then PATCH the whole object.** Read-only fields are dropped, not rejected. Build the form
  around the full object rather than diffing.
- **A 400 lists every bad field** — render `details.fields`, mapped onto the form's field paths.
- **`DELETE` trashes; `?force=true` is permanent** and gets its own confirmation with different wording.
- `options_problems` on a GET means the stored document has a group the API could not read — surface it
  as a warning, because carts holding that product are already refusing to check out.

## Method — it is what produced everything good so far

1. **Measure, don't remember.** Hit the real API before designing against its shapes. Every shape
   assumption in the orders branch that came from the spec rather than from a request was wrong at
   least once. Sweep the whole collection, not one row: "8 % of orders carry a wilaya" is the fact that
   changed the design, and one row would have shown the opposite.
2. **Every negative test carries a positive control.** A refusal and an unreachable route look identical
   from outside. `?wilaya=16` returning 200 looked like a working filter until `?bogus_param=1` returned
   the same 200.
3. **Every sweep carries a floor.** A grep that matches nothing must not report success.
4. **Look at the render, not the code.** Four defects in the orders branch were invisible in the source
   and obvious in a screenshot: a segmented thumb that did not line up, a skeleton 9 px short, two rows
   labelled "Adresse", and a house number the bidi algorithm had moved.
5. **Invoke `/impeccable` before any UI and `/apple-design` for the platform grammar.** The spec
   constrains those skills; it does not replace them.

## Before you write a line of UI

`AGENTS.md` is not boilerplate. **This is Next.js 16.3.1, not 15**, and the docs are in
`node_modules/next/dist/docs/`. The four that already bit:

- `middleware.ts` is `proxy.ts`, and the export must be named `proxy`.
- `next/root-params` **cannot be used** — it is a webpack-only compiler pass and Next 16 builds with
  Turbopack. Use `getLocale()` from `next-intl/server`.
- `params`, `searchParams` and `cookies()` are all Promises.
- The `eslint` key is gone from `next.config`, and `next build` no longer lints.

## Definition of done

`./scripts/test.sh` green — types, design, unit, e2e — plus:

- Both locales, at 390 and 440 px and on a desktop. 390 is the design floor; it is the *narrowest*
  current iPhone, not the typical one.
- `scripts/check-design.sh` still passes with its floor raised to match the new file count.
- The five states built as part of each screen, not afterwards.
- Every new identifier on screen wrapped in `<Ltr>`. A SKU is exactly the case that breaks.
- New rows measured against the skeleton, so the list does not shift when data lands.

## Housekeeping worth doing first — both are small

1. **Two backend data fixes**, in `~/projects/ecom-temp`: `name_ar` is empty for Algiers (16) and Oran
   (31) in `/locations/wilayas` — the two busiest wilayas — and wilaya 16's `name` is the English
   "Algiers" rather than "Alger". The panel falls back, but the data is wrong.
2. **`sudo npx playwright install-deps webkit`.** One command, and it closes the only unverified risk
   the panel is carrying: `backdrop-filter`, `env(safe-area-inset-*)` and bidi isolation have never run
   on WebKit, which is the engine iOS Safari actually uses. Then
   `npx playwright test --project=phone-webkit`.

## Git

Branch `feat/products`, commit, merge into `main` locally with `--no-ff`. **Never push.**

Ask before building if anything is ambiguous — three sessions running, asking up front has materially
improved the result.
