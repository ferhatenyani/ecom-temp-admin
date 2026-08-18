"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionSheet } from "@/components/primitives/ActionSheet";
import { Sheet } from "@/components/primitives/Sheet";
import { Button } from "@/components/primitives/Button";
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
 * rather than one more row in the same action sheet.
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
  const router = useRouter();
  const toast = useToast();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove(force: boolean) {
    setBusy(true);
    const response = await fetch(
      `/api/ac/products/${productId}${force ? "?force=true" : ""}`,
      { method: "DELETE", headers: { Accept: "application/json" } },
    );
    setBusy(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      toast.show(body?.error?.message ?? t("failed"), "danger");
      return;
    }

    toast.show(force ? t("deletedPermanently") : t("trashed"));
    setForceOpen(false);
    // Back to the catalogue: a trashed product is not in the list, and a
    // permanently deleted one would 404 on the next render of this route.
    router.push(`/${locale}/products`);
    router.refresh();
  }

  /**
   * The typed confirmation for the permanent path.
   *
   * Not theatre: this is the one action in the products screen with no undo and
   * no audit row to restore from, and the product's own name is what the person
   * has to have read in order to type it. A second "are you sure" button is
   * something a thumb clears without reading.
   */
  const matches = confirmation.trim() === name.trim();

  return (
    <>
      <div className="mb-8">
        <Button variant="destructive" fullWidth onClick={() => setSheetOpen(true)}>
          {t("action")}
        </Button>
      </div>

      <ActionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={t("title", { name })}
        description={t("description")}
        actions={[
          {
            label: t("trash"),
            tone: "destructive",
            onSelect: () => void remove(false),
            reason: t("trashReason"),
          },
          {
            label: t("permanent"),
            tone: "destructive",
            onSelect: () => {
              setConfirmation("");
              setForceOpen(true);
            },
            reason: t("permanentReason"),
          },
        ]}
      />

      <Sheet
        open={forceOpen}
        onOpenChange={setForceOpen}
        title={t("permanentTitle")}
        description={t("permanentBody", { name })}
        footer={
          <div className="flex items-center gap-3">
            <Button variant="plain" onClick={() => setForceOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              fullWidth
              className="flex-1"
              disabled={!matches}
              loading={busy}
              onClick={() => void remove(true)}
            >
              {t("permanentConfirm")}
            </Button>
          </div>
        }
      >
        <label className="flex flex-col gap-2">
          <span className="text-footnote text-label-secondary">
            {t("typeName", { name })}
          </span>
          <input
            type="text"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            className="min-h-11 w-full rounded-md bg-surface-2 px-3 text-body text-label outline-none"
          />
        </label>
      </Sheet>
    </>
  );
}
