"use client";

import { useTranslations } from "next-intl";
import type { Wilaya } from "@/lib/api/schemas/order";
import { countryName, countryOptions, isCountryShape } from "@/lib/countries";
import { Select, TextField } from "@/components/ui/Form";
import type { ListboxOption } from "@/components/ui/Listbox";
import { ADDRESS_KEYS, type AddressDraft } from "./new-order";

/**
 * One address block — eleven controls, rendered by every form in the panel that
 * writes an order address.
 *
 * ## Why it is a file rather than a function inside the create drawer
 *
 * It was one: `NewOrderDrawer` declared it locally, and its own docblock already
 * made the argument for sharing it — "billing and shipping differ by exactly one
 * field and a `prefix`, and two hand-maintained copies of eleven controls drift
 * by the third branch". The order **edit** drawer is the second form to need the
 * same eleven, so the copy the docblock warned about is the one this file exists
 * to not write. Nothing about the controls changed on the way out; what moved
 * with them is the wilaya picker's option list and the strings, which were
 * `orders.create.address.*` and are now `orders.address.*` because they belong
 * to neither form in particular.
 *
 * ## `country` is a picker now, and the paragraph it replaces is kept below
 *
 * The API wants an ISO 3166-1 alpha-2 code, upper-cases what it is given, and
 * refuses a country *name* with a message that names `DZ` outright — so that
 * refusal is legible and this file used to lean on it entirely. **It is not
 * enough, and the measurement says so.** `Commerce\AddressInput::validateCountry()`
 * is `preg_match('/^[A-Z]{2}$/')` and nothing more: membership means
 * `WC()->countries`, which is WordPress, and that class is deliberately pure. So
 * `ZZ` is **accepted, 200** — measured in-process via `rest_do_request()` on
 * `PATCH /orders/{id}`, recorded in BLOCKED.md — and the shop stores a country
 * that does not exist.
 *
 * That much is unchanged. What this file used to conclude from it was:
 *
 * > *"The panel cannot close that hole and must not pretend to. A picker would
 * > need a 249-row country table nobody here has measured, and `docs/API.md` and
 * > `lib/api/schemas` are built on what the API returns rather than on a list
 * > typed from memory. What it can do is the two honest things:*
 * >
 * > *the rule — the same shape check, run locally, so the mistake that actually
 * > happens (a country name) is caught before a round trip rather than after
 * > one.*
 * >
 * > *the hint — says the code is stored as typed and is not checked against a
 * > list of real countries. A form that implied otherwise would be claiming a
 * > guarantee no layer in this stack provides."*
 *
 * **Overturned, and quoted rather than deleted**, the way `new-order.ts`'s
 * destination block and `ShipmentSubscriber::destinationOf()` handle their own
 * retired paragraphs: a reader who remembers the old rule deserves to know it
 * was reversed on purpose rather than forgotten.
 *
 * Not one of its premises was wrong. The unstated one was: **that a form without
 * a list has no list.** It has one — it is in the operator's head, it is 249 rows
 * long, it is unversioned, and it is differently wrong on every shift. A back
 * office typing `AL` for *Algérie* stores Albania's code, which no courier will
 * route, which nothing in this stack objects to, and which the person who typed
 * it is never told about. Between a table the panel is answerable for and a
 * table nobody can see, the honest choice is the one that can be read, diffed
 * and tested.
 *
 * So the table is written down, and what the old paragraph correctly demanded is
 * what `lib/countries.ts` spends its docblock on: it is **generated and
 * recorded, not typed from memory** — ICU's own region names, minus 31 named
 * non-countries, collated per locale at authoring time. Why it is a committed
 * table rather than a runtime `Intl.DisplayNames` call is argued there, in three
 * counts, of which the Arabic one is the sharpest.
 *
 * ## The shape rule stays, doing a different job
 *
 * Nobody can type a country any more, so the local `^[A-Za-z]{2}$` check can no
 * longer catch an operator writing `Algeria`. It is kept because **a stored
 * order may already carry anything**: `ZZ`, which this API's shape-only rule
 * accepts with a 200, or a country *name* written by wp-admin, by the storefront,
 * or by any client that is not this panel. Such a value gets an option of its own
 * at the foot of the list, so the control renders what is stored rather than
 * silently dropping it — a picker that quietly replaced a value the operator
 * never saw would be strictly worse than the text box it replaced — and the
 * shape rule is what splits that case in two, so `ZZ` and `Algeria` get
 * different sentences instead of one shrug.
 *
 * This is still the one place the panel duplicates a rule the API also enforces,
 * and `new-order.ts`'s `draftProblems` docblock explains why that is normally
 * refused: the API says something better than the panel could. Here the API says
 * *less* than the panel can. Nothing about which drafts are submittable changed —
 * the off-list note is a hint and an option's second line, never a `fields` entry
 * and never a `draftProblems` key.
 *
 * ## Why `Select` and not a native one
 *
 * Because every other picker in this file and beside it already is: `Select` is
 * `Listbox` in a `FieldFrame`, and `Listbox`'s own docblock argues at length
 * that a `<select>`'s open list is unstyleable on every engine, so the panel's
 * surface, its focus ring and its dark theme all stop at the moment somebody
 * opens the control. It also buys the thing this list actually needs: a
 * **second line under an option**, which `<option>` cannot carry and which
 * `CriterionField`'s product picker already uses for a SKU. That is where the
 * off-list note goes, and it is the reason an unrecognised code can be rendered
 * *with its explanation attached to it* rather than as a bare two letters.
 */

/**
 * The address vocabulary lives in `new-order.ts`, which imports nothing, and is
 * re-exported here so a form that draws these controls has one import rather
 * than two. Two other things are keyed by it: the map from an API field name to
 * a DOM id, which `ErrorSummary` links through, and the copy of a customer's
 * billing block into a draft.
 */
export { ADDRESS_KEYS };

/**
 * The DOM id of one control, and the only place the two namespaces are joined.
 *
 * The API says `billing.country`; a DOM id cannot carry a dot without
 * `document.getElementById` still working while `#billing.country` selects a
 * class. `idPrefix` is the form's own — `new-order`, `order-edit` — because both
 * drawers can be in one document's history and a duplicated id is a link that
 * focuses the wrong form's field.
 */
export function addressFieldId(
  idPrefix: string,
  prefix: "billing" | "shipping",
  key: string,
): string {
  return `${idPrefix}-${prefix}-${key}`;
}

/** The wilaya picker's options — the empty one first, then the shop's list. */
function wilayaOptions(
  wilayas: Wilaya[],
  locale: string,
  none: string,
): { value: string; label: string }[] {
  return [
    { value: "", label: none },
    ...wilayas.map((w) => ({
      value: w.code,
      label: locale === "ar" && w.name_ar !== "" ? w.name_ar : w.name,
    })),
  ];
}

/**
 * What the control has to say about a stored country that is not in the list —
 * or `null` when there is nothing to say, which is the ordinary case.
 *
 * Two sentences and not one, because the two states are different mistakes and
 * a reader can only act on one of them. `ZZ` is a **well-formed code that names
 * no country**: the API took it, the shop stored it, and it is unroutable but
 * not malformed. `Algeria` is **not a code at all**: some other client wrote a
 * name where a code belongs, which is the exact failure
 * `AddressInput::validateCountry()` refuses with `Must be a two-letter ISO
 * country code, such as DZ.` — so the panel says the same thing it has always
 * said about that, `countryShape`, rather than inventing a third phrasing.
 *
 * The empty string is not off-list: it is the "not stated" option, which is a
 * real value here and the state most of this shop's orders are in.
 */
function offListNote(
  country: string,
  locale: string,
  t: (key: string) => string,
): string | null {
  const stored = country.trim();
  if (stored === "" || countryName(stored, locale) !== null) return null;
  return isCountryShape(stored) ? t("countryUnknown") : t("countryShape");
}

/**
 * The country picker's options: *not stated*, then the 249, then — only when the
 * stored value is one of neither — the stored value itself.
 *
 * **The third arm is the whole reason this is a function.** Radix renders the
 * trigger's label from the option whose `value` matches, so a control offered a
 * list that does not contain its own value shows `placeholder` and looks like a
 * blank field; the first selection anybody made would then overwrite a country
 * they were never shown. Appending it is what makes the picker strictly additive
 * over the text box it replaced: every value that could be typed before can
 * still be seen, and only the *typing* is gone.
 *
 * At the foot rather than at the head, because it is an exception and a list
 * that opened on one would read as though it were the recommendation. The
 * off-list note rides on the option as its second line — see `offListNote` for
 * why there are two of them.
 */
function countryPickerOptions(
  country: string,
  locale: string,
  none: string,
  note: string | null,
): ListboxOption[] {
  const options: ListboxOption[] = [
    { value: "", label: none },
    ...countryOptions(locale),
  ];

  const stored = country.trim();
  if (note !== null) options.push({ value: stored, label: stored, secondary: note });

  return options;
}

export function AddressFields({
  /** The form's own id namespace. See `addressFieldId`. */
  idPrefix,
  prefix,
  value,
  onChange,
  /** The API's refusals, keyed as the API keys them: `billing.city`. */
  fields,
  wilayas,
  locale,
  /** Billing only. A shipping address carries no email and the API says so. */
  email,
  disabled = false,
}: {
  idPrefix: string;
  prefix: "billing" | "shipping";
  value: AddressDraft;
  onChange: (next: Partial<AddressDraft>) => void;
  fields: Record<string, string>;
  wilayas: Wilaya[];
  locale: string;
  email: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("orders.address");

  const id = (key: string) => addressFieldId(idPrefix, prefix, key);
  const error = (key: string) => fields[`${prefix}.${key}`];

  /*
   * The country control's two derived facts. Computed on every render rather
   * than memoised: both are a lookup in a frozen table, and `countryOptions`
   * caches the 249-row array itself so the only per-render allocation is the
   * three-element spread around it.
   */
  const countryNote = offListNote(value.country, locale, t);
  const countryChoices = countryPickerOptions(
    value.country,
    locale,
    t("noCountry"),
    countryNote,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <TextField
          id={id("first_name")}
          label={t("firstName")}
          value={value.first_name}
          onChange={(next) => onChange({ first_name: next })}
          error={error("first_name")}
          disabled={disabled}
          autoComplete="off"
          className="min-w-40 flex-1"
        />
        <TextField
          id={id("last_name")}
          label={t("lastName")}
          value={value.last_name}
          onChange={(next) => onChange({ last_name: next })}
          error={error("last_name")}
          disabled={disabled}
          autoComplete="off"
          className="min-w-40 flex-1"
        />
      </div>

      <TextField
        id={id("company")}
        label={t("company")}
        value={value.company}
        onChange={(next) => onChange({ company: next })}
        error={error("company")}
        disabled={disabled}
      />
      <TextField
        id={id("address_1")}
        label={t("line1")}
        value={value.address_1}
        onChange={(next) => onChange({ address_1: next })}
        error={error("address_1")}
        disabled={disabled}
      />
      <TextField
        id={id("address_2")}
        label={t("line2")}
        value={value.address_2}
        onChange={(next) => onChange({ address_2: next })}
        error={error("address_2")}
        disabled={disabled}
      />

      <div className="flex flex-wrap gap-3">
        <TextField
          id={id("city")}
          label={t("city")}
          value={value.city}
          onChange={(next) => onChange({ city: next })}
          error={error("city")}
          disabled={disabled}
          className="min-w-40 flex-1"
        />
        <TextField
          id={id("postcode")}
          label={t("postcode")}
          value={value.postcode}
          onChange={(next) => onChange({ postcode: next })}
          error={error("postcode")}
          disabled={disabled}
          isolate
          className="min-w-30 flex-1"
        />
      </div>

      {/* The wilaya is a two-digit code on the wire and a bilingual name on
          screen — `state` is filled on about 8 % of the shop's orders, which is
          the measurement `columns.tsx` renders the list against. A picker is
          what stops this one being the ninth. */}
      <Select
        id={id("state")}
        label={t("wilaya")}
        value={value.state}
        onChange={(next) => onChange({ state: next })}
        error={error("state")}
        disabled={disabled}
        options={wilayaOptions(wilayas, locale, t("noWilaya"))}
      />

      <div className="flex flex-wrap gap-3">
        {/* `min-w-40` where the text box had `min-w-30`, which is the whole of
            the layout change and it is measured rather than tidied. The box
            held two letters; the trigger holds a name, and the longest of the
            249 is `Géorgie du Sud-et-les Îles Sandwich du Sud` at 42
            characters in French and `جورجيا الجنوبية وجزر ساندويتش الجنوبية`
            at 38 in Arabic — both measured out of the table rather than
            guessed at. At `min-w-30` beside the phone field neither is legible
            at any width; at `min-w-40` the pair wraps to two rows before
            either has to truncate, which is what `flex-wrap` is here for. At
            the 340px floor the row is stacked in both scripts either way.

            The wrapper carries the sizing because `Select` takes no
            `className`: `FieldFrame` owns the field's box and the trigger
            stretches to it. `TextField` beside it does take one, which is a
            difference in those two primitives and not one this file gets to
            resolve. */}
        <div className="min-w-40 flex-1">
          <Select
            id={id("country")}
            label={t("country")}
            /* The hint says what the *stored* value is, not what the list is:
               `countryHint` is the ordinary sentence and the off-list note
               replaces it, so a person looking at `ZZ` is told why without
               having to open the list to find the second line. */
            hint={countryNote ?? t("countryHint")}
            value={value.country}
            onChange={(next) => onChange({ country: next })}
            error={error("country")}
            disabled={disabled}
            options={countryChoices}
          />
        </div>
        <TextField
          id={id("phone")}
          label={t("phone")}
          value={value.phone}
          onChange={(next) => onChange({ phone: next })}
          error={error("phone")}
          disabled={disabled}
          isolate
          inputMode="tel"
          autoComplete="off"
          className="min-w-40 flex-1"
        />
      </div>

      {email ? (
        <TextField
          id={id("email")}
          label={t("email")}
          value={value.email}
          onChange={(next) => onChange({ email: next })}
          error={error("email")}
          disabled={disabled}
          isolate
          inputMode="email"
          autoComplete="off"
        />
      ) : null}
    </div>
  );
}
