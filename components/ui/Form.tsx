"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";
import { Button } from "@/components/ui/Button";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * The form layer. See DESIGN.md §3.4.
 *
 * These are the shapes a filter panel and a settings form both need — a bordered
 * section, a checkable row, a single-select group, a text field, a text area, a
 * date, a select, a switch, a read-only row, an error summary and a save bar —
 * written once so the next screen inherits them instead of hand-rolling a fourth
 * set. They replace `FilterGroup`/`FilterValue` from
 * `components/patterns/FilterSheet.tsx` and the whole of
 * `components/primitives/Field.tsx`, which draws iOS inset rows.
 *
 * Every one of them is a **real** control: a real `<input type="checkbox">`, a
 * real radio group, a real labelled `<input>`. The old pair used
 * `<button role="checkbox">`, which announces correctly and then behaves like
 * neither — no space-to-toggle from the browser, no form association, and a
 * `name`-grouped radio's arrow keys have to be re-implemented by hand.
 *
 * ## Everything here is inert until React has hydrated it
 *
 * A keystroke landing in the window between first paint and hydration changes
 * the DOM and never reaches React, so the value looks accepted, the form never
 * goes dirty and the save bar never appears. **Measured on WebKit, on the product
 * detail screen**, hidden by Chromium, and left unhandled for two branches while
 * `e2e/products.spec.ts` retried around it. `lib/use-hydrated.ts` carries the
 * full account; `components/primitives/Field.tsx` carried the guard, and it did
 * not survive the first draft of this file — which would have handed the defect
 * back to all forty-one screens of the redesign run.
 *
 * Refusing the keystroke is the point. The alternative — reading the DOM back on
 * mount and adopting whatever was typed — loses nothing and shows nothing, and a
 * window a person cannot see is a window they cannot work around. `disabled`
 * dims the control through the styling it already has, so it looks as
 * unavailable as it is, and it is the state a screen reader is told about.
 *
 * ## Timing is the layer's business, the rule is the screen's
 *
 * §3.4: "Validation on blur, then on every change once a field has errored.
 * Never on first keystroke." A screen that owns both halves gets the second one
 * wrong on the ninth field, so the split here is: the caller supplies a
 * `validate` predicate, and `useField` below decides *when* its verdict is
 * allowed on screen. See its docblock.
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
 * The shared row geometry. 36px on a pointer and 44px on touch, from `.ui-field`'s
 * own media query rather than from a second size prop the caller has to choose.
 *
 * `.ui-field` replaced a bare `min-h-9` here: 36px is the pointer figure and this
 * file had no coarse-pointer case at all, so every checkable row in the panel was
 * 36px on a phone against §3.4's 44px and §5's floor.
 */
const ROW =
  "ui-field ui-interactive ui-hover-fill relative flex cursor-pointer items-center gap-2.5 rounded-ui-md px-2 text-ui-compact text-ui-fg";

/** The dimming a row carries while it is inert — pre-hydration or disabled. */
const ROW_OFF = "cursor-not-allowed opacity-50";

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
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** `null` for a dimension the API does not count — a flag, a boolean. */
  count?: number | null;
  disabled?: boolean;
}) {
  const hydrated = useHydrated();
  const off = disabled || !hydrated;

  return (
    <label className={`${ROW} ${off ? ROW_OFF : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={off}
        aria-busy={!hydrated || undefined}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
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
  disabled = false,
}: {
  /** Names the group for a screen reader. Usually the `Section`'s own title. */
  label: string;
  value: string;
  options: { value: string; label: string; count?: number | null }[];
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const hydrated = useHydrated();
  const off = disabled || !hydrated;

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value || "all"}
            className={`${ROW} ${off ? ROW_OFF : ""}`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={off}
              aria-busy={!hydrated || undefined}
              onChange={() => onChange(option.value)}
              className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
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
  "ui-field ui-ring ui-interactive w-full rounded-ui-md border bg-ui-surface px-2.5 py-1.5 text-start text-ui-body text-ui-fg outline-none placeholder:text-ui-subtle disabled:cursor-not-allowed disabled:opacity-50";

function borderFor(invalid: boolean): string {
  return invalid ? "border-ui-danger-fg" : "border-ui-line-control";
}

/**
 * A rule the field runs itself, and the answer to *when* it may speak.
 *
 * §3.4: "Validation on blur, then on every change once a field has errored.
 * Never on first keystroke." Nothing in the panel implemented that, and the
 * reason is that it is three pieces of state per field — the verdict, whether
 * the field has ever failed, and whether the caller is also holding a refusal
 * from the server — which is exactly the amount of bookkeeping a screen author
 * gets right on the first field and drops on the ninth.
 *
 * So the split is: the caller owns the **rule** (`validate`, a pure function of
 * the value) and the layer owns the **timing**.
 *
 *   before the first blur   silent, however wrong the value is. Half a SKU is
 *                           not a bad SKU, it is a SKU being typed.
 *   on blur                 if the rule objects, the field errors and latches.
 *   after it has latched    the rule is re-run on every render, so the message
 *                           updates as the value changes and disappears the
 *                           moment the value is good.
 *
 * The latch is deliberately one-way. Once a person has seen this field refuse
 * them, going quiet again until the next blur is worse than staying noisy: they
 * are now editing *to fix it*, and the only useful moment to say "still wrong"
 * is while they are still there.
 *
 * `error` — the caller's own, a 400's `details.fields` or a cross-field rule the
 * screen owns — outranks the local verdict and is shown the instant it arrives,
 * because it did not come from typing. It does **not** arm the latch, and that is
 * a decision rather than an omission: a screen that clears a field's server error
 * when the field is edited (which is the right thing to do — the other fields in
 * that 400 are still wrong, but this one is being fixed) would otherwise have the
 * local rule start shouting on the first keystroke of the replacement value,
 * which is the one thing §3.4 names outright. A latch armed by something the
 * person did not do is a latch armed at the wrong moment.
 */
function useField({
  id: given,
  value,
  validate,
  error,
}: {
  id?: string;
  value: string;
  validate?: (value: string) => string | undefined;
  error?: string;
}) {
  /* Called unconditionally and then discarded when the caller named the field —
     `ErrorSummary` links to a field by id, and a generated one cannot be linked
     to from outside the component that generated it. */
  const auto = useId();
  const id = given ?? auto;
  const hydrated = useHydrated();
  const [latched, setLatched] = useState(false);

  const problem = validate?.(value) || undefined;

  return {
    id,
    hintId: `${id}-hint`,
    errorId: `${id}-error`,
    hydrated,
    /** What the field is allowed to show right now. */
    shown: error || (latched ? problem : undefined),
    /** Arms the live pass, on blur, and only if the rule actually objects. */
    onBlur: () => {
      if (problem) setLatched(true);
    },
    /**
     * The same, for a control whose change *is* the commitment.
     *
     * A `<select>` has no half-typed state — there is no keystroke to be
     * premature about — so waiting for a blur there holds a refusal back for no
     * reason a person could name. `DateField` looks like it belongs here and
     * does not: see its docblock.
     */
    commit: () => {
      setLatched(true);
    },
  };
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
      {error ? <FieldMessage id={errorId} message={error} /> : null}
    </div>
  );
}

/** The error line, with its alert icon. §3.4 asks for the icon by name. */
function FieldMessage({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-ui-label text-ui-danger-fg">
      <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{message}</span>
    </p>
  );
}

/** The `aria-describedby` value for a field that may have both, or neither. */
function describedBy(hint: string | undefined, hintId: string, error: string | undefined, errorId: string) {
  const ids = [hint ? hintId : null, error ? errorId : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function TextField({
  /**
   * Names the control's DOM id, so `ErrorSummary` can link a failure to it.
   * Generated when absent — a field nothing links to does not need naming.
   */
  id: givenId,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  validate,
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
  name,
  className = "",
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** See `useField`: the rule is yours, the timing is the layer's. */
  validate?: (value: string) => string | undefined;
  disabled?: boolean;
  isolate?: boolean;
  inputMode?: "text" | "decimal" | "numeric" | "tel" | "email" | "search";
  name?: string;
  className?: string;
}) {
  const field = useField({ id: givenId, value, validate, error });

  return (
    <FieldFrame
      id={field.id}
      label={label}
      hint={hint}
      hintId={field.hintId}
      error={field.shown}
      errorId={field.errorId}
      className={className}
    >
      <input
        id={field.id}
        name={name}
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        disabled={disabled || !field.hydrated}
        aria-busy={!field.hydrated || undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={field.onBlur}
        aria-invalid={field.shown ? true : undefined}
        aria-describedby={describedBy(hint, field.hintId, field.shown, field.errorId)}
        /*
         * `dir="auto"` when it is not an identifier — the other half of the same
         * rule, and `TextArea` below already had it. A control inherits the
         * *page's* direction, so French typed into the Arabic panel is an LTR run
         * inside an RTL paragraph: measured on the coupon form, "15 % sur les
         * tapis et textiles." rendered as ".sur les tapis et textiles % 15".
         * Nothing errors; the text is simply wrong, and only in the locale the
         * author was not looking at.
         */
        {...(isolate
          ? { dir: "ltr" as const, "data-numeric": "", style: { unicodeBidi: "isolate" as const } }
          : { dir: "auto" as const })}
        className={`${CONTROL} ${borderFor(Boolean(field.shown))}`}
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
  id?: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  validate?: (value: string) => string | undefined;
  disabled?: boolean;
}) {
  return <TextField {...props} isolate inputMode="decimal" className="flex-1" />;
}

/**
 * A calendar date, `Y-m-d` in and `Y-m-d` out. Ported from `Field.tsx`'s
 * `DateField`, which `components/patterns/RangeControl.tsx` uses for analytics
 * and the inventory ledger.
 *
 * A native `<input type="date">`, so the platform picker appears — a phone's
 * wheel and a desktop's calendar are already localised, already keyboard
 * navigable, and better than anything drawn here.
 *
 * **The value format is the wire format, and that is why this is safe where a
 * coupon's expiry was not.** README's warning is about `date_expires`, which the
 * API writes as `Y-m-d` and reads back as full ISO: an input bound to *that*
 * response renders empty and the next save clears a date nobody touched.
 * Analytics has no such asymmetry — `date_from` and `date_to` are `Y-m-d` in both
 * directions.
 *
 * `dir="ltr"`: a date input's own segments are ordered by the platform's locale
 * and must not be re-ordered by an Arabic paragraph around them.
 *
 * Blur rather than change for the validation latch, unlike `Select` below. A
 * date input reads as one commitment and mostly behaves like one, but a
 * half-entered date reports an **empty** value rather than a partial one — so
 * latching on change would let a "required" rule fire at the moment someone has
 * filled in the year and not yet the month.
 */
export function DateField({
  id: givenId,
  label,
  value,
  onChange,
  hint,
  error,
  validate,
  min,
  max,
  disabled = false,
  className = "",
}: {
  id?: string;
  label: string;
  /** `Y-m-d`, or the empty string. */
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  error?: string;
  validate?: (value: string) => string | undefined;
  /** `Y-m-d`. Bounds the pickers to each other so a reversed pair is hard to express. */
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
}) {
  const field = useField({ id: givenId, value, validate, error });

  return (
    <FieldFrame
      id={field.id}
      label={label}
      hint={hint}
      hintId={field.hintId}
      error={field.shown}
      errorId={field.errorId}
      className={className}
    >
      <input
        id={field.id}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled || !field.hydrated}
        aria-busy={!field.hydrated || undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={field.onBlur}
        aria-invalid={field.shown ? true : undefined}
        aria-describedby={describedBy(hint, field.hintId, field.shown, field.errorId)}
        dir="ltr"
        data-numeric=""
        style={{ unicodeBidi: "isolate" }}
        className={`${CONTROL} ${borderFor(Boolean(field.shown))}`}
      />
    </FieldFrame>
  );
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
  id: givenId,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  validate,
  rows = 3,
  counter,
  disabled = false,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  validate?: (value: string) => string | undefined;
  rows?: number;
  counter?: { length: number; limit: number; label: string };
  disabled?: boolean;
}) {
  const field = useField({ id: givenId, value, validate, error });

  return (
    <FieldFrame
      id={field.id}
      label={label}
      hint={hint}
      hintId={field.hintId}
      error={field.shown}
      errorId={field.errorId}
    >
      <textarea
        id={field.id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled || !field.hydrated}
        aria-busy={!field.hydrated || undefined}
        dir="auto"
        onChange={(event) => onChange(event.target.value)}
        onBlur={field.onBlur}
        aria-invalid={field.shown ? true : undefined}
        aria-describedby={describedBy(hint, field.hintId, field.shown, field.errorId)}
        className={`${CONTROL} ${borderFor(Boolean(field.shown))}`}
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
 *
 * **Generic over the option union, as `Field.tsx`'s `SelectField` was.** A
 * `value: string` takes any string at all, so a status select accepts `"drafft"`
 * and a delivery type accepts `"hoem"`, and the first thing that notices is the
 * API. Seventeen screens on the old primitive had compile-time proof that the
 * value is a member of the union its own options draw from; dropping the
 * parameter here would have quietly retired that guarantee for all of them at
 * the moment they migrated. `= string` keeps every existing call inferring
 * exactly what it inferred before.
 *
 * The validation latch arms on **change**, not on blur: a `<select>` has no
 * half-typed state, so there is no keystroke for "never on first keystroke" to
 * protect and holding a refusal until the person tabs away only delays it.
 */
export function Select<T extends string = string>({
  id: givenId,
  label,
  value,
  onChange,
  options,
  hint,
  error,
  validate,
  disabled = false,
}: {
  id?: string;
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: readonly { value: T; label: string }[];
  hint?: string;
  error?: string;
  validate?: (value: T) => string | undefined;
  disabled?: boolean;
}) {
  const field = useField({
    id: givenId,
    value,
    validate: validate as ((value: string) => string | undefined) | undefined,
    error,
  });

  return (
    <FieldFrame
      id={field.id}
      label={label}
      hint={hint}
      hintId={field.hintId}
      error={field.shown}
      errorId={field.errorId}
    >
      <select
        id={field.id}
        value={value}
        disabled={disabled || !field.hydrated}
        aria-busy={!field.hydrated || undefined}
        onChange={(event) => {
          field.commit();
          onChange(event.target.value as T);
        }}
        aria-invalid={field.shown ? true : undefined}
        aria-describedby={describedBy(hint, field.hintId, field.shown, field.errorId)}
        className={`${CONTROL} cursor-pointer ${borderFor(Boolean(field.shown))}`}
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
  id: givenId,
  label,
  checked,
  onChange,
  hint,
  error,
  disabled = false,
}: {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
  /**
   * A refusal on this control. There is no `validate` here and no blur-then-change
   * timing to apply: a toggle has no half-entered state, so the only error a
   * switch can carry is one somebody else decided — a 400 naming the field, or a
   * cross-field rule the screen owns.
   */
  error?: string;
  disabled?: boolean;
}) {
  const auto = useId();
  const id = givenId ?? auto;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hydrated = useHydrated();
  const off = disabled || !hydrated;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        className={`ui-field ui-interactive relative flex items-center gap-3 rounded-ui-md text-ui-compact text-ui-fg ${
          off ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={off}
          aria-busy={!hydrated || undefined}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hint, hintId, error, errorId)}
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
      {error ? <FieldMessage id={errorId} message={error} /> : null}
    </div>
  );
}

/**
 * A field the API reports and refuses to write. Ported from `Field.tsx`'s
 * `ReadOnlyField`, which six screens use.
 *
 * Rendered as a value with its reason rather than as a disabled input, and that
 * is the whole component: §3.3 says a disabled control with no reason is a dead
 * end, and a control that *looks* editable and is not is a bug report waiting to
 * be filed. Nothing here is focusable, nothing here is labelled `for` a control,
 * because there is no control — a `<label>` pointing at nothing is a promise the
 * row cannot keep.
 *
 * The frame is the field frame, not `Card.tsx`'s `DataRow`: this sits in the
 * middle of a stack of editable fields and has to line up with them. `DataRow` is
 * for the aside, where a label/value list is the whole point.
 */
export function ReadOnlyField({
  label,
  value,
  /** Why it cannot be edited here. The part that stops the bug report. */
  reason,
  className = "",
}: {
  label: string;
  value: ReactNode;
  reason?: string;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-ui-label text-ui-fg">{label}</span>
      <span dir="auto" className="min-w-0 text-ui-body text-ui-fg">
        {value}
      </span>
      {reason ? <p className="text-ui-label text-ui-muted">{reason}</p> : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════ the form, not the field ═══
 *
 * Two things that belong to a *form* rather than to any control in it, and that
 * every screen in the redesign run would otherwise hand-roll: the summary a
 * failed submission puts at the top, and the bar a dirty form puts at the
 * bottom. Both are DESIGN.md §3.4 and neither existed anywhere in the panel.
 */

/**
 * One failure, as the summary renders it.
 *
 * `id` is the DOM id of the control it belongs to — which is why every field
 * above takes an `id` prop. Optional, and its absence is a real case rather than
 * laziness: a 400 lists **every** bad field including ones the form does not
 * render, and an orphan message still has to be reachable or the person sees a
 * refusal with no cause anywhere on screen. Those render as text instead of as a
 * link, which is honest — there is nowhere to send them.
 */
export type FormFailure = {
  id?: string;
  /** The field's own label, so the line names the field and not the API's key. */
  label?: string;
  message: string;
};

/**
 * The error summary. §3.4: "A form that failed submission shows an error summary
 * at the top listing each failure as a link to its field, focus moved to the
 * summary."
 *
 * **Why focus moves.** A submit button at the foot of a nine-section form is
 * nowhere near the field that refused, and on a phone the failing field is
 * usually off screen entirely. Without the move the person is left standing on a
 * button that appeared to do nothing. `role="alert"` announces the summary,
 * `tabIndex={-1}` makes it a focus target without putting it in the tab order,
 * and the next Tab lands inside the list — so the keyboard path from "it
 * refused" to "here is the field" is two keys.
 *
 * **When focus moves**: on the transition from no failures to some. That is the
 * event, not the mount, and the difference matters for the second attempt — a
 * screen that clears its errors when a save starts (which it should: the previous
 * refusal is no longer true) passes through empty and re-announces. A screen that
 * does not clear them will fail twice with the same list and announce once, which
 * is the correct amount.
 *
 * The messages are the API's English where they came from the API — they name
 * the problem precisely, and a translated generic ("Ce champ est invalide")
 * throws away the only actionable part. The chrome around them is localised.
 */
export function ErrorSummary({
  failures,
  className = "",
}: {
  failures: readonly FormFailure[];
  className?: string;
}) {
  const t = useTranslations("ui.form");
  const ref = useRef<HTMLDivElement>(null);
  const failed = failures.length > 0;

  useEffect(() => {
    if (failed) ref.current?.focus();
  }, [failed]);

  if (!failed) return null;

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      data-testid="error-summary"
      className={`ui-ring rounded-ui-lg border border-ui-danger-fg bg-ui-danger-bg p-3 outline-none ${className}`}
    >
      <p className="flex items-start gap-1.5 text-ui-label text-ui-danger-fg">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">{t("summary", { count: failures.length })}</span>
      </p>

      <ul className="mt-2 flex flex-col gap-1 ps-6">
        {failures.map((failure, index) => {
          const text = failure.label
            ? t("summaryItem", { label: failure.label, message: failure.message })
            : failure.message;
          return (
            <li key={failure.id ?? `${index}`} className="text-ui-label">
              {failure.id ? (
                <a
                  href={`#${failure.id}`}
                  onClick={(event) => {
                    /*
                     * Focus rather than a fragment navigation. A bare `#id` jump
                     * scrolls the field to the very top of the viewport, adds a
                     * history entry the back button then has to be pressed twice
                     * to get past, and only focuses the target in some engines.
                     */
                    event.preventDefault();
                    document.getElementById(failure.id as string)?.focus();
                  }}
                  className="ui-ring rounded-ui-sm text-ui-danger-fg underline underline-offset-2"
                >
                  {text}
                </a>
              ) : (
                <span className="text-ui-danger-fg">{text}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The sticky save bar. §3.4: "Long forms get a sticky footer that appears only
 * when the form is dirty."
 *
 * It replaces a bar hand-rolled in `products/[id]/ProductDetail.tsx` on the iOS
 * `.save-bar` class, which was `position: fixed` and therefore had to know about
 * the tab bar's height, the safe-area inset and the sidebar's width — three
 * numbers in `globals.css` that a redesigned shell invalidates. This is
 * `position: sticky` inside the form's own column, so it knows about none of
 * them: it sits at the foot of the content while the content is short, and pins
 * to the bottom of the viewport while the form is taller than the screen. The
 * shell can move without this moving with it.
 *
 * **It renders nothing when the form is clean**, which is the rule and also what
 * keeps the last field of a short form reachable.
 *
 * `data-testid="save-bar"` is the handle. `e2e/products.spec.ts` currently
 * asserts on the `.save-bar` *class* in four places; the screen that migrates
 * swaps those for `[data-testid=save-bar]`, and the assertions mean the same
 * thing on both sides — visible exactly when the form is dirty.
 *
 * The label does not change while saving. §3.3: the spinner replaces the leading
 * icon, the label stays and the width is held — a button that becomes
 * "Enregistrement…" mid-click resizes under the pointer that is still on it.
 */
export function SaveBar({
  dirty,
  saving = false,
  onSave,
  onDiscard,
  /** Overrides "Enregistrer" where the action is not a save — "Publier", "Envoyer". */
  saveLabel,
  /**
   * Dirty, and still not saveable — a client-side rule the form has not met.
   * The bar still appears, because there *are* unsaved changes and hiding it
   * would say otherwise; the primary is disabled with `title` carrying the reason,
   * per §3.3.
   */
  blockedReason,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  saveLabel?: string;
  blockedReason?: string;
}) {
  const t = useTranslations("ui.form");

  if (!dirty) return null;

  return (
    <div
      data-testid="save-bar"
      className="ui-card ui-safe-b sticky bottom-0 z-10 flex flex-wrap items-center gap-3 px-4 pt-3 shadow-ui-sm"
    >
      <p className="min-w-0 flex-1 text-ui-label text-ui-muted">{t("unsaved")}</p>
      {onDiscard ? (
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>
          {t("discard")}
        </Button>
      ) : null}
      <Button
        onClick={onSave}
        loading={saving}
        disabled={Boolean(blockedReason)}
        title={blockedReason}
      >
        {saveLabel ?? t("save")}
      </Button>
    </div>
  );
}
