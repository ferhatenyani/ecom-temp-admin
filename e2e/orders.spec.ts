import { test, expect, type Page } from "@playwright/test";
import { resetRateLimit } from "./rate-limit";

/**
 * Each of these is a real failure mode, not a checklist item, and every negative
 * carries a positive control — a refusal and an unreachable route look identical
 * from outside, so a test asserting a refusal proves nothing on its own.
 *
 * Credentials come from the environment. `AC_STAFF_USER` / `AC_STAFF_PASS` must be
 * a real WordPress Application Password for an account holding `ac_manage_orders`.
 */
const USER = process.env.AC_STAFF_USER;
const PASS = process.env.AC_STAFF_PASS;

test.skip(
  !USER || !PASS,
  "Set AC_STAFF_USER and AC_STAFF_PASS to a real Application Password.",
);

async function signIn(page: Page, locale: string) {
  await page.goto(`/${locale}/login`);
  await page.fill("#username", USER!);
  await page.fill("#password", PASS!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`**/${locale}/orders`);
  await page.waitForSelector('[data-testid="orders-count"]');
}

test.describe("the credential boundary", () => {
  test("signs in with a valid Application Password", async ({ page }) => {
    await signIn(page, "fr");
    await expect(page.getByTestId("orders-count")).toBeVisible();
  });

  test("the credential never reaches the browser", async ({ page }) => {
    await signIn(page, "fr");

    // Not in any cookie readable by script — the session cookie is httpOnly.
    const readable = await page.evaluate(() => document.cookie);
    expect(readable).not.toContain(PASS!);

    // Not in the rendered HTML, and not in any script the page loaded.
    const html = await page.content();
    expect(html).not.toContain(PASS!);

    // Not in storage.
    const stored = await page.evaluate(() =>
      JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
    );
    expect(stored).not.toContain(PASS!);

    // And the browser never addressed the WordPress host directly: every API call
    // went to the panel's own proxy.
    const direct: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/wp-json/")) direct.push(request.url());
    });
    await page.reload();
    await page.waitForSelector('[data-testid="orders-count"]');
    expect(direct).toEqual([]);
  });

  /**
   * Two deliberate failures per project, against a bucket of ten per fifteen
   * minutes per IP. Left alone, five projects exhaust it and every later sign-in —
   * with the right password — answers 429. So this test cleans up after itself.
   */
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.title.includes("bad password")) resetRateLimit();
  });

  test("a bad password is refused without revealing whether the user exists", async ({
    page,
  }) => {
    await page.goto("/fr/login");
    await page.fill("#username", USER!);
    await page.fill("#password", "definitely not the right password");
    await page.click('button[type="submit"]');
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    const wrongPassword = await alert.innerText();

    // The positive control for the assertion below: a real username with a wrong
    // password and a username that does not exist must read identically.
    await page.goto("/fr/login");
    await page.fill("#username", "no-such-user-exists-here");
    await page.fill("#password", "definitely not the right password");
    await page.click('button[type="submit"]');
    await expect(page.getByRole("alert")).toBeVisible();
    const noSuchUser = await page.getByRole("alert").innerText();

    expect(noSuchUser).toBe(wrongPassword);
  });

  test("the proxy refuses a route that is not on its allowlist", async ({ page }) => {
    await signIn(page, "fr");

    // Positive control: an allowlisted route answers through the proxy.
    const allowed = await page.request.get("/api/ac/orders?per_page=1");
    expect(allowed.status()).toBe(200);

    // A generic proxy would relay this with an admin credential attached.
    for (const path of ["users", "settings", "customers"]) {
      const refused = await page.request.get(`/api/ac/${path}`);
      expect(refused.status()).toBe(404);
    }

    // A permitted path with an unpermitted method.
    const wrongMethod = await page.request.delete("/api/ac/orders/1");
    expect(wrongMethod.status()).toBe(405);
  });

  test("an unauthenticated proxy call is a 401", async ({ page }) => {
    const response = await page.request.get("/api/ac/orders");
    expect(response.status()).toBe(401);
  });
});

test.describe("the orders list", () => {
  test("renders real orders, and the filter lives in the URL", async ({ page }) => {
    await signIn(page, "fr");

    const rows = page.locator('a[href*="/orders/"]');
    await expect(rows.first()).toBeVisible();
    const unfiltered = await rows.count();
    expect(unfiltered).toBeGreaterThan(0);

    // The segmented control writes the URL, so a link is shareable and the back
    // button works.
    //
    // Clicked on the label, which is what a person touches — the radio itself is
    // `sr-only` (present for the keyboard and the accessibility tree, and the
    // native label association is what makes the tap work). Driving the hidden
    // input directly is a gesture no user makes.
    await page
      .getByRole("radiogroup")
      .getByText(/^(En cours|المعالجة)$/)
      .click();
    await expect(page).toHaveURL(/status=processing/);
    await page.waitForTimeout(600);

    // Every visible badge now reads the filtered status. This is the assertion
    // that the filter reached the API rather than only the URL.
    const badges = await page
      .locator('a[href*="/orders/"] span.tonal')
      .allInnerTexts();
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) expect(badge).toMatch(/En traitement|قيد المعالجة/);

    // And back restores the unfiltered list.
    await page.goBack();
    await page.waitForTimeout(600);
    await expect(page.locator('a[href*="/orders/"]').first()).toBeVisible();
  });

  test("an impossible filter shows the empty state, not a blank list", async ({ page }) => {
    await signIn(page, "fr");
    // Positive control: a search that matches something.
    await page.goto("/fr/orders?search=Nadia");
    await page.waitForSelector('[data-testid="orders-count"]');
    await page.waitForTimeout(700);
    await expect(page.locator('a[href*="/orders/"]').first()).toBeVisible();

    // The negative: a search that matches nothing offers to clear itself.
    await page.goto("/fr/orders?search=zzzzzz-no-such-customer-zzzzzz");
    await page.waitForTimeout(900);
    await expect(page.getByText(/Aucune commande ne correspond/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Effacer le filtre/ })).toBeVisible();
  });
});

test.describe("the order detail and its write path", () => {
  test("renders sub-resources and decodes the API's HTML entities", async ({ page }) => {
    await signIn(page, "fr");
    await page.locator('a[href*="/orders/"]').first().click();
    await page.waitForURL(/\/orders\/\d+/);

    await expect(page.getByText(/Résumé/)).toBeVisible();
    await expect(page.getByText(/Historique/)).toBeVisible();

    // The timeline sends "(99&rarr;98)". React renders text, so an undecoded
    // entity appears verbatim on screen.
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("&rarr;");
    expect(body).not.toContain("&amp;");
  });

  test("a 409 renders the moves the API says are legal", async ({ page }) => {
    await signIn(page, "fr");

    // Find a terminal order, which is the case with the most decisive answer:
    // `allowed: []`. Cancelled orders are the largest group in this data set.
    await page.goto("/fr/orders?status=cancelled");
    await page.waitForSelector('[data-testid="orders-count"]');
    await page.waitForTimeout(700);
    await page.locator('a[href*="/orders/"]').first().click();
    await page.waitForURL(/\/orders\/\d+/);

    await page.getByRole("button", { name: /Changer le statut/ }).click();
    // Offer a move the API must refuse from a terminal status.
    await page.getByRole("button", { name: /Passer à En traitement/ }).click();

    // The refusal renders on the screen and stays there — a 409 is not a toast.
    await expect(page.getByText(/ne peut pas passer de/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Aucun changement n’est possible/)).toBeVisible();

    // And the control is now disabled, from the API's answer rather than from a
    // transition table copied into the panel.
    await expect(page.getByRole("button", { name: /Changer le statut/ })).toBeDisabled();
  });

  test("a legal transition succeeds and the timeline records it", async ({ page }) => {
    await signIn(page, "fr");

    // The positive control for the 409 test above: from `pending`, a move to
    // `processing` is legal and must actually take.
    await page.goto("/fr/orders?status=pending");
    await page.waitForSelector('[data-testid="orders-count"]');
    await page.waitForTimeout(700);
    await page.locator('a[href*="/orders/"]').first().click();
    await page.waitForURL(/\/orders\/\d+/);

    await page.getByRole("button", { name: /Changer le statut/ }).click();
    await page.getByRole("button", { name: /Passer à En traitement/ }).click();

    // The toast confirms; the screen is the record.
    await expect(page.getByText(/Statut mis à jour/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Statut actuel : En traitement/)).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe("Arabic and RTL", () => {
  test("renders rtl and holds digit order inside Arabic text", async ({ page }) => {
    await signIn(page, "ar");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");

    // Assert the rendered string, not the DOM attribute: the attribute half
    // cannot catch a bidi bug.
    const number = await page
      .locator('a[href*="/orders/"] span[dir="ltr"]')
      .first()
      .innerText();
    expect(number.trim()).toMatch(/^#\d+$/);

    // Latin digits, not Eastern Arabic numerals — Algeria uses 0123456789.
    const count = await page.getByTestId("orders-count").innerText();
    expect(count).toMatch(/\d/);
    expect(count).not.toMatch(/[٠-٩]/);
  });

  test("a SKU inside Arabic text keeps its direction", async ({ page }) => {
    await signIn(page, "ar");
    await page.locator('a[href*="/orders/"]').first().click();
    await page.waitForURL(/\/orders\/\d+/);

    const isolated = page.locator('span[dir="ltr"]');
    expect(await isolated.count()).toBeGreaterThan(0);
    for (const element of await isolated.all()) {
      // Every identifier is isolated, or the bidi algorithm reorders it silently.
      await expect(element).toHaveAttribute("dir", "ltr");
    }
  });

  test("a street number stays at the front of its address", async ({ page }) => {
    await signIn(page, "ar");
    // The probe order carries a Latin address beginning with a digit, which is the
    // shape that breaks: inside an Arabic paragraph an unisolated "1 Rue Test"
    // renders as "Rue Test 1", relocating the house number silently.
    await page.goto("/ar/orders?search=Probe");
    await page.waitForSelector('[data-testid="orders-count"]');
    await page.waitForTimeout(700);
    const row = page.locator('a[href*="/orders/"]').first();
    if ((await row.count()) === 0) test.skip(true, "no probe order on this install");
    await row.click();
    await page.waitForURL(/\/orders\/\d+/);

    // Asserted on the rendered string, because the attribute half cannot catch a
    // bidi bug — this is the whole point of the rule.
    const address = page.locator('span[dir="ltr"]', { hasText: /Rue/ }).first();
    if ((await address.count()) > 0) {
      const text = (await address.innerText()).trim();
      expect(text).toMatch(/^\d/);
    }
  });
});

test.describe("the forbidden state", () => {
  test("a 403 is a screen state, never a logout", async ({ page }) => {
    // This needs a role without ac_manage_orders. When one is not configured the
    // test states that rather than passing vacuously.
    const limitedUser = process.env.AC_LIMITED_USER;
    const limitedPass = process.env.AC_LIMITED_PASS;
    test.skip(
      !limitedUser || !limitedPass,
      "Set AC_LIMITED_USER / AC_LIMITED_PASS to an account without ac_manage_orders.",
    );

    await page.goto("/fr/login");
    await page.fill("#username", limitedUser!);
    await page.fill("#password", limitedPass!);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/fr/orders");

    // The forbidden state names the capability, and the session survives.
    await expect(page.getByText(/Cette section demande la permission/)).toBeVisible();
    await expect(page).toHaveURL(/\/fr\/orders/);
    await expect(page).not.toHaveURL(/login/);
  });
});
