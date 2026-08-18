"use client";

import { useId } from "react";

/**
 * The segmented control, for 2–4 mutually exclusive filters.
 *
 * The selected segment sits on `--color-surface` inside a `--color-surface-2`
 * track and is animated with a transform, not by moving a background — animating
 * `width` or `background-color` janks the list behind it while it filters.
 *
 * A real radiogroup, so a keyboard and a screen reader both work: arrow keys move
 * between options because that is what a radiogroup does, with no key handling of
 * our own.
 */

export type Segment<T extends string> = { value: T; label: string };

export function Segmented<T extends string>({
  segments,
  value,
  onChange,
  label,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const name = useId();
  const index = Math.max(
    0,
    segments.findIndex((s) => s.value === value),
  );
  const count = segments.length;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      /* Full width on mobile, capped at md — a segmented control stretched across
         1200px stops reading as one control and becomes four separate buttons. */
      className="relative flex w-full max-w-md rounded-md bg-surface-2 p-0.5"
      style={{ ["--seg-count" as string]: count, ["--seg-index" as string]: index }}
    >
      {/*
        The thumb. One absolutely positioned element that slides, rather than a
        background on each segment — that is what makes the movement a transform.
        `inset-inline-start` with a translate keeps it correct in both directions
        without a mirrored copy of the maths.
      */}
      <span
        aria-hidden="true"
        className="seg-thumb pointer-events-none absolute rounded-sm bg-surface"
      />
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <label
            key={segment.value}
            /*
              `min-w-0` is load-bearing: without it `flex-1` cannot shrink a
              segment below its label's intrinsic width, so the segments size to
              their text and stop matching the thumb, which is a fixed 1/n.
              Measured before the fix: widths 79 / 86 / 109 / 80 against an 88.5
              thumb.
            */
            className="relative z-10 flex min-h-9 min-w-0 flex-1 cursor-pointer items-center justify-center px-2"
          >
            <input
              type="radio"
              name={name}
              value={segment.value}
              checked={selected}
              onChange={() => onChange(segment.value)}
              className="sr-only"
            />
            <span
              className={`truncate text-subhead ${
                selected ? "font-semibold text-label" : "text-label-secondary"
              }`}
            >
              {segment.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
