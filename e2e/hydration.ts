import { expect, type Locator } from "@playwright/test";

/**
 * Press a control until the thing it does has happened.
 *
 * ## The race, which is the panel's architecture rather than a bug
 *
 * Every list and detail here is server-rendered and every control on it is a
 * client component. Between paint and hydration the markup is complete and
 * interactive-looking — a real `<button>`, focusable, styled — and React is not
 * listening yet, so a press is swallowed and nothing happens. Playwright clicks
 * as soon as an element is visible and enabled, which on a cold route is
 * comfortably inside that window.
 *
 * The failures it produces are the confusing kind: the click reports success,
 * and the test then waits out its whole budget for a dialog that was never going
 * to open or a navigation that was never going to start. The snapshot shows the
 * control focused and `[active]` with no dialog anywhere. In the suite's first
 * full run this accounted for the largest group of remaining failures across
 * five specs, and **every one of them passed when run alone** — the route was
 * warm, hydration won, and the same assertions held.
 *
 * `lib/use-hydrated.ts` is the panel's own answer on the rendering side —
 * `Form.tsx` keeps fields disabled until it flips, which is what
 * `inventory.spec.ts`'s "the hydration hazard" test pins — but it is per control
 * and there is no page-wide signal a test can wait on.
 *
 * ## Why a retry and not a wait
 *
 * There is no honest number to sleep for: hydration time depends on the route,
 * the bundler's cache and what else is running. Retrying the press until its
 * effect is observable waits exactly as long as the app takes and no longer, and
 * it costs one extra click in the case where hydration has already happened.
 *
 * **It cannot paper over a real defect**, which is the property that matters: if
 * the control genuinely does nothing, `effect` never passes and the test fails
 * with the same message it would have had — just sooner, and without the
 * ambiguity about whether the press landed.
 *
 * @param control the thing to press
 * @param effect  asserts what pressing it must produce; keep its own timeout short
 */
export async function pressUntil(
  control: Locator,
  effect: () => Promise<void>,
  timeout = 20_000,
): Promise<void> {
  await expect(control).toBeVisible();
  await expect(async () => {
    await control.click();
    await effect();
  }).toPass({ timeout });
}
