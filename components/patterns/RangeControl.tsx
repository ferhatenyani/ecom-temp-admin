"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  customRangeProblem,
  MAX_CUSTOM_DAYS,
  RANGE_PRESETS,
  type RangePreset,
  type RangeQuery,
} from "@/lib/analytics";
import type { AnalyticsRange } from "@/lib/api/schemas/analytics";
import { formatDay } from "@/lib/format/date";
import { Icon } from "@/components/primitives/Icon";
import { Isolate } from "@/components/primitives/Ltr";
import { Button } from "@/components/primitives/Button";
import { DateField } from "@/components/primitives/Field";
import { Sheet } from "@/components/primitives/Sheet";

/**
 * The date range, once, above everything it scopes.
 *
 * One control for the dashboard and all six reports — never a picker per chart.
 * A filter that lives inside one card scopes only that card, and a reader
 * comparing two cards then has no way to know whether they describe the same
 * window.
 *
 * ## Two things here exist because of one measurement
 *
 * **`date_from`/`date_to` without `range=custom` are silently ignored.** Measured
 * 2026-08-21 on four spellings, including a valid ten-day window: every one
 * answered **200 with the thirty-day default**. Nothing errors, nothing warns,
 * and the operator reads their chosen dates above a month of data.
 *
 * So, first: choosing dates here *sets the preset to `custom`* — the two are one
 * action, and there is no path through this control that sends a date without
 * one. Second, and more important: the line under the pills renders **`applied`,
 * which is `data.range` off the response**, not the state this component holds.
 * If the server ever disagrees with the picker again, the screen shows the
 * server's answer, because the server's answer is what the figures describe.
 *
 * The six presets scroll rather than wrap. `Segmented` holds four and this is
 * six; at 390px a wrapped row of six pills costs two lines above every screen in
 * the section.
 */
export function RangeControl({
  locale,
  range,
  applied,
  onChange,
  /** True while a refetch is in flight, so the applied line can say it is stale. */
  pending = false,
}: {
  locale: string;
  range: RangeQuery;
  applied: AnalyticsRange | null;
  onChange: (next: RangeQuery) => void;
  pending?: boolean;
}) {
  const t = useTranslations("analytics");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  const problem = customRangeProblem(from, to);

  const choose = (preset: RangePreset) => {
    if (preset === "custom") {
      setFrom(range.from);
      setTo(range.to);
      setOpen(true);
      return;
    }
    onChange({ preset, from: "", to: "" });
  };

  const apply = () => {
    if (problem !== null) return;
    setOpen(false);
    onChange({ preset: "custom", from, to });
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("rangeLabel")}
        className="pill-row -mb-1 flex gap-2 overflow-x-auto pb-1"
      >
        {RANGE_PRESETS.map((preset) => {
          const active = range.preset === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => choose(preset)}
              aria-pressed={active}
              className={[
                "press flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3",
                "text-subhead whitespace-nowrap",
                active ? "tone-accent tonal font-medium" : "bg-surface text-label-secondary",
              ].join(" ")}
            >
              <span>{t(`preset.${preset}`)}</span>
              {preset === "custom" ? (
                <Icon name="chevron" className="size-3.5 shrink-0 rotate-90 opacity-60" />
              ) : null}
            </button>
          );
        })}
      </div>

      {/*
        The window the figures actually describe, off the response. `aria-live`
        because changing a pill replaces every number on the screen without
        moving focus, and a screen-reader user is otherwise given no signal that
        anything happened.
      */}
      <p
        aria-live="polite"
        data-testid="range-applied"
        className={`px-1 text-caption text-label-tertiary ${pending ? "opacity-60" : ""}`}
      >
        {applied === null ? (
          t("rangeUnknown")
        ) : (
          <Isolate>
            {t("rangeApplied", {
              from: formatDay(applied.from, locale),
              to: formatDay(applied.to, locale),
              days: applied.days,
            })}
          </Isolate>
        )}
      </p>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t("customTitle")}
        description={t("customNote", { max: MAX_CUSTOM_DAYS })}
      >
        <div className="overflow-hidden rounded-lg bg-surface">
          {/*
            The two refusals the API makes are mirrored here so they land while
            the operator is still typing, rather than as a failed screen after a
            round trip. The API is still asked and is still the authority — it
            refuses `date_from` by name, and that message renders if it ever
            refuses for a reason this does not know.

            `max` and `min` bound the pickers to each other so the reversed pair
            is difficult to express at all, and the message covers the case where
            the platform picker allows it anyway.
          */}
          <DateField
            label={t("customFrom")}
            value={from}
            onChange={setFrom}
            max={to === "" ? undefined : to}
            error={problem === "reversed" ? t("errorReversed") : undefined}
          />
          <DateField
            label={t("customTo")}
            value={to}
            onChange={setTo}
            min={from === "" ? undefined : from}
            error={problem === "too-long" ? t("errorTooLong", { max: MAX_CUSTOM_DAYS }) : undefined}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={apply} disabled={problem !== null}>
            {t("customApply")}
          </Button>
        </div>

        {problem === "missing" ? (
          <p className="mt-2 text-footnote text-label-secondary">{t("errorMissing")}</p>
        ) : null}
      </Sheet>
    </div>
  );
}
