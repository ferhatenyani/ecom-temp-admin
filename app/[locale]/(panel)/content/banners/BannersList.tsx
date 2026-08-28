"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Banner } from "@/lib/api/schemas/cms";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  CMS_LIST_PER_PAGE,
  DEFAULT_STATUS_FILTER,
  embeddedImageSrc,
  isStatusFilter,
  positionWrites,
  reorderBlock,
  type StatusFilter,
} from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { FilterTabs } from "@/components/ui/FilterBar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { Reorder, moveItem } from "@/components/ui/Reorder";
import { ConfirmDialog, useConfirm } from "@/components/ui/Confirm";
import { useLatchedOpener } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, Notice, StaleBanner } from "@/components/ui/States";
import { Icon } from "@/components/primitives/Icon";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { BannerRowsSkeleton } from "./skeleton";
import { BannerDrawer } from "./BannerDrawer";

/**
 * The banner strip.
 *
 * ## Grouped by placement, and the grouping is not a filter
 *
 * `placement` is a **free string** on the API's side by design — where a shop
 * puts a banner is the shop's decision and the plugin is cloned per client — so
 * the allowlisted enumeration of placements can never be complete, and
 * DECISIONS.md's picker rule refuses a picker over a working filter unless the
 * enumeration is. There is therefore **no placement filter**, and what survives
 * is the grouping: a presentation of the rows already in hand rather than a
 * request. The footnote under the list says so, because an absence left unstated
 * reads as an unfinished control.
 *
 * ## Status is three tabs and `any` is the default, which inverts every other list
 *
 * On `/cms/*` the absence of `?status=` means **publish only**. So `any` is
 * first, `any` is the default, and — following the panel-wide rule that the
 * default is the value omitted from the URL — `any` is the one tab that sends no
 * parameter *to the URL* while still sending `?status=any` to the API.
 *
 * ## Reordering writes immediately, and only from the complete list
 *
 * `position` is dense across the collection, measured `0,1,2`, and there is no
 * bulk endpoint — so a move is one `PATCH` per row that actually moved and there
 * is no save bar. A list with a pending order is a list showing something that
 * is not true.
 *
 * Both halves of "the complete list" are load-bearing and neither was checked
 * before this branch:
 *
 *   **The fetch must have reached the end.** `per_page=100` with `meta.total`
 *   ignored meant a 101st row was invisible *and* a move renumbered the visible
 *   hundred over the top of rows nobody fetched.
 *
 *   **No status filter may be applied.** The rows `?status=publish` returns
 *   carry the collection's own positions with the drafts missing from the middle
 *   — `0, 2, 3` — so `positionWrites()` reports writes for rows nobody touched
 *   and lands them on the draft's slot. This one is not in the ledger's own list
 *   of things to fix; it is what decision 2 and decision 9 produce together.
 *
 * `reorderBlock()` in `lib/cms.ts` answers both, and `tests/cms-reorder.test.ts`
 * reproduces each corruption rather than asserting it would happen.
 *
 * ## The move is computed over the collection, never over the group
 *
 * A group is a *subset* of a dense collection-wide sequence, so writing
 * "index within the group" would give two placements a row at position 0 each.
 * `reorderWrites()` below keeps the global slots the group occupies and
 * reassigns them in the new intra-group order, so the other placements' rows are
 * untouched and `positionWrites()` still sees the whole array.
 */
const TABS: readonly StatusFilter[] = ["any", "publish", "draft"] as const;

const rowOpenerId = (id: number) => `banner-opener-${id}`;
const rowMenuId = (id: number) => `banner-menu-${id}`;

export function BannersList({
  locale,
  initialStatus,
  initialBanners,
  initialTotal,
}: {
  locale: string;
  initialStatus: StatusFilter;
  initialBanners: Banner[] | null;
  initialTotal: number | null;
}) {
  const t = useTranslations("content");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const requested = searchParams.get("status") ?? "";
  const status: StatusFilter = isStatusFilter(requested) ? requested : DEFAULT_STATUS_FILTER;

  const [editing, setEditing] = useState<Banner | "new" | null>(null);
  const confirm = useConfirm<Banner>();

  /* The browser is trusted in one direction only — it reports the interface
     rather than reachability — so the refresh control stays enabled. */
  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["cms", "banners", status],
    queryFn: async () => {
      const { data: banners, total } = await acRead<Banner[]>(
        `/cms/banners?per_page=${CMS_LIST_PER_PAGE}&status=${status}`,
      );
      return { banners, total };
    },
    initialData:
      initialBanners !== null && status === initialStatus
        ? { banners: initialBanners, total: initialTotal ?? initialBanners.length }
        : undefined,
    /* Changing tab keeps the previous rows on screen instead of flashing a
       skeleton over content that is still readable — §3.6's third mechanism. */
    placeholderData: keepPreviousData,
  });

  /** The whole fetched collection in stored order. Positions are dense over *this*. */
  const ordered = useMemo(
    () => [...(data?.banners ?? [])].sort((a, b) => a.position - b.position),
    [data],
  );

  const fetched = ordered.length;
  /* `meta.total` where the envelope carried one; the row count is the floor, so
     a missing `meta` never reports fewer banners than are on screen. */
  const total = Math.max(data?.total ?? 0, fetched);
  const blocked = reorderBlock({ status, fetched, total: data?.total ?? 0 });

  /** Placements in the order they first appear, so the grouping is stable. */
  const placements = useMemo(
    () => [...new Set(ordered.map((banner) => banner.placement))],
    [ordered],
  );

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["cms", "banners"] });

  const failed = (caught: unknown) => {
    if (caught instanceof BrowserApiError || caught instanceof Error) {
      toast.show(caught.message, "danger");
      return;
    }
    throw caught;
  };

  /**
   * Which rows a move inside one placement writes, expressed over the whole
   * collection. See the docblock: a group is a subset of one dense sequence.
   */
  function reorderWrites(placement: string, from: number, to: number) {
    const slots = ordered.flatMap((banner, index) =>
      banner.placement === placement ? [index] : [],
    );
    const moved = moveItem(
      slots.map((slot) => ordered[slot]),
      from,
      to,
    );

    const next = [...ordered];
    slots.forEach((slot, index) => {
      next[slot] = moved[index];
    });

    return positionWrites(ordered, next);
  }

  const move = useMutation({
    mutationFn: async (writes: { id: number; position: number }[]) => {
      await Promise.all(
        writes.map(({ id, position }) =>
          acWrite("PATCH", `/cms/banners/${id}`, { position }),
        ),
      );
    },
    onSuccess: invalidate,
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: (banner: Banner) =>
      acWrite("DELETE", `/cms/banners/${banner.id}?force=true`),
    onSuccess: () => {
      confirm.close();
      toast.show(t("banners.deleted"));
      invalidate();
    },
    onError: (caught: unknown) => {
      confirm.close();
      failed(caught);
    },
  });

  const busy = move.isPending || remove.isPending;

  /* Latched: `useConfirm` clears its target on close and Radix fires
     `onCloseAutoFocus` *after* `onOpenChange`, so an id derived from the target
     is already `undefined` when the overlay reads it. */
  const confirmOpener = useLatchedOpener(confirm.target && rowMenuId(confirm.target.id));
  const drawerOpener = useLatchedOpener(
    editing !== null && editing !== "new" ? rowOpenerId(editing.id) : null,
  );

  const commitStatus = (next: StatusFilter) =>
    router.push(
      `/${locale}/content/banners${next === DEFAULT_STATUS_FILTER ? "" : `?status=${next}`}`,
      { scroll: false },
    );

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.banners")}
        subtitle={
          <span data-testid="banners-count">
            <Isolate>{t("banners.count", { total })}</Isolate>
          </span>
        }
        back={{ href: `/${locale}/content`, label: t("title") }}
        actions={
          <>
            <IconButton
              label={t("refresh")}
              icon="refresh"
              variant="secondary"
              onClick={() => void refetch()}
              loading={isFetching}
            />
            <Button icon="plus" onClick={() => setEditing("new")}>
              {t("banners.create")}
            </Button>
          </>
        }
        toolbar={
          <FilterTabs<StatusFilter>
            tabs={TABS.map((value) => ({ value, label: t(`statusFilter.${value}`) }))}
            value={status}
            onChange={commitStatus}
            label={t("statusLabel")}
          />
        }
      />

      <PageBody width="detail">
        {(!online || isError) && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
            reason={online ? "refreshFailed" : "offline"}
          />
        ) : null}

        <p aria-live="polite" className="sr-only" data-testid="banners-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && fetched === 0 ? (
          <BannerRowsSkeleton label={t("loading")} />
        ) : isError && fetched === 0 ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : fetched === 0 ? (
          /* No banners at all offers the create action; no banners *for this
             status* offers the tab that has them. Collapsing the two is how an
             empty state ends up saying nothing useful. */
          <EmptyState
            icon={status === DEFAULT_STATUS_FILTER ? "image" : "search"}
            message={
              status === DEFAULT_STATUS_FILTER
                ? t("banners.empty")
                : t("banners.emptyFiltered")
            }
            action={
              status === DEFAULT_STATUS_FILTER
                ? { label: t("banners.create"), onClick: () => setEditing("new") }
                : {
                    label: t("empty.clear"),
                    onClick: () => commitStatus(DEFAULT_STATUS_FILTER),
                  }
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/*
              Truncation is a warning rather than a footnote: rows are missing
              from the screen, not merely a control. It names both consequences,
              because a reader who only learns the second would go looking for
              the rest of their banners.
            */}
            {blocked === "truncated" ? (
              <Notice tone="warning" title={t("banners.truncatedTitle")}>
                <p className="text-ui-label">
                  <Isolate>{t("banners.truncatedBody", { shown: fetched, total })}</Isolate>
                </p>
              </Notice>
            ) : null}

            {placements.map((placement) => {
              const group = ordered.filter((banner) => banner.placement === placement);

              return (
                <Card
                  key={placement}
                  /*
                    The heading is the theme's raw key — `home_hero` — and it is
                    **not** `Ltr`-wrapped, because `Card.title` is a `string` and
                    cannot carry a wrapper. It is safe as it stands rather than by
                    luck: a placement is an ASCII identifier, and a pure L run
                    inside an RTL paragraph keeps its own order. A key that began
                    or ended with digits would want the wrap, which is a limit of
                    the primitive rather than of this screen.
                  */
                  title={placement}
                >
                  <ul className="flex flex-col">
                    {group.map((banner, index) => (
                      <li key={banner.id} className="ui-row flex min-w-0 items-center gap-3 py-2">
                        {/* `embeddedImageSrc` rather than `image.url`: the
                            presenter's key is `src` and the harness's is `url`,
                            so the *presence of a picture* is the presence of a
                            URL and not the presence of the object — see
                            `lib/api/schemas/cms.ts`. */}
                        {embeddedImageSrc(banner.image) !== null ? (
                          /* A plain `<img>`, not `next/image`: the URL is on the
                             WordPress origin, the optimiser would need it in
                             `remotePatterns`, and routing a staff-only thumbnail
                             through a CDN buys nothing on a list of four. */
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={embeddedImageSrc(banner.image) ?? ""}
                            /* Decorative here, so `alt=""` rather than
                               `image.alt`: the banner's title is the next
                               element in the same row and is the row's
                               accessible name, so announcing the picture's own
                               description would read the row twice. The alt text
                               belongs on the storefront, where the image is the
                               content. */
                            alt=""
                            loading="lazy"
                            className="size-10 shrink-0 rounded-ui-md border border-ui-line bg-ui-surface-2 object-cover"
                          />
                        ) : (
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-ui-md border border-ui-line bg-ui-surface-2">
                            <Icon name="image" className="size-4 text-ui-subtle" />
                          </span>
                        )}

                        {/*
                          The identifying cell is a real `<button>` with a stable
                          id — the keyboard path to the drawer, and the target its
                          `returnFocusTo` names. A stretched overlay would cover
                          the reorder pair beside it.
                        */}
                        <button
                          id={rowOpenerId(banner.id)}
                          type="button"
                          onClick={() => setEditing(banner)}
                          className="ui-ring ui-interactive flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-ui-md text-start"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              dir="auto"
                              className="min-w-0 truncate text-ui-subheading text-ui-fg"
                            >
                              {decodeEntities(banner.title)}
                            </span>
                            {banner.status === "draft" ? (
                              <Badge tone="warning">{t("status.draft")}</Badge>
                            ) : null}
                          </span>
                          <span className="flex min-w-0 items-center gap-2 text-ui-label text-ui-muted">
                            {banner.link !== "" ? (
                              <Ltr numeric={false} className="min-w-0 truncate">
                                {banner.link}
                              </Ltr>
                            ) : (
                              <span className="truncate">{t("banners.noLink")}</span>
                            )}
                            <Isolate className="ms-auto shrink-0">
                              {formatWhen(banner.date_modified, locale)}
                            </Isolate>
                          </span>
                        </button>

                        {/* Not rendered when the list in hand is not the whole
                            collection — §3.3, and see `reorderBlock()`. */}
                        {blocked === null ? (
                          <Reorder
                            index={index}
                            count={group.length}
                            onMove={(from, to) =>
                              move.mutate(reorderWrites(placement, from, to))
                            }
                            label={decodeEntities(banner.title)}
                            disabled={busy}
                          />
                        ) : null}

                        <Menu
                          label={t("banners.rowActions", {
                            label: decodeEntities(banner.title),
                          })}
                          actions={[
                            {
                              key: "delete",
                              label: t("banners.deleteAction"),
                              icon: "trash",
                              destructive: true,
                              disabled: busy,
                              onSelect: () => confirm.ask(banner),
                            },
                          ]}
                          trigger={
                            <IconButton
                              id={rowMenuId(banner.id)}
                              label={t("banners.rowActions", {
                                label: decodeEntities(banner.title),
                              })}
                              icon="more"
                              variant="ghost"
                              size="sm"
                              className="shrink-0"
                            />
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}

            <div className="flex flex-col gap-1 text-ui-label text-ui-subtle">
              <p>{t("banners.listNote")}</p>
              {/* A filtered tab is recoverable in one click, so it is a line
                  rather than a warning — and the line names the tab. */}
              {blocked === "filtered" ? <p>{t("banners.reorderFiltered")}</p> : null}
            </div>
          </div>
        )}
      </PageBody>

      <BannerDrawer
        /* The remount that replaces an effect: opening a different banner gives
           the form a different key, so its state initialisers run again. */
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        open={editing !== null}
        banner={editing === "new" ? null : editing}
        placements={placements}
        /* A new banner appends to the **collection**, not to the page in hand:
           at `total` rather than at `fetched`, so a truncated list does not
           create a row on top of one it never saw. */
        nextPosition={total}
        returnFocusTo={drawerOpener}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidate();
        }}
      />

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.onOpenChange}
        returnFocusTo={confirmOpener}
        tone="destructive"
        loading={remove.isPending}
        title={t("banners.deleteTitle")}
        /*
         * **No `requireTyped`, and the reason is measured rather than a
         * preference.** §3.1 asks an irreversible act to be confirmed by typing
         * the record's identifier, and it was written for a SKU, an order number
         * and a coupon code — short strings a person reads off the screen and
         * types back. A banner's only identifier is its title, and
         * `lib/api/schemas/cms.ts` records that WordPress **texturizes** it: an
         * apostrophe comes back as U+2019, so "Soldes d’été" cannot be typed on
         * the keyboard of the person reading it. A guard nobody can satisfy is
         * not a guard, it is a dead end with a text box. The dialog names the
         * banner instead, which is the shipping branch's amendment.
         */
        body={
          <>
            <p className="text-ui-subheading text-ui-fg" dir="auto">
              {confirm.target ? decodeEntities(confirm.target.title) : ""}
            </p>
            <p className="mt-1.5">{t("banners.deleteBody")}</p>
          </>
        }
        confirmLabel={t("banners.deleteAction")}
        onConfirm={() => {
          if (confirm.target) remove.mutate(confirm.target);
        }}
      />
    </div>
  );
}
