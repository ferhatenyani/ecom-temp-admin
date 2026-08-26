import { test, expect, type Page } from "@playwright/test";

/**
 * The dashboard and the six reports.
 *
 * **The money gate is covered here for real, and the brief said it could not
 * be.** The hand-off note reasoned that the two-tier collapse left no credential
 * able to reach `money_visible: false`, and asked whether to state the gap or
 * reinstate a third role in the backend. Neither was needed: `GET /roles` still
 * publishes three retired roles holding `ac_view_analytics` **without**
 * `ac_manage_orders`, `mint-credential.sh` still assigns them because
 * `set_role()` is WordPress core and bypasses the API's narrowing, and
 * `scripts/test.sh` already mints one of them as `AC_LIMITED_*` — a Support
 * Agent.
 *
 * Measured 2026-08-21 with that credential: `/analytics/revenue` is a flat 403,
 * and the other six answer 200 with their money keys **absent** rather than
 * nulled. So the state is reachable, and it is exercised below against the live
 * API, with the Super Admin answering from the same URLs in the same run as the
 * positive control — because a refusal and an unreachable route look identical
 * from outside.
 *
 * What it does *not* cover, stated rather than implied: no **production** role
 * can reach this state today, since both live tiers hold `ac_manage_orders`. The
 * fixture describes a configuration only the test harness can create. That is
 * the same footing the panel's other forbidden fixtures have stood on since the
 * collapse, and README records it.
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
  await page.waitForURL(new RegExp(`/${locale}/(orders|products|coupons|shipping)`));
}

/* ------------------------------------------------------------ the dashboard --- */

test.describe("the dashboard", () => {
  test("leads on one figure and every card drills into a list", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/dashboard");

    const cards = page.locator("[data-testid^='card-']");
    await expect(cards.first()).toBeVisible();
    // Seven in both card sets — that is the point of there being two sets rather
    // than one set with holes in it.
    await expect(cards).toHaveCount(7);

    /*
     * **"Every card" became "every card that has a link", and the guarantee is
     * the same one correctly scoped.** This asserted an `href` on all seven,
     * because `DashboardCard.href` was required — a type-level rule enforcing
     * "a number that cannot be drilled into is decoration". The rule is right
     * about decoration and wrong as a requirement: it forced `awaiting`, which
     * counts `pending + processing`, to link `?status=processing` — half its own
     * number, because `?status=processing,pending` is a measured 400 — and it
     * forced four of a Support Agent's cards to link to a 403. A figure with no
     * honest destination now renders unlinked, never as a link to a refusal and
     * never as a disabled link. What is still forbidden, and is what this checks,
     * is a link that goes anywhere but into this panel.
     */
    const hrefs = await cards.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
    for (const href of hrefs.filter((value) => value !== null)) {
      expect(href).toMatch(/^\/fr\//);
    }
    // And a Super Admin does get links — a scoped assertion that vacuously
    // passes on a grid of seven plain cards would prove nothing.
    expect(hrefs.filter((value) => value !== null).length).toBeGreaterThanOrEqual(6);

    // And the drill-through actually arrives somewhere that exists.
    await page.getByTestId("card-low_stock").click();
    await page.waitForURL("**/fr/inventory");
    await expect(page.locator("body")).not.toContainText("Accès refusé");
  });

  test("reads /analytics/overview once, not the six routes the spec lists", async ({
    page,
  }) => {
    /*
     * ADMIN_PANEL.md names six endpoints for this screen. The overview nests all
     * of them — measured — so the panel asks for one. Counted at the proxy,
     * which is the only place the request is observable from here.
     */
    const asked: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/ac/analytics")) asked.push(url.pathname);
    });

    await signIn(page, "fr");
    await page.goto("/fr/dashboard");
    await expect(page.locator("[data-testid^='card-']").first()).toBeVisible();

    // The server component does the fetching, so the browser makes none at all.
    // The assertion that matters is that nothing fans out client-side.
    expect(asked.filter((p) => p !== "/api/ac/analytics/overview")).toEqual([]);
  });
});

/* ---------------------------------------------------------------- the range --- */

test.describe("the reporting range", () => {
  test("renders the window the API answered, not the one the picker holds", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/analytics?view=orders");

    const applied = page.getByTestId("range-applied");
    await expect(applied).toContainText("30 jours");

    await page.getByRole("button", { name: "7 jours" }).click();
    await page.waitForURL("**/fr/analytics?view=orders&range=7d");
    // Seven days, off `data.range`, which is the only thing this line may show.
    await expect(applied).toContainText("7 jours");
  });

  test("a quiet window says so instead of showing a screen of zeros", async ({ page }) => {
    /*
     * An empty window answers **200 with every figure zero** — measured on all
     * seven routes. Nothing is omitted, so there is no missing key to detect it
     * by and no error to render, which is why the screen has to say the window
     * was quiet rather than let it read as one that failed.
     *
     * **The window is pinned rather than `range=today`, and that is the whole
     * point of this edit.** This test used to ask for today and its own comment
     * said "on a shop with no orders today" — a precondition it stated and did
     * not establish. `ecom-temp`'s own test suite creates order fixtures dated
     * now, so running the backend's tests turned this green assertion red: 53
     * orders landed in today's window and the report correctly stopped saying it
     * was quiet. The test was wrong, not the panel.
     *
     * January 2026 is empty by construction: this shop's orders span
     * 2026-08-16 to 2026-08-21, and the window is 31 days, well inside the API's
     * 366-day cap. A fixture run cannot reach into it.
     *
     * `range=custom` is required for the dates to be honoured at all — sent
     * without it they are accepted and **ignored**, which would silently give
     * this test the thirty-day default and the failure it was written to catch.
     */
    await signIn(page, "fr");
    await page.goto(
      "/fr/analytics?view=orders&range=custom&date_from=2026-01-01&date_to=2026-01-31",
    );

    // The control: the window on screen is the one the API answered, so a
    // silently-ignored parameter cannot pass as an empty result.
    await expect(page.getByTestId("range-applied")).toContainText("31 jours");

    await expect(page.getByTestId("report-orders")).toContainText(
      "Aucune commande sur cette période",
    );
    // The offer to widen, because the window is the filter here.
    await expect(page.getByRole("button", { name: "Élargir la période" })).toBeVisible();
  });

  test("refuses a reversed pair and an over-long window before the round trip", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/analytics?view=orders");

    await page.getByRole("button", { name: "Personnalisée" }).click();

    const from = page.getByLabel("Du", { exact: true });
    const to = page.getByLabel("Au", { exact: true });
    await expect(from).toBeEnabled();

    // Reversed: the API answers 400 `details.fields.date_from`, and the panel
    // says so while the operator is still typing.
    await from.fill("2026-08-21");
    await to.fill("2026-08-11");
    await expect(page.getByText("La date de début ne peut pas être postérieure")).toBeVisible();
    await expect(page.getByRole("button", { name: "Appliquer" })).toBeDisabled();

    // Over 366 days: the API's own cap, mirrored. Matched on the field error's
    // own wording rather than on the number — the sheet's description states the
    // cap too, and both are correct copy.
    await from.fill("2024-01-01");
    await to.fill("2026-08-21");
    await expect(page.getByText("Une période personnalisée couvre")).toBeVisible();
    await expect(page.getByRole("button", { name: "Appliquer" })).toBeDisabled();

    // The positive control — a window the API answered 200 for, and reported
    // back as eleven days.
    await from.fill("2026-08-11");
    await to.fill("2026-08-21");
    const apply = page.getByRole("button", { name: "Appliquer" });
    await expect(apply).toBeEnabled();
    await apply.click();

    await page.waitForURL(/range=custom/);
    await expect(page.getByTestId("range-applied")).toContainText("11 jours");
  });

  test("falls back rather than erroring on a range the API would refuse", async ({
    page,
  }) => {
    // `range=zzz` is a 400 at the API. The panel never sends it: an unknown
    // preset resolves to the API's own default, so the screen renders.
    await signIn(page, "fr");
    await page.goto("/fr/analytics?view=orders&range=zzz");
    await expect(page.getByTestId("range-applied")).toContainText("30 jours");
    await expect(page.getByTestId("report-orders")).not.toContainText("Accès refusé");
  });
});

/* -------------------------------------------------------------- the reports --- */

test.describe("the reports", () => {
  test("proves why the money report counts fewer orders than the shop placed", async ({
    page,
  }) => {
    /*
     * The gap the specification blames on `excluded_currencies` — which was
     * absent from every response measured, and which explains a different gap.
     * The real cause is a status exclusion, and the orders report has the
     * `by_status` that makes it checkable.
     */
    await signIn(page, "fr");
    await page.goto("/fr/analytics?view=orders");

    const report = page.getByTestId("report-orders");
    await expect(report).toContainText("Ce qui compte comme chiffre d’affaires");
    // The proved form of the sentence, which renders only when the four counted
    // statuses actually sum to `counted_as_revenue` on this payload.
    await expect(report).toContainText("vérifié");
  });

  test("names the unattributed wilaya slice and says why, in the page's language", async ({
    page,
  }) => {
    /*
     * 249 orders against Adrar's 39 and Algiers' 1 — the unattributed slice is
     * larger than every attributed wilaya combined, and an unnamed wedge that
     * size reads as a bug.
     */
    await signIn(page, "fr");
    await page.goto("/fr/analytics?view=shipping");

    const report = page.getByTestId("report-shipping");
    await expect(report).toContainText("Sans wilaya");
    await expect(report).toContainText("La wilaya vient du colis");

    // And the API's English sentence never reaches the screen. The panel has
    // wording for this reason, so the raw note is not rendered — the same rule
    // `unavailable` follows.
    await expect(report).not.toContainText("carry no canonical wilaya");
  });

  test("reports what cannot be known as a reason, never as zero", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/analytics");

    const report = page.getByTestId("report-revenue");
    await expect(report).toContainText("Non calculable");
    await expect(report).toContainText("Marge");
    // A zero that means "we cannot know" is a number someone will put in a
    // report, so the three unavailable lines carry no figure at all.
    await expect(report).toContainText("Aucun prix de revient");
    // And the English the API sends is replaced, not passed through.
    await expect(report).not.toContainText("No cost of goods exists");
  });

  test("keeps every report reachable from one control", async ({ page }) => {
    await signIn(page, "fr");
    await page.goto("/fr/analytics");

    for (const [label, view] of [
      ["Commandes", "orders"],
      ["Produits", "products"],
      ["Clients", "customers"],
      ["Livraison", "shipping"],
      ["Contre-remboursement", "cod"],
    ] as const) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.waitForURL(new RegExp(`view=${view}`));
      await expect(page.getByTestId(`report-${view}`)).toBeVisible();
    }
  });
});

/* ------------------------------------------------------------ the money gate --- */

test.describe("the money gate", () => {
  test.skip(
    !LIMITED_USER || !LIMITED_PASS,
    "Needs AC_LIMITED_* (a Support Agent: ac_view_analytics without ac_manage_orders).",
  );

  test("a Super Admin sees the money — the positive control", async ({ page }) => {
    /*
     * Every negative test carries a positive control: a refusal and an
     * unreachable route look identical from outside, and so do a gated figure
     * and a screen that failed to load.
     */
    await signIn(page, "fr");
    await page.goto("/fr/analytics");
    await expect(page.getByTestId("report-revenue")).toContainText("Net");
    await expect(page.getByTestId("report-revenue")).toContainText("DA");

    await page.goto("/fr/dashboard");
    await expect(page.getByTestId("card-net")).toBeVisible();
    // The currency, on the dashboard's own lead card. This is the positive half
    // of the money-blind test below, which asserts no `DA` anywhere in the body:
    // without this, that assertion would also pass on a screen that failed to
    // render a figure at all.
    await expect(page.getByTestId("card-net")).toContainText("DA");
  });

  test("a Support Agent gets a named refusal on the revenue report", async ({ page }) => {
    await signIn(page, "fr", LIMITED_USER!, LIMITED_PASS!);
    await page.goto("/fr/analytics?view=revenue");

    const report = page.getByTestId("report-revenue");
    // The capability comes off `meta.money_requires` — `ac_manage_orders`, which
    // is not in the specification — the same discipline as rendering a 409's
    // `allowed` list rather than the panel's own idea of the rule.
    await expect(report).toContainText("Accès refusé");
    await expect(report).toContainText("Commandes");
    await expect(report).not.toContainText("DA");
  });

  test("a Support Agent gets a whole dashboard, with no holes where the money was", async ({
    page,
  }) => {
    await signIn(page, "fr", LIMITED_USER!, LIMITED_PASS!);
    await page.goto("/fr/dashboard");

    const cards = page.locator("[data-testid^='card-']");
    await expect(cards.first()).toBeVisible();
    // The same count as the money set. A grid that drops two cards and leaves
    // the gaps tells a Support Agent the screen is broken.
    await expect(cards).toHaveCount(7);
    await expect(page.getByTestId("card-net")).toHaveCount(0);
    await expect(page.getByTestId("card-collected")).toHaveCount(0);
    await expect(page.getByTestId("card-orders_placed")).toBeVisible();

    // No currency anywhere, and no currency-shaped hole either.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\bDA\b/);
    expect(body).not.toMatch(/NaN|undefined/);

    /*
     * **And no link to a refusal, which is the second gate on this screen.**
     * Measured 2026-08-26 with this credential: 403 on `/orders` and
     * `/inventory`, 200 on `/customers`. Four of these seven cards lead into
     * those two collections, so they render with their figure and **no link** —
     * not a dimmed one, not a disabled one. The figure stays because the reader
     * is entitled to the number; only the destination is refused.
     *
     * Asserted on the rendered element rather than on the count, because a
     * disabled-looking anchor is still an anchor: the keyboard reaches it, Enter
     * follows it and the context menu opens it in a tab.
     */
    for (const key of ["orders_placed", "completed", "low_stock", "awaiting"]) {
      const card = page.getByTestId(`card-${key}`);
      await expect(card).toBeVisible();
      await expect(card).not.toHaveAttribute("href", /./);
      expect(await card.evaluate((node) => node.tagName)).not.toBe("A");
    }
    // `/customers` is the one this credential is 200 on, and it is still a link
    // — the negative above would pass just as well on a screen with no links at
    // all.
    await expect(page.getByTestId("card-customers")).toHaveAttribute("href", "/fr/customers");
  });

  test("a Support Agent still reads every report that is not money", async ({ page }) => {
    /*
     * The other half of the gate, and the half that is easy to get wrong: the
     * six remaining routes answer **200 with their money keys absent**, not 403.
     * A panel that hid them would invent a rule the API does not have.
     */
    await signIn(page, "fr", LIMITED_USER!, LIMITED_PASS!);

    for (const view of ["orders", "products", "customers", "shipping", "cod"]) {
      await page.goto(`/fr/analytics?view=${view}`);
      const report = page.getByTestId(`report-${view}`);
      await expect(report).toBeVisible();
      await expect(report).not.toContainText("Accès refusé");
    }

    // Counts stay, money goes — the report degrades to a narrower one.
    await page.goto("/fr/analytics?view=orders");
    await expect(page.getByTestId("report-orders")).toContainText("Commandes passées");
    await expect(page.getByTestId("report-orders")).not.toContainText("Panier moyen");
  });

  test("a 403 is a screen state and never a logout", async ({ page }) => {
    await signIn(page, "fr", LIMITED_USER!, LIMITED_PASS!);
    await page.goto("/fr/analytics?view=revenue");
    await expect(page.getByTestId("report-revenue")).toContainText("Accès refusé");

    // Still signed in: a report this role *can* read still works.
    await page.goto("/fr/analytics?view=cod");
    await expect(page.getByTestId("report-cod")).toBeVisible();
    await expect(page).not.toHaveURL(/login/);
  });
});

/* ------------------------------------------------------------ both directions --- */

test.describe("both directions", () => {
  test("keeps a money figure's digits in order inside Arabic text", async ({ page }) => {
    /*
     * Asserted on the **rendered geometry**, not on a `dir` attribute — an
     * attribute cannot catch a reorder, which is the whole reason `Ltr` exists.
     */
    await signIn(page, "ar");
    await page.goto("/ar/analytics");

    const figure = page.getByTestId("report-revenue").locator("[data-numeric]").first();
    await expect(figure).toBeVisible();

    const text = await figure.innerText();
    // The grouped thousands must read left to right whatever surrounds them.
    expect(text).toMatch(/\d/);

    const dir = await figure.evaluate((el) => getComputedStyle(el).direction);
    expect(dir).toBe("ltr");
  });

  test("mirrors the bar's growing end without mirroring its number", async ({ page }) => {
    await signIn(page, "ar");
    await page.goto("/ar/analytics?view=orders");
    await expect(page.getByTestId("report-orders")).toBeVisible();

    const geometry = await page.evaluate(() => {
      const fill = document.querySelector(".bar-fill");
      const track = fill?.parentElement;
      if (!fill || !track) return null;
      const f = fill.getBoundingClientRect();
      const t = track.getBoundingClientRect();
      // In RTL the bar grows from the right, so its right edge sits on the
      // track's right edge and its left edge does not reach the track's left.
      return { alignedEnd: Math.abs(f.right - t.right) <= 1, shorter: f.left > t.left };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.alignedEnd).toBe(true);
    expect(geometry!.shorter).toBe(true);
  });

  test("does not overflow at the floor in either locale", async ({ page }) => {
    // One sign-in serves both locales: the session is a cookie and the locale is
    // a URL segment. Signing in twice lands on the panel rather than on the login
    // form the second time, and then waits 30 s for a `#username` that is not
    // there.
    await signIn(page, "fr");

    for (const locale of ["fr", "ar"]) {
      for (const view of ["revenue", "orders", "products", "customers", "shipping", "cod"]) {
        await page.goto(`/${locale}/analytics?view=${view}`);
        await expect(page.getByTestId(`report-${view}`)).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${locale}/${view}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
