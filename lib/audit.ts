/**
 * The audit trail's vocabulary, and the five facts that decide how the screen is
 * built.
 *
 * No dependencies, so a client component can import a value from here without
 * pulling Zod into the browser. `lib/api/schemas/audit.ts` imports this, never
 * the reverse.
 *
 * Measured against the live API and the live table on 2026-08-21.
 */

/* --------------------------------------------------------------- filters --- */

/**
 * **Five filters, and two of them did not work until this branch.**
 *
 * Measured before the backend's `feat/audit-filters`, over 16 632 rows:
 *
 *   ?actor_id=475                    873   honoured
 *   ?action=notification.retried      84   honoured
 *   ?resource_type=notification       84   honoured
 *   ?resource_id=4640             16 632   ACCEPTED AND IGNORED
 *   ?date_from= / ?date_to=       16 632   ACCEPTED AND IGNORED
 *   ?search=                      16 632   ACCEPTED AND IGNORED
 *   ?action=nonsense                   0   200, not validated
 *
 * §65's failure mode: a filter that does not filter looks exactly like a
 * collection that all matches. ADMIN_PANEL.md names all five as though they
 * worked, so two clauses went into `AuditRepository` on a narrow backend branch
 * before a line of this screen existed — 16 632 rows at 20 a page is **832
 * pages**, which makes the date range the difference between a screen and a
 * scroll, and `?resource_id=` is how somebody gets from an audited object to its
 * own history.
 *
 * **`?search=` stays unfilterable and the panel offers no search box**, which is
 * the honest answer rather than an omission: writes are audited by field *name*,
 * never by value, so there is no column holding the thing a free-text box would
 * be searching for.
 *
 * **`?orderby=` and `?order=` are not parameters** — measured, `?order=asc`
 * returns the identical first rows — because the table is append-only and its id
 * order is its time order. No sort control, same as the notification queue.
 */

/**
 * `?action=` is validated by **pattern**, not by an enum: `^[a-z0-9._-]+$`.
 *
 * An action outside the vocabulary is a **200 with 0 rows**, not a 400 — so a
 * stale URL here is an empty list rather than an error screen, and the field is
 * a free-text box rather than a picker. That is a measurement rather than a
 * preference; see `ACTION_COUNT` below for why a picker was never an option.
 */
export const ACTION_PATTERN = /^[a-z0-9._-]+$/;

export function isActionQuery(value: string): boolean {
  return value === "" || ACTION_PATTERN.test(value);
}

/* ----------------------------------------------------- the two vocabularies --- */

/**
 * **85 distinct actions across 23 resource types, and the set grows with every
 * subsystem.** Counted on the live table 2026-08-21:
 *
 *   product.updated 3072   customer.updated 1227   coupon.updated 893
 *   order.created 859      import.products 262     settings.updated 174
 *   user.role_changed 120  notification.retried 86 …
 *
 * So **the action renders as itself**, in `Ltr`, and is not translated. Three
 * reasons, in order of weight:
 *
 * 1. It is an **identifier**, not prose. `product.updated` is the exact string
 *    `?action=` takes, it is stable across versions, and it is what an operator
 *    quotes into a bug report. The panel already treats `last_error` and a
 *    channel name this way, and `unknownSectionTypes()` renders a section type
 *    it has no name for as itself rather than as a blank.
 * 2. 85 values in two languages is 170 messages over a vocabulary that is open
 *    by construction — every branch of the backend has added to it — so the
 *    file would be stale on the next feature and the screen would silently show
 *    a key path where the newest action should be.
 * 3. **A `.` in a message key is a `next-intl` path separator.** `t("action.
 *    product.updated")` resolves `audit` → `action` → `product` → `updated`,
 *    and a flat key never matches — the defect 14b shipped and caught only in
 *    the dev log. Every one of these 85 carries a dot.
 *
 * The **resource type** is translated, because it is a different thing: 23
 * values, it is the vocabulary of a *control* (`?resource_type=` is the filter
 * the screen offers), and a picker has to say something in the reader's
 * language. An unknown one still renders as itself.
 */
export const ACTION_COUNT = 85;

/**
 * The 22 resource types this build has a name for, in descending order of how
 * often they appear.
 *
 * `ac_banner` is the twenty-third and is **deliberately absent**: one row out of
 * 16 632, written by a CMS delete path that recorded the WordPress post type
 * where every other banner row records `banner`. Naming it here would translate
 * a typo into two languages; it renders as itself, which is what makes it
 * visible as the oddity it is.
 */
export const RESOURCE_TYPES = [
  "product",
  "order",
  "customer",
  "coupon",
  "product_variation",
  "campaign",
  "import",
  "user",
  "shipping_rule",
  "attribute",
  "page",
  "media",
  "settings",
  "geography",
  "faq_category",
  "banner",
  "cms",
  "segment",
  "notification",
  "shipping_provider",
  "faq",
  "menu",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export function isResourceType(value: string): value is ResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(value);
}

/**
 * The subject an action belongs to — the half before the first dot.
 *
 * Used for the tone of the row's dot and for nothing else. `resource_type` is
 * the filter and is *not* always the subject: `inventory.adjusted` is a
 * `product`, `cod.attempt_recorded` is an `order`, and `marketing.consent_given`
 * is a `customer`. Deriving the filter from the action would send a request the
 * API answers with nothing.
 */
export function actionSubject(action: string): string {
  const dot = action.indexOf(".");
  return dot === -1 ? action : action.slice(0, dot);
}

/**
 * The tone a row carries.
 *
 * Four verbs earn a colour and everything else is neutral. `deleted` is the only
 * danger — it is the one entry in the trail that describes something no longer
 * there — and `created` is the only success, so a page of updates reads as a
 * page of updates rather than as a wall of green.
 */
export function actionTone(action: string): "neutral" | "success" | "warning" | "danger" {
  if (/(deleted|cancelled|revoked|failed|purged)$/.test(action)) return "danger";
  if (/(created|registered|imported|synced)$/.test(action)) return "success";
  if (/(suspended|trashed|refunded)$/.test(action)) return "warning";
  return "neutral";
}

/* ------------------------------------------------------------ timestamps --- */

/**
 * **`created_at` is `"2026-08-21 18:55:45"` — no `T`, no offset.**
 *
 * The third route in this API with the convention, after `notes[].created_at`
 * and the campaign recipients' `sent_at`. `new Date()` reads it as *local* time
 * and shifts every row by the host's offset with nothing on screen to show it
 * happened; `parseApiDate()` reads an offsetless stamp as UTC, which is what the
 * writer means — `AuditEvent` stamps `gmdate('Y-m-d H:i:s')` and nothing else
 * writes this table.
 *
 * So every date on this screen goes through `formatDate`, never through
 * `new Date()`, and this note exists to stop somebody "fixing" it.
 */
export const CREATED_AT_HAS_NO_OFFSET = true;

/* -------------------------------------------------------------- metadata --- */

/**
 * **"Audited by field name, never by value" is true of some subsystems and not
 * of others**, and ADMIN_PANEL.md states it as a rule about the whole trail.
 *
 * Measured, four shapes, all four on the live table:
 *
 *   settings.updated     {blocks: ["contact"], fields: ["contact.phone"]}
 *                        — names only. The rule holds exactly where the spec
 *                          argues for it: the shop's trade-register numbers do
 *                          not go in a table nobody cleans.
 *
 *   product.updated      {fields: [...], before: {...}, after: {...}}
 *                        — **values, both sides**. A product's name and price
 *                          are not secrets and the trail records them.
 *
 *   user.role_changed    {login, from, to, promoted_from_customer}
 *                        — values, and docs/API.md argues for it by name: here
 *                          the value *is* the security fact.
 *
 *   notification.retried {channel, event, dedupe_key: "[redacted]",
 *                         status_from, attempts_before}
 *                        — a value the writer refused to store.
 *
 * So the panel renders what is there rather than a shape it assumed, and the
 * four cases below are the four it can distinguish. A metadata block it does not
 * recognise renders as its own key/value pairs — the trail is the one screen
 * where showing less than arrived is the wrong failure.
 */
export type MetadataShape =
  | { kind: "fields"; fields: string[] }
  | { kind: "change"; fields: string[]; before: Record<string, unknown>; after: Record<string, unknown> }
  | { kind: "transition"; from: string; to: string }
  | { kind: "plain"; entries: [string, string][] };

/** `[redacted]` is what the writer stored, and it is a fact rather than a gap. */
export const REDACTED = "[redacted]";

export function isRedacted(value: unknown): boolean {
  return value === REDACTED;
}

/**
 * One metadata object, classified.
 *
 * Order matters: a `before`/`after` pair is a change even when `fields` is
 * present beside it — `product.updated` carries all three — so the change case
 * is tested first. `from`/`to` is the transition, which `user.role_changed` and
 * `order.status_changed` share.
 */
export function metadataShape(metadata: Record<string, unknown>): MetadataShape {
  const fields = Array.isArray(metadata.fields)
    ? metadata.fields.filter((f): f is string => typeof f === "string")
    : [];

  const before = metadata.before;
  const after = metadata.after;

  if (
    before !== null &&
    typeof before === "object" &&
    !Array.isArray(before) &&
    after !== null &&
    typeof after === "object" &&
    !Array.isArray(after)
  ) {
    return {
      kind: "change",
      fields,
      before: before as Record<string, unknown>,
      after: after as Record<string, unknown>,
    };
  }

  if (typeof metadata.from === "string" && typeof metadata.to === "string") {
    return { kind: "transition", from: metadata.from, to: metadata.to };
  }

  if (fields.length > 0) return { kind: "fields", fields };

  return { kind: "plain", entries: plainEntries(metadata) };
}

/**
 * The remaining keys as printable pairs.
 *
 * Nested objects and arrays are rendered as compact JSON rather than skipped:
 * `cms.homepage_updated` carries a list of section types, and a row that
 * silently dropped it would say a page changed and not what about it. Numbers
 * and booleans become strings here so the renderer has one type to place.
 */
export function plainEntries(metadata: Record<string, unknown>): [string, string][] {
  return Object.entries(metadata).map(([key, value]) => {
    if (typeof value === "string") return [key, value];
    if (typeof value === "number" || typeof value === "boolean") return [key, String(value)];
    if (value === null || value === undefined) return [key, "—"];
    return [key, JSON.stringify(value)];
  });
}

/**
 * Which of a change's fields actually differ.
 *
 * `before` and `after` carry the whole tracked set, not the diff: measured, a
 * `product.updated` that changed a name and a price still carries `status` on
 * both sides with the same value. `fields` names what was *submitted*, which is
 * the more honest list — a save that sent a field unchanged is a save that sent
 * it — so the row leads with `fields` and the pairs are shown against it.
 */
export function changedPairs(
  shape: Extract<MetadataShape, { kind: "change" }>,
): { field: string; before: string; after: string }[] {
  const keys = shape.fields.length > 0 ? shape.fields : Object.keys(shape.after);

  return keys.map((field) => ({
    field,
    before: printable(shape.before[field]),
    after: printable(shape.after[field]),
  }));
}

function printable(value: unknown): string {
  if (typeof value === "string") return value === "" ? "—" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

/* ----------------------------------------------------------------- actor --- */

/**
 * **`actor_login` is on every row, so this screen does not have the inventory
 * ledger's problem.**
 *
 * The stock ledger carries `actor_id: 475` and nothing else, and both routes
 * that could resolve a name are refused to most of the staff who can read it —
 * `movementActor()` documents what the row shows instead. The trail carries the
 * login itself, which is exactly the fix that section asks the backend for, one
 * table over.
 *
 * `actor_id: 0` is the system: a row written by the CLI drain or a migration,
 * where `actor_login` is empty. Rendered as a named state rather than as a blank
 * or as a zero.
 */
export function isSystemActor(row: { actor_id: number; actor_login: string }): boolean {
  return row.actor_id === 0 || row.actor_login.trim() === "";
}

/* ------------------------------------------------------------ pagination --- */

/**
 * 20 a page, and `?per_page=` is capped at 100 with the range in
 * `details.params` — the object shape, not the array one.
 *
 *   ?per_page=500 → 400 {"per_page": "per_page must be between 1 (inclusive)
 *                        and 100 (inclusive)"}
 */
export const PER_PAGE = 20;
