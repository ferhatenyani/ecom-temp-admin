import type { ReactNode } from "react";

/**
 * The status badge. See DESIGN.md §3.5.
 *
 * This replaces `StatusBadge`, and the replacement is an accessibility fix, not
 * a restyle. The old one set the label to the raw semantic hue and its fill to
 * the *same hue* at 14 %:
 *
 *   .tonal { background: color-mix(in srgb, var(--tone) 14%, transparent);
 *            color: var(--tone); }
 *
 * Measured against a white surface, that produces 1.98:1 for success, 1.96:1
 * for warning, 2.95:1 for danger and 3.34:1 for accent. Four of the five tones
 * in the panel fail 4.5:1 today, and success — the most common badge on the
 * orders list — fails by a factor of two.
 *
 * The fix is that `-fg` and `-bg` are separate tokens, chosen against each other
 * rather than derived from one another. Every pair measures between 5.50:1 and
 * 7.28:1 across both themes. See the ratios beside the tokens in tokens.css.
 *
 * Colour is never the only signal: a Badge always contains a word, and `Dot`
 * exists only for rows already dense enough that a badge would crowd them —
 * where it still sits beside the status text rather than replacing it.
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "bg-ui-neutral-bg text-ui-neutral-fg",
  info: "bg-ui-info-bg text-ui-info-fg",
  success: "bg-ui-success-bg text-ui-success-fg",
  warning: "bg-ui-warning-bg text-ui-warning-fg",
  danger: "bg-ui-danger-bg text-ui-danger-fg",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-ui-neutral-fg",
  info: "bg-ui-info-fg",
  success: "bg-ui-success-fg",
  warning: "bg-ui-warning-fg",
  danger: "bg-ui-danger-fg",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-ui-md px-1.5 py-0.5 text-ui-overline whitespace-nowrap ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * A leading dot for a dense row. Decorative and `aria-hidden` — the word beside
 * it is what carries the meaning, and it is the caller's job to put one there.
 */
export function Dot({ tone = "neutral", className = "" }: { tone?: Tone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-1.5 shrink-0 rounded-full ${DOT[tone]} ${className}`}
    />
  );
}

/**
 * A count, for a tab or a nav item. Neutral by default because a count is not a
 * status — a number in a semantic colour invites the reader to infer a severity
 * nobody assigned.
 */
export function CountBadge({ children }: { children: ReactNode }) {
  return (
    <span
      data-numeric=""
      className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-ui-surface-3 px-1.5 py-0.5 text-ui-overline text-ui-muted"
    >
      {children}
    </span>
  );
}
