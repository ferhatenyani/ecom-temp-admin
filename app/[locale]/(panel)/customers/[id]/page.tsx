import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { customerDetail } from "@/lib/api/schemas/customer";
import { orderList, type Order } from "@/lib/api/schemas/order";
import { notificationList, type Notification } from "@/lib/api/schemas/notification";
import { canSeeMoney, has } from "@/lib/capabilities";
import { customerName, hasNoOrders } from "@/lib/customers";
import { formatDate } from "@/lib/format/date";
import { SHOP_CURRENCY } from "@/lib/format/money";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { DetailGrid } from "@/components/ui/Detail";
import { ForbiddenState } from "@/components/ui/States";
import { Isolate } from "@/components/primitives/Ltr";
import { customerOrdersParams } from "../query";
import { customerNotificationsParams } from "../../notifications/query";
import { IdentityCard } from "./IdentityCard";
import { ConsentCard } from "./ConsentCard";
import { AddressCards } from "./AddressCards";
import { StatisticsCard } from "./StatisticsCard";
import { CustomerOrders } from "./CustomerOrders";
import { NotificationsSection } from "./NotificationsSection";

/**
 * One customer: who they are, what they have bought, and what they agreed to.
 *
 * ## The detail is not the list row
 *
 * `GET /customers/{id}` carries a `statistics` block that `GET /customers` omits
 * — the first collection in this panel where the two routes disagree, and the
 * reason `CustomerDetail` is its own type rather than the row with an optional
 * field. It is also why this screen has no peek drawer on the list in front of
 * it: a preview costs a request and the thing it would show is this block.
 *
 * ## Two columns, and which side a thing lands on
 *
 * `DetailGrid`: main `1fr` plus a 360px aside at `lg`+, the aside collapsing
 * **below** main. The split is by *shape*, not by importance:
 *
 *   main    the statistics report, this customer's orders, their notification
 *           queue — the unboundedly-growing things, two of them paged.
 *   aside   identity, consent, addresses, dates and the id — fixed-height
 *           reference material a person glances at while reading the main column.
 *
 * ## Three stacked cards in main, and no tabs
 *
 * `Segmented` is retired and nothing replaces it. The screen this rebuilds put
 * the orders and the notifications behind two of its three segments, which hides
 * content behind a click on a screen that is **empty for 11 of the 16
 * customers** — a tab you open to find nothing in it is the worst version of
 * that trade.
 *
 * The requests those tabs were deferring are still not spent for nothing. Both
 * are conditional here: the orders read is skipped entirely when
 * `statistics.total_orders` is 0, because the report already answers that
 * question; the notifications read is skipped when there is no address to join
 * on. Each is caught alone, so `null` (this section could not load) stays
 * distinct from `[]` (there is nothing here) — the order detail's arrangement.
 *
 * ## What is deliberately absent
 *
 * **No writes.** `PATCH /customers/{id}` is allowlisted and specified and has
 * never been built, and this screen is a migration rather than a new feature. So
 * there is no primary action in the header, no `SaveBar` and no `ConfirmDialog`.
 * `marketing_consent` in particular is refused on PATCH **by design** — consent
 * is the customer's to give — and `ConsentCard` renders the reason rather than a
 * disabled toggle.
 *
 * **No stale marker**, which is the one item of §3.7 this screen does not carry
 * and it is an argued omission rather than an oversight. The marker exists to
 * pair an age with the writes it disables; there are no writes here, nothing on
 * this screen polls, and there is no refresh control — so the data is exactly as
 * old as the navigation that fetched it, and a banner saying so would be true and
 * useless. The two paged sections surface their own failure inline if the network
 * goes while somebody is paging.
 */
export default async function CustomerPage({
  params,
}: {
  /** `params` is a Promise in Next 16, like `searchParams` and `cookies()`. */
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("customers");

  /*
   * **The roles invert between this screen and coupons.** Measured 2026-08-19: a
   * Support Agent — the thinnest role in the system — holds `ac_manage_customers`
   * and reads all three customer routes, while a Marketing Manager is 403 on
   * every one of them and reads coupons perfectly well. A 403 is a screen state,
   * never a logout; only a 401 clears the session.
   */
  if (!has(me, "ac_manage_customers")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={t("title")}
          back={{ href: `/${locale}/customers`, label: t("title") }}
          divided={false}
        />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_customers" />
        </PageBody>
      </div>
    );
  }

  // The route is `\d+` at the proxy and in the API's own pattern; anything else
  // never reaches either.
  if (!/^\d+$/.test(id)) notFound();

  /*
   * A staff id here is a 404, not a leak. `GET /customers/1` — the administrator —
   * answers `404 "No customer with that id."`, because the repository filters on
   * `role: customer`; all 16 rows in the list are customers and there is no
   * parameter that widens it (`?role=administrator` is ignored with a 200 and the
   * same 16 rows). So typing a user id into this URL lands on the not-found
   * screen instead of disclosing whether that account exists, which is the answer
   * an id-guessing probe wants. Staff accounts are §87's `/users`.
   */
  const customer = await acFetch(customerDetail, session, `/customers/${id}`)
    .then((response) => response.data)
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    });

  const numericId = customer.id;
  const email = customer.email;
  /* The report answers "has this person bought anything" without a second
     request — 11 of the 16 have not — so the orders read is not made for them. */
  const anyOrders = !hasNoOrders(customer.statistics);

  const [ordersResponse, notificationsResponse] = await Promise.all([
    anyOrders
      ? acFetch(
          orderList,
          session,
          `/customers/${numericId}/orders?${customerOrdersParams("", 1)}`,
        ).catch(() => null)
      : Promise.resolve(null),
    email !== ""
      ? acFetch(
          notificationList,
          session,
          `/notifications?${customerNotificationsParams(email, 1)}`,
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  /** `meta.total` when the envelope carried one, the page length otherwise. */
  const totalOf = (
    response: { data: Order[] | Notification[]; meta: Record<string, unknown> | null } | null,
  ): number => {
    if (response === null) return 0;
    const parsed = response.meta ? listMeta.safeParse(response.meta) : null;
    return parsed?.success ? parsed.data.total : response.data.length;
  };

  const name = customerName(customer);

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        /* The record's own name, which `customerName()` decides — 12 of the 16
           have none and fall back to the login. `PageHeader` puts `dir="auto"`
           on the heading, so an Arabic name and a Latin login each resolve their
           own direction. */
        title={name.text}
        /* The registration date rather than the e-mail: for the twelve nameless
           customers the title *is* the login and the e-mail is that login plus a
           domain, so a subtitle carrying it would print nearly the same string
           twice within twenty pixels. A translated sentence around an `Intl`
           date, so `Isolate`. */
        subtitle={
          <Isolate>
            {t("registeredOn", { date: formatDate(customer.date_created, locale, false) })}
          </Isolate>
        }
        back={{ href: `/${locale}/customers`, label: t("title") }}
        /* A detail page omits the rule and lets the first card do the
           separating — §2.4. There is no action beside it: nothing on this
           screen writes. */
        divided={false}
      />

      <PageBody width="split">
        <DetailGrid
          main={
            <>
              <StatisticsCard
                statistics={customer.statistics}
                currency={SHOP_CURRENCY}
                locale={locale}
                /*
                 * **The money gate is the panel's own decision, not the API's** —
                 * a Support Agent reads `total_revenue` from this endpoint with a
                 * 200. `StatisticsCard` carries the full argument.
                 */
                canSeeMoney={canSeeMoney(me)}
              />

              {anyOrders ? (
                <CustomerOrders
                  locale={locale}
                  customerId={numericId}
                  currency={SHOP_CURRENCY}
                  initialOrders={ordersResponse?.data ?? null}
                  initialTotal={totalOf(ordersResponse)}
                />
              ) : null}

              {/*
                **The same capability, which is why this is here at all.**
                `/notifications` is gated on `ac_manage_customers` — §90 gates it
                on the capability that already reads a customer's record rather
                than inventing one — so anybody who can open this screen can read
                this section, and a second check would be neither needed nor
                honest.
              */}
              <NotificationsSection
                locale={locale}
                email={email}
                initialNotifications={notificationsResponse?.data ?? null}
                initialTotal={totalOf(notificationsResponse)}
              />
            </>
          }
          aside={
            <>
              <IdentityCard customer={customer} locale={locale} />
              <ConsentCard customer={customer} locale={locale} />
              <AddressCards customer={customer} />
            </>
          }
        />
      </PageBody>
    </div>
  );
}
