import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { bannerList } from "@/lib/api/schemas/cms";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ForbiddenState } from "@/components/patterns/States";
import { BannersList } from "./BannersList";

export default async function BannersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);

  if (!has(me, "ac_manage_content")) {
    const t = await getTranslations("content");
    return (
      <Scaffold title={t("section.banners")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_content" />
        </div>
      </Scaffold>
    );
  }

  /*
   * `?status=any`, not the default. This route's default is `publish`, so a list
   * asking for nothing would silently hide every drafted banner — and a drafted
   * banner is one somebody is part-way through writing, which is exactly what
   * they came here to finish.
   */
  const initial = await acFetch(
    bannerList,
    session,
    "/cms/banners?per_page=100&status=any",
  ).catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  return <BannersList locale={locale} initialBanners={initial?.data ?? null} />;
}
