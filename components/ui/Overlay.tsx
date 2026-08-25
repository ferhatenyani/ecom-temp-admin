"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";
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
 * Focus restoration, which Radix does **not** do for a controlled overlay.
 *
 * `Dialog.Content` in its modal form composes its own `onCloseAutoFocus` that
 * calls `preventDefault()` — cancelling `FocusScope`'s restore — and then focuses
 * `context.triggerRef.current`. That ref is only ever set by a rendered
 * `<Dialog.Trigger>`, and every overlay in this panel is driven by an `open`
 * prop from a button that lives somewhere else entirely: a toolbar, a table row,
 * a menu item. So the ref is null, the restore is cancelled, nobody focuses
 * anything, and focus lands on `<body>` — measured on the products filter
 * drawer, where Escape dropped the keyboard back to the top of the document and
 * a person had to tab past the whole sidebar to reach the control they had just
 * used.
 *
 * `onOpenAutoFocus` fires before `FocusScope` moves focus into the content, so
 * `document.activeElement` at that moment is still whatever opened the overlay.
 * Recording it there and focusing it back on close is the whole fix. Both
 * handlers run before Radix's own — `composeEventHandlers` puts the prop first
 * and skips its internal one once `preventDefault()` has been called.
 *
 * ## `returnFocusTo`, added on the orders-detail branch
 *
 * The recorded opener is the right answer only when the opener survives the
 * overlay. **A menu item does not**, and "a `Menu` item opens a `ConfirmDialog`"
 * is the shape every destructive row action in this panel takes: Radix unmounts
 * the item the moment it is selected, so on close the recorded node is detached,
 * the guard below correctly declines to focus it, Radix's own fallback targets a
 * trigger ref that a controlled dialog never sets, and focus lands on `<body>`.
 * Measured with the keyboard alone on the order detail: Escape on the cancel
 * confirmation dropped a person to the top of the document with the whole
 * sidebar to tab through again.
 *
 * Focusing the real trigger *before* opening the dialog does not fix it — the
 * menu's own focus scope is trapped and pulls focus straight back into the menu,
 * so the recorded opener is the menu item anyway. Neither does focusing it after
 * `onOpenChange(false)`, which fires before `onCloseAutoFocus` and therefore
 * loses to it. The caller naming the element is the version that works, and it
 * is an **id** rather than a ref so that a caller can name a control it does not
 * hold a handle to.
 */
function useOpenerFocus(returnFocusTo?: string) {
  const opener = useRef<HTMLElement | null>(null);

  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement as HTMLElement | null;
    },
    onCloseAutoFocus: (event: Event) => {
      /*
       * The caller's explicit target wins, then the recorded opener — and either
       * only while it is still **rendered**. A row's action menu can be gone by
       * the time its drawer closes, and focusing a detached node silently does
       * nothing, which is worse than letting Radix's own fallback run.
       *
       * `getClientRects().length` rather than `isConnected` for the named one,
       * and the difference is the responsive lists. `DataTable` keeps both
       * presentations in the DOM and hides one per breakpoint, so a caller that
       * names a control in the `md`+ table hands this a node that is connected,
       * findable and `display: none` on a phone — where `focus()` is a silent
       * no-op and `preventDefault()` has already cancelled the fallback, so focus
       * lands on `<body>`. Being *present* is not the question; being focusable
       * is. Found on the shipping parcels drawer, whose opener is a cell in the
       * table and whose phone equivalent is `RecordList`'s own overlay button —
       * which Radix restores to unaided, and now does again.
       */
      const rendered = (node: HTMLElement | null) =>
        node && node.isConnected && node.getClientRects().length > 0 ? node : null;

      const named = returnFocusTo ? document.getElementById(returnFocusTo) : null;
      const target = rendered(named) ?? rendered(opener.current);
      if (!target) return;
      event.preventDefault();
      target.focus();
    },
  };
}

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
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: Size;
  children: ReactNode;
  /**
   * The id of the control focus should return to, when the thing that opened
   * this will not be there to receive it — a `Menu` item, typically. See
   * `useOpenerFocus`.
   */
  returnFocusTo?: string;
  /**
   * Actions. Cancel first in DOM order so it is the first tab stop and, on a
   * phone, the *lower* of the two — `flex-col-reverse` puts the primary on top
   * where the thumb is not, which is deliberate for a confirming action.
   */
  footer?: ReactNode;
}) {
  const focus = useOpenerFocus(returnFocusTo);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-scrim fixed inset-0 z-40" />
        <Dialog.Content className={`ui-modal z-50 ${MODAL_WIDTH[size]}`} {...focus}>
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
  returnFocusTo,
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
  /** See `Modal`. */
  returnFocusTo?: string;
}) {
  const focus = useOpenerFocus(returnFocusTo);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-scrim fixed inset-0 z-40" />
        <Dialog.Content
          data-side={side}
          className={`ui-drawer z-50 ${DRAWER_WIDTH[size]}`}
          {...focus}
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
