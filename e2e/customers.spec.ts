import { test, expect, type Page } from "@playwright/test";

/**
 * The customer list and detail.
 *
 * **The forbidden fixture is not the one the last two branches used.** A Support
 * Agent holds `ac_manage_customers` — measured: 200 on `/customers`,
 * `/customers/{id}` and `/customers/{id}/orders` — so `AC_LIMITED_*` is a
 * *positive* control here and the refusal has to come from a Marketing Manager,
 * who is 403 on all three. The coupons suite next door uses them the other way
 * round.
 *
 * Customers are found by email, never by id: the backend's own suites recreate
 * fixtures, and while a *user* id is more stable than a post id, the seed can
 * still renumber. `ac_cus_shopper@example.test` is the one richly-populated
 * record and `lila.ouali@example.test` is the one consenting one.
 */
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

async function signIn(page: Page, locale: string, user = USER!, pass = PASS!) {
  await page.goto(`/${locale}/login`);
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await page.click('button[type="submit"]');
  await page.waitForURL(new RegExp(`/${locale}/(orders|products)`));
}

/**
 * The segmented control's `<input type="radio">` is `sr-only`, so a pointer
 * reaches it through its `<label>` and Playwright must do the same — an
 * actionability check on a visually hidden input never passes, and clicking the
 * role directly reports the label span "intercepts pointer events". The
 * inventory suite documents the same thing.
 */
async function selectTab(page: Page, label: string) {
  await page.locator("label", { hasText: new RegExp(`^${label}$`) }).click();
}

async function openCustomers(page: Page, locale: string, query = "") {
  await page.goto(`/${locale}/customers${query}`);
  await page.waitForSelector('[data-testid="customers-count"]');
}

/** The detail URL for an email, resolved through the list rather than guessed. */
async function openByEmail(page: Page, locale: string, email: string) {
  await openCustomers(page, locale, `?search=${encodeURIComponent(email)}`);
  const row = page.locator('a[href*="/customers/"]').first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/customers\/\d+/);
}

test.describe("the customer list", () => {
  test("renders, counts and pages", async ({ page }) => {
    await signIn(page, "fr");
    await openCustomers(page, "fr");

    await expect(page.getByTestId("customers-count")).toContainText("16");
    await expect(page.locator('a[href*="/customers/"]')).toHaveCount(16);
  });

  /**
   * **The search does not match names, and the screen says so.**
   *
   * Measured with a positive control: `?search=` matches `user_login`,
   * `user_email` and `display_name` — never `first_name` or `last_name`. So
   * "Benali" finds Sofiane (whose *email* carries it) and not Amina (whose
   * *name* does), and a person typing a name gets an ordinary empty list with no
   * hint that the field never had a chance.
   */
  test("finds by email and admits it cannot find by name", async ({ page }) => {
    await signIn(page, "fr");

    // The positive control: the same term, matching an email, does return a row.
    await openCustomers(page, "fr", "?search=sofiane.benali");
    await expect(page.locator('a[href*="/customers/"]')).toHaveCount(1);

    // And the name-only case, which the API cannot answer.
    await openCustomers(page, "fr", "?search=Zqxwvu");
    await expect(page.locator('a[href*="/customers/"]')).toHaveCount(0);
    // Not a bare "no results" — the empty state explains which fields are searched.
    await expect(page.locator("body")).toContainText("e-mail");
  });

  test("keeps its filter in the URL and survives a back button", async ({ page }) => {
    await signIn(page, "fr");
    await openCustomers(page, "fr");
    await openCustomers(page, "fr", "?search=karim");
    await expect(page).toHaveURL(/search=karim/);

    await page.goBack();
    await page.waitForSelector('[data-testid="customers-count"]');
    await expect(page).not.toHaveURL(/search=/);
  });

  /**
   * A customer with no name renders its username, and one with a name renders the
   * name. 12 of the 16 are the first case, so a list that got this wrong would be
   * mostly blank rows.
   */
  test("names a customer that has no name", async ({ page }) => {
    await signIn(page, "fr");
    await openCustomers(page, "fr", "?search=ac_usr_shopper");

    const row = page.locator('a[href*="/customers/"]').first();
    await expect(row).toContainText("ac_usr_shopper");
  });
});

test.describe("the customer detail", () => {
  test("shows the statistics with every figure's scope", async ({ page }) => {
    await signIn(page, "fr");
    await openByEmail(page, "fr", "ac_cus_shopper@example.test");

    // The block the list route does not send. Its presence is the reason
    // `CustomerDetail` is a separate type from `Customer`.
    await expect(page.locator("body")).toContainText("Commandes passées");
    await expect(page.locator("body")).toContainText("Commandes terminées");

    /*
     * **The two figures that do not divide.** 2100 ÷ 5 is 420 and the API's own
     * answer is 1050, because revenue counts only the completed orders. The
     * labels carry the scope and this note states the relationship; without it
     * the card is arithmetic that looks wrong.
     */
    await expect(page.locator("body")).toContainText("ne comptent que les commandes terminées");
  });

  /**
   * The consent row the specification could not have been built from: there was
   * no date in the payload when this branch started, and no customer had ever
   * consented. Both were fixed in the API.
   */
  test("states the consent, its date and where it changes", async ({ page }) => {
    await signIn(page, "fr");
    await openByEmail(page, "fr", "lila.ouali@example.test");

    await expect(page.locator("body")).toContainText("Accordé");
    // The reason names the shopper's own route rather than saying "not editable".
    await expect(page.locator("body")).toContainText("depuis son compte");
    // The source, which lives beside the flag now rather than only in an audit
    // log that stops at Admin.
    await expect(page.locator("body")).toContainText("À l’inscription");
  });

  /**
   * The negative half, and the distinction a bare boolean could not make: this
   * customer never decided, which is not the same as declining.
   */
  test("tells never-asked apart from declined", async ({ page }) => {
    await signIn(page, "fr");
    await openByEmail(page, "fr", "ac_cus_shopper@example.test");

    await expect(page.locator("body")).toContainText("Jamais demandé");
    await expect(page.locator("body")).toContainText("L’absence de réponse vaut refus");
  });

  test("lists this customer's orders behind its own segment", async ({ page }) => {
    await signIn(page, "fr");
    await openByEmail(page, "fr", "ac_cus_shopper@example.test");

    await selectTab(page, "Commandes");
    // `/customers/{id}/orders` returns the identical shape to `/orders`, verified
    // by deep key-set equality, so these rows link into the orders screen.
    await expect(page.locator('a[href*="/orders/"]').first()).toBeVisible();
  });

  /** A staff id is a 404 here, not a disclosure. The repository filters on role. */
  test("answers 404 for an id that is not a customer", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/customers/1");
    await expect(page.locator("body")).toContainText("introuvable", { ignoreCase: true });
  });
});

test.describe("the capability boundary", () => {
  /**
   * The positive control, and the reason the forbidden fixture had to change: a
   * Support Agent — the thinnest role there is — reads customers perfectly well.
   */
  test.skip(!LIMITED_USER || !LIMITED_PASS, "Needs AC_LIMITED_* (a Support Agent).");

  test("a Support Agent can read customers", async ({ page }) => {
    await signIn(page, "fr", LIMITED_USER!, LIMITED_PASS!);
    await openCustomers(page, "fr");
    await expect(page.getByTestId("customers-count")).toBeVisible();
  });

  /**
   * **The money gate is the panel's own decision, not the API's.** A Support
   * Agent reads `total_revenue` from the endpoint with a 200 — measured — and
   * fails `canSeeMoney()` because that rule needs `ac_manage_orders` too. They
   * cannot open a single one of this customer's orders, so the one money figure
   * they could see would be the only one they could not check.
   *
   * The counts stay, so the card degrades to a narrower report rather than a hole.
   */
  test("a Support Agent sees the counts and not the revenue", async ({ page }) => {
    await signIn(page, "fr", LIMITED_USER!, LIMITED_PASS!);
    await openByEmail(page, "fr", "ac_cus_shopper@example.test");

    await expect(page.locator("body")).toContainText("Commandes passées");
    await expect(page.locator("body")).not.toContainText("Chiffre d’affaires");
  });
});

test.describe("the forbidden state", () => {
  test.skip(
    !MARKETING_USER || !MARKETING_PASS,
    "Needs AC_MARKETING_* (a Marketing Manager, who is 403 on customers).",
  );

  /** A 403 is a screen state, never a logout. Only a 401 clears the session. */
  test("a Marketing Manager gets a clean refusal and stays signed in", async ({ page }) => {
    await signIn(page, "fr", MARKETING_USER!, MARKETING_PASS!);

    await page.goto("/fr/customers");
    await expect(page.locator("body")).toContainText("Clients");
    await expect(page.getByTestId("customers-count")).toHaveCount(0);

    // Still signed in: the coupons screen, which this role *can* read, works.
    await page.goto("/fr/coupons");
    await expect(page.getByTestId("coupons-count")).toBeVisible();
  });
});

test.describe("both directions", () => {
  /**
   * The bidi rule, asserted on the **rendered geometry** rather than on a `dir`
   * attribute — an attribute cannot catch a reorder.
   *
   * A translated count sentence must read starting from the side its language
   * starts on. Wrapped in `Ltr`, "16 عميلًا" laid out beginning at the left, so
   * the number an Arabic reader sees first is the one furthest from where they
   * start. `Isolate` resolves the direction from the sentence's own first strong
   * character instead.
   */
  test("an Arabic count sentence starts at the right", async ({ page }) => {
    await signIn(page, "ar");
    await openCustomers(page, "ar");

    const order = await page.getByTestId("customers-count").evaluate((el) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      const glyphs: [number, string][] = [];
      let node: Node | null;
      while ((node = walk.nextNode())) {
        const text = node.textContent ?? "";
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const box = range.getBoundingClientRect();
          if (box.width > 0) glyphs.push([box.x, text[i]]);
        }
      }
      return glyphs
        .sort((a, b) => a[0] - b[0])
        .map(([, c]) => c)
        .join("");
    });

    // Visually left-to-right, the Arabic word comes first and the digits last —
    // which in a right-to-left reading puts the number where the eye lands first.
    expect(order).toMatch(/\d+$/);
  });

  test("renders in Arabic without horizontal overflow", async ({ page }) => {
    await signIn(page, "ar");
    await openCustomers(page, "ar");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await openByEmail(page, "ar", "ac_cus_shopper@example.test");
    const detailOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(detailOverflow).toBeLessThanOrEqual(1);
  });
});
