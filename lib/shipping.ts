/**
 * The one value import in this module, and it is deliberate.
 *
 * Everything else here is `import type` — erased, so the file stays importable
 * from a client component without dragging Zod along. `lib/format/date.ts`
 * imports nothing but `Intl`, and `readFailure` needs it for a reason no local
 * comparison could satisfy: a shipment's `created_at` ends `+00:00`, a
 * payment's ends `Z`, and an order note's carries no offset at all. That file
 * owns the repair and is the only thing permitted to touch any of them.
 */
import { parseApiDate } from "@/lib/format/date";
import type { Order } from "@/lib/api/schemas/order";
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
/**
 * Named individually as well as listed, so a reader can be addressed by name.
 *
 * `/api/label/[id]` needs *these two specifically* — `label` is a URL and
 * `labels` is a list of them — and reaching them as `LABEL_METADATA_KEYS[0]` and
 * `[1]` would make reordering this array silently change which keys the handler
 * reads. A stripper that removes all three is order-independent; a reader that
 * wants two of them is not.
 */
export const LABEL_KEY = "label";
export const LABELS_KEY = "labels";
export const SIGNATURE_URL_KEY = "signature_url";

export const LABEL_METADATA_KEYS = [LABEL_KEY, LABELS_KEY, SIGNATURE_URL_KEY] as const;

/**
 * `Shipment & {…}` rather than `Omit<Shipment, "metadata"> & {…}`, and the
 * difference is not stylistic.
 *
 * `Shipment` comes from `z.looseObject`, which infers an index signature so that
 * an added API field is not a breaking change. `Omit` is `Pick<T, Exclude<keyof
 * T, K>>`, and `keyof` on a type with an index signature is `string | number` —
 * so `Exclude<…, "metadata">` removes nothing and `Pick` collapses every known
 * field to `unknown`. Every property read off the result then typechecks as
 * `unknown` and fails at the call site, which is how this was caught: thirteen
 * errors on `tracking_number`, `status` and `id` at once.
 *
 * Intersecting instead keeps the known fields. `metadata` is already
 * `Record<string, unknown>` on the schema, which is what the stripper returns.
 */
export type SafeShipment = Shipment & {
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
 * A provider's display name, in three fallbacks.
 *
 * **A shipment's provider is not constrained to `/shipping/providers`.** Shipment
 * 213 carries `acfake`, registered at runtime by the backend's webhook suite,
 * while the providers route reports only `manual`. A lookup that returned `""`
 * for an unknown provider would blank the column on exactly the rows worth
 * looking at.
 *
 * ## The message key comes first, and that is a correction
 *
 * The API's `label` for `manual` is **"In-house delivery"** — English, and it was
 * rendering as English on most parcel rows and three times on the rules card in
 * *both* localised panels. It is data, but so is a shipment's `status`, and the
 * panel has always translated that through `shipmentStatus` rather than printing
 * the shop's own vocabulary raw. `manual` is the same kind of word: a state of
 * this shop, not a courier's brand.
 *
 * So: **message key → API `label` → raw `name`.** `manual` reads properly in
 * French and Arabic; `acfake` — which no message file knows and no providers
 * route lists — still renders as itself rather than as a string the panel
 * invented for it. A real courier the shop configures later arrives with its own
 * brand in `label` and is shown under that, which is right: nobody translates
 * "Yalidine".
 *
 * `translated` is a parameter rather than a `useTranslations` call because this
 * module is imported by Server Components, by client components and by the unit
 * suite, and only the caller knows which of those it is in.
 */
export function providerLabel(
  name: string,
  providers: readonly ShippingProvider[],
  /** `(name) => t.has(name) ? t(name) : null`, from the `shippingProvider` namespace. */
  translated?: (name: string) => string | null,
): string {
  return (
    translated?.(name) ?? providers.find((provider) => provider.name === name)?.label ?? name
  );
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

/* ------------------------------------------- why no parcel appeared --- */

/**
 * The order's stored explanation for a confirmation that created no parcel.
 *
 * Derived from the schema rather than restated, so the shape has one owner. The
 * schema's own docblock carries where it comes from and why it is on the order
 * instead of on a response.
 */
export type ShipmentFailure = NonNullable<Order["shipping_provider_error"]>;

/**
 * The codes this system produces for itself, as opposed to a courier's own.
 *
 * `ShipmentFailure::NO_DESTINATION` and `::UNEXPECTED` are constants in
 * `Shipping/ShipmentFailure.php`; the other three are `ApiException` codes that
 * reach `fromApiException()` from inside `ShippingService::createOnConfirmation()`
 * — `ShipmentInput`/`Destination` validation, `ProviderRegistry::get()` on a
 * name the shop no longer registers, and `ShipmentRepository::claimOrder()`
 * losing a race. Read from source.
 *
 * **A courier's code is anything else**, and the set is open by construction:
 * each adapter mints its own (`yalidine_parcel_refused`,
 * `zrexpress_destination_unmapped`, `zrexpress_no_pickup_point`, …), and a
 * courier the shop configures next year will bring more. So the branch below
 * tests *membership of this list* and treats the complement as a courier
 * refusal, rather than listing courier codes — a list of those would be a
 * panel-side copy of every adapter's vocabulary and would silently mis-handle
 * the first code nobody thought of.
 */
export const OWN_FAILURE_CODES = [
  "order_destination_missing",
  "shipment_create_failed",
  "invalid_request",
  "no_shipping_provider",
  "conflict",
] as const;

export type OwnFailureCode = (typeof OWN_FAILURE_CODES)[number];

/**
 * What the operator can actually *do* about a failure, in one word.
 *
 * Two remedies, and they are two because the API has two different fixes and
 * gives them different codes on purpose — `ShipmentFailure`'s docblock says so
 * in terms: *"a code is what a panel branches on. A message is prose and gets
 * rewritten; `yalidine_parcel_refused` and `order_destination_missing` want
 * different screens."*
 *
 *   `parcel`       hand the parcel to a courier from this screen —
 *                  `POST /orders/{id}/shipments`, which takes the destination
 *                  and the courier in its own body.
 *   `destination`  correct where the order is going —
 *                  `PATCH /orders/{id}` with `wilaya_id` and `commune_id`.
 *
 * ## Why the missing destination gets the *parcel* remedy and not the obvious one
 *
 * It reads backwards until you follow the retry. `order_destination_missing`
 * means the order carries no wilaya and commune, and the two ids are now
 * writable on `PATCH /orders/{id}` — so "add the destination" looks like the
 * fix. It is the durable fix and it is **not the one that produces a parcel**:
 * `ShipmentSubscriber` runs on a WooCommerce *transition* into `processing`, the
 * order recording this failure is already in `processing`, and WooCommerce fires
 * nothing when a status is re-saved as itself. Correcting the destination
 * therefore changes nothing about *this* order until somebody walks it out of
 * `processing` and back in.
 *
 * `ShippingService::create()`'s five reasons for keeping the manual route open
 * with the first one, verbatim: *"Confirming again is one way back and it needs
 * the order to leave `processing` first; this route is the way back that does
 * not."* So the button offers the route that works now, and the screen says in
 * one line that the destination is worth fixing too.
 *
 * ## Why a courier refusal gets the destination remedy
 *
 * Because that is the field the courier is complaining about. The archetype in
 * the backend's own example is `provider_message: "commune introuvable: Ouled
 * Fayet"` — a real commune the adapter has no mapping for, or the wrong one for
 * the wilaya beside it. `OrderService::guardDestinationResolves()` deliberately
 * carries **no `is_editable` gate**, and its docblock gives this exact reason:
 * *"Both ways an order earns a `shipping_provider_error` … are recorded at
 * `processing`, which is not editable. Gating the destination would freeze it at
 * the exact moment it starts to matter."* The panel is the caller that argument
 * was written for.
 *
 * And the retry then works without any further help: a refused parcel leaves
 * **no shipment row at all** — `createClaimed()` calls the provider before it
 * writes anything — so the order has no live shipment, and the manual route or
 * the next genuine confirmation both go through.
 *
 * ## The three that get neither
 *
 * `shipment_create_failed` is `fromThrowable()`: a fixed sentence naming an
 * exception class, with the real message deliberately kept in the log where a
 * customer cannot read it. Nothing the operator retypes changes it, so the
 * screen offers the parcel route — which gets the goods moving — and does not
 * pretend a field is wrong.
 *
 * `no_shipping_provider` is a courier the shop has de-registered since the order
 * named it. The order's own `shipping_provider` is writable, but this panel has
 * no control that writes it on an existing order — the create drawer does, the
 * edit drawer does not — and the manual drawer *does* ask for a provider from
 * the live registry, so it is both the honest and the working answer.
 *
 * `conflict` is `claimOrder()`'s loser: two transitions at once, and the winner
 * created the parcel. It needs no remedy at all and `answered` below is normally
 * what a reader sees instead.
 */
export type FailureRemedy = "parcel" | "destination";

export function failureRemedy(code: string): FailureRemedy {
  return (OWN_FAILURE_CODES as readonly string[]).includes(code) ? "parcel" : "destination";
}

/**
 * How a stored failure should be read **right now** — which is not the same
 * question as what it says.
 *
 * ## The staleness the backend flagged, and the three things done about it
 *
 * `ShipmentSubscriber::clearFailure()` takes the value off the order only when
 * a confirmation finds or creates a live shipment. Nothing else clears it. So
 * the field is *last time's* answer, it survives indefinitely, and — the
 * backend's own words — **the value persists, so an undated error reads as
 * current when it is a week old.**
 *
 *  1. **`at` is never dropped.** Whatever the block renders, it renders when.
 *     `formatWhen` gives a relative phrase under a day and the absolute date
 *     after, so Tuesday's failure reads as Tuesday rather than as a sentence
 *     with no time on it.
 *  2. **An undated failure says so.** `at` is genuinely nullable —
 *     `ShipmentFailure::iso()` answers null for a stored value it cannot parse,
 *     and `fromMeta()` will build a failure out of anything carrying a `code`,
 *     because order meta is a public store another plugin can write into. A
 *     missing time rendered as a blank is precisely the *"reads as current"*
 *     failure, so `dated: false` makes the screen say the time is not recorded
 *     rather than say nothing.
 *  3. **A parcel that postdates it answers it**, and this is the one that makes
 *     `at` load-bearing rather than decorative. It is two tests, and the second
 *     is the interesting one:
 *
 *       - **any live parcel.** There is a box in the air; whatever is stored on
 *         the order is history, and a remedy button beside it is an invitation
 *         to send a second one. This is also the only test available for an
 *         undated failure.
 *       - **any parcel, terminal included, created at or after `at`.** A
 *         delivered parcel is still a parcel that went out *after* the courier
 *         refused, so somebody already dealt with it. Without this arm, an order
 *         refused on Monday, sent by hand on Tuesday and delivered on Thursday
 *         reads on Friday as though nothing had been done — which is exactly the
 *         staleness the backend flagged, wearing a different hat.
 *
 *     A parcel created **before** `at` proves nothing and is correctly ignored:
 *     that is a *later* confirmation failing, which is the state the panel most
 *     needs to show. The comparison runs on parsed dates rather than strings,
 *     because the two fields do not agree on notation — a shipment's
 *     `created_at` ends `+00:00`, a payment's ends `Z`, and only `parseApiDate`
 *     may touch either.
 *
 * All of it is computed from the shipments the screen already has rather than
 * from anything on the order, because the order carries no tracking number and
 * must not: `OrderPresenter::shippingProviderError()`'s docblock refuses the
 * second copy that could drift and points at `GET /orders/{id}/shipments` as the
 * answer to *"where is this parcel"*.
 *
 * **This is a display rule and is deliberately wider than the backend's own.**
 * `clearFailure()` erases the stored value only when a confirmation finds or
 * creates a live shipment, so the API will keep serving a failure this function
 * calls answered. That is not a disagreement about the facts — the panel can see
 * both the failure and the parcels in one render and the subscriber can only see
 * one at a time — and nothing here writes anything, so the two cannot drift.
 */
export type FailureReading =
  | { state: "none" }
  | { state: "answered"; failure: ShipmentFailure; dated: boolean }
  | { state: "open"; failure: ShipmentFailure; dated: boolean; remedy: FailureRemedy };

export function readFailure(
  failure: ShipmentFailure | null | undefined,
  shipments: readonly SafeShipment[],
): FailureReading {
  if (!failure) return { state: "none" };

  const at = parseApiDate(failure.at);
  const dated = at !== null;

  /* The same `is_live` test `createShipmentGate` runs, and deliberately through
     the same function: "is there a parcel in the air" has exactly one answer on
     this screen, and a second expression for it is a second thing to get
     wrong. */
  const live = !createShipmentGate(shipments).allowed;

  const sentSince =
    at !== null &&
    shipments.some((shipment) => {
      const made = parseApiDate(shipment.created_at);
      return made !== null && made.getTime() >= at.getTime();
    });

  if (live || sentSince) return { state: "answered", failure, dated };

  return { state: "open", failure, dated, remedy: failureRemedy(failure.code) };
}

/**
 * Whether the manual parcel route is worth offering at all — step 2's admin
 * sub-task 5, in one expression.
 *
 * **The test is `is_live` on any row of `GET /orders/{id}/shipments`**, which is
 * `createShipmentGate` and nothing new. It is restated as its own name here
 * because the *meaning* changed on this branch even though the expression did
 * not: the gate used to answer "may a parcel be created" for a screen where
 * creating one by hand was the only way it ever happened, and it now answers
 * "is the fallback needed" on a screen where confirmation does this by itself.
 *
 * History does not block and terminal parcels do not either — a cancelled,
 * failed, delivered or returned parcel leaves the order free to be sent again,
 * which `ShippingService`'s docblock calls out as what makes *"a re-send after a
 * failed delivery work without deleting history"*. Only something still in the
 * air blocks, `pending` included, because that is the case where trying again
 * really would put two boxes on two vans.
 */
export function manualParcelOffered(shipments: readonly SafeShipment[]): boolean {
  return createShipmentGate(shipments).allowed;
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
