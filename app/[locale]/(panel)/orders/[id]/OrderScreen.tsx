"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { Icon } from "@/components/primitives/Icon";
import { StaleBanner } from "@/components/ui/States";

/**
 * The two things every section of this screen shares: one refusal region and one
 * answer to "may this write happen right now".
 *
 * ## Why the refusal is not per-section
 *
 * Five controls on this screen can be refused — the status change in the header,
 * the COD switch, the COD attempt, the parcel create and cancel, and the payment
 * verify — and each one used to render its own refusal inside its own section.
 * On a single column that was fine. In two columns it is not: the control that
 * caused it may be in the aside, which at `lg`+ is 360px away from where the eye
 * is and, below `lg`, is *below* a line-item list of unknown length. A refusal
 * that has to be scrolled to is a refusal nobody reads.
 *
 * So there is one region, `role="alert"`, at the top of the body and above the
 * grid — DESIGN.md §3.1 is explicit that an error a person must act on is never
 * a toast, and §3.7 wants it on screen and staying there. The section that was
 * refused composes the body, because only it knows whether the useful part is a
 * sentence or a list of legal moves.
 *
 * One at a time, and the last one wins. Two simultaneous refusals from two
 * different controls is not a state a person can reach without deliberately
 * trying, and a stack of alerts would push the data off the screen.
 *
 * ## Why staleness lives here too
 *
 * §3.7's fifth state is a marker carrying the age of the data **and** every write
 * control disabled with that same reason. There are eight write controls on this
 * screen in four files; the reason has to come from one place or seven of them
 * will say something slightly different.
 */

type OrderScreenValue = {
  /** Put a refusal on screen, or clear it with `null`. */
  refuse: (body: ReactNode | null) => void;
  /** `null` when writes are permitted, otherwise the reason they are not. */
  writesBlocked: string | null;
};

const OrderScreenContext = createContext<OrderScreenValue>({
  refuse: () => {},
  writesBlocked: null,
});

export function useOrderScreen(): OrderScreenValue {
  return useContext(OrderScreenContext);
}

/** Internal: the notices need the refusal and the age, the sections do not. */
const NoticeContext = createContext<{
  refusal: ReactNode | null;
  stale: boolean;
  fetchedAt: number;
  locale: string;
}>({ refusal: null, stale: false, fetchedAt: 0, locale: "fr" });

/**
 * Wraps the **whole** screen, header included, because the primary action is in
 * the header (DESIGN.md §2.4, and the reason is in this branch's brief: below
 * `lg` the aside drops beneath a variable-length item list, and the panel's
 * most-used control cannot live at the bottom of a page whose length is
 * data-dependent).
 *
 * `children` is server-rendered. A client provider with Server Component children
 * is the supported arrangement — the children are already-rendered elements
 * passed through as a prop, and the client components nested inside them still
 * read this context because they sit below the provider in the React tree.
 */
export function OrderScreen({
  /** When the server rendered this page. The age the stale marker reports. */
  fetchedAt,
  locale,
  children,
}: {
  fetchedAt: number;
  locale: string;
  children: ReactNode;
}) {
  const t = useTranslations("states");
  const [refusal, setRefusal] = useState<ReactNode | null>(null);

  /*
   * `navigator.onLine` is trusted in one direction only, which is the direction
   * it is certain in: when it says false there is no interface at all. It reports
   * the interface rather than reachability, so a van's phone holding one bar
   * still reads as online — which is why the refresh control stays enabled and
   * only the *writes* are blocked.
   */
  const online = useOnline();

  return (
    <OrderScreenContext.Provider
      value={{
        refuse: setRefusal,
        writesBlocked: online ? null : t("offlineWrites"),
      }}
    >
      <NoticeContext.Provider
        value={{ refusal, stale: !online, fetchedAt, locale }}
      >
        {children}
      </NoticeContext.Provider>
    </OrderScreenContext.Provider>
  );
}

/**
 * The notices, rendered at the top of the body and above the two-column grid.
 *
 * Separate from the provider because the provider has to wrap the header and
 * these have to sit inside `PageBody`, below it.
 */
export function OrderNotices() {
  const { refusal, stale, fetchedAt, locale } = useContext(NoticeContext);

  return (
    <>
      {stale ? (
        <StaleBanner time={formatWhen(new Date(fetchedAt).toISOString(), locale)} />
      ) : null}

      {/*
        Always in the DOM, empty when there is nothing to say.

        A live region mounted at the same moment as its content is not reliably
        announced — the assistive technology has to have been watching the node
        before it changed. This is the same reason `ToastProvider` keeps its
        anchor mounted.
      */}
      <div role="alert" aria-live="assertive">
        {refusal ? (
          <div className="mb-4 flex items-start gap-2.5 rounded-ui-lg border border-ui-line bg-ui-danger-bg px-4 py-3 text-ui-danger-fg">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <div className="flex min-w-0 flex-col gap-2">{refusal}</div>
          </div>
        ) : null}
      </div>
    </>
  );
}
