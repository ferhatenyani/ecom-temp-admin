"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/primitives/Icon";

/**
 * The action menu. See DESIGN.md §3.1.
 *
 * Replaces `ActionSheet`, which was bottom-anchored at every width because it
 * was an iOS control — an action sheet is a response to something the *thumb*
 * just touched, and there is no such gesture on a pointer.
 *
 * Radix's dropdown-menu rather than a Popover full of buttons, and the
 * difference is not cosmetic: a `role="menu"` needs roving focus, arrow-key
 * navigation, typeahead, and `aria-activedescendant` wiring. Hand-rolling that
 * on top of a Popover produces something that looks like a menu and is not one.
 */

export type MenuAction = {
  key: string;
  label: string;
  icon?: IconName;
  /** A menu item that navigates renders as a link, so middle-click works. */
  href?: string;
  onSelect?: () => void;
  /** Destructive items sit last, behind a separator, and are never the default. */
  destructive?: boolean;
  disabled?: boolean;
  /**
   * Shown inline-end — a keyboard shortcut, a count, or **why this item is
   * disabled**.
   *
   * That third use is what gives it a width bound. §3.3 says a disabled control
   * that does not say why is a dead end, and a menu is the one place in the panel
   * where a disabled control has nowhere else to put the sentence: there is no
   * footnote under a `DropdownMenu.Item` the way there is under a `Card`. So a
   * reason goes here, and `max-w-48` is what stops a 60-character one from
   * dragging the menu past a 340px viewport — it wraps to two or three lines
   * instead, which costs height a menu has and width it does not.
   *
   * `shrink-0` is kept beside it: the label is the element that gives way
   * (`min-w-0 truncate`), because a truncated action name is still recognisable
   * and half a reason is not.
   */
  hint?: string;
};

const ITEM_BASE =
  "ui-interactive flex min-h-8 cursor-pointer items-center gap-2.5 rounded-ui-md px-2 text-ui-compact outline-none select-none data-[highlighted]:bg-ui-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

function ItemInner({ action }: { action: MenuAction }) {
  return (
    <>
      {action.icon ? (
        <Icon name={action.icon} className="size-4 shrink-0" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{action.label}</span>
      {action.hint ? (
        <span className="max-w-48 shrink-0 text-ui-caption text-ui-subtle">
          {action.hint}
        </span>
      ) : null}
    </>
  );
}

export function Menu({
  trigger,
  actions,
  align = "end",
  label,
}: {
  trigger: ReactNode;
  actions: MenuAction[];
  align?: "start" | "center" | "end";
  /** Names the menu for a screen reader — "Actions for order 10482". */
  label: string;
}) {
  /* Destructive items are pulled to the bottom regardless of the order the
     caller passed them in, so a caller cannot accidentally place "Delete"
     directly above "Duplicate" where a mis-aimed click is expensive. */
  const normal = actions.filter((a) => !a.destructive);
  const destructive = actions.filter((a) => a.destructive);

  function renderItem(action: MenuAction) {
    const tone = action.destructive ? "text-ui-danger-fg" : "text-ui-fg";
    if (action.href && !action.disabled) {
      return (
        <DropdownMenu.Item key={action.key} asChild disabled={action.disabled}>
          <Link href={action.href} className={`${ITEM_BASE} ${tone}`}>
            <ItemInner action={action} />
          </Link>
        </DropdownMenu.Item>
      );
    }
    return (
      <DropdownMenu.Item
        key={action.key}
        disabled={action.disabled}
        onSelect={action.onSelect}
        className={`${ITEM_BASE} ${tone}`}
      >
        <ItemInner action={action} />
      </DropdownMenu.Item>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="ui-float ui-menu z-50 min-w-48 p-1"
        >
          {normal.map(renderItem)}
          {destructive.length > 0 && normal.length > 0 ? (
            <DropdownMenu.Separator className="my-1 h-px bg-ui-line" />
          ) : null}
          {destructive.map(renderItem)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
