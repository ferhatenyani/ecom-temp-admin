"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";
import type { Product } from "@/lib/api/schemas/product";
import { SHOP_CURRENCY, formatMoney } from "@/lib/format/money";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Form";
import { SearchField } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/States";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Isolate, Ltr } from "@/components/primitives/Ltr";

/**
 * Choose a product to put on an order. `GET /products`, inline, never an overlay.
 *
 * ## Lifted rather than copied, and this is the third time that argument has won
 *
 * The create drawer has held this search-plus-results list inline since the
 * order-entry branch. The **line-item editor on the order detail** is the second
 * form that has to add a product to an order, and `AddressFields.tsx` beside this
 * file already recorded what happens next: "two hand-maintained copies of eleven
 * controls drift by the third branch". A picker is worse than an address block
 * for it, because the parts most likely to drift are the parts nobody looks at —
 * the `enabled` gate that keeps it from firing while the drawer is shut, the SKU
 * hint, the `ac_manage_products` fallback, and the three states a query has.
 *
 * **`NewOrderDrawer` carried the copy this was lifted from, and no longer
 * does.** It was left in place when this file was written — that drawer was
 * being edited on another branch of the same step for the manual-price field,
 * and two agents rewriting one component is how a merge eats a docblock — with
 * the note that it should adopt this on the next touch. That touch was the
 * create-drawer branch and it did: `onPick` is its `addLine`, `enabled` is its
 * `open`, and nothing here was specific to editing an existing order.
 *
 * The removal paid for itself immediately. The two copies had already drifted
 * in three places that only showed up side by side — the create drawer's
 * results had no `disabled` state and stayed pressable while a save was in
 * flight, its fallback field carried no DOM `id` so no refusal could ever link
 * to it, and its query key was `["orders", "new", "products", …]` against this
 * one's `["orders", "picker", …]`, so one search typed in both drawers was two
 * requests against a cap shared by every open tab. `AddressFields.tsx`'s
 * "two hand-maintained copies of eleven controls drift by the third branch" was
 * right on the second.
 *
 * ## The one capability hole, kept exactly as it was
 *
 * `/products` is `ac_manage_products`. **`Order Manager` holds
 * `ac_manage_orders` and does not hold it** — a retired role, still held by
 * existing accounts and still returned by `/roles`, so this is live rather than
 * hypothetical. There is no orders-scoped catalogue route the way coupons grew
 * `/coupons/eligible-products`, and inventing one is a backend branch. So the
 * picker degrades to a product-id field that says why, and the API still
 * validates the id — worse than a picker, and much better than a 403 with no
 * explanation shown to the one role whose whole job is orders.
 */

const PICKER_PER_PAGE = 8;

/** What a caller needs from a chosen product, and no more. */
export type PickedProduct = Pick<Product, "id" | "name" | "sku" | "price">;

export function ProductPicker({
  /** DOM id namespace, so two pickers on one screen do not mint one id twice. */
  idPrefix,
  /** `ac_manage_products`. Resolved on the server — see the docblock. */
  canPick,
  /**
   * Nothing is fetched until this is true.
   *
   * Reads are 600/min per credential, shared across every tab the shop has open,
   * so a picker inside a closed drawer must not be spending them. Both callers
   * pass their `open` flag.
   */
  enabled,
  onPick,
  /**
   * Every product a results page carried, handed over once per fetch.
   *
   * The catalogue price is the reason this exists. An order's read shape carries
   * a line's *override* and never what the catalogue is asking — and `/products`
   * takes `search`, `status`, `orderby` and `category` with **no `include`**, so
   * there is no batched lookup by id and a per-line `GET /products/{id}` is the
   * request-per-row this panel refuses everywhere else. What the picker fetches
   * for its own sake is therefore the only free source there is, and a caller
   * that keeps it can label a line the search happened to name.
   *
   * Called from inside the query function rather than from a render or an
   * effect: it fires once per actual fetch, which is exactly the moment new
   * prices arrive, and never on a cache hit or a re-render.
   */
  onLoaded,
  disabled = false,
}: {
  idPrefix: string;
  canPick: boolean;
  enabled: boolean;
  onPick: (product: PickedProduct) => void;
  onLoaded?: (products: Product[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("orders.picker");
  const tOrders = useTranslations("orders");
  /* `useLocale()` rather than a prop: every other string in here comes from
     `useTranslations`, which reads the same provider, and threading a locale
     through a caller for one formatted figure is a prop nobody remembers. */
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [manualId, setManualId] = useState("");

  /* Submit-gated rather than bound: a request per keystroke against a shared
     600/min cap is how one open tab starves the others. */
  const products = useQuery({
    queryKey: ["orders", "picker", search],
    enabled: enabled && canPick,
    queryFn: async () => {
      const page = await acRead<Product[]>(
        `/products?per_page=${PICKER_PER_PAGE}&search=${encodeURIComponent(search)}`,
      );
      onLoaded?.(page.data);
      return page;
    },
    placeholderData: keepPreviousData,
  });

  if (!canPick) {
    /*
     * The `ac_manage_products` fallback. A person who cannot read the catalogue
     * can still put a known id on an order, and the API answers an id naming
     * nothing with a 400 rather than storing it — the same guarantee the picker
     * has, minus the name and minus the price.
     *
     * `price: ""` is the honest value and not a zero: nothing here knows what
     * the catalogue is asking, and a caller that seeded a price field from a
     * fabricated `0.00` would be putting a free line in front of somebody.
     */
    const id = manualId.trim();

    return (
      <div className="flex flex-wrap items-end gap-2">
        <TextField
          id={`${idPrefix}-manual-product`}
          label={t("manualId")}
          hint={t("manualIdWhy")}
          value={manualId}
          onChange={setManualId}
          isolate
          inputMode="numeric"
          disabled={disabled}
          className="flex-1"
        />
        <Button
          variant="secondary"
          disabled={disabled || !/^\d+$/.test(id)}
          onClick={() => {
            onPick({
              id: Number.parseInt(id, 10),
              name: t("manualName", { id }),
              sku: "",
              price: "",
            });
            setManualId("");
          }}
        >
          {t("add")}
        </Button>
      </div>
    );
  }

  const rows = products.data?.data ?? [];

  return (
    <>
      <SearchField
        value={search}
        onSubmit={setSearch}
        placeholder={t("search")}
        label={t("search")}
        clearLabel={tOrders("clearSearch")}
      />
      {/* The API folds a SKU lookup into `?search=`; WordPress's own `s` reads
          the title only, so a shop that knows a product by its code and typed it
          would otherwise conclude it is gone. */}
      <p className="text-ui-label text-ui-muted">{t("skuHint")}</p>

      {products.isPending ? (
        <SkeletonRegion label={t("loading")} className="flex flex-col gap-1">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="ui-field w-full rounded-ui-md" />
          ))}
        </SkeletonRegion>
      ) : products.isError ? (
        <p className="text-ui-label text-ui-danger-fg">{(products.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="search" message={t("noResults")} />
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(product)}
                className="ui-field ui-interactive ui-ring ui-hover-fill flex w-full cursor-pointer items-center gap-2 rounded-ui-md px-2 text-start text-ui-compact text-ui-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  {/* A product name is user content and may be in either
                      script, so the truncation follows the string. */}
                  <span dir="auto" className="block truncate">
                    {product.name}
                  </span>
                  <span className="block truncate text-ui-caption text-ui-subtle">
                    {product.sku !== "" ? (
                      <Ltr numeric={false}>{product.sku}</Ltr>
                    ) : (
                      t("noSku")
                    )}
                  </span>
                </span>
                <Isolate numeric className="shrink-0 text-ui-caption text-ui-subtle">
                  {formatMoney(product.price, SHOP_CURRENCY, locale)}
                </Isolate>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
