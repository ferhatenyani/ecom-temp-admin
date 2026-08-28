/**
 * The rendering harness: a real browser, a real Next server, a fake shop.
 *
 *   node scripts/capture.mjs /orders /products
 *   node scripts/capture.mjs --all
 *   npm run test:harness -- /orders
 *   MOCK_IDENTITY=reduced node scripts/capture.mjs /orders/1023
 *
 * **The last line is how a forbidden state gets captured.** The mock's default
 * identity holds all thirteen capabilities, which is what a harness whose job is
 * to render screens needs and is also why no screen could be captured in the
 * forbidden state DESIGN.md §3.7 requires of every one of them. `MOCK_IDENTITY`
 * is read by `scripts/mock-api.mjs` at module load — so it is a whole run, not a
 * per-capture switch — and `reduced` drops `ac_manage_shipping` and
 * `ac_manage_payments`, which is what makes the order detail's parcels and
 * payments sections absent rather than empty. Its screenshots land beside the
 * default run's with an `-reduced` suffix, so capture one run then the other and
 * compare the pair in the same folder.
 *
 * **`support` is the third and it drops a different two** — `ac_manage_orders`
 * and `ac_manage_inventory` — which is the measured credential the dashboard's
 * money gate refuses. `reduced` cannot stand in for it: it keeps
 * `ac_manage_orders`, deliberately, because that is what keeps `/orders/1023`
 * a screen rather than a refusal.
 *
 * **`no_content` is the fourth and it drops exactly one** — `ac_manage_content`,
 * which every route under `/cms/` and `/media` is gated on and which all three of
 * the identities above hold. So it is the only way to photograph the Content
 * section refused, and the whole section refuses at once:
 *
 *     MOCK_IDENTITY=no_content node scripts/capture.mjs --all
 *
 * **A second harness switch arrived with it, and it is not an identity.**
 * `MOCK_HOMEPAGE` chooses which stored homepage document the mock serves,
 * because the three states that screen has are properties of the *document*
 * rather than of the reader or the URL — `/content/homepage` takes no parameters
 * and the panel's server component forwards none:
 *
 *     node scripts/capture.mjs /content/homepage                  the drop report
 *     MOCK_HOMEPAGE=empty node scripts/capture.mjs /content/homepage    empty
 *     MOCK_HOMEPAGE=future node scripts/capture.mjs /content/homepage   a type
 *         this build has no name for — `unknownSectionTypes()`'s only fixture,
 *         and a hypothesis rather than a measurement. The mock's own block says
 *         so at length; it is behind a switch precisely so nobody reads it as one
 *
 * It is read at module load like `MOCK_IDENTITY`, so it is a whole run rather
 * than a per-capture switch. Unlike the identity it writes **no suffix** on the
 * filenames — the three homepage documents are three states of one screen, not
 * one screen under three credentials — so capture them one at a time and move
 * the output if you want to hold them side by side.
 *
 * **`MOCK_MEDIA` is the third and it works exactly the same way.**
 *
 *     MOCK_MEDIA=empty node scripts/capture.mjs /media    41 attachments → none
 *
 * The media library takes no parameters at all — no search, no filter, no sort —
 * so an empty collection is a property of the *shop* rather than of the URL, and
 * there is no request that reaches it. It empties `MediaPicker` inside the banner
 * sheet too, which is the only way to photograph a picker with nothing to pick.
 *
 * **`MOCK_SEND_PROGRESS` is the fourth, and it is the first one with a form this
 * script must never be run under.**
 *
 *     node scripts/capture.mjs /marketing/campaigns/321       2 of 6 — the resting seed
 *     MOCK_SEND_PROGRESS=1 node scripts/capture.mjs …         3 sent, 3 queued
 *     MOCK_SEND_PROGRESS=2 node scripts/capture.mjs …         3 sent, 1 **failed**, 2 queued
 *     MOCK_SEND_PROGRESS=3 node scripts/capture.mjs …         4 sent, 1 failed, 1 queued
 *     MOCK_SEND_PROGRESS=4 node scripts/capture.mjs …         the drain finishes: `sent`
 *
 * Campaign 321 is the fixture's only `sending` row and its counts were static, so
 * a screen showing progress had exactly one state to be photographed in. **A
 * number is a seed offset** — applied once when the mock builds its baseline and
 * then frozen — so each line above is as byte-stable as the default, and two runs
 * at the same number produce identical PNGs. `2` is the interesting one: a
 * `failed` recipient *during* a send exists nowhere else, since the only other
 * failures in the fixture sit on a campaign that has already finished.
 *
 * **`MOCK_SEND_PROGRESS=tick` is the form to keep away from here.** It advances
 * the drain by one recipient on every read of the campaign, which is what lets an
 * e2e test watch a poll move — and which makes every capture under it differ from
 * the last. It is for `e2e/`, not for this script. Like the three switches above
 * it is read at module load and writes no filename suffix, so capture one number
 * at a time and move the output to hold two side by side.
 *
 * **Why this exists.** The e2e suite needs live shop credentials nobody has in
 * this environment, and a passing `next build` is not evidence that anything
 * renders — it once passed with a completely broken stylesheet, off a stale
 * `.next`. A build checks that the code compiles. This checks that a screen
 * appears, in two locales, two themes and three widths, without a single console
 * error and without pushing the document past its own viewport.
 *
 * It owns the whole lifecycle: it mints a session cookie the way the panel
 * would, starts `scripts/mock-api.mjs`, starts the built Next server pointed at
 * it, drives Chromium through every combination, and tears all of it down on
 * success, on failure and on Ctrl-C.
 *
 * **The last assertion is the one that makes the rest mean anything.** After
 * every capture it asks the mock how many requests it served. Zero means the
 * panel was talking to something else — most likely the real `AC_API_BASE` out
 * of `.env.local` — and every screenshot above it is a screenshot of an error
 * state that happened to have an `h1`. That is a failure, loudly, with that
 * explanation.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EncryptJWT } from "jose";
import { chromium } from "playwright";
import { BASE_PATH, startServer } from "./mock-api.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 3099 rather than 3001, so a running dev server is never in the way. */
const HARNESS_PORT = Number(process.env.HARNESS_PORT ?? 3099);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8099);
const PANEL = `http://127.0.0.1:${HARNESS_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

const OUT = resolve(ROOT, ".impeccable/harness");

/**
 * A reduced-identity run writes **beside** the default one rather than over it:
 * same route directory, an `-<identity>` suffix on the file. The whole point of
 * capturing a forbidden state is to hold it against the permitted one, and a run
 * that overwrote the first would leave nothing to compare.
 *
 * A suffix rather than a directory of its own, because `.gitignore` covers
 * `.impeccable/harness/` and a sibling directory would arrive untracked.
 */
const IDENTITY = process.env.MOCK_IDENTITY ?? "full";
const SUFFIX = IDENTITY === "full" ? "" : `-${IDENTITY}`;

/**
 * 340 is below the narrowest phone Apple ships and is deliberately the floor:
 * the widths that break are the ones nobody designs at. 768 is the tablet
 * breakpoint and 1440 is where the sidebar is persistent.
 */
const WIDTHS = [340, 768, 1440];
const THEMES = ["light", "dark"];
const LOCALES = ["fr", "ar"];

/**
 * What `--all` means: the screens the mock's endpoints can actually serve.
 *
 * `/orders/1023` is the one detail here, and the id is not arbitrary. It is the
 * richest order in the fixture shop — three line items all carrying the
 * 60-character SKU, a customer whose name is Arabic with a Latin order number
 * inside it, a customer note, three order notes, a seven-entry timeline, a
 * confirmed COD record, a finished parcel from a provider `/shipping/providers`
 * does not list, and two payments in two states. Every section of the detail has
 * something in it, which is what makes one capture worth taking.
 *
 * `/products/104` is the second, on the same rule: it is the variable product, so
 * its variations section has three rows in it — one whose SKU is inherited and
 * blank, one that manages no stock of its own, and a price range across the three
 * — where 37 of the 39 products would render that section as nothing at all.
 *
 * `/customers/24` is the third, and **the customer detail had never been captured
 * at any width** — the screen with the most sections in the panel and no
 * screenshot of any of them. 24 is the richest customer for the same reason 1023
 * is the richest order: it is the only one where every section has something in
 * it. Seven orders across **six of the seven statuses**, so the zero-dropped
 * breakdown is six rows rather than the two every other customer can manage;
 * `cancelled_orders` and `returned_orders` are both non-zero; two of the seven are
 * completed, so `total_revenue ÷ total_orders` is visibly not the stated average
 * and the card's scope footnote is doing real work; and it is the one customer
 * whose consent was **withdrawn** — a `false` with a date on it, which is a
 * different answer from the fourteen who were never asked and was the state no
 * fixture could reach at all. It has no name — 12 of the 17 customers do not — so
 * the header renders the username fallback rather than the one path a named row
 * would take.
 *
 * **Two things about this route are worth knowing before reading its output.**
 *
 * The other two consent states are on other rows: 20 is granted from
 * `registration` and 22 is granted from `seed`, a source the panel has no label
 * for and renders as itself. Those are states rather than screens, so capture
 * them by name when the card changes:
 *
 *     node scripts/capture.mjs /customers/20 /customers/22
 *
 * And **this captures the profile tab only.** The orders list and the customer's
 * notification queue are the detail's other two tabs, both client-fetched on
 * selection, and this harness never interacts with the page — so neither
 * `/customers/{id}/orders` nor `/notifications` is requested by a capture run of
 * this route, whatever the mock serves. `tests/mock-api.test.ts` is what holds
 * those two, and a screenshot of either would need a harness that can click.
 *
 * **`/products/208` is deliberately not here, and it is the one worth knowing
 * about.** It is the only product carrying a broken option set, so it is the only
 * route that renders the `options_problems` warning — a state, not a screen, and
 * one capture per screen is what this list is for. Capture it by name:
 *
 *     node scripts/capture.mjs /products/208
 *
 * `/coupons/303` is the coupon detail, chosen on the same rule as 1023 and 104:
 * it is the richest of the six rather than the tidiest. A draft, so the status
 * badge is not the neutral one every other row carries; two product restrictions
 * and a category, so all four restriction sections have something to resolve; an
 * expiry, which is the field whose read shape a date input cannot display; a
 * `limit_usage_to_x_items`, which nothing else sets; and an 80-character unbroken
 * email in `email_restrictions`, which is what the 340px overflow assertion has to
 * catch on this screen.
 *
 * `/coupons/new` is the same form against an empty coupon and is a **different
 * screen**, not a state of this one: no code, no id, a create button where the
 * delete controls are, and every field at its default. It is the one route in the
 * panel that renders a form with nothing behind it.
 *
 * **`/coupons/305` is deliberately not here, and it is this collection's `208`.**
 * It is the only coupon carrying restriction ids that resolve to nothing — one
 * product and one category — so it is the only route that renders the stale
 * restriction warning, and until it existed that banner had never been captured
 * at all. It is also the only coupon with a non-zero `usage_count`, so the *used*
 * rendering of the allowance is on the same screen. A state, not a screen:
 *
 *     node scripts/capture.mjs /coupons/305
 *
 * `/coupons/306` is the trashed one — its banner and its permanent-delete path —
 * and it is reachable by id and by no listing, which is the point of it:
 *
 *     node scripts/capture.mjs /coupons/306
 */
const DEFAULT_ROUTES = [
  /*
   * **The panel's landing screen, and it had never been captured at any width,
   * theme or locale.** Not an oversight in this list: `/analytics/overview` was
   * a `rest_no_route` until 2026-08-26, so every capture of `/dashboard` would
   * have been a photograph of its error state. The mock serves it now, which is
   * what makes the route worth listing rather than worth naming.
   *
   * **The money gate is the point of this screen and it needs the second run.**
   * `canSeeMoney()` is `ac_view_analytics` *and* `ac_manage_orders`, and the API
   * enforces it in the payload rather than in the status: a reader without the
   * second gets a 200 whose `revenue` block is simply **absent** — not null, not
   * zeroed — and `meta.money_visible: false` beside it. `dashboardCards()` then
   * returns a different card set of the same length, so the half-payload state
   * is a screen with different figures and no holes, which is exactly the thing
   * a screenshot can check and a unit test cannot:
   *
   *     MOCK_IDENTITY=support node scripts/capture.mjs /dashboard
   *
   * **`support`, not `reduced`.** `reduced` keeps `ac_manage_orders` on purpose
   * — that is what lets `/orders/1023` render with two sections missing instead
   * of as a whole page refused — so it sees the money and cannot reach this
   * state. `support` is the measured Support Agent credential: no
   * `ac_manage_orders`, no `ac_manage_inventory`, and a 200 on `/customers`.
   *
   * The range control is a toolbar on this route rather than a route of its own,
   * so the four other presets are states and not screens. `?range=today` is the
   * empty one — every figure zero — and is worth capturing by name when the
   * cards change, because a zero shop is the layout nobody designs at:
   *
   *     node scripts/capture.mjs "/dashboard?range=today"
   */
  "/dashboard",
  "/orders",
  "/orders/1023",
  "/products",
  "/products/104",
  "/customers",
  "/customers/24",
  "/inventory",
  /* 201 tracks its own stock and refuses backorders, so it is the row whose
     adjust form can reach both refusals. 103 manages no stock at all and 9032
     inherits its parent's — the two states `displayQuantity()` and
     `adjustTarget()` exist for — and both are worth capturing by name rather
     than by default:

         node scripts/capture.mjs /inventory/103 /inventory/9032          */
  "/inventory/201",
  "/coupons",
  "/coupons/303",
  "/coupons/new",
  /*
   * **Shipping is two routes**, the arrangement inventory already uses for its
   * ledger. `/shipping` is the parcels table and `/shipping/rules` is the tariff
   * beside its resolver: different data, different filters, its own paging and
   * its own writes. Both are captured, because each is half the section and the
   * parcels half carries the 340px overflow risk (a courier's tracking number is
   * the unbroken string on this screen) while the rules half is the only
   * two-column layout in the section.
   *
   * **The `?view=` parameter is gone.** This block used to say "there is no
   * `/shipping/rules` route", and it was true — the panel held one `page.tsx`
   * and a `Segmented` control switching between two views inside it. The
   * redesign split them, so the route exists and `?view=rules` now **redirects**
   * to it. Capturing `/shipping?view=parcels` would photograph a redirect target
   * rather than a screen; capturing `/shipping/rules` photographs the screen.
   *
   * The parcel drawer's own states — the status picker, the cancel confirm and
   * the terminal note — are overlays on this route rather than routes, so they
   * are not capturable here. 7014 is the only live parcel in the fixture and is
   * the only row that offers the first two.
   */
  "/shipping",
  "/shipping/rules",
  /*
   * **The panel's only screen with two capabilities and two readerships on it**,
   * which is the whole reason it is captured rather than left to the order
   * detail's payments section.
   *
   * `/payments` is `ac_manage_payments` — the Super Admin tier alone after the
   * two-tier collapse — while the COD funnel below it reads `/cod/statistics`,
   * which is `ac_view_analytics` and every staff account holds. So one page has a
   * section a Manager is 403 on sitting directly above a section they are
   * entitled to, and neither state can be photographed anywhere else in the
   * panel. The mock enforces exactly that split, so the second identity captures
   * the half-refused page rather than a blank one:
   *
   *     MOCK_IDENTITY=reduced node scripts/capture.mjs /payments
   *
   * The transactions list is the fixture's discriminating half: 45 rows over
   * three pages at the default `per_page`, so `TableFooter` renders "1 / 3" and
   * the Arabic capture can actually catch a reordered page indicator — "1 / 1" is
   * symmetric and proves nothing, which is the lesson shipping paid for. The
   * shop's single `failed` transaction sits second in the resting order, so the
   * badge's other state is on page one rather than buried on page three.
   *
   * There is no `/payments/{id}` route to capture. `GET /payments/{id}` returns
   * the list row exactly, so a peek drawer would be free here, but a drawer is an
   * overlay on this route rather than a route of its own.
   */
  "/payments",
  /*
   * **The six reports, and this route has never been photographed at any width,
   * theme or locale.** Not an oversight in this list: all six of
   * `/analytics/{revenue,orders,products,customers,shipping,cod}` answered
   * `rest_no_route` until 2026-08-26, so a capture of `/analytics` would have
   * been a photograph of `ErrorState`. The mock serves them now.
   *
   * The bare path is the **revenue** report over the default 30-day window —
   * `DEFAULT_VIEW` in `query.ts`, and the reason a shared link to it is
   * `/analytics` rather than `/analytics?view=revenue&range=30d`.
   *
   * **It is captured under both identities, and the second is the point of it.**
   *
   *     node scripts/capture.mjs /analytics
   *     MOCK_IDENTITY=support node scripts/capture.mjs /analytics
   *
   * The money gate takes a shape here it takes nowhere else in the panel. On
   * `/dashboard` it is a *payload* refusal — a 200 with `revenue` absent, so the
   * screen renders a different card set of the same length. On this route the
   * default view is the one report the API refuses outright: a Support Agent gets
   * a flat **403**, `AnalyticsScreen` renders `ForbiddenState` naming the
   * capability the *response* asked for (`meta.money_requires`, falling back to
   * `canSeeMoney()`'s own when a 403 carries no meta) — **and the toolbar stays
   * live above it.** The report pills and the range control are outside the
   * refused region, so the reader can still move to the five reports they are
   * entitled to. That is a **view state, not a page refusal**, and the difference
   * between the two is exactly the thing a screenshot can check and a unit test
   * cannot: a `ForbiddenState` that had swallowed the whole `Scaffold` would look
   * correct in every assertion and be a dead end on screen.
   *
   * `support`, not `reduced`, for the reason `/dashboard`'s block gives: `reduced`
   * keeps `ac_manage_orders` on purpose and sees the money.
   *
   * The other five reports and the five other windows are **states of this route
   * rather than routes**, so they are captured by name when they change. The
   * three worth knowing about:
   *
   *     node scripts/capture.mjs "/analytics?view=shipping"   the geography,
   *         where the unattributed slice outweighs every named wilaya combined
   *     node scripts/capture.mjs "/analytics?view=products&range=today"
   *         `best_sellers: []` under a `low_stock` that is still 3 — the figure
   *         that does not move under a control that does
   *     node scripts/capture.mjs \
   *         "/analytics?view=products&range=custom&date_from=2026-08-10&date_to=2026-08-11"
   *         every row tied at one unit, which is the flat `hasRankingSignal()`
   *         branch: a plain list of counts where the ranked window draws bars
   */
  "/analytics",
  /*
   * ── Content: seven screens, and none of them had ever been photographed ─────
   *
   * Not an oversight in this list. `/cms/*` and `/media` were **completely
   * unmocked** until this branch — `tests/mock-api.test.ts` declared both
   * `UNCOVERED` — so a capture of any Content route would have been a photograph
   * of its error state with an `h1` on top, which is exactly the failure the
   * request-count assertion at the end of this file exists to catch and exactly
   * the failure it *cannot* catch, because the panel really does talk to the mock
   * and the mock really does answer 404.
   *
   * The hub is listed rather than the section's landing screen by convention: it
   * is the one screen that reads **four collections at once** — pages, banners,
   * FAQs and media, each with `?per_page=1&status=any` for the count alone — so
   * it is where an envelope that stopped carrying `meta.total` would show up
   * first, as four missing numbers rather than as an error.
   */
  "/content",
  /*
   * The index, and the fixture is built so the default view is the interesting
   * one: 62 listed pages under `?status=any`, which is what the screen sends, so
   * the pager runs rather than rendering two disabled buttons and a "1 / 1". It
   * had never run against this harness at all — the seed used to be under
   * `PER_PAGE = 50`.
   *
   * **Three states of this route are reachable only by naming a URL**, and each
   * is a state rather than a screen:
   *
   *     node scripts/capture.mjs "/content/pages?page=2"
   *         the second page — twelve rows, a live "previous" and a dead "next",
   *         which is the half of the pager the first page cannot show
   *     node scripts/capture.mjs "/content/pages?status=draft"
   *         ten rows, and **both `ac-unpublished` rows are on it** — the two
   *         pages sharing one path, which is the only place `collidingPaths()`
   *         has anything to mark and the only place the index renders a row it
   *         refuses to link. The 62-character path on `programme-de-fidelite-…`
   *         is on this view too, which is what the 340px assertion bites on
   *     node scripts/capture.mjs "/content/pages?search=zzz"
   *         the filtered empty state, which is a different screen from the
   *         unfiltered one: it offers "clear the filters" and says what
   *         `?search=` matches, and the unfiltered one cannot be reached at all
   *         while the shop has 62 pages in it
   */
  "/content/pages",
  /*
   * The page form. `legal/conditions-generales` rather than a root page, and the
   * path is the point: it is **two segments**, so it exercises the catch-all
   * route and the greedy `/cms/pages/.+` allowlist rule that makes it reachable.
   * It is also the one page in the fixture with a real `seo.overrides` entry, so
   * the SEO block renders its *overridden* branch — every other page shows the
   * derived placeholders and would leave that path unphotographed.
   *
   * **The two delete refusals are overlays on this route rather than routes**, so
   * they are not capturable here, and the fixture puts each on its own page so
   * that a person driving the panel by hand can reach both:
   *
   *     /content/pages/legal            409 `children` — two child pages, and
   *                                     `?force=true` reparents them
   *     /content/pages/privacy-policy   409 `option` — and **force does not
   *                                     override it**, which is the asymmetry
   *                                     `PageForm` renders two different banners
   *                                     for
   *
   * `privacy-policy` is worth capturing by name for a second reason: it is a
   * **draft**, and it is the measurement the whole Pages index exists for — the
   * page that answered "No page at that path." about itself.
   */
  "/content/pages/legal/conditions-generales",
  /*
   * The same form against an empty page, and a **different screen** rather than a
   * state of the one above — the precedent `/coupons/new` set. No path, no id, a
   * create button where the delete section is, and the rename warning that cannot
   * fire because there is nothing to rename.
   */
  "/content/pages/new",
  /*
   * The homepage editor, and the default document is the **drop report**: twelve
   * stored sections of which three are malformed, so nine survive on screen and
   * `meta.problems` carries three sentences whose positions are 1-based over the
   * *stored* document. They are interleaved at 2, 4 and 6, so "Section 6" is the
   * fourth thing on screen — an off-by-one anywhere in that chain is visible in
   * the capture rather than plausibly correct.
   *
   * The other two documents are `MOCK_HOMEPAGE`'s, and the header at the top of
   * this file says which is which. The empty one matters most: it is what this
   * shop actually answered before `scripts/seed-cms.mjs` existed, and it is the
   * screen's empty state.
   */
  "/content/homepage",
  /*
   * Banners, grouped by placement and ordered by a dense `position` inside each
   * group — five rows over three placements, so every group has something in it
   * and one has a single row, which is where a "move up"/"move down" pair has to
   * render both controls disabled.
   *
   * The 340px risk on this screen is the **texturized title**: `Soldes d’été`
   * comes back with its apostrophe as character reference 8217, so a capture is
   * also the check that `decodeEntities` ran — the six literal characters of the
   * entity are visible in a screenshot in a way they are not in an assertion.
   */
  "/content/banners",
  /*
   * FAQs, plus the category manager inside them. Five FAQs over four categories,
   * one FAQ in **two** categories and one in none, and a category with a count of
   * zero — which is the row whose delete is safe, against the three that answer a
   * 409 naming how many FAQs would be detached.
   *
   * The overflow fixture here is Arabic: a 110-character question rendered
   * `dir="auto"`, so the 340px capture is the one place an overflow and a
   * direction flip can compound and be seen doing it.
   */
  "/content/faqs",
  /*
   * The category manager, which is a **route** rather than the sheet the
   * pre-redesign screen kept it in — so it is a screen of its own and gets its
   * own capture.
   *
   * The fixture is built for the one decision this screen makes: three of the
   * four categories have FAQs in them and one does not, so the row whose delete
   * is safe sits beside three whose delete answers a 409 naming how many FAQs
   * `?force=true` would detach. A manager where every row behaved the same way
   * would photograph the same button four times.
   */
  "/content/faqs/categories",
  /*
   * Menus. The bare path is `primary`, which is the assigned location: six root
   * items, one of them carrying two children, so the two-level tree renders at
   * full depth.
   *
   * **The unassigned location is the state worth having and it needs its own
   * URL**, because the location is a query parameter this screen owns:
   *
   *     node scripts/capture.mjs "/content/menus?location=footer"
   *
   * `GET /cms/menus/footer` is a 404 with its own sentence — "No menu is assigned
   * to that location." — which is a different fact from a location that was never
   * registered, and a `PUT` there **creates and assigns** the menu. So that
   * capture is an empty state with a working action behind it rather than an
   * error, and it is the only screen in the panel whose 404 is a state.
   */
  "/content/menus",
  /*
   * The media library, which is checklist item 13 and is on this list from the
   * media branch. It was excluded until then for the reason that entry gave —
   * a capture of an unmigrated screen lands in the same folder as the migrated
   * ones and is how a review report comes to say a screen is done.
   *
   * **The whole point of capturing this one is that the tiles are real.** `url`
   * pointed at `boutique.example.dz` until this branch — a host that does not
   * resolve — so a grid of 41 thumbnails would have photographed as 41 broken
   * boxes and the capture would have proved nothing but the layout. The mock now
   * serves genuine 30×20 PNG/JPEG/WebP bytes from its own origin, so a broken
   * tile in a screenshot is a real defect rather than the fixture.
   *
   * The 340px risk here is **row 19's filename**: 80 characters of `[a-z0-9]`
   * with no break opportunity, which is the longest name
   * `UploadPolicy::storedFilename()` can produce. Row 26 carries the other wrap —
   * a long title with spaces in it.
   *
   *     MOCK_MEDIA=empty node scripts/capture.mjs /media
   *
   * is the empty state, and it needs the switch because **the screen takes no
   * parameters**: no search, no filter, no sort, so unlike every list in the
   * panel there is no URL that empties it. Same argument `MOCK_HOMEPAGE` makes,
   * and read at module load the same way.
   */
  "/media",
  /*
   * The peek drawer, on the precedent `/content/menus?location=footer` set
   * directly above: a state this screen owns through a query parameter is its own
   * capture rather than a state of the one above it.
   *
   * 5001 is the first row of the measured collision trio — `real.jpg`, the file
   * uploaded three times — so the drawer's filename line has something to be
   * right about, and its caption is one of the empty ones (`index % 4 === 0`),
   * which is the field the drawer has to render absent rather than blank.
   */
  "/media?peek=5001",
  /*
   * ── Marketing: six screens that had never been photographed ────────────────
   *
   * Not an oversight in this list either: `/campaigns`, `/segments`,
   * `/email-templates` and `/marketing/config` were **all `rest_no_route`** in
   * the mock until 2026-08-28, so every capture of this section would have been
   * a photograph of its error state. That was the largest harness gap of the
   * run — six screens across the widest matrix the panel has.
   *
   * The hub first. Its three counts come from three `?per_page=1` requests, so
   * this route is also the only place a wrong `meta.total` would show.
   */
  "/marketing",
  /*
   * The campaign list, and it carries the strongest sort control in the panel —
   * four fields, both directions, and a real 400 for anything else. Five rows in
   * five states, so every status chip and both toned ones (`sending` accent,
   * `sent` success) are on screen at once.
   */
  "/marketing/campaigns",
  /*
   * **The peek drawer's URL, captured before the drawer exists.** The list has
   * no `?peek=` handler today; this route currently photographs the plain list,
   * and it is listed now because `GET /campaigns/{id}` is **value-identical to
   * the list row** — measured on all five — which is the condition
   * DECISIONS.md's standing rule makes a peek free under. Whoever adds the
   * drawer gets the capture for nothing.
   *
   * §14's lesson applies and is discharged here: a peek pinned to an id has to
   * be checked for which *page* it lands on, and 318 is on page 1 because the
   * collection holds five rows against a `PER_PAGE` of 20. It stays true only
   * while that is true.
   */
  "/marketing/campaigns?peek=318",
  /*
   * The composer, on a **draft** — the only status that renders it. 318 is the
   * one with a segment audience and a clean body, so the wizard opens on a
   * complete audience step rather than on a refusal.
   *
   * 319 is the other draft and is worth its own capture when the preview step
   * changes: its body says `{{firstname}}`, the preview renders `<p>Bonjour ,</p>`
   * and `unknown_tokens` names the typo — the state §85 asks the composer to
   * make impossible to miss.
   *
   *     node scripts/capture.mjs /marketing/campaigns/319
   */
  "/marketing/campaigns/318",
  /*
   * The **sent** campaign, which is a different screen rather than a state of
   * the one above: read-only, with the recipient list, its status filter and the
   * 5 / 4 counts. Row 353 carries the 80-character unbroken address, so this is
   * one of the two routes where the 340px overflow assertion has something to
   * catch.
   *
   * 321 is the campaign still draining — the only place a `pending` recipient
   * exists and the only cancellable non-draft:
   *
   *     node scripts/capture.mjs /marketing/campaigns/321
   *
   * **and it has four more states than it used to**, each a fixed seed offset
   * rather than a live counter — see `MOCK_SEND_PROGRESS` in the header. It is
   * still one route, so it is not listed four times below; the progress states are
   * captured one at a time when a screen needs them:
   *
   *     MOCK_SEND_PROGRESS=2 node scripts/capture.mjs /marketing/campaigns/321
   */
  "/marketing/campaigns/322",
  /*
   * Segments. Four rows, one of which (46, `wilaya_id`) previews **0 matches**
   * while the other three match somebody — that is correct behaviour and looks
   * exactly like a broken filter, which is the sentence the criteria form owes
   * the reader.
   */
  "/marketing/segments",
  /*
   * The templates list, and **4652 is why the screen exists**: two unknown
   * tokens named on the row, and `has_unsubscribe_token: false` beside them
   * which is *not* a warning. Both states are on this one capture.
   */
  "/marketing/email-templates",
  /*
   * The pixel configuration, and **its ordinary state is the disabled one** —
   * `enabled: false` with no providers, measured on this shop and on the one the
   * panel is built against. So this capture is the state every reader will
   * actually see rather than an edge case.
   */
  "/marketing/config",
  /*
   * ── And the section's forbidden state, which needs its own run ─────────────
   *
   * Every route above is `ac_manage_marketing`, and the four identities that
   * existed before this branch all hold it — so DESIGN.md §3.7's forbidden state
   * was unreachable for the whole section:
   *
   *     MOCK_IDENTITY=no_marketing node scripts/capture.mjs /marketing
   *
   * **And the compound rule needs a third run**, which is the one this section
   * has that no other does. `canSendCampaigns()` is `ac_manage_marketing` *and*
   * `ac_manage_customers`; without the second, the composer renders whole with
   * its send button disabled and its reason shown, the preview comes back with
   * `audience_count: null`, and the recipient list and a segment's count are
   * 403s — measured with a real `ac_marketing_manager` credential:
   *
   *     MOCK_IDENTITY=no_customers node scripts/capture.mjs /marketing/campaigns/318
   *     MOCK_IDENTITY=no_customers node scripts/capture.mjs /marketing/campaigns/322
   *     MOCK_IDENTITY=no_customers node scripts/capture.mjs /marketing/segments
   *
   * The middle one is the interesting capture: a screen that is mostly readable
   * with one section refused inside it, which is the shape `/orders/1023` under
   * `reduced` established and the only other place in the panel it occurs.
   */
];

/* -------------------------------------------------------------- the cookie --- */

/**
 * `.env.local` is parsed rather than imported, because pulling in dotenv to read
 * one key would add a dependency to a script whose whole point is to need
 * nothing, and because this file must never write to it.
 */
function envLocal(key) {
  const path = resolve(ROOT, ".env.local");
  if (!existsSync(path)) die(`No .env.local. ${key} is needed to mint a session cookie.`);

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] === key) return match[2].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

/**
 * The seal, reproduced exactly as lib/session/seal.ts derives it: sha256 of the
 * secret for the 32 bytes A256GCM needs, `dir` + `A256GCM`, and the payload
 * `sessionPayload` validates. The credential itself is never checked — the mock
 * answers everything — so the username and password are only there because the
 * schema requires a non-empty string.
 */
async function mintSession(secret) {
  const key = new Uint8Array(createHash("sha256").update(secret, "utf8").digest());
  return new EncryptJWT({ username: "harness", password: "harness", userId: 514 })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${12 * 60 * 60}s`)
    .encrypt(key);
}

/* ------------------------------------------------------------- the servers --- */

function die(message) {
  console.error(`capture: ${message}`);
  process.exit(2);
}

/**
 * `next start` serves what `next build` produced and nothing else, so a missing
 * or stale `.next` is the failure this harness was written after. Say which
 * command fixes it rather than letting the reader decode a connection refusal.
 */
function requireBuild() {
  const build = resolve(ROOT, ".next/BUILD_ID");
  if (!existsSync(build)) {
    die("no .next build found — run `npm run build` first, then re-run this.");
  }
  return readFileSync(build, "utf8").trim();
}

function startPanel() {
  const child = spawn(
    process.execPath,
    [resolve(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(HARNESS_PORT)],
    {
      cwd: ROOT,
      // `@next/env` will load .env.local too, but it never overwrites a variable
      // that is already set — so these two win, and the mock-stats assertion at
      // the end is what proves it rather than trusting it.
      env: {
        ...process.env,
        AC_API_BASE: `${MOCK}${BASE_PATH}`,
        SESSION_SECRET: process.env.SESSION_SECRET,
      },
      // Its own process group, so teardown takes the whole tree down with it.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const log = [];
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));
  return { child, log };
}

async function waitForPanel(log) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${PANEL}/fr/login`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // Not up yet. `next start` takes a second or two.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  die(`the panel never answered on ${PANEL}. Its output:\n${log.join("")}`);
}

/* --------------------------------------------------------------- captures --- */

/**
 * A route's directory name.
 *
 * Query separators fold to `-` along with the path ones, because a route can
 * carry state that makes it a different *screen* rather than a different page —
 * `/shipping?view=parcels` is the first — and `?`/`=`/`&` in a directory name is
 * legal on this filesystem and on almost no other.
 */
const slugOf = (route) => route.replace(/^\//, "").replace(/[/?&=]/g, "-") || "root";

/**
 * One capture: one route at one width, theme and locale.
 *
 * The screenshot is taken *before* the assertions run, on purpose — a failing
 * capture is exactly the one somebody wants to look at, and asserting first
 * would leave nothing on disk for the failure that matters most.
 */
async function capture(browser, cookie, route, width, theme, locale) {
  const label = `${slugOf(route)} ${width}-${theme}-${locale}`;
  const problems = [];
  const exempted = new Set();

  const context = await browser.newContext({
    viewport: { width, height: 900 },
    locale,
    // The panel resolves the theme on the server from this cookie — there is no
    // blocking script and nothing to hydrate — so it must be set on the context
    // rather than toggled after paint. `system` is the *absence* of the cookie,
    // which is why only the two explicit values are captured.
    deviceScaleFactor: 1,
  });
  await context.addCookies([
    { name: "ac_admin_session", value: cookie, url: PANEL },
    { name: "ac-theme", value: theme, url: PANEL },
  ]);

  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const url = request.url();
    const reason = request.failure()?.errorText ?? "?";

    // Only hosts this script started are ours to be responsible for. Anything
    // else is exempted and printed, because a silent exemption is how a broken
    // font or a leaked CDN call survives a green run.
    if (!url.startsWith(PANEL) && !url.startsWith(MOCK)) {
      exempted.add(`${url} (${reason})`);
      return;
    }

    /*
     * The one exemption on our own host, and it is narrow on purpose.
     *
     * Next's `<Link>` prefetches every nav target in the viewport as an RSC
     * payload and its scheduler then cancels the ones it no longer wants —
     * `net::ERR_ABORTED`, which is the browser saying *the page changed its
     * mind*, not the server refusing. Measured here: zero of these below `lg`
     * and twenty per capture at 1440, exactly tracking whether `AppShell`
     * renders the sidebar expanded or as a closed drawer. Nothing about the
     * screen is wrong in the second case.
     *
     * So an abort **of an RSC prefetch** is exempted and printed. An abort of
     * anything else, and every other failure reason on this host, still fails —
     * a 404 on a stylesheet must not slip through the same hole.
     */
    if (reason === "net::ERR_ABORTED" && url.includes("_rsc=")) {
      exempted.add(`${url.replace(/\?_rsc=.*$/, "?_rsc=…")} (cancelled Link prefetch)`);
      return;
    }

    problems.push(`requestfailed: ${url} (${reason})`);
  });

  try {
    await page.goto(`${PANEL}/${locale}${route}`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    // Let the web font swap land, so a capture is not of a half-painted state.
    await page.waitForTimeout(400);

    const dir = resolve(OUT, slugOf(route));
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${width}-${theme}-${locale}${SUFFIX}.png`);
    /*
     * **`animations: "disabled"`, and it is a bug fix rather than a tidy-up.**
     *
     * The 400ms above is sized for a font swap. It is not sized for *hydrate →
     * fetch a record → mount an overlay → slide it in*, and `networkidle` does
     * not cover that chain because the query fires after hydration, once the
     * network has already gone quiet. `/media?peek=5001` is the run's first
     * capture of an overlay opened from a URL parameter, and it photographed the
     * drawer **mid-slide** — content laid out for a 520px panel with only ~320px
     * of it on screen, which reads in the PNG as a clipped drawer rather than as
     * a moving one. Driven in a browser with a 900ms settle, the same drawer
     * measures x=920 w=520 right=1440 with zero overflow: the screen was right
     * and the harness was early.
     *
     * Playwright finishes every running CSS transition and animation and pins it
     * to its end state, which is exactly the frame this harness wants. Raising
     * the timeout instead would trade a wrong frame for a slower run and still
     * race whatever is slowest on the day.
     */
    await page.screenshot({ path: file, fullPage: true, animations: "disabled" });

    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      dir: document.documentElement.getAttribute("dir"),
      theme: document.documentElement.getAttribute("data-theme"),
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      /* The computed value, not the declared one. A stylesheet that 404s leaves
         every custom property unresolved and the body transparent, which is
         exactly the state a previous session shipped past a green build. */
      background: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(document.body).fontFamily,
    }));

    if (measured.scrollWidth !== measured.clientWidth) {
      problems.push(
        `overflow: scrollWidth ${measured.scrollWidth} ≠ clientWidth ${measured.clientWidth}`,
      );
    }
    if (measured.h1 === null) problems.push("no <h1> on the page");
    else if (measured.h1 === "") problems.push("<h1> is empty");

    const expectedDir = locale === "ar" ? "rtl" : "ltr";
    if (measured.dir !== expectedDir) {
      problems.push(`dir is ${measured.dir ?? "unset"}, expected ${expectedDir}`);
    }

    /*
     * Three assertions about the stylesheet, and they exist because the failure
     * this harness was written after was a *styling* failure that a build, a
     * type-check and a lint all waved through.
     *
     * 1. The theme the cookie asked for is the theme the server stamped. A
     *    missing attribute means the cookie never arrived and the "dark"
     *    screenshot is a light one.
     * 2. The body has an opaque background. `rgba(0, 0, 0, 0)` is what a
     *    document with no stylesheet computes, and it is indistinguishable from
     *    a working light theme in a thumbnail.
     * 3. Plex actually resolved. A fallback family means the self-hosted woff2
     *    404'd, which no other check in this repo would notice.
     */
    if (measured.theme !== theme) {
      problems.push(`data-theme is ${measured.theme ?? "unset"}, expected ${theme}`);
    }
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(measured.background)) {
      problems.push(
        `body background is ${measured.background} — the stylesheet did not load`,
      );
    }
    if (!measured.font.includes("Plex")) {
      problems.push(`body font is ${measured.font}, expected a Plex face`);
    }

    return {
      label,
      file,
      problems,
      exempted: [...exempted],
      key: `${slugOf(route)}/${width}/${locale}`,
      theme,
      background: measured.background,
    };
  } catch (error) {
    problems.push(`navigation: ${error instanceof Error ? error.message : String(error)}`);
    return { label, file: null, problems, exempted: [...exempted] };
  } finally {
    await context.close();
  }
}

/* ------------------------------------------------------------------- main --- */

const args = process.argv.slice(2);
const routes = args.includes("--all") ? DEFAULT_ROUTES : args.filter((a) => a.startsWith("/"));

if (routes.length === 0) {
  die("usage: node scripts/capture.mjs /orders [/products …]   (or --all)");
}

const buildId = requireBuild();

const secret = envLocal("SESSION_SECRET");
if (!secret || secret.length < 32) {
  die("SESSION_SECRET in .env.local must be at least 32 characters — seal.ts refuses less.");
}
process.env.SESSION_SECRET = secret;

let mock = null;
let panel = null;
let browser = null;
let torn = false;

async function teardown() {
  if (torn) return;
  torn = true;
  if (browser) await browser.close().catch(() => {});
  if (panel?.child.pid) {
    // Negative pid: the whole process group, because `next start` is not alone.
    try {
      process.kill(-panel.child.pid, "SIGTERM");
    } catch {
      panel.child.kill("SIGTERM");
    }
  }
  if (mock) await new Promise((r) => mock.close(r));
}

process.on("SIGINT", async () => {
  await teardown();
  process.exit(130);
});

const results = [];
let exitCode = 0;

try {
  mock = await startServer(MOCK_PORT);
  panel = startPanel();
  await waitForPanel(panel.log);

  const cookie = await mintSession(secret);
  browser = await chromium.launch();

  console.log(
    `capture: build ${buildId}, panel ${PANEL}, mock ${MOCK}${BASE_PATH}, identity ${IDENTITY}\n` +
      `capture: ${routes.length} route(s) × ${WIDTHS.length} widths × ${THEMES.length} themes ×` +
      ` ${LOCALES.length} locales = ${routes.length * WIDTHS.length * THEMES.length * LOCALES.length} captures\n`,
  );

  for (const route of routes) {
    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        for (const locale of LOCALES) {
          const result = await capture(browser, cookie, route, width, theme, locale);
          results.push(result);
          const status = result.problems.length === 0 ? "ok  " : "FAIL";
          console.log(`  ${status}  ${result.label}`);
          for (const problem of result.problems) console.log(`          ${problem}`);
        }
      }
    }
  }

  /**
   * The proof that the twelve screenshots above are of the panel reading this
   * mock, and not of a panel that quietly reached for the real shop and rendered
   * an error state with a heading on it.
   */
  const served = await fetch(`${MOCK}/__mock/stats`).then((r) => r.json());
  console.log(`\ncapture: the mock served ${served.count} request(s)`);
  if (served.count === 0) {
    console.error(
      "\ncapture: FAIL — the mock received zero requests. The panel was talking to\n" +
        "something else (most likely AC_API_BASE from .env.local), so every screenshot\n" +
        "above is a screenshot of an error state, whatever it looks like.",
    );
    exitCode = 1;
  } else {
    const top = Object.entries(served.paths)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    for (const [path, count] of top) console.log(`         ${String(count).padStart(4)}  ${path}`);
  }

  /**
   * The cross-capture assertion the per-capture ones cannot make: light and dark
   * must actually differ.
   *
   * Each of them alone only proves *a* background computed. A `tokens.css` whose
   * dark block stopped matching — a renamed selector, a media query with no
   * `[data-theme]` twin — leaves both themes rendering the light palette, every
   * capture opaque, every assertion above green, and the dark screenshots wrong.
   * Comparing the pair is what catches it.
   */
  const pairs = new Map();
  for (const result of results) {
    if (!result.key) continue;
    const pair = pairs.get(result.key) ?? {};
    pair[result.theme] = result.background;
    pairs.set(result.key, pair);
  }
  const identical = [...pairs].filter(([, p]) => p.light && p.light === p.dark);
  if (identical.length > 0) {
    console.error(
      `\ncapture: FAIL — light and dark computed the same body background on` +
        ` ${identical.length} capture pair(s). The dark palette is not being applied:`,
    );
    for (const [key, pair] of identical) console.error(`         ${key}  both ${pair.light}`);
    exitCode = 1;
  }

  const exempted = new Set(results.flatMap((r) => r.exempted));
  if (exempted.size > 0) {
    console.log(
      "\ncapture: failed requests exempted — a host this script did not start," +
        "\n         or a Link prefetch the page itself cancelled:",
    );
    for (const url of exempted) console.log(`         ${url}`);
  }

  const failed = results.filter((r) => r.problems.length > 0);
  const bytes = results
    .filter((r) => r.file)
    .reduce((sum, r) => sum + statSync(r.file).size, 0);

  if (failed.length > 0) exitCode = 1;

  /* The verdict is the whole run, not the per-capture tally. The cross-capture
     checks above — the mock's request count and the light/dark comparison — can
     each fail a run in which every individual capture passed, and a summary that
     printed "12/12 passed" underneath one of those would be the false green this
     harness exists to prevent. */
  console.log(
    `\ncapture: ${results.length - failed.length}/${results.length} captures clean,` +
      ` ${(bytes / 1024).toFixed(0)} KiB under .impeccable/harness/` +
      `\ncapture: ${exitCode === 0 ? "PASS" : "FAIL"}`,
  );
} catch (error) {
  console.error(`\ncapture: ${error instanceof Error ? error.stack : String(error)}`);
  exitCode = 2;
} finally {
  await teardown();
}

process.exit(exitCode);
