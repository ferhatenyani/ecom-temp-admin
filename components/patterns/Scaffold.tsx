"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/primitives/Icon";

/**
 * The large title that collapses.
 *
 * The title starts at `--text-large-title`, leading-aligned, below the nav bar. On
 * scroll it moves into the nav bar as `--text-headline` and the bar's material
 * gains its hairline.
 *
 * Driven by `IntersectionObserver` on a sentinel, not by a scroll handler that
 * runs on every frame — a scroll listener recomputing layout at 60 Hz is how a
 * list janks while the reader's thumb is on it.
 */

export function Scaffold({
  title,
  back,
  trailing,
  children,
  /** Rendered under the large title and above the content — a filter bar, usually. */
  toolbar,
}: {
  title: string;
  back?: { href: string; label: string };
  trailing?: ReactNode;
  children: ReactNode;
  toolbar?: ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      // The nav bar is 2.75rem tall; the sentinel leaves the viewport behind it.
      { rootMargin: "-44px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-dvh bg-bg-grouped">
      <header
        className={`material-bar safe-t fixed inset-x-0 top-0 z-20 ${
          collapsed ? "hairline-b" : ""
        }`}
      >
        <div className="flex min-h-11 items-center gap-1 px-2">
          {back ? (
            <Link
              href={back.href}
              className="press flex min-h-11 items-center gap-0.5 rounded-md px-2 text-body text-accent"
            >
              {/* A back arrow points the way the reader reads, so it flips. */}
              <Icon name="back" flipInRtl className="size-5" />
              <span className="truncate">{back.label}</span>
            </Link>
          ) : (
            <span className="min-h-11 w-2" />
          )}

          {/* The collapsed title. Opacity only — a title that slides while the
              list scrolls fights the list. */}
          <h1
            aria-hidden={!collapsed}
            className={`title-collapsed min-w-0 flex-1 truncate text-center text-headline text-label ${
              collapsed ? "is-collapsed" : ""
            }`}
          >
            {title}
          </h1>

          <div className="flex min-h-11 shrink-0 items-center gap-1">{trailing}</div>
        </div>
      </header>

      {/* Clears the fixed nav bar. */}
      <div className="safe-t h-11" />

      <div ref={sentinel} aria-hidden="true" className="h-px" />

      <h1 className="mx-auto max-w-3xl px-4 pt-2 pb-3 text-large-title text-label">
        {title}
      </h1>

      {toolbar ? <div className="mx-auto max-w-3xl px-4 pb-3">{toolbar}</div> : null}

      {/* The bottom padding clears the tab bar and its safe inset. */}
      <main id="content" className="pb-28 md:pb-8">
        {children}
      </main>
    </div>
  );
}
