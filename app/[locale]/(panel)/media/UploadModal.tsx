"use client";

import { useTranslations, useLocale } from "next-intl";
import type { MediaItem } from "@/lib/api/schemas/media";
import { formatBytes } from "@/lib/media";
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import {
  MAX_BYTES,
  MediaUploadFields,
  useMediaUpload,
} from "@/components/ui/MediaUpload";

/**
 * Upload one image, from the media library.
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
 * ## The body is `components/ui/MediaUpload.tsx` now, and this is the frame
 *
 * Everything that is not the frame — the file, the two metadata fields, the five
 * refusals, the advisory/danger split and the progress bar that goes
 * indeterminate at "sent" — moved into a hook and a panel beside `MediaPicker`,
 * and for the identical reason that component was promoted: **a second screen
 * needs it inside a `Drawer`.** The product create form attaches a featured
 * image and has to be able to add one that is not in the library yet, and a
 * `Modal` opened from inside a `Drawer` is the stacked overlay §3.1 refuses by
 * name. `MediaUpload`'s own docblock carries the whole argument and the list of
 * what a second copy would have drifted on.
 *
 * **Nothing about this screen's behaviour changed.** The modal still owns its
 * frame, its cancel-then-upload footer, its offline block and its
 * `returnFocusTo`; the only visible difference anywhere is the file input's DOM
 * id, which was `media-file` and is now `media-upload-file`, and which nothing
 * in this repository referenced.
 *
 * ## Progress is a percentage, not a spinner
 *
 * ADMIN_PANEL.md is explicit that this is the one screen where a spinner alone
 * is unacceptable on a 3G connection, and that requirement decides the
 * transport: `fetch` cannot report upload progress on any mobile browser this
 * panel targets, so this is the only place in the panel that uses
 * `XMLHttpRequest`. `lib/media.ts` carries that argument.
 *
 * ## `precheck` warns and does not block
 *
 * The screen this replaced disabled the upload button on any local verdict,
 * which makes the browser the authority — and `lib/media.ts` argues at length
 * that it is not: the cap is raisable with `AC_MEDIA_MAX_BYTES` and PHP's own
 * limit can be lower than either, so a client trusting its own arithmetic is
 * wrong in **both** directions. Which is why `disabled` below is only the two
 * things that genuinely stop a send.
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

  /* Closing on success is this host's business rather than the panel's: the
     create drawer steps *back* on the same event, which is a different place
     for the same word. */
  const upload = useMediaUpload((item) => {
    onUploaded(item);
    onOpenChange(false);
  });

  const blocked = online ? null : tStates("offlineWrites");

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) upload.reset();
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
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={upload.busy}
          >
            {tUi("cancel")}
          </Button>
          <Button
            onClick={() => void upload.send()}
            loading={upload.busy}
            /* Only the two things that genuinely stop a send: there is no file,
               or the browser is certain there is no network. A local refusal is
               advisory and does not reach here — see the docblock. */
            disabled={!upload.ready || blocked !== null}
            title={blocked ?? undefined}
          >
            {t("upload")}
          </Button>
        </>
      }
    >
      <MediaUploadFields upload={upload} idPrefix="media-upload" />
    </Modal>
  );
}
