import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * The notification queue — deliberately small.
 *
 * **Eight tests, and every one of them runs five times.** The docblock said "one
 * project" for two branches and it was never true: `playwright.config.ts:57` sets
 * a global `testMatch` and defines five projects with no per-project filter, so
 * this file is executed by `phone`, `phone-min`, `phone-max`, `desktop` and
 * `phone-webkit` alike. That is not a footnote — four of the five are phone-sized,
 * which is the reason every row locator below had to change.
 *
 * Everything about this screen that a unit test can answer is answered in
 * `tests/notification-schema.test.ts`, which parses twelve captured payloads and
 * covers the state derivation, the retry's two branches, the 409, the unreadable
 * payload and both filters. What is left for a browser is the handful of things a
 * schema cannot see:
 *
 *   - the **capability refusal**, which is a fact about the session and the
 *     proxy rather than about a payload;
 *   - that `/notifications` now passes the **allowlist**, which was refusing it
 *     until this branch;
 *   - that a retry's **202 reaches the screen** as a sentence saying nothing was
 *     sent, rather than as a spinner that resolves into a checkmark;
 *   - that the customer tab's **one request** actually renders.
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
 * One queue row, in whichever presentation the running viewport paints.
 *
 * **This file had no `rows()` helper and every other list spec does**, which was
 * survivable while the screen drew one inset row at every width and is not now.
 * `DataTable` renders both presentations into the DOM and hides one per
 * breakpoint: the `<table>` — the only place the event's `<a href>` exists — is
 * `hidden md:block`, and below `md` a `RecordList` card navigates through a
 * stretched overlay button instead. So the old inline `a[href*="/notifications/"]`
 * doubles nothing but *is never painted* on four of the five projects, and its
 * `toHaveCount(1)` would have broken the moment both presentations shipped.
 *
 * `<tr>` and `<li class="ui-card">` rather than the link and the overlay button,
 * because a row is read as well as clicked — "the row is badged Échec" is an
 * assertion about the row's text, and the overlay button has none. Both
 * containers are clickable: `<tr>` carries `onRowClick`, and the card's overlay
 * covers it edge to edge.
 *
 * Coupons introduced this shape and campaigns adopted it; this is the third
 * caller.
 */
function rows(page: Page): Locator {
  return page.locator("tbody tr, li.ui-card").filter({ visible: true });
}

/**
 * Pick one of the status tabs.
 *
 * **The helper kept its name and lost its body.** It was written for
 * `Segmented`'s `sr-only` radio, which a pointer can only reach through its
 * `<label>`; `FilterTabs` draws a real `<button>`, so the label locator matched
 * nothing at all. The campaigns and content branches made exactly this change for
 * exactly this reason.
 */
async function selectSegment(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function openQueue(page: Page, locale: string, query = "") {
  await page.goto(`/${locale}/notifications${query}`);
  await page.waitForSelector('[data-testid="notifications-count"]');
}

/** The first row whose badge reads as the given state. */
function rowWithState(page: Page, state: string) {
  return rows(page).filter({ hasText: state }).first();
}

test.describe("the queue", () => {
  test("lists the states the queue could not reach before the seed", async ({ page }) => {
    /*
     * Measured 2026-08-21 before `seed-notifications.mjs`: 39 rows, **all
     * pending**, one channel, `sent_at` and `last_error` null on every one. So
     * this assertion is the seed's whole justification — without it the screen
     * can only ever show one badge and three of the four are dead code.
     *
     * `.filter({ visible: true })` is the redesign's only change here, and it is
     * the same fact `rows()` exists for: the badge is drawn twice, once in the
     * table and once on the record card, and `.first()` would otherwise resolve to
     * whichever of the two this project does not paint.
     */
    await signIn(page, "fr");
    await openQueue(page, "fr");

    for (const state of ["Transmise", "Échec", "Nouvel essai", "En file"]) {
      await expect(
        page.getByText(state, { exact: true }).filter({ visible: true }).first(),
        `no row badged "${state}"`,
      ).toBeVisible();
    }
  });

  test("narrows the list with a filter the API honours rather than ignores", async ({ page }) => {
    /*
     * **This is the one test on the branch whose title changed, and the change is
     * the honest half of the rule rather than an exception to it.** It read
     * "filters by a channel that only exists because the seed wrote one". The
     * channel control came off on the redesign branch — the parameter *is*
     * honoured (`email` 25, `sms` 0), and the
     * standing rule is that a picker over a working filter ships only when the
     * allowlisted enumeration is complete. There is no allowlisted enumeration of
     * channels anywhere in this API, `KNOWN_CHANNELS` is a panel-side copy of a
     * server constant one `add()` from being stale, and `?channel=nonsense` is a
     * silent 200 — so a picker is the only thing that could keep a typo
     * unreachable and it cannot. `notifications/query.ts` carries the argument.
     *
     * **What this test checks has not been weakened, which is why the title could
     * move without coverage moving with it.** It was never about the channel: it
     * is the one browser-side proof that a filter control on this screen genuinely
     * narrows the list, as opposed to being accepted and silently ignored the way
     * `?event=` and `?audience=` are. Its own comment said so —
     * *"asserted on membership, not on counts"*, because the total is not the
     * panel's to predict (this table accumulates rows from other repositories'
     * suites; measured after one campaigns run it went 10 → 19).
     *
     * So the pair is the same and the dimension is the one the screen still
     * offers: **sent finds rows and never a failed one, failed finds rows and
     * never a sent one.** A filter that is accepted and ignored fails both halves,
     * which is the whole floor. Counts are asserted as "more than none" rather
     * than as a number, for the reason above.
     */
    const SENT = "Transmise";
    const FAILED = "Échec";

    await signIn(page, "fr");
    await openQueue(page, "fr");

    const queue = rows(page);
    expect(await queue.count()).toBeGreaterThan(1);
    await expect(queue.filter({ hasText: SENT }).first()).toBeVisible();

    await selectSegment(page, "Envoyées");
    await page.waitForURL(/status=sent/);
    expect(await queue.count()).toBeGreaterThan(0);
    await expect(queue.filter({ hasText: FAILED })).toHaveCount(0);

    await selectSegment(page, "Échouées");
    await page.waitForURL(/status=failed/);
    expect(await queue.count()).toBeGreaterThan(0);
    await expect(queue.filter({ hasText: SENT })).toHaveCount(0);
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
     *
     * The row is opened through `rows()` rather than by clicking the event label
     * directly: below `md` that label sits under `RecordList`'s stretched overlay
     * button, which intercepts the pointer, and at `md`+ it is inside an anchor
     * that is only painted there.
     */
    await signIn(page, "fr");
    await openQueue(page, "fr");
    await rows(page).filter({ hasText: "Colis livré" }).first().click();

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
     *
     * The control is the `PageHeader` primary now rather than a button inside a
     * card, and the outcome is a `Notice` in the body rather than a tinted panel
     * inside the same card. Both still answer to their own testids, which is the
     * whole reason those testids exist.
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
     *
     * **There is no tab to select any more, and that is not this branch's doing.**
     * The customers redesign put the orders and the notifications in stacked cards
     * and retired `Segmented` outright — its own docblock argues it: a tab you open
     * to find nothing in it is the worst version of that trade, and this section is
     * empty for 11 of the 16 customers. So `selectSegment(page, "Notifications")`
     * has been clicking a `<label>` that does not exist since that branch merged.
     * The section is on screen from the navigation; the assertions below are
     * untouched.
     *
     * The anchors here are the customer card's own `<Link>` per row, not
     * `DataTable`'s — that section is a plain list, so it draws one presentation
     * and `rows()` does not apply to it.
     */
    await signIn(page, "fr");
    await page.goto("/fr/customers/5");

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
     *
     * `notifications-count` is what distinguishes the refusal from the screen: the
     * refused page keeps its `PageHeader` so the box lands where the person asked
     * for it, and the subtitle carrying that testid is rendered only past the gate.
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
    await rowWithState(page, "سُلِّمت").click();

    const quote = page.getByTestId("message");
    await expect(quote).toBeVisible();
    await expect(quote).toContainText("Bonjour");
    await expect(quote).toHaveAttribute("dir", "auto");
  });
});
