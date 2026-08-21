"use client";

import { useTranslations } from "next-intl";
import { ROUND_TRIPS, type ExportSubject, type ImportSubject } from "@/lib/transfer";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState } from "@/components/patterns/States";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { Icon } from "@/components/primitives/Icon";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { ImportSection } from "./ImportSection";

/**
 * Exports out, imports in.
 *
 * **The download is a plain `<a>` at `/api/export/{subject}`**, not a `fetch`
 * into a blob. The navigation carries the session cookie, the server route
 * attaches the Application Password and streams the bytes through, and the
 * credential is never in the document — the same shape `/api/label/[id]` uses
 * for a courier's label, and the second of the two places ADMIN_PANEL.md says
 * the envelope client must be bypassed deliberately.
 *
 * `download` is deliberately **not** set on the anchor. The `Content-Disposition`
 * filename is the API's — `products-export-2026-08-21.csv` — and an empty
 * `download` attribute would let the browser use the URL's last segment instead,
 * which is the subject with no date on it.
 */
export function TransferScreen({
  locale,
  exportable,
  importable,
}: {
  locale: string;
  exportable: readonly ExportSubject[];
  importable: readonly ImportSubject[];
}) {
  const t = useTranslations("transfer");

  return (
    <Scaffold title={t("title")}>
      <div className="mx-auto max-w-3xl px-4">
        {exportable.length === 0 && importable.length === 0 ? (
          /*
            There is no `ForbiddenState` for this screen, because the gate is per
            subject rather than per page: a Support Agent is 200 on
            `/export/customers` and 403 on the other three, so "you may not open
            this" would be false for them. A reader holding none of the four
            capabilities gets an empty state that says which four they would need.
          */
          <EmptyState message={t("nothingPermitted")} />
        ) : null}

        {exportable.length > 0 ? (
          <ListGroup title={t("exportTitle")} footnote={t("exportNote")}>
            {exportable.map((subject) => (
              <ListRow key={subject} className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                  <span className="text-body text-label">{t(`subject.${subject}`)}</span>
                  <span className="flex flex-wrap items-center gap-2 text-caption text-label-secondary">
                    <span>{t(`exportRow.${subject}`)}</span>
                    {/*
                      **Stated per subject, because it is true per subject.** The
                      inventory export uses our own writer and our own field
                      names and re-imports as it stands; the products export
                      carries WooCommerce's display labels — `ID`, `SKU`, `GTIN,
                      UPC, EAN, or ISBN` — and its label-to-field table lives in
                      WooCommerce's admin importer, which this API does not load.
                      Measured: every row parses and every SKU resolves empty.
                      Promising a round trip the shop cannot complete is worse
                      than not offering one.
                    */}
                    {ROUND_TRIPS[subject] ? (
                      <StatusBadge tone="success">{t("roundTrips")}</StatusBadge>
                    ) : null}
                  </span>
                </span>

                <a
                  href={`/api/export/${subject}`}
                  className="tone-accent tonal press flex min-h-11 shrink-0 items-center gap-2 rounded-md px-4 text-body"
                  data-testid={`export-${subject}`}
                >
                  <Icon name="down" className="size-4" />
                  <span>{t("download")}</span>
                </a>
              </ListRow>
            ))}
          </ListGroup>
        ) : null}

        {/*
          The two facts about the file that a person opening it will otherwise
          find out from Excel. The BOM in particular reads as a defect when it
          is the opposite: without it an Arabic product name arrives as
          mojibake.
        */}
        {exportable.length > 0 ? (
          <p className="mb-8 px-1 text-caption text-label-tertiary">{t("bomNote")}</p>
        ) : null}

        {importable.map((subject) => (
          <ImportSection key={subject} subject={subject} />
        ))}

        {importable.length > 0 ? (
          <p className="mb-8 px-1 text-caption text-label-tertiary">{t("importSafety")}</p>
        ) : null}

        {/*
          Two subjects export and cannot import, and that is the API's shape
          rather than an omission here. Said once, so a reader looking for
          "import orders" learns why there is no such thing instead of concluding
          the screen is unfinished.
        */}
        {exportable.length > 0 ? (
          <p className="mb-8 px-1 text-caption text-label-tertiary" lang={locale}>
            {t("noImportFor")}
          </p>
        ) : null}
      </div>
    </Scaffold>
  );
}
