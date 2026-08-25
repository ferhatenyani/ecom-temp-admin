"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/primitives/Icon";
import { Button } from "./Button";

/**
 * The five states, restyled for the new system. See DESIGN.md §3.7.
 *
 * The contract survives the redesign unchanged, because it was right: five
 * states, not three, and built as part of the screen rather than bolted on
 * afterwards. Only the surfaces and the type scale move.
 */

/** The shared frame — a card with a centred column, at a consistent height. */
function StateFrame({
  icon,
  tone = "muted",
  title,
  body,
  detail,
  action,
}: {
  icon: IconName;
  tone?: "muted" | "danger";
  title?: string;
  body: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-card flex flex-col items-center px-6 py-12 text-center">
      <Icon
        name={icon}
        className={`size-6 ${tone === "danger" ? "text-ui-danger-fg" : "text-ui-subtle"}`}
      />
      {title ? <h2 className="mt-3 text-ui-subheading text-ui-fg">{title}</h2> : null}
      <p className="mt-1.5 max-w-96 text-ui-body text-ui-muted">{body}</p>
      {detail ? (
        <p className="mt-1 max-w-96 text-ui-label text-ui-subtle">{detail}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * 2. Empty — and the distinction it exists to draw is between *no data yet* and
 * *no results for this filter*. The first offers the create action, the second
 * offers to clear the filter. Collapsing them into one message is why so many
 * empty states say nothing useful.
 */
export function EmptyState({
  message,
  /**
   * A second line, below the message and above the action — what the absence
   * *costs*, when that is not obvious.
   *
   * `StateFrame` has carried this slot since the redesign and only `ErrorState`
   * exposed it, so an empty state could say what was missing and never why it
   * mattered. The shipping tariff is the case that found it: "no delivery rate is
   * configured" is a fact, and "without one a destination has no price and the
   * shop cannot charge for it" is the reason to press the button underneath.
   * Optional, and most empty states are right not to pass it — a second line
   * that restates the first is noise.
   */
  detail,
  action,
  icon = "search",
}: {
  message: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
  icon?: IconName;
}) {
  return (
    <StateFrame
      icon={icon}
      body={message}
      detail={detail}
      action={
        action ? (
          <Button variant="secondary" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null
      }
    />
  );
}

/**
 * 3. Forbidden — names the capability required and who to ask. Never a blank
 * page, never a logout, never a disappearing toast. It stays on screen.
 */
export function ForbiddenState({ capability }: { capability: string }) {
  const t = useTranslations("states");
  /* An unlabelled capability is a missing translation, not a reason to render
     nothing — so it falls back to its own identifier. */
  const known = t.has(`capability.${capability}`);
  const name = known ? t(`capability.${capability}`) : capability;

  return (
    <StateFrame
      icon="lock"
      title={t("forbiddenTitle")}
      body={t("forbiddenBody", { capability: name })}
      detail={t("forbiddenAsk")}
    />
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
  /** The API's own text. Passed for a 409, where it says what to do instead. */
  detail?: string;
}) {
  const t = useTranslations("states");
  return (
    <StateFrame
      icon="alert"
      tone="danger"
      title={t("errorTitle")}
      body={message}
      detail={detail}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
            {t("retry")}
          </Button>
        ) : null
      }
    />
  );
}

/**
 * 5. Stale — a visible marker carrying the age of the data. Never silent
 * staleness, and every write control is disabled with this same reason.
 */
export function StaleBanner({ time }: { time: string }) {
  const t = useTranslations("states");
  return (
    <div
      role="status"
      className="mb-3 flex items-center gap-2 rounded-ui-lg border border-ui-line bg-ui-warning-bg px-3 py-2 text-ui-warning-fg"
    >
      <Icon name="clock" className="size-4 shrink-0" />
      <span className="text-ui-label">{t("offline", { time })}</span>
    </div>
  );
}

/**
 * A standing notice about the record itself — not a failure, and not a toast.
 *
 * §3.1: "An error a person must act on is not a toast. It is inline, or a
 * `Modal`." §3.7 wants the same of a state marker: on screen, and staying there.
 * The product detail has two of these (a broken option document, a trashed
 * record) and the order detail hand-rolled a third inside `OrderScreen`, which is
 * three copies of the same box with three sets of padding — so it is a primitive
 * on the second screen that needs it rather than a `<div>` on the fourth.
 *
 * `role` is the caller's because the two roles mean different things and only the
 * caller knows which it has: `alert` interrupts and is for something that is
 * wrong right now; `status` is polite and is for a condition the person should
 * know about. A trashed product is a `status`; an unreadable option set — with
 * carts already refusing to check out — is an `alert`.
 *
 * Tone is a paired `-fg`/`-bg` token per §3.5, never a hue mixed into its own
 * text colour, and the icon means the colour is never the only signal.
 */
export function Notice({
  tone,
  title,
  role = "status",
  children,
}: {
  tone: "warning" | "danger";
  title: string;
  role?: "status" | "alert";
  children?: ReactNode;
}) {
  const skin =
    tone === "danger"
      ? "border-ui-danger-fg bg-ui-danger-bg text-ui-danger-fg"
      : "border-ui-warning-fg bg-ui-warning-bg text-ui-warning-fg";

  return (
    <div
      role={role}
      className={`flex items-start gap-2.5 rounded-ui-lg border px-4 py-3 ${skin}`}
    >
      <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-ui-subheading">{title}</p>
        {children}
      </div>
    </div>
  );
}

/** A section that failed inside an otherwise working detail screen. */
export function SectionError({ children }: { children: ReactNode }) {
  return (
    <div className="ui-card px-4 py-6 text-center text-ui-label text-ui-muted">
      {children}
    </div>
  );
}
