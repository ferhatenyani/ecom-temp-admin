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
 */
test.describe("an address that does not exist", () => {
  test("renders a real 404 document rather than a root-layout error", async ({ page }) => {
    const response = await page.goto("/fr/nope");

    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { name: "Introuvable" })).toBeVisible();

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
    await expect(page.getByRole("heading", { name: "غير موجود" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Introuvable" })).toBeVisible();
  });

  test("offers a way back that is not the address that failed", async ({ page }) => {
    await page.goto("/fr/nope");
    await page.getByRole("link", { name: "Commandes" }).click();
    // Signed out, so the panel bounces to the login form — which is the correct
    // destination and the proof the link is real rather than decorative.
    await page.waitForURL(/\/fr\/(orders|login)/);
    await expect(page).not.toHaveURL(/nope/);
  });
});
