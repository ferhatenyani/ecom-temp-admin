"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { HomepageSection } from "@/lib/api/schemas/cms";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import {
  MAX_SECTIONS,
  SECTION_TYPES,
  classifyProblem,
  isSectionType,
  type SectionType,
} from "@/lib/cms";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState } from "@/components/patterns/States";
import { MoveControls, moveItem } from "@/components/patterns/MoveControls";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { SelectField, TextAreaField } from "@/components/primitives/Field";
import { ActionSheet } from "@/components/primitives/ActionSheet";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { useToast } from "@/components/primitives/Toast";

/**
 * The homepage, edited whole.
 *
 * `PUT` replaces the document. There is no section-level route and §89 argues
 * why: sections are ordered, and an API letting two clients insert at index 2
 * concurrently has invented a merge problem the shop does not have.
 *
 * ## The drop report is the interesting half
 *
 * `GET /cms/homepage` **drops** a malformed section and reports it in
 * `meta.problems`; `PUT` **refuses** one with a 400 naming its index. §89 states
 * that asymmetry deliberately — an option edited by hand must degrade, a form
 * filled in by a person must not lose their work quietly — and it has a
 * consequence this screen has to handle and nothing else in the panel does:
 *
 * **Saving repairs the document by throwing away what was dropped.** The editor
 * only ever sees the sections that survived the read, so PUTting them back
 * silently deletes the malformed ones for good. That is usually what an operator
 * wants and it is never what they should discover afterwards, so the save is
 * gated behind a confirmation that names the count.
 *
 * The report itself is **English prose with a number in it** — "Section 4 has an
 * unknown type \"carousel\"." — not an object keyed by anything, so there is
 * nothing to hang a translation on. Rendering it raw is what put an English
 * paragraph across the middle of an Arabic sheet on the analytics branch. So the
 * panel states the *shape* of each problem in the reader's language and carries
 * the API's sentence beside it as detail, which is what `ErrorState` already
 * does for a 409.
 *
 * The position in that sentence is **1-based over the stored document**, not
 * over the sections that survived, so "Section 4" is not the fourth row on
 * screen. The seed interleaves its malformed sections rather than appending
 * them precisely so that an off-by-one here would be visible.
 */

type Row = {
  /** Stable across reorders, so React does not remount a textarea being typed in. */
  key: string;
  type: string;
  /** The section's `data`, held as text because the API has no schema for it. */
  json: string;
};

let counter = 0;
const nextKey = () => `section-${(counter += 1)}`;

function rowsOf(sections: HomepageSection[]): Row[] {
  return sections.map((section) => ({
    key: nextKey(),
    type: section.type,
    json: JSON.stringify(section.data, null, 2),
  }));
}

export function HomepageEditor({
  locale,
  initialSections,
  initialProblems,
}: {
  locale: string;
  initialSections: HomepageSection[];
  initialProblems: string[];
}) {
  const t = useTranslations("content");
  const toast = useToast();

  const [rows, setRows] = useState<Row[]>(() => rowsOf(initialSections));
  const [baseline, setBaseline] = useState<Row[]>(() => rowsOf(initialSections));
  const [problems, setProblems] = useState(initialProblems);
  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  /** Positional errors, keyed by index. `sections[2].type` binds to row 2. */
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  /** The non-positional one: the 50-section cap lands on `sections`, not `sections[50]`. */
  const [listError, setListError] = useState<string | null>(null);

  const dirty =
    JSON.stringify(rows.map(({ type, json }) => ({ type, json }))) !==
    JSON.stringify(baseline.map(({ type, json }) => ({ type, json })));

  /** A row whose `data` is not parseable cannot be sent, and says so on itself. */
  const parseError = (row: Row): string | null => {
    if (row.json.trim() === "") return null;
    try {
      const parsed: unknown = JSON.parse(row.json);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return t("homepage.dataNotObject");
      }
      return null;
    } catch {
      return t("homepage.dataNotJson");
    }
  };

  const malformed = rows.some((row) => parseError(row) !== null);

  async function save() {
    setSaving(true);
    setRowErrors({});
    setListError(null);

    try {
      const payload = {
        sections: rows.map((row) => ({
          type: row.type,
          data: row.json.trim() === "" ? {} : (JSON.parse(row.json) as Record<string, unknown>),
        })),
      };

      const updated = await acWrite<{ sections: HomepageSection[] }>(
        "PUT",
        "/cms/homepage",
        payload,
      );

      /*
       * Re-seed from the response, not from the draft. The write is sanitised —
       * `ContentHtml::looksLikeMarkup()` routes a string leaf through `wp_kses`
       * only when it will parse as a tag — so what comes back can differ from
       * what went out, and an editor showing the unstored version is one where
       * the stripped markup returns on the next save.
       */
      const fresh = rowsOf(updated.sections);
      setRows(fresh);
      setBaseline(fresh);
      // The write refused what the read would have dropped, so after a
      // successful PUT there is nothing left to report.
      setProblems([]);
      toast.show(t("homepage.saved"));
    } catch (error) {
      if (error instanceof BrowserApiError) {
        /*
         * **One endpoint, two error shapes**, and only one of them is
         * positional. A bad section is `sections[2].type`; more than fifty
         * sections is a flat `sections`. A form that bound every homepage error
         * to a row index would drop the cap error on the floor.
         */
        const next: Record<number, string> = {};
        let list: string | null = null;

        for (const [field, message] of Object.entries(error.fields ?? {})) {
          const at = field.match(/^sections\[(\d+)\]/);
          if (at) next[Number.parseInt(at[1], 10)] = message;
          else if (field === "sections") list = message;
        }

        setRowErrors(next);
        setListError(list);
        toast.show(error.message, "danger");
      } else {
        throw error;
      }
    } finally {
      setSaving(false);
      setConfirmSave(false);
    }
  }

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );

  const add = (type: SectionType) => {
    setRows((current) => [...current, { key: nextKey(), type, json: "{}" }]);
    setAddOpen(false);
  };

  return (
    <Scaffold
      title={t("section.homepage")}
      back={{ href: `/${locale}/content`, label: t("title") }}
      trailing={
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          disabled={rows.length >= MAX_SECTIONS}
          aria-label={t("homepage.add")}
          className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent disabled:opacity-40"
        >
          <Icon name="plus" className="size-5" />
        </button>
      }
    >
      <div className="mx-auto max-w-3xl px-4">
        {/*
          The drop report. Above everything, because it describes the document
          the editor is about to overwrite.
        */}
        {problems.length > 0 ? (
          <ListGroup
            title={t("homepage.problemsTitle")}
            footnote={t("homepage.problemsNote")}
          >
            {problems.map((sentence, index) => {
              const problem = classifyProblem(sentence);
              return (
                <ListRow key={index} className="tone-warning tonal items-start">
                  <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-footnote">
                      <Isolate numeric>
                        {problem.position === null
                          ? t(`homepage.problem.${problem.kind}`)
                          : t(`homepage.problemAt.${problem.kind}`, {
                              position: problem.position,
                            })}
                      </Isolate>
                    </span>
                    {/*
                      The API's own sentence, as *detail* rather than as the
                      message. It is English and stays English — it names the
                      offending type verbatim, which is the actionable part — but
                      it sits under a localised line rather than standing in for
                      one.
                    */}
                    <span className="text-caption text-label-secondary" dir="ltr">
                      {problem.detail}
                    </span>
                  </span>
                </ListRow>
              );
            })}
          </ListGroup>
        ) : null}

        <p className="mb-2 px-1 text-footnote text-label-secondary" data-testid="sections-count">
          <Isolate numeric>
            {t("homepage.count", { count: rows.length, max: MAX_SECTIONS })}
          </Isolate>
        </p>

        {listError ? (
          <div className="tone-danger tonal mb-3 flex items-start gap-2 rounded-lg px-3 py-2">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 text-footnote">{listError}</span>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            message={t("homepage.empty")}
            action={{ label: t("homepage.add"), onClick: () => setAddOpen(true) }}
          />
        ) : (
          rows.map((row, index) => {
            const dataError = parseError(row);
            const unknown = !isSectionType(row.type);

            return (
              <ListGroup
                key={row.key}
                title={
                  <span className="flex items-center gap-2">
                    <Ltr className="text-footnote text-label-secondary">{index + 1}</Ltr>
                    <span className="min-w-0 flex-1 truncate">
                      {unknown ? row.type : t(`homepage.type.${row.type}`)}
                    </span>
                    {/*
                      A type this build has no name for. The vocabulary is a copy
                      of a server-side constant with no contract keeping the two
                      in step — it was read out of a 400 — so a twelfth type
                      renders as itself with a badge rather than as a blank row.
                    */}
                    {unknown ? (
                      <StatusBadge tone="warning">{t("homepage.unknownType")}</StatusBadge>
                    ) : null}
                    <MoveControls
                      index={index}
                      count={rows.length}
                      onMove={(from, to) => setRows((current) => moveItem(current, from, to))}
                      label={unknown ? row.type : t(`homepage.type.${row.type}`)}
                      disabled={saving}
                    />
                  </span>
                }
              >
                <SelectField<SectionType>
                  label={t("homepage.field.type")}
                  value={isSectionType(row.type) ? row.type : SECTION_TYPES[0]}
                  onChange={(type) => update(index, { type })}
                  options={SECTION_TYPES.map((value) => ({
                    value,
                    label: t(`homepage.type.${value}`),
                  }))}
                  error={rowErrors[index]}
                  hint={unknown ? t("homepage.unknownTypeHint", { type: row.type }) : undefined}
                />
                {/*
                  `data` is free-form on the API's side — that is precisely why
                  §89 could not point `wp_kses` at it — so this is a JSON field
                  rather than a set of inputs. Inventing a per-type shape in the
                  panel would be inventing a contract the API does not have, and
                  it would be wrong the first time the storefront added a key.
                */}
                <TextAreaField
                  label={t("homepage.field.data")}
                  value={row.json}
                  onChange={(json) => update(index, { json })}
                  error={dataError ?? undefined}
                  rows={6}
                  hint={t("homepage.field.dataHint")}
                />
                <ListRow>
                  <Button
                    variant="plain"
                    onClick={() => setRemoving(index)}
                    disabled={saving}
                    className="tonal-fg tone-danger"
                  >
                    {t("homepage.remove")}
                  </Button>
                </ListRow>
              </ListGroup>
            );
          })
        )}
      </div>

      {dirty ? (
        <div className="save-bar material-bar hairline-t fixed inset-x-0 z-20">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <Button
              variant="plain"
              onClick={() => setRows(baseline)}
              disabled={saving}
              className="flex-1"
            >
              {t("revert")}
            </Button>
            <Button
              variant="filled"
              /*
               * The confirmation exists only when there is something to lose.
               * With a clean document this is an ordinary save and interrupting
               * it would be the modal the craft floor warns about.
               */
              onClick={() => (problems.length > 0 ? setConfirmSave(true) : void save())}
              loading={saving}
              disabled={malformed}
              className="flex-1"
            >
              {t("save")}
            </Button>
          </div>
        </div>
      ) : null}

      <ActionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t("homepage.addTitle")}
        actions={SECTION_TYPES.map((type) => ({
          label: t(`homepage.type.${type}`),
          onSelect: () => add(type),
        }))}
        cancelLabel={t("cancel")}
      />

      <ActionSheet
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("homepage.removeTitle")}
        description={t("homepage.removeBody")}
        actions={[
          {
            label: t("homepage.remove"),
            tone: "destructive",
            onSelect: () => {
              setRows((current) => current.filter((_, at) => at !== removing));
              setRemoving(null);
            },
          },
        ]}
        cancelLabel={t("cancel")}
      />

      <ActionSheet
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title={t("homepage.confirmSaveTitle")}
        description={t("homepage.confirmSaveBody", { count: problems.length })}
        actions={[
          {
            label: t("homepage.confirmSaveAction"),
            tone: "destructive",
            onSelect: () => void save(),
          },
        ]}
        cancelLabel={t("cancel")}
      />
    </Scaffold>
  );
}
