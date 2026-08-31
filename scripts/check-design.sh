#!/usr/bin/env bash
#
# A rule nobody enforces is a preference. This is the enforcement.
#
# It carries a floor the way the backend's test-api.sh does: a grep that matches
# nothing must not report success, so the script fails if it scanned fewer files
# than it expects to exist. A rename that empties the glob would otherwise report
# a perfectly compliant codebase.
#
# Exit 0 = clean. Exit 1 = a non-negotiable was violated. Exit 2 = the script
# could not do its job, which is not the same thing and must not read as a pass.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

# Raised with each branch, and deliberately just under the real count rather than
# at it: the floor exists to catch a rename or a moved directory that empties the
# glob, not to fail on one deleted file. 47 files at the orders branch, floor 40;
# 61 at the products branch, floor 56; 77 at the inventory branch, floor 72; 101 at
# the customers branch, floor 95; 123 at the shipping branch, floor 117; 139 at the
# analytics branch, floor 133; 167 at the content branch, floor 160; 179 at the
# notifications branch, floor 172; 195 at the campaigns branch, floor 188; 223 at
# the admin branch, floor 216; 248 at the products-list redesign, floor 241; 252
# at the orders-detail redesign, floor 245; 253 at the products-detail redesign,
# floor 246; 259 at the customers redesign, floor 252; 266 at the inventory
# redesign, floor 259; 270 at the coupons redesign, floor 263; 281 at the
# dashboard redesign, floor 274; 282 at the analytics redesign, floor 275; 314 at
# the marketing redesign, floor 307; 315 at the marketing gaps, floor 308; 320 at
# the staff redesign, floor 318; 321 at the settings redesign, floor 319; 322 at
# the transfer redesign, floor 320; 323 at the export-refusal fix, floor 321; 325
# at the audit redesign, floor 323; 326 at the login redesign, floor 324.
#
# 309 at the teardown, floor 307 — and this is the **first decrease** in the
# history above, which is why it is spelled out rather than appended as another
# semicolon. Teardown deleted the retired iOS layer now that all 44 route pages
# are on `components/ui/`: 17 of the scanned files went (8 in
# components/primitives/, 7 in components/patterns/, the whole of
# app/[locale]/(panel)/more/, and inventory/RowSkeleton.tsx), taking 326 to 309.
# A floor that only ever rises would have failed this branch for doing exactly
# what it was scheduled to do — but it must still be *lowered deliberately and
# once*, to the real count minus the same margin of 2, never quietly edited down
# to whatever makes today pass.
#
# 312 at the order-entry branch, floor 310. Three files: components/ui/Listbox.tsx
# (the drawn single-select that retired the panel's last native `<select>`), and
# app/[locale]/(panel)/orders/{NewOrderDrawer,new-order}.tsx|ts.
#
# 316 at the order-edit branch, floor 314. Four files, and two of them are a
# split rather than an addition: the order **edit** form became the second caller
# of the create drawer's address block and customer picker, so both were lifted
# out of `NewOrderDrawer.tsx` into `orders/{AddressFields,CustomerPicker}.tsx`
# beside it. The other two are the form itself —
# `orders/[id]/{OrderEditDrawer.tsx,order-edit.ts}`. Raised by the same margin of
# 2 the history above keeps, and raised here rather than left to pass on the old
# number: a floor that trails the real count by six stops catching the emptied
# glob it exists for.
#
# 318 at the order-lines branch, floor 316. Two files, and one of them is a split
# of the same kind the line above records. `orders/[id]/OrderLinesDrawer.tsx` is
# the line-item editor itself — the lines, the per-line manual price and the
# delivery fee, which are the three fields `is_editable` gates and which
# therefore could not join the edit drawer. `orders/ProductPicker.tsx` is the
# search-plus-results list lifted out of `NewOrderDrawer.tsx`, whose inline copy
# it was: the editor is the second form that has to put a product on an order,
# and `AddressFields.tsx` already recorded on the previous branch what happens if
# a control like that is copied instead — "two hand-maintained copies of eleven
# controls drift by the third branch". `NewOrderDrawer` still holds the original
# and adopts this on its next touch, so the count is +2 rather than the +1 a
# finished extraction would have been. Same margin of 2.
#
# 319 at the carrier-choice branch, floor 317. One file:
# `orders/DestinationFields.tsx`, the wilaya-and-commune pair the create drawer
# needs before a delivery fee can be quoted for anywhere — step 2's admin
# sub-task 2. It is a new file rather than two more controls inside
# `NewOrderDrawer.tsx` for the reason the two lines above both record: the
# dependent commune fetch already exists in `orders/[id]/CreateParcelDrawer.tsx`,
# a second hand-maintained copy of it drifts, and the drawer it would otherwise
# be inlined into is being edited on two further sub-tasks of this same step.
# `CreateParcelDrawer` is the obvious second caller and is deliberately not
# converted here for that same concurrency reason, so this is +1 rather than the
# +1-and-a-deletion a finished extraction would have been. Same margin of 2.
#
# 320 at the carrier-choice branch's second half, floor 318. One file:
# `orders/CarrierFields.tsx`, the courier and delivery-type pickers and the
# debounced `GET /shipping/rates` lookup that fills the delivery fee — step 2's
# admin sub-tasks 1 and 3, and the pair the destination fields on the line above
# were built to feed.
#
# It is a new file rather than two more controls inside `NewOrderDrawer.tsx` for
# the reason the three lines above all record, plus one of its own. The shared
# reason: that drawer is already the panel's longest form and is being edited on
# two further sub-tasks of this same step. The new one: this file is not only
# markup — it owns a debounced query, the `RateQuote::coversDeliveryType()`
# filtering rule and the `ac_manage_shipping` fallback, and every one of those is
# a decision that needed its own argument written next to it rather than a third
# section of a docblock that is already the longest in the repository.
#
# `CreateParcelDrawer` is *again* the obvious second caller — it draws a provider
# picker and a delivery-type picker against `POST /orders/{id}/shipments` — and
# is *again* deliberately not converted, for the same concurrency reason: it
# lives in `orders/[id]/`, which another agent is editing on sub-tasks 4 and 5 of
# this step. So +1 rather than the +1-and-a-deletion. Same margin of 2.
#
# 321 at the carrier-choice branch's third half, floor 319. One file:
# `orders/[id]/ParcelFailure.tsx`, the block that says why confirmation created
# no parcel — step 2's admin sub-task 4, and the half `ParcelsSection`'s list
# structurally cannot show, because a refused parcel leaves no shipment row at
# all.
#
# It is a new file rather than a section of `ParcelsSection.tsx` for the reason
# `CarrierFields.tsx` two paragraphs above gives, and it is the same reason: this
# is not only markup. It owns the branch on `error.code` — our five codes to the
# manual parcel route, a courier's own to the destination — and the reading of a
# stored failure that may be a week old, and each of those needed its argument
# written beside it rather than folded into a card whose docblock is already
# about three other things. The pure half of both lives in `lib/shipping.ts`
# (`readFailure`, `failureRemedy`, `manualParcelOffered`) and is unit-tested
# there, which is what keeps this file to the drawing.
#
# **The three obvious second callers stayed uncalled and are still +0.**
# `CreateParcelDrawer` is *again* not converted to `DestinationFields` — the
# third branch running to say so — but `orders/[id]/OrderEditDrawer.tsx` now is
# its first outside caller, which closes the "one hand-maintained copy" risk the
# previous two entries were worrying about without moving a file. So this is +1
# for the new block alone. Same margin of 2.
#
# 324 at the product-create branch, floor 322. Three files, and the third is an
# extraction rather than an addition:
#
#   products/new-product.ts        the draft and `buildPayload`/`draftProblems`,
#                                  split from the markup the way `new-order.ts`
#                                  is — the interesting half of a create form is
#                                  which keys reach the wire, and that is a pure
#                                  function of a plain object, unit-tested in
#                                  `tests/new-product.test.ts` rather than
#                                  through eleven `fireEvent`s per case.
#   products/NewProductDrawer.tsx  the form itself, `POST /products`.
#   components/ui/MediaUpload.tsx  the upload's state and fields, lifted out of
#                                  `media/UploadModal.tsx`.
#
# **The third is the one that needed an argument, and it is `MediaPicker`'s.**
# The create form attaches a featured image, so it needs the library picker *and*
# a way to add a file that is not in it yet. §3.1 refuses nested overlays — "a
# modal that needs a second modal is a modal that needs steps" — and a `Modal`
# over a `Drawer` is that in a different vocabulary: at the 340px floor both are
# full screen, so the second erases the first. `MediaPicker` was promoted from a
# `Sheet` to a chrome-less panel on exactly this argument one branch earlier so
# `BannerDrawer` could make it a step; this is that promotion for the upload,
# and `UploadModal.tsx` is now a thin `Modal` around the same hook and fields —
# so it is +1 with a file rewritten rather than the +1-and-a-deletion a whole
# move would have been, and nothing was copied.
#
# Raised by the same margin of 2 the history above keeps.
#
# 325 at the product-create branch's second half, floor 323. One file:
# `products/[id]/ProductMedia.tsx`, the featured image and the gallery on the
# edit form — step 3's admin sub-task 5 and the edit half of sub-task 6.
#
# It is a new file rather than two more cards inside `ProductDetail.tsx`, on the
# test the last four entries all apply and which is not line count: **a block
# that is only markup stays in its screen; a block that owns decisions gets a
# file so the decisions have somewhere to be argued.** This one owns three. An
# overlay with two internal steps, which had to be argued *against* the create
# drawer beside it: `NewProductDrawer` makes the picker and the upload steps
# because §3.1 refuses a `Modal` over a `Drawer`, and `ProductDetail` is a
# **route**, so the antecedent is absent and a step would be the worse shape —
# it would take the `PageHeader` and the save bar off screen and leave the
# browser's back button meaning "leave the product". A URL cache, which exists
# because an attachment id does not carry one and resolving it would be a
# `GET /media/{id}` against the route half the staff cannot call. And the
# `ac_manage_content` fallback, which is a **live path** rather than a guard:
# `Users\UserRoles::assignable()` hands out `[ac_super_admin, ac_manager]` and a
# Manager holds `ac_manage_products` without `ac_manage_content`.
#
# The two draft keys stayed in `ProductDetail.tsx` and that is the half that had
# to: its docblock argues an explicit writable field list against a derived one,
# and every key in that list now has a control. Same margin of 2.
#
# 332 at the attributes branch, floor 330. **Seven files, the largest single
# addition since the marketing redesign**, and the number is the shape of the
# thing rather than a screen drawn twice:
#
#   attributes/{page,AttributesScreen,loading}.tsx        the list and its create
#   attributes/[id]/{page,AttributeDetail,loading}.tsx    one attribute and its terms
#   attributes/attribute-write.ts                         the bodies and the refusals
#
# **Two routes and not one**, which is the branch's overlay decision and is
# argued at length in `AttributeDetail.tsx`. In short: a term list is a paginated
# collection the API expects to be browsed (`search`, `hide_empty`, `orderby`,
# `per_page` up to 100), every row of it can raise a destructive confirm, and
# §3.1 forbids a `Modal` over a `Drawer` — the collision the product-create
# branch four entries up had to work around. `content/faqs/categories` settled
# the identical two-level CRUD the same way and states the rule: a second level
# is not a step of the first.
#
# `attribute-write.ts` is the seventh and passes the same test the last five
# entries apply: **a block that is only markup stays in its screen; a block that
# owns decisions gets a file.** It owns three. That an empty `PATCH` is a 400
# with no `details`, so the panel answers `null` and never sends one. That
# WooCommerce's refusals arrive under `details.fields.attribute`, which is not a
# field any form has — so a screen binding errors by key renders nothing for the
# three most likely ones. And the 29-**byte** slug budget, which is a rule about
# Arabic rather than about length: a French letter costs one byte and an Arabic
# letter two.
#
# Raised by the same margin of 2 the history above keeps.
#
# 336 at the variations branch, floor 334. **Four files**, all under
# `products/[id]/`, and each one passes the test the last six entries apply:
# **a block that is only markup stays in its screen; a block that owns decisions
# gets a file so the decisions have somewhere to be argued.**
#
#   products/[id]/variable-product.ts      the whole-list rule, the mapping
#                                          guard, the grid and the cap
#   products/[id]/ProductAttributes.tsx    spec or variant, and the confirm
#   products/[id]/ProductVariations.tsx    the per-row table and the fan-out
#   products/[id]/DuplicateAction.tsx      one call, two screens
#
# `variable-product.ts` is the one that had to exist. It owns the reversal of the
# deferral `ProductDetail.tsx` has carried since the products branch — editing a
# product's `attributes` was refused there because a *partial* list wipes a
# variable product's variation mapping — and the reversal is only safe because a
# partial list is unreachable: `attachedFrom()` copies every entry the product
# carries, `attributesBody()` emits every entry of the draft, and
# `tests/variable-product.test.ts` asserts the key set of the body equals the key
# set of the product for every operation the editor offers. That invariant cannot
# live inside a component, because the thing being asserted is that no code path
# produces a subset — which is a claim about a module, not about a render.
#
# It also owns `mappingLosses()` (which variations each of the three destructive
# edits would orphan, counted before the confirm), the combination grid and its
# **cap of 50** — borrowed from `OptionSet::MAX_CHOICES` rather than invented,
# because the API has no ceiling of its own and `GET /products/{id}/variations`
# is unpaginated, so the panel is the only thing between a shopkeeper and
# `OptionSet`'s 7,776 example.
#
# **Two components and not one**, which is this branch's split decision. They are
# two *writes* to two different routes with two different failure shapes: the
# attributes card PATCHes the product once and asks a destructive confirm first;
# the variations table PATCHes one row per request and treats partial failure as
# the normal outcome. One component would have held both, plus a fan-out loop,
# in a file already past 500 lines — and the reason `ProductAttributes` is not a
# section of `ProductDetail.tsx` is the same reason `ProductMedia` was not: the
# form beneath it sends a hand-written subset of writable keys on every save, and
# `attributes` must not join that list.
#
# `DuplicateAction.tsx` is the fourth and is the smallest, and it is a file
# because it is used from **two screens** — the detail's header and the products
# list's row menu. The behaviour is one hook so the two cannot drift on the day
# the 201's shape changes; a second copy inside `ProductsList` is exactly how
# they would.
#
# Raised by the same margin of 2 the history above keeps.
#
# 338 at the date-picker branch, floor 336. **Two files**, and they are the
# fourth entry in the run of reversals that began when `Listbox.tsx` retired the
# panel's last native `<select>`: this one retires the last native
# `<input type="date">`.
#
#   components/ui/DatePicker.tsx   the drawn control — Radix Popover for the
#                                  portal, the popper, collision detection and
#                                  dismissal; a typed text field, a calendar
#                                  grid and every visual property ours.
#   lib/calendar.ts                the arithmetic and the locale reading
#
# **`lib/calendar.ts` is the one that had to be its own module**, on the test the
# last seven entries all apply — a block that is only markup stays in its screen;
# a block that owns decisions gets a file. It owns four, and every one is a claim
# about `Intl` that was measured rather than assumed: that both `fr-DZ` and
# `ar-DZ` write day-month-year, so the ordering defect was never between the
# panel's two languages but between both of them and the browser's `mm/dd/yyyy`;
# that `ar-DZ`'s own separator is `‏/` — a U+200F RIGHT-TO-LEFT MARK before the
# slash — which is why the field prints the locale's *order* with an ASCII
# separator a person can actually type; that CLDR's `firstDay` for both is
# **Saturday**, not the Sunday-or-Monday the item assumed; and that every date
# here is UTC for the same reason `formatDay` is. None of those is assertable
# from inside a render, which is what `tests/calendar.test.ts` exists for.
#
# It is +2 rather than the +2-and-a-deletion a finished swap would have been:
# `DateField` stays in `components/ui/Form.tsx` and is now `DatePicker` in the
# field frame, exactly as `Select` is `Listbox` in it. All six calling screens
# swapped with no change but the deletion of the `echo` readback, which existed
# only to print the date a second time in a format the field itself could not
# use.
#
# Raised by the same margin of 2 the history above keeps.
FLOOR=336
failures=0
checks=0

red() { printf '\033[31m%s\033[0m' "$1"; }
green() { printf '\033[32m%s\033[0m' "$1"; }

# The scanned set. Part VII names app/ and components/; lib/ and i18n/ are in here
# too, because a colour literal or a physical property is no more acceptable in a
# formatter than in a component, and the wider net is what makes the floor honest.
#
# Two files are exempt from the colour rule, each by name with its reason:
#   styles/tokens.css   — the definitions themselves have to live somewhere
#   lib/theme-color.ts  — browser chrome, set through a TS metadata API that
#                         cannot read a custom property; the file records why
# Anything else naming a colour is a failure.
COLOUR_EXEMPT='lib/theme-color\.ts'

mapfile -t FILES < <(find app components lib i18n -type f \( -name '*.tsx' -o -name '*.ts' \) 2>/dev/null | sort)
mapfile -t CSS < <(find styles -type f -name '*.css' 2>/dev/null | sort)

scanned=$(( ${#FILES[@]} + ${#CSS[@]} ))

echo "check-design: ${#FILES[@]} source files, ${#CSS[@]} stylesheets"
echo

# fail <rule> <explanation> <matches>
report() {
  local rule="$1" why="$2" matches="$3"
  checks=$(( checks + 1 ))
  if [[ -n "$matches" ]]; then
    printf '  %s %s\n' "$(red FAIL)" "$rule"
    printf '        %s\n' "$why"
    while IFS= read -r line; do printf '        %s\n' "$line"; done <<< "$matches"
    failures=$(( failures + 1 ))
  else
    printf '  %s %s\n' "$(green PASS)" "$rule"
  fi
}

# A grep over the source set that never fails the script on "no match".
scan() { grep -nE "$1" "${FILES[@]}" 2>/dev/null || true; }
scan_css() { grep -nE "$1" "${CSS[@]}" 2>/dev/null || true; }

echo "the non-negotiables"

# 1 — no component library whose look is the house style of generated UI.
report "no component library" \
  "Primitives are written here; Radix is permitted for behaviour only." \
  "$(scan 'from "(@mui|antd|@chakra-ui|@mantine)|shadcn')"

# 2 — no emoji standing in for an icon. The sprite in components/primitives/Icon
# is the only icon source; an emoji renders differently on every platform and
# carries an accessible name nobody chose.
report "no emoji as icons" \
  "Use the Icon sprite. An emoji is a font glyph, not a design decision." \
  "$(grep -nP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' "${FILES[@]}" 2>/dev/null || true)"

# 3 — no gradients. A backdrop-filter blur is not a gradient and is permitted.
report "no gradients" \
  "A blur samples what is behind it; a gradient invents a colour ramp." \
  "$(scan 'bg-gradient|from-\[|\bvia-|linear-gradient|radial-gradient|conic-gradient'; scan_css 'linear-gradient|radial-gradient|conic-gradient')"

# 4 — no accent bars. A coloured leading border marking status or selection.
report "no accent bars" \
  "Status is a tonal badge, a leading dot or typographic weight — see Part III." \
  "$(scan 'border-[lrse]-[248]'; scan_css 'border-inline-start-width|border-left-width')"

# 5 — no generic fonts outside the fallback stack, which lives in tokens.css.
report "no generic fonts" \
  "IBM Plex Sans + IBM Plex Sans Arabic, self-hosted. The fallback stack is tokens.css's alone." \
  "$(scan 'sans-serif|system-ui|\bInter\b|Arial|Helvetica'; grep -nE 'sans-serif|system-ui|\bInter\b|Arial|Helvetica' styles/globals.css 2>/dev/null || true)"

echo
echo "tokens only"

# Colour literals belong in tokens.css and nowhere else.
report "no colour literals in source" \
  "Every colour is a token. A component that wants one names it in tokens.css." \
  "$(scan '#[0-9a-fA-F]{3,8}\b|\brgb\(|\boklch\(|\bhsl\(' | grep -vE "$COLOUR_EXEMPT" || true)"
printf '        (exempt by name: lib/theme-color.ts — browser chrome, see the file)\n'

report "no colour literals in css outside tokens.css" \
  "tokens.css is the only stylesheet permitted a literal." \
  "$(grep -nE '#[0-9a-fA-F]{3,8}\b|\brgb\(|\boklch\(|\bhsl\(' styles/globals.css 2>/dev/null || true)"

# Arbitrary values are the escape hatch this check exists to close.
report "no arbitrary values" \
  "An arbitrary value is a token that was not added. Add the token." \
  "$(scan '\-\[[0-9]|\-\[#|\-\[calc|\-\[var')"

# Added with the redesign: the viewport floor is 340px and 100vh is wrong on a
# phone — the URL bar makes it taller than the visible area, so a full-height
# overlay's footer sits below the fold. dvh is the unit that accounts for it.
report "no 100vh" \
  "Use dvh. 100vh is taller than the visible viewport on a mobile browser." \
  "$(scan '\bh-screen\b|100vh'; scan_css '\b100vh\b')"

echo
echo "the retired system stays retired"

# Added at the teardown branch, and only there, because this is the first branch
# on which they can pass: DESIGN.md §7 has listed both since the redesign began,
# but a rule that fails the moment it is written gets commented out rather than
# obeyed. The retired layer is gone from globals.css and tokens.css now, so these
# two are what stop it coming back one convenient utility at a time.
#
# ## Both scan a *class position*, and that is a decision rather than a weak regex
#
# This repository documents its own history in prose. `press` is an ordinary
# English word here — "one press away in the peek", "the person's own press" —
# and `hairline`, `text-subhead` and `tonal` all appear inside backticks in
# comments explaining what was retired and why. A rule that fired on those would
# be switched off within a week, which is worse than not having it. So the source
# half matches only inside a `className`/`class` attribute, where a *use* has to
# live, and the CSS half matches a selector or a custom-property definition,
# which is where a *reintroduction* has to live. A utility cannot come back
# without a rule to define it, so the CSS half is the one that closes the door.
#
# Word boundaries are load-bearing, not decoration: `text-subhead` without one
# matches `--text-subheading`, which is a live token this panel uses on twelve
# screens, and the rule would have failed on correct code the day it was added.
QUOTE="[\"\`']"
NOTQUOTE="[^\"\`']"

# The retired iOS utilities — DESIGN.md §0's table and §7's list.
RETIRED_UTIL='material-bar|press-row|press|sheet-content|sheet-overlay|action-sheet|seg-thumb|title-collapsed|hairline-[bt]|hairline|tap-44|list-row|pill-row|tonal|tone-[a-z]+'
report "no retired iOS utilities" \
  "The iOS layer is deleted. .ui-* is the live namespace — see globals.css." \
  "$(scan "class(Name)?=[{]?$QUOTE$NOTQUOTE*\b($RETIRED_UTIL)\b"; \
     scan_css "^[[:space:]]*\.($RETIRED_UTIL)\b")"

# The retired type and colour names. The first list is the Tailwind utility a
# screen would write; the second is the token definition itself, and it is
# deliberately shorter — `--color-bg-grouped` and `--color-label-tertiary` are
# still defined because they still have live consumers (the PWA theme-colour
# pairing tests/boundary.test.ts asserts, and the scrollbar thumb in globals.css
# respectively). Using them as utilities is banned; defining them is not.
RETIRED_TOKEN='text-large-title|text-title-[123]|text-headline|text-callout|text-subhead|text-footnote|bg-bg-grouped|text-label-secondary|text-label-tertiary|border-separator'
RETIRED_TOKEN_DEF='ease-ios|hairline|dur-slow|text-large-title|text-title-[123]|text-headline|text-callout|text-subhead|text-footnote|color-separator|color-label-secondary|color-fill-secondary|color-fill-tertiary'
report "no retired tokens" \
  "See DESIGN.md §7's migration map for what each retired name became." \
  "$(scan "class(Name)?=[{]?$QUOTE$NOTQUOTE*\b($RETIRED_TOKEN)\b"; \
     scan_css "^[[:space:]]*--($RETIRED_TOKEN_DEF)\b")"

echo
echo "logical properties only"

# Physical direction properties are banned, not discouraged.
report "no physical direction utilities" \
  "Use ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e." \
  "$(scan '(^|[^a-z-])(m[lr]|p[lr])-[0-9]|(^|[^a-z-])(left|right)-[0-9]|text-(left|right)\b|rounded-[lr]\b|rounded-[lr]-')"

report "no physical direction in css" \
  "Logical properties throughout: inset-inline, margin-inline, padding-block." \
  "$(scan_css '(^|[^-])(margin|padding)-(left|right)\s*:|(^|[^-])(left|right)\s*:')"

echo
echo "elevation from tokens only"

# This rule inverted with the redesign, and the inversion is deliberate.
#
# The old system said elevation was a surface step and that a shadow belonged to
# a sheet and a popover only. That is correct for iOS and wrong for a console:
# DESIGN.md §1.6 makes structure a 1px line and gives the few things that
# genuinely float a tokenised shadow. So the rule is no longer "almost nowhere",
# it is "only from the three tokens".
#
# Permitted: shadow-ui-xs / -sm / -md, and that is now the whole list. The
# `shadow-overlay` token and the Sheet/ActionSheet exemptions that went with it
# were removed at teardown: its last consumer was primitives/Sheet.tsx, both of
# those files are deleted, and a permitted-value list that names things which no
# longer exist reads as though they are still allowed to come back.
# Banned: Tailwind's own scale, which is untokenised and would drift, and any
# arbitrary shadow.
shadow_hits="$(grep -nE 'shadow-' "${FILES[@]}" 2>/dev/null \
  | grep -vE 'shadow-ui-(xs|sm|md)\b' || true)"
report "no untokenised shadows" \
  "Use shadow-ui-xs/sm/md. Tailwind's default scale and shadow-[…] both drift." \
  "$shadow_hits"

echo
echo "the floor"

# The floor. A grep that matches nothing must not report success.
checks=$(( checks + 1 ))
if (( scanned < FLOOR )); then
  printf '  %s scanned %d files, need at least %d\n' "$(red FAIL)" "$scanned" "$FLOOR"
  printf '        A rename that empties the glob would otherwise report a\n'
  printf '        perfectly compliant codebase.\n'
  failures=$(( failures + 1 ))
else
  printf '  %s scanned %d files (floor %d)\n' "$(green PASS)" "$scanned" "$FLOOR"
fi

# A positive control on the scanner itself: the patterns above must be capable of
# matching. If a deliberately bad string does not trip the colour rule, the rule
# is broken and every PASS above is meaningless.
#
# Extended at teardown to cover the two rules added on that branch, and they need
# it more than the others do: both scan a *class position* rather than the whole
# line, so a mistake in the quoting would not fail the build — it would silently
# match nothing and PASS forever, which is the exact failure mode the floor above
# exists to catch for the file globs. The probe also carries the two strings that
# must NOT match: `--text-subheading` is a live token that a boundary-less
# `text-subhead` would hit, and a comment mentioning a press is prose.
checks=$(( checks + 1 ))
probe="$(mktemp -t check-design-probe-XXXXXX.tsx)"
{
  printf 'const bad = "#ff00aa"; const worse = "ml-4 text-left";\n'
  printf 'const retired = <div className="press material-bar" />;\n'
  printf 'const stale = <p className="text-subhead border-separator">x</p>;\n'
  printf '/* prose: one press away, at `--text-subheading`, on a hairline. */\n'
} > "$probe"
probe_css="$(mktemp -t check-design-probe-XXXXXX.css)"
printf '.seg-thumb { inset-block: 2px; }\n  --ease-ios: cubic-bezier(0.32, 0.72, 0, 1);\n' > "$probe_css"

control_ok=1
grep -qE '#[0-9a-fA-F]{3,8}\b' "$probe" || control_ok=0
grep -qE 'text-(left|right)\b' "$probe" || control_ok=0
# the two new rules match a real reintroduction …
grep -qE "class(Name)?=[{]?$QUOTE$NOTQUOTE*\b($RETIRED_UTIL)\b" "$probe" || control_ok=0
grep -qE "class(Name)?=[{]?$QUOTE$NOTQUOTE*\b($RETIRED_TOKEN)\b" "$probe" || control_ok=0
grep -qE "^[[:space:]]*\.($RETIRED_UTIL)\b" "$probe_css" || control_ok=0
grep -qE "^[[:space:]]*--($RETIRED_TOKEN_DEF)\b" "$probe_css" || control_ok=0
# … and do not match the prose line, which is the whole reason they are scoped.
if grep -E "class(Name)?=[{]?$QUOTE$NOTQUOTE*\b($RETIRED_UTIL|$RETIRED_TOKEN)\b" "$probe" \
   | grep -q 'prose:'; then control_ok=0; fi

if (( control_ok == 1 )); then
  printf '  %s scanner matches a known-bad control, and spares the prose beside it\n' "$(green PASS)"
else
  printf '  %s the scanner did not match a known-bad control\n' "$(red FAIL)"
  failures=$(( failures + 1 ))
fi
rm -f "$probe" "$probe_css"

echo
if (( failures > 0 )); then
  printf '%s %d of %d checks failed\n' "$(red 'check-design:')" "$failures" "$checks"
  exit 1
fi
printf '%s all %d checks passed\n' "$(green 'check-design:')" "$checks"
