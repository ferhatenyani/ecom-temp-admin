import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { MEDIA_PER_PAGE } from "@/lib/media";
import { mediaList } from "@/lib/api/schemas/media";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { MediaLibrary } from "./MediaLibrary";

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
 * uses. It takes no `searchParams`: `?peek=` is resolved in the browser against
 * the page already in memory, because `GET /media/{id}` is the list row exactly.
 */
export default async function MediaPage({
  params,
}: {
  /** A Promise in Next 16, like `searchParams` and `cookies()`. */
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
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

  const initial = await acFetch(
    mediaList,
    session,
    `/media?per_page=${MEDIA_PER_PAGE}&page=1`,
  ).catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <MediaLibrary
      locale={locale}
      initialItems={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
    />
  );
}
