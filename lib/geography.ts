/**
 * Reading a place's name in the reader's language.
 *
 * One function, and it is a module rather than an export of the screen that
 * happened to need it first. `placeName` lived in
 * `app/[locale]/(panel)/orders/DestinationFields.tsx` from the order-entry
 * branch, which was right while every caller was an order screen and stopped
 * being right the moment a **marketing** screen needed it: the segment criteria
 * form draws a wilaya picker, and importing a client component out of
 * `(panel)/orders/` to get a six-line pure function is the kind of edge that
 * makes a section's boundary meaningless.
 *
 * The move is the `DuplicateAction.tsx` test applied to a function instead of a
 * component — *a block used from two places is a file so the two cannot drift* —
 * and here the drift has already happened four times over. `CreateParcelDrawer`,
 * `Resolver` and `RuleForm` each declare a private `wilayaName` of their own and
 * `AddressFields` inlines the same expression inside `wilayaOptions`; none of
 * them is wrong today and none of them is reached by a fix to this rule. This
 * branch does not rewrite those four — they belong to the orders and shipping
 * screens and are being edited on other steps of this run — but it gives the
 * fifth caller somewhere correct to import from rather than adding a fifth copy.
 *
 * No dependencies, deliberately, for `lib/campaigns.ts`'s reason: a client
 * component imports a value from here without pulling anything into the browser
 * bundle that a server module would have dragged behind it.
 */

/**
 * Arabic where there is an Arabic name, and the Latin one where there is not.
 *
 * **The fallback is the whole of it.** `GeoRepository::hydrateWilaya()` casts
 * `name_ar` with `(string)`, so an unfilled column arrives as `""` rather than
 * as null — a control bound straight to `name_ar` in the Arabic panel would
 * render a blank option for any place whose Arabic name was never sourced, and a
 * blank option is indistinguishable from a broken list. The Latin name is always
 * present, so it is what an empty Arabic one falls back to.
 *
 * Takes the structural minimum rather than a `Wilaya`, so it serves a commune —
 * which carries the same two columns and has no Zod schema anywhere in
 * `lib/api/schemas` — without either of them importing the other's type.
 */
export function placeName(
  place: { name: string; name_ar: string },
  locale: string,
): string {
  return locale === "ar" && place.name_ar !== "" ? place.name_ar : place.name;
}
