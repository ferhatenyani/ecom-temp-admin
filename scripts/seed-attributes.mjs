/**
 * Give the shop the global attributes §82's facets need.
 *
 * Measured 2026-08-18, before this existed: `GET /attributes` answered `[]`, so
 * `meta.facets.attributes` could only ever be `{facetable: [], groups: []}` and
 * `?attributes[pa_matiere]=laine` could only ever be a 400. The two variable
 * products carry *local* attributes (`id: 0`, "Taille" and "Finition"), and
 * §82 is explicit that a local attribute has no shared vocabulary and no term
 * to count — so the panel's headline filter had nothing to filter on and no way
 * to prove it worked.
 *
 * §88's routes exist precisely so this needs no wp-admin, so everything here
 * goes through the API and exercises the same routes the panel does.
 *
 * **Idempotent, and it must stay that way**: `scripts/test.sh` runs it before
 * every e2e stage. The backend's own `scripts/test.sh` re-seeds the catalogue,
 * and the seeder rewrites the *variable* products' attribute lists wholesale —
 * measured, products 12 and 21 lose their global tags to it while the simple
 * products keep theirs. Re-running repairs that in a few seconds; skipping it
 * makes the attribute facet quietly go thin.
 *
 *   node scripts/seed-attributes.mjs <login> <password>
 */

const [, , LOGIN, PASSWORD] = process.argv;

if (!LOGIN || !PASSWORD) {
  console.error("usage: node scripts/seed-attributes.mjs <login> <password>");
  process.exit(2);
}

const BASE =
  process.env.AC_API_BASE ?? "http://localhost:8090/wp-json/algerian-commerce/v1";
const AUTH = "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64");

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: AUTH,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} answered ${res.status} outside the envelope`);
  }
  return { status: res.status, ...json };
}

/**
 * "Cuir" is deliberately a term no product uses.
 *
 * A facet group omits its zero-count values — measured: `pa_matiere` has six
 * terms and the facet reports `total_values: 5` — so without a term that
 * nobody carries, the panel's "render every value, zero-count ones included"
 * rule would look correct while doing nothing. This is the row that proves it.
 */
const ATTRIBUTES = [
  {
    name: "Matière",
    slug: "matiere",
    terms: ["Laine", "Argent", "Cuivre", "Terre cuite", "Bois d'olivier", "Cuir"],
  },
  { name: "Couleur", slug: "couleur", terms: ["Rouge", "Bleu", "Vert", "Noir", "Écru"] },
];

/** SKU → [attribute slug, term name][]. Keyed by SKU, never by id — see below. */
const TAGGING = {
  "AC-TAP-001": [["matiere", "Laine"], ["couleur", "Rouge"]],
  "AC-TAP-004": [["matiere", "Laine"], ["couleur", "Écru"]],
  "AC-BUR-010": [["matiere", "Laine"], ["couleur", "Noir"]],
  "AC-BIJ-002": [["matiere", "Argent"], ["couleur", "Bleu"]],
  "AC-BIJ-005": [["matiere", "Argent"], ["couleur", "Noir"]],
  "AC-MAI-003": [["matiere", "Cuivre"], ["couleur", "Rouge"]],
  "AC-MAI-008": [["matiere", "Bois d'olivier"], ["couleur", "Écru"]],
  "AC-POT-001": [["matiere", "Terre cuite"], ["couleur", "Rouge"]],
  "AC-POT-007": [["matiere", "Terre cuite"], ["couleur", "Bleu"]],
  "AC-EPI-001": [["couleur", "Vert"]],
};

const existing = await call("GET", "/attributes");

if (existing.status === 403) {
  console.error("that credential cannot manage products");
  process.exit(1);
}

const bySlug = new Map();
let created = 0;

for (const spec of ATTRIBUTES) {
  let attribute = (existing.data ?? []).find((a) => a.slug === spec.slug);

  if (!attribute) {
    const res = await call("POST", "/attributes", {
      name: spec.name,
      slug: spec.slug,
      type: "select",
      order_by: "menu_order",
    });
    if (res.status >= 300) {
      console.error(`could not create ${spec.slug}:`, JSON.stringify(res.error));
      process.exit(1);
    }
    attribute = res.data;
    created++;
  }

  bySlug.set(spec.slug, attribute);

  const terms = await call("GET", `/attributes/${attribute.id}/terms`);
  const have = new Set((terms.data ?? []).map((t) => t.name));

  for (const name of spec.terms) {
    if (have.has(name)) continue;
    const res = await call("POST", `/attributes/${attribute.id}/terms`, { name });
    if (res.status >= 300) {
      console.error(`  could not create term ${name}:`, JSON.stringify(res.error));
      process.exit(1);
    }
  }
}

/*
 * Term slugs come back from the API rather than being derived from the name.
 * "Bois d'olivier" stores as `bois-dolivier` and "Écru" as `ecru`; a filter
 * built on a guessed slug is a 400 at best and silently empty at worst.
 */
const slugFor = new Map();
for (const [slug, attribute] of bySlug) {
  const terms = await call("GET", `/attributes/${attribute.id}/terms`);
  for (const term of terms.data ?? []) slugFor.set(`${slug}:${term.name}`, term.slug);
}

/*
 * Products are found by SKU, never by id.
 *
 * The backend's suites delete and recreate their fixtures, so an id is stable
 * only until the next `scripts/test.sh` over there — AC-SEO-TAPIS moved from
 * 3071 to 3214 between two runs of this script during the products branch.
 */
const catalogue = await call("GET", "/products?per_page=100");
const bySku = new Map((catalogue.data ?? []).map((p) => [p.sku, p]));

let tagged = 0;
let already = 0;
const missing = [];

for (const [sku, pairs] of Object.entries(TAGGING)) {
  const product = bySku.get(sku);

  if (!product) {
    missing.push(sku);
    continue;
  }

  const wanted = pairs.map(([attrSlug, termName]) => ({
    taxonomy: bySlug.get(attrSlug).taxonomy,
    id: bySlug.get(attrSlug).id,
    slug: slugFor.get(`${attrSlug}:${termName}`),
  }));

  const has = (w) =>
    product.attributes.some((a) => a.name === w.taxonomy && a.options.includes(w.slug));

  if (wanted.every(has)) {
    already++;
    continue;
  }

  /*
   * Appended to what the product already carries, never replacing it.
   *
   * Replacing the list drops a variable product's *variation* attribute, and
   * WooCommerce then clears every variation's attribute map — measured on
   * products 12 and 21, whose three and two variations came back with
   * `attributes: []` and could no longer be told apart. Keeping the existing
   * entries and adding to them is the only safe shape for this write.
   */
  const keep = product.attributes.filter(
    (a) => !wanted.some((w) => w.taxonomy === a.name),
  );

  const attributes = [
    ...keep,
    ...wanted.map((w, index) => ({
      id: w.id,
      name: w.taxonomy,
      options: [w.slug],
      visible: true,
      variation: false,
      position: keep.length + index,
    })),
  ];

  const res = await call("PATCH", `/products/${product.id}`, { attributes });

  if (res.status >= 300) {
    console.error(`  ${sku}: ${res.status} ${JSON.stringify(res.error)}`);
    process.exit(1);
  }

  tagged++;
}

// A seed that tagged nothing and found nothing must not report success — the
// same floor `check-design.sh` and the backend's suites carry.
if (missing.length === Object.keys(TAGGING).length) {
  console.error(
    `none of the ${missing.length} expected products exist — is this the right shop?`,
  );
  process.exit(1);
}

console.log(
  `attributes: ${bySlug.size} (${created} created) · tagged ${tagged}, already correct ${already}` +
    (missing.length > 0 ? ` · missing ${missing.join(", ")}` : ""),
);
