"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Every visual property is ours. Radix supplies behaviour elsewhere in this
 * directory; a button needs none, so this is a real `<button>`.
 *
 * Every state is here, not half of them: default, hover, active, disabled,
 * loading. `:active` is `scale(0.97)` because a phone has no hover and a tap with
 * no feedback gets tapped again.
 */

type Variant = "filled" | "tinted" | "plain" | "destructive";

const VARIANT: Record<Variant, string> = {
  filled: "bg-accent text-bg",
  tinted: "tone-accent tonal",
  plain: "text-accent",
  // Destructive reads as danger from the first glance, and its confirmation step
  // is the caller's job — never adjacent to a non-destructive neighbour.
  destructive: "tone-danger tonal",
};

export function Button({
  children,
  variant = "filled",
  loading = false,
  fullWidth = false,
  className = "",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4",
        "text-headline press disabled:opacity-40",
        fullWidth ? "w-full" : "",
        VARIANT[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
