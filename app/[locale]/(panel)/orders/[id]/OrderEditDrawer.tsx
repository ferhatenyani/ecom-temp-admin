"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import type { Order, Wilaya } from "@/lib/api/schemas/order";
import { DELIVERY_TYPES } from "@/lib/shipment-status";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import {
  ErrorSummary,
  Section,
  Select,
  Switch,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { useToast } from "@/components/primitives/Toast";
import { ADDRESS_KEYS, AddressFields, addressFieldId } from "../AddressFields";
import { CustomerPicker } from "../CustomerPicker";
import { DestinationFields } from "../DestinationFields";
import { bindRefusals, unkeyedRefusalField, type AddressDraft } from "../new-order";
import { useOrderScreen } from "./OrderScreen";
import {
  MAX_CUSTOMER_NOTE,
  buildEditPayload,
  draftOf,
  isEditDirty,
  type OrderEditDraft,
} from "./order-edit";

/**
 * Editing the fields of an existing order. `PATCH /orders/{id}`.
 *
 * ## Why a Drawer, and not a form down the middle of the detail screen
 *
 * Every value this form writes is **already on the detail screen as text**: the
 * aside's summary card carries the payment method, and its customer card carries
 * the name, phone, e-mail, wilaya, street and customer note. A form rendered
 * inline in the main column would put the same eleven address controls on screen
 * beside the eleven read-only rows that say the same thing — one screen stating
 * every address twice, in two different shapes, at two different scroll offsets.
 * A drawer keeps the split the screen already has: the page is the record, and
 * the drawer is the act.
 *
 * DESIGN.md §3.1 gives the Drawer "a create form long enough to need room", and
 * this is that form minus the two sections the detail owns — five sections, the
 * same eleven-field address block twice, and somebody reading an address back
 * off a phone call. `md` (520px) for `NewOrderDrawer`'s reason: the address rows
 * pair two fields side by side and 400px folds them.
 *
 * ## How it coexists with `OrderActions`, which is the other write in the header
 *
 * They are two acts and they stay two controls: the status Menu changes the
 * status, and this changes everything else. **This form never sends `status`.**
 * That is not tidiness — `Orders\OrderService::update()` runs `guardTransition()`
 * before every other guard, so a body carrying a refused move *and* a corrected
 * address reports only the move and the address silently does not land. It is
 * also the wrong shape for the person: two of the seven statuses are terminal and
 * `OrderActions` puts a `ConfirmDialog` in front of them, which a button labelled
 * "save" must not be hiding.
 *
 * The refusal is rendered **here**, in this drawer's own `ErrorSummary`, and not
 * through `OrderScreen`'s shared `refuse()` region. That region exists because
 * five controls scattered across two columns can each be refused 360px away from
 * where the eye is; a drawer is the opposite situation — it is modal, it is where
 * the person is looking, and §3.4 wants a failed submission summarised at the top
 * of the form it failed with focus moved there. `ErrorSummary` does both.
 *
 * ## The lines, the per-line price and the delivery fee are next door
 *
 * They are `OrderLinesDrawer`, opened from the `OrderItems` card, and the split
 * is the route's own: every field *this* form writes is writable in every
 * status, and those three are writable only while `WC_Order::is_editable()`.
 * One form with a permanently disabled half is worse than two forms, and on a
 * `completed` order — which is most of them — that half is what this would be.
 *
 * **This drawer still cannot emit `line_items` or `shipping_amount`, and the
 * guarantee has changed shape.** It used to be structural: `OrderEditDraft` had
 * no such fields, so no branch could get a condition wrong. The draft carries
 * both now, because one route deserves one payload builder and the editor writes
 * through the same one. What guarantees the keys stay out of *this* form's body
 * is the mechanism every other field here already relies on — the body is a diff
 * — plus the fact that this file draws no control for either, so the seeded
 * values and the stored ones are the same values. `order-edit.ts` argues it, and
 * `tests/order-edit.test.ts` asserts it on a `completed` order for every edit
 * this drawer can make.
 *
 * ## The destination arrived here, and it belongs here for the same rule
 *
 * `wilaya_id`, `commune_id` and `delivery_type` became writable on both verbs on
 * the carrier branch, and they landed in *this* drawer rather than in
 * `OrderLinesDrawer` because of the split the paragraph above draws: every field
 * this form writes is writable in every status, and the destination is now one
 * of them. `OrderService::guardDestinationResolves()` carries **no `is_editable`
 * gate** and its docblock says why in as many words — a gate *"would freeze it
 * at the exact moment it starts to matter"*, since both ways an order earns a
 * `shipping_provider_error` are recorded at `processing`, which is not editable.
 * Putting the destination behind the lines' gate would have re-imposed by hand
 * the exact restriction the API deliberately declined to impose.
 *
 * That also makes this drawer the second half of the parcels card's remedy for a
 * courier refusal, which is why `OrderScreen` now owns the `open` boolean rather
 * than this file.
 */
export function OrderEditDrawer({
  order,
  wilayas,
  locale,
  canWrite,
  canPickCustomers,
}: {
  order: Order;
  wilayas: Wilaya[];
  locale: string;
  /** `ac_manage_orders`. The same capability the status control requires. */
  canWrite: boolean;
  /** `ac_manage_customers`, for the picker. Resolved on the server. */
  canPickCustomers: boolean;
}) {
  const t = useTranslations("orders.edit");
  const tOrders = useTranslations("orders");
  const tDelivery = useTranslations("deliveryType");
  const tUi = useTranslations("ui");

  const router = useRouter();
  const toast = useToast();
  /*
   * The open state is `OrderScreen`'s and not this component's, which is the
   * one thing about this drawer that changed on the carrier branch.
   *
   * The trigger below is still the ordinary way in. The second way is the
   * parcels card's *"correct the destination"* remedy: when a courier refuses
   * an order's commune, the fix is `wilaya_id`/`commune_id` on
   * `PATCH /orders/{id}` — which `OrderService::guardDestinationResolves()`
   * leaves writable at every status precisely so this can happen — and those
   * two controls are in the section below. `OrderScreen`'s docblock carries the
   * argument for why a boolean crosses the screen rather than the operator.
   */
  const { writesBlocked, editing: open, setEditing: setOpen } = useOrderScreen();

  const [draft, setDraft] = useState<OrderEditDraft>(() => draftOf(order));
  /**
   * The API's refusals, keyed the way the API keys them, so a 400 naming
   * `billing.country` binds to the control that produced it through one map.
   */
  const [fields, setFields] = useState<Record<string, string>>({});
  /**
   * A refusal with genuinely no field to bind to — and the set of those got
   * smaller. The `details`-less billing-email 400 used to live here and is now a
   * `fields` entry; what is left is the `is_editable` 409 and the empty-body
   * 400. See `onError`, which argues the split.
   */
  const [refusal, setRefusal] = useState<string | null>(null);

  /* The order is a Server Component's data, so a save is followed by
     `router.refresh()` through a transition — the drawer's button can then hold
     its spinner for as long as the server actually takes. */
  const [refreshing, startRefresh] = useTransition();

  /** The trigger's DOM id, so the drawer hands the keyboard back to it. */
  const triggerId = useId();

  /*
   * Re-seeded when the drawer opens rather than by a `key` on the parent — the
   * trick `NewOrderDrawer` and `RestrictionPicker` both use, and for the same
   * reason: an effect would clear the form one frame after it appeared. It also
   * makes the drawer pick up a `router.refresh()` that landed while it was shut,
   * which is the state the status control leaves behind.
   */
  const [seededFor, setSeededFor] = useState(open);
  if (open !== seededFor) {
    setSeededFor(open);
    if (open) {
      setDraft(draftOf(order));
      setFields({});
      setRefusal(null);
    }
  }

  const patch = (next: Partial<OrderEditDraft>) =>
    setDraft((current) => ({ ...current, ...next }));

  const patchAddress = (which: "billing" | "shipping", next: Partial<AddressDraft>) =>
    setDraft((current) => ({ ...current, [which]: { ...current[which], ...next } }));

  const save = useMutation({
    /*
     * **The body is the variable rather than a closure over the draft.** It
     * matters more here than on the create form: `buildEditPayload` is a *diff*,
     * so "is there a billing email in this request" is not a question the draft
     * can answer — an order whose stored email is already bad but which nobody
     * touched sends no `billing` at all, and the refusal below cannot be about
     * it. `onError` has to see what was sent, not what is on screen.
     */
    mutationFn: (body: Record<string, unknown>) =>
      acWrite<Order>("PATCH", `/orders/${order.id}`, body),
    onSuccess: () => {
      toast.show(t("saved"));
      setOpen(false);
      /*
       * The response carries the updated order and it is deliberately not used
       * to seed the form. The screen behind the drawer is server-rendered — the
       * aside, the totals, the timeline this write just added a row to — and
       * only a refresh makes all of them agree. The drawer re-seeds from the
       * refreshed `order` the next time it opens.
       */
      startRefresh(() => router.refresh());
    },
    onError: (error: unknown, body: Record<string, unknown>) => {
      if (error instanceof BrowserApiError) {
        const refused = error.fields;
        if (refused !== null && Object.keys(refused).length > 0) {
          /* Re-keyed before it is bound: while "same as billing" is on, one bad
             value comes back as two refusals and the second has no control on
             screen to point at. `bindRefusals` carries that measurement, and it
             is the create drawer's function unchanged — the defect is a property
             of the switch, not of which route the body went to. */
          setFields(bindRefusals(refused, draft.shippingSameAsBilling));
          setRefusal(null);
          return;
        }

        /*
         * **A 400 with no `details` at all is reachable, and it now points at a
         * control instead of at nothing.**
         *
         * `billing.email` has a hole: `Commerce\AddressInput::validateEmail()`
         * checks with `filter_var()` because that class must load without
         * WordPress, WooCommerce then checks again with `is_email()`, and the
         * two disagree — `a@b.c` and `a@[127.0.0.1]` pass the first and fail the
         * second. Such an address clears validation,
         * `WC_Order::set_billing_email()` throws a `WC_Data_Exception`, and
         * `OrderService::save()` re-throws it as
         * `ApiException::invalidRequest($exception->getMessage())` **with no
         * details array**. The wire answer is `400 invalid_request "Invalid
         * billing email address"` and `details: null`.
         *
         * **This block used to end here**, with `setFields({})` and the sentence
         * as an orphan summary line, on the argument that §3.4 prefers plain
         * text to a link that goes nowhere. That argument is sound and the
         * premise was the mistake: the link does **not** go nowhere. There is a
         * control on this screen holding the exact value the API refused, and
         * `FIELD_IDS` has mapped `billing.email` to it since the drawer was
         * built — nothing was missing except the key.
         *
         * So the refusal joins `fields` like any other 400 and the orphan branch
         * below keeps only what genuinely has no control: the `is_editable` 409,
         * and the empty-body 400 that `isEditDirty` is supposed to make
         * unreachable. `unkeyedRefusalField` argues the discrimination between
         * the two `details`-less refusals, and argues why the message string is
         * never read.
         *
         * **One entry, not an entry and a line.** The failure count and the
         * marked box are the same refusal, and `bindRefusals` is the measurement
         * that says what happens when they are not: *"2 champs empêchent
         * l'enregistrement"* for one bad value.
         *
         * Nothing is written when it happens — the whole PATCH rolls back, so a
         * customer note in the same body does not move either — which is why
         * pointing at the box is safe to do. The sentence itself stays the API's
         * own English, which names the problem precisely where a translated
         * generic would throw the only actionable part away.
         */
        const key = unkeyedRefusalField(error.status, body);
        if (key !== null) {
          setFields({ [key]: error.message });
          setRefusal(null);
          return;
        }
      }

      /* Everything with nothing to bind: the `is_editable` 409, the empty-body
         400, and any non-API failure. §3.4 renders a failure with no control on
         screen as plain text rather than as a link that goes nowhere. */
      setFields({});
      setRefusal(error instanceof Error ? error.message : t("failed"));
    },
  });

  const dirty = isEditDirty(draft, order);
  const busy = save.isPending || refreshing;

  /* Disabled with the reason, never hidden — §3.3. Two reasons, in the order
     they stop being true: no capability, no connection. There is no third,
     because every field this form writes is writable in every status —
     `OrderLinesDrawer` is the control that has the third, and it is disabled
     with the sentence its own card already prints. */
  const blocked = !canWrite ? tOrders("readOnly") : writesBlocked;

  /**
   * Every refusal on screen, as `ErrorSummary` takes them.
   *
   * A field this form renders gets a link to its control; anything else — a key
   * from a 400 this drawer has no control for, or a refusal about the *order*
   * rather than about a value — is listed as plain text. §3.4 is explicit that a
   * link which goes nowhere is worse than a line that does not claim to.
   *
   * **This block used to name the `details`-less refusal as an example of the
   * second kind, and it is now an example of the first.** `onError` gives it the
   * `billing.email` key, so it arrives here through `fields` and is linked like
   * any other 400 — one entry, one line, one marked box. What is left in the
   * `refusal` slot is the `is_editable` 409 and the empty-body 400, which really
   * do name nothing on this screen.
   */
  const failures: FormFailure[] = [
    ...(refusal ? [{ message: t("refusedNoField", { message: refusal }) }] : []),
    ...Object.entries(fields).map(([key, message]) => ({
      id: FIELD_IDS[key],
      label: FIELD_IDS[key] ? undefined : key,
      message,
    })),
  ];

  const note = draft.customerNote.trim();

  return (
    <>
      <Button
        id={triggerId}
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={blocked !== null}
        title={blocked ?? undefined}
      >
        {t("action")}
      </Button>

      <Drawer
        open={open}
        onOpenChange={setOpen}
        title={t("title", { number: order.number })}
        description={t("description")}
        size="md"
        returnFocusTo={triggerId}
        footer={
          <>
            {/* Cancel first in DOM order: first tab stop, and the drawer's
                `flex-col-reverse` footer puts the confirming button away from
                the thumb on a phone. */}
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={save.isPending}
            >
              {tUi("cancel")}
            </Button>
            <Button
              onClick={() => {
                setRefusal(null);
                setFields({});
                /* Built here rather than in `mutationFn`, so the body the
                   request carries and the body `onError` reasons about are the
                   same object. */
                save.mutate(buildEditPayload(draft, order));
              }}
              loading={busy}
              disabled={!dirty}
              /* Not "nothing to save" as a scold: the API answers an empty body
                 with 400 "No supported fields were provided.", so a save that
                 could fire while clean would be a request whose only possible
                 outcome is a refusal. `isEditDirty` is the builder's own
                 answer, so the button and the body cannot disagree. */
              title={dirty ? undefined : t("nothingToSave")}
            >
              {t("submit")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <ErrorSummary failures={failures} />

          {/* ────────────────────────────────────────────────────── client ─── */}
          <Section title={t("customer.title")} description={t("customer.description")}>
            <CustomerPicker
              id={FIELD_IDS.customer_id}
              customerId={draft.customerId}
              onChange={(next) => patch({ customerId: next })}
              /* The order already carries the address the shopper gave, so
                 re-attributing it to another account copies nothing: a person
                 correcting *who* an order belongs to has not asked for it to be
                 delivered somewhere else. The create drawer copies, because a
                 blank form has nothing to lose. */
              onChoose={(customer) => patch({ customerId: customer.id })}
              canPick={canPickCustomers}
              enabled={open}
              error={fields.customer_id}
              disabled={save.isPending}
            />
          </Section>

          {/* ───────────────────────────────────────────────── facturation ─── */}
          <Section title={t("billing.title")}>
            <AddressFields
              idPrefix={ID_PREFIX}
              prefix="billing"
              value={draft.billing}
              onChange={(next) => patchAddress("billing", next)}
              fields={fields}
              wilayas={wilayas}
              locale={locale}
              email
              disabled={save.isPending}
            />
          </Section>

          {/* ─────────────────────────────────────────────────── livraison ─── */}
          <Section title={t("shipping.title")}>
            <div className="flex flex-col gap-3">
              <Switch
                label={t("shipping.same")}
                /* The e-mail is dropped on the way out, never copied — the API
                   refuses one on a shipping address by name. `addressDiff`
                   carries the measurement. */
                hint={t("shipping.sameWhy")}
                checked={draft.shippingSameAsBilling}
                onChange={(same) => patch({ shippingSameAsBilling: same })}
                disabled={save.isPending}
              />
              {draft.shippingSameAsBilling ? null : (
                <AddressFields
                  idPrefix={ID_PREFIX}
                  prefix="shipping"
                  value={draft.shipping}
                  onChange={(next) => patchAddress("shipping", next)}
                  fields={fields}
                  wilayas={wilayas}
                  locale={locale}
                  email={false}
                  disabled={save.isPending}
                />
              )}
            </div>
          </Section>

          {/* ───────────────────────────────────────────────── destination ─── */}
          {/*
            Its own section, directly under the shipping address and
            deliberately not inside it.

            The two look alike and are not the same fact, which is the confusion
            this section has to survive rather than create. `shipping.state` and
            `shipping.city` above are **free text a shopper typed** — a wilaya
            name and a commune name, validated for shape and nothing else
            (`Commerce\AddressInput` says so in terms), and `state` is empty on
            ~92 % of orders. These two are **rows of the geography tables** and
            are the only thing a courier can be routed on: `OrderInput`'s
            docblock gives the reader the tell — *`_id` means a row, and a row is
            what gets routed* — and `Shipping\Destination`'s explains why one
            cannot be derived from the other, *"Ouled Fayet" spelled six ways
            across three couriers and two languages*, with several communes of
            one name in different wilayas.

            So: a separate heading, a description that says what it is for, and
            no synchronisation in either direction. The create drawer seeds the
            address *from* the destination on a blank form — additive, once,
            never over a filled field — and this form does not, for
            `CustomerPicker`'s reason one section up: an existing order already
            has an address somebody wrote, and correcting where the parcel goes
            is not a request to rewrite it.

            This is the retry path. An order refused with *"commune introuvable"*
            is corrected here and gets its parcel on the next confirmation — or
            straight away through the parcels card's manual route, which is the
            one that does not need the order to leave `processing` first.
          */}
          <Section title={t("destination.title")} description={t("destination.description")}>
            <div className="flex flex-col gap-3">
              <DestinationFields
                idPrefix={ID_PREFIX}
                wilayas={wilayas}
                wilayaId={draft.wilayaId}
                communeId={draft.communeId}
                onChange={(next) =>
                  patch({ wilayaId: next.wilayaId, communeId: next.communeId })
                }
                locale={locale}
                /* No commune list is fetched for a drawer nobody has opened —
                   the same gate `CustomerPicker` above takes. */
                enabled={open}
                disabled={save.isPending}
              />
              <Select
                id={FIELD_IDS.delivery_type}
                label={t("destination.deliveryType")}
                value={draft.deliveryType}
                onChange={(next) => patch({ deliveryType: next })}
                error={fields.delivery_type}
                disabled={save.isPending}
                /*
                  A third option for "the order does not say", because that is a
                  real value the presenter emits and not a stand-in for `home`.
                  `OrderInput` refuses to default this and argues why —
                  `ShipmentSubscriber::destinationOf()` already falls back to
                  `Destination::HOME` and a second default *"would make a
                  back-office order claim a journey nobody chose"*. Choosing it
                  back is not possible over this route (an empty value is
                  dropped, like the two ids above), so the option is how an
                  unstated order opens rather than a way to un-state one.
                */
                options={[
                  { value: "", label: t("destination.deliveryTypeUnset") },
                  ...DELIVERY_TYPES.map((type) => ({
                    value: type,
                    label: tDelivery(type),
                  })),
                ]}
              />
              <p className="text-ui-label text-ui-subtle">{t("destination.hint")}</p>
            </div>
          </Section>

          {/* ──────────────────────────────────────────────────── paiement ─── */}
          <Section title={t("payment.title")}>
            <div className="flex flex-col gap-3">
              {/*
                Two text fields and not a picker, for `NewOrderDrawer`'s reason:
                the only payment method this shop has a translated name for is
                `cod`, and `/payments/methods` — which would publish the real
                list — is `ac_manage_payments`, a capability neither `Manager`
                nor `Order Manager` holds. A two-row picker built from the one
                word the panel happens to know would be a vocabulary the panel
                invented.
              */}
              <TextField
                id={FIELD_IDS.payment_method}
                label={t("payment.method")}
                hint={t("payment.methodHint")}
                value={draft.paymentMethod}
                onChange={(next) => patch({ paymentMethod: next })}
                error={fields.payment_method}
                disabled={save.isPending}
                isolate
              />
              <TextField
                id={FIELD_IDS.payment_method_title}
                label={t("payment.methodTitle")}
                value={draft.paymentMethodTitle}
                onChange={(next) => patch({ paymentMethodTitle: next })}
                error={fields.payment_method_title}
                disabled={save.isPending}
              />
            </div>
          </Section>

          {/* ──────────────────────────────────────────────────────── note ─── */}
          <Section title={t("note.title")}>
            <TextArea
              id={FIELD_IDS.customer_note}
              label={t("note.label")}
              value={draft.customerNote}
              onChange={(next) => patch({ customerNote: next })}
              rows={4}
              hint={t("note.hint", { limit: MAX_CUSTOMER_NOTE })}
              error={fields.customer_note}
              disabled={save.isPending}
              /* The cap is the API's and it refuses with a 400, so the limit has
                 to be visible *before* the refusal rather than surfaced as one.
                 The note is trimmed before it is measured against the cap —
                 `OrderInput::normalize()` trims first — so the counter counts
                 the trimmed length, which is the number the API will use. */
              counter={{
                length: note.length,
                limit: MAX_CUSTOMER_NOTE,
                label: t("note.count", {
                  count: note.length,
                  limit: MAX_CUSTOMER_NOTE,
                }),
              }}
            />
          </Section>
        </div>
      </Drawer>
    </>
  );
}

/** This form's DOM id namespace. See `addressFieldId` — the create drawer's is
    `new-order`, and two drawers must not mint the same id for two controls. */
const ID_PREFIX = "order-edit";

/**
 * The DOM ids the error summary links to, keyed by the API's own field names.
 *
 * A map rather than a convention, because the two namespaces are not the same
 * shape: the API says `billing.country` and a DOM id cannot carry a dot without
 * `getElementById` still working while `#billing.country` selects a class. Every
 * key absent from here renders in the summary as text — which is exactly right
 * for a field this form does not draw, and there are two of those the API can
 * still name: `line_items` and `shipping_amount`. Neither can reach this body —
 * the draft seeds both from the order and this form draws no control for either,
 * so the diff on them is always empty — and both would arrive as a 409 rather
 * than as a field anyway. `OrderLinesDrawer` is where they are bound.
 */
const FIELD_IDS: Record<string, string | undefined> = {
  customer_id: `${ID_PREFIX}-customer`,
  customer_note: `${ID_PREFIX}-note`,
  payment_method: `${ID_PREFIX}-payment-method`,
  payment_method_title: `${ID_PREFIX}-payment-title`,
  /* `DestinationFields` derives both of its ids off `idPrefix` — `-wilaya` and
     `-commune`, character for character — and the create drawer maps them the
     same way. `delivery_type` is this form's own select. */
  wilaya_id: `${ID_PREFIX}-wilaya`,
  commune_id: `${ID_PREFIX}-commune`,
  delivery_type: `${ID_PREFIX}-delivery-type`,
  ...Object.fromEntries(
    (["billing", "shipping"] as const).flatMap((prefix) =>
      ADDRESS_KEYS.map((key) => [
        `${prefix}.${key}`,
        addressFieldId(ID_PREFIX, prefix, key),
      ]),
    ),
  ),
};
