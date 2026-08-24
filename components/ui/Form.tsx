"use client";

import { useId, type ReactNode } from "react";

/**
 * The form controls. See DESIGN.md §3.4.
 *
 * These are the shapes a filter panel and a settings form both need — a bordered
 * section, a checkable row, a single-select group and a text field — written once
 * so the next screen inherits them instead of hand-rolling a fourth set. They
 * replace `FilterGroup`/`FilterValue` from `components/patterns/FilterSheet.tsx`
 * and `TextField`/`DecimalField` from `components/primitives/Field.tsx`, both of
 * which draw iOS inset rows.
 *
 * Every one of them is a **real** control: a real `<input type="checkbox">`, a
 * real radio group, a real labelled `<input>`. The old pair used
 * `<button role="checkbox">`, which announces correctly and then behaves like
 * neither — no space-to-toggle from the browser, no form association, and a
 * `name`-grouped radio's arrow keys have to be re-implemented by hand.
 */

/**
 * A bordered group with a heading. DESIGN.md §3.4's "grouped in bordered
 * sections", and the unit filter panels and forms both stack.
 *
 * **The heading is `--text-subheading`, not the `--text-heading` §3.4 asked
 * for**, and that is a correction rather than a shortcut: `--text-heading` is
 * exactly the size `OverlayFrame` gives a Modal's or a Drawer's own title, so a
 * section inside one of those would render its heading at the same weight and
 * size as the title above it and flatten the hierarchy the section exists to
 * create. DESIGN.md §3.4 carries the amendment.
 */
export function Section({
  title,
  description,
  /** A measured caveat under the group — a truncation notice, a real range. */
  footnote,
  children,
}: {
  title: string;
  description?: string;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-ui-lg border border-ui-line p-3">
      <h3 className="text-ui-subheading text-ui-fg">{title}</h3>
      {description ? (
        <p className="mt-0.5 text-ui-label text-ui-muted">{description}</p>
      ) : null}
      <div className="mt-2 flex flex-col gap-1">{children}</div>
      {footnote ? (
        <p className="mt-2 text-ui-label text-ui-subtle">{footnote}</p>
      ) : null}
    </section>
  );
}

/**
 * The shared row geometry. 36px on a pointer and 44px on touch, from `.ui-tap`'s
 * own media query rather than from a second size prop the caller has to choose.
 */
const ROW =
  "ui-interactive ui-hover-fill relative flex min-h-9 cursor-pointer items-center gap-2.5 rounded-ui-md px-2 text-ui-compact text-ui-fg";

/**
 * The drawn box beside a real input. The input itself is `opacity-0` and
 * stretched over the row rather than `sr-only`, for the reason `DataTable`'s
 * checkbox records: an `sr-only` input is a 1px box in the corner of its label,
 * so a pointer can only reach it through the label and `page.check()` reports
 * the visible span as intercepting pointer events.
 */
function Box({
  checked,
  round,
}: {
  checked: boolean;
  round: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`ui-interactive ui-ring-peer flex size-4 shrink-0 items-center justify-center border ${
        round ? "rounded-full" : "rounded-ui-sm"
      } ${
        checked
          ? "border-ui-fg bg-ui-fg text-ui-surface"
          : "border-ui-line-control bg-ui-surface"
      }`}
    >
      {checked ? (
        round ? (
          <span className="size-1.5 rounded-full bg-ui-surface" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        )
      ) : null}
    </span>
  );
}

/**
 * One checkable value, with the count of records carrying it.
 *
 * The count sits **inside the label**, so it is part of the control's accessible
 * name — "Cuir 0" — rather than beside it where a screen reader would never
 * reach it. A zero is rendered, never hidden: a facet omits its zero-count
 * values and the panel puts them back, because a value that disappears when you
 * select its sibling is a dead end.
 */
export function CheckRow({
  checked,
  onChange,
  label,
  count,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** `null` for a dimension the API does not count — a flag, a boolean. */
  count?: number | null;
}) {
  return (
    <label className={ROW}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 z-10 cursor-pointer opacity-0"
      />
      <Box checked={checked} round={false} />
      <span dir="auto" className="min-w-0 flex-1 truncate">
        {label}
      </span>
      {typeof count === "number" ? (
        <span data-numeric="" className="shrink-0 text-ui-caption text-ui-subtle">
          {count}
        </span>
      ) : null}
    </label>
  );
}

/**
 * A single-select group, built from real radios sharing a generated `name` —
 * which is what gives it arrow-key navigation, roving tab order and one tab stop
 * for the whole group, none of which a row of buttons has.
 *
 * The empty-string option is how a single-select filter is cleared. A radio
 * cannot be unchecked by clicking it again, so "all" has to be a value rather
 * than an absence, and the caller supplies its label.
 */
export function ChoiceGroup({
  label,
  value,
  options,
  onChange,
}: {
  /** Names the group for a screen reader. Usually the `Section`'s own title. */
  label: string;
  value: string;
  options: { value: string; label: string; count?: number | null }[];
  onChange: (next: string) => void;
}) {
  const name = useId();

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label key={option.value || "all"} className={ROW}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="peer absolute inset-0 z-10 cursor-pointer opacity-0"
            />
            <Box checked={checked} round />
            <span dir="auto" className="min-w-0 flex-1 truncate">
              {option.label}
            </span>
            {typeof option.count === "number" ? (
              <span
                data-numeric=""
                className="shrink-0 text-ui-caption text-ui-subtle"
              >
                {option.count}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

/**
 * A decimal field: a decimal string in, a decimal string out, never a `number`.
 *
 * `type="text"` with `inputMode="decimal"` rather than `type="number"`, and the
 * reason survives from `DecimalField`: a number input silently drops what it
 * cannot parse, and the API's own validation ("Must be a number.", "min_price
 * must be numeric") is the thing the panel is meant to surface. Swallowing the
 * bad value locally means the person never learns which character was wrong.
 *
 * `dir="ltr"` and `data-numeric`, because a price is an identifier-shaped run of
 * digits and must not be reordered by the Arabic paragraph around it.
 */
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-ui-label text-ui-fg">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        dir="ltr"
        data-numeric=""
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? hintId : undefined}
        style={{ unicodeBidi: "isolate" }}
        className="ui-ring ui-interactive min-h-9 w-full rounded-ui-md border border-ui-line-control bg-ui-surface px-2.5 text-start text-ui-body text-ui-fg outline-none placeholder:text-ui-subtle"
      />
      {hint ? (
        <p id={hintId} className="text-ui-label text-ui-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
