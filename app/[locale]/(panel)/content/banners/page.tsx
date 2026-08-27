import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { bannerList } from "@/lib/api/schemas/cms";
import {
  CMS_LIST_PER_PAGE,
  DEFAULT_STATUS_FILTER,
  isStatusFilter,
  type StatusFilter,
} from "@/lib/cms";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { BannersList } from "./BannersList";

export default async function BannersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("content");

  if (!has(me, "ac_manage_content")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/*
          No back link here, deliberately. `/content` is guarded by the same
          capability, so the only place it could send this reader is another
          forbidden screen — the dashboard branch's rule that a control links
          only where its reader is not refused, reaching a back link.
        */}
        <PageHeader title={t("section.banners")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_content" />
        </PageBody>
      </div>
    );
  }

  /*
   * The status filter is resolved on the server as well as in the client, so
   * first paint is the list the URL asked for rather than the default one
   * replaced a frame later.
   *
   * **`any` is the default and is the value omitted from the URL**, which
   * inverts every other list in this panel. On `/cms/*` the absence of
   * `?status=` means *publish only*, so a screen that sent nothing would open
   * with every draft silently missing — and a draft is what somebody opens this
   * screen to finish. `lib/cms.ts` carries the measurement beside
   * `DEFAULT_STATUS_FILTER`.
   */
  const requested = typeof raw.status === "string" ? raw.status : "";
  const status: StatusFilter = isStatusFilter(requested) ? requested : DEFAULT_STATUS_FILTER;

  const initial = await acFetch(
    bannerList,
    session,
    `/cms/banners?per_page=${CMS_LIST_PER_PAGE}&status=${status}`,
  ).catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  /*
   * **`meta.total` is read here and it is not decoration.** The list asks for one
   * page of a hundred and there is no endpoint that can move a row across a page
   * boundary, so a collection larger than the page cannot be reordered at all —
   * see `reorderBlock()`. Both of these screens shipped fetching a hundred rows
   * and never asking how many there were.
   */
  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <BannersList
      locale={locale}
      initialStatus={status}
      initialBanners={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
    />
  );
}
