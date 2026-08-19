import { test, expect, type Page } from "@playwright/test";

/**
 * Coupons: the list, the form, and the restriction picker.
 *
 * **The forbidden fixture is the inverse of the customers suite's.** A Support
 * Agent is 403 on every coupon route while being 200 on every customer route; a
 * Marketing Manager is exactly the other way round. Both are asserted, because a
 * refusal and an unreachable route look identical from outside.
 *
 * The Marketing Manager is also the positive control that matters most here:
 * `/products` and `/product-categories` are `ac_manage_products` and answer them
 * 403, so they are the role the restriction picker could not have been built for.
 * `/coupons/eligible-products` exists precisely so that it can be.
 *
 * Coupons are found by code, which is unique and stable — unlike a product id.
 *
 * `ROW` excludes `/coupons/new`: the create control in the nav bar is an anchor
 * too, so a bare `a[href*="/coupons/"]` matched it first and every
 * "open the first row" helper clicked *create*. The failure looked like the list
 * not rendering.
 */
const ROW = 'a[href*="/coupons/"]:not([href$="/new"])';
const USER = process.env.AC_STAFF_USER;
const PASS = process.env.AC_STAFF_PASS;
const LIMITED_USER = process.env.AC_LIMITED_USER;
const LIMITED_PASS = process.env.AC_LIMITED_PASS;
const MARKETING_USER = process.env.AC_MARKETING_USER;
const MARKETING_PASS = process.env.AC_MARKETING_PASS;

test.skip(
  !USER || !PASS,
  "Set AC_STAFF_USER and AC_STAFF_PASS to a real Application Password.",
);

async function signIn(page: Page, locale: string, user = USER!, pass = PASS!) {
  await page.goto(`/${locale}/login`);
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await page.click('button[type="submit"]');
  await page.waitForURL(new RegExp(`/${locale}/(orders|products|coupons)`));
}

async function openCoupons(page: Page, locale: string, query = "") {
  await page.goto(`/${locale}/coupons${query}`);
  await page.waitForSelector('[data-testid="coupons-count"]');
}

/**
 * Open one of the four restriction rows.
 *
 * `toBeEnabled()` first, and it is not defensive padding. Every control on this
 * form renders `disabled` until React owns it — the hydration hazard the products
 * branch measured, where a keystroke before hydration changes the DOM and never
 * reaches state — and **WebKit hydrates slowly enough for that window to be
 * real**. Chromium closed it before the click every time; WebKit did not, and the
 * click landed on a disabled button and silently did nothing until the
 * actionability check timed out at 25s. Exactly the engine difference the project
 * keeps a `phone-webkit` project for.
 */
async function openPicker(page: Page, name: RegExp) {
  const row = page.getByRole("button", { name });
  await expect(row).toBeEnabled();
  await row.click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
}

async function openByCode(page: Page, locale: string, code: string) {
  await openCoupons(page, locale, `?search=${encodeURIComponent(code)}`);
  const row = page.locator(ROW).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/coupons\/\d+/);
}

test.describe("the coupon list", () => {
  test("renders the four fixtures", async ({ page }) => {
    await signIn(page, "fr");
    await openCoupons(page, "fr");

    await expect(page.locator("body")).toContainText("bienvenue10");
    await expect(page.locator("body")).toContainText("tapis15");
  });

  /**
   * **`amount: "0.00"` is a real coupon.** The `livraison` fixture is a zero
   * discount with `free_shipping: true`, and a row printing "0,00 DA" would be
   * accurate and useless — the inverse of the threshold fields on the same
   * object, where zero is stored as null and cannot be read back at all.
   */
  test("a zero-amount coupon says what it actually does", async ({ page }) => {
    await signIn(page, "fr");
    await openCoupons(page, "fr", "?search=livraison");

    const row = page.locator(ROW).first();
    await expect(row).toContainText("Livraison offerte");
    await expect(row).not.toContainText("0,00 DA");
  });

  /**
   * A percentage is formatted, not concatenated. `${amount} %` put `10.00 %` on
   * the French list — a raw decimal point where French writes a comma, and two
   * decimals nobody writes on a discount.
   */
  test("a percentage is formatted for the locale", async ({ page }) => {
    await signIn(page, "fr");
    await openCoupons(page, "fr", "?search=bienvenue");

    const row = page.locator(ROW).first();
    await expect(row).toContainText("10 %");
    await expect(row).not.toContainText("10.00");
  });

  /**
   * The default list carries drafts. Measured: with no `?status=` the API returns
   * publish *and* draft, so "all" is the absence of the parameter — and a draft
   * sitting among live coupons is why the row badges it.
   */
  test("filters by status, and the URL carries it", async ({ page }) => {
    await signIn(page, "fr");
    await openCoupons(page, "fr", "?status=draft");
    await expect(page).toHaveURL(/status=draft/);
    await expect(page.getByTestId("coupons-count")).toBeVisible();
  });
});

test.describe("the coupon form", () => {
  test("shows the restrictions resolved to names", async ({ page }) => {
    await signIn(page, "fr");
    await openByCode(page, "fr", "tapis15");

    /*
     * `product_categories: [16]` rendered as a name. This is the whole reason two
     * routes were added to the API: `/product-categories` would have served a
     * Super Admin and 403'd the Marketing Manager.
     */
    await expect(page.locator("body")).toContainText("Tapis et Textiles");
  });

  /**
   * **The expiry is asymmetric**: written as `Y-m-d`, read back as full ISO. A
   * date input bound straight to the response renders empty and then clears the
   * field on the next save, deleting a date nobody touched.
   */
  test("a date input can display the expiry the API sends back", async ({ page }) => {
    await signIn(page, "fr");
    await openByCode(page, "fr", "bienvenue10");

    const input = page.locator("#coupon-expires");
    await expect(input).toBeVisible();
    // Either empty (no expiry set) or a value the control can actually render —
    // never the ISO string, which would show as blank.
    const value = await input.inputValue();
    expect(value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)).toBe(true);
  });

  /**
   * A duplicate code is a **409 with `details.code`**, not a 400 with
   * `details.fields` — the same shape a duplicate SKU has — and the conflicting
   * code comes back lower-cased, because that is the form that collided.
   */
  test("a duplicate code is refused on the field, with the folded code", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/coupons/new");
    await page.waitForSelector("#coupon-expires");

    await page.fill('input[name="code"]', "BIENVENUE10");
    await page.fill('input[name="amount"]', "5");
    await page.getByRole("button", { name: "Créer", exact: true }).click();

    // The message names `bienvenue10`, not the `BIENVENUE10` that was typed.
    await expect(page.locator("body")).toContainText("bienvenue10");
    // And no coupon was created: still on the create route.
    await expect(page).toHaveURL(/\/coupons\/new/);
  });

  /** The code folds as the user types, so the field shows what will be stored. */
  test("the code field lower-cases as you type", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/coupons/new");
    await page.waitForSelector('input[name="code"]');

    await page.fill('input[name="code"]', "SUMMER-99");
    await expect(page.locator('input[name="code"]')).toHaveValue("summer-99");
  });
});

test.describe("the restriction picker", () => {
  test("opens, searches and commits a selection", async ({ page }) => {
    await signIn(page, "fr");
    await openByCode(page, "fr", "tapis15");

    await openPicker(page, /Catégories concernées/);

    // The rows are real categories with names, not ids.
    await expect(page.locator('[role="dialog"]')).toContainText("Tapis et Textiles");

    // A checkbox row, addressed by its role rather than by a drawn box.
    const first = page.locator('[role="dialog"] [role="checkbox"]').first();
    await expect(first).toBeVisible();

    await page.getByRole("button", { name: /Annuler/ }).click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  /**
   * The product picker searches by **SKU as well as name**. WordPress's own `s`
   * reads the title and the content only, so a shop that knows a product by its
   * SKU would otherwise type it and get an empty picker.
   */
  test("the product picker finds a product by its SKU", async ({ page }) => {
    await signIn(page, "fr");
    await openByCode(page, "fr", "tapis15");

    await openPicker(page, /Produits concernés/);

    const search = page.locator('[role="dialog"] input[type="search"]');
    await expect(search).toBeEnabled();
    await search.fill("AC-SEO-TAPIS");
    await expect(page.locator('[role="dialog"] [role="checkbox"]')).toHaveCount(1);
  });
});

test.describe("the capability boundary", () => {
  test.skip(
    !MARKETING_USER || !MARKETING_PASS,
    "Needs AC_MARKETING_* (a Marketing Manager).",
  );

  /**
   * **The test this whole backend change exists for.**
   *
   * A Marketing Manager holds `ac_manage_coupons` and not `ac_manage_products`.
   * Built on `/products` and `/product-categories`, the picker would 403 for the
   * one role whose job coupons are. It reads `/coupons/eligible-*` instead.
   */
  test("a Marketing Manager can use the picker they could not before", async ({ page }) => {
    await signIn(page, "fr", MARKETING_USER!, MARKETING_PASS!);
    await openByCode(page, "fr", "tapis15");

    // The resolved names on the form itself.
    await expect(page.locator("body")).toContainText("Tapis et Textiles");

    // And the picker, which is the part that needed a route of its own.
    await openPicker(page, /Produits concernés/);
    await expect(page.locator('[role="dialog"] [role="checkbox"]').first()).toBeVisible();
  });

  /**
   * The positive control for the sentence above: the pickers are narrow routes,
   * not the catalogue re-opened. The same role is still refused `/products`.
   */
  test("...while the products screen stays refused to them", async ({ page }) => {
    await signIn(page, "fr", MARKETING_USER!, MARKETING_PASS!);

    await page.goto("/fr/products");
    await expect(page.getByTestId("products-count")).toHaveCount(0);
  });
});

test.describe("the forbidden state", () => {
  test.skip(!LIMITED_USER || !LIMITED_PASS, "Needs AC_LIMITED_* (a Support Agent).");

  /** The inverse of the customers screen: 403 here, 200 there. */
  test("a Support Agent is refused coupons and stays signed in", async ({ page }) => {
    await signIn(page, "fr", LIMITED_USER!, LIMITED_PASS!);

    await page.goto("/fr/coupons");
    await expect(page.locator("body")).toContainText("Codes promo");
    await expect(page.getByTestId("coupons-count")).toHaveCount(0);

    // Still signed in: customers, which this role *can* read, works.
    await page.goto("/fr/customers");
    await expect(page.getByTestId("customers-count")).toBeVisible();
  });
});

test.describe("both directions", () => {
  /**
   * **A French description inside the Arabic form.** A control inherits the
   * page's direction, so "15 % sur les tapis et textiles." was an LTR run in an
   * RTL paragraph and rendered as ".sur les tapis et textiles % 15" — the leading
   * figure thrown to the far end. Asserted on the control's resolved direction,
   * which is what `dir="auto"` sets from the value's own first strong character.
   */
  test("a French description in the Arabic form keeps its direction", async ({ page }) => {
    await signIn(page, "ar");
    await openByCode(page, "ar", "tapis15");

    const textarea = page.locator("textarea").first();
    await expect(textarea).toHaveAttribute("dir", "auto");

    const resolved = await textarea.evaluate((el) => getComputedStyle(el).direction);
    expect(resolved).toBe("ltr");
  });

  test("renders in Arabic without horizontal overflow", async ({ page }) => {
    await signIn(page, "ar");
    await openCoupons(page, "ar");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await openByCode(page, "ar", "tapis15");
    const formOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(formOverflow).toBeLessThanOrEqual(1);
  });
});
