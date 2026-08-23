"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { IconButton } from "./Button";

/**
 * Modal and Drawer. See DESIGN.md §3.1.
 *
 * These replace `Sheet` and `ActionSheet`, which were one bottom sheet with
 * detents doing four unrelated jobs. Five overlays now exist, each with one:
 *
 *   Modal          a task that must be finished or abandoned      (here)
 *   Drawer         context beside the page                        (here)
 *   Popover        anchored, non-modal, dismiss by clicking away  (Float.tsx)
 *   Menu           a list of actions from a trigger               (Menu.tsx)
 *   ConfirmDialog  the only way to confirm a destructive action   (Confirm.tsx)
 *
 * Radix supplies behaviour only — focus trap, Escape, scroll lock, ARIA wiring,
 * focus restoration. Every visual property is ours.
 *
 * **Both go full screen below `sm`.** At 340px a centred dialog is a dialog with
 * 8px of margin, which is not a dialog. The positioning lives in `.ui-modal` and
 * `.ui-drawer` in globals.css rather than in a pile of responsive utilities here,
 * because the centring transform and its RTL mirror have to stay together.
 */

type Size = "sm" | "md" | "lg" | "xl";

/* Widths apply at `sm` and up only — below that both components are full
 * screen and a max-inline-size would do nothing but confuse the reader. */
const MODAL_WIDTH: Record<Size, string> = {
  sm: "sm:w-100",
  md: "sm:w-140",
  lg: "sm:w-180",
  xl: "sm:w-240",
};

const DRAWER_WIDTH: Record<Size, string> = {
  sm: "sm:w-100",
  md: "sm:w-130",
  lg: "sm:w-160",
  xl: "sm:w-200",
};

/**
 * The shared chrome: a header that does not scroll, a body that does, and a
 * footer pinned to the bottom. `min-h-0` on the body is what makes the footer
 * stay put — without it a flex child refuses to shrink below its content and
 * the footer is pushed off the bottom of a full-screen overlay.
 */
function OverlayFrame({
  title,
  description,
  children,
  footer,
  headerExtra,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
}) {
  const t = useTranslations("ui");

  return (
    <>
      <div className="flex shrink-0 items-start gap-3 border-b border-ui-line px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          {/* `dir="auto"` because an overlay title is often user content — an
              order number, a product name, a customer. It is the one string in
              the chrome that is not in the page's own language. */}
          <Dialog.Title dir="auto" className="truncate text-ui-heading text-ui-fg">
            {title}
          </Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-0.5 text-ui-label text-ui-muted">
              {description}
            </Dialog.Description>
          ) : (
            /* Radix warns when a Content has no Description. A visually hidden
               one keeps the console clean without inventing copy on screen. */
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
        </div>
        {headerExtra}
        <Dialog.Close asChild>
          <IconButton label={t("close")} icon="close" size="sm" className="-me-1" />
        </Dialog.Close>
      </div>

      <div className="ui-scroll min-h-0 flex-1 px-4 py-4 sm:px-5">{children}</div>

      {footer ? (
        <div className="ui-safe-b flex shrink-0 flex-col-reverse gap-2 border-t border-ui-line px-4 pt-3 sm:flex-row sm:justify-end sm:px-5">
          {footer}
        </div>
      ) : null}
    </>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: Size;
  children: ReactNode;
  /**
   * Actions. Cancel first in DOM order so it is the first tab stop and, on a
   * phone, the *lower* of the two — `flex-col-reverse` puts the primary on top
   * where the thumb is not, which is deliberate for a confirming action.
   */
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-scrim fixed inset-0 z-40" />
        <Dialog.Content className={`ui-modal z-50 ${MODAL_WIDTH[size]}`}>
          <OverlayFrame title={title} description={description} footer={footer}>
            {children}
          </OverlayFrame>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  size = "sm",
  side = "end",
  children,
  footer,
  headerExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: Size;
  /** `start` is for navigation only — everything else opens from the end. */
  side?: "start" | "end";
  children: ReactNode;
  footer?: ReactNode;
  /** A link or action beside the title — "open full page", typically. */
  headerExtra?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-scrim fixed inset-0 z-40" />
        <Dialog.Content
          data-side={side}
          className={`ui-drawer z-50 ${DRAWER_WIDTH[size]}`}
        >
          <OverlayFrame
            title={title}
            description={description}
            footer={footer}
            headerExtra={headerExtra}
          >
            {children}
          </OverlayFrame>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
