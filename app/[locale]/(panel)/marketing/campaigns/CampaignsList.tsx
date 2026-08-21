"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Campaign } from "@/lib/api/schemas/campaign";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { CAMPAIGN_TONE, isCampaignStatus } from "@/lib/campaigns";
import { useOnline } from "@/lib/use-online";
import { useHydrated } from "@/lib/use-hydrated";
import { formatDate, formatWhen } from "@/lib/format/date";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState, StaleBanner } from "@/components/patterns/States";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { Segmented } from "@/components/primitives/Segmented";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { RowSkeleton } from "../../inventory/RowSkeleton";
import {
  PER_PAGE,
  STATUS_FILTERS,
  campaignsKey,
  isFiltered,
  listParams,
  queryFromParams,
  toUrlParams,
  type CampaignsQuery,
  type StatusFilter,
} from "./query";

async function fetchCampaigns(query: CampaignsQuery) {
  const { data, total } = await acRead<Campaign[]>(`/campaigns?${listParams(query)}`);
  return { campaigns: data, total };
}

/**
 * The campaign list.
 *
 * A campaign's row has to answer two things at a glance — what state it is in,
 * and how many people it reached — and the second is only real once it has been
 * sent. A draft's `recipients.total` is `0`, which is not "nobody" but "not yet",
 * so the row shows the count only from `sending` onwards and shows the audience
 * instead while it is a draft.
 */
export function CampaignsList({
  locale,
  initialQuery,
  initialCampaigns,
  initialTotal,
}: {
  locale: string;
  initialQuery: CampaignsQuery;
  initialCampaigns: Campaign[] | null;
  initialTotal: number | null;
}) {
  const t = useTranslations("campaigns");
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const toast = useToast();

  const query = queryFromParams(new URLSearchParams(searchParams.toString()));
  const [searchDraft, setSearchDraft] = useState(query.search);
  const [creating, setCreating] = useState(false);
  const now = new Date();

  /*
   * The minimum the API accepts. `audience_type: "all"` because it is the only
   * one needing no second field, so the draft is valid the moment it exists and
   * the audience step opens on a real choice rather than on an error.
   *
   * A stray draft from somebody who taps and changes their mind is the cost, and
   * it is the right trade: a stray draft is named, visible and one tap from
   * deletion, while a wizard holding four steps of unsaved work in a tab is what
   * loses an afternoon.
   */
  const create = async () => {
    setCreating(true);
    try {
      const created = await acWrite<{ id: number }>("POST", "/campaigns", {
        name: t("create"),
        subject: "",
        body_html: "",
        body_text: "",
        audience_type: "all",
      });
      router.push(`/${locale}/marketing/campaigns/${created.id}`);
    } catch (thrown) {
      toast.show((thrown as BrowserApiError).message, "danger");
      setCreating(false);
    }
  };

  const commit = (next: CampaignsQuery, options: { resetPage?: boolean } = {}) => {
    const target = options.resetPage === false ? next : { ...next, page: 1 };
    const params = toUrlParams(target);
    router.push(`/${locale}/marketing/campaigns${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  };

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: campaignsKey(query),
    queryFn: () => fetchCampaigns(query),
    initialData:
      initialCampaigns !== null &&
      campaignsKey(query).join("|") === campaignsKey(initialQuery).join("|")
        ? { campaigns: initialCampaigns, total: initialTotal ?? initialCampaigns.length }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const campaigns = data?.campaigns ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = isFiltered(query);

  return (
    <Scaffold
      title={t("campaigns")}
      back={{ href: `/${locale}/marketing`, label: t("hubTitle") }}
      trailing={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refetch()}
            aria-label={t("refresh")}
            className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
          >
            <Icon name="refresh" className={isFetching ? "size-5 spin" : "size-5"} />
          </button>
          {/*
            **A button, not a link to `/new`.** Creating the draft is what makes
            the composer's save-on-advance possible — the preview has to be a
            render of the *saved* campaign — so "new" is a POST, and a POST must
            not live on a render path: Next prefetches links, so a `/new` route
            that created a draft would create one when somebody's thumb passed
            over the plus.
          */}
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating}
            aria-label={t("create")}
            className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent disabled:opacity-40"
            data-testid="create-campaign"
          >
            <Icon name={creating ? "refresh" : "plus"} className={creating ? "size-5 spin" : "size-5"} />
          </button>
        </div>
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              commit({ ...query, search: searchDraft.trim() });
            }}
            className="flex items-center gap-2 rounded-md bg-surface-2 px-3"
          >
            <Icon name="search" className="size-4 shrink-0 text-label-secondary" />
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              aria-label={t("campaigns")}
              enterKeyHint="search"
              className="min-h-11 min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-tertiary"
            />
            {searchDraft ? (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft("");
                  commit({ ...query, search: "" });
                }}
                aria-label={t("empty.clear")}
                className="press flex size-8 items-center justify-center rounded-full text-label-secondary"
              >
                <Icon name="close" className="size-4" />
              </button>
            ) : null}
          </form>

          <Segmented<StatusFilter>
            segments={STATUS_FILTERS.map((value) => ({
              value,
              label: value === "" ? t("statusAll") : t(`status.${value}`),
            }))}
            value={query.status}
            onChange={(status) => commit({ ...query, status })}
            label={t("statusLabel")}
          />
        </div>
      }
    >
      {!online && dataUpdatedAt > 0 ? (
        <div className="mx-auto max-w-3xl">
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale, now)} />
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl px-4">
        <p
          aria-live="polite"
          className="mb-2 px-1 text-footnote text-label-secondary"
          data-testid="campaigns-count"
        >
          <Isolate numeric>{t("count", { total })}</Isolate>
        </p>

        {isPending && campaigns.length === 0 ? (
          <RowSkeleton rows={5} />
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : campaigns.length === 0 ? (
          <EmptyState
            message={filtered ? t("empty.noResults") : t("empty.none")}
            action={
              filtered
                ? {
                    label: t("empty.clear"),
                    onClick: () => {
                      setSearchDraft("");
                      commit({ ...query, status: "", search: "", segmentId: 0 });
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <ListGroup>
              {campaigns.map((campaign) => (
                <ListLinkRow
                  key={campaign.id}
                  href={`/${locale}/marketing/campaigns/${campaign.id}`}
                  ariaLabel={campaign.name}
                >
                  <div className="flex w-full min-w-0 flex-col gap-1">
                    <div className="flex min-h-6 items-center gap-2">
                      {/* A campaign's name is what somebody typed, so `dir="auto"`. */}
                      <span dir="auto" className="min-w-0 truncate text-body text-label">
                        {campaign.name}
                      </span>
                      {isCampaignStatus(campaign.status) ? (
                        <StatusBadge tone={CAMPAIGN_TONE[campaign.status]} className="ms-auto">
                          {t(`status.${campaign.status}`)}
                        </StatusBadge>
                      ) : null}
                    </div>

                    <div className="flex min-w-0 items-baseline gap-2">
                      {/*
                        **The count only once it means something.** A draft's
                        `recipients.total` is 0, which is "not yet" rather than
                        "nobody" — showing it would report every unsent campaign
                        as reaching no one. Until then the row names the audience,
                        which is the fact a draft actually has.
                      */}
                      <span className="min-w-0 truncate text-footnote text-label-secondary">
                        {campaign.status === "draft" || campaign.status === "cancelled" ? (
                          t(`audience.${campaign.audience.type === "segment" ? "segment" : campaign.audience.type === "ids" ? "ids" : "all"}`)
                        ) : (
                          <Isolate numeric>
                            {t("recipients.count", { total: campaign.recipients.total })}
                          </Isolate>
                        )}
                      </span>
                      <span className="ms-auto shrink-0 text-footnote text-label-secondary">
                        {/*
                          `Intl` formatted, so `Isolate`. Absolute on the server
                          and relative once hydrated — `formatWhen` is relative
                          under 24 hours and cannot be server-rendered without a
                          hydration mismatch; the notifications branch found it.
                        */}
                        <Isolate>
                          {hydrated
                            ? formatWhen(campaign.updated_at, locale, now)
                            : formatDate(campaign.updated_at, locale)}
                        </Isolate>
                      </span>
                    </div>
                  </div>
                </ListLinkRow>
              ))}
            </ListGroup>

            {total > PER_PAGE ? (
              <nav className="mb-8 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={query.page <= 1}
                  onClick={() =>
                    commit({ ...query, page: Math.max(1, query.page - 1) }, { resetPage: false })
                  }
                  aria-label={t("previousPage")}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="back" flipInRtl className="size-5" />
                </button>
                <span className="text-footnote text-label-secondary">
                  <Ltr numeric>
                    {query.page} / {pageCount}
                  </Ltr>
                </span>
                <button
                  type="button"
                  disabled={query.page >= pageCount}
                  onClick={() => commit({ ...query, page: query.page + 1 }, { resetPage: false })}
                  aria-label={t("nextPage")}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="chevron" flipInRtl className="size-5" />
                </button>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </Scaffold>
  );
}
