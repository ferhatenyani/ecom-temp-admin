import type { Product, ProductAttribute, Variation } from "@/lib/api/schemas/product";

/**
 * What a variable product is made of, and the rules the panel applies before it
 * writes any of it.
 *
 * Separated from the three components for `attributes/attribute-write.ts`'s
 * reason and in its shape: the interesting half of a write screen is not the
 * markup, it is **which keys reach the wire and what the panel refuses on its
 * own** — a pure function of a plain object, asserted directly in
 * `tests/variable-product.test.ts` rather than through a hundred `fireEvent`s.
 *
 * It is one module rather than three because the attribute list and the variation
 * rows are **one invariant**, not two subjects that happen to be on the same
 * page. Everything below exists to keep that invariant, and splitting it would
 * put the two halves of the argument in different files.
 *
 * ## How every claim here was established
 *
 * The plugin at `ecom-temp/wp-content/plugins/algerian-commerce-core` is the
 * authority and is cited by `file:symbol`. Nothing here was measured over live
 * HTTP — `BLOCKED.md` records the 401 and there is no credential — and where a
 * behaviour is WooCommerce's rather than the plugin's it is said so explicitly,
 * because **WooCommerce's own source is not in either repository**: `ecom-temp`
 * tracks exactly one plugin and WordPress lives in Docker outside the tree. A
 * claim about `WC_Product_Variable` below is therefore either quoted from a
 * docblock that says it was measured, or is not made.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ## The deferral this module reverses, and the property it keeps
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ProductDetail.tsx` has said since the products branch that editing a
 * product's `attributes` is deliberately **not** on the product form:
 *
 * > replacing a variable product's attribute list drops its *variation*
 * > attribute, and WooCommerce then clears every variation's attribute map —
 * > measured on products 12 and 21, whose three and two variations came back
 * > with `attributes: {}` and could no longer be told apart.
 *
 * **That warning is true, and it is true for a reason that has not changed.**
 * Read from source, in two hops:
 *
 * 1. `ProductRepository::update()` — *"if ($input->has('attributes'))
 *    $product->set_attributes($this->buildAttributes($input->attributes()))"*.
 *    `set_attributes()` is a **whole-list replace**. There is no merge, no
 *    patch-by-name, no way to send one attribute and leave the others alone. An
 *    attribute absent from the payload is an attribute deleted from the product.
 *
 * 2. `VariationService::variationAttributes()` — the parent's *allowed* keys are
 *    exactly the attributes where `get_variation()` is true, and
 *    `guardAttributes()` refuses any key outside that set with *"Not a variation
 *    attribute of this product."* So a variation's stored combination is only
 *    meaningful **while the parent still offers that attribute for variations**.
 *    Drop the attribute and every existing variation's key becomes a key the
 *    product does not have.
 *
 * The backend's own suite records the same thing from the other side.
 * `tests/Api/products.php`, under *"replacing a variable product's attributes"*,
 * PATCHes a variable product carrying variations on `size` with a *different*
 * single attribute and notes: *"`WC_Product_Variable::save()` sets a dropped
 * variation attribute's key to `null` … the variations are re-synced against
 * those keys"*. It asserts the write is not a 500 and that the body round-trips.
 * **It does not assert the variations survived**, and it deletes the product on
 * the next line.
 *
 * ### So what changed, and it is not the API
 *
 * The dangerous word in that warning is **partial**. A partial list is what
 * destroys the mapping; a *complete* list containing every attribute the product
 * already has destroys nothing, because `set_attributes()` then stores what was
 * already stored plus whatever the person deliberately changed.
 *
 * Three things in this module make a partial list unreachable rather than merely
 * unlikely, and they are the whole answer to the deferral:
 *
 * **(a) The draft is the complete list, always.** `attachedFrom()` copies *every*
 * entry of `product.attributes` — global and local, variation and spec, visible
 * and hidden — and `attributesBody()` emits every entry of the draft. There is no
 * code path in this file that produces a subset, and `tests/variable-product.test.ts`
 * asserts the key set of the body equals the key set of the product for every
 * operation the editor offers. **A local attribute has no control on screen and
 * is still carried**, which is the case that would otherwise have shipped: the
 * two variable products in this shop carried `id: 0` attributes ("Taille",
 * "Finition") and an editor that only knew about global ones would have deleted
 * them on its first save.
 *
 * **(b) The write is its own request, not part of the product form.**
 * `ProductDetail`'s `Draft` carries a hand-written list of writable keys and
 * sends all of them on every save. Putting `attributes` in that list would mean
 * the *whole attribute list is rewritten every time somebody fixes a typo in the
 * description* — and then any drift between what the page read and what is
 * stored (a term deleted from the attributes screen, a second tab, a colleague)
 * silently rewrites the mapping. So `ProductAttributes` PATCHes
 * `{attributes: […]}` **alone**, only when its own card is dirty, and
 * `attributesBody()` answers `null` when it is not. `attributes` stays absent
 * from `ProductDetail`'s subset, and its docblock now says why that is still
 * right rather than being deleted.
 *
 * **(c) The three destructive edits are counted and named before they fire.**
 * `mappingLosses()` below is the safety net for the case (a) cannot cover: a
 * person *deliberately* removing an attribute, or turning off "this splits the
 * product", or un-ticking a term some variation is using. Every one of those is
 * a real thing a shopkeeper may want, and every one silently invalidates rows.
 * The panel counts exactly which variations lose their identity, says so in a
 * confirmation naming the number, and does not fire until that is acknowledged.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

/* ────────────────────────────────────────────────── attributes on a product ── */

/**
 * One attribute as the product carries it — which is precisely the schema's
 * `ProductAttribute`, aliased rather than redefined **on purpose**.
 *
 * The draft being the same shape as the read *and* the same shape as the write
 * is what makes (a) above checkable at a glance: there is no translation step in
 * which a key could be dropped. `AttributeInput::listFromPayload()` accepts
 * exactly `id`, `name`, `options`, `visible`, `variation`, `position` and refuses
 * any other key by name (*"Unknown keys: …"*), so the read shape, the draft shape
 * and the accepted write shape are one shape.
 */
export type Attached = ProductAttribute;

/**
 * How a **variation** spells the attribute this row describes.
 *
 * `VariationService::variationAttributes()` keys the parent's allowed set by
 * `strtolower($attribute->get_name())`, and `VariationRepository::normalizeCombination()`
 * lowercases the variation's own keys and strips an `attribute_` prefix. So the
 * join between an attribute row and a variation row is the **lowercased name**
 * and nothing else — for a global attribute that is the taxonomy (`pa_matiere`),
 * for a local one the label (`taille`).
 *
 * Written once here because getting it wrong is invisible: a comparison that
 * kept the case would report every variation as orphaned on a shop whose
 * attribute is stored as `Taille`, and the screen would offer to destroy rows
 * that were never at risk.
 */
export const variationKey = (attribute: Pick<Attached, "name">): string =>
  attribute.name.toLowerCase();

/** True for a global attribute. `id: 0` is WooCommerce's own marker for a local one. */
export const isGlobal = (attribute: Pick<Attached, "id">): boolean => attribute.id !== 0;

/**
 * The complete attribute list as a draft, in the order the product stores it.
 *
 * A structural copy rather than the array itself, so the editor's `setState`
 * cannot mutate the fetched product under the read-only card beside it. Sorted by
 * `position`, which is the order `ProductPresenter::attributes()` publishes and
 * the order the storefront renders.
 */
export function attachedFrom(product: Pick<Product, "attributes">): Attached[] {
  return product.attributes
    .map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      options: [...attribute.options],
      visible: attribute.visible,
      variation: attribute.variation,
      position: attribute.position,
    }))
    .sort((a, b) => a.position - b.position);
}

/** Comparable form of one entry — the six keys the API reads, and nothing else. */
const canonical = (attribute: Attached): string =>
  JSON.stringify([
    attribute.id,
    attribute.name,
    attribute.options,
    attribute.visible,
    attribute.variation,
    attribute.position,
  ]);

/**
 * `PATCH /products/{id}` carrying **`attributes` and nothing else** — or `null`
 * when the list is untouched.
 *
 * The `null` is not tidiness. `ProductService::update()` throws
 * `ApiException::invalidRequest('No supported fields were provided.')` for an
 * empty patch, and `ProductDetail`'s own docblock records that this 400 arrives
 * **with no `details` at all** — so a save button that fired on an unchanged card
 * would produce an error bound to no control and visible nowhere.
 * `attribute-write.ts` reaches the same conclusion for the same 400 one screen
 * over, and the two agree deliberately.
 *
 * Every entry of `draft` is emitted. That is the invariant, stated as code: the
 * function takes the whole list and returns the whole list, and there is no
 * parameter by which a caller could ask for less. `position` rides as stored —
 * **not renumbered by index** — because renumbering a product whose stored
 * positions happen to be sparse would make an untouched card dirty and rewrite
 * the storefront's order for nobody.
 */
export function attributesBody(
  current: readonly Attached[],
  draft: readonly Attached[],
): { attributes: Attached[] } | null {
  const unchanged =
    current.length === draft.length &&
    current.every((attribute, index) => canonical(attribute) === canonical(draft[index]));

  return unchanged ? null : { attributes: draft.map((attribute) => ({ ...attribute })) };
}

/* ──────────────────────────────────────────────── attaching and detaching ── */

/**
 * Attach a global attribute the product does not carry yet.
 *
 * `position` is one past the highest in use rather than the array length: the
 * stored positions are the API's and may be sparse, and a new attribute landing
 * on a position an existing one already holds is two attributes claiming the same
 * slot in the storefront's order.
 *
 * `visible: true` and `variation: false` are `AttributeInput`'s **own** defaults
 * — `self::toBool($entry['visible'] ?? true)` and `($entry['variation'] ?? false)`
 * — copied so that what the panel stores and what the API would have assumed are
 * the same thing. A new attribute is a *spec* until somebody says otherwise,
 * which is also the safe direction: a spec creates no variation rows.
 */
export function attach(draft: readonly Attached[], attribute: { id: number; taxonomy: string }): Attached[] {
  const position = draft.reduce((highest, row) => Math.max(highest, row.position), -1) + 1;

  return [
    ...draft,
    {
      id: attribute.id,
      // The **taxonomy**, not the slug: `ProductPresenter::attributes()` emits
      // `$attribute->get_name()`, which for a global attribute is `pa_matiere`,
      // and `variationKey()` joins on it. Storing the slug here would produce a
      // row that no variation could ever match.
      name: attribute.taxonomy,
      options: [],
      visible: true,
      variation: false,
      position,
    },
  ];
}

/** Detach one attribute. The rest of the list is untouched and still complete. */
export function detach(draft: readonly Attached[], key: string): Attached[] {
  return draft.filter((attribute) => variationKey(attribute) !== key);
}

/** Replace one entry in place, keeping every other entry byte-identical. */
function replace(
  draft: readonly Attached[],
  key: string,
  change: (attribute: Attached) => Attached,
): Attached[] {
  return draft.map((attribute) =>
    variationKey(attribute) === key ? change(attribute) : attribute,
  );
}

/**
 * Tick or un-tick one term of an attribute.
 *
 * `order` is the attribute's full vocabulary in the order the screen renders it,
 * and the result is always a **subsequence** of it. That is what makes the toggle
 * idempotent: un-ticking and re-ticking a term returns an array equal to the one
 * before, so `attributesBody()` reports the card clean again instead of offering
 * to save a reordering nobody asked for.
 *
 * The values stored are what the read emitted — **term slugs** for a global
 * attribute, free strings for a local one — and they are sent back unchanged.
 * `ProductRepository::resolveTermIds()` resolves an option by
 * `get_term_by('slug', sanitize_title($option))` and falls back to
 * `get_term_by('name', $option)`, so a slug the API itself published is the value
 * most certain to resolve. This matters for the Arabic case the attributes branch
 * measured, where a term's slug (`%d8%a3%d8%ad%d9%85%d8%b1`) and its name
 * (`أحمر`) are not the same string: sending back the slug the read gave is the
 * round trip `docs/API.md` promises, and inventing either side of that pair is
 * how a panel produces *"Unknown term"* for a term that plainly exists.
 */
export function withOption(
  draft: readonly Attached[],
  key: string,
  option: string,
  on: boolean,
  order: readonly string[],
): Attached[] {
  return replace(draft, key, (attribute) => {
    const chosen = new Set(attribute.options);
    if (on) chosen.add(option);
    else chosen.delete(option);

    // Ordered by the vocabulary, then followed by anything the product carries
    // that the vocabulary does not list — a term deleted from the attributes
    // screen after this product was tagged still has to survive the save.
    const known = order.filter((slug) => chosen.has(slug));
    const unknown = attribute.options.filter((slug) => chosen.has(slug) && !order.includes(slug));

    return { ...attribute, options: [...known, ...unknown] };
  });
}

/**
 * The spec/variant switch — WooCommerce's `variation` flag, which is the one
 * decision on this screen that changes what a product *is*.
 */
export function withRole(draft: readonly Attached[], key: string, variation: boolean): Attached[] {
  return replace(draft, key, (attribute) => ({ ...attribute, variation }));
}

/** `visible` — whether the storefront prints this attribute on the product page. */
export function withVisible(draft: readonly Attached[], key: string, visible: boolean): Attached[] {
  return replace(draft, key, (attribute) => ({ ...attribute, visible }));
}

/* ──────────────────────────────────────────────────── the mapping guard ── */

/**
 * A variation that would stop being identifiable if this draft were saved.
 *
 * `reason` is which of the three destructive edits caused it, because the
 * sentence a person needs is different for each and a generic *"this will break
 * variations"* is the warning everybody clicks through.
 */
export type MappingLoss = {
  /** The lowercased attribute name, as both sides of the join spell it. */
  key: string;
  reason: "detached" | "no-longer-variation" | "option-removed";
  /** Ids of the variations that lose their identity. Never empty. */
  variations: number[];
  /**
   * For `option-removed`, the option values being taken away that some variation
   * is actually using. Empty for the other two reasons.
   */
  options: string[];
};

/** The values a variation actually uses, normalised the way the API compares them. */
const usedValue = (variation: Variation, key: string): string | null => {
  const raw = variation.attributes[key];
  // An empty value is WooCommerce's *any* — `guardAttributes()` skips it
  // explicitly — so a wildcard row depends on no particular option and cannot be
  // orphaned by one being removed.
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim().toLowerCase() : null;
};

/**
 * Every variation the draft would orphan, and why.
 *
 * This is the (c) half of the deferral argument: the complete-list rule makes an
 * *accidental* wipe unreachable, and this makes a *deliberate* one visible before
 * it happens. All three reasons produce the same end state — a variation whose
 * combination the parent no longer offers, which
 * `VariationService::guardAttributes()` will refuse on the next edit and which
 * the storefront cannot resolve — but they are three different acts and the
 * confirmation says which one is about to happen.
 *
 * **`detached` and `no-longer-variation` are counted separately even though they
 * are the same damage**, because they are not the same mistake. Removing an
 * attribute is something a person meant to do to the product; turning off
 * "each value is its own line" is something a person may think only affects the
 * shop front. The second is the one that needs the louder sentence.
 *
 * A **spec** attribute is never a loss: no variation can carry a key the parent
 * did not mark `variation: true`, so removing one costs nothing but the label.
 * That is checked against `current`, not `draft` — an attribute being *promoted*
 * to a variation axis in the same save has no variations to lose yet.
 */
export function mappingLosses(
  current: readonly Attached[],
  draft: readonly Attached[],
  variations: readonly Variation[],
): MappingLoss[] {
  const losses: MappingLoss[] = [];
  const drafted = new Map(draft.map((attribute) => [variationKey(attribute), attribute]));

  for (const attribute of current) {
    if (!attribute.variation) continue;

    const key = variationKey(attribute);
    const next = drafted.get(key);
    const carriers = variations.filter((variation) => usedValue(variation, key) !== null);

    if (carriers.length === 0) continue;

    if (next === undefined) {
      losses.push({ key, reason: "detached", variations: carriers.map((v) => v.id), options: [] });
      continue;
    }

    if (!next.variation) {
      losses.push({
        key,
        reason: "no-longer-variation",
        variations: carriers.map((v) => v.id),
        options: [],
      });
      continue;
    }

    // Still a variation axis, but narrower. Only the options some row is using
    // count: un-ticking a term nothing carries is free, and warning about it
    // would train the warning away.
    const kept = new Set(next.options.map((option) => option.toLowerCase()));
    const stranded = carriers.filter((variation) => !kept.has(usedValue(variation, key) as string));

    if (stranded.length > 0) {
      losses.push({
        key,
        reason: "option-removed",
        variations: stranded.map((v) => v.id),
        options: [
          ...new Set(stranded.map((variation) => usedValue(variation, key) as string)),
        ],
      });
    }
  }

  return losses;
}

/* ──────────────────────────────────────────────── generate combinations ── */

/** One axis of the grid: a variation attribute and the terms this product offers. */
export type Axis = {
  key: string;
  attribute: Attached;
  options: string[];
};

/** A variation's identity: attribute key → option value, exactly the POST body's `attributes`. */
export type Combination = Record<string, string>;

/**
 * The axes the grid is built from — the attributes marked as variants, and only
 * those with at least one term chosen.
 *
 * An axis with no options is dropped rather than treated as an empty dimension,
 * which would make the whole cartesian product zero and report *"nothing to
 * generate"* on a product where the other axes plainly have combinations. The
 * screen says separately that the attribute has no terms chosen.
 */
export function axesOf(draft: readonly Attached[]): Axis[] {
  return draft
    .filter((attribute) => attribute.variation && attribute.options.length > 0)
    .map((attribute) => ({
      key: variationKey(attribute),
      attribute,
      options: [...attribute.options],
    }));
}

/**
 * `VariationRepository::normalizeCombination()` in TypeScript — lowercase the
 * keys and the values, trim, and **sort by key**.
 *
 * The sort is the part that matters and the part that is easy to leave out. The
 * API compares two combinations by `$existing === $candidate` on PHP arrays,
 * which is order-sensitive, and `ksort()` is why `{size: 'm', colour: 'red'}` and
 * `{colour: 'red', size: 'm'}` are one combination rather than two. A panel that
 * compared unsorted would report every existing row as missing and offer to
 * generate a duplicate of the entire table.
 */
export function combinationKey(combination: Combination): string {
  return Object.entries(combination)
    .map(([key, value]) => [key.toLowerCase().replace(/^attribute_/, ""), value.trim().toLowerCase()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/** The cartesian product of the axes, in a stable order the person can predict. */
export function combinationsOf(axes: readonly Axis[]): Combination[] {
  if (axes.length === 0) return [];

  return axes.reduce<Combination[]>(
    (rows, axis) =>
      rows.flatMap((row) => axis.options.map((option) => ({ ...row, [axis.key]: option }))),
    [{}],
  );
}

/**
 * **The cap, and it is the panel's alone.**
 *
 * There is no *cardinality* ceiling anywhere in the API — searched:
 * `VariationController` registers no count guard, `VariationService::create()`
 * enforces exactly two state rules (a duplicate combination and a duplicate SKU)
 * and neither is a cardinality one, and `GET /products/{id}/variations` is
 * **unpaginated**: `Response::success(ProductPresenter::variationList($variations))`
 * with no `$meta`, so every row a product has lands in one response on every
 * render of this page. The API will accept all 7,776 of `OptionSet`'s example and
 * serve them back in a single body forever after.
 *
 * So the panel is the only thing between a shopkeeper and that, and the number
 * had to be chosen rather than read.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ## It was 50, and that argument is kept because it was not wrong
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * > **50, because it is `OptionSet::MAX_CHOICES` — the one cardinality this
 * > codebase has already argued about.** That constant caps the choices in one
 * > option group under the heading *"Caps, each because an unbounded one turns a
 * > product read into an unbounded response"*, which is exactly the sentence that
 * > applies here, one level up. Borrowing it means the panel and the API agree
 * > about how many of one enumerated thing a person may make in one go, instead
 * > of the panel inventing a second opinion.
 *
 * Every clause of that is still true, and the borrowing was still the right
 * instinct — a number invented on this screen would have had nothing behind it at
 * all. What has changed is that the constant borrowed from turns out to be
 * *about something else*, and the difference shows up on ordinary products
 * rather than on pathological ones.
 *
 * `MAX_CHOICES` bounds **the choices inside one option group** — one list, one
 * dimension, and the thing it protects is the size of a single product's stored
 * option document. This cap bounds **the product of every variation axis**, which
 * is a different quantity that happens to be measured in the same units. A
 * clothing product with 6 sizes and 9 colours has two axes well inside
 * `MAX_CHOICES` on each and a grid of 54, and the screen refused it — while a
 * single 50-value axis, which is the shape `MAX_CHOICES` actually describes,
 * passed. The cap was refusing the case it was written for and admitting the case
 * it was not.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ## 200, and what it is measured against
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **200 clears every grid a shop of this kind actually builds and still refuses
 * the shape `OptionSet.php` is arguing about.** Two axes at 12 × 14, or three at
 * 6 × 6 × 5, are variations: each cell is a thing with its own SKU, its own shelf
 * and its own line in an export. Five axes of six options — `OptionSet`'s own
 * example, 7,776 — is not, and 200 refuses it by a factor of thirty-nine. The
 * number is a round one at the top of the range of grids that are still a
 * catalogue rather than a configurator, and it is not derived from a backend
 * constant, because — as above — the backend constant it used to borrow was
 * measuring a different thing. It is the panel's own, and this paragraph is the
 * whole of its provenance.
 *
 * `OptionSet.php` still names the other half — *"A variation is a thing with a
 * SKU and stock. An option is a modifier with neither … Five attributes of six
 * options each is 7,776 variations"* — and `products.variants.capWhy` still says
 * so, because a person who has just built a 7,776-cell grid needs to be told they
 * wanted an option set, not that a button is disabled.
 *
 * ### What still stops 7,776, now that this number does not
 *
 * Four things, and only the first is this constant:
 *
 * 1. **This cap.** `planGeneration()` refuses `over-cap` before anything is sent,
 *    and `ProductVariations` prints the grid's real size and the cap in the same
 *    sentence — *"say the number before firing"* is a property of the plan, not of
 *    the cap's value, so it survives the change untouched.
 * 2. **The cap is on what one press creates, not on what a product may hold.** A
 *    product with sixty rows and three gaps fills the three. Nothing here bounds
 *    the sixtieth row, and nothing should: the cost being guarded is a fan-out
 *    started by one click.
 * 3. **The API's write rate limit**, which is new to this docblock and is the
 *    reason the sentence at the top now says *cardinality*. See below.
 * 4. **Nothing else.** A caller that is not this panel still creates unbounded
 *    variations one at a time, which `changes.md` has recorded since step 4 and
 *    which this change does not alter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ## The ceiling this number newly sits above, stated rather than discovered
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **There is no cardinality ceiling in the API. There is a *rate* one, and 200 is
 * on the far side of it where 50 was not.** Every line below is **read from
 * source** and none of it is measured, in process or over the wire — said
 * explicitly because it is now a choice rather than a block: `changes.md` records
 * that real Application Passwords exist and that HTTP measurement is possible for
 * the first time in this build. Firing 121 writes at a shop to watch the 121st
 * fail would also spend that shop's write window, so what this docblock claims is
 * what the four files say, and a measurement is left to whoever wants the
 * `Retry-After` figure rather than the rule:
 *
 * - `Security/RateLimitGuard.php::guard()` runs on `rest_pre_dispatch` for
 *   `algerian-commerce/v1` only, classifies anything that is not `GET`, `HEAD` or
 *   `OPTIONS` as a write, and enforces the write limit against **both** a
 *   `user:{id}` counter and an `ip:{addr}` counter.
 * - `Security/RateLimiter.php` — `DEFAULT_WRITES = 120`, `WINDOW = 60`.
 * - `Security/RateLimit.php` — a **fixed** window, stated in its own docblock:
 *   *"the counter resets on a boundary … it bounds sustained abuse … it is not a
 *   traffic shaper"*. `isExceeded($used)` is `$used > $limit`.
 * - Over the limit is `429 too_many_requests`, *"Too many requests. Please retry
 *   shortly."*, carrying `details.retry_after` — seconds to the next boundary.
 *
 * So a full 200-cell run **cannot complete inside one window**, and the shop's
 * whole write allowance is shared with every other thing the operator does that
 * minute. Where the run lands depends on where the minute boundary falls, which
 * is the property a fixed window has and a shaper does not.
 *
 * **What the panel does with that today is the honest gap, and it is named here
 * rather than repaired here.** `isParentRefusal()` stops the run only on a 409
 * with neither `variation_id` nor `sku` in its details. A 429 is not that, so it
 * is recorded against its own combination and the loop continues — and the run
 * would produce a list of identical *"Too many requests"* rows, which is exactly
 * the shape `ProductVariations`' own docblock refuses for the parent-level 409:
 * *"firing the remaining forty-nine would be forty-nine identical failures behind
 * a progress bar"*. Raising the cap is what makes that reachable; closing it is a
 * change to when a run abandons and what it tells the person to do next, with its
 * own argument, and it is not a side effect of changing a number.
 */
export const COMBINATION_CAP = 200;

export type GenerationPlan = {
  axes: Axis[];
  /** Every cell of the grid, whether or not it exists. `1` for a single axis of one term. */
  total: number;
  /** The cells with no variation yet — one `POST` each, in this order. */
  missing: Combination[];
  /**
   * Existing variations that leave one of the axes unset — WooCommerce's *any*.
   *
   * They cover **no** cell of the grid: `guardDuplicateCombination()` compares
   * the whole normalised map, so `{taille: ""}` and `{taille: "m"}` are different
   * combinations and generating the second beside the first is accepted, not
   * refused. Counted and reported rather than silently ignored, because the
   * result is two rows a shopper could match at once and no error anywhere.
   */
  wildcards: number;
  /** Why the button cannot fire, or `null` when it can. */
  refusal: null | "no-axes" | "nothing-missing" | "over-cap";
};

/**
 * What one press of "generate" would do, decided **before** it is offered.
 *
 * The whole point is that `total` is knowable without asking anybody: the grid is
 * the product of the axes and the panel is holding both. So the count goes on
 * screen next to the button, and the refusal — when there is one — names the
 * grid size and the cap rather than greying a control out.
 */
export function planGeneration(
  draft: readonly Attached[],
  variations: readonly Variation[],
): GenerationPlan {
  const axes = axesOf(draft);
  const grid = combinationsOf(axes);
  const keys = axes.map((axis) => axis.key);

  const existing = new Set(variations.map((variation) => combinationKey(variation.attributes)));
  const missing = grid.filter((combination) => !existing.has(combinationKey(combination)));

  const wildcards = variations.filter((variation) =>
    keys.some((key) => usedValue(variation, key) === null),
  ).length;

  const refusal =
    axes.length === 0
      ? ("no-axes" as const)
      : missing.length === 0
        ? ("nothing-missing" as const)
        : missing.length > COMBINATION_CAP
          ? ("over-cap" as const)
          : null;

  return { axes, total: grid.length, missing, wildcards, refusal };
}

/**
 * `POST /products/{id}/variations` for one cell.
 *
 * **`attributes` and nothing else.** `VariationInput::forCreate()` requires the
 * combination and refuses a create without one (*"A variation must specify its
 * attribute combination."*), and every other field is optional — so a generated
 * row arrives with no price, no SKU and no stock, which is the honest state: the
 * panel does not know what any of them should be, and a price it invented would
 * be a price somebody ships at.
 *
 * A SKU is deliberately **not** generated. `VariationService::guardSku()` checks
 * against `wc_get_product_id_by_sku()` across the whole catalogue, so a made-up
 * `PARENT-1` would 409 the moment it collided with anything, and the empty SKU
 * a variation is allowed to have is exactly what the table then lets a person
 * fill in one row at a time.
 */
export function variationCreateBody(combination: Combination): Record<string, unknown> {
  return { attributes: combination };
}

/**
 * A refusal that will refuse **every** remaining combination, so the run stops.
 *
 * The two parent-level 409s are the whole set, read from `VariationService`:
 * `requireVariableParent()` throws *"Only variable products have variations."*
 * with `details.type`, and `guardAttributes()` throws *"The parent product has no
 * attributes marked for variations."* with no details at all. Neither depends on
 * which combination is being written, so firing the other forty-nine would be
 * forty-nine identical failures and a progress bar.
 *
 * The two **row-level** 409s are told apart by their details and must not stop
 * the run: a duplicate combination carries `details.variation_id`, a duplicate
 * SKU carries `details.sku`. Generation sends no SKU, so only the first is
 * reachable here — and it means one cell was filled in by somebody else while the
 * run was going, which is precisely the case the other forty-nine should survive.
 */
export function isParentRefusal(status: number, details: Record<string, unknown>): boolean {
  return status === 409 && details.variation_id === undefined && details.sku === undefined;
}

/* ────────────────────────────────────────────────── one row of the table ── */

/**
 * What the variations table edits, and only that.
 *
 * Six of `VariationInput::allowedFields()`'s twelve. The other six are absent for
 * the rule `ProductDetail` states and this table keeps: **a field the form sends
 * but never shows is a field it can silently clobber.** `description`, `weight`
 * and `image_id` have no control in a table row; `attributes` is the row's
 * identity and is edited by adding or deleting a row, never by rewriting one in
 * place — a PATCH that moved a variation onto another combination would be a
 * silent duplicate the moment the target already existed.
 *
 * `stock_quantity` is a **string**, which is `ProductDetail`'s trick for the same
 * reason: an empty box and a count of zero are different facts about a shelf, and
 * `Number("")` is `0`.
 */
export type VariationDraft = {
  sku: string;
  regular_price: string;
  sale_price: string;
  status: string;
  manage_stock: boolean;
  stock_quantity: string;
  stock_status: string;
};

export function variationDraftFrom(variation: Variation): VariationDraft {
  return {
    sku: variation.sku,
    regular_price: variation.regular_price,
    sale_price: variation.sale_price,
    status: variation.status,
    manage_stock: variation.manage_stock,
    stock_quantity: variation.stock_quantity === null ? "" : String(variation.stock_quantity),
    stock_status: variation.stock_status,
  };
}

/**
 * **Per-row dirty**, and what that means is the table's central decision.
 *
 * A row is dirty when its draft differs from the row the API last returned, field
 * by field, on the six fields above — not "has been focused", not "the table has
 * been touched". Each row is its own request to its own URL
 * (`PATCH /products/{id}/variations/{variation_id}`), so a row is the unit of
 * saving, the unit of failure and the unit of dirt, and all three being the same
 * unit is what makes a failed row cost nothing to the row beneath it.
 *
 * `null` when nothing changed, for the third time in this panel and the same 400:
 * `VariationService::update()` throws `invalidRequest('No supported fields were
 * provided.')` on an empty input, and that 400 carries no `details`.
 *
 * **`stock_quantity` rides with `manage_stock` or not at all.** The two are one
 * fact about a shelf: `VariationRepository::apply()` calls `set_stock_quantity()`
 * unconditionally, so sending a count for a row that manages no stock would store
 * a number nothing reads and the next GET would answer `null` — a save that
 * looked like it worked. `ProductDetail` drops the key on the same grounds, where
 * the silent drop was measured; here it is read from source and the rule is
 * copied deliberately rather than re-derived.
 */
export function variationUpdateBody(
  current: Variation,
  draft: VariationDraft,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  const stored = variationDraftFrom(current);

  // Sent as typed and never through `Number()`. `VariationInput` runs
  // `is_numeric()` and refuses what fails it with a sentence naming the value;
  // a cast here would turn `"12a"` into `NaN`, which `JSON.stringify` writes as
  // `null`, and `null` on a price field is the API's *clear it*.
  if (draft.sku.trim() !== stored.sku) body.sku = draft.sku.trim();
  if (draft.regular_price !== stored.regular_price) body.regular_price = draft.regular_price;
  if (draft.sale_price !== stored.sale_price) body.sale_price = draft.sale_price;
  if (draft.status !== stored.status) body.status = draft.status;
  if (draft.stock_status !== stored.stock_status) body.stock_status = draft.stock_status;

  if (draft.manage_stock !== stored.manage_stock) body.manage_stock = draft.manage_stock;

  if (draft.manage_stock && draft.stock_quantity !== stored.stock_quantity) {
    body.stock_quantity = draft.stock_quantity === "" ? null : Number(draft.stock_quantity);
  }

  return Object.keys(body).length === 0 ? null : body;
}

/** True when this row has something to save. The Save control's whole condition. */
export function rowDirty(current: Variation, draft: VariationDraft): boolean {
  return variationUpdateBody(current, draft) !== null;
}

/**
 * The rows whose SKUs collide **with each other**, before anybody asks the API.
 *
 * This is the one refusal the table makes on its own, and it is deliberately the
 * only one — the same rule `attribute-write.ts` states for a 29-byte slug: refuse
 * what the panel can rule out with what it is holding, and leave everything else
 * to the server.
 *
 * Two rows of the same table typing the same SKU is knowable here and is a
 * certain 409: `VariationService::guardSku()` asks
 * `ProductRepository::skuExists()`, which is `wc_get_product_id_by_sku()` —
 * WooCommerce's index covers variations as well as products, so the second row to
 * save would be refused by the first. Catching it here marks **both** rows, which
 * the 409 cannot: the API names the SKU and the row that was refused, and has no
 * idea the clash is with an unsaved sibling three lines up.
 *
 * Uniqueness against the rest of the shop is *not* checked, because the panel is
 * not holding the rest of the shop. That stays the API's answer.
 *
 * Compared case-insensitively and trimmed. An empty SKU never collides —
 * `guardSku()` returns early for `''` and a variation inheriting its parent's
 * SKU is the ordinary state of the first row of every product in this shop.
 */
export function localSkuClashes(drafts: ReadonlyMap<number, VariationDraft>): Set<number> {
  const byKey = new Map<string, number[]>();

  for (const [id, draft] of drafts) {
    const sku = draft.sku.trim().toLowerCase();
    if (sku === "") continue;
    byKey.set(sku, [...(byKey.get(sku) ?? []), id]);
  }

  const clashing = new Set<number>();
  for (const ids of byKey.values()) {
    if (ids.length > 1) for (const id of ids) clashing.add(id);
  }

  return clashing;
}
