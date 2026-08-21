"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Role, StaffUser } from "@/lib/api/schemas/staff";
import { acRead } from "@/lib/api/browser";
import { assignableRoles, isSelf } from "@/lib/staff";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState } from "@/components/patterns/States";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { Segmented } from "@/components/primitives/Segmented";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { UserRow } from "./UserRow";
import { RowSkeleton } from "../inventory/RowSkeleton";
import {
  PER_PAGE,
  STATUS_FILTERS,
  isFiltered,
  listParams,
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
 * **The role picker filters on `assignable` and the row labels do not**, and
 * that split is the screen's one structural oddity. 51 of the 72 accounts on
 * this install hold one of the five retired roles — `remove_role()` does not
 * touch `wp_capabilities`, so the two-tier collapse left every holder in place
 * — so a filter built from the assignable half would offer two of the eight
 * values actually present, and a label built from it would blank three quarters
 * of the list.
 *
 * So the **filter** offers every role the list contains and the **create form**
 * offers only the two that can be assigned. Different questions, same route.
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
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = queryFromParams(new URLSearchParams(searchParams.toString()));
  const [search, setSearch] = useState(query.search);

  const commit = (next: UsersQuery, options: { resetPage?: boolean } = {}) => {
    const target = options.resetPage === false ? next : { ...next, page: 1 };
    const params = toUrlParams(target);
    router.push(`/${locale}/users${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
  };

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: usersKey(query),
    queryFn: () => fetchUsers(query),
    initialData:
      initialUsers !== null &&
      usersKey(query).join("|") === usersKey(initialQuery).join("|")
        ? { users: initialUsers, total: initialTotal ?? initialUsers.length }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = isFiltered(query);

  return (
    <Scaffold
      title={t("title")}
      trailing={
        <Link
          href={`/${locale}/users/new`}
          aria-label={t("newUser")}
          className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
        >
          <Icon name="plus" className="size-5" />
        </Link>
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3">
            <Icon name="search" className="size-4 shrink-0 text-label-secondary" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit({ ...query, search });
              }}
              onBlur={() => {
                if (search !== query.search) commit({ ...query, search });
              }}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              dir="auto"
              className="min-h-11 min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-tertiary"
            />
            {search !== "" ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  commit({ ...query, search: "" });
                }}
                aria-label={t("clearSearch")}
                className="press flex size-6 shrink-0 items-center justify-center rounded-full"
              >
                <Icon name="close" className="size-3.5 text-label-secondary" />
              </button>
            ) : null}
          </div>

          <Segmented<StatusFilter>
            segments={STATUS_FILTERS.map((value) => ({
              value,
              label: value === "" ? t("status.all") : t(`status.${value}`),
            }))}
            value={query.status}
            onChange={(status) => commit({ ...query, status })}
            label={t("statusLabel")}
          />

          {/*
            A native select rather than a third segmented control: eight roles
            do not fit a segmented bar at 390px, and this is the one filter whose
            vocabulary comes from the server rather than from a constant.
          */}
          {roles.length > 0 ? (
            <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3">
              <Icon name="customers" className="size-4 shrink-0 text-label-secondary" />
              <select
                value={query.role}
                onChange={(event) => commit({ ...query, role: event.target.value })}
                aria-label={t("roleLabel")}
                className="min-h-11 min-w-0 flex-1 appearance-none bg-transparent text-footnote text-label outline-none"
              >
                <option value="">{t("role.all")}</option>
                {roles.map((role) => (
                  <option key={role.role} value={role.role}>
                    {role.name}
                    {role.assignable ? "" : ` — ${t("retired")}`}
                  </option>
                ))}
              </select>
              <Icon name="chevron" className="size-4 shrink-0 rotate-90 text-label-tertiary" />
            </div>
          ) : null}
        </div>
      }
    >
      <div className="mx-auto max-w-3xl px-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
          <p aria-live="polite" className="text-footnote text-label-secondary" data-testid="users-count">
            <Isolate numeric>{t("count", { total })}</Isolate>
          </p>
          {/*
            The searched columns, stated. `/customers` carries this note because
            its search cannot find a person by name; this one can, and says so
            for the opposite reason — the two screens look alike and a reader who
            learned the customers rule would apply it here.
          */}
          {query.search !== "" ? (
            <p className="text-caption text-label-tertiary">{t("searchScope")}</p>
          ) : null}
        </div>

        {isPending && users.length === 0 ? (
          <RowSkeleton rows={6} />
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : users.length === 0 ? (
          <EmptyState
            message={filtered ? t("empty.noResults") : t("empty.none")}
            action={
              filtered
                ? {
                    label: t("empty.clear"),
                    onClick: () => {
                      setSearch("");
                      commit({ ...query, search: "", status: "", role: "" });
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <ListGroup>
              {users.map((user) => (
                <ListLinkRow
                  key={user.id}
                  href={`/${locale}/users/${user.id}`}
                  ariaLabel={user.username}
                >
                  <UserRow user={user} roles={roles} isMe={isSelf(user.id, meId)} />
                </ListLinkRow>
              ))}
            </ListGroup>

            {total > PER_PAGE ? (
              <nav className="mb-8 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={query.page <= 1}
                  onClick={() =>
                    commit({ ...query, page: Math.max(1, query.page - 1) }, { resetPage: false })
                  }
                  aria-label={t("previousPage")}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="back" flipInRtl className="size-5" />
                </button>
                <span className="text-footnote text-label-secondary">
                  <Ltr numeric>
                    {query.page} / {pageCount}
                  </Ltr>
                </span>
                <button
                  type="button"
                  disabled={query.page >= pageCount}
                  onClick={() => commit({ ...query, page: query.page + 1 }, { resetPage: false })}
                  aria-label={t("nextPage")}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="chevron" flipInRtl className="size-5" />
                </button>
              </nav>
            ) : null}

            {/*
              Stated once, at the foot, and only when there is something to
              state. `assignableRoles()` is the picker's filter and this is the
              same number said out loud — 51 of 72 accounts hold a role nobody
              can be given, which is a fact about the shop rather than about any
              one row, and a badge on 51 rows would be noise.
            */}
            {roles.length > assignableRoles(roles).length ? (
              <p className="mb-8 px-1 text-caption text-label-tertiary">
                <Isolate numeric>
                  {t("retiredNote", { assignable: assignableRoles(roles).length })}
                </Isolate>
              </p>
            ) : null}
          </>
        )}
      </div>
    </Scaffold>
  );
}
