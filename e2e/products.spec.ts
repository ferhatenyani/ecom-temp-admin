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
  /*
   * The post-login destination, not a wildcard. `**\/{locale}/**` matches the
   * login page the form is still sitting on, so it resolved instantly and every
   * test after it navigated before the session cookie existed — eighteen
   * failures that all read as "the products list does not render".
   */
  await page.waitForURL(
    (url) => !url.pathname.endsWith("/login") && url.pathname.startsWith(`/${locale}/`),
  );
}

async function openProducts(page: Page, locale: string, query = "") {
  await page.goto(`/${locale}/products${query}`);
  await page.waitForSelector('[data-testid="products-count"]');
}

/**
 * The rows, in whichever presentation this project's viewport is showing.
 *
 * The redesign renders both: a real `<table>` at `md` and up and a stacked
 * record list below it, one hidden per breakpoint. Both are always in the DOM,
 * so a bare `tbody tr` counts correctly and then times out trying to click a row
 * that `display: none` at the three phone widths this suite runs at.
 * `filter({ visible: true })` is what makes one selector honest at every width.
 *
 * This replaces `a[href*="/products/"]`, which no longer identifies a row: a row
 * opens a preview rather than navigating, so the only product links on the
 * screen are inside that preview and inside each row's action menu.
 */
function rows(page: Page) {
  return page.locator("tbody tr, main li.ui-card").filter({ visible: true });
}

/** The one control that opens the filter drawer. Replaces `.pill-row > button`. */
function openFilters(page: Page) {
  return page.getByRole("button", { name: /Filtres|عوامل التصفية/ }).click();
}

/**
 * The detail URL for a SKU, resolved through the list rather than guessed.
 *
 * Two clicks now instead of one, and the extra one is the point: a row opens the
 * peek, and the peek is what carries the link to the full page. Going straight
 * to `/products/{id}` would need an id, and the backend's own suites delete and
 * recreate their fixtures on every run.
 */
async function openBySku(page: Page, locale: string, sku: string) {
  await openProducts(page, locale, `?sku=${sku}`);
  const row = rows(page).first();
  await expect(row).toBeVisible();
  await row.click();

  const peek = page.getByRole("dialog");
  await expect(peek).toBeVisible();
  await peek.getByRole("link", { name: /Ouvrir|فتح/ }).click();
  await page.waitForURL(/\/products\/\d+/);
}

test.describe("the products list", () => {
  test("renders the catalogue and keeps the filter in the URL", async ({ page }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr");

    const unfiltered = await rows(page).count();
    expect(unfiltered).toBeGreaterThan(0);

    // A filter that really filters — the positive control for the assertion
    // below, without which "the list got shorter" proves nothing.
    await openProducts(page, "fr", "?stock_status=outofstock");
    const filtered = await rows(page).count();
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
    const before = await rows(page).count();

    await page.fill('input[type="search"]', "tapis");
    await page.press('input[type="search"]', "Enter");
    await expect(page).toHaveURL(/search=tapis/);
    await expect(rows(page)).not.toHaveCount(before);

    await page.goBack();
    await expect(page).not.toHaveURL(/search=/);
    await expect(rows(page)).toHaveCount(before);
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
    expect(await rows(page).count()).toBeGreaterThan(0);

    await openProducts(page, "fr");
    await openFilters(page);
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
    await openFilters(page);

    const sheet = page.getByRole("dialog");
    const zero = sheet.getByRole("checkbox", { name: /Cuir/ });
    await expect(zero).toBeVisible();

    /*
     * Asserted on the accessible name rather than with `toContainText`, and the
     * change is forced by the control becoming real. The old row was a
     * `<button role="checkbox">` wrapping its own label and count, so it had text
     * content; the new one is an `<input type="checkbox">` inside a `<label>`,
     * and an input has no text of its own. The count sits inside that label
     * deliberately, which is what puts it in the accessible name — and a count
     * a screen reader cannot reach is a count only sighted users have.
     */
    await expect(zero).toHaveAccessibleName(/Cuir\s+0/);

    // The control: a value with a real count renders its real count, so the "0"
    // above is a measurement and not a rendering failure.
    await expect(
      sheet.getByRole("checkbox", { name: /Laine/ }),
    ).not.toHaveAccessibleName(/\b0\b/);
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

    await openFilters(page);
    const sheet = page.getByRole("dialog");

    // A real checkbox, so its state is `checked` rather than an `aria-checked`
    // attribute the old `role="checkbox"` button had to set by hand.
    const selected = sheet.getByRole("checkbox", { name: /Laine/ });
    await expect(selected).toBeChecked();

    // The sibling is still there, still counted, and still reachable.
    const sibling = sheet.getByRole("checkbox", { name: /Argent/ });
    await expect(sibling).toBeVisible();
    await expect(sibling).toBeEnabled();
    await expect(sibling).not.toHaveAccessibleName(/\b0\b/);
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

    await openFilters(page);
    let sheet = page.getByRole("dialog");
    const categoryCount = await sheet
      .getByRole("checkbox", { name: /Tapis et Textiles|Épicerie Fine|Bijoux/ })
      .count();
    expect(categoryCount).toBeGreaterThan(1);
    await page.keyboard.press("Escape");

    await openProducts(page, "fr", "?category=16");
    await openFilters(page);
    sheet = page.getByRole("dialog");
    const stillThere = await sheet
      .getByRole("checkbox", { name: /Tapis et Textiles|Épicerie Fine|Bijoux/ })
      .count();
    expect(stillThere).toBe(categoryCount);
  });

  test("an impossible filter shows the empty state, not a blank list", async ({ page }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr", "?search=zzz-nothing-matches-this");

    await expect(rows(page)).toHaveCount(0);
    /*
     * "Effacer les filtres" is the *empty state's* action and is distinct from
     * the drawer's "Tout effacer", which clears only the drawer's own
     * dimensions. Two buttons, two scopes, and the names have to stay different
     * or a test that clicks one proves nothing about the other.
     */
    const clear = page.getByRole("button", { name: /Effacer les filtres/ });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(rows(page).first()).toBeVisible();
  });

  test("a selected filter renders as a removable chip", async ({ page }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr", "?stock_status=outofstock");

    // The chip names the dimension *and* the value — one chip per value, so
    // removing "Rupture" cannot also remove something else.
    const chip = page.getByRole("button", { name: /Retirer le filtre Stock : Rupture/ });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).not.toHaveURL(/stock_status/);
  });

  /**
   * Sorting ships on this screen and nowhere else, and the header cycle is the
   * half that can silently go wrong.
   *
   * `title asc` was re-measured as working after the backend repair;
   * **`title desc` never was**. It answers 200 and returns the catalogue in
   * default order, so a name header that cycled to descending would look like it
   * worked. It must go `none → ascending → none` and never reach the third
   * state — asserted on `aria-sort`, which is both the accessible contract and
   * the only externally visible record of what the panel thinks it asked for.
   */
  test("the name column sorts ascending only, and never claims descending", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await openProducts(page, "fr");

    const header = page.getByRole("columnheader", { name: /Produit/ });
    // Skipped where the table is not the presentation — below `md` the records
    // are cards and there is no column header to click.
    if (!(await header.isVisible())) test.skip(true, "no table at this width");

    await expect(header).toHaveAttribute("aria-sort", "none");

    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(page).toHaveURL(/sort=title-asc/);

    // The control that matters: the next click returns to unsorted rather than
    // asking for the combination nobody measured.
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "none");
    await expect(page).not.toHaveURL(/sort=title-desc/);
  });
});

/**
 * The name field, by its label rather than by DOM order.
 *
 * `input[type=text]").first()` assumed the name was the first text input on the
 * screen, which was true of a single 640px column of grouped sections and is not
 * true of a two-column detail: the aside's controls are in the same document, and
 * which one comes first is a layout decision rather than a promise. Every
 * assertion below means exactly what it meant before — this only stops it
 * depending on something the layout never agreed to hold still.
 */
function nameField(page: Page) {
  return page.getByLabel(/^(Nom|الاسم)$/);
}

/** The sticky save bar, by the handle `components/ui/Form.tsx` publishes. */
function saveBar(page: Page) {
  return page.locator('[data-testid="save-bar"]');
}

test.describe("the product detail and its write path", () => {
  test("renders the whole object and saves it back", async ({ page }) => {
    await signIn(page, "fr");
    await openBySku(page, "fr", "AC-TAP-001");

    const name = nameField(page);
    const original = await name.inputValue();
    expect(original).not.toBe("");

    // The save bar appears only once something changed.
    await expect(saveBar(page)).toBeHidden();
    await name.fill(`${original} ✓`);
    await expect(saveBar(page)).toBeVisible();

    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Produit enregistré.")).toBeVisible();
    await expect(saveBar(page)).toBeHidden();

    // It persisted: a reload reads it back from the API rather than from state.
    await page.reload();
    await expect(nameField(page)).toHaveValue(`${original} ✓`);

    /*
     * Put it back, so the suite is re-runnable.
     *
     * Retried, because this is the one place the suite types into a form it
     * reached by a hard reload rather than a client-side navigation, and a
     * keystroke that lands before the client component hydrates changes the DOM
     * without changing React's state — measured on WebKit, where the input read
     * back as reverted while the <h1> still carried the saved name, so the form
     * was never dirty and the save bar never appeared. Chromium hydrates faster
     * and hides it. Asserting the bar inside the retry keeps the positive
     * control: a form that genuinely refuses to go dirty still fails here.
     */
    await expect(async () => {
      await nameField(page).fill(original);
      await expect(saveBar(page)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });

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
    await nameField(page).fill("");
    const price = page.getByLabel("Prix habituel");
    await price.fill("pas-un-nombre");

    await page.getByRole("button", { name: "Enregistrer" }).click();

    // Both, not one, and each on its own control.
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(2);
    await expect(page.getByText(/cannot be emptied/i).first()).toBeVisible();
    await expect(page.getByText(/Must be a number/i).first()).toBeVisible();

    // Editing one field clears its error and leaves the other's alone — the API
    // said both were wrong and only one has been addressed.
    await nameField(page).fill("Tapis berbère de Ghardaïa 200x140");
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

    /* `exact`, because the attributes section above this one is headed
       "Caractéristiques et déclinaisons" and an accessible-name match is a
       substring match — so the unscoped name resolved to both and failed on
       strict mode rather than on the variations section being absent. */
    const section = page.getByRole("heading", { name: "Déclinaisons", exact: true });
    await expect(section).toBeVisible();
    /* Three variations, each with its own SKU and stock — and given the same
       15 s the rest of this suite gives API-backed content. The rows arrive from
       `GET /products/{id}/variations` after the section heading renders, so the
       default 5 s is a race the section wins and the rows lose; the failure
       snapshot showed all three present, just late. */
    await expect(page.getByText("AC-BUR-010-S")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("AC-BUR-010-L")).toBeVisible({ timeout: 15000 });
  });

  /**
   * `DELETE` trashes and `?force=true` is permanent, and they get different
   * confirmations — measured, the two answer the **identical** body, so nothing
   * but the panel's own knowledge of what it asked for distinguishes them.
   *
   * **The container changed and the assertions did not.** The two acts used to
   * live in an `ActionSheet`, which is a `role="dialog"`; DESIGN.md §0 retires it
   * and they are now a header `Menu`, which is a `role="menu"` full of
   * `menuitem`s — so `getByRole("dialog")` matched nothing and the old test would
   * have timed out on a screen that works. What it checks is unchanged: both acts
   * are offered, the permanent one opens its own confirmation, and that
   * confirmation refuses until the product's name is typed exactly.
   */
  test("permanent deletion is behind a different confirmation from a trash", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await openBySku(page, "fr", "AC-TAP-001");

    await page.getByRole("button", { name: "Supprimer ce produit" }).click();

    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Mettre à la corbeille" })).toBeVisible();
    const permanent = menu.getByRole("menuitem", { name: "Supprimer définitivement" });
    await expect(permanent).toBeVisible();

    await permanent.click();

    // The permanent path asks for the product's name and refuses until it matches.
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Supprimer définitivement" });
    await expect(confirm).toBeDisabled();

    /* `getByRole("textbox")` rather than `input[type=text]`: `ConfirmDialog`'s
       typed guard is an `<input>` with no `type` attribute at all, and the CSS
       attribute selector matches only an attribute that is present. The role is
       what both spellings share. */
    await dialog.getByRole("textbox").fill("pas le bon nom");
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
    //
    // Filtered to the visible one: both presentations are in the DOM at every
    // width and `innerText` of a `display: none` subtree is its raw text
    // content, which would pass this without anything having been laid out.
    const sku = page
      .locator('main span[dir="ltr"]')
      .filter({ visible: true })
      .first();
    const text = (await sku.innerText()).trim();
    expect(text).toMatch(/^[A-Z0-9-]+$/);
  });

  test("the filter drawer and its counts survive mirroring", async ({ page }) => {
    await signIn(page, "ar");
    await openProducts(page, "ar");
    await openFilters(page);

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

    /*
     * The control: nothing claims staleness while the connection is up.
     *
     * **Scoped to the banner's own text**, because a bare `getByRole("status")`
     * can never be absent: `components/primitives/Toast.tsx` keeps an empty
     * `role="status"` live region in the DOM at all times, on purpose — a live
     * region announces only what appears *inside* an already-present container,
     * so one mounted with the toast would announce nothing. Counting every
     * status on the page therefore counted the toast viewport and could not have
     * passed on any screen; it went unnoticed because this suite had never run.
     */
    await expect(page.getByRole("status").filter({ hasText: /hors ligne/i })).toHaveCount(0);

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    /* Same scoping as the control above: the toast's permanent live region is
       also a `status`, so an unfiltered locator resolves to two and trips strict
       mode rather than finding the banner. */
    const banner = page.getByRole("status").filter({ hasText: /hors ligne/i });
    await expect(banner).toBeVisible();
    // The age of the data, not just the fact of being offline.
    await expect(banner).toContainText(/hors ligne/i);

    // And it aligns with the list rather than sitting a gutter further in. The
    // banner and the table card are now siblings inside `PageBody`, which owns
    // the gutter — so a margin of the banner's own would show up here as a step.
    const offsets = await page.evaluate(() => {
      const banner = document.querySelector('[role="status"]');
      const card = document.querySelector("main .ui-card");
      if (!banner || !card) return null;
      return {
        banner: banner.getBoundingClientRect().left,
        row: card.getBoundingClientRect().left,
      };
    });
    expect(offsets).not.toBeNull();
    expect(Math.abs(offsets!.banner - offsets!.row)).toBeLessThanOrEqual(1);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("status").filter({ hasText: /hors ligne/i })).toHaveCount(0);
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

      /*
       * Whichever presentation this project's width renders, against its own
       * placeholder: a table row against `TableSkeleton`'s `.ui-row`, or a record
       * card against `RecordListSkeleton`'s `.ui-card`. Both are always in the
       * DOM, so the visibility filter is what keeps this comparing like with
       * like — and `> div` no longer identifies a skeleton row at all, because
       * the table placeholder's first child is its header band.
       */
      const real = await rows(page)
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);

      // The server fetch fails on this query, so there is no initial data; the
      // blocked proxy then keeps the client query pending, which is the skeleton.
      await page.route("**/api/ac/products?**", () => {});
      await page.goto(`/${locale}/products?min_price=abc`, {
        waitUntil: "domcontentloaded",
      });
      /* `attached`, not the default `visible`: there are two skeleton regions in
         the DOM now — one per presentation — and `waitForSelector` resolves on
         the first match, which is the table's and is hidden at the phone widths
         three of this suite's four projects run at. */
      await page.waitForSelector('[role="status"][aria-busy="true"]', {
        state: "attached",
      });
      const skeleton = await page
        .locator(
          '[role="status"][aria-busy="true"] .ui-row,' +
            ' [role="status"][aria-busy="true"] .ui-card',
        )
        .filter({ visible: true })
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);

      expect(Math.abs(real - skeleton)).toBeLessThanOrEqual(1);
    });
  }
});
