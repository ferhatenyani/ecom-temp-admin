#!/usr/bin/env bash
#
# Staged, mirroring the backend repository's convention. A stage that cannot run
# says so and fails; it never reports success by being skipped.
#
#   scripts/test.sh            every stage
#   scripts/test.sh types      one stage
#
# Stages: types design unit e2e

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

STAGES=("${@:-types design unit e2e}")
# shellcheck disable=SC2206
[[ $# -eq 0 ]] && STAGES=(types design unit e2e)

failed=()
ran=()

bold() { printf '\033[1m%s\033[0m\n' "$1"; }

stage() {
  local name="$1"
  shift
  bold "── ${name} ──"
  if "$@"; then
    ran+=("$name")
  else
    ran+=("$name")
    failed+=("$name")
  fi
  echo
}

run_types() { npx tsc --noEmit; }

run_design() { ./scripts/check-design.sh; }

run_unit() { npx vitest run; }

run_e2e() {
  # The per-user credential decision means there is no service account: the suite
  # needs real Application Passwords, and **three** of them.
  #
  # Two was enough while every screen refused the same role. It stopped being
  # enough on the customers branch, where the roles invert: a **Support Agent can
  # read customers** — they hold `ac_manage_customers`, the thinnest role in the
  # system holding anything — and is refused coupons, while a **Marketing Manager**
  # is exactly the other way round. One branch, two screens, opposite fixtures.
  #
  # The Marketing Manager also earns its place positively rather than only as a
  # refusal: `/products` and `/product-categories` are `ac_manage_products` and
  # answer 403 to them, so they are the role the coupon restriction picker could
  # not have been built for, and the one whose success proves it was.
  #
  # A **fourth** arrived with the shipping branch, and it is the only one of the
  # four that still describes a live account. The two-tier collapse in `ecom-temp`
  # retired the five intermediate roles, so `ac_support_agent` and
  # `ac_marketing_manager` now name configurations production does not have —
  # they still mint, because `set_role()` is WordPress core and bypasses the API's
  # narrowing, and the suites that use them still pass. `ac_manager` is the live
  # forbidden fixture: 200 on shipping and COD, **403 on payments**, which is one
  # credential carrying a real refusal and a real success on the same branch.
  if [[ -z "${AC_STAFF_USER:-}" ]]; then
    if [[ -x ./scripts/mint-credential.sh ]]; then
      echo "minting credentials against the dev stack…"
      local cred limited marketing manager
      cred=$(./scripts/mint-credential.sh ac_super_admin) || return 1
      limited=$(./scripts/mint-credential.sh ac_support_agent) || return 1
      marketing=$(./scripts/mint-credential.sh ac_marketing_manager) || return 1
      manager=$(./scripts/mint-credential.sh ac_manager) || return 1
      export AC_STAFF_USER="${cred%%:*}" AC_STAFF_PASS="${cred#*:}"
      export AC_LIMITED_USER="${limited%%:*}" AC_LIMITED_PASS="${limited#*:}"
      export AC_MARKETING_USER="${marketing%%:*}" AC_MARKETING_PASS="${marketing#*:}"
      export AC_MANAGER_USER="${manager%%:*}" AC_MANAGER_PASS="${manager#*:}"
    else
      echo "no credential available and no way to mint one" >&2
      return 1
    fi
  fi

  # A suite that skips because the app is not running is a suite that reports a
  # pass for work it did not do.
  if ! curl -s -o /dev/null -m 10 "${PANEL_BASE:-http://localhost:3001}/fr/login"; then
    echo "the panel is not answering at ${PANEL_BASE:-http://localhost:3001} — start 'npm run dev'" >&2
    return 1
  fi

  # The products suite asserts on facets, and a facet needs a global attribute to
  # count. This shop had none: `GET /attributes` answered `[]`, so
  # `meta.facets.attributes` could only ever be empty and `?attributes[…]` could
  # only ever be a 400. The seed is idempotent and takes a few seconds; it is here
  # rather than in a README step because the backend's own `scripts/test.sh`
  # re-seeds the catalogue and strips the two variable products' global tags,
  # which would quietly thin the facet rather than fail anything.
  if ! node scripts/seed-attributes.mjs "$AC_STAFF_USER" "$AC_STAFF_PASS"; then
    echo "could not seed the global attributes the facet tests need" >&2
    return 1
  fi

  # And the three shipping rules the resolver tests assert against. Same
  # argument as the attributes above: this shop shipped with `GET
  # /shipping/rules` answering `[]`, so `/shipping/rates` could only ever answer
  # `[]` too — a 200 with nothing in it — and the rules editor had nothing to
  # resolve. Idempotent, and it repairs a drifted price rather than only
  # creating a missing rule.
  if ! node scripts/seed-shipping-rules.mjs "$AC_STAFF_USER" "$AC_STAFF_PASS"; then
    echo "could not seed the shipping rules the resolver tests need" >&2
    return 1
  fi

  # And the content. Three reasons rather than the usual one:
  #
  # `GET /cms/homepage` answered `{"sections": []}`, so the homepage editor, its
  # ordering and its `meta.problems` drop report were all built against a
  # document with nothing in it. The drop report in particular **cannot be
  # provoked through the API** — the only route that writes the document is the
  # one that refuses to write a malformed one — so the seed writes the option
  # underneath it.
  #
  # And it removes 78 pages that shared two paths between them. Not suffixed
  # copies: `wp_unique_post_slug()` does not run for a draft, so 53 rows all
  # answered to `ac-unpublished` and 27 to `conditions`, while
  # `get_page_by_path()` can only ever resolve one of each. The rest were
  # unreachable through `/cms/pages/{path}` entirely, and a Pages index would
  # have shown 27 identical rows whose links all opened the same page.
  if ! node scripts/seed-cms.mjs "$AC_STAFF_USER" "$AC_STAFF_PASS"; then
    echo "could not seed the content the CMS tests need" >&2
    return 1
  fi

  # Named explicitly rather than "every project": `phone-webkit` needs WebKit's
  # system libraries, which want root to install. Including it here would make the
  # stage red on a machine that is otherwise fine, and a stage that is always red
  # is a stage nobody reads. Run it deliberately:
  #
  #   sudo env "PATH=$PATH" npx playwright install-deps webkit
  #   npx playwright test --project=phone-webkit
  #
  # Last run 2026-08-18: 58/58, after the inventory branch.
  npx playwright test --project=phone --project=phone-min --project=phone-max --project=desktop
}

for name in "${STAGES[@]}"; do
  case "$name" in
    types) stage types run_types ;;
    design) stage design run_design ;;
    unit) stage unit run_unit ;;
    e2e) stage e2e run_e2e ;;
    *) echo "unknown stage: $name" >&2; exit 2 ;;
  esac
done

bold "── summary ──"
if ((${#failed[@]} > 0)); then
  printf 'ran %s; \033[31mfailed: %s\033[0m\n' "${ran[*]}" "${failed[*]}"
  exit 1
fi
printf 'ran %s; \033[32mall stages passed\033[0m\n' "${ran[*]}"
