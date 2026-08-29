import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Settings, staff, the trail and the transfers — deliberately small.
 *
 * **Nine tests, one project.** Almost everything about these four screens that a
 * schema can answer is answered in `tests/admin-schema.test.ts`, which parses 79
 * captured payloads across four credentials and covers the capability grid, the
 * two settings error shapes, the five escalation refusals, the role matrix, the
 * four audit metadata shapes and the four import preview shapes. What is left
 * for a browser is the handful of things a schema cannot see:
 *
 *   - the **capability boundary** reaching a screen, which is a fact about the
 *     session and the proxy rather than about a payload — and it is asserted
 *     with a Manager, who is a refusal on three screens and a **success** on the
 *     fourth in the same session;
 *   - that a **download actually arrives**, with the API's filename and a body
 *     that is a CSV rather than a JSON string — the one thing no unit test can
 *     reach, since it goes through a Route Handler and not through `acRead`;
 *   - that **suspend and reactivate** walk, which is why `seed-staff.mjs` exists;
 *   - that a **settings save** round-trips through a form bound to the response;
 *   - that the trail's **date filter** narrows on screen, which it did not do at
 *     all before this branch's backend work.
 *
 * There is no capture suite on this branch and no four-width sweep, by
 * instruction. Anything a screenshot would have proved is proved by a unit test
 * or is not proved.
 *
 * The suspended fixture comes from `scripts/seed-staff.mjs`, whose own floor
 * asserts `?status=suspended` answers — so a failure here is a failure of the
 * panel rather than of a shop that drifted.
 */

const USER = process.env.AC_STAFF_USER;
const PASS = process.env.AC_STAFF_PASS;
const MANAGER_USER = process.env.AC_MANAGER_USER;
const MANAGER_PASS = process.env.AC_MANAGER_PASS;

test.skip(
  !USER || !PASS,
  "Set AC_STAFF_USER and AC_STAFF_PASS to a real Application Password.",
);

/** The account `scripts/seed-staff.mjs` creates and suspends. */
const SUSPENDED = "ac_panel_suspended";

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
 * actionability check on a visually hidden input never passes. Every suite since
 * the customers branch documents this.
 */
async function selectSegment(page: Page, label: string) {
  await page.locator("label", { hasText: new RegExp(`^${label}$`) }).click();
}

/**
 * One row of a migrated list, at whichever width the project is running.
 *
 * **This file had no `rows()` helper while eight of the eleven other list specs
 * do**, and the three staff tests each resolved rows through
 * `page.locator('a[href*="/users/"]')` instead. That was already fragile — the
 * comment at the mint test records a near-miss where the create button's own
 * anchor matched before any row — and the staff redesign makes it wrong outright:
 * `DataTable` renders **both** presentations into the DOM at every width and
 * hides one with `md:` classes, so an unfiltered anchor selector counts every row
 * twice the moment the record list is in the tree.
 *
 * Coupons' shape, and the `visible` filter is the load-bearing half: `tbody tr`
 * is the table and `li.ui-card` is the record list, and exactly one of the two is
 * rendered at any width.
 */
function rows(page: Page): Locator {
  return page.locator("tbody tr, li.ui-card").filter({ visible: true });
}

/** The row for one account, found by the login the fixture pins. */
function rowFor(page: Page, login: string): Locator {
  return rows(page).filter({ hasText: login }).first();
}

test.describe("settings", () => {
  test("renders the writable blocks, the refused ones with their reason, and saves", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/settings");

    // Four blocks that write.
    for (const heading of ["Boutique", "Coordonnées", "Registre du commerce", "Réseaux sociaux"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    /*
     * The two that do not, **each with its reason on screen** — which is
     * ADMIN_PANEL.md's requirement and its argument for it: a greyed field with
     * no explanation is a support ticket.
     */
    await expect(page.getByRole("heading", { name: "Fonctionnalités" })).toBeVisible();
    await expect(page.getByText(/variables d’environnement/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prestataires actifs" })).toBeVisible();

    /*
     * And the third kind of read-only, which the spec does not mention at all:
     * a key refused from *inside* a block it calls writable. `store` publishes
     * eight keys and accepts four.
     */
    await expect(page.getByText(/commande par commande/)).toBeVisible();

    // The consequence of an empty storefront URL, which this shop has.
    await expect(page.getByText(/L’adresse de la boutique n’est pas renseignée/)).toBeVisible();

    /*
     * A real save, and then the form rebinds to the response — `PATCH` answers
     * with the whole document, so what the form holds afterwards is what the
     * API normalised rather than what was typed.
     */
    const stamp = `+213 555 ${Date.now() % 100000}`;
    const phone = page.getByLabel("Téléphone");
    await expect(phone).toBeEnabled();
    await phone.fill(stamp);

    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Réglages enregistrés.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Téléphone")).toHaveValue(stamp);

    // Left as it was found.
    await page.getByLabel("Téléphone").fill("");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
  });

  test("renders in Arabic without leaking a message key", async ({ page }) => {
    /*
     * The 14b and 14c defects, in one assertion each. A `.` in a message key is
     * a `next-intl` path separator and a `{{token}}` is an ICU placeholder;
     * both render the **key path** as visible text while every other test
     * passes, because the page still carries a plausible amount of writing.
     * `tests/admin-schema.test.ts` floors both statically; this catches a call
     * site that resolves to a path the file does not have.
     */
    await signIn(page, "ar");
    await page.goto("/ar/settings");

    await expect(page.getByRole("heading", { name: "المتجر" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/settings\.[a-z]/i);
    expect(body).not.toContain("{{");
    expect(body).not.toContain("undefined");
  });
});

test.describe("staff", () => {
  test("suspends and reactivates, which had no fixture before the seed", async ({ page }) => {
    /*
     * **Measured before `scripts/seed-staff.mjs`: every account was `active`.**
     * So this test is the seed's whole justification — without it the suspended
     * badge, the reactivate action and the `?status=` filter are three controls
     * with nothing to act on, which is 14b's "every row is pending" one
     * collection over.
     *
     * It walks the pair in one direction and back, and the seed re-asserts the
     * suspended state on the next run, so this file can leave the shop as it
     * found it without needing to.
     *
     * **The second press is now the `ConfirmDialog`'s**, not an `ActionSheet`
     * item. Both overlays put a second control with the same label on screen, so
     * the `.last()` shape survives the primitive change — what changed is that
     * the dialog's confirm is a real button in a focus trap with Cancel as the
     * default focus, which is why the assertions below wait on the dialog's own
     * heading before pressing.
     */
    await signIn(page, "fr");
    await page.goto("/fr/users?status=suspended");
    await page.waitForSelector('[data-testid="users-count"]');

    const row = rowFor(page, SUSPENDED);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Suspendu");
    await row.getByRole("link").first().click();

    // Reactivate. The tone flips with the outcome, so this one is the primary.
    await expect(page.getByRole("button", { name: "Réactiver" })).toBeEnabled();
    await page.getByRole("button", { name: "Réactiver" }).click();
    await expect(page.getByRole("heading", { name: "Réactiver ce compte ?" })).toBeVisible();
    await page.getByRole("button", { name: "Réactiver" }).last().click();
    await expect(page.getByText("Compte réactivé.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Suspendre" })).toBeVisible();

    // And back, so the fixture survives a run that is not followed by the seed.
    await page.getByRole("button", { name: "Suspendre" }).first().click();
    await expect(page.getByRole("heading", { name: "Suspendre ce compte ?" })).toBeVisible();
    await page.getByRole("button", { name: "Suspendre" }).last().click();
    await expect(page.getByText("Compte suspendu.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Réactiver" })).toBeVisible();
  });

  test("shows the escalation refusals on your own account rather than hiding them", async ({
    page,
  }) => {
    /*
     * ADMIN_PANEL.md is explicit: the refusals **are** the security model, and a
     * Super Admin should be able to see it. So each one's *reason* renders on the
     * caller's own row — which is the one account the panel can be certain about
     * without asking — and the three sentences below are asserted verbatim
     * because they are the contract §87 describes.
     *
     * **What changed with the redesign is the control, not the subject.** The
     * three used to be disabled buttons with the reason beside them; they are now
     * absent, with the reason in their place, because DESIGN.md §3.3 is
     * unconditional — a control that cannot act is not rendered — and this screen
     * was the last one in the panel arguing the other way. So the two
     * `toBeDisabled()` assertions became `toHaveCount(0)`. The test's title is
     * unchanged and still true: it is about the refusals being *shown* rather
     * than hidden, and all three sentences are still on screen. `UserDetail.tsx`
     * carries the argument.
     *
     * The role assertion is unchanged and still non-vacuous: on an ordinary
     * account the picker *is* the account's role and is labelled "Rôle", so the
     * selector matches exactly one control there and none here. (It picks up
     * "Nouveau rôle" too — `getByLabel` is a case-insensitive substring — which
     * is the label the picker takes only on an account whose current role it
     * cannot represent. Both are controls that must be absent on your own row.)
     * The held role renders as a `ReadOnlyField`, which is two `<span>`s and no
     * `<label>`, so it is not a false positive.
     */
    await signIn(page, "fr");
    await page.goto("/fr/users");
    await page.waitForSelector('[data-testid="users-count"]');

    const mine = rows(page).filter({ hasText: "Vous" }).first();
    await expect(mine).toBeVisible();
    await mine.getByRole("link").first().click();

    // The role picker is replaced by a value and a reason. Not disabled: absent.
    await expect(page.getByText(/Vous ne pouvez pas changer votre propre rôle/)).toBeVisible();
    await expect(page.getByLabel("Rôle")).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Suspendre" })).toHaveCount(0);
    await expect(page.getByText(/Vous ne pouvez pas suspendre votre propre compte/)).toBeVisible();

    await expect(page.getByRole("button", { name: "Supprimer le compte" })).toHaveCount(0);
    await expect(page.getByText(/Vous ne pouvez pas supprimer votre propre compte/)).toBeVisible();
  });

  test("mints an application password and shows it exactly once", async ({ page }) => {
    /*
     * **This is why §87 exists.** WordPress shows an application password once,
     * at creation, in wp-admin — the dashboard PLAN §52 says routine
     * administration must not require. The panel's job is to show it once here
     * instead, and to offer no reveal affordance anywhere, because there is
     * nothing to reveal.
     *
     * Minted against the seeded account, and revoked at the end of the test, so
     * the fixture's device list is where it started.
     */
    await signIn(page, "fr");
    await page.goto("/fr/users?search=" + SUSPENDED);
    await page.waitForSelector('[data-testid="users-count"]');
    /*
     * Found by the username through `rows()`, never by a bare
     * `a[href*="/users/"]`: the header's create button is an
     * `<a href="/fr/users/new">` and used to match before any row — which is how
     * the first version of this test ended up on the create form asserting a
     * suspension notice — and since the redesign `DataTable` puts both the table
     * and the record list in the DOM at once, so that selector would also match
     * every row twice.
     */
    await rowFor(page, SUSPENDED).getByRole("link").first().click();

    /*
     * A suspended account refuses a credential with its own 409 — the panel
     * pre-empts it with the reason, because a credential issued to a suspended
     * account answers 401 everywhere and would be a key to a locked door.
     *
     * **The control is absent rather than disabled** since the redesign, per
     * DESIGN.md §3.3 — the sentence is what teaches the rule, and the dimmed
     * button never was. Same subject, same reason, one assertion changed from
     * `toBeDisabled()` to `toHaveCount(0)`.
     */
    await expect(page.getByText(/Ce compte est suspendu/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Générer un mot de passe" })).toHaveCount(0);

    // Reactivate so the mint is reachable, then put it back at the end.
    await page.getByRole("button", { name: "Réactiver" }).click();
    await expect(page.getByRole("heading", { name: "Réactiver ce compte ?" })).toBeVisible();
    await page.getByRole("button", { name: "Réactiver" }).last().click();
    await expect(page.getByText("Compte réactivé.")).toBeVisible();

    const name = `E2E ${Date.now()}`;
    await expect(page.getByLabel("Nom de l’appareil")).toBeEnabled();
    await page.getByLabel("Nom de l’appareil").fill(name);
    await page.getByRole("button", { name: "Générer un mot de passe" }).click();

    /*
     * The secret, once — **in a `Modal` now, not a `Sheet`.** §3.1 gives a modal
     * to "a task that must be finished or abandoned", and this value cannot be
     * read again anywhere, which makes it the purest example of that in the
     * panel. The assertion is on the dialog's own heading rather than on loose
     * text, because a `Modal` gives it a real `role="heading"` and the old
     * `getByText` would also match the visually hidden description Radix
     * requires.
     */
    await expect(
      page.getByRole("heading", { name: "Le mot de passe, une seule fois" }),
    ).toBeVisible();
    const secret = await page.getByText(/^[A-Za-z0-9]{16,}$/).first().innerText();
    expect(secret.length).toBeGreaterThan(16);
    await page.getByRole("button", { name: "J’ai copié le mot de passe" }).click();

    /*
     * And nowhere else, ever. The collection, the detail and the audit row all
     * omit it — asserted here against the rendered DOM rather than against a
     * payload, because this is the screen a person is looking at.
     */
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(secret);

    await page.reload();
    await expect(page.locator("body")).not.toContainText(secret);

    /*
     * Teardown: revoke the device and re-suspend the account.
     *
     * The row's revoke is an `IconButton` now, named "Révoquer « <device> »" so
     * a list of three devices does not offer three controls with one name.
     * `getByRole`'s `name` is a case-insensitive substring by default, so
     * "Révoquer" still reaches it — `.first()` is the row's, `.last()` is the
     * `ConfirmDialog`'s confirm.
     */
    await page.getByRole("button", { name: "Révoquer" }).first().click();
    await expect(page.getByRole("heading", { name: "Révoquer ce mot de passe ?" })).toBeVisible();
    await page.getByRole("button", { name: "Révoquer" }).last().click();
    await expect(page.getByText("Mot de passe révoqué.")).toBeVisible();

    await page.getByRole("button", { name: "Suspendre" }).first().click();
    await expect(page.getByRole("heading", { name: "Suspendre ce compte ?" })).toBeVisible();
    await page.getByRole("button", { name: "Suspendre" }).last().click();
    await expect(page.getByText("Compte suspendu.")).toBeVisible();
  });
});

test.describe("the trail", () => {
  test("narrows by a date range that did not filter at all before this branch", async ({
    page,
  }) => {
    /*
     * `?date_from=` and `?date_to=` were **accepted and silently ignored** —
     * 16 632 rows returned for every value, which is §65's failure mode. Both
     * are named in ADMIN_PANEL.md as though they worked, and 16 632 rows at 20
     * a page is 832 pages, so two clauses went into `AuditRepository` on a
     * narrow backend branch before this screen existed.
     *
     * The assertion is a **comparison**, never a count: this trail grows with
     * every request the suite makes, so a fixed number would be a test that
     * passes today.
     */
    await signIn(page, "fr");
    await page.goto("/fr/audit");
    await page.waitForSelector('[data-testid="audit-count"]');

    const whole = await page.getByTestId("audit-count").innerText();
    const wholeCount = Number(whole.replace(/\D/g, ""));
    expect(wholeCount).toBeGreaterThan(100);

    // A window a long way before this shop existed.
    await page.goto("/fr/audit?date_from=2019-01-01&date_to=2019-01-02");
    await page.waitForSelector('[data-testid="audit-count"]');
    await expect(page.getByText("Aucune entrée pour ces filtres.")).toBeVisible();

    // The positive control, in the same session: a filter that works narrows to
    // something rather than to nothing.
    await page.goto("/fr/audit?action=user.created");
    await page.waitForSelector('[data-testid="audit-count"]');
    const filtered = Number((await page.getByTestId("audit-count").innerText()).replace(/\D/g, ""));
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(wholeCount);

    /*
     * And the action renders as itself. It is an identifier, not prose: 85
     * distinct values on this install, every one carrying a `.` that would be a
     * `next-intl` path separator if it were ever used as a message key.
     */
    await expect(page.getByText("user.created").first()).toBeVisible();
  });
});

test.describe("import and export", () => {
  test("downloads a real CSV with the API's own filename", async ({ page }) => {
    /*
     * **The one thing no unit test can reach.** The download goes through
     * `app/api/export/[subject]/route.ts` — a Route Handler, not `acRead` — and
     * everything that matters about it is in the response rather than in a
     * payload: the filename is the API's, the body is a CSV and not a JSON
     * string, and it opens with the UTF-8 BOM Excel needs.
     *
     * Both export defects this branch found in `ecom-temp` are caught here in
     * one assertion each: the body was JSON-encoded (one quoted line, the BOM as
     * six characters) and the product export had no header row.
     */
    await signIn(page, "fr");
    await page.goto("/fr/transfer");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-inventory").click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^inventory-export-\d{4}-\d{2}-\d{2}\.csv$/);

    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(path);

    // A real byte-order mark, not the six characters a JSON encoder produces.
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const text = bytes.toString("utf8").replace(/^﻿/, "");
    expect(text.startsWith('"')).toBe(false);
    expect(text.split(/\r?\n/)[0]).toContain("sku,stock_quantity");
    // More than one line, which a JSON-encoded body never is however many rows
    // it holds — the assertion the backend's own suite was blind to.
    expect(text.split(/\r?\n/).filter((line) => line !== "").length).toBeGreaterThan(1);
  });

  test("previews an import without writing, and says so", async ({ page }) => {
    /*
     * `dry_run` defaults to **true**, which is the safety property, and the
     * panel makes it visible rather than relying on it: the preview is the
     * screen and applying is a separate action. The response echoes the flag, so
     * the badge quotes the server rather than what the panel asked for.
     *
     * The file names a SKU that does not exist, so a run that ignored the flag
     * would still write nothing — the test cannot damage the shop even if the
     * property it asserts is broken.
     */
    await signIn(page, "fr");
    await page.goto("/fr/transfer");

    /*
     * **Scoped to the inventory card, not `.last()`.** Both import subjects
     * render the same two controls, and the two locators here used to resolve
     * them by document order — which silently re-targets the whole test the day
     * a third subject is added or the two are reordered, exactly the class of bug
     * `rows()` at the top of this file was written to avoid. `import-inventory`
     * is a handle on the card, so the file and the button are read from the same
     * place the assertions below are about.
     *
     * `setInputFiles` goes to the input itself rather than through a click:
     * Playwright sets files on the element, and `FileField` renders a real
     * `<input type="file">` inside its labelled frame.
     */
    const inventory = page.getByTestId("import-inventory");

    await inventory.locator('input[type="file"]').setInputFiles({
      name: "stock.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("sku,stock_quantity\nAC-NOT-A-REAL-SKU,4\n"),
    });

    await inventory.getByRole("button", { name: "Prévisualiser" }).click();

    /*
     * The badge the server's own `dry_run` produced, `exact` and scoped.
     * `getByText` is a case-insensitive *substring* match by default, and the
     * safety footnote on each import card opens "La prévisualisation n'écrit
     * jamais rien" — so the bare string resolves the badge **and** both
     * footnotes, which is a strict-mode violation rather than an assertion. The
     * badge's whole text is the word, so `exact` picks it and nothing else.
     */
    await expect(inventory.getByText("Prévisualisation", { exact: true })).toBeVisible();
    // The row error, with the field name and the API's own sentence under it.
    await expect(page.getByText(/An inventory import never creates products/)).toBeVisible();

    /*
     * **The report would write nothing, and the screen has to say so.** Every
     * row failed, so `created` and `updated` are both zero — and this assertion
     * is the one that corrected `reportIsNoOp()`, which used to require
     * `failed === 0` as well and therefore called a file of nothing but errors
     * "work to do", offering an Apply button that could only fail again.
     */
    await expect(inventory.getByText(/n’écrirait rien/)).toBeVisible();
    /*
     * Still a **disabled button** and not an absent one. §3.3 removes a control
     * that cannot act; this one is waiting on input — a file whose rows would
     * write something — and acts the moment it arrives, so it stays and carries
     * its reason in `title`. Nothing else on the card is named "Appliquer": the
     * confirm dialog's own button reads "Appliquer l'import" and is unmounted
     * while the dialog is closed.
     */
    await expect(inventory.getByRole("button", { name: "Appliquer" })).toBeDisabled();
  });
});

test.describe("the capability boundary", () => {
  test.skip(
    !MANAGER_USER || !MANAGER_PASS,
    "Set AC_MANAGER_USER and AC_MANAGER_PASS — the branch's forbidden fixture.",
  );

  test("refuses a Manager three subjects and gives them the fourth", async ({ page }) => {
    /*
     * **One credential, both halves of the branch**, and it is the strongest
     * fixture any branch here has had. Measured across four credentials:
     * settings, users and audit are `ac_manage_settings`, `ac_manage_users` and
     * `ac_view_audit_logs`, which after the two-tier collapse name the Super
     * Admin tier alone — while import and export follow the *resource*, and a
     * Manager holds all four of those capabilities.
     *
     * A refusal test with no positive control in the same session proves the
     * screen refuses; it does not prove the screen works. This one does both.
     */
    await signIn(page, "fr", MANAGER_USER!, MANAGER_PASS!);

    for (const [path, capability] of [
      ["/fr/settings", "Réglages"],
      ["/fr/users", "Utilisateurs"],
      ["/fr/audit", "Journal d’audit"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
      /*
       * The *sentence*, not the word: a forbidden screen carries the section's
       * own name three times — the collapsed title, the large title and the
       * explanation — so matching the bare capability name is a strict-mode
       * violation rather than an assertion.
       */
      await expect(
        page.getByText(`Cette section demande la permission ${capability}.`),
      ).toBeVisible();
    }

    // The positive half, same session: every export is theirs.
    await page.goto("/fr/transfer");
    for (const subject of ["products", "orders", "inventory", "customers"]) {
      await expect(page.getByTestId(`export-${subject}`)).toBeVisible();
    }

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-orders").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^orders-export-/);

    /*
     * And the proxy is the authority, not the screen. A Manager typing the URL
     * of a route their capability does not cover gets the API's 403 through the
     * panel's own reader, never a blank page — asserted through `fetch` because
     * this is about the boundary rather than about a rendering.
     */
    const forbidden = await page.evaluate(async () => {
      const response = await fetch("/api/ac/users?per_page=1");
      return response.status;
    });
    expect(forbidden).toBe(403);
  });
});
