"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Wilaya } from "@/lib/api/schemas/order";
import { placeName } from "@/lib/geography";
import {
  CRITERION_CONTROL,
  CRITERION_KIND,
  MAX_ORDERS,
  MAX_SPENT,
  criterionBounds,
  criterionProblem,
  type SegmentCriterion,
} from "@/lib/campaigns";
import { DateField, Select, TextField } from "@/components/ui/Form";
import type { ListboxOption } from "@/components/ui/Listbox";
import { useProductSearch, type EligibleProduct } from "./product-lookup";

/**
 * One segment criterion's **value**, drawn as the thing it actually is.
 *
 * ## What this replaces, and why one `TextField` for eleven criteria was worse
 * ## than it looked
 *
 * `SegmentModal` rendered every criterion the same way: a `TextField` with
 * `inputMode` switched between `text` and `decimal` on `CRITERION_KIND[key] ===
 * "date"`, and nothing else. So a wilaya was typed as `16`, a product as `2481`,
 * and a date as free text with no calendar — three separate cases of the panel
 * asking a person for a primary key.
 *
 * The date one is the sharpest, because it is a **regression against a control
 * that already existed**: item 5 replaced every native `<input type="date">` in
 * the panel with `DateField`, and its sweep recorded that it deliberately did
 * not reach here, because these four were never `DateField`s in the first place
 * — they were text boxes whose only cue that `2026-08-31` was wanted rather than
 * `31/08/2026` was a hint sentence. That gap closes here.
 *
 * ## Five controls, and the map that picks between them is the security property
 *
 * `CRITERION_CONTROL` in `lib/campaigns.ts` is a `Record<SegmentCriterion, …>`,
 * which TypeScript requires to hold exactly the eleven names. The `switch`
 * below is over its values and is exhaustive, so **there is no code path in this
 * file that can draw a control for `consent`, `marketing_consent`,
 * `email_contains`, `email`, `role`, `commune_id`, `limit` or `sql`** — not
 * "none is offered", which a later edit can undo without noticing, but "the
 * function that would draw one does not exist and adding a key for it does not
 * compile". `SegmentModal` reaches this component and this component reaches the
 * map; nothing else chooses a control. That is sub-task 4 as a structural
 * property rather than as a list somebody has to remember not to extend.
 *
 * ## Money and counts are two rules and now two controls
 *
 * They shared `inputMode="decimal"` and no validation. `SegmentCriteria::parse()`
 * has never agreed — `^\d+(\.\d{1,2})?$` for money against `ctype_digit` for a
 * count — and the difference is visible on the one input device this shop's
 * operators mostly use: `decimal` gives a soft keyboard with a decimal
 * separator and `numeric` gives one without, so a count field no longer offers
 * a key that produces a 400. `criterionProblem` is the rule for both and
 * `lib/campaigns.ts` argues it; the timing is `useField`'s, unchanged.
 *
 * ## The two lookups fail in different directions, and both are drawn
 *
 * A wilaya list is 69 rows fetched once on the server; a product name is one
 * lookup per open of the dialog. Neither is allowed to make the criterion
 * unfillable, which is `DestinationFields`' rule — *"a destination that will not
 * load must not make the order unsavable"* — applied to a form whose value is
 * already correct and merely unlabelled. So an id that will not resolve keeps
 * its value and is drawn **as itself with a note**, never cleared and never
 * silently replaced. The API stores what it was given; a panel that dropped the
 * id because it could not name it would be editing a segment nobody asked to
 * edit.
 */
export function CriterionField({
  criterion,
  value,
  onChange,
  id,
  /** The API's refusal for this field, or the form's own cross-field verdict. */
  error,
  /** Every criterion in the draft — the pair rules read the other half here. */
  criteria,
  wilayas,
  locale,
  /**
   * `ac_manage_coupons`, resolved on the server. See `product-lookup.ts` for why
   * that is the capability and not `ac_manage_products`.
   */
  canPickProducts,
  /** Resolved by `useResolvedProducts`, hoisted so eleven rows share one fetch. */
  resolved,
  resolvePending,
  disabled = false,
}: {
  criterion: SegmentCriterion;
  value: string;
  onChange: (next: string) => void;
  id: string;
  error?: string;
  criteria: Readonly<Record<string, string>>;
  wilayas: readonly Wilaya[];
  locale: string;
  canPickProducts: boolean;
  resolved: Map<number, EligibleProduct>;
  resolvePending: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("campaigns");
  const label = t(`criterion.${criterion}`);

  /**
   * The field's own rule. `useField` owns the timing — silent until the first
   * blur, live thereafter — and this owns the verdict, which is the split §3.4
   * legislates and `Form.tsx` implements.
   *
   * The ceiling gets its own sentence rather than sharing the shape one: *"a
   * decimal amount, e.g. 5000.00"* is the wrong thing to tell somebody who typed
   * a perfectly well-formed hundred million, and `parse()` answers those two
   * cases with two different strings for the same reason.
   */
  const validate = (raw: string) => {
    const verdict = criterionProblem(criterion, raw);
    if (verdict === null) return undefined;
    if (verdict !== "range") return t(`segment.value.${verdict}`);
    return CRITERION_KIND[criterion] === "money"
      ? t("segment.value.tooLargeMoney", { max: MAX_SPENT })
      : t("segment.value.tooLargeCount", { max: String(MAX_ORDERS) });
  };

  switch (CRITERION_CONTROL[criterion]) {
    case "money":
      return (
        <TextField
          id={id}
          label={label}
          value={value}
          onChange={onChange}
          hint={t("segment.value.money")}
          error={error}
          validate={validate}
          /* `decimal`, so the keypad carries a separator. Not `NumberField`,
             whose `flex-1` is written for the two-across price band and would
             fight the remove button this sits beside. */
          inputMode="decimal"
          isolate
          disabled={disabled}
        />
      );

    case "count":
      return (
        <TextField
          id={id}
          label={label}
          value={value}
          onChange={onChange}
          hint={t("segment.value.count")}
          error={error}
          validate={validate}
          /* `numeric` and not `decimal`: `ctype_digit` refuses a decimal point,
             so a keypad that offers one offers a 400. */
          inputMode="numeric"
          isolate
          disabled={disabled}
        />
      );

    case "date":
      return (
        <DateField
          id={id}
          label={label}
          value={value}
          onChange={onChange}
          error={error}
          /* The other end of the pair, so the grid stops drawing days
             `checkRanges()` would refuse. It bounds the **pointer** only — a
             typed date still reaches the rule and its message, which is
             `DatePicker`'s documented split. */
          {...criterionBounds(criterion, criteria)}
          disabled={disabled}
        />
      );

    case "wilaya":
      return (
        <WilayaCriterion
          id={id}
          label={label}
          value={value}
          onChange={onChange}
          error={error}
          wilayas={wilayas}
          locale={locale}
          disabled={disabled}
        />
      );

    case "product":
      return (
        <ProductCriterion
          id={id}
          label={label}
          value={value}
          onChange={onChange}
          error={error}
          canPick={canPickProducts}
          resolved={resolved}
          resolvePending={resolvePending}
          disabled={disabled}
        />
      );
  }
}

/* ---------------------------------------------------------------- wilaya --- */

/**
 * The wilaya, chosen by name and stored as an id.
 *
 * **The sixth wilaya picker in the panel, and it is a sixth deliberately.** Five
 * exist — `AddressFields`, `DestinationFields`, `CreateParcelDrawer`, `Resolver`
 * and `RuleForm` — and all five are a `Select` over a `Wilaya[]` **prop**
 * fetched by a server component. There is no shared hook and no client fetch of
 * `/locations/wilayas` anywhere in the panel, so "reuse the one the parcel
 * drawer uses" has nothing to reuse but the shape.
 *
 * Extracting a shared control is the obvious move and this branch does not make
 * it, for a reason that is about the five and not about effort: **they do not
 * agree on what the value is.** `AddressFields` binds `w.code`, a two-digit
 * string on a free-text address field; `RuleForm` binds `w.id` with `"0"` as a
 * live sentinel meaning *the national rule*; the other three bind `w.id` with
 * `""` for unset. A component covering all four axes takes a discriminator prop
 * and is three components in a trench coat, and unifying them means editing the
 * orders and shipping screens — which other steps of this run are editing now.
 * `DestinationFields`' own docblock refused the identical merge for the identical
 * reason and said so rather than leaving it as an accident.
 *
 * What *is* shared is the part that was drifting: `placeName` now lives in
 * `lib/geography.ts` instead of being re-declared privately for the fifth time.
 *
 * ## Two states the other five do not have
 *
 * They receive a list that a server component fetched for a screen whose whole
 * subject is a destination. This one hangs off a criterion somebody just added,
 * and the same server fetch is `.catch(() => [])` here as everywhere else — so
 * an empty list is reachable and must not read as *"Algeria has no wilayas"*.
 * And a stored `wilaya_id` need not be in the list at all: `SegmentCriteria`
 * validates ids with `ctype_digit` and nothing else — the class is documented
 * *"Pure — no WordPress, no database"* — so `wilaya_id: 999` is stored happily
 * and `GeoDataset` only goes to 69.
 *
 *   empty list   the select holds the unset option and says the list did not
 *                load, in a hint rather than as an error: nothing the person did
 *                is wrong. The typed value, if there is one, is still shown.
 *   unknown id   the id is prepended as its own option, labelled as a wilaya
 *                this shop cannot name. The value survives an open-and-save,
 *                which is the whole point — a panel that quietly dropped it
 *                would rewrite a segment nobody asked to edit.
 */
function WilayaCriterion({
  id,
  label,
  value,
  onChange,
  error,
  wilayas,
  locale,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  wilayas: readonly Wilaya[];
  locale: string;
  disabled: boolean;
}) {
  const t = useTranslations("campaigns");
  const tShipping = useTranslations("shipping");

  const known = wilayas.some((w) => String(w.id) === value);
  const unknown = value !== "" && !known;

  const options: ListboxOption<string>[] = [
    { value: "", label: tShipping("notChosen") },
    ...(unknown ? [{ value, label: t("segment.wilayaUnknown", { id: value }) }] : []),
    ...wilayas.map((w) => ({ value: String(w.id), label: placeName(w, locale) })),
  ];

  return (
    <Select
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      /* One hint slot and two things that could fill it. The list failing is the
         more urgent — it is why the control looks broken — so it wins, and the
         unknown id has already said its piece inside the option itself. */
      hint={
        wilayas.length === 0
          ? t("segment.wilayasUnavailable")
          : unknown
            ? t("segment.wilayaUnknownWhy")
            : undefined
      }
      error={error}
      disabled={disabled}
    />
  );
}

/* --------------------------------------------------------------- product --- */

/**
 * A product, chosen by name and SKU and stored as an id.
 *
 * ## A `Select` fed by a search, rather than a results list of its own
 *
 * `ProductPicker` in the orders section draws a permanently-open list of eight
 * `<button>` rows, which is right for a drawer whose job is adding line after
 * line to an order. This is a **single-valued field** in a `Modal` that can hold
 * eleven criteria, and eight rows of results under two of them would push the
 * dialog past the viewport at the 340px floor — before counting the one under
 * `not_bought_product_id`.
 *
 * So the results land in the panel's own drawn listbox instead, and that is
 * reuse rather than a third picker: `Select` is `Listbox` in the field frame, it
 * already renders a `secondary` line under each option — which is exactly where
 * a SKU goes, and the thing `<option>` could never carry — its options are 44px
 * on a coarse pointer, and it gives this field the label, the hint, the
 * `aria-describedby` wiring and the error slot for free. "Show the name, store
 * the id" is the sentence a `Select` is already made of.
 *
 * The search above it is `SearchField`, submit-gated, for the cap `ProductPicker`
 * records: a request per keystroke against 600/min shared by every open tab.
 *
 * ## The degradation, and how loudly it speaks
 *
 * `canPick` is `ac_manage_coupons`, resolved on the server and passed down as a
 * boolean — the panel's established shape, `lib/capabilities.ts` line 3: *"a
 * client that hides a button is a convenience, not a security boundary"*, and no
 * client component in this panel branches on a 403.
 *
 * **It is a guard rather than a live path, and the fallback is worded for that.**
 * Every role that holds `ac_manage_marketing` — the capability this whole screen
 * is gated on — also holds `ac_manage_coupons`: Super Admin has all thirteen,
 * Admin has eleven including coupons, and Marketing Manager's four are marketing,
 * content, **coupons** and analytics. So no defined role reaches this branch.
 * WordPress capabilities are per-user and can be edited away from a role, so the
 * branch is not unreachable in principle and is not deleted; it is simply not
 * shouted at somebody who will never see it. That is the same verdict
 * `orders/CustomerPicker.tsx` reached about its own missing capability — *"the
 * fallback is a guard rather than a live path, unlike the product picker, whose
 * missing capability is a role people actually have"* — and the opposite of
 * `ProductPicker`'s, whose `Order Manager` hole is real.
 *
 * The fallback itself is `ProductPicker`'s exactly: an id field that says why,
 * with the API still validating the id.
 */
function ProductCriterion({
  id,
  label,
  value,
  onChange,
  error,
  canPick,
  resolved,
  resolvePending,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  canPick: boolean;
  resolved: Map<number, EligibleProduct>;
  resolvePending: boolean;
  disabled: boolean;
}) {
  const t = useTranslations("campaigns");
  const tOrders = useTranslations("orders");

  /* The draft is what is typed; `search` is what has been asked for. `TextField`
     owns the split — the caller holds a draft and acts on `onSubmit`. */
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const results = useProductSearch(search, canPick && !disabled);

  if (!canPick) {
    return (
      <TextField
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        hint={t("segment.productIdWhy")}
        error={error}
        inputMode="numeric"
        isolate
        disabled={disabled}
      />
    );
  }

  const rows = results.data?.data ?? [];
  const chosen = value === "" ? null : (resolved.get(Number(value)) ?? null);

  /*
   * The chosen product first, then the results — and the chosen one is included
   * even when the search has just replaced the list under it, because a
   * `Listbox` whose `value` matches no option renders its placeholder and the
   * field would appear to have emptied itself. `Listbox`'s own docblock names
   * that state as "the honest rendering of a state that should not happen".
   */
  const seen = new Set(rows.map((row) => row.id));
  const current: ListboxOption<string>[] =
    value === "" || seen.has(Number(value))
      ? []
      : [
          {
            value,
            label: chosen
              ? chosen.name
              : resolvePending
                ? tOrders("picker.manualName", { id: value })
                : t("segment.productUnknown", { id: value }),
            secondary: chosen?.sku ?? undefined,
          },
        ];

  const options: ListboxOption<string>[] = [
    { value: "", label: t("segment.productNone") },
    ...current,
    ...rows.map((row) => ({
      value: String(row.id),
      label: row.name,
      secondary: row.sku ?? tOrders("picker.noSku"),
    })),
  ];

  return (
    <div className="flex flex-col gap-2">
      {/*
        **The value leads and the search follows**, which is the opposite of the
        order `ProductPicker` uses and is right here for a reason its layout does
        not have: this field carries the criterion's *name*, so it is the row the
        person is reading and the row the remove button lines up with. A search
        box above it would make the criterion's label the second thing on the row
        and leave the × beside a control that is not the value.

        The hint under it points down at the search, so the sequence still reads
        top to bottom for somebody who has not chosen anything yet.
      */}
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={options}
        /*
         * Four states, and they are `DestinationFields`' four for a dependent
         * fetch, read here against a search instead of a wilaya. `isPending` is
         * true for a *disabled* query too, so the "nothing asked yet" case is
         * tested before it rather than after — otherwise a form nobody has
         * searched in reads as loading, forever.
         */
        hint={
          search.trim() === ""
            ? t("segment.productSearchFirst")
            : results.isPending
              ? tOrders("picker.loading")
              : results.isError
                ? undefined
                : rows.length === 0
                  ? tOrders("picker.noResults")
                  : tOrders("picker.skuHint")
        }
        error={error}
        disabled={disabled}
      />

      {/*
        `TextField` with `onSubmit` rather than `FilterBar`'s `SearchField`, and
        the choice is that primitive's own documented split: `SearchField` is a
        `role="search"` box with an `aria-label` and no visible one, written for
        a page's filter row — where it also carries `sm:max-w-80`, which inside a
        560px dialog draws a control half the width of the field above it and
        reads as a different kind of thing. `TextField` gives the visible label
        §3.4 asks for, the full column width, and the same submit gate: **both
        Enter and blur fire `onSubmit`**, so typing a name and tabbing into the
        list runs the search, which is the gesture this pairing is for.
      */}
      <TextField
        id={`${id}-search`}
        label={tOrders("picker.search")}
        value={draft}
        onChange={setDraft}
        onSubmit={setSearch}
        hint={tOrders("picker.skuHint")}
        disabled={disabled}
      />

      {/* The API's own sentence, and not bound to the control as an `error`:
          nothing the person chose is wrong, the list did not arrive. §3.4 keeps
          a per-control error for a per-control fault, which is the line
          `DestinationFields` draws for its commune list. */}
      {results.isError ? (
        <p className="text-ui-label text-ui-danger-fg">
          {(results.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}
