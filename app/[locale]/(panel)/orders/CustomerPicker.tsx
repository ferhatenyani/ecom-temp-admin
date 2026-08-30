"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";
import type { Customer } from "@/lib/api/schemas/customer";
import { customerRef } from "@/lib/customers";
import { Switch } from "@/components/ui/Form";
import { SearchField } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/States";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Isolate, Ltr } from "@/components/primitives/Ltr";

/**
 * Who an order belongs to: a guest switch, and a search for the shopper it does.
 *
 * Lifted out of `NewOrderDrawer` when the edit drawer became the second form to
 * need it, for `AddressFields`' reason and no other — a second copy of a query,
 * a result row and a guest switch drifts, and the copy that gets fixed is the
 * one whose screen somebody happened to open.
 *
 * ## What is deliberately *not* in here: what choosing a customer does next
 *
 * The two forms answer that differently and both answers are right. The create
 * drawer copies the customer's billing block into a block nobody has typed in,
 * because a blank form has nothing to lose. The edit drawer copies nothing: the
 * order already carries the address the shopper gave at the time, and
 * re-attributing an order to another account must not silently rewrite where it
 * is being delivered. So `onChoose` hands the whole `Customer` back and the form
 * decides — which also keeps this component free of any opinion about drafts.
 *
 * ## `null` is the guest, here and in both drafts
 *
 * The API's guest value is `0` and `customer_id: 0` is what a guest order reads
 * back as. `null` is used in the panel's drafts instead, because "no customer"
 * is an absence rather than a customer numbered zero — `new-order.ts`'s
 * `buildPayload` makes the same call for the create body — and the mapping back
 * to `0` happens once, at the payload boundary, in each form's builder.
 */

const PER_PAGE = 8;

export function CustomerPicker({
  /**
   * The guest switch's DOM id, so an `ErrorSummary` can link a 400 naming
   * `customer_id` to the one control on this block that produced it. Optional:
   * a form whose summary does not link here does not have to name it.
   */
  id,
  customerId,
  /** The guest switch. `null` is a guest order; see the docblock. */
  onChange,
  /** A row was pressed. The form decides what else that implies. */
  onChoose,
  /**
   * `ac_manage_customers`. Every role holding `ac_manage_orders` also holds this
   * one today, so the fallback is a guard rather than a live path — unlike the
   * product picker, whose missing capability is a role people actually have.
   */
  canPick,
  /** Nothing is fetched until the overlay holding this is open. */
  enabled,
  /** A 400 naming `customer_id` — an id the API could not resolve to a user. */
  error,
  disabled = false,
}: {
  id?: string;
  customerId: number | null;
  onChange: (next: number | null) => void;
  onChoose: (customer: Customer) => void;
  canPick: boolean;
  enabled: boolean;
  error?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("orders.customer");
  const tOrders = useTranslations("orders");

  const [search, setSearch] = useState("");

  /* Submit-gated, and idle until somebody types: reads are 600/min per
     credential, shared across every tab the shop has open. */
  const customers = useQuery({
    queryKey: ["orders", "customer-picker", search],
    enabled: enabled && canPick && search !== "",
    queryFn: () =>
      acRead<Customer[]>(
        `/customers?per_page=${PER_PAGE}&search=${encodeURIComponent(search)}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-3">
      <Switch
        id={id}
        label={t("guest")}
        hint={t("guestWhy")}
        checked={customerId === null}
        onChange={(guest) => onChange(guest ? null : customerId)}
        error={error}
        disabled={disabled}
      />

      {customerId !== null ? (
        <p className="text-ui-compact text-ui-fg">
          <Isolate numeric>{t("chosen", { id: customerId })}</Isolate>
        </p>
      ) : null}

      {customerId === null && canPick && !disabled ? (
        <>
          <SearchField
            value={search}
            onSubmit={setSearch}
            placeholder={t("search")}
            label={t("search")}
            clearLabel={tOrders("clearSearch")}
          />
          {search !== "" ? (
            customers.isPending ? (
              <SkeletonRegion label={t("loading")} className="flex flex-col gap-1">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="ui-field w-full rounded-ui-md" />
                ))}
              </SkeletonRegion>
            ) : (customers.data?.data ?? []).length === 0 ? (
              <EmptyState icon="search" message={t("noResults")} />
            ) : (
              <ul className="flex flex-col gap-1">
                {(customers.data?.data ?? []).map((customer) => {
                  /*
                    **The address leads and the name is secondary**, which is the
                    opposite of the customers list and is measured rather than a
                    preference: 12 of the 16 live customers in this shop have
                    neither a first nor a last name, so a row built name-first
                    renders blank for the ordinary case. `customerRef` is the
                    helper that decided this and the campaign composer's picker
                    already follows it.
                  */
                  const ref = customerRef(customer);
                  return (
                    <li key={ref.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChoose(customer);
                          setSearch("");
                        }}
                        className="ui-field ui-interactive ui-ring ui-hover-fill flex w-full cursor-pointer flex-col justify-center rounded-ui-md px-2 text-start text-ui-compact text-ui-fg"
                      >
                        <span className="truncate">
                          <Ltr numeric={false}>{ref.email}</Ltr>
                        </span>
                        {ref.name !== null ? (
                          <span dir="auto" className="truncate text-ui-caption text-ui-subtle">
                            {ref.name}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}
