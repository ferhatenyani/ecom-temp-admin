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
import { Isolate } from "@/components/primitives/Ltr";
import { Button } from "./Button";
import { FilterTabs } from "./FilterBar";
import { DateField } from "./Form";
import { Modal } from "./Overlay";

/**
 * The date range, once, above everything it scopes. See DESIGN.md §3.2, §3.4.
 *
 * ## Why this is a second file rather than an edit to the old one
 *
 * `components/patterns/RangeControl.tsx` is the pre-redesign control and it is
 * **shared with `/analytics`**, which is item 11 and not this branch. It also
 * builds its custom window inside a `Sheet` — the bottom sheet with detents that
 * DESIGN.md §0 retires in full and §7 fails the build on. So it cannot be
 * migrated in place without migrating a screen this branch does not own, and it
 * is left exactly as it is until that branch takes it. Both files render the
 * same measurements; only the chrome differs.
 *
 * ## The presets are a filter, so they are `FilterTabs` in its `chips` shape
 *
 * Six single-select values that re-fetch the page — the same primitive the order,
 * payment and shipment status strips are, down to scrolling rather than wrapping
 * at 340px. The old one hand-rolled a pill row with `.pill-row` and `.tonal`,
 * both retired.
 *
 * **`chips` rather than the default full-bleed strip, and the reason is
 * positional rather than about rank.** `/analytics` has two single-select strips
 * stacked: which report, and over what window. The report selector takes the
 * default `tabs` shape, because it is that page's own axis — full-bleed, closed
 * by a rule, the selected label underlined in ink, exactly what every list in the
 * panel uses for its primary filter. If the window took the same shape it would
 * sit in the same slot on `/dashboard` — directly under `PageHeader` — as the
 * report tabs do one nav item away, so the identical control in the identical
 * position would mean *which period* on one screen and *which report* on the
 * other.
 *
 * So the rule is one sentence and holds on both pages: **a full-bleed underlined
 * strip under the header always means which view; a labelled "Période" chip group
 * always means the window.** It is not a prop, because there is no screen on
 * which the second half is wrong — a range control that read as a page axis would
 * be lying about what it scopes. The visible label is half the distinction, and
 * on the dashboard it is a straight gain over six bare words under a title.
 *
 * ## Two measurements are the whole reason for the shape below
 *
 * **`date_from`/`date_to` without `range=custom` are silently ignored** —
 * measured on four spellings including a valid ten-day window, every one
 * answering 200 with the thirty-day default. Nothing errors, and the operator
 * reads their chosen dates above a month of data they do not describe.
 *
 * So, first: choosing dates here *sets the preset to `custom`*, and there is no
 * path through this control that sends a date without one. Second, and more
 * important: the line under the strip renders **`applied`, which is `data.range`
 * off the response** rather than the state this component holds. If the server
 * ever disagrees with the picker again, the screen shows the server's answer,
 * because the server's answer is what the figures describe.
 *
 * ## The custom window is a `Modal`, not a `Popover`
 *
 * §3.1 lists "date ranges" under `Popover` and then rules that a `Popover`
 * "never holds a form that can fail validation — that is a `Modal`". This form
 * fails validation three ways, all of them the API's own: a missing date, a
 * reversed pair and a window over 366 days. The second rule wins, and the first
 * one is describing a *presented* range — a calendar you pick a day out of —
 * rather than two required fields with a cap on their difference.
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
  const tUi = useTranslations("ui");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  const problem = customRangeProblem(from, to);

  const choose = (preset: RangePreset) => {
    if (preset === "custom") {
      /* Seeded from the URL each time it opens, so a half-typed pair abandoned
         once does not come back as the starting point next time. */
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

  /* Why Apply cannot act, in the reader's own words — §3.3: a disabled control
     with no reason is a dead end. The three sentences are the API's own
     refusals, mirrored by `customRangeProblem` so they land while somebody is
     still typing rather than after a round trip that renders as a failed
     screen. */
  const refusal =
    problem === "missing"
      ? t("errorMissing")
      : problem === "reversed"
        ? t("errorReversed")
        : problem === "too-long"
          ? t("errorTooLong", { max: MAX_CUSTOM_DAYS })
          : undefined;

  return (
    <div className="flex flex-col gap-2">
      <FilterTabs
        label={t("rangeLabel")}
        value={range.preset}
        onChange={choose}
        variant="chips"
        tabs={RANGE_PRESETS.map((preset) => ({
          value: preset,
          label: t(`preset.${preset}`),
          opensDialog: preset === "custom",
        }))}
      />

      {/*
        The window the figures actually describe, off the response. `aria-live`
        because changing a preset replaces every number on the screen without
        moving focus, and a screen-reader user is otherwise given no signal that
        anything happened.
      */}
      <p
        aria-live="polite"
        data-testid="range-applied"
        className={`text-ui-caption text-ui-subtle ${pending ? "opacity-60" : ""}`}
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

      <Modal
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title={t("customTitle")}
        description={t("customNote", { max: MAX_CUSTOM_DAYS })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tUi("cancel")}
            </Button>
            <Button onClick={apply} disabled={problem !== null} title={refusal}>
              {t("customApply")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {/*
            `max` and `min` bound the pickers to each other so a reversed pair is
            difficult to express at all; the message covers the platform pickers
            that allow it anyway.

            `echo` is the coupons branch's measured defence and it is required
            here: a native date input follows the **browser's** locale, so the
            Arabic panel renders `mm/dd/yyyy` — a US ordering, in a right-to-left
            screen, for a shop in Algeria — and Chromium was measured not to
            honour `lang`. The value is read back underneath in the page's own
            language. `Isolate` and never `Ltr`, because `formatDay` is
            `Intl`-formatted text carrying U+200F marks.
          */}
          <DateField
            label={t("customFrom")}
            value={from}
            onChange={setFrom}
            max={to === "" ? undefined : to}
            echo={from === "" ? undefined : <Isolate>{formatDay(from, locale)}</Isolate>}
            error={problem === "reversed" ? t("errorReversed") : undefined}
          />
          <DateField
            label={t("customTo")}
            value={to}
            onChange={setTo}
            min={from === "" ? undefined : from}
            echo={to === "" ? undefined : <Isolate>{formatDay(to, locale)}</Isolate>}
            error={
              problem === "too-long" ? t("errorTooLong", { max: MAX_CUSTOM_DAYS }) : undefined
            }
          />

          {problem === "missing" ? (
            <p className="text-ui-label text-ui-muted">{t("errorMissing")}</p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
