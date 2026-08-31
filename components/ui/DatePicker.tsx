"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";
import { dirFor } from "@/i18n/routing";
import {
  fieldOrder,
  firstWeekday,
  monthGrid,
  readYmd,
  sameMonth,
  shiftDays,
  shiftMonths,
  todayYmd,
  withinRange,
  type Ymd,
} from "@/lib/calendar";

/**
 * The drawn date control. See DESIGN.md §3.4, and `components/ui/Listbox.tsx`,
 * which is this file's argument one control earlier.
 *
 * Radix supplies behaviour only — the portal, the popper, collision detection,
 * dismissal, Escape, and returning focus to the trigger on close — and every
 * visual property is ours. `Form.tsx`'s `DateField` is this in the field frame,
 * exactly as `Select` is `Listbox` in the field frame, and no screen imports
 * this file directly.
 *
 * ## This reverses a decision `Form.tsx` argued for, and the old case was good
 *
 * `DateField` was a native `<input type="date">` for the whole redesign run, and
 * what it said for itself is all still true: **the platform picker is already
 * localised, already keyboard navigable, a phone renders it as a wheel, and it
 * needs no portal, no collision detection and no grid of our own.** Not one of
 * those four is a small thing, and three of them are re-implemented below at a
 * cost of about three hundred lines.
 *
 * What the argument left out is the same omission `<select>`'s was, one control
 * over: **the part of the control a person actually reads is drawn by the user
 * agent and cannot be reached.** For a `<select>` that was the open list; here it
 * is the field's own text. A date input renders its segments in the *browser's*
 * locale, no attribute changes it, and so the Arabic panel — a right-to-left
 * screen for a shop in Algeria — printed `mm/dd/yyyy`, a **US** ordering that
 * neither of this panel's two languages uses. The panel had two date formats,
 * one on every rendered date and one inside every date field, and the second was
 * chosen by whoever installed the browser.
 *
 * `DateField` had a workaround for that and it is deleted with this file's
 * arrival: it echoed the value underneath in the page's own language, so the
 * screen printed the date twice, once in a format the reader could not use and
 * once in one they could. That was the honest answer while the format could not
 * be changed. It can be changed now.
 *
 * **What the reversal costs, named rather than buried.** Three things, and the
 * third is the one with no compensation:
 *
 *   the phone's wheel   gone, the same trade `Listbox` made for `<select>`. A
 *                       drawn grid is what replaces it, at 44px a cell on a
 *                       coarse pointer — which is §5's floor and which the
 *                       native control honoured on a phone and nowhere else.
 *   segment stepping    Chromium's date input lets Up/Down step the segment the
 *                       caret is in. There is no segmented caret here — the
 *                       field is one text run — so that is gone. The grid's own
 *                       arrows are the replacement and they are better at the
 *                       thing people use stepping for (moving a day or a week);
 *                       they are worse at "the same day next year", which is
 *                       what the typed field is for.
 *   the UA clear button  Chromium draws an × in the field. Selecting the text
 *                       and deleting it is the replacement, and the screens that
 *                       need one-press clearing already have `FilterChips` and
 *                       "clear all" above the row.
 *
 * ## Why a date and not a file, which this deliberately does not touch
 *
 * `FileField` and `ImportSection` argue the native case for `<input type="file">`
 * and **this item does not overrule them.** The line between the two is not
 * "how much do we dislike the UA's paint", it is what the control's chrome is
 * *made of*:
 *
 *   a date input   renders the **value** — the thing the person entered and has
 *                  to read back — in a format only the browser chooses. There is
 *                  no version of "keep the native control" that fixes that,
 *                  because the format is the control.
 *   a file input   renders a **button and a filename**. Its untranslated words
 *                  are chrome around the value, not the value, and `FileField`
 *                  already draws over exactly those words while keeping the real
 *                  `<input type="file">` in the tab order — so it gets the
 *                  panel's language *and* the platform's picker, and gives up
 *                  nothing at all. That is a strictly better deal than this one
 *                  and it is available there because a file picker is an OS
 *                  dialog rather than a rendering of a value.
 *
 * So: redraw a control when the user agent owns the *value's* presentation and
 * will not hand it over. Do not redraw one when it owns only the chrome, because
 * the chrome can be drawn over without losing the control underneath.
 *
 * ## The measurement this rests on is somebody else's, and it is dated
 *
 * That Chromium ignores `lang` on a date input was measured on **2026-08-19** by
 * the coupons branch, and `Form.tsx`, `CouponForm.tsx`, `RangeControl.tsx`,
 * `AuditList.tsx` and `PaymentsLedger.tsx` all cite it. It was **re-measured on
 * 2026-08-31** for this branch rather than adopted on trust, and it reproduces.
 *
 * The method matters, because the obvious one does not work: the segment text
 * lives in a **closed** user-agent shadow root, so there is no property to read
 * and no `textContent` to query, and a headless browser does not take
 * synthesised keystrokes into the segments either — typing `03142026` at one
 * leaves `value` empty. What can be measured is what a person actually sees, so
 * this was read off a **screenshot** of the rendered control:
 *
 *   <html lang="ar" dir="rtl"> · <input type="date" lang="ar"> · empty
 *
 *   context locale fr-FR, no --lang        mm/dd/yyyy
 *   context locale ar-DZ, --lang=ar-DZ     mm/dd/yyyy
 *   context locale fr-FR, --lang=fr-FR     mm/dd/yyyy
 *   context locale fr-FR, --lang=en-GB     mm/dd/yyyy
 *
 * **`lang` on the element, `lang` on the document and `dir="rtl"` around it all
 * change nothing**, which is the 2026-08-19 claim exactly and is the one this
 * control was built against. Two honest limits on the rest: the harness's
 * Chromium answered `mm/dd/yyyy` under every UI language offered to it, so this
 * run cannot *demonstrate* the further claim that a desktop browser's own locale
 * is what decides — it only shows that nothing the **page** can say does. And it
 * is one engine; WebKit was not re-measured here.
 */

/* ---------------------------------------------------------------- the grid --- */

/**
 * The seven column headings, and the accessible name of each day.
 *
 * Both come from `Intl` rather than from `messages/*.json`, which is the one
 * place in this panel where that is right: a weekday name is not chrome the
 * panel wrote, it is data CLDR already holds in both languages, and a hand-kept
 * copy of it in two message files is fourteen strings that can drift from the
 * calendar they label.
 *
 * `weekday: "narrow"` for the visible heading, and `"long"` for the name a
 * screen reader gets — measured, because the obvious middle option does not
 * exist in one of the two languages:
 *
 *   fr-DZ   narrow  D L M M J V S          short  dim. lun. mar. …
 *   ar-DZ   narrow  ح ن ث ر خ ج س          short  الأحد الاثنين الثلاثاء …
 *
 * `short` in Arabic is the **full** name, which is four columns' worth of text
 * in a 44px cell. So the visible heading is `narrow` in both — and French's
 * narrow has two `M`s, for *mardi* and *mercredi*, which is why the full name is
 * carried in an `sr-only` span rather than left to the letter.
 */
function weekdayNames(intlLocale: string, first: number) {
  /* 2026-03-01 is a Sunday, so adding the column index to it walks the week
     from Sunday and `first` rotates the start. Any Sunday would do; a fixed one
     keeps this a pure function of the locale. */
  const sunday = Date.UTC(2026, 2, 1);
  const narrow = new Intl.DateTimeFormat(intlLocale, { weekday: "narrow", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(intlLocale, { weekday: "long", timeZone: "UTC" });

  return Array.from({ length: 7 }, (_, column) => {
    const date = new Date(sunday + (first + column) * 86_400_000);
    return { narrow: narrow.format(date), long: long.format(date) };
  });
}

/**
 * U+200E LEFT-TO-RIGHT MARK. Named rather than pasted: it renders as nothing, so
 * a literal one in a string is invisible to a reviewer and deleted by accident by
 * the next editor. See where it is used for what it is for.
 */
const LRM = "\u200E";

/** `fr-DZ` / `ar-DZ-u-nu-latn`, matching `lib/format/date.ts` and `lib/calendar.ts`. */
const CALENDAR_LOCALE: Record<string, string> = {
  fr: "fr-DZ",
  ar: "ar-DZ-u-nu-latn",
};

/* ------------------------------------------------------------- the control --- */

export function DatePicker({
  id,
  /**
   * The typed text, and it is the **caller's** state rather than this
   * component's.
   *
   * It lives in `DateField` because that is where `useField` decides when a
   * refusal may appear, and "this is not a date" is a verdict about the text
   * rather than about the `Y-m-d` the text parses to. Splitting it any other way
   * meant either this file re-implementing the validation latch or `DateField`
   * asking this one for its verdict through a callback fired during a render.
   */
  entry,
  onEntryChange,
  onEntryBlur,
  /** The committed `Y-m-d`, or `""`. What the grid draws as selected. */
  value,
  /** A day chosen from the grid. Always a real, in-range date. */
  onPick,
  describedBy,
  invalid = false,
  disabled = false,
  busy = false,
  /** `Y-m-d`. Days outside are drawn refused; see the note at `pickable`. */
  min,
  max,
  className = "",
}: {
  id: string;
  entry: string;
  onEntryChange: (next: string) => void;
  onEntryBlur: () => void;
  value: Ymd;
  onPick: (next: Ymd) => void;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  busy?: boolean;
  min?: string;
  max?: string;
  className?: string;
}) {
  const t = useTranslations("ui.date");
  const locale = useLocale();
  const rtl = dirFor(locale) === "rtl";
  const intlLocale = CALENDAR_LOCALE[locale] ?? CALENDAR_LOCALE.fr;

  const [open, setOpen] = useState(false);

  /**
   * The day the grid's roving focus is on, which also decides **which month is
   * drawn** — the two are one piece of state on purpose.
   *
   * A separate `month` would need reconciling every time an arrow key walked off
   * the end of one, and the reconciliation is the whole of the bug people hit:
   * the grid shows March, focus is on the 31st, ArrowDown lands on 7 April and
   * the grid still shows March with nothing focused in it. Deriving the month
   * from the cursor makes that state unrepresentable.
   */
  const [cursor, setCursor] = useState<Ymd>(() => value || todayYmd());

  /**
   * Whether the next render should move the DOM focus onto the cursor's cell.
   *
   * Set by the arrow keys and by opening; deliberately **not** set by the month
   * buttons, because a person clicking "next month" three times must keep the
   * button under their pointer and their focus. APG's date-picker dialog makes
   * exactly this distinction.
   */
  const wantsFocus = useRef(false);

  /**
   * The grid element, held as **state** rather than as a `useRef`, and it is a
   * measured fix rather than a style preference.
   *
   * Radix's `Presence` decides whether to render `Popover.Content` inside its own
   * layout effect, so the content is mounted **one commit after** `open` becomes
   * true. An effect keyed on `open` therefore runs while the table does not exist
   * yet — measured on `/fr/payments` and reproduced in jsdom: `open: true` with
   * `gridRef.current === null`, no cell found, focus left on the trigger, and
   * every arrow key going nowhere because focus was never in the grid. Nothing
   * errored; the calendar simply opened dead to the keyboard.
   *
   * A ref does not re-run anything when it is finally populated. State does, so
   * the effect below fires on the commit where the grid actually appears, and
   * again on every later cursor move, from one mechanism.
   */
  const [grid, setGrid] = useState<HTMLTableElement | null>(null);

  const captionId = useId();
  const today = todayYmd();
  const first = firstWeekday(locale);
  const weeks = monthGrid(`${cursor.slice(0, 7)}-01`, first);
  const headings = weekdayNames(intlLocale, first);

  const monthLabel = new Intl.DateTimeFormat(intlLocale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${cursor.slice(0, 7)}-01T00:00:00Z`));

  const dayLabel = new Intl.DateTimeFormat(intlLocale, { dateStyle: "full", timeZone: "UTC" });

  /**
   * The format hint, assembled from the locale's own field order rather than
   * written out in the message files — so it cannot disagree with what the field
   * actually accepts, which a hand-written `jj/mm/aaaa` in a third locale would.
   *
   * **The joiner carries U+200E LEFT-TO-RIGHT MARK and that is a bidi fix, not a
   * typo.** The Arabic words are `يوم`, `شهر`, `سنة`; joined with a bare slash
   * inside this `dir="ltr"` field, the two neutral slashes sit between two
   * strong RTL runs, take the RTL direction, and the whole hint renders
   * *right-to-left* — the reader is shown year first, which is the exact
   * ordering defect this control was built to fix, reintroduced in the
   * placeholder. The mark forces each separator to LTR so the three words are
   * laid out in the same order as the digits that will replace them.
   *
   * **Measured rather than reasoned about**, because rendered Arabic is not a
   * thing to eyeball: the words were swapped for countable runs of `ا` — one for
   * the day, two for the month, three for the year — and screenshotted in a box
   * carrying this field's own `dir="ltr"` and `unicode-bidi: isolate`.
   *
   *   with the marks     | / || / |||     the same order as `14/033/2026`
   *   without them       ||| / || / |     year first
   *

   * Written as an escape rather than as the character itself: an invisible
   * codepoint pasted into a source file is one a reviewer cannot see and the
   * next editor deletes by accident.
   */
  const pattern = fieldOrder(locale)
    .map((field) => t(field))
    .join(`${LRM}/`);

  useEffect(() => {
    if (!grid || !wantsFocus.current) return;
    wantsFocus.current = false;
    grid.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus();
  }, [grid, cursor]);

  const move = (next: Ymd) => {
    if (next === "") return;
    wantsFocus.current = true;
    setCursor(next);
  };

  /**
   * `min`/`max` refuse a **pointer**, and deliberately never refuse the keyboard.
   *
   * `Stepper` in `Form.tsx` already records the rule and the reason: a floor the
   * buttons respect and the keyboard does not, because typing a refused value has
   * to reach the field's own rule and the API's message, and a control that
   * silently clamped what was typed would hide both. Here the two callers that
   * pass bounds — `RangeControl` and every filter row — hold a cross-field rule
   * of their own ("the range is reversed", "longer than 92 days") whose message
   * is the useful one, and it only ever speaks if the value gets through.
   */
  const pickable = (day: Ymd) => withinRange(day, min, max);

  const onGridKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    /* Physical arrows, mirrored. In an Arabic grid the columns run
       right-to-left, so ArrowLeft is the *next* day — the visual mapping, which
       is what APG specifies and what the native control did. */
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";

    switch (event.key) {
      case back:
        move(shiftDays(cursor, -1));
        break;
      case forward:
        move(shiftDays(cursor, 1));
        break;
      case "ArrowUp":
        move(shiftDays(cursor, -7));
        break;
      case "ArrowDown":
        move(shiftDays(cursor, 7));
        break;
      case "Home":
        /* The first column of this row, whichever weekday the locale starts on —
           computed from the cursor's own offset rather than assumed to be
           Sunday, because Algeria's week starts on Saturday. */
        move(shiftDays(cursor, -weekOffset(cursor, first)));
        break;
      case "End":
        move(shiftDays(cursor, 6 - weekOffset(cursor, first)));
        break;
      case "PageUp":
        move(shiftMonths(cursor, event.shiftKey ? -12 : -1));
        break;
      case "PageDown":
        move(shiftMonths(cursor, event.shiftKey ? 12 : 1));
        break;
      default:
        return;
    }
    /* Only for the keys handled above: PageUp must not scroll the drawer behind
       the popover, and the arrows must not move the page. Everything else —
       Escape, Tab, Enter, typeahead — is left to Radix and the browser. */
    event.preventDefault();
  };

  const choose = (day: Ymd) => {
    onPick(day);
    setCursor(day);
    setOpen(false);
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          /* Opening lands on the chosen day, or on today when there is none —
             never on the 1st, which is a day nobody asked about. */
          setCursor(value || todayYmd());
          wantsFocus.current = true;
        }
        setOpen(next);
      }}
    >
      {/*
        The popover is anchored to the **whole field** rather than to the button
        that opens it, so the calendar's inline-start edge lines up with the
        field's in both directions. Anchoring to the trigger would hang a 300px
        grid off a 36px button at the field's inline end, which in Arabic is the
        left edge and in French the right.
      */}
      <PopoverPrimitive.Anchor asChild>
        <div
          className={[
            "ui-field ui-ring-within ui-interactive flex w-full items-center rounded-ui-md border bg-ui-surface ps-2.5 pe-0.5 text-ui-body text-ui-fg",
            invalid ? "border-ui-danger-fg" : "border-ui-line-control",
            disabled ? "cursor-not-allowed opacity-50" : "",
            className,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {/*
            A real, ordinary text input, and it is the answer to the requirement
            a drawn date picker usually loses: **a date can be typed without the
            calendar ever opening.** Tab into it, type, Tab out. There is no
            masking, no auto-advancing caret and no key interception — those are
            the three things that make a "smart" date field fight the person
            editing the middle of a value.

            `inputMode="numeric"` rather than `type="number"`, for `NumberField`'s
            reason: a number input silently drops what it cannot parse, and this
            field's whole refusal path depends on seeing what was typed.

            `dir="ltr"` with `unicodeBidi: isolate`, unchanged from the native
            control it replaces and for the same reason: `14/03/2026` is a run of
            digits and separators, and an Arabic paragraph around it reorders the
            groups so the reader is shown a date they did not enter.

            `autoComplete="off"`: a browser that offers to fill this from a saved
            address form would insert its own locale's format.
          */}
          <input
            id={id}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={entry}
            placeholder={pattern}
            disabled={disabled}
            aria-busy={busy || undefined}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => onEntryChange(event.target.value)}
            onBlur={onEntryBlur}
            dir="ltr"
            data-numeric=""
            style={{ unicodeBidi: "isolate" }}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-start outline-none placeholder:text-ui-subtle disabled:cursor-not-allowed"
          />

          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              aria-label={t("open")}
              title={t("open")}
              disabled={disabled}
              className="ui-date-trigger ui-interactive ui-hover-fill ui-ring flex shrink-0 cursor-pointer items-center justify-center rounded-ui-md text-ui-muted outline-none disabled:cursor-not-allowed"
            >
              {/*
                `calendar` was added to the sprite for this. Not `clock`, which is
                the panel's timestamp glyph and means an instant — the distinction
                `formatDay` and `formatDate` already draw one layer down.
              */}
              <Icon name="calendar" className="size-4" />
            </button>
          </PopoverPrimitive.Trigger>
        </div>
      </PopoverPrimitive.Anchor>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          /*
            8 rather than the 12 `Float.tsx` and `Listbox` use, and it is a
            measured figure rather than a preference. At the 340px floor with a
            coarse pointer the grid is seven 44px cells — §5's touch target —
            which is 308px, plus 8px of popover padding and 2px of border: 318.
            12px of collision padding leaves 316 and clips a column; 8 leaves 324
            and does not. A visible margin either way.
          */
          collisionPadding={8}
          aria-label={t("calendar")}
          onOpenAutoFocus={(event) => {
            /* Radix would focus the content wrapper. The cell is the right
               landing place — a person who opened this is choosing a day, and
               the arrow keys have to work on the first press. */
            event.preventDefault();
          }}
          className="ui-float ui-calendar z-50 p-1"
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t("previousMonth")}
              onClick={() => setCursor(shiftMonths(cursor, -1))}
              className="ui-date-trigger ui-interactive ui-hover-fill ui-ring flex shrink-0 cursor-pointer items-center justify-center rounded-ui-md text-ui-muted outline-none"
            >
              {/*
                `flipInRtl`, unlike the chevron on `Listbox`'s trigger and for the
                opposite reason: that one points at a list below it, which is
                below it in both directions. This one points *backwards along the
                row of months*, and the row runs the way the reader reads.
              */}
              <Icon name="back" flipInRtl className="size-4" />
            </button>

            {/*
              The live region, and it is the caption itself rather than a second
              hidden node. §5 asks for a live region on an async result; a month
              that changes under an unmoved focus is the same problem — the person
              pressed PageDown and nothing they can see told them where they now
              are.

              `aria-atomic`, so "avril 2026" is read whole rather than as the one
              word that changed.
            */}
            <div
              id={captionId}
              aria-live="polite"
              aria-atomic="true"
              className="min-w-0 flex-1 truncate text-center text-ui-compact font-semibold text-ui-fg"
            >
              {monthLabel}
            </div>

            <button
              type="button"
              aria-label={t("nextMonth")}
              onClick={() => setCursor(shiftMonths(cursor, 1))}
              className="ui-date-trigger ui-interactive ui-hover-fill ui-ring flex shrink-0 cursor-pointer items-center justify-center rounded-ui-md text-ui-muted outline-none"
            >
              <Icon name="chevron" flipInRtl className="size-4" />
            </button>
          </div>

          {/*
            A real `<table>` with `role="grid"`, which is APG's date-picker shape
            and is also what §5 asks of anything tabular: `<th scope="col">` for
            the weekday headings, one `role="gridcell"` per day.

            `role="grid"` on a real table rather than a div soup, so the row and
            column structure a screen reader navigates is the one the browser
            already computed.
          */}
          <table
            ref={setGrid}
            role="grid"
            aria-labelledby={captionId}
            onKeyDown={onGridKeyDown}
            className="ui-calendar-grid mt-1 w-full table-fixed"
          >
            <thead>
              <tr>
                {headings.map((heading) => (
                  <th key={heading.long} scope="col" className="pb-1 font-normal">
                    <span aria-hidden="true" className="text-ui-caption text-ui-muted">
                      {heading.narrow}
                    </span>
                    <span className="sr-only">{heading.long}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]}>
                  {week.map((day) => {
                    const selected = day === value;
                    const outside = !sameMonth(day, cursor);
                    const allowed = pickable(day);
                    return (
                      <td
                        key={day}
                        role="gridcell"
                        aria-selected={selected || undefined}
                        className="p-0"
                      >
                        <button
                          type="button"
                          data-day={day}
                          /* The roving tab stop: one cell in the grid is
                             tabbable, so Tab leaves the calendar rather than
                             walking 42 buttons. */
                          tabIndex={day === cursor ? 0 : -1}
                          aria-current={day === today ? "date" : undefined}
                          aria-label={dayLabel.format(new Date(`${day}T00:00:00Z`))}
                          aria-disabled={allowed ? undefined : true}
                          onClick={() => {
                            if (allowed) choose(day);
                          }}
                          className={[
                            "ui-calendar-day ui-interactive ui-ring flex w-full items-center justify-center rounded-ui-md text-ui-compact outline-none",
                            selected
                              ? "bg-ui-fg font-semibold text-ui-surface"
                              : outside
                                ? "ui-hover-fill text-ui-subtle"
                                : "ui-hover-fill text-ui-fg",
                            allowed ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                          ].join(" ")}
                        >
                          {/*
                            The digits are `Intl`'s, not `String(n)`: `ar-DZ` is
                            pinned to Latin digits in `lib/format/date.ts` and
                            reading them from the same formatter is what keeps a
                            cell and the field under it showing the same
                            numerals.
                          */}
                          {dayNumber(intlLocale, day)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/* ----------------------------------------------------------------- helpers --- */

/** How far into its week a day sits, given the locale's first column. */
function weekOffset(day: Ymd, first: number): number {
  const parts = readYmd(day);
  if (!parts) return 0;
  return (new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() - first + 7) % 7;
}

const numberCache = new Map<string, Intl.DateTimeFormat>();

function dayNumber(intlLocale: string, day: Ymd): string {
  let made = numberCache.get(intlLocale);
  if (!made) {
    made = new Intl.DateTimeFormat(intlLocale, { day: "numeric", timeZone: "UTC" });
    numberCache.set(intlLocale, made);
  }
  return made.format(new Date(`${day}T00:00:00Z`));
}
