"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
// From the dependency-free module, not the schema: this is a client component,
// and importing these through the Zod schema shipped Zod's runtime to the browser.
import {
  STATUS_TONE,
  candidateMoves,
  orderStatuses,
  type OrderStatus,
} from "@/lib/order-status";
import { Button, IconButton } from "@/components/ui/Button";
import { Menu, type MenuAction } from "@/components/ui/Menu";
import { ConfirmDialog, useConfirm } from "@/components/ui/Confirm";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/primitives/Toast";
import { useOrderScreen } from "./OrderScreen";

/**
 * The header's controls: refresh, and the one primary action.
 *
 * **The primary action lives in `PageHeader`, and this is the rule for every
 * detail screen in the run.** Below `lg` the aside drops beneath a line-item list
 * whose length is the order's, not the layout's — a three-item order and a
 * thirty-item order put the same button at two very different scroll offsets.
 * The panel's most-used control cannot be at the bottom of a page whose height is
 * data-dependent. The aside carries the status *badge* and its dates, which is
 * display; the act is up here.
 *
 * **The transition table is not hard-coded.** The panel offers the moves and
 * renders what the 409 says is legal, because the API is the authority and it
 * tells you. Measured shape:
 *
 *   409 { from: "processing", to: "pending",
 *         allowed: ["on-hold","completed","cancelled","refunded","failed"] }
 *
 * and `allowed: []` on a cancelled or refunded order — a real answer meaning the
 * order is finished, not a missing field.
 *
 * **The write goes through `acWrite`.** It used to be a hand-rolled `fetch` with
 * its own envelope reader, which is exactly the duplication `lib/api/browser.ts`
 * was written to end: that copy read `body.error.message` and dropped
 * `details.params`, so it would have shown the API's generic sentence where the
 * API had sent a specific one. `BrowserApiError` keeps `status` and `details`
 * intact, which is what the 409 branch below needs.
 */
export function OrderActions({
  orderId,
  status,
  canWrite,
}: {
  orderId: number;
  status: OrderStatus;
  canWrite: boolean;
}) {
  const t = useTranslations("orders.changeStatus");
  const tOrders = useTranslations("orders");
  const tStatus = useTranslations("status");
  const router = useRouter();
  const toast = useToast();
  const { refuse, writesBlocked } = useOrderScreen();

  /* A Server Component's data, so the refresh is `router.refresh()` rather than
     a query invalidation — and it goes through a transition so the control can
     hold a spinner for as long as the server actually takes. */
  const [refreshing, startRefresh] = useTransition();

  const confirm = useConfirm<OrderStatus>();

  /**
   * Put the keyboard back on the status button when the confirm closes.
   *
   * `Overlay.tsx`'s `useOpenerFocus` restores focus to whatever had it when the
   * overlay opened — and here that is a **menu item**, which Radix unmounts the
   * moment it is selected. The hook checks `isConnected` and correctly declines
   * to focus a detached node, Radix's own fallback then targets a trigger ref
   * that a controlled dialog never sets, and focus lands on `<body>`. Measured
   * with the keyboard alone: Escape on the cancel confirmation dropped a person
   * to the top of the document, with the whole sidebar to tab through again.
   *
   * `ConfirmDialog` now takes `returnFocusTo` for exactly this — a menu item
   * opening a confirm is the shape every destructive row action in this run
   * takes, so the fix belongs in the primitive. `Overlay.tsx` carries the two
   * things that were tried first and do not work: pre-focusing the trigger
   * (the menu's focus scope is trapped and pulls focus straight back) and
   * focusing from `onOpenChange` (it fires before Radix's own restore, which
   * then wins).
   *
   * An id rather than a ref, because `Button` takes `ButtonHTMLAttributes` and
   * `id` is already one of them — adding `ref` forwarding to a shared primitive
   * to solve one screen's focus problem is the wrong trade.
   */
  const triggerId = useId();

  /**
   * Once the API has told us what is legal from this status, offer only those.
   * Before that, offer everything else and let the API refuse — which is the
   * whole point: the panel does not carry a second copy of the rules.
   *
   * `null` is "the API has not spoken yet" and `[]` is "it said nowhere", which
   * are different answers and are rendered differently. The *sentence* a person
   * reads lives in the shared alert region; this is only what the menu offers
   * next.
   */
  const [allowed, setAllowed] = useState<OrderStatus[] | null>(null);

  const move = useMutation({
    mutationFn: async (next: OrderStatus) => {
      const order = await acWrite<{ status?: OrderStatus }>(
        "PATCH",
        `/orders/${orderId}`,
        { status: next },
      );
      return order?.status ?? next;
    },
    onSuccess: (next) => {
      refuse(null);
      confirm.close();
      toast.show(t("done", { status: tStatus(next) }));
      // The order is rendered on the server, so a refresh is what makes every
      // section agree — including the timeline the transition just wrote to.
      startRefresh(() => router.refresh());
    },
    onError: (error: unknown) => {
      confirm.close();

      if (error instanceof BrowserApiError && error.status === 409) {
        const raw = error.details.allowed;
        const legal = (Array.isArray(raw) ? (raw as string[]) : []).filter(
          (s): s is OrderStatus => (orderStatuses as readonly string[]).includes(s),
        );
        const from = String(error.details.from ?? status);
        const to = String(error.details.to ?? "");

        refuse(
          <>
            <p className="text-ui-subheading">
              {to
                ? t("refusedFromTo", {
                    from: tStatus(from as OrderStatus),
                    to: tStatus(to as OrderStatus),
                  })
                : t("refused")}
            </p>
            {legal.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-ui-label">{t("allowedAre")}</p>
                <div className="flex flex-wrap gap-1">
                  {legal.map((s) => (
                    <Badge key={s} tone={STATUS_TONE[s]}>
                      {tStatus(s)}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-ui-label">{t("allowedNone")}</p>
            )}
          </>,
        );
        setAllowed(legal);
        return;
      }

      refuse(
        <p className="text-ui-subheading">
          {error instanceof Error ? error.message : t("refused")}
        </p>,
      );
    },
  });

  // Before the API has spoken, every other status is a candidate.
  const offered = allowed ?? candidateMoves(status, orderStatuses);
  const terminal = allowed !== null && allowed.length === 0;

  /* Disabled with the reason, never hidden. Three reasons, in the order they
     stop being true: no capability, no connection, nowhere left to go. */
  const blocked = !canWrite
    ? tOrders("readOnly")
    : (writesBlocked ?? (terminal ? t("terminal", { status: tStatus(status) }) : null));

  const actions: MenuAction[] = offered.map((next) => ({
    key: next,
    label: t("moveTo", { status: tStatus(next) }),
    /* `cancelled` and `refunded` are terminal, so moving into one is the
       destructive choice: the Menu separates and colours it, and it goes through
       a ConfirmDialog whose button names the act. */
    destructive: isTerminalMove(next),
    onSelect: () => {
      if (isTerminalMove(next)) confirm.ask(next);
      else move.mutate(next);
    },
  }));

  return (
    <>
      <IconButton
        label={tOrders("refresh")}
        icon="refresh"
        variant="secondary"
        loading={refreshing}
        onClick={() => startRefresh(() => router.refresh())}
      />

      <Menu
        label={t("title")}
        align="end"
        actions={actions}
        trigger={
          <Button
            id={triggerId}
            variant="primary"
            iconEnd="chevron"
            disabled={blocked !== null}
            title={blocked ?? undefined}
            loading={move.isPending}
          >
            {t("action")}
          </Button>
        }
      />

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.onOpenChange}
        title={t("confirmTitle", {
          status: confirm.target ? tStatus(confirm.target) : "",
        })}
        body={t("confirmBody", {
          status: confirm.target ? tStatus(confirm.target) : "",
        })}
        confirmLabel={
          confirm.target === "refunded" ? t("confirmRefund") : t("confirmCancel")
        }
        loading={move.isPending}
        /* This menu item is gone by the time the dialog closes, so the dialog
           is told where to put the keyboard back. */
        returnFocusTo={triggerId}
        onConfirm={() => {
          if (confirm.target) move.mutate(confirm.target);
        }}
      />
    </>
  );
}

/**
 * The two statuses a move *into* is destructive.
 *
 * This is not the transition table — it says nothing about what is legal, only
 * about what is irreversible enough to be worth a confirm. The API remains the
 * authority on whether the move is permitted at all, and answers `allowed: []`
 * from either of these.
 */
function isTerminalMove(status: OrderStatus): boolean {
  return status === "cancelled" || status === "refunded";
}
