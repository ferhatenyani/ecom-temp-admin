"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";

/**
 * The action sheet. Bottom-anchored on mobile, the destructive option in
 * `--color-danger`, and Cancel in its own group beneath — never a browser
 * `confirm()`, which cannot be styled, cannot be localised and cannot be tested.
 *
 * Destructive actions are never adjacent to their non-destructive neighbour: the
 * gap between the two groups is the whole point of the pattern.
 */

export type SheetAction = {
  label: string;
  onSelect: () => void;
  tone?: "default" | "destructive";
  disabled?: boolean;
  /** Rendered under the label when the action is disabled for a stated reason. */
  reason?: string;
};

export function ActionSheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
  cancelLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  actions: SheetAction[];
  cancelLabel?: string;
}) {
  const t = useTranslations("orders.changeStatus");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content className="action-sheet fixed z-50 flex flex-col gap-2">
          <div className="overflow-hidden rounded-lg bg-surface">
            <div className="list-row px-4 py-3 text-center">
              <Dialog.Title className="w-full text-footnote text-label-secondary">
                {title}
              </Dialog.Title>
            </div>
            {description ? (
              <div className="list-row px-4 py-3">
                <Dialog.Description className="w-full text-center text-footnote text-label-secondary">
                  {description}
                </Dialog.Description>
              </div>
            ) : null}
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={action.disabled}
                onClick={() => {
                  action.onSelect();
                  onOpenChange(false);
                }}
                className={[
                  "list-row press-row flex w-full flex-col items-center justify-center px-4 py-3",
                  "min-h-11 text-body disabled:opacity-40",
                  action.tone === "destructive" ? "tone-danger tonal-fg" : "text-accent",
                ].join(" ")}
              >
                <span>{action.label}</span>
                {action.reason ? (
                  <span className="mt-0.5 text-caption text-label-secondary">
                    {action.reason}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Cancel in its own group, separated by a real gap. */}
          <Dialog.Close className="press min-h-12 w-full rounded-lg bg-surface text-headline text-accent">
            {cancelLabel ?? t("cancel")}
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
