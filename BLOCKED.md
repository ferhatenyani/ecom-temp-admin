# Blocked on a human

Two steps in `changes.md` reach past what this environment can do. Neither is faked, and no
docblock in the work that follows claims a measurement that was not taken. Each entry says what
is needed, what was assumed instead, and what to re-check once the block clears.

Item 1 has since narrowed: its field-level contract turned out to be measurable in-process and
has been measured, so what is left there is the transport alone. The entry says which is which,
and says **measured in-process via `rest_do_request()`** wherever it means that — never
"measured against the live API", which remains untrue of every finding in this file.

---

## Item 1, backend step 1 — measure `PATCH /orders/{id}`

**What the step asks.** Measure the route's real behaviour for `billing`, `shipping`,
`line_items`, `payment_method` and `customer_note`. Everything previously written about this
route in `ADMIN_PANEL.md` and `scripts/mock-api.mjs` covers `status` alone; the rest was
transcribed from source, not observed.

**This entry has narrowed. Most of it is now measured.** The field-level contract — every
refusal a form binds to — was measurable without an HTTP credential, and has been measured.
What remains blocked is the transport, and only the transport.

### What was measured, and how

**Measured in-process via `rest_do_request()`**, in `ecom-temp`'s
`wp-content/plugins/algerian-commerce-core/tests/Api/orders.php`, in the section headed *the
PATCH field contract, measured* — 55 new assertions, re-runnable, `190 passed, 0 failed`:

```
docker compose run --rm -T -e AC_RATE_LIMIT_DISABLED=1 \
  wpcli wp eval-file - < wp-content/plugins/algerian-commerce-core/tests/Api/orders.php
```

**Read that phrase strictly, and repeat it rather than paraphrasing it.** In-process via
`rest_do_request()` is **not** a signed HTTP request to the deployed instance. It runs routing,
the args schema, the permission callback, `OrderInput`, `AddressInput`, `LineItemInput`, the
service guards, the repository and WooCommerce itself. It does **not** run Application Password
authentication, nonce handling, the REST cookie or CORS layer, or any reverse proxy. Nothing
below is evidence about those. Nothing derived from this should ever be described as "measured
against the live API".

### The answers

| Body | Status | `error.code` | `error.details` |
| --- | --- | --- | --- |
| `{"billing": {"first_name": "x"}}` | 200 | — | merges; the other ten fields survive |
| `{"billing": {"country": "ZZ"}}` | **200** | — | accepted — the check is shape, not membership |
| `{"billing": {"country": "Algeria"}}` | 400 | `invalid_request` | `fields["billing.country"]` |
| `{"billing": {"email": "a@b.c"}}` | 400 | `invalid_request` | **none at all** |
| `{"billing": {"email": "nope"}}` | 400 | `invalid_request` | `fields["billing.email"]` |
| `{"billing": "nope"}` | 400 | `invalid_request` | `fields["billing"]` |
| `{"shipping": {"email": "a@b.co"}}` | 400 | `invalid_request` | `fields["shipping.email"]` |
| `{"line_items": […]}` on `pending`/`on-hold` | 200 | — | replaces the whole set |
| `{"line_items": […]}` on any other status | 409 | `conflict` | `status`, `editable_in` — **no `fields`** |
| `{"line_items": []}` | 400 | `invalid_request` | `fields["line_items"]` |
| `{"line_items": [{"id": N, "quantity": 9}]}` | 400 | `invalid_request` | `fields["line_items.0.product_id"]` |
| a line naming a product that does not exist | 400 | `invalid_request` | `fields["line_items.1.product_id"]` |
| `{"payment_method": …, "payment_method_title": …}` | 200 | — | independent; neither requires the other |
| `{"customer_note": "…"}` at 5 000 | 200 | — | — |
| `{"customer_note": "…"}` at 5 001 | 400 | `invalid_request` | `fields["customer_note"]` |
| `{"total": "1.00"}` alone | 400 | `invalid_request` | **none** — "No supported fields were provided." |
| `{"total": "1.00", "customer_note": "…"}` | 200 | — | the total is dropped, the note lands |
| an unknown key | 400 | `invalid_request` | `fields[<the key, under its prefix>]` |
| an id that does not exist | 404 | `not_found` | none |

The exact message strings are in the test file; the keys are the part a form binds to.

**A partial address merges — the form may send only what changed.** This was the entry's
most important open question and the answer is the convenient one. `OrderRepository::applyProps()`
walks only the keys the payload stated, one setter each, so an omitted field is never written.
Clearing is explicit: `null` (or `""`) writes an empty string. The form does not have to echo a
whole address back to avoid blanking it.

**Three of the eight probes were asking the wrong question, and the corrections matter more
than the confirmations:**

- **Probe 2 assumed `ZZ` refuses. It is accepted, 200.** The country rule is `^[A-Z]{2}$` and
  nothing more — membership means `WC()->countries`, and `AddressInput` is pure. What refuses is
  a country *name* (`"Algeria"`), keyed `billing.country`. A lowercase code is accepted and
  upper-cased. **The panel cannot lean on the API to validate a country**; if the form offers a
  free-text country it will happily store nonsense.
- **Probe 8 assumed `READ_ONLY` refuses. It drops.** `{"total": "1.00"}` on its own is
  indistinguishable from an empty body and returns `"No supported fields were provided."` with
  **no `fields` key** — not an error naming `total`. Alongside a real field it is silently
  ignored and the request succeeds. There is no per-field error to render for a read-only key,
  ever.
- **Probe 3's premise held, but the neighbouring case did not.** `shipping.email` refuses as
  expected. `billing.email` has a hole: `AddressInput` validates with `filter_var()`, WooCommerce
  validates again with `is_email()`, and they disagree — `a@b.c` and `a@[127.0.0.1]` pass the
  first and fail the second. Such an address clears validation, then
  `WC_Order::set_billing_email()` throws and `OrderService::save()` returns the exception's own
  message with an empty details array: `400`, `invalid_request`, `"Invalid billing email
  address"`, **no `details.fields`**. A form binding on `fields["billing.email"]` shows the
  operator nothing. Nothing is written — a `customer_note` in the same body does not move — so it
  is a display gap, not a data one, but the form needs a fallback that renders a
  `details`-less 400 somewhere visible.

**The finding that changes how the edit form builds its payload:** the whole-body round trip
only works on an editable order. `OrderInput`'s docblock says the read shape is droppable so a
client can "GET an order, change one thing and PATCH the whole object back" — and that holds on
`pending` and `on-hold` only. On `processing`, `completed`, `cancelled`, `refunded` and `failed`
the presenter's `line_items` is echoed straight back into the `is_editable` guard and the request
is a **409**, *even when the only field the operator touched was the customer note*. Every other
field genuinely is writable in every status; it is the echo that fails.

> **So `buildPayload()` must omit `line_items` unless the operator actually edited the lines.**
> Not "unless they changed", not "when the order is editable" — omit the key.

**Probe 4's answer, which the entry flagged as the one that could invalidate built work:
replace-the-set, as assumed.** No rework needed there — but with a detail that was not assumed.
A line `id` identifies nothing: `READ_ONLY` drops it, `resolveLines()` pairs by array index, and
the rows are re-created on every write that touches the key, so an *identical* replace still
returns new ids. A client must send the complete intended set and must not cache a line id
across a write. A PATCH that omits `line_items` leaves the ids alone.

**Smaller answers, recorded so nobody re-derives them:**

- The status transition guard runs **before** the editability guard: a body with both an illegal
  transition and `line_items` reports the transition (`details.from`, `.to`, `.allowed`).
- Clearing `payment_method` clears `payment_method_title` with it, unless the same body states a
  title. Otherwise the two move independently in both directions. No gateway registry check —
  `"not_a_gateway"` is stored as typed.
- `customer_id` is freely re-attributable, to any existing user or `0` for a guest. The only rule
  is that the user exists; a staff account is accepted.
- Strings are stored and returned **verbatim** — `<script>alert(1)</script>` round-trips
  unchanged through `customer_note` and address fields. The panel escapes on render.
- `customer_note` is trimmed before it is measured against the 5 000 cap. Address fields cap at
  200, keyed `billing.city` and so on.
- Every field-level refusal in a body arrives at once, across all three key depths, so the form
  can render the lot in one pass.

### What is still blocked on a human, and only this

The transport. A WordPress Application Password for a user holding `ac_manage_orders` — the
panel gets one from a person at the login screen, and none is stored in either repo:

```
$ curl -o /dev/null -w '%{http_code}' http://localhost:8090/wp-json/algerian-commerce/v1/orders
401
```

`.env.local` carries `AC_API_BASE` and `SESSION_SECRET` and no credential. With one, these
remain unanswered:

- **Authentication.** Whether an Application Password is accepted on this route at all, and what
  a bad one returns over the wire.
- **Capability enforcement over HTTP.** The 401/403 split is measured in-process against
  `wp_set_current_user()`. It is not measured against a real `Authorization` header.
- **Everything between the client and PHP.** CORS preflight, cookie and nonce handling, rate
  limiting (the in-process runs disable it outright with `AC_RATE_LIMIT_DISABLED=1`), and
  whatever a reverse proxy does to a `PATCH` body or a 409.
- **Whether any of the shapes above survive the wire unchanged.** They are what the handler
  returns; they are not yet what a browser receives.

### What a reader should still not assume

- That any refusal above has been seen coming back over HTTP. None has.
- That the 401/403 behaviour is confirmed for a real credential. It is confirmed for an
  in-process current-user switch, which is a different mechanism.
- That "not refused" means "validated". `ZZ` is stored, `not_a_gateway` is stored, and a
  quantity has no ceiling — a large one produced a total of `99999900.00` without complaint.
- That the mock is now correct by construction. `scripts/mock-api.mjs` was written from
  source-derived shapes; the corrections above (the country rule, the dropped `total`, the
  `details`-less billing-email refusal, the 409 on a whole-body PATCH) are exactly where it is
  most likely to be wrong, and it has not been re-checked against this run.

---

## Item 2, backend step 1 — courier credentials and `sync-destinations`

**What the step asks.** Put credentials and `ENABLE_YALIDINE` / `ENABLE_ZR_EXPRESS` in the
environment, then run `wp algerian-commerce sync-destinations` so wilaya/commune ids map to each
courier's own ids — `YalidineProvider::getShippingRates()` returns `[]` for any destination it has
not mapped, and a checkout would silently fall back to the tariff forever.

**Why it is blocked, precisely.** Measured on the running stack:

```
$ docker compose exec wordpress printenv | grep -E 'YALIDINE|ZR_EXPRESS'
ENABLE_YALIDINE=            YALIDINE_API_ID=          YALIDINE_API_TOKEN=
YALIDINE_WEBHOOK_SECRET=    ENABLE_ZR_EXPRESS=        ZR_EXPRESS_TENANT_ID=
ZR_EXPRESS_API_KEY=         ZR_EXPRESS_WEBHOOK_SECRET=
                                                    — all eight present and all eight empty

$ wp algerian-commerce shipping-check
Geography: 69 wilayas, 1541 communes.
provider   credentials   destinations   notes
manual     n/a           0              ready
Success: Every configured courier is ready.
```

Read that last line carefully: it says every *configured* courier is ready, and none is
configured. `manual` is the only provider `GET /shipping/providers` reports.

Both couriers are fully implemented — `integrations/Yalidine/YalidineProvider.php` and
`integrations/ZRExpress/` have `getShippingRates()`, `createShipment()`, `cancelShipment()`,
status polling, webhooks and destination sync. Nothing is missing but the credentials, and no
amount of local work produces them: they are issued by Yalidine and by ZR Express to an account
holder. `sync-destinations` is not a local computation either — it calls each courier's live API
to fetch its own wilaya/commune ids.

**The geography side is already populated** — 69 wilayas and 1541 communes are loaded. What is
missing is only the *mapping* from those ids to each courier's ids, which is exactly what
`sync-destinations` writes and what `getShippingRates()` needs.

**What is needed.**

1. A Yalidine API id and token, and a ZR Express tenant id and API key.
2. `ENABLE_YALIDINE=1` and/or `ENABLE_ZR_EXPRESS=1` in `ecom-temp/.env`.
3. A webhook secret each, if courier status callbacks are wanted.
4. Then, per enabled provider:
   `wp algerian-commerce sync-destinations --provider=yalidine --dry-run` first — the command
   supports it — and then the same without `--dry-run`.
5. Re-run `wp algerian-commerce shipping-check`; the `destinations` column must stop reading `0`.

Worth knowing before choosing: a courier's sandbox, if either offers one, is enough for
everything except the real shipment. `createShipment()` against a live account **creates a real
parcel** that a courier may attempt to collect, so a throwaway or sandbox account is the right
target, not the shop's production one.

**What was assumed instead.** The work proceeds against the **provider interfaces as read from
source** — `ProviderRegistry`, `ShippingProviderInterface`, `YalidineProvider::getShippingRates()`
and `createShipment()`, `ShippingService::rates()` — and is verified with `manual` plus a test
double standing in for a courier, never against a live courier API. Every docblock resting on
courier behaviour says it is read from source and not measured. The panel's mock carries the
per-provider quote shape so the screens are testable here.

**Where that shape lives, as of the carrier branch: `MOCK_COURIERS=on`.** The create drawer's
carrier picker and its rate lookup need a shop with more than one courier, and this install cannot
be one. `scripts/mock-api.mjs` therefore reproduces `Core\Plugin::shippingProviders()`'s *gate*
rather than one side of it — the two couriers are registered only under that variable, `manual` is
appended last and unconditionally, and the default arm stays byte-identical to the install measured
above. So `GET /shipping/providers` still answers `manual` alone by default, which is what five
other screen decisions in this panel rest on.

The prices those couriers quote are **invented**, and are derived from the destination ids by a
formula rather than written as a table so that no reader mistakes them for measurements. Nothing in
either repository has seen a real courier quote. What the fixture reproduces from source is the
*shape*: Yalidine returns all four of its services whatever journey was asked about, ZR Express
returns the one it filtered to, `manual` returns none at all, and wilaya 1 returns nothing from
either — standing in for the unmapped-destination arm both adapters take, which is the state every
destination is in until `sync-destinations` runs.

**What to re-check when the block clears.** Whether `getShippingRates()` returns what the quote
shape assumes for a real destination; whether a courier that serves a wilaya but not a commune
returns `[]` or an error; and the retry path — an order rejected by the courier for a bad commune
is supposed to create its parcel on the next confirm, which cannot be exercised without a courier
that can reject.
