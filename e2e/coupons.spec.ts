import { test, expect, type Locator, type Page } from "@playwright/test";

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
 * **The suite runs against the live shop, not the mock**, and it is env-gated on
 * credentials nobody has in the redesign checkout — so `tapis15` and the other
 * live codes stay exactly as they are. What the redesign changes is *how* a row
 * is addressed, never what any of these tests check.
 */

/**
 * One coupon row, in whichever presentation the running viewport paints.
 *
 * **`DataTable` renders both and hides one per breakpoint.** The `<table>` — which
 * is the only place the code's `<a href>` exists — is `hidden md:block`, and below
 * `md` a `RecordList` card navigates through a stretched overlay button instead,
 * so a row is one anchor and not two. All four Playwright projects here are
 * phone-sized bar the desktop one, so the old `a[href*="/coupons/"]` locator
 * resolved to a node that is in the DOM and never painted: `toBeVisible()` failed
 * before any of these tests got to their own assertion. One helper, ten tests.
 *
 * `<tr>` and `<li class="ui-card">` rather than the link and the overlay button,
 * because a row is read as well as clicked — "the row says Livraison offerte" is
 * an assertion about the row's text, and the overlay button has none. Both
 * containers are clickable: `<tr>` carries `onRowClick`, and the card's overlay
 * covers it edge to edge.
 *
 * `/coupons/new` is no longer a hazard worth a `:not()` — the create control is a
 * `ButtonLink` in the page header, outside both presentations — but filtering to
 * what is painted excludes it anyway.
 */
function rows(page: Page): Locator {
  return page.locator("tbody tr, li.ui-card").filter({ visible: true });
}

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

/*
 * **Signed in means "no longer on the login screen", not "on /orders".**
 *
 * Every helper here used to wait for a hard-coded alternation of destinations,
 * and that asserted a defect rather than a behaviour: `landingPath()` in
 * `components/ui/nav-tree.ts` sends each reader to the first destination their
 * capabilities actually reach, because DECISIONS.md §11 measured a Support Agent
 * as 403 on `/orders` and 200 on `/customers` — so four files sending everybody
 * to `/orders` showed that reader a forbidden screen as the first thing after a
 * correct password. The alternations here never listed `/customers`, so every
 * test using a limited credential timed out in `signIn` before asserting
 * anything. Two thirds of this suite's first run failed that way.
 *
 * A predicate rather than a longer alternation, deliberately: `landingPath()`
 * reads `NAV`, so the set of possible landings changes whenever the navigation
 * does. Enumerating them here would put the same staleness back one release
 * later. What the helper actually needs to know is that the credential was
 * accepted and the redirect happened.
 */
async function signIn(page: Page, locale: string, user = USER!, pass = PASS!) {
  await page.goto(`/${locale}/login`);
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await page.click('button[type="submit"]');
  await page.waitForURL(
    (url) => !url.pathname.endsWith("/login") && url.pathname.startsWith(`/${locale}/`),
  );
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
  const row = rows(page).first();
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

    const row = rows(page).first();
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

    const row = rows(page).first();
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

  /**
   * Sorting, and the two halves of it that can silently go wrong.
   *
   * All four `orderby` values were re-measured working in both directions, so
   * unlike the products name header this one may reach descending — but the
   * *third* click must drop `orderby` from the URL rather than sit on a fourth
   * state, because `date` is the default order and the only way back to it.
   *
   * Asserted on `aria-sort` and the URL rather than on row order: the suite runs
   * against the live shop, where usage counts move whenever somebody redeems
   * something. `aria-sort` is also the accessible contract and the only
   * externally visible record of what the panel thinks it asked for — and the
   * unsorted headers beside it must keep reading "none", never inherit the sort.
   */
  test("the usage column sorts both ways, and the third click returns to the default", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await openCoupons(page, "fr");

    const usage = page.getByRole("columnheader", { name: /Utilisations/ });
    // Below `md` the records are cards: `RecordList` takes no sort props and
    // there is no column header to click. That is the design, not a gap.
    if (!(await usage.isVisible())) test.skip(true, "no table at this width");

    const code = page.getByRole("columnheader", { name: /Code/ });
    await expect(usage).toHaveAttribute("aria-sort", "none");

    await usage.getByRole("button").click();
    await expect(usage).toHaveAttribute("aria-sort", "ascending");
    await expect(page).toHaveURL(/orderby=usage/);
    await expect(page).toHaveURL(/order=asc/);
    // The neighbouring sortable column is unaffected, and says so.
    await expect(code).toHaveAttribute("aria-sort", "none");

    await usage.getByRole("button").click();
    await expect(usage).toHaveAttribute("aria-sort", "descending");
    // `desc` is the API's default `order`, so the panel stops naming it.
    await expect(page).toHaveURL(/orderby=usage/);
    await expect(page).not.toHaveURL(/order=asc/);

    await usage.getByRole("button").click();
    await expect(usage).toHaveAttribute("aria-sort", "none");
    await expect(page).not.toHaveURL(/orderby=/);
  });

  /**
   * A `sortKey` on a column the API cannot sort would announce a sortability
   * that does not exist — DECISIONS.md §2, found and fixed on products. Six of
   * the nine columns are in that position here, so the attribute must be absent
   * rather than "none": in ARIA, "none" means *sortable, currently unsorted*.
   */
  test("a column the API cannot sort carries no aria-sort at all", async ({ page }) => {
    await signIn(page, "fr");
    await openCoupons(page, "fr");

    const type = page.getByRole("columnheader", { name: /^Type$/ });
    if (!(await type.isVisible())) test.skip(true, "no table at this width");

    await expect(type).not.toHaveAttribute("aria-sort", /.*/);
    await expect(type.getByRole("button")).toHaveCount(0);
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

    /*
      A checkbox row, addressed by its role rather than by a drawn box — which is
      what this line always meant and now finally does. The rows were
      `<button role="checkbox">`; `Form.tsx`'s `CheckRow` is a **real**
      `<input type="checkbox">`, whose role is implicit. `[role="checkbox"]` is a
      CSS *attribute* selector and does not match an implicit role, so it is
      `getByRole` — Playwright's own role engine — instead.
    */
    const first = page.getByRole("dialog").getByRole("checkbox").first();
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
    /* **Enter, because the picker's search is submit-gated now.** It used to fire
       a request per keystroke, and a coupon form can open this drawer four times.
       `fill()` alone would leave the list unfiltered and the count at 28. */
    await search.press("Enter");
    await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(1);
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
    await expect(page.getByRole("dialog").getByRole("checkbox").first()).toBeVisible();
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
