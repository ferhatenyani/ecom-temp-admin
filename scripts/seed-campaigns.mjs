/**
 * Give the marketing screens a shop that has actually sent something.
 *
 * Measured 2026-08-21, before this existed:
 *
 *   GET /campaigns          total 0
 *   GET /segments           total 0
 *   GET /email-templates    total 0
 *   marketing consent       **1 of 16 customers**
 *   POST /campaigns/{id}/test   503 mail_not_configured
 *   POST /campaigns/{id}/send   503 mail_not_configured
 *
 * Three collections empty, and — worse — **the last two steps of the composer's
 * own sequence unreachable**. `audience → content → preview → test → send` could
 * be built as far as `preview` and no further, so `send`'s 202, the frozen
 * audience, the recipient list, the purge state and every status past `draft`
 * were all unassertable.
 *
 * ## The mail precondition, and why setting it is honest
 *
 * `MailTransport::isConfigured()` is `host() !== ''` and nothing more. So the one
 * thing standing between this panel and its own send path was an empty string in
 * the stack's `.env`.
 *
 * This script sets `SMTP_HOST=127.0.0.1` with `SMTP_PORT=1` — a port nothing
 * listens on, chosen over a `.invalid` hostname because a refused connection is
 * instant while a DNS timeout would make the synchronous test-send hang. The
 * result:
 *
 *   send   **202**, writes one recipient row per person, mails nothing. It never
 *          did: `send` resolves an audience and hands the work to
 *          `wp algerian-commerce send-campaigns`.
 *   test   **200 with `sent: false`**, which is the honest answer and a better
 *          screen than a 503 — the panel can say "we tried, here is what came
 *          back" instead of "we cannot try".
 *   drain  attempts every row and fails every one, exactly as the notification
 *          drain does, with the same `wp_mail() did not accept the message.`
 *
 * **Nothing can leave this machine.** That is the property, and it is stronger
 * than an unset host: an unset host is untested, a dead host is tested and
 * refused.
 *
 * It needs a container restart to take effect, so this runs only when the value
 * is empty and is a no-op afterwards. `tests/Api/campaigns.php` used to fail when
 * a transport was configured — it asserted the deployment's mail settings — and
 * was fixed on `feat/campaign-recipient-counts` to be independent of them, so the
 * backend suite is **108/0 either way**. Verified in both directions.
 *
 * ## What is produced by running the system, and what is not
 *
 *   consent      `Consent::set()`, the production writer, which also stamps
 *                `marketing_consent_at` and the source — so the customer screen's
 *                consent record is real rather than a bare flag.
 *
 *                The source is `"registration"`, one of the three the API's own
 *                readers use. It said `"seed"` first, which `Consent::set()`
 *                accepted without a murmur — it validates nothing — and which
 *                then **blanked the entire customer detail screen**, because the
 *                panel's schema enum-ed that field. Both halves were wrong and
 *                both are fixed: the schema degrades now, and a seed still has no
 *                business inventing vocabulary.
 *   segments     `POST /segments`, over the API.
 *   campaigns    `POST /campaigns` and `POST /campaigns/{id}/send`, over the API.
 *   the drain    `wp algerian-commerce send-campaigns`, which fails honestly.
 *   templates    `wp_insert_post` on `ac_email_template` — the **only** way, and
 *                not a shortcut: §85 makes templates a post type authored in
 *                wp-admin and the API reads them. There is no POST route to use.
 *                The insert still goes through `sanitizeOnSave`, so `wp_kses`
 *                runs and the script cannot store what an author could not.
 *
 * One thing is stubbed, and only for a single call: `pre_wp_mail` is
 * short-circuited around **one in-process `drain()`**, so a few recipients
 * genuinely send. The transport is what cannot succeed here, not the code, and
 * without it every recipient is `failed` and the recipient list's status filter
 * — the one `feat/campaign-recipient-counts` was written for — has a single
 * value to show. It is the device `tests/Api/campaigns.php` uses and names: the
 * drain's bookkeeping is the half with rules, and driving the real drain is what
 * keeps the rows and the campaign's stored columns in step. Writing the rows
 * directly does not: the first version did, and left a campaign reporting
 * `failed: 9` over rows that said sent 5 / failed 4.
 *
 *   node scripts/seed-campaigns.mjs <login> <password>
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [, , LOGIN, PASSWORD] = process.argv;

if (!LOGIN || !PASSWORD) {
  console.error("usage: node scripts/seed-campaigns.mjs <login> <password>");
  process.exit(2);
}

const BASE =
  process.env.AC_API_BASE ?? "http://localhost:8090/wp-json/algerian-commerce/v1";
const AUTH = "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64");
const STACK = process.env.AC_STACK_DIR ?? join(homedir(), "projects", "ecom-temp");

/** A port nothing listens on. Refused instantly; never resolves anywhere. */
const DEAD_HOST = "127.0.0.1";
const DEAD_PORT = "1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------- the shape --- */

/**
 * Customers who have agreed to be emailed.
 *
 * **Consent is the gate every audience passes through**, and with one consenting
 * customer in sixteen the gate cannot be made legible: the spec asks the composer
 * to show "1 000 clients sélectionnés → 412 destinataires", and 16 → 1 reads as a
 * bug rather than as a rule. Eight is enough for a segment to match a subset and
 * for `all` to differ from both.
 *
 * The third of the shop that is deliberately left without consent is the control:
 * a campaign naming one of them by id resolves to nobody, which is the 409 the
 * composer has to explain.
 */
const CONSENTING = [
  "karim.mansouri@example.test",
  "amina.belkacem@example.test",
  "nadia.cherif@example.test",
  "yacine.hamdani@example.test",
  "sofiane.benali@example.test",
  "ac_cus_shopper@example.test",
  "ac_pay_customer@example.test",
  "ac_cod_customer@example.test",
];

/**
 * Templates, including the two states the screen exists to make visible.
 *
 * `unknown_tokens` is the trap §85 names: `{{firstname}}` is not `{{first_name}}`
 * and renders **empty**, which is invisible in a preview that has a name in it
 * from another token. One template carries one on purpose.
 *
 * `has_unsubscribe_token` is the other: `{{unsubscribe_url}}` is appended
 * automatically when absent, so a template without it is *correct* and the screen
 * must say "added for you" rather than "missing".
 */
const TEMPLATES = [
  {
    key: "welcome",
    name: "Bienvenue",
    subject: "{{shop_name}} — bienvenue {{first_name}}",
    html:
      "<p>Bonjour {{first_name}},</p>\n" +
      "<p>Merci d'avoir créé un compte chez {{shop_name}}.</p>\n" +
      '<p><a href="{{unsubscribe_url}}">Se désabonner</a></p>',
    text:
      "Bonjour {{first_name}},\n\nMerci d'avoir créé un compte chez {{shop_name}}.\n\n" +
      "Se désabonner : {{unsubscribe_url}}",
  },
  {
    key: "sale",
    name: "Soldes",
    subject: "{{shop_name}} — nos soldes commencent",
    // No `{{unsubscribe_url}}`: the API appends one, and the screen says so.
    html: "<p>Bonjour {{first_name}},</p>\n<p>Nos soldes commencent aujourd'hui.</p>",
    text: "Bonjour {{first_name}},\n\nNos soldes commencent aujourd'hui.",
  },
  {
    key: "typo",
    name: "Relance panier (avec une coquille)",
    subject: "{{shop_name}} — votre panier vous attend",
    // `{{firstname}}` and `{{prenom}}` are not tokens. Both render empty.
    html: "<p>Bonjour {{firstname}},</p>\n<p>Votre panier vous attend, {{prenom}}.</p>",
    text: "Bonjour {{firstname}},\n\nVotre panier vous attend, {{prenom}}.",
  },
];

/**
 * Segments, chosen so their counts differ from each other and from `all`.
 *
 * A segment matching the same number as "everyone" proves nothing about the
 * resolver, and one matching zero proves nothing about the count.
 */
const SEGMENTS = [
  { key: "buyers", name: "Clients avec commande", criteria: { min_orders: 1 } },
  {
    key: "spenders",
    name: "Clients à plus de 10 000 DA",
    criteria: { min_spent: "10000.00" },
  },
  {
    key: "recent",
    name: "Inscrits depuis 2026",
    criteria: { registered_after: "2026-01-01" },
  },
  {
    // `wilaya_id` comes off the **shipment**, never the address, so an order
    // nobody has shipped cannot match. Seeded precisely because it is the
    // criterion most likely to surprise somebody, and the form says so.
    key: "alger",
    name: "Alger, expédiés",
    criteria: { wilaya_id: 16 },
  },
];

/* ------------------------------------------------------------ the plumbing --- */

function compose(args, options = {}) {
  return execFileSync("docker", ["compose", ...args], {
    cwd: STACK,
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.stderr ?? "ignore"],
    maxBuffer: 8 << 20,
  });
}

function wpEval(php, env = {}) {
  const passthrough = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const out = compose(["run", "--rm", "-T", ...passthrough, "wpcli", "wp", "eval", php]);
  const json = out.trim().match(/\{[\s\S]*\}$/)?.[0];

  if (json === undefined) {
    throw new Error(`wp eval printed nothing parseable:\n${out.slice(0, 600)}`);
  }

  return JSON.parse(json);
}

async function api(path, method = "GET", body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: AUTH,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const parsed = text === "" ? {} : JSON.parse(text);

  if (!response.ok || parsed.success === false) {
    const error = parsed.error ?? {};
    throw new Error(
      `${method} ${path} → ${response.status} ${error.code ?? ""} ` +
        `${JSON.stringify(error.details ?? error.message ?? {})}`,
    );
  }

  return parsed;
}

/* ------------------------------------------------------------------ steps --- */

/**
 * The mail precondition. See the file docblock for the whole argument.
 *
 * Idempotent by checking rather than by writing: the restart is the expensive
 * part, so it happens only on the run that actually changes the value.
 */
async function ensureMailTransport() {
  if (!existsSync(join(STACK, "compose.yaml"))) {
    throw new Error(`No stack at ${STACK} — set AC_STACK_DIR to the backend repository.`);
  }

  const current = wpEval('echo wp_json_encode(["host" => (string) getenv("SMTP_HOST")]);');

  if (current.host !== "") {
    console.log(`· mail transport already configured (${current.host})`);
    return false;
  }

  console.log("· configuring a dead mail transport, so `send` is reachable and mails nothing");

  const envPath = join(STACK, ".env");
  if (!existsSync(envPath)) {
    throw new Error(`No .env at ${envPath} — copy .env.example first.`);
  }

  let env = readFileSync(envPath, "utf8");
  env = /^SMTP_HOST=.*$/m.test(env)
    ? env.replace(/^SMTP_HOST=.*$/m, `SMTP_HOST=${DEAD_HOST}`)
    : `${env.trimEnd()}\nSMTP_HOST=${DEAD_HOST}\n`;
  env = /^SMTP_PORT=.*$/m.test(env)
    ? env.replace(/^SMTP_PORT=.*$/m, `SMTP_PORT=${DEAD_PORT}`)
    : env.replace(/^SMTP_HOST=.*$/m, `SMTP_HOST=${DEAD_HOST}\nSMTP_PORT=${DEAD_PORT}`);
  writeFileSync(envPath, env);

  compose(["up", "-d", "wordpress"], { stderr: "ignore" });

  // The container is up before WordPress is answering. Poll the API rather than
  // sleeping a guessed number of seconds.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(1500);
    try {
      await api("/marketing/config");
      console.log(`    ${DEAD_HOST}:${DEAD_PORT} — nothing listens there, and that is the point`);
      return true;
    } catch {
      /* still restarting */
    }
  }

  throw new Error("the stack did not come back after the restart");
}

/** Consent, through the production writer so the record is complete. */
function grantConsent() {
  console.log("· marketing consent");

  const report = wpEval(
    `
$consent = \\AlgerianCommerce\\Core\\Plugin::instance()->consent();
$emails = json_decode(getenv("AC_EMAILS"), true);
$granted = 0;
$missing = [];
foreach ($emails as $email) {
    $user = get_user_by("email", $email);
    if (!$user) { $missing[] = $email; continue; }
    $consent->set((int) $user->ID, true, "registration");
    $granted++;
}
echo wp_json_encode(["granted" => $granted, "missing" => $missing]);
`,
    { AC_EMAILS: JSON.stringify(CONSENTING) },
  );

  if (report.missing.length > 0) {
    console.log(`    (absent from this shop: ${report.missing.join(", ")})`);
  }
  console.log(`    ${report.granted} consenting`);
  return report.granted;
}

/**
 * Templates. `wp_insert_post` is the only door — §85 makes these a post type the
 * API only reads — and the insert still runs `wp_kses` through `sanitizeOnSave`.
 */
function seedTemplates() {
  console.log("· email templates");

  const report = wpEval(
    `
use AlgerianCommerce\\Campaigns\\EmailTemplates;

$templates = json_decode(getenv("AC_TEMPLATES"), true);
$ids = [];
foreach ($templates as $t) {
    $existing = get_posts([
        "post_type" => EmailTemplates::POST_TYPE,
        "post_status" => "any",
        "title" => $t["name"],
        "numberposts" => 1,
    ]);
    $id = $existing ? (int) $existing[0]->ID : 0;
    $post = [
        "post_type" => EmailTemplates::POST_TYPE,
        "post_status" => "publish",
        "post_title" => $t["name"],
        "post_content" => $t["html"],
    ];
    if ($id > 0) { $post["ID"] = $id; }
    $id = (int) wp_insert_post($post, true);
    if ($id > 0) {
        update_post_meta($id, EmailTemplates::TEXT_META, $t["text"]);
        update_post_meta($id, EmailTemplates::SUBJECT_META, $t["subject"]);
        $ids[$t["key"]] = $id;
    }
}
echo wp_json_encode(["ids" => $ids]);
`,
    { AC_TEMPLATES: JSON.stringify(TEMPLATES) },
  );

  console.log(`    ${Object.keys(report.ids).length} templates`);
  return report.ids;
}

/** Segments, over the API. A duplicate name is a 409, so existing ones are reused. */
async function seedSegments() {
  console.log("· segments");

  const existing = await api("/segments?per_page=100");
  const byName = new Map(existing.data.map((row) => [row.name, row]));
  const ids = {};

  for (const segment of SEGMENTS) {
    const hit = byName.get(segment.name);
    if (hit) {
      // Written back rather than left alone: the criteria in this file are the
      // definition, and a segment edited by hand between runs would otherwise
      // keep counts the assertions below do not expect.
      await api(`/segments/${hit.id}`, "PATCH", { criteria: segment.criteria });
      ids[segment.key] = hit.id;
      continue;
    }
    const created = await api("/segments", "POST", {
      name: segment.name,
      criteria: segment.criteria,
    });
    ids[segment.key] = created.data.id;
  }

  const counts = {};
  for (const [key, id] of Object.entries(ids)) {
    const preview = await api(`/segments/${id}/preview`);
    counts[key] = preview.data.matches;
  }

  console.log(`    ${Object.keys(ids).length} segments — matches ${JSON.stringify(counts)}`);
  return { ids, counts };
}

/**
 * Campaigns in every status the list has to tell apart.
 *
 * `draft`, `cancelled` and `sending` are reachable straight through the API.
 * A **completed** campaign needs every recipient row terminal, which on a stack
 * whose transport refuses everything means draining to `MAX_ATTEMPTS`; a few rows
 * are then marked `sent` with the drain's own `markSent()` so the recipient list
 * has more than one status in it.
 */
async function seedCampaigns(segments) {
  console.log("· campaigns");

  /*
   * **Matched by name, never recreated.** Only a draft can be deleted — a
   * cancelled or sent campaign answers 409, correctly, because it is the record
   * of a decision somebody took — so a seed that created one per run would add a
   * cancelled campaign to this shop every time `test.sh` ran, forever. The API
   * offers no door for that and should not; it is the caller's job not to ask.
   */
  const existing = await api("/campaigns?per_page=100");
  const byName = new Map(existing.data.map((row) => [row.name, row]));

  const reuse = async (name, body) => {
    const hit = byName.get(name);
    if (hit) return hit;
    const made = await api("/campaigns", "POST", { name, ...body });
    return made.data;
  };

  const draft = await reuse("Soldes d'août — brouillon", {
    subject: "{{shop_name}} — nos soldes commencent, {{first_name}}",
    body_html: "<p>Bonjour {{first_name}},</p>\n<p>Nos soldes commencent aujourd'hui.</p>",
    body_text: "Bonjour {{first_name}},\n\nNos soldes commencent aujourd'hui.",
    audience_type: "segment",
    segment_id: segments.ids.buyers,
  });

  // A draft carrying a token that is not one, so the composer's warning has
  // something to warn about without anyone editing a fixture to see it.
  const withTypo = await reuse("Relance panier — brouillon", {
    subject: "{{shop_name}} — votre panier",
    body_html: "<p>Bonjour {{firstname}},</p>\n<p>Votre panier vous attend.</p>",
    body_text: "Bonjour {{firstname}},\n\nVotre panier vous attend.",
    audience_type: "all",
  });

  const cancelled = await reuse("Ramadan — annulée", {
    subject: "{{shop_name}}",
    body_html: "<p>Bonjour {{first_name}},</p>",
    body_text: "Bonjour {{first_name}},",
    audience_type: "segment",
    segment_id: segments.ids.spenders,
  });
  if (cancelled.status === "draft") {
    await api(`/campaigns/${cancelled.id}/cancel`, "POST");
  }

  const sent = await reuse("Rentrée — envoyée", {
    subject: "{{shop_name}} — la rentrée, {{first_name}}",
    body_html:
      "<p>Bonjour {{first_name}},</p>\n<p>Notre sélection de rentrée est en ligne.</p>",
    body_text: "Bonjour {{first_name}},\n\nNotre sélection de rentrée est en ligne.",
    audience_type: "all",
  });

  if (sent.status === "draft") {
    const queued = await api(`/campaigns/${sent.id}/send`, "POST");
    console.log(`    froze ${queued.data.recipients} recipients`);

    /*
     * Drain to exhaustion. Every attempt fails — the transport refuses — so this
     * is `MAX_ATTEMPTS` rounds, after which every row is terminal and the
     * campaign completes. The command is the real one, named by `send`'s own
     * `next` block.
     */
    /*
     * **One round with the transport stubbed, so some recipients genuinely
     * send.** `pre_wp_mail` is short-circuited for the duration of a single
     * in-process `drain()` call — the device `tests/Api/campaigns.php` uses and
     * names in its own docblock: the drain's *bookkeeping* is the half that has
     * rules, and it is the half being exercised.
     *
     * The first version of this used `markSent()` on the rows directly and
     * produced a state the system cannot: the campaign's `recipients` block is
     * **stored columns** written by the drain, so the rows said sent 5 / failed 4
     * while the campaign still said failed 9. Driving the real drain keeps the
     * two in step because it is the thing that writes both.
     */
    const drained = wpEval(
      `
$service = \\AlgerianCommerce\\Core\\Plugin::instance()->campaignService();
$silence = static fn (): bool => true;
add_filter("pre_wp_mail", $silence, 99);
$result = $service->drain(5, (int) getenv("AC_CAMPAIGN"));
remove_filter("pre_wp_mail", $silence, 99);
echo wp_json_encode($result);
`,
      { AC_CAMPAIGN: String(sent.id) },
    );
    console.log(
      `    one stubbed round: ${drained.sent} sent, ${drained.failed} failed`,
    );

    /*
     * Then the rest, for real, until every remaining row is terminal and the
     * campaign completes. Every attempt fails — the transport refuses — so this
     * is `MAX_ATTEMPTS` rounds.
     */
    for (let round = 0; round < 5; round += 1) {
      compose([
        "run", "--rm", "-T", "wpcli",
        "wp", "algerian-commerce", "send-campaigns", "--limit=200",
      ]);
    }
  }

  return {
    draft: draft.id,
    withTypo: withTypo.id,
    cancelled: cancelled.id,
    sent: sent.id,
  };
}

/* ------------------------------------------------------------ the assertion --- */

/** Read it all back over HTTP, with the credential, the way the panel will. */
async function verify(ids, segments, consenting) {
  console.log("");

  const failures = [];

  const campaigns = await api("/campaigns?per_page=100");
  const statuses = campaigns.data.reduce((into, row) => {
    into[row.status] = (into[row.status] ?? 0) + 1;
    return into;
  }, {});

  for (const status of ["draft", "cancelled"]) {
    if (!statuses[status]) failures.push(`no ${status} campaign`);
  }
  if (!statuses.sent && !statuses.sending) {
    failures.push("no campaign has been sent, so the whole right half is unproven");
  }

  const templates = await api("/email-templates?per_page=100");
  if (templates.meta.total < TEMPLATES.length) {
    failures.push(`${templates.meta.total} templates, expected ${TEMPLATES.length}`);
  }
  if (!templates.data.some((t) => t.unknown_tokens.length > 0)) {
    failures.push("no template carries an unknown token, so that warning is untested");
  }
  if (!templates.data.some((t) => !t.has_unsubscribe_token)) {
    failures.push("every template has an unsubscribe token, so the appended case is untested");
  }

  // The consent gate, which is the number the composer exists to make legible.
  const sentCampaign = await api(`/campaigns/${ids.sent}`);
  const preview = await api(`/campaigns/${ids.withTypo}/preview`);
  if (preview.data.audience_count < 2) {
    failures.push(`audience_count is ${preview.data.audience_count}; the gate is illegible`);
  }
  if (preview.data.audience_count >= 16) {
    failures.push("every customer is consenting, so the gate filters nothing");
  }
  if (preview.data.unknown_tokens.length === 0) {
    failures.push("the typo draft previews no unknown token");
  }

  // The recipient list and its filter, which is what the backend branch bought.
  const all = await api(`/campaigns/${ids.sent}/recipients?per_page=100`);
  const byStatus = {};
  for (const status of ["pending", "sent", "failed"]) {
    const page = await api(`/campaigns/${ids.sent}/recipients?status=${status}&per_page=100`);
    byStatus[status] = page.meta.total;
    if (page.meta.total !== page.data.length) {
      failures.push(`recipients ?status=${status} reports ${page.meta.total} and returns ${page.data.length}`);
    }
  }
  const parts = Object.values(byStatus).reduce((a, b) => a + b, 0);
  if (parts !== all.meta.total) {
    failures.push(`the parts sum to ${parts} against a whole of ${all.meta.total}`);
  }
  if (Object.values(byStatus).filter((n) => n > 0).length < 2) {
    failures.push(`recipients are all one status: ${JSON.stringify(byStatus)}`);
  }

  // The mail precondition is *configured*, and still nothing can send.
  const test = await api(`/campaigns/${ids.withTypo}/test`, "POST", { to: "ops@example.test" });
  if (test.data.sent !== false) {
    failures.push("a test send reported success, which this stack must never do");
  }

  console.log(
    `campaigns ${campaigns.meta.total} ${JSON.stringify(statuses)} · ` +
      `segments ${JSON.stringify(segments.counts)} · templates ${templates.meta.total}`,
  );
  console.log(
    `consent ${consenting} · audience ${preview.data.audience_count} · ` +
      `recipients ${JSON.stringify(byStatus)} · sent campaign "${sentCampaign.data.status}"`,
  );

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }
}

async function main() {
  await ensureMailTransport();
  const consenting = grantConsent();
  seedTemplates();
  const segments = await seedSegments();
  const ids = await seedCampaigns(segments);
  await verify(ids, segments, consenting);
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
