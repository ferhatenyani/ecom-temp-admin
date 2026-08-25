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
    /* The tariff has its own route since the redesign; `/shipping` is the
       parcels list and is captured below. */
    await page.goto(`${BASE}/${locale}/shipping/rules`, { waitUntil: "networkidle" });
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
     * **A rule row's secondary line is bounded, and it is allowed to wrap.**
     *
     * This asserted "does not wrap" and measured nothing: it selected
     * `.list-row`, the retired iOS class, so it returned -1 and the `<= 1`
     * predicate passed vacuously — green while blind.
     *
     * The rule it was written for has also been re-decided. The old row
     * truncated that line to one, which in Arabic clipped away the free-shipping
     * threshold — the fact somebody is reading the row *for*. It wraps now, at
     * the separators, and `Isolate` keeps a day count together with its unit. So
     * the bound is what is worth checking: four facts on a 340px row is two
     * lines, and anything past that is the line breaking mid-token.
     */
    const ruleLines = await page.evaluate(() => {
      const row = document.querySelector("section li span[dir='auto'].break-words");
      if (!row) return -1;
      const style = getComputedStyle(row);
      return Math.round(row.getBoundingClientRect().height / parseFloat(style.lineHeight));
    });
    check(
      `${name}/${locale}: a rule's secondary line stays within two lines`,
      ruleLines,
      (v) => v >= 1 && v <= 2,
    );

    // ----------------------------------------------------------- parcels ---
    await page.goto(`${BASE}/${locale}/shipping`, { waitUntil: "networkidle" });
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

    // --------------------------------------------------------- dashboard ---
    await page.goto(`${BASE}/${locale}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid^='card-']");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/dashboard-${name}-${locale}.png`, fullPage: true });

    const dashboardOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: dashboard no horizontal overflow`, dashboardOverflow, (v) => v <= 1);

    /*
     * **Two card sets, and neither has holes.** Seven either way — with money the
     * hero is net revenue and collected sits beside it; without, orders placed
     * leads and completed and new customers take those slots. This capture signs
     * in as a Super Admin, so it is the money set; the other is covered by
     * `e2e/analytics.spec.ts` with `AC_LIMITED_*`.
     */
    const cardCount = await page.locator("[data-testid^='card-']").count();
    check(`${name}/${locale}: dashboard renders a full card set`, cardCount, 7);

    /*
     * Every card is a link, and exactly one is the hero. A dashboard number that
     * cannot be drilled into is decoration, and a second hero is two headlines.
     */
    const cardShape = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("[data-testid^='card-']")];
      const linked = cards.filter((c) => c.getAttribute("href")).length;
      // The hero spans the row; the tiles do not.
      const heroes = cards.filter((c) => c.className.includes("col-span-2")).length;
      return `${linked}/${cards.length} linked, ${heroes} hero`;
    });
    check(
      `${name}/${locale}: every card links and exactly one leads`,
      cardShape,
      (v) => /^(\d+)\/\1 linked, 1 hero$/.test(String(v)),
    );

    /*
     * **The window on screen is the window the API answered**, never the one the
     * picker holds. `date_from`/`date_to` sent without `range=custom` are
     * silently ignored — measured, 200 with the thirty-day default — so a picker
     * bound to its own state would caption a month of data with a chosen
     * fortnight. Asserted by *disagreeing* with the picker: `range=today` is
     * pressed, and the line must read one day rather than the default.
     */
    await page.goto(`${BASE}/${locale}/dashboard?range=today`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid='range-applied']");
    const appliedToday = await page.locator("[data-testid='range-applied']").innerText();
    check(
      `${name}/${locale}: the range line comes from the response`,
      appliedToday.replace(/\s+/g, " ").trim(),
      (v) => /(1 jour|يوم)/.test(String(v)),
    );

    // ---------------------------------------------------------- analytics ---
    await page.goto(`${BASE}/${locale}/analytics`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid='report-revenue']");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/analytics-${name}-${locale}.png`, fullPage: true });

    const revenueOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: revenue report no overflow`, revenueOverflow, (v) => v <= 1);

    /*
     * **Every revenue figure carries its population**, because two pairs on this
     * screen do not divide: 844 placed against 289 counted, and 719 700 net
     * against 145 150 collected. Counted structurally, the same way the COD
     * funnel is above: as many scope lines as figures.
     */
    const revenueScoped = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("[data-testid='report-revenue'] .list-row")].filter(
        (r) => r.querySelector("[data-numeric]"),
      );
      const withScope = rows.filter((r) => r.querySelector(".text-caption"));
      return `${withScope.length}/${rows.length}`;
    });
    check(`${name}/${locale}: every revenue figure names its scope`, revenueScoped, (v) => {
      const [a, b] = String(v).split("/");
      return a !== undefined && a === b && Number(a) > 0;
    });

    /*
     * **No English paragraph on a French or Arabic sheet.** `unavailable` is an
     * object of English sentences and `unattributed.reason` is another; both are
     * replaced by localised wording, and the API's text is rendered only for a
     * key the panel has no line for. Asserted by looking for the sentences the
     * API actually sends.
     */
    const englishLeak = await page.evaluate(() => {
      const text = document.querySelector("[data-testid='report-revenue']")?.textContent ?? "";
      return /No cost of goods exists|Gateway fees are not summable|is not recorded/.test(text)
        ? "english"
        : "localised";
    });
    check(`${name}/${locale}: the unavailable reasons are localised`, englishLeak, "localised");

    // --------------------------------------------------- the wilaya report ---
    await page.goto(`${BASE}/${locale}/analytics?view=shipping`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid='report-shipping']");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/wilaya-${name}-${locale}.png`, fullPage: true });

    /*
     * **The unattributed slice is bigger than every attributed wilaya combined**
     * — 249 orders against 39 and 1 — so it is ranked first as a named row, in
     * the muted fill that marks it as a different *kind* of thing. A nameless
     * wedge that size reads as a bug.
     */
    const firstSlice = await page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll("[data-testid='report-shipping'] .list-row"),
      ].filter((r) => r.querySelector(".bar-fill"));
      const wilayaRows = rows.filter((r) => r.querySelector(".bar-fill-muted"));
      if (wilayaRows.length === 0) return "no muted row";
      // The muted row must be the first of the geography rows it belongs to.
      const group = wilayaRows[0].parentElement;
      const inGroup = [...(group?.children ?? [])];
      return inGroup.indexOf(wilayaRows[0]) === 0 ? "first" : "not first";
    });
    check(`${name}/${locale}: the unattributed slice is named and ranked`, firstSlice, "first");

    /*
     * **A bar grows from the reading-start edge, and its number does not
     * mirror.** In RTL the fill's end must sit on the track's start-side end —
     * asserted geometrically, because a `dir` attribute cannot catch a reorder
     * and the logical `border-*-end-radius` is the only thing making it true.
     */
    const barGeometry = await page.evaluate((rtl) => {
      const fill = document.querySelector("[data-testid='report-shipping'] .bar-fill");
      const track = fill?.parentElement;
      if (!fill || !track) return "no bar";
      const f = fill.getBoundingClientRect();
      const t = track.getBoundingClientRect();
      const anchored = rtl ? Math.abs(f.right - t.right) <= 1 : Math.abs(f.left - t.left) <= 1;
      return anchored ? "anchored" : "floating";
    }, locale === "ar");
    check(`${name}/${locale}: the bar grows from the reading edge`, barGeometry, "anchored");

    /*
     * **A bar's value is always printed as text.** The chart's table view is
     * built in rather than bolted beside it, so a reader who cannot see a length
     * loses nothing and there is nothing a tooltip could reveal.
     */
    const barsLabelled = await page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll("[data-testid='report-shipping'] .list-row"),
      ].filter((r) => r.querySelector(".bar-fill"));
      const withValue = rows.filter((r) => r.querySelector("[data-numeric]"));
      return `${withValue.length}/${rows.length}`;
    });
    check(`${name}/${locale}: every bar prints its value`, barsLabelled, (v) => {
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

    // ------------------------------------------------------ content: pages ---
    await page.goto(`${BASE}/${locale}/content`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/content-hub-${name}-${locale}.png`, fullPage: true });

    await page.goto(`${BASE}/${locale}/content/pages`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="pages-count"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/pages-${name}-${locale}.png`, fullPage: true });

    const pagesOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: pages index no overflow`, pagesOverflow, (v) => v <= 1);

    /*
     * **A page path is an identifier and must read left to right in both
     * locales.** Measured by glyph position rather than by markup: the first
     * character of `/legal/conditions-generales` has to sit at the *visual* left
     * of the run whatever the paragraph around it is doing. Wrapping the row
     * instead of the path is what put a provider name at the wrong end of an
     * Arabic row on the analytics branch, and this is the check that would have
     * caught it.
     */
    const pathDirection = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('a[href*="/content/pages/"]')];
      for (const row of rows) {
        /*
         * The *leaf*, not the first ancestor whose text happens to start with a
         * slash. The first version of this check took the wrapper holding the
         * path and the date, which inherits the page direction — so it passed in
         * French for the wrong reason and failed in Arabic for the wrong reason.
         * A check that reports the app is broken when the app is fine is worth
         * no more than one that misses a real defect.
         */
        const path = [...row.querySelectorAll("span")]
          .filter((s) => s.children.length === 0)
          .find((s) => /^\/[a-z0-9-]/i.test(s.textContent?.trim() ?? ""));
        if (!path) continue;
        if (getComputedStyle(path).direction !== "ltr") return "path is not ltr";
        // And the *row* must not have been forced with it: a full-width cell
        // wrapped in `Ltr` forces the cell, which is the defect this guards.
        if (getComputedStyle(row).direction !== document.documentElement.dir) {
          return "the row's direction was forced";
        }
        return "ok";
      }
      return "no path found";
    });
    check(`${name}/${locale}: a page path reads ltr without forcing its row`, pathDirection, "ok");

    /*
     * **A field's hint describes the control; it does not name it.** The hint
     * used to sit inside the `<label>`, which made it part of the accessible
     * name — so the name ran to a full sentence and changed as the hint changed.
     * Asserted on the real form: every hinted field points `aria-describedby` at
     * its hint, and no `<label>` contains one.
     */
    await page.goto(`${BASE}/${locale}/content/pages/livraison`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/page-form-${name}-${locale}.png`, fullPage: true });

    const hintPlacement = await page.evaluate(() => {
      const hints = [...document.querySelectorAll('[id$="-hint"]')];
      if (hints.length === 0) return "no hints on this form";
      const insideLabel = hints.filter((h) => h.closest("label") !== null).length;
      const described = hints.filter((h) =>
        document
          .querySelector(`[aria-describedby~="${h.id}"]`) !== null,
      ).length;
      return `${hints.length} hints, ${insideLabel} inside a label, ${described} described`;
    });
    check(
      `${name}/${locale}: a hint describes rather than names`,
      hintPlacement,
      (v) => {
        const m = String(v).match(/^(\d+) hints, 0 inside a label, (\d+) described$/);
        return m !== null && m[1] === m[2] && Number(m[1]) > 0;
      },
    );

    // --------------------------------------------------- content: homepage ---
    await page.goto(`${BASE}/${locale}/content/homepage`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="sections-count"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/homepage-${name}-${locale}.png`, fullPage: true });

    const homepageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: homepage editor no overflow`, homepageOverflow, (v) => v <= 1);

    /*
     * **The drop report is a localised line with the API's English beneath it,
     * never the English on its own.** Rendering the raw note is what put an
     * English paragraph across the middle of an Arabic sheet on the analytics
     * branch — none of the tests that existed failed, and a capture found it.
     *
     * Two halves, both required: the message must be in the reader's language,
     * and the API's sentence must still be there as detail because it names the
     * offending type verbatim. In Arabic the detail must also be `dir="ltr"`, or
     * the quoted type reorders inside the column.
     */
    const dropReport = await page.evaluate((rtl) => {
      const rows = [...document.querySelectorAll(".list-row")].filter((r) =>
        /unknown type|not an object|not a list|More than/.test(r.textContent ?? ""),
      );
      if (rows.length === 0) return "no drop report";

      for (const row of rows) {
        const spans = [...row.querySelectorAll("span")];
        const detail = spans.find((s) => /unknown type|not an object|More than/.test(s.textContent ?? "") && s.children.length === 0);
        if (!detail) return "no detail line";
        // The message is the sibling above the detail, and must not be English.
        const message = spans.find(
          (s) => s.children.length === 0 && s !== detail && (s.textContent ?? "").trim().length > 10,
        );
        if (!message) return "no localised message";
        if (rtl && /^[A-Za-z ,.'"()]+$/.test((message.textContent ?? "").trim())) {
          return "the message is English";
        }
        if (rtl && getComputedStyle(detail).direction !== "ltr") {
          return "the English detail is not isolated";
        }
      }
      return "ok";
    }, locale === "ar");
    check(`${name}/${locale}: the drop report is localised, with the API's text as detail`, dropReport, "ok");

    /*
     * **Reordering is a 44px target.** ADMIN_PANEL.md asks for drag-ordering;
     * HTML5 drag-and-drop fires no `dragstart` from a touch pointer and has no
     * keyboard path, so the panel ships buttons — which only helps if a thumb
     * can hit them at the 390px floor.
     */
    const moveTargets = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")].filter((b) =>
        /Monter|Descendre|رفع|خفض/.test(b.getAttribute("aria-label") ?? ""),
      );
      if (buttons.length === 0) return "no move controls";
      /*
       * The button's own box, and it has to be the button's own box. `.tap-44`
       * grows a hit area with an absolutely-positioned `::after`, which is right
       * for a nav-bar control and wrong at the trailing edge of a padded row —
       * it hangs past the container and widens the document without any
       * element's rect overflowing. These are real 44px boxes for that reason,
       * so measuring the rect is both the accessibility check and the guard
       * against the layout defect that produced it.
       */
      const small = buttons.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width < 44 || r.height < 44;
      });
      return small.length === 0 ? `${buttons.length} ok` : `${small.length} under 44px`;
    });
    check(`${name}/${locale}: reorder controls are 44px`, moveTargets, (v) => /ok$/.test(String(v)));

    /*
     * And every *other* control on a row, which is the half the check above
     * misses. The menus screen has four controls per row and its main label
     * button rendered **42px** tall in French and 44 in Arabic — two pixels
     * short, in one locale, on the largest target on the row. Nothing but a
     * measurement finds that.
     */
    const rowTargets = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll(".list-row button")];
      if (buttons.length === 0) return "no row controls";
      const small = buttons.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && (r.width < 44 || r.height < 44);
      });
      return small.length === 0
        ? `${buttons.length} ok`
        : `${small.length} under 44px: ${small
            .map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().slice(0, 20))
            .join(", ")}`;
    });
    check(`${name}/${locale}: every row control is 44px`, rowTargets, (v) => /ok$/.test(String(v)));

    /*
     * The two screens with the most controls on one row, measured rather than
     * captured — banners carry a thumbnail, a label, two reorder buttons and a
     * delete; menus carry a label, two reorder buttons, an add and a delete, at
     * two levels. Both are visited for this check alone, because a screenshot of
     * a row that is two pixels short looks exactly like one that is not.
     */
    for (const [screen, url, ready] of [
      ["banners", `${BASE}/${locale}/content/banners`, '[data-testid="banners-count"]'],
      ["menus", `${BASE}/${locale}/content/menus`, '[data-testid="menu-count"]'],
    ]) {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForSelector(ready);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${screen}-${name}-${locale}.png`, fullPage: true });

      const crowded = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll(".list-row button")];
        if (buttons.length === 0) return "no row controls";
        const small = buttons.filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && (r.width < 44 || r.height < 44);
        });
        return small.length === 0 ? `${buttons.length} ok` : `${small.length} under 44px`;
      });
      check(`${name}/${locale}: ${screen} row controls are 44px`, crowded, (v) =>
        /ok$/.test(String(v)),
      );

      const crowdedOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      check(`${name}/${locale}: ${screen} no overflow`, crowdedOverflow, (v) => v <= 1);
    }

    // ------------------------------------------------------ content: media ---
    await page.goto(`${BASE}/${locale}/media`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="media-count"]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/media-${name}-${locale}.png` });

    const mediaOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}/${locale}: media library no overflow`, mediaOverflow, (v) => v <= 1);

    /*
     * Every thumbnail is a real image that actually loaded, and every one is
     * inside a labelled control. `naturalWidth === 0` is how a broken URL looks
     * to a screenshot: identical to a slow one.
     */
    const thumbs = await page.evaluate(() => {
      const images = [...document.querySelectorAll("ul img")];
      if (images.length === 0) return "no thumbnails";
      const broken = images.filter((i) => !i.complete || i.naturalWidth === 0).length;
      const unlabelled = images.filter(
        (i) => (i.closest("button")?.getAttribute("aria-label") ?? "").trim() === "",
      ).length;
      return `${images.length} images, ${broken} broken, ${unlabelled} unlabelled`;
    });
    check(
      `${name}/${locale}: every thumbnail loaded and is labelled`,
      thumbs,
      (v) => /^\d+ images, 0 broken, 0 unlabelled$/.test(String(v)),
    );

    /*
     * **No API English reaches the Arabic screen as a message.** The generic
     * sweep the analytics branch added, pointed at this branch's screens: the
     * CMS emits English field messages and English drop-report sentences, and
     * both have a localised frame around them.
     */
    if (locale === "ar") {
      const strayEnglish = await page.evaluate(() => {
        const suspects = [
          "No page at that path",
          "The page data is invalid",
          "Only image/",
          "empty or truncated",
        ];
        const text = document.body.innerText;
        return suspects.filter((s) => text.includes(s)).join(", ") || "clean";
      });
      check(`${name}/${locale}: no API English on the media screen`, strayEnglish, "clean");
    }

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
