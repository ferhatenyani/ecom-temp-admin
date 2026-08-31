"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ALL_REASONS } from "@/lib/movement-reason";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Section, ChoiceGroup, CheckRow, DateField } from "@/components/ui/Form";
import type { MovementsQuery } from "./query";

/**
 * The ledger's filter drawer.
 *
 * Edits stage in a local draft and commit on **Apply** — one intent, one history
 * entry, one pair of requests, rather than one of each per tap. Re-seeded from
 * the URL each time it opens, adjusted during render rather than in an effect,
 * because an effect runs after paint and a re-opened drawer would show one frame
 * of the previous session's abandoned edits.
 */
export function MovementFilters({
  open,
  onOpenChange,
  query,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: MovementsQuery;
  onApply: (next: MovementsQuery) => void;
}) {
  const t = useTranslations("inventory");
  const tReason = useTranslations("movementReason");

  const [draft, setDraft] = useState<MovementsQuery>(query);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(query);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t("movesFiltersTitle")}
      size="sm"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                reason: "",
                actor: "",
                dateFrom: "",
                dateTo: "",
              }))
            }
          >
            {t("clearFilters")}
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onApply(draft);
            }}
          >
            {t("apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/*
          **The reasons come from `ALL_REASONS`, never from the summary.**

          The summary is a set of counts, exactly as a product facet is: it omits
          every reason with no rows, so `customer_return` and `other` are absent
          from it today and a list built from it would silently lose two of the
          six reasons a person can create at any moment. All nine are offered,
          including the three a person may never *write*: `?reason=order_reduced`
          filters the ledger perfectly well — 480 of the 1154 rows — and is one of
          the more useful things to ask it.

          **And no counts beside them**, which is the other half of the same
          separation. The counts would have to come from the summary, and the
          summary's own scope is unmeasured: `summaryParams()` sends `reason`,
          `product_id` and `actor_id` because it is the ledger's request minus its
          pagination, and nothing measured says the endpoint reads any of the
          three. A count whose scope is unknown is worse than no count.

          Single-select, because `?reason=` takes one value — a radio group rather
          than checkboxes that pretend otherwise, and "all" is a real option
          rather than an absence, because a radio cannot be unchecked by clicking
          it again.
        */}
        <Section title={t("filter.reason")} footnote={t("ledger.summaryOmits")}>
          <ChoiceGroup
            label={t("filter.reason")}
            value={draft.reason}
            onChange={(next) => setDraft({ ...draft, reason: next })}
            options={[
              { value: "", label: t("filter.any") },
              ...ALL_REASONS.map((reason) => ({ value: reason, label: tReason(reason) })),
            ]}
          />
        </Section>

        {/*
          The only identity control the ledger can honestly offer. `?actor_id=`
          genuinely filters — verified 1154 → 16 — while `actor_id` cannot be
          turned into a *name* for three of the four roles that hold
          `ac_manage_inventory`. So identity survives as something to pivot on
          even though it is not something to print.
        */}
        <Section title={t("filter.actor")} footnote={t("ledger.whoUnavailable")}>
          <CheckRow
            label={t("filter.mine")}
            count={null}
            checked={draft.actor === "me"}
            onChange={(next) => setDraft({ ...draft, actor: next ? "me" : "" })}
          />
        </Section>

        {/*
          `/inventory/movements` validates `YYYY-MM-DD` and answers 400 to
          anything else — measured on `?date_from=zzz` — so a control that can
          only hand over that shape is the right one. `DateField` still is: it
          takes and returns `Y-m-d` and reports the empty string for anything it
          cannot read, so a half-typed date reaches this screen as "no filter"
          rather than as a 400. Bounded to each other so a reversed pair is hard
          to express.

          This comment used to say **"native date inputs"** and add that the
          platform control was already localised. The first half is no longer
          true — `DateField` is drawn now, on Radix Popover — and the second half
          was the claim that turned out to be wrong: the native control was
          localised to the *browser*, so the Arabic drawer rendered `mm/dd/yyyy`.
          `components/ui/DatePicker.tsx` carries the argument.

          **This drawer is one of the two reasons the calendar is a Popover and
          never collapses to a Modal below `sm`.** §3.1 forbids nesting overlays
          — "a modal that needs a second modal is a modal that needs steps" — and
          at the 340px floor a `Drawer` is already full screen, so a modal date
          picker opened from inside one would erase the filters behind it.
          `Float.tsx`'s `Popover` takes that collapse; `DatePicker` deliberately
          does not, and its grid fits the floor width instead.
        */}
        <Section title={t("filter.window")}>
          <div className="flex flex-col gap-3">
            <DateField
              label={t("filter.dateFrom")}
              value={draft.dateFrom}
              max={draft.dateTo || undefined}
              onChange={(next) => setDraft({ ...draft, dateFrom: next })}
            />
            <DateField
              label={t("filter.dateTo")}
              value={draft.dateTo}
              min={draft.dateFrom || undefined}
              onChange={(next) => setDraft({ ...draft, dateTo: next })}
            />
          </div>
        </Section>
      </div>
    </Drawer>
  );
}
