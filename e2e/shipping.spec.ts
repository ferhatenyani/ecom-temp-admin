import { test, expect, type Page } from "@playwright/test";

/**
 * Shipping, payments and cash on delivery.
 *
 * **The forbidden fixture on this branch is a Manager**, and that is a change
 * from every branch before it. The two-tier collapse retired the five
 * intermediate roles, so a Support Agent no longer describes any live account —
 * but Manager does, and it is genuinely split across this branch's three
 * subjects: 200 on shipping and COD, **403 on payments**. One credential, a real
 * refusal and a real success, with the Super Admin answering 200 from the same
 * URL in the same run as the control.
 *
 * `AC_MANAGER_USER` is the fourth credential `scripts/test.sh` mints. The suite
 * skips the payments half rather than failing when it is absent, because a
 * missing credential is an operator problem and a red test that means "you did
 * not export a variable" is a test people learn to ignore.
 */
const USER = process.env.AC_STAFF_USER;
const PASS = process.env.AC_STAFF_PASS;
const MANAGER_USER = process.env.AC_MANAGER_USER;
const MANAGER_PASS = process.env.AC_MANAGER_PASS;

test.skip(
  !USER || !PASS,
  "Set AC_STAFF_USER and AC_STAFF_PASS to a real Application Password.",
);

async function signIn(page: Page, locale: string, user = USER!, pass = PASS!) {
  await page.goto(`/${locale}/login`);
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await page.click('button[type="submit"]');
  await page.waitForURL(new RegExp(`/${locale}/(orders|products|coupons|shipping)`));
}

test.describe("the shipping tariff", () => {
  test("resolves commune over wilaya over national, and shows what it beat", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/shipping");

    // The tariff, narrowest first — the order the rules win in.
    await expect(page.getByText("Ce que la boutique facture")).toBeVisible();
    const scopes = await page
      .locator("section")
      .filter({ hasText: "Ce que la boutique facture" })
      .locator("span")
      .filter({ hasText: /^(Commune|Wilaya|National)$/ })
      .allInnerTexts();
    expect(scopes.slice(0, 3)).toEqual(["Commune", "Wilaya", "National"]);

    /*
     * The resolver, against the three fixture rules. Alger Centre (commune 484
     * in wilaya 16) is covered by all three, so the commune rule must win — this
     * is the assertion the whole editor exists for, and the API answered 350.00
     * for the same destination when it was measured.
     */
    const wilaya = page.getByLabel("Wilaya", { exact: true });
    await expect(wilaya).toBeEnabled();
    await wilaya.selectOption({ label: "Algiers" });

    const commune = page.getByLabel("Commune", { exact: true });
    await expect(commune).toBeEnabled({ timeout: 15000 });
    await commune.selectOption({ label: "Alger Centre" });

    // The price comes from `GET /shipping/rates`, not from this page.
    await expect(page.getByText("Prix retenu")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/350,00/)).toBeVisible({ timeout: 15000 });

    // And the rules it beat are shown, because "why is this 350 DA" is answered
    // by the ones that lost.
    const resolver = page
      .locator("section")
      .filter({ hasText: "Simuler une destination" });
    await expect(resolver.getByText("Règles battues")).toBeVisible();
    // Scoped to the resolver: both figures are also in the tariff table above,
    // and an unscoped match would pass while proving nothing about resolution.
    await expect(resolver.getByText(/500,00/)).toBeVisible();
    await expect(resolver.getByText(/800,00/)).toBeVisible();
  });

  test("a wilaya with no commune rule falls through to the wilaya rule", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/shipping");

    await page.getByLabel("Wilaya", { exact: true }).selectOption({ label: "Algiers" });
    const commune = page.getByLabel("Commune", { exact: true });
    await expect(commune).toBeEnabled({ timeout: 15000 });
    // Ain Taya is in wilaya 16 and has no commune rule of its own.
    await commune.selectOption({ label: "Ain Taya" });

    await expect(page.getByText(/500,00/)).toBeVisible({ timeout: 15000 });
    // The positive control: the commune rule's price is *not* what resolved.
    const resolved = page
      .locator("section")
      .filter({ hasText: "Simuler une destination" });
    await expect(resolved.getByText(/350,00/)).toHaveCount(0);
  });

  test("the commune picker is inert until a wilaya is chosen", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/shipping");

    await expect(page.getByText("Choisissez d’abord une wilaya")).toBeVisible();
    /*
     * `^Commune` rather than an exact match, and the reason is a property of the
     * `Field` primitive worth knowing: **the hint renders inside the `<label>`**,
     * so it becomes part of the control's accessible name. With no wilaya chosen
     * the name is "Commune Choisissez d'abord une wilaya"; once one is chosen the
     * hint disappears and the name becomes "Commune". An exact match therefore
     * passes in one state and fails in the other, which is what this test found.
     *
     * `FieldError` already uses `aria-describedby` for its message, so the
     * primitive describes errors and *names* hints — an inconsistency shared by
     * every form in the panel, and a change too wide for this branch.
     */
    await expect(page.getByLabel(/^Commune/)).toBeDisabled();
  });
});

test.describe("parcels", () => {
  test("the status filter is real, and an unmatched one says so", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/shipping?view=parcels");

    // The positive control: with no filter there are parcels.
    await expect(page.locator("text=/MAN-|TRK-|FAKE-/").first()).toBeVisible({
      timeout: 15000,
    });

    /*
     * `pending` is a real status the API accepts and no parcel in this shop
     * holds — measured, `?status=pending` is 200 with 0 rows while `?status=zzz`
     * is a 400. So this asserts the filter reached the server and came back
     * empty, not that the panel dropped it.
     */
    await page.goto("/fr/shipping?view=parcels&status=pending");
    await expect(page.getByText("Aucun colis avec ce statut.")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("button", { name: "Tout afficher" })).toBeVisible();
  });

  test("a parcel opens its own sheet with the provider's own status word", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/shipping?view=parcels");

    const row = page.locator("button").filter({ hasText: /MAN-|TRK-/ }).first();
    await expect(row).toBeEnabled({ timeout: 15000 });
    await row.click();

    await expect(page.getByText("Suivi", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Transporteur", { exact: true })).toBeVisible();
  });
});

test.describe("the order detail's new sections", () => {
  /**
   * Order 3939 is the branch's fixture: several finished parcels, several
   * transactions and a COD record. It is found by number rather than by position,
   * because a list ordered by date puts a different order first every run.
   */
  const ORDER = "/fr/orders/3939";

  test("a parcel's status never moves the order, and the section says so", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto(ORDER);

    await expect(page.getByText("Le statut du colis ne fait jamais avancer la commande.")).toBeVisible();
    // Both statuses are on screen and neither is the other.
    await expect(page.getByText("En traitement").first()).toBeVisible();
    await expect(page.locator("text=/MAN-3939-/").first()).toBeVisible();
  });

  test("several transactions per order render as several, not as a duplicate", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto(ORDER);

    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
    await expect(
      page.getByText(/Plusieurs transactions par commande sont normales/),
    ).toBeVisible();
  });

  test("COD offers exactly the outcomes the server allows", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto(ORDER);

    await expect(
      page.getByRole("heading", { name: "Contre-remboursement", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/une issue d’appel ne fait pas avancer la commande/),
    ).toBeVisible();

    const record = page.getByRole("button", { name: "Enregistrer un appel" });
    await expect(record).toBeEnabled({ timeout: 15000 });
    await record.click();

    /*
     * `allowed_outcomes` on a `pending` record is
     * `["confirmed","rejected","unreachable"]`, and the sheet renders one button
     * per entry — never a table the panel carries. All three, and nothing else.
     */
    await expect(page.getByRole("button", { name: "Le client confirme" })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("button", { name: "Le client refuse" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Injoignable" })).toBeVisible();
  });
});

test.describe("what a Manager may and may not reach", () => {
  test.skip(
    !MANAGER_USER || !MANAGER_PASS,
    "Set AC_MANAGER_USER and AC_MANAGER_PASS — scripts/test.sh mints them.",
  );

  test("shipping is permitted and payments is refused, with a control for each", async ({
    page,
  }) => {
    await signIn(page, "fr", MANAGER_USER!, MANAGER_PASS!);

    // The positive half: `ac_manage_shipping` is a capability this tier holds.
    await page.goto("/fr/shipping");
    await expect(page.getByText("Ce que la boutique facture")).toBeVisible({
      timeout: 15000,
    });

    // The negative half, on the same run: `ac_manage_payments` is Super Admin's.
    await page.goto("/fr/payments");
    await expect(page.getByText(/permission/i).first()).toBeVisible({ timeout: 15000 });

    /*
     * And the report they *are* entitled to still renders. `/cod/statistics` is
     * `ac_view_analytics`, which both tiers hold — so refusing it to keep one
     * screen tidy would be the panel inventing a rule the API does not have.
     */
    await expect(page.getByText("Contre-remboursement, toute la boutique")).toBeVisible();
  });

  test("the payments destination is absent from More rather than refused", async ({
    page,
  }) => {
    await signIn(page, "fr", MANAGER_USER!, MANAGER_PASS!);
    await page.goto("/fr/more");

    // Shipping is offered…
    await expect(page.getByRole("link", { name: "Livraison" })).toBeVisible({
      timeout: 15000,
    });
    // …and Payments is simply not there, the same treatment every other
    // capability-gated destination gets.
    await expect(page.getByRole("link", { name: "Paiements" })).toHaveCount(0);
  });

  test("a Super Admin reaches both, which is what makes the refusal meaningful", async ({
    page,
  }) => {
    await signIn(page, "fr");

    await page.goto("/fr/payments");
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/fr/more");
    await expect(page.getByRole("link", { name: "Paiements" })).toBeVisible();
  });
});

test.describe("the COD funnel's two confirmed counts", () => {
  test("names the scope of every figure", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/payments");

    await expect(page.getByText("Contre-remboursement, toute la boutique")).toBeVisible({
      timeout: 15000,
    });

    /*
     * The two counts that look like the same count. Both are on screen, each
     * with its own label, and the note between them says which question each
     * answers — the customers-statistics lesson, in the place it bites hardest.
     */
    await expect(page.getByText("Actuellement confirmées")).toBeVisible();
    await expect(page.getByText("Confirmées au moins une fois")).toBeVisible();
    await expect(page.getByText(/Deux comptes de « confirmées » coexistent/)).toBeVisible();

    // Every figure carries a scope; none is printed bare.
    await expect(page.getByText("état actuel").first()).toBeVisible();
    await expect(page.getByText("cumul").first()).toBeVisible();
  });
});

test.describe("Arabic", () => {
  test("renders rtl and keeps a tracking number's digit order", async ({ page }) => {
    await signIn(page, "ar");
    await page.goto("/ar/shipping?view=parcels");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    /*
     * The rendered string, not the DOM attribute — the attribute half cannot
     * catch a bidi bug. A tracking number reordered by the bidi algorithm is a
     * different tracking number, and the customer reading it back gets nothing.
     */
    const tracking = page.locator("text=/MAN-\\d+-\\d+/").first();
    await expect(tracking).toBeVisible({ timeout: 15000 });
    const text = await tracking.innerText();
    expect(text).toMatch(/MAN-\d+-\d+/);
  });

  test("the tariff names the country rather than repeating its own badge", async ({
    page,
  }) => {
    await signIn(page, "ar");
    await page.goto("/ar/shipping");

    // The national row read "وطني · وطني" — the scope badge printed twice — until
    // a screenshot showed it. The destination is the place, not the scope.
    await expect(page.getByText("كل الجزائر")).toBeVisible({ timeout: 15000 });
  });
});
