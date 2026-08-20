"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { COD_STATUS_TONE, codAttemptGate, type CodStatus } from "@/lib/cod-status";
import type { CodRecord } from "@/lib/api/schemas/order";
import { formatWhen } from "@/lib/format/date";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Sheet } from "@/components/primitives/Sheet";
import { SwitchField, TextAreaField } from "@/components/primitives/Field";
import { Isolate } from "@/components/primitives/Ltr";
import { SectionError } from "@/components/patterns/States";
import { useToast } from "@/components/primitives/Toast";

/**
 * Cash on delivery, inside the order it belongs to.
 *
 * **COD is order metadata and audit events, never a status.** A COD outcome does
 * not move the order — verified: recording `confirmed` on order 3876 left it at
 * `processing` with `date_modified` untouched — so nothing here may look like a
 * status transition. That is why the outcomes live behind "record a call" rather
 * than beside the order's own status control, and why the footnote says it in
 * words.
 *
 * **`allowed_outcomes` is server-supplied and is what the buttons come from**,
 * exactly as the 409's `allowed` list drives an order transition. The panel
 * carries no outcome table. What it does carry is the *second* gate, because the
 * record cannot express it: the order's own status refuses an attempt before
 * `allowed_outcomes` is even consulted — measured, order 3879 reports `[]` and a
 * cancelled order, and the 409 blamed the order. `codAttemptGate()` runs the
 * three checks in the server's order so the reason on screen is the reason the
 * server would have given.
 *
 * **The PATCH is not partial and does not need to be.** Every field but `enabled`
 * is read-only and dropped *silently*, so the whole GET object PATCHes back — the
 * contract `OrderInput` offers, and the opposite of a coupon's `{}` no-op and of
 * a customer's merging address. Sending `{"enabled": …}` alone is what this does,
 * because a named subset is the rule this panel already follows.
 */
export function CodSection({
  orderId,
  orderStatus,
  record,
  canWrite,
  locale,
}: {
  orderId: number;
  orderStatus: string;
  record: CodRecord | null;
  canWrite: boolean;
  locale: string;
}) {
  const t = useTranslations("cod");
  const tStatus = useTranslations("codStatus");
  const tOrderStatus = useTranslations("status");
  const router = useRouter();
  const toast = useToast();

  const [recording, setRecording] = useState(false);
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) =>
      acWrite("PATCH", `/orders/${orderId}/cod`, { enabled }),
    onSuccess: (_data, enabled) => {
      toast.show(t("toggled", { state: enabled ? t("stateOn") : t("stateOff") }));
      router.refresh();
    },
    onError: (error: unknown) => setRefusal(messageOf(error, t("refused"))),
  });

  const attempt = useMutation({
    mutationFn: async (outcome: string) =>
      acWrite(
        "POST",
        `/orders/${orderId}/cod/attempts`,
        // `reason` is optional, ≤500 characters, and trimmed server-side. Omitted
        // rather than sent empty, so a blank field does not overwrite the reason
        // recorded with a previous call.
        reason.trim() === "" ? { outcome } : { outcome, reason: reason.trim() },
      ),
    onSuccess: (_data, outcome) => {
      setRecording(false);
      setReason("");
      setRefusal(null);
      toast.show(
        t("recorded", {
          status: tStatus.has(outcome as "confirmed") ? tStatus(outcome as "confirmed") : outcome,
        }),
      );
      /*
       * A refresh rather than a local patch, and this is the coupling worth
       * knowing about: recording an attempt writes an audit row that the order's
       * **timeline** section renders — measured, "COD confirmation attempt 5 —
       * confirmed — …" appears there with the staff login as its actor. Two
       * sections on one screen move on one write, and only a server refresh makes
       * them agree.
       */
      router.refresh();
    },
    onError: (error: unknown) => setRefusal(messageOf(error, t("refused"))),
  });

  if (record === null) {
    return (
      <ListGroup title={t("title")}>
        <ListRow>
          <SectionError>{t("refused")}</SectionError>
        </ListRow>
      </ListGroup>
    );
  }

  const gate = codAttemptGate(record, orderStatus);
  const tone = COD_STATUS_TONE[record.status as CodStatus] ?? "neutral";
  const statusLabel = tStatus.has(record.status as "pending")
    ? tStatus(record.status as "pending")
    : record.status;

  const cannotReason = gate.allowed
    ? null
    : gate.reason === "disabled"
      ? t("cannotDisabled")
      : gate.reason === "order_closed"
        ? t("cannotOrderClosed", {
            status: tOrderStatus.has(orderStatus as "cancelled")
              ? tOrderStatus(orderStatus as "cancelled")
              : orderStatus,
          })
        : t("cannotFinished");

  return (
    <>
      <ListGroup title={t("title")} footnote={record.enabled ? t("notAStatus") : undefined}>
        {!record.enabled ? (
          <ListRow>
            <span className="text-body text-label-secondary">{t("disabled")}</span>
          </ListRow>
        ) : (
          <>
            <ListRow>
              <span className="text-body text-label-secondary">{t("status")}</span>
              <span className="ms-auto">
                <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
              </span>
            </ListRow>
            <ListValueRow
              label={t("attempts")}
              value={<Isolate>{t("attemptsValue", { count: record.attempts })}</Isolate>}
            />
            {record.last_attempt_at ? (
              <ListValueRow
                label={t("lastAttempt")}
                value={<Isolate>{formatWhen(record.last_attempt_at, locale)}</Isolate>}
              />
            ) : null}
            {/*
              `confirmed_at` and `last_attempt_at` answer different questions and
              both are shown when they differ. Measured: re-confirming order 3876
              moved `last_attempt_at` and left `confirmed_at` where it was — the
              first confirmation is when the customer said yes, and every call
              after it is just another call.
            */}
            {record.confirmed_at ? (
              <ListValueRow
                label={t("confirmedAt")}
                value={<Isolate>{formatWhen(record.confirmed_at, locale)}</Isolate>}
              />
            ) : null}
            {record.cancelled_at ? (
              <ListValueRow
                label={t("cancelledAt")}
                value={<Isolate>{formatWhen(record.cancelled_at, locale)}</Isolate>}
              />
            ) : null}
            {record.reason !== "" ? (
              <ListRow>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-footnote text-label-secondary">{t("reason")}</span>
                  <span className="text-body text-label" dir="auto">
                    {record.reason}
                  </span>
                </span>
              </ListRow>
            ) : null}
          </>
        )}

        {refusal ? (
          <ListRow className="tone-warning">
            <span className="flex items-start gap-2">
              <Icon name="alert" className="tonal-fg mt-0.5 size-4 shrink-0" />
              <span className="text-subhead text-label">{refusal}</span>
            </span>
          </ListRow>
        ) : null}

        {canWrite ? (
          <>
            <SwitchField
              label={t("enabled")}
              checked={record.enabled}
              onChange={(next) => toggle.mutate(next)}
              disabled={toggle.isPending}
            />
            <ListRow>
              <span className="flex w-full flex-col gap-2">
                <Button
                  variant="tinted"
                  fullWidth
                  disabled={!gate.allowed || attempt.isPending}
                  onClick={() => setRecording(true)}
                >
                  {t("record")}
                </Button>
                {/* Disabled with the reason, never hidden — a control that
                    vanishes reads as a feature that is broken. */}
                {cannotReason ? (
                  <span className="text-footnote text-label-secondary">{cannotReason}</span>
                ) : null}
              </span>
            </ListRow>
          </>
        ) : null}
      </ListGroup>

      <Sheet
        open={recording}
        onOpenChange={(next) => {
          setRecording(next);
          if (!next) setReason("");
        }}
        title={t("recordTitle")}
      >
        <div className="flex flex-col gap-6 pb-4">
          <div className="overflow-hidden rounded-lg bg-surface">
            <TextAreaField
              label={t("reasonLabel")}
              value={reason}
              onChange={setReason}
              hint={t("reasonPlaceholder")}
              error={reason.trim().length > 500 ? t("reasonTooLong") : undefined}
            />
          </div>

          {/*
            One button per outcome the server says is legal, and nothing else.
            A `confirmed` order offers only `confirmed` — measured, its
            `allowed_outcomes` is `["confirmed"]` — because re-confirming is
            allowed and changes nothing but the attempt count, while
            `confirmed → rejected` is refused: a customer who said yes and later
            changed their mind has cancelled, and folding the two together would
            make the confirmation rate count one event two ways.
          */}
          <div className="flex flex-col gap-3">
            {gate.allowed
              ? gate.outcomes.map((outcome) => (
                  <Button
                    key={outcome}
                    variant={outcome === "rejected" ? "destructive" : "tinted"}
                    fullWidth
                    loading={attempt.isPending && attempt.variables === outcome}
                    disabled={attempt.isPending || reason.trim().length > 500}
                    onClick={() => attempt.mutate(outcome)}
                  >
                    {outcome === "confirmed"
                      ? t("outcomeConfirmed")
                      : outcome === "rejected"
                        ? t("outcomeRejected")
                        : t("outcomeUnreachable")}
                  </Button>
                ))
              : null}
          </div>
        </div>
      </Sheet>
    </>
  );
}

/** The API's own sentence where it has one; these routes all carry one. */
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof BrowserApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}
