import { PAYMENT_STATUSES, type PaymentStatus } from "@/lib/payment-status";

/**
 * The transactions ledger's URL state.
 *
 * ## One route, and the COD funnel is not a second one
 *
 * `/inventory/movements` and `/shipping/rules` earned their own routes on one
 * test: different data, their own filters, their own writes. **The COD funnel is
 * none of those** — `GET /cod/statistics` takes no parameters, returns one
 * object and is read-only — so splitting it off would buy a URL and cost the
 * property that makes this screen worth reading: two capabilities land on it and
 * see different halves. Measured 2026-08-26: a Manager is **403** on `/payments`,
 * `/payments/methods` and `/payments/{id}` and **200** on `/cod/statistics`. They
 * get the refusal where the ledger was and the whole report underneath it.
 *
 * ## What the collection actually filters by
 *
 * Measured 2026-08-26 against the live router, each parameter on its own with
 * `?bogus_param=1` as the control for "silently ignored", over 45 rows:
 *
 * | Sent | Answer | Verdict |
 * |---|---|---|
 * | `?status=pending` / `?status=failed` | 44 / 1 | **real** |
 * | `?status=paid` and three more | 0 | real — nothing in this shop has settled |
 * | `?status=zzz` **and** `?status=` | **400** naming all six | validated |
 * | `?status[]=pending` | **400** "not of type string" | validated |
 * | `?provider=cod` / `?provider=chargily` | 43 / 2 (sum = 45) | **real**, case-insensitive |
 * | `?provider=zzz` | 200, 0 rows | honoured, **unvalidated** |
 * | `?provider=` | 200, all 45 | read as an **absence** |
 * | `?order_id=4586` | exact match | **real**, validated in two families |
 * | `?date_from=` / `?date_to=` | inclusive, **UTC day** | **real**, pattern-validated |
 * | `?reference=AC-1` | 42 | real — and deliberately not offered, see below |
 * | `?search=zzz` | all 45 | **ignored** — not a parameter of this route |
 * | `?orderby=…` × 11, `?order=…`, `sort`, `sort_by`, `order_by` | byte-identical to the control | **ignored** |
 *
 * **The provider filter ships here where shipping's did not, and the difference
 * is the enumeration.** `GET /shipping/providers` lists only `manual` while the
 * parcels carry two values, so a picker built from the sole allowlisted
 * enumeration could not offer the half worth filtering to. `GET
 * /payments/methods` lists **both** `cod` and `chargily`, and those two sum to
 * every row in the collection — so the picker is complete, a typo is impossible
 * through it, and the fact that `?provider=zzz` is a silent 200 never becomes
 * reachable. That is the whole of the difference; the parameter behaves the same
 * on both routes.
 *
 * **The empty string is a three-way split on this collection**, which is why
 * `listParams` omits rather than blanks: `status=` and `order_id=` and the two
 * date bounds are each a 400 in their own family, while `provider=` is read as an
 * absence. A screen that sent a blank parameter would be a 400 on four of the six
 * and a no-op on the fifth.
 *
 * **Both date bounds are inclusive and cut on the UTC day, not the shop's
 * timezone.** Measured: a row stamped `23:07:26Z` — which is 00:07 the *next* day
 * in Africa/Algiers — is included by `date_to` of the earlier day. `2026-13-45`
 * matches the pattern and answers a 200 with 0 rows; the router validates the
 * shape and never the calendar, and an inverted range is a 200 with 0 rows too.
 *
 * ## What this collection cannot do, recorded rather than left looking forgotten
 *
 * **No sorting, and no `aria-sort` anywhere on this screen.** Eleven `orderby`
 * values against both directions produced an id sequence byte-identical to the
 * bare listing and to `?bogus_param=1`; `sort`, `sort_by`, `order_by` and
 * `orderby[]` did the same. The negative control is the strong one:
 * **`?orderby=zzz` is a 200**, so the parameter never reaches a validator and
 * therefore cannot be reaching a sort. The tie explanation is excluded — 45 rows,
 * 45 distinct ids, 45 distinct `created_at`. No column carries a `sortKey` and
 * the list passes no `onSortChange`.
 *
 * **No search box.** `?search=zzz` returns all 45, identical to the control. The
 * order-number lookup below is `order_id`, which is an exact match on a numeric
 * key and is not a search.
 *
 * **No `reference` filter, and it is honoured.** `AC-1` → 42, and `AC`, `AC-`
 * and `AC-11` all → 0, so it is an exact match rather than a prefix. It is not
 * offered because the column holds **two distinct values across 45 rows**, it is
 * an opaque provider string the operator has no source for, and a typo is a
 * silent 200 with no rows rather than a refusal. Real, measured, and deliberately
 * absent — the reference is still shown on the record, where it can be read.
 */

/** `""` is "every status" and is the absence of the parameter, not a value. */
export const STATUS_FILTERS = ["", ...PAYMENT_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Page size, and the three the footer offers.
 *
 * Page and per-page live in the URL, on the coupons/customers/shipping shape —
 * the arrangement `TableFooter` is written against, so the control is used as-is
 * rather than wrapped.
 *
 * All three are ≤ 100 because **`per_page=101` is a measured 400, not a clamp**,
 * and `per_page=0` and `per_page=""` are 400s in the range and type families
 * respectively. A stale `?per_page=37` falls back rather than travelling: the
 * footer's select could not represent it afterwards, and a control that cannot
 * show the state it is in is a control that lies about it.
 */
export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export const PER_PAGE = 20;

/** The pattern the API's own refusal quotes back. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type PaymentsQuery = {
  status: StatusFilter;
  /** An order number, exact match. Digits only — see `orderIdFromInput`. */
  orderId: string;
  /** A method's `name`, folded. `""` is every method. */
  provider: string;
  /** `Y-m-d`, inclusive, cutting on the UTC day. `""` is unbounded. */
  dateFrom: string;
  dateTo: string;
  page: number;
  perPage: number;
};

export const EMPTY_QUERY: PaymentsQuery = {
  status: "",
  orderId: "",
  provider: "",
  dateFrom: "",
  dateTo: "",
  page: 1,
  perPage: PER_PAGE,
};

/**
 * What the order-number box's submitted text becomes.
 *
 * `order_id` is the best-validated parameter on this route — `?order_id=zzz` and
 * `?order_id=` are 400s in the type family, `0` and `-1` in the range family —
 * and the panel's standing rule is that a hand-edited or stale URL must not be
 * able to provoke a refusal the screen then has to render as an error. So only
 * digits are ever sent.
 *
 * Non-digits are **stripped rather than refused**, which is a deliberate reading
 * of what people type into a box labelled "order number": a pasted `Commande
 * 4586`, or the same number behind a hash, both mean 4586. What is left of
 * nothing is the empty string, which clears the filter — and because
 * `SearchField` follows the committed value, the box visibly resets to what was
 * actually applied rather than keeping text the list never used.
 *
 * The reasoning, and this function, are `shipping/query.ts`'s. Repeated rather
 * than imported because the two screens' URL states are otherwise unrelated and a
 * cross-screen import is a coupling neither of them wants.
 */
export function orderIdFromInput(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  /* A leading-zero run would be sent verbatim and match nothing; `4586` and
     `04586` are the same order to a person typing. */
  return digits === "" ? "" : String(Number.parseInt(digits, 10));
}

/**
 * A date bound, or nothing.
 *
 * Anything that does not match the API's own pattern is dropped rather than sent:
 * a bound that fails the pattern is a 400 quoting `^\d{4}-\d{2}-\d{2}$` back, and
 * that refusal must not be reachable from a URL somebody edited. `2026-13-45`
 * *does* match the pattern and is not a date — it travels, and answers a 200 with
 * zero rows, because the router validates the shape and never the calendar and
 * the panel does not get to be stricter than the thing it is a client of.
 */
export function dayFromInput(raw: string): string {
  return DAY.test(raw) ? raw : "";
}

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): PaymentsQuery {
  const status = params.get("status") ?? "";
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);

  return {
    /* Anything outside the six falls back to no filter: `?status=zzz` and
       `?status=` are both 400s and the screen must not be reachable in a state
       that provokes one. */
    status: (PAYMENT_STATUSES as readonly string[]).includes(status)
      ? (status as PaymentStatus)
      : "",
    orderId: orderIdFromInput(params.get("order_id") ?? ""),
    /*
     * Folded, and otherwise taken as it stands.
     *
     * There is no static allowlist to check it against — the methods come from
     * `/payments/methods` at request time — and a value outside them cannot
     * provoke a refusal here: `?provider=zzz` is a silent 200 with zero rows.
     * So a stale value travels, and the *picker* is what has to be honest about
     * it: `PaymentsLedger` adds the unrecognised value to its own options so the
     * control shows the state it is in rather than rendering blank. Folding here
     * because the API is case-insensitive on this parameter — measured,
     * `?provider=COD` returns all 43 — so `?provider=COD` and `?provider=cod`
     * must not be two different cache keys for one answer.
     */
    provider: (params.get("provider") ?? "").trim().toLowerCase(),
    dateFrom: dayFromInput(params.get("date_from") ?? ""),
    dateTo: dayFromInput(params.get("date_to") ?? ""),
    page: positive(params.get("page")),
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : PER_PAGE,
  };
}

/** What `GET /payments` is actually sent. */
export function listParams(query: PaymentsQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
  });

  /* Omitted when empty rather than sent blank — see the three-way split in the
     file docblock. Four of these five are a 400 on the empty string. */
  if (query.status !== "") params.set("status", query.status);
  if (query.orderId !== "") params.set("order_id", query.orderId);
  if (query.provider !== "") params.set("provider", query.provider);
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  return params;
}

/**
 * The URL the panel shows: only what differs from the defaults.
 *
 * `push`, never `replace`, at the call site — replacing the history entry means
 * going back from a filtered list skips the unfiltered one, which the orders
 * branch measured and the e2e suite asserts.
 */
export function toUrlParams(query: PaymentsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.status !== "") params.set("status", query.status);
  if (query.orderId !== "") params.set("order_id", query.orderId);
  if (query.provider !== "") params.set("provider", query.provider);
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== EMPTY_QUERY.perPage) params.set("per_page", String(query.perPage));
  return params;
}

export function isFiltered(query: PaymentsQuery): boolean {
  return (
    query.status !== "" ||
    query.orderId !== "" ||
    query.provider !== "" ||
    query.dateFrom !== "" ||
    query.dateTo !== ""
  );
}

/**
 * Past the last page, which on this API is a **200 with zero rows** rather than a
 * 404 — so the table is not drawn, and with it goes the only control that could
 * page back. The inventory ledger's third recorded bug, avoided here rather than
 * repeated: the empty state offers the way out.
 */
export function isOverPaged(query: PaymentsQuery): boolean {
  return query.page > 1;
}

/** The query key mirrors the request, so the two can never disagree. */
export function paymentsKey(query: PaymentsQuery) {
  return ["payments", listParams(query).toString()] as const;
}
