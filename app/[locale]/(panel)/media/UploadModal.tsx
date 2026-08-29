"use client";

import { useState } from "react";
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
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { FileField, Section, TextField } from "@/components/ui/Form";
import { Notice } from "@/components/ui/States";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * What the panel can be holding: the API's verdict, or the browser's own — the
 * request never left. `uploadWithProgress` rejects with an English sentence for
 * the second, which is not a string this panel prints.
 */
type Problem = UploadRefusal | { kind: "transport" };

/**
 * A problem, and **who decided it** — which is the whole of the difference
 * between the two tones. `advisory` is the browser's own guess from a byte
 * length and a name; anything else is the API having answered. Carried beside
 * the verdict rather than inferred from the state around it: a server refusal
 * leaves `file` set and `progress` null, which is indistinguishable from a fresh
 * local one by inspection.
 */
type Verdict = { advisory: boolean; value: Problem };

/**
 * Upload one image.
 *
 * ## A `Modal`, not a `Drawer`
 *
 * DESIGN.md §3.1: a `Modal` is *a task that must be finished or abandoned*, a
 * `Drawer` is *context beside the page*. Choosing a file, watching it go and
 * being told whether it landed is the first of those, and nothing behind it is
 * being read from while it happens — which is the same test that made the
 * shipping rules form a `Modal` and `CreateParcelDrawer` a drawer. `md`, because
 * the body is a file input and two short fields.
 *
 * ## Progress is a percentage, not a spinner
 *
 * ADMIN_PANEL.md is explicit that this is the one screen where a spinner alone
 * is unacceptable on a 3G connection, and that requirement decides the
 * transport: `fetch` cannot report upload progress on any mobile browser this
 * panel targets, so this is the only place in the panel that uses
 * `XMLHttpRequest`. `lib/media.ts` carries that argument.
 *
 * **The bar stops at "sent", not at "done".** The bytes leaving is not the
 * request finishing — the API then sniffs the file with `finfo` *and*
 * `getimagesize()`, writes it and builds the response, which on a real photo is
 * a visible pause. Holding a progress bar at 100% through that is honest about
 * the upload and dishonest about the wait, so the label changes to "processing"
 * and the bar goes indeterminate with `aria-valuenow` **omitted** rather than
 * pinned at 100.
 *
 * ## Five refusals, and the client's own verdict is advisory
 *
 * The specification names 413 and 415. Measured, there are five distinguishable
 * failures and the fifth is the one that most needs its own wording: a JPEG
 * somebody renamed to `.png` is 415 with `details.extension` *and*
 * `details.detected`, and the fix is to re-export the file rather than to pick a
 * different one. "Only jpg, png and webp are accepted" would read as false to
 * somebody looking at a file called `.png`.
 *
 * **`precheck` warns and does not block, and that is a change.** The screen this
 * replaces disabled the upload button on any local verdict, which makes the
 * browser the authority — and `lib/media.ts` argues at length that it is not:
 * the cap is raisable with `AC_MEDIA_MAX_BYTES` and PHP's own limit can be lower
 * than either, so a client trusting its own arithmetic is wrong in **both**
 * directions. So a local verdict is a `warning` and the server's is a `danger`,
 * and the difference between the two tones is exactly the difference between
 * "this will probably be refused" and "this was refused".
 *
 * ## The API's English is never the panel's voice
 *
 * `classifyRefusal` has a seventh case for a code it has no branch for, and the
 * screen this replaces rendered that case's `message` — raw API English — as its
 * default. Here the *kind* is said in the reader's language and the API's own
 * sentence sits under it as `dir="ltr"` detail, which is the arrangement the
 * homepage drop report settled on: the untranslated half is evidence, not copy.
 */
export function UploadModal({
  open,
  online,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  /** False only when the browser is certain — see `useOnline`. */
  online: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (item: MediaItem) => void;
}) {
  const t = useTranslations("media");
  const tUi = useTranslations("ui");
  const tStates = useTranslations("states");
  const locale = useLocale();
  const toast = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [problem, setProblem] = useState<Verdict | null>(null);
  /* A file input has no settable value, so clearing it means remounting it —
     see `FileField`. One number, no ref crossing the boundary. */
  const [inputKey, setInputKey] = useState(0);

  const reset = () => {
    setFile(null);
    setAlt("");
    setTitle("");
    setProgress(null);
    setProcessing(false);
    setProblem(null);
    setInputKey((current) => current + 1);
  };

  const choose = (picked: File | null) => {
    setFile(picked);
    /* Advisory: this is what the browser can tell before spending the upload —
       a byte length and a name, and nothing else. It never gates the send. */
    const local = picked === null ? null : precheck(picked);
    setProblem(local === null ? null : { advisory: true, value: local });
  };

  async function upload() {
    if (!file) return;

    setProblem(null);
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

      /*
       * **201, and this accepts any 2xx carrying a row.** `MediaController::store`
       * answers 201 — read out of the controller rather than fired at the shop —
       * and a client that refused a 200 would be inventing a failure out of a
       * success. What it will not do is call an empty 2xx a win: the old screen
       * returned silently when `data` was missing, so a malformed success left
       * the modal open with no progress, no error and nothing to press.
       */
      if (status >= 200 && status < 300) {
        const item = (payload as { data?: MediaItem }).data;
        if (item) {
          toast.show(t("uploaded"));
          onUploaded(item);
          reset();
          onOpenChange(false);
          return;
        }
        setProblem({ advisory: false, value: { kind: "other", message: "" } });
        return;
      }

      const error = (payload as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      }).error;

      setProblem({
        advisory: false,
        value: classifyRefusal(status, error?.code, error?.details ?? {}, error?.message ?? ""),
      });
    } catch {
      setProblem({ advisory: false, value: { kind: "transport" } });
    } finally {
      setProgress(null);
      setProcessing(false);
    }
  }

  /** Every problem reads as a statement plus a fix, keyed on the kind. */
  const problemText = (
    value: Problem,
  ): { message: string; fix: string; detail?: string } => {
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
      case "transport":
        return { message: t("refusal.network"), fix: t("refusal.otherFix") };
      default:
        /* The API's own sentence as *evidence*, under a line in the reader's
           language — never as the message itself. It is English prose the API
           is free to reword, and this panel is read in French and Arabic. */
        return {
          message: t("refusal.other"),
          fix: t("refusal.otherFix"),
          detail: value.message === "" ? undefined : value.message,
        };
    }
  };

  const busy = progress !== null;
  const blocked = online ? null : tStates("offlineWrites");
  const shown = problem === null ? null : problemText(problem.value);
  const advisory = problem?.advisory === true;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t("uploadTitle")}
      description={t("uploadDescription", { max: formatBytes(MAX_BYTES, locale) })}
      size="md"
      /* The header's own upload button. Named rather than left to the recorded
         opener because clicking a `<button>` does not focus it on WebKit, so the
         recorded node there is `<body>` — which is focusable enough to swallow
         the restore and leave the keyboard at the top of the document. */
      returnFocusTo="media-upload"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {tUi("cancel")}
          </Button>
          <Button
            onClick={() => void upload()}
            loading={busy}
            /* Only the two things that genuinely stop a send: there is no file,
               or the browser is certain there is no network. A local refusal is
               advisory and does not reach here — see the docblock. */
            disabled={file === null || blocked !== null}
            title={blocked ?? undefined}
          >
            {t("upload")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FileField
          key={inputKey}
          id="media-file"
          label={t("chooseFile")}
          accept={ACCEPT_ATTRIBUTE}
          onChange={choose}
          disabled={busy}
        />

        {file ? (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 rounded-ui-md bg-ui-surface-2 px-3 py-2">
            {/* **The name moved up into the field and is no longer repeated
                here.** `FileField` draws its own chrome as of the transfer
                branch, so it prints the chosen name in the panel's language
                where the UA used to print it in the browser's — and this block
                was rendering the same string a second time, ten pixels below.
                What it still carries is the size, which is the fact the field
                does not have and the one `MAX_BYTES` is about. */}
            <span className="text-ui-caption text-ui-muted">{t("chosenFile")}</span>
            <Isolate className="text-ui-label text-ui-fg">
              {formatBytes(file.size, locale)}
            </Isolate>
          </div>
        ) : null}

        {shown ? (
          <Notice
            tone={advisory ? "warning" : "danger"}
            role={advisory ? "status" : "alert"}
            title={advisory ? t("refusal.advisoryTitle") : t("refusal.title")}
          >
            <p className="text-ui-label">{shown.message}</p>
            <p className="text-ui-caption">{shown.fix}</p>
            {shown.detail ? (
              /* The API's English, marked as its own language rather than laid
                 out backwards inside an Arabic paragraph. */
              <p dir="ltr" className="text-ui-caption break-words">
                {shown.detail}
              </p>
            ) : null}
          </Notice>
        ) : null}

        {/* Both fields are optional and both are editable afterwards, which the
            footnote says — so this never stands between somebody and the send. */}
        <Section title={t("metadata")} footnote={t("metadataNote")}>
          <div className="flex flex-col gap-3">
            <TextField
              id="media-upload-alt"
              label={t("field.alt")}
              value={alt}
              onChange={setAlt}
              hint={t("field.altHint")}
              disabled={busy}
            />
            <TextField
              id="media-upload-title"
              label={t("field.title")}
              value={title}
              onChange={setTitle}
              disabled={busy}
            />
          </div>
        </Section>

        {busy ? (
          <div className="flex flex-col gap-2 rounded-ui-md border border-ui-line px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ui-label text-ui-fg">
                {processing ? t("processing") : t("sending")}
              </span>
              {processing ? null : (
                <Ltr className="text-ui-label text-ui-muted">
                  {t("percent", { percent: Math.round((progress ?? 0) * 100) })}
                </Ltr>
              )}
            </div>
            {/*
              A determinate bar while the bytes are moving and an indeterminate
              one once they have landed. `aria-valuenow` is omitted in the second
              state rather than pinned at 100, because a progress bar reading
              "100 %" for eight seconds is the thing this is built to avoid.

              Ink rather than accent, per §3.3: accent belongs to links, focus
              and selection.
            */}
            <div
              role="progressbar"
              aria-label={processing ? t("processing") : t("sending")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={processing ? undefined : Math.round((progress ?? 0) * 100)}
              className="h-1.5 overflow-hidden rounded-ui-sm bg-ui-surface-3"
            >
              <div
                className={
                  processing ? "indeterminate h-full w-full bg-ui-fg" : "h-full bg-ui-fg"
                }
                style={processing ? undefined : { inlineSize: `${(progress ?? 0) * 100}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
