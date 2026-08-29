"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/primitives/Icon";
import { Button, ButtonLink } from "./Button";

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
  /**
   * The one thing to do about the absence. `onClick` for a client screen's own
   * handler; `href` where the remedy is a **navigation**.
   *
   * `href` was added on the marketing branch and it is a boundary fact rather
   * than a convenience: this module is `"use client"`, so a Server Component
   * cannot pass a function through it at all — and two of this run's empty states
   * are server-rendered with a URL for a remedy (a page past the end, whose way
   * back is `?page=1`). Without it those states had to ship actionless, which is
   * the inventory branch's defect #3 — a report paged past its last page with no
   * way back.
   */
  action?: { label: string; onClick?: () => void; href?: string };
  icon?: IconName;
}) {
  return (
    <StateFrame
      icon={icon}
      body={message}
      detail={detail}
      action={
        action === undefined ? null : action.href !== undefined ? (
          <ButtonLink href={action.href} variant="secondary" size="sm">
            {action.label}
          </ButtonLink>
        ) : (
          <Button variant="secondary" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        )
      }
    />
  );
}

/**
 * 3. Forbidden — names the capability required and who to ask. Never a blank
 * page, never a logout, never a disappearing toast. It stays on screen.
 *
 * ## One capability or several, added on the transfer branch
 *
 * Every screen before it refuses on **one** capability, so `capability: string`
 * and `states.forbiddenBody`'s singular sentence were the whole contract.
 * `/transfer` is the panel's only screen whose gate is per *subject*: four export
 * cards behind four different capabilities (`SUBJECT_CAPABILITY` in
 * `lib/transfer.ts`), and the page as a whole is refused only to a reader holding
 * **none** of them. Naming one of the four would be false — any one of them opens
 * the screen — and naming none is the blank page §3.7-3 forbids.
 *
 * So an array names them all, through `states.forbiddenBodyAny`, which is a
 * second sentence beside the singular one rather than a rewrite of it: the
 * thirteen screens passing a string are untouched and read exactly as before.
 *
 * The names are joined with `Intl.ListFormat` in the reader's own locale rather
 * than with a comma, because the separator is the locale's — French wants
 * `A, B, C ou D` and Arabic wants `أ أو ب`, and a hard-coded `", "` also carries
 * the wrong comma in Arabic (`،`). The `disjunction` type is the honest one: the
 * reader needs *any* of the four, not all of them.
 */
export function ForbiddenState({ capability }: { capability: string | readonly string[] }) {
  const t = useTranslations("states");
  const locale = useLocale();

  const slugs = typeof capability === "string" ? [capability] : capability;
  /* An unlabelled capability is a missing translation, not a reason to render
     nothing — so it falls back to its own identifier. */
  const names = slugs.map((slug) =>
    t.has(`capability.${slug}`) ? t(`capability.${slug}`) : slug,
  );

  return (
    <StateFrame
      icon="lock"
      title={t("forbiddenTitle")}
      body={
        names.length === 1
          ? t("forbiddenBody", { capability: names[0] })
          : t("forbiddenBodyAny", {
              capabilities: new Intl.ListFormat(locale, { type: "disjunction" }).format(names),
            })
      }
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
 *
 * **`reason` exists because the notifications branch gave this banner a second
 * cause, and the sentence it already had was only true of the first.** Every
 * caller before it gated on `!useOnline()`, so "hors ligne" was a fact. §3.7-4's
 * amendment adds *the last refetch failed* — which happens with the interface
 * perfectly online, one dropped request among many — and the banner went on
 * telling the reader they were offline. That is a marker naming a cause it has
 * not established, which is the same defect class as a label naming an action
 * that does not exist.
 *
 * It defaults to `offline`, so the twenty-two callers that really do mean it are
 * unchanged and were not touched. The age is the load-bearing half either way;
 * the cause is what the reader does something about.
 */
export function StaleBanner({
  time,
  reason = "offline",
}: {
  time: string;
  reason?: "offline" | "refreshFailed";
}) {
  const t = useTranslations("states");
  return (
    <div
      role="status"
      className="mb-3 flex items-center gap-2 rounded-ui-lg border border-ui-line bg-ui-warning-bg px-3 py-2 text-ui-warning-fg"
    >
      <Icon name="clock" className="size-4 shrink-0" />
      <span className="text-ui-label">{t(reason, { time })}</span>
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
 *
 * ## `success` and `info`, added on the marketing branch
 *
 * It took `warning | danger` only, which is two of §3.5's five and was right
 * while every caller was reporting something wrong. The campaign composer needs
 * the other direction and cannot use a `Toast` for it: `send` answers 202 naming
 * **the command that will actually send the mail**, so the confirmation carries a
 * string somebody has to read, copy and run. §3.1's own rule — "an error a person
 * must act on is not a toast" — is really about *acting*, and a success that
 * hands over work is the same case; a 4-second toast would take the command away
 * mid-sentence. The test-send result is the pair on the other side: a 200 that
 * reports `sent: true` is a success and `sent: false` is a warning, and rendering
 * them in two different components would be a fork.
 *
 * The icon follows the tone, so the colour is still never the only signal: a
 * check for a success, an alert for everything else. There is no `neutral`, and
 * that is deliberate — an untoned box with a border is a `Card`.
 */
const NOTICE_SKIN: Record<NoticeTone, string> = {
  info: "border-ui-info-fg bg-ui-info-bg text-ui-info-fg",
  success: "border-ui-success-fg bg-ui-success-bg text-ui-success-fg",
  warning: "border-ui-warning-fg bg-ui-warning-bg text-ui-warning-fg",
  danger: "border-ui-danger-fg bg-ui-danger-bg text-ui-danger-fg",
};

type NoticeTone = "info" | "success" | "warning" | "danger";

export function Notice({
  tone,
  title,
  role = "status",
  children,
}: {
  tone: NoticeTone;
  title: string;
  role?: "status" | "alert";
  children?: ReactNode;
}) {
  return (
    <div
      role={role}
      className={`flex items-start gap-2.5 rounded-ui-lg border px-4 py-3 ${NOTICE_SKIN[tone]}`}
    >
      <Icon
        name={tone === "success" ? "check" : "alert"}
        className="mt-0.5 size-4 shrink-0"
      />
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
