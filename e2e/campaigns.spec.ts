import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Marketing: the composer, segments and templates — deliberately small.
 *
 * **Twelve tests, one project** — nine of them before the gaps branch, and the
 * header said "eight" for two branches before anybody counted. `tests/campaign-schema.test.ts` answers
 * everything a schema can, against 28 captured payloads: the status vocabulary,
 * the transition flags, both capability-scoped nulls, the three ways `send`
 * refuses, the recipient partition, the token warning and the composer's own
 * step rules. What is left for a browser is what a payload cannot show —
 *
 *   - the wizard **actually walking**, step to step, saving as it goes;
 *   - the send confirmation reaching the screen as a sentence saying nothing
 *     was sent;
 *   - the capability refusal, which is a fact about a session and not a payload;
 *   - that a sent campaign renders as a record rather than as a form.
 *
 * **Three arrived with the marketing gaps branch**, and each is a fact about a
 * session or about time rather than about a payload: the customer picker
 * appearing for a reader who holds `ac_manage_customers`, the comma-separated
 * field staying for one who does not, and a terminal campaign **not** being
 * re-read on the poll's interval. The last one costs 35 seconds of real waiting
 * and says in its own body why it cannot cost less.
 *
 * No capture suite and no four-width sweep, by instruction.
 *
 * Every fixture comes from `scripts/seed-campaigns.mjs`, whose own floor asserts
 * it created them — so a failure here is a failure of the panel rather than of a
 * shop that drifted.
 *
 * ## What the redesign changed here, and what it did not
 *
 * Nine declarations before and nine after, titles byte-identical — the gaps
 * branch then added three more without touching any of them. Every assertion
 * still checks the same fact; what moved is how a row is reached.
 *
 * **A campaign row now opens a peek drawer rather than navigating.**
 * `GET /campaigns/{id}` is value-identical to the list row, so the preview is
 * free — DECISIONS.md §15 — and the drawer's primary is what goes to the
 * composer or to the record, labelled from `is_editable`. So `openCampaign()`
 * below is two clicks where it used to be one, and the label it clicks is the
 * assertion that the flag reached the screen.
 *
 * **`selectSegment()` kept its name and lost its body.** It was written for
 * `Segmented`'s `sr-only` radio, which a pointer can only reach through its
 * `<label>`; `FilterTabs` draws a real `<button>`, so the label locator matched
 * nothing at all. The content branch made the same change for the same reason.
 *
 * **Rows resolve through the visible-filtered helper coupons introduced.** Both
 * presentations are in the DOM at every width — `DataTable` at `md`+ and
 * `RecordList` below — so a bare `getByText(name)` matches twice and every
 * `toBeVisible()` is a strict-mode violation before it reaches its own
 * assertion. Every project here bar one is phone-sized, so the table is the copy
 * that is never painted.
 */

/**
 * The rows that are actually on screen, whichever presentation that is.
 * `e2e/coupons.spec.ts`'s helper, and the reason is the same one: a row is read
 * as well as clicked, so the container has to be the one carrying the text.
 */
function rows(page: Page): Locator {
  return page.locator("tbody tr, li.ui-card").filter({ visible: true });
}

const USER = process.env.AC_STAFF_USER;
const PASS = process.env.AC_STAFF_PASS;
const MARKETING_USER = process.env.AC_MARKETING_USER;
const MARKETING_PASS = process.env.AC_MARKETING_PASS;

test.skip(!USER || !PASS, "Set AC_STAFF_USER and AC_STAFF_PASS.");

async function signIn(page: Page, locale: string, user = USER!, pass = PASS!) {
  await page.goto(`/${locale}/login`);
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await page.click('button[type="submit"]');
  await page.waitForURL(new RegExp(`/${locale}/(orders|products|coupons|dashboard)`));
}

/**
 * **A straight apostrophe, and that is measured rather than a typo.**
 *
 * `seed-cms.mjs` had to fold curly quotes back because WordPress *texturizes*
 * what it stores — `Soldes d'été` went in and came back with numeric character
 * reference 8217 — and that seed created a duplicate banner on its second run
 * before it learned. Campaigns live in their own table and never go through
 * `wp_insert_post`, so the texturizer never sees them: `POST /campaigns` stores
 * the apostrophe exactly as sent. Two seeds, two behaviours, one shop.
 *
 * This test looked for the curly form and found nothing.
 */
const DRAFT_NAME = "Soldes d'août — brouillon";

/**
 * Put the composer's audience step on `ids` without saving anything.
 *
 * The `Select` is a real `<select>` and its `onChange` moves the *draft* only —
 * nothing is PATCHed until "Continuer" — so a test can reach the control the
 * picker lives on and leave the campaign exactly as it found it. That property is
 * why these three tests can run against the shop's own drafts at all.
 */
async function chooseIdsAudience(page: Page) {
  await page.getByLabel("Audience", { exact: true }).selectOption("ids");
}

/** A `FilterTabs` chip is a real `<button>`; the retired `Segmented` was not. */
async function selectSegment(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function openCampaigns(page: Page, locale: string) {
  await page.goto(`/${locale}/marketing/campaigns`);
  await page.waitForSelector('[data-testid="campaigns-count"]');
}

/**
 * A row's peek, then the screen behind it.
 *
 * The drawer's primary is labelled from `is_editable` — "Ouvrir le composeur" on
 * a draft, "Ouvrir le registre" on anything else — so asking for the link by name
 * asserts the flag reached the screen on the way past.
 */
async function openCampaign(page: Page, name: string, action: string) {
  await rows(page).filter({ hasText: name }).first().click();
  await page.getByRole("link", { name: action }).click();
}

/**
 * Reveal the navigation tree, at whichever width this project runs.
 *
 * `AppShell` paints the same tree twice: a persistent sidebar from `lg` up and a
 * `Drawer` below it, opened from the top bar's menu button. Only one is ever
 * painted, so the drawer trigger's visibility *is* the breakpoint test — no
 * viewport arithmetic in the spec. The same helper as `e2e/content.spec.ts`'s.
 */
async function openNav(page: Page) {
  const trigger = page.getByRole("button", { name: "Navigation principale" });
  if (await trigger.isVisible()) await trigger.click();
}

test.describe("the hub", () => {
  /*
   * **This used to start at `/fr/more`, and that surface is gone.**
   * `patterns/TabBar` held five slots and pushed everything else behind a `More`
   * screen; DESIGN.md §0 retires the tab bar by name, teardown deleted the route,
   * and `AppShell` renders `nav-tree.ts` instead.
   *
   * What the test checks is unchanged: Marketing is reachable from the panel's
   * navigation, and the hub it lands on offers its four destinations. Only the
   * surface and the selectors moved.
   */
  test("is reachable from the navigation, and offers four destinations", async ({
    page,
  }) => {
    await signIn(page, "fr");
    await page.goto("/fr/orders");

    await openNav(page);
    await page.getByRole("link", { name: "Marketing", exact: true }).click();
    await page.waitForURL(/\/fr\/marketing$/);

    for (const name of [/Campagnes/, /Segments/, /Modèles d’e-mail/, /Pixel et événements/]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
  });
});

test.describe("the composer", () => {
  test("walks the five steps and saves as it goes", async ({ page }) => {
    /*
     * The wizard's central claim: each forward move PATCHes, so the preview two
     * steps later is a render of what the **server** holds rather than of what
     * this browser thinks it sent. Asserted by editing the subject at step two
     * and finding it rendered — with its `{{shop_name}}` resolved — at step three.
     */
    await signIn(page, "fr");
    await openCampaigns(page, "fr");
    await openCampaign(page, DRAFT_NAME, "Ouvrir le composeur");

    // 1. audience
    await expect(page.getByText("Étape 1 sur 5")).toBeVisible();
    await expect(page.getByTestId("eligible")).toBeVisible();
    await page.getByTestId("continue").click();

    // 2. content
    await expect(page.getByText("Étape 2 sur 5")).toBeVisible();
    const subject = page.getByLabel("Objet");
    await subject.fill("{{shop_name}} — test du composeur, {{first_name}}");
    await page.getByTestId("continue").click();

    // 3. preview — the subject comes back rendered, from the server.
    await expect(page.getByText("Étape 3 sur 5")).toBeVisible();
    await expect(page.getByTestId("preview-body")).toBeVisible();
    await expect(page.getByText(/Algerian Commerce — test du composeur/)).toBeVisible();

    await page.getByTestId("continue").click();
    await expect(page.getByText("Étape 4 sur 5")).toBeVisible();
    await page.getByTestId("continue").click();
    await expect(page.getByText("Étape 5 sur 5")).toBeVisible();
  });

  test("names the tokens that will render empty", async ({ page }) => {
    /*
     * The reason the preview is a step of its own. `{{firstname}}` is not
     * `{{first_name}}` and renders as nothing — invisible in a preview that has a
     * name in it from another token — so the warning names the token rather than
     * leaving somebody to spot a missing word.
     */
    await signIn(page, "fr");
    await openCampaigns(page, "fr");
    await openCampaign(page, "Relance panier — brouillon", "Ouvrir le composeur");

    await page.getByTestId("continue").click();
    await page.getByTestId("continue").click();

    const warning = page.getByTestId("unknown-tokens");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("{{firstname}}");
    // And the render really is empty where it was, which is why it hides.
    await expect(page.getByTestId("preview-body")).toContainText("Bonjour ,");
  });

  test("reports a test send that the transport refused, without calling it an error", async ({
    page,
  }) => {
    /*
     * **A 200 that reports `sent: false`.** The request succeeded and the
     * transport did not, which are different facts — this shop's mail host is a
     * dead port on purpose — so the screen says "refused" and why, rather than
     * rendering a failure that looks like a broken button.
     */
    await signIn(page, "fr");
    await openCampaigns(page, "fr");
    await openCampaign(page, "Relance panier — brouillon", "Ouvrir le composeur");

    for (let step = 0; step < 3; step += 1) await page.getByTestId("continue").click();
    await expect(page.getByText("Étape 4 sur 5")).toBeVisible();

    await page.getByLabel("Adresse de test").fill("ops@example.test");
    await page.getByTestId("send-test").click();

    const result = page.getByTestId("test-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText("refusé");
  });

  test("leads the send step with what will not happen, and names the command", async ({ page }) => {
    /*
     * **The one place this screen could mislead an operator into telling a
     * customer their mail is on its way.** `send` is a 202: it freezes the
     * audience, writes a row per recipient and returns. The mail leaves when
     * somebody runs the drain.
     *
     * Asserted before the tap, because the sentence has to be readable while
     * deciding rather than only afterwards.
     */
    await signIn(page, "fr");
    await openCampaigns(page, "fr");
    await openCampaign(page, "Relance panier — brouillon", "Ouvrir le composeur");

    for (let step = 0; step < 4; step += 1) await page.getByTestId("continue").click();
    await expect(page.getByText("Étape 5 sur 5")).toBeVisible();

    await expect(page.getByText("Rien n’est envoyé depuis le panneau.")).toBeVisible();
    await expect(page.getByText("wp algerian-commerce send-campaigns").first()).toBeVisible();
    await expect(page.getByTestId("send")).toBeEnabled();
  });

  test("picks the ids audience by e-mail, and says the search cannot match a name", async ({
    page,
  }) => {
    /*
     * **The picker §15 recorded as unbuildable.** The note said `/customers` needs
     * `ac_manage_customers`, "so it would be empty for the one role whose job this
     * is" — but `canSendCampaigns()` is *both* capabilities, so that reader is 403
     * on `send` too. This session holds both, which is the whole point: the reader
     * who can finish a send can always read a customer.
     *
     * The two assertions a payload cannot make. **The rows are addresses** — 12 of
     * the 16 customers in this shop have no name at all, so a picker built
     * name-first draws blank rows for the common case. And **the search says it
     * reads the address**, because `?search=` matches `user_login`, `user_email`
     * and `display_name` and never the two name fields: typing "Benali" returns
     * nothing about the customer called Benali, silently, and this line is the
     * only thing standing between a shop and concluding the customer is not there.
     *
     * Nothing is saved: the audience `Select` moves the draft, and this test never
     * presses Continuer.
     */
    await signIn(page, "fr");
    await openCampaigns(page, "fr");
    await openCampaign(page, DRAFT_NAME, "Ouvrir le composeur");

    await chooseIdsAudience(page);

    const trigger = page.locator("#campaign-ids");
    await expect(trigger).toBeVisible();
    // A `<button>`, not the comma-separated `<input>` — the id moves with the
    // control so `ErrorSummary` can still link a 400 on `customer_ids` to it.
    await expect(trigger).toHaveRole("button");

    await trigger.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("l’adresse e-mail")).toBeVisible();

    // Real checkboxes, and every row identified by an address.
    const boxes = drawer.locator('input[type="checkbox"]');
    await expect(boxes.first()).toBeVisible();
    await expect(drawer.getByText(/@/).first()).toBeVisible();

    // Escape closes it and hands focus back to the control that opened it.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("a campaign that is no longer a draft", () => {
  test("renders as a record with its counts, not as a form", async ({ page }) => {
    /*
     * A sent campaign is evidence. The wizard does not appear, the counts are the
     * **stored columns** that survive the purge, and the recipient list's total
     * follows its filter — which it did not before
     * `feat/campaign-recipient-counts`.
     */
    await signIn(page, "fr");
    await openCampaigns(page, "fr");
    await openCampaign(page, "Rentrée — envoyée", "Ouvrir le registre");

    await expect(page.getByText("Étape 1 sur 5")).toHaveCount(0);
    await expect(page.getByTestId("sent-body")).toBeVisible();
    await expect(page.getByText(/registre de ce qui a été envoyé/)).toBeVisible();

    const count = page.getByTestId("recipients-count");
    await expect(count).toBeVisible();
    const all = (await count.textContent())!;

    // Filtering narrows the reported total, not just the rows.
    await selectSegment(page, "Échec");
    await expect(count).not.toHaveText(all);
    await expect(page.locator('[data-testid="recipients-count"]')).toContainText(/destinataire/);
  });

  test("shows no send progress and stops polling once a campaign is no longer sending", async ({
    page,
  }) => {
    /*
     * **The half of the poll this shop can prove.** §15 shipped the record screen
     * with nothing polling anywhere under `marketing/campaigns/`, so a campaign
     * stuck at "2 sent, 4 pending" was indistinguishable from one mid-flight. Both
     * queries now refetch every 30 s **while `status === "sending"`** — and stop
     * the moment it is not.
     *
     * This shop has no `sending` campaign — 318 and 319 are drafts, 320 and 325
     * cancelled, 322 sent — so the positive half is exercised against the harness
     * (`MOCK_SEND_PROGRESS=tick`) and what a live run can assert is the negative:
     * a terminal campaign carries no progress block and is **not re-read on an
     * interval**. That is the half with a cost attached. Reads are 600/min per
     * credential shared across every tab, and a record screen left open on a desk
     * all afternoon must not spend two of them a minute for ever.
     *
     * It costs one interval of real time, which is why the timeout is raised here
     * rather than in the config: there is no way to observe the absence of a 30 s
     * timer in less than 30 seconds.
     */
    test.setTimeout(120_000);

    await signIn(page, "fr");

    const campaignReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (/^\/api\/ac\/campaigns\/\d+$/.test(pathname)) campaignReads.push(pathname);
    });

    await openCampaigns(page, "fr");
    await openCampaign(page, "Rentrée — envoyée", "Ouvrir le registre");
    await expect(page.getByTestId("sent-body")).toBeVisible();

    // Not a state of this campaign, so not on screen.
    await expect(page.getByTestId("send-progress")).toHaveCount(0);

    const settled = campaignReads.length;
    await page.waitForTimeout(35_000);
    expect(campaignReads.length).toBe(settled);
  });
});

test.describe("segments", () => {
  test("shows a live count, and marks the one that matches nobody", async ({ page }) => {
    /*
     * The count is the screen: criteria on a row tell nobody whether a segment is
     * right, and "0 clients" is what somebody needs to see before a campaign
     * names it — that campaign's send is a 409.
     *
     * The zero here is honest: `wilaya_id` is read off the **shipment**, never
     * the address, so an unshipped order has no wilaya and cannot match.
     */
    await signIn(page, "fr");
    await page.goto("/fr/marketing/segments");
    await page.waitForSelector('[data-testid="segments-count"]');

    await expect(rows(page).filter({ hasText: "Clients avec commande" })).toHaveCount(1);
    await expect(rows(page).filter({ hasText: "8 clients" }).first()).toBeVisible();
    await expect(rows(page).filter({ hasText: "Aucun client" }).first()).toBeVisible();
  });
});

test.describe("the capability", () => {
  test.skip(!MARKETING_USER || !MARKETING_PASS, "Set AC_MARKETING_USER and AC_MARKETING_PASS.");

  test("lets a Marketing Manager draft and preview, and disables send with the reason", async ({
    page,
  }) => {
    /*
     * **The compound rule, with the fixture Part V said the two-tier collapse had
     * taken away.** `canSendCampaigns()` is `ac_manage_marketing` **and**
     * `ac_manage_customers`; measured today the retired `ac_marketing_manager` —
     * which `scripts/test.sh` already mints — is 200 on the campaign and the
     * preview and 403 on send, the recipient list and a segment's count.
     *
     * ADMIN_PANEL.md is explicit that the button is **disabled with the reason,
     * not hidden**: a hidden button makes a Marketing Manager think the feature
     * is broken.
     *
     * The positive control is in the same session and is the whole first half of
     * this test — they reach the composer and walk it.
     */
    await signIn(page, "fr", MARKETING_USER!, MARKETING_PASS!);
    await openCampaigns(page, "fr");
    await openCampaign(page, "Relance panier — brouillon", "Ouvrir le composeur");

    // The count is the second capability's, so it is withheld rather than zeroed.
    await expect(page.getByText(/demande la permission Clients/)).toBeVisible();
    await expect(page.getByTestId("eligible")).toHaveCount(0);

    for (let step = 0; step < 4; step += 1) await page.getByTestId("continue").click();

    await expect(page.getByTestId("send")).toBeDisabled();
    await expect(page.getByTestId("send-forbidden")).toContainText("permission Clients");
  });

  test("keeps the comma-separated ids field for a session that cannot read customers", async ({
    page,
  }) => {
    /*
     * **The other half of the gate, and the reason it is a gate rather than a
     * downgrade.** §3.3: a control that cannot act is not rendered. `/customers`
     * is a 403 for this session, so a picker here would be an empty drawer — and
     * this is the same session that is 403 on `send`, so nothing has been taken
     * away from anybody who could have finished the task.
     *
     * What must survive is the field that was already there, its value and its
     * explanation. This is the assertion that the capability reaches the
     * component as a *prop* rather than being re-derived from a failed request:
     * a picker that rendered and then emptied would pass every other check here.
     */
    await signIn(page, "fr", MARKETING_USER!, MARKETING_PASS!);
    await openCampaigns(page, "fr");
    await openCampaign(page, "Relance panier — brouillon", "Ouvrir le composeur");

    await chooseIdsAudience(page);

    const field = page.locator("#campaign-ids");
    await expect(field).toBeVisible();
    await expect(field).toHaveRole("textbox");
    await expect(page.getByTestId("chosen-customers")).toHaveCount(0);
    await expect(page.getByText(/Le sélecteur de clients demande la permission Clients/)).toBeVisible();
  });
});

test.describe("Arabic", () => {
  test("renders the composer right to left, with the rendered mail in its own direction", async ({
    page,
  }) => {
    /*
     * One locale check rather than a sweep. The interesting property is the same
     * one the notifications branch asserted from the other side: the **rendered
     * mail does not mirror**. It is `dir="auto"` because its direction is a
     * property of the campaign's own text, so a French body stays left-to-right
     * inside an Arabic page.
     */
    await signIn(page, "ar");
    await page.goto("/ar/marketing/campaigns");
    await page.waitForSelector('[data-testid="campaigns-count"]');

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await openCampaign(page, "Relance panier — brouillon", "فتح المُحرِّر");
    await expect(page.getByText("الخطوة 1 من 5")).toBeVisible();

    await page.getByTestId("continue").click();
    await page.getByTestId("continue").click();

    const body = page.getByTestId("preview-body");
    await expect(body).toBeVisible();
    await expect(body).toHaveAttribute("dir", "auto");
    await expect(body).toContainText("Bonjour");
  });
});
