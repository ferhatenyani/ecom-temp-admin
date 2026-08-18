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
import { canManageOrders } from "@/lib/capabilities";
import { STATUS_TONE, customerName, customerPhone, orderPlace } from "@/lib/orders";
import { formatMoney } from "@/lib/format/money";
import { formatDate, formatWhen } from "@/lib/format/date";
import { decodeEntities } from "@/lib/format/html";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ForbiddenState, SectionError } from "@/components/patterns/States";
import {
  ListGroup,
  ListRow,
  ListValueRow,
} from "@/components/primitives/GroupedList";
import { StatusBadge, Dot } from "@/components/primitives/StatusBadge";
import { Ltr } from "@/components/primitives/Ltr";
import { Icon } from "@/components/primitives/Icon";
import { StatusAction } from "./StatusAction";

/**
 * The order detail: a stack of grouped inset sections.
 *
 * Each section pulls from its own route and renders independently, so a missing
 * shipment does not block the order. That is why every sub-fetch here catches its
 * own failure and renders a section-level error rather than letting one 500 take
 * the page down.
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
  const tCod = await getTranslations("codStatus");

  if (!canManageOrders(me)) {
    return (
      <Scaffold title={tOrders("title")} back={{ href: `/${locale}/orders`, label: t("back") }}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_orders" />
        </div>
      </Scaffold>
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

  /**
   * The sub-resources, in parallel, each failing alone. `null` means "this
   * section could not load" and renders as such — distinct from an empty array,
   * which means "there is nothing here", a different and legitimate answer.
   */
  const [notesResult, timelineResult, codResult, geography] = await Promise.all([
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
  const money = (value: string) => formatMoney(value, order.currency, locale);

  return (
    <Scaffold
      title={t("title", { number: order.number })}
      back={{ href: `/${locale}/orders`, label: t("back") }}
    >
      <div className="mx-auto max-w-3xl px-4">
        {/* ------------------------------------------------------- summary --- */}
        <ListGroup title={t("summary")}>
          <ListRow>
            <span className="text-body text-label-secondary">{tOrders("status")}</span>
            <span className="ms-auto">
              <StatusBadge tone={STATUS_TONE[order.status]}>
                {tStatus(order.status)}
              </StatusBadge>
            </span>
          </ListRow>
          <ListValueRow
            label={t("created")}
            value={<Ltr>{formatDate(order.date_created, locale)}</Ltr>}
          />
          <ListValueRow
            label={t("modified")}
            value={<Ltr>{formatWhen(order.date_modified, locale)}</Ltr>}
          />
          {order.date_paid ? (
            <ListValueRow
              label={t("paid")}
              value={<Ltr>{formatDate(order.date_paid, locale)}</Ltr>}
            />
          ) : null}
          {order.date_completed ? (
            <ListValueRow
              label={t("completed")}
              value={<Ltr>{formatDate(order.date_completed, locale)}</Ltr>}
            />
          ) : null}
          <ListValueRow
            label={t("paymentMethod")}
            value={order.payment_method_title || order.payment_method || "—"}
          />
        </ListGroup>

        {/* The write path. A 409 renders the moves the API says are legal. */}
        <StatusAction
          orderId={order.id}
          status={order.status}
          locale={locale}
          canWrite={canManageOrders(me)}
        />

        {/* --------------------------------------------------------- items --- */}
        <ListGroup
          title={t("items")}
          footnote={order.is_editable ? t("editableYes") : t("editableNo")}
        >
          {order.line_items.length === 0 ? (
            <ListRow>
              <span className="text-body text-label-secondary">{t("noItems")}</span>
            </ListRow>
          ) : (
            order.line_items.map((item) => (
              <ListRow key={item.id}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-body text-label">{item.name}</span>
                  <span className="text-footnote text-label-secondary">
                    {item.sku ? (
                      <>
                        {/* A SKU inside Arabic text needs its own direction. */}
                        {t("sku")} <Ltr>{item.sku}</Ltr>
                        <span aria-hidden="true"> · </span>
                      </>
                    ) : null}
                    <Ltr numeric>×{item.quantity}</Ltr>
                  </span>
                </span>
                <Ltr className="shrink-0 text-body text-label">{money(item.total)}</Ltr>
              </ListRow>
            ))
          )}
        </ListGroup>

        {/* --------------------------------------------------------- totals --- */}
        <ListGroup>
          <ListValueRow label={t("subtotal")} value={<Ltr>{money(order.subtotal)}</Ltr>} />
          {order.discount_total !== "0.00" ? (
            <ListValueRow
              label={t("discount")}
              value={<Ltr>−{money(order.discount_total)}</Ltr>}
            />
          ) : null}
          <ListValueRow
            label={t("shipping")}
            value={<Ltr>{money(order.shipping_total)}</Ltr>}
          />
          {order.total_tax !== "0.00" ? (
            <ListValueRow label={t("tax")} value={<Ltr>{money(order.total_tax)}</Ltr>} />
          ) : null}
          <ListRow>
            <span className="text-headline text-label">{t("total")}</span>
            <Ltr className="ms-auto text-headline text-label">{money(order.total)}</Ltr>
          </ListRow>
        </ListGroup>

        {/* ------------------------------------------------------- customer --- */}
        <ListGroup title={t("customer")}>
          <ListValueRow
            label={t("customer")}
            value={name ?? (order.customer_id === 0 ? tOrders("guest") : tOrders("noName"))}
          />
          {phone ? (
            <ListRow className="press-row">
              <span className="text-body text-label-secondary">{t("phone")}</span>
              {/* A phone number never mirrors. */}
              <a href={`tel:${phone}`} className="ms-auto flex items-center gap-2 text-accent">
                <Icon name="phone" className="size-4" />
                <Ltr className="text-body">{phone}</Ltr>
              </a>
            </ListRow>
          ) : null}
          {email ? (
            <ListRow>
              <span className="text-body text-label-secondary">{t("email")}</span>
              <a
                href={`mailto:${email}`}
                className="ms-auto min-w-0 truncate text-body text-accent"
              >
                <Ltr numeric={false}>{email}</Ltr>
              </a>
            </ListRow>
          ) : null}
          {/* Two rows both labelled "Adresse" is what these were; they are a
              wilaya and a street, and the labels now say which is which. */}
          {place ? <ListValueRow label={t("wilaya")} value={place} /> : null}
          {order.billing.address_1 ? (
            <ListValueRow label={t("address")} value={order.billing.address_1} />
          ) : null}
          {order.customer_note ? (
            <ListRow>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-footnote text-label-secondary">{t("note")}</span>
                <span className="text-body text-label">{order.customer_note}</span>
              </span>
            </ListRow>
          ) : null}
        </ListGroup>

        {/* ------------------------------------------------------------ COD --- */}
        <ListGroup
          title={t("cod")}
          footnote={cod?.enabled ? t("codNotAStatus") : undefined}
        >
          {cod === null ? (
            <ListRow>
              <SectionError>{t("sectionFailed")}</SectionError>
            </ListRow>
          ) : !cod.enabled ? (
            <ListRow>
              <span className="text-body text-label-secondary">{t("codDisabled")}</span>
            </ListRow>
          ) : (
            <>
              <ListRow>
                <span className="text-body text-label-secondary">{t("codStatus")}</span>
                <span className="ms-auto flex items-center gap-2">
                  <Dot tone={cod.status === "confirmed" ? "success" : "warning"} />
                  <span className="text-body text-label">
                    {/* An outcome the panel has no label for still renders as
                        itself rather than as a blank row. */}
                    {tCod.has(cod.status as "pending") ? tCod(cod.status as "pending") : cod.status}
                  </span>
                </span>
              </ListRow>
              <ListValueRow
                label={t("codAttempts", { count: cod.attempts })}
                value={
                  cod.last_attempt_at ? (
                    <Ltr>{formatWhen(cod.last_attempt_at, locale)}</Ltr>
                  ) : (
                    "—"
                  )
                }
              />
            </>
          )}
        </ListGroup>

        {/* ------------------------------------------------------- timeline --- */}
        <ListGroup title={t("timeline")}>
          {events === null ? (
            <ListRow>
              <SectionError>{t("sectionFailed")}</SectionError>
            </ListRow>
          ) : events.length === 0 ? (
            <ListRow>
              <span className="text-body text-label-secondary">{t("noNotes")}</span>
            </ListRow>
          ) : (
            events.map((event, index) => (
              <ListRow key={`${event.type}-${event.at}-${index}`}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {/*
                    Decoded, not rendered raw: the API sends
                    "(99&rarr;98)" and React would print those six characters
                    literally. Decoded to text, never to HTML.
                  */}
                  <span className="text-subhead text-label">
                    {decodeEntities(event.summary)}
                  </span>
                  <span className="text-caption text-label-secondary">
                    <Ltr>{formatWhen(event.at, locale)}</Ltr>
                    {event.actor ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        {event.actor === "system" ? t("system") : event.actor}
                      </>
                    ) : null}
                  </span>
                </span>
              </ListRow>
            ))
          )}
        </ListGroup>

        {/*
          Customer notes only.

          `GET /orders/{id}/timeline` already aggregates the note rows alongside
          the stock and audit events — measured: the three notes on order 3078 all
          appear in its five timeline entries. Rendering the full notes collection
          underneath reprinted every one of them a second time. What the timeline
          does not distinguish is whose note it is, so this section keeps the ones
          a customer wrote, which are the ones a support agent is looking for.
        */}
        {customerNotes.length > 0 ? (
          <ListGroup title={t("customerNotes")}>
            {customerNotes.map((note) => (
              <ListRow key={note.id}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-subhead text-label">
                    {decodeEntities(note.content)}
                  </span>
                  <span className="text-caption text-label-secondary">
                    {/* `created_at` has no offset, so it is read as UTC rather
                        than as the host's local time. */}
                    <Ltr>{formatWhen(note.created_at, locale)}</Ltr>
                    <span aria-hidden="true"> · </span>
                    {note.added_by === "system" ? t("system") : note.added_by}
                  </span>
                </span>
              </ListRow>
            ))}
          </ListGroup>
        ) : null}
      </div>
    </Scaffold>
  );
}
