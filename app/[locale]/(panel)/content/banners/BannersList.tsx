"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Banner } from "@/lib/api/schemas/cms";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { positionWrites } from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState } from "@/components/patterns/States";
import { MoveControls, moveItem } from "@/components/patterns/MoveControls";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { ActionSheet } from "@/components/primitives/ActionSheet";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { useToast } from "@/components/primitives/Toast";
import { RowSkeleton } from "../../inventory/RowSkeleton";
import { BannerSheet } from "./BannerSheet";

/**
 * The banner strip.
 *
 * Grouped by `placement` and ordered by `position` within each group, because
 * that is what a banner *is*: `home_hero` is a carousel and the order is the
 * content. Two groups on this shop, and `placement` is a free key on the API's
 * side, so the grouping comes from the data rather than from a list here.
 *
 * **Reordering writes immediately, one PATCH per moved banner.** `position` is
 * dense — measured `0,1,2` across the collection, not sparse — so a swap is two
 * writes and nothing has to renumber the rest. There is no bulk endpoint and no
 * save bar: a list with a pending order is a list showing something that is not
 * true, and the write is small enough not to need batching.
 */
export function BannersList({
  locale,
  initialBanners,
}: {
  locale: string;
  initialBanners: Banner[] | null;
}) {
  const t = useTranslations("content");
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Banner | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["cms", "banners"],
    queryFn: async () => {
      const { data: banners } = await acRead<Banner[]>(
        "/cms/banners?per_page=100&status=any",
      );
      return banners;
    },
    initialData: initialBanners ?? undefined,
  });

  const banners = data ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["cms", "banners"] });

  /** Placements in the order they first appear, so the grouping is stable. */
  const placements = [...new Set(banners.map((banner) => banner.placement))];

  async function reorder(group: Banner[], from: number, to: number) {
    setBusy(true);
    const next = moveItem(group, from, to);

    try {
      /*
       * Only the rows whose position actually changed. A move within a group of
       * three is two writes, not three — and sending an unchanged position back
       * would be a write that says nothing and still counts against the
       * 120/minute cap. `positionWrites()` carries the rule and is unit-tested,
       * because "which rows moved" is arithmetic rather than interaction.
       */
      await Promise.all(
        positionWrites(group, next).map(({ id, position }) =>
          acWrite("PATCH", `/cms/banners/${id}`, { position }),
        ),
      );
      invalidate();
    } catch (caught) {
      if (caught instanceof BrowserApiError) toast.show(caught.message, "danger");
      else throw caught;
    } finally {
      setBusy(false);
    }
  }

  async function remove(banner: Banner) {
    setBusy(true);
    try {
      await acWrite("DELETE", `/cms/banners/${banner.id}?force=true`);
      toast.show(t("banners.deleted"));
      invalidate();
    } catch (caught) {
      if (caught instanceof BrowserApiError) toast.show(caught.message, "danger");
      else throw caught;
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  return (
    <Scaffold
      title={t("section.banners")}
      back={{ href: `/${locale}/content`, label: t("title") }}
      trailing={
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label={t("banners.create")}
          className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
        >
          <Icon name="plus" className="size-5" />
        </button>
      }
    >
      <div className="mx-auto max-w-3xl px-4">
        <p aria-live="polite" className="mb-2 px-1 text-footnote text-label-secondary" data-testid="banners-count">
          <Isolate numeric>{t("banners.count", { total: banners.length })}</Isolate>
        </p>

        {isPending && banners.length === 0 ? (
          <RowSkeleton rows={4} />
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : banners.length === 0 ? (
          <EmptyState
            message={t("banners.empty")}
            action={{ label: t("banners.create"), onClick: () => setCreating(true) }}
          />
        ) : (
          placements.map((placement) => {
            const group = banners
              .filter((banner) => banner.placement === placement)
              .sort((a, b) => a.position - b.position);

            return (
              <ListGroup
                key={placement}
                title={<Ltr numeric={false}>{placement}</Ltr>}
                footnote={t("banners.placementNote")}
              >
                {group.map((banner, index) => (
                  <ListRow key={banner.id} className="items-start">
                    {banner.image ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={banner.image.url}
                          alt={banner.image.alt ?? ""}
                          loading="lazy"
                          className="size-11 shrink-0 rounded-md bg-surface-2 object-cover"
                        />
                      </>
                    ) : (
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-2">
                        <Icon name="image" className="size-4 text-label-tertiary" />
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => setEditing(banner)}
                      className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-1 text-start"
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-body text-label" dir="auto">
                          {decodeEntities(banner.title)}
                        </span>
                        {banner.status === "draft" ? (
                          <StatusBadge tone="warning">{t("status.draft")}</StatusBadge>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2 text-footnote text-label-secondary">
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

                    <MoveControls
                      index={index}
                      count={group.length}
                      onMove={(from, to) => void reorder(group, from, to)}
                      label={decodeEntities(banner.title)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={() => setRemoving(banner)}
                      disabled={busy}
                      aria-label={t("banners.delete", { label: decodeEntities(banner.title) })}
                      className="press flex size-11 shrink-0 items-center justify-center rounded-md text-label-secondary disabled:opacity-30"
                    >
                      <Icon name="trash" className="size-5" />
                    </button>
                  </ListRow>
                ))}
              </ListGroup>
            );
          })
        )}
      </div>

      {creating ? (
        <BannerSheet
          open
          onOpenChange={(open) => !open && setCreating(false)}
          banner={null}
          placements={placements}
          nextPosition={banners.length}
          onSaved={invalidate}
        />
      ) : null}

      {editing ? (
        <BannerSheet
          open
          onOpenChange={(open) => !open && setEditing(null)}
          banner={editing}
          placements={placements}
          nextPosition={banners.length}
          onSaved={invalidate}
        />
      ) : null}

      <ActionSheet
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("banners.deleteTitle")}
        description={t("banners.deleteBody")}
        actions={[
          {
            label: t("banners.deleteAction"),
            tone: "destructive",
            onSelect: () => removing && void remove(removing),
          },
        ]}
        cancelLabel={t("cancel")}
      />
    </Scaffold>
  );
}
