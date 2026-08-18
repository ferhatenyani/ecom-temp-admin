"use client";

import { useTranslations } from "next-intl";
import type { Movement } from "@/lib/api/schemas/inventory";
import { movementActor } from "@/lib/inventory";
import { REASON_TONE } from "@/lib/movement-reason";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { formatWhen } from "@/lib/format/date";

/**
 * One line of the stock ledger.
 *
 * **This row is almost entirely numbers inside prose**, in a panel whose second
 * locale is Arabic: a product id, a signed delta, two quantities either side of
 * an arrow, an order number and a timestamp. Every one of them is wrapped in
 * `Ltr`, because the bidi algorithm reorders a run of digits next to RTL text and
 * nothing errors when it does — the number is simply wrong on screen. That is the
 * single most common bug in bilingual admin tools and this is the densest place
 * in the panel for it.
 *
 * Same geometry as `StockRow` — 24px, 4px gap, 18px, `py-3` — so one skeleton
 * serves both lists and the segmented control does not resize rows underneath the
 * reader.
 *
 * `product_id` renders as an id and never as a name. The ledger names 155
 * distinct products and only 23 of them are in `/inventory` at all; the rest were
 * deleted by the backend's own fixtures. A ledger is an archive, a catalogue is
 * not, and resolving 20 ids per page would be 20 requests to produce a label that
 * is missing six times out of seven.
 */
export function MovementRow({
  movement,
  locale,
  meId,
  onOpenProduct,
  showProduct = true,
}: {
  movement: Movement;
  locale: string;
  meId: number | null;
  /** Set when this product is reachable — absent inside an item's own ledger. */
  onOpenProduct?: (productId: number) => void;
  /**
   * False on an item's own ledger, where every row names the product whose page
   * the reader is already on. Five rows repeating "Produit 20" underneath a
   * heading that says Produit 20 is noise that pushes the note off the row.
   */
  showProduct?: boolean;
}) {
  const t = useTranslations("inventory");
  const tReason = useTranslations("movementReason");
  const actor = movementActor(movement, meId);

  // The sign is carried by the glyph, not only by the tone: semantic colour is
  // never the only signal. U+2212 MINUS SIGN rather than a hyphen — it aligns
  // with the digits in a tabular column, which a hyphen does not.
  const signed =
    movement.delta > 0 ? `+${movement.delta}` : `−${Math.abs(movement.delta)}`;

  return (
    <div className="flex w-full items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-6 items-center gap-2">
          <StatusBadge tone={REASON_TONE[movement.reason]}>
            {tReason(movement.reason)}
          </StatusBadge>
          <span className="truncate text-footnote text-label-secondary">
            {actor.kind === "order" ? (
              <Ltr>{t("ledger.order", { id: actor.orderId })}</Ltr>
            ) : actor.kind === "you" ? (
              t("ledger.you")
            ) : actor.kind === "colleague" ? (
              t("ledger.colleague")
            ) : (
              t("ledger.unknown")
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 text-footnote text-label-secondary">
          {showProduct ? (
            <>
              {onOpenProduct ? (
                <button
                  type="button"
                  onClick={() => onOpenProduct(movement.product_id)}
                  className="press shrink-0 truncate rounded-sm text-accent"
                >
                  <Ltr>{t("ledger.product", { id: movement.product_id })}</Ltr>
                </button>
              ) : (
                <Ltr className="shrink-0 truncate">
                  {t("ledger.product", { id: movement.product_id })}
                </Ltr>
              )}
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          {/*
            Before and after, not just the delta. The backend guarantees
            `quantity_before + delta === quantity_after` at construction, so the
            two numbers reconcile against the rows above and below — which is the
            entire point of a ledger and the thing a column of bare deltas cannot
            do.

            The arrow is a literal → and does **not** flip in RTL: it points from
            an earlier value to a later one, which is a fact about time and not
            about reading direction. It sits inside `Ltr` with both numbers for
            exactly that reason.
          */}
          <Ltr numeric className="shrink-0">
            {t("ledger.arrow", {
              before: movement.quantity_before,
              after: movement.quantity_after,
            })}
          </Ltr>
          {/* The note is the operator's own words and is usually empty — 1140 of
              the 1154 rows carry `""`. It takes room only when it has something
              in it. */}
          {movement.note !== "" ? (
            <>
              <span aria-hidden="true">·</span>
              {/* The operator's own words, in whichever language they typed —
                  `dir="auto"` so it is not clipped from its front in the other
                  one. See `StockRow` for the measurement. */}
              <span dir="auto" className="truncate">
                {movement.note}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5 text-end">
        <Ltr
          className={`text-title-3 ${
            movement.delta > 0 ? "tonal-fg tone-success" : "tonal-fg tone-danger"
          }`}
        >
          {signed}
        </Ltr>
        <span className="text-caption whitespace-nowrap text-label-tertiary">
          <Isolate>{formatWhen(movement.created_at, locale)}</Isolate>
        </span>
      </div>
    </div>
  );
}
