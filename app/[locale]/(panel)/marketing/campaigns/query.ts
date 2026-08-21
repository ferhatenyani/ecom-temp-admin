import { CAMPAIGN_STATUSES, isCampaignStatus, type CampaignStatus } from "@/lib/campaigns";

/**
 * The campaign list's URL state.
 *
 * Measured 2026-08-21 against the live router:
 *
 *   ?status=draft         honoured
 *   ?status=sending       honoured
 *   ?status=nonsense      400 — "status is not one of , draft, sending, sent,
 *                         and cancelled." **Note the leading comma**: the empty
 *                         string is in the enum, so `?status=` is legal and means
 *                         every status.
 *   ?search=probe         honoured, matches the name
 *   ?segment_id=35        honoured
 *   ?per_page=101         400, not a clamp
 *   ?orderby=name         200, unverified whether it reorders
 *
 * The empty string being a legal value is the difference from the coupons
 * screen, where "all" is the *absence* of the parameter. Both end up sending
 * nothing — a meaningless `?status=` in every URL is worse than an omission — but
 * for opposite reasons, and the reason is what somebody needs when they change
 * this.
 */

export const STATUS_FILTERS = ["", ...CAMPAIGN_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const PER_PAGE = 20;

export type CampaignsQuery = {
  status: StatusFilter;
  search: string;
  /** Set by following a link from a segment, never typed. */
  segmentId: number;
  page: number;
};

export const EMPTY_QUERY: CampaignsQuery = {
  status: "",
  search: "",
  segmentId: 0,
  page: 1,
};

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): CampaignsQuery {
  const status = params.get("status") ?? "";

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
    page: positive(params.get("page")),
  };
}

export function listParams(query: CampaignsQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    page: String(query.page),
  });

  if (query.status !== "") params.set("status", query.status);
  if (query.search !== "") params.set("search", query.search);
  if (query.segmentId > 0) params.set("segment_id", String(query.segmentId));
  return params;
}

export function toUrlParams(query: CampaignsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.status !== "") params.set("status", query.status);
  if (query.search !== "") params.set("search", query.search);
  if (query.segmentId > 0) params.set("segment_id", String(query.segmentId));
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

export function isFiltered(query: CampaignsQuery): boolean {
  return query.status !== "" || query.search !== "" || query.segmentId > 0;
}

export function campaignsKey(query: CampaignsQuery) {
  return ["campaigns", listParams(query).toString()] as const;
}

/* ------------------------------------------------------------- recipients --- */

/**
 * The recipient list's page size and filter.
 *
 * `?status=` is honoured **and `meta.total` follows it**, which it did not before
 * `feat/campaign-recipient-counts`: measured, `?status=failed` answered 0 rows
 * with `meta.total: 9`, so a paginating list showed "9 destinataires" over an
 * empty table. This screen pages, so it would have been the one to show it.
 */
export const RECIPIENTS_PER_PAGE = 25;

export function recipientParams(status: string, page: number): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(RECIPIENTS_PER_PAGE),
    page: String(page),
  });
  if (status !== "") params.set("status", status);
  return params;
}

export function recipientsKey(campaignId: number, status: string, page: number) {
  return ["campaigns", campaignId, "recipients", status, page] as const;
}
