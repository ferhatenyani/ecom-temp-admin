"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MediaItem } from "@/lib/api/schemas/media";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { formatBytes } from "@/lib/media";
import { formatWhen } from "@/lib/format/date";
import { decodeEntities } from "@/lib/format/html";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState, StaleBanner } from "@/components/patterns/States";
import { Sheet } from "@/components/primitives/Sheet";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { TextField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { useOnline } from "@/lib/use-online";
import { UploadSheet } from "./UploadSheet";

const PER_PAGE = 30;

/**
 * The media library.
 *
 * A grid rather than a list, which is the one place this panel departs from the
 * grouped-list grammar and does so because the content is the picture: a list
 * row showing a 44px thumbnail beside a generated filename is a worse way to
 * find an image than three columns of images.
 *
 * **There is no delete.** `DELETE /media/{id}` exists and `ac_manage_content`
 * allows it, and it is deliberately off the proxy allowlist with a unit test
 * saying so. Nothing in this API tells the panel what an attachment is used by —
 * a banner's `image`, a page thumbnail and a homepage section all reference one
 * with no back-reference anywhere — so the library cannot answer "what would
 * this break?". An irreversible action a screen cannot explain is worse than one
 * it does not offer.
 */
export function MediaLibrary({
  initialItems,
  initialTotal,
}: {
  initialItems: MediaItem[] | null;
  initialTotal: number | null;
}) {
  const t = useTranslations("media");
  const locale = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["media", "library", page],
    queryFn: async () => {
      const { data: items, total } = await acRead<MediaItem[]>(
        `/media?per_page=${PER_PAGE}&page=${page}`,
      );
      return { items, total };
    },
    initialData:
      initialItems !== null && page === 1
        ? { items: initialItems, total: initialTotal ?? initialItems.length }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["media"] });

  return (
    <Scaffold
      title={t("title")}
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
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            aria-label={t("upload")}
            className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
          >
            <Icon name="plus" className="size-5" />
          </button>
        </div>
      }
    >
      {!online && dataUpdatedAt > 0 ? (
        <div className="mx-auto max-w-3xl">
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl px-4">
        <p aria-live="polite" className="mb-2 px-1 text-footnote text-label-secondary" data-testid="media-count">
          <Isolate numeric>{t("count", { total })}</Isolate>
        </p>

        {isPending && items.length === 0 ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t("loading")}
            className="grid grid-cols-3 gap-2 sm:grid-cols-4"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="skeleton aspect-square rounded-md" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            message={t("empty")}
            action={{ label: t("upload"), onClick: () => setUploadOpen(true) }}
          />
        ) : (
          <>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(item)}
                    className="press block w-full overflow-hidden rounded-md bg-surface-2"
                    aria-label={item.alt || item.title || item.filename}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={item.alt || item.title}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>

            {total > PER_PAGE ? (
              <nav className="mt-3 mb-8 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  aria-label={t("previousPage")}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="back" flipInRtl className="size-5" />
                </button>
                <span className="text-footnote text-label-secondary">
                  <Ltr numeric>
                    {page} / {pageCount}
                  </Ltr>
                </span>
                <button
                  type="button"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => current + 1)}
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

      <UploadSheet
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => {
          invalidate();
          setPage(1);
        }}
      />

      {selected ? (
        <MediaDetail
          item={selected}
          onOpenChange={(open) => !open && setSelected(null)}
          onSaved={(updated) => {
            setSelected(updated);
            invalidate();
            toast.show(t("saved"));
          }}
        />
      ) : null}
    </Scaffold>
  );
}

/**
 * One item's metadata.
 *
 * The **stored filename** is the one rendered, never the name that was picked.
 * Measured: uploading `real.jpg` three times stored `real.jpg`, `real-1.jpg` and
 * `real-2.jpg`, and the extension comes from the sniffed type rather than from
 * the name — so a screen echoing the chosen name would show a file that is not
 * the file.
 */
function MediaDetail({
  item,
  onOpenChange,
  onSaved,
}: {
  item: MediaItem;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: MediaItem) => void;
}) {
  const t = useTranslations("media");
  const locale = useLocale();
  const toast = useToast();

  const [alt, setAlt] = useState(decodeEntities(item.alt));
  const [title, setTitle] = useState(decodeEntities(item.title));
  const [caption, setCaption] = useState(decodeEntities(item.caption));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setErrors({});

    try {
      const updated = await acWrite<MediaItem>("PATCH", `/media/${item.id}`, {
        alt,
        title,
        caption,
      });
      onSaved(updated);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof BrowserApiError) {
        setErrors(error.fields ?? {});
        toast.show(error.message, "danger");
      } else {
        throw error;
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={t("detailTitle")}
      footer={
        <div className="flex items-center gap-3">
          <Button
            variant="plain"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="flex-1"
          >
            {t("cancel")}
          </Button>
          <Button variant="filled" onClick={() => void save()} loading={saving} className="flex-1">
            {t("save")}
          </Button>
        </div>
      }
    >
      <div className="mb-4 overflow-hidden rounded-lg bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.alt || item.title}
          className="max-h-64 w-full object-contain"
        />
      </div>

      <ListGroup>
        <TextField label={t("field.alt")} value={alt} onChange={setAlt} error={errors.alt} hint={t("field.altHint")} />
        <TextField label={t("field.title")} value={title} onChange={setTitle} error={errors.title} />
        <TextField
          label={t("field.caption")}
          value={caption}
          onChange={setCaption}
          error={errors.caption}
        />
      </ListGroup>

      <ListGroup title={t("fileGroup")} footnote={t("filenameNote")}>
        <ListValueRow
          label={t("field.filename")}
          value={<Ltr numeric={false}>{item.filename}</Ltr>}
        />
        <ListValueRow
          label={t("field.type")}
          value={<Ltr numeric={false}>{item.mime_type}</Ltr>}
        />
        <ListValueRow
          label={t("field.size")}
          value={<Isolate>{formatBytes(item.filesize, locale)}</Isolate>}
        />
        {item.width !== null && item.height !== null ? (
          <ListValueRow
            label={t("field.dimensions")}
            value={
              <Ltr numeric>
                {item.width} × {item.height}
              </Ltr>
            }
          />
        ) : null}
        <ListValueRow
          label={t("field.uploaded")}
          value={<Isolate>{formatWhen(item.date_created, locale)}</Isolate>}
        />
        <ListRow>
          <Icon name="link" className="size-4 shrink-0 text-label-tertiary" />
          <Ltr numeric={false} className="min-w-0 flex-1 truncate text-footnote text-label-secondary">
            {item.url}
          </Ltr>
        </ListRow>
      </ListGroup>
    </Sheet>
  );
}
