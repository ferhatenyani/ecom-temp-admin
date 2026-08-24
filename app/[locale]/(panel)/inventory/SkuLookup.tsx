"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BrowserApiError, acRead } from "@/lib/api/browser";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { IconButton } from "@/components/ui/Button";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * SKU in, item screen out — the fastest path from a barcode to an adjustment,
 * which is what docs/ADMIN_PANEL.md asks this field to be.
 *
 * The spec's three requirements, kept and each for its own reason:
 *
 * - **A large input.** `.ui-field` rather than a fixed height: it is 44px on a
 *   coarse pointer, which is the figure that matters — this is the one control a
 *   person aims at while holding a scanner in the other hand — and 36px on a
 *   mouse, where a 52px box would stand a head above every other control in the
 *   toolbar beside it. The old screen hard-coded 52px at every width because the
 *   iOS field layer had no coarse-pointer case at all.
 * - **`inputMode="text"`.** A SKU here is `AC-BUR-010-L` — letters, digits and
 *   hyphens — so a numeric keypad would be wrong for every SKU in this shop.
 * - **No autofocus.** Focusing on load raises the keyboard over the low-stock
 *   list, which is the screen the person actually came for. A hardware scanner
 *   types into the focused element and the person taps here first anyway.
 *
 * And **no debounce below 300 ms** is moot, because there is no debounce at all:
 * this searches on submit. `/inventory/lookup` is an exact, case-sensitive match
 * — measured, `?sku=AC/BUR 010` is a 404 and nothing fuzzy exists — so every
 * keystroke before the last one is a request that can only 404. The scanner ends
 * its scan with Enter, which submits, and a thumb gets the same behaviour from
 * the Go key. Reads are 600/min per credential shared across every tab this
 * person has open; a per-keystroke lookup would spend them on answers nobody
 * reads.
 *
 * **It renders on both views and on its own toolbar row**, above the tab strip
 * and away from the list's own search box. It is not a filter of this list — it
 * is its own endpoint and its answer is a *navigation* — so the low-stock
 * report's empty parameter set has nothing to say about it, and putting the two
 * boxes side by side made one control read as two copies of the other.
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
      const { data } = await acRead<{ id?: number }>(
        `/inventory/lookup?sku=${encodeURIComponent(value)}`,
      );
      if (typeof data?.id !== "number") {
        setFailed(t("lookup.notFoundHint"));
        return;
      }
      // Straight to the item, where adjusting is the first thing on the screen.
      router.push(`/${locale}/inventory/${data.id}`);
    } catch (error) {
      /*
       * **A 404 is an empty state at the field, not an error**, and it is the
       * single most common thing that will ever happen here — a mistyped
       * character, a label from another shop, a scanner reading a barcode that is
       * not the SKU. It stays on screen next to the input that caused it, keeps
       * the value so it can be corrected rather than retyped, and returns focus
       * to the field with the text selected.
       *
       * `code === "not_found"` and not merely the status: an unrouted path
       * answers 404 `rest_no_route`, and "no such SKU" and "the request went
       * nowhere" are different things to tell somebody holding a label.
       *
       * The refocus is an effect below rather than a call here — see it for why
       * this line used to do nothing at all.
       */
      if (!(error instanceof BrowserApiError)) {
        setFailed(error instanceof Error ? error.message : String(error));
        return;
      }
      const failure = error;
      if (failure.status === 404 && failure.code === "not_found") {
        setMissing(value);
        return;
      }
      setFailed(failure.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Back to the field, with the value selected, once a miss has landed.
   *
   * **An effect rather than a call inside the handler, and that is a repair.**
   * The input is `disabled` while the request is in flight — the hydration guard
   * every control in this panel carries — and `HTMLElement.focus()` on a disabled
   * element is a no-op. The 404 branch called `focus()` and `select()` before
   * `setBusy(false)` had re-enabled anything, so the one behaviour that makes a
   * mistyped SKU a one-character fix silently did nothing: focus stayed on
   * `<body>`, and a scanner's next scan went nowhere. Measured in Chromium
   * against the harness, `document.activeElement` reading `null` for the field's
   * own label.
   *
   * Keyed on both, so it runs on the render that has actually re-enabled the
   * control. `onChange` clears `missing`, so a second miss on the same SKU
   * re-arms it.
   */
  useEffect(() => {
    if (missing === null || busy) return;
    input.current?.focus();
    input.current?.select();
  }, [missing, busy]);

  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-80">
      <form
        onSubmit={submit}
        role="search"
        /* `.ui-ring-within`: the border is on the form and the focus lands on the
           input inside, whose own outline is suppressed — neither `.ui-ring` nor
           `.ui-ring-peer` reaches that. See globals.css. */
        className="ui-interactive ui-ring-within flex min-w-0 items-center gap-1.5 rounded-ui-md border border-ui-line-control bg-ui-surface ps-2.5 pe-1"
      >
        <Icon name="box" className="size-4 shrink-0 text-ui-subtle" />
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
          /* Disabled until React owns it, like every control in `Form.tsx`: a
             scan that lands before hydration would otherwise fill the box, submit
             nothing, and look like it worked. This is the screen a scanner is
             pointed at during a cold load, so the window is not theoretical. */
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
          className="ui-field min-w-0 flex-1 bg-transparent text-start text-ui-compact text-ui-fg outline-none placeholder:text-ui-subtle disabled:opacity-50"
        />
        {sku !== "" ? (
          <IconButton
            label={t("lookup.clear")}
            icon="close"
            size="sm"
            onClick={() => {
              setSku("");
              setMissing(null);
              setFailed(null);
              input.current?.focus();
            }}
          />
        ) : null}
      </form>

      {missing !== null ? (
        <p
          id="sku-missing"
          role="status"
          className="flex items-start gap-1.5 text-ui-label text-ui-warning-fg"
        >
          <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
          {/* The SKU is its own `Ltr` element rather than interpolated into the
              sentence: an identifier spliced into an Arabic string is exactly the
              run the bidi algorithm reorders, and this message exists to be read
              carefully against a printed label. */}
          <span className="min-w-0">
            {t("lookup.notFound")} <Ltr numeric={false} className="break-all">{missing}</Ltr>{" "}
            <span className="text-ui-muted">{t("lookup.notFoundHint")}</span>
          </span>
        </p>
      ) : null}

      {failed !== null ? (
        <p role="alert" className="flex items-start gap-1.5 text-ui-label text-ui-danger-fg">
          <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{failed}</span>
        </p>
      ) : null}
    </div>
  );
}
