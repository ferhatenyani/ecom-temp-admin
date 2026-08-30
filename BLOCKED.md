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

*Not yet reached. This entry is filled in when item 2 starts.*
