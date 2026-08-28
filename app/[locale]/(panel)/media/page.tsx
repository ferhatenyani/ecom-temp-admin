import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { mediaList } from "@/lib/api/schemas/media";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { MediaLibrary } from "./MediaLibrary";
import { listParams, queryFromParams } from "./query";

/**
 * The media library.
 *
 * `ac_manage_content` guards the **reads** as well as the writes, and that is
 * the gap ADMIN_PANEL.md's Media section documents rather than a bug: a Product
 * Manager deliberately cannot upload, but the same capability governs `GET
 * /media`, so the "attach an image that already exists" path the backend
 * describes as theirs cannot be reached either. Measured — a Manager is 403 on
 * `GET /media` — which makes one live credential a real forbidden fixture for
 * this screen and for the picker inside every form that embeds it.
 *
 * A Server Component fetches page one with the sealed credential and streams it,
 * so first paint carries data — the arrangement every other list in this panel
 * uses.
 *
 * **It reads `searchParams` now, which it did not before.** The screen grew a
 * search box and a sort control on the branch that measured both, so a shared
 * `/media?search=tapis` has to paint the searched library rather than paint the
 * whole one and flip to it a moment later. `?peek=` is still resolved in the
 * browser — `GET /media/{id}` is the list row exactly, so the drawer costs no
 * server work — and the page number is still local state, because it is not a
 * view anybody links to. See `query.ts`.
 */
export default async function MediaPage({
  params,
  searchParams,
}: {
  /** A Promise in Next 16, like `searchParams` and `cookies()`. */
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("media");

  if (!has(me, "ac_manage_content")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No subtitle, so `media-count` is absent rather than reporting a total
            nobody was allowed to read — and no back link, because every route
            that could receive one is gated on the capability just refused. */}
        <PageHeader title={t("title")} />
        <PageBody width="full">
          <ForbiddenState capability="ac_manage_content" />
        </PageBody>
      </div>
    );
  }

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }
  const query = queryFromParams(incoming);

  const initial = await acFetch(
    mediaList,
    session,
    `/media?${listParams(query, 1)}`,
  ).catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <MediaLibrary
      locale={locale}
      initialQuery={query}
      initialItems={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
    />
  );
}
