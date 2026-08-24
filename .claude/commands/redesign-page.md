---
description: Migrate ONE page of the admin panel to the new design system, verify it, and merge it. Stops after one page.
argument-hint: "[page name, e.g. coupons — omit to take the next unticked item]"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Agent, Skill, TodoWrite
---

You are the orchestrator for a page-by-page redesign of this admin panel.

**Page for this session: $1** — if that is empty, take the first unticked item
from the checklist in `DECISIONS.md`.

**You are doing exactly ONE page, then stopping.** Do not continue to the next
one. Do not "just start" the following page because there is room left.

## Read before anything else

1. `DECISIONS.md` — the ledger. Its checklist, its **standing rules** table, and
   its "Carried forward" list. Most useful file in the repo for you.
2. `DESIGN.md` — the house rules. §2.3, §3.1, §3.2, §3.4, §3.6, §3.7, §8.
3. `AGENTS.md` — Next.js 16, with breaking changes from your training data. The
   docs are in `node_modules/next/dist/docs/`. Consult them; do not assume.
4. The nearest **migrated** equivalent of the page you are building:
   - list screens → `app/[locale]/(panel)/products/` or `customers/`
   - detail screens → `app/[locale]/(panel)/orders/[id]/`
   - forms → `app/[locale]/(panel)/products/[id]/`
   - a list + a ledger → `app/[locale]/(panel)/inventory/`
5. `components/ui/` — every file. `Form.tsx` is a full superset of the retired
   `components/primitives/Field.tsx`; most of what a screen needs already exists,
   so you should be wiring, not building.

## The loop

**1. SCOUT.** Spawn one investigate-only agent (`Explore`). It writes no code.
It reports: what the API genuinely supports, what it accepts-but-ignores, which
routes are allowlisted, what the current screen is and which retired primitives
it uses, which `e2e/*.spec.ts` assertions break, what the mock still lacks, and
every open decision with its trade-off — **without resolving them.** Cap it at
~85 lines, demand `file:line` citations.

**2. DECIDE.** You resolve every open question, using the standing rules in
`DECISIONS.md` as defaults. Do not deliberate at length. Deviate only when the
scout found a hard constraint, and say so when you record it.

**3. MOCK, if needed.** If the scout finds the mock cannot serve the screen,
spawn a separate agent for `scripts/mock-api.mjs`, `scripts/mock-api.d.mts`,
`scripts/capture.mjs` and `tests/mock-api.test.ts` **only**. Commit it on its own
before the screen. Always ask that agent for an **honesty audit** — anywhere the
mock is more capable, permissive or forgiving than the measurements recorded in
`lib/`, `ADMIN_PANEL.md` or `README.md`. That sweep has found real defects on
every branch it ran on.

**4. BUILD.** Spawn a fresh agent with the decisions fixed. It reuses
`components/ui/` rather than inventing primitives; if it needs a variant that
does not exist it **extends the primitive** so the next page inherits it. It also
updates that page's e2e spec — selectors and structure change, what each test
checks does not, and no test is deleted.

**5. VERIFY YOURSELF. Never trust the report.**

```
npx tsc --noEmit                 # silent
npm run lint                     # 0 errors (11 warnings is the baseline)
npm run test:design              # all 14 checks
npm run test:unit                # all pass
rm -rf .next && npm run build    # the rm matters
node scripts/capture.mjs <the routes you touched> <one you did not>
```

`capture.mjs` renders each route at 340/768/1440 × light/dark × fr/ar and asserts
zero console errors, no horizontal overflow, that the stylesheet loaded, that
Plex resolved, and that light and dark compute different backgrounds. Then
**open the PNGs in `.impeccable/harness/` and judge them** — a pass is the floor,
not the goal.

Where a claim is visual or structural, **measure it in a real browser** rather
than reading the report. Copy `capture.mjs`'s server setup into a scratch script
outside the repo. That has contradicted an agent's report more than once.

Red means send the agent back with the failure. **Never merge red.**

**6. RECORD.** Append a short block to `DECISIONS.md` — layout, filters,
sorting, row click, omitted deliberately, notes — and tick the checklist. Keep it
brief; that file was deliberately condensed. Add anything panel-wide you found
but did not fix to "Carried forward".

**7. COMMIT AND MERGE.** Branch `feat/<page>-redesign` off `main`. Commit in this
repo's style: lowercase `type(scope): subject`, and a body explaining the
reasoning and naming what was deliberately omitted. Merge to `main` with
`--no-ff`.

Never commit `NEXT_STEP.md`. Never push. Never rewrite history. Never touch
`.env*`.

**8. STOP.** Report what you did, what you found, and what you left out.

## Non-negotiables

- **This API accepts parameters and silently ignores them.** A control ships only
  when someone measured it working. Anything unverified is treated as broken, and
  its absence is recorded rather than left looking like an oversight.
- A control that cannot act is **not rendered** — never disabled with no reason.
- No bulk write without a measured, allowlisted endpoint.
- **Copy never names a screen, destination or action that does not exist** in
  this panel.
- Every string from `messages/{fr,ar}.json`, both files, real Arabic, no literal
  in a component. Remove keys that lose their last caller. Verify key parity.
- Extend primitives; never fork one into a page.
- If building proves a `DESIGN.md` rule wrong, amend the doc and record why in
  the same edit. That has happened four times and is expected.
- Do **not** delete anything in `components/primitives/` or
  `components/patterns/` — unmigrated screens still import them, and a teardown
  pass at the end of the run removes them.

## Every page clears this bar

Five real states (loading skeleton matching the true box model; empty
distinguishing no-data from no-results; forbidden naming the capability; error
with retry; stale marker where data can actually age). A route-level
`loading.tsx` matching first paint. Every action has loading, disabled and error
handling, and disabled says why. Background refetch keeps content on screen. Long
strings, missing fields and zero rows all render. Full keyboard path, focus
visible, overlays trap and restore focus. Real table semantics with `aria-sort`
only where something sorts. Verified at 340/768/1440, light and dark, French and
Arabic. Numerics tabular, identifiers `Ltr`-wrapped, dates `Isolate`-wrapped.

"Modern and professional" here means **restraint and finish, not more chrome** —
and that applies to words as much as to decoration.

## Subagent preamble

Every agent you spawn must begin with:

```
FIRST invoke and follow both skills:
  Skill(skill="ui-ux-pro-max:ui-ux-pro-max")
  Skill(skill="andrej-karpathy-skills:karpathy-guidelines")
```

Tell each agent: do not commit, branch, push or merge; never touch `.env*`; never
revert work it did not write. Ask for terse reports — under 45 lines — and
explicitly invite it to say plainly where the brief was wrong rather than working
around it silently. Agents have corrected the orchestrator's fixed decisions
three times in this run and were right each time.
