#!/usr/bin/env bash
#
# Issues a WordPress Application Password against the development stack, for a
# throwaway account in a named role.
#
# The per-user credential decision means there is no service account to fall back
# on: the e2e suite needs a real staff credential, and a Super Admin's is not
# interchangeable with a Support Agent's — several tests exist precisely to prove
# they differ.
#
#   scripts/mint-credential.sh                      → a Super Admin
#   scripts/mint-credential.sh ac_support_agent     → a Support Agent
#
# Prints `login:password` on stdout and nothing else, so it composes:
#
#   export AC_STAFF_USER="${CRED%%:*}" AC_STAFF_PASS="${CRED#*:}"

set -euo pipefail

ROLE="${1:-ac_super_admin}"
STACK="${AC_STACK_DIR:-$HOME/projects/ecom-temp}"
LOGIN="ac_panel_${ROLE#ac_}"

if [[ ! -f "$STACK/compose.yaml" ]]; then
  echo "No stack at $STACK — set AC_STACK_DIR to the backend repository." >&2
  exit 2
fi

CRED=$(cd "$STACK" && docker compose run --rm -T \
  -e AC_LOGIN="$LOGIN" -e AC_ROLE="$ROLE" wpcli wp eval '
$login = getenv("AC_LOGIN");
$role  = getenv("AC_ROLE");
if (!isset(wp_roles()->roles[$role])) {
    fwrite(STDERR, "no such role: {$role}\n");
    exit(1);
}
$u = get_user_by("login", $login);
if (!$u) {
    $id = wp_insert_user([
        "user_login" => $login,
        "user_pass"  => wp_generate_password(32),
        "user_email" => $login . "@example.test",
        "role"       => $role,
    ]);
    $u = get_user_by("id", $id);
}
$u->set_role($role);
// One credential per account: an old one left behind is a working key nobody is
// tracking.
foreach (WP_Application_Passwords::get_user_application_passwords($u->ID) as $p) {
    WP_Application_Passwords::delete_application_password($u->ID, $p["uuid"]);
}
$new = WP_Application_Passwords::create_new_application_password($u->ID, ["name" => "panel-e2e"]);
echo $login, ":", $new[0];
' 2>/dev/null | tr -d '\r')

if [[ ${#CRED} -lt 10 ]]; then
  echo "could not mint a credential — is the stack up?" >&2
  exit 2
fi

printf '%s' "$CRED"
