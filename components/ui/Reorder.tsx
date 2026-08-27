"use client";

import { useTranslations } from "next-intl";
import { IconButton } from "@/components/ui/Button";

/**
 * Reordering, as a pair of buttons rather than a drag.
 *
 * Promoted from `components/patterns/MoveControls.tsx` on the content branch.
 * Every argument below was written there and is measured; none of it changed in
 * the move. What changed is where it lives and what it reads: the pattern read
 * `content.moveUp`/`content.moveDown` — a shared control reaching into one
 * screen's namespace, which was harmless only while all four of its importers
 * were inside `content/`. It reads `ui.reorder.*` now, so the next screen that
 * needs a reorder does not inherit a Content string.
 *
 * ## Why not a drag
 *
 * **ADMIN_PANEL.md asks for drag-ordering and this is not that**, so the reason
 * is here rather than in a commit message.
 *
 * The homepage document, the menu tree, the banners and the FAQs are all ordered
 * content, and the write is either a whole-array `PUT` or one `PATCH` per moved
 * row — so the interaction really is "move this one up". The specified
 * implementation of that interaction does not work on the device this panel is
 * designed for:
 *
 *   HTML5 drag-and-drop fires no `dragstart` from a touch pointer. On iOS Safari
 *   and Android Chrome the whole API is inert, so a drag handle at the 340px
 *   floor is decoration — and that floor is a stockroom, one-handed.
 *
 *   It has no keyboard path. `draggable` is not focusable, takes no key events
 *   and exposes nothing to a screen reader, so reordering would be unavailable
 *   to anyone not using a mouse. PRODUCT.md's accessibility commitment is not a
 *   preference, and DESIGN.md §5 requires a full keyboard path to every action.
 *
 * A pointer-event drag would fix the first and not the second, and would still
 * need this control underneath it for the second — which is why iOS itself
 * ships exactly this: `UITableView`'s reorder control is a drag *and*
 * `accessibilityCustomAction`s for "move up" and "move down", and VoiceOver
 * users get the buttons. This panel ships the half that works everywhere rather
 * than the half that photographs well.
 *
 * ## Two properties that must survive any edit to this file
 *
 * **Neither arrow flips in RTL.** A list runs top to bottom in both directions,
 * so "up" means up in Arabic too — mirroring these would make the control lie.
 * `IconButton`'s `flipInRtl` is therefore left at its default of `false`, which
 * is the correct value and is stated here because it is the sort of thing a
 * later reader "fixes". The buttons sit at the trailing edge, which *does* flip,
 * because that is where a row's accessories live.
 *
 * **`size="lg"` — 44px — and the size is load-bearing rather than generous.**
 * The retired `.tap-44` grew a 44px hit area from an absolutely-positioned
 * `::after` while the button itself stayed icon-sized. That is right for a
 * nav-bar control and wrong here: these sit at the trailing edge of a padded
 * row, so the pseudo-element hung 12px past the container and pushed the
 * document 24px wide at every phone width. Measured on the homepage editor —
 * `scrollWidth` 426 against a 402 viewport, and exactly 402 with the
 * pseudo-element suppressed. **No element's own box overflowed, which is why
 * nothing but a capture found it.**
 *
 * `.ui-tap` — which `IconButton` carries — has the same shape, but its
 * `::after` is `width: 100%` with a 44px *minimum*, so on a 44px box it is
 * exactly the box and overflows nothing. At `size="md"` (36px) it would grow to
 * 44px and hang 4px out each side, which is the same defect at a third of the
 * magnitude. A real 44px button participates in layout, so the row shrinks
 * around it instead of being silently overrun by it.
 */
export function Reorder({
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
  const t = useTranslations("ui");

  const first = index === 0;
  const last = index === count - 1;

  return (
    <div className="flex shrink-0 items-center">
      {/*
        Disabled rather than hidden, and this is the one place DESIGN.md §3.3's
        "a control that cannot act is not rendered" is deliberately not applied:
        a control that disappears at the ends of a list makes the row's other
        buttons move under the reader's thumb, and the reason it cannot act —
        this row is already first — is legible from the row's own position
        rather than needing to be said.
      */}
      <IconButton
        label={t("reorder.up", { label })}
        icon="up"
        size="lg"
        disabled={disabled || first}
        onClick={() => onMove(index, index - 1)}
      />
      <IconButton
        label={t("reorder.down", { label })}
        icon="down"
        size="lg"
        disabled={disabled || last}
        onClick={() => onMove(index, index + 1)}
      />
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
