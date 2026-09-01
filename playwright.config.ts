import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile first, both locales, both directions.
 *
 * On the device set, because "390 × 844" from the specification needs one piece of
 * context: measured against Playwright 1.62.1's descriptors, **390 is the
 * narrowest width still shipping**, not the typical one. The current lineup is
 *
 *   390  iPhone 16e, 17e          ← the design floor
 *   393  iPhone 16
 *   402  iPhone 17, 17 Pro        ← today's mainstream
 *   420  iPhone Air
 *   430  iPhone 16 Plus
 *   440  iPhone 17 Pro Max        ← the widest
 *
 * So 390 stays the width every screen is drawn at — it is where things break, and
 * designing there is what keeps the layout honest — but it is a floor to clear,
 * not a target to hit. `phone` runs the mainstream width and `phone-min` /
 * `phone-max` bracket it.
 *
 * The runnable projects are Chromium at those viewports, and that is a compromise
 * worth naming rather than hiding: iOS Safari is what this panel actually runs on,
 * and the two engines disagree about exactly the things this design leans on —
 * `backdrop-filter`, `env(safe-area-inset-*)` and bidi isolation. WebKit's binary
 * installs fine, but its system libraries (libwebp, libavif, libharfbuzz-icu, …)
 * need root — 231 apt packages, and no passwordless sudo here. So `phone-webkit`
 * is a real project, kept unlisted in the default run so the stage stays green on
 * a machine without them, for anyone who can do:
 *
 *   sudo env "PATH=$PATH" npx playwright install-deps webkit
 *   npx playwright test --project=phone-webkit
 *
 * (`sudo npx` alone fails when node came from nvm: it lives under $HOME, which
 * sudo's secure_path drops.)
 *
 * Run 2026-08-18 on WebKit 26.0: 34/34. `backdrop-filter`, the safe-area insets
 * and the bidi isolation all hold. It found one real difference — WebKit hydrates
 * slowly enough that a keystroke can land on server-rendered HTML and never reach
 * React; see the retry at the end of `products.spec.ts`'s save test.
 *
 * The suite needs real staff credentials, because the per-user Application
 * Password decision leaves no service account to fall back on — and two of them,
 * since several tests exist to prove a Super Admin and a Support Agent are treated
 * differently. `scripts/test.sh` mints both.
 */
export default defineConfig({
  testDir: "./e2e",
  /**
   * 60 s, not Playwright's 30 s, and the reason is the run mode this suite is
   * required to use.
   *
   * `scripts/test.sh` refuses to run unless the panel answers at `PANEL_BASE`,
   * and its message names `npm run dev` — so every run compiles routes on first
   * visit. Measured on the first full execution: a page whose route had not been
   * compiled yet took **12.3 s** to answer (`GET /fr/inventory/20 200 in 12.3s
   * (next.js: 10.8s)`), and a test that visits three such routes spends most of
   * its budget on the bundler rather than on the panel.
   *
   * That produced failures indistinguishable from defects. Nine tests across
   * `inventory`, `analytics` and `products` timed out in a full run and **passed
   * in isolation** — the same assertions, the same fixtures, a warm route. The
   * honest reading is that the budget was wrong, not that the panel was slow:
   * against a production build these finish in a fifth of the time.
   *
   * A production build is the better answer and is not available here — `npm run
   * build` is OOM-killed on this machine, which has 2.2 GB free. So the budget is
   * raised to cover the compile, and this note is what stops it being read as a
   * flaky-test allowance. **It buys time for the bundler and nothing else**: no
   * assertion waits longer for the panel, because each `expect` keeps its own
   * (much shorter) timeout.
   */
  timeout: 60_000,
  // The suite provokes a refusal on purpose, and the failed-login bucket then
  // refuses correct credentials too. Cleared once before anything runs, and again
  // by the test that spends it. See e2e/rate-limit.ts.
  globalSetup: "./e2e/rate-limit.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  testMatch: /.*\.spec\.ts/,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PANEL_BASE ?? "http://localhost:3001",
    trace: "retain-on-failure",
  },
  projects: [
    {
      // Today's mainstream iPhone width.
      name: "phone",
      use: phone("iPhone 17 Pro"),
    },
    {
      // The floor: the narrowest width Apple still sells. Every screen is drawn
      // here first, because this is where a layout breaks.
      name: "phone-min",
      use: phone("iPhone 17e"),
    },
    {
      // The other end, where a capped content column has to stay centred.
      name: "phone-max",
      use: phone("iPhone 17 Pro Max"),
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // The real engine. Needs `sudo npx playwright install-deps webkit` first.
      name: "phone-webkit",
      use: { ...devices["iPhone 17 Pro"] },
    },
  ],
});

/**
 * A device descriptor carries an engine as well as a geometry. This keeps the
 * viewport, scale factor and touch behaviour and drops the engine and user agent,
 * so the width being tested is not coupled to a browser that may not be installed.
 */
function phone(model: string) {
  const descriptor = devices[model];
  if (!descriptor) throw new Error(`Unknown Playwright device: ${model}`);
  const { defaultBrowserType, userAgent, ...geometry } = descriptor;
  void defaultBrowserType;
  void userAgent;
  return { ...geometry, isMobile: false };
}
