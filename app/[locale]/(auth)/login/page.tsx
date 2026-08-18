import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session/read";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { locale } = await params;
  const { reason } = await searchParams;

  // Already signed in, and the credential still works: there is nothing to do
  // here.
  if (reason === undefined && (await readSession())) {
    redirect(`/${locale}/orders`);
  }

  const t = await getTranslations("login");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <h1 className="px-4 text-large-title text-label">{t("title")}</h1>
      <p className="mt-2 mb-8 px-4 text-subhead text-label-secondary">{t("intro")}</p>
      <LoginForm locale={locale} reason={reason} />
    </main>
  );
}
