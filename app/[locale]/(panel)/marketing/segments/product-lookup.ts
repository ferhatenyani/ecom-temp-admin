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
 * `productRefState()` below is that sentence made into a verdict the form can
 * warn about; item D10.
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
): ProductLookup {
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

/** What `useResolvedProducts` returns, named so a verdict can take it whole. */
export type ProductLookup = {
  names: Map<number, EligibleProduct>;
  pending: boolean;
  failed: boolean;
};

/**
 * What the panel can **honestly** say about one product id a segment names.
 *
 * ## Decision 5, and the half of it that is not the message
 *
 * *"Warn on screen, still allow saving. Deleting a product must not silently
 * rewrite somebody's saved segment."* The wording is the easy half. The hard half
 * is that three of the five states below are states in which the panel **does not
 * know** whether anything is wrong, and a warning shown in any of them is a
 * screen inventing a fact:
 *
 *   `pending`      the lookup is in flight, or has not been enabled — a segment
 *                  with no product criterion, or a reader without
 *                  `ac_manage_coupons`, for whom the query never runs at all.
 *   `unresolvable` the lookup **failed**. A 403, a dropped request, an offline
 *                  tab. The id may name a perfectly healthy product; nothing was
 *                  learnt. Absence of evidence, and the one branch a warning
 *                  would be most tempting to collapse into `missing`.
 *   `listed`       resolved, with a status the picker itself would have offered.
 *   `trashed`      resolved, and in the trash. See below — this is the branch the
 *                  widened status window exists for, and the one that cannot be
 *                  verified from here.
 *   `missing`      the lookup **succeeded** and the id was not in the answer.
 *                  `CouponRepository::eligibleProducts():175-178` reports
 *                  `count($items)` rather than `found_posts` and an id naming
 *                  nothing is simply absent — not a 404 and not a null row — so
 *                  this is the only branch that is evidence of anything.
 *
 * ## Why `missing` does not say "deleted", and why that is not timidity
 *
 * Because the panel cannot tell a deletion from a disappearance. `include`
 * widens `post_status` from the picker's `publish, draft` to WordPress's `any`
 * — that much is **read from source**, `CouponRepository:135-143` — and the
 * plugin's comment beside the line says what it expects of it: *"a trashed
 * product in that set still has a name"*. `CMS/CmsController::statusArg()`
 * states the same belief in the opposite direction, refusing WordPress's `any`
 * *"which includes the trash"*.
 *
 * **Both may be wrong, and neither could be checked here.** `WP_Query` is
 * understood to expand `post_status => 'any'` to *every status except those
 * registered `exclude_from_search`*, and `trash` is registered `internal`, which
 * is what `exclude_from_search` defaults to — in which case the trash is
 * excluded by the very clause the plugin added in order to include it. That
 * sentence is recollection, not a citation: WordPress core is in neither
 * repository (it lives in the `wordpress_data` volume `compose.yaml` mounts,
 * and `class-wp-query.php` exists nowhere on this machine), and this lane may
 * not start the stack. So it is **neither read from source nor measured**, and
 * it is written down as the open question it is rather than as a finding.
 *
 * So the code is built to be correct under **both** readings, which is why the
 * question did not have to be answered first:
 *
 *   * if `any` really does return the trash, a trashed product arrives named and
 *     carrying `status: "trash"`, and `trashed` gets its own, softer sentence —
 *     the criterion still means what it meant, and the remedy is the trash rather
 *     than this form;
 *   * if it does not, `trashed` is dead against the live shop and every trashed
 *     product arrives as `missing` — where the message deliberately says *the
 *     shop cannot name it* rather than *it was deleted*, which is true of a
 *     trashed product, a force-deleted one, and one that never existed alike.
 *
 * The mock takes the plugin at its word — `eligibleProductsListing()` resolves an
 * `include` out of `catalogue()`, which holds the trashed product 211 — so the
 * `trashed` branch is exercised there whatever the shop does.
 *
 * ## Nothing here can refuse a save
 *
 * A verdict is a string this module returns and `SegmentModal.save` never reads.
 * The value on the wire comes from `criteria`, which the warning does not touch,
 * and the API validates the id with `ctype_digit` and nothing else
 * (`Campaigns/SegmentCriteria.php`, documented *"Pure — no WordPress, no
 * database"*). A panel that cleared the field because it could not name it would
 * be editing a segment nobody asked to edit — and would do so most eagerly in
 * `unresolvable`, where it knows least.
 */
export type ProductRefState =
  | "pending"
  | "unresolvable"
  | "listed"
  | "trashed"
  | "missing";

export function productRefState(id: number, lookup: ProductLookup): ProductRefState {
  /* Order matters and is the order of what is known. `failed` is tested before
     `pending` because react-query reports a failed query as settled, and
     `pending` before the map because an empty map is what a query in flight
     always has. */
  if (lookup.failed) return "unresolvable";
  if (lookup.pending) return "pending";

  const row = lookup.names.get(id);
  if (row === undefined) return "missing";
  /* The one status worth a sentence of its own. `draft`, and any of the further
     statuses the widened window can return — `pending`, `private`, `future` —
     are **not** warned about: a segment criterion is about orders that already
     happened, so a product being unlisted today says nothing about whether it
     was bought. `CouponRepository:159` sends `$post->post_status` verbatim. */
  return row.status === "trash" ? "trashed" : "listed";
}
