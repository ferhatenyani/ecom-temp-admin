import { test, expect, type Page } from "@playwright/test";

/**
 * The notification queue — deliberately small.
 *
 * **Eight tests, one project.** Everything about this screen that a unit test can
 * answer is answered in `tests/notification-schema.test.ts`, which parses twelve
 * captured payloads and covers the state derivation, the retry's two branches,
 * the 409, the unreadable payload and both filters. What is left for a browser is
 * the handful of things a schema cannot see:
 *
 *   - the **capability refusal**, which is a fact about the session and the
 *     proxy rather than about a payload;
 *   - that `/notifications` now passes the **allowlist**, which was refusing it
 *     until this branch;
 *   - that a retry's **202 reaches the screen** as a sentence saying nothing was
 *     sent, rather than as a spinner that resolves into a checkmark;
 *   - that the customer tab's **one request** actually renders.
 *
 * There is no capture suite on this branch and no four-width sweep, by
 * instruction. Anything a screenshot would have proved is proved by a unit test
 * or is not proved.
 *
 * Every fixture here comes from `scripts/seed-notifications.mjs`, whose own floor
 * asserts it created the states — so a failure in this file is a failure of the
 * panel rather than of a queue that drifted.
 */

const USER = process.env.AC_STAFF_USER;
const PASS = process.env.AC_STAFF_PASS;
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
  await page.waitForURL(new RegExp(`/${locale}/(orders|products|coupons|dashboard)`));
}

/**
 * The segmented control's `<input type="radio">` is `sr-only`, so a pointer
 * reaches it through its `<label>` and Playwright must do the same — an
 * actionability check on a visually hidden input never passes. The customers,
 * inventory and content suites all document this.
 */
async function selectSegment(page: Page, label: string) {
  await page.locator("label", { hasText: new RegExp(`^${label}$`) }).click();
}

async function openQueue(page: Page, locale: string, query = "") {
  await page.goto(`/${locale}/notifications${query}`);
  await page.waitForSelector('[data-testid="notifications-count"]');
}

/** The first row whose badge reads as the given state. */
function rowWithState(page: Page, state: string) {
  return page.locator('a[href*="/notifications/"]').filter({ hasText: state }).first();
}

test.describe("the queue", () => {
  test("lists the states the queue could not reach before the seed", async ({ page }) => {
    /*
     * Measured 2026-08-21 before `seed-notifications.mjs`: 39 rows, **all
     * pending**, one channel, `sent_at` and `last_error` null on every one. So
     * this assertion is the seed's whole justification — without it the screen
     * can only ever show one badge and three of the four are dead code.
     */
    await signIn(page, "fr");
    await openQueue(page, "fr");

    for (const state of ["Transmise", "Échec", "Nouvel essai", "En file"]) {
      await expect(
        page.getByText(state, { exact: true }).first(),
        `no row badged "${state}"`,
      ).toBeVisible();
    }
  });

  test("filters by a channel that only exists because the seed wrote one", async ({ page }) => {
    /*
     * `?channel=` is honoured — and with one channel in the table it is a
     * control that cannot be wrong. The `sms` row is written underneath the API
     * (there is no `sms` channel to queue one) precisely so this proves
     * something.
     *
     * **Asserted on membership, not on counts**, and that is not fussiness. The
     * first version compared `email === all - 1`, which held at ten rows and
     * would have failed the moment the queue passed `per_page`: this table
     * accumulates rows from *other* repositories' suites — `tests/Api/campaigns.php`
     * queues transactional notifications of its own and drains them — so the
     * total is not the panel's to predict. Measured after one campaigns run, it
     * went 10 → 19.
     *
     * The sms row is still exactly one, because nothing can queue a second: the
     * registry holds one channel and it is not this one. So the floor is the
     * pair — SMS finds that row and only it, e-mail finds several and never it.
     * A filter that is accepted and ignored, which is what `?event=` and
     * `?audience=` do on this route, fails both halves.
     */
    const SMS_RECIPIENT = "+213661234567";

    await signIn(page, "fr");
    await openQueue(page, "fr");

    const rows = page.locator('a[href*="/notifications/"]');
    expect(await rows.count()).toBeGreaterThan(1);
    await expect(page.getByText(SMS_RECIPIENT)).toBeVisible();

    await selectSegment(page, "SMS");
    await page.waitForURL(/channel=sms/);
    await expect(rows).toHaveCount(1);
    await expect(page.getByText(SMS_RECIPIENT)).toBeVisible();

    await selectSegment(page, "E-mail");
    await page.waitForURL(/channel=email/);
    expect(await rows.count()).toBeGreaterThan(1);
    await expect(page.getByText(SMS_RECIPIENT)).toHaveCount(0);
  });
});

test.describe("the frozen message", () => {
  test("quotes the record verbatim, bilingual as it was queued", async ({ page }) => {
    /*
     * The body is a French salutation over an English sentence, straight out of
     * `NotificationMessages`. It renders **as it is** — translating it would show
     * the operator something the customer never received — so this asserts the
     * English survives inside the French UI, which is the case the quoting
     * treatment exists for.
     */
    await signIn(page, "fr");
    await openQueue(page, "fr");
    await rowWithState(page, "Transmise").click();

    const quote = page.getByTestId("message");
    await expect(quote).toBeVisible();
    await expect(quote).toContainText("Bonjour");
    await expect(quote).toContainText(/Algerian Commerce/);
    // And it is labelled as a record rather than left to read as panel copy.
    await expect(page.getByText(/figé à ce moment-là/)).toBeVisible();
  });

  test("says what the drain saw when the payload will not decode", async ({ page }) => {
    /*
     * `readable: false`, which no route can produce — `notify()` writes the
     * payload with `wp_json_encode()` — so the seed writes one underneath, the
     * `seed-cms.mjs` drop-report precedent. The screen must state the shape of
     * the problem rather than render an empty quote.
     */
    await signIn(page, "fr");
    await openQueue(page, "fr");
    await page.getByText("Colis livré", { exact: true }).first().click();

    await expect(page.getByText(/contenu enregistré est illisible/)).toBeVisible();
    await expect(page.getByTestId("message")).toHaveCount(0);
    await expect(page.getByTestId("last-error")).toContainText("not readable");
  });
});

test.describe("retry", () => {
  test("answers with a sentence saying nothing was sent, and names the command", async ({
    page,
  }) => {
    /*
     * **The one thing on this screen that could mislead an operator into telling
     * a customer their mail is on its way.** The retry is a 202: it clears
     * `status`, `attempts` and `last_error` so the next drain picks the row up,
     * and the mail leaves when something runs the command in `meta.drain`.
     *
     * So the confirmation is asserted on its *negative* — "Rien n’a été envoyé"
     * — and on the command being on screen. A spinner resolving into a checkmark
     * would pass a laxer test and be a lie.
     */
    await signIn(page, "fr");
    await openQueue(page, "fr");
    await rowWithState(page, "Échec").click();

    await page.getByTestId("retry").click();

    const result = page.getByTestId("retry-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText("Rien n’a été envoyé");
    await expect(result).toContainText("wp algerian-commerce send-notifications");

    // And the row it requeued now reads as queued rather than failed: attempts
    // back to zero, error cleared. The screen re-reads rather than rebinding to
    // the retry's response, which is a list row with no message on it.
    await expect(page.getByTestId("last-error")).toHaveCount(0);
    await expect(page.getByText("En file", { exact: true }).first()).toBeVisible();

    /*
     * And immediately again on the same row, which is now queued. **Both are 202
     * and both are successes** — the §90 zero-affected-rows fix is what makes
     * the second one not a 409, since MySQL reports rows it *changed* rather
     * than rows it matched, and this once shipped answering "already sent"
     * about a row that had never been sent.
     *
     * Asserted as a sequence on one row rather than as two tests on two rows,
     * because the interesting property is that the same gesture on the same
     * notification says two different true things depending on what it found.
     */
    await page.getByTestId("retry").click();
    await expect(page.getByTestId("retry-result")).toContainText("était déjà en file");
  });
});

test.describe("one customer's own queue", () => {
  test("renders on the customer detail, filtered to that person", async ({ page }) => {
    /*
     * The tab this branch bought a backend change for. `?recipient=` did not
     * exist when the branch started — accepted and silently ignored — so this
     * section cost one request per order per event name; `feat/notification-filters`
     * added it, and this is the one request.
     *
     * Karim Mansouri is customer 5 and the seed gives him rows across several
     * states on two real orders.
     */
    await signIn(page, "fr");
    await page.goto("/fr/customers/5");
    await selectSegment(page, "Notifications");

    const rows = page.locator('a[href*="/notifications/"]');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText(/Les messages adressés à ce client/)).toBeVisible();

    // Every row is this person's. The section filters on `recipient`, so the
    // shop's own alert about their order is correctly absent — which is what the
    // scope note exists to say.
    const count = await rows.count();
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i)).toContainText("karim.mansouri@example.test");
    }
  });
});

test.describe("the capability", () => {
  test.skip(
    !MARKETING_USER || !MARKETING_PASS,
    "Set AC_MARKETING_USER and AC_MARKETING_PASS.",
  );

  test("refuses a Marketing Manager, who still reaches what they do hold", async ({ page }) => {
    /*
     * **The forbidden fixture inverts from 14a, which is why this is its own
     * branch.** `/notifications` is `ac_manage_customers`, so a Manager is 200
     * here and 403 on every `/cms/` route — the content branch's credential
     * proves nothing. Measured across four roles: Super Admin, Manager and
     * Support Agent are 200; a Marketing Manager is 403 on all three
     * notification routes and on `/customers` besides.
     *
     * **The positive control is the point.** A refusal and an unreachable route
     * look identical from outside, and this route *was* unreachable until this
     * branch took it off the proxy's refused list. So the same credential is
     * asserted to reach `/coupons`, which a Marketing Manager holds — measured
     * 200 — in the same session.
     */
    await signIn(page, "fr", MARKETING_USER!, MARKETING_PASS!);

    await page.goto("/fr/notifications");
    await expect(page.getByText(/permission/i).first()).toBeVisible();
    await expect(page.getByTestId("notifications-count")).toHaveCount(0);

    // The control: the same session, a section this role does hold.
    await page.goto("/fr/coupons");
    await expect(page.getByTestId("coupons-count")).toBeVisible();
  });
});

test.describe("Arabic", () => {
  test("renders the queue right-to-left with the record still in its own direction", async ({
    page,
  }) => {
    /*
     * One locale check rather than a sweep. The interesting property is not that
     * the chrome mirrors — every screen in this panel does — but that the
     * **quoted message does not**: it is `dir="auto"` because its direction is a
     * property of the queued text rather than of the panel, so a French body
     * stays left-to-right inside an Arabic page. That is the analytics branch's
     * defect approached from the opposite side, where English prose leaked into
     * an Arabic sheet and was wrong; here it is right and must stay.
     */
    await signIn(page, "ar");
    await openQueue(page, "ar");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByText("سُلِّمت", { exact: true }).first().click();

    const quote = page.getByTestId("message");
    await expect(quote).toBeVisible();
    await expect(quote).toContainText("Bonjour");
    await expect(quote).toHaveAttribute("dir", "auto");
  });
});
