"use client";

import { useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { MediaItem } from "@/lib/api/schemas/media";
import {
  ACCEPT_ATTRIBUTE,
  MAX_BYTES,
  classifyRefusal,
  formatBytes,
  precheck,
  uploadWithProgress,
  type UploadRefusal,
} from "@/lib/media";
import { Sheet } from "@/components/primitives/Sheet";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { TextField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * Upload one image.
 *
 * **Progress is a percentage, not a spinner.** ADMIN_PANEL.md is explicit that
 * this is the one screen where a spinner alone is unacceptable on a 3G
 * connection, and that requirement decides the transport: `fetch` cannot report
 * upload progress on any mobile browser this panel targets, so this is the only
 * place in the panel that uses `XMLHttpRequest`. `lib/media.ts` carries that
 * argument.
 *
 * **The bar stops at "sent", not at "done".** The bytes leaving is not the
 * request finishing — the API then sniffs the file with `finfo` *and*
 * `getimagesize()`, writes it and builds the response, which on a real photo is
 * a visible pause. Holding a progress bar at 100% through that is honest about
 * the upload and dishonest about the wait, so the label changes to "processing"
 * and the bar goes indeterminate.
 *
 * **Five refusals, not two.** The specification names 413 and 415. Measured,
 * there are five distinguishable failures and the fifth is the one that most
 * needs its own wording: a JPEG somebody renamed to `.png` is 415 with
 * `details.extension` *and* `details.detected`, and the fix is to re-export the
 * file rather than to pick a different one. "Only jpg, png and webp are
 * accepted" would read as false to someone looking at a file called `.png`.
 */
export function UploadSheet({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (item: MediaItem) => void;
}) {
  const t = useTranslations("media");
  const locale = useLocale();
  const toast = useToast();

  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [refusal, setRefusal] = useState<UploadRefusal | null>(null);

  const reset = () => {
    setFile(null);
    setAlt("");
    setTitle("");
    setProgress(null);
    setProcessing(false);
    setRefusal(null);
    if (input.current) input.current.value = "";
  };

  const choose = (picked: File | null) => {
    setRefusal(null);
    setFile(picked);
    if (!picked) return;

    /*
     * Checked here **and** on the server, and the server is the authority. A
     * phone on mobile data should not spend forty seconds uploading a file that
     * will be refused; equally, the cap is raisable with `AC_MEDIA_MAX_BYTES`
     * and PHP's own limit can be lower than either, so a client trusting its own
     * arithmetic would be wrong in both directions.
     */
    const local = precheck(picked);
    if (local) setRefusal(local);
  };

  async function upload() {
    if (!file) return;

    setRefusal(null);
    setProgress(0);
    setProcessing(false);

    try {
      const { status, body } = await uploadWithProgress(
        file,
        { alt, title },
        (fraction) => {
          setProgress(fraction);
          if (fraction >= 1) setProcessing(true);
        },
      );

      const payload = body === "" ? {} : (JSON.parse(body) as Record<string, unknown>);

      if (status >= 200 && status < 300) {
        const item = (payload as { data?: MediaItem }).data;
        if (item) {
          toast.show(t("uploaded"));
          onUploaded(item);
          reset();
          onOpenChange(false);
        }
        return;
      }

      const error = (payload as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      }).error;

      setRefusal(
        classifyRefusal(
          status,
          error?.code,
          error?.details ?? {},
          error?.message ?? t("refusal.other"),
        ),
      );
    } catch {
      setRefusal({ kind: "other", message: t("refusal.network") });
    } finally {
      setProgress(null);
      setProcessing(false);
    }
  }

  /** Every refusal reads as a problem plus a fix, keyed on the kind. */
  const refusalText = (value: UploadRefusal): { message: string; fix: string } => {
    switch (value.kind) {
      case "too_large":
        return {
          message: t("refusal.tooLarge", {
            size: formatBytes(value.size, locale),
            max: formatBytes(value.maxBytes, locale),
          }),
          fix: t("refusal.tooLargeFix"),
        };
      case "too_small":
        return { message: t("refusal.tooSmall"), fix: t("refusal.tooSmallFix") };
      case "bad_extension":
        return {
          message: t("refusal.badExtension", { extension: value.extension }),
          fix: t("refusal.badExtensionFix"),
        };
      case "not_an_image":
        return {
          message: t("refusal.notAnImage", { detected: value.detected }),
          fix: t("refusal.notAnImageFix"),
        };
      case "contents_disagree":
        return {
          message: t("refusal.contentsDisagree", {
            extension: value.extension,
            detected: value.detected,
          }),
          fix: t("refusal.contentsDisagreeFix"),
        };
      case "bad_filename":
        return { message: t("refusal.badFilename"), fix: t("refusal.badFilenameFix") };
      default:
        return { message: value.message, fix: t("refusal.otherFix") };
    }
  };

  const busy = progress !== null;
  const blocked = refusal !== null && refusal.kind !== "other";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t("uploadTitle")}
      description={t("uploadDescription", { max: formatBytes(MAX_BYTES, locale) })}
      footer={
        <div className="flex items-center gap-3">
          <Button
            variant="plain"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="flex-1"
          >
            {t("cancel")}
          </Button>
          <Button
            variant="filled"
            onClick={() => void upload()}
            loading={busy}
            disabled={!file || blocked}
            className="flex-1"
          >
            {t("upload")}
          </Button>
        </div>
      }
    >
      <ListGroup>
        <ListRow>
          <input
            ref={input}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
            disabled={busy}
            aria-label={t("chooseFile")}
            className="min-h-11 w-full text-body text-label file:me-3 file:min-h-9 file:rounded-md file:border-0 file:bg-fill file:px-3 file:text-footnote file:text-label"
          />
        </ListRow>
        {file ? (
          <ListRow>
            <Icon name="image" className="size-5 shrink-0 text-label-tertiary" />
            <span className="flex min-w-0 flex-1 flex-col">
              {/* The *chosen* name, and it is labelled as such — the stored name
                  is generated server-side and is shown only after the upload. */}
              <Ltr numeric={false} className="truncate text-footnote text-label">
                {file.name}
              </Ltr>
              <Isolate className="text-caption text-label-secondary">
                {formatBytes(file.size, locale)}
              </Isolate>
            </span>
          </ListRow>
        ) : null}
      </ListGroup>

      {file && !blocked ? (
        <ListGroup title={t("metadata")} footnote={t("metadataNote")}>
          <TextField label={t("field.alt")} value={alt} onChange={setAlt} disabled={busy} />
          <TextField label={t("field.title")} value={title} onChange={setTitle} disabled={busy} />
        </ListGroup>
      ) : null}

      {busy ? (
        <div className="mb-8 rounded-lg bg-surface px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-footnote text-label">
              {processing ? t("processing") : t("sending")}
            </span>
            {!processing ? (
              <Ltr numeric className="text-footnote text-label-secondary">
                {Math.round((progress ?? 0) * 100)} %
              </Ltr>
            ) : null}
          </div>
          {/*
            A determinate bar while the bytes are moving and an indeterminate one
            once they have landed. `aria-valuenow` is omitted in the second state
            rather than pinned at 100, because a progress bar that says "100%"
            for eight seconds is the thing this is built to avoid.
          */}
          <div
            role="progressbar"
            aria-label={processing ? t("processing") : t("sending")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={processing ? undefined : Math.round((progress ?? 0) * 100)}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill"
          >
            <div
              className={processing ? "h-full w-full bg-accent indeterminate" : "h-full bg-accent"}
              style={processing ? undefined : { inlineSize: `${(progress ?? 0) * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      {refusal ? (
        <div className="tone-danger tonal mb-8 flex items-start gap-2 rounded-lg px-3 py-3">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-footnote">{refusalText(refusal).message}</span>
            <span className="text-caption opacity-80">{refusalText(refusal).fix}</span>
          </span>
        </div>
      ) : null}
    </Sheet>
  );
}
