/**
 * The shop API, faked well enough to render every screen and badly enough to be
 * honest about it.
 *
 *   node scripts/mock-api.mjs        # MOCK_PORT, default 8099, on 127.0.0.1
 *
 * The e2e suite needs live shop credentials nobody has in CI, and `next build`
 * passing is not evidence a screen renders — it once passed with a completely
 * broken stylesheet off a stale `.next`. So `scripts/capture.mjs` points a real
 * Next server at this and drives a real browser through it. This file is the
 * data half of that.
 *
 * ── The rule that matters most ────────────────────────────────────────────────
 *
 * **On most collections `orderby` and `order` are accepted and ignored, on
 * purpose. Do not "fix" that.**
 *
 * The real API does exactly that. Measured 2026-08-18 against the live router:
 * five of the eight published `orderby` values on `/products` — `id`, `price`,
 * `sku`, `popularity`, `rating` — returned a byte-identical id sequence to
 * `orderby=date` in both directions, and `?orderby=nonsense` answers 200. See
 * `SORTS` in lib/product-status.ts, which exists because of it.
 *
 * A mock that sorted would let an agent build a sort control, watch it work
 * here, and ship a control that does nothing in production. The harness exists
 * to catch that class of thing, not to manufacture it. So: same order every
 * time, whatever is asked for, and 200 for a value nobody has heard of.
 *
 * ── The two exceptions, and they are not the same shape ──────────────────────
 *
 * **`/products` sorts twelve of its sixteen combinations. `/coupons` sorts all
 * eight of its own. `/orders` and `/customers` still sort nothing. Do not
 * simplify this into either extreme.**
 *
 * The silent ignore was repaired in the backend — `ProductRepository::
 * orderingClause()`, which joins `wc_product_meta_lookup` through
 * `posts_clauses`. This file said "exactly five combinations" until 2026-08-25,
 * on a measurement taken 2026-08-18, and **the repair had already outgrown it**.
 * Re-measured over the full 28-row catalogue, each ordering checked against the
 * order its own field implies rather than against "differs from the default",
 * with the count of distinct values that backs it:
 *
 *     date  16 · id 28 · title 28 · price 21 · sku 28 · popularity 13
 *
 * Six values, both directions, twelve combinations. **`title desc` is among
 * them** — this file called it "deliberately absent, nobody measured it" and it
 * had been working the whole time.
 *
 * `menu_order` and `rating` are the other two, and they are **unprovable rather
 * than dead**: every one of the 28 products carries the same value for both, so
 * the two directions tie and answer identically whether the sort runs or not.
 * They are accepted, validated, and left unsorted here — the run's rule is that
 * a control ships only where someone measured it working, and nobody can measure
 * these until the shop has data that separates them.
 *
 * Both halves of this are load-bearing. Sorting everything would let an agent
 * build a `rating` control, watch it work here and ship a control nothing in the
 * shop can exercise; sorting nothing would make the twelve controls the panel
 * offers look broken against the harness and invite someone to delete them.
 *
 * **The lesson this file paid for twice**: a dated measurement is not a
 * permanent fact. Both times the sort was recorded dead, the record outlived the
 * repair, and both times the tell was the same — the control had been taken on a
 * value that could not distinguish working from broken.
 *
 * **`/coupons` is the second exception and it is total**, not partial: `date`,
 * `id`, `code` and `usage`, both directions, all eight re-measured working on
 * 2026-08-25 against a positive control. `usage` sorts **numerically** — as text,
 * 99 would come before 7.
 *
 * This file recorded those eight as ignored for two branches, and *why* is the
 * part worth keeping: `date` is the default, so it is the one value whose answer
 * is identical whether the sort works or not. It was used as its own control and
 * proved nothing. See `COUPON_SORTS`.
 *
 * The warning above still holds everywhere else — `/orders` and `/customers`
 * validate and then ignore, and the five unmeasured `/products` combinations come
 * back unsorted with a 200.
 *
 * What *is* genuinely implemented, because a screen that silently ignored these
 * would be a screen that lies about how many rows exist:
 *
 *   page, per_page   real, and >100 is a 400 rather than a clamp — measured
 *   status           real on /orders (single value, a comma list is a 400) and
 *                    real on /products, whose own set is publish/draft/pending/
 *                    private — `?status=trash` is a 400 there, and a trashed
 *                    product still reads back from `/products/{id}` with a 200.
 *                    Real on /coupons too, and **three-state there**: publish,
 *                    draft, and *absent meaning both* — which is not a synonym
 *                    for either. `trash` is a 400 and a trashed coupon still
 *                    reads back 200, the same asymmetry products have
 *   search           real on /orders, /products, /customers, /coupons —
 *                    substring, and accent-folded, because MySQL's collation is:
 *                    `?search=Chérif` matches `nadia.cherif@…`. **On /customers
 *                    it does not match a name** — see "What ?search= on
 *                    /customers does not match", which is the single most
 *                    carefully measured fact on that screen and the one this file
 *                    got wrong for three branches. On /coupons it is the **code
 *                    only**, which is the same restraint for the same reason
 *   the nine filters real on /products: sku, category, tag, min_price,
 *                    max_price, stock_status, on_sale, featured and
 *                    `attributes[taxonomy]=slug,slug`
 *   facets           real on /products, opt-in through `?facets=`, counted over
 *                    published rows only — and every group but `category` and
 *                    `tag` excludes its own filter, which is the API's own
 *                    inconsistency and not a bug to tidy up here
 *   the product      real: `PATCH /products/{id}` is stateful and reproduces the
 *   writes           measured writable/read-only split — a read-only key is
 *                    dropped in silence, an unknown one is a 400, and a body of
 *                    nothing but read-only keys is a 400 that names nothing.
 *                    `DELETE` trashes, `?force=true` removes, and the two answer
 *                    identical bodies. See "Which product id produces which
 *                    answer" beside them
 *   the coupon       real, and it **shares** the product's read-only rule rather
 *   writes           than inverting it: a read-only key is dropped in silence and
 *                    an unknown one is a 400. The two differ only at the end — a
 *                    body left with nothing supported is a 200 no-op here and a
 *                    400 there — which is what lets the whole GET body PATCH back.
 *                    A duplicate code is a 409 under `details.code` carrying the
 *                    lower-cased form, and trash keeps the code while
 *                    `?force=true` frees it. `POST` is served here and is a 404 on
 *                    /products, which the allowlist decides rather than this file.
 *                    See "Which coupon id produces which refusal"
 *   the two pickers  real: `/coupons/eligible-products` and
 *                    `/coupons/eligible-categories`, four and five fields, no
 *                    price and no stock — they exist because a Marketing Manager
 *                    holds `ac_manage_coupons` and not `ac_manage_products`, so
 *                    a picker built on /products would 403 the one role whose job
 *                    coupons are. The product search matches **SKU**, which
 *                    WordPress's own `s` does not
 *
 * ── Determinism ──────────────────────────────────────────────────────────────
 *
 * A screenshot has to be byte-stable between runs or the harness reports a diff
 * every time it is run. So there is no `Math.random()` and no `Date.now()`
 * anywhere in the response path: one seeded mulberry32 runs at module load and
 * every timestamp is derived from a hard-coded epoch.
 *
 * **The writes are stateful and this still holds.** A PATCHed status is visible
 * to every later read *in the same process* — without that, a screen that writes
 * and refetches could never be verified, because it would always redisplay what
 * it had. Every mutable thing lives in one `state` object that `resetState()`
 * rebuilds from written-out seeds, and `resetState()` runs at module load, so
 * two processes start identical and nothing carries over between them. See
 * "How a write can be stateful and a capture run still byte-stable" below.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 *
 * `respond()` is a function of its arguments and of what has been written to it
 * in this process — method, path, params and a parsed body in, `{status, body}`
 * out — and is what tests/mock-api.test.ts parses with the panel's own Zod
 * schemas and its own `unwrap()`. The server below is a thin shell over it, so
 * anything the browser can get is something the unit suite has already
 * validated.
 *
 * There is deliberately **no permissive catch-all**. An unmocked path is a 404
 * with a `rest_no_route` envelope, because a screen calling something nobody
 * mocked must fail loudly rather than quietly render an empty table.
 */
import { createServer as createHttpServer } from "node:http";

export const BASE_PATH = "/wp-json/algerian-commerce/v1";

/* ------------------------------------------------------------ determinism --- */

/** mulberry32. Small, seeded, and the same sequence on every machine. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260818);

/** An integer in [min, max]. */
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));

/** Deterministic Fisher-Yates, so an interleaved status column is stable. */
function shuffled(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * `Date.parse` of a literal, never `Date.now()`. The panel's schemas take
 * `date_created` as full ISO with an offset — `"2026-08-18T02:52:22+00:00"` —
 * and `toISOString()` emits `Z` with milliseconds, so both are corrected here.
 */
const EPOCH = Date.parse("2026-08-18T02:52:22Z");
const iso = (minutesAgo) =>
  new Date(EPOCH - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, "+00:00");

/**
 * One deliberately awful string per collection, so the 340px overflow assertion
 * has something to catch. A 60-character SKU with no break opportunity is the
 * thing that pushes a table past the viewport, and a table that only ever holds
 * tidy values proves nothing about the one that does not.
 */
const LONG_SKU = `AC-${"X".repeat(54)}-01`;
const LONG_EMAIL =
  "commande-tres-longue-sans-aucune-espace@boutique-artisanale-algerienne-exemple.dz";
/** The parcels list's own, and it is the tracking number because that is the
    column a courier fills with an unbroken run of characters. Provider-neutral
    on purpose: it lands on whichever row index 0 turns out to be. */
const LONG_TRACKING = `AC-${"7".repeat(52)}-DZ`;

/* --------------------------------------------------------------- envelope --- */

/**
 * The contract is lib/api/envelope.ts and it is strict: `success` is a literal,
 * `meta` belongs to list endpoints only, and a failure carries `code`, `message`
 * and `details`.
 */
const ok = (data, meta) => ({
  status: 200,
  body: meta === undefined ? { success: true, data } : { success: true, data, meta },
});

/**
 * A create's envelope: the same body as `ok()`, and **201**.
 *
 * Measured 2026-08-25 on `POST /shipping/rules` — both with `provider: ""` and
 * with the key omitted — where this file had been answering 200. The body was
 * identical, which is exactly why it survived: a request-for-request diff of
 * envelopes and sentences compares neither the status nor the error `code`, and
 * **the status is the third thing that can drift in silence.** The error codes
 * went the same way, hiding behind assertions that only ever read messages.
 *
 * `unwrap()` accepts anything in 200-299, so a screen cannot tell the two apart
 * — which is the argument for reproducing it rather than against.
 *
 * **Three of the file's four creates, each measured on its own request** —
 * `POST /shipping/rules`, `POST /coupons` and `POST /orders/{id}/shipments`,
 * all 2026-08-25. They were moved here one measurement at a time rather than
 * swept: the first 201 was treated as a fact about one route, not a pattern,
 * because this API is not reliable about REST conventions and assuming
 * otherwise is the move the harness exists to prevent. Three agreeing is what
 * settled it.
 *
 * The fourth, `POST /orders/{id}/cod/attempts`, stays 200 and stays
 * **unmeasured — because provoking it is irreversible, not because it is
 * unreachable.** A coupon can be force-deleted and a parcel cancelled; a
 * recorded delivery call cannot be un-recorded, so nobody has fired one at the
 * shop to see what it answers. Whoever is willing to spend an attempt on a
 * disposable order should take that measurement.
 */
const created = (data) => ({ status: 201, body: { success: true, data } });

/**
 * ── A list has THREE envelope shapes, and this file used to have one ─────────
 *
 * Measured 2026-08-26 by a request-for-request diff against the live shop, which
 * is the check DECISIONS.md says to run on a collection before trusting it:
 *
 *   route                 live meta                mock meta, before
 *   ────────────────────  ───────────────────────  ────────────────────────────
 *   /payments/methods     **absent**               {total,page,per_page,…}
 *   /shipping/providers   **absent**               {total,page,per_page,…}
 *   /locations/wilayas    **{"total":69}** alone   {total,page,per_page,…}
 *
 * So the API varies where this file standardised, and `list()` was quietly
 * manufacturing a paging envelope for routes that page nothing and, on wilayas,
 * a `page`/`per_page`/`total_pages` triple the shop does not send at all.
 *
 * **This is the same class as the `per_page` default this file already found**:
 * one shared helper flattening something the API varies, invisible because
 * nothing reads the flattened field. Nothing reads `.meta` on these three today
 * — every caller takes `r.data`, which was checked — but a screen that started
 * reading `meta.total` off wilayas would get 58 here and 69 from the shop, and
 * the harness would call it green. That is the mock being *more capable* than the
 * API in the quiet direction.
 *
 * Three helpers rather than three special cases at three call sites, so a fourth
 * enumeration added later inherits a shape by **naming** one:
 *
 *   enumeration()  no `meta` key at all — measured on the two above
 *   counted()      `{total}` and nothing else — measured on wilayas
 *   list()         the full paging envelope, and **now the unmeasured one**
 *
 * `/locations/wilayas` also differs in **count** — 58 here against 69 live. That
 * is fixture completeness rather than envelope shape, it is out of scope for the
 * payments branch, and it is recorded here so the next person finds it.
 */

/** Shape 1: no `meta` whatsoever. A bare enumeration the API does not page. */
const enumeration = (rows) => ok(rows);

/** Shape 2: `{total}` alone — a count, with nothing about pages. */
const counted = (rows) => ok(rows, { total: rows.length });

/**
 * Shape 3: the full paging envelope on a route that is **not** paginated.
 *
 * **Every remaining caller of this is unmeasured**, and after the diff above that
 * is a claim rather than a default. These five are what is left, all of them
 * routes the panel fetches with no params at all:
 *
 *   /orders/{id}/notes · /orders/{id}/timeline · /orders/{id}/shipments ·
 *   /orders/{id}/payments · /shipping/rates · /attributes
 *
 * Each is a candidate for `enumeration()` or `counted()` and none has been
 * diffed. They stay here deliberately: moving them to a *different* guess would
 * be churn rather than a correction, and this way the file has exactly one place
 * that emits an unverified envelope. Whoever runs the next request-for-request
 * diff should take these six first.
 *
 * The unpaginated part is still right and still load-bearing: the panel sends no
 * params to any of them, so a default `per_page` of 10 would silently drop the
 * tail of a timeline with nothing anywhere reporting an error.
 */
const list = (rows) =>
  ok(rows, {
    total: rows.length,
    page: 1,
    per_page: rows.length,
    total_pages: rows.length === 0 ? 0 : 1,
  });

/**
 * **`code` is the *normalised* code, never WordPress's own.** Corrected
 * 2026-08-25, when a live-versus-mock diff found all fourteen parameter
 * refusals here answering `rest_invalid_param` — a code no client can ever
 * receive. `src/API/ErrorNormalizer.php:31-32` maps both
 * `rest_invalid_param` and `rest_missing_callback_param` to `invalid_request`
 * on the way out, so the wire vocabulary is the short list and nothing else:
 *
 *     invalid_request · not_found · conflict · unauthenticated
 *
 * All four re-measured on the same day. The messages were right the whole time,
 * which is why this survived so long: every assertion compared the sentence and
 * none compared the code. No screen branches on it today — that was checked, not
 * assumed — so this cost nothing yet, and would have cost a screen the first
 * time one did.
 *
 * **An empty `details` is omitted rather than sent as `{}`.** Measured
 * 2026-08-26 alongside the envelope diff, on the two errors in this file that
 * carry no details at all:
 *
 *   live  403  {"code":"forbidden","message":"You are not allowed to …"}
 *   live  404  {"code":"not_found","message":"No payment with that id."}
 *
 * neither with a `details` key. The generalisation from two measurements to the
 * whole constructor is safe because **every** call site here that passes no
 * details is one of six 404s or the 403 — codes that carry none under either
 * reading — so "the API omits an empty details" and "the API omits details on
 * these codes" produce byte-identical output for this file. Low consequence
 * either way: `ApiError` reaches for `details.params`/`details.fields` and gets
 * `undefined` from both shapes.
 */
const fail = (status, code, message, details = {}) => ({
  status,
  body: {
    success: false,
    error:
      Object.keys(details).length === 0
        ? { code, message }
        : { code, message, details },
  },
});

/**
 * A failure with **no `details` key at all**, which is a shape the API really
 * produces and is not the same as an empty one.
 *
 * `PATCH /products/{id}` with nothing but read-only keys answers 400 `"No
 * supported fields were provided."` and names nothing — measured, and the reason
 * the product form sends an explicit named subset rather than the GET body minus
 * what it believes is read-only. A mock that emitted `details: {}` here would let
 * a screen read `details.fields` without checking and never find out.
 *
 * **`fail()` now produces this same shape when its details are empty**, so this
 * is no longer the only way to reach it. Kept because its one call site is a 400
 * that deliberately names nothing, and saying that by name is worth more than
 * saving a helper — a future `fail(400, …, {})` would read as an oversight where
 * `bareFail` reads as the measurement it is.
 */
const bareFail = (status, code, message) => ({
  status,
  body: { success: false, error: { code, message } },
});

const notFound = () =>
  fail(404, "rest_no_route", "No route was found matching the URL and request method.");

/**
 * **A fifth wire error code, and DECISIONS.md's "Carried forward" says there are
 * four.** That entry — `invalid_request · not_found · conflict ·
 * unauthenticated` — was written from the fourteen *parameter* refusals a
 * live-versus-mock diff turned up, and a parameter refusal is the one family that
 * can never be a 403. Measured 2026-08-26 with a credential holding no
 * `ac_manage_payments`:
 *
 *     403 {"code":"forbidden","message":"You are not allowed to perform this
 *          action."}
 *
 * — with **no `details` key at all**, which is what `fail()`'s own docblock
 * records from the same day's diff. This block quoted `"details":{}` until
 * 2026-08-26 and was the stale half of a contradiction between two comments
 * about one measurement; the emitted body was never wrong, because `fail()`
 * omits an empty `details` outright.
 *
 * on `/payments`, `/payments/methods` and `/payments/{id}` alike, and a **200**
 * on `/cod/statistics` beside them — which is the whole reason the payments
 * screen has two sections rather than one. The ledger needs the correction; this
 * file cannot make it.
 *
 * `errorMessageKey()` branches on the **status** and never on this code, so no
 * screen reads it today. That was checked rather than assumed, the same way the
 * fourteen were.
 */
const forbidden = () =>
  fail(403, "forbidden", "You are not allowed to perform this action.");

/* ---------------------------------------------------------------- wilayas --- */

/** All 58, bilingual on every row — the table that turns a `state` of "16" into Alger. */
const WILAYA_NAMES = [
  ["Adrar", "أدرار"],
  ["Chlef", "الشلف"],
  ["Laghouat", "الأغواط"],
  ["Oum El Bouaghi", "أم البواقي"],
  ["Batna", "باتنة"],
  ["Béjaïa", "بجاية"],
  ["Biskra", "بسكرة"],
  ["Béchar", "بشار"],
  ["Blida", "البليدة"],
  ["Bouira", "البويرة"],
  ["Tamanrasset", "تمنراست"],
  ["Tébessa", "تبسة"],
  ["Tlemcen", "تلمسان"],
  ["Tiaret", "تيارت"],
  ["Tizi Ouzou", "تيزي وزو"],
  ["Alger", "الجزائر"],
  ["Djelfa", "الجلفة"],
  ["Jijel", "جيجل"],
  ["Sétif", "سطيف"],
  ["Saïda", "سعيدة"],
  ["Skikda", "سكيكدة"],
  ["Sidi Bel Abbès", "سيدي بلعباس"],
  ["Annaba", "عنابة"],
  ["Guelma", "قالمة"],
  ["Constantine", "قسنطينة"],
  ["Médéa", "المدية"],
  ["Mostaganem", "مستغانم"],
  ["M'Sila", "المسيلة"],
  ["Mascara", "معسكر"],
  ["Ouargla", "ورقلة"],
  ["Oran", "وهران"],
  ["El Bayadh", "البيض"],
  ["Illizi", "إليزي"],
  ["Bordj Bou Arréridj", "برج بوعريريج"],
  ["Boumerdès", "بومرداس"],
  ["El Tarf", "الطارف"],
  ["Tindouf", "تندوف"],
  ["Tissemsilt", "تيسمسيلت"],
  ["El Oued", "الوادي"],
  ["Khenchela", "خنشلة"],
  ["Souk Ahras", "سوق أهراس"],
  ["Tipaza", "تيبازة"],
  ["Mila", "ميلة"],
  ["Aïn Defla", "عين الدفلى"],
  ["Naâma", "النعامة"],
  ["Aïn Témouchent", "عين تموشنت"],
  ["Ghardaïa", "غرداية"],
  ["Relizane", "غليزان"],
  ["Timimoun", "تيميمون"],
  ["Bordj Badji Mokhtar", "برج باجي مختار"],
  ["Ouled Djellal", "أولاد جلال"],
  ["Béni Abbès", "بني عباس"],
  ["In Salah", "عين صالح"],
  ["In Guezzam", "عين قزام"],
  ["Touggourt", "توقرت"],
  ["Djanet", "جانت"],
  ["El M'Ghair", "المغير"],
  ["El Meniaa", "المنيعة"],
];

const slugify = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const WILAYAS = WILAYA_NAMES.map(([name, nameAr], index) => ({
  id: index + 1,
  code: String(index + 1).padStart(2, "0"),
  slug: slugify(name),
  name,
  name_ar: nameAr,
  is_active: true,
}));

/* --------------------------------------------------------------- identity --- */

/**
 * A Super Admin, because the harness's job is to render screens rather than to
 * exercise the forbidden state. Every capability in lib/capabilities.ts is here;
 * a missing one shows up as a `ForbiddenState` screenshot rather than an error,
 * which is exactly the kind of quiet wrong answer this file must not produce.
 */
const CAPABILITIES = [
  "ac_manage_products",
  "ac_manage_inventory",
  "ac_manage_orders",
  "ac_manage_customers",
  "ac_manage_coupons",
  "ac_manage_shipping",
  "ac_manage_payments",
  "ac_manage_content",
  "ac_manage_marketing",
  "ac_view_analytics",
  "ac_manage_settings",
  "ac_manage_users",
  "ac_view_audit_logs",
];

/**
 * ── The other two identities, and how to ask for them ────────────────────────
 *
 * Holding all thirteen is what a harness needs and is also why, until now, **no
 * screen could be captured in its forbidden state** — DESIGN.md §3.7 makes that
 * one of the five states every screen must have, and it was the one state the
 * harness could not reach. The order detail is where that bites: `ParcelsSection`
 * and `PaymentsSection` are rendered only for a holder of `ac_manage_shipping`
 * and `ac_manage_payments`, so with one identity there is no capture in which
 * they are absent.
 *
 *   node scripts/capture.mjs /orders/1023                        all thirteen
 *   MOCK_IDENTITY=reduced node scripts/capture.mjs /orders/1023  eleven of them
 *   MOCK_IDENTITY=support node scripts/capture.mjs /dashboard    eleven others
 *
 * `reduced` is the same person minus exactly those two, so the order detail still
 * renders — it keeps `ac_manage_orders` — with its two gated sections gone rather
 * than empty. It is not "a Manager": the two-tier collapse takes more than two
 * capabilities off a Manager, and naming it one here would be a claim about the
 * shop's roles that this file has not measured.
 *
 * `support` is a **different** two off the same list, and it exists because the
 * dashboard's money gate is `ac_manage_orders` — which `reduced` holds. Its own
 * block below says what was measured and what was not.
 *
 * Read **once, at module load**, so `respond()` stays pure and a capture run is
 * one identity from beginning to end. An unrecognised value throws rather than
 * falling back, because a run that quietly served the Super Admin after being
 * asked for the reduced one would produce a green forbidden-state capture that is
 * nothing of the kind.
 */
const IDENTITIES = {
  full: {
    id: 514,
    username: "harness",
    display_name: "Harness Admin",
    email: "harness@example.test",
    roles: ["ac_super_admin"],
    capabilities: CAPABILITIES,
    auth_method: "application_password",
  },
  reduced: {
    id: 515,
    username: "harness-reduced",
    display_name: "Harness Staff",
    email: "harness-reduced@example.test",
    roles: ["ac_staff"],
    capabilities: CAPABILITIES.filter(
      (capability) => capability !== "ac_manage_shipping" && capability !== "ac_manage_payments",
    ),
    auth_method: "application_password",
  },
  /*
   * ── The third identity, and why `reduced` could not be it ──────────────────
   *
   * The dashboard's money gate is `canSeeMoney()` — `ac_view_analytics` **and**
   * `ac_manage_orders` — and `reduced` holds both, deliberately: it keeps
   * `ac_manage_orders` so that `/orders/1023` renders with two sections missing
   * rather than as a whole page refused, which is the only reason that identity
   * exists. So `MOCK_IDENTITY=reduced` cannot reach the half-payload state, and
   * making it reach one would destroy the capture it was built for.
   *
   * Measured 2026-08-26 with a real Support Agent credential, and it is the
   * whole of what is claimed here:
   *
   *     /analytics/overview  200, `revenue` **absent**, money_visible false
   *     /analytics/revenue   403
   *     /orders              403
   *     /inventory           403
   *     /customers           **200**
   *
   * So `ac_manage_orders` and `ac_manage_inventory` are off and
   * `ac_manage_customers` and `ac_view_analytics` are on. **The other nine were
   * not measured and are left at the harness default**, which follows the rule
   * `reduced` set: this is a credential with a measured shape, not a claim about
   * what the shop's Support Agent role contains. Nothing is inferred from the
   * name — that is why the delta from `full` is exactly the two 403s that were
   * seen, and no more.
   */
  support: {
    id: 516,
    username: "harness-support",
    display_name: "Harness Support",
    email: "harness-support@example.test",
    roles: ["ac_staff"],
    capabilities: CAPABILITIES.filter(
      (capability) => capability !== "ac_manage_orders" && capability !== "ac_manage_inventory",
    ),
    auth_method: "application_password",
  },
};

const REQUESTED_IDENTITY = process.env.MOCK_IDENTITY ?? "full";
if (!(REQUESTED_IDENTITY in IDENTITIES)) {
  throw new Error(
    `MOCK_IDENTITY must be one of ${Object.keys(IDENTITIES).join(", ")} — got "${REQUESTED_IDENTITY}".`,
  );
}
const IDENTITY = IDENTITIES[REQUESTED_IDENTITY];

/* --------------------------------------------------------------- products --- */

const PRODUCT_NAMES = [
  "Miel de jujubier, 500 g",
  "Huile d'olive extra vierge, 1 L",
  "Dattes Deglet Nour, 1 kg",
  "Burnous en laine tissé main",
  "Savon noir traditionnel, 250 g",
  "Café moulu arabica, 250 g",
  "Poterie de Maatkas, grand plat",
  "Tapis berbère, 120 × 180",
  "Figues sèches de Béni Maouche",
  "Eau de fleur d'oranger, 500 ml",
  "Harissa artisanale, 200 g",
  "Bijou en argent de Beni Yenni",
  "Amandes de Tlemcen, 500 g",
  "Couscous fin roulé main, 1 kg",
  "Chèche en coton, teinture naturelle",
  "Miel de montagne, 250 g",
  "Olives cassées de Sig, 500 g",
  "Panier en alfa tressé",
  "Raisins secs de Aïn Témouchent",
  "Caftan brodé, taille unique",
  "Thé vert à la menthe, 200 g",
  "Plateau en cuivre martelé",
  "Confiture de coing, 350 g",
  "Sac en cuir de Ghardaïa",
  "Pistaches grillées, 300 g",
  "Lampe en fer forgé",
  "Sirop de datte, 500 ml",
  "Écharpe en laine de Djurdjura",
];

/**
 * The measured edge cases, pinned to explicit indices rather than drawn from the
 * PRNG. A quantity may as well be random; *which* row has no price may not — the
 * whole value of these rows is that they land on page one, where a capture sees
 * them.
 */
const NO_STOCK_MANAGEMENT = new Set([2, 5, 9, 13, 17, 20, 24, 27]); // 8 of 28
/** Product index → how many variations it carries. Five in total, so 28 + 5 = 33 rows. */
const VARIATION_COUNTS = new Map([
  [3, 3],
  [19, 2],
]);
const NO_PRICE_PRODUCT = 6; // published, and `price: ""` is a real value
const DRAFT_NO_SLUG_PRODUCT = 11; // never published, so `slug: ""`
const LONG_SKU_PRODUCT = 14;

const PRODUCTS = PRODUCT_NAMES.map((name, index) => {
  const id = 101 + index;
  const managed = !NO_STOCK_MANAGEMENT.has(index);
  const variationCount = VARIATION_COUNTS.get(index) ?? 0;
  const variable = variationCount > 0;
  const draft = index === DRAFT_NO_SLUG_PRODUCT;
  const priced = index !== NO_PRICE_PRODUCT;
  const regular = `${int(4, 90) * 100}.00`;
  const quantity = managed ? int(0, 40) : null;

  return {
    id,
    name,
    slug: draft ? "" : slugify(name),
    type: variable ? "variable" : "simple",
    status: draft ? "draft" : "publish",
    featured: index % 9 === 0,
    catalog_visibility: "visible",
    sku: index === LONG_SKU_PRODUCT ? LONG_SKU : `AC-CAT-${String(id).padStart(4, "0")}`,
    description: `<p>${name} — sélection de la boutique.</p>`,
    short_description: `<p>${name}</p>`,
    // On a variable product the effective price is resolved and `regular_price`
    // is `""`; on the no-price product both are empty. Neither is a zero.
    price: priced ? regular : "",
    regular_price: variable || !priced ? "" : regular,
    sale_price: "",
    on_sale: false,
    manage_stock: managed,
    stock_quantity: quantity,
    stock_status: quantity === null || quantity > 0 ? "instock" : "outofstock",
    weight: "",
    category_ids: [10 + (index % 6)],
    tag_ids: [],
    attributes: variable
      ? [
          {
            id: 0,
            name: "Taille",
            options: ["S", "M", "L"],
            visible: true,
            variation: true,
            position: 0,
          },
        ]
      : [],
    // Variation **ids**, not objects — the bodies live behind /variations.
    variations: Array.from({ length: variationCount }, (_, slot) => 9000 + index * 10 + slot),
    image_id: 0,
    gallery_image_ids: [],
    image: null,
    gallery: [],
    permalink: `https://boutique.example.test/produit/${slugify(name) || id}`,
    seo: {
      title: name,
      description: `${name} — boutique artisanale.`,
      canonical: "",
      robots: { index: !draft, follow: true, directive: draft ? "noindex, follow" : "index, follow" },
      overrides: [],
    },
    date_created: iso(2000 + index * 137),
    date_modified: iso(100 + index * 11),
  };
});

/* ------------------------------------------------------- the filterable shop --- */

/**
 * Everything above this line is the catalogue as the products branch measured
 * it, and it cannot express a single one of the nine filters: every row carries
 * `tag_ids: []`, and the only attributes in the shop are the **local** ones
 * (`id: 0`) on the two variable products, which §82 says can never be filtered
 * or counted. A screen verified against that alone would have nine untested
 * controls and a facet sheet with nothing in it.
 *
 * So the shop gains a vocabulary and eleven more rows. The 28 above are left
 * exactly as they were — the eight with `stock_quantity: null`, the published
 * one with `price: ""`, the never-published draft with `slug: ""` and the
 * 60-character SKU are all measured, and a fixture that quietly repairs them is
 * a fixture that stops catching what they were written to catch.
 */

/** `/product-categories`. The first six are the ones the 28 carry (`10 + i % 6`). */
const CATEGORY_TREE = [
  [10, "Épicerie fine", 0],
  [11, "Miels et confitures", 10],
  [12, "Textile", 0],
  [13, "Tapis", 12],
  [14, "Poterie et cuivre", 0],
  [15, "Bijoux", 0],
  [16, "Cosmétique naturelle", 0],
];

/** The tag vocabulary. "Terroir" is on a draft only, so the facet omits it. */
const TAG_NAMES = [
  [401, "Nouveauté"],
  [402, "Pièce unique"],
  [403, "Cadeau"],
  [404, "Fait main"],
  [405, "Terroir"],
];

/**
 * The global attributes, and **`slug` is not `taxonomy`**. `/attributes/{id}`
 * and §88's routes take the slug; `?attributes[pa_matiere]=…` and the key of a
 * facet group are the taxonomy. Both are published here because confusing them
 * is the mistake the endpoint exists to prevent, and a mock that carried only
 * one of them would make the mistake unmakeable and therefore uncatchable.
 */
const ATTRIBUTES = [
  {
    id: 1,
    name: "Matière",
    slug: "matiere",
    taxonomy: "pa_matiere",
    type: "select",
    order_by: "menu_order",
    has_archives: false,
  },
  {
    id: 2,
    name: "Couleur",
    slug: "couleur",
    taxonomy: "pa_couleur",
    type: "select",
    order_by: "name",
    has_archives: true,
  },
];
const [MATIERE, COULEUR] = ATTRIBUTES;

/**
 * Six terms, and **"Cuir" is on no product at all** — the measurement
 * lib/products.ts is built on: the facet group reports five values and
 * `total_values: 5`, and this route is the only place the sixth exists.
 *
 * The slugs are written out rather than derived. WordPress's own sanitiser drops
 * an apostrophe instead of turning it into a separator, so the term is
 * `bois-dolivier` and not `bois-d-olivier` — which is the slug lib/products.ts
 * quotes, and a variation label resolved against the wrong one silently prints
 * the slug at a shopkeeper.
 */
const MATIERE_TERMS = [
  ["Laine", "laine"],
  ["Coton", "coton"],
  ["Argent", "argent"],
  ["Cuivre", "cuivre"],
  ["Bois d'olivier", "bois-dolivier"],
  ["Cuir", "cuir"],
];

/**
 * Sixty, so one group is genuinely past the API's cap of 50 and comes back
 * `truncated: true` with `total_values: 60`. A colour vocabulary is where a real
 * shop crosses that line — the schema's own measurement is of a 60-term
 * attribute — and three products below carry twenty each, which is how a
 * nuancier is actually stored: one product, every colour it comes in.
 */
const COULEUR_NAMES = [
  "Blanc", "Noir", "Gris", "Gris perle", "Anthracite", "Ivoire",
  "Écru", "Beige", "Sable", "Taupe", "Brun", "Marron",
  "Chocolat", "Café", "Caramel", "Ocre", "Terracotta", "Brique",
  "Rouge", "Rouge grenat", "Bordeaux", "Cerise", "Framboise", "Rose",
  "Rose poudré", "Fuchsia", "Magenta", "Violet", "Prune", "Lavande",
  "Mauve", "Indigo", "Bleu nuit", "Bleu marine", "Bleu roi", "Bleu ciel",
  "Turquoise", "Cyan", "Pétrole", "Sarcelle", "Vert", "Vert olive",
  "Vert sapin", "Vert amande", "Menthe", "Kaki", "Jaune", "Jaune paille",
  "Moutarde", "Safran", "Orange", "Abricot", "Corail", "Saumon",
  "Cuivre", "Bronze", "Or", "Argenté", "Nacre", "Pourpre",
];
const COULEUR_SLUGS = COULEUR_NAMES.map(slugify);

/**
 * An attribute as a *global* one travels on a product: `name` is the **taxonomy**
 * and `options` are term **slugs**. The local ones on the two variable products
 * above are the other half of that asymmetry — a label and free strings — and
 * lib/api/schemas/product.ts is explicit that a renderer has to know which it is
 * holding or it prints `pa_matiere` at a shopkeeper.
 */
const carries = (attribute, slugs, position) => ({
  id: attribute.id,
  name: attribute.taxonomy,
  options: slugs,
  visible: true,
  variation: false,
  position,
});

/**
 * A catalogue row written by hand rather than drawn from the PRNG, and that is
 * deliberate: a single `int()` call inserted before `CUSTOMERS` is built would
 * shift the one shared mulberry32 sequence and change every customer, every one
 * of the 633 orders and every variation quantity in this file. Written-out
 * values keep all of them byte-identical to what the earlier branches were
 * verified against.
 *
 * Every one of these manages stock, so the eight rows where `stock_quantity` is
 * null stay exactly the eight the inventory branch measured.
 */
function seeded({
  id,
  name,
  minutesAgo,
  status = "publish",
  regular,
  sale = "",
  quantity,
  featured = false,
  categories,
  tags = [],
  attributes = [],
  options,
  optionsProblems,
}) {
  const onSale = sale !== "";
  return {
    id,
    name,
    slug: status === "draft" ? "" : slugify(name),
    type: "simple",
    status,
    featured,
    catalog_visibility: "visible",
    sku: `AC-CAT-${String(id).padStart(4, "0")}`,
    description: `<p>${name} — sélection de la boutique.</p>`,
    short_description: `<p>${name}</p>`,
    // `price` is the effective figure: the sale price when there is one, which
    // is what the row prints, while `regular_price` is what the form edits.
    price: onSale ? sale : regular,
    regular_price: regular,
    sale_price: sale,
    on_sale: onSale,
    manage_stock: true,
    stock_quantity: quantity,
    stock_status: quantity > 0 ? "instock" : "outofstock",
    weight: "",
    category_ids: categories,
    tag_ids: tags,
    attributes,
    variations: [],
    image_id: 0,
    gallery_image_ids: [],
    image: null,
    gallery: [],
    permalink: `https://boutique.example.test/produit/${slugify(name)}`,
    seo: {
      title: name,
      description: `${name} — boutique artisanale.`,
      canonical: "",
      robots: {
        index: status === "publish",
        follow: true,
        directive: status === "publish" ? "index, follow" : "noindex, follow",
      },
      overrides: [],
    },
    date_created: iso(minutesAgo),
    date_modified: iso(Math.max(1, minutesAgo - 300)),
    /*
     * §83's keys are **absent** on a product with no option set — not null,
     * absent — which is why they are spread in rather than written out with a
     * default. The schema has all three optional for exactly this reason, and a
     * fixture that carried `options: null` on all 39 rows would make the
     * distinction untestable.
     */
    ...(options === undefined ? {} : { options }),
    ...(optionsProblems === undefined ? {} : { options_problems: optionsProblems }),
  };
}

/**
 * ── The one product with a broken option set ─────────────────────────────────
 *
 * Nothing in this shop carried `options`, `bundle` or `options_problems`, so the
 * detail's warning banner had no fixture to render from and the round trip it
 * warns about could not be reached at all.
 *
 * `options_problems` names the group by its **1-based position in the stored
 * document**, not by an id — measured verbatim, `"Option group 4 was dropped:
 * Must be one of: choice, text, bundle."` The position is all there is to go on
 * precisely because the broken group is *absent* from `options.groups`, so
 * nothing can link the warning to a row in an editor. Three readable groups plus
 * two unreadable ones is therefore a document of five: positions 4 and 5.
 *
 * The three that survive are one of each type, because the editor renders them
 * differently and a fixture with three `choice` groups would exercise a third of
 * it. A negative `price_delta` is on purpose — §83 allows one, and a control that
 * refuses it is a control nobody could have caught here.
 */
const BROKEN_OPTION_SET = {
  groups: [
    {
      id: "grp_gravure",
      type: "choice",
      label: "Gravure",
      required: false,
      position: 0,
      choices: [
        { id: "ch_none", label: "Sans gravure", price_delta: "0.00", image_id: 0 },
        { id: "ch_initiales", label: "Initiales", price_delta: "450.00", image_id: 0 },
        // Negative, and a real one: a discount for taking the undecorated piece.
        { id: "ch_brut", label: "Finition brute", price_delta: "-200.00", image_id: 0 },
      ],
    },
    {
      id: "grp_message",
      type: "text",
      label: "Message sur la carte",
      required: false,
      position: 1,
      max_length: 120,
    },
    {
      id: "grp_coffret",
      type: "bundle",
      label: "Coffret cadeau",
      required: false,
      position: 2,
      components: [{ product_id: 209, quantity: 1 }],
    },
  ],
};

const OPTION_PROBLEMS = [
  "Option group 4 was dropped: Must be one of: choice, text, bundle.",
  "Option group 5 was dropped: Must be one of: choice, text, bundle.",
];

/**
 * Three of the eleven are newer than the 28 and land at the head of the list;
 * the other eight are older and land at the tail.
 *
 * That split is arithmetic, not taste. The default order is date descending, a
 * page is 20 rows, and the 60-character SKU sits at index 14 of the 28 — the row
 * the 340px overflow assertion exists to catch. Three ahead of it puts it at 17
 * and still on page one; twelve would push it off, and the harness would go on
 * reporting a clean capture of a table that no longer contains the string that
 * used to break it.
 *
 * What the three buy in exchange is three states page one has never been
 * captured in: a struck-through sale price, a `pending` badge and a `private`
 * one. Every product above is published or draft and none is on sale.
 */
const NEW_ARRIVALS = [
  seeded({
    id: 201,
    name: "Chèche en coton, 20 coloris",
    minutesAgo: 400,
    regular: "1200.00",
    sale: "900.00",
    quantity: 18,
    categories: [12],
    tags: [401, 404],
    attributes: [carries(MATIERE, ["coton"], 0), carries(COULEUR, COULEUR_SLUGS.slice(0, 20), 1)],
  }),
  seeded({
    id: 202,
    name: "Coffret dégustation, édition limitée",
    minutesAgo: 900,
    status: "pending",
    regular: "5400.00",
    quantity: 4,
    categories: [10],
    tags: [402],
  }),
  seeded({
    id: 203,
    name: "Assortiment revendeurs, palette",
    minutesAgo: 1400,
    status: "private",
    regular: "15000.00",
    quantity: 20,
    categories: [10],
  }),
];

const BACK_CATALOGUE = [
  seeded({
    id: 204,
    name: "Caftan brodé, 20 coloris",
    minutesAgo: 5900,
    regular: "24000.00",
    quantity: 3,
    featured: true,
    categories: [12],
    tags: [402],
    attributes: [carries(MATIERE, ["coton"], 0), carries(COULEUR, COULEUR_SLUGS.slice(20, 40), 1)],
  }),
  seeded({
    id: 205,
    name: "Couverture en laine, 20 coloris",
    minutesAgo: 6120,
    regular: "8500.00",
    quantity: 6,
    categories: [12],
    tags: [404],
    attributes: [carries(MATIERE, ["laine"], 0), carries(COULEUR, COULEUR_SLUGS.slice(40, 60), 1)],
  }),
  seeded({
    id: 206,
    name: "Porte-clés en argent",
    minutesAgo: 6340,
    // The floor of the price band, so `min_price` and `max_price` have a real
    // spread to cut: 100 to 24 000, against the 400-to-9 000 of the 28.
    regular: "100.00",
    quantity: 40,
    categories: [15],
    tags: [403],
    attributes: [carries(MATIERE, ["argent"], 0)],
  }),
  seeded({
    id: 207,
    name: "Théière en cuivre martelé",
    minutesAgo: 6560,
    regular: "7800.00",
    sale: "6500.00",
    quantity: 0,
    categories: [14],
    tags: [404],
    attributes: [carries(MATIERE, ["cuivre"], 0)],
  }),
  seeded({
    id: 208,
    name: "Planche à découper en olivier",
    minutesAgo: 6780,
    regular: "3200.00",
    quantity: 9,
    categories: [14],
    tags: [401, 404],
    attributes: [carries(MATIERE, ["bois-dolivier"], 0)],
    // The only product in the shop with an option set, and its document is
    // broken — which is the state the detail's warning banner exists for.
    options: BROKEN_OPTION_SET,
    optionsProblems: OPTION_PROBLEMS,
  }),
  seeded({
    id: 209,
    name: "Savon d'Alep, lot de 3",
    minutesAgo: 7000,
    regular: "900.00",
    sale: "750.00",
    quantity: 25,
    categories: [16],
    tags: [401],
  }),
  seeded({
    id: 210,
    name: "Tapis kilim, 200 × 300",
    minutesAgo: 7220,
    status: "draft",
    regular: "18000.00",
    quantity: 1,
    categories: [13],
    // On a draft, so the facet counts neither the tag nor the matiere — the
    // scope note's whole sentence, in one row.
    tags: [405],
    attributes: [carries(MATIERE, ["laine"], 0)],
  }),
  seeded({
    id: 211,
    name: "Ancienne référence retirée",
    minutesAgo: 7440,
    status: "trash",
    regular: "2000.00",
    quantity: 0,
    categories: [10],
  }),
];

/**
 * The whole catalogue, newest first — which is the default order, and the order
 * `orderby=date&order=desc` therefore reproduces exactly.
 */
const CATALOGUE = [...NEW_ARRIVALS, ...PRODUCTS, ...BACK_CATALOGUE];

/**
 * What `/products` lists. A trashed product is **not** listed and still reads
 * back from `/products/{id}` with a 200 and `status: "trash"` — measured, and
 * the reason READABLE_STATUSES in lib/product-status.ts has an entry the filter
 * refuses. `?status=trash` is a 400, so there is no way to list it at all.
 */
const LISTED = CATALOGUE.filter((product) => product.status !== "trash");

/**
 * The `count` a vocabulary publishes is the **unfiltered** usage over published
 * products, and it is computed from the rows rather than written beside them: a
 * vocabulary whose counts disagree with the catalogue is precisely the quiet
 * wrongness this file exists not to produce, and the panel renders these numbers
 * next to the facet's.
 */
const usage = (predicate) =>
  LISTED.filter((product) => product.status === "publish" && predicate(product)).length;

const CATEGORIES = CATEGORY_TREE.map(([id, name, parent]) => ({
  id,
  name,
  slug: slugify(name),
  parent,
  description: "",
  count: usage((product) => product.category_ids.includes(id)),
}));

const TAGS = TAG_NAMES.map(([id, name]) => ({
  id,
  name,
  slug: slugify(name),
  count: usage((product) => product.tag_ids.includes(id)),
}));

const term = (taxonomy, base) => ([name, slug], index) => ({
  id: base + index,
  name,
  slug,
  description: "",
  menu_order: index,
  count: usage((product) =>
    product.attributes.some((a) => a.name === taxonomy && a.options.includes(slug)),
  ),
});

/** Keyed by taxonomy, because that is what a facet group and a filter both use. */
const TERMS = {
  pa_matiere: MATIERE_TERMS.map(term("pa_matiere", 1000)),
  pa_couleur: COULEUR_NAMES.map((name, i) => [name, COULEUR_SLUGS[i]]).map(
    term("pa_couleur", 1100),
  ),
};

/* --------------------------------------------------------------- customers --- */

/**
 * Sixteen, and twelve of them have no name at all — measured. A row's identity
 * is not `first_name`, and a fixture set where everybody is called something
 * would let a screen ship that assumes otherwise.
 */
const NAMED_CUSTOMERS = {
  0: ["Yacine", "Benali"],
  1: ["فاطمة", "الزهراء"],
  2: ["Abdelkrim-Mohammed-El-Hadj", "Benyoucef-Bouchentouf-Belkacemi"],
  3: ["أحمد ORDER-2026-AC-1187", "بن يوسف"],
};

/** A shipping address is a billing address with the email key removed, not nulled. */
function withoutEmail(address) {
  const copy = { ...address };
  delete copy.email;
  return copy;
}

/**
 * The two addresses that are not `client{id}@example.test`, and both are there to
 * be *matched* rather than to be read.
 *
 *   5  the 80-character unbroken address the 340px overflow assertion needs.
 *   6  **the accent trap.** `?search=Chérif` looks like a name search that works
 *      and is not: MySQL's collation is accent-insensitive, so the folded term
 *      matches the *email* `nadia.cherif@…` — on a customer who has no name at
 *      all, so the row it returns is titled `client26`. lib/customers.ts:45-60
 *      records the measurement, and without an address like this the folded
 *      search below would have nothing to prove and nothing to catch.
 */
const SPECIAL_EMAILS = { 5: LONG_EMAIL, 6: "nadia.cherif@example.test" };

/**
 * ── Consent has four payload states and the fixtures carried one ─────────────
 *
 * `marketing_consent_at` is the only reliable signal that a decision exists.
 * `consentRecord()` in lib/customers.ts reads the date first and calls a null one
 * `never`, whatever the flag beside it says — so a **withdrawal is a `false` with
 * a non-null date**, and it is a different answer from the fourteen rows carrying
 * `false` and null. "They said no" against "we never asked" is the distinction
 * the row exists for, and it was the one this file could not produce.
 *
 *   0  granted    true  + a date + `registration`      a source the panel labels
 *   2  granted    true  + a date + `seed`              a source it has no label for
 *   4  withdrawn  false + a date + `unsubscribe_link`  the second negative
 *   …  never      false + null   + null                the other fourteen
 *
 * The withdrawal is on index 4 — customer 24 — rather than on a quiet row, and
 * that is a capture decision: 24 is the one customer `scripts/capture.mjs` takes
 * by default, so putting the state that was entirely unreachable on the row that
 * is actually photographed is the difference between it being reachable and it
 * being seen. The other two are states rather than screens; capture.mjs names how
 * to reach them.
 *
 * **`"seed"` is the exact string that blanked the customer screen**, and it is
 * here for that reason rather than for variety. lib/api/schemas/customer.ts:54-69
 * is the whole story: `marketing_consent_source` was `z.enum([...])`,
 * `Consent::set()` stores whatever string it is handed with no validation of any
 * kind, the campaigns seed passed `"seed"`, and `GET /customers/{id}` then failed
 * to parse *on the server* — the entire detail rendered as "This page couldn't
 * load" over one label on one row. A fixture set whose every source sits inside
 * the convention is a fixture set that would let that enum come back unnoticed.
 *
 * The fourth state lib/customers.ts names — *declined*, "a source but no grant" —
 * is **deliberately absent**, and see the test: `consentRecord()` cannot express
 * it. It keys on the date, so a source with a null date returns `never` and the
 * two are indistinguishable downstream. Inventing a payload the API has not been
 * seen to produce, to reach a state the panel cannot tell apart anyway, would be
 * this file manufacturing a screen state rather than reproducing one.
 */
const CONSENT_RECORDS = {
  0: { granted: true, minutesAgo: 9000, source: "registration" },
  2: { granted: true, minutesAgo: 12_000, source: "seed" },
  4: { granted: false, minutesAgo: 4000, source: "unsubscribe_link" },
};

const SEEDED_CUSTOMERS = Array.from({ length: 16 }, (_, index) => {
  const id = 20 + index;
  const [first, last] = NAMED_CUSTOMERS[index] ?? ["", ""];
  const wilaya = WILAYAS[int(0, WILAYAS.length - 1)];
  const email = SPECIAL_EMAILS[index] ?? `client${id}@example.test`;

  const billing = {
    first_name: first,
    last_name: last,
    company: "",
    address_1: `${int(1, 180)} rue des Frères Bouadou`,
    address_2: "",
    city: wilaya.name,
    state: wilaya.code,
    postcode: `${wilaya.code}000`,
    country: "DZ",
    phone: `0${int(5, 7)}${String(int(10_000_000, 99_999_999))}`,
    email,
  };

  const consent = CONSENT_RECORDS[index];

  return {
    id,
    username: `client${id}`,
    email,
    first_name: first,
    last_name: last,
    role: "customer",
    // The five who have ordered are the five `CUSTOMER_ORDER_PLAN` hands orders
    // to below, and the five the statistics block therefore reports on.
    is_paying_customer: index < 5,
    marketing_consent: consent?.granted ?? false,
    marketing_consent_at: consent === undefined ? null : iso(consent.minutesAgo),
    marketing_consent_source: consent?.source ?? null,
    billing,
    // Shipping carries no email — WooCommerce stores none — so the key is
    // *absent* rather than present and empty. `email` is optional on the address
    // schema precisely because the two addresses differ by it.
    shipping: withoutEmail(billing),
    date_created: iso(40_000 + index * 700),
    date_modified: index % 3 === 0 ? null : iso(500 + index * 30),
  };
});

/**
 * ── The seventeenth customer, and the only one written out by hand ───────────
 *
 * **This is the positive control, reproduced.** lib/customers.ts:45-60 records
 * how `?search=` was pinned down on 2026-08-19: customer 26 was given the names
 * `Zqxwvu Plmokn` — a string that appears in no login and no email anywhere in
 * the shop — and `?search=Zqxwvu` returned **0 rows** while `?search=cus_fresh`,
 * its login, returned 1. Without a row like this in the fixture set the claim
 * "search does not match a name" is unfalsifiable here: every other name in this
 * shop is also a substring of something the search *does* match, or is Arabic.
 *
 * Written out rather than drawn from the `Array.from` above, and that is
 * load-bearing for the same reason `seeded()` is on the catalogue: each of those
 * sixteen rows makes four `int()` draws into the one shared mulberry32, so a
 * seventeenth pass would shift the sequence and change `statusColumn` — and with
 * it which order is `completed`, which is what half this file's fixture ids mean.
 *
 * It has ordered nothing and decided nothing about consent, so it lands in the
 * two common cases and adds a row to neither of the interesting ones.
 */
const CONTROL_CUSTOMER = (() => {
  const wilaya = WILAYAS[15]; // Alger
  const email = "client36@example.test";
  const billing = {
    first_name: "Zqxwvu",
    last_name: "Plmokn",
    company: "",
    address_1: "12 rue des Frères Bouadou",
    address_2: "",
    city: wilaya.name,
    state: wilaya.code,
    postcode: `${wilaya.code}000`,
    country: "DZ",
    phone: "0551000036",
    email,
  };

  return {
    id: 36,
    username: "client36",
    email,
    first_name: "Zqxwvu",
    last_name: "Plmokn",
    role: "customer",
    is_paying_customer: false,
    marketing_consent: false,
    marketing_consent_at: null,
    marketing_consent_source: null,
    billing,
    shipping: withoutEmail(billing),
    date_created: iso(52_000),
    date_modified: null,
  };
})();

const CUSTOMERS = [...SEEDED_CUSTOMERS, CONTROL_CUSTOMER];

const ORDER_STATUSES = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
];

/* ----------------------------------------------------------------- orders --- */

/**
 * 633, with the status distribution measured against the live order book —
 * pending 204, processing 63, completed 35, cancelled 266, refunded 63, failed 1,
 * on-hold 1. It is written out rather than generated because it is the reason
 * `SEGMENT_STATUSES` in lib/order-status.ts has three entries and not seven: a
 * uniform distribution would make that decision look arbitrary.
 */
const STATUS_PLAN = [
  ["pending", 204],
  ["processing", 63],
  ["on-hold", 1],
  ["completed", 35],
  ["cancelled", 266],
  ["refunded", 63],
  ["failed", 1],
];

const ORDER_COUNT = 633;
const GUEST_ORDERS = 288;
const EMPTY_LINE_ITEM_ORDERS = 45;
const ORDERS_WITHOUT_WILAYA = 582; // ~92 %

const statusColumn = shuffled(
  STATUS_PLAN.flatMap(([status, count]) => Array.from({ length: count }, () => status)),
);
const guestColumn = shuffled(
  Array.from({ length: ORDER_COUNT }, (_, i) => i < GUEST_ORDERS),
);
const emptyItemsColumn = shuffled(
  Array.from({ length: ORDER_COUNT }, (_, i) => i < EMPTY_LINE_ITEM_ORDERS),
);
const noWilayaColumn = shuffled(
  Array.from({ length: ORDER_COUNT }, (_, i) => i < ORDERS_WITHOUT_WILAYA),
);

/**
 * ── Who owns which order, and why most of them belong to nobody listed ───────
 *
 * `customer_id` used to be `CUSTOMERS[index % 16].id`, which gave each of the
 * sixteen roughly twenty-one orders — and the statistics block beside it reported
 * two to six, because it was written out independently. **The two collections
 * contradicted each other about the same person**, and nothing could see it until
 * `GET /customers/{id}/orders` existed: the detail would have printed
 * "Total orders 6" over a list of twenty-one.
 *
 * So ownership is stated once, here, and the statistics are *derived* from it
 * below. A customer's orders and their report cannot disagree because there is
 * only one of them.
 *
 * **The arithmetic forces the rest.** 288 of the 633 are guests and eleven of the
 * seventeen customers have never ordered — both measured — so the five who have
 * cannot absorb 345 orders between them without making one of those two numbers
 * false. The remainder therefore belongs to customer ids the collection does not
 * list: `GET /customers/{id}` is a 404 on all of them, which is the same answer
 * the administrator's own id gets, because the repository filters on
 * `role: customer`. ADMIN_PANEL.md:171 has the other half of it — an HPOS order
 * keyed to a deleted `customer_id` becomes an orphan no report can attribute.
 * That is an inference from two measurements rather than a measurement; it is
 * written here so the next reader argues with the reasoning rather than the code.
 *
 * The plan is **by status**, not by count, because the status breakdown is the
 * point: `by_status` must sum to `total_orders` and it is the block that explains
 * why revenue counts fewer orders than the customer placed. Customer 24 carries
 * six of the seven statuses for that reason — `failed` is missing because the
 * shop's one failed order is a guest's, and taking it would put the guest count
 * off by one.
 */
const CUSTOMER_ORDER_PLAN = [
  [20, ["completed", "pending"]],
  [21, ["completed", "cancelled", "pending"]],
  [22, ["completed", "completed", "processing", "cancelled"]],
  [23, ["completed", "pending", "processing", "cancelled", "refunded"]],
  [24, ["completed", "completed", "pending", "processing", "on-hold", "cancelled", "refunded"]],
];

/** How many unlisted accounts the remaining non-guest orders are spread over. */
const ORPHAN_ACCOUNTS = 40;
const ORPHAN_BASE = 900;

/**
 * Order index → the id that owns it. `0` is a guest, and stays exactly the 288
 * `guestColumn` chose.
 *
 * No `rand()` here and none below it: the plan is satisfied by walking the
 * already-shuffled status column in order, so this adds nothing to the one shared
 * mulberry32 and every collection above stays byte-identical.
 */
const ownerColumn = (() => {
  const owners = Array.from({ length: ORDER_COUNT }, () => 0);

  for (const [customerId, plan] of CUSTOMER_ORDER_PLAN) {
    for (const status of plan) {
      const index = statusColumn.findIndex(
        (value, i) => value === status && !guestColumn[i] && owners[i] === 0,
      );
      // Loudly, at module load. A plan that has quietly become unsatisfiable —
      // one more `completed` than the book holds — would otherwise show up as a
      // customer whose breakdown is one row short of what this file claims.
      if (index === -1) {
        throw new Error(`No unclaimed ${status} order left for customer ${customerId}.`);
      }
      owners[index] = customerId;
    }
  }

  let orphan = 0;
  for (let index = 0; index < ORDER_COUNT; index += 1) {
    if (guestColumn[index] || owners[index] !== 0) continue;
    owners[index] = ORPHAN_BASE + (orphan++ % ORPHAN_ACCOUNTS);
  }
  return owners;
})();

/**
 * The names a shopkeeper actually sees, including the three that break layouts:
 * a very long unbroken one, Arabic ones, and one with an LTR run inside Arabic
 * text — which is where a bidi bug reverses an order number.
 */
const ORDER_NAMES = [
  ["Yacine", "Benali"],
  ["Abdelkrim-Mohammed-El-Hadj", "Benyoucef-Bouchentouf-Belkacemi"],
  ["فاطمة", "الزهراء"],
  ["أحمد AC-2026-1187", "بن يوسف"],
  ["Sofiane", "Haddad"],
  ["Nadia", "Cherifi"],
  ["محمد", "بن علي"],
  ["Karim", "Boudjelal"],
  ["Amina", "Zerrouki"],
  ["Rachid", "Ould Kaddour"],
];

const ORDERS = Array.from({ length: ORDER_COUNT }, (_, index) => {
  const id = 1000 + index;
  const status = statusColumn[index];
  const [first, last] = ORDER_NAMES[index % ORDER_NAMES.length];
  const wilaya = WILAYAS[int(0, WILAYAS.length - 1)];
  const product = PRODUCTS[int(0, PRODUCTS.length - 1)];

  const lineItems = emptyItemsColumn[index]
    ? []
    : Array.from({ length: int(1, 3) }, (_, line) => {
        const item = line === 0 ? product : PRODUCTS[int(0, PRODUCTS.length - 1)];
        const quantity = int(1, 4);
        const unit = item.price === "" ? "0.00" : item.price;
        const total = (Number.parseFloat(unit) * quantity).toFixed(2);
        return {
          id: id * 10 + line,
          name: item.name,
          product_id: item.id,
          variation_id: 0,
          quantity,
          // One order in ten carries the 60-character SKU, so a line-item table
          // has an overflow case at every width the harness captures.
          sku: index % 10 === 3 ? LONG_SKU : item.sku,
          subtotal: total,
          total,
        };
      });

  const subtotal = lineItems
    .reduce((sum, item) => sum + Number.parseFloat(item.total), 0)
    .toFixed(2);
  const shippingTotal = `${int(3, 8) * 100}.00`;
  const total = (Number.parseFloat(subtotal) + Number.parseFloat(shippingTotal)).toFixed(2);

  const billing = {
    first_name: first,
    last_name: last,
    company: "",
    address_1: `${int(1, 180)} rue des Frères Bouadou`,
    address_2: "",
    city: wilaya.name,
    // Empty on ~92 % of orders — the shop's own data, and the reason a wilaya
    // column cannot be assumed to have anything in it.
    state: noWilayaColumn[index] ? "" : wilaya.code,
    postcode: "",
    country: "DZ",
    phone: `0${int(5, 7)}${String(int(10_000_000, 99_999_999))}`,
    email: index % 47 === 0 ? LONG_EMAIL : `client${id}@example.test`,
  };

  const shipping = withoutEmail(billing);

  const paid = status === "completed" || status === "processing" || status === "refunded";

  return {
    id,
    number: String(id),
    status,
    currency: "DZD",
    customer_id: ownerColumn[index],
    customer_note: index % 23 === 0 ? "Livrer après 17 h, merci." : "",
    payment_method: "cod",
    payment_method_title: "Paiement à la livraison",
    billing,
    shipping,
    line_items: lineItems,
    discount_total: "0.00",
    shipping_total: shippingTotal,
    total_tax: "0.00",
    subtotal,
    total,
    is_editable: status === "pending" || status === "on-hold",
    needs_payment: !paid && status !== "cancelled" && status !== "failed",
    stock_reduced: paid,
    date_created: iso(index * 43),
    date_modified: iso(index * 43 - 5),
    date_paid: paid ? iso(index * 43 - 10) : null,
    date_completed: status === "completed" ? iso(index * 43 - 20) : null,
  };
});

/**
 * One customer's orders as the **seeds** hold them, newest first — which is the
 * order the book itself is in. `ordersOf()` further down is the same list read
 * through anything a PATCH has written; this one is what the notification queue
 * is built from, because a queued message is frozen at the moment it was queued
 * and does not follow the order it was about.
 */
const seededOrdersOf = (customerId) =>
  ORDERS.filter((order) => order.customer_id === customerId);

/* ---------------------------------------------------------- notifications --- */

/**
 * ── The queue, and the error state it was rendering instead ──────────────────
 *
 * `GET /notifications` was absent entirely, so the customer detail's
 * notifications section rendered its **error state in every capture** — a screen
 * state produced by the harness rather than caught by it, and the most expensive
 * kind of green run: the section looked deliberate.
 *
 * Four measurements from lib/notifications.ts shape the rows, and each one is a
 * thing the screen would otherwise never be held against:
 *
 *   **`status` is three values and the screen shows four.** `queueState()`
 *   derives them from three fields, because a *retryable* failure leaves the row
 *   `pending` with `attempts: 1` and an error on it — which reads as "never
 *   touched" to anything looking at `status` alone. So these cycle through all
 *   four states and the section's summary strip has something to count.
 *
 *   **18 of the 39 measured rows were `admin`** — the shop being told it had an
 *   order, not a customer being confirmed. The customer section filters on
 *   `recipient`, so those are correctly *absent* from it, and its footnote says
 *   so; without admin rows in the fixture set that footnote is unverifiable.
 *
 *   **`recipient` is whatever the channel addresses**, and the API does not
 *   validate it as an email. The one `sms` row carries a phone number, exactly as
 *   `seed-notifications.mjs` writes it, so a screen that formatted this as mail
 *   would be visible here.
 *
 *   **`subject_id` is nullable and never 0.** One row carries null rather than a
 *   zero standing in for it.
 *
 * `last_error` is one of the three sentences *this codebase* writes rather than
 * anything a transport said — `EmailChannel` only ever sees `wp_mail()` return a
 * boolean, and lib/api/schemas/notification.ts:61-75 records that the field's own
 * docblock on the backend is wrong about it.
 *
 * **The one inference in this block**: the subjectless row's `dedupe_key`. The key
 * is `event:subject_id` by construction and nobody measured what the right half
 * is when there is no subject, so it is the event alone. Flagged rather than
 * presented as measured.
 */
const NOTIFICATION_STATES = [
  { status: "sent", attempts: 1, error: null, sent: true },
  // Never attempted: `queued`, and the only state whose `attempts` is 0.
  { status: "pending", attempts: 0, error: null, sent: false },
  // Still pending, but tried — `retrying`, the state `status` alone hides.
  {
    status: "pending",
    attempts: 1,
    error: "wp_mail() did not accept the message.",
    sent: false,
  },
  // Parked: a permanent refusal rather than five attempts.
  {
    status: "failed",
    attempts: 5,
    error: "Not a deliverable email address.",
    sent: false,
  },
];

const NOTIFICATIONS = (() => {
  const rows = [];

  const push = ({ channel, event, audience, recipient, order, slot }) => {
    const state = NOTIFICATION_STATES[slot % NOTIFICATION_STATES.length];
    rows.push({
      id: 4100 + rows.length,
      channel,
      event,
      dedupe_key: order === null ? event : `${event}:${order.id}`,
      audience,
      recipient,
      subject_type: order === null ? "" : "order",
      subject_id: order === null ? null : order.id,
      status: state.status,
      attempts: state.attempts,
      last_error: state.error,
      // A notification about an order is queued when the order is placed, so the
      // two stamps agree rather than being a second timeline on one screen. Both
      // carry `+00:00` — `gmdate('c')` — unlike an order note's, which has none.
      created_at: order === null ? iso(120) : order.date_created,
      sent_at: state.sent ? (order === null ? iso(118) : order.date_modified) : null,
    });
  };

  let slot = 0;
  for (const [customerId] of CUSTOMER_ORDER_PLAN) {
    const customer = CUSTOMERS.find((row) => row.id === customerId);
    for (const order of seededOrdersOf(customerId)) {
      push({
        channel: "email",
        event: "order.placed",
        audience: "customer",
        recipient: customer.email,
        order,
        slot: slot++,
      });
      // The shop's own alert about the same order, addressed to the shop. Not in
      // the customer's section, by construction, and that is the point of it.
      push({
        channel: "email",
        event: "admin.new_order",
        audience: "admin",
        recipient: "admin@example.test",
        order,
        slot: slot++,
      });
    }
  }

  // The second channel, addressed to a phone rather than to a mailbox.
  push({
    channel: "sms",
    event: "shipment.shipped",
    audience: "customer",
    recipient: "+213551000024",
    order: seededOrdersOf(24)[0],
    slot: slot++,
  });

  // The row with no subject at all.
  push({
    channel: "email",
    event: "stock.low",
    audience: "admin",
    recipient: "admin@example.test",
    order: null,
    slot: slot++,
  });

  /*
   * `created_at DESC, id DESC`, fixed. `NotificationRepository::search()` orders
   * it and nothing can change it: measured, `?orderby=channel`, `?orderby=id`
   * and `?order=asc` all return the identical first six ids, and
   * `?orderby=nonsense` is a 200 — the parameter is not even validated. The
   * opposite of the drain, which sends oldest first.
   */
  return [...rows].sort(
    (a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id),
  );
})();

/* ------------------------------------------------------------- variations --- */

/**
 * The five variation bodies behind `GET /products/{id}/variations`, and the one
 * place their stock figures exist.
 *
 * **`attributes` is an object here where the parent's is an array** — `{"taille":
 * "s"}` against `[{name: "Taille", options: ["S","M","L"]}]` — and the values are
 * lowercased slugs of the parent's options. lib/api/schemas/product.ts says so
 * and `variationLabel()` in lib/products.ts is the repair: printing the stored
 * value puts a lowercase `s` in front of a shopkeeper.
 *
 * Two rows carry an absence rather than a value, and both are measured states a
 * screen has to render:
 *
 *   `sku: ""`             slot 0 of each parent — a variation need carry no SKU
 *                         of its own, and inherits the parent's.
 *   `stock_quantity: null` 9032 alone, because it does not manage its own stock;
 *                         its parent does, which is what the inventory row's
 *                         `stock_managed_by_id` is for.
 *
 * The prices are a spread rather than one figure repeated: `priceSpan()` returns
 * **null** when every price is equal, so a fixture of identical prices leaves the
 * detail's price-range state uncapturable. The floor is the parent's own `price`,
 * which is the resolved figure a variable product reports.
 *
 * **The five `int()` draws happen here rather than in the inventory rows below,
 * and that is load-bearing.** Drawing them in this order at this point keeps
 * every collection above byte-identical to what the earlier branches were
 * verified against.
 *
 * They used to be the *last* five calls into the one shared mulberry32. The
 * movements ledger below now draws after them and nothing else in this file
 * does, which is why it is built where it is: anywhere earlier and it would
 * shift the sequence under every customer, all 633 orders and these five
 * quantities. A new fixture that needs the PRNG goes **after** the ledger, not
 * before it.
 */
const INHERITED_STOCK_VARIATION = 9032;

const VARIATIONS = [...VARIATION_COUNTS.keys()].flatMap((parentIndex) => {
  const parent = PRODUCTS[parentIndex];
  const [attribute] = parent.attributes;

  return parent.variations.map((id, slot) => {
    const drawn = int(0, 25);
    const managed = id !== INHERITED_STOCK_VARIATION;
    const regular = (Number.parseFloat(parent.price) + slot * 200).toFixed(2);

    return {
      id,
      parent_id: parent.id,
      sku: slot === 0 ? "" : `${parent.sku}-${slot + 1}`,
      status: "publish",
      description: "",
      price: regular,
      regular_price: regular,
      sale_price: "",
      on_sale: false,
      manage_stock: managed,
      stock_quantity: managed ? drawn : null,
      stock_status: managed ? (drawn > 0 ? "instock" : "outofstock") : parent.stock_status,
      weight: "",
      attributes: { [slugify(attribute.name)]: slugify(attribute.options[slot]) },
      image_id: 0,
      image: null,
      date_created: parent.date_created,
      date_modified: parent.date_modified,
    };
  });
});

/**
 * The five variation bodies as they read **now**.
 *
 * `POST /inventory/{id}/adjust` moves a variation's shelf and `PATCH
 * /inventory/{id}` changes whether it has one, so these are read through the
 * write state for the same reason `catalogue()` is: a variations table and a
 * stock row that disagreed about the same shelf would be two screens
 * contradicting each other, which is the quiet wrongness this file exists not to
 * produce.
 */
const variationRows = () => VARIATIONS.map((row) => state.variations.get(row.id) ?? row);

const variationsOf = (product) =>
  variationRows().filter((variation) => variation.parent_id === product.id);

/* -------------------------------------------------------------- inventory --- */

/**
 * WooCommerce's store-wide low-stock threshold — the number a row falls back to
 * when its own `low_stock_amount` is cleared.
 *
 * `PATCH /inventory/{id} {low_stock_amount: null}` therefore reads back as this
 * figure and **never as null**: `wc_get_low_stock_amount()` resolves the global
 * default and the presenter publishes the *effective* threshold, which is the
 * one the row's quantity is actually judged against. A mock that echoed the null
 * back would let a screen render an empty field where the shop shows a number.
 */
const STORE_LOW_STOCK_AMOUNT = 2;

/**
 * Every listed product plus the 5 variations the two variable products carry.
 * A trashed product is not in stock anywhere and is not here either, which is
 * the same rule `/products` lists by. `low_stock_amount` is **per product** — 2
 * on all but one, 5 on "Miel de jujubier" — so there is no shop-wide threshold
 * to display anywhere; it is keyed on that product rather than on a row index
 * so it stays on it as the catalogue grows around it.
 *
 * Computed per request rather than at load, because `/products` writes: a PATCH
 * that changes a stock figure and an inventory row that went on reporting the
 * seeded one would be two screens contradicting each other about the same shelf.
 */
function inventoryRows() {
  return [
    ...listed().map((product) => {
      const threshold = product.id === PRODUCTS[0].id ? 5 : 2;
      return {
        id: product.id,
        parent_id: 0,
        type: product.type,
        name: product.name,
        sku: product.sku,
        manage_stock: product.manage_stock,
        managing_stock: product.manage_stock,
        stock_managed_by_id: product.id,
        stock_quantity: product.stock_quantity,
        stock_status: product.stock_status,
        backorders: "no",
        low_stock_amount: threshold,
        low_stock: product.stock_quantity !== null && product.stock_quantity <= threshold,
      };
    }),
    ...variationRows().map((variation) => {
      const parent = productById(variation.parent_id);
      const slot = parent.variations.indexOf(variation.id);
      // A variation that manages no stock of its own is stocked *by its parent*,
      // and both fields say so — which is the whole reason a row carries
      // `managing_stock` beside `manage_stock` and an id beside both.
      const quantity = variation.manage_stock
        ? variation.stock_quantity
        : parent.stock_quantity;
      /*
       * ── The one row that reports the string ──────────────────────────────
       *
       * `manage_stock` is `true`, `false`, or the **string `"parent"`** for a
       * variation inheriting its parent's shelf — `z.union([z.boolean(),
       * z.literal("parent")])` in lib/api/schemas/inventory.ts, and until now no
       * fixture in this file had ever produced the third case, so that branch of
       * the union had never been parsed from this mock at all.
       *
       * It is emitted **here and not on the variation body**: the product
       * schema's `variation.manage_stock` is a plain `z.boolean()`, because
       * `/products/{id}/variations` is WooCommerce's own payload while this is
       * `InventoryPresenter`'s. Publishing the string on both would make the
       * variations table fail at the panel's boundary against a shape the real
       * API never sends.
       *
       * `managing_stock` stays `false` beside it, which is the pair the schema's
       * docblock describes: the raw value and the plain yes/no disagreeing on
       * purpose. `canAdjust()` reads the second and refuses the row.
       */
      const inherits = !variation.manage_stock && variation.id === INHERITED_STOCK_VARIATION;
      return {
        id: variation.id,
        parent_id: parent.id,
        type: "variation",
        name: `${parent.name} — ${parent.attributes[0].options[slot]}`,
        // `""` is possible: a variation need carry no SKU of its own, and the
        // row must render without inventing the parent's.
        sku: variation.sku,
        manage_stock: inherits ? "parent" : variation.manage_stock,
        managing_stock: variation.manage_stock,
        stock_managed_by_id: variation.manage_stock ? variation.id : parent.id,
        stock_quantity: quantity,
        stock_status: variation.stock_status,
        backorders: slot === 0 ? "notify" : "no",
        low_stock_amount: 2,
        low_stock: quantity !== null && quantity <= 2,
      };
    }),
  ].map(withStockSettings);
}

/**
 * The two fields `PATCH /inventory/{id}` owns that exist nowhere else in this
 * file: a product row carries no `backorders` and no threshold of its own, so
 * both are computed by `inventoryRows()` above and a write to either has to live
 * beside the row rather than in it.
 *
 * `low_stock` is recomputed rather than carried over, because it is derived from
 * the very number a write to `low_stock_amount` changes — a row reporting a
 * threshold of 40 and `low_stock: false` over a quantity of 25 would be a row
 * arguing with itself.
 */
function withStockSettings(row) {
  const written = state.stockSettings.get(row.id);
  if (written === undefined) return row;
  const next = { ...row, ...written };
  next.low_stock = next.stock_quantity !== null && next.stock_quantity <= next.low_stock_amount;
  return next;
}

/* ------------------------------------------------------------- the ledger --- */

/**
 * ── A ledger is an archive and a catalogue is not ────────────────────────────
 *
 * **Most of the ledger's `product_id`s do not exist in `/inventory`, and that is
 * the single most load-bearing fact about this collection.** Measured: 1154
 * movements name **155 distinct product ids and only 23 of them appear in
 * `/inventory` at all** — the rest were created and deleted by the backend's own
 * fixture suites, and the rows they moved stayed, because a stock ledger that
 * forgot a movement when its product was deleted would no longer be a ledger.
 *
 * That is what makes tapping a row a real path to a 404, which is why
 * `app/[locale]/(panel)/inventory/[id]/not-found.tsx` is a built screen rather
 * than a defensive branch nobody has seen. A fixture set whose every movement
 * resolved would leave that screen unreachable and the row's refusal to invent a
 * name looking like laziness.
 *
 * The 23 are written out rather than sliced off `inventoryRows()`, on the same
 * rule as the two refusal tables in this file: a literal that stops matching
 * fails a test, while a `slice()` moves quietly and takes the meaning with it.
 * They are all rows that manage their own stock, so `?product_id=` on any of
 * them is a filter with something behind it.
 */
const LEDGER_CATALOGUE_IDS = [
  101, 102, 104, 105, 107, 108, 109, 111, 112, 113, 115, 116,
  117, 119, 120, 122, 123, 124, 126, 127, 201, 207, 9030,
];

/** The deleted ones. 3000–3131 collides with no id anywhere else in this file. */
const LEDGER_ARCHIVE_BASE = 3000;
const LEDGER_ARCHIVE_COUNT = 132;

const LEDGER_PRODUCT_IDS = [
  ...LEDGER_CATALOGUE_IDS,
  ...Array.from({ length: LEDGER_ARCHIVE_COUNT }, (_, i) => LEDGER_ARCHIVE_BASE + i),
];

const MOVEMENT_COUNT = 1154;

/** Above every other id in this file, and descending with age: the newest row
    is `61154` and the oldest is `60001`, so an id sorts the way the list does. */
const MOVEMENT_ID_BASE = 60_000;

/**
 * ── The distribution, which is the point of not generating a uniform one ─────
 *
 * A ledger with the same number of rows under each of nine reasons would make
 * every decision the screen makes look arbitrary. Measured 2026-08-18:
 *
 *   order_reduced    480 of 1154 — the commonest row by far, which is why
 *                    `REASON_TONE` marks it `neutral`: tinting the shop working
 *                    correctly in red leaves nothing to notice `damage` by
 *   correction       166, and −1540 net over them
 *   customer_return  **0**, and `other` **0** — both are reasons a person may
 *                    write and neither has ever been written here, which is
 *                    exactly why `/movements/summary` omits them and why the
 *                    panel's legend is built from `ALL_REASONS` instead
 *
 * The other four are shaped rather than measured — nothing published a figure
 * for `restock`, `damage`, `loss` or `product_edit` — and they are chosen to sum
 * to 1154 with the two that were. Flagged rather than presented as measurement.
 *
 * **`order_reduced` + `order_restored` is 692, which is the measured count of
 * rows carrying `order_id > 0`, and that is not a coincidence to tidy away.** An
 * order id is on an order-driven row and on nothing else, which is what makes
 * `movementActor()`'s first branch — *an order did this, and here is its number*
 * — cover exactly those 692 rows and no others.
 */
const REASON_PLAN = [
  ["order_reduced", 480],
  ["order_restored", 212],
  ["correction", 166],
  ["product_edit", 130],
  ["restock", 96],
  ["damage", 40],
  ["loss", 30],
];

/** The two the shop writes from an order, and the only two carrying an order id. */
const LEDGER_ORDER_REASONS = ["order_reduced", "order_restored"];

/**
 * Which way a reason moves the shelf. `correction` and `product_edit` are absent
 * because they genuinely go both ways — a correction is as often a phantom unit
 * removed as one found — and the sign is drawn for them instead.
 */
const MOVEMENT_SIGN = {
  order_reduced: -1,
  order_restored: 1,
  restock: 1,
  damage: -1,
  loss: -1,
};

/**
 * **16 rows carry the harness identity's own id**, which is what makes the
 * ledger's "mine only" filter a filter with something behind it: `?actor_id=` is
 * the one identity pivot the panel can honestly offer, because a movement's
 * actor cannot be resolved to a *name* by three of the four roles that can read
 * the ledger (lib/inventory.ts:127-158 has the table).
 *
 * The 16 is lib/inventory.ts's figure. ADMIN_PANEL.md:1795 says 17 for the same
 * measurement; the two disagree by one and nothing here can settle it, so the
 * panel's own file wins and the disagreement is written down rather than picked
 * silently.
 *
 * They land only on rows a *person* wrote. An order-driven row's `actor_id` is
 * whoever happened to be signed in when the status changed — for a storefront
 * checkout, the customer — so putting the reader's own id on one would make
 * "my movements" return rows they had nothing to do with.
 */
const MINE_MOVEMENTS = 16;

/**
 * `actor_id: 0` — what the ledger stores when no user was signed in at all: a
 * CLI import, a cron-driven restock, a guest checkout. `movementActor()` renders
 * it as *unknown*, which is a fourth answer and not a missing one.
 */
const ANONYMOUS_MOVEMENTS = 120;

/** Other staff accounts. `movementActor()` renders any of these as *a colleague*. */
const COLLEAGUE_ACTORS = [470, 475, 488];

/**
 * **1140 of the 1154 rows carry `note: ""`.** Measured, and it is the reason the
 * ledger row cannot be laid out around a note: a list that reserved a line for
 * one would be 99 % whitespace.
 *
 * Fourteen carry one, including a long unbroken French sentence, so the 340px
 * overflow assertion has something to catch on this collection too.
 */
const MOVEMENT_NOTES = [
  "Inventaire trimestriel, écart constaté en rayon.",
  "Carton reçu du fournisseur, deux pièces cassées.",
  "Retour client, article remis en stock.",
  "Erreur de saisie corrigée après vérification physique.",
  "Casse pendant le transport.",
  "Réajustement après inventaire tournant du dépôt de Rouiba, comptage contradictoire effectué par deux préparateurs et validé par le responsable.",
  "Perte constatée, dossier ouvert.",
  "Réception partielle.",
  "Écart de comptage, à revoir.",
  "Article retrouvé en réserve.",
  "Démarque inconnue.",
  "Correction après litige transporteur.",
  "Stock initial repris de l'ancien système.",
  "Palette reconditionnée.",
];

/**
 * ── The ledger itself ────────────────────────────────────────────────────────
 *
 * **The invariant `quantity_before + delta === quantity_after` holds on every
 * row, by construction rather than by check.** The backend enforces it where the
 * movement is built, which is what lets the panel render a row as an arrow
 * between two numbers instead of a delta the reader has to apply — so a fixture
 * that could produce a row where the three disagree would make that rendering a
 * lie the harness could not see.
 *
 * `quantity_before` is chosen *from* the delta on a negative move so the shelf
 * never goes below zero in the archive. That is a shaping decision, not a
 * measurement: WooCommerce will happily store a negative quantity on a product
 * that takes backorders.
 *
 * `created_at` is `stamp()` — **no UTC offset** — exactly like an order note's
 * and unlike its `date_created`. `parseApiDate()` is the only thing that may
 * touch it, and a mock that emitted ISO here would let a screen drop that call
 * and still look right.
 *
 * The rows are newest first, which is `created_at DESC` and the order the API
 * serves. Roughly thirteen minutes apart, so 1154 rows span about ten days and a
 * `date_from`/`date_to` window has something real to cut. **The per-day figures
 * ADMIN_PANEL.md:1857 quotes — 15 corrections "today" against 166 unfiltered —
 * are not reproduced**: they were measured on a shop whose ledger runs over a
 * different span, and stretching this one to hit them would be inventing a shape
 * to match a number.
 */
const MOVEMENTS = (() => {
  const reasons = shuffled(
    REASON_PLAN.flatMap(([reason, count]) => Array.from({ length: count }, () => reason)),
  );

  /*
   * Every one of the 155 ids appears at least once — the pool is seeded with one
   * of each and the remaining 999 rows are drawn from it — so "155 distinct
   * products" is a property of the fixture rather than a probability that a
   * seeded PRNG happened to satisfy.
   */
  const products = shuffled([
    ...LEDGER_PRODUCT_IDS,
    ...Array.from({ length: MOVEMENT_COUNT - LEDGER_PRODUCT_IDS.length }, () =>
      LEDGER_PRODUCT_IDS[int(0, LEDGER_PRODUCT_IDS.length - 1)],
    ),
  ]);

  const notes = shuffled([
    ...MOVEMENT_NOTES,
    ...Array.from({ length: MOVEMENT_COUNT - MOVEMENT_NOTES.length }, () => ""),
  ]);

  const everyIndex = Array.from({ length: MOVEMENT_COUNT }, (_, index) => index);
  const mine = new Set(
    shuffled(everyIndex.filter((index) => !LEDGER_ORDER_REASONS.includes(reasons[index]))).slice(
      0,
      MINE_MOVEMENTS,
    ),
  );
  const anonymous = new Set(
    shuffled(everyIndex.filter((index) => !mine.has(index))).slice(0, ANONYMOUS_MOVEMENTS),
  );

  let minutes = 3;
  return reasons.map((reason, index) => {
    minutes += int(4, 22);

    const ordered = LEDGER_ORDER_REASONS.includes(reason);
    const sign = MOVEMENT_SIGN[reason] ?? (int(0, 3) === 0 ? 1 : -1);
    const delta = sign * (ordered ? int(1, 3) : int(1, 12));
    // Never below zero in the archive: the floor is chosen from the delta.
    const before = delta < 0 ? -delta + int(0, 48) : int(0, 60);

    return {
      id: MOVEMENT_ID_BASE + MOVEMENT_COUNT - index,
      product_id: products[index],
      delta,
      quantity_before: before,
      quantity_after: before + delta,
      reason,
      note: notes[index],
      order_id: ordered ? ORDERS[int(0, ORDER_COUNT - 1)].id : 0,
      actor_id: mine.has(index)
        ? IDENTITY.id
        : anonymous.has(index)
          ? 0
          : COLLEAGUE_ACTORS[index % COLLEAGUE_ACTORS.length],
      created_at: stamp(minutes),
    };
  });
})();

/** The archive plus whatever this process has adjusted, newest first. */
const allMovements = () => [...state.movements, ...MOVEMENTS];

/* ---------------------------------------------------------------- coupons --- */

/**
 * ── Seven, and the last three exist to reach states the first four cannot ────
 *
 * The two null-versus-zero directions run on the same object and are the reason
 * the first four are shaped the way they are: `amount: "0.00"` is a real coupon
 * — a zero discount with free shipping — while a threshold of zero is stored as
 * null and can never read back as `"0.00"`.
 *
 * **301 to 304 are untouched.** lib/api/schemas/coupon.ts and lib/coupons.ts both
 * say `usage_count` is `0` on all four, and a fixture that quietly repaired one
 * of them would make those two docblocks wrong about the collection they were
 * written against. The states they cannot reach are added as *new* rows instead:
 *
 *   305  a **stale restriction** — `missing: true` on one product id and one
 *        category id. `missing` is on every restriction row rather than only the
 *        broken ones, because a client that filtered it out would silently delete
 *        the restriction the next time the form saved, and until this row existed
 *        the warning that says so had no fixture and had never been rendered.
 *        Also `usage_count: 37` against a limit of 50 — *used*, not exhausted.
 *   306  **trashed**, and exhausted: `usage_count` equal to `usage_limit`. A
 *        trashed coupon is absent from every listing and still reads back from
 *        `/coupons/{id}` with a 200 and `status: "trash"`, which is why
 *        `READABLE_COUPON_STATUSES` is wider than what `?status=` accepts. It is
 *        also what makes the permanent-delete path reachable at all.
 *   307  **`usage_count: 9` against 305's 37**, which is the only pair here that a
 *        lexical sort orders differently from a numeric one — the guard on
 *        `?orderby=usage`. Also the one `usage()` rendering nothing else reaches:
 *        a count that matters with no limit to print it against.
 *
 * `usage_count` is read-only on every route here, exactly as it is on the API —
 * redemption is `POST /cart/coupons`, on the storefront — so these two rows are
 * the only way the *used* and *exhausted* renderings can be seen. A non-zero
 * count is a state the real API certainly serves, unlike a capability nobody has
 * measured; what no route here may do is *move* one.
 */

/**
 * The two ids that resolve to nothing, written out because that is the whole
 * point of them. 8842 is the number lib/coupons.ts uses in `refLabel()`'s own
 * docblock — *an id printed where a name goes reads as a product called 8842* —
 * so the fixture and the rule that exists for it name the same thing.
 *
 * Neither collides with anything else in this file: products run to 211, the
 * ledger's archive to 3131, variations in the 9000s and movements in the 60000s.
 */
const STALE_RESTRICTION_PRODUCT = 8842;
const STALE_RESTRICTION_CATEGORY = 8843;

const COUPONS = [
  {
    id: 301,
    code: "bienvenue10",
    status: "publish",
    discount_type: "percent",
    amount: "10.00",
    description: "Première commande",
    date_expires: "2026-12-31T00:00:00+00:00",
    minimum_amount: "2000.00",
    maximum_amount: null,
    usage_limit: 500,
    usage_limit_per_user: 1,
    limit_usage_to_x_items: null,
    usage_count: 0,
    individual_use: true,
    free_shipping: false,
    exclude_sale_items: true,
    product_ids: [],
    excluded_product_ids: [],
    product_categories: [],
    excluded_product_categories: [],
    email_restrictions: [],
    date_created: iso(60_000),
    date_modified: iso(1200),
  },
  {
    id: 302,
    code: "livraison",
    status: "publish",
    discount_type: "fixed_cart",
    // A zero discount that is entirely about the shipping flag beside it.
    amount: "0.00",
    description: "Livraison offerte",
    date_expires: null,
    minimum_amount: "5000.00",
    maximum_amount: null,
    usage_limit: null,
    usage_limit_per_user: null,
    limit_usage_to_x_items: null,
    usage_count: 0,
    individual_use: false,
    free_shipping: true,
    exclude_sale_items: false,
    product_ids: [PRODUCTS[0].id],
    excluded_product_ids: [],
    product_categories: [],
    excluded_product_categories: [],
    email_restrictions: [],
    date_created: iso(50_000),
    date_modified: null,
  },
  {
    id: 303,
    code: "artisanat500",
    status: "draft",
    discount_type: "fixed_product",
    amount: "500.00",
    description: "",
    date_expires: "2026-09-30T00:00:00+00:00",
    minimum_amount: null,
    maximum_amount: null,
    usage_limit: 100,
    usage_limit_per_user: null,
    limit_usage_to_x_items: 2,
    usage_count: 0,
    individual_use: false,
    free_shipping: false,
    exclude_sale_items: false,
    product_ids: [PRODUCTS[3].id, PRODUCTS[19].id],
    excluded_product_ids: [],
    product_categories: [10],
    excluded_product_categories: [],
    email_restrictions: [LONG_EMAIL],
    date_created: iso(30_000),
    date_modified: iso(800),
  },
  {
    id: 304,
    // Unbroken and long, so the code column has an overflow case of its own.
    code: "promotion-de-fin-dannee-boutique-artisanale-algerienne-2026",
    status: "publish",
    discount_type: "percent",
    amount: "15.00",
    description: "Fin d'année",
    date_expires: "2026-12-31T00:00:00+00:00",
    minimum_amount: null,
    maximum_amount: "50000.00",
    usage_limit: null,
    usage_limit_per_user: 3,
    limit_usage_to_x_items: null,
    usage_count: 0,
    individual_use: false,
    free_shipping: false,
    exclude_sale_items: false,
    product_ids: [],
    excluded_product_ids: [PRODUCTS[11].id],
    product_categories: [],
    excluded_product_categories: [],
    email_restrictions: [],
    date_created: iso(20_000),
    date_modified: iso(600),
  },
  {
    id: 305,
    code: "artisans-fideles",
    status: "publish",
    discount_type: "fixed_cart",
    amount: "1500.00",
    description: "Programme fidélité",
    date_expires: null,
    minimum_amount: "8000.00",
    maximum_amount: null,
    usage_limit: 50,
    usage_limit_per_user: 2,
    limit_usage_to_x_items: null,
    // Used and not exhausted, which is the middle of the three usage renderings
    // and the one no fixture could reach.
    usage_count: 37,
    individual_use: false,
    free_shipping: false,
    exclude_sale_items: false,
    // One id that resolves and one that does not, in each of the two kinds — so
    // `missingRefs()` returns two rows across two fields rather than one, and a
    // banner that only looked at the first field would still be caught.
    product_ids: [PRODUCTS[0].id, STALE_RESTRICTION_PRODUCT],
    excluded_product_ids: [],
    product_categories: [13, STALE_RESTRICTION_CATEGORY],
    excluded_product_categories: [],
    email_restrictions: [],
    date_created: iso(15_000),
    date_modified: iso(300),
  },
  {
    id: 306,
    code: "ramadan2026",
    // Reachable by id and by nothing else: no `?status=` can list it.
    status: "trash",
    discount_type: "percent",
    amount: "20.00",
    description: "Opération Ramadan, retirée",
    date_expires: "2026-04-30T00:00:00+00:00",
    minimum_amount: null,
    maximum_amount: null,
    usage_limit: 100,
    usage_limit_per_user: 1,
    limit_usage_to_x_items: null,
    // Exhausted: `usage()` reports `exhausted: true` only when the count has
    // reached the limit, and nothing else in this shop can make it do that.
    usage_count: 100,
    individual_use: true,
    free_shipping: false,
    exclude_sale_items: false,
    product_ids: [],
    excluded_product_ids: [],
    product_categories: [],
    excluded_product_categories: [],
    email_restrictions: [],
    date_created: iso(80_000),
    date_modified: iso(2400),
  },
  {
    id: 307,
    code: "rentree-2026",
    status: "publish",
    discount_type: "percent",
    amount: "12.00",
    description: "Rentrée scolaire",
    date_expires: null,
    minimum_amount: null,
    maximum_amount: null,
    // No limit, and a count that still matters — the one `usage()` rendering with
    // no fixture: a number with no denominator to print it against.
    usage_limit: null,
    usage_limit_per_user: null,
    limit_usage_to_x_items: null,
    /*
     * **Nine, and the digit is the whole point of the row.** `usage` sorts
     * numerically, and against 305's 37 that is the only pair in this shop where a
     * lexical sort disagrees: by number 9 comes first ascending, by text "37"
     * does. Every other count here is 0, where the two orderings agree and a
     * regression to `localeCompare` would pass unnoticed.
     *
     * It is a *new* row rather than a repair to one of 301-304, on this table's
     * standing rule: those four mirror the shop's own four, and lib/coupons.ts:136
     * says `usage_count` is 0 on all of them. Moving one would make a docblock in
     * lib/ wrong about a measured collection to make a test here convenient.
     */
    usage_count: 9,
    individual_use: false,
    free_shipping: false,
    exclude_sale_items: false,
    product_ids: [],
    excluded_product_ids: [],
    product_categories: [],
    excluded_product_categories: [],
    email_restrictions: [],
    date_created: iso(10_000),
    date_modified: iso(200),
  },
];

/**
 * `restrictions` is emitted by the single-coupon routes and **not by the list**,
 * the way a customer's `statistics` is. `missing` is on every row rather than
 * only the broken ones: an id that resolves to nothing keeps its place, because
 * a client that dropped it would delete the restriction on the next save.
 *
 * **Both sides resolve against the real collections**, which is the repair this
 * branch made. A category used to be synthesised as `Catégorie ${id}` with
 * `missing: false` on *any* number, so every id in the shop resolved, the name
 * on screen was a number in French clothing, and the missing case was
 * unreachable through the half of the block that has the most ids in it.
 *
 * **A row that resolves to nothing carries `id`, `name: null` and `missing` and
 * nothing else.** The product arm used to publish `status: "trash"` for an id
 * that matched no product, which is an answer about a row it could not find —
 * a trashed product and a deleted one are different things, and only one of them
 * has a status. Both extra keys are optional on `restrictionRef` for exactly
 * this reason.
 *
 * Products resolve through `productById()` rather than the seed array, so the
 * whole catalogue counts — a coupon may legitimately be restricted to a draft —
 * and so a product force-deleted in this process makes the restriction naming it
 * go stale, which is the way one really becomes stale.
 */
function restrictionsFor(coupon) {
  const productRef = (id) => {
    const product = productById(id);
    if (product === undefined) return { id, name: null, missing: true };
    return {
      id,
      name: product.name,
      missing: false,
      // `""` is a real SKU-less product and the schema's null is that absence.
      sku: product.sku === "" ? null : product.sku,
      status: product.status,
    };
  };

  const categoryRef = (id) => {
    const category = CATEGORIES.find((candidate) => candidate.id === id);
    if (category === undefined) return { id, name: null, missing: true };
    return { id, name: category.name, missing: false, slug: category.slug };
  };

  return {
    product_ids: coupon.product_ids.map(productRef),
    excluded_product_ids: coupon.excluded_product_ids.map(productRef),
    product_categories: coupon.product_categories.map(categoryRef),
    excluded_product_categories: coupon.excluded_product_categories.map(categoryRef),
  };
}

/* ------------------------------------------ the order detail's sub-resources --- */

/**
 * The five sub-resources `GET /orders/{id}` hangs off itself, the six writes the
 * detail screen makes, and the refusal each of those writes can answer with.
 *
 * **Nothing below this line calls `rand()`.** One shared mulberry32 runs at
 * module load, so a single `int()` inserted anywhere in this file shifts the
 * sequence and changes every customer, all 633 orders and every variation
 * quantity above it. Every value here is written out or derived from an id, which
 * is what keeps the collections above byte-identical to what the earlier branches
 * were verified against.
 */

/**
 * A timestamp with **no offset** — `"2026-08-18 02:52:22"` — which is what an
 * order note's `created_at` is, while the order's own `date_created` beside it is
 * `"2026-08-18T02:52:22+00:00"`. Measured, and the asymmetry is the whole reason
 * `lib/format/date.ts` exists: `new Date()` reads an offsetless stamp as *local*
 * time and shifts it silently by the host's offset.
 *
 * Reproduced rather than tidied up. A mock that emitted ISO here would let a
 * screen drop `parseApiDate()` and still look right against the harness.
 *
 * **A movement's `created_at` is the same notation**, measured on the same day —
 * lib/api/schemas/inventory.ts:83-86 records it — which is why this is a hoisted
 * `function` rather than the `const` arrow it used to be: the ledger is built
 * some six hundred lines above this point and a `const` would be in its temporal
 * dead zone. Moving the declaration up instead would have moved this paragraph
 * away from the two notations it is contrasted with.
 */
function stamp(minutesAgo) {
  return new Date(EPOCH - minutesAgo * 60_000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

/**
 * And a third notation, because there are three. A shipment's `created_at` ends
 * `+00:00` and a payment's ends `Z` — measured, in one branch — which is why
 * `parseApiDate()` is the only thing allowed to touch either.
 */
const zulu = (minutesAgo) =>
  new Date(EPOCH - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");

/*
 * ── Which fixture id produces which refusal ──────────────────────────────────
 *
 * A screen cannot be verified against a state it can never reach, and each row
 * below is a distinct thing the detail has to render. So every one is pinned to
 * an id, and the ids are written out rather than searched for: a literal that
 * stops matching fails a test, while a `find()` moves quietly and takes this
 * table's meaning with it.
 *
 *   id    status      request                        answer
 *   ────  ──────────  ─────────────────────────────  ───────────────────────────
 *   1023  completed   PATCH {status:"processing"}    200 — the legal move
 *   1023  completed   POST  /shipments (full body)   200 — history does not block
 *   1023  —           POST  /payments/5231/verify    200, `report.amount: ""`
 *   1000  cancelled   PATCH {status:<anything>}      409 {from,to,allowed:[]}
 *   1000  cancelled   POST  /cod/attempts            409 {order_status:"cancelled"}
 *   1014  processing  PATCH {status:"pending"}       409 {from,to,allowed:[5]}
 *   1014  processing  POST  /shipments (full body)   409 {shipment_id:7014,…}
 *   1004  pending     POST  /cod/attempts            409 {order_id:1004} — COD off
 *   1006  pending     POST  /cod/attempts            409 {from,to,allowed:[]}
 *   1007  pending     POST  /shipments {provider}    400 fields{wilaya_id,commune_id}
 *   1007  pending     POST  /cod/attempts            200 — the legal outcome
 *   7014  created     POST  /shipments/7014/cancel   200 — the parcel is live
 *   7023  delivered   POST  /shipments/7023/cancel   409 {from,to,is_live:false}
 *
 * 1023 is also the detail route `scripts/capture.mjs` captures, and it is the
 * richest order in the shop rather than the tidiest: three line items all
 * carrying the 60-character SKU, a customer whose name is Arabic with a Latin
 * order number inside it, a customer note, three notes, a seven-entry timeline,
 * a confirmed COD record, a finished parcel from a provider that is not in
 * `/shipping/providers`, and two payments in two states.
 */
const TERMINAL_ORDER = 1000; // cancelled — every move refused
const COD_OFF_ORDER = 1004; // pending, cash on delivery switched off
const COD_FINISHED_ORDER = 1006; // pending, every outcome already spent
const OPEN_ORDER = 1007; // pending, nothing recorded against it yet
const LIVE_PARCEL_ORDER = 1014; // processing, one parcel still in flight
const RICH_ORDER = 1023; // completed — the capture route

/* ------------------------------------------------------------------ notes --- */

/**
 * `[id, minutesAgo, content, customer_note, added_by]`, because the same row has
 * to be published twice in two timestamp notations: as a note it carries
 * `created_at` with no offset, and as the timeline entry for the same event it
 * carries `at` with one. Storing the offset in the fixture would make that
 * impossible to express.
 *
 * The bodies are French — a customer writes French — and one of them is escaped
 * the way WordPress escapes a note body, `&#039;` for an apostrophe, so the
 * decode the timeline needs is exercised on this collection too.
 *
 * An order that is not in this map has **no notes at all**, which is the ordinary
 * case and a state the section has to render.
 */
const NOTE_ROWS = new Map([
  [
    RICH_ORDER,
    [
      [90230, 2620, "Commande reçue, paiement à la livraison.", false, "system"],
      [
        90231,
        2480,
        "Merci de livrer après 17 h, je travaille jusqu&#039;à 16 h 30.",
        true,
        "client1023",
      ],
      [90232, 2100, "Client rappelé, créneau confirmé.", false, "Harness Admin"],
    ],
  ],
  [
    LIVE_PARCEL_ORDER,
    [[90140, 640, "Colis remis au livreur.", false, "Harness Admin"]],
  ],
  [
    TERMINAL_ORDER,
    [[90000, 60, "Le client ne répond plus, commande annulée.", true, "client1000"]],
  ],
]);

const noteBody = ([id, minutesAgo, content, customerNote, addedBy]) => ({
  id,
  content,
  customer_note: customerNote,
  added_by: addedBy,
  created_at: stamp(minutesAgo),
});

const notesFor = (orderId) => (NOTE_ROWS.get(orderId) ?? []).map(noteBody);

/* --------------------------------------------------------------- timeline --- */

/**
 * The timeline, built from the order rather than stored beside it.
 *
 * Three things about it are measured and all three are load-bearing:
 *
 *   `actor` is **`""`** on a system-generated stock event — not null, not
 *   "system" — so a renderer that tested for truthiness and one that tested for
 *   null behave differently and only one of them is right.
 *
 *   `summary` arrives with **HTML entities in it**: the measured string is
 *   `"Stock levels reduced: Shipping test AC-SHIP-BOX (99&rarr;98)"`, and React
 *   prints those six characters literally unless `lib/format/html.ts` decodes
 *   them first. A fixture set of clean strings would let a screen stop decoding
 *   and still look right here.
 *
 *   **The notes are already in it.** Measured on order 3078: all three of its
 *   notes appear among its five timeline entries. The detail filters the notes
 *   collection down to the customer's own rather than printing every note twice.
 *
 * The summaries are English because the API's own are — the measured stock line
 * above is WooCommerce's string, not the plugin's French. The *order* of the
 * entries is oldest-first, which is this mock's choice and was not measured.
 *
 * Takes the row as it reads **now**, so a PATCHed status shows up in the timeline
 * the transition wrote to, which is what `router.refresh()` goes and gets.
 */
function timelineFor(order) {
  const entries = [
    {
      type: "order_created",
      at: order.date_created,
      actor: "",
      summary: `Order #${order.number} placed &mdash; ${order.line_items.length} item(s), total ${order.total}&nbsp;DZD.`,
      data: null,
    },
  ];

  const firstItem = order.line_items[0];
  if (order.stock_reduced && firstItem !== undefined) {
    entries.push({
      type: "stock_reduced",
      at: order.date_modified,
      // The system did this. Nobody's name goes here, and the field is present.
      actor: "",
      summary: `Stock levels reduced: ${firstItem.name} ${firstItem.sku} (99&rarr;98)`,
      data: { product_id: firstItem.product_id, from: 99, to: 98 },
    });
  }

  if (order.date_paid !== null) {
    entries.push({
      type: "payment",
      at: order.date_paid,
      actor: "",
      summary: `Payment of ${order.total}&nbsp;DZD recorded &mdash; ${order.payment_method_title}.`,
      data: null,
    });
  }

  for (const row of NOTE_ROWS.get(order.id) ?? []) {
    entries.push({
      type: "note",
      // The same instant as the note's own `created_at`, in the other notation.
      at: iso(row[1]),
      actor: row[4],
      summary: row[2],
      data: { customer_note: row[3] },
    });
  }

  entries.push({
    type: "status_change",
    at: order.date_modified,
    actor: "Harness Admin",
    summary: `Order status changed to ${order.status}.`,
    data: { to: order.status },
  });

  return entries;
}

/* -------------------------------------------------------------------- COD --- */

/**
 * What a COD record allows next, keyed by where it is now.
 *
 * `confirmed → ["confirmed"]` is measured and is the surprising one: re-confirming
 * is allowed and changes nothing but the attempt count, while `confirmed →
 * rejected` is refused, because a customer who said yes and later changed their
 * mind has *cancelled* — folding the two together would make the confirmation
 * rate count one event two ways.
 */
const COD_NEXT_OUTCOMES = {
  pending: ["confirmed", "rejected", "unreachable"],
  unreachable: ["confirmed", "rejected", "unreachable"],
  confirmed: ["confirmed"],
  rejected: [],
  cancelled: [],
};

/** The three a confirmation call can conclude with. `pending` is not an outcome. */
const COD_ATTEMPT_OUTCOMES = ["confirmed", "rejected", "unreachable"];

/**
 * The COD record every order starts with. Every order in this shop is
 * `payment_method: "cod"`, so every order has one.
 *
 * `COD_FINISHED_ORDER` is a live order whose outcomes are spent and
 * `TERMINAL_ORDER` reproduces the measured trap exactly: order 3879 carried
 * `allowed_outcomes: []` **and** a cancelled order, and the 409 blamed the order,
 * because that gate runs first. A record can therefore report outcomes the order
 * will refuse anyway, which is what `codAttemptGate()` in lib/cod-status.ts is
 * for.
 */
function seedCod(order) {
  const status =
    order.id === COD_FINISHED_ORDER
      ? "rejected"
      : order.status === "cancelled"
        ? "cancelled"
        : order.status === "completed" || order.status === "processing"
          ? "confirmed"
          : "pending";

  const confirmed = status === "confirmed";
  return {
    // The one order the switch is off on, so the first of the three gates has a
    // fixture of its own.
    enabled: order.id !== COD_OFF_ORDER,
    status,
    attempts: status === "pending" ? 0 : 1,
    confirmed_at: confirmed ? order.date_modified : null,
    cancelled_at: status === "cancelled" ? order.date_modified : null,
    last_attempt_at: status === "pending" ? null : order.date_modified,
    reason: status === "rejected" ? "Le client a refusé la commande à la livraison." : "",
    allowed_outcomes: COD_NEXT_OUTCOMES[status],
  };
}

/* -------------------------------------------------------------- shipments --- */

/**
 * Measured 2026-08-20 and again 2026-08-25: exactly one provider, and it is the
 * default.
 *
 * **`acfake` is deliberately absent and must stay absent.** The collection
 * carries two provider values and the only allowlisted enumeration of them
 * offers one, so a picker built from this endpoint cannot offer the provider
 * that is 42 of 129 rows. That is a fact about the API a screen decision rests
 * on; "helpfully" adding the second value here would delete the decision.
 */
const SHIPPING_PROVIDERS = [
  { name: "manual", label: "In-house delivery", is_default: true },
];

/**
 * Ten statuses in the order a parcel passes through them — and **that is the
 * order both refusals list them in.** Measured 2026-08-25:
 *
 *   ?status=zzz             "status is not one of pending, created, …, and failed."
 *   PATCH {status:"zzz"}    "Must be one of: pending, created, …, failed."
 *
 * Neither list is alphabetical, so neither is sorted here — unlike `/products`,
 * whose refusal genuinely is sorted. lib/shipment-status.ts:17-18 says the API
 * "sends them alphabetically in its error message"; the wire disagrees, and this
 * file follows the wire.
 */
const SHIPMENT_STATUSES = [
  "pending",
  "created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returning",
  "returned",
  "cancelled",
  "failed",
];

/**
 * Finished, one way or another.
 *
 * `is_live` is the negation of this and nothing else — measured 2026-08-25 on
 * all 129 rows in the shop, zero disagreements — which is why nothing here
 * stores the two independently.
 */
const TERMINAL_SHIPMENT_STATUSES = ["delivered", "returned", "cancelled", "failed"];
const isTerminalShipment = (status) => TERMINAL_SHIPMENT_STATUSES.includes(status);

/** `""` is the third value and means *any*, which is why the refusal names it. */
const DELIVERY_TYPES = ["home", "desk"];

/* ---------------------------------------------------------- shipping rules --- */

/**
 * How narrow a rule is — **computed here on every write and never accepted from
 * a client.** A body carrying `specificity` has it dropped in silence, like
 * `id`, the two stamps and `provider`.
 *
 * The formula is *fitted to four observations*, not read off the backend:
 *
 *   wilaya 0  / commune 0   / home   →  3   (rule 162)
 *   wilaya 16 / commune 0   / home   →  7   (rule 163)
 *   wilaya 16 / commune 484 / home   → 15   (rule 164)
 *   wilaya 31 / commune 0   / desk   →  6   (the round-trip POST)
 *
 * Commune 8, wilaya 4, and the delivery type 3 for `home` against 2 for `desk`
 * is the narrowest rule that produces all four. **The weight of `""` — a rule
 * that covers both delivery types — is unmeasured**, because no such rule
 * exists in the shop and none was created; 0 is a guess and is marked as one so
 * a future audit takes the measurement rather than trusting this line.
 */
function ruleSpecificity(rule) {
  const scope = (rule.commune_id > 0 ? 8 : 0) + (rule.wilaya_id > 0 ? 4 : 0);
  const type = rule.delivery_type === "home" ? 3 : rule.delivery_type === "desk" ? 2 : 0;
  return scope + type;
}

/**
 * The three rules the shop actually holds, measured 2026-08-25.
 *
 * `scripts/seed-shipping-rules.mjs` put them there — before it ran,
 * `GET /shipping/rules` answered `[]` and `/shipping/rates` could only ever
 * answer `[]` too, which is why the resolver could not have been built against
 * this shop at all. Alger Centre is covered by all three, so one destination
 * exercises every arm of the resolution the rules table exists to show.
 *
 * **`provider` is `"manual"` on all three, not `""`** — corrected 2026-08-25
 * from the measured `GET /shipping/rules/164`, and the mistake is worth naming
 * because it came from over-reading a real measurement. Two facts were recorded:
 * a POST *with no provider* stores `""`, and a PATCH of the whole GET body is a
 * 200 with `provider` "dropped in silence". The second cannot distinguish
 * *dropped* from *written back with the value it already had*, and the first is
 * about a body that omits the key. `seed-shipping-rules.mjs:77,88,99` POSTs
 * `provider: "manual"` on all three rules, so the server plainly stores what it
 * is given; `""` is the default for a body that names none, and nothing more.
 *
 * The two stamps' notation is **not measured** — a shipment's ends `+00:00` and
 * a payment's ends `Z`, and nothing recorded which of the two a rule uses. The
 * shipment notation is used here because a rule is on that subject; the schema
 * takes any string, so nothing in the panel can tell.
 */
const SHIPPING_RULE_SEED = [
  { id: 164, wilaya_id: 16, commune_id: 484, amount: "350.00", free_over: null, estimated_days: 1 },
  {
    id: 163,
    wilaya_id: 16,
    commune_id: 0,
    amount: "500.00",
    free_over: "10000.00",
    estimated_days: 2,
  },
  { id: 162, wilaya_id: 0, commune_id: 0, amount: "800.00", free_over: null, estimated_days: 5 },
];

function seedRules() {
  return new Map(
    SHIPPING_RULE_SEED.map((seed, index) => {
      const row = {
        id: seed.id,
        provider: "manual",
        wilaya_id: seed.wilaya_id,
        commune_id: seed.commune_id,
        delivery_type: "home",
        amount: seed.amount,
        free_over: seed.free_over,
        estimated_days: seed.estimated_days,
        is_active: true,
        specificity: 0,
        created_at: iso(4000 - index * 20),
        updated_at: iso(3800 - index * 20),
      };
      return [row.id, { ...row, specificity: ruleSpecificity(row) }];
    }),
  );
}

/**
 * Two parcels, and neither is tidy on purpose.
 *
 * 7014 is **live**, which is what makes `POST /orders/1014/shipments` a 409 and
 * what the create button reads: one live shipment per order, enforced by the
 * database. Its metadata carries a `label` URL — a courier's label link is a
 * credential, and `stripLabelUrls()` exists to keep it out of the RSC payload, so
 * the harness needs a shipment that actually has one or that strip is never
 * exercised by a capture.
 *
 * 7023 is **finished**, and its provider is `acfake` — a provider
 * `/shipping/providers` does not list, exactly as shipment 213 measured. A label
 * lookup that indexed into the providers array would blank the column on it;
 * `providerLabel()` falls back to the raw name instead. It also carries the
 * provider's own spelling of the status beside the mapped one, which is the only
 * way a mis-mapped adapter is visible at all.
 */
/**
 * The archive `GET /shipments` lists, and the reason it exists at all.
 *
 * **The live shop is all-terminal**: 129 rows, `delivered` 85 and `cancelled`
 * 44, `is_live: true` on exactly none of them. A harness seeded to that reality
 * exactly could never reach the status picker, the cancel button or sync, so the
 * three writes on this subject would be unverifiable — which is why 7014 stays
 * live and this archive is everything else.
 *
 * The resulting split is **`delivered` 86 / `cancelled` 42 / `created` 1 over
 * 129 rows**. The shop's own 85/44 is not reproduced to the row: the live parcel
 * has to come from somewhere and a fixture distribution is not a claim about the
 * contract. What *is* reproduced is every fact a screen can read off the shape —
 * both providers present, most rows finished, and the metadata key union.
 *
 * `metadata` carries exactly the measured union across the collection —
 * `delivery_type, wilaya_id, commune_id, cod_amount, provider_status` — and no
 * single row carries all of it, because no row in the shop does: `cod_amount` is
 * a manual shipment's and `provider_status` is the courier's own spelling, which
 * only `acfake` sends.
 *
 * Orders 1100-1163 carry these, two apiece bar one. That range deliberately
 * excludes 1007 (no parcel at all — the state the create button is *for*), 1014
 * (the live one) and 1023 (the capture route), whose lists are pinned by the
 * refusal table above and must not grow.
 */
const ARCHIVE_COUNT = 127;
const ARCHIVE_ID_BASE = 6000;
const ARCHIVE_ORDER_BASE = 1100;
const ARCHIVE_ORDERS = 64;

function seedArchive() {
  return Array.from({ length: ARCHIVE_COUNT }, (_, index) => {
    const id = ARCHIVE_ID_BASE + index;
    const orderId = ARCHIVE_ORDER_BASE + (index % ARCHIVE_ORDERS);
    // Interleaved rather than grouped, so page one of the list is not one
    // status and one provider.
    const status = index % 3 === 1 ? "cancelled" : "delivered";
    const acfake = index % 3 === 2;
    const wilayaId = 1 + (index % WILAYAS.length);
    const communeId = COMMUNES.get(wilayaId)[index % COMMUNES.get(wilayaId).length].id;

    return {
      id,
      order_id: orderId,
      provider: acfake ? "acfake" : "manual",
      provider_shipment_id: acfake ? `FAKE-${id}` : `MAN-${id}`,
      tracking_number: index === 0 ? LONG_TRACKING : acfake ? `ACFAKE${id}` : `AC${id}DZ`,
      status,
      is_live: false,
      metadata: {
        wilaya_id: wilayaId,
        commune_id: communeId,
        delivery_type: index % 2 === 0 ? "home" : "desk",
        // A manual courier collects cash and reports no status of its own; an
        // adapter reports its own spelling and collects nothing. Neither row
        // carries the other's key, which is what makes the union a union.
        ...(acfake
          ? { provider_status: status === "cancelled" ? "RAW_CANCELLED" : "RAW_DELIVERED" }
          : { cod_amount: ORDERS.find((row) => row.id === orderId).total }),
      },
      // Spread rather than stamped alike: the measured page one carries 82
      // distinct `created_at`, so a sort that "works" by tying on every row
      // cannot pass as proof against this fixture either.
      created_at: iso(3000 + index * 37),
      updated_at: iso(2400 + index * 29),
    };
  });
}

function seedShipments() {
  // Off the order, not written out: a courier collecting a figure the order does
  // not show is a bug report about arithmetic waiting to be filed.
  const codAmount = ORDERS.find((row) => row.id === LIVE_PARCEL_ORDER).total;
  const archive = new Map();
  for (const row of seedArchive()) {
    archive.set(row.order_id, [...(archive.get(row.order_id) ?? []), row]);
  }
  return new Map([
    ...archive,
    /*
     * The third state, and it is written out rather than left to fall through
     * `shipmentsOf`'s `?? []`. An order with no parcel at all is what the create
     * button is *for*, and a fixture whose whole value is being empty is
     * invisible unless something names it.
     */
    [OPEN_ORDER, []],
    [
      LIVE_PARCEL_ORDER,
      [
        {
          id: 7014,
          order_id: LIVE_PARCEL_ORDER,
          provider: "manual",
          provider_shipment_id: "MAN-7014",
          tracking_number: "AC7014DZ",
          status: "created",
          is_live: true,
          metadata: {
            wilaya_id: 16,
            commune_id: 484,
            delivery_type: "home",
            cod_amount: codAmount,
            label: "https://labels.example.test/manual/7014.pdf?token=abcdef",
          },
          created_at: iso(600),
          updated_at: iso(500),
        },
      ],
    ],
    [
      RICH_ORDER,
      [
        {
          id: 7023,
          order_id: RICH_ORDER,
          provider: "acfake",
          provider_shipment_id: "FAKE-7023",
          tracking_number: "ACFAKE7023",
          status: "delivered",
          is_live: false,
          metadata: {
            wilaya_id: 16,
            commune_id: 483,
            delivery_type: "desk",
            provider_status: "RAW_DELIVERED",
          },
          created_at: iso(2600),
          updated_at: iso(2000),
        },
      ],
    ],
  ]);
}

/* --------------------------------------------------------------- payments --- */

/**
 * Measured 2026-08-20: `chargily` is the default, and `cod` is the other one.
 *
 * **The labels are English, and re-measured 2026-08-26 they still are** —
 * `"Chargily (EDAHABIA / CIB)"` and `"Cash on delivery"`. This file invented
 * `"Paiement à la livraison"` for `cod`, which is the shipping `providerLabel`
 * defect in a second place: an API label written in French here would render as
 * French in the French panel by accident and as French in the Arabic one as a
 * bug, and the harness could never see either. `PaymentsScreen.tsx` resolves a
 * provider the way `ShipmentRow` used to — `methods.find(…)?.label ?? name`, with
 * no message key in front of it — so with the real labels in place the screen now
 * prints "Cash on delivery" inside both localised panels and the defect is
 * visible on a screenshot instead of hidden by the fixture.
 */
const PAYMENT_METHODS = [
  { name: "chargily", label: "Chargily (EDAHABIA / CIB)", is_default: true },
  { name: "cod", label: "Cash on delivery", is_default: false },
];

/**
 * Six, in the **physical** order the refusal names them — not alphabetical.
 * Measured 2026-08-26: `?status=zzz` answers `"status is not one of pending,
 * paid, failed, expired, cancelled, and refunded."`, which is the same
 * lib/payment-status.ts records and the same order `SHIPMENT_STATUSES` is in for
 * the same reason.
 */
const PAYMENT_STATUSES = ["pending", "paid", "failed", "expired", "cancelled", "refunded"];

/**
 * ── The transactions collection, and what its shape has to prove ─────────────
 *
 * This was **two payments on one order** until 2026-08-26, and DECISIONS.md §8
 * says exactly why that is not a fixture: a bidi/paging assertion taken on a
 * one-page collection proves nothing, because the broken rendering and the
 * correct one are the same string. Two rows on one order could not discriminate
 * a status tab, a provider filter, an `order_id`, a date bound or a page.
 *
 * So the fixture is now the live shop's own shape, measured 2026-08-26:
 *
 *   45 rows · 3 pages at the default per_page of 20
 *   status     44 `pending`, 1 `failed`  — and **`paid` is empty on purpose**
 *   provider   43 `cod`, 2 `chargily`     (the two sum to the total)
 *   order_id   44 distinct — one payment per order, except the rich order's two
 *   created_at 45 distinct, spread over six days, 2026-08-12 → 2026-08-18
 *   reference  42 of the 45 contain `AC-1`
 *
 * **Nothing in this shop has ever settled**, which is why four of the six
 * statuses return zero rows and `paid` is one of them. That is the shop, not a
 * gap: measured 2026-08-20 and again on 2026-08-26, every payment but one is
 * `pending`. Inventing a settled shop here would give a `paid` badge a screenshot
 * and give the panel a state the shop cannot produce.
 *
 * **The resting order is `id` descending, and the dates deliberately do not
 * follow it.** 5230 and 5231 carry the two highest ids and sit in the *middle* of
 * the date range, so `id desc` and `created_at desc` are different sequences and
 * a sort that started working could be seen. The live collection had 45 distinct
 * ids and 44 distinct `created_at` — one pair tied; all 45 are distinct here,
 * which is the same property one notch stronger.
 *
 * **The 23:07Z row is the whole of the timezone measurement.** Slot 8 is pinned
 * to `2026-08-16T23:07:22Z`, which is 00:07 on the **17th** in Africa/Algiers.
 * Measured on the live stack: it is **included** by `date_to=2026-08-16` and
 * **excluded** by `date_from=2026-08-17`, so the bounds cut on the **UTC** day
 * and not on the shop's timezone. It is the only row that can tell those two
 * readings apart — every other row in the fixture answers identically either way
 * — and without the pin slot 8 would fall at 22:36Z, which is still the 16th in
 * both zones and proves nothing. The live row measured 23:07:**26**Z; this one is
 * four seconds earlier because every stamp in this file is derived from `EPOCH`,
 * and four seconds cannot move a day boundary in either zone.
 *
 * **`reference` holds two distinct values across all 45 rows, and the low
 * cardinality is the fact rather than a shortcut.** Measured 2026-08-26:
 * `{"AC-1": 42, "3939": 3}`. A first draft of this fixture handed out 42
 * *distinct* `AC-1nnn` references, which was inferred from `reference=AC-1`
 * returning 42 and the assumption that 42 rows could not share one value. They
 * can, and they do — see `paymentsListing` for the four requests that settle it.
 * That inference made the mock **more permissive than the API**, which is the one
 * direction this file exists to prevent.
 *
 * The three-row cluster is the two pinned transactions plus the second
 * `chargily` row. On the live shop those three sit on one order; here two of them
 * do, because putting a third on 1023 would break `GET /orders/1023/payments`,
 * which is a pinned fixture other tests read.
 *
 * This is also why the screen offers no reference control: a filter with two
 * values in it partitions 45 rows into 42 and 3.
 *
 * 5230 and 5231 stay exactly where they were, ids and all: `GET
 * /orders/1023/payments` and `POST /payments/5231/verify` are pinned fixtures
 * other tests read, and the story on them is unchanged — the card attempt failed
 * at the gateway and the order fell back to cash on delivery.
 *
 * Every amount is read off the order it belongs to rather than written out,
 * because two figures that drift apart on one screen is a bug report about
 * arithmetic.
 */
const PAYMENT_ROWS = 43;
/** Ids run **below** 5230, so the pinned pair stays first in the resting order —
    which is what puts the shop's only `failed` row on page one of a capture. */
const PAYMENT_ID_TOP = 5228;
const PAYMENT_ORDER_BASE = 1030; // clear of every id in the refusal table above
const PAYMENT_ORDER_STEP = 7;
const PAYMENT_MINUTES_BASE = 120;
const PAYMENT_MINUTES_STEP = 197;
/** The row that separates a UTC-day cut from an Africa/Algiers one. */
const TIMEZONE_EDGE_SLOT = 8;
const TIMEZONE_EDGE_MINUTES = 1665; // 2026-08-16T23:07:22Z
/** The second `chargily` row, and the only pending one. */
const CHARGILY_SLOT = 4;
/** The two values the whole collection's `reference` column holds. */
const BULK_REFERENCE = "AC-1";
const CLUSTER_REFERENCE = "3939";

/**
 * The three `metadata` shapes, and all three are measured 2026-08-26. A payment's
 * metadata is a free record in the schema, so a fixture that carried one shape
 * would let a screen index into keys the other two rows do not have.
 *
 *   cod                {amount, collect_on_delivery, currency}
 *   chargily pending   {provider_status, livemode, fees, fees_on_merchant,
 *                       fees_on_customer}
 *   failed             {error: "conflict"}
 *
 * **Only the key sets are measured. Every value below is chosen, on all three.**
 * Nothing on the screen reads a fee or a `collect_on_delivery` today; a screen
 * that ever does has to go and measure whether `fees_on_merchant` is a money
 * string or a boolean before formatting one, and whether a cod row's `amount`
 * really tracks the order's total the way this fixture assumes. The one value
 * that is not a guess is `{error: "conflict"}`, which is measured whole.
 *
 * `{error: "conflict"}` is the only place a failed payment says *why*, which is
 * why the failed row must carry it rather than the `{provider_status}` this file
 * used to invent.
 */
const codMetadata = (amount) => ({ amount, collect_on_delivery: true, currency: "DZD" });
const chargilyMetadata = {
  provider_status: "pending",
  livemode: false,
  fees: "25.00",
  fees_on_merchant: "25.00",
  fees_on_customer: "0.00",
};

function seedPayments() {
  const rich = ORDERS.find((row) => row.id === RICH_ORDER);
  const seeded = new Map([
    [
      RICH_ORDER,
      [
        {
          id: 5230,
          order_id: RICH_ORDER,
          provider: "chargily",
          provider_transaction_id: "ch_test_1023",
          reference: CLUSTER_REFERENCE,
          amount: rich.total,
          currency: "DZD",
          status: "failed",
          metadata: { error: "conflict" },
          created_at: zulu(2600),
          updated_at: zulu(2400),
        },
        {
          id: 5231,
          order_id: RICH_ORDER,
          provider: "cod",
          // Empty until a courier collects — a real value, not a placeholder.
          provider_transaction_id: "",
          reference: CLUSTER_REFERENCE,
          amount: rich.total,
          currency: "DZD",
          status: "pending",
          metadata: codMetadata(rich.total),
          created_at: zulu(2380),
          updated_at: zulu(2380),
        },
      ],
    ],
  ]);

  for (let slot = 0; slot < PAYMENT_ROWS; slot += 1) {
    const orderId = PAYMENT_ORDER_BASE + slot * PAYMENT_ORDER_STEP;
    const order = ORDERS.find((row) => row.id === orderId);
    const id = PAYMENT_ID_TOP - slot;
    const chargily = slot === CHARGILY_SLOT;
    const minutes =
      slot === TIMEZONE_EDGE_SLOT
        ? TIMEZONE_EDGE_MINUTES
        : PAYMENT_MINUTES_BASE + slot * PAYMENT_MINUTES_STEP;

    seeded.set(orderId, [
      {
        id,
        order_id: orderId,
        provider: chargily ? "chargily" : "cod",
        provider_transaction_id: chargily ? `ch_test_${orderId}` : "",
        // 42 rows share this **one literal**, which is what `?reference=AC-1`
        // counted on the live shop. The chargily row joins the two pinned ones on
        // `3939`, so the column holds two values across 45 rows and the filter has
        // something to leave out.
        reference: chargily ? CLUSTER_REFERENCE : BULK_REFERENCE,
        amount: order.total,
        currency: "DZD",
        status: "pending",
        metadata: chargily ? chargilyMetadata : codMetadata(order.total),
        created_at: zulu(minutes),
        updated_at: zulu(minutes),
      },
    ]);
  }

  return seeded;
}

/**
 * `GET /cod/statistics`, reproduced **verbatim** from the live stack on
 * 2026-08-26 rather than computed from this fixture's orders.
 *
 * Four properties are load-bearing and every one of them is a thing a screen
 * renders:
 *
 *   1. `by_status` sums **exactly** to `total_orders` — 217+84+42+0+256 = 599 —
 *      which is what makes the breakdown explanatory rather than decorative, and
 *      what `byStatusSumsToTotal()` gates the footnote on.
 *   2. `by_status.confirmed` (84) **differs from** `confirmed_orders` (126), in
 *      one payload, and both are right: the first is the shop *now*, the second
 *      counts every order ever confirmed. This is the clearest instance in the
 *      whole API of two numbers that look like the same number, and it is why
 *      `CodFigure.scope` is not optional.
 *   3. `rates.confirmation` is `confirmed_orders / total_orders` — 126/599 =
 *      0.2104 — so the *ever* count is the numerator and the rate cannot be
 *      re-derived from `by_status`.
 *   4. `unreachable` is **0**, so `codByStatus()` drops a row. A fixture with
 *      five non-zero counts would never exercise that branch.
 *
 * **599 is not this fixture's 633 orders and is not meant to be.** The report is
 * a server-side aggregate over the shop's COD orders and nothing in the panel
 * cross-checks it against `/orders`; deriving it here would mean inventing an
 * ever-confirmed count the fixture has no data for and losing the five measured
 * rate strings, which are the part a screen actually formats.
 */
const COD_STATISTICS = {
  total_orders: 599,
  by_status: { pending: 217, confirmed: 84, rejected: 42, unreachable: 0, cancelled: 256 },
  confirmed_orders: 126,
  delivered_orders: 44,
  returned_orders: 43,
  rates: {
    confirmation: "0.2104",
    rejection: "0.0701",
    cancellation: "0.4274",
    delivery: "0.0735",
    return: "0.0718",
  },
};

/* -------------------------------------------------------------- analytics --- */

/**
 * ── The seven reports, and the one range control they share ──────────────────
 *
 * Measured 2026-08-26 against the live shop. **All seven are served**: the
 * overview the dashboard reads as a single request, and the six the `/analytics`
 * screen switches between. Everything in this block is true of all seven,
 * because they share one `range` parameter, one window reader, one `meta` and
 * one money gate. What is true of a single report is said at that report.
 *
 * **`range` is the only parameter and it is honoured.** Over one shop:
 *
 *     range        low_stock  customers  placed  shipments  net
 *     today            3          0          0        0     0.00
 *     yesterday        3          0          0        2     0.00
 *     7d               3          5        126       20     156900.00
 *     30d              3          9        901      131     812200.00
 *     90d              3          9        901      131     812200.00
 *
 * Two properties of that table are the reason the fixture is shaped the way it
 * is, and inverting either would teach a screen the opposite of the truth:
 *
 *   1. **`inventory.low_stock` is not range-scoped.** Identical across a 90×
 *      window — it is current state sitting under a range control that does not
 *      move it. So it is not in the per-range table below at all: it is counted
 *      off `inventoryRows()` on every request, which is both why it cannot drift
 *      with the range and why it agrees with the `/inventory` screen the card
 *      links to (3 rows, the same three).
 *   2. **`customers.customers` is range-scoped** — 0 / 0 / 5 / 9 / 9. A fixture
 *      that held it flat would hide a control that works.
 *
 * **Accepted and silently ignored**, all byte-identical to `?range=30d`:
 * `bogus_param=1`, `per_page=5`, `orderby=id`, `limit=3`, `date_from=…`, and —
 * the one that matters — **`date_from`/`date_to` when `range` is not `custom`**,
 * which answer 200 with the thirty-day default. That is this endpoint's own
 * dishonesty and the reason a screen must never offer bare dates: an operator
 * picking a ten-day window with no preset is shown thirty days of figures and
 * nothing errors. Reproduced by reading neither parameter outside `custom`.
 *
 * Re-measured 2026-08-26 on a *report* route rather than only on the overview:
 * `bogus_param`, `per_page`, `orderby`, `limit` and `date_from` are each
 * byte-identical to the bare `?range=30d` request on `/analytics/orders`. Note
 * the consequence for paging: `per_page` is not read here, so it is *not*
 * refused here either — `paginate()` is deliberately not called, because these
 * routes return one object and not a page. **That asymmetry with the rest of
 * this file is deliberate and measured on both halves**: `paginate()` refuses
 * `per_page=abc` on every collection, and the analytics surface accepts and
 * drops it. A shared helper quietly standardising one of the two would be the
 * same class of defect as the list-envelope one the envelope suite pins.
 *
 * **`best_sellers_limit` is a published constant and not a knob.** Measured at
 * `range=90d`: `limit=3`, `per_page=3` and `best_sellers_limit=3` each still
 * return ten rows with `best_sellers_limit: 10` beside them. So no screen may
 * offer a "show more" — the number is there to be *stated*, which is what
 * `ProductsView`'s footnote does with it.
 *
 * **Two error shapes on one route**, and both are real:
 *
 *     range=zzz  400  details.params.range  — the query-parameter enum family
 *     range=custom without its dates
 *                400  details.fields.*      — the body-field family, on query
 *                                             parameters, from the controller
 *
 * The split is what an argument schema can and cannot express: `range`'s enum is
 * declarative and refuses before the controller runs, while "required when
 * `range` is custom" is a rule only the controller knows. `ApiError` keeps both
 * halves, which is the whole reason it exposes `params` and `fields` separately.
 *
 * **The dates are this fixture's clock, not the measurement's.** The live
 * 30-day window read `2026-07-28 → 2026-08-26` because that is the day it was
 * taken; here every timestamp in the file descends from one `EPOCH`, so `to` is
 * `2026-08-18` and the window is `2026-07-20 → 2026-08-18`. The *shape* is
 * reproduced exactly — preset echoed, `days` the inclusive count, `timezone`
 * `"+00:00"` which is not `Africa/Algiers` — and the figures are unaffected,
 * because they are a measured table rather than a projection of this fixture's
 * orders. Anchoring on the measured literal instead would put `generated_at`
 * eight days behind the window it reports, and the dashboard renders the two
 * side by side. One constant moves it if that is ever wanted.
 *
 * **The figures do not reconcile with `/orders` and are not meant to**, exactly
 * as `COD_STATISTICS` does not: 901 placed against a fixture holding 633 rows.
 * These are server-side aggregates over a live shop, and re-deriving them from
 * the seeds would cost every measured rate string — the part a screen formats.
 * Only the five columns above are measured; the rest of each block is invention
 * held to the payload's own invariants, which is what the brief allowed.
 */
const ANALYTICS_TODAY = new Date(EPOCH).toISOString().slice(0, 10);
const ANALYTICS_EPOCH = Date.parse(`${ANALYTICS_TODAY}T00:00:00Z`);

/** `back` whole days before `ANALYTICS_TODAY`, as `Y-m-d`. */
const analyticsDay = (back) =>
  new Date(ANALYTICS_EPOCH - back * 86_400_000).toISOString().slice(0, 10);

/** Inclusive at both ends, the way the server counts: 08-11 → 08-21 is eleven. */
const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

const analyticsRange = (preset, from, to) => ({
  preset,
  from,
  to,
  days: daysBetween(from, to),
  timezone: "+00:00",
});

/** Days back from `ANALYTICS_TODAY`, `[from, to]`. `custom` states its own. */
const PRESET_WINDOWS = {
  today: [0, 0],
  yesterday: [1, 1],
  "7d": [6, 0],
  "30d": [29, 0],
  "90d": [89, 0],
};

const ANALYTICS_PRESETS = [...Object.keys(PRESET_WINDOWS), "custom"];

/**
 * The three lines the API reports as *unavailable* rather than as zero, which is
 * a different answer and the reason `unavailable` is an object of sentences and
 * not a list of names.
 *
 * **These are now the measured sentences, verbatim, and they were
 * reconstructions until 2026-08-26.** The block that stood here said so and gave
 * its reason — only a fragment of `payment_fees` survived anywhere in this repo
 * — but a reconstruction is only honest while nobody has the original, and the
 * revenue report's own payload carries all three. They are reproduced character
 * for character, backticks and all: the measured text writes `ac_shipments` and
 * `ac_payment_transactions` as bare words rather than in code spans, which the
 * reconstruction had guessed the other way.
 *
 * Still **not** something to assert a sentence against. The panel localises all
 * three by key and falls back to the API's text only for a key it has no wording
 * for, so what a screen depends on is the three keys and the fact that each
 * value is prose. `/analytics/shipping` carries `shipping_cost` alone, out of
 * this same object rather than restated beside it.
 */
const ANALYTICS_UNAVAILABLE = {
  shipping_cost:
    "What a courier charges the shop is not recorded. ac_shipments deliberately has no cost column, and shipping_revenue above is the separate figure of what the customer was charged.",
  payment_fees:
    "Gateway fees are not summable across providers. ac_payment_transactions has no fee column by design; Chargily reports fees in per-transaction metadata, and a second gateway would shape them differently.",
  margin:
    "No cost of goods exists. WooCommerce has no cost field, and PLAN §28 says to calculate profit only where reliable cost data exists.",
};

/**
 * Why the largest slice of the geography has no name, in the API's own words and
 * measured verbatim. It is English, like the three above, and `ShippingView`
 * renders its own localised line instead — the sentence travels so that a reader
 * of the *payload* is not left guessing, not so that a screen prints it.
 */
const UNATTRIBUTED_REASON =
  "Orders with no shipment carry no canonical wilaya; an order address stores it as free text, which is never guessed at.";

/**
 * The money block with `unavailable` **in its measured position** — between
 * `average_order_value` and `refund_count`, not appended after them.
 *
 * Key order is part of the measured shape and this file already treats it that
 * way: the unit suite asserts `Object.keys(data)` on the money-blind payload, so
 * the same standard applies one level down. Spreading the constant and adding
 * `unavailable` at the end was a byte the API does not send, and a screen that
 * renders a money block by iterating its entries would have printed the three
 * prose reasons after the refund counts rather than in the middle.
 *
 * Written as a splice rather than by putting `unavailable` into each of the
 * three revenue literals, because the money-blind payload omits the whole block
 * and a literal carrying it would have to be stripped on that path instead.
 */
const withUnavailable = ({ refund_count, refunded_orders, ...head }) => ({
  ...head,
  unavailable: ANALYTICS_UNAVAILABLE,
  refund_count,
  refunded_orders,
});

/**
 * The COD block the overview nests is a strict subset of `/analytics/cod`, which
 * is itself `/cod/statistics` with a range on it — measured key for key at 30d,
 * down to the five rate strings. So the window's *full* statistics sit in the
 * table below and both readers derive from them: the report echoes the block, the
 * overview takes these four keys out of it. Restating the four beside the seven
 * is how a dashboard comes to disagree with the report it links to.
 */
const codOverview = (stats) => ({
  total_orders: stats.total_orders,
  confirmed_orders: stats.confirmed_orders,
  confirmation_rate: stats.rates.confirmation,
  delivery_rate: stats.rates.delivery,
});

/**
 * The same arrangement for parcels: the table holds `/analytics/shipping`'s whole
 * block and the overview takes its four keys out of it, so `shipments` on the
 * dashboard and `shipments.total` on the report cannot drift into two numbers.
 */
const shippingOverview = (report) => ({
  shipments: report.shipments.total,
  delivered: report.shipments.by_status.delivered,
  live: report.shipments.live,
  delivery_rate: report.rates.delivery,
});

/**
 * All ten shipment statuses, in the vocabulary's order, zeros filled in.
 *
 * The report sends every one of them and eight are 0 on this shop — which is the
 * measurement `statusCounts()` drops zeros for, and a fixture that sent only the
 * non-zero pair would leave that branch unexercised.
 */
const shipmentsByStatus = (counts) => ({
  pending: 0,
  created: 0,
  picked_up: 0,
  in_transit: 0,
  out_for_delivery: 0,
  delivered: 0,
  returning: 0,
  returned: 0,
  cancelled: 0,
  failed: 0,
  ...counts,
});

/** Every figure zero, for the two windows this shop has no activity in. */
const NO_ORDERS = {
  placed: 0,
  by_status: {
    pending: 0,
    processing: 0,
    "on-hold": 0,
    completed: 0,
    cancelled: 0,
    refunded: 0,
    failed: 0,
  },
  cancelled: 0,
  completed: 0,
  refunded: 0,
  guest_orders: 0,
  counted_as_revenue: 0,
};

const NO_CUSTOMERS = {
  customers: 0,
  new: 0,
  returning: 0,
  guest_orders: 0,
  rates: { new: "0.0000", returning: "0.0000" },
};

/**
 * ── The zero window, and why it is a shape rather than an absence ────────────
 *
 * `range=today` on a shop with no orders today is a **200 with every block
 * present and every figure zero** — measured on all seven routes, and the key
 * lists were re-measured report by report on 2026-08-26. `best_sellers`,
 * `providers` and `by_wilaya` are `[]`; every count is `0` and every rate is
 * `"0.0000"`; nothing is omitted, so there is no missing key to detect the empty
 * window by. `isEmptyWindow()` reads a headline count for exactly that reason,
 * and these constants are what keep the branch reachable from this harness.
 */
const NO_COD = {
  total_orders: 0,
  by_status: { pending: 0, confirmed: 0, rejected: 0, unreachable: 0, cancelled: 0 },
  confirmed_orders: 0,
  delivered_orders: 0,
  returned_orders: 0,
  rates: {
    confirmation: "0.0000",
    rejection: "0.0000",
    cancellation: "0.0000",
    delivery: "0.0000",
    return: "0.0000",
  },
};

const NO_SHIPPING = {
  shipments: { total: 0, by_status: shipmentsByStatus({}), live: 0 },
  rates: { delivery: "0.0000", return: "0.0000" },
  providers: [],
  by_wilaya: [],
  unattributed: { orders: 0, revenue: "0.00", reason: UNATTRIBUTED_REASON },
  shipping_revenue: "0.00",
};

const NO_REVENUE = {
  currency: "DZD",
  order_total: "0.00",
  orders_placed: 0,
  orders_counted: 0,
  gross: "0.00",
  discounts: "0.00",
  shipping_revenue: "0.00",
  tax: "0.00",
  refunds: "0.00",
  net: "0.00",
  collected: "0.00",
  average_order_value: "0.00",
  refund_count: 0,
  refunded_orders: 0,
};

/**
 * ── The best-seller rows, and the one number under them that is not a knob ───
 *
 * `best_sellers_limit` is **10 and is not adjustable**: measured at `range=90d`,
 * `limit=3`, `per_page=3` and `best_sellers_limit=3` all still return ten rows
 * with `10` beside them. It is published so a screen can *state* the cut-off,
 * which is what `ProductsView`'s footnote does; no screen may offer a "show
 * more", because there is nothing to ask for.
 *
 * **The measured units are reproduced; the products they hang on are this
 * fixture's.** The live shop's ten rows are its own test products — ids and
 * names that do not exist here — and every row of this report is a link to
 * `/products/{id}`. Reproducing the ids literally would have given the screen ten
 * rows whose names contradict `/products` and whose links 404, which is the
 * harness disagreeing with itself rather than reproducing the shop. So the
 * measured *spread* travels — 84, 76, 44, 43, 26, 14, 14, 9, 5, 3 units, with the
 * measured `units > orders` rows kept where they were — and it is hung on ten
 * real catalogue rows, with `revenue` computed as units × that product's own
 * price. `tests/mock-api.test.ts` holds all three of those to the fixture.
 *
 * The two rows tied at 14 units are measured and worth keeping: a ranked set
 * containing a tie is what `barShare()` draws as two equal bars inside a set that
 * still has a ranking, which is a different picture from the flat set below.
 */
const BEST_SELLERS_LIMIT = 10;

const seller = (product_id, name, units, orders, revenue) => ({
  product_id,
  name,
  units,
  orders,
  revenue,
});

const BEST_SELLERS_30D = [
  seller(209, "Savon d'Alep, lot de 3", 84, 84, "63000.00"),
  seller(201, "Chèche en coton, 20 coloris", 76, 76, "68400.00"),
  seller(111, "Harissa artisanale, 200 g", 44, 44, "57200.00"),
  seller(105, "Savon noir traditionnel, 250 g", 43, 43, "86000.00"),
  seller(108, "Tapis berbère, 120 × 180", 26, 13, "54600.00"),
  seller(117, "Olives cassées de Sig, 500 g", 14, 14, "42000.00"),
  seller(126, "Lampe en fer forgé", 14, 14, "29400.00"),
  seller(122, "Plateau en cuivre martelé", 9, 3, "81000.00"),
  seller(109, "Figues sèches de Béni Maouche", 5, 2, "23500.00"),
  seller(116, "Miel de montagne, 250 g", 3, 2, "9900.00"),
];

/** The same ten products over the narrower window: ten rows, measured, ranked. */
const BEST_SELLERS_7D = [
  seller(209, "Savon d'Alep, lot de 3", 12, 12, "9000.00"),
  seller(201, "Chèche en coton, 20 coloris", 11, 11, "9900.00"),
  seller(111, "Harissa artisanale, 200 g", 7, 7, "9100.00"),
  seller(105, "Savon noir traditionnel, 250 g", 6, 6, "12000.00"),
  seller(108, "Tapis berbère, 120 × 180", 4, 2, "8400.00"),
  seller(117, "Olives cassées de Sig, 500 g", 2, 2, "6000.00"),
  seller(126, "Lampe en fer forgé", 2, 2, "4200.00"),
  seller(122, "Plateau en cuivre martelé", 2, 1, "18000.00"),
  seller(109, "Figues sèches de Béni Maouche", 1, 1, "4700.00"),
  seller(116, "Miel de montagne, 250 g", 1, 1, "3300.00"),
];

/**
 * **The flat set, and it is the reason the `narrow` window exists at all.**
 *
 * `hasRankingSignal()` has two branches and only one of them was reachable from
 * this harness: every window with sales returns a genuine spread, and every
 * window without returns `[]` — which is the *empty* branch, not the flat one. So
 * the rendering `ProductsView` falls back to when every row ties, a plain list of
 * counts under the `bestSellersFlat` footnote, could not be photographed at any
 * width, theme or locale.
 *
 * Four rows of one unit each, over the two counted orders of a two-day window.
 * `Math.max === Math.min`, so the bars are not drawn — which is the whole point:
 * four identical full-length bars would imply a ranking that does not exist.
 */
const BEST_SELLERS_NARROW = [
  seller(105, "Savon noir traditionnel, 250 g", 1, 1, "2000.00"),
  seller(111, "Harissa artisanale, 200 g", 1, 1, "1300.00"),
  seller(117, "Olives cassées de Sig, 500 g", 1, 1, "3000.00"),
  seller(209, "Savon d'Alep, lot de 3", 1, 1, "750.00"),
];

/**
 * One block per window, and the invariants every one of them holds:
 *
 *   `orders.by_status` sums **exactly** to `orders.placed`
 *   `counted_as_revenue` is the four COUNTED_STATUSES out of `by_status` —
 *       processing + on-hold + completed + refunded, which is what makes the
 *       901-against-323 gap explainable rather than merely printed
 *   `revenue.orders_placed`/`orders_counted` echo those two
 *   `revenue.net` is `gross - refunds`; `average_order_value` is
 *       `gross / orders_counted`
 *   `refund_count` and `refunded_orders` equal `by_status.refunded`
 *   every rate is its own numerator over its own denominator, to four places
 *   `cod.by_status` sums exactly to `cod.total_orders`, and every COD rate
 *       divides by `total_orders` — including `confirmation`, whose numerator is
 *       the *ever* count and not `by_status.confirmed`
 *   `shipping.providers` sum, column by column, to `shipping.shipments`
 *
 * ── The cross-report identities, and why they are enforced here ──────────────
 *
 * The same shop is described six ways on one screen and by cards on another. A
 * report that disagrees with the dashboard above it does not teach a reader that
 * one number is wrong; it teaches them the panel is broken. So these hold across
 * reports and `tests/mock-api.test.ts` asserts every one of them against the
 * *served payloads* rather than against this table:
 *
 *   1. `orders.by_status.refunded` = `revenue.refund_count` = `refunded_orders`
 *   2. `orders.placed` = `revenue.orders_placed`, and `counted_as_revenue` =
 *      `revenue.orders_counted`
 *   3. `orders.average_order_value` and `orders.currency` are `revenue`'s own —
 *      measured identical in one payload, so they are read off it here
 *   4. `products.low_stock.products` = the overview's `inventory.low_stock` =
 *      `/inventory/low-stock`'s `meta.total` — all three counted off
 *      `inventoryRows()` on every request, never tabled
 *   5. `cod` is `/cod/statistics` with a range on it, and the overview's four COD
 *      keys are a strict subset of it
 *   6. `shipping.shipping_revenue` is `revenue.shipping_revenue`
 *   7. **`by_wilaya` plus `unattributed` reconcile to the revenue report** —
 *      their orders sum to `orders_counted` (40 + 18 + 2 + 263 = 323) and their
 *      revenues to `gross` (918 100). That identity was *derived from* the
 *      measured payloads rather than stated by them, and it is why the third
 *      wilaya row below is carved out of the unattributed slice instead of added
 *      beside it.
 *
 * And the one identity that must **not** hold: `customers.guest_orders` is not
 * `orders.guest_orders` — 209 against 422, measured in one window. Two scopes
 * wearing one name, and the customers report exists partly to say so.
 *
 * **`90d` is `30d`, deliberately.** Measured identical on every column: this
 * shop holds nothing older than about a month, so the widest preset answers the
 * middle one. A screen that treats a wider window as necessarily a larger number
 * is wrong about this shop, and the fixture says so.
 */
const ANALYTICS_FIGURES = {
  today: {
    orders: NO_ORDERS,
    customers: NO_CUSTOMERS,
    cod: NO_COD,
    shipping: NO_SHIPPING,
    bestSellers: [],
    revenue: NO_REVENUE,
  },
  yesterday: {
    orders: NO_ORDERS,
    customers: NO_CUSTOMERS,
    cod: NO_COD,
    // Two parcels and no orders: a shipment leaves for an order placed days
    // earlier, so these two figures are not two views of one number. It is also
    // the only window with **one** provider, which is the other side of the
    // branch `providers: []` covers at `today`.
    shipping: {
      shipments: { total: 2, by_status: shipmentsByStatus({ delivered: 1, cancelled: 1 }), live: 0 },
      rates: { delivery: "0.5000", return: "0.0000" },
      providers: [
        {
          provider: "manual",
          shipments: 2,
          delivered: 1,
          returned: 0,
          cancelled: 1,
          failed: 0,
          live: 0,
          rates: { delivery: "0.5000", return: "0.0000" },
        },
      ],
      // No orders in the window, so nothing to attribute to a wilaya — the
      // parcels moved for orders placed before it.
      by_wilaya: [],
      unattributed: { orders: 0, revenue: "0.00", reason: UNATTRIBUTED_REASON },
      shipping_revenue: "0.00",
    },
    bestSellers: [],
    revenue: NO_REVENUE,
  },
  /*
   * ── The narrow window, which is invention and says so ────────────────────────
   *
   * A custom window of two or three days. **Nothing here is measured** — the shop
   * was asked for five presets and for nothing between one day and seven — and it
   * exists because `bucketFor()` had a hole in exactly that range: a two-day
   * custom window answered the *seven*-day table, which is the dishonesty
   * `bucketFor` was written to avoid rather than an instance of it.
   *
   * It is where three states this harness could not otherwise reach now live, and
   * each is a branch a shipped screen already has:
   *
   *   `hasRankingSignal()` false with rows present — the flat best-sellers list
   *   `customers.returning` non-zero — every measured window is 0 / "1.0000"
   *   `unattributed.orders` zero — the row `wilayaSlices()` filters out
   *
   * Held to every invariant the measured windows hold, so it is small rather than
   * loose. `node scripts/capture.mjs "/analytics?range=custom&date_from=…"`.
   */
  narrow: {
    orders: {
      placed: 4,
      by_status: {
        pending: 1,
        processing: 1,
        "on-hold": 0,
        completed: 1,
        cancelled: 1,
        refunded: 0,
        failed: 0,
      },
      cancelled: 1,
      completed: 1,
      refunded: 0,
      guest_orders: 2,
      counted_as_revenue: 2,
    },
    customers: {
      customers: 2,
      new: 1,
      returning: 1,
      guest_orders: 1,
      rates: { new: "0.5000", returning: "0.5000" },
    },
    cod: {
      total_orders: 3,
      by_status: { pending: 1, confirmed: 1, rejected: 0, unreachable: 0, cancelled: 1 },
      // Two confirmed ever against one confirmed now, which is the distinction
      // `CodFigure.scope` exists for and the measured 30-day window's 126/84.
      confirmed_orders: 2,
      delivered_orders: 1,
      returned_orders: 0,
      rates: {
        confirmation: "0.6667",
        rejection: "0.0000",
        cancellation: "0.3333",
        delivery: "0.3333",
        return: "0.0000",
      },
    },
    shipping: {
      shipments: { total: 2, by_status: shipmentsByStatus({ delivered: 1, returned: 1 }), live: 0 },
      // The only window with a non-zero return rate. Measured, this shop returns
      // nothing at all, so `rates.return` is `"0.0000"` in all five presets and
      // the figure renders the same whether it works or not.
      rates: { delivery: "0.5000", return: "0.5000" },
      providers: [
        {
          provider: "manual",
          shipments: 1,
          delivered: 1,
          returned: 0,
          cancelled: 0,
          failed: 0,
          live: 0,
          rates: { delivery: "1.0000", return: "0.0000" },
        },
        {
          provider: "acfake",
          shipments: 1,
          delivered: 0,
          returned: 1,
          cancelled: 0,
          failed: 0,
          live: 0,
          rates: { delivery: "0.0000", return: "1.0000" },
        },
      ],
      by_wilaya: [
        { wilaya_id: 1, code: "01", name: "Adrar", name_ar: "أدرار", orders: 1, revenue: "3525.00" },
        {
          wilaya_id: 16,
          code: "16",
          name: "Algiers",
          name_ar: "الجزائر",
          orders: 1,
          revenue: "3525.00",
        },
      ],
      unattributed: { orders: 0, revenue: "0.00", reason: UNATTRIBUTED_REASON },
      shipping_revenue: "0.00",
    },
    bestSellers: BEST_SELLERS_NARROW,
    revenue: {
      currency: "DZD",
      order_total: "14100.00",
      orders_placed: 4,
      orders_counted: 2,
      gross: "7050.00",
      discounts: "0.00",
      shipping_revenue: "0.00",
      tax: "0.00",
      refunds: "0.00",
      net: "7050.00",
      collected: "3525.00",
      average_order_value: "3525.00",
      refund_count: 0,
      refunded_orders: 0,
    },
  },
  "7d": {
    orders: {
      placed: 126,
      by_status: {
        pending: 28,
        processing: 25,
        "on-hold": 0,
        completed: 8,
        cancelled: 53,
        refunded: 12,
        failed: 0,
      },
      cancelled: 53,
      completed: 8,
      refunded: 12,
      guest_orders: 59,
      counted_as_revenue: 45,
    },
    customers: {
      customers: 5,
      new: 5,
      returning: 0,
      guest_orders: 31,
      rates: { new: "1.0000", returning: "0.0000" },
    },
    cod: {
      total_orders: 84,
      by_status: { pending: 30, confirmed: 12, rejected: 6, unreachable: 0, cancelled: 36 },
      confirmed_orders: 18,
      delivered_orders: 6,
      returned_orders: 5,
      rates: {
        confirmation: "0.2143",
        rejection: "0.0714",
        cancellation: "0.4286",
        delivery: "0.0714",
        return: "0.0595",
      },
    },
    shipping: {
      shipments: {
        total: 20,
        by_status: shipmentsByStatus({ delivered: 13, cancelled: 7 }),
        live: 0,
      },
      rates: { delivery: "0.6500", return: "0.0000" },
      providers: [
        {
          provider: "manual",
          shipments: 12,
          delivered: 5,
          returned: 0,
          cancelled: 7,
          failed: 0,
          live: 0,
          rates: { delivery: "0.4167", return: "0.0000" },
        },
        {
          provider: "acfake",
          shipments: 8,
          delivered: 8,
          returned: 0,
          cancelled: 0,
          failed: 0,
          live: 0,
          rates: { delivery: "1.0000", return: "0.0000" },
        },
      ],
      by_wilaya: [
        {
          wilaya_id: 1,
          code: "01",
          name: "Adrar",
          name_ar: "أدرار",
          orders: 6,
          revenue: "25200.00",
        },
        {
          wilaya_id: 31,
          code: "31",
          name: "Oran",
          name_ar: "وهران",
          orders: 2,
          revenue: "8400.00",
        },
        {
          wilaya_id: 16,
          code: "16",
          name: "Algiers",
          name_ar: "الجزائر",
          orders: 1,
          revenue: "4200.00",
        },
      ],
      unattributed: { orders: 36, revenue: "139500.00", reason: UNATTRIBUTED_REASON },
      shipping_revenue: "0.00",
    },
    bestSellers: BEST_SELLERS_7D,
    revenue: {
      currency: "DZD",
      order_total: "412600.00",
      orders_placed: 126,
      orders_counted: 45,
      gross: "177300.00",
      discounts: "0.00",
      shipping_revenue: "0.00",
      tax: "0.00",
      refunds: "20400.00",
      net: "156900.00",
      collected: "33700.00",
      average_order_value: "3940.00",
      refund_count: 12,
      refunded_orders: 12,
    },
  },
  "30d": {
    orders: {
      placed: 901,
      by_status: {
        pending: 198,
        processing: 177,
        "on-hold": 1,
        completed: 56,
        cancelled: 379,
        refunded: 89,
        failed: 1,
      },
      cancelled: 379,
      completed: 56,
      refunded: 89,
      guest_orders: 422,
      counted_as_revenue: 323,
    },
    customers: {
      customers: 9,
      new: 9,
      returning: 0,
      // Not `orders.guest_orders`: that one counts guest orders in the window,
      // this one counts the orders the customer report could attribute to
      // nobody. Two different questions, measured 422 against 209 in one payload.
      guest_orders: 209,
      rates: { new: "1.0000", returning: "0.0000" },
    },
    // `/analytics/cod` at 30d is `/cod/statistics` key for key, measured — so it
    // *is* that constant, rather than a second copy of it that can drift.
    cod: COD_STATISTICS,
    /*
     * Measured verbatim, with one deliberate departure named where it is made:
     * **the third `by_wilaya` row is invention.** This shop attributes only two,
     * Adrar 40 and Algiers 2, and a two-row geography is a chart that proves
     * nothing about ranking, ties, or a third bar's label at 340px. So Oran —
     * one of the two the API's own fixture calls high-traffic — is carved *out
     * of* the unattributed slice rather than added beside it: 281 becomes 263,
     * and the identity that the whole set reconciles to `orders_counted` (323)
     * and to `gross` (918 100) survives. The unattributed row still dwarfs every
     * named wilaya put together, 263 against 60, which is the report's real
     * headline and the reason it is a labelled row and not a remainder.
     *
     * **`name` is `Algiers` and this file's own wilaya table says `Alger`.**
     * The measured payload sends the English exonym, README §"A wilaya's `name`"
     * records why it is deliberate in the shop, and `WILAYAS` here is the wrong
     * half — a pre-existing divergence, named rather than fixed, because that
     * table is a join key for orders, shipments and rules across this file.
     */
    shipping: {
      shipments: {
        total: 131,
        by_status: shipmentsByStatus({ delivered: 85, cancelled: 46 }),
        live: 0,
      },
      rates: { delivery: "0.6489", return: "0.0000" },
      providers: [
        {
          provider: "manual",
          shipments: 89,
          delivered: 43,
          returned: 0,
          cancelled: 46,
          failed: 0,
          live: 0,
          rates: { delivery: "0.4831", return: "0.0000" },
        },
        {
          provider: "acfake",
          shipments: 42,
          delivered: 42,
          returned: 0,
          cancelled: 0,
          failed: 0,
          live: 0,
          rates: { delivery: "1.0000", return: "0.0000" },
        },
      ],
      by_wilaya: [
        {
          wilaya_id: 1,
          code: "01",
          name: "Adrar",
          name_ar: "أدرار",
          orders: 40,
          revenue: "168000.00",
        },
        {
          wilaya_id: 31,
          code: "31",
          name: "Oran",
          name_ar: "وهران",
          orders: 18,
          revenue: "75600.00",
        },
        {
          wilaya_id: 16,
          code: "16",
          name: "Algiers",
          name_ar: "الجزائر",
          orders: 2,
          revenue: "8400.00",
        },
      ],
      unattributed: { orders: 263, revenue: "666100.00", reason: UNATTRIBUTED_REASON },
      shipping_revenue: "0.00",
    },
    bestSellers: BEST_SELLERS_30D,
    revenue: {
      currency: "DZD",
      order_total: "2345200.00",
      orders_placed: 901,
      orders_counted: 323,
      gross: "918100.00",
      discounts: "0.00",
      shipping_revenue: "0.00",
      tax: "0.00",
      refunds: "105900.00",
      net: "812200.00",
      collected: "194150.00",
      average_order_value: "2842.41",
      refund_count: 89,
      refunded_orders: 89,
    },
  },
};
ANALYTICS_FIGURES["90d"] = ANALYTICS_FIGURES["30d"];

/**
 * Which block a window gets. A preset takes its own; a **custom** window takes
 * the block whose length it is nearest, so a three-day custom range answers
 * small numbers rather than the thirty-day table.
 *
 * That bucketing is invention and is the only part of these routes with no
 * measurement behind it — nobody has asked the shop for a custom window and
 * compared. It is here because the alternative is worse in the direction this
 * harness cares about: answering the 30-day figures for every custom window
 * would let someone build a date picker, watch the numbers never move, and be
 * unable to tell that from a control the API ignores.
 *
 * **`narrow` closed a hole in that argument.** Two and three days used to land on
 * the *seven*-day table — 126 orders for a two-day window, which is the same
 * defect one step smaller. It now has a block of its own, and that block is where
 * the flat best-sellers list, a non-zero `returning` rate and an empty
 * unattributed slice live. See `ANALYTICS_FIGURES.narrow`.
 */
const bucketFor = (days) =>
  days <= 1 ? "today" : days <= 3 ? "narrow" : days <= 7 ? "7d" : days <= 30 ? "30d" : "90d";

/**
 * The API's cap on a custom window, and the three refusals around it. Measured
 * verbatim, all three under `details.fields`:
 *
 *     range=custom                          date_from + date_to  "Required when range is custom."
 *     range=custom&date_from=…              date_to              the same
 *     from > to                             date_from            "Must not be later than date_to."
 *     2020-01-01 → 2026-08-20               date_from            "A custom range covers at most 366 days."
 */
const MAX_CUSTOM_DAYS = 366;

const rangeInvalid = (fields) => invalidBody("The reporting range is invalid.", fields);

/**
 * `Y-m-d` **and a day the calendar has**, which is one check more than the
 * `dayParam()` family makes and is here for a reason rather than for tidiness.
 *
 * `/payments?date_from=2026-13-45` is a measured **200 with 0 rows** — the shape
 * matches, nothing checks the calendar, and a screen cannot tell "no rows in that
 * window" from "that is not a date". These routes cannot do the same thing:
 * `days` is computed from the two dates and `2026-13-45` makes it `NaN`, which
 * serialises as `null` and is refused by `analyticsRange.days` at the panel's own
 * boundary — a 200 the dashboard would throw on. So an impossible date joins a
 * malformed one under "Required when range is custom." rather than reaching the
 * arithmetic. Unmeasured, like the malformed case beside it, and chosen the same
 * way: it adds no sentence the API has never sent.
 *
 * **It is the one place this file is knowingly *stricter* than the shop, and it
 * now applies to seven routes rather than one.** The six reports read their
 * window through this same function, so a refusal nobody has ever seen the API
 * make is reproduced seven times over. It stays because the alternative is worse
 * in the direction that matters — a 200 the panel throws on is a screen state
 * that exists in the harness and nowhere else — but it is a real divergence and
 * one measurement would settle it: send `/analytics/orders` a
 * `range=custom&date_from=2026-13-45&date_to=2026-13-46` and record the answer.
 *
 * Note `2026-02-30` is *not* impossible to `Date.parse` — it rolls into March —
 * and is served as the window it rolls to. That is JavaScript's own leniency
 * showing through, it keeps `days` finite, and no screen can reach it.
 */
const isCustomDay = (raw) =>
  raw !== null && DAY.test(raw) && Number.isFinite(Date.parse(`${raw}T00:00:00Z`));

/**
 * Read `?range=` and its two companions, or refuse.
 *
 * **A missing `range` is the 30-day default and an empty one is a refusal** —
 * `""` is not a member of the enum, which is the same rule `?per_page=` and
 * `?status=` follow everywhere else in this file. Only a parameter that is not
 * sent at all reaches a default.
 *
 * A `date_from`/`date_to` that is not `Y-m-d` is treated as **not sent**, so it
 * reaches the "Required when range is custom." refusal rather than a pattern
 * one. That is **unmeasured** — nobody has sent this route a malformed date —
 * and it is the choice that invents nothing: it adds no sentence and no error
 * family, it mirrors `customRangeProblem()` in lib/analytics.ts, and the panel's
 * date control keeps it unreachable either way. A pattern refusal under
 * `details.params` is the other plausible answer and would be stricter than
 * anything anyone has seen this endpoint do.
 */
function readAnalyticsRange(params) {
  const raw = params.get("range");
  if (raw !== null && !ANALYTICS_PRESETS.includes(raw)) {
    return { error: invalidParam("range", notOneOf("range", ANALYTICS_PRESETS)) };
  }

  const preset = raw ?? "30d";
  if (preset !== "custom") {
    // `date_from` and `date_to` are read by nothing here on purpose: outside
    // `custom` the API accepts them and answers the preset's window anyway.
    const [from, to] = PRESET_WINDOWS[preset];
    return { value: analyticsRange(preset, analyticsDay(from), analyticsDay(to)) };
  }

  const from = params.get("date_from");
  const to = params.get("date_to");
  const fields = {};
  if (!isCustomDay(from)) fields.date_from = "Required when range is custom.";
  if (!isCustomDay(to)) fields.date_to = "Required when range is custom.";
  if (Object.keys(fields).length > 0) return { error: rangeInvalid(fields) };

  if (from > to) {
    return { error: rangeInvalid({ date_from: "Must not be later than date_to." }) };
  }
  const days = daysBetween(from, to);
  if (days > MAX_CUSTOM_DAYS) {
    return {
      error: rangeInvalid({ date_from: `A custom range covers at most ${MAX_CUSTOM_DAYS} days.` }),
    };
  }

  return { value: analyticsRange("custom", from, to) };
}

/**
 * The overview, and **the money gate is the whole reason this route is worth
 * capturing.** Measured 2026-08-26 with three real credentials: a Super Admin
 * and a Manager, both holding `ac_manage_orders`, get `revenue` and
 * `money_visible: true`; a Support Agent without it gets a 200 whose keys are
 * exactly `range, orders, customers, cod, shipping, inventory` — the block is
 * **absent**, not null and not zeroed — with `money_visible: false`, and a flat
 * 403 on `/analytics/revenue`.
 *
 * So the key is omitted here rather than emitted empty, and `meta.money_visible`
 * is computed off the same capability rather than hard-coded: a fixture that
 * printed `false` beside a present `revenue` would be the harness disagreeing
 * with itself, and one that printed `true` for everybody would make the state
 * DESIGN.md §3.7 asks for unreachable. `MOCK_IDENTITY=support` is the credential
 * that reaches it.
 *
 * **`generated_at` is pinned and that is the honest reproduction.** Two live
 * requests six seconds apart returned the identical stamp: the report sits
 * behind a 60-second server cache, which `meta.cache_ttl` reports. It is what
 * lets a Server Component's figures be up to a minute older than the navigation
 * that fetched them — the dashboard prints the stamp for exactly that reason,
 * and a screen must not read a fresh stamp as proof of a fresh request. Here it
 * never moves at all, because nothing in this file may read a clock; the
 * difference is that the harness can never show the stamp advancing, which no
 * screen depends on.
 */
/**
 * The one `meta` all seven reports carry, measured identical on every one of
 * them for both a Super Admin and a Support Agent — only `money_visible` moves.
 */
const analyticsMeta = (money) => ({
  generated_at: iso(0),
  cache_ttl: 60,
  money_visible: money,
  money_requires: "ac_manage_orders",
});

/** Whether this credential may see money at all. The gate, in one place. */
const canSeeMoney = () => IDENTITY.capabilities.includes("ac_manage_orders");

/**
 * The window and its figures, or the refusal. Shared by all seven routes, which
 * is why every one of them answers the same two 400s to the same query strings.
 */
function analyticsWindow(params) {
  const range = readAnalyticsRange(params);
  if (range.error) return range;

  const window = range.value;
  return {
    window,
    figures:
      ANALYTICS_FIGURES[window.preset === "custom" ? bucketFor(window.days) : window.preset],
  };
}

/**
 * The three low-stock rows, counted off the fixture on every request rather than
 * tabled per range: this is current state, and the measurement says a 90× window
 * does not move it — `{"products":3}` at today, 7d, 30d and 90d alike, exactly
 * like the overview's. It is also the same three rows `/inventory/low-stock`
 * lists, which is what keeps the card and the screen it links to in agreement.
 *
 * It is **the proof that a figure can sit under a control that does not move it**,
 * and it is why `AnalyticsScreen` leaves `products` out of its empty-window list.
 */
const lowStockCount = () => inventoryRows().filter((row) => row.low_stock).length;

function analyticsOverview(params) {
  const scope = analyticsWindow(params);
  if (scope.error) return scope.error;

  const { window, figures } = scope;
  const money = canSeeMoney();

  return ok(
    {
      range: window,
      orders: figures.orders,
      customers: figures.customers,
      cod: codOverview(figures.cod),
      shipping: shippingOverview(figures.shipping),
      inventory: { low_stock: lowStockCount() },
      ...(money ? { revenue: withUnavailable(figures.revenue) } : {}),
    },
    analyticsMeta(money),
  );
}

/**
 * ── The six reports, and the money gate that is not one shape but two ────────
 *
 * Measured 2026-08-26 with a Support Agent — `ac_view_analytics` without
 * `ac_manage_orders`, which is `MOCK_IDENTITY=support` here:
 *
 *     /analytics/revenue    403 forbidden — the only 403 in this whole surface
 *     the other five        200, with **every money key gone, nested included**
 *
 * The five 200s are the subtle half and the schemas already record which keys
 * they are: `orders.average_order_value` and `orders.currency`,
 * `best_sellers[].revenue`, `by_wilaya[].revenue`, `unattributed.revenue`,
 * `shipping.shipping_revenue` and `shipping.currency`. **Omitted key by key,
 * never nulled and never zeroed** — so `customers` and `cod` are byte-identical
 * for both credentials, because neither carries a money key at all.
 *
 * That is what a schema cannot catch on its own: every money field in
 * lib/api/schemas/analytics.ts is `.optional()`, so a fixture emitting
 * `revenue: "0.00"` here would parse cleanly and teach a screen that a Support
 * Agent sees a shop that sold nothing.
 *
 * **`generated_at` is pinned and that is the honest reproduction.** Two live
 * requests six seconds apart returned the identical stamp: the reports sit behind
 * a 60-second server cache, which `meta.cache_ttl` reports. It is what lets a
 * Server Component's figures be up to a minute older than the navigation that
 * fetched them — the dashboard prints the stamp for exactly that reason, and a
 * screen must not read a fresh stamp as proof of a fresh request. Here it never
 * moves at all, because nothing in this file may read a clock. **The cost is
 * real and unchanged by this branch**: no screen can be exercised against a
 * stamp that advances, so `StaleBanner`'s relative time is frozen too, and the
 * one thing a capture cannot show is the moment the data goes stale.
 */
function analyticsRevenue(params) {
  const scope = analyticsWindow(params);
  if (scope.error) return scope.error;
  // The whole route, not a key of it. This is the only 403 on the surface.
  if (!canSeeMoney()) return forbidden();

  return ok(
    { range: scope.window, ...withUnavailable(scope.figures.revenue) },
    analyticsMeta(true),
  );
}

function analyticsOrders(params) {
  const scope = analyticsWindow(params);
  if (scope.error) return scope.error;

  const money = canSeeMoney();
  const { revenue } = scope.figures;

  return ok(
    {
      range: scope.window,
      ...scope.figures.orders,
      // Both measured identical to the revenue report's own, in one payload —
      // so they are read off it rather than restated, and they are the two keys
      // that vanish for a reader without the capability.
      ...(money
        ? { average_order_value: revenue.average_order_value, currency: revenue.currency }
        : {}),
    },
    analyticsMeta(money),
  );
}

function analyticsProducts(params) {
  const scope = analyticsWindow(params);
  if (scope.error) return scope.error;

  const money = canSeeMoney();

  return ok(
    {
      range: scope.window,
      best_sellers: scope.figures.bestSellers.map(({ revenue, ...row }) =>
        money ? { ...row, revenue } : row,
      ),
      best_sellers_limit: BEST_SELLERS_LIMIT,
      low_stock: { products: lowStockCount() },
    },
    analyticsMeta(money),
  );
}

function analyticsCustomers(params) {
  const scope = analyticsWindow(params);
  if (scope.error) return scope.error;

  // No money key anywhere in this payload, so the two credentials get the same
  // bytes. `guest_orders` here is **not** the orders report's — 209 against 422,
  // measured in one window — and this report exists partly to say so.
  return ok({ range: scope.window, ...scope.figures.customers }, analyticsMeta(canSeeMoney()));
}

function analyticsShipping(params) {
  const scope = analyticsWindow(params);
  if (scope.error) return scope.error;

  const money = canSeeMoney();
  const report = scope.figures.shipping;

  return ok(
    {
      range: scope.window,
      shipments: report.shipments,
      rates: report.rates,
      providers: report.providers,
      // The one `unavailable` key this report carries, out of the same object
      // the revenue report's three come from rather than restated beside it.
      unavailable: { shipping_cost: ANALYTICS_UNAVAILABLE.shipping_cost },
      by_wilaya: report.by_wilaya.map(({ revenue, ...row }) =>
        money ? { ...row, revenue } : row,
      ),
      unattributed: money
        ? report.unattributed
        : { orders: report.unattributed.orders, reason: report.unattributed.reason },
      ...(money ? { shipping_revenue: report.shipping_revenue, currency: "DZD" } : {}),
    },
    analyticsMeta(money),
  );
}

function analyticsCod(params) {
  const scope = analyticsWindow(params);
  if (scope.error) return scope.error;

  // `/cod/statistics` with a range on it, measured key for key — so at 30d this
  // *is* that constant. `by_status.confirmed` (84) differs from
  // `confirmed_orders` (126) here as it does there: the shop now, against every
  // order ever confirmed.
  return ok({ range: scope.window, ...scope.figures.cod }, analyticsMeta(canSeeMoney()));
}

/** Which handler serves which report. `overview` is routed beside them. */
const ANALYTICS_REPORTS = {
  revenue: analyticsRevenue,
  orders: analyticsOrders,
  products: analyticsProducts,
  customers: analyticsCustomers,
  shipping: analyticsShipping,
  cod: analyticsCod,
};

/* --------------------------------------------------------------- communes --- */

/**
 * A commune list per wilaya, which `/locations/wilayas` alone cannot fill: the
 * create-parcel form asks for both halves of a destination and the API validates
 * them before anything else on the body.
 *
 * **There is no Zod schema for this route in the panel** — `CreateParcelDrawer`,
 * `RulesScreen`, `Resolver`, `RuleForm` and `ParcelDrawer` all read it with an
 * untyped `acRead<Commune[]>` and a local `{id, name, name_ar}` — so the shape
 * here is those three keys plus the two a
 * wilaya row carries for the same purpose. Ids run globally rather than per
 * wilaya, the way the measured shipping rules use them (wilaya 16 / commune 484).
 *
 * The names are synthetic, and visibly so. Inventing 1 541 real commune names
 * would be a fixture nobody could check against anything.
 */
const COMMUNE_PARTS = [
  ["Centre", "الوسط"],
  ["Est", "الشرق"],
  ["Ouest", "الغرب"],
  ["Nord", "الشمال"],
  ["Sud", "الجنوب"],
];

const COMMUNES = new Map();
{
  let nextCommuneId = 1;
  for (const wilaya of WILAYAS) {
    const count = 3 + (wilaya.id % 3);
    COMMUNES.set(
      wilaya.id,
      Array.from({ length: count }, (_, slot) => ({
        id: nextCommuneId++,
        wilaya_id: wilaya.id,
        name: `${wilaya.name} ${COMMUNE_PARTS[slot][0]}`,
        name_ar: `${wilaya.name_ar} ${COMMUNE_PARTS[slot][1]}`,
        is_active: true,
      })),
    );
  }

  /*
   * **483 and 484, by hand, because the resolver cannot be exercised without
   * them.** The generator above hands out 231 ids for 58 wilayas while the real
   * table runs to 1 541, so Alger's communes here stop around 64 — and the
   * measured commune rule (164) is pinned to commune **484**, which no picker
   * could ever select. The rules preview would then have had only the wilaya and
   * national arms to resolve, and *commune beats wilaya* — the one thing the
   * whole rules table exists to display — would have been unreachable in the
   * harness while working perfectly in the shop.
   *
   * These are also the two ids the seeded parcels are sent to, so a shipment row
   * can name its destination rather than showing an id that resolves to nothing.
   */
  COMMUNES.get(16).push(
    { id: 483, wilaya_id: 16, name: "Alger Aïn Taya", name_ar: "الجزائر عين طاية", is_active: true },
    { id: 484, wilaya_id: 16, name: "Alger Centre", name_ar: "الجزائر الوسط", is_active: true },
  );
}

/* ------------------------------------------------------------ write state --- */

/**
 * ── How a write can be stateful and a capture run still byte-stable ──────────
 *
 * The writes below are genuinely stateful: PATCH a status, read the order back,
 * and the new value is there. Without that a screen that writes and refetches
 * cannot be verified at all — it would always redisplay what it had.
 *
 * The trick is that there is nothing to unwind. Every mutable thing lives in this
 * one object, `resetState()` rebuilds all of it from the seeds above, and
 * `resetState()` runs once at module load. So *within* a process a write is
 * visible to every later read, and *between* processes nothing carries over: a
 * second `node` starts from the identical baseline, because the seeds are written
 * out, derived from ids, and touch neither the clock nor the PRNG.
 *
 * The unit suite calls it between tests for the same reason.
 */
const state = {
  /** Order id → status, and **empty until something PATCHes**. */
  statuses: new Map(),
  cod: new Map(),
  shipments: new Map(),
  payments: new Map(),
  nextShipmentId: 0,
  /**
   * Rule id → the whole row as it reads now, holding the three seeded rules a
   * PATCH has rewritten **and** the rows `POST /shipping/rules` created. A
   * delete removes the entry outright — unlike a coupon, a rule has no trash.
   */
  rules: new Map(),
  nextRuleId: 0,
  /** Product id → the whole row as it reads now. Empty until something PATCHes. */
  products: new Map(),
  /** Force-deleted product ids. A permanent delete is the one thing that 404s. */
  gone: new Set(),
  /**
   * Variation id → the whole body as it reads now. An adjustment moves a
   * variation's own shelf and `PATCH /inventory/{id}` decides whether it has
   * one, and neither of those goes through `state.products`.
   */
  variations: new Map(),
  /**
   * Inventory id → `{backorders?, low_stock_amount?}`.
   *
   * The two settings that live on **neither** a product body nor a variation
   * body: `inventoryRows()` computes both, so a write to either has to be kept
   * beside the row. Keyed by the inventory id, which is the product id for a
   * top-level row and the variation id for a variation.
   */
  stockSettings: new Map(),
  /** Movements this process has written, newest first. Prepended to the archive. */
  movements: [],
  nextMovementId: 0,
  /**
   * Coupon id → the whole row as it reads now. Holds both the seeded rows a
   * PATCH or a trash has rewritten **and** the rows `POST /coupons` created, so
   * one lookup answers for either.
   */
  coupons: new Map(),
  /** Ids created in this process, newest first — the head of the list. */
  createdCoupons: [],
  /**
   * Force-deleted coupon ids. The distinction this set exists for: a trashed
   * coupon keeps its code and still collides, and a forced one frees it.
   */
  couponsGone: new Set(),
  nextCouponId: 0,
};

export function resetState() {
  state.statuses = new Map();
  state.cod = new Map(ORDERS.map((order) => [order.id, seedCod(order)]));
  state.shipments = seedShipments();
  state.payments = seedPayments();
  // Above the two seeded ids and far enough from them to read as new.
  state.nextShipmentId = 7100;
  state.rules = seedRules();
  // The id the measured round-trip actually got — `POST` created 179 and the
  // `DELETE` after it put the shop back to three rules. Fixed rather than
  // derived, which is what keeps a screenshot of a created rule byte-stable.
  state.nextRuleId = 179;
  state.products = new Map();
  state.gone = new Set();
  state.variations = new Map();
  state.stockSettings = new Map();
  state.movements = [];
  // Above the 1154 seeded ids, and the same figure in every process, which is
  // what keeps a screenshot of a written movement byte-stable.
  state.nextMovementId = MOVEMENT_ID_BASE + MOVEMENT_COUNT + 46;
  state.coupons = new Map();
  state.createdCoupons = [];
  state.couponsGone = new Set();
  // Above the six seeded ids and far enough from them to read as new — the same
  // rule `nextShipmentId` follows, and the same figure in every process.
  state.nextCouponId = 320;
}

resetState();

const statusOf = (order) => state.statuses.get(order.id) ?? order.status;
const shipmentsOf = (orderId) => state.shipments.get(orderId) ?? [];

/**
 * Every parcel in the shop, newest id first.
 *
 * **The resting order is not measured.** What *is* measured is that nothing can
 * change it: `orderby` × eight fields × both directions returned a byte-identical
 * id sequence to `?bogus_param=1`, and `?orderby=zzz` is a 200 — the parameter
 * never reaches a validator, so it cannot be reaching a sort. Descending id is
 * the choice this file makes; the point of the fixture is that no request can
 * make it any other order.
 */
const allShipments = () =>
  [...state.shipments.values()].flat().sort((a, b) => b.id - a.id);
const paymentsOf = (orderId) => state.payments.get(orderId) ?? [];

/**
 * The catalogue as it reads **now**: every seeded row replaced by whatever a
 * PATCH wrote over it, and the force-deleted ones gone entirely.
 *
 * `CATALOGUE` and `LISTED` above stay the *seeds* and are still what the
 * vocabularies count — `CATEGORIES`, `TAGS` and `TERMS` publish a `count`
 * computed once at load. The real API recounts on every read, so a PATCH that
 * moves a product between categories leaves those counts stale here. Named
 * rather than hidden: the alternative is recomputing three vocabularies per
 * request to move a number no screen writes.
 */
const catalogue = () =>
  CATALOGUE.filter((product) => !state.gone.has(product.id)).map(
    (product) => state.products.get(product.id) ?? product,
  );

/** What `/products` lists: everything readable except the trash. */
const listed = () => catalogue().filter((product) => product.status !== "trash");

/** One row by id, through the write state. Undefined once it has been forced. */
const productById = (id) =>
  id === null || state.gone.has(id)
    ? undefined
    : (state.products.get(id) ?? CATALOGUE.find((product) => product.id === id));

/**
 * An order at a new status, with everything the seed derives from it recomputed.
 *
 * Not decoration. `is_editable` is false once stock has moved, so a mock that
 * left it true after a PATCH to `completed` would render a line-item editor on a
 * finished order — a screen state the real API never produces, arrived at through
 * the harness rather than despite it.
 *
 * The two dates are the one thing this cannot do properly, because there is no
 * clock in this file: an order that becomes paid or completed is stamped with its
 * own `date_modified` rather than with "now", and an existing stamp is kept.
 */
function withStatus(order, status) {
  const paid = status === "completed" || status === "processing" || status === "refunded";
  return {
    ...order,
    status,
    is_editable: status === "pending" || status === "on-hold",
    needs_payment: !paid && status !== "cancelled" && status !== "failed",
    stock_reduced: paid,
    date_paid: paid ? (order.date_paid ?? order.date_modified) : order.date_paid,
    date_completed:
      status === "completed"
        ? (order.date_completed ?? order.date_modified)
        : order.date_completed,
  };
}

/** The row as it reads *now*. Identity when nothing has been written to it. */
const orderRow = (order) => {
  const status = statusOf(order);
  return status === order.status ? order : withStatus(order, status);
};

/**
 * One customer's orders as they read **now**, newest first — what
 * `GET /customers/{id}/orders` serves and what the statistics below are counted
 * from. Read through the write state, so a PATCHed status moves the row, the
 * breakdown and the report together rather than leaving three screens disagreeing
 * about one order.
 */
const ordersOf = (customerId) => seededOrdersOf(customerId).map(orderRow);

/**
 * ── The detail's `statistics`, counted rather than written out ───────────────
 *
 * **The list must not carry this** — the two shapes differ by exactly this key,
 * which lib/api/schemas/customer.ts is explicit about, and it is the first
 * collection in this API where the row and the detail are different objects.
 *
 * Every figure is derived from `ordersOf()`, and that is the repair: these used to
 * be written out beside an order book that gave the same customer twenty-one
 * orders, so the report said 6 and the collection said 21 with nothing able to
 * notice. Derivation makes the invariants free rather than promised —
 * **`by_status` sums to `total_orders`** because it is a tally of the same list,
 * which is the property lib/api/schemas/customer.ts:119-137 says the block is
 * rendered for.
 *
 * **The arithmetic trap survives, and is the reason this is not simpler.**
 * `total_revenue` is the sum of the *completed* orders and `average_order_value`
 * is over the same ones, so `total_revenue ÷ total_orders` is **not** the average
 * — 2100 ÷ 5 is 420 against a stated 1050 on the measured customer. Every figure
 * is internally consistent and only labelling can make that visible, which is
 * what `statFigures()` gives each one a `scope` for. A mock whose revenue divided
 * neatly into its order count would delete the whole reason that type exists.
 *
 * `returned_orders` is counted as the **refunded** ones. That mapping is an
 * inference — WooCommerce has no `returned` status and nothing measured says what
 * feeds this field — and it is written here rather than left in the code so the
 * next reader can disagree with it.
 */
function statisticsFor(customer) {
  const rows = ordersOf(customer.id);

  const byStatus = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
  for (const row of rows) byStatus[row.status] += 1;

  const completed = rows.filter((row) => row.status === "completed");
  const revenue = completed.reduce((sum, row) => sum + Number.parseFloat(row.total), 0);

  // Four fields, not an order: reaching for the rest would be a request the panel
  // has not made. lib/api/schemas/customer.ts says so.
  const summary = (order) =>
    order === undefined
      ? null
      : { id: order.id, date: order.date_created, status: order.status, total: order.total };

  return {
    total_orders: rows.length,
    completed_orders: completed.length,
    cancelled_orders: byStatus.cancelled,
    returned_orders: byStatus.refunded,
    total_revenue: revenue.toFixed(2),
    average_order_value:
      completed.length === 0 ? "0.00" : (revenue / completed.length).toFixed(2),
    // The book is newest first, so the oldest order is the last row.
    first_order: summary(rows[rows.length - 1]),
    last_order: summary(rows[0]),
    by_status: byStatus,
  };
}

/* ---------------------------------------------------------------- refusals --- */

/**
 * Which moves an order allows — one rule rather than a seven-row table.
 *
 * Measured 2026-08-20: from `processing`, `PATCH {status:"pending"}` answers
 *
 *     409 {"code":"conflict","details":{"from":"processing","to":"pending",
 *          "allowed":["on-hold","completed","cancelled","refunded","failed"]}}
 *
 * which is every status except the current one and except `pending`, in the
 * vocabulary's own order. A cancelled or refunded order answers `allowed: []` —
 * a real answer meaning *finished*, and different from the field being absent.
 *
 * So: nothing goes back to `pending` once it has left, and a terminal order goes
 * nowhere. Written as the rule because the alternative is six rows of invention
 * around the one row that was measured.
 */
const TERMINAL_ORDER_STATUSES = ["cancelled", "refunded"];

const allowedMoves = (from) =>
  TERMINAL_ORDER_STATUSES.includes(from)
    ? []
    : ORDER_STATUSES.filter((status) => status !== from && status !== "pending");

/**
 * A body field's errors arrive under `details.fields` — an object of messages,
 * one per control — while a *query* parameter's arrive under `details.params`.
 * Measured on `POST /orders/{id}/shipments`, which answers `fields` naming both
 * halves of the destination at once, and it is why `ApiError` exposes the two
 * separately: a form that read only `params` would render a generic sentence and
 * throw the per-control half away.
 */
const invalidBody = (message, fields) =>
  fail(400, "invalid_request", message, { fields });

const conflict = (message, details) => fail(409, "conflict", message, details);

/** `PATCH /orders/{id}` — one field, and the transition is the whole story. */
function patchOrder(order, body) {
  const to = body?.status;
  if (typeof to !== "string" || !ORDER_STATUSES.includes(to)) {
    return invalidBody("Invalid parameter(s): status", {
      status: oneOf(ORDER_STATUSES),
    });
  }

  const from = statusOf(order);
  const allowed = allowedMoves(from);
  if (!allowed.includes(to)) {
    return conflict(`An order cannot move from ${from} to ${to}.`, { from, to, allowed });
  }

  state.statuses.set(order.id, to);
  return ok(withStatus(order, to));
}

/**
 * `PATCH /orders/{id}/cod` — `enabled` and nothing else.
 *
 * **Every other field is read-only and dropped silently**: no 400, no mention in
 * the response, the record simply comes back with the rest of it unchanged. That
 * is why the panel can PATCH the whole GET body back without thinking about it,
 * and it is worth reproducing precisely because a mock that answered 400 for a
 * stray key would send someone off building a field filter nobody needs.
 */
function patchCod(order, body) {
  const enabled = body?.enabled;
  if (typeof enabled !== "boolean") {
    return invalidBody("Invalid parameter(s): enabled", {
      enabled: "enabled is not of type boolean.",
    });
  }
  const record = { ...state.cod.get(order.id), enabled };
  state.cod.set(order.id, record);
  return ok(record);
}

/**
 * `POST /orders/{id}/cod/attempts` — the three gates, in the order the API
 * applies them, so the reason on screen is the reason the server would have
 * given:
 *
 *   1. `enabled`            409 {order_id}
 *   2. the order's status   409 {order_status}
 *   3. the transition       409 {from, to, allowed} — the only one with a list
 *
 * The two statuses that refuse an attempt outright are the same two that are
 * terminal for a transition. lib/cod-status.ts keeps its own copy of them
 * deliberately: they are different rules that happen to coincide, and nobody
 * phones a customer to confirm an order that has been cancelled.
 */
function postCodAttempt(order, body) {
  const outcome = body?.outcome;
  if (typeof outcome !== "string" || outcome === "") {
    /*
     * A *missing* outcome gets a different sentence from an invalid one —
     * measured, and the difference is the word "Required".
     *
     * **The code was `rest_missing_callback_param` until 2026-08-25**, and it
     * is the same defect DECISIONS.md records against fourteen refusals on this
     * file: `ErrorNormalizer.php:31-32` maps that code *and*
     * `rest_invalid_param` to `invalid_request` on the way out, so no client
     * can ever receive either. This one and `/inventory/lookup` survived that
     * sweep because they are **missing**-parameter refusals rather than
     * invalid-value ones, so a search for the code that had been named turned
     * them up and a search for the class did not. The sentences were right the
     * whole time, which is what let it hide.
     */
    return fail(400, "invalid_request", "Missing parameter(s): outcome", {
      fields: { outcome: `Required. One of: ${COD_ATTEMPT_OUTCOMES.join(", ")}.` },
    });
  }
  if (!COD_ATTEMPT_OUTCOMES.includes(outcome)) {
    return invalidBody("Invalid parameter(s): outcome", {
      outcome: oneOf(COD_ATTEMPT_OUTCOMES),
    });
  }

  const reason = body?.reason ?? "";
  if (typeof reason !== "string" || reason.length > 500) {
    return invalidBody("Invalid parameter(s): reason", {
      reason: "reason must be 500 characters or fewer.",
    });
  }

  const record = state.cod.get(order.id);
  if (!record.enabled) {
    return conflict("Cash on delivery is not enabled for this order.", {
      order_id: order.id,
    });
  }

  const orderStatus = statusOf(order);
  if (TERMINAL_ORDER_STATUSES.includes(orderStatus)) {
    return conflict("This order is closed and cannot take a delivery call.", {
      order_status: orderStatus,
    });
  }

  if (!record.allowed_outcomes.includes(outcome)) {
    return conflict(`A ${record.status} order cannot be recorded as ${outcome}.`, {
      from: record.status,
      to: outcome,
      allowed: record.allowed_outcomes,
    });
  }

  // No clock here either, so the attempt is stamped with the order's own
  // `date_modified`. A blank reason does not overwrite the recorded one.
  const next = {
    ...record,
    status: outcome,
    attempts: record.attempts + 1,
    confirmed_at: outcome === "confirmed" ? order.date_modified : record.confirmed_at,
    last_attempt_at: order.date_modified,
    reason: reason.trim() === "" ? record.reason : reason.trim(),
    allowed_outcomes: COD_NEXT_OUTCOMES[outcome],
  };
  state.cod.set(order.id, next);
  return ok(next);
}

/**
 * `POST /orders/{id}/shipments`.
 *
 * **The destination is validated before anything else and does not come off the
 * order.** Measured: `POST {}` answers 400 with `details.fields` naming both
 * `wilaya_id` and `commune_id`, and so does a body carrying only a provider. So
 * the form has to ask for a destination the order already appears to have —
 * which is the same fact analytics rests on, that a wilaya comes off the shipment
 * and never off the address.
 *
 * Then the constraint: **one live shipment per order**, enforced by the database.
 * History accumulates and does not block — order 3939 carries four finished
 * parcels and may have a fifth — so this reads `is_live` rather than counting
 * rows, and the 409 names the parcel in the way, because the real one does.
 *
 * `provider` and `delivery_type` are taken as given. The destination is the only
 * refusal that was measured on this route, and a validation nobody has seen the
 * API perform is a validation a screen would be built against for nothing.
 */
function postShipment(order, body) {
  const fields = {};
  const wilayaId = Number(body?.wilaya_id);
  const communeId = Number(body?.commune_id);
  /*
   * **Measured 2026-08-25 on a live parcel, and both sentences here were this
   * file's own prose.** `POST /orders/4586/shipments {}` answers
   *
   *     {"code":"invalid_request","message":"The shipment data is invalid.",
   *      "details":{"fields":{"wilaya_id":"Required.","commune_id":"Required."}}}
   *
   * A plain `"Required."` on each — the same word the rules collection uses for
   * the same problem — and the envelope's own message is the generic
   * `"The shipment data is invalid."`, not the `Invalid parameter(s): …` this
   * line used to build out of the field names. Both were inventions: the
   * *requirement* was measured on an earlier branch and the *wording* was
   * filled in, which is exactly how a screen ends up quoting a sentence the
   * shop never sends.
   */
  if (!Number.isInteger(wilayaId) || wilayaId <= 0) fields.wilaya_id = "Required.";
  if (!Number.isInteger(communeId) || communeId <= 0) fields.commune_id = "Required.";
  if (Object.keys(fields).length > 0) {
    return invalidBody("The shipment data is invalid.", fields);
  }

  const live = shipmentsOf(order.id).find((shipment) => shipment.is_live);
  if (live !== undefined) {
    /*
     * **Measured 2026-08-25**, by creating parcel 258 against order 4586 and
     * posting a second one while it was live:
     *
     *     {"code":"conflict","message":"This order already has a shipment in
     *      progress.","details":{"shipment_id":258,"provider":"manual",
     *      "status":"created"}}
     *
     * This said **"in flight"** until that measurement — ADMIN_PANEL.md had
     * recorded the `details` and no message beside them, and the sentence was
     * filled in here. The shop is all-terminal again, so the wording above is
     * the only observation of it there will be until someone makes another
     * parcel; it is written out rather than paraphrased for that reason.
     */
    return conflict("This order already has a shipment in progress.", {
      shipment_id: live.id,
      provider: live.provider,
      status: live.status,
    });
  }

  const id = state.nextShipmentId++;
  // `parcel`, not `created` — the module's `created()` envelope helper is what
  // this returns through, and a local of the same name would shadow it.
  const parcel = {
    id,
    order_id: order.id,
    provider: typeof body?.provider === "string" && body.provider !== "" ? body.provider : "manual",
    provider_shipment_id: `MAN-${id}`,
    // Empty until the courier has the parcel — a real state, and the column has
    // to render without inventing a number.
    tracking_number: "",
    status: "pending",
    is_live: true,
    metadata: {
      wilaya_id: wilayaId,
      commune_id: communeId,
      delivery_type: typeof body?.delivery_type === "string" ? body.delivery_type : "home",
      cod_amount: order.total,
    },
    // The fixture epoch, because there is no clock. Every row this route creates
    // in a given process therefore carries the same stamp, which is the price of
    // a byte-stable screenshot.
    created_at: iso(0),
    updated_at: iso(0),
  };
  state.shipments.set(order.id, [...shipmentsOf(order.id), parcel]);
  // **201**, measured 2026-08-25 on `POST /orders/4705/shipments`.
  return created(parcel);
}

/** One row by id across every order's list. Parcels and payments both need it. */
function findById(map, id) {
  if (id === null) return undefined;
  for (const list of map.values()) {
    const hit = list.find((row) => row.id === id);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * `POST /shipments/{id}/cancel`.
 *
 * A terminal parcel refuses, and **its 409 carries no `allowed` list** — an
 * order's carries one and a shipment's does not, which is the one place this
 * subject cannot follow the panel's usual "render what the API says is legal"
 * rule.
 *
 * **Corrected 2026-08-25, and both halves were wrong.** This answered
 * `"A cancelled shipment cannot be cancelled."` with `{from, to, is_live}`. The
 * wire is `"This shipment has already finished."` with `{"status":"cancelled"}`
 * — one key, the parcel's own status, and nothing about a destination. The
 * `{from, to, is_live}` shape belongs to `PATCH /shipments/{id}`, which is one
 * route away and answers a different question; copying it here gave the panel a
 * `from`/`to` pair for a request that names no `to` at all.
 *
 * `ParcelDrawer.tsx` (`ShipmentSheet.tsx` when this was written) already quotes
 * the measured sentence, so the screen and the harness disagreed and the harness
 * was the stale one.
 */
function cancelShipment(id) {
  const shipment = findById(state.shipments, id);
  if (shipment === undefined) return shipmentNotFound();
  if (!shipment.is_live) {
    return conflict("This shipment has already finished.", { status: shipment.status });
  }

  return ok(writeShipment({ ...shipment, status: "cancelled", is_live: false, updated_at: iso(0) }));
}

/**
 * A parcel's own 404, and it is **not** `notFound()`.
 *
 * `GET /shipments/999999` answers `404 not_found` with `"No shipment with that
 * id."` — measured 2026-08-25 — where an unrouted path answers `rest_no_route`.
 * The same distinction `/inventory/lookup` already makes, and `SkuLookup` reads
 * the code by name to tell "no such row" from "the request went nowhere".
 *
 * The message is measured on the `GET`. The three writes below reuse it, which
 * is not measured — nothing tried to cancel a parcel that does not exist.
 */
const shipmentNotFound = () => fail(404, "not_found", "No shipment with that id.");

/** Put a rewritten parcel back under its order, which is how they are stored. */
function writeShipment(next) {
  state.shipments.set(
    next.order_id,
    shipmentsOf(next.order_id).map((row) => (row.id === next.id ? next : row)),
  );
  return next;
}

/**
 * `GET /shipments`, and **what it refuses to do is the point of it.**
 *
 * Measured 2026-08-25, one parameter at a time against `?bogus_param=1`:
 *
 *   status     honoured, and refused by name outside its ten
 *   provider   honoured and **not validated** — `?provider=zzz` is a 200 with 0
 *              rows, so a typo is a silent empty list rather than a refusal
 *   order_id   honoured
 *
 *   is_live    ACCEPTED AND IGNORED — 129 rows, identical to the bogus control,
 *              on both `true` and `false`
 *   orderby    ACCEPTED AND IGNORED, **and not even validated**: `?orderby=zzz`
 *              is a 200
 *   order      the same
 *   search     the same — it is not a parameter of this route at all
 *
 * The four ignored ones are ignored *here* by nothing reading them, which is the
 * only way to reproduce "accepted and ignored". **`orderby` must not be
 * validated**, either: a 400 on `?orderby=zzz` would be the mock claiming the
 * parameter reaches a validator, and a validator is the first evidence anyone
 * would take for a sort existing. Eight fields × two directions returned a
 * byte-identical id sequence, over a page carrying 100 distinct ids and 82
 * distinct `created_at`, so there is nothing to tie on and nothing to sort by.
 *
 * `is_live` is the trap worth naming twice: it is a real field on every row, it
 * reads exactly like a filter, and the one question an operator most wants to
 * ask — *live parcels only* — is not a request this server can answer.
 */
function shipmentsListing(params) {
  const status = params.get("status");
  if (status !== null && !SHIPMENT_STATUSES.includes(status)) {
    // `""` is a value and not an absence — the model this file's other
    // collections were measured against — and it is not a member of this enum,
    // so it is refused like any other non-member. Inferred from that model
    // rather than measured on this route: the panel omits the parameter for
    // "every status" and never sends an empty one.
    return invalidParam("status", notOneOf("status", SHIPMENT_STATUSES));
  }

  const provider = params.get("provider");
  const orderId = params.get("order_id");
  const rows = allShipments().filter((row) => {
    if (status !== null && row.status !== status) return false;
    if (provider !== null && row.provider !== provider) return false;
    if (orderId !== null && String(row.order_id) !== orderId) return false;
    return true;
  });

  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

/**
 * `PATCH /shipments/{id}` — `status`, and **nothing else is dropped in silence.**
 *
 * This is where the shipment breaks the rule coupons and products share.
 * Measured 2026-08-25:
 *
 *   {"zzz":1}                400  details.fields.zzz      "Unknown field."
 *   {"provider":"acfake"}    400  details.fields.provider "Unknown field."
 *   {"status":"zzz"}         400  details.fields.status   "Must be one of: …"
 *
 * A coupon or a product takes its own GET body back and drops the read-only keys
 * without comment; sending a shipment's GET body back is a 400 naming nine
 * fields. So `ParcelDrawer` sends `{status}` alone because the API requires it
 * to, not out of caution — and a mock that dropped `provider` quietly here would
 * have let a screen PATCH the whole row and watch it work.
 *
 * The refusal sentence is the **body-field** enum family — `"Must be one of: a,
 * b, c."` — and not the query-parameter family `?status=zzz` answers one route
 * away. Same vocabulary, same subject, two different sentences.
 *
 * **`{}` is a 400 asking for a status**, recorded in ADMIN_PANEL.md; the word
 * `"Required."` is this file's, borrowed from the rules collection where it *is*
 * measured, and the pairing is unmeasured. Unknown keys are reported alone when
 * there are any, so `{"zzz":1}` answers exactly the one field the wire showed.
 */
function patchShipment(id, body) {
  const shipment = findById(state.shipments, id);
  if (shipment === undefined) return shipmentNotFound();

  const fields = {};
  for (const key of Object.keys(body ?? {})) {
    if (key !== "status") fields[key] = "Unknown field.";
  }
  if (Object.keys(fields).length === 0) {
    const status = body?.status;
    if (status === undefined) fields.status = "Required.";
    else if (typeof status !== "string" || !SHIPMENT_STATUSES.includes(status)) {
      fields.status = oneOf(SHIPMENT_STATUSES);
    }
  }
  if (Object.keys(fields).length > 0) {
    return invalidBody("The shipment data is invalid.", fields);
  }

  const status = body.status;
  /*
   * A live parcel moves **anywhere, including backwards** — `in_transit` →
   * `pending` answered 200 — and a finished one moves nowhere. There is no
   * transition table on this subject, deliberately: a courier reports what it
   * reports, sometimes late and out of order, and refusing a status to defend a
   * diagram would put the shop's record at odds with the physical world.
   *
   * The 409's quotes are literal. Measured: `This shipment cannot move from
   * "cancelled" to "in_transit".` — and `{from, to, is_live}` with **no
   * `allowed` list**, which is the one refusal in this panel that cannot be
   * rendered as "here is what is legal".
   */
  if (!shipment.is_live) {
    return conflict(`This shipment cannot move from "${shipment.status}" to "${status}".`, {
      from: shipment.status,
      to: status,
      is_live: false,
    });
  }

  return ok(
    writeShipment({
      ...shipment,
      status,
      // Never stored twice: `is_live` is the negation of the terminal set and
      // the server recomputes it on every write.
      is_live: !isTerminalShipment(status),
      updated_at: iso(0),
    }),
  );
}

/**
 * `POST /shipments/{id}/sync` — **a 200 on the parcel you would not sync and a
 * refusal on the one you would.**
 *
 * On a terminal parcel it is a **200 returning the row unchanged**, measured
 * 2026-08-25 on shipment 253: not a 409, because the terminal check
 * short-circuits before the provider is ever asked. That is the only arm this
 * shop can still exercise, since it holds no live parcel.
 *
 * On a *live* one it is a **409 `sync_unsupported`** — **measured 2026-08-25**
 * on parcel 258, created against order 4586 for exactly this:
 *
 *     {"code":"sync_unsupported","message":"In-house delivery reports no status
 *      of its own; update this shipment directly."}
 *
 * **So `sync` can never succeed on this shop.** `manual` is the only provider
 * `/shipping/providers` returns, and a manual parcel is either live — refused —
 * or finished, where the answer is a 200 that changes nothing. Both states are
 * reachable in the fixture on purpose, because "the button did nothing" and
 * "the button was refused" are different screens.
 *
 * **The sentence quotes the provider's own `label`**, not its slug: *In-house
 * delivery* is what `/shipping/providers` calls `manual`. So it is built from
 * that row rather than written out — a label that changed and a message that
 * did not would be a mock disagreeing with its own provider list.
 *
 * The code settles a question this file had to reason about rather than read.
 * `sync_unsupported` is outside the four DECISIONS.md lists
 * (`invalid_request`, `not_found`, `conflict`, `unauthenticated`), and both are
 * right: `ErrorNormalizer.php:31-32` rewrites `rest_invalid_param` and
 * `rest_missing_callback_param` — WordPress's own **parameter** codes — and
 * leaves a domain code raised by a controller alone. The vocabulary is the four
 * a *parameter* refusal can carry; the wire as a whole is five.
 */
function syncShipment(id) {
  const shipment = findById(state.shipments, id);
  if (shipment === undefined) return shipmentNotFound();
  if (isTerminalShipment(shipment.status)) return ok(shipment);

  const label =
    SHIPPING_PROVIDERS.find((entry) => entry.name === shipment.provider)?.label ??
    shipment.provider;
  return fail(
    409,
    "sync_unsupported",
    `${label} reports no status of its own; update this shipment directly.`,
  );
}

/* ------------------------------------------------------------- rule writes --- */

/** The rules collection's own 404. Measured on the second `DELETE` of one id. */
const ruleNotFound = () => fail(404, "not_found", "No shipping rule with that id.");

/** A decimal string, which is what an amount is and stays. `"abc"` is refused. */
const AMOUNT = /^\d+(\.\d+)?$/;

/**
 * What a rule's `provider` may be, off the same array `/shipping/providers`
 * serves. One source, so a refusal naming `available` and the picker offering
 * the choices can never drift apart.
 */
const RULE_PROVIDERS = SHIPPING_PROVIDERS.map((entry) => entry.name);

const readAmount = (value) => {
  const raw = typeof value === "number" ? String(value) : value;
  return typeof raw === "string" && AMOUNT.test(raw)
    ? // Normalised to the two decimals every measured amount carries. The panel
      // sends what a person typed, and `"999"` reading back as `"999"` where the
      // shop stores `"999.00"` would be a difference a form could see.
      { value: Number.parseFloat(raw).toFixed(2) }
    : { error: "Must be an amount." };
};

/**
 * The eight writable fields, and the six sentences.
 *
 * **Four of these messages are measured and two are not.** `"Required."`,
 * `"Must be an amount."`, `"Unknown field."` and the `delivery_type` enum are
 * verbatim from the wire, 2026-08-25. `"Must be a whole number."` and
 * `"Must be true or false."` were written here: nothing sent a bad `wilaya_id`
 * or a bad `is_active`, so the *refusal* is inferred from the fields being typed
 * at all. They are here rather than absent because a body that stored `NaN`
 * would answer a row the panel's own schema rejects — a mock producing data the
 * real boundary would refuse is the failure this suite exists to prevent — but
 * a future audit should take the two measurements rather than trust these.
 */
const WHOLE_NUMBER = "Must be a whole number.";
const readWholeNumber = (value, { nullable = false } = {}) => {
  if (nullable && value === null) return { value: null };
  return Number.isInteger(value) && value >= 0 ? { value } : { error: WHOLE_NUMBER };
};

const RULE_FIELDS = {
  amount: readAmount,
  /*
   * **Writable, and validated against the registered provider list** — measured
   * 2026-08-25 on both verbs:
   *
   *     PATCH {"provider":"acfake"}
   *     → 400 {"fields":{"provider":"Unknown provider \"acfake\"."},
   *            "available":["manual"]}
   *
   * `""` is accepted on both and stores `""`; a POST that omits the key stores
   * `""` too. A POST that sends `"manual"` stores `"manual"`, which is the whole
   * of why the shop's three seeded rules read `manual` while the round-trip rule
   * 179 read `""`.
   *
   * **A rule's provider and a shipment's are two vocabularies under one word.**
   * 42 of the 129 parcels carry `acfake` and this route refuses it, because
   * `acfake` is registered at runtime by the backend's webhook suite and is not
   * a registered *shipping* provider. So they must not share an enum here: a
   * mock that validated shipments against this list would refuse a third of the
   * collection, and one that let rules through would let a screen save a tariff
   * the shop rejects.
   *
   * `available` comes off `SHIPPING_PROVIDERS` — the same array
   * `GET /shipping/providers` serves — so the refusal and the picker cannot
   * disagree about what is registered.
   */
  provider: (value) => {
    if (typeof value !== "string") return { error: "Must be a string." };
    if (value === "" || RULE_PROVIDERS.includes(value)) return { value };
    return {
      error: unknownOf("provider", value),
      /*
       * **A sibling of `fields`, not a member of it** — and nothing in the
       * panel reads it. Every reader in `lib/api/` looks at `details.fields`
       * and `details.params` and stops, so this key is invisible today. It is
       * the API naming the legal set, which is the service a 409's `allowed`
       * array performs for an order transition and which
       * `lib/shipment-status.ts` records the *shipment* 409 as lacking. Written
       * out here so a future screen has it and a future audit does not have to
       * rediscover that it was ever sent.
       */
      details: { available: RULE_PROVIDERS },
    };
  },
  free_over: (value) => (value === null ? { value: null } : readAmount(value)),
  wilaya_id: (value) => readWholeNumber(value),
  commune_id: (value) => readWholeNumber(value),
  estimated_days: (value) => readWholeNumber(value, { nullable: true }),
  delivery_type: (value) =>
    typeof value === "string" && (value === "" || DELIVERY_TYPES.includes(value))
      ? { value }
      : { error: oneOf(DELIVERY_TYPES, "empty for any") },
  is_active: (value) =>
    typeof value === "boolean" ? { value } : { error: "Must be true or false." },
};

/**
 * The four keys a write carries and the server throws away **without saying so**.
 *
 * Measured: `PATCH` the whole `GET` body back and it is a **200** rather than a
 * 400, so the keys the server owns are dropped rather than refused. This
 * collection follows the coupons/products rule — only a genuinely unknown key is
 * a 400 — and `PATCH /shipments/{id}`, one route away on the same subject, does
 * not.
 *
 * **`provider` was on this list and has been removed** — see `RULE_FIELDS`. It
 * was put here by reading "the whole GET body PATCHes back and `provider` is
 * unchanged" as *dropped*, when a value written back identically is unchanged
 * either way. The two are indistinguishable by that request, and the seed script
 * settles it: the server stores what it is sent.
 */
const RULE_DROPPED = ["id", "specificity", "created_at", "updated_at"];

function readRuleWrites(body) {
  const fields = {};
  const writes = {};
  // Whatever a reader wants beside `fields` rather than inside it. Only the
  // provider refusal uses this today, and it is the reason this is a third
  // return value rather than a flag.
  let siblings = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    if (RULE_DROPPED.includes(key)) continue;
    const reader = RULE_FIELDS[key];
    if (reader === undefined) {
      fields[key] = "Unknown field.";
      continue;
    }
    const read = reader(value);
    if (read.error !== undefined) {
      fields[key] = read.error;
      if (read.details !== undefined) siblings = { ...siblings, ...read.details };
    } else writes[key] = read.value;
  }
  return { fields, writes, siblings };
}

/**
 * The rules collection's field refusal. `fields` first, then whatever sits
 * beside it — the measured key order.
 */
const ruleInvalid = (fields, siblings) =>
  fail(400, "invalid_request", "The shipping rule is invalid.", { fields, ...siblings });

/**
 * `POST /shipping/rules` — **`amount` is the only required field.**
 *
 * Everything else is server-defaulted, measured by round-trip: a body of
 * `{"amount":"999.00","wilaya_id":31,"delivery_type":"desk","estimated_days":3}`
 * came back as a full rule, and `{"wilaya_id":16}` came back 400 with
 * `details.fields.amount` = `"Required."`.
 *
 * The defaults for the keys nobody sent are **not** measured — no POST omitted
 * `delivery_type` — and `"home"` is used because all three rules in the shop
 * carry it. Every bad field is reported at once, the way `POST
 * /orders/{id}/shipments` names both halves of a destination; which of two
 * problems the API would report first was not measured.
 */
function postRule(body) {
  const { fields, writes, siblings } = readRuleWrites(body);
  if (fields.amount === undefined && writes.amount === undefined) {
    fields.amount = "Required.";
  }
  if (Object.keys(fields).length > 0) return ruleInvalid(fields, siblings);

  const row = {
    id: state.nextRuleId++,
    provider: "",
    wilaya_id: 0,
    commune_id: 0,
    delivery_type: "home",
    amount: "0.00",
    free_over: null,
    estimated_days: null,
    is_active: true,
    specificity: 0,
    // The fixture epoch, because there is no clock in this file. Every rule
    // created in a given process carries the same stamp, which is the price of a
    // byte-stable screenshot.
    created_at: iso(0),
    updated_at: iso(0),
    ...writes,
  };
  row.specificity = ruleSpecificity(row);
  state.rules.set(row.id, row);
  // **201**, not 200 — measured 2026-08-25. The body is byte-identical either
  // way, which is how this hid from a diff that compared bodies.
  return created(row);
}

/**
 * `PATCH /shipping/rules/{id}` — partial, and its empty body is a **products**
 * ending rather than a coupon's.
 *
 * Measured: `{"amount":"111.00"}` alone is a 200; the whole GET body is a 200;
 * `{"zzz":1}` is a 400 naming the field; and `{}` is a 400 `"No supported fields
 * were provided."` **with no `details` key at all** — not the empty-object
 * `details` a careless mock emits, and not the 200 no-op a coupon answers.
 *
 * The order matters and is measured both ways round: a body of nothing but
 * unknown keys is the *field* refusal, and a body with nothing writable left in
 * it is the bare one.
 */
function patchRule(id, body) {
  const current = state.rules.get(id);
  if (current === undefined) return ruleNotFound();

  const { fields, writes, siblings } = readRuleWrites(body);
  if (Object.keys(fields).length > 0) return ruleInvalid(fields, siblings);
  if (Object.keys(writes).length === 0) {
    return bareFail(400, "invalid_request", "No supported fields were provided.");
  }

  const next = { ...current, ...writes, updated_at: iso(0) };
  next.specificity = ruleSpecificity(next);
  state.rules.set(id, next);
  return ok(next);
}

/**
 * `DELETE /shipping/rules/{id}` — `{"deleted":true,"id":179}`, and the second
 * one is a 404. A rule has no trash: unlike a coupon there is no soft state to
 * come back from, so the row is gone and the id never answers again.
 */
function deleteRule(id) {
  if (!state.rules.has(id)) return ruleNotFound();
  state.rules.delete(id);
  return ok({ deleted: true, id });
}

/**
 * `GET /shipping/rates` — the server's own resolution, and **the second shape of
 * `details.params` in this file.**
 *
 * With no parameters it answers 400 `invalid_request` `"Missing parameter(s):
 * wilaya_id, commune_id"` and `details.params` is a **bare array of names** —
 * `["wilaya_id","commune_id"]` — where `/shipments?status=zzz` puts an *object
 * of messages* under the same key. Both shapes are reproduced and neither is
 * tidied into the other: `Object.values` of an array returns its elements, so a
 * reader written for one renders the bare word `wilaya_id` at a person as though
 * it were an explanation. `lib/api/browser.ts:81-95` exists for exactly that.
 *
 * The resolution itself: **the narrowest active match wins and rules are never
 * added together.** One rate comes back, not three, even where all three rules
 * cover the destination — measured 350 / 500 / 800 across the three arms.
 *
 * `provider` on the rate is the winning **rule's** provider, falling back to the
 * configured default for a rule that names none. Measured `"manual"`, which is
 * what rule 164 carries — the two were indistinguishable while this file wrongly
 * seeded `""`, and reading it off the rule is the arm that does not need a
 * coincidence. `label` is the display string `"Delivery"` and is **not** the
 * credential a shipment's `metadata.label` is. `free_shipping` is `false` and
 * can be nothing
 * else here — `free_over` is a threshold against an order total and this route
 * is never given one.
 *
 * With no matching rule it is a **200 with `[]`**, not an error — which is what
 * the whole shop answered before `seed-shipping-rules.mjs` ran, and is reachable
 * again here by deleting the national rule.
 */
function shippingRates(params) {
  const missing = ["wilaya_id", "commune_id"].filter((name) => params.get(name) === null);
  if (missing.length > 0) {
    return fail(400, "invalid_request", `Missing parameter(s): ${missing.join(", ")}`, {
      params: missing,
    });
  }

  const read = {};
  for (const name of ["wilaya_id", "commune_id"]) {
    const raw = params.get(name);
    // Inferred, not measured: nothing sent a non-numeric destination. The type
    // family's sentence is used because it is the one this API writes for a
    // parameter that is present and of the wrong shape.
    if (!INTEGER.test(raw)) return invalidParam(name, `${name} is not of type integer.`);
    read[name] = Number.parseInt(raw, 10);
  }

  const matches = [...state.rules.values()]
    .filter(
      (rule) =>
        rule.is_active &&
        (rule.commune_id === 0 || rule.commune_id === read.commune_id) &&
        (rule.wilaya_id === 0 || rule.wilaya_id === read.wilaya_id),
    )
    .sort((a, b) => b.specificity - a.specificity || a.id - b.id);

  if (matches.length === 0) return list([]);

  const winner = matches[0];
  return list([
    {
      provider:
        winner.provider === ""
          ? SHIPPING_PROVIDERS.find((entry) => entry.is_default).name
          : winner.provider,
      service: winner.delivery_type === "" ? "home" : winner.delivery_type,
      label: "Delivery",
      amount: winner.amount,
      currency: "DZD",
      estimated_days: winner.estimated_days,
      source: "rules",
      free_shipping: false,
    },
  ]);
}

/**
 * A transaction's own 404, and it is **not** `notFound()`.
 *
 * `GET /payments/99999999` answers `404 not_found` with `"No payment with that
 * id."` — measured 2026-08-26 — where an unrouted path answers `rest_no_route`,
 * a code `ErrorNormalizer` never emits and no client can receive. The same
 * distinction `/shipments/{id}` and `/inventory/lookup` already make.
 *
 * The message is measured on the `GET`. `verifyPayment` reuses it, which is
 * **not** measured — nothing has verified a payment that does not exist — and it
 * is the shipping precedent rather than a new decision: answering `rest_no_route`
 * there would be the mock handing a screen a code the API cannot send.
 */
const paymentNotFound = () => fail(404, "not_found", "No payment with that id.");

/** Every transaction in the shop, **newest id first** — the collection's resting order. */
const allPayments = () => [...state.payments.values()].flat().sort((a, b) => b.id - a.id);

/**
 * `POST /payments/{id}/verify`, which answers something that is **not a payment**:
 * `{report, transaction}`, the provider's own answer beside the stored record.
 *
 * On the `cod` transaction — the fixture this was measured on — `report.amount`
 * and `report.currency` are **empty strings**, because a cash transaction has no
 * figure from the provider until the courier hands the money over. The report is
 * therefore not safe to format as money; `transaction` is the authority for every
 * number on screen and `report.provider_status` is what the report is worth.
 *
 * **`report.provider_status` is not read off the row's `metadata`, and it used to
 * be.** Measured 2026-08-26, a `cod` row's metadata is `{amount,
 * collect_on_delivery, currency}` and carries no status at all, while verifying
 * that same row answers `provider_status: "awaiting_delivery"` — so the report is
 * computed by the API and not echoed from the record. Only `chargily` stores a
 * `provider_status`, so that arm reads it and the cash arm states the measured
 * value. Reading it off metadata is what made this file's `cod` fixture carry an
 * invented `{provider_status}` shape the shop does not produce.
 *
 * Nothing is written. The provider's answer is unchanged, so a second verify is
 * the same 200 — which is also what keeps a capture byte-stable.
 */
function verifyPayment(id) {
  const payment = findById(state.payments, id);
  if (payment === undefined) return paymentNotFound();

  const cash = payment.provider === "cod";
  return ok({
    report: {
      status: payment.status,
      provider_status: cash
        ? payment.status === "pending"
          ? "awaiting_delivery"
          : payment.status
        : String(payment.metadata.provider_status ?? payment.status),
      amount: cash ? "" : payment.amount,
      currency: cash ? "" : payment.currency,
      metadata: payment.metadata,
    },
    transaction: payment,
  });
}

/**
 * ── `GET /payments`, and the four dimensions it really honours ───────────────
 *
 * Measured 2026-08-26, one parameter at a time against `?bogus_param=1`, over a
 * collection of 45 carrying 45 distinct ids and 44 distinct `created_at` — so
 * nothing ties and a sort that worked would have shown.
 *
 *   status      honoured, and refused by name outside its six. `?status=` is a
 *               **400** — the empty string is not a member of this enum — and
 *               `?status[]=pending` is a 400 in the *type* family, because the
 *               router receives an array where it wants a string
 *   provider     honoured and **not validated**: `?provider=zzz` is a 200 with 0
 *               rows. Case-insensitive — `?provider=COD` returns all 43 — and
 *               `?provider=` is read as an **absence**, answering all 45
 *   order_id    honoured, and validated in both the type and the range family
 *   date_from   honoured, pattern-validated, and **cut on the UTC day**
 *   date_to     the same
 *   reference   honoured — **exact match, case-insensitive** — and the screen
 *               deliberately does not offer it
 *
 *   orderby     ACCEPTED AND IGNORED, **and not even validated**: `?orderby=zzz`
 *               is a 200. Eleven values × both directions were byte-identical to
 *               the bare listing and to `?bogus_param=1`
 *   order       the same, `?order=zzz` included
 *   sort · sort_by · order_by · orderby[]   the same
 *   search · s  the same — `?search=zzz` returns all 45
 *   currency · id · include · exclude       the same, all 45
 *
 * ── What the empty string does, on all six ───────────────────────────────────
 *
 * **It is a three-way split, not an asymmetry between two parameters**, and all
 * six are measured 2026-08-26. This file's first draft of the paragraph called it
 * `status=` against `provider=` and missed the middle row entirely:
 *
 *   status=                          400  the enum sentence — `""` is not a
 *                                         member of the six
 *   order_id=                        400  the type sentence — `""` is not an
 *                                         integer
 *   date_from= · date_to=            400  the pattern sentence — `""` does not
 *                                         match
 *   provider= · reference=           200  read as an **absence**, all 45 rows
 *
 * So "the empty string is a value, not an absence" — the model this file's other
 * collections were measured against — holds only where the value reaches a
 * *validator*. Two of these six reach none, and there `""` is indistinguishable
 * from a parameter nobody sent. `?reference` with no `=` at all answers the same
 * 45. Reproduced rather than tidied into one rule.
 *
 * The `status=` arm is the shape this file already records between
 * `/products?status=` and `/coupons?status=`: the empty string is a member of one
 * enum and not of the other.
 *
 * **The date bounds are inclusive at both ends and cut on the UTC day, measured
 * rather than assumed.** The fixture's 23:07:22Z row is 00:07 on the next day in
 * Africa/Algiers and is the only row that can tell the two readings apart; it is
 * included by `date_to=2026-08-16` and excluded by `date_from=2026-08-17`. Which
 * is why the comparison here is a string compare against `created_at`'s own first
 * ten characters — those are UTC by construction, the stamp ends `Z` — and not a
 * `Date` parse through the runtime's local zone.
 *
 * `?date_from=2026-13-45` **matches the pattern and is not a date**, and answers
 * a 200 with 0 rows rather than a refusal: the router validates the shape and
 * never the calendar. An inverted range does the same.
 *
 * **Which stamp the bounds read is *unmeasurable on this shop*, which is a
 * stronger statement than unmeasured — do not file it as a gap somebody can
 * close with a request.** Checked row by row on 2026-08-26: **zero** of the 45
 * carry `created_at` and `updated_at` on different UTC days, and only one row
 * (id 40) has them differing at all — by one second, `05:30:32Z` against
 * `05:30:33Z`. So no discriminating row exists and none can be obtained without
 * writing to the shop.
 *
 * `created_at` is therefore what this file reads, stated as the assumption it is.
 * Seeding a straddling row here to "settle" it would be worse than leaving the
 * question open: it would make the harness assert a behaviour the shop cannot
 * confirm, which is the same move as inventing a refusal sentence.
 *
 * ── `?reference=` is an exact match, and inferring otherwise was a real defect ─
 *
 * Measured 2026-08-26, after a first draft of this file read it as a substring:
 *
 *   reference=AC-1    42      reference=AC      0
 *   reference=ac-1    42      reference=AC-     0
 *   reference=3939     3      reference=C-1     0
 *                             reference=AC-11   0
 *
 * The left column alone is satisfied by both readings; **the right column is what
 * separates them**, and a strict prefix returning 0 rules out `LIKE` outright.
 * The draft's reasoning was that 42 rows could not share one reference value —
 * they can, and the whole column holds two distinct values across 45 rows. A
 * substring match here would have been the mock answering requests the shop
 * refuses, which is the direction the coupons branch was burned by.
 *
 * **Case-insensitivity is measured on this parameter** (`ac-1` → 42), not
 * inferred from the collation the way `searchRows` has to infer it.
 *
 * `?reference=` is an **absence** — measured, 200 with all 45, as is the bare
 * `?reference` with no `=`. See the three-way table above: it lands with
 * `provider` rather than with `status`, because neither of them reaches a
 * validator that the empty string could fail.
 */
function paymentsListing(params) {
  /*
   * `?status[]=pending`. PHP turns the bracketed name into an array before the
   * router sees it, so the refusal is the **type** family and names `status`
   * rather than `status[]`. `URLSearchParams` does no such thing, which is why
   * this reads the bracketed key by hand — without it the parameter would look
   * absent and the request would answer a silent 200 with every row.
   */
  if (params.has("status[]")) {
    return invalidParam("status", "status is not of type string.");
  }

  const status = params.get("status");
  if (status !== null && !PAYMENT_STATUSES.includes(status)) {
    // `""` and `"pending,failed"` both land here, which is measured: this
    // collection takes exactly one value and neither the empty string nor a
    // comma list is a member of its enum.
    return invalidParam("status", notOneOf("status", PAYMENT_STATUSES));
  }

  const orderIdRead = pagingNumber(params, "order_id", null, (value) =>
    value >= 1 ? null : "order_id must be greater than or equal to 1",
  );
  if (orderIdRead.error) return orderIdRead.error;

  const from = dayParam(params, "date_from");
  if (from.error) return from.error;
  const to = dayParam(params, "date_to");
  if (to.error) return to.error;

  const orderId = orderIdRead.value;
  const provider = (params.get("provider") ?? "").toLowerCase();
  // Folded on both sides, and **compared whole**: `AC-` and `AC-11` both answer
  // zero rows against a column of `AC-1`, so this cannot be a substring. See the
  // four-request table above.
  const reference = fold(params.get("reference") ?? "");

  const rows = allPayments().filter((row) => {
    if (status !== null && row.status !== status) return false;
    if (provider !== "" && row.provider.toLowerCase() !== provider) return false;
    if (orderId !== null && row.order_id !== orderId) return false;
    if (reference !== "" && fold(row.reference) !== reference) return false;
    const day = row.created_at.slice(0, 10);
    if (from.value !== null && day < from.value) return false;
    if (to.value !== null && day > to.value) return false;
    return true;
  });

  // `orderby` and `order` are read by nothing on purpose. See the file header.
  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

/* ------------------------------------------------------------ query rules --- */

/**
 * `page` and `per_page`, genuinely. Over 100 is a **400 rather than a clamp** —
 * measured, `?per_page=500` answers `per_page must be between 1 and 100` — so a
 * footer that offered 500 would break against the real shop and must break here.
 *
 * The default is **20**, which is the API's own — stated twice from measurement,
 * in app/[locale]/(panel)/orders/query.ts and products/query.ts. It was 10 here,
 * which is the quieter half of the same class of error as a mock that is too
 * permissive: a screen that forgot to send `per_page` would have shown ten rows
 * against the harness and twenty against the shop, and the overflow assertions
 * would have been watching a table half the width of the real one.
 */
const DEFAULT_PER_PAGE = 20;

const INTEGER = /^-?\d+$/;

/**
 * One paging parameter, and **the two refusals are different sentences on
 * purpose** — the same distinction `date_expires` makes further down, one layer
 * lower. A value that is not a whole number fails the *schema*; a whole number
 * outside the bounds fails the *range*, and only the second one can tell a
 * person what the bounds are. Measured 2026-08-25 on `/coupons` and `/products`
 * alike:
 *
 *   per_page=abc  400  "per_page is not of type integer."
 *   per_page=0    400  "per_page must be between 1 (inclusive) and 100 (inclusive)"
 *   per_page=-1   400  (the same sentence — it is an integer, out of range)
 *   per_page=101  400  (the same sentence, and the only one of the five this
 *                       file already refused)
 *   page=abc      400  "page is not of type integer."
 *   page=0        400  "page must be greater than or equal to 1"
 *   page=-3       400  (the same sentence)
 *
 * Shared rather than per-collection, which is what makes the pickers refuse them
 * too — `/coupons/eligible-products` validates nothing else and must still
 * validate these.
 *
 * `page=-3` was the worst of the five: it was not merely a silent 200, it
 * reached `rows.slice(-3 * perPage)` and answered the **tail of the list** as
 * though it were a page.
 *
 * **`?per_page=` and `?page=` are type refusals, not absences** — measured
 * 2026-08-25, after the enum model above predicted it: `""` is not an integer,
 * exactly as `""` is not a member of a sort enum. Only a parameter that is not
 * sent at all reaches the defaults.
 *
 *   per_page=  400  "per_page is not of type integer."
 *   page=      400  "page is not of type integer."
 *
 * **Shared with `/payments?order_id=`, which is not a paging parameter at all**
 * and refuses in exactly these two families — measured 2026-08-26:
 *
 *   order_id=zzz  400  "order_id is not of type integer."
 *   order_id=     400  the same sentence
 *   order_id=0    400  "order_id must be greater than or equal to 1"
 *   order_id=-1   400  the same sentence
 *
 * It is called with a `fallback` of `null`, which is what "no filter" means to
 * that route. Shared rather than copied so a whole-number parameter added later
 * cannot invent a third way of saying either of these two things.
 */
function pagingNumber(params, name, fallback, range) {
  const raw = params.get(name);
  if (raw === null) return { value: fallback };
  if (!INTEGER.test(raw)) {
    return { error: invalidParam(name, `${name} is not of type integer.`) };
  }
  const value = Number.parseInt(raw, 10);
  const problem = range(value);
  return problem === null ? { value } : { error: invalidParam(name, problem) };
}

function paginate(rows, params) {
  // `per_page` first, so a request with both wrong reports the same one this
  // file has always reported. Which comes first is not measured.
  const perPageRead = pagingNumber(params, "per_page", DEFAULT_PER_PAGE, (value) =>
    value >= 1 && value <= 100
      ? null
      : "per_page must be between 1 (inclusive) and 100 (inclusive)",
  );
  if (perPageRead.error) return { error: perPageRead.error };

  const pageRead = pagingNumber(params, "page", 1, (value) =>
    value >= 1 ? null : "page must be greater than or equal to 1",
  );
  if (pageRead.error) return { error: pageRead.error };

  const page = pageRead.value;
  const perPage = perPageRead.value;

  const start = (page - 1) * perPage;
  return {
    rows: rows.slice(start, start + perPage),
    meta: {
      total: rows.length,
      page,
      per_page: perPage,
      total_pages: Math.ceil(rows.length / perPage),
    },
  };
}

/**
 * Accent-folded and lowercased. Shared with the product sorts below, where it is
 * there so a collation that depends on the runtime's ICU build cannot make a
 * screenshot differ between machines; here it is there because **MySQL's own
 * collation is accent-insensitive** and the panel's most-quoted customer
 * measurement turns on it.
 */
const fold = (value) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Substring, case-insensitive and **accent-insensitive**, over the fields a
 * person would type into.
 *
 * The folding is not a nicety. `?search=Chérif` returning a row is the trap
 * lib/customers.ts:45-60 is built around: it looks like proof that the search
 * matches names, and it is the accent-insensitive collation matching the *email*
 * `nadia.cherif@…`. Fold on one side only and that row never comes back, the
 * trap is unreachable, and the mock quietly disagrees with this file's own header.
 */
function searchRows(rows, params, fields) {
  const term = fold((params.get("search") ?? "").trim());
  if (term === "") return rows;
  return rows.filter((row) =>
    fields(row).some((value) => fold(String(value ?? "")).includes(term)),
  );
}

/**
 * `?status=` takes exactly one value and a comma list is a 400 — the measured
 * behaviour every single-select control in the panel is built on. The empty
 * string is the "no filter" sentinel and is inside the enum the router
 * validates against, which is why the real 400 message names it first.
 */
function filterByStatus(rows, params) {
  const status = params.get("status");
  if (status === null || status === "") return { rows };
  if (!ORDER_STATUSES.includes(status)) {
    return {
      error: fail(
        400,
        "invalid_request",
        `status is not one of ${ORDER_STATUSES.join(", ")}`,
        { params: { status: `status is not one of ${ORDER_STATUSES.join(", ")}` } },
      ),
    };
  }
  return { rows: rows.filter((row) => row.status === status) };
}

/* -------------------------------------------------------- product filters --- */

/**
 * `/products` has its own status set and `filterByStatus` above is **not** it:
 * that one validates against the seven order statuses, so it would answer 400
 * for `draft` and 200 for `refunded`. The two collections happen to share a
 * parameter name and share nothing else.
 */
const PRODUCT_STATUSES = ["publish", "draft", "pending", "private"];
const STOCK_STATUSES = ["instock", "outofstock", "onbackorder"];

/**
 * WordPress lists a refused enum in its own words: "a, b, c, and d" — and
 * **"a and b" for exactly two, with no comma.** `wp_sprintf_l`'s two-item case
 * is a separate branch from its three-or-more case, and this had only the
 * latter, so every two-value enum here answered "asc, and desc".
 *
 * The only two-value enum in this file is `SORT_DIRECTIONS`, so `?order=` and
 * `?order=sideways` were the whole of the damage — on every collection that
 * validates a sort. Corrected against lib/transfer.ts:189, which records a
 * measured two-value refusal from a different endpoint entirely:
 * `"mode is not one of create and update."`
 */
const oxford = (values) =>
  values.length < 2
    ? values.join("")
    : values.length === 2
      ? `${values[0]} and ${values[1]}`
      : `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;

/**
 * **An enum refusal is a sentence and ends in a full stop. A range refusal does
 * not.** Measured 2026-08-25, across three families that this file used to write
 * as two — and a **fourth arrived on `/payments` on 2026-08-26**:
 *
 *   enum     "orderby is not one of date, id, code, and usage."   full stop
 *   type     "per_page is not of type integer."                   full stop
 *   pattern  "date_from does not match pattern ^\\d{4}-\\d{2}-\\d{2}$."   full stop
 *   range    "per_page must be between 1 (inclusive) and 100 (inclusive)"   none
 *            "page must be greater than or equal to 1"                      none
 *
 * The inconsistency is WordPress's own — `rest_not_in_enum`, the type check and
 * `rest_invalid_pattern` are written as sentences, the numeric bounds are not —
 * so it cannot be tidied into a rule, only copied. Every enum message in this
 * file dropped the stop; a form quoting one back rendered a sentence the shop
 * never sends.
 *
 * **The pattern family prints the regex at the person**, which none of the other
 * three do: it names neither the legal set nor the offending value, only the
 * shape, so a screen that renders it verbatim shows `^\d{4}-\d{2}-\d{2}$` to a
 * shopkeeper. That is the API's, and a date control is what keeps it unreachable
 * — the same argument the shipping provider picker makes for `unknownOf`.
 *
 * Written as helpers so the next enum or pattern added here cannot drift again.
 * The type family already carries its stop at each site; the range family is two
 * literals in `paginate` and must keep going without one.
 */
const notOneOf = (name, values) => `${name} is not one of ${oxford(values)}.`;

const notMatching = (name, pattern) => `${name} does not match pattern ${pattern}.`;

/**
 * A `Y-m-d` query parameter, and **the pattern is the whole of the validation.**
 *
 * Measured 2026-08-26 on `/payments?date_from=`:
 *
 *   date_from=                     400  pattern — `""` is a value, not an absence
 *   date_from=20-08-2026           400  pattern
 *   date_from=2026-08-20T00:00:00Z 400  pattern — a full ISO stamp is refused
 *   date_from=2026-13-45           **200** with 0 rows — it matches the shape and
 *                                  is not a date, and nothing checks the calendar
 *
 * The last line is the one worth keeping: a screen cannot tell "no transactions
 * in that window" from "that is not a real date", because the API cannot either.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

function dayParam(params, name) {
  const raw = params.get(name);
  if (raw === null) return { value: null };
  if (!DAY.test(raw)) return { error: invalidParam(name, notMatching(name, DAY_PATTERN)) };
  return { value: raw };
}

/**
 * **The third family, found on shipping 2026-08-25 and written down here because
 * `notOneOf` covers the first only.**
 *
 * A *query parameter* refuses in WordPress's own words and names itself; a *body
 * field* refuses in the API's, names nothing, and punctuates differently:
 *
 *   1. query-parameter enum  "status is not one of a, b, and c."   Oxford comma
 *   2. body-field enum       "Must be one of: a, b, c."            colon, no "and"
 *   3. body-field enum with  "Must be one of: home, desk, or empty for any."
 *      an escape hatch
 *
 * The third is the second plus a trailing alternative that is not a value — the
 * empty string, which is a real `delivery_type` meaning *any* and cannot be
 * printed as a list item. Measured verbatim on `PATCH /shipping/rules/{id}
 * {"delivery_type":"zzz"}`.
 *
 * One helper for both, so the next body enum added to this file cannot drift the
 * way every enum in it once drifted its full stop. Every site that wrote family
 * 2 inline now calls this and emits a byte-identical sentence: `patchOrder`,
 * `postCodAttempt`, and the product write validator `mustBeOneOf()`, which is
 * this sentence wrapped in a null-or-message reader.
 *
 * Named against `notOneOf` on purpose. The two look alike because they *are* the
 * same idea; which one a route uses is decided by where the value arrived — the
 * query string or the body — and never by taste.
 */
const oneOf = (values, escape) =>
  `Must be one of: ${values.join(", ")}${escape === undefined ? "" : `, or ${escape}`}.`;

/**
 * **The fourth family, and it is the first that does not enumerate anything.**
 *
 * Measured 2026-08-25 on `PATCH /shipping/rules/{id} {"provider":"acfake"}`:
 *
 *     Unknown provider "acfake".
 *
 * Families 1-3 name the legal set inside the sentence and leave the offending
 * value out; this one quotes the **offending value** back and names the legal
 * set nowhere — it arrives beside the sentence instead, as `details.available`.
 * So the two halves that the other families fuse into one string are split
 * across two keys here, and a reader that only renders the sentence loses the
 * half that says what to do about it.
 *
 * The quoting is the same notation the shipment 409 uses for its statuses
 * (`This shipment cannot move from "cancelled" to "in_transit".`), which is why
 * this is a family rather than a one-off: a value quoted back is how this API
 * writes *the thing you sent*, and an unquoted list is how it writes *what is
 * allowed*.
 */
const unknownOf = (noun, value) => `Unknown ${noun} "${value}".`;

/** `?category=` and `?tag=` take term **ids**; `?category=tapis` is a 400. */
const ID_LIST = "^$|^[0-9]+(,[0-9]+)*$";
const idList = new RegExp(ID_LIST);

/** What WordPress's boolean sanitiser accepts. Anything else is a 400. */
const BOOLEANS = new Map([
  ["true", true],
  ["1", true],
  ["false", false],
  ["0", false],
]);

const invalidParam = (name, message) =>
  fail(400, "invalid_request", `Invalid parameter(s): ${name}`, {
    params: { [name]: message },
  });

/**
 * Read the filter set once, validating as it goes.
 *
 * Parsed rather than applied directly, because the facets below need the same
 * set with one dimension knocked out — a group that excludes its own filter is
 * not a group counted before filtering, it is a group counted with everything
 * *else* applied.
 */
function parseProductFilters(params) {
  const filters = {
    // Folded, like `searchRows` and for the same reason: the collation behind
    // this endpoint is the same one, and half the catalogue is accented.
    search: fold((params.get("search") ?? "").trim()),
    sku: (params.get("sku") ?? "").trim().toLowerCase(),
    status: "",
    categories: [],
    tags: [],
    minPrice: null,
    maxPrice: null,
    stockStatus: "",
    onSale: null,
    featured: null,
    attributes: new Map(),
  };

  /*
   * **`?status=` is a 400 on this collection and a 200 on `/coupons`**, and the
   * asymmetry is not an inconsistency in the shop: the empty string is a member
   * of the coupon status enum and is not a member of this one. Both 400s name
   * their own enum and prove it — `status is not one of , publish, and draft.`
   * there, with the empty string listed first; `status is not one of draft,
   * pending, private, and publish.` here, without it.
   *
   * Measured 2026-08-25. This read `""` as absence and answered 200, so a filter
   * sheet that cleared its status select and refetched looked correct here and
   * 400s in the shop — the same defect `checkSort` had, on a parameter where the
   * neighbouring collection genuinely does read `""` as absence.
   */
  const status = params.get("status");
  if (status !== null) {
    // A comma list is a 400 by falling straight through this — the measured
    // behaviour every single-select control in the panel is built on — and so
    // is `trash`, which is readable and unlistable.
    if (!PRODUCT_STATUSES.includes(status)) {
      const message = notOneOf("status", [...PRODUCT_STATUSES].sort());
      return {
        error: fail(400, "invalid_request", message, { params: { status: message } }),
      };
    }
    filters.status = status;
  }

  for (const [name, key] of [
    ["category", "categories"],
    ["tag", "tags"],
  ]) {
    const raw = params.get(name);
    if (raw === null || raw === "") continue;
    if (!idList.test(raw)) {
      return { error: invalidParam(name, `${name} does not match pattern ${ID_LIST}`) };
    }
    // An id nobody has heard of is **200 with zero rows**, not a 400: the value
    // is well-formed and simply matches nothing.
    filters[key] = raw.split(",").map(Number);
  }

  for (const [name, key] of [
    ["min_price", "minPrice"],
    ["max_price", "maxPrice"],
  ]) {
    const raw = params.get(name);
    if (raw === null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return { error: invalidParam(name, `${name} is not of type number.`) };
    }
    filters[key] = value;
  }

  const stock = params.get("stock_status");
  if (stock !== null && stock !== "") {
    if (!STOCK_STATUSES.includes(stock)) {
      return {
        error: invalidParam(
          "stock_status",
          notOneOf("stock_status", [...STOCK_STATUSES].sort()),
        ),
      };
    }
    filters.stockStatus = stock;
  }

  for (const [name, key] of [
    ["on_sale", "onSale"],
    ["featured", "featured"],
  ]) {
    const raw = params.get(name);
    // `""` is absent and `"false"` is a filter, and they are **not** the same
    // request: one returns the whole catalogue and the other returns the rows
    // that are not on sale. A control that conflates them stops filtering and
    // says nothing about it.
    if (raw === null || raw === "") continue;
    if (!BOOLEANS.has(raw)) {
      return { error: invalidParam(name, `${name} is not of type boolean.`) };
    }
    filters[key] = BOOLEANS.get(raw);
  }

  for (const [key, value] of params) {
    const match = /^attributes\[(.+)\]$/.exec(key);
    if (match === null || value === "") continue;
    const taxonomy = match[1];
    if (!ATTRIBUTES.some((attribute) => attribute.taxonomy === taxonomy)) {
      return {
        error: fail(400, "invalid_request", "Invalid parameter(s): attributes", {
          // **Not** `details.params`, which is where every other parameter's
          // errors go. The attributes filter reports under `details.fields` and
          // publishes the set it would have accepted beside it, at the `details`
          // level — a screen that reads only `params` renders a bare generic
          // message here and throws the useful half away.
          fields: { attributes: `${taxonomy} is not a facetable attribute taxonomy.` },
          facetable_attributes: ATTRIBUTES.map((attribute) => attribute.taxonomy),
        }),
      };
    }
    filters.attributes.set(taxonomy, value.split(","));
  }

  return { filters };
}

const NOTHING = new Set();

/** The effective price as a number. `""` is a real value and stores as zero. */
const priceOf = (product) =>
  product.price === "" ? 0 : Number.parseFloat(product.price);

/**
 * One row against the filter set, with `skip` naming the dimensions to ignore.
 *
 * `search` is never skipped, including by the facets: measured, `?search=tapis`
 * cut the category group from six values to two, so a search narrows the counts
 * the way any other filter does.
 */
function matchesProduct(product, filters, skip = NOTHING) {
  if (filters.search !== "") {
    const haystack = fold(`${product.name} ${product.sku}`);
    if (!haystack.includes(filters.search)) return false;
  }
  if (filters.sku !== "" && !product.sku.toLowerCase().includes(filters.sku)) return false;
  if (!skip.has("status") && filters.status !== "" && product.status !== filters.status) {
    return false;
  }
  if (
    !skip.has("category") &&
    filters.categories.length > 0 &&
    !filters.categories.some((id) => product.category_ids.includes(id))
  ) {
    return false;
  }
  if (
    !skip.has("tag") &&
    filters.tags.length > 0 &&
    !filters.tags.some((id) => product.tag_ids.includes(id))
  ) {
    return false;
  }
  if (!skip.has("price")) {
    const price = priceOf(product);
    if (filters.minPrice !== null && price < filters.minPrice) return false;
    if (filters.maxPrice !== null && price > filters.maxPrice) return false;
  }
  if (
    !skip.has("stock_status") &&
    filters.stockStatus !== "" &&
    product.stock_status !== filters.stockStatus
  ) {
    return false;
  }
  if (filters.onSale !== null && product.on_sale !== filters.onSale) return false;
  if (filters.featured !== null && product.featured !== filters.featured) return false;

  for (const [taxonomy, slugs] of filters.attributes) {
    if (skip.has(`attributes[${taxonomy}]`)) continue;
    const carried = product.attributes.find((a) => a.name === taxonomy);
    // Values inside one attribute are alternatives; two attributes are not.
    if (carried === undefined || !slugs.some((slug) => carried.options.includes(slug))) {
      return false;
    }
  }
  return true;
}

/* ---------------------------------------------------------- product sorts --- */

// `fold` is up with `searchRows`, which needs the same folding for a different
// reason \u2014 see it there.
const compareBy = (key) => (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const descending = (compare) => (a, b) => -compare(a, b);

const byDate = compareBy((product) => product.date_created);
// Folded rather than `localeCompare`d: a collation that depends on the runtime's
// ICU build is a screenshot that differs between machines.
const byTitle = compareBy((product) => fold(product.name));
const byPrice = compareBy(priceOf);
const byId = compareBy((product) => product.id);
const bySku = compareBy((product) => fold(product.sku ?? ""));

/**
 * `popularity` is `total_sales`, which the live API **sorts by and does not
 * emit** — it is on no product response, measured. So it lives beside the rows
 * rather than on them: putting it on the fixture would leak a field into every
 * listing and `tests/mock-api.test.ts` parses those with the real Zod schema.
 *
 * Two fixture properties, both deliberate:
 *
 * **Not monotonic in the id** — ranked by each id's digits reversed, so a
 * fallback from `popularity` to `id` cannot pass as the real thing. That is the
 * flaw the backend's own ordering fixture carried until 2026-08-25, where sku,
 * id, title and price all ascended together and any of them could stand in for
 * another.
 *
 * **Distinct for every row**, so `desc` is exactly the reverse of `asc` and the
 * test can say so. The live catalogue is not like this — 28 products carry 13
 * distinct `total_sales`, so there the two directions are reverses only up to
 * ties, which a stable sort keeps in place. A fixture is chosen to discriminate;
 * that is what it is for.
 */
const PRODUCT_POPULARITY = new Map(
  // `CATALOGUE`, not `PRODUCTS`: the listing is `NEW_ARRIVALS` and
  // `BACK_CATALOGUE` too, and seeding from the middle third alone left the other
  // twenty rows sharing a default and clustering wherever the tie landed.
  CATALOGUE.map((row) => row.id)
    .sort((a, b) => {
      const reversed = (id) => String(id).split("").reverse().join("");
      return reversed(a) < reversed(b) ? -1 : reversed(a) > reversed(b) ? 1 : 0;
    })
    .map((id, rank) => [id, rank]),
);
const byPopularity = compareBy((product) => PRODUCT_POPULARITY.get(product.id) ?? 0);

/**
 * The twelve combinations re-measured as working on 2026-08-25 — see the header.
 *
 * `menu_order` and `rating` are absent on purpose and are **not** an oversight:
 * every product in the shop carries an identical value for both, so neither can
 * be told apart from a dead parameter. They validate and return unsorted.
 */
const PRODUCT_SORTS = new Map([
  ["date desc", descending(byDate)],
  ["date asc", byDate],
  ["id desc", descending(byId)],
  ["id asc", byId],
  ["title desc", descending(byTitle)],
  ["title asc", byTitle],
  ["price asc", byPrice],
  ["price desc", descending(byPrice)],
  ["sku asc", bySku],
  ["sku desc", descending(bySku)],
  ["popularity asc", byPopularity],
  ["popularity desc", descending(byPopularity)],
]);

/**
 * **What `/products` will *accept* as a sort, which is not what it *honours*.**
 * Eight values, in the API's own order — measured 2026-08-25 through the empty
 * string, which is outside the enum and therefore names the whole of it:
 *
 *   /products?orderby=         400 params.orderby
 *   /products?orderby=nonsense 400 params.orderby — the identical sentence
 *     "orderby is not one of date, id, title, price, sku, menu_order, popularity, and rating."
 *   /products?order=sideways   400 "order is not one of asc and desc."
 *
 * **This collection validated nothing at all before**, and the unit suite pinned
 * `?orderby=nonsense` as a 200. That assertion was a real measurement taken
 * 2026-08-18 — *before the backend repair this file's own header describes* —
 * and was never re-taken. **A stale measurement outliving its repair is exactly
 * the failure this branch exists to correct**, and it is worse than an unmeasured
 * guess: it carries a date and looks settled. Re-measured 2026-08-25 and flipped.
 *
 * ── Validation is not sorting coverage ───────────────────────────────────────
 *
 * `PRODUCT_SORTS` below is five *combinations* and answers the other question:
 * which accepted values actually reorder the rows.
 *
 * **That claim is dated 2026-08-18 and a 2026-08-25 probe contradicts it** —
 * `title desc` came back genuine reverse-alphabetical, `sku asc` genuine SKU
 * order and `id asc` genuine id order, where all three are pinned dead here.
 * **Re-measurement pending, and the sorting behaviour is deliberately left
 * alone**: it reaches the products screen, so it is a scope call rather than a
 * mock repair. Only the validation above was changed. Do not read the five
 * combinations as current.
 */
const PRODUCT_ORDERBY = [
  "date",
  "id",
  "title",
  "price",
  "sku",
  "menu_order",
  "popularity",
  "rating",
];

function sortProducts(rows, params) {
  // `desc` is WooCommerce's default `order`, so `?orderby=title` on its own is
  // `title desc` and therefore unsorted.
  const sort = PRODUCT_SORTS.get(
    `${params.get("orderby") ?? "date"} ${params.get("order") ?? "desc"}`,
  );
  // A stable sort, so rows that tie keep catalogue order rather than an order
  // that depends on the engine.
  return sort === undefined ? rows : [...rows].sort(sort);
}

/* --------------------------------------------------------------- facets --- */

/** Measured with a 60-term attribute: 50 values, `total_values: 60`, truncated. */
const FACET_CAP = 50;

/**
 * `{values, total_values, truncated}` — the shape `category`, `tag` and each
 * attribute group share, and which is wrong for the other two thirds of the
 * facets object: `price` is `{min, max, currency}` and `stock_status` is a bare
 * array. One "facet group" type would be wrong twice.
 *
 * **A zero-count value is omitted entirely**, and `total_values` counts what is
 * left rather than the vocabulary — measured, an attribute with six terms one of
 * which no product carries reports 5. That is why the panel merges this against
 * `/product-categories` and `/attributes/{id}/terms` instead of rendering it.
 */
function facetGroup(vocabulary, rows, holds) {
  const values = [];
  for (const value of vocabulary) {
    const count = rows.filter((product) => holds(product, value)).length;
    if (count === 0) continue;
    values.push({ slug: value.slug, name: value.name, count, term_id: value.id });
  }
  return {
    values: values.slice(0, FACET_CAP),
    total_values: values.length,
    truncated: values.length > FACET_CAP,
  };
}

/**
 * `meta.facets`, and only the groups `?facets=` asked for.
 *
 * Counted over **published** rows always, whatever `?status=` says — that is
 * what `scope: "publish"` means and why `scope_note` exists to be rendered.
 */
function facetsFor(params, filters) {
  const asked = new Set(
    (params.get("facets") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  if (asked.size === 0) return null;

  const base = (dimension = null) =>
    listed().filter(
      (product) =>
        product.status === "publish" &&
        matchesProduct(
          product,
          filters,
          new Set(dimension === null ? ["status"] : ["status", dimension]),
        ),
    );

  const facets = {
    scope: "publish",
    scope_note:
      "Counts cover published products only. Drafts, pending and private products are listed but not counted.",
  };

  // **`category` and `tag` do not exclude their own filter and everything else
  // does.** Measured: `?category=16` collapses this group to that one value and
  // drops the other five, while an attribute group, `stock_status` and `price`
  // all still report their full range under their own. lib/products.ts repairs
  // it in the panel; reproducing the repair here would hide the thing the repair
  // is for.
  if (asked.has("category")) {
    facets.category = facetGroup(CATEGORIES, base(), (product, value) =>
      product.category_ids.includes(value.id),
    );
  }
  if (asked.has("tag")) {
    facets.tag = facetGroup(TAGS, base(), (product, value) =>
      product.tag_ids.includes(value.id),
    );
  }

  if (asked.has("price")) {
    const prices = base("price").map(priceOf);
    facets.price = {
      // `0.00` is a real floor: a published product with no price at all stores
      // zero in WooCommerce's lookup table, and this shop has one.
      min: (prices.length === 0 ? 0 : Math.min(...prices)).toFixed(2),
      max: (prices.length === 0 ? 0 : Math.max(...prices)).toFixed(2),
      currency: "DZD",
    };
  }

  if (asked.has("stock_status")) {
    const rows = base("stock_status");
    // A bare array, and **every value of the enum including the zeros** — the
    // one group the API can enumerate completely, because it is a closed set
    // rather than a taxonomy.
    facets.stock_status = STOCK_STATUSES.map((value) => ({
      value,
      count: rows.filter((product) => product.stock_status === value).length,
    }));
  }

  if (asked.has("rating")) {
    // Also a bare array, and `[]` on every request: no product in this shop has
    // a review. Measured, and the reason the panel does not ask for it.
    facets.rating = [];
  }

  if (asked.has("attributes")) {
    facets.attributes = {
      facetable: ATTRIBUTES.map((attribute) => attribute.taxonomy),
      note: "Only global attributes can be filtered. A local attribute has no shared vocabulary and no term to count.",
      groups: ATTRIBUTES.map((attribute) => ({
        taxonomy: attribute.taxonomy,
        label: attribute.name,
        ...facetGroup(
          TERMS[attribute.taxonomy],
          base(`attributes[${attribute.taxonomy}]`),
          (product, value) =>
            product.attributes.some(
              (a) => a.name === attribute.taxonomy && a.options.includes(value.slug),
            ),
        ),
      })),
    };
  }

  return facets;
}

/** The whole `/products` listing: filter, sort, paginate, then count. */
function productsListing(params) {
  const sort = checkSort(params, PRODUCT_ORDERBY);
  if (sort !== null) return sort;

  const parsed = parseProductFilters(params);
  if (parsed.error) return parsed.error;

  const rows = listed().filter((product) => matchesProduct(product, parsed.filters));
  const page = paginate(sortProducts(rows, params), params);
  if (page.error) return page.error;

  const facets = facetsFor(params, parsed.filters);
  return ok(page.rows, facets === null ? page.meta : { ...page.meta, facets });
}

/* --------------------------------------------------------- product writes --- */

/*
 * ── Which product id produces which answer ───────────────────────────────────
 *
 * The same table the order detail has, for the same reason: a screen cannot be
 * verified against a state it can never reach, and a `find()` that moves quietly
 * takes the table's meaning with it. Every id below is written out.
 *
 *   id    request                                    answer
 *   ────  ─────────────────────────────────────────  ──────────────────────────
 *   104   GET  /variations                           200 — 3 bodies, one with
 *                                                    `sku: ""`, one with
 *                                                    `stock_quantity: null`
 *   120   GET  /variations                           200 — the other 2
 *   101   GET  /variations                           200 `[]` — simple product
 *   208   GET  /products/208                         200 with `options` **and**
 *                                                    `options_problems` (2)
 *   208   PATCH {options: {groups: […]}}             200 — and `options_problems`
 *                                                    is gone: the silent repair
 *   104   PATCH {name:"", regular_price:"-1"}        400 fields{name,
 *                                                    regular_price} — two at once
 *   104   PATCH {sku:"AC-CAT-0101"}                  409 details.**sku**, not
 *                                                    details.fields (101 has it)
 *   104   PATCH {nonsense: 1}                        400 fields{nonsense:
 *                                                    "Unknown field."}
 *   104   PATCH {price:"1", id: 104}                 400 "No supported fields
 *                                                    were provided.", **no
 *                                                    `details` at all**
 *   103   PATCH {stock_quantity: 99}                 200 — silently dropped, the
 *                                                    row manages no stock
 *   209   DELETE                                     200 {id, deleted:true};
 *                                                    the next GET is 200
 *                                                    `status:"trash"`
 *   209   DELETE ?force=true                         the **identical** body; the
 *                                                    next GET is 404
 *
 * 104 is the variable product with three variations and 120 the one with two.
 * 103 is one of the eight rows that manage no stock. 101 holds `AC-CAT-0101`,
 * which is what makes the 409 above reachable without inventing a SKU.
 *
 * The orders table above pins its ids to constants because the seeds *use* them;
 * these are used by nothing but this table and by the unit suite, so they stay
 * written out here and are pinned there instead — a literal that stops matching
 * fails a test, which is the property that matters.
 */

/**
 * `PATCH`/`POST` accept exactly these two — measured, `grouped` is a 400 — and
 * these four visibilities. lib/product-status.ts holds the same two lists for
 * the panel; this file imports nothing, so they are written out rather than
 * shared, and the test asserts the pair agree.
 */
const PRODUCT_TYPES = ["simple", "variable"];
const CATALOG_VISIBILITIES = ["visible", "catalog", "search", "hidden"];

/**
 * **Read-only and unknown are different answers, and that is the whole point of
 * this pair of lists.**
 *
 * A read-only key is dropped in silence: no 400, no mention in the response, the
 * product simply comes back with that field unchanged. An unknown key is a 400.
 * A client that treated them alike would either refuse a GET body it is supposed
 * to be able to PATCH back, or swallow a typo'd field name and report a save
 * that never happened.
 *
 * Both lists are the measured ones, quoted at ADMIN_PANEL.md:1619-1624 and in
 * `ProductDetail`'s own docblock. `options_problems` is on the read-only list and
 * is *also* destroyed by writing `options` — those are two different mechanisms
 * and the second is the one the warning banner is about.
 */
const PRODUCT_READ_ONLY = [
  "price",
  "on_sale",
  "permalink",
  "image",
  "gallery",
  "variations",
  "id",
  "date_created",
  "date_modified",
  "bundle",
  "options_problems",
];

/**
 * One rule per writable field, answering an English sentence or null.
 *
 * **The messages are English on a panel that is French and Arabic**, deliberately
 * — measured, and the panel renders them verbatim beside a localised label
 * because they name the problem precisely and a translated generic ("Ce champ est
 * invalide") throws away the only actionable part. Three of them are quoted from
 * the live API: "Must be a number.", "Cannot be negative.", "A product name
 * cannot be emptied."
 */
const mustBeText = (value) => (typeof value === "string" ? null : "Must be a string.");
const mustBeFlag = (value) => (typeof value === "boolean" ? null : "Must be true or false.");
const mustBeOneOf = (values) => (value) =>
  typeof value === "string" && values.includes(value) ? null : oneOf(values);

/** Money stays a decimal string, so `1200` — a number — is as wrong as `"abc"`. */
const mustBeMoney = (value) => {
  if (typeof value !== "string") return "Must be a number.";
  if (value === "") return null; // clearing a price is how a sale ends
  if (!/^-?\d+(\.\d+)?$/.test(value)) return "Must be a number.";
  return Number.parseFloat(value) < 0 ? "Cannot be negative." : null;
};

const mustBeQuantity = (value) => {
  if (value === null) return null; // a real value: nothing is being counted
  if (typeof value !== "number" || !Number.isInteger(value)) return "Must be a number.";
  return value < 0 ? "Cannot be negative." : null;
};

const mustBeIds = (value) =>
  Array.isArray(value) && value.every((entry) => Number.isInteger(entry))
    ? null
    : "Must be a list of ids.";

const mustBeObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? null
    : "Must be an object.";

/**
 * The three fields that carry a **nested shape**, and the one rule they share:
 * a block is written whole or not at all.
 *
 * This is not defensiveness for its own sake. `seo`, `attributes` and `options`
 * are the only writable fields the panel's own boundary parses structurally, so a
 * mock that stored a partial one would hand the *next* GET a body
 * `lib/api/schemas/product.ts` refuses — a screen breaking at its boundary
 * against a shape the real API would never have stored. The harness exists to
 * catch that class of thing, not to manufacture it.
 *
 * The measured use is unaffected: `GET` then `PATCH` the whole object back sends
 * every one of these complete, which is the round trip ADMIN_PANEL.md:1612 says
 * answers 200 on all 32 keys.
 */
const mustBeSeo = (value) => {
  if (mustBeObject(value) !== null) return "Must be an object.";
  const robots = ["index", "follow", "directive"];
  const whole =
    ["title", "description", "canonical", "overrides"].every((key) => key in value) &&
    mustBeObject(value.robots) === null &&
    robots.every((key) => key in value.robots);
  return whole ? null : "Must carry title, description, canonical, robots and overrides.";
};

const mustBeAttributes = (value) => {
  if (!Array.isArray(value)) return "Must be a list of attributes.";
  const whole = value.every(
    (entry) =>
      mustBeObject(entry) === null &&
      ["id", "name", "options", "visible", "variation", "position"].every(
        (key) => key in entry,
      ),
  );
  return whole ? null : "Each attribute must carry id, name, options, visible, variation and position.";
};

/** Null removes the option set altogether, which is not `{groups: []}`. */
const mustBeOptions = (value) => {
  if (value === null) return null;
  if (mustBeObject(value) !== null) return "Must be an object.";
  const whole =
    Array.isArray(value.groups) &&
    value.groups.every((group) => mustBeObject(group) === null && typeof group.id === "string");
  return whole ? null : "Must carry a groups list, each group with an id.";
};

const PRODUCT_FIELD_RULES = {
  name: (value) =>
    typeof value !== "string"
      ? "Must be a string."
      : value.trim() === ""
        ? "A product name cannot be emptied."
        : null,
  slug: mustBeText,
  type: mustBeOneOf(PRODUCT_TYPES),
  // `trash` is readable and **not writable** — a product is trashed by DELETE,
  // never by a PATCH, which is why the two lists differ by exactly that value.
  status: mustBeOneOf(PRODUCT_STATUSES),
  featured: mustBeFlag,
  catalog_visibility: mustBeOneOf(CATALOG_VISIBILITIES),
  sku: mustBeText,
  description: mustBeText,
  short_description: mustBeText,
  regular_price: mustBeMoney,
  sale_price: mustBeMoney,
  manage_stock: mustBeFlag,
  stock_quantity: mustBeQuantity,
  stock_status: mustBeOneOf(STOCK_STATUSES),
  weight: mustBeText,
  category_ids: mustBeIds,
  seo: mustBeSeo,
  options: mustBeOptions,
  attributes: mustBeAttributes,
  tag_ids: mustBeIds,
  image_id: (value) => (Number.isInteger(value) ? null : "Must be a number."),
  gallery_image_ids: mustBeIds,
};

/**
 * `PATCH /products/{id}`.
 *
 * The order of the gates is the order the API applies them, so the reason on
 * screen is the reason the server would have given:
 *
 *   1. every bad field at once   400 `details.fields` — unknown keys and invalid
 *                                values in one object, because the form renders
 *                                one message per control and a 400 that named
 *                                only the first would hide the rest
 *   2. nothing supported left    400, **no `details`**
 *   3. a duplicate SKU           409 `details.sku` — *not* `details.fields`,
 *                                measured, and it still has to land on the SKU
 *                                control because that is the field to change
 *
 * What is deliberately **not** here: a clock. `date_modified` keeps its seeded
 * value through a write, the way an order's does, because there is no `Date.now()`
 * anywhere in this file and a screenshot has to be byte-stable.
 */
function patchProduct(current, body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return bareFail(400, "invalid_request", "No supported fields were provided.");
  }

  const fields = {};
  const writes = {};
  for (const [key, value] of Object.entries(body)) {
    // Silently. Not a 400, not a mention in the response — this is what lets a
    // client PATCH a GET body back without diffing it first.
    if (PRODUCT_READ_ONLY.includes(key)) continue;

    const rule = PRODUCT_FIELD_RULES[key];
    if (rule === undefined) {
      fields[key] = "Unknown field.";
      continue;
    }
    const problem = rule(value);
    if (problem === null) writes[key] = value;
    else fields[key] = problem;
  }

  if (Object.keys(fields).length > 0) {
    return invalidBody(`Invalid parameter(s): ${Object.keys(fields).join(", ")}`, fields);
  }
  if (Object.keys(writes).length === 0) {
    // The message names nothing because the API's own names nothing, which is
    // exactly why "drop what is read-only" cannot be a client's only rule.
    return bareFail(400, "invalid_request", "No supported fields were provided.");
  }

  if (typeof writes.sku === "string" && writes.sku !== "") {
    // A trashed product still holds its SKU, so the search is over the whole
    // catalogue rather than the listed part.
    const taken = catalogue().find(
      (product) => product.id !== current.id && product.sku === writes.sku,
    );
    if (taken !== undefined) {
      return conflict("That SKU is already in use.", { sku: writes.sku });
    }
  }

  const next = { ...current, ...writes };

  /*
   * **`stock_quantity` is dropped when the row manages no stock** — a 200 that
   * looks exactly like a save and is not. Measured, and the reason the panel's
   * form deletes the key from its own body rather than sending it and trusting
   * the answer.
   *
   * It lands as null rather than as the previous figure because that is the
   * catalogue's own invariant — 8 of 28 rows, `manage_stock: false` and
   * `stock_quantity: null` together — and a mock that could produce an unmanaged
   * row carrying a number would let a screen render a stock count the real API
   * never serves.
   */
  if (!(writes.manage_stock ?? current.manage_stock)) next.stock_quantity = null;

  /*
   * The silent repair the detail's warning banner is about: writing `options`
   * replaces the stored document, so the groups the API could not read are gone
   * and `options_problems` goes with them. Measured — after one whole-body round
   * trip the field had disappeared and so had both broken groups.
   */
  if ("options" in writes) delete next.options_problems;

  /*
   * `price` is read-only *and* derived — the sale price when there is one, the
   * regular price otherwise — so a PATCH of `sale_price` that left `price`
   * behind would put two contradicting figures on one row. A variable product is
   * left alone: its `price` is resolved from the variations and its
   * `regular_price` is `""`.
   */
  if (next.variations.length === 0) {
    next.on_sale = next.sale_price !== "";
    next.price = next.on_sale ? next.sale_price : next.regular_price;
  }

  state.products.set(current.id, next);
  return ok(next);
}

/**
 * `DELETE /products/{id}`, and `?force=true`.
 *
 * **The two answer identical bodies.** Nothing in the response distinguishes the
 * reversible act from the irreversible one — the panel knows only because it
 * knows what it asked for, which is why the permanent path sits behind a typed
 * confirmation of the product's own name. The difference is visible on the *next*
 * GET and nowhere else: a trashed product answers 200 with `status: "trash"` and
 * a forced one answers 404.
 *
 * Trashing is idempotent and never escalates: a second DELETE on an already
 * trashed product is the same 200 and does **not** become permanent.
 */
function deleteProduct(current, params) {
  if (BOOLEANS.get(params.get("force") ?? "") === true) {
    state.products.delete(current.id);
    state.gone.add(current.id);
  } else {
    state.products.set(current.id, { ...current, status: "trash" });
  }
  return ok({ id: current.id, deleted: true });
}

/* -------------------------------------------------------- customer queries --- */

/**
 * ── `orderby` on /customers is validated and *then* ignored ──────────────────
 *
 * Those are two different things and this collection does both, which nothing
 * else in this file does. Measured one parameter at a time — see
 * app/[locale]/(panel)/customers/query.ts:13-18:
 *
 *   ?nonsense=zzz         200, all rows   an unknown *name* is silent
 *   ?role=administrator   200, all rows   likewise, and it is not a widening
 *   ?orderby=zzz          **400**         a known name with a bad value refuses
 *   ?order=sideways       **400**         likewise
 *
 * `queryFromParams()` carries a guard built entirely on that asymmetry: a stale
 * or hand-edited URL must not be able to provoke a 400 the screen then renders as
 * an error. While this mock answered 200 to both, that guard could have been
 * deleted with nothing anywhere noticing.
 *
 * Ignored *after* validating, because the header's rule holds here too: nothing
 * measured says either sort does anything, and a mock that sorted would let an
 * agent verify a control against the harness and ship one that does not work.
 */
const CUSTOMER_ORDERBY = ["registered", "ID", "display_name", "user_email"];

/**
 * **A different enum on the sub-resource, and that is the point of having it.**
 * `GET /customers/{id}/orders` takes `date, id, modified, total` — so
 * `?orderby=registered` is a 400 here and a 200 one level up, and `?orderby=date`
 * is the other way round. A screen that reused the parent's control would send a
 * value this route refuses.
 */
const CUSTOMER_ORDERS_ORDERBY = ["date", "id", "modified", "total"];

const SORT_DIRECTIONS = ["asc", "desc"];

/**
 * Null when the pair is acceptable, a 400 when either value is outside its set.
 *
 * **`?orderby=` is a value and not an absence**, and the distinction is the
 * router's own rather than a convention: each parameter is checked against an
 * enum, and `""` passes exactly where `""` is a member of that enum. It is a
 * member for `?status=` on coupons — which is why the 400 there reads
 * `status is not one of , publish, and draft.`, naming the empty string first —
 * and it is a member of neither sort enum. Measured 2026-08-25:
 *
 *   /coupons?orderby=   400 params.orderby "orderby is not one of date, id, code, and usage."
 *   /coupons?order=     400 params.order   "order is not one of asc and desc."
 *   /coupons?status=    200, 4 rows        — `""` is in *that* enum
 *   /coupons?search=    200, 4 rows        — not an enum at all
 *
 * Reading `""` as absence here made three of this file's collections answer 200
 * to a parameter the shop refuses, so a screen that emitted an empty `orderby`
 * — a select reset to its placeholder — verified clean and 400s in production.
 */
function checkSort(params, orderbyValues) {
  for (const [name, allowed] of [
    ["orderby", orderbyValues],
    ["order", SORT_DIRECTIONS],
  ]) {
    const raw = params.get(name);
    if (raw === null) continue;
    if (!allowed.includes(raw)) {
      const message = notOneOf(name, allowed);
      return fail(400, "invalid_request", message, { params: { [name]: message } });
    }
  }
  return null;
}

/**
 * `GET /customers/{id}/orders`, and the three measured behaviours it exists to
 * reproduce. It used to be refused as a third segment, and the unit suite
 * asserted that 404.
 *
 *   `status`      one value; a comma list is a 400, the same single-select rule
 *                 `/orders` follows and against the same seven-word vocabulary.
 *   `orderby`     the enum above, which is **not** the parent collection's.
 *   `customer_id` **ignored.** Measured: `?customer_id=25` on customer 24's route
 *                 answers customer 24's orders. The identity is the path and no
 *                 parameter can redirect it — which is worth having in a fixture,
 *                 because the obvious implementation reads the parameter when it
 *                 is there and quietly serves somebody else's order list.
 *
 * Nothing below reads `customer_id`, and that absence *is* the third behaviour.
 *
 * The rows are `ordersOf()`, which is the same list the detail's statistics are
 * counted from — so `meta.total` here and `statistics.total_orders` on the parent
 * cannot disagree.
 */
function customerOrders(customer, params) {
  const sort = checkSort(params, CUSTOMER_ORDERS_ORDERBY);
  if (sort !== null) return sort;

  const filtered = filterByStatus(ordersOf(customer.id), params);
  if (filtered.error) return filtered.error;

  const page = paginate(filtered.rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

/* ---------------------------------------------------- notification queries --- */

/**
 * `?status=` takes three and refuses a fourth **by name**, and the refusal is not
 * shaped like this file's others: measured, the code is `invalid_request` rather
 * than `rest_invalid_param` and the sentence ends with a full stop —
 *
 *   details.params.status: "status is not one of pending, sent, and failed."
 *
 * lib/notifications.ts:16-27 records both. `details.params`, not `details.fields`.
 */
const NOTIFICATION_STATUSES = ["pending", "sent", "failed"];

/** `Y-m-d`, UTC, whole days at both ends. `?date_from=yesterday` is a 400. */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /notifications`.
 *
 * **What is filtered and what is accepted-and-ignored is the whole shape of this
 * screen**, and both halves are reproduced. Measured 2026-08-21, one parameter at
 * a time, in app/[locale]/(panel)/notifications/query.ts:10-33:
 *
 *   channel      honoured — and **not validated**: `?channel=nonsense` is a 200
 *                with 0 rows where `?status=nonsense` is a 400, because the route
 *                declares a key pattern rather than an enum
 *   status       honoured, and refused by name outside its three
 *   dedupe_key   honoured, **exact match only** — `?dedupe_key=payment.received`
 *                answers 0 rows, never the set that starts with it
 *   recipient    honoured — added on `feat/notification-filters`, and the reason
 *                the customer section is one request instead of thirty
 *   subject_id   honoured, `minimum: 1`, so `?subject_id=0` is a 400 rather than
 *                the unset value it looks like
 *   date_from/to honoured, `Y-m-d`, UTC, both ends inclusive
 *
 *   event        ACCEPTED AND IGNORED
 *   audience     ACCEPTED AND IGNORED
 *   search       ACCEPTED AND IGNORED
 *   orderby      ACCEPTED AND IGNORED, and not even validated
 *
 * The four ignored ones are ignored *here* by nothing reading them, which is the
 * only way to reproduce "accepted and ignored" — and `event` and `audience` are
 * the two that matter, because both are on every row and both are the obvious
 * thing to filter by. §90 declined them deliberately: `dedupe_key`'s left half
 * *is* the event, and `audience` is separated by `recipient`. A mock that
 * filtered on them would let an agent build the two controls the panel refuses to
 * ship and watch them work.
 */
function notificationsListing(params) {
  const status = params.get("status");
  if (status !== null && status !== "" && !NOTIFICATION_STATUSES.includes(status)) {
    const message = notOneOf("status", NOTIFICATION_STATUSES);
    return fail(400, "invalid_request", message, { params: { status: message } });
  }

  const subjectId = params.get("subject_id");
  if (subjectId !== null && subjectId !== "") {
    const parsed = Number(subjectId);
    if (!Number.isInteger(parsed) || parsed < 1) {
      const message = "subject_id must be greater than or equal to 1";
      return fail(400, "invalid_request", message, { params: { subject_id: message } });
    }
  }

  for (const name of ["date_from", "date_to"]) {
    const raw = params.get(name);
    if (raw !== null && raw !== "" && !YMD.test(raw)) {
      const message = `${name} is not a valid date`;
      return fail(400, "invalid_request", message, { params: { [name]: message } });
    }
  }

  const equals = (name, key) => {
    const value = params.get(name);
    return value === null || value === "" ? null : (row) => String(row[key]) === value;
  };

  const from = params.get("date_from");
  const to = params.get("date_to");
  const tests = [
    equals("channel", "channel"),
    equals("status", "status"),
    equals("dedupe_key", "dedupe_key"),
    // Exact, not a substring: this is a `WHERE recipient = %s` and a customer
    // whose address is a prefix of another's must not collect their queue.
    equals("recipient", "recipient"),
    equals("subject_id", "subject_id"),
    from === null || from === "" ? null : (row) => row.created_at.slice(0, 10) >= from,
    to === null || to === "" ? null : (row) => row.created_at.slice(0, 10) <= to,
  ].filter((test) => test !== null);

  const rows = NOTIFICATIONS.filter((row) => tests.every((test) => test(row)));
  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

/* ------------------------------------------------------ inventory queries --- */

/**
 * ── What `GET /inventory` honours, and what it accepts and ignores ───────────
 *
 * Both halves are the shape of the stock screen and both are reproduced.
 * Measured 2026-08-18, one parameter at a time:
 *
 *   search             honoured
 *   stock_status       honoured, and refused by name outside its three —
 *                      `?stock_status=zzz` is a **400**
 *   manage_stock       honoured, and **three-state: absent is not `false`**.
 *                      `""` returns everything, `false` returns the rows that
 *                      track nothing. A control that conflated them would stop
 *                      filtering and say nothing about it, which is the same
 *                      trap `on_sale` sets on `/products`
 *   include_variations honoured, and **defaults to false**
 *   page, per_page     honoured, and `per_page=101` is a 400 rather than a clamp
 *
 *   sku, status,       ACCEPTED AND IGNORED. ADMIN_PANEL.md:1701 lists them as
 *   category,          parameters this route takes and **nothing measured says
 *   orderby, order     any of them does anything**, so nothing here reads them.
 *                      The panel sends none of the five. Reading them would be
 *                      this file manufacturing a capability rather than
 *                      reproducing one — and `orderby`/`order` are the header's
 *                      own rule besides.
 *
 * And `?nonsense=zzz` is a 200 with every row, which is the difference that
 * makes the first list worth having: an unknown *name* is silent, a known name
 * with a bad value refuses, and a screen can therefore hear about one and never
 * about the other.
 *
 * **The default on `include_variations` is the branch's largest correction to
 * the spec's shorthand.** With it off the list is 38 rows here and with it on it
 * is 43 — the shop's own 28-against-33 — while `/inventory/low-stock` *always*
 * includes variations. So the default screen shows "Burnous en laine tissé main
 * — L" and the full list, on the same shorthand, says that row does not exist.
 * Reproducing the default is what makes that difference capturable at all.
 */
function inventoryListing(params) {
  const rows = filterInventory(inventoryRows(), params);
  if (rows.error) return rows.error;

  const page = paginate(rows.rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

function filterInventory(rows, params) {
  const raw = params.get("include_variations");
  let includeVariations = false;
  if (raw !== null && raw !== "") {
    if (!BOOLEANS.has(raw)) {
      return { error: invalidParam("include_variations", "include_variations is not of type boolean.") };
    }
    includeVariations = BOOLEANS.get(raw);
  }

  const stockStatus = params.get("stock_status");
  if (stockStatus !== null && stockStatus !== "" && !STOCK_STATUSES.includes(stockStatus)) {
    return {
      error: invalidParam(
        "stock_status",
        notOneOf("stock_status", [...STOCK_STATUSES].sort()),
      ),
    };
  }

  /*
   * Filtered on `managing_stock` rather than on the raw `manage_stock`, and the
   * two agree on every row in this shop — including the delegated one, where the
   * raw value is the string `"parent"` and WooCommerce's own
   * `wc_string_to_bool()` reads that as false. **Which of the two the API
   * actually filters on was not measured**, and it is written here rather than
   * left in the code because a shop where they diverge would settle it.
   */
  const manageStock = params.get("manage_stock");
  let tracking = null;
  if (manageStock !== null && manageStock !== "") {
    if (!BOOLEANS.has(manageStock)) {
      return { error: invalidParam("manage_stock", "manage_stock is not of type boolean.") };
    }
    tracking = BOOLEANS.get(manageStock);
  }

  /*
   * Name and SKU, folded — the fields `/products` was measured to search and the
   * same repository behind both. **Which fields this route searches was not
   * measured separately**, and the customers collection is why that sentence is
   * here rather than assumed: three branches shipped with a search that matched
   * two fields the API has never matched.
   */
  const term = fold((params.get("search") ?? "").trim());

  return {
    rows: rows.filter((row) => {
      if (!includeVariations && row.parent_id !== 0) return false;
      if (stockStatus !== null && stockStatus !== "" && row.stock_status !== stockStatus) {
        return false;
      }
      if (tracking !== null && row.managing_stock !== tracking) return false;
      if (term !== "" && !fold(`${row.name} ${row.sku}`).includes(term)) return false;
      return true;
    }),
  };
}

/**
 * `GET /inventory/lookup?sku=`, and the **three** answers it has.
 *
 * A hit is the same item shape as the other three inventory routes. A miss is
 * `404 not_found` — *not* `rest_no_route`, which is what an unrouted path
 * answers — and `SkuLookup` reads that code by name to tell "no such SKU" from
 * "the request went nowhere", rendering the first as an empty state at the field
 * and keeping the typed value.
 *
 * **A missing `sku` is a 400 whose `details.params` is an *array of names*
 * rather than an object of messages**, and nothing in this repository had ever
 * exercised that shape. It is the one endpoint measured to produce it:
 * `{"params": ["sku"]}`. `Object.values` of an array returns its elements, so a
 * reader written for the object shape renders the bare word `sku` at a person in
 * a stockroom as though it were an explanation — which is the defect
 * lib/api/browser.ts:81-95 exists to prevent and `inventory/query.ts:253-276`
 * handles by falling through to the generic message.
 *
 * The match is exact and case-sensitive. `?sku=AC/BUR 010` is a 404 and nothing
 * fuzzy exists, which is why the field searches on submit rather than debouncing
 * — every keystroke before the last one is a request that can only 404.
 * MySQL's collation would fold case on an `=` comparison and this does not;
 * that is the *less* capable direction on purpose, and the field uppercases
 * anyway.
 */
function inventoryLookup(params) {
  const sku = (params.get("sku") ?? "").trim();
  if (sku === "") {
    // `invalid_request`, corrected 2026-08-25 — see `postCodAttempt` for why
    // this and it were the two the earlier code sweep missed. The **array**
    // shape under `params` is measured and stays exactly as it is.
    return fail(400, "invalid_request", "Missing parameter(s): sku", {
      params: ["sku"],
    });
  }

  // `sku: ""` is a real value on two variations and must never be a hit: an
  // empty query is a missing parameter, not a search for the blank ones.
  const row = inventoryRows().find((candidate) => candidate.sku !== "" && candidate.sku === sku);
  return row === undefined
    ? fail(404, "not_found", "No product was found with that SKU.")
    : ok(row);
}

/* ------------------------------------------------------------ the ledger --- */

/** The union of nine — every reason the ledger can *contain*. `zzz` is a 400. */
const MOVEMENT_REASONS = [
  "correction",
  "restock",
  "damage",
  "loss",
  "customer_return",
  "other",
  "order_reduced",
  "order_restored",
  "product_edit",
];

/** The six a *person* may write. `POST /adjust` refuses the other three. */
const MANUAL_REASONS = ["correction", "restock", "damage", "loss", "customer_return", "other"];

/**
 * The window both ledger routes share, and the only filter the summary honours.
 *
 * `YYYY-MM-DD`, UTC, whole days at both ends and both inclusive — `?date_from=
 * yesterday` is a 400. Compared as a string prefix of `created_at`, which works
 * precisely because that stamp has no offset to strip first.
 */
function movementWindow(params) {
  for (const name of ["date_from", "date_to"]) {
    const value = params.get(name);
    if (value !== null && value !== "" && !YMD.test(value)) {
      return { error: invalidParam(name, `${name} is not a valid date`) };
    }
  }

  const from = params.get("date_from");
  const to = params.get("date_to");
  return {
    rows: allMovements().filter((row) => {
      const day = row.created_at.slice(0, 10);
      if (from !== null && from !== "" && day < from) return false;
      if (to !== null && to !== "" && day > to) return false;
      return true;
    }),
  };
}

/**
 * `GET /inventory/movements`.
 *
 * `reason` takes all nine — the ledger is *read* in full even though only six
 * may be written, and `?reason=order_reduced` is 480 of the 1154 rows — and
 * refuses a tenth by name.
 *
 * `product_id` and `actor_id` are matched and **not validated**: a value that is
 * not an id answers 200 with zero rows rather than a 400. Nothing measured says
 * either refuses, the panel sends `\d+` or nothing, and inventing a refusal is
 * how a screen ends up built against a 400 the shop never sends.
 */
function movementsListing(params) {
  const reason = params.get("reason");
  if (reason !== null && reason !== "" && !MOVEMENT_REASONS.includes(reason)) {
    return invalidParam("reason", notOneOf("reason", [...MOVEMENT_REASONS].sort()));
  }

  const windowed = movementWindow(params);
  if (windowed.error) return windowed.error;

  const productId = params.get("product_id");
  const actorId = params.get("actor_id");

  const rows = windowed.rows.filter((row) => {
    if (reason !== null && reason !== "" && row.reason !== reason) return false;
    if (productId !== null && productId !== "" && String(row.product_id) !== productId) return false;
    if (actorId !== null && actorId !== "" && String(row.actor_id) !== actorId) return false;
    return true;
  });

  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

/**
 * `GET /inventory/movements/summary` — **an object keyed by reason, not a list**,
 * and therefore no `meta` either.
 *
 * **It omits every reason with no rows**, which is the whole reason the panel
 * builds its filter from `ALL_REASONS` and takes only the counts from here: two
 * of the six a person may choose — `customer_return` and `other` — have never
 * been written in this shop, so a picker built from this response would offer
 * seven reasons, three of which answer 400, and would be missing two a person
 * can create at any moment. Neither response is a vocabulary: one is a set of
 * permissions and the other is a set of counts.
 *
 * **Only the date window is honoured**, and that is the measured half —
 * ADMIN_PANEL.md:1856 says the route takes `date_from`/`date_to` and that the
 * window is real. `summaryParams()` in the panel sends `reason`, `product_id`
 * and `actor_id` too, because it is the ledger's request minus its pagination,
 * and **nothing measured says the summary reads any of them**. They are accepted
 * and ignored here rather than honoured on a guess: a mock that narrowed on them
 * and an API that did not would leave the strip disagreeing with itself in
 * production only. Flagged, because it is the one place on this collection where
 * the safe direction is also the surprising one.
 */
function movementsSummary(params) {
  const windowed = movementWindow(params);
  if (windowed.error) return windowed.error;

  const summary = {};
  for (const row of windowed.rows) {
    const entry = summary[row.reason] ?? { net: 0, movements: 0 };
    entry.net += row.delta;
    entry.movements += 1;
    summary[row.reason] = entry;
  }
  return ok(summary);
}

/* ------------------------------------------------------- the stock writes --- */

/*
 * ── Which inventory id produces which refusal ────────────────────────────────
 *
 * The third table in this file, on the same rule as the other two: a screen
 * cannot be verified against a state it can never reach, and every id below is
 * written out because a literal that stops matching fails a test while a
 * `find()` moves quietly and takes the table's meaning with it.
 *
 *   id    request                                    answer
 *   ────  ─────────────────────────────────────────  ──────────────────────────
 *   101   POST /adjust {increase, 3, restock}        200 {item, movement} — and
 *                                                    the movement carries **no
 *                                                    `id`**, unlike the ledger's
 *   101   POST /adjust {decrease, 99, loss}          409 {stock_quantity,
 *                                                    projected: −74, backorders:
 *                                                    "no"} — refused, never
 *                                                    clamped
 *   103   POST /adjust {increase, 1, restock}        409 {id, manage_stock:
 *                                                    false} — tracks no stock
 *   9032  POST /adjust {increase, 1, restock}        409 {id, manage_stock:
 *                                                    **"parent"**} — the shelf
 *                                                    is 104's
 *   9030  POST /adjust {decrease, 40, damage}        **200** — `backorders` is
 *                                                    "notify", so below zero is
 *                                                    a legal shelf
 *   101   POST /adjust {}                            400 fields{mode, quantity,
 *                                                    reason} — three at once
 *   101   POST /adjust {…, reason:"order_reduced"}   400 fields{reason} — the
 *                                                    *same* sentence an unknown
 *                                                    reason gets, deliberately
 *   101   POST /adjust {…, nonsense: 1}              400 fields{nonsense}
 *   101   PATCH {low_stock_amount: null}             200 — reads back as 2, the
 *                                                    store-wide default
 *   101   PATCH {stock_quantity: 9}                  400 fields{stock_quantity}
 *                                                    naming the adjust route
 *   9032  PATCH {manage_stock: "parent"}             **200 and destructive** —
 *                                                    see `patchInventory()`
 *   101   PATCH {id: 101}                            400, **no `details` at all**
 *
 * 101 is "Miel de jujubier", the one row in the shop whose `low_stock_amount` is
 * 5 rather than 2. 103 is one of the eight that manage no stock. 9030 is the
 * slot-0 variation, which is the only kind of row carrying `backorders:
 * "notify"`. 9032 is the delegated one.
 */

const ADJUST_MODES = ["set", "increase", "decrease"];
const ADJUST_FIELDS = ["mode", "quantity", "reason", "note"];

/**
 * `POST /inventory/{id}/adjust`.
 *
 * The gates, in the order the API applies them, so the reason on screen is the
 * reason the server would have given:
 *
 *   1. every bad field at once   400 `details.fields` — an empty body names
 *                                three, because the form renders one message per
 *                                control and a 400 naming only the first would
 *                                hide the rest
 *   2. the row tracks nothing    409 {id, manage_stock}
 *   3. below zero, no backorders 409 {stock_quantity, projected, backorders}
 *
 * **The body is exactly four fields and an unknown one is a 400**, which is why
 * `AdjustForm` sends a named payload rather than a spread — `note` is omitted
 * entirely when it is blank rather than sent as `""`.
 *
 * **The three system reasons are refused with the same sentence as an unknown
 * one**, on purpose: a caller must not be able to probe which forgeries exist by
 * reading the difference between two messages.
 *
 * The response is `{item, movement}` and **the movement omits `id`** — it is
 * `InventoryMovement::toArray()`, where the ledger's own rows are the stored
 * records. `adjustResult` in the panel's schema is `movement.omit({id: true})`
 * for exactly this, and because both schemas are loose an `id` that leaked in
 * here would parse silently, so the test asserts the absence rather than
 * inferring it from a parse.
 */
function adjustStock(row, body) {
  const fields = {};

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return invalidBody("Invalid parameter(s): mode, quantity, reason", {
      mode: `Must be one of: ${ADJUST_MODES.join(", ")}.`,
      quantity: "Must be a whole number.",
      reason: `Must be one of: ${MANUAL_REASONS.join(", ")}.`,
    });
  }

  for (const key of Object.keys(body)) {
    if (!ADJUST_FIELDS.includes(key)) fields[key] = "Unknown field.";
  }

  const mode = body.mode;
  if (typeof mode !== "string" || !ADJUST_MODES.includes(mode)) {
    fields.mode = `Must be one of: ${ADJUST_MODES.join(", ")}.`;
  }

  const quantity = body.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity)) {
    fields.quantity = "Must be a whole number.";
  } else if (quantity < 0) {
    fields.quantity = "Cannot be negative.";
    // A zero-magnitude relative move is a no-op that would still write a ledger
    // row, so it is refused for the two relative modes and allowed for `set` —
    // setting a shelf to zero is a real thing to record. `quantityProblem()` in
    // lib/movement-reason.ts is the field's copy of this rule.
  } else if (quantity === 0 && mode !== "set") {
    fields.quantity = "Must be greater than zero.";
  }

  if (typeof body.reason !== "string" || !MANUAL_REASONS.includes(body.reason)) {
    fields.reason = `Must be one of: ${MANUAL_REASONS.join(", ")}.`;
  }

  if ("note" in body && (typeof body.note !== "string" || body.note.length > 500)) {
    fields.note = "note must be a string of 500 characters or fewer.";
  }

  if (Object.keys(fields).length > 0) {
    return invalidBody(`Invalid parameter(s): ${Object.keys(fields).join(", ")}`, fields);
  }

  /*
   * `managing_stock`, not `manage_stock` — the raw value is the string
   * `"parent"` on the one row where the two disagree, and it is *that* value the
   * refusal publishes, because it is the fact the reader needs: the shelf is
   * somewhere else. `adjustTarget()` in the panel is what avoids this gate.
   */
  if (!row.managing_stock) {
    return conflict("This product does not manage stock.", {
      id: row.id,
      manage_stock: row.manage_stock,
    });
  }

  const before = row.stock_quantity ?? 0;
  const projected =
    mode === "increase" ? before + quantity : mode === "decrease" ? before - quantity : quantity;

  /*
   * **Refused, never clamped**, and `projected` is the number the screen renders
   * — it is the thing the person has to change, and a 409 that only said "too
   * many" would leave them doing the subtraction that the preview line exists to
   * spare them. A row whose `backorders` is anything but "no" takes the move and
   * the shelf really does go negative, which is the state a clamping mock could
   * never produce.
   */
  if (projected < 0 && row.backorders === "no") {
    return conflict("This adjustment would take stock below zero.", {
      stock_quantity: before,
      projected,
      backorders: row.backorders,
    });
  }

  writeStock(row, projected);

  const movement = {
    id: state.nextMovementId++,
    // The id whose shelf moved. It is this row, because a row that delegates was
    // refused two gates above.
    product_id: row.id,
    delta: projected - before,
    quantity_before: before,
    quantity_after: projected,
    reason: body.reason,
    note: typeof body.note === "string" ? body.note : "",
    // A manual adjustment has no order behind it. `movementActor()` therefore
    // renders it as *you*, which is the whole point of the reader's own id here.
    order_id: 0,
    actor_id: IDENTITY.id,
    // The fixture epoch, because there is no clock in this file. Every movement
    // a process writes carries the same stamp, which is the price of a
    // byte-stable screenshot.
    created_at: stamp(0),
  };
  state.movements = [movement, ...state.movements];

  const written = { ...movement };
  delete written.id;

  const item = inventoryRows().find((candidate) => candidate.id === row.id);
  return ok({ item, movement: written });
}

/**
 * The new quantity, onto whichever body actually holds it.
 *
 * `stock_status` is recomputed rather than left behind: WooCommerce's own
 * `wc_update_product_stock_status()` derives it, and a row reporting `instock`
 * over a quantity of zero is a row arguing with itself. `onbackorder` is
 * reachable only through here and only on a row that takes backorders, which is
 * the one path in this file that produces the third value of that enum.
 */
function writeStock(row, quantity) {
  const status = quantity > 0 ? "instock" : row.backorders === "no" ? "outofstock" : "onbackorder";

  if (row.parent_id === 0) {
    const current = productById(row.id);
    state.products.set(row.id, { ...current, stock_quantity: quantity, stock_status: status });
    return;
  }
  const current = variationRows().find((candidate) => candidate.id === row.id);
  state.variations.set(row.id, { ...current, stock_quantity: quantity, stock_status: status });
}

/**
 * ── `PATCH /inventory/{id}`, and the most dangerous thing on this subject ────
 *
 * **It is absent from the route list that scoped this section** —
 * ADMIN_PANEL.md:1669 names eight endpoints and this is not one of them, which
 * is corrected in the build's own note four lines below it. The `PATCH`/`POST`
 * split is not decoration: settings come here and the *quantity* does not, which
 * is what guarantees the movement ledger has no gaps.
 *
 * So `stock_quantity` is a **400 that names the adjust route**. It is also the
 * only refusal `ItemDetail`'s orphan-field branch can ever receive — the form
 * renders four controls and this names a fifth, so a message with no control to
 * land on has to surface at the top of the screen or the person reads a refusal
 * with no cause anywhere on it.
 *
 * **And then the hazard.** `manage_stock` arrives at WordPress's boolean
 * sanitiser, which returns `true` for any non-empty string it does not
 * recognise — so a client that PATCHes the whole GET body back sends the string
 * `"parent"` and **silently detaches the variation's stock from its parent**.
 * Nothing on screen says so; the row simply stops reporting its parent's 24 and
 * starts reporting a shelf of its own. That is why `ItemDetail.saveSettings()`
 * sends only the fields that changed, and why the naive whole-body PATCH is
 * caught one field earlier by the `stock_quantity` 400 above — the trap is
 * waiting exactly one step past the obvious fix for it.
 *
 * The coercion is taken from the brief that scoped this branch rather than
 * re-measured here. WordPress has two paths for a boolean argument — a validate
 * callback that would 400 on `"parent"`, and a sanitise callback that coerces —
 * and which one this route registers was not verified. Written down rather than
 * hidden, because the two produce opposite screens.
 *
 * Everything else follows the products branch's measured split: a **read-only**
 * key is dropped in silence, an **unknown** one is a 400, and a body left with
 * nothing supported is a 400 with **no `details` at all**.
 */
const INVENTORY_READ_ONLY = [
  "id",
  "parent_id",
  "type",
  "name",
  "sku",
  "managing_stock",
  "stock_managed_by_id",
  "low_stock",
];

const BACKORDERS = ["no", "notify", "yes"];

const INVENTORY_FIELD_RULES = {
  manage_stock: (value) => {
    if (typeof value === "boolean") return null;
    // The hazard, reproduced. See the docblock above.
    if (value === "parent") return null;
    return "Must be true or false.";
  },
  stock_status: mustBeOneOf(STOCK_STATUSES),
  backorders: mustBeOneOf(BACKORDERS),
  // `null` clears the per-product threshold and the store-wide default applies;
  // `0` is a different, legal value. Both are accepted and they are not the same
  // request, which is the same null-is-not-zero rule the quantity follows.
  low_stock_amount: (value) =>
    value === null || (Number.isInteger(value) && value >= 0)
      ? null
      : "Must be a whole number of zero or more, or null.",
};

function patchInventory(row, body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return bareFail(400, "invalid_request", "No supported fields were provided.");
  }

  const fields = {};
  const writes = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "stock_quantity") {
      fields.stock_quantity =
        "The quantity cannot be set here. Use POST /inventory/{id}/adjust, which records a movement.";
      continue;
    }
    if (INVENTORY_READ_ONLY.includes(key)) continue;

    const rule = INVENTORY_FIELD_RULES[key];
    if (rule === undefined) {
      fields[key] = "Unknown field.";
      continue;
    }
    const problem = rule(value);
    if (problem === null) writes[key] = value;
    else fields[key] = problem;
  }

  if (Object.keys(fields).length > 0) {
    return invalidBody(`Invalid parameter(s): ${Object.keys(fields).join(", ")}`, fields);
  }
  if (Object.keys(writes).length === 0) {
    return bareFail(400, "invalid_request", "No supported fields were provided.");
  }

  const settings = { ...state.stockSettings.get(row.id) };
  if ("backorders" in writes) settings.backorders = writes.backorders;
  if ("low_stock_amount" in writes) {
    // Never null on the way back out: the presenter publishes the *effective*
    // threshold, which is the store-wide default once the row's own is cleared.
    settings.low_stock_amount =
      writes.low_stock_amount === null ? STORE_LOW_STOCK_AMOUNT : writes.low_stock_amount;
  }
  if (Object.keys(settings).length > 0) state.stockSettings.set(row.id, settings);

  if ("manage_stock" in writes || "stock_status" in writes) {
    const tracking =
      "manage_stock" in writes
        ? writes.manage_stock === "parent" || writes.manage_stock === true
        : row.managing_stock;

    /*
     * The quantity comes off the **stored body**, not off the row above it.
     *
     * That distinction is the whole damage. A delegated variation's row reports
     * `stock_quantity: 24` because the presenter reads the *parent's* shelf
     * through it; the variation's own `_stock` is null, because it has never had
     * one. Turning tracking on gives it a shelf of its own, and that shelf is
     * empty — so the row goes from reporting 24 units to reporting none, with a
     * `stock_status` of `outofstock` under it and nothing on screen saying why.
     * Reading the presented figure instead would have the variation and its
     * parent both claiming the same 24, which is a state the shop cannot store
     * and would make the detach look harmless.
     *
     * Turning tracking off removes the quantity altogether — `null`, not the
     * figure it used to hold, which is the catalogue's own invariant and the one
     * `patchProduct()` already keeps.
     */
    const current =
      row.parent_id === 0
        ? productById(row.id)
        : variationRows().find((candidate) => candidate.id === row.id);

    const quantity = tracking ? (current.stock_quantity ?? 0) : null;
    const status =
      "stock_status" in writes
        ? writes.stock_status
        : quantity === null || quantity > 0
          ? "instock"
          : "outofstock";

    const next = { ...current, manage_stock: tracking, stock_quantity: quantity, stock_status: status };
    if (row.parent_id === 0) state.products.set(row.id, next);
    else state.variations.set(row.id, next);
  }

  return ok(inventoryRows().find((candidate) => candidate.id === row.id));
}

/* ---------------------------------------------------------- coupon queries --- */

/**
 * `?status=` on coupons, and **it has three states where the other collections
 * have two.**
 *
 * Absent is not a synonym for either value: no `?status=` returns publish *and*
 * draft together, `publish` returns one, `draft` returns the other. Measured, and
 * app/[locale]/(panel)/coupons/query.ts:14-23 is built on it — the segmented
 * control's first segment sends **nothing**, because `?status=` with an empty
 * value would leave a meaningless parameter in every URL for a request that means
 * the same thing.
 *
 * `?status=trash` is a **400**, while a trashed coupon reads back from
 * `/coupons/{id}` with a 200. That asymmetry is why `READABLE_COUPON_STATUSES` in
 * lib/coupon-status.ts has an entry `COUPON_STATUSES` does not, and it is the
 * same shape `/products` has for the same reason.
 *
 * The two lists are written out rather than imported — this file imports nothing
 * — and the unit suite asserts they still agree with lib/coupon-status.ts, which
 * is the arrangement `PRODUCT_TYPES` above is held to.
 */
const COUPON_STATUSES = ["publish", "draft"];
const DISCOUNT_TYPES = ["percent", "fixed_cart", "fixed_product"];

/**
 * **The empty string is the first named option in the refusal**, and that is not
 * a typo to tidy up. The "no filter" sentinel is inside the enum the router
 * validates against, so the real 400 reads
 *
 *     status is not one of , publish, and draft.
 *
 * — an offer of something that is not a status. lib/coupon-status.ts:18-25
 * records it, and a message shown to a person is worth knowing about first.
 */
const COUPON_STATUS_FILTERS = ["", ...COUPON_STATUSES];

/**
 * **`orderby` is validated and then *honoured*, all four values in both
 * directions** — one of exactly two collections in this file that sorts at all.
 *
 * Re-measured 2026-08-25 against the live router, one value at a time and against
 * a positive control, because this file recorded the whole set as ignored:
 *
 *   id     desc  30, 29, 28, 27; asc 27, 28, 29, 30
 *   code   asc   bienvenue10, livraison, ramadan2000, tapis15 — alphabetical
 *   usage  desc  99, 50, 5, 1; asc 1, 5, 50, 99 — **numeric**, not lexical
 *   date   asc   27, 28, 29, 30; desc **the same** — see below
 *
 * Anything else is a 400, `order=sideways` is a 400, and `?orderby=` is the
 * absence of the parameter rather than a fifth value.
 *
 * **`date` is the default, and it is the one value that can tell you nothing.**
 * All four live coupons share a single `post_date`, so both directions are a tie
 * across every row and both answer the bare listing's own sequence. That is why
 * this collection was recorded as validate-then-ignore: `date` was used as its own
 * control and proved nothing. It cannot establish the default direction either —
 * see `sortCoupons` — and *that* trap caught a second pass on the way past.
 *
 * `usage` is the one to get wrong from the other direction: compared as text, 99
 * sorts above 7.
 *
 * `app/[locale]/(panel)/coupons/query.ts` names these four as the set *the 400
 * enumerates*, and `orderbyFromKey()` is the guard that stops a stale or
 * hand-edited URL provoking one.
 *
 * **The screen ships three of the four**, and the missing one is `date`, not
 * `id`: `date` is `date_created` and the only date column on that list is
 * `date_expires`, a different field the API cannot sort by. So `date` stays the
 * resting order with no header claiming it, and `DataTable`'s
 * `none → asc → desc → none` cycle is what returns to it.
 */
const COUPON_ORDERBY = ["date", "id", "code", "usage"];

/**
 * All eight combinations, which is the difference between this collection and
 * `/products`: there, five of ten were re-measured working and the other five are
 * accepted-and-unsorted on purpose. Here every one of the eight was measured, so a
 * Map that is *total* is the honest shape rather than a shortcut.
 *
 * `compareBy` uses `<`/`>`, which is numeric on numbers and lexical on strings —
 * the distinction that decides whether 99 sorts above 7 — so `id` and `usage` must
 * stay unwrapped. `code` is folded rather than `localeCompare`d for the reason
 * `byTitle` is: a collation that depends on the runtime's ICU build is a
 * screenshot that differs between machines.
 */
const byCouponDate = compareBy((row) => row.date_created);
const byCouponId = compareBy((row) => row.id);
const byCouponCode = compareBy((row) => fold(row.code));
const byCouponUsage = compareBy((row) => row.usage_count);

const COUPON_SORTS = new Map([
  ["date asc", byCouponDate],
  ["date desc", descending(byCouponDate)],
  ["id asc", byCouponId],
  ["id desc", descending(byCouponId)],
  ["code asc", byCouponCode],
  ["code desc", descending(byCouponCode)],
  ["usage asc", byCouponUsage],
  ["usage desc", descending(byCouponUsage)],
]);

/**
 * **`order` defaults to `desc`** — `sortProducts`'s default, WooCommerce's own,
 * and measured: `orderby=id` with no `order` answers 30, 29, 28, 27.
 * `CouponRepository.php:73` is explicit about it —
 * `strtoupper($order) === 'ASC' ? 'ASC' : 'DESC'`.
 *
 * **Do not re-derive that from `date`.** The bare listing answers 27, 28, 29, 30
 * and so does `orderby=date` in *either* direction, which reads like an ascending
 * default and is not one: the four live coupons share one `post_date`, so every
 * comparison ties and the rows fall back to primary-key order. A pass that
 * reasoned "the default sequence is oldest-first, therefore the default is `asc`"
 * got this backwards — the same blind spot, one level down, that had the whole
 * collection recorded as unsorted.
 *
 * `checkSort` has already refused anything outside the eight, so the lookup is
 * total and there is no unsorted arm — the opposite of `sortProducts`, which needs
 * one for the five combinations it deliberately does not serve.
 */
function sortCoupons(rows, params) {
  // `checkSort` has already refused `""` along with everything else outside the
  // enum, so `??` and `||` are the same thing here; only a truly absent
  // parameter reaches the defaults.
  const orderby = params.get("orderby") ?? "date";
  const order = params.get("order") ?? "desc";
  // A stable sort, so rows that tie — every coupon a process creates shares one
  // `date_created`, because there is no clock — keep the order they came in.
  return [...rows].sort(COUPON_SORTS.get(`${orderby} ${order}`));
}

/**
 * Every coupon this process can see, newest first, read through the writes — and
 * `couponsListing()` sorts it into that same order by default, because `date desc`
 * is what no `?orderby=` means. Every other caller here is a `find()` by id.
 */
const allCoupons = () =>
  [
    ...state.createdCoupons.map((id) => state.coupons.get(id)),
    ...COUPONS.map((row) => state.coupons.get(row.id) ?? row),
  ].filter((row) => !state.couponsGone.has(row.id));

/**
 * One coupon by id, **including a trashed one** — that is the whole point of it
 * — and undefined once it has been forced, which is the only path to a 404.
 */
const couponById = (id) =>
  id === null ? undefined : allCoupons().find((row) => row.id === id);

/** The single-coupon shape. The list must never carry this key. */
const withRestrictions = (row) => ({ ...row, restrictions: restrictionsFor(row) });

function filterCouponStatus(rows, params) {
  const status = params.get("status");
  if (status === null || status === "") {
    // Publish **and** draft. Not "everything": the trash is unlistable.
    return { rows: rows.filter((row) => row.status !== "trash") };
  }
  if (!COUPON_STATUSES.includes(status)) {
    const message = notOneOf("status", COUPON_STATUS_FILTERS);
    return {
      error: fail(400, "invalid_request", message, { params: { status: message } }),
    };
  }
  return { rows: rows.filter((row) => row.status === status) };
}

/**
 * `GET /coupons`.
 *
 * **`?search=` matches the code and nothing else here**, and that is the
 * deliberately *less* capable direction. app/[locale]/(panel)/coupons/query.ts:7
 * records `search` as a measured parameter, and nothing anywhere records which
 * fields it reads — WordPress's own `s` on a post type would take the title and
 * the content, which would be the code and the description. The customers
 * collection is why this file will not assume the second half: a search list that
 * carried two fields the API has never been seen to match shipped for three
 * branches and made an entire empty state unreachable. Narrower here means a
 * control verified against this mock still works against the shop; wider would
 * mean the reverse.
 *
 * Folded, like every other search in this file, because the collation behind them
 * is the same one.
 */
function couponsListing(params) {
  const sort = checkSort(params, COUPON_ORDERBY);
  if (sort !== null) return sort;

  const filtered = filterCouponStatus(allCoupons(), params);
  if (filtered.error) return filtered.error;

  const rows = searchRows(filtered.rows, params, (row) => [row.code]);

  const page = paginate(sortCoupons(rows, params), params);
  return page.error ?? ok(page.rows, page.meta);
}

/**
 * ── The two picker routes, and why they are not the catalogue ────────────────
 *
 * `GET /coupons/eligible-products` and `/coupons/eligible-categories` exist
 * because `/products` and `/product-categories` are **`ac_manage_products`, which
 * a Marketing Manager does not hold** — one of the three roles that can manage
 * coupons, and the one whose job coupons are. Built on the catalogue routes, the
 * restriction picker would 403 for exactly that role.
 *
 * So a row here is **strictly less than a catalogue row**: id, name, SKU and
 * status, and no price, no stock, no cost. Widening `ac_manage_products` would
 * have handed the role the whole catalogue in order to give it a label, which is
 * the trade these two routes exist to refuse — and a mock that served the product
 * body through them would erase the distinction entirely.
 *
 * **The product search matches the SKU as well as the name**, which WordPress's
 * own `s` does not: it reads the title and the content, so a shop that knows a
 * product by `AC-CAT-0104` would type it and get an empty picker. That is the one
 * capability here that is *more* than the catalogue's, it is measured
 * (ADMIN_PANEL.md:1946-1948), and it is the reason the route was not simply
 * `/products` behind a second capability.
 *
 * The category search takes the **name only**. Nothing measured says the slug is
 * read, and this is the same restraint the code-only search above shows.
 *
 * **Neither route validates anything but the paging parameters — measured
 * 2026-08-25, not merely observed here.** An audit flagged this as a suspected
 * divergence on the strength of how odd it looks next to `/coupons`; it was
 * queried against the live router one parameter at a time, against `/coupons` as
 * the positive control, and the odd-looking behaviour is the real one:
 *
 *   /coupons/eligible-products?orderby=zzz        200, 28 rows
 *   /coupons/eligible-products?order=sideways     200, 28 rows
 *   /coupons/eligible-products?status=zzz         200, 28 rows
 *   /coupons/eligible-categories?orderby=zzz      200, 6 rows
 *   /coupons/eligible-products?per_page=101       400
 *   /coupons?orderby=zzz          (the control)   400
 *
 * So `checkSort` runs on `/coupons` and on neither of these, and that is the
 * shop's own asymmetry rather than this file's. A picker built with a sort or a
 * status filter would look like it worked here **and would also work there** —
 * it would simply sort nothing. The paging parameters are the exception and go
 * through the shared `paginate()`, which refuses all five edge values.
 *
 * Written down with its date because this is the second time the question has
 * been opened. It does not need a third.
 *
 * `sku: null` is unreachable in this shop and the schema allows it: every row in
 * this catalogue carries a SKU. Reproducing it would mean emptying one, and the
 * SKUs here are load-bearing — the 60-character one the overflow assertion needs,
 * and `AC-CAT-0101`, which is what makes the products 409 reachable.
 */
function eligibleProductsListing(params) {
  // The listed catalogue: a trashed product cannot be picked, and a draft can —
  // a coupon may legitimately be restricted to one.
  const rows = listed().map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku === "" ? null : product.sku,
    status: product.status,
  }));

  const term = fold((params.get("search") ?? "").trim());
  const matched =
    term === ""
      ? rows
      : rows.filter((row) => fold(`${row.name} ${row.sku ?? ""}`).includes(term));

  const page = paginate(matched, params);
  return page.error ?? ok(page.rows, page.meta);
}

function eligibleCategoriesListing(params) {
  /*
   * Five keys, written out rather than spread. `CATEGORIES` carries a
   * `description` this route does not, and a mock that let it through would be
   * publishing a field the picker's schema does not describe — the same reason
   * the product rows above are mapped rather than passed along.
   */
  const rows = CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    parent: category.parent,
    count: category.count,
  }));

  const term = fold((params.get("search") ?? "").trim());
  const matched = term === "" ? rows : rows.filter((row) => fold(row.name).includes(term));

  const page = paginate(matched, params);
  return page.error ?? ok(page.rows, page.meta);
}

/* ----------------------------------------------------------- coupon writes --- */

/*
 * ── Which coupon id produces which refusal ───────────────────────────────────
 *
 * The fourth table in this file, on the same rule as the other three: a screen
 * cannot be verified against a state it can never reach, and every id below is
 * written out because a literal that stops matching fails a test while a `find()`
 * moves quietly and takes the table's meaning with it.
 *
 *   id    request                                    answer
 *   ────  ─────────────────────────────────────────  ──────────────────────────
 *   —     POST  {code:"BIENVENUE10", amount:"5"}     409 details.**code**, and it
 *                                                    carries `bienvenue10`
 *   —     POST  {code:"x"}                           400 fields{amount} — before
 *                                                    the uniqueness check
 *   —     POST  {code:"BIENVENUE10"}                 400 fields{amount} **only**:
 *                                                    the order is measured, so a
 *                                                    duplicate with no amount
 *                                                    reports the amount alone
 *   301   PATCH {}                                   **200** no-op — not the 400
 *                                                    a product's `{}` gets
 *   301   PATCH {restrictions:{…}}                   **200** no-op — emitted on
 *                                                    every read and *dropped* on
 *                                                    write, which is what lets the
 *                                                    read body PATCH back whole
 *   301   PATCH {usage_count: 5}                     200, and the count does not
 *                                                    move
 *   301   PATCH {maximum_discount:"50"}              400 fields{maximum_discount}
 *                                                    — no such field exists
 *   301   PATCH {date_expires:"31/12/2026"}          400 — wrong format
 *   301   PATCH {date_expires:"2026-02-30"}          400 — a **different**
 *                                                    message: no such date
 *   301   PATCH {amount:"-5"}                        400 fields{amount}
 *   301   PATCH {minimum_amount:"-1"}                400 fields{minimum_amount};
 *                                                    it used to answer 200 and
 *                                                    **erase** the real minimum
 *   301   PATCH {minimum_amount:0}                   200, and reads back **null**
 *   301   PATCH {date_expires:"2026-12-31"}          200, reads back
 *                                                    `2026-12-31T00:00:00+00:00`
 *   305   PATCH {product_ids:[101,8842]}             400 fields{product_ids} —
 *                                                    "No product with id 8842.",
 *                                                    its own body, refused
 *   306   GET                                        200 `status:"trash"`
 *   302   DELETE                                     200 {id,deleted:true}; the
 *                                                    next GET is 200 `trash` and
 *                                                    `livraison` is **still
 *                                                    taken**
 *   302   DELETE ?force=true                         the identical body; the next
 *                                                    GET is 404 and `livraison`
 *                                                    is free
 *
 * 301 is `bienvenue10`, 302 is the zero-amount `livraison`, 305 carries the two
 * stale ids and 306 is the trashed one.
 */

/**
 * **Read-only and *dropped in silence*, which is a product's rule after all.**
 *
 * This list was refused by name for two branches, and that was this file inventing
 * a stricter API than the one it fakes. Re-measured 2026-08-25 against the live
 * router: `{"usage_count":999}`, `{"id":9999}`, `{"date_created":…}`,
 * `{"used_by":[1,2]}` and **the entire GET body, `restrictions` and all** each
 * answer 200 with the stored value unmoved, while `{"nonsense":1}` is a 400
 * carrying `details.fields.nonsense = "Unknown field."`. Read-only and unknown are
 * different answers, exactly as they are on a product.
 *
 * What genuinely differs between the two collections is only what happens once
 * nothing supported is left: a product's `PATCH {"id":9999}` is a 400 *"No
 * supported fields were provided."* and a coupon's is the same 200 no-op its
 * `PATCH {}` is. One rule, two endings.
 *
 * Inventing the refusal was not a harmless excess of caution. It manufactured an
 * error path the panel handles and production can never take, and it made the
 * "save what I was given" round trip — the one `docs/API.md` in the backend repo
 * documents — look impossible from here.
 *
 * `used_by` stays on the list although nothing emits it: dropped rather than
 * refused still means a client cannot discover the field by having a write
 * accepted, which was the only thing the refusal ever bought.
 */
const COUPON_READ_ONLY = [
  "id",
  "usage_count",
  "used_by",
  "date_created",
  "date_modified",
  "restrictions",
];

/** The four, mirroring `RESTRICTION_FIELDS` in lib/coupon-status.ts. */
const COUPON_RESTRICTION_FIELDS = [
  "product_ids",
  "excluded_product_ids",
  "product_categories",
  "excluded_product_categories",
];

/** Which of the four name products and which name categories. */
const COUPON_RESTRICTION_KIND = {
  product_ids: "products",
  excluded_product_ids: "products",
  product_categories: "categories",
  excluded_product_categories: "categories",
};

/** The code as it will actually be stored — `normalizeCode()` in lib/coupons.ts. */
const normalizeCouponCode = (value) => String(value).trim().toLowerCase();

/**
 * `code`, and **an empty one is refused rather than stored**. Measured
 * 2026-08-25, on `POST` and on `PATCH` alike, for `""` and for `"   "`:
 *
 *   400 invalid_request "The coupon is invalid."
 *   details.fields.code: "A coupon needs a code."
 *
 * This was the destructive divergence. `PATCH {"code": ""}` answered **200 and
 * blanked the code** here, so a form that cleared the field and saved destroyed
 * the coupon's identity *and* the key the uniqueness check runs on — against the
 * harness, silently, with every gate still green.
 *
 * Trimmed before the test, because the store trims too: `"   "` would have been
 * saved as `""` by `normalizeCouponCode` below and is refused for that reason.
 */
const mustBeCouponCode = (value) => {
  if (typeof value !== "string") return "Must be a string.";
  return value.trim() === "" ? "A coupon needs a code." : null;
};

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * `amount` — and `""` is **not** a value here.
 *
 * `"0.00"` is a real coupon, so a zero cannot mean absence on this field, which
 * is the exact inverse of the two thresholds below. "Must not be negative." is
 * the API's own sentence, quoted.
 */
const mustBeAmount = (value) => {
  if (typeof value !== "string" || !DECIMAL.test(value)) return "Must be a number.";
  return Number.parseFloat(value) < 0 ? "Must not be negative." : null;
};

/**
 * A threshold — `minimum_amount` and `maximum_amount`.
 *
 * **Zero is an absence here and a value on `amount`.** Clearing is expressible
 * three ways — `null`, `""` and `0` — all measured, which is why a bare number is
 * accepted on these two and not on `amount`.
 *
 * A negative used to be the worst of both worlds: the clearing arm read `<= 0.0`,
 * so `{"minimum_amount": "-1"}` answered 200 and **erased a real 15 000 DA
 * minimum** while a negative `amount` was refused by name. Fixed in `ecom-temp`,
 * and reproduced as fixed — a mock that swallowed it would let the panel ship the
 * silent-erasure path again.
 */
const mustBeThreshold = (value) => {
  if (value === null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Must be a number.";
    return value < 0 ? "Must not be negative." : null;
  }
  if (typeof value !== "string" || !DECIMAL.test(value)) return "Must be a number.";
  return Number.parseFloat(value) < 0 ? "Must not be negative." : null;
};

/**
 * `usage_limit`, `usage_limit_per_user`, `limit_usage_to_x_items` — a whole
 * number or null, and null is "no limit" rather than zero.
 *
 * **The negative refusal here is shaped, not measured.** Nothing published a
 * figure for what a negative usage limit does; the two money fields above were
 * measured and these were not. Refusing is the conservative direction — a control
 * built against it sends nothing worse to the shop — and it is flagged rather
 * than presented as measurement.
 */
const mustBeCount = (value) => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return "Must be a whole number.";
  return value < 0 ? "Must not be negative." : null;
};

/**
 * `date_expires`, and **the two refusals are different sentences on purpose**:
 * `31/12/2026` is the wrong notation and `2026-02-30` is a date that does not
 * exist. Measured as two, and a mock that answered one message for both would let
 * a form print "check the format" at somebody who typed a real-looking February
 * 30th.
 *
 * The full ISO form is accepted as well as `Y-m-d` — measured — which is what lets
 * a client post back what it was given. What it is *read* as is the other half of
 * the asymmetry, and `applyCouponWrites()` below is where that happens.
 */
const mustBeExpiry = (value) => {
  if (value === null || value === "") return null; // clears the expiry
  if (typeof value !== "string") return "Must be a date in YYYY-MM-DD form.";

  const day = value.slice(0, 10);
  if (!YMD.test(day)) return "Must be a date in YYYY-MM-DD form.";

  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  const real =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === date;
  return real ? null : "That date does not exist.";
};

/**
 * `email_restrictions` — **every entry is checked, and one bad entry refuses the
 * whole list.** Measured 2026-08-25:
 *
 *   ["not an email"]   400    ["a@b.dz", "nope"]   400 — the good entry does not
 *   ["a@b.dz"]         200                               rescue the list
 *   ["*@exemple.dz"]   200 — the wildcard form is legal
 *
 * This accepted any list of strings, which is the quiet half of the same class
 * of error as the code above: a restriction control verified here would have
 * shipped, and the shop would have refused the save.
 *
 * `*@exemple.dz` needs no special case — `*` is an ordinary local part under
 * this test. Only the two forms above are measured; a bare `*` and `*@*` are
 * not, and are refused here rather than guessed into the accepting direction.
 */
const EMAIL_OR_WILDCARD = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const mustBeEmails = (value) => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return "Must be a list of email addresses.";
  }
  return value.every((entry) => EMAIL_OR_WILDCARD.test(entry.trim()))
    ? null
    : "Every entry must be an email address or a wildcard.";
};

const COUPON_FIELD_RULES = {
  code: mustBeCouponCode,
  // `trash` is readable and **not writable** — a coupon is trashed by DELETE,
  // exactly as a product is, which is why this list is the filterable pair.
  status: mustBeOneOf(COUPON_STATUSES),
  discount_type: mustBeOneOf(DISCOUNT_TYPES),
  amount: mustBeAmount,
  description: mustBeText,
  date_expires: mustBeExpiry,
  minimum_amount: mustBeThreshold,
  maximum_amount: mustBeThreshold,
  usage_limit: mustBeCount,
  usage_limit_per_user: mustBeCount,
  limit_usage_to_x_items: mustBeCount,
  individual_use: mustBeFlag,
  free_shipping: mustBeFlag,
  exclude_sale_items: mustBeFlag,
  email_restrictions: mustBeEmails,
  product_ids: mustBeIds,
  excluded_product_ids: mustBeIds,
  product_categories: mustBeIds,
  excluded_product_categories: mustBeIds,
};

/**
 * What a restriction id may name: the same rows the pickers offer, so a form
 * cannot commit a selection its own picker could not have made.
 */
const eligibleProductIds = () => new Set(listed().map((product) => product.id));
const eligibleCategoryIds = () => new Set(CATEGORIES.map((category) => category.id));

/**
 * Read a write body, validating as it goes.
 *
 * The gates are in the order the API applies them, so the reason on screen is the
 * reason the server would have given:
 *
 *   1. every bad field at once   400 `details.fields` — unknown keys and invalid
 *                                values in one object, because the form renders
 *                                one message per control. Read-only keys are not
 *                                here: they leave in silence before this pass can
 *                                see them
 *   2. **`amount` on a POST**    part of the same pass, and therefore *before*
 *                                the uniqueness check — measured, and the reason
 *                                a duplicate code with no amount reports only the
 *                                amount
 *   3. the restriction ids       400 per field, naming the offending ids
 *   4. a duplicate code          409 `details.code` — the caller's job, below
 *
 * **The ids were stored blind before this existed**: `{"product_ids": [999999]}`
 * answered 200 and the coupon then applied to nothing while looking, in every
 * response and on every screen, exactly like a coupon that worked. Reads stay
 * tolerant — `restrictionsFor()` above keeps a stale id with `missing: true` —
 * because validating writes cannot make reads total.
 *
 * A body that is not an object at all is read as `{}` rather than refused, which
 * makes `PATCH` with no body the same 200 no-op `PATCH {}` is. That is the one
 * forgiving reading here and it is unmeasured; it is the shape the measured
 * no-op implies, and it is written down rather than left to be discovered.
 */
function readCouponBody(body, creating) {
  const source =
    body === null || typeof body !== "object" || Array.isArray(body) ? {} : body;

  const fields = {};
  const writes = {};

  for (const [key, value] of Object.entries(source)) {
    // Dropped, **not** refused — silently, which is what lets a client PATCH a
    // GET body back without diffing it first. See `COUPON_READ_ONLY`.
    if (COUPON_READ_ONLY.includes(key)) continue;

    const rule = COUPON_FIELD_RULES[key];
    if (rule === undefined) {
      // `maximum_discount` lands here, which is what "refused by name" means:
      // WooCommerce has no such field, and `maximum_amount` caps the cart rather
      // than the discount.
      fields[key] = "Unknown field.";
      continue;
    }
    const problem = rule(value);
    if (problem === null) writes[key] = value;
    else fields[key] = problem;
  }

  if (creating) {
    // Measured: required, and checked in this pass rather than after the
    // uniqueness check.
    if (!("amount" in writes) && fields.amount === undefined) fields.amount = "Required.";
    /*
     * **`code` being *absent* on a POST is an inference, not a measurement.**
     * An empty one is measured — `mustBeCouponCode` above has refused it before
     * this runs, which is why the arm here only ever sees a body with no `code`
     * key at all. Nothing published a refusal for that case. A coupon's code
     * *is* its `post_title` and the duplicate check runs on it, so a codeless
     * coupon would collide with the next codeless coupon — but the API has not
     * been seen to say so. Refusing is the conservative direction, and the two
     * sentences stay different so the measured one is not diluted by the guess.
     */
    if (!("code" in writes) && fields.code === undefined) fields.code = "Required.";
  }

  for (const field of COUPON_RESTRICTION_FIELDS) {
    if (!(field in writes)) continue;
    const products = COUPON_RESTRICTION_KIND[field] === "products";
    const known = products ? eligibleProductIds() : eligibleCategoryIds();
    const unknown = writes[field].filter((id) => !known.has(id));
    if (unknown.length === 0) continue;
    /*
     * Named, because "one of these ids is wrong" is not something a person can act
     * on when the field holds twenty of them.
     *
     * **The API's own English, quoted, down to the singular/plural switch and the
     * resource noun** — `No product with id 999999.`, `No product with ids 999999,
     * 888888.`, `No product category with id 777777.`. This file carried an
     * invented sentence for two branches and `CouponForm` quoted it back as
     * measured; a fabricated message is as dishonest as a fabricated status code,
     * and harder to notice because nothing fails.
     */
    const noun = products ? "product" : "product category";
    const label = unknown.length === 1 ? "id" : "ids";
    fields[field] = `No ${noun} with ${label} ${unknown.join(", ")}.`;
  }

  if (Object.keys(fields).length > 0) {
    /*
     * **The coupon envelope, and it is not this file's usual one.** Measured
     * 2026-08-25, the whole response to `PATCH {"code": ""}`:
     *
     *   400 {"code":"invalid_request","message":"The coupon is invalid.",
     *        "details":{"fields":{"code":"A coupon needs a code."}}}
     *
     * `invalid_request`, not `rest_invalid_param`; a generic sentence, not
     * `Invalid parameter(s): code`. Both halves were this file's — inherited
     * from `invalidBody`, which was measured on `POST /orders/{id}/shipments`
     * and never on a coupon.
     *
     * **Scope is a judgement, not a measurement.** One refusal was measured and
     * it is applied to the whole coupon write pass, because "The coupon is
     * invalid." names no field and cannot plausibly be per-field. If a second
     * refusal here — `{"amount": "-5"}`, say — turns out to answer
     * `rest_invalid_param`, this is the line to narrow.
     */
    return { error: fail(400, "invalid_request", "The coupon is invalid.", { fields }) };
  }
  return { writes };
}

/** A decimal string, which is how every money field on a coupon reads back. */
const decimal = (value) => Number.parseFloat(String(value)).toFixed(2);

/**
 * The stored row after a write, and the three normalisations that make a read
 * differ from what was sent.
 *
 *   `code`         folded. `BRIEF-TEST-99` comes back `brief-test-99`, which is
 *                  why the form folds as the user types.
 *   thresholds     a zero **stores as null**, so `"0.00"` can never be read back
 *                  from `minimum_amount` — the inverse of `amount`, on the same
 *                  object.
 *   `date_expires` written `Y-m-d`, read back **full ISO**. This is the asymmetry
 *                  that silently deletes a date: an `<input type="date">` bound
 *                  to the response renders empty, and the next save posts `""`,
 *                  which clears it. A mock that echoed `Y-m-d` back would make
 *                  `expiryInputValue()` look like defensive padding.
 *
 * No clock: `date_modified` keeps its seeded value through a write, the way a
 * product's and an order's do, because a screenshot has to be byte-stable.
 */
function applyCouponWrites(current, writes) {
  const next = { ...current };

  for (const [key, value] of Object.entries(writes)) {
    switch (key) {
      case "code":
        next.code = normalizeCouponCode(value);
        break;
      case "amount":
        next.amount = decimal(value);
        break;
      case "minimum_amount":
      case "maximum_amount":
        next[key] =
          value === null || value === "" || Number.parseFloat(String(value)) === 0
            ? null
            : decimal(value);
        break;
      case "date_expires":
        next.date_expires =
          value === null || value === ""
            ? null
            : `${String(value).slice(0, 10)}T00:00:00+00:00`;
        break;
      default:
        next[key] = value;
    }
  }

  return next;
}

/**
 * The uniqueness check, over **every** coupon this process can see including the
 * trashed ones.
 *
 * That is the whole difference between the two deletes: trashing is reversible
 * and keeps the code, so recreating with it is a 409; `?force=true` is permanent
 * and frees it. The 409 carries the **lower-cased** form, because the API folds
 * on save and the check runs against the folded value — so `BIENVENUE10` collides
 * with `bienvenue10` and the message names a code the person recognises.
 */
function couponCodeConflict(code, exceptId) {
  const taken = allCoupons().find((row) => row.id !== exceptId && row.code === code);
  return taken === undefined
    ? null
    : conflict("That coupon code is already in use.", { code });
}

/**
 * A coupon as `POST /coupons` starts it, before the body is applied.
 *
 * `status` defaults to `publish`, which is WooCommerce's own default for a
 * created post and is what the form always sends anyway. `usage_count` starts at
 * 0 and no route here can move it — redemption is `POST /cart/coupons`, on the
 * storefront — which is why the two non-zero fixtures are seeded rather than
 * written.
 */
const blankCoupon = (id) => ({
  id,
  code: "",
  status: "publish",
  discount_type: "percent",
  amount: "0.00",
  description: "",
  date_expires: null,
  minimum_amount: null,
  maximum_amount: null,
  usage_limit: null,
  usage_limit_per_user: null,
  limit_usage_to_x_items: null,
  usage_count: 0,
  individual_use: false,
  free_shipping: false,
  exclude_sale_items: false,
  product_ids: [],
  excluded_product_ids: [],
  product_categories: [],
  excluded_product_categories: [],
  email_restrictions: [],
  // The fixture epoch, because there is no clock. Every coupon a process creates
  // carries the same stamp, which is the price of a byte-stable screenshot.
  date_created: iso(0),
  date_modified: null,
});

function createCoupon(body) {
  const parsed = readCouponBody(body, true);
  if (parsed.error) return parsed.error;

  const code = normalizeCouponCode(parsed.writes.code);
  const clash = couponCodeConflict(code, null);
  if (clash !== null) return clash;

  const id = state.nextCouponId++;
  // `coupon`, not `created` — the module's `created()` envelope helper is what
  // this returns through, and a local of the same name would shadow it.
  const coupon = applyCouponWrites(blankCoupon(id), parsed.writes);
  state.coupons.set(id, coupon);
  state.createdCoupons = [id, ...state.createdCoupons];

  // `restrictions` is emitted by POST as well as by GET — which is exactly what
  // makes it the round-trip trap it is.
  // **201**, measured 2026-08-25 on `POST /coupons`.
  return created(withRestrictions(coupon));
}

function patchCoupon(current, body) {
  const parsed = readCouponBody(body, false);
  if (parsed.error) return parsed.error;

  /*
   * **`PATCH {}` is a 200 no-op**, and this is the line that says so. A product's
   * `{}` is a 400 that names nothing; a coupon's is the coupon back unchanged.
   * Three collections, three rules — the third is an order's COD, which
   * round-trips whole. A mock that shared one rule between them would make two of
   * the three screens wrong about their own save button.
   *
   * This is also where a body of nothing but read-only keys lands, now that they
   * are dropped above: `PATCH {"id":9999}` is this same no-op, where a product's
   * is the 400. That ending is the *only* thing separating the two rules.
   */
  if (Object.keys(parsed.writes).length === 0) return ok(withRestrictions(current));

  if ("code" in parsed.writes) {
    const clash = couponCodeConflict(normalizeCouponCode(parsed.writes.code), current.id);
    if (clash !== null) return clash;
  }

  const next = applyCouponWrites(current, parsed.writes);
  state.coupons.set(current.id, next);
  return ok(withRestrictions(next));
}

/**
 * `DELETE /coupons/{id}`, and `?force=true`.
 *
 * **Two acts with different consequences, answering identical bodies.** Nothing
 * in the response distinguishes them — the panel knows only because it knows what
 * it asked for, which is why the permanent path sits behind a confirmation. The
 * difference is visible on the *next* request and nowhere else:
 *
 *   trash          the coupon leaves every listing, `GET /coupons/{id}` is a
 *                  **200 with `status: "trash"`**, and the code is still taken
 *   ?force=true    `GET /coupons/{id}` is a **404** — the only path to one — and
 *                  the code is free to be used again
 *
 * Trashing is idempotent and never escalates: a second DELETE on an already
 * trashed coupon is the same 200 and does not become permanent.
 */
function deleteCoupon(current, params) {
  if (BOOLEANS.get(params.get("force") ?? "") === true) {
    state.coupons.delete(current.id);
    state.createdCoupons = state.createdCoupons.filter((id) => id !== current.id);
    state.couponsGone.add(current.id);
  } else {
    state.coupons.set(current.id, { ...current, status: "trash" });
  }
  return ok({ id: current.id, deleted: true });
}

/* ------------------------------------------------------------------ route --- */

const numericId = (segment) => (/^\d+$/.test(segment) ? Number.parseInt(segment, 10) : null);

/**
 * The whole API surface, as a function of its arguments and of whatever has been
 * written to it in this process. No clock and no randomness anywhere — the writes
 * below mutate `state`, and `state` is rebuilt from the seeds at module load, so
 * a fresh process answers identically and a byte-stable screenshot survives.
 *
 * `pathname` is the full request path including the base, so this also proves
 * the base-path routing rather than assuming it. `body` is the parsed JSON of a
 * write, or null.
 */
export function respond(method, pathname, searchParams = new URLSearchParams(), body = null) {
  // WordPress answers `rest_no_route` for a path/verb pair it has no handler
  // for, and the panel only ever reaches this mock through the proxy.
  if (!pathname.startsWith(`${BASE_PATH}/`)) return notFound();

  const segments = pathname.slice(BASE_PATH.length + 1).split("/").filter(Boolean);
  const [collection, second] = segments;

  /*
   * **Three collections write and every other one is read-only.** This used to
   * be a flat `if (method !== "GET") return notFound()` at the top of the
   * function, which was right while nothing wrote and would now let a POST fall
   * through to a GET handler further down and be answered 200 — a write that
   * silently reads is worse than a 404, because a screen would look like it had
   * saved.
   */
  const WRITES = [
    "orders",
    "shipments",
    "payments",
    "products",
    "inventory",
    "coupons",
    // `/shipping/rules` is the only writable thing under this collection —
    // `providers` and `rates` are reads and stay reads, and the case below
    // refuses a verb on either rather than letting this list decide it.
    "shipping",
  ];
  if (method !== "GET" && !WRITES.includes(collection)) return notFound();

  if (segments.length === 2 && collection === "auth" && second === "me") {
    return ok(IDENTITY);
  }

  /*
   * Depth is decided **per collection** below, not once here.
   *
   * This used to be a flat `if (segments.length > 2) return notFound()`, which
   * makes a three-segment route unreachable no matter how it is written further
   * down — `/attributes/{id}/terms` could never have answered. Raising the guard
   * one notch at a time and no further would be the opposite mistake: at `> 3`,
   * `/orders/1000/notes` was served the order itself, which is a 200 for a route
   * nobody wrote and exactly the quiet wrong answer this file must not produce.
   *
   * So the ceiling here is the deepest route that exists — four, since
   * `/locations/wilayas/{id}/communes` and `/orders/{id}/cod/attempts` arrived —
   * and every collection states its own depth underneath. `collectionOf` refuses
   * a third segment for all the flat ones at once, so raising this number can
   * never widen them.
   */
  if (segments.length === 0 || segments.length > 4) return notFound();

  /** The list/detail pair every collection below shares. Read-only, all of them. */
  const collectionOf = (rows, { search, status, detail }) => {
    if (method !== "GET" || segments.length > 2) return notFound();
    if (second !== undefined) {
      const id = numericId(second);
      const row = id === null ? undefined : rows.find((candidate) => candidate.id === id);
      if (row === undefined) return notFound();
      return ok(detail ? detail(row) : row);
    }

    let working = rows;
    if (status) {
      const filtered = filterByStatus(working, searchParams);
      if (filtered.error) return filtered.error;
      working = filtered.rows;
    }
    if (search) working = searchRows(working, searchParams, search);

    // `orderby` and `order` are read by nothing on purpose. See the file header.
    const page = paginate(working, searchParams);
    return page.error ?? ok(page.rows, page.meta);
  };

  /**
   * A capability gate, and there are three of them in this file.
   *
   * `/payments` came first, on 2026-08-26, and the rule it set is the one
   * followed here: **a capability is enforced where it was measured and nowhere
   * else.** `/orders` and `/inventory` are enforced because the Support Agent
   * credential that measured the analytics money gate was measured 403 on both
   * of them in the same pass — and `/customers` beside them was a 200, which is
   * why there is no gate on that collection however plausible one would look.
   *
   * Both are inert for `full` and for `reduced`, which hold the two. Adding them
   * without `support` would have been a refusal nothing could reach; adding
   * `support` without them would have made the mock answer 200 where the shop
   * answers 403, which is the *more permissive* direction the honesty audit
   * exists to catch.
   */
  const gatedOn = (capability) =>
    IDENTITY.capabilities.includes(capability) ? null : forbidden();

  switch (collection) {
    case "orders": {
      const refused = gatedOn("ac_manage_orders");
      if (refused !== null) return refused;

      const id = second === undefined ? null : numericId(second);
      const order = id === null ? undefined : ORDERS.find((row) => row.id === id);

      /*
       * The detail's own sub-resources and the four writes on them. Every
       * verb/segment pair is matched by name: an unlisted one falls to the 404
       * below rather than to the row, which is what keeps `POST
       * /orders/{id}/payments` — the route that mints a real payment link for a
       * shopper, refused deliberately by lib/api/allowlist.ts — unreachable
       * here even though the GET beside it is served.
       */
      if (segments.length > 2 || (order !== undefined && method !== "GET")) {
        if (order === undefined) return notFound();
        const row = orderRow(order);

        if (segments.length === 2) {
          return method === "PATCH" ? patchOrder(order, body) : notFound();
        }
        if (segments.length === 3) {
          switch (`${method} ${segments[2]}`) {
            // Unpaginated, like /locations/wilayas: the panel fetches each of
            // these with no params at all and renders every row, so a default
            // `per_page` of 10 would silently truncate a timeline.
            case "GET notes":
              return list(notesFor(order.id));
            case "GET timeline":
              return list(timelineFor(row));
            case "GET cod":
              return ok(state.cod.get(order.id));
            case "PATCH cod":
              return patchCod(order, body);
            case "GET shipments":
              return list(shipmentsOf(order.id));
            case "POST shipments":
              return postShipment(row, body);
            case "GET payments":
              return list(paymentsOf(order.id));
            default:
              return notFound();
          }
        }
        if (method === "POST" && segments[2] === "cod" && segments[3] === "attempts") {
          return postCodAttempt(order, body);
        }
        return notFound();
      }

      // The list and the plain detail, both reading through any status a PATCH
      // has written.
      return collectionOf(ORDERS.map(orderRow), {
        status: true,
        search: (candidate) => [
          candidate.number,
          candidate.billing.first_name,
          candidate.billing.last_name,
          candidate.billing.email,
          candidate.billing.phone,
        ],
      });
    }

    /*
     * The standalone parcels collection: the list, the detail, and the three
     * writes on one parcel.
     *
     * **`GET /shipments/{id}` returns the list row exactly** — measured, an
     * identical key set with no extra block — which is what makes a peek drawer
     * free on this collection where it costs a request on customers.
     *
     * **There is still no `POST /shipments`.** A parcel is created against an
     * order, lib/api/allowlist.ts allows `POST /orders/{id}/shipments` and this
     * route for nothing but reads and the three writes below, and an endpoint
     * nobody calls must stay unreachable.
     */
    case "shipments": {
      if (second === undefined) {
        return method === "GET" ? shipmentsListing(searchParams) : notFound();
      }
      // The allowlist's pattern is `\d+`, so a non-numeric segment is a path
      // nobody wrote — `rest_no_route`, not this collection's own 404.
      const id = numericId(second);
      if (id === null || segments.length > 3) return notFound();

      if (segments.length === 3) {
        if (method !== "POST") return notFound();
        if (segments[2] === "cancel") return cancelShipment(id);
        if (segments[2] === "sync") return syncShipment(id);
        return notFound();
      }

      if (method === "PATCH") return patchShipment(id, body);
      if (method !== "GET") return notFound();
      const row = findById(state.shipments, id);
      return row === undefined ? shipmentNotFound() : ok(row);
    }

    /*
     * The transactions collection: the list, the detail, the method reference
     * list, and the one write.
     *
     * **`GET /payments` and `GET /payments/{id}` are served now, and pinning them
     * at 404 was wrong.** They were left out on the grounds that a transaction is
     * reached through its order, which was true of the *order detail* and was
     * never true of the API: both are allowlisted, both are what `/payments`
     * calls on load, and an unimplemented route here is not neutral — it answers
     * `rest_no_route`, a code `ErrorNormalizer` never emits, so a screen
     * branching on that 404 would be built against something the API cannot send.
     * The same correction `GET /shipping/rules/{id}` took on 2026-08-25, for the
     * same two reasons in the same order.
     *
     * **`GET /payments/{id}` returns the list row exactly** — measured 2026-08-26,
     * all eleven keys, same values — which is what would make a peek drawer free
     * on this collection, the way it is on parcels and orders.
     *
     * `POST /payments` stays absent, and for a stronger reason than a 404 of
     * convenience: it is the one write on this subject the API offers, it opens a
     * checkout at the provider and hands back a real payment link for a
     * *shopper*, and lib/api/allowlist.ts:164-178 refuses it deliberately. A
     * fixture that answered would be an invitation to build the screen.
     *
     * **The three reads are `ac_manage_payments` and the capability is enforced
     * here**, which no other collection in this file does yet. It is enforced
     * because it was *measured* here — `MOCK_IDENTITY=reduced` is a credential
     * without it, and until now that identity was served all 45 rows. What is
     * deliberately **not** gated is `POST /payments/{id}/verify`: nobody has
     * measured what a Manager gets from it, and inventing a 403 would be the mock
     * growing an error path the panel has never seen. Written down rather than
     * swept, because "more permissive than the API" is exactly what the honesty
     * audit hunts for.
     */
    case "payments": {
      const gate = () => gatedOn("ac_manage_payments");

      if (second === undefined) {
        if (method !== "GET") return notFound();
        return gate() ?? paymentsListing(searchParams);
      }
      if (second === "methods") {
        if (method !== "GET" || segments.length !== 2) return notFound();
        return gate() ?? enumeration(PAYMENT_METHODS);
      }
      // The allowlist's pattern is `\d+`, so a non-numeric segment is a path
      // nobody wrote — `rest_no_route`, not this collection's own 404.
      const id = numericId(second);
      if (id === null || segments.length > 3) return notFound();
      if (segments.length === 3) {
        return method === "POST" && segments[2] === "verify" ? verifyPayment(id) : notFound();
      }
      if (method !== "GET") return notFound();

      const denied = gate();
      if (denied !== null) return denied;
      const row = findById(state.payments, id);
      return row === undefined ? paymentNotFound() : ok(row);
    }

    /*
     * `GET /cod/statistics`, and it is the **only** route under this collection —
     * an order's own COD record and its attempts live under `/orders/{id}/cod`,
     * which is the screen they belong to.
     *
     * **It is `ac_view_analytics`, which both identities hold, so there is no
     * gate here and that is the point of it.** Measured 2026-08-26: a credential
     * that is 403 on all three payments routes is **200** on this one. It is the
     * one place in the panel where a figure renders for a reader who cannot open
     * a single record behind it, and it is why the payments screen is two
     * sections rather than one.
     */
    case "cod":
      return method === "GET" && segments.length === 2 && second === "statistics"
        ? ok(COD_STATISTICS)
        : notFound();

    /*
     * **All seven reports.** `/analytics/overview` is the dashboard's whole
     * request — the screen ADMIN_PANEL.md describes as six round trips is one,
     * because the overview nests `orders`, `customers`, `cod`, `shipping`,
     * `inventory` and `revenue` as blocks — and the other six are the
     * `/analytics` screen, one request per view.
     *
     * The six were 404s here until 2026-08-26, and the note that stood in their
     * place is worth keeping as a warning rather than deleting: an unimplemented
     * route in this file is not neutral. It answers `rest_no_route`, a code
     * `ErrorNormalizer` never emits, so a screen branching on it would be built
     * against something the API cannot send. `/analytics/shipping` in particular
     * was recorded in DECISIONS.md as "the one allowlisted route on this subject
     * still answering `rest_no_route`" and that is **false** — measured, it is a
     * 200 with a full payload for a Support Agent as well as for a Super Admin.
     * The gap was this file's. DECISIONS.md still carries the wrong sentence.
     *
     * **There is no gate on `ac_view_analytics` here and that is deliberate:**
     * all three identities hold it, so a refusal branching on it could never be
     * reached from this harness, and this file does not grow error paths nobody
     * can take. The gate that *is* here is money — `ac_manage_orders` — and it
     * takes two shapes, a whole-route 403 on `revenue` and key-by-key omission
     * on the other six. Both are measured; see `analyticsRevenue()`.
     */
    case "analytics": {
      if (method !== "GET" || segments.length !== 2) return notFound();
      if (second === "overview") return analyticsOverview(searchParams);
      const report = ANALYTICS_REPORTS[second];
      // `Object.hasOwn` rather than a truthy check: `constructor` and `toString`
      // are inherited properties, and `/analytics/toString` must be a 404 like
      // any other path nobody wrote.
      return Object.hasOwn(ANALYTICS_REPORTS, second) ? report(searchParams) : notFound();
    }

    /*
     * Three routes: the provider list, the tariff, and the resolver.
     *
     * **`GET /shipping/rules/{id}` is served, and leaving it a 404 was wrong.**
     * It was left out on the grounds that nothing calls it and nobody had
     * measured it; measured 2026-08-25, it is a real route returning the list
     * row exactly — all twelve keys, same order — like `GET /shipments/{id}`.
     *
     * The reasoning was wrong in both directions at once. An unimplemented route
     * here is not neutral: it answers `rest_no_route`, a code
     * `ErrorNormalizer` never emits, so a screen branching on this 404 would be
     * built against a code the API cannot send — the same family as the fourteen
     * in DECISIONS.md and the two just fixed in `postCodAttempt` and
     * `inventoryLookup`. And it is the *less capable* direction, which is the
     * one the coupons branch was burned by: a 404 where the shop answers a rule
     * grows an error path production never takes.
     *
     * **`GET /analytics/shipping` used to be described here as the one
     * allowlisted route on this subject still answering `rest_no_route`. That is
     * false and DECISIONS.md still carries it.** Measured 2026-08-26: it answers
     * **200 with a full payload**, for a Support Agent as well as for a Super
     * Admin. It was still a 404 *here* until this file grew the six reports; it
     * is served now, under `case "analytics"`. The correction to DECISIONS.md is
     * still owed — named so the next person diffing this surface does not
     * re-derive it, and so nobody builds an error path for a `rest_no_route` the
     * shop never sends.
     *
     * The rules list is paginated through the shared `paginate()`, which is what
     * makes it refuse the four paging edges every other collection refuses.
     * Whether the real route pages at all is **unmeasured** — it holds three
     * rows and the panel sends no parameters, so the two behaviours are
     * indistinguishable from the panel's side.
     */
    case "shipping": {
      if (segments.length === 2) {
        if (method === "GET" && second === "providers") return enumeration(SHIPPING_PROVIDERS);
        if (method === "GET" && second === "rates") return shippingRates(searchParams);
        if (second === "rules") {
          if (method === "POST") return postRule(body);
          if (method !== "GET") return notFound();
          const rows = [...state.rules.values()].sort((a, b) => b.id - a.id);
          const page = paginate(rows, searchParams);
          return page.error ?? ok(page.rows, page.meta);
        }
        return notFound();
      }

      if (segments.length !== 3 || second !== "rules") return notFound();
      const ruleId = numericId(segments[2]);
      if (ruleId === null) return notFound();
      if (method === "PATCH") return patchRule(ruleId, body);
      if (method === "DELETE") return deleteRule(ruleId);
      if (method !== "GET") return notFound();
      // The same object the list carries and the same 404 the second `DELETE`
      // answers — shared rather than copied, so the sentence cannot drift into
      // two versions of itself.
      const rule = state.rules.get(ruleId);
      return rule === undefined ? ruleNotFound() : ok(rule);
    }

    case "locations": {
      if (second !== "wilayas") return notFound();
      /*
       * Reference data, unpaginated: the panel fetches it with no params and
       * needs every row to turn a `state` of "16" into a name. A default
       * `per_page` of 10 here would leave 48 orders showing a bare code and
       * nothing would report an error.
       *
       * **`counted()`, and it is the only route in the file with that shape** —
       * measured 2026-08-26, live sends `{"total":69}` and no `page`,
       * `per_page` or `total_pages` beside it. See the three shapes above.
       *
       * **69 live against 58 here**, which is a fixture-completeness gap rather
       * than an envelope one and is deliberately not closed on this branch: 58 is
       * every wilaya this file has names for, and inventing eleven more would put
       * eleven unverifiable rows in the one table the panel treats as authority.
       * Recorded rather than fixed.
       */
      if (segments.length === 2) return counted(WILAYAS);

      // Four segments, and the reason the depth guard moved again. The commune
      // list *is* paginated, because the panel asks it for `per_page=100`.
      if (segments.length === 4 && segments[3] === "communes") {
        const rows = COMMUNES.get(numericId(segments[2]));
        if (rows === undefined) return notFound();
        const page = paginate(rows, searchParams);
        return page.error ?? ok(page.rows, page.meta);
      }
      return notFound();
    }

    case "products": {
      /*
       * Depth is stated here rather than guarded once at the top, the way
       * `/attributes/{id}/terms` and `/orders/{id}/notes` are. The flat
       * `segments.length > 2` that used to sit on this line made
       * `/products/{id}/variations` unreachable no matter how it was written,
       * and raising it to `> 3` without naming the sub-resource would have
       * served the *product* for `/products/{id}/anything` — a 200 for a route
       * nobody wrote, which is the quiet wrong answer this file must not give.
       */
      if (segments.length > 3) return notFound();

      if (second === undefined) {
        // **`POST /products` stays a 404.** lib/api/allowlist.ts refuses it
        // deliberately — nothing in the panel creates a product — and a fixture
        // that answered would be an invitation to build the screen.
        return method === "GET" ? productsListing(searchParams) : notFound();
      }

      // The whole catalogue, not the listed part: a trashed product answers
      // 200 with `status: "trash"` here and appears in no listing at all.
      const row = productById(numericId(second));
      if (row === undefined) return notFound();

      if (segments.length === 3) {
        // The only sub-resource a product has. Paginated, because the detail
        // asks it for `per_page=100`, and **200 with `[]` on a simple
        // product** — measured, so the request is waste rather than an error.
        if (method !== "GET" || segments[2] !== "variations") return notFound();
        const page = paginate(variationsOf(row), searchParams);
        return page.error ?? ok(page.rows, page.meta);
      }

      switch (method) {
        case "GET":
          return ok(row);
        case "PATCH":
          return patchProduct(row, body);
        case "DELETE":
          return deleteProduct(row, searchParams);
        default:
          return notFound();
      }
    }

    case "product-categories":
      /*
       * **The list only, and `/product-categories/{id}` is a 404 on purpose.**
       *
       * lib/api/allowlist.ts:63 is `rule("/product-categories", "GET")` and
       * carries no id rule, so the panel's own proxy answers `{allowed: false,
       * reason: "path"}` for a single category — the same position `POST
       * /payments` and `POST /products` are in, and held to the same rule here:
       * a fixture that answered would let a screen resolve one category by id,
       * render green against this harness, and 404 at the proxy in production.
       *
       * The vocabulary is fetched whole (`per_page=100`) and merged, which is
       * what the facet's counts are merged against, so nothing needs the detail.
       *
       * Paginated and flat, with `parent` carrying the tree and `count` the
       * unfiltered usage.
       */
      return segments.length === 1 ? collectionOf(CATEGORIES, {}) : notFound();

    case "attributes": {
      const attributeOf = () => ATTRIBUTES.find((a) => a.id === numericId(second));

      if (segments.length === 3) {
        /*
         * The only sub-resource in this API, and the reason the depth guard
         * above had to be relaxed properly rather than special-cased.
         *
         * **This is where a term with `count: 0` exists.** A facet group omits
         * its zero-count values entirely, so the vocabulary is not derivable
         * from `/products` at any price — without this route the filter sheet
         * can only ever offer the values that already match, and picking one
         * deletes its siblings.
         */
        if (segments[2] !== "terms") return notFound();
        const attribute = attributeOf();
        if (attribute === undefined) return notFound();
        const page = paginate(TERMS[attribute.taxonomy], searchParams);
        return page.error ?? ok(page.rows, page.meta);
      }

      /*
       * **`/attributes/{id}` is a 404, and only `/attributes/{id}/terms` is
       * served.** lib/api/allowlist.ts:64-65 carries `/attributes` and
       * `/attributes/\d+/terms` and nothing between them, so a single attribute
       * is refused by the panel's own proxy — `{allowed: false, reason: "path"}`.
       *
       * The route may well exist at the API; the allowlist is a statement about
       * what this panel may reach, not about what the shop has. Either way a
       * screen built on it would render here and fail at the proxy, which is the
       * same reason `POST /payments` is unreachable in this file even though it
       * is the one write the payments API really offers.
       *
       * The list above carries `slug` and `taxonomy` on every row, so nothing
       * needs to resolve one attribute by id to tell the two apart.
       */
      if (second !== undefined) return notFound();

      /*
       * Unpaginated, like `/locations/wilayas`: the panel fetches this with no
       * params at all, and a default `per_page` of 10 would silently drop the
       * shop's later attributes — and every facet group keyed on them with
       * nothing reporting an error.
       *
       * **Its envelope is the unmeasured one, unlike wilayas'.** This used to
       * hand-roll the same four-key `meta` inline; it goes through `list()` now
       * so that the file has exactly one place emitting an unverified envelope
       * and this route is named in that helper's list. Whether the shop sends
       * `{total}` here, or nothing, is a request nobody has made.
       */
      return list(ATTRIBUTES);
    }

    case "customers": {
      // Depth is stated here, the way `/products` and `/orders` state theirs.
      if (segments.length > 3) return notFound();

      // The one sub-resource a customer has. Named, so `/customers/{id}/anything`
      // still falls to the 404 rather than being served the customer.
      if (segments.length === 3) {
        if (method !== "GET" || segments[2] !== "orders") return notFound();
        const customer = CUSTOMERS.find((row) => row.id === numericId(second));
        return customer === undefined ? notFound() : customerOrders(customer, searchParams);
      }

      // The list only. `orderby` is a collection parameter, so a single read is
      // not the place to refuse one — over-applying the 400 would be the same
      // class of error as never answering it.
      if (second === undefined) {
        const sort = checkSort(searchParams, CUSTOMER_ORDERBY);
        if (sort !== null) return sort;
      }

      return collectionOf(CUSTOMERS, {
        /*
         * ── What `?search=` on /customers does not match ─────────────────────
         *
         * **`user_login`, `user_email` and `display_name`. Never `first_name` or
         * `last_name`. Do not "improve" this back.**
         *
         * This list carried the two name fields for three branches, and that made
         * it the most capable-beyond-the-API thing in the file. Measured
         * 2026-08-19 with a positive control, recorded verbatim at
         * lib/customers.ts:45-60: customer 26 was given the names `Zqxwvu
         * Plmokn`, `?search=Zqxwvu` returned **0 rows**, and `?search=cus_fresh`
         * — its login — returned 1. Customer 36 above is that control,
         * reproduced, so the claim is falsifiable here rather than merely
         * asserted. `?search=Chérif` appearing to work is the accent-insensitive
         * collation matching the *email* `nadia.cherif@…`, which is customer 26.
         *
         * `display_name` is absent from the two fields below because it is not a
         * field on this payload, and because in this shop every display name *is*
         * the username — measured, `orderby=display_name` and `orderby=user_email`
         * returned byte-identical sequences across all 16 rows.
         *
         * **The whole screen is built on this.** `looksLikeAName()` drives an
         * empty state that explains *why* nothing matched instead of saying "no
         * results", and while the two name fields were in this list that empty
         * state could not be reached at all: every name in the shop matched. A
         * screen could have shipped having never once rendered it.
         */
        search: (customer) => [customer.username, customer.email],
        // The detail is the row plus the report the list omits — and the list
        // must not carry it, which is the one place these two shapes differ.
        detail: (customer) => ({ ...customer, statistics: statisticsFor(customer) }),
      });
    }

    /*
     * The queue's list, and **nothing else on this collection yet**.
     * `GET /notifications/{id}` and `POST /notifications/{id}/retry` are both real
     * routes the notifications screen calls, and both are still 404s here — named
     * in the unit suite rather than left implied, because "covered" must not come
     * to mean "finished". The list is what the customer detail's section needs and
     * it is what this branch serves.
     */
    case "notifications":
      return segments.length === 1 ? notificationsListing(searchParams) : notFound();

    case "inventory": {
      // Measured 403 for the Support Agent credential, alongside `/orders`.
      const refused = gatedOn("ac_manage_inventory");
      if (refused !== null) return refused;

      // Depth is stated here, the way `/products` and `/orders` state theirs.
      if (segments.length > 3) return notFound();

      if (second === undefined) {
        /*
         * **`POST /inventory` is not a route and neither is `POST
         * /inventory/bulk`.** The batch stocktake exists at the API, takes up to
         * 100 items and inherits every single-item rule — and no screen calls
         * it, so lib/api/allowlist.ts:75-77 refuses it and
         * tests/boundary.test.ts:219 asserts the refusal. Mocking it would be an
         * invitation to build the screen, which is the same precedent `POST
         * /products` and `POST /payments` are held to. `bulk` reaches the id
         * branch below, fails `numericId` and falls to the 404.
         */
        return method === "GET" ? inventoryListing(searchParams) : notFound();
      }

      /*
       * `/inventory/low-stock` is **not** in the harness brief's endpoint list
       * and the inventory screen calls it anyway — twice per render, from the
       * client, for the count on the "low stock" view. Without it the screen
       * renders and logs a 404 in the console, which is exactly the quiet
       * half-failure this harness exists to catch, so it caught it.
       *
       * It returns the same item as `/inventory`, `/inventory/{id}` and
       * `/inventory/lookup` — lib/api/schemas/inventory.ts says so explicitly,
       * verified across every row — so one row shape serves all four.
       *
       * It takes **pagination and `status` only** — verified against the live
       * router, which registers `lowStockArgs()` as exactly that — so it has no
       * search, no `stock_status` and, critically, **no `include_variations`:
       * it always includes them** where the list defaults them off. That
       * asymmetry is the whole reason the two views disagree about which rows
       * exist, and it is reproduced by this branch reading `inventoryRows()`
       * whole rather than going through the list's filters.
       */
      if (second === "low-stock") {
        if (method !== "GET" || segments.length !== 2) return notFound();
        const low = inventoryRows().filter((row) => row.low_stock);
        const page = paginate(low, searchParams);
        return page.error ?? ok(page.rows, page.meta);
      }

      if (second === "lookup") {
        return method === "GET" && segments.length === 2
          ? inventoryLookup(searchParams)
          : notFound();
      }

      if (second === "movements") {
        if (method !== "GET") return notFound();
        if (segments.length === 2) return movementsListing(searchParams);
        return segments[2] === "summary" ? movementsSummary(searchParams) : notFound();
      }

      const id = numericId(second);
      const row = id === null ? undefined : inventoryRows().find((candidate) => candidate.id === id);
      // A ledger row's product need not exist here — 132 of the 155 ids it names
      // do not — and this is the 404 that makes `[id]/not-found.tsx` a screen.
      if (row === undefined) return notFound();

      if (segments.length === 3) {
        return method === "POST" && segments[2] === "adjust" ? adjustStock(row, body) : notFound();
      }

      switch (method) {
        case "GET":
          return ok(row);
        case "PATCH":
          return patchInventory(row, body);
        default:
          return notFound();
      }
    }

    case "coupons": {
      // Depth is stated here, the way `/products` and `/orders` state theirs. A
      // coupon has no sub-resource at all: the two picker routes are siblings.
      if (segments.length > 2) return notFound();

      if (second === undefined) {
        /*
         * **`POST /coupons` is served where `POST /products` is a 404**, and the
         * difference is deliberate on both sides. lib/api/allowlist.ts:114-129
         * carries the reason: this screen really does create, because a coupon
         * has no counterpart to a product's variations, media or option sets to
         * leave half-built behind an empty object.
         */
        if (method === "POST") return createCoupon(body);
        return method === "GET" ? couponsListing(searchParams) : notFound();
      }

      /*
       * Both pickers are matched **before** the id branch and by name. Ordering
       * is not what makes that safe — `numericId` refuses a word, so they could
       * never be read as ids — but a named match is what keeps
       * `/coupons/anything-else` a 404 rather than something that falls through.
       * GET only: the allowlist gives them no other verb.
       */
      if (second === "eligible-products") {
        return method === "GET" ? eligibleProductsListing(searchParams) : notFound();
      }
      if (second === "eligible-categories") {
        return method === "GET" ? eligibleCategoriesListing(searchParams) : notFound();
      }

      // The whole collection, not the listed part: a trashed coupon answers 200
      // with `status: "trash"` here and appears in no listing at all.
      const row = couponById(numericId(second));
      if (row === undefined) return notFound();

      switch (method) {
        case "GET":
          return ok(withRestrictions(row));
        case "PATCH":
          return patchCoupon(row, body);
        case "DELETE":
          return deleteCoupon(row, searchParams);
        default:
          return notFound();
      }
    }

    default:
      return notFound();
  }
}

/* ----------------------------------------------------------------- server --- */

/**
 * Every request the server handled, in order. `scripts/capture.mjs` reads it
 * through `/__mock/stats` to prove the panel talked to *this* — a run where the
 * count is zero is a run whose screenshots are all of an error state, and that
 * has to be a failure rather than a green report.
 */
export const requestLog = [];

export function stats() {
  const paths = {};
  for (const entry of requestLog) paths[entry] = (paths[entry] ?? 0) + 1;
  return { count: requestLog.length, paths };
}

export function createServer() {
  return createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    // Outside the shop API and deliberately not routed through `respond()`,
    // which stays pure: this is the harness talking to the harness.
    if (url.pathname === "/__mock/stats") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(stats()));
      return;
    }

    requestLog.push(`${request.method} ${url.pathname}`);

    /*
     * The body is collected before routing because `respond()` takes it as an
     * argument — the routing stays pure and synchronous, and this shell stays
     * the only asynchronous thing in the file.
     *
     * A body that is not JSON arrives at `respond()` as `null` rather than as an
     * error of its own. Every write here validates what it needs and answers its
     * own 400, and the panel sends JSON or nothing at all: `POST
     * /payments/{id}/verify` is called with no body whatsoever.
     */
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      let parsed = null;
      if (chunks.length > 0) {
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          parsed = null;
        }
      }

      const { status, body } = respond(
        request.method ?? "GET",
        url.pathname,
        url.searchParams,
        parsed,
      );
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(body));
    });
  });
}

export function startServer(port = Number(process.env.MOCK_PORT ?? 8099)) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // 127.0.0.1 rather than 0.0.0.0: a fixture set with a Super Admin's
    // capabilities on it has no business being reachable from the network.
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// Run directly (`npm run mock`) rather than imported by the capture harness.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MOCK_PORT ?? 8099);
  await startServer(port);
  console.log(`mock-api listening on http://127.0.0.1:${port}${BASE_PATH}`);
}
