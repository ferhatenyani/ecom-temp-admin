"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Sheet } from "@/components/primitives/Sheet";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";

/**
 * The filter surface: a scrolling row of pills that opens a sheet, and the
 * selected filters as removable chips above the list.
 *
 * Built on the existing `Sheet`, so it is a bottom sheet on a phone and a centred
 * modal at `md` — one presentation decision, made once, in CSS.
 *
 * The pills and the chips are deliberately **not** the same control. A pill opens
 * the sheet at a group and shows whether that group has a selection; a chip names
 * one active value and removes it. Collapsing them into one row was tried on
 * paper and fails the moment a group holds two values: `Matière: Laine, Argent`
 * either truncates or wraps, and neither can be dismissed by half.
 */

/* ----------------------------------------------------------------- pills --- */

export function FilterPills({ children }: { children: ReactNode }) {
  const t = useTranslations("products");
  return (
    <div
      role="group"
      aria-label={t("filters")}
      /*
        Horizontally scrolling at every width rather than wrapping at md. Nine
        filters wrapped to three rows push the list itself below the fold on a
        laptop, and a filter bar that costs a third of the viewport is a filter
        bar people collapse and forget.
      */
      className="pill-row -mb-1 flex gap-2 overflow-x-auto pb-1"
    >
      {children}
    </div>
  );
}

export function FilterPill({
  label,
  /** The active value, shown inside the pill. Absent means the group is unset. */
  value,
  onClick,
}: {
  label: string;
  value?: string;
  onClick: () => void;
}) {
  const active = value !== undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "press flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3",
        "text-subhead whitespace-nowrap",
        // Tonal fill for the active state, never a border that changes colour —
        // and never a leading bar.
        active ? "tone-accent tonal font-medium" : "bg-surface text-label-secondary",
      ].join(" ")}
    >
      <span>{label}</span>
      {active ? (
        <span className="max-w-32 truncate font-normal opacity-80">{value}</span>
      ) : null}
      <Icon name="chevron" className="size-3.5 shrink-0 rotate-90 opacity-60" />
    </button>
  );
}

/** The pill that opens the whole sheet, with a count of what is set. */
export function FilterAllPill({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const t = useTranslations("products");

  return (
    <button
      type="button"
      onClick={onClick}
      /*
        No `aria-label`. The visible text already names the control, and an
        override would replace it in the accessibility tree — a screen-reader user
        would hear "Ouvrir les filtres" where a sighted one reads "Filtres 3",
        losing the count and breaking the match between a spoken name and a
        visible one that voice control depends on.
      */
      className={[
        "press flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3",
        "text-subhead whitespace-nowrap",
        count > 0 ? "tone-accent tonal font-medium" : "bg-surface text-label-secondary",
      ].join(" ")}
    >
      <Icon name="filter" className="size-4 shrink-0" />
      <span>{t("filters")}</span>
      {count > 0 ? (
        <Ltr numeric className="tabular-nums">
          {count}
        </Ltr>
      ) : null}
    </button>
  );
}

/* ----------------------------------------------------------------- chips --- */

/**
 * The selected filters, above the list.
 *
 * Each chip is one value with its own remove button — a screen reader hears
 * "Retirer Matière : Laine", not "bouton". The group has a live region because
 * removing a chip changes the result count, and a change nobody announces is a
 * change a screen-reader user cannot observe.
 */
export function FilterChips({
  chips,
  onClearAll,
}: {
  chips: { key: string; label: string; value: string; onRemove: () => void }[];
  onClearAll: () => void;
}) {
  const t = useTranslations("products");

  if (chips.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="tone-accent tonal flex min-h-8 items-center gap-1 rounded-full ps-3 pe-1 text-footnote"
        >
          <span className="min-w-0 max-w-48 truncate">
            {chip.label} : {chip.value}
          </span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={t("removeFilter", { filter: `${chip.label} : ${chip.value}` })}
            className="press flex size-6 shrink-0 items-center justify-center rounded-full"
          >
            <Icon name="close" className="size-3.5" />
          </button>
        </span>
      ))}
      {chips.length > 1 ? (
        <button
          type="button"
          onClick={onClearAll}
          className="press min-h-8 rounded-full px-2 text-footnote text-accent"
        >
          {t("clearFilters")}
        </button>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- sheet --- */

/**
 * The apply button says "Appliquer" and not "Voir les 12 produits".
 *
 * A count on that button would have to be the *draft's* count, and the draft has
 * not been sent — the API is the only thing that knows how many rows a filter
 * combination returns, and guessing from the page in hand would put a number on
 * screen that the next request contradicts. Better a verb than a wrong number.
 */
export function FilterSheet({
  open,
  onOpenChange,
  onApply,
  onClear,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
  onClear: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("products");

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("filtersTitle")}
      footer={
        <div className="flex items-center gap-3">
          <Button variant="plain" onClick={onClear}>
            {t("clearFilters")}
          </Button>
          <Button fullWidth onClick={onApply} className="flex-1">
            {t("apply")}
          </Button>
        </div>
      }
    >
      {children}
    </Sheet>
  );
}

/**
 * One group inside the sheet: a title, an optional footnote, and the values.
 *
 * The footnote is where a truncation notice goes — "50 sur 128". A bounded list
 * that does not say so reads as a complete one, which is the specific way a facet
 * cap misleads.
 */
export function FilterGroup({
  title,
  footnote,
  children,
}: {
  title: string;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-headline text-label">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
      {footnote ? (
        <p className="mt-2 text-footnote text-label-secondary">{footnote}</p>
      ) : null}
    </section>
  );
}

/**
 * A selectable value with its count.
 *
 * **A zero-count value is rendered, dimmed, and still selectable.** It is not
 * disabled: with `?category=16` active the API stops counting the other
 * categories entirely, so a zero can mean "none here" or "not counted", and
 * disabling on that basis would lock a person inside their current filter. The
 * count is the information; the enabling is not conditional on it.
 */
export function FilterValue({
  label,
  count,
  selected,
  onToggle,
}: {
  label: string;
  /**
   * `null` where the API publishes no count for this dimension — `status`,
   * `on_sale` and `featured` are filters and not facets. A number invented from
   * the twenty rows in hand would be presented as if it covered all twenty-eight,
   * so the space stays empty instead.
   */
  count: number | null;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={[
        "press flex min-h-9 items-center gap-1.5 rounded-full px-3 text-subhead",
        selected
          ? "tone-accent tonal font-medium"
          : count === 0
            ? "bg-surface text-label-tertiary"
            : "bg-surface text-label",
      ].join(" ")}
    >
      {selected ? <Icon name="check" className="size-3.5 shrink-0" /> : null}
      <span className="max-w-44 truncate">{label}</span>
      {count !== null ? (
        <Ltr numeric className="text-caption opacity-60">
          {count}
        </Ltr>
      ) : null}
    </button>
  );
}
