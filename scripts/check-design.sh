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
FLOOR=307
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
