"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SUBJECT_CAPABILITY, isExportSubject, type ExportSubject } from "@/lib/transfer";
import { Button } from "./Button";
import { Notice } from "./States";

/**
 * A refused CSV export, reported on the screen the reader left.
 *
 * ## Why this is a component of its own rather than a sixth state
 *
 * `States.tsx` is a set of *shapes* — five states plus `Notice` and
 * `SectionError` — and not one of them knows a route, a parameter name or a
 * subject. This one knows all three: it reads `export_error` and `export_status`
 * off the URL, and those two names are written by
 * `app/api/export/[subject]/route.ts` and by nothing else. Putting it beside the
 * five would put an export subject inside the generic state layer and split the
 * parameter contract across a file that has no other reason to mention exports.
 * It is *built from* `Notice`, which is the part `States.tsx` owns.
 *
 * ## Why a `Notice` and not a `Toast`
 *
 * DESIGN.md §3.1: "An error a person must act on is not a toast." The reader
 * pressed Export and got nothing; the answer has to stay on screen until they
 * have read it, and a 4-second box that takes the capability's name away with it
 * is worse than silence. It is dismissible, and dismissing is a real control
 * carrying a label rather than a bare cross.
 *
 * ## Two cases, and deliberately only two
 *
 * **403** — refused, and it names the capability, because that is the one thing
 * a person can act on: they know who to ask. `SUBJECT_CAPABILITY` maps the
 * subject to it and `states.capability.*` already labels all thirteen in both
 * locales, so the sentence is the panel's own.
 *
 * **Everything else** — it did not go through, in one line, naming no cause.
 * A 502 is a shop that could not be reached, a 401 a session that has gone, a
 * 400 a `limit` the route already clamps: three different sentences would be
 * three guesses, and the panel has measured none of them from this position.
 *
 * **The API's own message is never in the URL and never on screen here.** That is
 * DECISIONS.md §11's rule — the panel asks its own mirror which refusal this is
 * rather than parsing the API's prose — and it is also what keeps a foreign
 * language, and a reflected parameter, off a screen that speaks two of its own.
 * The subject is validated against `EXPORT_SUBJECTS` before anything renders, so
 * a hand-edited `?export_error=<anything>` renders nothing at all.
 */

/**
 * The two parameters, written by `app/api/export/[subject]/route.ts`.
 *
 * They are spelled out there too rather than imported from here: this module is
 * `"use client"`, so a Route Handler importing a constant from it would be
 * handed a client reference instead of the string. Two literals, and each file
 * names the other.
 */
const ERROR_PARAM = "export_error";
const STATUS_PARAM = "export_status";

/**
 * Where the export link should send the reader back to: this screen, with the
 * filters they are looking at.
 *
 * The route validates it as a same-origin panel path and refuses anything else,
 * so this is a convenience rather than the guard — see `returnPath()` there.
 */
export function useExportFrom(): string {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return searchParams.size > 0 ? `${pathname}?${searchParams}` : pathname;
}

/** The export href, with the return path attached. */
export function exportHref(subject: ExportSubject, from: string): string {
  return `/api/export/${subject}?from=${encodeURIComponent(from)}`;
}

export function ExportNotice() {
  const t = useTranslations("states");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const subject = searchParams.get(ERROR_PARAM) ?? "";
  const status = Number.parseInt(searchParams.get(STATUS_PARAM) ?? "", 10);

  if (!isExportSubject(subject)) return null;

  /*
   * `replace`, not `push`: dismissing a message is not a place in the history a
   * person would want the back button to return them to. Every other parameter
   * survives — the filters, the page, an open peek — because the reader was sent
   * back here to keep them.
   */
  function dismiss() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(ERROR_PARAM);
    params.delete(STATUS_PARAM);
    router.replace(`${pathname}${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
  }

  const refused = status === 403;

  return (
    <div className="mb-3">
      <Notice
        tone="danger"
        role="alert"
        title={refused ? t("export.refusedTitle") : t("export.failedTitle")}
      >
        <p className="text-ui-body">
          {refused
            ? t("export.refusedBody", {
                capability: t(`capability.${SUBJECT_CAPABILITY[subject]}`),
              })
            : t("export.failedBody")}
        </p>
        {/* Wrapped, because a flex column stretches its children and a dismiss
            control the width of the notice reads as the primary action of it. */}
        <div>
          <Button variant="secondary" size="sm" onClick={dismiss}>
            {t("export.dismiss")}
          </Button>
        </div>
      </Notice>
    </div>
  );
}
