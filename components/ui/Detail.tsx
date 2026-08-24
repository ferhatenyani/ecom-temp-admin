import type { ReactNode } from "react";

/**
 * The two-column detail layout. See DESIGN.md §2.3.
 *
 * `PageBody width="detail"` is a single 768px column and is right for a
 * notification or an audit entry. An order, a product, a customer are not that
 * shape: they have an unboundedly-growing main body — line items, a timeline,
 * parcels, transactions — beside a fixed block of reference material a person
 * glances at while reading it. Roughly twenty screens in this run are that shape,
 * which is why this is a primitive on the first one rather than a grid written
 * out on the twentieth.
 *
 * **The aside moves below main when it collapses, never above.** That is the
 * whole reason `main` and `aside` are props rather than children: DOM order is
 * the collapse order, and a caller writing the aside first — which reads
 * naturally, since it is the summary — would put the metadata card above the
 * items on every phone. Someone opening an order on a phone came for the items.
 *
 * **1152px, and the number is derived rather than chosen.** 768 is §2.3's
 * single-column detail width, 360 is the aside, 24 is the gutter between them:
 * the main column at its widest is exactly as wide as it would be if the aside
 * were not there. `PageBody width="split"` carries the cap.
 *
 * Flex rather than `grid-cols-[minmax(0,1fr)_360px]`, which is the obvious
 * spelling and is an arbitrary value — banned by §7 and by `check-design.sh`,
 * because an arbitrary value is a token nobody added. `flex-1` beside a
 * `lg:w-90` is the same 1fr + 360px off the spacing scale.
 */
export function DetailGrid({
  main,
  aside,
}: {
  main: ReactNode;
  aside: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      {/* `min-w-0`, or a 60-character SKU in a line item sets the column's
          minimum content width and pushes the aside off the page. */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">{main}</div>
      <aside className="flex w-full min-w-0 shrink-0 flex-col gap-4 lg:w-90">
        {aside}
      </aside>
    </div>
  );
}
