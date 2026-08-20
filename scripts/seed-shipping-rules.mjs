/**
 * Give the shop the three shipping rules the resolver needs to resolve anything.
 *
 * Measured 2026-08-20, before this existed: `GET /shipping/rules` answered `[]`.
 * With no rule, `GET /shipping/rates?wilaya_id=16&commune_id=484` answers **200
 * with `[]`** — not an error, just nothing — so the rules editor, whose entire
 * specified value is *"show which rule would win for a chosen destination,
 * live"*, had nothing to resolve against and no way to prove it worked.
 *
 * The three are chosen to make the one rule that matters observable:
 * **commune beats wilaya beats national, and rules are never added together.**
 * Alger Centre is covered by all three, Ain Taya by two, and Adrar by one, so a
 * single shop exercises every arm of the resolver. Measured against the live API
 * with these rules in place: 350 / 500 / 800 respectively.
 *
 * **Idempotent, and it must stay that way**: `scripts/test.sh` runs it before
 * every e2e stage, and `e2e/shipping.spec.ts` asserts those three figures. A rule
 * is matched on its destination and its delivery type rather than on its id,
 * because ids are not stable across a backend re-seed — the same reason the
 * products suites find a product by SKU.
 *
 * This is what "restore what you create" means for a fixture the tests depend
 * on. Deleting the rules afterwards would put the shop back and leave the suite
 * asserting against nothing; seeding them makes them reproducible instead, which
 * is the arrangement `seed-attributes.mjs` already established for the global
 * attributes this shop also shipped without.
 *
 *   node scripts/seed-shipping-rules.mjs <login> <password>
 */

const [, , LOGIN, PASSWORD] = process.argv;

if (!LOGIN || !PASSWORD) {
  console.error("usage: node scripts/seed-shipping-rules.mjs <login> <password>");
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
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let payload = null;
  try {
    payload = text === "" ? null : JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} answered non-JSON (${res.status})`);
  }

  if (!res.ok || payload?.success === false) {
    const message = payload?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`${method} ${path}: ${message}`);
  }

  return payload?.data ?? null;
}

/**
 * Wilaya 16 is Algiers and commune 484 is Alger Centre — both stable ids from
 * §51's geography table, which is imported rather than generated, so unlike a
 * product id they survive a re-seed.
 */
const WANTED = [
  {
    label: "national fallback",
    provider: "manual",
    wilaya_id: 0,
    commune_id: 0,
    delivery_type: "home",
    amount: "800.00",
    free_over: null,
    estimated_days: 5,
    is_active: true,
  },
  {
    label: "wilaya 16 (Algiers)",
    provider: "manual",
    wilaya_id: 16,
    commune_id: 0,
    delivery_type: "home",
    amount: "500.00",
    free_over: "10000.00",
    estimated_days: 2,
    is_active: true,
  },
  {
    label: "commune 484 (Alger Centre)",
    provider: "manual",
    wilaya_id: 16,
    commune_id: 484,
    delivery_type: "home",
    amount: "350.00",
    free_over: null,
    estimated_days: 1,
    is_active: true,
  },
];

const existing = await call("GET", "/shipping/rules");

let created = 0;
let repaired = 0;

for (const { label, ...wanted } of WANTED) {
  const match = existing.find(
    (rule) =>
      rule.wilaya_id === wanted.wilaya_id &&
      rule.commune_id === wanted.commune_id &&
      rule.delivery_type === wanted.delivery_type &&
      rule.provider === wanted.provider,
  );

  if (match === undefined) {
    await call("POST", "/shipping/rules", wanted);
    created++;
    console.log(`  created ${label} at ${wanted.amount}`);
    continue;
  }

  /*
   * A rule at the right destination but the wrong price is worse than a missing
   * one: the suite asserts the figure, and a run that repaired nothing would
   * fail with "expected 350,00" against a shop somebody had edited by hand.
   */
  const drifted =
    match.amount !== wanted.amount ||
    match.is_active !== wanted.is_active ||
    match.estimated_days !== wanted.estimated_days ||
    match.free_over !== wanted.free_over;

  if (drifted) {
    await call("PATCH", `/shipping/rules/${match.id}`, wanted);
    repaired++;
    console.log(`  repaired ${label} to ${wanted.amount}`);
  }
}

/*
 * The floor. A seeder that matched nothing and created nothing would print a
 * cheerful summary and leave the resolver with no rules — the same failure mode
 * `check-design.sh` carries a file count for.
 */
const after = await call("GET", "/shipping/rules");
const covered = WANTED.every(({ label, ...wanted }) =>
  after.some(
    (rule) =>
      rule.wilaya_id === wanted.wilaya_id &&
      rule.commune_id === wanted.commune_id &&
      rule.amount === wanted.amount,
  ),
);

if (!covered) {
  console.error("the three rules are not all present after seeding");
  process.exit(1);
}

console.log(
  `shipping rules: ${created} created, ${repaired} repaired, ${after.length} in the shop`,
);
