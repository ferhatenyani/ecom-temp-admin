"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";
import { DELIVERY_TYPES, type DeliveryType } from "@/lib/shipment-status";
import { providerLabel } from "@/lib/shipping";
import { formatMoney } from "@/lib/format/money";
import type { ShippingProvider, ShippingRate } from "@/lib/api/schemas/shipping";
import { Select, TextField } from "@/components/ui/Form";
import { Isolate } from "@/components/primitives/Ltr";
import { quoteFor } from "./new-order";

/**
 * Who carries the parcel, and by which journey — step 2's admin sub-task 1, and
 * the half of sub-task 3 that fetches.
 *
 * ## The route this asks, and why it is the admin one
 *
 * `GET /shipping/rates`. The full argument is at the foot of `new-order.ts`;
 * the short of it is that `GET /checkout/shipping-rates` prices **a cart** —
 * `Cart\CheckoutService::shippingRates()` reads the subtotal off the cart and
 * never off the request — and a back-office order is not a cart. The admin
 * route's parameters are this form's four keys by name
 * (`Shipping\ShippingController::rateArgs()`: `wilaya_id`, `commune_id`,
 * `provider`, `delivery_type`, `subtotal`), and it was already on the allowlist
 * from the shipping rules editor, whose `Resolver.tsx` calls it for the same
 * destination pair.
 *
 * **Read from source, never measured over the wire.** `BLOCKED.md` records the
 * 401 that stops any live call, and both couriers are switched off on this
 * install, so the multi-courier answer this control is built to read exists
 * only in `scripts/mock-api.mjs`.
 *
 * ## Three of the four keys are sent; the fourth is applied here
 *
 * `provider` is a *filter* on that route, not a required parameter — omit it
 * and `ShippingService::rates()` quotes every registered courier in one pass.
 * So the request carries the destination and the journey only, and the chosen
 * courier is applied to the answer by `quoteFor`. Three consequences, all
 * wanted:
 *
 *   - **switching courier costs no request**, so the fee moves the instant the
 *     picker does rather than 600 ms later;
 *   - **every option can be labelled with its own price**, which is the only
 *     way the picker can honestly say which couriers serve this destination —
 *     one request per option would be N requests to draw one control;
 *   - one entry in a cache whose rate limit is counted per credential across
 *     every open tab, which is the argument `DestinationFields` makes about the
 *     commune list it shares with `CreateParcelDrawer`.
 *
 * The step's wording is "debounced call … on (wilaya, commune, provider,
 * delivery type) change", and this satisfies its *effect* — the fee follows all
 * four — with one fewer round trip. It is written down rather than left to look
 * like an oversight.
 *
 * ## The query key names the journey, and `Resolver.tsx`'s does not
 *
 * That screen keys on `["shipping-rates", wilayaId, communeId]` and sends no
 * `delivery_type`, so the route applies its own default of `home`. This one
 * keys on four elements because it sends four, and the difference is not
 * cosmetic: `ShippingRule::matches()` tests a rule's own delivery type against
 * the destination's, so a desk tariff and a home tariff are two different
 * answers for one pair of ids. A three-element key would serve one journey's
 * answer for the other.
 *
 * ## What the picker offers, in each of the four states
 *
 *   destination unchosen   every registered courier, unlabelled, and a line
 *                          saying a destination is needed before anything can
 *                          be priced. No request — `enabled` is false, because
 *                          both ids are `required` with `minimum: 1` on the
 *                          route and a half-sent pair is a 400 whose
 *                          `details.params` is an array of bare *names* that
 *                          `lib/api/browser.ts` deliberately will not render.
 *   nothing serves it      every courier still offered, each marked as having
 *                          no price here, and the fee left alone. A 200 with
 *                          `[]` is the ordinary answer for a shop with no
 *                          tariff rule covering the place — and on this install
 *                          it is the answer for every destination a courier has
 *                          not had `sync-destinations` run for.
 *   the lookup failed      the API's own sentence, and the picker stays live.
 *                          `DestinationFields` renders its own failure exactly
 *                          this way and for the stated reason: nothing the
 *                          operator chose is wrong, the list did not arrive.
 *   only `manual` listed   one option, which is this shop —
 *                          `GET /shipping/providers` reports `manual` alone
 *                          while `ENABLE_YALIDINE` and `ENABLE_ZR_EXPRESS` are
 *                          unset. Still drawn, because an order that names
 *                          in-house delivery has said something true, and
 *                          because a control that appears once a shop is
 *                          configured is a control nobody knows exists.
 *
 * **In none of them is anything hidden.** The step asks for "only the couriers
 * that serve the chosen wilaya/commune"; the API's own definition of serving is
 * *produced a row*, and filtering on it would hide `manual` — whose
 * `getShippingRates()` returns `[]` by design — from every destination without
 * a tariff rule, and would hide an unsynced courier the operator knows is
 * collecting the parcel. `POST /orders` validates the name against
 * *registration* and not the destination
 * (`OrderService::guardShippingProviderKnown()`), so a filtered picker would
 * refuse what the API accepts. Labelling says the same thing and takes nothing
 * away.
 *
 * ## Without `ac_manage_shipping`
 *
 * Both routes this control reads are behind it — `ShippingController` builds
 * one `Permissions::callback(Capabilities::MANAGE_SHIPPING)` and hangs every
 * route on it — while the drawer's own route is `ac_manage_orders`. No role
 * holds one without the other today (`Capabilities::roles()`), so this is
 * `canPickCustomers`'s kind of fallback rather than `canPickProducts`'s: a
 * guard rather than a live path.
 *
 * It degrades the way `ProductPicker`'s product-id field does, and it degrades
 * *well*, which is why it is worth having. The courier becomes a text box that
 * says why, and `OrderService::guardShippingProviderKnown()` refuses an unknown
 * name with `fields.shipping_provider` whose entire message is the legal set —
 * `"Available: manual."` — so the operator learns the vocabulary from the API
 * rather than from a picker they cannot load. Nothing is quoted in that state
 * and the fee is simply typed, which is what the field did before this branch.
 */

/** EL's figure, and the step's: `CartCheckoutPage.jsx` and `CreateOrderModal.jsx`
    both `setTimeout(…, 600)` around their fee call. Kept rather than tuned,
    because the number is not the interesting part — see `useShippingQuotes`. */
const DEBOUNCE_MS = 600;

type Destination = {
  wilayaId: string;
  communeId: string;
  deliveryType: DeliveryType;
};

export type ShippingQuotes = {
  /** Every row for the destination, or `[]` for a 200 that priced nothing. */
  rows: ShippingRate[];
  /** A request is in flight, **or** one is queued behind the debounce. */
  loading: boolean;
  /** The API's own sentence, or `null`. Never a reason to disable anything. */
  failure: string | null;
  /** False while there is nothing to ask about — no destination yet. */
  asked: boolean;
};

/**
 * The debounced lookup, as a hook so the drawer owns the answer.
 *
 * The fee field belongs to `NewOrderDrawer` and the quote has to be written
 * into it, so the data is fetched where it is consumed and this control is
 * handed the result. The alternative — this component fetching and calling an
 * `onQuote` upward from an effect — was the shape that would have put two
 * effects in a row between an answer arriving and a field changing.
 *
 * ## 600 ms on a form of drawn selects, which is not where the number came from
 *
 * EL debounces because its wilaya and city are typed into text inputs, so every
 * keystroke would be a request. Nothing on this form is typed: `Select` is
 * Radix's listbox, whose arrow keys move a highlight and commit nothing until
 * Enter, so a person walking a 69-row wilaya list fires exactly one change.
 * **So the debounce here is cheap insurance rather than the necessity it is at
 * a checkout**, and that is worth saying plainly rather than implying the two
 * situations are the same.
 *
 * It still earns its place. Choosing the wrong commune and immediately choosing
 * the right one is one request instead of two, against a rate limit counted per
 * credential across every open tab; and it costs nothing, because no part of
 * the form waits for it. The step asks for EL's figure and there is no reason
 * to disagree with it.
 *
 * **Clearing is immediate and only *asking* is debounced.** A destination that
 * has just been emptied — which is what changing the wilaya does to the
 * commune — has no pending answer worth waiting 600 ms to stop showing.
 */
export function useShippingQuotes({
  wilayaId,
  communeId,
  deliveryType,
  enabled,
}: Destination & { enabled: boolean }): ShippingQuotes {
  /*
   * What the form is currently asking about, or `null` for *there is nothing to
   * ask*. That test is the route's own: `rateArgs()` declares `wilaya_id` and
   * `commune_id` `required` with `minimum: 1`, so a pair with a hole in it is a
   * 400 rather than a partial answer. `communeId` is cleared whenever `wilayaId`
   * moves — `DestinationFields` does that in the same handler — so the pair this
   * reads is never stale.
   *
   * `useMemo` so the effect below has a stable dependency: a fresh object on
   * every render would clear and restart the 600 ms timer on every render, which
   * is a debounce that never fires.
   */
  const wanted: Destination | null = useMemo(
    () =>
      enabled && wilayaId !== "" && communeId !== ""
        ? { wilayaId, communeId, deliveryType }
        : null,
    [enabled, wilayaId, communeId, deliveryType],
  );

  const [settled, setSettled] = useState<Destination | null>(wanted);

  const same =
    settled?.wilayaId === wanted?.wilayaId &&
    settled?.communeId === wanted?.communeId &&
    settled?.deliveryType === wanted?.deliveryType;

  /*
   * **Clearing happens during render, and only *asking* is debounced.** A
   * destination that has just been emptied — which is what changing the wilaya
   * does to the commune — has no pending answer worth waiting 600 ms to stop
   * showing, and there is no request to save by waiting either.
   *
   * Adjusted during render rather than in an effect, which is the pattern
   * `NewOrderDrawer`'s own `seededFor` block uses two files away and which React
   * documents for exactly this: state that has to follow a prop. An effect here
   * would render the stale answer once before clearing it, and
   * `react-hooks/set-state-in-effect` refuses it outright.
   */
  if (wanted === null && settled !== null) setSettled(null);

  useEffect(() => {
    /* The only thing this effect does is *schedule*. `setSettled` runs inside
       the timeout, which is a callback from an external system rather than the
       effect body — the distinction the rule above draws. */
    if (same || wanted === null) return;

    const timer = setTimeout(() => setSettled(wanted), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    /* `same` is what actually decides whether there is anything to schedule;
       `wanted` is memoised above precisely so that being in this list does not
       restart the timer on every render. */
  }, [same, wanted]);

  const rates = useQuery({
    queryKey: [
      "shipping-rates",
      settled?.wilayaId ?? "",
      settled?.communeId ?? "",
      settled?.deliveryType ?? "",
    ],
    enabled: settled !== null,
    queryFn: async () => {
      const query = new URLSearchParams({
        wilaya_id: settled?.wilayaId ?? "",
        commune_id: settled?.communeId ?? "",
        delivery_type: settled?.deliveryType ?? "home",
      });
      /*
       * No `provider` — the route reads an omitted one as *every registered
       * courier* (`$requested === '' ? $this->providers->names() : …`), which
       * is what lets one request label every option. And no `subtotal`: it is
       * what applies a rule's `free_over` threshold, and this form has no
       * agreed goods total to state. `calculate_totals()` computes the order's
       * on the far side of the save, so a subtotal sent from here would be the
       * panel adding prices up — which `lib/format/money.ts` opens by refusing
       * to do. The consequence is stated rather than hidden: a shop with a
       * free-shipping threshold sees the full delivery price in this box, and
       * the operator is the one who knows whether to zero it.
       */
      const result = await acRead<ShippingRate[]>(`/shipping/rates?${query.toString()}`);
      return result.data;
    },
  });

  return {
    rows: rates.data ?? [],
    /* Queued counts as loading. Without the `!same` term the fee would sit at
       the previous destination's price for 600 ms looking settled. */
    loading: !same || (settled !== null && rates.isFetching),
    failure: rates.isError ? (rates.error as Error).message : null,
    asked: settled !== null,
  };
}

export function CarrierFields({
  idPrefix,
  /** `GET /shipping/providers` — registration, and the list `POST /orders`
      validates against. Empty when the read failed or was never made. */
  providers,
  /** `ac_manage_shipping`. False degrades to the text field — see the docblock. */
  canQuote,
  provider,
  deliveryType,
  /* Two callbacks rather than one patch object, because the draft spells these
     `shippingProvider` and `deliveryType` and this control spells the first of
     them `provider`. A single partial would have made the caller translate one
     key and pass the other through, which is the kind of half-mapping that
     silently drops a field the day a third one is added. */
  onProviderChange,
  onDeliveryTypeChange,
  quotes,
  locale,
  /** `fields.shipping_provider` from a 400. The only refusal this block binds. */
  error,
  disabled = false,
}: {
  idPrefix: string;
  providers: ShippingProvider[];
  canQuote: boolean;
  provider: string;
  deliveryType: DeliveryType;
  onProviderChange: (next: string) => void;
  onDeliveryTypeChange: (next: DeliveryType) => void;
  quotes: ShippingQuotes;
  locale: string;
  error?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("orders.create.shipping");
  const tShipping = useTranslations("shipping");
  const tProvider = useTranslations("shippingProvider");
  const tDelivery = useTranslations("deliveryType");

  /*
   * The message key first, then the API's `label`, then the raw slug —
   * `lib/shipping.ts`'s `providerLabel`, unchanged. `manual` reads properly in
   * both languages; a courier arrives carrying its own brand in `label` and is
   * shown under that, because nobody translates "Yalidine".
   */
  const nameOf = (name: string) =>
    providerLabel(name, providers, (key) => (tProvider.has(key) ? tProvider(key) : null));

  /** What this courier charges for this journey, or `null`. */
  const quoteOf = (name: string) => quoteFor(quotes.rows, name, deliveryType);

  const chosen = quoteOf(provider);

  /*
   * Said under the picker, and it is one line rather than four states drawn in
   * four places: the control below never changes shape, so the sentence is the
   * only thing that moves. Ordered by what a reader most needs to know —
   * a failure over a pending request over an unanswerable question.
   */
  const note = !quotes.asked
    ? t("quotePrompt")
    : quotes.failure !== null
      ? undefined
      : quotes.loading
        ? t("quoting")
        : chosen === null
          ? t("quoteNone", { name: nameOf(provider) })
          : /* Which of the two answered, in the words the rules resolver
               already uses for the same field. `source` says who quoted, and
               the amount is spelled out under the pair rather than repeated
               here. */
            t("quoted", {
              source:
                chosen.source === "rules"
                  ? tShipping("sourceRules")
                  : tShipping("sourceProvider"),
            });

  return (
    <div className="flex flex-col gap-3">
      {canQuote ? (
        <Select
          id={`${idPrefix}-provider`}
          label={t("carrier")}
          value={provider}
          error={error}
          disabled={disabled}
          onChange={onProviderChange}
          options={[
            /* The explicit "not decided" option, and it is a real value rather
               than an absence. `OrderInput` drops `""` before the payload is
               assembled, so choosing it means the order names no courier —
               which `OrderPresenter` reads back as `null` and which the backend
               calls "an order whose courier is genuinely undecided". */
            { value: "", label: t("carrierNone") },
            ...providers.map((entry) => {
              const quote = quoteOf(entry.name);

              return {
                value: entry.name,
                label: nameOf(entry.name),
                /*
                 * **The price goes on the option's second line**, which is the
                 * whole answer to "which couriers serve this destination": a
                 * picker that made a person open four options one at a time to
                 * compare four prices would be a picker that hid the comparison
                 * it exists for.
                 *
                 * `secondary` rather than a suffix concatenated into `label`,
                 * and `ListboxOption`'s own docblock is the argument — it exists
                 * because "a picker built on an `<option>` has to concatenate
                 * two facts into a single string and hope". The hope here is a
                 * bidi one: `"Yalidine — 700,00 DA"` is a Latin run, a dash and
                 * a number inside an Arabic paragraph, and the algorithm is
                 * entitled to reorder the three. On its own line it is one run
                 * with nothing to be reordered against, under a `dir="auto"`
                 * the control already sets.
                 *
                 * It is also why the closed trigger stays clean: `Listbox`
                 * renders `selected.label` there and deliberately not the second
                 * line, so the field reads as a courier and the prices appear
                 * only while somebody is choosing between them.
                 *
                 * `undefined` while a lookup is queued or in flight, rather than
                 * a stale figure beside a destination that has already changed.
                 */
                secondary:
                  !quotes.asked || quotes.loading
                    ? undefined
                    : quote === null
                      ? t("carrierNoPrice")
                      : formatMoney(quote.amount, quote.currency, locale),
              };
            }),
          ]}
          hint={note}
        />
      ) : (
        /*
         * The `ac_manage_shipping` fallback. A text box, because the list this
         * would be built from is 403 — and a usable one, because the API's own
         * refusal is the vocabulary: `guardShippingProviderKnown()` answers
         * `fields.shipping_provider` = `"Available: manual."`, which binds to
         * this control through the error summary like any other 400.
         *
         * `isolate` for the reason `payment_method` has it: a provider slug is
         * a Latin identifier and must not be re-ordered by an Arabic paragraph
         * around it.
         */
        <TextField
          id={`${idPrefix}-provider`}
          label={t("carrier")}
          hint={t("carrierNoAccess")}
          value={provider}
          onChange={onProviderChange}
          error={error}
          disabled={disabled}
          isolate
        />
      )}

      {/*
        The journey. Drawn rather than defaulted, and the reason is that it
        changes the price twice over — `ShippingRule::matches()` tests a rule's
        own delivery type against the destination's, and a courier prices a
        doorstep and a desk differently by definition. A form that quoted the
        home price for a parcel the customer is collecting would be handing the
        operator a number that is wrong in the shop's favour and invisible.

        `CreateParcelDrawer` draws this same control against
        `POST /orders/{id}/shipments`, which is where the journey finally lands
        on something durable — `OrderInput::allowedFields()` has no
        `delivery_type`, so nothing about this choice reaches the order. The
        hint says so, because a control whose value silently evaporates on save
        is worse than no control.
      */}
      <Select<DeliveryType>
        id={`${idPrefix}-delivery-type`}
        label={tShipping("deliveryTypeLabel")}
        hint={t("deliveryTypeHint")}
        value={deliveryType}
        disabled={disabled}
        onChange={onDeliveryTypeChange}
        options={DELIVERY_TYPES.map((type) => ({ value: type, label: tDelivery(type) }))}
      />

      {/* The API's own sentence, in the danger tone, bound to neither control —
          §3.4 keeps a per-control error for a per-control fault, and nothing the
          operator chose is wrong here. `DestinationFields` renders its failure
          identically, and for the same reason the save is untouched by it. */}
      {quotes.failure !== null ? (
        <p className="text-ui-label text-ui-danger-fg">
          {t("quoteFailed", { message: quotes.failure })}
        </p>
      ) : null}

      {/* The chosen courier's price, spelled out under the pair. The option
          label carries it too, but a closed `Select` shows one option and this
          is the number that is about to land in the box below. */}
      {chosen !== null && !quotes.loading ? (
        <p className="text-ui-caption text-ui-subtle">
          {t("quotedAmount")}{" "}
          <Isolate numeric>{formatMoney(chosen.amount, chosen.currency, locale)}</Isolate>
        </p>
      ) : null}
    </div>
  );
}
