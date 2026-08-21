/**
 * The settings document's vocabulary, and the four facts that decide how the
 * form is built.
 *
 * No dependencies, so a client component can import a value from here without
 * pulling Zod into the browser — the split `lib/notifications.ts` and
 * `lib/campaigns.ts` already make. `lib/api/schemas/settings.ts` imports this,
 * never the reverse.
 *
 * Measured against the live API on 2026-08-21, and the measurements are in the
 * comments rather than in a changelog because the comment is what somebody reads
 * before changing the value under it.
 */

/* ---------------------------------------------------------------- blocks --- */

/**
 * Six blocks. Four take a `PATCH` and two are reports.
 *
 *   GET /settings → store contact legal social features providers
 *   PATCH {}      → 400 "No supported fields were provided."
 *                   details.fields: ["store","contact","legal","social"]
 *
 * The refused two answer **by name with the reason**, which is what the screen
 * renders rather than a grey field with nothing beside it:
 *
 *   features   "Feature flags are environment variables read once at bootstrap
 *               (ENABLE_COD, ENABLE_CHARGILY, …). Set them in .env and restart,
 *               or the registry and this document disagree."
 *   providers  "Read-only: this reports which providers actually registered,
 *               which follows from their credentials and flags."
 */
export const WRITABLE_BLOCKS = ["store", "contact", "legal", "social"] as const;
export type WritableBlock = (typeof WRITABLE_BLOCKS)[number];

export const READ_ONLY_BLOCKS = ["features", "providers"] as const;
export type ReadOnlyBlock = (typeof READ_ONLY_BLOCKS)[number];

export function isWritableBlock(value: string): value is WritableBlock {
  return (WRITABLE_BLOCKS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ keys --- */

/**
 * **A writable block is not wholly writable, and ADMIN_PANEL.md does not say
 * so.** The spec lists four writable blocks and puts only `currency` in its
 * read-only table; measured, `store` publishes eight keys and accepts four.
 *
 *   PATCH {"store": {"zzz": "1"}}
 *   → 400 details.fields.store:
 *       "Unknown keys: zzz. Known: name, description, storefront_url, logo_id."
 *
 * The same probe on each block gives the four lists below verbatim. `locale`,
 * `currency`, `currency_symbol` and `logo` are published by `GET` and refused by
 * `PATCH` **from inside a block the spec calls writable**, so a form that bound
 * every key it read would send four fields the API names back at it.
 *
 * `logo_id` is the writable half of the logo and `logo` is the resolved
 * attachment beside it — the same id-and-resolved-object pairing a banner has.
 * The panel does not offer a picker for it on this branch; see the note in
 * `SettingsForm`.
 */
export const WRITABLE_KEYS: Record<WritableBlock, readonly string[]> = {
  store: ["name", "description", "storefront_url", "logo_id"],
  contact: ["email", "phone", "address", "wilaya", "hours"],
  legal: ["registered_name", "rc", "nif", "nis", "ai"],
  social: ["facebook", "instagram", "tiktok", "youtube"],
};

/**
 * The keys the form actually edits, which is `WRITABLE_KEYS` minus `logo_id`.
 *
 * Every one of these is a free-text string. `logo_id` is an attachment id and
 * needs `MediaPicker`, which is `ac_manage_content` — a capability the Super
 * Admin holding `ac_manage_settings` does happen to have today, but the control
 * would be the only thing on this screen that could 403 on its own. It is left
 * off with its reason rather than shipped as a number box, and the read-only row
 * shows what is set.
 */
export const EDITED_KEYS: Record<WritableBlock, readonly string[]> = {
  store: ["name", "description", "storefront_url"],
  contact: WRITABLE_KEYS.contact,
  legal: WRITABLE_KEYS.legal,
  social: WRITABLE_KEYS.social,
};

/**
 * Read by `GET`, refused by `PATCH`, and sitting inside a writable block.
 *
 * Rendered as read-only rows with their reason, in the block they belong to
 * rather than in a separate "you cannot change these" list: `currency` is a fact
 * about the store and belongs beside the store's name.
 */
export const READ_ONLY_STORE_KEYS = ["locale", "currency", "currency_symbol"] as const;

/* ----------------------------------------------------------- error shapes --- */

/**
 * **`details.fields` arrives as an array on exactly one refusal**, and every
 * form in this panel binds to it as an object.
 *
 *   PATCH {}                    details.fields: ["store","contact","legal","social"]
 *   PATCH {"store":{"zzz":1}}   details.fields: {"store": "Unknown keys: …"}
 *   PATCH {"contact":{"email":"nope"}}
 *                               details.fields: {"contact.email": "Must be an email address."}
 *
 * `BrowserApiError.fields` already returns `null` for an array rather than
 * mis-rendering it — verified in `tests/admin-schema.test.ts` against the
 * captured payload rather than assumed from reading the getter — so the empty
 * PATCH falls through to the top-level message, which is the sentence a reader
 * needs: *"No supported fields were provided."*
 *
 * The panel never sends that request anyway: `changedBlocks()` returns nothing
 * when nothing is dirty and the save bar does not appear. The refusal is pinned
 * because it is the shape a *future* caller meets, and because the array is the
 * one thing that would put `store,contact,legal,social` on screen as though it
 * were an explanation.
 */

/**
 * The key a field's error arrives under.
 *
 * Two levels, and the dot is the API's rather than `next-intl`'s: a bad value is
 * keyed `block.key` (`store.storefront_url`), while a whole-block complaint —
 * an unknown key, or a refused read-only block — is keyed by the block alone.
 * A form that looked only at `key` would render neither.
 */
export function fieldErrorFor(
  fields: Record<string, string> | null,
  block: string,
  key: string,
): string | undefined {
  return fields?.[`${block}.${key}`];
}

export function blockErrorFor(
  fields: Record<string, string> | null,
  block: string,
): string | undefined {
  return fields?.[block];
}

/* -------------------------------------------------------------- the diff --- */

export type SettingsDraft = Record<WritableBlock, Record<string, string>>;

/**
 * Only what changed, block by block.
 *
 * A partial write updates only what it names and `""` clears a field, so sending
 * the whole document back would be correct and would also make every save look
 * like a change to every field in the audit trail — `settings.updated` records
 * `{blocks, fields}` and nothing else, so the trail is only as useful as what
 * the panel chooses to send.
 *
 * Measured: `PATCH {"contact":{"phone":"+213 …"}}` audits
 * `{blocks: ["contact"], fields: ["contact.phone"]}`. One field, named.
 */
export function changedBlocks(
  draft: SettingsDraft,
  original: SettingsDraft,
): Partial<Record<WritableBlock, Record<string, string>>> {
  const payload: Partial<Record<WritableBlock, Record<string, string>>> = {};

  for (const block of WRITABLE_BLOCKS) {
    const changed: Record<string, string> = {};

    for (const key of EDITED_KEYS[block]) {
      if ((draft[block][key] ?? "") !== (original[block][key] ?? "")) {
        changed[key] = draft[block][key] ?? "";
      }
    }

    if (Object.keys(changed).length > 0) payload[block] = changed;
  }

  return payload;
}

export function isDirty(draft: SettingsDraft, original: SettingsDraft): boolean {
  return Object.keys(changedBlocks(draft, original)).length > 0;
}

/* ------------------------------------------------------- the storefront URL --- */

/**
 * **`store.storefront_url` is empty on this install, and three things are broken
 * while it is.** ADMIN_PANEL.md asks for it to be rendered "with that
 * consequence attached", and this is the list, so the sentence beside the field
 * is generated from a fact rather than written twice.
 *
 * Password reset answers 503 `storefront_url_not_set`; a tracking link carries no
 * URL; an unsubscribe link points at the API's own domain instead of the shop's.
 * All three are §85 and §86 behaviours, not guesses.
 */
export function storefrontConsequences(url: string): boolean {
  return url.trim() === "";
}

/* ------------------------------------------------------------- providers --- */

/**
 * A flag that is on with no provider behind it.
 *
 * `features` says what the environment asked for and `providers` says what
 * actually registered, and ADMIN_PANEL.md's own reason for rendering the second
 * is that **this is the only place the gap shows**: a flag on with no credential
 * is a provider that never loaded, and nothing else in the API reports it.
 *
 * Measured on this install: `features.chargily` is true and `providers.payment`
 * contains `chargily`, so the pair agree; `yalidine` and `zr_express` are both
 * false and absent, which also agrees. The interesting case is the third, and it
 * is reachable by setting a flag without a key.
 *
 * The four flags that gate nothing yet — `blog`, `reviews`, `sms`, `whatsapp` —
 * are excluded by name rather than by a heuristic. They are reported as declared
 * so nobody has to grep `.env.example` to learn a flag exists, and pairing them
 * with a registry they have no entry in would invent a gap.
 */
export const FLAGS_WITHOUT_PROVIDERS = ["blog", "reviews", "sms", "whatsapp"] as const;

const FLAG_REGISTRY: Record<string, "payment" | "shipping" | "marketing"> = {
  cod: "payment",
  chargily: "payment",
  yalidine: "shipping",
  zr_express: "shipping",
  marketing_pixels: "marketing",
};

export function flagWithoutProvider(
  flag: string,
  enabled: boolean,
  providers: { payment: string[]; shipping: string[]; marketing: string[] },
): boolean {
  if (!enabled) return false;

  const registry = FLAG_REGISTRY[flag];
  if (registry === undefined) return false;

  // `marketing_pixels` has no registry entry of its own — the marketing list is
  // pixel providers, so an enabled flag with an empty list is the gap.
  const name = flag === "marketing_pixels" ? null : flag;
  const list = providers[registry] ?? [];

  return name === null ? list.length === 0 : !list.includes(name);
}
