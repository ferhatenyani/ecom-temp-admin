"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import type { Banner } from "@/lib/api/schemas/cms";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { CONTENT_STATUSES, embeddedImageSrc, type ContentStatus } from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { MediaPicker } from "@/components/ui/MediaPicker";
import {
  ErrorSummary,
  Section,
  Select,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { Icon } from "@/components/primitives/Icon";
import { useToast } from "@/components/primitives/Toast";

/**
 * A banner, created and edited in a `Drawer`.
 *
 * A drawer rather than a route, unlike a page: six fields and no sub-resources,
 * and the strip it belongs to is the context — a banner strip is an *ordered*
 * thing, so editing one while its neighbours stay visible is the point. A page
 * is a document and gets a screen.
 *
 * ## The image picker is a step, not a second overlay
 *
 * This used to be a `Sheet` opening a second `Sheet`, which DESIGN.md §3.1 rules
 * on directly — *"Never nested. A modal that needs a second modal is a modal that
 * needs steps."* At the 340px floor both are full screen, so the second simply
 * erased the first with nothing to say it was still there.
 *
 * `components/ui/MediaPicker.tsx` was promoted as a **panel with no chrome of
 * its own** precisely so this body can swap to it and back. The drawer keeps its
 * frame, the title says which step you are on, and the footer carries the one
 * control that step has. Picking *is* the commit, so there is no confirm beside
 * the back button.
 *
 * It is rendered only while the step is showing rather than mounted-and-hidden:
 * `MediaPicker`'s `active` prop exists to stop a closed form fetching a library
 * nobody asked for, and not rendering it at all is the stronger version of the
 * same thing. Re-entering the step is served from react-query's cache.
 *
 * ## `placement` is a free key and stays a text field
 *
 * Where a shop puts a banner is the shop's decision and the plugin is cloned per
 * client, so the API takes any string. Offering a fixed picker would be the panel
 * inventing a vocabulary the backend refused to invent. The placements already in
 * use are used for exactly one thing — the default for a *new* banner — so the
 * common case is no typing at all.
 */
export function BannerDrawer({
  open,
  banner,
  placements,
  nextPosition,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** `null` is the create form. The parent remounts on a `key`, so state seeds once. */
  banner: Banner | null;
  /** The placements already in use, for a new banner's default. */
  placements: string[];
  /** `position` is dense across the collection, so a new banner goes on the end. */
  nextPosition: number;
  returnFocusTo?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("content");
  const tUi = useTranslations("ui");
  const tMedia = useTranslations("media");
  const toast = useToast();

  const [step, setStep] = useState<"form" | "picker">("form");
  const [title, setTitle] = useState(decodeEntities(banner?.title ?? ""));
  const [caption, setCaption] = useState(banner?.caption ?? "");
  const [link, setLink] = useState(banner?.link ?? "");
  const [placement, setPlacement] = useState(
    banner?.placement ?? placements[0] ?? "home_hero",
  );
  const [status, setStatus] = useState<ContentStatus>(banner?.status ?? "draft");
  const [imageId, setImageId] = useState<number | null>(banner?.image?.id ?? null);
  /* `embeddedImageSrc`, not `image.url`: `MediaPresenter::image()` sends `src`
     and the harness sends `url`, and one place decides. A banner that had a
     picture used to throw at the schema boundary before it reached this line. */
  const [imageUrl, setImageUrl] = useState<string | null>(embeddedImageSrc(banner?.image));
  const [fields, setFields] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title,
        caption,
        link,
        placement,
        status,
        position: banner?.position ?? nextPosition,
        /* `image_url` is refused *by name* — "Upload through POST /media and send
           the attachment id as image_id" — which is how the field was found
           rather than guessed. */
        image_id: imageId,
      };

      return banner === null
        ? acWrite("POST", "/cms/banners", body)
        : acWrite("PATCH", `/cms/banners/${banner.id}`, body);
    },
    onSuccess: () => {
      toast.show(banner === null ? t("banners.created") : t("banners.saved"));
      onSaved();
    },
    onError: (error: unknown) => {
      /* A 400 lists every bad field at once and each binds to its own control;
         a toast with the first message throws the rest away. */
      if (error instanceof BrowserApiError && error.fields) {
        setFields(error.fields);
        return;
      }
      if (error instanceof Error) {
        toast.show(error.message, "danger");
        return;
      }
      throw error;
    },
  });

  /*
   * The summary, and why every control below names its own `id`.
   *
   * A 400 can name a field this form does not render, and an orphan still has to
   * be readable or somebody sees a refusal with no cause anywhere on screen.
   * Those render as text rather than as a link, per §3.4 — there is nowhere to
   * send them. `image_id` is the one field with a control but no `FieldFrame`,
   * so it links to the picker's own button.
   */
  const LABELLED: Record<string, { id: string; label: string }> = {
    title: { id: "banner-title", label: t("banners.field.title") },
    caption: { id: "banner-caption", label: t("banners.field.caption") },
    link: { id: "banner-link", label: t("banners.field.link") },
    placement: { id: "banner-placement", label: t("banners.field.placement") },
    status: { id: "banner-status", label: t("banners.field.status") },
    image_id: { id: "banner-image", label: t("banners.field.image") },
  };

  const failures: FormFailure[] = Object.entries(fields).map(([key, message]) => {
    const known = LABELLED[key];
    return known === undefined ? { message } : { id: known.id, label: known.label, message };
  });

  const picking = step === "picker";

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="md"
      returnFocusTo={returnFocusTo}
      title={
        picking
          ? tMedia("pickTitle")
          : banner === null
            ? t("banners.create")
            : t("banners.edit")
      }
      footer={
        picking ? (
          /* One control, because picking is itself the commit. */
          <Button variant="secondary" onClick={() => setStep("form")}>
            {t("banners.imageBack")}
          </Button>
        ) : (
          <>
            {/* Cancel first in DOM order: the first tab stop, and
                `flex-col-reverse` puts the primary on top on a phone. */}
            <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
              {tUi("cancel")}
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              {t("save")}
            </Button>
          </>
        )
      }
    >
      {picking ? (
        <MediaPicker
          onPick={(item) => {
            setImageId(item.id);
            setImageUrl(item.url);
            setStep("form");
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ErrorSummary failures={failures} />

          <TextField
            id="banner-title"
            label={t("banners.field.title")}
            value={title}
            onChange={setTitle}
            error={fields.title}
          />

          <TextArea
            id="banner-caption"
            label={t("banners.field.caption")}
            value={caption}
            onChange={setCaption}
            rows={3}
            hint={t("banners.field.captionHint")}
            error={fields.caption}
          />

          <TextField
            id="banner-link"
            label={t("banners.field.link")}
            value={link}
            onChange={setLink}
            isolate
            placeholder="/soldes"
            hint={t("banners.field.linkHint")}
            error={fields.link}
          />

          <TextField
            id="banner-placement"
            label={t("banners.field.placement")}
            value={placement}
            onChange={setPlacement}
            isolate
            hint={t("banners.field.placementHint")}
            error={fields.placement}
          />

          <Select<ContentStatus>
            id="banner-status"
            label={t("banners.field.status")}
            value={status}
            onChange={setStatus}
            options={CONTENT_STATUSES.map((value) => ({
              value,
              label: t(`status.${value}`),
            }))}
            error={fields.status}
          />

          {/* A `Section` inside an overlay renders its heading at
              `--text-subheading`, so it sits under the drawer's own title rather
              than beside it — §3.4's amendment. */}
          <Section title={t("banners.field.image")}>
            <div className="flex items-center gap-3">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt=""
                  className="size-12 shrink-0 rounded-ui-md border border-ui-line bg-ui-surface-2 object-cover"
                />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-ui-md border border-ui-line bg-ui-surface-2">
                  <Icon name="image" className="size-4 text-ui-subtle" />
                </span>
              )}

              <span className="min-w-0 flex-1 text-ui-label text-ui-muted">
                {imageUrl ? t("banners.imageAttached") : t("banners.imageNone")}
              </span>

              {imageUrl ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setImageId(null);
                    setImageUrl(null);
                  }}
                >
                  {t("banners.imageRemove")}
                </Button>
              ) : null}

              <Button
                id="banner-image"
                variant="secondary"
                size="sm"
                onClick={() => setStep("picker")}
              >
                {imageUrl ? t("banners.imageChange") : t("banners.imageChoose")}
              </Button>
            </div>
          </Section>
        </div>
      )}
    </Drawer>
  );
}
