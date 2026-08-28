"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { mediaUsage, type MediaItem, type MediaUsage } from "@/lib/api/schemas/media";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { formatBytes } from "@/lib/media";
import { formatWhen } from "@/lib/format/date";
import { decodeEntities } from "@/lib/format/html";
import { Drawer, useLatchedOpener } from "@/components/ui/Overlay";
import { mediaTileId } from "@/components/ui/MediaGrid";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { Menu, type MenuAction } from "@/components/ui/Menu";
import { Notice } from "@/components/ui/States";
import { DataList, DataRow } from "@/components/ui/Card";
import { Button, IconButton } from "@/components/ui/Button";
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
 * One line naming a thing that holds this attachment.
 *
 * **`kind` and `slot` are open vocabularies and this is where that costs
 * something.** `MediaUsageRepository::KINDS` maps four post types onto a word and
 * falls through to the **raw post type** for anything else, deliberately — the
 * query is not restricted by type, precisely so a fifth kind is reported rather
 * than missed. So a message key is looked up and the API's own token is printed
 * when there is none, which is the `providerLabel` rule in the standing table: a
 * translated word for a shop's own vocabulary, and the other side's own word
 * where this side has none. Printing `product_variation` at a shopkeeper is bad;
 * printing nothing, or dropping the row, is worse.
 *
 * The unknown token is `Ltr`-wrapped for the same reason every identifier in the
 * panel is: it is an English slug and it must not reorder inside Arabic prose.
 */
function UsageLine({
  reference,
  label,
}: {
  reference: MediaUsage["references"][number];
  label: (namespace: "kind" | "slot", token: string) => string | null;
}) {
  const kind = label("kind", reference.kind);
  const slot = label("slot", reference.slot);

  return (
    <li className="flex min-w-0 flex-col">
      {/*
        **`decodeEntities`, and this drawer already knew why.** `title` is
        `$row->post_title` read straight out of the database, exactly as
        `MediaPresenter::toArray()` reads an attachment's — WordPress texturizes
        a title on the way in, so "Soldes d’été" is stored with U+2019 and can
        arrive as its numeric entity. Found in the harness rather than reasoned
        about: the seeded banner's title carries one, and without this the dialog
        names the thing about to break with a raw entity in the middle of it.
      */}
      <span dir="auto" className="truncate text-ui-body text-ui-fg">
        {decodeEntities(reference.title)}
      </span>
      <span className="text-ui-label text-ui-muted">
        {kind ?? <Ltr numeric={false}>{reference.kind}</Ltr>}
        <span aria-hidden="true"> · </span>
        {slot ?? <Ltr numeric={false}>{reference.slot}</Ltr>}
      </span>
    </li>
  );
}

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
 *
 * ## Delete, which this screen shipped without for a fortnight
 *
 * `DELETE /media/{id}` is `wp_delete_attachment($id, true)`: the trash is
 * bypassed, the row goes and the file and every generated size are unlinked from
 * disk. **Nothing is recoverable** — the picture comes back only by finding the
 * original and uploading it again, with a new id that nothing points at.
 *
 * It was refused by the allowlist until 2026-08-28, and the recorded reason was
 * that no route told the panel what an attachment was *used by*, so the library
 * could not answer "what would this break?". `GET /media/{id}/usage` is that
 * route. The two shipped together and neither is useful alone.
 *
 * **In a header `Menu`, not a button in the body.** The coupons shape (§7). The
 * body of this drawer is a form somebody came here to fill in; a destructive
 * control standing in it, one tab stop from Save, is an accident waiting for a
 * mis-aimed pointer. `headerExtra` is the slot `Drawer` already has for it.
 *
 * **The dialog fetches usage when it opens, and that is what the endpoint is
 * for** — one request for one attachment at the moment somebody is about to do
 * something irreversible, rather than a column on every row of the library.
 * `staleTime: 0` and `gcTime: 0` on that query are deliberate: an answer cached
 * from a dialog opened a minute ago is exactly the answer that must not be shown
 * here, and a 15-second-stale "nothing uses this" would be the panel presenting a
 * guess as a fact.
 *
 * **A failed usage read must not read as a safe delete.** The three states are
 * distinct on screen: checking, could-not-check, and an answer. The middle one is
 * a `Notice` carrying the API's own sentence, and the confirm stays live behind
 * it — the API does not refuse a delete for an image in use and neither does
 * this, so blocking here would invent a refusal the shop does not have.
 *
 * **Type the filename.** §3.1 requires an identifier typed for an irreversible
 * act, and coupons set the precedent that a *permanent* delete requires typing
 * the record's identifier. The filename is a real one, it is rendered in this
 * drawer three rows down, and — unlike the content branch's WordPress-texturized
 * titles — it is typeable: `[a-z0-9-]` and a dot, by `UploadPolicy`'s own
 * `storedFilename()`.
 */
export function MediaDrawer({
  item,
  locale,
  online,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  /** `null` while closed, and while Radix runs the exit animation. */
  item: MediaItem | null;
  locale: string;
  /** False only when the browser is certain — see `useOnline`. */
  online: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: MediaItem) => void;
  /**
   * The file is gone, and the id it had.
   *
   * The caller closes this drawer by clearing `?peek=` — which is what makes
   * `item` null — and invalidates the library so the header's count drops. Not
   * `onOpenChange(false)` from here: the URL is the drawer's open state and two
   * writers of it would race. The id is passed because the caller has one cache
   * entry to *drop* rather than refresh; see `onDeleted` there.
   */
  onDeleted: (id: number) => void;
}) {
  const t = useTranslations("media");
  const tUi = useTranslations("ui");
  const tStates = useTranslations("states");
  const toast = useToast();

  const [seeded, setSeeded] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ alt: "", title: "", caption: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  /* Radix unmounts a `Menu` item the moment it is selected, so the opener the
     ConfirmDialog recorded is detached by the time it would be focused. The
     trigger's own id is the answer — `useOpenerFocus` in Overlay.tsx. */
  const menuTriggerId = useId();

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

  /*
   * What holds this attachment, asked once when the dialog opens.
   *
   * `enabled` on `confirming` is the whole point: this is a read the library must
   * not pay for on every row, and `MediaService::usage()` says so in as many
   * words — five queries, on demand, at the moment somebody is about to do
   * something irreversible.
   *
   * `staleTime: 0` and `gcTime: 0` override the client's 15-second default
   * deliberately. Re-opening this dialog must re-ask; an answer kept from the
   * last time it was open is the one answer that must never appear here.
   *
   * Parsed with Zod rather than cast. `checked` and `incomplete` decide the
   * sentence this dialog writes, and a response whose shape moved would otherwise
   * render as an empty list — which reads as *nothing uses this*, the one wrong
   * thing this dialog can say.
   */
  const usage = useQuery({
    /*
     * **Deliberately outside the `media` prefix**, which is the one key in this
     * screen that is. `MediaLibrary` invalidates `["media"]` after every write,
     * and this query is still mounted for the render in which a successful
     * delete clears `?peek=` — so under that prefix the sweep re-asked
     * `GET /media/{id}/usage` for the attachment that had just stopped existing,
     * took a 404 and put it in the console. Driven in Chromium; that is where it
     * was found.
     *
     * It is not a cache of a media *record* either, which is the honest reason
     * rather than the convenient one: it is a read of what the rest of the shop
     * holds, keyed by an attachment id, and with `gcTime: 0` it has no lifecycle
     * to share with the library in the first place.
     */
    queryKey: ["media-usage", item?.id ?? 0],
    enabled: confirming && item !== null,
    queryFn: async () =>
      mediaUsage.parse((await acRead<unknown>(`/media/${item?.id}/usage`)).data),
    staleTime: 0,
    gcTime: 0,
  });

  const remove = useMutation({
    mutationFn: async (id: number) =>
      acWrite<{ id: number; deleted: boolean }>("DELETE", `/media/${id}`),
    onSuccess: (_result, id) => {
      setConfirming(false);
      /* §3.1: a `Toast` confirms something that already happened. */
      toast.show(t("delete.done"));
      onDeleted(id);
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast.show(error instanceof Error ? error.message : t("delete.failed"), "danger");
    },
  });

  /* The fifth state's second half: when the browser is certain it is offline,
     the row on screen is as old as the last fetch and the write control says so
     rather than failing on click. */
  const blocked = online ? null : tStates("offlineWrites");

  /*
   * A message key for an open vocabulary, or `null` for a token this panel has no
   * word for — see `UsageLine`. `t.has()` is the only way to ask next-intl that
   * question without a missing key rendering as its own name on screen.
   */
  const usageLabel = (namespace: "kind" | "slot", token: string) =>
    t.has(`delete.${namespace}.${token}`) ? t(`delete.${namespace}.${token}`) : null;

  const deleteActions: MenuAction[] = [
    {
      key: "delete",
      label: t("delete.action"),
      icon: "trash",
      destructive: true,
      onSelect: () => setConfirming(true),
    },
  ];

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
    <>
      <Drawer
        open={item !== null}
        onOpenChange={(next) => {
          if (!next) {
            setSeeded(null);
            setFields({});
            setConfirming(false);
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
        headerExtra={
          item === null ? null : (
            /*
             * The one destructive act on this record, in the header rather than in
             * the body — the coupons shape (§7). A `Menu` with a single item and
             * not a bare icon button, because §8's rule is that a record's actions
             * are one menu: an icon that deletes on one click is a different
             * control from one that opens a menu, and the menu is where a reader
             * of this panel has learnt to look.
             *
             * **Offline the trigger is disabled and carries the reason**, which is
             * the same treatment Save gets four lines below and the same
             * `ParcelDrawer` gives its status menu. Disabling the item instead
             * would open a menu onto one dead row with nothing saying why.
             */
            <Menu
              label={t("delete.menuLabel")}
              actions={deleteActions}
              trigger={
                <IconButton
                  id={menuTriggerId}
                  label={t("delete.menuLabel")}
                  icon="more"
                  size="sm"
                  disabled={blocked !== null}
                  {...(blocked === null ? {} : { title: blocked })}
                />
              }
            />
          )
        }
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

      {/*
        The delete confirmation. A sibling of the `Drawer` rather than a child of
        it — `ParcelDrawer`'s shape, and the reason is that this is a `Modal` and
        §3.1 forbids nesting one inside another overlay's content.

        `requireTyped` is the filename: §3.1's identifier rule, and coupons'
        precedent that the *permanent* half of a delete is what asks for typing.
      */}
      <ConfirmDialog
        open={confirming && item !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(false);
        }}
        title={t("delete.title")}
        confirmLabel={t("delete.action")}
        loading={remove.isPending}
        returnFocusTo={menuTriggerId}
        requireTyped={
          item === null
            ? undefined
            : { value: item.filename, label: t("delete.typeFilename", { filename: item.filename }) }
        }
        onConfirm={() => {
          if (item !== null) remove.mutate(item.id);
        }}
        body={
          <div className="flex flex-col gap-3">
            {/* What the act is, first and unconditionally. It is true before the
                usage read answers, it is true if the read fails, and it is the
                sentence that does not change. */}
            <p>{t("delete.permanent")}</p>

            {usage.isPending ? (
              <p className="text-ui-label">{t("delete.checking")}</p>
            ) : usage.isError ? (
              /*
               * **A failed usage read must never present the delete as safe.**
               * The one thing this dialog cannot do is fall through to silence
               * here: silence looks exactly like "nothing uses it". `role="alert"`
               * because it arrives after the dialog is already open and read.
               */
              <Notice tone="warning" role="alert" title={t("delete.checkFailedTitle")}>
                <p className="text-ui-label">{t("delete.checkFailed")}</p>
                {/* The API's own sentence as evidence, `dir="ltr"` and under a
                    localised line rather than standing in for one. */}
                <Ltr numeric={false} className="block text-ui-label">
                  {(usage.error as Error).message}
                </Ltr>
              </Notice>
            ) : usage.data === undefined ? null : usage.data.total === 0 ? (
              /*
               * **Zero is "nothing known", never "safe".** `total` counts only
               * what `checked` covers, and `incomplete` names two documents no
               * query can search — so the wording says *known* and the caveat
               * below says which places were out of reach. A sentence promising
               * the picture is unused would be the endpoint's own qualification
               * thrown away at the last step.
               */
              <p className="text-ui-label">{t("delete.noKnownUses")}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-ui-label">
                  {t("delete.knownUses", { count: usage.data.total })}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {usage.data.references.map((reference) => (
                    <UsageLine
                      key={`${reference.slot}-${reference.kind}-${reference.id}`}
                      reference={reference}
                      label={usageLabel}
                    />
                  ))}
                </ul>
              </div>
            )}

            {/*
              **`incomplete` in one sentence, and it is load-bearing copy.**
              `ContentHtml::ALLOWED` permits `<img>`, so a picture dropped into a
              page body is a URL and not an id, and a homepage section's `data` has
              no schema per type — neither can be searched from any query. The
              endpoint names both in `incomplete` precisely so the panel can say
              this, and §8's restraint applies to words: one line, no slugs, no
              paragraph.

              Shown beside every result state including the failure, because it is
              a property of the shop rather than of this answer.
            */}
            <p className="text-ui-label text-ui-subtle">{t("delete.unsearchable")}</p>
          </div>
        }
      />
    </>
  );
}
