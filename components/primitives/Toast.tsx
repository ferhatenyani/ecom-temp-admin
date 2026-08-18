"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * Toasts confirm; they never carry error detail the user needs to act on — that
 * goes on the screen, where it stays. One at a time, four seconds, dismissible,
 * bottom-anchored above the tab bar and inside the safe area.
 *
 * `aria-live="polite"` on a container that is always in the DOM: a live region
 * mounted at the same moment as its content is not reliably announced.
 */

type Toast = { id: number; message: string; tone: "default" | "danger" };

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
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="toast-anchor pointer-events-none fixed z-30 flex justify-center px-4"
      >
        {toast ? (
          <button
            type="button"
            onClick={() => setToast(null)}
            className={[
              "toast material-bar pointer-events-auto flex max-w-sm items-center gap-2",
              "rounded-full px-4 py-3 text-subhead text-label",
              toast.tone === "danger" ? "tone-danger" : "tone-accent",
            ].join(" ")}
          >
            <Icon
              name={toast.tone === "danger" ? "alert" : "check"}
              className="size-4 shrink-0 tonal-fg"
            />
            <span className="min-w-0">{toast.message}</span>
          </button>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
