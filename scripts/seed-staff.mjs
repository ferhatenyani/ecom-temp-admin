/**
 * One suspended staff account, so the suspended state is a screen and not a
 * branch nobody has taken.
 *
 * Measured 2026-08-21, before this existed:
 *
 *   GET /users                    total 70
 *   statuses                      {"active": 70}
 *   ?status=suspended             0 rows
 *   roles                         super_admin 11, admin 14, manager 6,
 *                                 order_manager 7, product_manager 6,
 *                                 support_agent 19, marketing_manager 5,
 *                                 administrator 2
 *
 * **`status` was `active` on every single account**, so the suspend action, the
 * reactivate action, the `?status=` filter and the suspended badge were four
 * controls with nothing to act on — 14b's "every row is `pending`" again, one
 * collection over. Two of §87's five escalation refusals are about suspension
 * and neither had a fixture.
 *
 * ## Why a throwaway account rather than suspending somebody real
 *
 * There is no `POST` that suspends nobody. Every other option means picking a
 * live account and turning its credentials off — `SuspensionGuard` answers 401
 * at **every route in the namespace**, including `/auth/me` and `/health`, so
 * suspending one of the four accounts `mint-credential.sh` issues would break
 * the e2e suite, and suspending one of the shop's 70 would take away access
 * somebody may be using.
 *
 * So the account is this script's own, named for what it is, and holds a role
 * the panel can still render. It is created and suspended **through the API**,
 * which is the project's rule: `POST /users` and `PATCH /users/{id}` are the
 * production writers, they audit exactly as they would for a person, and
 * nothing here reaches under them the way `seed-cms.mjs` has to. Suspension is
 * one `PATCH` away from being observable and there is no reason to fake it.
 *
 * ## Why it is idempotent rather than re-created
 *
 * `POST /users` is a 409 on a duplicate username and a 409 on a duplicate
 * email, so a second run would fail on the first request. It finds the account
 * by `?search=` and re-asserts the status instead, which also repairs a run
 * where somebody reactivated it by hand from the panel — which is exactly what
 * the e2e test does.
 *
 * Run before the e2e stage, with a **Super Admin** credential: `/users` is
 * `ac_manage_users`, which no other tier holds.
 *
 *   node scripts/seed-staff.mjs <login> <password>
 */

const [, , LOGIN, PASSWORD] = process.argv;

if (!LOGIN || !PASSWORD) {
  console.error("usage: node scripts/seed-staff.mjs <login> <password>");
  process.exit(2);
}

const BASE = process.env.AC_API_BASE ?? "http://localhost:8090/wp-json/algerian-commerce/v1";
const AUTH = "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64");

/**
 * The account. `ac_manager` rather than `ac_super_admin`: it is the other
 * assignable role, so the list has a suspended row whose role label is one a
 * picker can actually offer, and nothing here creates a second Super Admin.
 *
 * The name is deliberately a person's rather than `ac_seed_1`. The users screen
 * renders `display_name` and the point of the row is that somebody reading it
 * recognises what a suspended colleague looks like.
 */
const ACCOUNT = {
  username: "ac_panel_suspended",
  email: "ac_panel_suspended@example.test",
  first_name: "Nadia",
  last_name: "Cherif",
  role: "ac_manager",
};

async function api(method, path, body, contentType = "application/json") {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: AUTH,
      ...(body === undefined ? {} : { "Content-Type": contentType }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = {};
  if (text !== "") {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path} answered something that is not JSON: ${text.slice(0, 200)}`);
    }
  }

  return { status: response.status, payload };
}

function fail(message) {
  console.error(`seed-staff: ${message}`);
  process.exit(1);
}

/** The account, found or created. */
async function ensureAccount() {
  const found = await api("GET", `/users?search=${encodeURIComponent(ACCOUNT.username)}&per_page=20`);

  if (found.status === 403) {
    fail("that credential cannot read /users — this seed needs a Super Admin.");
  }

  if (found.status !== 200) {
    fail(`GET /users answered ${found.status}: ${JSON.stringify(found.payload).slice(0, 200)}`);
  }

  const existing = (found.payload.data ?? []).find((row) => row.username === ACCOUNT.username);
  if (existing) return existing;

  const created = await api("POST", "/users", ACCOUNT);

  if (created.status !== 200 && created.status !== 201) {
    fail(`POST /users answered ${created.status}: ${JSON.stringify(created.payload).slice(0, 300)}`);
  }

  return created.payload.data;
}

const account = await ensureAccount();

/*
 * Re-asserted rather than assumed. `PATCH {status: "suspended"}` on an account
 * that is already suspended is a 200 no-op, so this costs one request and heals
 * a run where the e2e reactivated it — which is what that test does, on purpose,
 * because reactivate is the other half of the pair and has to be proven too.
 */
const suspended = await api("PATCH", `/users/${account.id}`, { status: "suspended" });

if (suspended.status !== 200) {
  fail(
    `PATCH /users/${account.id} answered ${suspended.status}: ` +
      JSON.stringify(suspended.payload).slice(0, 300),
  );
}

if (suspended.payload.data?.status !== "suspended") {
  fail(`the account is ${suspended.payload.data?.status ?? "of unknown status"} after the write.`);
}

/*
 * The floor. A seed that reports success while the filter it exists for still
 * answers nothing is a seed that has not run — `?status=suspended` answered 0
 * rows for all 70 accounts before this, and that is the number this has to move.
 */
const filtered = await api("GET", "/users?status=suspended&per_page=50");

if (filtered.status !== 200) {
  fail(`GET /users?status=suspended answered ${filtered.status}`);
}

const rows = filtered.payload.data ?? [];
if (!rows.some((row) => row.id === account.id)) {
  fail("the account is suspended and ?status=suspended does not return it.");
}

console.log(
  `seed-staff: ${ACCOUNT.username} (#${account.id}) suspended; ` +
    `?status=suspended answers ${filtered.payload.meta?.total ?? rows.length} of ` +
    `${(await api("GET", "/users?per_page=1")).payload.meta?.total ?? "?"}.`,
);
