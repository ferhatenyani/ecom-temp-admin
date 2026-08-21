"use client";

import { useRef, useState } from "react";
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
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { SelectField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { StatusBadge, Dot } from "@/components/primitives/StatusBadge";
import { ActionSheet } from "@/components/primitives/ActionSheet";
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
 * relying on it.** The preview is a screen with counts and a row-by-row table;
 * applying is a separate, confirmed action that names the counts the preview
 * reported. The applied response echoes `dry_run`, and the confirmation quotes
 * the server rather than what the panel asked for — a "written" message over a
 * response saying `dry_run: true` would be the panel lying about a write that
 * never happened.
 */
export function ImportSection({ subject }: { subject: ImportSubject }) {
  const t = useTranslations("transfer");
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mode, setMode] = useState<ImportMode>(DEFAULT_MODE);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [columns, setColumns] = useState<{ found: string[]; required: string[] } | null>(null);
  const [confirming, setConfirming] = useState(false);

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

  return (
    <ListGroup title={t(`subject.${subject}`)} footnote={t(`importNote.${subject}`)}>
      <ListRow className="flex flex-col items-stretch gap-2">
        {/*
          A file input, and the CSV is read here and sent as the **raw request
          body** with `Content-Type: text/csv`. Not multipart, which is what
          `/media` takes and what an `<input type="file">` makes it tempting to
          send — the API refuses it by name: "Content-Type must be text/csv, and
          the body the file itself — not JSON."
        */}
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          onChange={async (event) => {
            const chosen = event.target.files?.[0];
            if (chosen === undefined) return;
            setReport(null);
            setFailure(null);
            setColumns(null);
            setFile({ name: chosen.name, text: await chosen.text() });
          }}
          aria-label={t("chooseFile")}
          /*
            Visually hidden and driven by the button below, which is the one
            place this panel hides a native control rather than using it.
            `<select>` and `<input type="date">` are kept native on purpose —
            the platform picker is better than anything drawn here and its
            chrome follows the *browser's* locale — but a file input renders
            **"Choose File" and "No file chosen" as page content**, at the
            browser's language rather than the panel's, left-aligned in an RTL
            row and with no 44px target. Caught by eye at 390px; the label and
            the filename below say the same things in the reader's language.

            `sr-only` rather than `display: none`, so the input stays in the
            accessibility tree and the `<label>` on the button still reaches it.
          */
          className="sr-only"
        />

        <Button variant="tinted" onClick={() => input.current?.click()} fullWidth>
          {t("chooseFile")}
        </Button>

        {file !== null ? (
          <p className="text-caption text-label-secondary">
            <Ltr numeric={false} className="min-w-0 break-all">
              {file.name}
            </Ltr>
          </p>
        ) : (
          <p className="text-caption text-label-tertiary">{t("noFile")}</p>
        )}
      </ListRow>

      {/*
        `mode` is products-only. The inventory import never creates — "Not found.
        An inventory import never creates products." — so offering the control
        there would be offering a choice the route does not have.
      */}
      {hasMode(subject) ? (
        <SelectField
          label={t("modeLabel")}
          value={mode}
          onChange={setMode}
          options={IMPORT_MODES.map((value) => ({ value, label: t(`mode.${value}`) }))}
          hint={t(`modeHint.${mode}`)}
        />
      ) : null}

      <ListRow>
        <Button
          variant="tinted"
          onClick={() => void run(true)}
          loading={busy && report === null}
          disabled={file === null}
          fullWidth
        >
          {t("preview")}
        </Button>
      </ListRow>

      {failure !== null ? (
        <ListRow className="tone-danger tonal flex flex-col items-start gap-2">
          <span className="text-footnote">{failure}</span>
          {columns !== null ? (
            <div className="flex flex-col gap-1 text-caption">
              <span>
                <Isolate numeric={false}>
                  {t("columnsRequired", { columns: columns.required.join(", ") })}
                </Isolate>
              </span>
              <span className="min-w-0 break-words">
                <Isolate numeric={false}>
                  {t("columnsFound", { columns: columns.found.slice(0, 8).join(", ") })}
                </Isolate>
              </span>
            </div>
          ) : null}
        </ListRow>
      ) : null}

      {report !== null ? (
        <>
          <ListRow className="flex flex-col items-start gap-2">
            <span className="flex items-center gap-2">
              <StatusBadge tone={report.dry_run ? "info" : "success"}>
                {report.dry_run ? t("wasPreview") : t("wasApplied")}
              </StatusBadge>
              <Isolate numeric className="text-footnote text-label-secondary">
                {t("rows", { count: report.rows })}
              </Isolate>
            </span>

            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote">
              <span className="flex items-center gap-1">
                <Dot tone="success" />
                <Isolate numeric>{t("created", { count: report.created })}</Isolate>
              </span>
              <span className="flex items-center gap-1">
                <Dot tone="info" />
                <Isolate numeric>{t("updated", { count: report.updated })}</Isolate>
              </span>
              <span className="flex items-center gap-1">
                <Dot tone="neutral" />
                <Isolate numeric>{t("skipped", { count: report.skipped })}</Isolate>
              </span>
              <span className="flex items-center gap-1">
                <Dot tone="danger" />
                <Isolate numeric>{t("failed", { count: report.failed })}</Isolate>
              </span>
            </span>

            {/*
              A request that succeeded and would do nothing. `created: 0,
              updated: 0` with every row skipped is a 200 and a useless import,
              and the two look identical if the screen only reports the status.
            */}
            {reportIsNoOp(report) ? (
              <span className="tone-warning tonal rounded-md px-2 py-1 text-caption">
                {t("noOp")}
              </span>
            ) : null}

            {/*
              **`preview_only` is English prose from the API and is never
              rendered.** Its *presence* is the signal — a products dry run has
              it and an inventory one does not, because our own importer really
              does rehearse — so the panel says its own sentence and drops the
              string. That is the analytics branch's rule: the API's English must
              not reach an Arabic screen.
            */}
            {report.dry_run ? (
              <span className="text-caption text-label-tertiary">
                {rehearsal ? t("previewRehearsal") : t("previewNotRehearsal")}
              </span>
            ) : null}
          </ListRow>

          {report.errors.length > 0 ? (
            <ListRow className="flex flex-col items-start gap-2">
              <span className="text-footnote font-medium tonal-fg tone-danger">
                {t("rowErrors")}
              </span>
              <ul className="flex w-full flex-col gap-1 text-caption text-label-secondary">
                {report.errors.slice(0, 20).map((rowError, index) => (
                  <li key={index} className="flex min-w-0 flex-wrap items-baseline gap-1">
                    <Isolate numeric className="shrink-0">
                      {t("line", { line: rowError.line })}
                    </Isolate>
                    {errorFields(rowError).length > 0 ? (
                      errorFields(rowError).map(([field, message]) => (
                        <span key={field} className="min-w-0">
                          <Ltr numeric={false}>{field}</Ltr>
                          {": "}
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
            </ListRow>
          ) : null}

          {report.preview.length > 0 ? (
            <ListRow className="flex flex-col items-start gap-2">
              <span className="text-footnote font-medium">{t("previewRows")}</span>
              <ul className="flex w-full flex-col gap-1 text-caption text-label-secondary">
                {/*
                  Keyed by index, never by line: WooCommerce's importer reports
                  `line: 2` for every row of an applied products run, measured on
                  a two-row file.
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
                      <span className="min-w-0 truncate text-label-tertiary" dir="auto">
                        {row.reason}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {report.preview.length > 20 ? (
                <span className="text-caption text-label-tertiary">
                  <Isolate numeric>
                    {t("previewTruncated", { shown: 20, total: report.preview.length })}
                  </Isolate>
                </span>
              ) : null}
            </ListRow>
          ) : null}

          {report.dry_run ? (
            <ListRow>
              <Button
                variant="filled"
                onClick={() => setConfirming(true)}
                loading={busy}
                disabled={reportIsNoOp(report)}
                fullWidth
              >
                {t("apply")}
              </Button>
            </ListRow>
          ) : null}
        </>
      ) : null}

      <ActionSheet
        open={confirming}
        onOpenChange={setConfirming}
        title={t("applyTitle")}
        description={
          report === null
            ? undefined
            : t("applyBody", {
                created: report.created,
                updated: report.updated,
                skipped: report.skipped,
              })
        }
        actions={[
          {
            label: t("apply"),
            tone: "destructive" as const,
            onSelect: () => void run(false),
          },
        ]}
      />

      {/* Nothing else on this branch clears an input by hand; a file input's
          value cannot be set from React, so re-picking the same file after an
          apply needs this. */}
      {report !== null && !report.dry_run ? (
        <ListRow>
          <Button
            variant="plain"
            onClick={() => {
              setFile(null);
              setReport(null);
              if (input.current !== null) input.current.value = "";
            }}
            fullWidth
          >
            {t("startOver")}
          </Button>
        </ListRow>
      ) : null}
    </ListGroup>
  );
}
