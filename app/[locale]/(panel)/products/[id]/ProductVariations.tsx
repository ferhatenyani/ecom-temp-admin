"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import type {
  AttributeTerm,
  GlobalAttribute,
  Product,
  Variation,
} from "@/lib/api/schemas/product";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import {
  attachedFrom,
  combinationKey,
  isParentRefusal,
  localSkuClashes,
  planGeneration,
  rowDirty,
  variationCreateBody,
  variationDraftFrom,
  variationUpdateBody,
  COMBINATION_CAP,
  type Combination,
  type VariationDraft,
} from "./variable-product";
import { PRODUCT_STATUS_TONE, STOCK_STATUSES, STOCK_TONE, type ReadableStatus, type StockStatus } from "@/lib/product-status";
import { describeAttribute, priceSpan, variationLabel } from "@/lib/products";
import { formatMoney } from "@/lib/format/money";
import { useOnline } from "@/lib/use-online";
import { Card } from "@/components/ui/Card";
import { Badge, Dot } from "@/components/ui/Badge";
import { Notice, SectionError } from "@/components/ui/States";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { NumberField, Select, Switch, TextField } from "@/components/ui/Form";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/** The two statuses `VariationInput::STATUSES` accepts. A variation is not draftable. */
const VARIATION_STATUSES = ["publish", "private"] as const;

/**
 * The variations table — one row per combination, each with its own price, SKU
 * and stock, **and each its own request**.
 *
 * ## A row is the unit of everything
 *
 * The API is per-variation: `PATCH /products/{id}/variations/{variation_id}`
 * writes one row and `DELETE` removes one. There is no batched route —
 * `VariationController::registerRoutes()` registers exactly two paths and neither
 * takes a list — so the table cannot be a form with one save even if it wanted to
 * be. Rather than pretend otherwise with a save-all button that fires N requests
 * behind one spinner, the row is made the unit of *dirt*, of *saving* and of
 * *failure*, and all three being the same unit is what makes the answer to "what
 * happens to the other rows when one fails" simply **nothing**.
 *
 * - **Dirty** is `variationUpdateBody()` returning non-null: the row's draft
 *   differs from the row the API last returned, on the six fields the table
 *   draws. Not "has been focused", not "the table has been touched".
 * - **Failure** binds to the row it came from. A 400 lists every bad field at
 *   once and each lands on that row's own control; a 409 lands on that row's SKU.
 *   No other row's state is read or written.
 * - **Success** replaces that row from the response, so the next dirty check
 *   compares against what is actually stored. `router.refresh()` is *not* called
 *   per row — it would re-render the server tree under a table with other rows
 *   half-edited, and the parent's price span is refreshed once when the person
 *   leaves the card rather than on every keystroke's save.
 *
 * ## Duplicate SKUs, from both directions
 *
 * `VariationService::guardSku()` asks `ProductRepository::skuExists()`, which is
 * `wc_get_product_id_by_sku()` — WooCommerce's index covers variations as well as
 * products — and answers **409** *"That SKU is already in use."* with the SKU
 * under `details.sku`, not under `details.fields`. So a clash with anything in the
 * shop is the server's answer and is bound to the row's SKU field.
 *
 * A clash **between two rows of this table** is knowable before anybody asks, and
 * `localSkuClashes()` catches it. That is worth the code because the 409 cannot:
 * the API names the SKU and the row it refused, and has no idea the collision is
 * with an unsaved sibling three lines up — so the person fixes the wrong row.
 * Marking both is the only version of this that points somewhere useful.
 *
 * ## Delete is permanent, and that is the route's own default
 *
 * `VariationController::registerRoutes()` declares `'force' => ['type' =>
 * 'boolean', 'default' => true]` on the `DELETE`. A variation is *not* trashed by
 * default the way a product is — it is unlinked from the shop for good. The panel
 * sends `?force=true` explicitly rather than inheriting that, so the intent is on
 * the wire and not in a default somebody could change, and the confirmation says
 * "définitivement" because it is true.
 */
export function ProductVariations({
  product,
  variations: initial,
  terms,
  attributes,
  locale,
}: {
  product: Product;
  /** `null` means `GET /products/{id}/variations` failed for this render. */
  variations: Variation[] | null;
  terms: Record<string, AttributeTerm[]>;
  /** The shop's definitions, so an axis reads "Couleur" and not `pa_couleur`. */
  attributes: GlobalAttribute[];
  locale: string;
}) {
  const t = useTranslations("products.variants");
  const tDetail = useTranslations("products.detail");
  const tStatus = useTranslations("productStatus");
  const tStock = useTranslations("stockStatus");
  const tStates = useTranslations("states");
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const generateId = useId();
  /* One prefix, one id per row. `ConfirmDialog` is opened from the row's icon
     button and `useOpenerFocus` cannot find an opener that was never rendered —
     a single shared id would send focus to `<body>` on Escape, which is the
     defect `DeleteAction` records for the header menu. */
  const deleteId = useId();
  const deleteRowId = (id: number) => `${deleteId}-${id}`;

  const [rows, setRows] = useState<Variation[]>(initial ?? []);
  const [drafts, setDrafts] = useState<Record<number, VariationDraft>>(() =>
    Object.fromEntries((initial ?? []).map((row) => [row.id, variationDraftFrom(row)])),
  );
  /** Keyed by variation id, then by the API's own field name. */
  const [errors, setErrors] = useState<Record<number, Record<string, string>>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Variation | null>(null);
  const [adding, setAdding] = useState("");

  /** What the last generate run actually did. Cleared when another one starts. */
  const [outcome, setOutcome] = useState<{
    created: number;
    failed: { label: string; message: string }[];
    abandoned: string | null;
  } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const termMap = new Map(Object.entries(terms));
  const draft = attachedFrom(product);
  const plan = planGeneration(draft, rows);
  const clashes = localSkuClashes(new Map(Object.entries(drafts).map(([id, d]) => [Number(id), d])));

  const currency = "DZD";
  const asMoney = (value: string) => formatMoney(value, currency, locale);
  const span = priceSpan(rows.map((row) => row.price));

  /** How a combination reads to a person — the parent's own spelling of it. */
  const labelOf = (combination: Combination): string =>
    variationLabel({ attributes: combination }, product, termMap).join(" · ") ||
    tDetail("variationNoAttributes");

  const setField = <K extends keyof VariationDraft>(id: number, key: K, value: VariationDraft[K]) => {
    setDrafts((held) => ({ ...held, [id]: { ...held[id], [key]: value } }));
    // This row's error for this field, and only that: a 400 lists every bad
    // field at once and the others are still wrong.
    setErrors((held) => {
      const row = held[id];
      if (row === undefined || !(key in row)) return held;
      const next = { ...row };
      delete next[key as string];
      return { ...held, [id]: next };
    });
  };

  const bindError = (id: number, failure: unknown) => {
    if (failure instanceof BrowserApiError) {
      if (failure.fields && Object.keys(failure.fields).length > 0) {
        setErrors((held) => ({ ...held, [id]: failure.fields as Record<string, string> }));
        return;
      }
      /* A duplicate SKU is a 409 naming the SKU under `details.sku`, not under
         `details.fields` — the same shape `ProductDetail` maps for a product, and
         mapped onto the same field for the same reason: it is the field the
         person has to change. */
      if (failure.status === 409 && typeof failure.details.sku === "string") {
        setErrors((held) => ({ ...held, [id]: { sku: failure.message } }));
        return;
      }
      setErrors((held) => ({ ...held, [id]: { row: failure.message } }));
      return;
    }
    setErrors((held) => ({ ...held, [id]: { row: t("saveFailed") } }));
  };

  const saveRow = async (row: Variation) => {
    const body = variationUpdateBody(row, drafts[row.id]);
    if (body === null) return;

    setSaving(row.id);
    setErrors((held) => ({ ...held, [row.id]: {} }));

    try {
      const next = await acWrite<Variation>(
        "PATCH",
        `/products/${product.id}/variations/${row.id}`,
        body,
      );
      setRows((held) => held.map((held_) => (held_.id === row.id ? next : held_)));
      setDrafts((held) => ({ ...held, [row.id]: variationDraftFrom(next) }));
      toast.show(t("rowSaved", { name: labelOf(next.attributes) }));
    } catch (failure) {
      bindError(row.id, failure);
    } finally {
      setSaving(null);
    }
  };

  const remove = useMutation({
    mutationFn: (row: Variation) =>
      acWrite<{ id: number; deleted: boolean }>(
        "DELETE",
        /* Explicit, though the route's own default is already `true`. A permanent
           delete that reads as permanent at the call site is the difference
           between the panel meaning it and the panel inheriting it. */
        `/products/${product.id}/variations/${row.id}?force=true`,
      ),
    onSuccess: (_result, row) => {
      setDeleting(null);
      setRows((held) => held.filter((held_) => held_.id !== row.id));
      toast.show(t("rowDeleted"));
      router.refresh();
    },
    onError: (failure: unknown) => {
      setDeleting(null);
      toast.show(failure instanceof Error ? failure.message : t("saveFailed"), "danger");
    },
  });

  /**
   * One `POST` per combination, in a loop, **sequentially**.
   *
   * Not `Promise.all`, and that is not caution. `VariationRepository::create()`
   * ends with `sync($parent->get_id())` → `WC_Product_Variable::sync()`, which
   * recomputes the parent's price range and stock status from *all* its children
   * — so every request in a parallel fan-out writes the same parent row, and the
   * last one to finish wins with whatever it read. Sequential is also what makes
   * the progress count honest and the abandon rule below possible.
   *
   * **Partial success is the normal outcome and is reported as one.** The API
   * takes the same position in the one place it does batch — `ProductService::bulk()`:
   * *"a failure is recorded against its item and the batch continues … partial
   * success is the expected outcome here, not an exceptional one"*. Each refusal
   * is recorded against its own combination with the API's own sentence, and the
   * combinations that worked are in the table when the run ends.
   *
   * **Except for the two refusals that would refuse everything.** A 409 with
   * neither `variation_id` nor `sku` in its details is parent-level — the product
   * is not `variable`, or it has no attribute marked as a variant — and firing
   * the rest of the run would be that many identical failures behind a progress
   * bar. `isParentRefusal()` is the test; the run stops and the reason is the one
   * thing reported.
   *
   * **A 429 is the third such refusal and is deliberately not treated as one
   * yet.** `COMBINATION_CAP` is 200 and `RateLimiter::DEFAULT_WRITES` is 120 per
   * fixed 60-second window per user *and* per IP, so a full run can cross the
   * API's write allowance where the old cap of 50 never could — and a 429 carries
   * neither `variation_id` nor `sku` but is not a 409, so it falls through to the
   * per-combination list and the loop keeps going. `variable-product.ts`'s
   * `COMBINATION_CAP` docblock carries the reading and the argument; the repair is
   * a change to when a run abandons and what it then tells the person, which is
   * not a side effect of raising a number.
   */
  const generate = useMutation({
    mutationFn: async () => {
      const made: Variation[] = [];
      const failed: { label: string; message: string }[] = [];
      let abandoned: string | null = null;

      setOutcome(null);
      setProgress({ done: 0, total: plan.missing.length });

      for (const [index, combination] of plan.missing.entries()) {
        try {
          const row = await acWrite<Variation>(
            "POST",
            `/products/${product.id}/variations`,
            variationCreateBody(combination),
          );
          made.push(row);
          // Appended as it lands, so a run that is abandoned half way still
          // leaves the table showing what it actually made.
          setRows((held) => [...held, row]);
          setDrafts((held) => ({ ...held, [row.id]: variationDraftFrom(row) }));
        } catch (failure) {
          if (
            failure instanceof BrowserApiError &&
            isParentRefusal(failure.status, failure.details)
          ) {
            abandoned = failure.message;
            break;
          }
          failed.push({
            label: labelOf(combination),
            message: failure instanceof Error ? failure.message : t("saveFailed"),
          });
        }
        setProgress({ done: index + 1, total: plan.missing.length });
      }

      return { created: made.length, failed, abandoned };
    },
    onSettled: () => setProgress(null),
    onSuccess: (result) => {
      setOutcome(result);
      if (result.created > 0) router.refresh();
    },
    onError: () => setOutcome({ created: 0, failed: [], abandoned: t("saveFailed") }),
  });

  const add = useMutation({
    mutationFn: async (key: string) => {
      const combination = plan.missing.find((row) => combinationKey(row) === key);
      if (combination === undefined) return null;
      return acWrite<Variation>(
        "POST",
        `/products/${product.id}/variations`,
        variationCreateBody(combination),
      );
    },
    onSuccess: (row) => {
      if (row === null) return;
      setRows((held) => [...held, row]);
      setDrafts((held) => ({ ...held, [row.id]: variationDraftFrom(row) }));
      setAdding("");
      toast.show(t("rowAdded", { name: labelOf(row.attributes) }));
      router.refresh();
    },
    onError: (failure: unknown) =>
      toast.show(failure instanceof Error ? failure.message : t("saveFailed"), "danger"),
  });

  const offline = online ? undefined : tStates("offlineWrites");

  /*
   * The sentence under the button, and it is the whole of "say so before firing".
   * The grid is knowable without asking anybody — it is the product of the axes,
   * and the panel is holding both — so the number goes on screen beside the
   * control rather than being discovered by pressing it.
   */
  const gridLine =
    plan.axes.length === 0
      ? t("noAxes")
      : t("grid", {
          shape: plan.axes
            .map((axis) =>
              t("axis", {
                name: describeAttribute(axis.attribute, attributes, termMap).label,
                count: axis.options.length,
              }),
            )
            .join(" × "),
          total: plan.total,
          missing: plan.missing.length,
        });

  /*
   * **`initial === null` blocks the fan-out**, and this is the one guard that is
   * not about the grid. A failed `GET /variations` leaves `rows` empty, so every
   * cell reads as missing — and generating from that would `POST` a combination
   * for every row the product already has, each one answering the 409
   * `guardDuplicateCombination()` raises. The refusal is honest rather than
   * silent: the panel does not know what is there, so it will not add to it.
   */
  /**
   * Why the button cannot fire, or `undefined`. §3.3: a disabled control that
   * does not say why is a dead end, so every branch here is a sentence.
   */
  const generateBlocked = ((): string | undefined => {
    if (offline !== undefined) return offline;
    if (initial === null) return tDetail("sectionFailed");
    if (plan.refusal === "no-axes") return t("noAxes");
    if (plan.refusal === "nothing-missing") return t("nothingMissing");
    if (plan.refusal === "over-cap") {
      return t("overCap", { missing: plan.missing.length, cap: COMBINATION_CAP });
    }
    return undefined;
  })();

  return (
    <>
      <Card
        title={tDetail("variations")}
        description={t("tableDescription")}
        /*
         * The price span moves here from the read-only card this replaces, and
         * it is read off `rows` rather than the fetched list so it follows a row
         * being saved. `priceSpan()` returns null when every price is equal —
         * `17 500 – 18 500` is worth the space and `17 500 – 17 500` is not — so
         * the wildcard warning takes the line when there is nothing to span.
         */
        footnote={
          plan.wildcards > 0
            ? t("wildcards", { count: plan.wildcards })
            : span
              ? tDetail("variationSpan", { min: asMoney(span.min), max: asMoney(span.max) })
              : undefined
        }
      >
        <div className="flex flex-col gap-4">
          {/* ------------------------------------------- generate --- */}
          <div className="flex flex-col gap-2 rounded-ui-lg border border-ui-line p-3">
            <p className="text-ui-label text-ui-muted">{gridLine}</p>
            {plan.total > COMBINATION_CAP ? (
              <p className="text-ui-label text-ui-subtle">{t("capWhy", { cap: COMBINATION_CAP })}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                id={generateId}
                variant="secondary"
                size="sm"
                icon="plus"
                loading={generate.isPending}
                disabled={generateBlocked !== undefined}
                title={generateBlocked}
                onClick={() => generate.mutate()}
              >
                {t("generate", { count: plan.missing.length })}
              </Button>
              {progress !== null ? (
                <span className="text-ui-label text-ui-muted">
                  <Isolate>{t("progress", { done: progress.done, total: progress.total })}</Isolate>
                </span>
              ) : null}
            </div>

            {/*
              What was actually made, never what was asked for. `created` is the
              count of 201s this run received — not `plan.missing.length` — so a
              run that stopped at the twentieth of two hundred says twenty.
            */}
            {outcome !== null ? (
              <Notice
                tone={outcome.abandoned !== null || outcome.failed.length > 0 ? "warning" : "success"}
                title={t("outcome", {
                  created: outcome.created,
                  failed: outcome.failed.length,
                })}
              >
                {outcome.abandoned !== null ? (
                  <p className="text-ui-label">{t("abandoned", { reason: outcome.abandoned })}</p>
                ) : null}
                {outcome.failed.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-ui-label">
                    {outcome.failed.map((row) => (
                      <li key={row.label} dir="auto">
                        {row.label} — {row.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Notice>
            ) : null}
          </div>

          {/* ---------------------------------------------- rows --- */}
          {initial === null ? (
            <SectionError>{tDetail("sectionFailed")}</SectionError>
          ) : rows.length === 0 ? (
            <p className="text-ui-body text-ui-muted">{t("noRows")}</p>
          ) : (
            rows.map((row) => {
              const held = drafts[row.id];
              if (held === undefined) return null;

              const rowErrors = errors[row.id] ?? {};
              const clash = clashes.has(row.id);
              const dirty = rowDirty(row, held);
              const blocked = offline ?? (clash ? t("skuClash") : undefined);

              return (
                <div
                  key={row.id}
                  className="flex flex-col gap-3 rounded-ui-lg border border-ui-line p-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span dir="auto" className="min-w-0 text-ui-subheading text-ui-fg">
                          {labelOf(row.attributes)}
                        </span>
                        {row.status !== "publish" ? (
                          <Badge tone={PRODUCT_STATUS_TONE[row.status as ReadableStatus] ?? "neutral"}>
                            {tStatus(row.status)}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-1.5 text-ui-label text-ui-muted">
                        <Dot tone={STOCK_TONE[row.stock_status as StockStatus] ?? "warning"} />
                        {/* The stored, effective figure — what the shop is
                            selling at right now, beside the draft that has not
                            been saved. */}
                        <Ltr>{asMoney(row.price)}</Ltr>
                      </span>
                    </div>
                    <IconButton
                      id={deleteRowId(row.id)}
                      label={t("deleteRow", { name: labelOf(row.attributes) })}
                      icon="trash"
                      size="sm"
                      variant="ghost"
                      disabled={offline !== undefined}
                      title={offline}
                      onClick={() => setDeleting(row)}
                    />
                  </div>

                  {rowErrors.row !== undefined ? (
                    <p role="alert" className="text-ui-label text-ui-danger">
                      {rowErrors.row}
                    </p>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField
                      label={tDetail("regularPrice")}
                      value={held.regular_price}
                      onChange={(v) => setField(row.id, "regular_price", v)}
                      error={rowErrors.regular_price}
                    />
                    <NumberField
                      label={tDetail("salePrice")}
                      value={held.sale_price}
                      onChange={(v) => setField(row.id, "sale_price", v)}
                      error={rowErrors.sale_price}
                    />
                    <TextField
                      label={tDetail("sku")}
                      value={held.sku}
                      onChange={(v) => setField(row.id, "sku", v)}
                      isolate
                      /* `""` is a real, ordinary value: a variation with no SKU
                         of its own inherits the parent's, and the first row of
                         every variable product in this shop is in that state. */
                      placeholder={tDetail("skuInherited")}
                      error={rowErrors.sku ?? (clash ? t("skuClash") : undefined)}
                    />
                    <Select
                      label={tDetail("status")}
                      value={held.status}
                      onChange={(v) => setField(row.id, "status", v)}
                      error={rowErrors.status}
                      options={VARIATION_STATUSES.map((value) => ({
                        value,
                        label: tStatus(value),
                      }))}
                    />
                  </div>

                  <Switch
                    label={tDetail("manageStock")}
                    checked={held.manage_stock}
                    onChange={(v) => setField(row.id, "manage_stock", v)}
                    error={rowErrors.manage_stock}
                  />

                  <div className="grid gap-3 sm:grid-cols-2">
                    {held.manage_stock ? (
                      <NumberField
                        label={tDetail("stockQuantity")}
                        value={held.stock_quantity}
                        onChange={(v) => setField(row.id, "stock_quantity", v)}
                        error={rowErrors.stock_quantity}
                      />
                    ) : null}
                    <Select
                      label={tDetail("stockStatus")}
                      value={held.stock_status}
                      onChange={(v) => setField(row.id, "stock_status", v)}
                      error={rowErrors.stock_status}
                      options={STOCK_STATUSES.map((value) => ({ value, label: tStock(value) }))}
                    />
                  </div>

                  {dirty ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        loading={saving === row.id}
                        disabled={blocked !== undefined}
                        title={blocked}
                        onClick={() => void saveRow(row)}
                      >
                        {t("saveRow")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDrafts((all) => ({ ...all, [row.id]: variationDraftFrom(row) }));
                          setErrors((all) => ({ ...all, [row.id]: {} }));
                        }}
                      >
                        {t("discard")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}

          {/* ------------------------------------------- add one --- */}
          {plan.missing.length > 0 && initial !== null ? (
            <div className="flex flex-col gap-2">
              <Select
                label={t("addRowLabel")}
                value={adding}
                onChange={setAdding}
                hint={t("addRowHint")}
                options={[
                  { value: "", label: t("addRowPlaceholder") },
                  /*
                   * Only the combinations that do not exist yet, so the picker
                   * cannot produce the 409 `guardDuplicateCombination()` raises.
                   *
                   * Capped at the same `COMBINATION_CAP`, because a select with
                   * 7,776 options is the explosion in a different control — and
                   * **the two caps stay one number on purpose**, now that the
                   * number is 200 rather than 50. They answer the same question
                   * from either end: this list is what a person falls back to when
                   * the grid is too big to generate, so a picker that stopped at
                   * 50 while the button fired at 200 would leave 150 combinations
                   * reachable by neither control. `Float` gives the list
                   * `max-h-100` and `overflow-y-auto`, so 200 rows scroll inside a
                   * bounded popover rather than growing it — the cost of the
                   * longer list is scrolling, which the control already did at 50.
                   */
                  ...plan.missing.slice(0, COMBINATION_CAP).map((combination) => ({
                    value: combinationKey(combination),
                    label: labelOf(combination),
                  })),
                ]}
              />
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="plus"
                  loading={add.isPending}
                  disabled={adding === "" || offline !== undefined}
                  title={offline ?? (adding === "" ? t("addRowPlaceholder") : undefined)}
                  onClick={() => add.mutate(adding)}
                >
                  {t("addRow")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={t("deleteTitle")}
        body={t("deleteBody", {
          name: deleting === null ? "" : labelOf(deleting.attributes),
        })}
        confirmLabel={t("deleteConfirm")}
        loading={remove.isPending}
        returnFocusTo={deleting === null ? undefined : deleteRowId(deleting.id)}
        onConfirm={() => {
          if (deleting !== null) remove.mutate(deleting);
        }}
      />
    </>
  );
}
