"use client";

import { useId, type ReactNode } from "react";
import { Icon } from "@/components/primitives/Icon";

/**
 * The form controls. See DESIGN.md §3.4.
 *
 * These are the shapes a filter panel and a settings form both need — a bordered
 * section, a checkable row, a single-select group, a text field, a text area, a
 * select and a switch — written once so the next screen inherits them instead of
 * hand-rolling a fourth set. They replace `FilterGroup`/`FilterValue` from
 * `components/patterns/FilterSheet.tsx` and `TextField`/`DecimalField` from
 * `components/primitives/Field.tsx`, both of which draw iOS inset rows.
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

/* ═══════════════════════════════════════════════════════ the labelled field ═══
 *
 * One frame — label above, control, then help text or an error — and four
 * controls hung off it. DESIGN.md §3.4 is a list of things that are easy to do
 * to *one* field and easy to forget on the ninth: the label is always visible
 * and is never a placeholder, the help text is written before the error rather
 * than as a consolation after it, the error carries an icon and is wired through
 * `aria-describedby`, and `aria-invalid` is set. Written once here, they cannot
 * be forgotten on the ninth.
 *
 * Help text and an error are **both** described, in that order, rather than the
 * error replacing the hint: the hint usually says what a valid value looks like,
 * which is the thing a person needs most at the moment they got it wrong.
 */

const CONTROL =
  "ui-ring ui-interactive min-h-9 w-full rounded-ui-md border bg-ui-surface px-2.5 py-1.5 text-start text-ui-body text-ui-fg outline-none placeholder:text-ui-subtle disabled:cursor-not-allowed disabled:opacity-50";

function borderFor(invalid: boolean): string {
  return invalid ? "border-ui-danger-fg" : "border-ui-line-control";
}

function FieldFrame({
  id,
  label,
  hint,
  hintId,
  error,
  errorId,
  className = "",
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  hintId: string;
  error?: string;
  errorId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-ui-label text-ui-fg">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-ui-label text-ui-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          className="flex items-start gap-1.5 text-ui-label text-ui-danger-fg"
        >
          <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The `aria-describedby` value for a field that may have both, or neither. */
function describedBy(hint: string | undefined, hintId: string, error: string | undefined, errorId: string) {
  const ids = [hint ? hintId : null, error ? errorId : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  disabled = false,
  /**
   * An identifier — a SKU, a price, a tracking number — rather than prose.
   *
   * Forces `dir="ltr"` and `unicode-bidi: isolate` on the input, for the reason
   * `components/primitives/Ltr.tsx` records at length: a run of digits typed into
   * an Arabic page is reordered by the bidi algorithm and the person reads back a
   * value they did not enter. Off by default, because a customer's name is not an
   * identifier and forcing LTR on one is the same bug from the other side.
   */
  isolate = false,
  inputMode,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  isolate?: boolean;
  inputMode?: "text" | "decimal" | "numeric" | "tel" | "email" | "search";
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
      className={className}
    >
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint, hintId, error, errorId)}
        {...(isolate
          ? { dir: "ltr" as const, "data-numeric": "", style: { unicodeBidi: "isolate" as const } }
          : {})}
        className={`${CONTROL} ${borderFor(Boolean(error))}`}
      />
    </FieldFrame>
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
 * `isolate`, because a price is an identifier-shaped run of digits and must not
 * be reordered by the Arabic paragraph around it.
 *
 * `flex-1` is its own, not the frame's: the price band renders two of these side
 * by side in a `flex-wrap` row and they have to share the width.
 */
export function NumberField(props: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
}) {
  return <TextField {...props} isolate inputMode="decimal" className="flex-1" />;
}

/**
 * A multi-line field.
 *
 * `counter` renders the length against its limit and is not decoration: the one
 * caller in this branch is a COD call reason the API caps at 500 characters and
 * refuses with a 400, so the limit has to be visible *before* the refusal rather
 * than surfaced as one. `maxLength` is deliberately not set on the element — a
 * hard cap silently truncates a paste and the person never learns why.
 */
export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  rows = 3,
  counter,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  rows?: number;
  counter?: { length: number; limit: number; label: string };
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
    >
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        dir="auto"
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint, hintId, error, errorId)}
        className={`${CONTROL} ${borderFor(Boolean(error))}`}
      />
      {counter ? (
        <p
          className={`text-ui-caption ${
            counter.length > counter.limit ? "text-ui-danger-fg" : "text-ui-subtle"
          }`}
        >
          {/* A live region would announce on every keystroke. The limit is in the
              hint above for a screen reader; this is the sighted person's gauge. */}
          <span data-numeric="">{counter.label}</span>
        </p>
      ) : null}
    </FieldFrame>
  );
}

/**
 * A single-select field — a real `<select>`.
 *
 * Not a Radix listbox, and that is a decision rather than an omission: a native
 * select is the one control a phone renders as a full-screen wheel with the
 * platform's own search, it needs no portal, no collision detection and no
 * keyboard re-implementation, and at 340px it is the only picker that cannot
 * open off the edge of the screen. `ChoiceGroup` above is what a *small* closed
 * set uses; this is for the 69-row wilaya list.
 */
export function Select({
  label,
  value,
  onChange,
  options,
  hint,
  error,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
    >
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint, hintId, error, errorId)}
        className={`${CONTROL} cursor-pointer ${borderFor(Boolean(error))}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

/**
 * A boolean, as a real `<input type="checkbox" role="switch">`.
 *
 * `role="switch"` rather than a bare checkbox because the two announce
 * differently and mean differently: a checkbox is *include this*, a switch is
 * *this is on now*. Cash on delivery being enabled on an order is a state, not a
 * selection, and it writes immediately rather than on a submit.
 *
 * The input is stretched over the row at `opacity-0` with the track drawn beside
 * it, the same arrangement `CheckRow` uses and for the same measured reason.
 */
export function Switch({
  label,
  checked,
  onChange,
  hint,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        className={`ui-interactive relative flex min-h-9 items-center gap-3 rounded-ui-md text-ui-compact text-ui-fg ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={hint ? hintId : undefined}
          className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span className="min-w-0 flex-1">{label}</span>
        <span
          aria-hidden="true"
          className={`ui-interactive ui-ring-peer flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 ${
            checked
              ? "justify-end border-ui-fg bg-ui-fg"
              : "justify-start border-ui-line-control bg-ui-surface-2"
          }`}
        >
          {/* `justify-*` rather than a translate, so the knob has one position per
              state and nothing to animate to the wrong end in RTL. */}
          <span
            className={`size-4 rounded-full ${
              checked ? "bg-ui-surface" : "bg-ui-line-control"
            }`}
          />
        </span>
      </label>
      {hint ? (
        <p id={hintId} className="text-ui-label text-ui-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
