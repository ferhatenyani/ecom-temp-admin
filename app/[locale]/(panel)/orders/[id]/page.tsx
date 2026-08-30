import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  codRecord,
  order as orderSchema,
  orderNotes,
  timeline as timelineSchema,
  wilayas as wilayasSchema,
  type CodRecord,
  type OrderNote,
  type TimelineEntry,
  type Wilaya,
} from "@/lib/api/schemas/order";
import {
  shipments as shipmentsSchema,
  shippingProviders as providersSchema,
  type ShippingProvider,
} from "@/lib/api/schemas/shipping";
import {
  paymentMethods,
  payments as paymentsSchema,
  type Payment,
  type PaymentMethod,
} from "@/lib/api/schemas/payment";
import { stripLabelUrlsFrom } from "@/lib/shipping";
import { canManageOrders, has } from "@/lib/capabilities";
import { STATUS_TONE } from "@/lib/order-status";
import { customerName, customerPhone, orderPlace } from "@/lib/orders";
import { formatDate, formatWhen } from "@/lib/format/date";
import { decodeEntities } from "@/lib/format/html";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { DetailGrid } from "@/components/ui/Detail";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ForbiddenState, SectionError } from "@/components/ui/States";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { Icon } from "@/components/primitives/Icon";
import { OrderScreen, OrderNotices } from "./OrderScreen";
import { OrderActions } from "./OrderActions";
import { OrderEditDrawer } from "./OrderEditDrawer";
import { OrderItems } from "./OrderItems";
import { CodSection } from "./CodSection";
import { ParcelsSection } from "./ParcelsSection";
import { PaymentsSection } from "./PaymentsSection";

/**
 * The order detail — the first detail screen on the new system, and the one the
 * roughly twenty after it inherit their shape from.
 *
 * ## The two columns, and which side a thing lands on
 *
 * `DetailGrid`: main `1fr` plus a 360px aside at `lg`+, the aside collapsing
 * **below** main. The split is not by importance, it is by *shape*:
 *
 *   main    line items and totals · timeline · customer notes · parcels ·
 *           payments — the wide, tabular, unboundedly-growing things. A parcel
 *           list can be five rows long and a timeline twenty.
 *   aside   status · dates · payment method · the customer · COD — fixed-height
 *           reference material a person glances at while reading the main column.
 *
 * The **primary action is in `PageHeader`**, never in the aside, and that is the
 * rule for the whole run: below `lg` the aside drops beneath a line-item list
 * whose length is the order's, so a control down there sits at a scroll offset
 * that depends on the data.
 *
 * ## What survives from the screen this replaces
 *
 * Everything below this line is a measurement rather than a style, and the
 * rebuild kept all of it:
 *
 *   - the parallel sub-resource fetch, each failure caught alone, with `null`
 *     (this section could not load) distinct from `[]` (there is nothing here)
 *   - `stripLabelUrlsFrom` running server-side, **before** these become props:
 *     an RSC payload is in the document, so an unstripped shipment would put a
 *     courier's credential there whether or not anything rendered it
 *   - the capability-conditional shipping and payment reads, deliberately not
 *     fired-and-caught: a Manager is 403 on every payments route — measured —
 *     and spending two requests per order detail to be refused would cost two of
 *     a 600/min budget shared across their open tabs, to render nothing
 *   - the customer-notes-only filter, because the timeline already carries them
 *   - `decodeEntities` on summaries and note bodies
 *   - every `Ltr` / `Isolate` wrap, and `dir="auto"` on the email anchor
 *   - `formatWhen` for the offsetless `created_at`
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("orders.detail");
  const tOrders = await getTranslations("orders");
  const tStatus = await getTranslations("status");

  if (!canManageOrders(me)) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={tOrders("title")}
          back={{ href: `/${locale}/orders`, label: t("back") }}
          divided={false}
        />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_orders" />
        </PageBody>
      </div>
    );
  }

  const numericId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) notFound();

  // The order itself must succeed; a 404 is a real not-found.
  let order;
  try {
    order = (await acFetch(orderSchema, session, `/orders/${numericId}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const canShip = has(me, "ac_manage_shipping");
  const canPay = has(me, "ac_manage_payments");

  const [
    notesResult,
    timelineResult,
    codResult,
    geography,
    shipmentsResult,
    providersResult,
    paymentsResult,
    methodsResult,
  ] = await Promise.all([
    acFetch(orderNotes, session, `/orders/${numericId}/notes`)
      .then((r) => r.data)
      .catch(() => null),
    acFetch(timelineSchema, session, `/orders/${numericId}/timeline`)
      .then((r) => r.data)
      .catch(() => null),
    acFetch(codRecord, session, `/orders/${numericId}/cod`)
      .then((r) => r.data)
      .catch(() => null),
    acFetch(wilayasSchema, session, "/locations/wilayas")
      .then((r) => r.data)
      .catch(() => [] as Wilaya[]),
    canShip
      ? acFetch(shipmentsSchema, session, `/orders/${numericId}/shipments`)
          .then((r) => r.data)
          .catch(() => null)
      : Promise.resolve(null),
    canShip
      ? acFetch(providersSchema, session, "/shipping/providers")
          .then((r) => r.data)
          .catch(() => [] as ShippingProvider[])
      : Promise.resolve([] as ShippingProvider[]),
    canPay
      ? acFetch(paymentsSchema, session, `/orders/${numericId}/payments`)
          .then((r) => r.data)
          .catch(() => null)
      : Promise.resolve(null),
    canPay
      ? acFetch(paymentMethods, session, "/payments/methods")
          .then((r) => r.data)
          .catch(() => [] as PaymentMethod[])
      : Promise.resolve([] as PaymentMethod[]),
  ]);

  const notes: OrderNote[] | null = notesResult;
  const customerNotes = (notes ?? []).filter((note) => note.customer_note);
  const events: TimelineEntry[] | null = timelineResult;
  const cod: CodRecord | null = codResult;
  const wilayasByCode = new Map((geography ?? []).map((w) => [w.code, w]));

  const name = customerName(order);
  const phone = customerPhone(order);
  const place = orderPlace(order, wilayasByCode, locale);
  const email = order.billing.email ?? "";

  /**
   * When this render happened, for §3.7's stale marker.
   *
   * The list polls every 30 s; this screen is a Server Component and only moves
   * when something asks it to — a write, or the header's refresh. So the age of
   * what is on screen is the age of *this render*, and the marker reports it
   * rather than leaving the staleness silent.
   *
   * `react-hooks/purity` flags `Date.now()` in a component body, and it is right
   * about the case it is written for: a client component that re-renders would
   * produce a different value each time and React could not tell which one was
   * meant. **An async Server Component is not that case.** It runs once per
   * request, on the server, and never re-renders — so the value is as stable as
   * the response it is part of, and reading the clock here *is* part of the
   * fetch rather than part of the render.
   *
   * A client-side alternative was tried and is wrong: recording the time in a
   * mount effect gives an age that stops moving after `router.refresh()`, which
   * re-renders this Server Component without remounting the client tree — so the
   * marker would report the age of the first render forever.
   */
  // eslint-disable-next-line react-hooks/purity -- see above: a Server Component renders once per request.
  const fetchedAt = Date.now();

  return (
    <OrderScreen fetchedAt={fetchedAt} locale={locale}>
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={t("title", { number: order.number })}
          subtitle={<Isolate>{formatDate(order.date_created, locale)}</Isolate>}
          back={{ href: `/${locale}/orders`, label: t("back") }}
          /* A detail page omits the rule and lets the first card do the
             separating — §2.4. */
          divided={false}
          actions={
            <>
              <OrderActions
                orderId={order.id}
                status={order.status}
                canWrite={canManageOrders(me)}
              />
              {/*
                After the status control, not before it: the header reads
                [refresh · primary · secondary], which is the arrangement the
                orders list already has. The status is the primary — §3.3 allows
                exactly one per view — and this is the second act, which writes
                every field the status is not. The two never share a payload;
                `OrderEditDrawer`'s docblock carries the measurement that makes
                that a requirement rather than a preference.

                `wilayas` is already fetched above for the aside's place label,
                so the address blocks' pickers cost no extra request.
              */}
              <OrderEditDrawer
                order={order}
                wilayas={geography ?? []}
                locale={locale}
                canWrite={canManageOrders(me)}
                canPickCustomers={has(me, "ac_manage_customers")}
              />
            </>
          }
        />

        <PageBody width="split">
          {/* Above the grid, so a refusal from either column is seen at every
              width. §3.1: an error a person must act on is never a toast. */}
          <OrderNotices />

          <DetailGrid
            main={
              <>
                {/*
                  The line-item editor lives in this card rather than the
                  header: §3.3 allows one primary action per view, the header
                  already has two, and — the better reason — the card is where
                  the disabled reason is already printed. Both capabilities are
                  resolved here on the server, `ac_manage_products` for the
                  editor's picker exactly as `NewOrderDrawer` needs it.
                */}
                <OrderItems
                  order={order}
                  locale={locale}
                  canWrite={canManageOrders(me)}
                  canPickProducts={has(me, "ac_manage_products")}
                />

                {/* ------------------------------------------------- timeline --- */}
                <Card title={t("timeline")}>
                  {events === null ? (
                    <SectionError>{t("sectionFailed")}</SectionError>
                  ) : events.length === 0 ? (
                    <p className="text-ui-body text-ui-muted">{t("noNotes")}</p>
                  ) : (
                    <ol className="flex flex-col">
                      {events.map((event, index) => (
                        <li
                          key={`${event.type}-${event.at}-${index}`}
                          className="flex min-w-0 flex-col gap-0.5 border-b border-ui-line py-2.5 first:pt-0 last:border-b-0 last:pb-0"
                        >
                          {/*
                            Decoded, not rendered raw: the API sends
                            "(99&rarr;98)" and React would print those six
                            characters literally. Decoded to text, never to HTML.
                          */}
                          {/* `break-words`, because a timeline summary quotes
                              the product's SKU and this shop has a 60-character
                              one: without it the run overflows the card, which
                              `overflow-hidden` then clips — a value on screen
                              with no way to read it, which §2.1 forbids. */}
                          <span
                            dir="auto"
                            className="text-ui-compact break-words text-ui-fg"
                          >
                            {decodeEntities(event.summary)}
                          </span>
                          <span className="text-ui-caption text-ui-subtle">
                            <Isolate>{formatWhen(event.at, locale)}</Isolate>
                            {event.actor ? (
                              <>
                                <span aria-hidden="true"> · </span>
                                {event.actor === "system" ? t("system") : event.actor}
                              </>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>

                {/*
                  Customer notes only.

                  `GET /orders/{id}/timeline` already aggregates the note rows
                  alongside the stock and audit events — measured: the three notes
                  on order 3078 all appear in its five timeline entries. Rendering
                  the full notes collection underneath reprinted every one of them
                  a second time. What the timeline does not distinguish is whose
                  note it is, so this section keeps the ones a customer wrote,
                  which are the ones a support agent is looking for.
                */}
                {customerNotes.length > 0 ? (
                  <Card title={t("customerNotes")}>
                    <ul className="flex flex-col">
                      {customerNotes.map((note) => (
                        <li
                          key={note.id}
                          className="flex min-w-0 flex-col gap-0.5 border-b border-ui-line py-2.5 first:pt-0 last:border-b-0 last:pb-0"
                        >
                          <span
                            dir="auto"
                            className="text-ui-compact break-words text-ui-fg"
                          >
                            {decodeEntities(note.content)}
                          </span>
                          <span className="text-ui-caption text-ui-subtle">
                            {/* `created_at` has no offset, so it is read as UTC
                                rather than as the host's local time. */}
                            <Isolate>{formatWhen(note.created_at, locale)}</Isolate>
                            <span aria-hidden="true"> · </span>
                            {note.added_by === "system" ? t("system") : note.added_by}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : null}

                {/* ---------------------------------------------------- parcels --- */}
                {canShip ? (
                  <ParcelsSection
                    orderId={order.id}
                    // Stripped on the server, before these become props.
                    shipments={stripLabelUrlsFrom(shipmentsResult ?? [])}
                    failed={shipmentsResult === null}
                    providers={providersResult ?? []}
                    wilayas={geography ?? []}
                    canWrite={canShip}
                    locale={locale}
                  />
                ) : null}

                {/* --------------------------------------------------- payments --- */}
                {canPay ? (
                  <PaymentsSection
                    payments={(paymentsResult ?? []) as Payment[]}
                    methods={methodsResult ?? []}
                    failed={paymentsResult === null}
                    canWrite={canPay}
                    locale={locale}
                  />
                ) : null}
              </>
            }
            aside={
              <>
                {/* ---------------------------------------------------- summary --- */}
                <Card title={t("summary")}>
                  <DataList>
                    <DataRow label={tOrders("status")}>
                      <Badge tone={STATUS_TONE[order.status]}>
                        {tStatus(order.status)}
                      </Badge>
                    </DataRow>
                    <DataRow label={t("created")}>
                      {/* `Isolate`, not `Ltr`: ICU puts RTL marks inside the
                          Arabic form on purpose and forcing dir="ltr" over them
                          renders the date wrong. See primitives/Ltr.tsx. */}
                      <Isolate>{formatDate(order.date_created, locale)}</Isolate>
                    </DataRow>
                    <DataRow label={t("modified")}>
                      <Isolate>{formatWhen(order.date_modified, locale)}</Isolate>
                    </DataRow>
                    {order.date_paid ? (
                      <DataRow label={t("paid")}>
                        <Isolate>{formatDate(order.date_paid, locale)}</Isolate>
                      </DataRow>
                    ) : null}
                    {order.date_completed ? (
                      <DataRow label={t("completed")}>
                        <Isolate>{formatDate(order.date_completed, locale)}</Isolate>
                      </DataRow>
                    ) : null}
                    <DataRow label={t("paymentMethod")}>
                      <span dir="auto">
                        {order.payment_method_title || order.payment_method || "—"}
                      </span>
                    </DataRow>
                  </DataList>
                </Card>

                {/* --------------------------------------------------- customer --- */}
                <Card title={t("customer")}>
                  <DataList>
                    <DataRow label={t("customer")}>
                      <span dir="auto">
                        {name ??
                          (order.customer_id === 0 ? tOrders("guest") : tOrders("noName"))}
                      </span>
                    </DataRow>
                    {phone ? (
                      <DataRow label={t("phone")}>
                        {/* A phone number never mirrors. */}
                        <a
                          href={`tel:${phone}`}
                          className="ui-ring inline-flex items-center gap-1.5 rounded-ui-md text-ui-accent hover:underline"
                        >
                          <Icon name="phone" className="size-3.5 shrink-0" />
                          <Ltr>{phone}</Ltr>
                        </a>
                      </DataRow>
                    ) : null}
                    {email ? (
                      <DataRow label={t("email")}>
                        {/* `Ltr` isolates the address; the clipping is on the
                            anchor, which inherits the *page's* direction — so in
                            Arabic the ellipsis landed at the anchor's left and ate
                            the start of the address. The container needs its own
                            resolved direction too, or the isolation inside it is
                            clipped from the wrong end. */}
                        <a
                          href={`mailto:${email}`}
                          dir="auto"
                          className="ui-ring block min-w-0 truncate rounded-ui-md text-ui-accent hover:underline"
                        >
                          <Ltr numeric={false}>{email}</Ltr>
                        </a>
                      </DataRow>
                    ) : null}
                    {/* Two rows both labelled "Adresse" is what these were; they
                        are a wilaya and a street, and the labels say which. */}
                    {place ? (
                      <DataRow label={t("wilaya")}>
                        <span dir="auto">{place}</span>
                      </DataRow>
                    ) : null}
                    {order.billing.address_1 ? (
                      <DataRow label={t("address")}>
                        {/*
                         * Isolated, like every other identifier.
                         *
                         * A street address is Latin-script content with a number
                         * in it, and inside an Arabic paragraph the bidi algorithm
                         * moves that number to the other end: `1 Rue Test`
                         * rendered as `Rue Test 1`, relocating the house number
                         * with nothing to show it happened. `numeric={false}`
                         * because an address is prose, not a column of figures.
                         */}
                        <Ltr numeric={false}>{order.billing.address_1}</Ltr>
                      </DataRow>
                    ) : null}
                    {order.customer_note ? (
                      <DataRow label={t("note")} stacked>
                        <span dir="auto">{decodeEntities(order.customer_note)}</span>
                      </DataRow>
                    ) : null}
                  </DataList>
                </Card>

                {/* -------------------------------------------------------- COD --- */}
                <CodSection
                  orderId={order.id}
                  orderStatus={order.status}
                  record={cod}
                  canWrite={canManageOrders(me)}
                  locale={locale}
                />
              </>
            }
          />
        </PageBody>
      </div>
    </OrderScreen>
  );
}
