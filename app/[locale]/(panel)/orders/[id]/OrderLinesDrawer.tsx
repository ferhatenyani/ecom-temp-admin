"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import type { Order } from "@/lib/api/schemas/order";
import type { Product } from "@/lib/api/schemas/product";
import { SHOP_CURRENCY, formatMoney } from "@/lib/format/money";
import { Drawer } from "@/components/ui/Overlay";
import { Button, IconButton } from "@/components/ui/Button";
import {
  ErrorSummary,
  NumberField,
  Section,
  Stepper,
  type FormFailure,
} from "@/components/ui/Form";
import { EmptyState, Notice } from "@/components/ui/States";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { ProductPicker, type PickedProduct } from "../ProductPicker";
import { useOrderScreen } from "./OrderScreen";
import {
  MAX_AMOUNT,
  addPickedLine,
  buildEditPayload,
  draftOf,
  isEditDirty,
  lineProblems,
  type LineDraft,
  type OrderEditDraft,
} from "./order-edit";

/**
 * The line-item editor. `PATCH /orders/{id}`, `line_items` and
 * `shipping_amount`.
 *
 * ## Why this is a second control and not a section of `OrderEditDrawer`
 *
 * The two forms write through one route and are gated by two different rules,
 * and that is the whole argument. Every field the edit drawer writes — the
 * customer, both addresses, the payment pair, the note — is writable in **every**
 * status, because `OrderService::update()` gates none of them; the two fields
 * here are writable only while `WC_Order::is_editable()`, which is `pending` and
 * `on-hold` and nothing else. Folding these into that drawer would give the
 * panel one form with a permanently disabled half on the great majority of
 * orders, and a person opening it on a `completed` order would meet four dead
 * controls with a sentence explaining them.
 *
 * They also fail differently. A refusal here is a **409 about the order** — its
 * status — where the edit drawer's refusals are 400s about values. §3.4's error
 * summary is the same component either way; what differs is that no amount the
 * person retypes will make a 409 go away, and a form that mixed the two kinds
 * would have to say so per control. (Until the fix round the stock it is holding
 * was a second such 409; decision 1 removed it, and the section below says what
 * took its place.)
 *
 * `order-edit.ts` holds the payload for both, deliberately. One route deserves
 * one answer to "which keys reach the wire", and the rule that used to be
 * guaranteed by the draft having no lines is now guaranteed by the draft being
 * **diffed**: `linesChanged()` is false for a form that seeds from an order and
 * never draws a lines control, so `OrderEditDrawer` still cannot emit
 * `line_items` however it is edited. That file argues it at length.
 *
 * ## Where the trigger is, and why it is not in the header
 *
 * In `OrderItems`' own card, through `Card`'s `actions` slot. §3.3 allows one
 * primary action per view and the header already holds two — the status menu,
 * which is the primary, and the edit drawer beside it. A third would make the
 * header the place where everything happens and the page a thing to scroll past.
 *
 * It belongs on the card for a better reason than crowding, though: **the
 * disabled reason is already printed there**. `OrderItems` renders the footnote
 * "the stock has moved, so the lines are fixed" whenever `is_editable` is false,
 * and this control is disabled for exactly that condition — so the button and
 * the sentence explaining it are the same six inches of screen, and they cannot
 * drift because both read `orders.detail.editableNo`.
 *
 * ## The two refusals this binds, and the state it now warns about instead
 *
 * Read from source, and measured in-process via `rest_do_request()` where the
 * suite covers it (`ecom-temp`'s `tests/Api/orders.php`). The transport is
 * measured over HTTP as of the fix round — see `BLOCKED.md`, which no longer
 * refuses that phrase for authentication — but these particular field shapes
 * are not, and the distinction is the point of saying it.
 *
 *  1. **Per-field 400s.** `line_items.{n}.quantity`, `line_items.{n}.price`,
 *     `line_items.{n}.product_id` and `shipping_amount`, each bound to the
 *     control that produced it through `fieldId()`. The API's own sentences —
 *     "Must be an amount.", "Cannot be negative.", "Is implausibly large." — are
 *     rendered rather than replaced, because they name which of three things is
 *     wrong and a translated generic would throw that away.
 *  2. **The `is_editable` 409.** Reachable here only by racing: the trigger is
 *     disabled when the order is not editable, but the page is server-rendered
 *     and somebody else can move the status between the render and the save. It
 *     has no field, so it goes to the summary as an orphan line.
 *
 * **There was a third, and the fix round's decision 1 removed it.** Backend step
 * 6's `guardManualPricesWritable()` answered a 409 for a *stated* price on an
 * order already holding stock, carrying `details.lines`, and this form bound
 * both halves — an orphan sentence and a note on each named price box. That
 * argument is kept where it can still be read, in `onError` and in the backend's
 * own `OrderService::snapshot()`.
 *
 * What replaced it is the reason this section is worth reading twice: **warn,
 * allow, record.** The quantity and the delivery fee were never gated by that
 * guard, so four kettles becoming forty moved the total by 54 000 DZD in
 * silence while a 1 DZD reprice on the same order was refused. Three writes that
 * move the same total now behave the same way — the edit lands, the warning
 * below names what is reserved before anybody types, and
 * `OrderService::snapshot()` records `manual_prices` and `stock_reduced` so the
 * change is attributable afterwards. An order paused awaiting confirmation is
 * exactly when an amendment happens, and refusing one there cost the operator
 * the case the route exists for.
 *
 * The warning stays a warning and never a disabled field, which was already the
 * right shape for the old rule and is more clearly right for this one: nothing
 * here is forbidden, so a dead control would say something false. It reads from
 * `order.stock_reduced` — WooCommerce's own flag, never a set of status names.
 *
 * ## The merge rule that never matched, now fixed and moved
 *
 * `addLine` used to merge a second press into *the first row for that product
 * carrying no manual price*, and the reasoning written beside it was sound: an
 * empty price box means the catalogue prices that line, and merging into a
 * hand-priced row would give the extra unit away at somebody's discount.
 *
 * **The rule was right and it never fired.** Every row the picker adds is seeded
 * from the catalogue in the same function, so `price.trim() === ""` is true only
 * of rows that arrived on the order from the API with no override. Press *add*
 * twice on a product the order did not already contain and two rows open where
 * the second press plainly meant quantity 2 — the ordinary case, broken, on the
 * one form that draws a line editor.
 *
 * It is now `order-edit.ts`'s `addPickedLine`, tested there as the pure list
 * arithmetic it is, and stated as one condition rather than two: **a row absorbs
 * the press when it is already charging, per unit, what the new row would
 * charge.** The old rule survives inside that as the case where a row's price is
 * `""` and the seed is what the catalogue asks — the same number, said two ways —
 * so nothing the old argument protected was traded away.
 *
 * ## No money is computed here, and that is item 1 sub-task 5
 *
 * There is no subtotal in this drawer and no total. The form states a quantity,
 * an optional unit price and a delivery fee; what the order *costs* is the sum
 * the server does, over lines it priced from the catalogue where nobody
 * overrode them. The 200 carries the real figure and the toast names it, the
 * detail's `<tfoot>` re-renders from the refreshed order, and nothing in the
 * panel adds two amounts together — `lib/format/money.ts` opens by refusing to.
 */
export function OrderLinesDrawer({
  order,
  locale,
  canWrite,
  canPickProducts,
}: {
  order: Order;
  locale: string;
  /** `ac_manage_orders`. The same capability the status control requires. */
  canWrite: boolean;
  /** `ac_manage_products`, for the picker. Resolved on the server. */
  canPickProducts: boolean;
}) {
  const t = useTranslations("orders.lines");
  const tDetail = useTranslations("orders.detail");
  const tOrders = useTranslations("orders");
  const tUi = useTranslations("ui");

  const router = useRouter();
  const toast = useToast();
  const { writesBlocked } = useOrderScreen();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<OrderEditDraft>(() => draftOf(order));
  /** The API's refusals and the form's own, keyed the way the API keys them. */
  const [fields, setFields] = useState<Record<string, string>>({});
  /** A refusal with no field to bind to — both 409s arrive this way. */
  const [refusal, setRefusal] = useState<string | null>(null);

  /* The order is a Server Component's data, so a save is followed by
     `router.refresh()` through a transition — the button holds its spinner for
     as long as the server actually takes. */
  const [refreshing, startRefresh] = useTransition();

  const triggerId = useId();

  /*
   * Re-seeded when the drawer opens rather than by a `key` on the parent — the
   * trick `OrderEditDrawer` and `NewOrderDrawer` both use, and for the same
   * reason: an effect would clear the form one frame after it appeared.
   *
   * **It is load-bearing here in a way it is not there.** Line ids churn on
   * every write that names `line_items` — an identical replace returns new ones
   * — and the quantities and prices this form holds are the ones the last save
   * produced. Re-seeding on open is what guarantees the draft is never built on
   * a stale read, and the draft carries no ids at all so there is nothing to
   * carry across a write even by accident.
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

  /**
   * What the panel knows the catalogue is asking, by product id.
   *
   * Filled from the picker alone — `LineDraft.cataloguePrice` carries the full
   * argument, and the short version is that the order's read shape does not
   * publish a catalogue price and `/products` has no `include`, so a batched
   * lookup does not exist and a per-line one is a request per row. Every search
   * the operator runs teaches this map for free, and a line whose product has
   * never appeared in a result stays unlabelled rather than guessed at.
   */
  function learnPrices(products: Product[]) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => {
        const seen = products.find((product) => product.id === line.productId);
        return seen === undefined || seen.price === ""
          ? line
          : { ...line, cataloguePrice: seen.price };
      }),
    }));
  }

  /**
   * Edit one line in place, by its own key rather than by its index.
   *
   * Index would work today and is the wrong habit on this form: the indices are
   * what the *API* keys its refusals by, and the keys are what React reconciles
   * by, and a handler that mixed the two would be correct until somebody
   * reordered a row.
   */
  const patchLine = (key: number, next: Partial<LineDraft>) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...next } : line)),
    }));

  /**
   * Add or remove a line — and drop every refusal keyed to a line while doing it.
   *
   * The API keys its per-line failures by **position** (`line_items.2.price`),
   * and the moment a row is added or removed those positions describe a set that
   * no longer exists: the refusal that named row 2 would redden whatever row is
   * now second. Clearing them is the honest answer — the failed submission is
   * about a body the operator has just replaced — and it leaves the summary
   * empty rather than wrong.
   */
  function changeSet(lines: LineDraft[]) {
    setDraft((current) => ({ ...current, lines }));
    setFields((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith("line_items")),
      ),
    );
    setRefusal(null);
  }

  /**
   * Put a product on the order, and forget every refusal keyed to a position in
   * the old set.
   *
   * **The rule itself is `addPickedLine` in `order-edit.ts`** and its docblock
   * carries the argument, including what was wrong with the rule that used to be
   * written out here: it merged on `price.trim() === ""`, which a picker-added
   * row never holds, so pressing *add* twice on a product opened two rows where
   * the second press meant quantity 2. It moved because it is arithmetic over a
   * list, and arithmetic over a list belongs where `tests/order-edit.test.ts` can
   * assert it directly rather than through a picker's `fireEvent`s.
   *
   * What stays here is what is genuinely the component's: the set changed, so
   * every `line_items.{n}.*` refusal now names positions that describe a set
   * which no longer exists. `changeSet` above says the same thing at more length
   * and this is the same clearing for the same reason.
   */
  function addLine(product: PickedProduct) {
    setDraft((current) => ({ ...current, lines: addPickedLine(current.lines, product) }));

    setFields((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith("line_items")),
      ),
    );
    setRefusal(null);
  }

  const save = useMutation({
    mutationFn: () =>
      acWrite<Order>("PATCH", `/orders/${order.id}`, buildEditPayload(draft, order)),
    onSuccess: (updated) => {
      /*
       * **The total comes from the answer, never from the form.** The server
       * priced every line the operator did not override, folded in the delivery
       * fee and summed the lot; this is the first moment anybody knows the
       * figure, and it is the figure the toast says.
       */
      toast.show(t("saved", { total: formatMoney(updated.total, updated.currency, locale) }));
      setOpen(false);
      /* The screen behind the drawer is server-rendered — the totals, the
         timeline this write just added rows to — so only a refresh makes all of
         it agree. The response is deliberately not used to seed anything. */
      startRefresh(() => router.refresh());
    },
    onError: (error: unknown) => {
      if (!(error instanceof BrowserApiError)) {
        setFields({});
        setRefusal(error instanceof Error ? error.message : t("failed"));
        return;
      }

      /*
       * **The stock 409 used to be handled first, and there is no longer one to
       * handle.** Its branch is gone with the guard that produced it, and the
       * shape of what it did is worth keeping on the record for one release.
       *
       * `guardManualPricesWritable()` refused a *stated* price on an order
       * already holding stock, and answered a 409 carrying `details.lines` — the
       * zero-based indices of the submitted lines that named an amount — so this
       * form rendered the sentence as an orphan line and a short note on each
       * named price box, deliberately without a `fields` key, because `fields`
       * is the API's validation channel and no value in those boxes was wrong.
       *
       * The fix round's decision 1 replaced refusing with **warn, allow,
       * record**: the price lands, the panel warns before the save from
       * `stock_reduced`, and `OrderService::snapshot()` writes `manual_prices`
       * and `stock_reduced` into the audit so the change is attributable.
       * `Array.isArray(details.lines)` now matches nothing on this route, and a
       * branch that can never be taken is a claim about the API that has stopped
       * being true.
       */
      const refused = error.fields;
      if (refused !== null && Object.keys(refused).length > 0) {
        setFields(refused);
        setRefusal(null);
        return;
      }

      /*
       * Everything else with nothing to bind: the `is_editable` 409, reachable
       * by racing a status change against this save.
       *
       * **This form is the one that keeps the plain fallback**, and the reason
       * is worth stating now that the other two have stopped needing it.
       * `OrderEditDrawer` binds the `details`-less billing-email 400 to its
       * email control; this drawer cannot receive that refusal at all. It draws
       * no address, `draftOf(order)` re-seeds billing from the order every time
       * it opens, and `buildEditPayload` is a diff — so `billing` is never in
       * the body and `set_billing_email()` is never called. The only
       * `details`-less refusal that reaches here is the empty-body 400, which
       * `isEditDirty` already makes unreachable through the disabled button.
       *
       * §3.4 renders a failure with no control on screen as plain text rather
       * than as a link that goes nowhere, and here that is the true shape.
       */
      setFields({});
        setRefusal(error.message);
    },
  });

  function submit() {
    const local = lineProblems(draft.lines, {
      noLines: t("problem.noLines"),
      quantity: t("problem.quantity"),
    });

    setRefusal(null);

    if (Object.keys(local).length > 0) {
      setFields(local);
      return;
    }

    setFields({});
    save.mutate();
  }

  const dirty = isEditDirty(draft, order);
  const busy = save.isPending || refreshing;

  /*
   * Disabled with the reason, never hidden — §3.3. Three reasons, in the order
   * they stop being true, and the third is the one the edit drawer does not
   * have: the lines are frozen once the order has left `pending`/`on-hold`.
   *
   * That third sentence is `orders.detail.editableNo` — the **same string** the
   * card's own footnote prints — so the button's tooltip and the paragraph under
   * it cannot say two different things about one rule.
   */
  const blocked = !canWrite
    ? tOrders("readOnly")
    : !order.is_editable
      ? tDetail("editableNo")
      : writesBlocked;

  /**
   * The DOM id a refusal links to, or `undefined` for one this form does not
   * draw.
   *
   * A function rather than `OrderEditDrawer`'s object, because the keys are
   * open-ended: the API names a line by its position and there is no fixed set
   * to enumerate. `line_items` on its own — "An order needs at least one line
   * item." — deliberately resolves to nothing: there is no control that *is* the
   * set, and §3.4 is explicit that a link going nowhere is worse than a line
   * that does not claim to.
   */
  function fieldId(key: string): string | undefined {
    if (key === "shipping_amount") return `${ID_PREFIX}-shipping-amount`;

    const line = /^line_items\.(\d+)\.(quantity|price|product_id|variation_id)$/.exec(key);
    if (line === null) return undefined;

    // `product_id` and `variation_id` have no control of their own — the picker
    // chose them — so they point at the row's quantity, which is the first
    // focusable thing in it.
    const control = line[2] === "price" ? "price" : "quantity";
    return `${ID_PREFIX}-${control}-${line[1]}`;
  }

  const failures: FormFailure[] = [
    ...(refusal ? [{ message: refusal }] : []),
    ...Object.entries(fields).map(([key, message]) => ({
      id: fieldId(key),
      /* A key with a control gets a link and no label; a key without one gets
         the message alone. `line_items` is the second case and its sentence
         already reads as a whole thought. */
      message,
    })),
  ];

  /**
   * Is the order holding stock right now?
   *
   * `stock_reduced` is WooCommerce's own flag on the order and never a list of
   * status names — `OrderRepository::stockReduced()` is emphatic about it,
   * because an order can sit in `on-hold` holding nothing at all, having arrived
   * there from `cancelled`. So this is read from the field and not derived.
   */
  const holdingStock = order.stock_reduced;

  /**
   * How many units this order is holding, for the warning's own sentence.
   *
   * Summed from the **order** and never from the draft, for the reason the
   * warning states: the shelf moved when the status did, so the stored
   * quantities are what is reserved. A draft that has just doubled a line is a
   * proposal, and reporting it here would tell the operator the shop had already
   * committed stock nobody has taken yet.
   */
  const reservedUnits = order.line_items.reduce((total, line) => total + line.quantity, 0);

  return (
    <>
      <Button
        id={triggerId}
        variant="secondary"
        size="sm"
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
        /* `md` (520px) for `NewOrderDrawer`'s measured reason: a line row
           carries a name, a SKU, a stepper and a price box, and 400px folds the
           stepper onto three lines. */
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
              onClick={submit}
              loading={busy}
              disabled={!dirty}
              /* Not a scold: the API answers an empty body with 400 "No
                 supported fields were provided.", so a save that could fire
                 while clean would be a request whose only possible outcome is a
                 refusal. `isEditDirty` is the builder's own answer, so the
                 button and the body cannot disagree. */
              title={dirty ? undefined : t("nothingToSave")}
            >
              {t("submit")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <ErrorSummary failures={failures} />

          {/* ──────────────────────────────────────────────────── articles ─── */}
          <Section
            title={t("items.title")}
            /*
             * The rule the whole section runs on, said once at the top: an empty
             * price box means the catalogue prices that line. It is not
             * guessable from the control — an empty money field reads as zero
             * everywhere else in the world — and getting it wrong costs the shop
             * an order given away.
             */
            description={t("items.description")}
          >
            <div className="flex flex-col gap-3">
              {holdingStock ? (
                /*
                 * **Warn, allow, record** — decision 1, and the half of it this
                 * form owes the operator.
                 *
                 * Said before the save rather than after, because there is no
                 * refusal coming: the edit will land. What the person needs to
                 * know is that these units are already off the shelf and that
                 * what they change here is written into the order's audit —
                 * which is a reason to look twice, not a reason to stop.
                 *
                 * **It names the quantity, and the quantity is the order's and
                 * not the draft's.** What stock holds is what was reserved when
                 * the status moved, so it is summed from `order.line_items`;
                 * summing the draft would report what the operator is proposing
                 * as though the shelf had already moved. There is no per-line
                 * reserved count on the read shape and none was invented — the
                 * order's own quantities are exactly what `wc_reduce_stock_levels()`
                 * took.
                 *
                 * `warning` and not `danger`: nothing is wrong, and nothing is
                 * refused. §3.3 keeps `danger` for a destructive act.
                 */
                <Notice
                  tone="warning"
                  title={t("items.stockHeld", { units: reservedUnits })}
                >
                  <p className="text-ui-label">{t("items.stockHeldRecorded")}</p>
                </Notice>
              ) : null}

              {draft.lines.length === 0 ? (
                <EmptyState icon="box" message={t("items.none")} />
              ) : (
                <ul className="flex flex-col gap-2">
                  {draft.lines.map((line, index) => {
                    /*
                     * Shown only when the two differ, per the item: a catalogue
                     * price repeated beside a box holding the same number is a
                     * figure a person has to read before discovering it says
                     * nothing. `null` is "the panel does not know" and renders
                     * nothing at all — see `LineDraft.cataloguePrice`.
                     */
                    const catalogue = line.cataloguePrice;
                    const overridden =
                      catalogue !== null && line.price.trim() !== "" &&
                      line.price.trim() !== catalogue;

                    return (
                      <li
                        key={line.key}
                        className="flex flex-col gap-2 rounded-ui-md border border-ui-line p-2"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            {/* A product name is user content and may be in
                                either script, so the ellipsis follows the
                                string rather than the page. */}
                            <p dir="auto" className="truncate text-ui-compact text-ui-fg">
                              {line.name}
                            </p>
                            <p className="truncate text-ui-caption text-ui-subtle">
                              {line.sku !== "" ? (
                                <Ltr numeric={false}>{line.sku}</Ltr>
                              ) : (
                                t("items.noSku")
                              )}
                            </p>
                          </div>

                          <IconButton
                            label={t("items.remove", { name: line.name })}
                            icon="trash"
                            variant="ghost"
                            size="sm"
                            disabled={save.isPending}
                            onClick={() =>
                              changeSet(draft.lines.filter((row) => row.key !== line.key))
                            }
                          />
                        </div>

                        {/* Two fields side by side above `sm` and stacked below
                            it: at 340px a stepper and a money box on one row
                            leave the stepper's input about 60px wide. */}
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                          <div className="sm:max-w-52 sm:flex-1">
                            <Stepper
                              id={`${ID_PREFIX}-quantity-${index}`}
                              label={t("items.quantity")}
                              value={line.quantity}
                              onChange={(next) => patchLine(line.key, { quantity: next })}
                              min={1}
                              error={fields[`line_items.${index}.quantity`]}
                              decrementLabel={t("items.decrement")}
                              incrementLabel={t("items.increment")}
                              disabled={save.isPending}
                            />
                          </div>

                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <NumberField
                              id={`${ID_PREFIX}-price-${index}`}
                              label={t("items.price")}
                              value={line.price}
                              onChange={(next) => patchLine(line.key, { price: next })}
                              /* Only the 400 now. The stock 409's per-line mark
                                 used to sit behind this `??` and is gone with
                                 the guard — see `onError`, which keeps the
                                 shape of what it did. */
                              error={fields[`line_items.${index}.price`]}
                              disabled={save.isPending}
                            />
                            {overridden ? (
                              <p className="text-ui-caption text-ui-subtle">
                                {t("items.catalogue")}{" "}
                                <Isolate numeric>
                                  {formatMoney(catalogue, SHOP_CURRENCY, locale)}
                                </Isolate>
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <ProductPicker
                idPrefix={ID_PREFIX}
                canPick={canPickProducts}
                enabled={open}
                onPick={addLine}
                onLoaded={learnPrices}
                disabled={save.isPending}
              />
            </div>
          </Section>

          {/* ─────────────────────────────────────────────────── livraison ─── */}
          <Section title={t("delivery.title")} description={t("delivery.description")}>
            <NumberField
              id={`${ID_PREFIX}-shipping-amount`}
              label={t("delivery.amount")}
              /*
               * Two sentences the control cannot imply, and both are measured
               * rather than stylistic. An emptied box states nothing and leaves
               * the fee exactly where it is — `OrderInput` drops `null` and `""`
               * before the payload is assembled — so `0` is the only way to
               * cancel a charge. And the order may already be charging for
               * delivery with nothing stated at all, which is every order the
               * checkout placed: `shipping_amount` is what somebody typed and
               * `shipping_total` is what the order charges.
               */
              hint={t("delivery.hint", { max: MAX_AMOUNT })}
              value={draft.shippingAmount}
              onChange={(next) => setDraft((current) => ({ ...current, shippingAmount: next }))}
              error={fields.shipping_amount}
              disabled={save.isPending}
            />
            <p className="mt-1.5 text-ui-label text-ui-muted">
              {t("delivery.charging")}{" "}
              <Isolate numeric>
                {formatMoney(order.shipping_total, order.currency, locale)}
              </Isolate>
            </p>
          </Section>
        </div>
      </Drawer>
    </>
  );
}

/** This form's DOM id namespace. The other two on this subject are `new-order`
    and `order-edit`, and three forms must not mint one id twice. */
const ID_PREFIX = "order-lines";
