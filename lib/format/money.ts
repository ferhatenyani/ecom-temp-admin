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

/**
 * The shop's currency, for the figures that do not carry one.
 *
 * An **order** carries `currency` and is always formatted with its own — an order
 * placed under a different currency must not be re-denominated by a later
 * setting. A **product** does not, and the products list reads it from
 * `meta.facets.price.currency`. A customer's `statistics` block carries neither:
 * `total_revenue` and `average_order_value` are bare decimal strings.
 *
 * So there has to be a shop-level default, and it was already being written as a
 * `"DZD"` literal in two components before this was the third. Named here with
 * what is actually known about it.
 *
 * **`/settings` does publish it** — measured 2026-08-19, `store.currency: "DZD"`
 * and `store.currency_symbol: "د.ج"`, which is a better source than a constant
 * and unlike the timezone is genuinely there. It is not read yet because
 * `/settings` is on no screen's route list and the proxy allowlist grows one
 * screen at a time; putting a route behind the proxy for a fallback that is
 * correct today would be the wrong order to do it in. When a screen needs
 * `/settings` for its own sake, this becomes its fallback rather than its source.
 */
export const SHOP_CURRENCY = "DZD";

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

const percentCache = new Map<string, Intl.NumberFormat>();

/**
 * A percentage discount, formatted rather than concatenated.
 *
 * The API sends `"10.00"`, and `` `${amount} %` `` put **`10.00 %`** on the French
 * coupon list — a raw `.` where French writes `,`, and two decimals nobody
 * writes on a discount. Measured on the rendered row, which is the only place a
 * template literal like that ever looks wrong.
 *
 * `maximumFractionDigits: 2` keeps a genuine `12.5 %` intact while dropping the
 * trailing zeros on the whole numbers every coupon in this shop actually uses.
 * The locale tag is `moneyLocale`'s, so the digits stay Western in Arabic for the
 * same reason money does — and `style: "percent"` places the sign where each
 * locale puts it rather than gluing it to the end.
 */
export function formatPercent(amount: string | null | undefined, locale: string): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";

  const tag = moneyLocale(locale);
  let made = percentCache.get(tag);

  if (!made) {
    made = new Intl.NumberFormat(tag, {
      style: "percent",
      maximumFractionDigits: 2,
    });
    percentCache.set(tag, made);
  }

  // `style: "percent"` multiplies by 100, and the API's `"10.00"` already means
  // ten percent rather than ten thousand.
  return made.format(n / 100);
}

/**
 * Three analytics figures are reported as unavailable rather than zero —
 * shipping cost, payment fees, margin. A zero that means "we cannot know" is a
 * number someone will put in a report, so the absence gets its own rendering and
 * never falls through to `formatMoney`.
 */
export const MONEY_UNAVAILABLE = Symbol("money-unavailable");
