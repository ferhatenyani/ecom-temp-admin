"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Page } from "@/lib/api/schemas/cms";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { CONTENT_STATUSES, type ContentStatus } from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import {
  ReadOnlyField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from "@/components/primitives/Field";
import { ActionSheet } from "@/components/primitives/ActionSheet";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * A page as a form — edit and create, one component.
 *
 * Three things here are not ordinary form work, and all three are measured.
 *
 * **A rename has no redirect, and the form says so before it saves.** `slug`
 * renames and `parent_path` moves; WordPress leaves nothing behind at the old
 * address, so every storefront link built on it becomes a 404 the moment the
 * save lands. `meta.path_changed: true` tells the panel afterwards — which is
 * too late to be a decision. So a changed address raises a confirmation naming
 * both paths, and the confirmation is the only place in this form that
 * interrupts.
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

export function PageForm({
  locale,
  page: initial,
  mode,
}: {
  locale: string;
  page: Page | null;
  mode: "edit" | "create";
}) {
  const t = useTranslations("content");
  const router = useRouter();
  const toast = useToast();

  const [page, setPage] = useState<Page>(initial ?? EMPTY_PAGE);
  const [draft, setDraft] = useState<Draft>(draftOf(initial ?? EMPTY_PAGE));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmRename, setConfirmRename] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** A 409 the delete could not proceed through, kept on screen rather than toasted. */
  const [deleteBlock, setDeleteBlock] = useState<
    | { kind: "children"; count: number; ids: number[] }
    | { kind: "system"; option: string }
    | null
  >(null);

  const baseline = draftOf(page);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

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
        // A 400 names **every** bad field at once, and each one binds to its own
        // control rather than collapsing into a line at the top.
        setFieldErrors(error.fields ?? {});
        toast.show(error.message, "danger");
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

    try {
      await acWrite("DELETE", `/cms/pages/${page.path}${force ? "?force=true" : ""}`);
      toast.show(t("pages.deleted"));
      router.replace(`/${locale}/content/pages`);
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 409) {
        /*
         * Two different 409s, and they are not the same refusal.
         *
         *   `details.children`  the page has children WordPress would promote to
         *                       the root, changing every one of their paths and
         *                       reporting nothing. `?force=true` means it, and
         *                       the API says so in its own message.
         *
         *   `details.option`    the page is registered as the shop's checkout,
         *                       privacy policy or similar. **Force does not
         *                       override this** — measured — because the fix is
         *                       to clear the setting, which is the decision
         *                       actually being made.
         */
        const option = error.details.option;
        const children = error.details.children;

        if (typeof option === "string") {
          setDeleteBlock({ kind: "system", option });
        } else if (typeof children === "number") {
          setDeleteBlock({
            kind: "children",
            count: children,
            ids: Array.isArray(error.details.child_ids)
              ? (error.details.child_ids as number[])
              : [],
          });
        } else {
          toast.show(error.message, "danger");
        }
        setConfirmDelete(false);
      } else if (error instanceof BrowserApiError) {
        toast.show(error.message, "danger");
      } else {
        throw error;
      }
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Scaffold
      title={mode === "create" ? t("pages.newTitle") : draft.title || t("pages.untitled")}
      back={{ href: `/${locale}/content/pages`, label: t("section.pages") }}
    >
      <div className="mx-auto max-w-3xl px-4">
        <ListGroup title={t("pages.group.content")}>
          <TextField
            label={t("pages.field.title")}
            value={draft.title}
            onChange={(value) => set("title", value)}
            error={fieldErrors.title}
          />
          <TextAreaField
            label={t("pages.field.body")}
            value={draft.content}
            onChange={(value) => set("content", value)}
            error={fieldErrors.content}
            rows={10}
            hint={t("pages.field.bodyHint")}
          />
          <TextAreaField
            label={t("pages.field.excerpt")}
            value={draft.excerpt}
            onChange={(value) => set("excerpt", value)}
            error={fieldErrors.excerpt}
            rows={3}
            hint={t("pages.field.excerptHint")}
          />
        </ListGroup>

        <ListGroup
          title={t("pages.group.address")}
          footnote={t("pages.group.addressNote")}
        >
          <TextField
            label={t("pages.field.slug")}
            value={draft.slug}
            onChange={(value) => set("slug", value)}
            error={fieldErrors.slug}
            isolate
            hint={t("pages.field.slugHint")}
          />
          <TextField
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
            consequence while they are typing it, not once they have decided to
            save.
          */}
          {addressChanged ? (
            <ListRow className="tone-warning tonal">
              <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 text-footnote">
                {t("pages.renameWarning")}
                <br />
                <Ltr numeric={false}>/{page.path}</Ltr>
                {" → "}
                <Ltr numeric={false}>/{nextPath}</Ltr>
              </span>
            </ListRow>
          ) : null}
        </ListGroup>

        <ListGroup title={t("pages.group.publishing")}>
          <SelectField<ContentStatus>
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
          <TextField
            label={t("pages.field.menuOrder")}
            value={draft.menu_order}
            onChange={(value) => set("menu_order", value)}
            error={fieldErrors.menu_order}
            inputMode="numeric"
            isolate
            hint={t("pages.field.menuOrderHint")}
          />
          {mode === "edit" ? (
            <ListValueRow
              label={t("pages.field.modified")}
              value={<Isolate>{formatWhen(page.date_modified, locale)}</Isolate>}
            />
          ) : null}
        </ListGroup>

        {/*
          SEO is written through the page's own PATCH — there is no SEO endpoint
          and §89 does not add one — so it is a section of this form rather than
          a screen of its own, and its errors arrive in the same
          `details.fields` list as everything above.
        */}
        <ListGroup title={t("pages.group.seo")} footnote={t("pages.group.seoNote")}>
          <TextField
            label={t("pages.field.seoTitle")}
            value={draft.seoTitle}
            onChange={(value) => set("seoTitle", value)}
            error={fieldErrors["seo.title"]}
            placeholder={page.seo.title}
            hint={t("pages.field.derivedHint")}
          />
          <TextAreaField
            label={t("pages.field.seoDescription")}
            value={draft.seoDescription}
            onChange={(value) => set("seoDescription", value)}
            error={fieldErrors["seo.description"]}
            rows={2}
            hint={t("pages.field.derivedHint")}
          />
          <TextField
            label={t("pages.field.seoCanonical")}
            value={draft.seoCanonical}
            onChange={(value) => set("seoCanonical", value)}
            error={fieldErrors["seo.canonical"]}
            isolate
            hint={t("pages.field.seoCanonicalHint")}
          />
          <SwitchField
            label={t("pages.field.seoIndex")}
            checked={draft.seoIndex}
            onChange={(value) => set("seoIndex", value)}
            hint={t("pages.field.seoIndexHint")}
          />
          <SwitchField
            label={t("pages.field.seoFollow")}
            checked={draft.seoFollow}
            onChange={(value) => set("seoFollow", value)}
            hint={t("pages.field.seoFollowHint")}
          />
        </ListGroup>

        {mode === "edit" ? (
          <ListGroup title={t("pages.group.danger")}>
            {deleteBlock?.kind === "system" ? (
              <ListRow className="tone-warning tonal">
                <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 text-footnote">
                  {t("pages.deleteSystem", { option: deleteBlock.option })}
                </span>
              </ListRow>
            ) : null}
            {deleteBlock?.kind === "children" ? (
              <ListRow className="tone-warning tonal">
                <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 text-footnote">
                  <Isolate numeric>
                    {t("pages.deleteChildren", { count: deleteBlock.count })}
                  </Isolate>
                </span>
              </ListRow>
            ) : null}
            <ListRow>
              <Button
                variant="plain"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
                className="tonal-fg tone-danger"
              >
                {t("pages.delete")}
              </Button>
            </ListRow>
          </ListGroup>
        ) : null}
      </div>

      {(dirty || mode === "create") ? (
        <div className="save-bar material-bar hairline-t fixed inset-x-0 z-20">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <Button
              variant="plain"
              onClick={() =>
                mode === "create"
                  ? router.push(`/${locale}/content/pages`)
                  : setDraft(draftOf(page))
              }
              disabled={saving}
              className="flex-1"
            >
              {mode === "create" ? t("cancel") : t("revert")}
            </Button>
            <Button
              variant="filled"
              // The rename confirmation is raised *here*, before the request,
              // because it is a decision and not a result.
              onClick={() => (addressChanged ? setConfirmRename(true) : void save())}
              loading={saving}
              className="flex-1"
            >
              {mode === "create" ? t("create") : t("save")}
            </Button>
          </div>
        </div>
      ) : null}

      <ActionSheet
        open={confirmRename}
        onOpenChange={setConfirmRename}
        title={t("pages.renameConfirmTitle")}
        description={t("pages.renameConfirmBody")}
        actions={[
          {
            label: t("pages.renameConfirmAction"),
            tone: "default",
            onSelect: () => void save(),
          },
        ]}
        cancelLabel={t("cancel")}
      />

      <ActionSheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("pages.deleteConfirmTitle")}
        description={t("pages.deleteConfirmBody")}
        actions={[
          {
            label: t("pages.delete"),
            tone: "destructive",
            onSelect: () => void remove(false),
          },
        ]}
        cancelLabel={t("cancel")}
      />

      {/*
        The forced delete is its own confirmation with its own wording, raised
        only after the API has refused once and said how many children it would
        reparent. Offering "delete anyway" before the count is known would be
        offering a consequence nobody can see.
      */}
      <ActionSheet
        open={deleteBlock?.kind === "children"}
        onOpenChange={(open) => !open && setDeleteBlock(null)}
        title={t("pages.deleteForceTitle")}
        description={
          deleteBlock?.kind === "children"
            ? t("pages.deleteForceBody", { count: deleteBlock.count })
            : ""
        }
        actions={[
          {
            label: t("pages.deleteForceAction"),
            tone: "destructive",
            onSelect: () => void remove(true),
          },
        ]}
        cancelLabel={t("cancel")}
      />
    </Scaffold>
  );
}
