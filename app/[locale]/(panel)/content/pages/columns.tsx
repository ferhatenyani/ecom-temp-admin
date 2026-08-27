"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { PageRow } from "@/lib/api/schemas/cms";
import { pageDepth } from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Icon } from "@/components/primitives/Icon";
import { Badge } from "@/components/ui/Badge";
import type { Column } from "@/components/ui/DataTable";

/**
 * The Pages column definition — one source, two presentations.
 *
 * Replaces `PageRow.tsx`, which drew one iOS inset row at every width. Its four
 * editorial decisions are carried over below unchanged, because each of them is
 * a measurement rather than a layout choice:
 *
 *   **`decodeEntities` on every title.** WordPress texturizes what it stores —
 *   measured, the apostrophe in `Soldes d'été` reads back as numeric character
 *   reference 8217 — so a title rendered raw prints the six literal characters
 *   of the entity instead of the apostrophe.
 *
 *   **The path is an identifier, so `Ltr`** — and `Ltr` around the *path*, never
 *   around the cell. A full-width cell wrapped in `Ltr` forces the cell's
 *   direction, which is how the analytics branch laid an Arabic row out from the
 *   wrong edge.
 *
 *   **Hierarchy is a leading indent, capped at two levels.** A page tree in this
 *   shop is `legal/conditions-generales` — one level — and an indent that grew
 *   without limit would push the title off a 340px row before it pushed anything
 *   useful onto it.
 *
 *   **A colliding row is not a link.** Two pages can carry the same path —
 *   `wp_unique_post_slug()` does not run for a draft — and a path is the only
 *   address `/cms/pages/{path}` has, so `get_page_by_path()` resolves one of
 *   them and the rest are unreachable. Measured before the seed cleaned this
 *   shop: 53 rows answered to `ac-unpublished` and 27 to `conditions`. A list
 *   that linked them all would be one where opening the fourteenth silently
 *   opens the first, and saving would write over somebody else's page.
 *
 * ## Status is a badge on the title, not a column
 *
 * The coupons argument, and it is stronger here. This index opens at
 * `?status=any`, so drafts sit among published pages and are otherwise
 * indistinguishable — and `publish` is most of the shop, so a "Publié" column
 * would be a column of one repeated word with the interesting value as the
 * exception. The badge marks the exception and the tab strip does the filtering.
 *
 * ## Nothing sorts, and no `aria-sort` is claimed
 *
 * `orderby` on this collection is **unmeasured** — not recorded as working and
 * not recorded as ignored. No column carries a `sortKey`, so the primitive puts
 * `aria-sort` on none of them, which is the products defect (DECISIONS.md §2)
 * avoided rather than repeated. `query.ts` names the measurement to take.
 *
 * ## Two fields deliberately have no column
 *
 * `parent_path` is the path minus its last segment — already on screen, twice
 * over once the indent is counted. `menu_order` is 0 on every page in this shop,
 * so a column would be a column of zeroes and a sort over it could not act.
 */

export type PageColumnContext = {
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  /**
   * The paths carried by more than one row, computed once for the whole list.
   *
   * It has to be a list-level fact: a row cannot know whether another row shares
   * its path, which is why this is passed in rather than derived in a cell.
   */
  collisions: Set<string>;
};

/** The indent, in `rem`, for a page filed under a parent. Capped at two levels. */
function indentOf(path: string): string | undefined {
  const depth = Math.min(pageDepth(path), 2);
  return depth > 0 ? `${depth * 0.75}rem` : undefined;
}

function TitleText({ page }: { page: PageRow }) {
  return (
    <span className="min-w-0 truncate" dir="auto">
      {decodeEntities(page.title)}
    </span>
  );
}

export function buildColumns(ctx: PageColumnContext): Column<PageRow>[] {
  const { locale, t, collisions } = ctx;

  return [
    {
      key: "title",
      header: t("pages.columns.title"),
      required: true,
      cell: (page) => {
        const colliding = collisions.has(page.path);

        return (
          <div className="flex min-w-0 flex-col gap-1">
            <div
              className="flex min-w-0 items-center gap-2"
              style={{ paddingInlineStart: indentOf(page.path) }}
            >
              {colliding ? (
                /* No anchor, and no clickable row either — see the docblock and
                   `rowClickable` in `PagesList`. The row still renders every
                   fact it has; what it does not do is offer a destination that
                   would open somebody else's page. */
                <span className="min-w-0 flex-1 text-ui-fg">
                  <TitleText page={page} />
                </span>
              ) : (
                /*
                 * A real anchor rather than a span in a clickable row: that is
                 * the keyboard path, the middle click and "open in new tab",
                 * none of which a `<div onClick>` has. It stops propagation so
                 * one click does not navigate twice.
                 *
                 * Deliberately only in the **table**. `RecordList` navigates
                 * through the stretched overlay button `DataTable` gives it, so
                 * a row is one anchor and not two — both presentations are in
                 * the DOM at every width.
                 */
                <Link
                  href={`/${locale}/content/pages/${page.path}`}
                  onClick={(event) => event.stopPropagation()}
                  className="ui-ring min-w-0 flex-1 rounded-ui-sm text-ui-fg hover:underline"
                >
                  <TitleText page={page} />
                </Link>
              )}

              {page.status === "draft" ? (
                <Badge tone="warning">{t("status.draft")}</Badge>
              ) : null}
            </div>

            {colliding ? (
              <span className="flex items-start gap-1.5 text-ui-caption text-ui-warning-fg">
                <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0">{t("pages.collision")}</span>
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "path",
      header: t("pages.columns.path"),
      cell: (page) => (
        <Ltr numeric={false} className="block min-w-0 truncate text-ui-muted">
          /{page.path}
        </Ltr>
      ),
    },
    {
      key: "modified",
      header: t("pages.columns.modified"),
      /* `Isolate`, never `Ltr`: a formatted date is not an identifier. ICU puts
         RTL marks inside the Arabic form on purpose and forcing `dir="ltr"` over
         them renders the date wrong — see primitives/Ltr.tsx. */
      cell: (page) => <Isolate>{formatWhen(page.date_modified, locale)}</Isolate>,
    },
    {
      key: "id",
      header: t("pages.columns.id"),
      align: "end",
      /*
       * Off by default. A page's quotable handle is its **path**, which is
       * already a column and is what a colleague would say down a phone; the
       * numeric id is machinery and only earns its place when somebody is
       * reading a URL or a log line.
       */
      optional: true,
      cell: (page) => <Ltr className="text-ui-subtle">{page.id}</Ltr>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is an editorial choice rather than "the first three columns", and
 * here it is the same three `PageRow` chose: the **title** to recognise it by,
 * the **path** because the path is the address every storefront link is built
 * on, and the **modified date** because on an index whose rows are otherwise
 * static that is the only thing that says which one somebody was last working
 * on.
 *
 * The collision warning rides on the second line rather than the first: the
 * first line is what identifies the row, and pushing an explanation into it
 * would truncate the title on the rows that most need reading.
 */
export function pageRecord(
  page: PageRow,
  ctx: PageColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { locale, t, collisions } = ctx;
  const colliding = collisions.has(page.path);

  return {
    primary: (
      <>
        <span
          className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg"
          dir="auto"
          style={{ paddingInlineStart: indentOf(page.path) }}
        >
          {decodeEntities(page.title)}
        </span>
        {page.status === "draft" ? <Badge tone="warning">{t("status.draft")}</Badge> : null}
      </>
    ),
    secondary: colliding ? (
      <span className="flex min-w-0 flex-1 items-start gap-1.5 text-ui-warning-fg">
        <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">{t("pages.collision")}</span>
      </span>
    ) : (
      <Ltr numeric={false} className="min-w-0 flex-1 truncate">
        /{page.path}
      </Ltr>
    ),
    meta: (
      <span className="ms-auto shrink-0 text-ui-compact text-ui-fg">
        <Isolate>{formatWhen(page.date_modified, locale)}</Isolate>
      </span>
    ),
  };
}
