/**
 * Staff accounts, roles, and the five refusals that are the security model.
 *
 * No dependencies, so a client component can import a value from here without
 * pulling Zod into the browser. `lib/api/schemas/staff.ts` imports this, never
 * the reverse.
 *
 * Measured against the live API on 2026-08-21. **`/users` is staff and
 * `/customers` is shoppers, and no account is in both** — `GET /users/{id}` on a
 * shopper is a 404 and vice versa — so nothing here is shared with
 * `lib/customers.ts` and the two types deliberately do not meet.
 */

/* ----------------------------------------------------------------- roles --- */

/**
 * **Seven roles are published and two are assignable**, and 51 of the 70
 * accounts on this install hold one of the five that are not.
 *
 *   GET /roles → 7 rows, `assignable` true on ac_super_admin and ac_manager only
 *   GET /users → super_admin 11, admin 14, manager 6, order_manager 7,
 *                product_manager 6, support_agent 19, marketing_manager 5,
 *                administrator 2
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
 * and `administrator` is not one of the seven. `UserRoles::staff()` counts them
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
 * **All 70 accounts were `active` before `scripts/seed-staff.mjs`**, so the
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

/* --------------------------------------------------- the five refusals --- */

/**
 * §87's five escalation refusals, each rendered as a **disabled control with the
 * reason** rather than a hidden one. ADMIN_PANEL.md is explicit: the refusals
 * are the security model, and a Super Admin should be able to see it.
 *
 * All five measured 2026-08-21 against the live API, with the caller's own
 * account as the subject where the rule is about self:
 *
 *   PATCH /users/{me} {"role"}      403 "You cannot change your own role.
 *                                       Ask another Super Admin."
 *   PATCH /users/{me} {"status"}    403 "You cannot suspend your own account."
 *   DELETE /users/{me}              403 "You cannot delete your own account."
 *   POST /users {"role":"administrator"}
 *                                   400 details.fields.role — a WordPress role
 *                                       carries platform access no capability
 *                                       in this matrix models
 *   DELETE /users/{id} owning orders
 *                                   409 details.orders — the count
 *
 * The panel disables the first three locally, because it knows who it is; the
 * last two it *asks* and renders the answer, because it cannot know either
 * without the request. That split is the same one the analytics money gate
 * makes.
 */
export type SelfRefusal = "role" | "suspend" | "delete";

export function isSelf(rowId: number, meId: number | null): boolean {
  return meId !== null && rowId === meId;
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
 *   → 200 {uuid, name, created, last_used: null,
 *          password: "gwJ1p4NDOdhU90hteeaM6ldT"}
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
 * a customer cannot be found by typing their name. This one can be, and the
 * field says nothing, because there is nothing surprising to say.
 *
 * Measured: `?search=nadia` returns the one account whose display name is
 * "Nadia Cherif" and whose username is `ac_panel_suspended`.
 */
export const SEARCHED_COLUMNS = ["username", "email", "display_name"] as const;

/**
 * `?orderby=` takes five values and defaults to `registered`, descending.
 *
 * Unlike `/notifications`, where the parameter is accepted and ignored, this one
 * is a real enum — `UserRepository::ORDERBY` — and a sixth value is a 400. The
 * panel offers **none of them**, and that is a screen decision rather than a
 * measurement: newest-first is the order somebody onboarding an account wants,
 * a name sort over 70 rows of which 12 have no name at all would sort mostly by
 * username, and the search field answers "find this person" better than any
 * ordering does.
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
 */
export function staffName(row: { display_name: string; username: string }): string {
  return row.display_name.trim() !== "" ? row.display_name : row.username;
}
