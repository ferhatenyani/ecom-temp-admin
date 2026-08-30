"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import type { Customer } from "@/lib/api/schemas/customer";
import type { Order, Wilaya } from "@/lib/api/schemas/order";
import type { Product } from "@/lib/api/schemas/product";
import { customerRef } from "@/lib/customers";
import { SHOP_CURRENCY, formatMoney } from "@/lib/format/money";
import { Drawer } from "@/components/ui/Overlay";
import { Button, IconButton } from "@/components/ui/Button";
import {
  ErrorSummary,
  Section,
  Select,
  Stepper,
  Switch,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { SearchField } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/States";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import {
  CREATABLE,
  bindRefusals,
  buildPayload,
  draftProblems,
  emptyDraft,
  isAddressEmpty,
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
 * ## The one capability hole, and what it does about it
 *
 * The picker reads `/products`, which is `ac_manage_products`. **`Order Manager`
 * holds `ac_manage_orders` and does not hold it** — a retired role, still held
 * by existing accounts and still returned by `/roles`, so this is a live case
 * rather than a hypothetical. `Manager` and `Super Admin` hold both.
 *
 * Coupons solved the same collision by growing `/coupons/eligible-products`, a
 * narrow route behind the *coupon* capability. There is no orders equivalent and
 * inventing one is a backend branch, so the drawer degrades instead: without
 * `ac_manage_products` the search is replaced by a product-id field that says
 * why, and the API still validates the id. That is worse than a picker and much
 * better than a 403 with no explanation, which is what a picker built on
 * `/products` alone would have shown the one role whose whole job is orders.
 *
 * ## Nothing here computes money
 *
 * The catalogue's unit price renders beside each line because it is a fact about
 * the product. No subtotal and no total are drawn, because the API prices the
 * order from the catalogue at save and refuses a caller-supplied `price` by
 * name. A form that added the figures up would be publishing a number the server
 * has not agreed to — and would be wrong the moment a coupon, tax or shipping
 * rule applied. The 201 carries the real total, and the toast names it.
 */

const PICKER_PER_PAGE = 8;

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
  const tOrders = useTranslations("orders");
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

  const [productSearch, setProductSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [manualProductId, setManualProductId] = useState("");

  /*
   * Re-seeded when the drawer opens rather than by a `key` on the parent, which
   * is what `RestrictionPicker` does — the same trick, and the same reason: an
   * effect would clear the form one frame after it appeared.
   */
  const [seededFor, setSeededFor] = useState(open);
  if (open !== seededFor) {
    setSeededFor(open);
    if (open) {
      setDraft(emptyDraft());
      setFields({});
      setRefusal(null);
      setProductSearch("");
      setCustomerSearch("");
      setManualProductId("");
    }
  }

  const patch = (next: Partial<OrderDraft>) =>
    setDraft((current) => ({ ...current, ...next }));

  const patchAddress = (which: "billing" | "shipping", next: Partial<AddressDraft>) =>
    setDraft((current) => ({ ...current, [which]: { ...current[which], ...next } }));

  /* Nothing is fetched until the drawer is open, and the search is submit-gated
     — reads are 600/min per credential, shared across every tab. */
  const products = useQuery({
    queryKey: ["orders", "new", "products", productSearch],
    enabled: open && canPickProducts,
    queryFn: () =>
      acRead<Product[]>(
        `/products?per_page=${PICKER_PER_PAGE}&search=${encodeURIComponent(productSearch)}`,
      ),
    placeholderData: keepPreviousData,
  });

  const customers = useQuery({
    queryKey: ["orders", "new", "customers", customerSearch],
    enabled: open && canPickCustomers && customerSearch !== "",
    queryFn: () =>
      acRead<Customer[]>(
        `/customers?per_page=${PICKER_PER_PAGE}&search=${encodeURIComponent(customerSearch)}`,
      ),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: () => acWrite<Order>("POST", "/orders", buildPayload(draft)),
    onSuccess: (order) => {
      toast.show(t("created", { number: order.number, total: order.total }));
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
       * A 409 is the status refusal — `cancelled` and `refunded` are terminal
       * and an order cannot begin in one. The picker below offers only the five
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

  function addLine(product: Pick<Product, "id" | "name" | "sku" | "price">) {
    setDraft((current) => {
      /* A second press on a product already on the order raises its quantity
         rather than adding a duplicate row. Two rows for one product is legal on
         the API and is never what somebody pressing "add" twice meant. */
      const existing = current.lines.findIndex((line) => line.productId === product.id);
      if (existing !== -1) {
        const lines = [...current.lines];
        const line = lines[existing];
        const quantity = Number.parseInt(line.quantity, 10);
        lines[existing] = {
          ...line,
          quantity: String(Number.isFinite(quantity) ? quantity + 1 : 1),
        };
        return { ...current, lines };
      }

      return {
        ...current,
        lines: [
          ...current.lines,
          {
            productId: product.id,
            name: product.name,
            sku: product.sku,
            price: product.price,
            quantity: "1",
          },
        ],
      };
    });
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
    setCustomerSearch("");
  }

  const wilayaLabel = (w: Wilaya) =>
    locale === "ar" && w.name_ar !== "" ? w.name_ar : w.name;

  /** The wilaya picker's options. `state` is the **code**, not the id — measured
      on the order schema, which documents it as a two-digit code. */
  const wilayaOptions = [
    { value: "", label: t("address.noWilaya") },
    ...wilayas.map((w) => ({ value: w.code, label: wilayaLabel(w) })),
  ];

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
    ...Object.entries(fields).map(([key, message]) => ({
      id: FIELD_IDS[key],
      label: FIELD_IDS[key] ? undefined : key,
      message,
    })),
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
                {draft.lines.map((line, index) => (
                  /*
                    Two rows, not one, and it is a measurement rather than a
                    preference. A single flex row put the stepper — three 44px
                    boxes and an input — beside the name inside a 520px drawer,
                    and the name got about 90px: "Chèche en …" over
                    "AC-CAT-0201…", both truncated, which leaves the row unable
                    to say which product it is. The name is the whole point of
                    the row, so it gets the width, and the stepper is capped
                    below it at the size a quantity actually needs.
                  */
                  <li
                    key={line.productId}
                    className="flex flex-col gap-2 rounded-ui-md border border-ui-line p-2"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p dir="auto" className="truncate text-ui-compact text-ui-fg">
                          {line.name}
                        </p>
                        <p className="truncate text-ui-caption text-ui-subtle">
                          {line.sku !== "" ? (
                            <Ltr numeric={false}>{line.sku}</Ltr>
                          ) : (
                            t("items.noSku")
                          )}
                          <span aria-hidden="true" className="mx-1">
                            ·
                          </span>
                          <Isolate numeric>
                            {formatMoney(line.price, SHOP_CURRENCY, locale)}
                          </Isolate>
                        </p>
                      </div>

                      <IconButton
                        label={t("items.remove", { name: line.name })}
                        icon="trash"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            lines: current.lines.filter((_, i) => i !== index),
                          }))
                        }
                      />
                    </div>

                    <div className="max-w-52">
                      <Stepper
                        id={`new-order-quantity-${index}`}
                        label={t("items.quantity")}
                        value={line.quantity}
                        onChange={(next) =>
                          setDraft((current) => {
                            const lines = [...current.lines];
                            lines[index] = { ...lines[index], quantity: next };
                            return { ...current, lines };
                          })
                        }
                        min={1}
                        error={fields[`line_items.${index}.quantity`]}
                        decrementLabel={t("items.decrement")}
                        incrementLabel={t("items.increment")}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {canPickProducts ? (
              <>
                <SearchField
                  value={productSearch}
                  onSubmit={setProductSearch}
                  placeholder={t("items.search")}
                  label={t("items.search")}
                  clearLabel={tOrders("clearSearch")}
                />
                {/* The API folds a SKU lookup into `?search=`; WordPress's own
                    `s` reads the title only, so a shop that knows a product by
                    its code and typed it would otherwise conclude it is gone.
                    `RestrictionPicker` carries the same line for the same
                    reason. */}
                <p className="text-ui-label text-ui-muted">{t("items.skuHint")}</p>

                {products.isPending ? (
                  <SkeletonRegion label={t("items.loading")} className="flex flex-col gap-1">
                    {Array.from({ length: 3 }, (_, i) => (
                      <Skeleton key={i} className="ui-field w-full rounded-ui-md" />
                    ))}
                  </SkeletonRegion>
                ) : products.isError ? (
                  <p className="text-ui-label text-ui-danger-fg">
                    {(products.error as Error).message}
                  </p>
                ) : (products.data?.data ?? []).length === 0 ? (
                  <EmptyState icon="search" message={t("items.noResults")} />
                ) : (
                  <ul className="flex flex-col gap-1">
                    {(products.data?.data ?? []).map((product) => (
                      <li key={product.id}>
                        <button
                          type="button"
                          onClick={() => addLine(product)}
                          className="ui-field ui-interactive ui-ring ui-hover-fill flex w-full cursor-pointer items-center gap-2 rounded-ui-md px-2 text-start text-ui-compact text-ui-fg"
                        >
                          <span className="min-w-0 flex-1">
                            <span dir="auto" className="block truncate">
                              {product.name}
                            </span>
                            <span className="block truncate text-ui-caption text-ui-subtle">
                              {product.sku !== "" ? (
                                <Ltr numeric={false}>{product.sku}</Ltr>
                              ) : (
                                t("items.noSku")
                              )}
                            </span>
                          </span>
                          <Isolate numeric className="shrink-0 text-ui-caption text-ui-subtle">
                            {formatMoney(product.price, SHOP_CURRENCY, locale)}
                          </Isolate>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              /*
               * The `ac_manage_products` fallback. A person who cannot read the
               * catalogue can still put a known id on an order, and the API
               * answers "create with a product that does not exist" with a 400
               * rather than storing it — which is the same guarantee the picker
               * has, minus the name.
               */
              <div className="flex flex-wrap items-end gap-2">
                <TextField
                  label={t("items.manualId")}
                  hint={t("items.manualIdWhy")}
                  value={manualProductId}
                  onChange={setManualProductId}
                  isolate
                  inputMode="numeric"
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  disabled={!/^\d+$/.test(manualProductId.trim())}
                  onClick={() => {
                    addLine({
                      id: Number.parseInt(manualProductId.trim(), 10),
                      name: t("items.manualName", { id: manualProductId.trim() }),
                      sku: "",
                      price: "",
                    });
                    setManualProductId("");
                  }}
                >
                  {t("items.add")}
                </Button>
              </div>
            )}
          </div>
        </Section>

        {/* ────────────────────────────────────────────────────────── client ─── */}
        <Section title={t("customer.title")}>
          <div className="flex flex-col gap-3">
            <Switch
              label={t("customer.guest")}
              hint={t("customer.guestWhy")}
              checked={draft.customerId === null}
              onChange={(guest) => patch({ customerId: guest ? null : draft.customerId })}
              error={fields.customer_id}
            />

            {draft.customerId !== null ? (
              <p className="text-ui-compact text-ui-fg">
                <Isolate numeric>{t("customer.chosen", { id: draft.customerId })}</Isolate>
              </p>
            ) : null}

            {draft.customerId === null && canPickCustomers ? (
              <>
                <SearchField
                  value={customerSearch}
                  onSubmit={setCustomerSearch}
                  placeholder={t("customer.search")}
                  label={t("customer.search")}
                  clearLabel={tOrders("clearSearch")}
                />
                {customerSearch !== "" ? (
                  customers.isPending ? (
                    <SkeletonRegion
                      label={t("customer.loading")}
                      className="flex flex-col gap-1"
                    >
                      {Array.from({ length: 3 }, (_, i) => (
                        <Skeleton key={i} className="ui-field w-full rounded-ui-md" />
                      ))}
                    </SkeletonRegion>
                  ) : (customers.data?.data ?? []).length === 0 ? (
                    <EmptyState icon="search" message={t("customer.noResults")} />
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {(customers.data?.data ?? []).map((customer) => {
                        /*
                          **The address leads and the name is secondary**, which
                          is the opposite of the customers list and is measured
                          rather than a preference: 12 of the 16 live customers
                          in this shop have neither a first nor a last name, so a
                          row built name-first renders blank for the ordinary
                          case. `customerRef` is the helper that decided this and
                          the campaign composer's picker already follows it.
                        */
                        const ref = customerRef(customer);
                        return (
                          <li key={ref.id}>
                            <button
                              type="button"
                              onClick={() => chooseCustomer(customer)}
                              className="ui-field ui-interactive ui-ring ui-hover-fill flex w-full cursor-pointer flex-col justify-center rounded-ui-md px-2 text-start text-ui-compact text-ui-fg"
                            >
                              <span className="truncate">
                                <Ltr numeric={false}>{ref.email}</Ltr>
                              </span>
                              {ref.name !== null ? (
                                <span
                                  dir="auto"
                                  className="truncate text-ui-caption text-ui-subtle"
                                >
                                  {ref.name}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : null}
              </>
            ) : null}
          </div>
        </Section>

        {/* ───────────────────────────────────────────────────── facturation ─── */}
        <Section title={t("billing.title")}>
          <AddressFields
            prefix="billing"
            value={draft.billing}
            onChange={(next) => patchAddress("billing", next)}
            fields={fields}
            wilayaOptions={wilayaOptions}
            email
            t={t}
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
                prefix="shipping"
                value={draft.shipping}
                onChange={(next) => patchAddress("shipping", next)}
                fields={fields}
                wilayaOptions={wilayaOptions}
                email={false}
                t={t}
              />
            )}
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

/**
 * The DOM ids the error summary links to, keyed by the API's own field names.
 *
 * A map rather than a convention, because the two namespaces are not the same
 * shape: the API says `billing.country` and a DOM id cannot carry a dot without
 * `getElementById` still working but `#billing.country` selecting a class. Every
 * key absent from here renders in the summary as text — which is exactly right
 * for a field this form does not draw.
 */
const ADDRESS_KEYS = [
  "first_name",
  "last_name",
  "company",
  "address_1",
  "address_2",
  "city",
  "state",
  "postcode",
  "country",
  "phone",
  "email",
] as const;

const FIELD_IDS: Record<string, string | undefined> = {
  status: "new-order-status",
  customer_note: "new-order-note",
  payment_method: "new-order-payment-method",
  payment_method_title: "new-order-payment-title",
  ...Object.fromEntries(
    (["billing", "shipping"] as const).flatMap((prefix) =>
      ADDRESS_KEYS.map((key) => [`${prefix}.${key}`, `new-order-${prefix}-${key}`]),
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

/**
 * One address block. Written once and rendered twice, which is the whole reason
 * it exists — billing and shipping differ by exactly one field and a `prefix`,
 * and two hand-maintained copies of eleven controls drift by the third branch.
 *
 * `country` is a text field and not a picker. The API wants an ISO 3166-1
 * alpha-2 code, upper-cases what it is given, and refuses a country *name* with
 * a message that names `DZ` outright — so the refusal is already legible. A
 * picker would need a 249-row country table that this panel does not have and
 * that nothing has measured; `docs/API.md` and `lib/api/schemas` are built on
 * what the live API returns, and a list typed from memory is precisely the kind
 * of data this project does not ship.
 */
function AddressFields({
  prefix,
  value,
  onChange,
  fields,
  wilayaOptions,
  email,
  t,
}: {
  prefix: "billing" | "shipping";
  value: AddressDraft;
  onChange: (next: Partial<AddressDraft>) => void;
  fields: Record<string, string>;
  wilayaOptions: { value: string; label: string }[];
  email: boolean;
  t: ReturnType<typeof useTranslations<"orders.create">>;
}) {
  const id = (key: string) => `new-order-${prefix}-${key}`;
  const error = (key: string) => fields[`${prefix}.${key}`];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <TextField
          id={id("first_name")}
          label={t("address.firstName")}
          value={value.first_name}
          onChange={(next) => onChange({ first_name: next })}
          error={error("first_name")}
          autoComplete="off"
          className="min-w-40 flex-1"
        />
        <TextField
          id={id("last_name")}
          label={t("address.lastName")}
          value={value.last_name}
          onChange={(next) => onChange({ last_name: next })}
          error={error("last_name")}
          autoComplete="off"
          className="min-w-40 flex-1"
        />
      </div>

      <TextField
        id={id("company")}
        label={t("address.company")}
        value={value.company}
        onChange={(next) => onChange({ company: next })}
        error={error("company")}
      />
      <TextField
        id={id("address_1")}
        label={t("address.line1")}
        value={value.address_1}
        onChange={(next) => onChange({ address_1: next })}
        error={error("address_1")}
      />
      <TextField
        id={id("address_2")}
        label={t("address.line2")}
        value={value.address_2}
        onChange={(next) => onChange({ address_2: next })}
        error={error("address_2")}
      />

      <div className="flex flex-wrap gap-3">
        <TextField
          id={id("city")}
          label={t("address.city")}
          value={value.city}
          onChange={(next) => onChange({ city: next })}
          error={error("city")}
          className="min-w-40 flex-1"
        />
        <TextField
          id={id("postcode")}
          label={t("address.postcode")}
          value={value.postcode}
          onChange={(next) => onChange({ postcode: next })}
          error={error("postcode")}
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
        label={t("address.wilaya")}
        value={value.state}
        onChange={(next) => onChange({ state: next })}
        error={error("state")}
        options={wilayaOptions}
      />

      <div className="flex flex-wrap gap-3">
        <TextField
          id={id("country")}
          label={t("address.country")}
          hint={t("address.countryHint")}
          value={value.country}
          onChange={(next) => onChange({ country: next })}
          error={error("country")}
          isolate
          className="min-w-30 flex-1"
        />
        <TextField
          id={id("phone")}
          label={t("address.phone")}
          value={value.phone}
          onChange={(next) => onChange({ phone: next })}
          error={error("phone")}
          isolate
          inputMode="tel"
          autoComplete="off"
          className="min-w-40 flex-1"
        />
      </div>

      {email ? (
        <TextField
          id={id("email")}
          label={t("address.email")}
          value={value.email}
          onChange={(next) => onChange({ email: next })}
          error={error("email")}
          isolate
          inputMode="email"
          autoComplete="off"
        />
      ) : null}
    </div>
  );
}
