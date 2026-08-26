"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { PAYMENT_STATUS_TONE, type PaymentStatus } from "@/lib/payment-status";
import { providerLabel } from "@/lib/payments";
import type { Payment, PaymentMethod, VerifyResult } from "@/lib/api/schemas/payment";
import { formatMoney } from "@/lib/format/money";
import { formatWhen } from "@/lib/format/date";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { SectionError } from "@/components/ui/States";
import { useToast } from "@/components/primitives/Toast";
import { useOrderScreen } from "./OrderScreen";

/**
 * The transactions on one order.
 *
 * **Several transactions per order is the design, not a duplicate** — a
 * duplicated checkout link is a link nobody clicked, and deduplicating them in
 * the UI would hide the abandoned attempt that explains why the order is not
 * paid. The footnote says so, because a list with three rows for one order reads
 * as a bug otherwise.
 *
 * **`needs_payment` stays unused, and that is the second answer to the same
 * question rather than a smaller version of the first.** It was tried here as a
 * footnote restating the flag — *this order is still waiting for money* / *it is
 * not* — and the restatement is honest but it is not news: the status badge in
 * the aside and the transaction statuses in this very list already say it, and it
 * cannot say the thing that would be worth a line, which is whether an unsettled
 * transaction will ever settle. A COD order collected by a courier and a
 * cancelled one both report `false` and mean different things.
 *
 * So this card carries **one** sentence, and it is the one that explains
 * something surprising which is on the screen right now: an order with three
 * transactions is not an order billed three times. `stock_reduced` is left alone
 * for the same reason — there is no honest sentence to write from it here.
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
  const tProvider = useTranslations("paymentProvider");
  const router = useRouter();
  const toast = useToast();
  const { refuse, writesBlocked } = useOrderScreen();

  const [report, setReport] = useState<{ id: number; result: VerifyResult } | null>(null);

  const verify = useMutation({
    mutationFn: async (id: number) =>
      acWrite<VerifyResult>("POST", `/payments/${id}/verify`, undefined),
    onSuccess: (result, id) => {
      refuse(null);
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
      refuse(
        <p className="text-ui-subheading">
          {error instanceof BrowserApiError || error instanceof Error
            ? error.message
            : t("verifyFailed")}
        </p>,
      ),
  });

  /*
   * **Message key → API `label` → raw name**, and this is a fix rather than a
   * tidy-up. The API's label for `cod` is "Cash on delivery" — measured
   * 2026-08-26 and re-measured since — and this line used to be
   * `methods.find(…)?.label ?? name`, so an English string rendered on every
   * cash transaction of this card in the French panel *and* in the Arabic one.
   * It is the same defect the shipping branch fixed in `providerLabel`, in a
   * second place. `chargily` has no key and keeps its brand. See
   * `lib/payments.ts`.
   */
  const methodLabel = (name: string) =>
    providerLabel(name, methods, (key) =>
      tProvider.has(key as "cod") ? tProvider(key as "cod") : null,
    );

  /* The section itself is absent without `ac_manage_payments`, so the only
     reason a rendered Verify button can be unavailable is the connection. */
  const cannotVerify = writesBlocked;

  return (
    <Card
      title={t("transactions")}
      /* One sentence, and only when the screen has produced the thing it
         explains. Three rows for one order reads as a bug otherwise. */
      footnote={payments.length > 1 ? t("several") : undefined}
    >
      {failed ? (
        <SectionError>{t("noPayments")}</SectionError>
      ) : payments.length === 0 ? (
        <p className="text-ui-body text-ui-muted">{t("noPayments")}</p>
      ) : (
        <ul className="flex flex-col">
          {payments.map((payment) => (
            <li
              key={payment.id}
              className="flex min-w-0 items-start gap-3 border-b border-ui-line py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge
                    tone={PAYMENT_STATUS_TONE[payment.status as PaymentStatus] ?? "neutral"}
                  >
                    {tStatus.has(payment.status as "pending")
                      ? tStatus(payment.status as "pending")
                      : payment.status}
                  </Badge>
                  {/* A payment carries its own currency, like an order and unlike a
                      product. Formatting every row with SHOP_CURRENCY would be
                      silently wrong on an install with pre-DZD orders. */}
                  <Ltr className="text-ui-subheading text-ui-fg">
                    {formatMoney(payment.amount, payment.currency, locale)}
                  </Ltr>
                </div>

                {/* Wraps rather than truncating: at 340px a truncated line
                    loses the timestamp, which is the fact that tells an
                    abandoned checkout from a live one. */}
                <span
                  dir="auto"
                  className="min-w-0 break-words text-ui-label text-ui-subtle"
                >
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

                {report?.id === payment.id ? (
                  <div className="mt-1 flex flex-col gap-0.5 rounded-ui-md bg-ui-surface-2 px-3 py-2">
                    <span className="text-ui-caption text-ui-muted">{t("report")}</span>
                    <span className="text-ui-label text-ui-fg">
                      {t("reportStatus")}:{" "}
                      {tStatus.has(report.result.report.status as "pending")
                        ? tStatus(report.result.report.status as "pending")
                        : report.result.report.status}
                    </span>
                    {report.result.report.provider_status !== "" ? (
                      <span className="text-ui-label text-ui-muted">
                        {t("reportProviderStatus")}:{" "}
                        <Ltr>{report.result.report.provider_status}</Ltr>
                      </span>
                    ) : null}
                    {/* The provider returned no amount — said plainly rather than
                        rendered as `0,00 DA`, which is a number someone would put
                        in a report. */}
                    {report.result.report.amount === "" ? (
                      <span className="text-ui-caption text-ui-subtle">
                        {t("reportNoAmount")}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

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
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  loading={verify.isPending && verify.variables === payment.id}
                  disabled={verify.isPending || cannotVerify !== null}
                  title={cannotVerify ?? undefined}
                  onClick={() => verify.mutate(payment.id)}
                >
                  {t("verifyShort")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
