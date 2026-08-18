#!/usr/bin/env bash
#
# Clears the API's rate-limit counters on the development stack.
#
# The e2e suite deliberately submits a bad password — Part VII asks for it, and the
# 429 with its `Retry-After` is a real thing the login screen has to render. But the
# failed-login bucket is **10 per 15 minutes per IP**, and a locked-out address is
# then refused *even with the correct password*. Two bad attempts per project across
# five projects is 10, so the suite locks itself out halfway through and every
# subsequent test fails looking exactly like a product bug: measured, a known-good
# credential answered `429 too_many_requests` with 218 `ac_rl_` rows in the options
# table.
#
# The backend's own scripts/test-api.sh clears these before it starts, for the same
# reason and with the same one-liner.

set -euo pipefail

STACK="${AC_STACK_DIR:-$HOME/projects/ecom-temp}"

if [[ ! -f "$STACK/compose.yaml" ]]; then
  echo "No stack at $STACK — set AC_STACK_DIR to the backend repository." >&2
  exit 2
fi

result=$(cd "$STACK" && docker compose run --rm -T wpcli wp eval '
global $wpdb;
$n = $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE \"%ac_rl_%\"");
echo (int) $n;
' 2>/dev/null | tr -d '\r')

echo "rate-limit counters cleared (${result:-0} rows)"
