import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { has } from "@/lib/capabilities";
import { EXPORT_SUBJECTS, IMPORT_SUBJECTS, SUBJECT_CAPABILITY } from "@/lib/transfer";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
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
 * ## The three cases, and only one of them is a state
 *
 * **None of the four** is a real `ForbiddenState` naming all four capabilities,
 * and it used to be an `EmptyState` doing a forbidden's job — a lock-shaped
 * refusal wearing a search icon and offering nothing to ask for. §3.7-3 wants the
 * capability named and somebody to ask; the empty state could do neither.
 * `ForbiddenState` takes an array for this, which is the panel's only per-subject
 * gate and therefore the only screen that needs one.
 *
 * **Some of the four** is *not* a refusal and must not render as one: a Support
 * Agent is 200 on `/export/customers`, and telling them they may not open this
 * page would be false. They get the subjects they hold, plus one line saying the
 * gate is per subject — without it, a reader seeing a single row cannot tell the
 * panel from a bug.
 *
 * **All four** is the ordinary screen.
 *
 * Filtering happens here, on the server, from `/auth/me`'s capability list. It is
 * a rendering decision and never an access one — every route enforces its own
 * `permission_callback`, and the export proxy passes the API's 403 through rather
 * than pre-empting it.
 */
export default async function TransferPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { me } = await requireSession(locale);
  const t = await getTranslations("transfer");

  const exportable = EXPORT_SUBJECTS.filter((subject) => has(me, SUBJECT_CAPABILITY[subject]));
  const importable = IMPORT_SUBJECTS.filter((subject) => has(me, SUBJECT_CAPABILITY[subject]));

  if (exportable.length === 0 && importable.length === 0) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No back link: this is a top-level nav route, not a detail screen —
            §2.4. `divided={false}` because the first card closes the block. */}
        <PageHeader title={t("title")} divided={false} />
        <PageBody width="detail">
          <ForbiddenState
            capability={EXPORT_SUBJECTS.map((subject) => SUBJECT_CAPABILITY[subject])}
          />
        </PageBody>
      </div>
    );
  }

  return (
    <TransferScreen
      exportable={exportable}
      importable={importable}
      partial={exportable.length < EXPORT_SUBJECTS.length}
    />
  );
}
