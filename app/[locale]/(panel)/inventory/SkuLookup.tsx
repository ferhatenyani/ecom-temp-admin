"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * SKU in, item screen out — the fastest path from a barcode to an adjustment,
 * which is what docs/ADMIN_PANEL.md asks this field to be.
 *
 * The spec's three requirements, kept and each for its own reason:
 *
 * - **A large input.** `min-h-13` rather than the list's 44px, because this is
 *   the one control a person aims at while holding a scanner in the other hand.
 * - **`inputMode="text"`.** A SKU here is `AC-BUR-010-L` — letters, digits and
 *   hyphens — so a numeric keypad would be wrong for every SKU in this shop.
 * - **No autofocus.** Focusing on load raises the keyboard over the low-stock
 *   list, which is the screen the person actually came for. A hardware scanner
 *   types into the focused element and the person taps here first anyway.
 *
 * And **no debounce below 300 ms** is moot here, because there is no debounce at
 * all: this searches on submit. `/inventory/lookup` is an exact match — measured,
 * `?sku=AC/BUR 010` is a 404 and the search is not fuzzy — so every keystroke
 * before the last one is a request that can only 404. The scanner ends its scan
 * with Enter, which submits, and a thumb gets the same behaviour from the Go key.
 * Rate limits are 600/min per credential shared across every tab this person has
 * open; a per-keystroke lookup would spend them on answers nobody reads.
 */
export function SkuLookup({ locale }: { locale: string }) {
  const t = useTranslations("inventory");
  const router = useRouter();
  const hydrated = useHydrated();
  const input = useRef<HTMLInputElement>(null);

  const [sku, setSku] = useState("");
  const [busy, setBusy] = useState(false);
  /** The SKU that was not found, so the message can name it. */
  const [missing, setMissing] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = sku.trim();
    if (value === "" || busy) return;

    setBusy(true);
    setMissing(null);
    setFailed(null);

    try {
      const response = await fetch(
        `/api/ac/inventory/lookup?sku=${encodeURIComponent(value)}`,
        { headers: { Accept: "application/json" } },
      );
      const body = (await response.json()) as {
        success?: boolean;
        data?: { id?: number };
        error?: { code?: string; message?: string };
      };

      /*
       * **A 404 is an empty state at the field, not an error toast**, and it is
       * the single most common thing that will ever happen here — a mistyped
       * character, a label from another shop, a scanner reading a barcode that is
       * not the SKU. It stays on screen next to the input that caused it, keeps
       * the value so it can be corrected rather than retyped, and returns focus
       * to the field.
       */
      if (response.status === 404 || body.error?.code === "not_found") {
        setMissing(value);
        input.current?.focus();
        input.current?.select();
        return;
      }

      if (!response.ok || body.success === false || typeof body.data?.id !== "number") {
        setFailed(body.error?.message ?? `Request failed (${response.status})`);
        return;
      }

      // Straight to the item, where adjusting is the first thing on the screen.
      router.push(`/${locale}/inventory/${body.data.id}`);
    } catch {
      setFailed(t("lookup.notFoundHint"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} role="search" className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3">
        <Icon name="search" className="size-5 shrink-0 text-label-secondary" />
        <input
          ref={input}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="go"
          value={sku}
          /* Disabled until React owns it, like every `Field` control: a scan that
             lands before hydration would otherwise fill the box, submit nothing,
             and look like it worked. This is the screen a scanner is pointed at
             during a cold load, so the window is not theoretical here. */
          disabled={!hydrated || busy}
          aria-busy={!hydrated || busy || undefined}
          onChange={(event) => {
            setSku(event.target.value);
            if (missing !== null) setMissing(null);
            if (failed !== null) setFailed(null);
          }}
          aria-label={t("lookup.label")}
          aria-describedby={missing !== null ? "sku-missing" : undefined}
          placeholder={t("lookup.placeholder")}
          /* A SKU is an identifier: it renders LTR and isolated in both locales,
             the same treatment `Ltr` gives one in a row. */
          dir="ltr"
          data-numeric=""
          style={{ unicodeBidi: "isolate" }}
          className="min-h-13 min-w-0 flex-1 bg-transparent text-start text-body text-label outline-none placeholder:text-label-tertiary disabled:opacity-40"
        />
        {sku !== "" ? (
          <button
            type="button"
            onClick={() => {
              setSku("");
              setMissing(null);
              setFailed(null);
              input.current?.focus();
            }}
            aria-label={t("lookup.clear")}
            className="press flex size-8 shrink-0 items-center justify-center rounded-full text-label-secondary"
          >
            <Icon name="close" className="size-4" />
          </button>
        ) : null}
      </div>

      {missing !== null ? (
        <p
          id="sku-missing"
          role="status"
          className="tone-warning tonal flex items-start gap-2 rounded-md px-3 py-2 text-footnote"
        >
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          {/* The SKU is rendered as its own `Ltr` element rather than
              interpolated into the sentence: an identifier spliced into an
              Arabic string is exactly the run the bidi algorithm reorders, and
              this message exists to be read carefully against a printed label. */}
          <span className="min-w-0">
            {t("lookup.notFound")} <Ltr className="break-all">{missing}</Ltr>{" "}
            <span className="text-label-secondary">{t("lookup.notFoundHint")}</span>
          </span>
        </p>
      ) : null}

      {failed !== null ? (
        <p role="alert" className="tone-danger tonal rounded-md px-3 py-2 text-footnote">
          {failed}
        </p>
      ) : null}
    </form>
  );
}
