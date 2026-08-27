/**
 * Dates render in the shop's timezone, not the browser's — otherwise a manager
 * in France sees yesterday's orders dated today.
 *
 * docs/ADMIN_PANEL.md Part IV says the panel reads that timezone from
 * `/settings`. It cannot: measured 2026-08-18, `GET /settings` returns
 * `store, contact, legal, social, features, providers` and the whole 630-byte
 * response contains no `timezone` key under any block. So it is panel
 * configuration, defaulting to Africa/Algiers, and the spec carries a correction.
 */
export const SHOP_TIMEZONE = process.env.NEXT_PUBLIC_SHOP_TIMEZONE ?? "Africa/Algiers";

const DATE_LOCALE: Record<string, string> = {
  fr: "fr-DZ",
  ar: "ar-DZ-u-nu-latn",
};

function intlLocale(locale: string): string {
  return DATE_LOCALE[locale] ?? DATE_LOCALE.fr;
}

/**
 * The API sends **three** different timestamp formats, and only one of them is
 * safe to hand to `new Date()`.
 *
 *   order.date_created  "2026-08-18T02:52:22+00:00"   ISO 8601, has an offset
 *   note.created_at     "2026-08-18 02:52:22"         no offset, no `T`
 *   media.date_created  "2026-08-18T02:52:22"         no offset, **with** a `T`
 *
 * Measured: `new Date("2026-08-18 02:52:22")` is parsed as **local** time, which
 * on a UTC+2 machine silently reports 00:52 UTC — every order note off by the
 * host's offset, with nothing to show that it happened. An offsetless stamp is
 * therefore read as UTC explicitly, which is what the API means by it: the
 * install's `wp_timezone_string()` is `+00:00`.
 *
 * **The third was added on the media branch and needed no code change**, which
 * is worth saying rather than leaving to be re-derived: `MediaPresenter` uses
 * `mysql_to_rfc3339()`, which despite the name emits `Y-m-d\TH:i:s` with no zone
 * at all, on `date_created` and `date_modified` alike. The test below is for a
 * *zone*, not for the separator, so it already answered `false` for that shape
 * and the `Z` was already being appended. Verified against the media library in
 * a browser, not reasoned about: the same instant renders identically whether it
 * arrives with the offset or without it. `new Date()` on the third would shift
 * by the host's offset exactly as it does on the second — the trap is the same
 * one wearing a `T`.
 */
export function parseApiDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const normalised = hasZone ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

const absoluteCache = new Map<string, Intl.DateTimeFormat>();

function absoluteFormatter(locale: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${locale}:${withTime}`;
  const hit = absoluteCache.get(key);
  if (hit) return hit;
  const made = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: SHOP_TIMEZONE,
  });
  absoluteCache.set(key, made);
  return made;
}

export function formatDate(
  value: string | null | undefined,
  locale: string,
  withTime = true,
): string {
  const date = parseApiDate(value);
  if (!date) return "—";
  return absoluteFormatter(locale, withTime).format(date);
}

const dayCache = new Map<string, Intl.DateTimeFormat>();

/**
 * A calendar day from a bare `Y-m-d`, formatted in **UTC** rather than the shop's
 * timezone — and the difference is not pedantry.
 *
 * The analytics range boundaries are days, not instants: `/analytics/overview`
 * answers `{from: "2026-07-23", to: "2026-08-21", timezone: "+00:00"}`, and that
 * `timezone` is the clock the server drew the boundaries with. It is **not**
 * `Africa/Algiers`. Re-reading those days in the shop's zone would render a
 * boundary the report does not have, and at UTC−something it would render the
 * wrong day outright.
 *
 * `formatDate` is for a timestamp — an order's `date_created`, a movement — which
 * *is* an instant and does belong in the shop's zone. Two different questions,
 * two formatters.
 *
 * The Arabic output carries U+200F marks (`23‏/07‏/2026`), so a caller wraps it in
 * `Isolate` and never in `Ltr` — see `components/primitives/Ltr.tsx`.
 */
export function formatDay(value: string | null | undefined, locale: string): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";

  const key = intlLocale(locale);
  let made = dayCache.get(key);
  if (!made) {
    made = new Intl.DateTimeFormat(key, { dateStyle: "medium", timeZone: "UTC" });
    dayCache.set(key, made);
  }
  return made.format(date);
}

/**
 * Relative time under 24 hours, absolute after. `now` is injectable so the unit
 * suite is not a hostage to the clock.
 */
export function formatWhen(
  value: string | null | undefined,
  locale: string,
  now: Date = new Date(),
): string {
  const date = parseApiDate(value);
  if (!date) return "—";
  const seconds = (date.getTime() - now.getTime()) / 1000;
  if (Math.abs(seconds) >= 86400) return formatDate(value, locale);

  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  return rtf.format(Math.round(seconds / 3600), "hour");
}
