import { execFileSync } from "node:child_process";

/**
 * Clearing the API's failed-login bucket, from inside the suite.
 *
 * The suite deliberately provokes a refusal, and the bucket is 10 failures per 15
 * minutes per IP — after which a **correct** credential is refused too. So the
 * reset runs once before everything and again immediately after the test that
 * spends the allowance, or the tests that follow fail in a way indistinguishable
 * from a broken login.
 *
 * A missing script or a stopped stack is reported and swallowed: this is
 * housekeeping, and turning a failed cleanup into a failed assertion would hide
 * whatever the suite was actually testing.
 */
export function resetRateLimit(): void {
  try {
    execFileSync("./scripts/reset-rate-limit.sh", { stdio: "pipe", timeout: 60_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`could not clear the rate-limit counters: ${message}`);
  }
}

/** Playwright's `globalSetup` entry point. */
export default function globalSetup(): void {
  resetRateLimit();
}
