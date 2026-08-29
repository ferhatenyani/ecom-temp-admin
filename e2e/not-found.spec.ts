import { test, expect } from "@playwright/test";

/**
 * The 404 for an address that matches no route.
 *
 * This has its own file because it belongs to the shell rather than to any
 * screen, and because the defect it guards is invisible from inside the app:
 * `app/layout.tsx` returns bare `children` on purpose — `lang` and `dir` need a
 * locale the root does not have — so anything rendering *outside*
 * `app/[locale]/layout.tsx` has no document tags. Next's built-in global
 * not-found is exactly that, and every mistyped URL answered with a runtime
 * error, "Missing <html> and <body> tags in the root layout", rather than a 404.
 *
 * Signed out on purpose. This screen is reachable before anyone has a session,
 * and it must not bounce to the login form or assume one.
 *
 * **Three of these assert a 404 *status*, and that is what forbids an
 * `app/loading.tsx`.** `loading.md`'s Status Codes section says the response body
 * starts streaming the moment a Suspense fallback renders, and that the status
 * cannot be changed once it has — so a `loading.tsx` in this segment would turn
 * every one of these into a 200 with a `noindex` tag. The login branch checked
 * the docs before deciding, and `app/not-found.tsx` carries the citation.
 *
 * **The three heading assertions carry `level: 1`, and that is a repair.** They
 * were `getByRole("heading", { name })`, which matches any of the six levels — so
 * when this screen's only heading was an `<h2>` from `EmptyState` they all passed
 * over a document with **no `<h1>` at all**. The capture harness found it and
 * this file could not. The level is now part of what is asserted.
 */
test.describe("an address that does not exist", () => {
  test("renders a real 404 document rather than a root-layout error", async ({ page }) => {
    const response = await page.goto("/fr/nope");

    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(
      page.getByRole("heading", { level: 1, name: "Introuvable" }),
    ).toBeVisible();

    // The failure mode this exists for, asserted directly: Next's error overlay
    // naming the missing tags.
    await expect(page.getByText(/Missing <html> and <body>/)).toHaveCount(0);
  });

  /**
   * `getLocale()` still resolves here even though the component sits outside the
   * `[locale]` segment — the proxy has already populated the request scope. So a
   * 404 under `/ar/` is in Arabic and mirrored, not French.
   */
  test("speaks the locale in the URL, and mirrors", async ({ page }) => {
    const response = await page.goto("/ar/nope");

    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { level: 1, name: "غير موجود" }),
    ).toBeVisible();
  });

  /**
   * An unknown locale is not a locale. `app/[locale]/layout.tsx` calls
   * `notFound()` for one, and that throw comes *from the layout*, so the boundary
   * has to be above it — which is the root file this suite covers.
   */
  test("falls back to the default locale for an unknown one", async ({ page }) => {
    const response = await page.goto("/xx/orders");

    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(
      page.getByRole("heading", { level: 1, name: "Introuvable" }),
    ).toBeVisible();
  });

  /**
   * The label changed and the assertion did not.
   *
   * It used to read "Commandes" and point at `/fr/orders` — a destination this
   * screen cannot promise. DECISIONS.md §11 measures a Support Agent as **403 on
   * `/orders`**, and this page is reachable *signed out*, where it does not know
   * who is reading. It goes to the panel root now, which resolves the front door
   * per capability on the other side, and its label names the panel rather than
   * any screen in it.
   */
  test("offers a way back that is not the address that failed", async ({ page }) => {
    await page.goto("/fr/nope");
    await page.getByRole("link", { name: "Retour au panneau" }).click();
    // Signed out, so the panel bounces to the login form — which is the correct
    // destination and the proof the link is real rather than decorative.
    await page.waitForURL(/\/fr\/(login|orders|customers|products|audit)/);
    await expect(page).not.toHaveURL(/nope/);
  });
});
