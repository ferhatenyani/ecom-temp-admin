/**
 * Give the shop content to manage, and take away the fixture noise hiding it.
 *
 * Measured 2026-08-21, before this existed:
 *
 *   GET /cms/homepage        200  {"sections": []}   meta absent
 *   GET /cms/banners         2 rows, 3 at ?status=any
 *   GET /cms/faqs            2 rows
 *   wp post list --post_type=page --post_status=any
 *                            79 pages, of which 53 answered to `ac-unpublished`
 *                            and 27 to `conditions` — the *same* path, not
 *                            suffixed copies of it
 *
 * So every screen on this branch would have been built against an empty
 * document, and the Pages index — the route `feat/cms-page-index` added to the
 * backend for it — would have opened on eighty rows of accumulated test fixtures
 * where a path resolves to one row and the rest are unreachable. See
 * `purgeDuplicatePages()` for why that is worse than it sounds.
 *
 * Three jobs, in order:
 *
 *   1. Delete the pages that share a path with another. Permanently.
 *   2. Seed pages, banners and FAQs that look like a shop's content.
 *   3. Write a homepage document with **one malformed section in it**.
 *
 * The third is the one that needs explaining. `GET /cms/homepage` reports the
 * sections it had to drop in `meta.problems`, and `PUT` refuses a malformed
 * document with a 400 rather than dropping anything — §89 states the asymmetry
 * on purpose: an option edited by hand must degrade, a form filled in by a
 * person must not lose their work quietly. The consequence is that **the drop
 * report cannot be provoked through the API at all**, because the only route
 * that writes the document is the one that refuses to write a bad one. So this
 * step goes underneath the API with `wp eval`, exactly as `mint-credential.sh`
 * already does for the one thing the API deliberately does not do.
 *
 * Idempotent by construction rather than by checking: the homepage option is
 * written whole every run, and pages, banners and FAQs are matched on a stable
 * natural key and updated in place. `scripts/test.sh` runs it before the e2e
 * stage, beside `seed-attributes.mjs` and `seed-shipping-rules.mjs`, and
 * `e2e/content.spec.ts` asserts the figures it establishes.
 *
 *   node scripts/seed-cms.mjs <login> <password>
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [, , LOGIN, PASSWORD] = process.argv;

if (!LOGIN || !PASSWORD) {
  console.error("usage: node scripts/seed-cms.mjs <login> <password>");
  process.exit(2);
}

const BASE =
  process.env.AC_API_BASE ?? "http://localhost:8090/wp-json/algerian-commerce/v1";
const AUTH = "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64");
const STACK = process.env.AC_STACK_DIR ?? join(homedir(), "projects", "ecom-temp");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Compare two pieces of stored text for "is this the same thing".
 *
 * **WordPress texturizes what it stores, so a title never reads back as it was
 * written.** Measured on the first run of this script: `Soldes d'été` went in
 * and its apostrophe came back as numeric character reference 8217, so a seed
 * matching on `row.title ===
 * banner.title` found nothing, created a second banner, and would have created
 * one more on every run — an "idempotent" script quietly filling the shop.
 *
 * The same class as README's note about `timeline[].summary` carrying HTML
 * entities: the API is emitting exactly what WordPress stored, and what
 * WordPress stored is not what was sent. Decoding numeric entities and folding
 * the curly quotes back to straight ones is enough for text a seed writes.
 */
function sameText(a, b) {
  const normalise = (value) =>
    String(value)
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&amp;/g, "&")
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, "...")
      .replace(/[–—]/g, "-")
      .trim();

  return normalise(a) === normalise(b);
}

/**
 * One request, with the envelope unwrapped and the write cap respected.
 *
 * Writes are **120 a minute per credential** and this script issues around
 * seventy deletes in a burst, so a 429 is a normal outcome rather than a
 * failure. `Retry-After` is the API's own answer to how long to wait; waiting
 * that long and retrying once is the difference between a seed that works on a
 * shop with fixture noise in it and one that half-finishes.
 */
async function call(method, path, body, { retries = 2 } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: AUTH,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 429 && retries > 0) {
    const wait = Number.parseInt(res.headers.get("retry-after") ?? "5", 10) || 5;
    console.log(`    rate limited; waiting ${wait}s`);
    await sleep((wait + 1) * 1000);
    return call(method, path, body, { retries: retries - 1 });
  }

  const text = await res.text();
  let payload = null;

  try {
    payload = text === "" ? null : JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} answered non-JSON (${res.status})`);
  }

  if (!res.ok || payload?.success === false) {
    const message = payload?.error?.message ?? `HTTP ${res.status}`;
    const error = new Error(`${method} ${path}: ${message}`);
    error.status = res.status;
    error.code = payload?.error?.code;
    throw error;
  }

  return { data: payload?.data ?? null, meta: payload?.meta ?? {} };
}

/* ------------------------------------------------ 1. the duplicate pages --- */

/**
 * The duplicates are not what they looked like, and the difference matters.
 *
 * The expectation going in was `conditions-2`, `conditions-3` — WordPress
 * suffixing a colliding slug. Measured 2026-08-21, that is not what is in this
 * shop. **53 pages share the path `ac-unpublished` and 27 share `conditions`**,
 * with no suffix on any of them: `wp_unique_post_slug()` does not run for a
 * draft, and the published `conditions` rows were evidently drafted first and
 * published later, which is the same escape one step along.
 *
 * That turns fixture noise into a data-integrity trap, because **a path is the
 * only address this API has for a page**. `get_page_by_path()` resolves
 * `conditions` to exactly one row — id 2213 — so the other 26 cannot be read,
 * written or deleted through `/cms/pages/{path}` at all. A Pages index that
 * listed them would show 27 rows that look identical and whose links all open
 * the same page, and editing the fourteenth would silently edit the first.
 *
 * So the rule is derived from the defect rather than from a guessed naming
 * convention: **keep the row the path resolves to, delete the other rows
 * sharing that path.** It is self-limiting — a page with a unique path can
 * never match — and it cannot touch `checkout` or `livraison` however the
 * fixtures drift.
 *
 * Done with `wp eval` rather than over the API, and that is a deliberate
 * exception. `DELETE /cms/pages/{path}` can only ever delete *the row the path
 * resolves to*, so removing the 26 unreachable copies through it would mean
 * deleting the reachable one first and hoping the next request resolves to a
 * different row — blind, and 78 requests against a 120/minute write cap. By id
 * it is one call and it is deterministic.
 */
function purgeDuplicatePages() {
  console.log("· duplicate pages");

  if (!existsSync(join(STACK, "compose.yaml"))) {
    throw new Error(
      `No stack at ${STACK} — set AC_STACK_DIR to the backend repository.`,
    );
  }

  /*
   * The guard the API would have applied, applied here by hand because this
   * step goes around it: a page an option points at is never touched, whatever
   * else is true of it. `SystemPages` on the backend carries the argument.
   */
  const php = `
$options = ["page_on_front","page_for_posts","wp_page_for_privacy_policy",
  "woocommerce_shop_page_id","woocommerce_cart_page_id","woocommerce_checkout_page_id",
  "woocommerce_myaccount_page_id","woocommerce_terms_page_id","woocommerce_view_order_page_id",
  "woocommerce_edit_address_page_id","woocommerce_lost_password_page_id"];
$protected = [];
foreach ($options as $o) { $id = (int) get_option($o); if ($id > 0) { $protected[$id] = true; } }

$pages = get_posts(["post_type" => "page", "post_status" => "any", "numberposts" => -1]);
$byPath = [];
foreach ($pages as $p) { $byPath[get_page_uri($p)][] = (int) $p->ID; }

$deleted = 0; $kept = [];
foreach ($byPath as $path => $ids) {
    if (count($ids) < 2) { continue; }
    $resolved = get_page_by_path($path, OBJECT, "page");
    $keep = $resolved instanceof WP_Post ? (int) $resolved->ID : min($ids);
    $kept[] = $path . ": " . count($ids) . " rows, keeping id " . $keep;
    foreach ($ids as $id) {
        if ($id === $keep || isset($protected[$id])) { continue; }
        wp_delete_post($id, true);
        $deleted++;
    }
}
echo json_encode(["deleted" => $deleted, "paths" => $kept]);
`;

  const out = execFileSync(
    "docker",
    ["compose", "run", "--rm", "-T", "wpcli", "wp", "eval", php],
    { cwd: STACK, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );

  const report = JSON.parse(out.trim().match(/\{.*\}/s)?.[0] ?? "{}");

  for (const line of report.paths ?? []) console.log(`    ${line}`);
  console.log(`    deleted ${report.deleted ?? 0}`);

  return report.deleted ?? 0;
}

/* --------------------------------------------------- 2. editorial content --- */

/**
 * Pages a shop would actually have, including the two states the index exists
 * to make visible: a **draft**, and a page **filed under a parent**.
 *
 * `parent_path` is resolved by the API and a path naming nothing is a 400 on
 * that field — measured — so the parent is created before its child, and the
 * order of this list is load-bearing.
 */
const PAGES = [
  {
    path: "livraison",
    slug: "livraison",
    parent_path: "",
    status: "publish",
    title: "Livraison et délais",
    content:
      "<p>Nous livrons dans les 48 wilayas. Le délai est de 2 à 5 jours ouvrables selon la commune.</p>",
    excerpt: "Délais et zones de livraison.",
  },
  {
    path: "legal",
    slug: "legal",
    parent_path: "",
    status: "publish",
    title: "Informations légales",
    content: "<p>Les documents contractuels de la boutique.</p>",
    excerpt: "Mentions et conditions.",
  },
  {
    path: "legal/conditions-generales",
    slug: "conditions-generales",
    parent_path: "legal",
    status: "publish",
    title: "Conditions générales de vente",
    content:
      "<p>Les présentes conditions régissent les ventes conclues sur la boutique.</p>",
    excerpt: "Conditions générales de vente.",
  },
  {
    /*
     * A draft, and the reason the index earns its place. On the
     * single-resource route a draft and a path that does not exist are the
     * same 404 with the same message, so before the index existed an operator
     * looking for this page learned nothing about which of the two had
     * happened.
     */
    path: "retours",
    slug: "retours",
    parent_path: "",
    status: "draft",
    title: "Retours et remboursements",
    content: "<p>Brouillon — la politique de retour est en cours de rédaction.</p>",
    excerpt: "",
  },
];

async function seedPages() {
  console.log("· pages");

  for (const page of PAGES) {
    const { path, ...fields } = page;
    let existing = null;

    try {
      ({ data: existing } = await call("GET", `/cms/pages/${path}?status=any`));
    } catch (error) {
      if (error.status !== 404) throw error;
    }

    if (existing) {
      await call("PATCH", `/cms/pages/${path}`, fields);
      console.log(`    updated ${path} (${fields.status})`);
    } else {
      await call("POST", "/cms/pages", fields);
      console.log(`    created ${path} (${fields.status})`);
    }
  }
}

/**
 * Banners across two placements and both statuses.
 *
 * `position` is **dense** on this API — measured `0,1,2` — so the values here
 * are consecutive and a reordering screen can rely on that.
 */
const BANNERS = [
  {
    title: "Soldes d'été",
    caption: "<p>Jusqu'à -50% sur une sélection de tapis.</p>",
    link: "/soldes",
    placement: "home_hero",
    status: "publish",
    position: 0,
  },
  {
    title: "Livraison offerte dès 15 000 DA",
    caption: "<p>Dans les 48 wilayas.</p>",
    link: "/livraison",
    placement: "home_hero",
    status: "publish",
    position: 1,
  },
  {
    title: "Nouvelle collection",
    caption: "<p>Kilims et tapis berbères.</p>",
    link: "/nouveautes",
    placement: "category_top",
    status: "draft",
    position: 2,
  },
];

async function seedBanners() {
  console.log("· banners");

  const { data: existing } = await call(
    "GET",
    "/cms/banners?per_page=100&status=any",
  );

  for (const banner of BANNERS) {
    /*
     * Matched on the title through `sameText()`, because ids are not stable
     * across a backend re-seed — the same reason the product suites find a
     * product by SKU — and because a raw `===` on a title is the bug this
     * script shipped with for exactly one run.
     *
     * Every match is collected rather than the first, so a run that *did*
     * duplicate repairs the shop instead of leaving the extra rows behind.
     */
    const matches = existing.filter((row) => sameText(row.title, banner.title));
    const [keep, ...extras] = matches;

    for (const extra of extras) {
      await call("DELETE", `/cms/banners/${extra.id}?force=true`);
      console.log(`    removed a duplicate of ${banner.title}`);
    }

    if (keep) {
      await call("PATCH", `/cms/banners/${keep.id}`, banner);
      console.log(`    updated ${banner.title}`);
    } else {
      await call("POST", "/cms/banners", banner);
      console.log(`    created ${banner.title}`);
    }
  }
}

const FAQ_CATEGORIES = [
  { name: "livraison", slug: "livraison" },
  { name: "paiement", slug: "paiement" },
];

const FAQS = [
  {
    question: "Quel est le délai de livraison ?",
    answer: "<p>Entre 2 et 5 jours ouvrables selon la commune.</p>",
    category: "livraison",
    status: "publish",
    position: 0,
  },
  {
    question: "Puis-je payer à la livraison ?",
    answer: "<p>Oui. Le paiement à la livraison est disponible dans les 48 wilayas.</p>",
    category: "paiement",
    status: "publish",
    position: 1,
  },
  {
    question: "Comment suivre ma commande ?",
    answer: "<p>Un lien de suivi vous est envoyé dès l'expédition du colis.</p>",
    category: "livraison",
    status: "draft",
    position: 2,
  },
];

async function seedFaqs() {
  console.log("· FAQ categories and FAQs");

  const { data: categories } = await call("GET", "/cms/faq-categories");
  const known = new Set(categories.map((term) => term.slug));

  for (const category of FAQ_CATEGORIES) {
    if (known.has(category.slug)) continue;

    await call("POST", "/cms/faq-categories", category);
    known.add(category.slug);
    console.log(`    created category ${category.slug}`);
  }

  const { data: existing } = await call("GET", "/cms/faqs?per_page=100&status=any");

  for (const faq of FAQS) {
    const { category, ...fields } = faq;
    /*
     * `categories`, never `category` — the API refuses the singular *by name*
     * with "Use \"categories\" — an FAQ may sit in more than one.", which is
     * how the field was found rather than guessed. A bare list of slugs is
     * accepted alongside the `{id, slug, name}` objects the read emits, so the
     * slug is what this sends: it is the half that is stable across a re-seed.
     */
    const body = { ...fields, categories: [category] };
    // `sameText()` for the same reason as the banners: a question with an
    // apostrophe in it reads back texturized and would duplicate every run.
    const matches = existing.filter((row) => sameText(row.question, faq.question));
    const [keep, ...extras] = matches;

    for (const extra of extras) {
      await call("DELETE", `/cms/faqs/${extra.id}?force=true`);
      console.log(`    removed a duplicate of ${faq.question}`);
    }

    if (keep) {
      await call("PATCH", `/cms/faqs/${keep.id}`, body);
      console.log(`    updated ${faq.question}`);
    } else {
      await call("POST", "/cms/faqs", body);
      console.log(`    created ${faq.question}`);
    }
  }
}

/* ------------------------------------------- 3. the homepage, and its rot --- */

/**
 * Five valid sections and three broken ones.
 *
 * The broken three cover every arm of `HomepageSections::fromStored()` that can
 * report a problem without hitting the 50-section cap:
 *
 *   a string where an object belongs   → "Section N is not an object."
 *   a type outside the vocabulary      → "Section N has an unknown type "…"."
 *   a `data` that is not an object     → "Section N (…) has a "data" that is …"
 *
 * They are interleaved rather than appended, because the report names a
 * **1-based position in the stored document** while the panel renders the
 * *surviving* sections — so a report that says "Section 4" pointing at the
 * third thing on screen is exactly the off-by-one a trailing block of bad
 * sections would never reveal.
 *
 * `Tapis & Kilims` is in there on purpose. §89 records that running `wp_kses`
 * over every string leaf rewrote it to `Tapis &amp; Kilims`, which is why
 * `ContentHtml::looksLikeMarkup()` exists; if that regresses, it regresses here
 * first.
 */
const HOMEPAGE_DOCUMENT = [
  { type: "hero", data: { title: "Tapis & Kilims", cta: "/boutique" } },
  "this section is a string",
  { type: "featured_products", data: { limit: 8, category: "tapis" } },
  { type: "carousel", data: { images: [] } },
  { type: "text", data: { body: "<p>Fait main en Algérie.</p>" } },
  { type: "promotion", data: "not an object" },
  { type: "faq", data: { category: "livraison" } },
  { type: "newsletter", data: { headline: "Restez informé" } },
];

/**
 * Write the option directly, because the API will not.
 *
 * `PUT /cms/homepage` refuses a malformed document with a 400 naming the index,
 * by design — so the read's drop report is unreachable from outside. This is
 * the one step that needs the stack rather than the credential.
 */
function seedHomepage() {
  console.log("· homepage (direct, the API refuses to store this)");

  if (!existsSync(join(STACK, "compose.yaml"))) {
    throw new Error(
      `No stack at ${STACK} — set AC_STACK_DIR to the backend repository.`,
    );
  }

  const php = `update_option("ac_cms_homepage", json_decode(getenv("AC_DOC"), true), false); echo "ok";`;

  const out = execFileSync(
    "docker",
    [
      "compose",
      "run",
      "--rm",
      "-T",
      "-e",
      `AC_DOC=${JSON.stringify({ sections: HOMEPAGE_DOCUMENT })}`,
      "wpcli",
      "wp",
      "eval",
      php,
    ],
    { cwd: STACK, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );

  if (!out.includes("ok")) throw new Error("the homepage option was not written");

  // How many of these the reader will drop is the reader's judgement, not this
  // script's — one of the three is malformed only because `carousel` is outside
  // a vocabulary defined on the backend. The count is asserted below against
  // what `GET /cms/homepage` actually reports.
  console.log(`    ${HOMEPAGE_DOCUMENT.length} sections stored`);
}

/* ------------------------------------------------------------------ run --- */

async function main() {
  purgeDuplicatePages();
  await seedPages();
  await seedBanners();
  await seedFaqs();
  seedHomepage();

  /*
   * The floor. Every seed script in this repository ends by proving the shop is
   * in the state it just claimed to create — a seed that silently did nothing
   * and a seed that worked look identical from the exit code, and the suites
   * that depend on this one would then fail somewhere else entirely.
   */
  const { data: pages, meta: pageMeta } = await call(
    "GET",
    "/cms/pages?per_page=100&status=any",
  );
  const { data: banners } = await call("GET", "/cms/banners?per_page=100&status=any");
  const { data: faqs } = await call("GET", "/cms/faqs?per_page=100&status=any");
  const { data: homepage, meta: homeMeta } = await call("GET", "/cms/homepage");

  const problems = homeMeta.problems ?? [];
  const failures = [];

  /*
   * The floor that matters most: no two pages may share a path. A path is the
   * only address `/cms/pages/{path}` has, so a second row carrying one is a row
   * nothing can reach and a link that opens somebody else's page.
   */
  const seen = new Map();
  for (const page of pages) seen.set(page.path, (seen.get(page.path) ?? 0) + 1);

  const collisions = [...seen].filter(([, count]) => count > 1);

  if (collisions.length > 0) {
    failures.push(
      `pages still share a path: ${collisions.map(([p, n]) => `${p} ×${n}`).join(", ")}`,
    );
  }
  for (const page of PAGES) {
    if (!pages.some((row) => row.path === page.path)) {
      failures.push(`the page ${page.path} is missing`);
    }
  }
  if (!pages.some((page) => page.status === "draft")) {
    failures.push("no draft page, so ?status= proves nothing");
  }
  if (banners.length < BANNERS.length) failures.push("banners are missing");
  if (faqs.length < FAQS.length) failures.push("FAQs are missing");
  if (homepage.sections.length !== 5) {
    failures.push(`the homepage kept ${homepage.sections.length} sections, expected 5`);
  }
  if (problems.length !== 3) {
    failures.push(`the drop report has ${problems.length} problems, expected 3`);
  }

  console.log("");
  console.log(
    `pages ${pages.length} (+${pageMeta.excluded_system} system), ` +
      `banners ${banners.length}, faqs ${faqs.length}, ` +
      `homepage ${homepage.sections.length} sections, ${problems.length} dropped`,
  );
  for (const problem of problems) console.log(`  ! ${problem}`);

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
