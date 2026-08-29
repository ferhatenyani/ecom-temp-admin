"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Role, StaffUser } from "@/lib/api/schemas/staff";
import { acRead } from "@/lib/api/browser";
import { assignableRoles, staffName } from "@/lib/staff";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableControls,
  TableFooter,
  useTablePreferences,
  type SortState,
} from "@/components/ui/DataTable";
import { FilterRow, FilterTabs, SearchField } from "@/components/ui/FilterBar";
import { Select } from "@/components/ui/Form";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { Isolate } from "@/components/primitives/Ltr";
import { buildColumns, userRecord, type UserColumnContext } from "./columns";
import {
  EMPTY_QUERY,
  STATUS_FILTERS,
  isFiltered,
  isOverPaged,
  listParams,
  orderbyFromKey,
  queryFromParams,
  toUrlParams,
  usersKey,
  type StatusFilter,
  type UsersQuery,
} from "./query";

async function fetchUsers(query: UsersQuery) {
  const { data, total } = await acRead<StaffUser[]>(`/users?${listParams(query)}`);
  return { users: data, total };
}

/**
 * The staff list.
 *
 * ## Three filters and a sort, all of them measured
 *
 * Status tabs, a submit-gated search and a role picker, then four sortable
 * headers. `query.ts` carries every measurement; what belongs here is why each
 * control has the *shape* it has.
 *
 * **The search placeholder names its scope**, which is not decoration. The API's
 * `search_columns` are login, email, nicename and display name — so a person who
 * types a colleague's family name gets zero rows against an account that is right
 * there. Measured: `?search=Benali` is 0 rows while account 774's `last_name`
 * *is* Benali. That is the customers-list defect (§7) exactly — a field claiming
 * a column the API never matched — and the cheapest defence is a placeholder that
 * says what it looks at, plus a no-results state that repeats it to the one
 * person who needs it.
 *
 * **The role picker offers `/roles`'s seven and no eighth.** `?role=administrator`
 * is honoured and answers two accounts, and adding that option by hand would be
 * the panel copying a server constant — the thing the notifications channel
 * filter was removed for. Those two accounts stay visible in the unfiltered list
 * with their role named on the row, so the blind spot is one filter value rather
 * than two hidden people. `query.ts` argues it in full, including the one request
 * that would close it.
 *
 * **`Select` rather than a third tab strip**: seven roles plus "all" do not fit a
 * segmented bar at 340px, and this is the one filter whose vocabulary comes from
 * the server rather than from a constant — so its length is not ours to promise.
 *
 * **Only two of the seven roles can still be assigned**, and the list says so
 * once, at the foot, where it applies. 50 of 69 accounts hold one of the five
 * that cannot; a badge on 50 rows would be noise, and a fact about the *matrix*
 * is not a fact about any one account. The old screen already had this right and
 * it is carried over unchanged.
 *
 * ## What this screen deliberately does not ship
 *
 * **No peek and no `rowOpenerId`** — `columns.tsx` argues both. **No bulk
 * selection**: there is no measured bulk endpoint on this collection. **No
 * export**: `/users` is not in `EXPORT_SUBJECTS`, so the control would point at a
 * route that does not exist. **No sort below `md`**, because below `md` there is
 * no table — `RecordList` takes no sort props and that is correct rather than a
 * gap.
 *
 * ## No poll, and that is stated rather than left to be read as an oversight
 *
 * §3.7's stale amendment asks a screen to say which case it is in. A staff list
 * changes when somebody in the room changes it — an account is created by a
 * person on this screen, not by an order arriving — so there is nothing draining
 * in the background for a poll to catch up with. That is the opposite of the
 * notification queue, which polls for exactly the opposite reason.
 *
 * It still holds a client cache and a **manual refresh**, so it owes §3.7-4 in
 * full: the error state replaces the rows only when there are no rows, and a
 * failed refetch over rows already on screen keeps them and reports their age.
 * The refresh is what makes that second half reachable at all — a filter change
 * here is a server navigation that re-seeds the query rather than a client fetch
 * that can fail — and the control carries the measurement.
 *
 * The marker is gated on *offline **or** the last fetch failed*, with `reason`
 * saying which. A marker claiming "offline" with the interface up would be naming
 * a cause it has not established, which is the defect §16 nearly shipped.
 *
 * The rule's other half — *"every write control disabled with that same reason"*
 * — has **nothing to disable here**. This list writes nothing; the create button
 * is a navigation, and every write on this section lives on the detail, where it
 * is disabled with this same sentence.
 */
export function UsersList({
  locale,
  meId,
  initialQuery,
  initialUsers,
  initialTotal,
  roles,
}: {
  locale: string;
  meId: number | null;
  initialQuery: UsersQuery;
  initialUsers: StaffUser[] | null;
  initialTotal: number | null;
  roles: Role[];
}) {
  const t = useTranslations("staff");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  /*
   * The fifth state's first half. `navigator.onLine` is trusted in one direction
   * only — it reports the interface rather than reachability — which is why
   * nothing below is disabled on it alone.
   */
  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: usersKey(query),
    queryFn: () => fetchUsers(query),
    initialData:
      initialUsers !== null && usersKey(query)[1] === usersKey(initialQuery)[1]
        ? { users: initialUsers, total: initialTotal ?? initialUsers.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so changing a
       filter, the sort or the page never flashes a skeleton over content still
       valid. §3.6's third mechanism. */
    placeholderData: keepPreviousData,
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);
  const overPaged = isOverPaged(query);

  /* Not wrapped in `useCallback`: the React Compiler is on in this project and
     memoizes this already; a manual dependency list disagreeing with the
     compiler's inference makes it skip optimising the whole component. */
  function commit(next: UsersQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace` — going back from a filtered list must reach the
       unfiltered one. */
    router.push(`/${locale}/users${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
  }

  /* A new filter or a new sort resets to page one; paging and per-page do not.
     Page 3 of a re-ordered list is a different set of rows, not the same ones
     rearranged, so keeping the number would keep a position that no longer
     refers to anything. */
  const commitFilter = (next: UsersQuery) => commit({ ...next, page: 1 });

  /* The one affordance no individual control offers: dropping all three
     dimensions at once, while keeping the reading position's page size **and the
     sort** — see `isFiltered`, which deliberately excludes the ordering. Same
     control, same words and same handler as the no-results empty state. */
  const clearAll = () =>
    commit({ ...EMPTY_QUERY, perPage: query.perPage, orderby: query.orderby, order: query.order });

  const ctx: UserColumnContext = { locale, roles, meId, t };
  const columns = buildColumns(ctx);

  /* Held here rather than inside `DataTable` so the controls sit in the toolbar
     beside the filters instead of floating above the card. */
  const preferences = useTablePreferences("users", columns);

  /* The URL is the sort state; nothing is mirrored in component state. At rest
     this is `{registered, desc}`, which the `registered` column declares — so
     that header opens announcing `descending`, which is what the list is. See
     `columns.tsx` for why its cycle is the two-state one. */
  const sortState: SortState = { key: query.orderby, direction: query.order };

  /* Offline, or the last fetch failed over rows still on screen. §3.7-4. */
  const stale = dataUpdatedAt > 0 && (!online || isError);

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        /*
         * The visible count, and the testid the suite waits on before asserting
         * anything else. `Isolate` and never `Ltr`: this is a translated sentence
         * with a number in it, not an identifier, and forcing LTR lays an Arabic
         * count out from the left.
         */
        subtitle={
          <span data-testid="users-count">
            <Isolate>{t("count", { total })}</Isolate>
          </span>
        }
        actions={
          <>
            {/*
              **The refresh, and it is load-bearing rather than decoration — this
              was got wrong once and a browser caught it.**

              The first build of this screen shipped without it, on the argument
              that the list does not poll so there is no background clock for a
              manual refresh to race. That argument is true and the conclusion did
              not follow. Every *filter* change here is a `router.push`, so the
              Server Component re-fetches and the client query is seeded from its
              `initialData` — the browser never issues a request of its own.
              Measured with `/api/ac/users` aborted and the status tab clicked: 20
              rows before, 20 after, no error, and **no stale marker either**,
              because there had been no client fetch to fail.

              So without this control `isError` over rows already on screen was
              unreachable, and §3.7-4's whole second half was dead code — the
              amendment §16.1 applied to sixteen screens, reintroduced on the
              seventeenth by removing the one control that reaches it. §3.7-4 says
              so in as many words: *"The manual refresh control is the retry."*
            */}
            <IconButton
              label={t("refresh")}
              icon="refresh"
              variant="secondary"
              onClick={() => void refetch()}
              loading={isFetching}
            />
            {/*
             * **The primary, and it is a real link.** `POST /users` is allowlisted
             * and the create form is its own route rather than an overlay — a
             * username is write-once, so the control that collects it cannot be
             * the same control that later refuses to edit it. Middle click and
             * "open in new tab" are how somebody drafts a second account beside
             * the list they are reading.
             */}
            <ButtonLink href={`/${locale}/users/new`} variant="primary" icon="plus">
              {t("newUser")}
            </ButtonLink>
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <FilterTabs<StatusFilter>
              tabs={STATUS_FILTERS.map((value) => ({
                value,
                label: value === "" ? t("status.all") : t(`status.${value}`),
              }))}
              value={query.status}
              onChange={(status) => commitFilter({ ...query, status })}
              label={t("statusLabel")}
            />

            {/* `align="end"` because the role picker carries a visible label above
                its box and the search field and clear button do not — see
                `FilterRow`. */}
            <FilterRow align="end">
              <SearchField
                value={query.search}
                onSubmit={(next) => commitFilter({ ...query, search: next })}
                /* Names the columns the endpoint actually matches, because the two
                   it does not are the two somebody would type. */
                placeholder={t("searchPlaceholder")}
                label={t("searchLabel")}
                clearLabel={t("clearSearch")}
              />

              {/*
                Not rendered when `/roles` did not answer: a picker with one
                option is a control that cannot narrow anything, which is §3.3.
                The list still renders — `roleLabel()` falls back to the row's own
                `role_name` — so a failed matrix costs the filter and not the
                screen.
              */}
              {roles.length > 0 ? (
                <div className="w-full sm:w-56">
                  <Select
                    label={t("roleLabel")}
                    value={query.role}
                    onChange={(role) => commitFilter({ ...query, role })}
                    options={[
                      { value: "", label: t("role.all") },
                      /*
                        Every published role, assignable or not — a *filter* and a
                        *picker* are different questions asked of one list. 50 of
                        69 accounts hold a retired role, so a filter built from the
                        assignable half would offer two of the seven values
                        actually present on screen.
                      */
                      ...roles.map((role) => ({
                        value: role.role,
                        label: role.assignable ? role.name : `${role.name} — ${t("retired")}`,
                      })),
                    ]}
                  />
                </div>
              ) : null}

              {/*
                **Not rendered when nothing is filtered**, per §3.3: a control that
                cannot act is absent rather than disabled, and "clear" with nothing
                to clear cannot act.
              */}
              {filtered ? (
                <Button variant="ghost" size="sm" icon="close" onClick={clearAll}>
                  {t("empty.clear")}
                </Button>
              ) : null}

              <div className="ms-auto">
                <TableControls
                  columns={columns}
                  visible={preferences.visible}
                  onVisibleChange={preferences.setVisible}
                  density={preferences.density}
                  onDensityChange={preferences.setDensity}
                />
              </div>
            </FilterRow>
          </div>
        }
      />

      <PageBody width="full">
        {stale ? (
          <StaleBanner
            time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
            reason={online ? "refreshFailed" : "offline"}
          />
        ) : null}

        {/* A live region, so a filter that changes the result count announces it.
            Its own testid: `users-count` above is the *visible* count and is what
            the suite asserts on, and two elements sharing one testid is a
            strict-mode violation the moment either is queried. */}
        <p aria-live="polite" className="sr-only" data-testid="users-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && users.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={8} cols={5} label={t("loading")} />
            </div>
            {/* The card and its 8px padding are `DataTable`'s below `md`, so the
                skeleton wears them too or the rows step inward when data lands. */}
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={6} label={t("loading")} />
            </div>
          </>
        ) : isError && users.length === 0 ? (
          /*
           * Reached only when there is nothing on screen. A refetch that fails
           * over rows already rendered keeps them — §3.6's third mechanism — and
           * says so through the stale marker above, because replacing live content
           * with a full-page error is how one dropped request becomes a blank
           * screen. §3.7-4.
           */
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : users.length === 0 ? (
          <EmptyState
            icon={filtered || overPaged ? "search" : "user"}
            /*
             * **Three empty states, and telling them apart is the point.** Past
             * the last page is the most specific fact and wins the one action this
             * state gets — `?page=999` answers 200 with an empty array, so the
             * table is not drawn and with it goes the only control that could page
             * back. No results for these filters offers to clear them; the search,
             * the status tabs and the role picker can each empty this list, so the
             * second half has three real producers. Nothing at all offers the
             * create action, which `POST /users` supports.
             */
            message={
              overPaged ? t("empty.pastEnd") : filtered ? t("empty.noResults") : t("empty.none")
            }
            /* The search's limit, repeated to the one person who needs it: somebody
               already looking at no results after typing a family name. */
            detail={!overPaged && query.search !== "" ? t("searchScope") : undefined}
            action={
              overPaged
                ? { label: t("empty.firstPage"), onClick: () => commit({ ...query, page: 1 }) }
                : filtered
                  ? { label: t("empty.clear"), onClick: clearAll }
                  : { label: t("newUser"), href: `/${locale}/users/new` }
            }
          />
        ) : (
          <>
            <DataTable
              preferences={preferences}
              rows={users}
              columns={columns}
              rowKey={(user) => String(user.id)}
              /*
               * Named by the login as well as the display name, because on 64 of
               * 69 rows the two are the same string and on the rest the login is
               * the identity the audit trail records. Read out of a links list,
               * "Karim B." alone names nothing anybody can act on.
               */
              rowLabel={(user) =>
                tA11y("staffAccount", { name: staffName(user), login: user.username })
              }
              record={(user) => userRecord(user, ctx)}
              /*
               * Navigates rather than previewing — see `columns.tsx`. The name cell
               * is a real anchor on top of this, for the keyboard and the middle
               * click; it stops propagation so only one push happens. **No
               * `rowOpenerId`**: §3.2 says to omit it when that cell is already a
               * link and following it is what clicking the row does.
               */
              onRowClick={(user) => router.push(`/${locale}/users/${user.id}`)}
              sort={sortState}
              onSortChange={(next) =>
                /*
                 * `null` is the end of a column's cycle, and it restores the
                 * default pair rather than sending `orderby=registered&order=desc`
                 * as an explicit ask: `toUrlParams` omits both when they equal
                 * `EMPTY_QUERY`, so the URL goes back to clean.
                 *
                 * `orderbyFromKey` round-trips the key because `SortState.key` is
                 * a plain `string`, and a value outside the five is a **400** here
                 * rather than a 200 that quietly does nothing.
                 */
                commitFilter({
                  ...query,
                  orderby: next === null ? EMPTY_QUERY.orderby : orderbyFromKey(next.key),
                  order: next === null ? EMPTY_QUERY.order : next.direction,
                })
              }
              footer={
                <TableFooter
                  page={query.page}
                  perPage={query.perPage}
                  total={total}
                  onPageChange={(page) => commit({ ...query, page })}
                  onPerPageChange={(perPage) => commit({ ...query, perPage, page: 1 })}
                />
              }
            />

            {/*
              Stated once, at the foot, and only when there is something to state.
              `assignableRoles()` is the create form's filter and this is the same
              number said out loud — 50 of 69 accounts hold a role nobody can be
              given, which is a fact about the matrix rather than about any one
              row. The old screen had this right; it is carried over.
            */}
            {roles.length > assignableRoles(roles).length ? (
              <p className="mt-3 text-ui-label text-ui-subtle">
                <Isolate>
                  {t("retiredNote", { assignable: assignableRoles(roles).length })}
                </Isolate>
              </p>
            ) : null}
          </>
        )}
      </PageBody>
    </div>
  );
}
