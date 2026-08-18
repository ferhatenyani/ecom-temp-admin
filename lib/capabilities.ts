import type { Identity } from "@/lib/api/schemas/order";

/**
 * Capabilities are for rendering, never for access.
 *
 * `AuthController` says it in its own docblock and it bears repeating: a client
 * that hides a button is a convenience, not a security boundary. Every route
 * enforces its own `permission_callback`, and the panel's job is to make a user
 * who types a URL they cannot use land on a clean forbidden screen rather than a
 * broken one.
 *
 * Named predicates, never capability strings compared inline in a component.
 * There are two compound rules today and the third gets added in one place.
 */

export const CAPABILITIES = [
  "ac_manage_products",
  "ac_manage_inventory",
  "ac_manage_orders",
  "ac_manage_customers",
  "ac_manage_coupons",
  "ac_manage_shipping",
  "ac_manage_payments",
  "ac_manage_content",
  "ac_manage_marketing",
  "ac_view_analytics",
  "ac_manage_settings",
  "ac_manage_users",
  "ac_view_audit_logs",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function has(me: Identity | null, capability: Capability): boolean {
  return me?.capabilities.includes(capability) ?? false;
}

export function canManageOrders(me: Identity | null): boolean {
  return has(me, "ac_manage_orders");
}

/**
 * Compound rule one. Money in analytics needs `ac_view_analytics` **and**
 * `ac_manage_orders`: without the second, `/analytics/revenue` is a 403 and every
 * other analytics response omits its money block and says so in
 * `meta.money_visible`. The dashboard must render a coherent screen in that
 * state — counts and rates, and no empty currency-shaped holes.
 */
export function canSeeMoney(me: Identity | null): boolean {
  return has(me, "ac_view_analytics") && has(me, "ac_manage_orders");
}

/**
 * Compound rule two. Sending a campaign needs `ac_manage_marketing` **and**
 * `ac_manage_customers`. A Marketing Manager can draft, preview and test-send and
 * gets a 403 from `send`; docs/API.md says it outright — a 403 from `send` with a
 * 201 from `POST /campaigns` is not a bug. The composer renders the send button
 * disabled with the reason, not hidden, because a hidden button makes a Marketing
 * Manager think the feature is broken.
 */
export function canSendCampaigns(me: Identity | null): boolean {
  return has(me, "ac_manage_marketing") && has(me, "ac_manage_customers");
}

/** Super Admin only, and the forbidden state names the role, not the string. */
export function canManageUsers(me: Identity | null): boolean {
  return has(me, "ac_manage_users");
}

export function canManageSettings(me: Identity | null): boolean {
  return has(me, "ac_manage_settings");
}
