"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/primitives/Icon";

/**
 * The button. See DESIGN.md §3.3.
 *
 * **Primary is ink, not accent.** That is the one decision here worth defending:
 * a panel where every primary action is the accent colour is a panel where the
 * accent means nothing, because it is on the nav, the links, the focus ring and
 * every submit button at once. Reserving it for "this is interactive" and
 * painting the primary action in `--color-ui-fg` gives both jobs a colour of
 * their own, and it is what makes a screenshot of this read as a console rather
 * than as a template.
 *
 * Every state is here, not half of them: default, hover, active, focus,
 * disabled, loading. There is no `:active { scale }` — that is a touch idiom,
 * and a pointer UI shows press by changing its ground.
 */

type Variant = "primary" | "secondary" | "ghost" | "destructive" | "link";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  /* `text-ui-surface` rather than a white literal, so the label inverts with the
     theme along with the fill it sits on. */
  primary:
    "bg-ui-fg text-ui-surface hover:opacity-90 active:opacity-80 border border-transparent",
  secondary:
    "bg-ui-surface text-ui-fg border border-ui-line-control hover:bg-ui-surface-2 active:bg-ui-surface-3",
  ghost:
    "bg-transparent text-ui-fg border border-transparent hover:bg-ui-surface-2 active:bg-ui-surface-3",
  /* Destructive is a fill, not a tint: it is always the confirming button inside
     a ConfirmDialog, never sitting loose beside a neutral neighbour. */
  destructive:
    "bg-ui-danger-fg text-ui-surface hover:opacity-90 active:opacity-80 border border-transparent",
  link: "bg-transparent text-ui-accent border border-transparent hover:underline underline-offset-2 px-0",
};

/**
 * Heights are the pointer figures. Touch gets 44px through the media query in
 * the class list below rather than through a separate `touch` size, so a caller
 * never has to know which input a person is using.
 */
const SIZE: Record<Size, string> = {
  sm: "min-h-7 px-2.5 text-ui-label gap-1.5",
  md: "min-h-9 px-3 text-ui-compact gap-2",
  lg: "min-h-11 px-4 text-ui-body gap-2",
};

const BASE =
  "ui-interactive ui-ring inline-flex shrink-0 cursor-pointer items-center justify-center rounded-ui-md font-medium select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

type CommonProps = {
  children?: ReactNode;
  variant?: Variant;
  size?: Size;
  /** Leading icon. Replaced by the spinner while `loading`. */
  icon?: IconName;
  /** Trailing icon — a chevron on a menu trigger, typically. */
  iconEnd?: IconName;
  fullWidth?: boolean;
  className?: string;
};

function classes({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
}: CommonProps) {
  return [BASE, VARIANT[variant], SIZE[size], fullWidth ? "w-full" : "", className]
    .filter(Boolean)
    .join(" ");
}

/**
 * The spinner that stands in for the leading icon. The label stays and the
 * button holds its width — a button that shrinks mid-click moves the thing the
 * pointer is already over.
 */
function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`ui-spin shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconEnd,
  loading = false,
  fullWidth = false,
  className = "",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & CommonProps & { loading?: boolean }) {
  const iconSize = size === "sm" ? "size-3.5" : "size-4";
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? (
        <Spinner className={iconSize} />
      ) : icon ? (
        <Icon name={icon} className={`${iconSize} shrink-0`} />
      ) : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} className={`${iconSize} shrink-0`} /> : null}
    </button>
  );
}

/**
 * The same surface as a link. A button that navigates must be an `<a>`, or the
 * middle click, the context menu and "open in new tab" all silently do nothing.
 */
export function ButtonLink({
  href,
  children,
  variant = "secondary",
  size = "md",
  icon,
  iconEnd,
  fullWidth = false,
  className = "",
  ...rest
}: CommonProps & { href: string } & Omit<
    React.ComponentPropsWithoutRef<typeof Link>,
    "href" | "className" | "children"
  >) {
  const iconSize = size === "sm" ? "size-3.5" : "size-4";
  return (
    <Link
      href={href}
      className={classes({ variant, size, fullWidth, className })}
      {...rest}
    >
      {icon ? <Icon name={icon} className={`${iconSize} shrink-0`} /> : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} className={`${iconSize} shrink-0`} /> : null}
    </Link>
  );
}

/**
 * An icon-only button. `label` is required rather than optional — that is the
 * whole point of the separate component, because an icon button with no
 * accessible name is the most common a11y defect in an admin panel and an
 * optional prop is one a caller forgets.
 */
export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  loading = false,
  flipInRtl = false,
  className = "",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: IconName;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  flipInRtl?: boolean;
  className?: string;
}) {
  const box = size === "sm" ? "size-7" : size === "lg" ? "size-11" : "size-9";
  const iconSize = size === "sm" ? "size-3.5" : "size-4";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        BASE,
        VARIANT[variant],
        "ui-tap px-0",
        box,
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? (
        <Spinner className={iconSize} />
      ) : (
        <Icon name={icon} flipInRtl={flipInRtl} className={iconSize} />
      )}
    </button>
  );
}
