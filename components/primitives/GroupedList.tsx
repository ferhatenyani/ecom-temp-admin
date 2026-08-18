import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "./Icon";

/**
 * The grouped inset list — the workhorse.
 *
 * A `--color-surface` rounded block on `--color-bg-grouped`, rows separated by
 * hairlines that inset from the leading edge, a group title above and an optional
 * footnote below. Every detail screen, every settings screen and every form in
 * this panel is one of these. No border, no shadow: a card is a surface step, and
 * elevation in iOS comes from surface lightness and hairlines.
 */

export function ListGroup({
  title,
  footnote,
  children,
  className = "",
}: {
  title?: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-8 ${className}`}>
      {title ? (
        <h2 className="mb-2 px-4 text-title-3 text-label">{title}</h2>
      ) : null}
      <div className="overflow-hidden rounded-lg bg-surface">{children}</div>
      {footnote ? (
        <p className="mt-2 px-4 text-footnote text-label-secondary">{footnote}</p>
      ) : null}
    </section>
  );
}

/**
 * `list-row` carries the hairline and drops it on the last child, so the rounded
 * corner is never crossed by a rule. 44px minimum height on every row, because
 * every row in this panel is either tappable or sits beside something that is.
 */
const ROW_BASE =
  "list-row relative flex min-h-11 w-full items-center gap-3 px-4 py-3 text-start";

export function ListRow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${ROW_BASE} ${className}`}>{children}</div>;
}

/**
 * A row that navigates. The chevron flips in RTL because list disclosure follows
 * reading direction; the row's own content does not mirror beyond what `dir`
 * already does.
 */
export function ListLinkRow({
  href,
  children,
  className = "",
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`${ROW_BASE} press-row ${className}`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <Icon
        name="chevron"
        flipInRtl
        className="size-4 shrink-0 text-label-tertiary"
      />
    </Link>
  );
}

/**
 * A label/value row, which is most of what a detail screen is made of. The value
 * is `Ltr`-wrapped by the caller when it is an identifier — this component does
 * not guess, because guessing wrong is the silent bidi bug.
 */
export function ListValueRow({
  label,
  value,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${ROW_BASE} ${className}`}>
      <span className="shrink-0 text-body text-label-secondary">{label}</span>
      <span className="ms-auto min-w-0 text-body text-label text-end">{value}</span>
    </div>
  );
}
