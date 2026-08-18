import { redirect } from "next/navigation";

/**
 * The panel root goes to Orders, which is the screen staff actually open. The
 * dashboard is a later branch.
 */
export default async function PanelIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/orders`);
}
