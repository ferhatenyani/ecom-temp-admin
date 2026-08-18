# Next step — `feat/product-options`

Paste this into a fresh chat.

---

Continue the admin panel in this repo (`~/projects/ecom-admin`). The backend is `~/projects/ecom-temp`,
finished and running at `http://localhost:8090`.

## Read first

- `ADMIN_PANEL.md` in this repo — Parts II–VII are the spec. Part I is backend work, already done.
  **Read the `> **Corrected in the build:**` blocks.** That is how this project records where the spec
  was wrong, and there are now twenty-four of them. The three under **Products** and the one under
  **Configurable options — §83** are yours; several will save you an hour each. Keep the convention:
  when the build proves the spec wrong, correct it in place with a note carrying the measurement.
- `README.md` — how to run it, the credentials, and the list of things that will bite.
- `~/projects/ecom-temp/docs/API.md` — the contract. "Configurable options — §83" and "Global
  attributes — §88" are the two that matter here.

## What already exists

`feat/products` is merged: the products list with nine filters and facets, and the detail as a form.

- `components/primitives/` — `GroupedList`, `Segmented`, `Sheet`, `ActionSheet`, `Toast`,
  `StatusBadge`, `Button`, `Icon` (sprite), `Ltr`, and **`Field`** (text, decimal, textarea, select,
  switch, read-only — each binding its own error, because a 400 lists every bad field at once).
- `components/patterns/` — `Scaffold`, `TabBar`/`Sidebar`, `States`, `QueryProvider`, and
  **`FilterSheet`** (the pill row, the removable chips, the sheet, the value pills).
- `lib/products.ts` — `mergeFacet` and the vocabulary helpers. **Read its docblocks before touching
  any facet**: the facet response is a set of counts, not a vocabulary, and the reasons are measured.
- `lib/product-status.ts` — the vocabulary with no dependencies, so client components do not pull Zod.
- `scripts/seed-attributes.mjs` — creates the global attributes this shop shipped without. Idempotent,
  and `scripts/test.sh` runs it before e2e.

## The task

**`feat/product-options` — the `options` editor (§83), and then the attributes screen.**

The specification calls the options editor the hardest component in the panel, which is why it was
split out of the products branch rather than rushed at the end of it. Three group types — `choice`,
`text`, `bundle` — with caps (20 groups, 50 choices, 20 bundle components), negative `price_delta`
allowed, `image_id` that must already exist, and errors that name a **position**:
`options.groups[0].choices[2].price_delta`. Map those paths onto the form's field paths exactly, or a
validation error lands nowhere.

The line above the editor is the rule that stops the whole misunderstanding: **a variation has a SKU
and stock; an option is a modifier with neither.**

What is already known, measured, and written up in the spec:

- **`options`, `bundle` and `options_problems` are absent keys**, not nulls, on a product without an
  option set. None of the 28 products has one, so you will be creating the first.
- **`options_problems` names a group by 1-based position, not by id** — `"Option group 4 was dropped:
  Must be one of: choice, text, bundle."` — because the broken group is absent from `options.groups`
  and there is nothing to link the warning to. The products detail already renders the warning.
- **Saving the product deletes what that warning is about.** A whole-object round trip writes back only
  the readable groups. The warning says so; the editor must not quietly undo it.
- **`bundle.available` is computed on every read** and refused on write.
- Send `"options": null` to clear.

Then the attributes screen, which the products branch deliberately left read-only:

- A flat list for attributes with a drill-in for terms, plus the categories tree.
- **Do not build a partial attribute editor.** Replacing a variable product's `attributes` drops its
  variation attribute and WooCommerce clears every variation's attribute map — measured on products 12
  and 21. Whatever writes `attributes` has to write the whole list.
- §88's two warnings belong on screen: a newly created attribute's facet counts are zero until the next
  request, and changing a term slug breaks saved filters and storefront links.

## Method — it is what produced everything good so far

1. **Measure, don't remember.** Hit the real API before designing against its shapes. Every shape
   assumption that came from the spec rather than from a request has been wrong at least once. Sweep
   the whole collection, not one row.
2. **Every negative test carries a positive control.** A refusal and an unreachable route look
   identical from outside.
3. **Every sweep carries a floor.** A grep that matches nothing must not report success.
4. **Look at the render, not the code.** The products branch shipped three defects that were invisible
   in the source and obvious in a screenshot: every category counted `0` because the facet keys by slug
   and the vocabulary by term id; the first filter pill sat flush against the viewport edge because
   scroll-snap aligns to the scrollport rather than to its padding; and the desktop sheet rendered
   544 × 0 because `inset-block: 50%` is not centring.
5. **Invoke `/impeccable` before any UI and `/apple-design` for the platform grammar.**

## Before you write a line of UI

`AGENTS.md` is not boilerplate. **This is Next.js 16.3.1, not 15**, and the docs are in
`node_modules/next/dist/docs/`. The four that already bit:

- `middleware.ts` is `proxy.ts`, and the export must be named `proxy`.
- `next/root-params` **cannot be used** — webpack-only compiler pass, and Next 16 builds with
  Turbopack. Use `getLocale()` from `next-intl/server`.
- `params`, `searchParams` and `cookies()` are all Promises.
- The `eslint` key is gone from `next.config`, and `next build` no longer lints.

## Definition of done

`./scripts/test.sh` green — types, design, unit, e2e — plus:

- Both locales, at 390 and 440 px and on a desktop. 390 is the design floor, not the typical width.
- `scripts/check-design.sh` still passes with its floor raised to match the new file count.
- The five states built as part of each screen, not afterwards.
- Every new identifier on screen wrapped in `<Ltr>`.
- New rows measured against the skeleton, so the list does not shift when data lands.
- The proxy allowlist grows by exactly the routes the new screens call, with a unit test asserting
  both the additions and what stays refused.

## Still open, and worth an hour

- ~~**WebKit has never run.**~~ Closed 2026-08-18: `npx playwright test --project=phone-webkit` is
  34/34 on WebKit 26.0. `backdrop-filter`, `env(safe-area-inset-*)` and bidi isolation all hold. It is
  still not in the default run — the deps are 231 apt packages and root — so run it deliberately after
  any change to the sheet, the safe-area padding or the bidi isolation. Install with
  `sudo env "PATH=$PATH" npx playwright install-deps webkit`; plain `sudo npx` cannot see an
  nvm-installed node.
- **A wilaya's French name.** `name` for wilaya 16 is the English *Algiers*, deliberately, because the
  dataset matches WooCommerce's DZ state list and the slug derived from it is a join key. A French
  display name would be a new field on `wp_ac_geo_wilayas`, not an edit to that one. See README.

## Git

Branch `feat/product-options`, commit, merge into `main` locally with `--no-ff`. **Never push.**

Ask before building if anything is ambiguous — four sessions running, asking up front has materially
improved the result.
