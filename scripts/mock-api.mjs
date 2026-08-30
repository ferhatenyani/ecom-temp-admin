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
 * **`MOCK_SEND_PROGRESS=tick` is the one switch that breaks that promise, and it
 * is off by default for exactly that reason.** It makes a draining campaign's
 * counts advance on every read, so two reads differ and a capture taken under it
 * would not be reproducible. Its numeric form — `MOCK_SEND_PROGRESS=3` — is a
 * seed offset instead and stays as deterministic as the default. The block beside
 * `RECIPIENT_SEED` has the argument; the short version is that a capture uses the
 * number and never the word.
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
import { crc32 } from "node:zlib";

export const BASE_PATH = "/wp-json/algerian-commerce/v1";

/**
 * Read once, because `/media` puts it in a **response body**.
 *
 * `url` on an attachment is an absolute URL on the shop's own host, and the mock
 * has to answer one that resolves — so the port this process listens on is data
 * now, not only a listen argument. `startServer()` still takes an override; a
 * caller that passes a different one gets a library whose `url`s name this one,
 * which is why the two read the same variable rather than the same expression.
 */
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8099);
const MOCK_ORIGIN = `http://127.0.0.1:${MOCK_PORT}`;

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
 * is a claim rather than a default. These seven are what is left, all of them
 * routes the panel fetches with no params at all:
 *
 *   /orders/{id}/notes · /orders/{id}/timeline · /orders/{id}/shipments ·
 *   /orders/{id}/payments · /shipping/rates · /attributes ·
 *   /cms/faq-categories
 *
 * `/cms/faq-categories` joined on the content branch and is the newest of them:
 * the FAQ screen fetches it with no parameters and reads `data` alone, so
 * `enumeration()`, `counted()` and this are indistinguishable from the panel's
 * side and nobody has diffed which the shop sends.
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
 *   MOCK_IDENTITY=no_content node scripts/capture.mjs /content   twelve
 *   MOCK_IDENTITY=no_customers … /marketing/campaigns/318        twelve others
 *   MOCK_IDENTITY=no_marketing … /marketing                      eleven
 *   MOCK_IDENTITY=no_transfer  … /transfer                       nine
 *   MOCK_IDENTITY=no_audit     … /audit                          twelve
 *   MOCK_IDENTITY=no_capabilities … /login                       **none**
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
 * `no_content` is **one** capability off, and it exists because all three of the
 * identities above hold `ac_manage_content` — so the whole Content section and
 * the media library had no capturable forbidden state at all. Its own block says
 * what was measured.
 *
 * `no_customers` and `no_marketing` are the Marketing pair, and they are the
 * same two arguments one section over: the first is the fixture for the panel's
 * only **compound** capability rule, the second is the section's forbidden
 * state. Their own blocks say what was measured and what was not.
 *
 * `no_audit` is the tenth and the seventh time the same hole has been found —
 * all nine before it hold `ac_view_audit_logs`, so the trail's forbidden state
 * was unphotographable. Its own block says what was read and from where.
 *
 * `no_capabilities` is the eleventh and it is the first that is not a *delta*:
 * the list is empty, so it is the fixture for a person who authenticates and can
 * reach nothing. Its own block says why that state is item 20's rather than
 * another section's, and that the shape is constructed.
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
  /*
   * ── The fourth identity, and why none of the three above could be it ───────
   *
   * **Every `/cms/` route and `/media` is `ac_manage_content`, and all three
   * identities above hold it** — `reduced` drops shipping and payments,
   * `support` drops orders and inventory, and none of them touches content. So
   * until this existed the Content hub, all six of its screens and the media
   * library could not be photographed in the forbidden state DESIGN.md §3.7
   * requires of every screen, and neither could the `MediaPicker` inside the
   * banner form.
   *
   * `reduced` could not be widened into it. Its block above says at length that
   * it is deliberately **not** "a Manager" and that its delta from `full` is
   * exactly the two 403s that were seen; adding a third capability to it would
   * be a claim about the shop's roles nothing here has measured, and it would
   * change the order-detail capture that identity exists for.
   *
   * Measured, and recorded in lib/api/allowlist.ts:222-226 and in
   * ADMIN_PANEL.md's Media section: a **Manager is 403 on every route in the
   * `/cms/` block and on `GET /media`**, and **200 on `/notifications`** — which
   * is `ac_manage_customers` rather than `ac_manage_content`, so those two
   * fixtures invert.
   *
   * **This is a credential with a measured shape, not a claim about what the
   * shop's Manager role contains.** The two-tier collapse takes more than one
   * capability off a Manager and nothing here has measured which, so the delta
   * from `full` is exactly `ac_manage_content` and nothing else, and the name
   * says what the credential *does* rather than who it is. That is the rule
   * `reduced` set, `support` followed, and this one inherits.
   */
  no_content: {
    id: 517,
    username: "harness-no-content",
    display_name: "Harness No-Content",
    email: "harness-no-content@example.test",
    roles: ["ac_staff"],
    capabilities: CAPABILITIES.filter((capability) => capability !== "ac_manage_content"),
    auth_method: "application_password",
  },
  /*
   * ── The fifth identity, and it is the panel's ONLY compound capability ─────
   *
   * `canSendCampaigns()` — lib/capabilities.ts:61-62 — is
   * `ac_manage_marketing` **and** `ac_manage_customers`, and it is the second of
   * exactly two compound rules in the panel. The first, `canSeeMoney()`, got its
   * fixture when `support` was added; this one had **none**, because all four
   * identities above hold both halves. So the state the rule exists to describe
   * — a person who can draft, preview and test a campaign and cannot send it —
   * could not be reached here at all, and three routes' refusals were paths
   * nothing could take.
   *
   * Measured 2026-08-28 with the `ac_marketing_manager` credential
   * `scripts/mint-credential.sh` already mints, one request at a time:
   *
   *     GET /campaigns                 200
   *     GET /campaigns/322             200
   *     GET /campaigns/318/preview     200 — and `audience_count` **null**
   *     GET /campaigns/322/recipients  403
   *     GET /segments                  200
   *     GET /segments/43               200
   *     GET /segments/43/preview       403
   *     GET /email-templates           200
   *     GET /marketing/config          200
   *
   * `POST /campaigns/{id}/send` is the third route the compound rule gates and
   * **it was not measured**, because provoking it mails a shop's customers and
   * nothing un-mails them. lib/api/allowlist.ts:322-333 records it 403 from an
   * earlier pass and the gate below enforces it on the same capability as the
   * two that were seen today — named here rather than left to read as measured.
   *
   * The null `audience_count` is the half that makes this more than a 403
   * fixture: counting an audience means counting customers, so the preview comes
   * back whole with one number missing, and the composer has to render that
   * rather than print a zero that would read as "nobody".
   *
   * **A credential with a measured shape, not a claim about the shop's roles.**
   * The two-tier collapse retired `ac_marketing_manager`, so the delta from
   * `full` is exactly the one capability the measured 403s turn on and nothing
   * else — the rule `reduced` set, `support` followed and `no_content`
   * inherited.
   */
  no_customers: {
    id: 518,
    username: "harness-no-customers",
    display_name: "Harness Marketing",
    email: "harness-no-customers@example.test",
    roles: ["ac_staff"],
    capabilities: CAPABILITIES.filter((capability) => capability !== "ac_manage_customers"),
    auth_method: "application_password",
  },
  /*
   * ── The sixth, and the Marketing section's forbidden state ────────────────
   *
   * Every route under `/campaigns`, `/segments`, `/email-templates` and
   * `/marketing` is `ac_manage_marketing`, and all five identities above hold
   * it. So the whole section — the hub, the campaign list, the composer, the
   * sent view, segments, templates and config — had **no capturable forbidden
   * state**, which DESIGN.md §3.7 requires of every screen and which every prior
   * branch photographed. This is `no_content` again, one section over.
   *
   * `no_customers` could not be widened into it: it exists to be a person who
   * *can* reach these screens, and taking marketing off it would destroy the
   * only fixture the compound rule has.
   *
   * **It drops `ac_manage_customers` as well**, and the reason is that the
   * refusal must not depend on which of the two capabilities is missing. With
   * marketing alone removed, a screen that gated on `canSendCampaigns()` rather
   * than on `has(me, "ac_manage_marketing")` would still refuse — for the wrong
   * reason — and the capture would look identical either way. Holding neither
   * makes the section's refusal unambiguous, which is what a forbidden-state
   * fixture is for. Nothing here claims the shop has a role shaped like this.
   */
  /*
   * ── The seventh, and the one the other six made impossible ────────────────
   *
   * **All six identities above hold `ac_manage_users`**, because every one of
   * them is `CAPABILITIES` minus one or two entries and none of those entries
   * was this. So the staff section — the list, the detail, the create form and
   * `/roles` behind all three — had no capturable forbidden state, which
   * DESIGN.md §3.7 requires of every screen. This is `no_content` again, one
   * section over, and it is the fourth time the same hole has been found.
   *
   * Measured 2026-08-29, three credentials at once, one request each:
   *
   *     ac_panel_manager (Manager)                     403 on all four routes
   *     ac_panel_support_agent (Support Agent)         403 on all four routes
   *     ac_panel_marketing_manager (Marketing Manager) 403 on all four routes
   *     ac_panel_super_admin, ac_panel_admin           200 on all four
   *
   * with `{"code":"forbidden","message":"You are not allowed to perform this
   * action."}` and **no `details` key** — the shape `forbidden()` already emits.
   * The four routes were `/users`, `/users/{id}`, `/roles` and
   * `/users/{id}/application-passwords`; the write verbs were not fired and are
   * gated by the same `permission_callback` in the same `register_rest_route`
   * call, which is read from the source rather than measured.
   *
   * **A credential with a measured shape, not a claim about the shop's roles.**
   * The delta from `full` is exactly the one capability the measured 403s turn
   * on — the rule `reduced` set and every identity since has followed. It is
   * also the only identity that can reach `guardAssignable()`'s 403 without
   * being able to reach the route it guards, which is why that refusal's own
   * fixture is `no_content` rather than this one.
   */
  no_users: {
    id: 520,
    username: "harness-no-users",
    display_name: "Harness No-Users",
    email: "harness-no-users@example.test",
    roles: ["ac_staff"],
    capabilities: CAPABILITIES.filter((capability) => capability !== "ac_manage_users"),
    auth_method: "application_password",
  },
  no_marketing: {
    id: 519,
    username: "harness-no-marketing",
    display_name: "Harness No-Marketing",
    email: "harness-no-marketing@example.test",
    roles: ["ac_staff"],
    capabilities: CAPABILITIES.filter(
      (capability) =>
        capability !== "ac_manage_marketing" && capability !== "ac_manage_customers",
    ),
    auth_method: "application_password",
  },
  /*
   * ── The eighth, and it is the fifth time this hole has been found ─────────
   *
   * **All seven identities above hold `ac_manage_settings`.** Every one of them
   * is `CAPABILITIES` minus one or two entries and none of those entries was
   * this — `reduced` drops shipping and payments, `support` orders and
   * inventory, `no_content` content, `no_customers` customers, `no_users` users,
   * `no_marketing` marketing and customers. So `/settings` had no capturable
   * forbidden state, which DESIGN.md §3.7 requires of every screen. That is
   * `no_content`, `no_customers`, `no_marketing` and `no_users` again, one
   * section over, for the fifth time.
   *
   * **`reduced` is not the credential for this, and it looks as though it should
   * be.** It holds `ac_manage_settings` like the rest, so a capture taken under
   * it photographs the *served* screen and reports a green forbidden state that
   * is nothing of the kind — which is exactly the failure DECISIONS.md §16.1
   * describes and the reason an unrecognised `MOCK_IDENTITY` throws here rather
   * than falling back.
   *
   * Measured, and recorded at lib/api/allowlist.ts:366-376 and in
   * ADMIN_PANEL.md's Settings section: **a Manager holding the other ten
   * management capabilities is 403 on both verbs**, with
   * `{"code":"forbidden","message":"You are not allowed to perform this
   * action."}` and no `details` key — the shape `forbidden()` already emits.
   * `ac_manage_settings` is Super Admin's alone and is the boundary that stops
   * an Admin escalating, so this is the section the largest number of staff
   * accounts can never open.
   *
   * **A credential with a measured shape, not a claim about the shop's roles.**
   * The delta from `full` is exactly the one capability the measured 403s turn
   * on and nothing else — the rule `reduced` set and every identity since has
   * followed.
   */
  no_settings: {
    id: 521,
    username: "harness-no-settings",
    display_name: "Harness No-Settings",
    email: "harness-no-settings@example.test",
    roles: ["ac_staff"],
    capabilities: CAPABILITIES.filter((capability) => capability !== "ac_manage_settings"),
    auth_method: "application_password",
  },
  /*
   * ── The ninth, and the first whose delta is four capabilities ─────────────
   *
   * **No identity above drops `ac_manage_products`, `ac_manage_orders` or
   * `ac_manage_inventory`**, so `/transfer` — where *capability follows the
   * resource* — had no capturable refusal at all. Every one of the eight is
   * `CAPABILITIES` minus one or two entries and none of those entries was
   * products; `support` is the closest and drops only orders and inventory. So
   * the screen's "you hold none of these four" state could not be reached, which
   * is `no_content`, `no_customers`, `no_marketing`, `no_users` and
   * `no_settings` again, one section over, for the sixth time.
   *
   * Measured, and this is the whole of what is claimed — lib/transfer.ts:22-41's
   * four-credential grid, taken 2026-08-21 and reproduced in
   * ADMIN_PANEL.md:3360-3370 and in `tests/fixtures-admin.json`
   * (`exportForbidden`, `importForbidden`, `exportPartial`):
   *
   *                          super  manager  marketing  support
   *   GET /export/products     200     200      403       403
   *   GET /export/orders       200     200      403       403
   *   GET /export/inventory    200     200      403       403
   *   GET /export/customers    200     200      403       200
   *   POST /import/products    400     400      403       403
   *   POST /import/inventory   400     400      403       403
   *
   * This is the **Marketing Manager** column: 403 on all six, the flat refusal,
   * with `{"code":"forbidden","message":"You are not allowed to perform this
   * action."}` and no `details` key — the shape `forbidden()` already emits.
   *
   * **A credential with a measured shape, not a claim about the shop's roles.**
   * The delta from `full` is exactly the four capabilities the measured 403s
   * turn on — `SUBJECT_CAPABILITY` in lib/transfer.ts:57-62 — and nothing else,
   * which is the rule `reduced` set and every identity since has followed. A
   * real Marketing Manager also lacks things this credential keeps; nothing here
   * claims otherwise, and the name says what it *does* rather than who it is.
   *
   * **The Support Agent column has no fixture here and cannot be given one
   * without changing an existing capture.** It is the partial case — one export
   * 200 and three 403 — and it is the only credential that can prove the gate is
   * per subject rather than per screen. `support` above is *not* it: it holds
   * `ac_manage_products` and `ac_manage_customers`, so it is 200 on two exports
   * where the measured Support Agent is 200 on one. Widening it means dropping
   * `ac_manage_products`, which is supported by the grid above but re-captures
   * `/dashboard` and `/analytics` (its nav loses Produits), so it is a decision
   * with a blast radius rather than a line to slip in here. Recorded rather than
   * taken.
   */
  no_transfer: {
    id: 522,
    username: "harness-no-transfer",
    display_name: "Harness No-Transfer",
    email: "harness-no-transfer@example.test",
    roles: ["ac_staff"],
    capabilities: CAPABILITIES.filter(
      (capability) =>
        capability !== "ac_manage_products" &&
        capability !== "ac_manage_orders" &&
        capability !== "ac_manage_inventory" &&
        capability !== "ac_manage_customers",
    ),
    auth_method: "application_password",
  },
  /*
   * ── The tenth, and it is the seventh time this hole has been found ────────
   *
   * **All nine identities above hold `ac_view_audit_logs`.** Every one of them
   * is `CAPABILITIES` minus one to four entries and not one of those entries
   * was this — `reduced` drops shipping and payments, `support` orders and
   * inventory, `no_content` content, `no_customers` customers, `no_users`
   * users, `no_marketing` marketing and customers, `no_settings` settings, and
   * `no_transfer` the four subject capabilities. So `/audit` had **no
   * capturable forbidden state**, which DESIGN.md §3.7 requires of every
   * screen, and `app/[locale]/(panel)/audit/page.tsx:35` renders
   * `ForbiddenState` on a branch nothing in this harness could take.
   *
   * That is the §18 `no_settings` failure shape exactly: a capture taken under
   * an identity that still holds the capability photographs the *served*
   * screen and files it as the forbidden one. `no_transfer` looks like the
   * closest fit and is not it — it keeps `ac_view_audit_logs` like the rest.
   *
   * Read from source rather than measured, and said so rather than left to
   * read as a measurement: `src/API/AuditLogController.php:38` registers the
   * one route with
   * `Permissions::callback(Capabilities::VIEW_AUDIT_LOGS)`, and its own
   * docblock calls this "the one that proves the authorization layer works end
   * to end: without ac_view_audit_logs it returns 403, signed out it returns
   * 401". `lib/api/allowlist.ts:406-410` records the same capability. The
   * refusal body is the flat `{"code":"forbidden","message":"You are not
   * allowed to perform this action."}` with no `details` key — the shape
   * `forbidden()` already emits for the nine gates beside it.
   *
   * **A credential with a measured shape, not a claim about the shop's roles.**
   * The delta from `full` is exactly the one capability the gate turns on and
   * nothing else — the rule `reduced` set and every identity since has
   * followed. `ac_view_audit_logs` is Super Admin's alone after the two-tier
   * collapse (ADMIN_PANEL.md:3349), so this is a credential most of the staff
   * hold.
   */
  no_audit: {
    id: 523,
    username: "harness-no-audit",
    display_name: "Harness No-Audit",
    email: "harness-no-audit@example.test",
    roles: ["ac_staff"],
    capabilities: CAPABILITIES.filter((capability) => capability !== "ac_view_audit_logs"),
    auth_method: "application_password",
  },
  /*
   * ── The eleventh, and the only one whose delta is the whole list ───────────
   *
   * **Every identity above is `CAPABILITIES` minus one to four entries**, so the
   * smallest credential this file could serve still held nine. The state that
   * had no fixture anywhere is the one at the bottom: an account that
   * **authenticates and holds nothing** — `/auth/me` answers 200 and the
   * capabilities array is empty.
   *
   * It is item 20's own state rather than another section's forbidden one. The
   * login form signs a real credential in and then has to send the person
   * somewhere, and `login/page.tsx:19` sends a cookied reader to `/orders`; a
   * holder of no capability is refused there and on every other gated
   * collection, so the screen has to answer *"signed in, nowhere to go"* rather
   * than redirect. Nothing could photograph that before this existed, and no
   * identity above can be widened into it: each is a *named* delta and its block
   * says so, whereas this one is not a delta at all.
   *
   * **It does not reach zero routes, and saying so is the point.** This block
   * said *"every gated collection below refuses"* and meant it as *"can reach
   * nothing"*, which is a claim about the shop that this file cannot keep: the
   * `gatedOn` docblock lists three capabilities the mock enforces nowhere, so a
   * credential holding none of the thirteen still gets **200** from
   *
   *     /products · /products/{id} · /product-categories · /attributes ·
   *     /coupons · /coupons/eligible-* · /shipping/* · /shipments/* ·
   *     /locations/* · every /analytics/* but `revenue` · /cod/statistics
   *
   * Under the panel's own model — `nav-tree.ts` and each screen's
   * `ForbiddenState` — this reader is refused all of them. **So this identity is
   * the credential under which the mock is most visibly more permissive than the
   * wire**, and a capture of `/products` taken under it photographs a screen this
   * reader could never open. It is the right fixture for `/login` and the wrong
   * one for anything else until those three gates land, which is a decision with
   * the blast radius `no_transfer`'s block describes rather than a line to slip
   * in here.
   *
   * **Constructed, not measured, and the construction is the honest part.**
   * Nothing here has met an account with an empty `ac_*` list. What is recorded
   * — ADMIN_PANEL.md:768 — is that `GET /auth/me` returns the caller's
   * capabilities *"filtered to this plugin's vocabulary"*, and a WordPress user
   * holding a valid Application Password and none of this plugin's roles filters
   * to exactly `[]`. That is the shape's derivation; it is not a claim that the
   * shop has such an account today, and the name says what the credential *does*
   * rather than who it is, which is the rule `reduced` set.
   *
   * **The empty array is a real answer and must not be confused with a missing
   * one.** `lib/api/schemas/order.ts:158` parses `capabilities` as an array of
   * strings, so `[]` parses and `undefined` does not — the same
   * distinction `ApiError.conflict` makes about `allowed: []` on a terminal
   * order, one collection over.
   */
  no_capabilities: {
    id: 524,
    username: "harness-no-capabilities",
    display_name: "Harness No-Capabilities",
    email: "harness-no-capabilities@example.test",
    roles: ["ac_staff"],
    capabilities: [],
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

/* ------------------------------------------------------------ credential --- */

/**
 * ── `/auth/me` reads the credential, and this is the whole of what it reads ──
 *
 * **Until 2026-08-29 this file checked no credential at all.** `/auth/me`
 * answered `ok(IDENTITY)` unconditionally, `content-type` was the only request
 * header the file read, and the consequence was that the mock could produce
 * exactly one outcome on the panel's *only* unauthenticated screen: success.
 * `app/api/session/route.ts` distinguishes four refusals and the harness could
 * reach none of them, so `/login` had no failure state to photograph and the
 * three branches in `LoginForm.tsx:55-74` were paths nothing could take. That is
 * the *more permissive than the wire* direction DECISIONS.md §0 exists to catch,
 * on the one screen where a refusal is the ordinary case rather than the edge.
 *
 * ## The shape chosen, and the two consumers that chose it
 *
 * **A username the mock recognises as a refusal fixture is refused; everything
 * else answers exactly as it did before, including a request carrying no
 * `Authorization` at all.** That is deliberately *not* "verify the credential",
 * and neither existing consumer would survive one:
 *
 *   - `tests/mock-api.test.ts` calls `respond()` directly with no headers — 38
 *     call sites, and `get()`/`write()` build every other one. A mock that
 *     answered 401 to a request with no credential would fail the whole suite
 *     on its first line and would be testing the harness's plumbing rather than
 *     the shop's shapes.
 *   - `scripts/capture.mjs:1193` mints its cookie from `HARNESS_CREDENTIAL`
 *     **under every `MOCK_IDENTITY`**, while the acting identity's own username
 *     is `harness-support`, `harness-no-audit` and so on. A check that compared
 *     the presented username against `IDENTITY.username` would therefore refuse
 *     every capture run except `full` — ten of the eleven identities, every one
 *     of them a forbidden-state capture some earlier branch depends on.
 *
 * So the credential this file accepts is the pair below rather than the acting
 * identity's, and it is **exported** for the second reason above: it was a bare
 * literal in two files that had never had to agree, and the moment `/auth/me`
 * started reading it, a drift between them became a silently red capture run.
 *
 * ## What is measured and what is not
 *
 * The **statuses and the codes are measured** and are the only part of these
 * three refusals any code branches on:
 *
 *     no credential          401  `unauthenticated`      ADMIN_PANEL.md:748
 *     wrong Application Pw   401  `incorrect_password`   ADMIN_PANEL.md:749
 *     suspended account      401  `account_suspended`    ADMIN_PANEL.md:750
 *     failed-login bucket    429  `too_many_requests`    ADMIN_PANEL.md:3155,
 *                                                        reset-rate-limit.sh:11
 *
 * **The three sentences are this file's own and are flagged at each site**, the
 * way `sendCampaign()`'s 409 is at line 15268. Nothing in `lib/`,
 * `ADMIN_PANEL.md` or `README.md` records the `message` of any auth refusal —
 * only the codes — and provoking the wrong-password one costs a request the
 * shop counts. What makes the invention low-consequence here, and it was checked
 * rather than assumed: **no screen can render any of them.**
 * `app/api/session/route.ts:52-58` throws the API's `message` away and
 * substitutes its own on every branch, and `LoginForm.tsx:65-74` then throws
 * *that* away too and renders `t("rateLimited")`, `t("suspended")` or
 * `t("failed")` from `messages/{fr,ar}.json`. The API's prose is discarded twice
 * before it could reach a reader. Whoever spends one of the ten failed-login
 * attempts on a wrong password should replace these with what came back.
 *
 * **`unauthenticated` — the no-credential 401 — is deliberately not served**, and
 * it is unreachable rather than omitted: `lib/api/client.ts:57` attaches
 * `Authorization: Basic` to every request that carries a session, and the login
 * route builds one from the submitted form before it calls anything. There is no
 * path through the panel that reaches this API without a credential. It is also
 * the one refusal the route flattens away — `route.ts:55` maps *both* 401 codes
 * to its own `unauthenticated`, so a screen could not tell it from
 * `incorrect_password` even if it arrived.
 */
export const HARNESS_CREDENTIAL = { username: "harness", password: "harness" };

/**
 * A suspended account, and it is refused **before** the rate limiter.
 *
 * That order is measured rather than convenient: ADMIN_PANEL.md:208 records
 * `Users\SuspensionGuard` running in `rest_pre_dispatch` at priority 9 and
 * `RateLimitGuard` at 10, *"so a refused account does not spend anyone's
 * allowance"*. A mock that checked the bucket first would answer 429 to a
 * suspended account whose IP was locked out, and `route.ts:60` would then send
 * a 429 where the shop sends the one refusal that tells the person to stop
 * trying.
 */
const SUSPENDED_USERNAME = "harness-suspended";

/**
 * The failed-login bucket, as a credential rather than as a counter.
 *
 * **The bucket is real and this is not a simulation of it.** ADMIN_PANEL.md:240
 * and `scripts/reset-rate-limit.sh:7` record 10 failures per 15 minutes per IP,
 * and `e2e/rate-limit.ts` exists because a real run spent the allowance and
 * eleven later tests failed looking exactly like a broken login. Counting here
 * would reproduce that inside the harness: `respond()` would stop being a
 * function of its arguments, the eleventh capture in a run would differ from the
 * tenth, and a byte-stable screenshot — the property this whole file is built
 * for — would be gone.
 *
 * What the fixture encodes instead is the bucket's one *observable* property,
 * which is also the one that makes it worth rendering: **a locked-out address is
 * refused even with the correct password.** This username answers 429 whatever
 * password is presented, including the right one.
 */
const LOCKED_USERNAME = "harness-locked";

/**
 * `Retry-After`, in seconds, and **this number is derived rather than read.**
 *
 * 900 is the measured 15-minute window (ADMIN_PANEL.md:240) expressed in
 * seconds. Nobody has read a `Retry-After` off a real 429 from this shop, so the
 * *header's presence* is what is reproduced faithfully and its *value* is a
 * ceiling rather than a measurement — the shop may well send the remaining time
 * rather than the whole window.
 *
 * Two consequences the login screen owns, both of which follow from the value
 * being large and neither of which is a defect in this file:
 *
 *   1. **`acFetch` retries the login.** `isRetryable()` is true for a GET on
 *      429, `/auth/me` is a GET, and `client.ts:104-107` sleeps
 *      `min(retryAfter, 10)` seconds and asks again. So a locked-out sign-in
 *      takes **ten seconds** to fail, spinner running, before the 429 reaches
 *      the browser. ADMIN_PANEL.md:871 asks for exactly that retry, so it is the
 *      panel behaving as specified; whether a login form is where it belongs is
 *      a question for the screen, and this fixture is what makes it visible.
 *   2. **The copy renders the raw seconds.** `login.rateLimited` is
 *      `"Réessayez dans {seconds, plural, …}"`, so 900 renders as *"900
 *      secondes"* in French and the Arabic plural form beside it. That is an
 *      honest render of an unhelpful number, and it is the screen's to decide.
 */
const RETRY_AFTER_SECONDS = 900;

/**
 * `Authorization: Basic base64(user:pass)` → `{username, password}`, or null.
 *
 * Deliberately narrow: anything that is not a well-formed Basic header — absent,
 * `Bearer`, undecodable, or missing the colon — returns null and lands on the
 * unchanged path. A parse failure here must never become a refusal, because the
 * refusals are the new behaviour and a header this function misreads would take
 * a consumer that has nothing to do with login off its old answer.
 *
 * The password is `slice(colon + 1)` rather than a `split(":")` pair: a
 * WordPress Application Password is displayed in six space-separated groups and
 * nothing forbids a colon inside a password generally, so splitting on every
 * colon would silently truncate one.
 */
function basicCredential(headers) {
  const header = headers?.authorization;
  if (typeof header !== "string") return null;
  const match = /^Basic\s+(\S+)$/i.exec(header);
  if (match === null) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon === -1) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/**
 * The refusal a presented credential earns, or null for "answer as before".
 *
 * Every branch is keyed on the **username** alone, which is what keeps the three
 * fixtures reachable from the login form by typing a name. The one exception is
 * the wrong-password branch, which is the only one that can be *provoked* rather
 * than *named*: it is the harness credential with anything else in the password
 * field, so it is what a person mistyping their password on `/login` gets, and
 * it is why `HARNESS_CREDENTIAL.password` is now load-bearing.
 */
function authRefusal(headers) {
  const credential = basicCredential(headers);
  if (credential === null) return null;

  // Priority 9, ahead of the bucket. See SUSPENDED_USERNAME above.
  if (credential.username === SUSPENDED_USERNAME) {
    /* Invented sentence — see the block above. Only the 401 and the code are
       measured, and `route.ts:56` replaces this before a browser sees it. */
    return fail(401, "account_suspended", "This account has been suspended.");
  }

  if (credential.username === LOCKED_USERNAME) {
    /* Invented sentence, as above. The 429, the code and the presence of the
       header are what `route.ts:60-64` and `LoginForm.tsx:60-66` read. */
    return {
      ...fail(429, "too_many_requests", "Too many failed sign-in attempts."),
      headers: { "retry-after": String(RETRY_AFTER_SECONDS) },
    };
  }

  if (
    credential.username === HARNESS_CREDENTIAL.username &&
    credential.password !== HARNESS_CREDENTIAL.password
  ) {
    /* Invented sentence, as above. ADMIN_PANEL.md:751 records that the *code*
       here is WordPress core's own surfacing through the envelope; it does not
       record the sentence, and this file has not seen one. */
    return fail(401, "incorrect_password", "The Application Password is not valid.");
  }

  return null;
}

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
 *   0        granted    true  + a date + `registration`      a source the panel labels
 *   2        granted    true  + a date + `seed`        a source it has no label for
 *   4        withdrawn  false + a date + `unsubscribe_link`  the second negative
 *   5 6 8    granted    true  + one shared date + `seed`
 *   10 12 14 granted    true  + the same shared date + `seed`
 *   …        never      false + null   + null                the other eight
 *
 * ── Eight granted, because the fixture has to reconcile with its own preview ──
 *
 * It was **two** granted until 2026-08-28, and that was the one number here that
 * disagreed with something this same file publishes: `CAMPAIGN_PREVIEW_SEED`
 * answers `audience_count: 8` for the two `all` campaigns, measured, and an `all`
 * audience *is* the consented customers. So `/customers` served two rows a
 * consent filter would keep while `/campaigns/319/preview` promised eight
 * recipients — and a customer picker, which reads the first and is built beside
 * the second, is exactly the screen that would have had to explain the gap. Live
 * on 2026-08-28: **16 customers, 8 granted, 8 not**, and `audience_count` 8.
 *
 * The six added rows all carry **one shared stamp**, which is live's shape rather
 * than a convenience — seven of the eight live grants share a single
 * `marketing_consent_at` because one seeding pass wrote them, exactly the tie
 * `/segments` has on its two date columns. Live sources are 7 × `seed`,
 * 1 × `registration`, and this reproduces that ratio.
 *
 * **They are deliberately rows with no name.** Twelve of the seventeen customers
 * here have empty `first_name`/`last_name` — the common live shape, where 12 of
 * 16 are nameless — so a granted row that a picker draws is a row whose identity
 * is its *email*, not its name. Putting all the consent on the four named rows
 * would have let a picker ship that draws a blank label for the ordinary case.
 *
 * Index 4 stays the withdrawal and stays *not* granted: customer 24 is the row
 * `scripts/capture.mjs` photographs, and the withdrawn state lives nowhere else.
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
/** The one stamp the six seeded grants share, the way the live seven do. */
const CONSENT_SEEDED_AT = 10_080;

const CONSENT_RECORDS = {
  0: { granted: true, minutesAgo: 9000, source: "registration" },
  2: { granted: true, minutesAgo: 12_000, source: "seed" },
  4: { granted: false, minutesAgo: 4000, source: "unsubscribe_link" },
  5: { granted: true, minutesAgo: CONSENT_SEEDED_AT, source: "seed" },
  6: { granted: true, minutesAgo: CONSENT_SEEDED_AT, source: "seed" },
  8: { granted: true, minutesAgo: CONSENT_SEEDED_AT, source: "seed" },
  10: { granted: true, minutesAgo: CONSENT_SEEDED_AT, source: "seed" },
  12: { granted: true, minutesAgo: CONSENT_SEEDED_AT, source: "seed" },
  14: { granted: true, minutesAgo: CONSENT_SEEDED_AT, source: "seed" },
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
 * **The inference in this block was wrong, and it is now read rather than
 * guessed.** This said the subjectless row's `dedupe_key` was "the event alone,
 * flagged rather than presented as measured". `Notification::dedupeKey()` is
 *
 *     substr($event . ':' . ($subjectId !== null ? $subjectId : $recipient), 0, 191)
 *
 * — so the right half falls back to the **recipient**, never to nothing, and
 * `NotificationController`'s own docblock says so beside the `dedupe_key`
 * argument ("a recipient can end up in the key when a notification has no
 * subject id"). The row below carries `stock.low:admin@example.test`. It matters
 * because `?dedupe_key=` is exact-match and is a filter the screen offers: a row
 * keyed `stock.low` here would answer a request the shop answers with nothing.
 *
 * **And the parked row paired a count with a sentence `markFailed()` cannot put
 * together.** It read `attempts: 5` with `"Not a deliverable email address."`,
 * which is a *permanent* refusal — `markFailed($id, $error, false)` takes a row
 * to `failed` on the call it is made, at whatever `attempts + 1` then is. Five is
 * the *exhaustion* count (`MAX_ATTEMPTS`), and a row only reaches it through five
 * **retryable** failures, whose last error is the drain's own sentence. So the
 * two are split below, and the split is what puts an `attempts` strictly between
 * 1 and 5 in the fixture rather than a number invented to fill the gap.
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
  /*
   * Parked by **exhaustion**: five retryable failures, so the count is
   * `MAX_ATTEMPTS` and the sentence is the one the drain writes every time
   * `wp_mail()` answers false.
   */
  {
    status: "failed",
    attempts: 5,
    error: "wp_mail() did not accept the message.",
    sent: false,
  },
  /*
   * Parked by a **permanent refusal**, on a row the drain had already tried once
   * — so `attempts` is 2 and not 5, and that is the only honest way to get a
   * count strictly between the two ends: `markFailed(…, false)` parks the row on
   * the spot at whatever the counter had reached. `seed-notifications.mjs`'s
   * `karim-shipped` is this row, one shop over.
   */
  {
    status: "failed",
    attempts: 2,
    error: "Not a deliverable email address.",
    sent: false,
  },
];

/**
 * The shop's own name, as `NotificationSubscriber::shopName()` hands it to
 * `NotificationMessages::render()`. It is the first token of every subject and
 * the last line of every customer body, so it is a constant here rather than
 * eight copies.
 */
const SHOP_NAME = "Algerian Commerce";

/**
 * **`NotificationMessages::render()`, reproduced** — the eight templates behind
 * `message.subject` and `message.body` on `GET /notifications/{id}`.
 *
 * Reproduced rather than stored per row, because the pairing is the thing a
 * screen can be wrong about: the body has to be the body *for that event with
 * that context*, and a fixture holding both independently drifts the moment one
 * is edited. `lib/notifications.ts:290-296` quotes one of these verbatim from
 * the live shop and this file has to keep agreeing with it.
 *
 * Measured 2026-08-28 against the live queue, one detail read per distinct
 * event, and the five that exist in that shop came back character-identical to
 * these — including `"Bonjour,"` with no name, which is what
 * `trim($first . ' ' . $last)` leaves on a guest order.
 *
 * **Plain text with `\n\n` between paragraphs, never HTML.** The class is text
 * by design; `messageParagraphs()` splits on the blank line.
 */
function renderNotificationMessage(event, context) {
  const number = String(context.order_number ?? "");
  const money = `${context.total ?? ""} ${context.currency ?? ""}`.trim();
  const name = String(context.customer_name ?? "").trim();
  // `Bonjour,` on a guest order. A French salutation over an English sentence,
  // and it renders verbatim — see lib/notifications.ts:288-310.
  const greeting = name === "" ? "Bonjour," : `Bonjour ${name},`;

  switch (event) {
    case "order.placed":
      return {
        subject: `${SHOP_NAME} — order ${number} received`,
        body: `${greeting}\n\nWe have received your order ${number}.\n\nTotal: ${money}\n\nWe will contact you to confirm it before dispatch.\n\n${SHOP_NAME}`,
      };
    case "payment.received":
      return {
        subject: `${SHOP_NAME} — payment received for order ${number}`,
        body: `${greeting}\n\nWe have received your payment of ${money} for order ${number}.\n\n${SHOP_NAME}`,
      };
    case "shipment.shipped": {
      /*
       * The one template with conditional paragraphs, and both conditions are
       * real states rather than decoration: §57 records that a parcel exists
       * before its tracking number is readable, and the link is empty whenever
       * §71's `store.storefront_url` is unset — this backend refuses to guess
       * one, so a message with no link is worth sending and one pointing at a
       * login screen is not.
       */
      const courier = String(context.provider ?? "");
      const tracking = String(context.tracking_number ?? "").trim();
      const url = String(context.tracking_url ?? "").trim();
      let line =
        courier !== ""
          ? `Order ${number} has been handed to ${courier}.`
          : `Order ${number} has been dispatched.`;
      if (tracking !== "") line += `\n\nTracking number: ${tracking}`;
      if (url !== "") line += `\n\nFollow it here:\n${url}`;
      return {
        subject: `${SHOP_NAME} — order ${number} is on its way`,
        body: `${greeting}\n\n${line}\n\n${SHOP_NAME}`,
      };
    }
    case "shipment.delivered":
      return {
        subject: `${SHOP_NAME} — order ${number} delivered`,
        body: `${greeting}\n\nOrder ${number} has been delivered. Thank you for shopping with us.\n\n${SHOP_NAME}`,
      };
    case "order.cancelled":
      return {
        subject: `${SHOP_NAME} — order ${number} cancelled`,
        body: `${greeting}\n\nOrder ${number} has been cancelled. If this is unexpected, reply to this message.\n\n${SHOP_NAME}`,
      };
    case "order.refunded":
      return {
        subject: `${SHOP_NAME} — order ${number} refunded`,
        body: `${greeting}\n\nOrder ${number} has been refunded.\n\n${SHOP_NAME}`,
      };
    // The two admin messages: short, factual, and never sent to a customer.
    // Note there is no greeting on either — `NotificationEvent::ADMIN_EVENTS`
    // keeps them apart and the templates are written for a shop, not a person.
    case "admin.new_order":
      return {
        subject: `${SHOP_NAME} — new order ${number}`,
        body: `Order ${number} was placed for ${money}.`,
      };
    case "stock.low":
      return {
        subject: `${SHOP_NAME} — low stock: ${String(context.product_name ?? "")}`,
        body: `${String(context.product_name ?? "")} (SKU ${
          context.sku === undefined ? "—" : String(context.sku)
        }) is down to ${String(context.stock ?? "?")} in stock.`,
      };
    default:
      // `render()`'s own fallback, and `queueOrderEvent()` refuses to queue a
      // row whose subject came back empty — so this is unreachable through the
      // shop and is reproduced only so the switch is total.
      return { subject: "", body: "" };
  }
}

/**
 * The queue's **payload column**, which the list must never publish.
 *
 * A separate map rather than a key on the row, because that is exactly the shape
 * the API has: `NotificationRepository::search()` does not select `payload` at
 * all, so on the list side those bytes do not exist in the process. A `payload`
 * key hanging off a row here would be one `...row` away from being served on
 * every list, and §90's whole line is that a support agent scanning a queue does
 * not pull five hundred customers' order contents into one response.
 *
 * `null` is the row whose payload will not `json_decode` — see the push below.
 */
const NOTIFICATION_PAYLOADS = new Map();

const NOTIFICATIONS = (() => {
  const rows = [];

  const push = ({ channel, event, audience, recipient, order, slot, state: forced, context }) => {
    const state = forced ?? NOTIFICATION_STATES[slot % NOTIFICATION_STATES.length];
    const id = 4100 + rows.length;
    rows.push({
      id,
      channel,
      event,
      /*
       * `event:subject_id`, and **`event:recipient` when there is no subject** —
       * `Notification::dedupeKey()`, read rather than inferred. See the block
       * above for what this used to say.
       */
      dedupe_key: `${event}:${order === null ? recipient : order.id}`.slice(0, 191),
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
    NOTIFICATION_PAYLOADS.set(id, context);
  };

  /**
   * The four keys `NotificationSubscriber::queueOrderEvent()` puts in every
   * order event's context, in its order. `customer_name` is
   * `trim($first . ' ' . $last)`, so it is `""` on a guest order and the
   * template's `Bonjour,` branch is reachable from the fixture rather than only
   * from the code.
   */
  const orderContext = (order) => ({
    order_number: order.number,
    total: order.total,
    currency: order.currency,
    customer_name: `${order.billing.first_name} ${order.billing.last_name}`.trim(),
  });

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
        context: orderContext(order),
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
        context: orderContext(order),
      });
    }
  }

  // The second channel, addressed to a phone rather than to a mailbox. Its
  // context carries the two `queueOrderEvent()` passes as `$extra` for a
  // shipment, so the template's tracking paragraph has something to render.
  push({
    channel: "sms",
    event: "shipment.shipped",
    audience: "customer",
    recipient: "+213551000024",
    order: seededOrdersOf(24)[0],
    slot: slot++,
    context: {
      ...orderContext(seededOrdersOf(24)[0]),
      provider: "Yalidine",
      // Derived from the order it is about, not written out: a tracking number
      // naming a different order than the sentence beside it is the kind of
      // fixture inconsistency a screenshot makes look deliberate.
      tracking_number: `YAL-${seededOrdersOf(24)[0].id}-DZ`,
      // Empty, which is the ordinary state: §71's `store.storefront_url` is
      // unset on this shop, so the template's link paragraph is absent and the
      // absence is what a screen has to render.
      tracking_url: "",
    },
  });

  /*
   * The row with no subject at all.
   *
   * **Nothing running in this shop writes one** — every `Notification::to*`
   * call site in the plugin passes a `subject_type` and a `subject_id`, and
   * `stock.low` passes `product` plus the product id. The column is nullable,
   * the presenter publishes `null` rather than 0, and the schema declares it, so
   * the state is real and unreachable at once. It is constructed here for the
   * reason `seed-notifications.mjs` constructs its unreadable payload and its
   * `sms` row: the shape exists and only a fixture can produce it. Named rather
   * than left to read as something the shop queues.
   */
  push({
    channel: "email",
    event: "stock.low",
    audience: "admin",
    recipient: "admin@example.test",
    order: null,
    slot: slot++,
    context: { product_name: "Tapis berbère fait main", sku: "AC-TAPIS-004", stock: "2" },
  });

  /*
   * **The unreadable payload**, and it is the one row here whose `message` is
   * not rendered from a context at all.
   *
   * `NotificationPresenter::message()` answers `{readable: false, subject: "",
   * body: "", context: []}` — three empty fields and `context` as a JSON
   * **array**, which is PHP's empty array serialising — whenever the payload
   * will not `json_decode`. It arrives only ever with `status: "failed"` and
   * `last_error: "The stored payload is not readable."`, because `drain()` calls
   * `markFailed($id, …, false)` on it **without attempting a send**: so
   * `attempts` is exactly 1, the increment `markFailed()` makes, and not 0 and
   * not 5.
   *
   * It cannot be produced through the API — `notify()` writes the payload with
   * `wp_json_encode()` and no route writes a payload at all — which is why
   * `seed-notifications.mjs` writes one underneath on the live shop and why this
   * one is a `null` in the payload map here.
   */
  push({
    channel: "email",
    event: "shipment.delivered",
    audience: "customer",
    recipient: CUSTOMERS.find((row) => row.id === 24).email,
    order: seededOrdersOf(24)[1] ?? seededOrdersOf(24)[0],
    slot: slot++,
    state: {
      status: "failed",
      attempts: 1,
      error: "The stored payload is not readable.",
      sent: false,
    },
    context: null,
  });

  /*
   * The 340px overflow row, and the string is the file's own `LONG_EMAIL` rather
   * than a new one — 81 characters with no break opportunity, the same constant
   * one order in 47 already carries as its billing address.
   *
   * `recipient` is the right column to put it in: it is `maxLength: 191` at the
   * API, it is deliberately **not** validated as an email (§29's other four
   * channels would put a phone number here, and the `sms` row above does), and
   * it is the widest free-text cell on both the list and the detail. A queue of
   * tidy `client{id}@example.test` addresses proves nothing about the one that
   * is not.
   */
  push({
    channel: "email",
    event: "order.cancelled",
    audience: "customer",
    recipient: LONG_EMAIL,
    order: seededOrdersOf(21)[0],
    slot: slot++,
    context: { ...orderContext(seededOrdersOf(21)[0]), customer_name: "" },
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

/* ------------------------------------------------------------------- CMS --- */

/**
 * ── The one filter family in this panel that inverts, and everything under it ─
 *
 * **`?status=` defaults to `publish` on every `/cms/` collection, and `any`
 * means publish plus draft and never the trash.** Every other list in this file
 * reads the absence of `?status=` as *everything*: `/coupons` is three-state with
 * absence meaning both, `/products` and `/orders` filter a value or nothing. Here
 * the absence means **publish only**, so a screen that sent nothing would open on
 * a list with every draft silently missing — and a draft is precisely what a
 * content manager opens these screens to finish.
 *
 * Measured, and recorded three times over: ADMIN_PANEL.md §89's correction block
 * ("the default is `publish`, so §61's read contract and every existing caller
 * are unchanged, and `any` means publish plus draft and never the trash"),
 * README's "Every content list asks for `?status=any`, which inverts the panel's
 * own habit", and `lib/cms.ts`'s `DEFAULT_STATUS_FILTER`.
 *
 * **This is the single most important honesty point in this section.** A
 * forgiving mock that answered drafts on a bare listing would make
 * `DEFAULT_STATUS_FILTER`, every screen's explicit `?status=any`, and the whole
 * hub-count inversion look like defensive padding somebody could delete — and it
 * would delete cleanly, against a green harness, and hide every draft in the shop
 * the moment it shipped.
 *
 * `""` is **not** a value here: it is outside the enum the router validates
 * against, so it is a 400. That is the reading `/products?status=` gets and the
 * opposite of `/coupons?status=`, where the empty string really is inside the
 * enum — the same distinction this file paid for once already.
 *
 * ── What `?search=` matches, and what it cannot ──────────────────────────────
 *
 * **The title and the body, never the path.** `WP_Query`'s `s` does not search
 * `post_name` and will not take it in `search_columns`, so on the one resource
 * whose address *is* its path, a path cannot be searched for. Asserted on the
 * backend rather than worked around, and the screen says what the field matches —
 * the treatment `/customers` already gets, and for the same reason: a search that
 * silently fails to match the thing a person typed reads as broken.
 *
 * ── Ordering, and the parameter nobody has measured ──────────────────────────
 *
 * **`orderby` on `/cms/*` is recorded neither as working nor as ignored. The
 * notes are silent, and this file does not fill the silence in either
 * direction.** What *is* recorded is the resting order, and that is what is
 * served: `/cms/pages` is ordered **by title on the server** — the one departure
 * the route makes from `baseArgs()`'s `menu_order` default, because every page in
 * this shop carries `menu_order` 0 and the default degenerates to newest-first
 * (`app/[locale]/(panel)/content/pages/query.ts` records the reasoning) — while
 * banners and FAQs are ordered by their dense `position`.
 *
 * So `orderby` and `order` are **accepted and ignored and not validated** here.
 * Not validated is the deliberate half: refusing an unknown value would be this
 * file inventing a validator nobody has seen, which is the *stricter* direction
 * the coupons branch was burned by — a screen built to a 400 the API never sends.
 * Nobody can verify a sort against this harness in either direction, which is the
 * honest state of the measurement.
 *
 * ── Envelopes, and which of them are guesses ─────────────────────────────────
 *
 * `/cms/pages` pages for real: `?page` and `?per_page` are part of the route
 * `feat/cms-page-index` added, the index screen sends `per_page=50`, and the hub
 * sends `per_page=1` for the count alone. Its `meta` carries the four paging keys
 * plus **`excluded_system`**, which is how many functional shop pages the index
 * left out; `PagesList` renders that count in a footnote.
 *
 * **`/cms/banners` and `/cms/faqs` page here and their live envelope is
 * unverified.** Both go through the shared `paginate()`, so both emit the four
 * paging keys. The reason is not taste: `app/[locale]/(panel)/content/page.tsx`
 * fetches each with `?per_page=1&status=any` and reads **`meta.total`** through
 * `listMeta`, which requires all four keys — so a `counted()` envelope would make
 * the hub render no count at all, and a screen built for a count that the harness
 * can never produce is the *less capable* direction. Whether the shop sends
 * `page`, `per_page` and `total_pages` beside `total` on these two is a request
 * nobody has made. Flagged rather than presented as measurement.
 *
 * `/cms/faq-categories` takes no parameters from any screen and nothing reads its
 * `meta`, so it goes through `list()` — the file's one place for an unverified
 * envelope — and is named in that helper's list.
 *
 * ── Nothing below calls `rand()` ─────────────────────────────────────────────
 *
 * Every value in this section is written out or derived from an id, so inserting
 * it above the shared warning cannot shift the mulberry32 sequence the 633 orders
 * and 39 products were verified against.
 */

/**
 * WordPress **texturizes what it stores**, so a title never reads back as it was
 * written: the apostrophe in `Soldes d'été` arrives as character reference 8217.
 * Measured, and the seed learned it the hard way — it created a duplicate banner
 * on its second run because it compared what it had sent against what came back.
 *
 * `decodeEntities()` on every title is the panel's half, and it needs a fixture
 * or the whole treatment is untested prose. One page title and one banner title
 * carry it, which are the two places the panel decodes.
 */
const RSQUO = "&#8217;";

/**
 * The 340px overflow strings for this section, one per shape that can overflow.
 *
 * A page's **path** is the unbroken run of characters on the Pages index — it is
 * an identifier rendered `Ltr` in a row that is otherwise wrappable French — and
 * an FAQ's **question** is the one on the FAQs list. The FAQ one is Arabic
 * because that list renders questions `dir="auto"`, so an Arabic string is the
 * case where an overflow and a direction flip can compound.
 */
const LONG_PAGE_PATH = "programme-de-fidelite-et-conditions-de-participation-2026-2027";
const LONG_FAQ_QUESTION =
  "هل يمكنني إرجاع منتج تم شراؤه خلال فترة التخفيضات إذا لم يكن مطابقا للمواصفات المعروضة على الموقع وما هي الشروط؟";

/** What a CMS resource's `status` can be. The trash is reached by `DELETE`. */
const CONTENT_STATUSES = ["publish", "draft"];

/**
 * What `?status=` accepts, in the order the refusal names them.
 *
 * `any` is not a status — nothing is ever stored as `any` — which is why this
 * list and the one above are different things rather than one with an extra
 * member.
 */
const CONTENT_STATUS_FILTERS = ["publish", "draft", "any"];

/**
 * A page's `seo` block, **derived**, which is the property the form is built on.
 *
 * `overrides` names the keys somebody set by hand; everything else changes when
 * the title or the excerpt changes, so the form shows the derived values as
 * placeholders rather than as inputs a person would then be unable to un-type.
 * One page below carries a real override so that branch has a fixture.
 */
const pageSeoOf = (title, excerpt, path, status, overrides = []) => {
  const plain = excerpt.replace(/<[^>]+>/g, "").trim();
  return {
    title: overrides.includes("title") ? `${title} | Atelier` : title,
    description: plain.slice(0, 155),
    canonical: `https://boutique.example.dz/${path}`,
    robots: {
      index: status === "publish",
      follow: true,
      directive: status === "publish" ? "index, follow" : "noindex, follow",
    },
    og: { title, description: plain.slice(0, 155), type: "website", image: null },
    image: null,
    structured_data: { "@context": "https://schema.org", "@type": "WebPage", name: title },
    overrides,
  };
};

/**
 * One page, in the two shapes the API publishes for it.
 *
 * The index row is deliberately **less** than the document — no `content`, no
 * `seo`, no `excerpt` — because the first is a whole page body per row and the
 * second is a `SeoResolver` pass per row. The backend asserts the omission so it
 * cannot drift back, and `pageRowOf()` below is what reproduces it: one object
 * here, two projections, so a key added to the document cannot leak into the
 * index by being forgotten.
 *
 * `content` and `excerpt` are stored **rendered** (`<p>…</p>\n`) rather than as
 * what was sent, and PATCHing that rendered form back does not accumulate another
 * wrapper — verified over three round trips on the live shop, and reproduced in
 * `applyPageWrites()`.
 */
function seedPage({
  id,
  path,
  status = "publish",
  title,
  body,
  excerpt = "",
  menuOrder = 0,
  minutes,
  overrides = [],
  /** The WordPress or WooCommerce option that points at this page, if any. */
  option = null,
  /** True for a page whose body the shop generates — omitted from the index. */
  functional = false,
}) {
  const cut = path.lastIndexOf("/");
  return {
    id,
    path,
    slug: cut === -1 ? path : path.slice(cut + 1),
    parent_path: cut === -1 ? "" : path.slice(0, cut),
    status,
    title,
    content: `<p>${body}</p>\n`,
    excerpt: excerpt === "" ? "" : `<p>${excerpt}</p>\n`,
    parent_id: 0,
    menu_order: menuOrder,
    image: null,
    seo: pageSeoOf(title, excerpt, path, status, overrides),
    date_created: iso(minutes + 4000),
    date_modified: iso(minutes),
    option,
    functional,
  };
}

/**
 * ── Which page produces which answer ─────────────────────────────────────────
 *
 * The fifth table in this file, on the same rule as the other four: a screen
 * cannot be verified against a state it can never reach, and every path below is
 * written out because a literal that stops matching fails a test while a `find()`
 * moves quietly and takes the table's meaning with it.
 *
 *   path                    request                       answer
 *   ──────────────────────  ────────────────────────────  ──────────────────────
 *   privacy-policy          GET                           **404** — it is a
 *                                                         draft and the default
 *                                                         filter is `publish`
 *   privacy-policy          GET ?status=any               200, `status:"draft"`
 *   privacy-policy          DELETE                        409 details.**option**
 *   privacy-policy          DELETE ?force=true            the **same 409** —
 *                                                         force does not override
 *                                                         an option reference
 *   legal                   DELETE                        409 details.**children**
 *                                                         and `child_ids`
 *   legal                   DELETE ?force=true            200, and the two
 *                                                         children reparent to
 *                                                         the root
 *   refund_returns          DELETE                        200 — prose referenced
 *                                                         by nothing
 *   cart                    GET ?status=any               200, and it appears in
 *                                                         **no listing**
 *   ac-unpublished          GET ?status=any               200 — **one of two**
 *                                                         rows carrying that path
 *   ancienne-page           GET ?status=any               404 — trashed, and the
 *                                                         trash is reachable
 *                                                         through no filter
 *   —                       PATCH {parent_path:"nulle"}   400 fields{parent_path}
 *   —                       PATCH {slug:"x"}              200 with
 *                                                         meta.path_changed
 *
 * **`privacy-policy` is the measurement the whole Pages index exists for.**
 * WordPress creates it as a draft; `?status=` *filters* a single read rather than
 * widening it; and a draft and a path that does not exist answer the **same 404
 * with the same message**, `"No page at that path."` So the shop answered "no
 * such page" about a page sitting right there, and the index is the only place
 * the two facts separate.
 *
 * **The two `ac-unpublished` rows are the collision fixture.**
 * `wp_unique_post_slug()` does not run for a draft, so nothing stops two pages
 * sharing one path — measured before the seed cleaned this shop, 53 rows answered
 * to `ac-unpublished` and 27 to `conditions`, and `get_page_by_path()` resolves
 * exactly one of each while the other 78 could not be read, written or deleted
 * through `/cms/pages/{path}` at all. Two rows is the smallest fixture that makes
 * `collidingPaths()` non-empty and the index's non-linkable row reachable; the
 * *count* is this file's and the *shape* is the shop's.
 */
const NAMED_PAGES = [
  seedPage({
    id: 2,
    path: "privacy-policy",
    status: "draft",
    title: "Politique de confidentialité",
    body: "Les données que nous collectons, la durée de conservation et vos droits.",
    excerpt: "Ce que nous collectons et ce que nous en faisons.",
    minutes: 40_320,
    option: "wp_page_for_privacy_policy",
  }),
  seedPage({
    id: 3,
    path: "refund_returns",
    title: "Politique de remboursement et de retour",
    body: "Un article peut être retourné sous quatorze jours, dans son emballage d’origine.",
    excerpt: "Quatorze jours pour changer d’avis.",
    minutes: 40_200,
  }),
  // The four whose body the shop generates: a block or a shortcode, or nothing at
  // all. Omitted from the index and still addressable by path, which is what
  // `meta.excluded_system` reports rather than hides.
  seedPage({
    id: 5,
    path: "shop",
    title: "Boutique",
    body: "",
    minutes: 40_100,
    option: "woocommerce_shop_page_id",
    functional: true,
  }),
  seedPage({
    id: 6,
    path: "cart",
    title: "Panier",
    body: "[woocommerce_cart]",
    minutes: 40_090,
    option: "woocommerce_cart_page_id",
    functional: true,
  }),
  seedPage({
    id: 7,
    path: "checkout",
    title: "Commande",
    body: "[woocommerce_checkout]",
    minutes: 40_080,
    option: "woocommerce_checkout_page_id",
    functional: true,
  }),
  seedPage({
    id: 8,
    path: "my-account",
    title: "Mon compte",
    body: "[woocommerce_my_account]",
    minutes: 40_070,
    option: "woocommerce_myaccount_page_id",
    functional: true,
  }),
  seedPage({
    id: 11,
    path: "legal",
    title: "Informations légales",
    body: "Les mentions, les conditions et la politique de retour de l’atelier.",
    excerpt: "Tout ce que la loi nous demande de publier.",
    minutes: 21_600,
  }),
  seedPage({
    id: 12,
    path: "legal/conditions-generales",
    title: "Conditions générales de vente",
    body: "Commande, paiement à la livraison, délais et litiges.",
    excerpt: "Le contrat entre l’atelier et vous.",
    minutes: 21_500,
    overrides: ["title"],
  }),
  seedPage({
    id: 13,
    path: "legal/mentions-legales",
    status: "draft",
    title: "Mentions légales",
    body: "Éditeur, hébergeur et registre du commerce.",
    minutes: 21_400,
  }),
  seedPage({
    id: 14,
    path: "a-propos",
    title: "À propos de l’atelier",
    body: "Trente artisanes, six wilayas, et un carnet de commandes tenu à la main.",
    excerpt: "Qui fabrique ce que vous achetez.",
    minutes: 18_000,
  }),
  seedPage({
    id: 15,
    path: "contact",
    title: "Nous contacter",
    body: "Par téléphone du dimanche au jeudi, ou par le formulaire ci-dessous.",
    minutes: 17_000,
  }),
  seedPage({
    id: 16,
    path: "livraison",
    title: "Livraison et délais",
    body: "Domicile ou bureau, dans les 58 wilayas, sous trois à sept jours.",
    excerpt: "Où nous livrons, et en combien de temps.",
    minutes: 16_000,
  }),
  // The texturization fixture. Written `Soldes d'été`, stored — and therefore
  // read back — with the apostrophe as character reference 8217.
  seedPage({
    id: 17,
    path: "soldes-d-ete",
    title: `Soldes d${RSQUO}été`,
    body: `Jusqu${RSQUO}au 31 août, sur une sélection de tapis et de poteries.`,
    excerpt: `Les dates et les conditions des soldes d${RSQUO}été.`,
    minutes: 900,
  }),
  // The 340px fixture: a 62-character path with no break opportunity, on a draft
  // so it is only reachable through `?status=any` or `?status=draft`.
  seedPage({
    id: 18,
    path: LONG_PAGE_PATH,
    status: "draft",
    title: "Programme de fidélité",
    body: "Un point par cent dinars, et une remise au bout de trente points.",
    minutes: 600,
  }),
  // The collision. Two drafts, one path, and `get_page_by_path()` resolves the
  // lower id — so row 20 cannot be read, written or deleted at all.
  seedPage({
    id: 19,
    path: "ac-unpublished",
    status: "draft",
    title: "Brouillon sans titre",
    body: "Page créée automatiquement et jamais publiée.",
    minutes: 500,
  }),
  seedPage({
    id: 20,
    path: "ac-unpublished",
    status: "draft",
    title: "Brouillon dupliqué",
    body: "Deuxième page portant la même adresse que la précédente.",
    minutes: 480,
  }),
  // Trashed. In no listing, under no filter — `any` is publish plus draft, and
  // that is the whole reason it is not a synonym for "everything".
  seedPage({
    id: 21,
    path: "ancienne-page",
    status: "trash",
    title: "Ancienne page retirée",
    body: "Retirée du site en 2025.",
    minutes: 45_000,
  }),
];

/**
 * Fifty more, so the pager is genuinely exercised rather than merely rendered.
 *
 * `PER_PAGE` on the index is **50** and the seed used to be under it, so the
 * second page had never been requested by anything — the pager was two disabled
 * buttons and a "1 / 1" in every capture ever taken. Sixty-two listed rows put
 * twelve on page two under `?status=any` and two on page two under the API's own
 * `publish` default, so both readings page.
 *
 * Two forms per topic rather than fifty free-standing titles, and that is what
 * makes the **title order** observable: all twenty-five "Entretien" rows sort
 * ahead of all twenty-five "Guide" rows, so a listing that had quietly kept its
 * insertion order would be visibly wrong rather than plausibly different.
 */
const PAGE_TOPICS = [
  ["tapis-berberes", "les tapis berbères"],
  ["poterie-de-maghnia", "la poterie de Maghnia"],
  ["cuivre-martele", "le cuivre martelé"],
  ["laine-des-aures", "la laine des Aurès"],
  ["dattes-de-tolga", "les dattes de Tolga"],
  ["huile-d-argan", "l’huile d’argan"],
  ["savon-d-alep", "le savon d’Alep"],
  ["miel-de-jujubier", "le miel de jujubier"],
  ["bijoux-en-argent", "les bijoux en argent"],
  ["vannerie-du-sud", "la vannerie du Sud"],
  ["chech-en-coton", "le chèche en coton"],
  ["caftan-brode", "le caftan brodé"],
  ["theiere-en-cuivre", "la théière en cuivre"],
  ["bois-d-olivier", "le bois d’olivier"],
  ["ceramique-de-tenes", "la céramique de Ténès"],
  ["burnous-en-laine", "le burnous en laine"],
  ["cuir-de-tlemcen", "le cuir de Tlemcen"],
  ["epices-du-hoggar", "les épices du Hoggar"],
  ["verre-souffle", "le verre soufflé"],
  ["dinanderie", "la dinanderie"],
  ["broderie-de-constantine", "la broderie de Constantine"],
  ["nattes-d-alfa", "les nattes d’alfa"],
  ["tapis-de-ghardaia", "le tapis de Ghardaïa"],
  ["parfums-de-blida", "les parfums de Blida"],
  ["couffins-tresses", "les couffins tressés"],
];

const FILLER_PAGES = PAGE_TOPICS.flatMap(([slug, topic], index) => [
  seedPage({
    id: 3000 + index * 2,
    path: `entretien-${slug}`,
    // Every fifth pair carries a draft, so `?status=draft` has ten rows rather
    // than the five the named pages alone would give it.
    status: index % 5 === 0 ? "draft" : "publish",
    title: `Entretien : ${topic}`,
    body: `Comment nettoyer et conserver ${topic} sans les abîmer.`,
    excerpt: `L’entretien courant, pas à pas.`,
    menuOrder: 0,
    minutes: 30_000 - index * 40,
  }),
  seedPage({
    id: 3001 + index * 2,
    path: `guide-${slug}`,
    title: `Guide d’achat : ${topic}`,
    body: `Ce qu’il faut regarder avant d’acheter ${topic}.`,
    excerpt: `Choisir sans se tromper.`,
    menuOrder: 0,
    minutes: 29_980 - index * 40,
  }),
]);

/**
 * Every page this process can see, with `parent_id` resolved.
 *
 * A second pass rather than a field on the seed: `parent_id` is the *shop's*
 * answer to a `parent_path`, and deriving it from the path map is what keeps the
 * two consistent when a `PATCH` moves a page. A path naming nothing resolves to
 * 0, which is a root page — and is exactly why the API refuses an unresolvable
 * `parent_path` with a 400 rather than creating an orphan.
 */
const PAGE_SEED = (() => {
  const rows = [...NAMED_PAGES, ...FILLER_PAGES];
  const byPath = new Map(rows.map((row) => [row.path, row.id]));
  return rows.map((row) => ({
    ...row,
    parent_id: row.parent_path === "" ? 0 : (byPath.get(row.parent_path) ?? 0),
  }));
})();

/* --------------------------------------------------------------- homepage --- */

/**
 * ── The stored document, and the report that comes out of reading it ─────────
 *
 * **The drop report cannot be provoked through the API**, because the only route
 * that writes this document is the one that refuses to write a bad one:
 * `GET /cms/homepage` drops a malformed section and reports it in `meta.problems`
 * while `PUT` answers a 400. `scripts/seed-cms.mjs` writes the option underneath
 * the API with `wp eval` for exactly that reason, and this array is that option.
 *
 * **Twelve stored entries, three of them malformed, at 1-based positions 2, 4 and
 * 6 — interleaved rather than appended.** That is the whole point of the fixture:
 * the positions in `meta.problems` are 1-based over the **stored** document and
 * not over the sections that survived, so "Section 6" is not the sixth row on
 * screen. With the bad ones appended, every assertion about that distinction
 * would pass vacuously and an off-by-one in the panel would be invisible.
 *
 *   stored  1  hero                     survives, screen row 1
 *   stored  2  a bare string            dropped — "Section 2 is not an object."
 *   stored  3  featured_products        survives, screen row 2
 *   stored  4  type "carousel"          dropped — unknown type
 *   stored  5  categories               survives, screen row 3
 *   stored  6  promotion, data a string dropped — bad data
 *   stored  7-12                        survive, screen rows 4-9
 *
 * Nine survive and three are reported, so no position in the report equals its
 * row on screen.
 */
const HOMEPAGE_STORED = [
  { type: "hero", data: { heading: `Soldes d${RSQUO}été`, image_id: null, cta: "/soldes-d-ete" } },
  "une section écrite à la main",
  { type: "featured_products", data: { product_ids: [101, 104, 201], limit: 3 } },
  { type: "carousel", data: { slides: 4 } },
  { type: "categories", data: { category_ids: [12, 13, 14], columns: 3 } },
  { type: "promotion", data: "livraison offerte" },
  { type: "banner", data: { banner_id: 7301 } },
  { type: "text", data: { html: "<p>Fabriqué en Algérie, expédié depuis Alger.</p>" } },
  { type: "image", data: { image_id: null, alt: "Atelier de tissage" } },
  { type: "faq", data: { category: "livraison", limit: 5 } },
  { type: "testimonials", data: { limit: 3 } },
  { type: "newsletter", data: { heading: "Recevoir les nouveautés" } },
];

/**
 * The eleven section types, and **the only way anybody discovered them**.
 *
 * There is no endpoint that publishes this vocabulary. It was read out of a 400 —
 * `PUT /cms/homepage` with `{"type":"not_a_real_type"}` — and `lib/cms.ts` holds
 * the panel's copy of it with no contract keeping the two in step. `SECTION_LIST`
 * below is the sentence that 400 prints, reproduced verbatim rather than joined
 * from the array with a guessed separator.
 */
const SECTION_TYPES = [
  "hero",
  "featured_products",
  "categories",
  "promotion",
  "banner",
  "text",
  "image",
  "faq",
  "testimonials",
  "newsletter",
  "custom",
];

/**
 * Measured: a 51st section is a **400 on `sections`**, not on `sections[50]`.
 *
 *     {"sections": "A homepage carries at most 50 sections; this one has 51."}
 *
 * Two error paths from one endpoint and only one of them is positional. A form
 * that bound every homepage error to a section index would drop this one on the
 * floor, which is why the fixture has to be able to produce both.
 */
const MAX_SECTIONS = 50;

/**
 * The twelfth type, and why it is behind a switch rather than in the fixture.
 *
 * `unknownSectionTypes()` in `lib/cms.ts` exists because the panel's list of
 * eleven is a *copy* of a constant on the other side of the wire: if the backend
 * gains a twelfth type, the reader returns it and a panel that had not asked
 * would render a blank row. Nothing measured can produce that state — the reader
 * measured on 2026-08-21 **drops** a type it does not know and reports it, so an
 * unknown type arriving intact is a hypothesis about a backend that has moved,
 * not an observation.
 *
 * So it is not the default document. `MOCK_HOMEPAGE=future` serves one section of
 * type `countdown` intact, which is the only way that branch of the editor can be
 * photographed, and the label says plainly what it is. Putting it in the default
 * fixture would have taught the next reader that this API passes unknown types
 * through, which is the opposite of what was measured.
 */
const HOMEPAGE_VARIANTS = {
  /** The seeded document above, malformed sections and all. */
  report: HOMEPAGE_STORED,
  /**
   * `{"sections": []}` — what `GET /cms/homepage` answered on this shop before
   * `scripts/seed-cms.mjs` existed, which is why the homepage editor and its drop
   * report were built against a document with nothing in it. A real measured
   * state, and the one the empty-state capture needs.
   */
  empty: [],
  /** The hypothesis. See above; not a measurement, and never the default. */
  future: [
    HOMEPAGE_STORED[0],
    { type: "countdown", data: { ends_at: "2026-09-01T00:00:00+00:00" } },
    HOMEPAGE_STORED[2],
  ],
};

const REQUESTED_HOMEPAGE = process.env.MOCK_HOMEPAGE ?? "report";
if (!(REQUESTED_HOMEPAGE in HOMEPAGE_VARIANTS)) {
  throw new Error(
    `MOCK_HOMEPAGE must be one of ${Object.keys(HOMEPAGE_VARIANTS).join(", ")} — got "${REQUESTED_HOMEPAGE}".`,
  );
}

/**
 * Read once at module load, like `MOCK_IDENTITY`, so `respond()` stays pure and a
 * capture run is one document from beginning to end.
 */
const HOMEPAGE_SEED = HOMEPAGE_VARIANTS[REQUESTED_HOMEPAGE];

/* ---------------------------------------------------------------- banners --- */

/**
 * `position` is **dense** — 0, 1, 2 across the collection, not sparse and not
 * per-placement — so a reorder swaps two adjacent values rather than rewriting a
 * fractional index, and a new banner appended at `n` is correct.
 *
 * There is **no bulk endpoint**, so a reorder is one `PATCH` per row that
 * actually moved; `positionWrites()` in `lib/cms.ts` is the panel's half of that
 * and the reason both halves of its condition are load-bearing.
 *
 * `placement` is a free key rather than an enum on the API's side, deliberately:
 * where a shop puts a banner is a shop's decision and the plugin is cloned per
 * client. So there is no validation on it here either, and the screen offers the
 * placements it finds in the data plus a free field.
 *
 * **`image` is null on every seeded row**, which is the measured state of this
 * shop and is the common case rather than an empty fixture: a banner without a
 * picture is a banner. The embedded-image shape is reachable through a write —
 * `PATCH {image_id: 5001}` resolves a media row into it — which is the honest way
 * to give `embeddedImage` a fixture without inventing a seeded one.
 */
const BANNER_SEED = [
  {
    id: 7301,
    title: `Soldes d${RSQUO}été`,
    caption: "Jusqu’à −40 % sur les tapis",
    link: "/soldes-d-ete",
    placement: "home_hero",
    status: "publish",
    position: 0,
    image: null,
    date_modified: iso(900),
  },
  {
    id: 7302,
    title: "Nouvelle collection",
    caption: "Céramique de Ténès",
    link: "/categorie/poterie",
    placement: "home_hero",
    status: "draft",
    position: 1,
    image: null,
    date_modified: iso(2_400),
  },
  {
    id: 7303,
    title: "Livraison offerte dès 8 000 DA",
    caption: "",
    link: "/livraison",
    placement: "home_secondary",
    status: "publish",
    position: 2,
    image: null,
    date_modified: iso(6_000),
  },
  {
    id: 7304,
    title: "Artisanat des Aurès",
    caption: "Laine filée et tissée à la main",
    link: "/categorie/textile",
    placement: "category_top",
    status: "publish",
    position: 3,
    image: null,
    date_modified: iso(9_000),
  },
  {
    id: 7305,
    title: "Paiement à la livraison",
    caption: "Dans les 58 wilayas",
    link: "/livraison",
    placement: "category_top",
    status: "draft",
    position: 4,
    image: null,
    date_modified: iso(12_000),
  },
];

/* ------------------------------------------------------------------- FAQs --- */

/**
 * **`count` is present on `/cms/faq-categories` and absent on the category
 * embedded inside an FAQ**, which is one shape published two ways and is why
 * `faqCategory.count` is optional rather than nullable in the panel's schema.
 *
 * A screen that read `category.count` off an FAQ's own categories would get
 * `undefined` and render nothing, silently, on the half of the surface that has
 * the most category objects in it. So the two projections are built from one
 * seed here — `faqCategoryRow()` adds the count, `faqCategoryRef()` does not —
 * rather than written out twice.
 */
const FAQ_CATEGORY_SEED = [
  { id: 8201, slug: "livraison", name: "Livraison", description: "Délais, wilayas et suivi." },
  { id: 8202, slug: "paiement", name: "Paiement", description: "Paiement à la livraison et en ligne." },
  { id: 8203, slug: "retours", name: "Retours", description: "" },
  // No FAQ sits in this one, so its count is 0 — the state a category manager
  // needs in order to see that deleting it is safe.
  { id: 8204, slug: "grossistes", name: "Grossistes", description: "" },
];

/**
 * Five FAQs, dense positions, and three states nothing else in this section has:
 * an FAQ in **two** categories, an FAQ in **none**, and a draft.
 *
 * The Arabic question is the 340px fixture for this list. An FAQ may sit in
 * several categories, which is exactly what the singular `category` field is
 * refused by name for — "Use \"categories\" — an FAQ may sit in more than one."
 * — so the multi-category row is what makes that refusal mean something.
 */
const FAQ_SEED = [
  {
    id: 8101,
    question: "Livrez-vous dans toutes les wilayas ?",
    answer: "<p>Oui, dans les 58 wilayas, à domicile ou au bureau du transporteur.</p>\n",
    categorySlugs: ["livraison"],
    status: "publish",
    position: 0,
    date_modified: iso(1_200),
  },
  {
    id: 8102,
    question: "Puis-je payer à la livraison ?",
    answer: "<p>Oui. Le paiement à la livraison est disponible partout et sans supplément.</p>\n",
    // Two categories: the fixture the plural field exists for.
    categorySlugs: ["paiement", "livraison"],
    status: "publish",
    position: 1,
    date_modified: iso(2_000),
  },
  {
    id: 8103,
    question: LONG_FAQ_QUESTION,
    answer: "<p>نعم، خلال أربعة عشر يوما، شرط أن يكون المنتج في عبوته الأصلية.</p>\n",
    categorySlugs: ["retours"],
    status: "publish",
    position: 2,
    date_modified: iso(3_000),
  },
  {
    // No category at all, which is a legal FAQ and the empty branch of the list.
    id: 8104,
    question: "Proposez-vous des emballages cadeaux ?",
    answer: "<p>Sur demande, à la commande, sans supplément.</p>\n",
    categorySlugs: [],
    status: "publish",
    position: 3,
    date_modified: iso(5_000),
  },
  {
    id: 8105,
    question: "Reprenez-vous un article soldé ?",
    answer: "<p>Un article soldé est repris dans les mêmes conditions qu’un article au prix courant.</p>\n",
    categorySlugs: ["retours"],
    status: "draft",
    position: 4,
    date_modified: iso(8_000),
  },
];

/* ------------------------------------------------------------------ menus --- */

/**
 * ── Two vocabularies for one thing, and the reader publishes the other one ────
 *
 * `CmsPresenter::menu()` has published **WordPress's** shape since §61: `type` is
 * `post_type`/`taxonomy`/`custom` with the real kind under `object`, and the
 * label is `title` rather than `label`. §89 specified the *writer* in the shop's
 * own vocabulary — `type: "page"`, `label` — and `MenuInput` normalises both,
 * because "GET the menu, drag one item, PUT it back" is the only interaction a
 * menu screen has and changing the read shape would break every existing caller.
 *
 * So this seed is in WordPress's vocabulary and `readMenuItems()` accepts either,
 * which is what makes the round trip hold.
 *
 * The last root item is a `post_type`/`post` — a WordPress item this API has no
 * type for — because `kindOf()` in the editor has a fallback branch for exactly
 * that and it would otherwise never run.
 */
const menuItem = (id, title, url, type, object, objectId, position, children = []) => ({
  id,
  title,
  url,
  target: "",
  type,
  object,
  object_id: objectId,
  position,
  classes: [],
  children,
});

const PRIMARY_MENU_ITEMS = [
  menuItem(4180, "Accueil", "https://boutique.example.dz/", "custom", "custom", 0, 0),
  menuItem(4181, "Tapis", "https://boutique.example.dz/categorie/tapis", "taxonomy", "product_cat", 13, 1, [
    menuItem(4182, "Tapis kilim", "https://boutique.example.dz/produit/tapis-kilim", "post_type", "product", 210, 0),
    menuItem(4183, "Tapis de Ghardaïa", "https://boutique.example.dz/guide-tapis-de-ghardaia", "post_type", "page", 3045, 1),
  ]),
  menuItem(4184, `Soldes d${RSQUO}été`, "https://boutique.example.dz/soldes-d-ete", "post_type", "page", 17, 2),
  menuItem(4185, "Conditions générales", "https://boutique.example.dz/legal/conditions-generales", "post_type", "page", 12, 3),
  menuItem(4186, "Instagram", "https://instagram.com/atelier", "custom", "custom", 0, 4),
  menuItem(4187, "Journal de l’atelier", "https://boutique.example.dz/2026/07/atelier", "post_type", "post", 992, 5),
];

/**
 * **`primary` is assigned and `footer` is not**, and the asymmetry is the whole
 * fixture.
 *
 * Measured: `get_nav_menu_locations()` on this install returned `primary` and no
 * `footer`, so `GET /cms/menus/footer` is a **404 with its own message** — "No
 * menu is assigned to that location." — which is a different fact from a location
 * that was never registered, and the screen says which. `PUT` on it then
 * **creates and assigns** the menu, naming it "Footer navigation", so an
 * unassigned location is an empty state with a working action behind it rather
 * than a dead end.
 */
const MENU_SEED = {
  primary: {
    location: "primary",
    id: 4100,
    name: "Navigation principale",
    slug: "navigation-principale",
    items: PRIMARY_MENU_ITEMS,
  },
};

/** Two levels, fifty items. Both are refused above. */
const MAX_MENU_DEPTH = 2;
const MAX_MENU_ITEMS = 50;

/* ------------------------------------------------------------------ media --- */

/**
 * The library, 41 items — the count `GET /media` answered when this was measured.
 *
 * **`sizes` is empty on every row and that is not a shortcut.** The fixtures in
 * this shop are 30×20 pixels, below every threshold at which WordPress generates
 * a thumbnail, so a client that indexed into `sizes[0]` for a list thumbnail
 * would work in production and fail on every test fixture. `url` is the one size
 * that always exists.
 *
 * **`filename` is generated server-side and is a collision suffix, not a
 * rewrite**: `real.jpg` uploaded three times stored `real.jpg`, `real-1.jpg` and
 * `real-2.jpg`, and the extension comes from the *sniffed* type rather than from
 * the name. Rows 0-2 below reproduce that trio — **all three as JPEG**, which is
 * the only way one file uploaded three times could have produced them — so the
 * "show the returned name" rule has something to be right about.
 */
const MEDIA_TYPES = [
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
];

/**
 * ── The tiles are real image bytes, served from this process ─────────────────
 *
 * `url` was `https://boutique.example.dz/wp-content/uploads/…` until this
 * branch — a host that does not resolve, so a grid of 41 tiles photographed as
 * 41 broken boxes and no capture of the screen would have been worth taking.
 * The path shape is kept because it is the shop's; only the **origin** moves to
 * this server, and `/wp-content/uploads/…` is served beside `/__mock/stats` as
 * harness-talking-to-harness rather than through `respond()`.
 *
 * **The dimensions are the measured ones and the bytes are the mock's own.**
 * lib/api/schemas/media.ts records why `sizes` is empty on all 41: the live
 * fixtures are 30×20, below every threshold at which WordPress generates a
 * thumbnail. So these are 30×20 too, which is what keeps `sizes: []` a
 * *consequence* here rather than a shortcut — a fixture at 300×200 would make
 * an empty `sizes` a lie the next reader would have to un-learn.
 *
 * Each is a genuine, complete file of its own format, generated once and
 * verified by decoding it in Chromium (`naturalWidth`/`naturalHeight` and the
 * drawn pixels at two sample points), because "it starts with the right magic
 * bytes" is not the same claim as "a browser renders it":
 *
 *   image/png    95 bytes   truecolour, filter 0, deflated
 *   image/jpeg  191 bytes   baseline, 1×1 sampling, quant tables of all 1s and
 *                           two minimal Huffman tables of this file's own —
 *                           JPEG lets a file define any, and the standard Annex
 *                           K tables carry 162 AC symbols for an image that
 *                           uses one
 *   image/webp  260 bytes   VP8L, no transform, no colour cache, five simple
 *                           prefix codes
 *
 * **The colour is the backend's own**: `tests/Api/media.php`'s `ac_jpeg_bytes()`
 * fills a 30×20 with rgb(190,40,40), so that is what a fixture attachment in
 * this shop looks like. The darker band from y=16 is **invented** and is there
 * for one reason: VP8L's cheapest encoding of a *uniform* image is 32 bytes,
 * under `MIN_BYTES`, so a solid WebP would be a file this API could never have
 * accepted. y=16 is an 8×8 block boundary, which is what lets the JPEG stay
 * flat inside every block and the three formats stay pixel-identical.
 */
const MEDIA_IMAGE_BYTES = {
  "image/png": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAB4AAAAUCAIAAAAVyRqTAAAAJklEQVR42mPYp6FBI8QwavSo0aNG" +
      "jxo9ajQVjZ4mJ0cjNGo0GgIAT/Vcz6Ldo2YAAAAASUVORK5CYII=",
    "base64",
  ),
  "image/jpeg": Buffer.from(
    "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB" +
      "AQEBAQEBAQEBAQEBAQH/wAARCAAUAB4DAREAAhEAAxEA/8QAMgAAAAAMAAAAAAAAAAAAAAAAAAEC" +
      "AwQFBgcICQoLEAACAAAAAAAAAAAAAAAAAAAA8P/aAAwDAQACAAMAAD8AlTkG5UsAAAAAAAAAAAAA" +
      "AAAAAAAAEM41A4cAAAAAAAAA/9k=",
    "base64",
  ),
  "image/webp": Buffer.from(
    "UklGRvwAAABXRUJQVlA4TPAAAAAvHcAEADiKx30tj+LR//j/////////////////////////////" +
      "////////////////////////////////////////////////////////////////////////////" +
      "////////////////////////////////////////////////////////////////////////////" +
      "/////////////////////////////////////////////////////////wcAAAAAAAAAAAAAAAAA" +
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "base64",
  ),
};

/** A PNG chunk, so the megabyte fixture below can be a real megabyte. */
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(
    crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0,
    8 + data.length,
  );
  return out;
}

/**
 * The same PNG, grown to an exact byte count with one `tEXt` chunk.
 *
 * `formatBytes`' `Mo` branch (lib/media.ts:157) had no fixture, and the obvious
 * way to give it one is to write a large number into `filesize`. That would put
 * a figure on screen that disagrees with the bytes behind it — small, invisible,
 * and the class of thing this file exists to not do. A `tEXt` chunk after IHDR
 * is ignored by every decoder and makes the number true instead.
 */
function grownPng(bytes, targetBytes) {
  const filler = Buffer.concat([
    Buffer.from("Comment\0", "latin1"),
    Buffer.alloc(targetBytes - bytes.length - 12 - 8, 0x2e),
  ]);
  // After the 8-byte signature and the 25-byte IHDR chunk.
  return Buffer.concat([bytes.subarray(0, 33), pngChunk("tEXt", filler), bytes.subarray(33)]);
}

/**
 * **The stem `UploadPolicy::storedFilename()` can actually produce at its
 * longest**, which is `MAX_STEM_LENGTH` — 80 — of `[a-z0-9]` with every other
 * character already collapsed to a hyphen. Written without one so it has no
 * break opportunity at all, which is what makes it the 340px fixture for this
 * screen the way `LONG_SKU` is for products.
 */
const LONG_MEDIA_STEM =
  "photographiedelateliercooperatifdetiziouzoulejourdelinaugurationdesnouveauxmetie";

/**
 * A title nobody's filename produced, because `PATCH` writes this field and
 * `MediaInput::MAX_LENGTH` is 500. Spaced rather than unbroken on purpose: it is
 * the *other* wrap, and the row above already carries the unbreakable one.
 */
const LONG_MEDIA_TITLE =
  "Photographie de l’atelier coopératif de Tizi Ouzou, prise le jour de " +
  "l’inauguration des nouveaux métiers à tisser installés au premier étage";

/**
 * **A third timestamp format, and this file had it as the first.**
 *
 * `MediaPresenter` uses `mysql_to_rfc3339()`, which despite the name emits
 * `Y-m-d\TH:i:s` with **no offset at all**. Measured on the live router
 * 2026-08-27: `"2026-08-27T19:52:00"`, on `date_created` and `date_modified`
 * alike. This file emitted `iso()`'s `"…+00:00"`, which is the order's format and
 * not this one.
 *
 * The three the API now demonstrably has:
 *
 *   order.date_created  "2026-08-18T02:52:22+00:00"   ISO with an offset
 *   note.created_at     "2026-08-18 02:52:22"         no offset, no `T`
 *   media.date_created  "2026-08-18T02:52:22"         no offset, **with** a `T`
 *
 * `parseApiDate()` reads all three correctly — it appends `Z` to anything with no
 * zone — but `new Date()` on the third silently shifts by the host's offset, and
 * a mock that emitted an offset here would let a media screen skip
 * `parseApiDate()` and look right doing it. Which is the whole argument
 * lib/format/date.ts already makes about the second.
 */
const mediaStamp = (minutesAgo) => iso(minutesAgo).replace("+00:00", "");

/**
 * The uploads directory this shop writes into, kept from the measured URL — only
 * its origin moved. WordPress files by year and month; the fixtures are all from
 * the month the library was measured.
 */
const MEDIA_UPLOAD_PATH = "/wp-content/uploads/2026/08";

/**
 * `filename` → the bytes `/wp-content/uploads/…` answers with.
 *
 * Keyed on the filename because that is what the URL carries, which makes a
 * collision between two rows silent — one tile would quietly serve another's
 * picture. `wp_unique_filename()` is what makes that impossible at the shop, so
 * it is checked below rather than assumed: the 41 stems repeat every 25 and the
 * extensions every 3, and 38 rows is short of the 75 where the two would meet.
 */
const MEDIA_FIXTURE_BYTES = new Map();

const MEDIA_LIBRARY = [];

for (let index = 0; index < 41; index += 1) {
  /*
   * **Rows 0-2 are all JPEG, and that is the measurement rather than the
   * rotation.** `real.jpg` uploaded three times stored `real.jpg`, `real-1.jpg`
   * and `real-2.jpg` — one file, three collisions, one extension. This loop
   * rotated the three accepted types through them until the media branch, which
   * produced `real-1.png` and `real-2.webp`: a trio no sequence of uploads could
   * have made, sitting under a docblock claiming to reproduce one that did.
   * Everything from index 3 rotates, so all three types are still in the library.
   */
  const [mime, extension] = index < 3 ? MEDIA_TYPES[0] : MEDIA_TYPES[index % 3];
  // The measured collision trio, then one file per subject — and one deliberately
  // awful name, which is the longest one this API can store.
  const base =
    index < 3
      ? "real"
      : index === 18
        ? LONG_MEDIA_STEM
        : PAGE_TOPICS[index % PAGE_TOPICS.length][0];
  const suffix = index < 3 ? (index === 0 ? "" : `-${index}`) : "";
  const filename = `${base}${suffix}.${extension}`;

  /*
   * `filesize` is the length of what `/wp-content/uploads/…` actually answers
   * for this row, never a decorative number. Row 31 is grown to 1.2 MB so
   * `formatBytes`' `Mo` branch has a fixture and the file behind it is really
   * that large.
   */
  const bytes =
    index === 31 ? grownPng(MEDIA_IMAGE_BYTES[mime], 1_258_291) : MEDIA_IMAGE_BYTES[mime];
  MEDIA_FIXTURE_BYTES.set(filename, { mime, bytes });

  MEDIA_LIBRARY.push({
    id: 5001 + index,
    title:
      index < 3
        ? "Photo d’atelier"
        : index === 18
          ? // What `MediaRepository::titleFrom()` makes of the stem above: the
            // stored name minus its extension, with hyphens and underscores as
            // spaces. There are none in it, so the title is the same unbroken run.
            LONG_MEDIA_STEM
          : index === 25
            ? LONG_MEDIA_TITLE
            : `Photo — ${PAGE_TOPICS[index % PAGE_TOPICS.length][1]}`,
    slug: `${base}${suffix}`,
    // One row with no alt text at all, because that is a real attachment and the
    // grid has to say so rather than render an empty caption.
    alt: index === 7 ? "" : `Gros plan sur ${PAGE_TOPICS[index % PAGE_TOPICS.length][1]}`,
    caption: index % 4 === 0 ? "" : "Atelier de Tizi Ouzou, 2026",
    mime_type: mime,
    url: `${MOCK_ORIGIN}${MEDIA_UPLOAD_PATH}/${filename}`,
    filename,
    filesize: bytes.length,
    // 30×20, which is why `sizes` is empty on all 41.
    width: 30,
    height: 20,
    sizes: [],
    // One row whose uploader WordPress no longer knows, because the schema allows
    // it and there is no route that turns the number into a name either way.
    uploaded_by: index === 12 ? null : 514,
    date_created: mediaStamp(20_000 - index * 120),
    date_modified: mediaStamp(20_000 - index * 120),
  });
}

if (MEDIA_FIXTURE_BYTES.size !== MEDIA_LIBRARY.length) {
  throw new Error("two media fixtures share a filename, so one would serve the other's bytes");
}

/**
 * **An empty library, and it is reachable no other way.**
 *
 * The screen takes no parameters — no search, no filter, no sort — so unlike
 * every list in the panel there is no request that empties it. Same argument
 * `MOCK_HOMEPAGE` makes for the homepage document, and the same shape: read once
 * at module load, a whole run rather than a per-capture switch, so `respond()`
 * stays pure.
 *
 * It empties more than the library. `MediaPicker` inside the banner sheet reads
 * this collection and `mustBeMediaId` validates against it, so `MOCK_MEDIA=empty`
 * is also the only way to photograph a picker with nothing to pick — and a
 * `PATCH /cms/banners/{id} {"image_id": 5001}` under it is a 400, correctly,
 * because no attachment with that id exists in that world.
 */
const MEDIA_VARIANTS = {
  library: MEDIA_LIBRARY,
  empty: [],
};

const REQUESTED_MEDIA = process.env.MOCK_MEDIA ?? "library";
if (!(REQUESTED_MEDIA in MEDIA_VARIANTS)) {
  throw new Error(
    `MOCK_MEDIA must be one of ${Object.keys(MEDIA_VARIANTS).join(", ")} — got "${REQUESTED_MEDIA}".`,
  );
}

const MEDIA_SEED = MEDIA_VARIANTS[REQUESTED_MEDIA];

/*
 * The bytes follow the variant. An empty library has no files behind it, so
 * `/wp-content/uploads/…` must 404 rather than answer for an attachment that
 * does not exist — and `uniqueMediaFilename()` must not dodge a name nothing
 * holds, or the first upload into an empty shop would come back `real-3.jpg`.
 */
for (const filename of [...MEDIA_FIXTURE_BYTES.keys()]) {
  if (!MEDIA_SEED.some((row) => row.filename === filename)) MEDIA_FIXTURE_BYTES.delete(filename);
}

/* ------------------------------------------------------------- marketing --- */

/**
 * ── Five campaigns: four measured verbatim, one constructed and said so ──────
 *
 * Measured against the live shop 2026-08-28 with `ac_super_admin`. Names,
 * subjects, bodies, audiences, statuses, the counts and the relative order of
 * every stamp are the shop's; the stamps themselves are rebased onto this file's
 * `EPOCH`, since every other fixture here is relative to it and a screenshot of
 * "il y a 3 jours" has to stay stable.
 *
 * **The stamps are the whole sort control, so they are written out rather than
 * derived.** `/campaigns` is the strongest sort in the panel — four fields, both
 * directions, and a validator that refuses garbage — and DECISIONS.md's rule is
 * that a sort ships only against a sequence the *default* ordering cannot
 * produce. These five ids answer five distinct sequences:
 *
 *   default / created_at desc / id desc   [322, 321, 320, 319, 318]
 *   created_at asc                        [319, 318, 320, 321, 322]
 *   updated_at asc                        [320, 322, 321, 318, 319]
 *   updated_at desc                       [319, 318, 321, 322, 320]
 *   name asc                              [321, 320, 319, 322, 318]
 *   name desc                             [318, 322, 319, 320, 321]
 *   id asc                                [318, 319, 320, 321, 322]
 *
 * `created_at desc` and `id desc` agreeing with the bare listing is the live
 * shop's own property and is reproduced deliberately: it is exactly the coupons
 * `date` trap, and a screen that proves its sort with either of those two has
 * proved nothing. `name` and `updated_at` are the fields that can discriminate.
 *
 * **318 and 319 tie on `created_at`**, as they do live — both were seeded in the
 * same second — and the measured tie-break is **id descending** in *both*
 * directions (`created_at asc` answers 319 before 318, and so does `desc`). That
 * is the opposite of what `/segments` does with its own ties, which is why
 * neither collection's tie-break is written as a shared rule below.
 *
 * **321 is constructed, not measured.** No live campaign is in `sending`: the
 * status exists for the window between `send` and the drain finishing, and the
 * seeded shop has never been caught inside one. Every value on it is read off
 * rules the API publishes rather than invented — `is_editable: false` because
 * only a draft is editable, `allowed_transitions: ["cancelled"]` because the
 * state machine is draft → sending → sent with `cancelled` reachable from the
 * first two, `claimed_at` set because `send` claimed it and `completed_at` null
 * because nothing has finished. It exists because the status filter offers a
 * `sending` tab, `CAMPAIGN_TONE.sending` is the panel's only accent-toned status,
 * and `pending` recipients live nowhere else — all three were unphotographable
 * without it.
 */
const CAMPAIGN_AUTHOR = 475; // a colleague, not the harness identity — measured

const campaignRow = ({
  id,
  name,
  subject,
  body_html,
  body_text,
  audience,
  status,
  is_editable,
  allowed_transitions,
  recipients,
  created,
  updated,
  claimed = null,
  completed = null,
}) => ({
  id,
  name,
  subject,
  /** 0 on every seeded campaign: each carries its own body rather than a template. */
  template_id: 0,
  body_html,
  body_text,
  audience,
  status,
  is_editable,
  allowed_transitions,
  recipients: { ...recipients, purged: false },
  created_by: CAMPAIGN_AUTHOR,
  created_at: iso(created),
  updated_at: iso(updated),
  claimed_at: claimed === null ? null : iso(claimed),
  completed_at: completed === null ? null : iso(completed),
});

const CAMPAIGN_SEED = [
  campaignRow({
    id: 318,
    name: "Soldes d'août — brouillon",
    subject: "{{shop_name}} — test du composeur, {{first_name}}",
    body_html: "<p>Bonjour {{first_name}},</p>\n<p>Nos soldes commencent aujourd'hui.</p>",
    body_text: "Bonjour {{first_name}},\n\nNos soldes commencent aujourd'hui.",
    audience: { type: "segment", segment_id: 43, customer_ids: [] },
    status: "draft",
    is_editable: true,
    allowed_transitions: ["sending", "cancelled"],
    recipients: { total: 0, sent: 0, failed: 0 },
    created: 4320,
    updated: 1440,
  }),
  /*
   * **The typo row, and the reason the composer has a preview step.**
   * `{{firstname}}` is not `{{first_name}}`, an unknown token renders *empty*,
   * and `<p>Bonjour ,</p>` is easy to skim past — lib/campaigns.ts:160-173. Its
   * preview below carries `unknown_tokens: ["firstname"]`, measured on this
   * exact campaign.
   */
  campaignRow({
    id: 319,
    name: "Relance panier — brouillon",
    subject: "{{shop_name}} — votre panier",
    body_html: "<p>Bonjour {{firstname}},</p>\n<p>Votre panier vous attend.</p>",
    body_text: "Bonjour {{firstname}},\n\nVotre panier vous attend.",
    audience: { type: "all", segment_id: 0, customer_ids: [] },
    status: "draft",
    is_editable: true,
    allowed_transitions: ["sending", "cancelled"],
    recipients: { total: 0, sent: 0, failed: 0 },
    created: 4320,
    updated: 1400,
  }),
  /*
   * Cancelled, and it **never sent anything** — `claimed_at` null with a
   * `completed_at` equal to its `updated_at`, which is the shape the live row
   * has. A cancelled campaign is neutral-toned rather than danger-toned
   * (lib/campaigns.ts:33-49): somebody chose it.
   */
  campaignRow({
    id: 320,
    name: "Ramadan — annulée",
    subject: "{{shop_name}}",
    body_html: "<p>Bonjour {{first_name}},</p>",
    body_text: "Bonjour {{first_name}},",
    audience: { type: "segment", segment_id: 44, customer_ids: [] },
    status: "cancelled",
    is_editable: false,
    allowed_transitions: [],
    recipients: { total: 0, sent: 0, failed: 0 },
    created: 4319,
    updated: 4319,
    completed: 4319,
  }),
  campaignRow({
    id: 321,
    name: "Nouveautés — en cours d'envoi",
    subject: "{{shop_name}} — les nouveautés, {{first_name}}",
    body_html: "<p>Bonjour {{first_name}},</p>\n<p>Nos nouveautés sont en ligne.</p>",
    body_text: "Bonjour {{first_name}},\n\nNos nouveautés sont en ligne.",
    audience: { type: "segment", segment_id: 45, customer_ids: [] },
    status: "sending",
    is_editable: false,
    allowed_transitions: ["cancelled"],
    recipients: { total: 6, sent: 2, failed: 0 },
    created: 2880,
    updated: 2870,
    claimed: 2870,
  }),
  /*
   * The sent one, and **the counts are stored columns rather than a query** —
   * §85 keeps them so they survive the purge. 9 = 5 + 4 exactly, which is what
   * the recipient rows below add up to; they are allowed to disagree only after
   * a purge, and `purged` is false on every row here.
   */
  campaignRow({
    id: 322,
    name: "Rentrée — envoyée",
    subject: "{{shop_name}} — la rentrée, {{first_name}}",
    body_html: "<p>Bonjour {{first_name}},</p>\n<p>Notre sélection de rentrée est en ligne.</p>",
    body_text: "Bonjour {{first_name}},\n\nNotre sélection de rentrée est en ligne.",
    audience: { type: "all", segment_id: 0, customer_ids: [] },
    status: "sent",
    is_editable: false,
    allowed_transitions: [],
    recipients: { total: 9, sent: 5, failed: 4 },
    created: 2875,
    updated: 2874,
    claimed: 2875,
    completed: 2874,
  }),
];

/**
 * ── The four segments, and the tie that has to stay ─────────────────────────
 *
 * All four share **one** `created_at` and **one** `updated_at`, exactly as the
 * live shop does — they were seeded in a single pass. So `?orderby=created_at`
 * and `?orderby=updated_at` are accepted, validated, honoured, and **answer the
 * same sequence in both directions**, which is the coupons `date` trap made
 * permanent: two of this collection's four sort values cannot discriminate at
 * all, and a screen that proved its sort with one of them proved nothing.
 *
 * Do not give these rows distinct stamps to "make the sort testable". The
 * untestability is the fixture.
 *
 * **And the measured tie-break here is id *ascending*** — `created_at asc` and
 * `created_at desc` both answer [43, 44, 45, 46] — where `/campaigns` breaks its
 * own tie by id *descending*. Two collections, two behaviours, both measured on
 * the same day; neither is written as a shared rule because neither is one.
 *
 * `name asc` is the default and is the one sequence that discriminates:
 * [46, 44, 43, 45]. Note 44 "Clients à plus…" before 43 "Clients avec…" — the
 * collation is accent-insensitive, so `à` folds to `a` and sorts before `v`.
 */
const SEGMENT_AUTHOR = CAMPAIGN_AUTHOR;
const SEGMENT_CREATED = 4321;
const SEGMENT_UPDATED = 4318;

const segmentRow = (id, name, criteria) => ({
  id,
  name,
  /** Empty on all four, live. The panel must render a segment with no description. */
  description: "",
  criteria,
  is_resolvable: true,
  created_by: SEGMENT_AUTHOR,
  created_at: iso(SEGMENT_CREATED),
  updated_at: iso(SEGMENT_UPDATED),
});

const SEGMENT_SEED = [
  segmentRow(43, "Clients avec commande", { min_orders: 1 }),
  segmentRow(44, "Clients à plus de 10 000 DA", { min_spent: "10000.00" }),
  segmentRow(45, "Inscrits depuis 2026", { registered_after: "2026-01-01" }),
  segmentRow(46, "Alger, expédiés", { wilaya_id: 16 }),
];

/**
 * `GET /segments/{id}/preview` — the counts, measured on the live shop.
 *
 * **46 matches 0 and that is correct behaviour, not a broken filter.**
 * `wilaya_id` comes off the *shipment* rather than off the address, so an order
 * nobody has shipped has no wilaya and cannot match — lib/campaigns.ts:336-345
 * records the measurement and says the criteria form has to explain it beside
 * the field. A fixture where every segment matched somebody would leave that
 * sentence with nothing to be about.
 *
 * **These are the live shop's numbers and are not recomputed from this file's
 * customers.** `min_spent` needs order totals and `registered_after` needs
 * registration dates, and inventing a resolver here would be this file
 * answering a question only the server can answer. The one relationship that is
 * load-bearing — a segment that matches nobody, beside three that match
 * somebody — is preserved.
 */
const SEGMENT_MATCHES = new Map([
  [43, 7],
  [44, 7],
  [45, 8],
  [46, 0],
]);

/**
 * The API's own English, never rendered. Measured verbatim; the panel shows a
 * translated sentence of its own, which is the rule the analytics branch set for
 * every English string this API sends.
 */
const SEGMENT_PREVIEW_NOTE = "Only customers who have given marketing consent are counted.";

/**
 * ── The frozen recipients, and the two conventions on one row ───────────────
 *
 * **`last_error` and `sent_at` are empty strings here, never null.**
 * `CampaignService::recipientList()` stringifies both where the notification
 * queue nulls them, so `row.sent_at !== null` is true on every row in this list
 * and only emptiness tells a sent one from a pending one — lib/campaigns.ts:
 * 216-227.
 *
 * **And `sent_at` has no offset** — `"2026-08-15 03:04:22"`, no `T` — where the
 * campaign's own `created_at` has one. That is `stamp()`, the third route in
 * this file to use that notation, and it is the `notes[].created_at` trap one
 * table over: `new Date()` reads it as local time and is silently wrong by the
 * host's offset.
 *
 * The addresses are **this file's own customers** rather than the live shop's,
 * so a `customer_id` on a recipient row resolves to a row `/customers` really
 * serves. 25 carries `LONG_EMAIL` — the 80-character unbroken address the 340px
 * overflow assertion needs — and it is on a **failed** row, so the widest string
 * in the list sits in the same cell as the error text.
 */
const MAIL_ERROR = "wp_mail() did not accept the message.";

const recipientRow = (id, customerIndex, status, minutesAgo) => {
  const customer = CUSTOMERS[customerIndex];
  return {
    id,
    customer_id: customer.id,
    email: customer.email,
    status,
    // Measured: a sent row carries 0 attempts and a failed one carries 3.
    attempts: status === "failed" ? 3 : 0,
    last_error: status === "failed" ? MAIL_ERROR : "",
    sent_at: status === "sent" ? stamp(minutesAgo) : "",
  };
};

const RECIPIENT_SEED = new Map([
  [
    322,
    [
      recipientRow(348, 0, "sent", 2874),
      recipientRow(349, 1, "sent", 2874),
      recipientRow(350, 2, "sent", 2874),
      recipientRow(351, 3, "sent", 2874),
      recipientRow(352, 4, "sent", 2874),
      recipientRow(353, 5, "failed", 0),
      recipientRow(354, 6, "failed", 0),
      recipientRow(355, 7, "failed", 0),
      recipientRow(356, 8, "failed", 0),
    ],
  ],
  /*
   * The campaign still draining: two addresses taken, four still queued. This is
   * the only place a `pending` recipient exists, and `RECIPIENT_TONE.pending` is
   * unphotographable without it.
   */
  [
    321,
    [
      recipientRow(360, 9, "sent", 2870),
      recipientRow(361, 10, "sent", 2870),
      recipientRow(362, 11, "pending", 0),
      recipientRow(363, 12, "pending", 0),
      recipientRow(364, 13, "pending", 0),
      recipientRow(365, 14, "pending", 0),
    ],
  ],
]);

/**
 * ── `MOCK_SEND_PROGRESS`, and the two things it has to be at once ────────────
 *
 * Campaign 321 is the only `sending` row in the fixture, and until 2026-08-28 its
 * counts were **static**: `{total: 6, sent: 2, failed: 0}` on every read forever,
 * so a panel polling a draining campaign could never be shown to observe
 * anything, and neither could a test of it.
 *
 * Two requirements pull in opposite directions and both are real:
 *
 *   **Default captures must stay byte-stable.** The header's first promise is
 *   that this file is seeded and deterministic so screenshots are stable. Counts
 *   that advanced on every request would make every future marketing capture
 *   differ from the last, and the drift would be invisible until a diff.
 *
 *   **Movement must be observable** — by an e2e test watching a poll, and by a
 *   capture that wants a *mid-send* state rather than the resting one.
 *
 * One variable, two forms, because one form cannot serve both:
 *
 *     node scripts/capture.mjs /marketing/campaigns/321       2 of 6 — the default
 *     MOCK_SEND_PROGRESS=3 node scripts/capture.mjs …         4 sent, 1 failed, 1 queued
 *     MOCK_SEND_PROGRESS=tick node scripts/mock-api.mjs       advances per read
 *
 * **A number is a *seed offset*, applied once in `resetState()` and then frozen.**
 * So `MOCK_SEND_PROGRESS=3` is as deterministic as the default is — every read in
 * that run answers the same counts, and two runs at the same value are
 * byte-identical. That is the form a capture uses; `tick` is not, and a capture
 * must never be taken under it. It is a seed offset rather than a one-off mutation
 * precisely so the unit suite's `resetState()` between tests restores it.
 *
 * **`tick` advances one recipient per `GET /campaigns/{id}`**, which is the read a
 * polling panel makes. Under it the collection and the detail can answer
 * different counts for the same campaign — and that is what a draining campaign
 * *is*, two reads at two moments, rather than a break in the "value-identical to
 * the list row" property §15 records. The property is about shape; nothing here
 * adds or drops a key.
 *
 * The advance is faithful to what a drain does, and the invariants are asserted
 * in `tests/mock-api.test.ts`:
 *
 *   - a row moves `pending` → `sent` or `failed`, and never the other way
 *   - `total` never changes, and `sent + failed <= total` at every step
 *   - `GET /campaigns/321/recipients?status=pending` is served from the same
 *     rows the counts are computed from, so the two cannot disagree — the panel
 *     reads both and a screen built on them must not be able to show 4 queued
 *     over a campaign claiming 6 of 6 done
 *   - the last step **completes** the campaign: `status` becomes `sent`,
 *     `completed_at` is stamped, `allowed_transitions` empties and `is_editable`
 *     stays false — the shape live campaign 322 has. That transition is
 *     **inferred rather than measured**, and flagged here for the reason
 *     `sendCampaign`'s 409 sentence is: leaving a campaign `sending` with nothing
 *     left to send would be a state the drain cannot produce either, so there was
 *     no honest third option, but nobody has watched this shop finish a send.
 *
 * **The per-row outcome is fixed by recipient id rather than drawn**, so the
 * sequence is the same in every process. One of the four fails, because a
 * `failed` row mid-send is otherwise unreachable — today `failed` exists only on
 * 322, which is already `sent`, so a screen showing failures *during* a send had
 * no fixture. `attempts: 3` and the `wp_mail()` sentence come with it, the same
 * pair `recipientRow` writes.
 */
const SENDING_CAMPAIGN_ID = 321;

const DRAIN_OUTCOME = new Map([
  [362, "sent"],
  [363, "failed"],
  [364, "sent"],
  [365, "sent"],
]);

/** The pending rows 321 starts with — the ceiling on the numeric form. */
const DRAIN_STEPS = DRAIN_OUTCOME.size;

const REQUESTED_SEND_PROGRESS = process.env.MOCK_SEND_PROGRESS ?? "0";

/** True only under the `tick` form; the numeric form is applied in `resetState()`. */
const SEND_PROGRESS_TICKING = REQUESTED_SEND_PROGRESS === "tick";

const SEND_PROGRESS_STEPS = SEND_PROGRESS_TICKING ? 0 : Number(REQUESTED_SEND_PROGRESS);

// Validated against a stated range like `MOCK_IDENTITY` and `MOCK_MEDIA` are
// against their key sets — a typo is a startup failure naming what was allowed,
// never a silent fall back to the resting fixture.
if (
  !SEND_PROGRESS_TICKING &&
  (!Number.isInteger(SEND_PROGRESS_STEPS) ||
    SEND_PROGRESS_STEPS < 0 ||
    SEND_PROGRESS_STEPS > DRAIN_STEPS)
) {
  throw new Error(
    `MOCK_SEND_PROGRESS must be "tick" or an integer 0-${DRAIN_STEPS} — got "${REQUESTED_SEND_PROGRESS}".`,
  );
}

/**
 * The recipient rows as they read now — the seed until a drain step has rewritten
 * them. Hoisted, because `resetState()` runs some two thousand lines below and
 * calls into this.
 */
function recipientsOf(campaignId) {
  return state.recipients.get(campaignId) ?? RECIPIENT_SEED.get(campaignId) ?? [];
}

/**
 * One drain step on one campaign: the first still-pending recipient is taken, and
 * the campaign's stored counts are recomputed **from the rows** rather than
 * incremented, so the two cannot drift apart. Returns the campaign as it now
 * reads; a campaign with nothing pending is returned untouched.
 */
function advanceSend(campaign) {
  const rows = recipientsOf(campaign.id);
  const index = rows.findIndex((row) => row.status === "pending");
  if (index === -1) return campaign;

  const status = DRAIN_OUTCOME.get(rows[index].id) ?? "sent";
  const next = [...rows];
  next[index] = {
    ...rows[index],
    status,
    // The same two conventions `recipientRow` writes: empty strings, never null.
    attempts: status === "failed" ? 3 : 0,
    last_error: status === "failed" ? MAIL_ERROR : "",
    sent_at: status === "sent" ? stamp(0) : "",
  };
  state.recipients.set(campaign.id, next);

  const sent = next.filter((row) => row.status === "sent").length;
  const failed = next.filter((row) => row.status === "failed").length;
  const finished = sent + failed === campaign.recipients.total;

  const updated = {
    ...campaign,
    recipients: { ...campaign.recipients, sent, failed },
    ...(finished
      ? {
          status: "sent",
          is_editable: false,
          allowed_transitions: [],
          completed_at: iso(0),
        }
      : {}),
  };
  state.campaigns.set(campaign.id, updated);
  return updated;
}

/**
 * The numeric form, applied to the seeded `sending` campaign as part of the
 * baseline. Called from `resetState()` rather than once at module load, so a unit
 * test that resets between cases gets the offset back rather than losing it.
 */
function applySeededSendProgress() {
  if (SEND_PROGRESS_TICKING) return;
  const seeded = CAMPAIGN_SEED.find((row) => row.id === SENDING_CAMPAIGN_ID);
  if (seeded === undefined) return;

  let row = seeded;
  for (let step = 0; step < SEND_PROGRESS_STEPS; step += 1) row = advanceSend(row);
}

/**
 * `GET /campaigns/{id}/preview`, measured on 318 and 319.
 *
 * Three things this reproduces and one it cannot. `subject`, `html` and `text`
 * come back with the tokens **resolved**; `unsubscribe_appended` is true on
 * every seeded body because none of them writes `{{unsubscribe_url}}`, and that
 * is the API adding one rather than a body missing one — lib/campaigns.ts:
 * 188-198 says the screen must read it as "we added one".
 *
 * **`audience_count` is null for a caller who cannot count customers**, which is
 * `canSendCampaigns()` showing through on a route that is otherwise a Marketing
 * Manager's. Measured 2026-08-28 with an `ac_marketing_manager` credential: the
 * HTML and the text come back, `audience_count` is `null`, and it is null rather
 * than absent or zero. `MOCK_IDENTITY=no_customers` is the credential that
 * reaches it here.
 *
 * What it cannot reproduce: the *rendering*. These strings are the live shop's
 * output for these exact bodies rather than a token renderer written here — a
 * second renderer would be a second contract, and it would drift.
 */
const UNSUBSCRIBE_URL =
  "http://127.0.0.1:8099/wp-json/algerian-commerce/v1/marketing/unsubscribe?token=sample";

const SAMPLE_RECIPIENT = {
  customer_name: "Amina Belkacem",
  first_name: "Amina",
  shop_name: "Algerian Commerce",
  order_number: "1234",
  unsubscribe_url: UNSUBSCRIBE_URL,
};

const appendedHtml = (html) =>
  `${html}\n<p style="font-size:12px;color:#666"><a href="${UNSUBSCRIBE_URL}">Unsubscribe</a></p>\n`;

const appendedText = (text) => `${text}\n\nUnsubscribe: ${UNSUBSCRIBE_URL}\n`;

const CAMPAIGN_PREVIEW_SEED = new Map([
  [
    318,
    {
      subject: "Algerian Commerce — test du composeur, Amina",
      html: appendedHtml("<p>Bonjour Amina,</p>\n<p>Nos soldes commencent aujourd'hui.</p>"),
      text: appendedText("Bonjour Amina,\n\nNos soldes commencent aujourd'hui."),
      unknown_tokens: [],
      audience_count: 7,
    },
  ],
  [
    319,
    {
      subject: "Algerian Commerce — votre panier",
      // `{{firstname}}` rendered empty, which is the whole point of the row.
      html: appendedHtml("<p>Bonjour ,</p>\n<p>Votre panier vous attend.</p>"),
      text: appendedText("Bonjour ,\n\nVotre panier vous attend."),
      unknown_tokens: ["firstname"],
      audience_count: 8,
    },
  ],
  [
    321,
    {
      subject: "Algerian Commerce — les nouveautés, Amina",
      html: appendedHtml("<p>Bonjour Amina,</p>\n<p>Nos nouveautés sont en ligne.</p>"),
      text: appendedText("Bonjour Amina,\n\nNos nouveautés sont en ligne."),
      unknown_tokens: [],
      audience_count: 6,
    },
  ],
  [
    320,
    {
      subject: "Algerian Commerce",
      html: appendedHtml("<p>Bonjour Amina,</p>"),
      text: appendedText("Bonjour Amina,"),
      unknown_tokens: [],
      audience_count: 7,
    },
  ],
  [
    322,
    {
      subject: "Algerian Commerce — la rentrée, Amina",
      html: appendedHtml("<p>Bonjour Amina,</p>\n<p>Notre sélection de rentrée est en ligne.</p>"),
      text: appendedText("Bonjour Amina,\n\nNotre sélection de rentrée est en ligne."),
      unknown_tokens: [],
      audience_count: 8,
    },
  ],
]);

/**
 * ── Three email templates, and the one that makes the screen worth having ────
 *
 * Read-only through this API: §85 makes a template an `ac_email_template` post
 * authored in wp-admin, where the revisions and the media library already are,
 * so there is no write of any kind and lib/api/allowlist.ts:361-362 carries only
 * the two GETs.
 *
 * **4652 is the row the screen exists for.** It carries `unknown_tokens:
 * ["firstname", "prenom"]` — two typos in one body, one of them a French word a
 * person would reasonably expect to work — *and* `has_unsubscribe_token: false`.
 * The second is **not** a warning: the API appends an unsubscribe link when the
 * body has none, so a screen that flagged it as missing would be inventing a
 * problem. 4650 is the control, carrying the token itself. 4651 carries neither
 * a typo nor the token, which is the ordinary case.
 *
 * The order is the live shop's — `name` ascending, so 4652 sits between 4650 and
 * 4651 — and it is a fixed order rather than a sort, because the route takes no
 * `orderby` at all.
 */
const EMAIL_TEMPLATE_SEED = [
  {
    id: 4650,
    name: "Bienvenue",
    subject: "{{shop_name}} — bienvenue {{first_name}}",
    status: "publish",
    body_html:
      "<p>Bonjour {{first_name}},</p>\n<p>Merci d'avoir créé un compte chez {{shop_name}}.</p>\n" +
      '<p><a href="{{unsubscribe_url}}">Se désabonner</a></p>',
    body_text:
      "Bonjour {{first_name}},\n\nMerci d'avoir créé un compte chez {{shop_name}}.\n\n" +
      "Se désabonner : {{unsubscribe_url}}",
    unknown_tokens: [],
    has_unsubscribe_token: true,
    modified_at: iso(4318),
  },
  {
    id: 4652,
    name: "Relance panier (avec une coquille)",
    subject: "{{shop_name}} — votre panier vous attend",
    status: "publish",
    body_html: "<p>Bonjour {{firstname}},</p>\n<p>Votre panier vous attend, {{prenom}}.</p>",
    body_text: "Bonjour {{firstname}},\n\nVotre panier vous attend, {{prenom}}.",
    unknown_tokens: ["firstname", "prenom"],
    has_unsubscribe_token: false,
    modified_at: iso(4318),
  },
  {
    id: 4651,
    name: "Soldes",
    subject: "{{shop_name}} — nos soldes commencent",
    status: "publish",
    body_html: "<p>Bonjour {{first_name}},</p>\n<p>Nos soldes commencent aujourd'hui.</p>",
    body_text: "Bonjour {{first_name}},\n\nNos soldes commencent aujourd'hui.",
    unknown_tokens: [],
    has_unsubscribe_token: false,
    modified_at: iso(4318),
  },
];

/**
 * `GET /marketing/config` — and **the screen's main state is a disabled one**.
 *
 * Measured verbatim: the integration is off and there are no providers, on this
 * shop and on the one the panel is built against. So the config screen's ordinary
 * rendering is "nothing is configured", and a fixture with a live pixel in it
 * would make the state every reader will actually see the unreachable one.
 *
 * The Conversions API token appears in no response ever, which is the property
 * the screen states rather than displays. The two event lists are what the
 * storefront reports and what the backend sends server-side; the panel sends
 * neither and only names them.
 */
const MARKETING_CONFIG = {
  enabled: false,
  providers: [],
  browser_events: [
    "PageView",
    "ViewContent",
    "Search",
    "AddToCart",
    "InitiateCheckout",
    "Purchase",
  ],
  server_events: ["Purchase", "InitiateCheckout"],
};

/* ------------------------------------------------------------------ staff --- */

/**
 * ── `GET /roles`: seven rows, and the eighth role is deliberately absent ─────
 *
 * Measured live 2026-08-29 with `ac_panel_super_admin`, byte-for-byte against
 * `RolePresenter::all()` — which reads `Capabilities::roles()` on every request,
 * so this table is the *matrix* rather than what WordPress happens to have
 * stored.
 *
 * **`administrator` is not here and `?role=administrator` returns two accounts.**
 * That asymmetry is load-bearing and must not be tidied: `UserRoles::staff()` is
 * the seven **plus** `administrator`, so the role *filter* reaches a role the
 * role *list* does not describe. `roleLabel()` (lib/staff.ts:63) exists for
 * exactly that gap — it falls through to the row's own `role_name`, which is the
 * bare slug `"administrator"` on those two. A mock that helpfully added an eighth
 * row here would make that fallback unreachable and let a screen ship having
 * never rendered it.
 *
 * **Two of the seven are `assignable` and five are retired.** Not deleted:
 * `UserRoles::assignable()` narrows what may be *granted* while `managed()` stays
 * §45's seven, because 50 of the 69 accounts below still hold one of the five.
 * A picker filters on the flag; a label reads the whole list.
 *
 * The envelope is `enumeration()` — **no `meta` key at all**, measured on the
 * same request. `UserController::roles()` calls `Response::success()` with no
 * pagination, and `Response::successPayload()` omits an empty `meta`. This file
 * has been wrong about exactly this before (see `list()`'s docblock), so it was
 * diffed rather than assumed.
 */
const ROLE_MATRIX = [
  ["ac_super_admin", "Super Admin", true, [
    "ac_manage_products", "ac_manage_inventory", "ac_manage_orders", "ac_manage_customers",
    "ac_manage_coupons", "ac_manage_content", "ac_manage_marketing", "ac_view_analytics",
    "ac_manage_shipping", "ac_manage_payments", "ac_manage_settings", "ac_manage_users",
    "ac_view_audit_logs",
  ]],
  ["ac_admin", "Admin", false, [
    "ac_manage_products", "ac_manage_inventory", "ac_manage_orders", "ac_manage_customers",
    "ac_manage_coupons", "ac_manage_content", "ac_manage_marketing", "ac_view_analytics",
    "ac_manage_shipping", "ac_manage_payments", "ac_view_audit_logs",
  ]],
  ["ac_manager", "Manager", true, [
    "ac_manage_products", "ac_manage_inventory", "ac_manage_orders", "ac_manage_customers",
    "ac_manage_coupons", "ac_manage_shipping", "ac_view_analytics",
  ]],
  ["ac_product_manager", "Product Manager", false, [
    "ac_manage_products", "ac_manage_inventory", "ac_view_analytics",
  ]],
  ["ac_order_manager", "Order Manager", false, [
    "ac_manage_orders", "ac_manage_customers", "ac_manage_shipping", "ac_view_analytics",
  ]],
  ["ac_marketing_manager", "Marketing Manager", false, [
    "ac_manage_marketing", "ac_manage_content", "ac_manage_coupons", "ac_view_analytics",
  ]],
  ["ac_support_agent", "Support Agent", false, [
    "ac_manage_customers", "ac_view_analytics",
  ]],
];

const ROLES = ROLE_MATRIX.map(([role, name, assignable, capabilities]) => ({
  role,
  name,
  capabilities,
  assignable,
}));

const ROLE_NAMES = new Map(ROLE_MATRIX.map(([role, name]) => [role, name]));

/** `UserRoles::assignable()` — the two this API still hands out, in order. */
const ASSIGNABLE_ROLES = ROLE_MATRIX.filter(([, , yes]) => yes).map(([role]) => role);

/** `UserRoles::managed()` — §45's seven, retired ones included. */
const MANAGED_ROLES = ROLE_MATRIX.map(([role]) => role);

/** `UserRoles::retired()` — recognised, reported, no longer granted. */
const RETIRED_ROLES = MANAGED_ROLES.filter((role) => !ASSIGNABLE_ROLES.includes(role));

/**
 * `UserRoles::staff()` and therefore the `?role=` enum — **the seven plus
 * `administrator`**, in this order. Measured: `?role=nonsense` names all eight
 * and `?role=` (empty) is refused by the same sentence, because `""` is not a
 * member of the enum the router validates against.
 */
const STAFF_ROLES = [...MANAGED_ROLES, "administrator"];

/** `UserRoles::CORE_ROLES` — WordPress's own, each refused with its own message. */
const CORE_ROLES = [
  "administrator",
  "editor",
  "author",
  "contributor",
  "subscriber",
  "shop_manager",
  "customer",
];

/** `UserStatus::ALL`. `""` is **not** a member, so `?status=` is a 400. */
const STAFF_STATUSES = ["active", "suspended"];

/** `UserRepository::ORDERBY`, and it is a real enum the router refuses outside of. */
const STAFF_ORDERBY = ["registered", "ID", "display_name", "user_email", "user_login"];

/**
 * ── 68 real staff accounts, and the harness identity is the 69th ─────────────
 *
 * `[id, login, role, minutesAgo]`, newest first, taken from the live shop on
 * 2026-08-29 (`GET /users?per_page=100`, 73 rows). Every login, id and role is
 * the shop's own; only the **absolute** registration stamps are the fixture's,
 * because the live install seeded 73 accounts inside five days and several were
 * created in the same second. The *order* is the live order and the intervals
 * are the live intervals, fanned out to a whole minute apart so nothing here
 * ties — a fixture that ties on every row is the thing DECISIONS.md's standing
 * rule says cannot prove a sort.
 *
 * **The ids 514-521 are held out, and five of them exist live.** Those are
 * `IDENTITIES`' own ids, and the acting user is appended below as exactly one
 * row under every `MOCK_IDENTITY` — so the collection is 69 under all eight of
 * them rather than 68 under three and 69 under five. It is 69 where the shop's is
 * 73, and the difference is the reservation rather than a fixture that ran
 * short. Role histogram, therefore: support_agent 19, admin 14,
 * super_admin 12, order_manager 7, product_manager 6, manager 5,
 * marketing_manager 4, administrator 2.
 *
 * **`registered` and `ID` do not agree**, which is what makes both worth
 * offering: 776 registered after 778 while 778 has the higher id, and the same
 * inversion recurs at 762/763. Two sorts that produce one sequence prove
 * nothing, and this file has now recorded that error five times.
 *
 * `email` is `{login}@example.test` and `display_name` is the login on every row
 * the shop has, bar the four named below — measured, not assumed: the whole list
 * was checked for exceptions and there are exactly four.
 */
const STAFF_SEED = [
  [776, "ac_usr_promote", "ac_manager", 66],
  [778, "ac_usr_ordered", "ac_support_agent", 73],
  [774, "ac_usr_new", "ac_manager", 80],
  [770, "ac_panel_suspended", "ac_manager", 134],
  [762, "ac_audit_super", "ac_super_admin", 150],
  [763, "ac_audit_manager", "ac_manager", 157],
  [536, "ac_coupon_marketing", "ac_marketing_manager", 4194],
  [475, "ac_panel_super_admin", "ac_super_admin", 5259],
  [474, "ac_panel_support_agent", "ac_support_agent", 5389],
  [473, "ac_paneldev", "ac_super_admin", 5482],
  [415, "ac_notif_auditor", "ac_admin", 5791],
  [414, "ac_notif_product", "ac_product_manager", 5798],
  [413, "ac_notif_support", "ac_support_agent", 5805],
  [346, "ac_cms_auditor", "ac_admin", 5838],
  [288, "ac_attr_auditor", "ac_admin", 5977],
  [286, "ac_attr_manager", "ac_product_manager", 5984],
  [287, "ac_attr_denied", "ac_support_agent", 5991],
  [240, "ac_usr_suspend", "ac_order_manager", 6019],
  [237, "ac_usr_escalator", "ac_admin", 6026],
  [234, "ac_usr_agent", "ac_support_agent", 6033],
  [233, "ac_usr_admin", "ac_admin", 6040],
  [231, "ac_usr_super", "ac_super_admin", 6047],
  [232, "ac_usr_boss", "ac_super_admin", 6054],
  [108, "ac_opt_admin", "ac_super_admin", 6855],
  [69, "ac_settings_admin", "ac_admin", 7056],
  [68, "ac_settings_super", "ac_super_admin", 7063],
  [60, "ac_apitest_support", "ac_support_agent", 7171],
  [59, "ac_apitest", "ac_admin", 7178],
  [58, "ac_ship_support", "ac_support_agent", 7185],
  [57, "ac_ship_manager", "ac_order_manager", 7192],
  [56, "ac_rules_support", "ac_support_agent", 7199],
  [55, "ac_rules_manager", "ac_order_manager", 7206],
  [54, "ac_seo_admin", "ac_admin", 7213],
  [53, "ac_seed_admin", "administrator", 7220],
  [50, "ac_sec_admin", "ac_super_admin", 7227],
  [51, "ac_sec_support", "ac_support_agent", 7234],
  [48, "ac_prod_admin", "ac_super_admin", 7241],
  [49, "ac_prod_support", "ac_support_agent", 7248],
  [46, "ac_pay_support", "ac_support_agent", 7255],
  [44, "ac_pay_admin", "ac_admin", 7262],
  [45, "ac_pay_manager", "ac_manager", 7269],
  [43, "ac_ord_auditor", "ac_admin", 7276],
  [40, "ac_ord_manager", "ac_order_manager", 7283],
  [41, "ac_ord_support", "ac_support_agent", 7290],
  [38, "ac_media_product", "ac_product_manager", 7297],
  [39, "ac_media_support", "ac_support_agent", 7304],
  [37, "ac_media_marketing", "ac_marketing_manager", 7311],
  [35, "ac_mkt_admin", "ac_admin", 7318],
  [34, "ac_mkt_orders", "ac_order_manager", 7325],
  [33, "ac_mkt_marketing", "ac_marketing_manager", 7332],
  [32, "ac_inv_admin", "ac_super_admin", 7339],
  [31, "ac_inv_support", "ac_support_agent", 7346],
  [30, "ac_inv_manager", "ac_product_manager", 7353],
  [29, "ac_ie_support", "ac_support_agent", 7360],
  [28, "ac_ie_admin", "ac_admin", 7367],
  [27, "ac_cus_auditor", "ac_admin", 7374],
  [23, "ac_cus_denied", "ac_product_manager", 7381],
  [22, "ac_cus_manager", "ac_order_manager", 7388],
  [20, "ac_coupon_admin", "ac_super_admin", 7395],
  [21, "ac_coupon_support", "ac_support_agent", 7402],
  [18, "ac_cod_support", "ac_support_agent", 7409],
  [17, "ac_cod_manager", "ac_order_manager", 7416],
  [14, "ac_cms_marketing", "ac_marketing_manager", 7423],
  [15, "ac_cms_product", "ac_product_manager", 7430],
  [16, "ac_cms_support", "ac_support_agent", 7437],
  [12, "ac_an_support", "ac_support_agent", 7444],
  [11, "ac_an_manager", "ac_admin", 7451],
  [1, "admin", "administrator", 7458],
];

/**
 * The four accounts whose `display_name` is not their login, and the two that
 * carry a first and last name at all.
 *
 * **67 of 69 have neither**, which is the shop as it is, and it is why
 * `staffName()` matters less here than on `/customers` and the *username* column
 * matters more. The two that do are the search control below.
 */
const STAFF_NAMED = new Map([
  [776, { display_name: "Now staff" }],
  [774, { display_name: "Karim B.", first_name: "Karim", last_name: "Benali" }],
  [770, { display_name: "Nadia Cherif", first_name: "Nadia", last_name: "Cherif" }],
  [231, { display_name: "Le patron" }],
]);

/**
 * The one suspended account. **All 73 live accounts were `active`** until
 * `scripts/seed-staff.mjs` created and suspended one through the production
 * writers, which is the same shape as the notifications queue's "every row is
 * pending". Measured: `?status=suspended` is one row, `?status=active` is 72 of
 * 73 (68 of 69 here).
 *
 * It is also the fixture for the credential route's *second* 409 — a suspended
 * account cannot be minted an application password — so removing it would make
 * `credentialConflict()`'s `{kind: "suspended"}` arm unreachable.
 */
const SUSPENDED_STAFF = new Set([770]);

/**
 * ── The 340px overflow fixture, and it is the harness's own ─────────────────
 *
 * Measured on the live shop: the longest `user_login` is **27** characters and
 * the longest `user_email` is **39**, so nothing the shop holds can push this
 * table past a 340px viewport and a fixture built only from real rows would
 * assert nothing. Written onto one seeded row rather than added as a
 * sixty-ninth, which is exactly what `SPECIAL_EMAILS` does on `/customers`.
 *
 * 413 is a plain Support Agent inside the newest twenty, so the string lands on
 * **page one of the default listing** — an overflow fixture on page four is one
 * no capture ever photographs.
 */
const LONG_STAFF_ID = 413;
const LONG_STAFF_LOGIN = "responsable-notifications-et-alertes-boutique-artisanale";

/**
 * ── The delete conflict, and there is no live account that can produce it ────
 *
 * `guardNoOrders()` counts `customerOrderSummaries($id)` and refuses at one.
 * Measured 2026-08-29 over every staff account on the shop: **not one of them
 * owns a single order**, so the 409 has no live fixture and cannot be given one
 * without placing an order against a staff account — a write, and one this
 * brief forbids.
 *
 * So the count is a fixture and the sentence is the source's, verbatim from
 * `UserService.php:387-390`. Three, because that is the number
 * `lib/api/schemas/staff.ts:126` and `lib/staff.ts:181` both quote, so the panel
 * and the harness disagree about nothing.
 *
 * `ac_usr_ordered` is the row, and its login is the shop's own — the account was
 * created for exactly this measurement and then never given an order.
 */
const STAFF_ORDER_COUNTS = new Map([[778, 3]]);

/**
 * ── Application passwords: two seeded accounts, and one of them has two ──────
 *
 * `[uuid, name, createdMinutesAgo, lastUsedMinutesAgo]`, and a `null` last-used
 * is a credential that has never authenticated.
 *
 * 475's row is the live one, uuid included — measured, and it is the shape every
 * account on the shop has: exactly one credential, used within seconds of being
 * minted. **No live account has a never-used credential**, because every one was
 * minted by a script that immediately authenticated with it; `last_used: null` is
 * what `WP_Application_Passwords::create_new_application_password()` stores and
 * what the mint below returns, so the state is the source's rather than a
 * measurement's, and it is named here rather than left to look measured.
 *
 * 774 carries **two**, which is the state the revoke list exists for: one device
 * cannot be told apart from another by anything but its name, which is the whole
 * argument for the duplicate-name 409.
 *
 * Every other account has **none**, and the empty array is a state too — it is
 * what `/users/{id}` answers for 67 of the 69 rows.
 */
const APPLICATION_PASSWORD_SEED = new Map([
  [475, [["c18156a7-cdf3-4827-a7bd-5bd0eb30d1c7", "panel-e2e", 5258, 5256]]],
  [
    774,
    [
      ["3f2d18b0-6c41-4a9e-8f77-2b5c0a91d4e6", "Ordinateur portable", 79, 61],
      ["9a4c7e12-51db-4f30-b8a6-7c3e5d0f2b98", "Téléphone de service", 70, null],
    ],
  ],
]);

const applicationPasswordRow = ([uuid, name, created, lastUsed]) => ({
  uuid,
  name,
  created: iso(created),
  // Null until the credential authenticates once. `last_ip` is stored by
  // WordPress on the same record and is deliberately **not** published — the one
  // field here describing a person rather than a credential.
  last_used: lastUsed === null ? null : iso(lastUsed),
});

/**
 * The acting user, as a staff row.
 *
 * **The three self-refusals are unreachable without it.** `PATCH /users/{me}`
 * with a role, `PATCH /users/{me}` with `status: suspended` and `DELETE
 * /users/{me}` are 403s keyed on `get_current_user_id()`, so a fixture that did
 * not contain the caller would leave all three as paths nothing could take —
 * which is the same failure `no_customers` was added to fix one section over.
 *
 * **The role is `ac_super_admin` whatever `IDENTITY.roles` says**, and that is a
 * correction rather than a shortcut: `IDENTITIES` gives its reduced credentials
 * the invented role `ac_staff`, which is not in the matrix, and an account whose
 * only role is outside `UserRoles::staff()` is **not staff** — it would be absent
 * from this collection and `GET /users/{me}` would 404. Every route here is
 * `ac_manage_users`, which is Super Admin's alone (`UserController.php:19-22`,
 * and measured today: a Manager, a Support Agent and a Marketing Manager are all
 * 403), so a credential that can read this list holds that role by construction.
 */
const ACTING_STAFF = {
  id: IDENTITY.id,
  username: IDENTITY.username,
  email: IDENTITY.email,
  first_name: "",
  last_name: "",
  display_name: IDENTITY.display_name,
  role: "ac_super_admin",
  role_name: "Super Admin",
  is_administrator: false,
  status: "active",
  /*
   * Between 474 and 475 in registration order while holding a **higher id than
   * either**, which is one more `registered`-vs-`ID` inversion and is also the
   * only placement that is not a lie: `admin` is user 1 on every WordPress
   * install and nothing can predate it, so an acting account seeded older than
   * the oldest seeded row would be a shop this API could not produce.
   */
  date_created: iso(5320),
};

/**
 * One seeded row.
 *
 * `role_name` resolves through the matrix and **falls back to the slug**, which
 * is what puts the bare string `"administrator"` on the two WordPress admins —
 * measured, and the fallback `roleLabel()` is written against.
 *
 * `display_name` is never blank. That is not an assumption: every user row on the
 * install was counted, staff and shopper alike, and **zero** have a blank one.
 * `wp_insert_user()` substitutes the login when the field is empty, so the API
 * cannot emit one even through `PATCH {"display_name": ""}` — which is why
 * `lib/staff.ts:312-320` is right and why no fixture here invents the state.
 */
const staffRow = ([id, login, role, minutesAgo]) => {
  const named = STAFF_NAMED.get(id) ?? {};
  const username = id === LONG_STAFF_ID ? LONG_STAFF_LOGIN : login;
  return {
    id,
    username,
    email: id === LONG_STAFF_ID ? LONG_EMAIL : `${login}@example.test`,
    first_name: named.first_name ?? "",
    last_name: named.last_name ?? "",
    display_name: named.display_name ?? username,
    role,
    role_name: ROLE_NAMES.get(role) ?? role,
    is_administrator: role === "administrator",
    status: SUSPENDED_STAFF.has(id) ? "suspended" : "active",
    date_created: iso(minutesAgo),
  };
};

const STAFF = [...STAFF_SEED.map(staffRow), ACTING_STAFF];

/* --------------------------------------------------------------- settings --- */

/**
 * `GET/PATCH /settings`, reproduced from the eleven payloads
 * `tests/fixtures-admin.json` captured live on 2026-08-21. **Every sentence this
 * route answers with is the shop's own** — none of them is written here. The
 * coupons branch shipped a screen built to a `"Read-only."` refusal the API
 * never sends, which is what DECISIONS.md §0 means by the expensive kind of
 * wrong, and this is the route with the most prose on it in the whole surface.
 *
 * **Six blocks, four of which take a write, and a writable block is not wholly
 * writable.** `GET` publishes eight keys under `store` and `PATCH` accepts
 * **four**: `locale`, `currency`, `currency_symbol` and `logo` are refused from
 * inside a block ADMIN_PANEL.md calls writable, with the same "Unknown keys:"
 * sentence an invented name gets. `lib/settings.ts:46-63` records the probe. A
 * mock that accepted every key it publishes would be more permissive than the
 * wire on the one route where a form is most likely to send its own read
 * straight back.
 */
const SETTINGS_WRITABLE_BLOCKS = ["store", "contact", "legal", "social"];

/**
 * The four key lists, taken from the four **refusal sentences** rather than from
 * the document — the refusal is the only place they are stated, which is the
 * whole reason the probe was worth running.
 */
const SETTINGS_WRITABLE_KEYS = {
  store: ["name", "description", "storefront_url", "logo_id"],
  contact: ["email", "phone", "address", "wilaya", "hours"],
  legal: ["registered_name", "rc", "nif", "nis", "ai"],
  social: ["facebook", "instagram", "tiktok", "youtube"],
};

/**
 * The two blocks `GET` publishes and `PATCH` refuses **by name with the
 * reason**, both verbatim.
 *
 * They are not "unknown blocks" and must not answer as if they were: the screen
 * renders these two sentences as reports rather than as disabled switches, so
 * the wording *is* the payload. `settingsRefusedFeatures` and
 * `settingsRefusedProviders` are the captures.
 */
const SETTINGS_READ_ONLY_BLOCKS = {
  features:
    "Feature flags are environment variables read once at bootstrap (ENABLE_COD, ENABLE_CHARGILY, …). Set them in .env and restart, or the registry and this document disagree.",
  providers:
    "Read-only: this reports which providers actually registered, which follows from their credentials and flags.",
};

/**
 * **The live document, and it is very nearly empty — that is the measurement,
 * not a placeholder.**
 *
 * `store.name` is the one text field this shop has set. Every other string in
 * `store`, `contact`, `legal` and `social` is `""`, `logo_id` is `0` and `logo`
 * is `null`. So the default fixture is the settings screen's *ordinary* state
 * for this install, and it is what makes `storefrontConsequences()` true: the
 * empty `storefront_url` is why password reset answers 503
 * `storefront_url_not_set`, tracking links carry no URL and the unsubscribe link
 * points at the API's own domain.
 *
 * **`features` and `providers` agree here, and the agreement is the fixture.**
 * `chargily` and `cod` are flagged and both registered; `yalidine` and
 * `zr_express` are off and both absent. `flagWithoutProvider()` therefore
 * answers false for every flag on this document — a gap this shop is not in,
 * which ADMIN_PANEL.md says is worth stating rather than implying. The variant
 * below is the state that *is* in it.
 */
const SETTINGS_DEFAULT = {
  store: {
    name: SHOP_NAME,
    description: "",
    locale: "en_US",
    currency: "DZD",
    currency_symbol: "د.ج",
    storefront_url: "",
    logo_id: 0,
    logo: null,
  },
  contact: { email: "", phone: "", address: "", wilaya: "", hours: "" },
  legal: { registered_name: "", rc: "", nif: "", nis: "", ai: "" },
  social: { facebook: "", instagram: "", tiktok: "", youtube: "" },
  features: {
    cod: true,
    chargily: true,
    yalidine: false,
    zr_express: false,
    marketing_pixels: false,
    blog: false,
    reviews: false,
    sms: false,
    whatsapp: false,
  },
  providers: { payment: ["chargily", "cod"], shipping: ["manual"], marketing: [] },
};

/**
 * ── `MOCK_SETTINGS=populated`, and the two states nothing here has ever shown ─
 *
 * **Constructed, not measured**, and labelled as such at the top rather than
 * left to be discovered — the treatment `MOCK_HOMEPAGE=future` gets. Every
 * *shape* in it is the document's own; only the values are made up, and they are
 * made up to be long.
 *
 * The first state is DESIGN.md's "long strings render", which the default
 * **cannot** exercise at all: a form of thirteen empty inputs proves nothing
 * about a 69-character shop name, a 154-character description, a 75-character
 * URL, an 84-character registered name or an 88-character Arabic address inside
 * a document the French and Arabic locales both render. Counted in code points
 * rather than UTF-16 units, which is the difference the Arabic one turns on. The
 * screen takes no parameters — no search, no filter, no sort — so there is no URL
 * that fills it, which is the same argument `MOCK_MEDIA=empty` makes from the
 * other end and the reason this is an environment switch read once at module
 * load rather than a query the panel could send.
 *
 * The second is the one that had **no fixture anywhere in this project** — not
 * here, not in `scripts/capture.mjs`, not in `e2e/`. `yalidine: true` with
 * `providers.shipping` still `["manual"]` is a flag on with no provider behind
 * it: `flagWithoutProvider()` at `lib/settings.ts:231` detects exactly this,
 * `lib/settings.ts:214` records it as reachable on the wire by setting a flag
 * without a key, and ADMIN_PANEL.md's stated reason for rendering `providers` at
 * all is that **this is the only place the gap shows**. The warning it drives has
 * therefore never rendered in this project's history. That is the inventory
 * branch's lesson in DECISIONS.md §6 — three bugs, each needing a fixture that
 * did not exist — one section over.
 *
 * `storefront_url` is set here, which is the third thing the default cannot
 * show: `storefrontConsequences()` is false, so the consequence sentence beside
 * the field is *absent* rather than rendered, and a screen that hard-coded it
 * would look correct against the default forever.
 *
 * `logo_id` stays `0` and `logo` stays `null`. The resolved attachment's shape
 * was never captured — `lib/api/schemas/settings.ts` types it `z.unknown()`
 * because of that — and inventing one here is the thing the file header forbids.
 */
const SETTINGS_POPULATED = {
  store: {
    name: "Boutique Artisanale Algérienne — Tapis, Poterie et Cuivre de Ghardaïa",
    description:
      "Artisanat algérien authentique : tapis noués à la main, poterie de Kabylie et cuivre martelé de Constantine, expédiés depuis Ghardaïa vers les 58 wilayas.",
    locale: "en_US",
    currency: "DZD",
    currency_symbol: "د.ج",
    storefront_url: "https://boutique-artisanale-algerienne-tapis-poterie.example.dz/fr/boutique",
    logo_id: 0,
    logo: null,
  },
  contact: {
    email: "contact@boutique-artisanale-algerienne-tapis-poterie.example.dz",
    phone: "+213 555 01 02 03",
    address:
      "شارع الاستقلال، حي النصر، بجوار المسجد الكبير، بلدية غرداية، ولاية غرداية، الجزائر ٤٧٠٠٠",
    wilaya: "Ghardaïa",
    hours: "Samedi – Jeudi : 09:00 – 17:00 · Vendredi : fermé",
  },
  legal: {
    registered_name:
      "Société à Responsabilité Limitée Boutique Artisanale Algérienne des Métiers du Tapis",
    rc: "47/00-1234567 B 25",
    nif: "000547012345678",
    nis: "000547098765432",
    ai: "47050123456789",
  },
  social: {
    facebook: "https://www.facebook.com/boutique.artisanale.algerienne.ghardaia",
    instagram: "https://www.instagram.com/boutique_artisanale_algerienne_dz",
    tiktok: "",
    youtube: "",
  },
  features: { ...SETTINGS_DEFAULT.features, yalidine: true },
  providers: { payment: ["chargily", "cod"], shipping: ["manual"], marketing: [] },
};

const SETTINGS_VARIANTS = {
  /** The measured document. `store.name` and nothing else. */
  empty: SETTINGS_DEFAULT,
  /** Constructed. Long values, and the flag with no provider behind it. */
  populated: SETTINGS_POPULATED,
};

const REQUESTED_SETTINGS = process.env.MOCK_SETTINGS ?? "empty";
if (!(REQUESTED_SETTINGS in SETTINGS_VARIANTS)) {
  throw new Error(
    `MOCK_SETTINGS must be one of ${Object.keys(SETTINGS_VARIANTS).join(", ")} — got "${REQUESTED_SETTINGS}".`,
  );
}

/**
 * Read once at module load, like `MOCK_IDENTITY`, `MOCK_HOMEPAGE` and
 * `MOCK_MEDIA`, so `respond()` stays pure and a capture run is one document from
 * beginning to end.
 */
const SETTINGS_SEED = SETTINGS_VARIANTS[REQUESTED_SETTINGS];

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
 * bug, and the harness could never see either.
 *
 * **The screen that made it visible is gone; the measurement is unchanged.**
 * `PaymentsScreen.tsx` resolved a provider the way `ShipmentRow` used to —
 * `methods.find(…)?.label ?? name`, with no message key in front of it — so with
 * the real labels in place it printed "Cash on delivery" inside both localised
 * panels, on a screenshot rather than hidden by the fixture. The payments branch
 * deleted that file and fixed the defect: `lib/payments.ts` now resolves message
 * key → API `label` → raw name, mirroring `lib/shipping.ts`, and `cod` reads in
 * the reader's own language while `chargily` keeps its brand. This fixture is
 * what that resolution is measured against, so the English labels stay exactly
 * as the API sends them.
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
  /**
   * Order id → the fields a `PATCH` wrote that are **not** the status.
   *
   * A second map beside `statuses` rather than a widening of it, and the split
   * is the route's own: a status move runs a transition guard and recomputes
   * five derived flags (`withStatus`), while `billing`, `shipping`,
   * `customer_id`, the two payment fields and `customer_note` are plain props
   * that merge and derive nothing. Folding the second kind into the first would
   * put an address through a function whose whole job is stock and dates.
   *
   * It holds **seeded and created orders alike**, unlike `state.orders` — which
   * is creates only, on the argument that an order's one write was its status.
   * That argument expired the moment `PATCH /orders/{id}` grew eight more
   * writable fields, and rewriting the 633-row fixture to unify the two shapes
   * would still be rewriting a fixture that works. `orderRow()` reads through
   * this for both.
   */
  orderProps: new Map(),
  /**
   * Order id → the whole row, for the orders `POST /orders` created.
   *
   * **Creates only**, unlike `state.coupons` and `state.pages`, which hold both
   * the seeded rows a write has rewritten and the rows a create made. The
   * difference is that an order's only write is its *status*, and `state.statuses`
   * has held that since the first branch — folding 633 seeded rows in here to
   * unify the two shapes would rewrite a fixture that works in order to make one
   * lookup shorter.
   */
  orders: new Map(),
  /** Ids created in this process, newest first — the head of the list. */
  createdOrders: [],
  nextOrderId: 0,
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
  /**
   * Page id → the whole row as it reads now, holding both the seeded pages a
   * `PATCH` or a `DELETE` has rewritten **and** the pages `POST /cms/pages`
   * created, so one lookup answers for either — the shape coupons already use.
   */
  pages: new Map(),
  /** Ids created in this process, oldest first. The title sort places them. */
  createdPages: [],
  nextPageId: 0,
  /**
   * The homepage **document**, not a diff: `PUT` replaces it whole, because
   * there is no section-level route and §89 argues why — sections are ordered,
   * and an API that let two clients insert at index 2 concurrently would have
   * invented a merge problem the shop does not have.
   */
  homepage: [],
  banners: new Map(),
  createdBanners: [],
  bannersGone: new Set(),
  nextBannerId: 0,
  faqs: new Map(),
  createdFaqs: [],
  faqsGone: new Set(),
  nextFaqId: 0,
  faqCategories: new Map(),
  createdFaqCategories: [],
  faqCategoriesGone: new Set(),
  nextFaqCategoryId: 0,
  /**
   * Location → the whole menu as it reads now. **Keyed by location rather than
   * by id**, because that is the only address `/cms/menus/{location}` has and
   * because a `PUT` to an unassigned location *creates* one — so the absence of
   * a key here is the 404 the footer fixture exists for.
   */
  menus: new Map(),
  nextMenuId: 0,
  nextMenuItemId: 0,
  /**
   * Campaign id → the whole row as it reads now, holding both the seeded rows a
   * `PATCH` has rewritten **and** the rows `POST /campaigns` created — the shape
   * coupons and pages already use, so one lookup answers for either.
   *
   * A campaign has **no trash**: `DELETE` removes it outright, and only while it
   * is a draft. So `campaignsGone` is the whole of the delete's memory, unlike
   * `couponsGone`, which has to distinguish a trashed code from a freed one.
   */
  campaigns: new Map(),
  /**
   * Campaign id → its recipient rows as they read now, written only by a drain
   * step. `recipientsOf()` falls through to `RECIPIENT_SEED`, so the resting
   * fixture needs no entry here and the default run never writes one.
   */
  recipients: new Map(),
  /** Ids created in this process, newest first — the default `created_at desc` head. */
  createdCampaigns: [],
  campaignsGone: new Set(),
  nextCampaignId: 0,
  /** Segment id → the row as it reads now, seeded or created. Same shape. */
  segments: new Map(),
  createdSegments: [],
  segmentsGone: new Set(),
  nextSegmentId: 0,
  /** Media id → the row as it reads now. `PATCH` writes alt, title and caption. */
  media: new Map(),
  /** The ids `POST /media` created, newest last. */
  createdMedia: [],
  nextMediaId: 0,
  /**
   * The ids `DELETE /media/{id}` has removed, and the filenames it took with
   * them.
   *
   * Two sets rather than one, because the delete is `wp_delete_attachment($id,
   * true)` and it destroys **two** things: the row, which `mediaRows()` stops
   * listing, and the file on disk, which `/wp-content/uploads/…` must stop
   * answering for. A mock that dropped only the row would keep serving the bytes
   * of a picture the shop has unlinked — the *more forgiving* direction, and the
   * one a screen showing a stale tile would look correct against.
   */
  deletedMedia: new Set(),
  deletedFiles: new Set(),
  /**
   * `filename` → the bytes an upload sent, so `/wp-content/uploads/…` can answer
   * with them. Without this a freshly uploaded tile is the one broken box in a
   * grid of working ones, which is the state a screen is least likely to be
   * built for and most likely to reach.
   */
  uploads: new Map(),
  /**
   * Notification id → the row as it reads now, written only by
   * `POST /notifications/{id}/retry`.
   *
   * **The one write in this file that cannot create, delete or reorder
   * anything.** `requeue()` is a single conditional `UPDATE` touching three
   * columns — `status`, `attempts`, `last_error` — so a retried row keeps its id
   * and its `created_at` and therefore its position in a listing that is
   * `created_at DESC, id DESC` and nothing else. That is why this is a patch map
   * over the seeds rather than a rebuilt array: there is no ordering to
   * recompute and no head of a list to prepend to.
   */
  notifications: new Map(),
  /**
   * Staff id → the row as it reads now, holding both the seeded accounts a
   * `PATCH` has rewritten **and** the accounts `POST /users` created — the shape
   * coupons, pages and campaigns already use, so one lookup answers for either.
   *
   * **A staff account has no trash.** `wp_delete_user()` removes the row
   * outright, so `staffGone` is the whole of the delete's memory. Unlike a
   * coupon, a deleted account frees its username *and* its email address for
   * immediate reuse, which is what `usernameExists`/`emailExists` are read
   * through rather than off the seed.
   */
  staff: new Map(),
  /** Ids created in this process, newest first — the `registered desc` head. */
  createdStaff: [],
  staffGone: new Set(),
  nextStaffId: 0,
  /**
   * Staff id → its application passwords as they read now, written by the mint
   * and by the revoke. Falls through to `APPLICATION_PASSWORD_SEED`, so the two
   * seeded accounts need no entry here and the resting fixture writes none.
   */
  appPasswords: new Map(),
  /**
   * How many credentials this process has minted, which is the whole of the
   * randomness the mint needs. A uuid and a 24-character secret are both derived
   * from it, so a screenshot of a freshly minted credential is byte-stable — and
   * that matters more here than anywhere else in this file, because the sheet
   * showing the secret is the one screen in the panel whose entire content is a
   * value nobody can fetch a second time.
   */
  mintedCredentials: 0,
  /**
   * The settings **document**, not a diff — the shape `state.homepage` already
   * uses, and for the same reason: `PATCH /settings` answers with the whole
   * document rather than the block it wrote, so the thing the route has to hold
   * is the thing it returns.
   *
   * A partial write updates only what it names and `""` clears a field, so this
   * is mutated key by key and read out whole.
   */
  settings: {},
  /**
   * The next id an **applied** products import hands out, and the one number in
   * this file that names a row nothing here creates.
   *
   * `POST /import/products?dry_run=false` reports `{line, action, product_id}`
   * for a row it wrote — measured shape, lib/transfer.ts:213 — and this mock
   * cannot create a product: `catalogue()` maps `CATALOGUE` through
   * `state.products`, so a write can rewrite a seeded row and nothing can append
   * one. So the id is minted and the product is not. Same class as
   * `sendCampaign()` writing counts and no recipient rows
   * (`mock-api.mjs:13366`), named here for the same reason: the report is
   * honest about its shape and dishonest about its consequence, and a later
   * `GET /products?search=` will not find what this said it created.
   */
  nextImportedProductId: 0,
};

export function resetState() {
  state.statuses = new Map();
  state.orderProps = new Map();
  state.orders = new Map();
  state.createdOrders = [];
  /*
   * Clear of the 633 seeded ids, which run 1000-1632, and the same figure in
   * every process — the rule `nextCouponId` and `nextPageId` already follow, and
   * for the same reason: a screenshot of a created order has to be byte-stable.
   */
  state.nextOrderId = 9200;
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
  state.pages = new Map();
  state.createdPages = [];
  // Clear of every seeded page id — the named ones run to 21 and the fifty
  // filler pages occupy 3000-3049 — and the same figure in every process, which
  // is what keeps a screenshot of a created page byte-stable.
  state.nextPageId = 4200;
  // A copy, so a `PUT` cannot rewrite the seed the next `resetState()` restores.
  state.homepage = [...HOMEPAGE_SEED];
  state.banners = new Map();
  state.createdBanners = [];
  state.bannersGone = new Set();
  state.nextBannerId = 7320;
  state.faqs = new Map();
  state.createdFaqs = [];
  state.faqsGone = new Set();
  state.nextFaqId = 8120;
  state.faqCategories = new Map();
  state.createdFaqCategories = [];
  state.faqCategoriesGone = new Set();
  state.nextFaqCategoryId = 8220;
  // Structured-cloned rather than shared: the seed holds nested `children`, and
  // a `PUT` that rewrote a nested array in place would leak into the baseline
  // this call exists to restore.
  state.menus = new Map(
    Object.entries(MENU_SEED).map(([location, menu]) => [
      location,
      { ...menu, items: JSON.parse(JSON.stringify(menu.items)) },
    ]),
  );
  // Above the seeded menu and its items, and fixed rather than derived so the
  // menu a `PUT` creates carries the same ids in every process.
  state.nextMenuId = 4300;
  state.nextMenuItemId = 4400;
  state.campaigns = new Map();
  state.recipients = new Map();
  state.createdCampaigns = [];
  state.campaignsGone = new Set();
  // Above the five seeded ids and far enough from them to read as new — the
  // same rule `nextCouponId` follows, and the same figure in every process,
  // which is what keeps a screenshot of a created draft byte-stable.
  state.nextCampaignId = 340;
  state.segments = new Map();
  state.createdSegments = [];
  state.segmentsGone = new Set();
  // Clear of 43-46, and clear of 47 — the id the live shop handed the scratch
  // segment this fixture's refusals were measured with, which is now free again
  // and would read as a coincidence rather than as a new row.
  state.nextSegmentId = 60;
  state.media = new Map();
  state.createdMedia = [];
  state.deletedMedia = new Set();
  state.deletedFiles = new Set();
  // Clear of the 41 seeded ids (5001-5041) and fixed rather than derived, which
  // is what keeps a screenshot of a just-uploaded tile byte-stable.
  state.nextMediaId = 5120;
  state.uploads = new Map();
  /*
   * A retry is the only thing that writes here, and it is genuinely destructive
   * of a state the fixture exists for: it takes a `failed` or `retrying` row to
   * `queued` — attempts 0, no error — so the first test to retry the fixture's
   * only unreadable row would leave every later one with no `readable: false`
   * fixture at all, and the same for the exhausted row and the `attempts: 2`
   * one. No ids are handed out, because a retry creates nothing.
   */
  state.notifications = new Map();
  state.staff = new Map();
  state.createdStaff = [];
  state.staffGone = new Set();
  /*
   * Clear of every seeded id — the shop's own run to 778 — and clear of the
   * `IDENTITIES` ids this fixture holds out, so a created account can never
   * collide with the acting user under any `MOCK_IDENTITY`. Fixed rather than
   * derived, which is what keeps a screenshot of a created account byte-stable.
   *
   * **The range is deliberately not written down here.** This said "the nine
   * ids (514-522)" and was stale on both halves within two branches — there
   * were ten by then and there are eleven now, running to 524 — while `810`
   * covered every one of them the whole time and the sentence was the only
   * thing that went wrong. `IDENTITIES` is where the ids live and a second copy
   * of their extent is a second thing to keep true, which is the same defect
   * the `gatedOn` docblock records of its own count.
   */
  state.nextStaffId = 810;
  state.appPasswords = new Map();
  state.mintedCredentials = 0;

  /*
   * A deep copy rather than the seed itself: a `PATCH` writes into the blocks in
   * place, and sharing the object would let one write leak into the baseline
   * this call exists to restore — the same trap `state.menus` documents one
   * collection over, and the same fix. `structuredClone` is in node 17+ and the
   * document is plain JSON.
   */
  state.settings = structuredClone(SETTINGS_SEED);

  // Above every product id in this file — the catalogue runs to 204 and the two
  // stale coupon restrictions to 8843 — and fixed rather than derived, so a
  // screenshot of an applied import carries the same id in every process.
  state.nextImportedProductId = 9100;

  // Last, because it writes `state.campaigns` and `state.recipients` and every
  // line above has just cleared them. A no-op unless `MOCK_SEND_PROGRESS` is a
  // number greater than zero, which is what keeps the default run's fixture — and
  // every capture taken against it — exactly what it was.
  applySeededSendProgress();
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

/**
 * The row as it reads *now*. Identity when nothing has been written to it.
 *
 * The props are applied **before** the status, because `withStatus` derives
 * `is_editable`, `stock_reduced` and the two dates from the row it is given and
 * a props write must not be able to shadow them. Nothing in `state.orderProps`
 * is a derived field — `patchOrder` only ever puts writable ones there — so the
 * ordering is a guard rather than a fix.
 */
const orderRow = (order) => {
  const props = state.orderProps.get(order.id);
  const written = props === undefined ? order : { ...order, ...props };
  const status = statusOf(order);
  return status === written.status ? written : withStatus(written, status);
};

/**
 * Every order the shop has, newest first — the ones this process created ahead
 * of the 633 seeded ones.
 *
 * **The created rows lead, and that is the sort rather than a convenience.**
 * `collectionOf` does not re-sort, and `/orders` is `created_at DESC, id DESC`
 * with nothing able to change it — measured, and recorded at the head of this
 * file. An order made a moment ago is the newest order there is, so it belongs
 * where the list already puts the newest.
 */
const allOrders = () => [
  ...state.createdOrders.map((id) => orderRow(state.orders.get(id))),
  ...ORDERS.map(orderRow),
];

/**
 * One order by id, seeded or created, read through any status a PATCH has
 * written. The created map is checked first because it is the smaller of the two
 * and because its ids cannot collide — `nextOrderId` starts well above 1632.
 */
const findOrder = (id) => {
  const made = state.orders.get(id);
  if (made !== undefined) return orderRow(made);
  const seeded = ORDERS.find((row) => row.id === id);
  return seeded === undefined ? undefined : seeded;
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

/**
 * This collection's own 404, and it is not the routing one.
 *
 * `Orders\OrderService::requireOrder()` answers `not_found` / *"No order with
 * that id."* and it is the single gate behind the detail, the PATCH, the cancel
 * and every sub-resource — so an id that is numeric but names nothing gets a
 * sentence, while `/orders/abc` never reaches the controller at all and stays
 * `rest_no_route`. The customers collection draws the same line a few hundred
 * lines down and records why: `collectionOf`'s routing 404 is right for the
 * collections that have no sentence of their own and wrong for the ones that do.
 */
const orderNotFound = () => fail(404, "not_found", "No order with that id.");

/**
 * `OrderInput::allowedFields()`, in its own order.
 *
 * Nine keys, and the panel's order edit form sends six of them. `status` is
 * `OrderActions`' control and never travels with the rest — `OrderService::update()`
 * runs `guardTransition()` before every other guard, so a body carrying a refused
 * move and a good address reports only the move and the address silently does not
 * land. `line_items` and `shipping_amount` are recognised but not written here;
 * see `patchOrder`.
 */
const ORDER_WRITABLE_FIELDS = [
  "payment_method",
  "payment_method_title",
  "customer_note",
  "status",
  "customer_id",
  "billing",
  "shipping",
  "line_items",
  "shipping_amount",
];

/**
 * `OrderInput::READ_ONLY` — **stripped before the unknown-key sweep**, which is
 * the ordering that makes them drop in silence rather than come back named.
 *
 * `array_diff_key($payload, array_flip(self::READ_ONLY))` runs first and the
 * `array_diff(array_keys($payload), allowedFields())` sweep runs second, so
 * `{"total":"1.00"}` is not "Unknown field." and is not a per-field refusal
 * either: the payload is simply empty afterwards, and an empty payload is the
 * `"No supported fields were provided."` 400 with no details. There is no
 * per-field error for a read-only key on this route, ever — which is why the
 * edit form binds no control to one.
 */
const ORDER_READ_ONLY_FIELDS = [
  "id",
  "number",
  "order_key",
  "created_via",
  "currency",
  "version",
  "discount_total",
  "shipping_total",
  "total_tax",
  "total",
  "subtotal",
  "prices_include_tax",
  "payment_url",
  "is_editable",
  "needs_payment",
  "stock_reduced",
  "customer",
  "date_created",
  "date_modified",
  "date_paid",
  "date_completed",
];

/** `OrderInput::STRING_FIELDS`, and the cap all three of them share. */
const ORDER_STRING_FIELDS = ["payment_method", "payment_method_title", "customer_note"];

const MAX_ORDER_NOTE = 5000;

/** `guardLineItemsWritable()` and `guardShippingAmountWritable()` both name it. */
const ORDER_EDITABLE_IN = ["pending", "on-hold"];

/**
 * `PATCH /orders/{id}` — the whole writable surface, not the status alone.
 *
 * ## What this route was here, and what it is now
 *
 * It took `status` and refused everything else, because the status control was
 * the only thing on the panel that wrote an order. The order **edit** form —
 * `app/[locale]/(panel)/orders/[id]/OrderEditDrawer.tsx` — writes the customer,
 * both addresses, the two payment fields and the customer note through this same
 * route, so a mock that answered "Invalid parameter(s): status" to a corrected
 * phone number would make every screen in that drawer uncapturable.
 *
 * Everything below is **measured in-process via `rest_do_request()`** against the
 * plugin in the backend repository — `tests/Api/orders.php`, the section headed
 * *the PATCH field contract, measured*. Read that phrase strictly: it runs
 * routing, the args schema, `OrderInput`, `AddressInput`, the service guards, the
 * repository and WooCommerce, and it does **not** run Application Password
 * authentication or anything between a browser and PHP. It is not "measured
 * against the live API"; `BLOCKED.md` says why that phrase is unavailable here.
 *
 * ## The order the refusals come in, and why it is not arbitrary
 *
 * `OrderService::update()` runs them in exactly this sequence and a mock that
 * reordered them would answer a different error to a body with two problems:
 *
 *   1. read-only keys dropped, silently
 *   2. every remaining field validated at once, one 400 naming all of them
 *   3. nothing left to write → 400, **no details at all**
 *   4. `guardTransition()`      → 409, and it runs before every other guard
 *   5. `guardLineItemsWritable()`, `guardShippingAmountWritable()` → 409
 *   6. the repository, where an unknown customer id is refused
 *   7. WooCommerce's own setters, where the `details`-less billing-email 400 is
 *
 * ## `line_items` and `shipping_amount` are recognised, guarded, and not written
 *
 * **Recognised** because `allowedFields()` lists them, and a mock answering
 * "Unknown field." would send whoever builds the line-item editor hunting a bug
 * that is not there. **Guarded** because the 409 they produce on an order that
 * has left `pending` is the single most important rule on this route — it is why
 * `order-edit.ts` omits `line_items` from the body *structurally* rather than
 * conditionally, and a mock without it makes that rule untestable.
 *
 * **Not written, and this says so rather than pretending otherwise.** On an
 * order the guard lets through — `pending` or `on-hold` — stating either key is
 * accepted and changes nothing, which is a divergence from the API and is left
 * deliberately: the line-item write is a wholesale replacement with catalogue
 * pricing (item 1 step 2) and the shipping amount recomputes the order total
 * (step 4), and neither control exists yet. No screen in the panel sends either
 * key today, so the divergence is unreachable from the panel — but it is a
 * divergence, and the next branch to touch this function should close it rather
 * than discover it.
 */
function patchOrder(order, body) {
  /* The row as it reads *now*, not the seed: `is_editable` and the status this
     write is guarded against are both properties of what an earlier PATCH left
     behind, and the addresses this one merges into are too. */
  const row = orderRow(order);

  const payload =
    body === null || typeof body !== "object" || Array.isArray(body) ? {} : body;

  const fields = {};

  // 1. Read-only keys leave without a trace. See `ORDER_READ_ONLY_FIELDS`.
  const stated = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !ORDER_READ_ONLY_FIELDS.includes(key)),
  );

  for (const key of Object.keys(stated)) {
    if (!ORDER_WRITABLE_FIELDS.includes(key)) fields[key] = "Unknown field.";
  }

  /** What survives validation, keyed as `OrderInput` keys its own `$clean`. */
  const clean = {};

  for (const key of ORDER_STRING_FIELDS) {
    if (!(key in stated)) continue;
    const raw = stated[key];

    // `null` is the documented way to clear one, and stores `''`.
    if (raw === null) {
      clean[key] = "";
      continue;
    }
    // `is_scalar()` in PHP: an array or an object is refused, a number is cast.
    if (typeof raw === "object") {
      fields[key] = "Must be a string.";
      continue;
    }

    const value = String(raw).trim();
    // The 5 000 cap is on all three, not on the note alone — one loop over
    // STRING_FIELDS applies it, and `MAX_CUSTOMER_NOTE` is the panel's copy.
    if (value.length > MAX_ORDER_NOTE) {
      fields[key] = `Must be at most ${MAX_ORDER_NOTE} characters.`;
      continue;
    }

    clean[key] = value;
  }

  if ("status" in stated) {
    const value = typeof stated.status === "string" ? stated.status : "";
    if (ORDER_STATUSES.includes(value)) clean.status = value;
    else fields.status = oneOf(ORDER_STATUSES);
  }

  if ("customer_id" in stated) {
    const raw = stated.customer_id;
    // `is_numeric()`: a number, or a numeric string. Not `null`, not `""`.
    const value =
      typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "")
        ? Number(raw)
        : Number.NaN;

    if (!Number.isInteger(value) || value < 0) {
      fields.customer_id = "Must be a user id, or 0 for a guest.";
    } else {
      clean.customer_id = value;
    }
  }

  // Only the stated keys, so the merge below is a merge. See `statedAddressFields`.
  for (const prefix of ["billing", "shipping"]) {
    if (!(prefix in stated)) continue;
    const block = statedAddressFields(stated[prefix], prefix, fields);
    if (block !== null) clean[prefix] = block;
  }

  for (const key of ["line_items", "shipping_amount"]) {
    if (key in stated) clean[key] = stated[key];
  }

  // 2. One 400 naming every bad field at once — a form binds them all in one pass.
  if (Object.keys(fields).length > 0) {
    return invalidBody("The order data is invalid.", fields);
  }

  /*
   * 3. Nothing left to write. `OrderInput::isEmpty()`, and it carries **no
   * details** — there is no field to name, because every field that could have
   * been named was either read-only or absent. `isEditDirty()` is the panel's
   * guard against ever sending this body.
   */
  if (Object.keys(clean).length === 0) {
    return bareFail(400, "invalid_request", "No supported fields were provided.");
  }

  // 4. The transition, before every other guard.
  if (clean.status !== undefined) {
    const from = row.status;
    const allowed = allowedMoves(from);
    if (!allowed.includes(clean.status)) {
      return conflict(`An order cannot move from ${from} to ${clean.status}.`, {
        from,
        to: clean.status,
        allowed,
      });
    }
  }

  /*
   * 5. The two `is_editable` gates. **This is the 409 that shapes the panel's
   * payload builder**: the echoed `line_items` of a `completed` order is a
   * conflict even when the only field the operator touched was the customer
   * note, so an edit form that PATCHed the GET body back would fail on every
   * order that has left `pending`.
   */
  if (clean.line_items !== undefined && !row.is_editable) {
    return conflict("The line items of an order in this status cannot be changed.", {
      status: row.status,
      editable_in: ORDER_EDITABLE_IN,
    });
  }

  if (clean.shipping_amount !== undefined && !row.is_editable) {
    return conflict("The shipping amount of an order in this status cannot be changed.", {
      status: row.status,
      editable_in: ORDER_EDITABLE_IN,
    });
  }

  // 6. The repository's own refusal — `applyProps()` → `assertCustomer()`.
  if (
    clean.customer_id !== undefined &&
    clean.customer_id !== 0 &&
    !CUSTOMERS.some((customer) => customer.id === clean.customer_id)
  ) {
    return invalidBody("The order data is invalid.", {
      customer_id: `No user with id ${clean.customer_id}.`,
    });
  }

  /*
   * 7. WooCommerce's setter, and the only refusal on this route carrying no
   * `details`. Nothing is written when it fires — the whole PATCH rolls back,
   * so a customer note in the same body does not move either, which is what
   * makes an unbound line in the panel's error summary an honest thing to
   * render rather than a lie about what happened.
   */
  const email = clean.billing?.email;
  if (email !== undefined && email !== "" && wordPressWouldRefuseEmail(email)) {
    return bareFail(400, "invalid_request", "Invalid billing email address");
  }

  const next = { ...(state.orderProps.get(order.id) ?? {}) };

  for (const key of ORDER_STRING_FIELDS) {
    if (clean[key] !== undefined) next[key] = clean[key];
  }
  if (clean.customer_id !== undefined) next.customer_id = clean.customer_id;
  // The merge: the stated keys over what the row already carries. Ten untouched
  // fields survive a PATCH that corrects the eleventh.
  if (clean.billing !== undefined) next.billing = { ...row.billing, ...clean.billing };
  if (clean.shipping !== undefined) next.shipping = { ...row.shipping, ...clean.shipping };

  state.orderProps.set(order.id, next);

  // The status keeps its own map — it derives five flags that a props write
  // must not be able to shadow. `orderRow` applies the props first for that.
  if (clean.status !== undefined) state.statuses.set(order.id, clean.status);

  return ok(orderRow(order));
}

/**
 * The statuses an order may be **created** in.
 *
 * `cancelled` and `refunded` are absent and their refusal is a **409**, not a
 * 400 — they are real statuses that are simply not places an order can begin.
 * `lib/order-status.ts`'s `CREATABLE_STATUSES` is the panel's copy of this list
 * and carries the argument for offering five rather than seven.
 */
const CREATABLE_ORDER_STATUSES = ["pending", "processing", "on-hold", "completed", "failed"];

/**
 * `POST /orders`. The panel's back-office order entry.
 *
 * ## Provenance, and it is weaker than the rest of this file
 *
 * Everything above is measured against the live shop. **This is transcribed from
 * `tests/Api/orders.php` in the backend repository** — the plugin's own suite,
 * which exercises each refusal below by name — rather than from a request
 * somebody made. That is a real difference in confidence and it is written here
 * rather than left for the reader to assume: creating an order on the live shop
 * is not reversible the way a coupon or a parcel is, so nobody has fired one to
 * see what comes back.
 *
 * What the suite asserts, and therefore what this reproduces:
 *
 *   no body / empty list      400, `details.fields.line_items`
 *   an unknown top-level key  400, naming the key
 *   a caller-supplied price   400, `line_items.0.price`
 *   a product that is gone    400
 *   an unknown customer       400, `details.fields.customer_id`
 *   a malformed billing email 400, `details.fields.billing.email`
 *   a country name, not code  400
 *   cancelled / refunded      **409**
 *   an unknown status         400
 *   the happy path            **201**, total priced from the catalogue, the
 *                             country upper-cased, `stock_reduced` false while
 *                             the order is pending
 *
 * ## The total is computed here, and that is the point of it
 *
 * `2 × 1500 + 3 × 300 = 3900.00`, from the catalogue and never from the request
 * — the suite asserts that figure against those lines. A mock that echoed a
 * caller's price back would let the panel ship a form that sent one.
 */
function postOrder(body) {
  const fields = {};

  const known = new Set([
    "line_items",
    "status",
    "customer_id",
    "billing",
    "shipping",
    "payment_method",
    "payment_method_title",
    "customer_note",
  ]);
  for (const key of Object.keys(body ?? {})) {
    if (!known.has(key)) fields[key] = "Unknown field.";
  }

  const lines = Array.isArray(body?.line_items) ? body.line_items : null;
  if (lines === null || lines.length === 0) {
    fields.line_items = "An order needs at least one line item.";
  }

  const resolved = [];
  for (const [index, raw] of (lines ?? []).entries()) {
    const prefix = `line_items.${index}`;
    for (const key of Object.keys(raw ?? {})) {
      // `price` is refused **by name**: nobody reaches it by round-tripping a
      // response — the presenter never emits one — so they reached it by trying
      // to set a price.
      if (!["product_id", "variation_id", "quantity"].includes(key)) {
        fields[`${prefix}.${key}`] = "Unknown field.";
      }
    }
    /*
     * `productById`, not `PRODUCTS.find`. The catalogue is `NEW_ARRIVALS` +
     * `PRODUCTS` + `BACK_CATALOGUE` and `/products` lists all three — so a
     * lookup against the middle third alone refuses the first three rows of
     * page one, which are exactly the rows a picker offers first. Found by
     * driving the create drawer against this mock: every order built from the
     * top of the search results came back "No product with that id."
     *
     * It also reads through the write state, so a force-deleted product is
     * gone here as it is everywhere else — which is the right refusal rather
     * than an accident.
     */
    const product = productById(Number(raw?.product_id));
    if (product === undefined) {
      fields[`${prefix}.product_id`] = "No product with that id.";
      continue;
    }
    const quantity = Number(raw?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      fields[`${prefix}.quantity`] = "Must be a whole number greater than zero.";
      continue;
    }
    resolved.push({ product, quantity });
  }

  if (body?.customer_id !== undefined) {
    const customerId = Number(body.customer_id);
    if (!Number.isInteger(customerId) || customerId < 0) {
      fields.customer_id = "Must be a user id, or 0 for a guest.";
    } else if (customerId !== 0 && !CUSTOMERS.some((row) => row.id === customerId)) {
      fields.customer_id = "No customer with that id.";
    }
  }

  const billing = readOrderAddress(body?.billing, "billing", fields);
  const shipping = readOrderAddress(body?.shipping, "shipping", fields);

  const status = body?.status === undefined ? "pending" : body.status;
  const knownStatus = typeof status === "string" && ORDER_STATUSES.includes(status);
  if (!knownStatus) fields.status = oneOf(ORDER_STATUSES);

  if (Object.keys(fields).length > 0) {
    return invalidBody("The order data is invalid.", fields);
  }

  /*
   * The terminal pair, **after** the field validation and as a 409. An order
   * cannot begin cancelled, but `cancelled` is not an unknown value — answering
   * 400 would send an operator looking for a typo in a word that is on the
   * status filter three inches away.
   */
  if (!CREATABLE_ORDER_STATUSES.includes(status)) {
    return conflict(`An order cannot be created as ${status}.`, {
      status,
      allowed: CREATABLE_ORDER_STATUSES,
    });
  }

  const lineItems = resolved.map(({ product, quantity }, index) => {
    const unit = product.price === "" ? "0.00" : product.price;
    const total = (Number.parseFloat(unit) * quantity).toFixed(2);
    return {
      id: state.nextOrderId * 10 + index,
      name: product.name,
      product_id: product.id,
      variation_id: 0,
      quantity,
      sku: product.sku,
      subtotal: total,
      total,
    };
  });

  const subtotal = lineItems
    .reduce((sum, item) => sum + Number.parseFloat(item.total), 0)
    .toFixed(2);

  const id = state.nextOrderId++;
  const paid = status === "completed" || status === "processing";

  const order = {
    id,
    number: String(id),
    status,
    currency: "DZD",
    customer_id: Number(body?.customer_id ?? 0),
    customer_note: typeof body?.customer_note === "string" ? body.customer_note : "",
    payment_method: typeof body?.payment_method === "string" ? body.payment_method : "",
    payment_method_title:
      typeof body?.payment_method_title === "string" ? body.payment_method_title : "",
    billing,
    shipping,
    line_items: lineItems,
    discount_total: "0.00",
    /*
     * **No shipping is added.** The suite's happy path totals exactly
     * `3900.00` on two lines of 1500 and three of 300, so a created order
     * carries no carriage until a rule or a parcel puts one on it — unlike the
     * seeded fixtures above, which are written with one.
     */
    shipping_total: "0.00",
    total_tax: "0.00",
    subtotal,
    total: subtotal,
    is_editable: status === "pending" || status === "on-hold",
    needs_payment: !paid && status !== "failed",
    // False while pending — the suite asserts it, and asserts the movement
    // ledger stays empty beside it.
    stock_reduced: paid,
    date_created: iso(0),
    date_modified: iso(0),
    date_paid: paid ? iso(0) : null,
    date_completed: status === "completed" ? iso(0) : null,
  };

  state.orders.set(id, order);
  state.createdOrders = [id, ...state.createdOrders];
  state.cod.set(id, seedCod(order));

  return created(order);
}

/**
 * The keys one address block accepts — `Commerce\AddressInput::FIELDS`, plus
 * `BILLING_ONLY` on the billing side.
 *
 * `email` is billing's alone because WooCommerce has `set_billing_email()` and
 * no shipping counterpart, which is why the key is **refused by name** on a
 * shipping block rather than dropped: "Only a billing address carries an email."
 */
const ADDRESS_BLOCK_FIELDS = [
  "first_name",
  "last_name",
  "company",
  "address_1",
  "address_2",
  "city",
  "state",
  "postcode",
  "country",
  "phone",
];

const emptyAddressBlock = (prefix) => ({
  ...Object.fromEntries(ADDRESS_BLOCK_FIELDS.map((key) => [key, ""])),
  ...(prefix === "billing" ? { email: "" } : {}),
});

/**
 * The **stated** keys of one address block, validated the way `AddressInput`
 * validates them — and only the stated ones.
 *
 * That last clause is the whole reason this is a function rather than the body
 * of `readOrderAddress` below. `POST` wants a whole block with the eleven
 * defaults filled in; `PATCH` wants exactly what the payload named, because
 * `Orders\OrderRepository::applyProps()` walks `$address->fields` — the keys the
 * payload *stated* — one setter each, so an omitted field is never written and
 * a partial address **merges**. A mock that filled the gaps with `""` on the
 * way in would blank ten fields on every PATCH that corrected one, and the panel
 * would never find out until a real order lost its address.
 *
 * `null` returns when the block itself is refused: the caller has the message in
 * `fields[prefix]` and there is nothing to merge.
 *
 * Two refusals are named rather than generic because both are mistakes somebody
 * actually makes: a country **name** where a code belongs, and a billing e-mail
 * that is not one. The country rule is `^[A-Z]{2}$` **and nothing more** —
 * `AddressInput::validateCountry()` is that `preg_match` alone, membership would
 * mean `WC()->countries` and that class is deliberately loadable without
 * WordPress. So `ZZ` is accepted here exactly as it is accepted there, which is
 * the measurement `AddressFields.tsx` runs its own shape check for.
 */
function statedAddressFields(raw, prefix, fields) {
  const allowed = emptyAddressBlock(prefix);

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fields[prefix] = "Must be an object.";
    return null;
  }

  const out = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!(key in allowed)) {
      fields[`${prefix}.${key}`] =
        key === "email"
          ? "Only a billing address carries an email."
          : "Unknown field.";
      continue;
    }
    // `null` stores an empty string — `AddressInput::parse()` maps it — which is
    // how a PATCH *clears* a field. It is not the same as omitting the key.
    out[key] = typeof value === "string" ? value : String(value ?? "");
  }

  if (out.country !== undefined && out.country !== "") {
    const upper = out.country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper)) {
      fields[`${prefix}.country`] = "Must be a two-letter ISO country code, such as DZ.";
    } else {
      out.country = upper;
    }
  }

  if (
    prefix === "billing" &&
    out.email !== undefined &&
    out.email !== "" &&
    !FILTER_VAR_EMAIL.test(out.email)
  ) {
    fields["billing.email"] = "Must be a valid email address.";
  }

  return out;
}

/**
 * `AddressInput::validateEmail()`'s rule, which is PHP's `filter_var()` and not
 * WordPress's `is_email()`. The gap between the two is real and reachable —
 * `wordPressWouldRefuseEmail()` below is the other half of it.
 */
const FILTER_VAR_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * WordPress's `is_email()`, in the two clauses where it disagrees with
 * `filter_var()` — and the disagreement is the only way to reach a **400 with
 * no `details` at all** on this route.
 *
 * `AddressInput` validates with `filter_var()` because that class must stay
 * loadable without WordPress; `WC_Order::set_billing_email()` then validates
 * again with `is_email()` and throws `WC_Data_Exception` when it disagrees,
 * which `Orders\OrderService::save()` re-throws as
 * `ApiException::invalidRequest($exception->getMessage())` — **message only, no
 * details array**. Measured in-process via `rest_do_request()`, in the backend
 * suite's check *"a filter_var-valid address WooCommerce refuses has no field
 * key"*: `PATCH {billing:{email:"a@b.c"}}` answers `400 invalid_request
 * "Invalid billing email address"` with `details.fields` absent.
 *
 * The two clauses reproduced here are the ones that produce that gap:
 *
 *   the length floor    `is_email()` refuses anything under six characters
 *                       outright, which is what `a@b.c` (five) falls to.
 *   the domain charset  each dot-separated part must match `[a-z0-9-]+`, which
 *                       is what an IP literal like `a@[127.0.0.1]` falls to.
 *
 * It exists so the panel's fallback for a `details`-less refusal has something
 * to render against. A mock where every 400 carried `details.fields` would let
 * `OrderEditDrawer` ship with a summary that renders nothing for this input.
 */
const wordPressWouldRefuseEmail = (value) => {
  if (value.length < 6) return true;
  const domain = value.slice(value.lastIndexOf("@") + 1);
  return domain.split(".").some((part) => !/^[a-z0-9-]+$/i.test(part));
};

/**
 * One **whole** address block on the way in, for `POST /orders` — the stated
 * keys over the eleven defaults.
 *
 * A create states the whole address by definition: there is nothing underneath
 * it to merge with, so an unstated field is `""` rather than absent. `PATCH`
 * calls `statedAddressFields` directly for the opposite reason.
 */
function readOrderAddress(raw, prefix, fields) {
  const empty = emptyAddressBlock(prefix);

  if (raw === undefined) return empty;

  const stated = statedAddressFields(raw, prefix, fields);
  return stated === null ? empty : { ...empty, ...stated };
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
    /*
     * The third and last site owing DECISIONS.md's enum-sentence entry, and it
     * owed **three** corrections rather than one: the sentence sat in the
     * top-level `message` where the wire puts `"Invalid parameter(s): status"`,
     * and `join(", ")` dropped both the Oxford `and` that `oxford()` writes and
     * the full stop every enum refusal in this file ends with. All three are one
     * call to the helper that was already here.
     */
    return { error: invalidParam("status", notOneOf("status", ORDER_STATUSES)) };
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
 * **The collection's own 404, which it did not have until 2026-08-28.**
 *
 * `GET /customers/99999` is `not_found` / "No customer with that id." on the
 * wire, and this file was answering the *routing* 404 — `rest_no_route`, "No
 * route was found matching the URL and request method." Those are different
 * facts: one says the customer is gone, the other says the panel called a URL
 * that does not exist, and only the first is something a screen can tell a person.
 * `/campaigns`, `/segments` and `/media` all had their own sentence already;
 * customers was the gap.
 *
 * It matters now because **a saved `audience.customer_ids` can only be resolved
 * one id at a time** — measured the same day, there is no batch route: `?include=`,
 * `?ids=`, `?id=`, `?post__in=` and `?exclude=` are each a silent 200 answering
 * the whole collection, byte-identical to `?bogus_param=1`. So anything naming the
 * people behind a stored audience walks `GET /customers/{id}`, and a deleted
 * customer in that list is the ordinary case rather than an edge one.
 *
 * `/customers/0` is a **400** beside it, the same `idArg()` `minimum: 1` refusal
 * `/campaigns/0`, `/segments/0` and `/media/0` answer, and `/customers/abc` stays
 * a routing 404 because `\d+` never matched it.
 */
const customerNotFound = () => fail(404, "not_found", "No customer with that id.");

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
      /*
       * `invalidParam()` rather than a hand-rolled `fail()`. This site put the
       * enum sentence in the **top-level `message`**, where the wire puts
       * `"Invalid parameter(s): <name>"` and keeps the sentence in
       * `details.params.<name>` — the divergence the marketing honesty audit
       * found across five collections and DECISIONS.md carried forward. It was
       * never a rewrite: `invalidParam()` two hundred lines up already emitted
       * the right shape and this call site simply did not use it, which is the
       * same slip `notificationsListing()` was fixed for on 2026-08-28.
       */
      return invalidParam(name, notOneOf(name, allowed));
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

/**
 * `Y-m-d`, UTC, whole days at both ends. `?date_from=yesterday` is a 400, and so
 * is `?date_from=` — the pattern is what refuses both, so the empty string is a
 * refusal here rather than the absence this file used to read it as.
 *
 * The literal is carried beside the regex because the refusal **prints the regex
 * at the person**: `notMatching()`'s docblock records that the pattern family is
 * the only one that names neither the legal set nor the offending value, and a
 * screen rendering it verbatim shows `^\d{4}-\d{2}-\d{2}$` to a shopkeeper. A
 * date control is what keeps it unreachable.
 */
const YMD_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const YMD = new RegExp(YMD_PATTERN);

/**
 * **`channel` is declared as a key pattern and not as an enum**, and
 * `NotificationController` says why in as many words: §29's other four channels
 * are one class plus one `add()` away, and a filter that had to be edited to see
 * them would be found the hard way.
 *
 * So an unknown *key* is a 200 with 0 rows and a non-key is a 400 — the
 * asymmetry `lib/notifications.ts:95-110` is built on, and the reason the panel
 * labels the channels it knows and renders an unknown one as itself.
 */
const CHANNEL_KEY_PATTERN = "^[a-z0-9_-]{1,32}$";
const CHANNEL_KEY = new RegExp(CHANNEL_KEY_PATTERN);

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
  /*
   * **`""` is a refusal on four of these six and this file read all six as
   * absence.** Measured live 2026-08-28, one parameter at a time, and it is the
   * `orderby=""`/`order=""` finding from the coupons audit arriving on a
   * collection with no sort at all:
   *
   *   ?status=       400  "status is not one of pending, sent, and failed."
   *   ?channel=      400  "channel does not match pattern ^[a-z0-9_-]{1,32}$."
   *   ?subject_id=   400  "subject_id is not of type integer."
   *   ?date_from=    400  the pattern sentence
   *   ?dedupe_key=   200  every row — `maxLength` only, and `''` is a legal
   *                       string the repository then treats as no filter
   *   ?recipient=    200  likewise
   *
   * Only a parameter that is **not sent at all** reaches the default, which is
   * exactly what `pagingNumber()`'s docblock already records for `per_page`.
   * `listParams()` in the screen's own `query.ts` never sends an empty one, so
   * nothing reaches these from the panel today — the mock being the more
   * forgiving of the two is the whole reason to say so.
   */
  const status = params.get("status");
  if (status !== null && !NOTIFICATION_STATUSES.includes(status)) {
    return invalidParam("status", notOneOf("status", NOTIFICATION_STATUSES));
  }

  /*
   * **`channel` is a key pattern, not an enum, and the two refuse differently.**
   * `?channel=nonsense` is a **200 with 0 rows** because `nonsense` is a legal
   * key that matches nothing; `?channel=NOT-A-KEY!!`, `?channel=EMAIL` and
   * `?channel=` are **400s** because none of the three is a key at all.
   *
   * This file honoured the filter and validated nothing, so the second row above
   * was a 200 here and a 400 on the wire — the divergence the notifications
   * honesty audit was handed. The uppercase case is the one worth knowing:
   * `sanitize_key` would lowercase it, but `validate_callback` runs first, so
   * `EMAIL` never reaches the sanitiser.
   */
  const channel = params.get("channel");
  if (channel !== null && !CHANNEL_KEY.test(channel)) {
    return invalidParam("channel", notMatching("channel", CHANNEL_KEY_PATTERN));
  }

  /*
   * `minimum: 1`, so `?subject_id=0` is a 400 rather than the unset value it
   * looks like — and `?subject_id=abc` is the **type** sentence, not the range
   * one. This file answered the range sentence to both, which is a message a
   * form could quote back at somebody who had typed a word.
   */
  const subjectRead = pagingNumber(params, "subject_id", null, (value) =>
    value >= 1 ? null : "subject_id must be greater than or equal to 1",
  );
  if (subjectRead.error) return subjectRead.error;

  for (const name of ["date_from", "date_to"]) {
    const raw = params.get(name);
    if (raw !== null && !YMD.test(raw)) {
      return invalidParam(name, notMatching(name, YMD_PATTERN));
    }
  }

  /*
   * **191 on both, and this file capped neither.** The columns are `varchar(191)`
   * and the route declares the length; a 192-character value is a 400 in the
   * `rest_too_long` family, which is a fifth sentence shape and is written out
   * here rather than folded into one of the four.
   */
  for (const name of ["dedupe_key", "recipient"]) {
    const raw = params.get(name);
    if (raw !== null && raw.length > 191) {
      return invalidParam(name, `${name} must be at most 191 characters long.`);
    }
  }

  /*
   * **Case-insensitive, because the comparison happens in MySQL.** Every filter
   * below is a `WHERE col = %s` against a `utf8mb4_unicode_520_ci` column, so
   * `?recipient=AMINA@EXAMPLE.TEST` answers the same three rows as the lowercase
   * form — measured live 2026-08-28 — and `?dedupe_key=ORDER.PLACED:4775`
   * answers the one row too. This file compared with `===` and was therefore
   * **stricter than the shop**, which §0 names as the quieter direction and not
   * the safer one: a screen linking a `dedupe_key` out of a row it had upcased
   * would find nothing here and work in production, or the reverse.
   *
   * Still exact and never a substring: it is `=` and not `LIKE`, so a customer
   * whose address is a prefix of another's must not collect their queue.
   */
  const equals = (name, key) => {
    const value = params.get(name);
    if (value === null || value === "") return null;
    const wanted = value.toLowerCase();
    return (row) => String(row[key]).toLowerCase() === wanted;
  };

  /*
   * **A date that passes the pattern and is not a date matches nothing**, and
   * that is measured rather than assumed. `?date_from=2026-13-45` satisfies
   * `^\d{4}-\d{2}-\d{2}$`, reaches MySQL as `'2026-13-45 00:00:00'`, and the
   * comparison against a `DATETIME` column is never true — the server logs
   * *Incorrect DATETIME value* twice, once for the page and once for the count,
   * and answers **200 with `total: 0`**. Measured live 2026-08-28 on both bounds.
   *
   * A plain string comparison would have answered 0 rows on `date_from` by
   * accident and **every row** on `date_to`, since `"2026-08-21" <= "2026-13-45"`
   * is true — a filter that widens instead of narrowing, which is the shape a
   * screen never notices.
   */
  const realDate = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  };
  const bound = (name, compare) => {
    const value = params.get(name);
    if (value === null || value === "") return null;
    return realDate(value) ? (row) => compare(row.created_at.slice(0, 10), value) : () => false;
  };

  const subjectId = subjectRead.value;
  const tests = [
    equals("channel", "channel"),
    equals("status", "status"),
    equals("dedupe_key", "dedupe_key"),
    equals("recipient", "recipient"),
    subjectId === null ? null : (row) => row.subject_id === subjectId,
    bound("date_from", (created, value) => created >= value),
    bound("date_to", (created, value) => created <= value),
  ].filter((test) => test !== null);

  const rows = notificationRows().filter((row) => tests.every((test) => test(row)));
  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

/* ------------------------------------------------- notification single read --- */

/**
 * The queue as it reads **now**: the seeds, with any row a retry has requeued
 * replaced by what it wrote. Order is untouched — see `state.notifications`.
 */
const notificationRows = () =>
  NOTIFICATIONS.map((row) => state.notifications.get(row.id) ?? row);

const notificationRow = (id) => notificationRows().find((row) => row.id === id);

const notificationNotFound = () => fail(404, "not_found", "No notification with that id.");

/**
 * ── The collection's *routing* 404, and it is NOT this file's `notFound()` ────
 *
 * Measured live 2026-08-28, both 404s read through `ErrorNormalizer` the way
 * `serve_request()` applies it:
 *
 *   GET /notifications/999999   404 {"code":"not_found",
 *                                    "message":"No notification with that id."}
 *   GET /notifications/abc      404 {"code":"not_found",
 *                                    "message":"No route was found matching the
 *                                               URL and request method."}
 *
 * **Both are `not_found`. Only the sentence differs.** The route regex is
 * `(?P<id>\d+)`, so `abc` never reaches the controller and WordPress raises
 * `rest_no_route` — and `ErrorNormalizer::CODE_MAP` rewrites that to `not_found`
 * on the way out, so `rest_no_route` is a code no client of this API can
 * receive. This file's shared `notFound()` emits it anyway, which is the
 * carried-forward entry DECISIONS.md already records as cross-collection
 * (`/campaigns`, `/products`, `/coupons`). Fixed **here only**, because the
 * shared helper answers for eighteen other collections and changing it is not
 * this branch's to make; the ledger entry narrows rather than closes.
 *
 * The distinction is load-bearing for this screen and for no other: the detail
 * page's `page.tsx` guards `/^\d+$/` itself and calls `notFound()` before
 * fetching, precisely so a non-numeric id renders "no such notification" instead
 * of an error — a guard that can only be justified while the two 404s really are
 * two different facts.
 */
const notificationNoRoute = () =>
  fail(404, "not_found", "No route was found matching the URL and request method.");

/**
 * `GET /notifications/{id}` — **the list row plus `message`, and nothing else.**
 *
 * `NotificationPresenter::full()` is literally `self::row($row) + ['message' =>
 * …]`, and the fact was verified request-for-request on 2026-08-28 rather than
 * read off that line: a live detail's keys are the list row's thirteen in the
 * same order with `message` fourteenth, and the row is **value-identical** to
 * its own entry in the listing once `message` is removed. So this reuses the row
 * object rather than rebuilding one, which is the only way the two cannot drift.
 *
 * **There is no `meta` on the response.** `show()` passes none and
 * `Response::successPayload()` omits an empty one, so a detail body is
 * `{success, data}` — checked, because `parseList()` in the unit suite would
 * accept a `meta` that should not be there.
 */
function notificationDetail(id) {
  const row = notificationRow(id);
  if (row === undefined) return notificationNotFound();

  const context = NOTIFICATION_PAYLOADS.get(id);

  /*
   * `readable: false` is three empty fields and `context` as a JSON **array**,
   * not an object — PHP's empty array serialising — which is why
   * `notificationMessage` in the schemas is a union rather than a `z.record()`.
   */
  const message =
    context === null || context === undefined
      ? { readable: false, subject: "", body: "", context: [] }
      : { readable: true, ...renderNotificationMessage(row.event, context), context };

  return ok({ ...row, message });
}

/**
 * `POST /notifications/{id}/retry` — **a 202 that mails nothing.**
 *
 * The three things this reproduces, each of which a screen can be wrong about:
 *
 *   **The body is a list row, with no `message` key.** `retry()` calls
 *   `NotificationPresenter::row()` where `show()` calls `full()`, so the obvious
 *   implementation — hand the response straight back to the detail screen — would
 *   silently blank the quoted record. `lib/api/schemas/notification.ts:112-120`
 *   pins it and says why, and `NotificationDetail.tsx` re-reads rather than
 *   rebinding.
 *
 *   **The whole answer is in `meta`.** `already_pending` is the difference
 *   between "this went back in the queue" and "it was already there", both 202
 *   and both successes, and `drain` names the command that will actually send —
 *   the reason the status is 202 and not 200.
 *
 *   **`already_pending` is the status *before* the request**, read off `$before`
 *   in `NotificationService::retry()`. Not the status after, which is `pending`
 *   either way, and not the `UPDATE`'s affected-row count: `requeue()`'s own
 *   docblock records that reading the count as if it could answer this shipped a
 *   bug once, because MySQL reports rows it *changed*, so an already-queued row
 *   answered "already sent" about a row that had never been sent.
 *
 * The write itself is `requeue()`'s three columns and no more: `status` to
 * `pending`, `attempts` to 0, `last_error` to NULL. `sent_at` is untouched, and
 * on every row that can reach here it is already null.
 */
function retryNotification(id) {
  const row = notificationRow(id);
  if (row === undefined) return notificationNotFound();

  /*
   * **The one refusal in §90**, and the sentence is quoted from
   * `NotificationService::retry()` rather than written here —
   * `lib/notifications.ts:250-262` records the same string from the live shop.
   * It cannot be provoked against that shop today (all 25 rows are `pending`),
   * so this is a fixture for a measured refusal rather than an invented one.
   *
   * `details` carries both keys because the panel renders the date, and reading
   * the 409 body rather than hard-coding what a conflict means is a house rule.
   */
  if (row.status === "sent") {
    return conflict(
      "That notification has already been sent. Re-sending would deliver a message frozen when it was queued.",
      { status: row.status, sent_at: row.sent_at },
    );
  }

  const alreadyPending = row.status === "pending";
  const next = { ...row, status: "pending", attempts: 0, last_error: null };
  state.notifications.set(id, next);

  return {
    status: 202,
    body: {
      success: true,
      data: next,
      meta: {
        queued: true,
        already_pending: alreadyPending,
        drain: "wp algerian-commerce send-notifications",
      },
    },
  };
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

/* ------------------------------------------------------- the CMS queries --- */

/**
 * `?status=`, and **the default is `publish`**.
 *
 * The one filter in this panel that inverts, reproduced in one place so no
 * collection under `/cms/` can drift out of step with the others. See the CMS
 * fixture header for why a forgiving reading here would be the most destructive
 * single divergence available on this branch.
 *
 * `""` and `trash` both land in the enum refusal: the first because the empty
 * string is not a member here the way it is on `/coupons`, the second because
 * the trash is reached by `DELETE` and is readable through no filter at all.
 * `notOneOf` writes the three with the Oxford comma WordPress uses — *"status is
 * not one of publish, draft, and any."* — and the full stop that every enum
 * refusal in this file carries.
 */
function readContentStatus(params) {
  const raw = params.get("status");
  if (raw === null) return { value: "publish" };
  if (!CONTENT_STATUS_FILTERS.includes(raw)) {
    return { error: invalidParam("status", notOneOf("status", CONTENT_STATUS_FILTERS)) };
  }
  return { value: raw };
}

/**
 * `any` is publish **plus draft** and never the trash, which is the half a
 * "return everything" implementation would get wrong while looking correct on
 * every screen that has no trashed row in front of it.
 */
const matchesContentStatus = (row, filter) =>
  filter === "any" ? CONTENT_STATUSES.includes(row.status) : row.status === filter;

/* ------------------------------------------------------------------ pages --- */

/**
 * The index row: **less than a page, deliberately**.
 *
 * No `content`, no `seo`, no `excerpt` — the first is a whole page body per row
 * and the second a `SeoResolver` pass per row, so an index carrying them would
 * cost what opening every page at once costs. The backend asserts the omission
 * so it cannot drift back, and projecting it here from the one stored object is
 * what stops a key added to the document leaking into the index by being
 * forgotten.
 *
 * `option` and `functional` are this file's bookkeeping and are on neither
 * projection: the API expresses them as a `DELETE` refusal and as
 * `meta.excluded_system`, never as fields on a row.
 */
const pageRowOf = (page) => ({
  id: page.id,
  path: page.path,
  slug: page.slug,
  parent_path: page.parent_path,
  status: page.status,
  title: page.title,
  menu_order: page.menu_order,
  date_created: page.date_created,
  date_modified: page.date_modified,
});

/**
 * The whole document, which is what `GET /cms/pages/{path}` answers.
 *
 * `option` and `functional` are dropped rather than destructured away, because a
 * rest-destructure would leave two bound-and-unused names and the lint baseline
 * is what tells this repo that a warning is new.
 */
const pageDocumentOf = (page) => {
  const document = { ...page };
  delete document.option;
  delete document.functional;
  return document;
};

/** Every page this process can see, seeded and created, through the write state. */
const allPages = () => [
  ...PAGE_SEED.map((row) => state.pages.get(row.id) ?? row),
  ...state.createdPages.map((id) => state.pages.get(id)),
];

/**
 * **Ordered by title on the server**, which is the one departure this route
 * makes from `baseArgs()`'s `menu_order` default.
 *
 * Every page in this shop carries `menu_order` 0, so the default degenerates to
 * newest-first — an index in which the page somebody is looking for moves every
 * time another page is added. `app/[locale]/(panel)/content/pages/query.ts`
 * records the reasoning and is why there is no `orderby` control on that screen.
 *
 * Folded, like every other comparison in this file, so a collation that depends
 * on the runtime's ICU build cannot make a screenshot differ between machines.
 * The id is the tie-break and it matters: the two colliding `ac-unpublished`
 * rows must land in the same order in every process or the collision capture is
 * not byte-stable.
 */
const byPageTitle = (a, b) => {
  const left = fold(a.title);
  const right = fold(b.title);
  if (left < right) return -1;
  if (left > right) return 1;
  return a.id - b.id;
};

/**
 * `GET /cms/pages` — the route `feat/cms-page-index` added to the backend
 * because this screen was not buildable without it.
 *
 * **`meta.excluded_system` is the count of functional pages this listing left
 * out**, and the footnote on the index renders it: the shop's own `shop`,
 * `cart`, `checkout` and `my-account` have a block or a shortcode for a body, so
 * the count here is short of what wp-admin reports and saying so is cheaper than
 * the bug report. That those four are omitted is measured; that the count is
 * computed **against this listing's status filter** rather than over the whole
 * shop is this file's reading — all four are published, so the two agree
 * everywhere except `?status=draft`, where this answers 0.
 */
function pagesListing(params) {
  const filter = readContentStatus(params);
  if (filter.error) return filter.error;

  const matching = allPages().filter((row) => matchesContentStatus(row, filter.value));
  const excluded = matching.filter((row) => row.functional);

  // Title and body, **never the path** — `WP_Query`'s `s` does not search
  // `post_name`, so on the one resource whose address is its path a path cannot
  // be searched for. `path` is deliberately absent from this list.
  const searched = searchRows(
    matching.filter((row) => !row.functional),
    params,
    (row) => [row.title, row.content],
  );

  const page = paginate([...searched].sort(byPageTitle), params);
  if (page.error) return page.error;
  return ok(page.rows.map(pageRowOf), { ...page.meta, excluded_system: excluded.length });
}

/**
 * `get_page_by_path()`, reproduced — **it resolves exactly one row and there may
 * be more than one.**
 *
 * `wp_unique_post_slug()` does not run for a draft, so nothing stops two pages
 * sharing a path: measured before the seed cleaned this shop, 53 rows answered to
 * `ac-unpublished` and 27 to `conditions`, and the other 78 could not be read,
 * written or deleted through this route at all. The panel cannot tell which row
 * it would reach, which is why the index refuses to link a colliding one.
 *
 * **That exactly one resolves is the shop's; that it is the lowest id is this
 * file's.** Nothing published which of a colliding pair `get_page_by_path()`
 * returns. Lowest id is stable, is what an unordered `WP_Query` over `posts`
 * tends to give, and — more to the point — is a *choice written down* rather
 * than an accident of array order that would move the first time the seed grew.
 *
 * The status filter runs **before** the resolution, which is the measurement the
 * whole Pages index exists for: `?status=` filters a single read rather than
 * widening it, so `GET /cms/pages/privacy-policy` at the default `publish` is a
 * 404 about a draft that is sitting right there — with the same message a path
 * that does not exist gets.
 */
function resolvePage(path, filter) {
  const matches = allPages().filter(
    (row) => row.path === path && matchesContentStatus(row, filter),
  );
  return matches.sort((a, b) => a.id - b.id)[0];
}

const pageNotFound = () => fail(404, "not_found", "No page at that path.");

/* ------------------------------------------------------------ page writes --- */

/**
 * **Read-only and dropped in silence**, the rule products and coupons already
 * share: a client has to be able to PATCH a GET body back without diffing it
 * first, and `content` and `excerpt` reading back as rendered HTML is what makes
 * that the form's actual behaviour here rather than a nicety.
 *
 * `path` is on this list rather than in the rules below because it is *derived*
 * — `parent_path` plus `slug` — so accepting it would give a client two ways to
 * say one thing and a way to make them disagree. `slug` renames and
 * `parent_path` moves; that pair is the whole address API, and §88's
 * `pinRouteParams()` is why the route's own capture is `{path}` and not `{slug}`.
 */
const PAGE_READ_ONLY = ["id", "path", "parent_id", "image", "date_created", "date_modified"];

/**
 * The `seo` block's own rules, applied **key by key with dotted field names**,
 * because that is what the form binds to: `PageForm` reads
 * `fieldErrors["seo.title"]` and `fieldErrors["seo.canonical"]`. §89 says SEO
 * errors land in the same `details.fields` list as the rest of the write, and a
 * single `seo: "Invalid."` would be a message no control on that screen could
 * render.
 *
 * Everything the resolver derives — `og`, `structured_data`, `image`,
 * `overrides` — is dropped rather than refused, on the read-only rule above.
 */
const PAGE_SEO_RULES = {
  title: mustBeText,
  description: mustBeText,
  canonical: mustBeText,
  robots: (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? null
      : "Must be an object.",
};

const mustBeWholeNumber = (value) =>
  typeof value === "number" && Number.isInteger(value) ? null : "Must be a whole number.";

/**
 * `image_id`, and null is how a featured image is removed.
 *
 * **Nothing in the panel sends this on a page** — ADMIN_PANEL.md's Content
 * section records that a page's featured image is accepted here and that the
 * panel does not offer the control, because no read anywhere renders one back,
 * so it would be a control whose effect is invisible. The rule is here because
 * the field is, and because a media id that names nothing has to be refused
 * rather than stored blind: that is the defect `{"product_ids":[999999]}` was on
 * coupons, one collection over.
 */
const mustBeMediaId = (value) => {
  /*
   * **Both sentences here were this file's own words until the media branch, and
   * both are now the router's.** `BannerInput`/`PageInput` answer "Must be an
   * attachment id, or 0 to clear." for a bad shape, and
   * `CmsRepository::assertImageAttachment()` answers "{id} is not an image
   * attachment." for an id that names nothing. This file said "Must be a whole
   * number." and "No attachment with id 5001." — two of the six invented CMS
   * refusals DECISIONS.md carries, settled by reading `src/CMS/` rather than by
   * a request-for-request diff, which still has not been run on that collection.
   *
   * **`0` clears, and it was refused here.** `null`, `""` and `0` all mean "no
   * image" to both inputs; this rule looked `0` up as an id, found nothing and
   * answered 400, so one of the three documented ways to remove a banner's
   * picture was unreachable against the harness. That is the *stricter*
   * direction.
   *
   * Still stricter in one place, deliberately: `is_numeric("5001")` is true at
   * the shop and a numeric **string** is accepted there. Reproducing that needs a
   * coercion channel `readContentBody()` does not have — it stores the value it
   * was given — so `"5001"` is refused here and the divergence is named rather
   * than half-built.
   */
  if (value === null || value === "" || value === 0) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return "Must be an attachment id, or 0 to clear.";
  }
  return mediaRows().some((row) => row.id === value)
    ? null
    : `${value} is not an image attachment.`;
};

const PAGE_FIELD_RULES = {
  title: mustBeText,
  slug: mustBeText,
  parent_path: mustBeText,
  status: mustBeOneOf(CONTENT_STATUSES),
  content: mustBeText,
  excerpt: mustBeText,
  menu_order: mustBeWholeNumber,
  image_id: mustBeMediaId,
};

/**
 * Read a page write body, validating as it goes.
 *
 * The gates run in the order the API applies them, so the reason on screen is
 * the reason the server would have given:
 *
 *   1. every bad field at once   400 `details.fields`, unknown keys and invalid
 *                                values together, because the form renders one
 *                                message per control. Read-only keys never reach
 *                                this pass
 *   2. `parent_path` resolution  the same pass — **a path naming nothing is a
 *                                400 on that field**, measured, rather than an
 *                                orphan created quietly. `parentPathOf()` in
 *                                lib/cms.ts exists for display and for
 *                                pre-filling a form, and explicitly not for
 *                                deciding whether a move is legal, because this
 *                                is where that is decided
 *   3. `title` and `slug` on a   both required on a create; neither is required
 *      create                    on a PATCH
 *
 * **The generic sentence is this file's, patterned on the one that was
 * measured.** `PATCH /coupons/{id} {"code":""}` answers *"The coupon is
 * invalid."* with the per-field detail beside it; nothing published the page
 * route's own wording. The *shape* is measured — `invalid_request` with
 * `details.fields`, which is what `PageForm` binds to — and the sentence is not.
 * A screen that quoted it back would be quoting this file.
 */
function readPageBody(body, creating) {
  const source = body === null || typeof body !== "object" || Array.isArray(body) ? {} : body;

  const fields = {};
  const writes = {};

  for (const [key, value] of Object.entries(source)) {
    if (PAGE_READ_ONLY.includes(key)) continue;

    if (key === "seo") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        fields.seo = "Must be an object.";
        continue;
      }
      const seo = {};
      for (const [seoKey, seoValue] of Object.entries(value)) {
        const seoRule = PAGE_SEO_RULES[seoKey];
        // Everything the resolver derives is dropped rather than refused: the
        // form sends back the block it was given, `og` and all.
        if (seoRule === undefined) continue;
        const seoProblem = seoRule(seoValue);
        if (seoProblem === null) seo[seoKey] = seoValue;
        else fields[`seo.${seoKey}`] = seoProblem;
      }
      writes.seo = seo;
      continue;
    }

    const rule = PAGE_FIELD_RULES[key];
    if (rule === undefined) {
      fields[key] = "Unknown field.";
      continue;
    }
    const problem = rule(value);
    if (problem === null) writes[key] = value;
    else fields[key] = problem;
  }

  /*
   * **A `parent_path` naming nothing is a 400 on that field** — measured, and
   * the reason `PageForm` assembles the next address only to *warn* with it. An
   * empty string is the root and is always legal.
   *
   * The sentence quotes the offending value back and names no legal set, which
   * is the fourth refusal family in this file (`unknownOf`): the set here is
   * every path in the shop and could not be printed.
   */
  if (typeof writes.parent_path === "string" && writes.parent_path !== "") {
    const parent = allPages().find((row) => row.path === writes.parent_path);
    if (parent === undefined) {
      fields.parent_path = `No page at path "${writes.parent_path}".`;
    }
  }

  if (creating) {
    if (!("title" in writes) && fields.title === undefined) fields.title = "Required.";
    if (!("slug" in writes) && fields.slug === undefined) fields.slug = "Required.";
    if (writes.slug === "") fields.slug = "Required.";
  }

  if (Object.keys(fields).length > 0) {
    return { error: invalidBody("The page is invalid.", fields) };
  }
  return { writes };
}

/**
 * The stored row after a write, and the two normalisations that make a read
 * differ from what was sent.
 *
 *   `content`/`excerpt`  stored **rendered** — `<p>…</p>\n` — and PATCHing that
 *                        rendered form back does not accumulate another wrapper.
 *                        Verified over three round trips on the live shop, and
 *                        it is what makes binding a form straight to the
 *                        response safe here where a coupon's `date_expires` made
 *                        it unsafe there. So a body that already looks like
 *                        markup is stored as it stands.
 *   `path`               derived from `parent_path` and `slug`, never sent.
 *                        `slug` renames and `parent_path` moves, and the address
 *                        is the two of them joined.
 *
 * `seo` is re-derived rather than merged, because every value in it except the
 * overrides is a function of the title and the excerpt — which is exactly what
 * the form's placeholder treatment is built on.
 *
 * No clock: `date_modified` keeps its seeded value through a write, the way a
 * product's and a coupon's do, because a screenshot has to be byte-stable.
 */
const renderedHtml = (value) => (/^\s*<[a-z]/i.test(value) || value === "" ? value : `<p>${value}</p>\n`);

function applyPageWrites(current, writes) {
  const next = { ...current };

  for (const [key, value] of Object.entries(writes)) {
    switch (key) {
      case "content":
      case "excerpt":
        next[key] = renderedHtml(String(value));
        break;
      case "seo":
        /*
         * `overrides` names the keys somebody set **by hand**, and it is written
         * from the body rather than merged: a field sent with a value is an
         * override, a field sent empty is a person clearing one, and a field not
         * sent at all leaves the list as it was. That is exactly what the form's
         * placeholder treatment depends on — an underived field starts empty
         * with the derived value behind it, and typing into it is what promotes
         * the key.
         */
        next.seoOverrides = ["title", "description"].filter((field) =>
          field in value
            ? typeof value[field] === "string" && value[field] !== ""
            : current.seo.overrides.includes(field),
        );
        next.seoRobots = value.robots ?? current.seo.robots;
        break;
      case "image_id":
        next.image = value === null ? null : embeddedImageOf(value);
        break;
      default:
        next[key] = value;
    }
  }

  next.path = [next.parent_path, next.slug].filter((part) => part !== "").join("/");
  next.parent_id =
    next.parent_path === ""
      ? 0
      : (allPages().find((row) => row.path === next.parent_path)?.id ?? 0);
  next.seo = pageSeoOf(
    next.title,
    next.excerpt,
    next.path,
    next.status,
    next.seoOverrides ?? current.seo.overrides,
  );
  if (next.seoRobots !== undefined) next.seo.robots = next.seoRobots;
  delete next.seoOverrides;
  delete next.seoRobots;

  return next;
}

/**
 * `POST /cms/pages`.
 *
 * **201**, which ADMIN_PANEL.md states outright in §89's correction block — the
 * sentence about `status` argues that without drafts, `POST /cms/pages` "answers
 * 201 for a resource whose `GET` is a 404". So the status is on the record even
 * though nobody wrote the request down, and it agrees with the three creates
 * that *were* measured on 2026-08-25.
 *
 * `status` defaults to **`draft`**, unlike a coupon's `publish`: §89 added
 * drafts to this surface precisely so a page could be staged, and the create
 * form's own default is `draft`.
 */
const blankPage = (id) => ({
  id,
  path: "",
  slug: "",
  parent_path: "",
  status: "draft",
  title: "",
  content: "",
  excerpt: "",
  parent_id: 0,
  menu_order: 0,
  image: null,
  seo: pageSeoOf("", "", "", "draft"),
  date_created: iso(0),
  date_modified: iso(0),
  option: null,
  functional: false,
});

function createPage(body) {
  const parsed = readPageBody(body, true);
  if (parsed.error) return parsed.error;

  const id = state.nextPageId++;
  const page = applyPageWrites(blankPage(id), parsed.writes);
  state.pages.set(id, page);
  state.createdPages = [...state.createdPages, id];
  return created(pageDocumentOf(page));
}

/**
 * `PATCH /cms/pages/{path}`, and **`meta.path_changed`**.
 *
 * A rename leaves nothing behind at the old address — WordPress writes no
 * redirect — so every storefront link built on it becomes a 404 the moment the
 * save lands. The API reports the move *afterwards* in `meta`, which is too late
 * to be a decision, and that is why `PageForm` raises its own confirmation
 * before it sends rather than reading this. It is emitted anyway because it is
 * part of the response.
 */
function patchPage(current, body) {
  const parsed = readPageBody(body, false);
  if (parsed.error) return parsed.error;

  const next = applyPageWrites(current, parsed.writes);
  state.pages.set(current.id, next);

  return next.path === current.path
    ? ok(pageDocumentOf(next))
    : ok(pageDocumentOf(next), { path_changed: true });
}

/**
 * `DELETE /cms/pages/{path}`, and **`?force=true` does not mean here what it
 * means anywhere else in this file.**
 *
 * On a product and on a coupon, `force` is *permanence*: it turns a trash into a
 * removal. Here it overrides **one specific guard and not the other**, and the
 * asymmetry is measured and deliberate:
 *
 *   children      409 `details.children` and `details.child_ids`. WordPress
 *                 would promote them to the root, changing every one of their
 *                 paths and reporting nothing. **`?force=true` means it** and
 *                 reparents them — recoverable, so overridable.
 *   an option     409 `details.option`. **`?force=true` does not override it**,
 *                 because leaving `woocommerce_checkout_page_id` pointing at
 *                 nothing makes WooCommerce report a missing page rather than a
 *                 broken setting, and the fix is to clear the setting — which is
 *                 the decision actually being made.
 *
 * The option guard is checked first, so a page that is both option-referenced
 * and a parent reports the refusal force cannot lift. Which the shop reports
 * first is unmeasured; reporting the unliftable one is the reading that cannot
 * send somebody round a loop.
 *
 * The two 409 sentences are this file's. `PageForm` renders neither — it
 * branches on `details.option` and `details.children` and writes its own copy,
 * which is what §3's rule about naming the count is for — so the wording here is
 * diagnostic rather than something a screen quotes back.
 */
function deletePage(current, params) {
  if (current.option !== null) {
    return conflict("That page is referenced by a shop setting.", { option: current.option });
  }

  const children = allPages().filter(
    (row) => row.parent_path === current.path && row.status !== "trash",
  );
  const force = BOOLEANS.get(params.get("force") ?? "") === true;

  if (children.length > 0 && !force) {
    return conflict("That page has child pages.", {
      children: children.length,
      child_ids: children.map((row) => row.id),
    });
  }

  for (const child of children) {
    const moved = applyPageWrites(child, { parent_path: "" });
    state.pages.set(child.id, moved);
  }

  // Trashed rather than removed: the trash is what `?status=any` deliberately
  // does not reach, so the row leaves every listing and every path lookup at
  // once. Whether this route also offers a permanent delete is unmeasured — the
  // panel never asks for one, and `force` already means something else here.
  state.pages.set(current.id, { ...current, status: "trash" });
  return ok({ id: current.id, deleted: true });
}

/* --------------------------------------------------------------- homepage --- */

/**
 * The vocabulary **this process's shop** knows, which is eleven unless something
 * has asked for the twelfth.
 *
 * Split from `SECTION_TYPES` rather than merged into it so the measured list
 * stays a measurement: the eleven came out of a 400 on 2026-08-21 and nothing
 * has moved them. `MOCK_HOMEPAGE=future` models a backend that has gained a
 * type — the scenario `unknownSectionTypes()` in lib/cms.ts exists for — and
 * models it *consistently*: the reader passes `countdown` through and the
 * writer's own 400 names it, because a server that dropped a type it accepted
 * would be a shape nothing has ever seen.
 */
const SERVER_SECTION_TYPES =
  REQUESTED_HOMEPAGE === "future" ? [...SECTION_TYPES, "countdown"] : SECTION_TYPES;

/** The 400's sentence, in the API's own words. `oneOf` is the body-field family. */
const unknownSection = (value) =>
  `Unknown section type "${value}". One of: ${SERVER_SECTION_TYPES.join(", ")}.`;

const isSectionObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * `GET /cms/homepage` — the read that **drops** what it cannot parse and reports
 * it, against the `PUT` that **refuses** the same thing.
 *
 * §89 states the asymmetry deliberately: an option edited by hand must degrade,
 * and a form filled in by a person must not lose their work quietly. It has two
 * consequences this reader has to get exactly right:
 *
 * **`meta` is absent entirely when there is nothing to report.** Not an empty
 * array — measured — so code that destructured `meta.problems` would throw on
 * the healthy document and work on the broken one, which is the wrong way round
 * for a failure mode. `homepage/page.tsx` reads `result.meta?.problems` for that
 * reason and this is the fixture that makes the guard mean something: a
 * successful `PUT` leaves a clean document behind, so the very next `GET` in the
 * same process takes the no-`meta` path.
 *
 * **The positions are 1-based over the stored document.** The counter runs over
 * every entry including the dropped ones, so "Section 6" is the sixth thing in
 * the option and the fourth thing on screen. The seed interleaves its malformed
 * sections at 2, 4 and 6 precisely so that an off-by-one anywhere in the chain
 * is visible rather than vacuously correct.
 *
 * The three sentences are quoted from lib/cms.ts, which recorded them verbatim
 * from the shop — including the parenthesised type in the third, which is the
 * only one of the three that names anything about the section it dropped.
 */
function readHomepage() {
  const sections = [];
  const problems = [];

  state.homepage.forEach((entry, index) => {
    const at = index + 1;
    if (!isSectionObject(entry)) {
      problems.push(`Section ${at} is not an object.`);
      return;
    }
    if (!SERVER_SECTION_TYPES.includes(entry.type)) {
      problems.push(`Section ${at} has an unknown type "${entry.type}".`);
      return;
    }
    if (!isSectionObject(entry.data)) {
      problems.push(`Section ${at} ("${entry.type}") has a "data" that is not an object.`);
      return;
    }
    sections.push({ type: entry.type, data: entry.data });
  });

  return problems.length === 0 ? ok({ sections }) : ok({ sections }, { problems });
}

/**
 * `PUT /cms/homepage` — **one endpoint, two error shapes, and only one of them
 * is positional.**
 *
 *   a bad section   `sections[2].type` — measured, and the sentence names all
 *                   eleven types, which is the only place that vocabulary is
 *                   published at all
 *   more than 50    a flat **`sections`** — measured:
 *                   *"A homepage carries at most 50 sections; this one has 51."*
 *
 * A form that bound every homepage error to a row index would drop the second on
 * the floor, which is why `HomepageEditor` keeps `rowErrors` and `listError`
 * apart and why this has to be able to produce both.
 *
 * The cap is checked **first and answers alone**. Which the shop reports first
 * when a 51-section document also contains a bad one is unmeasured; the measured
 * body for the cap holds `sections` and nothing else, so answering it alone is
 * the shape that was actually seen.
 *
 * `PUT` replaces the document — there is no section-level route, because
 * sections are ordered and an API that let two clients insert at index 2
 * concurrently would have invented a merge problem the shop does not have. So a
 * successful write **repairs** the document by discarding whatever the read had
 * dropped, which is why the editor gates its save behind a confirmation naming
 * the count.
 */
function putHomepage(body) {
  const source = body === null || typeof body !== "object" || Array.isArray(body) ? {} : body;

  if (!Array.isArray(source.sections)) {
    return invalidBody("The homepage is invalid.", { sections: "Must be an array." });
  }

  if (source.sections.length > MAX_SECTIONS) {
    return invalidBody("The homepage is invalid.", {
      sections: `A homepage carries at most ${MAX_SECTIONS} sections; this one has ${source.sections.length}.`,
    });
  }

  const fields = {};
  source.sections.forEach((entry, index) => {
    if (!isSectionObject(entry)) {
      fields[`sections[${index}]`] = "Must be an object.";
      return;
    }
    if (!SERVER_SECTION_TYPES.includes(entry.type)) {
      fields[`sections[${index}].type`] = unknownSection(entry.type);
      return;
    }
    if (!isSectionObject(entry.data)) {
      fields[`sections[${index}].data`] = "Must be an object.";
    }
  });

  if (Object.keys(fields).length > 0) {
    return invalidBody("The homepage is invalid.", fields);
  }

  state.homepage = source.sections.map((entry) => ({ type: entry.type, data: entry.data }));
  // The write refused what the read would have dropped, so there is nothing to
  // report and `meta` is absent — the same shape a healthy document reads back
  // with, which is what makes the round trip whole.
  return readHomepage();
}

/* ---------------------------------------------------------------- banners --- */

/**
 * The embedded image, `MediaPresenter::image()`.
 *
 * Null on every seeded row in this shop and null is the common case — a banner
 * without a picture is a banner — so this exists only to answer a write:
 * `PATCH /cms/banners/{id} {"image_id": 5001}` is the one path through which the
 * object shape is reachable at all, and without it `embeddedImage` in the
 * panel's schema would have no fixture anywhere.
 */
function embeddedImageOf(id) {
  const item = mediaRows().find((row) => row.id === id);
  if (item === undefined) return null;
  return { id: item.id, url: item.url, alt: item.alt, width: item.width, height: item.height };
}

/** Every banner this process can see, in dense `position` order. */
const bannerRows = () =>
  [
    ...BANNER_SEED.map((row) => state.banners.get(row.id) ?? row),
    ...state.createdBanners.map((id) => state.banners.get(id)),
  ]
    .filter((row) => !state.bannersGone.has(row.id))
    .sort((a, b) => a.position - b.position || a.id - b.id);

/**
 * `image_url` is refused **by name**, and that is how the field was found rather
 * than guessed: the sentence names the two-step replacement.
 *
 * Everything else a banner takes is free-form. `placement` in particular is not
 * an enum on the API's side and is deliberately not validated here — where a
 * shop puts a banner is a shop's decision and the plugin is cloned per client,
 * so the screen offers the placements it finds in the data plus a free field and
 * a mock that refused an unseen one would make that field look broken.
 */
const BANNER_FIELD_RULES = {
  title: mustBeText,
  caption: mustBeText,
  link: mustBeText,
  placement: mustBeText,
  status: mustBeOneOf(CONTENT_STATUSES),
  position: mustBeWholeNumber,
  image_id: mustBeMediaId,
};

const BANNER_READ_ONLY = ["id", "image", "date_modified"];

const BANNER_NAMED_REFUSALS = {
  // `BannerInput::REFUSED`, verbatim — **including the quotes around the field
  // name**, which this file dropped. Another of the six invented CMS sentences,
  // settled the same way `mustBeMediaId`'s two were: by reading `src/CMS/`.
  image_url: 'Upload through POST /media and send the attachment id as "image_id".',
};

/**
 * One reader for banners, FAQs and FAQ categories, because the three differ only
 * in their tables.
 *
 * `named` is the refusal that says *which field to use instead*, and it is the
 * reason those fields were discovered at all: a generic "Unknown field." tells a
 * client that `category` is wrong and not that `categories` is right. The FAQ
 * writer carries four of them.
 */
function readContentBody(body, { rules, readOnly, named = {}, message }) {
  const source = body === null || typeof body !== "object" || Array.isArray(body) ? {} : body;

  const fields = {};
  const writes = {};

  for (const [key, value] of Object.entries(source)) {
    if (readOnly.includes(key)) continue;
    if (named[key] !== undefined) {
      fields[key] = named[key];
      continue;
    }
    const rule = rules[key];
    if (rule === undefined) {
      fields[key] = "Unknown field.";
      continue;
    }
    const problem = rule(value);
    if (problem === null) writes[key] = value;
    else fields[key] = problem;
  }

  return Object.keys(fields).length > 0
    ? { error: invalidBody(message, fields) }
    : { writes };
}

function bannersListing(params) {
  const filter = readContentStatus(params);
  if (filter.error) return filter.error;

  const rows = bannerRows().filter((row) => matchesContentStatus(row, filter.value));
  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

const applyBannerWrites = (current, writes) => {
  const next = { ...current };
  for (const [key, value] of Object.entries(writes)) {
    if (key === "image_id") next.image = value === null ? null : embeddedImageOf(value);
    else next[key] = value;
  }
  return next;
};

const blankBanner = (id) => ({
  id,
  title: "",
  caption: "",
  link: "",
  placement: "",
  status: "draft",
  // Appended at the end of the dense run, which is what the sheet sends anyway.
  position: bannerRows().length,
  image: null,
  date_modified: iso(0),
});

function createBanner(body) {
  const parsed = readContentBody(body, {
    rules: BANNER_FIELD_RULES,
    readOnly: BANNER_READ_ONLY,
    named: BANNER_NAMED_REFUSALS,
    message: "The banner is invalid.",
  });
  if (parsed.error) return parsed.error;

  const id = state.nextBannerId++;
  const banner = applyBannerWrites(blankBanner(id), parsed.writes);
  state.banners.set(id, banner);
  state.createdBanners = [...state.createdBanners, id];
  return created(banner);
}

function patchBanner(current, body) {
  const parsed = readContentBody(body, {
    rules: BANNER_FIELD_RULES,
    readOnly: BANNER_READ_ONLY,
    named: BANNER_NAMED_REFUSALS,
    message: "The banner is invalid.",
  });
  if (parsed.error) return parsed.error;

  const next = applyBannerWrites(current, parsed.writes);
  state.banners.set(current.id, next);
  return ok(next);
}

/**
 * `DELETE /cms/banners/{id}`, and `?force=true` changes **nothing** here.
 *
 * The banners screen always sends it, so the unforced path is never taken by the
 * panel and nobody has measured what it does. WordPress would ordinarily trash a
 * custom post type without it — but "ordinarily" is not a measurement, and
 * inventing a trash arm would grow a state no screen can reach and no request has
 * seen. So both spellings remove the row, and this comment is the record of the
 * gap rather than a silent guess in either direction. The same holds for FAQs.
 */
function deleteBanner(current) {
  state.banners.delete(current.id);
  state.createdBanners = state.createdBanners.filter((id) => id !== current.id);
  state.bannersGone.add(current.id);
  return ok({ id: current.id, deleted: true });
}

/* ------------------------------------------------------------------- FAQs --- */

/** Every category this process can see. */
const faqCategoryRows = () =>
  [
    ...FAQ_CATEGORY_SEED.map((row) => state.faqCategories.get(row.id) ?? row),
    ...state.createdFaqCategories.map((id) => state.faqCategories.get(id)),
  ].filter((row) => !state.faqCategoriesGone.has(row.id));

/** Every FAQ this process can see, in dense `position` order. */
const faqRows = () =>
  [
    ...FAQ_SEED.map((row) => state.faqs.get(row.id) ?? row),
    ...state.createdFaqs.map((id) => state.faqs.get(id)),
  ]
    .filter((row) => !state.faqsGone.has(row.id))
    .sort((a, b) => a.position - b.position || a.id - b.id);

/**
 * **`count` is on `/cms/faq-categories` and absent on the category embedded
 * inside an FAQ**, which is one seed published two ways.
 *
 * A screen that read `category.count` off an FAQ's own categories would get
 * `undefined` and render nothing — silently, on the half of the surface with the
 * most category objects in it — which is why the panel's schema marks it
 * optional and why the two projections are built here rather than written twice.
 */
const faqCategoryRef = ({ id, slug, name }) => ({ id, slug, name });

const faqCategoryRow = (category) => ({
  ...faqCategoryRef(category),
  ...(category.description === "" ? {} : { description: category.description }),
  count: faqRows().filter((faq) => faq.categorySlugs.includes(category.slug)).length,
});

/** The FAQ as the API publishes it: `categorySlugs` is this file's key, not the wire's. */
const faqOf = ({ categorySlugs, ...faq }) => ({
  ...faq,
  categories: categorySlugs
    .map((slug) => faqCategoryRows().find((category) => category.slug === slug))
    .filter((category) => category !== undefined)
    .map(faqCategoryRef),
});

function faqsListing(params) {
  const filter = readContentStatus(params);
  if (filter.error) return filter.error;

  const rows = faqRows().filter((row) => matchesContentStatus(row, filter.value));
  const page = paginate(rows, params);
  return page.error ?? ok(page.rows.map(faqOf), page.meta);
}

/**
 * `categories` takes the `{id, slug, name}` objects the read emits **or** a bare
 * list of slugs or ids, which is what lets a read body PATCH back unchanged.
 *
 * An unknown category is refused rather than dropped — §89's build note records
 * the first version creating an FAQ and *then* refusing it for an unknown
 * category, which is the same defect as a menu emptied before its tree was
 * validated. Resolve every reference before the first write.
 */
const mustBeFaqCategories = (value) => {
  if (!Array.isArray(value)) return "Must be an array.";
  const known = faqCategoryRows();
  const unknown = value.filter((entry) => {
    const slug = typeof entry === "object" && entry !== null ? entry.slug : entry;
    return !known.some((category) => category.slug === slug || category.id === slug);
  });
  if (unknown.length === 0) return null;
  const names = unknown.map((entry) =>
    typeof entry === "object" && entry !== null ? String(entry.slug) : String(entry),
  );
  return `No FAQ category ${names.map((name) => `"${name}"`).join(", ")}.`;
};

const FAQ_FIELD_RULES = {
  question: mustBeText,
  answer: mustBeText,
  status: mustBeOneOf(CONTENT_STATUSES),
  position: mustBeWholeNumber,
  categories: mustBeFaqCategories,
};

const FAQ_READ_ONLY = ["id", "date_modified"];

/**
 * **Four fields refused by name, and only the first sentence is measured.**
 *
 * `lib/api/schemas/cms.ts` quotes the `category` one verbatim — *"Use
 * \"categories\" — an FAQ may sit in more than one."* — and records that "three
 * more are refused the same way: `title` (use `question`), `content` (use
 * `answer`) and `menu_order` (use `position`)". So *that* they are refused by
 * name and *which* field each names are on the record; the wording of the other
 * three is not, and is written here to the measured one's shape.
 *
 * The load-bearing half is the replacement, not the prose: a client that sent
 * `title` learns to send `question`, which a generic "Unknown field." could
 * never teach it. Flagged rather than presented as measurement, because a
 * fabricated message is as dishonest as a fabricated status code and harder to
 * notice — the coupons branch shipped a screen quoting one back.
 */
const FAQ_NAMED_REFUSALS = {
  category: 'Use "categories" — an FAQ may sit in more than one.',
  title: 'Use "question" — an FAQ has a question rather than a title.',
  content: 'Use "answer" — an FAQ has an answer rather than content.',
  menu_order: 'Use "position" — an FAQ is ordered by position.',
};

const applyFaqWrites = (current, writes) => {
  const next = { ...current };
  for (const [key, value] of Object.entries(writes)) {
    if (key === "categories") {
      next.categorySlugs = value.map((entry) => {
        const slug = typeof entry === "object" && entry !== null ? entry.slug : entry;
        return faqCategoryRows().find(
          (category) => category.slug === slug || category.id === slug,
        ).slug;
      });
    } else if (key === "answer") {
      next.answer = renderedHtml(String(value));
    } else {
      next[key] = value;
    }
  }
  return next;
};

const blankFaq = (id) => ({
  id,
  question: "",
  answer: "",
  categorySlugs: [],
  status: "draft",
  position: faqRows().length,
  date_modified: iso(0),
});

function createFaq(body) {
  const parsed = readContentBody(body, {
    rules: FAQ_FIELD_RULES,
    readOnly: FAQ_READ_ONLY,
    named: FAQ_NAMED_REFUSALS,
    message: "The FAQ is invalid.",
  });
  if (parsed.error) return parsed.error;

  const id = state.nextFaqId++;
  const faq = applyFaqWrites(blankFaq(id), parsed.writes);
  state.faqs.set(id, faq);
  state.createdFaqs = [...state.createdFaqs, id];
  return created(faqOf(faq));
}

function patchFaq(current, body) {
  const parsed = readContentBody(body, {
    rules: FAQ_FIELD_RULES,
    readOnly: FAQ_READ_ONLY,
    named: FAQ_NAMED_REFUSALS,
    message: "The FAQ is invalid.",
  });
  if (parsed.error) return parsed.error;

  const next = applyFaqWrites(current, parsed.writes);
  state.faqs.set(current.id, next);
  return ok(faqOf(next));
}

function deleteFaq(current) {
  state.faqs.delete(current.id);
  state.createdFaqs = state.createdFaqs.filter((id) => id !== current.id);
  state.faqsGone.add(current.id);
  return ok({ id: current.id, deleted: true });
}

/* ------------------------------------------------------- FAQ categories --- */

/**
 * `GET /cms/faq-categories` exists only because §89's own table forgot it:
 * `POST` was listed and `GET` was not, so a panel could create a category it had
 * no way to list — and `FaqInput` refuses a category that does not exist, so it
 * could not even use one it had just made.
 *
 * `list()` rather than `paginate()`: no screen sends this route a parameter and
 * nothing reads its `meta`, so its envelope is **unverified** and `list()` is
 * this file's one place for that. See the helper's own list.
 */
const FAQ_CATEGORY_FIELD_RULES = {
  name: (value) => {
    if (typeof value !== "string") return "Must be a string.";
    return value.trim() === "" ? "A category needs a name." : null;
  },
  slug: mustBeText,
  description: mustBeText,
};

const FAQ_CATEGORY_READ_ONLY = ["id", "count"];

function createFaqCategory(body) {
  const parsed = readContentBody(body, {
    rules: FAQ_CATEGORY_FIELD_RULES,
    readOnly: FAQ_CATEGORY_READ_ONLY,
    message: "The category is invalid.",
  });
  if (parsed.error) return parsed.error;
  if (!("name" in parsed.writes)) {
    return invalidBody("The category is invalid.", { name: "A category needs a name." });
  }

  const id = state.nextFaqCategoryId++;
  const name = parsed.writes.name.trim();
  const category = {
    id,
    // The slug is derived from the name and is not what the caller sent, which
    // is `sanitize_title()`'s own behaviour and the reason the FAQ writer takes
    // slugs at all: they are the half that survives a backend re-seed.
    slug: parsed.writes.slug ?? slugify(name),
    name,
    description: parsed.writes.description ?? "",
  };
  state.faqCategories.set(id, category);
  state.createdFaqCategories = [...state.createdFaqCategories, id];
  return created(faqCategoryRow(category));
}

function patchFaqCategory(current, body) {
  const parsed = readContentBody(body, {
    rules: FAQ_CATEGORY_FIELD_RULES,
    readOnly: FAQ_CATEGORY_READ_ONLY,
    message: "The category is invalid.",
  });
  if (parsed.error) return parsed.error;

  const next = { ...current, ...parsed.writes };
  state.faqCategories.set(current.id, next);
  return ok(faqCategoryRow(next));
}

/**
 * **Deleting a category the FAQs are in is a 409 naming the count**, and
 * `?force=true` **detaches** them rather than deleting them.
 *
 * Two different outcomes, so the screen gives them two different confirmations —
 * and `details.faqs` is what it counts, which is why the number is in the
 * details rather than only in the sentence.
 */
function deleteFaqCategory(current, params) {
  const attached = faqRows().filter((faq) => faq.categorySlugs.includes(current.slug));
  const force = BOOLEANS.get(params.get("force") ?? "") === true;

  if (attached.length > 0 && !force) {
    return conflict("That category still has FAQs in it.", { faqs: attached.length });
  }

  for (const faq of attached) {
    state.faqs.set(faq.id, {
      ...faq,
      categorySlugs: faq.categorySlugs.filter((slug) => slug !== current.slug),
    });
  }

  state.faqCategories.delete(current.id);
  state.createdFaqCategories = state.createdFaqCategories.filter((id) => id !== current.id);
  state.faqCategoriesGone.add(current.id);
  return ok({ id: current.id, deleted: true });
}

/* ------------------------------------------------------------------ menus --- */

const menuNotFound = () => fail(404, "not_found", "No menu is assigned to that location.");

/** The writer's four types, against the reader's WordPress vocabulary. */
const MENU_ITEM_TYPES = ["page", "category", "product", "url"];

/**
 * WordPress's vocabulary → the writer's, so a read body PUTs back unchanged.
 *
 * `MenuInput` normalises both shapes on the way in and this is that: `type:
 * "post_type"` with `object: "page"` is a page, `taxonomy`/`product_cat` is a
 * category, and `custom` is a url. An item this API has no type for keeps its
 * destination as a url rather than being dropped, which is the same choice
 * `kindOf()` makes in the editor.
 */
function normaliseMenuType(item) {
  if (MENU_ITEM_TYPES.includes(item.type)) return item.type;
  if (item.type === "custom") return "url";
  if (item.type === "post_type" && item.object === "page") return "page";
  if (item.type === "post_type" && item.object === "product") return "product";
  if (item.type === "taxonomy" && item.object === "product_cat") return "category";

  /*
   * **An item in the reader's shape always normalises to something, and an item
   * in the writer's shape does not.** `object` is the tell: `CmsPresenter` puts
   * it on every item it publishes and no writer payload carries one.
   *
   * That asymmetry is what keeps the round trip whole. The seeded menu holds a
   * `post_type`/`post` item — a WordPress item this API has no type for — and
   * refusing it here would mean `GET` then `PUT` of an untouched menu answered
   * 400, which is precisely the promise `docs/API.md` makes and §89 went out of
   * its way to keep. So a foreign reader item becomes a `url` and keeps its
   * destination, which is exactly what `kindOf()` does on the panel's side; a
   * writer sending `{"type":"machin"}` still gets the enum refusal, because that
   * is a client naming a type rather than a shop publishing one.
   *
   * The cost is named: the round trip **preserves the item and changes its
   * type**, so a `post` item that goes back comes back as a link. Nothing
   * measured says what the shop does with one; both halves of the panel agree on
   * this reading, which is the most that can be said for it.
   */
  return typeof item.object === "string" ? "url" : null;
}

/**
 * The tree, validated **positionally and to the leaf** — `items[1].url`,
 * `items[1].children[0].object_id`.
 *
 * `MenuEditor` surfaces these whole rather than binding them to a control,
 * because the control an error belongs to may be two levels down inside a sheet
 * that is not open — so the field name is the only thing that says where the
 * problem is, and a flattened one would lose the row.
 *
 * **Every reference is resolved before anything is written.** §89's build note
 * records the first version emptying the menu and *then* resolving each page
 * path as it wrote, so a payload naming one missing page destroyed a shop's
 * navigation and answered 400. That is why this returns a whole tree or an error
 * and never half of one.
 *
 * Two refusals here and neither sentence is measured. The *facts* are: two
 * levels and fifty items are the limits (§89), and `javascript:` and `//host`
 * are refused on `items[n].url` (lib/cms.ts, measured — `javascript:` is a valid
 * URL, which is exactly where that matters). The wording is this file's.
 */
function readMenuItems(raw, prefix, depth, seen) {
  const fields = {};
  const items = [];

  if (!Array.isArray(raw)) {
    fields[prefix === "" ? "items" : `${prefix}.children`] = "Must be an array.";
    return { fields, items };
  }

  raw.forEach((entry, index) => {
    const at = prefix === "" ? `items[${index}]` : `${prefix}.children[${index}]`;

    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fields[at] = "Must be an object.";
      return;
    }

    // Both vocabularies: `label` is the writer's, `title` is what the reader
    // publishes, and the round trip only holds because either is accepted.
    const label = typeof entry.label === "string" ? entry.label : entry.title;
    if (typeof label !== "string" || label.trim() === "") {
      fields[`${at}.label`] = "A menu item needs a label.";
    }

    const type = normaliseMenuType(entry);
    if (type === null) {
      fields[`${at}.type`] = oneOf(MENU_ITEM_TYPES);
      return;
    }

    let url = typeof entry.url === "string" ? entry.url : "";
    let objectId = typeof entry.object_id === "number" ? entry.object_id : 0;

    if (type === "url") {
      const trimmed = url.trim();
      const allowed =
        trimmed !== "" &&
        !trimmed.startsWith("//") &&
        (trimmed.startsWith("/") || /^https?:\/\//i.test(trimmed));
      if (!allowed) {
        fields[`${at}.url`] =
          "A menu URL must be http, https, or a path beginning with a single slash.";
      }
    } else if (type === "page") {
      // `path` wins when it is non-empty and `object_id` is used and validated
      // otherwise, which is `menuTarget()`'s measured rule and is what lets an
      // untouched item go back carrying only the id it arrived with.
      const path = typeof entry.path === "string" ? entry.path.trim() : "";
      if (path !== "") {
        const target = allPages().find(
          (row) => row.path === path && row.status !== "trash",
        );
        if (target === undefined) fields[`${at}.path`] = `No page at path "${path}".`;
        else {
          objectId = target.id;
          url = `https://boutique.example.dz/${target.path}`;
        }
      } else if (!allPages().some((row) => row.id === objectId && row.status !== "trash")) {
        fields[`${at}.object_id`] = `No page with id ${objectId}.`;
      }
    } else if (type === "category") {
      if (!CATEGORIES.some((category) => category.id === objectId)) {
        fields[`${at}.object_id`] = `No product category with id ${objectId}.`;
      }
    } else if (!listed().some((product) => product.id === objectId)) {
      fields[`${at}.object_id`] = `No product with id ${objectId}.`;
    }

    seen.count += 1;

    let children = [];
    if (Array.isArray(entry.children) && entry.children.length > 0) {
      if (depth + 1 >= MAX_MENU_DEPTH) {
        // The offending node is the grandchild, so the field names the level
        // that cannot exist rather than the parent that carries it.
        fields[`${at}.children`] = `A menu is ${MAX_MENU_DEPTH} levels deep at most.`;
      } else {
        const nested = readMenuItems(entry.children, at, depth + 1, seen);
        Object.assign(fields, nested.fields);
        children = nested.items;
      }
    }

    items.push({ label: typeof label === "string" ? label : "", type, url, objectId, children });
  });

  return { fields, items };
}

/** The writer's tree → WordPress's vocabulary, which is what the reader publishes. */
function publishMenuItems(items, position = 0) {
  return items.map((item, index) => {
    const id = state.nextMenuItemId++;
    const [type, object] =
      item.type === "url"
        ? ["custom", "custom"]
        : item.type === "category"
          ? ["taxonomy", "product_cat"]
          : ["post_type", item.type];

    return {
      id,
      title: item.label,
      url: item.url,
      target: "",
      type,
      object,
      object_id: item.type === "url" ? 0 : item.objectId,
      position: index + position,
      classes: [],
      children: publishMenuItems(item.children),
    };
  });
}

/**
 * `PUT /cms/menus/{location}` — **and a location with nothing assigned is
 * created here rather than refused.**
 *
 * Measured: `get_nav_menu_locations()` on this install returned `primary` and no
 * `footer`, so `GET /cms/menus/footer` is a 404 with its own message and the
 * `PUT` answered **200 having created "Footer navigation"**. A route that 404ed
 * until somebody opened Appearance → Menus would be useless for the one case it
 * exists for, so the empty state on that screen carries a working action.
 *
 * **The 50-item cap is flat on `items`, and that is a departure worth naming.**
 * Nothing published its shape. The one cap in this subject that *was* measured —
 * the homepage's fifty sections — is flat on `sections` precisely so that a form
 * cannot bind it to a row index, and `lib/cms.ts` calls that the trap. Making
 * this one positional would teach the opposite lesson from the only measurement
 * available, so it is flat, and this comment is the record that it is a choice.
 */
function putMenu(location, body) {
  const source = body === null || typeof body !== "object" || Array.isArray(body) ? {} : body;
  const seen = { count: 0 };
  const { fields, items } = readMenuItems(source.items ?? [], "", 0, seen);

  if (seen.count > MAX_MENU_ITEMS) {
    fields.items = `A menu carries at most ${MAX_MENU_ITEMS} items; this one has ${seen.count}.`;
  }

  if (Object.keys(fields).length > 0) {
    return invalidBody("The menu is invalid.", fields);
  }

  const existing = state.menus.get(location);
  const menu = {
    location,
    id: existing?.id ?? state.nextMenuId++,
    // "Footer navigation" is the name the measured `PUT` created. The primary
    // one keeps whatever it already had.
    name: existing?.name ?? (location === "footer" ? "Footer navigation" : "Primary navigation"),
    slug: existing?.slug ?? (location === "footer" ? "footer-navigation" : "primary-navigation"),
    items: publishMenuItems(items),
  };
  state.menus.set(location, menu);
  return ok(menu);
}

/* ------------------------------------------------------------------ media --- */

/**
 * ── What of `/media`'s contract is verified, and what is not ─────────────────
 *
 * Rewritten on the media branch (item 13), which owns this surface. The block
 * this replaces recorded `POST /media` as deliberately unserved and the four
 * query parameters as deliberately ignored; both were true of a *shell* that
 * parsed JSON only and of a branch that did not own the screen. Neither is true
 * now, and what follows is the new boundary between what was read out of the
 * backend and what this file made up:
 *
 *   **measured**   41 items on `GET /media`; `sizes` empty on every one of them,
 *                  because the fixtures are 30×20 and below every thumbnail
 *                  threshold; `filename` generated server-side as a collision
 *                  suffix (`real.jpg`, `real-1.jpg`, `real-2.jpg`) with the
 *                  extension from the *sniffed* type; `ac_manage_content` guards
 *                  the **reads** as well as the writes, so a Manager is 403 on
 *                  `GET /media`; the five upload refusals recorded in
 *                  lib/media.ts:18-23 with their codes and their `details` keys,
 *                  the size floor firing **before** the sniffer; and, on
 *                  2026-08-28, the whole of `GET /media/{id}/usage` — its body,
 *                  both its lists, its two 404s and its 400 on `id=0`. See the
 *                  usage block below.
 *
 *   **read out of the backend, not measured over the wire** every status,
 *                  sentence and enum below traces to a file in
 *                  `src/Media/` or to `tests/Api/media.php` — `201` on the
 *                  create (`MediaController::store`), `ORDERBY` of
 *                  `date · title · id` (`MediaRepository::ORDERBY`), the `type`
 *                  pattern (`MediaController::indexArgs`), the refusal
 *                  sentences (`UploadPolicy`, `MediaInput`) and the PATCH cases
 *                  (`tests/Api/media.php:387-437`). Reading the router is a
 *                  better source than reading the panel, and it is still not a
 *                  request-for-request diff: **none has been run on this
 *                  collection**, and the envelope in particular is still the
 *                  shared `paginate()` because both callers send `per_page` and
 *                  `page` and read `total`.
 *
 *   **invented**   flagged at each site, and there are six: the `detected` mime
 *                  for every non-image (only `application/pdf` is measured); the
 *                  fields `?search=` matches; the tie-break inside a sort; the
 *                  resting order, which is newest first here and is what
 *                  `orderby=date&order=desc` implies rather than something
 *                  anyone watched; and, on the delete branch, `MEDIA_LOGO_ID`
 *                  with the shop name beside it — there is no settings document
 *                  in this file to read a logo out of, and without it
 *                  `store_logo` would be a scope nothing here could ever
 *                  demonstrate.
 *
 * **Two fallbacks in the backend are unreachable and are reproduced as
 * unreachable.** `MediaRepository::paginate()` silently falls back to `date` for
 * an off-enum `orderby`, and to `''` — no filter — for a `type` that is not a
 * mime type; the controller's `enum` and `pattern` both 400 first, so neither
 * line can run. A mock that copied the repository rather than the router would
 * answer 200 to `?orderby=rand`, which is the *more permissive* direction and
 * exactly what the coupons branch got wrong in reverse.
 */

/** Every attachment this process can see, seeded and uploaded, minus the deleted. */
const mediaRows = () =>
  [
    ...state.createdMedia.map((id) => state.media.get(id)),
    ...MEDIA_SEED.map((row) => state.media.get(row.id) ?? row),
  ].filter((row) => row !== undefined && !state.deletedMedia.has(row.id));

/** `MediaRepository::ORDERBY`. `order` is the file-wide `SORT_DIRECTIONS`. */
const MEDIA_ORDERBY = ["date", "title", "id"];

/**
 * `MediaController::indexArgs()`' own pattern, verbatim — a family (`image`) or
 * a full type (`image/png`). It is a *pattern* refusal rather than an enum one,
 * which is the family that prints the regex at the reader; the media screen ships
 * no type filter, which is what keeps it unreachable there.
 */
const MEDIA_TYPE_PATTERN = "^[a-z]+(/[a-z0-9.+-]+)?$";

const MEDIA_FIELDS = ["alt", "title", "caption"];

/** `MediaInput::MAX_LENGTH`, checked against the **trimmed** value. */
const MEDIA_MAX_LENGTH = 500;

const MEDIA_READ_ONLY = [
  "id",
  "slug",
  "mime_type",
  "url",
  "filename",
  "filesize",
  "width",
  "height",
  "sizes",
  "uploaded_by",
  "date_created",
  "date_modified",
];

/**
 * `MediaInput::REFUSED`, verbatim — and `file` is the one the backend suite
 * asserts by substring (`tests/Api/media.php:414-422`, "upload a new one"),
 * because a client that PATCHes `file` has to be told to upload instead of being
 * told the field is unknown. The four post fields beside it are the privilege
 * escalation an attachment-is-a-post write path would otherwise open.
 */
const MEDIA_NAMED_REFUSALS = {
  file: "The stored file cannot be replaced; upload a new one.",
  post_type: "Not editable.",
  post_status: "Not editable.",
  post_author: "Not editable.",
  parent_id: "Not editable.",
};

/**
 * `MediaInput::fromPayload()`'s per-field rule, and it is **looser than
 * `mustBeText`** — which is what this used to use.
 *
 * `null` clears the field to `""` (asserted at `tests/Api/media.php:430-435`),
 * and anything `is_scalar()` is cast rather than refused: `PATCH {"alt": 5}` is
 * a 200 storing `"5"` at the shop. PATCH reads `get_json_params()` with no arg
 * schema above it, so a JSON number really does reach that cast. `mustBeText`
 * answered 400 to both, which is the *stricter* direction — the one DECISIONS.md
 * §0 says is not the safe one.
 *
 * Objects and arrays are the only things refused, and `sanitize_text_field()` /
 * `wp_kses_post()` on the way to the database are **not** modelled: a title of
 * `<b>x</b>` reads back `x` at the shop and `<b>x</b>` here. Named because
 * nothing in this file models WordPress's sanitisers and a screen that displayed
 * either field as HTML would want it.
 */
function mediaFieldValue(value) {
  if (value === null) return { value: "" };
  if (typeof value === "object") return { problem: "Must be a string." };
  const text = (typeof value === "boolean" ? (value ? "1" : "") : String(value)).trim();
  if ([...text].length > MEDIA_MAX_LENGTH) {
    return { problem: `Must be at most ${MEDIA_MAX_LENGTH} characters.` };
  }
  return { value: text };
}

/**
 * `MediaInput::fromPayload()`, whole.
 *
 * The read-only keys leave in silence — `array_diff_key` runs *before* the
 * unknown-field pass — so a client can GET a row and PATCH the body back. What
 * survives that and is still not one of the three is an error, and the message
 * is `MediaInput`'s own: **"The media data is invalid."** This file said "The
 * attachment is invalid." until this branch, which was one of the six invented
 * CMS sentences DECISIONS.md carries.
 */
function readMediaInput(body) {
  const source = body === null || typeof body !== "object" || Array.isArray(body) ? {} : body;

  const fields = {};
  const writes = {};

  for (const [key, value] of Object.entries(source)) {
    if (MEDIA_READ_ONLY.includes(key)) continue;
    if (MEDIA_NAMED_REFUSALS[key] !== undefined) {
      fields[key] = MEDIA_NAMED_REFUSALS[key];
      continue;
    }
    if (!MEDIA_FIELDS.includes(key)) {
      fields[key] = "Unknown field.";
      continue;
    }
    const read = mediaFieldValue(value);
    if (read.problem === undefined) writes[key] = read.value;
    else fields[key] = read.problem;
  }

  return Object.keys(fields).length > 0
    ? { error: invalidBody("The media data is invalid.", fields) }
    : { writes };
}

/** `MediaService::require()` — the id is in the route pattern, so this is not a `rest_no_route`. */
const mediaNotFound = () => fail(404, "not_found", "No media item with that id.");

/**
 * `?search=`, and **which fields it matches is this file's guess.**
 *
 * `MediaRepository::paginate()` hands the term to `WP_Query`'s `s`, which is a
 * `LIKE` over `post_title`, `post_excerpt` and `post_content` — title and caption
 * of the three this presenter emits, since an attachment's description is not in
 * the response at all. `alt` is post meta and cannot be reached by `s`;
 * **filename is the one that would matter to a person and is the one nobody has
 * measured** — core has searched attachments by filename since 4.7 but gated it
 * behind `wp_allow_query_attachment_by_filename` in 5.9, and which way that
 * filter sits on this install is unknown. Not searched here, so a screen cannot
 * ship a "search by filename" that only works against the harness.
 *
 * Folded on both sides like every other search in this file, because MySQL's own
 * collation is accent-insensitive.
 */
const searchMedia = (rows, params) => searchRows(rows, params, (row) => [row.title, row.caption]);

/**
 * `orderby` × `order`, honoured — the router validates both and the repository
 * really does sort.
 *
 * The **tie-break is invented**: MySQL leaves rows tied on `post_title` in
 * whatever order the index hands back, and a screenshot cannot be byte-stable on
 * that, so ties fall to descending id here. It is named because a screen must
 * not ship a sort whose secondary order it learnt from this file.
 */
function sortMedia(rows, orderby, order) {
  const key =
    orderby === "title"
      ? (row) => fold(row.title)
      : orderby === "id"
        ? (row) => row.id
        : (row) => row.date_created;

  const direction = order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left < right) return -direction;
    if (left > right) return direction;
    return b.id - a.id;
  });
}

/**
 * `post_mime_type` as `WP_Query` reads it: a family matches `image/%`, a full
 * type matches exactly. `type=video/mp4` is a 200 with nothing in it — asserted
 * at `tests/Api/media.php:352-357` — and **not** a refusal, which is the
 * distinction a screen offering a type filter would have to render.
 */
const matchesMediaType = (row, type) =>
  type === "" || row.mime_type === type || row.mime_type.startsWith(`${type}/`);

function mediaListing(params) {
  /*
   * The collection's own parameters first and `paginate()` last, which is the
   * order every other listing in this file uses. **WordPress reports *every*
   * invalid parameter in one `Invalid parameter(s): a, b`** and this file has
   * always reported exactly one — `paginate()` says so in as many words, and
   * which one wins for a request with two wrong is not measured on any
   * collection here.
   */
  const orderby = params.get("orderby");
  if (orderby !== null && !MEDIA_ORDERBY.includes(orderby)) {
    return invalidParam("orderby", notOneOf("orderby", MEDIA_ORDERBY));
  }
  const order = params.get("order");
  if (order !== null && !SORT_DIRECTIONS.includes(order)) {
    return invalidParam("order", notOneOf("order", SORT_DIRECTIONS));
  }
  /*
   * `?type=` is a 400 rather than "no filter". The empty string is a *value*
   * that fails the pattern, which is the same reading `?date_from=` was measured
   * to take on `/payments` and the same one `?orderby=` takes on every
   * collection that validates a sort. It is also what makes the repository's
   * `if ($type !== '')` branch unreachable through the router.
   */
  const type = params.get("type");
  if (type !== null && !new RegExp(MEDIA_TYPE_PATTERN).test(type)) {
    return invalidParam("type", notMatching("type", MEDIA_TYPE_PATTERN));
  }

  const rows = sortMedia(
    searchMedia(mediaRows(), params).filter((row) => matchesMediaType(row, type ?? "")),
    orderby ?? "date",
    order ?? "desc",
  );

  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

function patchMedia(current, body) {
  const parsed = readMediaInput(body);
  if (parsed.error) return parsed.error;

  /*
   * `MediaInput::isEmpty()`. A body of `{}` — and a body of nothing but read-only
   * keys, which reduces to the same thing — is a 400 naming no field at all,
   * exactly as `PATCH /products/{id}` is. This file answered **200** to both
   * until this branch: a save that changed nothing looked like a save.
   */
  if (Object.keys(parsed.writes).length === 0) {
    return bareFail(400, "invalid_request", "No supported fields were provided.");
  }

  const next = { ...current, ...parsed.writes };
  state.media.set(current.id, next);
  return ok(next);
}

/* ------------------------------------------------------------ media usage --- */

/**
 * ── `GET /media/{id}/usage`, and what this file can and cannot answer ────────
 *
 * `MediaUsageRepository` reads five stores and reports what holds an attachment
 * id, so the panel's delete dialog can say what a permanent delete would break.
 * Its two lists are the contract: `checked` names where it looked, `incomplete`
 * names where nothing can look, and together they are what stops `total: 0`
 * being read as "safe".
 *
 *   **measured** the response shape, the two lists' contents, `kind` ∈
 *                `product · variation · page · banner · settings`, `slot` ∈ the
 *                five `SCOPES`, `settings` carrying `id: 0`, and both refusals:
 *                404 `not_found` for an unknown id **and for a post id that is
 *                not an attachment**, 400 `invalid_request` on `id=0`.
 *
 *   **read out of the backend** that the repository decides a gallery by
 *                splitting the comma list and an option set by decoding the
 *                document — the SQL `LIKE` only narrows — so `12` never reports
 *                `120`. Reproduced below by comparing values rather than
 *                substrings, which is the same property from the other side.
 *
 *   **invented, and flagged at each site**: `MEDIA_LOGO_ID` (see the block
 *                below, which now contradicts a document this file serves); and
 *                the *order* of `references`, which the repository leaves to
 *                `ORDER BY pm.post_id` per scope and which is therefore
 *                per-store here rather than globally sorted.
 *
 * **One of the five scopes has no store in this file and cannot be found by
 * scanning**: `seo_image` is a post meta key this mock does not model — the
 * `seo` block it serves on a page and a product is derived text with no image id
 * in it. `store_logo` was the second until `/settings` was served on 2026-08-29;
 * it now has a document behind it, and the seeded logo below is what the two
 * disagree about. `checked` still names all five, because that is what the API
 * reports and the panel's sentence is built on it; what changes is only that no
 * scan can produce a hit in `seo_image`.
 */

/**
 * **Invented, and since 2026-08-29 it contradicts `/settings` — deliberately,
 * and this is the honest place to say so.**
 *
 * The shop's logo is `ac_client_settings['store']['logo_id']`, and the settings
 * document this file now serves says that value is **`0`** with `logo: null` —
 * measured, and the live truth for this install. So on the wire *no* attachment
 * is the store logo and `GET /media/5001/usage` would report `total: 0`, while
 * here it reports one `store_logo` reference.
 *
 * It is kept because reading `state.settings.store.logo_id` instead would leave
 * the whole library unused from a cold start, and that reference is the **only**
 * fixture the media delete dialog's *in use* state has — a screen already built
 * and captured against it. Trading a live defect on one screen for a lost
 * fixture on another is not what the audit is for. The settings screen does not
 * read `/media/{id}/usage`, so nothing renders both sides of the disagreement.
 *
 * Everything else in the library is genuinely unused, so 5002 and its forty
 * neighbours are the *not in use* fixture without anyone declaring anything.
 * Both states exist from a cold start, which is what the panel needs; the
 * scanned stores below then make the answer move when something writes.
 */
const MEDIA_LOGO_ID = 5001;

/**
 * The reference's `title`, **and it stopped being invented on 2026-08-29.**
 *
 * `MediaUsageRepository::storeLogo()` titles the settings reference with
 * `SettingsRepository::storeName()` so the panel can write "the logo of <shop>"
 * rather than naming a table, and falls back to the English `'Store settings'`
 * for a shop that has not set one. This block read "there is **no settings route
 * in this file**, so there is no name to read" and carried a plausible invention
 * — `"Boutique artisanale"` — beside a mock that already knew the shop's real
 * name from `SHOP_NAME`. `/settings` is served now, so the name is read out of
 * the document the way the repository reads it, and the two routes can no longer
 * answer different names for one shop in one process. It follows
 * `MOCK_SETTINGS`, which is what the wire does.
 *
 * The fallback is reproduced rather than dropped: a shop with `store.name`
 * unset really does get the English string, and hard-coding a French one would
 * hide that the branch exists.
 */
const storeSettingsName = () => state.settings.store?.name || "Store settings";

/** `MediaUsageRepository::SCOPES`, verbatim and in its own order. */
const MEDIA_USAGE_SCOPES = [
  "featured_image",
  "gallery",
  "option_choice_image",
  "seo_image",
  "store_logo",
];

/**
 * `MediaUsageRepository::UNSEARCHABLE`, verbatim.
 *
 * `homepage_section_data` is the homepage document — a section's `data` has no
 * schema per type, so `{"type":"hero","data":{"image_id":5001}}` is a valid,
 * stored, unfindable reference, and this file's own `HOMEPAGE_SEED` contains
 * exactly that shape. `content_html` is the same problem one level down:
 * `ContentHtml::ALLOWED` permits `<img>`, so an image in body text is a URL.
 *
 * **Both are unconditional**, and `find()` *appends* a scope name to this list
 * when that scope's query hits `MAX_MATCHES` (100). Nothing in this shop is held
 * by a hundred products, so the append is unreachable here — reproduced as
 * unreachable rather than dropped, the same way the two backend fallbacks above
 * `mediaListing` are.
 */
const MEDIA_UNSEARCHABLE = ["homepage_section_data", "content_html"];

/** `MediaUsageRepository::reference()` — four keys, in its own order. */
const usageRef = (kind, id, title, slot) => ({
  kind,
  id,
  // A variation and a draft can both have an empty title, and "" is not
  // something a shopkeeper can identify in a warning.
  title: String(title ?? "").trim() || `#${id}`,
  slot,
});

/**
 * Every place in *this* file that holds an attachment id, scanned.
 *
 * Scanned rather than tabulated, deliberately: a table would let the mock report
 * a reference that `GET /products/{id}` contradicts, which is the one failure a
 * fixture for this endpoint must not have. `PATCH /cms/banners/{id}
 * {"image_id": 5001}` is a path the panel really takes, and the answer here moves
 * when it does.
 */
function mediaUsageOf(id) {
  const references = [];

  for (const product of catalogue()) {
    if (product.image_id === id) {
      references.push(usageRef("product", product.id, product.name, "featured_image"));
    }
    // Compared as ids, never as a substring of the joined list — `12` must not
    // report `120`, which is what the repository's split is for.
    if ((product.gallery_image_ids ?? []).includes(id)) {
      references.push(usageRef("product", product.id, product.name, "gallery"));
    }
    const groups = product.options?.groups ?? [];
    const inChoice = groups.some((group) =>
      (group.choices ?? []).some((choice) => choice.image_id === id),
    );
    if (inChoice) {
      references.push(usageRef("product", product.id, product.name, "option_choice_image"));
    }
  }

  for (const variation of variationRows()) {
    if (variation.image_id === id) {
      references.push(usageRef("variation", variation.id, variation.name, "featured_image"));
    }
  }

  for (const page of allPages()) {
    if (page.image?.id === id) {
      references.push(usageRef("page", page.id, page.title, "featured_image"));
    }
  }

  for (const banner of bannerRows()) {
    if (banner.image?.id === id) {
      references.push(usageRef("banner", banner.id, banner.title, "featured_image"));
    }
  }

  // `id: 0` — settings live in an option and have no row id, which is the same
  // spelling the audit trail uses for them.
  if (id === MEDIA_LOGO_ID) {
    references.push(usageRef("settings", 0, storeSettingsName(), "store_logo"));
  }

  return {
    total: references.length,
    references,
    checked: MEDIA_USAGE_SCOPES,
    incomplete: MEDIA_UNSEARCHABLE,
  };
}

/**
 * `MediaService::delete()` — permanent and **unconditional**.
 *
 * It does not consult `usage()`, and that is the contract rather than an
 * omission: a hard refusal would make a deliberately-unused picture undeletable,
 * so the endpoint informs through `/usage` and the operator decides. A mock that
 * refused a delete for an image in use would be the *stricter* direction and
 * would teach a screen to render a 409 this API never sends.
 *
 * The filename goes with the row because `wp_delete_attachment($id, true)`
 * unlinks the file: the bytes stop being served, and — read out of
 * `wp_unique_filename()`, not measured — the name becomes free again, so the next
 * upload of `real.jpg` into a shop that has deleted `real.jpg` gets that name
 * back rather than `real-3.jpg`.
 */
function deleteMedia(item) {
  state.deletedMedia.add(item.id);
  state.deletedFiles.add(item.filename);

  /*
   * **`wp_delete_attachment()` deletes `_thumbnail_id` rows pointing at the
   * attachment, and only those.** Core walks `postmeta` for that one key and
   * removes every reference; it does *not* touch `_product_image_gallery`,
   * `_ac_option_set` or `_ac_seo_image_id`, which is why an id can outlive its
   * file in three of the five scopes.
   *
   * Reproduced exactly, and it was found by auditing this file against the shop
   * rather than by reasoning: a banner keeps its `image` object here — the write
   * resolves it once and freezes it — so without this, deleting a picture left
   * `/cms/banners` reporting a banner whose thumbnail URL answers 404, where the
   * shop reports `image: null`. A screen built against that would look correct
   * and be wrong. The gallery and the option set are deliberately **not** cleaned
   * for the same reason: a dangling id there is what the shop really has.
   */
  for (const banner of bannerRows()) {
    if (banner.image?.id === item.id) state.banners.set(banner.id, { ...banner, image: null });
  }
  for (const page of allPages()) {
    if (page.image?.id === item.id) state.pages.set(page.id, { ...page, image: null });
  }

  return ok({ id: item.id, deleted: true });
}

/* ----------------------------------------------------------- media upload --- */

/**
 * ── `POST /media`, and the order of its checks is the whole contract ─────────
 *
 * `UploadPolicy::accept()` runs size → filename → contents → agreement, and
 * lib/media.ts:9-16 exists because getting that order wrong cost a measurement:
 * a 48-byte PDF renamed `.png` answered **400 `invalid_upload`**, not 415, and
 * the reading "there is a third code for a disguised file" survived until a
 * 5.4 KB control was run beside it. `MIN_BYTES` fires before anything reads a
 * byte. Do not reorder these four.
 *
 * Everything below is `UploadPolicy` and `UploadedFile` re-expressed; every
 * sentence is theirs. The one thing that is **not** modelled is the rate limit —
 * `MediaService::guardUploadRate()` is a tighter counter than the namespace-wide
 * write limit, nothing in this file models any rate limit, and a harness that
 * refused the eleventh upload of a capture run would be inventing a state no
 * screenshot needs.
 */
const MEDIA_MIN_BYTES = 64;
const MEDIA_MAX_BYTES = 8388608;
const MEDIA_MAX_FILENAME_LENGTH = 255;
const MEDIA_MAX_STEM_LENGTH = 80;

/** `UploadPolicy::ACCEPTED_TYPES` — what a file may prove itself to be. */
const MEDIA_ACCEPTED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** `UploadPolicy::ALLOWED_EXTENSIONS` — what a client may present. Four, for three types. */
const MEDIA_ALLOWED_EXTENSIONS = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** `UploadPolicy::FORBIDDEN_SEGMENTS`, verbatim — refused **anywhere** in a name. */
const MEDIA_FORBIDDEN_SEGMENTS = [
  "php", "php3", "php4", "php5", "php7", "php8", "phps", "pht", "phtml", "phar",
  "shtml", "htaccess", "htpasswd", "ini", "cgi", "pl", "py", "rb", "sh", "bash",
  "exe", "dll", "so", "jar", "jsp", "asp", "aspx", "cer", "swf",
  "html", "htm", "xhtml", "svg", "js", "mjs",
];

/** `sprintf('Only %s files are accepted.', implode(', ', array_keys(ACCEPTED_TYPES)))`. */
const MEDIA_TYPES_SENTENCE = `Only ${Object.keys(MEDIA_ACCEPTED_TYPES).join(", ")} files are accepted.`;

const badUploadName = (message) => fail(400, "invalid_upload", message);

/** `UploadPolicy::badType()` — the detected type is echoed to an authenticated caller. */
const badUploadType = (detected) =>
  fail(415, "unsupported_media_type", MEDIA_TYPES_SENTENCE, {
    detected: detected === "" ? "unknown" : detected,
  });

/**
 * `finfo(FILEINFO_MIME_TYPE)`, to the extent this file needs one.
 *
 * The three accepted types are magic numbers and are exact. **Everything else is
 * invented** and is here only so `details.detected` carries a plausible string:
 * `application/pdf` is the one value lib/media.ts actually measured, and
 * `text/x-php`, `image/svg+xml`, `image/gif`, `text/plain` and
 * `application/octet-stream` are what libmagic is *expected* to answer for the
 * backend suite's own hostile fixtures. A screen must branch on the presence of
 * `details.detected`, never on its value — `classifyRefusal()` already does,
 * which is why this being approximate is affordable.
 */
function sniffMedia(bytes) {
  const head = bytes.subarray(0, 16);
  const ascii = (start, end) => bytes.subarray(start, end).toString("latin1");

  if (head.length >= 8 && ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (head.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (head.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (head.length >= 4 && ascii(0, 4) === "%PDF") return "application/pdf";

  const opening = bytes.subarray(0, 512).toString("utf8");
  if (/<\?php/i.test(opening)) return "text/x-php";
  if (/^\s*(<\?xml[^>]*\?>\s*)?(<!--.*?-->\s*)*<svg[\s>]/is.test(opening)) return "image/svg+xml";
  if (!/[\x00-\x08\x0e-\x1f]/.test(opening) && opening.length > 0) return "text/plain";
  return "application/octet-stream";
}

/**
 * `getimagesize()`, which is the **second** reader `UploadPolicy::sniff()` runs.
 *
 * Two readers that fail differently is the point: `finfo` matches the head of
 * the file and this parses enough of the image header to report dimensions, so a
 * truncated PNG satisfies the first and not the second. Returning `null` here is
 * what reproduces that — the policy answers 415 with the *detected* type, not a
 * fourth code.
 */
function mediaDimensions(bytes, mime) {
  try {
    if (mime === "image/png") {
      if (bytes.subarray(12, 16).toString("latin1") !== "IHDR") return null;
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }

    if (mime === "image/jpeg") {
      let at = 2;
      while (at + 9 < bytes.length) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1];
        const length = bytes.readUInt16BE(at + 2);
        const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isFrame) {
          return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
        }
        at += 2 + length;
      }
      return null;
    }

    if (mime === "image/webp") {
      const chunk = bytes.subarray(12, 16).toString("latin1");
      if (chunk === "VP8L") {
        const packed = bytes.readUInt32LE(22);
        return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8 ") {
        return {
          width: bytes.readUInt16LE(26) & 0x3fff,
          height: bytes.readUInt16LE(28) & 0x3fff,
        };
      }
      if (chunk === "VP8X") {
        const read24 = (at) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
        return { width: read24(24) + 1, height: read24(27) + 1 };
      }
      return null;
    }
  } catch {
    // A header that runs off the end of the buffer is exactly what
    // `getimagesize()` answers false for.
    return null;
  }
  return null;
}

/**
 * `UploadPolicy::assertFilename()` — reject a hostile name, return what it claims.
 *
 * A path separator, a `..`, a NUL or a control character is never a mistake, so
 * none is repaired. **Three of these cannot arrive over real HTTP**, and each is
 * kept anyway because the shop keeps them:
 *
 *   a NUL, a control character   cannot travel in a `Content-Disposition` header
 *   a leading `/` or `\`         `parseMultipart()` has already stripped it, the
 *                                way PHP does — measured live at 201
 *
 * The `..` check is **not** in that list: `a..b.jpg` carries no separator for the
 * basename to strip and answers 400 at the shop, measured 2026-08-27. So the path
 * branch is live for that shape and dead for the shape everyone tests it with.
 */
function assertMediaFilename(rawName) {
  const name = rawName.trim();

  if (name === "" || Buffer.byteLength(name) > MEDIA_MAX_FILENAME_LENGTH) {
    return { error: badUploadName("The filename is missing or too long.") };
  }
  if (/[\x00-\x1f\x7f]/.test(name)) {
    return { error: badUploadName("The filename contains control characters.") };
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return { error: badUploadName("The filename must not contain a path.") };
  }

  const segments = name.toLowerCase().split(".");
  const extension = segments.pop();

  if (segments.length === 0) {
    return { error: badUploadName("The filename has no extension.") };
  }
  // Every interior segment and the stem: `.htaccess` arrives as stem "" and
  // extension "htaccess", `shell.php.jpg` as an interior one.
  for (const segment of segments) {
    if (MEDIA_FORBIDDEN_SEGMENTS.includes(segment)) {
      return { error: badUploadName("The filename contains a disallowed extension.") };
    }
  }
  if (MEDIA_ALLOWED_EXTENSIONS[extension] === undefined) {
    return {
      error: fail(415, "unsupported_media_type", MEDIA_TYPES_SENTENCE, { extension }),
    };
  }

  return { extension };
}

/** `UploadPolicy::storedFilename()` — the stem is kept, the extension is the sniffed type's. */
function storedMediaStem(clientName) {
  let stem = clientName
    .trim()
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (stem.length > MEDIA_MAX_STEM_LENGTH) {
    stem = stem.slice(0, MEDIA_MAX_STEM_LENGTH).replace(/-+$/, "");
  }
  // A name made entirely of characters we drop — Arabic, for one — is normal
  // here and must not produce a file called ".jpg".
  return stem === "" ? "image" : stem;
}

/**
 * `wp_unique_filename()`, which is the thing the measured trio proves: `real.jpg`
 * uploaded three times stored `real.jpg`, `real-1.jpg`, `real-2.jpg`.
 *
 * **A deleted name is free again**, which is read out of `wp_delete_attachment()`
 * rather than measured: it unlinks the file, and `wp_unique_filename()` asks the
 * *filesystem*, not the posts table. So this asks the same question this file
 * can answer — which files exist — and a deleted one does not. The alternative,
 * treating a gone name as taken for ever, would be the stricter direction and
 * would hand `real-3.jpg` to the first upload into a shop that had just deleted
 * `real.jpg`.
 */
function uniqueMediaFilename(stem, extension) {
  const taken = (name) =>
    !state.deletedFiles.has(name) && (state.uploads.has(name) || MEDIA_FIXTURE_BYTES.has(name));

  let candidate = `${stem}.${extension}`;
  let suffix = 0;
  while (taken(candidate)) {
    suffix += 1;
    candidate = `${stem}-${suffix}.${extension}`;
  }
  return candidate;
}

/** `MediaRepository::titleFrom()` — `tapis-berbere.jpg` becomes `tapis berbere`. */
const mediaTitleFrom = (storedName) =>
  storedName.replace(/\.[^.]*$/, "").replace(/[-_]/g, " ").trim() || "image";

/**
 * The multipart body the shell parsed, or `null` for anything else.
 *
 * A JSON `POST /media` reaches here as `null` and is answered with
 * `UploadedFile::fromParams()`' own sentence, which is what the shop answers to a
 * request carrying no `file` entry — the two are the same failure to that class.
 */
const multipartOf = (body) =>
  body !== null && typeof body === "object" && !Array.isArray(body) && body.multipart !== undefined
    ? body.multipart
    : null;

function uploadMedia(body) {
  const form = multipartOf(body);
  const entries = form === null ? [] : (form.files.file ?? []);

  if (entries.length === 0) {
    return fail(
      400,
      "invalid_upload",
      'Send the file as multipart/form-data in a field named "file".',
    );
  }
  /*
   * `UploadedFile::fromParams()` refuses a multi-file field outright: taking the
   * first silently would make "did my other three upload?" unanswerable.
   *
   * **Reachable only through a `file[]` field**, measured live: two parts both
   * named `file` are one field written twice and the second wins, answering 201.
   * `parseMultipart()` is what draws that line, because PHP draws it there.
   */
  if (entries.length > 1) {
    return fail(400, "invalid_upload", "Upload one file per request.");
  }

  const file = entries[0];

  /*
   * `MediaService::upload()` validates the text fields **before** the policy runs,
   * and the controller only ever reads `MediaInput::allowedFields()` out of the
   * request — so an unknown field beside the file is **ignored**, where the same
   * key on `PATCH` is a 400. That asymmetry is the router's, not a shortcut here.
   */
  const parsed = readMediaInput(
    Object.fromEntries(
      MEDIA_FIELDS.filter((field) => form?.fields[field] !== undefined).map((field) => [
        field,
        form.fields[field],
      ]),
    ),
  );
  if (parsed.error) return parsed.error;

  const size = file.bytes.length;
  if (size < MEDIA_MIN_BYTES) {
    return fail(400, "invalid_upload", "The uploaded file is empty or truncated.", { size });
  }
  if (size > MEDIA_MAX_BYTES) {
    return fail(413, "file_too_large", `The file is larger than the ${MEDIA_MAX_BYTES} byte limit.`, {
      size,
      max_bytes: MEDIA_MAX_BYTES,
    });
  }

  const named = assertMediaFilename(file.name);
  if (named.error) return named.error;

  const detected = sniffMedia(file.bytes);
  if (MEDIA_ACCEPTED_TYPES[detected] === undefined) return badUploadType(detected);

  const dimensions = mediaDimensions(file.bytes, detected);
  if (dimensions === null) return badUploadType(detected);

  if (MEDIA_ALLOWED_EXTENSIONS[named.extension] !== detected) {
    return fail(415, "unsupported_media_type", "The file contents do not match its extension.", {
      extension: named.extension,
      detected,
    });
  }

  const stem = storedMediaStem(file.name);
  const filename = uniqueMediaFilename(stem, MEDIA_ACCEPTED_TYPES[detected]);
  /* Re-taking a name a delete freed: the file exists again, so it must stop
     being one `/wp-content/uploads/…` refuses. Without this the upload would 201
     with a `url` answering 404 — a row whose tile is a broken box. */
  state.deletedFiles.delete(filename);
  state.uploads.set(filename, { mime: detected, bytes: file.bytes });

  const id = state.nextMediaId;
  state.nextMediaId += 1;

  const row = {
    id,
    title: parsed.writes.title ?? mediaTitleFrom(filename),
    slug: filename.replace(/\.[^.]*$/, ""),
    alt: parsed.writes.alt ?? "",
    caption: parsed.writes.caption ?? "",
    mime_type: detected,
    url: `${MOCK_ORIGIN}${MEDIA_UPLOAD_PATH}/${filename}`,
    filename,
    filesize: size,
    ...dimensions,
    /*
     * **Empty on every upload, and this is the one place the mock is knowingly
     * less capable than WordPress.** A 30×20 file generates no sub-size, which is
     * why all 41 fixtures have none; a 2000px photograph through this route would
     * generate four at the shop. Modelling that would mean inventing WordPress's
     * thresholds *and* a shape — and lib/api/schemas/media.ts declares `sizes` an
     * **array** of `{name,url,width,height}` where `MediaPresenter::sizes()`
     * returns an **object keyed by size name** of `{width,height,mime_type}`, so
     * emitting one would be inventing the wrong thing twice over. Named here
     * because a screen must not read "the mock never sends sizes" as "the API
     * never does".
     */
    sizes: [],
    uploaded_by: IDENTITY.id,
    date_created: mediaStamp(0),
    date_modified: mediaStamp(0),
  };

  state.media.set(id, row);
  state.createdMedia.push(id);

  // 201, from `MediaController::store()`. The fourth create in this file to be
  // pinned there, and the first pinned by reading the controller rather than by
  // firing a request at the shop.
  return created(row);
}

/* ------------------------------------------------------------- marketing --- */

/**
 * ── The sort that ships, and the one collection where garbage is refused ─────
 *
 * `/campaigns` reaches a validator where `/shipping` and `/payments` do not: a
 * value outside the enum is a **400**, not a silent 200. Measured 2026-08-28 —
 * `?orderby=zzz`, `?orderby=`, `?order=zzz` and `?order=` are all refused, and
 * `?bogus_param=1` is a 200 in default order. So this file has to do both
 * things at once: sort, *and* refuse — which no other collection here does.
 *
 * **The order of the values inside each array is the order the refusal prints
 * them in**, and the two collections do not agree: campaigns lead with
 * `created_at` and segments with `name`, each naming its own default first.
 * Sorting either list would change a sentence the shop sends.
 */
const CAMPAIGN_ORDERBY = ["created_at", "updated_at", "name", "id"];
const SEGMENT_ORDERBY = ["name", "created_at", "updated_at", "id"];

/**
 * `?status=` on `/campaigns`, and **the empty string is inside the enum** —
 * which is how "every status" is spelled and why the refusal reads
 * `status is not one of , draft, sending, sent, and cancelled.` with a leading
 * comma. `?status=` is a legal 200; `?status=scheduled` is a 400.
 *
 * The recipient list's own three are the notification queue's three and are
 * validated the same way, against its own enum: `?status=draft` is a 400 there
 * and a 200 one level up.
 */
const CAMPAIGN_STATUS_FILTERS = ["", "draft", "sending", "sent", "cancelled"];
const RECIPIENT_STATUS_FILTERS = ["", "pending", "sent", "failed"];

/**
 * The second half of `canSendCampaigns()`, and the file's second capability
 * predicate after `canSeeMoney()`.
 *
 * `ac_manage_marketing` gates the whole section and is enforced by `gatedOn` in
 * the router; this one is the *other* half of the compound rule, and it is
 * enforced on exactly the three routes measured to need it — the recipient list,
 * a segment's count, and `send`. It also decides one **field**: a preview comes
 * back whole with `audience_count: null` rather than being refused, because
 * rendering a body is a marketing act and counting an audience is a customers
 * one. `MOCK_IDENTITY=no_customers` is the credential that reaches all four.
 */
const canCountCustomers = () => IDENTITY.capabilities.includes("ac_manage_customers");

const campaignRows = () =>
  [
    ...state.createdCampaigns.map((id) => state.campaigns.get(id)),
    ...CAMPAIGN_SEED.map((row) => state.campaigns.get(row.id) ?? row),
  ].filter((row) => row !== undefined && !state.campaignsGone.has(row.id));

const campaignById = (id) =>
  id === null ? undefined : campaignRows().find((row) => row.id === id);

const segmentRows = () =>
  [
    ...state.createdSegments.map((id) => state.segments.get(id)),
    ...SEGMENT_SEED.map((row) => state.segments.get(row.id) ?? row),
  ].filter((row) => row !== undefined && !state.segmentsGone.has(row.id));

const segmentById = (id) => (id === null ? undefined : segmentRows().find((row) => row.id === id));

/**
 * One sort for both collections, and **the tie-break is a per-collection
 * measurement rather than a rule.**
 *
 * `/campaigns` breaks a `created_at` tie by **id descending** — 319 answers
 * before 318 under `asc` *and* under `desc`. `/segments`, whose four rows tie on
 * both stamps, answers [43, 44, 45, 46] in both directions, which is id
 * **ascending**. Measured on the same day, on one shop; neither is written as a
 * shared default because neither generalises, and a screen must not learn its
 * secondary order from this file.
 *
 * Names fold before comparing, like every other sort here: MySQL's collation is
 * accent-insensitive, which is what puts "Clients à plus…" before "Clients
 * avec…" on the segments list.
 */
function sortMarketing(rows, key, order, tie) {
  const direction = order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left < right) return -direction;
    if (left > right) return direction;
    return tie === "asc" ? a.id - b.id : b.id - a.id;
  });
}

const marketingKey = (orderby) =>
  orderby === "name"
    ? (row) => fold(row.name)
    : orderby === "id"
      ? (row) => row.id
      : (row) => row[orderby];

/** Null when the pair is acceptable; the 400 the shop sends when either is not. */
function checkMarketingSort(params, orderbyValues) {
  const orderby = params.get("orderby");
  if (orderby !== null && !orderbyValues.includes(orderby)) {
    return { error: invalidParam("orderby", notOneOf("orderby", orderbyValues)) };
  }
  const order = params.get("order");
  if (order !== null && !SORT_DIRECTIONS.includes(order)) {
    return { error: invalidParam("order", notOneOf("order", SORT_DIRECTIONS)) };
  }
  return { orderby, order };
}

/**
 * `GET /campaigns`.
 *
 * Four parameters honoured, one refused by name, and **one that looks like a
 * refusal and is not**:
 *
 *   ?status=zzz      400  — the enum above, empty string included
 *   ?orderby/order   400  — outside their enums, `""` included
 *   ?segment_id=zzz  400  "segment_id is not of type integer."
 *   ?segment_id=-1   400  "segment_id must be greater than or equal to 0"
 *   ?segment_id=0    200, **no filter** — 0 is the unset value, not a segment
 *   ?segment_id=99999  **200 with 0 rows** — a segment that does not exist is
 *                      not a refusal, so a screen cannot tell "no campaigns use
 *                      it" from "there is no such segment"
 *   ?search=         200, no filter — not an enum, so `""` is absence here
 *   ?bogus_param=1   200, ignored
 *
 * `?search=` matches **name and subject**, measured with a positive control on
 * each side: `?search=Ramadan` finds 320 by name and `?search=composeur` finds
 * 318 by subject alone.
 *
 * `segment_id` goes through `pagingNumber` because it refuses in exactly the two
 * families that helper already writes — the same argument `/payments?order_id=`
 * made for sharing it.
 */
function campaignsListing(params) {
  const sort = checkMarketingSort(params, CAMPAIGN_ORDERBY);
  if (sort.error) return sort.error;

  const status = params.get("status");
  if (status !== null && !CAMPAIGN_STATUS_FILTERS.includes(status)) {
    return invalidParam("status", notOneOf("status", CAMPAIGN_STATUS_FILTERS));
  }

  const segment = pagingNumber(params, "segment_id", 0, (value) =>
    value >= 0 ? null : "segment_id must be greater than or equal to 0",
  );
  if (segment.error) return segment.error;

  let rows = campaignRows();
  if (status !== null && status !== "") rows = rows.filter((row) => row.status === status);
  if (segment.value > 0) {
    rows = rows.filter((row) => row.audience.segment_id === segment.value);
  }
  rows = searchRows(rows, params, (row) => [row.name, row.subject]);
  rows = sortMarketing(
    rows,
    marketingKey(sort.orderby ?? "created_at"),
    sort.order ?? "desc",
    "desc",
  );

  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

/**
 * `GET /segments`, and **`?search=` is accepted and ignored** — measured,
 * `?search=Alger` answers all four rows rather than the one whose name starts
 * with it. The route declares no such argument, so the value reaches nothing.
 * A mock that filtered would let somebody build a segment search that works
 * only here.
 */
function segmentsListing(params) {
  const sort = checkMarketingSort(params, SEGMENT_ORDERBY);
  if (sort.error) return sort.error;

  const rows = sortMarketing(
    segmentRows(),
    marketingKey(sort.orderby ?? "name"),
    sort.order ?? "asc",
    "asc",
  );

  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

/**
 * `GET /campaigns/{id}/recipients` — **`status` and paging, and no sort at all.**
 *
 * `?orderby=zzz` is a **200 here**, where the same value on the collection one
 * level up is a 400: this route registers no sort argument, so the parameter
 * reaches nothing and is not validated either. Two routes on one resource, two
 * answers to the same wrong value, and reproducing both is the only way a screen
 * cannot ship a recipient sort that appears to work.
 *
 * **`meta.total` follows the filter.** It did not before
 * `feat/campaign-recipient-counts` — `?status=failed` answered 0 rows with
 * `meta.total: 9`, so a paginating list showed "9 destinataires" over an empty
 * table — and this screen pages, so it is the one that would have shown it.
 *
 * `meta.purged` is the fifth key and the reason this list has its own meta
 * schema: after the 30-day purge the addresses are gone and the campaign's
 * stored counts are all that is left.
 */
function recipientsListing(campaign, params) {
  const status = params.get("status");
  if (status !== null && !RECIPIENT_STATUS_FILTERS.includes(status)) {
    return invalidParam("status", notOneOf("status", RECIPIENT_STATUS_FILTERS));
  }

  // `recipientsOf()` rather than the seed directly, so a campaign a drain step
  // has advanced serves the rows those counts were computed from. `?status=pending`
  // and `campaign.recipients` are read by the same screen and must not disagree.
  let rows = recipientsOf(campaign.id);
  if (status !== null && status !== "") rows = rows.filter((row) => row.status === status);

  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, { ...page.meta, purged: campaign.recipients.purged });
}

/**
 * `GET /campaigns/{id}/preview`, and **`audience_count` is null for a caller who
 * cannot read customers** — `canSendCampaigns()` showing through on a route that
 * is otherwise a Marketing Manager's. Measured with the `ac_marketing_manager`
 * credential; `MOCK_IDENTITY=no_customers` reaches it here. Null rather than
 * absent and rather than zero: the key is always present, and a zero would read
 * as "nobody".
 */
function campaignPreview(campaign) {
  const seed = CAMPAIGN_PREVIEW_SEED.get(campaign.id);
  // Only the five seeded campaigns have a rendered preview; a campaign this
  // process created has no measured rendering and gets its own body back with
  // nothing resolved, which is what an untokenised body renders to anyway.
  const rendered = seed ?? {
    subject: campaign.subject,
    html: appendedHtml(campaign.body_html),
    text: appendedText(campaign.body_text),
    unknown_tokens: [],
    audience_count: 8,
  };

  return ok({
    campaign_id: campaign.id,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    unknown_tokens: rendered.unknown_tokens,
    // True on every seeded body: none of them writes `{{unsubscribe_url}}`, so
    // the API adds one. The screen reads this as "we added one", never as a
    // missing link — lib/campaigns.ts:188-198.
    unsubscribe_appended: true,
    sample_recipient: SAMPLE_RECIPIENT,
    audience_count: canCountCustomers() ? rendered.audience_count : null,
  });
}

/**
 * `GET /segments/{id}/preview` — a live count and an English sentence.
 *
 * `problems` is empty on all four: it is the homepage drop report's shape and
 * fills only when a criterion has stopped making sense. `note` is the API's own
 * English and the panel renders a translated sentence instead, which is the rule
 * the analytics branch set.
 */
const segmentPreview = (segment) =>
  ok({
    segment_id: segment.id,
    matches: SEGMENT_MATCHES.get(segment.id) ?? 0,
    criteria: segment.criteria,
    problems: [],
    note: SEGMENT_PREVIEW_NOTE,
  });

/* --------------------------------------------------------- campaign writes --- */

/**
 * ── The refusal vocabulary, measured one request at a time on 2026-08-28 ─────
 *
 * Written out as constants because every one of them is a *sentence the shop
 * sends*, and DECISIONS.md records six CMS refusals that turned out to be this
 * file's own invention and a coupons screen built to a `"Read-only."` the API
 * never sends. Nothing here is paraphrased and nothing is generated.
 *
 * **`Required` and `Cannot be blank.` are different sentences for the same
 * field**, and which one arrives depends on the verb: a create names what is
 * missing, an edit names what was emptied. Both measured on `subject`.
 *
 * The em dash in two of them is the shop's, not this file's typography.
 */
const CAMPAIGN_INVALID = "The campaign is invalid.";
const NAME_REQUIRED = "Required.";
const SUBJECT_REQUIRED = "Required — a campaign with no subject line is not sendable.";
const SEGMENT_ID_REQUIRED = 'Required when audience_type is "segment".';
const CANNOT_BE_BLANK = "Cannot be blank.";
const NO_SUCH_SEGMENT = "No segment with that id.";
const NOT_A_DRAFT = "A campaign can only be edited while it is a draft.";
const NOT_DELETABLE = "Only a draft can be deleted. Cancel the campaign instead.";

const invalidCampaign = (fields) => fail(400, "invalid_request", CAMPAIGN_INVALID, { fields });

const campaignNotFound = () => fail(404, "not_found", "No campaign with that id.");
const segmentNotFound = () => fail(404, "not_found", NO_SUCH_SEGMENT);

const readString = (value) => (typeof value === "string" ? value : null);

/**
 * `POST /campaigns` — **201**, and the fifth create in this file pinned there.
 *
 * Three things measured that an implementation would guess wrong:
 *
 *   1. **`audience_type` absent behaves as `"segment"`.** `POST {}` names
 *      `segment_id` among its missing fields, and so does `POST {name}`. There
 *      is no way to create a campaign without either naming an audience type or
 *      being told a segment id is missing.
 *   2. **Empty bodies are accepted.** `body_html: ""` and `body_text: ""` are a
 *      201. lib/campaigns.ts:377-398 gates the wizard on both parts being
 *      present, and that is the panel's rule rather than the API's — see the
 *      honesty note in DECISIONS.md. This file must not refuse them.
 *   3. **The panel's own create body is a 400 today.** `CampaignsList.tsx` sends
 *      `subject: ""` with a comment calling it "the minimum the API accepts",
 *      and the API answers `subject: Required — …`. Reproduced rather than
 *      accommodated: a mock that let that through would hide a live defect.
 *
 * `segment_id` naming no segment is refused with the sentence measured on
 * `PATCH`; that the same validator runs on create is an extrapolation from one
 * field, and it is named here rather than left to read as measured.
 */
function createCampaign(body) {
  const input = body ?? {};
  const fields = {};

  const name = (readString(input.name) ?? "").trim();
  if (name === "") fields.name = NAME_REQUIRED;

  const subject = (readString(input.subject) ?? "").trim();
  if (subject === "") fields.subject = SUBJECT_REQUIRED;

  const audienceType = readString(input.audience_type) ?? "segment";
  const segmentId = Number.isInteger(input.segment_id) ? input.segment_id : 0;
  if (audienceType === "segment") {
    if (segmentId <= 0) fields.segment_id = SEGMENT_ID_REQUIRED;
    else if (segmentById(segmentId) === undefined) fields.segment_id = NO_SUCH_SEGMENT;
  }

  if (Object.keys(fields).length > 0) return invalidCampaign(fields);

  const id = state.nextCampaignId++;
  const row = {
    id,
    name,
    subject,
    template_id: 0,
    body_html: sanitizeCampaignHtml(readString(input.body_html) ?? ""),
    body_text: readString(input.body_text) ?? "",
    audience: {
      type: audienceType,
      segment_id: audienceType === "segment" ? segmentId : 0,
      customer_ids: Array.isArray(input.customer_ids) ? input.customer_ids : [],
    },
    status: "draft",
    is_editable: true,
    allowed_transitions: ["sending", "cancelled"],
    recipients: { total: 0, sent: 0, failed: 0, purged: false },
    created_by: IDENTITY.id,
    created_at: iso(0),
    updated_at: iso(0),
    claimed_at: null,
    completed_at: null,
  };

  state.campaigns.set(id, row);
  state.createdCampaigns.unshift(id);
  return created(row);
}

/**
 * `wp_kses` with an email-safe allowlist, as far as this file needs it.
 *
 * Measured: `<script>alert(1)</script><p>ok</p>` is stored as
 * `alert(1)<p>ok</p>` — **the tag stripped and the text kept**, which is the
 * property that makes rendering a stored body into a preview safe. Only the
 * `<script>` case is reproduced, because it is the only one measured; `on*`
 * attributes and `javascript:` hrefs are refused by the same allowlist upstream
 * and nothing here has watched one go through.
 */
const sanitizeCampaignHtml = (html) =>
  html.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "$1").replace(/<\/?script[^>]*>/gi, "");

/**
 * `PATCH /campaigns/{id}`.
 *
 *   a non-draft            409 `conflict`, `details.status` names which
 *   `{}` or read-only keys 400 "No supported fields were provided." — the
 *                          `bareFail` shape, with **no `details` key at all**,
 *                          exactly as `PATCH /products/{id}` and `/media/{id}`
 *   `name: ""`             400 "Cannot be blank."
 *   `segment_id: 99999`    400 "No segment with that id."
 *   `audience_type:"segment"` with no id  **200**, `segment_id: 0` — the create
 *                          refuses this and the edit does not, measured on both
 *
 * The conflict is checked before the body, which is not measured: nobody has
 * sent `{}` to a sent campaign. Named rather than left implicit.
 */
function patchCampaign(row, body) {
  if (!row.is_editable) {
    return fail(409, "conflict", NOT_A_DRAFT, { status: row.status });
  }

  const input = body ?? {};
  const writes = {};
  const fields = {};

  for (const key of ["name", "subject"]) {
    const value = readString(input[key]);
    if (value === null) continue;
    if (value.trim() === "") fields[key] = CANNOT_BE_BLANK;
    else writes[key] = value;
  }

  const html = readString(input.body_html);
  if (html !== null) writes.body_html = sanitizeCampaignHtml(html);
  const text = readString(input.body_text);
  if (text !== null) writes.body_text = text;

  const audienceType = readString(input.audience_type);
  const hasSegmentId = Number.isInteger(input.segment_id);
  const hasIds = Array.isArray(input.customer_ids);
  if (hasSegmentId && input.segment_id > 0 && segmentById(input.segment_id) === undefined) {
    fields.segment_id = NO_SUCH_SEGMENT;
  }

  if (Object.keys(fields).length > 0) return invalidCampaign(fields);

  if (audienceType !== null || hasSegmentId || hasIds) {
    const type = audienceType ?? row.audience.type;
    writes.audience = {
      type,
      segment_id: type === "segment" && hasSegmentId ? input.segment_id : 0,
      customer_ids: type === "ids" && hasIds ? input.customer_ids : [],
    };
  }

  if (Object.keys(writes).length === 0) {
    return bareFail(400, "invalid_request", "No supported fields were provided.");
  }

  const next = { ...row, ...writes, updated_at: iso(0) };
  state.campaigns.set(row.id, next);
  return ok(next);
}

/**
 * `DELETE /campaigns/{id}` — `{deleted: true}`, and **only for a draft**.
 *
 * Measured on a scratch campaign taken from draft to cancelled: the delete
 * answers 409 `conflict` with the sentence below and `details.status`. A
 * campaign has no trash — the row is gone rather than moved — which is why this
 * refusal exists at all: a sent campaign is the record of mail that left the
 * building.
 */
function deleteCampaign(row) {
  if (row.status !== "draft") {
    return fail(409, "conflict", NOT_DELETABLE, { status: row.status });
  }
  state.campaignsGone.add(row.id);
  return ok({ deleted: true });
}

/**
 * `POST /campaigns/{id}/cancel` — 200 with the **whole campaign row**, not a
 * receipt.
 *
 * Measured on a draft: `status` becomes `cancelled`, `is_editable` false,
 * `allowed_transitions` empty and `completed_at` is stamped — while
 * **`updated_at` is left alone**, which is why the cancelled seed row carries
 * three equal stamps rather than a later one.
 *
 * The refusal is measured on both terminal states:
 *
 *   sent       409 `A campaign in "sent" cannot be cancelled.`      {status, allowed: []}
 *   cancelled  409 `A campaign in "cancelled" cannot be cancelled.` {status, allowed: []}
 *
 * The status is quoted back inside the sentence, which is this API's notation
 * for *the thing you sent* — the same one the shipment 409 uses.
 */
function cancelCampaign(row) {
  if (!row.allowed_transitions.includes("cancelled")) {
    return fail(409, "conflict", `A campaign in "${row.status}" cannot be cancelled.`, {
      status: row.status,
      allowed: row.allowed_transitions,
    });
  }

  const next = {
    ...row,
    status: "cancelled",
    is_editable: false,
    allowed_transitions: [],
    completed_at: iso(0),
  };
  state.campaigns.set(row.id, next);
  return ok(next);
}

/**
 * ── `send` and `test`, and the one refusal this file deliberately cannot send ─
 *
 * **Neither was fired at the shop for this fixture**: a send mails a shop's
 * customers and nothing un-mails them. Both shapes come from measurements this
 * repository already records, and the source of each is named rather than left
 * to read as a fresh request.
 *
 *   send  **202** `{campaign_id, status: "sending", recipients, next}` —
 *         lib/campaigns.ts:408-421, and `next.command` is the whole point: the
 *         call resolves an audience and writes rows, and the mail leaves when a
 *         deployment runs `wp algerian-commerce send-campaigns`. A progress bar
 *         implying live delivery is a lie the operator would act on.
 *   test  **200 with `sent: false`** — ADMIN_PANEL.md's second correction and
 *         `scripts/seed-campaigns.mjs:40-48`. The request succeeded and the
 *         transport did not, which are different facts. It writes no recipient
 *         row, so a test never appears in the list below.
 *
 * **503 `mail_not_configured` is not served, and that is a measurement rather
 * than an omission.** It was the answer on this stack until `seed-campaigns.mjs`
 * set `SMTP_HOST=127.0.0.1:1` — a port nothing listens on — and the seeded shop
 * this file reproduces is the one *with* a transport. Serving the 503 would mean
 * reproducing a stack that no longer exists, and it would make `classifySendRefusal`'s
 * `"mail"` branch the one a capture reaches by default.
 *
 * The 409 for an audience matching nobody is likewise unserved: no seeded
 * campaign has an empty audience, and the sentence has never been seen here.
 */
const SEND_COMMAND = "wp algerian-commerce send-campaigns";

function sendCampaign(row) {
  if (!row.allowed_transitions.includes("sending")) {
    /*
     * **The only invented sentence on this branch, and it is flagged here rather
     * than left to be discovered** — the same treatment `MEDIA_LOGO_ID` gets in
     * the media usage block, and for the same reason: an invention nobody can
     * see is how DECISIONS.md's six invented CMS refusals and the coupons
     * `"Read-only."` got built into screens.
     *
     * The **status and the details are recorded** — lib/campaigns.ts:434-448 has
     * the 409 and `details.status` from the 2026-08-21 pass, and ADMIN_PANEL.md
     * says a second `send` is a 409 — and only the wording is this file's,
     * modelled on the `cancel` refusal measured beside it. It was not measured
     * because provoking a `send` mails a shop's customers and nothing un-mails
     * them.
     *
     * **No screen can reach it**: `Composer.tsx` renders the send control only
     * while `canSend()` is true, which is `allowed_transitions` containing
     * `sending`. So this is a fixture for a path the panel does not take, and a
     * screen must not be built to its words. Whoever is willing to spend a send
     * on a disposable draft should take the measurement.
     */
    return fail(409, "conflict", `A campaign in "${row.status}" cannot be sent.`, {
      status: row.status,
      allowed: row.allowed_transitions,
    });
  }

  /*
   * The recipient count is the campaign's audience resolved through the consent
   * filter, and this file cannot resolve one — so it answers the number the
   * *preview* of that campaign carries, which is the same count from the same
   * gate. A campaign created in this process has no preview and gets 8, the
   * count `all` resolves to on this shop.
   */
  const recipients = CAMPAIGN_PREVIEW_SEED.get(row.id)?.audience_count ?? 8;
  const next = {
    ...row,
    status: "sending",
    is_editable: false,
    allowed_transitions: ["cancelled"],
    claimed_at: iso(0),
    recipients: { total: recipients, sent: 0, failed: 0, purged: false },
  };
  state.campaigns.set(row.id, next);

  return {
    status: 202,
    body: {
      success: true,
      data: {
        campaign_id: row.id,
        status: "sending",
        recipients,
        next: { action: "drain", command: SEND_COMMAND },
      },
    },
  };
}

function testCampaign(row, body) {
  const to = readString((body ?? {}).to) ?? "";
  return ok({
    sent: false,
    to,
    subject: CAMPAIGN_PREVIEW_SEED.get(row.id)?.subject ?? row.subject,
    unknown_tokens: CAMPAIGN_PREVIEW_SEED.get(row.id)?.unknown_tokens ?? [],
  });
}

/* ---------------------------------------------------------- segment writes --- */

/**
 * ── Two different refusal shapes for criteria, and both are exact ───────────
 *
 * This is the part of the marketing surface most worth reproducing precisely,
 * because the two shapes disagree about **where the enumeration goes**:
 *
 *   POST /segments {name, criteria:{}}
 *     message  "A segment needs at least one criterion."
 *     details.fields.criteria  "Empty criteria would match every customer; use
 *                               audience_type \"all\" for that."
 *     details.supported        the eleven, as an array and a **sibling of
 *                              `fields`**
 *
 *   POST /segments {name, criteria:{zzz:1}}
 *     message  "The segment criteria are invalid."
 *     details.fields.zzz  "Unknown criterion. Supported: min_spent, …,
 *                          not_bought_product_id."
 *     — the same eleven, **inline in the sentence**, and no `supported` key at all
 *
 * lib/campaigns.ts:259-267 reads the eleven out of the first shape and calls it
 * "a copy of a server-side constant that the server itself publishes on
 * refusal". That is only true of the *empty* refusal; a form that read
 * `details.supported` after sending an unknown key would find nothing there.
 *
 * The seven refused-by-name criteria are reproduced verbatim too, and their
 * reasons are worth reading rather than paraphrasing — `sql` is answered with
 * the single word "No." All seven were re-measured on 2026-08-28 and all seven
 * match lib/campaigns.ts:302-324, which quotes three of them.
 */
const SEGMENT_CRITERIA = [
  "min_spent",
  "max_spent",
  "min_orders",
  "max_orders",
  "ordered_after",
  "ordered_before",
  "registered_after",
  "registered_before",
  "wilaya_id",
  "bought_product_id",
  "not_bought_product_id",
];

const REFUSED_CRITERIA = {
  consent:
    "Consent is applied to every audience by the resolver and is never a criterion — a criterion that could set it could switch it off.",
  email:
    "A segment is not a search box. Mail one customer from their own record, not from an audience definition.",
  email_contains:
    'A criterion on an address makes the resolver answer "does this address shop here", which is an enumeration oracle.',
  role: "Only customers are ever in an audience; a role filter would let a campaign reach staff accounts.",
  commune_id:
    "A shipment records a commune, but a commune-level audience is a handful of people and a definition that is wrong the moment one moves. Use wilaya_id.",
  limit:
    "A segment is a definition, not a page of results. A campaign sends to everyone the definition matches.",
  sql: "No.",
};

/**
 * The value rules. **Three of the four kinds were measured with a wrong value on
 * 2026-08-28** — `min_spent: "abc"`, `wilaya_id: "abc"` and
 * `registered_after: "nope"` — and `count` shares its sentence with `id`, which
 * is the one generalisation here. Each kind is a criterion the shop really
 * refuses; no kind was invented to fill the table.
 *
 * The API also **coerces** a well-shaped value: `min_orders: "3"` is a 201 that
 * stores `3`, not `"3"`, so `readCriteria` below coerces rather than merely
 * validating. A mock that stored the string would let a screen render a criteria
 * chip that differs from the one the shop would hand back.
 */
const CRITERION_VALUE = {
  money: 'Must be a decimal amount, e.g. "5000.00".',
  count: "Must be a whole number.",
  id: "Must be a whole number.",
  date: "Must be Y-m-d.",
};

const CRITERION_KIND = {
  min_spent: "money",
  max_spent: "money",
  min_orders: "count",
  max_orders: "count",
  ordered_after: "date",
  ordered_before: "date",
  registered_after: "date",
  registered_before: "date",
  wilaya_id: "id",
  bought_product_id: "id",
  not_bought_product_id: "id",
};

const SEGMENT_NAME_REQUIRED =
  "Required — a segment is referred to by name in every conversation about it.";
const EMPTY_CRITERIA =
  'Empty criteria would match every customer; use audience_type "all" for that.';
const UNKNOWN_CRITERION = `Unknown criterion. Supported: ${SEGMENT_CRITERIA.join(", ")}.`;

const MONEY = /^\d+(\.\d+)?$/;

/**
 * The measured sentence when the value does not fit its criterion, and the
 * **coerced** value when it does — a money criterion keeps its decimal string, a
 * date keeps its `Y-m-d`, and a count or an id becomes a number whether it
 * arrived as one or as a string.
 */
function readCriterion(key, value) {
  const kind = CRITERION_KIND[key];
  if (kind === "money") {
    if (typeof value === "number") return { value: value.toFixed(2) };
    return MONEY.test(String(value)) ? { value: String(value) } : { error: CRITERION_VALUE.money };
  }
  if (kind === "date") {
    return DAY.test(String(value)) ? { value: String(value) } : { error: CRITERION_VALUE.date };
  }
  return INTEGER.test(String(value))
    ? { value: Number.parseInt(String(value), 10) }
    : { error: CRITERION_VALUE.count };
}

/**
 * The criteria validator both writes share, and it answers **one of two whole
 * error bodies** rather than a field map — because the two shapes differ above
 * the `fields` key, not inside it.
 */
function readCriteria(criteria) {
  /*
   * A value that is not an object at all is refused **above** the two shapes
   * below, with a third message and the *segment's* sentence rather than the
   * criteria's — measured, `criteria: "x"` answers "The segment is invalid." with
   * `criteria: "Must be an object of criteria."`. An **empty array** is not this
   * case: it reads as an empty object and takes the empty-criteria branch, as
   * does criteria being absent entirely.
   */
  if (typeof criteria !== "object" || criteria === null) {
    return {
      error: fail(400, "invalid_request", "The segment is invalid.", {
        fields: { criteria: "Must be an object of criteria." },
      }),
    };
  }

  const keys = Object.keys(criteria);
  if (keys.length === 0) {
    return {
      error: fail(400, "invalid_request", "A segment needs at least one criterion.", {
        fields: { criteria: EMPTY_CRITERIA },
        // A **sibling** of `fields`, and only on this one refusal.
        supported: SEGMENT_CRITERIA,
      }),
    };
  }

  const fields = {};
  const value = {};
  for (const key of keys) {
    if (key in REFUSED_CRITERIA) fields[key] = REFUSED_CRITERIA[key];
    else if (!SEGMENT_CRITERIA.includes(key)) fields[key] = UNKNOWN_CRITERION;
    else {
      const read = readCriterion(key, criteria[key]);
      if (read.error !== undefined) fields[key] = read.error;
      else value[key] = read.value;
    }
  }

  if (Object.keys(fields).length > 0) {
    // No `supported` key here, which is the whole distinction.
    return { error: fail(400, "invalid_request", "The segment criteria are invalid.", { fields }) };
  }
  return { error: null, value };
}

/** `POST /segments` — 201, measured on a scratch segment created and deleted again. */
function createSegment(body) {
  const input = body ?? {};
  const name = (readString(input.name) ?? "").trim();

  // The name is reported alone when it is missing, even with criteria also
  // wrong: `POST {}` names `name` and nothing else. Measured.
  if (name === "") {
    return fail(400, "invalid_request", "The segment is invalid.", {
      fields: { name: SEGMENT_NAME_REQUIRED },
    });
  }

  const criteria = readCriteria(input.criteria ?? {});
  if (criteria.error) return criteria.error;

  const id = state.nextSegmentId++;
  const row = {
    id,
    name,
    description: readString(input.description) ?? "",
    criteria: criteria.value,
    is_resolvable: true,
    created_by: IDENTITY.id,
    created_at: iso(0),
    updated_at: iso(0),
  };
  state.segments.set(id, row);
  state.createdSegments.unshift(id);
  return created(row);
}

function patchSegment(row, body) {
  const input = body ?? {};
  const writes = {};

  const name = readString(input.name);
  if (name !== null) {
    if (name.trim() === "") {
      return fail(400, "invalid_request", "The segment is invalid.", {
        fields: { name: SEGMENT_NAME_REQUIRED },
      });
    }
    writes.name = name;
  }

  const description = readString(input.description);
  if (description !== null) writes.description = description;

  // `null` is read as absence rather than as a bad type: nothing has measured
  // what the shop does with it, and refusing is the direction that invents.
  if (input.criteria !== undefined && input.criteria !== null) {
    const criteria = readCriteria(input.criteria);
    if (criteria.error) return criteria.error;
    writes.criteria = criteria.value;
  }

  if (Object.keys(writes).length === 0) {
    return bareFail(400, "invalid_request", "No supported fields were provided.");
  }

  const next = { ...row, ...writes, updated_at: iso(0) };
  state.segments.set(row.id, next);
  return ok(next);
}

/**
 * `DELETE /segments/{id}`, and **a segment a campaign names cannot be deleted.**
 *
 * Measured by pointing a scratch campaign at a scratch segment: 409 `conflict`,
 * `details.campaigns` counting them and `details.fix` naming what to do. Both
 * scratch rows were removed afterwards.
 *
 * The count is **every** campaign naming it, cancelled ones included — 44 is
 * named only by the cancelled 320 and is undeletable in this fixture, which is
 * the state worth having: a person looking at the segments list cannot see why.
 */
function deleteSegment(row) {
  const users = campaignRows().filter((campaign) => campaign.audience.segment_id === row.id);
  if (users.length > 0) {
    return fail(409, "conflict", "That segment is used by a campaign.", {
      campaigns: users.length,
      fix: "Point those campaigns at another audience first.",
    });
  }
  state.segmentsGone.add(row.id);
  return ok({ deleted: true });
}

/* ------------------------------------------------------------------ staff --- */

const staffRows = () =>
  [
    ...state.createdStaff.map((id) => state.staff.get(id)),
    ...STAFF.map((row) => state.staff.get(row.id) ?? row),
  ].filter((row) => row !== undefined && !state.staffGone.has(row.id));

const staffById = (id) =>
  id === null ? undefined : staffRows().find((row) => row.id === id);

/**
 * `UserService::requireStaff()`'s sentence, and it answers for three different
 * facts: an id that belongs to nobody, an id that belongs to a **shopper**, and
 * an id whose account was deleted a moment ago. Measured on all three —
 * `/users/9999` and `/users/13` (a real `customer`) are byte-identical, which is
 * the property `lib/staff.ts:8-11` turns on: `/users` is staff and `/customers`
 * is shoppers, no account is in both, and neither route tells you the other
 * exists.
 */
const staffNotFound = () => fail(404, "not_found", "No staff account with that id.");

/** `UserInput`'s envelope. Every field refusal on this subject wears it. */
const userInvalid = (fields) =>
  fail(400, "invalid_request", "The user data is invalid.", { fields });

/**
 * ── One measured collation difference, and it is the `@` ────────────────────
 *
 * Every other sort in this file folds and compares with `<`, which is right
 * because MySQL's collation is accent-insensitive and case-insensitive. It is
 * also **UCA-ordered**, and JavaScript's `<` is code-point ordered, so the two
 * disagree wherever ASCII punctuation decides a comparison.
 *
 * Exactly one such pair exists on this collection and it was measured:
 *
 *   ?orderby=user_email&order=asc   live  [11, 12, **60, 59**, 288]
 *
 * `ac_apitest_support@example.test` before `ac_apitest@example.test` — `_`
 * (0x5F) sorting *before* `@` (0x40), which is the reverse of code-point order
 * and would have put 59 first here. Mapping `@` to U+0060 puts it after `_` and
 * before every letter, which reproduces that one sequence.
 *
 * **Nothing else about MySQL's ordering is claimed.** This is one substitution
 * for one measurement, not a collation: the shop's logins and addresses use
 * `-`, `.`, `_` and `@` and no pair of them turns on any boundary but this one,
 * which was checked across all 69 rows rather than assumed.
 */
const collate = (value) => fold(value).replaceAll("@", "`");

/**
 * The credential route's own path constraint, copied from
 * `UserController.php:85` character for character.
 *
 * **It checks the hyphenation and nothing else** — not the version nibble, not
 * the variant — so `00000000-0000-0000-0000-000000000000` routes and answers
 * "No application password with that identifier.", while `not-a-uuid` is a
 * routing 404 that never reaches a lookup. Two different facts, and only the
 * first tells a caller the account exists.
 */
const UUID4 = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const STAFF_SORTS = new Map([
  ["registered", (row) => row.date_created],
  ["ID", (row) => row.id],
  ["display_name", (row) => fold(row.display_name)],
  ["user_email", (row) => collate(row.email)],
  ["user_login", (row) => fold(row.username)],
]);

/**
 * `GET /users`, and **this is the run's strongest measured sort.**
 *
 * `UserController.php:137-142` declares `'enum' => UserRepository::ORDERBY` with
 * `rest_validate_request_arg`, `UserRepository.php:89` is the `in_array` that
 * applies it and `:90` the direction. So unlike `/notifications` — accepted and
 * ignored — and unlike `/products` for five values, this one both **refuses and
 * reorders**, and a mock that ignored it would let somebody ship a dead control.
 * Re-measured 2026-08-29, `per_page=5`, against the bare listing rather than
 * against a sibling value:
 *
 *   bare / registered desc / ID desc   [778, 776, 774, 770, 763]   (*)
 *   registered asc                     [  1,  11,  12,  14,  16]
 *   ID asc                             [  1,  11,  12,  14,  15]
 *   display_name asc / user_login asc  [ 11,  12,  59,  60, 288]
 *   display_name desc                  [776, 770, 231, 774,   1]
 *   user_email asc                     [ 11,  12,  60,  59, 288]
 *   user_email desc / user_login desc  [  1, 240, 231, 776, 778]
 *   ?orderby=zzz  ?orderby=  ?order=zzz  ?order=      **400**
 *
 * Seven distinct sequences over ten spellings, and `registered` differs from
 * `ID` — which is the check DECISIONS.md's standing rule asks for and which four
 * earlier collections failed by comparing two values against each other.
 *
 * **Three of the seven are reproduced here byte-for-byte** — `display_name asc`,
 * `user_login asc` and `user_email asc`, all three heads identical to the live
 * response, which is what makes `collate()` above a verified rule rather than a
 * plausible one. The other four cannot be and the reason is the fixture rather
 * than the sort:
 *
 *   · every **descending** head is displaced by the two rows the shop does not
 *     have — the acting user (`harness@…`, `h`) and the 340px overflow login
 *     (`responsable-…`, `r`), both of which outrank every `ac_*` login and
 *     address on the shop. They are the newest facts about this collection, not
 *     noise: a harness identity that were *not* in its own staff list is the
 *     defect this fixture exists to avoid.
 *   · `registered asc` differs because **the live rows tie**. Fourteen accounts
 *     share a registration second on the shop and MySQL breaks that however it
 *     likes; this fixture is a whole minute apart on every row, which is
 *     strictly the better fixture and is why no tie-break is invented below.
 *
 *  (*) The live default and `ID desc` agree only because the shop's ids and
 * registration order happen to. This fixture inverts 776/778 and 762/763
 * deliberately so they do not — a fixture where the default answers the same
 * sequence as a named value cannot tell a working sort from an ignored one.
 *
 * **`sort=user_login` is accepted and ignored**, because it is not a registered
 * argument — measured, byte-identical to the bare listing. So is `?bogus_param=1`.
 * That half matters as much as the sort: a screen that emitted the wrong
 * parameter name would look like it worked.
 */
function usersListing(params) {
  const orderby = params.get("orderby");
  if (orderby !== null && !STAFF_ORDERBY.includes(orderby)) {
    return invalidParam("orderby", notOneOf("orderby", STAFF_ORDERBY));
  }
  const order = params.get("order");
  if (order !== null && !SORT_DIRECTIONS.includes(order)) {
    return invalidParam("order", notOneOf("order", SORT_DIRECTIONS));
  }

  /*
   * `""` is a member of neither enum, so `?status=` and `?role=` are 400s and
   * not "no filter" — measured on both, and the reason is the router's rather
   * than a convention: each is `'enum' => …` with `rest_validate_request_arg`,
   * exactly as the sort pair is. `?search=` is not an enum at all and `""` is
   * absence there.
   */
  const status = params.get("status");
  if (status !== null && !STAFF_STATUSES.includes(status)) {
    return invalidParam("status", notOneOf("status", STAFF_STATUSES));
  }

  const role = params.get("role");
  if (role !== null && !STAFF_ROLES.includes(role)) {
    return invalidParam("role", notOneOf("role", STAFF_ROLES));
  }

  let rows = staffRows();
  if (status !== null) rows = rows.filter((row) => row.status === status);
  if (role !== null) rows = rows.filter((row) => row.role === role);

  /*
   * `UserRepository::paginate()` sets `search_columns` to `user_login`,
   * `user_email`, `user_nicename` and `display_name` — **never `first_name` or
   * `last_name`**, which is the one way this differs from what a person expects
   * and the reason `lib/staff.ts:277-288` says the field needs no note while
   * `/customers`' does.
   *
   * Measured with a control on each side: `?search=Karim` returns 774 — its
   * *display name* is "Karim B." — and `?search=Benali`, which is that same
   * account's **last name and nothing else**, returns **0 rows**. Without a row
   * shaped like 774 the claim is unfalsifiable here, which is the trap
   * `CONTROL_CUSTOMER` exists for one collection over.
   *
   * `user_nicename` is not published on the payload and is not searched here.
   * It is derived from the login on every row this shop has, so no term can
   * match it without matching `user_login` first — checked, not assumed.
   */
  rows = searchRows(rows, params, (row) => [row.username, row.email, row.display_name]);

  const key = STAFF_SORTS.get(orderby ?? "registered");
  const direction = (order ?? "desc") === "asc" ? 1 : -1;
  // No tie-break, because nothing ties: all 69 rows carry a distinct login,
  // address, display name and registration minute. A fixture that tied would
  // need a measured secondary order and there is none to have.
  rows = [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    return left < right ? -direction : left > right ? direction : 0;
  });

  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
}

const applicationPasswordsOf = (id) =>
  state.appPasswords.get(id) ??
  (APPLICATION_PASSWORD_SEED.get(id) ?? []).map(applicationPasswordRow);

/**
 * `GET /users/{id}` — **the list row plus exactly one key.**
 *
 * Measured by diffing the key sets: `application_passwords` and nothing else, so
 * a peek drawer would *not* be free on this collection under §0's rule, and a
 * detail screen renders in one request rather than two. The list must not carry
 * the key — `UserPresenter::toArray()` omits it when the argument is null, which
 * is the `CustomerPresenter` statistics decision one collection over.
 */
const staffDetail = (row) => ({
  ...row,
  application_passwords: applicationPasswordsOf(row.id),
});

const STAFF_READ_ONLY = [
  "id",
  "username",
  "role_name",
  "is_administrator",
  "date_created",
  "application_passwords",
];

/**
 * Refused **by name** rather than as "Unknown field.", each with the reason
 * `UserInput.php:54-60` gives verbatim.
 *
 * None of the five is ever emitted, so nobody arrives at one by round-tripping a
 * response — they are only typed on purpose. The panel offers a control for none
 * of them and cannot provoke any of these, which is exactly why they are here:
 * `user_login` is what decides the shape of the **edit** form. A username is set
 * once at creation and is read-only after, and a field that looked editable and
 * 400d would be a bug report.
 *
 * **`username` is not on this list and that is not an oversight.** It is
 * `READ_ONLY`, so a `PATCH` carrying it has the key *stripped* rather than
 * refused — which means `PATCH {"username": "x"}` reaches the empty-payload 400
 * `"No supported fields were provided."` instead. Measured through
 * `UserInput::forUpdate()` directly. That asymmetry is what lets a client GET an
 * account, change one field and PATCH the whole object back.
 */
const STAFF_REFUSED_FIELDS = {
  password:
    "A password set by somebody else is one its owner cannot trust. Onboard with POST /users/{id}/application-passwords.",
  user_pass:
    "A password set by somebody else is one its owner cannot trust. Onboard with POST /users/{id}/application-passwords.",
  capabilities: "Capabilities come from the role. Assign a role and GET /roles to see what it holds.",
  roles: 'An account holds exactly one role here. Use "role".',
  user_login: "A login is an identity, not a field. Create the account with the username you want.",
};

const STAFF_STRING_FIELDS = ["first_name", "last_name", "display_name"];
const STAFF_CREATE_FIELDS = ["username", "email", "role", ...STAFF_STRING_FIELDS];
const STAFF_UPDATE_FIELDS = ["email", "role", "status", ...STAFF_STRING_FIELDS];

const STAFF_MAX_LENGTH = 200;
const USERNAME_MIN = 3;
const USERNAME_MAX = 60;
/** `sanitize_user()`'s strict vocabulary, minus what only survives strict-off. */
const USERNAME_PATTERN = /^[A-Za-z0-9_.\-@ ]+$/;

/**
 * `UserRoles::assignmentError()` — **three refusals, not two**, and the third is
 * the interesting one.
 *
 * A retired role is not unknown: it exists, it is defined, and 50 of the 69
 * accounts here still hold one. Telling an operator `Unknown role
 * "ac_support_agent"` while the account in front of them visibly holds it is a
 * message that reads "no such thing" when the truth is "it exists and you may
 * not have it". All four sentences taken verbatim by calling the pure class
 * itself (2026-08-29) rather than transcribed by eye — the coupons branch is why
 * that distinction is worth the trouble.
 */
function roleAssignmentError(role) {
  if (role === "") {
    return "A role is required. An account with no role is a customer, and customers are managed at /customers.";
  }
  if (ASSIGNABLE_ROLES.includes(role)) return null;
  if (RETIRED_ROLES.includes(role)) {
    return `The role "${role}" is retired and is no longer assigned. Accounts already holding it keep it and are unaffected; new assignments choose one of: ${ASSIGNABLE_ROLES.join(", ")}.`;
  }
  if (CORE_ROLES.includes(role)) {
    return `This API manages commerce roles and does not grant "${role}". A WordPress role carries platform access — installing plugins, editing files — that no capability in this matrix models.`;
  }
  return `Unknown role "${role}". Choose one of: ${ASSIGNABLE_ROLES.join(", ")}.`;
}

/**
 * `UserInput::common()` plus the half that belongs to the verb.
 *
 * **The order the errors are collected in is the order they are reported in**,
 * and it is not the order the fields are listed in: unknown and refused names
 * first, then the three string fields, then `email`, then `role`, then `status`
 * — and only then, on a create, the three "Required." checks. Measured by
 * calling `UserInput::forCreate()` and `::forUpdate()` directly, which is the
 * only way to see it without a write: `{password, role: "editor", email: "nope"}`
 * reports `password`, `email`, `role`, in that order.
 *
 * One response names **every** bad field. A validator that stopped at the first
 * would make a form with three mistakes take three round trips.
 */
/**
 * PHP's `is_scalar($v) ? trim((string) $v) : ''`, which is what every field in
 * `UserInput` is read through.
 *
 * The booleans are the only place a naive `String()` would disagree: PHP casts
 * `true` to `"1"` and `false` to `""`, JavaScript to `"true"` and `"false"`. No
 * screen sends a boolean into a name field, which is exactly why it is worth two
 * characters here — a divergence nothing reaches is one nobody notices until
 * something does.
 */
const scalarString = (value) => {
  if (value === null || typeof value === "object" || value === undefined) return "";
  if (value === true) return "1";
  if (value === false) return "";
  return String(value).trim();
};

function readStaffBody(body, creating) {
  const payload = body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
  const allowed = creating ? STAFF_CREATE_FIELDS : STAFF_UPDATE_FIELDS;
  const fields = {};
  const clean = {};

  // Read-only keys are *dropped*, never refused — which is what makes a GET →
  // edit one field → PATCH the whole object round trip work.
  const supplied = Object.keys(payload).filter((name) => !STAFF_READ_ONLY.includes(name));

  for (const name of supplied) {
    if (!allowed.includes(name)) {
      fields[name] = STAFF_REFUSED_FIELDS[name] ?? "Unknown field.";
    }
  }

  for (const name of STAFF_STRING_FIELDS) {
    if (!Object.hasOwn(payload, name)) continue;
    const value = payload[name];
    // `null` is a real erasure and becomes `""`, which is why the schema's
    // three name fields are strings rather than nullable ones.
    if (value === null) {
      clean[name] = "";
      continue;
    }
    if (typeof value === "object") {
      fields[name] = "Must be a string.";
      continue;
    }
    const text = scalarString(value);
    if ([...text].length > STAFF_MAX_LENGTH) {
      fields[name] = `Must be at most ${STAFF_MAX_LENGTH} characters.`;
      continue;
    }
    clean[name] = text;
  }

  if (Object.hasOwn(payload, "email")) {
    const email = scalarString(payload.email);
    // **Not emptiable**, for the reason `UserInput.php:221-223` gives: a
    // WordPress user with no address cannot be sent a reset, and the account
    // becomes unrecoverable. So `""` is "Must be a valid email address." and
    // never an erasure — unlike the three name fields directly above.
    // Borrowed from the coupon restriction reader, which is the same shape
    // `filter_var(FILTER_VALIDATE_EMAIL)` accepts for every address this shop
    // holds. The two agree on the whole fixture set; nothing here turns on the
    // exotic corners where RFC 5322 and a regex part company.
    if (email === "" || !EMAIL_OR_WILDCARD.test(email)) {
      fields.email = "Must be a valid email address.";
    } else {
      clean.email = email;
    }
  }

  if (Object.hasOwn(payload, "role")) {
    const role = scalarString(payload.role);
    const problem = roleAssignmentError(role);
    if (problem !== null) {
      fields.role = problem;
    } else {
      clean.role = role;
    }
  }

  if (Object.hasOwn(payload, "status")) {
    const status = scalarString(payload.status);
    if (!STAFF_STATUSES.includes(status)) {
      // Family 2 of the four refusal families: a **body field** enum names no
      // parameter and punctuates with a colon, where the query-string enum
      // above writes "status is not one of active and suspended.".
      fields.status = oneOf(STAFF_STATUSES);
    } else {
      clean.status = status;
    }
  }

  if (creating) {
    if (!Object.hasOwn(payload, "username")) {
      fields.username = "Required.";
    } else {
      const username = scalarString(payload.username);
      const length = [...username].length;
      if (length < USERNAME_MIN || length > USERNAME_MAX) {
        fields.username = `Must be between ${USERNAME_MIN} and ${USERNAME_MAX} characters.`;
      } else if (!USERNAME_PATTERN.test(username)) {
        fields.username = "May contain letters, digits, spaces and _ . - @ only.";
      } else {
        clean.username = username;
      }
    }
    if (!Object.hasOwn(payload, "email")) fields.email = "Required.";
    if (!Object.hasOwn(payload, "role")) {
      // **Not the same sentence as `role: ""`.** A missing role is "Required."
      // and an empty one is "A role is required." — two messages for two
      // different mistakes, and a form quoting the wrong one back would be
      // telling somebody to fill in a field they did fill in.
      fields.role = "Required. An account with no role is a customer, and customers are managed at /customers.";
    }
  }

  return Object.keys(fields).length > 0 ? { error: userInvalid(fields) } : { writes: clean };
}

/**
 * `UserService::guardAssignable()` — a caller may not create an account able to
 * do something they cannot.
 *
 * **Inert for every credential this shop can issue, and that is the point.**
 * `ac_manage_users` is Super Admin's alone and Super Admin holds
 * `Capabilities::ALL`, so `capabilitiesBeyond()` is empty for anybody who got
 * past the gate — the rule exists against the *eighth* role and against a
 * capability granted to one account by hand, neither of which the shop has
 * today. It is reproduced rather than skipped because a guard that is unreachable
 * on the wire and absent from the harness is a guard nobody re-checks.
 *
 * It **is** reachable here, and only here: the harness's reduced identities are
 * constructed rather than measured, so `MOCK_IDENTITY=no_content` holds
 * `ac_manage_users` without `ac_manage_content` and granting `ac_super_admin`
 * from it answers the 403. That is a fixture, not a claim about the shop's
 * roles — the rule `reduced` set and every identity since has followed.
 */
function guardAssignable(role) {
  const capabilities = ROLES.find((row) => row.role === role)?.capabilities ?? [];
  const beyond = capabilities.filter((capability) => !IDENTITY.capabilities.includes(capability));
  return beyond.length === 0
    ? null
    : fail(
        403,
        "forbidden",
        `You cannot grant "${role}": it holds capabilities you do not have (${beyond.join(", ")}).`,
      );
}

/**
 * `POST /users` — **201**, and the row it answers with carries no
 * `application_passwords` key.
 *
 * A create goes through the row's own presenter with the argument omitted, so
 * the create's shape is the *list* row and not the detail's. A screen that
 * rebound its detail state to this response would find the key gone.
 *
 * The order the guards run in is `UserService::create()`'s and is observable:
 * every field refusal (400) precedes the escalation refusal (403), which
 * precedes the duplicate username (409), which precedes the duplicate email
 * (409). A payload wrong in two ways answers the first of those, not both.
 *
 * **`validate_username()` is not reproduced and cannot be reached.** It is
 * WordPress's own second gate, and its allowlist is byte-identical to the
 * pattern above, so the only thing it adds is an install-specific blocklist this
 * shop does not have. Named rather than mocked: inventing a refusal is the
 * `"Read-only."` mistake the coupons branch paid for.
 */
function createStaff(body) {
  const read = readStaffBody(body, true);
  if (read.error) return read.error;

  const refused = guardAssignable(read.writes.role);
  if (refused !== null) return refused;

  const rows = staffRows();
  const taken = (field, value) =>
    rows.some((row) => fold(row[field]) === fold(value));

  if (taken("username", read.writes.username)) {
    return fail(409, "conflict", "That username is already taken.", {
      username: read.writes.username,
    });
  }
  if (taken("email", read.writes.email)) {
    return fail(409, "conflict", "That email address is already in use.", {
      email: read.writes.email,
    });
  }

  const id = state.nextStaffId;
  state.nextStaffId += 1;
  const row = {
    id,
    username: read.writes.username,
    email: read.writes.email,
    first_name: read.writes.first_name ?? "",
    last_name: read.writes.last_name ?? "",
    /*
     * `wp_insert_user()` substitutes the login when `display_name` is empty,
     * which is why this collection has no blank one anywhere — checked against
     * every user row on the install, staff and shopper alike, and zero were
     * blank. `lib/staff.ts:312-320` is right and no fixture here invents the
     * state it says cannot exist.
     */
    display_name:
      (read.writes.display_name ?? "") === "" ? read.writes.username : read.writes.display_name,
    role: read.writes.role,
    role_name: ROLE_NAMES.get(read.writes.role) ?? read.writes.role,
    is_administrator: false,
    // A new account is active, because `UserStatus` stores only the suspension
    // and absence means active. `status` is not a create field at all — it is
    // "Unknown field." on a POST and a real one on a PATCH.
    status: "active",
    date_created: iso(0),
  };
  state.staff.set(id, row);
  state.createdStaff.unshift(id);
  return created(row);
}

/**
 * `PATCH /users/{id}` — 200, and **three of the five refusals live here.**
 *
 * The order is `UserService::update()`'s, and it is observable at every step:
 *
 *   1. field validation                400   `UserInput::forUpdate()`
 *   2. nothing left to write           400   "No supported fields were provided."
 *   3. the account is not staff        404
 *   4. changing your own role          403
 *   5. granting beyond yourself        403
 *   6. suspending your own account     403
 *   7. an address already in use       409
 *
 * Step 4 before step 5 matters: `PATCH /users/{me} {"role": "ac_manager"}` is
 * "You cannot change your own role." and not an escalation refusal. And step 1
 * before step 4 matters as much — `{"role": "administrator"}` on your own
 * account is the **400** vocabulary refusal, because `UserInput` never learns
 * whose account it is.
 *
 * **Promotion is not reproduced.** On the wire, a `PATCH` carrying a role
 * against a *shopper's* id promotes them and answers 200 with
 * `meta.promoted_from_customer: true`; here it is the 404 above. Named rather
 * than mocked: a customer row in this file has no `display_name` and no role, so
 * promoting one means inventing both, and no screen in the panel can reach the
 * route — the staff list is the only place a `/users/{id}` comes from and every
 * id on it is already staff. Recorded so it is an absence rather than a gap.
 */
function patchStaff(id, body) {
  const read = readStaffBody(body, false);
  if (read.error) return read.error;

  const writes = read.writes;
  if (Object.keys(writes).length === 0) {
    // No `details` key at all, not an empty one — the shape `PATCH /products`
    // already answers with and the reason `bareFail` exists.
    return bareFail(400, "invalid_request", "No supported fields were provided.");
  }

  const row = staffById(id);
  if (row === undefined) return staffNotFound();

  const self = id === IDENTITY.id;

  if (Object.hasOwn(writes, "role")) {
    if (self) {
      return fail(
        403,
        "forbidden",
        "You cannot change your own role. Ask another Super Admin.",
      );
    }
    const refused = guardAssignable(writes.role);
    if (refused !== null) return refused;
  }

  if (writes.status === "suspended" && self) {
    return fail(403, "forbidden", "You cannot suspend your own account.");
  }

  if (Object.hasOwn(writes, "email")) {
    const clash = staffRows().some(
      (other) => other.id !== id && fold(other.email) === fold(writes.email),
    );
    if (clash) {
      return fail(409, "conflict", "That email address is already in use.", {
        email: writes.email,
      });
    }
  }

  const next = { ...row, ...writes };
  if (Object.hasOwn(writes, "role")) {
    next.role_name = ROLE_NAMES.get(writes.role) ?? writes.role;
    // `set_role()`, not `add_role()`: this API models exactly one role, so a
    // demotion that left the old capabilities in place would demote nothing.
    // A WordPress administrator given a managed role stops being one.
    next.is_administrator = writes.role === "administrator";
  }
  if (next.display_name === "") next.display_name = next.username;
  state.staff.set(id, next);
  return ok(next);
}

/**
 * `DELETE /users/{id}` — `{id, deleted: true}`, and **not the row.**
 *
 * Worth pinning, because the obvious implementation rebinds the detail screen to
 * the response and finds a two-key object where an account was.
 *
 * **`guardNotSelf()` runs before the id is resolved** (`UserService.php:170`
 * ahead of `:172`), which is not a detail: deleting your own id answers 403 even
 * when that id is not a staff account, so the refusal is about who you are and
 * never about what exists. A screen that read the 404 as "already deleted" would
 * be wrong about the one case it matters in.
 */
function deleteStaff(id) {
  if (id === IDENTITY.id) {
    return fail(403, "forbidden", "You cannot delete your own account.");
  }

  const row = staffById(id);
  if (row === undefined) return staffNotFound();

  const orders = STAFF_ORDER_COUNTS.get(id) ?? 0;
  if (orders > 0) {
    /*
     * `wp_delete_user()` reassigns *posts* and knows nothing about HPOS, so an
     * order keyed to the deleted `customer_id` becomes a row no report can
     * attribute. The refusal names the alternative, and `details.orders` is a
     * **count** rather than a list — `deleteConflictCount()` reads it and the
     * panel offers the suspension as a button instead of repeating the sentence.
     */
    return fail(
      409,
      "conflict",
      'That account owns orders and cannot be deleted. Suspend it instead: PATCH /users/{id} with {"status":"suspended"}.',
      { orders },
    );
  }

  state.staffGone.add(id);
  state.staff.delete(id);
  state.appPasswords.delete(id);
  return ok({ id, deleted: true });
}

/**
 * A uuid and a 24-character secret, both derived from a counter.
 *
 * `WP_Application_Passwords::PW_LENGTH` is **24** and
 * `wp_generate_password(24, false)` draws from letters and digits only — no
 * spaces, which is what `lib/staff.ts:234-237` records and why the panel renders
 * whatever arrived instead of re-grouping it into wp-admin's six spaced blocks.
 *
 * Derived rather than random because **the mint response is the one screen in
 * this panel whose entire content is a value nobody can fetch twice**. A
 * screenshot of it has to be byte-stable or the capture suite cannot compare
 * two runs at all.
 */
const PASSWORD_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function mintedFrom(counter) {
  // splitmix32 rather than the linear congruential generator this started as:
  // the low bits of an LCG cycle short enough that the uuid visibly repeated its
  // own middle, and a credential a person is asked to copy must not *look*
  // broken even though nothing reads it.
  let x = (counter + 1) * 0x9e37_79b9;
  const next = () => {
    x = (x + 0x9e37_79b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x21f0_aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a_2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
  let secret = "";
  for (let i = 0; i < 24; i += 1) secret += PASSWORD_ALPHABET[next() % PASSWORD_ALPHABET.length];
  let hex = "";
  for (let i = 0; i < 32; i += 1) hex += (next() % 16).toString(16);
  // `wp_generate_uuid4()`'s shape: version 4 and the RFC 4122 variant nibble,
  // both fixed. The route pattern only checks the hyphenation, but a uuid that
  // was not a v4 would be one this API cannot have produced.
  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
  return { uuid, secret };
}

/**
 * `POST /users/{id}/application-passwords` — **201, and the only response in
 * this API that carries a usable credential.**
 *
 * `password` appears here and nowhere else: not on the collection, not on
 * `GET /users/{id}`, not in the audit row — which was checked for the secret
 * rather than assumed clean. So the panel shows it once and offers no reveal
 * affordance anywhere, because there is nothing to reveal.
 *
 * Four refusals in this order, and the first two are the ones a reading of the
 * service alone would get backwards:
 *
 *   1. a blank or missing name   400  — raised by the **controller**
 *      (`UserController.php:257-261`), so it precedes `requireStaff()`: a
 *      nameless mint against an id that does not exist is a 400 and not a 404.
 *      Its message has **no full stop** — "The application password data is
 *      invalid" — where every `UserInput` refusal beside it does. Reproduced
 *      rather than tidied.
 *   2. the account is not staff  404
 *   3. the account is suspended  409, **no details** — a fact about the account
 *      rather than about the name, which is why the panel puts it at the top of
 *      the section with the reactivate action beside it.
 *   4. a duplicate name          409, `details.name` — case-insensitive
 *      (`strcasecmp`), and it is a validation error on the field.
 *
 * **A fifth exists and is not reproduced**: `canIssueApplicationPasswords()`
 * answers 503 `application_passwords_unavailable` on an install without HTTPS.
 * Measured on this shop — `wp_is_application_passwords_supported()` is true and
 * `WP_ENVIRONMENT_TYPE` is `local` — so it cannot be provoked here, and a
 * fixture for it would be a status this shop never sends.
 */
function mintCredential(id, body) {
  const raw = body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
  const name = scalarString(raw.name);
  if (name === "") {
    return fail(400, "invalid_request", "The application password data is invalid", {
      fields: { name: "Required. Name the device or client this credential is for." },
    });
  }

  const row = staffById(id);
  if (row === undefined) return staffNotFound();

  if (row.status === "suspended") {
    return fail(
      409,
      "conflict",
      "That account is suspended. Reactivate it before issuing a credential.",
    );
  }

  const existing = applicationPasswordsOf(id);
  if (existing.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    return fail(409, "conflict", "That account already has an application password with this name.", {
      name,
    });
  }

  const { uuid, secret } = mintedFrom(state.mintedCredentials);
  state.mintedCredentials += 1;
  const item = { uuid, name, created: iso(0), last_used: null };
  state.appPasswords.set(id, [...existing, item]);
  return created({ ...item, password: secret });
}

/**
 * `DELETE /users/{id}/application-passwords/{uuid}` — `{uuid, revoked: true}`.
 *
 * The uuid is constrained **in the route pattern**, so a malformed identifier is
 * a routing 404 rather than a lookup — measured, and the comment at
 * `UserController.php:77-82` says why: it is one fewer place a caller can learn
 * whether an account exists. A well-formed uuid that belongs to nobody gets the
 * credential's own sentence, which is not the account's.
 */
function revokeCredential(id, uuid) {
  const row = staffById(id);
  if (row === undefined) return staffNotFound();

  const existing = applicationPasswordsOf(id);
  const item = existing.find((candidate) => candidate.uuid.toLowerCase() === uuid.toLowerCase());
  if (item === undefined) {
    return fail(404, "not_found", "No application password with that identifier.");
  }

  state.appPasswords.set(
    id,
    existing.filter((candidate) => candidate !== item),
  );
  return ok({ uuid, revoked: true });
}

/* --------------------------------------------------------------- settings --- */

/**
 * The value rules, and **two of the three sentences are the shop's**.
 *
 *   PATCH {"store":{"storefront_url":"boutique.dz"}}
 *     → details.fields["store.storefront_url"] "Must be a URL, including https://."
 *   PATCH {"contact":{"email":"nope"}}
 *     → details.fields["contact.email"]        "Must be an email address."
 *
 * Both keyed `block.key` rather than by the block, which is the two-level shape
 * `fieldErrorFor()`/`blockErrorFor()` exist for.
 *
 * **What was measured is the refusal, not the acceptance.** Exactly which
 * strings pass was never probed, so the predicates are the loosest reading of
 * each sentence — a scheme and an authority for the URL, something either side
 * of an `@` and a dot for the address. Tightening them beyond that would grow
 * refusals the wire may not answer, which is the *stricter* direction §0 calls
 * the quieter and more expensive one. `""` clears either field and is not a
 * refusal: `changedBlocks()` sends `""` for a field a reader emptied, and a mock
 * that refused it would break the panel's only way to clear one.
 *
 * `store.logo_id` is the third and its sentence is **this file's**, flagged
 * here rather than left to read as measured. It is a shape guard rather than a
 * validation: `logo_id` is writable, the panel offers no control for it, and no
 * refusal for a bad one was captured — but storing a string in it would hand the
 * *next* `GET` a document `lib/api/schemas/settings.ts` types `z.number()` and
 * refuses, which is a screen breaking at its own boundary against a body the
 * shop would never have stored. That is the argument `mustBeSeo` makes on
 * products, and the reason the harness guards the store rather than the caller.
 */
const SETTINGS_VALUE_RULES = {
  "store.storefront_url": (value) => {
    if (typeof value !== "string") return "Must be a URL, including https://.";
    if (value === "") return null;
    return /^[a-z][a-z0-9+.-]*:\/\/[^\s/]+/i.test(value)
      ? null
      : "Must be a URL, including https://.";
  },
  "store.logo_id": mustBeWholeNumber,
  "contact.email": (value) => {
    if (typeof value !== "string") return "Must be an email address.";
    if (value === "") return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "Must be an email address.";
  },
};

/**
 * `PATCH /settings` — the diff in, **the whole document out**.
 *
 * Verified rather than assumed: a `PATCH` naming only `contact.phone` came back
 * with `store`, `legal`, `social`, `features` and `providers` all present
 * (`settingsWritten`). That is why `settingsWriteResponse` *is* `settings` and
 * why the form rebinds to the response rather than to its own draft.
 *
 * ── The empty body, which is the one refusal that changes shape ──────────────
 *
 *   PATCH {}   400 "No supported fields were provided."
 *              details.fields: ["store","contact","legal","social"]   ← an ARRAY
 *
 * Every other refusal on this route keys `fields` as an **object**, by block or
 * by `block.key`. `BrowserApiError.fields` returns `null` for the array rather
 * than mis-rendering it, so a caller falls through to the top-level sentence —
 * which is the one a reader needs, and the alternative is putting
 * `store,contact,legal,social` on screen as though it were an explanation. The
 * panel never sends this request (`changedBlocks()` returns nothing when nothing
 * is dirty and the save bar does not appear); it is reproduced because it is the
 * shape a *future* caller meets, and because it is the only place in the whole
 * mock where `details.fields` is not a map.
 *
 * Note the message differs too: every other refusal here says *"The settings are
 * invalid."* This one does not, and it carries no per-field sentence at all.
 *
 * ── Everything else, in one answer ───────────────────────────────────────────
 *
 * A read-only block answers its own reason; an unrecognised block answers
 * "Unknown block."; an unrecognised *key* — which includes all four of the
 * read-only keys `GET` publishes inside `store` — answers "Unknown keys: …" for
 * the block, naming what it will take. **One response names every bad field**,
 * the standard `readStaffBody()` set, so a form with three mistakes takes one
 * round trip rather than three. The *order* the keys are collected in is the
 * body's own and was not measured; nothing reads it, since `fields` is a map.
 */
function patchSettings(body) {
  const payload = body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
  const names = Object.keys(payload);

  if (names.length === 0) {
    return fail(400, "invalid_request", "No supported fields were provided.", {
      fields: [...SETTINGS_WRITABLE_BLOCKS],
    });
  }

  const fields = {};
  const clean = {};

  for (const name of names) {
    if (name in SETTINGS_READ_ONLY_BLOCKS) {
      fields[name] = SETTINGS_READ_ONLY_BLOCKS[name];
      continue;
    }

    const known = SETTINGS_WRITABLE_KEYS[name];
    if (known === undefined) {
      fields[name] = `Unknown block. Known: ${SETTINGS_WRITABLE_BLOCKS.join(", ")}.`;
      continue;
    }

    const block = payload[name];
    const supplied =
      block !== null && typeof block === "object" && !Array.isArray(block)
        ? Object.keys(block)
        : [];

    // Named keys first and the whole block at once: an unknown key is a
    // complaint about the block, so it is keyed by the block and the values
    // beside it are never reached. That is the shape `settingsUnknownKey` and
    // `settingsRefusedCurrency` share — one sentence naming every bad key.
    const unknown = supplied.filter((key) => !known.includes(key));
    if (unknown.length > 0) {
      fields[name] = `Unknown keys: ${unknown.join(", ")}. Known: ${known.join(", ")}.`;
      continue;
    }

    for (const key of supplied) {
      const rule = SETTINGS_VALUE_RULES[`${name}.${key}`] ?? mustBeText;
      const problem = rule(block[key]);
      if (problem !== null) {
        fields[`${name}.${key}`] = problem;
        continue;
      }
      (clean[name] ??= {})[key] = block[key];
    }
  }

  if (Object.keys(fields).length > 0) return invalidBody("The settings are invalid.", fields);

  // A partial write updates only what it names, and `""` clears a field — so the
  // block is merged rather than replaced, and the answer is the whole document.
  for (const [name, values] of Object.entries(clean)) Object.assign(state.settings[name], values);
  return ok(state.settings);
}

/* -------------------------------------------------------------- transfer --- */

/**
 * ── Import and export: the one subject whose response is not an envelope ─────
 *
 * `GET /export/{products,orders,inventory,customers}` answers a **file** and
 * `POST /import/{products,inventory}` takes the CSV as the **raw request body**.
 * Both halves are measured, and where they are not this block says so at the
 * site rather than in prose somewhere else.
 *
 * The measured sources, and there are three of them:
 *
 *   lib/transfer.ts               the capability grid, the refusal sentences and
 *                                 the four preview shapes, dated 2026-08-21
 *   lib/api/schemas/transfer.ts   the Zod shapes these responses must parse
 *                                 against, from the same session
 *   tests/fixtures-admin.json     **19 responses captured verbatim** on the same
 *                                 day — every sentence below that is in quotes
 *                                 is copied from it rather than written here
 *
 * **A copied measurement is not a fresh one.** Nothing in this file has been
 * re-run against the live shop; 2026-08-21 is eight days before this branch, and
 * the products export was repaired *after* that capture — see `EXPORT_COLUMNS`,
 * where the fixture's own header row is stale and the round-trip fixtures beside
 * it prove it.
 *
 * ── What is emitted here and is nobody's measurement ─────────────────────────
 *
 * Flagged at each site, following `mock-api.mjs:13353`:
 *
 *   · every **value** in an exported row (the column *names* are measured; what
 *     this shop's fixtures put under them is this file's own)
 *   · the `items` column of the orders export, whose format was never captured
 *   · the line ending of the products export *after* the field-name repair
 *   · `?dry_run=zzz`, `?limit=` and `?mode=` — the refusal *families* are
 *     measured on other routes, never on these
 *   · the `reason` on an applied products row, carried over from the dry run
 *   · that an applied products import mints an id and creates nothing
 */

/** lib/transfer.ts:99, and the cap the panel's own route clamps to. */
const EXPORT_LIMIT_MAX = 2000;

/**
 * Which capability guards which subject — **capability follows the resource**,
 * which is what makes a Support Agent 200 on one export and 403 on the other
 * three. `SUBJECT_CAPABILITY` in lib/transfer.ts:57-62, duplicated here because
 * this file imports nothing, and asserted against the panel's own copy in
 * `tests/mock-api.test.ts` so the two cannot drift.
 */
const SUBJECT_CAPABILITY = {
  products: "ac_manage_products",
  orders: "ac_manage_orders",
  inventory: "ac_manage_inventory",
  customers: "ac_manage_customers",
};

const EXPORT_SUBJECTS = ["products", "orders", "inventory", "customers"];
const IMPORT_SUBJECTS = ["products", "inventory"];
const IMPORT_MODES = ["create", "update"];

/**
 * The raw CSV the shell parsed, or `null` for anything else — the shape
 * `multipartOf()` has one upload over, and for the same reason: *how the client
 * framed the request* is a fact the handler needs, not something to infer from
 * the bytes. A JSON body arrives here as the parsed object and answers the 400
 * that names `Content-Type`.
 */
const csvOf = (body) =>
  body !== null && typeof body === "object" && !Array.isArray(body) && typeof body.csv === "string"
    ? body.csv
    : null;

/**
 * `products-export-2026-08-18.csv`, and the date is **the mock's epoch** rather
 * than today's — `EPOCH`, like every other stamp in this file. A filename built
 * from `Date.now()` would make one byte of every export differ between runs and
 * put a moving value in front of a byte-comparing assertion.
 *
 * The live captures read `-2026-08-21`, which is the day they were taken.
 */
const EXPORT_DATE = iso(0).slice(0, 10);

/**
 * ── The four header rows, measured — and one of them twice ───────────────────
 *
 * Three are copied verbatim from `tests/fixtures-admin.json`'s `first_line`:
 * `exportOrders`, `exportInventory`, `exportCustomers`.
 *
 * **`products` is not, and that is deliberate.** That fixture's `first_line`
 * still reads `ID,Type,SKU,"GTIN, UPC, EAN, or ISBN",Name,…` — WooCommerce's
 * *display labels* — and it is **stale**: `fix/product-export-field-names` in
 * `ecom-temp` replaced them with field names, `lib/transfer.ts:104-139` and
 * ADMIN_PANEL.md:2735-2743 record the repair, and the same commit's own fixtures
 * prove the export changed while that line did not:
 *
 *   `exportProductsRoundTrip`  33 rows, every `sku` and `name` resolved — which
 *                              a label-headed file cannot produce, because
 *                              `map_headers()` matches exactly
 *   `importLabelHeader`        a 400 whose `columns_found` **is the new header**
 *                              with two cells put back to labels
 *
 * So the 52 names below are read off `importLabelHeader.columns_found` with its
 * two edited cells (`SKU`, `Name`) restored to `sku` and `name` — which is also
 * exactly what lib/transfer.ts:124 quotes: `id,type,sku,global_unique_id,name,…`.
 *
 * Reproducing the fixture's stale line instead would make this harness serve a
 * defect the backend has fixed, and would make `ROUND_TRIPS.products` — which
 * the screen renders as a badge — false against the mock and true against the
 * shop.
 */
const EXPORT_COLUMNS = {
  products: [
    "id",
    "type",
    "sku",
    "global_unique_id",
    "name",
    "published",
    "featured",
    "catalog_visibility",
    "short_description",
    "description",
    "date_on_sale_from",
    "date_on_sale_to",
    "tax_status",
    "tax_class",
    "stock_status",
    "stock_quantity",
    "low_stock_amount",
    "backorders",
    "sold_individually",
    "weight",
    "length",
    "width",
    "height",
    "reviews_allowed",
    "purchase_note",
    "sale_price",
    "regular_price",
    "category_ids",
    "tag_ids",
    "shipping_class_id",
    "images",
    "download_limit",
    "download_expiry",
    "parent_id",
    "grouped_products",
    "upsell_ids",
    "cross_sell_ids",
    "product_url",
    "button_text",
    "menu_order",
    // WooCommerce's own capitalisation, kept verbatim: the importer's key really
    // is `attributes:Name1` beside `attributes:value1`.
    "attributes:Name1",
    "attributes:value1",
    "attributes:visible1",
    "attributes:taxonomy1",
    "attributes:Name2",
    "attributes:value2",
    "attributes:visible2",
    "attributes:taxonomy2",
    "attributes:Name3",
    "attributes:value3",
    "attributes:visible3",
    "attributes:taxonomy3",
  ],
  orders: [
    "order_id",
    "date_created",
    "status",
    "currency",
    "total",
    "shipping_total",
    "discount_total",
    "payment_method",
    "customer_id",
    "billing_name",
    "billing_phone",
    "billing_email",
    "shipping_city",
    "shipping_state",
    "items",
  ],
  inventory: ["sku", "stock_quantity", "stock_status", "manage_stock", "name", "product_id"],
  customers: [
    "customer_id",
    "email",
    "first_name",
    "last_name",
    "phone",
    "address_1",
    "city",
    "state",
    "country",
    "date_registered",
  ],
};

/**
 * **The products export ends its lines with LF and the other three with CRLF.**
 *
 * Measured, and pinned by `tests/admin-schema.test.ts:960-968` from the same
 * capture: `CsvWriter` emits CRLF — RFC 4180, and what Excel on Windows expects
 * — while `WC_CSV_Exporter` emits LF, so the one export that is WooCommerce's
 * own disagrees with the three that are ours.
 *
 * **Unverified after the field-name repair, and named because the brief that
 * scoped this asked for CRLF everywhere.** The repair changed which *header* the
 * WooCommerce exporter writes and nothing recorded whether it still writes it
 * through `WC_CSV_Exporter`. The last actual measurement of this subject says
 * LF, and a harness that quietly standardised on CRLF would be the mock tidying
 * up an inconsistency the shop has — which is what `list()` was found doing to
 * three envelope shapes on 2026-08-26.
 */
const EXPORT_EOL = {
  products: "\n",
  orders: "\r\n",
  inventory: "\r\n",
  customers: "\r\n",
};

/** RFC 4180: quote a cell that holds a comma, a quote or a line break. */
const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * The rows each subject exports, from this file's own seeded fixtures and read
 * through anything a write has changed — a shelf a `POST /inventory/{id}/adjust`
 * has moved is in the export, because it is in `/inventory`.
 *
 * **Every value below is this file's own and none of it is measured.** The
 * *columns* are the API's, from the captures; what this shop's 39 products put
 * under `published` or `images` was never seen. The mapping is the obvious one
 * and it is still a mapping somebody wrote here.
 *
 * **Variations are not exported.** The live 33-row products file is 28 products
 * plus their 5 variations, and this one is the listed catalogue alone — a
 * divergence in the *count*, deliberate: the mock's variation slot 0 carries no
 * SKU, so exporting variations would put a row in the file that the round trip
 * this screen advertises cannot read back.
 */
const exportRowsFor = {
  products: () =>
    listed().map((product) => {
      // `attributes:taxonomy{n}` is the flag for *is this a global attribute*,
      // which is `id > 0` here: a global travels as its taxonomy (`pa_matiere`)
      // and a local one as a label (`Taille`) with no id, and
      // lib/api/schemas/product.ts is explicit that a reader has to know which
      // it is holding.
      const attributes = [0, 1, 2].flatMap((slot) => {
        const attribute = product.attributes[slot];
        return attribute === undefined
          ? ["", "", "", ""]
          : [
              attribute.name,
              attribute.options.join(", "),
              attribute.visible ? 1 : 0,
              attribute.id > 0 ? 1 : 0,
            ];
      });
      return [
        product.id,
        product.type,
        product.sku,
        "",
        product.name,
        product.status === "publish" ? 1 : 0,
        product.featured ? 1 : 0,
        product.catalog_visibility,
        product.short_description,
        product.description,
        "",
        "",
        "taxable",
        "",
        product.stock_status,
        product.stock_quantity,
        "",
        "no",
        0,
        product.weight,
        "",
        "",
        "",
        1,
        "",
        product.sale_price,
        product.regular_price,
        product.category_ids.join(", "),
        product.tag_ids.join(", "),
        "",
        product.image_id === 0 ? "" : product.image_id,
        "",
        "",
        0,
        "",
        "",
        "",
        "",
        "",
        0,
        ...attributes,
      ];
    }),
  orders: () =>
    ORDERS.map(orderRow).map((order) => [
      order.id,
      order.date_created,
      order.status,
      order.currency,
      order.total,
      order.shipping_total,
      order.discount_total,
      order.payment_method,
      order.customer_id,
      `${order.billing.first_name} ${order.billing.last_name}`.trim(),
      order.billing.phone,
      order.billing.email,
      order.shipping.city,
      order.shipping.state,
      // **Invented.** The column name is measured and its contents were never
      // captured; a count is the least this file can put there without writing a
      // format the shop may not use.
      order.line_items.length,
    ]),
  inventory: () =>
    inventoryRows().map((row) => [
      row.sku,
      row.stock_quantity,
      row.stock_status,
      row.manage_stock,
      row.name,
      row.id,
    ]),
  customers: () =>
    CUSTOMERS.map((customer) => [
      customer.id,
      customer.email,
      customer.first_name,
      customer.last_name,
      customer.billing.phone,
      customer.billing.address_1,
      customer.billing.city,
      customer.billing.state,
      customer.billing.country,
      customer.date_created,
    ]),
};

/**
 * A response that is **bytes rather than an envelope**, and the only one
 * `respond()` produces.
 *
 * The shell writes `body` straight out when it is a Buffer and JSON-encodes it
 * otherwise, which is what makes the two shapes distinguishable without a second
 * return type. `tests/mock-api.test.ts` reads the same two fields.
 *
 * The three headers are measured verbatim (`exportProducts` and its three
 * siblings): `text/csv; charset=utf-8`, an `attachment` filename that is the
 * API's, and `no-store, private` — which the panel's own route then rewrites
 * into a longer `no-store` string of its own.
 *
 * **The BOM is three real bytes**, `EF BB BF`, and that is the whole point of
 * this path existing: the defect ADMIN_PANEL.md:2695-2706 records is WordPress
 * JSON-encoding the file, which turns the mark into the six characters `Ã¯Â»Â¿`
 * and every newline into a literal `\r\n`. A mock that answered the envelope
 * here could not reproduce the shape the fix produced.
 */
const download = (subject, text) => ({
  status: 200,
  headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${subject}-export-${EXPORT_DATE}.csv"`,
    "cache-control": "no-store, private",
  },
  body: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]),
});

/**
 * `GET /export/{subject}`.
 *
 * **An export error is still the envelope, with its 4xx** — lib/transfer.ts:80-83
 * — which is what stops a client saving an error message as `products.csv`. So
 * the capability refusal and the `limit` refusal below both go out as JSON and
 * only a 200 is bytes.
 *
 * `?limit=999999` → 400 `details.params.limit` *"limit must be between 1
 * (inclusive) and 2000 (inclusive)"* is measured (`exportOverCap`), full stop
 * absent because it is the range family. **The default is not measured**: the
 * live captures all read 4 lines, so something truncated them and nothing
 * recorded what. Everything, here — a mock that invented a page size would make
 * a shop's export silently short.
 */
function exportCsv(subject, params) {
  const limitRead = pagingNumber(params, "limit", null, (value) =>
    value >= 1 && value <= EXPORT_LIMIT_MAX
      ? null
      : `limit must be between 1 (inclusive) and ${EXPORT_LIMIT_MAX} (inclusive)`,
  );
  if (limitRead.error) return limitRead.error;

  const rows = exportRowsFor[subject]();
  const capped = limitRead.value === null ? rows : rows.slice(0, limitRead.value);
  const eol = EXPORT_EOL[subject];

  const lines = [EXPORT_COLUMNS[subject], ...capped].map((cells) => cells.map(csvCell).join(","));
  return download(subject, `${lines.join(eol)}${eol}`);
}

/**
 * One CSV line into cells, RFC 4180 quoting included — the products export's own
 * header once held `"GTIN, UPC, EAN, or ISBN"`, and a splitter that read commas
 * inside quotes would report 54 columns for a 52-column file.
 *
 * **A quoted field containing a *newline* is not supported**, because the reader
 * below splits on line breaks first. Named rather than hidden: it is reachable
 * with a product description holding a paragraph break, and the fixtures this
 * harness serves carry none.
 */
function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let at = 0; at < line.length; at++) {
    const character = line[at];
    if (quoted) {
      if (character !== '"') cell += character;
      else if (line[at + 1] === '"') {
        cell += '"';
        at++;
      } else quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      cells.push(cell);
      cell = "";
    } else cell += character;
  }
  cells.push(cell);
  return cells;
}

/**
 * The uploaded file, or `null` for one with no header row at all.
 *
 * `line` is 1-based **over the file including its header**, so the first data
 * row is 2 — lib/api/schemas/transfer.ts:32-38 — and a blank line is skipped
 * without consuming a number, which is what keeps the numbers a preview reports
 * pointing at the rows a person can see in their spreadsheet.
 */
function readCsv(text) {
  const lines = text.split(/\r\n|\n|\r/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0 || lines[0].trim() === "") return null;

  return {
    header: splitCsvLine(lines[0]).map((name) => name.trim()),
    rows: lines
      .slice(1)
      .map((raw, index) => ({ line: index + 2, cells: splitCsvLine(raw) }))
      .filter((row) => row.cells.some((cell) => cell.trim() !== "")),
  };
}

/**
 * ── The three file-level refusals, all four sentences measured verbatim ──────
 *
 * Copied from `tests/fixtures-admin.json` — `importAsJson`, `importEmpty`,
 * `importMissingColumns`, `importLabelHeader` — including their top-level
 * messages, which are *not* the enum-sentence shape `checkSort()` still gets
 * wrong: each carries a generic sentence and the useful half lives under
 * `details.fields`.
 *
 * **`columns_found` and `columns_required` sit beside `fields`, never inside
 * it** (lib/api/schemas/transfer.ts:101-120). A form binding only to `fields`
 * throws away the half that turns the refusal into an answer, so the placement
 * is load-bearing rather than cosmetic and `fail()` is handed all three keys at
 * once.
 */
const importAsJson = () =>
  fail(400, "invalid_request", "Send the CSV as the request body.", {
    fields: { body: "Content-Type must be text/csv, and the body the file itself — not JSON." },
  });

const importEmpty = () =>
  fail(400, "invalid_request", "The file is empty.", {
    fields: { file: "A CSV with a header row is required." },
  });

const importMissingColumns = (found, required) =>
  fail(400, "invalid_request", "The file is missing required columns.", {
    fields: { file: `Missing: ${required.join(", ")}.` },
    columns_found: found,
    columns_required: required,
  });

/**
 * The **label-header** refusal, which is the products import's own and is the
 * control that keeps `fix/product-export-field-names` honest: a file WooCommerce
 * cannot map is a 400 naming the column it needs rather than a green
 * `created: 33, failed: 0` over fields nothing was read into.
 *
 * Which of the two refusals a header gets is **inferred, not measured**. Two
 * fixtures exist — `a,b,c` got the plain one and a header carrying `SKU`/`Name`
 * got this one — so the rule written here is "a case-insensitive match with no
 * exact one", which fits both and was never stated by the API.
 */
const importLabelHeader = (found) =>
  fail(400, "invalid_request", "The header does not name WooCommerce's import fields.", {
    fields: {
      file:
        'Missing: sku. WooCommerce\'s importer matches column names exactly and reads field names — sku, name, regular_price, stock_quantity — not the display labels "SKU" and "Regular price" that a wp-admin product export writes. GET /export/products writes a header this route can read.',
    },
    columns_found: found,
    columns_required: ["sku"],
  });

/**
 * **`preview_only` is present on a products dry run and nowhere else** — not on
 * an inventory dry run, where our own importer really does rehearse, and not on
 * either apply. Its presence is the signal and its English text is never
 * rendered (lib/transfer.ts:261-277). Verbatim from three separate captures.
 */
const PREVIEW_ONLY =
  "WooCommerce's product importer has no dry-run mode. This parsed the file with its own parser and looked each SKU up; it does not guarantee every write will succeed.";

/**
 * ── `POST /import/products` ──────────────────────────────────────────────────
 *
 * **The header is matched exactly**, which is the whole of the repair
 * lib/transfer.ts:104-139 describes: `CsvReader` lower-cases headers on purpose,
 * so `requireColumns(['sku'])` was satisfied by `SKU` while
 * `WC_Product_CSV_Importer::map_headers()` matches exactly and resolved nothing
 * — one file, two readers, and only the lenient one consulted. The precondition
 * now asks the importer's own `get_mapped_keys()`, so `SKU` is a 400 here and a
 * lower-cased match is *not* a match.
 *
 * `mode` decides the two outcomes and **neither does both** (`importProductsDry`
 * and `importProductsCreate`, measured on the same two-row file):
 *
 *   create (default)  an existing SKU is `skipped`, "a product with that SKU
 *                     already exists"; a new one is `created`
 *   update            an existing SKU is `updated`; a new one is `skipped`,
 *                     "no product with that SKU to update"
 *
 * The applied arm is the shape lib/transfer.ts:213 records and nothing here has
 * seen: `{line, action, product_id}` for a row that was written and
 * `{line, action, reason}` for one that was not, with **`line: 2` on every
 * row** — WooCommerce's importer reporting, not a defect, and the reason the
 * screen keys its table by index. The `reason` string is carried over from the
 * dry run rather than measured on an apply.
 */
function importProducts(csv, mode, dryRun) {
  const skuAt = csv.header.indexOf("sku");
  if (skuAt === -1) {
    const lenient = csv.header.some((name) => name.toLowerCase() === "sku");
    return lenient ? importLabelHeader(csv.header) : importMissingColumns(csv.header, ["sku"]);
  }
  const nameAt = csv.header.indexOf("name");

  const report = {
    dry_run: dryRun,
    rows: csv.rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    preview: [],
  };

  for (const row of csv.rows) {
    const sku = (row.cells[skuAt] ?? "").trim();
    const name = nameAt === -1 ? "" : (row.cells[nameAt] ?? "").trim();
    const existing = sku === "" ? undefined : listed().find((product) => product.sku === sku);

    const action =
      mode === "update"
        ? existing === undefined
          ? "skipped"
          : "updated"
        : existing === undefined
          ? "created"
          : "skipped";
    const reason =
      action !== "skipped"
        ? undefined
        : mode === "update"
          ? "no product with that SKU to update"
          : "a product with that SKU already exists";

    report[action] += 1;

    if (dryRun) {
      report.preview.push({ line: row.line, action, sku, name, ...(reason ? { reason } : {}) });
      continue;
    }

    // `line: 2` for every row, measured on a two-row file.
    report.preview.push(
      action === "skipped"
        ? { line: 2, action, reason }
        : {
            line: 2,
            action,
            product_id: existing === undefined ? state.nextImportedProductId++ : existing.id,
          },
    );
  }

  if (dryRun) report.preview_only = PREVIEW_ONLY;
  return ok(report);
}

/**
 * ── `POST /import/inventory` ─────────────────────────────────────────────────
 *
 * **It only ever updates.** A SKU nothing matches is an `errors[]` row, not a
 * created product — *"Not found. An inventory import never creates products."* —
 * and both halves of that error are measured (`importInventoryDry`): the generic
 * `message` is *"No product with that SKU."* and the useful half is keyed by the
 * column, which is the `details.fields` split this API has everywhere else.
 *
 * `stock_quantity` missing from a row is the other measured error shape,
 * lib/transfer.ts:279-288: `{line, message: "The row is invalid.", fields:
 * {"stock_quantity": "Required."}}`. **Whether a file with no `stock_quantity`
 * *column* is that error on every row or a file-level 400 was never captured**,
 * and this reads it as the row error — the only measured shape of the two.
 *
 * The header is matched **case-insensitively** here and exactly on products,
 * which is not tidy and is the measured asymmetry: this route is our own
 * `CsvReader`, which lower-cases on purpose, and that one is WooCommerce's.
 *
 * An apply really does write, through the same `writeStock()` a manual
 * adjustment uses, so the inventory screen agrees with the report. **It writes
 * no ledger movement**, and nobody measured whether the shop's does — so
 * `/inventory/{id}/movements` will not show what this changed. Same class as
 * `sendCampaign()`'s counts without rows, and named for the same reason.
 */
function importInventory(csv, dryRun) {
  const lower = csv.header.map((name) => name.toLowerCase());
  const skuAt = lower.indexOf("sku");
  if (skuAt === -1) return importMissingColumns(csv.header, ["sku"]);
  const quantityAt = lower.indexOf("stock_quantity");

  const report = {
    dry_run: dryRun,
    rows: csv.rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    preview: [],
  };

  for (const row of csv.rows) {
    const sku = (row.cells[skuAt] ?? "").trim();
    const raw = quantityAt === -1 ? "" : (row.cells[quantityAt] ?? "").trim();

    if (!/^-?\d+$/.test(raw)) {
      report.failed += 1;
      report.errors.push({
        line: row.line,
        message: "The row is invalid.",
        fields: { stock_quantity: "Required." },
      });
      continue;
    }

    const item = sku === "" ? undefined : inventoryRows().find((candidate) => candidate.sku === sku);
    if (item === undefined) {
      report.failed += 1;
      report.errors.push({
        line: row.line,
        message: "No product with that SKU.",
        fields: { sku: "Not found. An inventory import never creates products." },
      });
      continue;
    }

    const to = Number.parseInt(raw, 10);
    const from = item.stock_quantity;
    const unchanged = from === to;

    report[unchanged ? "skipped" : "updated"] += 1;
    if (!dryRun && !unchanged) writeStock(item, to);

    report.preview.push({
      line: row.line,
      action: unchanged ? "skipped" : "updated",
      sku: item.sku,
      product_id: item.id,
      from,
      to,
      // `reason` is on the applied shape only — measured on both arms, and it is
      // the one key that separates `inventory, applied` from `inventory, dry`.
      ...(!dryRun && unchanged ? { reason: "unchanged" } : {}),
    });
  }

  return ok(report);
}

/**
 * The route, and the order of its gates.
 *
 * The capability is checked by the caller, before this runs, because a
 * `permission_callback` runs before the handler on the wire: the measured grid
 * is 403 for a Marketing Manager and **400** for a Super Admin sending the same
 * broken body, so the refusal is about the credential rather than the file.
 *
 * Parameters next, then the body — WordPress validates registered arguments
 * before the callback runs. **Which of `mode` and `dry_run` is reported first
 * was not measured**, the way `paginate()` says of `per_page` and `page`.
 *
 * `dry_run` **defaults to true and only `false` writes** (lib/transfer.ts:168-177).
 * That is the safety property: a request that lost the parameter previews.
 */
function postImport(subject, params, body) {
  /*
   * `mode` is **products-only**, so `/import/inventory?mode=create` is a
   * parameter nobody registered and is ignored rather than refused — the rule
   * `?bogus_param=1` follows on every collection in this file. Offering the
   * control there would be offering a choice the route does not have.
   *
   * `?mode=nonsense` → 400 `details.params.mode` *"mode is not one of create and
   * update."*, measured verbatim (`importBadMode`), and `invalidParam()` +
   * `notOneOf()` are what emit it: the top-level message is
   * `"Invalid parameter(s): mode"` and the enum sentence stays in `details`,
   * which is the shape `checkSort()` and `filterByStatus()` still get wrong.
   * `?mode=` is refused with it — `""` is a value and not an absence, the family
   * measured on every sort in this file, never on this route.
   */
  let mode = "create";
  if (subject === "products") {
    const raw = params.get("mode");
    if (raw !== null) {
      if (!IMPORT_MODES.includes(raw)) {
        return invalidParam("mode", notOneOf("mode", IMPORT_MODES));
      }
      mode = raw;
    }
  }

  /*
   * **Unmeasured on this route**, and the direction matters: a mock that read
   * `?dry_run=zzz` as *true* would be more forgiving than the API and would hide
   * a typo behind the safe answer, while this refuses it the way every other
   * boolean parameter in this file was measured refusing one
   * (`include_variations`, `on_sale`, `featured`). The panel sends `false` or
   * nothing, so neither arm is reachable from the screen.
   */
  const rawDryRun = params.get("dry_run");
  if (rawDryRun !== null && !BOOLEANS.has(rawDryRun)) {
    return invalidParam("dry_run", "dry_run is not of type boolean.");
  }
  const dryRun = rawDryRun === null ? true : BOOLEANS.get(rawDryRun);

  /*
   * The body arrives as `{csv}` when the client sent `Content-Type: text/csv`
   * and as the parsed JSON otherwise, so "sent us JSON" is a fact about the
   * request rather than a guess about the bytes. A body of nothing at all is
   * `null` and reads as the empty file, which is the same 400 either way.
   */
  const csvText = csvOf(body);
  if (csvText === null) return body === null ? importEmpty() : importAsJson();

  const csv = readCsv(csvText);
  if (csv === null) return importEmpty();

  return subject === "products"
    ? importProducts(csv, mode, dryRun)
    : importInventory(csv, dryRun);
}

/* ----------------------------------------------------------- the audit trail --- */

/**
 * ── `GET /audit-logs`, and it is ONE route ──────────────────────────────────
 *
 * Read from `~/projects/ecom-temp` on 2026-08-29 rather than measured, and said
 * so: `src/API/AuditLogController.php:33-41` registers exactly one route, `GET`,
 * and the class docblock says why — *"Read-only by design. Audit records are
 * append-only, so there is no POST, PATCH or DELETE here and there never should
 * be."* **There is no `GET /audit-logs/{id}`.** `lib/api/allowlist.ts:406-410`
 * carries the single `rule("/audit-logs", "GET")` and `tests/boundary.test.ts:330,333`
 * asserts both halves refused, so the single-row route and every write verb stay
 * 404s here — the verb half falls out of `WRITES` above and the depth half is
 * stated in the `case` below.
 *
 * ── The row: nine fields, and `created_at` has no `T` and no offset ─────────
 *
 * `AuditRepository::hydrate()` (`:136-156`) casts all nine explicitly, so the
 * shape is fixed rather than whatever the column happened to hold:
 *
 *   id int · actor_id int · actor_login string · action · resource_type ·
 *   resource_id **string** · ip_address · metadata object · created_at
 *
 * `created_at` is `"2026-08-18 02:41:09"` — `AuditEvent` stamps
 * `gmdate('Y-m-d H:i:s')` and nothing else writes this table — which is what
 * `stamp()` already emits for the inventory ledger, so it is reused rather than
 * re-derived. `parseApiDate()` reads an offsetless stamp as UTC; `new Date()`
 * would shift every row by the host's offset with nothing on screen to say so.
 *
 * `metadata` is `{}` on a row whose writer recorded nothing —
 * `hydrate()` decodes `''` to `[]`, which `json_encode`s as `{}` through
 * `Response`. It is never null.
 *
 * ── Five parameters honoured, two accepted and ignored ─────────────────────
 *
 *   actor_id       honoured, `actor_id = %d`
 *   action         honoured, and validated by **pattern** `^[a-z0-9._-]+$`
 *   resource_type  honoured, and validated by the **same pattern** — see below
 *   resource_id    honoured, string, `maxLength` 64
 *   date_from/to   honoured, `Y-m-d`, **whole-day UTC both ends**
 *
 *   search         ACCEPTED AND IGNORED — never declared in `indexArgs()`
 *   orderby/order  ACCEPTED AND IGNORED — `AuditRepository.php:50` is a literal
 *                  `ORDER BY id DESC` with no branch anywhere near it
 *
 * **The two ignored ones are ignored here by nothing reading them**, which is
 * the only way to reproduce "accepted and ignored", and it is §0's whole
 * argument: a mock that sorted or searched would let somebody verify a control
 * against this harness and ship one that does nothing. The table is append-only,
 * so its id order *is* its time order and there is no second ordering to offer;
 * writes are audited by field name, so there is no column a free-text box could
 * search. `app/[locale]/(panel)/audit/query.ts` ships neither control.
 */

/**
 * **`resource_type` carries the same `^[a-z0-9._-]+$` pattern `action` does, and
 * the brief for this branch said it was merely "honoured".**
 *
 * `AuditLogController.php:66-71` declares it beside `action` with an identical
 * `pattern`/`validate_callback` pair. So `?resource_type=Product` and
 * `?resource_type=` are **400s**, not the 200-with-0-rows an unvalidated filter
 * would answer — which is the `channel`-versus-`status` distinction the
 * notification queue already records one collection over, arriving on a filter
 * nobody expected to validate. A mock that honoured it without validating would
 * be the *more permissive* direction on a control the screen renders as a
 * picker.
 *
 * `ac_banner` matches the pattern — `_` is inside the class — which is what
 * keeps the unnamed twenty-third resource type reachable through the filter as
 * well as renderable in a row.
 */
const AUDIT_KEY = /^[a-z0-9._-]+$/;
const AUDIT_KEY_PATTERN = "^[a-z0-9._-]+$";

/**
 * The five accounts that appear as actors, and the system.
 *
 * Real `/users` rows rather than invented ids, so the trail's actor links at
 * something the staff collection can actually resolve — `ac_audit_super` (762)
 * and `ac_audit_manager` (763) were already in `STAFF_SEED` for this route.
 *
 * **`0` with an empty login is the system** — a CLI drain or a migration — and
 * `AuditEvent` produces it by construction: `currentUserId()` is 0 with no
 * logged-in user and `max(0, …)` floors it. `isSystemActor()` in lib/audit.ts is
 * what renders it as a named state rather than as a zero.
 */
const AUDIT_ACTORS = new Map([
  [475, "ac_panel_super_admin"],
  [762, "ac_audit_super"],
  [536, "ac_coupon_marketing"],
  [474, "ac_panel_support_agent"],
  [0, ""],
]);

/**
 * A day off the shop's epoch, with the wall clock written out.
 *
 * The other fixtures here take `minutesAgo` because nothing reads their exact
 * hour. This one does: `date_from`/`date_to` cover the **whole day** at both
 * ends, so which side of midnight a row falls on is the property the filter is
 * verified with, and a minute offset would hide it behind arithmetic. The day
 * still comes off `EPOCH` rather than a literal, so the fixture moves with the
 * rest of the shop if the epoch ever does.
 */
const auditStamp = (daysAgo, time) =>
  `${new Date(EPOCH - daysAgo * 86_400_000).toISOString().slice(0, 10)} ${time}`;

/**
 * ── 28 rows, and every one of them has to discriminate ──────────────────────
 *
 * DECISIONS.md:62's standing rule, which has produced real defects four times: a
 * fixture where a filter's result equals the whole set proves nothing, and one
 * that ties on every row proves nothing either. So:
 *
 *   28 rows        → paging past page one is real, `total_pages` is 2, and the
 *                    default `per_page` of 20 leaves 8 on the second page
 *   actor_id       → 11 / 5 / 5 / 4 / 3 across five actors
 *   action         → 3 / 3 / 2 / 2 / 2 and singletons
 *   resource_type  → `product` is **4** where `action=product.updated` is **3**,
 *                    because `inventory.adjusted` is recorded against a
 *                    `product`. The two filters are independent, not aliases,
 *                    and this is the pair that proves it.
 *   resource_id    → `"104"` 2, `"1023"` 2, `"303"` 2, `"774"` 2, `"0"` 3
 *   created_at     → six days, 5/5/5/6/4/3
 *
 * and a regression that made `search` or `orderby` *work* changes the response
 * visibly rather than subtly: `?search=coupon` would cut 28 to 3, and
 * `?order=asc` would replace all twenty rows of page one.
 *
 * **Every action and every metadata shape below is read from the writer**, not
 * invented — `ProductService.php:137`, `OrderService.php:151`,
 * `SettingsService.php:101`, `NotificationService.php:215`,
 * `InventoryService.php:126`, `UserService.php:415,260`, `CouponService.php:142`,
 * `CustomerService.php:100`, `AccountService.php:252`, `CmsService.php:99,224,355,479,574,594`,
 * `ImportService.php:463`, `CampaignService.php:407`,
 * `DestinationSyncService.php:83`. A fixture whose shapes were guessed would let
 * the panel be built to metadata the shop never writes, which is the coupons
 * `"Read-only."` failure one screen over.
 *
 * The four `metadataShape()` kinds in lib/audit.ts:209-270 are all present —
 * `change` 4, `transition` 4, `fields` 8, `plain` 12 — because the panel renders
 * **by shape** and a suite that exercised one arm would prove nothing about the
 * three an operator actually meets.
 */
const AUDIT_SEED = [
  /* ── day 0, 2026-08-18 ─────────────────────────────────────────────────── */
  [16852, 0, "02:41:09", 475, "product.updated", "product", "104", {
    fields: ["name", "regular_price"],
    before: { name: "Miel de jujubier, 500 g", regular_price: "3200.00", status: "publish" },
    after: { name: "Miel de jujubier, 500 g", regular_price: "2950.00", status: "publish" },
  }],
  [16851, 0, "02:18:44", 475, "order.status_changed", "order", "1023", {
    from: "processing",
    to: "completed",
    stock_reduced: true,
  }],
  [16850, 0, "01:57:31", 762, "settings.updated", "settings", "0", {
    blocks: ["contact"],
    fields: ["contact.phone", "contact.hours"],
  }],
  /*
   * **The `[redacted]` row, and it is a fact to render rather than a gap.**
   * `Logger::redact()` masks any key containing `key`, so `dedupe_key` comes
   * back the literal string `Logger::MASK` — `"[redacted]"`, which lib/audit.ts
   * exports as `REDACTED`. A row rendering a blank here would say the key was
   * absent, which is untrue: the writer stored that string on purpose.
   */
  [16849, 0, "01:12:04", 0, "notification.retried", "notification", "4102", {
    channel: "email",
    event: "order.placed",
    dedupe_key: "[redacted]",
    status_from: "failed",
    attempts_before: 2,
  }],
  [16848, 0, "00:33:12", 474, "customer.updated", "customer", "24", {
    fields: ["email", "first_name"],
    before: { email: "nadia.cherif@example.test", first_name: "Nadia", last_name: "Chérif" },
    after: { email: "n.cherif@example.test", first_name: "Nadia", last_name: "Chérif" },
  }],

  /* ── day 1, 2026-08-17 ─────────────────────────────────────────────────── */
  [16847, 1, "22:41:55", 475, "coupon.updated", "coupon", "303", {
    code: "BIENVENUE10",
    fields: ["amount", "date_expires"],
  }],
  [16846, 1, "19:05:18", 536, "campaign.sent", "campaign", "322", {
    recipients: 184,
    frozen: true,
    audience_type: "segment",
    segment_id: 43,
  }],
  [16845, 1, "16:22:07", 475, "product.updated", "product", "104", {
    fields: ["status"],
    before: { name: "Miel de jujubier, 500 g", regular_price: "3200.00", status: "draft" },
    after: { name: "Miel de jujubier, 500 g", regular_price: "3200.00", status: "publish" },
  }],
  [16844, 1, "11:48:36", 762, "user.role_changed", "user", "774", {
    login: "ac_usr_new",
    from: "ac_support_agent",
    to: "ac_manager",
    promoted_from_customer: false,
  }],
  [16843, 1, "09:14:50", 474, "order.status_changed", "order", "1019", {
    from: "pending",
    to: "processing",
    stock_reduced: true,
  }],

  /* ── day 2, 2026-08-16 ─────────────────────────────────────────────────── */
  // 23:51 UTC, and the last row of its day. `?date_to=2026-08-16` keeps it only
  // because the bound is `<= 'D 23:59:59'` rather than midnight.
  [16842, 2, "23:51:02", 475, "media.deleted", "media", "5007", {
    file: "2026/07/tapis-berbere.jpg",
    mime_type: "image/jpeg",
    title: "Tapis berbère",
  }],
  /*
   * `cms.homepage_updated` carries a **list**, and lib/audit.ts:266-269 names
   * this row by action: `plainEntries()` renders a nested array as compact JSON
   * rather than dropping it, because a row that said the page changed and not
   * what about it would be showing less than arrived.
   *
   * Its `resource_id` is `CmsRepository::HOMEPAGE_OPTION` — the option name, not
   * a number — which is one of the three rows here that prove the argument is a
   * string.
   */
  [16841, 2, "20:30:41", 536, "cms.homepage_updated", "cms", "ac_cms_homepage", {
    sections: 6,
    types: ["hero", "featured_products", "categories", "banner"],
  }],
  [16840, 2, "17:09:23", 475, "cms.banner_updated", "banner", "612", {
    fields: ["title", "link"],
  }],
  [16839, 2, "13:44:58", 0, "import.products", "import", "0", {
    dry_run: false,
    rows: 262,
    created: 14,
    updated: 246,
    skipped: 2,
    failed: 0,
  }],
  [16838, 2, "08:26:11", 762, "cms.page_updated", "page", "58", {
    fields: ["title", "content", "status"],
    path_from: null,
    path_to: null,
    status_from: "draft",
  }],

  /* ── day 3, 2026-08-15 ─────────────────────────────────────────────────── */
  // 23:47 UTC, the whole-day boundary at the *other* end: `?date_to=2026-08-15`
  // must keep this row, and an implementation comparing against midnight drops it.
  [16837, 3, "23:47:10", 475, "coupon.created", "coupon", "319", {}],
  /*
   * **The same action as 16848 with a different metadata shape**, and both are
   * real: `CustomerService.php:100` writes `{fields, before, after}` when staff
   * edit a shopper, and `AccountService.php:252` writes `{fields, by: "self"}`
   * when the shopper edits themselves. So `metadataShape()` cannot be keyed off
   * the action, and this pair is why.
   */
  [16836, 3, "21:03:29", 474, "customer.updated", "customer", "31", {
    fields: ["phone", "billing_address"],
    by: "self",
  }],
  /*
   * **The unnamed twenty-third resource type, and it is a real typo rather than
   * a fixture flourish.** `CmsService::deleteContent()` (`:594`) records
   * `$postType` where every other banner path records `$label`, so a banner
   * *delete* lands in the table as `ac_banner` while a banner *update* lands as
   * `banner` — 16840 above is the pair. `RESOURCE_TYPES` in lib/audit.ts names
   * 22 and deliberately omits this one, so the row exercises the panel's
   * raw-string fallback.
   */
  [16835, 3, "18:37:44", 475, "cms.banner_deleted", "ac_banner", "609", { forced: true }],
  [16834, 3, "14:12:06", 536, "campaign.created", "campaign", "318", {
    name: "Soldes d'été",
    audience_type: "segment",
  }],
  [16833, 3, "10:55:37", 762, "user.app_password_created", "user", "774", {
    login: "ac_usr_new",
    name: "Panneau d'administration",
    uuid: "5f2c1a90-8b3d-4e17-9a44-6c0e2d8b7f31",
  }],
  [16832, 3, "07:41:19", 475, "product.updated", "product", "112", {
    fields: ["regular_price"],
    before: { name: "Bijou en argent de Beni Yenni", regular_price: "9800.00", status: "publish" },
    after: { name: "Bijou en argent de Beni Yenni", regular_price: "8900.00", status: "publish" },
  }],

  /* ── day 4, 2026-08-14 ─────────────────────────────────────────────────── */
  [16831, 4, "22:19:53", 474, "order.status_changed", "order", "1023", {
    from: "pending",
    to: "processing",
    stock_reduced: false,
  }],
  /*
   * **`before` and `after` that are NOT a change**, and this is the row that
   * proves `metadataShape()`'s object test is load-bearing rather than
   * decorative. `InventoryService.php:126-134` writes the two as *integers* —
   * `quantityBefore` and `quantityAfter` — so the `change` arm's
   * `typeof … === "object"` check rejects it and the row renders `plain`. A
   * classifier that merely checked the two keys were present would render a
   * stock adjustment as a field-by-field diff of two numbers.
   *
   * It is also the `actionSubject() !== resource_type` case lib/audit.ts:142
   * documents: the action is `inventory.*` and the resource is a `product`.
   * Deriving the filter from the action would send a request the API answers
   * with nothing.
   */
  [16830, 4, "16:48:02", 475, "inventory.adjusted", "product", "201", {
    mode: "set",
    quantity: 11,
    reason: "recount",
    note: "Inventaire trimestriel",
    stock_managed_by_id: 201,
    before: 14,
    after: 11,
  }],
  [16829, 4, "12:33:27", 0, "settings.updated", "settings", "0", {
    blocks: ["legal"],
    fields: ["legal.rc", "legal.nif"],
  }],
  [16828, 4, "09:07:15", 536, "shipping.destinations_synced", "shipping_provider", "yalidine", {
    written: 1541,
    wilayas: 58,
    communes: 1483,
  }],

  /* ── day 5, 2026-08-13 ─────────────────────────────────────────────────── */
  [16827, 5, "20:58:41", 475, "cms.menu_updated", "menu", "primary", { items: 7 }],
  [16826, 5, "15:22:09", 762, "cms.faq_category_updated", "faq_category", "7", {
    fields: ["name", "description"],
    slug_from: null,
    slug_to: null,
  }],
  [16825, 5, "11:04:33", 474, "coupon.updated", "coupon", "303", {
    code: "BIENVENUE10",
    fields: ["usage_limit"],
  }],
];

/**
 * The trail as it reads.
 *
 * **`ORDER BY id DESC` and nothing else** — `AuditRepository.php:50` is a
 * literal with no branch — so the sort is applied once, here, and no request
 * parameter can reach it. That is what makes `?orderby=` and `?order=` ignored
 * rather than merely undeclared.
 *
 * `ip_address` is `127.0.0.1` on the system rows, which is what `ClientIp`
 * returns for a CLI drain with no request behind it, and the docker bridge on
 * the rest — the two values lib/api/schemas/audit.ts:44 records.
 */
const AUDIT_LOGS = [...AUDIT_SEED]
  .sort((a, b) => b[0] - a[0])
  .map(([id, daysAgo, time, actorId, action, resourceType, resourceId, metadata]) => ({
    id,
    actor_id: actorId,
    actor_login: AUDIT_ACTORS.get(actorId) ?? "",
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    ip_address: actorId === 0 ? "127.0.0.1" : "172.18.0.1",
    metadata,
    created_at: auditStamp(daysAgo, time),
  }));

/**
 * ── PHP's falsy filter, and it is why `?resource_id=0` returns EVERY row ────
 *
 * `AuditLogController::index()` runs the six filters through `array_filter()`
 * before the repository sees them, and `AuditRepository::buildWhere()` guards
 * each clause again with `!empty()`. **Both drop `"0"`**, because `"0"` is falsy
 * in PHP — the controller's own comment at `:121-124` says it is deliberate and
 * gets the reason slightly wrong (*"`0` is not an id anything here records"*)
 * while `lib/api/schemas/audit.ts:40-42` records that `"0"` is exactly what
 * `settings.updated` rows carry. Three rows in the fixture above hold it.
 *
 * So the behaviour is: `?resource_id=0` is **accepted, silently ignored, and
 * answers the whole collection** — a filter that matches three rows in the table
 * and cannot be asked for. This is reproduced rather than tidied for §0's
 * reason: a screen that linked a `settings.updated` row to its own history would
 * get the entire trail back and look like it was working.
 *
 * `""` reaches this only for `resource_id`. `action` and `resource_type` carry a
 * pattern that an empty string fails, so those are 400s before `array_filter`
 * ever runs, and `actor_id` is refused by `minimum: 1` for the same reason one
 * step earlier.
 */
const phpTruthy = (value) => value !== "" && value !== "0";

/**
 * ── `?actor_id=0` does NOT discriminate the system rows — it is a 400 ───────
 *
 * The brief for this branch asked which way this went, because the screen's
 * actor picker depends on the answer. It is refused, and by **two independent
 * guards**, either of which alone would settle it:
 *
 *   1. `AuditLogController::indexArgs()` ends with `$this->idArg('actor_id',
 *      false)`, and `AbstractController::idArg()` (`:77-88`) declares
 *      `'minimum' => 1`. `rest_validate_request_arg` runs before the sanitiser,
 *      so `?actor_id=0` never reaches the controller body — it is a **400**,
 *      the same shape `/notifications?subject_id=0` already answers here.
 *   2. Even with the minimum lifted, `array_filter()` and `!empty()` would each
 *      drop the zero, so it would answer the whole collection rather than the
 *      three system rows.
 *
 * **So the system actor is unreachable by the actor filter in both directions**,
 * and a picker offering "System" as a filter value would be a control that
 * cannot act — DECISIONS.md:67's standing rule. The rows still render as a named
 * state through `isSystemActor()`; they simply cannot be filtered *to*.
 * `app/[locale]/(panel)/audit/query.ts:91,108` already sends `actor_id` only
 * when it is `> 0`, so the panel never provokes this today — which is precisely
 * why the mock has to hold the refusal rather than assume nobody will.
 */
function auditListing(params) {
  /*
   * `action` and `resource_type` share one pattern and therefore one refusal.
   * `""` fails it — a value, not an absence — which is the finding the
   * notification queue recorded on four of its six parameters and which holds
   * here for the same reason: only a parameter that is not sent at all reaches
   * a default.
   */
  for (const name of ["action", "resource_type"]) {
    const raw = params.get(name);
    if (raw !== null && !AUDIT_KEY.test(raw)) {
      return invalidParam(name, notMatching(name, AUDIT_KEY_PATTERN));
    }
  }

  /*
   * `maxLength: 64` — the column is `varchar(64)`, and the route declares it, so
   * a 65-character value is **refused rather than clipped**. `tests/Api/audit.php:312`
   * is the backend's own assertion of it. The sentence is the `rest_too_long`
   * family the notification queue already writes out.
   */
  const resourceId = params.get("resource_id");
  if (resourceId !== null && resourceId.length > 64) {
    return invalidParam("resource_id", "resource_id must be at most 64 characters long.");
  }

  // `minimum: 1`, so `0` is a 400 and not the unset value it looks like — see
  // the block above for why that answer is the whole of the actor picker's brief.
  const actorRead = pagingNumber(params, "actor_id", null, (value) =>
    value >= 1 ? null : "actor_id must be greater than or equal to 1",
  );
  if (actorRead.error) return actorRead.error;

  for (const name of ["date_from", "date_to"]) {
    const raw = params.get(name);
    if (raw !== null && !YMD.test(raw)) {
      return invalidParam(name, notMatching(name, YMD_PATTERN));
    }
  }

  /*
   * `WHERE col = %s` against a `utf8mb4_unicode_520_ci` column, so the
   * comparison is case-insensitive — the notification queue's measured finding,
   * and the same collation. It is reachable on `resource_id` alone: `action` and
   * `resource_type` carry a lowercase-only pattern, so an uppercase value is
   * refused by the validator long before MySQL sees it.
   *
   * Still `=` and never `LIKE`. A `resource_id` that is a prefix of another must
   * not collect its history.
   */
  const equals = (name, key) => {
    const value = params.get(name);
    if (value === null || !phpTruthy(value)) return null;
    const wanted = value.toLowerCase();
    return (row) => String(row[key]).toLowerCase() === wanted;
  };

  /*
   * **Whole day at both ends**, which for a `Y-m-d H:i:s` column is exactly a
   * comparison on the date half: `created_at >= 'D 00:00:00'` is `day >= D`, and
   * `created_at <= 'D 23:59:59'` is `day <= D` because no stamp this writer
   * produces goes past `23:59:59`.
   *
   * The `realDate()` guard is the notification queue's, and it is needed for the
   * same measured reason: `?date_to=2026-13-45` passes the pattern, reaches MySQL
   * as a `DATETIME` comparison that is never true, and answers 200 with 0 rows.
   * A plain string comparison would answer **every row** on that bound instead —
   * a filter that widens rather than narrows, which is the shape a screen never
   * notices.
   */
  const realDate = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  };
  const bound = (name, compare) => {
    const value = params.get(name);
    if (value === null || value === "") return null;
    return realDate(value) ? (row) => compare(row.created_at.slice(0, 10), value) : () => false;
  };

  const actorId = actorRead.value;
  const tests = [
    actorId === null ? null : (row) => row.actor_id === actorId,
    equals("action", "action"),
    equals("resource_type", "resource_type"),
    equals("resource_id", "resource_id"),
    bound("date_from", (created, value) => created >= value),
    bound("date_to", (created, value) => created <= value),
  ].filter((test) => test !== null);

  /*
   * `?search=`, `?orderby=` and `?order=` are read by nothing above and nothing
   * below. That absence is the feature — see this section's header.
   */
  const rows = AUDIT_LOGS.filter((row) => tests.every((test) => test(row)));
  const page = paginate(rows, params);
  return page.error ?? ok(page.rows, page.meta);
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
 *
 * **`headers` is the fifth argument and it defaults to none**, which is what
 * keeps every existing caller byte-identical. It arrived when `/auth/me` started
 * reading the credential: the server shell passes node's own lower-cased
 * `request.headers`, and `tests/mock-api.test.ts` passes nothing, so a request
 * with no `Authorization` gets exactly the answer it got before this existed.
 * Only `authorization` is read, and only by `/auth/me` — see
 * `HARNESS_CREDENTIAL` for why that is a fixture lookup rather than a check.
 */
export function respond(
  method,
  pathname,
  searchParams = new URLSearchParams(),
  body = null,
  headers = {},
) {
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
    // Content is the first collection whose *every* member writes, and the only
    // one carrying a `PUT`: the homepage and a menu are both documents replaced
    // whole rather than collections of addressable rows.
    "cms",
    // `PATCH /media/{id}` is the alt-text edit, `POST /media` is the upload —
    // the one `multipart/form-data` request the panel makes, which the shell
    // parses since the media branch — and `DELETE /media/{id}` is the permanent
    // delete, served since 2026-08-28 alongside the usage read that makes it
    // explicable.
    "media",
    // Marketing writes on two of its four collections and reads the other two.
    // `/email-templates` is read-only at the API — §85 makes a template a post
    // authored in wp-admin — and `/marketing/config` is a GET with no arguments
    // at all, so neither is here and a `POST` to either falls to the 404.
    "campaigns",
    "segments",
    /*
     * **The only collection on this list whose write creates nothing.**
     * `POST /notifications/{id}/retry` puts one row back in a queue — three
     * columns, no id handed out, no ordering moved — and it is the *whole* of
     * what writes here: `POST /notifications` is absent because it does not
     * exist, a queue row being written by the system rather than by a person
     * (lib/api/allowlist.ts:314). The `case` below refuses every other verb and
     * path on the collection rather than letting this list decide it.
     */
    "notifications",
    /*
     * **The collection with the most writes in this file and the fewest screens
     * that can reach them**: `POST /users`, `PATCH`, `DELETE`, and the two on
     * the credential sub-resource. `/roles` is deliberately *not* here — it has
     * no write at all, and a `POST` to it falls to the 404 rather than being
     * decided by this list.
     */
    "users",
    /*
     * **The only entry here that is not a collection**, and the only one whose
     * write addresses no row: `/settings` is a single document with `GET` and
     * `PATCH` on it and no id anywhere in the path. Listing it here opens the
     * verb; the `case` below still refuses `POST`, `PUT` and `DELETE` by name,
     * because this list decides which collections may write and never which
     * verbs they take.
     */
    "settings",
    /*
     * **The only collection here that is write-only**, and the only one whose
     * body is not JSON: `POST /import/{products,inventory}` takes the CSV as the
     * raw request body with `Content-Type: text/csv`. There is no `GET /import`
     * — the `case` below refuses it — and the four exports beside it are reads,
     * so they are not on this list and a `POST /export/products` falls to the
     * 404 rather than being decided here.
     */
    "import",
  ];
  if (method !== "GET" && !WRITES.includes(collection)) return notFound();

  /*
   * **The one route in this file that reads a request header.** A recognised
   * refusal credential earns its refusal; everything else — including a request
   * with no `Authorization` at all, which is every call the unit suite makes —
   * gets the identity, exactly as it did before the check existed.
   *
   * The gate is here rather than at the top of `respond()` on purpose. The wire
   * authenticates every route in the namespace and this file authenticates one,
   * which is a real gap and is recorded as one: reproducing it everywhere would
   * mean the unit suite's 38 direct `respond()` calls and every `get()` beside
   * them presenting a credential, and the suite exists to check *shapes* rather
   * than the harness's own plumbing. `/auth/me` is where the panel's only
   * unauthenticated screen sends its credential, so it is where the refusals
   * have to be reachable; nothing else in the panel can produce a 401 a person
   * is looking at rather than being redirected by.
   */
  if (segments.length === 2 && collection === "auth" && second === "me") {
    return authRefusal(headers) ?? ok(IDENTITY);
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
  /*
   * **`/cms/pages/{path}` is the one route in this API with no fixed depth**, so
   * the ceiling above cannot apply to it. A page is addressed by its *full path*
   * — `legal/conditions-generales` is four segments and one resource, and a page
   * filed one level deeper is five — which is why lib/api/allowlist.ts:244 is
   * `/cms/pages/.+`, deliberately greedy, with the traversal guard in
   * `checkAllowed()` running first to make that safe.
   *
   * Lifting it for this collection alone rather than raising the number: at `> 5`
   * every *other* collection would gain a segment nobody wrote, which is the
   * mistake the comment above records `/orders/1000/notes` making when the guard
   * moved by one. `case "cms"` states its own depth per route underneath.
   */
  if (segments.length === 0) return notFound();
  if (segments.length > 4 && collection !== "cms") return notFound();

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
   * A capability gate. **Ten of the thirteen capabilities are enforced below**,
   * over twenty call sites.
   *
   * ── The count has now gone stale twice, so carry the command ───────────────
   *
   * This block said "three of them" and named `/customers` as deliberately
   * ungated; both halves were stale and were corrected to "eight over seventeen"
   * — which was itself stale within two branches, and was still standing at
   * eight when the login harness recounted it on 2026-08-29. That is
   * DECISIONS.md's own recurring failure: a number arriving in prose and being
   * copied rather than re-run, which the ledger has recorded of the capture
   * count, the refetch count and the `save-bar` count. **A count in a comment is
   * wrong the moment the next branch lands, so the check goes here instead:**
   *
   *     grep -c 'gatedOn(' scripts/mock-api.mjs                 # 20, +1 for the
   *                                                             # helper itself
   *     grep -o 'gatedOn("[a-z_]*")' scripts/mock-api.mjs | sort -u
   *
   * The second command lists **nine** literals; the tenth capability is
   * `ac_manage_products`, reached only through `SUBJECT_CAPABILITY[second]` on
   * `/export/{subject}` and `/import/{subject}`, so a grep for literals alone
   * undercounts by one. The three never enforced here are `ac_manage_coupons`,
   * `ac_manage_shipping` and `ac_view_analytics` — the last of which *is*
   * enforced, one gate over, by `canSeeMoney()` on `/analytics/revenue`.
   *
   * **All three of those absences are the mock being more permissive than the
   * panel's own model**, and they are recorded rather than closed for the reason
   * the next paragraph gives:
   *
   *     ac_manage_coupons    /coupons, /coupons/{id}, /coupons/eligible-*
   *                          — and lib/api/allowlist.ts:123-125 records the
   *                          measurement outright: a Marketing Manager is 403 on
   *                          the two eligible-* routes.
   *     ac_manage_shipping   /shipping/*, /shipments/*, /locations/*
   *                          — reachable today under MOCK_IDENTITY=reduced.
   *     ac_manage_products   the /products collection, /product-categories and
   *                          /attributes — reachable today under
   *                          MOCK_IDENTITY=no_transfer, which is refused at
   *                          `/export/products` and served at `/products` from
   *                          the same capability in the same process.
   *
   * `/payments` came first, on 2026-08-26, and the rule it set is the one still
   * followed: **a capability is enforced where it was measured and nowhere
   * else.** `/orders` and `/inventory` are enforced because the Support Agent
   * credential that measured the analytics money gate was measured 403 on both
   * of them in the same pass.
   *
   * **`/customers` is gated now, and the sentence that used to sit here is the
   * reason it is worth recording rather than deleting.** It read "`/customers`
   * beside them was a 200, which is why there is no gate on that collection
   * however plausible one would look" — a correct reading of the *Support
   * Agent's* measurement that was wrong about the capability, and DECISIONS.md
   * §16.1 is what it cost: closing the gap made `MOCK_IDENTITY=no_customers`
   * render that screen's forbidden state for the first time, and the capture
   * immediately showed a nav entry that could never have been photographed
   * while the mock answered 200. A mock more permissive than the wire does not
   * merely fail to catch a defect — it manufactures a passing screenshot of the
   * broken state.
   *
   * Every gate is inert for `full`, which holds all thirteen. Adding one without
   * an identity that lacks the capability would be a refusal nothing can reach;
   * adding the identity without the gate makes the mock answer 200 where the
   * shop answers 403, which is the *more permissive* direction the honesty audit
   * exists to catch. Both halves land together or neither does.
   */
  const gatedOn = (capability) =>
    IDENTITY.capabilities.includes(capability) ? null : forbidden();

  switch (collection) {
    case "orders": {
      const refused = gatedOn("ac_manage_orders");
      if (refused !== null) return refused;

      if (segments.length === 1 && method === "POST") return postOrder(body);

      const id = second === undefined ? null : numericId(second);
      const order = id === null ? undefined : findOrder(id);

      /* A numeric id naming no order is this collection's 404 — see
         `orderNotFound`. Answered once, before the split below, because the
         same gate stands behind the detail, the PATCH and every sub-resource.
         A non-numeric segment falls through to the routing 404 underneath. */
      if (second !== undefined && id !== null && order === undefined) {
        return orderNotFound();
      }

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

      if (method !== "GET") return notFound();

      // The list and the plain detail, both reading through any status a PATCH
      // has written.
      return collectionOf(allOrders(), {
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
      /*
       * **`ac_manage_customers`, and the mock did not check it for three
       * branches.** The wire answers 403 on every one of these; the harness
       * served them to any identity, so `MOCK_IDENTITY=no_customers` captured a
       * customer list nobody holding that credential can see. Found by the
       * notifications harness audit, which gated its own three routes and then
       * asked which neighbour shares the capability. The gate goes before the
       * depth check for the same reason the wire's does: a refusal is about the
       * credential, not about whether the path resolves.
       */
      const denied = gatedOn("ac_manage_customers");
      if (denied) return denied;

      // Depth is stated here, the way `/products` and `/orders` state theirs.
      if (segments.length > 3) return notFound();

      // The one sub-resource a customer has. Named, so `/customers/{id}/anything`
      // still falls to the 404 rather than being served the customer.
      if (segments.length === 3 && (method !== "GET" || segments[2] !== "orders")) {
        return notFound();
      }

      /*
       * The id is validated and resolved **before** the row is served, and in the
       * order the wire does it — measured 2026-08-28 on all four shapes:
       *
       *   /customers/24/nonsense    404 routing   the sub-resource name goes first
       *   /customers/99999/nonsense 404 routing   …even for an id that does not exist
       *   /customers/abc            404 routing   `\d+` never matched
       *   /customers/0              **400**       `idArg()`'s `minimum: 1`
       *   /customers/99999          404 not_found "No customer with that id."
       *   /customers/99999/orders   404 not_found the same sentence, one level down
       *
       * `collectionOf` answers the routing 404 for a missing row, which is right
       * for the collections that have no sentence of their own and wrong here.
       */
      if (second !== undefined && method === "GET") {
        const customerId = numericId(second);
        if (customerId === null) return notFound();
        if (customerId === 0) return invalidParam("id", "id must be greater than or equal to 1");

        const customer = CUSTOMERS.find((row) => row.id === customerId);
        if (customer === undefined) return customerNotFound();
        if (segments.length === 3) return customerOrders(customer, searchParams);
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
     * ── The queue: all three routes, and the gate that was missing ───────────
     *
     * This served the list alone until 2026-08-28 and said so — "`GET
     * /notifications/{id}` and `POST /notifications/{id}/retry` are both real
     * routes the notifications screen calls, and both are still 404s here". Both
     * are served now, which is what makes the detail screen capturable at all.
     *
     * **The gate is new and it is the honesty audit's find, not the brief's.**
     * All three routes are `Permissions::callback(Capabilities::MANAGE_CUSTOMERS)`
     * and every service method asserts it again; measured 2026-08-28 with a
     * credential holding no `ac_manage_customers`, `/notifications` and
     * `/notifications/{id}` are both **403 `forbidden`** with no `details`. This
     * file answered 200, which is the *more capable* direction — and the
     * `no_customers` identity that reaches it has existed since the marketing
     * branch, so the refusal was a path something could already take. The
     * screen's own `page.tsx` renders `ForbiddenState` on the same capability,
     * and until now that state could not be photographed against a mock that
     * agreed with it.
     *
     * `/customers` is 403 for the same credential and this file does not gate it
     * either. Left alone: that collection is not this branch's, and the fix is
     * one line at its own `case`.
     *
     * Depth is stated here, the way `/products` and `/orders` state theirs.
     */
    case "notifications": {
      const refused = gatedOn("ac_manage_customers");
      if (refused !== null) return refused;

      if (segments.length === 1) {
        return method === "GET" ? notificationsListing(searchParams) : notificationNoRoute();
      }
      if (segments.length > 3) return notificationNoRoute();

      /*
       * `(?P<id>\d+)` on both routes, so a non-numeric id never reaches the
       * controller and answers the *routing* sentence — while `0` matches the
       * regex, reaches `idArg()`'s `minimum: 1` and is a **400**, not a 404.
       * Measured live: `/notifications/0` is `Invalid parameter(s): id`. The
       * customers branch already answers its own `/customers/0` this way.
       */
      const id = numericId(second);
      if (id === null) return notificationNoRoute();
      if (id === 0) return invalidParam("id", "id must be greater than or equal to 1");

      if (segments.length === 2) {
        return method === "GET" ? notificationDetail(id) : notificationNoRoute();
      }
      // Named rather than matched loosely, so `/notifications/{id}/anything`
      // falls to the routing 404 instead of being served the row — and so a
      // `GET` on the retry path does too, since the route is POST-only.
      return segments[2] === "retry" && method === "POST"
        ? retryNotification(id)
        : notificationNoRoute();
    }

    /*
     * ── The trail: one route, one capability, and no single-row read ─────────
     *
     * **The shape check goes BEFORE the gate here, and that is deliberate.**
     * Every other `case` in this switch gates first, where the wire's
     * `permission_callback` sits — but `permission_callback` only runs on a
     * route that *matched*, and `/audit-logs/{id}` matches nothing: WordPress
     * raises `rest_no_route` in the router, before authorization is consulted.
     * So a credential without `ac_view_audit_logs` gets a **404** on
     * `/audit-logs/16825` and a **403** on `/audit-logs`, and gating first would
     * answer 403 to both. It is one line either way; this is the order the shop
     * has.
     *
     * The verb half is already settled above — `audit-logs` is deliberately
     * absent from `WRITES`, so `POST`, `PATCH` and `DELETE` fall to the routing
     * 404 without this `case` deciding anything. `tests/boundary.test.ts:330,333`
     * asserts both halves at the panel's own allowlist.
     */
    case "audit-logs": {
      if (segments.length > 1) return notFound();

      const refused = gatedOn("ac_view_audit_logs");
      if (refused !== null) return refused;

      return auditListing(searchParams);
    }

    /*
     * ── Staff: eight routes on one capability, and five of them write ────────
     *
     * **`ac_manage_users` is Super Admin's alone** — `UserController.php:19-22`
     * says so and it was measured on 2026-08-29 rather than trusted: a Manager,
     * a Support Agent and a Marketing Manager credential each answered **403
     * `forbidden`, "You are not allowed to perform this action.", no `details`**
     * on `/users`, `/users/{id}`, `/roles` and the credential collection alike.
     * The gate goes before the depth check, where the wire's
     * `permission_callback` is: a refusal is about the credential, not about
     * whether the path resolves.
     *
     * §16.1 is why this is not optional. An ungated mock does not merely fail to
     * catch a defect — it *manufactures a passing screenshot* of a screen the
     * credential cannot see, which is what the `/customers` gate was doing until
     * it was closed on 2026-08-28.
     *
     * `MOCK_IDENTITY=no_users` is the credential that reaches the refusal, and
     * it had to be added: all six identities held `ac_manage_users`, so this
     * gate would have been a path nothing in the harness could take — the same
     * hole `no_content`, `no_customers` and `no_marketing` were each added to
     * close one section over.
     *
     * ── The routing shapes, all measured on the same day ─────────────────────
     *
     *   /users/abc                      404 routing   `\d+` never matched
     *   /users/0                        **400**       `idArg()`'s `minimum: 1`
     *   /users/9999                     404 not_found "No staff account with that id."
     *   /users/13   (a real shopper)    404 not_found the same sentence exactly
     *   /users/778/nonsense             404 routing   the sub-resource name goes first
     *   /users/9999/nonsense            404 routing   …even for an id nobody holds
     *   /users/0/application-passwords  **400**       the id arg again, one level down
     *   /users/9999/application-passwords 404 not_found the account's sentence
     *   /users/778/application-passwords/not-a-uuid  404 routing — the uuid is
     *                                   constrained in the route pattern
     */
    case "users": {
      const refused = gatedOn("ac_manage_users");
      if (refused !== null) return refused;

      // Depth is stated here, the way `/products` and `/orders` state theirs.
      // Four, because the credential revoke is `/users/{id}/…/{uuid}`.
      if (segments.length > 4) return notFound();

      if (second === undefined) {
        if (method === "GET") return usersListing(searchParams);
        return method === "POST" ? createStaff(body) : notFound();
      }

      const id = numericId(second);
      if (id === null) return notFound();
      if (id === 0) return invalidParam("id", "id must be greater than or equal to 1");

      if (segments.length === 2) {
        if (method === "GET") {
          const row = staffById(id);
          return row === undefined ? staffNotFound() : ok(staffDetail(row));
        }
        if (method === "PATCH") return patchStaff(id, body);
        if (method === "DELETE") return deleteStaff(id);
        return notFound();
      }

      // Named rather than matched loosely, so `/users/{id}/anything` falls to the
      // routing 404 instead of being served the account.
      if (segments[2] !== "application-passwords") return notFound();

      if (segments.length === 3) {
        if (method === "GET") {
          const row = staffById(id);
          /*
           * `enumeration()` — **no `meta` key**, measured. The controller calls
           * `Response::success()` with no pagination and this collection pages
           * nothing; a screen that read `meta.total` off it would get a number
           * the shop does not send.
           */
          return row === undefined ? staffNotFound() : enumeration(applicationPasswordsOf(id));
        }
        return method === "POST" ? mintCredential(id, body) : notFound();
      }

      const uuid = segments[3];
      if (!UUID4.test(uuid) || method !== "DELETE") return notFound();
      return revokeCredential(id, uuid);
    }

    /*
     * `GET /roles` and nothing else — there is no write, because a role invented
     * at runtime would be a capability set no test enumerates and no review has
     * seen. `UserRoles`' own docblock argues it.
     */
    case "roles": {
      const denied = gatedOn("ac_manage_users");
      if (denied !== null) return denied;
      if (method !== "GET" || segments.length > 1) return notFound();
      return enumeration(ROLES);
    }

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

    /*
     * ── Content: five collections, two documents, and one capability ─────────
     *
     * **Every route here is `ac_manage_content` and the gate is enforced**, which
     * makes this the fourth gated collection in the file after `/payments`,
     * `/orders` and `/inventory` — and the first whose gate a *whole section* of
     * the panel hangs on. Measured, and recorded in lib/api/allowlist.ts:222-226:
     * a Manager is **403 on every route in this block**, and 200 on
     * `/notifications` beside it, which is `ac_manage_customers`. The two fixtures
     * invert, and `MOCK_IDENTITY=no_content` is the credential that reaches this
     * arm — without it the refusal would be a path nothing could take.
     *
     * The depth guard above is lifted for this collection alone, because
     * `/cms/pages/{path}` takes a **full path**: `legal/conditions-generales` is
     * four segments and one page. Every other route here states its own length,
     * so nothing else under `/cms/` gains a segment from that.
     *
     * **`PUT` lives here and nowhere else in the file.** The homepage and a menu
     * are documents replaced whole rather than collections of addressable rows —
     * §89 argues it for the homepage (sections are ordered, and an API letting
     * two clients insert at index 2 concurrently has invented a merge problem the
     * shop does not have) and the menus route inherits the same shape.
     */
    case "cms": {
      const refused = gatedOn("ac_manage_content");
      if (refused !== null) return refused;
      if (second === undefined) return notFound();

      if (second === "pages") {
        if (segments.length === 2) {
          if (method === "POST") return createPage(body);
          return method === "GET" ? pagesListing(searchParams) : notFound();
        }

        /*
         * The path is every segment after `/cms/pages`, rejoined. The catch-all
         * in the panel does the same thing on its own side — `path.join("/")` in
         * `content/pages/[...path]/page.tsx` — so what arrives here is exactly
         * what the screen asked for.
         */
        const path = segments.slice(2).join("/");
        const filter = readContentStatus(searchParams);
        if (filter.error) return filter.error;

        const page = resolvePage(path, filter.value);
        // **The 404 a draft gets and the 404 a missing path gets are the same
        // 404 with the same sentence**, which is the measurement the whole index
        // exists for: on a single-resource route the two facts are
        // indistinguishable, and only a listing separates them.
        if (page === undefined) return pageNotFound();

        switch (method) {
          case "GET":
            return ok(pageDocumentOf(page));
          case "PATCH":
            return patchPage(page, body);
          case "DELETE":
            return deletePage(page, searchParams);
          default:
            return notFound();
        }
      }

      if (second === "homepage") {
        if (segments.length !== 2) return notFound();
        if (method === "PUT") return putHomepage(body);
        return method === "GET" ? readHomepage() : notFound();
      }

      if (second === "banners") {
        if (segments.length === 2) {
          if (method === "POST") return createBanner(body);
          return method === "GET" ? bannersListing(searchParams) : notFound();
        }
        if (segments.length !== 3) return notFound();
        // The allowlist's pattern is `\d+`, so a non-numeric segment is a path
        // nobody wrote — `rest_no_route`, not this collection's own 404.
        const id = numericId(segments[2]);
        const banner = id === null ? undefined : bannerRows().find((row) => row.id === id);
        if (banner === undefined) return notFound();
        if (method === "PATCH") return patchBanner(banner, body);
        // **`GET /cms/banners/{id}` is a 404 on purpose.**
        // lib/api/allowlist.ts:247 is `rule("/cms/banners/\\d+", "PATCH",
        // "DELETE")` and carries no `GET`, so the panel's own proxy refuses a
        // single banner — the position `POST /products` and `/product-categories/
        // {id}` are in, and held to the same rule: a fixture that answered would
        // let a screen render green here and 404 at the proxy in production.
        return method === "DELETE" ? deleteBanner(banner) : notFound();
      }

      if (second === "faqs") {
        if (segments.length === 2) {
          if (method === "POST") return createFaq(body);
          return method === "GET" ? faqsListing(searchParams) : notFound();
        }
        if (segments.length !== 3) return notFound();
        const id = numericId(segments[2]);
        const faq = id === null ? undefined : faqRows().find((row) => row.id === id);
        if (faq === undefined) return notFound();
        if (method === "PATCH") return patchFaq(faq, body);
        // No `GET` here either, for the reason the banners branch gives.
        return method === "DELETE" ? deleteFaq(faq) : notFound();
      }

      if (second === "faq-categories") {
        if (segments.length === 2) {
          if (method === "POST") return createFaqCategory(body);
          // `list()`, not `paginate()`: no screen sends this route a parameter
          // and nothing reads its `meta`, so its envelope is unverified and this
          // is the file's one place for that.
          return method === "GET" ? list(faqCategoryRows().map(faqCategoryRow)) : notFound();
        }
        if (segments.length !== 3) return notFound();
        const id = numericId(segments[2]);
        const category = id === null ? undefined : faqCategoryRows().find((row) => row.id === id);
        if (category === undefined) return notFound();
        if (method === "PATCH") return patchFaqCategory(category, body);
        return method === "DELETE" ? deleteFaqCategory(category, searchParams) : notFound();
      }

      if (second === "menus") {
        /*
         * **`{location}` is `primary` or `footer` and nothing else.** Pinned to
         * the two rather than left permissive, because `PUT` to an unregistered
         * location *creates and assigns a menu there* — so a guessed URL would
         * invent navigation the theme has no slot for. lib/api/allowlist.ts:260
         * pins the same pair for the same reason.
         */
        if (segments.length !== 3) return notFound();
        const location = segments[2];
        if (location !== "primary" && location !== "footer") return notFound();

        if (method === "PUT") return putMenu(location, body);
        if (method !== "GET") return notFound();
        const menu = state.menus.get(location);
        // Its **own** 404 with its own sentence, which is a different fact from
        // a location that was never registered — and the screen says which,
        // because a `PUT` on this one will create the menu.
        return menu === undefined ? menuNotFound() : ok(menu);
      }

      return notFound();
    }

    /*
     * The media library. `ac_manage_content` guards the **reads** as well as the
     * writes — measured, a Manager is 403 on `GET /media` — which is the gap
     * ADMIN_PANEL.md's Media section documents rather than a bug: the "select an
     * image that already exists" path it describes as a Product Manager's is not
     * reachable either.
     *
     * **This screen is checklist item 13 and is served rather than redesigned.**
     * The Content hub renders a media count and `MediaPicker` reads the
     * collection from inside the banner form, so a 404 here would photograph two
     * Content screens in their error state. `mediaRows()`' own docblock draws the
     * line between what was measured and what this file assumed, so item 13 does
     * not inherit a guess as a measurement.
     *
     * **`POST /media` is served on the media branch**, and it is the only
     * `multipart/form-data` request the panel makes — the shell parses one now,
     * so all five measured refusals are reachable instead of arriving
     * indistinguishable from an empty upload.
     *
     * **`DELETE /media/{id}` and `GET /media/{id}/usage` joined on 2026-08-28.**
     * The entry this replaces said the delete stayed unserved because "nothing
     * here tells a client what an attachment is *used by*", which was true of the
     * API and not only of this file. The API grew the answer; both routes are
     * served, and the delete is deliberately **not** refused for an image in use
     * — see `deleteMedia`.
     */
    case "media": {
      const denied = gatedOn("ac_manage_content");
      if (denied !== null) return denied;

      if (second === undefined) {
        if (method === "GET") return mediaListing(searchParams);
        return method === "POST" ? uploadMedia(body) : notFound();
      }
      /*
       * Two depths now: the attachment, and the one sub-resource it has.
       * `/media/{id}/anything-else` is a route nobody registered, so it is a
       * `rest_no_route` rather than this collection's own `not_found` — the same
       * distinction the id below draws, one segment further in.
       */
      if (segments.length > 3) return notFound();
      if (segments.length === 3 && segments[2] !== "usage") return notFound();
      const id = numericId(second);
      /*
       * `/media/abc` is a `rest_no_route` — the route pattern is `(?P<id>\d+)`
       * and nothing matches — while `/media/99999999` reaches the controller and
       * answers `not_found` with its own sentence. Two different 404s, and this
       * file answered `rest_no_route` to both until this branch.
       */
      if (id === null) return notFound();
      /*
       * **`/media/0` is a 400, not a 404**, and this file answered `not_found`
       * to it until the delete branch. `\d+` matches `0`, so the request reaches
       * the controller's `idArg()` — `'minimum' => 1` — and is refused as a
       * parameter before any row is looked for. Measured on `/media/0/usage`;
       * the same `idArg()` guards GET, PATCH and DELETE, so the guard sits above
       * all four rather than on the one that was measured.
       */
      if (id === 0) return invalidParam("id", "id must be greater than or equal to 1");
      const item = mediaRows().find((row) => row.id === id);
      if (item === undefined) return mediaNotFound();

      /*
       * `GET /media/{id}/usage` — and the 404 above is the whole of its
       * refusal contract. `MediaService::usage()` calls the same `require()`
       * `show()` does, so an unknown id **and a post id that is not an
       * attachment** answer the same `not_found` with the same sentence: the
       * media library is not a way to read the posts table. This file has no
       * posts table to read, so the second case is the first case here — a
       * page id is simply not in `mediaRows()`.
       */
      if (segments.length === 3) {
        return method === "GET" ? ok(mediaUsageOf(id)) : notFound();
      }

      if (method === "GET") return ok(item);
      if (method === "PATCH") return patchMedia(item, body);
      return method === "DELETE" ? deleteMedia(item) : notFound();
    }

    /*
     * ── Marketing: four collections, one capability, a second on three routes ─
     *
     * `ac_manage_marketing` gates every route in the block — the fifth gated
     * collection in this file — and `MOCK_IDENTITY=no_marketing` is the
     * credential that reaches the refusal. It is the section's forbidden state,
     * which nothing could photograph before.
     *
     * **And this is the only place in the panel where a second capability
     * gates individual routes.** `canSendCampaigns()` is marketing **and**
     * customers, and it is enforced on exactly the three routes measured to need
     * it with an `ac_marketing_manager` credential on 2026-08-28: the recipient
     * list, a segment's count, and `send` — the last of those recorded rather
     * than fired, for the reason `sendCampaign` gives. `MOCK_IDENTITY=no_customers`
     * reaches all three, and the campaign preview beside them, which answers 200
     * with `audience_count: null` rather than refusing.
     *
     * `/campaigns/0`, `/segments/0` and `/email-templates/0` are **400s, not
     * 404s** — measured on all three. `\d+` matches `0`, so the request reaches
     * the controller's `idArg()` with its `minimum: 1` and is refused as a
     * parameter before any row is looked for. The same shape `/media/0` has.
     */
    case "campaigns": {
      const refused = gatedOn("ac_manage_marketing");
      if (refused !== null) return refused;
      if (segments.length > 3) return notFound();

      if (second === undefined) {
        if (method === "POST") return createCampaign(body);
        return method === "GET" ? campaignsListing(searchParams) : notFound();
      }

      const id = numericId(second);
      // `/campaigns/abc` matches no route pattern; `/campaigns/99999` reaches
      // the controller and answers this collection's own sentence. Two 404s.
      if (id === null) return notFound();
      if (id === 0) return invalidParam("id", "id must be greater than or equal to 1");
      const row = campaignById(id);
      if (row === undefined) return campaignNotFound();

      if (segments.length === 3) {
        switch (`${method} ${segments[2]}`) {
          case "GET preview":
            return campaignPreview(row);
          case "GET recipients": {
            const denied = gatedOn("ac_manage_customers");
            return denied ?? recipientsListing(row, searchParams);
          }
          case "POST send": {
            const denied = gatedOn("ac_manage_customers");
            return denied ?? sendCampaign(row);
          }
          case "POST test":
            return testCampaign(row, body);
          case "POST cancel":
            return cancelCampaign(row);
          default:
            return notFound();
        }
      }

      switch (method) {
        // **Value-identical to the list row**, measured on all four seeded
        // campaigns: 16 keys, zero diff. It is the same object rather than a
        // copy, so the two cannot drift — which is what makes a peek drawer on
        // this list free, in the sense DECISIONS.md's standing rule means.
        //
        // `MOCK_SEND_PROGRESS=tick` advances a draining campaign by one recipient
        // here, on the read a polling panel makes — off by default, and the block
        // beside `RECIPIENT_SEED` has the whole argument. The 16 keys are the same
        // 16 either way; only two counts and a status move.
        //
        // **The advance lands before the answer is built, and it has to.** The
        // obvious alternative — answer with the resting row, then move the drain
        // on for the next read — was written first and is wrong: the recipient
        // list is served from the state this writes, so a panel reading the
        // campaign and then its recipients would be handed `sent: 2` over three
        // `sent` rows, one step apart, on every single poll. Consistency between
        // the two endpoints is the constraint; "the first read is the resting
        // fixture" was only a preference, and it is the one that gives way. So
        // under `tick` the first read already shows one step done, which is also
        // what a drain that is genuinely running looks like.
        case "GET":
          return ok(SEND_PROGRESS_TICKING && row.status === "sending" ? advanceSend(row) : row);
        case "PATCH":
          return patchCampaign(row, body);
        case "DELETE":
          return deleteCampaign(row);
        default:
          return notFound();
      }
    }

    case "segments": {
      const refused = gatedOn("ac_manage_marketing");
      if (refused !== null) return refused;
      if (segments.length > 3) return notFound();

      if (second === undefined) {
        if (method === "POST") return createSegment(body);
        return method === "GET" ? segmentsListing(searchParams) : notFound();
      }

      const id = numericId(second);
      if (id === null) return notFound();
      if (id === 0) return invalidParam("id", "id must be greater than or equal to 1");
      const row = segmentById(id);
      // Measured: `/segments/99999/preview` answers this and not a route 404, so
      // the row is resolved before the sub-resource is matched.
      if (row === undefined) return segmentNotFound();

      if (segments.length === 3) {
        if (method !== "GET" || segments[2] !== "preview") return notFound();
        const denied = gatedOn("ac_manage_customers");
        return denied ?? segmentPreview(row);
      }

      switch (method) {
        case "GET":
          return ok(row);
        case "PATCH":
          return patchSegment(row, body);
        case "DELETE":
          return deleteSegment(row);
        default:
          return notFound();
      }
    }

    /*
     * Read-only, and **paging is the whole of its query contract**: `?orderby=`,
     * `?status=` and `?search=` are all accepted and all ignored, measured one
     * at a time — none of them changes the three rows or their order. So a
     * template screen ships no controls, and this file must not grow any.
     */
    case "email-templates": {
      const refused = gatedOn("ac_manage_marketing");
      if (refused !== null) return refused;
      if (method !== "GET" || segments.length > 2) return notFound();

      if (second === undefined) {
        const page = paginate(EMAIL_TEMPLATE_SEED, searchParams);
        return page.error ?? ok(page.rows, page.meta);
      }

      const id = numericId(second);
      if (id === null) return notFound();
      if (id === 0) return invalidParam("id", "id must be greater than or equal to 1");
      const template = EMAIL_TEMPLATE_SEED.find((row) => row.id === id);
      return template === undefined
        ? fail(404, "not_found", "No email template with that id.")
        : ok(template);
    }

    /*
     * `/marketing/config` and nothing else. **`/marketing` is not a route** —
     * measured, `rest_no_route` — so the shape is checked before the capability
     * gate here, unlike the three collections above whose root really is a
     * route. It takes **no arguments at all**: `?per_page=1` and `?zzz=1` are
     * both 200 with the identical object, so there is nothing to validate.
     */
    case "marketing": {
      if (method !== "GET" || segments.length !== 2 || second !== "config") return notFound();
      const refused = gatedOn("ac_manage_marketing");
      return refused ?? ok(MARKETING_CONFIG);
    }

    /*
     * ── The fourth capability gate, and the strictest one in the panel ────────
     *
     * `ac_manage_settings` is **Super Admin alone** — measured, and recorded at
     * lib/api/allowlist.ts:366-376: an Admin holding the other ten management
     * capabilities is 403 on *both* verbs. That is the boundary that stops an
     * Admin escalating, so it is the one gate here whose absence would be a
     * claim about the shop's security model rather than about a screen.
     *
     * **Both verbs, and the gate is not optional tidiness.** DECISIONS.md §16.1
     * is what happens without it: the missing `/customers` gate was found to have
     * been *manufacturing a passing screenshot* of a broken state for two
     * branches — a mock more permissive than the wire does not merely fail to
     * catch a defect, it photographs the defect as if it were correct.
     *
     * The shape is checked before the capability, the way `/marketing/config`
     * does it and unlike `/orders`: this is **one route with two methods**, so
     * `POST /settings` and `/settings/anything` never reach a
     * `permission_callback` on the wire either — WordPress answers
     * `rest_no_route` for a path/verb pair it has no handler for, before
     * permissions run at all. A 403 there would be the harness claiming a route
     * exists that does not.
     */
    case "settings": {
      if (segments.length !== 1) return notFound();
      if (method !== "GET" && method !== "PATCH") return notFound();

      const refused = gatedOn("ac_manage_settings");
      if (refused !== null) return refused;

      // No parameters at all on the read: `/settings` takes none, the way
      // `/marketing/config` takes none, so there is nothing to validate.
      return method === "GET" ? ok(state.settings) : patchSettings(body);
    }

    /*
     * ── The two routes whose answers are not envelopes ────────────────────────
     *
     * **`/export/{subject}` answers a file** — the only response in this mock
     * that is bytes and headers rather than JSON — and `/import/{subject}` takes
     * one. Both are gated **per subject**, which is the whole shape of this
     * screen: `SUBJECT_CAPABILITY` maps each to its own capability, so one
     * credential can be 200 on `/export/customers` and 403 on the other three
     * and the refusal is about the resource rather than the page.
     *
     * The shape is checked before the capability, the way `/settings` and
     * `/marketing/config` do it: `/export/zzz` and `POST /export/products` are
     * path/verb pairs WordPress has no handler for, so they answer
     * `rest_no_route` before any `permission_callback` runs. A 403 there would
     * be the harness claiming a route exists that does not — and the panel's own
     * `app/api/export/[subject]/route.ts` refuses an unknown subject before it
     * ever reaches here, with `lib/api/allowlist.ts:426` pinning the import
     * pattern to the same two words.
     *
     * **An export error stays inside the envelope with its 4xx**, which is what
     * stops a client saving an error message as `products.csv`. So the 403 and
     * the `limit` 400 below are ordinary JSON and only the 200 is a download.
     */
    case "export": {
      if (method !== "GET" || segments.length !== 2 || !EXPORT_SUBJECTS.includes(second)) {
        return notFound();
      }
      const refused = gatedOn(SUBJECT_CAPABILITY[second]);
      return refused ?? exportCsv(second, searchParams);
    }

    case "import": {
      if (method !== "POST" || segments.length !== 2 || !IMPORT_SUBJECTS.includes(second)) {
        return notFound();
      }
      const refused = gatedOn(SUBJECT_CAPABILITY[second]);
      return refused ?? postImport(second, searchParams, body);
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

/**
 * `multipart/form-data`, parsed the way **PHP's** parser does — which is not the
 * way the backend's own unit fixtures do, and the difference is two refusals.
 *
 * Measured against the live router 2026-08-27, after a request-for-request diff
 * of twelve uploads answered `DIFF` on exactly these two:
 *
 *   `filename="../../evil.jpg"`   live **201**, stored `evil.jpg`
 *   `filename="C:\dir\b.jpg"`     live **201**, stored `b.jpg`
 *   two parts both named `file`   live **201**, the **second** one stored
 *   two parts named `file[]`      live 400 "Upload one file per request."
 *   `filename="a..b.jpg"`         live 400 "The filename must not contain a path."
 *
 * So `php_rfc1867_basename()` strips everything through the last `/` or `\`
 * before `$_FILES['file']['name']` exists, and a repeated scalar field
 * **overwrites** rather than accumulating — only a `name[]` suffix makes an
 * array. `UploadPolicy::assertFilename()` therefore never sees a leading path,
 * and `UploadedFile::fromParams()` never sees two files unless the client asked
 * for an array field.
 *
 * `tests/Api/media.php:243-253,287-297` assert 400 for both, and they are right
 * about the code they call: they build `$_FILES` **in-process**, where no PHP
 * multipart parser has run. This file used to reproduce those tests instead of
 * the shop, and answered 400 to two uploads the shop takes — the *stricter*
 * direction, which DECISIONS.md §0 says is not the safe one and which would have
 * grown two error paths an upload dialog can never reach.
 *
 * Exported because `tests/mock-api.test.ts` calls `respond()` directly and the
 * alternative — hand-building the object this returns — would test the upload
 * against a shape nothing produces, and would have hidden exactly this.
 *
 * Returns `null` for a body that is not multipart at all, which `uploadMedia()`
 * answers exactly as the shop answers a request with no file entry.
 */
export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (match === null) return null;

  const delimiter = Buffer.from(`\r\n--${(match[1] ?? match[2]).trim()}`);
  // The first boundary has no leading CRLF of its own; prepending one lets the
  // opening and every later delimiter be found by the same search.
  const body = Buffer.concat([Buffer.from("\r\n"), buffer]);

  const fields = {};
  const files = {};

  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString("latin1") === "--") break;

    const next = body.indexOf(delimiter, start);
    if (next === -1) break;

    const part = body.subarray(start, next);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      at = next;
      continue;
    }

    // Headers are read as latin1 so a NUL or a control character in a filename
    // survives to `assertMediaFilename()` rather than being replaced.
    const headers = part.subarray(2, headerEnd).toString("latin1");
    const content = part.subarray(headerEnd + 4);

    const rawName = /name="([^"]*)"/.exec(headers)?.[1];
    if (rawName !== undefined) {
      // `file[]` is the array field; `file` twice is one field written twice.
      const isArray = rawName.endsWith("[]");
      const name = isArray ? rawName.slice(0, -2) : rawName;
      const filename = /filename="([^"]*)"/.exec(headers)?.[1];

      if (filename === undefined) {
        fields[name] = content.toString("utf8");
      } else {
        const entry = {
          // The path is stripped here rather than in `assertMediaFilename()`,
          // because PHP strips it here — before the application sees a name.
          // A browser sends the name as UTF-8 bytes inside the header.
          name: Buffer.from(filename, "latin1").toString("utf8").split(/[/\\]/).pop(),
          type: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "",
          bytes: content,
        };
        if (isArray) (files[name] ??= []).push(entry);
        else files[name] = [entry];
      }
    }

    at = next;
  }

  return { multipart: { fields, files } };
}

/**
 * `text/csv` → the `body` argument `respond()` takes for an import.
 *
 * The two imports are the only requests in this panel whose body is not JSON,
 * and the wrapper is what lets the handler tell *"they sent us JSON"* from
 * *"they sent us an empty file"* — two different measured 400s that would be
 * indistinguishable if a CSV arrived as a bare string. Same shape
 * `parseMultipart()` returns one upload over.
 *
 * Exported for the same reason that one is: `tests/mock-api.test.ts` calls
 * `respond()` directly, and hand-writing `{csv}` there would test the import
 * against a shape nothing produces and leave this mapping — the half that
 * decides which 400 a client gets — untested.
 *
 * Returns `null` for a body that is not `text/csv` at all.
 */
export function parseCsvBody(buffer, contentType) {
  if (!/^\s*text\/csv\b/i.test(contentType ?? "")) return null;
  return { csv: buffer.toString("utf8") };
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

    /*
     * The uploads directory, which is the other half of `url` being answerable
     * at all. Also outside `respond()` — it answers bytes rather than an
     * envelope — and deliberately **outside `requestLog`**: the log is what
     * `capture.mjs` reads to prove the panel talked to this API, and a browser
     * fetching 41 tiles would inflate that count with requests the panel's
     * server never made.
     */
    if (url.pathname.startsWith(`${MEDIA_UPLOAD_PATH}/`)) {
      const filename = url.pathname.slice(MEDIA_UPLOAD_PATH.length + 1);
      /* A deleted attachment took its file with it — `wp_delete_attachment($id,
         true)` unlinks it — so the bytes stop being served rather than outliving
         the row. A grid still showing the picture would be the harness telling a
         screen that a permanent delete was not one. */
      const file = state.deletedFiles.has(filename)
        ? undefined
        : (state.uploads.get(filename) ?? MEDIA_FIXTURE_BYTES.get(filename));
      if (file === undefined) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("No such file.\n");
        return;
      }
      response.writeHead(200, {
        "content-type": file.mime,
        "content-length": String(file.bytes.length),
        // A capture run rewrites nothing, but a tile that a browser served from
        // cache is a tile this process cannot prove it answered.
        "cache-control": "no-store",
      });
      response.end(file.bytes);
      return;
    }

    requestLog.push(`${request.method} ${url.pathname}`);

    /*
     * The body is collected before routing because `respond()` takes it as an
     * argument — the routing stays pure and synchronous, and this shell stays
     * the only asynchronous thing in the file.
     *
     * A body that is neither JSON nor multipart arrives at `respond()` as `null`
     * rather than as an error of its own. Every write here validates what it
     * needs and answers its own 400, and the panel sends JSON, multipart or
     * nothing at all: `POST /payments/{id}/verify` is called with no body
     * whatsoever and `POST /media` is the one multipart request it makes.
     */
    const contentType = request.headers["content-type"] ?? "";
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      let parsed = null;
      if (chunks.length > 0) {
        if (contentType.toLowerCase().startsWith("multipart/form-data")) {
          parsed = parseMultipart(Buffer.concat(chunks), contentType);
        } else if (contentType.toLowerCase().startsWith("text/csv")) {
          parsed = parseCsvBody(Buffer.concat(chunks), contentType);
        } else {
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            parsed = null;
          }
        }
      }

      /*
       * `request.headers` is node's own object and its keys are already
       * lower-cased, which is what `basicCredential()` reads. It is passed
       * whole rather than narrowed to `authorization`: narrowing here would put
       * the list of headers the mock may read in the shell instead of beside
       * the one handler that reads one, and the next header some route needs
       * would be added in two files.
       */
      const { status, body, headers } = respond(
        request.method ?? "GET",
        url.pathname,
        url.searchParams,
        parsed,
        request.headers,
      );

      /*
       * **A `Buffer` body is a file and is written out untouched.** The four
       * exports are the only responses in this API that are not envelopes, and
       * the BOM is exactly why this branch cannot be `JSON.stringify`: encoding
       * the string is the defect ADMIN_PANEL.md:2695-2706 records the backend
       * having — one quoted line, the mark as six characters — and a shell that
       * did it here would reproduce a fixed defect on every download.
       */
      if (Buffer.isBuffer(body)) {
        response.writeHead(status, { ...headers, "content-length": String(body.length) });
        response.end(body);
        return;
      }

      /*
       * **`headers` is spread here too, and it was not until 2026-08-29.** The
       * `Buffer` branch above has always carried them because an export needs
       * its `Content-Disposition`; this branch built its own object from
       * scratch, so a header on an *envelope* response was silently dropped by
       * the shell while `respond()` returned it and `tests/mock-api.test.ts`
       * read it off the return value and passed.
       *
       * Nothing had ever put one there — the four exports were the only
       * responses with headers and they are all Buffers — so this was latent
       * rather than broken, and it stopped being latent the moment `/auth/me`
       * grew a 429: `client.ts:69` reads `Retry-After` off the *response*, so
       * the panel would have seen a 429 with `retryAfter: null`, skipped the
       * countdown, and `LoginForm.tsx:65` would have rendered "réessayez dans 0
       * secondes" from a header the mock believed it had sent. A unit test
       * cannot catch that class at all: it asserts the object, and the object
       * was right.
       *
       * `content-type` is written last so it still wins. No response here sets
       * one, and one that did would be answering an envelope as something other
       * than JSON.
       */
      response.writeHead(status, {
        ...headers,
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(body));
    });
  });
}

export function startServer(port = MOCK_PORT) {
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
  await startServer();
  console.log(`mock-api listening on ${MOCK_ORIGIN}${BASE_PATH}`);
}
