"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import type { Order, Wilaya } from "@/lib/api/schemas/order";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import {
  ErrorSummary,
  Section,
  Switch,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { useToast } from "@/components/primitives/Toast";
import { ADDRESS_KEYS, AddressFields, addressFieldId } from "../AddressFields";
import { CustomerPicker } from "../CustomerPicker";
import { bindRefusals, type AddressDraft } from "../new-order";
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
 * ## Seams the rest of item 1 lands in
 *
 * The line-item editor (step 2), the per-line manual price (step 3) and the
 * editable shipping cost (step 4) are **not** here, and the payload builder in
 * `order-edit.ts` cannot express any of them: its draft holds no lines and no
 * shipping amount, which is how "omit `line_items` entirely" is guaranteed
 * structurally rather than by a condition somebody has to keep right. Both of
 * those keys are gated on `is_editable` and these fields are not, so whatever
 * writes them is a second control with a second payload — see `order-edit.ts`.
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
  const tUi = useTranslations("ui");

  const router = useRouter();
  const toast = useToast();
  const { writesBlocked } = useOrderScreen();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<OrderEditDraft>(() => draftOf(order));
  /**
   * The API's refusals, keyed the way the API keys them, so a 400 naming
   * `billing.country` binds to the control that produced it through one map.
   */
  const [fields, setFields] = useState<Record<string, string>>({});
  /** A refusal with no field to bind to. See `onError` — it is reachable. */
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
    mutationFn: () => acWrite<Order>("PATCH", `/orders/${order.id}`, buildEditPayload(draft, order)),
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
    onError: (error: unknown) => {
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
      }

      /*
       * **A 400 with no `details` at all is reachable, and this is the fallback
       * that renders it.**
       *
       * `billing.email` has a hole: `Commerce\AddressInput::validateEmail()`
       * checks with `filter_var()` because that class must load without
       * WordPress, WooCommerce then checks again with `is_email()`, and the two
       * disagree — `a@b.c` and `a@[127.0.0.1]` pass the first and fail the
       * second. Such an address clears validation, `WC_Order::set_billing_email()`
       * throws a `WC_Data_Exception`, and `OrderService::save()` re-throws it as
       * `ApiException::invalidRequest($exception->getMessage())` **with no
       * details array**. The wire answer is `400 invalid_request "Invalid billing
       * email address"` and `details: null`, so a form binding only on
       * `fields["billing.email"]` shows the person *nothing at all* — the save
       * fails, the drawer stays open and no control reddens.
       *
       * Nothing is written when it happens — the whole PATCH rolls back, so a
       * customer note in the same body does not move either — which makes it a
       * display gap rather than a data one, and makes an unbound line an honest
       * thing to render. It goes to the summary as an orphan: §3.4's rule for a
       * failure with no control on screen, and the same slot `NewOrderDrawer`
       * gives its 409. The chrome around the sentence is localised; the sentence
       * itself is the API's own English, which names the problem precisely where
       * a translated generic would throw the only actionable part away.
       */
      setFields({});
      setRefusal(error instanceof Error ? error.message : t("failed"));
    },
  });

  const dirty = isEditDirty(draft, order);
  const busy = save.isPending || refreshing;

  /* Disabled with the reason, never hidden — §3.3. Two reasons, in the order
     they stop being true: no capability, no connection. There is no third: every
     field this form writes is writable in every status, which is exactly what
     the line items are not. */
  const blocked = !canWrite ? tOrders("readOnly") : writesBlocked;

  /**
   * Every refusal on screen, as `ErrorSummary` takes them.
   *
   * A field this form renders gets a link to its control; anything else — a key
   * from a 400 this drawer has no control for, or the `details`-less refusal
   * above — is listed as plain text. §3.4 is explicit that a link which goes
   * nowhere is worse than a line that does not claim to.
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
                save.mutate();
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
 * still name: `line_items` and `shipping_amount`, neither of which this body ever
 * carries and both of which would arrive as a 409 rather than as a field anyway.
 */
const FIELD_IDS: Record<string, string | undefined> = {
  customer_id: `${ID_PREFIX}-customer`,
  customer_note: `${ID_PREFIX}-note`,
  payment_method: `${ID_PREFIX}-payment-method`,
  payment_method_title: `${ID_PREFIX}-payment-title`,
  ...Object.fromEntries(
    (["billing", "shipping"] as const).flatMap((prefix) =>
      ADDRESS_KEYS.map((key) => [
        `${prefix}.${key}`,
        addressFieldId(ID_PREFIX, prefix, key),
      ]),
    ),
  ),
};
