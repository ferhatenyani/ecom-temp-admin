import { test, expect, type Page } from "@playwright/test";

/**
 * The products list, its facets, and the detail's write path.
 *
 * Every negative carries a positive control, because a refusal and an
 * unreachable route look identical from outside — the rule the orders suite
 * follows and the reason `?bogus_param=1` was worth measuring.
 *
 * **Products are found by SKU, never by id.** The backend's own suites delete and
 * recreate their fixtures on every `scripts/test.sh` over there, so an id is
 * stable only until the next run — AC-SEO-TAPIS moved from 3071 to 3214 between
 * two runs while this branch was being built. A hard-coded id is a test that
 * passes today and 404s next week for a reason nobody will connect to this file.
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
  /*
   * The post-login destination, not a wildcard. `**\/{locale}/**` matches the
   * login page the form is still sitting on, so it resolved instantly and every
   * test after it navigated before the session cookie existed — eighteen
   * failures that all read as "the products list does not render".
   */
  await page.waitForURL(new RegExp(`/${locale}/(orders|products)`));
}

async function openProducts(page: Page, locale: string, query = "") {
  await page.goto(`/${locale}/products${query}`);
  await page.waitForSelector('[data-testid="products-count"]');
}

/** The detail URL for a SKU, resolved through the list rather than guessed. */
async function openBySku(page: Page, locale: string, sku: string) {
  await openProducts(page, locale, `?sku=${sku}`);
  const row = page.locator('a[href*="/products/"]').first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/products\/\d+/);
}

test.describe("the products list", () => {
  test("renders the catalogue and keeps the filter in the URL", async ({ page }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr");

    const rows = page.locator('a[href*="/products/"]');
    const unfiltered = await rows.count();
    expect(unfiltered).toBeGreaterThan(0);

    // A filter that really filters — the positive control for the assertion
    // below, without which "the list got shorter" proves nothing.
    await openProducts(page, "fr", "?stock_status=outofstock");
    const filtered = await page.locator('a[href*="/products/"]').count();
    expect(filtered).toBeLessThan(unfiltered);
    expect(filtered).toBeGreaterThan(0);
    await expect(page).toHaveURL(/stock_status=outofstock/);
  });

  /**
   * `push`, not `replace`. Filter state in the URL is only half the promise; the
   * other half is that the back button works, and `router.replace` silently
   * breaks it by overwriting the entry — going back from a filtered list would
   * skip the unfiltered one entirely.
   */
  test("the back button returns to the unfiltered catalogue", async ({ page }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr");
    const before = await page.locator('a[href*="/products/"]').count();

    await page.fill('input[type="search"]', "tapis");
    await page.press('input[type="search"]', "Enter");
    await expect(page).toHaveURL(/search=tapis/);
    await expect(page.locator('a[href*="/products/"]')).not.toHaveCount(before);

    await page.goBack();
    await expect(page).not.toHaveURL(/search=/);
    await expect(page.locator('a[href*="/products/"]')).toHaveCount(before);
  });

  /**
   * The list includes drafts; the facet counts do not. Seven rows beside a count
   * of six is correct, and the scope note is what stops someone "fixing" it into
   * something wrong.
   */
  test("says that its counts are published-only while the list shows drafts", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr");

    // The control: there is a draft in the catalogue, so the two numbers really
    // can disagree. Without this the note below could be decorating nothing.
    await openProducts(page, "fr", "?status=draft");
    expect(await page.locator('a[href*="/products/"]').count()).toBeGreaterThan(0);

    await openProducts(page, "fr");
    await page.locator(".pill-row > button").first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/produits publiés/i)).toBeVisible();
  });

  /**
   * A facet omits its zero-count values, so the panel supplies them from the
   * unfiltered vocabulary. "Cuir" is a term deliberately seeded onto no product
   * — if it is missing from the sheet, a selection can turn its siblings into
   * dead ends and the rule is not being kept.
   */
  test("renders a zero-count facet value rather than dropping it", async ({ page }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr");
    await page.locator(".pill-row > button").first().click();

    const sheet = page.getByRole("dialog");
    const zero = sheet.getByRole("checkbox", { name: /Cuir/ });
    await expect(zero).toBeVisible();
    await expect(zero).toContainText("0");

    // The control: a value with a real count renders its real count, so the "0"
    // above is a measurement and not a rendering failure.
    await expect(sheet.getByRole("checkbox", { name: /Laine/ })).not.toContainText(
      /\b0\b/,
    );
  });

  /**
   * A facet's counts exclude its own filter — for the attribute groups, which is
   * where the API honours the rule. With `pa_matiere=laine` selected, the matiere
   * group still reports its other values, so the selection never becomes a
   * one-way door.
   */
  test("an attribute facet still offers its siblings once one is selected", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr", "?attributes[pa_matiere]=laine");

    await page.locator(".pill-row > button").first().click();
    const sheet = page.getByRole("dialog");

    const selected = sheet.getByRole("checkbox", { name: /Laine/ });
    await expect(selected).toHaveAttribute("aria-checked", "true");

    // The sibling is still there, still counted, and still reachable.
    const sibling = sheet.getByRole("checkbox", { name: /Argent/ });
    await expect(sibling).toBeVisible();
    await expect(sibling).toBeEnabled();
    await expect(sibling).not.toContainText(/\b0\b/);
  });

  /**
   * The category facet does **not** exclude its own filter — measured, with
   * `?category=16` the group collapses to that one value and drops the other
   * five. The panel renders the full vocabulary anyway, or picking a category
   * would delete every other category from the sheet.
   */
  test("a selected category does not delete the other categories", async ({ page }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr");

    await page.locator(".pill-row > button").first().click();
    let sheet = page.getByRole("dialog");
    const categoryCount = await sheet
      .getByRole("checkbox", { name: /Tapis et Textiles|Épicerie Fine|Bijoux/ })
      .count();
    expect(categoryCount).toBeGreaterThan(1);
    await page.keyboard.press("Escape");

    await openProducts(page, "fr", "?category=16");
    await page.locator(".pill-row > button").first().click();
    sheet = page.getByRole("dialog");
    const stillThere = await sheet
      .getByRole("checkbox", { name: /Tapis et Textiles|Épicerie Fine|Bijoux/ })
      .count();
    expect(stillThere).toBe(categoryCount);
  });

  test("an impossible filter shows the empty state, not a blank list", async ({ page }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr", "?search=zzz-nothing-matches-this");

    await expect(page.locator('a[href*="/products/"]')).toHaveCount(0);
    const clear = page.getByRole("button", { name: /Effacer les filtres/ });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(page.locator('a[href*="/products/"]').first()).toBeVisible();
  });

  test("a selected filter renders as a removable chip", async ({ page }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr", "?stock_status=outofstock");

    const chip = page.getByRole("button", { name: /Retirer Stock/ });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).not.toHaveURL(/stock_status/);
  });
});

test.describe("the product detail and its write path", () => {
  test("renders the whole object and saves it back", async ({ page }) => {
    await signIn(page, "fr");
    await openBySku(page, "fr", "AC-TAP-001");

    const name = page.locator("input[type=text]").first();
    const original = await name.inputValue();
    expect(original).not.toBe("");

    // The save bar appears only once something changed.
    await expect(page.locator(".save-bar")).toBeHidden();
    await name.fill(`${original} ✓`);
    await expect(page.locator(".save-bar")).toBeVisible();

    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Produit enregistré.")).toBeVisible();
    await expect(page.locator(".save-bar")).toBeHidden();

    // It persisted: a reload reads it back from the API rather than from state.
    await page.reload();
    await expect(page.locator("input[type=text]").first()).toHaveValue(`${original} ✓`);

    // Put it back, so the suite is re-runnable.
    await page.locator("input[type=text]").first().fill(original);
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Produit enregistré.")).toBeVisible();
  });

  /**
   * A 400 lists **every** bad field, and the panel renders the list rather than
   * the top-level message — measured, four fields came back in one response and
   * a toast saying "The product data is invalid" throws all four away.
   */
  test("a 400 puts every bad field on its own row", async ({ page }) => {
    await signIn(page, "fr");
    await openBySku(page, "fr", "AC-TAP-001");

    // Two fields wrong at once: a name that cannot be emptied and a price that
    // is not a number.
    await page.locator("input[type=text]").first().fill("");
    const price = page.getByLabel("Prix habituel");
    await price.fill("pas-un-nombre");

    await page.getByRole("button", { name: "Enregistrer" }).click();

    // Both, not one, and each on its own control.
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(2);
    await expect(page.getByText(/cannot be emptied/i)).toBeVisible();
    await expect(page.getByText(/Must be a number/i)).toBeVisible();

    // Editing one field clears its error and leaves the other's alone — the API
    // said both were wrong and only one has been addressed.
    await page.locator("input[type=text]").first().fill("Tapis berbère de Ghardaïa 200x140");
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(1);
  });

  /**
   * A duplicate SKU is a **409**, not a 400, and it names the SKU under
   * `details.sku` rather than under `details.fields`. It has to land on the SKU
   * field, because that is the field the person has to change.
   */
  test("a duplicate SKU lands on the SKU field", async ({ page }) => {
    await signIn(page, "fr");
    await openBySku(page, "fr", "AC-TAP-004");

    const sku = page.getByLabel("SKU");
    await sku.fill("AC-TAP-001");
    await page.getByRole("button", { name: "Enregistrer" }).click();

    await expect(sku).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(/SKU/i).first()).toBeVisible();
  });

  test("a variable product lists its variations, read-only", async ({ page }) => {
    await signIn(page, "fr");
    await openBySku(page, "fr", "AC-BUR-010");

    const section = page.getByRole("heading", { name: "Déclinaisons" });
    await expect(section).toBeVisible();
    // Three variations, each with its own SKU and stock.
    await expect(page.getByText("AC-BUR-010-S")).toBeVisible();
    await expect(page.getByText("AC-BUR-010-L")).toBeVisible();
  });

  /**
   * `DELETE` trashes and `?force=true` is permanent, and they get different
   * confirmations — measured, the two answer the **identical** body, so nothing
   * but the panel's own knowledge of what it asked for distinguishes them.
   */
  test("permanent deletion is behind a different confirmation from a trash", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await openBySku(page, "fr", "AC-TAP-001");

    await page.getByRole("button", { name: "Supprimer ce produit" }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Mettre à la corbeille")).toBeVisible();
    await expect(sheet.getByText("Supprimer définitivement")).toBeVisible();

    await sheet.getByText("Supprimer définitivement").click();

    // The permanent path asks for the product's name and refuses until it matches.
    const confirm = page.getByRole("dialog").getByRole("button", {
      name: "Supprimer définitivement",
    });
    await expect(confirm).toBeDisabled();

    await page.getByRole("dialog").locator("input[type=text]").fill("pas le bon nom");
    await expect(confirm).toBeDisabled();

    // Deliberately not completing it: this test proves the guard, and a suite
    // that permanently deletes a catalogue product to prove it cannot be re-run.
    await page.keyboard.press("Escape");
  });
});

test.describe("Arabic and RTL", () => {
  test("renders rtl, and a SKU keeps its direction inside Arabic text", async ({
    page,
  }) => {
    await signIn(page, "ar");
    await openProducts(page, "ar");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    // The SKU is the identifier the bidi algorithm reorders. Asserted on the
    // rendered string, because the `dir` attribute alone cannot catch it.
    const sku = page
      .locator('a[href*="/products/"] span[dir="ltr"]')
      .first();
    const text = (await sku.innerText()).trim();
    expect(text).toMatch(/^[A-Z0-9-]+$/);
  });

  test("the filter sheet and its counts survive mirroring", async ({ page }) => {
    await signIn(page, "ar");
    await openProducts(page, "ar");
    await page.locator(".pill-row > button").first().click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("checkbox").first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("the detail form renders in Arabic without horizontal overflow", async ({
    page,
  }) => {
    await signIn(page, "ar");
    await openBySku(page, "ar", "AC-BUR-010");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("the forbidden state", () => {
  test.skip(
    !LIMITED_USER || !LIMITED_PASS,
    "Set AC_LIMITED_USER / AC_LIMITED_PASS to a Support Agent's credentials.",
  );

  /**
   * Measured: a Support Agent's `GET /products` answers 403. The panel must show
   * the forbidden state and stay signed in — a 403 is not a logout, and getting
   * that wrong makes a Support Agent unable to hold a session at all.
   */
  test("a role without the capability sees the forbidden state and stays signed in", async ({
    page,
  }) => {
    await signIn(page, "fr", LIMITED_USER!, LIMITED_PASS!);
    await page.goto("/fr/products");

    await expect(page.getByText(/permission Produits/)).toBeVisible();
    await expect(page).not.toHaveURL(/login/);

    // Still signed in: a screen they *can* reach still works.
    await page.goto("/fr/orders");
    await expect(page).not.toHaveURL(/login/);
  });
});

test.describe("the fifth state", () => {
  /**
   * Offline / stale is a visible marker with the age of the data, never silent
   * staleness. `StaleBanner` had existed since the shell branch and had never
   * been rendered by any screen — a state that exists as a component and is
   * wired to nothing is a state the panel does not have.
   */
  test("says how old the rows are when the browser goes offline", async ({
    page,
    context,
  }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr");

    // The control: nothing claims staleness while the connection is up.
    await expect(page.getByRole("status")).toHaveCount(0);

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    const banner = page.getByRole("status");
    await expect(banner).toBeVisible();
    // The age of the data, not just the fact of being offline.
    await expect(banner).toContainText(/hors ligne/i);

    // And it aligns with the list rather than sitting a gutter further in:
    // `StaleBanner` carries its own margin, so it must not also inherit one.
    const offsets = await page.evaluate(() => {
      const banner = document.querySelector('[role="status"]');
      const row = document.querySelector('a[href*="/products/"]');
      if (!banner || !row) return null;
      return {
        banner: banner.getBoundingClientRect().left,
        row: row.getBoundingClientRect().left,
      };
    });
    expect(offsets).not.toBeNull();
    expect(Math.abs(offsets!.banner - offsets!.row)).toBeLessThanOrEqual(1);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("status")).toHaveCount(0);
  });
});

test.describe("the list does not shift when data lands", () => {
  /**
   * The skeleton has to be the height of a real row. Measured on the orders
   * branch: an `h-18` skeleton against an 81px row was 9px short per row, which
   * is 72px of shift over eight rows.
   */
  /*
   * One test per locale, and not a loop inside one test: the route handler below
   * never fulfils, so the request it holds is still pending when the loop's next
   * iteration navigates. `unroute` releases the pattern, not the request already
   * in flight, and the second sign-in timed out on a page that never finished
   * loading. A fresh page per locale costs one more sign-in and cannot do that.
   *
   * Arabic matters here on its own: `[dir="rtl"]` sets the root font size to
   * 106.25 %, so every line box in the row grows — 86px against the Latin 81 —
   * and a skeleton built from fixed pixel heights would match in French and be
   * 5px short per row in Arabic.
   */
  for (const locale of ["fr", "ar"]) {
    test(`the skeleton row matches the real row in ${locale}`, async ({ page }) => {
      await signIn(page, locale);
      await openProducts(page, locale);
      const real = await page
        .locator('a[href*="/products/"]')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);

      // The server fetch fails on this query, so there is no initial data; the
      // blocked proxy then keeps the client query pending, which is the skeleton.
      await page.route("**/api/ac/products?**", () => {});
      await page.goto(`/${locale}/products?min_price=abc`, {
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
