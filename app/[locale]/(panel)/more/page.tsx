import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { has, type Capability } from "@/lib/capabilities";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ListGroup, ListLinkRow, ListRow } from "@/components/primitives/GroupedList";
import { Icon, type IconName } from "@/components/primitives/Icon";

/**
 * The More tab, which until now navigated nowhere.
 *
 * The tab bar holds five and a sixth crosses 70px per tab at the 390px floor,
 * where the labels start wrapping and push the bar taller. Orders, Products,
 * Dashboard and Inventory take four of the five slots, so Customers and Coupons
 * have nowhere else to be — and a section nobody can reach is a section that is
 * not shipped.
 *
 * This is the iOS grammar for exactly that: `UITabBarController` puts the
 * overflow behind a More tab rather than shrinking the bar. The sidebar at `md`
 * and up shows the same tree.
 *
 * The unbuilt destinations are listed too, inert, with a line saying why. They
 * were already rendering as disabled tabs; hiding them here instead would make
 * the navigation quietly disagree with itself, and the specification is public —
 * a person who has read it will look for Shipping and deserves to be told it is
 * not built rather than to conclude they lack the capability.
 */

type Destination = {
  key: string;
  href: string | null;
  icon: IconName;
  capability: Capability;
};

const DESTINATIONS: Destination[] = [
  { key: "customers", href: "/customers", icon: "customers", capability: "ac_manage_customers" },
  /*
   * Notifications sits beside Customers because it *is* Customers' capability —
   * `ac_manage_customers`, measured, with a Manager 200 and a Marketing Manager
   * 403 on both. §90 gates it there on purpose: a row holds a customer's address
   * and the frozen body of their order confirmation.
   *
   * A top-level destination **and** a tab on the customer detail, sharing one
   * reader. The two answer different questions — "is the queue healthy" against
   * "was this person told" — and the second cannot be reached from the first: a
   * queue read newest-first has no route to one customer's history without a
   * filter, which is why `?recipient=` was added to the API on this branch.
   */
  {
    key: "notifications",
    href: "/notifications",
    icon: "mail",
    capability: "ac_manage_customers",
  },
  { key: "coupons", href: "/coupons", icon: "tag", capability: "ac_manage_coupons" },
  { key: "shipping", href: "/shipping", icon: "box", capability: "ac_manage_shipping" },
  /*
   * Payments is `ac_manage_payments`, which after the two-tier collapse is the
   * Super Admin tier alone — 25 of the 70 staff accounts on this install.
   *
   * That was a real design question while it was one role in six: a destination
   * five of six roles see refused is a navigation that mostly lies. Two tiers
   * make it ordinary. The filter below already omits a destination the person
   * cannot use, so a Manager's More list simply does not carry this row — the
   * same treatment Coupons gets for a role without `ac_manage_coupons`, rather
   * than a special case.
   */
  { key: "payments", href: "/payments", icon: "note", capability: "ac_manage_payments" },
  /*
   * The six reports. Separate from the Dashboard tab and not a duplicate of it:
   * the dashboard is cards that drill into a filtered list, this is the reports
   * themselves. They share a capability and a date range and nothing else.
   */
  { key: "analytics", href: "/analytics", icon: "dashboard", capability: "ac_view_analytics" },
  /*
   * Content became a link on the content branch. It is a hub rather than a
   * single screen — pages, the homepage document, banners, FAQs, menus and the
   * media library — because six destinations do not fit a segmented control at
   * the 390px floor and share no row shape.
   */
  { key: "content", href: "/content", icon: "note", capability: "ac_manage_content" },
  { key: "settings", href: null, icon: "lock", capability: "ac_manage_settings" },
];

export default async function MorePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { me } = await requireSession(locale);
  const t = await getTranslations("nav");

  /*
   * Capabilities decide what renders, never what is permitted — every route
   * enforces its own. A destination the person cannot use is left out rather than
   * shown disabled: unlike the unbuilt ones below, "you do not have this" is not
   * a fact about the panel, and a Support Agent does not need a list of the six
   * sections they will never open.
   */
  const permitted = DESTINATIONS.filter((destination) => has(me, destination.capability));
  const built = permitted.filter((destination) => destination.href !== null);
  const unbuilt = permitted.filter((destination) => destination.href === null);

  return (
    <Scaffold title={t("moreTitle")}>
      <div className="mx-auto max-w-3xl px-4">
        {built.length > 0 ? (
          <ListGroup title={t("built")}>
            {built.map((destination) => (
              <ListLinkRow
                key={destination.key}
                href={`/${locale}${destination.href}`}
                ariaLabel={t(destination.key)}
              >
                <span className="flex items-center gap-3">
                  <Icon name={destination.icon} className="size-5 shrink-0 text-accent" />
                  <span className="truncate text-body text-label">{t(destination.key)}</span>
                </span>
              </ListLinkRow>
            ))}
          </ListGroup>
        ) : null}

        {unbuilt.length > 0 ? (
          <ListGroup title={t("notBuilt")} footnote={t("notBuiltNote")}>
            {unbuilt.map((destination) => (
              <ListRow key={destination.key} className="opacity-40">
                <Icon
                  name={destination.icon}
                  className="size-5 shrink-0 text-label-secondary"
                />
                <span className="truncate text-body text-label">{t(destination.key)}</span>
              </ListRow>
            ))}
          </ListGroup>
        ) : null}
      </div>
    </Scaffold>
  );
}
