"use client";

import { useId, type ReactNode } from "react";
import { Icon } from "./Icon";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * The form field set.
 *
 * A field in this panel is a **grouped-list row**, not a boxed input: label at
 * the leading edge, value filling the rest, hairlines between. That is the iOS
 * settings-form grammar and it is what makes a long form scannable on a phone —
 * a stack of bordered boxes at 390px is a stack of borders.
 *
 * Every field owns its error. The API's 400 lists *every* bad field at once —
 * measured, four fields in one response — so an error has to be able to land on
 * each of them rather than collapse into one line at the top. `FieldError` is
 * rendered inside the row's own block so the message sits under the control it
 * belongs to and the row grows rather than shifting its neighbours.
 *
 * The API's field messages are **English** — "Must be a number.", "Cannot be
 * negative." — while the panel is French and Arabic. They are still rendered
 * verbatim: they name the problem precisely, and a generic translated line
 * ("Ce champ est invalide") throws away the only actionable part. The *label*
 * beside them is localised, so the row reads as a French label with the API's
 * reason under it rather than as an untranslated screen.
 *
 * **Every control here is inert until React has hydrated it.** A keystroke
 * landing in the window between first paint and hydration changes the DOM and
 * never reaches React, so the value looks accepted, the form never goes dirty and
 * the save bar never appears — measured on WebKit on the product detail, hidden
 * by Chromium, and left unhandled for two branches while the e2e suite retried
 * around it. `useHydrated()` carries the full account.
 *
 * Refusing the keystroke is the point. The alternative — reading the DOM back on
 * mount and adopting whatever was typed — loses nothing and shows nothing, and a
 * window a person cannot see is a window they cannot work around. `disabled`
 * dims the row through the styling every field already has, so the control looks
 * as unavailable as it is, and it is the state a screen reader is told about.
 */

function rowClass(hasError: boolean): string {
  return [
    "list-row flex min-h-11 w-full flex-col gap-1 px-4 py-2.5",
    // The error tint is a background, never a leading border — that is the
    // banned accent bar, and Part III's named replacement is a tonal fill.
    hasError ? "tone-danger tonal" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function Label({
  htmlFor,
  children,
  hint,
}: {
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-0.5">
      <span className="text-footnote text-label-secondary">{children}</span>
      {hint ? <span className="text-caption text-label-tertiary">{hint}</span> : null}
    </label>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-footnote tonal-fg tone-danger">
      <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{message}</span>
    </p>
  );
}

const CONTROL =
  "min-h-9 w-full bg-transparent text-body text-label outline-none placeholder:text-label-tertiary";

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  /** `ltr` for a SKU or a slug: an identifier reordered by the bidi algorithm is a different identifier. */
  isolate = false,
  inputMode,
  disabled,
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  isolate?: boolean;
  inputMode?: "text" | "decimal" | "numeric";
  disabled?: boolean;
  name?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hydrated = useHydrated();

  return (
    <div className={rowClass(Boolean(error))}>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      <input
        id={id}
        name={name}
        type="text"
        value={value}
        disabled={disabled || !hydrated}
        aria-busy={!hydrated || undefined}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        /*
         * `dir="auto"` when the field is not an identifier, and it is not
         * cosmetic. A control inherits the *page's* direction, so a French
         * description typed into the Arabic panel is an LTR run inside an RTL
         * paragraph: measured on the coupon form, "15 % sur les tapis et
         * textiles." rendered as ".sur les tapis et textiles % 15" — the leading
         * figure thrown to the far end and the full stop to the other. Nothing
         * errors; the text is simply wrong, and only in the locale the author
         * was not looking at.
         *
         * `auto` resolves from the value's own first strong character, so French
         * types left-to-right and Arabic right-to-left in the same control, and
         * an empty field falls back to the page's direction.
         */
        {...(isolate
          ? { dir: "ltr" as const, "data-numeric": "" }
          : { dir: "auto" as const })}
        className={`${CONTROL} ${isolate ? "text-start" : ""} disabled:opacity-40`}
        style={isolate ? { unicodeBidi: "isolate" } : undefined}
      />
      {error ? <FieldError id={errorId} message={error} /> : null}
    </div>
  );
}

/**
 * Money and weight. A decimal string in, a decimal string out — never a `number`.
 *
 * `type="text"` with `inputMode="decimal"` rather than `type="number"`: a number
 * input silently drops what it cannot parse, and the API's own validation
 * ("Must be a number.", "Cannot be negative.") is the thing the panel is meant
 * to surface. Swallowing the bad value locally means the person never learns
 * which character was wrong.
 */
export function DecimalField(props: Omit<Parameters<typeof TextField>[0], "inputMode" | "isolate">) {
  return <TextField {...props} inputMode="decimal" isolate />;
}

export function TextAreaField({
  label,
  value,
  onChange,
  error,
  hint,
  rows = 4,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hydrated = useHydrated();

  return (
    <div className={rowClass(Boolean(error))}>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        disabled={disabled || !hydrated}
        aria-busy={!hydrated || undefined}
        onChange={(event) => onChange(event.target.value)}
        // See `TextField`: a description is user content in whichever language it
        // was typed, and the control otherwise inherits the page's direction.
        dir="auto"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`${CONTROL} resize-y py-1 disabled:opacity-40`}
      />
      {error ? <FieldError id={errorId} message={error} /> : null}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  error,
  hint,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  error?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hydrated = useHydrated();

  return (
    <div className={rowClass(Boolean(error))}>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      <div className="flex items-center gap-2">
        {/* A real <select>, so the platform picker appears — a phone's native
            wheel beats any listbox this panel could draw, and it is already
            localised and already accessible. */}
        <select
          id={id}
          value={value}
          disabled={disabled || !hydrated}
          aria-busy={!hydrated || undefined}
          onChange={(event) => onChange(event.target.value as T)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`${CONTROL} appearance-none disabled:opacity-40`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevron" className="size-4 shrink-0 rotate-90 text-label-tertiary" />
      </div>
      {error ? <FieldError id={errorId} message={error} /> : null}
    </div>
  );
}

/**
 * A switch row. The control sits at the trailing edge with the label leading,
 * which is the one field shape that stays on a single line.
 */
export function SwitchField({
  label,
  checked,
  onChange,
  hint,
  error,
  disabled,
  /** Shown instead of the switch when the field is read-only, with the reason. */
  readOnlyReason,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
  readOnlyReason?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hydrated = useHydrated();

  return (
    <div className={rowClass(Boolean(error))}>
      <div className="flex min-h-9 items-center gap-3">
        <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body text-label">{label}</span>
          {hint ? (
            <span className="text-caption text-label-secondary">{hint}</span>
          ) : null}
          {/* A disabled toggle with no explanation gets raised as a bug every
              few months. When it cannot be changed here, say so. */}
          {readOnlyReason ? (
            <span className="text-caption text-label-tertiary">{readOnlyReason}</span>
          ) : null}
        </label>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled || !hydrated}
          aria-busy={!hydrated || undefined}
          onClick={() => onChange(!checked)}
          aria-describedby={error ? errorId : undefined}
          className={[
            "switch press relative shrink-0 rounded-full disabled:opacity-40",
            checked ? "bg-success" : "bg-fill",
          ].join(" ")}
        >
          <span aria-hidden="true" className="switch-knob absolute rounded-full bg-bg" />
        </button>
      </div>
      {error ? <FieldError id={errorId} message={error} /> : null}
    </div>
  );
}

/**
 * A field the API reports and refuses to write.
 *
 * Rendered as a value with its reason rather than as a disabled input: a control
 * that looks editable and is not is a bug report waiting to be filed, and the
 * reason is the part that stops it.
 */
export function ReadOnlyField({
  label,
  value,
  reason,
}: {
  label: string;
  value: ReactNode;
  reason?: string;
}) {
  return (
    <div className="list-row flex min-h-11 w-full flex-col gap-1 px-4 py-2.5">
      <span className="text-footnote text-label-secondary">{label}</span>
      <span className="text-body text-label">{value}</span>
      {reason ? (
        <span className="text-caption text-label-tertiary">{reason}</span>
      ) : null}
    </div>
  );
}
