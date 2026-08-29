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
 *
 * ## `variant`, added on the analytics branch, because two strips are not peers
 *
 * `/analytics` is the first screen in the panel with **two** single-select strips
 * stacked: which report am I reading, and over what window. They are not the same
 * rank — the first is navigation and the second is a filter over whatever it
 * lands on — and rendered as two identical strips they read as two filters of
 * equal weight, which is precisely the hierarchy the screen exists to have.
 *
 *   `tabs`   the default and unchanged: full-bleed, closed by a rule, the
 *            selected label underlined in ink. It spans the page, so it reads as
 *            the page's own axis. Every list in the panel uses this.
 *   `chips`  a labelled group of pills inside the content column, with no bleed
 *            and no rule. The visible label is half the distinction — a filter
 *            says what it filters, navigation does not need to.
 *
 * Both scroll rather than wrap at the 340px floor, for the same reason: a wrapped
 * strip changes the page's height as the selection changes.
 */
export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  variant = "tabs",
}: {
  /**
   * `opensDialog` is for a tab that does not apply a filter on its own — the
   * range control's "custom", which opens a `Modal` to collect two dates before
   * anything is filtered at all. It sets `aria-haspopup="dialog"`, so the one tab
   * in the strip that behaves differently announces that it does rather than
   * looking identical to the five that apply immediately.
   */
  tabs: { value: T; label: string; count?: number; opensDialog?: boolean }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  /** See the docblock. `tabs` is the page's axis; `chips` is a filter on it. */
  variant?: "tabs" | "chips";
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const chips = variant === "chips";

  /* Keep the active tab in view when the filter is restored from a URL — at
     340px "Refunded" is well off the end of the strip, and landing on a
     filtered link that appears to have nothing selected is confusing. */
  useEffect(() => {
    const node = listRef.current?.querySelector('[aria-current="page"]');
    node?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [value]);

  const strip = (
    <div
      ref={listRef}
      className={
        chips
          ? "ui-tabs-scroll flex min-w-0 items-center gap-1 overflow-x-auto"
          : "ui-tabs-scroll flex items-stretch gap-1 overflow-x-auto border-b border-ui-line px-4 sm:px-6 xl:px-8"
      }
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
            aria-haspopup={tab.opensDialog ? "dialog" : undefined}
            onClick={() => onChange(tab.value)}
            className={
              chips
                ? /* Selection is never colour alone here either: the chip changes
                     ground, weight *and* text colour, and carries `aria-current`.
                     `.ui-chip` carries the 44px touch floor, the way `.ui-tab`
                     does for the strip variant — see globals.css. */
                  `ui-chip ui-ring ui-interactive flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-ui-md px-2.5 text-ui-compact ${
                    active
                      ? "bg-ui-surface-3 font-semibold text-ui-fg"
                      : "text-ui-muted hover:bg-ui-surface-2 hover:text-ui-fg"
                  }`
                : "ui-tab ui-ring flex min-h-10 cursor-pointer items-center gap-1.5 rounded-t-ui-md px-2.5 text-ui-compact"
            }
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
  );

  if (!chips) {
    return (
      <nav aria-label={label} className="-mx-4 sm:-mx-6 xl:-mx-8">
        {strip}
      </nav>
    );
  }

  return (
    <nav aria-label={label} className="flex min-w-0 items-center gap-2">
      {/* `aria-hidden`, because the `nav` is already named by the same string and
          a screen reader would otherwise read it twice. It is on screen for the
          sighted reader, who has no other way to know what these pills scope. */}
      <span aria-hidden="true" className="shrink-0 text-ui-label text-ui-muted">
        {label}
      </span>
      {strip}
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
      /*
       * `.ui-ring-within`, not `focus-within:shadow-ui-sm`.
       *
       * The border and the focus both belong to this control and neither belongs
       * to the same element: the box is drawn here and the focus lands on the
       * `<input>` inside, whose own outline is suppressed by `outline-none`. This
       * used to answer that with the *popover* elevation token, so the panel's
       * search fields signalled focus with a soft drop shadow where §3.4
       * specifies an accent border and a 3px `--color-selection` ring — and §5
       * makes focus visibility a floor, not a preference. The utility is in
       * `globals.css` beside `.ui-ring` and `.ui-ring-peer`.
       */
      className="ui-interactive ui-ring-within flex min-w-0 flex-1 items-center gap-1.5 rounded-ui-md border border-ui-line-control bg-ui-surface ps-2.5 pe-1 sm:max-w-80"
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
           subtly different — it clears the field without submitting.

           `.ui-field` rather than `min-h-9`: identical at 36px on a pointer, so
           nothing moves, and 44px on touch — §5's floor, which this control had
           never met on any list in the panel. It is the one utility that exists
           to answer "which pointer is this person using", and hard-coding a
           height here was the same hole the retired iOS `Field` had. */
        className="ui-field min-w-0 flex-1 bg-transparent text-ui-compact text-ui-fg outline-none placeholder:text-ui-subtle [&::-webkit-search-cancel-button]:appearance-none"
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

/**
 * The row that holds search, the extra-filter trigger and the table controls.
 *
 * `align` was added on the payments branch, and it exists because a row of
 * *labelled* controls is a different box model from a row of bare ones. Every
 * filter row before it held only controls with no visible label — a `SearchField`
 * at 36px, a `Button` at 28 — so centring them was right. Payments puts a
 * `Select` and two `DateField`s in the same row, and `Form.tsx`'s `FieldFrame` is
 * a label over a control: 18px of label, a 6px gap, then the 36px box. Centred,
 * the search field floats in the middle of a 60px line while the pickers' boxes
 * sit at the bottom of it, so four controls that do the same job land on three
 * different baselines.
 *
 * `end` puts every control's own box on one line and lets the labels stack above
 * it. Below `sm` the row wraps to a column and the choice stops mattering, which
 * is why it is one prop rather than a responsive variant.
 *
 * ## `start`, added on the audit branch, because a **hint** breaks `end`
 *
 * `end` aligns the bottom of each item, which is the control's box only while
 * nothing hangs below it. `FieldFrame` renders help text *under* the control, so
 * a row mixing hinted and unhinted fields aligns the hint's last line with the
 * unhinted field's box — and the boxes, which are what the eye reads across,
 * land two or three lines apart. Measured on the trail's toolbar at 1440 in
 * French: six controls on **three** different label baselines, the date picker's
 * label sitting 36px above the resource picker's. That is precisely the defect
 * `end` was added to fix, arriving from the other side.
 *
 * `start` aligns the tops instead. Every field's label is one line and every
 * gap is `FieldFrame`'s, so the labels line up and the boxes line up with them;
 * the hints hang below at whatever length the reader's language gives them,
 * which is what a paragraph does.
 *
 * A `start` row's *unlabelled* controls — a clear button, `TableControls` — then
 * need to be pushed down to the boxes' line, which is `mt-6` at the call site:
 * `--text-ui-label`'s 1.125rem line box plus `FieldFrame`'s 0.375rem gap, both
 * off the spacing scale, so Arabic's 106.25% root scales the offset and the
 * label it clears by the same factor.
 */
export function FilterRow({
  children,
  align = "center",
}: {
  children: ReactNode;
  align?: "center" | "end" | "start";
}) {
  const ALIGN = {
    center: "items-center",
    end: "items-end",
    start: "items-start",
  } as const;

  return <div className={`flex flex-wrap gap-2 ${ALIGN[align]}`}>{children}</div>;
}
