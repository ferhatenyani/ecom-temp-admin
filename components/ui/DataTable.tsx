"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";
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

/** The column picker and density switch, as one control cluster. */
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
    <div className="flex shrink-0 items-center gap-2">
      <Popover
        open={densityOpen}
        onOpenChange={setDensityOpen}
        title={t("density")}
        trigger={
          <Button variant="secondary" size="sm" icon="density" iconEnd="chevron">
            <span className="hidden sm:inline">{t("density")}</span>
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
            <span className="hidden sm:inline">{t("columns")}</span>
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

  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <thead>
          <tr>
            {selectable ? (
              <th scope="col" className="ui-th w-10 ps-4 pe-1">
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

            {columns.map((column) => {
              /* Guarded on `column.sortKey` too, not just on `sort`: an
                 unsortable column has `sortKey === undefined`, and with no sort
                 applied `sort?.key` is also undefined — so the loose comparison
                 would mark every plain column as sorted. */
              const sorted =
                column.sortKey && sort?.key === column.sortKey ? sort.direction : null;
              const alignEnd = column.align === "end";
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sortKey
                      ? sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                  className={`ui-th px-3 py-2.5 text-ui-overline text-ui-muted uppercase ${
                    alignEnd ? "text-end" : "text-start"
                  } ${column.width ?? ""}`}
                >
                  {column.sortKey && onSortChange ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSortChange(
                          sorted === "asc"
                            ? { key: column.sortKey!, direction: "desc" }
                            : sorted === "desc"
                              ? null
                              : { key: column.sortKey!, direction: "asc" },
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
                    className={`ui-td ps-4 pe-1 ${CONTROL_PAD[density]}`}
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
                      } ${index === 0 ? "font-medium text-ui-fg" : "text-ui-muted"}`}
                    >
                      {content}
                    </Cell>
                  );
                })}

                {rowActions ? (
                  <td
                    className={`ui-td px-1 ${CONTROL_PAD[density]}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {rowActions(row)}
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
        className={`ui-interactive flex size-4 shrink-0 items-center justify-center rounded-ui-sm border peer-focus-visible:border-ui-accent peer-focus-visible:shadow-ui-sm ${
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
          <span className="px-1 text-ui-label text-ui-muted" data-numeric="">
            {t("pageOf", { page, pages })}
          </span>
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
