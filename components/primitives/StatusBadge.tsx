import type { ReactNode } from "react";

/**
 * The tonal badge — the default replacement for the banned accent bar.
 *
 * The semantic colour at 14 % for the fill, the same colour at full strength for
 * the label. The label is never tinted below full strength: `color-mix` at 14 %
 * behind a full-strength label passes contrast, and a badge whose text is also
 * tinted does not.
 *
 * Semantic colour is never the only signal — the badge always carries the word,
 * and `Dot` always sits beside a text label.
 */

export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "accent";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "tone-neutral",
  info: "tone-info",
  warning: "tone-warning",
  success: "tone-success",
  danger: "tone-danger",
  accent: "tone-accent",
};

export function StatusBadge({
  tone,
  children,
  className = "",
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`tonal ${TONE_CLASS[tone]} inline-flex shrink-0 items-center rounded-full px-2 py-1 text-caption font-medium ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * A leading dot, for a row already dense enough that a badge would crowd it.
 * 8px, semantic colour, always beside a word — never the only signal.
 */
export function Dot({ tone, className = "" }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`tonal-dot ${TONE_CLASS[tone]} inline-block size-2 shrink-0 rounded-full ${className}`}
    />
  );
}
