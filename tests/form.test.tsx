/**
 * `components/ui/Form.tsx` — the form layer the whole redesign run goes through.
 *
 * This was the counterpart to `tests/field.test.tsx`, which covered the iOS
 * `Field.tsx` it replaces. Teardown deleted both that file and its subject; the
 * two properties this file did not already hold — a number field's name, and a
 * name that stays put as its hint appears — were ported into §1 and §1b rather
 * than deleted with it.
 *
 * Five things are asserted here, and each of them is a defect that has actually
 * shipped in this panel or was one edit away from shipping:
 *
 *   1. the accessible name is the label and only the label — `Field.tsx` carried
 *      the hint *inside* the `<label>` for three branches
 *   2. every control is disabled until React has hydrated it — measured on
 *      WebKit on the product detail, and absent from the first draft of this file
 *   3. help and error are described together, in reading order
 *   4. validation speaks on blur and not before, then on every change
 *   5. the error summary moves focus, and its links reach their fields
 *
 * A component test rather than a unit one, because none of that is computable
 * from the source. The accessible name is what the accessibility *tree* says it
 * is; "disabled before hydration" is a property of a server render; focus is a
 * property of a document. Only a render can be asked.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import {
  CheckRow,
  ChoiceGroup,
  DateField,
  ErrorSummary,
  NumberField,
  ReadOnlyField,
  SaveBar,
  Select,
  Switch,
  TextArea,
  TextField,
} from "@/components/ui/Form";

const LABEL = "Segment d’URL";
const HINT = "Un seul segment, sans barre oblique.";
const SLASH = "Must not contain a slash.";
const API = "Must be a number.";

/**
 * `ErrorSummary` and `SaveBar` own their chrome's strings, so they need a
 * provider — and so, since the date-picker branch, does `DateField`: it reads
 * the locale to decide the field order and the calendar's month names, exactly
 * as `Select` reads it for its popper direction.
 *
 * The locale is a parameter because §6 of DESIGN.md is not satisfied by testing
 * one of two languages, and because Arabic is where this control has always
 * failed first.
 */
function withIntl(node: React.ReactNode, locale: "fr" | "ar" = "fr") {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : fr}>
      {node}
    </NextIntlClientProvider>
  );
}

/* ───────────────────────────────────────────────────── 1. accessible names ─── */

describe("the accessible name is the label, and only the label", () => {
  it("keeps the hint out of a text field's name, and still shows it", () => {
    render(<TextField label={LABEL} value="" onChange={() => {}} hint={HINT} />);

    // A string matcher matches the *whole* accessible name, so this fails if the
    // hint is ever concatenated onto it — including by somebody wrapping it in a
    // `<span>` inside the label, which would look like a fix and would not be one.
    expect(screen.getByRole("textbox", { name: LABEL })).toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("holds for a textarea", () => {
    render(<TextArea label={LABEL} value="" onChange={() => {}} hint={HINT} />);
    expect(screen.getByRole("textbox", { name: LABEL })).toHaveAccessibleDescription(HINT);
  });

  /**
   * `Select` is a `Listbox` now — a `<button role="combobox">` rather than a
   * `<select>` — and this assertion is the one that proves the swap kept the
   * frame's promise. A `<label htmlFor>` names a `<button>` because a button is
   * a *labelable* element in the HTML spec exactly as a select is, so
   * `FieldFrame` needed no change; if that had not held, the control's name
   * would have fallen through to its own content and become the selected
   * option's label, which changes every time somebody picks something.
   *
   * `withIntl`, because `Listbox` reads the locale for its popper direction —
   * see its docblock. `States.tsx` already sets that precedent in this layer.
   */
  it("holds for a select", () => {
    render(
      withIntl(
        <Select
          label={LABEL}
          value="a"
          onChange={() => {}}
          options={[{ value: "a", label: "A" }]}
          hint={HINT}
        />,
      ),
    );
    expect(screen.getByRole("combobox", { name: LABEL })).toHaveAccessibleDescription(HINT);
  });

  it("keeps a date field reachable by its label, and its value LTR", () => {
    /*
     * A date field's only handle is its label — `RangeControl`'s analytics tests
     * find "Du" and "Au" with `getByLabel`, and that had to keep working across
     * the swap from `<input type="date">` to the drawn control. `<label htmlFor>`
     * still names it because the thing it points at is still a real `<input>`;
     * only its `type` changed.
     *
     * `dir="ltr"` is asserted because `14/03/2026` is a run of digits and
     * separators, and an Arabic paragraph around it reorders the groups.
     *
     * **The value is the locale's field order now, not the wire format.** That
     * is the whole point of the branch and §2 below holds it in both languages.
     */
    render(withIntl(<DateField label="Du" value="2026-01-01" onChange={() => {}} hint={HINT} />));

    const input = screen.getByLabelText("Du");
    expect(input).toHaveValue("01/01/2026");
    expect(input).toHaveAccessibleDescription(HINT);
    expect(input).toHaveAttribute("dir", "ltr");
  });

  it("holds for a switch, and keeps its state out of the prose", () => {
    render(<Switch label="Indexable" checked onChange={() => {}} hint={HINT} />);

    const control = screen.getByRole("switch", { name: "Indexable" });
    expect(control).toHaveAccessibleDescription(HINT);
    expect(control).toBeChecked();
  });

  it("holds for a number field", () => {
    /*
     * `NumberField` delegates to `TextField` with `isolate` set, and that
     * delegation is the whole reason to assert it separately: it passes props
     * through by spread, so a prop dropped or renamed on the way would be
     * invisible to every assertion above and to the five screens that use it.
     */
    render(<NumberField label="Poids (kg)" value="" onChange={() => {}} hint={HINT} />);

    const input = screen.getByRole("textbox", { name: "Poids (kg)" });
    expect(input).toHaveAccessibleDescription(HINT);
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("puts a checkable row's count inside its name, zero included", () => {
    render(<CheckRow label="Cuir" checked={false} count={0} onChange={() => {}} />);
    // A regex, not a string: whether the two spans are joined by a space is the
    // engine's business — jsdom concatenates, browsers insert one. The assertion
    // is that the count is in the *name* at all rather than beside it, where a
    // screen reader would never reach it.
    expect(screen.getByRole("checkbox", { name: /^Cuir\s*0$/ })).toBeInTheDocument();
  });
});

/* ────────────────────────────────────── 1b. and the name does not drift ────── */

/*
 * The second half of the defect `Field.tsx` carried, and the one a static
 * reading would miss. Ported from `tests/field.test.tsx` when that file was
 * deleted: the assertions above all render a hint that was there from the
 * start, so every one of them would still pass if the hint were inside the
 * label and simply *never changed*.
 *
 * With the hint inside the `<label>`, a hint that appears **renames** the
 * control. The page form's status hint appears only for a draft, so selecting
 * "Brouillon" renamed the field beside it — a screen reader announces a name
 * change, so the field appeared to become a different field in response to
 * editing a different one.
 */
describe("the name does not change as the hint changes", () => {
  const OPTIONS = [
    { value: "publish", label: "Publié" },
    { value: "draft", label: "Brouillon" },
  ];

  it("survives a hint appearing", () => {
    const { rerender } = render(
      withIntl(<Select label="Statut" value="publish" onChange={() => {}} options={OPTIONS} />),
    );

    expect(screen.getByRole("combobox", { name: "Statut" })).toBeInTheDocument();

    rerender(
      withIntl(
        <Select
          label="Statut"
          value="draft"
          onChange={() => {}}
          options={OPTIONS}
          hint="Un brouillon n’est pas visible sur la boutique."
        />,
      ),
    );

    // Same name, new description — not a renamed control.
    const control = screen.getByRole("combobox", { name: "Statut" });
    expect(control).toHaveAccessibleDescription(
      "Un brouillon n’est pas visible sur la boutique.",
    );
  });

  it("survives an error appearing on top of a hint", () => {
    const { rerender } = render(
      <TextField label={LABEL} value="" onChange={() => {}} hint={HINT} />,
    );

    expect(screen.getByRole("textbox", { name: LABEL })).toBeInTheDocument();

    rerender(
      <TextField label={LABEL} value="a/b" onChange={() => {}} hint={HINT} error={SLASH} />,
    );

    const input = screen.getByRole("textbox", { name: LABEL });
    expect(input).toHaveAccessibleDescription(`${HINT} ${SLASH}`);
  });
});

/* ─────────────────────────────────────────────────── 2. the hydration guard ─── */

describe("nothing is typeable before React has hydrated it", () => {
  /**
   * The highest-risk regression in the migration, asserted against the thing
   * that actually shows it: a **server** render.
   *
   * `useHydrated()` is `useSyncExternalStore`, which is specified to return the
   * *server* snapshot during SSR and the client one from the first client render
   * onwards. So this is not a mock standing in for the defect — it is the same
   * markup the browser receives, and a keystroke landing on it before the bundle
   * arrives is refused by the DOM rather than silently swallowed by React.
   *
   * Every control, not the text field alone: the point of putting the guard in
   * the layer is that the ninth control cannot forget it.
   */
  it("ships every control disabled in the server's HTML", () => {
    const html = renderToStaticMarkup(
      withIntl(
        <>
          <TextField label="Nom" value="" onChange={() => {}} />
          <TextArea label="Description" value="" onChange={() => {}} />
          <DateField label="Du" value="" onChange={() => {}} />
          <Select
            label="Statut"
            value="a"
            onChange={() => {}}
            options={[{ value: "a", label: "A" }]}
          />
          <Switch label="Actif" checked={false} onChange={() => {}} />
          <CheckRow label="Cuir" checked={false} onChange={() => {}} />
          <ChoiceGroup
            label="Tri"
            value="date"
            onChange={() => {}}
            options={[{ value: "date", label: "Date" }]}
          />
        </>,
      ),
    );

    /*
     * `button` joined the alternation when `Select` stopped being a `<select>`,
     * and the count went from seven to eight — which is the interesting part.
     *
     * Seven controls are rendered above. The eighth is Radix's own hidden
     * `<select aria-hidden tabindex="-1">`, the "bubble" it emits beside every
     * listbox so that a native `<form>` submission and the browser's autofill
     * still see a form control. It is out of the accessibility tree and out of
     * the tab order, so it is not a second control a person can reach — but it
     * *is* a real DOM control that a stray keystroke could reach if it were
     * enabled, so it belongs inside this assertion rather than filtered out of
     * it. Radix disables it along with the trigger, and the loop below is what
     * says so.
     *
     * Had the regex been left matching `select` alone it would have found seven
     * again — six real controls plus that bubble — and passed while the trigger
     * went entirely unchecked. The count is here to close exactly that hole.
     *
     * **Nine on the date-picker branch, and the ninth is the same shape of
     * finding.** `DateField` used to be one `<input type="date">`; it is now a
     * text input *and* a button that opens the calendar, so it contributes two
     * controls where it contributed one. The button is the reason this number
     * had to move rather than the count being loosened: a drawn control that
     * shipped its trigger enabled before hydration would open a popover whose
     * `onPick` reached no React, which is the exact defect this whole section
     * exists for, one control further along.
     */
    const controls = html.match(/<(?:button|input|select|textarea)\b[^>]*>/g) ?? [];
    // Seven fields above — eight controls, since the date field is an input and
    // a button — plus Radix's hidden bubble. A regex that matched nothing must
    // not report success.
    expect(controls).toHaveLength(9);
    for (const control of controls) {
      expect(control).toContain("disabled");
    }
  });

  it("and says so, rather than only being it", () => {
    const html = renderToStaticMarkup(<TextField label="Nom" value="" onChange={() => {}} />);
    // `aria-busy` is the part a screen reader is told. Disabled alone announces
    // "unavailable" with no hint that it is about to stop being.
    expect(html).toContain('aria-busy="true"');
  });

  it("is enabled again the moment it hydrates — the positive control", () => {
    /*
     * Without this, a control that was disabled *forever* would pass the test
     * above, which would be a far worse bug than the one it is guarding against.
     */
    render(<TextField label="Nom" value="" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Nom" })).toBeEnabled();
  });

  it("still honours an explicit disabled after hydration", () => {
    render(<TextField label="Nom" value="" onChange={() => {}} disabled />);
    expect(screen.getByRole("textbox", { name: "Nom" })).toBeDisabled();
  });
});

/* ─────────────────────────────────────────── 3. help and error, described ─── */

describe("aria-describedby carries the help and the error together", () => {
  it("reads the hint before the error when both are present", () => {
    render(
      <TextField label={LABEL} value="" onChange={() => {}} hint={HINT} error={SLASH} />,
    );

    /*
     * Order matters and is asserted: what the field wants, then what went wrong
     * with what was typed. `aria-describedby` is announced in the order its ids
     * are listed, not in DOM order, so this is a decision rather than a
     * consequence — and the hint is the thing a person needs most at the moment
     * they got it wrong.
     */
    expect(screen.getByRole("textbox", { name: LABEL })).toHaveAccessibleDescription(
      `${HINT} ${SLASH}`,
    );
  });

  it("sets aria-invalid alongside it", () => {
    render(<TextField label={LABEL} value="" onChange={() => {}} error={SLASH} />);

    const input = screen.getByRole("textbox", { name: LABEL });
    expect(input).toHaveAccessibleDescription(SLASH);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("leaves aria-describedby off entirely when there is nothing to say", () => {
    render(<TextField label={LABEL} value="" onChange={() => {}} />);

    // An empty `aria-describedby` is a dangling reference, not an absent one.
    expect(screen.getByRole("textbox", { name: LABEL })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("describes a switch with its error as well as its hint", () => {
    render(
      <Switch
        label="Paiement à la livraison"
        checked={false}
        onChange={() => {}}
        hint={HINT}
        error={API}
      />,
    );

    const control = screen.getByRole("switch", { name: "Paiement à la livraison" });
    expect(control).toHaveAccessibleDescription(`${HINT} ${API}`);
    expect(control).toHaveAttribute("aria-invalid", "true");
  });
});

/* ──────────────────────────────────────────────── 4. blur, then every change ─ */

function SlugField({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <TextField
      label={LABEL}
      value={value}
      onChange={setValue}
      validate={(next) => (next.includes("/") ? SLASH : undefined)}
    />
  );
}

describe("validation speaks on blur, then on every change — never on the first keystroke", () => {
  it("stays silent while the value is still being typed", () => {
    render(<SlugField initial="" />);
    const input = screen.getByRole("textbox", { name: LABEL });

    fireEvent.change(input, { target: { value: "chaises/salon" } });

    // Half a slug is not a bad slug. It is a slug being typed.
    expect(screen.queryByText(SLASH)).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("speaks on blur", () => {
    render(<SlugField initial="" />);
    const input = screen.getByRole("textbox", { name: LABEL });

    fireEvent.change(input, { target: { value: "chaises/salon" } });
    fireEvent.blur(input);

    expect(screen.getByText(SLASH)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(SLASH);
  });

  it("then clears and re-raises on every change, without a second blur", () => {
    render(<SlugField initial="" />);
    const input = screen.getByRole("textbox", { name: LABEL });

    fireEvent.change(input, { target: { value: "chaises/salon" } });
    fireEvent.blur(input);
    expect(screen.getByText(SLASH)).toBeInTheDocument();

    // Fixed, while still standing in the field.
    fireEvent.change(input, { target: { value: "chaises-salon" } });
    expect(screen.queryByText(SLASH)).not.toBeInTheDocument();

    // Broken again. The field has errored once, so it is now live — this is the
    // half of §3.4 that a screen re-implementing the rule always drops.
    fireEvent.change(input, { target: { value: "chaises/" } });
    expect(screen.getByText(SLASH)).toBeInTheDocument();
  });

  it("does not latch on a blur that found nothing wrong", () => {
    render(<SlugField initial="chaises" />);
    const input = screen.getByRole("textbox", { name: LABEL });

    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "chaises/salon" } });

    // Leaving a valid field does not arm anything, so the next value is once
    // again allowed to be half-typed.
    expect(screen.queryByText(SLASH)).not.toBeInTheDocument();
  });

  it("shows the caller's own error at once — it did not come from typing", () => {
    render(<TextField label={LABEL} value="" onChange={() => {}} error={API} />);

    // A 400's `details.fields`, or a cross-field rule the screen owns. There is
    // no blur to wait for; the person already submitted.
    expect(screen.getByText(API)).toBeInTheDocument();
  });

  /**
   * Driven through the open list rather than with `fireEvent.change`, which is
   * what this asserted while `Select` was a `<select>`.
   *
   * That is not a workaround for the migration, it is the migration's point: a
   * `change` event on a replaced element was the only handle the control offered
   * and it bypassed everything a person actually does. Here the trigger is
   * opened, an option is chosen from the list, and the latch is asserted on the
   * far side of both — so the test now fails if the popover never opens, if the
   * options never render, or if picking one does not commit, none of which the
   * old form could tell apart.
   *
   * **The empty option is deliberately the one selected last.** Radix reserves
   * `""` for "nothing is selected"; `Listbox` maps it to a sentinel so that a
   * cleared filter stays a real, choosable value. Sixteen screens depend on
   * that, and this is where it is proven — if the mapping were dropped, picking
   * "—" would throw rather than refuse.
   */
  it("latches a select on change, because a select has nothing half-typed", () => {
    const REQUIRED = "Choisissez un statut.";

    function StatusSelect() {
      const [value, setValue] = useState("publish");
      return (
        <Select
          label="Statut"
          value={value}
          onChange={setValue}
          validate={(next) => (next === "" ? REQUIRED : undefined)}
          options={[
            { value: "", label: "—" },
            { value: "publish", label: "Publié" },
            { value: "draft", label: "Brouillon" },
          ]}
        />
      );
    }

    render(withIntl(<StatusSelect />));
    const trigger = screen.getByRole("combobox", { name: "Statut" });

    // Untouched and valid: silent.
    expect(screen.queryByText(REQUIRED)).not.toBeInTheDocument();

    // A keystroke rather than a press: `keydown` is the one opening gesture
    // jsdom can deliver truthfully, having neither layout nor pointer events.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Brouillon" }));
    expect(screen.queryByText(REQUIRED)).not.toBeInTheDocument();

    // Back to nothing. No blur — a selection is a complete act, so the refusal
    // lands where the person made it.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "—" }));
    expect(screen.getByText(REQUIRED)).toBeInTheDocument();
  });
});

/* ───────────────────────────────────────────────────── 5. the error summary ─── */

describe("the error summary", () => {
  const FAILURES = [
    { id: "name", label: "Nom", message: "Cannot be empty." },
    { id: "regular_price", label: "Prix habituel", message: API },
  ];

  it("renders nothing when the submission did not fail", () => {
    render(withIntl(<ErrorSummary failures={[]} />));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("takes focus the moment it appears", () => {
    /*
     * The whole point. A submit button at the foot of a nine-section form is
     * nowhere near the field that refused, and on a phone the failing field is
     * usually off screen — without the move the person is left standing on a
     * button that appeared to do nothing.
     */
    const { rerender } = render(withIntl(<ErrorSummary failures={[]} />));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(withIntl(<ErrorSummary failures={FAILURES} />));

    const summary = screen.getByRole("alert");
    expect(summary).toHaveFocus();
    // A focus target, not a tab stop — the next Tab lands inside the list.
    expect(summary).toHaveAttribute("tabindex", "-1");
  });

  it("counts the failures in the form's own language", () => {
    render(withIntl(<ErrorSummary failures={FAILURES} />));
    expect(screen.getByRole("alert")).toHaveTextContent(/2 champs empêchent/);
  });

  it("links each failure to its field, and the link moves focus there", () => {
    render(
      withIntl(
        <>
          <ErrorSummary failures={[{ id: "sku", label: "SKU", message: "Already in use." }]} />
          <TextField id="sku" label="SKU" value="" onChange={() => {}} isolate />
        </>,
      ),
    );

    const input = screen.getByRole("textbox", { name: "SKU" });
    // The `id` prop is what makes a field linkable at all — a generated one
    // cannot be referenced from outside the component that generated it.
    expect(input).toHaveAttribute("id", "sku");

    const link = screen.getByRole("link", { name: "SKU — Already in use." });
    expect(link).toHaveAttribute("href", "#sku");

    fireEvent.click(link);
    expect(input).toHaveFocus();
  });

  it("renders a failure with no field on screen as text rather than a dead link", () => {
    /*
     * A 400 lists every bad field, including ones this form does not render. An
     * orphan still has to be readable or the person sees a refusal with no cause
     * anywhere — but there is nowhere to send them, so it is not a link.
     */
    render(withIntl(<ErrorSummary failures={[{ message: "meta_data: Unknown key." }]} />));

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("meta_data: Unknown key.")).toBeInTheDocument();
  });
});

/* ──────────────────────────────────────────────────────── the save bar ─────── */

describe("the sticky save bar", () => {
  it("is not there while the form is clean", () => {
    render(withIntl(<SaveBar dirty={false} onSave={() => {}} />));
    expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument();
  });

  it("appears when the form is dirty, under the handle a screen binds to", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    render(withIntl(<SaveBar dirty onSave={onSave} onDiscard={onDiscard} />));

    expect(screen.getByTestId("save-bar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Annuler les modifications" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("holds its label while saving, and says why it is blocked when it is", () => {
    const { rerender } = render(withIntl(<SaveBar dirty saving onSave={() => {}} />));

    // §3.3: the spinner replaces the leading icon and the label stays. A button
    // that becomes "Enregistrement…" mid-click resizes under the pointer.
    const button = screen.getByRole("button", { name: "Enregistrer" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    rerender(
      withIntl(<SaveBar dirty onSave={() => {}} blockedReason="Le prix n’est pas un nombre." />),
    );
    const blocked = screen.getByRole("button", { name: "Enregistrer" });
    expect(blocked).toBeDisabled();
    // §3.3: a disabled control with no reason is a dead end.
    expect(blocked).toHaveAttribute("title", "Le prix n’est pas un nombre.");
  });
});

/* ───────────────────────────────────────────────────── the read-only field ─── */

describe("a field the API refuses to write", () => {
  it("is a value and a reason, deliberately not a disabled input", () => {
    render(
      <ReadOnlyField
        label="Identifiant"
        value="1023"
        reason="Attribué par la boutique."
      />,
    );

    // §3.3: a control that looks editable and is not is a bug report waiting to
    // be filed, and the reason is the part that stops it.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Identifiant")).toBeInTheDocument();
    expect(screen.getByText("1023")).toBeInTheDocument();
    expect(screen.getByText("Attribué par la boutique.")).toBeInTheDocument();
  });
});

/* ───────────────────────────────────────────────── 6. the drawn date field ─── */

/**
 * `DateField` on `components/ui/DatePicker.tsx`, which retired the panel's last
 * native `<input type="date">`.
 *
 * **Everything here runs in both languages**, and the Arabic half is not
 * symmetry for its own sake: the step this was built for says outright that
 * Arabic is where this control has always failed first, and the defect the
 * reversal exists to fix — `mm/dd/yyyy` under a right-to-left label — was only
 * ever visible there.
 *
 * The five properties are the five things the native control gave and a drawn
 * one usually loses:
 *
 *   1. the field reads in the **page's** order, not the browser's
 *   2. a date can be typed with the keyboard **without opening the calendar**
 *   3. the `Y-m-d` contract on the wire is unchanged in both directions
 *   4. a refusal still waits for the blur, and a grid pick does not
 *   5. the calendar is a real grid, with today, the selection and a live month
 */

/** The one thing a caller sees. Returns the last `Y-m-d` the field emitted. */
function dateField(props: Partial<Parameters<typeof DateField>[0]> = {}, locale: "fr" | "ar" = "fr") {
  const emitted: string[] = [];
  function Harness() {
    const [value, setValue] = useState(props.value ?? "");
    return (
      <DateField
        label="Du"
        {...props}
        value={value}
        onChange={(next) => {
          emitted.push(next);
          setValue(next);
        }}
      />
    );
  }
  render(withIntl(<Harness />, locale));
  return {
    input: screen.getByLabelText("Du"),
    emitted,
    last: () => emitted.at(-1),
  };
}

describe("the drawn date field reads in the page's language, not the browser's", () => {
  /**
   * The whole branch in one assertion. A native date input renders its segments
   * in the *browser's* locale and no attribute changes it, which is how the
   * Arabic panel came to print a US `mm/dd/yyyy`. Both of this panel's locales
   * are day-month-year — measured in `tests/calendar.test.ts` §1 — so both must
   * show the day first, and neither may show the wire format.
   */
  it("prints the day first in French and in Arabic", () => {
    for (const locale of ["fr", "ar"] as const) {
      const { input } = dateField({ value: "2026-03-14" }, locale);
      expect(input, locale).toHaveValue("14/03/2026");
      cleanup();
    }
  });

  /**
   * The proof that the `echo` readback could be deleted rather than merely
   * dropped. It existed because the field could not be made to show a legible
   * date; a field that shows one in both languages is a field printing the date
   * twice if the readback stays. Asserting the *absence* of a second copy is
   * what stops it being reintroduced by somebody being helpful.
   */
  it("prints the date once, with no second copy underneath", () => {
    dateField({ value: "2026-03-14" }, "ar");
    /* `queryAllByText`, which answers an empty list rather than throwing —
       "there is no second copy" is the assertion, so nothing found is a pass. */
    expect(screen.queryAllByText(/14/)).toHaveLength(0);
  });

  it("shows nothing at all for no date, which every filter offers", () => {
    const { input } = dateField({ value: "" });
    expect(input).toHaveValue("");
  });

  it("carries the locale's own field order into the placeholder", () => {
    const { input } = dateField({}, "fr");
    /* `jj` before `aaaa`, because the order is read from CLDR rather than
       written out — and the separators carry U+200E so the Arabic words below
       are not laid out right-to-left inside this `dir="ltr"` field. */
    expect(input.getAttribute("placeholder")).toBe("jj‎/mm‎/aaaa");
  });

  /**
   * **The U+200E LEFT-TO-RIGHT MARKs in this string are load-bearing and were
   * measured**, so this assertion is written against the exact bytes rather
   * than a regex that would let them be dropped.
   *
   * The three Arabic words are strong RTL runs; the two slashes between them are
   * neutral. Without the marks the neutrals take the surrounding RTL direction
   * and the whole hint is laid out right-to-left *inside* a `dir="ltr"` field —
   * so the reader is shown year, month, day, while the value that replaces it is
   * day, month, year. Measured in Chromium with the words swapped for countable
   * runs of `ا` (1 = day, 2 = month, 3 = year), in the field's own
   * `dir="ltr"; unicode-bidi: isolate` box:
   *
   *   with the marks     | / || / |||     ← same order as `14/033/2026`
   *   without them       ||| / || / |     ← year first, which is the defect
   *
   * So dropping them would put the exact ordering error this control exists to
   * fix back into the control, in the one language it matters in.
   */
  it("and into the Arabic one, in the same order rather than mirrored", () => {
    const { input } = dateField({}, "ar");
    expect(input.getAttribute("placeholder")).toBe("يوم‎/شهر‎/سنة");
  });
});

describe("a date can be typed without the calendar ever opening", () => {
  /**
   * The hardest requirement, and the one a drawn picker usually loses. The field
   * is an ordinary `<input type="text">`: no mask, no auto-advancing caret, no
   * intercepted keys. `queryByRole("grid")` is the half that makes this test
   * mean something — it says the calendar was never mounted.
   */
  it("emits Y-m-d from the locale's order, with no grid ever mounted", () => {
    for (const locale of ["fr", "ar"] as const) {
      const { input, last } = dateField({}, locale);
      fireEvent.change(input, { target: { value: "14/03/2026" } });
      expect(last(), locale).toBe("2026-03-14");
      expect(screen.queryByRole("grid"), locale).toBeNull();
      cleanup();
    }
  });

  it("takes the wire format typed literally, which is what a URL carries", () => {
    const { input, last } = dateField({}, "ar");
    fireEvent.change(input, { target: { value: "2026-03-14" } });
    expect(last()).toBe("2026-03-14");
  });

  /**
   * Reformatting while somebody is typing moves the caret out from under them,
   * so `1/3/2026` is tidied on the way out and not before. Blur is already the
   * moment the latch arms, so nothing new is being introduced.
   */
  it("tidies a short entry on blur and not on the keystroke", () => {
    const { input } = dateField();
    fireEvent.change(input, { target: { value: "1/3/2026" } });
    expect(input).toHaveValue("1/3/2026");
    fireEvent.blur(input);
    expect(input).toHaveValue("01/03/2026");
  });

  /**
   * The half-typed value. The native control reported the **empty** string for a
   * half-entered date rather than a partial one, and `DateField`'s blur latch
   * was written around exactly that; the drawn one keeps the behaviour, so a
   * caller never holds a date the field is not showing.
   */
  it("reports the empty value while the text is not yet a date", () => {
    const { input, emitted } = dateField({ value: "2026-03-14" });
    fireEvent.change(input, { target: { value: "14/0" } });
    expect(emitted.at(-1)).toBe("");
    /* And the text is *not* wiped by the empty value coming back round. */
    expect(input).toHaveValue("14/0");
  });

  /**
   * The other side of the bridge, and the half that is easy to lose while fixing
   * the one above: a `value` the *caller* changed — a reset, a preset range —
   * has to replace the text, including when the text is mid-edit garbage.
   */
  it("adopts a date set from outside, over whatever is in the field", () => {
    function Harness() {
      const [value, setValue] = useState("2026-03-14");
      return (
        <>
          <DateField label="Du" value={value} onChange={setValue} />
          <button type="button" onClick={() => setValue("2026-07-01")}>
            reset
          </button>
        </>
      );
    }
    render(withIntl(<Harness />));
    const input = screen.getByLabelText("Du");

    fireEvent.change(input, { target: { value: "zz" } });
    expect(input).toHaveValue("zz");
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(input).toHaveValue("01/07/2026");
  });

  it("refuses a date that is not a date, on blur and not before", () => {
    const { input } = dateField();
    fireEvent.change(input, { target: { value: "31/02/2026" } });
    expect(screen.queryByText(fr.ui.date.unreadable)).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText(fr.ui.date.unreadable)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("says so in Arabic in the Arabic panel", () => {
    const { input } = dateField({}, "ar");
    fireEvent.change(input, { target: { value: "hier" } });
    fireEvent.blur(input);
    expect(screen.getByText(ar.ui.date.unreadable)).toBeInTheDocument();
  });

  it("stops saying so the moment the value becomes readable", () => {
    const { input, last } = dateField();
    fireEvent.change(input, { target: { value: "zz" } });
    fireEvent.blur(input);
    expect(screen.getByText(fr.ui.date.unreadable)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "14/03/2026" } });
    expect(screen.queryByText(fr.ui.date.unreadable)).toBeNull();
    expect(last()).toBe("2026-03-14");
  });

  /**
   * The caller's own rule still receives a `Y-m-d`, never the typed text. A
   * screen's `validate` was written against the wire format and none of the six
   * callers was touched for this branch, so this is the assertion that says the
   * contract really was unchanged.
   */
  it("hands the caller's own rule a Y-m-d and not what was typed", () => {
    const seen: string[] = [];
    render(
      withIntl(
        <DateField
          label="Du"
          value="2026-03-14"
          onChange={() => {}}
          validate={(value) => {
            seen.push(value);
            return undefined;
          }}
        />,
      ),
    );
    expect(seen).not.toHaveLength(0);
    for (const value of seen) expect(value).toBe("2026-03-14");
  });
});

describe("the calendar is a real grid, and Arabic mirrors it", () => {
  const openCalendar = (locale: "fr" | "ar" = "fr", props = {}) => {
    const field = dateField({ value: "2026-03-14", ...props }, locale);
    fireEvent.click(screen.getByRole("button", { name: (locale === "ar" ? ar : fr).ui.date.open }));
    return field;
  };

  it("names the month in the reader's language, in a live region", () => {
    openCalendar("fr");
    const caption = screen.getByText("mars 2026");
    expect(caption).toHaveAttribute("aria-live", "polite");
    cleanup();

    openCalendar("ar");
    expect(screen.getByText("مارس 2026")).toBeInTheDocument();
  });

  /**
   * §5 asks for real table semantics, and APG's date picker is a `role="grid"`
   * over one. The seven column headings carry the **full** weekday name for a
   * screen reader while showing the narrow letter — French's narrow has two
   * `M`s, for *mardi* and *mercredi*, so the letter alone is not a name.
   */
  it("is a labelled grid with seven named columns", () => {
    openCalendar("fr");
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAccessibleName("mars 2026");

    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(7);
    /* Algeria's week starts on Saturday in both locales — CLDR, not a guess. */
    expect(headers[0]).toHaveTextContent("samedi");
  });

  it("labels the columns in Arabic in the Arabic panel", () => {
    openCalendar("ar");
    expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent("السبت");
  });

  it("marks the selected day, and only it", () => {
    openCalendar("fr");
    const selected = screen
      .getAllByRole("gridcell")
      .filter((cell) => cell.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].querySelector("button")).toHaveAttribute("data-day", "2026-03-14");
  });

  it("gives every day an accessible name in the reader's own language", () => {
    openCalendar("fr");
    expect(screen.getByRole("button", { name: "samedi 14 mars 2026" })).toBeInTheDocument();
    cleanup();
    openCalendar("ar");
    expect(screen.getByRole("button", { name: "السبت، 14 مارس 2026" })).toBeInTheDocument();
  });

  /**
   * **The DOM focus, not merely the tab stop — and this one caught a real
   * defect.** The first draft moved focus from a `useEffect` keyed on `open`
   * holding a `useRef` to the grid; Radix's `Presence` mounts `Popover.Content`
   * one commit *after* `open` becomes true, so the ref was still null, the cell
   * was never found, and focus stayed on the trigger. Nothing errored and every
   * `tabindex` assertion still passed — the calendar simply opened dead to the
   * keyboard, which is the whole thing this branch had to not lose.
   *
   * So: assert `document.activeElement`. A test that only reads `tabindex` is a
   * test that would have shipped it.
   */
  it("puts the DOM focus on the selected day when it opens", () => {
    openCalendar("fr");
    expect(document.activeElement).toHaveAttribute("data-day", "2026-03-14");
  });

  it("does the same in Arabic", () => {
    openCalendar("ar");
    expect(document.activeElement).toHaveAttribute("data-day", "2026-03-14");
  });

  it("lands on today when there is no date yet", () => {
    dateField({ value: "" });
    fireEvent.click(screen.getByRole("button", { name: fr.ui.date.open }));
    expect(document.activeElement).toHaveAttribute("aria-current", "date");
  });

  it("carries the DOM focus with the arrow keys, not just the tab stop", () => {
    openCalendar("fr");
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowDown" });
    expect(document.activeElement).toHaveAttribute("data-day", "2026-03-21");
  });

  /**
   * The month buttons are the deliberate exception: a person clicking "next
   * month" three times must keep their focus on the button they are clicking.
   * APG's date-picker dialog draws the same line.
   */
  it("leaves focus on the month button when the month button is used", () => {
    openCalendar("fr");
    const next = screen.getByRole("button", { name: fr.ui.date.nextMonth });
    fireEvent.click(next);
    expect(screen.getByText("avril 2026")).toBeInTheDocument();
    expect(document.activeElement).not.toHaveAttribute("data-day");
  });

  /** One tab stop in 42 cells, so Tab leaves the calendar rather than walking it. */
  it("keeps exactly one tab stop in the grid", () => {
    openCalendar("fr");
    const tabbable = screen
      .getAllByRole("gridcell")
      .map((cell) => cell.querySelector("button"))
      .filter((button) => button?.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("data-day", "2026-03-14");
  });

  it("picks a day, emits Y-m-d, and closes", () => {
    const { last } = openCalendar("fr");
    fireEvent.click(screen.getByRole("button", { name: "dimanche 22 mars 2026" }));
    expect(last()).toBe("2026-03-22");
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.getByLabelText("Du")).toHaveValue("22/03/2026");
  });

  /**
   * The RTL half, and it is the assertion the whole Arabic argument turns on.
   * APG maps the arrow keys **visually**: in a grid whose columns run
   * right-to-left, ArrowLeft is the *next* day and ArrowRight the previous one.
   * A component that read the keys logically would move a French reader's
   * selection the right way and an Arabic reader's the wrong way, and nothing
   * would error.
   */
  it("mirrors the arrow keys in Arabic and does not in French", () => {
    for (const [locale, forward] of [
      ["fr", "ArrowRight"],
      ["ar", "ArrowLeft"],
    ] as const) {
      openCalendar(locale);
      fireEvent.keyDown(screen.getByRole("grid"), { key: forward });
      expect(
        screen.getByRole("grid").querySelector('button[tabindex="0"]'),
        `${locale} ${forward}`,
      ).toHaveAttribute("data-day", "2026-03-15");
      cleanup();
    }
  });

  it("walks a week with the vertical arrows and a month with the page keys", () => {
    openCalendar("fr");
    const grid = screen.getByRole("grid");
    const focused = () => grid.querySelector('button[tabindex="0"]')?.getAttribute("data-day");

    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(focused()).toBe("2026-03-21");
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(focused()).toBe("2026-03-14");
    fireEvent.keyDown(grid, { key: "PageDown" });
    expect(focused()).toBe("2026-04-14");
    fireEvent.keyDown(grid, { key: "PageUp", shiftKey: true });
    expect(focused()).toBe("2025-04-14");
  });

  /**
   * Walking off the end of a month has to take the grid with it — the state
   * where March is drawn and 1 April is focused is the bug the single `cursor`
   * was chosen to make unrepresentable.
   */
  it("takes the drawn month with it when an arrow leaves one", () => {
    openCalendar("fr");
    const grid = screen.getByRole("grid");
    /* Eighteen weeks on from 14 March 2026 is 18 July, four months later. */
    for (let step = 0; step < 18; step += 1) fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(grid.querySelector('button[tabindex="0"]')).toHaveAttribute("data-day", "2026-07-18");
    expect(screen.getByText("juillet 2026")).toBeInTheDocument();
  });

  /** `min`/`max` refuse the grid. The keyboard is `Stepper`'s rule and is not refused. */
  it("draws an out-of-range day refused, and still lets one be typed", () => {
    const { input, last } = openCalendar("fr", { max: "2026-03-20" });
    expect(screen.getByRole("button", { name: "dimanche 22 mars 2026" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "dimanche 22 mars 2026" }));
    expect(last()).not.toBe("2026-03-22");

    fireEvent.change(input, { target: { value: "22/03/2026" } });
    expect(last()).toBe("2026-03-22");
  });

  it("marks today, wherever today is", () => {
    dateField({ value: "" });
    fireEvent.click(screen.getByRole("button", { name: fr.ui.date.open }));
    const current = screen
      .getAllByRole("gridcell")
      .map((cell) => cell.querySelector("button"))
      .filter((button) => button?.getAttribute("aria-current") === "date");
    expect(current).toHaveLength(1);
  });
});

/* ─────────────────────────────────────────────── the select's type parameter ─ */

/**
 * Not a runtime assertion — `npx tsc --noEmit` is the assertion, and this file is
 * inside its `include`.
 *
 * `Field.tsx`'s `SelectField<T extends string>` gives 17 screens compile-time
 * proof that the value is a member of the union its own options draw from.
 * `Form.tsx`'s first draft took `value: string`, which accepts `"drafft"` and
 * `"hoem"` and leaves the API to be the first thing that notices. These two
 * declarations fail the typecheck from opposite sides if the parameter is ever
 * dropped again.
 */
const STATUS = [
  { value: "publish", label: "Publié" },
  { value: "draft", label: "Brouillon" },
] as const;

const onStatus = (next: "publish" | "draft") => next;

/* Positive: a narrow `onChange` is only assignable if `T` narrows with it. With
   `onChange: (next: string) => void` this is a contravariance error. */
export const _selectNarrows = (
  <Select
    label="Statut"
    value={"publish" as "publish" | "draft"}
    options={STATUS}
    onChange={onStatus}
  />
);

/* Negative: with `T` pinned to the union by `onChange`, a value outside it is
   refused. If the generic goes, this stops erroring and `tsc` fails on the
   unused directive — which is the assertion. */
export const _selectRefusesAStranger = (
  // @ts-expect-error — "brouillon" is not a member of the option union.
  <Select label="Statut" value="brouillon" options={STATUS} onChange={onStatus} />
);
