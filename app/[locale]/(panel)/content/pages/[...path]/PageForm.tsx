"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Page } from "@/lib/api/schemas/cms";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { CONTENT_STATUSES, type ContentStatus } from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/Button";
import { Menu, type MenuAction } from "@/components/ui/Menu";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { Notice, StaleBanner } from "@/components/ui/States";
import {
  ErrorSummary,
  NumberField,
  ReadOnlyField,
  SaveBar,
  Select,
  Switch,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";

/**
 * A page as a form — edit and create, one component.
 *
 * Four things here are not ordinary form work, and all four are measured.
 *
 * **A rename has no redirect, and the form says so before it saves.** `slug`
 * renames and `parent_path` moves; WordPress leaves nothing behind at the old
 * address, so every storefront link built on it becomes a 404 the moment the
 * save lands. `meta.path_changed: true` tells the panel afterwards — which is
 * too late to be a decision. So a changed address raises a confirmation naming
 * both paths, and it is `tone="primary"` rather than destructive: a rename is
 * undone by renaming back, which is exactly what §3.1 reserves the destructive
 * tone and the typed identifier *away* from.
 *
 * **The panel does not sanitise, and must render the stored result back.**
 * `wp_kses` runs on save, not on read. An editor that kept showing what the
 * author typed would hide the fact that their `<iframe>` was stripped — and it
 * would come back on the next save, because the form would send the unstored
 * version again. So after a successful save the form re-seeds itself from the
 * response rather than from its own draft.
 *
 * **`content` and `excerpt` read back as rendered HTML** (`<p>…</p>\n`) rather
 * than as what was sent, and PATCHing that rendered form back does *not*
 * accumulate another wrapper — verified over three round trips. That is what
 * makes binding straight to the response safe here where a coupon's
 * `date_expires` made it unsafe there.
 *
 * **Delete has two refusals and they are different facts.** `details.children`
 * is a page whose children WordPress would promote to the root, changing every
 * one of their paths and reporting nothing; `?force=true` means it.
 * `details.option` is a page the shop has registered as its checkout or privacy
 * policy, and **force does not override it** — measured — because the fix is to
 * clear the setting, which is the decision actually being made.
 *
 * ## `PageBody width="form"`, and `Card` rather than `Section`
 *
 * §2.3 puts a page in the form row at 640px: this screen has no read-only report
 * half, so `DetailGrid` would draw an empty aside. `Card` and not `Form.tsx`'s
 * `Section` for the reason `Card.tsx` records — `Section` is sized to sit inside
 * an overlay at `--text-subheading`, and a card on a page takes `--text-heading`.
 */

type Draft = {
  title: string;
  slug: string;
  parent_path: string;
  status: ContentStatus;
  content: string;
  excerpt: string;
  menu_order: string;
  seoTitle: string;
  seoDescription: string;
  seoCanonical: string;
  seoIndex: boolean;
  seoFollow: boolean;
};

function draftOf(page: Page): Draft {
  return {
    title: decodeEntities(page.title),
    slug: page.slug,
    parent_path: page.parent_path,
    status: page.status,
    content: page.content,
    excerpt: page.excerpt,
    menu_order: String(page.menu_order),
    /*
     * `overrides` names the SEO keys somebody set by hand; everything else in
     * the block is *derived* from the title and the excerpt and changes when
     * they do. So an underived field starts empty with the derived value as its
     * placeholder — the author sees what they will get without being shown a
     * value they never typed and would then be unable to un-type.
     */
    seoTitle: page.seo.overrides.includes("title") ? page.seo.title : "",
    seoDescription: page.seo.overrides.includes("description") ? page.seo.description : "",
    seoCanonical: page.seo.canonical,
    seoIndex: page.seo.robots.index,
    seoFollow: page.seo.robots.follow,
  };
}

const EMPTY_PAGE: Page = {
  id: 0,
  path: "",
  slug: "",
  parent_path: "",
  status: "draft",
  title: "",
  content: "",
  excerpt: "",
  parent_id: 0,
  menu_order: 0,
  image: null,
  seo: {
    title: "",
    description: "",
    canonical: "",
    robots: { index: true, follow: true, directive: "index, follow" },
    og: { title: "", description: "", type: "website", image: null },
    image: null,
    structured_data: {},
    overrides: [],
  },
  date_created: "",
  date_modified: "",
};

/**
 * A field's DOM id, so `ErrorSummary` can link a failure to the control it is
 * about — which is the whole reason every control in `Form.tsx` takes one.
 *
 * The SEO keys arrive dotted (`seo.title`), and a dot is legal in an `id` but
 * not in the CSS selector `ErrorSummary`'s anchor resolves through, so they are
 * flattened here rather than at the call site.
 */
function fieldId(key: string): string {
  return `page-${key.replace(".", "-")}`;
}

export function PageForm({
  locale,
  page: initial,
  fetchedAt,
  mode,
}: {
  locale: string;
  page: Page | null;
  /**
   * When the server render that produced `page` happened, for §3.7's stale
   * marker. Absent on create, where there is no fetch and nothing that can age —
   * a blank object is exactly as old as the form around it.
   */
  fetchedAt?: number;
  mode: "edit" | "create";
}) {
  const t = useTranslations("content");
  const tStates = useTranslations("states");
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();

  const [page, setPage] = useState<Page>(initial ?? EMPTY_PAGE);
  const [draft, setDraft] = useState<Draft>(draftOf(initial ?? EMPTY_PAGE));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRename, setConfirmRename] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** A 409 the delete could not proceed through, kept on screen rather than toasted. */
  const [deleteBlock, setDeleteBlock] = useState<
    { kind: "children"; count: number } | { kind: "system"; option: string } | null
  >(null);

  /**
   * Where the keyboard goes when a confirm closes.
   *
   * The delete dialog is opened from a `Menu` item, which Radix unmounts the
   * moment it is selected — so the opener the overlay recorded is detached by
   * the time it would be focused, and focus lands on `<body>`. See
   * `useOpenerFocus` in `components/ui/Overlay.tsx` and DECISIONS.md §10.
   */
  const menuTriggerId = useId();

  const baseline = draftOf(page);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const offlineReason = online ? undefined : tStates("offlineWrites");

  /**
   * The address this save would produce.
   *
   * Assembled the way the API assembles it, and used **only** to warn. The API
   * resolves `parent_path` itself and answers a 400 on that field for a path
   * naming nothing — measured, rather than creating an orphan — so nothing here
   * decides whether a move is legal.
   */
  const nextPath = [draft.parent_path, draft.slug].filter((part) => part !== "").join("/");
  const addressChanged = mode === "edit" && nextPath !== page.path && draft.slug !== "";

  const FIELD_LABELS: Record<string, string> = {
    title: t("pages.field.title"),
    content: t("pages.field.body"),
    excerpt: t("pages.field.excerpt"),
    slug: t("pages.field.slug"),
    parent_path: t("pages.field.parentPath"),
    status: t("pages.field.status"),
    menu_order: t("pages.field.menuOrder"),
    "seo.title": t("pages.field.seoTitle"),
    "seo.description": t("pages.field.seoDescription"),
    "seo.canonical": t("pages.field.seoCanonical"),
  };

  /*
   * A 400 names **every** bad field at once, including ones this form does not
   * render. §3.4: an orphan is listed as *text* rather than as a link, because
   * there is nowhere to send the person and a link that goes nowhere is worse
   * than a line that does not claim to.
   */
  const failures: FormFailure[] = Object.entries(fieldErrors).map(([key, message]) => ({
    id: key in FIELD_LABELS ? fieldId(key) : undefined,
    label: FIELD_LABELS[key] ?? key,
    message,
  }));

  const body = () => ({
    title: draft.title,
    slug: draft.slug,
    parent_path: draft.parent_path,
    status: draft.status,
    content: draft.content,
    excerpt: draft.excerpt,
    menu_order: Number.parseInt(draft.menu_order, 10) || 0,
    seo: {
      title: draft.seoTitle,
      description: draft.seoDescription,
      canonical: draft.seoCanonical,
      robots: { index: draft.seoIndex, follow: draft.seoFollow },
    },
  });

  async function save() {
    setSaving(true);
    setFieldErrors({});
    setTopError(null);

    try {
      if (mode === "create") {
        const created = await acWrite<Page>("POST", "/cms/pages", body());
        toast.show(t("pages.created"));
        router.replace(`/${locale}/content/pages/${created.path}`);
        return;
      }

      const updated = await acWrite<Page>("PATCH", `/cms/pages/${page.path}`, body());

      /*
       * Re-seed from the response, never from the draft. `wp_kses` ran on the
       * way in, so what came back may be less than what went out — and an
       * editor still showing the unstored version is one where the stripped
       * markup silently returns on the next save.
       */
      setPage(updated);
      setDraft(draftOf(updated));
      toast.show(t("pages.saved"));

      // The address moved, so the screen's own URL is now stale. `replace`
      // rather than `push`: the old path is a 404 and must not be a back target.
      if (updated.path !== page.path) {
        router.replace(`/${locale}/content/pages/${updated.path}`);
      }
    } catch (error) {
      if (error instanceof BrowserApiError) {
        // Each named field binds to its own control; the summary at the top
        // links to them and carries the orphans as plain lines.
        const fields = error.fields ?? {};
        setFieldErrors(fields);
        /* A refusal with nothing per-field to say — a 500, a conflict, a dead
           network. Inline and standing, never a toast: §3.1 says an error a
           person must act on is not one. */
        if (Object.keys(fields).length === 0) setTopError(error.message);
      } else {
        throw error;
      }
    } finally {
      setSaving(false);
      setConfirmRename(false);
    }
  }

  async function remove(force: boolean) {
    setSaving(true);
    setDeleteBlock(null);
    setTopError(null);

    try {
      await acWrite("DELETE", `/cms/pages/${page.path}${force ? "?force=true" : ""}`);
      toast.show(t("pages.deleted"));
      router.replace(`/${locale}/content/pages`);
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 409) {
        const option = error.details.option;
        const children = error.details.children;

        if (typeof option === "string") {
          setDeleteBlock({ kind: "system", option });
        } else if (typeof children === "number") {
          setDeleteBlock({ kind: "children", count: children });
        } else {
          setTopError(error.message);
        }
        setConfirmDelete(false);
      } else if (error instanceof BrowserApiError) {
        setTopError(error.message);
        setConfirmDelete(false);
      } else {
        throw error;
      }
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /*
   * One item, and it is still a `Menu` rather than a bare button: §2.4 puts a
   * detail screen's record-state action in the header, §3.2 says row and header
   * actions are one menu rather than a row of buttons, and the create screen has
   * no such action at all — a lone destructive button in a header is a thing
   * people click by accident.
   */
  const deleteActions: MenuAction[] = [
    {
      key: "delete",
      label: t("pages.delete"),
      icon: "trash" as const,
      destructive: true,
      disabled: offlineReason !== undefined,
      onSelect: () => setConfirmDelete(true),
    },
  ];

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={mode === "create" ? t("pages.newTitle") : draft.title || t("pages.untitled")}
        back={{ href: `/${locale}/content/pages`, label: t("section.pages") }}
        /* A detail page omits the rule and lets the first card do the
           separating — §2.4. */
        divided={false}
        actions={
          mode === "edit" ? (
            <Menu
              label={t("pages.actions")}
              align="end"
              actions={deleteActions}
              trigger={
                <IconButton
                  id={menuTriggerId}
                  label={t("pages.actions")}
                  icon="more"
                  variant="secondary"
                  disabled={saving}
                />
              }
            />
          ) : undefined
        }
      />

      <PageBody width="form">
        <div className="flex flex-col gap-4">
          {/*
            §3.7's fifth state. This screen holds a record fetched once on the
            server and then edits it in the browser, so what is on screen can
            outlive the fetch that produced it — and the half of the rule that
            does the real work has something to disable here: the save bar and
            the delete item both go off with this same reason.
          */}
          {!online && fetchedAt !== undefined ? (
            <StaleBanner time={formatWhen(new Date(fetchedAt).toISOString(), locale)} />
          ) : null}

          <ErrorSummary failures={failures} />

          {topError !== null ? (
            <Notice role="alert" tone="danger" title={tStates("errorTitle")}>
              <p className="text-ui-label">{topError}</p>
            </Notice>
          ) : null}

          {/*
            The two delete refusals, each in its own words. `system` is a dead
            end this screen cannot open — the fix is in the shop's settings — so
            it offers nothing; `children` is a consequence, and its own
            confirmation is raised below once the count is known.
          */}
          {deleteBlock?.kind === "system" ? (
            <Notice role="alert" tone="warning" title={t("pages.deleteBlockedTitle")}>
              <p className="text-ui-label">
                {t("pages.deleteSystem", { option: deleteBlock.option })}
              </p>
            </Notice>
          ) : null}

          <Card title={t("pages.group.content")}>
            <div className="flex flex-col gap-4">
              <TextField
                id={fieldId("title")}
                label={t("pages.field.title")}
                value={draft.title}
                onChange={(value) => set("title", value)}
                error={fieldErrors.title}
              />
              <TextArea
                id={fieldId("content")}
                label={t("pages.field.body")}
                value={draft.content}
                onChange={(value) => set("content", value)}
                error={fieldErrors.content}
                rows={10}
                hint={t("pages.field.bodyHint")}
              />
              <TextArea
                id={fieldId("excerpt")}
                label={t("pages.field.excerpt")}
                value={draft.excerpt}
                onChange={(value) => set("excerpt", value)}
                error={fieldErrors.excerpt}
                rows={3}
                hint={t("pages.field.excerptHint")}
              />
            </div>
          </Card>

          <Card title={t("pages.group.address")} footnote={t("pages.group.addressNote")}>
            <div className="flex flex-col gap-4">
              <TextField
                id={fieldId("slug")}
                label={t("pages.field.slug")}
                value={draft.slug}
                onChange={(value) => set("slug", value)}
                error={fieldErrors.slug}
                isolate
                hint={t("pages.field.slugHint")}
              />
              <TextField
                id={fieldId("parent_path")}
                label={t("pages.field.parentPath")}
                value={draft.parent_path}
                onChange={(value) => set("parent_path", value)}
                error={fieldErrors.parent_path}
                isolate
                placeholder={t("pages.field.parentPathPlaceholder")}
                hint={t("pages.field.parentPathHint")}
              />
              {mode === "edit" ? (
                <ReadOnlyField
                  label={t("pages.field.currentPath")}
                  value={<Ltr numeric={false}>/{page.path}</Ltr>}
                  reason={t("pages.field.currentPathReason")}
                />
              ) : null}

              {/*
                The warning, and it is on the form rather than only in the
                confirmation. Somebody typing in the slug field should see the
                consequence while they are typing it, not once they have decided
                to save.
              */}
              {addressChanged ? (
                <Notice tone="warning" title={t("pages.renameWarningTitle")}>
                  <p className="text-ui-label">{t("pages.renameWarning")}</p>
                  <p className="text-ui-label">
                    <Ltr numeric={false}>/{page.path}</Ltr>
                    {" → "}
                    <Ltr numeric={false}>/{nextPath}</Ltr>
                  </p>
                </Notice>
              ) : null}
            </div>
          </Card>

          <Card title={t("pages.group.publishing")}>
            <div className="flex flex-col gap-4">
              <Select<ContentStatus>
                id={fieldId("status")}
                label={t("pages.field.status")}
                value={draft.status}
                onChange={(value) => set("status", value)}
                options={CONTENT_STATUSES.map((value) => ({
                  value,
                  label: t(`status.${value}`),
                }))}
                error={fieldErrors.status}
                hint={draft.status === "draft" ? t("pages.field.statusDraftHint") : undefined}
              />
              {/*
                `menu_order` ships, and the positive control is on this screen
                rather than in the ledger: the form re-seeds from the PATCH
                response, so a value the API refused to store reads back as what
                it stored. Nothing in the panel *displays* the ordering — it is
                the storefront's menu — which is why the hint says what it is for
                rather than leaving somebody to guess from a number that appears
                to do nothing here.
              */}
              <NumberField
                id={fieldId("menu_order")}
                name="menu_order"
                label={t("pages.field.menuOrder")}
                value={draft.menu_order}
                onChange={(value) => set("menu_order", value)}
                error={fieldErrors.menu_order}
                hint={t("pages.field.menuOrderHint")}
              />
              {mode === "edit" ? (
                <ReadOnlyField
                  label={t("pages.field.modified")}
                  value={<Isolate>{formatWhen(page.date_modified, locale)}</Isolate>}
                />
              ) : null}
            </div>
          </Card>

          {/*
            SEO is written through the page's own PATCH — there is no SEO endpoint
            and §89 does not add one — so it is a card of this form rather than a
            screen of its own, and its errors arrive in the same `details.fields`
            list as everything above.
          */}
          <Card title={t("pages.group.seo")} footnote={t("pages.group.seoNote")}>
            <div className="flex flex-col gap-4">
              <TextField
                id={fieldId("seo.title")}
                label={t("pages.field.seoTitle")}
                value={draft.seoTitle}
                onChange={(value) => set("seoTitle", value)}
                error={fieldErrors["seo.title"]}
                placeholder={page.seo.title}
                hint={t("pages.field.derivedHint")}
              />
              <TextArea
                id={fieldId("seo.description")}
                label={t("pages.field.seoDescription")}
                value={draft.seoDescription}
                onChange={(value) => set("seoDescription", value)}
                error={fieldErrors["seo.description"]}
                placeholder={page.seo.description}
                rows={2}
                hint={t("pages.field.derivedHint")}
              />
              <TextField
                id={fieldId("seo.canonical")}
                label={t("pages.field.seoCanonical")}
                value={draft.seoCanonical}
                onChange={(value) => set("seoCanonical", value)}
                error={fieldErrors["seo.canonical"]}
                isolate
                hint={t("pages.field.seoCanonicalHint")}
              />
              <Switch
                label={t("pages.field.seoIndex")}
                checked={draft.seoIndex}
                onChange={(value) => set("seoIndex", value)}
                hint={t("pages.field.seoIndexHint")}
              />
              <Switch
                label={t("pages.field.seoFollow")}
                checked={draft.seoFollow}
                onChange={(value) => set("seoFollow", value)}
                hint={t("pages.field.seoFollowHint")}
              />
            </div>
          </Card>

          {/*
            **Create**: there is nothing to compare a blank object against, so
            "unsaved changes" is the wrong frame and the bar carries no discard.
            The back link is the way out.
          */}
          <SaveBar
            dirty={dirty}
            persistent={mode === "create"}
            saving={saving}
            /* The rename confirmation is raised *here*, before the request,
               because it is a decision and not a result. */
            onSave={() => (addressChanged ? setConfirmRename(true) : void save())}
            onDiscard={
              mode === "edit"
                ? () => {
                    setDraft(draftOf(page));
                    setFieldErrors({});
                    setTopError(null);
                  }
                : undefined
            }
            saveLabel={mode === "create" ? t("create") : undefined}
            blockedReason={offlineReason}
          />
        </div>
      </PageBody>

      <ConfirmDialog
        open={confirmRename}
        onOpenChange={setConfirmRename}
        title={t("pages.renameConfirmTitle")}
        /*
         * `tone="primary"`, and no typed identifier. §3.1 reserves both for an
         * irreversible act; a rename is undone by renaming back. What it does
         * cost is every existing link to the old address, which is why it is
         * confirmed at all — and the body names both paths so the decision is
         * made against the actual strings rather than against a description.
         */
        tone="primary"
        body={
          <>
            <p>{t("pages.renameConfirmBody")}</p>
            <p className="mt-2">
              <Ltr numeric={false}>/{page.path}</Ltr>
              {" → "}
              <Ltr numeric={false}>/{nextPath}</Ltr>
            </p>
          </>
        }
        confirmLabel={t("pages.renameConfirmAction")}
        loading={saving}
        /*
         * No `returnFocusTo`. This dialog is raised from the save bar's own
         * button, which stays mounted throughout — so `useOpenerFocus`'s recorded
         * opener is still there and still correct. The prop exists for the
         * `Menu`-item case below, where Radix unmounts the item on select.
         */
        onConfirm={() => void save()}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("pages.deleteConfirmTitle")}
        /*
         * **Named, not typed**, and that is §3.1 as amended on the shipping
         * branch rather than a relaxation of it. The rule asks for the record's
         * identifier to be typed for an **irreversible** act; `DELETE
         * /cms/pages/{path}` is the *trash* — `lib/cms.ts` records that as the
         * reason `?status=any` never returns one — and the body below says so in
         * as many words. Demanding a typed path against copy that promises
         * recoverability would be a guard arguing with its own dialog, and it is
         * how typing becomes something people do without reading. What the rule
         * asks for unconditionally is that the record be named in human terms,
         * and a page's human name is its address.
         */
        body={
          <>
            <p>
              <Ltr numeric={false}>/{page.path}</Ltr>
            </p>
            <p className="mt-2">{t("pages.deleteConfirmBody")}</p>
          </>
        }
        confirmLabel={t("pages.delete")}
        loading={saving}
        returnFocusTo={menuTriggerId}
        onConfirm={() => void remove(false)}
      />

      {/*
        The forced delete is its own confirmation with its own wording, raised
        only after the API has refused once and said how many children it would
        reparent. Offering "delete anyway" before the count is known would be
        offering a consequence nobody can see.

        **It does not ask for the path again.** The typed guard was met one
        dialog ago in the same uninterrupted flow, and asking twice for the same
        string is how a guard becomes something people type without reading.
      */}
      <ConfirmDialog
        open={deleteBlock?.kind === "children"}
        onOpenChange={(open) => {
          if (!open) setDeleteBlock(null);
        }}
        title={t("pages.deleteForceTitle")}
        body={
          deleteBlock?.kind === "children" ? (
            <Isolate numeric>{t("pages.deleteForceBody", { count: deleteBlock.count })}</Isolate>
          ) : (
            ""
          )
        }
        confirmLabel={t("pages.deleteForceAction")}
        loading={saving}
        returnFocusTo={menuTriggerId}
        onConfirm={() => void remove(true)}
      />
    </div>
  );
}
