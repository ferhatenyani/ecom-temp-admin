"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether React has taken over this component's DOM yet.
 *
 * **The defect this exists for, measured on WebKit on the product detail
 * screen:** a keystroke that lands after the server's HTML paints but before the
 * client bundle hydrates changes the input's DOM value and never reaches React.
 * The controlled `value` prop is unchanged, so the form never goes dirty, the
 * save bar never appears, and the characters sit on screen looking accepted. React
 * does not reconcile a controlled input's DOM value on hydration, so nothing
 * corrects it and nothing warns. Chromium hides it — it hydrates fast enough on a
 * warm local dev server that the window is hard to hit — which is exactly why it
 * survived two branches: no default test run touches the engine that shows it.
 *
 * The adjust form is where a fast thumb meets a cold load: someone scans a
 * barcode, the item screen opens, and they are already typing a quantity. So the
 * fix lands at `Field` level, once, and every form in the panel gets it.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, because it is the
 * one hook that is *specified* to return the server snapshot during SSR and the
 * client snapshot from the first client render onwards. The effect version has a
 * paint between hydration and the effect firing, which is another frame of the
 * same window it is meant to close — smaller, but the same bug.
 *
 * The store never changes, so `subscribe` returns a no-op unsubscribe and no
 * listener is ever called.
 */

const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
