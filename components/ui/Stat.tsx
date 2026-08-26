import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/primitives/Icon";

/**
 * The metric row on dashboards and analytics headers. See DESIGN.md §3.2.
 *
 * **Specified since the redesign began and built on the branch that owns it.**
 * `customers/[id]/StatisticsCard.tsx:34` and `payments/CodFunnel.tsx:28` each
 * recorded "the analytics iteration owns `StatGroup`/`Stat`" and rendered
 * scope-labelled `DataRow`s instead — correctly, because both of those payloads
 * are pairs of figures that look like one figure and a 4-up block has nowhere to
 * say so. `StatSkeleton` has existed in `Skeleton.tsx` since the same day **with
 * no consumer**, which is a placeholder nobody had ever compared against a real
 * box. This is the consumer, and the skeleton was reshaped onto this file's
 * geometry rather than the other way round.
 *
 * ## The delta slot holds a scope, and DESIGN.md §3.2 was amended to say so
 *
 * §3.2 specified label / value / **delta**, the delta being "+12 % vs last
 * month" in a semantic colour with an arrow. This API publishes **no comparison
 * period** — no `previous`, no `change`, no series — on any of the seven reports,
 * so a delta here would be a number the panel invented. The slot is not wasted:
 * it takes the **scope**, the `DataRow.hint` pattern the payments branch added,
 * and on this payload that is the more valuable of the two.
 *
 * It is valuable because the dashboard puts three arithmetic traps side by side:
 * `net` (booked) beside `collected` (taken); `orders_placed` 901 beside
 * `completed` 56 and `counted_as_revenue` 323; `customers.customers` 9 —
 * *accounts that ordered in this window* — beside 209 guest orders. That is the
 * customers lesson (DECISIONS.md §5) and the payments lesson (§9) arriving a
 * third time, and the answer is the same: never two unlabelled figures at one
 * size on one line.
 *
 * ## A `Stat` without a link is a first-class `Stat`
 *
 * §3.3's rule — a control that cannot act is not rendered — reaches a dashboard
 * card as: a figure whose destination this reader is refused on, or which has no
 * honest destination at all, renders as a plain card. Not a dimmed link, not a
 * disabled one. `href` is therefore optional and the chevron is drawn only when
 * there is somewhere to go, so the affordance and the fact agree.
 */

/**
 * The grid. 1-up at the 340px floor, 2-up at `sm`, 4-up at `lg` — §3.2's own
 * three steps, and the widths `StatSkeleton` draws.
 *
 * `label` is required rather than optional because the group is a landmark a
 * screen reader announces, and a `role="group"` with no accessible name is the
 * same as no group at all.
 */
export function StatGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  /**
   * What this figure counts — the slot §3.2 reserved for a delta.
   *
   * Optional, and a stat that would restate its own label is right not to pass
   * one. Required in practice for any figure standing next to a figure it does
   * not divide into; see the docblock.
   */
  scope,
  /** Absent renders a plain card rather than a dimmed or disabled link. */
  href,
  /**
   * Spans two columns from `sm` up — the lead figure of the group.
   *
   * Seven cards in a 4-up grid is two rows with a hole in the second. One
   * double-width card makes it eight cells and two full rows, and the card that
   * earns the width is the one the screen leads on.
   */
  wide = false,
  testId,
  children,
}: {
  label: string;
  scope?: string;
  href?: string;
  wide?: boolean;
  testId?: string;
  /** The formatted value. The caller wraps it — `Ltr` for a figure, per §6. */
  children: ReactNode;
}) {
  /* 20px at `sm` and up, 16px below — §1.4's density target, and `Card`'s own
     padding, so a stat and a card on one page agree about their edges. */
  const box = [
    "ui-card flex min-w-0 flex-col gap-2 p-4 sm:p-5",
    wide ? "sm:col-span-2" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-ui-label text-ui-muted">{label}</span>
        {href === undefined ? null : (
          <Icon
            name="chevron"
            flipInRtl
            className="mt-0.5 size-3.5 shrink-0 text-ui-subtle"
          />
        )}
      </span>

      {/* `break-words` is the `DataRow` lesson: a money value is one unbreakable
          run — `formatMoney` joins its groups with U+202F — so without a break
          opportunity of last resort it is clipped at the 340px floor, and a
          clipped amount is a wrong number rather than an ugly one. */}
      <span className="min-w-0 text-ui-display break-words text-ui-fg">{children}</span>

      {scope ? <span className="text-ui-caption text-ui-subtle">{scope}</span> : null}
    </>
  );

  if (href === undefined) {
    return (
      <div data-testid={testId} className={box}>
        {body}
      </div>
    );
  }

  return (
    <Link
      href={href}
      data-testid={testId}
      className={`${box} ui-interactive ui-ring hover:bg-ui-surface-2`}
    >
      {body}
    </Link>
  );
}
