import { rangeFromParams, rangeToParams, type RangeQuery } from "@/lib/analytics";

/**
 * The analytics screen's URL state: which report, and over what window.
 *
 * One route with six views, which is the arrangement inventory (three) and
 * shipping (two) already use. The reason is stronger here than on either: the six
 * reports share a *date range*, and splitting them across six routes would mean
 * six copies of the range control and a window that resets every time someone
 * moves between reports. A person comparing COD confirmation against shipping
 * delivery over the same fortnight would have to set the fortnight twice.
 *
 * `overview` is deliberately **not** one of the six. It is the dashboard, at
 * `/dashboard`, because its job is different — cards that drill into a filtered
 * list rather than a report to read.
 *
 * That last clause used to read "and because it is the panel's tab-bar
 * destination while this is a `/more` one". Both surfaces are gone — the tab bar
 * and `/more` were deleted by the teardown — and the sentence was describing a
 * shell that no longer exists. The reason above never depended on either.
 */

export const VIEWS = [
  "revenue",
  "orders",
  "products",
  "customers",
  "shipping",
  "cod",
] as const;
export type View = (typeof VIEWS)[number];

export const DEFAULT_VIEW: View = "revenue";

export type AnalyticsQuery = { view: View; range: RangeQuery };

export function queryFromParams(params: URLSearchParams): AnalyticsQuery {
  const view = params.get("view") ?? "";

  return {
    view: (VIEWS as readonly string[]).includes(view) ? (view as View) : DEFAULT_VIEW,
    range: rangeFromParams(params),
  };
}

/**
 * The URL the screen writes back. Defaults are omitted so a shared link carries
 * only what was chosen — and so a link to the revenue report over the default
 * window is `/analytics`, not `/analytics?view=revenue&range=30d`.
 */
export function paramsFromQuery(query: AnalyticsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.view !== DEFAULT_VIEW) params.set("view", query.view);
  return rangeToParams(query.range, params);
}

/** Which endpoint a view reads. One request per screen; the API caches for 60 s. */
export const VIEW_ROUTE: Record<View, string> = {
  revenue: "/analytics/revenue",
  orders: "/analytics/orders",
  products: "/analytics/products",
  customers: "/analytics/customers",
  shipping: "/analytics/shipping",
  cod: "/analytics/cod",
};
