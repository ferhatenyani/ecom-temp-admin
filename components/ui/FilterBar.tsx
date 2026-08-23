"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";
import { IconButton } from "./Button";

/**
 * Filter tabs, search, and the active-filter chip row. See DESIGN.md §3.2.
 *
 * Replaces `Segmented`, which was an iOS four-slot control holding a
 * single-select filter. Order status has seven values; the old screen showed
 * three of them plus "all" and pushed `on-hold` and `failed` into a sheet
 * because a fourth segment did not fit at 390px. Tabs scroll, so all of them fit
 * at 340px.
 */

/**
 * The tab strip. A real `role="tablist"` would promise arrow-key navigation
 * between panels; these are links that change a query parameter and the page
 * re-fetches, so they are buttons in a `nav` with `aria-current` instead.
 * Claiming tab semantics for something that is not a tabpanel is worse than
 * not claiming them.
 */
export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  /* Keep the active tab in view when the filter is restored from a URL — at
     340px "Refunded" is well off the end of the strip, and landing on a
     filtered link that appears to have nothing selected is confusing. */
  useEffect(() => {
    const node = listRef.current?.querySelector('[aria-current="page"]');
    node?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [value]);

  return (
    <nav aria-label={label} className="-mx-4 sm:-mx-6 xl:-mx-8">
      <div
        ref={listRef}
        className="ui-tabs-scroll flex items-stretch gap-1 overflow-x-auto border-b border-ui-line px-4 sm:px-6 xl:px-8"
      >
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              /* `aria-current` only. An earlier draft also set `aria-selected`,
                 which is not supported on an implicit `button` role — and these
                 are not tabs in the ARIA sense anyway: there is no tabpanel, the
                 filter is a query parameter and the list re-fetches. */
              aria-current={active ? "page" : undefined}
              onClick={() => onChange(tab.value)}
              className="ui-tab ui-ring flex min-h-10 cursor-pointer items-center gap-1.5 rounded-t-ui-md px-2.5 text-ui-compact"
            >
              {tab.label}
              {typeof tab.count === "number" ? (
                <span data-numeric="" className="text-ui-caption text-ui-subtle">
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * The search field. Submits on Enter rather than on every keystroke — the list
 * behind it polls every 30 s and reads are capped at 600/min shared across
 * every tab the user has open, so a request per character is not affordable.
 */
export function SearchField({
  value,
  onSubmit,
  placeholder,
  label,
  clearLabel,
}: {
  value: string;
  onSubmit: (next: string) => void;
  placeholder: string;
  label: string;
  clearLabel: string;
}) {
  const [draft, setDraft] = useState(value);

  /*
   * Follow the URL when it changes underneath — clearing the filter from the
   * empty state, or a back navigation, has to empty the visible field too.
   *
   * Adjusted during render against the previous prop rather than in an effect.
   * An effect would paint one frame with the old search term still in the box
   * after the list behind it had already reset.
   */
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft.trim());
      }}
      className="ui-interactive flex min-w-0 flex-1 items-center gap-1.5 rounded-ui-md border border-ui-line-control bg-ui-surface ps-2.5 pe-1 focus-within:border-ui-accent focus-within:shadow-ui-sm sm:max-w-80"
    >
      <Icon name="search" className="size-4 shrink-0 text-ui-subtle" />
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="search"
        /* The UA's own clear button would sit beside ours and do something
           subtly different — it clears the field without submitting. */
        className="min-h-9 min-w-0 flex-1 bg-transparent text-ui-compact text-ui-fg outline-none placeholder:text-ui-subtle [&::-webkit-search-cancel-button]:appearance-none"
      />
      {draft ? (
        <IconButton
          label={clearLabel}
          icon="close"
          size="sm"
          onClick={() => {
            setDraft("");
            onSubmit("");
          }}
        />
      ) : null}
    </form>
  );
}

/**
 * The active-filter chips. Every applied filter is visible and individually
 * removable — a filter you cannot see is a filter you forget you applied, and
 * on the panel's busiest screen that is how someone concludes an order has
 * vanished.
 */
export function FilterChips({
  chips,
  onClearAll,
}: {
  chips: { key: string; label: string; onRemove: () => void }[];
  onClearAll?: () => void;
}) {
  const t = useTranslations("ui");
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-ui-md border border-ui-line bg-ui-surface-2 ps-2 pe-0.5 py-0.5 text-ui-label text-ui-fg"
        >
          <span dir="auto" className="max-w-40 truncate">
            {chip.label}
          </span>
          <IconButton
            label={t("removeFilter", { filter: chip.label })}
            icon="close"
            size="sm"
            className="size-5"
            onClick={chip.onRemove}
          />
        </span>
      ))}
      {onClearAll && chips.length > 1 ? (
        <button
          type="button"
          onClick={onClearAll}
          className="ui-ring ui-interactive cursor-pointer rounded-ui-md px-1.5 py-0.5 text-ui-label text-ui-muted hover:text-ui-fg"
        >
          {t("clearAll")}
        </button>
      ) : null}
    </div>
  );
}

/** The row that holds search, the extra-filter trigger and the table controls. */
export function FilterRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
