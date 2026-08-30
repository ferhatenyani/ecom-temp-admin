# DESIGN.md — the house rules

The single source of truth for how this panel looks and behaves. Read it before
touching any screen. It replaces Part III of `ADMIN_PANEL.md` in full.

Direction: **structured neutral** — light-first, dark derived. Cards on a quiet
ground, hierarchy carried by whitespace and type weight, borders used
deliberately rather than everywhere, colour reserved for meaning. The reference
points are Stripe's dashboard and Vercel's console: sober, dense where data is
dense, roomy where a human has to read.

---

## 0. What this replaces

The previous direction was iOS. It is **retired in full** — not softened, not
selectively kept. If you find any of the following in a file you are editing,
it is a defect, and fixing it is part of the edit:

| Retired | Why it goes | Replaced by |
| --- | --- | --- |
| Grouped inset lists on a `#f2f2f7` ground | A phone metaphor. Wastes a desktop, and reads as a settings screen when it is a data screen. | §4.2 `DataTable` / `RecordList` |
| Bottom sheet with detents as the only modal | One overlay cannot be a filter, a form, a confirm and a menu. | §4.1 — five distinct overlays |
| `ActionSheet` | A phone control with no desktop equivalent. | §4.1 `Menu` |
| Bottom tab bar, 5 slots + `More` | 20+ routes do not fit 5 slots. Half the panel lives behind `More`. | §3.2 grouped sidebar / drawer |
| Collapsing large-title nav bar (`Scaffold`) | Animates the chrome on every scroll to save 30px. | §3.4 static `PageHeader` |
| `max-w-3xl` on every screen | A 768px column on a 1920px monitor. | §3.3 content widths |
| iOS type scale (17px body, 34px large title) | Sized for arm's length, not for a monitor. | §2.2 |
| iOS radii (8/12/14/20px) | Roundness is the loudest iOS tell. | §2.4 (4/6/8/12) |
| iOS blue `#007aff` as the everywhere-accent | Blue chrome, blue buttons, blue back links, blue nav pills. | §2.1 — ink primary, accent for meaning only |
| `.press` / `scale(0.97)` on tap | A touch idiom applied to a pointer UI. | §5 — background and border state changes |
| `--ease-ios`, `--dur-slow: 420ms` | Slow, and named after a platform we no longer follow. | §2.6 |
| `.material-bar` blur chrome | Translucent chrome over a data table costs legibility for nothing. | Opaque `--color-surface` + a border |
| `.tonal` badges tinting text with the raw semantic hue | `#34c759` text on a 14% green wash fails contrast. | §4.5 — paired `-fg` / `-bg` tokens |
| "Elevation is a surface step, never a shadow" | Correct for iOS, wrong here. | §2.5 — border-first, tokenised shadow |
| `Segmented` as the primary filter control | A four-slot control cannot hold nine order statuses. | §4.2 filter bar + `Popover` |

**Kept, because they were right and are not iOS-specific:** the token layer and
its enforcement script; Radix for behaviour only; logical properties throughout;
self-hosted IBM Plex Sans with the Arabic face on the same family name; the
five-state contract; skeletons measured against real row heights; tabular
numerics; `prefers-reduced-motion`; safe-area insets.

---

## 1. Tokens

Every value below lives in `styles/tokens.css` and nowhere else. A component
that wants a colour, a size or a duration names a token. `scripts/check-design.sh`
fails the build on a literal — see §8.

### 1.1 Colour — light (the reference theme)

Contrast ratios are measured, not estimated. `fg`/`muted`/`subtle` and every
semantic `-fg` clear 4.5:1 against all four surfaces.

```
--color-canvas          #f6f7f9   the app ground; the page sits on it
--color-surface         #ffffff   cards, tables, modals, popovers
--color-surface-2       #f1f3f6   table headers, inputs, inset panels
--color-surface-3       #e6e9ee   hover fill, pressed, selected row

--color-fg              #191d23   primary text            16.92 : 1 on surface
--color-muted           #59616e   secondary text, labels   6.25 : 1
--color-subtle          #686f7c   meta, placeholder, icons 5.06 : 1

--color-border          #e2e5ea   card edges, row rules — decorative
--color-border-strong   #c9ced7   section dividers, table header rule
--color-border-control  #868f9e   inputs, checkboxes, outline buttons  3.26 : 1

--color-accent          #0b62d6   links, focus ring, selection, active nav   5.63 : 1
--color-success-fg      #12703a   6.17 : 1        --color-success-bg   #e8f5ed
--color-warning-fg      #8a5300   6.33 : 1        --color-warning-bg   #fdf2e3
--color-danger-fg       #b3261e   6.54 : 1        --color-danger-bg    #fdecea
--color-info-fg         #2c4fa3   7.62 : 1        --color-info-bg      #eaeffa
--color-neutral-fg      #59616e                   --color-neutral-bg   #f1f3f6

--color-scrim           rgb(16 24 40 / 0.48)
--color-selection       rgb(11 98 214 / 0.16)
```

### 1.2 Colour — dark (derived)

Derived from light, then re-measured. It is not an inversion: surfaces step
**up** in lightness with elevation, semantics get lighter and less saturated,
and the ground is near-black but never pure `#000`.

```
--color-canvas          #0b0d10
--color-surface         #14171b
--color-surface-2       #1b1f25
--color-surface-3       #252a31

--color-fg              #e9ebee   15.05 : 1 on surface
--color-muted           #a0a8b4    7.49 : 1
--color-subtle          #8b93a1    5.35 : 1 on surface-2

--color-border          #272c33
--color-border-strong   #3a414a
--color-border-control  #6b7482    3.81 : 1

--color-accent          #6ba5ff    7.23 : 1
--color-success-fg      #4ec97e    --color-success-bg   #102a1c
--color-warning-fg      #e0a458    --color-warning-bg   #2e2113
--color-danger-fg       #ff8a80    --color-danger-bg    #33191a
--color-info-fg         #8fa8ee    --color-info-bg      #1a2135
--color-neutral-fg      #a0a8b4    --color-neutral-bg   #1b1f25

--color-scrim           rgb(0 0 0 / 0.64)
--color-selection       rgb(107 165 255 / 0.22)
```

**Three theme states, not two** — this rule survives from the old system and is
still correct. Every token gets a value on bare `:root`; dark is redefined under
both `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
and `:root[data-theme="dark"]`. A colour defined only inside a media query
vanishes the moment someone picks the other theme by hand.

**Colour never carries meaning alone.** Every status shows an icon or a word
beside its colour. Roughly 7% of male users cannot separate red from green, and
a warehouse phone in daylight flattens both.

### 1.3 Type

IBM Plex Sans stays — self-hosted, variable Latin face plus two static Arabic
weights routed by `unicode-range`. It is a professional grotesque and switching
fonts would buy nothing.

Body drops from 17px to **15px**. The panel is read on a monitor, and 17px in a
table cell is a table that holds four columns.

```
--text-display      28 / 34   600   page title, xl and up
--text-title        22 / 28   600   page title
--text-heading      18 / 24   600   card and section headers
--text-subheading   15 / 22   600   sub-sections, emphasised body
--text-body         15 / 22   400   default
--text-compact      14 / 20   400   table cells, dense panels
--text-label        13 / 18   500   form labels, meta, help text
--text-caption      12 / 16   500   timestamps, secondary meta
--text-overline     11 / 16   600   table column headers — uppercase, +0.06em
```

- Nothing below 12px, and 12px carries meta only — never a value a person acts on.
- Weight does hierarchy before size does. Two sizes and two weights beat four sizes.
- `--text-overline` is the **only** uppercase in the panel.
- Every numeric column, every amount, every ID: `[data-numeric]` → `tabular-nums`.
  A right-aligned price column with proportional figures is the loudest tell of
  an interface nobody tuned.

Arabic keeps its `106.25%` bump — Plex Sans Arabic's x-height sits lower and at
matched px it reads smaller. The 700 steps still map onto 600 in RTL because the
Arabic face has no 700.

### 1.4 Space

4px base, unchanged (`--spacing: 0.25rem`). Use 4 · 6 · 8 · 12 · 16 · 20 · 24 ·
32 · 40 · 48 · 64. Nothing between, no arbitrary values.

Density targets: table row 48px, compact table row 40px, form field 36px on
pointer / 44px on touch, card padding 20px (16px below `sm`).

### 1.5 Radius

```
--radius-sm    4px    checkbox, radio, swatch, skeleton block
--radius-md    6px    button, input, select, badge, menu item
--radius-lg    8px    card, table container, modal, popover, drawer
--radius-xl   12px    the full-screen overlay's top corners below sm
--radius-full        avatar, dot, pill
```

### 1.6 Border and elevation

**This inverts the old rule.** Elevation is no longer a surface step. Structure
comes from a 1px border; a shadow marks the small number of things that genuinely
float.

```
--shadow-xs   0 1px 2px rgb(16 24 40 / 0.04)              cards (with a border)
--shadow-sm   0 2px 4px rgb(16 24 40 / 0.06),
              0 1px 2px rgb(16 24 40 / 0.04)              popover, menu, tooltip
--shadow-md   0 12px 32px rgb(16 24 40 / 0.12),
              0 2px 8px  rgb(16 24 40 / 0.06)             modal, drawer
```

In dark, shadows are near-useless against a near-black ground — dark redefines
all three to a stronger black and leans on `--color-border` plus the surface step
to do the work.

Rules:
- A card is `bg-surface` + `border` + `--radius-lg` + `--shadow-xs`. Not a bare
  surface step, and not a shadow with no border.
- Nested cards are forbidden. A card inside a card becomes a bordered section
  with a heading.
- No shadow on a button, an input, a badge, a table row or a nav item, ever.
- Only the three tokens above. `shadow-[...]` and Tailwind's default shadow scale
  both fail the build.

### 1.7 Motion

```
--dur-instant   80ms   hover, focus ring
--dur-fast     120ms   toggles, badge changes, row selection
--dur-base     180ms   overlays in, popovers, tabs
--dur-slow     240ms   drawer, full-screen overlay

--ease-out      cubic-bezier(0.16, 1, 0.3, 1)     entrances
--ease-standard cubic-bezier(0.4, 0, 0.2, 1)      state changes
```

Exit is always faster than entry — use `--dur-fast` to dismiss what entered at
`--dur-base`. `--ease-ios` is deleted.

### 1.8 Hairlines

`--hairline` is retired. Borders are 1px at every density. A 0.5px rule is a
phone convention that renders inconsistently on the monitors this panel is
actually used on.

---

## 2. Layout and the shell

### 2.1 Breakpoints — the floor is 340px

```
base    340 – 639     phone. One column. Drawer navigation.
sm      640 – 1023    large phone / small tablet. One column, wider gutters.
md      768 – 1023    (within sm's shell) tables switch on.
lg     1024 – 1279    persistent sidebar. Two-column detail screens.
xl     1280 +         wider gutters, side-by-side analytics, 3-up cards.
```

**340px is a hard floor, and it is tested, not assumed.** Every screen must be
checked at 340 · 375 · 768 · 1024 · 1440. At 340:

- No horizontal page scroll. Ever. A table that must scroll does so inside its
  own `overflow-x: auto` container — the body never does.
- No fixed pixel width anywhere in a layout. `min-inline-size: 0` on every flex
  and grid child that holds text, or long IDs and wilaya names will blow the
  column out.
- Gutter is 16px. Card padding is 16px.
- Two side-by-side buttons do not fit with labels. Action rows stack below `sm`,
  full width, primary first in DOM order.
- Long unbroken strings (order refs, SKUs, emails) get `break-words` or truncate
  with the full value reachable — never clipped with no way to read it.

### 2.2 The shell

One shell component, three presentations. Same tree at every size — not a second
navigation model for phones.

**`lg` and up — persistent sidebar**

```
┌──────────┬───────────────────────────────────────┐
│ Ecom     │ Orders  ›  #10482          ⌘K    ◐ ▾ │  56px top bar
│          ├───────────────────────────────────────┤
│ COMMERCE │                                       │
│  Orders ▸│   content, full width                 │
│  Customers                                       │
│  Coupons │                                       │
│ CATALOG  │                                       │
│  Products│                                       │
│  Inventory                                       │
│  Media   │                                       │
│ ADMIN    │                                       │
│  Users   │                                       │
│  Audit   │                                       │
├──────────┤                                       │
│ ◔ Ferhat │                                       │
└──────────┴───────────────────────────────────────┘
  240px
```

- 240px, `bg-canvas`, `border-e border-default`. Opaque — no blur.
- Grouped by domain with `--text-overline` group headings. Groups are
  collapsible; state persists per user in `localStorage`.
- Active item: `bg-surface-3` + `--color-fg` + weight 500. **No coloured left
  bar, no tinted pill.** The fill and the weight are the whole signal.
- Hover: `bg-surface-2`, `--dur-instant`.
- A route the session lacks the capability for is not rendered. Never a
  disabled ghost.
- Footer holds the account menu, theme toggle and locale switch.

**`base` – `md` — drawer**

- Top bar, 56px, `bg-surface` + `border-b`: menu button, page title, primary
  action (icon-only below `sm`).
- Nav is a `Drawer` anchored to the inline start, holding the identical tree.
  Dismisses on navigation, on backdrop, on Escape.
- The bottom tab bar is gone. It is not coming back.

**Top bar, below `lg` only:** global search opening the command palette
(`⌘K` / `Ctrl K`), theme toggle, account menu. It scrolls away with the page; it
is not sticky. A sticky top bar plus a sticky table header eats 104px of a
768px-tall laptop viewport.

> **Amended on the orders-detail branch — there is no breadcrumb, because at
> `lg`+ there is no bar to put one in.**
>
> This section used to say "Top bar, all sizes: breadcrumb (`lg`+), …". That was
> written against a shell that does not exist: `AppShell` renders the top bar
> `lg:hidden`, because at `lg`+ the sidebar replaces it entirely. So the
> breadcrumb was specified for a piece of chrome that is absent at exactly the
> widths it was specified for, and no screen ever rendered one.
>
> The consequence was live and not theoretical: with `PageHeader`'s `back` link
> also `lg:hidden` — §2.4 said it was only needed below `lg` — a detail screen on
> a desktop had **no way back to its list** except the sidebar's own nav item,
> which discards whatever filter the person arrived with. `back` is now rendered
> at every width. See §2.4.

### 2.3 Content widths and gutters

Content is **not** uniformly capped. The cap follows the content:

| Page kind | Width | Examples |
| --- | --- | --- |
| Table / list | full, capped `1600px` | orders, products, customers, audit |
| Detail, single column | `768px` | notification |
| Detail, two column | `1fr` + `360px` aside, `lg`+ | order, product, customer |
| Form | `640px` | settings, coupon, user |
| Analytics | full, capped `1440px` | all analytics views |
| Auth | `400px` form column; split at `lg`+ | login |

Gutters: **16px** base · **24px** `sm`+ · **32px** `xl`+.

> **Amended on the login branch: a row for the one screen outside the shell.**
>
> Every width above is a **content column under a `PageHeader`, inside
> `AppShell`**. Login is neither. It has no page column, no header, no sidebar and
> no session; it is one card and the space around it, and the table had no row
> that describes that. The screen was shipping `max-w-md` — 448px — which is not
> one of the widths on this page at all, so it was a fifth measurement nobody had
> agreed to.
>
> **400px, because the card holds two fields and a button.** 640 is the form
> width and it is right for settings: fourteen fields, three of them textareas,
> read side by side. Two labelled inputs at 640 are a line of control with 500px
> of nothing in it, and a person's eye has to travel the whole width to get from
> the label to the end of the box. 400 is the width at which `login.intro` sets on
> two lines in French and the password hint on two — the measurement is the
> **text**, which is the only thing on this card that has a natural width.
>
> **The split at `lg`+ is layout, not decoration.** The form column takes 480px
> (the 400 cap plus its gutters) and a second panel fills the remainder on
> `--color-surface-2` behind a `border-inline-start`, carrying the panel's name
> and one line. Below `lg` that panel is `display: none` and the form column is
> the page, centred on `--color-canvas` — `hidden lg:flex`, which is the
> mechanism §2.2's shell already uses for its own two presentations, because a
> Server Component cannot know the viewport. No image and no gradient: §0's
> direction is restraint and `check-design.sh` fails the build on the second.
>
> Nothing else in the table moves. This row describes one screen and there is no
> second auth screen — there is no sign-up, no password reset and no
> two-factor step, because the credential is a WordPress Application Password
> minted outside this panel.

> **Amended on the audit branch: "audit entry" came off the 768px row, because
> there is no such screen and there cannot be one.**
>
> The table above named it beside "notification" as though the two were the same
> shape. They are not. `GET /notifications/{id}` exists and carries a key the list
> row does not, which is what a detail route is *for*; `GET /audit-logs/{id}` does
> not exist — `AuditLogController.php:33-41` registers one route, GET on the
> collection, and says the reason in its own docblock: *"Read-only by design.
> Audit records are append-only, so there is no POST, PATCH or DELETE here and
> there never should be."* `lib/api/allowlist.ts` carries the single rule and
> `tests/boundary.test.ts:333` asserts the single-row route refused.
>
> So the list row **is** the whole record, and the trail's ninth field — its
> `metadata`, which is the only one that says what actually changed and the only
> one with no fixed height — is shown in a `Drawer` off the list. A row in this
> table is a promise that a screen exists; this one was a promise about an
> endpoint. Nothing else in the table moves.

Two-column detail collapses to one below `lg`, aside content moving **below**
main — never above. On an order screen the reader came for the items, not for
the metadata card.

`DetailGrid` in `components/ui/Detail.tsx` is the primitive, and `main`/`aside`
are props rather than children precisely so DOM order — which is the collapse
order — cannot be got wrong by a caller who writes the summary first because it
reads first. `PageBody width="split"` caps the pair at **1152px**, which is
derived rather than chosen: 768 (the single-column detail width above) + 24
(the gutter) + 360 (the aside). The main column at its widest is exactly as wide
as it would be if the aside were not there.

### 2.4 The page header

Every screen **inside the shell** opens with the same block. No collapsing, no
scroll observer, no animation.

> **Amended on the login branch: "every screen" was one screen too many.**
>
> `/login` ships no `PageHeader`, and it is a deviation recorded rather than an
> oversight. This block is a title, an optional subtitle and actions laid over a
> **page column** — and login has no page column, no actions, and no list or
> record to name. Its heading is the card's, at `--text-heading`, which is where
> the only object on the page already puts one; a second title above it would be
> a page header for a page that is one card. §2.3's Auth row carries the layout.
> DECISIONS.md §21 carries the decision.

```
Orders                                    [ Export ]  [ + New order ]
248 orders · 12 pending
────────────────────────────────────────────────────────────────────
```

- Title `--text-title` (`--text-display` at `xl`).
- Optional one-line subtitle or count in `--text-muted`, `--text-label`.
- Actions inline-end, at most one primary. Below `sm` they move to their own
  row beneath the title, laid out with `flex-wrap` rather than stacked: a
  `flex-col` container stretches its children, which pairs a square icon button
  with a full-width labelled one and costs 90px of vertical space above the data.
  Stack only when every action carries a label and the row genuinely overflows.
- A `border-b border-default` closes the block on list pages; detail pages omit
  it and let the first card do the separating.
- **A single back link sits above the title, at every width.** Amended on the
  orders-detail branch; this used to read "Breadcrumb lives in the top bar at
  `lg`+, not here. Below `lg`, a single back link sits above the title." The
  breadcrumb half of that was written for a top bar that `AppShell` renders
  `lg:hidden` — see §2.2 — so at `lg`+ neither the breadcrumb nor the back link
  existed and a detail screen had no way back to its list.
- **On a detail screen the primary action lives here, never in the aside.**
  Below `lg` the aside collapses beneath a body whose length is the record's —
  a three-item order and a thirty-item order put the same button at two very
  different scroll offsets — and the panel's most-used control cannot sit at the
  bottom of a page whose height is data-dependent. The aside carries status
  *badges* and dates, which are display, not action.

---

## 3. Component contracts

Everything in this section is a **reusable primitive in `components/`**. A page
that hand-rolls one of these is a page that will drift. If a screen needs a
variant that does not exist, extend the primitive — do not fork it locally.

### 3.1 Overlays

Five, each with one job. All are built on Radix for behaviour (focus trap,
Escape, scroll lock, ARIA wiring, dismiss) and are ours for every visual
property. The old `Sheet` and `ActionSheet` are deleted.

**`<Modal>`** — a task that must be finished or abandoned.

- Sizes `sm` 400 · `md` 560 · `lg` 720 · `xl` 960, all `max-inline-size: calc(100vw - 32px)`.
- Centred, `--radius-lg`, `--shadow-md`, `bg-surface`, over `--color-scrim`.
- Structure: header (title `--text-heading`, optional description, close button)
  / scrollable body / footer with actions inline-end, cancel first.
- **Below `sm` it goes full screen** — `inset: 0`, radius 0, header pinned top,
  footer pinned bottom above the safe inset, body scrolls between. This is the
  340px answer: a centred dialog at that width is a dialog with 8px of margin.
- Enter `--dur-base --ease-out` (opacity + `translateY(8px)`), exit `--dur-fast`.
- Never nested. A modal that needs a second modal is a modal that needs steps.

**`<Drawer>`** — context beside the page: filters, a record preview, a create
form long enough to need room.

- Anchored `inline-end` by default (`inline-start` for navigation only).
- Widths `sm` 400 · `md` 520 · `lg` 640. Full screen below `sm`.
- Same header/body/footer contract as `Modal`.
- Enter `--dur-slow --ease-out` on `translateX`, exit `--dur-base`.

**`<Popover>`** — anchored, non-modal, dismissible by clicking away. Column
pickers, date ranges, filter groups, help.

- `bg-surface`, `border`, `--radius-lg`, `--shadow-sm`, 12px padding.
- Never holds a form that can fail validation — that is a `Modal`.
- Below `sm`, a `Popover` that would exceed 90vw renders as a `Modal` instead.
  One prop on the primitive, not a decision each caller re-makes.

**`<Menu>`** — a list of actions from a trigger. Replaces `ActionSheet`.

- Items 32px, 13px, optional leading icon and trailing shortcut.
- Destructive items use `--color-danger-fg`, sit last, and are separated by a rule.
- Anchored at every width, with collision padding keeping it on screen at 340px.
  Items grow to 44px on a coarse pointer.

  An earlier draft of this rule said the Menu should become a bottom-anchored
  full-width sheet below `sm`. It does not, deliberately: Radix positions menu
  content with a popper `transform`, and overriding that to a fixed bottom sheet
  means `!important` on every axis, which disables collision detection and flips
  the menu off screen when it opens near a viewport edge. Anchoring is also more
  honest — it says which control the menu came from.

**`<ConfirmDialog>`** — built on `Modal`, the only way to confirm a destructive
action.

- Required props: `title`, `body`, `confirmLabel`, `tone`.
- `confirmLabel` names the act — "Delete product", never "OK".
- Irreversible acts require typing the record's identifier to enable confirm.

  **Amended on the shipping branch: only where the record *has* an identifier a
  person would recognise.** The rule was written for a product, an order and a
  coupon, each of which has one — a SKU, a number, a code — that somebody could
  read off the screen and type back. A shipping rule has none. Its only unique
  handle is the database key, and `RulesView` deliberately never shows one:
  rendering `#164` at a shopkeeper is a primary key pretending to be a name, and
  a confirm box that demanded it typed would be asking a person to copy a number
  the panel had just invented a reason to display.

  So the guard becomes: **name the record in human terms in the dialog body, and
  require typing only when there is a real identifier to type.** A rule is named
  by what it is — its scope, its place and its amount — which is exactly how the
  list row names it, so the dialog and the row agree. The tone stays `danger` and
  Cancel still takes focus, which are the two halves that actually stop an
  accident; type-to-confirm is the third and it only works when the string is
  one the person already knows.
- Cancel is the default focus.

**`<Toast>`** — kept, restyled. Confirms something that already happened.

- Bottom inline-end at `sm`+, bottom centre below. 4s, 6s for errors.
- `bg-surface` + `border` + `--shadow-sm`. Not a coloured banner.
- An error a person must act on is not a toast. It is inline, or a `Modal`.

**`<Tooltip>`** — pointer only, 200ms delay, never the sole carrier of
information, never on a touch target.

### 3.2 Data display

**`<DataTable>`** — `md` (768px) and up.

- Wrapped in a card: `bg-surface`, `border`, `--radius-lg`, `--shadow-xs`,
  `overflow: hidden`.
- Header row: `bg-surface-2`, `--text-overline`, `--color-muted`,
  `border-b border-strong`, sticky within the table's scroll container.
- Rows 48px, `border-b border-default`, last row's border dropped. Hover
  `bg-surface-2` at `--dur-instant`. Selected `bg-surface-3`.
- Alignment: text starts, numbers end with `[data-numeric]`, status and actions
  end. Column alignment never changes between header and body.
- Optional leading checkbox column for bulk actions. When any row is selected,
  an action bar showing the count and the available bulk operations appears
  **above** the column header, inside the card. It does not replace the header:
  the column labels are what someone is reading while they decide what to tick,
  and taking them away costs more than the one-time 44px shift the bar causes.
- **A row that opens something needs a focusable opener, and the table renders
  it.** `onRowClick` hangs off the `<tr>`; a `<tr>` is not focusable, so on its
  own it is a mouse-only row at `md`+ — invisible below `md`, where `RecordList`
  draws its own overlay button. Pass `rowOpenerId` and the identifying cell's
  content is wrapped in a real `<button>` with a stable DOM id, which is both the
  keyboard path and the target an overlay's `returnFocusTo` names. Omit it only
  when that cell is already a link and following it *is* what clicking the row
  does — a button around an anchor is nested interactive content. Neither the
  selection checkbox nor the row-actions `Menu` counts: one selects, the other is
  a menu. In development the table checks the first row and says so if there is
  no opener. See DECISIONS.md §10.
- Row actions: one `Menu` in a trailing column, 40px wide. Not four icon buttons.
- Sort: the header cell is the button, with `aria-sort` and a chevron. Sorted
  column's header text goes `--color-fg`.
- More columns than width: the container scrolls inline and the first column
  is sticky. The page never scrolls.

**`<RecordList>`** — below `md`. The same records, restructured — not a table
squeezed, and not the old grouped list.

```
┌────────────────────────────────────┐
│ #10482              ● Pending      │  identifier + status, --text-subheading
│ A. Benali · Alger                  │  --text-compact --color-muted
│ 4 200,00 DA          22 Aug 14:30  │  --text-label, numerics tabular
└────────────────────────────────────┘
```

- Each record: `bg-surface`, `border`, `--radius-lg`, 12px gap between records.
- Three lines maximum. Choose the three fields that let someone identify and
  triage the record; everything else is on the detail screen.
- Whole card navigates. A trailing `Menu` button stops propagation.
- Minimum 44px tap target on every interactive element.

`DataTable` and `RecordList` take **the same props** and are chosen by one
responsive wrapper. A page defines its columns once.

**`<StatGroup>` / `<Stat>`** — the metric row on dashboards and analytics.

- Label `--text-label --color-muted`, value `--text-display` tabular, and a third
  line under the label carrying the figure's **scope** — see the amendment below.
- 1-up at base, 2-up at `sm`, 4-up at `lg`. A group's lead figure may span two
  columns, which is what makes seven cards two full rows rather than two rows
  with a hole in the second.
- No sparkline inside a stat unless it has an axis or a labelled range. A line
  with no scale is decoration.
- **`href` is optional.** A figure whose destination this reader is refused on,
  or which has no honest destination at all, renders as a plain card with the
  chevron dropped. Never a dimmed link, never a disabled one — §3.3's rule that a
  control which cannot act is not rendered, reaching a dashboard card.

> **Amended on the dashboard branch: the delta slot holds a scope, because this
> API publishes no comparison period.**
>
> This used to specify label / value / **delta**, the delta being "+12 % vs last
> month" in `--color-success-fg` or `--color-danger-fg` with an arrow. Measured
> across all seven analytics reports: there is no `previous`, no `change`, no
> `history` and no series anywhere in the payloads. A delta rendered here would
> be a number the panel invented, which is the one thing this run's whole ledger
> is written to prevent.
>
> The slot is not wasted, and on this data it earns more than a delta would. It
> takes the **scope** — `DataRow.hint`'s job, added on the payments branch — and
> it is required on any figure standing beside a figure it does not divide into.
> The dashboard alone has three such pairs: `net` (booked) against `collected`
> (taken); `orders_placed` 901 against `completed` 56 and `counted_as_revenue`
> 323; `customers.customers` 9 — *accounts that ordered in this window* — against
> 209 guest orders. That is DECISIONS.md §5's lesson and §9's arriving a third
> time, and the answer each time has been the same: never two unlabelled figures
> at one size on one line.
>
> If a comparison period is ever published, a delta belongs in a **fourth** line
> rather than back in this one. The scope answers *what is this*, a delta answers
> *how is it moving*, and a figure that needs the first does not stop needing it.

**`<MediaGrid>`** — when the identifying cell *is* a picture.

> **Added on the media branch, because §3.2 had no shape for this and the screen
> that needed one was about to hand-roll it.**
>
> Everything above is rows of fields, and the rule that a page must not fork a
> primitive only helps if the primitive exists. The media library's record is an
> image: a 44px thumbnail beside a generated filename is a worse way to find one
> than four columns of images, so the table is not squeezed, it is **replaced**.
> That is the same trade `RecordList` makes below `md`, taken to its end.
>
> - A tile is a real `<button>` carrying `rowOpenerId`'s id — the keyboard path,
>   and the target an overlay's `returnFocusTo` names. A `<li>` is no more
>   focusable than a `<tr>`.
> - **Image plus one line of text**, truncated, the full value reachable — from
>   the drawer the tile opens, never from a `title` attribute alone.
> - A placeholder sits *behind* the picture rather than replacing it on error. A
>   file not fetched yet and a file whose bytes have gone are indistinguishable
>   before `onerror` and unrecoverable after it, so both read as "no picture"
>   instead of as a torn box.
> - The columns are a **named variant**, not a viewport query: Tailwind's
>   breakpoints are the viewport's, and the same grid renders inside a 520px
>   `Drawer` as the image picker. Six tiles across a drawer at a 1440 viewport is
>   78px each.
> - **The absence of a table is a decision and is recorded as one.** The record's
>   fields live in the peek, because nothing here is a column anybody would scan.
>
> The pager is the primitive's, and it borrows `ui.table`'s three strings rather
> than minting identical ones: it is the same control doing the same job, `Ltr`
> wrap included — see the note on `TableFooter`.

**Charts** — one bar mark, one hue, value printed as text on every row. This rule
survives from the old system and is still right: five semantic colours reserved
for status cannot also be a categorical palette, and inventing more would put
literals in the repo. Identity comes from the label, never from the colour.

### 3.3 Buttons

```
primary      bg-fg / text-surface          one per view
secondary    bg-surface / border-control   the default choice
ghost        transparent, hover bg-surface-2
destructive  bg-danger-fg / text on it     always behind ConfirmDialog
link         accent, underline on hover
```

- **Primary is ink, not blue.** Blue is for links, focus and selection. A panel
  where every primary button is accent-coloured is a panel with no hierarchy.
- Sizes: `sm` 28px · `md` 36px (default) · `lg` 44px. Touch contexts use `lg`.
- `--radius-md`, `--text-compact`, weight 500, 12px inline padding (16px at `lg`).
- Loading: a spinner replaces the leading icon, the label stays, the width is
  held. Never a button that changes size mid-click.
- Disabled: `opacity: 0.5` plus `cursor: not-allowed`, and a `Tooltip` or help
  text saying why. A disabled control with no reason is a dead end.
- Icon-only buttons always carry `aria-label`.

### 3.4 Forms

- Label above the field, `--text-label`, `--color-fg`. Always visible.
  **A placeholder is never a label.**
- Field: 36px pointer / 44px touch, `bg-surface`, `border-control`,
  `--radius-md`, `--text-body`.
- **A single-select is drawn, not native.** `components/ui/Listbox.tsx` is the
  primitive; `Form.tsx`'s `Select` is that primitive in the field frame, and
  `TableFooter`'s rows-per-page picker is the same primitive at `sm`.

  > **Corrected in the build, and it reverses what this section used to say.**
  >
  > `Select` was a real `<select>` for the whole redesign run, and the case for
  > it was recorded in its own docblock: a native select is the one control a
  > phone renders as a full-screen wheel with the platform's own search, it needs
  > no portal and no collision detection, and at the 340px floor it cannot open
  > off the edge of the screen. Every one of those is still true.
  >
  > What the argument left out is that **a `<select>`'s open list is drawn by the
  > operating system and cannot be styled on any engine.** `appearance: none`
  > reaches the closed control and stops there. So §1's surface tokens, §1.6's
  > 1px line, `--radius-lg`, the focus ring, the dark theme and the Plex face all
  > ended at the moment somebody opened a picker — the panel had two visual
  > systems, and the second one appeared precisely when a choice was being made.
  > `<option>` carries no second line either, so a picker wanting a SKU under a
  > name had to drop it.
  >
  > **What the reversal costs, named rather than buried:** on a phone it gives up
  > the platform wheel. `.ui-listbox` buys that back by taking its maximum height
  > from Radix's `--radix-select-content-available-height` — the live distance to
  > the edge of the viewport — so the drawn list can be scrolled but can never be
  > taller than the screen, which is the one guarantee the native control gave
  > for free. Its options are 44px on a coarse pointer, which §5 asks for and an
  > `<option>` never honoured.
  >
  > Radix supplies behaviour only, as it does for the five overlays in §3.1.
  > One detail is worth knowing before writing a caller: **Radix reserves the
  > empty string** for "nothing is selected", and sixteen screens here offer
  > `{ value: "", label: "Toutes" }` as the cleared state of a filter. `Listbox`
  > maps `""` to a private sentinel and back, so the empty case stays a real,
  > choosable value — the same argument `ChoiceGroup` makes for why "all" has to
  > be a value rather than an absence.
- Focus: `border-color: accent` + a 3px `--color-selection` ring. The global
  `:focus-visible` outline stays as the fallback for everything else.
- Help text below, `--text-label --color-muted`. Written before the error, not
  as a consolation after it.
- Error: field border `danger-fg`, message below with an alert icon,
  `--text-label --color-danger-fg`, `aria-describedby` wired, `aria-invalid` set.
- Validation on blur, then on every change once a field has errored. Never on
  first keystroke.

  **The layer owns the timing; the screen owns the rule.** `components/ui/Form.tsx`
  takes a `validate` predicate per field and decides when its verdict may appear —
  because the rule above is three pieces of state per field, which is exactly the
  amount of bookkeeping a screen author gets right on the first field and drops on
  the ninth. Nothing in the panel implemented it while every screen owned both
  halves.

  **A control with no half-entered state latches on change, not on blur.** The
  rule is written for a keystroke, and "never on first keystroke" is protecting a
  value that is not finished being typed. A `<select>` has no such state — a
  selection is a complete act — so holding its refusal until the person tabs away
  only delays it. A date input is the exception that proves it: it looks discrete,
  but a half-entered date reports an **empty** value rather than a partial one, so
  latching on change would let a "required" rule fire between the year and the
  month. Dates wait for the blur.
- A form that failed submission shows an error summary at the top listing each
  failure as a link to its field, focus moved to the summary.

  A failure whose field is **not on screen** is listed as text rather than as a
  link. A 400 names every bad field including ones the form does not render, and
  an orphan still has to be readable — but there is nowhere to send the person, and
  a link that goes nowhere is worse than a line that does not claim to.
  `ErrorSummary` is the primitive.
- Required is marked on the label. Optional fields are marked "(optional)" when
  most of the form is required — pick one convention per form and hold it.
- Grouped in bordered sections with an `--text-heading` and an optional
  description. Sections stack at 24px.

  **Inside an overlay the section heading drops to `--text-subheading`.**
  `OverlayFrame` gives a `Modal`'s and a `Drawer`'s own title `--text-heading`,
  so a section inside one renders its heading at exactly the size and weight of
  the title above it and flattens the hierarchy the section exists to create.
  Found on the products filter drawer, which stacks seven of them under one
  title. `components/ui/Form.tsx`'s `Section` is the primitive and carries the
  same note.
- Actions pin to the bottom of the form in a bordered footer, primary inline-end.
  Long forms get a sticky footer that appears only when the form is dirty.

  **`position: sticky`, and the word is load-bearing.** The retired iOS `.save-bar`
  was `fixed`, so it had to know the tab bar's height, the safe-area inset and the
  sidebar's width — three numbers in `globals.css` that the redesigned shell
  invalidates. `SaveBar` in `components/ui/Form.tsx` sits inside the form's own
  column and knows none of them: it rests at the foot of a short form and pins to
  the viewport while a long one scrolls. `data-testid="save-bar"` is the handle.

  > **Amended on the marketing branch: a form built as steps saves per step and
  > ships no `SaveBar` at all.**
  >
  > The rule above says "long forms get a sticky footer that appears only when the
  > form is dirty", and it was written about a long form — a coupon, a product, a
  > page: one screen of independent fields, edited in any order, saved once at the
  > end, and every save reversible by saving again. A **multi-step** form is a
  > different object and the difference is not its length. Each forward move is
  > itself the save, so there is no accumulated dirty state for a bar to report,
  > and a bar that appeared anyway would offer a second, competing way to commit
  > the same edit.
  >
  > The campaign composer is the case that forced it and the argument is specific
  > rather than stylistic. Its last step is **irreversible** — the send freezes an
  > audience and mail leaves the building — and its third step is a *server render*
  > of the saved campaign, which only exists because the second step already
  > PATCHed. Collapse it into one long form with a sticky bar and the preview
  > becomes a render of the client's draft against an act that cannot be undone.
  > `lib/campaigns.ts` carries the measurement; DECISIONS.md §15 carries the
  > decision.
  >
  > So: **one screen of fields → `SaveBar` when dirty. A sequence of steps →
  > save on advance, and `StepIndicator`.** Both live in
  > `components/ui/Form.tsx`, beside each other, so the choice is made once and at
  > the import. A screen that ships both is a screen that has not decided which it
  > is.
  >
  > What a stepped form still owes: every step's refusal binds to its own control
  > through `ErrorSummary` exactly as a long form's does, a failed advance leaves
  > the person **on the step that failed**, and backwards is always free — a step
  > already reached is one press away, at the keyboard as well as the pointer.

### 3.5 Status and badges

`<Badge tone size>` where tone is `neutral | info | success | warning | danger`.

- `bg-{tone}-bg` + `text-{tone}-fg`, `--radius-md`, 11px/500, 6px inline padding,
  20px tall. The paired tokens are what makes this pass contrast — never tint a
  badge by mixing the semantic hue into its own text colour.

  Measured, `-fg` on its own `-bg`, all ten pairs:

  | | success | warning | danger | info | neutral |
  | --- | --- | --- | --- | --- | --- |
  | light | 5.50 | 5.72 | 5.72 | 6.62 | 5.62 |
  | dark | 7.28 | 7.16 | 7.11 | 6.86 | 6.90 |

  This replaces a live accessibility defect. The old `.tonal` tinted the badge
  text with the same hue as its wash, and measured on `#ffffff` it fails on four
  of five tones: success **1.98**, warning **1.96**, danger **2.95**, accent
  **3.34**, info 4.64. Every status badge in the panel is currently unreadable
  to the standard it claims to meet.
- Always carries a word. A `<Dot>` variant exists for rows too dense for a badge,
  and it is always accompanied by the status text in the same cell.
- **No decorative coloured bars.** Not on the leading edge of a row, not on a
  card, not anywhere. `check-design.sh` fails on `border-{l,r,s,e}-{2,4,8}`.

  > **Amended on the analytics branch: the word "decorative" was always meant and
  > was never written, and it read as a contradiction.**
  >
  > This line and §8's checklist both said "no coloured bar of any kind", and §3.2
  > has specified a **bar chart** since the redesign began — one mark, one hue,
  > the value printed as text on every row. A careful reader building the six
  > analytics reports meets both rules on the same page and has to guess which
  > wins.
  >
  > The enforcement settles it and always did: `check-design.sh` fails on
  > `border-{l,r,s,e}-{2,4,8}` — a **border**, on the leading edge of a row or a
  > card, standing in for a status the row should have spelled out in a word. The
  > two objects are not the same thing. A decorative accent bar encodes meaning in
  > a colour and nowhere else, which is what makes it an accessibility failure; a
  > data mark's *length is the datum*, its value is printed as text on the same
  > row, and its identity comes from the label beside it. Removing the second
  > would not remove a colour from the panel, it would remove the chart.
  >
  > So: no coloured bar **as decoration or as a status marker**. The bar chart
  > `components/ui/Bar.tsx` draws is not one, and it is ink rather than accent for
  > §3.3's reason — see the note on `.bar-fill` in `globals.css`.

### 3.6 Loading

Three mechanisms, and choosing wrongly is a defect:

1. **Skeleton** — first load of a region whose shape is known. Mirrors the real
   component's box model exactly: same paddings, same line heights, same row
   count. A skeleton of the wrong height is a layout shift with extra steps.
   Ship `<Skeleton>`, `<TableSkeleton rows cols>`, `<RecordListSkeleton>`,
   `<CardSkeleton>`, `<FormSkeleton>`, `<StatSkeleton>`.
2. **Inline spinner** — an action inside an already-rendered view. Lives on the
   control that started it.
3. **Optimistic / stale-while-revalidate** — a refetch of data already on screen.
   Keep the old data, mark it refreshing. Never replace content with a skeleton
   during a background refresh.

The skeleton is an opacity pulse on a `--color-surface-2` block — it composites,
and reduced motion collapses it to a still fill. No sweeping highlight.

Every route gets a `loading.tsx` whose skeleton matches its real first paint.

### 3.7 The five states

Every screen has five, built with it rather than after it. Kept from the old
system, restyled per §1.

1. **Loading** — §3.6.
2. **Empty** — distinguishes *nothing yet* from *nothing matching this filter*.
   The first offers the create action; the second offers to clear the filter.
   Icon in `--color-subtle`, one line, one action. No illustration.

   > **Amended on the media branch: the distinction is required wherever a
   > control can produce the second state, which is not every screen.**
   >
   > §8's checklist asks for both halves unconditionally. A second state on a
   > screen that cannot reach it is unreachable code standing in for a control
   > that does not exist, which is the same defect as a dead control wearing a
   > live one's clothes — and it is also a promise: an empty state offering to
   > clear a filter tells the reader a filter exists.
   >
   > So: a screen whose controls can empty the list ships both, and each offers
   > the right action. A screen whose controls cannot ships one and **says so in
   > its own docblock**, pointing at this sentence — the same shape §3.7's stale
   > amendment already uses two items below.
   >
   > **The example this was written about is now the counter-example, and it is
   > corrected here rather than quietly dropped.** The amendment named the media
   > library as the first screen in the run that could only ever have one half:
   > no filter, no search, no sort, and a pager bounded by the total it renders.
   > A fortnight later that screen **grew the controls**. The two parameters it
   > had recorded as unmeasured were measured against the live API — `search`
   > discriminates and `orderby=date&order=asc` sorts against a positive control
   > — so the search box shipped, the search can return nothing, and `/media`
   > ships both halves like every other list. Nothing about the rule moved; what
   > moved is which screens it exempts.
   >
   > Which is the sharper lesson of the two, and the reason the example stays on
   > the page instead of being replaced by a tidier one. **"This screen has no
   > control that can empty the list" is a fact about today's controls, not a
   > property of the screen.** It has to be re-read whenever one is added, and
   > the docblock the rule demands is what makes that re-reading possible — the
   > sentence is in the file the new control lands in. The exemption is real and
   > still in use: `components/ui/MediaPicker.tsx` is a panel with no controls of
   > its own, so it ships `empty.none` and no second half, and says so where a
   > reader adding a search box to it would see.
3. **Forbidden** — names the capability required and who to ask. Never a blank
   page, never a logout, never a disappearing toast.
4. **Error** — one line, a retry, and the API's own message only where it is
   actionable (a 409, typically).

   > **Amended on the notifications branch: the error state replaces the content
   > only when there is no content. A failed *refetch* is still a refetch.**
   >
   > This item and §8's "background refetch keeps content on screen — no skeleton
   > flash" are two rules about the same moment, and the document never said which
   > wins. Every migrated list read it the same way and branched
   > `isPending ? skeleton : isError ? <ErrorState> : …`, which is right while the
   > only way to reach `isError` is a first load that failed — and wrong the moment
   > a list **polls**. There, one dropped request thirty seconds after a good one
   > blanks a screenful of rows that are still perfectly readable, replaces them
   > with a sentence about a failure the person did not cause, and takes away the
   > pager and the filters that were the only way back to them.
   >
   > So: `isError` **and nothing on screen** is the error state, with its retry.
   > `isError` **over rows already rendered** keeps the rows and reports their age
   > through the fifth state below, which is exactly what the fifth state is for —
   > the data is now older than it looks, and that is the honest thing to say
   > about it. The manual refresh control is the retry.
   >
   > The distinction only bites on a screen that can fetch twice. A one-shot list
   > reaches `isError` with nothing on screen by construction and its behaviour is
   > unchanged, which is why nothing shipped before this needed to know the rule —
   > and also why the four shipped lists that *do* poll or refresh still blank on
   > a failed second fetch. They are not wrong against the old text; they are
   > untouched by this branch.
5. **Stale / offline** — a visible marker carrying the age of the data, and every
   write control disabled with that same reason.

   > **Amended on the customers branch: the marker is required wherever the data
   > on screen can age, which is not every screen.**
   >
   > This used to read as an unconditional fifth state, and §8's checklist still
   > asks for it on every page. That is right for anything holding a client cache
   > — every list in the panel, and any detail with a refresh control or a write
   > — because there the pixels can outlive the fetch that produced them.
   >
   > The customer detail is the first screen in the run where none of that is
   > true: it is a Server Component with no writes, nothing polling, and no
   > refresh control, so what is on screen is exactly as old as the navigation
   > that fetched it and cannot drift from it. A banner reporting that age would
   > be true and useless, and the half of the rule that does the real work —
   > "every write control disabled with that same reason" — has nothing to
   > disable. Its two paged sub-sections surface their own failure inline if the
   > network goes while somebody is paging, which is the honest signal there.
   >
   > So: a screen that can hold data older than its own last fetch shows the
   > marker. A screen that cannot says so in its own docblock, and this is the
   > sentence it points at.

   > **Extended on the dashboard branch: a third case, where the data is older
   > than the navigation and the API says by how much.**
   >
   > `/analytics/overview` sits behind a **60-second server cache** — two live
   > requests six seconds apart returned the identical `meta.generated_at`, and
   > `meta.cache_ttl` reports the window. So a Server Component with no writes and
   > no polling can still be handed figures that predate the navigation that
   > fetched them, which the amendment above did not anticipate.
   >
   > That is still not the stale state: there is nothing to disable, nothing has
   > drifted from anything, and the age is a published fact rather than a
   > suspicion. It renders as a plain **"as of"** line under the title — a
   > timestamp, not a warning colour and not a banner. The distinction is whether
   > the screen is *reporting* an age or *warning* about one.
   >
   > What it replaced on that screen was worse than a redundant banner: a
   > `StaleBanner` behind `!navigator.onLine`, which is an offline marker on a
   > page with no writes to disable and no cache to go stale.

   > **Amended on the transfer branch: the marker follows the data and the
   > disable follows the writes, and a screen can owe one without the other.**
   >
   > This item and both amendments above are written as though the two halves
   > travel together, because until now they did. The customer detail had neither
   > — no data that could age, no write to disable — and settings had both, so
   > the marker and the disabled save arrived in the same commit. Neither case
   > separates them.
   >
   > `/transfer` is the first that does. It holds **no data at all**: four fixed
   > export rows and two import cards, nothing fetched into a client cache,
   > nothing polling, no refresh control. There is no `time` for a `StaleBanner`
   > to carry, and a banner reporting the age of a constant would be a marker
   > naming a condition it has not established — the defect `reason` was added to
   > `StaleBanner` to stop. But the screen **writes**: the import is a POST, and
   > the export is a real navigation that replaces the panel with the browser's
   > own error page when it cannot answer. So the half of the rule that does the
   > real work has three controls to disable, each carrying
   > `states.offlineWrites` on its `title` exactly as settings' `SaveBar` and
   > `ProductsList`'s export link do.
   >
   > So: **the marker is owed by a screen whose pixels can outlive the fetch that
   > produced them; the disable is owed by a screen that writes.** A screen that
   > can do neither says so in its docblock, per the customers amendment. A screen
   > that does one of the two ships that half and says which — and, as with every
   > exemption on this page, "this screen holds no data" is a fact about today's
   > screen and has to be re-read the day one of these cards grows a list.

---

## 4. Motion

- Motion explains a change of state or of place. Nothing animates for delight.
- Only `transform` and `opacity` animate. Never `width`, `height`, `top`,
  `inset-*` or `background-position`.
- Hover and focus: `--dur-instant`. State: `--dur-fast`. Overlays in:
  `--dur-base`. Drawer: `--dur-slow`. Out is always one step faster than in.
- No scroll-triggered animation, no parallax, no stagger. This is a tool.
- `prefers-reduced-motion: reduce` collapses every transform to a 120ms opacity
  fade and stops every loop after one pass. The rule is global in `globals.css`
  so a new component inherits it.

---

## 5. Accessibility — the floor, not the goal

- Text 4.5:1 minimum; every token in §1 is measured and named with its ratio.
- Interactive non-text boundaries 3:1 — that is what `--color-border-control`
  exists for. `--color-border` is decorative and exempt.
- Focus is always visible. `outline: none` without a replacement is a defect.
  The global `:focus-visible` ring stays.
- Full keyboard path to every action, including row actions and bulk operations.
  Tab order follows visual order. Overlays trap focus and restore it on close.
- Targets: 44px on touch, 32px on pointer, never below 24px. A 20px icon gets a
  44px hit area from a pseudo-element, never by growing the icon.
- Every icon-only control has an `aria-label`. Decorative icons are
  `aria-hidden`. No emoji as an icon, anywhere.
- Live regions for async results: `role="status"` for success, `role="alert"`
  for errors.
- Tables use real `<table>` semantics with `<th scope>` and `aria-sort`.
- Zoom to 200% without loss of content or function. Nothing holding text is
  sized in px.
- Test with the keyboard alone before calling a screen done.

---

## 6. RTL and i18n

- **Logical properties only.** `margin-inline`, `padding-block`, `inset-inline`,
  `border-inline-end`, `text-start`. `ml-`, `left-`, `text-left` and
  `rounded-l-` all fail the build.
- Icons that point the way the reader reads flip (`chevron`, `back`, `up`/`down`
  arrows in a reorder control do **not**). Everything else stays put.
- Identifiers, phone numbers, SKUs and amounts are `Ltr`-wrapped by the caller.
  The primitive does not guess; guessing wrong is the silent bidi bug.
- User-supplied strings in chrome get `dir="auto"`.
- Every string comes from `messages/{fr,ar}.json`. No literal in a component.
- Layouts are tested in Arabic, not assumed to mirror.

---

## 7. Enforcement

`scripts/check-design.sh` is the enforcement and it changes with this document.

**Kept unchanged:** no component library · no gradients · no accent bars · no
colour literals outside `tokens.css` · no arbitrary values · logical properties
only · the file-count floor · the known-bad positive control.

**Changed:**

| Rule | Was | Becomes |
| --- | --- | --- |
| Shadows | banned outside `Sheet`/`Popover` | `shadow-xs`/`sm`/`md` allowed anywhere; `shadow-[`, and Tailwind's default scale, fail |
| Fonts | bans `sans-serif`, `Inter`, `Arial`, `system-ui` | unchanged — Plex stays |

**Added:**

| Rule | Fails on |
| --- | --- |
| no retired iOS utilities | `material-bar`, `press-row`, `\bpress\b`, `sheet-content`, `action-sheet`, `seg-thumb`, `title-collapsed`, `hairline` |
| no retired tokens | `text-large-title`, `text-title-[123]`, `text-headline`, `text-callout`, `text-subhead`, `text-footnote`, `bg-bg-grouped`, `text-label-secondary`, `text-label-tertiary`, `border-separator` |
| no emoji in source | emoji codepoint ranges in `.tsx` |
| no fixed viewport widths | `w-\[[0-9]+px\]`, `min-w-\[[0-9]{3,}` |
| no `100vh` | `h-screen`, `100vh` — `dvh` only |

Raise `FLOOR` as files are added, and keep it just under the real count.

**Migration map** — mechanical, and safe to run with `sed` across `app/` and
`components/`:

```
bg-bg-grouped         → bg-canvas
text-label            → text-fg
text-label-secondary  → text-muted
text-label-tertiary   → text-subtle
border-separator      → border-default
text-large-title      → text-display
text-title-1          → text-title
text-title-2          → text-heading
text-title-3          → text-subheading
text-headline         → text-subheading
text-callout          → text-body
text-subhead          → text-compact
text-footnote         → text-label
text-caption          → text-caption   (12px, unchanged name and size)
rounded-sm            → rounded-md     (8px → 6px: badges and inputs)
rounded-md            → rounded-md     (12px → 6px: buttons)
rounded-lg            → rounded-lg     (14px → 8px: cards)
```

`.press`, `.press-row`, `.material-bar`, `.tonal`, `.tone-*`, `.sheet-*`,
`.action-sheet`, `.seg-thumb`, `.title-collapsed`, `.hairline-*`, `.switch*`,
`.pill-row`, `.save-bar` and `.tap-44` are deleted from `globals.css`. `.tap-44`
is replaced by `.ui-tap`, which does the same job at the sizes in §5. (This
paragraph said `.tap-target` until teardown: no such class was ever written, so
the name is corrected here to the one that actually shipped.)

---

## 8. The per-page checklist

Run this on every screen before calling it done. This is the part of the
document meant to be re-read each time.

**Structure**
- [ ] `PageHeader` with title, optional count/subtitle, at most one primary action
- [ ] Content width matches the table in §2.3 — not `max-w-3xl` by habit
- [ ] No `Scaffold`, no grouped list, no bottom sheet, no `ActionSheet`, no `Segmented`
- [ ] Every overlay is one of the five primitives, not a local one

**Responsive**
- [ ] Verified at 340 · 375 · 768 · 1024 · 1440
- [ ] No horizontal page scroll at 340; tables scroll inside their own container
- [ ] `DataTable` at `md`+, `RecordList` below, both fed the same column definition
- [ ] Action rows stack below `sm`; primary is first in DOM order
- [ ] `min-inline-size: 0` on every text-holding flex/grid child

**States**
- [ ] Skeleton matches the real box model, and `loading.tsx` exists for the route
- [ ] Empty distinguishes no-data from no-results, and each offers the right action
- [ ] Forbidden names the capability
- [ ] Error offers retry; a 409's message is surfaced
- [ ] Stale marker present, writes disabled with the same reason
- [ ] Background refetch keeps content on screen — no skeleton flash

**Interaction**
- [ ] Every destructive action goes through `ConfirmDialog` with a naming label
- [ ] Row actions are one `Menu`, not a row of icon buttons
- [ ] Bulk selection bar appears above the header, column labels stay visible
- [ ] Loading buttons hold their width
- [ ] Disabled controls say why

**Type and colour**
- [ ] No colour literal, no arbitrary value — `npm run test:design` passes
- [ ] Numerics carry `[data-numeric]`
- [ ] Status has a word beside its colour
- [ ] No **decorative** coloured bar — see §3.5's amendment. A §3.2 bar chart is
      a data mark, not one of these, and is the only exception
- [ ] Primary button is ink; accent appears only on links, focus and selection

**Accessibility**
- [ ] Keyboard-only pass completed, including row and bulk actions
- [ ] Focus visible everywhere; overlays trap and restore focus
- [ ] Icon-only controls have `aria-label`; decorative icons are `aria-hidden`
- [ ] Real table semantics with `scope` and `aria-sort`
- [ ] 200% zoom holds

**Both themes, both directions**
- [ ] Light checked, dark checked — dark is derived but still verified per screen
- [ ] Arabic checked; no physical property crept in; identifiers `Ltr`-wrapped
- [ ] `prefers-reduced-motion` honoured
