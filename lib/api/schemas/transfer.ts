import { z } from "zod";

/**
 * `POST /import/{products,inventory}`, measured against the live API on
 * 2026-08-21.
 *
 * There is no schema for an export: an export is a **file**, not an envelope,
 * and it never reaches this layer — `app/api/export/[subject]/route.ts` streams
 * the bytes through with the credential server-side. The only export response
 * this panel parses is an *error*, which arrives in the ordinary envelope and is
 * handled by the ordinary reader.
 */

/**
 * One row of the preview, and **its shape depends on the subject and on whether
 * it was a dry run**. Four shapes on one key, measured verbatim:
 *
 *   products, dry      {line, action, sku, name, reason?}
 *   products, applied  {line, action, product_id} / {line, action, reason}
 *   inventory, dry     {line, action, sku, product_id, from, to}
 *   inventory, applied {line, action, sku, product_id, from, to, reason?}
 *
 * Only `line` and `action` are on all four, so only those two are required. A
 * schema that demanded `sku` would fail the parse on a products apply — the one
 * request an operator makes after reading a preview they trusted.
 *
 * `from` and `to` are nullable as well as optional: an untracked product has
 * `null` stock, and `null` is not `0` here any more than it is on the inventory
 * screen.
 */
export const previewRow = z.looseObject({
  /**
   * 1-based over the file including its header, so the first data row is 2.
   *
   * **Not unique.** WooCommerce's importer reports `line: 2` for every row of an
   * applied products run, measured on a two-row file. So the table keys by index
   * and renders the line as a label, never as an identity.
   */
  line: z.number(),
  action: z.string(),
  sku: z.string().optional(),
  name: z.string().optional(),
  product_id: z.number().optional(),
  from: z.number().nullable().optional(),
  to: z.number().nullable().optional(),
  /** English, from the API — `"a product with that SKU already exists"`. */
  reason: z.string().optional(),
});
export type PreviewRow = z.infer<typeof previewRow>;

/**
 * A row that could not be read.
 *
 * `message` is the generic half and `fields` the useful one — the same split
 * `details.fields` has everywhere else in this API. `fields` is optional because
 * a row can fail for a reason that is not about one column.
 */
export const importError = z.looseObject({
  line: z.number(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type ImportError = z.infer<typeof importError>;

/**
 * The report, from both a dry run and an apply.
 *
 * **`dry_run` is echoed**, and the panel renders the server's answer rather than
 * what it asked for. That is the whole safety property made visible: the flag
 * defaults to true, so a request that lost the parameter previews, and a
 * confirmation reading "applied" over a response saying `dry_run: true` would be
 * the panel lying about a write that never happened.
 *
 * `errors` and `preview` are always present, `[]` when empty — verified on a
 * clean run rather than assumed, because code that destructured a missing
 * `preview` would throw on the healthy case, which is what `meta.problems` did
 * on the homepage document.
 */
export const importReport = z.looseObject({
  dry_run: z.boolean(),
  rows: z.number(),
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  failed: z.number(),
  errors: z.array(importError),
  preview: z.array(previewRow),
  /**
   * **Present on a products dry run only**, and never rendered.
   *
   * English prose from the API explaining that WooCommerce's importer has no
   * dry-run mode. Its *presence* is the signal — an inventory dry run really
   * does rehearse and carries no such key — and the panel renders its own
   * translated sentence beside it. The analytics branch's rule: the API's
   * English must not reach an Arabic screen.
   */
  preview_only: z.string().optional(),
});
export type ImportReport = z.infer<typeof importReport>;

/**
 * `details` on the file-level refusal for a missing column.
 *
 *   400 "The file is missing required columns."
 *   details: {fields: {file: "Missing: sku."},
 *             columns_found: ["10", "simple", "ac-tap-001", …],
 *             columns_required: ["sku"]}
 *
 * `columns_found` is the key that turns a mystery into an answer: it lists what
 * the reader saw on line 1, so somebody who uploaded a file with no header sees
 * their own product name where a column name should be. It sits **beside**
 * `fields` rather than inside it, so a form binding only to `fields` throws it
 * away — which is exactly what happened to the products export before the
 * backend grew a header row.
 */
export const missingColumnsDetails = z.looseObject({
  fields: z.record(z.string(), z.string()),
  columns_found: z.array(z.string()),
  columns_required: z.array(z.string()),
});
