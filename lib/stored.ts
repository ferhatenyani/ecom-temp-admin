"use client";

import { useSyncExternalStore } from "react";

/**
 * Persisted UI preferences — column visibility, table density, sidebar collapse,
 * theme.
 *
 * **Why `useSyncExternalStore` and not `useState` + `useEffect`.**
 *
 * The obvious shape is to default the state, then read `localStorage` in an
 * effect and `setState`. That is what this project's React Compiler config
 * rejects outright (`react-hooks/set-state-in-effect`), and the rule is right:
 * it renders once with the default, then again with the stored value, so a
 * reader whose sidebar is collapsed watches it expand and re-collapse on every
 * navigation.
 *
 * `localStorage` is exactly what this hook is for — an external store React does
 * not own. `getServerSnapshot` returns `null` so the server renders defaults,
 * and React swaps to the real value in the same commit as hydration rather than
 * in a second pass.
 *
 * The listener set exists because the `storage` event only fires in *other*
 * tabs. Without it, writing a preference would not re-render the tab that wrote
 * it — which is every write that matters.
 */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  /* Cross-tab: two windows open on the panel should agree about density. */
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    /* Private mode throws on access, not just on write. */
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Private mode. The value is lost on reload; nothing else breaks. */
  }
  emit();
}

/** The raw stored string, or `null` on the server and when unset. */
export function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readStored(key),
    () => null,
  );
}

/** A stored value narrowed to a known set, falling back when absent or stale. */
export function useStoredEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = useStored(key);
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** A stored boolean. Absent means `false`. */
export function useStoredFlag(key: string): boolean {
  return useStored(key) === "1";
}

/**
 * A media query as an external store, for the same reason and with the same
 * shape. Used where a *component* has to change — not merely its styling — such
 * as a Popover that becomes a Modal below `sm`, which CSS cannot express because
 * the two have different focus semantics.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
