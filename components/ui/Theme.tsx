"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";
import { THEME_COOKIE, THEME_MAX_AGE, type ThemeChoice } from "@/lib/theme";

/**
 * The theme control. See DESIGN.md §1.2 and the docblock in `lib/theme.ts`.
 *
 * The tokens have carried a full dark palette and a `[data-theme]` selector
 * since the panel was built, and nothing in the app has ever *set* that
 * attribute — dark mode has been reachable only by changing an OS setting. This
 * is the missing half.
 *
 * The current choice arrives as a prop, read from the cookie on the server. That
 * is what removes both the flash of the wrong theme and the second render an
 * effect would have cost: the markup is already correct when it arrives.
 */

function write(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = choice;

  /* `SameSite=Lax` matches the session cookie's own policy; this one is not
     `HttpOnly` because the toggle has to write it without a round trip. It
     holds a display preference and nothing else. */
  const base = `path=/; max-age=${choice === "system" ? 0 : THEME_MAX_AGE}; SameSite=Lax`;
  document.cookie = `${THEME_COOKIE}=${choice === "system" ? "" : choice}; ${base}`;
}

const OPTIONS: { value: ThemeChoice; icon: "sun" | "moon" | "system" }[] = [
  { value: "light", icon: "sun" },
  { value: "dark", icon: "moon" },
  { value: "system", icon: "system" },
];

/**
 * A three-way control. A `radiogroup` rather than three buttons: the options are
 * mutually exclusive, and that is what makes arrow keys move between them.
 */
export function ThemeToggle({
  initial,
  compact = false,
}: {
  initial: ThemeChoice;
  compact?: boolean;
}) {
  const t = useTranslations("ui.theme");
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      className={`flex items-center gap-0.5 rounded-ui-md border border-ui-line bg-ui-surface-2 p-0.5 ${
        compact ? "flex-col" : ""
      }`}
    >
      {OPTIONS.map((option) => {
        const active = choice === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(option.value)}
            title={t(option.value)}
            onClick={() => {
              write(option.value);
              setChoice(option.value);
            }}
            className={`ui-interactive ui-ring flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-ui-sm ${
              active
                ? "bg-ui-surface text-ui-fg shadow-ui-xs"
                : "text-ui-subtle hover:text-ui-fg"
            }`}
          >
            <Icon name={option.icon} className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
