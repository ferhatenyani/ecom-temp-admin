"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";
import { applicableRules, byNarrowestFirst, providerLabel, ruleScope } from "@/lib/shipping";
import { SHOP_CURRENCY, formatMoney } from "@/lib/format/money";
import type { ShippingProvider, ShippingRule } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Button } from "@/components/primitives/Button";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { SectionError } from "@/components/patterns/States";
import { SelectField } from "@/components/primitives/Field";
import { RuleSheet } from "./RuleSheet";

type Commune = { id: number; name: string; name_ar: string };

/**
 * The tariff, and the thing that makes it legible: its own resolution.
 *
 * **The rules editor's whole value is showing which rule would win for a chosen
 * destination.** A rules table that does not resolve is a table people
 * misconfigure — three rows of numbers with no way to ask "so what does Oran
 * cost?".
 *
 * Two answers are shown, deliberately, and they come from different places. The
 * panel resolves locally so the preview updates as the picker moves, and
 * `GET /shipping/rates` is queried for the same destination because **it is the
 * authority**. They agreed on all three fixtures — 350 / 500 / 800 — and if they
 * ever disagree the screen says so rather than quietly preferring its own answer.
 */
export function RulesView({
  rules,
  providers,
  wilayas,
  locale,
}: {
  rules: ShippingRule[] | null;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
  locale: string;
}) {
  const t = useTranslations("shipping");
  const tScope = useTranslations("ruleScope");
  const tDelivery = useTranslations("deliveryType");
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<ShippingRule | "new" | null>(null);
  const [wilayaId, setWilayaId] = useState("");
  const [communeId, setCommuneId] = useState("");

  const money = (value: string) => formatMoney(value, SHOP_CURRENCY, locale);
  const wilayaName = (w: Wilaya) => (locale === "ar" && w.name_ar !== "" ? w.name_ar : w.name);

  const ordered = useMemo(() => byNarrowestFirst(rules ?? []), [rules]);

  /*
   * Commune names for the rules that name one.
   *
   * Bounded by the number of distinct wilayas the tariff actually mentions —
   * one request on this shop, and a tariff naming twenty wilayas is a tariff
   * with twenty rules, so the two grow together rather than the requests
   * outrunning the rows. Failures are silent on purpose: a missing name falls
   * back to the wilaya, which is still a place.
   */
  const referencedWilayas = useMemo(
    () =>
      Array.from(
        new Set(
          (rules ?? [])
            .filter((rule) => rule.commune_id > 0 && rule.wilaya_id > 0)
            .map((rule) => rule.wilaya_id),
        ),
      ),
    [rules],
  );

  const communeLists = useQueries({
    queries: referencedWilayas.map((id) => ({
      queryKey: ["communes", String(id)],
      queryFn: () => acRead<Commune[]>(`/locations/wilayas/${id}/communes?per_page=100`),
    })),
  });

  const communeName = (wilayaId: number, communeId: number): string | null => {
    const index = referencedWilayas.indexOf(wilayaId);
    if (index === -1) return null;
    const found = communeLists[index]?.data?.data?.find((c) => c.id === communeId);
    if (found === undefined) return null;
    return locale === "ar" && found.name_ar !== "" ? found.name_ar : found.name;
  };

  /* The commune list for the chosen wilaya — public on the API, and the reason
     `/locations/wilayas/{id}/communes` joined the allowlist on this branch. */
  const communes = useQuery({
    queryKey: ["communes", wilayaId],
    enabled: wilayaId !== "",
    queryFn: () => acRead<Commune[]>(`/locations/wilayas/${wilayaId}/communes?per_page=100`),
  });

  /* The server's own answer for the chosen destination. Both parameters are
     required — without them this route is a 400 for everyone, Super Admin
     included, and `details.params` arrives as an array of names rather than an
     object of messages, which is why the reader falls through to the generic
     message and this screen supplies its own. */
  const rates = useQuery({
    queryKey: ["shipping-rates", wilayaId, communeId],
    enabled: wilayaId !== "" && communeId !== "",
    queryFn: () =>
      acRead<{ amount: string; source: string; estimated_days: number | null }[]>(
        `/shipping/rates?wilaya_id=${wilayaId}&commune_id=${communeId}`,
      ),
  });

  const localMatches = useMemo(
    () =>
      wilayaId === "" || communeId === ""
        ? []
        : applicableRules(rules ?? [], Number(wilayaId), Number(communeId)),
    [rules, wilayaId, communeId],
  );

  const winner = localMatches[0] ?? null;
  const beaten = localMatches.slice(1);
  const serverRate = rates.data?.data?.[0] ?? null;
  const disagrees =
    serverRate !== null && winner !== null && serverRate.amount !== winner.amount;

  /**
   * The destination in words.
   *
   * The badge beside this already says the *scope*, so a national rule reading
   * "National · National" was the badge printed twice — caught in the render, not
   * by any test. It names the place instead: the whole country.
   *
   * A commune-scoped rule needs a commune name, and the rules payload carries
   * only an id. `communesByWilaya` resolves the handful actually referenced;
   * until it lands the row shows the wilaya alone rather than a bare commune id,
   * which is a database key rendered at a person.
   *
   * (Written without the id itself on purpose: `check-design.sh` greps for hex
   * colour literals and a three-digit commune id is valid hex. The scanner is
   * deliberately blunt and a comment is not worth an exemption.)
   */
  const destinationLabel = (rule: ShippingRule) => {
    const scope = ruleScope(rule);
    if (scope === "national") return t("nationalOption");

    const w = wilayas.find((entry) => entry.id === rule.wilaya_id);
    const place = w ? wilayaName(w) : `#${rule.wilaya_id}`;
    if (scope !== "commune") return place;

    const commune = communeName(rule.wilaya_id, rule.commune_id);
    return commune === null ? place : `${place} · ${commune}`;
  };

  return (
    <>
      <ListGroup title={t("tariff")} footnote={t("tariffNote")}>
        {rules === null ? (
          <ListRow>
            <SectionError>{t("noRules")}</SectionError>
          </ListRow>
        ) : ordered.length === 0 ? (
          <ListRow>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-body text-label-secondary">{t("noRules")}</span>
              <span className="text-footnote text-label-tertiary">{t("noRulesNote")}</span>
            </span>
          </ListRow>
        ) : (
          ordered.map((rule) => (
            <ListRow key={rule.id} className={rule.is_active ? "" : "opacity-50"}>
              <button
                type="button"
                onClick={() => setEditing(rule)}
                className="press-row -mx-4 flex min-w-0 flex-1 items-center gap-3 px-4 py-1 text-start"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    {/* The scope is the word for `specificity`, and it is what a
                        person reads the table by. */}
                    <StatusBadge tone={ruleScope(rule) === "national" ? "neutral" : "info"}>
                      {tScope(ruleScope(rule))}
                    </StatusBadge>
                    <span className="truncate text-body text-label" dir="auto">
                      {destinationLabel(rule)}
                    </span>
                  </span>
                  {/* One line with an ellipsis, not a wrap. In Arabic — which
                      runs a step larger — this line wrapped and left the isolated
                      "1 ي" split across two lines, the unit orphaned under its
                      own number. `dir="auto"` puts the clip at the string's own
                      end rather than the paragraph's. */}
                  <span
                    dir="auto"
                    className="truncate text-footnote text-label-secondary"
                  >
                    {/* Ordered by what must survive the clip. The provider is
                        last because this shop has exactly one and its label is
                        the longest thing on the line; the delay is what an
                        operator is actually reading for. */}
                    {tDelivery.has(rule.delivery_type as "home")
                      ? tDelivery(rule.delivery_type as "home")
                      : rule.delivery_type}
                    {rule.estimated_days !== null ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        <Isolate>{t("estimatedDays", { days: rule.estimated_days })}</Isolate>
                      </>
                    ) : null}
                    {!rule.is_active ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        {t("inactive")}
                      </>
                    ) : null}
                    <span aria-hidden="true"> · </span>
                    {providerLabel(rule.provider, providers)}
                  </span>
                  {rule.free_over !== null ? (
                    <span className="text-caption text-label-tertiary">
                      <Isolate>{t("freeOver", { amount: money(rule.free_over) })}</Isolate>
                    </span>
                  ) : null}
                </span>
                <Ltr className="shrink-0 text-headline text-label">{money(rule.amount)}</Ltr>
              </button>
            </ListRow>
          ))
        )}
        <ListRow>
          <Button variant="tinted" fullWidth onClick={() => setEditing("new")}>
            {t("addRule")}
          </Button>
        </ListRow>
      </ListGroup>

      {/* ------------------------------------------------- the resolver --- */}
      <ListGroup title={t("resolver")} footnote={t("resolverNote")}>
        <SelectField
          label={t("pickWilaya")}
          value={wilayaId}
          onChange={(value) => {
            setWilayaId(value);
            setCommuneId("");
          }}
          options={[
            { value: "", label: "—" },
            ...wilayas.map((w) => ({ value: String(w.id), label: wilayaName(w) })),
          ]}
        />
        <SelectField
          label={t("pickCommune")}
          value={communeId}
          onChange={setCommuneId}
          disabled={wilayaId === ""}
          hint={wilayaId === "" ? t("pickCommuneFirst") : undefined}
          options={[
            { value: "", label: "—" },
            ...(communes.data?.data ?? []).map((c) => ({
              value: String(c.id),
              label: locale === "ar" && c.name_ar !== "" ? c.name_ar : c.name,
            })),
          ]}
        />

        {wilayaId !== "" && communeId !== "" ? (
          serverRate === null && !rates.isPending ? (
            <ListRow>
              <span className="text-body text-label-secondary">{t("resolvedNone")}</span>
            </ListRow>
          ) : (
            <>
              <ListRow>
                <span className="text-body text-label-secondary">{t("resolved")}</span>
                <span className="ms-auto flex items-center gap-2">
                  {serverRate ? (
                    <>
                      <StatusBadge tone="neutral">
                        {serverRate.source === "rules"
                          ? t("sourceRules")
                          : t("sourceProvider")}
                      </StatusBadge>
                      <Ltr className="text-headline text-label">
                        {money(serverRate.amount)}
                      </Ltr>
                    </>
                  ) : (
                    <span className="text-body text-label-tertiary">…</span>
                  )}
                </span>
              </ListRow>

              {winner ? (
                <ListValueRow
                  label={t("resolvedBy")}
                  value={
                    <span className="flex items-center justify-end gap-2">
                      <StatusBadge tone={ruleScope(winner) === "national" ? "neutral" : "info"}>
                        {tScope(ruleScope(winner))}
                      </StatusBadge>
                      <span dir="auto">{destinationLabel(winner)}</span>
                    </span>
                  }
                />
              ) : null}

              {/* The server disagreeing with the local preview is a real
                  possibility — an inactive rule, a provider quote, a rule written
                  from another tab — and the API is the authority. */}
              {disagrees && serverRate && winner ? (
                <ListRow className="tone-warning">
                  <span className="text-subhead text-label">
                    <Isolate>
                      {t("resolvedDisagrees", {
                        amount: money(serverRate.amount),
                        local: money(winner.amount),
                      })}
                    </Isolate>
                  </span>
                </ListRow>
              ) : null}

              {beaten.length > 0 ? (
                <ListRow>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-caption text-label-secondary">{t("beaten")}</span>
                    <span className="flex flex-col gap-1">
                      {beaten.map((rule) => (
                        <span key={rule.id} className="text-footnote text-label-tertiary">
                          <span dir="auto">{destinationLabel(rule)}</span>
                          <span aria-hidden="true"> · </span>
                          <Ltr>{money(rule.amount)}</Ltr>
                        </span>
                      ))}
                    </span>
                  </span>
                </ListRow>
              ) : null}
            </>
          )
        ) : null}
      </ListGroup>

      <RuleSheet
        /* The remount that replaces the effect: opening a different row gives
           the sheet a different key, so its state initialisers run again. */
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        open={editing !== null}
        rule={editing === "new" ? null : editing}
        providers={providers}
        wilayas={wilayas}
        locale={locale}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          // The rules arrive from the server component, so a refresh is what
          // makes the table and the resolver agree again.
          queryClient.invalidateQueries({ queryKey: ["shipping-rates"] });
        }}
      />
    </>
  );
}
