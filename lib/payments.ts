import type { PaymentMethod } from "@/lib/api/schemas/payment";

/**
 * A payment method's display name, in three fallbacks.
 *
 * **This is `lib/shipping.ts`'s `providerLabel` defect found in a second place,
 * and the measurement is the same shape.** `GET /payments/methods` answers
 * `cod` → **"Cash on delivery"** and `chargily` → **"Chargily (EDAHABIA / CIB)"`
 * — English, re-measured 2026-08-26 — and the old payments screen resolved a
 * provider as `methods.find(…)?.label ?? name`, exactly as `ShipmentRow` used to.
 * So "Cash on delivery" was rendering on 43 of 45 ledger rows and on every
 * transaction of the order detail, in the French panel *and* in the Arabic one.
 *
 * It is data, but so is a payment's `status`, and the panel has always translated
 * that through `paymentStatus` rather than printing the shop's own vocabulary
 * raw. `cod` is the same kind of word: a way this shop takes money, not a brand.
 *
 * So: **message key → API `label` → raw `name`.**
 *
 *   `cod`       has a `paymentProvider` key and reads properly in both locales.
 *   `chargily`  has none, deliberately — it is a gateway's brand, and nobody
 *               translates "Chargily". It falls through to the API's own label,
 *               which is where the brand and its two card networks are spelled.
 *
 * A method the shop configures later arrives with its own brand in `label` and is
 * shown under that; a `provider` string on a row that `/payments/methods` does
 * not list still renders as itself rather than as a string the panel invented.
 *
 * **It does not share an implementation with the shipping one.** The signature is
 * mirrored on purpose so the two read identically at their call sites, but the
 * enumerations are different routes, different schemas and different message
 * namespaces, and a single function taking both would be a helper parameterised
 * by three things to save three lines.
 *
 * `translated` is a parameter rather than a `useTranslations` call because this
 * module is imported by Server Components, by client components and by the unit
 * suite, and only the caller knows which of those it is in.
 */
export function providerLabel(
  name: string,
  methods: readonly PaymentMethod[],
  /** `(name) => t.has(name) ? t(name) : null`, from the `paymentProvider` namespace. */
  translated?: (name: string) => string | null,
): string {
  return (
    translated?.(name) ?? methods.find((method) => method.name === name)?.label ?? name
  );
}
