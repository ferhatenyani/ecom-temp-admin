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
 *
 * ── Determinism ──────────────────────────────────────────────────────────────
 *
 * A screenshot has to be byte-stable between runs or the harness reports a diff
 * every time it is run. So there is no `Math.random()` and no `Date.now()`
 * anywhere in the response path: one seeded mulberry32 runs at module load and
 * every timestamp is derived from a hard-coded epoch.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 *
 * `respond()` is pure — method, path and params in, `{status, body}` out — and
 * is what tests/mock-api.test.ts parses with the panel's own Zod schemas and its
 * own `unwrap()`. The server below is a thin shell over it, so anything the
 * browser can get is something the unit suite has already validated.
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

const fail = (status, code, message, details = {}) => ({
  status,
  body: { success: false, error: { code, message, details } },
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
const IDENTITY = {
  id: 514,
  username: "harness",
  display_name: "Harness Admin",
  email: "harness@example.test",
  roles: ["ac_super_admin"],
  capabilities: [
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
  ],
  auth_method: "application_password",
};

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
  };
}

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

/* -------------------------------------------------------------- inventory --- */

/**
 * Every listed product plus the 5 variations the two variable products carry.
 * A trashed product is not in stock anywhere and is not here either, which is
 * the same rule `/products` lists by. `low_stock_amount` is **per product** — 2
 * on all but one, 5 on "Miel de jujubier" — so there is no shop-wide threshold
 * to display anywhere; it is keyed on that product rather than on a row index
 * so it stays on it as the catalogue grows around it.
 */
const INVENTORY = [
  ...LISTED.map((product) => {
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
  ...[...VARIATION_COUNTS.keys()].flatMap((parentIndex) => {
    const parent = PRODUCTS[parentIndex];
    return parent.variations.map((variationId, slot) => {
      const quantity = int(0, 25);
      return {
        id: variationId,
        parent_id: parent.id,
        type: "variation",
        name: `${parent.name} — ${["S", "M", "L"][slot]}`,
        // `""` is possible: a variation need carry no SKU of its own, and the
        // row must render without inventing the parent's.
        sku: slot === 0 ? "" : `${parent.sku}-${slot + 1}`,
        manage_stock: true,
        managing_stock: true,
        stock_managed_by_id: variationId,
        stock_quantity: quantity,
        stock_status: quantity > 0 ? "instock" : "outofstock",
        backorders: slot === 0 ? "notify" : "no",
        low_stock_amount: 2,
        low_stock: quantity <= 2,
      };
    });
  }),
];

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
    LISTED.filter(
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

  const rows = LISTED.filter((product) => matchesProduct(product, parsed.filters));
  const page = paginate(sortProducts(rows, params), params);
  if (page.error) return page.error;

  const facets = facetsFor(params, parsed.filters);
  return ok(page.rows, facets === null ? page.meta : { ...page.meta, facets });
}

/* ------------------------------------------------------------------ route --- */

const numericId = (segment) => (/^\d+$/.test(segment) ? Number.parseInt(segment, 10) : null);

/**
 * The whole API surface, as a pure function. No clock, no randomness, no
 * mutation — hand it the same three arguments twice and it answers identically,
 * which is what makes both a byte-stable screenshot and a schema test possible.
 *
 * `pathname` is the full request path including the base, so this also proves
 * the base-path routing rather than assuming it.
 */
export function respond(method, pathname, searchParams = new URLSearchParams()) {
  // WordPress answers `rest_no_route` for a path/verb pair it has no handler
  // for, and the panel only ever reads through this mock.
  if (method !== "GET") return notFound();
  if (!pathname.startsWith(`${BASE_PATH}/`)) return notFound();

  const segments = pathname.slice(BASE_PATH.length + 1).split("/").filter(Boolean);
  const [collection, second] = segments;

  if (segments.length === 2 && collection === "auth" && second === "me") {
    return ok(IDENTITY);
  }

  if (segments.length === 2 && collection === "locations" && second === "wilayas") {
    // Reference data, and the one list endpoint that is **not** paginated: the
    // panel fetches it with no params and needs all 58 to turn a `state` of "16"
    // into a name. A default `per_page` of 10 here would leave 48 orders showing
    // a bare code and nothing would report an error.
    return ok(WILAYAS, {
      total: WILAYAS.length,
      page: 1,
      per_page: WILAYAS.length,
      total_pages: 1,
    });
  }

  /*
   * Depth is decided **per collection** below, not once here.
   *
   * This used to be a flat `if (segments.length > 2) return notFound()`, which
   * makes a three-segment route unreachable no matter how it is written further
   * down — `/attributes/{id}/terms` could never have answered. Moving the guard
   * to `> 3` and no further would be the opposite mistake: `/orders/1000/notes`
   * would then be served the order itself, which is a 200 for a route nobody
   * wrote and exactly the quiet wrong answer this file must not produce.
   *
   * So the ceiling here is the deepest route that exists, and every collection
   * that has no sub-resource says so — `collectionOf` refuses a third segment
   * for all of them at once.
   */
  if (segments.length === 0 || segments.length > 3) return notFound();

  /** The list/detail pair every collection below shares. */
  const collectionOf = (rows, { search, status, detail }) => {
    if (segments.length > 2) return notFound();
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
    case "orders":
      return collectionOf(ORDERS, {
        status: true,
        search: (order) => [
          order.number,
          order.billing.first_name,
          order.billing.last_name,
          order.billing.email,
          order.billing.phone,
        ],
      });

    case "products": {
      if (segments.length > 2) return notFound();
      if (second !== undefined) {
        const id = numericId(second);
        // The whole catalogue, not the listed part: a trashed product answers
        // 200 with `status: "trash"` here and appears in no listing at all.
        const row = id === null ? undefined : CATALOGUE.find((p) => p.id === id);
        return row === undefined ? notFound() : ok(row);
      }
      return productsListing(searchParams);
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
        const low = INVENTORY.filter((row) => row.low_stock);
        const page = paginate(low, searchParams);
        return page.error ?? ok(page.rows, page.meta);
      }
      return collectionOf(INVENTORY, {});

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
    const { status, body } = respond(request.method ?? "GET", url.pathname, url.searchParams);
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
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
