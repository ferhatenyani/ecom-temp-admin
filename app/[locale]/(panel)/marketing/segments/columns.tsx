"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Segment } from "@/lib/api/schemas/campaign";
import { segmentPreview } from "@/lib/api/schemas/campaign";
import { acRead } from "@/lib/api/browser";
import { SEGMENT_CRITERIA, type SegmentCriterion } from "@/lib/campaigns";
import { Isolate } from "@/components/primitives/Ltr";
import { Badge } from "@/components/ui/Badge";
import { rowOpenerId, type Column } from "@/components/ui/DataTable";

/**
 * The segment column definition — one source, two presentations.
 *
 * ## The count is the screen, and it is a per-row request
 *
 * A segment's criteria are three words on a row and tell nobody whether it is
 * right; "8 clients" does, and "0 clients" is the thing somebody needs to see
 * before a campaign names it — that campaign's send is a 409. So every row
 * carries a live count from `GET /segments/{id}/preview`, one request each, which
 * is affordable because a shop has a handful of segments rather than a page of
 * them and this list pages at 20.
 *
 * The count needs `ac_manage_customers` on top of `ac_manage_marketing` — it is a
 * count of *customers* — so a Marketing Manager sees the list and not the
 * numbers, and the cell says which rather than showing a zero.
 *
 * ## One sortable column, and `id` is not a column at all
 *
 * `name` carries a `sortKey` and nothing else does. `created_at` and `updated_at`
 * are accepted, validated and honoured and **tie on every row** on this shop, so
 * neither can be shown to work; `id` sorts and is not worth a column. `query.ts`
 * carries every request and both halves of the positive control.
 *
 * ## The row opens the editor, so the name is a real `<button>`
 *
 * There is no segment detail route — the editor is a `Modal`, for the reason
 * `SegmentModal.tsx` gives — so the identifying cell cannot be an anchor. It is
 * the opener `rowOpenerId` renders: the keyboard path a `<tr>` handler does not
 * have, and the named target the overlay hands focus back to.
 */

export const SEGMENT_SCOPE = "segment";

export function segmentOpenerId(id: number): string {
  return rowOpenerId(SEGMENT_SCOPE, id);
}

export type SegmentColumnContext = {
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  /** `ac_manage_customers`. False means the counts are not this reader's. */
  canCount: boolean;
};

/**
 * The criteria, as the row's second fact.
 *
 * Names only, never values: "A dépensé au moins" tells somebody which *kind* of
 * segment this is, and the amount belongs in the editor beside the field that
 * holds it. A key the panel does not know is printed as itself rather than
 * dropped — the API's eleven are a server-side constant it publishes on refusal,
 * and a twelfth would otherwise make a row look empty.
 */
export function criteriaSummary(segment: Segment, t: SegmentColumnContext["t"]): string {
  const keys = Object.keys(segment.criteria);
  if (keys.length === 0) return "";
  return keys
    .map((key) =>
      (SEGMENT_CRITERIA as readonly string[]).includes(key)
        ? t(`criterion.${key as SegmentCriterion}`)
        : key,
    )
    .join(" · ");
}

/**
 * The live count for one segment.
 *
 * A component rather than a cell function, because it owns a query — and the
 * query is per row, so it cannot be hoisted into the column definition.
 *
 * **A zero is a real answer here and must look like one.** A `wilaya_id` segment
 * matches nothing until an order is *shipped* — the wilaya is read off the
 * shipment, never off the address — so the badge is toned: neutral when it
 * matches somebody, warning when it matches nobody, which is a campaign that will
 * be refused with a 409 at the send.
 */
export function SegmentMatches({
  segment,
  ctx,
}: {
  segment: Segment;
  ctx: SegmentColumnContext;
}) {
  const { t, canCount } = ctx;

  const { data, isPending, isError } = useQuery({
    queryKey: ["segments", segment.id, "preview"],
    queryFn: async () => {
      const { data } = await acRead<unknown>(`/segments/${segment.id}/preview`);
      return segmentPreview.parse(data);
    },
    enabled: canCount,
  });

  if (!canCount) {
    return <span className="text-ui-subtle">{t("segment.countHidden")}</span>;
  }
  /* A failed count is a missing figure, not a broken row: the segment's name and
     criteria are still true and still worth reading. */
  if (isError) return <span className="text-ui-subtle">{t("segment.countFailed")}</span>;
  if (isPending || data === undefined) {
    return <span className="text-ui-subtle">{t("segment.counting")}</span>;
  }

  return (
    <Badge tone={data.matches > 0 ? "neutral" : "warning"}>
      <Isolate numeric>{t("segment.matches", { count: data.matches })}</Isolate>
    </Badge>
  );
}

export function buildColumns(ctx: SegmentColumnContext): Column<Segment>[] {
  const { t } = ctx;

  return [
    {
      key: "name",
      /* `columns.name` — the plain noun — and not `field.name`, which is
         "Nom interne" and belongs to a *campaign*: that one is the name nobody
         outside the panel ever sees, while a segment's name is what every
         campaign naming it shows. */
      header: t("columns.name"),
      required: true,
      /* The one axis with a positive control — and the control is two-part, see
         `query.ts`. `name asc` is the resting order, so the header opens
         announcing it and the cycle toggles to its reverse and back. */
      sortKey: "name",
      cell: (segment) => (
        <span className="flex min-w-0 items-center gap-2">
          <span dir="auto" className="block max-w-64 truncate">
            {segment.name}
          </span>
          {/* Published by the API so a segment whose criteria have stopped making
              sense can be shown as such rather than silently matching nobody. */}
          {!segment.is_resolvable ? (
            <Badge tone="danger">{t("segment.notResolvable")}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "criteria",
      header: t("section.criteria"),
      cell: (segment) => {
        const summary = criteriaSummary(segment, t);
        return summary === "" ? (
          /* Empty criteria are refused on write, so a stored segment with none is
             a row the API grew rather than one this panel made — said plainly
             instead of rendered as a blank cell. */
          <span className="text-ui-subtle">{t("segment.noCriteria")}</span>
        ) : (
          <span className="block max-w-72 truncate">{summary}</span>
        );
      },
    },
    {
      key: "matches",
      header: t("field.matches"),
      align: "end",
      cell: (segment) => <SegmentMatches segment={segment} ctx={ctx} />,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * The name identifies it, the criteria say what kind of segment it is, and the
 * count is the number the screen exists for — so it takes the trailing slot the
 * eye lands on.
 */
export function segmentRecord(
  segment: Segment,
  ctx: SegmentColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { t } = ctx;
  const summary = criteriaSummary(segment, t);

  return {
    primary: (
      <>
        <span dir="auto" className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg">
          {segment.name}
        </span>
        {!segment.is_resolvable ? (
          <Badge tone="danger">{t("segment.notResolvable")}</Badge>
        ) : null}
      </>
    ),
    secondary: (
      <span className="min-w-0 flex-1 truncate">
        {summary === "" ? (
          <span className="text-ui-subtle">{t("segment.noCriteria")}</span>
        ) : (
          summary
        )}
      </span>
    ),
    /* The count alone, at the inline end. **Not the id beside it**: a primary key
       rendered at a shopkeeper is the shipping-rule argument again, and this row
       has no second fact worth a line — the criteria are already above. */
    meta: (
      <span className="ms-auto shrink-0">
        <SegmentMatches segment={segment} ctx={ctx} />
      </span>
    ),
  };
}
