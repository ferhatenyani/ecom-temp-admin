"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import type { Product } from "@/lib/api/schemas/product";
import { acWrite } from "@/lib/api/browser";
import { isDuplicable } from "@/lib/product-status";
import { useOnline } from "@/lib/use-online";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/primitives/Toast";

/**
 * `POST /products/{id}/duplicate` — one call, landing on the copy's detail.
 *
 * ## What the 201 actually returns, checked before anything was built on it
 *
 * `ProductController::duplicate()` is
 * `Response::success(ProductPresenter::toArray($copy), 201)` — read from source.
 * So the body is **the whole product**, the same shape `GET /products/{id}`
 * answers, and not a `{id}` stub: the copy's id is in `data.id` and the
 * navigation needs no second request. `Response::successPayload()` omits `meta`
 * when none is passed and none is, so there is nothing in the envelope beside
 * `data` — a caller reading `meta` here would read `{}` forever.
 *
 * ## What was copied, and what the panel may honestly claim about it
 *
 * `ProductService::duplicate()` audits `variations_copied`, and **that number is
 * not in the response**. It is written to the audit trail — `product.duplicated`,
 * with `source_id`, `source_name` and `variations_copied` — and appears in no
 * controller, no presenter and no test. Reaching it would mean a second request
 * to `/audit-logs` to describe a write the panel just made.
 *
 * It does not need to. `ProductPresenter::toArray()` emits `variations` as an
 * array of the copy's own child ids, so **`data.variations.length` is the same
 * count from the response itself** — and it is the copy's children rather than
 * the source's, which is the honest number: `ProductRepository::duplicate()`
 * skips any child that is not a `WC_Product_Variation`, so a source with an odd
 * child produces a copy with fewer, and the count that matters is what exists
 * now.
 *
 * The toast reports that count and the two things the shopkeeper will otherwise
 * discover by being confused, both read from `ProductRepository::duplicate()`:
 *
 * - **`set_status('draft')`** — *"A copy starts as a draft: an accidental
 *   duplicate must never appear in the storefront before someone has looked at
 *   it."* So the copy is not on sale, and a person who duplicated a published
 *   product and went looking for it in the shop would not find it.
 * - **`set_sku('')`** — the copy has no SKU, deliberately: SKUs are unique and
 *   the next save would be refused if it carried the original's. The backend's
 *   own suite asserts exactly this (*"the copy did not inherit the SKU"*).
 *
 * The name is the source's plus the literal suffix `' (copy)'`, which is
 * WooCommerce's convention and is **not localised** — it is a stored value, so
 * the toast prints what is in the database rather than a translation of it.
 *
 * ## Why there is no confirmation
 *
 * Duplicating creates a draft. It is reversible by the delete that is already on
 * both screens, it takes nothing away, and §3.1 reserves the confirm dialog for
 * destructive acts — putting one here would train the dialog away from the
 * delete two menu items down.
 *
 * ## The one product this refuses to duplicate, and where the refusal is stated
 *
 * `isDuplicable()` in `lib/product-status.ts` carries the whole argument:
 * `ProductRepository::duplicate()` picks `WC_Product_Simple` for **every** type
 * that is not `variable`, so a product of any third type comes back as a simple
 * product carrying none of what made it that type — and the 201 reports it as a
 * success, because it is one, of the wrong thing.
 *
 * Both controls guard, and both say why in the same string,
 * `products.duplicate.typeRefused`. One key rather than two on `OrderItems`'
 * precedent — *"both read `orders.detail.editableNo`, so the tooltip and the
 * paragraph under it cannot drift into saying two different things about one
 * rule"* — and it names the stored type verbatim rather than translating it,
 * because `products.type.*` holds labels for exactly the two types this API
 * writes and a third one has no label to be wrong about.
 *
 * The mutation itself is **not** guarded. It takes an id and nothing else, and a
 * hook that refused an id would have to fetch the product to know the type; the
 * two callers hold the whole product already, so the refusal lives where the
 * evidence is.
 */
function useDuplicate(locale: string, onDone?: () => void) {
  const t = useTranslations("products.duplicate");
  const router = useRouter();
  const toast = useToast();

  return useMutation({
    mutationFn: (id: number) => acWrite<Product>("POST", `/products/${id}/duplicate`),
    onSuccess: (copy) => {
      onDone?.();

      if (!copy) {
        toast.show(t("failed"), "danger");
        return;
      }

      toast.show(t("done", { name: copy.name, count: copy.variations.length }));
      /*
       * The copy's detail, and `refresh()` after it. The push alone would land
       * on a route whose server render is already cached from before the copy
       * existed on some navigations, and the list this may have been fired from
       * is now one row short of the truth either way.
       */
      router.push(`/${locale}/products/${copy.id}`);
      router.refresh();
    },
    onError: (error: unknown) => {
      onDone?.();
      toast.show(error instanceof Error ? error.message : t("failed"), "danger");
    },
  });
}

/**
 * The detail screen's control — a button in the page header beside the delete
 * menu, rather than a fourth item inside it.
 *
 * §2.4 puts a detail screen's actions in the header because below `lg` the aside
 * drops beneath a body whose length is the record's. It is not in `DeleteAction`'s
 * `Menu` because that menu is destructive top to bottom — the primitive colours,
 * separates and sinks destructive items — and a create sitting above two deletes
 * in a red-tinted list is a create somebody will misread once.
 *
 * ## The refused type prints its reason, and `title` is not enough
 *
 * §3.3: a disabled control that does not say why is a dead end. Offline already
 * fails that test and gets away with it, because a person who is offline has a
 * browser telling them so and every other write on the screen is dead beside this
 * one. A refusal that is a fact about *this record* has no such second signal:
 * nothing else on the detail is disabled, so a greyed button with a `title` is a
 * control that appears broken to a pointer that never hovers and to every touch
 * device, where there is no hover at all.
 *
 * So the sentence is rendered, under the button, and the `title` carries the same
 * string for the pointer that does hover. `PageHeader` lays its actions out as
 * `flex-wrap` inside a block that is full width below `sm`, so the paragraph wraps
 * within the row rather than widening it; `max-w-64` is what keeps it from
 * squeezing the title at `sm` and above, where the title's own `min-w-0 truncate`
 * takes the rest.
 */
export function DuplicateAction({
  productId,
  type,
  locale,
}: {
  productId: number;
  /**
   * `product.type` as stored — `z.string()` on the schema, deliberately, because
   * `product_type` is a taxonomy and the API publishes whatever term is on the
   * post. This is the only input the refusal reads.
   */
  type: string;
  locale: string;
}) {
  const t = useTranslations("products.duplicate");
  const tStates = useTranslations("states");
  const online = useOnline();
  const duplicate = useDuplicate(locale);

  const refused = isDuplicable(type) ? undefined : t("typeRefused", { type });
  const blocked = refused ?? (online ? undefined : tStates("offlineWrites"));

  const button = (
    <Button
      variant="secondary"
      /* `plus`, because the act creates a product. There is no `copy` glyph in
         the set and `note` is already the list's "copy the SKU to the
         clipboard" — one icon meaning two different copies, three rows apart. */
      icon="plus"
      loading={duplicate.isPending}
      disabled={blocked !== undefined}
      title={blocked}
      onClick={() => duplicate.mutate(productId)}
    >
      {t("action")}
    </Button>
  );

  if (refused === undefined) return button;

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {button}
      <p className="max-w-64 text-ui-caption text-ui-subtle">{refused}</p>
    </div>
  );
}

/**
 * The list's version, as a hook rather than a component.
 *
 * `ProductsList` builds its row menu from a `MenuAction[]` — a plain array of
 * `{key, label, icon, onSelect}` — so a component cannot be rendered into it.
 * The alternative was a second copy of the mutation inside `ProductsList`, which
 * is how the two would drift on the day the response shape changes, so the
 * behaviour lives in one hook and each screen supplies its own control.
 *
 * **This is the create path for a shop selling one kind of thing.** A shop with
 * forty rugs makes the forty-first by copying the fortieth, and that is a row
 * action on the list, not a form.
 */
export function useDuplicateProduct(locale: string) {
  return useDuplicate(locale);
}
