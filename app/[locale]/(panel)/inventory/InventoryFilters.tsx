"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { STOCK_STATUSES } from "@/lib/product-status";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Section, ChoiceGroup } from "@/components/ui/Form";
import type { InventoryQuery } from "./query";

/**
 * The stock list's filter drawer. See DESIGN.md §3.1 — filters are a `Drawer`'s
 * job.
 *
 * **Two dimensions, and it is still a drawer rather than two toolbar controls.**
 * The toolbar already carries the tab strip, the SKU lookup and the search box,
 * and measured at 340px the products branch found three labelled controls in one
 * row leaving the search field 55px wide. One button with a count is the same
 * answer that screen reached, and it keeps the two lists' toolbars the same
 * shape.
 *
 * Edits stage in a local draft and commit on **Apply** — the products drawer's
 * arrangement and the best thing about the sheet this replaces: one intent, one
 * history entry, one refetch, rather than one of each per checkbox. The draft is
 * re-seeded from the URL each time the drawer opens, adjusted during render
 * rather than in an effect, because an effect runs after paint and a re-opened
 * drawer would show one frame of the previous session's abandoned edits.
 *
 * **No counts anywhere.** `/inventory` publishes no facets, and a number counted
 * from the twenty rows in hand would be presented as though it covered all
 * thirty-three. `CheckRow` and `ChoiceGroup` both render a `0` when given one and
 * nothing when given `null`, which is why every option here passes neither.
 */
export function InventoryFilters({
  open,
  onOpenChange,
  query,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: InventoryQuery;
  onApply: (next: InventoryQuery) => void;
}) {
  const t = useTranslations("inventory");
  const tStock = useTranslations("stockStatus");

  const [draft, setDraft] = useState<InventoryQuery>(query);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(query);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t("filtersTitle")}
      size="sm"
      footer={
        <>
          {/* Clear first in DOM order, so it is the first tab stop and, on a
              phone, the lower of the two — `flex-col-reverse` puts Apply on top
              where the thumb is not. It clears this drawer's own dimensions and
              leaves the search term alone: that is a visible control elsewhere on
              the screen, and a button inside a panel that silently reaches
              outside it is a button nobody trusts twice. */}
          <Button
            variant="secondary"
            onClick={() =>
              setDraft((current) => ({ ...current, stockStatus: "", manageStock: "" }))
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
          `stock_status` is a closed enum the API validates: `?stock_status=zzz`
          is a 400, unlike `?nonsense=zzz` which is a silent 200. Single-select,
          because the parameter takes one value — a radio group rather than
          checkboxes that pretend otherwise, and "all" is a real option rather
          than an absence, because a radio cannot be unchecked by clicking it
          again.
        */}
        <Section title={t("filter.stockStatus")}>
          <ChoiceGroup
            label={t("filter.stockStatus")}
            value={draft.stockStatus}
            onChange={(next) => setDraft({ ...draft, stockStatus: next })}
            options={[
              { value: "", label: t("filter.any") },
              ...STOCK_STATUSES.map((value) => ({ value, label: tStock(value) })),
            ]}
          />
        </Section>

        {/*
          Tracking, as a filter rather than a fact buried in the rows. 8 of the 28
          top-level products track no quantity at all; seeing only the 20 that do
          is what makes the full list usable for a stocktake, and seeing only the
          8 that do not is how someone finds a product that should be tracked and
          is not.

          **Three states, not two: absent is not `false`.** The API only receives
          `manage_stock` when it is actually set — `InventoryController::index()`
          checks `has_param` for exactly this reason — so "Tous" is a distinct
          value here rather than the unchecked state of a switch.
        */}
        <Section title={t("filter.manageStock")} footnote={t("filter.manageStockNote")}>
          <ChoiceGroup
            label={t("filter.manageStock")}
            value={draft.manageStock}
            onChange={(next) => setDraft({ ...draft, manageStock: next })}
            options={[
              { value: "", label: t("filter.any") },
              { value: "true", label: t("manageStock.true") },
              { value: "false", label: t("manageStock.false") },
            ]}
          />
        </Section>
      </div>
    </Drawer>
  );
}
