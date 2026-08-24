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
| Detail, single column | `768px` | notification, audit entry |
| Detail, two column | `1fr` + `360px` aside, `lg`+ | order, product, customer |
| Form | `640px` | settings, coupon, user |
| Analytics | full, capped `1440px` | all analytics views |

Gutters: **16px** base · **24px** `sm`+ · **32px** `xl`+.

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

Every screen opens with the same block. No collapsing, no scroll observer, no
animation.

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

- Label `--text-label --color-muted`, value `--text-display` tabular, delta
  `--text-label` in `--color-success-fg` / `--color-danger-fg` with an arrow icon.
- 1-up at base, 2-up at `sm`, 4-up at `lg`.
- No sparkline inside a stat unless it has an axis or a labelled range. A line
  with no scale is decoration.

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
- Focus: `border-color: accent` + a 3px `--color-selection` ring. The global
  `:focus-visible` outline stays as the fallback for everything else.
- Help text below, `--text-label --color-muted`. Written before the error, not
  as a consolation after it.
- Error: field border `danger-fg`, message below with an alert icon,
  `--text-label --color-danger-fg`, `aria-describedby` wired, `aria-invalid` set.
- Validation on blur, then on every change once a field has errored. Never on
  first keystroke.
- A form that failed submission shows an error summary at the top listing each
  failure as a link to its field, focus moved to the summary.
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
- **No coloured bars.** Not on the leading edge of a row, not on a card, not
  anywhere. `check-design.sh` fails on `border-{l,r,s,e}-{2,4,8}`.

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
3. **Forbidden** — names the capability required and who to ask. Never a blank
   page, never a logout, never a disappearing toast.
4. **Error** — one line, a retry, and the API's own message only where it is
   actionable (a 409, typically).
5. **Stale / offline** — a visible marker carrying the age of the data, and every
   write control disabled with that same reason.

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
is replaced by `.tap-target`, which does the same job at the sizes in §5.

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
- [ ] No coloured bar of any kind
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
