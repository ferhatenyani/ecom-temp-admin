/**
 * Staff accounts, roles, and the refusals that are the security model.
 *
 * No dependencies, so a client component can import a value from here without
 * pulling Zod into the browser. `lib/api/schemas/staff.ts` imports this, never
 * the reverse.
 *
 * **"the five refusals" until 2026-08-29, and it was never five.** ADMIN_PANEL.md
 * §87 names five *escalation* refusals and two further ones it calls additional;
 * this file listed a mixture of both and called the mixture "§87's five". See
 * `SelfRefusal` below, which now says what it is and cites §87 for the taxonomy.
 *
 * Measured against the live API on 2026-08-21, and re-measured against the
 * harness on 2026-08-29 wherever a count appears. **`/users` is staff and
 * `/customers` is shoppers, and no account is in both** — `GET /users/{id}` on a
 * shopper is a 404 and vice versa — so nothing here is shared with
 * `lib/customers.ts` and the two types deliberately do not meet.
 */

/* ----------------------------------------------------------------- roles --- */

/**
 * **Seven roles are published and two are assignable**, and most accounts on
 * this install hold one of the five that are not.
 *
 *   GET /roles → 7 rows, `assignable` true on ac_super_admin and ac_manager only
 *
 * The distribution, counted against the harness on 2026-08-29 — 69 rows, of
 * which **50 hold a retired role**:
 *
 *   support_agent 19 · admin 14 · super_admin 12 · order_manager 7 ·
 *   product_manager 6 · manager 5 · marketing_manager 4 · administrator 2
 *
 *   node scripts/mock-api.mjs &
 *   curl -s '…/users?per_page=100' | jq -r '.data[].role' | sort | uniq -c
 *
 * **This paragraph used to read "51 of the 70" against the live shop and was
 * never re-counted.** The figure above is the fixture every screen in this
 * repository is verified against, and it carries the command that produced it;
 * the live shop was last counted on 2026-08-21 at 70 accounts and this branch
 * had no credential to re-count it with. Where the two can disagree, the number
 * that is checkable is the one written down — DECISIONS.md has twice corrected a
 * figure that read like a measurement and was a recollection.
 *
 * So the picker filters on the flag while a **row label must still resolve a
 * retired role**, and the two are different questions asked of the same list.
 * A picker built from the whole list offers a role the API refuses; a label
 * built from the assignable half leaves three quarters of the shop's staff with
 * a blank beside their name.
 *
 * Assigning a retired one is a 400 **naming it as retired**, not as unknown:
 *
 *   "The role \"ac_support_agent\" is retired and is no longer assigned.
 *    Accounts already holding it keep it and are unaffected; new assignments
 *    choose one of: ac_super_admin, ac_manager."
 *
 * That sentence is rendered verbatim in the field error, for the reason `Field`
 * gives: it names the alternatives, and a translated "rôle invalide" would throw
 * that away.
 */
export function assignableRoles<T extends { role: string; assignable: boolean }>(
  roles: readonly T[],
): T[] {
  return roles.filter((role) => role.assignable);
}

/**
 * The label for a role an account holds, which is not always a role `/roles`
 * publishes.
 *
 * **Two accounts are WordPress `administrator` with `is_administrator: true`**,
 * and `administrator` is not one of the seven. It *is* in the API's own `?role=`
 * enum, so `?role=administrator` answers those two while `GET /roles` publishes
 * no row a picker could offer — the asymmetry `users/query.ts` records as the
 * role filter's one blind spot. `UserRoles::staff()` counts them
 * as staff — an account is staff when it holds one of §45's seven *or* is a
 * WordPress administrator — so they appear in the list and no entry in `/roles`
 * describes them.
 *
 * The row's own `role_name` is the fallback and it is always present: measured,
 * the two administrators carry `role_name: "administrator"`. So the resolution
 * order is the published matrix first (which gives "Support Agent" rather than
 * `ac_support_agent`), then the row's own name, then the raw key — never a
 * blank.
 */
export function roleLabel(
  roleKey: string,
  rowName: string,
  roles: readonly { role: string; name: string }[],
): string {
  return roles.find((role) => role.role === roleKey)?.name ?? (rowName || roleKey);
}

/**
 * A role the account holds that can no longer be given to anybody else.
 *
 * Rendered as a note on the detail rather than as a warning: it is not a problem
 * with the account, it is a fact about the matrix, and the account works exactly
 * as it did. The two-tier collapse deliberately left every holder in place —
 * `remove_role()` does not touch `wp_capabilities`, so deleting the definitions
 * would have stranded 43 live accounts on zero capabilities.
 */
export function isRetiredRole(
  roleKey: string,
  roles: readonly { role: string; assignable: boolean }[],
): boolean {
  const known = roles.find((role) => role.role === roleKey);
  return known !== undefined && !known.assignable;
}

/**
 * A WordPress administrator, which is not one of the seven and is not editable
 * as one.
 *
 * `is_administrator` is a boolean on every row. The panel shows it and offers no
 * role change: assigning `administrator` is the first of §87's five refusals
 * (400 — "This API manages commerce roles and does not grant \"administrator\"")
 * and changing one *away* would take platform access off an account this API
 * never granted it to.
 */
export function isWordPressAdministrator(row: { is_administrator: boolean }): boolean {
  return row.is_administrator;
}

/* ---------------------------------------------------------------- status --- */

/**
 * Two, and the API refuses a third by name in `details.params`.
 *
 * **Every account was `active` before `scripts/seed-staff.mjs`**, so the
 * suspended badge, the reactivate action and this filter had nothing to act on —
 * 14b's "every row is pending", one collection over. The seed creates one
 * throwaway account and suspends it through `POST /users` and `PATCH
 * /users/{id}`, which are the production writers.
 */
export const STAFF_STATUSES = ["active", "suspended"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export function isStaffStatus(value: string): value is StaffStatus {
  return (STAFF_STATUSES as readonly string[]).includes(value);
}

export const STATUS_TONE: Record<StaffStatus, "success" | "danger"> = {
  active: "success",
  suspended: "danger",
};

/**
 * **A suspended account is refused at every route in the namespace, including
 * `/auth/me` and `/health`** — `SuspensionGuard` runs in `rest_pre_dispatch` at
 * priority 9, ahead of the rate limiter. So this is not "cannot sign in": it is
 * a credential that answers 401 everywhere, which is why the panel's own 401
 * handling clears the session on `account_suspended`.
 *
 * It does **not** revoke wp-admin. The screen says so, because an operator
 * suspending somebody who has left needs to know the second door is still open
 * and that revoking the application passwords is what closes it.
 */
export function suspensionClosesWordPress(): boolean {
  return false;
}

/* -------------------------------------------- the refusals a session meets --- */

/**
 * **The refusals a session can actually reach from this panel — which is not the
 * same list as §87's five, and this file used to claim it was.**
 *
 * ADMIN_PANEL.md:165-173 tabulates the five *escalation* refusals: assigning a
 * core WordPress role · granting a role holding capabilities the caller lacks ·
 * changing your own role · deleting yourself · the fields refused by name
 * (`user_pass`, `capabilities`, `user_login`). This docblock listed five things
 * and **two of them were different ones**: it dropped the capability guard and
 * the refused fields, and promoted own-suspension and owns-orders, which §87
 * calls *additional* rather than counting among the five.
 *
 * Corrected here rather than renumbered, because the honest list is the one a
 * screen has to render and it is six. §87 is the authority on the taxonomy;
 * this is the authority on what reaches a person:
 *
 *   PATCH /users/{me} {"role"}      403 "You cannot change your own role.
 *                                       Ask another Super Admin."   in §87
 *   PATCH /users/{me} {"status"}    403 "You cannot suspend your own account."
 *                                       §87 lists this as *additional*
 *   DELETE /users/{me}              403 "You cannot delete your own account."
 *                                       in §87 — and the guard runs **before the
 *                                       id is resolved**, so it answers 403 even
 *                                       for an id that is not a staff account
 *   POST/PATCH {"role":"administrator"}
 *                                   400 details.fields.role — a WordPress role
 *                                       carries platform access no capability
 *                                       in this matrix models        in §87
 *   POST/PATCH a role the caller lacks
 *                                   403 — `guardAssignable()` below  in §87
 *   DELETE /users/{id} owning orders
 *                                   409 details.orders — the count. §87 calls
 *                                       this *additional* too
 *
 * §87's fifth — the fields refused by name — is unreachable by construction and
 * is documented at `REFUSED_USER_FIELDS` below, where it belongs: the panel
 * offers a control for none of them, so no screen can provoke it.
 *
 * The panel disables the first three locally, because it knows who it is; the
 * rest it *asks* and renders the answer, because it cannot know any of them
 * without the request. That split is the same one the analytics money gate
 * makes.
 */
export type SelfRefusal = "role" | "suspend" | "delete";

export function isSelf(rowId: number, meId: number | null): boolean {
  return meId !== null && rowId === meId;
}

/**
 * **The capability guard, mirrored — §87's second refusal, which had no mirror
 * here at all until this branch.**
 *
 * `UserService::guardAssignable()` (`UserService.php:311-325`) refuses a grant of
 * any role holding a capability the caller does not hold, with a 403 that names
 * both:
 *
 *   403 forbidden
 *   "You cannot grant \"ac_super_admin\": it holds capabilities you do not have
 *    (ac_manage_content)."
 *
 * No `details`, so there is nothing to bind to a field — the sentence *is* the
 * information, and it names the capabilities, which is why a translated "rôle
 * refusé" would throw the useful half away. `Field` makes the same argument
 * about the retired-role 400.
 *
 * **It is unreachable for a Super Admin and reachable for anybody else**, which
 * is exactly why it had no mirror: `ac_manage_users` is Super Admin's alone
 * today, a Super Admin holds `Capabilities::ALL`, and every subset test passes.
 * The guard exists for the eighth role and the second credential — §87 calls it
 * "what stops a future eighth role from being an escalation path" — and a
 * refusal the panel cannot explain is the defect this run exists to prevent.
 *
 * Reproducible against the harness today, because the mock models the guard
 * rather than the shop:
 *
 *   MOCK_IDENTITY=no_content node scripts/mock-api.mjs
 *   curl -X POST …/users -d '{"…","role":"ac_super_admin"}'   → the 403 above
 *
 * The picker filters on **both** this and `assignable`: they are two independent
 * reasons a role cannot be given, and a control offering a choice the API
 * answers with a paragraph is the thing §3.3 removes.
 */
export function grantableRoles<T extends { role: string; capabilities: readonly string[] }>(
  roles: readonly T[],
  mine: readonly string[],
): T[] {
  const held = new Set(mine);
  return roles.filter((role) => role.capabilities.every((capability) => held.has(capability)));
}

/**
 * The capabilities a role holds that the caller does not — the `(%s)` half of
 * the sentence above, computed locally so the panel can say *why* a role is
 * missing from the picker instead of silently shortening the list.
 *
 * Empty for every role a Super Admin sees, which is the whole shop today.
 */
export function missingForGrant(
  role: { capabilities: readonly string[] },
  mine: readonly string[],
): string[] {
  const held = new Set(mine);
  return role.capabilities.filter((capability) => !held.has(capability));
}

/**
 * Whether an account can be deleted at all, as far as the panel can tell.
 *
 * Deliberately not a prediction of the 409. **Nothing on a user row says whether
 * they own orders** — there is no `orders_count`, and `/orders?customer_id=` is
 * `ac_manage_orders`, a capability this screen's own gate does not imply — so a
 * panel that greyed the button out would be guessing. It asks and renders
 * `details.orders`, which arrives as a count:
 *
 *   409 "That account owns orders and cannot be deleted. Suspend it instead:
 *        PATCH /users/{id} with {"status":"suspended"}."
 *        details: {orders: 3}
 *
 * The refusal names the alternative, and the panel's confirmation offers it as a
 * button rather than repeating the sentence.
 */
export function deleteConflictCount(details: Record<string, unknown>): number | null {
  return typeof details.orders === "number" ? details.orders : null;
}

/* --------------------------------------------- fields refused by name --- */

/**
 * Four fields the API refuses on both `POST` and `PATCH`, each with a reason.
 *
 *   password / user_pass  "A password set by somebody else is one its owner
 *                          cannot trust. Onboard with
 *                          POST /users/{id}/application-passwords."
 *   capabilities          "Capabilities come from the role. Assign a role and
 *                          GET /roles to see what it holds."
 *   roles                 an account holds exactly one — use `role`
 *   user_login            "A login is an identity, not a field. Create the
 *                          account with the username you want."
 *
 * The panel offers a control for none of them, so none of these errors can be
 * provoked from a screen. They are listed because `user_login` decides the shape
 * of the **edit** form: a username is set once at creation and is read-only
 * afterwards, and a field that looked editable and 400d would be a bug report.
 */
export const REFUSED_USER_FIELDS = [
  "password",
  "user_pass",
  "capabilities",
  "roles",
  "user_login",
] as const;

/* ------------------------------------------------- application passwords --- */

/**
 * **The password appears in one response and nowhere else, ever.**
 *
 *   POST /users/{id}/application-passwords {"name": "…"}
 *   → 201 {uuid, name, created, last_used: null,
 *          password: "gwJ1p4NDOdhU90hteeaM6ldT"}
 *
 * **That said 200 until 2026-08-29 and the API has always sent 201.**
 * `UserController.php:267` passes 201, ADMIN_PANEL.md §87 prints 201 in the one
 * example it gives, and the harness returns 201 — three sources agreeing against
 * one docblock that had never been checked. `POST /users` is the same correction
 * one route over (`UserController.php:200`), and both are the carried-forward
 * "last create pinned at 200 and never measured" family arriving again. Nothing
 * branched on either number, which is how both survived: `acWrite` treats any
 * 2xx alike, so the cost of being wrong here is a reader who trusts the comment.
 *
 * Not on the collection, not on `GET /users/{id}`, not in the audit row — the
 * audit event carries `{login, name, uuid}` and was checked for the secret
 * rather than assumed clean. So the panel shows it once, in a sheet, with a copy
 * button and a warning, and offers no reveal affordance anywhere: there is
 * nothing to reveal.
 *
 * It is **24 characters with no spaces** on this install, where docs/API.md's
 * example shows the six-group spaced form WordPress renders in wp-admin. Both
 * authenticate — WordPress strips spaces on the way in — so the panel renders
 * whatever arrived rather than re-grouping it.
 */
export function hasSecret(minted: { password?: string }): boolean {
  return typeof minted.password === "string" && minted.password !== "";
}

/**
 * Two 409s on one route, and they are different sentences.
 *
 *   duplicate name      "That account already has an application password with
 *                        this name."           details: {name: "…"}
 *   suspended account   "That account is suspended. Reactivate it before
 *                        issuing a credential."   no details
 *
 * The first is a validation error on the name field; the second is a fact about
 * the account and belongs at the top of the section with the reactivate action
 * beside it. Rendering both as a toast would make the second look like a typo.
 */
export function credentialConflict(
  details: Record<string, unknown>,
): { kind: "name"; name: string } | { kind: "suspended" } {
  return typeof details.name === "string"
    ? { kind: "name", name: details.name }
    : { kind: "suspended" };
}

/**
 * A device that has never been used.
 *
 * `last_used` is null on a freshly minted credential and stays null until the
 * account authenticates with it. `last_ip` is deliberately **not published** —
 * docs/API.md says it is the one field here describing a person rather than a
 * credential — so the row shows a name, a date and nothing else.
 */
export function neverUsed(password: { last_used: string | null }): boolean {
  return password.last_used === null;
}

/* --------------------------------------------------------------- search --- */

/**
 * **`?search=` matches the display name here, unlike `/customers`.**
 *
 * `UserRepository::paginate()` sets `search_columns` to `user_login`,
 * `user_email`, `user_nicename` and `display_name`, where the customers list
 * matches login and email only — which is why that field carries a note saying
 * a customer cannot be found by typing their name.
 *
 * **But it does not reach a first or last name either, and that is the half
 * worth saying out loud.** `first_name` and `last_name` are stored as user meta
 * and are not `search_columns`; they are published on every row, which makes
 * them exactly the thing somebody types. Measured against the harness:
 *
 *   ?search=nadia    1 row — display name "Nadia Cherif", login
 *                    `ac_panel_suspended`
 *   ?search=Karim    1 row — account 774, matched on its *display name*
 *                    ("Karim B."), not on `first_name`
 *   ?search=Benali   **0 rows** — and 774's `last_name` is Benali
 *
 * So the placeholder names the scope rather than being generic: a field that
 * silently cannot answer the question it invites is the customers-list defect
 * (§7) which shipped for three branches and made a whole empty state
 * unreachable. `?search=` empty is an **absence** here, not a 400 — unlike
 * `?status=` and `?role=`, which are both 400s on this collection.
 */
export const SEARCHED_COLUMNS = ["username", "email", "display_name"] as const;

/**
 * `?orderby=` takes five values and defaults to `registered`, descending — and
 * **it is the strongest sort control measured on this run.**
 *
 * `UserController.php:135-140` declares `'enum' => UserRepository::ORDERBY` and
 * runs it through `rest_validate_request_arg`; `UserRepository.php:31` is the
 * list, `:89` the `in_array`, `:90` the direction. So unlike `/notifications`,
 * where the parameter is accepted and ignored, and unlike `/shipping` and
 * `/payments`, where garbage is a silent 200, **`?orderby=zzz` and `?order=zzz`
 * are both 400** — the value reaches a validator.
 *
 * Measured 2026-08-29 against the harness, every combination sent on its own and
 * compared over **all** 69 rows rather than over a head window:
 *
 *   5 fields × 2 directions = 10 requests → **10 distinct id sequences**
 *   `registered desc` is byte-identical to the bare listing — the resting order
 *   no tie anywhere: every row has a distinct login, address, display name and
 *   registration minute, so a tie cannot be mistaken for a refusal to sort
 *
 * That last line is what §7 paid for: a control taken on a collection's *default*
 * ordering proves nothing, and this file previously declined the whole feature on
 * the strength of a screen decision rather than a measurement.
 *
 * **This docblock used to say the panel offers none of them.** It now offers four
 * — `display_name`, `user_email`, `user_login` and `registered` — as header
 * controls with `aria-sort`. `ID` sorts and gets no column: a column of primary
 * keys is nothing anybody scans, and adding one to hang a sort on is chrome. It
 * stays reachable by URL, which is how coupons treats `date` and marketing `id`.
 */
export const ORDERBY_VALUES = [
  "registered",
  "ID",
  "display_name",
  "user_email",
  "user_login",
] as const;

/* ---------------------------------------------------------------- names --- */

/**
 * What the row calls somebody.
 *
 * `display_name` is always present and falls back to the username, so unlike
 * `/customers` — where 12 of 16 rows have no name at all — there is never a
 * blank. The username is still rendered beside it as the identifier, because it
 * is what the audit trail records in `actor_login` and it is what somebody types
 * into the sign-in form.
 *
 * **The "never blank" claim is right; the count beside it was not.** Counted
 * against the harness on 2026-08-29: **0 of 69** rows have a blank
 * `display_name` — `wp_insert_user()` substitutes the login, so the guarantee is
 * structural rather than a property of this shop's data — while **67 of 69**
 * have neither a first nor a last name and **64 of 69** have a display name that
 * *is* the login. Those are three different facts and this file used to carry
 * only a muddle of the first two.
 *
 * The third is what shapes the list: on nine rows in ten the name column and the
 * login column say the same string, so the row has to earn its second line some
 * other way — which is why the identifying cell is the display name and the
 * login is a column beside it rather than a subtitle under it.
 */
export function staffName(row: { display_name: string; username: string }): string {
  return row.display_name.trim() !== "" ? row.display_name : row.username;
}
