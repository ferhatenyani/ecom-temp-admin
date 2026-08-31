/**
 * `useShippingQuotes` — the debounced rate lookup behind the create drawer's
 * carrier block, step 2's admin sub-task 3.
 *
 * ## Why this one is not a pure-function test, when every other rule of this
 * form is
 *
 * `new-order.ts`'s docblock says the interesting half of a create form is which
 * fields go on the wire, and that it is a pure function of a plain object —
 * which is why `quoteFor` and `quoteFill`, the two decisions this hook's answer
 * feeds, are asserted in `tests/new-order.test.ts` without a single render.
 *
 * The hook itself is the exception, and deliberately: **the thing worth
 * asserting about it is timing**, and timing is not a property of any object it
 * returns. The step asks for EL's 600 ms — `CartCheckoutPage.jsx` and
 * `CreateOrderModal.jsx` both `setTimeout(…, 600)` — and "two changes inside the
 * window are one request" is a claim about a schedule that no shape can carry.
 *
 * ## It runs against the mock's own handler, not a stub
 *
 * `respond()` is imported and `fetch` is pointed at it, so the rows these
 * assertions read are the rows `scripts/mock-api.mjs` serves and the rows
 * `tests/mock-api.test.ts` parses with the panel's Zod schema. A hand-written
 * fixture here would be a second contract that drifts — the argument that file
 * opens with, applied one layer up.
 *
 * `MOCK_COURIERS=on` because the multi-courier answer this hook exists to read
 * **cannot exist on this install**: `BLOCKED.md` item 2 measures all eight
 * courier variables empty and `shipping-check` reporting `manual` alone. The
 * mock reproduces `Plugin::shippingProviders()`'s gate rather than one side of
 * it; this is the arm the picker was built for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useShippingQuotes } from "@/app/[locale]/(panel)/orders/CarrierFields";
import { quoteFor } from "@/app/[locale]/(panel)/orders/new-order";
import { BASE_PATH, resetState, respond } from "@/scripts/mock-api.mjs";

/** Every request the hook made, which is the quantity half of "debounced". */
let calls: string[] = [];

beforeEach(() => {
  calls = [];
  vi.stubEnv("MOCK_COURIERS", "on");
  resetState();

  vi.stubGlobal("fetch", async (url: string) => {
    const parsed = new URL(url, "http://mock.invalid");
    calls.push(parsed.search);
    const response = respond(
      "GET",
      parsed.pathname.replace("/api/ac", BASE_PATH),
      parsed.searchParams,
      null,
    );
    return new Response(JSON.stringify(response.body), { status: response.status });
  });
});

function wrapper({ children }: { children: React.ReactNode }) {
  /* A fresh client per case, so one case's answer is not another's cache — the
     same isolation `resetState()` gives the mock. `retry: false` because a
     failure is a state this suite asserts rather than one it waits out. */
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

const pause = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

type Props = { communeId: string; deliveryType?: "home" | "desk"; enabled?: boolean };

const mount = (initial: Props) =>
  renderHook(
    (props: Props) =>
      useShippingQuotes({
        wilayaId: "16",
        communeId: props.communeId,
        deliveryType: props.deliveryType ?? "home",
        enabled: props.enabled ?? true,
      }),
    { wrapper, initialProps: initial },
  );

describe("nothing is asked until there is something to ask about", () => {
  it("sends no request for half a destination", async () => {
    /* `rateArgs()` declares `wilaya_id` and `commune_id` `required` with
       `minimum: 1`, so a pair with a hole in it is a 400 whose `details.params`
       is a bare array of *names* — the shape `lib/api/browser.ts` deliberately
       refuses to render as an explanation. The query is simply disabled. */
    const { result } = mount({ communeId: "" });

    expect(result.current.asked).toBe(false);
    expect(result.current.loading).toBe(false);
    await pause(800);
    expect(calls).toEqual([]);
  });

  it("sends no request for a drawer nobody has opened", async () => {
    /* `ProductPicker`'s gate, borrowed: the drawer passes `open &&
       canQuoteShipping`, so a shut form fetches nothing and a reader without
       `ac_manage_shipping` never earns a 403 it could not have used. */
    mount({ communeId: "484", enabled: false });
    await pause(800);
    expect(calls).toEqual([]);
  });
});

describe("the debounce, at EL's 600 ms", () => {
  it("collapses a correction inside the window into one request", async () => {
    const { result, rerender } = mount({ communeId: "" });

    // The operator picks a commune. Queued, and `loading` says so at once —
    // without that the fee would sit at the old price looking settled.
    rerender({ communeId: "483" });
    expect(result.current.loading).toBe(true);
    expect(calls).toEqual([]);

    // …then corrects it, well inside the window.
    await pause(200);
    rerender({ communeId: "484" });
    expect(calls).toEqual([]);

    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0), { timeout: 3000 });

    /* One request, and it is the second destination's. The first was never
       sent — which is the whole point against a rate limit counted per
       credential across every open tab. */
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("commune_id=484");
    expect(result.current.loading).toBe(false);
  });

  it("clears at once when the destination is emptied, without waiting", async () => {
    const { result, rerender } = mount({ communeId: "" });
    rerender({ communeId: "484" });
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0), { timeout: 3000 });

    /* Changing the wilaya clears the commune — `DestinationFields` does it in
       the same handler — and there is no pending answer worth 600 ms of still
       showing. Only *asking* is debounced. */
    rerender({ communeId: "" });
    expect(result.current.asked).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("asks again when only the journey moves, because the answer differs", async () => {
    const { result, rerender } = mount({ communeId: "" });
    rerender({ communeId: "484" });
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: 3000 });

    rerender({ communeId: "484", deliveryType: "desk" });
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 3000 });
    expect(calls[1]).toContain("delivery_type=desk");

    /* And it is genuinely a different answer: `ShippingRule::matches()` tests a
       rule's own delivery type against the destination's, and the seeded rules
       all carry `home` — so the shop's tariff prices the doorstep and says
       nothing about the desk. A three-element query key would have served one
       journey's answer for the other. */
    await waitFor(() => expect(quoteFor(result.current.rows, "manual", "desk")).toBeNull(), {
      timeout: 3000,
    });
  });
});

describe("what one request comes back with", () => {
  it("prices every registered courier at once, several rows each", async () => {
    const { result, rerender } = mount({ communeId: "" });
    rerender({ communeId: "484" });
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0), { timeout: 3000 });

    /* **No `provider` on the wire.** It is a filter, and omitting it is what
       lets one request label every option in the picker — the alternative was N
       requests to draw one control. */
    expect(calls[0]).not.toContain("provider=");

    const providers = new Set(result.current.rows.map((row) => row.provider));
    expect([...providers].sort()).toEqual(["manual", "yalidine", "zrexpress"]);

    /* Both sources in one answer, which is what the picker has to be able to
       say: `manual` has no rate API at all, so its only price is §14's tariff,
       and the couriers get no tariff row because the seeded rules name `manual`. */
    expect(quoteFor(result.current.rows, "manual", "home")?.source).toBe("rules");
    expect(quoteFor(result.current.rows, "yalidine", "home")?.source).toBe("provider");

    /* Yalidine returns all four of its services whatever journey was asked
       about, so the client filters — `RateQuote::coversDeliveryType()`, which is
       `quoteFor`. Both journeys are present in a `home` answer. */
    expect(quoteFor(result.current.rows, "yalidine", "desk")).not.toBeNull();
  });

  it("leaves a courier out where it has nothing mapped, and says nothing else changed", async () => {
    /* The state `BLOCKED.md` says every destination is in until
       `sync-destinations` runs: the adapter returns `[]` rather than throwing,
       so the tariff still answers and the courier is simply absent. That is the
       picker's "no price here" option, and it is why nothing is filtered out of
       the list. */
    const { result } = renderHook(
      () =>
        useShippingQuotes({
          wilayaId: "1",
          communeId: "1",
          deliveryType: "home",
          enabled: true,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(quoteFor(result.current.rows, "manual", "home")?.amount).toBe("800.00");
    expect(quoteFor(result.current.rows, "yalidine", "home")).toBeNull();
    expect(result.current.failure).toBeNull();
  });

  it("reports a failure as the API's own sentence and never as a missing quote", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: "invalid_request", message: "The shipment data is invalid." },
          }),
          { status: 400 },
        ),
    );

    const { result } = mount({ communeId: "484" });

    await waitFor(() => expect(result.current.failure).toBe("The shipment data is invalid."), {
      timeout: 3000,
    });

    /* No rows, and **nothing here disables anything.** `DestinationFields`
       follows the same rule for its own failure and for the reason the whole
       branch turns on: a courier API that is down must not be the reason an
       order taken by phone cannot be written down. The fee stays exactly as the
       operator left it. */
    expect(result.current.rows).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
