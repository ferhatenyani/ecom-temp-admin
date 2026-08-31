import { test, expect, type Locator, type Page } from "@playwright/test";
import { choose } from "./listbox";

/**
 * Marketing: the composer, segments and templates — deliberately small.
 *
 * **Thirteen tests, one project** — nine of them before the gaps branch, and the
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
 *
 * ## What item 8 changed here: **four steps, and the render moved into step two**
 *
 * Twelve declarations before and **thirteen** after. Twelve of them assert the
 * same facts they always did and only moved; the thirteenth is new because the
 * fold created a fact that did not exist before — `sandbox=""` on a frame the
 * panel now injects a shopkeeper's HTML into. That attribute is the whole safety
 * property and it is one token away from not being one, so it is asserted in the
 * DOM as well as pinned offline in `tests/mail-preview.test.ts`.
 *
 * What moved, and where:
 *
 *   - **"Étape N sur 5" is "Étape N sur 4" everywhere**, and every `continue`
 *     loop lost one iteration. `COMPOSER_STEPS` is `audience → content → test →
 *     send`; `tests/campaign-schema.test.ts` pins the list itself, so these
 *     assertions are about the *sentence a person reads* rather than about the
 *     array.
 *   - **The preview is on the compose step and is a sandboxed `iframe`**, so
 *     three assertions that used to read `preview-body` now read through
 *     `frameLocator`. `preview-body` still exists and is still a `<pre>`: it is
 *     the mail's **text** part, behind the "Texte" chip, which is the other half
 *     of a multipart message rather than a fallback view of the first.
 *   - **The subject-is-rendered-by-the-server claim needed a new mechanism.** It
 *     used to be proved by walking from content to preview, because the walk
 *     saved. Nothing walks now, so the claim is proved where it is stronger: the
 *     subject is edited, the preview goes visibly stale, `refresh-preview`
 *     saves, and the resolved subject comes back — all on one step, which is
 *     also the only place the *staleness* behaviour can be asserted at all.
 *
 * **Unexecuted, and that is not a formality.** The suite needs a live shop and a
 * staff Application Password; `BLOCKED.md` records the 401 that has stopped every
 * run of it on this machine. Everything below was written against the panel's
 * real markup and the mock's real payloads, and the browser facts it leans on —
 * that a `srcdoc` frame is reachable through `frameLocator`, that `page.frames()`
 * finds it, that the panel's `dir` does not cross into it — were measured in a
 * real Chromium against `scripts/mock-api.mjs`. What has not been measured is
 * this file running against the shop.
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
 * Its `onChange` moves the *draft* only — nothing is PATCHed until "Continuer" —
 * so a test can reach the control the picker lives on and leave the campaign
 * exactly as it found it. That property is why these three tests can run against
 * the shop's own drafts at all.
 *
 * **It is no longer "a real `<select>`", which is what this comment used to say
 * and what `selectOption` here depended on.** `Form.tsx`'s `Select` wraps
 * `Listbox`, the drawn control, so the option is a portalled `role="option"` and
 * not an `<option>`; `e2e/listbox.ts` argues the difference. The label on the
 * wire is still `ids`, but the label on screen is the translated one, which is
 * what a person clicks.
 */
async function chooseIdsAudience(page: Page) {
  await choose(page, page.getByLabel("Audience", { exact: true }), /Des clients choisis|عملاء محدَّدون/);
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
  test("walks the four steps and saves as it goes", async ({ page }) => {
    /*
     * The wizard's central claim, and item 8 moved where it is provable.
     *
     * It used to be proved by the *walk*: each forward move PATCHes, so the
     * preview two steps later rendered what the **server** held rather than what
     * this browser thought it sent. The preview is on the compose step now and
     * nothing walks to reach it — so the same claim is proved on one step and
     * proves two more things while it is there. The subject is edited, the card
     * says out loud that the frame is behind ("L'aperçu montre le dernier
     * enregistrement"), `refresh-preview` saves, and the subject comes back with
     * `{{shop_name}}` **resolved** — which only the server can do.
     *
     * The staleness half could not have been asserted at all before this branch:
     * the old preview step had no live form under it to disagree with.
     */
    await signIn(page, "fr");
    await openCampaigns(page, "fr");
    await openCampaign(page, DRAFT_NAME, "Ouvrir le composeur");

    // 1. audience
    await expect(page.getByText("Étape 1 sur 4")).toBeVisible();
    await expect(page.getByTestId("eligible")).toBeVisible();
    await page.getByTestId("continue").click();

    // 2. content — the form, the two bodies and the render, on one step.
    await expect(page.getByText("Étape 2 sur 4")).toBeVisible();
    await expect(page.getByTestId("preview-frame")).toBeVisible();
    await expect(page.getByTestId("preview-stale")).toHaveCount(0);

    const subject = page.getByLabel("Objet");
    await subject.fill("{{shop_name}} — test du composeur, {{first_name}}");

    // The frame is now a render of something else, and says so.
    await expect(page.getByTestId("preview-stale")).toBeVisible();
    await page.getByTestId("refresh-preview").click();

    // Saved, re-read, re-rendered — and the tokens came back resolved.
    await expect(page.getByTestId("preview-stale")).toHaveCount(0);
    await expect(page.getByText(/Algerian Commerce — test du composeur/)).toBeVisible();

    await page.getByTestId("continue").click();
    await expect(page.getByText("Étape 3 sur 4")).toBeVisible();
    await page.getByTestId("continue").click();
    await expect(page.getByText("Étape 4 sur 4")).toBeVisible();
  });

  test("names the tokens that will render empty", async ({ page }) => {
    /*
     * The one thing the retired preview step existed for, now one step earlier
     * and beside the body that caused it. `{{firstname}}` is not `{{first_name}}`
     * and renders as nothing — invisible in a message that has a name in it from
     * another token — so the warning names the token rather than leaving somebody
     * to spot a missing word.
     *
     * The second assertion reads **into the frame**, which is what the fold
     * changed: the HTML part is drawn now rather than quoted, so "Bonjour ," is a
     * rendered paragraph in a sandboxed document rather than text in a `<pre>`.
     * `frameLocator` reaches it — the frame has an opaque origin under
     * `sandbox=""` and Playwright addresses frames below the origin boundary
     * anyway.
     */
    await signIn(page, "fr");
    await openCampaigns(page, "fr");
    await openCampaign(page, "Relance panier — brouillon", "Ouvrir le composeur");

    await page.getByTestId("continue").click();
    await expect(page.getByText("Étape 2 sur 4")).toBeVisible();

    const warning = page.getByTestId("unknown-tokens");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("{{firstname}}");

    // And the render really is empty where the name was, which is why it hides.
    const mail = page.frameLocator('[data-testid="preview-frame"]');
    await expect(mail.locator("body")).toContainText("Bonjour ,");
  });

  test("renders the mail in a frame that grants nothing", async ({ page }) => {
    /*
     * **The attribute is the safety property**, and it is one edit away from not
     * being one — so it is asserted rather than trusted. `sandbox=""` is every
     * restriction on: no scripts, no forms, no popups, no top navigation, and an
     * **opaque origin**, which is what keeps a body that reached this screen away
     * from the panel's cookies and DOM. The HTML is sanitised on save
     * (`EmailHtml::sanitize()`); this is the belt under those braces.
     *
     * `tests/mail-preview.test.ts` pins the same constant offline. This one pins
     * that the constant reaches the DOM, which a unit test cannot see.
     *
     * The text part is still a `<pre>` behind the second chip, because it **is**
     * text — §85's rule is that it is authored rather than stripped from the HTML,
     * so it is the other half of a multipart message rather than a fallback view
     * of the first.
     */
    await signIn(page, "fr");
    await openCampaigns(page, "fr");
    await openCampaign(page, "Relance panier — brouillon", "Ouvrir le composeur");
    await page.getByTestId("continue").click();

    const frame = page.getByTestId("preview-frame");
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("sandbox", "");
    await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");

    // The caveat is read before the picture, not after it.
    await expect(page.getByText(/pas celui d’une messagerie/)).toBeVisible();

    // The other part, and it is the authored text rather than the HTML's source.
    // A `FilterTabs` chip is a real `<button>`, the same shape `selectSegment()`
    // clicks one screen over.
    await page.getByRole("button", { name: "Texte", exact: true }).click();
    await expect(page.getByTestId("preview-body")).toContainText("Votre panier vous attend.");
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

    for (let step = 0; step < 2; step += 1) await page.getByTestId("continue").click();
    await expect(page.getByText("Étape 3 sur 4")).toBeVisible();

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

    for (let step = 0; step < 3; step += 1) await page.getByTestId("continue").click();
    await expect(page.getByText("Étape 4 sur 4")).toBeVisible();

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

    await expect(page.getByText("Étape 1 sur 4")).toHaveCount(0);
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

    for (let step = 0; step < 3; step += 1) await page.getByTestId("continue").click();

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
     * One locale check rather than a sweep, and item 8 made its central property
     * sharper rather than changing it. The claim was always that the **rendered
     * mail does not mirror**: its direction is a property of the campaign's own
     * text, not of the panel, so a French body stays left-to-right inside an
     * Arabic page. It used to be asserted as `dir="auto"` on a `<pre>` — the
     * attribute, not the effect.
     *
     * Now it is asserted as the effect, because the mail is a **document** and a
     * document computes its own direction: the panel's `dir="rtl"` does not cross
     * into a frame at all, and the wrapper's `<html dir="auto">` resolves from the
     * message's first strong character. A French body therefore computes `ltr`
     * inside an `rtl` page, which is the whole claim in one number.
     *
     * `page.frames()` reaches it. The frame's origin is opaque under `sandbox=""`
     * — `contentDocument` is null from the page's own script — but Playwright
     * addresses frames below the origin boundary, which was measured in a real
     * Chromium against the mock before this was written.
     */
    await signIn(page, "ar");
    await page.goto("/ar/marketing/campaigns");
    await page.waitForSelector('[data-testid="campaigns-count"]');

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await openCampaign(page, "Relance panier — brouillon", "فتح المُحرِّر");
    await expect(page.getByText("الخطوة 1 من 4")).toBeVisible();

    await page.getByTestId("continue").click();
    await expect(page.getByText("الخطوة 2 من 4")).toBeVisible();

    const frame = page.getByTestId("preview-frame");
    await expect(frame).toBeVisible();
    await expect(page.frameLocator('[data-testid="preview-frame"]').locator("body")).toContainText(
      "Bonjour",
    );

    const mail = page.frames().find((one) => one !== page.mainFrame());
    expect(mail, "the srcdoc frame is not attached").toBeDefined();
    expect(await mail!.evaluate(() => document.documentElement.getAttribute("dir"))).toBe("auto");
    expect(
      await mail!.evaluate(() => getComputedStyle(document.documentElement).direction),
      "a French mail mirrored inside an Arabic panel",
    ).toBe("ltr");
  });
});
