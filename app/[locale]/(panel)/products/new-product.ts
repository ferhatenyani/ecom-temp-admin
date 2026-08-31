import {
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  STOCK_STATUSES,
  type ProductStatus,
  type ProductType,
  type StockStatus,
} from "@/lib/product-status";

/**
 * The draft behind `NewProductDrawer`, and the one function that turns it into a
 * `POST /products` body.
 *
 * Separated from the component for the reason `orders/new-order.ts` gives about
 * itself, and this file is deliberately its sibling in shape: the interesting
 * part of a create form is not the markup, it is which fields go on the wire and
 * in what shape, and that is a pure function of a plain object. It is asserted
 * directly in `tests/new-product.test.ts` rather than through eleven
 * `fireEvent`s per case.
 *
 * ## What was measured, and how — this is not transcription
 *
 * Every claim below about `POST /products` is **read from source** in the plugin
 * at `ecom-temp/wp-content/plugins/algerian-commerce-core`, cited by
 * `file:symbol`, or is a live-API measurement this repository already recorded
 * and which is quoted with its date. Nothing here was **measured over live
 * HTTP**: `BLOCKED.md` records the 401 that stops it, and there is no
 * credential. The backend's own in-process suite (`tests/Api/products.php`, run
 * through `rest_do_request()`) exercises the create path and is quoted where it
 * pins something down.
 *
 * ## What this form is, and the four things it deliberately is not
 *
 * The core of a product: a name, a type, a status, a SKU, two prices, both
 * descriptions, its categories, its stock and one image. **Variations, options,
 * attributes and SEO are not here**, and that is the whole reason this screen
 * exists at all — a create form that tried to carry them is why the panel went
 * eleven branches with no way to create a product. Each of the four is a real
 * editor on the detail screen already, and three of them cannot honestly be
 * asked for before the product exists:
 *
 *  - **Variations** need a parent. `POST /products/{id}/variations` is not on
 *    the panel's allowlist and `tests/boundary.test.ts` asserts the refusal, so
 *    there is nothing here to call even if the form drew the rows.
 *  - **Options** (§83) are the hardest component in the panel — three group
 *    types, three caps and errors that name a position
 *    (`options.groups[0].choices[2].price_delta`). A create form carrying a
 *    half-built one would be the reason this drawer never shipped.
 *  - **Attributes** are refused by `ProductDetail` on a *correctness* ground
 *    rather than a scope one — replacing the list drops a variable product's
 *    variation attribute and clears every variation's map — and a create form
 *    has the weaker version of the same problem: an attribute list written
 *    before there is a product to hang it on cannot be checked against the
 *    variations it will later have to describe.
 *  - **SEO** travels whole or not at all. `SeoInput` refuses a partial block and
 *    the API *derives* the whole thing from the product on create, recording in
 *    `seo.overrides` which fields stopped being derived. A create form that sent
 *    a title would opt the product out of that derivation on its first second of
 *    life, silently, for a field nobody asked to override.
 *
 * `slug`, `featured`, `catalog_visibility`, `weight` and `tag_ids` are left out
 * for the plainer reason: they are all writable, all on the detail screen, and
 * none of them is a decision anybody makes while typing a product in. The rule
 * is `ProductDetail`'s and it is inherited rather than restated — *a field a
 * form sends but never shows is a field it can silently clobber* — with the
 * create-side corollary that a field a form neither sends nor shows is a field
 * the API defaults, once, in the open.
 *
 * ## What the API decides, and this file therefore must not
 *
 * **The id, and everything derived from it.** `ProductController::store()` is
 * `Response::success(ProductPresenter::toArray($product), 201)` — read from
 * source — so the 201 carries the whole product with `id` as its first key, and
 * the drawer routes on that rather than guessing a URL or re-reading the list.
 *
 * **The effective price.** `price` is read-only (`ProductInput::READ_ONLY`) and
 * is derived — the sale price when there is one, the regular price otherwise,
 * and on a variable product a figure resolved from the variations. This file
 * states `regular_price` and `sale_price` and computes nothing.
 *
 * **Whether a SKU is free.** `ProductService::guardSku()` runs before the write
 * and answers **409**, not 400, with two distinguishable messages — see
 * `NewProductDrawer`, which binds both onto the SKU control.
 *
 * **Whether an id is an image.** `ProductRepository::assertImageAttachment()`
 * refuses a `image_id` that is not an image attachment with
 * `"{id} is not an image attachment."` under `details.fields.image_id`. Nothing
 * here can know that, which is exactly why the capability fallback in the drawer
 * is a usable control rather than a dead end.
 */

/**
 * What a variable product does **not** carry on its parent, and therefore what
 * this form stops sending the moment `variable` is chosen.
 *
 * ## `type` is asymmetric, and only in one half of what it looks like
 *
 * The obvious reading is *"a variable product's price and stock both behave
 * differently"*. Half of that is true and the half that is false is the one a
 * form would get wrong by guessing.
 *
 * **Price: the parent holds none.** Measured on the live shop and recorded in
 * `lib/api/schemas/product.ts` — *"On a variable product this holds the resolved
 * figure while `regular_price` is `""`"* — and `ProductDetail` draws a whole
 * card description around it (`pricingVariable`) because otherwise a form with
 * two empty price boxes beside a list row reading 12 500 DA is unexplainable.
 *
 * **And the API will nevertheless accept one.** `Products\ProductInput` has *no*
 * branch on `type` at all — read from source, the only occurrence of the word
 * `variable` in that file is the `TYPES` constant — so `regular_price` on a
 * variable create is validated, cleaned and handed to `set_regular_price()` like
 * any other. It is then never read back: WooCommerce resolves a variable
 * product's price from its variations, of which a just-created one has none. So
 * the number the operator typed would be stored, invisible on every screen in
 * the panel, and contradicted by the first variation they add.
 *
 * That is the `ProductDetail` rule in its create-form form: a field the form
 * sends and the shop never shows is worse than a field it does not offer. So the
 * two price controls are **hidden** when `variable` is chosen, and `buildPayload`
 * omits them — hidden rather than disabled, because a disabled box still shows a
 * number somebody typed and now cannot correct.
 *
 * **Stock: not asymmetric, and this is the half worth writing down.** Both
 * variable products in the measured catalogue carry an ordinary
 * `manage_stock` / `stock_quantity` pair, exactly like the simple rows beside
 * them — parent-level stock on a variable product is a real WooCommerce setting
 * and a real thing a shop uses. So the inventory block stays on screen for both
 * types and `buildPayload` sends it for both. A form that hid stock alongside
 * price, on the strength of the word "variable", would be taking away a setting
 * the API keeps and the catalogue uses.
 */
export const VARIABLE_OMITS = ["regular_price", "sale_price"] as const;

export type ProductDraft = {
  /**
   * The one field `POST /products` requires. Everything else on this object is
   * optional to the API.
   *
   * `ProductInput::normalize()` takes `$requireName` and it is the **single**
   * difference between `forCreate()` and `forUpdate()` — one boolean, read from
   * source — so a create with a blank name is `fields.name`: *"A product name is
   * required."*, where an update clearing one is *"A product name cannot be
   * emptied."* Two sentences for two different acts, and this form can only ever
   * provoke the first.
   */
  name: string;
  /**
   * `simple` or `variable`, and it decides more than it looks like — see
   * `VARIABLE_OMITS`.
   *
   * Always sent, never omitted. `ProductRepository::create()` defaults an absent
   * type by construction — `$input->get('type') === 'variable' ? new
   * WC_Product_Variable() : new WC_Product_Simple()` — so omitting it would in
   * fact produce a simple product. It is sent anyway because the picker is on
   * screen with a default this form chose, and a body that omitted the answer to
   * a question it asked would leave the two able to disagree.
   */
  type: ProductType;
  /**
   * `draft` on a blank form, and that is a decision rather than a default.
   *
   * `NewOrderDrawer` defaults to `pending` because it is the only creatable
   * status that moves no stock; this is the same argument one collection over. A
   * product created `publish` is **in the shop** the instant the button is
   * pressed — with whatever description, price and categories had been typed by
   * then, and with no image, because the picture is usually the last thing
   * anybody attaches. `draft` is the status from which a shopkeeper publishes on
   * purpose.
   *
   * **Always sent, and this is the one key whose omission was not resolved from
   * source.** `ProductInput` does not default `status`, so an omitted one falls
   * through to WooCommerce's own default for a newly inserted product — which
   * lives in `WC_Product_Data_Store_CPT` and is not readable in this tree (the
   * plugin is the only thing checked out; WooCommerce is in the image). An
   * unknown default on a field whose wrong value publishes a half-typed product
   * is not a risk worth taking for a shorter body, so the key always rides.
   */
  status: ProductStatus;
  /**
   * Optional to the API, and the field most likely to produce the one refusal
   * this form cannot pre-empt.
   *
   * `ProductService::guardSku()` runs **before** anything is written and answers
   * a 409 with two distinguishable bodies — *"That SKU is already in use."*, and
   * *"That SKU belongs to a product in the trash."* with `details.trashed_product_id`
   * beside it. The second exists because WooCommerce's own insert otherwise
   * throws from inside `save()` and surfaced as a 500; the backend suite pins it
   * by name (`tests/Api/products.php`: *"a SKU held by a trashed product is a
   * conflict, not a 500"*).
   *
   * Neither is checked here. The catalogue is 33 rows in the harness and
   * unbounded in the shop, the panel has no `?sku=` uniqueness route, and a
   * client-side guess would be wrong about exactly the case the second message
   * exists for — a SKU held by something no listing shows.
   */
  sku: string;
  /**
   * Both prices as **typed**, and both are decimal strings all the way to the
   * wire.
   *
   * Never parsed into a number: `ProductInput` runs `is_numeric()` and stores
   * `(string) $payload[$field]`, and the mock's `mustBeMoney` refuses a JSON
   * number by name — *"Must be a number."* for `1200` exactly as for `"abc"`,
   * which reads oddly and is the API's own shape. `lib/format/money.ts` opens by
   * refusing to let a price a shop typed correctly be stored a millionth away
   * from itself, and this is the same rule at the form layer.
   *
   * `""` is a real value and means *no price*, which is a state the catalogue is
   * in: `AC-SEO-NOPRICE` is published with `price: ""` and `regular_price: ""`,
   * measured. So an empty box is omitted from the body rather than sent as `0`.
   *
   * **No local `sale_price <= regular_price` rule**, and that is now a decision
   * about a rule the server does keep rather than about one nobody has measured.
   * `ProductInput::validateSalePrice()` refuses the inverted pair with
   * *"Cannot be higher than the regular price."* under `fields.sale_price`,
   * **when both are stated in the same payload** — which on this form they are,
   * or neither is. The refusal is bound to the sale-price control like any
   * other; a second copy of that comparison here could only ever be a second
   * authority that drifts, which is `orders/new-order.ts`'s standing argument
   * about the three amount sentences.
   *
   * Worth flagging for the edit screen rather than fixed from here:
   * `ProductDetail`'s own docblock says *"nothing has measured whether the API
   * rejects an inverted pair"* and cites that as the reason it carries no such
   * rule. It is measured now — read from source — and on that screen there is a
   * second guard as well (`ProductService::guardSalePriceAgainstStored()`, wired
   * into `update()` and **not** into `create()`), which refuses a lone
   * `sale_price` against the *stored* regular price. Neither applies here: a
   * create has nothing stored, so a sale price with no regular price beside it
   * is accepted.
   */
  regularPrice: string;
  salePrice: string;
  /** Both carry HTML and can carry a shortcode. Sent as typed, trimmed. */
  shortDescription: string;
  description: string;
  /**
   * Category **ids**, sorted, and a `number[]` rather than the strings every
   * typed field on this object holds.
   *
   * The form-layer rule that everything is a string is about text somebody
   * types, where `""` has to stay distinguishable from `0` and `"2x"` from `2`.
   * These come from checkboxes over a vocabulary the page already fetched, so
   * there is no unparseable state to preserve. `ProductDetail`'s draft holds
   * them the same way and for the same reason.
   *
   * Sorted for `ProductDetail`'s argument about its dirty check, which does not
   * apply to a create form, and for one that does: `ProductInput` answers
   * `array_values(array_unique($ids))`, so the order the API stores is the order
   * it was sent, and a set that comes back in a different order than the drawer
   * showed is a diff nobody can read.
   */
  categoryIds: number[];
  /**
   * Whether the shelf is counted, and the count — see `buildPayload` for the two
   * ways an uncounted shelf differs from a shelf holding nothing.
   */
  manageStock: boolean;
  /** A string, like every other typed field. `""` is not `0`. */
  stockQuantity: string;
  stockStatus: StockStatus;
  /**
   * The featured image, as an attachment id **in string form**, or `""` for
   * none.
   *
   * A string because the capability fallback binds a text field straight to it:
   * a `Product Manager` or a `Manager` cannot read the media library at all, so
   * the only control they get is a box to type an id into, and a box holds text.
   * The picker writes `String(item.id)` into the same field, so the two paths
   * produce one value and `buildPayload` has one rule.
   *
   * `0` is the API's *clear the image* value and is meaningless on a create —
   * there is nothing to clear — so `""` and `"0"` both send no key at all.
   */
  imageId: string;
};

/**
 * A blank product.
 *
 * `instock` because that is what the catalogue's own default looks like — every
 * unmanaged row in the shop reads `instock` — and because a product entered by
 * somebody holding it is in stock. `manage_stock` starts **off**: 8 of the
 * shop's 28 products count nothing, counting is the exception, and a form that
 * defaulted it on would open with an empty quantity box demanding a number for a
 * shelf nobody is counting.
 */
export function emptyDraft(): ProductDraft {
  return {
    name: "",
    type: "simple",
    status: "draft",
    sku: "",
    regularPrice: "",
    salePrice: "",
    shortDescription: "",
    description: "",
    categoryIds: [],
    manageStock: false,
    stockQuantity: "",
    stockStatus: "instock",
    imageId: "",
  };
}

/**
 * A whole number of zero or more, or `null` when the text is not one.
 *
 * `null` rather than a clamp or a zero, which is `parseQuantity`'s rule in
 * `orders/new-order.ts` with the floor moved: an order line of zero is not a
 * line, and a shelf holding zero is a real and common shelf.
 *
 * Deliberately stricter than the API, in the one direction that cannot refuse
 * anything the API accepts. `ProductInput` runs `is_numeric()` then casts, so
 * `"7.9"` would reach it as `7` and `" 7 "` as `7`; this refuses the first and
 * accepts the second, because a person who typed `7.9` into a stock box did not
 * mean 7 and should be told so rather than have it rounded for them.
 */
export function parseStock(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  return Number.parseInt(text, 10);
}

/**
 * An attachment id, or `null` when the text is not one.
 *
 * `0` answers `null` here even though the API takes it: it is the *clear the
 * image* value, and a create has no image to clear. Both readings send no key.
 */
export function parseAttachmentId(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  return value > 0 ? value : null;
}

/**
 * The body of `POST /products`.
 *
 * Only what the operator actually set. Every optional key is omitted when it is
 * empty rather than sent blank, which is `orders/new-order.ts`'s rule and has
 * the same two reasons: `""` and an absent key are equivalent to the API for
 * every field here, and they are **not** equivalent to a person reading the
 * request. On a create there is a third: an omitted key is a field the API
 * defaults, and a field the API defaults is one nobody has to maintain a second
 * opinion about.
 *
 * `name`, `type` and `status` are unconditional. The first because the route
 * requires it and the drawer will not submit without it; the other two because
 * both are answers to controls that are on screen with a default this form
 * chose — see their field docblocks.
 *
 * ## Stock: three states, and only two of them have a number in them
 *
 * **`manage_stock` is false** — `stock_quantity` is dropped altogether.
 * Measured, and recorded twice already in this codebase: the API answers 200
 * with the field ignored, which looks exactly like a save that worked.
 * `ProductDetail` deletes the key from its own body for this reason rather than
 * sending it and trusting the answer, and this does the same.
 *
 * **`manage_stock` is true and the box is empty** — `null` rides, deliberately.
 * `ProductInput` preserves an explicit `null` (`$payload['stock_quantity'] ===
 * null` → `$clean['stock_quantity'] = null`), and the catalogue's own invariant
 * is the pair: *nothing being counted* and *a count of zero* are different facts
 * about a shelf, and 8 of 28 rows are the first.
 *
 * **`manage_stock` is true and the box holds something that is not a whole
 * number** — no key at all. This is the floor under `draftProblems`, which
 * catches it first so the round trip is not spent learning something the form
 * already knew, and it must not invent a `0`. `Number("2x")` is `NaN`, and
 * `JSON.stringify(NaN)` is `null` — so a builder that trusted `Number()` here
 * would send the API the *clear the count* value for text nobody meant as one,
 * and get a 200 back. That is the `?? 0` trap `orders/new-order.ts` names, in
 * the shape where it fails silently instead of loudly.
 *
 * ## The image, and why `0` is not sent
 *
 * `image_id` accepts `0`, `null` and `""` as one value — *clear the featured
 * image* — and there is nothing on a product being created to clear. So an
 * unchosen image and an id of `0` typed into the fallback both send no key,
 * which `parseAttachmentId` collapses.
 *
 * A real id is **not** validated here beyond its shape, and cannot be:
 * `ProductRepository::assertImageAttachment()` is a `get_post()` plus
 * `wp_attachment_is_image()`, and the refusal it produces — `"{id} is not an
 * image attachment."` under `fields.image_id` — is a sentence naming the id back
 * at the person who typed it, which is better than anything this file could say.
 */
export function buildPayload(draft: ProductDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: draft.name.trim(),
    type: draft.type,
    status: draft.status,
    stock_status: draft.stockStatus,
    manage_stock: draft.manageStock,
  };

  const sku = draft.sku.trim();
  if (sku !== "") payload.sku = sku;

  /*
   * The two prices, sent only on a type whose parent carries one. See
   * `VARIABLE_OMITS`: the API accepts these on a variable product and the shop
   * then never reads them back, which is the one failure mode a create form can
   * ship that nothing on any screen would ever reveal.
   */
  if (draft.type !== "variable") {
    const regular = draft.regularPrice.trim();
    if (regular !== "") payload.regular_price = regular;

    const sale = draft.salePrice.trim();
    if (sale !== "") payload.sale_price = sale;
  }

  const short = draft.shortDescription.trim();
  if (short !== "") payload.short_description = short;

  const description = draft.description.trim();
  if (description !== "") payload.description = description;

  /* Omitted when empty rather than sent as `[]`. The two are identical to
     `ProductInput` — an empty array survives `array_unique` as an empty array —
     and only one of them is a sentence about what the operator did. */
  if (draft.categoryIds.length > 0) {
    payload.category_ids = [...draft.categoryIds].sort((a, b) => a - b);
  }

  if (draft.manageStock) {
    const text = draft.stockQuantity.trim();
    if (text === "") payload.stock_quantity = null;
    else {
      const quantity = parseStock(text);
      if (quantity !== null) payload.stock_quantity = quantity;
    }
  }

  const imageId = parseAttachmentId(draft.imageId);
  if (imageId !== null) payload.image_id = imageId;

  return payload;
}

/**
 * The client-side rules, as field keys the drawer binds exactly as it binds a
 * 400's.
 *
 * Deliberately thin, and the test each rule had to pass to be here is
 * `orders/new-order.ts`'s: **would leaving it out cost a round trip to learn
 * something the form already knows for certain, or let a value nobody typed
 * reach the wire?** Everything else is the API's to say, and it says it better —
 * *"Must be one of: simple, variable."*, *"Cannot be higher than the regular
 * price."*, *"1801 is not an image attachment."* are three sentences a local
 * rule could only make vaguer or duplicate until they drift.
 *
 * Three survive.
 *
 *  1. **A blank name.** The one field `POST /products` requires, the one this
 *     form's submit button is gated on, and the only refusal a create is
 *     guaranteed to earn by pressing save on an empty drawer.
 *  2. **A stock quantity that is not a whole number**, while the shelf is being
 *     counted. Without it `buildPayload` omits the key and the product is
 *     created counting nothing, with a 201 and no mention of the box —
 *     see that function on the `NaN` → `null` path it exists to not take.
 *  3. **An attachment id that is not a number**, in the capability fallback.
 *     The same failure with the same shape: a typed word is dropped and the
 *     product is created with no image and no complaint. The picker path cannot
 *     reach this rule, because a picked id is an integer by construction.
 *
 * Keyed the way the API keys its own failures (`name`, `stock_quantity`,
 * `image_id`), so the two merge into one map and one `ErrorSummary` with no
 * translation step.
 *
 * ## The messages are the caller's, and are localised — unlike `ProductDetail`'s
 *
 * That screen's three local rules are quoted verbatim in the API's English —
 * *"A product name cannot be emptied."*, *"Must be a number."* — on the ground
 * that a field refusing locally and the same field refused by the server must
 * say the identical sentence. That argument is about a screen where both can
 * happen to one control: its rules fire on blur and the save goes anyway, so the
 * two wordings appear on the same field minutes apart.
 *
 * Here they cannot co-occur. Each of the three rules fires **instead of** the
 * request, and each covers exactly the values that would otherwise be dropped
 * before the API ever saw them — so there is no server sentence for a reader to
 * hold this one against, and the panel's own language is the right one. The
 * shape is `orders/new-order.ts`'s `draftProblems`, character for character.
 */
export function draftProblems(
  draft: ProductDraft,
  message: { name: string; stock: string; image: string },
): Record<string, string> {
  const problems: Record<string, string> = {};

  if (draft.name.trim() === "") problems.name = message.name;

  if (draft.manageStock) {
    const text = draft.stockQuantity.trim();
    if (text !== "" && parseStock(text) === null) problems.stock_quantity = message.stock;
  }

  const image = draft.imageId.trim();
  if (image !== "" && !/^\d+$/.test(image)) problems.image_id = message.image;

  return problems;
}

/** The type picker's options, in the API's own order (`ProductInput::TYPES`). */
export const CREATABLE_TYPES = PRODUCT_TYPES;

/**
 * The status picker's options, in the API's own order (`ProductInput::STATUSES`
 * is `draft, pending, private, publish`; `PRODUCT_STATUSES` is that set in the
 * order the filter tabs use).
 *
 * **All four, and `trash` is not among them** — it is readable and not writable,
 * a product is trashed by `DELETE`, and `?status=trash` is a 400.
 * `lib/product-status.ts` is the one list and this is a re-export rather than a
 * second copy, so a status added to the API is added in one place.
 */
export const CREATABLE_STATUSES = PRODUCT_STATUSES;

/** The stock picker's options — `ProductInput::STOCK_STATUSES`, all three. */
export const CREATABLE_STOCK_STATUSES = STOCK_STATUSES;
