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
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
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

/** `ErrorSummary` and `SaveBar` own their chrome's strings, so they need a provider. */
function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="fr" messages={fr}>
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

  it("holds for a select", () => {
    render(
      <Select
        label={LABEL}
        value="a"
        onChange={() => {}}
        options={[{ value: "a", label: "A" }]}
        hint={HINT}
      />,
    );
    expect(screen.getByRole("combobox", { name: LABEL })).toHaveAccessibleDescription(HINT);
  });

  it("keeps a date field reachable by its label, and its segments LTR", () => {
    /*
     * A date input is the one shape whose only handle is its label — it has no
     * useful implicit role, so `RangeControl`'s analytics tests find "Du" and
     * "Au" with `getByLabel`. `dir="ltr"` is asserted because a date's segments
     * are ordered by the platform's locale and must not be re-ordered by an
     * Arabic paragraph around them.
     */
    render(<DateField label="Du" value="2026-01-01" onChange={() => {}} hint={HINT} />);

    const input = screen.getByLabelText("Du");
    expect(input).toHaveValue("2026-01-01");
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
      <Select label="Statut" value="publish" onChange={() => {}} options={OPTIONS} />,
    );

    expect(screen.getByRole("combobox", { name: "Statut" })).toBeInTheDocument();

    rerender(
      <Select
        label="Statut"
        value="draft"
        onChange={() => {}}
        options={OPTIONS}
        hint="Un brouillon n’est pas visible sur la boutique."
      />,
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
    );

    const controls = html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? [];
    // Seven controls above. A regex that matched nothing must not report success.
    expect(controls).toHaveLength(7);
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

  it("latches a select on change, because a select has nothing half-typed", () => {
    const REQUIRED = "Choisissez un statut.";

    function StatusSelect() {
      const [value, setValue] = useState("");
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

    render(<StatusSelect />);
    const select = screen.getByRole("combobox", { name: "Statut" });

    // Untouched and empty: silent.
    expect(screen.queryByText(REQUIRED)).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "publish" } });
    expect(screen.queryByText(REQUIRED)).not.toBeInTheDocument();

    // Back to nothing. No blur — a selection is a complete act, so the refusal
    // lands where the person made it.
    fireEvent.change(select, { target: { value: "" } });
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
