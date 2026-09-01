import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Choosing a value from the panel's drawn single-select.
 *
 * ## Why `selectOption` stopped working, and why this is not a workaround
 *
 * `components/ui/Form.tsx`'s `Select` is a thin wrapper over
 * `components/ui/Listbox.tsx`, which is Radix Select — a `role="combobox"`
 * button whose options are portalled into the document as `role="option"` when
 * it opens. Playwright's `locator.selectOption` drives a **native `<select>`**
 * and nothing else, so it fails with *"Element is not a `<select>` element"* and
 * the call log prints the button it actually found.
 *
 * That is the control behaving as designed. `Listbox`'s own docblock argues the
 * case: a `<select>`'s open list is unstyleable on every engine, so the panel had
 * two visual systems and the operating system's appeared exactly when somebody
 * was choosing. The suite simply predates the change and was never re-run.
 *
 * ## Clicking, not keyboard
 *
 * Radix moves focus into the portalled list and closes on selection, and the
 * pointer path is the one every viewport in this suite shares. The keyboard path
 * is worth testing too, but as an assertion about the control in
 * `tests/form.test.tsx`, not as the way every other test happens to pick a
 * wilaya — a helper that exercised a second code path on the way to unrelated
 * assertions would report *its* breakage as theirs.
 *
 * @param trigger the combobox, usually `page.getByLabel("Wilaya", {exact: true})`
 * @param name    the option's visible label; a string matches exactly
 */
export async function choose(page: Page, trigger: Locator, name: string | RegExp): Promise<void> {
  await expect(trigger).toBeEnabled();
  await trigger.click();

  /*
   * Scoped to the open listbox rather than to the page. The trigger renders the
   * selected label too, so a page-wide `getByRole("option")` can match the row
   * behind the popover on a screen that already has a value chosen — and Radix
   * keeps the trigger's text in the accessibility tree while the list is open.
   */
  const option = page.getByRole("listbox").getByRole("option", {
    name,
    exact: typeof name === "string",
  });

  await expect(option).toBeVisible();
  await option.click();

  /* The list closes on selection; waiting for that is what makes a following
     assertion about the trigger's own label read the new value and not the old. */
  await expect(page.getByRole("listbox")).toHaveCount(0);
}
