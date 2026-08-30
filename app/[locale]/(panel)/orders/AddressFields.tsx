"use client";

import { useTranslations } from "next-intl";
import type { Wilaya } from "@/lib/api/schemas/order";
import { Select, TextField } from "@/components/ui/Form";
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
 * ## `country` is a text field, and the panel now validates its shape itself
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
 * The panel cannot close that hole and must not pretend to. A picker would need
 * a 249-row country table nobody here has measured, and `docs/API.md` and
 * `lib/api/schemas` are built on what the API returns rather than on a list typed
 * from memory. What it can do is the two honest things:
 *
 *   the rule   the same shape check, run locally, so the mistake that actually
 *              happens — a country name — is caught before a round trip rather
 *              than after one. `validate` is the caller's half of `useField`'s
 *              split: the rule is ours, the timing (blur, then live) is the
 *              layer's, so it stays silent while somebody is typing `D`.
 *   the hint   says the code is stored as typed and is not checked against a
 *              list of real countries. A form that implied otherwise would be
 *              claiming a guarantee no layer in this stack provides.
 *
 * This is the one place the panel duplicates a rule the API also enforces, and
 * `new-order.ts`'s `draftProblems` docblock explains why that is normally
 * refused: the API says something better than the panel could. Here the API says
 * *less* than the panel can, which is the exception rather than a softening of
 * it — and the rule is on the control, not in `draftProblems`, so nothing about
 * which drafts are submittable changed.
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

  /** The shape rule, and only the shape — see the docblock. */
  const country = (next: string) =>
    next.trim() === "" || /^[A-Za-z]{2}$/.test(next.trim())
      ? undefined
      : t("countryShape");

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
        <TextField
          id={id("country")}
          label={t("country")}
          hint={t("countryHint")}
          value={value.country}
          onChange={(next) => onChange({ country: next })}
          error={error("country")}
          validate={country}
          disabled={disabled}
          isolate
          className="min-w-30 flex-1"
        />
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
