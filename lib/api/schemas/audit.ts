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
   * things this trail records are not all numbered: `cms` is audited as
   * `ac_cms_homepage`, `menu` as `primary`, `shipping_provider` as `yalidine`.
   *
   * *(This used to say "a page is audited by path, a FAQ category by slug".
   * Measured against the source on 2026-08-29, that is false —
   * `CmsService.php:156,224,296` record `(int) $page->ID` and `:436,479,512` the
   * numeric term id, and the path and the slug go in `metadata`. The conclusion
   * survives with the right examples: `absint` on this column would turn
   * `primary` into 0 and match every row that has no resource id at all.)*
   *
   * `"0"` appears on `settings.updated` and `import.products` rows, where there
   * is no resource to point at — and `?resource_id=0` answers the **whole
   * collection**, because PHP's `array_filter` drops the falsy string. See
   * `isFilterableResourceId` in `lib/audit.ts`.
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
