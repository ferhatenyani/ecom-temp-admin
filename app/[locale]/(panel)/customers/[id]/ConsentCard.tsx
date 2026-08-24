import { getTranslations } from "next-intl/server";
import type { CustomerDetail } from "@/lib/api/schemas/customer";
import { consentRecord } from "@/lib/customers";
import { formatDate } from "@/lib/format/date";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Isolate } from "@/components/primitives/Ltr";

/**
 * May the shop e-mail this person?
 *
 * ## The row the specification could not have been built from
 *
 * `ADMIN_PANEL.md:1827-1830` asked for a read-only row "with the date and the
 * reason it cannot be changed here". When that branch started there was **no
 * date**: the payload carried a bare `marketing_consent: false`, the refusal was
 * the generic `"Unknown field."`, and 0 of 16 customers had ever consented, so
 * the affirmative state could not be seen at all. All three were fixed in the API
 * rather than worked around here, because the question this card answers is one a
 * shop can be asked to evidence.
 *
 * ## Read-only, and the reason is the part that stops the bug report
 *
 * `marketing_consent` is **refused on PATCH by design** — consent is the
 * customer's to give — so this is a value with a stated reason rather than a
 * disabled toggle. ADMIN_PANEL.md notes that a disabled toggle with no
 * explanation gets raised as a bug every few months, and the reason names the
 * shopper's own route rather than saying "not editable": a staff member who needs
 * this changed has to tell the customer where to do it.
 *
 * `Card`'s `footnote` carries it rather than `Form.tsx`'s `ReadOnlyField`, and
 * that is the primitive choosing itself: `ReadOnlyField` exists to sit in the
 * middle of a stack of *editable* fields and line up with them, and its own
 * docblock says the aside's label/value list is `DataRow`'s job. There is no form
 * on this screen for it to line up with.
 *
 * ## Three states, and the two negatives are not the same answer
 *
 * A bare `false` collapses "they said no" into "we never asked", and the second
 * is the one that changes what a shop should do next. Rendered even when the
 * answer is no, because "no" is the operationally important state and hiding it
 * makes a declined customer indistinguishable from a card that failed to load.
 */
export async function ConsentCard({
  customer,
  locale,
}: {
  customer: CustomerDetail;
  locale: string;
}) {
  const t = await getTranslations("customers");
  const consent = consentRecord(customer);

  const answer =
    consent.state === "granted"
      ? t("consent.granted")
      : consent.state === "withdrawn"
        ? t("consent.withdrawn")
        : t("consent.never");

  return (
    <Card title={t("section.consent")} footnote={t("consent.reason")}>
      <DataList>
        {/*
          The row's label is the *question*, not the section's own title again.
          Rendered otherwise, the card read "Consentement marketing" as its
          heading and "Consentement marketing" again as the first row's label an
          inch apart — invisible in the source because the two strings come from
          different keys.

          `stacked`, because the question is a sentence: side by side it would
          take three lines at 340px and push its own answer off the baseline.
        */}
        <DataRow label={t("consent.question")} stacked>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span>{answer}</span>
            {consent.state !== "never" ? (
              /* A translated fragment carrying an `Intl` date — `Isolate`, so
                 each locale is laid out the way its own formatter intended. */
              <span className="text-ui-label text-ui-muted">
                <Isolate>{t("consent.on", { date: formatDate(consent.at, locale, false) })}</Isolate>
              </span>
            ) : null}
          </span>
        </DataRow>

        {consent.state !== "never" && consent.source !== null ? (
          <DataRow label={t("consent.sourceLabel")}>
            {/*
              **A source the panel has no name for renders as itself.** The three
              known values are a convention among the backend's own writers, not
              a contract: `Consent::set()` stores whatever string it is handed
              with no validation. The schema used to `z.enum` them, the campaigns
              seed passed `"seed"`, and `GET /customers/{id}` stopped parsing — on
              the server, so the whole detail rendered as "This page couldn't
              load" over one label on one row. See lib/api/schemas/customer.ts.
            */}
            {t.has(`consent.source.${consent.source}`)
              ? t(`consent.source.${consent.source}`)
              : consent.source}
          </DataRow>
        ) : null}
      </DataList>

      {consent.state === "never" ? (
        /* Not a row: it qualifies the answer above rather than being a second
           label/value pair, and "no record at all" is the state that most needs
           a sentence. */
        <p className="mt-2 text-ui-label text-ui-muted">{t("consent.neverDetail")}</p>
      ) : null}
    </Card>
  );
}
