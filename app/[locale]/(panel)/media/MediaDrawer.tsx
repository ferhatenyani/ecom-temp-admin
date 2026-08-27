"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import type { MediaItem } from "@/lib/api/schemas/media";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { formatBytes } from "@/lib/media";
import { formatWhen } from "@/lib/format/date";
import { decodeEntities } from "@/lib/format/html";
import { Drawer, useLatchedOpener } from "@/components/ui/Overlay";
import { mediaTileId } from "@/components/ui/MediaGrid";
import { DataList, DataRow } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  ErrorSummary,
  Section,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * The tile ids this screen's grid renders, written once because two files need
 * them: `MediaLibrary` hands the scope to `MediaGrid`, and this drawer names one
 * tile as its `returnFocusTo`. The scope keeps them distinct from the picker's,
 * which carries its own — `id` is document-wide, and the two grids being
 * un-co-mountable today is not a property anything enforces.
 */
export const MEDIA_SCOPE = "media";
export const mediaOpenerId = (id: number) => mediaTileId(MEDIA_SCOPE, id);

/** The three fields `MediaInput` accepts, in the order they are rendered. */
const EDITABLE = ["alt", "title", "caption"] as const;
type Editable = (typeof EDITABLE)[number];
type Draft = Record<Editable, string>;

/**
 * One attachment, previewed and edited.
 *
 * ## A peek at `?peek=<id>`, and it costs no request
 *
 * `MediaPresenter::toArrayList()` is `array_map(toArray)`, so `GET /media/{id}`
 * returns the list row **exactly** — the peek is free by DECISIONS.md's standing
 * rule and renders from the page already in memory. There is no media detail
 * route for it to preview, either: this is the record's only screen, which is
 * also why every field the grid cannot show lives here rather than being left
 * off. A tile is a picture and a name; this is the rest of the row.
 *
 * `useLatchedOpener`, and the `?peek=` shape is the one that needs it most:
 * closing clears the parameter, so the whole screen re-renders with `item ===
 * null` **before** Radix fires `onCloseAutoFocus`, and an id derived from the
 * record is `undefined` by the time focus restoration reads it. The keyboard
 * path hides that — there the opener also held focus at open, so the recorded
 * fallback is already right — and only a pointer open depends on the name.
 *
 * ## Three fields, and the save is gated on **dirty**
 *
 * Measured against the shop's own suite (`tests/Api/media.php:387-435`) and
 * re-measured against the harness:
 *
 *   {alt, title, caption}   200, and the edit reads back
 *   {}                      **400 `invalid_request`** — `MediaInput::isEmpty()`
 *   caption: null           200, reading back `""`
 *   file / post_type / post_status / post_author / anything unknown   400
 *
 * Two consequences the screen has to carry. A save that changes nothing is a
 * **refusal**, not a no-op, so only the fields that actually moved are sent and
 * the control is disabled while none has — with the reason on it, per §3.3. And
 * an emptied field sends **`null`**, not `""`: `""` is a legal value that the
 * server trims to `""` anyway, but `null` is the documented clear and is what
 * the suite asserts reads back.
 *
 * **`file` is not rendered as a control at all.** Its refusal names the remedy —
 * "The stored file cannot be replaced; upload a new one." — so a disabled field
 * beside the editable three would be a control that cannot act, standing where
 * the one thing a person might come here to do is impossible.
 *
 * Three fields is not a long form, so this uses the drawer's own footer rather
 * than `SaveBar`. §3.4 legislates the sticky bar for a form long enough that its
 * foot is off screen; a drawer's footer is always on screen.
 *
 * ## No client-side length rule
 *
 * `MediaInput::MAX_LENGTH` is 500 and it was **read out of the backend, not
 * measured over the wire**. A counter here would put an unverified number on
 * screen and refuse a value the shop might take; the 400 binds to its own field
 * and says the limit in the API's own words, which is the half that is true.
 */
export function MediaDrawer({
  item,
  locale,
  online,
  onOpenChange,
  onSaved,
}: {
  /** `null` while closed, and while Radix runs the exit animation. */
  item: MediaItem | null;
  locale: string;
  /** False only when the browser is certain — see `useOnline`. */
  online: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: MediaItem) => void;
}) {
  const t = useTranslations("media");
  const tUi = useTranslations("ui");
  const tStates = useTranslations("states");
  const toast = useToast();

  const [seeded, setSeeded] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ alt: "", title: "", caption: "" });
  const [fields, setFields] = useState<Record<string, string>>({});

  /*
   * The record's own values, decoded. WordPress texturizes a title on the way in
   * — "Soldes d'été" is stored with U+2019 and can arrive as its
   * numeric entity — and a
   * field bound to the raw string would show the entity and then save it back.
   *
   * This is also the baseline the dirty check compares against, so decoding has
   * to happen on **both** sides or every record would open dirty.
   */
  const stored: Draft | null =
    item === null
      ? null
      : {
          alt: decodeEntities(item.alt),
          title: decodeEntities(item.title),
          caption: decodeEntities(item.caption),
        };

  /*
   * Seeded during render rather than in an effect — React documents this as the
   * way to reset state from a changing prop, and an effect runs after paint,
   * which is one frame of the previous record's text in this record's fields.
   * `seeded` is cleared on close, so re-opening the same row re-reads it.
   */
  if (item !== null && stored !== null && item.id !== seeded) {
    setSeeded(item.id);
    setDraft(stored);
    setFields({});
  }

  const returnFocusTo = useLatchedOpener(item && mediaOpenerId(item.id));

  const changed = stored === null ? [] : EDITABLE.filter((key) => draft[key] !== stored[key]);
  const dirty = changed.length > 0;

  const save = useMutation({
    mutationFn: async (id: number) => {
      /* Only what moved, and an emptied field as `null`. A body of `{}` is a
         400, which is why `dirty` gates the control that calls this. */
      const body: Record<string, string | null> = {};
      for (const key of changed) body[key] = draft[key] === "" ? null : draft[key];
      return acWrite<MediaItem>("PATCH", `/media/${id}`, body);
    },
    onSuccess: (updated) => {
      toast.show(t("saved"));
      onSaved(updated);
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      /* A 400 lists every bad field at once and each binds to its own control;
         a toast carrying the first message throws the rest away. */
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

  /* The fifth state's second half: when the browser is certain it is offline,
     the row on screen is as old as the last fetch and the write control says so
     rather than failing on click. */
  const blocked = online ? null : tStates("offlineWrites");

  const LABELLED: Record<Editable, { id: string; label: string }> = {
    alt: { id: "media-alt", label: t("field.alt") },
    title: { id: "media-title", label: t("field.title") },
    caption: { id: "media-caption", label: t("field.caption") },
  };

  /* A 400 can name a field this drawer does not render — `file` and the three
     post columns all answer one — and an orphan still has to be readable or
     somebody sees a refusal with no cause anywhere on screen. Those render as
     text rather than as a link, per §3.4: there is nowhere to send them. */
  const failures: FormFailure[] = Object.entries(fields).map(([key, message]) => {
    const known = (LABELLED as Record<string, { id: string; label: string }>)[key];
    return known === undefined ? { message } : { id: known.id, label: known.label, message };
  });

  return (
    <Drawer
      open={item !== null}
      onOpenChange={(next) => {
        if (!next) {
          setSeeded(null);
          setFields({});
        }
        onOpenChange(next);
      }}
      /*
       * The panel's name, not the record's — which is the opposite of every
       * other peek in this run and is decided by what is *inside*. The record's
       * title is an editable control in this body, so putting it in the header
       * would draw a second, stale copy of a field's value directly above the
       * field, and it would sit there disagreeing with what somebody is typing.
       */
      title={t("detailTitle")}
      size="md"
      returnFocusTo={returnFocusTo}
      footer={
        item === null ? null : (
          <>
            {/* Cancel first in DOM order: the first tab stop, and
                `flex-col-reverse` puts the primary on top on a phone. */}
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              {tUi("cancel")}
            </Button>
            <Button
              onClick={() => save.mutate(item.id)}
              loading={save.isPending}
              /*
               * Disabled rather than absent, and it says why. §3.3 removes a
               * control that *cannot act*; this one can, as soon as a character
               * changes, and a Save button that appeared and vanished under the
               * cursor while somebody typed would be worse than one that waits.
               */
              disabled={!dirty || blocked !== null}
              title={blocked ?? (dirty ? undefined : t("noChanges"))}
            >
              {t("save")}
            </Button>
          </>
        )
      }
    >
      {item === null ? null : (
        <div className="flex flex-col gap-4">
          {/*
            The picture, at its own aspect rather than cropped: this is the one
            place somebody looks at the file itself, and `object-cover` here
            would hide exactly what the grid's square tile already hides.

            `alt=""` — decorative. The record's alt text is the labelled control
            two elements below, and announcing it here would read the drawer's
            own subject twice with the string the person is about to edit.
          */}
          <div className="flex items-center justify-center overflow-hidden rounded-ui-lg border border-ui-line bg-ui-surface-2 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.url}
              alt=""
              className="max-h-64 w-auto max-w-full object-contain"
            />
          </div>

          <ErrorSummary failures={failures} />

          <TextField
            id="media-alt"
            label={t("field.alt")}
            value={draft.alt}
            onChange={(alt) => setDraft((current) => ({ ...current, alt }))}
            hint={t("field.altHint")}
            error={fields.alt}
            disabled={save.isPending}
          />

          <TextField
            id="media-title"
            label={t("field.title")}
            value={draft.title}
            onChange={(title) => setDraft((current) => ({ ...current, title }))}
            error={fields.title}
            disabled={save.isPending}
          />

          {/* A caption is a sentence and the API takes 500 characters of one, so
              it is a `TextArea`. Two rows, because most are one line. */}
          <TextArea
            id="media-caption"
            label={t("field.caption")}
            value={draft.caption}
            onChange={(caption) => setDraft((current) => ({ ...current, caption }))}
            rows={2}
            error={fields.caption}
            disabled={save.isPending}
          />

          {/*
            Everything the API will not let this drawer change. A `Section`
            inside an overlay renders its heading at `--text-subheading`, so it
            sits under the drawer's own title rather than beside it — §3.4's
            amendment — and `DataList` rather than `ReadOnlyField` because this
            is a block of label/value pairs below the controls, not a row
            standing in a stack of them.
          */}
          <Section title={t("fileGroup")} footnote={t("filenameNote")}>
            <DataList>
              <DataRow label={t("field.filename")}>
                {/* The **stored** name, never the one that was picked: uploading
                    `real.jpg` three times stored `real.jpg`, `real-1.jpg` and
                    `real-2.jpg`, and the extension comes from the sniffed type.
                    An identifier, so `Ltr`. */}
                <Ltr numeric={false} className="block break-all">
                  {item.filename}
                </Ltr>
              </DataRow>
              <DataRow label={t("field.type")}>
                <Ltr numeric={false}>{item.mime_type}</Ltr>
              </DataRow>
              <DataRow label={t("field.size")}>
                <Isolate>{formatBytes(item.filesize, locale)}</Isolate>
              </DataRow>
              {/* Both or neither: `width` and `height` are null together, for a
                  file WordPress could not measure. */}
              {item.width !== null && item.height !== null ? (
                <DataRow label={t("field.dimensions")}>
                  <Ltr>{t("field.dimensionsValue", { width: item.width, height: item.height })}</Ltr>
                </DataRow>
              ) : null}
              <DataRow label={t("field.uploaded")}>
                {/* `date_created` carries **no UTC offset** — `mysql_to_rfc3339()`
                    emits `Y-m-d\TH:i:s` — so this goes through `parseApiDate`,
                    which appends the `Z` the string means. `new Date()` on it
                    would shift by the host's offset, silently. `Isolate` and
                    never `Ltr`: it is `Intl`-formatted. */}
                <Isolate>{formatWhen(item.date_created, locale)}</Isolate>
              </DataRow>
              <DataRow label={t("field.url")}>
                {/* `break-all` rather than truncate: the point of opening this is
                    to read — or copy — the value the tile had no room for. */}
                <Ltr numeric={false} className="block break-all">
                  {item.url}
                </Ltr>
              </DataRow>
            </DataList>
          </Section>
        </div>
      )}
    </Drawer>
  );
}
