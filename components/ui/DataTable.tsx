"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { Button, IconButton } from "./Button";
import { Popover, FloatGroup, FloatToggle, FloatRadio } from "./Float";
import { CountBadge } from "./Badge";
import { useStored, writeStored } from "@/lib/stored";

/**
 * The data table, and its narrow-viewport counterpart. See DESIGN.md §3.2.
 *
 * One column definition drives both presentations. That is the whole point of
 * the component: a page declares its columns once, and gets a real `<table>`
 * with a sticky header at `md` and up, and a stacked record list below — rather
 * than two hand-maintained renderings that drift apart by the third screen.
 *
 * It replaces `GroupedList`, which rendered iOS inset rows at every width. On a
 * 1920px monitor that was a 768px column of phone rows; below `md` it was fine,
 * which is exactly why it survived so long.
 */

export type Column<T> = {
  key: string;
  /** Column header. Rendered uppercase at 11px in the table head. */
  header: string;
  /** Cell content for the table presentation. */
  cell: (row: T) => ReactNode;
  /** Numbers align to the end and carry tabular figures. */
  align?: "start" | "end";
  /** Sort key sent to the API. Omit for a column the API cannot sort. */
  sortKey?: string;
  /**
   * Which directions this column's header cycles through, in order. Defaults to
   * both, ascending first — `none → asc → desc → none`.
   *
   * It exists because "the API sorts this column" and "the API sorts this column
   * *both ways*" are different facts, and this one has been measured to differ.
   * On `/products`, `title asc` is honoured and `title desc` was never measured
   * at all: it is accepted with a 200 and comes back in default order. A header
   * that cycled to descending would look like it worked and silently would not,
   * which is the exact failure mode the sort controls were withheld for on the
   * orders list.
   *
   * So a caller names the directions it has evidence for. `["asc"]` gives a
   * header that goes `none → ascending → none` and never claims the third state;
   * `["desc", "asc"]` starts a date column at newest-first, which is where its
   * resting order already is.
   */
  sortDirections?: readonly ("asc" | "desc")[];
  /** Hidden by default; revealed through the column picker. */
  optional?: boolean;
  /** Never hideable — the identifier column. */
  required?: boolean;
  /** Tailwind width class. Omit to let the column size to its content. */
  width?: string;
};

export type Density = "comfortable" | "compact";

/*
 * Row padding per density. The skeleton uses the same two values, so switching
 * density cannot desynchronise the placeholder from the real row.
 *
 * Control cells — the checkbox and the row-actions menu — get their own, and
 * that is a measurement rather than a preference. A `size-7` icon button is
 * 28px tall; at `py-3.5` its cell wanted 28 + 28 + 1 = 57px while the text
 * cells wanted 20 + 28 + 1 = 49, so the button alone made every comfortable row
 * eight pixels taller than the design says. Padding the control cells to match
 * the *text* cells' total height puts the row back at 48–49px.
 */
const ROW_PAD: Record<Density, string> = {
  comfortable: "py-3.5",
  compact: "py-2.5",
};

const CONTROL_PAD: Record<Density, string> = {
  comfortable: "py-2.5",
  compact: "py-1.5",
};

/**
 * Column visibility and density, persisted per table.
 *
 * Keyed by a `tableId` so Orders and Products do not share one preference —
 * and read in an effect rather than during render, because `localStorage` does
 * not exist on the server and reading it during render is a hydration mismatch.
 */
export type TablePreferences = {
  visible: string[];
  setVisible: (next: string[]) => void;
  density: Density;
  setDensity: (next: Density) => void;
};

export function useTablePreferences<T>(
  tableId: string,
  columns: Column<T>[],
): TablePreferences {
  const rawCols = useStored(`ac-table-${tableId}-cols`);
  const rawDensity = useStored(`ac-table-${tableId}-density`);

  const visible = useMemo(() => {
    const defaults = columns.filter((c) => !c.optional).map((c) => c.key);
    if (rawCols === null) return defaults;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawCols);
    } catch {
      /* A hand-edited or truncated value is not worth failing a table over. */
      return defaults;
    }
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
      return defaults;
    }

    /* Intersected with the columns that actually exist, so a preference stored
       by an older build cannot resurrect a removed column — and unioned with
       the required ones, so it cannot hide a newly required one either. */
    const known = new Set(columns.map((c) => c.key));
    const required = columns.filter((c) => c.required).map((c) => c.key);
    const kept = (parsed as string[]).filter((k) => known.has(k));
    const merged = [...new Set([...required, ...kept])];
    /* Preserve the declared column order rather than the stored order, so
       toggling a column back on returns it to its proper place. */
    return columns.filter((c) => merged.includes(c.key)).map((c) => c.key);
  }, [rawCols, columns]);

  const density: Density = rawDensity === "compact" ? "compact" : "comfortable";

  return {
    visible,
    setVisible: (next) =>
      writeStored(`ac-table-${tableId}-cols`, JSON.stringify(next)),
    density,
    setDensity: (next) => writeStored(`ac-table-${tableId}-density`, next),
  };
}

/**
 * The column picker and density switch, as one control cluster.
 *
 * **It does not render below `md`, and that is the point of putting the
 * breakpoint here rather than at each call site.** Both controls change the
 * *table*: `visible` decides which columns `<Table>` draws and `density` picks
 * its row padding. Below `md` the table is `hidden` and `RecordList` is what a
 * person is looking at — and `RecordList` takes neither prop. Its three lines are
 * chosen in the page's `record()` and its rows are one height.
 *
 * So on a phone these were two buttons, each opening a popover, each toggling a
 * stored preference that changed nothing on screen. That is precisely the defect
 * this redesign exists to stamp out — the reason the orders list ships no sort
 * control at all is that a control which silently does nothing is worse than no
 * control — and two of them were sitting in the toolbar of both migrated screens.
 *
 * The preference itself still persists: someone who set "compact" on a laptop
 * still gets compact rows there after visiting on a phone. Only the control is
 * withheld, at the width where it has nothing to act on.
 */
export function TableControls<T>({
  columns,
  visible,
  onVisibleChange,
  density,
  onDensityChange,
}: {
  columns: Column<T>[];
  visible: string[];
  onVisibleChange: (next: string[]) => void;
  density: Density;
  onDensityChange: (next: Density) => void;
}) {
  const t = useTranslations("ui.table");
  const [colsOpen, setColsOpen] = useState(false);
  const [densityOpen, setDensityOpen] = useState(false);

  return (
    <div className="hidden shrink-0 items-center gap-2 md:flex">
      <Popover
        open={densityOpen}
        onOpenChange={setDensityOpen}
        title={t("density")}
        trigger={
          <Button variant="secondary" size="sm" icon="density" iconEnd="chevron">
            {t("density")}
          </Button>
        }
      >
        <FloatGroup label={t("density")}>
          <FloatRadio
            checked={density === "comfortable"}
            onSelect={() => {
              onDensityChange("comfortable");
              setDensityOpen(false);
            }}
          >
            {t("comfortable")}
          </FloatRadio>
          <FloatRadio
            checked={density === "compact"}
            onSelect={() => {
              onDensityChange("compact");
              setDensityOpen(false);
            }}
          >
            {t("compact")}
          </FloatRadio>
        </FloatGroup>
      </Popover>

      <Popover
        open={colsOpen}
        onOpenChange={setColsOpen}
        title={t("columns")}
        trigger={
          <Button variant="secondary" size="sm" icon="columns" iconEnd="chevron">
            {t("columns")}
          </Button>
        }
      >
        <FloatGroup label={t("columns")}>
          {columns.map((column) => {
            const on = visible.includes(column.key);
            /* The last visible column cannot be hidden — a table with no
               columns is a component with no purpose, and it is not
               recoverable from the UI once it happens. */
            const lastOne = on && visible.length === 1;
            return (
              <FloatToggle
                key={column.key}
                checked={on}
                disabled={column.required || lastOne}
                onChange={(next) =>
                  onVisibleChange(
                    next
                      ? [...visible, column.key]
                      : visible.filter((k) => k !== column.key),
                  )
                }
              >
                {column.header}
              </FloatToggle>
            );
          })}
        </FloatGroup>
      </Popover>
    </div>
  );
}

export type SortState = { key: string; direction: "asc" | "desc" } | null;

const BOTH_DIRECTIONS = ["asc", "desc"] as const;

/**
 * The next sort state for a header click.
 *
 * A column's `sortDirections` is the whole cycle: the current direction's
 * position in that list decides what comes next, and running off the end is
 * "unsorted". An unsorted column starts at index -1, so the first click lands on
 * the list's first entry — which is why a date column declaring
 * `["desc", "asc"]` opens at newest-first rather than at oldest.
 *
 * A stored direction the list does not contain — a stale URL, a column whose
 * evidence has since narrowed — also reads as -1 and restarts the cycle rather
 * than sending a combination nobody measured.
 */
function nextSort(
  key: string,
  directions: readonly ("asc" | "desc")[] = BOTH_DIRECTIONS,
  current: "asc" | "desc" | null,
): SortState {
  const index = current === null ? -1 : directions.indexOf(current);
  const next = directions[index + 1];
  return next === undefined ? null : { key, direction: next };
}

/**
 * The table itself. `md` and up.
 *
 * Rendered inside `.ui-table-scroll` so a table with more columns than room
 * scrolls **itself** — the page never scrolls horizontally, which is the 340px
 * rule and also just correct at 1024px with eight columns.
 */
function Table<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  rowLabel,
  density,
  sort,
  onSortChange,
  selectable,
  selected,
  onSelectedChange,
  rowActions,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowLabel: (row: T) => string;
  density: Density;
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
  selectable?: boolean;
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  rowActions?: (row: T) => ReactNode;
}) {
  const t = useTranslations("ui.table");
  const allKeys = rows.map(rowKey);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.includes(k));
  const someSelected = allKeys.some((k) => selected.includes(k));

  /*
   * Where the identifying column's frozen edge sits — see `.ui-col-sticky`.
   *
   * `start-10` against the checkbox column's `w-10`: the same spacing step, so
   * the two edges abut by construction rather than by a measured pixel someone
   * has to keep in sync. Both are `--spacing`-derived, so Arabic's 106.25% root
   * scales the offset and the column it clears by the same factor.
   *
   * That is also why the checkbox header carries `min-w-10` as well as `w-10`,
   * which is load-bearing rather than belt-and-braces. In an auto-layout table a
   * `width` is a *preference*, and once the table overflows — which is precisely
   * when a frozen column matters — Chromium collapses that column to its 36px
   * min-content. Measured at 768: the checkbox cell was 36.0px wide while the
   * name column froze at 40, so four pixels of scrolled row showed through
   * between them. A `min-width` is a floor and is honoured; both now measure
   * 40.0px in French and 42.5px in Arabic, which is the same 2.5rem.
   *
   * With selection off there is nothing in front of it and it freezes at 0.
   */
  const identityStart = selectable ? "start-10" : "start-0";

  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <thead>
          <tr>
            {selectable ? (
              <th
                scope="col"
                className="ui-th ui-col-sticky start-0 w-10 min-w-10 ps-4 pe-1"
              >
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  label={allSelected ? t("deselectAll") : t("selectAll")}
                  onChange={(next) =>
                    onSelectedChange(
                      next
                        ? [...new Set([...selected, ...allKeys])]
                        : selected.filter((k) => !allKeys.includes(k)),
                    )
                  }
                />
              </th>
            ) : null}

            {columns.map((column, index) => {
              /* Guarded on `column.sortKey` too, not just on `sort`: an
                 unsortable column has `sortKey === undefined`, and with no sort
                 applied `sort?.key` is also undefined — so the loose comparison
                 would mark every plain column as sorted. */
              const sorted =
                column.sortKey && sort?.key === column.sortKey ? sort.direction : null;
              /*
               * Sortable means *this table* can sort it, not merely that the
               * column knows a key. `aria-sort` is the same claim as the button,
               * so it is gated on the same condition.
               *
               * Measured on the orders list, which declares `sortKey` on three
               * columns and passes no `onSortChange` — deliberately, because the
               * API's `orderby` was never verified for orders. Those three
               * headers rendered no button and still announced
               * `aria-sort="none"`, which in ARIA means "sortable, currently
               * unsorted": the table told a screen-reader user it could be sorted
               * by columns nothing on screen can sort.
               */
              const sortable = Boolean(column.sortKey && onSortChange);
              const alignEnd = column.align === "end";
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sortable
                      ? sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                  /* The uppercase lives on `.ui-th` in globals.css, not on a
                     utility here — a `<button>` inside this cell does not
                     inherit `text-transform` and the rule has to reach it. */
                  className={`ui-th px-3 py-2.5 text-ui-overline text-ui-muted ${
                    alignEnd ? "text-end" : "text-start"
                  } ${index === 0 ? `ui-col-sticky ${identityStart}` : ""} ${
                    column.width ?? ""
                  }`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() =>
                        /* The cycle walks the column's own direction list and
                           falls off the end into `null`. With the default list
                           that is the familiar none → asc → desc → none; with a
                           one-entry list the third state simply does not exist,
                           and `aria-sort` goes ascending → none. */
                        /* `?.` only because `sortable` is a boolean and does not
                           narrow the prop for TypeScript; it is always defined
                           here by construction. */
                        onSortChange?.(
                          nextSort(column.sortKey!, column.sortDirections, sorted),
                        )
                      }
                      className={`ui-ring ui-interactive inline-flex cursor-pointer items-center gap-1 rounded-ui-sm hover:text-ui-fg ${
                        alignEnd ? "flex-row-reverse" : ""
                      } ${sorted ? "text-ui-fg" : ""}`}
                    >
                      <span>{column.header}</span>
                      {sorted ? (
                        <Icon
                          name={sorted === "asc" ? "sortAsc" : "sortDesc"}
                          className="size-3"
                        />
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}

            {rowActions ? (
              <th scope="col" className="ui-th w-10 px-1">
                <span className="sr-only">{t("actions")}</span>
              </th>
            ) : null}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const isSelected = selected.includes(key);
            return (
              <tr
                key={key}
                data-hoverable={onRowClick ? "" : undefined}
                data-selected={isSelected ? "true" : undefined}
                className={onRowClick ? "cursor-pointer" : ""}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {selectable ? (
                  /* The checkbox cell stops propagation so ticking a row does
                     not also open it. */
                  <td
                    className={`ui-td ui-col-sticky start-0 ps-4 pe-1 ${CONTROL_PAD[density]}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      checked={isSelected}
                      label={rowLabel(row)}
                      onChange={(next) =>
                        onSelectedChange(
                          next ? [...selected, key] : selected.filter((k) => k !== key),
                        )
                      }
                    />
                  </td>
                ) : null}

                {columns.map((column, index) => {
                  const alignEnd = column.align === "end";
                  const content = column.cell(row);
                  /* The first column is the row's own heading, which is what
                     lets a screen reader announce "row 4, order 10482" rather
                     than reading six unlabelled cells. */
                  const Cell = index === 0 && !column.align ? "th" : "td";
                  return (
                    <Cell
                      key={column.key}
                      {...(Cell === "th" ? { scope: "row" as const } : {})}
                      className={`ui-td px-3 text-ui-compact ${ROW_PAD[density]} ${
                        alignEnd ? "text-end" : "text-start"
                      } ${
                        index === 0
                          ? `ui-col-sticky ${identityStart} font-medium text-ui-fg`
                          : "text-ui-muted"
                      }`}
                    >
                      {/*
                       * Every cell's content is a flex box, and that is what
                       * makes the row height a number rather than a font
                       * accident.
                       *
                       * Left as inline content, a cell's height is its *line
                       * box*, which is the union of the text's own ascent and
                       * descent with the baseline of whatever inline-level thing
                       * a column happens to render. A status badge is 11px text
                       * in a 20px box, a leading dot is an empty inline-block
                       * whose synthesised baseline is its bottom edge — each one
                       * hangs a little below the text's baseline and stretches
                       * the line box. Measured on this screen: 20px of content
                       * produced a 22px line box, so every row with a badge or a
                       * dot in it stood 51px against the 48px DESIGN.md §1.4
                       * specifies and the 49px `TableSkeleton` draws. Compounded
                       * over eight skeleton rows that is 16px of shift the
                       * moment data lands.
                       *
                       * Flex items contribute their height and no baseline, so
                       * the cell is exactly as tall as its tallest child, in
                       * every column and on every screen. `justify-end` replaces
                       * `text-end` for the same reason it has to: text alignment
                       * does not reach a flex line.
                       */}
                      <span
                        className={`flex min-w-0 items-center ${
                          alignEnd ? "justify-end" : ""
                        }`}
                      >
                        {content}
                      </span>
                    </Cell>
                  );
                })}

                {rowActions ? (
                  <td
                    className={`ui-td px-1 ${CONTROL_PAD[density]}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {/*
                     * A flex wrapper, and it is what makes the row height
                     * deterministic rather than a cosmetic nicety.
                     *
                     * The actions trigger is a 28px `inline-flex` whose only
                     * child is an `<svg>` — no in-flow text, so the flex box has
                     * no baseline to expose and the browser synthesises one at
                     * its bottom margin edge. Left inline, it therefore sat
                     * entirely *above* the cell's baseline and dragged the line
                     * box to 30px, making every row in the panel 50.4px against
                     * the 48px DESIGN.md §1.4 specifies and the 49px
                     * `TableSkeleton` draws. As a flex item it contributes its
                     * height and nothing else.
                     */}
                    <div className="flex items-center justify-center">
                      {rowActions(row)}
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A checkbox drawn from a real `<input type="checkbox">` behind a styled box.
 *
 * The input is `opacity-0` and stretched over the label rather than `sr-only`,
 * and that is a deliberate departure from the pattern the rest of this repo
 * uses. An `sr-only` input is a 1px box at the corner of its label: a pointer
 * reaches it only through the label, so `page.check()` reports the visual span
 * as "intercepting pointer events" and times out. Three existing test suites
 * carry a comment explaining that workaround. Stretching the input costs
 * nothing — it is still a real checkbox with a real accessible name, `peer`
 * still drives the focus ring — and it removes the workaround.
 *
 * `indeterminate` is a DOM property rather than an attribute, so it can only be
 * set through a ref.
 */
function Checkbox({
  checked,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="ui-tap relative flex cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        ref={(node) => {
          if (node) node.indeterminate = indeterminate;
        }}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 z-10 cursor-pointer opacity-0"
      />
      <span
        aria-hidden="true"
        className={`ui-interactive ui-ring-peer flex size-4 shrink-0 items-center justify-center rounded-ui-sm border ${
          checked || indeterminate
            ? "border-ui-fg bg-ui-fg text-ui-surface"
            : "border-ui-line-control bg-ui-surface"
        }`}
      >
        {indeterminate ? (
          <svg viewBox="0 0 24 24" className="size-3" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round">
            <path d="M6 12h12" />
          </svg>
        ) : checked ? (
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        ) : null}
      </span>
    </label>
  );
}

/**
 * The stacked presentation, below `md`. Three lines, chosen by the caller —
 * not the table squeezed, and not the old grouped inset list.
 */
function RecordList<T>({
  rows,
  rowKey,
  rowLabel,
  onRowClick,
  record,
  rowActions,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  rowLabel: (row: T) => string;
  onRowClick?: (row: T) => void;
  record: (row: T) => { primary: ReactNode; secondary: ReactNode; meta: ReactNode };
  rowActions?: (row: T) => ReactNode;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const { primary, secondary, meta } = record(row);
        return (
          <li key={rowKey(row)} className="ui-card relative">
            <div className="flex items-start gap-1 p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">{primary}</div>
                <div className="flex min-w-0 items-center gap-2 text-ui-compact text-ui-muted">
                  {secondary}
                </div>
                <div className="flex min-w-0 items-center gap-2 text-ui-label text-ui-subtle">
                  {meta}
                </div>
              </div>
              {rowActions ? <div className="shrink-0">{rowActions(row)}</div> : null}
            </div>

            {/*
              A stretched overlay link rather than wrapping the card in an <a>.
              Wrapping puts the row-actions button inside the link, which is
              invalid HTML and makes the menu unreachable by keyboard.
            */}
            {onRowClick ? (
              <button
                type="button"
                aria-label={rowLabel(row)}
                onClick={() => onRowClick(row)}
                className="ui-ring absolute inset-0 cursor-pointer rounded-ui-lg"
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The selection action bar.
 *
 * It sits **above** the column header rather than replacing it, and that is a
 * change from the first draft, which said "replaces the header in place, no
 * shift". Replacing avoids a one-time 44px shift but takes the column labels
 * away exactly when someone is reading down a column deciding what to tick.
 * Keeping them is worth the shift; the shift happens once, at the first tick,
 * and reverses when the selection clears.
 */
function SelectionBar({
  count,
  onClear,
  actions,
}: {
  count: number;
  onClear: () => void;
  actions?: ReactNode;
}) {
  const t = useTranslations("ui.table");
  return (
    <div
      role="status"
      className="flex min-h-11 flex-wrap items-center gap-2 border-b border-ui-line-strong bg-ui-surface-2 px-3 py-1.5"
    >
      <span className="flex items-center gap-2 text-ui-compact text-ui-fg">
        <CountBadge>{count}</CountBadge>
        {t("selected", { count })}
      </span>
      <div className="ms-auto flex items-center gap-2">
        {actions}
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t("clearSelection")}
        </Button>
      </div>
    </div>
  );
}

/** The footer: range, per-page and the page stepper. */
export function TableFooter({
  page,
  perPage,
  total,
  onPageChange,
  onPerPageChange,
}: {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (next: number) => void;
  onPerPageChange: (next: number) => void;
}) {
  const t = useTranslations("ui.table");
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="flex flex-col gap-3 border-t border-ui-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-ui-label text-ui-muted" data-numeric="">
        {t("range", { from, to, total })}
      </p>

      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <label className="flex items-center gap-1.5 text-ui-label text-ui-muted">
          {t("rows")}
          <select
            value={perPage}
            onChange={(event) => onPerPageChange(Number(event.target.value))}
            className="ui-ring ui-interactive min-h-7 cursor-pointer rounded-ui-md border border-ui-line-control bg-ui-surface px-1.5 text-ui-label text-ui-fg"
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <IconButton
            label={t("previousPage")}
            icon="back"
            flipInRtl
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          />
          {/*
            **`Ltr`, and it is a bug fix rather than a precaution: in Arabic this
            rendered page 1 of 7 as "7 / 1".**

            `ui.table.pageOf` is `"{page} / {pages}"` in both locales, and the
            spaces around the slash break what would otherwise be one bidi number
            run — so the paragraph's RTL direction reorders the two numbers and
            the reader is told they are on the last page. It is a *wrong number*,
            not an ugly one, which is the same class of defect `DataRow`'s
            clipped money was.

            **It survived two branches because every Arabic list captured before
            this one had exactly one page**, and "1 / 1" is symmetric: the bug
            renders identically to the fix. `/products` in Arabic has been showing
            "2 / 1" for page 1 of 2 the whole time. Shipping is the run's first
            fixture with seven pages, which is the only reason anyone saw it.

            `Ltr` rather than `Isolate`: this is a pair of figures with a
            separator, not a translated sentence with a number in it, so it wants
            a forced direction and not merely an isolate. `data-numeric` moves on
            to it, since `Ltr` is what carries the tabular figures now.
          */}
          <Ltr className="px-1 text-ui-label text-ui-muted">
            {t("pageOf", { page, pages })}
          </Ltr>
          <IconButton
            label={t("nextPage")}
            icon="chevron"
            flipInRtl
            variant="secondary"
            size="sm"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The responsive wrapper — what a page actually renders.
 *
 * Both presentations are in the DOM and one is hidden per breakpoint, rather
 * than a `matchMedia` switch. That keeps the server and the client rendering
 * the same tree (no hydration mismatch) and means a resize is instant rather
 * than a re-render.
 */
export function DataTable<T>({
  preferences,
  rows,
  columns,
  rowKey,
  rowLabel,
  record,
  onRowClick,
  rowActions,
  sort,
  onSortChange,
  selectable = false,
  selectionActions,
  footer,
}: {
  /** From `useTablePreferences` — held by the page so it can place the controls. */
  preferences: TablePreferences;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** The row's accessible name — "Order number 10482". */
  rowLabel: (row: T) => string;
  /** The three lines shown below `md`. */
  record: (row: T) => { primary: ReactNode; secondary: ReactNode; meta: ReactNode };
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
  selectable?: boolean;
  /** Rendered in the selection bar. Receives the selected keys. */
  selectionActions?: (selected: string[]) => ReactNode;
  footer?: ReactNode;
}) {
  const prefs = preferences;
  const [selected, setSelected] = useState<string[]>([]);

  /*
   * Selection is cleared when the underlying rows change — keeping keys from a
   * previous filter means "3 selected" refers to rows no longer on screen, and
   * the export that follows silently includes them.
   *
   * Adjusted during render against a remembered signature rather than in an
   * effect. React documents this as the way to reset state when a prop changes,
   * and an effect here would render one frame with the stale selection bar
   * still showing a count for rows that are already gone.
   */
  const signature = rows.map(rowKey).join(",");
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setSelected([]);
  }

  const shown = columns.filter((c) => prefs.visible.includes(c.key));

  return (
    <div className="ui-card overflow-hidden">
        {selectable && selected.length > 0 ? (
          <SelectionBar
            count={selected.length}
            onClear={() => setSelected([])}
            actions={selectionActions?.(selected)}
          />
        ) : null}

        {/* The table: md and up. */}
        <div className="hidden md:block">
          <Table
            rows={rows}
            columns={shown}
            rowKey={rowKey}
            rowLabel={rowLabel}
            onRowClick={onRowClick}
            density={prefs.density}
            sort={sort}
            onSortChange={onSortChange}
            selectable={selectable}
            selected={selected}
            onSelectedChange={setSelected}
            rowActions={rowActions}
          />
        </div>

        {/* The record list: below md. Lives outside the card's own border, so
            it is pulled out of the padding the card would otherwise impose. */}
        <div className="p-2 md:hidden">
          <RecordList
            rows={rows}
            rowKey={rowKey}
            rowLabel={rowLabel}
            onRowClick={onRowClick}
            record={record}
            rowActions={rowActions}
          />
        </div>

      {footer}
    </div>
  );
}
