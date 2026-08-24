"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { COD_STATUS_TONE, codAttemptGate, type CodStatus } from "@/lib/cod-status";
import type { CodRecord } from "@/lib/api/schemas/order";
import { formatWhen } from "@/lib/format/date";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Overlay";
import { ChoiceGroup, Switch, TextArea } from "@/components/ui/Form";
import { Isolate } from "@/components/primitives/Ltr";
import { SectionError } from "@/components/ui/States";
import { useToast } from "@/components/primitives/Toast";
import { useOrderScreen } from "./OrderScreen";

/** The API's cap, and the reason the field carries a counter. */
const REASON_LIMIT = 500;

/**
 * Cash on delivery, inside the order it belongs to.
 *
 * **COD is order metadata and audit events, never a status.** A COD outcome does
 * not move the order — verified: recording `confirmed` on order 3876 left it at
 * `processing` with `date_modified` untouched — so nothing here may look like a
 * status transition. That is why the outcomes live behind "record a call" rather
 * than beside the order's own status control, and why the footnote says it in
 * words. It is also why this card is in the **aside**: it is reference material a
 * person glances at, not an act on the order.
 *
 * **`allowed_outcomes` is server-supplied and is what the form offers**, exactly
 * as the 409's `allowed` list drives an order transition. The panel carries no
 * outcome table. What it does carry is the *second* gate, because the record
 * cannot express it: the order's own status refuses an attempt before
 * `allowed_outcomes` is even consulted — measured, order 3879 reports `[]` and a
 * cancelled order, and the 409 blamed the order. `codAttemptGate()` runs the
 * three checks in the server's order so the reason on screen is the reason the
 * server would have given.
 *
 * **The attempt form is a `Modal`, not a `Popover`.** §3.1 forbids a Popover
 * holding a form that can fail validation, and this one can twice over: the
 * reason is capped at 500 characters and refused with a 400 above it, and the
 * whole attempt can come back a 409. A validation error inside something that
 * closes when you look away is an error nobody reads.
 *
 * **The PATCH is not partial and does not need to be.** Every field but `enabled`
 * is read-only and dropped *silently*, so the whole GET object PATCHes back — the
 * contract `OrderInput` offers. Sending `{"enabled": …}` alone is what this does,
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
  const tOrders = useTranslations("orders");
  const tUi = useTranslations("ui");
  const router = useRouter();
  const toast = useToast();
  const { refuse, writesBlocked } = useOrderScreen();

  const [recording, setRecording] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [reason, setReason] = useState("");

  const refuseWith = (error: unknown) =>
    refuse(
      <p className="text-ui-subheading">
        {error instanceof BrowserApiError || error instanceof Error
          ? error.message
          : t("refused")}
      </p>,
    );

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) =>
      acWrite("PATCH", `/orders/${orderId}/cod`, { enabled }),
    onSuccess: (_data, enabled) => {
      refuse(null);
      toast.show(t("toggled", { state: enabled ? t("stateOn") : t("stateOff") }));
      router.refresh();
    },
    onError: refuseWith,
  });

  const attempt = useMutation({
    mutationFn: async (chosen: string) =>
      acWrite(
        "POST",
        `/orders/${orderId}/cod/attempts`,
        // `reason` is optional, ≤500 characters, and trimmed server-side. Omitted
        // rather than sent empty, so a blank field does not overwrite the reason
        // recorded with a previous call.
        reason.trim() === "" ? { outcome: chosen } : { outcome: chosen, reason: reason.trim() },
      ),
    onSuccess: (_data, chosen) => {
      closeForm();
      refuse(null);
      toast.show(
        t("recorded", {
          status: tStatus.has(chosen as "confirmed") ? tStatus(chosen as "confirmed") : chosen,
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
    onError: refuseWith,
  });

  function closeForm() {
    setRecording(false);
    setOutcome("");
    setReason("");
  }

  if (record === null) {
    return (
      <Card title={t("title")}>
        <SectionError>{t("refused")}</SectionError>
      </Card>
    );
  }

  const gate = codAttemptGate(record, orderStatus);
  const tone = COD_STATUS_TONE[record.status as CodStatus] ?? "neutral";
  const statusLabel = tStatus.has(record.status as "pending")
    ? tStatus(record.status as "pending")
    : record.status;

  /* Disabled with the reason, never hidden — a control that vanishes reads as a
     feature that is broken. Four reasons, and the API's own three are checked in
     its own order so the sentence matches the 409 it is standing in for. */
  const cannotRecord = !canWrite
    ? tOrders("readOnly")
    : (writesBlocked ??
      (gate.allowed
        ? null
        : gate.reason === "disabled"
          ? t("cannotDisabled")
          : gate.reason === "order_closed"
            ? t("cannotOrderClosed", {
                status: tOrderStatus.has(orderStatus as "cancelled")
                  ? tOrderStatus(orderStatus as "cancelled")
                  : orderStatus,
              })
            : t("cannotFinished")));

  const tooLong = reason.trim().length > REASON_LIMIT;

  return (
    <>
      <Card
        title={t("title")}
        footnote={record.enabled ? t("notAStatus") : undefined}
        actions={
          canWrite ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRecording(true)}
              disabled={cannotRecord !== null}
              title={cannotRecord ?? undefined}
            >
              {t("record")}
            </Button>
          ) : null
        }
      >
        {record.enabled ? (
          <DataList>
            <DataRow label={t("status")}>
              <Badge tone={tone}>{statusLabel}</Badge>
            </DataRow>
            <DataRow label={t("attempts")}>
              <Isolate>{t("attemptsValue", { count: record.attempts })}</Isolate>
            </DataRow>
            {record.last_attempt_at ? (
              <DataRow label={t("lastAttempt")}>
                <Isolate>{formatWhen(record.last_attempt_at, locale)}</Isolate>
              </DataRow>
            ) : null}
            {/*
              `confirmed_at` and `last_attempt_at` answer different questions and
              both are shown when they differ. Measured: re-confirming order 3876
              moved `last_attempt_at` and left `confirmed_at` where it was — the
              first confirmation is when the customer said yes, and every call
              after it is just another call.
            */}
            {record.confirmed_at ? (
              <DataRow label={t("confirmedAt")}>
                <Isolate>{formatWhen(record.confirmed_at, locale)}</Isolate>
              </DataRow>
            ) : null}
            {record.cancelled_at ? (
              <DataRow label={t("cancelledAt")}>
                <Isolate>{formatWhen(record.cancelled_at, locale)}</Isolate>
              </DataRow>
            ) : null}
            {record.reason !== "" ? (
              <DataRow label={t("reason")} stacked>
                <span dir="auto">{record.reason}</span>
              </DataRow>
            ) : null}
          </DataList>
        ) : (
          <p className="text-ui-body text-ui-muted">{t("disabled")}</p>
        )}

        {canWrite ? (
          <div className="mt-2 flex flex-col gap-1.5 border-t border-ui-line pt-2">
            {/*
              **Not disabled while its own write is in flight**, and that is a
              keyboard fix rather than a preference.

              Measured with the keyboard alone: an element that becomes
              `disabled` while it has focus drops that focus to `<body>`, and
              nothing puts it back — so toggling this with the space bar left a
              person at the top of the document with the sidebar to tab through
              again. `toggle.isPending` in the `disabled` expression was doing
              exactly that.

              Leaving it enabled is also the honest behaviour for a switch: two
              quick presses are two PATCHes, the last one wins, and the
              `router.refresh()` that follows re-reads whichever value the server
              actually holds. `writesBlocked` stays, because that one is the
              connection changing rather than the person's own press.
            */}
            <Switch
              label={t("enabled")}
              checked={record.enabled}
              onChange={(next) => toggle.mutate(next)}
              disabled={writesBlocked !== null}
              hint={writesBlocked ?? undefined}
            />
            {cannotRecord ? (
              <p className="text-ui-label text-ui-subtle">{cannotRecord}</p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Modal
        open={recording}
        onOpenChange={(next) => {
          if (!next) closeForm();
        }}
        title={t("recordTitle")}
        description={t("notAStatus")}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={closeForm} disabled={attempt.isPending}>
              {tUi("cancel")}
            </Button>
            <Button
              onClick={() => attempt.mutate(outcome)}
              loading={attempt.isPending}
              disabled={outcome === "" || tooLong}
            >
              {t("record")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {/*
            One option per outcome the server says is legal, and nothing else.
            A `confirmed` record offers only `confirmed` — measured, its
            `allowed_outcomes` is `["confirmed"]` — because re-confirming is
            allowed and changes nothing but the attempt count, while
            `confirmed → rejected` is refused: a customer who said yes and later
            changed their mind has cancelled, and folding the two together would
            make the confirmation rate count one event two ways.

            Nothing is preselected. A radio group that opens with an answer
            already in it is a form that records whatever was on top when someone
            hit Enter.
          */}
          <ChoiceGroup
            label={t("recordTitle")}
            value={outcome}
            onChange={setOutcome}
            options={(gate.allowed ? gate.outcomes : []).map((value) => ({
              value,
              label:
                value === "confirmed"
                  ? t("outcomeConfirmed")
                  : value === "rejected"
                    ? t("outcomeRejected")
                    : t("outcomeUnreachable"),
            }))}
          />

          <TextArea
            label={t("reasonLabel")}
            value={reason}
            onChange={setReason}
            rows={4}
            hint={t("reasonHint", { limit: REASON_LIMIT })}
            error={tooLong ? t("reasonTooLong") : undefined}
            counter={{
              length: reason.trim().length,
              limit: REASON_LIMIT,
              label: t("reasonCount", {
                count: reason.trim().length,
                limit: REASON_LIMIT,
              }),
            }}
          />
        </div>
      </Modal>
    </>
  );
}
