import { test, expect, type Page } from "@playwright/test";

/**
 * Coupling in the product-edit form: setting stock status to "rupture"
 * (outofstock) or "réappro" (onbackorder) should immediately zero the
 * quantity field, because leaving a positive count behind creates a
 * silent lie — the header says out of stock while inventory reports N
 * in the warehouse. The reverse direction (in stock → typed quantity)
 * is the operator's choice.
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

async function openProductWithManagedStock(page: Page, sku: string) {
  await page.goto(`/fr/products?sku=${sku}`);
  const row = page.locator("tbody tr, main li.ui-card").filter({ visible: true }).first();
  await expect(row).toBeVisible();
  await row.click();
  const peek = page.getByRole("dialog");
  await expect(peek).toBeVisible();
  await peek.getByRole("link", { name: /Ouvrir|فتح/ }).click();
  await page.waitForURL(/\/products\/\d+/);
  // Ensure managed stock so the quantity field is present.
  const manage = page.getByLabel(/Suivre le stock/i);
  if (!(await manage.isChecked())) await manage.click();
  await expect(page.getByLabel(/Quantité/i)).toBeVisible();
}

test.describe("product stock status", () => {
  test("switching to 'rupture' zeros the quantity in the form", async ({ page }) => {
    await signIn(page, "fr");
    // Use a real seeded SKU on the shop.
    await openProductWithManagedStock(page, "AC-PROBE-GADGET");

    const qty = page.getByLabel(/Quantité/i);
    await qty.fill("7");
    await expect(qty).toHaveValue("7");

    // Change stock status → "Rupture" via the Listbox picker.
    await page.getByLabel(/État du stock/i).click();
    await page.getByRole("option", { name: /Rupture/i }).click();

    await expect(qty).toHaveValue("0");
  });

  test("switching to 'réappro' also zeros the quantity", async ({ page }) => {
    await signIn(page, "fr");
    await openProductWithManagedStock(page, "AC-PROBE-GADGET");

    const qty = page.getByLabel(/Quantité/i);
    await qty.fill("5");
    await expect(qty).toHaveValue("5");

    await page.getByLabel(/État du stock/i).click();
    await page.getByRole("option", { name: /réappro|On backorder/i }).click();

    await expect(qty).toHaveValue("0");
  });

  test("switching back to 'en stock' leaves the quantity at 0", async ({ page }) => {
    // The operator's call — the form does not fabricate a positive
    // quantity on the way back.
    await signIn(page, "fr");
    await openProductWithManagedStock(page, "AC-PROBE-GADGET");

    await page.getByLabel(/État du stock/i).click();
    await page.getByRole("option", { name: /Rupture/i }).click();
    await expect(page.getByLabel(/Quantité/i)).toHaveValue("0");

    await page.getByLabel(/État du stock/i).click();
    await page.getByRole("option", { name: /En stock/i }).click();
    await expect(page.getByLabel(/Quantité/i)).toHaveValue("0");
  });
});
