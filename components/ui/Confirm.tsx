"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "./Overlay";
import { Button } from "./Button";

/**
 * The confirmation dialog. See DESIGN.md §3.1.
 *
 * The only way a destructive action is confirmed in this panel, and it is a
 * component rather than a convention because a convention is what produces one
 * screen with a proper confirm and eleven with `window.confirm`.
 *
 * Three rules it enforces that a hand-rolled dialog forgets:
 *
 *   1. `confirmLabel` names the act. "Delete product", never "OK" — a person
 *      reading only the button must still know what is about to happen.
 *   2. Cancel takes initial focus, so Enter on a dialog nobody read is safe.
 *   3. An irreversible act can require the record's identifier to be typed.
 *      `requireTyped` is the whole guard: the confirm button stays disabled
 *      until the text matches exactly.
 */

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  tone = "destructive",
  loading = false,
  requireTyped,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  /** Names the act. Never "OK", never "Yes". */
  confirmLabel: string;
  onConfirm: () => void;
  tone?: "destructive" | "primary";
  loading?: boolean;
  /**
   * For irreversible acts: the exact string the person must type — an order
   * number, a SKU, a product name.
   */
  requireTyped?: { value: string; label: string };
  /**
   * The id of the control focus returns to on close.
   *
   * Needed here more than anywhere else: this dialog is nearly always opened
   * from a `Menu` item, which Radix unmounts on select — so the opener the
   * overlay recorded is detached by the time it would be focused. See
   * `useOpenerFocus` in Overlay.tsx.
   */
  returnFocusTo?: string;
}) {
  const t = useTranslations("ui");
  const [typed, setTyped] = useState("");
  const inputId = useId();
  /* Named, so `Modal` can focus it past Radix's own choice. See below. */
  const cancelId = useId();

  /*
   * Reset between openings, or the second confirm arrives pre-authorised with
   * the text typed for the first one — which would defeat the entire guard.
   *
   * Adjusted during render against the previous `open`, not in an effect: an
   * effect runs after paint, so a re-opened dialog would show one frame with
   * the old text still in the box and the destructive button already enabled.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setTyped("");
  }

  const armed = requireTyped ? typed.trim() === requireTyped.value : true;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      returnFocusTo={returnFocusTo}
      initialFocus={cancelId}
      footer={
        <>
          {/*
            Cancel first in DOM order: the first tab stop, and `initialFocus`
            makes it the *initial* focus so Enter on a dialog nobody read cannot
            destroy anything.

            **This used to be `autoFocus`, and `autoFocus` never worked here.**
            Radix's `FocusScope` moves focus after mount, to the first tabbable
            node in the content — `OverlayFrame`'s × button, which the header
            renders before this footer. So rule 2 above was documented, asserted
            in this docblock, and false on every destructive dialog in the panel:
            each opened with the focus ring on the one control that is not the
            safe default. Carried in DECISIONS.md for three branches and visible
            on the shipping rule-delete capture. `Modal.initialFocus` is the
            second focus prop the ledger said it needed.
          */}
          <Button
            id={cancelId}
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {t("cancel")}
          </Button>
          <Button
            variant={tone === "destructive" ? "destructive" : "primary"}
            onClick={onConfirm}
            loading={loading}
            disabled={!armed}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="text-ui-body text-ui-muted">{body}</div>

        {requireTyped ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-ui-label text-ui-fg">
              {requireTyped.label}
            </label>
            <input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              /* An identifier, so it is isolated and tabular for the same reason
                 every other identifier in the panel is. */
              dir="ltr"
              data-numeric=""
              className="ui-ring ui-interactive min-h-9 rounded-ui-md border border-ui-line-control bg-ui-surface px-2.5 text-ui-body text-ui-fg outline-none placeholder:text-ui-subtle"
              placeholder={requireTyped.value}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * The hook form of the same thing, for the common case: one confirm dialog per
 * screen, opened for whichever row was clicked.
 *
 * Keeps the target record in state alongside the open flag so the dialog can
 * name it, and clears it on close so a re-open never shows the previous row's
 * identifier for a frame.
 */
export function useConfirm<T>() {
  const [target, setTarget] = useState<T | null>(null);
  return {
    target,
    open: target !== null,
    ask: (value: T) => setTarget(value),
    close: () => setTarget(null),
    onOpenChange: (next: boolean) => {
      if (!next) setTarget(null);
    },
  };
}
