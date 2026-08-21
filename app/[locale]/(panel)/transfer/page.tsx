import { requireSession } from "@/lib/session/read";
import { has } from "@/lib/capabilities";
import { EXPORT_SUBJECTS, IMPORT_SUBJECTS, SUBJECT_CAPABILITY } from "@/lib/transfer";
import { TransferScreen } from "./TransferScreen";

/**
 * Import and export — **the one section of this branch a Manager can reach.**
 *
 * Settings, users and audit are `ac_manage_settings`, `ac_manage_users` and
 * `ac_view_audit_logs`, which after the two-tier collapse are the Super Admin
 * tier alone. This is not gated on any of them: **capability follows the
 * resource**, so `/export/products` is `ac_manage_products` and
 * `/export/customers` is `ac_manage_customers`, and the screen renders the
 * subjects the reader actually holds.
 *
 * Measured across four credentials, which is the strongest fixture set any
 * branch here has had:
 *
 *   Manager           403 on the other three subjects, **200 on all four
 *                     exports**. One credential, both halves of the branch.
 *   Support Agent     **200 on customers and 403 on the other three** — one
 *                     credential proving the rule is per subject, which no
 *                     single refusal can show.
 *   Marketing Manager 403 on all six.
 *
 * So there is no `ForbiddenState` for the screen as a whole. A reader holding
 * none of the four capabilities sees an empty screen that says so, and a reader
 * holding one sees one subject — which is the honest rendering of a gate that
 * is per row rather than per page.
 */
export default async function TransferPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { me } = await requireSession(locale);

  /*
   * Filtered on the server, from `/auth/me`'s capability list. This is a
   * rendering decision and never an access one — every route enforces its own
   * `permission_callback`, and the export proxy passes the API's 403 through
   * rather than pre-empting it.
   */
  const exportable = EXPORT_SUBJECTS.filter((subject) => has(me, SUBJECT_CAPABILITY[subject]));
  const importable = IMPORT_SUBJECTS.filter((subject) => has(me, SUBJECT_CAPABILITY[subject]));

  return <TransferScreen locale={locale} exportable={exportable} importable={importable} />;
}
