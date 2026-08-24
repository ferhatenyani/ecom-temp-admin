/**
 * CSV, for the selection exports the list screens build client-side.
 *
 * Each screen owns its own column list — that is editorial and belongs beside the
 * columns it mirrors — but the quoting and the download are mechanical and were
 * written twice before this file existed. A second copy of a CSV writer is how
 * one of them quietly stops quoting a field.
 *
 * **Why a screen builds a CSV at all, when `/api/export/{subject}` exists.** That
 * route is the right thing for "export everything": the browser navigates to it,
 * the server attaches the Application Password, and the credential never enters
 * the document. But it forwards **only** `limit` and drops every other query
 * parameter, deliberately — its docblock records that the export routes sit off
 * the proxy allowlist and that relaying an arbitrary query string would make the
 * route a wider surface than the screen it serves. There is no way to ask it for
 * a specific set of ids, and widening a deliberately narrow security boundary to
 * save a convenience is the wrong trade. So a *selection* export is built from
 * rows already in memory: no request, no credential, and exactly the data the
 * person is looking at.
 */

/**
 * RFC 4180 quoting. Every field is quoted unconditionally rather than
 * conditionally — conditional quoting is where CSV writers get it wrong, and an
 * always-quoted field is valid for every value including empty ones.
 *
 * The doubled quote is the escape: `He said "hi"` becomes `"He said ""hi"""`.
 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Rows into a document.
 *
 * CRLF, because RFC 4180 says so and because Excel on Windows is the
 * overwhelmingly likely consumer here.
 */
export function csvDocument(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join(",")).join("\r\n");
}

/**
 * Hand the file to the browser.
 *
 * The BOM is not decoration: without it Excel reads a UTF-8 CSV as the system
 * codepage, and every Arabic name and every accented French one arrives as
 * mojibake. The server export route prepends the same bytes for the same reason.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  /* Revoked on the next frame rather than synchronously — Safari has been
     observed to cancel an in-flight download when the object URL is released
     in the same tick as the click. */
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
