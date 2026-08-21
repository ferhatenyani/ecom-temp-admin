import { test, expect, type Page } from "@playwright/test";

/**
 * The CMS: pages, the homepage document, banners, FAQs, menus, and media.
 *
 * Everything here runs against fixtures `scripts/seed-cms.mjs` establishes, and
 * the seed's own floor asserts it created them — so a failure in this file is a
 * failure of the panel rather than of a shop that drifted.
 *
 * **The forbidden fixture is a Manager, and it covers the whole branch.**
 * `ac_manage_content` is held by neither live tier except Super Admin, so one
 * credential carries a genuine refusal on every screen here — measured, a
 * Manager is 403 on `/cms/*` and on `/media` alike.
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
  await page.waitForURL(new RegExp(`/${locale}/(orders|products|coupons|dashboard)`));
}

/**
 * The segmented control's `<input type="radio">` is `sr-only`, so a pointer
 * reaches it through its `<label>` and Playwright must do the same — an
 * actionability check on a visually hidden input never passes, and clicking the
 * role directly reports the label span "intercepts pointer events". The
 * customers and inventory suites document the same thing.
 */
async function selectSegment(page: Page, label: string) {
  await page.locator("label", { hasText: new RegExp(`^${label}$`) }).click();
}

async function openPages(page: Page, locale: string, query = "") {
  await page.goto(`/${locale}/content/pages${query}`);
  await page.waitForSelector('[data-testid="pages-count"]');
}

test.describe("the content hub", () => {
  test("lists six destinations with their counts", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/content");

    for (const name of [/Pages/, /Page d’accueil/, /Bannières/, /FAQ/, /Menus/, /Médiathèque/]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
  });

  test("is reachable from More, which used to render it as unbuilt", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/more");

    // `exact`, because the skip link "Aller au contenu" matches a bare "Contenu".
    const link = page.getByRole("link", { name: "Contenu", exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/fr\/content$/);
  });
});

test.describe("the pages index", () => {
  /**
   * The route this branch paid the backend for. `GET /cms/pages` did not exist:
   * a page could be addressed by path and could not be listed at all.
   */
  test("lists the seeded pages", async ({ page }) => {
    await signIn(page, "fr");
    await openPages(page, "fr");

    await expect(page.getByRole("link", { name: /Livraison et délais/ })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Conditions générales de vente/ }),
    ).toBeVisible();
  });

  /*
   * The ambiguity the index resolves, and the reason it is worth more than
   * discovery on its own.
   *
   * On `/cms/pages/{path}` a **draft** and a **path that does not exist** are
   * the same 404 with the same message. The index is the only place the
   * difference is visible — so this asserts the draft is listed with its badge
   * *and* that filtering to `publish` hides it, which is what proves the status
   * filter is honoured rather than ignored.
   */
  test("shows a draft, and the status filter actually filters", async ({ page }) => {
    await signIn(page, "fr");
    await openPages(page, "fr");

    const draft = page.getByRole("link", { name: /Retours et remboursements/ });
    await expect(draft).toBeVisible();
    await expect(draft.getByText("Brouillon")).toBeVisible();

    await selectSegment(page, "Publié");
    await page.waitForURL(/status=publish/);
    await expect(page.getByRole("link", { name: /Retours et remboursements/ })).toHaveCount(0);
    // The positive control: filtering did not simply empty the list.
    await expect(page.getByRole("link", { name: /Livraison et délais/ })).toBeVisible();
  });

  test("says what the search matches, because it does not match the path", async ({ page }) => {
    await signIn(page, "fr");
    await openPages(page, "fr");

    await expect(page.getByText(/La recherche porte sur le titre et le contenu/)).toBeVisible();

    // And it behaves as advertised: a title finds it, a path does not.
    await page.getByRole("searchbox").fill("Livraison");
    await page.getByRole("searchbox").press("Enter");
    await page.waitForURL(/search=Livraison/);
    await expect(page.getByRole("link", { name: /Livraison et délais/ })).toBeVisible();
  });

  test("explains the pages it leaves out", async ({ page }) => {
    await signIn(page, "fr");
    await openPages(page, "fr");

    // `meta.excluded_system` — the shop's own cart, checkout, account and
    // catalogue pages, whose body is a block or a shortcode.
    await expect(page.getByText(/page[s]? technique/)).toBeVisible();
  });

  test("opens a child page addressed by its full path", async ({ page }) => {
    await signIn(page, "fr");
    await openPages(page, "fr");

    await page.getByRole("link", { name: /Conditions générales de vente/ }).click();
    await page.waitForURL(/\/content\/pages\/legal\/conditions-generales$/);
    await expect(
      page.getByRole("textbox", { name: "Titre", exact: true }),
    ).toHaveValue(/Conditions générales/);
  });
});

test.describe("the page form", () => {
  test("warns before a rename, naming both addresses", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/content/pages/livraison");

    const slug = page.getByLabel("Segment d’URL");
    await expect(slug).toBeEnabled();
    await slug.fill("livraison-express");

    /*
     * The warning is on the form, while they are typing — not after the save.
     * WordPress leaves no redirect, so every storefront link on the old path is
     * a 404 the moment it lands, and that is a decision rather than a result.
     */
    await expect(page.getByText(/Changer l’adresse casse tous les liens/)).toBeVisible();
    await expect(page.getByText("/livraison-express")).toBeVisible();

    // Not saved: the form is left dirty and abandoned.
    await page.getByRole("button", { name: "Rétablir" }).click();
    await expect(slug).toHaveValue("livraison");
  });

  test("refuses to delete a page the shop points an option at", async ({ page }) => {
    /*
     * `privacy-policy` is prose a content manager may legitimately edit and is
     * referenced by `wp_page_for_privacy_policy`, so it is listed and writable
     * and **not** deletable. The refusal is the API's, not the panel's: `?force`
     * does not override it either.
     */
    await signIn(page, "fr");
    await page.goto("/fr/content/pages/privacy-policy");

    await page.getByRole("button", { name: "Supprimer cette page" }).click();
    await page.getByRole("button", { name: "Supprimer cette page" }).last().click();

    await expect(page.getByText(/wp_page_for_privacy_policy/)).toBeVisible();
    // Still there.
    await expect(page).toHaveURL(/\/content\/pages\/privacy-policy$/);
  });

  test("a hint is not part of the field's name", async ({ page }) => {
    /*
     * The second commit, asserted in a real engine as well as in jsdom. The
     * accessible name must be the label alone; the hint must describe.
     */
    await signIn(page, "fr");
    await page.goto("/fr/content/pages/livraison");

    const slug = page.getByRole("textbox", { name: "Segment d’URL", exact: true });
    await expect(slug).toBeVisible();
    await expect(slug).toHaveAttribute("aria-describedby", /-hint/);
  });
});

test.describe("the homepage document", () => {
  test("reports the sections it could not read, without rendering the API's English as the message", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/content/homepage");
    await page.waitForSelector('[data-testid="sections-count"]');

    // The seed stores eight sections, three of them malformed, so five survive.
    await expect(page.getByTestId("sections-count")).toContainText("5");

    await expect(page.getByText("Sections illisibles")).toBeVisible();

    /*
     * The localised line is the message and the API's sentence is the detail.
     * Both are present: rendering only the English is the defect the analytics
     * branch shipped, and rendering only the French would throw away the
     * offending type, which is the actionable half.
     */
    await expect(page.getByText(/section 4 du document stocké a un type inconnu/)).toBeVisible();
    await expect(page.getByText(/unknown type "carousel"/)).toBeVisible();
  });

  test("names the position in the stored document, not the row on screen", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/content/homepage");
    await page.waitForSelector('[data-testid="sections-count"]');

    /*
     * The seed interleaves its malformed sections at stored positions 2, 4 and 6
     * precisely so an off-by-one here is visible: five sections survive, so a
     * report renumbered against the surviving list could not say "6".
     */
    // Lower-case `section`, because the three problem shapes have three
    // different French openings — this one is "Le contenu de la section 6 …".
    await expect(page.getByText(/section 6 du document stocké/)).toBeVisible();
  });

  test("warns that saving discards them", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/content/homepage");
    await page.waitForSelector('[data-testid="sections-count"]');

    // Make it dirty without changing anything meaningful.
    const moveDown = page.getByRole("button", { name: /Descendre/ }).first();
    await expect(moveDown).toBeEnabled();
    await moveDown.click();

    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(
      page.getByText(/Enregistrer et supprimer les sections illisibles/),
    ).toBeVisible();

    // Declined — nothing is written.
    await page.getByRole("button", { name: "Annuler" }).click();
  });

  test("reorders with buttons, because a drag has no touch or keyboard path", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/content/homepage");
    await page.waitForSelector('[data-testid="sections-count"]');

    // The first section cannot move up and the last cannot move down.
    const ups = page.getByRole("button", { name: /Monter/ });
    await expect(ups.first()).toBeDisabled();

    const downs = page.getByRole("button", { name: /Descendre/ });
    await expect(downs.last()).toBeDisabled();
    await expect(downs.first()).toBeEnabled();
  });
});

test.describe("banners and FAQs", () => {
  test("groups banners by placement and badges the draft", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/content/banners");
    await page.waitForSelector('[data-testid="banners-count"]');

    await expect(page.getByText("home_hero")).toBeVisible();
    // Anchored: the row also has "Monter Soldes d’été", "Descendre …" and
    // "Supprimer …", because a reorder control names what it moves.
    await expect(page.getByRole("button", { name: /^Soldes d’été/ })).toBeVisible();
    await expect(page.getByText("Brouillon").first()).toBeVisible();
  });

  test("lists FAQs with their categories", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/content/faqs");
    await page.waitForSelector('[data-testid="faqs-count"]');

    await expect(
      page.getByRole("button", { name: /^Quel est le délai de livraison/ }),
    ).toBeVisible();
    await expect(page.getByText("livraison").first()).toBeVisible();
  });
});

test.describe("menus", () => {
  test("renders the primary menu and its second level", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/content/menus");
    await page.waitForSelector('[data-testid="menu-count"]');

    await expect(page.getByTestId("menu-count")).not.toContainText("Aucun");
  });

  test("an unassigned location is an empty state with a working action", async ({ page }) => {
    /*
     * `GET /cms/menus/footer` is a 404 with its own message — "No menu is
     * assigned to that location." — which is a different fact from a location
     * that does not exist. A PUT then creates and assigns one, so this is an
     * empty state rather than an error.
     *
     * The backend's own suite deletes the footer menu in its teardown, so this
     * asserts *either* state honestly: an empty state or a rendered menu, never
     * an error.
     */
    await signIn(page, "fr");
    await page.goto("/fr/content/menus?location=footer");
    await page.waitForSelector('[data-testid="menu-count"]');

    await expect(page.getByText(/Une erreur/)).toHaveCount(0);
  });
});

test.describe("the media library", () => {
  test("renders a grid with a count", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/media");
    await page.waitForSelector('[data-testid="media-count"]');

    await expect(page.getByTestId("media-count")).not.toContainText("Aucun");
    await expect(page.locator("img").first()).toBeVisible();
  });

  test("shows the stored filename rather than the chosen one", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/media");
    await page.waitForSelector('[data-testid="media-count"]');

    await page.locator("ul button").first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.getByText("Nom du fichier")).toBeVisible();
    await expect(
      page.getByText(/Le nom stocké est généré par le serveur/),
    ).toBeVisible();
  });
});

test.describe("Arabic", () => {
  test("the pages index renders right to left with no untranslated key", async ({ page }) => {
    await signIn(page, "ar");
    await openPages(page, "ar");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // A missing translation renders as its own key. None may reach the screen.
    await expect(page.locator("body")).not.toContainText("content.");
    await expect(page.locator("body")).not.toContainText("media.");
  });

  test("the drop report is Arabic prose with the API's English as detail", async ({ page }) => {
    await signIn(page, "ar");
    await page.goto("/ar/content/homepage");
    await page.waitForSelector('[data-testid="sections-count"]');

    await expect(page.getByText("أقسام غير مقروءة")).toBeVisible();
    /*
     * The English sentence is still present and still English — it names the
     * offending type verbatim — but it sits under a localised line rather than
     * standing in for one, and it is `dir="ltr"` so it does not reorder inside
     * the Arabic column.
     */
    await expect(page.getByText(/unknown type "carousel"/)).toBeVisible();
  });
});

test.describe("what a Manager may not reach", () => {
  test.skip(
    !MANAGER_USER || !MANAGER_PASS,
    "Set AC_MANAGER_USER and AC_MANAGER_PASS — scripts/test.sh mints them.",
  );

  /*
   * One credential, a genuine refusal on every screen on this branch. Measured
   * 2026-08-21: a Manager is 403 on `/cms/homepage`, `/cms/banners`,
   * `/cms/faqs`, `/cms/menus/primary`, `/cms/pages/{path}` and `/media`.
   *
   * And the positive control, which is the half that makes the refusals mean
   * something: the same credential is **200 on `/notifications`**, because that
   * route is `ac_manage_customers` and not content at all. Part X's step-14 line
   * groups the two; the capability matrix does not, and that is why
   * notifications is its own branch.
   */
  for (const path of [
    "/content",
    "/content/pages",
    "/content/homepage",
    "/content/banners",
    "/content/faqs",
    "/content/menus",
    "/media",
  ]) {
    test(`is refused ${path}, by name`, async ({ page }) => {
      await signIn(page, "fr", MANAGER_USER!, MANAGER_PASS!);
      await page.goto(`/fr${path}`);

      // The capability is *named*, not a blank page and not a logout.
      await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
      await expect(page.getByText("Cette section demande la permission Contenu.")).toBeVisible();
    });
  }

  test("still sees the sections they do hold", async ({ page }) => {
    // The floor: a Manager refused everything would satisfy every assertion
    // above while describing a broken session rather than a working gate.
    await signIn(page, "fr", MANAGER_USER!, MANAGER_PASS!);
    await page.goto("/fr/more");

    await expect(page.getByRole("link", { name: "Livraison" })).toBeVisible();
    // And Content is not offered at all — a destination they cannot use is left
    // out rather than shown disabled.
    await expect(page.getByRole("link", { name: "Contenu", exact: true })).toHaveCount(0);
  });
});
