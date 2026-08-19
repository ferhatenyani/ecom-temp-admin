import type { Customer, CustomerStatistics } from "@/lib/api/schemas/customer";

/**
 * What a customer row and a customer detail need to know, in one place.
 *
 * Types only from the schema module — `import type` is erased, so this file stays
 * importable from a client component without dragging Zod along, the same
 * arrangement `lib/products.ts` and `lib/inventory.ts` use.
 */

/* ------------------------------------------------------------ the name --- */

/**
 * What to call a customer.
 *
 * **12 of the 16 customers in this shop have no name at all** — `first_name` and
 * `last_name` are both `""` — so a list that renders the name as the row's
 * identity renders twelve blank rows. The fallbacks are ordered by how much they
 * tell a person looking for someone:
 *
 *   named      "Amina Benali"
 *   username   "ac_cus_shopper" — what `orderby=display_name` actually sorts by
 *   email      the last resort, and never empty: the API refuses to clear it
 *
 * Returned as a discriminated union rather than a bare string so the row can
 * *style* the fallback differently. A username rendered at the same weight as a
 * real name reads as a person called ac_cus_shopper.
 */
export type CustomerName =
  | { kind: "name"; text: string }
  | { kind: "username"; text: string }
  | { kind: "email"; text: string };

export function customerName(customer: Customer): CustomerName {
  const full = [customer.first_name, customer.last_name]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");

  if (full !== "") return { kind: "name", text: full };
  if (customer.username.trim() !== "") return { kind: "username", text: customer.username };
  return { kind: "email", text: customer.email };
}

/**
 * Whether the search box can find this customer by the name on their row.
 *
 * **It cannot, and the measurement is unambiguous.** `?search=` matches
 * `user_login`, `user_email` and `display_name` — not `first_name` or
 * `last_name`. Proven with a positive control on 2026-08-19: customer 26 was
 * given the names `Zqxwvu Plmokn`, `?search=Zqxwvu` returned 0 rows, and
 * `?search=cus_fresh` returned 1. `?search=Chérif` appearing to work is MySQL's
 * accent-insensitive collation matching the *email* `nadia.cherif@…`.
 *
 * So Amina Benali — the shop's one richly-populated customer — cannot be found by
 * typing her name, and a search box labelled "search customers" is a lie a person
 * discovers by failing to find someone. The field says what it matches instead.
 *
 * Exported as a predicate rather than left as a comment because the empty state
 * uses it: when a search returns nothing and the term looks like a personal name,
 * the screen says why rather than "no results".
 */
export function searchMatchesName(customer: Customer, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle === "") return false;

  const name = `${customer.first_name} ${customer.last_name}`.toLowerCase();
  const searchable = `${customer.username} ${customer.email}`.toLowerCase();

  return name.includes(needle) && !searchable.includes(needle);
}

/* --------------------------------------------------------- the consent --- */

/**
 * The marketing-consent record, as something a screen can state in one line.
 *
 * docs/ADMIN_PANEL.md asked for "a read-only row with the date and the reason it
 * cannot be changed here", and when this branch started **there was no date** —
 * the payload carried a bare `marketing_consent: false` and nothing else, the
 * refusal message was the generic `"Unknown field."`, and 0 of 16 customers had
 * ever consented, so the affirmative state could not be seen at all.
 *
 * All three were fixed in the API rather than worked around here, because the
 * alternative was a screen that answers "may I email this person?" with a word
 * and no way to check it. The timestamp turned out to be already stored and never
 * presented; the source was in the audit log, which stops at Admin while a
 * customer record is read by Support Agent.
 *
 * Four states, and the two negatives are **not** the same answer:
 *
 *   granted    yes, since a date
 *   withdrawn  no — they had consented and took it back on a date
 *   declined   no, recorded, with no consent ever given (a source but no grant)
 *   never      no record at all: they were never asked
 *
 * A bare `false` collapses the last three, and "we never asked" is the one that
 * changes what a shop should do next.
 */
export type ConsentRecord =
  | { state: "granted"; at: string; source: string | null }
  | { state: "withdrawn"; at: string; source: string | null }
  | { state: "never" };

export function consentRecord(customer: Customer): ConsentRecord {
  const at = customer.marketing_consent_at;

  // No date means nothing has ever been recorded — the flag has only ever been
  // its default. `at` is written for both directions, so its absence is the one
  // reliable signal that no decision exists.
  if (at === null || at === "") return { state: "never" };

  return {
    state: customer.marketing_consent ? "granted" : "withdrawn",
    at,
    source: customer.marketing_consent_source,
  };
}

/* ------------------------------------------------------ the statistics --- */

/**
 * A statistics figure, carrying the thing it counts.
 *
 * **This type exists because two of the numbers do not divide.** `total_orders`
 * is 5 and `average_order_value` is 1050 against a `total_revenue` of 2100 —
 * 2100 ÷ 5 is 420, and that is the arithmetic a reader performs when the figures
 * sit side by side without saying what each counts. The API is self-consistent:
 * revenue is the sum of the *completed* orders and the average is over the same
 * two. Only labelling can make that visible.
 *
 * So a figure is never rendered without its scope, and `scope` is not optional —
 * a caller cannot print one of these without having said what it counts.
 */
export type StatFigure = {
  key: "total_orders" | "completed_orders" | "total_revenue" | "average_order_value";
  /** `"all"` counts every order; `"completed"` counts only the completed ones. */
  scope: "all" | "completed";
  money: boolean;
  value: string;
};

export function statFigures(statistics: CustomerStatistics): StatFigure[] {
  return [
    {
      key: "total_orders",
      scope: "all",
      money: false,
      value: String(statistics.total_orders),
    },
    {
      key: "completed_orders",
      scope: "completed",
      money: false,
      value: String(statistics.completed_orders),
    },
    {
      key: "total_revenue",
      scope: "completed",
      money: true,
      value: statistics.total_revenue,
    },
    {
      key: "average_order_value",
      scope: "completed",
      money: true,
      value: statistics.average_order_value,
    },
  ];
}

/**
 * The status breakdown, with the zeros dropped.
 *
 * `by_status` reports all seven statuses including the ones at zero, and it sums
 * exactly to `total_orders` — verified: 0+1+0+2+1+1+0 = 5. Rendering all seven
 * would put five zeros beside two real numbers on a 390px screen; the sum is the
 * property worth keeping, and it survives dropping the zeros because they add
 * nothing to it.
 *
 * This is the block that explains why revenue counts fewer orders than the
 * customer placed, which is the whole reason it is on the screen rather than
 * behind a tap.
 */
export function statusBreakdown(
  statistics: CustomerStatistics,
): { status: string; count: number }[] {
  return Object.entries(statistics.by_status)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }));
}

/** True when the customer has never ordered — 11 of the 16, so it is the common case. */
export function hasNoOrders(statistics: CustomerStatistics): boolean {
  return statistics.total_orders === 0;
}

/* ---------------------------------------------------------- the address --- */

/**
 * Whether an address has anything in it.
 *
 * Every field is a string and an unset address is eleven empty ones, never null —
 * so `billing !== null` proves nothing and a card rendered on that test is eleven
 * blank rows. `shipping` is empty on all but one customer here.
 */
export function hasAddress(address: Record<string, unknown>): boolean {
  /*
   * `Record<string, unknown>` rather than the `Address` type: the schema is a
   * `looseObject`, so its index signature is `unknown` and a narrower parameter
   * would not accept the very thing this is called with. The guard below is what
   * makes that safe — a non-string value cannot make an address look populated.
   *
   * `email` is excluded because a billing email is not an address. Every customer
   * has one on the account, and counting it would render an address card
   * containing one row that is not part of any address.
   */
  return Object.entries(address).some(
    ([key, value]) => key !== "email" && typeof value === "string" && value.trim() !== "",
  );
}

/**
 * The address lines worth printing, in reading order, with the empties dropped.
 *
 * Returned as a list rather than a joined string so the caller decides the
 * separator — and so a `<br>`-joined block does not inherit a stray comma from an
 * absent line.
 */
export function addressLines(address: {
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
}): string[] {
  return [
    address.address_1,
    address.address_2,
    [address.postcode, address.city].filter((part) => part.trim() !== "").join(" "),
    address.state,
  ]
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
