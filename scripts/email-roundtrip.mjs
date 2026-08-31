#!/usr/bin/env node
//
// The round trip: build every fixture with the generator, push each one through
// the **real** `Campaigns\EmailHtml` sanitiser in the running backend stack, and
// fail if a single byte moved.
//
// ## Why this exists rather than a second copy of the allow-list
//
// `EmailHtml::ALLOWED` is a list of tags and attributes, and reading it twice
// proves nothing about three things that actually decide whether the generated
// HTML survives:
//
//   * `wp_kses` **rewrites** the tags it keeps — quoting, attribute order,
//     entity normalisation — so "every tag is on the list" and "the bytes come
//     back unchanged" are different claims and only the second one matters.
//   * `style` goes through a *second* allow-list, WordPress's own
//     `safecss_filter_attr`, which is nowhere in the plugin and which drops
//     individual declarations while keeping the rest of the attribute.
//   * Everything it removes is removed **silently, on save, with a 200**, so a
//     generator that emits something disallowed produces an email nobody can
//     debug and no test that reads the list would have caught it.
//
//     $ npm run test:email-roundtrip        # or: node scripts/email-roundtrip.mjs
//     $ node scripts/email-roundtrip.mjs --write   # refresh the checked-in fixture
//
// ## It needs the backend stack, and `tests/email-body.test.ts` does not
//
// This script is the measurement; `tests/fixtures-email-body.json` is its result,
// checked in, and the unit suite re-asserts the same equality offline on every
// run. So the round trip is proven against the real sanitiser here and stays
// proven on a machine with no Docker, which is the same division `new-order.ts`
// records for `rest_do_request()`: measure once, against the real thing, and
// commit what it said.
//
// **Read-only against `ecom-temp`.** `wp eval` in a `--rm` container touches no
// row and writes no file; the plugin source is read from the bind mount. Nothing
// here creates a campaign, which is deliberate — another agent is working in that
// repository.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const ROOT = resolve(import.meta.dirname, "..");
const BACKEND = "/home/myhomehp/projects/ecom-temp";
const FIXTURE = resolve(ROOT, "tests/fixtures-email-body.json");
const GENERATOR = "/app/[locale]/(panel)/marketing/campaigns/[id]/email-body.ts";

/**
 * The cases, chosen so that each one can only fail for its own reason.
 *
 * `full-ltr` and `full-rtl` are the same message in the two directions, which is
 * what makes the RTL half a comparison rather than an assertion about markup
 * nobody reads. `hostile` is the only one whose output is expected to be *smaller*
 * than its input — every refused thing in it is refused by the generator, so the
 * sanitiser has nothing left to remove, which is the property being proven.
 */
const CASES = {
  "full-ltr": {
    direction: "ltr",
    brandColour: "#B21F2D",
    logo: { src: "https://shop.test/wp-content/uploads/logo.png", alt: "Tapis & Co", width: 320 },
    title: "Soldes d'été < 1000 DA",
    paragraphs: [
      "Bonjour {{first_name}}, la collection d'été est arrivée.",
      "Livraison offerte\ndès 5000 DA, partout en Algérie.",
    ],
    image: { src: "https://shop.test/wp-content/uploads/hero.jpg", alt: "Tapis berbère", width: 1600 },
    cta: { label: "Voir la collection", href: "https://shop.test/boutique?utm=ete&page=1" },
    footer: "Tapis & Co, 12 rue Didouche Mourad, Alger. Vous recevez cet e-mail car vous êtes client de {{shop_name}}.",
  },
  "full-rtl": {
    direction: "rtl",
    brandColour: "#0A5",
    logo: { src: "https://shop.test/wp-content/uploads/logo.png", alt: "متجر الزرابي", width: 320 },
    title: "تخفيضات الصيف",
    paragraphs: [
      "مرحبا {{first_name}}، وصلت مجموعة الصيف.",
      "التوصيل مجاني ابتداء من 5000 دج.",
    ],
    image: { src: "https://shop.test/wp-content/uploads/hero.jpg", alt: "زربية", width: 1600 },
    cta: { label: "اكتشف المجموعة", href: "https://shop.test/boutique" },
    footer: "متجر الزرابي، الجزائر العاصمة.",
  },
  minimal: {
    direction: "ltr",
    brandColour: "",
    logo: null,
    title: "Merci",
    paragraphs: ["Votre commande {{order_number}} est en route."],
    image: null,
    cta: null,
    footer: "",
  },
  hostile: {
    direction: "ltr",
    brandColour: "rgb(255, 0, 0)",
    logo: { src: "data:image/png;base64,AAAA", alt: "x", width: 40 },
    title: "<script>alert(1)</script> & \"quotes\" 'and' <b>bold</b>",
    paragraphs: ["<img src=x onerror=alert(1)> mais aussi https://ok.test/a?b=1&c=2"],
    image: null,
    cta: { label: "Cliquez", href: "javascript:alert(1)" },
    footer: "Se désabonner : {{unsubscribe_url}}",
  },
  attributes: {
    direction: "ltr",
    brandColour: "#0b62d6",
    logo: { src: "https://shop.test/l.png?v=1&size=2", alt: "L'Artisan \"Alger\" & Co", width: 200 },
    title: "",
    paragraphs: ["L'été & les \"soldes\" < 5000 DA"],
    image: null,
    cta: { label: "L'offre", href: "https://shop.test/x?a=1&b=l'ete" },
    footer: "",
  },
  "cta-token": {
    direction: "ltr",
    brandColour: "#ffd60a",
    logo: null,
    title: "",
    paragraphs: ["Vous ne voulez plus de nos e-mails ?"],
    image: null,
    cta: { label: "Se désabonner", href: "{{unsubscribe_url}}" },
    footer: "",
  },
  empty: {
    direction: "rtl",
    brandColour: "#123456",
    logo: null,
    title: "   ",
    paragraphs: ["", "  "],
    image: null,
    cta: null,
    footer: "\n",
  },
};

/** `EmailHtml::sanitize()` on every `html`, `::sanitizeText()` on every `text`. */
const PHP = `
$in = json_decode(base64_decode(getenv('AC_BODIES')), true);
$out = [];
foreach ($in as $name => $body) {
    $out[$name] = [
        'html' => AlgerianCommerce\\Campaigns\\EmailHtml::sanitize($body['html']),
        'text' => AlgerianCommerce\\Campaigns\\EmailHtml::sanitizeText($body['text']),
    ];
}
echo base64_encode(json_encode($out));
`;

function run(command, args, options) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done(out) : fail(new Error(err || `exit ${code}`))));
  });
}

async function build() {
  // Vite rather than `node --experimental-strip-types`, because the generator
  // imports through the `@/` alias and only the project's own resolver knows it.
  const server = await createServer({
    root: ROOT,
    configFile: resolve(ROOT, "vitest.config.mts"),
    server: { middlewareMode: true },
    logLevel: "error",
  });

  try {
    const { buildEmail } = await server.ssrLoadModule(GENERATOR);
    return Object.fromEntries(Object.entries(CASES).map(([name, values]) => [name, buildEmail(values)]));
  } finally {
    await server.close();
  }
}

const bodies = await build();

// `-e AC_BODIES` with no `=` forwards the host value into the container, which is
// what `scripts/test-api.sh` does in the backend: a value on the spawn's `env`
// alone reaches the `docker` client and never the PHP process.
const raw = await run(
  "docker",
  ["compose", "run", "--rm", "-T", "-e", "AC_BODIES", "wpcli", "wp", "eval", PHP],
  {
    cwd: BACKEND,
    env: { ...process.env, AC_BODIES: Buffer.from(JSON.stringify(bodies)).toString("base64") },
  },
);

const sanitised = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));

let failures = 0;

for (const [name, body] of Object.entries(bodies)) {
  for (const part of ["html", "text"]) {
    const before = body[part];
    const after = sanitised[name][part];

    if (before === after) {
      process.stdout.write(`  \u001b[32mPASS\u001b[0m ${name}.${part}  ${before.length} bytes, unchanged\n`);
      continue;
    }

    failures += 1;
    process.stdout.write(`  \u001b[31mFAIL\u001b[0m ${name}.${part}\n`);
    process.stdout.write(`        sent     ${JSON.stringify(before)}\n`);
    process.stdout.write(`        returned ${JSON.stringify(after)}\n`);
  }
}

if (process.argv.includes("--write")) {
  // The fixture records what the **sanitiser** returned, never what the generator
  // sent — so a run that regenerates it after a real regression writes the damage
  // down instead of hiding it, and the diff is the failure.
  writeFileSync(
    FIXTURE,
    `${JSON.stringify({ cases: CASES, sanitised }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`\n  wrote ${FIXTURE}\n`);
} else {
  const stored = JSON.parse(readFileSync(FIXTURE, "utf8"));

  for (const [name, body] of Object.entries(sanitised)) {
    for (const part of ["html", "text"]) {
      if (stored.sanitised[name]?.[part] === body[part]) continue;
      failures += 1;
      process.stdout.write(`  \u001b[31mFAIL\u001b[0m ${name}.${part} differs from the checked-in fixture\n`);
    }
  }
}

process.stdout.write(`\n${failures === 0 ? "round trip clean" : `${failures} difference(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
