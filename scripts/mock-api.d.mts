/**
 * Types for `scripts/mock-api.mjs`.
 *
 * The mock is plain ESM with no build step — it has to be runnable as
 * `node scripts/mock-api.mjs` with zero dependencies — but `tests/mock-api.test.ts`
 * is type-checked like everything else, and importing an untyped `.mjs` from
 * TypeScript otherwise lands on `any`. TypeScript substitutes `.mjs → .d.mts` on
 * a relative import, so this file is found without a `paths` entry, an
 * `allowJs` inference pass or a single `@ts-ignore`.
 *
 * `respond` is typed as returning `unknown` for the body on purpose: the test's
 * whole job is to hand that to the panel's real Zod schemas, and a hand-written
 * body type here would be a second, unverified copy of the contract — the exact
 * thing the test exists to prevent.
 */
import type { Server } from "node:http";

export declare const BASE_PATH: string;

export type MockResponse = { status: number; body: unknown };

/**
 * `body` is the parsed JSON of a write, the parsed multipart of an upload, or
 * null. Typed as `unknown` for the same reason the response body is: the mock
 * validates it the way the API does, and a hand-written request type here would
 * be a second copy of that contract.
 */
export declare function respond(
  method: string,
  pathname: string,
  searchParams?: URLSearchParams,
  body?: unknown,
): MockResponse;

/**
 * `multipart/form-data` → the `body` argument `respond()` takes for an upload.
 *
 * `POST /media` is the only multipart request the panel makes. This is exported
 * so the unit suite can build a **real** multipart buffer and parse it rather
 * than hand-writing the object the parser produces — a hand-written one would be
 * a second copy of the boundary the panel's `FormData` actually crosses, and the
 * parser itself would go untested.
 *
 * Returns `null` when the content type carries no boundary.
 */
export declare function parseMultipart(buffer: Buffer, contentType: string): unknown;

/**
 * Rebuild every mutable thing — order statuses, COD records, parcels, payments,
 * the products a PATCH or a DELETE has rewritten, the coupons a POST, a PATCH or
 * either delete has, the shipping rules a POST, a PATCH or a DELETE has, and the
 * content a write has touched: pages, the homepage document, banners, FAQs, FAQ
 * categories and the two menus — from the seeded baseline. Runs once at module
 * load; the unit suite calls it between tests so a write in one cannot be read by
 * another.
 *
 * **Media joined on the media branch and it clears bytes as well as rows.** An
 * upload writes an attachment *and* the file `/wp-content/uploads/…` answers
 * with, so both go — otherwise the second test to upload `tapis.jpg` would be
 * handed `tapis-1.jpg` by this file's `wp_unique_filename()` counterpart, and the
 * measured collision trio would stop meaning what it says.
 *
 * **Content is where this matters most on the read side, not the write side.**
 * `GET /cms/homepage` carries `meta.problems` only while the stored document
 * still holds the three malformed sections the seed put there — and a successful
 * `PUT` *repairs* the document by discarding them, which is the whole reason the
 * editor gates its save behind a confirmation. So the first test to save the
 * homepage would otherwise leave every later one reading a healthy document with
 * no `meta` at all, and the drop report would be untestable after the first
 * assertion that touched it.
 *
 * **Payments are rebuilt but nothing writes them**, and the asymmetry is worth
 * knowing rather than discovering: the collection is 45 seeded rows, the only
 * write on it is `POST /payments/{id}/verify`, and verify asks the provider a
 * question and stores nothing — so a second verify is byte-identical to the
 * first and this call restores a baseline no test can have moved. That is the
 * API's own shape and not a shortcut: there is no `PATCH` on a transaction
 * anywhere in the surface.
 *
 * Coupons and shipping rules are the two collections where a *create* is undone
 * by this, which is what keeps `nextCouponId` and `nextRuleId` handing out the
 * same ids in every process and a screenshot of a created row byte-stable.
 *
 * Parcels are rebuilt too, and that matters more here than it reads: the fixture
 * holds exactly **one live shipment**, and cancelling or delivering it is what
 * makes the status picker, the cancel button and the sync refusal reachable at
 * all. Without the rebuild, the first test to finish that parcel would leave
 * every later one with the all-terminal shop the API actually has.
 */
export declare function resetState(): void;

/** Every request the *server* handled, as `"GET /path"`. Empty until one runs. */
export declare const requestLog: string[];

export declare function stats(): { count: number; paths: Record<string, number> };

export declare function createServer(): Server;

export declare function startServer(port?: number): Promise<Server>;
