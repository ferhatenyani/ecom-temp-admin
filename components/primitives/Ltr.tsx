/**
 * Bidi isolation for identifiers.
 *
 * A tracking number, SKU, phone number or order id inside Arabic text needs its
 * own direction and `unicode-bidi: isolate`, or the bidi algorithm reorders it
 * and a customer reads back a number that does not exist. This is the single most
 * common bug in bilingual admin tools and it is silent — nothing errors, the
 * number is just wrong on screen.
 *
 * Use it for every identifier. Numbers never mirror, in any locale.
 */
export function Ltr({
  children,
  className,
  numeric = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Tabular figures, for anything that appears in a column. */
  numeric?: boolean;
}) {
  return (
    <span
      dir="ltr"
      className={className}
      style={{ unicodeBidi: "isolate" }}
      {...(numeric ? { "data-numeric": "" } : {})}
    >
      {children}
    </span>
  );
}

/**
 * Isolate **without** forcing a direction — for text a formatter has already
 * directionally annotated. In practice: dates.
 *
 * `Ltr` is for an *identifier*, where the digits must not reorder no matter what
 * surrounds them. A formatted date is not an identifier, and wrapping one in
 * `Ltr` actively breaks it.
 *
 * Measured 2026-08-18 on the Arabic movements ledger, by reading the rendered
 * text rather than the markup. `Intl.DateTimeFormat("ar-DZ-u-nu-latn")` produces
 *
 *   17‏/08‏/2026، 12:07 ص
 *   31 37 200f 2f 30 38 200f 2f 32 30 32 36 60c 20 31 32 3a 30 37 20 635
 *
 * — Latin digits, U+060C ARABIC COMMA, U+0635 for ص, and **two U+200F RIGHT-TO-LEFT
 * MARKs** that ICU inserts on purpose so the bidi algorithm lays the components
 * out right to left. Forcing `dir="ltr"` over that turns those marks into RTL
 * runs inside an LTR paragraph, and the date renders as `17ص 12:03 .2026/08/`.
 * Nothing errors; the date is simply wrong, which is the same silent failure
 * `Ltr` exists to prevent, arrived at from the opposite side.
 *
 * `dir="auto"` resolves the direction from the string's own first strong
 * character — the RLM in Arabic, the digits and letters in French — and
 * `unicode-bidi: isolate` still keeps it from disturbing, or being disturbed by,
 * the text around it. Both locales are then laid out the way their own formatter
 * intended.
 *
 * The rule, in one line: **`Ltr` for something the shop assigned, `Isolate` for
 * something `Intl` formatted.**
 *
 * ## A third case, found on the customers branch: a translated sentence
 *
 * `t("count", { total })` produces `"16 clients"` in French and `"16 عميلًا"` in
 * Arabic. Sixteen call sites across five screens wrapped one of these in `Ltr`,
 * reaching for the tabular figures `numeric` gives — and took the forced
 * direction along with them.
 *
 * Measured on the Arabic customers list: the count line computed
 * `direction: ltr`, so an Arabic sentence was laid out beginning at the *left*.
 * An Arabic reader starts at the right, so the number they read first was the one
 * furthest from where they start. French was unaffected, which is why it survived
 * three branches — the locale nobody was looking at was the only one wrong.
 *
 * `t("usageOf", { count, limit })` was the same defect with the numerals swapped:
 * `"0 من 50"` forced to LTR rendered `0` and `50` on either side of a preposition
 * pointing the wrong way.
 *
 * **A pluralised UI string is neither an identifier nor a formatted value.** It is
 * prose in the page's own language, and `Isolate` is right for it: `dir="auto"`
 * resolves from the first strong character — the translated word, since a digit is
 * not strong — so French resolves LTR and Arabic RTL, each the way its own
 * sentence is read. `numeric` still gives the tabular figures.
 *
 * So: **`Ltr` only for a bare identifier.** The moment a translated word shares
 * the element, it is `Isolate`.
 */
export function Isolate({
  children,
  className,
  numeric = true,
}: {
  children: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <span
      dir="auto"
      className={className}
      style={{ unicodeBidi: "isolate" }}
      {...(numeric ? { "data-numeric": "" } : {})}
    >
      {children}
    </span>
  );
}
