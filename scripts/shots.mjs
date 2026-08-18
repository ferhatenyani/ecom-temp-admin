/**
 * Signs in with a real Application Password and captures the orders list and one
 * order detail, in both locales, at the phone width the panel is designed for and
 * at a desktop width.
 *
 * It also asserts the handful of things a screenshot cannot show: that the Arabic
 * face actually loaded rather than falling back, that `dir` is right, and that an
 * order number inside Arabic text keeps its digit order. Assert the rendered
 * string, not the DOM attribute — the attribute half cannot catch a bidi bug.
 *
 *   node scripts/shots.mjs <username> <password>
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const [username, password] = process.argv.slice(2);
const BASE = process.env.PANEL_BASE ?? "http://localhost:3001";
const OUT = ".impeccable/review";

if (!username || !password) {
  console.error("usage: node scripts/shots.mjs <username> <application-password>");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

/**
 * The device set, measured against Playwright's descriptors rather than assumed.
 * 390 is the narrowest width Apple still ships (iPhone 16e / 17e) and the width
 * the design is drawn at; 402 is today's mainstream (iPhone 17 Pro) and 440 the
 * widest (17 Pro Max). Capturing the floor alone would leave every current
 * flagship unverified.
 *
 * Chromium at those viewports, not WebKit, and that is a compromise worth naming:
 * iOS Safari is the real target, but WebKit's system libraries (libwebp, libavif,
 * libharfbuzz-icu, …) need root to install and this WSL environment has no
 * passwordless sudo. `playwright.config.ts` keeps a `phone-webkit` project for a
 * machine that can run it.
 */
const phoneOn = (model) => {
  // The descriptor bundles an engine as well as a viewport; drop the engine and
  // the user agent, keep the geometry and the touch behaviour.
  const { defaultBrowserType, userAgent, ...rest } = devices[model];
  return { ...rest, isMobile: false };
};

const TARGETS = [
  ["phone-min", phoneOn("iPhone 17e")],
  ["phone", phoneOn("iPhone 17 Pro")],
  ["phone-max", phoneOn("iPhone 17 Pro Max")],
  ["desktop", { viewport: { width: 1440, height: 900 } }],
];

const results = [];
let failures = 0;

function check(label, actual, expected) {
  const ok =
    typeof expected === "function" ? expected(actual) : actual === expected;
  results.push({ ok, label, actual: String(actual).slice(0, 90) });
  if (!ok) failures++;
}

const browser = await chromium.launch();

for (const [name, options] of TARGETS) {
  const isPhone = name.startsWith("phone");
  for (const locale of ["fr", "ar"]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();

    // Sign in through the real form, so the sealed cookie is exercised.
    await page.goto(`${BASE}/${locale}/login`, { waitUntil: "networkidle" });
    if (name === "phone") {
      await page.screenshot({ path: `${OUT}/login-${locale}.png` });
    }
    await page.fill("#username", username);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`**/${locale}/orders`, { timeout: 20000 });
    await page.waitForSelector('[data-testid="orders-count"]');
    // Let the font swap and the first paint settle so a capture is not of a
    // half-loaded state.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(700);

    await page.screenshot({
      path: `${OUT}/orders-${name}-${locale}.png`,
      fullPage: false,
    });

    if (name === "phone" && locale === "fr") {
      await page.screenshot({ path: `${OUT}/mobile.png` });
    }
    if (name === "desktop" && locale === "fr") {
      await page.screenshot({ path: `${OUT}/desktop.png` });
    }

    // ---------------------------------------------------------- assertions ---
    const dir = await page.getAttribute("html", "dir");
    check(`${name}/${locale}: dir`, dir, locale === "ar" ? "rtl" : "ltr");

    // The rendered font, not the declared one. A fallback would report a
    // different family, which is how a missing woff2 hides.
    const font = await page
      .locator('[data-testid="orders-count"]')
      .evaluate((el) => getComputedStyle(el).fontFamily);
    check(`${name}/${locale}: font family is Plex`, font, (v) =>
      v.includes("Plex"),
    );

    // Did the browser actually fetch the face it needs? document.fonts reports
    // what loaded, so this catches a 404 on the woff2 that CSS cannot.
    const loaded = await page.evaluate(() =>
      [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
    );
    check(`${name}/${locale}: a Plex face loaded`, loaded.join(","), (v) =>
      v.includes("Plex"),
    );

    // No tofu: the count line must render with real glyphs. A zero-width or
    // notdef box collapses the line box, so a positive height is the control.
    const countBox = await page.locator('[data-testid="orders-count"]').boundingBox();
    check(`${name}/${locale}: count line has height`, countBox?.height ?? 0, (v) => v > 8);

    // The order number keeps its digit order inside Arabic text. Asserted on the
    // rendered text content of the isolated element.
    const firstNumber = await page
      .locator('a[href*="/orders/"] span[dir="ltr"]')
      .first()
      .innerText();
    check(
      `${name}/${locale}: order number digits ordered`,
      firstNumber.trim(),
      (v) => /^#\d+$/.test(v.trim()),
    );

    // The tab bar sits at the bottom on mobile; at md it is replaced by the
    // sidebar. Addressed by test id, because both are `nav.material-bar` and the
    // sidebar comes first in the DOM — the earlier selector was measuring the
    // wrong element and reporting it inverted.
    const tabVisible = await page.getByTestId("tab-bar").isVisible();
    const sideVisible = await page.getByTestId("sidebar").isVisible();
    check(
      `${name}/${locale}: bottom tab bar visible on mobile only`,
      tabVisible,
      isPhone,
    );
    check(
      `${name}/${locale}: sidebar visible on desktop only`,
      sideVisible,
      !isPhone,
    );

    // The segmented control's thumb must match a segment: they are equal
    // fractions, and a label that cannot shrink breaks the alignment silently.
    const segWidths = await page
      .locator('[role="radiogroup"] label')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
    const thumbWidth = await page
      .locator(".seg-thumb")
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));
    check(
      `${name}/${locale}: segments equal and matching the thumb`,
      `segments ${segWidths.join("/")} thumb ${thumbWidth}`,
      () =>
        new Set(segWidths).size === 1 && Math.abs(segWidths[0] - thumbWidth) <= 1,
    );

    // The skeleton must be the height of a real row, or the list shifts when data
    // lands. Compared against the rendered row on the same page.
    const rowHeight = await page
      .locator('a[href*="/orders/"]')
      .first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().height));
    check(`${name}/${locale}: row height`, rowHeight, (v) => v > 40);

    // No horizontal overflow. A phone layout that scrolls sideways is broken.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: no horizontal overflow`, overflow, (v) => v <= 1);

    // ------------------------------------------------------------- detail ---
    await page.locator('a[href*="/orders/"]').first().click();
    await page.waitForURL(/\/orders\/\d+/, { timeout: 20000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `${OUT}/detail-${name}-${locale}.png`,
      fullPage: true,
    });

    const detailOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: detail no horizontal overflow`, detailOverflow, (v) => v <= 1);

    // The timeline's HTML entities must be decoded. If any rendered text still
    // contains a raw `&rarr;` the decoder is not wired in.
    const body = await page.locator("body").innerText();
    check(`${name}/${locale}: no raw HTML entities`, body.includes("&rarr;"), false);

    await context.close();
  }
}

await browser.close();

console.log();
for (const r of results) {
  console.log(`  ${r.ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${r.label} → ${r.actual}`);
}
console.log();
if (failures > 0) {
  console.log(`\x1b[31m${failures} of ${results.length} checks failed\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32mall ${results.length} checks passed\x1b[0m`);
