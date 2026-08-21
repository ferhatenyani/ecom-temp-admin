import { useTranslations } from "next-intl";
import type { PageRow as PageRowData } from "@/lib/api/schemas/cms";
import { pageDepth } from "@/lib/cms";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";

/**
 * One page in the index.
 *
 * Three things on it and each earns its place: the **title** to recognise it by,
 * the **path** because the path is the address every storefront link is built
 * on, and the **status** because a draft looks exactly like a published page
 * otherwise.
 *
 * `decodeEntities` on the title, not decoration. WordPress texturizes what it
 * stores — measured, the apostrophe in `Soldes d'été` reads back as numeric
 * character reference 8217 — so a title rendered raw prints the six literal
 * characters of the entity on screen instead of the apostrophe. Same
 * class as README's note about `timeline[].summary`.
 *
 * The path is an identifier, so `Ltr`, and `Ltr` around the **path itself**
 * rather than around the row: a full-width cell wrapped in `Ltr` forces the
 * cell's direction, which is how the analytics branch laid an Arabic row out
 * from the wrong edge.
 */
export function PageRow({
  page,
  locale,
  /** True when another row carries the same path. See `collidingPaths()`. */
  colliding = false,
}: {
  page: PageRowData;
  locale: string;
  colliding?: boolean;
}) {
  const t = useTranslations("content");
  const depth = pageDepth(page.path);

  return (
    <span className="flex min-w-0 flex-col gap-1 py-1">
      <span className="flex items-center gap-2">
        {/*
          Hierarchy as a leading indent, capped at two levels' worth. A page tree
          in this shop is `legal/conditions-generales` — one level — and an
          indent that grew without limit would push the title off a 390px row
          before it pushed anything useful onto it.
        */}
        {depth > 0 ? (
          <span
            aria-hidden="true"
            className="shrink-0 text-label-tertiary"
            style={{ paddingInlineStart: `${Math.min(depth, 2) * 0.75}rem` }}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-body text-label" dir="auto">
          {decodeEntities(page.title)}
        </span>
        {page.status === "draft" ? (
          <StatusBadge tone="warning">{t("status.draft")}</StatusBadge>
        ) : null}
      </span>

      <span className="flex items-center gap-2 text-footnote text-label-secondary">
        <Ltr numeric={false} className="min-w-0 truncate">
          /{page.path}
        </Ltr>
        <Isolate className="ms-auto shrink-0">
          {formatWhen(page.date_modified, locale)}
        </Isolate>
      </span>

      {/*
        The duplicate-path warning.

        Two pages can carry the same path — `wp_unique_post_slug()` does not run
        for a draft — and a path is the only address `/cms/pages/{path}` has, so
        `get_page_by_path()` resolves one of them and the rest are unreachable.
        Measured before the seed cleaned this shop: 53 rows answered to
        `ac-unpublished` and 27 to `conditions`.

        A list that linked them all would be one where opening the fourteenth
        silently opens the first, and saving would write over somebody else's
        page. So the row says so and the list does not link it.
      */}
      {colliding ? (
        <span className="tone-warning tonal-fg flex items-start gap-1.5 text-caption">
          <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{t("pages.collision")}</span>
        </span>
      ) : null}
    </span>
  );
}
