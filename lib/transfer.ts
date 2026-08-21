/**
 * Import and export: the six routes, the two shapes, and the safety property
 * the whole screen is built around.
 *
 * No dependencies, so a client component can import a value from here without
 * pulling Zod into the browser. `lib/api/schemas/transfer.ts` imports this,
 * never the reverse.
 *
 * Measured against the live API on 2026-08-21.
 */

import type { Capability } from "@/lib/capabilities";

/* -------------------------------------------------------------- subjects --- */

/**
 * **Capability follows the resource**, and this is the one section of the branch
 * a caller without `ac_manage_settings` can reach at all.
 *
 * Measured across four credentials:
 *
 *                          super  manager  marketing  support
 *   GET /export/products     200     200      403       403
 *   GET /export/orders       200     200      403       403
 *   GET /export/inventory    200     200      403       403
 *   GET /export/customers    200     200      403       200
 *   POST /import/products    400     400      403       403
 *   POST /import/inventory   400     400      403       403
 *
 * Three fixtures, each proving something different in one session:
 *
 *   **Manager** — 403 on settings, users and audit, 200 on all four exports.
 *   The same credential is the branch's forbidden fixture and its positive one,
 *   which is the strongest arrangement any branch here has had.
 *
 *   **Support Agent** — 403 on three exports and **200 on customers**, because
 *   they hold `ac_manage_customers` and nothing else here. One credential
 *   proving the rule is per-subject rather than per-screen, which no single
 *   403 can show.
 *
 *   **Marketing Manager** — 403 on all six, the flat refusal.
 */
export const EXPORT_SUBJECTS = ["products", "orders", "inventory", "customers"] as const;
export type ExportSubject = (typeof EXPORT_SUBJECTS)[number];

export const IMPORT_SUBJECTS = ["products", "inventory"] as const;
export type ImportSubject = (typeof IMPORT_SUBJECTS)[number];

export function isExportSubject(value: string): value is ExportSubject {
  return (EXPORT_SUBJECTS as readonly string[]).includes(value);
}

export function isImportSubject(value: string): value is ImportSubject {
  return (IMPORT_SUBJECTS as readonly string[]).includes(value);
}

export const SUBJECT_CAPABILITY: Record<ExportSubject, Capability> = {
  products: "ac_manage_products",
  orders: "ac_manage_orders",
  inventory: "ac_manage_inventory",
  customers: "ac_manage_customers",
};

/* --------------------------------------------------------------- exports --- */

/**
 * **An export is a file and must not go through the envelope client.**
 *
 *   Content-Type: text/csv; charset=utf-8
 *   Content-Disposition: attachment; filename="products-export-2026-08-21.csv"
 *   Cache-Control: no-store, private
 *   body: EF BB BF, then the header row, then CRLF-separated records
 *
 * The BOM is Excel's: without it a shop's Arabic product names arrive as
 * mojibake, and a shop whose product export is unreadable while its order export
 * is fine would reasonably conclude the product export is broken. It is passed
 * through untouched.
 *
 * An export **error** still arrives in the envelope with its 4xx, so a client
 * never saves an error message as `products.csv`:
 *
 *   ?limit=999999 → 400 details.params.limit
 *                   "limit must be between 1 (inclusive) and 2000 (inclusive)"
 *
 * Two defects were fixed in `ecom-temp` before this screen could be built, both
 * found here and neither visible from the backend's own tests:
 *
 *   **The body was JSON-encoded.** `FileDownload` marked its responses with
 *   `set_matched_route()`, which WordPress overwrites after the callback
 *   returns, so `rest_pre_serve_request` declined every download and the CSV
 *   went out as one quoted line — the BOM as the six characters `﻿`, every
 *   newline as `\r\n`. Under `text/csv` and `attachment`.
 *
 *   **The product export had no header row.** `toCsv()` called
 *   `get_csv_data()`, which is the rows; `export()` sends
 *   `export_column_headers()` before it. So a 48-column file began
 *   `10,simple,AC-TAP-001,…`.
 */
export const EXPORT_LIMIT_MAX = 2000;

/** `EF BB BF`. Rendered as a fact on the screen, never stripped. */
export const UTF8_BOM = "﻿";

/**
 * **The products export does not round-trip through `/import/products`
 * unedited**, and the screen has to say so rather than imply a loop that does
 * not close.
 *
 * Measured after the header fix: the file parses, every row is read, and every
 * `sku` resolves **empty**. The header carries WooCommerce's *display* labels —
 * `ID`, `SKU`, `GTIN, UPC, EAN, or ISBN` — because that is the file every other
 * WooCommerce tool reads, and the table mapping those onto field names lives in
 * `includes/admin/importers/mappings/`, inside `admin/`, which `WooCsv`
 * deliberately does not load. The same file with a lowercased header previews
 * `updated: 2` with both SKUs resolved, which is the control that proves it is
 * the header and not the rows.
 *
 * The **inventory** export uses our own writer and our own field names and
 * round-trips as it stands. So the screen states it per subject rather than as a
 * general promise.
 */
export const ROUND_TRIPS: Record<ExportSubject, boolean> = {
  products: false,
  orders: false,
  inventory: true,
  customers: false,
};

/**
 * Only two subjects have an importer at all, so `orders` and `customers` are
 * export-only. That is not a gap the panel papers over: an order is created by a
 * checkout and a customer by a registration, and a CSV that invented either
 * would be inventing money and consent.
 */
export function isImportable(subject: ExportSubject): subject is ExportSubject & ImportSubject {
  return (IMPORT_SUBJECTS as readonly string[]).includes(subject);
}

/* --------------------------------------------------------------- imports --- */

/**
 * **The CSV is the raw request body**, with `Content-Type: text/csv`. Not JSON,
 * not multipart — which differs from `/media`, the only other upload in this
 * panel, and ADMIN_PANEL.md says outright it "will be got wrong once".
 *
 *   POST /import/products  Content-Type: application/json
 *   → 400 details.fields.body:
 *     "Content-Type must be text/csv, and the body the file itself — not JSON."
 *
 * So `acWriteRaw()` exists beside `acWrite()` in `lib/api/browser.ts`: every
 * other write in the panel serialises an object, and routing this one through
 * the same function is exactly how the 400 above gets shipped.
 */
export const IMPORT_CONTENT_TYPE = "text/csv";

/**
 * **`dry_run` defaults to true, and that is the safety property.**
 *
 * A client that forgets the flag previews and never writes. The panel makes it
 * visible rather than relying on it: the preview is the screen, and applying is
 * a separate action that names the counts the preview reported. The applied
 * response says which it was, so the confirmation quotes the server rather than
 * what the panel asked for.
 */
export const DRY_RUN_DEFAULT = true;

/**
 * `mode` is products-only, `create` or `update`, and **neither does both**.
 *
 * Measured: with no `mode`, a file naming an existing SKU and a new one answered
 * `created: 1, skipped: 1` — so the default is `create`. The word was chosen
 * over `update_existing: false` because that reads like a modifier and behaves
 * like a switch, and ADMIN_PANEL.md writes both labels out in full for the same
 * reason.
 *
 *   ?mode=nonsense → 400 details.params.mode
 *                    "mode is not one of create and update."
 *
 * Note `details.params`, not `details.fields`: the one-endpoint-two-shapes trap.
 * `lib/api/browser.ts` reads both.
 */
export const IMPORT_MODES = ["create", "update"] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const DEFAULT_MODE: ImportMode = "create";

/**
 * The inventory import takes no `mode`. It only ever updates — *"Not found. An
 * inventory import never creates products."* — so offering the control there
 * would be offering a choice the route does not have.
 */
export function hasMode(subject: ImportSubject): boolean {
  return subject === "products";
}

/* ------------------------------------------------------------ the report --- */

/**
 * **A preview row's shape depends on the subject *and* on whether it was a dry
 * run**, which is four shapes on one key. Measured, verbatim:
 *
 *   products, dry     {line, action, sku, name, reason?}
 *   products, applied {line, action, product_id} / {line, action, reason}
 *   inventory, dry    {line, action, sku, product_id, from, to}
 *   inventory, applied{line, action, sku, product_id, from, to, reason?}
 *
 * Only `line` and `action` are on all four. Everything else is optional in the
 * schema for that reason, and the row renders what it has — a preview table with
 * a fixed column set would show four empty columns on a products apply.
 *
 * The applied products preview also repeats `line: 2` for both rows, which is
 * WooCommerce's importer reporting rather than a panel defect. The row is keyed
 * by index, never by line.
 */
export const PREVIEW_ALWAYS = ["line", "action"] as const;

/**
 * The four outcomes a row can have. `failed` is not one of them — a row that
 * failed appears in `errors[]` with its own message and field map, not in
 * `preview[]`.
 */
export const ROW_ACTIONS = ["created", "updated", "skipped"] as const;
export type RowAction = (typeof ROW_ACTIONS)[number];

export const ROW_TONE: Record<string, "success" | "info" | "neutral"> = {
  created: "success",
  updated: "info",
  skipped: "neutral",
};

/**
 * Whether applying this report would **write anything**.
 *
 * `created + updated`, and deliberately not "nothing happened": a preview
 * reporting `skipped: 40` is a successful request and a useless import, and one
 * reporting `failed: 40` is a file that needs fixing — but both would write
 * exactly nothing, and both look identical to a screen that only says "200".
 *
 * `failed` is **not** part of the test, which is the correction worth writing
 * down: an earlier version required it to be zero, so a preview where every row
 * failed reported "this would do work" and offered an Apply button that could
 * only fail again. The e2e caught it against a file naming a SKU that does not
 * exist, which is the commonest way an import goes wrong.
 */
export function reportIsNoOp(report: { created: number; updated: number }): boolean {
  return report.created === 0 && report.updated === 0;
}

/**
 * **`preview_only` is English prose from the API and is never rendered.**
 *
 *   "WooCommerce's product importer has no dry-run mode. This parsed the file
 *    with its own parser and looked each SKU up; it does not guarantee every
 *    write will succeed."
 *
 * It is present on a **products dry run only** — not on an inventory dry run,
 * where our own importer really does rehearse, and not on either apply. So its
 * presence is the signal and its text is not: the panel renders its own
 * translated sentence beside it and drops the string, which is the analytics
 * branch's rule about `unavailable` and `unattributed.reason` arriving in one
 * language for a panel that speaks two.
 */
export function previewIsNotARehearsal(report: { preview_only?: string }): boolean {
  return typeof report.preview_only === "string" && report.preview_only !== "";
}

/**
 * A row that could not be read, with the fields that were wrong.
 *
 *   {line: 3, message: "The row is invalid.",
 *    fields: {"stock_quantity": "Required."}}
 *
 * `message` is the generic half and `fields` is the useful half — the same split
 * `details.fields` has everywhere else in this API — so the row leads with the
 * field names and their sentences, and the message is the fallback for an error
 * carrying no fields.
 */
export function errorFields(error: { fields?: Record<string, string> }): [string, string][] {
  return Object.entries(error.fields ?? {});
}

/**
 * The file-level refusals, which are not row errors and do not belong in the
 * same list.
 *
 *   empty body        400 details.fields.file  "A CSV with a header row is required."
 *   no `sku` column   400 details.fields.file  "Missing: sku."
 *                         details.columns_found / columns_required
 *   JSON body         400 details.fields.body  "Content-Type must be text/csv…"
 *
 * `columns_found` is the one that turns a mystery into an answer: it lists what
 * the reader actually saw on line 1, so somebody who exported a file with no
 * header sees their own product name where a column name should be. The panel
 * renders it.
 */
export function missingColumns(details: Record<string, unknown>): {
  found: string[];
  required: string[];
} | null {
  const found = details.columns_found;
  const required = details.columns_required;

  if (!Array.isArray(found) || !Array.isArray(required)) return null;

  return {
    found: found.map(String),
    required: required.map(String),
  };
}
