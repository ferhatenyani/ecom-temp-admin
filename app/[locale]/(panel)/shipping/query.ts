import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/shipment-status";

/**
 * The shipping screen's URL state.
 *
 * One route, two views — the arrangement the inventory screen already uses, for
 * the same reason: the tariff and the parcels are one person's job and splitting
 * them across two tab-bar destinations would spend a slot the bar does not have.
 *
 * Measured 2026-08-20 against the live router, each parameter sent on its own
 * with `?bogus_param=1` as the control for "silently ignored":
 *
 * | Sent | Answer |
 * |---|---|
 * | `?status=delivered` | 74 of 111 — real |
 * | `?status=zzz` | **400**, `details.params.status` naming all ten |
 * | `?provider=acfake` | 37 of 111 — real |
 * | `?order_id=3939` | 2 — real |
 * | `?is_live=true` | **111 — ignored**, identical to `?bogus_param=1` |
 *
 * `is_live` is the trap. It is a real field on every row and reads exactly like a
 * filter, and the API does not implement one — so *live parcels only*, which is
 * the single most useful thing an operator could ask for, is not a request the
 * server can answer. The panel filters the page it has and says so rather than
 * sending a parameter that would silently return everything.
 */

export const VIEWS = ["rules", "parcels"] as const;
export type View = (typeof VIEWS)[number];

/** `""` is "every status" and is the absence of the parameter, not a value. */
export const STATUS_FILTERS = ["", ...SHIPMENT_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const PER_PAGE = 20;

export type ShippingQuery = {
  view: View;
  status: StatusFilter;
  page: number;
};

export const DEFAULT_QUERY: ShippingQuery = { view: "rules", status: "", page: 1 };

export function queryFromParams(params: URLSearchParams): ShippingQuery {
  const view = params.get("view");
  const status = params.get("status") ?? "";
  const page = Number.parseInt(params.get("page") ?? "1", 10);

  return {
    view: (VIEWS as readonly string[]).includes(view ?? "") ? (view as View) : "rules",
    status: (SHIPMENT_STATUSES as readonly string[]).includes(status)
      ? (status as ShipmentStatus)
      : "",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/**
 * The URL the screen writes back.
 *
 * Defaults are omitted so a shared link carries only what was chosen, and the
 * back button works because the caller pushes rather than replaces — replacing
 * the history entry means going back from a filtered list skips the unfiltered
 * one, which the orders branch measured and the e2e suite asserts.
 */
export function paramsFromQuery(query: ShippingQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.view !== DEFAULT_QUERY.view) params.set("view", query.view);
  if (query.status !== "") params.set("status", query.status);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

/** What `GET /shipments` is actually sent. */
export function shipmentParams(query: ShippingQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("per_page", String(PER_PAGE));
  params.set("page", String(query.page));
  if (query.status !== "") params.set("status", query.status);
  return params;
}
