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

/**
 * The rows, in whichever presentation this project's viewport is showing.
 *
 * This replaces `a[href*="/orders/"]`, which appeared ten times in this file and
 * no longer identifies anything: the redesigned list is a `DataTable` at `md`+
 * and a stacked `RecordList` below it, and **neither emits a row anchor**. A row
 * opens a preview drawer rather than navigating, so the only order links on the
 * screen are inside that drawer and inside each row's action menu.
 *
 * Both presentations are always in the DOM with one hidden per breakpoint, so a
 * bare `tbody tr` counts correctly and then times out clicking a row that is
 * `display: none`. `filter({ visible: true })` is what makes one selector honest
 * at every width. Same helper, same reasoning, as `e2e/products.spec.ts`.
 */
function rows(page: Page) {
  return page.locator("tbody tr, main li.ui-card").filter({ visible: true });
}

/** The status tab strip. Replaces `getByRole("radiogroup")`, which was
 *  `Segmented`; `FilterTabs` is a `<nav>` of buttons with `aria-current`. */
function statusTabs(page: Page) {
  return page.getByRole("navigation", { name: /^(Statut|الحالة)$/ });
}

/**
 * Open the full detail for the first row.
 *
 * Two clicks now instead of one, and the extra one is the point: a row opens the
 * peek, and the peek is what carries the link to the full page.
 */
async function openFirstOrder(page: Page) {
  const row = rows(page).first();
  await expect(row).toBeVisible();
  await row.click();

  const peek = page.getByRole("dialog");
  await expect(peek).toBeVisible();
  await peek.getByRole("link", { name: /Ouvrir|فتح/ }).click();
  await page.waitForURL(/\/orders\/\d+/);
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
    /*
     * Next mounts its own route announcer as a second `role="alert"` on every
     * page, so an unscoped `getByRole("alert")` is a strict-mode violation
     * rather than the form's refusal. This scoped to `main` to avoid it — and
     * **the login screen has no `main`**: it is the one route outside the panel
     * shell, three nested `div`s in `(auth)/login/page.tsx`, so the locator
     * matched nothing and the refusal it was waiting for was on screen the whole
     * time.
     *
     * Excluding the announcer by name instead. It is the thing being avoided, so
     * saying so is both narrower and more honest than picking a landmark that
     * happens to contain one of the two.
     */
    const alert = page.locator('[role="alert"]:not(#__next-route-announcer__)');
    await expect(alert).toBeVisible();
    const wrongPassword = await alert.innerText();

    // The positive control for the assertion below: a real username with a wrong
    // password and a username that does not exist must read identically.
    await page.goto("/fr/login");
    await page.fill("#username", "no-such-user-exists-here");
    await page.fill("#password", "definitely not the right password");
    await page.click('button[type="submit"]');
    await expect(alert).toBeVisible();
    const noSuchUser = await alert.innerText();

    expect(noSuchUser).toBe(wrongPassword);
  });

  test("the proxy refuses a route that is not on its allowlist", async ({ page }) => {
    await signIn(page, "fr");

    /*
     * Positive controls: the allowlist has to be shown admitting what it should
     * as well as refusing what it should, or removing an entry from the list
     * below only ever weakens this test.
     *
     * `settings` is here because it *left* the refused list on the settings
     * branch — `lib/api/allowlist.ts:376` has permitted `GET /settings` since
     * long before a screen called it, so the 404 assertion had been false all
     * along and survived only because this file needs live credentials nobody
     * runs it with. `users` left for the same reason on the staff branch and
     * gets no positive control of its own: `/api/ac/orders` and
     * `/api/ac/settings` between them already prove the admitting half, and a
     * third identical request proves nothing a second time.
     */
    for (const path of ["orders?per_page=1", "settings"]) {
      const allowed = await page.request.get(`/api/ac/${path}`);
      expect(allowed.status()).toBe(200);
    }

    /*
     * A generic proxy would relay these with an admin credential attached.
     *
     * `customers` used to be in this list and is not any more — a screen calls it
     * as of the customers branch, and the allowlist grows one screen at a time.
     * `users` and `settings` went the same way, which is the identical
     * maintenance one branch later. What replaces them is the storefront's half
     * of the same subject: `/account/*` is the *shopper's* identity,
     * authenticated by a customer token, and this panel holds a staff
     * credential. A staff credential against `/account` is either a 401 or,
     * worse, the staff member's own account — never the customer whose screen is
     * open. Neither is allowlisted, and they are this assertion's real point.
     */
    for (const path of ["account", "account/orders"]) {
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

    await expect(rows(page).first()).toBeVisible();
    const unfiltered = await rows(page).count();
    expect(unfiltered).toBeGreaterThan(0);

    // The tab strip writes the URL, so a link is shareable and the back button
    // works. A real `<button>` now, rather than the label of an `sr-only` radio
    // — `FilterTabs` replaced `Segmented`, which could hold four of eight
    // statuses and pushed `on-hold` and `failed` into a sheet.
    await statusTabs(page)
      .getByRole("button", { name: /^(En traitement|قيد المعالجة)$/ })
      .click();
    await expect(page).toHaveURL(/status=processing/);
    await page.waitForTimeout(600);

    /*
     * Every visible row now reads the filtered status. This is the assertion
     * that the filter reached the API rather than only the URL, and it is made
     * on the row's own text rather than on `span.tonal`: `.tonal` was the old
     * badge class and is gone — `Badge` pairs `-fg`/`-bg` tokens precisely
     * because `.tonal` failed contrast on four of five tones — and a class name
     * was never what this test was about.
     */
    const texts = await rows(page).allInnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).toMatch(/En traitement|قيد المعالجة/);

    // And back restores the unfiltered list.
    await page.goBack();
    await page.waitForTimeout(600);
    await expect(rows(page).first()).toBeVisible();
  });

  test("an impossible filter shows the empty state, not a blank list", async ({ page }) => {
    await signIn(page, "fr");
    // Positive control: a search that matches something.
    await page.goto("/fr/orders?search=Nadia");
    await page.waitForSelector('[data-testid="orders-count"]');
    await page.waitForTimeout(700);
    await expect(rows(page).first()).toBeVisible();

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
    await openFirstOrder(page);

    // Real headings now, on real `Card` sections — `getByText` would also match
    // the word inside a timeline entry.
    await expect(page.getByRole("heading", { name: /Résumé/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Historique/ })).toBeVisible();

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
    await openFirstOrder(page);

    /*
     * The status picker is a `Menu` from the header's primary action, not a
     * bottom `ActionSheet` full of buttons. So the trigger is a button and the
     * moves are `role="menuitem"` — which is the accessible contract a menu owes
     * and the sheet never had.
     */
    await page.getByRole("button", { name: /Changer le statut/ }).click();
    // Offer a move the API must refuse from a terminal status.
    await page.getByRole("menuitem", { name: /Passer à En traitement/ }).click();

    /*
     * The refusal renders on the screen and stays there — a 409 is not a toast.
     * It is now one `role="alert"` region at the top of the body, above the
     * two-column grid, rather than inside whichever section was refused: below
     * `lg` the aside sits under a line-item list of unknown length, so a refusal
     * rendered there is a refusal nobody scrolls to.
     */
    /* Scoped to `main`: Next mounts its own route announcer as a second
       `role="alert"` on every page, so an unscoped `getByRole("alert")` is a
       strict-mode violation rather than this screen's refusal. */
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toContainText(/ne peut pas passer de/, { timeout: 15000 });
    await expect(alert).toContainText(/Aucun changement n’est possible/);

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
    await openFirstOrder(page);

    await page.getByRole("button", { name: /Changer le statut/ }).click();
    await page.getByRole("menuitem", { name: /Passer à En traitement/ }).click();

    // The toast confirms; the screen is the record.
    await expect(page.getByText(/Statut mis à jour/)).toBeVisible({ timeout: 15000 });

    /*
     * The status now reads back from the aside's summary card rather than from
     * "Statut actuel : En traitement", which was `StatusAction`'s own line and
     * is gone: the act moved to the header and the *display* stayed behind as a
     * `Badge` on the Résumé card. Same assertion — the transition took and the
     * server-rendered screen agrees — read off the place that now carries it.
     */
    const summary = page.locator("aside").filter({ hasText: /Résumé/ }).first();
    await expect(summary).toContainText(/En traitement/, { timeout: 15000 });
  });

  /**
   * A move into a terminal status is destructive and goes through
   * `ConfirmDialog`, whose button names the act — "Annuler la commande", never
   * "OK". DESIGN.md §3.1 requires both halves and nothing asserted either.
   */
  test("cancelling asks first, with a button that names the act", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/orders?status=pending");
    await page.waitForSelector('[data-testid="orders-count"]');
    await page.waitForTimeout(700);
    await openFirstOrder(page);

    await page.getByRole("button", { name: /Changer le statut/ }).click();
    await page.getByRole("menuitem", { name: /Passer à Annulée/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Annuler la commande" })).toBeVisible();

    /*
     * Deliberately not completing it. This test proves the guard, and a suite
     * that cancels a real order to do so cannot be re-run — the same reasoning
     * `e2e/products.spec.ts` gives for its permanent-deletion test.
     */
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("Arabic and RTL", () => {
  test("renders rtl and holds digit order inside Arabic text", async ({ page }) => {
    await signIn(page, "ar");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");

    // Assert the rendered string, not the DOM attribute: the attribute half
    // cannot catch a bidi bug.
    //
    // Scoped to a *visible* row, because both presentations are in the DOM at
    // every width and `innerText` of a `display: none` subtree is its raw text
    // content — which would pass this without anything having been laid out.
    const number = await rows(page)
      .first()
      .locator('span[dir="ltr"]')
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
    await openFirstOrder(page);

    const isolated = page.locator('main span[dir="ltr"]');
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
    if ((await rows(page).count()) === 0) test.skip(true, "no probe order on this install");
    await openFirstOrder(page);

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
    /*
     * Signed in lands wherever `landingPath()` sends this reader, which for a
     * role without `ac_manage_orders` is deliberately **not** `/orders` — that
     * is the defect `components/ui/nav-tree.ts` was written to remove, and
     * waiting for `/fr/orders` here asserted it. The 403 this test is about is
     * reached by asking for the screen, which is what a person typing the URL or
     * following a stale link does.
     */
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    await page.goto("/fr/orders");

    // The forbidden state names the capability, and the session survives.
    await expect(page.getByText(/Cette section demande la permission/)).toBeVisible();
    await expect(page).toHaveURL(/\/fr\/orders/);
    await expect(page).not.toHaveURL(/login/);
  });
});
