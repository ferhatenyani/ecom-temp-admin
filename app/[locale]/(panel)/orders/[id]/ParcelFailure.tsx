"use client";

import { useTranslations } from "next-intl";
import { providerLabel, type FailureReading } from "@/lib/shipping";
import type { ShippingProvider } from "@/lib/api/schemas/shipping";
import { formatWhen } from "@/lib/format/date";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/primitives/Icon";
import { Isolate } from "@/components/primitives/Ltr";
import { useOrderScreen } from "./OrderScreen";

/**
 * Why confirmation created no parcel — step 2's admin sub-task 4, the half the
 * parcel list cannot show.
 *
 * ## What this exists for
 *
 * Confirming an order now creates its parcel by itself, so the interesting state
 * on this card is no longer *"here are the parcels"* — it is **the order that
 * has none and should have had one**. Without this block that order is
 * indistinguishable from an order nobody has dispatched yet: the same empty
 * list, the same absent tracking number, and an operator left to guess between
 * "the courier refused it", "nobody named a courier", "the address has no
 * commune on it" and "it just has not happened yet". Those four have four
 * different answers and only one of them is *wait*.
 *
 * ## The step's citation is false, and this is built for what we have instead
 *
 * `changes.md` says EL *"raises this as a toast on the status change
 * (`EL/el-admin-app/src/pages/Orders.jsx::handleUpdateStatus`)"*. It does not,
 * and the file was read to check: `shippingProviderError` appears nowhere in
 * `el-admin-app/src/` at all. `handleUpdateStatus` infers a failure from a
 * **missing tracking number** and shows one fixed sentence, discarding whatever
 * the courier said. So there is nothing to copy here, and copying it would have
 * been a downgrade twice over:
 *
 *  - **A toast is the wrong container.** DESIGN.md §3.1: an error a person must
 *    act on is never a toast. This one outlives the request that caused it by
 *    design — see below — so a message that disappears in four seconds would
 *    throw away the only durable record on the screen.
 *  - **A toast can only be raised by the person who caused it.** Ours is
 *    recorded by a WooCommerce status transition, which fires from wp-admin,
 *    WP-CLI, cron and payment gateways as well as from this panel
 *    (`Shipping\ShipmentSubscriber`, read from source). Most of the failures
 *    this shop will produce have no HTTP response and no operator watching.
 *    `OrderPresenter::shippingProviderError()` says it outright: the stored
 *    version is *"still there tomorrow, on a `GET`, for an operator who was not
 *    the person who confirmed the order."*
 *
 * ## Four lines, in the order somebody reads them
 *
 *   the sentence      `message` — ours, and it names the shape of the problem.
 *   the courier's     `provider_message`, when non-null. This is the actionable
 *                     half and the backend argues so at length: *"'Yalidine
 *                     would not create this parcel' is our message and it is not
 *                     actionable; 'commune introuvable' is theirs and it tells
 *                     the operator which field to fix."* It is rendered
 *                     `dir="auto"` and never translated — a courier's own words,
 *                     in whatever language it said them.
 *   who and when      the courier's label and `at`, together, because neither is
 *                     useful alone on an order that has been tried more than
 *                     once.
 *   the remedy        one button. `readFailure` decided which.
 *
 * ## Staleness, which is the thing that had to be designed rather than rendered
 *
 * `lib/shipping.ts`'s `readFailure` carries the whole argument; this file is
 * what it looks like. In short, the value is only ever cleared by a later
 * confirmation that finds a parcel, so it can be a week old and say nothing
 * about it. Three consequences here:
 *
 *  - `at` always appears. `formatWhen` reads relatively under a day and
 *    absolutely after, so an old failure renders as a date and not as a bare
 *    sentence.
 *  - An **undated** failure prints a line saying the time was not recorded,
 *    rather than printing nothing. Printing nothing is exactly how a week-old
 *    error reads as this morning's, which is the failure mode the backend
 *    flagged when it handed this over.
 *  - When the order has a **live parcel**, the block drops to a quiet history
 *    line in the neutral tone and offers no remedy at all. A parcel in the air
 *    answers the question this block asks, and a remedy button beside one is an
 *    invitation to send a second box.
 *
 * ## Tone, and why the open state is a warning rather than a danger
 *
 * §3.4 keeps `--color-danger` for a refusal of something the person just did.
 * This is not that: the status change **committed** — `ShipmentSubscriber` never
 * throws and the docblock explains that the row is written before the hook even
 * runs — and the order is fine. What did not happen is the parcel. So it is a
 * warning: something needs doing, nothing was lost, and the red on this screen
 * stays reserved for `OrderNotices`, where a refusal of the operator's own act
 * belongs.
 */
export function ParcelFailure({
  reading,
  providers,
  locale,
  /** Opens `CreateParcelDrawer`. The card owns it, so the card passes it down. */
  onCreateParcel,
  /** `null` when the manual route is refused, carrying the reason — a missing
      capability, no connection, or a parcel already in the air. */
  createBlocked,
  /**
   * `ac_manage_orders`, for the *other* remedy.
   *
   * This card is behind `ac_manage_shipping` and correcting a destination is a
   * `PATCH /orders/{id}`, so the two buttons here answer to two different
   * capabilities. No role reaches the gap today — `Capabilities::roles()` gives
   * `ac_manage_shipping` to all four roles that hold `ac_manage_orders`, read
   * from source — but capabilities are resolved per *user* from `/auth/me` and
   * not per role, and a remedy that opened a drawer whose own save button is
   * disabled is worse than one that says why up front. `CarrierFields` makes the
   * same argument about the same kind of gap in the other direction.
   */
  canEditOrder,
}: {
  reading: FailureReading;
  providers: ShippingProvider[];
  locale: string;
  onCreateParcel: () => void;
  createBlocked: string | null;
  canEditOrder: boolean;
}) {
  const t = useTranslations("shipping.failure");
  const tProvider = useTranslations("shippingProvider");
  const tOrders = useTranslations("orders");
  const { setEditing, writesBlocked } = useOrderScreen();

  if (reading.state === "none") return null;

  const { failure, dated } = reading;

  const courier = providerLabel(failure.provider, providers, (key) =>
    tProvider.has(key as "manual") ? tProvider(key as "manual") : null,
  );

  /* The "when" clause, built once because both states print it. An undated
     failure says so in words — see the docblock; a blank is the bug. */
  const when = dated ? (
    <Isolate>{formatWhen(failure.at, locale)}</Isolate>
  ) : (
    t("undated")
  );

  /*
   * ── answered ────────────────────────────────────────────────────────────
   *
   * A live parcel exists, so this is what went wrong *before* the one that
   * worked. One line, neutral, no buttons. It is still shown rather than
   * hidden, because "Yalidine refused this address on Tuesday and it went out
   * with the in-house driver on Wednesday" is the sentence an operator taking a
   * customer's phone call needs.
   */
  if (reading.state === "answered") {
    return (
      <p className="mb-3 flex min-w-0 items-start gap-2 border-b border-ui-line pb-3 text-ui-label text-ui-subtle">
        <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 break-words">
          {t("answered", { courier })}
          <span aria-hidden="true"> · </span>
          {when}
        </span>
      </p>
    );
  }

  /* Each remedy carries its own refusal, because they are two acts on two
     routes behind two capabilities. `OrderEditDrawer` computes the second one
     identically for its own trigger — same order, capability before
     connection — so the button here and the button in the header cannot say
     different things about the same drawer. */
  const remedyBlocked =
    reading.remedy === "parcel"
      ? createBlocked
      : !canEditOrder
        ? tOrders("readOnly")
        : writesBlocked;

  return (
    <div className="mb-4 flex min-w-0 flex-col gap-2 rounded-ui-lg border border-ui-line bg-ui-warning-bg px-4 py-3 text-ui-warning-fg">
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-ui-subheading">{t("title")}</span>
          {/*
            The API's own sentence, in the API's own English, exactly as
            `OrderEditDrawer` renders a `details`-less 400 and for the same
            reason: a translated generic would throw away the only part that
            names the problem. The chrome around it is localised.
          */}
          <span dir="auto" className="text-ui-body break-words">
            {failure.message}
          </span>
          {/*
            The courier's own words, when it said any. Never translated, and
            `dir="auto"` because a French adapter message and an Arabic one are
            both possible in one shop — the two adapters publish this key
            deliberately (`YalidineProvider::createShipment()` writes it,
            `ZRExpressProvider` reads its own back), and it is the one place
            `ShippingProviderInterface`'s "never let a raw provider message
            reach the response body" rule is waived on purpose.
          */}
          {failure.provider_message ? (
            <span dir="auto" className="text-ui-compact break-words">
              {failure.provider_message}
            </span>
          ) : null}
          {/* Wraps rather than truncating: at 340px the courier and the time
              share this line and neither is guessable from the other. */}
          <span className="text-ui-label break-words">
            {courier}
            <span aria-hidden="true"> · </span>
            {when}
          </span>
        </div>
      </div>

      {/*
        One button, and it is the one `readFailure` chose. Two buttons would ask
        the operator to make the diagnosis the code already made — and the
        second sentence under it names the other move for the case where the
        first is not enough, which is what a person actually needs: *do this
        now, and also fix that so it stops happening*.
      */}
      <div className="flex flex-col gap-1.5 ps-6">
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={remedyBlocked !== null}
          title={remedyBlocked ?? undefined}
          onClick={() => {
            if (reading.remedy === "parcel") onCreateParcel();
            else setEditing(true);
          }}
        >
          {reading.remedy === "parcel" ? t("createByHand") : t("fixDestination")}
        </Button>
        <span className="text-ui-label">
          {reading.remedy === "parcel" ? t("alsoFixDestination") : t("alsoCreateByHand")}
        </span>
      </div>
    </div>
  );
}
