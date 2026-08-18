"use client";

import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { ListGroup } from "@/components/primitives/GroupedList";
import { Icon } from "@/components/primitives/Icon";

type Values = { username: string; password: string };

/**
 * Login collects a WordPress username and that user's Application Password. The
 * form posts to `/api/session`, which is the only route that ever receives a
 * password from the browser.
 *
 * **No Zod here, and that is a measured decision rather than an inconsistency.**
 * Part II pairs RHF with Zod, and Zod earns its place parsing API responses at the
 * boundary — which happens on the server, where its weight is free. On this form it
 * validated two fields as "present" and cost **60 KB gzipped in the browser**:
 * measured, `/fr/login` was 222.4 KB against Part IX's 180 KB budget, and this is
 * the first screen anybody loads, on Algerian 3G. RHF's own `required` rule says
 * the same thing for nothing.
 *
 * The real validator is the API, which answers 401 and is the only party that can.
 */
export function LoginForm({ locale, reason }: { locale: string; reason?: string }) {
  const t = useTranslations("login");
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(
    reason === "suspended"
      ? t("suspended")
      : reason === "expired"
        ? t("sessionExpired")
        : reason === "signedout"
          ? t("signedOut")
          : null,
  );

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<Values>();

  async function onSubmit(values: Values) {
    setFailure(null);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (response.ok) {
      router.replace(`/${locale}/orders`);
      return;
    }

    if (response.status === 429) {
      // The API's failed-login bucket is real: 10 per 15 minutes per IP, and a
      // locked-out address is refused even with the correct password. Showing the
      // countdown is the difference between "it is broken" and "wait 4 minutes".
      const seconds = Number.parseInt(response.headers.get("retry-after") ?? "0", 10);
      setFailure(t("rateLimited", { seconds: Number.isFinite(seconds) ? seconds : 60 }));
      return;
    }

    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string } }
      | null;
    setFailure(
      body?.error?.code === "account_suspended" ? t("suspended") : t("failed"),
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {failure ? (
        <div
          role="alert"
          className="tone-danger tonal mb-4 flex items-start gap-2 rounded-lg px-4 py-3"
        >
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          <p className="text-subhead">{failure}</p>
        </div>
      ) : null}

      <ListGroup footnote={t("passwordHint")}>
        <div className="list-row flex min-h-11 items-center gap-3 px-4 py-2">
          <label htmlFor="username" className="w-28 shrink-0 text-body text-label">
            {t("username")}
          </label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={errors.username ? true : undefined}
            className="min-w-0 flex-1 bg-transparent py-2 text-body text-label outline-none placeholder:text-label-tertiary"
            {...register("username", { required: true })}
          />
        </div>
        <div className="list-row flex min-h-11 items-center gap-3 px-4 py-2">
          <label htmlFor="password" className="w-28 shrink-0 text-body text-label">
            {t("password")}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            /* The credential is displayed with spaces and people paste it that
               way; the server strips them, so nothing here fights the paste. */
            className="min-w-0 flex-1 bg-transparent py-2 text-body text-label outline-none placeholder:text-label-tertiary"
            {...register("password", { required: true })}
          />
        </div>
      </ListGroup>

      <Button type="submit" fullWidth loading={isSubmitting}>
        {isSubmitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
