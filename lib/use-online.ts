"use client";

import { useEffect, useState } from "react";

/**
 * Whether the browser currently believes it has a connection.
 *
 * `navigator.onLine` is a hint and not a guarantee — it reports the interface,
 * not reachability, so it is true on a van's phone holding a bar of signal that
 * carries nothing. It is still worth reading: when it is **false** the browser is
 * certain, and that is the direction this is used in. A failed fetch is the real
 * signal for the other direction, which is why `lib/api/client.ts` throws
 * `NetworkError` rather than consulting this.
 *
 * Starts `true` and corrects on mount. Reading `navigator` during render would
 * differ between the server and the first client paint, which React reports as a
 * hydration mismatch — and a panel that logs a hydration error on every phone in
 * a warehouse basement has replaced one problem with two.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
