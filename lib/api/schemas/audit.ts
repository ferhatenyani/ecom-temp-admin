import { z } from "zod";

/**
 * `GET /audit-logs`, measured against the live API and the live table on
 * 2026-08-21.
 *
 * The vocabulary lives in `lib/audit.ts`, which has no dependencies, and this
 * module imports nothing from it — the row is nine plain fields and the
 * interesting work is all in how `metadata` is read, which is that module's job.
 */

/**
 * One row of the trail.
 *
 * Nothing here is an enum. `action` and `resource_type` are **open
 * vocabularies** — 85 and 23 distinct values on this install, growing with every
 * subsystem the backend adds — so a row whose action this build has never seen
 * still renders. That is the `unknownSectionTypes()` rule: the trail is the one
 * screen where showing less than arrived is the wrong failure.
 */
export const auditRow = z.looseObject({
  id: z.number(),
  /**
   * `0` is the system — a CLI drain or a migration — and comes with an empty
   * `actor_login`. Rendered as a named state, never as a zero.
   */
  actor_id: z.number(),
  /**
   * **On every row**, which is what makes this screen work where the inventory
   * ledger's does not: a movement carries `actor_id` alone and both routes that
   * could resolve it are refused to most of the staff who can read it. The trail
   * carries the login itself.
   */
  actor_login: z.string(),
  action: z.string(),
  resource_type: z.string(),
  /**
   * **A string, not a number**, and the column is `varchar(64)` because the
   * things this trail records are not all numbered: a page is audited by path, a
   * FAQ category by slug, a menu by location. `"0"` appears on `settings.updated`
   * rows, where there is no resource to point at.
   */
  resource_id: z.string(),
  /** `127.0.0.1` from the CLI, the docker bridge from a proxied request. */
  ip_address: z.string(),
  /**
   * Four distinguishable shapes across the 85 actions, and one of them carries
   * values while another carries only field names — see `metadataShape()`. `{}`
   * on a row whose writer recorded nothing.
   */
  metadata: z.record(z.string(), z.unknown()),
  /**
   * **`"2026-08-21 18:55:45"` — no `T`, no offset.** The third route in this API
   * with the convention. `new Date()` reads it as local time and shifts every
   * row by the host's offset with nothing on screen to show it; `parseApiDate()`
   * reads it as UTC, which is what `AuditEvent`'s `gmdate()` means.
   */
  created_at: z.string(),
});
export type AuditRow = z.infer<typeof auditRow>;

export const auditList = z.array(auditRow);
