"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
// From the dependency-free module, not the schema: this is a client component,
// and importing these through the Zod schema shipped Zod's runtime to the browser.
import {
  STATUS_TONE,
  candidateMoves,
  orderStatuses,
  type OrderStatus,
} from "@/lib/order-status";
import { ActionSheet, type SheetAction } from "@/components/primitives/ActionSheet";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { useToast } from "@/components/primitives/Toast";

/**
 * Changing an order's status — the one write in this step, and the reason the
 * error mapping exists.
 *
 * **The transition table is not hard-coded here.** The panel offers the moves and
 * renders what the 409 says is legal, because the API is the authority and it
 * tells you. Measured shape:
 *
 *   409 { from: "processing", to: "pending",
 *         allowed: ["on-hold","completed","cancelled","refunded","failed"] }
 *
 * and `allowed: []` on a cancelled or refunded order — a real answer meaning the
 * order is finished, not a missing field.
 */

type ConflictState = { from: string; to: string; allowed: OrderStatus[] } | null;

export function StatusAction({
  orderId,
  status,
  locale,
  canWrite,
}: {
  orderId: number;
  status: OrderStatus;
  locale: string;
  canWrite: boolean;
}) {
  const t = useTranslations("orders.changeStatus");
  const tStatus = useTranslations("status");
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [conflict, setConflict] = useState<ConflictState>(null);
  /**
   * Once the API has told us what is legal from this status, offer only those.
   * Before that, offer everything else and let the API refuse — which is the
   * whole point: the panel does not carry a second copy of the rules.
   */
  const [allowed, setAllowed] = useState<OrderStatus[] | null>(null);

  const mutation = useMutation({
    mutationFn: async (next: OrderStatus) => {
      const response = await fetch(`/api/ac/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const body = (await response.json()) as {
        success?: boolean;
        data?: { status?: OrderStatus };
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      };
      if (!response.ok || body.success === false) {
        throw Object.assign(new Error(body.error?.message ?? "failed"), {
          status: response.status,
          details: body.error?.details ?? {},
        });
      }
      return body.data?.status ?? next;
    },
    onSuccess: (next) => {
      setConflict(null);
      setAllowed(null);
      toast.show(t("done", { status: tStatus(next) }));
      // The order object is rendered on the server, so a refresh is what makes
      // every section agree — including the timeline the transition just wrote to.
      router.refresh();
    },
    onError: (error: Error & { status?: number; details?: Record<string, unknown> }) => {
      if (error.status === 409) {
        const details = error.details ?? {};
        const list = Array.isArray(details.allowed) ? (details.allowed as string[]) : [];
        const valid = list.filter((s): s is OrderStatus =>
          (orderStatuses as readonly string[]).includes(s),
        );
        setConflict({
          from: String(details.from ?? status),
          to: String(details.to ?? ""),
          allowed: valid,
        });
        setAllowed(valid);
        return;
      }
      toast.show(t("refused"), "danger");
    },
  });

  // Before the API has spoken, every other status is a candidate.
  const offered = allowed ?? candidateMoves(status, orderStatuses);
  const terminal = allowed !== null && allowed.length === 0;

  const actions: SheetAction[] = offered.map((next) => ({
    label: t("moveTo", { status: tStatus(next) }),
    // `cancelled` and `refunded` are terminal, so moving into one is the
    // destructive choice and is styled and separated as such.
    tone: next === "cancelled" || next === "refunded" ? "destructive" : "default",
    onSelect: () => mutation.mutate(next),
  }));

  return (
    <>
      {/*
        The refusal renders on the screen and stays there — a 409 is not a toast.
        The allowed moves come from the response body and are rendered through the
        panel's own status labels, because the list is data and the labels are ours.
      */}
      {conflict ? (
        <ListGroup>
          <ListRow className="tone-warning">
            <span className="flex min-w-0 flex-col gap-2">
              <span className="flex items-start gap-2">
                <Icon name="alert" className="tonal-fg mt-0.5 size-4 shrink-0" />
                <span className="text-subhead text-label">
                  {conflict.to
                    ? t("refusedFromTo", {
                        from: tStatus(conflict.from as OrderStatus),
                        to: tStatus(conflict.to as OrderStatus),
                      })
                    : t("refused")}
                </span>
              </span>
              {conflict.allowed.length > 0 ? (
                <span className="flex flex-col gap-1">
                  <span className="text-caption text-label-secondary">
                    {t("allowedAre")}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {conflict.allowed.map((s) => (
                      <StatusBadge key={s} tone={STATUS_TONE[s]}>
                        {tStatus(s)}
                      </StatusBadge>
                    ))}
                  </span>
                </span>
              ) : (
                <span className="text-caption text-label-secondary">
                  {t("allowedNone")}
                </span>
              )}
            </span>
          </ListRow>
        </ListGroup>
      ) : null}

      <ListGroup
        footnote={
          terminal ? t("terminal", { status: tStatus(status) }) : undefined
        }
      >
        <ListRow>
          <span className="text-body text-label-secondary">
            {t("current", { status: tStatus(status) })}
          </span>
        </ListRow>
        <ListRow>
          <Button
            variant="tinted"
            fullWidth
            disabled={!canWrite || terminal}
            loading={mutation.isPending}
            onClick={() => setOpen(true)}
          >
            {mutation.isPending ? t("saving") : t("action")}
          </Button>
        </ListRow>
      </ListGroup>

      <ActionSheet
        open={open}
        onOpenChange={setOpen}
        title={t("title")}
        description={t("current", { status: tStatus(status) })}
        actions={actions}
      />
    </>
  );
}
