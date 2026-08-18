"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * TanStack Query owns everything after the first paint. RSC renders page one; the
 * client owns filters, pagination and mutations from then on.
 *
 * The polling budget is the reason several of these defaults are not the library's:
 * reads are 600/min **per credential**, and one staff member with the orders board
 * open in two tabs is one credential. Four staff with two tabs each, polling every
 * 5 s, would spend 192/min before anyone clicked anything.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Everything refetches on focus and after a mutation. Only the orders
            // list polls, and it declares its own interval.
            refetchOnWindowFocus: true,
            refetchInterval: false,
            // Polling pauses when the document is hidden — a phone in a pocket
            // must not spend the shop's rate limit.
            refetchIntervalInBackground: false,
            staleTime: 15_000,
            // The client's own retry is off: lib/api handles a 429 by its
            // Retry-After and never retries a write.
            retry: false,
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
