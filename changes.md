# Changes

Eight items, each split into **backend** (`../ecom-temp`, the `algerian-commerce-core` plugin) and
**admin app** (this repo). They are ordered: 1–2 touch the same order screens, 3–4 the same product
screens, so they land in sequence and never in parallel. Reference implementation for both is the EL stack at
`/mnt/c/Users/MyHomehP/Desktop/work/EL` — `api` (Spring), `el-admin-app`, `el-user-app`.

Decisions already taken, so they are not re-litigated below:

- Manual price covers **line unit price *and* shipping cost**; the order total is recomputed
  server-side from lines + shipping and is never sent by a client.
- The parcel is created **when the order is confirmed**, not at checkout. Automatic either way — no
  manual parcel creation per order — but an abandoned or fake order never reaches a courier.
- The shipping cost shown to a shopper is the **courier's live quote, falling back to the shop's own
  tariff rules** when the courier is off or unreachable.
- Manual price is allowed to **anyone holding `ac_manage_orders`**, and every manual price is
  **audited** against the catalogue price it replaced.

---

## 1. Update an order, and a manual price on create and update

### What already exists

- **Backend already updates orders.** `PATCH /orders/{id}` accepts `status`, `customer_id`,
  `billing`, `shipping`, `line_items`, `payment_method`, `payment_method_title`, `customer_note` —
  `ecom-temp/…/src/Orders/OrderInput.php::allowedFields()`. Line items are additionally gated on
  `is_editable` (`OrderService::guardLineItemsWritable()`), i.e. only while the order holds no stock.
- **The panel never built the UI.** [OrderActions.tsx](app/[locale]/(panel)/orders/[id]/OrderActions.tsx)
  sends `{status}` and nothing else; [OrderItems.tsx](app/[locale]/(panel)/orders/[id]/OrderItems.tsx)
  is deliberately read-only because the line-item write contract was never measured.
- `PATCH /orders/\d+` is already on the proxy allowlist ([lib/api/allowlist.ts:59](lib/api/allowlist.ts#L59)),
  so no allowlist change is needed for the edit form.
- **Manual price is currently refused by design.** `Orders/LineItemInput.php` answers
  `line_items.0.price` → *"Line prices come from the catalogue and cannot be set."* The stated threat
  is a compromised admin session writing an order at a price of nothing. EL has no such rule —
  `OrderService.create()` stores whatever `unitPrice` the client sends
  (`EL/api/…/service/OrderService.java:196`) — so this is a decision being reversed, not a gap.

### Backend steps

1. **Measure `PATCH /orders/{id}` against the live API** for `billing`, `shipping`, `line_items`,
   `payment_method`, `customer_note`. Everything currently written about this route in
   `ADMIN_PANEL.md` and `scripts/mock-api.mjs` covers `status` alone; the rest is transcribed, not
   observed. Record the real refusals before a form is built on them.
2. **Add `price` to `LineItemInput`**, on create and update. Rewrite the docblock: the field exists
   now, and the comment must say why it exists and what guards it rather than that it never will.
   Refuse a negative price and a price on a line the caller did not otherwise change.
3. **Recompute the order total server-side** from `sum(price × quantity) + shipping_total`. `total`,
   `subtotal` and `shipping_total` stay in `OrderInput::READ_ONLY` — a client still never states a
   total. EL recomputes the same way in `OrderService.update()` (`itemsTotal.add(shippingCost)`)
   because its admin app round-trips a stale total; ours must not depend on that.
4. **Add a settable shipping cost** on create and update — one amount on the order, written as the
   order's shipping line. Today the shipping line only ever comes from the checkout quote
   (`Cart/CheckoutService::createOrder()`); a back-office order has no way to carry a delivery fee at
   all.
5. **Audit every manual price.** `order.updated` already records `before`/`after` snapshots
   (`Orders/OrderService::update()`); extend the snapshot so a line's catalogue price and the price
   actually charged are both in the record, and emit the same for `POST /orders`. A discount nobody
   can attribute is the reason the gate was there in the first place.
6. Keep the `is_editable` gate on line items. A manual price on an order whose stock has moved is a
   refusal, not a correction.

### Admin app steps

1. **Build the order edit form** on the detail screen — customer, billing and shipping addresses,
   payment method and title, customer note. Same `Form`/`ErrorSummary` binding the create drawer
   already uses; reuse `bindRefusals()` from [new-order.ts](app/[locale]/(panel)/orders/new-order.ts)
   for the "same as billing" folding.
2. **Line-item editor on the detail**, enabled only while `is_editable` is true, with the existing
   footnote as the disabled reason. Add, remove, re-quantity — the routes are already allowed.
3. **Manual price field per line**, on the create drawer and the edit form. Prefill from the
   catalogue and let it be overwritten, exactly like `EL/el-admin-app/src/components/orders/CreateOrderModal.jsx`
   (`unitPrice` seeded from `selectedBook.price`, then editable). Show the catalogue price beside the
   field when the two differ, so an override reads as an override.
4. **Editable shipping cost** on both forms, prefilled from the rate lookup (item 2 below) and
   overwritable — EL's `formData.shippingCost`, which its delivery-fee call fills and the operator can
   still change.
5. **Draw the total from the server's answer**, never from the form.
   [new-order.ts](app/[locale]/(panel)/orders/new-order.ts) currently computes no money at all and
   that stays true: the form shows lines and a shipping cost, the 201/200 shows the total.
6. Extend `buildPayload()` and `draftProblems()` for the new fields, and the unit suite in
   `tests/new-order.test.ts` with them.

---

## 2. Carrier choice at checkout, dynamic shipping cost, and no manual parcel step

### What already exists

- **The storefront checkout exists in the backend**: `GET /cart`, `POST /cart/coupons`,
  `GET /checkout/shipping-rates`, `POST /checkout` (`ecom-temp/…/src/Cart/`).
- **`GET /checkout/shipping-rates` already quotes per courier** for a destination —
  `CheckoutService::quotes()` resolves the shop's tariff once per registered provider. So a shopper
  can already be shown a price that changes with wilaya and commune.
- **`POST /checkout` gives the shopper no carrier choice.** `CheckoutService::requireShippingQuote()`
  sorts the quotes and silently takes the cheapest. There is no `shipping_provider` argument on the
  route (`Cart/CheckoutController::registerRoutes()`).
- **No parcel is ever created automatically.** The only way a shipment exists is
  `POST /orders/{id}/shipments`, driven by hand from
  [CreateParcelDrawer.tsx](app/[locale]/(panel)/orders/[id]/CreateParcelDrawer.tsx).
- **Both couriers are already implemented** — `ecom-temp/…/integrations/Yalidine/YalidineProvider.php`
  and `integrations/ZRExpress/` — with `getShippingRates()` (Yalidine calls the live `fees/`
  endpoint), `createShipment()`, `cancelShipment()`, status polling, webhooks and destination sync.
  They are switched off by `ENABLE_YALIDINE` / `ENABLE_ZR_EXPRESS`, which is why
  `GET /shipping/providers` reports `manual` alone.
- **The admin rate route already blends both sources.** `ShippingService::rates()` returns the tariff
  quote *and* `getShippingRates()` per provider. The public checkout route does not — it is tariff
  only. That asymmetry is the actual gap.

### Backend steps

1. **Turn the couriers on.** Credentials and `ENABLE_YALIDINE` / `ENABLE_ZR_EXPRESS` in the
   environment, then `wp algerian-commerce sync-destinations` so wilaya/commune ids map to each
   courier's own ids — `YalidineProvider::getShippingRates()` returns `[]` for any destination it has
   not mapped, and a checkout would silently fall back to the tariff forever.
2. **Make `/checkout/shipping-rates` quote the couriers live.** Have `CheckoutService::quotes()` call
   `getShippingRates()` per provider like `ShippingService::rates()` does, and fall back to the
   `RateResolver` tariff for any provider that returns nothing. Label each quote with which of the two
   it came from — EL carries exactly this as `deliveryFeeMethod: AUTOMATIC | FIXED` plus
   `deliveryFeeProvider` on the order (`EL/api/…/domain/enumeration/DeliveryFeeMethod.java`), and the
   same two fields belong on ours, because an operator looking at an old order needs to know whether
   that number came from a courier or a rule.
3. **Add `shipping_provider` to `POST /checkout`.** Validated against the providers that actually
   serve the destination; when it is absent, keep today's cheapest-wins behaviour so an existing
   caller does not break. Replace the blind `usort` in `requireShippingQuote()` with "the quote the
   shopper chose, or the cheapest".
4. **Add the same choice to `POST /orders`** — a `shipping_provider` (and the shipping cost from step
   1 of item 1) on a back-office order, so an order entered by phone records which courier will carry
   it.
5. **Create the parcel on confirmation.** When an order moves to `processing` (our `CONFIRMED`) and it
   carries a provider and has no live shipment, call the provider's `createShipment()` and store the
   tracking number and label URL on the order. EL does this in `OrderService.updateStatus()` /
   `update()` via `createShippingParcel()`, and two details there are worth copying exactly:
   - **it never throws** — a courier failure returns an error string on the response
     (`shippingProviderError`) and the status change still commits, so a courier outage cannot block
     the order book;
   - **it retries** — the guard is `trackingNumber == null`, so an order rejected by the courier
     (bad commune, say) creates its parcel on the next confirm after the operator fixes the address.
6. **Keep `POST /orders/{id}/shipments`** as the manual fallback, for the order the automatic step
   refused and for the shop running `manual` delivery.

### Admin app steps

1. **Carrier step in the create drawer.** A provider picker in
   [NewOrderDrawer.tsx](app/[locale]/(panel)/orders/NewOrderDrawer.tsx), sourced from
   `GET /shipping/providers`, offering only the couriers that serve the chosen wilaya/commune —
   `EL/el-user-app/src/pages/CartCheckoutPage.jsx` does exactly this (`getAvailableProviders(wilaya)`,
   with a fall back off ZR to Yalidine when ZR does not serve the wilaya).
2. **Destination fields in the create drawer.** Wilaya and commune pickers, from
   `/locations/wilayas` and `/locations/wilayas/{id}/communes` — both already allowlisted and already
   used by the parcel drawer. Without them nothing can be quoted, and today the create drawer collects
   a free-text address only.
3. **Live shipping cost in the drawer.** Debounced call to the rate route on
   (wilaya, commune, provider, delivery type) change, filling the editable shipping cost field. EL
   debounces at 600 ms and falls back to a fixed fee on failure
   (`CartCheckoutPage.jsx`, `CreateOrderModal.jsx`); do the same rather than blocking the save.
4. **Show the parcel that confirmation created.** On the order detail, surface the tracking number,
   the label and — when the courier refused — the error the API returns, rather than leaving an
   operator to guess why no parcel appeared. EL raises this as a toast on the status change
   (`EL/el-admin-app/src/pages/Orders.jsx::handleUpdateStatus`).
5. **Demote the parcel drawer to a fallback.** Keep
   [CreateParcelDrawer.tsx](app/[locale]/(panel)/orders/[id]/CreateParcelDrawer.tsx), but only offer it
   when the order has no live shipment — it stops being the normal path.
6. Update the mock: `scripts/mock-api.mjs` must grow the new `POST /checkout` and `POST /orders`
   fields, the per-provider live quote shape, and the confirm-creates-a-parcel behaviour, or none of
   the above is testable here.

### Storefront

Not in this repo. The steps above are the backend contract it needs — a rates call that quotes each
courier live and a `shipping_provider` on checkout. `el-user-app`'s `CartCheckoutPage.jsx` is the
working example of the screen that consumes it.

---

## 3. Create a product, and set its image on create and update

### What already exists

- **The backend already does all of it.** `POST /products` is registered
  (`ecom-temp/…/src/Products/ProductController.php`), alongside `POST /products/bulk` and
  `POST /products/{id}/duplicate`. `ProductInput` accepts `image_id` and `gallery_image_ids` on both
  create and update, and `POST /media` is the upload. **No backend work is needed for this item.**
- **The panel cannot create.** `POST /products` is deliberately off the allowlist
  ([lib/api/allowlist.ts:75](lib/api/allowlist.ts#L75)) on the rule that a route no screen reaches is
  a route nobody can reach by guessing a URL, and
  [ProductsList.tsx:535](app/[locale]/(panel)/products/ProductsList.tsx#L535) says so where the
  primary action would be.
- **The edit form does not touch images.** `image_id` and `gallery_image_ids` were both *measured
  writable* and are deliberately absent from what
  [ProductDetail.tsx:81-83](app/[locale]/(panel)/products/[id]/ProductDetail.tsx#L81-L83) sends,
  because nothing on that screen edits them and a field a form sends but never shows is a field it can
  silently clobber.
- **A picker already exists.** [MediaPicker.tsx](components/ui/MediaPicker.tsx) is a panel, not an
  overlay — `BannerDrawer` renders it as a *step inside its own drawer*, which is the pattern to copy.
  `POST /media` and `GET /media` are both already allowlisted, and `UploadModal` already uploads.

### Admin app steps

1. **Allowlist `POST /products`** and rewrite the comment above it: the rule is that a route is
   allowed when a screen reaches it, so the entry lands with the screen and the note says which screen.
2. **Build the create form.** A `Drawer` from the products list's primary, like `NewOrderDrawer` — the
   core fields only: name, type, status, SKU, prices, both descriptions, categories, stock. On 201,
   route to the new product's detail, which is where variations, options, attributes and SEO already
   live. A create form that tried to carry all of those is the reason this screen was never built.
3. **Separate the draft from the markup**, as `new-order.ts` is separated from `NewOrderDrawer` — a
   `buildPayload()` plus a `draftProblems()` unit-tested in `tests/`, not eleven `fireEvent`s.
4. **Image step in the create drawer.** Reuse `MediaPicker` as a step (swap the form for the picker
   and back), setting `image_id`; offer `UploadModal` from inside it so an image that is not in the
   library yet can be added without leaving the form.
5. **Image and gallery on the edit form.** Add `image_id` and `gallery_image_ids` to
   `ProductDetail`'s explicit writable list, with the same picker for the main image and a
   multi-select for the gallery — the field list must stay explicit rather than derived, for the
   reason its docblock already gives.
6. **Handle the capability gap.** Media is `ac_manage_content`; products are `ac_manage_products`, and
   a **Product Manager holds the second and not the first** — so the picker answers 403 for exactly
   the role whose job products are. `MediaPicker` already renders a `ForbiddenState`, so the form must
   degrade to an attachment-id field that says why, the way the order drawer degrades for
   `Order Manager`. Widening `ac_manage_content` is not the fix; if this bites often, the backend
   answer is a `/products/eligible-media` behind `ac_manage_products`, the
   `/coupons/eligible-products` precedent.
7. **Mock and tests.** `scripts/mock-api.mjs` needs `POST /products` with the refusals the live API
   gives (a missing name, a duplicate SKU, an `image_id` that is not an attachment), and
   `tests/boundary.test.ts` needs the allowlist change asserted.

---

## 4. Attributes and variations in the panel

Sizes, colours, storage capacities — the shop's own vocabulary, and the products built out of it.
Follows item 3: a create form is not much use while the thing it creates cannot be given a size.

### What already exists

- **The backend has every route, all behind `ac_manage_products`.** `GET/POST /attributes`,
  `GET/PATCH/DELETE /attributes/{id}`, `GET/POST /attributes/{id}/terms`,
  `PATCH/DELETE /attributes/{id}/terms/{term_id}`, and full CRUD on `/products/{id}/variations` and
  `/products/{id}/variations/{variation_id}`. **No backend work is needed for this item either.**
- **`POST /products/{id}/duplicate` copies a product with its variations** —
  `ProductService::duplicate()` audits `variations_copied`. This is the fastest way to add the
  fortieth phone and it has no caller in the panel.
- **The panel reads and never writes.** The allowlist carries `GET /attributes`,
  `GET /attributes/\d+/terms` and `GET /products/\d+/variations`
  ([lib/api/allowlist.ts:77-80](lib/api/allowlist.ts#L77-L80)) — the write methods and the two
  `POST` collection routes are all absent, and
  [ProductDetail.tsx:774](app/[locale]/(panel)/products/[id]/ProductDetail.tsx#L774) says
  `POST /products/{id}/variations` is refused by the panel's own list.
- **There is no bulk variation route.** One `POST` per variation; 2 storage × 3 colours is six calls.
  The API will not grow a generate-combinations endpoint for this — the panel makes the calls.

### Admin app steps

1. **Allowlist the writes**: `POST /attributes`, `PATCH`/`DELETE` on `/attributes/{id}`,
   `POST /attributes/{id}/terms`, `PATCH`/`DELETE` on a term, `POST /products/{id}/variations`,
   `GET/PATCH/DELETE /products/{id}/variations/{variation_id}`, and
   `POST /products/{id}/duplicate`. Each entry lands with the screen that reaches it, and
   `tests/boundary.test.ts` asserts the set.
2. **Attributes screen.** A list of attributes with their terms — create an attribute ("Colour"),
   add terms to it ("red", "blue"), rename, delete. Set up once per shop, not per product. This is
   also the screen `ProductDetail` already defers to: editing a product's `attributes` is deliberately
   not on the product form because a partial list wipes a variable product's variation mapping.
3. **Attach attributes on the product.** On the product detail, choose which attributes this product
   uses, which terms of each, and which of them drive variations — the WooCommerce distinction that
   also decides whether something is a *spec* (shown, filterable) or a *variant* (its own SKU, price
   and stock).
4. **Variations editor.** A table under the product: each row a combination, with its own price, SKU
   and stock. Add, edit, delete — the routes are per-variation, so the table writes a row at a time.
5. **Generate combinations, in one button.** The panel fans out one `POST` per missing combination and
   reports what it made. Cap it and say so before firing — five attributes of six terms is 7,776
   products' worth of rows, which is the case `OptionSet` exists to keep people out of.
6. **Duplicate action on the product list and detail.** One call, lands on the copy's detail. For a
   shop selling one kind of thing this is the create path, not an afterthought.
7. **Mock and tests.** `scripts/mock-api.mjs` needs the attribute and term writes, the variation CRUD
   and `duplicate`, with the refusals the live API gives — a term on an attribute that does not exist,
   a variation whose attribute the parent does not offer, a duplicate SKU.

> **Not in scope here: presets.** Saving "clothing = Colour + Size" once and applying it to a new
> shop is a separate feature and needs real backend work — new storage and new routes, nothing like
> it exists today. It is a time-saver on top of this item, worth doing only once this one is in use.
> `Products/OptionSet.php` already names the trigger for it: one definition shared across many
> products, edited once.

---

## 5. A drawn date picker

### What already exists

- **One component, seven callers.** `DateField` in
  [components/ui/Form.tsx:660](components/ui/Form.tsx#L660) is the only date control in the panel;
  the coupon expiry, notifications, audit, payments, inventory movements, `RangeControl` and
  `FilterBar` all go through it. Replacing it once replaces it everywhere.
- **It is a native `<input type="date">` on purpose**, and `Form.tsx` argues the case: the platform
  picker is already localised, already keyboard navigable, and a phone renders it as a wheel.
  `ImportSection` and `FileField` restate the same policy for `<select>` and file inputs — replacing
  UA chrome costs the control's own keyboard behaviour on two engines.
- **That policy is already half-reversed.** [components/ui/Listbox.tsx](components/ui/Listbox.tsx) is
  the drawn single-select — Radix for behaviour, every visual property ours — and its docblock spells
  out why: a `<select>`'s open list is unstyleable on every engine, so the panel had two visual
  systems and the OS's one appeared exactly when somebody was choosing. **This item is that same
  argument applied to the last control still wearing the user agent's paint.**
- **The native control has a measured defect this fixes.** A date input follows the *browser's*
  locale and no attribute changes it — the Arabic panel renders `mm/dd/yyyy`, a US ordering in a
  right-to-left screen, and Chromium was measured on 2026-08-19 ignoring `lang`. `DateField` works
  around it by echoing the value underneath in the page's own language.

### Admin app steps

1. **Build `DatePicker` on Radix Popover + a drawn calendar grid**, the way `Listbox` is built on
   Radix Select: the library supplies focus management, the portal, collision detection and dismissal;
   every visual property is the panel's own tokens. Keep the trigger inside `FieldFrame` so the label,
   hint, error frame and `aria-describedby` wiring are unchanged.
2. **Keep the contract identical** — `Y-m-d` in, `Y-m-d` out, blur-latched validation, `dir="ltr"` on
   the value display. Every caller then swaps with no other change, and the coupon expiry's
   `expiryInputValue()` asymmetry stays exactly as it is.
3. **Format the date in the page's locale**, which is the whole point: `intl` in French and Arabic,
   Sunday/Monday week start and month names from the locale rather than the browser's.
4. **Delete the `echo` readback** once the control reads correctly in both languages — it exists only
   to compensate for the format nobody could change, and leaving it turns into the date printed twice.
5. **Do not lose what the native control gave.** Type a date with the keyboard without opening the
   calendar, arrow keys within the grid, Escape to dismiss, a 44px target at the 340px floor, and the
   RTL mirroring `Listbox` already solves. Test all of it in Arabic — that is where this control has
   always failed first.
6. **Then apply the same to the rest of the app**: `RangeControl`'s two fields and every filter bar
   pick up the new control through `DateField`'s replacement, so the sweep is one import, not seven
   rewrites. The file input stays native — `FileField`'s docblock argues that separately and this item
   does not overrule it.

---

## 6. Real pickers for the segment criteria

### What already exists

- **Eleven criteria, fixed and validated backend-side** — `Campaigns/SegmentCriteria.php::FIELDS`:
  `min_spent`, `max_spent`, `min_orders`, `max_orders`, `ordered_after`, `ordered_before`,
  `registered_after`, `registered_before`, `wilaya_id`, `bought_product_id`,
  `not_bought_product_id`. Seven more are refused by name (`email_contains`, `consent`, …) and must
  stay unreachable. **No backend work for this item.**
- **Only the criterion *name* is a picker.** In
  [SegmentModal.tsx](app/[locale]/(panel)/marketing/segments/SegmentModal.tsx) the `Select` chooses
  which criterion to add; every criterion's **value** is a bare `TextField`. So a wilaya is typed as
  `16`, a product as `2481`, and a date as free text with no calendar.
- **Every lookup the values need is already allowlisted**: `/locations/wilayas` for the wilaya, and
  `/products` — or `/coupons/eligible-products` — for the two product ids.

### Admin app steps

1. **Render each criterion by its kind**, not all as text: `wilaya_id` → the wilaya picker the parcel
   drawer already uses; `bought_product_id` / `not_bought_product_id` → a product search; the four
   date criteria → the drawn date picker from item 5; money and counts stay numeric fields.
2. **Show the name, store the id.** The value on the wire is still an integer — the picker only
   changes what the person reads while choosing it.
3. **Use `/coupons/eligible-products` when `/products` is forbidden.** Marketing is
   `ac_manage_marketing`; the catalogue is `ac_manage_products`, and a Marketing Manager holds the
   first and not the second — the exact gap the coupon pickers were added for. Same degradation as
   everywhere else: fall back to a plain id field that says why.
4. **Keep the refused criteria unreachable.** The picker offers the eleven and nothing else; that
   property is what keeps `consent` and `email_contains` off this screen, and it must survive the
   rewrite.

---

## 7. A campaign body written as a form, not as HTML

### What already exists

- **The composer asks for HTML and plain text, by hand, twice.** `body_html` and `body_text` are both
  real and both are sent — HTML for normal clients, text as the fallback that also lowers spam
  scoring — so neither can be dropped. What can go is the *typing*.
- **The sanitiser runs on save and is strict**, `Campaigns/EmailHtml.php::ALLOWED`: tables, `p`,
  headings, lists, `span`, `div`, `a`, `img`, `hr`, and inline `style` on nearly all of them.
  **No `<style>` block, no `<head>`, no `class` attribute** — all stripped silently, on save, into the
  database. Anything the generator emits outside that list is gone with no error.
- **A campaign accepts a fixed field list** — `Campaigns/CampaignInput.php::KNOWN`: `name`, `subject`,
  `template_id`, `body_html`, `body_text`, `audience_type`, `customer_ids`, `segment_id`. Any other
  key is a 400. **This is the one place the item needs the backend.**
- `template_id` and `GET /email-templates` exist, but templates are authored in wp-admin and are
  read-only over the API, so the generator belongs in the panel where it can ship with the product.

### Backend step

1. **Accept a `body_fields` JSON blob on a campaign** — the form's own answers, stored as campaign
   meta and echoed back on read. Without it the form is single-use: reopening a saved campaign gives
   back HTML and no way to re-edit the fields, and "undo to the template" cannot survive a reload.
   It is the only backend change in this item, and everything else works without it (session-only
   undo), so it can land second if needed.

### Admin app steps

1. **One pure generator**: form values in, `{html, text}` out. A plain function beside the composer,
   unit-tested like `new-order.ts` — no markup, no requests. The text body is generated from the same
   values, **not** by stripping tags out of the HTML.
2. **The form**: logo (media picker), brand colour, subject, title, paragraphs, one call-to-action
   (label + link), an optional image, footer text. Two or three optional blocks that can be toggled on
   and off in a fixed order — not a drag-and-drop builder, which is a different and much larger thing.
3. **Prefill the branding from shop settings** — the store logo and colour — so a client's first
   campaign already looks like their shop with nothing configured.
4. **The layout is single-column, table-based, inline-styled and fluid.** No media queries are
   possible, so it must look right at every width rather than rearranging between two. Verify by
   saving and reading back: whatever the sanitiser removed is removed silently.
5. **Both bodies stay editable**, with an "edited by hand" flag once either is touched.
   **Undo regenerates from the fields** and warns before overwriting manual edits.
6. **Merge tokens come from the generator**, offered as a list to insert rather than typed — which is
   what makes item 8 safe to fold away.

---

## 8. Fold the preview into the composer

Delete the step, keep the call. The wizard loses a page; the check it existed for survives and finally
shows what the email looks like.

### What already exists

- **`GET /campaigns/{id}/preview` is the useful half.** It renders subject, HTML and text for a sample
  recipient and returns **`unknown_tokens`** — the merge fields that were typed wrong. An unknown
  token renders *empty*, so `{{firstname}}` is 5,000 mails beginning "Bonjour ,". That warning is the
  only thing that catches it.
- **The step shows the HTML as source, deliberately**
  ([Steps.tsx](app/[locale]/(panel)/marketing/campaigns/[id]/Steps.tsx), `StepPreview`) — the argument
  being that a browser render is not a mail client's and invites treating the panel as a WYSIWYG. True,
  and still not a reason to show raw markup to a shopkeeper.
- **The test send already answers "what will Gmail do?"** — `POST /campaigns/{id}/test`, one real
  message to one real address, writing no recipient row. It stays as the final step.

### Admin app steps

1. **Remove the preview step** from the wizard and renumber what follows.
2. **Render the preview inside the compose step** — a sandboxed `iframe` with `srcdoc`, beside or
   under the form, refreshed from the saved campaign as the other steps already do. The HTML is
   sanitised on save, so rendering it is safe; the sandbox is belt and braces.
3. **Keep `unknown_tokens` as an inline warning** on that same step, next to the body it belongs to,
   rather than on a page of its own.
4. **Say what the render is and is not** in one line: this browser's drawing of the mail, and the test
   send is the real thing.
5. Update `e2e/campaigns.spec.ts` and any screenshot script that walks the old step order.

---

# Issues carried forward

Written after each step completes. These are things found and **not fixed** — either
out of the step's scope, blocked, or deliberately left with the reasoning recorded. Each
says where the detail lives so nobody re-derives it.

## After step 1

### Blocked on a human

- **The HTTP half of "measure `PATCH /orders/{id}`".** The instance is up and answers
  **401**; no Application Password exists in either repo. The *field* contract was
  measured in-process via `rest_do_request()` instead, which is not the same thing and
  is never described as if it were. What remains unmeasured: authentication over the
  wire, capability enforcement against a real `Authorization` header, CORS preflight,
  nonce/cookie handling, rate limiting, and reverse-proxy treatment of a PATCH body or a
  409. See `BLOCKED.md`.

### Deliberately left open, with the argument recorded

- **The quantity is not gated.** The stock guard refuses a manual *price* on an order
  holding stock; four kettles becoming forty moves the total by 54 000 DZD with no manual
  price anywhere. Reading (A) of backend step 6 would have closed this by tightening
  `is_editable`, which would break the amendment flow `guardLineItemsWritable()` exists to
  protect. Asserted as a known leak in `tests/Api/orders.php`.
- **Dropping a hand-priced line** states no price, so nothing refuses it, and the money
  leaves with the line. Same guard, same reason.
- **The delivery fee reaches one status the goods do not.** A stock-holding `on-hold`
  order refuses a line reprice and accepts a fee up to the ceiling. Delivery moves no
  units and is characteristically settled after dispatch; every fee through it is
  audited. Backend step 6 handed this back rather than revising step 4's decision — it is
  a one-line change plus its argument if the call goes the other way.
- **The API validates a country only by shape** — `^[A-Z]{2}$`, so `ZZ` is accepted, 200.
  The panel runs the same shape rule locally and says in a hint that the code is stored as
  typed and not checked against a list of real countries. No 249-row table was invented.

### Real defects found, not fixed

- **`billing.email` can produce a 400 with no `details.fields` at all.** `AddressInput`
  validates with `filter_var()`, WooCommerce validates again with `is_email()`, and they
  disagree on `a@b.c` and `a@[127.0.0.1]`. The address clears validation, then
  `set_billing_email()` throws and the response carries the exception's own message with
  an empty details array. Nothing is written — the PATCH rolls back — so it is a display
  gap, not a data one, and the panel now renders a `details`-less 400 as an unlinked
  summary line. **The backend source was left alone**; recorded in the plugin README.
- **`AddressInput.php`'s docblock is wrong about its own hole.** It says the two
  validators "disagree only on addresses neither a customer nor a courier will ever use".
  They disagree on `a@b.c`. Recorded, not edited.
- **`OrderLinesDrawer.addLine`'s merge rule never matches.** It merges on
  `price.trim() === ""`, which with catalogue prefill is never true for a picker-added
  row — so pressing add twice on the detail editor opens two rows instead of setting
  quantity 2. The create drawer's equivalent matches on product *and* seeded price and
  does not have this. Acknowledged in its docblock.
- **Three copies of one money validator.** `LineItemInput::amount()`,
  `OrderInput::amount()` and `ShippingRuleInput::money()` now encode the same rule three
  times. The right fix is one shared validator; that is a refactor with its own argument,
  not a side effect of adding a field.

### Mock divergences from the live API, named rather than hidden

- `postOrder` answers `"No customer with that id."`; source says `"No user with id {N}."`
  — and it validates in the field batch where the backend validates in the repository
  after line resolution. Fixing the string alone would be half a fix.
- `postOrder`'s 409 is `An order cannot be created as {status}.`; source is
  `A new order cannot be created as "{status}".`
- The mock refuses re-setting an order's *current* status with a 409 where the real API
  answers 200 as a no-op. Pre-existing, on `OrderActions`' control.

### New surface nobody has confirmed they want

- **`shipping_amount` and per-line `price` now reach the customer-facing payload.**
  `AccountService` presents the full `OrderPresenter` shape unfiltered, so a shopper
  reading their own order sees what was hand-priced and what the delivery fee was stated
  as. Not a secret, but it is new surface.

### Test suites not run, or failing before this work

- **e2e was not run.** `npm run test:e2e` needs live credentials nobody has here — the
  same block as the HTTP measurement.
- **Pre-existing backend failures, reproduced on a stashed pristine tree and untouched:**
  `account` 1 and `cms` 1 (both `store.storefront_url` unset in this dev database),
  `seed` 2, and `analytics` 8–9 (a stale aggregate cache).

## After step 2

### Blocked on a human

- **Courier credentials and `sync-destinations`.** All eight variables
  (`ENABLE_YALIDINE`, `YALIDINE_API_ID/TOKEN/WEBHOOK_SECRET`, `ENABLE_ZR_EXPRESS`,
  `ZR_EXPRESS_TENANT_ID/API_KEY/WEBHOOK_SECRET`) are present and empty; `shipping-check`
  reports `manual` as the only provider. Credentials are issued by the couriers to an account
  holder and `sync-destinations` calls their live APIs, so neither can be produced here.
  **Every courier path in this step is therefore verified against a test double and the
  interfaces as read from source. No courier API was contacted.** `BLOCKED.md` lists what to
  re-check when it clears — chiefly whether `getShippingRates()` returns the assumed shape for a
  real destination, whether a courier serving a wilaya but not a commune returns `[]` or an
  error, and the retry path, which needs a courier that can actually reject.
- **Consequence worth stating plainly:** the multi-courier shape exists **only in the mock**,
  behind `MOCK_COURIERS=on`, and **its courier prices are invented from a formula.** The default
  mock arm stays byte-identical to the live install.

### Real defects found, not fixed

- **`GET /shipping/rates` does not swallow courier exceptions**, unlike `ShopperRates`, which
  catches `ApiException` and then `Throwable`. A courier that throws takes the whole admin rate
  request down, tariff included. Unreachable today (no courier registered), but it is what the
  admin route does and the checkout route no longer does.
- **`ShippingService::create()`'s fourth reason is now stale on its own branch.** It justifies
  keeping the manual route partly because "`POST /orders` has no field that writes [wilaya and
  commune]". The same branch closed that. The reason survives in the narrower form
  `ShipmentSubscriber::destinationOf()` already uses — "an order nobody has addressed" — and the
  panel's own wording uses the narrow form, but the backend docblock still carries the wide one.
- **The mock does not write the `shipment.create_failed` audit row** the real subscriber writes
  alongside the order field. Nothing in the panel reads it for this purpose, and a row per
  confirmation would move the audit screen's counts on every write. Named in the mock.
- **The de-registered-courier exemption is implemented but not asserted.**
  `guardShippingProviderKnown()` lets an order always restate the courier it already names, so
  switching a courier off does not 400 every historical order. The panel suite cannot reach it —
  `resetState()` rebuilds the registry and destroys the order that would name one.

### Deliberately not done, with the argument recorded

- **The picker does not filter couriers by destination**, which is the literal wording of admin
  sub-task 1. The API's definition of "serves" is *produced a quote row*, and filtering on it
  would hide `manual` — whose `getShippingRates()` returns `[]` by design — from every
  destination without a tariff rule, and would refuse what `POST /orders` accepts, since that
  route validates a courier against registration rather than destination. Couriers with no price
  are marked, not removed. The step's citation for filtering, EL's `getAvailableProviders()`, is
  a hard-coded list of four wilayas rather than a coverage API.
- **`details.commune_wilaya_id` is bound as a message, not as a "move the selection" offer.**
  `DestinationFields` clears the commune whenever the wilaya moves and lists communes only for
  the chosen wilaya, so every pair either form can submit is one the geography table itself
  paired — the refusal is structurally unreachable from these controls. The mock produces the
  shape so a later caller has it.
- **`shipping_provider`'s registration-only validation is now re-examinable and was left alone.**
  Its justification cited a back-office order having "no structured destination to quote
  against", and that clause is now false. The conclusion still holds for other reasons — a quote
  needs a *cart* for the free-delivery threshold, and `manual` returns `[]` everywhere — but a
  check against `ac_geo_provider_destinations` is newly possible and was not taken.
- **No cron sweep behind the confirmation hook.** It is the better answer to a missed
  transition, but WP-Cron would delay every parcel by up to an hour. Addable on top.

### Corrected on the way

- Two backend docblocks claimed the longest adapter name is `zr_express` at ten characters;
  `ZRExpressProvider::NAME` is `zrexpress`, nine. `MAX_PROVIDER = 40` was **not** sized from the
  wrong figure. The live `zr_express` strings that remain are legitimate — one is the
  `ENABLE_ZR_EXPRESS` feature-flag key, which is how the confusion arose.
- The mock served the commune route as paginated on its own inference from its caller;
  `LocationController::searchArgs()` declares no pagination. The mock's rate route also quoted
  the *rule's* provider rather than the one being quoted, skipped the journey filter so a desk
  collection got the doorstep tariff, and omitted `delivery_type`.
- Two latent backend bugs, fixed rather than inherited: `replaceShippingLine()` unconditionally
  cleared `method_id`, which became destructive the moment the checkout began writing a real
  courier there — any fee correction silently un-assigned the courier; and checkout resolved
  rules only for provider `''`, so provider-scoped rules were invisible at checkout while the
  admin route honoured them.

### Still open from step 1

Everything in the step 1 section above remains true. The pre-existing backend failures are
unchanged and unchased: `account` 1, `cms` 1, `seed` 2, `analytics` 8.

## After step 3

No backend work was needed and none was done. Nothing here is blocked on a human.

### The step's own premise was wrong

- **`Product Manager` is retired.** The step says "a Product Manager holds the second and not the
  first". That role exists but `Users\UserRoles::assignable()` returns `[ac_super_admin,
  ac_manager]` — so the live case is **Manager**, which also holds `ac_manage_products` without
  `ac_manage_content`, and which is **the only non-administrator role this API still hands out**.
  The media fallback is therefore the ordinary path for the ordinary user, not a guard against a
  role nobody has. Both product screens were built accordingly.
- **"the refusals the live API gives"** could not be honoured as written — no live API answers
  here. The mock reproduces the **source's** refusals and says so; nothing claims a measurement.
- **The step implies `UploadModal` can be offered from inside the picker.** §3.1 forbids a modal
  over a drawer, so it became a third step in the drawer and `components/ui/MediaUpload.tsx` was
  extracted. On the detail *route* the same reasoning gives the opposite answer and it stays a
  modal — argued in both files rather than made uniform.

### Known limitations, named rather than half-built

- **Adding five gallery images is five trips.** Picking closes the overlay. The fix is a
  `selected` prop on `MediaGrid` so the picker can multi-select; not added for one screen's
  convenience, and named in `ProductMedia.tsx`.
- **`tag_ids` is still absent from the edit form's sent list**, for its original reason. Every
  other `Draft` key now has a visible control, and that invariant is written into the docblock so
  it stays checkable.
- **`ProductService::guardSalePriceAgainstStored()` is unreachable from the panel.** It runs on
  update only and needs a lone `sale_price`; the form always sends both prices. Recorded, not
  worked around.

### Defects found and fixed on the way (recorded because they were live)

- **`lib/api/schemas/product.ts` required `url` on `media`; the presenter sends `src`.** Latent
  only because no seeded product had an image — putting images on the form is what made it
  reachable. Fixed as `schemas/cms.ts` fixed the identical slip.
- **Two false docblocks in `ProductDetail.tsx`**, both struck through and corrected: the API
  *does* reject an inverted sale/regular pair, and `weight` is *not* validated as a string.
- **Two mock bugs that would have hit the edit form on its first save**: `patchProduct` stored
  `image_id` verbatim (a string against `z.number()`), and never recomputed `image`/`gallery`, so
  a save that changed the picture answered with the old one.

### Fixture note

- **No seeded product has an image** (28 products, all `image_id: 0`), and three media-usage
  assertions depend on those cold-start zeros. Rather than change the seed, the populated state
  is a `MOCK_PRODUCT_MEDIA=attached` variant following `MOCK_MEDIA`/`MOCK_SETTINGS`. Default is
  `none`.

## After step 4

No backend work was needed and none was done. Nothing here is blocked on a human.

### Corrections to the step text

- **`GET /attributes/{id}` was missing from sub-task 1's list** and is required: `index()`
  deliberately omits `term_count`/`product_count` ("two queries per row"), so `product_count` —
  the number the delete warning is written from — exists **only** on the single read.
- **`GET /products/{id}/variations/{variation_id}` was deliberately NOT allowlisted**, though
  sub-task 1 lists it. Nothing reads one variation: the list fills the table, and both writes
  return the row. The list's rule is "a screen reaches it", not "the step listed it" — the same
  ground `POST /products/bulk` stands on. Asserted as refused, so the inverted boundary case
  stays a real boundary. Verified 405 through the proxy.
- **`variations_copied` is audit-only.** The step calls it out as what `duplicate` records, but it
  appears in no controller, presenter or test, so no client can read it. The panel reports the
  copy's own children instead.
- **`available_types` is `["select"]`** on this shop, measured — so no attribute type control is
  drawn, and the reason is recorded rather than deferred.

### Real defects found, not fixed

- **`AttributeRepository::fromWpError()` files every WooCommerce refusal under
  `details.fields.attribute` — a key no form control has or could have.** A screen binding errors
  by key renders *nothing* for the three most likely slug failures (derived slug too long,
  reserved slug, and the neighbouring duplicate-slug 409 which carries no `details` at all).
  Worked around in the panel with `splitFieldErrors()`; **the backend still files them that way.**
- **`ProductRepository::duplicate()` picks `WC_Product_Simple` for any non-`variable` type**, so
  duplicating a grouped or external product silently converts it to simple and copies no
  children. Not surfaced to the operator.
- **The backend's own suite only ever duplicates a simple product** — the variation-copy path
  that `duplicate` is most valuable for is uncovered there.
- **An Arabic attribute and an Arabic term derive different slugs from the same word.**
  `wc_sanitize_taxonomy_name()` urldecodes, `wp_insert_term()` does not — so `اللون` becomes
  `pa_اللون` but a term `أحمر` becomes `%d8%a3%d8%ad%d9%85%d8%b1`. Reproduced in the mock and
  asserted; the backend asymmetry stands.
- **`ProductService::guardSalePriceAgainstStored()` is still unreachable from the panel** (carried
  from step 3) — and the variations editor now has the same shape, since a row always sends both
  prices.

### Mock divergence corrected, same class as step 2's

- **`GET /products/{id}/variations` is unpaginated and sends no `meta` at all**; the mock was
  answering a full pagination envelope because the panel asked it for `per_page=100` — the
  harness inferring a contract from its own caller, exactly as on the commune route in step 2.
  Both sides corrected. It matters here because one press of generate-combinations can add 50
  rows.
- **`GET /attributes` uses the `counted()` envelope, not the paged one.** The mock had it under
  `list()`, whose own docblock listed it as an unmeasured borrower.

### Deliberately not done

- **Presets** ("clothing = Colour + Size", saved once and applied) — explicitly out of scope in
  the step, needs new backend storage and routes.
- **Multi-select in the media picker** (carried from step 3) — still one trip per gallery image.
- **The generate cap of 50 is the panel's own**, borrowed from `OptionSet::MAX_CHOICES`. There is
  no ceiling anywhere in the API, so a caller that is not this panel can still create unbounded
  variations one at a time.

### Practical note for future work

- **`scripts/capture.mjs` serves a stale `.next`.** Run `npm run build` before capturing, or new
  routes 404 and the run reports "the mock received zero requests" rather than a failure.

## After step 5

No backend work. Nothing blocked on a human.

### Corrections to the step text

- **The caller list was wrong.** Six files and eleven instances, not seven callers. `FilterBar` is
  **not** a caller — it only mentions `DateField` in a docblock explaining its own `align` prop.
  And `RangeControl` is at `components/ui/RangeControl.tsx`, not `components/patterns/`, which has
  held only `QueryProvider.tsx` since the teardown.
- **"One component, every date in the panel" was never true.**
  `marketing/segments/SegmentModal.tsx` renders its four date criteria as plain `TextField`s and
  never went through `DateField`, so the sweep in sub-task 6 did not reach them. **That is step
  6's sub-task 1** and is where they get picked up.

### Deliberately not built, named rather than half-done

- **No month or year dropdown.** A distant year is Shift+PageUp, or typed — which is what the
  text field is for.
- **No Hijri calendar.** CLDR gives `ar-DZ` a Gregorian calendar and the API is Gregorian.
- **No `aria-describedby` on the grid announcing its own shortcuts.**
- **`min`/`max` refuse the pointer but deliberately not the keyboard**, so a reversed range is
  reported by the caller's own cross-field message rather than by silently refusing a keystroke —
  `Stepper`'s documented rule.

### Measurement limits, recorded honestly

- **The Chromium `lang` defect was re-measured on 2026-08-31 and reproduces**, but by screenshot:
  the date input's segments live in a **closed** UA shadow root and headless Chromium accepts no
  synthesised keystrokes into them. So the run demonstrates that nothing *the page* says is
  honoured; it does **not** independently demonstrate the further claim that the browser's own
  locale is what decides.
- **WebKit was not re-measured.** The original claim covered two engines; this run covers one.

### Things that would not have failed a test

Both were caught by measuring rendered geometry and focus, not by assertions over attributes, and
both are worth knowing because the next such control will have the same two traps:

- **A `dir="ltr"` field containing an Arabic placeholder renders year-first.** The neutral
  separators take RTL direction between strong RTL runs, reintroducing exactly the ordering defect
  the control was built to remove. U+200E fixes it; an exact-bytes test pins it.
- **Radix mounts `Popover.Content` one commit after `open` flips.** An effect keyed on `open`
  holding a ref finds null, focuses nothing, and the calendar opens dead to the keyboard — while
  nothing errors and every `tabindex` assertion still passes.

### Carried forward, still open

Everything in the step 1–4 sections remains true.

## After step 6

No backend work. Nothing blocked on a human.

### Corrections to the step text

- **There are eight refused criteria, not seven.** `SegmentCriteria::REFUSED` holds `consent`,
  **`marketing_consent`**, `email`, `email_contains`, `role`, `sql`, `limit`, `commune_id`. The
  panel's `lib/campaigns.ts` and the mock were both short by one, and the mock's comment claiming
  "all seven were re-measured and all seven match" was two copies of the same gap rather than a
  check. Both corrected.
- **`/coupons/eligible-products` is used *always*, not as a fallback.** The step frames it as what
  to use when `/products` is forbidden. `/products` **declares no `include`**, so "show the name,
  store the id" on a reopened segment is not buildable on it without one request per id. The
  coupon route also widens `post_status` to `any` for an id set, so a since-trashed product still
  resolves.
- **The capability degradation the step describes is unreachable by any defined role.** Marketing
  Manager holds marketing without products — but the role is **retired**, `ac_manager` does not
  hold `ac_manage_marketing` (so only Super Admin reaches this screen under assignable roles), and
  the suggested fallback route is gated on `ac_manage_coupons`, which Marketing Manager holds
  anyway. The bare-id fallback is kept as a guard, worded quietly, because capabilities are
  per-user and editable off a role.
- **`app/[locale]/(panel)/products/ProductPicker.tsx` does not exist** — it is under `orders/`.

### Found in the backend, not fixed

- **`SegmentCriteria::parse()`'s `$number < 0` branch is dead code.** `ctype_digit` has already
  refused the sign by the time it runs.
- **The backend does no existence check on `wilaya_id` or the two product ids.** `SegmentCriteria`
  is pure by design, so a segment can be saved naming a wilaya or product that does not exist —
  verified by seeding `{wilaya_id: 999, bought_product_id: 987654}` and having both accepted. The
  panel renders such an id as itself rather than clearing it.

### Duplication accepted deliberately

- **There are now six wilaya pickers.** The five that existed do not agree on the value axis —
  `w.code` on a free-text address field, `w.id` with `"0"` as a live "national rule" sentinel,
  `w.id` with `""` for unset — so a shared control would take a discriminator prop and be three
  components in one. Unifying them means editing orders and shipping screens. What *was* extracted
  is `placeName`, into `lib/geography.ts`, instead of a fifth private copy.
- **There are two product searches.** The orders one is an always-open list of eight rows for
  adding line after line; two of those inside a 560px modal holding eleven criteria overflows the
  340px floor.

### Mock divergences closed

- Money accepted three decimals where the wire allows two; counts accepted a sign; neither ceiling
  (`MAX_SPENT`, `MAX_ORDERS`) existed; `checkRanges()`'s five cross-field refusals were absent
  entirely; and `/coupons/eligible-products` did not support `?include=`.

### Not verifiable here

- **The bare-id fallback was not photographed.** No `MOCK_IDENTITY` variant drops
  `ac_manage_coupons` — which is consistent with the finding that no defined role reaches that
  state.

## After step 7

Backend work landed on this branch by another agent (`body_fields`); nothing blocked on a human.

### Corrections to the step text

- **There is no brand colour in shop settings, so sub-task 3 is half-buildable.** The step asks to
  prefill "the store logo and colour". `Settings/SettingsInput.php::SCHEMA` is the entire writable
  surface — four blocks, nineteen keys — and `SettingsService::assemble()` the entire read surface;
  neither holds a colour, an accent, a brand or a theme under any spelling, and unknown keys are
  refused by name so one cannot be smuggled in. The logo is prefilled from `store.logo.url`, which
  `wp_get_attachment_url()` already makes absolute. The colour is left empty, where
  `brandColour("")` answers the panel's own accent at 5.63:1 — and the form says in words that the
  colour is the panel's rather than the shop's, so the blue is never mistaken for a measurement.
  Adding one means a new key in `SettingsInput::SCHEMA`, which is a backend change this branch
  did not make.
- **`/settings` is `ac_manage_settings`, Super Admin alone**, so the prefill is a 403 for anybody
  else. Softened in `page.tsx` exactly as the segment list beside it already is: a failed read costs
  one field, never the screen.
- **The campaign read has no `READ_ONLY` list and it is not eleven keys.** The hand-off said
  "echoing the whole read body back still 400s on eleven read-only keys". Eleven is
  `Products/ProductInput.php::READ_ONLY`. Campaigns use `CampaignInput::REFUSED`, which is
  **fifteen** keys and behaves the opposite way — `READ_ONLY` elsewhere is silently dropped so a
  round trip works, `REFUSED` answers 400 — and eight further read keys are neither known nor
  refused, so they 400 as `Unknown field.` The conclusion the panel acts on is unchanged and
  stronger: send only write fields.
- **`campaignBlocker()` does not exist.** `email-body.ts` cites it as the content guard the empty
  case keeps meaningful. The function is `furthestStep()` in `lib/campaigns.ts`, whose `content`
  branch is `body_html.trim() === "" || body_text.trim() === ""`. The behaviour the generator
  claims is real — a blank form produces two empty strings and the wizard will not advance — only
  the name is wrong.
- **The CTA's worst-case contrast is 4.1130:1, not 4.10, and nothing asserted it.** The hand-off
  said "a test asserts the number so it cannot drift"; `onBrand()` had no test at all. Both closed:
  `brandContrast()` is exported beside it with the algebra that derives the bound, and
  `tests/email-body.test.ts` now pins it analytically *and* by search over 65 536 fills.

### Decisions worth recording

- **The hand-edit flag is derived, not stored.** `handEdited()` regenerates from the answers and
  compares against the stored bodies. A stored boolean would be a twelfth thing to keep in sync and
  wrong in three silent ways — it cannot see an edit made through the API or another tab, it can
  survive a failed PATCH after Undo wrote it, and it is one more key inside a document the backend
  validates. What makes the comparison sound is the generator's byte-for-byte round trip through
  `EmailHtml::sanitize()`: without it every reload would report an edit nobody made.
- **A field change regenerates only while the bodies still match**, which is the silent half of
  "warns before overwriting manual edits" and needs no arming flag — the derived predicate closes
  the state machine on itself.
- **The picker is a `Modal`, on `ProductMedia.tsx`'s precedent**, because this is a route and §3.1's
  nested-overlay antecedent is absent.
- **Merge tokens insert at a caret remembered on `blur`**, not read at click, so the keyboard path
  works. Before any field has been focused the buttons are disabled with the reason, because
  inserting into a field nobody is looking at is a silent edit.

### Found and not fixed

- **The composer does not rebind its draft to the PATCH response.** `body_fields` string values that
  look like markup come back sanitised, so a paragraph containing `<b>` is stored with the tag gone
  — visible only on the next load, where the derived flag correctly reports the disagreement. The
  settings screen rebinds and this one never has; changing that is a change to how the whole wizard
  saves.
- **No upload step inside the picker.** `ProductMedia` carries one; this deliberately does not, so
  the form has no path that can 413. The media library is where a logo gets uploaded.
- **The `ac_manage_content` fallback is unreachable and was not photographed.** A reader without it
  gets `MediaPicker`'s own `ForbiddenState` naming the capability, which is correct and costs no
  extra control — and under assignable roles only Super Admin reaches this screen at all, so the
  state has no `MOCK_IDENTITY` that produces it. Same finding as step 6's bare-id fallback.

## After step 8

No backend work; `ecom-temp` was read only. Nothing blocked on a human beyond the standing e2e
credential (`BLOCKED.md`).

### Corrections to the step text

- **"Renumber what follows" touched nothing but a sentence.** The wizard's guard is
  `furthestStep()` in `lib/campaigns.ts` — checked by reading it rather than by trusting the name,
  which is the third branch in a row that has had to — and it returns only `audience`, `content` or
  `send`. It never named `preview`, so deleting the step from `COMPOSER_STEPS` changed no gate.
  What renumbers is `StepIndicator`'s own line, "Étape N sur 4", which is derived from the array's
  length; and `previousStep`/`nextStep`/`canAdvance`, which are index arithmetic over the same
  array. `campaignBlocker()` still does not exist and `email-body.ts` still cites it; the citation
  now has a correction beside the real function.
- **"Refreshed from the saved campaign as the other steps already do" does not survive contact with
  a live form.** The other steps refresh by *advancing*, and advancing leaves the step the preview
  is now on — so a person who edits a body would never see the render move. The card therefore
  carries its own refresh, which is the composer's existing `save()` and nothing else: PATCH,
  refetch, invalidate the preview query. Not a `SaveBar`; §3.4 refuses a *sticky bar reporting
  accumulated dirty state across a screen*, and this is one card's action with one visible effect
  in the card whose contents it changes.
- **"Beside or under the form" is not a choice this column can offer.** `PageBody width="detail"`
  is `max-w-192`, 768px, and the message is a 600px card — beside would leave the form about 140px
  at the composer's widest and nothing at all at the 340px floor. Under, therefore, and the
  position within the step is the argued part: after the two bodies, so `unknown_tokens` lands next
  to what caused it, and before the token list, which is a toolbox for every field above it.

### Decisions worth recording

- **`sandbox=""` — the empty string, which grants nothing** — and every token refused is argued in
  `MailPreview.tsx` rather than left as an absence. `allow-scripts` would buy the frame's height
  and spend the whole sandbox to buy it; `allow-same-origin` would re-join the frame to the panel
  and, beside scripts, would be worth nothing at all, since a same-origin script can remove the
  sandbox attribute from its own iframe element. Measured in Chromium: `contentDocument` is `null`
  from the page, so the frame really is opaque-origin.
- **`<base target="_blank">` with no `href`, because a sandboxed frame may always navigate
  *itself*.** No token gates that, so an `<a href>` would otherwise replace the preview with the
  live page — worst on the unsubscribe link the API appends to every body, which is the one a
  person clicks by reflex. Routed to an auxiliary context and blocked, because `allow-popups` is
  not granted. Measured: the frame stays on `about:srcdoc`, no tab opens, and Chromium logs
  *"Blocked opening … in a new window because the request was made in a sandboxed frame whose
  'allow-popups' permission is not set."* No `href` on the base, so a relative URL in a
  hand-written body fails to load — which is what it would do in a mail client too.
- **The height is fixed at `h-80` and the frame scrolls itself**, because the content cannot be
  measured across an origin boundary the sandbox exists to create. One property worth having falls
  out: an overflow inside a frame is the frame's, so this block cannot push the panel's document
  past its viewport at 340px.
- **The wrapper is `<html dir="auto">`.** A frame is a separate document and computes its own
  direction, so the panel's `dir` is not inherited — measured, an Arabic panel's frame root
  computed `ltr` for a French body. The mail states its own direction anyway (`dir` is in no tag's
  allowlist, so `buildEmail()` writes `direction:rtl` into every text-bearing cell's `style`);
  `auto` decides only the part the mail leaves unsaid.
- **The frame's letterbox is painted in `EMAIL_PALETTE.ground` in both themes.** A dark-mode
  preview would be the panel showing a mail that does not exist: `style` is a forbidden tag, so no
  media query can reach a message.
- **Stale is measured against the server's copy, not against a snapshot of the last save.** The
  question the marker answers is *does the frame show what the form says*, and the frame shows what
  was stored.

### Found and not fixed

- **The stale marker can now expose the un-rebound draft, and that is left visible on purpose.**
  Step 7 recorded that the composer does not rebind its draft to the PATCH response, so a
  hand-edited body carrying something `EmailHtml::sanitize()` removes comes back changed and the
  card keeps saying the preview shows the last save. It is saying something true. Fixing it means
  rebinding the whole wizard's draft, which is step 7's finding and not this one's.
- **A preview that fails to load still renders as a skeleton for ever.** `usePreview` can error and
  `MailPreview` only branches on `preview === null`, so an error and a pending read look the same.
  Inherited from `StepPreview` unchanged; it wants a message key and a retry, which is a state this
  branch did not add and did not remove.
- **`unknown_tokens` cannot see a token with a space in it.** `TemplateRenderer::PATTERN` is
  `/\{\{\s*([a-z0-9_]{1,40})\s*\}\}/i`, so `{{first name}}` matches nothing: it is neither
  substituted nor reported, and is mailed verbatim. The warning is a spelling check over the
  token *vocabulary*, not a brace check.
- **The mock cannot exercise the warning on a campaign it did not seed.** `campaignPreview()` hands
  a created campaign its own body back with nothing resolved, deliberately — *"a second renderer
  would be a second contract, and it would drift"* — so `unknown_tokens` is `[]` there however the
  body is written. The five seeded campaigns carry the measured shapes, and 319 is the typo row.
- **README.md and ADMIN_PANEL.md still say "the composer's own five steps".** Both are records of a
  *measurement* — `test` and `send` were 503 before `seed-campaigns.mjs` — and the ADMIN_PANEL one
  is a block quotation of the README line, so rewriting either would falsify a dated record or
  break the quotation. The two unreachable steps are still `test` and `send`; only the total moved.
