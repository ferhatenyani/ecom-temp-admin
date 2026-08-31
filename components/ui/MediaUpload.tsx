"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { FileField, Section, TextField } from "@/components/ui/Form";
import { Notice } from "@/components/ui/States";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * Upload one image — the state and the fields, with **no chrome of its own**.
 *
 * ## Why this is a hook and a panel rather than a `Modal`
 *
 * It was a `Modal`, and `media/UploadModal.tsx` still is one: that is the right
 * shape over a page, and DESIGN.md §3.1's test for it — *a task that must be
 * finished or abandoned* — is exactly what choosing a file and watching it go
 * is. Nothing about that changed.
 *
 * What changed is that a second screen needs to upload from **inside a
 * `Drawer`**: the product create form attaches a featured image, and an image
 * that is not in the library yet has to be addable without leaving a half-typed
 * product behind. A `Modal` opened from inside a `Drawer` is two stacked
 * overlays, and §3.1 rules on it in the sentence this repository has now quoted
 * three times — *"Never nested. A modal that needs a second modal is a modal
 * that needs steps."* At the 340px floor both are full screen, so the second
 * simply erases the first with nothing to say it is still there.
 *
 * `components/ui/MediaPicker.tsx` is the precedent and the same move, one
 * component over: it was a `Sheet` opened from inside another `Sheet` and was
 * promoted to a **panel** so `BannerDrawer` could make it a *step*. This is that
 * promotion for the upload, and it is split in two rather than one because the
 * picker had a property this does not — *picking is the commit*, so its host
 * needed no control of its own. An upload has a send button, and the host draws
 * its own footer.
 *
 * So: `useMediaUpload()` owns everything that is not markup — the file, the two
 * metadata fields, the progress, the verdicts and the request — and
 * `MediaUploadFields` draws the body. A host wires the two together and supplies
 * the frame:
 *
 *     const upload = useMediaUpload(onUploaded);
 *     <Modal footer={<Button onClick={upload.send} …/>}>   // the library
 *     <Drawer footer={<Button onClick={upload.send} …/>}>  // the create form
 *       <MediaUploadFields upload={upload} idPrefix="…" />
 *
 * **The alternative was a second copy**, and it is worth naming what would have
 * drifted: the five refusals and their per-kind wording, the advisory/danger
 * split that is the whole difference between *"this will probably be refused"*
 * and *"this was refused"*, and the bar that goes indeterminate at "sent" rather
 * than sitting at 100 % through the server's `finfo` pass. Every one of those is
 * a decision argued at length in `media/UploadModal.tsx` and in `lib/media.ts`,
 * and every one of them is invisible in a diff of a second copy.
 *
 * Nothing about the modal's behaviour moved: `UploadModal` renders these and its
 * own footer exactly as it did, and the only visible change anywhere is the DOM
 * id of the file input, which nothing referenced.
 */

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

/** Everything a host needs, and nothing it has to reassemble. */
export type MediaUpload = {
  file: File | null;
  alt: string;
  title: string;
  setAlt: (next: string) => void;
  setTitle: (next: string) => void;
  /** A file input has no settable value, so clearing it means remounting it. */
  inputKey: number;
  problem: Verdict | null;
  progress: number | null;
  processing: boolean;
  /** The request is in flight. Every control in the body dims on this. */
  busy: boolean;
  /** There is a file to send. **Not** a verdict on it — see `choose`. */
  ready: boolean;
  choose: (file: File | null) => void;
  send: () => Promise<void>;
  reset: () => void;
};

/**
 * The upload, as state.
 *
 * `onUploaded` is called with the row the API answered, **after** the toast and
 * before the reset, so a host can close itself or step back without having to
 * know whether the panel has finished tidying.
 */
export function useMediaUpload(onUploaded: (item: MediaItem) => void): MediaUpload {
  const t = useTranslations("media");
  const toast = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [problem, setProblem] = useState<Verdict | null>(null);
  /* One number, no ref crossing the boundary — see `FileField`. */
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

  async function send() {
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

  return {
    file,
    alt,
    title,
    setAlt,
    setTitle,
    inputKey,
    problem,
    progress,
    processing,
    busy: progress !== null,
    ready: file !== null,
    choose,
    send,
    reset,
  };
}

/**
 * The body: the file, what the browser or the API thinks of it, the two optional
 * metadata fields, and the progress.
 *
 * No frame and no send control — the host owns both, because "cancel" in a modal
 * and "back to the picker" in a drawer step are different words for different
 * places, which is the same reason `MediaPicker` draws no back button.
 */
export function MediaUploadFields({
  upload,
  /**
   * DOM id namespace, so two hosts cannot mint one id twice. `id` is
   * document-wide and the library and the create drawer are on different routes
   * today — which is exactly the kind of "can never happen" that stops being
   * true silently, and is the argument `MediaGrid`'s `scope` already makes.
   */
  idPrefix,
}: {
  upload: MediaUpload;
  idPrefix: string;
}) {
  const t = useTranslations("media");
  const locale = useLocale();

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

  const { busy, file, problem } = upload;
  const shown = problem === null ? null : problemText(problem.value);
  const advisory = problem?.advisory === true;

  return (
    <div className="flex flex-col gap-4">
      <FileField
        key={upload.inputKey}
        id={`${idPrefix}-file`}
        label={t("chooseFile")}
        accept={ACCEPT_ATTRIBUTE}
        onChange={upload.choose}
        disabled={busy}
      />

      {file ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 rounded-ui-md bg-ui-surface-2 px-3 py-2">
          {/* **The name is in the field and is not repeated here.** `FileField`
              draws its own chrome, so it prints the chosen name in the panel's
              language where the UA used to print it in the browser's. What this
              block carries is the size, which is the fact the field does not
              have and the one `MAX_BYTES` is about. */}
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
            id={`${idPrefix}-alt`}
            label={t("field.alt")}
            value={upload.alt}
            onChange={upload.setAlt}
            hint={t("field.altHint")}
            disabled={busy}
          />
          <TextField
            id={`${idPrefix}-title`}
            label={t("field.title")}
            value={upload.title}
            onChange={upload.setTitle}
            disabled={busy}
          />
        </div>
      </Section>

      {busy ? (
        <div className="flex flex-col gap-2 rounded-ui-md border border-ui-line px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ui-label text-ui-fg">
              {upload.processing ? t("processing") : t("sending")}
            </span>
            {upload.processing ? null : (
              <Ltr className="text-ui-label text-ui-muted">
                {t("percent", { percent: Math.round((upload.progress ?? 0) * 100) })}
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
            aria-label={upload.processing ? t("processing") : t("sending")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              upload.processing ? undefined : Math.round((upload.progress ?? 0) * 100)
            }
            className="h-1.5 overflow-hidden rounded-ui-sm bg-ui-surface-3"
          >
            <div
              className={
                upload.processing
                  ? "indeterminate h-full w-full bg-ui-fg"
                  : "h-full bg-ui-fg"
              }
              style={
                upload.processing
                  ? undefined
                  : { inlineSize: `${(upload.progress ?? 0) * 100}%` }
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The cap, re-exported so a host can put it in its own description line. */
export { MAX_BYTES };
