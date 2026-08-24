"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { EligibleCategory, EligibleProduct } from "@/lib/api/schemas/coupon";
import { acRead } from "@/lib/api/browser";
import { Drawer } from "@/components/ui/Overlay";
import { Button, IconButton } from "@/components/ui/Button";
import { CheckRow } from "@/components/ui/Form";
import { SearchField } from "@/components/ui/FilterBar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { PICKER_PER_PAGE, pickerKey, pickerParams } from "../query";

/**
 * The restriction picker — choose products or categories for a coupon.
 *
 * ## Why it reads from `/coupons/eligible-*` and not from `/products`
 *
 * A picker needs names. `/products` and `/product-categories` carry them and both
 * are `ac_manage_products` — **which a Marketing Manager does not hold**, though
 * they hold `ac_manage_coupons`. That is one of the three roles that can manage a
 * coupon, and the role whose job coupons are. Built on the catalogue routes, this
 * component would work for a Super Admin and a Manager and show a 403 to the
 * person who owns the screen.
 *
 * So the backend grew two narrow routes behind `ac_manage_coupons`, carrying id,
 * name, SKU and status and nothing else — no price, no stock, no cost. Strictly
 * less than the catalogue discloses, which is what made it the right shape:
 * widening `ac_manage_products` would have handed this role the whole catalogue in
 * order to give it a label.
 *
 * ## Why a picker rather than an id field
 *
 * **The API stores restriction ids blind — or it did.** `{"product_ids":
 * [999999]}` answered 200 and the coupon then applied to nothing while looking,
 * in every response and on every screen, exactly like a coupon that worked. The
 * write is validated now, but a text field that can produce a 400 the user cannot
 * diagnose is still the wrong control: a person does not know a product's id.
 *
 * ## What the redesign changed
 *
 * **A `Drawer`, not a bottom `Sheet`.** §3.1 gives the drawer exactly this job —
 * context beside the page — and the sheet it replaces was one iOS control doing
 * four unrelated ones.
 *
 * **Real checkboxes.** The rows were `<button role="checkbox">`, which announces
 * correctly and then behaves like neither: no space-to-toggle from the browser,
 * no form association. `Form.tsx`'s `CheckRow` is a real `<input type="checkbox">`
 * behind a drawn box, and it grew `secondary` and `badge` on this branch so the
 * SKU line, the "sans référence" fallback, the category's product count and the
 * draft badge all survived the migration instead of being quietly dropped.
 *
 * **The search is submit-gated.** It fired a request per keystroke, and a coupon
 * form can open this four times — so typing `AC-TAP-001` was eleven requests
 * against a budget of 600/min shared across every tab the person has open.
 * `SearchField` submits on Enter and carries its own clear button.
 */

/**
 * One row shape for both routes. A product carries a SKU and a status; a category
 * carries a product count. Nothing carries a price — see the docblock above.
 */
type PickerRow = {
  id: number;
  name: string;
  sku: string | null;
  status: string | null;
  count: number | null;
};

export function RestrictionPicker({
  open,
  onOpenChange,
  kind,
  title,
  selected,
  onCommit,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "products" | "categories";
  title: string;
  /** The ids currently on the coupon. The drawer edits a copy and commits on apply. */
  selected: number[];
  /**
   * The committed ids, **and the names this picker displayed for them**.
   *
   * The second argument is the fix for a real defect: the form used to render its
   * ids from the draft and their names from the last *saved* response, so adding
   * a product to a coupon that already had one showed the old name beside the new
   * count. The picker is the only thing that knows the name of an id it has just
   * added — the form cannot resolve one without a request — so it hands them over
   * rather than leaving the form to guess or to lie.
   */
  onCommit: (ids: number[], names: Map<number, string>) => void;
  /** The row button focus returns to. See `useOpenerFocus` in Overlay.tsx. */
  returnFocusTo?: string;
}) {
  const t = useTranslations("coupons");
  const tTable = useTranslations("ui.table");

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  /*
   * A draft, committed on "apply" rather than on every tick.
   *
   * The alternative — writing straight through to the form — makes the drawer's
   * cancel button a lie, and this drawer is reached from a form that already has
   * its own dirty state and save bar. Two levels of undo with one level of
   * cancelling is how a person loses a selection they thought they had discarded.
   *
   * Keyed on `open` so reopening re-seeds from the coupon rather than
   * resurrecting a draft the person cancelled.
   */
  const [draft, setDraft] = useState<number[]>(selected);
  const [seededFor, setSeededFor] = useState(open);

  /**
   * Every name this drawer has put on screen since it opened.
   *
   * A person can search, tick a row, search again and apply — so the rows
   * rendered *at* the moment of commit are not all the rows the commit covers. A
   * ref rather than state because nothing renders from it: it is read once, by
   * `onCommit`, and emptied when the drawer opens.
   */
  const seen = useRef(new Map<number, string>());

  /* Emptied in an effect rather than in the re-seed block below, because a ref
     read or written during render is a value React is free to discard. */
  useEffect(() => {
    if (open) seen.current = new Map();
  }, [open]);

  if (open !== seededFor) {
    setSeededFor(open);
    if (open) {
      setDraft(selected);
      setSearch("");
      setPage(1);
    }
  }

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: pickerKey(kind, search, page),
    queryFn: async () => {
      /*
       * Both routes are normalised into one row shape here rather than narrowed at
       * every use site. The schemas are `looseObject`s, so their index signature is
       * `unknown` and an `in` check narrows the *key* without narrowing the value —
       * `row.count` would still be `unknown` inside `if ("count" in row)`. One
       * mapping is also the honest place to say which fields each route carries.
       */
      if (kind === "products") {
        const { data, total } = await acRead<EligibleProduct[]>(
          `/coupons/eligible-products?${pickerParams(search, page)}`,
        );
        return {
          rows: data.map(
            (row): PickerRow => ({
              id: row.id,
              name: row.name,
              sku: row.sku,
              status: row.status,
              count: null,
            }),
          ),
          total,
        };
      }

      const { data, total } = await acRead<EligibleCategory[]>(
        `/coupons/eligible-categories?${pickerParams(search, page)}`,
      );
      return {
        rows: data.map(
          (row): PickerRow => ({
            id: row.id,
            name: row.name,
            sku: null,
            // A category carries no status: `hide_empty=false`, and there is no
            // draft state for a term.
            status: null,
            count: row.count,
          }),
        ),
        total,
      };
    },
    // Nothing is fetched until the drawer is open: a coupon form usually saves
    // without anyone touching the restrictions, and this is two requests.
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PICKER_PER_PAGE));

  /* Recorded after paint, not during it: writing to a ref while rendering makes
     the render impure and the value it captures depends on how often React
     chooses to re-run it. Keyed on `data` rather than on `rows`, which is a fresh
     array on every render and would make this an effect that never settles. */
  useEffect(() => {
    for (const row of data?.rows ?? []) seen.current.set(row.id, row.name);
  }, [data]);

  const toggle = (id: number) =>
    setDraft((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={t("picker.description")}
      size="sm"
      returnFocusTo={returnFocusTo}
      footer={
        <>
          {/* Cancel first in DOM order, so it is the first tab stop and, on a
              phone, the lower of the two — `OverlayFrame` reverses the column. */}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("picker.cancel")}
          </Button>
          <Button
            onClick={() => {
              onCommit(draft, seen.current);
              onOpenChange(false);
            }}
          >
            {/*
              The count is on the button because it is the thing that changed and
              the list is tall enough that the ticked rows may all be scrolled
              off. `Isolate`, not `Ltr`: a translated string carrying a number.
            */}
            <Isolate numeric>{t("picker.apply", { count: draft.length })}</Isolate>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SearchField
          value={search}
          onSubmit={(next) => {
            setSearch(next);
            setPage(1);
          }}
          placeholder={
            kind === "products" ? t("picker.searchProducts") : t("picker.searchCategories")
          }
          label={
            kind === "products" ? t("picker.searchProducts") : t("picker.searchCategories")
          }
          clearLabel={t("clearSearch")}
        />

        {/*
          The product search matches the SKU as well as the name, and says so.
          WordPress's own `s` reads the title and the content only, so a shop that
          knows a product by `AC-SEO-TAPIS` and typed it would have got an empty
          picker and concluded the product was not there. The backend folds a SKU
          lookup in; this line is how a person finds out they can use it.
        */}
        {kind === "products" ? (
          <p className="text-ui-label text-ui-muted">{t("picker.skuHint")}</p>
        ) : null}

        {isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : isPending ? (
          /* Six rows at the real row's height: `CheckRow` wears `.ui-field`, which
             is 36px on a pointer and 44px on touch, so the placeholder grows with
             it rather than settling upward on a phone. */
          <SkeletonRegion label={t("loading")} className="flex flex-col gap-1">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="ui-field w-full rounded-ui-md" />
            ))}
          </SkeletonRegion>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={search === "" ? "box" : "search"}
            message={search === "" ? t("picker.none") : t("picker.noResults")}
            action={
              search === ""
                ? undefined
                : { label: t("clearSearch"), onClick: () => setSearch("") }
            }
          />
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <CheckRow
                key={row.id}
                checked={draft.includes(row.id)}
                onChange={() => toggle(row.id)}
                label={row.name}
                /*
                  A draft product is a legitimate restriction — a shop sets a
                  launch discount up before the product goes live — so it is
                  offered rather than filtered out, and badged so nobody restricts
                  a live coupon to something no shopper can buy.
                */
                badge={
                  row.status === "draft" ? (
                    <Badge tone="warning">{t("status.draft")}</Badge>
                  ) : undefined
                }
                secondary={
                  row.sku !== null && row.sku !== "" ? (
                    // A SKU is an identifier and reorders inside Arabic text.
                    <Ltr numeric={false}>{row.sku}</Ltr>
                  ) : row.count !== null ? (
                    <Isolate numeric>{t("picker.productCount", { count: row.count })}</Isolate>
                  ) : (
                    t("picker.noSku")
                  )
                }
              />
            ))}
          </div>
        )}

        {total > PICKER_PER_PAGE ? (
          <nav aria-label={tTable("pageOf", { page, pages: pageCount })}>
            <div className="flex items-center justify-between gap-3">
              <IconButton
                label={t("picker.previous")}
                icon="back"
                flipInRtl
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              />
              <span className="text-ui-label text-ui-muted" data-numeric="">
                {tTable("pageOf", { page, pages: pageCount })}
              </span>
              <IconButton
                label={t("picker.next")}
                icon="chevron"
                flipInRtl
                variant="secondary"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              />
            </div>
          </nav>
        ) : null}
      </div>
    </Drawer>
  );
}
