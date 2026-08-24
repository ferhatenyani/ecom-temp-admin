"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { acWrite } from "@/lib/api/browser";
import { useOnline } from "@/lib/use-online";
import { IconButton } from "@/components/ui/Button";
import { Menu, type MenuAction } from "@/components/ui/Menu";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { useToast } from "@/components/primitives/Toast";

/**
 * `DELETE` trashes; `?force=true` is permanent — and they get **different
 * confirmations with different wording**, because they are different acts.
 *
 * Measured, and it is why the copy has to carry the difference rather than the
 * response:
 *
 * - `DELETE /products/{id}` → `200 {"id":…,"deleted":true}`. The product still
 *   reads back: a following GET answers **200 with `status: "trash"`**, not 404.
 *   Repeating it is harmless — a second DELETE on an already-trashed product
 *   answers 200 again and does *not* escalate to permanent.
 * - `DELETE /products/{id}?force=true` → `200 {"id":…,"deleted":true}`, the
 *   **identical body**, and the product is gone: a following GET answers 404.
 *
 * So nothing in the response distinguishes the reversible act from the
 * irreversible one. The panel knows only because it knows what it asked for,
 * which is exactly why the permanent path is behind a second, typed confirmation
 * rather than one more row in the same menu.
 *
 * ## What changed with the redesign, and what did not
 *
 * The two acts used to live in an `ActionSheet` — a bottom-anchored phone control
 * with no pointer equivalent, retired in full by DESIGN.md §0. They are now a
 * `Menu` in the page header, whose destructive items are coloured, separated and
 * pulled to the bottom by the primitive itself, and each one opens a
 * `ConfirmDialog`: §3.1 makes that the only way a destructive action is confirmed
 * in this panel.
 *
 * **The trash gets a confirm too**, which the `ActionSheet` did not give it. An
 * action sheet row *was* the confirmation — a deliberate second tap on a labelled
 * destructive item. A menu item is one click from a pointer that was already
 * moving, so removing the sheet without adding a dialog would have quietly made
 * the reversible act easier to trigger by accident than it used to be.
 *
 * The typed guard on the permanent path is unchanged and is not theatre: this is
 * the one action on this screen with no undo and no audit row to restore from,
 * and the product's own name is what the person has to have read in order to type
 * it. `ConfirmDialog`'s `requireTyped` is the primitive that holds it, so the
 * comparison, the reset between openings and the disabled button are no longer
 * this file's business.
 */
export function DeleteAction({
  productId,
  locale,
  name,
}: {
  productId: number;
  locale: string;
  name: string;
}) {
  const t = useTranslations("products.delete");
  const tStates = useTranslations("states");
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();

  /**
   * Where the keyboard goes when a confirm closes.
   *
   * The dialog is opened from a `Menu` item, which Radix unmounts the moment it
   * is selected — so the opener the overlay recorded is detached by the time it
   * would be focused, Radix's own fallback targets a trigger ref a controlled
   * dialog never sets, and focus lands on `<body>`. Measured on the orders detail
   * with the keyboard alone: Escape dropped a person to the top of the document.
   * `ConfirmDialog` takes `returnFocusTo` for exactly this shape.
   */
  const triggerId = useId();

  /** `null` is closed; the two acts are otherwise identical and share one dialog. */
  const [asking, setAsking] = useState<"trash" | "force" | null>(null);

  const remove = useMutation({
    mutationFn: (force: boolean) =>
      acWrite<{ id: number; deleted: boolean }>(
        "DELETE",
        `/products/${productId}${force ? "?force=true" : ""}`,
      ),
    onSuccess: (_result, force) => {
      setAsking(null);
      toast.show(force ? t("deletedPermanently") : t("trashed"));
      // Back to the catalogue: a trashed product is not in the list, and a
      // permanently deleted one would 404 on the next render of this route.
      router.push(`/${locale}/products`);
      router.refresh();
    },
    onError: (error: unknown) => {
      setAsking(null);
      toast.show(error instanceof Error ? error.message : t("failed"), "danger");
    },
  });

  const blocked = online ? undefined : tStates("offlineWrites");

  const actions: MenuAction[] = [
    {
      key: "trash",
      label: t("trash"),
      icon: "trash",
      destructive: true,
      disabled: blocked !== undefined,
      onSelect: () => setAsking("trash"),
    },
    {
      key: "force",
      label: t("permanent"),
      icon: "close",
      destructive: true,
      disabled: blocked !== undefined,
      onSelect: () => setAsking("force"),
    },
  ];

  const permanent = asking === "force";

  return (
    <>
      <Menu
        label={t("action")}
        align="end"
        actions={actions}
        trigger={
          <IconButton
            id={triggerId}
            label={t("action")}
            icon="more"
            variant="secondary"
          />
        }
      />

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(next) => {
          if (!next) setAsking(null);
        }}
        title={permanent ? t("permanentTitle") : t("trashTitle", { name })}
        /* `trashReason` was the row's own explanation in the retired
           `ActionSheet`. It is the same sentence a person needs at the same
           moment, so it moves into the dialog rather than being rewritten. */
        body={permanent ? t("permanentBody", { name }) : t("trashReason")}
        confirmLabel={permanent ? t("permanentConfirm") : t("trash")}
        loading={remove.isPending}
        /* Only the irreversible act asks for the name. Making the trash type it
           too would train the typing away, and the trash is recoverable. */
        requireTyped={
          permanent ? { value: name, label: t("typeName", { name }) } : undefined
        }
        returnFocusTo={triggerId}
        onConfirm={() => remove.mutate(permanent)}
      />
    </>
  );
}
