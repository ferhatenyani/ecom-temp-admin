"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Movement } from "@/lib/api/schemas/inventory";
import { movementActor } from "@/lib/inventory";
import { REASON_TONE } from "@/lib/movement-reason";
import { formatWhen } from "@/lib/format/date";
import { Badge } from "@/components/ui/Badge";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import type { Column } from "@/components/ui/DataTable";

/**
 * The ledger's column definition — one source, two presentations.
 *
 * **This row is almost entirely numbers inside prose**, in a panel whose second
 * locale is Arabic: a product id, a signed delta, two quantities either side of
 * an arrow, an order number and a timestamp. Every one of them is wrapped, and
 * the rule is `components/primitives/Ltr.tsx`'s: **`Ltr` for something the shop
 * assigned, `Isolate` for something `Intl` formatted.** The bidi algorithm
 * reorders a run of digits next to RTL text and nothing errors when it does — the
 * number is simply wrong on screen, and this is the densest place in the panel
 * for that.
 *
 * ## Four things this file refuses to invent
 *
 * **The actor is never an integer.** `GET /users/{id}` resolves `actor_id` to a
 * name for a Super Admin and answers 403 to an Admin, a Manager and a Product
 * Manager — three of the four roles holding `ac_manage_inventory`, measured. So
 * the row renders what it can prove: *an order · you · a colleague · unknown*,
 * from `movementActor()`. A ledger that read differently depending on who opened
 * it would be worse than one that reads the same for everyone. Identity survives
 * as a **filter** — `?actor_id=` genuinely narrows, 1154 → 16 — which is why it
 * is a pivot in the drawer and not a column here.
 *
 * **The product is an id, never a name.** The ledger names 155 distinct product
 * ids and only 23 of them are in `/inventory` at all; the rest were created and
 * deleted by the backend's own fixture suites, and the rows they moved stayed,
 * because a ledger that forgot a movement when its product was deleted would no
 * longer be a ledger. Resolving 20 ids a page would be 20 requests to produce a
 * label missing six times out of seven. The id is still a **link**, because
 * tapping through is the reason it is there — and it is a real path to a 404,
 * which is why `inventory/[id]/not-found.tsx` is a built screen.
 *
 * **The order is not a link**, unlike the product. `/orders/{id}` is gated on
 * `ac_manage_orders`, which a Product Manager holding `ac_manage_inventory` does
 * not have — the two capabilities are independent — so the link would be a dead
 * end for a role that can read this screen. The number is the referent; the row
 * states it and stops.
 *
 * **The arrow does not flip in RTL.** It points from an earlier value to a later
 * one, which is a fact about time and not about reading direction. Both numbers
 * travel inside one `Ltr` with it, for exactly that reason.
 *
 * ## No sorting, no row click, no row actions
 *
 * `/inventory/movements` publishes no `orderby` at all — it is `created_at DESC`
 * and nothing else — so there is no control to withhold and no evidence to look
 * for. A movement has no detail screen, so the row does not navigate: the one
 * thing on it worth opening is the product, and that is an anchor in the cell
 * that names it. And nothing writes to a movement — the ledger is append-only —
 * so a trailing actions column would be empty.
 */

export type MovementColumnContext = {
  locale: string;
  meId: number | null;
  t: (key: string, values?: Record<string, string | number>) => string;
  tReason: (key: string) => string;
};

/**
 * Who moved it, as far as anything reachable can say.
 *
 * `data-testid` because the suite asserts on this exact element: picking "the
 * first element containing a number" was unambiguous only by accident, and a
 * selector that depends on nothing else on the page ever matching is a selector
 * that breaks for an unrelated reason.
 */
function actorValue(movement: Movement, ctx: MovementColumnContext): ReactNode {
  const actor = movementActor(movement, ctx.meId);
  return (
    <span data-testid="movement-actor" className="min-w-0 truncate">
      {actor.kind === "order" ? (
        /* A translated word with a number in it — `Isolate`, not `Ltr`. */
        <Isolate>{ctx.t("ledger.order", { id: actor.orderId })}</Isolate>
      ) : actor.kind === "you" ? (
        ctx.t("ledger.you")
      ) : actor.kind === "colleague" ? (
        ctx.t("ledger.colleague")
      ) : (
        ctx.t("ledger.unknown")
      )}
    </span>
  );
}

function productValue(movement: Movement, ctx: MovementColumnContext): ReactNode {
  return (
    <Link
      href={`/${ctx.locale}/inventory/${movement.product_id}`}
      className="ui-ring min-w-0 rounded-ui-md hover:underline"
    >
      {/*
        `Isolate`, not `Ltr`, and that is a correction the customers branch
        already paid for once. "Produit 20" / "المنتج 20" is a *translated word
        with a number in it* — neither an identifier nor a formatted value — and
        `Ltr` forces `dir="ltr"` over it, so the Arabic label was laid out
        beginning at the left. Sixteen call sites across five screens had the same
        defect and DECISIONS.md §5 records the rule: **`Ltr` only for a bare
        identifier; the moment a translated word shares the element, `Isolate`.**
        The isolation and the tabular figures are unchanged; only the forced
        direction goes.
      */}
      <Isolate testId="movement-product" className="block truncate">
        {ctx.t("ledger.product", { id: movement.product_id })}
      </Isolate>
    </Link>
  );
}

/**
 * Before and after, not just the delta.
 *
 * The backend guarantees `quantity_before + delta === quantity_after` at
 * construction, so the two numbers reconcile against the rows above and below —
 * which is the entire point of a ledger and the thing a column of bare deltas
 * cannot do.
 */
function changeValue(movement: Movement, ctx: MovementColumnContext): ReactNode {
  return (
    <Ltr testId="movement-change" className="whitespace-nowrap">
      {ctx.t("ledger.arrow", {
        before: movement.quantity_before,
        after: movement.quantity_after,
      })}
    </Ltr>
  );
}

/**
 * The signed delta.
 *
 * The sign is carried by the glyph, not only by the tone — §1.2's rule that
 * colour is never the only signal. U+2212 MINUS SIGN rather than a hyphen: it
 * sits at digit height and aligns in a tabular column, which a hyphen does not.
 */
function deltaValue(movement: Movement): ReactNode {
  const signed =
    movement.delta > 0 ? `+${movement.delta}` : `−${Math.abs(movement.delta)}`;
  return (
    <Ltr
      className={movement.delta > 0 ? "text-ui-success-fg" : "text-ui-danger-fg"}
    >
      {signed}
    </Ltr>
  );
}

/**
 * `created_at` has **no UTC offset** — `"2026-08-18 10:29:37"` — so `new Date()`
 * reads it as local time and shifts it silently. `parseApiDate()`, inside
 * `formatWhen`, is the only thing that may touch it.
 *
 * `Isolate` and never `Ltr`: ICU annotates the Arabic form with U+200F marks on
 * purpose, and forcing `dir="ltr"` over them renders `17ص 12:03 .2026/08/`.
 */
function timeValue(movement: Movement, ctx: MovementColumnContext): ReactNode {
  return (
    <Isolate testId="movement-time" className="whitespace-nowrap">
      {formatWhen(movement.created_at, ctx.locale)}
    </Isolate>
  );
}

export function buildColumns(ctx: MovementColumnContext): Column<Movement>[] {
  const { t, tReason } = ctx;

  return [
    {
      key: "reason",
      header: t("filter.reason"),
      required: true,
      cell: (movement) => (
        <Badge tone={REASON_TONE[movement.reason]}>{tReason(movement.reason)}</Badge>
      ),
    },
    {
      key: "product",
      header: t("ledger.columns.product"),
      cell: (movement) => productValue(movement, ctx),
    },
    {
      key: "who",
      header: t("ledger.columns.who"),
      cell: (movement) => actorValue(movement, ctx),
    },
    {
      key: "change",
      header: t("ledger.columns.change"),
      align: "end",
      cell: (movement) => changeValue(movement, ctx),
    },
    {
      key: "delta",
      header: t("ledger.columns.delta"),
      align: "end",
      cell: (movement) => deltaValue(movement),
    },
    {
      key: "note",
      header: t("ledger.columns.note"),
      optional: true,
      /* The operator's own words, and usually absent — 1140 of the 1154 rows
         carry `""`. Off by default for that reason, and `dir="auto"` when it is
         there so a note typed in the other language is not clipped from its
         front. */
      cell: (movement) =>
        movement.note === "" ? null : (
          <span dir="auto" className="block max-w-64 truncate">
            {movement.note}
          </span>
        ),
    },
    {
      key: "when",
      header: t("ledger.columns.when"),
      cell: (movement) => timeValue(movement, ctx),
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * The headline is *what happened and by how much* — the reason and the signed
 * delta — because that is what somebody scrolling a ledger on a phone is
 * scanning for. The second line is *who and to what*, the third is the
 * reconciliation and the time.
 */
export function movementRecord(
  movement: Movement,
  ctx: MovementColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  return {
    primary: (
      <>
        <Badge tone={REASON_TONE[movement.reason]}>{ctx.tReason(movement.reason)}</Badge>
        <span className="ms-auto shrink-0 text-ui-subheading">
          {deltaValue(movement)}
        </span>
      </>
    ),
    secondary: (
      <>
        {actorValue(movement, ctx)}
        <span className="ms-auto shrink-0">{productValue(movement, ctx)}</span>
      </>
    ),
    meta: (
      <>
        {/* `--text-compact` on this line's tallest child, and it is a measurement
            rather than emphasis: `RecordListSkeleton` draws its third line at
            1.25rem, and the taller child wins the line box. Left at the meta
            row's own `--text-label` the card is 2px short of the placeholder. */}
        <span className="min-w-0 truncate text-ui-compact">
          {changeValue(movement, ctx)}
        </span>
        <span className="ms-auto shrink-0">{timeValue(movement, ctx)}</span>
      </>
    ),
  };
}
