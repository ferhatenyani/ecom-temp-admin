"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * Toasts confirm something that already happened. See DESIGN.md §3.1.
 *
 * **Restyled in place, not forked.** Thirty-two screens import `useToast` and
 * most of them have not migrated, so the props are exactly what they were —
 * `show(message, tone?)` with `tone` one of `"default" | "danger"` — and only the
 * rendering changed. The file stays under `primitives/` for the same reason: a
 * `components/ui/Toast.tsx` would have meant thirty-two import rewrites on a
 * branch that owns none of those screens.
 *
 * What changed, and why each was wrong:
 *
 *   - It was on the retired iOS classes — `material-bar`, `tone-accent`,
 *     `tone-danger`, `tonal-fg`, `text-subhead` — so it rendered as a **coloured
 *     pill** on a translucent ground with no elevation at all: measured
 *     `color(srgb 1 1 1 / 0.88)`, an iOS separator hairline and `box-shadow:
 *     none`. §3.1 asks instead for the surface colour, a border, the small
 *     elevation token, and "not a coloured banner" in as many words. The tone now
 *     lives in the icon alone, on the same surface as every card.
 *   - `.toast-anchor` held it `calc(4.25rem + safe-inset)` off the bottom to
 *     clear a bottom tab bar. §0 retired that bar and `AppShell` never had one.
 *     **Measured rather than assumed, and the ledger overstated it:** the old
 *     rule dropped to `1.5rem` at `md`, so the 68px was real only *below* 768px —
 *     68px on a phone, already 24px on a desktop. What was wrong at every width
 *     was the centring: §3.1 wants bottom inline-end at `sm`+ and bottom centre
 *     only below it, and the old anchor centred everywhere.
 *   - Every toast expired at 4s, including failures. §3.1 gives an error 6s,
 *     because a sentence a person did not expect takes longer to read than one
 *     they did.
 *
 * `aria-live="polite"` on a container that is always in the DOM: a live region
 * mounted at the same moment as its content is not reliably announced. `polite`
 * for both tones deliberately — `assertive` interrupts, and §3.1 says an error a
 * person must act on is not a toast in the first place, so nothing that lands
 * here is worth cutting a screen reader off mid-sentence for.
 */

type Toast = { id: number; message: string; tone: "default" | "danger" };

/** §3.1: 4s, 6s for errors. */
const DURATION: Record<Toast["tone"], number> = { default: 4000, danger: 6000 };

const ToastContext = createContext<{ show: (message: string, tone?: Toast["tone"]) => void }>({
  show: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);

  const show = useCallback((message: string, tone: Toast["tone"] = "default") => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), DURATION[toast.tone]);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="ui-toast-anchor pointer-events-none fixed z-30 flex"
      >
        {toast ? (
          /*
           * The whole toast is the dismiss control, which is what it was and is
           * still right: there is nothing else in it to click, and a separate ×
           * would be a second 44px target inside a strip that disappears on its
           * own. Its accessible name is the message, so no `aria-label` is needed
           * and one would only shadow the sentence.
           */
          <button
            type="button"
            onClick={() => setToast(null)}
            className={[
              "ui-toast ui-ring pointer-events-auto flex max-w-sm items-start gap-2",
              "rounded-ui-lg border border-ui-line bg-ui-surface px-3 py-2.5 shadow-ui-sm",
              "text-start text-ui-compact text-ui-fg",
            ].join(" ")}
          >
            {/* The only tinted thing. `Icon` is `aria-hidden` at the source, and
                the message beside it is the word §3.5 asks to sit with a colour. */}
            <Icon
              name={toast.tone === "danger" ? "alert" : "check"}
              className={`mt-0.5 size-4 shrink-0 ${
                toast.tone === "danger" ? "text-ui-danger-fg" : "text-ui-success-fg"
              }`}
            />
            <span className="min-w-0">{toast.message}</span>
          </button>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
