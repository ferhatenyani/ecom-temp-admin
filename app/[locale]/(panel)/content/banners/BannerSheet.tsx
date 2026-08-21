"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Banner } from "@/lib/api/schemas/cms";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { CONTENT_STATUSES, type ContentStatus } from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { Sheet } from "@/components/primitives/Sheet";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { SelectField, TextAreaField, TextField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { useToast } from "@/components/primitives/Toast";
import { MediaPicker } from "@/components/patterns/MediaPicker";

/**
 * A banner, created and edited in a sheet.
 *
 * A sheet rather than a route, unlike a page: a banner is six fields and no
 * sub-resources, and the list it belongs to is the context — a banner strip is
 * an *ordered* thing, so editing one while the others stay visible is the point.
 * A page is a document and gets a screen.
 *
 * `placement` is a **free key** on the API's side and deliberately not an enum:
 * where a shop puts a banner is a shop's decision and the plugin is cloned per
 * client. So it is a plain text field rather than a picker — offering a fixed
 * list would be the panel inventing a vocabulary the backend refused to invent.
 * The placements already in use are used for one thing only: the default for a
 * *new* banner, so the common case is one tap rather than a typed key.
 */
export function BannerSheet({
  open,
  onOpenChange,
  banner,
  placements,
  nextPosition,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null for a create. */
  banner: Banner | null;
  /** The placements already in use, for the datalist. */
  placements: string[];
  /** `position` is dense, so a new banner goes on the end. */
  nextPosition: number;
  onSaved: () => void;
}) {
  const t = useTranslations("content");
  const toast = useToast();

  const [title, setTitle] = useState(decodeEntities(banner?.title ?? ""));
  const [caption, setCaption] = useState(banner?.caption ?? "");
  const [link, setLink] = useState(banner?.link ?? "");
  const [placement, setPlacement] = useState(banner?.placement ?? placements[0] ?? "home_hero");
  const [status, setStatus] = useState<ContentStatus>(banner?.status ?? "draft");
  const [imageId, setImageId] = useState<number | null>(banner?.image?.id ?? null);
  const [imageUrl, setImageUrl] = useState<string | null>(banner?.image?.url ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function save() {
    setSaving(true);
    setErrors({});

    try {
      const body = {
        title,
        caption,
        link,
        placement,
        status,
        position: banner?.position ?? nextPosition,
        // `image_url` is refused by name — "Upload through POST /media and send
        // the attachment id as image_id" — which is how the field was found.
        image_id: imageId,
      };

      if (banner) await acWrite("PATCH", `/cms/banners/${banner.id}`, body);
      else await acWrite("POST", "/cms/banners", body);

      toast.show(banner ? t("banners.saved") : t("banners.created"));
      onSaved();
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
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={banner ? t("banners.edit") : t("banners.create")}
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
            <Button
              variant="filled"
              onClick={() => void save()}
              loading={saving}
              className="flex-1"
            >
              {t("save")}
            </Button>
          </div>
        }
      >
        <ListGroup>
          <TextField
            label={t("banners.field.title")}
            value={title}
            onChange={setTitle}
            error={errors.title}
          />
          <TextAreaField
            label={t("banners.field.caption")}
            value={caption}
            onChange={setCaption}
            error={errors.caption}
            rows={3}
            hint={t("banners.field.captionHint")}
          />
          <TextField
            label={t("banners.field.link")}
            value={link}
            onChange={setLink}
            error={errors.link}
            isolate
            placeholder="/soldes"
            hint={t("banners.field.linkHint")}
          />
          <TextField
            label={t("banners.field.placement")}
            value={placement}
            onChange={setPlacement}
            error={errors.placement}
            isolate
            hint={t("banners.field.placementHint")}
          />
          <SelectField<ContentStatus>
            label={t("banners.field.status")}
            value={status}
            onChange={setStatus}
            options={CONTENT_STATUSES.map((value) => ({
              value,
              label: t(`status.${value}`),
            }))}
            error={errors.status}
          />
        </ListGroup>

        <ListGroup title={t("banners.field.image")}>
          <ListRow>
            {imageUrl ? (
              <>
                {/*
                  A plain `<img>`, not `next/image`. The URL is on the WordPress
                  origin, the optimiser would need it in `remotePatterns`, and
                  routing a staff-only thumbnail through an image CDN buys
                  nothing on a list of four.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt=""
                  className="size-14 shrink-0 rounded-md bg-surface-2 object-cover"
                />
                <span className="min-w-0 flex-1 text-footnote text-label-secondary">
                  {t("banners.imageAttached")}
                </span>
                <Button variant="plain" onClick={() => { setImageId(null); setImageUrl(null); }}>
                  {t("banners.imageRemove")}
                </Button>
              </>
            ) : (
              <>
                <Icon name="image" className="size-5 shrink-0 text-label-tertiary" />
                <span className="min-w-0 flex-1 text-footnote text-label-secondary">
                  {t("banners.imageNone")}
                </span>
                <Button variant="plain" onClick={() => setPickerOpen(true)}>
                  {t("banners.imageChoose")}
                </Button>
              </>
            )}
          </ListRow>
          {errors.image_id ? (
            <ListRow className="tone-danger tonal">
              <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 text-footnote">{errors.image_id}</span>
            </ListRow>
          ) : null}
        </ListGroup>
      </Sheet>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(item) => {
          setImageId(item.id);
          setImageUrl(item.url);
          setPickerOpen(false);
        }}
      />
    </>
  );
}
