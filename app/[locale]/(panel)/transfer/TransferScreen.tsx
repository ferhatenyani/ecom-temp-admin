"use client";

import { useTranslations } from "next-intl";
import { ROUND_TRIPS, type ExportSubject, type ImportSubject } from "@/lib/transfer";
import { useOnline } from "@/lib/use-online";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ImportSection } from "./ImportSection";

/**
 * Exports out, imports in. One screen, no data of its own.
 *
 * ## `width="detail"` (768), and it is chosen here rather than inherited
 *
 * §8 retires `max-w-3xl` **by name**, which is what this screen used to carry, so
 * the width had to be re-decided rather than converted. §2.3's table has no row
 * for a task screen: this is not a document you edit and save — it is *choose a
 * subject, run it, read the report* — so `width="form"` (640) would be the wrong
 * shape for it, and the preview rows are the widest thing on the page. 768 is the
 * single-column detail width and the one that fits a preview row of `line ·
 * action · sku · name · from → to` without wrapping every row twice.
 *
 * No back link — a top-level nav route, not a detail (§2.4). No primary action in
 * the header: there is nothing here to create.
 *
 * ## The four grey paragraphs at the foot of the page are gone
 *
 * `bomNote`, `importSafety`, `noImportFor` and `exportNote` used to stack under
 * everything, which is §11's dashboard defect — a caveat belongs on the card that
 * needs it, and only a reader-shaped one is a footnote. So: what an export *is*
 * became the export card's description, the two caveats about the exported bytes
 * became that card's footnote, the per-subject preconditions became the **hint on
 * the file field that has to satisfy them**, and the safety property became the
 * footnote of the card whose button writes. §18's rule — restraint applies to
 * words as much as to decoration.
 *
 * ## The five states
 *
 * **Empty ships one half only, and this is the sentence DESIGN.md §3.7-2's media
 * amendment asks a screen to point at**: "A screen whose controls cannot ships
 * one and says so in its own docblock." This screen holds no collection at all —
 * four fixed export rows and two import cards, no filter, no search, no sort, no
 * pager — so the *no-results* half has no control that could produce it. Nor is
 * the no-data half reachable: the rows are a constant, and the case that used to
 * render an `EmptyState` here (a reader holding none of the four capabilities) is
 * a **forbidden** state and is in `page.tsx`. If a control that can empty this
 * page is ever added, this paragraph is what has to be re-read.
 *
 * **Stale is decision 4 and it is half of §3.7-5.** No `StaleBanner`: the screen
 * holds no data, so there is no age to report and nothing that can drift from its
 * own fetch. But it *writes*, and the export is a real navigation that fails
 * offline — so the half of the rule that does the real work applies and every
 * write control is disabled with `states.offlineWrites` on its `title`. The
 * marker follows the data; the disable follows the writes. Amended in DESIGN.md
 * §3.7-5 on this branch.
 */
export function TransferScreen({
  exportable,
  importable,
  /** Holds some of the four capabilities but not all — see `page.tsx`. */
  partial,
}: {
  exportable: readonly ExportSubject[];
  importable: readonly ImportSubject[];
  partial: boolean;
}) {
  const t = useTranslations("transfer");
  const tStates = useTranslations("states");
  const online = useOnline();
  const offlineReason = online ? undefined : tStates("offlineWrites");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        /*
          Only when the gate has actually bitten. A reader holding all four is
          told nothing, because for them there is nothing to explain; a Support
          Agent seeing one export row would otherwise have no way to tell a
          working panel from a broken one.
        */
        subtitle={partial ? t("perSubject") : undefined}
        divided={false}
      />

      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          {exportable.length > 0 ? (
            <Card
              title={t("exportTitle")}
              description={t("exportNote")}
              footnote={
                /*
                  Two caveats about the file, both on the card that produces it.
                  `<span className="block">` rather than `<p>`: `Card` already
                  wraps the footnote in a paragraph, and a `<p>` inside a `<p>`
                  is closed by the parser before it is styled.
                */
                <>
                  <span className="block">{t("bomNote")}</span>
                  <span className="mt-1.5 block">{t("noImportFor")}</span>
                </>
              }
            >
              {/*
                Four fixed rows, and deliberately **not** a `DataTable`. They
                never sort, filter or page, and §3.2's table is for collections —
                a table here would invite operations the data does not have,
                which is §5's customers-statistics reasoning. There is no
                `aria-sort` anywhere on this screen.
              */}
              <ul className="flex min-w-0 flex-col">
                {exportable.map((subject) => (
                  <li
                    key={subject}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ui-line py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-ui-body text-ui-fg">{t(`subject.${subject}`)}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-ui-label text-ui-muted">
                        <span className="min-w-0">{t(`exportRow.${subject}`)}</span>
                        {/*
                          **Stated per subject, because it is true per subject** —
                          and for products it became true only with
                          `fix/product-export-field-names`: the export writes
                          field names now, and a 33-product file re-imports as
                          `updated: 33, failed: 0`. `lib/transfer.ts:106-139`
                          carries the measurement.

                          `orders` and `customers` carry no badge, and that is a
                          different fact rather than a weaker one: they have no
                          importer at all, which the card's footnote says once.
                        */}
                        {ROUND_TRIPS[subject] ? (
                          <Badge tone="success">{t("roundTrips")}</Badge>
                        ) : null}
                      </p>
                    </div>

                    {/*
                      A real link, so middle-click and "open in new tab" work and
                      the credential is attached server-side — never in the
                      document. `prefetch={false}` because the target is a Route
                      Handler streaming a file, not a page with an RSC payload:
                      prefetching it would download the whole export on hover.

                      **Driven in Chromium before it was written**, because no
                      test had ever proved `ButtonLink` downloads: both existing
                      e2e download assertions went through this screen's retired
                      plain `<a>`, while four migrated screens already used
                      `ButtonLink` for exactly this. Measured on the shipped
                      products list — `next/link` falls through to a document
                      navigation for a non-RSC response, the download event fires,
                      and the file arrives as `products-export-2026-08-18.csv`
                      with a real `EF BB BF` and a header row.

                      `download` stays unset. The `Content-Disposition` filename
                      is the API's — `products-export-2026-08-21.csv` — and an
                      empty `download` attribute would let the browser use the
                      URL's last segment instead, which is the subject with no
                      date on it.

                      Disabled offline with the reason: this genuinely leaves the
                      page, and a navigation to a route that cannot answer
                      replaces the panel with the browser's own error page.
                    */}
                    <ButtonLink
                      href={`/api/export/${subject}`}
                      variant="secondary"
                      icon="download"
                      prefetch={false}
                      disabled={!online}
                      title={offlineReason}
                      data-testid={`export-${subject}`}
                    >
                      {t("download")}
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {importable.map((subject) => (
            <ImportSection key={subject} subject={subject} online={online} />
          ))}
        </div>
      </PageBody>
    </div>
  );
}
