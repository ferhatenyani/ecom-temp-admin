"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Form";
import { ForbiddenState, Notice } from "@/components/ui/States";
import { landingPath } from "@/components/ui/nav-tree";
import { useOnline } from "@/lib/use-online";

/**
 * Login collects a WordPress username and that user's Application Password. The
 * form posts to `/api/session`, which is the only route that ever receives a
 * password from the browser.
 *
 * ## No form library, and the byte argument that removed it is the same one
 *
 * The retired version held `react-hook-form` and argued at length against pairing
 * it with Zod, because `/fr/login` measured 222.4 KB against Part IX's 180 KB
 * budget and this is the first screen anybody loads, on Algerian 3G. That
 * argument survives; what it was aimed at was wrong by one layer. **A page
 * holding its own form library is the largest possible fork of a primitive** —
 * `components/ui/Form.tsx` is the panel's form layer on all forty other screens,
 * it already implements §3.4's label/hint/error/`aria-describedby` contract and
 * the pre-hydration guard, and RHF was buying this screen `register()` on two
 * fields. Two `useState`s do the same thing for nothing, and the measurement is
 * in DECISIONS.md §21 rather than predicted here.
 *
 * The real validator is still the API, which answers 401 and is the only party
 * that can. What is validated locally is *presence*, which §3.4 requires to
 * produce a **message** rather than a bare `aria-invalid` — the retired screen
 * set the attribute and rendered nothing at all beside it, so a person who
 * submitted an empty form got a form that appeared to ignore them.
 *
 * ## No `ErrorSummary`, and that is a deviation worth naming
 *
 * §3.4 asks a failed submission for a summary at the top linking each failure to
 * its field, and every other form in the run ships one. It exists because a
 * submit button at the foot of a nine-section form is nowhere near the field that
 * refused. This form is **two fields and a button inside a 400px card**, all
 * three in the viewport at every width this panel supports including the 340px
 * floor, so the link would point at something already on screen. Focus goes
 * straight to the first empty field instead, which is the thing the summary
 * exists to reach.
 *
 * ## Four refusals where there were two
 *
 * `app/api/session/route.ts` distinguishes four shapes and this screen rendered
 * two: everything that was not a 429 or a suspension collapsed into
 * *"wrong username or password"*. So a shop that was unreachable, and a panel bug
 * that sent a malformed body, both told the reader their password was wrong —
 * copy naming a cause it has not established, which is the defect class
 * `StaleBanner`'s `reason` was added to stop.
 *
 *   401 `unauthenticated`    the credential is wrong. `failed`.
 *   401 `account_suspended`  signing in again will never help. `suspended`.
 *   429                      the API's failed-login bucket: 10 per 15 minutes per
 *                            IP, and a locked-out address is refused even with
 *                            the right password. The countdown is the difference
 *                            between "it is broken" and "wait 15 minutes" — and
 *                            it is printed in the unit the wait has. See below.
 *   503 `network`            the shop is unreachable. **Retryable**, unlike a
 *                            wrong password — §3.7-4's error state, so it is the
 *                            one refusal that carries a retry.
 *   400 `invalid_request`    the panel sent a body the route would not parse.
 *                            That is a bug here, not a credential problem, and it
 *                            must not accuse the reader's password. `unexpected`.
 *
 * **And an offline submit used to be an unhandled rejection.** There was no
 * try/catch around the `fetch`, so a dropped connection threw past the handler
 * and the screen sat on a spinner for ever. A throw is the same condition the
 * 503 reports and is rendered as the same sentence with the same retry.
 *
 * ## Stale: no marker, and the disable is owed
 *
 * DESIGN.md §3.7-5 as amended on the transfer branch — *"the marker is owed by a
 * screen whose pixels can outlive the fetch that produced them; the disable is
 * owed by a screen that writes."* This screen holds **no data**: two empty inputs
 * and a translated sentence, nothing fetched, nothing cached, nothing polling. A
 * `StaleBanner` here would report the age of a constant. It **writes** — the POST
 * is the only write on the screen — so the submit carries `states.offlineWrites`
 * on its `title` and goes off while `navigator.onLine` is false, exactly as
 * `/transfer`'s three controls do.
 *
 * ## Zero capabilities is a refusal, not a redirect
 *
 * `landingPath()` answers `null` for an account holding none of the thirteen, and
 * signing that reader into an empty shell is not an answer — every nav group
 * would be filtered away and the first screen they saw would be a panel with no
 * destinations. The credential is real, so the cookie is set and they stay signed
 * in; what they get is a `ForbiddenState` naming what to ask for and who to ask.
 * It replaces the card rather than sitting inside it, because §1.6 forbids a card
 * inside a card and `StateFrame` is one.
 */
export function LoginForm({
  locale,
  reason,
  /**
   * The reader is already signed in and holds none of the thirteen capabilities.
   * The same state a fresh sign-in reaches, seeded from the server so a
   * bookmarked `/login` does not offer a form whose only outcome is this.
   */
  noDestination: alreadyEmpty = false,
}: {
  locale: string;
  reason?: string;
  noDestination?: boolean;
}) {
  const t = useTranslations("login");
  const tStates = useTranslations("states");
  const router = useRouter();
  const online = useOnline();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [missing, setMissing] = useState<{ username?: string; password?: string }>({});
  /** True once a correct credential has resolved to no reachable destination. */
  const [noDestination, setNoDestination] = useState(alreadyEmpty);

  /**
   * What is on screen, and the three things that vary with *why* it is there.
   *
   * ## The tone follows the outcome, and one banner was serving five causes
   *
   * It was hard-coded `danger` — so *"Votre session a expiré. Reconnectez-vous."*
   * rendered in the panel's colour for **something is wrong**, at a person who
   * did nothing wrong and whose session simply aged out. That is DECISIONS.md §8's
   * shipping defect exactly: four terminal moves flagged `destructive` so
   * *"Livré"* painted in `--color-danger-fg`, and the fix there was that the flag
   * follows the outcome. It is the same fix, so it lives on this object beside
   * `retryable` rather than being derived at the render site — one place decides
   * what a cause *is*, and the markup below only draws it.
   *
   *   expired, signed out   `info`     nothing failed and nothing was refused.
   *                                    The session ended, which is what sessions
   *                                    do. Sign in again and it is over.
   *   suspended             `warning`  see below — the one that took a judgement.
   *   failed, rate-limited  `danger`   the credential was refused, and the bucket
   *                                    is the same refusal counted.
   *   unreachable, 400      `danger`   §3.7-4's error state. Something is wrong;
   *                                    it is simply not the reader's password.
   *
   * **Suspended is `warning`, and the two obvious answers are both wrong.** It is
   * not `info`, because the reader is *stopped*: there is no attempt that gets
   * them in and the only way forward is a conversation with a Super Admin —
   * `route.ts:48-50` says as much, that this is distinguished from a plain 401
   * precisely so silence does not send the person round the loop for ever. And it
   * is not `danger`, because **nothing failed**. A suspension is an administrative
   * state somebody set on purpose and the panel is behaving exactly as configured;
   * painting it in the colour reserved for a failure would be a flag naming a
   * cause it has not established, which is the defect one tone over from the one
   * being fixed here. `warning` is the tone this system already uses for *a
   * condition that blocks you and that you act on outside this screen* — it is
   * what `StaleBanner` carries — and `Notice` pairs every tone with an icon, so
   * the colour is never the only signal.
   *
   * ## `role` follows it, for the same reason
   *
   * `Notice`'s own docblock: "`alert` interrupts and is for something that is
   * wrong right now; `status` is polite and is for a condition the person should
   * know about." A banner **seeded from `?reason=`** is on screen at first paint
   * and is the reason the person is looking at this page — it is read in document
   * order and interrupting with it announces an emergency about a page that has
   * only just arrived. A banner produced by a **submit** is the answer to
   * something they just did, and there `alert` is right.
   *
   * ## `retryable`
   *
   * A wrong password is not retryable — the same two values fail identically —
   * and an unreachable shop is. §3.7-4 wants the retry on the second and would be
   * offering a lie on the first.
   */
  type Refusal = {
    message: string;
    tone: "info" | "warning" | "danger";
    role: "status" | "alert";
    retryable: boolean;
  };

  const [refusal, setRefusal] = useState<Refusal | null>(
    reason === "suspended"
      ? { message: t("suspended"), tone: "warning", role: "status", retryable: false }
      : reason === "expired"
        ? { message: t("sessionExpired"), tone: "info", role: "status", retryable: false }
        : /* `signedout` has no producer today — `DELETE /api/session` has no caller
             and nothing writes the parameter, because the sign-out control belongs
             to `AppShell`'s account menu and does not exist yet. The branch stays:
             removing it would mean writing it again, and it costs one line. */
          reason === "signedout"
          ? { message: t("signedOut"), tone: "info", role: "status", retryable: false }
          : null,
  );

  const offlineReason = online ? undefined : tStates("offlineWrites");

  async function attempt() {
    const gaps = {
      username: username.trim() ? undefined : t("required"),
      password: password.trim() ? undefined : t("required"),
    };
    if (gaps.username || gaps.password) {
      setMissing(gaps);
      /* The first empty one, not the last: a person who filled neither should
         land where they would have started typing. */
      document.getElementById(gaps.username ? "username" : "password")?.focus();
      return;
    }

    setMissing({});
    setRefusal(null);
    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      // No response at all — the interface went, DNS failed, the request was
      // aborted. The same condition the route reports as 503, and the same
      // sentence, because the reader cannot tell the two apart and does not
      // need to.
      setRefusal({
        message: t("unreachable"),
        tone: "danger",
        role: "alert",
        retryable: true,
      });
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { data?: { capabilities?: string[] } }
        | null;
      const path = landingPath(body?.data?.capabilities ?? []);
      if (path === null) {
        setNoDestination(true);
        setSubmitting(false);
        return;
      }
      /* `submitting` deliberately stays true: the next paint is the panel, and a
         button that returns to its resting state under a pointer that is still on
         it invites a second POST against a 10-per-15-minutes bucket. */
      router.replace(`/${locale}${path}`);
      return;
    }

    if (response.status === 429) {
      /*
       * **The countdown is read in the unit the wait actually has.**
       *
       * The bucket is 10 failed logins per 15 minutes, so `Retry-After` is
       * routinely **900** — and this rendered it verbatim as *"Réessayez dans 900
       * secondes"*, which is a number a person has to divide before it means
       * anything. Nobody had seen it because until this branch nothing in the
       * harness could produce a 429 at all.
       *
       * Under a minute stays in seconds, because "dans 1 minute" for a 40-second
       * wait is both rounder and wronger. At or above it, minutes, rounded **up**:
       * sending somebody back at 14 minutes when the bucket clears at 14:30 is a
       * second refusal with the panel's name on it.
       *
       * With no header at all there is no figure to print. The old code invented
       * **60** for that case, which is a specific claim about a bucket it has not
       * read; `rateLimitedUnknown` says the shape of the wait and no number.
       */
      const seconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
      setRefusal({
        message:
          !(seconds > 0)
            ? t("rateLimitedUnknown")
            : seconds < 60
              ? t("rateLimited", { seconds })
              : t("rateLimitedMinutes", { minutes: Math.ceil(seconds / 60) }),
        /* The bucket is the credential refusal counted, so it is the credential
           refusal's tone. */
        tone: "danger",
        role: "alert",
        retryable: false,
      });
      setSubmitting(false);
      return;
    }

    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string } }
      | null;
    const code = body?.error?.code;
    setRefusal(
      code === "account_suspended"
        ? /* `warning`, not `danger`: nothing failed. See the state's docblock. */
          { message: t("suspended"), tone: "warning", role: "alert", retryable: false }
        : code === "unauthenticated"
          ? { message: t("failed"), tone: "danger", role: "alert", retryable: false }
          : code === "network"
            ? { message: t("unreachable"), tone: "danger", role: "alert", retryable: true }
            : /* `invalid_request`, and anything the route grows later. The reader
                 did nothing wrong and their password is not the problem. */
              { message: t("unexpected"), tone: "danger", role: "alert", retryable: false },
    );
    setSubmitting(false);
  }

  return (
    <div className="flex w-full flex-col items-stretch">
      {noDestination ? (
        <ForbiddenState capability={[]} />
      ) : (
        <Card>
          <div className="flex flex-col gap-4">
            <div>
              {/*
                The mark, **inside the card and above the heading it belongs to.**

                It sat above the card for one draft, aligned to the card's outer
                edge while the heading under it started 20px further in — and at
                1440 that read as an icon orphaned over the card rather than as
                part of its header block. Found in the capture, not in a review.
                Aligning it to the card's padding from outside would have meant a
                second copy of `Card`'s own `px-4 sm:px-5` living in this file,
                which is the drift `Card` exists to prevent; inside, it inherits
                the padding because it is in the same block as the `<h1>`.

                The forbidden state replaces the whole card and brings its own
                lock with it, so nothing is orphaned there either.

                `--color-fg`: ink, not accent. §3.3's rule that accent means
                "interactive" applies to a mark as much as to a button.
              */}
              <Icon name="lock" className="mb-3 size-6 shrink-0 text-ui-fg" />
              {/*
                The page's only heading, and it is the card's — §2.4's block is a
                title/subtitle/actions row over a page column and this screen has
                no page column. `--text-heading` is `Card`'s own title size, which
                is what "its heading is the card's" means and what lets
                `FormSkeleton` stand in for this card exactly.
              */}
              <h1 className="text-ui-heading text-ui-fg">{t("title")}</h1>
              <p className="mt-0.5 text-ui-label text-ui-muted">{t("intro")}</p>
            </div>

            {/*
              The sentence is the `Notice`'s **title** and there is no body, which
              is the opposite way round from `ExportNotice`. That is not laziness:
              a refusal here is one sentence that is both what went wrong and what
              to do about it — "wrong username or password", "this account is
              suspended, contact a Super Admin" — and splitting it would mean
              writing a heading that says less than the line under it. The retry
              is the body on the one case that has one.
            */}
            {refusal ? (
              <Notice tone={refusal.tone} role={refusal.role} title={refusal.message}>
                {refusal.retryable ? (
                  /* Wrapped, because a flex column stretches its children and a
                     retry the width of the notice reads as the primary action of
                     the screen. `ExportNotice` carries the same note. */
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="refresh"
                      onClick={() => void attempt()}
                      loading={submitting}
                      disabled={Boolean(offlineReason)}
                      title={offlineReason}
                    >
                      {tStates("retry")}
                    </Button>
                  </div>
                ) : null}
              </Notice>
            ) : null}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void attempt();
              }}
              /* The rules are this screen's and the messages are localised;
                 the browser's own bubbles are neither, and speak the browser's
                 language rather than the reader's — DECISIONS.md §19's finding
                 about a native control's chrome, one layer up. */
              noValidate
              className="flex flex-col gap-4"
            >
              <TextField
                id="username"
                label={t("username")}
                value={username}
                onChange={(next) => {
                  setUsername(next);
                  if (missing.username) setMissing({ ...missing, username: undefined });
                }}
                error={missing.username}
                validate={(value) => (value.trim() ? undefined : t("required"))}
                autoComplete="username"
                /* A login is an identifier: LTR-isolated so `ac_panel_manager`
                   is not reordered by the Arabic paragraph around it, and none of
                   the three things a browser does to prose. See `TextField`. */
                isolate
                disabled={submitting}
              />

              <TextField
                id="password"
                type="password"
                label={t("password")}
                /* The credential is displayed with spaces and people paste it
                   that way; `/api/session` strips them, so nothing here fights
                   the paste. */
                hint={t("passwordHint")}
                value={password}
                onChange={(next) => {
                  setPassword(next);
                  if (missing.password) setMissing({ ...missing, password: undefined });
                }}
                error={missing.password}
                validate={(value) => (value.trim() ? undefined : t("required"))}
                autoComplete="current-password"
                isolate
                disabled={submitting}
              />

              {/*
                **The selector contract.** `#username`, `#password` and a single
                `button[type="submit"]` are duplicated as a `signIn` helper in
                eleven e2e spec files, none of which can run in this environment —
                they need live credentials. `tests/login.test.tsx` pins all three
                so a change goes red here instead of in a suite nobody can run.
              */}
              <Button
                type="submit"
                fullWidth
                loading={submitting}
                disabled={Boolean(offlineReason)}
                title={offlineReason}
              >
                {submitting ? t("submitting") : t("submit")}
              </Button>
            </form>
          </div>
        </Card>
      )}
    </div>
  );
}
