/**
 * The rendering harness: a real browser, a real Next server, a fake shop.
 *
 *   node scripts/capture.mjs /orders /products
 *   node scripts/capture.mjs --all
 *   npm run test:harness -- /orders
 *   MOCK_IDENTITY=reduced node scripts/capture.mjs /orders/1023
 *
 * **The last line is how a forbidden state gets captured.** The mock's default
 * identity holds all thirteen capabilities, which is what a harness whose job is
 * to render screens needs and is also why no screen could be captured in the
 * forbidden state DESIGN.md §3.7 requires of every one of them. `MOCK_IDENTITY`
 * is read by `scripts/mock-api.mjs` at module load — so it is a whole run, not a
 * per-capture switch — and `reduced` drops `ac_manage_shipping` and
 * `ac_manage_payments`, which is what makes the order detail's parcels and
 * payments sections absent rather than empty. Its screenshots land beside the
 * default run's with an `-reduced` suffix, so capture one run then the other and
 * compare the pair in the same folder.
 *
 * **Why this exists.** The e2e suite needs live shop credentials nobody has in
 * this environment, and a passing `next build` is not evidence that anything
 * renders — it once passed with a completely broken stylesheet, off a stale
 * `.next`. A build checks that the code compiles. This checks that a screen
 * appears, in two locales, two themes and three widths, without a single console
 * error and without pushing the document past its own viewport.
 *
 * It owns the whole lifecycle: it mints a session cookie the way the panel
 * would, starts `scripts/mock-api.mjs`, starts the built Next server pointed at
 * it, drives Chromium through every combination, and tears all of it down on
 * success, on failure and on Ctrl-C.
 *
 * **The last assertion is the one that makes the rest mean anything.** After
 * every capture it asks the mock how many requests it served. Zero means the
 * panel was talking to something else — most likely the real `AC_API_BASE` out
 * of `.env.local` — and every screenshot above it is a screenshot of an error
 * state that happened to have an `h1`. That is a failure, loudly, with that
 * explanation.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EncryptJWT } from "jose";
import { chromium } from "playwright";
import { BASE_PATH, startServer } from "./mock-api.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 3099 rather than 3001, so a running dev server is never in the way. */
const HARNESS_PORT = Number(process.env.HARNESS_PORT ?? 3099);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8099);
const PANEL = `http://127.0.0.1:${HARNESS_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

const OUT = resolve(ROOT, ".impeccable/harness");

/**
 * A reduced-identity run writes **beside** the default one rather than over it:
 * same route directory, an `-<identity>` suffix on the file. The whole point of
 * capturing a forbidden state is to hold it against the permitted one, and a run
 * that overwrote the first would leave nothing to compare.
 *
 * A suffix rather than a directory of its own, because `.gitignore` covers
 * `.impeccable/harness/` and a sibling directory would arrive untracked.
 */
const IDENTITY = process.env.MOCK_IDENTITY ?? "full";
const SUFFIX = IDENTITY === "full" ? "" : `-${IDENTITY}`;

/**
 * 340 is below the narrowest phone Apple ships and is deliberately the floor:
 * the widths that break are the ones nobody designs at. 768 is the tablet
 * breakpoint and 1440 is where the sidebar is persistent.
 */
const WIDTHS = [340, 768, 1440];
const THEMES = ["light", "dark"];
const LOCALES = ["fr", "ar"];

/**
 * What `--all` means: the screens the mock's endpoints can actually serve.
 *
 * `/orders/1023` is the one detail here, and the id is not arbitrary. It is the
 * richest order in the fixture shop — three line items all carrying the
 * 60-character SKU, a customer whose name is Arabic with a Latin order number
 * inside it, a customer note, three order notes, a seven-entry timeline, a
 * confirmed COD record, a finished parcel from a provider `/shipping/providers`
 * does not list, and two payments in two states. Every section of the detail has
 * something in it, which is what makes one capture worth taking.
 */
const DEFAULT_ROUTES = [
  "/orders",
  "/orders/1023",
  "/products",
  "/customers",
  "/inventory",
  "/coupons",
];

/* -------------------------------------------------------------- the cookie --- */

/**
 * `.env.local` is parsed rather than imported, because pulling in dotenv to read
 * one key would add a dependency to a script whose whole point is to need
 * nothing, and because this file must never write to it.
 */
function envLocal(key) {
  const path = resolve(ROOT, ".env.local");
  if (!existsSync(path)) die(`No .env.local. ${key} is needed to mint a session cookie.`);

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] === key) return match[2].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

/**
 * The seal, reproduced exactly as lib/session/seal.ts derives it: sha256 of the
 * secret for the 32 bytes A256GCM needs, `dir` + `A256GCM`, and the payload
 * `sessionPayload` validates. The credential itself is never checked — the mock
 * answers everything — so the username and password are only there because the
 * schema requires a non-empty string.
 */
async function mintSession(secret) {
  const key = new Uint8Array(createHash("sha256").update(secret, "utf8").digest());
  return new EncryptJWT({ username: "harness", password: "harness", userId: 514 })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${12 * 60 * 60}s`)
    .encrypt(key);
}

/* ------------------------------------------------------------- the servers --- */

function die(message) {
  console.error(`capture: ${message}`);
  process.exit(2);
}

/**
 * `next start` serves what `next build` produced and nothing else, so a missing
 * or stale `.next` is the failure this harness was written after. Say which
 * command fixes it rather than letting the reader decode a connection refusal.
 */
function requireBuild() {
  const build = resolve(ROOT, ".next/BUILD_ID");
  if (!existsSync(build)) {
    die("no .next build found — run `npm run build` first, then re-run this.");
  }
  return readFileSync(build, "utf8").trim();
}

function startPanel() {
  const child = spawn(
    process.execPath,
    [resolve(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(HARNESS_PORT)],
    {
      cwd: ROOT,
      // `@next/env` will load .env.local too, but it never overwrites a variable
      // that is already set — so these two win, and the mock-stats assertion at
      // the end is what proves it rather than trusting it.
      env: {
        ...process.env,
        AC_API_BASE: `${MOCK}${BASE_PATH}`,
        SESSION_SECRET: process.env.SESSION_SECRET,
      },
      // Its own process group, so teardown takes the whole tree down with it.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const log = [];
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));
  return { child, log };
}

async function waitForPanel(log) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${PANEL}/fr/login`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // Not up yet. `next start` takes a second or two.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  die(`the panel never answered on ${PANEL}. Its output:\n${log.join("")}`);
}

/* --------------------------------------------------------------- captures --- */

const slugOf = (route) => route.replace(/^\//, "").replace(/\//g, "-") || "root";

/**
 * One capture: one route at one width, theme and locale.
 *
 * The screenshot is taken *before* the assertions run, on purpose — a failing
 * capture is exactly the one somebody wants to look at, and asserting first
 * would leave nothing on disk for the failure that matters most.
 */
async function capture(browser, cookie, route, width, theme, locale) {
  const label = `${slugOf(route)} ${width}-${theme}-${locale}`;
  const problems = [];
  const exempted = new Set();

  const context = await browser.newContext({
    viewport: { width, height: 900 },
    locale,
    // The panel resolves the theme on the server from this cookie — there is no
    // blocking script and nothing to hydrate — so it must be set on the context
    // rather than toggled after paint. `system` is the *absence* of the cookie,
    // which is why only the two explicit values are captured.
    deviceScaleFactor: 1,
  });
  await context.addCookies([
    { name: "ac_admin_session", value: cookie, url: PANEL },
    { name: "ac-theme", value: theme, url: PANEL },
  ]);

  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const url = request.url();
    const reason = request.failure()?.errorText ?? "?";

    // Only hosts this script started are ours to be responsible for. Anything
    // else is exempted and printed, because a silent exemption is how a broken
    // font or a leaked CDN call survives a green run.
    if (!url.startsWith(PANEL) && !url.startsWith(MOCK)) {
      exempted.add(`${url} (${reason})`);
      return;
    }

    /*
     * The one exemption on our own host, and it is narrow on purpose.
     *
     * Next's `<Link>` prefetches every nav target in the viewport as an RSC
     * payload and its scheduler then cancels the ones it no longer wants —
     * `net::ERR_ABORTED`, which is the browser saying *the page changed its
     * mind*, not the server refusing. Measured here: zero of these below `lg`
     * and twenty per capture at 1440, exactly tracking whether `AppShell`
     * renders the sidebar expanded or as a closed drawer. Nothing about the
     * screen is wrong in the second case.
     *
     * So an abort **of an RSC prefetch** is exempted and printed. An abort of
     * anything else, and every other failure reason on this host, still fails —
     * a 404 on a stylesheet must not slip through the same hole.
     */
    if (reason === "net::ERR_ABORTED" && url.includes("_rsc=")) {
      exempted.add(`${url.replace(/\?_rsc=.*$/, "?_rsc=…")} (cancelled Link prefetch)`);
      return;
    }

    problems.push(`requestfailed: ${url} (${reason})`);
  });

  try {
    await page.goto(`${PANEL}/${locale}${route}`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    // Let the web font swap land, so a capture is not of a half-painted state.
    await page.waitForTimeout(400);

    const dir = resolve(OUT, slugOf(route));
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${width}-${theme}-${locale}${SUFFIX}.png`);
    await page.screenshot({ path: file, fullPage: true });

    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      dir: document.documentElement.getAttribute("dir"),
      theme: document.documentElement.getAttribute("data-theme"),
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      /* The computed value, not the declared one. A stylesheet that 404s leaves
         every custom property unresolved and the body transparent, which is
         exactly the state a previous session shipped past a green build. */
      background: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(document.body).fontFamily,
    }));

    if (measured.scrollWidth !== measured.clientWidth) {
      problems.push(
        `overflow: scrollWidth ${measured.scrollWidth} ≠ clientWidth ${measured.clientWidth}`,
      );
    }
    if (measured.h1 === null) problems.push("no <h1> on the page");
    else if (measured.h1 === "") problems.push("<h1> is empty");

    const expectedDir = locale === "ar" ? "rtl" : "ltr";
    if (measured.dir !== expectedDir) {
      problems.push(`dir is ${measured.dir ?? "unset"}, expected ${expectedDir}`);
    }

    /*
     * Three assertions about the stylesheet, and they exist because the failure
     * this harness was written after was a *styling* failure that a build, a
     * type-check and a lint all waved through.
     *
     * 1. The theme the cookie asked for is the theme the server stamped. A
     *    missing attribute means the cookie never arrived and the "dark"
     *    screenshot is a light one.
     * 2. The body has an opaque background. `rgba(0, 0, 0, 0)` is what a
     *    document with no stylesheet computes, and it is indistinguishable from
     *    a working light theme in a thumbnail.
     * 3. Plex actually resolved. A fallback family means the self-hosted woff2
     *    404'd, which no other check in this repo would notice.
     */
    if (measured.theme !== theme) {
      problems.push(`data-theme is ${measured.theme ?? "unset"}, expected ${theme}`);
    }
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(measured.background)) {
      problems.push(
        `body background is ${measured.background} — the stylesheet did not load`,
      );
    }
    if (!measured.font.includes("Plex")) {
      problems.push(`body font is ${measured.font}, expected a Plex face`);
    }

    return {
      label,
      file,
      problems,
      exempted: [...exempted],
      key: `${slugOf(route)}/${width}/${locale}`,
      theme,
      background: measured.background,
    };
  } catch (error) {
    problems.push(`navigation: ${error instanceof Error ? error.message : String(error)}`);
    return { label, file: null, problems, exempted: [...exempted] };
  } finally {
    await context.close();
  }
}

/* ------------------------------------------------------------------- main --- */

const args = process.argv.slice(2);
const routes = args.includes("--all") ? DEFAULT_ROUTES : args.filter((a) => a.startsWith("/"));

if (routes.length === 0) {
  die("usage: node scripts/capture.mjs /orders [/products …]   (or --all)");
}

const buildId = requireBuild();

const secret = envLocal("SESSION_SECRET");
if (!secret || secret.length < 32) {
  die("SESSION_SECRET in .env.local must be at least 32 characters — seal.ts refuses less.");
}
process.env.SESSION_SECRET = secret;

let mock = null;
let panel = null;
let browser = null;
let torn = false;

async function teardown() {
  if (torn) return;
  torn = true;
  if (browser) await browser.close().catch(() => {});
  if (panel?.child.pid) {
    // Negative pid: the whole process group, because `next start` is not alone.
    try {
      process.kill(-panel.child.pid, "SIGTERM");
    } catch {
      panel.child.kill("SIGTERM");
    }
  }
  if (mock) await new Promise((r) => mock.close(r));
}

process.on("SIGINT", async () => {
  await teardown();
  process.exit(130);
});

const results = [];
let exitCode = 0;

try {
  mock = await startServer(MOCK_PORT);
  panel = startPanel();
  await waitForPanel(panel.log);

  const cookie = await mintSession(secret);
  browser = await chromium.launch();

  console.log(
    `capture: build ${buildId}, panel ${PANEL}, mock ${MOCK}${BASE_PATH}, identity ${IDENTITY}\n` +
      `capture: ${routes.length} route(s) × ${WIDTHS.length} widths × ${THEMES.length} themes ×` +
      ` ${LOCALES.length} locales = ${routes.length * WIDTHS.length * THEMES.length * LOCALES.length} captures\n`,
  );

  for (const route of routes) {
    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        for (const locale of LOCALES) {
          const result = await capture(browser, cookie, route, width, theme, locale);
          results.push(result);
          const status = result.problems.length === 0 ? "ok  " : "FAIL";
          console.log(`  ${status}  ${result.label}`);
          for (const problem of result.problems) console.log(`          ${problem}`);
        }
      }
    }
  }

  /**
   * The proof that the twelve screenshots above are of the panel reading this
   * mock, and not of a panel that quietly reached for the real shop and rendered
   * an error state with a heading on it.
   */
  const served = await fetch(`${MOCK}/__mock/stats`).then((r) => r.json());
  console.log(`\ncapture: the mock served ${served.count} request(s)`);
  if (served.count === 0) {
    console.error(
      "\ncapture: FAIL — the mock received zero requests. The panel was talking to\n" +
        "something else (most likely AC_API_BASE from .env.local), so every screenshot\n" +
        "above is a screenshot of an error state, whatever it looks like.",
    );
    exitCode = 1;
  } else {
    const top = Object.entries(served.paths)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    for (const [path, count] of top) console.log(`         ${String(count).padStart(4)}  ${path}`);
  }

  /**
   * The cross-capture assertion the per-capture ones cannot make: light and dark
   * must actually differ.
   *
   * Each of them alone only proves *a* background computed. A `tokens.css` whose
   * dark block stopped matching — a renamed selector, a media query with no
   * `[data-theme]` twin — leaves both themes rendering the light palette, every
   * capture opaque, every assertion above green, and the dark screenshots wrong.
   * Comparing the pair is what catches it.
   */
  const pairs = new Map();
  for (const result of results) {
    if (!result.key) continue;
    const pair = pairs.get(result.key) ?? {};
    pair[result.theme] = result.background;
    pairs.set(result.key, pair);
  }
  const identical = [...pairs].filter(([, p]) => p.light && p.light === p.dark);
  if (identical.length > 0) {
    console.error(
      `\ncapture: FAIL — light and dark computed the same body background on` +
        ` ${identical.length} capture pair(s). The dark palette is not being applied:`,
    );
    for (const [key, pair] of identical) console.error(`         ${key}  both ${pair.light}`);
    exitCode = 1;
  }

  const exempted = new Set(results.flatMap((r) => r.exempted));
  if (exempted.size > 0) {
    console.log(
      "\ncapture: failed requests exempted — a host this script did not start," +
        "\n         or a Link prefetch the page itself cancelled:",
    );
    for (const url of exempted) console.log(`         ${url}`);
  }

  const failed = results.filter((r) => r.problems.length > 0);
  const bytes = results
    .filter((r) => r.file)
    .reduce((sum, r) => sum + statSync(r.file).size, 0);

  if (failed.length > 0) exitCode = 1;

  /* The verdict is the whole run, not the per-capture tally. The cross-capture
     checks above — the mock's request count and the light/dark comparison — can
     each fail a run in which every individual capture passed, and a summary that
     printed "12/12 passed" underneath one of those would be the false green this
     harness exists to prevent. */
  console.log(
    `\ncapture: ${results.length - failed.length}/${results.length} captures clean,` +
      ` ${(bytes / 1024).toFixed(0)} KiB under .impeccable/harness/` +
      `\ncapture: ${exitCode === 0 ? "PASS" : "FAIL"}`,
  );
} catch (error) {
  console.error(`\ncapture: ${error instanceof Error ? error.stack : String(error)}`);
  exitCode = 2;
} finally {
  await teardown();
}

process.exit(exitCode);
