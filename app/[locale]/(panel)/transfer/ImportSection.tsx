"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ImportReport } from "@/lib/api/schemas/transfer";
import { BrowserApiError, acWriteRaw } from "@/lib/api/browser";
import {
  DEFAULT_MODE,
  IMPORT_CONTENT_TYPE,
  IMPORT_MODES,
  ROW_TONE,
  errorFields,
  hasMode,
  missingColumns,
  previewIsNotARehearsal,
  reportIsNoOp,
  type ImportMode,
  type ImportSubject,
} from "@/lib/transfer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FileField, Select } from "@/components/ui/Form";
import { Badge, Dot } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { Notice } from "@/components/ui/States";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * One subject's import: pick a file, read the preview, then apply it.
 *
 * Module scope with explicit props, not nested in `TransferScreen` — it holds
 * the file, the report and the mode, and a component declared inside another
 * gets a new identity on every parent render and loses all three. That is the
 * 14b defect and this is the screen where it would hurt most: the state a
 * remount would discard is a *preview somebody is deciding from*.
 *
 * **`dry_run` defaults to true and the panel makes that visible rather than
 * relying on it.** The preview is a screen with counts and a row-by-row list;
 * applying is a separate, confirmed action that names the counts the preview
 * reported. The applied response echoes `dry_run`, and the confirmation quotes
 * the server rather than what the panel asked for — a "written" message over a
 * response saying `dry_run: true` would be the panel lying about a write that
 * never happened.
 *
 * ## The report is cast, not parsed, and that is a decision
 *
 * `acWriteRaw<ImportReport>` is a `as`, and **every** write in
 * `lib/api/browser.ts` is: making this the one runtime-validated write would be
 * inconsistent with twenty other call sites for a shape nothing branches on
 * dangerously. Every optional field below is guarded at the point it renders, so
 * a drift degrades to a sparser row rather than to a crash. Recorded rather than
 * fixed.
 */
export function ImportSection({
  subject,
  online,
}: {
  subject: ImportSubject;
  /** Lifted from `TransferScreen` so both halves of the page agree. */
  online: boolean;
}) {
  const t = useTranslations("transfer");
  const tStates = useTranslations("states");
  const toast = useToast();

  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mode, setMode] = useState<ImportMode>(DEFAULT_MODE);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [columns, setColumns] = useState<{ found: string[]; required: string[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  /* A file input has no settable value, so `FileField` is remounted to clear it
     — one line at the call site, and no ref crossing the primitive's boundary. */
  const [inputKey, setInputKey] = useState(0);

  /* Named rather than generated, so the confirm dialog can hand focus back to
     whichever of the two is on screen when it closes. See the dialog below. */
  const applyId = `apply-${subject}`;
  const startOverId = `start-over-${subject}`;

  async function run(dryRun: boolean) {
    if (file === null) return;

    setBusy(true);
    setFailure(null);
    setColumns(null);

    const params = new URLSearchParams();
    if (hasMode(subject)) params.set("mode", mode);
    /*
     * `dry_run=false` is sent explicitly and only for the apply. The default is
     * true, so a request that lost the parameter previews — which is the safety
     * property, and the reason nothing here ever *omits* the flag to mean
     * "write".
     */
    if (!dryRun) params.set("dry_run", "false");

    try {
      const { data } = await acWriteRaw<ImportReport>(
        `/import/${subject}?${params}`,
        file.text,
        IMPORT_CONTENT_TYPE,
      );
      setReport(data);
      if (!data.dry_run) toast.show(t("applied"));
    } catch (error) {
      setReport(null);
      if (error instanceof BrowserApiError) {
        setFailure(error.message);
        /*
         * `columns_found` sits **beside** `fields` rather than inside it, so a
         * form binding only to `fields` throws away the one thing that turns
         * this refusal into an answer: it lists what the reader saw on line 1.
         * Somebody who uploaded a headerless export sees their own product name
         * where a column name should be.
         */
        setColumns(missingColumns(error.details));
      } else {
        setFailure((error as Error).message);
      }
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const rehearsal = report !== null && report.dry_run && !previewIsNotARehearsal(report);
  const offlineReason = online ? undefined : tStates("offlineWrites");

  /*
   * §3.3: a disabled control that does not say why is a dead end. Both of these
   * are "waiting on input", which §17 established is a legitimate disable rather
   * than a removal — the control acts the moment the input arrives — so they stay
   * disabled and carry the reason instead of disappearing.
   */
  const previewBlocked = offlineReason ?? (file === null ? t("chooseFileFirst") : undefined);
  const applyBlocked =
    offlineReason ?? (report !== null && reportIsNoOp(report) ? t("noOp") : undefined);

  return (
    /* The wrapper carries the handle: `Card` is a `<section>` with fixed props,
       and the e2e needs to scope its file input and its Preview button to *this*
       subject rather than reaching for `.last()`. */
    <div data-testid={`import-${subject}`}>
      <Card
        title={t(`subject.${subject}`)}
        /* The safety property, on the card whose button is the thing it is about. */
        footnote={t("importSafety")}
      >
        <div className="flex flex-col gap-4">
          {/*
            A real `<input type="file">` through `FileField`, which is where the
            panel's other upload already is (`media/UploadModal.tsx`).

            **The retired screen hid this behind a button and gave three measured
            reasons; two of them are gone and one is not.** It said the UA
            renders "Choose File"/"No file chosen" (a) in the *browser's*
            language, (b) left-aligned in an RTL row, and (c) with no 44px
            target. Re-measured in Chromium at 340 in Arabic against
            `FileField`: the control is inside `FieldFrame`'s labelled column, so
            (b) is false — Chromium lays the UA button out at the inline start
            and the filename beside it, correctly mirrored — and `.ui-field`
            gives it the coarse-pointer height, so (c) is false too. What
            survives is (a), and it is not a thing a **caller** may fix: hiding
            the input to replace its chrome costs the control's own keyboard
            behaviour on two engines. So `FileField` ships unextended, the
            field's own label and hint say the same things in the reader's
            language, and the UA prints the chosen filename itself — which is why
            nothing here re-renders it.

            **This paragraph used to end "which is why the panel keeps `<select>`
            and `<input type="date">` native as well", and both of those are now
            drawn** — `components/ui/Listbox.tsx` and `components/ui/DatePicker.tsx`.
            Neither reversal reaches this control and the sentence is corrected
            rather than deleted, because the *reason* it gave is still the right
            test and it is what keeps a file input native: those two controls
            render the **value** in a format the user agent chooses and will not
            hand over, and a file input renders a button and a filename around a
            value the OS dialog owns. `FileField` draws over exactly that chrome
            while keeping the real `<input type="file">` focusable, so it already
            has the panel's language *and* the platform's picker. There is
            nothing left for a redraw to buy here.

            The CSV is read here and sent as the **raw request body** with
            `Content-Type: text/csv`. Not multipart, which is what `/media` takes
            and what a file input makes it tempting to send — the API refuses it
            by name: "Content-Type must be text/csv, and the body the file itself
            — not JSON."

            The hint is this subject's precondition, on the control that has to
            satisfy it. It used to be a grey paragraph under the whole card.
          */}
          <FileField
            key={inputKey}
            id={`import-file-${subject}`}
            label={t("chooseFile")}
            accept=".csv,text/csv"
            hint={t(`importNote.${subject}`)}
            disabled={busy}
            onChange={async (chosen) => {
              setReport(null);
              setFailure(null);
              setColumns(null);
              if (chosen === null) {
                setFile(null);
                return;
              }
              setFile({ name: chosen.name, text: await chosen.text() });
            }}
          />

          {/*
            `mode` is products-only. The inventory import never creates — "Not
            found. An inventory import never creates products." — so offering the
            control there would be offering a choice the route does not have.
          */}
          {hasMode(subject) ? (
            <Select
              id={`import-mode-${subject}`}
              label={t("modeLabel")}
              value={mode}
              onChange={setMode}
              options={IMPORT_MODES.map((value) => ({ value, label: t(`mode.${value}`) }))}
              hint={t(`modeHint.${mode}`)}
              disabled={busy}
            />
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void run(true)}
              loading={busy && report === null}
              disabled={file === null || !online}
              title={previewBlocked}
            >
              {t("preview")}
            </Button>
          </div>

          {failure !== null ? (
            /*
              A file-level refusal, which is not a row error and does not belong
              in the same list. The panel's own title leads and the API's sentence
              follows it, so an Arabic screen is not headed by English prose.

              **`columns_required` and `columns_found` are the half that turns the
              refusal into an answer** (`lib/transfer.ts:294-321`): they sit
              *beside* `fields`, so a form binding only to `fields` drops them,
              and `columns_found` is what lets somebody who exported a headerless
              file see their own product name where a column name should be.

              **There is no retry control here on purpose.** §3.7-4 asks for one;
              the Preview button above is it — still on screen, still enabled, and
              still holding the file that was refused. A second button labelled
              "réessayer" would send the identical request from a different place.
            */
            <Notice tone="danger" role="alert" title={t("refused")}>
              <p className="text-ui-label" dir="auto">
                {failure}
              </p>
              {columns !== null ? (
                <div className="flex flex-col gap-1 text-ui-caption">
                  <Isolate numeric={false}>
                    {t("columnsRequired", { columns: columns.required.join(", ") })}
                  </Isolate>
                  <Isolate numeric={false} className="min-w-0 break-words">
                    {t("columnsFound", { columns: columns.found.slice(0, 8).join(", ") })}
                  </Isolate>
                </div>
              ) : null}
            </Notice>
          ) : null}

          {report !== null ? (
            <div className="flex flex-col gap-3 rounded-ui-md bg-ui-surface-2 px-3 py-3">
              {/*
                **An inline row, not five `Stat` tiles.** Five display-sized
                figures for a preview of a two-row file is heavier than the fact
                they carry; the tones and the tabular numerics are what make them
                readable, and a word sits beside every colour per §3.5.
              */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={report.dry_run ? "info" : "success"}>
                  {report.dry_run ? t("wasPreview") : t("wasApplied")}
                </Badge>
                <Isolate numeric className="text-ui-label text-ui-muted">
                  {t("rows", { count: report.rows })}
                </Isolate>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui-label text-ui-fg">
                <span className="flex items-center gap-1.5">
                  <Dot tone="success" />
                  <Isolate numeric>{t("created", { count: report.created })}</Isolate>
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot tone="info" />
                  <Isolate numeric>{t("updated", { count: report.updated })}</Isolate>
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot tone="neutral" />
                  <Isolate numeric>{t("skipped", { count: report.skipped })}</Isolate>
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot tone="danger" />
                  <Isolate numeric>{t("failed", { count: report.failed })}</Isolate>
                </span>
              </div>

              {/*
                A request that succeeded and would do nothing. `created: 0,
                updated: 0` with every row skipped is a 200 and a useless import,
                and the two look identical if the screen only reports the status.
                It is the one of the five figures that changes a decision — it
                disables Apply — so it keeps a `Notice`'s prominence rather than
                joining the row above.
              */}
              {reportIsNoOp(report) ? <Notice tone="warning" title={t("noOp")} /> : null}

              {/*
                **`preview_only` is English prose from the API and is never
                rendered.** Its *presence* is the signal — a products dry run has
                it and an inventory one does not, because our own importer really
                does rehearse — so the panel says its own sentence and drops the
                string. That is the analytics branch's rule: the API's English must
                not reach an Arabic screen.
              */}
              {report.dry_run ? (
                <p className="text-ui-caption text-ui-subtle">
                  {rehearsal ? t("previewRehearsal") : t("previewNotRehearsal")}
                </p>
              ) : null}

              {report.errors.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-ui-label font-medium text-ui-danger-fg">{t("rowErrors")}</p>
                  <ul className="flex w-full flex-col gap-1 text-ui-caption text-ui-muted">
                    {report.errors.slice(0, 20).map((rowError, index) => (
                      <li key={index} className="flex min-w-0 flex-wrap items-baseline gap-1">
                        <Isolate numeric className="shrink-0">
                          {t("line", { line: rowError.line })}
                        </Isolate>
                        {errorFields(rowError).length > 0 ? (
                          errorFields(rowError).map(([field, message]) => (
                            <span key={field} className="min-w-0">
                              {/* The colon travels **inside** the isolate with the
                                  field name. Left outside it is a neutral
                                  character between two isolated runs, and in the
                                  Arabic panel the bidi algorithm resolves it to
                                  the paragraph direction — measured at 340 in
                                  Arabic, `sku: Not found…` rendered as
                                  `Not found… :sku`, a punctuation mark on the
                                  wrong side of the word it belongs to. */}
                              <Ltr numeric={false}>{`${field}:`}</Ltr>{" "}
                              <span dir="auto">{message}</span>
                            </span>
                          ))
                        ) : (
                          <span className="min-w-0" dir="auto">
                            {rowError.message}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {report.preview.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-ui-label font-medium text-ui-fg">{t("previewRows")}</p>
                  <ul className="flex w-full flex-col gap-1 text-ui-caption text-ui-muted">
                    {/*
                      Keyed by index, never by line: WooCommerce's importer reports
                      `line: 2` for every row of an applied products run, measured
                      on a two-row file. Every field but `line` and `action` is
                      optional across the four measured row shapes, so the row
                      renders what it has.
                    */}
                    {report.preview.slice(0, 20).map((row, index) => (
                      <li key={index} className="flex min-w-0 flex-wrap items-baseline gap-2">
                        <Dot tone={ROW_TONE[row.action] ?? "neutral"} />
                        <Isolate numeric className="shrink-0">
                          {t("line", { line: row.line })}
                        </Isolate>
                        <span className="shrink-0">
                          {t.has(`action.${row.action}`) ? t(`action.${row.action}`) : row.action}
                        </span>
                        {row.sku !== undefined && row.sku !== "" ? (
                          <Ltr numeric={false} className="min-w-0 truncate">
                            {row.sku}
                          </Ltr>
                        ) : null}
                        {row.name !== undefined && row.name !== "" ? (
                          <span className="min-w-0 truncate" dir="auto">
                            {row.name}
                          </span>
                        ) : null}
                        {row.from !== undefined || row.to !== undefined ? (
                          <Ltr numeric className="shrink-0">
                            {row.from ?? "—"} → {row.to ?? "—"}
                          </Ltr>
                        ) : null}
                        {row.reason !== undefined ? (
                          <span className="min-w-0 truncate text-ui-subtle" dir="auto">
                            {row.reason}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {report.preview.length > 20 ? (
                    <Isolate numeric className="text-ui-caption text-ui-subtle">
                      {t("previewTruncated", { shown: 20, total: report.preview.length })}
                    </Isolate>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {report !== null && report.dry_run ? (
            <div className="flex flex-wrap gap-2">
              <Button
                id={applyId}
                onClick={() => setConfirming(true)}
                loading={busy}
                disabled={reportIsNoOp(report) || !online}
                title={applyBlocked}
              >
                {t("apply")}
              </Button>
            </div>
          ) : null}

          {/* A file input's value cannot be set from React, so re-picking the
              same file after an apply needs the field remounted. */}
          {report !== null && !report.dry_run ? (
            <div className="flex flex-wrap gap-2">
              <Button
                id={startOverId}
                variant="ghost"
                onClick={() => {
                  setFile(null);
                  setReport(null);
                  setInputKey((key) => key + 1);
                }}
              >
                {t("startOver")}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {/*
        §8 forbids `ActionSheet` by name, and this is the overlay that replaces
        it. Tone `danger`, because the act writes to the shop and cannot be undone
        from here.

        **No type-to-confirm**, per §3.1 as amended on the shipping branch: the
        guard only works where there is an identifier a person would recognise
        *and would type*, and this act has none — the file has a name but nobody
        knows it by heart, and the subject is a word already on the button. The
        guard that actually works here is the preview they have just read, so the
        body quotes it: the subject, the file, and the three counts the server
        reported. Cancel takes focus, which the primitive does.

        `returnFocusTo` is computed rather than fixed because the opener is not
        always still there: a confirmed apply flips `dry_run` to false, which
        unmounts the Apply button before `onCloseAutoFocus` runs — and
        `useOpenerFocus` will not focus a detached node, so focus would land on
        `<body>`. At that moment "Recommencer" is what is on screen, and on a
        cancel Apply still is.
      */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("applyTitle")}
        body={
          report === null || file === null ? null : (
            <div className="flex flex-col gap-2">
              <p>
                {t("applyBody", {
                  subject: t(`subject.${subject}`),
                  created: report.created,
                  updated: report.updated,
                  skipped: report.skipped,
                })}
              </p>
              <p className="flex min-w-0 flex-wrap items-baseline gap-1">
                <span>{t("applyFile")}</span>
                <Ltr numeric={false} className="min-w-0 break-all">
                  {file.name}
                </Ltr>
              </p>
            </div>
          )
        }
        confirmLabel={t("applyConfirm")}
        onConfirm={() => void run(false)}
        loading={busy}
        returnFocusTo={report !== null && !report.dry_run ? startOverId : applyId}
      />
    </div>
  );
}
