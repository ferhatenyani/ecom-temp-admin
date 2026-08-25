"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { byNarrowestFirst, providerLabel, ruleScope } from "@/lib/shipping";
import { SHOP_CURRENCY, formatMoney } from "@/lib/format/money";
import type { ShippingProvider, ShippingRule } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { DetailGrid } from "@/components/ui/Detail";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { ConfirmDialog, useConfirm } from "@/components/ui/Confirm";
import { EmptyState, SectionError } from "@/components/ui/States";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { Resolver } from "./Resolver";
import { RuleForm } from "./RuleForm";

type Commune = { id: number; name: string; name_ar: string };

/**
 * The tariff — what the shop charges — as its own route.
 *
 * ## Why it is a route rather than the second half of `/shipping`
 *
 * It used to be one segment of a `Segmented` control on `/shipping`, and the
 * reason was written down: two tab-bar destinations for one person's job would
 * have spent a slot the bar did not have. `AppShell` replaced that bar, so the
 * constraint expired. What is left is the same shape `/inventory` and
 * `/inventory/movements` already take — **different data, a different filter set
 * and its own writes** — and folding two of those into one screen means one
 * component holding two unrelated query objects and a control deciding which is
 * live.
 *
 * **No nav entry**, deliberately: the sidebar is already seventeen items, and a
 * tariff is somewhere you go *from* the parcels. `nav-tree.ts` keeps its single
 * `/shipping` entry and the parcels header carries the link.
 *
 * ## `PageBody width="split"`, and the aside is the resolver
 *
 * The rules are an unboundedly-growing list; the resolver is a fixed block of
 * reference material a person consults *while* reading them. That is §2.3's
 * two-column detail exactly, and `DetailGrid` puts the aside **below** main when
 * it collapses — somebody opening this on a phone came for the rules.
 *
 * ## No stale marker here, and §3.7's amendment is why
 *
 * The marker is required wherever the pixels can outlive the fetch that produced
 * them. They cannot here: the rules are **server-fetched**, every write ends in
 * `router.refresh()`, and the resolver issues a fresh request per selection. The
 * other half of the rule — "every write control disabled with that same reason" —
 * has nothing to disable, because there is no cache to go stale against. The
 * parcels list *does* hold one, and carries the banner.
 */
export function RulesScreen({
  locale,
  rules,
  failed,
  providers,
  wilayas,
}: {
  locale: string;
  rules: ShippingRule[];
  /** Distinct from an empty list: one is "could not load", the other is "none". */
  failed: boolean;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
}) {
  const t = useTranslations("shipping");
  const tScope = useTranslations("ruleScope");
  const tDelivery = useTranslations("deliveryType");
  const tProvider = useTranslations("shippingProvider");
  const tStates = useTranslations("states");
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<ShippingRule | "new" | null>(null);
  const confirm = useConfirm<ShippingRule>();

  const money = (value: string) => formatMoney(value, SHOP_CURRENCY, locale);
  const wilayaName = (w: Wilaya) => (locale === "ar" && w.name_ar !== "" ? w.name_ar : w.name);

  /* **The server's own `specificity`, never a ranking of this panel's.** It is
     3 national / 7 wilaya / 15 commune, computed server-side, and deriving it
     here would be a second implementation of the rule the whole screen exists to
     display. Narrowest first is the order they win in. */
  const ordered = useMemo(() => byNarrowestFirst(rules), [rules]);

  const remove = useMutation({
    mutationFn: async (rule: ShippingRule) => acWrite("DELETE", `/shipping/rules/${rule.id}`),
    onSuccess: () => {
      confirm.close();
      toast.show(t("ruleDeleted"));
      settled();
    },
    onError: (error: unknown) => {
      confirm.close();
      toast.show(
        error instanceof BrowserApiError || error instanceof Error
          ? error.message
          : t("ruleDeleted"),
        "danger",
      );
    },
  });

  /* The rules arrive from the Server Component, so a refresh is what makes the
     list and the resolver agree again — and the resolver's own cache has to go
     with it, or a rate answered before the write stays on screen. */
  function settled() {
    void queryClient.invalidateQueries({ queryKey: ["shipping-rates"] });
    router.refresh();
  }

  /*
   * Commune names for the rules that name one.
   *
   * The rules payload carries only an id, and a commune id rendered at a
   * shopkeeper is a database key pretending to be a place. Without this a
   * commune rule and a wilaya rule for the same wilaya both read "Alger" and
   * differ only by their badge, which is the ambiguity the resolver exists to
   * settle — so the row settles it too.
   *
   * Bounded by the number of *distinct wilayas the tariff mentions* — one
   * request on this shop. A tariff naming twenty wilayas is a tariff with twenty
   * rules, so the two grow together rather than the requests outrunning the rows.
   * Failures are silent on purpose: a missing name falls back to the wilaya,
   * which is still a place.
   */
  const referenced = useMemo(
    () =>
      Array.from(
        new Set(
          rules
            .filter((rule) => rule.commune_id > 0 && rule.wilaya_id > 0)
            .map((rule) => rule.wilaya_id),
        ),
      ),
    [rules],
  );

  const communeLists = useQueries({
    queries: referenced.map((id) => ({
      queryKey: ["communes", String(id)],
      queryFn: () => acRead<Commune[]>(`/locations/wilayas/${id}/communes?per_page=100`),
    })),
  });

  /**
   * The place a rule covers, in words. The badge beside it carries the scope, so
   * a national rule names **the country** rather than repeating "National" — that
   * row read "وطني · وطني" until a screenshot showed it.
   *
   * A wilaya the list does not carry falls back to the country rather than to its
   * id. (Written without an id example on purpose: `check-design.sh` greps for
   * hex colour literals and a three-digit commune id behind a hash is valid hex.
   * The scanner is deliberately blunt and a comment is not worth an exemption.)
   */
  const placeOf = (rule: ShippingRule) => {
    const scope = ruleScope(rule);
    if (scope === "national") return t("nationalOption");

    const w = wilayas.find((entry) => entry.id === rule.wilaya_id);
    const place = w ? wilayaName(w) : t("nationalOption");
    if (scope !== "commune") return place;

    const index = referenced.indexOf(rule.wilaya_id);
    const found = communeLists[index]?.data?.data.find((c) => c.id === rule.commune_id);
    if (found === undefined) return place;
    return `${place} · ${locale === "ar" && found.name_ar !== "" ? found.name_ar : found.name}`;
  };

  /**
   * How the delete dialog names the rule, and the reason §3.1 was amended.
   *
   * That section requires an irreversible act to be confirmed by typing "the
   * record's identifier". A rule has none a person would recognise — its only
   * unique handle is a database key, and this list deliberately never shows one.
   * So the dialog names it the way the row does: scope, place and amount.
   */
  const nameOf = (rule: ShippingRule) =>
    t("ruleNamed", {
      scope: tScope(ruleScope(rule)),
      place: placeOf(rule),
      amount: money(rule.amount),
    });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("rulesTitle")}
        subtitle={
          failed ? undefined : (
            <span data-testid="rules-count">
              <Isolate>{t("rulesCount", { total: ordered.length })}</Isolate>
            </span>
          )
        }
        /* Rendered at every width — §2.4's amendment. At `lg`+ there is no top
           bar, so without this a person's only way back is the sidebar item,
           which is the route they are already on. */
        back={{ href: `/${locale}/shipping`, label: t("title") }}
        actions={
          <Button icon="plus" onClick={() => setEditing("new")}>
            {t("addRule")}
          </Button>
        }
      />

      <PageBody width="split">
        <DetailGrid
          main={
            <Card title={t("tariff")} footnote={t("tariffNote")}>
              {failed ? (
                <div className="flex flex-col items-center gap-3">
                  <SectionError>{t("rulesFailed")}</SectionError>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="refresh"
                    onClick={() => router.refresh()}
                  >
                    {tStates("retry")}
                  </Button>
                </div>
              ) : ordered.length === 0 ? (
                /* No data, not no-results: this list takes no filters, so the
                   only empty state it has offers the create action. */
                <EmptyState
                  icon="list"
                  message={t("noRules")}
                  /* What the absence costs, which is the reason to press the
                     button below it — and the state the whole shop was in before
                     `seed-shipping-rules.mjs` ran. */
                  detail={t("noRulesNote")}
                  action={{ label: t("addRule"), onClick: () => setEditing("new") }}
                />
              ) : (
                <ul className="flex flex-col">
                  {ordered.map((rule) => (
                    <li
                      key={rule.id}
                      className="relative flex min-w-0 items-start gap-1 border-b border-ui-line py-2 first:pt-0 last:border-b-0 last:pb-0"
                    >
                      <div
                        className={`flex min-w-0 flex-1 flex-col gap-1 ${
                          rule.is_active ? "" : "opacity-60"
                        }`}
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Badge tone={ruleScope(rule) === "national" ? "neutral" : "info"}>
                            {tScope(ruleScope(rule))}
                          </Badge>
                          {/*
                            **The destination wraps at the floor and shares a
                            line only from `sm` up**, because a clipped commune
                            name here has nowhere to be read.

                            §2.1 allows truncation when the full value stays
                            reachable — a parcel row may clip, because its drawer
                            shows the value in full one tap away. A rule row has
                            no such surface: tapping it opens the *editor*, where
                            the destination is two `<select>` values rather than
                            a sentence. Measured at 340 in French and Arabic, the
                            old one-line layout produced `Alger · Alg…` and
                            `الجزائر · الج…` — clipping away the commune, which is
                            the entire difference between that row and the wilaya
                            rule beneath it — and `Toute l'Algérie` as
                            `Toute l'Algé…`, which is not a long string at all. It
                            was short and losing, because it shared a line with
                            the amount.
                          */}
                          <span
                            dir="auto"
                            className="min-w-0 flex-1 break-words text-ui-subheading text-ui-fg sm:truncate"
                          >
                            {placeOf(rule)}
                          </span>
                          {/* Its own line at the floor, back beside the place
                              from `sm` up where both fit comfortably. */}
                          <Ltr className="w-full shrink-0 text-end text-ui-subheading text-ui-fg sm:w-auto sm:text-start">
                            {money(rule.amount)}
                          </Ltr>
                        </div>

                        {/* Wraps rather than truncating: four facts share this
                            line, and at 340px in Arabic — which runs a step
                            larger — a clip left the isolated "1 ي" split across
                            two lines with the unit orphaned under its number. */}
                        <span
                          dir="auto"
                          className="min-w-0 break-words text-ui-label text-ui-subtle"
                        >
                          {tDelivery.has(rule.delivery_type as "home")
                            ? tDelivery(rule.delivery_type as "home")
                            : rule.delivery_type}
                          {rule.estimated_days !== null ? (
                            <>
                              <span aria-hidden="true"> · </span>
                              <Isolate>{t("estimatedDays", { days: rule.estimated_days })}</Isolate>
                            </>
                          ) : null}
                          <span aria-hidden="true"> · </span>
                          {providerLabel(rule.provider, providers, (key) =>
                            tProvider.has(key as "manual") ? tProvider(key as "manual") : null,
                          ) || t("providerAny")}
                          {rule.free_over !== null ? (
                            <>
                              <span aria-hidden="true"> · </span>
                              <Isolate>{t("freeOver", { amount: money(rule.free_over) })}</Isolate>
                            </>
                          ) : null}
                          {rule.is_active ? null : (
                            <>
                              <span aria-hidden="true"> · </span>
                              {t("inactive")}
                            </>
                          )}
                        </span>
                      </div>

                      {/*
                        One `Menu`, not a row of icon buttons — §3.2. It holds the
                        destructive item alone: the row itself is what opens the
                        editor, and a menu entry repeating "open" is not an
                        action. `id` so the ConfirmDialog it opens can hand focus
                        back: Radix unmounts a menu item the instant it is
                        selected, so the overlay's recorded opener is detached by
                        the time it would be focused.
                      */}
                      <Menu
                        label={t("ruleActions")}
                        actions={[
                          {
                            key: "delete",
                            label: t("deleteRule"),
                            icon: "trash",
                            destructive: true,
                            onSelect: () => confirm.ask(rule),
                          },
                        ]}
                        trigger={
                          <IconButton
                            id={`rule-menu-${rule.id}`}
                            label={t("ruleActions")}
                            icon="more"
                            variant="ghost"
                            size="sm"
                            className="relative z-10 shrink-0"
                          />
                        }
                      />

                      {/* A stretched overlay button rather than wrapping the row
                          in one, which would put the menu inside it and make the
                          menu unreachable by keyboard. */}
                      <button
                        type="button"
                        aria-label={nameOf(rule)}
                        onClick={() => setEditing(rule)}
                        className="ui-ring absolute inset-0 cursor-pointer rounded-ui-md"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          }
          /* `placeOf` is passed down rather than re-derived, so the winner and
             the rules it beat are named with exactly the words the list above
             uses — and the commune lookup is fetched once for both. */
          aside={
            <Resolver rules={rules} wilayas={wilayas} locale={locale} placeOf={placeOf} />
          }
        />
      </PageBody>

      <RuleForm
        /* The remount that replaces the effect: opening a different row gives the
           form a different key, so its state initialisers run again. */
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        open={editing !== null}
        rule={editing === "new" ? null : editing}
        providers={providers}
        wilayas={wilayas}
        locale={locale}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          settled();
        }}
      />

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.onOpenChange}
        returnFocusTo={confirm.target ? `rule-menu-${confirm.target.id}` : undefined}
        tone="destructive"
        loading={remove.isPending}
        title={t("deleteRule")}
        /*
         * **No `requireTyped`, and DESIGN.md §3.1 carries the amendment.** That
         * rule asks for the record's identifier to be typed; a rule's only
         * identifier is a database key this screen deliberately never shows a
         * person. The dialog names the rule in human terms instead — the same
         * words the row uses — so what is about to be deleted is unambiguous
         * without asking anyone to copy a number the panel just invented a
         * reason to display.
         */
        body={
          <>
            <p className="text-ui-subheading text-ui-fg" dir="auto">
              {confirm.target ? nameOf(confirm.target) : ""}
            </p>
            <p className="mt-1.5">{t("deleteRuleConfirm")}</p>
          </>
        }
        confirmLabel={t("deleteRule")}
        onConfirm={() => {
          if (confirm.target) remove.mutate(confirm.target);
        }}
      />
    </div>
  );
}
