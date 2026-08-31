"use client";

import { useQuery } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";

/**
 * Naming a product from the segments screen: the search, and the id → name
 * resolution a reopened segment needs.
 *
 * A module rather than a block inside `CriterionField.tsx`, on the test the last
 * eight floor entries apply — *a block that is only markup stays in its screen;
 * a block that owns decisions gets a file so the decisions have somewhere to be
 * argued.* It owns two, and the first of them contradicts the item text.
 *
 * ## The route is `/coupons/eligible-products`, and it is the **only** route
 * ## this screen reads — not a fallback for when `/products` is forbidden
 *
 * The item says: *"Use `/coupons/eligible-products` when `/products` is
 * forbidden. Marketing is `ac_manage_marketing`; the catalogue is
 * `ac_manage_products`, and a Marketing Manager holds the first and not the
 * second."* Both halves of that sentence are true and the conclusion drawn from
 * them is the weaker of the two available. Three facts, each read from source:
 *
 *   1. `Permissions/Capabilities.php:124-132` — `Marketing Manager` holds
 *      `ac_manage_marketing`, `ac_manage_content`, **`ac_manage_coupons`** and
 *      `ac_view_analytics`. Not `ac_manage_products`. So the gap is real, and
 *      the role that has it *does* hold the capability the picker routes are
 *      gated on: `Coupons/CouponController.php:38` builds its guard from
 *      `Capabilities::MANAGE_COUPONS`.
 *   2. Every role that can reach this screen at all holds `ac_manage_coupons`.
 *      Only three hold `ac_manage_marketing` — Super Admin (all thirteen), Admin
 *      (eleven, coupons among them) and Marketing Manager — and all three hold
 *      it. There is therefore **no reader for whom `/products` works and this
 *      route does not**, which is what makes "primary" and "fallback" the wrong
 *      shape for the pair.
 *   3. `/products` **cannot resolve an id list and this route can.**
 *      `ProductController::indexArgs()` declares `page`, `per_page`, `search`,
 *      `sku`, `status`, `orderby`, `order`, `category`, `tag`, `min_price`,
 *      `max_price`, `attributes`, `stock_status`, `on_sale`, `featured`,
 *      `rating_min`, `facets` — and no `include`. `ProductPicker.tsx` records the
 *      same absence for the order drawer and pays for it with an `onLoaded`
 *      callback that hands whole result pages up so a caller can build its own
 *      map. `CouponController::pickerArgs():274-292` declares `include` with the
 *      pattern `^$|^[0-9]+(,[0-9]+)*$`, and `CouponRepository:135-143` makes it
 *      do exactly what a reopened form needs.
 *
 * So this screen reads one route, always, and the reader who cannot use it is
 * the one who holds neither capability. That is a strictly smaller disclosure
 * than the catalogue — id, name, SKU and status, no price, no stock, no cost,
 * `CouponRepository::eligibleProducts():156-161` — which is the trade the two
 * picker routes were added to make, and it is the right trade here for the same
 * reason it was there.
 *
 * **The route's name is the backend's and not a claim about coupons.** The
 * plugin calls these "the two picker routes" in `CouponController:57-70`; that
 * they live under `/coupons/` is where the capability that gates them lives, not
 * a statement about what a caller is doing. `lib/api/allowlist.ts:286` already
 * permits `GET /coupons/eligible-products`, so nothing on the proxy widens for
 * this screen and `tests/boundary.test.ts:894` already asserts it.
 *
 * ## `include` resolves both ids in one request, and the widening is the point
 *
 * `CouponRepository:135-143`, quoted because three of its four lines are the
 * reason this is safe to build on:
 *
 *     $args['post__in']       = $criteria['include'];
 *     $args['posts_per_page'] = count($criteria['include']);
 *     $args['paged']          = 1;
 *     $args['post_status']    = 'any';
 *
 * An explicit id set bypasses paging entirely — so a resolution can never be
 * truncated by a page size — and widens the status window from the picker's
 * `publish, draft` to `any`, under the comment *"a trashed product in that set
 * still has a name"*. A segment naming a product that has since been trashed
 * therefore reads back with its name rather than as a bare number, which is
 * precisely the case a resolution exists for. `search` is ignored while
 * `include` is set (`CouponRepository:171-173`), so the two are never combined.
 *
 * ## What the resolution costs, stated as a bound rather than as a hope
 *
 * **One request, and at most one, per open of the form.** `criteria` is a JSON
 * object keyed by criterion name, so a segment holds at most one
 * `bought_product_id` and at most one `not_bought_product_id` — two ids, ever,
 * and both go in a single `include`. A segment with no product criterion sends
 * nothing at all, because the query is disabled on an empty id list rather than
 * asking for the empty set.
 *
 * That is the answer to "a request per criterion is not acceptable", and it is a
 * stronger answer than the one the customer picker could reach:
 * `useResolvedCustomers` in `marketing/campaigns/[id]/CustomerPicker.tsx` is
 * `useQueries` over `GET /customers/{id}`, one request each up to a cap of 25,
 * because `/customers` has no batch route either and an `ids` audience can name
 * a thousand people. Here the collection is bounded at two by the wire's own
 * shape, and a batch route exists. The shape it shares with that hook is the one
 * that matters: **an id that does not come back is not an error.** A product can
 * be deleted after a segment names it, and the API still stores and still
 * validates the id — so an unresolved id keeps its value and renders as itself.
 */

/** What a criterion needs to know about a product, and nothing more. */
export type EligibleProduct = {
  id: number;
  name: string;
  /** `null` where the product has none. `CouponRepository:159`. */
  sku: string | null;
  status: string;
};

/**
 * The page size for a search. Eight, matching `ProductPicker`'s
 * `PICKER_PER_PAGE`: this list is rendered inline inside a `Modal` rather than
 * in a drawer of its own, so it competes for height with the criteria above it —
 * `RestrictionPicker`'s fifty is a full-height `Drawer`'s figure and would push
 * the dialog past the viewport at the 340px floor.
 */
export const PRODUCT_SEARCH_PER_PAGE = 8;

/**
 * Search the pickable catalogue. Submit-gated by the caller, never bound.
 *
 * `ProductPicker`'s rule, and the reason survives the change of route intact: a
 * request per keystroke against a cap of 600/min shared by every open tab is how
 * one tab starves the others. The caller owns a committed `search` string and
 * this only ever fires when it changes.
 *
 * Unlike `ProductPicker`, an **empty search does not fire**. That picker opens
 * inside a drawer whose whole purpose is adding a line, so the first eight
 * products are a useful landing state; here the search sits under a criterion
 * somebody has just added to a form of up to eleven, and eight products nobody
 * asked for is eight rows of noise in a dialog. `CustomerPicker`'s
 * `search !== ""` gate, for the same reason it has it.
 */
export function useProductSearch(search: string, enabled: boolean) {
  return useQuery({
    queryKey: ["segments", "product-search", search],
    enabled: enabled && search.trim() !== "",
    queryFn: () =>
      acRead<EligibleProduct[]>(
        `/coupons/eligible-products?per_page=${PRODUCT_SEARCH_PER_PAGE}` +
          `&search=${encodeURIComponent(search.trim())}`,
      ),
    placeholderData: keepPreviousData,
  });
}

/**
 * Resolve the ids a saved segment arrived holding, in one request.
 *
 * The key is the **sorted** id list rather than the criteria object, so opening
 * the same segment twice is one cache entry and reordering two criteria in the
 * form is not a second request. `include` is order-insensitive on the wire —
 * `WP_Query`'s `post__in` with `orderby: title` — so nothing is lost by sorting.
 *
 * Returns a `Map` rather than an array: every caller is asking about one id it
 * already holds, and a `find()` per render over a list of two is the shape that
 * stops being free the day something else uses this.
 */
export function useResolvedProducts(
  ids: readonly number[],
  enabled: boolean,
): { names: Map<number, EligibleProduct>; pending: boolean; failed: boolean } {
  const wanted = [...new Set(ids)].sort((a, b) => a - b);

  const { data, isPending, isError } = useQuery({
    queryKey: ["segments", "product-names", wanted.join(",")],
    enabled: enabled && wanted.length > 0,
    queryFn: () =>
      acRead<EligibleProduct[]>(
        `/coupons/eligible-products?include=${wanted.join(",")}`,
      ),
    /* A resolved name does not change while a dialog is open, and the ids are
       stable for the life of the form, so the default 15s staleness would only
       ever buy a refetch on window focus that repaints identical text. */
    staleTime: Number.POSITIVE_INFINITY,
  });

  return {
    names: new Map((data?.data ?? []).map((row) => [row.id, row])),
    /* `isPending` is true for a *disabled* query too, which would read as "still
       loading" forever on a segment with no product criterion. The empty list is
       the resting state, not a pending one. */
    pending: wanted.length > 0 && isPending,
    failed: isError,
  };
}
