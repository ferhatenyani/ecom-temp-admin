import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";
import { Button } from "@/components/primitives/Button";

/**
 * The five states every screen has. Not three — and built as part of the screen
 * rather than afterwards, which is why they are components with a floor of their
 * own rather than inline ternaries per route.
 */

/**
 * 1. Loading — skeleton rows matching the real row height, never a centred
 * spinner. A spinner reflows the page when data lands; a skeleton does not, and a
 * skeleton of the wrong height is a layout shift with extra steps.
 *
 * Measured: an order row is **81px** — `py-3` (24) plus the row's own `py-1` (8)
 * plus a 24px badge line, a 4px gap, a 20px subhead line, plus the hairline. An
 * earlier `h-18` (72px) was off by 9px per row, which is 72px of shift over eight
 * rows. So the skeleton is built from the same paddings and the same line heights
 * rather than from a number that has to be kept in step by hand.
 */
export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  const t = useTranslations("states");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("loading")}
      className="overflow-hidden rounded-lg bg-surface"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="list-row flex min-h-11 items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
            {/* The primary line's height comes from the badge, which is the
                tallest thing on it. */}
            <div className="flex items-center gap-2">
              <div className="skeleton h-6 w-20 rounded-sm" />
              <div className="skeleton ms-auto h-6 w-24 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <div className="skeleton h-5 w-32 rounded-sm" />
              <div className="skeleton ms-auto h-5 w-20 rounded-sm" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 2. Empty — distinguishes *no data yet* from *no results for this filter*, and
 * the second offers to clear the filter. One illustration-free line and one
 * action.
 */
export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-lg bg-surface px-6 py-12 text-center">
      <p className="text-body text-label-secondary">{message}</p>
      {action ? (
        <div className="mt-4 flex justify-center">
          <Button variant="tinted" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 3. Forbidden — names the capability required and who to ask. A Support Agent
 * hitting `/products` should read "Cette section demande la permission Produits"
 * and not a blank page.
 *
 * A 403 is never a logout and never a disappearing toast. It stays on the screen.
 */
export function ForbiddenState({ capability }: { capability: string }) {
  const t = useTranslations("states");
  // A capability the panel has no label for still renders as itself rather than
  // as a blank — an unlabelled permission is a missing translation, not a
  // reason to show nothing.
  const known = t.has(`capability.${capability}`);
  const name = known ? t(`capability.${capability}`) : capability;

  return (
    <div className="rounded-lg bg-surface px-6 py-12 text-center">
      <Icon name="lock" className="mx-auto size-8 text-label-tertiary" />
      <h2 className="mt-4 text-title-3 text-label">{t("forbiddenTitle")}</h2>
      <p className="mt-2 text-body text-label-secondary">
        {t("forbiddenBody", { capability: name })}
      </p>
      <p className="mt-1 text-footnote text-label-secondary">{t("forbiddenAsk")}</p>
    </div>
  );
}

/** 4. Error — one line, a retry, and the API's message only where it is actionable. */
export function ErrorState({
  message,
  onRetry,
  detail,
}: {
  message: string;
  onRetry?: () => void;
  /** The API's own text. Passed only for a 409, where it is worth surfacing. */
  detail?: string;
}) {
  const t = useTranslations("states");
  return (
    <div className="rounded-lg bg-surface px-6 py-12 text-center">
      <Icon name="alert" className="tone-danger tonal-fg mx-auto size-8" />
      <h2 className="mt-4 text-title-3 text-label">{t("errorTitle")}</h2>
      <p className="mt-2 text-body text-label-secondary">{message}</p>
      {detail ? (
        <p className="mt-1 text-footnote text-label-secondary">{detail}</p>
      ) : null}
      {onRetry ? (
        <div className="mt-4 flex justify-center">
          <Button variant="tinted" onClick={onRetry}>
            {t("retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 5. Offline / stale — a visible marker with the age of the data, never silent
 * staleness. Every write control is disabled with the same message.
 */
export function StaleBanner({ time }: { time: string }) {
  const t = useTranslations("states");
  return (
    <div
      role="status"
      className="tone-warning tonal mx-4 mb-3 flex items-center gap-2 rounded-lg px-3 py-2"
    >
      <Icon name="clock" className="size-4 shrink-0" />
      <span className="text-footnote">{t("offline", { time })}</span>
    </div>
  );
}

/** A section that failed inside an otherwise working detail screen. */
export function SectionError({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface px-4 py-6 text-center text-footnote text-label-secondary">
      {children}
    </div>
  );
}
