/**
 * The arithmetic and the locale reading behind `components/ui/DatePicker.tsx`.
 *
 * Everything here is a pure function of a `Y-m-d` string and a locale, and it is
 * a module rather than three helpers inside the component for the reason the
 * design script's own history keeps giving: **a block that is only markup stays
 * in its screen; a block that owns decisions gets a file so the decisions have
 * somewhere to be argued.** This one owns four, and every one of them is a claim
 * about `Intl` that had to be measured rather than assumed. They are recorded at
 * their own sites below.
 *
 * ## Every date here is UTC, and that is the same decision `formatDay` made
 *
 * A calendar day is not an instant. `lib/format/date.ts` already splits the two
 * — `formatDate` reads a timestamp in the shop's zone, `formatDay` reads a bare
 * `Y-m-d` in UTC — because the analytics boundaries are days the server drew in
 * `+00:00` and re-reading them in `Africa/Algiers` renders a boundary the report
 * does not have. Everything in this file is the second kind: `date_from`,
 * `date_to`, `date_expires`, and the grid a person picks them from.
 *
 * Doing it any other way is not a rounding error, it is an off-by-one day. A
 * `new Date(2026, 2, 14)` on a host at UTC−5 is `2026-03-14T05:00:00Z`, and
 * `getUTCDate()` on it is still 14 — but the same construction near a DST
 * boundary is not, and `toISOString().slice(0, 10)` on a local-midnight date is
 * the classic way a calendar shows yesterday. So dates are built with
 * `Date.UTC` and read with `getUTC*`, with no local-time constructor anywhere in
 * the file.
 */

/** A `Y-m-d` string, or the empty string for "no date". */
export type Ymd = string;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The three fields of a numeric date, in the order the locale writes them.
 *
 * Read from `Intl.DateTimeFormat.formatToParts` rather than hard-coded, which is
 * the whole point of the control this serves — and measured, because the two
 * locales this panel ships happen to agree and a table written from one of them
 * would look correct forever:
 *
 *   fr-DZ   [{day "14"} {literal "/"} {month "03"} {literal "/"} {year "2026"}]
 *   ar-DZ   [{day "14"} {literal "‏/"} {month "03"} {literal "‏/"} {year "2026"}]
 *
 * Both are day-month-year. **That agreement is the finding, not a redundancy.**
 * The defect this control exists to fix was never a disagreement between French
 * and Arabic — it was that a native `<input type="date">` follows the *browser's*
 * locale, so both of them rendered the browser's `mm/dd/yyyy` and neither reader
 * got their own order.
 */
export type DateField = "day" | "month" | "year";

const ORDER_CACHE = new Map<string, DateField[]>();

/**
 * `fr-DZ` / `ar-DZ` rather than the bare `fr` / `ar`, matching
 * `lib/format/date.ts`'s `DATE_LOCALE` exactly — the region is what decides the
 * field order, and `fr` alone is not the same locale as the one every other date
 * on the screen is formatted in.
 *
 * `-u-nu-latn` on Arabic is carried across for the same reason it exists there:
 * Algeria writes Latin digits, and a field a person types digits into must show
 * back the digits they typed.
 *
 * No `-u-hc-h23` on French: that subtag fixes an *hour cycle* and nothing here
 * has an hour in it.
 */
const ENTRY_LOCALE: Record<string, string> = {
  fr: "fr-DZ",
  ar: "ar-DZ-u-nu-latn",
};

function intlLocale(locale: string): string {
  return ENTRY_LOCALE[locale] ?? ENTRY_LOCALE.fr;
}

export function fieldOrder(locale: string): DateField[] {
  const key = intlLocale(locale);
  const hit = ORDER_CACHE.get(key);
  if (hit) return hit;

  const parts = new Intl.DateTimeFormat(key, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).formatToParts(new Date(Date.UTC(2026, 2, 14)));

  const order = parts
    .map((part) => part.type)
    .filter((type): type is DateField => type === "day" || type === "month" || type === "year");

  /* A locale that somehow yielded fewer than three fields would produce a
     pattern nobody can type into. Falling back to the measured order is better
     than rendering a two-field date, and it cannot happen for `fr-DZ`/`ar-DZ`. */
  const settled: DateField[] = order.length === 3 ? order : ["day", "month", "year"];
  ORDER_CACHE.set(key, settled);
  return settled;
}

/**
 * The first column of the calendar grid, as `Date.getUTCDay()` numbers it —
 * 0 Sunday … 6 Saturday.
 *
 * **Measured, and it is neither of the two the brief expected.** The step this
 * was built for said "Sunday/Monday week start … from the locale"; CLDR's answer
 * for both `fr-DZ` and `ar-DZ` is `{ firstDay: 6, weekend: [5, 6] }` — **Saturday**,
 * with Friday and Saturday as the weekend. That is Algeria's week, it is the
 * same for both languages, and it is the reason this is read rather than typed:
 * a hand-written `Sunday for French, Monday for Arabic` would have been wrong
 * twice.
 *
 * `getWeekInfo()` is the current spelling and `weekInfo` was the getter that
 * shipped first; both are tried because the panel supports two engines and the
 * proposal changed shape between them. The literal fallback is Algeria's
 * measured value rather than a neutral Monday, because the only two locales this
 * panel has are both `-DZ` — if a third arrives, it arrives with a locale that
 * answers.
 */
export function firstWeekday(locale: string): number {
  type WeekInfo = { firstDay: number };
  type MaybeWeekInfo = Intl.Locale & {
    getWeekInfo?: () => WeekInfo;
    weekInfo?: WeekInfo;
  };

  try {
    const resolved = new Intl.Locale(intlLocale(locale).split("-u-")[0]) as MaybeWeekInfo;
    const info = resolved.getWeekInfo?.() ?? resolved.weekInfo;
    /* CLDR numbers 1 Monday … 7 Sunday; `getUTCDay()` numbers 0 Sunday … 6
       Saturday. `% 7` is the whole conversion: 7 → 0, and 1..6 are unchanged. */
    if (info && Number.isInteger(info.firstDay)) return info.firstDay % 7;
  } catch {
    /* An engine with no `Intl.Locale` at all, which is not one this panel ships
       to — but a calendar that throws is worse than a calendar that starts on
       the measured day. */
  }
  return 6;
}

/* ------------------------------------------------------------- arithmetic --- */

/** `Y-m-d` → the three numbers, or `null` if it is not a real calendar day. */
export function readYmd(value: string): { year: number; month: number; day: number } | null {
  const match = YMD.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return makeYmd(year, month, day) === value ? { year, month, day } : null;
}

/**
 * The three numbers → `Y-m-d`, or `""` if they are not a real day.
 *
 * The round trip through `Date.UTC` is the validation: it *normalises* rather
 * than refusing, so 31 February becomes 3 March, and comparing the result back
 * against what was asked is what turns that into a refusal. A person who typed
 * `31/02/2026` meant something, and it was not the third of March.
 *
 * **`setUTCFullYear` for a two-digit year, and it is a real trap rather than
 * pedantry.** `Date.UTC(26, 2, 14)` is not the year 26 — the argument is mapped
 * to `1900 + year` for anything from 0 to 99, which is ECMA-262's legacy
 * two-digit rule. Without the correction the round trip below would see 1926
 * against the 26 it was asked for, refuse it, and the *reason* printed on screen
 * would be "that is not a date" for a date that is one. Reached only through
 * `parseEntry`'s three-digit `026`; the two-digit case is refused a layer up so
 * that `26` never has to mean either 1926 or 2026.
 */
export function makeYmd(year: number, month: number, day: number): Ymd {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return "";

  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 100) date.setUTCFullYear(year);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return toYmd(date);
}

/** A `Date` → `Y-m-d`, read in UTC. See the file's header for why. */
export function toYmd(date: Date): Ymd {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `Y-m-d` → a UTC `Date` at midnight, or `null`. */
export function toDate(value: Ymd): Date | null {
  const parts = readYmd(value);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/** Today, as the reader's own machine has it. Injectable so the suite has a clock. */
export function todayYmd(now: Date = new Date()): Ymd {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(now.getDate()).padStart(2, "0")}`;
}

/** `days` later (or earlier). `""` in, `""` out. */
export function shiftDays(value: Ymd, days: number): Ymd {
  const date = toDate(value);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return toYmd(date);
}

/**
 * `months` later (or earlier), **clamped to the end of the shorter month**.
 *
 * `setUTCMonth` alone rolls over — 31 January plus one month is 3 March, which
 * is how a "next month" button on a calendar showing January silently skips
 * February. The day is set to 1 first and restored afterwards against the real
 * length of the destination month.
 */
export function shiftMonths(value: Ymd, months: number): Ymd {
  const parts = readYmd(value);
  if (!parts) return "";

  const target = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return makeYmd(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(parts.day, lastDay));
}

/* --------------------------------------------------------------- the grid --- */

/**
 * Six rows of seven days, always — the whole month plus the leading and trailing
 * days that fill its first and last weeks.
 *
 * **Six rows rather than the five most months need**, and it is a layout decision
 * rather than an arithmetic one: a popover that changes height as a person pages
 * through months moves the button they are aiming at, and at the 340px floor it
 * moves the whole grid under the pointer. 6 × 7 = 42 covers the worst case (a
 * 31-day month starting on the last column) with no branch.
 *
 * Every cell is a real day — there are no `null` holes — so the arrow keys walk
 * off the end of a month into the next one the way `<input type="date">`'s own
 * arrows did, and the caller decides which of them to draw as belonging to the
 * displayed month.
 */
export function monthGrid(month: Ymd, firstDay: number): Ymd[][] {
  const parts = readYmd(month);
  if (!parts) return [];

  const first = new Date(Date.UTC(parts.year, parts.month - 1, 1));
  /* How far back the grid starts: the distance from the locale's first column to
     the weekday the 1st actually falls on, never negative. */
  const lead = (first.getUTCDay() - firstDay + 7) % 7;

  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - lead);

  const rows: Ymd[][] = [];
  for (let row = 0; row < 6; row += 1) {
    const week: Ymd[] = [];
    for (let column = 0; column < 7; column += 1) {
      week.push(toYmd(start));
      start.setUTCDate(start.getUTCDate() + 1);
    }
    rows.push(week);
  }
  return rows;
}

/** Whether two `Y-m-d` fall in the same calendar month. */
export function sameMonth(a: Ymd, b: Ymd): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * Whether a day is inside `[min, max]`, either end optional.
 *
 * A plain string comparison, which is exactly right for `Y-m-d` and is why the
 * wire format is worth keeping: the format is big-endian and zero-padded, so
 * lexicographic order *is* chronological order and no parsing is involved.
 */
export function withinRange(value: Ymd, min?: string, max?: string): boolean {
  if (min && value < min) return false;
  if (max && value > max) return false;
  return true;
}

/* ---------------------------------------------------- reading and writing --- */

/**
 * `Y-m-d` → what the field shows, in the reader's own field order.
 *
 * **The separator is an ASCII `/` and the locale's own is not, deliberately.**
 * `ar-DZ` writes its literal as `‏/` — U+200F RIGHT-TO-LEFT MARK, then the slash
 * (measured; see `fieldOrder` above for the parts dump). A person cannot type
 * U+200F, so a field that rendered the locale's literal would print a value it
 * would then refuse when the same value was typed back into it. The *order* is
 * the locale's, which is the whole of the defect being fixed; the separator is
 * the one both locales can accept from a keyboard.
 *
 * The digits are Latin in both languages, which is not a compromise either:
 * `lib/format/date.ts` already pins `ar-DZ-u-nu-latn` for every date in the
 * panel, because Algeria writes Latin digits.
 */
export function formatEntry(value: Ymd, locale: string): string {
  const parts = readYmd(value);
  if (!parts) return "";

  const text: Record<DateField, string> = {
    day: String(parts.day).padStart(2, "0"),
    month: String(parts.month).padStart(2, "0"),
    year: String(parts.year).padStart(4, "0"),
  };
  return fieldOrder(locale)
    .map((field) => text[field])
    .join("/");
}

/**
 * What the field shows → `Y-m-d`, or `null` for "this is not a date".
 *
 * Three properties, each of which is a decision:
 *
 * **Any run of non-digits separates.** `14/03/2026`, `14-03-2026`, `14.03.2026`
 * and `14 03 2026` all parse. A field that accepted only the separator it prints
 * refuses a value pasted out of a spreadsheet, and there is nothing ambiguous
 * about the alternatives. It also means the Arabic literal's U+200F is skipped
 * on the way in, so a value copied *out of this panel* pastes back into it.
 *
 * **A leading four-digit run is read as ISO**, whatever the locale's order says.
 * `2026-03-14` is the wire format, it is what an API response and half the
 * panel's own URLs carry, and no locale on earth writes a four-digit day. This
 * is the one place the locale's order is deliberately overruled, because the
 * alternative is refusing the format the value is stored in.
 *
 * **The empty string is a value, not a failure.** Every filter in the panel
 * offers "no date" and `date_expires` means "never" — so `""` returns `""` and
 * only a non-empty string that is not a date returns `null`.
 */
export function parseEntry(text: string, locale: string): Ymd | null {
  const trimmed = text.trim();
  if (trimmed === "") return "";

  const numbers = trimmed.split(/\D+/).filter((part) => part !== "");
  if (numbers.length !== 3) return null;
  if (numbers.some((part) => part.length > 4)) return null;

  const order: DateField[] = numbers[0].length === 4 ? ["year", "month", "day"] : fieldOrder(locale);

  const read: Partial<Record<DateField, number>> = {};
  order.forEach((field, index) => {
    read[field] = Number(numbers[index]);
  });

  const { year, month, day } = read;
  if (year === undefined || month === undefined || day === undefined) return null;
  /* A two- or one-digit year is refused rather than guessed. `26` is 1926 as
     easily as 2026, and a wrong date that saves silently is worse than one the
     field asks about — `date_expires` is the caller where that matters, because
     the API takes whatever year it is sent and the coupon simply stops working.
     Checked against the *token* rather than the number, so `026` is a year and
     `26` is a refusal. */
  if (numbers[order.indexOf("year")].length < 3) return null;

  const settled = makeYmd(year, month, day);
  return settled === "" ? null : settled;
}
