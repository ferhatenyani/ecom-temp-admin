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

export declare function respond(
  method: string,
  pathname: string,
  searchParams?: URLSearchParams,
): MockResponse;

/** Every request the *server* handled, as `"GET /path"`. Empty until one runs. */
export declare const requestLog: string[];

export declare function stats(): { count: number; paths: Record<string, number> };

export declare function createServer(): Server;

export declare function startServer(port?: number): Promise<Server>;
