"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { PAYMENT_STATUS_TONE, isSettledPayment, type PaymentStatus } from "@/lib/payment-status";
import type { Payment, PaymentMethod, VerifyResult } from "@/lib/api/schemas/payment";
import { formatMoney } from "@/lib/format/money";
import { formatWhen } from "@/lib/format/date";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { SectionError } from "@/components/patterns/States";
import { useToast } from "@/components/primitives/Toast";

/**
 * The transactions on one order.
 *
 * **Several transactions per order is the design, not a duplicate** — a
 * duplicated checkout link is a link nobody clicked, and deduplicating them in
 * the UI would hide the abandoned attempt that explains why the order is not
 * paid. The footnote says so, because a list with three rows for one order reads
 * as a bug otherwise.
 *
 * **Verify is the only write, and it answers a shape that is not a payment.**
 * Measured: `{report, transaction}` — the provider's own answer beside the stored
 * record — and `report.amount` came back as an **empty string** on a `cod`
 * transaction, so the report is never formatted as money. `transaction` is the
 * authority for every figure; `report.provider_status` is the useful part,
 * because a mis-mapped adapter shows up there and nowhere else.
 *
 * There is no create button. `POST /orders/{id}/payments` opens a checkout at the
 * provider and hands back a `pay.chargily.dz` link for the *customer* — a shopper
 * action, and one the proxy allowlist refuses with its reason written down.
 */
export function PaymentsSection({
  payments,
  methods,
  failed,
  canWrite,
  locale,
}: {
  payments: Payment[];
  methods: PaymentMethod[];
  failed: boolean;
  canWrite: boolean;
  locale: string;
}) {
  const t = useTranslations("payments");
  const tStatus = useTranslations("paymentStatus");
  const router = useRouter();
  const toast = useToast();

  const [report, setReport] = useState<{ id: number; result: VerifyResult } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: async (id: number) =>
      acWrite<VerifyResult>("POST", `/payments/${id}/verify`, undefined),
    onSuccess: (result, id) => {
      setRefusal(null);
      setReport({ id, result });
      const status = result.report.status;
      toast.show(
        t("verified", {
          status: tStatus.has(status as "pending") ? tStatus(status as "pending") : status,
        }),
      );
      // Verification may settle an order and reduce stock, so every section on
      // this screen can have moved underneath it.
      router.refresh();
    },
    onError: (error: unknown) =>
      setRefusal(error instanceof BrowserApiError ? error.message : t("verifyFailed")),
  });

  const methodLabel = (name: string) =>
    methods.find((method) => method.name === name)?.label ?? name;

  return (
    <ListGroup
      title={t("transactions")}
      footnote={
        payments.length === 0
          ? undefined
          : payments.length > 1
            ? `${t("several")} ${canWrite ? t("verifyNote") : ""}`.trim()
            : canWrite
              ? t("verifyNote")
              : undefined
      }
    >
      {failed ? (
        <ListRow>
          <SectionError>{t("noPayments")}</SectionError>
        </ListRow>
      ) : payments.length === 0 ? (
        <ListRow>
          <span className="text-body text-label-secondary">{t("noPayments")}</span>
        </ListRow>
      ) : (
        payments.map((payment) => (
          <ListRow key={payment.id}>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2">
                <StatusBadge
                  tone={PAYMENT_STATUS_TONE[payment.status as PaymentStatus] ?? "neutral"}
                >
                  {tStatus.has(payment.status as "pending")
                    ? tStatus(payment.status as "pending")
                    : payment.status}
                </StatusBadge>
                {/* A payment carries its own currency, like an order and unlike a
                    product. Formatting every row with SHOP_CURRENCY would be
                    silently wrong on an install with pre-DZD orders. */}
                <Ltr className="text-headline text-label">
                  {formatMoney(payment.amount, payment.currency, locale)}
                </Ltr>
              </span>
              <span className="truncate text-footnote text-label-secondary" dir="auto">
                {methodLabel(payment.provider)}
                {payment.reference !== "" ? (
                  <>
                    <span aria-hidden="true"> · </span>
                    <Ltr>{payment.reference}</Ltr>
                  </>
                ) : null}
                <span aria-hidden="true"> · </span>
                <Isolate>{formatWhen(payment.created_at, locale)}</Isolate>
              </span>

              {isSettledPayment(payment.status) ? (
                <span className="text-caption text-label-tertiary">{t("settledNote")}</span>
              ) : null}

              {report?.id === payment.id ? (
                <span className="mt-1 flex flex-col gap-0.5 rounded-sm bg-surface-2 px-3 py-2">
                  <span className="text-caption text-label-secondary">{t("report")}</span>
                  <span className="text-footnote text-label">
                    {t("reportStatus")}:{" "}
                    {tStatus.has(report.result.report.status as "pending")
                      ? tStatus(report.result.report.status as "pending")
                      : report.result.report.status}
                  </span>
                  {report.result.report.provider_status !== "" ? (
                    <span className="text-footnote text-label-secondary">
                      {t("reportProviderStatus")}: <Ltr>{report.result.report.provider_status}</Ltr>
                    </span>
                  ) : null}
                  {/* The provider returned no amount — said plainly rather than
                      rendered as `0,00 DA`, which is a number someone would put
                      in a report. */}
                  {report.result.report.amount === "" ? (
                    <span className="text-caption text-label-tertiary">
                      {t("reportNoAmount")}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>

            {/*
              A short label, and the sentence that explains it in the section
              footnote instead.
              
              "Vérifier auprès du fournisseur" beside a money figure at 390 px
              did not truncate — `Button` sets no width and the row's flex let it
              overrun — so the action rendered *on top of* the amount and the
              provider name. Caught in a screenshot, by nothing else: the markup
              is valid, the types are fine and no test could see it.
            */}
            {canWrite ? (
              <Button
                variant="plain"
                className="shrink-0"
                loading={verify.isPending && verify.variables === payment.id}
                disabled={verify.isPending}
                onClick={() => verify.mutate(payment.id)}
              >
                {verify.isPending && verify.variables === payment.id
                  ? t("verifying")
                  : t("verifyShort")}
              </Button>
            ) : null}
          </ListRow>
        ))
      )}

      {refusal ? (
        <ListRow className="tone-warning">
          <span className="flex items-start gap-2">
            <Icon name="alert" className="tonal-fg mt-0.5 size-4 shrink-0" />
            <span className="text-subhead text-label">{refusal}</span>
          </span>
        </ListRow>
      ) : null}

    </ListGroup>
  );
}
