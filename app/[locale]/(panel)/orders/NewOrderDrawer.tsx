"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import type { Customer } from "@/lib/api/schemas/customer";
import type { Order, Wilaya } from "@/lib/api/schemas/order";
import { SHOP_CURRENCY, formatMoney } from "@/lib/format/money";
import { Drawer } from "@/components/ui/Overlay";
import { Button, IconButton } from "@/components/ui/Button";
import {
  ErrorSummary,
  NumberField,
  Section,
  Select,
  Stepper,
  Switch,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/States";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { ADDRESS_KEYS, AddressFields, addressFieldId } from "./AddressFields";
import { CustomerPicker } from "./CustomerPicker";
import { ProductPicker, type PickedProduct } from "./ProductPicker";
/* One number, imported rather than re-declared. `MAX_AMOUNT`'s own docblock is
   the argument: `LineItemInput::MAX_PRICE` and `OrderInput::MAX_SHIPPING_AMOUNT`
   are two backend constants holding one figure, and this is the single place the
   panel finds out if either moves. The import points from the create drawer at
   the edit *module* and not the other way round, so no cycle is closed —
   `order-edit.ts` imports from `new-order.ts`, and nothing imports a component. */
import { MAX_AMOUNT } from "./[id]/order-edit";
import {
  CREATABLE,
  bindRefusals,
  buildPayload,
  draftProblems,
  emptyDraft,
  isAddressEmpty,
  nextLineKey,
  type AddressDraft,
  type OrderDraft,
} from "./new-order";

/**
 * Back-office order entry. `POST /orders`.
 *
 * ## Why the panel has this at all
 *
 * `ADMIN_PANEL.md` frames an order as something "created by a checkout", which
 * is why there was no importer for orders and no create screen for eleven
 * branches. That is true of every order the shop has. It is not true of the one
 * a shopkeeper takes over the phone, which is the order this drawer exists for —
 * and `POST /orders` has been built, guarded and tested on the backend the whole
 * time, waiting for a caller.
 *
 * ## A `Drawer`, and the picker is inline rather than a second overlay
 *
 * §3.1 gives the Drawer "a create form long enough to need room", which this is:
 * seven sections, and the person filling it is usually reading an address off a
 * phone call. It is `md` rather than `sm` because the line rows carry a name, a
 * SKU and a stepper on one row.
 *
 * §3.1 also says overlays are **never nested** — "a modal that needs a second
 * modal is a modal that needs steps". `RestrictionPicker` is the shape this
 * would otherwise borrow and it is a Drawer, so borrowing it here would stack
 * two. The product search is therefore inline, inside the section it fills, and
 * it is the better control for it anyway: the results are the thing being acted
 * on rather than a list to be ticked and applied.
 *
 * ## The picker is `ProductPicker.tsx` now, and this is the file it was lifted from
 *
 * The search box, the SKU hint, the three query states, the results list and the
 * `ac_manage_products` fallback were all declared here. They were lifted to
 * `ProductPicker.tsx` when the line editor on the order detail became the second
 * form that has to put a product on an order — and the lift deliberately left
 * **this copy in place**, because this file was being edited on the same step for
 * the manual-price field and two agents rewriting one component is how a merge
 * eats a docblock. That copy is gone as of this branch: `onPick` is `addLine`,
 * `enabled` is `open`, and about ninety lines of markup and a `useQuery` left
 * with it.
 *
 * **What the duplication was already hiding, found by removing it.** The two
 * copies had drifted in three places, none of them visible until they were side
 * by side. This one had **no `disabled` state**, so every result stayed
 * pressable while a save was in flight — a line could be added to a draft that
 * was already on the wire. Its fallback's product-id field carried **no DOM
 * `id`**, so a refusal could never have linked to it from the error summary.
 * And its query key was `["orders", "new", "products", search]` against the
 * editor's `["orders", "picker", search]`, so one search typed in both drawers
 * was two entries in the cache and two requests against a 600/min cap shared
 * across every open tab. Adopting the lifted control fixed all three by
 * deletion, which is the argument `AddressFields.tsx` made for the address block
 * one branch earlier.
 *
 * The capability hole moved with it and is unchanged: `/products` is
 * `ac_manage_products`, **`Order Manager` holds `ac_manage_orders` and does not
 * hold it** — a retired role, still held by existing accounts and still returned
 * by `/roles` — so without it the search degrades to a product-id field that says
 * why. `ProductPicker`'s own docblock carries the full argument.
 *
 * ## Two of its sections are files now, and neither moved for tidiness
 *
 * The address block and the customer picker were declared in here and are
 * `AddressFields.tsx` and `CustomerPicker.tsx` beside this one. The order **edit**
 * drawer is the second form to need both, and the address block's own docblock
 * had already made the argument against a second copy — "two hand-maintained
 * copies of eleven controls drift by the third branch". Nothing about the
 * controls changed on the way out; what moved with them is the wilaya option
 * list and the strings, which were `orders.create.address.*` and
 * `orders.create.customer.*` and are now `orders.address.*` and
 * `orders.customer.*` because they belong to neither form in particular.
 *
 * What did **not** move is what choosing a customer implies: this form copies
 * their billing block into a block nobody has typed in, and the edit form copies
 * nothing, because an existing order already carries the address the shopper
 * gave. `CustomerPicker` hands the whole record back and each form decides.
 *
 * ## It states money now, and it still computes none
 *
 * Two fields arrived on this branch: a **unit price per line**, prefilled from
 * the catalogue and overwritable, and an **editable delivery fee**. Both are
 * accepted by `POST /orders` — `LineItemInput::ALLOWED` names `price`, and
 * `OrderInput::normalize()` is one function shared by create and update, so
 * `shipping_amount` rides the same route. The paragraph that stood here said the
 * opposite and was true when it was written; `new-order.ts`'s docblock carries
 * the correction and the measurement.
 *
 * **No subtotal and no total are drawn, and that is unchanged and deliberate.**
 * It is item 1's sub-task 5. The form states what a unit costs and what the
 * carriage costs; what the *order* costs is `calculate_totals()`'s answer,
 * summed server-side over lines this form may have priced and lines the
 * catalogue priced, after `applyShippingAmount()` has written the fee. A form
 * that added the figures up would be publishing a number the server has not
 * agreed to — and would be wrong the moment a coupon, a tax or a shipping rule
 * applied. The 201 carries the real total and the toast names it;
 * `lib/format/money.ts` opens by refusing to add two amounts together at all.
 *
 * **The catalogue price is drawn beside a line only when it differs** from what
 * is in the box, so an override reads as an override. A catalogue figure printed
 * next to a box holding the same number is a thing a person has to read before
 * discovering it says nothing.
 */

export function NewOrderDrawer({
  open,
  onOpenChange,
  wilayas,
  locale,
  canPickProducts,
  canPickCustomers,
  onCreated,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wilayas: Wilaya[];
  locale: string;
  /** `ac_manage_products` — see the docblock. */
  canPickProducts: boolean;
  /** `ac_manage_customers`. Every role holding `ac_manage_orders` also holds
      this one today, so the fallback is a guard rather than a live path. */
  canPickCustomers: boolean;
  onCreated: (order: Order) => void;
  returnFocusTo?: string;
}) {
  const t = useTranslations("orders.create");
  /* The customer block's strings moved to `orders.customer` when the picker
     became shared, and the product picker's to `orders.picker` for the same
     reason: they belong to neither form in particular. `orders.clearSearch` went
     with the second of those, which is why there is no `orders` namespace left
     to read here. */
  const tCustomer = useTranslations("orders.customer");
  const tStatus = useTranslations("status");
  const tUi = useTranslations("ui");

  const toast = useToast();

  const [draft, setDraft] = useState<OrderDraft>(emptyDraft);
  /**
   * The API's refusals, merged with the form's own — see `draftProblems`. Keyed
   * the way the API keys them, so a 400 naming `billing.country` and a local
   * rule naming `line_items.0.quantity` bind through one map.
   */
  const [fields, setFields] = useState<Record<string, string>>({});
  /** A refusal with no field to bind to — a 409 on the status, typically. */
  const [refusal, setRefusal] = useState<string | null>(null);

  /*
   * Re-seeded when the drawer opens rather than by a `key` on the parent, which
   * is what `RestrictionPicker` does — the same trick, and the same reason: an
   * effect would clear the form one frame after it appeared.
   *
   * The picker's own search box and product-id field are its state now, and
   * `ProductPicker` is unmounted with the drawer, so there is nothing left to
   * clear here beyond the draft and the refusals.
   */
  const [seededFor, setSeededFor] = useState(open);
  if (open !== seededFor) {
    setSeededFor(open);
    if (open) {
      setDraft(emptyDraft());
      setFields({});
      setRefusal(null);
    }
  }

  const patch = (next: Partial<OrderDraft>) =>
    setDraft((current) => ({ ...current, ...next }));

  const patchAddress = (which: "billing" | "shipping", next: Partial<AddressDraft>) =>
    setDraft((current) => ({ ...current, [which]: { ...current[which], ...next } }));

  const create = useMutation({
    mutationFn: () => acWrite<Order>("POST", "/orders", buildPayload(draft)),
    onSuccess: (order) => {
      /*
       * **The total comes from the answer, never from the form** — sub-task 5.
       * The server priced every line nobody overrode, folded in the delivery fee
       * and summed the lot; this is the first moment anybody knows the figure.
       *
       * Formatted with the order's own currency rather than printed raw, which
       * is what this line used to do: the API returns `"3900.00"` and the toast
       * said `3900.00` with no unit, in a panel whose every other amount goes
       * through `formatMoney`. `OrderLinesDrawer`'s `saved` toast is the same
       * sentence about the same number and already formatted it.
       */
      toast.show(
        t("created", {
          number: order.number,
          total: formatMoney(order.total, order.currency, locale),
        }),
      );
      onOpenChange(false);
      onCreated(order);
    },
    onError: (error: unknown) => {
      if (error instanceof BrowserApiError && error.fields) {
        /* Re-keyed before it is bound: "same as billing" sends one address
           twice, so one bad value comes back as two refusals and the second has
           no control to point at. `bindRefusals` carries the measurement. */
        setFields(bindRefusals(error.fields, draft.shippingSameAsBilling));
        setRefusal(null);
        return;
      }
      /*
       * A 409 is the status refusal, and on this route it is the **only** one:
       * `cancelled` and `refunded` are terminal and an order cannot begin in
       * one, while `guardManualPricesWritable()` and
       * `guardShippingAmountWritable()` — the two 409s the line editor on the
       * detail binds — are wired into `OrderService::update()` and not into
       * `create()`. There is no order yet, so nothing is holding stock and
       * nothing is un-editable. The status picker below offers only the five
       * creatable statuses, so reaching this means the API's list and
       * `CREATABLE_STATUSES` have diverged, and the API's message is the one
       * worth showing. It has no field to bind to, so it goes to the summary as
       * an orphan line — §3.4's rule for a failure whose field is not on screen.
       */
      setFields({});
      setRefusal(error instanceof Error ? error.message : t("failed"));
    },
  });

  function submit() {
    const local = draftProblems(draft, {
      noLines: t("problem.noLines"),
      quantity: t("problem.quantity"),
    });

    setRefusal(null);

    if (Object.keys(local).length > 0) {
      setFields(local);
      return;
    }

    setFields({});
    create.mutate();
  }

  /**
   * Put a product on the order — or raise the quantity of the row that is
   * already offering it at the same price.
   *
   * ## The rule changed when a price could be typed
   *
   * It used to be "a second press on a product already on the order raises its
   * quantity", full stop, on the argument that two rows for one product is never
   * what somebody pressing add twice meant. That argument holds only while every
   * row for a product costs the same. Once a price can be overwritten, four
   * copies at 1 500 and one damaged copy at 700 is a real order, and merging the
   * second press into the discounted row would silently give the extra unit away
   * at 700.
   *
   * So the match is now **product *and* price**: a press merges into the first
   * row still holding the amount a new row would be seeded with, and opens a new
   * row otherwise. Two consequences, both wanted. Pressing add twice on an
   * untouched product still says quantity 2, which is the behaviour this drawer
   * has always had and the reason the old rule existed. And a product the
   * operator has already repriced gets its own row at the catalogue price, which
   * they can then price themselves.
   *
   * **`OrderLinesDrawer` matches on `price === ""` instead**, and the difference
   * is worth naming rather than reconciling. Its lines arrive from an order, so
   * an empty price box there means "this line came off the catalogue" and is a
   * row that can safely absorb another unit. On this form nothing arrives from
   * anywhere: every row is picker-added and therefore seeded, so that condition
   * would never be true here and every press would open a row — losing the
   * quantity-2 behaviour for the ordinary case. The two conditions agree
   * wherever both are meaningful: a row at the catalogue price absorbs the
   * press, a row at a price somebody chose does not.
   *
   * The fallback path is the third case and falls out for free: without
   * `ac_manage_products` the picker hands back `price: ""`, a new row is seeded
   * `""`, and `"" === ""` merges — exactly today's behaviour for the one role
   * that cannot read the catalogue.
   */
  function addLine(product: PickedProduct) {
    setDraft((current) => {
      const seed = product.price.trim();
      const at = current.lines.findIndex(
        (line) => line.productId === product.id && line.price.trim() === seed,
      );

      if (at !== -1) {
        const lines = [...current.lines];
        const quantity = Number.parseInt(lines[at].quantity, 10);
        lines[at] = {
          ...lines[at],
          quantity: String(Number.isFinite(quantity) ? quantity + 1 : 1),
        };
        return { ...current, lines };
      }

      return {
        ...current,
        lines: [
          ...current.lines,
          {
            key: nextLineKey(current.lines),
            productId: product.id,
            name: product.name,
            sku: product.sku,
            /*
             * **Prefilled from the catalogue and editable** — sub-task 3, and
             * what `EL/el-admin-app`'s `CreateOrderModal.jsx` does when a book
             * is chosen (`newOrderItems[index].unitPrice = selectedBook.price`).
             *
             * The consequence is stated rather than discovered: a prefilled
             * amount is a *stated* one, so every line this form creates is
             * recorded as hand-priced and audited into `order.created` with the
             * catalogue price beside it, even when the two are the same number.
             * That is the backend's deliberate reading — the meta records the
             * decision, not the difference — and it is the right one for an
             * order somebody is entering by phone off a screen showing the
             * price. Clearing the box hands the line back to the catalogue.
             *
             * The fallback path seeds `""`, because `ProductPicker` genuinely
             * knows no price there and a fabricated `0.00` would put a free line
             * in front of somebody who thought they were adding a product.
             */
            price: product.price,
            cataloguePrice: product.price === "" ? null : product.price,
            quantity: "1",
          },
        ],
      };
    });

    /*
     * Every refusal keyed to a line goes with the change, because the API keys
     * them by **position** (`line_items.2.price`) and a row added or removed
     * describes a set those positions no longer name — the refusal that named
     * row 2 would redden whatever is second now. `OrderLinesDrawer` clears them
     * in the same place for the same reason; the difference is only that this
     * form has no 409 state to clear beside them.
     */
    setFields((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith("line_items")),
      ),
    );
    setRefusal(null);
  }

  function chooseCustomer(customer: Customer) {
    setDraft((current) => ({
      ...current,
      customerId: customer.id,
      /*
       * Their billing address is copied **only into a block nobody has typed
       * in**. Overwriting a half-filled address with the record's own is how a
       * person loses the correction they were making — the shopper moved, which
       * is often exactly why the order is being taken by phone.
       */
      billing: isAddressEmpty(current.billing)
        ? { ...current.billing, ...pickAddress(customer), email: customer.email }
        : current.billing,
    }));
  }

  /**
   * Drop a line, and every refusal that was keyed to a position in the old set.
   *
   * `addLine` above carries the argument: the API names a bad line by its index,
   * and removing a row renumbers every index after it.
   */
  function removeLine(key: number) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.key !== key),
    }));
    setFields((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([k]) => !k.startsWith("line_items")),
      ),
    );
    setRefusal(null);
  }

  /**
   * Edit one line in place, by its own key rather than by its index.
   *
   * Index would work today and is the wrong habit on this form: the indices are
   * what the *API* keys its refusals by, and the keys are what React reconciles
   * by, and a handler that mixed the two would be correct until two rows named
   * the same product — which is now a thing `addLine` can produce.
   */
  const patchLine = (key: number, next: Partial<OrderDraft["lines"][number]>) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...next } : line)),
    }));

  /**
   * The DOM id a refusal links to, or `undefined` for one this form does not
   * draw.
   *
   * `FIELD_IDS` below is still the fixed half — the status, the customer, the
   * note, the payment pair and twenty-two address controls, all of them known in
   * advance. What it cannot hold is the **open-ended** half: the API names a line
   * by its position, and there is no fixed set of positions to enumerate. Before
   * the price field arrived that gap showed up only on a bad quantity, which the
   * form catches locally; `line_items.{n}.price` is a refusal only the API can
   * make, so the summary would have listed the raw key `line_items.0.price` as a
   * label with no link — which is what §3.4 calls the worse of the two options.
   *
   * A key with no control still resolves to `undefined` deliberately.
   * `line_items` on its own — "An order needs at least one line item." — has no
   * control that *is* the set, and a link that goes nowhere is worse than a line
   * that does not claim to.
   */
  function fieldId(key: string): string | undefined {
    if (key in FIELD_IDS) return FIELD_IDS[key];
    if (key === "shipping_amount") return `${ID_PREFIX}-shipping-amount`;

    const line = /^line_items\.(\d+)\.(quantity|price|product_id|variation_id)$/.exec(key);
    if (line === null) return undefined;

    /* `product_id` and `variation_id` have no control of their own — the picker
       chose them — so they point at the row's quantity, which is the first
       focusable thing in it. `OrderLinesDrawer` maps them the same way. */
    const control = line[2] === "price" ? "price" : "quantity";
    return `${ID_PREFIX}-${control}-${line[1]}`;
  }

  /**
   * Every refusal on screen, as `ErrorSummary` takes them.
   *
   * A field the form renders gets a link; anything else — a key from a 400 the
   * drawer has no control for, or the 409's orphan message — is listed as text.
   * §3.4 is explicit that a link which goes nowhere is worse than a line that
   * does not claim to.
   */
  const failures: FormFailure[] = [
    ...(refusal ? [{ message: refusal }] : []),
    ...Object.entries(fields).map(([key, message]) => {
      const id = fieldId(key);
      return { id, label: id ? undefined : key, message };
    }),
  ];

  const ready = draft.lines.length > 0;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      size="md"
      returnFocusTo={returnFocusTo}
      footer={
        <>
          {/* Cancel first in DOM order: first tab stop, and `flex-col-reverse`
              puts the confirming button away from the thumb on a phone. */}
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            {tUi("cancel")}
          </Button>
          <Button
            onClick={submit}
            loading={create.isPending}
            disabled={!ready}
            title={ready ? undefined : t("problem.noLines")}
          >
            {t("submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorSummary failures={failures} />

        {/* ─────────────────────────────────────────────────────── articles ─── */}
        <Section title={t("items.title")} description={t("items.description")}>
          <div className="flex flex-col gap-3">
            {draft.lines.length === 0 ? (
              <EmptyState icon="box" message={t("items.none")} />
            ) : (
              <ul className="flex flex-col gap-2">
                {draft.lines.map((line, index) => {
                  /*
                   * Drawn only when the two differ, per sub-task 3: a catalogue
                   * price repeated beside a box holding the same number is a
                   * figure a person has to read before discovering it says
                   * nothing. `null` is "the panel does not know" — the
                   * `ac_manage_products` fallback — and renders nothing at all,
                   * because an invented comparison would be worse than an absent
                   * one. An emptied box is not an override either: it hands the
                   * line back to the catalogue, so there is nothing to contrast.
                   */
                  const catalogue = line.cataloguePrice;
                  const overridden =
                    catalogue !== null &&
                    line.price.trim() !== "" &&
                    line.price.trim() !== catalogue;

                  return (
                    /*
                      Two rows, not one, and it is a measurement rather than a
                      preference. A single flex row put the stepper — three 44px
                      boxes and an input — beside the name inside a 520px drawer,
                      and the name got about 90px: "Chèche en …" over
                      "AC-CAT-0201…", both truncated, which leaves the row unable
                      to say which product it is. The name is the whole point of
                      the row, so it gets the width, and the controls sit below
                      it at the size they actually need.
                    */
                    <li
                      key={line.key}
                      className="flex flex-col gap-2 rounded-ui-md border border-ui-line p-2"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          {/* A product name is user content and may be in either
                              script, so the truncation follows the string. */}
                          <p dir="auto" className="truncate text-ui-compact text-ui-fg">
                            {line.name}
                          </p>
                          {/*
                            The catalogue price used to sit here beside the SKU,
                            as a fact about the product, because there was
                            nowhere else for it and nothing to compare it to.
                            There is a box holding a price now, so printing the
                            same figure twice on one row would be noise — it
                            moved under the field and appears only when it
                            disagrees with what is in it.
                          */}
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
                          disabled={create.isPending}
                          onClick={() => removeLine(line.key)}
                        />
                      </div>

                      {/* Two fields side by side above `sm` and stacked below
                          it: at 340px a stepper and a money box on one row leave
                          the stepper's input about 60px wide. */}
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
                            disabled={create.isPending}
                          />
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <NumberField
                            id={`${ID_PREFIX}-price-${index}`}
                            label={t("items.price")}
                            value={line.price}
                            onChange={(next) => patchLine(line.key, { price: next })}
                            /* The API's own three sentences — "Must be an
                               amount.", "Cannot be negative.", "Is implausibly
                               large." — rendered rather than replaced, because
                               each names which of three things is wrong. There is
                               no 409 to bind beside them: `create()` never calls
                               `guardManualPricesWritable()`. */
                            error={fields[`line_items.${index}.price`]}
                            disabled={create.isPending}
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

            {/*
              The control this file used to declare inline, and the
              `ac_manage_products` fallback with it. `onLoaded` is deliberately
              not passed: the edit drawer needs it because its lines arrive from
              an order that publishes no catalogue price, while every line here
              was added from a result the picker had just been told the price of,
              so `cataloguePrice` is filled at `addLine` and there is nothing
              later to learn.
            */}
            <ProductPicker
              idPrefix={ID_PREFIX}
              canPick={canPickProducts}
              enabled={open}
              onPick={addLine}
              disabled={create.isPending}
            />
          </div>
        </Section>

        {/* ────────────────────────────────────────────────────────── client ─── */}
        <Section title={tCustomer("title")}>
          <CustomerPicker
            id={FIELD_IDS.customer_id}
            customerId={draft.customerId}
            onChange={(next) => patch({ customerId: next })}
            onChoose={chooseCustomer}
            canPick={canPickCustomers}
            enabled={open}
            error={fields.customer_id}
          />
        </Section>

        {/* ───────────────────────────────────────────────────── facturation ─── */}
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
          />
        </Section>

        {/* ─────────────────────────────────────────────────────── livraison ─── */}
        <Section title={t("shipping.title")}>
          <div className="flex flex-col gap-3">
            <Switch
              label={t("shipping.same")}
              /* The email is dropped on the way out, never copied — the API
                 refuses one on a shipping address by name. `payloadAddress`
                 carries the measurement. */
              hint={t("shipping.sameWhy")}
              checked={draft.shippingSameAsBilling}
              onChange={(same) => patch({ shippingSameAsBilling: same })}
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
              />
            )}

            {/*
              The delivery fee — sub-task 4 — inside the section that already
              says where the parcel goes, rather than in a section of its own.
              Two sections both called "Livraison" in a seven-section drawer is
              a worse answer than one, and this is where step 2's wilaya and
              commune pickers land: the thing that will eventually fill this box
              belongs beside the thing that decides its value.

              It sits after the address and after the switch on purpose. The
              switch hides a block, and a control that appeared and disappeared
              above the fee would move it up and down the drawer as somebody
              toggled it.

              **Not prefilled, because there is nothing to prefill it from.**
              Sub-task 4 asks for the rate lookup's answer and step 2 has not
              been built — nor have the destination fields it would need. The
              seam at the foot of `new-order.ts` says exactly what step 2 has to
              do here, and no docblock in this branch claims a rate call was
              made.
            */}
            <NumberField
              id={`${ID_PREFIX}-shipping-amount`}
              label={t("shipping.amount")}
              /*
               * Two sentences the control cannot imply, both measured. An empty
               * box states nothing — `OrderInput::normalize()` drops `null` and
               * `""` before the payload is assembled — and on a *create* that
               * means the order is made carrying no delivery charge at all,
               * which is not what an empty box means on the edit form, where it
               * leaves an existing fee alone. And the ceiling is the API's, over
               * which it answers "Is implausibly large."
               */
              hint={t("shipping.amountHint", { max: MAX_AMOUNT })}
              value={draft.shippingAmount}
              onChange={(next) => patch({ shippingAmount: next })}
              error={fields.shipping_amount}
              disabled={create.isPending}
            />
          </div>
        </Section>

        {/* ───────────────────────────────────────────────────────── paiement ─── */}
        <Section title={t("payment.title")}>
          <div className="flex flex-col gap-3">
            {/*
              Two text fields and not a picker, deliberately. The only payment
              method this shop has a translated name for is `cod`, and
              `/payments/methods` — which would publish the real list — is
              `ac_manage_payments`, a capability neither `Manager` nor `Order
              Manager` holds. A two-row picker built from the one word the panel
              happens to know would be a vocabulary the panel invented.
            */}
            <TextField
              id={FIELD_IDS.payment_method}
              label={t("payment.method")}
              hint={t("payment.methodHint")}
              value={draft.paymentMethod}
              onChange={(next) => patch({ paymentMethod: next })}
              error={fields.payment_method}
              isolate
            />
            <TextField
              id={FIELD_IDS.payment_method_title}
              label={t("payment.methodTitle")}
              value={draft.paymentMethodTitle}
              onChange={(next) => patch({ paymentMethodTitle: next })}
              error={fields.payment_method_title}
            />
          </div>
        </Section>

        {/* ───────────────────────────────────────────────────────── statut ─── */}
        <Section title={t("status.title")} description={t("status.description")}>
          <Select
            id={FIELD_IDS.status}
            label={t("status.label")}
            value={draft.status}
            onChange={(next) => patch({ status: next })}
            error={fields.status}
            options={CREATABLE.map((status) => ({
              value: status,
              label: tStatus(status),
            }))}
          />
        </Section>

        {/* ─────────────────────────────────────────────────────────── note ─── */}
        <Section title={t("note.title")}>
          <TextArea
            id={FIELD_IDS.customer_note}
            label={t("note.label")}
            value={draft.customerNote}
            onChange={(next) => patch({ customerNote: next })}
            error={fields.customer_note}
          />
        </Section>
      </div>
    </Drawer>
  );
}

/** This form's DOM id namespace. See `addressFieldId` in `AddressFields.tsx` —
    the edit drawer's is `order-edit`, and two forms must not mint the same id. */
const ID_PREFIX = "new-order";

/**
 * The DOM ids the error summary links to, keyed by the API's own field names.
 *
 * A map rather than a convention, because the two namespaces are not the same
 * shape: the API says `billing.country` and a DOM id cannot carry a dot without
 * `getElementById` still working but `#billing.country` selecting a class.
 *
 * **The fixed half only.** `fieldId()` above consults this first and then
 * handles the keys that cannot be enumerated — a line named by its position, and
 * the delivery fee. A key neither of them resolves renders in the summary as
 * text, which is exactly right for a field this form does not draw.
 */
const FIELD_IDS: Record<string, string | undefined> = {
  status: `${ID_PREFIX}-status`,
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

/** A customer's billing block, as the draft's shape. */
function pickAddress(customer: Customer): Partial<AddressDraft> {
  const source = customer.billing;
  const out: Partial<AddressDraft> = {};
  for (const key of ADDRESS_KEYS) {
    const value = source[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
