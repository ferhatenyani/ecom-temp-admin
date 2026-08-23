"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";
import { IconButton } from "./Button";
import { Drawer } from "./Overlay";
import { Tooltip, TooltipProvider } from "./Float";
import { ThemeToggle } from "./Theme";
import { NAV, isActive, type NavItem } from "./nav-tree";
import type { ThemeChoice } from "@/lib/theme";
import type { Capability } from "@/lib/capabilities";
import { useStoredFlag, writeStored } from "@/lib/stored";

/**
 * The application shell. See DESIGN.md §2.2.
 *
 * Replaces the bottom tab bar and its `More` overflow screen. One tree, three
 * presentations:
 *
 *   lg and up     a persistent 240px sidebar, collapsible to a 64px icon rail
 *   below lg      a top bar with a menu button, opening the same tree in a Drawer
 *
 * The old model had five slots. Fifteen of the panel's twenty destinations lived
 * behind `More`, which on a 1920px monitor is a phone constraint being paid for
 * by someone who is not using a phone.
 */

const RAIL_STORAGE_KEY = "ac-nav-collapsed";

function NavLink({
  item,
  locale,
  dir,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  locale: string;
  dir: "ltr" | "rtl";
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const href = `/${locale}${item.href}`;
  const active = isActive(pathname, href);
  const label = t(item.key);

  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      /* The collapsed rail still needs an accessible name — the label is
         visually gone, and a tooltip is not an accessible name. */
      aria-label={collapsed ? label : undefined}
      title={collapsed ? undefined : label}
      className={`ui-interactive ui-ring flex min-h-9 items-center gap-2.5 rounded-ui-md text-ui-compact ${
        collapsed ? "justify-center px-0" : "px-2.5"
      } ${
        /* Active is a surface fill plus weight. Not a tinted pill, and
           emphatically not a coloured leading bar. */
        active
          ? "bg-ui-surface-3 font-semibold text-ui-fg"
          : "text-ui-muted hover:bg-ui-surface-2 hover:text-ui-fg"
      }`}
    >
      <Icon name={item.icon} className="size-4 shrink-0" />
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{label}</span>}
    </Link>
  );

  return collapsed ? (
    <Tooltip label={label} side="end" dir={dir}>
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function NavTree({
  locale,
  dir,
  capabilities,
  collapsed,
  onNavigate,
}: {
  locale: string;
  dir: "ltr" | "rtl";
  capabilities: string[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("nav");

  return (
    <nav aria-label={t("nav")} className="ui-scroll flex-1 px-2 py-2">
      {NAV.map((group) => {
        /* A destination the session cannot use is not rendered at all. */
        const visible = group.items.filter(
          (item) => !item.capability || capabilities.includes(item.capability as Capability),
        );
        if (visible.length === 0) return null;

        return (
          <div key={group.key} className="mb-4 last:mb-0">
            {collapsed ? (
              /* The rail keeps the grouping as a rule rather than a heading —
                 an 11px uppercase label in 64px is unreadable, but losing the
                 grouping entirely turns the rail into an undifferentiated
                 column of sixteen icons. */
              <div aria-hidden="true" className="mx-2 mb-2 h-px bg-ui-line first:hidden" />
            ) : (
              <h2 className="px-2.5 pb-1.5 text-ui-overline text-ui-subtle uppercase">
                {t(`group.${group.key}`)}
              </h2>
            )}
            <ul className="flex flex-col gap-0.5">
              {visible.map((item) => (
                <li key={item.key}>
                  <NavLink
                    item={item}
                    locale={locale}
                    dir={dir}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({
  locale,
  dir,
  theme,
  appName,
  userName,
  capabilities,
  children,
}: {
  locale: string;
  /** From the locale, resolved on the server. See the Tooltip docblock. */
  dir: "ltr" | "rtl";
  /** From the cookie, resolved on the server. See lib/theme.ts. */
  theme: ThemeChoice;
  appName: string;
  userName: string;
  capabilities: string[];
  children: ReactNode;
}) {
  const t = useTranslations("nav");
  const tUi = useTranslations("ui");
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const collapsed = useStoredFlag(RAIL_STORAGE_KEY);
  const setCollapsed = (next: boolean) => writeStored(RAIL_STORAGE_KEY, next ? "1" : "0");

  /*
   * The drawer must close on navigation, or tapping a destination leaves the
   * nav covering the page you just asked for.
   *
   * Adjusted during render against the previous pathname rather than in an
   * effect: an effect runs after paint, so the new page would render once with
   * the drawer and its scrim still over it — a visible flash on every tap,
   * which is exactly the thing this is meant to prevent.
   */
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setDrawerOpen(false);
  }

  const railWidth = collapsed ? "lg:w-16" : "lg:w-60";
  const railOffset = collapsed ? "lg:ps-16" : "lg:ps-60";

  return (
    <TooltipProvider>
      {/* Before anything focusable. */}
      <a
        href="#content"
        className="ui-ring sr-only rounded-ui-md bg-ui-surface px-4 py-3 text-ui-body text-ui-accent focus:not-sr-only focus:absolute focus:z-50 focus:m-2"
      >
        {t("skipToContent")}
      </a>

      {/* ── the sidebar, lg and up ─────────────────────────────────────── */}
      <aside
        data-testid="sidebar"
        className={`fixed inset-y-0 start-0 z-30 hidden border-ui-line bg-ui-canvas lg:flex lg:flex-col lg:border-e ${railWidth}`}
      >
        <div
          className={`flex min-h-14 shrink-0 items-center gap-2 border-b border-ui-line ${
            collapsed ? "justify-center px-2" : "px-4"
          }`}
        >
          {collapsed ? null : (
            <span className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg">
              {appName}
            </span>
          )}
          <Tooltip label={collapsed ? tUi("expandNav") : tUi("collapseNav")} side="end" dir={dir}>
            <IconButton
              label={collapsed ? tUi("expandNav") : tUi("collapseNav")}
              icon="collapse"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
            />
          </Tooltip>
        </div>

        <NavTree
          locale={locale}
          dir={dir}
          capabilities={capabilities}
          collapsed={collapsed}
        />

        <div
          className={`flex shrink-0 flex-col gap-2 border-t border-ui-line py-3 ${
            collapsed ? "items-center px-2" : "px-3"
          }`}
        >
          <ThemeToggle initial={theme} compact={collapsed} />
          <div
            className={`flex min-w-0 items-center gap-2 ${collapsed ? "justify-center" : ""}`}
          >
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ui-surface-3 text-ui-caption text-ui-muted"
            >
              {userName.slice(0, 1).toUpperCase()}
            </span>
            {collapsed ? null : (
              <span dir="auto" className="min-w-0 flex-1 truncate text-ui-label text-ui-muted">
                {userName}
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* ── the top bar, below lg ──────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-ui-line bg-ui-surface px-3 lg:hidden">
        <IconButton
          label={t("nav")}
          icon="menu"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
        />
        <span className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg">
          {appName}
        </span>
        <ThemeToggle initial={theme} />
      </header>

      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={t("nav")}
        side="start"
        size="sm"
      >
        {/* The Drawer body already pads; the tree pads itself, so it is pulled
            back to the edge to keep row fills full-bleed. */}
        <div className="-mx-4 -my-4 flex flex-col">
          <NavTree
            locale={locale}
            dir={dir}
            capabilities={capabilities}
            collapsed={false}
            onNavigate={() => setDrawerOpen(false)}
          />
        </div>
      </Drawer>

      <div className={railOffset}>{children}</div>
    </TooltipProvider>
  );
}
