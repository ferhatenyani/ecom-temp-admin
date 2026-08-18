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
  # needs a real Application Password, and two of them, because several tests
  # prove a Super Admin and a Support Agent are treated differently.
  if [[ -z "${AC_STAFF_USER:-}" ]]; then
    if [[ -x ./scripts/mint-credential.sh ]]; then
      echo "minting credentials against the dev stack…"
      local cred limited
      cred=$(./scripts/mint-credential.sh ac_super_admin) || return 1
      limited=$(./scripts/mint-credential.sh ac_support_agent) || return 1
      export AC_STAFF_USER="${cred%%:*}" AC_STAFF_PASS="${cred#*:}"
      export AC_LIMITED_USER="${limited%%:*}" AC_LIMITED_PASS="${limited#*:}"
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
