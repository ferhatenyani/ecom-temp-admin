import type { Shipment, ShippingProvider, ShippingRule } from "@/lib/api/schemas/shipping";

/**
 * What a shipment row and a rules table need to know, in one place.
 *
 * Types only from the schema module — `import type` is erased, so this file stays
 * importable from a client component without dragging Zod along, the same
 * arrangement `lib/customers.ts` and `lib/products.ts` use.
 */

/* ------------------------------------------------------ label URLs --- */

/**
 * The credential keys a courier puts in `metadata`, and the reason this function
 * exists at all.
 *
 * **The spec says a shipment has a `label` field. It does not — it has
 * `metadata.label`, and `metadata.labels` as well.** Measured 2026-08-20 across
 * all 111 shipments: no top-level `label` on any of them, and no
 * `metadata.label` either, because the only configured provider is `manual` and
 * in-house delivery issues no labels.
 *
 * The field is not hypothetical though, and the backend is explicit about its
 * shape. `Core/Logger.php` masks these three by **exact** key match, with this
 * comment beside them:
 *
 * > *A Yalidine parcel comes back with `label` and `labels`: URLs that carry an
 * > access token, so anyone holding one can fetch the shipping label and with it
 * > the customer's name, phone and full address, without a credential of their
 * > own. They belong in `ac_shipments.metadata` — an operator has to print the
 * > label — but never in a log, where they outlive the parcel and cannot be
 * > revoked.*
 *
 * Exact rather than substring, deliberately, because "label" also names harmless
 * things — `provider_status_label` is ZR Express's wording for a parcel state,
 * and a shipping *rate* carries a plain display `label` that is not a URL. This
 * list matches the backend's exactly; widening it would strip a status label and
 * narrowing it would leak a credential.
 *
 * **`Shipment::toArray()` emits `metadata` verbatim** — measured, no filtering —
 * so the moment a courier adapter is switched on, every one of these arrives in
 * the panel's JSON. That is what makes this a stripper rather than a
 * documentation note: Part III's rule ("never render one in a client component,
 * never put one in a `href` the browser can prefetch") is not something a
 * component can be trusted to remember, because the component would have to know
 * the key was there.
 */
export const LABEL_METADATA_KEYS = ["label", "labels", "signature_url"] as const;

export type SafeShipment = Omit<Shipment, "metadata"> & {
  metadata: Record<string, unknown>;
  /**
   * Which credential keys were present, by name and never by value.
   *
   * The panel needs to know a label **exists** in order to offer the button, and
   * must not receive the URL to do it. So the fact crosses the boundary and the
   * credential does not; opening one goes through `/api/label/[id]`, which
   * re-reads the shipment server-side.
   */
  labelKeys: string[];
};

/**
 * Remove every credential key from a shipment's metadata, server-side.
 *
 * Returns the shipment with a cleaned `metadata` and the names of what was
 * removed. Call this **before** a shipment crosses into a client component or
 * into a Server Component's props — which, in the App Router, is the same
 * boundary: props are serialised into the RSC payload and that payload is in the
 * document.
 */
export function stripLabelUrls(shipment: Shipment): SafeShipment {
  const metadata: Record<string, unknown> = {};
  const labelKeys: string[] = [];

  for (const [key, value] of Object.entries(shipment.metadata)) {
    if ((LABEL_METADATA_KEYS as readonly string[]).includes(key)) {
      labelKeys.push(key);
      continue;
    }
    metadata[key] = value;
  }

  return { ...shipment, metadata, labelKeys };
}

export function stripLabelUrlsFrom(list: Shipment[]): SafeShipment[] {
  return list.map(stripLabelUrls);
}

/* ---------------------------------------------------------- the row --- */

/**
 * A provider's display name, falling back to its own slug.
 *
 * **A shipment's provider is not constrained to `/shipping/providers`.** Shipment
 * 213 carries `acfake`, registered at runtime by the backend's webhook suite,
 * while the providers route reports only `manual`. A lookup that returned `""`
 * for an unknown provider would blank the column on exactly the rows worth
 * looking at.
 */
export function providerLabel(
  name: string,
  providers: readonly ShippingProvider[],
): string {
  return providers.find((provider) => provider.name === name)?.label ?? name;
}

/**
 * Whether this order may be given a new shipment, and why not when it may not.
 *
 * **One live shipment per order, enforced by the database.** The create button is
 * absent with the reason while one is live — and the reason can name the parcel,
 * because the 409 does: measured, `POST` a second live shipment answers
 * `{"code":"conflict","details":{"shipment_id":220,"provider":"manual","status":"created"}}`.
 *
 * History accumulates and does not block. Order 3939 carries four shipments, all
 * finished, and creating a fifth is allowed — the constraint is on live ones
 * only, which is why this reads `is_live` rather than counting rows.
 */
export type CreateGate =
  | { allowed: true }
  | { allowed: false; blockedBy: SafeShipment };

export function createShipmentGate(list: readonly SafeShipment[]): CreateGate {
  const live = list.find((shipment) => shipment.is_live);
  return live ? { allowed: false, blockedBy: live } : { allowed: true };
}

/**
 * The wilaya a shipment was sent to, which is where analytics gets its geography.
 *
 * *"A wilaya comes off the shipment, never the address"* — and the object carries
 * its own: `metadata.wilaya_id`, measured on every manual shipment. An order's
 * `billing.state` is filled on 41 of 633 orders and is not the same fact.
 *
 * Returns null rather than 0 for a missing value, because wilaya 0 is what a
 * *national* shipping rule uses as its wildcard and rendering it as a place would
 * invent one.
 */
export function shipmentWilayaId(shipment: SafeShipment): number | null {
  const raw = shipment.metadata.wilaya_id;
  if (typeof raw !== "number" || raw <= 0) return null;
  return raw;
}

export function shipmentCommuneId(shipment: SafeShipment): number | null {
  const raw = shipment.metadata.commune_id;
  if (typeof raw !== "number" || raw <= 0) return null;
  return raw;
}

/**
 * The COD amount a courier is collecting, if the metadata carries one.
 *
 * A decimal string, kept as one — never parsed. Manual shipments carry
 * `cod_amount: "4200.00"`; the `acfake` fixtures carry no such key.
 */
export function shipmentCodAmount(shipment: SafeShipment): string | null {
  const raw = shipment.metadata.cod_amount;
  return typeof raw === "string" && raw !== "" ? raw : null;
}

/**
 * The provider's own spelling of the status, when it sent one.
 *
 * Worth rendering beside the mapped status precisely because a mis-mapping is
 * invisible otherwise: shipment 213 reads `delivered` with
 * `provider_status: "RAW_DELIVERED"`, and an adapter that mapped a state wrongly
 * would show a plausible status here and the wrong word underneath it.
 */
export function providerStatus(shipment: SafeShipment): string | null {
  const raw = shipment.metadata.provider_status;
  return typeof raw === "string" && raw !== "" ? raw : null;
}

/* -------------------------------------------------------- the rules --- */

/**
 * How wide a rule's destination is, derived from the ids rather than from
 * `specificity`.
 *
 * `specificity` is the server's ranking (measured: 3 national, 7 wilaya, 15
 * commune) and is what the list sorts by. This is the *word* for it, and it comes
 * from the ids because a numeric rank is not a label — reading "15" to a person
 * explains nothing, and mapping 3/7/15 onto three words would hard-code a
 * server-side formula the panel has no business knowing.
 */
export type RuleScope = "commune" | "wilaya" | "national";

export function ruleScope(rule: ShippingRule): RuleScope {
  if (rule.commune_id > 0) return "commune";
  if (rule.wilaya_id > 0) return "wilaya";
  return "national";
}

/**
 * Rules narrowest-first, which is the order they win in.
 *
 * Sorted by the server's own `specificity` descending, so the row at the top is
 * the one that beats the others for a destination it covers. A rules table that
 * does not show its own resolution is a table people misconfigure.
 */
export function byNarrowestFirst(rules: readonly ShippingRule[]): ShippingRule[] {
  return [...rules].sort((a, b) => b.specificity - a.specificity || a.id - b.id);
}

/**
 * Which rules could apply to a destination, narrowest first.
 *
 * The winner is `applicableRules(...)[0]`, and the rest are what it beats — which
 * is the thing the editor has to show, because "why is this destination 350 DA"
 * is answered by the rules that *lost*.
 *
 * This is the panel's own resolution and it is only ever a preview.
 * `GET /shipping/rates` is the authority and the screen shows its answer beside
 * this one; they agreed on all three fixtures (350 / 500 / 800), and if they ever
 * disagree the server is right and the screen says so.
 */
export function applicableRules(
  rules: readonly ShippingRule[],
  wilayaId: number,
  communeId: number,
): ShippingRule[] {
  const matches = rules.filter((rule) => {
    if (!rule.is_active) return false;
    if (rule.commune_id > 0 && rule.commune_id !== communeId) return false;
    if (rule.wilaya_id > 0 && rule.wilaya_id !== wilayaId) return false;
    return true;
  });

  return byNarrowestFirst(matches);
}
