"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import type { HomepageSection } from "@/lib/api/schemas/cms";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import {
  MAX_SECTIONS,
  SECTION_TYPES,
  classifyProblem,
  isSectionType,
  type SectionType,
} from "@/lib/cms";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { Reorder, moveItem } from "@/components/ui/Reorder";
import { ConfirmDialog, useConfirm } from "@/components/ui/Confirm";
import { useLatchedOpener } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, Notice } from "@/components/ui/States";
import {
  ErrorSummary,
  SaveBar,
  Select,
  TextArea,
  type FormFailure,
} from "@/components/ui/Form";
import { Isolate } from "@/components/primitives/Ltr";
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
 * gated behind a `ConfirmDialog` that names the count. It is the most important
 * property this screen has, and it fires **only** when there is something to
 * lose: on a clean document this is an ordinary save and interrupting it would
 * be a modal for nothing.
 *
 * The report itself is **English prose with a number in it** — "Section 4 has an
 * unknown type \"carousel\"." — not an object keyed by anything, so there is
 * nothing to hang a translation on. Rendering it raw is what put an English
 * paragraph across the middle of an Arabic sheet on the analytics branch. So the
 * panel states the *shape* of each problem in the reader's language and carries
 * the API's sentence beside it as `dir="ltr"` detail, which is what `ErrorState`
 * already does for a 409.
 *
 * The position in that sentence is **1-based over the stored document**, not over
 * the sections that survived, so "Section 4" is not the fourth card on screen.
 * The seed interleaves its malformed sections rather than appending them
 * precisely so that an off-by-one here would be visible, and the copy says "du
 * document stocké" so the two numbering schemes on this page cannot be confused.
 *
 * ## One endpoint, two error shapes, and only one of them is positional
 *
 * A bad section is `sections[2].type` and binds to that row's own control. More
 * than fifty sections is a **flat `sections`** — measured,
 * `{"sections": "A homepage carries at most 50 sections; this one has 51."}` —
 * which belongs to no row at all. A form that bound every homepage error to an
 * index would drop that one on the floor. Both go through `ErrorSummary`: the
 * positional ones as links to their `Select`, the cap as plain text, which is
 * §3.4's rule for a failure with no field on screen.
 *
 * ## No stale marker, and §3.7's amendment is why
 *
 * The document arrives from a Server Component. There is no client cache, nothing
 * polls, and there is no refresh control — so what is on screen is exactly as old
 * as the navigation that fetched it, and the half of the rule that does the real
 * work ("every write control disabled with that same reason") has nothing to
 * disable. The draft *diverges* from the server as somebody types, and that is
 * what the save bar reports; it is not staleness.
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

const typeFieldId = (key: string) => `homepage-type-${key}`;
const rowMenuId = (key: string) => `homepage-menu-${key}`;

export function HomepageEditor({
  locale,
  initialSections,
  initialProblems,
  loadError,
}: {
  locale: string;
  initialSections: HomepageSection[];
  initialProblems: string[];
  /** The API's own sentence when the document could not be read at all. */
  loadError: string | null;
}) {
  const t = useTranslations("content");
  const router = useRouter();
  const toast = useToast();

  const [rows, setRows] = useState<Row[]>(() => rowsOf(initialSections));
  const [baseline, setBaseline] = useState<Row[]>(() => rowsOf(initialSections));
  const [problems, setProblems] = useState(initialProblems);
  const [confirmSave, setConfirmSave] = useState(false);
  /** Positional errors keyed by the row's own key, never by its index — see `edit()`. */
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  /** The non-positional one: the 50-section cap lands on `sections`, not `sections[50]`. */
  const [listError, setListError] = useState<string | null>(null);

  const confirmRemove = useConfirm<Row>();
  /* Latched, and hoisted above the load-failure return below so it is called on
     every render: `useConfirm` clears its target on close and Radix fires
     `onCloseAutoFocus` *after* `onOpenChange`, so an id derived from the target
     is already `undefined` when the overlay reads it. */
  const removeOpener = useLatchedOpener(
    confirmRemove.target && rowMenuId(confirmRemove.target.key),
  );

  const dirty =
    JSON.stringify(rows.map(({ type, json }) => ({ type, json }))) !==
    JSON.stringify(baseline.map(({ type, json }) => ({ type, json })));

  /**
   * A row's `data` must parse as a JSON **object** before it can be sent.
   *
   * Handed to `TextArea`'s `validate` rather than to its `error`, so §3.4's
   * timing applies: silent until the first blur, live afterwards. Half a JSON
   * document is not a bad JSON document, it is one being typed.
   */
  const parseError = (json: string): string | undefined => {
    if (json.trim() === "") return undefined;
    try {
      const parsed: unknown = JSON.parse(json);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return t("homepage.dataNotObject");
      }
      return undefined;
    } catch {
      return t("homepage.dataNotJson");
    }
  };

  const malformed = rows.some((row) => parseError(row.json) !== undefined);

  /**
   * Any change to the document clears the refusal that was about the whole of it.
   *
   * A 400 describes the array that was sent. `sections` — the fifty-section cap —
   * is a statement about that array and stops being true the moment a row is
   * added or removed, so it goes on every edit.
   *
   * The positional ones do not, because they are resolved to a **row key** the
   * moment they arrive rather than kept as an index: `sections[2].type` names a
   * section, and that section is still the one refused after it is dragged to the
   * top. An error kept as an index would point at whatever landed in slot 2. A
   * removed row takes its error with it, because the summary and the field both
   * read `rowErrors[row.key]` off the rows that still exist.
   */
  const edit = (next: Row[]) => {
    setRows(next);
    setListError(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        sections: rows.map((row) => ({
          type: row.type,
          data: row.json.trim() === "" ? {} : (JSON.parse(row.json) as Record<string, unknown>),
        })),
      };

      return acWrite<{ sections: HomepageSection[] }>("PUT", "/cms/homepage", payload);
    },
    onMutate: () => {
      setRowErrors({});
      setListError(null);
    },
    onSuccess: (updated) => {
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
      /* The write refused what the read would have dropped, so after a
         successful PUT there is nothing left to report. */
      setProblems([]);
      setConfirmSave(false);
      toast.show(t("homepage.saved"));
    },
    onError: (error: unknown) => {
      setConfirmSave(false);

      if (error instanceof BrowserApiError) {
        const next: Record<string, string> = {};
        let list: string | null = null;

        for (const [field, message] of Object.entries(error.fields ?? {})) {
          const at = field.match(/^sections\[(\d+)\]/);
          const row = at ? rows[Number.parseInt(at[1], 10)] : undefined;
          if (row) next[row.key] = message;
          else if (field === "sections") list = message;
          /* A `sections[n]` naming an index this draft no longer has is not
             dropped: it falls through to the summary as plain text below. */
          else if (at) list = message;
        }

        setRowErrors(next);
        setListError(list);
        return;
      }

      if (error instanceof Error) {
        toast.show(error.message, "danger");
        return;
      }
      throw error;
    },
  });

  const labelOf = (type: string) =>
    isSectionType(type) ? t(`homepage.type.${type}`) : type;

  /*
   * The summary lists every refusal, and links only the ones with a control on
   * screen. §3.4: a link that goes nowhere is worse than a line that does not
   * claim to.
   */
  const failures: FormFailure[] = [
    ...rows.flatMap((row, index) =>
      rowErrors[row.key] === undefined
        ? []
        : [
            {
              id: typeFieldId(row.key),
              label: t("homepage.sectionTitle", {
                position: index + 1,
                type: labelOf(row.type),
              }),
              message: rowErrors[row.key],
            },
          ],
    ),
    ...(listError === null ? [] : [{ message: listError }]),
  ];

  const atCap = rows.length >= MAX_SECTIONS;

  /**
   * A new section is `custom` with empty data, and the row's own `Select` is
   * where its type is chosen.
   *
   * The old screen opened an eleven-item chooser before the row existed, which
   * is a second control doing the job the row's type field already does — and it
   * made the empty state's action a menu trigger, which `EmptyState` cannot
   * render. `custom` rather than `hero` because it is the one type that claims
   * nothing: `data` is free-form on the API's side, an empty object is a real
   * `custom` section, and a default of `hero` would put a second hero on a
   * homepage every time somebody pressed Add.
   */
  const add = () =>
    edit([...rows, { key: nextKey(), type: "custom" satisfies SectionType, json: "{}" }]);

  if (loadError !== null) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={t("section.homepage")}
          back={{ href: `/${locale}/content`, label: t("title") }}
        />
        <PageBody width="detail">
          {/* The API's own sentence as `detail`, because a document that will not
              load says why in it — and a retry, because a refused read is exactly
              the case where trying again can work. */}
          <ErrorState
            message={t("homepage.loadFailed")}
            detail={loadError}
            onRetry={() => router.refresh()}
          />
        </PageBody>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.homepage")}
        subtitle={
          <span data-testid="sections-count">
            <Isolate>
              {t("homepage.count", { count: rows.length, max: MAX_SECTIONS })}
            </Isolate>
          </span>
        }
        back={{ href: `/${locale}/content`, label: t("title") }}
        actions={
          <Button
            id="homepage-add"
            icon="plus"
            onClick={add}
            disabled={atCap}
            /* §3.3: a disabled control says why, and the cap is the API's. */
            title={atCap ? t("homepage.atCap", { max: MAX_SECTIONS }) : undefined}
          >
            {t("homepage.add")}
          </Button>
        }
      />

      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          {/*
            The drop report, above everything, because it describes the document
            the editor is about to overwrite. A `Notice` and not a toast: §3.1 —
            an error a person must act on is not a toast — and it has to still be
            there when they reach the save bar.
          */}
          {problems.length > 0 ? (
            <Notice tone="warning" title={t("homepage.problemsTitle")}>
              <ul className="flex flex-col gap-2">
                {problems.map((sentence, index) => {
                  const problem = classifyProblem(sentence);
                  return (
                    <li key={index} className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-ui-label">
                        <Isolate>
                          {problem.position === null
                            ? t(`homepage.problem.${problem.kind}`)
                            : t(`homepage.problemAt.${problem.kind}`, {
                                position: problem.position,
                              })}
                        </Isolate>
                      </span>
                      {/*
                        The API's own sentence, as *detail* rather than as the
                        message. It stays English — it names the offending type
                        verbatim, which is the actionable part — but it sits under
                        a localised line rather than standing in for one, and
                        `dir="ltr"` keeps it from reordering inside an Arabic
                        column.
                      */}
                      {/* `text-ui-caption` and no opacity: the tone's `-fg` on
                          its own `-bg` measures 5.72:1 and dimming it would drop
                          the pair under 4.5. Size and direction carry the
                          demotion instead of transparency. */}
                      <span dir="ltr" className="text-ui-caption">
                        {problem.detail}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-ui-label">{t("homepage.problemsNote")}</p>
            </Notice>
          ) : null}

          <ErrorSummary failures={failures} />

          {/* Said once, above the list, rather than under all nine textareas —
              see the `TextArea` below. It sits above rather than below because it
              is a property of every control that follows, and a caveat read after
              the thing it qualifies has already been guessed at. */}
          {rows.length > 0 ? (
            <p className="text-ui-label text-ui-subtle">{t("homepage.field.dataHint")}</p>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              icon="dashboard"
              message={t("homepage.empty")}
              action={{ label: t("homepage.add"), onClick: add }}
            />
          ) : (
            rows.map((row, index) => {
              const unknown = !isSectionType(row.type);

              return (
                <Card
                  key={row.key}
                  title={t("homepage.sectionTitle", {
                    position: index + 1,
                    type: labelOf(row.type),
                  })}
                  actions={
                    <div className="flex items-center gap-1">
                      {/*
                        A type this build has no name for. The vocabulary is a copy
                        of a server-side constant with no contract keeping the two
                        in step — it was read out of a 400 — so a twelfth type is
                        badged rather than rendered as a blank row.
                      */}
                      {unknown ? (
                        <Badge tone="warning">{t("homepage.unknownType")}</Badge>
                      ) : null}
                      <Reorder
                        index={index}
                        count={rows.length}
                        onMove={(from, to) => edit(moveItem(rows, from, to))}
                        label={labelOf(row.type)}
                        disabled={save.isPending}
                      />
                      <Menu
                        label={t("homepage.rowActions", { type: labelOf(row.type) })}
                        actions={[
                          {
                            key: "remove",
                            label: t("homepage.remove"),
                            icon: "trash",
                            destructive: true,
                            disabled: save.isPending,
                            onSelect: () => confirmRemove.ask(row),
                          },
                        ]}
                        trigger={
                          <IconButton
                            id={rowMenuId(row.key)}
                            label={t("homepage.rowActions", { type: labelOf(row.type) })}
                            icon="more"
                            variant="ghost"
                            size="sm"
                            className="shrink-0"
                          />
                        }
                      />
                    </div>
                  }
                >
                  <div className="flex flex-col gap-4">
                    <Select
                      id={typeFieldId(row.key)}
                      label={t("homepage.field.type")}
                      /*
                       * The stored type is the value, even when this build has no
                       * name for it. Coercing an unknown type to the first known
                       * one — which this screen used to do — showed "Bandeau
                       * principal" for a section stored as "carousel": the wrong
                       * value in a control whose whole job is to report it.
                       */
                      value={row.type}
                      onChange={(type) =>
                        edit(rows.map((r) => (r.key === row.key ? { ...r, type } : r)))
                      }
                      options={[
                        ...(unknown ? [{ value: row.type, label: row.type }] : []),
                        ...SECTION_TYPES.map((value) => ({
                          value: value as string,
                          label: t(`homepage.type.${value}`),
                        })),
                      ]}
                      error={rowErrors[row.key]}
                      hint={
                        unknown ? t("homepage.unknownTypeHint", { type: row.type }) : undefined
                      }
                    />

                    {/*
                      `data` is free-form on the API's side — that is precisely why
                      §89 could not point `wp_kses` at it — so this is a JSON field
                      rather than a set of inputs. Inventing a per-type shape in
                      the panel would be inventing a contract the API does not
                      have, and it would be wrong the first time the storefront
                      added a key.
                    */}
                    <TextArea
                      id={`homepage-data-${row.key}`}
                      label={t("homepage.field.data")}
                      value={row.json}
                      onChange={(json) =>
                        edit(rows.map((r) => (r.key === row.key ? { ...r, json } : r)))
                      }
                      rows={6}
                      /*
                        **No `hint` here, and the absence is the edit.** Every
                        section carries the identical sentence — the API defines no
                        schema per type — so binding it to the control printed it
                        once per section: nine copies of one fact down a document
                        that is nine cards long. It is stated once, above the list,
                        where it is read before the first textarea rather than
                        beside the ninth. "Restraint applies to words as much as to
                        decoration."
                      */
                      validate={parseError}
                    />
                  </div>
                </Card>
              );
            })
          )}

          <SaveBar
            dirty={dirty}
            saving={save.isPending}
            saveId="homepage-save"
            onDiscard={() => {
              setRows(baseline);
              setRowErrors({});
              setListError(null);
            }}
            /* The confirmation exists only where there is something to lose. */
            onSave={() => (problems.length > 0 ? setConfirmSave(true) : save.mutate())}
            blockedReason={malformed ? t("homepage.blockedMalformed") : undefined}
          />
        </div>
      </PageBody>

      <ConfirmDialog
        open={confirmRemove.open}
        onOpenChange={confirmRemove.onOpenChange}
        returnFocusTo={removeOpener}
        tone="destructive"
        title={t("homepage.removeTitle")}
        /*
         * **No `requireTyped`, and here there is genuinely nothing to type.** A
         * section's only handle is its type, which its neighbours may share — two
         * `text` sections are told apart by their position and by nothing else. §3.1
         * as amended on the shipping branch: name the record in human terms, and
         * require typing only where a real identifier exists. It is also the
         * least final act on this screen — nothing is written until the save bar
         * is used, and the discard button puts the section back.
         */
        body={
          <>
            <p className="text-ui-subheading text-ui-fg">
              {confirmRemove.target
                ? t("homepage.sectionTitle", {
                    position: rows.findIndex((r) => r.key === confirmRemove.target?.key) + 1,
                    type: labelOf(confirmRemove.target.type),
                  })
                : ""}
            </p>
            <p className="mt-1.5">{t("homepage.removeBody")}</p>
          </>
        }
        confirmLabel={t("homepage.remove")}
        onConfirm={() => {
          const target = confirmRemove.target;
          if (target) edit(rows.filter((row) => row.key !== target.key));
          confirmRemove.close();
        }}
      />

      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        returnFocusTo="homepage-save"
        tone="destructive"
        loading={save.isPending}
        title={t("homepage.confirmSaveTitle")}
        body={t("homepage.confirmSaveBody", { count: problems.length })}
        confirmLabel={t("homepage.confirmSaveAction")}
        onConfirm={() => save.mutate()}
      />
    </div>
  );
}
