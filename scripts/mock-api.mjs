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
 * **`orderby` and `order` are accepted and ignored, on purpose. Do not "fix"
 * this.**
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
 * ── The one exception, and it is exactly five combinations ────────────────────
 *
 * **`/products` sorts. `/orders` still does not. Do not simplify this into
 * either extreme.**
 *
 * The silent ignore was repaired in the backend — `ProductRepository::
 * orderingClause()`, which joins `wc_product_meta_lookup` through
 * `posts_clauses` — and exactly five combinations were re-measured as working:
 *
 *     date desc · date asc · title asc · price asc · price desc
 *
 * Those five sort here and nothing else does. Any other `orderby`, and any
 * other combination — **including `title desc`, which nobody measured** — is
 * accepted with a 200 and comes back in the default catalogue order, unsorted.
 * `SORTS` in lib/product-status.ts is that list and it is the same five.
 *
 * Both halves of this are load-bearing. Sorting everything would let an agent
 * build a `title desc` control, watch it work here and ship a control that does
 * nothing; sorting nothing would make the five controls the panel does offer
 * look broken against the harness and invite someone to delete them.
 *
 * What *is* genuinely implemented, because a screen that silently ignored these
 * would be a screen that lies about how many rows exist:
 *
 *   page, per_page   real, and >100 is a 400 rather than a clamp — measured
 *   status           real on /orders (single value, a comma list is a 400) and
 *                    real on /products, whose own set is publish/draft/pending/
 *                    private — `?status=trash` is a 400 there, and a trashed
 *                    product still reads back from `/products/{id}` with a 200
 *   search           real on /orders, /products, /customers — substring, folded
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
 * A list that is **not** paginated, with the `meta` every list endpoint carries.
 *
 * The panel fetches these with no params at all — the wilaya table, the provider
 * list, an order's notes and its timeline — and a default `per_page` of 10 would
 * silently drop the tail of one with nothing anywhere reporting an error.
 */
const list = (rows) =>
  ok(rows, {
    total: rows.length,
    page: 1,
    per_page: rows.length,
    total_pages: rows.length === 0 ? 0 : 1,
  });

const fail = (status, code, message, details = {}) => ({
  status,
  body: { success: false, error: { code, message, details } },
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
 */
const bareFail = (status, code, message) => ({
  status,
  body: { success: false, error: { code, message } },
});

const notFound = () =>
  fail(404, "rest_no_route", "No route was found matching the URL and request method.");

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
 * ── The second identity, and how to ask for it ───────────────────────────────
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
 *
 * `reduced` is the same person minus exactly those two, so the order detail still
 * renders — it keeps `ac_manage_orders` — with its two gated sections gone rather
 * than empty. It is not "a Manager": the two-tier collapse takes more than two
 * capabilities off a Manager, and naming it one here would be a claim about the
 * shop's roles that this file has not measured.
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

const CUSTOMERS = Array.from({ length: 16 }, (_, index) => {
  const id = 20 + index;
  const [first, last] = NAMED_CUSTOMERS[index] ?? ["", ""];
  const wilaya = WILAYAS[int(0, WILAYAS.length - 1)];
  const email = index === 5 ? LONG_EMAIL : `client${id}@example.test`;

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

  return {
    id,
    username: `client${id}`,
    email,
    first_name: first,
    last_name: last,
    role: "customer",
    // The five who have ordered are the five the statistics block reports on.
    is_paying_customer: index < 5,
    marketing_consent: index === 0,
    marketing_consent_at: index === 0 ? iso(9000) : null,
    marketing_consent_source: index === 0 ? "registration" : null,
    billing,
    // Shipping carries no email — WooCommerce stores none — so the key is
    // *absent* rather than present and empty. `email` is optional on the address
    // schema precisely because the two addresses differ by it.
    shipping: withoutEmail(billing),
    date_created: iso(40_000 + index * 700),
    date_modified: index % 3 === 0 ? null : iso(500 + index * 30),
  };
});

const ORDER_STATUSES = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
];

/**
 * The detail's `statistics`, and **the list must not carry it** — the two shapes
 * differ by exactly that key, which lib/api/schemas/customer.ts is explicit
 * about. Eleven of the sixteen have never ordered, so both `first_order` and
 * `last_order` are null on them.
 */
function statisticsFor(customer, index) {
  const ordered = index < 5;
  const total = ordered ? index + 2 : 0;
  const completed = ordered ? Math.max(1, Math.floor(total / 2)) : 0;
  const revenue = completed * 1050;

  const byStatus = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
  byStatus.completed = completed;
  byStatus.pending = total - completed;

  return {
    total_orders: total,
    completed_orders: completed,
    cancelled_orders: 0,
    returned_orders: 0,
    total_revenue: `${revenue}.00`,
    // Revenue is the sum of the *completed* orders and the average is over the
    // same ones, so this does not divide into `total_orders`. That is the API's
    // arithmetic, and reproducing it is the point.
    average_order_value: completed > 0 ? `${revenue / completed}.00` : "0.00",
    first_order: ordered
      ? { id: 1000 + index, date: iso(30_000), status: "completed", total: "1050.00" }
      : null,
    last_order: ordered
      ? { id: 1200 + index, date: iso(400), status: "completed", total: "1050.00" }
      : null,
    by_status: byStatus,
  };
}

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
  const guest = guestColumn[index];
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
    customer_id: guest ? 0 : CUSTOMERS[index % CUSTOMERS.length].id,
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
 * and that is load-bearing.** They are the last five calls into the one shared
 * mulberry32; drawing them in this order at this point keeps every collection
 * above byte-identical to what the earlier branches were verified against.
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

const variationsOf = (product) =>
  VARIATIONS.filter((variation) => variation.parent_id === product.id);

/* -------------------------------------------------------------- inventory --- */

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
    ...VARIATIONS.map((variation) => {
      const parent = productById(variation.parent_id);
      const slot = parent.variations.indexOf(variation.id);
      // A variation that manages no stock of its own is stocked *by its parent*,
      // and both fields say so — which is the whole reason a row carries
      // `managing_stock` beside `manage_stock` and an id beside both.
      const quantity = variation.manage_stock
        ? variation.stock_quantity
        : parent.stock_quantity;
      return {
        id: variation.id,
        parent_id: parent.id,
        type: "variation",
        name: `${parent.name} — ${parent.attributes[0].options[slot]}`,
        // `""` is possible: a variation need carry no SKU of its own, and the
        // row must render without inventing the parent's.
        sku: variation.sku,
        manage_stock: variation.manage_stock,
        managing_stock: variation.manage_stock,
        stock_managed_by_id: variation.manage_stock ? variation.id : parent.id,
        stock_quantity: quantity,
        stock_status: variation.stock_status,
        backorders: slot === 0 ? "notify" : "no",
        low_stock_amount: 2,
        low_stock: quantity !== null && quantity <= 2,
      };
    }),
  ];
}

/* ---------------------------------------------------------------- coupons --- */

/**
 * Four, and the two null-versus-zero directions run on the same object:
 * `amount: "0.00"` is a real coupon — a zero discount with free shipping — while
 * a threshold of zero is stored as null and can never read back as `"0.00"`.
 */
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
];

/**
 * `restrictions` is emitted by the single-coupon routes and **not by the list**,
 * the way a customer's `statistics` is. `missing` is on every row rather than
 * only the broken ones: an id that resolves to nothing keeps its place, because
 * a client that dropped it would delete the restriction on the next save.
 */
function restrictionsFor(coupon) {
  const productRef = (id) => {
    const product = PRODUCTS.find((candidate) => candidate.id === id);
    return {
      id,
      name: product?.name ?? null,
      missing: product === undefined,
      sku: product?.sku ?? null,
      status: product?.status ?? "trash",
    };
  };
  const categoryRef = (id) => ({
    id,
    name: `Catégorie ${id}`,
    missing: false,
    slug: `categorie-${id}`,
  });

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
 */
const stamp = (minutesAgo) =>
  new Date(EPOCH - minutesAgo * 60_000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");

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

/** Measured 2026-08-20: exactly one provider, and it is the default. */
const SHIPPING_PROVIDERS = [
  { name: "manual", label: "In-house delivery", is_default: true },
];

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
function seedShipments() {
  // Off the order, not written out: a courier collecting a figure the order does
  // not show is a bug report about arithmetic waiting to be filed.
  const codAmount = ORDERS.find((row) => row.id === LIVE_PARCEL_ORDER).total;
  return new Map([
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

/** Measured 2026-08-20: `chargily` is the default, and `cod` is the other one. */
const PAYMENT_METHODS = [
  { name: "chargily", label: "Chargily", is_default: true },
  { name: "cod", label: "Paiement à la livraison", is_default: false },
];

/**
 * Two transactions on the rich order, and one story: the customer's card attempt
 * failed at the gateway and the order fell back to cash on delivery.
 *
 * 5231 is the `cod` one and is the fixture `POST /payments/{id}/verify` was
 * measured on: a pending cash transaction whose provider has nothing to report
 * yet, so `report.amount` and `report.currency` come back as **empty strings**.
 * The report is therefore not safe to format as money and `transaction` is the
 * authority for every figure on screen — which is invisible on a fixture whose
 * report carries a number.
 *
 * Neither is `paid`, and that is deliberate rather than an oversight: measured
 * 2026-08-20, all 37 payments in this shop are `pending` and nothing has ever
 * settled. `failed` gives the badge a second state to render without inventing a
 * settlement the shop has never had.
 *
 * The amount is read off the order rather than written out, because two figures
 * that drift apart on one screen is a bug report about arithmetic.
 */
function seedPayments() {
  const order = ORDERS.find((row) => row.id === RICH_ORDER);
  const common = { order_id: RICH_ORDER, amount: order.total, currency: "DZD" };
  return new Map([
    [
      RICH_ORDER,
      [
        {
          ...common,
          id: 5230,
          provider: "chargily",
          provider_transaction_id: "ch_test_1023",
          reference: "AC-PAY-5230",
          status: "failed",
          metadata: { provider_status: "canceled" },
          created_at: zulu(2600),
          updated_at: zulu(2400),
        },
        {
          ...common,
          id: 5231,
          provider: "cod",
          // Empty until a courier collects — a real value, not a placeholder.
          provider_transaction_id: "",
          reference: "AC-PAY-5231",
          status: "pending",
          metadata: { provider_status: "awaiting_delivery" },
          created_at: zulu(2380),
          updated_at: zulu(2380),
        },
      ],
    ],
  ]);
}

/* --------------------------------------------------------------- communes --- */

/**
 * A commune list per wilaya, which `/locations/wilayas` alone cannot fill: the
 * create-parcel form asks for both halves of a destination and the API validates
 * them before anything else on the body.
 *
 * **There is no Zod schema for this route in the panel** — `CreateParcelSheet`
 * and `RulesView` both read it with an untyped `acRead<Commune[]>` and a local
 * `{id, name, name_ar}` — so the shape here is those three keys plus the two a
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
  /** Product id → the whole row as it reads now. Empty until something PATCHes. */
  products: new Map(),
  /** Force-deleted product ids. A permanent delete is the one thing that 404s. */
  gone: new Set(),
};

export function resetState() {
  state.statuses = new Map();
  state.cod = new Map(ORDERS.map((order) => [order.id, seedCod(order)]));
  state.shipments = seedShipments();
  state.payments = seedPayments();
  // Above the two seeded ids and far enough from them to read as new.
  state.nextShipmentId = 7100;
  state.products = new Map();
  state.gone = new Set();
}

resetState();

const statusOf = (order) => state.statuses.get(order.id) ?? order.status;
const shipmentsOf = (orderId) => state.shipments.get(orderId) ?? [];
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
  fail(400, "rest_invalid_param", message, { fields });

const conflict = (message, details) => fail(409, "conflict", message, details);

/** `PATCH /orders/{id}` — one field, and the transition is the whole story. */
function patchOrder(order, body) {
  const to = body?.status;
  if (typeof to !== "string" || !ORDER_STATUSES.includes(to)) {
    return invalidBody("Invalid parameter(s): status", {
      status: `Must be one of: ${ORDER_STATUSES.join(", ")}.`,
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
    // A *missing* outcome gets a different sentence from an invalid one —
    // measured, and the difference is the word "Required".
    return fail(400, "rest_missing_callback_param", "Missing parameter(s): outcome", {
      fields: { outcome: `Required. One of: ${COD_ATTEMPT_OUTCOMES.join(", ")}.` },
    });
  }
  if (!COD_ATTEMPT_OUTCOMES.includes(outcome)) {
    return invalidBody("Invalid parameter(s): outcome", {
      outcome: `Must be one of: ${COD_ATTEMPT_OUTCOMES.join(", ")}.`,
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
  if (!Number.isInteger(wilayaId) || wilayaId <= 0) {
    fields.wilaya_id = "Required. The destination wilaya.";
  }
  if (!Number.isInteger(communeId) || communeId <= 0) {
    fields.commune_id = "Required. The destination commune.";
  }
  if (Object.keys(fields).length > 0) {
    return invalidBody(`Invalid parameter(s): ${Object.keys(fields).join(", ")}`, fields);
  }

  const live = shipmentsOf(order.id).find((shipment) => shipment.is_live);
  if (live !== undefined) {
    return conflict("This order already has a shipment in flight.", {
      shipment_id: live.id,
      provider: live.provider,
      status: live.status,
    });
  }

  const id = state.nextShipmentId++;
  const created = {
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
  state.shipments.set(order.id, [...shipmentsOf(order.id), created]);
  return ok(created);
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
 * rule. `{from, to, is_live}` is what there is.
 */
function cancelShipment(id) {
  const shipment = findById(state.shipments, id);
  if (shipment === undefined) return notFound();
  if (!shipment.is_live) {
    return conflict(`A ${shipment.status} shipment cannot be cancelled.`, {
      from: shipment.status,
      to: "cancelled",
      is_live: false,
    });
  }

  const cancelled = { ...shipment, status: "cancelled", is_live: false, updated_at: iso(0) };
  state.shipments.set(
    shipment.order_id,
    shipmentsOf(shipment.order_id).map((row) => (row.id === id ? cancelled : row)),
  );
  return ok(cancelled);
}

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
 * Nothing is written. The provider's answer is unchanged, so a second verify is
 * the same 200 — which is also what keeps a capture byte-stable.
 */
function verifyPayment(id) {
  const payment = findById(state.payments, id);
  if (payment === undefined) return notFound();

  const cash = payment.provider === "cod";
  return ok({
    report: {
      status: payment.status,
      provider_status: String(payment.metadata.provider_status ?? payment.status),
      amount: cash ? "" : payment.amount,
      currency: cash ? "" : payment.currency,
      metadata: payment.metadata,
    },
    transaction: payment,
  });
}

/* ------------------------------------------------------------ query rules --- */

/**
 * `page` and `per_page`, genuinely. Over 100 is a **400 rather than a clamp** —
 * measured, `?per_page=500` answers `per_page must be between 1 and 100` — so a
 * footer that offered 500 would break against the real shop and must break here.
 */
function paginate(rows, params) {
  const page = Number.parseInt(params.get("page") ?? "1", 10) || 1;
  const perPage = Number.parseInt(params.get("per_page") ?? "10", 10) || 10;

  if (perPage < 1 || perPage > 100) {
    return {
      error: fail(400, "rest_invalid_param", "Invalid parameter(s): per_page", {
        params: { per_page: "per_page must be between 1 (inclusive) and 100 (inclusive)" },
      }),
    };
  }

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

/** Substring, case-insensitive, over the fields a person would type into. */
function searchRows(rows, params, fields) {
  const term = (params.get("search") ?? "").trim().toLowerCase();
  if (term === "") return rows;
  return rows.filter((row) =>
    fields(row).some((value) => String(value ?? "").toLowerCase().includes(term)),
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
        "rest_invalid_param",
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

/** WordPress lists a refused enum in its own words: "a, b, c, and d". */
const oxford = (values) =>
  values.length < 2
    ? values.join("")
    : `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;

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
  fail(400, "rest_invalid_param", `Invalid parameter(s): ${name}`, {
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
    search: (params.get("search") ?? "").trim().toLowerCase(),
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

  const status = params.get("status");
  if (status !== null && status !== "") {
    // A comma list is a 400 by falling straight through this — the measured
    // behaviour every single-select control in the panel is built on — and so
    // is `trash`, which is readable and unlistable.
    if (!PRODUCT_STATUSES.includes(status)) {
      const message = `status is not one of ${oxford([...PRODUCT_STATUSES].sort())}`;
      return {
        error: fail(400, "rest_invalid_param", message, { params: { status: message } }),
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
          `stock_status is not one of ${oxford([...STOCK_STATUSES].sort())}`,
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
        error: fail(400, "rest_invalid_param", "Invalid parameter(s): attributes", {
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
    const haystack = `${product.name} ${product.sku}`.toLowerCase();
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

const fold = (value) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const compareBy = (key) => (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const descending = (compare) => (a, b) => -compare(a, b);

const byDate = compareBy((product) => product.date_created);
// Folded rather than `localeCompare`d: a collation that depends on the runtime's
// ICU build is a screenshot that differs between machines.
const byTitle = compareBy((product) => fold(product.name));
const byPrice = compareBy(priceOf);

/**
 * The five combinations that were re-measured as working, and only those. See
 * the header — `title desc` is deliberately absent and deliberately a 200.
 */
const PRODUCT_SORTS = new Map([
  ["date desc", descending(byDate)],
  ["date asc", byDate],
  ["title asc", byTitle],
  ["price asc", byPrice],
  ["price desc", descending(byPrice)],
]);

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
  typeof value === "string" && values.includes(value)
    ? null
    : `Must be one of: ${values.join(", ")}.`;

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
    return bareFail(400, "rest_invalid_param", "No supported fields were provided.");
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
    return bareFail(400, "rest_invalid_param", "No supported fields were provided.");
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
  const WRITES = ["orders", "shipments", "payments", "products"];
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

  switch (collection) {
    case "orders": {
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
     * `/shipments/{id}/cancel` and `/payments/{id}/verify`, and **nothing else
     * on either collection**. There is no `GET /shipments` and no `GET
     * /payments` here: a parcel and a transaction are reached through the order
     * they belong to, which is the only way the detail screen reaches them, and
     * an endpoint nobody calls must stay unreachable.
     *
     * `POST /payments` is absent for a stronger reason than that, and it is the
     * one write on this subject the API offers: it opens a checkout at the
     * provider and hands back a real payment link for a *shopper*.
     * lib/api/allowlist.ts:164-178 refuses it deliberately, so it must 404 here
     * too — a fixture that answered would be an invitation to build the screen.
     */
    case "shipments":
      return method === "POST" && segments.length === 3 && segments[2] === "cancel"
        ? cancelShipment(numericId(second))
        : notFound();

    case "payments":
      if (method === "GET" && segments.length === 2 && second === "methods") {
        return list(PAYMENT_METHODS);
      }
      return method === "POST" && segments.length === 3 && segments[2] === "verify"
        ? verifyPayment(numericId(second))
        : notFound();

    case "shipping":
      return segments.length === 2 && second === "providers"
        ? list(SHIPPING_PROVIDERS)
        : notFound();

    case "locations": {
      if (second !== "wilayas") return notFound();
      // Reference data, and the one list endpoint that is **not** paginated: the
      // panel fetches it with no params and needs all 58 to turn a `state` of
      // "16" into a name. A default `per_page` of 10 here would leave 48 orders
      // showing a bare code and nothing would report an error.
      if (segments.length === 2) return list(WILAYAS);

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
      // Paginated — the panel asks for `per_page=100` — and flat, with `parent`
      // carrying the tree and `count` the unfiltered usage the facet's own
      // counts are merged against.
      return collectionOf(CATEGORIES, {});

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

      if (second !== undefined) {
        const attribute = attributeOf();
        return attribute === undefined ? notFound() : ok(attribute);
      }

      // Unpaginated, like /locations/wilayas: the panel fetches this with no
      // params at all, and a default `per_page` of 10 would silently drop the
      // shop's later attributes — and every facet group keyed on them with
      // nothing reporting an error.
      return ok(ATTRIBUTES, {
        total: ATTRIBUTES.length,
        page: 1,
        per_page: ATTRIBUTES.length,
        total_pages: 1,
      });
    }

    case "customers":
      return collectionOf(CUSTOMERS, {
        search: (customer) => [
          customer.username,
          customer.email,
          customer.first_name,
          customer.last_name,
        ],
        // The detail is the row plus the report the list omits — and the list
        // must not carry it, which is the one place these two shapes differ.
        detail: (customer) => ({
          ...customer,
          statistics: statisticsFor(customer, CUSTOMERS.indexOf(customer)),
        }),
      });

    case "inventory":
      /*
       * `/inventory/low-stock` is **not** in the harness brief's endpoint list
       * and the inventory screen calls it anyway — twice per render, from the
       * client, for the count on the "low stock" view. Without it the screen
       * renders and logs a 404 in the console, which is exactly the quiet
       * half-failure this harness exists to catch, so it caught it.
       *
       * It returns the same item as `/inventory`, `/inventory/{id}` and
       * `/inventory/lookup` — lib/api/schemas/inventory.ts says so explicitly,
       * verified across every row — so one row shape serves it. `/lookup` is
       * still a 404 here: nothing calls it on load, and an endpoint nobody
       * reaches must stay unreachable.
       */
      if (segments.length === 2 && second === "low-stock") {
        const low = inventoryRows().filter((row) => row.low_stock);
        const page = paginate(low, searchParams);
        return page.error ?? ok(page.rows, page.meta);
      }
      return collectionOf(inventoryRows(), {});

    case "coupons":
      return collectionOf(COUPONS, {
        detail: (coupon) => ({ ...coupon, restrictions: restrictionsFor(coupon) }),
      });

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
