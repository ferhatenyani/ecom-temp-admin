"use client";

import { useTranslations } from "next-intl";
import { COD_STATUS_TONE, type CodStatus } from "@/lib/cod-status";
import { byStatusSumsToTotal, codByStatus, codFigures, ratePercent, RATE_KEYS } from "@/lib/cod";
import { PAYMENT_STATUS_TONE, type PaymentStatus } from "@/lib/payment-status";
import type { CodStatistics, Payment, PaymentMethod } from "@/lib/api/schemas/payment";
import { formatMoney } from "@/lib/format/money";
import { formatWhen } from "@/lib/format/date";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { ForbiddenState, SectionError } from "@/components/patterns/States";

/**
 * The transactions ledger and the COD funnel.
 *
 * Every figure in the funnel carries its scope, because this payload is the
 * clearest case in the API of two numbers that look like the same number: 74
 * confirmed and 111 confirmed, side by side, both correct. `CodFigure` makes the
 * scope non-optional so nothing can print one without it, and the note between
 * them says which question each answers.
 */
export function PaymentsScreen({
  locale,
  canPay,
  initialPayments,
  total,
  paymentsFailed,
  methods,
  statistics,
}: {
  locale: string;
  canPay: boolean;
  initialPayments: Payment[];
  total: number;
  paymentsFailed: boolean;
  methods: PaymentMethod[];
  statistics: CodStatistics | null;
}) {
  const t = useTranslations("payments");
  const tCod = useTranslations("cod");
  const tStatus = useTranslations("paymentStatus");
  const tCodStatus = useTranslations("codStatus");

  const methodLabel = (name: string) =>
    methods.find((method) => method.name === name)?.label ?? name;

  const figures = statistics === null ? [] : codFigures(statistics);
  const breakdown = statistics === null ? [] : codByStatus(statistics);

  return (
    <div className="mx-auto max-w-3xl px-4">
      {/* ------------------------------------------------- transactions --- */}
      {canPay ? (
        <ListGroup
          title={t("transactions")}
          footnote={
            paymentsFailed ? undefined : <Isolate>{t("count", { count: total })}</Isolate>
          }
        >
          {paymentsFailed ? (
            <ListRow>
              <SectionError>{t("noPayments")}</SectionError>
            </ListRow>
          ) : initialPayments.length === 0 ? (
            <ListRow>
              <span className="text-body text-label-secondary">{t("noPayments")}</span>
            </ListRow>
          ) : (
            initialPayments.map((payment) => (
              <ListRow key={payment.id}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <StatusBadge
                      tone={PAYMENT_STATUS_TONE[payment.status as PaymentStatus] ?? "neutral"}
                    >
                      {tStatus.has(payment.status as "pending")
                        ? tStatus(payment.status as "pending")
                        : payment.status}
                    </StatusBadge>
                    {/* Formatted with the payment's own currency, never with
                        SHOP_CURRENCY — a transaction carries one, like an order. */}
                    <Ltr className="text-headline text-label">
                      {formatMoney(payment.amount, payment.currency, locale)}
                    </Ltr>
                  </span>
                  <span className="truncate text-footnote text-label-secondary" dir="auto">
                    {methodLabel(payment.provider)}
                    <span aria-hidden="true"> · </span>
                    <Ltr>{`#${payment.order_id}`}</Ltr>
                    <span aria-hidden="true"> · </span>
                    <Isolate>{formatWhen(payment.created_at, locale)}</Isolate>
                  </span>
                </span>
              </ListRow>
            ))
          )}
        </ListGroup>
      ) : (
        // A Manager reaching this URL. The COD report below still renders,
        // because they are entitled to it and hiding it would be the panel
        // inventing a rule the API does not have.
        <div className="mb-8">
          <ForbiddenState capability="ac_manage_payments" />
        </div>
      )}

      {/* ------------------------------------------------- the COD funnel --- */}
      {statistics !== null ? (
        <>
          <ListGroup
            title={tCod("statistics")}
            footnote={
              byStatusSumsToTotal(statistics) ? (
                <Isolate>
                  {tCod("twoCounts", { total: statistics.total_orders })}
                </Isolate>
              ) : undefined
            }
          >
            {figures.map((figure) => (
              <ListRow key={figure.key}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-body text-label-secondary">
                    {tCod(
                      figure.key === "total_orders"
                        ? "statTotal"
                        : figure.key === "current_confirmed"
                          ? "statCurrentConfirmed"
                          : figure.key === "ever_confirmed"
                            ? "statEverConfirmed"
                            : figure.key === "delivered_orders"
                              ? "statDelivered"
                              : "statReturned",
                    )}
                  </span>
                  {/* The scope, on every figure, never optional. Two numbers
                      labelled "confirmed" with no scope between them is how a
                      reader concludes one of them is broken. */}
                  <span className="text-caption text-label-tertiary">
                    {tCod(
                      figure.scope === "all"
                        ? "scopeAll"
                        : figure.scope === "now"
                          ? "scopeNow"
                          : "scopeEver",
                    )}
                  </span>
                </span>
                <Ltr numeric className="ms-auto text-title-3 text-label">
                  {new Intl.NumberFormat(
                    locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ",
                  ).format(figure.value)}
                </Ltr>
              </ListRow>
            ))}
          </ListGroup>

          <ListGroup title={tCod("breakdown")}>
            {breakdown.map((row) => (
              <ListRow key={row.status}>
                <StatusBadge tone={COD_STATUS_TONE[row.status as CodStatus] ?? "neutral"}>
                  {tCodStatus.has(row.status as "pending")
                    ? tCodStatus(row.status as "pending")
                    : row.status}
                </StatusBadge>
                <Ltr numeric className="ms-auto text-body text-label">
                  {new Intl.NumberFormat(
                    locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ",
                  ).format(row.count)}
                </Ltr>
              </ListRow>
            ))}
          </ListGroup>

          <ListGroup
            title={tCod("rates")}
            footnote={
              <Isolate>{tCod("rateBase", { total: statistics.total_orders })}</Isolate>
            }
          >
            {RATE_KEYS.map((key) => {
              const value = ratePercent(statistics.rates[key]);
              return (
                <ListValueRow
                  key={key}
                  label={tCod(
                    key === "confirmation"
                      ? "rateConfirmation"
                      : key === "rejection"
                        ? "rateRejection"
                        : key === "cancellation"
                          ? "rateCancellation"
                          : key === "delivery"
                            ? "rateDelivery"
                            : "rateReturn",
                  )}
                  value={
                    value === null ? (
                      "—"
                    ) : (
                      <Ltr numeric>
                        {new Intl.NumberFormat(
                          locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ",
                          { style: "percent", maximumFractionDigits: 1 },
                        ).format(value)}
                      </Ltr>
                    )
                  }
                />
              );
            })}
          </ListGroup>
        </>
      ) : null}
    </div>
  );
}
