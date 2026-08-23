"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "./Overlay";
import { useMediaQuery } from "@/lib/stored";

/**
 * Popover and Tooltip. See DESIGN.md §3.1.
 *
 * A Popover is anchored, non-modal and dismissed by clicking away: column
 * pickers, density switches, date ranges, filter groups. It never holds a form
 * that can fail validation — that is a Modal, because a validation error inside
 * something that closes when you look away is an error nobody reads.
 */

/**
 * Below `sm` a Popover that would be wider than the viewport becomes a Modal
 * instead. That decision lives here rather than at each call site, so a caller
 * writes one component and gets the right presentation at 340px automatically.
 *
 * `matchMedia` rather than a CSS-only solution because the two are genuinely
 * different components with different semantics — a Popover is non-modal and a
 * Modal traps focus — and you cannot swap that with a media query.
 */
function useIsNarrow() {
  return useMediaQuery("(max-width: 39.99rem)");
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  title,
  children,
  align = "end",
  className = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  /** Used as the Modal title when this collapses at narrow widths. */
  title: string;
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const narrow = useIsNarrow();

  if (narrow) {
    return (
      <>
        <PopoverPrimitive.Root open={false} onOpenChange={onOpenChange}>
          <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
        </PopoverPrimitive.Root>
        <Modal open={open} onOpenChange={onOpenChange} title={title} size="sm">
          {children}
        </Modal>
      </>
    );
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={`ui-float z-50 max-h-100 min-w-56 overflow-y-auto p-2 ${className}`}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * The provider. Mounted once in the shell; `delayDuration` is the pointer pause
 * before a tooltip appears.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/**
 * A tooltip, and it is **never the sole carrier of information** — every control
 * that has one also has an `aria-label` saying the same thing, so a touch user,
 * who will never see it, loses nothing.
 *
 * That is why this renders nothing on a coarse pointer: a tooltip triggered by
 * a tap is a tooltip that fires on the way to pressing the button.
 */
export function Tooltip({
  label,
  children,
  side = "end",
  dir = "ltr",
}: {
  label: string;
  children: ReactNode;
  /** Logical. `end` puts the tooltip outside a leading-edge sidebar rail. */
  side?: "top" | "bottom" | "start" | "end";
  /**
   * The document direction, passed by the caller rather than sniffed.
   *
   * Radix's `side` is physical, so a logical `end` has to be resolved to
   * `right` or `left`. Reading `document.documentElement.dir` would mean an
   * effect and a second render; the locale segment already determines direction
   * and a locale change is a full navigation, so the caller simply knows.
   */
  dir?: "ltr" | "rtl";
}) {
  const rtl = dir === "rtl";
  const physical =
    side === "start" ? (rtl ? "right" : "left") : side === "end" ? (rtl ? "left" : "right") : side;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={physical}
          sideOffset={8}
          className="ui-tooltip ui-float z-50 px-2 py-1 text-ui-label text-ui-fg"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/**
 * A labelled group inside a Popover — the shape every picker in the panel uses.
 */
export function FloatGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2 py-1.5 text-ui-overline text-ui-muted uppercase">{label}</p>
      {children}
    </div>
  );
}

/**
 * A checkable row inside a Popover — the column picker and the density switch
 * are both built from these. A real `<button>` with `aria-pressed`, not a
 * div with a click handler.
 */
export function FloatToggle({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const t = useTranslations("ui");
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      title={disabled ? t("atLeastOneColumn") : undefined}
      onClick={() => onChange(!checked)}
      className="ui-interactive ui-ring ui-hover-fill flex min-h-8 w-full cursor-pointer items-center gap-2.5 rounded-ui-md px-2 text-start text-ui-compact text-ui-fg disabled:cursor-not-allowed disabled:opacity-50"
    >
      {/* A drawn box rather than a real checkbox: this row is already a
          `menuitemcheckbox`, and nesting an input inside it would announce the
          state twice. */}
      <span
        aria-hidden="true"
        className={`flex size-4 shrink-0 items-center justify-center rounded-ui-sm border ${
          checked
            ? "border-ui-fg bg-ui-fg text-ui-surface"
            : "border-ui-line-control bg-ui-surface"
        }`}
      >
        {checked ? (
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

/** A single-select row inside a Popover — the density switch. */
export function FloatRadio({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onSelect}
      className="ui-interactive ui-ring ui-hover-fill flex min-h-8 w-full cursor-pointer items-center gap-2.5 rounded-ui-md px-2 text-start text-ui-compact text-ui-fg"
    >
      <span
        aria-hidden="true"
        className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
          checked ? "border-ui-fg" : "border-ui-line-control"
        }`}
      >
        {checked ? <span className="size-2 rounded-full bg-ui-fg" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
