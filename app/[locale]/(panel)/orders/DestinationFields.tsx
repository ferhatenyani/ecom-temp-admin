"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";
import type { Wilaya } from "@/lib/api/schemas/order";
import { placeName } from "@/lib/geography";
import { Select } from "@/components/ui/Form";

/**
 * Where a parcel is going: a wilaya, and then a commune inside it.
 *
 * ## What the two routes are, and how that is known
 *
 * `GET /locations/wilayas` and `GET /locations/wilayas/{id}/communes`, both read
 * from `Geography\LocationController::registerRoutes()`. Both are
 * `permission_callback => '__return_true'` — the one place in the plugin that
 * returns true, justified in its own docblock as public administrative reference
 * data an unauthenticated storefront needs to draw an address form — so putting
 * them behind the panel's proxy widens nothing that was not already reachable
 * without a credential. Both were **already allowlisted** before this branch,
 * `/locations/wilayas` with the orders list and the commune route with the
 * shipping rules editor; `tests/boundary.test.ts` already asserts both, and
 * `/locations/coverage` and `/locations/communes/{id}` are still refused.
 *
 * **Neither route paginates.** `LocationController::searchArgs()` declares
 * exactly two parameters, `search` and `active_only`, under a docblock headed
 * *"No pagination"*, and `communes()` answers
 * `Response::success($communes, 200, ['total' => count($communes)])` — the
 * identical call `wilayas()` makes, whose envelope was measured live as
 * `{"total":69}` and nothing else. So this component sends no `per_page`: a
 * parameter a route does not declare is one WordPress quietly ignores, and a
 * request that carries it is a request whose reader is owed an explanation the
 * API cannot give. `scripts/mock-api.mjs` was serving this route through the
 * paging helper and now serves it through `counted()` for the same reason.
 *
 * **`active_only` is the one parameter both routes do declare, and it is
 * deliberately not sent.** It means *"exclude places switched off for
 * delivery"*, which sounds exactly right for a destination that has to be
 * quotable — and it is the wrong default for a back-office form, because a
 * place missing from a list with no explanation is indistinguishable from a
 * place the shop has never heard of. An operator taking an order by phone needs
 * to be able to name where it is going; whether anyone will carry it there is
 * the rate lookup's answer to give, in words. Every other caller of these two
 * routes in this panel omits it too, so this is the existing behaviour written
 * down rather than a new choice.
 *
 * ## A separate control from the address block, and that is the design
 *
 * `AddressFields.tsx` already draws a wilaya picker, bound to `state`. This one
 * looks like it and means something different, which is worth stating plainly
 * because the two sit in one drawer:
 *
 *   `billing.state`   free text on the order's address. `Commerce\AddressInput`
 *                     does no wilaya validation at all — its docblock says so —
 *                     so the API stores whatever two characters it is given.
 *   `wilaya_id`       a row in the geography table, and the only thing
 *                     `GET /shipping/rates` and `POST /orders/{id}/shipments`
 *                     will accept.
 *
 * The panel's own precedent settles which of the two a courier gets asked for.
 * `CreateParcelDrawer` collects this pair on an order that **already has an
 * address**, because — measured — `POST /orders/{id}/shipments` refuses a body
 * with no `wilaya_id`/`commune_id` and does not read them off the order. The
 * same fact is why `lib/api/schemas/analytics.ts` records unattributed revenue
 * as larger than every attributed wilaya put together. A destination is asked
 * for; it is never inferred from an address.
 *
 * What stops that being two controls asking one question twice is
 * `destinationSeed` in `new-order.ts`: choosing here fills the address's empty
 * `state` and `city`, never a filled one. One direction, additive only, no
 * effect synchronising two pieces of state.
 *
 * ## Lifted from `CreateParcelDrawer`, and deliberately not yet lifted *out* of it
 *
 * The dependent fetch, the query key, the reset-on-change and the disabled
 * commune select are that drawer's, reproduced here rather than reinvented —
 * including `["communes", wilayaId]`, which is its key exactly, so a commune list
 * fetched by one form is already in the cache for the other. `ProductPicker.tsx`
 * beside this file records what happens when two copies drift instead.
 *
 * The obvious next move is for `CreateParcelDrawer` to adopt this component, and
 * this branch does not make it: the parcel section of the order detail is being
 * edited on another sub-task of this same step, and — quoting the lift that went
 * the other way — "two agents rewriting one component is how a merge eats a
 * docblock". Same reasoning, same outcome, recorded rather than left as an
 * accident.
 *
 * ## The three states of the second list
 *
 * A dependent fetch has more states than a plain one and each is drawn rather
 * than collapsed into a disabled box:
 *
 *   no wilaya   the select is disabled and the hint says to choose one first.
 *               There is no request in flight, because `enabled` is false.
 *   loading     disabled, and the hint says the list is loading. Not a skeleton:
 *               the control is one row in a column of fields and swapping it for
 *               a grey bar would jump the layout of every field under it.
 *   empty       enabled, with a hint saying this wilaya has no communes loaded.
 *               That is a real state, not a defensive one — `GeoService::coverage()`
 *               exists precisely because an install that never ran
 *               `wp algerian-commerce import-algeria` looks exactly like one
 *               whose communes have not been sourced yet.
 *   failed      the API's own sentence, in the danger tone, and the select stays
 *               usable. `ProductPicker` renders a failed search the same way.
 *               **A destination that will not load must not make the order
 *               unsavable** — the same rule the rate lookup inherits, and the
 *               one `EL/el-user-app/src/pages/CartCheckoutPage.jsx` follows when
 *               its quote fails.
 */

/**
 * One commune, as much of it as anything here reads.
 *
 * **There is no Zod schema for this route anywhere in `lib/api/schemas`** and
 * this is not the branch that invents one: `CreateParcelDrawer`, `RulesScreen`,
 * `Resolver`, `RuleForm` and `ParcelDrawer` all read it with an untyped
 * `acRead<Commune[]>` against these same three keys, and a schema written here
 * would be a sixth shape rather than one boundary. The real row carries eight
 * more fields — `wilaya_id`, `slug`, `daira`, `daira_ar`, `postal_code`,
 * `national_code`, `latitude`, `longitude`, `is_active`, read from
 * `Geography\GeoRepository::hydrateCommune()` — and none of them is drawn.
 */
export type Commune = { id: number; name: string; name_ar: string };

/** The row a choice landed on, handed back whole so the caller can seed from it. */
export type Destination = {
  wilayaId: string;
  communeId: string;
  wilaya: Wilaya | null;
  commune: Commune | null;
};

export function DestinationFields({
  /** The form's own id namespace, as `AddressFields` takes one and for the same
      reason: two drawers can be in one document and a duplicated id is a link
      that focuses the wrong form's control. */
  idPrefix,
  wilayas,
  wilayaId,
  communeId,
  onChange,
  locale,
  /** False while the drawer is shut, so no commune list is fetched for a form
      nobody is looking at. `ProductPicker` takes the same gate. */
  enabled,
  /** Said under the wilaya select when the address names a different one. The
      caller owns that comparison — this control knows nothing about addresses. */
  wilayaNote,
  disabled = false,
}: {
  idPrefix: string;
  wilayas: Wilaya[];
  wilayaId: string;
  communeId: string;
  onChange: (next: Destination) => void;
  locale: string;
  enabled: boolean;
  wilayaNote?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("shipping");

  const communes = useQuery({
    /* `CreateParcelDrawer`'s key, character for character. Two forms asking for
       one wilaya's communes must be one cache entry and one request — the API's
       rate limit is counted per credential across every open tab. */
    queryKey: ["communes", wilayaId],
    enabled: enabled && wilayaId !== "",
    queryFn: () => acRead<Commune[]>(`/locations/wilayas/${wilayaId}/communes`),
  });

  const rows = communes.data?.data ?? [];

  /*
   * `isPending` is true both while a request is in flight *and* while the query
   * is disabled, which is why the "choose a wilaya first" case is tested before
   * it rather than after: a disabled query that never ran would otherwise read
   * as a list that is still loading, forever.
   */
  const communeHint =
    wilayaId === ""
      ? t("pickCommuneFirst")
      : communes.isPending
        ? t("communesLoading")
        : communes.isError
          ? undefined
          : rows.length === 0
            ? t("noCommunes")
            : undefined;

  return (
    <div className="flex flex-col gap-3">
      <Select
        id={`${idPrefix}-wilaya`}
        label={t("pickWilaya")}
        value={wilayaId}
        hint={wilayaNote}
        disabled={disabled}
        onChange={(next) =>
          /*
           * The commune goes with the wilaya, always. A commune belongs to
           * exactly one wilaya, so a pair left half-changed would name a place
           * that does not exist — and the rate lookup this pair feeds would
           * quote it. `CreateParcelDrawer` clears it in the same handler, and
           * `EL`'s checkout and admin modal both do (`setFormData({ ...,
           * wilaya, city: '' })`).
           */
          onChange({
            wilayaId: next,
            communeId: "",
            wilaya: wilayas.find((w) => String(w.id) === next) ?? null,
            commune: null,
          })
        }
        options={[
          { value: "", label: t("notChosen") },
          ...wilayas.map((w) => ({
            value: String(w.id),
            label: placeName(w, locale),
          })),
        ]}
      />

      <Select
        id={`${idPrefix}-commune`}
        label={t("pickCommune")}
        value={communeId}
        hint={communeHint}
        /* Disabled while there is nothing to choose from, and **not** while the
           request has failed: a failed list leaves the control alone so the
           error reads as something that happened rather than as a field that was
           never meant to be filled. */
        disabled={disabled || wilayaId === "" || communes.isPending}
        onChange={(next) =>
          onChange({
            wilayaId,
            communeId: next,
            wilaya: wilayas.find((w) => String(w.id) === wilayaId) ?? null,
            commune: rows.find((c) => String(c.id) === next) ?? null,
          })
        }
        options={[
          { value: "", label: t("notChosen") },
          ...rows.map((c) => ({
            value: String(c.id),
            label: placeName(c, locale),
          })),
        ]}
      />

      {/* The API's own sentence. Not bound to either control as an `error`,
          because nothing the operator chose is wrong — the list did not
          arrive — and §3.4 keeps a per-control error for a per-control fault. */}
      {communes.isError ? (
        <p className="text-ui-label text-ui-danger-fg">
          {(communes.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}
