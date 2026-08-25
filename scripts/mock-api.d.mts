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
 * `body` is the parsed JSON of a write, or null. Typed as `unknown` for the same
 * reason the response body is: the mock validates it the way the API does, and a
 * hand-written request type here would be a second copy of that contract.
 */
export declare function respond(
  method: string,
  pathname: string,
  searchParams?: URLSearchParams,
  body?: unknown,
): MockResponse;

/**
 * Rebuild every mutable thing — order statuses, COD records, parcels, payments,
 * the products a PATCH or a DELETE has rewritten, the coupons a POST, a PATCH or
 * either delete has, and the shipping rules a POST, a PATCH or a DELETE has —
 * from the seeded baseline. Runs once at module load; the unit suite calls it
 * between tests so a write in one cannot be read by another.
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
