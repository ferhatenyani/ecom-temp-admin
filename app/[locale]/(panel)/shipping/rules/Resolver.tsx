"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";
import { applicableRules, ruleScope } from "@/lib/shipping";
import { SHOP_CURRENCY, formatMoney } from "@/lib/format/money";
import type { ShippingRate, ShippingRule } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/States";
import { Select } from "@/components/ui/Form";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Isolate, Ltr } from "@/components/primitives/Ltr";

type Commune = { id: number; name: string; name_ar: string };

/**
 * The tariff's own resolution — and it is why the editor exists.
 *
 * **A rules table that does not resolve is a table people misconfigure.** Three
 * rows of numbers with no way to ask "so what does Oran cost?" is a spreadsheet;
 * the whole value of the screen beside this one is being able to check what it
 * does before a customer finds out.
 *
 * Two answers are shown, deliberately, and they come from different places. The
 * panel resolves **locally** so the preview updates as the pickers move, and
 * `GET /shipping/rates` is queried for the same destination because **it is the
 * authority**. They agreed on all three fixtures — 350 / 500 / 800 — and when
 * they disagree the screen says so in a `Notice` rather than quietly preferring
 * its own answer. A disagreement is a real possibility rather than a defensive
 * hypothetical: an inactive rule, a courier quote, or a rule written from another
 * tab since this page loaded.
 *
 * ## The answer area is an empty state, not a disabled control
 *
 * `GET /shipping/rates` **400s without both parameters** — measured, and its
 * `details.params` arrives as a bare array of names rather than an object of
 * messages, which is the shape `lib/api/errors.ts` now declines to read as
 * messages. So there is nothing to send until both pickers are set, and the
 * honest rendering of "nothing to send yet" is a sentence saying what to do, not
 * a greyed-out button implying the request is one click away.
 *
 * The commune picker *is* disabled until a wilaya is chosen, and that is a
 * different thing: a commune list is fetched per wilaya, so there is genuinely
 * nothing to choose from, and the hint beside it says which.
 */
export function Resolver({
  rules,
  wilayas,
  locale,
  placeOf,
}: {
  /** Server-fetched, so a save upstream reaches this through `router.refresh()`. */
  rules: ShippingRule[];
  wilayas: Wilaya[];
  locale: string;
  /**
   * How a rule's destination is named, supplied by the screen rather than
   * re-derived here — so the winner and the rules it beat carry exactly the
   * words the list beside them uses, down to the commune name, and one commune
   * lookup serves both.
   */
  placeOf: (rule: ShippingRule) => string;
}) {
  const t = useTranslations("shipping");
  const tScope = useTranslations("ruleScope");
  const tStates = useTranslations("states");

  const [wilayaId, setWilayaId] = useState("");
  const [communeId, setCommuneId] = useState("");

  const money = (value: string) => formatMoney(value, SHOP_CURRENCY, locale);
  const wilayaName = (w: Wilaya) => (locale === "ar" && w.name_ar !== "" ? w.name_ar : w.name);

  /* The commune list for the chosen wilaya — public on the API, and the reason
     `/locations/wilayas/{id}/communes` is on the allowlist at all. */
  const communes = useQuery({
    queryKey: ["communes", wilayaId],
    enabled: wilayaId !== "",
    queryFn: () => acRead<Commune[]>(`/locations/wilayas/${wilayaId}/communes?per_page=100`),
  });

  /*
   * The server's own answer, re-requested per selection — which is also why this
   * screen carries no stale marker: nothing here can be older than the last
   * choice a person made.
   */
  const rates = useQuery({
    queryKey: ["shipping-rates", wilayaId, communeId],
    enabled: wilayaId !== "" && communeId !== "",
    queryFn: async () => {
      const result = await acRead<ShippingRate[]>(
        `/shipping/rates?wilaya_id=${wilayaId}&commune_id=${communeId}`,
      );
      return result.data;
    },
  });

  const chosen = wilayaId !== "" && communeId !== "";
  const local = chosen ? applicableRules(rules, Number(wilayaId), Number(communeId)) : [];
  const winner = local[0] ?? null;
  const beaten = local.slice(1);
  const serverRate = rates.data?.[0] ?? null;
  const disagrees =
    serverRate !== null && winner !== null && serverRate.amount !== winner.amount;

  return (
    <Card title={t("resolver")} description={t("resolverNote")}>
      <div className="flex flex-col gap-4">
        <Select
          label={t("pickWilaya")}
          value={wilayaId}
          onChange={(value) => {
            setWilayaId(value);
            setCommuneId("");
          }}
          options={[
            { value: "", label: t("noSelection") },
            ...wilayas.map((w) => ({ value: String(w.id), label: wilayaName(w) })),
          ]}
        />

        <Select
          label={t("pickCommune")}
          value={communeId}
          onChange={setCommuneId}
          disabled={wilayaId === ""}
          hint={wilayaId === "" ? t("pickCommuneFirst") : undefined}
          options={[
            { value: "", label: t("noSelection") },
            ...(communes.data?.data ?? []).map((c) => ({
              value: String(c.id),
              label: locale === "ar" && c.name_ar !== "" ? c.name_ar : c.name,
            })),
          ]}
        />

        {/* A commune list that did not load leaves the picker holding only its
            placeholder, which on its own reads as "this wilaya has no communes".
            It does not. */}
        {wilayaId !== "" && communes.isError ? (
          <p role="status" className="flex flex-wrap items-center gap-3 text-ui-label text-ui-muted">
            <span className="min-w-0">{t("communesFailed")}</span>
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={() => void communes.refetch()}
            >
              {tStates("retry")}
            </Button>
          </p>
        ) : null}

        {!chosen ? (
          <p className="text-ui-label text-ui-muted">{t("resolverPrompt")}</p>
        ) : rates.isPending ? (
          /* The answer block's own geometry, so the card does not grow by three
             rows the moment the rate lands. */
          <SkeletonRegion label={t("loading")} className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </SkeletonRegion>
        ) : rates.isError ? (
          <p role="status" className="flex flex-wrap items-center gap-3 text-ui-label text-ui-muted">
            <span className="min-w-0">{t("resolverFailed")}</span>
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={() => void rates.refetch()}
            >
              {tStates("retry")}
            </Button>
          </p>
        ) : serverRate === null ? (
          /* A 200 with `[]`, which is what the whole shop answered before any
             rule existed. Not an error — a destination nothing covers. */
          <p className="text-ui-label text-ui-muted">{t("resolvedNone")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <DataList>
              <DataRow label={t("resolved")}>
                <Ltr className="text-ui-subheading text-ui-fg">
                  {money(serverRate.amount)}
                </Ltr>
              </DataRow>
              <DataRow label={t("source")}>
                <Badge tone="neutral">
                  {serverRate.source === "rules" ? t("sourceRules") : t("sourceProvider")}
                </Badge>
              </DataRow>
              {serverRate.estimated_days !== null ? (
                <DataRow label={t("estimatedDaysLabel")}>
                  <Isolate>{t("estimatedDays", { days: serverRate.estimated_days })}</Isolate>
                </DataRow>
              ) : null}
              {winner ? (
                <DataRow label={t("resolvedBy")}>
                  <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    <Badge tone={ruleScope(winner) === "national" ? "neutral" : "info"}>
                      {tScope(ruleScope(winner))}
                    </Badge>
                    <span dir="auto">{placeOf(winner)}</span>
                  </span>
                </DataRow>
              ) : null}
            </DataList>

            {disagrees && winner ? (
              <Notice tone="warning" title={t("disagreeTitle")}>
                <p className="text-ui-label">
                  <Isolate>
                    {t("resolvedDisagrees", {
                      amount: money(serverRate.amount),
                      local: money(winner.amount),
                    })}
                  </Isolate>
                </p>
              </Notice>
            ) : null}

            {/* "Why is this destination 350 DA" is answered by the rules that
                lost, which is the second half of what this control is for. */}
            {beaten.length > 0 ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-ui-label text-ui-muted">{t("beaten")}</p>
                <ul className="flex flex-col gap-1">
                  {beaten.map((rule) => (
                    <li
                      key={rule.id}
                      className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui-label text-ui-subtle"
                    >
                      <span dir="auto" className="min-w-0 truncate">
                        {placeOf(rule)}
                      </span>
                      <Ltr className="ms-auto">{money(rule.amount)}</Ltr>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}
