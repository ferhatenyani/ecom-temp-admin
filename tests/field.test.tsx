/**
 * `Field`'s `hint`, and why it needed its own commit.
 *
 * The hint used to sit **inside** the `<label>`, and everything inside a
 * `<label>` is part of the control's accessible name. That is a defect README
 * carried for three branches as "noted rather than changed", because every form
 * in the panel shares this file and the branch that found it was not the branch
 * to change it on.
 *
 * A component test rather than a unit one, because the thing that was wrong is
 * not computable from the source: the accessible name is what the *accessibility
 * tree* says it is, and only a render can be asked. `getByRole(…, { name })`
 * queries exactly that tree, so these assertions fail if the hint ever moves
 * back inside the label — including by somebody wrapping it in a `<span>`, which
 * would look like a fix and would not be one.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DateField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from "@/components/primitives/Field";

/*
 * `useHydrated()` returns false on the first client render by design — a
 * keystroke landing before React takes over never reaches state — and a disabled
 * control is still in the accessibility tree with its name intact, which is all
 * these assertions read. Stubbed to true anyway so the queries describe a
 * control a person could actually use.
 */
vi.mock("@/lib/use-hydrated", () => ({ useHydrated: () => true }));

const LABEL = "Segment d’URL";
const HINT = "Un seul segment, sans barre oblique.";
const ERROR = "Must not contain a slash.";

describe("the accessible name is the label, and only the label", () => {
  it("keeps the hint out of a text field's name", () => {
    render(<TextField label={LABEL} value="" onChange={() => {}} hint={HINT} />);

    // The exact name. `getByRole` with a string matches the *whole* accessible
    // name, so this fails if the hint is concatenated onto it.
    const input = screen.getByRole("textbox", { name: LABEL });
    expect(input).toBeInTheDocument();

    // And the hint is still on screen — this is not a fix that hides it.
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("describes the control with the hint instead", () => {
    render(<TextField label={LABEL} value="" onChange={() => {}} hint={HINT} />);

    expect(screen.getByRole("textbox", { name: LABEL })).toHaveAccessibleDescription(HINT);
  });

  it("reads the hint before the error when both are present", () => {
    render(
      <TextField label={LABEL} value="" onChange={() => {}} hint={HINT} error={ERROR} />,
    );

    /*
     * Order matters and is asserted: what the field wants, then what went wrong
     * with what was typed. `aria-describedby` is announced in the order its ids
     * are listed, not in DOM order, so this is a real decision rather than a
     * consequence.
     */
    expect(screen.getByRole("textbox", { name: LABEL })).toHaveAccessibleDescription(
      `${HINT} ${ERROR}`,
    );
  });

  it("still describes the control with the error alone", () => {
    render(<TextField label={LABEL} value="" onChange={() => {}} error={ERROR} />);

    const input = screen.getByRole("textbox", { name: LABEL });
    expect(input).toHaveAccessibleDescription(ERROR);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("leaves aria-describedby off entirely when there is nothing to say", () => {
    render(<TextField label={LABEL} value="" onChange={() => {}} />);

    // An empty `aria-describedby` is a dangling reference, not an absent one.
    expect(screen.getByRole("textbox", { name: LABEL })).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});

describe("every field shape, not just the text one", () => {
  it("holds for a textarea", () => {
    render(<TextAreaField label={LABEL} value="" onChange={() => {}} hint={HINT} />);
    expect(screen.getByRole("textbox", { name: LABEL })).toHaveAccessibleDescription(HINT);
  });

  it("holds for a select", () => {
    render(
      <SelectField
        label={LABEL}
        value="a"
        onChange={() => {}}
        options={[{ value: "a", label: "A" }]}
        hint={HINT}
      />,
    );
    expect(screen.getByRole("combobox", { name: LABEL })).toHaveAccessibleDescription(HINT);
  });

  it("keeps a date field reachable by its label", () => {
    /*
     * The regression this rules out, at the layer that can answer it cheaply.
     *
     * Moving the hint out of the `<label>` changed the DOM around every field,
     * and a date input is the one shape whose *only* handle is its label — it
     * has no useful implicit role, so `RangeControl`'s analytics tests find "Du"
     * and "Au" with `getByLabel`. If the `htmlFor`/`id` association had been
     * broken by the restructure, those would fail in a browser thirty seconds at
     * a time; here it is a millisecond.
     */
    render(
      <DateField label="Du" value="2026-01-01" onChange={() => {}} hint={HINT} />,
    );

    const input = screen.getByLabelText("Du");
    expect(input).toHaveValue("2026-01-01");
    expect(input).toHaveAccessibleDescription(HINT);
  });

  it("holds for a switch, and keeps its state out of the prose", () => {
    render(
      <SwitchField label="Indexable" checked onChange={() => {}} hint={HINT} />,
    );

    /*
     * The switch was the worst of them: with the hint inside the label it
     * announced as "Indexable <a full sentence>, interrupteur, activé" — the
     * state a person is actually listening for buried at the end.
     */
    const control = screen.getByRole("switch", { name: "Indexable" });
    expect(control).toHaveAccessibleDescription(HINT);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("describes a switch with its read-only reason as well as its hint", () => {
    const reason = "Modifiable uniquement par le client.";
    render(
      <SwitchField
        label="Consentement"
        checked={false}
        onChange={() => {}}
        hint={HINT}
        readOnlyReason={reason}
      />,
    );

    expect(screen.getByRole("switch", { name: "Consentement" })).toHaveAccessibleDescription(
      `${HINT} ${reason}`,
    );
  });
});

describe("the name does not change as the hint changes", () => {
  /*
   * The second half of the defect, and the one a static reading would miss.
   *
   * The page form's status hint appears only for a draft, so with the hint
   * inside the label, selecting "Brouillon" **renamed** the control beside it —
   * a screen reader announces a name change, so the field appeared to become a
   * different field in response to editing a different one.
   */
  it("survives a hint appearing", () => {
    const { rerender } = render(
      <SelectField
        label="Statut"
        value="publish"
        onChange={() => {}}
        options={[
          { value: "publish", label: "Publié" },
          { value: "draft", label: "Brouillon" },
        ]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Statut" })).toBeInTheDocument();

    rerender(
      <SelectField
        label="Statut"
        value="draft"
        onChange={() => {}}
        options={[
          { value: "publish", label: "Publié" },
          { value: "draft", label: "Brouillon" },
        ]}
        hint="Un brouillon n’est pas visible sur la boutique."
      />,
    );

    // Same name, new description.
    const control = screen.getByRole("combobox", { name: "Statut" });
    expect(control).toHaveAccessibleDescription(
      "Un brouillon n’est pas visible sur la boutique.",
    );
  });
});
