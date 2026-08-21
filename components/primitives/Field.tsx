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

/**
 * The label, and the hint **beside** it rather than inside it.
 *
 * This was noted rather than fixed for three branches and README carried it as a
 * known defect, because it is shared by every form in the panel and the branch
 * that found it was not the branch to change it on. The content branch adds more
 * forms than any before it, so it is the one.
 *
 * The defect: the hint used to sit inside the `<label>`, and everything inside a
 * `<label>` is part of the control's **accessible name**. So a field labelled
 * "Segment d'URL" with a hint reading "Un seul segment, sans barre oblique."
 * announced as *"Segment d'URL Un seul segment, sans barre oblique., zone de
 * texte"* — one long run with no pause, every time focus landed. Worse, the name
 * changed as the hint changed: the page form's status hint appears only for a
 * draft, so selecting "Brouillon" silently renamed the control beside it.
 *
 * A name should identify; a description should explain. `aria-describedby` is
 * the mechanism for the second, it is announced after a pause and separately,
 * and `FieldError` already used it — so the hint joins the error there and the
 * two are read in order.
 *
 * `<div>` rather than `<label>` around both: nesting the hint in a sibling
 * `<span>` inside the label would not have helped, because the accessible name
 * is computed from the label's whole subtree.
 */
function LabelAndHint({
  htmlFor,
  hintId,
  hint,
  children,
}: {
  htmlFor: string;
  hintId: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={htmlFor} className="text-footnote text-label-secondary">
        {children}
      </label>
      {hint ? (
        <span id={hintId} className="text-caption text-label-tertiary">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Join the ids that describe a control, in reading order.
 *
 * The hint first and the error second, because that is the order they appear on
 * screen and the order a person needs them in: what the field wants, then what
 * went wrong with what they typed. `undefined` rather than an empty string when
 * there is neither — an empty `aria-describedby` is a dangling reference.
 */
function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => typeof id === "string" && id !== "");
  return present.length > 0 ? present.join(" ") : undefined;
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
  const hintId = `${id}-hint`;
  const hydrated = useHydrated();

  return (
    <div className={rowClass(Boolean(error))}>
      <LabelAndHint htmlFor={id} hintId={hintId} hint={hint}>
        {label}
      </LabelAndHint>
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
        aria-describedby={describedBy(hint && hintId, error && errorId)}
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

/**
 * A calendar date, `Y-m-d` in and `Y-m-d` out.
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
 * directions, and nothing here writes to the shop at all.
 *
 * `dir="ltr"`: a date input's own segments are ordered by the platform's locale
 * and must not be re-ordered by an Arabic paragraph around them.
 */
export function DateField({
  label,
  value,
  onChange,
  error,
  hint,
  min,
  max,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const hydrated = useHydrated();

  return (
    <div className={rowClass(Boolean(error))}>
      <LabelAndHint htmlFor={id} hintId={hintId} hint={hint}>
        {label}
      </LabelAndHint>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled || !hydrated}
        aria-busy={!hydrated || undefined}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && hintId, error && errorId)}
        dir="ltr"
        data-numeric=""
        className={`${CONTROL} text-start disabled:opacity-40`}
        style={{ unicodeBidi: "isolate" }}
      />
      {error ? <FieldError id={errorId} message={error} /> : null}
    </div>
  );
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
  const hintId = `${id}-hint`;
  const hydrated = useHydrated();

  return (
    <div className={rowClass(Boolean(error))}>
      <LabelAndHint htmlFor={id} hintId={hintId} hint={hint}>
        {label}
      </LabelAndHint>
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
        aria-describedby={describedBy(hint && hintId, error && errorId)}
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
  const hintId = `${id}-hint`;
  const hydrated = useHydrated();

  return (
    <div className={rowClass(Boolean(error))}>
      <LabelAndHint htmlFor={id} hintId={hintId} hint={hint}>
        {label}
      </LabelAndHint>
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
          aria-describedby={describedBy(hint && hintId, error && errorId)}
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
  const hintId = `${id}-hint`;
  const reasonId = `${id}-reason`;
  const hydrated = useHydrated();

  return (
    <div className={rowClass(Boolean(error))}>
      <div className="flex min-h-9 items-center gap-3">
        {/*
          A switch's label is a single line and the two explanatory lines sit
          outside it, for the reason `LabelAndHint` gives above: everything
          inside a `<label>` becomes the control's accessible name, and a switch
          announcing "Indexable Autorise les moteurs de recherche à indexer la
          page., interrupteur, activé" buries the state that matters at the end
          of a sentence.
        */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <label htmlFor={id} className="text-body text-label">
            {label}
          </label>
          {hint ? (
            <span id={hintId} className="text-caption text-label-secondary">
              {hint}
            </span>
          ) : null}
          {/* A disabled toggle with no explanation gets raised as a bug every
              few months. When it cannot be changed here, say so — and describe
              it rather than name it, so the reason is announced after the
              state rather than as part of it. */}
          {readOnlyReason ? (
            <span id={reasonId} className="text-caption text-label-tertiary">
              {readOnlyReason}
            </span>
          ) : null}
        </div>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled || !hydrated}
          aria-busy={!hydrated || undefined}
          onClick={() => onChange(!checked)}
          aria-describedby={describedBy(
            hint && hintId,
            readOnlyReason && reasonId,
            error && errorId,
          )}
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
