import { test, expect, type Locator, type Page } from "@playwright/test";

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

/**
 * Pick a value from a `FilterTabs` strip.
 *
 * **The name is kept and the implementation is entirely new.** It used to reach
 * `primitives/Segmented`, whose `<input type="radio">` is `sr-only` — so a
 * pointer went through the `<label>` and Playwright had to as well, since an
 * actionability check on a visually hidden input never passes. `Segmented` is
 * DESIGN.md §0-retired and `components/ui/FilterBar.tsx` draws a real `<button>`
 * per value inside a named `<nav>`, so the label indirection is gone.
 *
 * `exact`, because the status values overlap the badges on the rows underneath —
 * a page's "Brouillon" badge would otherwise match the "Brouillon" tab.
 */
async function selectSegment(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

/**
 * The rows of whichever presentation is painted.
 *
 * **The list is a `DataTable` now, and that introduces the trap
 * `e2e/coupons.spec.ts` documents.** The table — the only place a page's
 * `<a href>` exists — is `hidden md:block`, and below `md` a `RecordList` card
 * navigates through a stretched overlay button instead, so a row is one anchor
 * and not two. Every Playwright project here is phone-sized bar the desktop one,
 * so a bare `getByRole("link", …)` resolves to a node that is in the DOM and
 * never painted: `toBeVisible()` fails before a test reaches its own assertion.
 *
 * `<tr>` and `<li class="ui-card">` rather than the link and the overlay button,
 * because a row is read as well as clicked — "the row says Brouillon" is an
 * assertion about the row's text, and the overlay button has none. Both
 * containers are clickable: `<tr>` carries `onRowClick`, and the card's overlay
 * covers it edge to edge.
 */
function rows(page: Page): Locator {
  return page.locator("tbody tr, li.ui-card").filter({ visible: true });
}

/** One row, by the text that identifies it. */
function row(page: Page, name: RegExp): Locator {
  return rows(page).filter({ hasText: name });
}

/**
 * Reveal the navigation tree, at whichever width this project runs.
 *
 * `AppShell` paints the same tree twice: a persistent sidebar from `lg` up and a
 * `Drawer` below it, opened from the top bar's menu button. Only one is ever
 * painted, so the drawer trigger's visibility *is* the breakpoint test — no
 * viewport arithmetic in the spec.
 */
async function openNav(page: Page) {
  const trigger = page.getByRole("button", { name: "Navigation principale" });
  if (await trigger.isVisible()) await trigger.click();
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

  /*
   * **This used to open `/fr/more`, and that surface is gone.** `patterns/TabBar`
   * held five slots and pushed everything else behind a `More` screen; DESIGN.md
   * §0 retires the tab bar by name and `AppShell` renders `nav-tree.ts` instead —
   * a persistent sidebar at `lg`+ and the identical tree in a `Drawer` below. When
   * this note was written the `/more` route still resolved and nothing linked to
   * it; teardown has since deleted the route outright, so a test asserting
   * "Content is reachable from the navigation" through it would now 404.
   *
   * What the test checks is unchanged: the panel's navigation offers Content, and
   * following it lands on the hub. Only the surface moved.
   */
  test("is reachable from the panel navigation", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/orders");

    await openNav(page);

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

    await expect(row(page, /Livraison et délais/)).toBeVisible();
    await expect(row(page, /Conditions générales de vente/)).toBeVisible();
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

    const draft = row(page, /Retours et remboursements/);
    await expect(draft).toBeVisible();
    await expect(draft.getByText("Brouillon")).toBeVisible();

    await selectSegment(page, "Publié");
    await page.waitForURL(/status=publish/);
    await expect(row(page, /Retours et remboursements/)).toHaveCount(0);
    // The positive control: filtering did not simply empty the list.
    await expect(row(page, /Livraison et délais/)).toBeVisible();
  });

  test("says what the search matches, because it does not match the path", async ({ page }) => {
    await signIn(page, "fr");
    await openPages(page, "fr");

    await expect(page.getByText(/La recherche porte sur le titre et le contenu/)).toBeVisible();

    // And it behaves as advertised: a title finds it, a path does not.
    await page.getByRole("searchbox").fill("Livraison");
    await page.getByRole("searchbox").press("Enter");
    await page.waitForURL(/search=Livraison/);
    await expect(row(page, /Livraison et délais/)).toBeVisible();
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

    await row(page, /Conditions générales de vente/).click();
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

    /* Not saved: the form is left dirty and abandoned. The discard control is
       `SaveBar`'s now, so it carries the shared `ui.form.discard` wording rather
       than the screen's own "Rétablir" — the same button doing the same job under
       the primitive's label. */
    await page.getByRole("button", { name: "Annuler les modifications" }).click();
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

    /* Delete lives in the header `Menu` now rather than in a "danger" group at
       the foot of the form — DESIGN.md §2.4 puts a detail screen's record-state
       action in the header, and §3.2 makes it one menu rather than a loose
       destructive button. Two steps to reach it, then the `ConfirmDialog`. */
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Supprimer cette page" }).click();
    await page.getByRole("button", { name: "Supprimer cette page" }).click();

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

    // The drop report is a `Notice` now rather than a grouped list, and its
    // heading is still the block's own title.
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
    //
    // "du document stocké" is load-bearing and not padding: the section cards
    // are now headed "6. Promotion", numbered over the *surviving* list, so the
    // page carries both numbering schemes and only this phrase separates them.
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

    /*
     * The save is a `SaveBar` that appears only when the form is dirty, so the
     * click is scoped to it — `data-testid="save-bar"` is the primitive's own
     * handle, the same one the products form asserts on.
     */
    const bar = page.getByTestId("save-bar");
    await expect(bar).toBeVisible();
    await bar.getByRole("button", { name: "Enregistrer", exact: true }).click();

    await expect(
      /* The heading, not the text. `ConfirmDialog` gives Radix an accessible
         description carrying the same sentence in an `sr-only` paragraph, so a
         bare text match resolves to two and fails on strict mode rather than on
         the dialog being absent. */
      page.getByRole("heading", { name: /Enregistrer et supprimer les sections illisibles/ }),
    ).toBeVisible();

    /*
     * Declined — nothing is written. Scoped to the dialog and `exact`, because
     * the save bar behind it now offers "Annuler les modifications": an
     * unqualified "Annuler" matches both and fails strict mode before it reaches
     * the assertion.
     */
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Annuler", exact: true })
      .click();
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

    /*
     * One card per placement, headed by the theme's own raw key. There is no
     * placement *filter*: the key is a free string on the API's side, so the
     * allowlisted enumeration can never be complete and DECISIONS.md's picker
     * rule refuses one. This grouping is the presentation of the rows already in
     * hand that stands in for it.
     */
    await expect(page.getByText("home_hero")).toBeVisible();
    // Anchored, because every control in the row names what it acts on:
    // "Monter Soldes d’été", "Descendre …" and "Actions sur …" all contain the
    // title. This one is the identifying cell, which is the row's opener.
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
    /* Filtered to what is on screen: `DataTable` keeps both presentations in the
       DOM and hides one per breakpoint, so `.first()` alone picks the table's
       copy at a phone width and asserts a hidden element is visible. */
    await expect(page.getByText("livraison").filter({ visible: true }).first()).toBeVisible();
  });
});

test.describe("menus", () => {
  test("renders the primary menu and its second level", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/content/menus");
    await page.waitForSelector('[data-testid="menu-count"]');

    /*
     * `menu-count` is rendered by the draft component alone, so waiting on it
     * also waits past the loading and error branches — where the location strip
     * is live and the count is not.
     */
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
    // The location is a `FilterTabs` strip now rather than a `Segmented`, but it
    // still reads its value from `?location=`, so the URL is still the way in.
    await page.goto("/fr/content/menus?location=footer");
    await page.waitForSelector('[data-testid="menu-count"]');

    await expect(page.getByText(/Une erreur/)).toHaveCount(0);
  });
});

/**
 * The media library stays in this file rather than moving to `e2e/media.spec.ts`.
 *
 * `/media` is one of the eight paths the Manager describe below loops over — it
 * shares `ac_manage_content` with the seven `/cms/*` screens and that loop is the
 * whole point of the fixture — so it cannot move without either duplicating the
 * sign-in or asserting the refusal twice. Splitting two of four tests out of a
 * suite whose other half has to stay is the payments judgement (DECISIONS.md §9)
 * for the same reason.
 *
 * **What each test checks is unchanged; only the selectors and the structure
 * are.** The grid is `components/ui/MediaGrid.tsx` now and a tile is a real
 * `<button>` carrying the record's name, so `ul button` became `ul li button`
 * and the count moved from the body to the header's subtitle — the testid is the
 * same one.
 */
test.describe("the media library", () => {
  test("renders a grid with a count", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/media");
    await page.waitForSelector('[data-testid="media-count"]');

    await expect(page.getByTestId("media-count")).not.toContainText("Aucun");
    // A tile is a picture and one line of text, and the picture has to be real:
    // `url` pointed at a host that does not resolve until the media branch.
    await expect(page.locator("ul li button img").first()).toBeVisible();
  });

  test("shows the stored filename rather than the chosen one", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/media");
    await page.waitForSelector('[data-testid="media-count"]');

    await page.locator("ul li button").first().click();
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
    /*
     * `ui.reorder` and not a bare `ui.`, which this branch's move of the reorder
     * labels out of the `content` namespace would otherwise have needed. A bare
     * prefix is unusable: French writes "aujourd’hui." and the assertion would
     * fail on a correctly translated screen. The narrow form catches the keys
     * that actually moved.
     */
    await expect(page.locator("body")).not.toContainText("ui.reorder");
  });

  test("the drop report is Arabic prose with the API's English as detail", async ({ page }) => {
    await signIn(page, "ar");
    await page.goto("/ar/content/homepage");
    await page.waitForSelector('[data-testid="sections-count"]');

    // The `Notice`'s title, which is what the grouped list's heading became.
    await expect(page.getByText("أقسام غير مقروءة")).toBeVisible();
    /*
     * The English sentence is still present and still English — it names the
     * offending type verbatim — but it sits under a localised line rather than
     * standing in for one, and it is `dir="ltr"` so it does not reorder inside
     * the Arabic column. It carries no opacity either: the notice's `-fg` on its
     * own `-bg` measures 5.72:1 and dimming the detail would drop the pair under
     * 4.5, so the demotion is size and direction rather than transparency.
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
    /* The route this branch added, so its forbidden state is covered like the
       six that predate it. The nested categories `Sheet` it replaced could not
       be refused on its own — it had no URL. */
    "/content/faqs/categories",
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
    // Read off `AppShell`'s tree rather than the retired `/more` screen — see
    // the hub describe above.
    await signIn(page, "fr", MANAGER_USER!, MANAGER_PASS!);
    await page.goto("/fr/orders");

    await openNav(page);

    await expect(page.getByRole("link", { name: "Livraison" })).toBeVisible();
    // And Content is not offered at all — a destination they cannot use is left
    // out rather than shown disabled.
    await expect(page.getByRole("link", { name: "Contenu", exact: true })).toHaveCount(0);
  });
});
