"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttributeTerm, GlobalAttributeDetail } from "@/lib/api/schemas/product";
import { BrowserApiError, acRead, acWrite, acWriteWithMeta } from "@/lib/api/browser";
import { decodeEntities } from "@/lib/format/html";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button, IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { Modal, useLatchedOpener } from "@/components/ui/Overlay";
import { Select, Switch, TextArea, TextField } from "@/components/ui/Form";
import { ConfirmDialog, useConfirm } from "@/components/ui/Confirm";
import { EmptyState, ErrorState, Notice } from "@/components/ui/States";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import {
  ATTRIBUTE_ORDER_BY,
  TERMS_PER_PAGE,
  type AttributeDraft,
  type TermDraft,
  attributeUpdateBody,
  blankRequired,
  detachCount,
  draftFromAttribute,
  draftFromTerm,
  normaliseSlug,
  slugTooLong,
  splitFieldErrors,
  termCreateBody,
  termUpdateBody,
} from "../attribute-write";

/**
 * One attribute: its settings, and the terms that are its vocabulary.
 *
 * ## Why the terms live on a route and not in a drawer under the list row
 *
 * This is the branch's overlay decision and §3.1 makes most of it:
 *
 *  1. **A term list is a paginated collection, not a field.**
 *     `AttributeController::termIndexArgs()` registers `page`, `per_page` (up to
 *     100), `search`, `hide_empty`, `orderby` and `order` — the API expects this
 *     to be browsed. The panel's own fixture has a sixty-term colour attribute
 *     because that is what a real nuancier is. A list that size with a control
 *     on every row is a screen, and an accordion under a list row is a screen
 *     hidden inside a row.
 *  2. **Every row can open a destructive confirm, and a confirm is a `Modal`.**
 *     §3.1: *"Never nested. A modal that needs a second modal is a modal that
 *     needs steps."* The product-create branch settled the same collision one
 *     level down — `NewProductDrawer` makes its picker and upload into steps
 *     precisely because §3.1 refuses a `Modal` over a `Drawer`. A drawer holding
 *     sixty rows that each raise a `ConfirmDialog` is that shape at scale.
 *  3. **The counts only exist on the single read.**
 *     `AttributeController::show()` carries `term_count` and `product_count`
 *     and `index()` deliberately does not — *"two queries per row"* — so a
 *     `GET /attributes/{id}` has to happen before anything can be said honestly
 *     about a delete. That request is a page's worth of data, and the page is
 *     where it belongs.
 *
 * `content/faqs/categories` reached the same conclusion for the same two-level
 * CRUD and states the general rule: a second level is not a step of the first,
 * it is *"different data, its own writes, its own empty state"*.
 *
 * The one overlay here is the term editor, and it is a `Modal` on a **route**,
 * so nothing is nested. It earns being an overlay rather than an inline row
 * editor because it is three fields — a rename, a slug that is dangerous, and a
 * description — and §3.1's Modal is *"a task that must be finished or
 * abandoned"*, which a slug edit is.
 *
 * ## Deleting, and what this screen promises about it
 *
 * Both deletes are refused with a 409 while anything uses them, and `?force=true`
 * overrides. Measured, verbatim:
 *
 *   attribute  "N product(s) use this attribute. Deleting it removes every term
 *              and leaves those products referencing an attribute that no longer
 *              exists. Repeat with ?force=true to delete anyway."
 *   term       "N product(s) use this term. Deleting it detaches them and breaks
 *              any variation that resolved through it. Re-tag them first, or
 *              repeat with ?force=true."
 *
 * The panel already holds both numbers, so **the consequence is in the first
 * dialog** rather than discovered from a 409 and asked twice. `CategoriesScreen`
 * had to ask twice; this screen does not have to and should not, because the
 * second question there is the one people click through.
 *
 * The 409 is still handled, and not as belt-and-braces: the two counts are a
 * snapshot computed by *different* rules — `AttributeRepository::productUsage()`
 * counts `publish`, `draft`, `pending` and `private`, while a term's `count` is
 * WordPress's own and is published-only — so an attribute can legitimately
 * report a product no term on it has counted, and somebody else can tag a
 * product between the read and the delete.
 *
 * **`?force=true` is only ever sent from a dialog that said what it would
 * detach.** There is no other caller.
 */
export function AttributeDetail({
  locale,
  initial,
}: {
  locale: string;
  initial: GlobalAttributeDetail;
}) {
  const t = useTranslations("attributes");
  const tStates = useTranslations("states");
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: attribute, refetch: refetchAttribute } = useQuery({
    queryKey: ["attributes", initial.id],
    queryFn: async () => {
      const { data } = await acRead<GlobalAttributeDetail>(`/attributes/${initial.id}`);
      return data;
    },
    initialData: initial,
  });

  const terms = useQuery({
    queryKey: ["attributes", initial.id, "terms"],
    queryFn: async () => {
      const { data, total } = await acRead<AttributeTerm[]>(
        `/attributes/${initial.id}/terms?per_page=${TERMS_PER_PAGE}`,
      );
      return { rows: data, total };
    },
  });

  const termRows = terms.data?.rows ?? [];

  /**
   * Everything a write touched. The attribute's own counts move when a term is
   * created or deleted, so the two queries are refreshed together rather than
   * separately — a `term_count` that lags the list it counts is the kind of
   * wrong number nobody reports.
   */
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["attributes"] });
  };

  /* ------------------------------------------------------------ settings --- */

  const [draft, setDraft] = useState<AttributeDraft>(() => draftFromAttribute(initial));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const patch = (change: Partial<AttributeDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
    /* A refusal is about the value that was sent, so it stops being true the
       moment any value changes. */
    setFieldErrors({});
    setSettingsError(null);
  };

  const body = attributeUpdateBody(attribute, draft);
  const draftSlug = normaliseSlug(draft.slug);
  const slugOverBudget = draftSlug !== "" && slugTooLong(draftSlug);
  /**
   * A cleared name is a certain 400, so `attributeUpdateBody()` omits the key —
   * and that omission would read as a save that quietly did nothing unless the
   * control also stops. Both halves, and this is the second.
   */
  const nameBlank = blankRequired(draft.name);
  /** True the moment the box differs, so the warning arrives before the save. */
  const slugWillMove = draftSlug !== "" && draftSlug !== attribute.slug;

  const save = useMutation({
    mutationFn: () => {
      /* Unreachable while the control is disabled, and thrown rather than
         silently skipped so a future caller cannot turn an empty PATCH — a 400
         with no `details` — into a save that looks like it worked. */
      if (body === null) throw new Error(t("saveBlocked"));
      return acWriteWithMeta<GlobalAttributeDetail>("PATCH", `/attributes/${attribute.id}`, body);
    },
    onSuccess: ({ data, meta }) => {
      setDraft(draftFromAttribute(data));
      setFieldErrors({});
      setSettingsError(null);
      /*
       * `meta.slug_changed` is the API telling the panel it did the one thing
       * worth telling somebody about — it is reported in `meta` rather than in
       * the resource precisely because it describes what the request *did*. An
       * ordinary write carries no `meta` at all.
       */
      toast.show(meta.slug_changed === true ? t("slugChanged") : t("saved"));
      invalidate();
      void refetchAttribute();
    },
    onError: (caught: unknown) => {
      if (caught instanceof BrowserApiError) {
        const { bound, loose } = splitFieldErrors(caught.fields, [
          "name",
          "slug",
          "order_by",
          "has_archives",
        ]);
        setFieldErrors(bound);
        if (loose.length > 0) setSettingsError(loose.join(" "));
        else if (Object.keys(bound).length === 0) setSettingsError(caught.message);
        return;
      }
      if (caught instanceof Error) {
        setSettingsError(caught.message);
        return;
      }
      throw caught;
    },
  });

  /* --------------------------------------------------------------- terms --- */

  const [termName, setTermName] = useState("");
  const [termSlug, setTermSlug] = useState("");
  const [termAddError, setTermAddError] = useState<string | null>(null);
  const [termAddFields, setTermAddFields] = useState<Record<string, string>>({});

  const addTerm = useMutation({
    mutationFn: () =>
      acWrite<AttributeTerm>(
        "POST",
        `/attributes/${attribute.id}/terms`,
        termCreateBody({ name: termName, slug: termSlug }),
      ),
    onSuccess: () => {
      setTermName("");
      setTermSlug("");
      setTermAddError(null);
      setTermAddFields({});
      toast.show(t("termCreated"));
      invalidate();
    },
    onError: (caught: unknown) => {
      if (caught instanceof BrowserApiError) {
        const { bound, loose } = splitFieldErrors(caught.fields, ["name", "slug"]);
        setTermAddFields(bound);
        /* The duplicate-slug 409 carries `details.slug` and a sentence, and no
           `fields` — so it lands here rather than under the box, which is where
           the sentence is actually about what to do next. Since the fix round's
           item 8 the *duplicate name* answers the same way, with `details.term_id`
           instead of `details.slug`: `AttributeRepository::fromWpError()` reads
           the colliding id out of WordPress's `term_exists` error rather than
           dropping it. Nothing here reads that id yet; offering "open the term
           you already have" is a screen this branch did not build. */
        if (loose.length > 0) setTermAddError(loose.join(" "));
        else if (Object.keys(bound).length === 0) setTermAddError(caught.message);
        return;
      }
      if (caught instanceof Error) {
        setTermAddError(caught.message);
        return;
      }
      throw caught;
    },
  });

  /** The term the editor modal is open on, and the draft it is editing. */
  const [editing, setEditing] = useState<{ term: AttributeTerm; draft: TermDraft } | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);

  const editBody = editing === null ? null : termUpdateBody(editing.term, editing.draft);

  const saveTerm = useMutation({
    mutationFn: () => {
      if (editing === null || editBody === null) throw new Error(t("saveBlocked"));
      return acWriteWithMeta<AttributeTerm>(
        "PATCH",
        `/attributes/${attribute.id}/terms/${editing.term.id}`,
        editBody,
      );
    },
    onSuccess: ({ meta }) => {
      setEditing(null);
      setEditErrors({});
      setEditError(null);
      toast.show(meta.slug_changed === true ? t("termSlugChanged") : t("termSaved"));
      invalidate();
    },
    onError: (caught: unknown) => {
      if (caught instanceof BrowserApiError) {
        const { bound, loose } = splitFieldErrors(caught.fields, ["name", "slug", "description"]);
        setEditErrors(bound);
        if (loose.length > 0) setEditError(loose.join(" "));
        else if (Object.keys(bound).length === 0) setEditError(caught.message);
        return;
      }
      if (caught instanceof Error) {
        setEditError(caught.message);
        return;
      }
      throw caught;
    },
  });

  const termConfirm = useConfirm<AttributeTerm>();

  const removeTerm = useMutation({
    mutationFn: (term: AttributeTerm) =>
      acWrite<{ products_detached: number }>(
        "DELETE",
        `/attributes/${attribute.id}/terms/${term.id}${term.count > 0 ? "?force=true" : ""}`,
      ),
    onSuccess: (result) => {
      termConfirm.close();
      toast.show(
        result.products_detached > 0
          ? t("termDeletedDetached", { count: result.products_detached })
          : t("termDeleted"),
      );
      invalidate();
    },
    onError: (caught: unknown) => {
      termConfirm.close();
      /*
       * A 409 here means the count the dialog was drawn from was stale — the
       * term picked up a product between the read and the delete, or the two
       * counting rules disagreed. It is a real outcome, not a bug, and the
       * honest answer is to say the number the *server* has rather than to
       * silently retry with `?force=true`: retrying would detach products
       * nobody was warned about.
       */
      if (caught instanceof BrowserApiError && caught.status === 409) {
        const count = detachCount(caught.details);
        toast.show(count === null ? caught.message : t("termDeleteDetach", { count }), "danger");
        invalidate();
        return;
      }
      if (caught instanceof Error) {
        toast.show(caught.message, "danger");
        return;
      }
      throw caught;
    },
  });

  /* ---------------------------------------------------- the attribute itself --- */

  const attributeConfirm = useConfirm<GlobalAttributeDetail>();

  const removeAttribute = useMutation({
    mutationFn: (row: GlobalAttributeDetail) =>
      acWrite<{ products_detached: number }>(
        "DELETE",
        `/attributes/${row.id}${row.product_count > 0 ? "?force=true" : ""}`,
      ),
    onSuccess: (result) => {
      attributeConfirm.close();
      toast.show(
        result.products_detached > 0
          ? t("deletedDetached", { count: result.products_detached })
          : t("deleted"),
      );
      void queryClient.invalidateQueries({ queryKey: ["attributes"] });
      /* Back to the list, because the record this route is addressed by is
         gone: staying would render a 404 the person caused on purpose. */
      router.push(`/${locale}/attributes`);
    },
    onError: (caught: unknown) => {
      attributeConfirm.close();
      if (caught instanceof BrowserApiError && caught.status === 409) {
        const count = detachCount(caught.details);
        toast.show(count === null ? caught.message : t("deleteDetach", { count }), "danger");
        void refetchAttribute();
        return;
      }
      if (caught instanceof Error) {
        toast.show(caught.message, "danger");
        return;
      }
      throw caught;
    },
  });

  const attributeOpener = useLatchedOpener(attributeConfirm.target && "attribute-actions");
  const termOpener = useLatchedOpener(termConfirm.target && `term-actions-${termConfirm.target.id}`);
  const editOpener = useLatchedOpener(editing && `term-actions-${editing.term.id}`);

  const truncated = (terms.data?.total ?? 0) > termRows.length;

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={decodeEntities(attribute.name)}
        subtitle={
          <Isolate>
            {t("usage", {
              terms: attribute.term_count,
              products: attribute.product_count,
            })}
          </Isolate>
        }
        back={{ href: `/${locale}/attributes`, label: t("back") }}
        actions={
          <Menu
            label={t("deleteAction")}
            actions={[
              {
                key: "delete",
                label: t("deleteAction"),
                icon: "trash",
                destructive: true,
                disabled: removeAttribute.isPending,
                onSelect: () => attributeConfirm.ask(attribute),
              },
            ]}
            trigger={
              <IconButton
                id="attribute-actions"
                label={t("deleteAction")}
                icon="more"
                variant="secondary"
              />
            }
          />
        }
      />

      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          <Card title={t("settings")}>
            <div className="flex flex-col gap-3">
              {settingsError ? (
                <Notice tone="danger" role="alert" title={tStates("errorTitle")}>
                  <Ltr numeric={false} className="block text-ui-label">
                    {settingsError}
                  </Ltr>
                </Notice>
              ) : null}

              <TextField
                id="attribute-name"
                label={t("name")}
                value={draft.name}
                onChange={(next) => patch({ name: next })}
                hint={t("nameHint")}
                error={fieldErrors.name}
              />

              <TextField
                id="attribute-slug"
                label={t("slug")}
                value={draft.slug}
                onChange={(next) => patch({ slug: next })}
                hint={t("slugHint")}
                error={slugOverBudget ? t("slugTooLong") : fieldErrors.slug}
              />

              {/*
                The warning is drawn **while the box differs**, not after the
                save. `wc_update_attribute()` migrates the term rows, every
                product's `_product_attributes` and every variation's
                `attribute_pa_*` key — asserted in process by
                `tests/Api/attributes.php` — so the catalogue survives. What does
                not survive is anything outside this database: a saved filter, a
                storefront link, a bookmark. That is the half a person has to
                weigh, and it has to be on screen before they press save rather
                than in the toast afterwards.
              */}
              {slugWillMove ? (
                <Notice tone="warning" title={t("slugWarning")} />
              ) : null}

              {/*
                `taxonomy` and `type` are read-only and are shown rather than
                hidden. The taxonomy because it is what a catalogue filter
                matches and confusing it with the slug is the mistake
                `AttributePresenter` exists to prevent — a person needs to be
                able to read the one they will paste into a filter. The type
                because there is exactly one: `wc_get_attribute_types()` on this
                shop answers `["select"]`, measured through a provoked 400's
                `details.available_types`. A control offering a choice of one is
                noise, and a hard-coded list of several would be inventing a
                vocabulary the panel has no route to check.
              */}
              <div className="flex flex-col gap-1">
                <p className="text-ui-label text-ui-muted">{t("taxonomy")}</p>
                <Ltr numeric={false} className="text-ui-body text-ui-fg">
                  {attribute.taxonomy}
                </Ltr>
                <p className="text-ui-label text-ui-subtle">{t("taxonomyHint")}</p>
              </div>

              <div className="flex flex-col gap-1">
                <p className="text-ui-label text-ui-muted">{t("type")}</p>
                <Ltr numeric={false} className="text-ui-body text-ui-fg">
                  {attribute.type}
                </Ltr>
                <p className="text-ui-label text-ui-subtle">{t("typeHint")}</p>
              </div>

              <Select
                id="attribute-order-by"
                label={t("orderBy")}
                value={draft.order_by}
                onChange={(next) => patch({ order_by: next })}
                options={ATTRIBUTE_ORDER_BY.map((value) => ({
                  value,
                  label: t(`orderByOption.${value}`),
                }))}
                hint={t("orderByHint")}
                error={fieldErrors.order_by}
              />

              <Switch
                id="attribute-has-archives"
                label={t("hasArchives")}
                checked={draft.has_archives}
                onChange={(next) => patch({ has_archives: next })}
                hint={t("hasArchivesHint")}
                error={fieldErrors.has_archives}
              />

              <div>
                <Button
                  onClick={() => save.mutate()}
                  loading={save.isPending}
                  disabled={body === null || slugOverBudget || nameBlank}
                  /* §3.3. Three different reasons and the tooltip says which:
                     the name is empty, the slug cannot be sent, or nothing
                     changed. The order is the order a person hits them. */
                  title={
                    nameBlank
                      ? t("addBlocked")
                      : slugOverBudget
                        ? t("slugTooLong")
                        : body === null
                          ? t("saveBlocked")
                          : undefined
                  }
                >
                  {t("save")}
                </Button>
              </div>
            </div>
          </Card>

          <Card title={t("terms")} footnote={t("termsNote")}>
            <div className="flex flex-col gap-3">
              {terms.isError ? (
                <ErrorState
                  message={(terms.error as Error).message}
                  onRetry={() => void terms.refetch()}
                />
              ) : termRows.length === 0 && !terms.isPending ? (
                <EmptyState icon="tag" message={t("termsEmpty")} detail={t("termsEmptyDetail")} />
              ) : (
                <ul className="flex flex-col">
                  {termRows.map((term) => (
                    <li key={term.id} className="ui-row flex min-w-0 items-center gap-3 py-2">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span dir="auto" className="truncate text-ui-body text-ui-fg">
                          {decodeEntities(term.name)}
                        </span>
                        {/*
                          **The slug is on the row and that is the point of the
                          row.** A term named in Arabic derives a percent-encoded
                          slug — measured, "أحمر" becomes
                          `%d8%a3%d8%ad%d9%85%d8%b1` — because `wp_insert_term()`
                          calls `sanitize_title()` without the `urldecode()` that
                          `wc_sanitize_taxonomy_name()` wraps around it for an
                          attribute. That string is what a filter URL carries and
                          what a shopkeeper has to recognise, so the only way to
                          find out it happened is to see it, and the only way to
                          fix it is the editor beside it.
                        */}
                        <Ltr numeric={false} className="truncate text-ui-label text-ui-subtle">
                          {term.slug}
                        </Ltr>
                      </span>

                      <Isolate className="shrink-0 text-ui-label text-ui-muted">
                        {t("termUsedBy", { count: term.count })}
                      </Isolate>

                      <Menu
                        label={t("termActions", { label: decodeEntities(term.name) })}
                        actions={[
                          {
                            key: "edit",
                            label: t("termEdit"),
                            icon: "note",
                            onSelect: () => {
                              setEditErrors({});
                              setEditError(null);
                              setEditing({ term, draft: draftFromTerm(term) });
                            },
                          },
                          {
                            key: "delete",
                            label: t("termDelete"),
                            icon: "trash",
                            destructive: true,
                            disabled: removeTerm.isPending,
                            onSelect: () => termConfirm.ask(term),
                          },
                        ]}
                        trigger={
                          <IconButton
                            id={`term-actions-${term.id}`}
                            label={t("termActions", { label: decodeEntities(term.name) })}
                            icon="more"
                            variant="ghost"
                            size="sm"
                            className="shrink-0"
                          />
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}

              {/*
                100 is both the default and the maximum `per_page` on this route
                — measured, `per_page=200` is a 400 — so an attribute past a
                hundred terms genuinely cannot be shown whole. Saying so beats
                showing a hundred rows that look like all of them, and it is a
                sentence rather than a pager because nothing on this screen has a
                use for the hundred-and-first term that a search would not serve
                better. Whoever needs one should add `?search=`, which the route
                already takes.
              */}
              {truncated ? (
                <p className="text-ui-label text-ui-subtle">
                  <Isolate>
                    {t("termsTruncated", {
                      shown: termRows.length,
                      total: terms.data?.total ?? 0,
                    })}
                  </Isolate>
                </p>
              ) : null}
            </div>
          </Card>

          <Card title={t("termAdd")}>
            <div className="flex flex-col gap-3">
              {termAddError ? (
                <Notice tone="danger" role="alert" title={tStates("errorTitle")}>
                  <Ltr numeric={false} className="block text-ui-label">
                    {termAddError}
                  </Ltr>
                </Notice>
              ) : null}

              <TextField
                id="term-name"
                label={t("termName")}
                value={termName}
                onChange={(next) => {
                  setTermName(next);
                  setTermAddFields({});
                  setTermAddError(null);
                }}
                hint={t("termNameHint")}
                error={termAddFields.name}
              />

              <TextField
                id="term-slug"
                label={t("termSlug")}
                value={termSlug}
                onChange={(next) => {
                  setTermSlug(next);
                  setTermAddFields({});
                  setTermAddError(null);
                }}
                hint={t("termSlugHint")}
                error={termAddFields.slug}
              />

              <div>
                <Button
                  icon="plus"
                  onClick={() => addTerm.mutate()}
                  loading={addTerm.isPending}
                  disabled={termName.trim() === ""}
                  title={termName.trim() === "" ? t("termAddBlocked") : undefined}
                >
                  {t("termAddAction")}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </PageBody>

      {/*
        A `Modal` and not a `Drawer`: three fields is a task to finish or abandon
        rather than context beside the page, and §3.1 assigns that shape. It is
        opened from a route, so nothing is nested — the rule the create drawer
        one screen over had to work around.
      */}
      <Modal
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        title={t("termEditTitle")}
        size="sm"
        returnFocusTo={editOpener}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saveTerm.isPending}>
              {t("cancel")}
            </Button>
            <Button
              onClick={() => saveTerm.mutate()}
              loading={saveTerm.isPending}
              /* The same two halves as the settings form: the body omits a
                 blank name and the control refuses to fire, so clearing the box
                 can never read as a save that worked. */
              disabled={editBody === null || (editing !== null && blankRequired(editing.draft.name))}
              title={
                editing !== null && blankRequired(editing.draft.name)
                  ? t("termAddBlocked")
                  : editBody === null
                    ? t("saveBlocked")
                    : undefined
              }
            >
              {t("saveTerm")}
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="flex flex-col gap-3">
            {editError ? (
              <Notice tone="danger" role="alert" title={tStates("errorTitle")}>
                <Ltr numeric={false} className="block text-ui-label">
                  {editError}
                </Ltr>
              </Notice>
            ) : null}

            <TextField
              id="term-edit-name"
              label={t("termName")}
              value={editing.draft.name}
              onChange={(next) =>
                setEditing((current) =>
                  current === null ? null : { ...current, draft: { ...current.draft, name: next } },
                )
              }
              error={editErrors.name}
            />

            <TextField
              id="term-edit-slug"
              label={t("termSlug")}
              value={editing.draft.slug}
              onChange={(next) =>
                setEditing((current) =>
                  current === null ? null : { ...current, draft: { ...current.draft, slug: next } },
                )
              }
              hint={t("termSlugHint")}
              error={editErrors.slug}
            />

            {/* A term slug rename has the same consequence one level down and no
                migration to soften it: a saved filter naming the old value stops
                matching. `AttributeTermInput`'s own docblock is why the field is
                writable at all — *"sometimes a slug is genuinely wrong"*. */}
            {editing.draft.slug.trim() !== "" &&
            editing.draft.slug.trim() !== editing.term.slug ? (
              <Notice tone="warning" title={t("termSlugChanged")} />
            ) : null}

            <TextArea
              id="term-edit-description"
              label={t("termDescription")}
              value={editing.draft.description}
              onChange={(next) =>
                setEditing((current) =>
                  current === null
                    ? null
                    : { ...current, draft: { ...current.draft, description: next } },
                )
              }
              error={editErrors.description}
            />
          </div>
        ) : null}
      </Modal>

      {/*
        One dialog per delete, and each says what *this* delete does. The body
        branches on the count rather than the screen asking twice: the panel
        holds the number, so the second question `CategoriesScreen` has to ask —
        the one people click through — is folded into the first.
      */}
      <ConfirmDialog
        open={termConfirm.open}
        onOpenChange={termConfirm.onOpenChange}
        returnFocusTo={termOpener}
        tone="destructive"
        loading={removeTerm.isPending}
        title={t("termDeleteTitle")}
        body={
          <>
            <p className="text-ui-subheading text-ui-fg" dir="auto">
              {termConfirm.target ? decodeEntities(termConfirm.target.name) : ""}
            </p>
            <p className="mt-1.5">
              {termConfirm.target && termConfirm.target.count > 0
                ? t("termDeleteDetach", { count: termConfirm.target.count })
                : t("termDeleteBody")}
            </p>
          </>
        }
        confirmLabel={t("termDelete")}
        onConfirm={() => {
          if (termConfirm.target) removeTerm.mutate(termConfirm.target);
        }}
      />

      <ConfirmDialog
        open={attributeConfirm.open}
        onOpenChange={attributeConfirm.onOpenChange}
        returnFocusTo={attributeOpener}
        tone="destructive"
        loading={removeAttribute.isPending}
        title={t("deleteTitle")}
        /*
         * **`requireTyped`, and this is the act §3.1 wrote the rule for.** It
         * destroys every term on the attribute, detaches every product, and
         * leaves any variation that resolved through it matching nothing — *"a
         * failure with no error and a long delay between cause and symptom"*, in
         * `AttributeService`'s own words. There is no trash and no undo.
         *
         * §3.1's shipping-branch amendment says to require typing **only where
         * the record has an identifier a person would recognise**, and this one
         * does: the slug. It is Latin, it is on screen twice, it is short, and
         * it is not the label — so typing it is a deliberate act rather than a
         * copy of the heading. That is exactly the case the amendment carved out
         * a shipping rule *for lacking*.
         */
        requireTyped={
          attributeConfirm.target
            ? { value: attributeConfirm.target.slug, label: t("deleteConfirmLabel") }
            : undefined
        }
        body={
          <>
            <p className="text-ui-subheading text-ui-fg" dir="auto">
              {attributeConfirm.target ? decodeEntities(attributeConfirm.target.name) : ""}
            </p>
            <p className="mt-1.5">
              {attributeConfirm.target && attributeConfirm.target.product_count > 0
                ? t("deleteDetach", { count: attributeConfirm.target.product_count })
                : t("deleteBody")}
            </p>
          </>
        }
        confirmLabel={t("deleteAction")}
        onConfirm={() => {
          if (attributeConfirm.target) removeAttribute.mutate(attributeConfirm.target);
        }}
      />
    </div>
  );
}
