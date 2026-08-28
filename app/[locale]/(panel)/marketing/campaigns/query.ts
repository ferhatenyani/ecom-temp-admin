import { CAMPAIGN_STATUSES, isCampaignStatus, type CampaignStatus } from "@/lib/campaigns";

/**
 * The campaign list's URL state.
 *
 * ## Sorting ships, and this is the strongest control in the run
 *
 * This file recorded `?orderby=name` as "200, unverified whether it reorders"
 * until 2026-08-28. It reorders, both directions, and so do two other fields.
 * Measured against the live router, one value at a time, over the shop's four
 * campaigns:
 *
 *   bare (the resting order)      [322, 320, 319, 318]
 *   orderby=name&order=asc        [320, 319, 322, 318]  alphabetical over four
 *                                                       distinct names, and it is
 *                                                       **not** the resting order
 *   orderby=name&order=desc       [318, 322, 319, 320]  the exact reverse
 *   orderby=created_at&order=asc  [319, 318, 320, 322]
 *   orderby=created_at&order=desc [322, 320, 319, 318]  == the resting order
 *   orderby=updated_at&order=asc  [320, 322, 318, 319]  a fourth distinct sequence
 *   orderby=updated_at&order=desc [319, 318, 322, 320]
 *   orderby=id&order=asc          [318, 319, 320, 322]
 *   orderby=id&order=desc         [322, 320, 319, 318]  == the resting order
 *
 *   ?orderby=zzz  400   ?orderby=  400   ?order=zzz  400   ?order=  400
 *   ?bogus_param=1  200, resting order
 *
 * Two things make this the strongest sort measured on this API. **`name` and
 * `updated_at` each answer a sequence the default ordering cannot produce**,
 * which is the positive control DECISIONS.md's standing rule asks for and which
 * `created_at desc` and `id desc` — both byte-identical to the bare listing —
 * could never have supplied. And **garbage reaches a validator**: a value outside
 * the enum is a 400, where the same request on `/shipping` and `/payments` is a
 * silent 200. So the panel is not guessing in either direction.
 *
 * **`id` sorts and gets no column.** No id column is worth scanning on four
 * campaigns whose names are what anybody would search for, and adding one purely
 * to hang a sort on it is chrome — `date` on coupons, exactly. It stays reachable
 * by URL, which is how `/products` treats `popularity` and `/customers` its own
 * two: `queryFromParams` honours `?orderby=id`, `toUrlParams` carries it, and no
 * header claims it.
 *
 * **The resting order sends no `orderby` at all.** `created_at desc` is measured
 * byte-identical to the bare listing, so asking for it explicitly is a parameter
 * that changes nothing in every URL for ever — and the third click on a sorted
 * header is then a genuine return to rest rather than a re-request. That is
 * `DataTable`'s `none → asc → desc → none` cycle, which coupons established.
 *
 * ## The filters, all four measured
 *
 *   ?status=draft      2 rows [319, 318]     ?status=sent  1 [322]
 *   ?status=cancelled  1 row  [320]          ?status=zzz   400
 *   ?status=           **200, every status** — the empty string is in the enum
 *   ?search=Ramadan    1 row  [320] — matches the **name and the subject**
 *   ?search=zzzqqq     0 rows
 *   ?segment_id=43     1 row  [318]          ?segment_id=46  0 rows
 *   ?segment_id=99999  **200 with 0 rows, not a refusal**
 *   ?per_page=101      400, not a clamp
 *
 * The empty string being a legal `status` is the difference from the coupons
 * screen, where "all" is the *absence* of the parameter. Both end up sending
 * nothing — a meaningless `?status=` in every URL is worse than an omission — but
 * for opposite reasons, and the reason is what somebody needs when they change
 * this.
 *
 * **`segment_id` is a picker rather than a box, and the enumeration is why.** A
 * wrong value is a silent 200 with zero rows, so free text would let a typo look
 * exactly like "no campaign uses this segment"; `GET /segments` is allowlisted
 * and enumerates **all four**, so a picker can offer every value that matters and
 * cannot express one that does not. That is DECISIONS.md's picker rule — payments
 * yes, shipping no — landing on the yes side.
 */

export const STATUS_FILTERS = ["", ...CAMPAIGN_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * The four values the 400 enumerates, in the order it prints them — `created_at`
 * leads because it is this collection's own default, which is also why
 * `/segments` leads with `name`.
 */
const ACCEPTED_ORDERBY = ["created_at", "updated_at", "name", "id"] as const;
export type OrderBy = (typeof ACCEPTED_ORDERBY)[number];

/**
 * Page size, and the three the footer offers. All ≤ 100, because **`per_page=101`
 * is a measured 400 rather than a clamp**; a stale `?per_page=37` falls back
 * rather than travelling, since the control could not represent it afterwards.
 */
export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export const PER_PAGE = 20;

export type CampaignsQuery = {
  status: StatusFilter;
  search: string;
  /** Set by the segment picker, or by following a link from a segment. */
  segmentId: number;
  orderby: OrderBy;
  order: "asc" | "desc";
  page: number;
  perPage: number;
};

export const EMPTY_QUERY: CampaignsQuery = {
  status: "",
  search: "",
  segmentId: 0,
  orderby: "created_at",
  order: "desc",
  page: 1,
  perPage: PER_PAGE,
};

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

/**
 * The one guard, used by both directions of travel.
 *
 * A hand-edited or stale URL must not provoke a 400 the screen then renders as an
 * error — and on this collection that is a real risk rather than a defensive one,
 * because `?orderby=` and `?orderby=zzz` are both refused. A header cycle handing
 * back a key must not be able to either: `SortState.key` is a plain `string`, so
 * a column's `sortKey` and this enum are related only by construction until
 * something checks.
 */
export function orderbyFromKey(key: string | null): OrderBy {
  return (ACCEPTED_ORDERBY as readonly string[]).includes(key ?? "")
    ? (key as OrderBy)
    : EMPTY_QUERY.orderby;
}

export function queryFromParams(params: URLSearchParams): CampaignsQuery {
  const status = params.get("status") ?? "";
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);

  return {
    /*
     * A stale or hand-edited URL must not provoke a 400 the screen then renders
     * as an error. `?status=scheduled` is exactly that URL — a plausible guess
     * for a mailing tool, and a 400 — so anything outside the four falls back to
     * no filter.
     */
    status: isCampaignStatus(status) ? (status as CampaignStatus) : "",
    search: params.get("search") ?? "",
    segmentId: Math.max(0, Number.parseInt(params.get("segment_id") ?? "", 10) || 0),
    orderby: orderbyFromKey(params.get("orderby")),
    /* `order` is only read alongside `orderby`, and the API's own default is
       `desc` — measured: `orderby=id` with no `order` answers 322, 320, 319, 318. */
    order: params.get("order") === "asc" ? "asc" : "desc",
    page: positive(params.get("page")),
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : PER_PAGE,
  };
}

export function listParams(query: CampaignsQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
    orderby: query.orderby,
    order: query.order,
  });

  if (query.status !== "") params.set("status", query.status);
  if (query.search !== "") params.set("search", query.search);
  if (query.segmentId > 0) params.set("segment_id", String(query.segmentId));
  return params;
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: CampaignsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.status !== "") params.set("status", query.status);
  if (query.search !== "") params.set("search", query.search);
  if (query.segmentId > 0) params.set("segment_id", String(query.segmentId));
  if (query.orderby !== EMPTY_QUERY.orderby) params.set("orderby", query.orderby);
  if (query.order !== EMPTY_QUERY.order) params.set("order", query.order);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== EMPTY_QUERY.perPage) params.set("per_page", String(query.perPage));
  return params;
}

export function isFiltered(query: CampaignsQuery): boolean {
  return query.status !== "" || query.search !== "" || query.segmentId > 0;
}

export function campaignsKey(query: CampaignsQuery) {
  return ["campaigns", "list", listParams(query).toString()] as const;
}

/* ------------------------------------------------------------- recipients --- */

/**
 * The recipient list's page size and filter.
 *
 * **`status` and paging, and no sort of any kind.** `?orderby=zzz` is a **200**
 * here where the same value on `/campaigns` one level up is a 400: this route
 * registers no sort argument at all, so the parameter reaches nothing and is not
 * validated either. Two routes on one resource, two answers to the same wrong
 * value — which is why the recipients table declares no `sortKey` and claims no
 * `aria-sort` on any header.
 *
 * `?status=` is honoured **and `meta.total` follows it**, which it did not before
 * `feat/campaign-recipient-counts`: measured, `?status=failed` answered 0 rows
 * with `meta.total: 9`, so a paginating list showed "9 destinataires" over an
 * empty table. This screen pages, so it would have been the one to show it.
 */
/**
 * **20, not 25.** 25 was neither the API's figure — measured at 20 across nine
 * collections — nor the panel's, and it had a quiet cost: `TableFooter`'s per-page
 * control offers 20, 50 and 100, so a list opening at 25 rendered a `<select>`
 * whose value matched none of its options and therefore showed *blank*. A control
 * that cannot display the state it is in is a control that lies about it, which
 * is the coupons `?per_page=37` rule reaching a constant instead of a URL.
 *
 * Held in component state rather than in the URL: nothing else on the sent-campaign
 * screen lives there either, because the campaign is the address and a position
 * inside its recipient list is not a view anybody links to.
 */
export const RECIPIENTS_PER_PAGE = 20;

export function recipientParams(
  status: string,
  page: number,
  perPage: number = RECIPIENTS_PER_PAGE,
): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(perPage),
    page: String(page),
  });
  if (status !== "") params.set("status", status);
  return params;
}

export function recipientsKey(
  campaignId: number,
  status: string,
  page: number,
  perPage: number = RECIPIENTS_PER_PAGE,
) {
  return ["campaigns", campaignId, "recipients", status, page, perPage] as const;
}

/* -------------------------------------------------- the customer picker --- */

/**
 * The `ids` audience's picker, and the two numbers it needs.
 *
 * ## `?search=` matches the **e-mail**, and the placeholder has to say so
 *
 * Measured against the harness on 2026-08-28 and recorded at `lib/customers.ts:45`
 * and `scripts/mock-api.mjs`'s own block, which calls it "the single most carefully
 * measured fact on that screen and the one this file got wrong for three
 * branches":
 *
 *   ?search=Benali    **0 rows** — and customer 20 *is* named Benali
 *   ?search=Amina     **0 rows**
 *   ?search=client2   the rows whose address begins that way
 *
 * `user_login`, `user_email` and `display_name`; never `first_name` or
 * `last_name`. In this shop every login is the local part of the address, so
 * **e-mail** is the honest word for a placeholder — coupons' "the code only" rule
 * arriving here with a third answer rather than the same one. `looksLikeAName()`
 * is what turns the silent empty list into a sentence saying why.
 *
 * ## There is no batch route, so saved ids resolve one at a time
 *
 * Measured the same day: `?include=`, `?include[]=`, `?ids=` and `?post__in=` are
 * each a silent **200 answering the whole collection**, byte-identical to
 * `?bogus_param=1`. Only `GET /customers/{id}` resolves one id, so an audience of
 * *n* saved ids is *n* requests.
 *
 * **`RESOLVED_CUSTOMER_LIMIT` is 25, and both halves of that number are reasons.**
 * The API's own ceiling is `MAX_CUSTOMER_IDS` — a thousand — and a thousand reads
 * is 1.7× the *entire* 600/min budget this credential has, shared across every tab
 * the person has open, spent on labels. So a cap is mandatory rather than tidy.
 * 25 is where it sits because that is roughly one screenful of addresses — past it
 * nobody is reading rows, they are looking for one — and 25 reads is about 4% of
 * that budget in one burst at open.
 *
 * Past the cap the ids are **not silently dropped**: they render as themselves,
 * claiming no address, no name and no consent, under a line naming how many there
 * are, and a `console.warn` says the same thing where a developer will see it.
 */
export const CUSTOMER_PICKER_PER_PAGE = 50;
export const RESOLVED_CUSTOMER_LIMIT = 25;

export function customerPickerParams(search: string, page: number): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(CUSTOMER_PICKER_PER_PAGE),
    page: String(page),
  });
  if (search !== "") params.set("search", search);
  return params;
}

export function customerPickerKey(search: string, page: number) {
  return ["campaigns", "customer-picker", customerPickerParams(search, page).toString()] as const;
}

/** One saved id, resolved on its own. Shared with the panel's other customer reads. */
export function customerKey(id: number) {
  return ["customers", id] as const;
}
