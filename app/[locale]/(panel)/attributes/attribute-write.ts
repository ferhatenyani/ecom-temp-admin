import type { AttributeTerm, GlobalAttributeDetail } from "@/lib/api/schemas/product";

/**
 * The bodies the attributes screen sends, and the rules it applies before it
 * sends them.
 *
 * Separated from the two components for `orders/new-order.ts`'s reason and
 * deliberately in its shape: the interesting half of a write screen is not the
 * markup, it is which keys reach the wire and what the panel refuses on its own
 * — a pure function of a plain object, asserted directly in
 * `tests/attributes.test.ts` rather than through a dozen `fireEvent`s.
 *
 * ## How every claim here was established
 *
 * The plugin at `ecom-temp/wp-content/plugins/algerian-commerce-core` is the
 * authority and is cited by `file:symbol`. Where a shape could not be read off
 * the source — because it is WooCommerce's rather than the plugin's, or because
 * it depends on this shop's data — it was **measured in process through
 * `rest_do_request()`** on 2026-08-30, either by running the plugin's own suite
 * (`tests/Api/attributes.php`, **59 passed, 0 failed**) or by a probe against
 * the same install. Nothing here was measured over live HTTP: `BLOCKED.md`
 * records the 401 and there is no credential.
 *
 * ## The four refusals a form has to be built around
 *
 * 1. **An empty `PATCH` is a 400 with no `details` key at all.**
 *    `AttributeService::update()` and `updateTerm()` both throw
 *    `ApiException::invalidRequest('No supported fields were provided.')` when
 *    the input is empty, and measured it carries no `details` — so a screen
 *    reading `details.fields` gets `undefined` and renders nothing. The answer
 *    is not to handle it: `attributeUpdateBody()` and `termUpdateBody()` return
 *    `null` when nothing changed, and the save control is off. **The panel never
 *    sends that request.**
 *
 * 2. **WooCommerce's own refusals now arrive under the field that failed, and
 *    this item used to say they did not.** `AttributeRepository::fromWpError()`
 *    filed every non-conflict `WP_Error` under `details.fields.attribute` — one
 *    literal string, and no control on any form is called `attribute` — so a
 *    screen binding `details.fields` by key showed **nothing** for the two
 *    refusals a real shop meets. The fix round's item 8 fixed it at the source
 *    rather than in this file. Measured again after the change:
 *
 *      400 {"fields":{"slug":"Slug \"type\" is not allowed because it is a reserved term. Change it, please."}}
 *      400 {"fields":{"name":"Slug \"longueurlongueur…\" is too long. Please use a shorter slug."}}
 *
 *    **Which key depends on the payload, not on the refusal.**
 *    `wc_create_attribute()` derives the slug from the *name* when none is
 *    stated and then refuses the string it derived, so a person who typed a long
 *    label and left the slug box empty is told about a slug they never wrote —
 *    and the control that can fix it is the name. The backend decides that from
 *    the same fact this file does: whether the body carried a `slug` key.
 *    `attributeCreateBody()` below omits a blank one, which is what makes the
 *    two agree.
 *
 * 3. **A duplicate slug is a 409, and it now carries `details.slug`** — the
 *    value that clashed, at the top of `details` and deliberately not under
 *    `fields`. `fields` is this API's 400 validation channel and no conflict in
 *    the plugin writes to it; what a 409 carries is the offending value, the
 *    shape `ProductService` uses for a duplicate SKU. The message is still
 *    WooCommerce's and still names the slug, so a banner remains the right place
 *    for it — the added key is for a screen that wants to say *which* slug
 *    without parsing a sentence. **A 409 on a derived slug carries no `slug`
 *    key**, because the backend does not know the derived string either; the
 *    message does.
 *
 * 4. **A slug change is reported in `meta`, not in the resource.**
 *    `AttributeController::update()` returns `['slug_changed' => true]` only
 *    when the taxonomy moved, and an ordinary write carries no `meta` at all —
 *    `tests/Api/attributes.php` asserts both halves separately. That is why the
 *    screen reads the write's `meta` (`acWriteWithMeta`) rather than diffing.
 */

/**
 * `GlobalAttributeInput::ORDER_BY` — "WooCommerce's own list, hard-coded inside
 * `wc_create_attribute()`".
 *
 * Copied rather than fetched because there is no route that publishes it, and
 * copied *from the plugin's constant* rather than from WooCommerce, so the panel
 * refuses exactly what the API refuses. Measured: `order_by: "sideways"` is a
 * 400 whose message is `Must be one of: menu_order, name, name_num, id.`
 */
export const ATTRIBUTE_ORDER_BY = ["menu_order", "name", "name_num", "id"] as const;
export type AttributeOrderBy = (typeof ATTRIBUTE_ORDER_BY)[number];

/**
 * `GlobalAttributeInput::MAX_SLUG_BYTES`, and it is **bytes**.
 *
 * WordPress caps a taxonomy name at 32 and `pa_` takes three, so 29 is left.
 * `strlen()` counts bytes, which is the whole reason this matters here rather
 * than being a detail: a French label spends one byte a letter and an Arabic one
 * spends two, so "الطول" is five characters and ten bytes and a fifteen-letter
 * Arabic label is already over. Measured — a 29-byte slug is 201 and a 30-byte
 * slug is 400.
 *
 * The plugin's own comment says the constant is a copy and copies drift, and
 * WooCommerce is the authority. This is a third copy for the same reason: it
 * exists to produce a *message before the request*, never to decide the answer.
 */
export const MAX_SLUG_BYTES = 29;

/** `GlobalAttributeInput::MAX_NAME` and `AttributeTermInput::MAX_NAME`. */
export const MAX_NAME = 200;

/**
 * The panel asks for the whole vocabulary in one request.
 *
 * `AttributeController::termIndexArgs()` calls `paginationArgs(Response::MAX_PER_PAGE)`,
 * so `per_page` **defaults to 100** on this route where every other collection
 * defaults to 20 — and 100 is also the maximum, measured: `per_page=200` is a
 * 400 saying *"per_page must be between 1 (inclusive) and 100 (inclusive)"*.
 *
 * Sent explicitly rather than left to the default, because the default is a fact
 * about the route that a reader of this file cannot see and that the next
 * version of the API could change. A shop past 100 terms in one attribute pages;
 * `meta.total` says whether it has to.
 */
export const TERMS_PER_PAGE = 100;

/**
 * The byte length of a slug, which is what the API measures.
 *
 * `TextEncoder` rather than `.length`, and the difference is the entire point:
 * `"الطول".length` is 5 and its UTF-8 length is 10.
 */
export function slugBytes(slug: string): number {
  return new TextEncoder().encode(slug).length;
}

/**
 * The panel's own normalisation of a typed slug, matching
 * `GlobalAttributeInput::common()`: trim, lowercase, and **strip a leading
 * `pa_`**.
 *
 * The prefix is stripped rather than refused because `GET /attributes` publishes
 * the taxonomy as `pa_matiere` beside the slug `matiere`, and a person copying
 * the wrong one of the two out of the row above is the ordinary mistake. The API
 * strips it too, so this changes no outcome — it makes the box show what will
 * actually be stored while it is being typed.
 */
export function normaliseSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/^pa_/, "");
}

/**
 * The one refusal the panel makes before asking, and it is deliberately the only
 * one.
 *
 * A slug over 29 bytes is a certain 400 — the check is `GlobalAttributeInput`'s
 * own and does not depend on the shop's state — so asking would spend a request
 * to be told something the panel already knows, and the answer would arrive
 * bound to `fields.slug` a second later anyway. Everything else a slug can be
 * wrong about (reserved, already taken) depends on data the panel does not hold
 * and is left to the server.
 *
 * `null` means "nothing the panel can rule out", never "valid".
 */
export function slugTooLong(slug: string): boolean {
  return slugBytes(slug) > MAX_SLUG_BYTES;
}

export type AttributeDraft = {
  name: string;
  /** Empty means "derive it from the name", which is what omitting the key does. */
  slug: string;
  order_by: AttributeOrderBy;
  has_archives: boolean;
};

export function draftFromAttribute(attribute: GlobalAttributeDetail): AttributeDraft {
  return {
    name: attribute.name,
    slug: attribute.slug,
    /*
     * The stored value could in principle be outside the four — nothing stops a
     * plugin writing the column — so it is checked rather than cast. Falling
     * back to `menu_order` matches `AttributeService::create()`'s own default
     * and keeps the control showing something real.
     */
    order_by: (ATTRIBUTE_ORDER_BY as readonly string[]).includes(attribute.order_by)
      ? (attribute.order_by as AttributeOrderBy)
      : "menu_order",
    has_archives: attribute.has_archives,
  };
}

/**
 * `POST /attributes`.
 *
 * **`name` is the only required key and `type` is never sent.** The type
 * vocabulary is `wc_get_attribute_types()`, a filtered PHP list a plugin can
 * extend, and no route publishes it — the only way a client learns it is by
 * provoking a 400 and reading `details.available_types`. Measured on this shop,
 * that list is `["select"]`: one value. A control offering a choice of one is
 * noise, and a control offering a hard-coded several would be inventing a
 * vocabulary the panel cannot check. So the key is omitted, `AttributeService`
 * defaults it to `select`, and the detail screen shows the stored value
 * read-only.
 *
 * `slug` is omitted when blank rather than sent empty: an empty string is a 400
 * (*"Must be a non-empty string, or omitted to derive it from the name"*) while
 * an absent key is the derivation the person asked for.
 *
 * `order_by` and `has_archives` are **not** sent on create either, and that is
 * the create form's own rule rather than an API constraint: a field the form
 * does not draw must not reach the wire. Both are on the detail form, where
 * there is room to say what they do.
 */
export function attributeCreateBody(draft: {
  name: string;
  slug: string;
}): Record<string, unknown> {
  const slug = normaliseSlug(draft.slug);
  return {
    name: draft.name.trim(),
    ...(slug === "" ? {} : { slug }),
  };
}

/**
 * `PATCH /attributes/{id}` — **only what changed**, and `null` when nothing did.
 *
 * The null is the whole reason this function exists rather than a spread. An
 * empty patch is a 400 with no `details`, so a save button that fired on an
 * untouched form would produce an error a person cannot act on and cannot even
 * see bound to a control. `null` turns that into a disabled control with a
 * reason, which is §3.3.
 *
 * Sending only the changed keys also keeps the `meta.slug_changed` signal
 * meaningful: re-sending an unchanged slug is accepted and reports nothing, but
 * it means the panel asked the server to rewrite the taxonomy every time
 * somebody fixed a typo in the label, and `wc_update_attribute()` is not a cheap
 * write — it migrates every product's meta.
 */
export function attributeUpdateBody(
  current: GlobalAttributeDetail,
  draft: AttributeDraft,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};

  /*
   * **An emptied box is never sent, on either field**, and the two get there by
   * different routes.
   *
   * A blank `slug` means *leave it alone*: omitting the key on a create is the
   * derivation, and on an update there is nothing to derive from that would not
   * be a rename nobody asked for.
   *
   * A blank `name` is a certain 400 — `GlobalAttributeInput`, *"Must be a
   * non-empty string."* — so sending it would spend a request to be told
   * something the panel already knows. It is omitted here **and** blocked at the
   * control, which is the half that matters: omission alone would make clearing
   * the name a save that silently did nothing. `blankRequired()` is what the
   * screen asks.
   */
  const name = draft.name.trim();
  if (name !== "" && name !== current.name) body.name = name;

  const slug = normaliseSlug(draft.slug);
  if (slug !== "" && slug !== current.slug) body.slug = slug;

  if (draft.order_by !== current.order_by) body.order_by = draft.order_by;
  if (draft.has_archives !== current.has_archives) body.has_archives = draft.has_archives;

  return Object.keys(body).length === 0 ? null : body;
}

export type TermDraft = { name: string; slug: string; description: string };

export function draftFromTerm(term: AttributeTerm): TermDraft {
  return { name: term.name, slug: term.slug, description: term.description };
}

/**
 * `POST /attributes/{id}/terms`.
 *
 * The create card sends `name` alone when the slug box is empty, which is the
 * common case and the one that has to be fast: adding a colour vocabulary is
 * thirty of these in a row, and a second box to tab through on every one is the
 * cost paid thirty times for the case that arises twice.
 *
 * `menu_order` is not sent. It is writable and the term rows carry it, but
 * nothing on this screen reorders terms — the attribute's own `order_by` decides
 * the storefront's order, and `menu_order` is only consulted when that is
 * `menu_order`. A key the form does not draw must not reach the wire.
 */
export function termCreateBody(draft: { name: string; slug: string }): Record<string, unknown> {
  const slug = draft.slug.trim();
  return {
    name: draft.name.trim(),
    ...(slug === "" ? {} : { slug }),
  };
}

/**
 * `PATCH /attributes/{id}/terms/{term_id}` — the same "only what changed, or
 * null" contract, for the same 400.
 *
 * `description` is sent when it changed **including when it became empty**,
 * because `AttributeTermInput` accepts `null` and an empty string and stores
 * `''` for both — so clearing a description is a real edit rather than an
 * omission. A blank `name` or `slug`, by contrast, is a 400 and is refused by
 * the form before it gets here.
 */
export function termUpdateBody(
  current: AttributeTerm,
  draft: TermDraft,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};

  // Blank is omitted on both, for the reason `attributeUpdateBody` gives — and
  // `description` is the deliberate exception below.
  const name = draft.name.trim();
  if (name !== "" && name !== current.name) body.name = name;

  const slug = draft.slug.trim();
  if (slug !== "" && slug !== current.slug) body.slug = slug;

  const description = draft.description.trim();
  if (description !== current.description) body.description = description;

  return Object.keys(body).length === 0 ? null : body;
}

/**
 * The one refusal a *rename* form makes before asking: a required box that has
 * been emptied.
 *
 * Separate from `attributeUpdateBody()` answering `null`, and both are needed.
 * The body omits a blank name so a guaranteed 400 never reaches the wire; this
 * turns the save control off so that omission cannot read as a save that
 * worked. §3.3 — a disabled control says why, and this is the "why".
 */
export function blankRequired(value: string): boolean {
  return value.trim() === "";
}

/**
 * Splits a 400's `details.fields` into the part a control can wear and the part
 * that has nowhere to go.
 *
 * ## It was written for `attribute`, and it outlived it
 *
 * This function exists because `AttributeRepository::fromWpError()` filed every
 * WooCommerce refusal under `details.fields.attribute`, a key no control has, and
 * a form binding by key rendered nothing. **The fix round's item 8 fixed that at
 * the source**, so `attribute` is no longer a key this API emits and the case
 * this was written for cannot occur. The honest question was then whether to
 * delete it. It is kept, and the reasons are not sentiment:
 *
 *  - **`ProductAttributes.tsx` calls it with `["attributes"]` against keys that
 *    can never match.** `AttributeInput::listFromPayload()` reports per entry —
 *    `attributes[0]`, `attributes[0].options`, `attributes[0].id` — so `loose`
 *    is structurally load-bearing there and always was. That screen has nothing
 *    to do with `fromWpError()` and was never affected by it.
 *  - **The forms here draw fewer controls than the API names.** The create form
 *    on `AttributesScreen` has `name` and `slug`; `GlobalAttributeInput` can
 *    name `type`, `order_by` and `has_archives` in the same envelope, and
 *    refuses `terms`, `attribute_id` and `attribute_name` **by name** with a
 *    sentence written to be read. The term forms are the same shape against
 *    `AttributeTermInput`'s `menu_order`. Those are real keys on real 400s with
 *    no box to wear them.
 *  - **Its `null` branch is the shape of every 409 and of the `details`-less
 *    400.** Callers hand it `caught.fields` without checking, and the empty
 *    split is what lets one `onError` cover three response shapes.
 *
 * What changed is only which messages end up in `loose`: WooCommerce's own slug
 * refusals used to be the common case and are now bound to `name` or `slug` like
 * any other validation error. `loose` is back to what its name says — a key this
 * screen does not draw, meaning either a bug here or an API change, and both are
 * worth a person seeing rather than dropping.
 *
 * `known` is the set of keys the caller actually has a control for.
 */
export function splitFieldErrors(
  fields: Record<string, string> | null,
  known: readonly string[],
): { bound: Record<string, string>; loose: string[] } {
  const bound: Record<string, string> = {};
  const loose: string[] = [];

  for (const [key, message] of Object.entries(fields ?? {})) {
    if (known.includes(key)) bound[key] = message;
    else loose.push(message);
  }

  return { bound, loose };
}

/**
 * The count a 409 carries, or `null` when the refusal was not a usage conflict.
 *
 * Both delete guards put it under `details.products` — measured on each:
 *
 *   attribute  {products: 1, product_ids: [7565], taxonomy: "pa_acprobesize"}
 *   term       {products: 1, term_id: 729}
 *
 * **`product_ids` is capped at five** by `AttributeService::SAMPLE` while
 * `products` is the full count, so the two disagree on a widely-used attribute
 * and `product_ids.length` must never be read as the number. The term refusal
 * carries no ids at all, so a screen offering to list the products at term grain
 * would be inventing them.
 */
export function detachCount(details: Record<string, unknown>): number | null {
  return typeof details.products === "number" ? details.products : null;
}

/**
 * Whether a delete will be refused, decided **before** the person is asked.
 *
 * The panel holds both numbers already — `product_count` from `GET
 * /attributes/{id}`, `count` on every term row — so it can put the consequence
 * in the *first* dialog rather than discovering it from a 409 and asking twice.
 * `CategoriesScreen` had to ask twice because `GET /cms/faq-categories` does not
 * publish the count on a row it can be sure of; this screen does not.
 *
 * The 409 is still handled, and that is not belt-and-braces: the two numbers are
 * a snapshot, they are computed by *different* rules — `product_count` counts
 * drafts and a term's `count` does not, `AttributeRepository::productUsage()`
 * passes `['publish','draft','pending','private']` where WordPress's own term
 * count is published-only — and somebody else can tag a product between the read
 * and the delete.
 */
export function willDetach(count: number): boolean {
  return count > 0;
}
