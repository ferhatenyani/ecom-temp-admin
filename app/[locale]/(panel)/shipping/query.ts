import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/shipment-status";

/**
 * The parcels list's URL state.
 *
 * ## Two routes, and `/shipping` is now the parcels
 *
 * This file used to open on the *tariff* and carry a `view` parameter, and its
 * own docblock gave the reason: two tab-bar destinations for one person's job
 * would have spent a slot the bar did not have. `layout.tsx` replaced that bar
 * with `AppShell`, so the constraint expired — the sidebar has room, and the two
 * halves are different data with different filters and their own paging, which
 * is the shape `/inventory` and `/inventory/movements` already take.
 *
 * So the tariff moved to `/shipping/rules` and this route landed on the parcels.
 * That is a **flip** of what `/shipping` shows, which is why `page.tsx` redirects
 * `?view=rules` rather than dropping it: an old bookmark pointed at the tariff.
 * `?view=parcels` needs no redirect — it is this route already, and the unknown
 * parameter is ignored.
 *
 * ## What the collection actually filters by
 *
 * Measured 2026-08-25 against the live router, each parameter on its own with
 * `?bogus_param=1` as the control for "silently ignored", over 129 rows:
 *
 * | Sent | Answer | Verdict |
 * |---|---|---|
 * | `?status=delivered` | 85 | **real** |
 * | `?status=cancelled` | 44 | **real** |
 * | `?status=pending` | 0 | real — no pending parcel exists |
 * | `?status=zzz` | **400** naming all ten | validated |
 * | `?order_id=4586` | 2 | **real** |
 * | `?provider=manual` / `?provider=acfake` | 87 / 42 | real, **unvalidated** |
 * | `?is_live=true` / `=false` | 129 / 129 | **ignored** |
 * | `?search=MAN` | 129 | **ignored** — not a parameter |
 * | `?orderby=…` × 9, `?order=…` × 2 | byte-identical to the control | **ignored** |
 *
 * **No provider filter, and the parameter works.** `GET /shipping/providers`
 * returns exactly one entry — `manual` — while the collection carries two, so a
 * picker built from the only allowlisted enumeration of providers cannot offer
 * `acfake`, which is 42 of the 129 rows and the half worth filtering to. The
 * alternative is a free-text box, and a free-text box is not a filter here:
 * `?provider=zzz` is a **200 with 0 rows**, so a typo would be silently
 * indistinguishable from a courier with nothing in flight. A control that cannot
 * offer the value that matters, and cannot refuse a wrong one, is not shipped.
 *
 * **No `is_live` filter.** Re-measured 2026-08-25 with a live row present in the
 * fixture: `?is_live=true` still returned all 130. It is a real field on every
 * row and reads exactly like a filter; it is not one.
 *
 * **No sorting, and no `aria-sort` anywhere on this screen.** Nine `orderby`
 * values against both directions produced an id sequence byte-identical to
 * `?bogus_param=1`, and the negative control is stronger than usual:
 * **`?orderby=zzz` is a 200**, so the parameter never reaches a validator and
 * therefore cannot be reaching a sort. The tie explanation is excluded too —
 * page one carries 100 distinct ids, 100 distinct tracking numbers and 82
 * distinct `created_at`. There is nothing to tie on. No column carries a
 * `sortKey` and the list passes no `onSortChange`, which is what keeps
 * `DataTable` from announcing a sortability that does not exist.
 */

/** `""` is "every status" and is the absence of the parameter, not a value. */
export const STATUS_FILTERS = ["", ...SHIPMENT_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Page size, and the three the footer offers.
 *
 * Page and per-page live in the URL, on the coupons and customers shape — the
 * arrangement `TableFooter` is written against, so the control is used as-is
 * rather than wrapped. Two filters is a short enough URL that the reading
 * position is worth carrying in it.
 *
 * All three are ≤ 100 because **`per_page=101` is a measured 400, not a clamp**,
 * on every collection in this API. A stale `?per_page=37` falls back rather than
 * travelling: the footer's select could not represent it afterwards, and a
 * control that cannot show the state it is in is a control that lies about it.
 */
export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export const PER_PAGE = 20;

export type ParcelsQuery = {
  status: StatusFilter;
  /** An order number, exact match. Digits only — see `orderIdFromInput`. */
  orderId: string;
  page: number;
  perPage: number;
};

export const EMPTY_QUERY: ParcelsQuery = {
  status: "",
  orderId: "",
  page: 1,
  perPage: PER_PAGE,
};

/**
 * What the search box's submitted text becomes.
 *
 * `order_id` is an exact match on a numeric key, and nothing measured says what
 * the router does with a non-numeric one — `?status=zzz` is a 400 and
 * `?provider=zzz` is a silent 200, so this route's habits do not predict it. The
 * panel's standing rule is that a hand-edited or stale URL must not be able to
 * provoke a refusal the screen then has to render as an error, so only digits
 * are ever sent.
 *
 * Non-digits are **stripped rather than refused**, which is a deliberate reading
 * of what people type into a box labelled "order number": a pasted `Commande
 * 4586`, or the same number behind a hash, both mean 4586. What is left of
 * nothing is the empty string, which clears the filter — and because
 * `SearchField` follows the committed value, the box visibly resets to what was
 * actually applied rather than keeping text the list never used.
 *
 * (Written without an example carrying its hash on purpose: `check-design.sh`
 * greps for hex colour literals and a four-digit order number behind one is
 * valid hex. The scanner is deliberately blunt and a comment is not worth an
 * exemption — `RulesView` carried the same note about commune ids.)
 */
export function orderIdFromInput(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  /* A leading-zero run would be sent verbatim and match nothing; `4586` and
     `04586` are the same order to a person typing. */
  return digits === "" ? "" : String(Number.parseInt(digits, 10));
}

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): ParcelsQuery {
  const status = params.get("status") ?? "";
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);

  return {
    /* Anything outside the ten falls back to no filter: `?status=zzz` is a 400
       and the screen must not be reachable in a state that provokes one. */
    status: (SHIPMENT_STATUSES as readonly string[]).includes(status)
      ? (status as ShipmentStatus)
      : "",
    orderId: orderIdFromInput(params.get("order_id") ?? ""),
    page: positive(params.get("page")),
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : PER_PAGE,
  };
}

/** What `GET /shipments` is actually sent. */
export function listParams(query: ParcelsQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
  });

  /* Both omitted when empty rather than sent blank. `?status=` is not a member
     of this enum and would be refused, and an empty `order_id` is a parameter
     with no question in it. */
  if (query.status !== "") params.set("status", query.status);
  if (query.orderId !== "") params.set("order_id", query.orderId);
  return params;
}

/**
 * The URL the panel shows: only what differs from the defaults.
 *
 * `push`, never `replace`, at the call site — replacing the history entry means
 * going back from a filtered list skips the unfiltered one, which the orders
 * branch measured and the e2e suite asserts.
 */
export function toUrlParams(query: ParcelsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.status !== "") params.set("status", query.status);
  if (query.orderId !== "") params.set("order_id", query.orderId);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== EMPTY_QUERY.perPage) params.set("per_page", String(query.perPage));
  return params;
}

export function isFiltered(query: ParcelsQuery): boolean {
  return query.status !== "" || query.orderId !== "";
}

/** The query key mirrors the request, so the two can never disagree. */
export function parcelsKey(query: ParcelsQuery) {
  return ["shipments", listParams(query).toString()] as const;
}
