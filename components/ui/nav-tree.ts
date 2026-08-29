import type { IconName } from "@/components/primitives/Icon";
import type { Capability } from "@/lib/capabilities";

/**
 * The navigation tree — one definition, rendered by the sidebar, the mobile
 * drawer and (later) the command palette.
 *
 * The old `TabBar` held five slots and pushed everything else behind a `More`
 * screen. That is a phone constraint, and it meant fifteen of the panel's twenty
 * destinations were two navigations deep on every device including a 1920px
 * monitor. Grouping by domain costs nothing and makes all of them one click.
 *
 * `capability` gates rendering only — the route refuses an unauthorised request
 * regardless. A destination the session cannot use is **not rendered**, never
 * rendered disabled: a greyed-out row a person can never enable is a dead end
 * that invites a support ticket.
 */

export type NavItem = {
  key: string;
  href: string;
  icon: IconName;
  /** The capability that reveals it. Undefined means everyone sees it. */
  capability?: Capability;
};

export type NavGroup = {
  key: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    key: "commerce",
    items: [
      { key: "orders", href: "/orders", icon: "orders", capability: "ac_manage_orders" },
      { key: "customers", href: "/customers", icon: "customers", capability: "ac_manage_customers" },
      { key: "coupons", href: "/coupons", icon: "tag", capability: "ac_manage_coupons" },
      { key: "shipping", href: "/shipping", icon: "box", capability: "ac_manage_shipping" },
      { key: "payments", href: "/payments", icon: "note", capability: "ac_manage_payments" },
    ],
  },
  {
    key: "catalog",
    items: [
      { key: "products", href: "/products", icon: "products", capability: "ac_manage_products" },
      { key: "inventory", href: "/inventory", icon: "box", capability: "ac_manage_inventory" },
      { key: "media", href: "/media", icon: "image", capability: "ac_manage_content" },
    ],
  },
  {
    key: "engage",
    items: [
      { key: "marketing", href: "/marketing", icon: "mail", capability: "ac_manage_marketing" },
      /* `ac_manage_customers`, which is what `/notifications` refuses without —
         the queue is customer correspondence and shares the capability rather
         than holding one of its own. It had none, so for a session without it
         this entry's only possible outcome was the forbidden screen: the
         `/dashboard` defect the dashboard branch fixed, one row down and
         invisible until the mock started gating the capability it shares. */
      { key: "notifications", href: "/notifications", icon: "mail", capability: "ac_manage_customers" },
      { key: "content", href: "/content", icon: "list", capability: "ac_manage_content" },
    ],
  },
  {
    key: "insight",
    items: [
      /*
       * **`ac_view_analytics`, and its absence was a live defect.** This entry
       * carried no capability while `/dashboard` refuses without that one — so a
       * session lacking it was shown a nav item whose only possible outcome was
       * the forbidden screen. That is the standing rule this file's own docblock
       * states, broken by the one route in the group that had no gate written on
       * it. `/analytics` beside it has held the same capability all along.
       */
      { key: "dashboard", href: "/dashboard", icon: "dashboard", capability: "ac_view_analytics" },
      { key: "analytics", href: "/analytics", icon: "dashboard", capability: "ac_view_analytics" },
    ],
  },
  {
    key: "admin",
    items: [
      { key: "staff", href: "/users", icon: "user", capability: "ac_manage_users" },
      { key: "settings", href: "/settings", icon: "note", capability: "ac_manage_settings" },
      /*
       * **`ac_manage_products`, and `ac_manage_settings` was wrong in both
       * directions.** This is `dashboard`'s defect two lines up the same file
       * (DECISIONS.md §11), and `more/page.tsx:95-113` had already spent fourteen
       * lines arguing the right gate — the two files were silently disagreeing.
       *
       * `/transfer` has **no capability of its own**: capability follows the
       * resource, so `/export/products` is `ac_manage_products` and
       * `/export/customers` is `ac_manage_customers`, and the screen renders the
       * subjects the reader holds. `ac_manage_settings` is not one of the four.
       * Photographed under `MOCK_IDENTITY=no_transfer`: the entry was present and
       * highlighted for a reader who can do nothing here — and a Manager holding
       * `ac_manage_products` but not `ac_manage_settings` got **no entry at all**
       * for a screen serving them all four exports.
       *
       * `ac_manage_products` is the widest of the four and the closest honest
       * approximation, which is `more/page.tsx`'s conclusion. **The residue is
       * real and is recorded rather than papered over:** no single capability
       * expresses a per-subject gate, so a reader holding only
       * `ac_manage_customers` still reaches the screen by URL and gets their one
       * export. That is the honest outcome — the screen refuses nobody it can
       * serve — and it is why this entry is an approximation rather than a gate.
       */
      { key: "transfer", href: "/transfer", icon: "download", capability: "ac_manage_products" },
      { key: "audit", href: "/audit", icon: "clock", capability: "ac_view_audit_logs" },
    ],
  },
];

/**
 * Active-state test. `startsWith` on the full localised href rather than an
 * equality check, so `/orders/10482` still lights `Orders` — and never a bare
 * `/{locale}`, which would prefix-match every path in the panel and light every
 * item at once. That bug is why the old tab bar pointed `Dashboard` at
 * `/dashboard` rather than at the panel root.
 */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
