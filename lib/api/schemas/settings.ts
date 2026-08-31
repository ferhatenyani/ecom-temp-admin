import { z } from "zod";

/**
 * `GET/PATCH /settings`, measured against the live API on 2026-08-21.
 *
 * `looseObject` throughout, as everywhere else here: the API adds keys between
 * branches and a strict object turns an additive server change into a parse
 * failure on a screen that did not need the new field. That is not hypothetical
 * on this route — the document is **assembled** from whoever owns each value
 * rather than stored, so a WooCommerce upgrade can add a key to `store` without
 * anything in this plugin changing.
 */

/**
 * The store block, and **four of its eight keys are not writable**.
 *
 * `name`, `description`, `storefront_url` and `logo_id` take a PATCH; `locale`,
 * `currency`, `currency_symbol` and `logo` are refused from inside a block
 * ADMIN_PANEL.md calls writable. See `lib/settings.ts` for the probe.
 */
export const storeSettings = z.looseObject({
  name: z.string(),
  description: z.string(),
  /** WordPress's, `en_US` on this install. Read-only. */
  locale: z.string(),
  /**
   * **`/settings` does publish `store.currency`** (`DZD`), unlike the timezone,
   * which it does not publish at all — README carries that correction and
   * `SHOP_CURRENCY` is a constant because of it. Read-only here for the reason
   * the spec gives: WooCommerce records it per order, so changing it splits the
   * order book instead of converting it.
   */
  currency: z.string(),
  /** `د.ج`. Arabic, in a document the French locale also renders. */
  currency_symbol: z.string(),
  /**
   * **Empty on this install, and three things are broken while it is**: password
   * reset answers 503 `storefront_url_not_set`, tracking links carry no URL, and
   * the unsubscribe link points at the API's own domain. Rendered with that
   * consequence attached rather than as one more blank field.
   */
  storefront_url: z.string(),
  /** `0` when unset, never null. The writable half of the logo. */
  logo_id: z.number(),
  /**
   * The resolved attachment, or null. Read-only beside its own id — the same
   * pairing a banner's `image`/`image_id` has, and the reason the settings screen
   * shows the id rather than offering a picker: `MediaPicker` is
   * `ac_manage_content` and would be the only control on that screen able to 403
   * on its own.
   *
   * ## It was `z.unknown()` for eleven branches, and it is modelled now
   *
   * The old note said the shape "was never captured", which was true and is no
   * longer: `Settings\SettingsService::image()` is eight lines and returns exactly
   * three keys — `SettingsService.php:194-209`, read from source on
   * `feat/campaign-composer`.
   *
   *   `id`   the attachment id, the same number as `logo_id`
   *   `url`  `wp_get_attachment_url()`, so **already absolute** — nothing needs to
   *          call `/media/{id}` to resolve it. The host is this backend's
   *          WordPress URL and deliberately not `storefront_url`, which is a
   *          different value (`SettingsService.php:126-132`)
   *   `alt`  `_wp_attachment_image_alt`, `""` when the attachment has none
   *
   * **There is no `width`**, which the campaign composer's logo prefill has to
   * live with: `EmailImage.width` is `number | null` precisely for a source that
   * does not know one, and the generator uses it only to avoid upscaling.
   *
   * **Branch on `logo`, never on `logo_id`.** The two disagree in one real state:
   * an attachment deleted after being set leaves `logo_id` non-zero while
   * `wp_get_attachment_url()` answers nothing, and the service reports `null`
   * rather than a broken URL a storefront would render as a gap
   * (`SettingsService.php:199-201`).
   */
  logo: z
    .looseObject({ id: z.number(), url: z.string(), alt: z.string() })
    .nullable(),
});

export const contactSettings = z.looseObject({
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  /** A free-text wilaya name, not an id — this block is a storefront footer. */
  wilaya: z.string(),
  hours: z.string(),
});

/** The Algerian trade register. Every field a string, every one clearable. */
export const legalSettings = z.looseObject({
  registered_name: z.string(),
  rc: z.string(),
  nif: z.string(),
  nis: z.string(),
  ai: z.string(),
});

export const socialSettings = z.looseObject({
  facebook: z.string(),
  instagram: z.string(),
  tiktok: z.string(),
  youtube: z.string(),
});

/**
 * **Nine flags, four of which gate nothing yet.**
 *
 * `blog`, `reviews`, `sms` and `whatsapp` are reported as *declared* so nobody
 * has to grep `.env.example` to learn a flag exists. They are named in
 * `FLAGS_WITHOUT_PROVIDERS` and excluded from the flag-versus-registry
 * comparison, because pairing a flag with a registry it has no entry in would
 * invent a gap.
 *
 * `z.boolean()` per key rather than `z.record()`: the set is fixed by
 * `Config::FLAGS` on the backend and a tenth would be a change worth noticing.
 * `looseObject` still lets it arrive without failing the parse.
 */
export const featureFlags = z.looseObject({
  cod: z.boolean(),
  chargily: z.boolean(),
  yalidine: z.boolean(),
  zr_express: z.boolean(),
  marketing_pixels: z.boolean(),
  blog: z.boolean(),
  reviews: z.boolean(),
  sms: z.boolean(),
  whatsapp: z.boolean(),
});

/**
 * What actually registered, which follows from flags **and** credentials.
 *
 * ADMIN_PANEL.md's reason for rendering this is that it is the only place the
 * gap shows: a flag on with no key is a provider that never loaded, and nothing
 * else in the API reports it. Measured on this install the two agree —
 * `chargily` and `cod` are both flagged and both registered — so the gap is a
 * state the screen can render and this shop is not in, which is stated rather
 * than implied.
 */
export const providerRegistries = z.looseObject({
  payment: z.array(z.string()),
  shipping: z.array(z.string()),
  marketing: z.array(z.string()),
});

export const settings = z.looseObject({
  store: storeSettings,
  contact: contactSettings,
  legal: legalSettings,
  social: socialSettings,
  features: featureFlags,
  providers: providerRegistries,
});
export type Settings = z.infer<typeof settings>;

/**
 * **`PATCH` answers with the whole document, not the block it wrote.**
 *
 * Verified rather than assumed: a PATCH naming only `contact.phone` came back
 * with `store`, `legal`, `social`, `features` and `providers` all present. So
 * the form rebinds to the response and the two can never drift — which is safe
 * here for the same reason it was safe on a CMS page and unsafe on a coupon's
 * `date_expires`: every field round-trips in the format it was sent.
 */
export const settingsWriteResponse = settings;

/**
 * `details` on the empty-PATCH refusal, where `fields` is an **array**.
 *
 *   400 "No supported fields were provided."
 *   details.fields: ["store", "contact", "legal", "social"]
 *
 * Pinned as its own shape because every other refusal on this route keys
 * `fields` by block or by `block.key`, and `BrowserApiError.fields` returns
 * `null` for the array rather than putting `store,contact,legal,social` on
 * screen as though it were an explanation.
 */
export const settingsEmptyPatchDetails = z.looseObject({
  fields: z.array(z.string()),
});

/**
 * `details` on every other refusal, where `fields` is an object keyed by block
 * or by `block.key`.
 *
 *   {"store": "Unknown keys: zzz. Known: name, description, storefront_url, logo_id."}
 *   {"store.storefront_url": "Must be a URL, including https://."}
 *   {"contact.email": "Must be an email address."}
 *   {"features": "Feature flags are environment variables read once at bootstrap…"}
 */
export const settingsFieldDetails = z.looseObject({
  fields: z.record(z.string(), z.string()),
});
