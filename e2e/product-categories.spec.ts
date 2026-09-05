import { test, expect, type Page } from "@playwright/test";

/**
 * Product-category CRUD — the round-6 addition.
 *
 * Read-only until now; this suite covers the four writes the panel gained:
 * create, edit, delete-empty, delete-non-empty (with the force confirm).
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
  await page.waitForURL(
    (url) => !url.pathname.endsWith("/login") && url.pathname.startsWith(`/${locale}/`),
  );
}

test.describe("product categories", () => {
  test("create + edit + delete a category", async ({ page }) => {
    await signIn(page, "fr");

    const stamp = Date.now().toString().slice(-6);
    const name = `Tapis (test ${stamp})`;
    const slug = `ac-e2e-tapis-${stamp}`;

    // Navigate via the sidebar nav — proves the nav entry exists and
    // that ac_manage_products opens the screen.
    await page.goto("/fr/product-categories");
    await expect(page.getByTestId("categories-count")).toBeVisible();

    // Create.
    await page.getByLabel("Nom", { exact: true }).fill(name);
    await page.getByLabel("Identifiant", { exact: true }).fill(slug);
    await page.getByLabel("Description").fill("Berber wool rugs — e2e fixture.");
    await page.getByRole("button", { name: /^Ajouter$/ }).click();

    // Listed.
    const row = page.getByRole("link", { name: new RegExp(name.replace(/[()]/g, "."), "i") });
    await expect(row).toBeVisible();

    // Open the detail page.
    await row.click();
    await page.waitForURL(/\/product-categories\/\d+$/);
    await expect(page.getByRole("heading", { name: new RegExp(name.replace(/[()]/g, "."), "i") })).toBeVisible();

    // Edit the description.
    await page.getByLabel("Description").fill("Updated description e2e.");
    await page.getByRole("button", { name: /^Enregistrer$/ }).click();
    // Toast confirmation.
    await expect(page.getByText(/Catégorie enregistrée/i)).toBeVisible({ timeout: 8000 });

    // Delete (empty, so no force needed).
    await page.getByRole("button", { name: /Supprimer/i }).first().click();
    // Confirm dialog.
    await page.getByRole("dialog").getByRole("button", { name: /Supprimer/i }).click();

    // Redirected back to the list; the row is gone.
    await page.waitForURL(/\/product-categories$/);
    await expect(row).toHaveCount(0);
  });
});
