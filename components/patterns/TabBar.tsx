"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/primitives/Icon";

/**
 * The primary navigation: a bottom tab bar within thumb reach, not a hamburger
 * drawer. `Dashboard` sits centre.
 *
 * At `md` and up it becomes a fixed sidebar with the same order and the same
 * grouping — the same tree, not a second navigation model.
 *
 * A role holding fewer than five of the primary destinations gets its tabs
 * backfilled from `More` in a fixed order, so a Marketing Manager's tab bar is
 * coherent rather than three tabs and two gaps. Orders and Products are built;
 * the rest render as disabled-looking placeholders rather than links that 404 —
 * a tab that navigates nowhere is worse than one that says it is not ready.
 */

type Tab = {
  key: "orders" | "products" | "dashboard" | "customers" | "more";
  href: string | null;
  icon: IconName;
  /**
   * A tab label has one line and about 70px. "Tableau de bord" and
   * "لوحة القيادة" both wrapped to two lines and pushed the bar taller than the
   * other tabs, so the tab bar uses a short form and the sidebar uses the full
   * one.
   */
  shortKey?: "dashboardShort";
};

const TABS: Tab[] = [
  { key: "orders", href: "/orders", icon: "orders" },
  { key: "products", href: "/products", icon: "products" },
  { key: "dashboard", href: null, icon: "dashboard", shortKey: "dashboardShort" },
  { key: "customers", href: null, icon: "customers" },
  { key: "more", href: null, icon: "more" },
];

export function TabBar({ locale }: { locale: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("nav")}
      data-testid="tab-bar"
      className="material-bar hairline-t safe-b fixed inset-x-0 bottom-0 z-20 md:hidden"
    >
      <ul className="flex items-stretch justify-around">
        {TABS.map((tab) => {
          const href = tab.href ? `/${locale}${tab.href}` : null;
          const active = href !== null && pathname.startsWith(href);
          const label = tab.shortKey ? t(tab.shortKey) : t(tab.key);

          const inner = (
            <>
              <Icon
                name={tab.icon}
                className={`size-6 ${active ? "text-accent" : "text-label-secondary"}`}
              />
              <span
                className={`truncate text-caption whitespace-nowrap ${
                  active ? "font-medium text-accent" : "text-label-secondary"
                }`}
              >
                {label}
              </span>
            </>
          );

          return (
            <li key={tab.key} className="flex-1">
              {href ? (
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className="press flex min-h-13 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1"
                >
                  {inner}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="flex min-h-13 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 opacity-40"
                >
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The same tree at `md` and up, as a sidebar. */
export function Sidebar({ locale, appName }: { locale: string; appName: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("nav")}
      data-testid="sidebar"
      className="material-bar hidden md:fixed md:inset-y-0 md:start-0 md:z-20 md:flex md:w-60 md:flex-col md:border-e md:border-separator"
    >
      {/* The app's name, not the dashboard's — the header sat above a nav item
          with the same words, which read as a broken duplicate. */}
      <div className="px-4 py-5 text-title-2 text-label">{appName}</div>
      <ul className="flex flex-col gap-1 px-2">
        {TABS.map((tab) => {
          const href = tab.href ? `/${locale}${tab.href}` : null;
          const active = href !== null && pathname.startsWith(href);
          // The sidebar has room for the full label.
          const label = t(tab.key);

          const inner = (
            <>
              <Icon
                name={tab.icon}
                className={`size-5 shrink-0 ${active ? "text-accent" : "text-label-secondary"}`}
              />
              <span className="truncate text-body">{label}</span>
            </>
          );

          return (
            <li key={tab.key}>
              {href ? (
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`press-row flex min-h-11 items-center gap-3 rounded-md px-3 ${
                    active ? "tone-accent tonal font-medium" : "text-label"
                  }`}
                >
                  {inner}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="flex min-h-11 items-center gap-3 rounded-md px-3 text-label opacity-40"
                >
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
