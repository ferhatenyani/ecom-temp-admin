import type { Movement, MovementSummary } from "@/lib/api/schemas/inventory";
import { isKnownReason } from "@/lib/movement-reason";
import { acRead } from "@/lib/api/browser";

/**
 * The movement ledger's own query.
 *
 * It used to share an object with the stock list behind a `view` discriminator.
 * The two share **no parameter** — `/inventory` and `/inventory/movements` accept
 * entirely different ones — and this API ignores an unknown parameter with a 200,
 * so one object holding both made it possible for a stock filter to survive a
 * switch to the ledger and silently do nothing. Two routes, two query modules.
 *
 * A *known* parameter with a bad value does refuse: `?reason=zzz` and
 * `?date_from=yesterday` are both 400, which is why `queryFromParams` drops a
 * value it does not recognise rather than forwarding it. A stale or hand-edited
 * URL must not be able to provoke a 400 the screen then renders as an error.
 */

/**
 * 20 against 1154 rows and 58 pages, with 50 and 100 in the footer beside it.
 *
 * docs/ADMIN_PANEL.md warns that an import writes one movement per line and that
 * pagination "has to expect that". It does: nothing here accumulates pages in
 * memory, `?page=999` answers 200 with an empty array rather than an error
 * (measured), and the page control is driven by `meta.total` so it stops where
 * the data does. **`per_page` caps at 100 and 101 is a 400, not a clamp** —
 * measured on this very route.
 */
export const PER_PAGE = 20;

const PER_PAGE_CHOICES = [20, 50, 100];

export type MovementsQuery = {
  /** One of the nine, or `""`. The union, not the six a person may write. */
  reason: string;
  /** A product id, set by arriving from an item. */
  productId: string;
  /** `"me"` when the ledger is filtered to the signed-in actor, else `""`. */
  actor: string;
  /** `YYYY-MM-DD`. Anything else is a 400 — the API validates the format. */
  dateFrom: string;
  dateTo: string;
  page: number;
  perPage: number;
};

export const EMPTY_QUERY: MovementsQuery = {
  reason: "",
  productId: "",
  actor: "",
  dateFrom: "",
  dateTo: "",
  page: 1,
  perPage: PER_PAGE,
};

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

/** `YYYY-MM-DD` and nothing else — the API answers 400 to any other shape. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function queryFromParams(params: URLSearchParams): MovementsQuery {
  const reason = params.get("reason") ?? "";
  const dateFrom = params.get("date_from") ?? "";
  const dateTo = params.get("date_to") ?? "";
  const productId = params.get("product_id") ?? "";
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);

  return {
    reason: isKnownReason(reason) ? reason : "",
    productId: /^\d+$/.test(productId) ? productId : "",
    actor: params.get("actor") === "me" ? "me" : "",
    dateFrom: ISO_DATE.test(dateFrom) ? dateFrom : "",
    dateTo: ISO_DATE.test(dateTo) ? dateTo : "",
    page: positive(params.get("page")),
    perPage: PER_PAGE_CHOICES.includes(perPage) ? perPage : PER_PAGE,
  };
}

/**
 * The ledger request.
 *
 * `actor=me` becomes `?actor_id={my id}` — the id comes from `/auth/me`, which
 * every role can read, and is the one identity filter the panel can honestly
 * offer. See `movementActor()` for why it is a filter and not a column.
 */
export function movementParams(query: MovementsQuery, meId: number | null): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
  });

  if (query.reason !== "") params.set("reason", query.reason);
  if (query.productId !== "") params.set("product_id", query.productId);
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  if (query.actor === "me" && meId !== null) params.set("actor_id", String(meId));
  return params;
}

/** The summary takes the ledger's filters minus its pagination. */
export function summaryParams(query: MovementsQuery, meId: number | null): URLSearchParams {
  const params = movementParams(query, meId);
  params.delete("per_page");
  params.delete("page");
  return params;
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: MovementsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.reason !== "") params.set("reason", query.reason);
  if (query.productId !== "") params.set("product_id", query.productId);
  if (query.actor !== "") params.set("actor", query.actor);
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== PER_PAGE) params.set("per_page", String(query.perPage));
  return params;
}

/** Whether the ledger is narrowed, which is what the empty state asks. */
export function isFiltered(query: MovementsQuery): boolean {
  return (
    query.reason !== "" ||
    query.productId !== "" ||
    query.actor !== "" ||
    query.dateFrom !== "" ||
    query.dateTo !== ""
  );
}

/** Past the last page: an empty screen with rows behind it. See the stock list. */
export function isOverPaged(query: MovementsQuery): boolean {
  return query.page > 1;
}

/**
 * How many of the **drawer's own** dimensions are set — the count on its button.
 *
 * `productId` is deliberately not among them. It is set by arriving from an item
 * screen and is removable as a chip, and the drawer offers no field for it: a raw
 * product id typed into a box is not an act anybody in a stockroom performs, and
 * the API does not even validate one — a value that is not an id answers 200 with
 * zero rows rather than refusing, so a typo would read as "nothing ever happened
 * to this product". A count including a dimension the panel cannot open would
 * send someone into the drawer looking for a control that is not there.
 */
export function drawerFilterCount(query: MovementsQuery): number {
  return (
    (query.reason !== "" ? 1 : 0) +
    (query.actor !== "" ? 1 : 0) +
    (query.dateFrom !== "" || query.dateTo !== "" ? 1 : 0)
  );
}

/* ------------------------------------------------------------- fetching --- */

export type MovementsPage = { movements: Movement[]; total: number };

export function movementsKey(query: MovementsQuery, meId: number | null) {
  return ["inventory", "moves", movementParams(query, meId).toString()] as const;
}

export function summaryKey(query: MovementsQuery, meId: number | null) {
  return ["inventory", "summary", summaryParams(query, meId).toString()] as const;
}

export async function fetchMovements(
  query: MovementsQuery,
  meId: number | null,
): Promise<MovementsPage> {
  const { data, total } = await acRead<Movement[]>(
    `/inventory/movements?${movementParams(query, meId)}`,
  );
  return { movements: data, total };
}

export async function fetchSummary(
  query: MovementsQuery,
  meId: number | null,
): Promise<MovementSummary> {
  const { data } = await acRead<MovementSummary>(
    `/inventory/movements/summary?${summaryParams(query, meId)}`,
  );
  return data;
}
