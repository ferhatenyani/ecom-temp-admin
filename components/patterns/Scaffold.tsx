"use client";

import type { ReactNode } from "react";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";

/**
 * **A compatibility shim, not a component to build with.** New screens use
 * `PageHeader` and `PageBody` from `components/ui/` directly.
 *
 * This used to be the iOS navigation bar: a large title that collapsed into a
 * fixed translucent bar, driven by an `IntersectionObserver` on a sentinel, with
 * a `.material-bar` backdrop blur and a `max-w-3xl` content column. All of that
 * is retired — see DESIGN.md §0.
 *
 * It survives as a shim for one reason. `AppShell` replaced the tab bar in the
 * shared panel layout, which means every screen in the panel now renders inside
 * the new chrome — including the twenty that have not been redesigned yet. Left
 * as it was, each of those would paint its own fixed nav bar on top of the new
 * top bar, and every one of them would have to be touched in the same commit
 * that changed the layout.
 *
 * So the props stay identical and map onto the new header:
 *
 *   title     → PageHeader title
 *   back      → PageHeader back
 *   trailing  → PageHeader actions
 *   toolbar   → PageHeader toolbar
 *   children  → PageBody
 *
 * A screen migrates by deleting its `<Scaffold>` and writing the two components
 * itself. When the last one has, this file goes.
 */
export function Scaffold({
  title,
  back,
  trailing,
  children,
  toolbar,
}: {
  title: string;
  back?: { href: string; label: string };
  trailing?: ReactNode;
  children: ReactNode;
  toolbar?: ReactNode;
}) {
  /*
   * `overflow-x: clip` on the shim's wrapper, and only on the shim's.
   *
   * Measured at 1440: an un-migrated screen scrolled 12px horizontally, which
   * the new system forbids outright. The cause is old-system content authored
   * for the old container — `.pill-row` bleeds its gutter with a negative
   * inline margin sized to `Scaffold`'s old `px-4`, and `PageBody` pads
   * differently at `xl`. Each screen's own rewrite removes the cause, so this
   * is a floor under the transition rather than a fix.
   *
   * `clip` rather than `hidden`: `hidden` makes the element a scroll container,
   * which silently breaks `position: sticky` on anything inside it. `clip`
   * does not.
   */
  return (
    <div className="min-h-dvh overflow-x-clip bg-ui-canvas">
      <PageHeader
        title={title}
        back={back}
        actions={trailing}
        toolbar={toolbar}
        divided
      />
      {/*
        `detail` rather than `full`: an un-migrated screen is a column of iOS
        grouped lists, and those were designed against the old `max-w-3xl`. A
        full-width canvas would stretch a 768px list to 1600px and put each row's
        badge a hand's width from the name it belongs to. The width goes when the
        screen does.
      */}
      <PageBody width="detail">{children}</PageBody>
    </div>
  );
}
