import { test, expect, type Locator, type Page } from "@playwright/test";

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
 *
 * ## What the redesign changed in here, and what it did not
 *
 * Every assertion below is the one that was there before. What moved is the
 * *selectors*, and three structural facts they depended on:
 *
 *   1. **`Segmented` is retired.** The three views were one radio group; the two
 *      stock views are now `FilterTabs` — buttons in a `nav` carrying
 *      `aria-current="page"`, deliberately not `role="tab"` — and the ledger is
 *      its own route at `/inventory/movements`. The adjustment's three modes are
 *      a real `ChoiceGroup`, so they *are* radios and `check()` works on them.
 *   2. **Both presentations are in the DOM at every width.** `DataTable` renders
 *      the table and the record list together and hides one with CSS, so every
 *      cell exists twice and a bare `getByText` is a strict-mode violation.
 *      `shown()` below is the answer.
 *   3. **`.list-row` was `GroupedList`'s.** Rows are `<tr>` and `<li>` now, and
 *      the three values those assertions actually cared about carry test ids of
 *      their own — a selector that depends on nothing else on the page ever
 *      matching is a selector that breaks for an unrelated reason.
 */
const USER = process.env.AC_STAFF_USER;
const PASS = process.env.AC_STAFF_PASS;
const LIMITED_USER = process.env.AC_LIMITED_USER;
const LIMITED_PASS = process.env.AC_LIMITED_PASS;

test.skip(
  !USER || !PASS,
  "Set AC_STAFF_USER and AC_STAFF_PASS to a real Application Password.",
);

/*
 * **Signed in means "no longer on the login screen", not "on /orders".**
 *
 * Every helper here used to wait for a hard-coded alternation of destinations,
 * and that asserted a defect rather than a behaviour: `landingPath()` in
 * `components/ui/nav-tree.ts` sends each reader to the first destination their
 * capabilities actually reach, because DECISIONS.md §11 measured a Support Agent
 * as 403 on `/orders` and 200 on `/customers` — so four files sending everybody
 * to `/orders` showed that reader a forbidden screen as the first thing after a
 * correct password. The alternations here never listed `/customers`, so every
 * test using a limited credential timed out in `signIn` before asserting
 * anything. Two thirds of this suite's first run failed that way.
 *
 * A predicate rather than a longer alternation, deliberately: `landingPath()`
 * reads `NAV`, so the set of possible landings changes whenever the navigation
 * does. Enumerating them here would put the same staleness back one release
 * later. What the helper actually needs to know is that the credential was
 * accepted and the redirect happened.
 */
async function signIn(page: Page, locale: string, user = USER!, pass = PASS!) {
  await page.goto(`/${locale}/login`);
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await page.click('button[type="submit"]');
  await page.waitForURL(
    (url) => !url.pathname.endsWith("/login") && url.pathname.startsWith(`/${locale}/`),
  );
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
  await page.goto(`/${locale}/inventory/movements${query}`);
  await page.waitForSelector('[data-testid="movements-count"]');
  // The count element renders immediately with a total of zero while the client
  // query is still pending, so waiting on the element is waiting on a
  // placeholder. Wait for the total to settle to a real figure instead.
  await expect(page.getByTestId("movements-count")).toContainText(/\d/, {
    timeout: 15000,
  });
}

/**
 * The one **painted** copy of something both presentations render.
 *
 * `DataTable` keeps the table and the record list in the DOM together and hides
 * one per breakpoint, so every value exists twice and this suite runs at four
 * viewports — three phones and a 1440px desktop. Filtering to what is actually
 * visible picks whichever presentation the running project is showing, without
 * the test having to know which.
 */
function shown(locator: Locator): Locator {
  return locator.filter({ visible: true }).first();
}

/** A stock row, whichever presentation is painted. `<tbody>` is the table's. */
function rows(page: Page): Locator {
  return page.locator("tbody tr");
}

/**
 * A tab in the view strip.
 *
 * `FilterTabs` deliberately does **not** claim `role="tab"`: there is no
 * tabpanel, the filter is a query parameter and the list re-fetches, so these are
 * buttons in a `nav` with `aria-current`. Scoped to that nav, because "Tout" is a
 * common enough word to collide with a button elsewhere on the page.
 */
function tab(page: Page, label: string): Locator {
  return page
    .getByRole("navigation", { name: /Vue du stock|عرض المخزون/ })
    .getByRole("button", { name: label, exact: true });
}

/** One of the adjustment's three modes — a real radio, so `check()` works. */
async function selectMode(page: Page, label: string) {
  await page.getByRole("radio", { name: label, exact: true }).check();
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

/** The item screen for a SKU, reached through the lookup field it is built for. */
async function lookUp(page: Page, locale: string, sku: string) {
  await openInventory(page, locale);
  await page.getByRole("textbox", { name: /SKU|رمز/ }).fill(sku);
  await page.keyboard.press("Enter");
}

test.describe("the default screen", () => {
  /**
   * docs/ADMIN_PANEL.md: "built for a phone in a warehouse; the default screen is
   * low stock, not the full list". The tab strip is how the screen says that, so
   * the assertion is that it opens on that tab with fewer rows than the catalogue
   * holds.
   */
  test("opens on low stock, not on the full list", async ({ page }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr");

    await expect(tab(page, "Stock faible")).toHaveAttribute("aria-current", "page");
    const low = await rows(page).count();

    // The identifying cell is a real anchor — the keyboard path and the middle
    // click the peek drawer would have provided. There is no peek here.
    await expect(rows(page).first().locator('a[href*="/inventory/"]')).toHaveCount(1);

    await openInventory(page, "fr", "?view=all");
    const all = await rows(page).count();

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
    await expect(shown(page.getByText("AC-BUR-010-L"))).toBeVisible();

    await openInventory(page, "fr", "?view=all&search=Burnous");
    await expect(shown(page.getByText("AC-BUR-010-L"))).toBeVisible();
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

    expect(await rows(page).count()).toBeGreaterThan(0);
    await expect(rows(page).first()).toContainText("Non suivi");

    // The positive control: a tracked product with a real zero renders the zero.
    await openInventory(page, "fr", "?view=all&stock_status=outofstock");
    await expect(rows(page).first()).toContainText("0");
  });

  /**
   * The API's variation name is doubled — `"Burnous en laine - L — L"` — and a
   * list of them reads as a stutter. Asserted on the rendered text, because the
   * markup would look identical either way.
   */
  test("a variation's name is not printed twice", async ({ page }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr");

    const row = rows(page).filter({ hasText: "AC-BUR-010-L" });
    await expect(row).toContainText("Burnous en laine");
    await expect(row).not.toContainText("Burnous en laine - L");
    await expect(row).not.toContainText("— L");
  });

  test("the back button returns to the previous view", async ({ page }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr");
    await tab(page, "Tout").click();
    await expect(page).toHaveURL(/view=all/);

    await page.goBack();
    await expect(page).not.toHaveURL(/view=all/);
  });

  /**
   * **The low-stock report takes no filters and the screen renders none.**
   * `/inventory/low-stock` registers pagination only, and an unknown query
   * parameter on this API answers 200 with the full result set — so a control
   * that silently does nothing is indistinguishable from one that works. Not
   * rendering it is the only honest option, and the sentence explaining where the
   * filters went is what keeps that from reading as a missing feature.
   */
  test("the low view renders no search and no filter button, and says why", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr");

    await expect(page.getByRole("searchbox", { name: /Rechercher un article/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Filtres" })).toHaveCount(0);
    await expect(page.getByText(/ce rapport n’en accepte aucun/)).toBeVisible();

    // The positive control: both are there on the tab that can use them.
    await openInventory(page, "fr", "?view=all");
    await expect(page.getByRole("searchbox", { name: /Rechercher un article/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Filtres" })).toHaveCount(1);
  });

  /**
   * A page past the last one answers 200 with an empty array, and the page
   * control lives inside the table that was not drawn. On the low view there are
   * no filters to clear by construction, so before this branch the browser's back
   * button was the only way out of a screen the panel had navigated to itself.
   */
  test("an over-paged report offers the way back", async ({ page }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr", "?page=99");

    await expect(rows(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Revenir à la première page" }).click();
    await expect(page).not.toHaveURL(/page=99/);
    expect(await rows(page).count()).toBeGreaterThan(0);
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

    await selectMode(page, "Ajouter");
    await quantity.fill("2");
    const now = await currentQuantity(page);
    await expect(preview).toContainText(`${now} → ${now + 2}`);

    await selectMode(page, "Retirer");
    await expect(preview).toContainText(`${now} → ${now - 2}`);

    // `set` states an absolute, so the figure typed is the figure reached — the
    // one mode where the two sides of the arrow are unrelated.
    await selectMode(page, "Définir");
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

    await selectMode(page, "Ajouter");
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
     * row count — the item's ledger card shows the five most recent movements, so
     * a sixth replaces the oldest and the count never changes — and on the note
     * rather than on the reason, because `Réapprovisionnement` is also an
     * `<option>` in the reason picker, present and hidden on every render.
     */
    await expect(page.getByText(stamp)).toBeVisible({ timeout: 15000 });

    // Put the shelf back where it was. A suite that leaves the shop's stock
    // somewhere else is a suite that changes what the next run measures.
    await page.goto(url);
    await selectMode(page, "Définir");
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

    await selectMode(page, "Retirer");
    const now = await currentQuantity(page);
    await page.getByLabel("Quantité", { exact: true }).fill("99");
    await page.getByRole("button", { name: "Enregistrer l’ajustement" }).click();

    // The API's `details.projected` verbatim — a negative the person has to
    // close, not a generic "conflict" — computed from the shelf rather than
    // hard-coded.
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

    await openMoves(page, "fr", "?reason=damage");
    const filtered = await page.getByTestId("movements-count").innerText();

    expect(countOf(filtered)).toBeGreaterThan(0);
    expect(countOf(filtered)).toBeLessThan(countOf(unfiltered));
  });

  /**
   * **The filter offers all nine reasons, not the summary's seven.** The summary
   * omits every reason with no rows, so a picker built from it silently loses
   * `customer_return` and `other` — the facet lesson, in a second place.
   *
   * They are radios rather than checkboxes now: `?reason=` takes one value, and a
   * row of checkboxes would have claimed otherwise.
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
        page.getByRole("radio", { name: label, exact: true }),
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
    await openMoves(page, "fr", "?reason=order_reduced");

    // The space between the word and the id is U+00A0, which `\s` matches and a
    // literal space does not.
    await expect(shown(page.getByTestId("movement-actor"))).toContainText(/Commande\s\d+/);

    await openMoves(page, "fr", "?reason=correction");
    await expect(shown(page.getByTestId("movement-actor"))).toContainText(/Vous|collègue/);
  });

  test("filters to my own movements, and that filter really filters", async ({ page }) => {
    await signIn(page, "fr");
    await openMoves(page, "fr");
    const all = await page.getByTestId("movements-count").innerText();

    await openMoves(page, "fr", "?actor=me");
    const mine = await page.getByTestId("movements-count").innerText();

    expect(countOf(mine)).toBeGreaterThan(0);
    expect(countOf(mine)).toBeLessThan(countOf(all));
    // Every row that is a person is now me.
    await expect(shown(page.getByTestId("movement-actor"))).toContainText(
      /Vous|Commande\s\d+/,
    );
  });

  /**
   * **The ledger is a route now, not a third view of the list**, and the only way
   * in is from the two screens a person is standing on when they want it. There is
   * deliberately no nav entry: the sidebar is already sixteen items.
   */
  test("is reached from the list header and carries a way back", async ({ page }) => {
    await signIn(page, "fr");
    await openInventory(page, "fr");

    await page.getByRole("link", { name: "Mouvements" }).click();
    await page.waitForURL(/\/inventory\/movements/);
    await expect(page.getByRole("heading", { name: "Journal des mouvements" })).toBeVisible();

    /* `.last()`: at `lg`+ the sidebar's own nav item carries the same name and
       the same href and sits earlier in the DOM, so the header's back link is
       the second. Below `lg` the sidebar is a Drawer and is not in the DOM at
       all until it is opened, and the back link is the only match. */
    await page.getByRole("link", { name: "Stock", exact: true }).last().click();
    await expect(page).toHaveURL(/\/inventory$/);
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

    /*
     * The arrow is `Ltr`: two bare numbers and a glyph, with no translated word
     * sharing the element, and it must not flip — it points from an earlier value
     * to a later one, which is a fact about time rather than about reading
     * direction.
     */
    const change = shown(page.getByTestId("movement-change"));
    await expect(change).toHaveAttribute("dir", "ltr");
    expect((await change.innerText()).trim()).toMatch(/^\d+\s*→\s*\d+$/);

    /*
     * The product label is `Isolate` — `dir="auto"` — and that is a **correction**
     * this branch makes rather than a regression. "المنتج 20" is a translated word
     * with a number in it, not a bare identifier, and `Ltr` forced it to lay out
     * from the left; DECISIONS.md §5 records the same defect being found in
     * sixteen call sites on the customers branch. The isolation stays, so the
     * digits still cannot be reordered by the text around them, and the assertion
     * that matters — the rendered string — is unchanged.
     */
    const product = shown(page.getByTestId("movement-product"));
    await expect(product).toHaveAttribute("dir", "auto");
    expect((await product.innerText()).trim()).toMatch(/^المنتج\s*\d+$/);
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
    await openMoves(page, "ar", `?date_to=${twoDaysAgo}`);

    const stamp = await shown(page.getByTestId("movement-time")).innerText();

    // The RLMs ICU inserted are still there — stripping them would be the other
    // wrong fix — and the components are in their formatted order.
    expect(stamp).toContain("‏");
    expect(stamp.replace(/‏/g, "")).toMatch(/^\d{1,2}\/\d{2}\/\d{4}/);
  });

  test("renders without horizontal overflow", async ({ page }) => {
    await signIn(page, "ar");
    for (const [route, marker] of [
      ["/ar/inventory", "inventory-count"],
      ["/ar/inventory?view=all", "inventory-count"],
      ["/ar/inventory/movements", "movements-count"],
    ] as const) {
      await page.goto(route);
      await page.waitForSelector(`[data-testid="${marker}"]`);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow on ${route}`).toBeLessThanOrEqual(1);
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

    // And so does the ledger, which is its own route now.
    await page.goto("/fr/inventory/movements");
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
   * larger, so every line box grows and the rows grow with it. A skeleton built
   * from fixed pixel heights would match in French and be short in Arabic, over
   * twenty rows.
   *
   * Both sides are read at whichever presentation the running project paints:
   * `DataTable` keeps a table and a record list in the DOM together, and
   * `TableSkeleton` and `RecordListSkeleton` mirror one each. The real row is a
   * `<tr>` or an `<li>`; the placeholder is a `.ui-row` band or a `.ui-card`.
   */
  for (const locale of ["fr", "ar"]) {
    test(`the skeleton row matches the real row in ${locale}`, async ({ page }) => {
      await signIn(page, locale);
      await openMoves(page, locale);
      const real = await shown(page.locator("tbody tr, li.ui-card")).evaluate(
        (el) => el.getBoundingClientRect().height,
      );

      // The ledger's rows are client-fetched, so blocking the proxy leaves the
      // query pending, which is the skeleton.
      await page.route("**/api/ac/inventory/movements?**", () => {});
      await page.goto(`/${locale}/inventory/movements`, {
        waitUntil: "domcontentloaded",
      });
      /*
       * **The visible one.** `DataTable` keeps both presentations mounted and
       * hides one per breakpoint, and so do their placeholders — so this selector
       * resolves to two `SkeletonRegion`s and `waitForSelector` waits on the
       * first, which at a phone width is the table's and is `display: none`. It
       * waited the whole budget for an element that was never going to be
       * visible, while the record list's skeleton was on screen beside it.
       *
       * `shown()` is the helper this file already uses everywhere else for the
       * same reason; the measurement two lines below was already going through
       * it, which is what made the mismatch easy to miss.
       */
      await shown(page.locator('[role="status"][aria-busy="true"]')).waitFor();
      const skeleton = await shown(
        page.locator(
          '[role="status"][aria-busy="true"] .ui-row, [role="status"][aria-busy="true"] > .ui-card',
        ),
      ).evaluate((el) => el.getBoundingClientRect().height);

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
