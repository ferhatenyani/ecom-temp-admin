import { test, expect, type Page } from "@playwright/test";

/**
 * Low stock, the lookup, the adjustment and the ledger.
 *
 * Every negative carries a positive control, because a refusal and an
 * unreachable route look identical from outside — `/inventory?nonsense=zzz`
 * answers 200 with all 33 rows, so "the list got shorter" only means something
 * beside a case where it did not.
 *
 * **Products are found by SKU, never by id**, for the reason the products suite
 * records: the backend's own suites delete and recreate their fixtures on every
 * run over there, so an id is stable only until the next one.
 */
const USER = process.env.AC_STAFF_USER;
const PASS = process.env.AC_STAFF_PASS;
const LIMITED_USER = process.env.AC_LIMITED_USER;
const LIMITED_PASS = process.env.AC_LIMITED_PASS;

test.skip(
  !USER || !PASS,
  "Set AC_STAFF_USER and AC_STAFF_PASS to a real Application Password.",
);

async function signIn(page: Page, locale: string, user = USER!, pass = PASS!) {
  await page.goto(`/${locale}/login`);
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await page.click('button[type="submit"]');
  await page.waitForURL(new RegExp(`/${locale}/(orders|products|inventory)`));
}

async function openInventory(page: Page, locale: string, query = "") {
  await page.goto(`/${locale}/inventory${query}`);
  await page.waitForSelector('[data-testid="inventory-count"]');
}

/**
 * The ledger, waited on properly.
 *
 * `[data-testid="movements-count"]` renders immediately with a total of zero
 * while the client query is still pending, so waiting on the element alone reads
 * the placeholder — which is how "the reason filter returns 0 rows" was reported
 * against a filter that demonstrably returns 34.
 */
async function openMoves(page: Page, locale: string, query = "") {
  await page.goto(`/${locale}/inventory?view=moves${query}`);
  await page.waitForSelector('[data-testid="movements-count"]');
  // The count element renders immediately with a total of zero while the client
  // query is still pending, so waiting on the element is waiting on a
  // placeholder. Wait for the total to settle to a real figure instead.
  await expect(page.getByTestId("movements-count")).toContainText(/\d/, {
    timeout: 15000,
  });
}

/** A count line — "1 155 mouvements" — as a number. The separator is U+202F. */
function countOf(text: string): number {
  return Number(text.replace(/[^\d]/g, ""));
}

/**
 * The quantity the item screen is currently showing.
 *
 * Read rather than assumed: this suite adjusts real stock, and a test that
 * hard-codes "3" passes until another test in the same file moves the shelf. The
 * assertions below are about the *relationship* between the current quantity and
 * the preview, which is what the form actually promises.
 */
async function currentQuantity(page: Page): Promise<number> {
  const text = await page.locator("#adjust-preview").innerText();
  const match = /(\d+)\s*→/.exec(text);
  if (!match) throw new Error(`No preview to read a quantity from: ${text}`);
  return Number(match[1]);
}

/**
 * The segmented control's `<input type="radio">` is `sr-only`, so a pointer
 * reaches it through its `<label>` and Playwright must do the same — an
 * actionability check on a visually hidden input never passes.
 */
async function selectView(page: Page, label: string) {
  await page.locator("label", { hasText: new RegExp(`^${label}$`) }).click();
}

/** The item screen for a SKU, reached through the lookup field it is built for. */
async function lookUp(page: Page, locale: string, sku: string) {
  await openInventory(page, locale);
  await page.getByRole("textbox", { name: /SKU|رمز/ }).fill(sku);
  await page.keyboard.press("Enter");
}

test.describe("the default screen", () => {
  /**
   * docs/ADMIN_PANEL.md: "built for a phone in a warehouse; the default screen is
   * low stock, not the full list". The segmented control is how the screen says
   * that, so the assertion is that it opens on that segment with fewer rows than
   * the catalogue holds.
   */
  test("opens on low stock, not on the full list", async ({ page }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr");

    await expect(page.getByRole("radio", { name: "Stock faible" })).toBeChecked();
    const low = await page.locator('a[href*="/inventory/"]').count();

    await openInventory(page, "fr", "?view=all");
    const all = await page.locator('a[href*="/inventory/"]').count();

    expect(low).toBeGreaterThan(0);
    expect(all).toBeGreaterThan(low);
  });

  /**
   * **The largest correction this branch makes to the spec's shorthand.**
   * `GET /inventory` defaults `include_variations` to false — measured, 28 rows
   * against 33 — while `/inventory/low-stock` always includes them. With the
   * default, the low-stock screen shows a row the full list says does not exist.
   * The panel asks for variations, and this is the proof.
   */
  test("the full list contains the variation the low-stock report shows", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr");
    await expect(page.getByText("AC-BUR-010-L")).toBeVisible();

    await openInventory(page, "fr", "?view=all&search=Burnous");
    await expect(page.getByText("AC-BUR-010-L")).toBeVisible();
  });

  /**
   * `null` and `0` are different facts. Measured: 8 of 28 top-level rows carry
   * `stock_quantity: null`, and product 26 carries a genuine `0` and is on the
   * low-stock report. Rendering both as `0` is what gets someone to reorder
   * something they already have.
   */
  test("an untracked product says so instead of showing a zero", async ({ page }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr", "?view=all&manage_stock=false");

    const rows = page.locator('a[href*="/inventory/"]');
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(rows.first().getByText("Non suivi")).toBeVisible();

    // The positive control: a tracked product with a real zero renders the zero.
    await openInventory(page, "fr", "?view=all&stock_status=outofstock");
    await expect(page.locator('a[href*="/inventory/"]').first()).toContainText("0");
  });

  /**
   * The API's variation name is doubled — `"Burnous en laine - L — L"` — and a
   * list of them reads as a stutter. Asserted on the rendered text, because the
   * markup would look identical either way.
   */
  test("a variation's name is not printed twice", async ({ page }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr");

    const row = page.locator('a[href*="/inventory/"]', { hasText: "AC-BUR-010-L" });
    await expect(row).toContainText("Burnous en laine");
    await expect(row).not.toContainText("Burnous en laine - L");
    await expect(row).not.toContainText("— L");
  });

  test("the back button returns to the previous view", async ({ page }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr");
    await selectView(page, "Tout");
    await expect(page).toHaveURL(/view=all/);

    await page.goBack();
    await expect(page).not.toHaveURL(/view=all/);
  });
});

test.describe("the SKU lookup", () => {
  test("takes a SKU straight to the item", async ({ page }) => {
    await signIn(page, "fr");
    await lookUp(page, "fr", "AC-EPI-009");

    await page.waitForURL(/\/inventory\/\d+/);
    await expect(page.getByRole("heading", { name: /Miel de jujubier/ }).first()).toBeVisible();
  });

  /**
   * **A 404 is an empty state at the field, not an error toast**, and it is the
   * single most common thing that will ever happen there. It has to stay on
   * screen beside the input, keep the typed value so it can be corrected, and not
   * navigate anywhere.
   */
  test("an unknown SKU is answered at the field, not as an error", async ({ page }) => {
    await signIn(page, "fr");
    await lookUp(page, "fr", "AC-NOPE-999");

    await expect(page.getByText(/Aucun produit avec ce SKU/)).toBeVisible();
    await expect(page).toHaveURL(/\/inventory$/);
    // The value survives, because the fix is usually one character.
    await expect(page.getByRole("textbox", { name: /SKU/ })).toHaveValue("AC-NOPE-999");
    // And it is not a toast: still there after a toast would have expired.
    await page.waitForTimeout(4500);
    await expect(page.getByText(/Aucun produit avec ce SKU/)).toBeVisible();
  });
});

test.describe("the adjustment", () => {
  /**
   * The whole point of the form: three modes, one preview, and no arithmetic in
   * anyone's head. The projection is asserted for every mode against the same
   * starting quantity.
   */
  test("previews the resulting quantity in every mode", async ({ page }) => {
    await signIn(page, "fr");
    await lookUp(page, "fr", "AC-EPI-009");
    await page.waitForURL(/\/inventory\/\d+/);

    const preview = page.locator("#adjust-preview");
    const quantity = page.getByLabel("Quantité", { exact: true });

    await selectView(page, "Ajouter");
    await quantity.fill("2");
    const now = await currentQuantity(page);
    await expect(preview).toContainText(`${now} → ${now + 2}`);

    await selectView(page, "Retirer");
    await expect(preview).toContainText(`${now} → ${now - 2}`);

    // `set` states an absolute, so the figure typed is the figure reached — the
    // one mode where the two sides of the arrow are unrelated.
    await selectView(page, "Définir");
    await expect(preview).toContainText(`${now} → 2`);
  });

  test("the stepper drives the same field the keyboard does", async ({ page }) => {
    await signIn(page, "fr");
    await lookUp(page, "fr", "AC-EPI-009");
    await page.waitForURL(/\/inventory\/\d+/);

    const quantity = page.getByLabel("Quantité", { exact: true });
    await quantity.fill("4");
    await page.getByRole("button", { name: "Un de plus" }).click();
    await expect(quantity).toHaveValue("5");
    await page.getByRole("button", { name: "Un de moins" }).click();
    await expect(quantity).toHaveValue("4");
  });

  /**
   * A round trip, and the ledger row it wrote. Restored immediately, because a
   * test that leaves the shop's stock somewhere else is a test that changes what
   * the next test measures.
   */
  test("writes the movement it promises, and the ledger shows it", async ({ page }) => {
    await signIn(page, "fr");
    await lookUp(page, "fr", "AC-EPI-009");
    await page.waitForURL(/\/inventory\/\d+/);
    const url = page.url();

    await selectView(page, "Ajouter");
    await page.getByLabel("Quantité", { exact: true }).fill("2");
    const before = await currentQuantity(page);

    // A note unique to this run, so the ledger assertion below cannot be
    // satisfied by a row an earlier run left behind.
    const stamp = `e2e ${Date.now()}`;
    await page.getByLabel("Note").fill(stamp);

    await page.getByRole("button", { name: "Enregistrer l’ajustement" }).click();

    // The quantity on screen has moved by exactly the delta, which is the
    // adjustment's whole promise.
    await expect
      .poll(async () => currentQuantity(page), { timeout: 15000 })
      .toBe(before + 2);

    /*
     * And the movement reached the ledger. Asserted on the note rather than on a
     * row count — the item's ledger shows the five most recent movements, so a
     * sixth replaces the oldest and the count never changes — and on the note
     * rather than on the reason, because `Réapprovisionnement` is also an
     * `<option>` in the reason picker, present and hidden on every render.
     */
    await expect(page.getByText(stamp)).toBeVisible({ timeout: 15000 });

    // Put the shelf back where it was. A suite that leaves the shop's stock
    // somewhere else is a suite that changes what the next run measures.
    await page.goto(url);
    await selectView(page, "Définir");
    await page.getByLabel("Nouvelle quantité", { exact: true }).fill(String(before));
    await page.getByRole("button", { name: "Enregistrer l’ajustement" }).click();
    await expect
      .poll(async () => currentQuantity(page), { timeout: 15000 })
      .toBe(before);
  });

  /**
   * The measured 409: `{stock_quantity, projected, backorders}`. It is a state
   * conflict rather than a bad payload, and `projected` is the number the person
   * has to change — so it is the number on screen.
   */
  test("a decrease below zero renders the API's conflict, not a generic error", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await lookUp(page, "fr", "AC-EPI-009");
    await page.waitForURL(/\/inventory\/\d+/);

    await selectView(page, "Retirer");
    const now = await currentQuantity(page);
    await page.getByLabel("Quantité", { exact: true }).fill("99");
    await page.getByRole("button", { name: "Enregistrer l’ajustement" }).click();

    // `details.projected` is the number the person has to change, so it is the
    // number on screen — computed from the shelf rather than hard-coded.
    // The API's `details.projected` verbatim — a negative the person has to
    // close, not a generic "conflict".
    await expect(page.getByTestId("adjust-conflict")).toContainText(String(now - 99));
    // The screen stays; a 409 is never a bounce.
    await expect(page).toHaveURL(/\/inventory\/\d+/);
  });

  /**
   * The other 409, caught before it is sent. A variable parent does not manage
   * its own stock, so the form is not offered — the reason is, and the control
   * that resolves it is one card below.
   */
  test("a product that does not track stock explains itself instead of offering a form", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await lookUp(page, "fr", "AC-BUR-010");
    await page.waitForURL(/\/inventory\/\d+/);

    await expect(page.getByText(/ne suit pas son stock/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enregistrer l’ajustement" }),
    ).toHaveCount(0);
    // The resolution is present on the same screen.
    await expect(page.getByText("Suivre le stock")).toBeVisible();
  });

  /**
   * The quantity is not settable through the settings endpoint — it answers 400
   * naming the adjust route, which is what keeps the ledger gapless. The form
   * therefore never offers a quantity field among the settings.
   */
  test("the settings form has no quantity field", async ({ page }) => {
    await signIn(page, "fr");
    await lookUp(page, "fr", "AC-EPI-009");
    await page.waitForURL(/\/inventory\/\d+/);

    // Positive control: the settings the endpoint does accept are all there.
    await expect(page.getByText("Suivre le stock")).toBeVisible();
    await expect(page.getByText("Seuil d’alerte")).toBeVisible();
    await expect(page.getByLabel("Quantité en stock")).toHaveCount(0);
  });
});

test.describe("the ledger", () => {
  test("filters by reason, and the count actually changes", async ({ page }) => {
    await signIn(page, "fr");
    await openMoves(page, "fr");
    const unfiltered = await page.getByTestId("movements-count").innerText();

    await openMoves(page, "fr", "&reason=damage");
    const filtered = await page.getByTestId("movements-count").innerText();

    expect(countOf(filtered)).toBeGreaterThan(0);
    expect(countOf(filtered)).toBeLessThan(countOf(unfiltered));
  });

  /**
   * **The filter offers all nine reasons, not the summary's seven.** The summary
   * omits every reason with no rows, so a picker built from it silently loses
   * `customer_return` and `other` — the facet lesson, in a second place.
   */
  test("offers every reason, including the two the summary omits", async ({ page }) => {
    await signIn(page, "fr");
    await openMoves(page, "fr");
    await page.getByRole("button", { name: /Filtres/ }).first().click();

    for (const label of [
      "Correction",
      "Réapprovisionnement",
      "Casse",
      "Perte",
      "Retour client",
      "Autre",
      "Commande",
      "Commande annulée",
      "Fiche produit",
    ]) {
      await expect(
        page.getByRole("checkbox", { name: label, exact: true }),
      ).toBeVisible();
    }
  });

  /**
   * The "who". The ledger cannot resolve `actor_id` to a name for three of the
   * four roles holding `ac_manage_inventory`, so it renders what it can prove and
   * never a bare id.
   */
  test("names an order or a person, and never a raw actor id", async ({ page }) => {
    await signIn(page, "fr");
    await openMoves(page, "fr", "&reason=order_reduced");

    const row = page.locator(".list-row").first();
    // The space between the word and the id is U+00A0, which `\s` matches and a
    // literal space does not.
    await expect(row).toContainText(/Commande\s\d+/);

    await openMoves(page, "fr", "&reason=correction");
    await expect(page.locator(".list-row").first()).toContainText(/Vous|collègue/);
  });

  test("filters to my own movements, and that filter really filters", async ({ page }) => {
    await signIn(page, "fr");
    await openMoves(page, "fr");
    const all = await page.getByTestId("movements-count").innerText();

    await openMoves(page, "fr", "&actor=me");
    const mine = await page.getByTestId("movements-count").innerText();

    expect(countOf(mine)).toBeGreaterThan(0);
    expect(countOf(mine)).toBeLessThan(countOf(all));
    // Every row that is a person is now me.
    await expect(page.locator(".list-row").first()).toContainText(/Vous|Commande\s\d+/);
  });
});

test.describe("Arabic", () => {
  /**
   * The ledger is almost entirely numbers inside RTL prose, which is where digits
   * reorder silently. Asserted on the **rendered string**, because the `dir`
   * attribute half cannot catch a bidi bug.
   */
  test("keeps quantities and ids in order inside Arabic text", async ({ page }) => {
    await signIn(page, "ar");
    await openMoves(page, "ar");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const arrow = await page.locator('[dir="ltr"]', { hasText: "→" }).first().innerText();
    expect(arrow).toMatch(/^\d+\s*→\s*\d+$/);

    const product = await page
      .locator('[dir="ltr"]', { hasText: /المنتج/ })
      .first()
      .innerText();
    expect(product).toMatch(/^المنتج\s*\d+$/);
  });

  /**
   * The bug this branch found by reading the rendered text: `Intl` annotates an
   * Arabic date with U+200F RIGHT-TO-LEFT MARKs, and forcing `dir="ltr"` over
   * them renders `17ص 12:03 .2026/08/`. `Isolate` isolates without forcing, and
   * the assertion is that the day still leads and the marker still trails.
   */
  test("an Arabic timestamp is not scrambled by the isolation around it", async ({
    page,
  }) => {
    await signIn(page, "ar");
    /*
     * `formatWhen` is relative under 24 hours and absolute after, so a window
     * ending two days ago guarantees the absolute form — the only one carrying
     * the RLMs this test is about. Waiting for "some old row to exist" would be a
     * test that quietly stops asserting anything as the fixtures age.
     */
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    await openMoves(page, "ar", `&date_to=${twoDaysAgo}`);

    const stamp = await page
      .locator('[dir="auto"]', { hasText: /\d{4}/ })
      .first()
      .innerText();

    // The RLMs ICU inserted are still there — stripping them would be the other
    // wrong fix — and the components are in their formatted order.
    expect(stamp).toContain("‏");
    expect(stamp.replace(/‏/g, "")).toMatch(/^\d{1,2}\/\d{2}\/\d{4}/);
  });

  test("renders without horizontal overflow", async ({ page }) => {
    await signIn(page, "ar");
    for (const view of ["", "?view=all", "?view=moves"]) {
      await page.goto(`/ar/inventory${view}`);
      await page.waitForSelector(
        view === "?view=moves"
          ? '[data-testid="movements-count"]'
          : '[data-testid="inventory-count"]',
      );
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow on ${view || "low"}`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("the forbidden state", () => {
  test.skip(
    !LIMITED_USER || !LIMITED_PASS,
    "Set AC_LIMITED_USER and AC_LIMITED_PASS to a Support Agent's credential.",
  );

  /**
   * A Support Agent holds no `ac_manage_inventory` and every route in this
   * section answers 403 for them — measured on `/inventory`, `/low-stock` and
   * `/movements`. A 403 is a screen state and never a logout.
   */
  test("a Support Agent sees the reason and stays signed in", async ({ page }) => {
    await signIn(page, "fr", LIMITED_USER!, LIMITED_PASS!);
    await page.goto("/fr/inventory");

    await expect(page.getByText(/permission Stock/)).toBeVisible();
    await expect(page).not.toHaveURL(/login/);

    // The item screen refuses the same way, rather than 404ing or crashing.
    await page.goto("/fr/inventory/20");
    await expect(page.getByText(/permission Stock/)).toBeVisible();
    await expect(page).not.toHaveURL(/login/);

    // Still signed in: a screen they can reach still works.
    await page.goto("/fr/orders");
    await expect(page).not.toHaveURL(/login/);
  });
});

test.describe("the loading state", () => {
  /**
   * One test per locale, not a loop inside one: the route handler below never
   * fulfils, and `unroute` releases the pattern rather than the request already
   * in flight.
   *
   * Arabic matters on its own — `[dir="rtl"]` sets the root font size a step
   * larger, so every line box grows and the row is 75px against the Latin 71. A
   * skeleton built from fixed pixel heights would match in French and be 4px
   * short per row in Arabic, over twenty rows.
   */
  for (const locale of ["fr", "ar"]) {
    test(`the skeleton row matches the real row in ${locale}`, async ({ page }) => {
      await signIn(page, locale);
      await openInventory(page, locale);
      const real = await page
        .locator('a[href*="/inventory/"]')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);

      // The ledger is never prefetched by the server, so blocking the proxy
      // leaves the client query pending, which is the skeleton.
      await page.route("**/api/ac/inventory/movements?**", () => {});
      await page.goto(`/${locale}/inventory?view=moves`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector('[role="status"][aria-busy="true"]');
      const skeleton = await page
        .locator('[role="status"][aria-busy="true"] > div')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);

      expect(Math.abs(real - skeleton)).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("the hydration hazard", () => {
  /**
   * A keystroke landing between first paint and hydration changes the DOM and
   * never reaches React: the value looks accepted, the form never goes dirty and
   * the save bar never appears. Measured on WebKit on the product detail, hidden
   * by Chromium, and worked around by this suite's retries for two branches.
   *
   * The fix is that every control is `disabled` until React owns it, so the
   * keystroke is **refused** rather than swallowed. Playwright waits for an
   * element to be enabled before acting, which is why the assertion here is on
   * the server-rendered markup rather than on a typing race: the attribute has to
   * be in the HTML that arrives, or there is no window being closed.
   */
  test("form controls arrive disabled and become enabled on hydration", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await lookUp(page, "fr", "AC-EPI-009");
    await page.waitForURL(/\/inventory\/\d+/);

    // The server's HTML, read before the client bundle can have run.
    const html = await page.evaluate(async () => {
      const response = await fetch(location.href, { headers: { Accept: "text/html" } });
      return response.text();
    });
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<input[^>]*disabled/);

    // And after hydration the same controls accept input.
    await expect(page.getByLabel("Quantité", { exact: true })).toBeEnabled();
    const now = await currentQuantity(page);
    await page.getByLabel("Quantité", { exact: true }).fill("7");
    await expect(page.locator("#adjust-preview")).toContainText(`${now} → ${now + 7}`);
  });
});
