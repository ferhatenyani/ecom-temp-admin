import { z } from "zod";
import { STAFF_STATUSES } from "@/lib/staff";

/**
 * §87's routes, measured against the live API on 2026-08-21.
 *
 * The vocabulary lives in `lib/staff.ts`, which has no dependencies, and this
 * module imports it — the split every resource in this panel makes, so a client
 * component can hold `STAFF_STATUSES` as a value without Zod arriving in the
 * browser with it.
 */

/**
 * A row from `GET /users`.
 *
 * **`application_passwords` is absent, and the absence is the contract.** The
 * single read adds it; a list of 69 accounts does not enumerate everybody's
 * devices. Verified by key on a captured pair rather than inferred.
 */
export const staffUser = z.looseObject({
  id: z.number(),
  /** The login. Read-only after creation — `user_login` is refused by name. */
  username: z.string(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  /** Always present; falls back to the username, so this is never blank. */
  display_name: z.string(),
  /**
   * One of §45's seven **or `administrator`**, and not validated as an enum for
   * that reason: two accounts on this install are WordPress administrators and
   * `/roles` publishes no row for them. An unknown role still renders — see
   * `roleLabel()`.
   */
  role: z.string(),
  /** The display name for the role above. `"administrator"` on those two. */
  role_name: z.string(),
  is_administrator: z.boolean(),
  status: z.enum(STAFF_STATUSES),
  /** ISO with `+00:00`. Safe for `new Date()`, unlike an audit row's. */
  date_created: z.string(),
});
export type StaffUser = z.infer<typeof staffUser>;

export const staffUserList = z.array(staffUser);

/**
 * One application password, as the collection publishes it.
 *
 * **No `password` and no `last_ip`.** The first appears in the mint response
 * alone; the second is stored by WordPress and deliberately not published,
 * because it is the one field here describing a person rather than a credential.
 */
export const applicationPassword = z.looseObject({
  uuid: z.string(),
  /** Unique per account — a duplicate is a 409 naming it. */
  name: z.string(),
  created: z.string(),
  /** Null until the credential authenticates once. */
  last_used: z.string().nullable(),
});
export type ApplicationPassword = z.infer<typeof applicationPassword>;

export const applicationPasswordList = z.array(applicationPassword);

/**
 * `GET /users/{id}` — the list row plus the devices.
 *
 * The one place `application_passwords` appears outside its own collection, and
 * it lets the detail screen render in one request rather than two.
 */
export const staffUserDetail = staffUser.extend({
  application_passwords: applicationPasswordList,
});
export type StaffUserDetail = z.infer<typeof staffUserDetail>;

/**
 * `POST /users/{id}/application-passwords` — **the only response carrying the
 * secret**, and the only one this panel ever renders it from.
 *
 *   201 {uuid, name, created, last_used: null, password: "gwJ1p4NDOdhU90hteeaM6ldT"}
 *
 * **This line said 200 until 2026-08-29.** `UserController.php:267` passes 201,
 * §87's own example prints 201, and the harness answers 201; the docblock was
 * the only source saying otherwise and had never been checked. `POST /users`
 * (`UserController.php:200`) is the same correction one route over, and
 * `lib/staff.ts` carries both. Nothing branches on the number — `acWrite` treats
 * every 2xx alike — which is exactly how a wrong comment survives.
 *
 * `password` is required here, unlike everywhere else, because a mint that
 * answered without one would be a sheet showing a copy button over nothing —
 * and failing the parse is the right outcome, since the credential is
 * unrecoverable and the operator has to know to revoke and mint again.
 */
export const mintedApplicationPassword = applicationPassword.extend({
  password: z.string(),
});
export type MintedApplicationPassword = z.infer<typeof mintedApplicationPassword>;

/**
 * A role from `GET /roles`, which is §45's matrix published.
 *
 * **Seven rows, `assignable` true on two.** The flag is the whole reason this
 * route is not just a list of strings: a picker filters on it while a label must
 * still resolve one of the five it excludes, because **50 of 69** accounts hold
 * one — and must additionally resolve `administrator`, which those two extra
 * accounts hold and which this route does not publish at all.
 */
export const role = z.looseObject({
  role: z.string(),
  name: z.string(),
  capabilities: z.array(z.string()),
  assignable: z.boolean(),
});
export type Role = z.infer<typeof role>;

export const roleList = z.array(role);

/**
 * `DELETE /users/{id}` — `{id, deleted: true}`, not the row.
 *
 * Worth pinning: the obvious implementation rebinds the detail screen to the
 * response and finds a two-key object where a user was.
 */
export const staffUserDeleted = z.looseObject({
  id: z.number(),
  deleted: z.boolean(),
});

/**
 * `details` on the 409 that refuses to delete an account owning orders.
 *
 *   409 "That account owns orders and cannot be deleted. Suspend it instead:
 *        PATCH /users/{id} with {"status":"suspended"}."
 *   details: {orders: 3}
 *
 * A count, not a list. The panel renders the number and offers the alternative
 * the message names as a button rather than repeating the sentence.
 */
export const deleteConflictDetails = z.looseObject({
  orders: z.number(),
});

/**
 * `details` on the two 409s that refuse a duplicate.
 *
 *   POST /users                          {username: "ac_panel_suspended"}
 *   POST /users (email taken)            {email: "…"}
 *   POST …/application-passwords         {name: "…"}
 *
 * All three key by the field that collided, which is what lets the error land on
 * the control rather than in a toast. `looseObject` with everything optional:
 * one key arrives, never all three.
 */
export const duplicateDetails = z.looseObject({
  username: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
});
