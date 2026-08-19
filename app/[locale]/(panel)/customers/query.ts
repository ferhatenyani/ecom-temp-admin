import type { Customer } from "@/lib/api/schemas/customer";

/**
 * The customer list's URL state.
 *
 * **Three filters, and that is all there is.** Measured 2026-08-19 against the
 * live router: `search`, `orderby`, `order` and pagination. There is no filter
 * for paying customers, none for a date range, none for consent. So "our best
 * customers" is not a screen this endpoint can produce — 4 of the 16 are
 * `is_paying_customer` and there is no way to ask for them — and the panel does
 * not render a control that would silently do nothing.
 *
 * That last part is the trap this API makes easy and the reason every parameter
 * here was checked one at a time: **an unknown parameter is ignored with a 200.**
 * `?nonsense=zzz` returns all 16 rows, and so does `?role=administrator`. A known
 * parameter with a bad value does refuse — `?orderby=zzz` and `?order=sideways`
 * are both 400 — so the panel can send a wrong value and hear about it, and a
 * wrong *name* and hear nothing at all.
 */

/**
 * `orderby`'s four values, exactly as the 400 enumerates them.
 *
 * **Two of them cannot be told apart in this shop, and one sorts by something the
 * payload never carries.** `display_name` and `user_email` returned byte-identical
 * sequences across all 16 rows, because every customer's `display_name` *is* their
 * username and every username is the local part of their email. And `display_name`
 * is not a field on a customer: the list has `first_name`, `last_name`, `username`
 * and `email`, and no `display_name` at all.
 *
 * So a control offering "sort by name" would sort by a key the reader cannot see,
 * in an order that looks wrong for the four customers who *do* have names — Amina
 * Benali sorts under `ac_cus_shopper`. The panel offers `registered` and
 * `user_email`, names the second one after what it visibly sorts by, and leaves
 * the other two out rather than shipping a sort nobody can explain.
 */
export const ORDERBY = ["registered", "user_email"] as const;
export type OrderBy = (typeof ORDERBY)[number];

/** Every value the API accepts, for the guard. Wider than what the UI offers. */
const ACCEPTED_ORDERBY = ["registered", "ID", "display_name", "user_email"] as const;

export const PER_PAGE = 20;

export type CustomersQuery = {
  search: string;
  orderby: OrderBy;
  /** `"asc"` or `"desc"`. Anything else is a 400. */
  order: "asc" | "desc";
  page: number;
};

export const EMPTY_QUERY: CustomersQuery = {
  search: "",
  orderby: "registered",
  order: "desc",
  page: 1,
};

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): CustomersQuery {
  const orderby = params.get("orderby") ?? "";
  const order = params.get("order");

  return {
    search: params.get("search") ?? "",
    /*
     * A hand-edited or stale URL must not be able to provoke a 400 the screen
     * then has to render as an error. `ID` and `display_name` are accepted by the
     * API but not offered by the UI, so a URL carrying one is honoured rather
     * than silently rewritten — it is a legal request, just not one a control
     * produces. Anything outside the four falls back.
     */
    orderby: (ACCEPTED_ORDERBY as readonly string[]).includes(orderby)
      ? (orderby as OrderBy)
      : "registered",
    order: order === "asc" ? "asc" : "desc",
    page: positive(params.get("page")),
  };
}

/** The list request. */
export function listParams(query: CustomersQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    page: String(query.page),
    orderby: query.orderby,
    order: query.order,
  });

  if (query.search !== "") params.set("search", query.search);
  return params;
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: CustomersQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search !== "") params.set("search", query.search);
  if (query.orderby !== EMPTY_QUERY.orderby) params.set("orderby", query.orderby);
  if (query.order !== EMPTY_QUERY.order) params.set("order", query.order);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

export function isFiltered(query: CustomersQuery): boolean {
  return query.search !== "";
}

/* -------------------------------------------------- one customer's orders --- */

/**
 * `GET /customers/{id}/orders` takes `status`, `orderby`, `order` and pagination
 * — and **ignores `customer_id`**, which is the property worth having measured:
 * `?customer_id=25` on customer 24's route returns customer 24's five orders. The
 * identity is the path and cannot be redirected by a parameter.
 *
 * Its `orderby` enum is `date, id, modified, total` — a different set from the
 * customer list's — and `?status=` takes one value; a comma list is a 400.
 */
export const ORDERS_PER_PAGE = 10;

export function customerOrdersParams(status: string, page: number): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(ORDERS_PER_PAGE),
    page: String(page),
    orderby: "date",
    order: "desc",
  });

  if (status !== "") params.set("status", status);
  return params;
}

/* ------------------------------------------------------------- fetching --- */

export type CustomersPage = { customers: Customer[]; total: number };

/** The query key mirrors the request, so the two can never disagree. */
export function customersKey(query: CustomersQuery) {
  return ["customers", listParams(query).toString()] as const;
}

export function customerOrdersKey(id: number, status: string, page: number) {
  return ["customers", id, "orders", customerOrdersParams(status, page).toString()] as const;
}
