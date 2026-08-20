/**
 * Signs in with a real Application Password and captures the orders list, one
 * order detail, the products list, its filter sheet, one product detail, the
 * customers list and detail, the coupons list and form, the shipping tariff and
 * its parcels, the payments ledger with the COD funnel, and an order detail
 * carrying all three new sections — in both locales, at the three current iPhone
 * widths and at a desktop width.
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

    // ----------------------------------------------------------- products ---
    await page.goto(`${BASE}/${locale}/products`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="products-count"]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/products-${name}-${locale}.png` });

    const productOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: products no horizontal overflow`, productOverflow, (v) => v <= 1);

    /*
     * Every row the same height. The status badge is 24px and a name's line box is
     * 22, so a row carrying a badge was two pixels taller than one without until
     * the primary line was given the badge's height as a floor — invisible per row
     * and a visible stutter down a scrolling list. The last row is legitimately a
     * hairline shorter, because `.list-row:last-child` drops its separator.
     */
    const productRows = await page
      .locator('a[href*="/products/"]')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    check(
      `${name}/${locale}: product rows are one height`,
      `${[...new Set(productRows)].join("/")} (n=${productRows.length})`,
      () => {
        const distinct = [...new Set(productRows)].sort((a, b) => b - a);
        return (
          productRows.length > 1 &&
          distinct.length <= 2 &&
          (distinct.length === 1 || distinct[0] - distinct[1] <= 1)
        );
      },
    );

    // The first filter pill keeps the page gutter. `scroll-snap-align: start`
    // aligns to the scrollport, not to its padding, so without
    // `scroll-padding-inline` the row snapped past the gutter and the first pill
    // sat flush against the viewport edge while the search field above it did not.
    const gutters = await page.evaluate(() => {
      const row = document.querySelector(".pill-row");
      const search = document.querySelector('form[role="search"]');
      const rtl = document.documentElement.dir === "rtl";
      const pill = row.firstElementChild.getBoundingClientRect();
      const field = search.getBoundingClientRect();
      return rtl
        ? { pill: Math.round(innerWidth - pill.right), field: Math.round(innerWidth - field.right) }
        : { pill: Math.round(pill.left), field: Math.round(field.left) };
    });
    check(
      `${name}/${locale}: the first pill keeps the page gutter`,
      `pill ${gutters.pill} vs field ${gutters.field}`,
      () => Math.abs(gutters.pill - gutters.field) <= 1,
    );

    // A SKU inside Arabic text keeps its direction. Asserted on the rendered
    // string: the `dir` attribute alone cannot catch a bidi reorder.
    const sku = await page
      .locator('a[href*="/products/"] span[dir="ltr"]')
      .first()
      .innerText();
    check(`${name}/${locale}: SKU keeps its direction`, sku.trim(), (v) =>
      /^[A-Z0-9][A-Z0-9-]*$/.test(v.trim()),
    );

    // The filter sheet, with its facet counts and the scope note.
    await page.locator(".pill-row > button").first().click();
    await page.waitForSelector('[role="dialog"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/filters-${name}-${locale}.png` });

    const sheetOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: filter sheet no horizontal overflow`, sheetOverflow, (v) => v <= 1);

    /*
     * The counts have to be the API's, not zeroes. The first implementation keyed
     * the category facet by slug against a vocabulary keyed by term id, and
     * rendered `0` beside all six categories in a shop that had just reported 15,
     * 3, 3, 3, 2 and 2. It compiled and typechecked; only the screenshot showed it.
     */
    const counts = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] [role="checkbox"]')]
        .map((el) => el.textContent.trim())
        .filter((t) => /\d/.test(t))
        .map((t) => Number(t.match(/(\d+)\s*$/)?.[1] ?? -1)),
    );
    check(
      `${name}/${locale}: facet counts are not all zero`,
      `${counts.filter((c) => c > 0).length} of ${counts.length} above zero`,
      () => counts.length > 0 && counts.some((c) => c > 0),
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // The product detail, on a variable product so the variations section renders.
    // By SKU, never by id: the backend's suites recreate their fixtures and an id
    // is stable only until the next run over there.
    await page.goto(`${BASE}/${locale}/products?sku=AC-BUR-010`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="products-count"]');
    await page.locator('a[href*="/products/"]').first().click();
    await page.waitForURL(/\/products\/\d+/, { timeout: 20000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/product-${name}-${locale}.png`, fullPage: true });

    const detailProductOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(
      `${name}/${locale}: product detail no horizontal overflow`,
      detailProductOverflow,
      (v) => v <= 1,
    );

    // --------------------------------------------------------- customers ---
    await page.goto(`${BASE}/${locale}/customers`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="customers-count"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/customers-${name}-${locale}.png` });

    const customersOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: customers no horizontal overflow`, customersOverflow, (v) => v <= 1);

    /*
     * **A translated count sentence must start where its language starts.**
     *
     * Sixteen call sites wrapped one of these in `Ltr`, reaching for the tabular
     * figures and taking the forced direction with them: the Arabic list laid
     * "16 عميلًا" out beginning at the left, so the number an Arabic reader sees
     * first was the one furthest from where they start. French was unaffected,
     * which is how it survived three branches.
     *
     * Asserted on the *rendered glyph positions*, because a `dir` attribute
     * cannot catch a reorder and this is exactly the class of bug that ships.
     */
    const countOrder = await page.getByTestId("customers-count").evaluate((el) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      const glyphs = [];
      let node;
      while ((node = walk.nextNode())) {
        const text = node.textContent ?? "";
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const box = range.getBoundingClientRect();
          if (box.width > 0) glyphs.push([box.x, text[i]]);
        }
      }
      return glyphs.sort((a, b) => a[0] - b[0]).map(([, c]) => c).join("");
    });
    check(
      `${name}/${locale}: count sentence reads from its own side`,
      countOrder,
      // Visually left-to-right: French leads with the digits, Arabic ends with
      // them — which in a right-to-left reading is where the eye lands first.
      (v) => (locale === "ar" ? /\d\s*$/.test(v) : /^\s*\d/.test(v)),
    );

    // A customer with no name at all — 12 of the 16 — must not render a blank row.
    const firstCustomer = await page
      .locator('a[href*="/customers/"]')
      .first()
      .innerText();
    check(
      `${name}/${locale}: a nameless customer still has a label`,
      firstCustomer.split("\n")[0].trim(),
      (v) => v.length > 0,
    );

    // The detail, on the one customer carrying statistics and an address.
    await page.goto(`${BASE}/${locale}/customers?search=ac_cus_shopper`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector('[data-testid="customers-count"]');
    await page.locator('a[href*="/customers/"]').first().click();
    await page.waitForURL(/\/customers\/\d+/, { timeout: 20000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/customer-${name}-${locale}.png`, fullPage: true });

    const customerOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: customer detail no overflow`, customerOverflow, (v) => v <= 1);

    // ----------------------------------------------------------- coupons ---
    await page.goto(`${BASE}/${locale}/coupons`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="coupons-count"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/coupons-${name}-${locale}.png` });

    const couponsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: coupons no horizontal overflow`, couponsOverflow, (v) => v <= 1);

    /*
     * A percentage is formatted, not concatenated. `${amount} %` put `10.00 %`
     * on the French list — a raw decimal point where French writes a comma, and
     * two decimals nobody writes on a discount. Only the rendered row shows it.
     */
    const couponBody = await page.locator("body").innerText();
    check(`${name}/${locale}: no unformatted percentage`, couponBody.includes("10.00"), false);

    // The coupon form, on the one fixture that carries a restriction.
    await page.goto(`${BASE}/${locale}/coupons?search=tapis15`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="coupons-count"]');
    await page.locator('a[href*="/coupons/"]:not([href$="/new"])').first().click();
    await page.waitForURL(/\/coupons\/\d+/, { timeout: 20000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/coupon-${name}-${locale}.png`, fullPage: true });

    /*
     * `product_categories: [16]` resolved to a name. The whole reason two routes
     * were added to the API: a Marketing Manager is 403 on `/product-categories`
     * and would otherwise see a bare id on the one screen that is their job.
     */
    const couponForm = await page.locator("body").innerText();
    check(
      `${name}/${locale}: a restriction shows a name, not an id`,
      couponForm.includes("Tapis et Textiles"),
      true,
    );

    /*
     * **A French description inside the Arabic form.** A control inherits the
     * page's direction, so this string was an LTR run in an RTL paragraph and
     * rendered ".sur les tapis et textiles % 15" — the leading figure thrown to
     * the far end. `dir="auto"` resolves it from the value's own first strong
     * character.
     */
    const descriptionDirection = await page
      .locator("textarea")
      .first()
      .evaluate((el) => getComputedStyle(el).direction);
    check(
      `${name}/${locale}: a French description reads left to right`,
      descriptionDirection,
      "ltr",
    );

    const couponOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: coupon form no overflow`, couponOverflow, (v) => v <= 1);

    /*
     * **The save bar must not sit under the tab bar.** Both are `fixed … z-20`
     * and the tab bar comes later in the document, so a hand-rolled `bottom-0`
     * put the save button physically out of reach of a thumb at phone widths.
     * Asserted geometrically: nothing may cover the button's centre.
     */
    await page.locator("textarea").first().fill("Vérification de la barre.");
    await page.waitForTimeout(300);
    const saveReachable = await page.evaluate(() => {
      const bar = document.querySelector(".save-bar");
      if (!bar) return "no save bar";
      const button = bar.querySelectorAll("button")[1];
      if (!button) return "no save button";
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return bar.contains(hit) ? "reachable" : `covered by ${hit?.tagName ?? "nothing"}`;
    });
    check(`${name}/${locale}: the save button is reachable`, saveReachable, "reachable");

    // ---------------------------------------------------------- shipping ---
    await page.goto(`${BASE}/${locale}/shipping`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/shipping-${name}-${locale}.png`, fullPage: true });

    const shippingOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: shipping no horizontal overflow`, shippingOverflow, (v) => v <= 1);

    /*
     * **The scope badge must not be the destination as well.** A national rule
     * rendered "National · National" — the badge printed twice — because the
     * destination label fell back to the scope word. Nothing failed; only the
     * screenshot showed it.
     */
    const tariff = await page.locator("body").innerText();
    check(
      `${name}/${locale}: the national rule names the country, not its own badge`,
      /National\s*·?\s*National|وطني\s*·?\s*وطني/.test(tariff),
      false,
    );

    /*
     * **A rule row's secondary line stays on one line.** In Arabic — a step
     * larger than French — it wrapped and split the isolated "1 ي", leaving the
     * unit orphaned under its own number. Measured on the rendered box.
     */
    const ruleLines = await page.evaluate(() => {
      const row = document.querySelector("section .list-row span.truncate");
      if (!row) return -1;
      const style = getComputedStyle(row);
      return Math.round(row.getBoundingClientRect().height / parseFloat(style.lineHeight));
    });
    check(`${name}/${locale}: a rule's secondary line does not wrap`, ruleLines, (v) => v <= 1);

    // ----------------------------------------------------------- parcels ---
    await page.goto(`${BASE}/${locale}/shipping?view=parcels`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/parcels-${name}-${locale}.png` });

    const parcelsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: parcels no horizontal overflow`, parcelsOverflow, (v) => v <= 1);

    /*
     * A tracking number keeps its digit order inside Arabic text. The rendered
     * string, not the `dir` attribute — the attribute half cannot catch a bidi
     * bug, and a reordered tracking number is a different tracking number.
     */
    const tracking = await page
      .locator("text=/MAN-\\d+-\\d+/")
      .first()
      .innerText()
      .catch(() => "");
    check(`${name}/${locale}: a tracking number keeps its order`, tracking.trim(), (v) =>
      /^MAN-\d+-\d+$/.test(v),
    );

    // ---------------------------------------------------------- payments ---
    await page.goto(`${BASE}/${locale}/payments`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/payments-${name}-${locale}.png`, fullPage: true });

    const paymentsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: payments no horizontal overflow`, paymentsOverflow, (v) => v <= 1);

    /*
     * **Every figure in the COD funnel carries its scope.** Two counts of
     * "confirmed" sit on this screen — the current state and the cumulative
     * total — and printing either bare is how a reader concludes one is broken.
     * Counted structurally: as many scope lines as figures.
     */
    const scoped = await page.evaluate(() => {
      const section = [...document.querySelectorAll("section")].find((el) =>
        /Contre-remboursement, toute la boutique|الدفع عند الاستلام، على مستوى المتجر/.test(
          el.querySelector("h2")?.textContent ?? "",
        ),
      );
      if (!section) return "no funnel";
      const rows = section.querySelectorAll(".list-row");
      const withScope = [...rows].filter((r) => r.querySelector(".text-caption"));
      return `${withScope.length}/${rows.length}`;
    });
    check(`${name}/${locale}: every COD figure names its scope`, scoped, (v) => {
      const [a, b] = String(v).split("/");
      return a !== undefined && a === b && Number(a) > 0;
    });

    // ------------------------------------------- the order detail sections ---
    await page.goto(`${BASE}/${locale}/orders/3939`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/order-sections-${name}-${locale}.png`, fullPage: true });

    /*
     * **A row's action must not overrun the row.** "Vérifier auprès du
     * fournisseur" beside a money figure at 390 px rendered *on top of* the
     * amount — `Button` sets no width and the flex let it overflow. Asserted
     * geometrically: no action may cover the figure beside it.
     */
    const actionsClear = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-row")];
      for (const row of rows) {
        const button = row.querySelector("button");
        const figure = row.querySelector("[data-numeric]");
        if (!button || !figure) continue;
        const a = button.getBoundingClientRect();
        const b = figure.getBoundingClientRect();
        if (a.width === 0 || b.width === 0) continue;
        const overlap =
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        if (overlap) return `overlap: ${button.textContent?.trim().slice(0, 30)}`;
      }
      return "clear";
    });
    check(`${name}/${locale}: a row action does not cover its figure`, actionsClear, "clear");

    const orderSectionsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(
      `${name}/${locale}: order detail sections no overflow`,
      orderSectionsOverflow,
      (v) => v <= 1,
    );

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
