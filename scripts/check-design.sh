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
# the customers branch, floor 95; 123 at the shipping branch, floor 117.
FLOOR=117
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
echo "elevation is surface, not shadow"

# Shadow exists for a sheet and a popover. Nothing else in the panel casts one.
shadow_hits="$(grep -nE 'shadow-' "${FILES[@]}" 2>/dev/null \
  | grep -vE '(Sheet|Popover|ActionSheet)\.tsx' \
  | grep -vE 'shadow-overlay' || true)"
report "no shadows outside Sheet and Popover" \
  "A card is a surface step on a grouped ground — no border, no shadow." \
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
checks=$(( checks + 1 ))
probe="$(mktemp -t check-design-probe-XXXXXX.tsx)"
printf 'const bad = "#ff00aa"; const worse = "ml-4 text-left";\n' > "$probe"
if grep -qE '#[0-9a-fA-F]{3,8}\b' "$probe" && grep -qE 'text-(left|right)\b' "$probe"; then
  printf '  %s scanner matches a known-bad control\n' "$(green PASS)"
else
  printf '  %s the scanner did not match a known-bad control\n' "$(red FAIL)"
  failures=$(( failures + 1 ))
fi
rm -f "$probe"

echo
if (( failures > 0 )); then
  printf '%s %d of %d checks failed\n' "$(red 'check-design:')" "$failures" "$checks"
  exit 1
fi
printf '%s all %d checks passed\n' "$(green 'check-design:')" "$checks"
