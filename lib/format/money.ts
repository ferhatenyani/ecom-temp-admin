/**
 * Money is formatted, never computed.
 *
 * The API returns decimal strings and has already done the arithmetic; the
 * panel's job is to render `26350.00` as `26 350,00 DA`. No client-side
 * subtotalling, no estimated total, no tax calculation — a panel that computes
 * its own total will eventually disagree with the order, and the order is right.
 *
 * The string is never parsed for anything but display. `Number()` here is the
 * last step before `Intl`, and its result is not returned, stored or added to
 * anything.
 */

/**
 * Measured 2026-08-18. The locale tag decides whether this reads as the shop's
 * own currency or as an accounting code:
 *
 *   fr               → "26 350,00 DZD"     ← wrong, and what a bare `fr` gives
 *   fr-DZ            → "26 350,00 DA"      ← what the specification asks for
 *   ar-DZ-u-nu-latn  → "‏26.350,00 د.ج.‏"   ← Latin digits, Arabic symbol
 *
 * So the region subtag is not optional decoration; `fr` alone is a bug.
 */
const MONEY_LOCALE: Record<string, string> = {
  fr: "fr-DZ",
  ar: "ar-DZ-u-nu-latn",
};

/**
 * Western digits in both locales. Algeria uses `0123456789` in Arabic text;
 * Eastern Arabic numerals would be wrong here and unreadable to the staff using
 * this. Pinned with `-u-nu-latn` rather than left to the locale default.
 */
export function moneyLocale(locale: string): string {
  return MONEY_LOCALE[locale] ?? MONEY_LOCALE.fr;
}

const cache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const made = new Intl.NumberFormat(moneyLocale(locale), {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  cache.set(key, made);
  return made;
}

/**
 * `amount` is the API's decimal string. A value that is not a number renders as
 * an em dash rather than `NaN DA` — a malformed amount is a data problem, and
 * printing `NaN` next to a currency symbol invites someone to read it as zero.
 */
export function formatMoney(
  amount: string | null | undefined,
  currency: string,
  locale: string,
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return formatter(locale, currency).format(n);
}

/**
 * Three analytics figures are reported as unavailable rather than zero —
 * shipping cost, payment fees, margin. A zero that means "we cannot know" is a
 * number someone will put in a report, so the absence gets its own rendering and
 * never falls through to `formatMoney`.
 */
export const MONEY_UNAVAILABLE = Symbol("money-unavailable");
