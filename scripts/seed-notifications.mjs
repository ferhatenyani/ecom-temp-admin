/**
 * Give the queue something to have happened to.
 *
 * Measured 2026-08-21, before this existed:
 *
 *   GET /notifications            total 39
 *   channels                      {"email": 39}
 *   statuses                      {"pending": 39}
 *   sent_at                       null on every row
 *   last_error                    null on every row
 *   ?status=sent                  0 rows
 *   ?status=failed                0 rows
 *
 * **A screen whose entire purpose is "did it send?" had nothing that had ever
 * sent**, nothing that had ever failed, and one channel. Every state the screen
 * exists to distinguish was unreachable, so retry, the failure state and the
 * channel filter would all have shipped unproven.
 *
 * ## What is produced by running the system, and what is not
 *
 * The split matters, because a fabricated failure state is a fixture for a bug
 * that has never happened. Only two of the six states below needed a hand.
 *
 *   queued              `NotificationService::notify()` — the production path,
 *                       with the bodies from `NotificationMessages::render()`
 *                       so nothing here writes panel copy into a frozen record.
 *
 *   attempted, pending  `wp algerian-commerce send-notifications`, the real
 *                       drain, named by `meta.drain` on every retry response.
 *                       This stack has **no SMTP service** and `EmailChannel`
 *                       is registered unconditionally, so the drain fails
 *                       honestly: measured, one drain leaves `attempts: 1` and
 *                       `last_error: "wp_mail() did not accept the message."`
 *                       with the row still `pending`. `EmailChannel`'s own
 *                       docblock states this is correct behaviour and not a
 *                       test failure.
 *
 *   failed              `NotificationRepository::markFailed($id, $err, false)`
 *                       — the method the drain itself calls, with the drain's
 *                       own error string. Reaching it by draining five times
 *                       would work and would take five minutes of CLI startup.
 *
 *   sent                `markSent()`, likewise the drain's own method, which is
 *                       what stamps `sent_at` with `current_time('mysql', true)`.
 *                       The *transport* is what cannot be reached here — there
 *                       is no mail service in `compose.yaml` — not the code.
 *
 *   pending, clean      `requeue()`, which is `POST /retry` underneath. So the
 *                       "never attempted" rows are rows a retry actually reset.
 *
 * Two rows go underneath all of it with a direct write, and each is a state the
 * running system genuinely cannot produce on this stack:
 *
 *   readable: false     A payload that will not decode. `notify()` writes the
 *                       payload with `wp_json_encode()`, so nothing that goes
 *                       through the API or the service can store a broken one —
 *                       the same shape as `seed-cms.mjs` and its drop report,
 *                       where the only route that writes the document is the one
 *                       that refuses to write a bad one.
 *
 *   an `sms` row        `NotificationChannelRegistry` holds exactly one channel
 *                       and CLAUDE.md records that SMS is deliberately not
 *                       implemented. Without a second channel `?channel=` is a
 *                       filter with one value, which proves nothing. The
 *                       migration's own comment names this case: `UNIQUE
 *                       (channel, dedupe_key)` is per channel, "the same order
 *                       legitimately produces an email and, later, an SMS".
 *
 * ## Idempotence, and the one thing this script must not break
 *
 * The drain takes the **oldest pending rows globally**, so it cannot be pointed
 * at this script's own rows — `--limit` selects by age, not by ownership. Run
 * unguarded on every `test.sh`, it would add an attempt to every unrelated
 * pending row in the shop and mark them `failed` on the fifth run.
 *
 * So the ids this script creates are carried between the two `wp eval` steps,
 * and everything pending that is **not** one of them is `requeue()`d afterwards
 * — put back exactly as found, by the same call the retry button makes. The
 * queue outside this fixture is left alone.
 *
 * `tests/Api/notifications.php` on the backend `DELETE`s the whole table before
 * it asserts anything, which is why this is not optional: the 39 rows measured
 * above are gone after any backend suite run, and re-running this is how they
 * come back.
 *
 *   node scripts/seed-notifications.mjs <login> <password>
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [, , LOGIN, PASSWORD] = process.argv;

if (!LOGIN || !PASSWORD) {
  console.error("usage: node scripts/seed-notifications.mjs <login> <password>");
  process.exit(2);
}

const BASE =
  process.env.AC_API_BASE ?? "http://localhost:8090/wp-json/algerian-commerce/v1";
const AUTH = "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64");
const STACK = process.env.AC_STACK_DIR ?? join(homedir(), "projects", "ecom-temp");

/* ------------------------------------------------------------- the shape --- */

/**
 * One customer with a queue worth opening, and the rest of the spread around
 * them.
 *
 * **Karim Mansouri, customer 5, is the fixture the customer-detail section is
 * built on**: a real shopper with a real name and two real orders (4579 and 41),
 * so `?recipient=karim.mansouri@example.test` answers with six rows across every
 * state and `?subject_id=4579` answers with the five that are about one order —
 * the customer's four and the shop's own. Both of those filters landed in the
 * API on `feat/notification-filters`; before them this section was one request
 * per order per event name.
 *
 * `subject_id` points at orders that exist, because the detail screen links back
 * to them and a link to a 404 is worse than no link.
 *
 * `state` is what the row should end up as, not how it gets there. The `how` is
 * the file docblock above.
 */
const SHOP = "Algerian Commerce";
const ADMIN = "admin@example.test";
const KARIM = "karim.mansouri@example.test";
const AMINA = "amina.belkacem@example.test";

const ROWS = [
  // Karim's order 4579 — the whole life of one order, in five rows.
  {
    key: "karim-placed",
    event: "order.placed",
    audience: "customer",
    to: KARIM,
    subjectId: 4579,
    context: { order_number: "4579", total: "14800.00", currency: "DZD", customer_name: "Karim" },
    state: "sent",
  },
  {
    key: "karim-paid",
    event: "payment.received",
    audience: "customer",
    to: KARIM,
    subjectId: 4579,
    context: { order_number: "4579", total: "14800.00", currency: "DZD", customer_name: "Karim" },
    // Left exactly where the real drain put it: attempted once, still queued.
    state: "attempted",
  },
  {
    key: "karim-shipped",
    event: "shipment.shipped",
    audience: "customer",
    to: KARIM,
    subjectId: 4579,
    context: {
      order_number: "4579",
      total: "14800.00",
      currency: "DZD",
      customer_name: "Karim",
      tracking_number: "YAL-4579-DZ",
      carrier: "Yalidine",
    },
    state: "failed",
  },
  {
    key: "karim-delivered",
    event: "shipment.delivered",
    audience: "customer",
    to: KARIM,
    subjectId: 4579,
    context: { order_number: "4579", customer_name: "Karim" },
    // The row the drain marks permanently failed over — see `unreadable` below.
    state: "unreadable",
  },
  {
    key: "shop-new-order",
    event: "admin.new_order",
    audience: "admin",
    to: ADMIN,
    subjectId: 4579,
    context: { order_number: "4579", total: "14800.00", currency: "DZD", customer_name: "Karim" },
    state: "sent",
  },

  // Karim's older order 41, so his own list is not one order repeated.
  {
    key: "karim-old-placed",
    event: "order.placed",
    audience: "customer",
    to: KARIM,
    subjectId: 41,
    context: { order_number: "41", total: "16900.00", currency: "DZD", customer_name: "Karim" },
    state: "pending",
  },

  // Amina, so the list is not one customer and the failure state is not one row.
  {
    key: "amina-refunded",
    event: "order.refunded",
    audience: "customer",
    to: AMINA,
    subjectId: 37,
    context: { order_number: "37", total: "5200.00", currency: "DZD", customer_name: "Amina" },
    state: "failed",
  },
  {
    key: "amina-paid",
    event: "payment.received",
    audience: "customer",
    to: AMINA,
    subjectId: 31,
    context: { order_number: "31", total: "27700.00", currency: "DZD", customer_name: "Amina" },
    state: "sent",
  },
  {
    key: "cancelled",
    event: "order.cancelled",
    audience: "customer",
    to: "ac_pay_customer@example.test",
    subjectId: 4559,
    context: { order_number: "4559", total: "2000.00", currency: "DZD", customer_name: "" },
    state: "pending",
  },
];

/**
 * The `sms` row, written by hand because there is no `sms` channel to write it.
 *
 * Same order as `karim-placed` and the same `dedupe_key`, which is legal and is
 * the case migration 010 describes: the unique key is `(channel, dedupe_key)`,
 * not `dedupe_key` alone, so one order producing an email now and an SMS later
 * is the shape the table was built for.
 */
const SMS = {
  event: "order.placed",
  to: "+213661234567",
  subjectId: 4579,
  subject: "Algerian Commerce — commande 4579",
  body: "Bonjour Karim, votre commande 4579 est confirmee. Total 14800.00 DZD.",
  context: { order_number: "4579", total: "14800.00", currency: "DZD", customer_name: "Karim" },
};

/* ------------------------------------------------------------ the plumbing --- */

function wpEval(php, env = {}) {
  if (!existsSync(join(STACK, "compose.yaml"))) {
    throw new Error(`No stack at ${STACK} — set AC_STACK_DIR to the backend repository.`);
  }

  const passthrough = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);

  const out = execFileSync(
    "docker",
    ["compose", "run", "--rm", "-T", ...passthrough, "wpcli", "wp", "eval", php],
    { cwd: STACK, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 << 20 },
  );

  /*
   * `docker compose run` prints its own container lines on stdout on some
   * versions, so the JSON is extracted rather than parsed off the whole stream.
   * The same reason `mint-credential.sh` pipes stderr away and trims.
   */
  const json = out.trim().match(/\{[\s\S]*\}$/)?.[0];

  if (json === undefined) {
    throw new Error(`wp eval printed nothing parseable:\n${out.slice(0, 500)}`);
  }

  return JSON.parse(json);
}

function drain(limit) {
  const out = execFileSync(
    "docker",
    [
      "compose",
      "run",
      "--rm",
      "-T",
      "wpcli",
      "wp",
      "algerian-commerce",
      "send-notifications",
      `--limit=${limit}`,
    ],
    { cwd: STACK, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  return out.trim();
}

async function api(path) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: AUTH, Accept: "application/json" },
  });
  const body = await response.json();

  if (!response.ok || body.success === false) {
    throw new Error(`${path} → ${response.status} ${JSON.stringify(body.error ?? {})}`);
  }

  return body;
}

/* ------------------------------------------------------------------ steps --- */

/**
 * Queue the rows, through the service, with the backend's own message copy.
 *
 * `NotificationMessages::render()` rather than strings in this file: the body is
 * a **frozen record of what was queued**, and a seed that invented its own copy
 * would put panel-authored prose inside a record the panel then renders as
 * verbatim evidence. It is also where the bilingual shape comes from — a French
 * salutation over an English sentence — which the detail screen has to handle
 * and would not have been shown by hand-written fixtures.
 *
 * Returns `{ key: id }` and the previously-pending ids, which is what makes the
 * drain safe two steps later.
 */
function queueRows() {
  console.log("· queueing through NotificationService");

  const php = `
use AlgerianCommerce\\Core\\Plugin;
use AlgerianCommerce\\Notifications\\Notification;
use AlgerianCommerce\\Notifications\\NotificationMessages;

global $wpdb;
$table = $wpdb->prefix . "ac_notifications";
$service = Plugin::instance()->notificationService();
$rows = json_decode(getenv("AC_ROWS"), true);
$sms = json_decode(getenv("AC_SMS"), true);
$shop = getenv("AC_SHOP");

// Everything already queued, before this script touches anything. These are the
// rows the drain must be put back for.
$foreign = array_map("intval", (array) $wpdb->get_col(
    "SELECT id FROM {$table} WHERE status = 'pending'"
));

// Delete this fixture's own rows first, so a re-run starts from the same place
// rather than colliding with the unique key and silently keeping last run's
// state. Matched on (channel, dedupe_key), which is the unique key itself.
$deleted = 0;
foreach ($rows as $row) {
    $deleted += (int) $wpdb->query($wpdb->prepare(
        "DELETE FROM {$table} WHERE channel = 'email' AND dedupe_key = %s",
        $row["event"] . ":" . $row["subjectId"]
    ));
}
$deleted += (int) $wpdb->query($wpdb->prepare(
    "DELETE FROM {$table} WHERE channel = 'sms' AND dedupe_key = %s",
    $sms["event"] . ":" . $sms["subjectId"]
));

$ids = [];
$claimed = 0;
foreach ($rows as $row) {
    $message = NotificationMessages::render($row["event"], $shop, $row["context"]);
    $notification = $row["audience"] === "admin"
        ? Notification::toAdmin($row["event"], $row["to"], $message["subject"], $message["body"], "order", $row["subjectId"], $row["context"])
        : Notification::toCustomer($row["event"], $row["to"], $message["subject"], $message["body"], "order", $row["subjectId"], $row["context"]);

    /*
     * **notify() returns the number of channels it claimed, not a row id.**
     * Measured the hard way: it answered 1 for all nine rows, so every id below
     * was 1, and the whole shaping step silently updated a row that does not
     * exist — nine no-op UPDATEs and not one error, because an UPDATE that
     * matches nothing is not a failure. The docblock says "how many rows were
     * actually claimed" and zero is an ordinary answer meaning already-queued.
     *
     * So the id is read back by the unique key, which is what identifies the row
     * this call just wrote.
     */
    $claimed += (int) $service->notify($notification);

    $ids[$row["key"]] = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT id FROM {$table} WHERE channel = 'email' AND dedupe_key = %s",
        $row["event"] . ":" . $row["subjectId"]
    ));
}

echo wp_json_encode([
    "ids" => $ids,
    "claimed" => $claimed,
    "foreign" => $foreign,
    "deleted" => $deleted,
]);
`;

  const report = wpEval(php, {
    AC_ROWS: JSON.stringify(ROWS),
    AC_SMS: JSON.stringify(SMS),
    AC_SHOP: SHOP,
  });

  /*
   * **The floor has to be on distinctness, not on the count.** The first
   * version of this checked `ids.length === ROWS.length` and passed while every
   * id was the number 1 — because `notify()` answers a claim count and all nine
   * claims succeeded. Nine identical ids is exactly what a wrong id looks like,
   * and it is the shape a length check cannot see.
   */
  const queued = Object.values(report.ids).filter((id) => id > 0);
  const distinct = new Set(queued);

  if (queued.length !== ROWS.length || distinct.size !== ROWS.length) {
    throw new Error(
      `expected ${ROWS.length} distinct row ids, got ${queued.length} (${distinct.size} distinct): ` +
        JSON.stringify(report.ids),
    );
  }
  if (report.claimed !== ROWS.length) {
    throw new Error(`the service claimed ${report.claimed} of ${ROWS.length}`);
  }

  console.log(`    ${queued.length} queued, ${report.deleted} replaced`);
  return report;
}

/**
 * Shape the queued rows into the states the screen has to tell apart.
 *
 * Every call here is the drain's own — `markSent`, `markFailed`, `requeue` — so
 * a `sent` row is stamped by the code that stamps a real one. The two direct
 * writes are the two the running system cannot make on this stack, and each says
 * so at its call site.
 */
function shapeRows(ids, foreign) {
  console.log("· shaping through the repository's own methods");

  const php = `
use AlgerianCommerce\\Core\\Plugin;

global $wpdb;
$table = $wpdb->prefix . "ac_notifications";
$repo = Plugin::instance()->notificationRepository();
$ids = json_decode(getenv("AC_IDS"), true);
$foreign = array_map("intval", json_decode(getenv("AC_FOREIGN"), true));
$sms = json_decode(getenv("AC_SMS"), true);

// The drain's own error string, measured: EmailChannel returns it whenever
// wp_mail() answers false, which on this stack is always. The provider's text
// ("sendmail: can't connect to remote host") goes to stderr and never reaches
// the column, so this is the string an operator actually sees.
$DRAIN_ERROR = "wp_mail() did not accept the message.";

$repo->markSent($ids["karim-placed"]);
$repo->markSent($ids["shop-new-order"]);
$repo->markSent($ids["amina-paid"]);

// false = not retryable, which is what takes a row to \`failed\` on one call
// instead of on the fifth. Same statement the drain runs for a rejected address.
$repo->markFailed($ids["karim-shipped"], $DRAIN_ERROR, false);
$repo->markFailed($ids["amina-refunded"], "Not a deliverable email address.", false);

// requeue() is POST /{id}/retry underneath, so these are rows a retry reset —
// attempts 0, no error — rather than rows that were never touched.
$repo->requeue($ids["karim-old-placed"]);
$repo->requeue($ids["cancelled"]);

// \`karim-paid\` is deliberately left where the drain put it: pending, one
// attempt, the drain's error on it. That state — tried, failed, will try again —
// is the one an operator sees most and the one no other row here carries.

/*
 * The unreadable payload. \`notify()\` writes it with wp_json_encode(), and the
 * API has no route that writes a payload at all, so a row the presenter reports
 * as \`readable: false\` cannot be produced by anything running. This is the
 * seed-cms.mjs drop-report exception, one table over.
 *
 * Marked failed with the drain's own sentence for this case, because that is
 * exactly what drain() does when json_decode() returns something that is not an
 * array — it never attempts the send.
 */
$wpdb->update($table, ["payload" => "{not json"], ["id" => $ids["karim-delivered"]], ["%s"], ["%d"]);
$repo->markFailed($ids["karim-delivered"], "The stored payload is not readable.", false);

/*
 * The sms row. There is no sms channel — the registry holds one and CLAUDE.md
 * records that SMS is deliberately unimplemented — so nothing can queue this
 * and the drain would skip it as a channel it does not have. Without it
 * \`?channel=\` is a control with one option.
 */
$wpdb->insert($table, [
    "channel" => "sms",
    "event" => $sms["event"],
    "dedupe_key" => $sms["event"] . ":" . $sms["subjectId"],
    "audience" => "customer",
    "recipient" => $sms["to"],
    "subject_type" => "order",
    "subject_id" => $sms["subjectId"],
    "status" => "pending",
    "attempts" => 0,
    "payload" => wp_json_encode([
        "event" => $sms["event"],
        "audience" => "customer",
        "recipient" => $sms["to"],
        "subject" => $sms["subject"],
        "body" => $sms["body"],
        "subject_type" => "order",
        "subject_id" => $sms["subjectId"],
        "context" => $sms["context"],
    ]),
    "last_error" => null,
    "created_at" => current_time("mysql", true),
]);
$smsId = (int) $wpdb->insert_id;

/*
 * **Put the rest of the shop back.** The drain takes the oldest pending rows
 * globally, so it attempted every unrelated row too. requeue() is the retry, so
 * this restores them exactly — status pending, attempts 0, no error — and is
 * what makes running this on every test.sh harmless rather than a slow march
 * towards marking the whole queue failed.
 */
$mine = array_map("intval", array_values($ids));
$mine[] = $smsId;
$restored = 0;
foreach ($foreign as $id) {
    if (in_array($id, $mine, true)) { continue; }
    if ($repo->requeue($id)) { $restored++; }
}

echo wp_json_encode(["sms" => $smsId, "restored" => $restored]);
`;

  const report = wpEval(php, {
    AC_IDS: JSON.stringify(ids),
    AC_FOREIGN: JSON.stringify(foreign),
    AC_SMS: JSON.stringify(SMS),
  });

  console.log(`    sms row ${report.sms}, ${report.restored} unrelated rows put back`);
  return report;
}

/* ------------------------------------------------------------ the assertion --- */

/**
 * Read it back over HTTP, with the credential, the way the panel will.
 *
 * A seed that verifies through `wp eval` verifies the database. What the screen
 * gets is what the presenter published through the guard, and those are not the
 * same claim — `payload` is not even selected by the list query.
 */
async function verify() {
  console.log("");

  const all = await api("/notifications?per_page=100");
  const rows = all.data;
  const failures = [];

  const count = (key) =>
    rows.reduce((into, row) => {
      into[row[key]] = (into[row[key]] ?? 0) + 1;
      return into;
    }, {});

  const statuses = count("status");
  const channels = count("channel");

  for (const status of ["pending", "sent", "failed"]) {
    if ((statuses[status] ?? 0) === 0) failures.push(`no ${status} row`);
  }
  if ((channels.sms ?? 0) === 0) failures.push("no second channel, so ?channel= proves nothing");

  // The state the drain leaves and nothing else does: queued, tried, error on it.
  if (!rows.some((row) => row.status === "pending" && row.attempts > 0 && row.last_error)) {
    failures.push("no row is pending with an attempt behind it");
  }
  if (!rows.some((row) => row.status === "sent" && row.sent_at !== null)) {
    failures.push("a sent row without a sent_at");
  }
  // The floor on the reset rows: if requeue() did nothing, every row would carry
  // an attempt and "never attempted" would not be a state the screen can show.
  if (!rows.some((row) => row.status === "pending" && row.attempts === 0 && !row.last_error)) {
    failures.push("no clean pending row");
  }

  const karim = await api(`/notifications?recipient=${encodeURIComponent(KARIM)}&per_page=100`);
  if (karim.meta.total < 5) {
    failures.push(`the customer fixture has ${karim.meta.total} rows, expected at least 5`);
  }
  if (karim.meta.total >= all.meta.total) {
    failures.push("?recipient= did not narrow, so the filter is being ignored");
  }

  const order = await api("/notifications?subject_id=4579&per_page=100");
  if (order.meta.total < 4) {
    failures.push(`order 4579 has ${order.meta.total} notifications, expected at least 4`);
  }
  if (!order.data.some((row) => row.audience === "admin")) {
    failures.push("order 4579 has no admin row, so the audience distinction is untested");
  }

  // The unreadable payload, which only the single read can show.
  const unreadable = rows.find((row) => row.event === "shipment.delivered");
  if (!unreadable) {
    failures.push("the unreadable row is missing");
  } else {
    const detail = await api(`/notifications/${unreadable.id}`);
    if (detail.data.message.readable !== false) {
      failures.push("the unreadable row reads back as readable");
    }
  }

  // The control beside it: a normal row is readable, or the check above passes
  // for a reason that has nothing to do with the payload.
  const normal = rows.find((row) => row.status === "sent");
  if (normal) {
    const detail = await api(`/notifications/${normal.id}`);
    if (detail.data.message.readable !== true) failures.push("a normal row is not readable");
    if (detail.data.message.body === "") failures.push("a normal row has an empty body");
  }

  console.log(
    `${all.meta.total} rows — ` +
      Object.entries(statuses)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ") +
      ` — channels ${Object.keys(channels).join(", ")}`,
  );
  console.log(`karim ${karim.meta.total} rows, order 4579 ${order.meta.total} rows`);

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }
}

async function main() {
  const { ids, foreign } = queueRows();

  console.log("· draining, which is the only honest way to produce an attempt");
  // Sized so every pending row is reached: the drain selects by age, and this
  // fixture's rows are the newest in the table.
  const attempted = drain(Math.max(100, foreign.length + ROWS.length + 10));
  for (const line of attempted.split("\n")) {
    if (line.trim() !== "") console.log(`    ${line.trim()}`);
  }

  shapeRows(ids, foreign);
  await verify();
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
