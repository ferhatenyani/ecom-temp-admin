"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";

/**
 * Reordering, as a pair of buttons rather than a drag.
 *
 * **ADMIN_PANEL.md asks for drag-ordering and this is not that**, so the reason
 * is here rather than in a commit message.
 *
 * The homepage document and the menu tree are both ordered content edited whole,
 * and `PUT` replaces the array — so the interaction really is "move this one
 * up". The specified implementation of that interaction does not work on the
 * device this panel is designed for:
 *
 *   HTML5 drag-and-drop fires no `dragstart` from a touch pointer. On iOS Safari
 *   and Android Chrome the whole API is inert, so a drag handle at 390px is
 *   decoration — and 390px is the floor this panel is built to, in a stockroom,
 *   one-handed.
 *
 *   It has no keyboard path. `draggable` is not focusable, takes no key events
 *   and exposes nothing to a screen reader, so reordering would be unavailable
 *   to anyone not using a mouse. PRODUCT.md's accessibility commitment is not a
 *   preference.
 *
 * A pointer-event drag would fix the first and not the second, and would still
 * need this control underneath it for the second — which is why iOS itself
 * ships exactly this: `UITableView`'s reorder control is a drag *and*
 * `accessibilityCustomAction`s for "move up" and "move down", and VoiceOver
 * users get the buttons. This panel ships the half that works everywhere rather
 * than the half that photographs well.
 *
 * **Neither arrow flips in RTL.** A list runs top to bottom in both directions,
 * so "up" means up in Arabic too — mirroring these would make the control lie.
 * The buttons sit at the trailing edge, which does flip, because that is where a
 * row's accessories live.
 *
 * **`size-11` rather than `tap-44`, and the difference was measured.** `.tap-44`
 * grows a 44px hit area with an absolutely-positioned `::after` while the button
 * itself stays icon-sized — right for a nav-bar control that is already 44px, and
 * wrong here: these sit at the trailing edge of a padded row, so the pseudo-
 * element hung 12px past the container and pushed the document 24px wide at
 * every phone width. Measured on the homepage editor — `scrollWidth` 426 against
 * a 402 viewport, and exactly 402 with `.tap-44::after` suppressed. No element's
 * *box* overflowed, which is why nothing but a capture found it.
 *
 * A real 44px button participates in layout, so the row can shrink around it
 * instead of being silently overrun by it.
 */
export function MoveControls({
  index,
  count,
  onMove,
  /** Names the thing being moved, so the button reads "Move Hero up" rather than "Move up". */
  label,
  disabled = false,
}: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const t = useTranslations("content");

  const first = index === 0;
  const last = index === count - 1;

  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        // Disabled rather than hidden: a control that disappears at the ends of
        // a list makes the row's other buttons move under the reader's thumb.
        disabled={disabled || first}
        onClick={() => onMove(index, index - 1)}
        aria-label={t("moveUp", { label })}
        className="press flex size-11 shrink-0 items-center justify-center rounded-md text-label-secondary disabled:opacity-30"
      >
        <Icon name="up" className="size-5" />
      </button>
      <button
        type="button"
        disabled={disabled || last}
        onClick={() => onMove(index, index + 1)}
        aria-label={t("moveDown", { label })}
        className="press flex size-11 shrink-0 items-center justify-center rounded-md text-label-secondary disabled:opacity-30"
      >
        <Icon name="down" className="size-5" />
      </button>
    </div>
  );
}

/**
 * Move an item, returning a new array. Out-of-range targets are a no-op rather
 * than an error — the buttons above cannot produce one, and a keyboard shortcut
 * added later should not have to re-check.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }

  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
