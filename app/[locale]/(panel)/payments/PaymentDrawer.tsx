"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import type { Payment, VerifyResult } from "@/lib/api/schemas/payment";
import { formatMoney } from "@/lib/format/money";
import { formatWhen } from "@/lib/format/date";
import { Drawer, useLatchedOpener } from "@/components/ui/Overlay";
import { DataList, DataRow } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/States";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { PaymentStatusBadge, paymentOpenerId } from "./columns";

/**
 * One transaction, and the one thing that can be done to it.
 *
 * ## A `Drawer`, and it costs no request
 *
 * **A payment has no detail route**, and `GET /payments/{id}` is *value*-identical
 * to the list row — measured 2026-08-26, all eleven keys, not merely the same
 * shape. So this is not a peek that previews a page somewhere else: there is no
 * page, and it renders from the row already in memory the way `ParcelDrawer`
 * does.
 *
 * It earns its place on `metadata`. That field is a free record in the schema,
 * it is the only surface the transaction has that the table cannot show, and it
 * arrives in **three measured shapes** —
 *
 *   cod                `{amount, collect_on_delivery, currency}`
 *   chargily pending   `{provider_status, livemode, fees, fees_on_merchant, …}`
 *   failed             `{error: "conflict"}`
 *
 * — of which the third is the only place a failed payment says *why*. A ledger
 * that could not open a row would show a red badge and no reason for it.
 *
 * **The keys are printed as the provider spells them.** Nothing here indexes into
 * `metadata` by name: only the key sets are measured and the values are a
 * provider's own vocabulary, so a screen that formatted `fees` as money would be
 * guessing whether it is a decimal string. Printed raw, the way the parcel drawer
 * prints `provider_status` raw, because a mis-mapping is invisible without it.
 *
 * ## Verify is the only write, and it is not behind a `ConfirmDialog`
 *
 * `POST /payments/{id}/verify` asks the provider a question over the network and
 * records the truthful answer. It cannot make something false true: the API's own
 * transition rule lives inside verification, so a replayed webhook cannot walk a
 * settled order back. There is nothing to warn about and nothing to undo, and
 * `orders/[id]/PaymentsSection.tsx` already offers it bare — two surfaces
 * offering one action must behave the same way.
 *
 * **Its answer is not a payment.** Measured: `{report, transaction}`, and
 * **`report.amount` and `report.currency` come back as empty strings** on a `cod`
 * transaction — so the report is never formatted as money. `transaction` is the
 * authority for every figure on screen; `report.provider_status` is the useful
 * part, because a mis-mapped adapter shows up there and nowhere else.
 *
 * A verification may settle an order and reduce stock, so it ends in a
 * `router.refresh()` and an invalidation of the ledger's own cache — every
 * section of every screen behind this drawer can have moved underneath it.
 */
export function PaymentDrawer({
  payment,
  providerName,
  locale,
  online,
  onOpenChange,
}: {
  payment: Payment | null;
  /** Message key → API `label` → raw name, built once by the screen. */
  providerName: (name: string) => string;
  locale: string;
  /** False only when the browser is certain — see `useOnline`. */
  online: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("payments");
  const tStates = useTranslations("states");
  const tStatus = useTranslations("paymentStatus");
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [report, setReport] = useState<{ id: number; result: VerifyResult } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  /* Which row focus goes back to. Latched, because Radix fires
     `onCloseAutoFocus` after `onOpenChange` — see `useLatchedOpener`. */
  const returnFocusTo = useLatchedOpener(payment && paymentOpenerId(payment.id));

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
      /* The ledger's own rows and every screen behind the drawer: a verification
         may settle an order and reduce stock. */
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
      router.refresh();
    },
    onError: (error: unknown) => setRefusal(messageOf(error)),
  });

  /* The fifth state's second half: when the browser is certain it is offline the
     row on screen is as old as the last fetch, and the write control says so
     rather than failing on click. */
  const blocked = online ? null : tStates("offlineWrites");

  /* `metadata` is a free record and its keys are the provider's. Sorted so two
     rows of the same shape read in the same order rather than in whatever order
     the JSON happened to arrive in. */
  const metadata =
    payment === null ? [] : Object.entries(payment.metadata).sort(([a], [b]) => a.localeCompare(b));

  const shown = payment !== null && report?.id === payment.id ? report.result.report : null;

  return (
    <Drawer
      open={payment !== null}
      onOpenChange={(next) => {
        if (!next) {
          setRefusal(null);
          setReport(null);
        }
        onOpenChange(next);
      }}
      title={payment === null ? "" : t("transactionNumber", { number: payment.id })}
      size="md"
      /* Below `md` this button is `display: none` — both presentations are always
         in the DOM — and `useOpenerFocus` skips a named target that is not
         rendered, falling back to `RecordList`'s own overlay button. The guard is
         in the primitive rather than a width check here, because reading the
         viewport during render is a hydration mismatch. */
      returnFocusTo={returnFocusTo}
      footer={
        payment === null ? null : (
          <Button
            variant="secondary"
            loading={verify.isPending}
            disabled={blocked !== null}
            title={blocked ?? undefined}
            onClick={() => verify.mutate(payment.id)}
          >
            {t("verify")}
          </Button>
        )
      }
    >
      {payment === null ? null : (
        <div className="flex flex-col gap-4">
          {/*
            A refusal stays on screen rather than in a toast: §3.1 — an error a
            person must act on is not a toast. The API's own words, because a 409
            here names the state precisely and a translated generic throws the
            actionable half away.
          */}
          {refusal ? (
            <Notice tone="warning" role="alert" title={tStates("errorTitle")}>
              <p className="text-ui-label">{refusal}</p>
            </Notice>
          ) : null}

          <DataList>
            <DataRow label={t("statusLabel")}>
              <PaymentStatusBadge
                status={payment.status}
                tStatus={(status) =>
                  tStatus.has(status as "pending") ? tStatus(status as "pending") : status
                }
              />
            </DataRow>
            <DataRow label={t("amount")}>
              {/* The payment's own currency, never `SHOP_CURRENCY`. */}
              <Ltr>{formatMoney(payment.amount, payment.currency, locale)}</Ltr>
            </DataRow>
            <DataRow label={t("order")}>
              <Link
                href={`/${locale}/orders/${payment.order_id}`}
                className="ui-ring rounded-ui-md text-ui-accent hover:underline"
              >
                <Isolate>{t("orderLink", { number: payment.order_id })}</Isolate>
              </Link>
            </DataRow>
            <DataRow label={t("provider")}>
              <span dir="auto">{providerName(payment.provider)}</span>
            </DataRow>
            {/*
              Two opaque strings the shop and the gateway assigned, shown because
              this is the only place they can be read and they are what somebody
              quotes when they call the provider. Absent rather than blank when
              the provider has not issued one — a `cod` transaction carries no
              gateway id until a courier collects, which is a real absence.
              `break-all` rather than truncate: the point of opening this is to
              read the value the table had no room for.
            */}
            {payment.reference !== "" ? (
              <DataRow label={t("reference")}>
                <Ltr numeric={false} className="block break-all">
                  {payment.reference}
                </Ltr>
              </DataRow>
            ) : null}
            {payment.provider_transaction_id !== "" ? (
              <DataRow label={t("transactionId")}>
                <Ltr numeric={false} className="block break-all">
                  {payment.provider_transaction_id}
                </Ltr>
              </DataRow>
            ) : null}
            <DataRow label={t("createdAt")}>
              <Isolate>{formatWhen(payment.created_at, locale)}</Isolate>
            </DataRow>
            <DataRow label={t("updatedAt")}>
              <Isolate>{formatWhen(payment.updated_at, locale)}</Isolate>
            </DataRow>
          </DataList>

          {/*
            The provider's answer, from the last verification in this session.
            Never formatted as money: `report.amount` and `report.currency` came
            back as empty strings on a `cod` transaction, so the figures stay with
            `transaction` and this block carries the words.
          */}
          {shown ? (
            <div className="flex flex-col gap-0.5 rounded-ui-md bg-ui-surface-2 px-3 py-2">
              <span className="text-ui-caption text-ui-muted">{t("report")}</span>
              <span className="text-ui-label text-ui-fg">
                {t("reportStatus")}
                <span aria-hidden="true">: </span>
                {tStatus.has(shown.status as "pending")
                  ? tStatus(shown.status as "pending")
                  : shown.status}
              </span>
              {shown.provider_status !== "" ? (
                <span className="text-ui-label text-ui-muted">
                  {t("reportProviderStatus")}
                  <span aria-hidden="true">: </span>
                  <Ltr numeric={false}>{shown.provider_status}</Ltr>
                </span>
              ) : null}
              {/* Said plainly rather than rendered as `0,00 DA`, which is a
                  number somebody would put in a report. */}
              {shown.amount === "" ? (
                <span className="text-ui-caption text-ui-subtle">{t("reportNoAmount")}</span>
              ) : null}
            </div>
          ) : null}

          {/*
            `metadata`, and the reason this drawer exists. Three measured shapes,
            no key indexed by name — see the docblock.
          */}
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="text-ui-subheading text-ui-fg">{t("metadata")}</h3>
            {metadata.length === 0 ? (
              <p className="text-ui-label text-ui-subtle">{t("noMetadata")}</p>
            ) : (
              <DataList>
                {metadata.map(([key, value]) => (
                  /* The key as the provider spells it — an English snake_case
                     word, which is why it is `Ltr`-safe as a label only because
                     `DataRow` lays it out with `dir` inherited; it is the
                     provider's vocabulary and translating it would be inventing
                     one. */
                  <DataRow key={key} label={key}>
                    <Ltr numeric={false} className="block break-all">
                      {display(value)}
                    </Ltr>
                  </DataRow>
                ))}
              </DataList>
            )}
            <p className="text-ui-label text-ui-subtle">{t("metadataNote")}</p>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/**
 * A metadata value as text.
 *
 * A string stays itself — quoting it would put quotation marks around a reference
 * somebody is about to read out — and everything else is serialised, because the
 * three measured shapes carry booleans and the schema permits anything.
 */
function display(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** The API's own sentence where it has one, which for this route it does. */
function messageOf(error: unknown): string {
  return error instanceof BrowserApiError || error instanceof Error
    ? error.message
    : String(error);
}
