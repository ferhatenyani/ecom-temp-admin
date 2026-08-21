import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { mediaList } from "@/lib/api/schemas/media";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ForbiddenState } from "@/components/patterns/States";
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
 */
export default async function MediaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("media");

  if (!has(me, "ac_manage_content")) {
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_content" />
        </div>
      </Scaffold>
    );
  }

  const initial = await acFetch(mediaList, session, "/media?per_page=30&page=1").catch(
    (error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    },
  );

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <MediaLibrary
      initialItems={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
    />
  );
}
