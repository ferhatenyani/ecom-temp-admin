"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "./Icon";

/**
 * A bottom sheet on mobile, a centred modal at `md` and up — one component, two
 * presentations.
 *
 * Radix supplies the behaviour only: focus trap, Escape, scroll lock, the ARIA
 * wiring. Every visual property here is ours, and the two shadows in this file
 * are two of the three places in the whole panel permitted to cast one — a sheet
 * and a popover float over content and need to say so.
 *
 * `--radius-xl` on the top corners only, and a grabber, because a sheet that is
 * square at the top reads as a page that failed to load.
 */

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations("a11y");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content className="sheet-content fixed z-50 flex flex-col bg-bg-grouped shadow-overlay">
          {/* The grabber. Decorative — dragging is not the only way to dismiss,
              and the backdrop and Escape both work. */}
          <div className="flex shrink-0 justify-center pt-2 md:hidden">
            <span aria-hidden="true" className="h-1 w-9 rounded-full bg-fill" />
          </div>

          <div className="flex shrink-0 items-center gap-2 px-4 py-3">
            <Dialog.Title className="min-w-0 flex-1 text-title-2 text-label">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label={t("closeSheet")}
              className="tap-44 press -me-1 flex size-11 items-center justify-center rounded-full text-label-secondary"
            >
              <Icon name="close" />
            </Dialog.Close>
          </div>

          {description ? (
            <Dialog.Description className="shrink-0 px-4 pb-2 text-footnote text-label-secondary">
              {description}
            </Dialog.Description>
          ) : null}

          <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {children}
          </div>

          {footer ? (
            <div className="safe-b hairline-t shrink-0 bg-surface px-4 py-3">{footer}</div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
