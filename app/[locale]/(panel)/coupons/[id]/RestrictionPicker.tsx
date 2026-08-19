"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { EligibleCategory, EligibleProduct } from "@/lib/api/schemas/coupon";
import { acRead } from "@/lib/api/browser";
import { Sheet } from "@/components/primitives/Sheet";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { SectionError } from "@/components/patterns/States";
import { useHydrated } from "@/lib/use-hydrated";
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
 * diagnose is still the wrong control: a person does not know a product's id, and
 * the HIG's own rule is to offer a choice rather than ask for typed data whenever
 * a choice is possible.
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "products" | "categories";
  title: string;
  /** The ids currently on the coupon. The sheet edits a copy and commits on save. */
  selected: number[];
  onCommit: (ids: number[]) => void;
}) {
  const t = useTranslations("coupons");
  const hydrated = useHydrated();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  /*
   * A draft, committed on "apply" rather than on every tap.
   *
   * The alternative — writing straight through to the form — makes the sheet's
   * cancel button a lie, and this sheet is reached from a form that already has
   * its own dirty state and save bar. Two levels of undo with one level of
   * cancelling is how a person loses a selection they thought they had discarded.
   *
   * Keyed on `open` so reopening the sheet re-seeds from the coupon rather than
   * resurrecting a draft the person cancelled.
   */
  const [draft, setDraft] = useState<number[]>(selected);
  const [seededFor, setSeededFor] = useState(open);

  if (open !== seededFor) {
    setSeededFor(open);
    if (open) {
      setDraft(selected);
      setSearch("");
      setPage(1);
    }
  }

  const { data, isPending, isError, error } = useQuery({
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
    // Nothing is fetched until the sheet is open: a coupon form usually saves
    // without anyone touching the restrictions, and this is two requests.
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PICKER_PER_PAGE));

  const toggle = (id: number) =>
    setDraft((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={t("picker.description")}
      footer={
        <div className="flex items-center gap-3">
          <Button variant="plain" onClick={() => onOpenChange(false)} className="flex-1">
            {t("picker.cancel")}
          </Button>
          <Button
            variant="filled"
            onClick={() => {
              onCommit(draft);
              onOpenChange(false);
            }}
            className="flex-1"
          >
            {/*
              The count is on the button because it is the thing that changed and
              the sheet is tall enough that the selected rows may all be scrolled
              off. `Ltr` because a bare numeral inside Arabic text reorders.
            */}
            <Isolate numeric>{t("picker.apply", { count: draft.length })}</Isolate>
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
          }}
          className="flex items-center gap-2 rounded-md bg-surface-2 px-3"
        >
          <Icon name="search" className="size-4 shrink-0 text-label-secondary" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            disabled={!hydrated}
            aria-busy={!hydrated || undefined}
            placeholder={
              kind === "products" ? t("picker.searchProducts") : t("picker.searchCategories")
            }
            aria-label={
              kind === "products" ? t("picker.searchProducts") : t("picker.searchCategories")
            }
            enterKeyHint="search"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-tertiary disabled:opacity-40"
          />
        </form>

        {/*
          The product search matches the SKU as well as the name, and says so.
          WordPress's own `s` reads the title and the content only, so a shop that
          knows a product by `AC-SEO-TAPIS` and typed it would have got an empty
          picker and concluded the product was not there. The backend folds a SKU
          lookup in; this line is how a person finds out they can use it.
        */}
        {kind === "products" ? (
          <p className="px-1 text-caption text-label-tertiary">{t("picker.skuHint")}</p>
        ) : null}

        {isError ? (
          <SectionError>{(error as Error).message}</SectionError>
        ) : isPending ? (
          <div role="status" aria-busy="true" className="overflow-hidden rounded-lg bg-surface">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="list-row flex items-center gap-3 px-4 py-3">
                <div className="skeleton size-5 shrink-0 rounded-sm" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="skeleton h-5 w-40 rounded-sm" />
                  <div className="skeleton h-4 w-24 rounded-sm" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-lg bg-surface px-4 py-8 text-center text-body text-label-secondary">
            {search === "" ? t("picker.none") : t("picker.noResults")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg bg-surface">
            {rows.map((row) => {
              const checked = draft.includes(row.id);

              return (
                <button
                  key={row.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={!hydrated}
                  onClick={() => toggle(row.id)}
                  className="list-row press-row flex min-h-11 w-full items-center gap-3 px-4 py-3 text-start disabled:opacity-40"
                >
                  {/*
                    A drawn checkbox rather than a native one: the row is the
                    target, at 44px, and a native input inside a button is not a
                    control anyone can style consistently across both engines.
                    `aria-checked` on the button is what a screen reader reads.
                  */}
                  <span
                    aria-hidden="true"
                    className={`flex size-5 shrink-0 items-center justify-center rounded-sm ${
                      checked ? "bg-accent" : "bg-fill"
                    }`}
                  >
                    {checked ? <Icon name="check" className="size-3.5 text-bg" /> : null}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-h-6 items-center gap-2">
                      {/* Product and category names are user content in whichever
                          language they were typed — `dir="auto"` so the ellipsis
                          lands at the name's own end in both locales. */}
                      <span dir="auto" className="truncate text-body text-label">
                        {row.name}
                      </span>
                      {/*
                        A draft product is a legitimate restriction — a shop sets
                        a launch discount up before the product goes live — so it
                        is offered rather than filtered out, and badged so nobody
                        restricts a live coupon to something no shopper can buy.
                      */}
                      {row.status === "draft" ? (
                        <StatusBadge tone="warning" className="shrink-0">
                          {t("status.draft")}
                        </StatusBadge>
                      ) : null}
                    </span>

                    <span className="text-footnote text-label-secondary">
                      {row.sku !== null && row.sku !== "" ? (
                        // A SKU is an identifier and reorders inside Arabic text.
                        <Ltr numeric={false} className="truncate">
                          {row.sku}
                        </Ltr>
                      ) : row.count !== null ? (
                        <Isolate numeric>{t("picker.productCount", { count: row.count })}</Isolate>
                      ) : (
                        <span className="text-label-tertiary">{t("picker.noSku")}</span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {total > PICKER_PER_PAGE ? (
          <nav className="flex items-center justify-between gap-3">
            <Button
              variant="plain"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("picker.previous")}
            </Button>
            <span className="text-footnote text-label-secondary">
              <Ltr numeric>
                {page} / {pageCount}
              </Ltr>
            </span>
            <Button
              variant="plain"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("picker.next")}
            </Button>
          </nav>
        ) : null}
      </div>
    </Sheet>
  );
}
