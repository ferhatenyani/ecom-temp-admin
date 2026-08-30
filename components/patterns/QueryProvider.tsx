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
            /*
             * TanStack's own retry is off, and **nothing else backs off in its
             * place on this path** — which is not what this comment used to say.
             *
             * It read "lib/api handles a 429 by its Retry-After". That retry is
             * real but it is `lib/api/client.ts`'s, and that file is
             * `server-only`: a browser `useQuery` goes through
             * `lib/api/browser.ts` to `/api/ac/*`, whose route handler proxies
             * with a raw `fetch`. So a 429 reaching a `useQuery` is surfaced to
             * the screen as an error, with no wait and no second ask.
             *
             * That is a **known open item**, recorded here rather than fixed:
             * adding a backoff is a behaviour change, and the read bucket is
             * 600/min per credential, so an automatic retry is exactly the thing
             * that has to be argued before it is written. `retry: false` is still
             * the right default meanwhile — a blind retry against a rate limit
             * spends the budget it is reacting to, and a write must never repeat.
             */
            retry: false,
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
