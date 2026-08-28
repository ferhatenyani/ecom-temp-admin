"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import type { Customer } from "@/lib/api/schemas/customer";
import { customerRef, looksLikeAName, type CustomerRef } from "@/lib/customers";
import { acRead } from "@/lib/api/browser";
import { Drawer } from "@/components/ui/Overlay";
import { Button, IconButton } from "@/components/ui/Button";
import { CheckRow } from "@/components/ui/Form";
import { SearchField } from "@/components/ui/FilterBar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import {
  CUSTOMER_PICKER_PER_PAGE,
  RESOLVED_CUSTOMER_LIMIT,
  customerKey,
  customerPickerKey,
  customerPickerParams,
} from "../query";

/**
 * The customer picker — choose the people an `ids` audience names.
 *
 * ## Why it exists now, when §15 recorded it as unbuildable
 *
 * The inherited note said `/customers` is `ac_manage_customers`, which a Marketing
 * Manager does not hold, "so a picker would be empty for the one role whose job
 * this is". **The reasoning was wrong, and measurably so.** `canSendCampaigns()`
 * is `ac_manage_marketing` *and* `ac_manage_customers` — `lib/capabilities.ts:61`
 * — so a Marketing Manager is 403 on `send` as well. The role that can actually
 * finish this task necessarily holds the second capability and *can* read
 * `/customers`. The one who cannot was never going to complete a send either.
 *
 * That is why this is a picker and not a widening: nothing new is disclosed to
 * anybody. §3.3 then decides the rest — **the picker is not rendered at all
 * without `ac_manage_customers`**, and the comma-separated field it replaces stays
 * exactly as it was for that reader. A control that cannot act is not rendered.
 *
 * ## The search matches the address, and the placeholder says so
 *
 * `?search=` reads `user_login`, `user_email` and `display_name`. It **never**
 * reads `first_name` or `last_name` — measured with a positive control and
 * recorded three times over (`lib/customers.ts:45`, `scripts/mock-api.mjs`, and
 * `query.ts` beside `customerPickerParams`). Customer 20 is named *Benali* and
 * `?search=Benali` returns nothing at all.
 *
 * So the placeholder names the e-mail, exactly as the coupon picker's names the
 * SKU and the coupons list's says "the code only" — and the empty state uses
 * `looksLikeAName()` to say *why* nothing matched rather than "no results", which
 * is the customers screen's own defence arriving here.
 *
 * ## `RestrictionPicker`'s shape, deliberately
 *
 * A `Drawer` per §3.1, a submit-gated `SearchField` — the coupon form could open
 * that picker four times and a request per keystroke ran to eleven against a
 * budget of 600/min — real `CheckRow` checkboxes, a draft committed on apply
 * rather than written through, and the same `seen` map handed back on commit. The
 * one thing that is not a copy is what a row *says*, and that is measured: the
 * address leads because 12 of 17 customers have no name, and the consent flag is
 * on every row because a customer without it is **not counted in the send**.
 */

/**
 * The consent badge, on **both** states.
 *
 * Badging only the absence would make a row with no badge ambiguous — a customer
 * who consents and a customer whose flag failed to render look identical — and
 * this is the one fact on the row that changes whether ticking it does anything.
 * The fixture is 8 of 17 either way, so neither state is an edge case.
 */
function ConsentBadge({ consent, t }: { consent: boolean; t: (key: string) => string }) {
  return consent ? (
    <Badge tone="success">{t("picker.consenting")}</Badge>
  ) : (
    <Badge tone="warning">{t("picker.noConsent")}</Badge>
  );
}

/**
 * Resolve saved ids to rows, **one request each**, up to the cap.
 *
 * There is no batch route. `?include=`, `?include[]=`, `?ids=` and `?post__in=`
 * are each a silent 200 answering the whole collection, byte-identical to
 * `?bogus_param=1` — so a screen "resolving" through one of them would be reading
 * every customer in the shop and matching client-side, which is worse in every
 * way. `GET /customers/{id}` is the only route that answers about one person.
 *
 * `useQueries` rather than one request-all query, so each id is cached under the
 * key the rest of the panel already uses for it: leaving the audience step and
 * coming back costs **zero** requests, and an id the picker has just committed is
 * primed into that cache by `CustomerPicker` and never fetched at all.
 *
 * A 404 is the ordinary case rather than an error — a customer named by a saved
 * audience can have been deleted since — so a failed id is simply not learned, and
 * the caller renders it as a bare id.
 *
 * **One consequence, measured in Chromium and recorded rather than worked
 * around.** The browser writes its own `console.error` for every 404 response —
 * "Failed to load resource" — and `scripts/capture.mjs` fails a run on any console
 * error. So a *capture* of an `ids` audience holding a deleted customer would fail
 * the harness for a screen behaving exactly correctly. It cannot be suppressed
 * from here: the message is the network stack's, not the panel's, and the request
 * is the only one this API offers. No default capture reaches it today — no
 * fixture campaign has an `ids` audience — but whoever adds one should read this
 * before treating the red as a defect.
 */
export function useResolvedCustomers(
  ids: readonly number[],
  enabled: boolean,
): { rows: CustomerRef[]; dropped: number[]; pending: boolean } {
  const looked = ids.slice(0, RESOLVED_CUSTOMER_LIMIT);
  const dropped = ids.slice(RESOLVED_CUSTOMER_LIMIT);

  /*
   * Named where a developer will see it, because the alternative is a silent
   * truncation — an audience of 400 whose screen quietly discusses 25 of them.
   * `warn` rather than `error`: the capture harness fails a run on any
   * `console.error`, and this is a documented limit being reached rather than a
   * defect. The visible half is the caller's, and it names the same number.
   */
  useEffect(() => {
    if (dropped.length > 0) {
      console.warn(
        `CustomerPicker: ${dropped.length} of ${ids.length} saved customer ids were not ` +
          `looked up — RESOLVED_CUSTOMER_LIMIT is ${RESOLVED_CUSTOMER_LIMIT} and there is ` +
          `no batch route. They render as bare ids: ${dropped.join(", ")}`,
      );
    }
  }, [dropped.length, dropped, ids.length]);

  return useQueries({
    queries: looked.map((id) => ({
      queryKey: customerKey(id),
      queryFn: async () => customerRef((await acRead<Customer>(`/customers/${id}`)).data),
      enabled,
      /* A deleted customer answers 404 with its own sentence and will answer it
         again. Retrying three times per id would turn one missing person into
         three wasted reads out of a shared budget. */
      retry: false,
    })),
    combine: (results) => ({
      rows: results.flatMap((result) => (result.data ? [result.data] : [])),
      dropped: [...dropped],
      pending: results.some((result) => result.isPending),
    }),
  });
}

export function CustomerPicker({
  open,
  onOpenChange,
  selected,
  onCommit,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ids currently on the campaign. The drawer edits a copy and commits on apply. */
  selected: readonly number[];
  /**
   * The committed ids, **and the rows this picker displayed for them**.
   *
   * The second argument is coupons' defect #2 answered before it can happen: that
   * form rendered its ids from the draft and their names from the last *saved*
   * response, so adding one showed the old name beside the new count. The picker
   * is the only thing that knows who an id it has just added belongs to, so it
   * hands the rows over rather than leaving the composer to guess — and what it
   * hands over is an **API fact** in all three fields, never a fallback.
   */
  onCommit: (ids: number[], learned: CustomerRef[]) => void;
  /** The button focus returns to. See `useOpenerFocus` in Overlay.tsx. */
  returnFocusTo?: string;
}) {
  const t = useTranslations("campaigns");
  const tTable = useTranslations("ui.table");

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  /*
   * A draft, committed on apply rather than on every tick — `RestrictionPicker`'s
   * argument exactly: the composer behind this saves on advance, and two levels of
   * undo with one level of cancelling is how somebody loses a selection they
   * thought they had discarded.
   *
   * Keyed on `open` so reopening re-seeds from the campaign rather than
   * resurrecting a draft that was cancelled.
   */
  const [draft, setDraft] = useState<number[]>([...selected]);
  const [seededFor, setSeededFor] = useState(open);

  /**
   * Every row this drawer has put on screen since it opened.
   *
   * A person can search, tick a row, search again and apply — so the rows rendered
   * *at* the moment of commit are not all the rows the commit covers. A ref rather
   * than state because nothing renders from it: it is read once, by `onCommit`.
   */
  const seen = useRef(new Map<number, CustomerRef>());

  /* Emptied in an effect rather than in the re-seed block below, because a ref
     read or written during render is a value React is free to discard. */
  useEffect(() => {
    if (open) seen.current = new Map();
  }, [open]);

  if (open !== seededFor) {
    setSeededFor(open);
    if (open) {
      setDraft([...selected]);
      setSearch("");
      setPage(1);
    }
  }

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: customerPickerKey(search, page),
    queryFn: async () => {
      const { data, total } = await acRead<Customer[]>(
        `/customers?${customerPickerParams(search, page)}`,
      );
      return { rows: data.map(customerRef), total };
    },
    // Nothing is fetched until the drawer is open: most campaigns are saved
    // without anybody touching the audience.
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PICKER_PER_PAGE));

  /* Recorded after paint, not during it: writing to a ref while rendering makes
     the render impure. Keyed on `data` rather than on `rows`, which is a fresh
     array every render and would make this an effect that never settles. */
  useEffect(() => {
    for (const row of data?.rows ?? []) seen.current.set(row.id, row);
  }, [data]);

  const toggle = (id: number) =>
    setDraft((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t("picker.title")}
      description={t("picker.description")}
      size="sm"
      returnFocusTo={returnFocusTo}
      footer={
        <>
          {/* Cancel first in DOM order, so it is the first tab stop and, on a
              phone, the lower of the two — `OverlayFrame` reverses the column. */}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("picker.cancel")}
          </Button>
          <Button
            onClick={() => {
              onCommit(draft, [...seen.current.values()]);
              onOpenChange(false);
            }}
          >
            {/* The count is on the button because it is the thing that changed and
                the list is tall enough that every ticked row may be scrolled off.
                `Isolate`, not `Ltr`: a translated string carrying a number. */}
            <Isolate numeric>{t("picker.apply", { count: draft.length })}</Isolate>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SearchField
          value={search}
          onSubmit={(next) => {
            setSearch(next);
            setPage(1);
          }}
          placeholder={t("picker.searchPlaceholder")}
          label={t("picker.searchLabel")}
          clearLabel={t("clearSearch")}
        />

        {/*
          **The one line that keeps this control honest.** `?search=` reads the
          login, the address and the display name and never the two name fields —
          so a shop looking for "Benali" gets an empty picker and concludes the
          customer is not there. Coupons says "the code only" for the same reason
          and the product picker says "the SKU too"; this one says the address.
        */}
        <p className="text-ui-label text-ui-muted">{t("picker.searchHint")}</p>

        {isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : isPending ? (
          /* Six rows at the real row's height: `CheckRow` wears `.ui-field`, which
             is 36px on a pointer and 44px on touch, so the placeholder grows with
             it rather than settling upward on a phone. */
          <SkeletonRegion label={t("loading")} className="flex flex-col gap-1">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="ui-field w-full rounded-ui-md" />
            ))}
          </SkeletonRegion>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={search === "" ? "customers" : "search"}
            message={search === "" ? t("picker.none") : t("picker.noResults")}
            /*
              **Why nothing matched, where the term looks like a person's name.**
              This endpoint cannot search a name, and the failure is otherwise an
              ordinary empty list — the exact silent dead end `looksLikeAName()`
              was written for on the customers screen.
            */
            detail={looksLikeAName(search) ? t("picker.noResultsName") : undefined}
            action={
              search === ""
                ? undefined
                : { label: t("clearSearch"), onClick: () => setSearch("") }
            }
          />
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <CheckRow
                key={row.id}
                checked={draft.includes(row.id)}
                onChange={() => toggle(row.id)}
                /*
                  **The address is the label**, so it is part of the control's
                  accessible name — which is what a person has to tell two rows
                  apart, since 12 of 17 have no name at all. `CheckRow` draws it
                  `dir="auto"`, and an address's first strong character is Latin,
                  so it stays an LTR run that truncates at its own end inside an
                  Arabic page.
                */
                label={row.email}
                badge={<ConsentBadge consent={row.consent} t={t} />}
                /*
                  An `inline-block` carrying both `dir="auto"` and the truncation,
                  for the reason `ChosenCustomers` records below: `CheckRow`'s own
                  secondary slot is a block at the *page's* direction, so a plain
                  `dir="auto"` span inside it would have had an Arabic page clip
                  a French name from its front.
                */
                secondary={
                  row.name === null ? undefined : (
                    <span dir="auto" className="inline-block max-w-full truncate">
                      {row.name}
                    </span>
                  )
                }
              />
            ))}
          </div>
        )}

        {total > CUSTOMER_PICKER_PER_PAGE ? (
          <nav aria-label={tTable("pageOf", { page, pages: pageCount })}>
            <div className="flex items-center justify-between gap-3">
              <IconButton
                label={t("picker.previous")}
                icon="back"
                flipInRtl
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              />
              <span className="text-ui-label text-ui-muted" data-numeric="">
                {tTable("pageOf", { page, pages: pageCount })}
              </span>
              <IconButton
                label={t("picker.next")}
                icon="chevron"
                flipInRtl
                variant="secondary"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              />
            </div>
          </nav>
        ) : null}
      </div>
    </Drawer>
  );
}

/**
 * The chosen audience, as rows rather than as a comma-separated string.
 *
 * Three kinds of row, and the difference between them is what the panel *knows*:
 *
 *   resolved     an address, a name where there is one, and the consent flag —
 *                all three read off `GET /customers/{id}`
 *   unresolved   an id that was looked up and did not answer: a deleted customer,
 *                the ordinary case for a saved audience. It renders **as its id**
 *                and claims nothing — not an address, not a consent state. That is
 *                coupons' defect #2 and its lesson: a flag is an API fact, never
 *                a fallback.
 *   past the cap the same, and counted, because 25 lookups is the ceiling
 *
 * The remove button is on the row rather than in the drawer, because taking one
 * person out of an audience of nine should not cost opening a picker, paging to
 * find them and unticking.
 */
export function ChosenCustomers({
  ids,
  known,
  dropped,
  pending,
  onRemove,
  disabled,
}: {
  ids: readonly number[];
  known: ReadonlyMap<number, CustomerRef>;
  /** Ids past `RESOLVED_CUSTOMER_LIMIT`, never looked up. */
  dropped: readonly number[];
  pending: boolean;
  onRemove: (id: number) => void;
  disabled: boolean;
}) {
  const t = useTranslations("campaigns");

  const droppedSet = new Set(dropped);

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1" data-testid="chosen-customers">
        {ids.map((id) => {
          const row = known.get(id);
          const beyond = droppedSet.has(id);

          return (
            <li
              key={id}
              className="flex min-w-0 items-center gap-2 rounded-ui-md bg-ui-surface-2 px-2.5 py-1.5"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-2">
                  {row ? (
                    <Ltr numeric={false} className="min-w-0 truncate text-ui-compact text-ui-fg">
                      {row.email}
                    </Ltr>
                  ) : (
                    /* **A bare id, claiming nothing.** No address, no consent
                       badge — the panel has not been told either, and inventing
                       a neutral-looking row would be inventing a fact. */
                    <Ltr className="min-w-0 truncate text-ui-compact text-ui-muted">
                      {t("picker.bareId", { id: String(id) })}
                    </Ltr>
                  )}
                  {row ? <ConsentBadge consent={row.consent} t={t} /> : null}
                </span>
                {/*
                  **Three different second lines, because they are three
                  different facts** — the distinction `consentRecord()` draws one
                  collection over between *declined* and *never asked*:

                    a name        the customer answered and has one
                    introuvable   looked up, and `GET /customers/{id}` was a 404:
                                  a deleted customer, the ordinary case for a
                                  saved audience
                    non recherché past `RESOLVED_CUSTOMER_LIMIT`. Nobody asked, so
                                  nothing is known — which is *not* the same
                                  claim as "there is no such customer"

                  The name is an `inline-block` carrying **both** `dir="auto"` and
                  the truncation, and both captures that produced that shape are
                  worth keeping. As a plain block with `dir="auto"` it aligned to
                  its *own* start, so an Arabic name sat hard against the right
                  edge of a French row. As an inline span inside a block at the
                  page's direction, `text-overflow` clipped at the *paragraph's*
                  end — the left, in Arabic — and ate the **front** of
                  "Abdelkrim-Mohammed-El-Hadj Benyoucef-…", which is §15 defect #1
                  and `customers/columns.tsx`'s recorded trap, reproduced.

                  An inline-block gets its position from the line (the page's
                  direction, so rows align) and its overflow from itself (the
                  content's direction, so the ellipsis lands at the far end of the
                  name). Both facts stay true in both locales.

                  **The plain wrapper is load-bearing and is the third capture.**
                  A flex item is *blockified* — `display: inline-block` on a direct
                  child of the column above becomes `block`, `dir="auto"` makes it
                  RTL and `text-align: start` puts it back against the right edge,
                  which is the exact bug this shape was written to fix. The wrapper
                  takes the blockification so the inner span stays inline.
                */}
                {row?.name ? (
                  <span className="min-w-0">
                    <span
                      dir="auto"
                      className="inline-block max-w-full truncate text-ui-caption text-ui-subtle"
                    >
                      {row.name}
                    </span>
                  </span>
                ) : row ? null : beyond ? (
                  <span className="text-ui-caption text-ui-subtle">{t("picker.notLookedUp")}</span>
                ) : pending ? (
                  <span className="text-ui-caption text-ui-subtle">{t("loading")}</span>
                ) : (
                  <span className="text-ui-caption text-ui-subtle">{t("picker.unresolved")}</span>
                )}
              </span>
              <IconButton
                label={t("picker.remove", { name: known.get(id)?.email ?? String(id) })}
                icon="close"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onRemove(id)}
              />
            </li>
          );
        })}
      </ul>

      {/*
        **What the cap dropped, said on screen and not only in a console.** An
        audience of four hundred is a legitimate thing to have saved, and a screen
        discussing twenty-five of them without saying so would be lying by
        omission. The ids above are still every id — only the *lookups* are capped.
      */}
      {dropped.length > 0 ? (
        <p className="text-ui-label text-ui-subtle" data-testid="ids-not-resolved">
          <Isolate numeric>
            {t("picker.notResolved", { count: dropped.length, limit: RESOLVED_CUSTOMER_LIMIT })}
          </Isolate>
        </p>
      ) : null}

      {/*
        **No consent tally here, and the first capture is why.** A count of the
        rows whose flag is false is a count over the *resolved* subset, and
        `StepAudience`'s own consent gap — which the server computes over the whole
        audience, ids the panel could not resolve included — sits four inches
        below it. The two printed 9 and 23 for the same campaign. The server's
        number is the true one, it is already on screen, and a second figure
        answering a narrower question in the same words is how a reader learns to
        trust neither. The per-row badge stays: that is a fact about one person.
      */}
    </div>
  );
}
