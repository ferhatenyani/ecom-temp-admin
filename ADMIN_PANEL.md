# Admin Panel — Build Specification

Roadmap §4 step 43, PLAN §52. This is the document to read before writing a line of the admin
panel, and the one to read **after** [docs/API.md](API.md), never instead of it.

The panel lives in its own repository — `ecom-admin`, a sibling of this one, on the WSL ext4
filesystem. This document is the specification it is built from. Everything in Part I is work that
happens **here**, in this repository, before the panel repository is created.

---

## What this document is not

**It never restates a field list.** `docs/API.md` is the contract and `scripts/test-api.sh` verifies
it against the live router; a second copy of `product.regular_price` in this file would be a copy
that goes stale, and §68's argument is that the copy is what drifts. Where a screen needs a shape,
this document names the route and the section of `docs/API.md` that owns it.

What this document owns is everything the API does not decide: how a staff member signs in, what the
panel is allowed to render, how it behaves in Arabic, on a phone, on a dying connection — and the
design rules that stop it looking like every other generated dashboard.

---

## Decisions already made

Six, each settled before writing. They are not open for re-litigation mid-build; changing one means
changing this document first.

| Decision | Choice | Because |
|---|---|---|
| Staff sign-in | **Per-user WordPress Application Password** | The audit trail names a real person and `/auth/me` drives what each role sees. A shared service credential collapses §45's whole matrix into one account. |
| Languages | **French and Arabic, full RTL** | The staff who use this are Algerian. Retrofitting RTL means touching every component, so it is direction-agnostic from line one. |
| Missing routes | **Built in this repository first** | PLAN §52 says routine administration must not require wp-admin. Four of its areas have no API; Part I is that work. |
| Styling | **Tailwind CSS v4 (4.3) with a token-only theme** | Fast to write, and the arbitrary-value escape hatch is closed by a CI check rather than by good intentions. |
| Typeface | **IBM Plex Sans + IBM Plex Sans Arabic** | One designed system across both scripts. Open licence, self-hostable, variable. SF Pro cannot be self-hosted for the web outside Apple platforms, and the system stack is generic by definition. |
| Offline | **Installable PWA, read-cached** | Staff use this on mobile data in warehouses and vans. Writes still need a connection and say so. No offline write queue — see [Part VI](#part-vi--pwa-and-offline). |

---

## The non-negotiables

These come from the person who commissioned the panel and they are constraints on every screen, not
preferences to weigh against others.

1. **No AI slop.** No component library whose look is the house style of generated UI. No
   `shadcn/ui`, no MUI, no Chakra, no Ant. Primitives are written here. Radix or Ark is permitted for
   *behaviour only* — focus traps, dismissal, ARIA wiring — with every visual property ours.
2. **The `impeccable` skill is invoked before any UI is written**, and the Apple/iOS design skill
   supplies the platform grammar. This document supplies the constraints those skills work inside; it
   does not replace them.
3. **No gradients.** Not on buttons, not on cards, not on charts, not as a "subtle" background wash.
   `backdrop-filter: blur()` on a navigation material is **not** a gradient and is permitted — it is
   how iOS actually renders those surfaces. The distinction is that a blur samples what is behind it;
   a gradient invents a colour ramp.
4. **No accent bars.** No 3px coloured left border to mark a status, a category or a selection.
   [Part III](#status-without-an-accent-bar) specifies what to do instead, because a banned pattern
   with no replacement gets reinvented.
5. **No generic fonts.** IBM Plex Sans and IBM Plex Sans Arabic, self-hosted, subset, variable. The
   fallback stack exists only to cover the milliseconds before the font loads, and it is
   metric-adjusted so nothing reflows.
6. **Mobile first.** Every screen is designed at 390 × 844 and then allowed to grow. A layout that
   only works once there is a sidebar is not finished. The primary navigation is a bottom tab bar
   within thumb reach, not a hamburger drawer.

   > **Corrected in the build: 390 is the floor, not the target.** Measured against Playwright
   > 1.62.1's device table, 390 pt is the *narrowest* width Apple still ships — the iPhone 16e and
   > 17e. The current lineup is 393 (iPhone 16), **402 (iPhone 17, 17 Pro)**, 420 (Air), 430 (16 Plus)
   > and 440 (17 Pro Max). Designing at 390 stays right, because that is where a layout breaks and
   > every truncation defect in the orders row surfaced there first. But verifying *only* at 390 would
   > leave every current flagship unchecked, so the e2e suite runs `phone-min` (390), `phone` (402) and
   > `phone-max` (440), and `scripts/shots.mjs` captures all three beside desktop.
   >
   > A device descriptor also selects a browser engine, which is a separate trap: `devices["iPhone 13"]`
   > is WebKit, and pinning the default project to it turned a missing browser download into thirteen
   > red tests that read as product failures. The projects keep the geometry and drop the engine;
   > `phone-webkit` is the opt-in real-engine run.
7. **iOS-like.** Grouped inset lists, large titles that collapse, sheets with detents, segmented
   controls, action sheets for destructive choices, 44 pt targets, spring easing. Detail in
   [Part III](#part-iii--the-design-system).

A rule nobody enforces is a preference. [Part VII](#part-vii--testing-and-checks) specifies
`scripts/check-design.sh`, which fails the build on 1, 3, 4, 5 and on physical-direction properties.

---

# Part I — Backend prerequisites

Four route groups PLAN §52 requires and this API does not have. They are built **here**, on their own
branches, before the panel repository exists — the panel is then written against a complete API
rather than around holes in one.

Numbering continues the roadmap. `Schema::VERSION` does not move: none of these needs a migration.

Every one of them follows the rules already in force. Input objects refuse unknown fields **by name
with the reason** — the `CustomerInput` device. Writes are audited. Nothing new is invented where an
existing capability fits, per §61's media precedent. Each gets a `tests/Api/` suite with a positive
control beside every refusal, per §65.

---

## §87 — Staff users and roles

`ac_manage_users` has been declared in `Permissions\Capabilities` since §45 and has **zero call
sites**. It is the only capability in the vocabulary that gates nothing, which means Super Admin's
defining privilege — the one that makes it different from Admin — is currently unexercisable through
the API.

### Routes

| Method | Route | Guard |
|---|---|---|
| GET, POST | `/users` | `ac_manage_users` |
| GET, PATCH, DELETE | `/users/{id}` | `ac_manage_users` |
| GET, POST | `/users/{id}/application-passwords` | `ac_manage_users` |
| DELETE | `/users/{id}/application-passwords/{uuid}` | `ac_manage_users` |
| GET | `/roles` | `ac_manage_users` |

> **Built.** `src/Users/` — ten classes, no migration, no table, no new capability.
> `docs/API.md` → "Staff users and roles" is the contract; `tests/Api/users.php` is 89 assertions.
> What follows is the design; where it and the code disagree, the code is right and the note says so.

### `/roles` is GET-only, and that is the design

No route creates a role. `Capabilities::roles()` is pure data, unit-tested, and the single source of
the matrix; a role invented at runtime and stored in the options table is a capability set nobody
tested and that no test can enumerate. `GET /roles` returns the seven roles with their capabilities
and their display names — enough for a role picker, and nothing that can drift.

The same argument that kept `ac_analytics_aggregates` out of §63 and a version table out of §68.

### `/users` manages staff, and only staff

A user holding no `ac_*` capability is a **customer** and belongs to `/customers`, which already
exists and already refuses `roles`, `capabilities` and `user_pass` by name. `GET /users` therefore
filters to staff accounts, plus WordPress administrators.

> **Corrected in the build: staff is defined by *role*, not by capability.** This section first said
> "at least one capability from `Capabilities::ALL`", and the two rules give different answers. A
> capability granted directly to one account — by another plugin, or by hand — makes it staff under
> the capability test while remaining unfindable by `WP_User_Query`, which filters on roles. One rule
> the list and the single read can both honour is worth more than a wider rule the list cannot, so an
> account is staff when it holds one of §45's seven roles or `administrator`. `UserRoles::staff()`.

That split has to be enforced on the way in as well, or the panel gains a second door onto customer
records with a different permission model. Two rules:

- **`POST /users` requires a role**, and it must be one of the seven. An account created with no role
  is a customer created through the wrong endpoint.
- **`PATCH /users/{id}` refuses to remove the last role**, because the result would be a customer that
  `/users` can no longer see and `/customers` never expected to receive.

**Promoting an existing customer to staff is permitted and audited loudly.** It is a real operation —
the shop owner's own account is often a customer first — but it changes what §44 says about that
account: a customer receives no Application Password, and a staff member does. The audit event names
both the old and the new role, and the response says so in `meta.promoted_from_customer`.

### Privilege escalation, which is the whole risk of this endpoint

§45's test list names it explicitly. Five refusals, each with its reason in the error body:

| Refused | Why |
|---|---|
| Assigning `administrator` or any core WordPress role | A core administrator installs plugins and edits files. This API manages commerce roles; it does not hand out the platform. |
| Granting a role holding capabilities the caller lacks | Trivially true for Super Admin today, and the rule is what stops a future eighth role from being an escalation path. |
| Changing your own role | The only way to demote yourself out of the capability you need to undo it. |
| Deleting yourself | Same shape, worse outcome: a shop with no Super Admin has no route back except wp-admin. |
| `user_pass`, `capabilities`, `user_login` | A password set by somebody else is a password the account holder cannot trust. Capabilities come from the role. A login is an identity, not a field. |

`DELETE /users/{id}` additionally refuses when the account owns orders — `wp_delete_user()` reassigns
posts, and HPOS orders keyed to a deleted `customer_id` become orphans no report can attribute.
Deactivation is the operation people actually want: `PATCH` the role to none is refused above, so
provide `status: active|suspended` as user meta, and a suspended account's credentials answer **401**
at every route.

> **Corrected in the build: the check is a `rest_pre_dispatch` guard, not `AuthService`.** That
> service only answers `/auth/me`, so a check there would leave every other route open. The obvious
> alternative, `rest_authentication_errors`, is where core reports a bad credential — but
> `rest_do_request()` does not fire it, so every in-process suite in `tests/Api` would be blind to
> the guard and a security property only the HTTP stage can see is one that gets verified once.
> `rest_pre_dispatch` fires for both, which is why `RateLimitGuard` already uses it.
> `Users\SuspensionGuard` runs there at priority 9, ahead of the rate limiter at 10, so a refused
> account does not spend anyone's allowance.

### Minting an Application Password is the onboarding step

This is why the endpoint exists at all. A WordPress Application Password is displayed exactly once,
at creation, in wp-admin — which is the dashboard PLAN §52 says staff should not need. So:

```
POST /users/{id}/application-passwords   { "name": "Admin panel — Karim's iPhone" }
→ 201 { "uuid": "…", "name": "…", "password": "abcd EFGH ijkl MNOP qrst UVWX", "created": "…" }
```

**The password appears in that one response and nowhere else, ever.** Not in the audit event, not in
a log, not on `GET`. The `GET` collection returns name, uuid, created and last-used, which is what a
"revoke this device" screen needs. `last_ip` is stored by WordPress and deliberately not published:
it is the one field here describing a person rather than a credential.

> **Corrected in the build: `Logger` needed no change.** This section said
> `Logger::SENSITIVE_EXACT` gains the field name. It does not — `password` is already in
> `Logger::SENSITIVE`, the *substring* list, so any key containing it is masked and has been since
> §41. The exact list exists for words like `label` that are ordinary English and cannot be matched
> as substrings. The service still never puts a plaintext password in an audit payload, because
> being correct only by virtue of a redactor elsewhere is how the redactor's next edit becomes a
> leak — and `tests/Api/users.php` asserts the outcome (the minted string appears nowhere in the
> trail, under any key) rather than the mechanism.

`DELETE` revokes one. A revoked password stops working immediately, which is the panel's real logout
for a lost phone — a sealed cookie the panel cannot reach is not something the panel can invalidate.

Rate limiting already covers the abuse case: `RateLimitGuard` hooks
`application_password_failed_authentication`, so brute-forcing a minted password hits
`AC_RATE_LIMIT_AUTH_FAILURES` at 10 per 15 minutes per IP.

### Audit

Every write here is audited, and the resource is the *target* user, not the caller: `user.created`,
`user.role_changed`, `user.suspended`, `user.reactivated`, `user.updated`, `user.deleted`,
`user.app_password_created`, `user.app_password_revoked`.

One PATCH can write up to three of them, because they are three separately queryable facts: a single
`user.updated` carrying "role and status both changed" is a row nobody can filter for, and those are
the two questions an audit trail is opened to answer.

> **Corrected in the build: a role change records values, not just field names.** This section said
> "field names, never values — §71's rule". That rule exists so a shop's trade-register numbers stay
> out of a table nobody cleans, and it still governs everything else here — an email change records
> `fields: ["email"]` and no address. But for a role the value *is* the security fact, and "somebody's
> role changed" answers none of the questions the trail is read to answer. `user.role_changed` carries
> `from` and `to`.

---

## §88 — Product attributes

`GET /product-categories` exists; nothing manages global attributes. §82 made that gap load-bearing:
**only a global attribute can be filtered or counted**, so a shop with no global attributes has a
faceted search that can never return a facet, and the API's own advice — a 400 listing
`details.facetable_attributes` — currently lists what the shop happens to have, with no way to add to
it outside wp-admin.

### Routes

| Method | Route | Guard |
|---|---|---|
| GET, POST | `/attributes` | `ac_manage_products` |
| GET, PATCH, DELETE | `/attributes/{id}` | `ac_manage_products` |
| GET, POST | `/attributes/{id}/terms` | `ac_manage_products` |
| PATCH, DELETE | `/attributes/{id}/terms/{term_id}` | `ac_manage_products` |

> **Built.** `src/Products/` — six classes, no migration, no table, no new capability.
> `docs/API.md` → "Global attributes" is the contract; `tests/Api/attributes.php` is 59 assertions.

No new capability. An attribute is part of the catalogue and `ac_manage_products` already writes
products, variations and the attribute *assignments* on them.

### The trap this section must not fall into, which is already written down

CLAUDE.md records it for §82's fixtures and it applies verbatim here:

> **An attribute created in the same process cannot be counted.** `wc_create_attribute()` writes the
> row, but the taxonomy is registered on `init` from the `$wc_product_attributes` global, so
> `taxonomy_is_product_attribute()` is false for the rest of the request. The attribute is
> registered, queryable and invisible to the facet counter, answering 200 with an empty list.

So `POST /attributes` must:

1. call `wc_create_attribute()`, then `register_taxonomy()` for the new name in the same request, so
   terms can be added immediately;
2. bust `AttributeCatalogue`'s memoised `facetable()` map, or the next call in the same request
   reports the attribute as unfacetable;
3. report what is actually true about facets, so the panel never shows an empty facet the developer
   blames the facet code for.

A live shop meets this once, at setup. A test fixture meets it every run.

> **Corrected in the build: the trap closes completely, and step 3 was pessimistic.** This section
> expected `meta.facets_available: false`, assuming a fresh attribute could not be counted.
> Registering the taxonomy *and* setting the `$wc_product_attributes` global —
> `taxonomy_is_product_attribute()` checks both — makes it filterable and countable in the same
> request. Verified in one process: create → term created 201 → the attribute appears in
> `meta.facets.attributes.facetable`. The response carries `meta.filterable: true` and a note that
> counts cover published products, which is the honest remaining caveat.
>
> **WooCommerce's own REST controller does not do this** (read at 11.0.1), so `wc/v3` still cannot
> take a term on a just-created attribute. Its registration could not be reused either —
> `WC_Post_Types::register_taxonomies()` returns early on `taxonomy_exists('product_type')` — so the
> taxonomy is registered with the minimum the write path needs, for one request, rather than by
> copying sixty lines of labels and rewrite rules that would drift on the next upgrade.

### Deleting

`DELETE /attributes/{id}` is refused with **409** while any product uses the attribute, listing a
count and the first few product ids. WooCommerce's own delete removes the taxonomy and orphans every
variation that resolved through it, which surfaces later as variations that cannot be matched — a
failure with no error and a long delay between cause and symptom.

`?force=true` overrides, as it does elsewhere in this API, and the audit event records the count that
was overridden.

### Terms

Term slugs are what `GET /products?attributes[pa_size]=m` matches, so renaming a slug breaks every
saved filter and every storefront link. `PATCH` on a term accepts `name` and `description` freely and
treats `slug` as a **separate, explicit** field whose change is audited and whose response carries
`meta.slug_changed: true`. Not refused — sometimes a slug is genuinely wrong — but never incidental.

**Deleting a term is guarded the same way as deleting the attribute**, which this section did not
say: it detaches every product on that term and breaks any variation that resolved through it, so it
is a 409 with the count and `?force=true` overrides. The argument does not get weaker one level down,
and the term case is the likelier of the two to be hit.

> **What §88 found, and it was not in this section: the URL was decorative on every write route.**
> `WP_REST_Request::get_param()` reads the JSON body before the URL, so `PATCH /products/1801` with
> `{"id": 1802}` edited product 1802, and no sub-resource's read body could be PATCHed back. Fixed
> centrally in `AbstractController::pinRouteParams()`; asserted in `tests/Api/security.php`. The
> panel is unaffected in behaviour — it never sends a conflicting id — but Part V's "GET then PATCH
> the whole object" advice depended on it.

> **§89 must not name its page-rename field `slug`.** Pinning makes the URL authoritative for every
> param the route captured, and `/cms/pages/(?P<slug>…)` captures `slug` — so a write payload
> carrying `slug` would have it silently overwritten by the path and answer 200 having renamed
> nothing. Use `path` (the parameter already takes a full path, so the name is more honest anyway) or
> a distinct `new_path`. `tests/Api/security.php` fails the build on any write route addressed by a
> name that is not an id and not listed with its reason, so this decision is forced at the moment the
> route is registered rather than discovered afterwards. Verified against a route of exactly that
> shape.

---

## §89 — CMS writes

§61 built the read half and named the reason the write half was missing: *"a write surface is PLAN
§52's admin coverage, not this."* This is that.

### Routes

| Method | Route | Guard |
|---|---|---|
| PUT | `/cms/homepage` | `ac_manage_content` |
| POST | `/cms/pages` | `ac_manage_content` |
| PATCH, DELETE | `/cms/pages/{slug}` | `ac_manage_content` |
| POST | `/cms/banners` | `ac_manage_content` |
| PATCH, DELETE | `/cms/banners/{id}` | `ac_manage_content` |
| POST | `/cms/faqs` | `ac_manage_content` |
| PATCH, DELETE | `/cms/faqs/{id}` | `ac_manage_content` |
| GET, POST | `/cms/faq-categories` | `ac_manage_content` |
| PATCH, DELETE | `/cms/faq-categories/{id}` | `ac_manage_content` |
| PUT | `/cms/menus/{location}` | `ac_manage_content` |

> **Built.** `src/CMS/` — seven new classes, no migration, no table, no new capability.
> `docs/API.md` → "CMS" is the contract; `tests/Api/cms.php` is 155 assertions.
> What follows is the design; where it and the code disagree, the code is right and the note says so.

`{slug}` keeps taking a **full path** — `legal/terms` — for the reason §61 gives, and `POST
/cms/pages` therefore takes `parent_path` rather than `parent_id`, so a client that only ever saw
paths never has to learn ids.

> **Corrected in the build: the capture is `{path}`, and the routes are ten rather than nine.** The
> table above still writes `{slug}`, which is the collision §88 predicted three paragraphs earlier:
> `pinRouteParams()` would overwrite a body's `slug` with the path and answer 200 to a rename that
> renamed nothing. So the capture took the name it always deserved — it has held a full path since
> §61 — and the body renames with `slug` and moves with `parent_path`. `GET /cms/faq-categories` was
> also missing from the table: `POST` is listed, so a panel could create a category it had no way to
> list, and `FaqInput` refuses a category that does not exist.
>
> **`status` is accepted on write and every read takes `?status=`.** This section does not mention
> drafts, and without them `POST /cms/pages` with no way to stage a page answers 201 for a resource
> whose `GET` is a 404 — the silent-failure shape the rest of Part I is written against. The default
> is `publish`, so §61's read contract and every existing caller are unchanged, and `any` means
> publish plus draft and never the trash.

### `wp_kses` runs on save, not on read

§85 settled this for email templates and the argument is identical: stored content is re-rendered,
and the first place a stored XSS fires is the content manager's own preview. Every HTML field —
page content, banner copy, FAQ answers — goes through `wp_kses` with an allowlist on the way in. A
sanitiser on the way out is one that a second reader (the storefront, an export, a search indexer)
does not run.

The allowlist here is wider than §85's email-safe one — a page may carry a table and a figure — and
narrower than `wp_kses_post`: no `<script>`, no `<iframe>`, no `on*`, no `javascript:` or `data:` in
any href or src, and no `<style>`.

> **Corrected in the build: this is not belt-and-braces, and the reason is a clause in §61.** That
> section recorded that WordPress "already runs `wp_kses_post` over anything saved by a user without
> `unfiltered_html`" — which is true, and an **administrator holds `unfiltered_html`**, so
> `kses_init()` removes every filter for exactly the caller most able to do damage. Measured
> 2026-08-17: `wp_insert_post()` as an administrator stored `<script>alert(1)</script>` and an
> `onclick` byte for byte; the same call as a Marketing Manager did not. `tests/Api/cms.php` therefore
> runs its XSS assertions **as an administrator**, against the stored row rather than the response,
> with that measurement as the control beside them.
>
> **The homepage document is sanitised too, which this section does not ask for.** It names page
> content, banner copy and FAQ answers — all fields. The homepage has none: a section's `data` is
> free-form, so there is nothing to point an allowlist at, and a `<script>` in a `text` section would
> be stored verbatim. Running `wp_kses` over every string leaf was the obvious fix and is wrong:
> measured the same day, it rewrites `Tapis & Kilims` to `Tapis &amp; Kilims` and `?a=1&b=2` to
> `?a=1&amp;b=2`. So `ContentHtml::looksLikeMarkup()` routes a leaf to the allowlist only when it
> carries something that will parse as a tag. The named cost is that `a <b` in prose is treated as
> markup.

### The homepage is edited whole, and the drop report becomes a refusal

`GET /cms/homepage` already reports malformed sections it had to drop, in `meta`, because an option
edited by hand fails silently otherwise. On **write**, a malformed section is a **400** naming its
index and its problem — `sections[2].type` — because at that point there is a human with a form who
can fix it, and dropping their work quietly is the one failure a content manager cannot diagnose.

`PUT` replaces the document. There is no section-level route: sections are ordered, and an API that
lets two clients insert at index 2 concurrently has invented a merge problem the shop does not have.
The panel sends the whole array; the response carries the stored document back.

### Menus

`PUT /cms/menus/{location}` replaces the whole menu for `primary` or `footer` with an ordered tree:

```json
{ "items": [
  { "label": "Tapis", "type": "category", "object_id": 21, "children": [] },
  { "label": "Conditions", "type": "page", "path": "legal/terms", "children": [] },
  { "label": "Instagram", "type": "url", "url": "https://…", "children": [] }
] }
```

Two levels deep, maximum 50 items. WordPress nav-menu items are posts with meta and an ordering
field, and exposing that shape would make the panel implement WordPress's data model instead of the
shop's. `type` is `page`, `category`, `product` or `url`; a `url` must be `http` or `https`, per
§71's rule about `javascript:` being a valid URL.

> **Corrected in the build: the writer also accepts what the reader returns, and a refused write
> touches nothing.** `CmsPresenter::menu()` has published WordPress's vocabulary since §61 — `type` is
> `post_type` with `object: page`, and the label is `title` — and "GET the menu, drag one item, PUT it
> back" is the only interaction a menu screen has. Accepting only the shape above would have made
> `docs/API.md`'s round-trip promise have an exception in it, and changing the read shape would have
> broken every existing caller. So `MenuInput` normalises both. A root-relative `/soldes` is accepted
> alongside `http`/`https`, because a storefront's own routes carry no scheme; `//host` is not.
>
> **A missing menu is created and assigned**, which this section leaves unsaid: `get_nav_menu_locations()`
> on this install returned `primary` and no `footer`, and a PUT that 404ed until somebody opened
> Appearance → Menus would be useless for the case it exists for.
>
> **The first version emptied the menu before it validated the tree** — it deleted the existing items,
> then resolved each page path as it wrote, so a payload naming one page that did not exist destroyed
> a shop's navigation and answered 400. Every reference is now resolved before anything is deleted.
> Two more of the same shape were found with it (an FAQ created and *then* refused for an unknown
> category; a page created and then refused for a bad `seo.image_id`), which is what made it a rule:
> **resolve every reference before the first write.**

### SEO writes through the resource

Unchanged from §62. A page's `seo` block is written by `PATCH /cms/pages/{slug}`, and SEO errors land
in the same `details.fields` list as the rest of the write. There is no SEO endpoint and this section
does not add one.

---

## §90 — The notification queue, read and retry

PLAN §52 lists Notifications. §59d deliberately built none: *"§29 asks for an abstraction, not an
endpoint."* That was right for sending, and it leaves an operator with no way to answer "did the
customer get their confirmation?" without `wp eval`.

### Routes

| Method | Route | Guard |
|---|---|---|
| GET | `/notifications` | `ac_manage_customers` |
| GET | `/notifications/{id}` | `ac_manage_customers` |
| POST | `/notifications/{id}/retry` | `ac_manage_customers` |

> **Built.** `src/Notifications/` — `NotificationController` and
> `NotificationPresenter`, three methods on `NotificationService`, three on
> `NotificationRepository`. No migration, no table, no new capability.
> `docs/API.md` → "Notifications" is the contract; `tests/Api/notifications.php` grew 35 assertions.
>
> **One thing this section could not have anticipated, and it is a MySQL fact.** The retry is a single
> conditional `UPDATE … WHERE id = %d AND status <> 'sent'`, so that a drain sending the row between a
> read and a write cannot be raced — §85's claim, at one row's scale. But MySQL reports rows it
> *changed*, not rows it *matched*: measured 2026-08-17, the statement affected **zero** rows against a
> row that was already `pending` with zero attempts and no error, so retrying an already-queued
> notification answered **409 "already sent"** about something that had never been sent. Zero affected
> rows is resolved by re-reading; the guarantee is untouched, because a `sent` row is still never
> written.

### The capability is `ac_manage_customers`, and no new one is invented

A notification row holds a customer's email address and the frozen message body, which on an order
confirmation contains their name and what they bought. §63's rule applies — *reporting may not
disclose in aggregate what the caller cannot already read in detail* — and the capability that
already reads a customer's record is the honest gate. §61's media gap set the precedent for not
inventing a capability to close a hole.

This is read-and-retry only. **Nothing sends on a request path**, which was §59d's whole design and is
stronger here than anywhere: an SMTP server that hangs would hang the panel. `retry` clears the row's
`status` and `attempts` so the next drain picks it up, and answers `202` with the drain command name.
It never mails.

`GET /notifications` filters by `channel`, `status`, `dedupe_key` and date range, and orders newest
first. The list omits the message body; `GET /notifications/{id}` carries it, so a support agent
scanning a queue does not pull five hundred customers' order contents into one response.

---

## Part I build order

Four branches, in this order, each with its `tests/Api` suite before the merge:

```
feat/admin-users        §87   users, roles, application passwords
feat/attributes         §88   global attributes and terms
feat/cms-writes         §89   pages, banners, FAQs, menus, homepage
feat/notification-queue §90   read and retry
```

`docs/API.md` is updated in the same branch as each — `scripts/test-api.sh` → "documented contract"
fails the build otherwise, which is the point of it.

---

# Part II — Panel architecture

## The stack

| Concern | Choice | Note |
|---|---|---|
| Framework | Next.js 16.3, App Router, React 19.2, TypeScript 5.9 `strict` | Server Components for first paint, Route Handlers as the credential boundary. |
| Styling | Tailwind CSS 4.3, `@theme` tokens only | [Part III](#part-iii--the-design-system). Arbitrary values fail CI. |
| i18n | `next-intl` 4.13 | ICU messages, `/[locale]/…` routing, `dir` from the locale. |
| Server state | TanStack Query v5 (5.101) | For lists, filters and mutations. RSC renders the first screen; the client owns everything after it. |
| Forms | React Hook Form 7.85 + Zod 4 | Zod schemas are also what parse API responses at the boundary. |
| Behaviour primitives | Radix (or Ark) — unstyled only | Dialog, popover, select, tabs. Every visual property ours. |
| Charts | `visx` 4 or hand-rolled SVG, per the `dataviz` skill | Flat fills only. No gradient area charts. |
| Icons | One set, outline, 1.5 px stroke, self-hosted SVG sprite | Never an icon font. |
| Session sealing | `jose` 6.2 (JWE, A256GCM) | [below](#the-session-is-a-sealed-cookie). |
| Tests | Vitest 4.1 + Testing Library 16.3, Playwright 1.62 | Plus `scripts/check-design.sh`. |

Versions are the ones this repository resolves — `package.json` and `package-lock.json` are the
authority, and each is npm's current `latest` with **one exception: TypeScript**, where the range is
`^5` and 5.9.3 installs while 7.0.2 is published. That upgrade is a decision, not a version bump, and
it is not made here.

A major named here (**Zod 4**, **Query v5**, **Vitest 4**, **jose 6**, **Tailwind 4**) is
load-bearing: Query v4's positional `useQuery(key, fn)` and Tailwind 3's `tailwind.config.js` are
both gone, and Zod 4 renamed enough of Zod 3's surface that a snippet written against either will not
run here.

> **Corrected in the build: four Next 16 conventions that are not Next 15's.** `AGENTS.md` warns that
> this is not the Next.js in anyone's training data; these are the four that actually bit, all verified
> against the shipped docs in `node_modules/next/dist/docs/`.
>
> 1. **`middleware.ts` is now `proxy.ts`**, and the export must be named `proxy` or be the default.
>    The old filename is deprecated — the build prints `ƒ Proxy (Middleware)` when it is picked up.
>    next-intl still publishes its factory at `next-intl/middleware`; the package path and the file
>    convention are different things.
> 2. **`next/root-params` cannot be used, despite next-intl deprecating `requestLocale` in favour of
>    it.** The module ships as a placeholder replaced by a compiler pass, and that pass
>    (`next-root-params-loader`) is registered only in `webpack-config.js`. Next 16 builds with
>    Turbopack by default, where nothing substitutes it, so the import fails the build outright:
>    *"The export locale was not found… The module has no exports at all."* `getLocale()` from
>    `next-intl/server` works under both bundlers. It is also Server-Component-only by design — no
>    Route Handlers — so it could not have served the proxy route anyway.
> 3. **`params`, `searchParams` and `cookies()` are all Promises**, and `LayoutProps<'/[locale]'>` /
>    `PageProps` / `RouteContext<'/users/[id]'>` are generated global helpers rather than imports.
> 4. **The `eslint` key was removed from `next.config`**, and `next build` no longer runs ESLint at
>    all. A config carrying `eslint: { ignoreDuringBuilds: false }` is a type error, and — worse — a
>    project relying on the build to lint silently stops linting. Lint is its own stage in
>    `scripts/test.sh`.

No CSS-in-JS runtime. No component library. No `next/font/google` — the fonts are in the repository,
because a build that fetches a font from a third party at deploy time is a build that fails when that
third party does.

## Repository layout

```
ecom-admin/
  app/
    [locale]/
      (auth)/login/
      (panel)/
        dashboard/  orders/  products/  inventory/  customers/
        coupons/    shipping/ payments/ analytics/  content/
        media/      marketing/ campaigns/ notifications/
        settings/   users/    audit/    import-export/
      layout.tsx
    api/
      ac/[...path]/route.ts     ← the only place a credential is attached
      session/route.ts          ← login, logout
  lib/
    api/        client.ts, envelope.ts, errors.ts, schemas/
    session/    seal.ts, read.ts
    capabilities.ts
    format/     money.ts, date.ts, number.ts
  components/
    primitives/ Button, Field, Sheet, List, Segmented, Toast, …
    patterns/   DataList, DetailScaffold, FilterBar, EmptyState, …
  messages/     fr.json, ar.json
  styles/       tokens.css, globals.css
  public/       fonts/, icons/, manifest.webmanifest
  scripts/      check-design.sh
```

`components/primitives` holds things with no knowledge of commerce. `components/patterns` holds the
five or six compositions every screen reuses. A component that knows what an order is lives beside
the route that renders it, not in `components/`.

## The credential boundary

```
browser  →  Next.js Route Handler  →  /wp-json/algerian-commerce/v1
            (attaches Authorization: Basic)
```

The browser never holds an Application Password, never sees one in a payload, and never talks to the
WordPress host directly. This is roadmap §19 and §44 and it is the rule the whole architecture rests
on: a leaked Application Password is full admin access to the shop.

Consequences worth stating because each has been got wrong somewhere before:

- **`AC_CORS_ORIGINS` is irrelevant to the panel in production.** Requests come from the Next.js
  server, which is not a browser and sends no `Origin`. If you find yourself adding the panel's
  origin to the allowlist to make something work, something is calling the API from the browser and
  that is the bug.
- **No `NEXT_PUBLIC_*` variable ever holds a credential.** The only public variables are the locale
  list and the panel's own base URL.
- **The proxy is an allowlist, not a pass-through.** `app/api/ac/[...path]/route.ts` matches the
  incoming path against a list of permitted route patterns before forwarding. A generic proxy that
  forwards anything under `/wp-json/` is an open relay to `/wp/v2/users` with an admin credential
  attached — the exact thing `docs/API.md` opens by telling you not to touch.
- **The proxy strips response headers it does not need** and never forwards `Set-Cookie` from
  WordPress in either direction.

## The session is a sealed cookie

Login collects a WordPress **username** and that user's **Application Password**.

```
POST /api/session      { username, password }
  → server calls GET /auth/me with Authorization: Basic
  → 200: seal { username, password, userId } as JWE, set cookie, return the identity
  → 401: return 401. Do not say whether the username exists.
  → 429: return 429 with Retry-After — this is the API's failed-login bucket and it is real
```

The cookie:

| Attribute | Value | Why |
|---|---|---|
| name | `ac_admin_session` | |
| `httpOnly` | true | The panel's own JavaScript must not be able to read a credential either. |
| `secure` | true outside development | |
| `sameSite` | `lax` | `strict` breaks returning from an external payment provider's dashboard; `lax` is sufficient because every mutation is a POST from same-origin script. |
| `path` | `/` | |
| max age | 12 hours, rolling | A warehouse phone left on a bench is the threat model. |
| payload | JWE, `A256GCM`, key from `SESSION_SECRET` | Encrypted, not signed — the payload *is* the credential. A signed-but-readable cookie hands the password to anyone who reads a proxy log. |

Rotate the seal on every response so the 12 hours are since last use. Clear on logout, and clear on
any **401** from the API — the Application Password was revoked or the account was suspended, and
holding a dead credential produces a panel that renders and then fails on every action.

> **Corrected in the build: detect a 401 by its status, never by `error.code`.** `docs/API.md`'s error
> table lists 401 as `unauthenticated`, and a panel keyed on that string would have missed every real
> case. Measured 2026-08-18:
>
> | Request | Status | `error.code` |
> |---|---|---|
> | No credential | 401 | `unauthenticated` |
> | Wrong Application Password | 401 | **`incorrect_password`** |
> | Suspended account | 401 | **`account_suspended`** |
>
> The second is WordPress's own message surfacing through the envelope. `ApiError.isAuthFailure` is
> therefore `status === 401` and nothing else; `isSuspended` reads the code only to choose the wording,
> because signing in again will never fix a suspension and silence sends the person round the loop.

A **403** is not a logout. It means this role cannot do this thing, and the correct response is the
forbidden state described in [Part V](#every-screen-has-five-states), not a bounce to the login page.

### What the panel cannot do about a lost device

Nothing, directly — and it should say so. Revoking a session means revoking the Application Password,
which is §87's `DELETE /users/{id}/application-passwords/{uuid}`. The account screen lists a user's
passwords by name and last-used date and offers exactly that. This is why §87 mints them with a
device name in the first place.

## Capabilities are for rendering, never for access

`GET /auth/me` returns the caller's `ac_*` capabilities, filtered to this plugin's vocabulary. The
panel uses it to decide which tabs exist, which buttons render and which routes redirect.

`AuthController` says it in its own docblock and it bears repeating here: **a client that hides a
button is a convenience, not a security boundary.** Every route enforces its own
`permission_callback`; the panel must be built so that a user who types a URL they cannot use gets a
clean forbidden screen rather than a broken one.

Two capability rules are compound and get missed:

- **Money in analytics needs `ac_view_analytics` *and* `ac_manage_orders`.** Without the second,
  `/analytics/revenue` is 403 and every other analytics response omits its money block and says so in
  `meta.money_visible`. The dashboard must render a coherent screen in that state — a Support Agent
  sees counts and rates, and no empty currency-shaped holes.
- **Sending a campaign needs `ac_manage_marketing` *and* `ac_manage_customers`.** A Marketing Manager
  can draft, preview and test-send, and gets a 403 from `send`. `docs/API.md` says it outright: *a
  403 from `send` with a 201 from `POST /campaigns` is not a bug.* The composer renders the send
  button disabled with the reason, not hidden — a hidden button makes a Marketing Manager think the
  feature is broken.

Encode this once, in `lib/capabilities.ts`, as named predicates — `canSeeMoney(me)`,
`canSendCampaigns(me)` — never as capability strings compared inline in a component. There are two
compound rules today and the third will be added in one place.

> **Corrected in the build: staff roles collapsed to two tiers, and both compound rules stopped
> discriminating.** Shipped in `ecom-temp` on `feat/two-tier-roles`, 2026-08-20. §45's seven roles are
> now **Super Admin** (all 13 capabilities) and **Manager** (`ac_manager`'s existing seven: products,
> inventory, orders, customers, coupons, shipping, analytics). The other five —
> `ac_admin`, `ac_product_manager`, `ac_order_manager`, `ac_marketing_manager`, `ac_support_agent` —
> are **retired, not deleted**: still defined, still installed, still published by `GET /roles` with a
> new `assignable` flag, still valid in `?role=`, no longer granted. 54 accounts moved; 25 Super Admin,
> 43 Manager, 2 `administrator` untouched.
>
> Deleting them would have been the obvious move and was the dangerous one: `remove_role()` never
> touches `wp_capabilities` usermeta, so a live account left pointing at a removed role resolves to
> **zero capabilities** — it authenticates normally and answers 403 on every route. Retiring avoids the
> failure rather than sequencing around it.
>
> **Nothing in the panel's authorization changed, and that is the point.** Every guard in the API is
> `current_user_can()`; across all 182 guard sites not one checks a role name, and `lib/capabilities.ts`
> reads `/auth/me`'s capability list. Pre-collapse Application Passwords still authenticate — they are
> per account, not per role — so no credential was re-minted and no session broke.
>
> **What did change is that neither compound rule gates anything any more.** Measured against the live
> API the same day, both tiers:
>
> | | Super Admin | Manager |
> |---|---|---|
> | `/analytics/revenue` | 200 | **200** |
> | `meta.money_visible` on `/analytics/overview` | `true` | **`true`** |
> | `/campaigns`, `/marketing/config` | 200 | 403 |
> | `/settings`, `/users`, `/audit-logs` | 200 | 403 |
>
> `canSeeMoney()` is `ac_view_analytics` **and** `ac_manage_orders`, and Manager holds both — so
> **every staff account now sees money**, and the money-gated dashboard has no role that can exercise
> it. `canSendCampaigns()` is `ac_manage_marketing` **and** `ac_manage_customers`, and Manager holds
> neither half of marketing — so campaigns is now a plain single-capability 403 and **"drafts but
> cannot send" is a state no role reaches**.
>
> Both predicates stay in `lib/capabilities.ts`, correct and unchanged. They are the right encoding of
> rules the API still enforces, and a third tier or a widened Manager would make them bite again. What
> they can no longer do is supply a test fixture — see [Part VII](#what-the-e2e-suite-must-cover).

## The API client

One typed client in `lib/api/`. Three jobs:

**Unwrap the envelope.** Every response is `{ success, data, meta? }` or
`{ success: false, error: { code, message, details } }`. Callers receive `data` or a thrown typed
error; no component ever writes `response.data.data`.

**Map errors to behaviour**, once, by `error.code` and status:

| Status | Behaviour |
|---|---|
| 400 | Field errors from `details.fields` onto the form. **Render the field list, not the top-level message** — `docs/API.md` says a 400 lists *every* bad field, and a toast saying "The product data is invalid" throws that away. |
| 401 | Clear the session, redirect to login with a "signed out" notice. |
| 403 | Forbidden state on the screen. Never a logout, never a toast that disappears. |
| 404 | Not-found state. On `/account/orders/{id}` it means "not yours"; in the panel it means gone. |
| 409 | **Read the body.** Status transitions return what moves are legal; a duplicate SKU names the SKU. This is the one error class where the API's message is worth surfacing verbatim. |
| 413 / 415 | Upload-specific, handled in the media picker. |
| 429 | Back off by `Retry-After`, show a countdown, retry once automatically. Never retry a POST. |
| 5xx | Generic failure state with a retry. Never surface diagnostics; the API sends none. |

**Parse, don't trust.** Zod schemas at the boundary for every resource the panel renders. When the
API changes shape, the panel fails at the boundary with a legible message instead of rendering
`undefined` three components deep. The schemas are **loose** — `z.looseObject({…})`, which is Zod 4's
name for what Zod 3 called `.passthrough()` and what Zod 4 still accepts under that name with a
deprecation — so an added field is not a breaking change; only a *missing* or *retyped* one is.

## Data fetching

**Server Components render the first screen.** A list route's page component fetches page one on the
server with the sealed credential and streams it. First paint carries data; there is no spinner on
navigation.

**TanStack Query owns everything after.** Filters, pagination, sorting, mutations, refetching. Query
keys mirror the URL so the two never disagree.

> **Corrected in the build: there is no `wilaya` filter on `/orders`, and `status` takes one value.**
> The example below is `?status=processing&wilaya=16&page=2`; two thirds of it is real. Measured
> 2026-08-18 against the live router, with `?bogus_param=1` as the control for "silently ignored" and
> `?search=Nadia` (633 → 92) as the control for "really filters":
>
> | Sent | Answer |
> |---|---|
> | `?wilaya=16` | **200, all 633 rows** — identical to `?bogus_param=1`. Ignored, not honoured. |
> | `?status=processing,pending` | **400** `status is not one of pending, processing, on-hold, …` |
> | `?per_page=500` | **400**, not clamped — see the note under [Part V](#orders) |
>
> `OrderController::collectionParams()` accepts exactly `search`, `status`, `customer_id`, `date_from`,
> `date_to`, `orderby`, `order`, `page`, `per_page`. So the segmented control is single-select because
> the API is, and a wilaya filter would need a backend change rather than a query parameter.
>
> **`push`, not `replace`, when writing the filter to the URL.** This section promises the back button
> works, and `router.replace()` silently breaks that half of it: replacing the history entry means
> going back from a filtered list skips the unfiltered one. Caught by the e2e test that asserts it.

**Filter state lives in the URL.** `?status=processing&wilaya=16&page=2`. A support agent shares a
link to the orders they are looking at; a refresh does not lose the filter; the back button works.
This is also what makes the RSC/Query split coherent — the server reads the same search params the
client writes.

### Polling, and the rate limit it must respect

Reads are 600/min **per credential**, and one staff member with the orders board open in two tabs is
one credential. An orders list polling every 5 seconds is 24/min for one tab; four staff with two
tabs each is 192/min before anyone clicks anything. It does not break, and it is a quarter of the
budget spent on nothing.

Rules: no polling interval below **30 seconds**; polling pauses when the document is hidden
(`refetchIntervalInBackground: false`); only the orders list and the campaign-send progress poll at
all. Everything else refetches on window focus and on mutation.

## Routing and navigation

`/[locale]/(panel)/…`, with `fr` and `ar` the only locales. The locale segment is present always —
no implicit default — because a shared link must render in the language it was shared in.

Navigation is a **bottom tab bar on mobile** with five destinations, chosen by what the role can do:

```
Orders   Products   Dashboard   Customers   More
```

`Dashboard` sits centre. `More` opens a grouped inset list of everything else — Inventory, Shipping,
Payments, Coupons, Content, Media, Marketing, Campaigns, Notifications, Import/Export, Users,
Settings, Audit — filtered by capability, in a full-height sheet.

A role holding fewer than five of the primary destinations gets its tabs backfilled from `More` in a
fixed order, so a Marketing Manager's tab bar is coherent rather than three tabs and two gaps.

At `md` and up the tab bar becomes a fixed sidebar with the same order and the same grouping. It is
the same tree, not a second navigation model.

---

# Part III — The design system

Invoke the `impeccable` skill and the Apple/iOS skill before writing components. What follows is the
constraint set they work inside, plus the decisions that are specific to this shop.

## Tokens are the only source of values

`styles/tokens.css` defines everything as CSS custom properties inside Tailwind v4's `@theme`, which
publishes them as both variables and utilities. **No component declares a colour, a radius, a
duration or a shadow that is not a token.** `scripts/check-design.sh` greps for hex literals,
`rgb(`, `oklch(` and arbitrary-value brackets in `app/` and `components/` and fails on any hit.

### Colour

Apple's system palette, because "iOS-like" is the brief and an approximation of it reads as a
knock-off. Light and dark are both first-class; dark is not an afterthought filter.

**`@theme` is declared once, at the top level.** Tailwind v4's `@theme` is not a nestable rule — it
cannot go inside `@media`, and a build that tries silently drops the block. Theme variants are plain
custom-property redefinitions on `:root`, which work because `@theme` emits its values as variables
that the generated utilities reference.

```css
@import "tailwindcss";

@theme {
  /* surfaces — elevation is a surface step, never a shadow */
  --color-bg:            #ffffff;
  --color-bg-grouped:    #f2f2f7;   /* the ground behind inset lists */
  --color-surface:       #ffffff;
  --color-surface-2:     #f2f2f7;
  --color-surface-3:     #e5e5ea;

  /* text */
  --color-label:           rgb(0 0 0 / 1);
  --color-label-secondary: rgb(60 60 67 / 0.60);
  --color-label-tertiary:  rgb(60 60 67 / 0.30);

  /* separators — the hairline is structural, not decorative */
  --color-separator:       rgb(60 60 67 / 0.29);
  --color-separator-opaque:#c6c6c8;

  /* semantics */
  --color-accent:  #007aff;   /* the one token a client rebrands */
  --color-success: #34c759;
  --color-warning: #ff9500;
  --color-danger:  #ff3b30;
  --color-info:    #5856d6;
}

/* one dark palette, applied by the system default and by the explicit toggle */
@layer theme {
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { /* …the dark values… */ }
  }
  :root[data-theme="dark"] {
    --color-bg:            #000000;
    --color-bg-grouped:    #000000;
    --color-surface:       #1c1c1e;
    --color-surface-2:     #2c2c2e;
    --color-surface-3:     #3a3a3c;
    --color-label:           rgb(255 255 255 / 1);
    --color-label-secondary: rgb(235 235 245 / 0.60);
    --color-label-tertiary:  rgb(235 235 245 / 0.30);
    --color-separator:       rgb(84 84 88 / 0.60);
    --color-separator-opaque:#38383a;
    --color-accent:  #0a84ff;
    --color-success: #30d158;
    --color-warning: #ff9f0a;
    --color-danger:  #ff453a;
    --color-info:    #5e5ce6;
  }
}
```

Write the dark values **once**, as a custom-property group the two selectors both apply, rather than
maintaining two copies that drift. There are three theme states, not two: an explicit `light`, an
explicit `dark`, and the default where nothing is stamped and only `prefers-color-scheme` decides. A
colour whose only definition lives inside the media query disappears the moment someone picks the
other theme manually, so **every token has a value on bare `:root`**.

**Semantic colour is never the only signal.** Red for a failed payment carries an icon and a word;
7 % of male users cannot separate it from green, and a warehouse phone in sunlight flattens both.

### Type

IBM Plex Sans and IBM Plex Sans Arabic, variable, self-hosted from `public/fonts`, subset to
Latin + Latin-1 + Arabic and preloaded. `font-display: swap` with a metric-adjusted fallback so the
swap does not reflow the list under the reader's thumb.

> **Corrected in the build: IBM Plex Sans Arabic has no variable build, so the Arabic face is two
> static weights.** Measured 2026-08-18: `@fontsource-variable/ibm-plex-sans-arabic` is a 404 on the
> registry, and IBM's own `@ibm/plex-sans-arabic@1.1.0` ships `fonts/complete/woff2/` as eight named
> static weights with no variable file among them. The Latin face is genuinely variable
> (`@fontsource-variable/ibm-plex-sans@5.3.0`, 45.7 KB for the `latin` subset), so "variable" now
> describes one of the two faces rather than both.
>
> The Arabic face therefore ships as **400 and 600**, 42.8 KB and 45.7 KB, and `[dir="rtl"]` maps the
> scale's 700 steps onto 600 — Plex Arabic SemiBold is already heavy at display size, so the large
> title keeps its hierarchy. A third file for 700 would have cost another 46 KB to make two headings
> marginally heavier.
>
> `unicode-range` is what makes this affordable: a French screen never fetches an Arabic file, so
> `fr` transfers 45.7 KB and `ar` transfers 134.2 KB. See the corrected budget in
> [Part IX](#part-ix--performance-budgets).

The scale is iOS's, which is why it will not look like a web dashboard. Note the body size: **17 px**,
not 16.

| Token | Size / line | Weight | Used for |
|---|---|---|---|
| `--text-large-title` | 34 / 41 | 700 | The collapsing screen title |
| `--text-title-1` | 28 / 34 | 700 | Section heads |
| `--text-title-2` | 22 / 28 | 600 | Card heads, sheet titles |
| `--text-title-3` | 20 / 25 | 600 | Grouped-list group titles |
| `--text-headline` | 17 / 22 | 600 | The primary line of a list row |
| `--text-body` | 17 / 22 | 400 | Body, form values |
| `--text-callout` | 16 / 21 | 400 | Dense tables at `md`+ |
| `--text-subhead` | 15 / 20 | 400 | The secondary line of a list row |
| `--text-footnote` | 13 / 18 | 400 | Timestamps, helper text |
| `--text-caption` | 12 / 16 | 400 | Table column heads, badges |

Numbers use `font-variant-numeric: tabular-nums` **everywhere they appear in a column** — money,
stock counts, order ids, dates. A right-aligned price column with proportional figures is the single
most common tell of an interface nobody tuned.

**Arabic is set slightly larger.** Plex Sans Arabic's x-height sits lower than the Latin's, so at 17 px
it reads smaller. `[dir="rtl"]` scales the root by `1.0625` and adds `0.08em` of line-height. This is a
typographic fact, not a preference.

### Space, radius, hairline

An 8 pt grid with a 4 pt half-step: `4 8 12 16 20 24 32 40 48 64`. Nothing between.

Radii: `--radius-sm: 8px` (badges, inputs), `--radius-md: 12px` (buttons), `--radius-lg: 14px`
(cards, grouped list containers), `--radius-xl: 20px` (sheets, top corners only), `--radius-full`.
iOS radii are larger than web defaults, and this is most of why a screenshot reads as iOS.

The hairline is a real token because it is a real thing:

```css
--hairline: 1px;
@media (min-resolution: 2dppx) { :root { --hairline: 0.5px; } }
```

A 1 px separator on a phone is a rule; a 0.5 px separator is a hairline. Every grouped list, nav bar
and tab bar uses it.

### Elevation without gradients or shadows

iOS builds depth from **surface lightness and hairlines**, not from drop shadows. So:

- A card is `--color-surface` on `--color-bg-grouped`, with `--radius-lg`. No border, no shadow.
- Nested surfaces step up: `surface` → `surface-2` → `surface-3`. Three steps is the whole vocabulary.
- Shadow exists for exactly two things — a **sheet** and a **popover** — because those float over
  content and need to say so. `--shadow-overlay: 0 8px 32px rgb(0 0 0 / 0.16)`. Nothing else in the
  panel casts a shadow.
- Navigation and tab bars use a **material**: `background: color-mix(in srgb, var(--color-bg) 72%, transparent)`
  plus `backdrop-filter: blur(20px) saturate(180%)`, with a hairline on the content edge. Provide a
  `@supports not (backdrop-filter: blur(1px))` fallback to the opaque surface — never to a gradient.

### Status without an accent bar

The banned pattern needs a named replacement or it comes back. Status is communicated three ways,
chosen by density:

1. **A tonal badge** — the semantic colour at low alpha for the fill, the same colour at full
   strength for the label, `--radius-full`, `--text-caption`, uppercase off. This is the default in
   lists and on detail headers.
   `background: color-mix(in srgb, var(--color-warning) 14%, transparent); color: var(--color-warning);`
2. **A leading dot** — 8 px, semantic colour, when the row is already dense and a badge would crowd
   it. Always beside a text label; never the only signal.
3. **Typographic weight** — an unread or action-needed row sets its primary line to 600. Used for
   "needs attention", never for status itself.

No coloured left border. No coloured full-width strip above a card. No coloured card background.

### Motion

One easing curve, iOS's: `--ease-ios: cubic-bezier(0.32, 0.72, 0, 1)`. Three durations: `--dur-fast:
180ms` (state changes, toggles), `--dur-base: 280ms` (sheets, navigation), `--dur-slow: 420ms` (the
large-title collapse, pull-to-refresh release).

Transforms and opacity only. Never animate `width`, `height`, `top` or `background-color` — a list
that janks while it filters is worse than one that snaps.

`@media (prefers-reduced-motion: reduce)` collapses every transform animation to a 120 ms opacity
fade and disables the parallax on the large title. This is a correctness requirement, not a courtesy;
vestibular disorders are common and the panel is used on a phone in motion.

### Touch

- **44 × 44 CSS px minimum** for anything tappable. A 20 px icon gets a 44 px hit area via padding or
  a pseudo-element, not by growing the icon.
- 8 px minimum between adjacent targets.
- Destructive actions are never adjacent to their non-destructive neighbour in a list. `?force=true`
  deletes get their own confirmation step regardless.
- `:active` states are visible and immediate — `scale(0.97)` with `--dur-fast` — because a phone has
  no hover and a tap with no feedback gets tapped again.
- `touch-action: manipulation` on every control to kill the 300 ms double-tap delay.
- `overscroll-behavior: contain` on every scroll container, so pulling a sheet's list does not drag
  the page behind it.

### Safe areas

`viewport-fit=cover` in the viewport meta, then `env(safe-area-inset-*)` on the tab bar, the nav bar
and every sheet. A tab bar that sits under the iPhone home indicator is unusable and looks like a
website pretending to be an app — which is precisely the failure mode this brief exists to avoid.

## The iOS patterns this panel uses

Each of these is a primitive in `components/primitives`, built once.

**Grouped inset list.** The workhorse. `--color-surface` rounded block on `--color-bg-grouped`, rows
separated by hairlines that inset from the leading edge to the text (not the icon), a group title in
`--text-title-3` above and an optional footnote below. Every detail screen, every settings screen and
every form in this panel is a grouped inset list. This single pattern carries most of the iOS
character and most of the mobile ergonomics.

**Large title that collapses.** The screen title starts at `--text-large-title`, left-aligned (
leading-aligned — see [Part IV](#part-iv--arabic-and-rtl)), below the nav bar. On scroll it shrinks
and moves into the nav bar as `--text-headline`, and the nav bar's material becomes opaque with its
hairline. Driven by a scroll listener with `IntersectionObserver`, not by a scroll handler that runs
on every frame.

**Sheet with detents.** Forms and filters open as bottom sheets, not as page navigations. Detents at
`medium` (≈ 55 vh) and `large`; a grabber; dismiss by drag or backdrop tap; `--radius-xl` on the top
corners only. On `md` and up the same component renders as a centred modal — one component, two
presentations.

**Segmented control.** For 2–4 mutually exclusive filters (order status, date range, product status).
Full width on mobile, `--radius-md`, the selected segment on `--color-surface` inside a
`--color-surface-2` track, animated with a transform.

**Action sheet.** Destructive and multi-choice actions. Bottom-anchored on mobile, the destructive
option in `--color-danger`, `Annuler` / `إلغاء` in its own group beneath. Never a browser `confirm()`.

**Swipe actions on list rows.** Leading swipe for the common non-destructive action (mark processing,
adjust stock), trailing swipe for destructive with a confirm step. Every swipe action also exists in
the row's overflow menu, because swipe is not discoverable and is not available to a keyboard.

**Pull to refresh** on every list. Spring-eased, respects reduced motion, and calls the same refetch
the focus listener does.

**Toast.** Bottom-anchored above the tab bar, respecting safe area, one at a time, 4 seconds,
dismissible. Toasts confirm; they never carry error detail that the user needs to act on — that goes
on the screen.

---

# Part IV — Arabic and RTL

Both directions are first-class from the first component. Retrofitting this is a rewrite.

## Physical properties are banned

Not discouraged — banned, and checked. `scripts/check-design.sh` fails on `ml-`, `mr-`, `pl-`, `pr-`,
`left-`, `right-`, `text-left`, `text-right`, `border-l`, `border-r`, `rounded-l`, `rounded-r` in
`app/` and `components/`, and on `margin-left`, `padding-right`, `left:`, `right:` in CSS.

Use `ms-` / `me-` / `ps-` / `pe-` / `start-` / `end-` / `text-start` / `text-end` / `border-s` /
`border-e` / `rounded-s` / `rounded-e`. Tailwind v4 ships all of them.

Flexbox and grid are direction-aware already — `flex-row` follows `dir`, so most layout needs nothing.
The places that break are absolute positioning, transforms and box-shadow offsets, and those are the
ones the check catches.

## What mirrors and what does not

| Mirrors | Does not mirror |
|---|---|
| Layout, navigation, list disclosure chevrons | Numbers — always LTR, in every locale |
| Back and forward arrows | Phone numbers, SKUs, tracking numbers, order ids |
| Progress and timeline direction | Media playback controls |
| Chart axis order and bar direction | Logos, product images, the courier's brand marks |
| Text alignment | Clock icons, checkmarks, most pictograms |

A tracking number or a SKU inside Arabic text needs `dir="ltr"` and `unicode-bidi: isolate` on its
own element, or the bidi algorithm reorders it and a customer reads back a number that does not
exist. Ship a `<Ltr>` primitive and use it for every identifier. This is the single most common bug
in bilingual admin tools and it is silent — nothing errors, the number is just wrong on screen.

## Fonts across scripts

Both faces load, and `unicode-range` routes each codepoint to the right one automatically:

```css
@font-face { font-family: "Plex"; src: url("/fonts/plex-sans-var.woff2") format("woff2-variations");
             unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+2074, U+20AC; }
@font-face { font-family: "Plex"; src: url("/fonts/plex-sans-arabic-var.woff2") format("woff2-variations");
             unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF; }
```

One family name, two files. An Arabic wilaya name inside a French sentence — `Alger / الجزائر` — sets
correctly with no per-element font switching, which matters because §51's geography data carries both
names on every row and they appear side by side throughout the panel.

## Numbers, dates and money

**Western digits in both locales.** Algeria uses `0123456789` in Arabic text; Eastern Arabic numerals
would be wrong here and unreadable to the staff using this. Pin it — do not rely on the locale
default:

```ts
new Intl.NumberFormat("ar-DZ-u-nu-latn", { … })
```

**Money is formatted, never computed.** The API returns decimal strings and has already done the
arithmetic; the panel's job is to render `26350.00` as `26 350,00 DA`. There is no client-side
subtotalling, no "estimated total", no tax calculation. `docs/API.md` puts it plainly for the
storefront — *you cannot set prices* — and the same discipline applies here for a different reason:
a panel that computes its own total will eventually disagree with the order, and the order is right.

Never parse money into a JavaScript number for anything but display width. `Intl.NumberFormat` takes
the string.

**Dates** come back as ISO 8601 with an offset. Render in the shop's timezone, which the panel reads
once from `/settings` and holds — not the browser's, or a manager in France sees yesterday's orders
dated today. Relative time ("il y a 2 h" / "منذ ساعتين") for anything under 24 hours, absolute after.

> **Corrected in the build: `/settings` carries no timezone, and not every date has an offset.** Two
> separate errors in the paragraph above, both measured 2026-08-18.
>
> **There is nothing to read.** `GET /settings` returns `store, contact, legal, social, features,
> providers`; the whole 630-byte response contains zero occurrences of `timezone` under any block, and
> `store` is `name, description, locale, currency, currency_symbol, storefront_url, logo_id, logo`. So
> the timezone is panel configuration — `NEXT_PUBLIC_SHOP_TIMEZONE`, defaulting to `Africa/Algiers`,
> which is UTC+1 year-round with no DST. (The dev install's own `wp_timezone_string()` is `+00:00`, an
> offset rather than a named zone, so it would not have been usable as an `Intl` time zone even if it
> were published.) Adding `store.timezone` to the API is the better long-term fix.
>
> **`created_at` on an order note has no offset**, unlike `date_created` on the order:
>
> ```
> order.date_created   "2026-08-18T02:52:22+00:00"   ISO 8601, offset present
> note.created_at      "2026-08-18 02:52:22"         no offset, no T
> ```
>
> `new Date()` parses the second as **local** time. Measured on a UTC+2 host, `"2026-08-18 02:52:22"`
> became `2026-08-18T00:52:22Z` — every order note off by the server's offset, with nothing on screen
> to show it. `lib/format/date.ts` reads an offsetless stamp as UTC explicitly, and the unit suite
> carries the naive parse beside it as the control.
>
> **Money needs the region subtag.** `Intl.NumberFormat("fr", …)` with `currency: "DZD"` renders
> `26 350,00 DZD`; `"fr-DZ"` renders `26 350,00 DA`, which is what this section asks for. A bare `fr`
> is a bug, not a simplification. `"ar-DZ-u-nu-latn"` gives `26.350,00 د.ج.` — Latin digits as
> required, and note that Arabic groups with `.` where French groups with U+202F.

## Copy

ICU messages in `messages/fr.json` and `messages/ar.json`. No string concatenation, ever — Arabic
word order is not French word order and `"Commande " + id + " expédiée"` cannot be translated.

**Error messages from the API are French-only**, because the API emits one language. Two rules: map
every `error.code` the panel can provoke to a localised message of its own, and fall back to the
API's `message` only for codes the panel does not know. The 409 bodies are the exception — the list
of legal status moves is data, and the panel renders it through its own status labels.

---

# Part V — The screens

Every area of PLAN §52, with what it reads, what it writes and what will bite.

## Every screen has five states

Not three. Build all five as part of the screen, not afterwards:

1. **Loading** — skeleton rows matching the real row height, never a centred spinner. A spinner
   reflows the page when data lands; a skeleton does not.
2. **Empty** — distinguishes *no data yet* from *no results for this filter*, and the second offers
   to clear the filter. One illustration-free line of text and one action.
3. **Forbidden (403)** — names the capability required and who to ask. A Support Agent hitting
   `/products` should read "Cette section demande la permission Produits" and not a blank page.
4. **Error** — one line, a retry, and the API's `message` only where it is actionable.
5. **Offline / stale** — see [Part VI](#part-vi--pwa-and-offline). A visible marker with the age of
   the data, not silent staleness.

> **Corrected in the build: the fifth state was a component nobody rendered.** `StaleBanner` has
> existed since the shell branch and, through the orders branch, was wired to **nothing** — a state
> that exists as a component and is reachable from no screen is a state the panel does not have. The
> products list renders it from `navigator.onLine` and TanStack Query's `dataUpdatedAt`, which is
> everything available before Part VI's service worker exists and enough to keep the rule: staleness is
> never silent.
>
> `navigator.onLine` reports the interface rather than reachability, so it is only trusted in one
> direction — when it is **false** the browser is certain. A failed fetch is the signal for the other
> direction, which is why `lib/api/client.ts` throws `NetworkError` instead of consulting it. It is
> also read in an effect rather than during render: reading `navigator` while rendering differs between
> the server and the first client paint, and a hydration error on every phone in a warehouse basement
> is two problems where there was one.
>
> The orders list still lacks it. Part VI generalises this, which is why `useOnline` lives in `lib/`.

> **Corrected in the build: there is a sixth state, and it had no screen at all.** *Not found* is not
> one of the five, because the five are states of a screen and this is the absence of one — but the
> panel still has to render something, and until now it rendered a **runtime error**.
>
> `app/layout.tsx` returns bare `children` on purpose: `<html lang dir>` is emitted by
> `app/[locale]/layout.tsx`, because direction comes from the locale and the root does not know it.
> That is right, and it means anything rendering *outside* the locale layout has no document tags —
> and Next's built-in global not-found is exactly that. Measured on 16.3.1: `/fr/nope`, `/ar/nope`,
> `/xx/orders` and every other unmatched address answered with
> *"Missing `<html>` and `<body>` tags in the root layout"* rather than a 404.
>
> Adding `app/[locale]/not-found.tsx` does **not** fix it — measured, it changed nothing, because a
> path that resolves to no page never matches the `[locale]` segment and Next walks to the root
> boundary. So `app/not-found.tsx` carries its own `<html>` and `<body>`, the only file in the panel
> that does. `getLocale()` still resolves there, since the proxy has populated the request scope, so
> `/ar/nope` is Arabic and mirrored; an unknown locale falls back to the default rather than throwing,
> because a 404 that throws is worse than a 404 in the wrong language.
>
> It carries no tab bar. Those live under `(panel)` and assume a session, and this screen is reachable
> signed out — a nav offering destinations that all bounce to the login form is worse than none.

## Dashboard

`GET /analytics/overview`, `/orders`, `/products`, `/customers`, `/cod`, `/shipping`.
`ac_view_analytics`.

Mobile is a single column of grouped cards: today's orders, pending fulfilment, low stock, COD
success rate, revenue (when visible). Each card is a tap target that navigates to the filtered list
behind it — a dashboard number that cannot be drilled into is decoration.

**Money gating is the whole trap.** `meta.money_visible` is false for a role without
`ac_manage_orders`, and the screen must be complete without it — not a layout with holes. Two card
sets, chosen by `canSeeMoney(me)`.

The 366-day window cap and `range` / `date_from` / `date_to` belong to a shared date-range control
used by every analytics surface. Responses are cached server-side for 60 s
(`AC_ANALYTICS_CACHE_TTL`); do not add a shorter client refetch on top of it.

Charts follow the `dataviz` skill. **Flat fills, no gradient areas, no drop shadows on bars.** Axis
direction mirrors in RTL; the numbers on it do not.

## Orders

`GET/POST /orders`, `GET/PATCH /orders/{id}`, `/orders/{id}/cancel`, `/notes`, `/timeline`.
`ac_manage_orders`.

The most-used screen in the panel. Design it for a phone held in one hand in a stockroom.

**List.** Rows: order number and status badge on the primary line; customer name, wilaya and total on
the secondary. Segmented control for the common statuses, sheet for everything else. Swipe leading to
advance status, trailing to open the action sheet. This is the one list that polls — 30 s, paused
when hidden.

> **Corrected in the build: the wilaya is usually not there, so the row shows a place *when known* and
> omits it otherwise.** Measured across all 633 orders on 2026-08-18: `billing.state` is filled on 41
> and `shipping.state` on 11 — about 8 % — while `city` is filled on 172. An em dash where the wilaya
> belongs would therefore be a column of dashes down 93 % of the panel's most-used screen.
>
> The row resolves `state` against `/locations/wilayas` for a bilingual name, falls back to `city`, and
> when neither exists renders the name and the total alone. Two things fell out of doing it:
>
> - **`name_ar` is empty for Algiers (16) and Oran (31)** — 2 of 69 rows, and the two highest-traffic
>   wilayas in the country, so an Arabic reader saw a blank exactly where a place was most likely to
>   exist. The panel falls back to the other script rather than rendering `""`. The remaining 67 rows
>   carry both names, which is the control that makes this a data gap rather than a wrong field name.
>   **This is a backend fix, not a panel one:** `wp_algerian_wilayas` should carry `الجزائر` and
>   `وهران`.
> - **`name` is the English exonym for wilaya 16** — "Algiers", not "Alger" — so the French locale
>   renders an English place name. Also a data fix.
>
> **Status counts, for anyone choosing which statuses earn a segment:** cancelled 266, pending 204,
> processing 63, refunded 63, completed 35, failed 1, on-hold 1. `failed` and `on-hold` are one row
> each, so they belong in the filter sheet rather than spending a quarter of the control's width. And
> the labels must be short: at 390 px four segments get 89 px each, and "En traitement" does not fit —
> the segmented control uses `statusShort`, while every badge keeps the full name.
>
> **`per_page` over 100 is a 400, not a clamp.** `docs/API.md`'s pagination section says "Asking for
> more than 100 is clamped, not an error"; measured, `?per_page=500` answers 400 with
> `details.params.per_page`. Note the envelope key: parameter errors arrive under `params`, not the
> `fields` that Part II's error table names.

**Detail.** A stack of grouped inset sections: summary, line items, customer, shipping, COD,
payments, notes, timeline. Each section pulls from its own route and renders independently, so a
missing shipment does not block the order.

> **Corrected in the build: three things about the detail response.**
>
> **`GET /orders/{id}` returns the same object as the list row** — measured, the two key sets are
> identical, with no field the list omits. A detail screen's richness comes entirely from the
> sub-resources, which is why one Zod schema serves both and why the sections below are the screen.
>
> **`timeline[].summary` and `notes[].content` carry HTML entities.** Measured verbatim:
> `"Stock levels reduced: Shipping test AC-SHIP-BOX (99&rarr;98)"`. React renders text, so those six
> characters appear on screen as typed. They are decoded to **text** — never handed to
> `dangerouslySetInnerHTML`, because the same fields carry note bodies a customer can influence. One
> single-pass decoder, so `&amp;rarr;` stays the literal `&rarr;` instead of becoming an arrow.
>
> **The timeline already contains the notes.** `/timeline` aggregates note, stock and audit events —
> the three notes on order 3078 are all present among its five entries — so rendering the full `/notes`
> collection underneath reprints every one of them. The notes section keeps `customer_note: true` rows
> only, which are the ones a support agent opened the screen for. `timeline[].actor` is `""` on
> system-generated stock events, so it is blank rather than absent and must be treated as missing.

**Status transitions are the trap.** `pending processing on-hold completed cancelled refunded failed`,
and **not every move is legal**: `cancelled` and `refunded` are terminal, `refunded` is reachable only
from `processing` or `completed`, and a new order may only be created in five of the seven states. Do
not hard-code the transition table in the panel — offer the moves, and when a 409 comes back, render
the allowed list from the response body. The API is the authority and it tells you.

**Line items may only be rewritten while the order holds no stock.** The editor is disabled with that
reason showing, rather than absent, once stock has moved.

**A parcel's status never moves the order.** The shipping section shows the parcel's own status
beside the order's and never merges them. §55 has been explicit about this since it was written, and
a panel that showed one number for both would be the first thing to break it.

## Products

`GET/POST /products`, `GET/PATCH/DELETE /products/{id}`, `/duplicate`, `/bulk`, `/variations`,
`/product-categories`, and §88's `/attributes`. `ac_manage_products`.

**List with §82's filters.** Nine filters plus facets. On mobile the filter bar is a horizontally
scrolling row of pills that opens the filter sheet; selected filters render as removable chips above
the list.

Facets are **opt-in** (`?facets=…`) and arrive in `meta.facets`. Three things to build correctly:

- **A facet's counts exclude its own filter.** With `pa_size=m` selected, the size facet still reports
  `l` and `xl` counts. Render every value in a group, including zero-count ones, so a selection never
  turns its siblings into dead ends.
- **Counts are published-only; the list includes drafts.** The panel will legitimately show seven rows
  beside a count of six. Render `scope_note` beside the facet block. Without it this reads as a bug
  and gets "fixed" by someone into something wrong.
- **Groups are capped at 50** with `truncated` and `total_values` beside them. Show "50 sur 128" when
  truncated; a bounded list that does not say so reads as complete.

> **Corrected in the build: the shop had no global attributes, the facet is not a vocabulary, and one
> of the three rules above is the panel's to keep rather than the API's.**
>
> **`GET /attributes` answered `[]`.** Measured 2026-08-18, before anything was built: this shop had
> **zero** global attributes, so `meta.facets.attributes` was `{facetable: [], groups: []}` and
> `?attributes[pa_size]=m` was a 400 — `No global attribute named "pa_size"`. Both variable products
> carried *local* attributes (`id: 0`, "Taille" and "Finition"), and §82 is explicit that a local
> attribute has no shared vocabulary and no term to count. The headline example above was therefore
> unbuildable and untestable against real data. §88's routes exist for exactly this, and
> `scripts/seed-attributes.mjs` uses them to create Matière and Couleur and tag ten products; it runs
> from `scripts/test.sh` before the e2e stage because the backend's own suite re-seeds the catalogue
> and strips the two variable products' global tags.
>
> **A facet omits its zero-count values, so "render every value" is the panel's job.** `pa_matiere`
> carries six terms, one of which ("Cuir") no product uses; the group reports five values and
> `total_values: 5`. `?search=tapis` cut the category group from six values to two — the other four
> were *dropped*, not reported as zero. The single exception is `stock_status`, which sends
> `onbackorder: 0` because it is a closed enum rather than a taxonomy. So the vocabulary comes from
> `/product-categories` and `/attributes/{id}/terms` — both unfiltered, both publishing a `count` —
> and `lib/products.ts`'s `mergeFacet` puts the two together. **`total_values` is the number of
> counted values, not the size of the vocabulary**: six terms, `total_values: 5`.
>
> **The category facet does *not* exclude its own filter.** The rule holds for the attribute groups,
> for `stock_status` and for `price` — with `?attributes[pa_matiere]=laine` the matiere group still
> reports all five of its counted values while every other group narrows. With `?category=16` the
> category group collapses to `tapis=3` and `total_values: 1`, and the other five categories vanish.
> Rendering that group from the facet alone produces exactly the dead end this section forbids: pick a
> category and no other category is visible or reachable. The panel falls back to the vocabulary's own
> unfiltered count for whichever group is currently filtered, which is what `mergeFacet`'s
> `selfNarrowed` decides.
>
> **The cap is real and its shape is as documented.** Measured with a throwaway 60-term attribute:
> 50 values, `total_values: 60`, `truncated: true`. Deleted afterwards.
>
> **The counts are published-only, and here that is 27 against 28.** One draft in a 28-product
> catalogue, so the list shows 28 rows beside facet counts that sum over 27. `scope` is the
> machine-readable half and `scope_note` the English sentence; the panel renders a localised line
> keyed on `scope` and falls back to `scope_note` for a scope it has no wording for — rendering the
> raw note always would put an English sentence at the foot of an Arabic sheet.
>
> **Nine filters is eleven.** `/products` accepts `search`, `sku`, `status`, `category`, `tag`,
> `min_price`, `max_price`, `attributes[…]`, `stock_status`, `on_sale`, `featured` and `rating_min`.
> The panel carries nine: `rating_min` is omitted because no product in this shop has a review and the
> rating facet is always `[]`, and `tag` renders only when the tag facet has values because all 28
> products carry `tag_ids: []`. A control that cannot change the result is not a filter.
>
> **`?status=` takes one value**, as on `/orders`: `?status=draft,publish` is a 400. `?category=` does
> take a comma list, but of **term ids** — `?category=tapis` is a 400 naming the pattern
> `^$|^[0-9]+(,[0-9]+)*$`, while `?attributes[pa_matiere]=` matches term **slugs**. Keying both by slug
> compiled, typechecked, ran, and put a `0` beside all six categories in a shop that had just reported
> 15, 3, 3, 3, 2 and 2. Nothing failed; only the screenshot showed it. `?category=99999` is a 200 with
> zero rows rather than a refusal, so a stale saved filter empties the list quietly.
>
> **`?per_page=500` is a 400, not a clamp**, and parameter errors arrive under `details.params` — with
> one exception that matters here: **the `attributes` filter reports under `details.fields.attributes`,
> with `details.facetable_attributes` beside it at the `details` level.** A panel mapping only
> `details.params` renders nothing for the one filter most likely to be wrong.
>
> **`orderby` accepted five values it did not honour.** Comparing each one's full 28-row id sequence
> against `orderby=date`: `id`, `price`, `sku`, `popularity` and `rating` returned **byte-identical**
> order to `date`, in both directions. Only `date`, `title` and `menu_order` sorted. Same cause
> `ProductRepository` already documents for `meta_query` — `WC_Product_Data_Store_CPT` drops the
> vocabulary it does not recognise, so the sort does not fail, it silently does not sort. Repaired in
> the backend through `posts_clauses` against `wc_product_meta_lookup`; the panel offers `date`,
> `title` and `price`, and omits `popularity` and `rating` because `total_sales` is 0–2 across the
> whole catalogue and there are no ratings — a sort whose keys are all equal is the same defect wearing
> a different hat.
>
> **No product has an image.** All 28 carry `image_id: 0`, `image: null` and an empty gallery; the
> media library holds 30 fixtures and not one is attached. So the row has no thumbnail column — 28
> placeholder squares would read as photography that failed to load rather than as a catalogue that
> has none.
>
> **A price can be absent, and absent is not zero.** `AC-SEO-NOPRICE` is published with `price: ""` and
> `regular_price: ""`. WooCommerce's lookup table stores its `min_price` as `0.0000`, which is why the
> price facet's floor reads `0.00` — but the row says "Sans prix" rather than "0,00 DA". On a variable
> product it is the other way round: `price` carries the resolved figure and `regular_price` is `""`.

**Detail.** Grouped sections: identity and pricing, inventory, images, categories and attributes,
variations, options (§83), SEO (§62).

**The `options` editor is the hardest component in the panel.** Three group types — `choice`, `text`,
`bundle` — with caps (20 groups, 50 choices, 20 components), negative `price_delta` allowed,
`image_id` that must already exist, and errors that name a position:
`options.groups[0].choices[2].price_delta`. Map those paths onto the form's field paths exactly, or a
validation error lands nowhere. The line above the editor is the rule that stops the whole
misunderstanding: **a variation has a SKU and stock; an option is a modifier with neither.**

`bundle.available` and `options_problems` are **read-only** and come back on GET. `options_problems`
appearing at all means the stored document has a group the API could not read — surface it as a
warning on the product, because carts holding that product are already refusing to check out.

> **Corrected in the build: `options_problems` names a position, not a group — and saving deletes what
> it warns about.** Provoked deliberately by writing an unreadable group straight into `_ac_option_set`
> and reading it back, the field is a list of English strings naming the group by its **1-based
> position**: `"Option group 4 was dropped: Must be one of: choice, text, bundle."` The position is all
> there is to go on precisely because the broken group is absent from `options.groups`, so nothing can
> link the warning to a row in an editor.
>
> Worse, and the reason the warning carries a third line of copy: **PATCHing the whole GET body back
> silently repairs the document by discarding the unreadable groups.** Measured — after one round trip
> `options_problems` was gone and so were both broken groups. A screen that says "carts are refusing to
> check out" beside a save button that quietly destroys the evidence has to say so, so the panel's
> warning does.
>
> `options`, `bundle` and `options_problems` are all **absent keys** on a product without an option
> set — not null, absent. None of the 28 products had one, so a required field here would fail the
> panel at its own boundary on every ordinary product.

**GET then PATCH the whole object works.** Read-only fields are dropped, not rejected. Build the form
around the full object rather than diffing — it is what the API is designed for and it removes a
whole class of partial-update bug.

`DELETE` trashes; `?force=true` is permanent and gets its own confirmation with different wording.

> **Corrected in the build: four things about the write path.**
>
> **GET then PATCH the whole object does work** — verified, all 32 keys of a product carrying an option
> set round-tripped with a 200. But **a PATCH whose every key is read-only answers 400 `"No supported
> fields were provided."` with no `details` at all.** So "drop what is read-only" cannot be the only
> rule a client follows: if it drops everything, the request is refused with a message that names
> nothing and the panel's own 400 handling has no field list to render. The form sends an explicit
> named subset instead.
>
> Measured writable: `name`, `slug`, `type`, `status`, `featured`, `catalog_visibility`, `sku`,
> `description`, `short_description`, `regular_price`, `sale_price`, `manage_stock`, `stock_quantity`,
> `stock_status`, `weight`, `category_ids`, `seo`, `options`, `attributes`, `tag_ids`, `image_id`,
> `gallery_image_ids`. Measured dropped: `price`, `on_sale`, `permalink`, `image`, `gallery`,
> `variations`, `id`, `date_created`, `date_modified`, `bundle`, `options_problems`. An unknown field
> is a 400 `"Unknown field."` — read-only and unknown are different answers. **`stock_quantity` is
> silently dropped when `manage_stock` is false**, a 200 with the field ignored, which looks exactly
> like a save that worked.
>
> **A duplicate SKU is a 409, not a 400**, and it names the SKU under `details.sku` rather than under
> `details.fields`: `{"code":"conflict","message":"That SKU is already in use.","details":{"sku":"AC-TAP-001"}}`.
> It has to be mapped onto the SKU field, because that is the field the person has to change.
>
> **A 400's field messages are English** — "Must be a number.", "Cannot be negative.", "A product name
> cannot be emptied." — while the panel is French and Arabic. They are rendered verbatim anyway: they
> name the problem precisely, and a translated generic ("Ce champ est invalide") throws away the only
> actionable part. The *label* beside them is localised, so a row reads as a French label with the
> API's reason under it.
>
> **A trashed product still reads back.** `DELETE` answers `200 {"id":…,"deleted":true}` and a
> following `GET /products/{id}` answers **200 with `status: "trash"`**, not 404 — so the schema has to
> accept a status that no filter may send, and the detail screen renders a banner rather than an
> absence. Trashing is idempotent: a second `DELETE` answers 200 again and does *not* escalate to
> permanent. `?force=true` answers the **identical body** and the next GET is a 404, so nothing in the
> response distinguishes the reversible act from the irreversible one — the panel knows only because it
> knows what it asked for, which is why the permanent path is behind a typed confirmation of the
> product's own name.
>
> **Replacing `attributes` on a variable product is destructive, and it 500'd.** Sending an
> `attributes` list that drops the variation attribute makes WooCommerce clear every variation's
> attribute map — measured on products 12 and 21, whose three and two variations came back with
> `attributes: {}` and could no longer be told apart. It also answered **500, `Call to a member
> function is_taxonomy() on null`**: `WC_Product_Variable::save()` nulls the dropped key in the
> in-memory array rather than unsetting it, and `ProductPresenter::attributes()` iterated the object the
> write returned. Fixed in the backend by re-reading after the write, so a write response is what a
> subsequent GET returns — which is what "a read body can be written back" requires. The panel's form
> does not send `attributes` at all; that belongs with the attributes screen, which can build the whole
> list rather than a partial one.

## Categories and attributes

`GET /product-categories`; §88's `/attributes` and `/attributes/{id}/terms`.
`ac_manage_products`.

A tree for categories, a flat list for attributes with a drill-in for terms. The two §88 warnings
belong on screen: a newly created attribute's facet counts are zero until the next request, and
changing a term slug breaks saved filters and storefront links — the confirm dialog says so.

## Inventory

`GET /inventory`, `/inventory/{id}`, `/lookup?sku=`, `/low-stock`, `POST /adjust`, `/bulk`,
`GET /movements`, `/movements/summary`. `ac_manage_inventory`.

> **Corrected in the build: the route list is shorthand, and it is wrong in three places.** Measured
> 2026-08-18 against the live router. The paths are all under `/inventory`, adjust is **per product**,
> and `PATCH` is missing from this list entirely:
>
> ```
> GET   /inventory                      the list — 28 rows, or 33 with variations
> GET   /inventory/{id}
> PATCH /inventory/{id}                 ← absent above
> GET   /inventory/lookup?sku=
> GET   /inventory/low-stock            3 rows
> POST  /inventory/{id}/adjust          ← not a bare /adjust
> POST  /inventory/bulk
> GET   /inventory/movements            1154 rows
> GET   /inventory/movements/summary
> ```
>
> The `PATCH`/`POST` split is not decoration: settings go to `PATCH /inventory/{id}` and the *quantity*
> is refused there with a 400 naming the adjust route, which is what guarantees the ledger has no gaps.
> The panel builds every route above except `/inventory/bulk`, which no screen calls and which the
> proxy allowlist therefore refuses.

Built for a phone in a warehouse. The default screen is **low stock**, not the full list.

> **Corrected in the build: `GET /inventory` hides variations by default, and `/low-stock` does not.**
> `include_variations` defaults to **false** — measured, 28 rows against 33 with it on — while the
> low-stock report always includes them. So the default screen shows "Burnous en laine – L" and the
> full list, on the same shorthand, says that row does not exist. A stock list that omits the rows
> actually holding the stock is not a stock list, so the panel sends `include_variations=true`.
>
> `/inventory` also takes `search`, `sku`, `status`, `category`, `stock_status`, `manage_stock`,
> `orderby` and `order`, none of which this section mentions; `/inventory/low-stock` takes **pagination
> and `status` only**, so the low view renders no filter controls at all. An unknown parameter is
> ignored with a 200 — `?nonsense=zzz` returns all 33 rows — so a filter that does nothing looks
> identical to one that works. A *known* parameter with a bad value does refuse: `?stock_status=zzz`
> and `?reason=zzz` are both 400.

> **Corrected in the build: a row is not a quantity, and `null` is not `0`.** Every row carries three
> stock flags that disagree on purpose — `manage_stock` (WooCommerce's raw value, and the *string*
> `"parent"` for a variation that inherits), `managing_stock` (the plain yes/no, and the one that
> decides whether a quantity exists), and `stock_managed_by_id` (whose shelf actually moves). **An
> adjustment must target the id that manages the stock, not the row that was tapped**, or it 400s or
> moves the wrong shelf — and that is also the id the movement is recorded against.
>
> `stock_quantity` is `null` for untracked products — **8 of the 28 top-level rows**, not the 13 an
> earlier note claimed — and `null` and `0` are different facts. Rendering both as `0` is what gets
> someone to reorder something they already have. Measured: `/low-stock` contains a genuine `0`
> (product 26) and never a `null`; the full list contains both.
>
> `low_stock_amount` is **per product** — 2 on 27 rows, 5 on one — so there is no shop-wide threshold
> to display anywhere. A row's own figure is the only honest number to put beside it. `backorders`
> exists on every row and is not described here; it decides whether an adjustment may go below zero.

`/inventory/lookup?sku=` behind a search field is the fastest path from a barcode to an adjustment —
give it a large input, `inputmode="text"`, autofocus off, and no debounce below 300 ms.

> **Corrected in the build: there is no debounce, because the lookup is exact.** `?sku=` is an exact
> match — `?sku=AC/BUR 010` is a 404 and nothing fuzzy exists — so every keystroke before the last one
> is a request that can only 404. The field searches on submit, which is what a hardware scanner sends
> anyway. An unknown SKU is `404 not_found` and is rendered as an **empty state at the field**, keeping
> the typed value: it is the single most common thing that will ever happen there, and a toast that
> vanishes in four seconds is the wrong place for it. Scanning a *variable parent's* SKU resolves to a
> product that cannot be adjusted at all, so the item screen has to handle that arrival.

**Every stock change writes a movement.** There is no path that changes stock without one, and the
movements ledger is the screen that proves it. Adjustments take a reason; the ledger shows who, when,
how much and why. An imported change writes a movement too — two thousand rows write two thousand
movements, and the ledger's pagination has to expect that.

> **Corrected in the build: the ledger cannot show *who*, and this is what it shows instead.** A
> movement carries `actor_id: 475` and no name. Measured across all four roles holding
> `ac_manage_inventory`:
>
> | | Super Admin | Admin | Manager | Product Manager |
> |---|---|---|---|---|
> | `GET /users/{id}` — resolves a name | 200 | **403** | **403** | **403** |
> | `GET /audit-logs` — carries `actor_login` | 200 | 200 | **403** | **403** |
> | `GET /auth/me` — the reader's own name | 200 | 200 | 200 | 200 |
>
> `/audit-logs` looked like a way out for Admin and is not: it holds **no movement id**, so a join
> would be a heuristic on product, before, after and a timestamp, and it only records
> `inventory.adjusted` and `inventory.settings_updated` — 13 rows against the ledger's 1154. A ledger
> that reads differently depending on who opens it is worse than one that reads the same for everyone,
> so neither route is behind the panel's proxy.
>
> **After the two-tier collapse (2026-08-20) the table is two rows, and the conclusion is unchanged.**
> `ac_manage_inventory` is held by Super Admin and Manager; `GET /users/{id}` is 200 for the first and
> 403 for the second, `/audit-logs` likewise. So a name is still unresolvable for one of the two roles
> that can open the ledger, and `movementActor()` still shows what it can prove.
>
> **The row says what it can prove**, from the movement plus `/auth/me`: *an order* (with its number,
> which is a real referent the reader can open — 692 of 1154 rows), *you*, *a colleague*, or *unknown*
> for `actor_id: 0`. Never a bare numeric id. `?actor_id=` genuinely filters (1154 → 17), so identity
> survives as something to pivot on — "my movements" — even though it cannot be printed.
>
> `order_reduced` and `order_restored` are attributed to the order and not to `actor_id`, because on a
> storefront checkout that id is the *customer*. `product_edit` is attributed to a person despite being
> system-written: someone did change a quantity, through the product form, and that is the one thing
> that reason exists to reveal.

> **Corrected in the build: the reason vocabulary is a union of two endpoints, and neither is
> complete.** This is the facet lesson in a new place. `POST /inventory/{id}/adjust` accepts six —
> `correction, restock, damage, loss, customer_return, other`. `GET /movements/summary` returns seven —
> the four they share plus `order_reduced, order_restored, product_edit`, which are system-written and
> which the adjust endpoint rejects with the *same message as an unknown reason*, deliberately, so a
> caller cannot probe which forgeries exist. And `customer_return` and `other` have zero movements
> today, so the summary omits them entirely.
>
> A picker built from the summary offers three reasons that answer 400; a legend built from it is
> missing two a person can create at any moment. **The vocabulary is the union of nine**, it lives in
> `lib/movement-reason.ts` with no dependencies, and the summary supplies only the numbers. The ledger
> filter offers all nine — `?reason=order_reduced` returns 480 rows — and the adjust picker offers
> exactly the six.

> **Corrected in the build: `set`, `increase` and `decrease` are one control only because of the
> preview.** They are three different mental operations, and the difference is not convenience:
> WooCommerce applies the two relative modes as a relative SQL update, so concurrent decrements
> compose, while two concurrent `set`s are last-writer-wins. A stocktake states an absolute; a
> warehouse thumb states a movement. What makes them one control is a line under the field reading
> **`3 → 5`**, recomputed on every keystroke and identical in all three modes — without it, `decrease`
> is a subtraction the person does in their head against a figure that has scrolled off the top.
>
> The 400 is a well-formed field list (`mode`, `quantity`, `reason`, `note`) that `Field` already
> renders. There are **two** distinct 409s and they are different screens: `{stock_quantity, projected,
> backorders}` when the adjustment would go below zero on a product that takes no backorders — refused,
> never clamped — and `{id, manage_stock}` when the product tracks no stock at all, which the panel
> catches before sending and resolves with the settings form one card below.

> **Corrected in the build: `created_at` has no UTC offset**, exactly like `notes[].created_at` on an
> order — `"2026-08-18 10:29:37"`. `new Date()` reads it as local time and shifts it silently.
> `parseApiDate()` is the only thing that may touch it, and `/settings` still publishes no timezone.
>
> A second bidi trap surfaced beside it, and it is the *opposite* of the usual one: `Intl` annotates an
> Arabic date with **U+200F RIGHT-TO-LEFT MARKs** — `17‏/08‏/2026، 12:07 ص` — and wrapping that in the
> panel's `Ltr` helper turns those marks into RTL runs inside an LTR paragraph, rendering
> `17ص 12:03 .2026/08/`. Nothing errors. The rule is now explicit: **`Ltr` for something the shop
> assigned** — a SKU, an order number, a movement id — **and `Isolate` for something `Intl` formatted**,
> which isolates without forcing a direction. Eight existing date sites on the orders and products
> screens carried the same defect and are fixed.

> **Corrected in the build: the ledger's product ids are not resolvable to names.** 1154 movements name
> **155 distinct products, of which only 23 appear in `/inventory` at all** — the rest were created and
> deleted by the backend's own fixtures. A ledger is an archive and a catalogue is not, so the row
> renders an id, tapping one is a real path to a 404, and that 404 is a built screen rather than a
> defensive branch. Resolving 20 ids per page would also be 20 requests to produce a label missing six
> times out of seven.
>
> Pagination is as warned: 1154 rows, `per_page` caps at 100 and **101 is a 400, not a clamp**;
> `?page=999` answers 200 with an empty array. `/movements/summary` takes `date_from`/`date_to` and the
> window is real — `correction` is −1540 over 166 movements unfiltered and −141 over 15 for today — so
> the summary strip always states its own scope.

## Customers

`GET /customers`, `GET/PATCH /customers/{id}`, `GET /customers/{id}/orders`. `ac_manage_customers`.

`roles`, `capabilities` and `user_pass` are **refused by name**. So is `marketing_consent`: it is
reported on GET and refused on PATCH, because consent is the customer's to give. Render it as a
read-only row with the date and the reason it cannot be changed here — a disabled toggle with no
explanation gets raised as a bug every few months.

Staff accounts do not appear here; they are §87's `/users`.

> **Corrected in the build: the consent row was not buildable, and the API was changed rather than
> the row.** Three things were wrong at once. There was **no date** — the payload carried a bare
> `marketing_consent: false` and nothing else. The refusal was **not by name**: it answered
> `"Unknown field."`, the same message a misspelling gets, which reads as "no such field" when the
> truth is "it exists and it is somebody else's". And **0 of 16 customers had ever consented**, so the
> affirmative branch had no data that could reach it and no test that had ever seen it render.
>
> A bare boolean also cannot tell *declined* from *never asked*, and those are different answers to
> the one question this row exists for. The fix went into `ecom-temp`:
> `marketing_consent_at` and `marketing_consent_source` are emitted beside the flag, the refusal names
> the shopper's own route, and one seeded shopper consents. The timestamp turned out to have been
> **stored since §85 was written and never presented**; the source was in the audit log, which stops
> at Admin while a customer record is read by Support Agent.
>
> The date carries a UTC offset the meta behind it does not, because `notes[].created_at` and
> `movements[].created_at` both ship a naive instant that `new Date()` shifts silently — and a consent
> date off by an hour is a date in the wrong day. It is written on a **withdrawal** as well as a grant,
> and only on an actual change: a one-click unsubscribe clicked twice from two devices must not restate
> the record.
>
> The row is a value with its reason, never a switch — `ReadOnlyField`, which already existed for
> exactly this.

> **Corrected in the build: the detail is not the list row, and this is the first collection where
> that is true.** `GET /customers/{id}` carries a `statistics` block that `GET /customers` omits.
> Verified by comparing key sets across all 16 rows and every shared value on customer 24: they are
> identical, so the detail is the row *plus a report*. Every previous branch's "one schema serves
> both" note stops here, and `CustomerDetail` is its own type rather than the row with an optional
> field — a component handed a list row must not be able to reach `statistics` and find `undefined`.
>
> **Two of the report's numbers do not divide into each other.** `total_orders: 5` beside
> `average_order_value: "1050.00"` and `total_revenue: "2100.00"` — and 2100 ÷ 5 is 420, which is the
> arithmetic a reader performs when the figures sit side by side. The API is self-consistent: revenue
> is the sum of the *completed* orders (1500 + 600, checked against that customer's own order list)
> and the average is over those same two. Only labelling can make it visible, so every figure carries
> its scope and the card states the relationship. `by_status` sums to `total_orders` exactly and is
> what explains the gap.
>
> `total_revenue` is **not behind the money gate at the API** — a Support Agent reads `2100.00` with a
> 200. The panel gates it anyway, and the reason is specific rather than cautious: `canSeeMoney()`
> needs `ac_view_analytics` **and** `ac_manage_orders`, all six roles hold the first, and of the four
> that can read a customer the Support Agent alone lacks the second. They cannot open one of this
> customer's orders, so a lifetime-revenue figure would be the only money in the panel they can see and
> the only one they cannot check. The counts and both order links stay.
>
> **Superseded by the two-tier collapse (2026-08-20):** both tiers now hold `ac_manage_orders`, so the
> gate passes for every staff account and the figure always renders. The gate stays in the code — it is
> still the correct rule and a third tier would make it bite again — but the case it was written for no
> longer exists on this install.

> **Corrected in the build: `?search=` does not match a customer's name.** It matches `user_login`,
> `user_email` and `display_name` — never `first_name` or `last_name`. Proven with a positive control:
> customer 26 was given the names `Zqxwvu Plmokn`, `?search=Zqxwvu` returned **0 rows** and
> `?search=cus_fresh` returned 1. `?search=Chérif` appearing to work is MySQL's accent-insensitive
> collation matching the *email*.
>
> So **Amina Benali cannot be found by typing her name**, and a box labelled "search customers" is a
> promise the endpoint breaks silently — an unmatched search is an ordinary empty list. The field names
> the two things it matches, and the empty state repeats it, because the person who needs that sentence
> is the one already looking at no results.
>
> Two more consequences of the same three-filter reality. **12 of the 16 customers have no name at
> all**, so the list falls back to the username and then the email and *styles* the fallback — a login
> at a name's weight reads as a person called ac_cus_shopper. And `orderby=display_name` sorts by a key
> the payload never carries: it returned a byte-identical sequence to `user_email` across all 16 rows,
> because every display name here is the username. The panel offers `registered` and `user_email` and
> leaves the other two out rather than shipping a sort nobody can explain.

> **Corrected in the build: the roles invert between this screen and coupons.** Measured across all six
> panel roles — a **Support Agent reads customers** (they hold `ac_manage_customers`, the thinnest role
> in the system holding anything) and is **403 on coupons**, while a **Marketing Manager** is exactly
> the other way round. The ready-made forbidden fixture of the last two branches works for neither
> screen alone, so `scripts/test.sh` now mints three credentials.
>
> **Superseded by the two-tier collapse (2026-08-20): the inversion is gone, because both roles are.**
> Manager holds `ac_manage_customers` *and* `ac_manage_coupons`, so one tier now reads both screens and
> the other reads everything. The fixtures still mint — `set_role()` bypasses the API — so these tests
> keep passing while describing a configuration production no longer has. The measurement above stays
> because it is why the panel gates each screen on its own capability rather than on a role, which is
> what made the collapse a no-op here.
>
> A staff id is a **404** here, not a leak: `GET /customers/1` — the administrator — answers
> `"No customer with that id."`, because the repository filters on the role. `?role=administrator` is
> ignored with a 200 and the same 16 rows, which is this API's usual trap and worth knowing before
> trusting any parameter that is not in the list of three.
>
> **`POST /customers` does not exist** — 404 `no_route`, not 403. Staff do not create shoppers.
> `billing` and `shipping` **merge on a partial PATCH**, unlike products: `{"billing":{"city":"Oran"}}`
> left country and phone intact. An unknown sub-key is refused as a **dotted path**,
> `details.fields["billing.nonsense"]`, so a form binding errors by field name needs to resolve one.

## Coupons

`GET/POST /coupons`, `GET/PATCH/DELETE /coupons/{id}`. `ac_manage_coupons`.

Three types: `percent`, `fixed_cart`, `fixed_product`. Codes lowercase on save — lowercase them in
the field as the user types, so what they see is what is stored.

`maximum_discount` does not exist and is refused by name. If a client asks for it, the answer is that
WooCommerce has no such field and `maximum_amount` caps the cart, not the discount.

Absent thresholds come back as `null`, not `"0.00"` — an empty field, not a zero.

> **Corrected in the build: the restriction picker needed two new routes, because the role whose job
> coupons are could not read a product's name.** `product_ids` and `product_categories` are id arrays,
> and turning `[16]` into *Tapis et Textiles* needs `/products` and `/product-categories` — both
> `ac_manage_products`, which a **Marketing Manager does not hold** while holding `ac_manage_coupons`.
> One of the three coupon-capable roles, and no client work could fix it.
>
> `GET /coupons/eligible-products` and `/coupons/eligible-categories` were added to `ecom-temp` behind
> `ac_manage_coupons`. A row is id, name, SKU and status and nothing else — no price, no stock, no
> cost — which is **strictly less than the catalogue discloses**; widening `ac_manage_products` would
> have handed this role the whole catalogue in order to give it a label. Products search by name *or*
> SKU, because WordPress's own `s` reads the title and the content and a shop that knows a product by
> `AC-SEO-TAPIS` would otherwise get an empty picker. A single coupon also carries a `restrictions`
> block with the ids resolved; the list does not, because resolving 100 rows populates a column no list
> shows.
>
> **The ids were stored blind.** `{"product_ids": [999999]}` answered 200 and the coupon then applied
> to nothing while looking, in every response and on every screen, exactly like a coupon that worked.
> Now a 400 per field, naming the ids. Reads stay tolerant — a product deleted afterwards leaves a real
> stale id, reported as `{id, name: null, missing: true}` rather than dropped, because a client that
> dropped it would delete the restriction the next time the form saved.
>
> One measurement to distrust in the original brief: `product_ids: [24]` looked like a *customer* id
> being accepted, and is not. **User ids and post ids are separate sequences that collide** — customer
> 24 is also product 24, and customer 13 is a variation. Only `999999` was genuinely unchecked, and the
> test uses a page id, which cannot be a product by construction.

> **Corrected in the build: `date_expires` is asymmetric, and it silently deletes itself.** Written as
> `Y-m-d`, read back as full ISO — `PATCH {"date_expires":"2026-12-31"}` → `"2026-12-31T00:00:00+00:00"`.
> An `<input type="date">` bound to the response renders **empty**, and the next save posts an empty
> string, which the API accepts as "clear the expiry". The round trip deletes a date nobody touched.
> `expiryInputValue()` is the only thing allowed to fill that control. A past date is accepted with a
> 200, so an expired coupon is an ordinary row that reads as `publish`; `31/12/2026` and `2026-02-30`
> are refused with *different* messages.
>
> **Zero and null run in opposite directions on the same object.** `amount: "0.00"` is a real coupon —
> the `livraison` fixture is a zero discount with `free_shipping: true` — while a threshold of zero is
> folded to null on write and can never be read back. Rendering the two the same way is the inventory
> null-vs-0 lesson in a third place, and the row says *Livraison offerte* rather than `0,00 DA`.
>
> A **negative** threshold used to be the worst of both: the clearing arm read `<= 0.0`, so
> `{"minimum_amount": "-1"}` answered 200 and **erased a real minimum spend of 15 000 DA** while
> `amount: "-5"` was refused by name. Fixed in `ecom-temp`; clearing stays expressible as `null`, `""`
> and `0`.
>
> Three more, each measured: **`amount` is required on `POST`** and validation runs before the
> uniqueness check, so a duplicate code with a missing amount reports only the amount. The default list
> carries **publish *and* draft** — no `?status=` returns both, and `?status=trash` is a 400 while a
> trashed coupon GETs as 200, so the readable set is wider than the filterable one. And `used_by` is
> emitted by nothing, so *who* redeemed a coupon is unanswerable; `usage_count` is 0 on every fixture
> and no panel route can move it.

## Shipping

`/shipping/providers`, `/shipping/rates`, `/shipping/rules`, `/shipments`, `/orders/{id}/shipments`,
`/shipments/{id}`, `/cancel`, `/sync`. `ac_manage_shipping`.

Two things that are separate and must look separate: **what the shop charges** (`/shipping/rules`,
the tariff) and **what a courier quotes** (`/shipping/rates`). `GET /shipping/rates` returns both,
labelled; the screen keeps the labels.

The rules editor's whole logic is that **the narrowest match wins** — commune beats wilaya beats the
national fallback — and **rules are never added together**. Show which rule would win for a chosen
destination, live, as the user edits. A rules table that does not show its own resolution is a table
people misconfigure.

**One live shipment per order**, enforced by the database. The create button is absent, with the
reason, while one is live.

**Shipment `label` URLs are credentials.** They carry an access token to one customer's name, phone
and address. Never render one in a client component, never put one in a `href` the browser can
prefetch, never log it, and never let the service worker cache a response containing one. The panel
opens a label through a server-side handler that fetches it with the staff credential and streams the
PDF back — the URL never reaches the browser at all.

## Payments

`GET /payments`, `/payments/{id}`, `/payments/methods`, `GET/POST /orders/{id}/payments`,
`POST /payments/{id}/verify`. `ac_manage_payments`.

**Status is verified server-side, never trusted from a callback**, and from `paid` the only permitted
move is `refunded`. The verify button exists because a webhook can arrive late or out of order; it
calls the provider, and the answer it returns is the truth.

Several transactions per order is the design, not a duplicate — a duplicated checkout link is a link
nobody clicks. Do not deduplicate them in the UI.

## Cash on delivery

`GET/PATCH /orders/{id}/cod`, `POST /orders/{id}/cod/attempts`, `GET /cod/statistics`.

COD lives inside the order detail as its own grouped section: attempts, outcomes, the next call. It is
order metadata and audit events, **never a status** — a COD outcome does not move the order, and the
section must not offer anything that looks like it does.

`/cod/statistics` needs only `ac_view_analytics` and belongs on the dashboard as a success-rate card.

## Analytics

Seven endpoints: `overview`, `revenue`, `orders`, `products`, `customers`, `shipping`, `cod`.

`/analytics/revenue` is **403** without `ac_manage_orders`; the others omit money and say so. Build
the money gate once, in the shared analytics layout.

Three figures are reported as **unavailable rather than zero** — shipping cost, payment fees, margin.
Render them as "non disponible" with the reason on tap, never as `0,00 DA`. A zero that means "we
cannot know" is a number someone will put in a report.

A wilaya comes off the **shipment**, never the address, so unshipped orders arrive as `unattributed`
with a reason attached. Show the reason; an "unattributed" slice with no explanation reads as a bug.

Counts cover every order, sums only those in the shop's currency, with `excluded_currencies` naming
the rest. On an install carrying pre-`DZD` orders, "22 commandes" beside a COD funnel of 615 is
correct and needs the note beside it.

## Content

§89's routes. `ac_manage_content`.

Pages addressed by **full path**. Banners and FAQs as post types. Menus as a two-level ordered tree.
The homepage as one document of `{type, data}` sections, edited whole with drag-ordering and a live
per-section validation that mirrors the API's `sections[2].type` error paths.

The `seo` block is edited inside the page's own form, because it is written through the page's PATCH.

A rich-text field is the risk here. Whatever editor is chosen, the panel does **not** sanitise — the
API does, on save, with `wp_kses`. The panel's job is to render the sanitised result back so the
author sees what was actually stored rather than what they typed. An editor that shows the unstored
version is one where a stripped `<iframe>` silently comes back on the next save attempt.

## Media

`GET /media`, `POST /media`, `GET/PATCH/DELETE /media/{id}`. `ac_manage_content`.

**jpg, jpeg, png, webp only.** Over the cap is **413**, wrong type is **415**, and both need distinct
messages — "trop volumineux" and "format non accepté" are different problems with different fixes.
Check size and type client-side before uploading so a phone on mobile data does not spend 40 seconds
uploading a file that will be rejected, but treat the server's answer as the authority.

The stored filename is generated server-side and the extension comes from the sniffed type, so the
name the user uploaded is not the name that comes back. Show the returned name.

`multipart/form-data`, field name `file`, plus optional `alt`, `title`, `caption`. Upload progress is
required — this is the one screen where a spinner without a percentage is unacceptable on a 3G
connection.

**A Product Manager cannot upload.** That is a documented gap in the capability matrix, not an
oversight. The product image picker must handle a role that can select existing media and cannot add
any — the "téléverser" affordance renders disabled with the reason, and the library still works.

## Marketing

`GET /marketing/config`, `POST /marketing/events/purchase`. `ac_manage_marketing`.

A small screen: which pixel is configured, which provider registered, and the note that the
Conversions API token appears in no response, ever. The purchase-event route is the storefront's, not
the panel's; the panel shows configuration and recent event counts.

## Campaigns

`/campaigns`, `/campaigns/{id}`, `/preview`, `/test`, `/cancel`, `/send`, `/recipients`, `/segments`,
`/segments/{id}/preview`, `/email-templates`. `ac_manage_marketing`, and **`ac_manage_customers` for
send, recipients and segment counts**.

The composer is the second-hardest screen. Sequence: audience → content → preview → test → send.

- **`send` sends nothing.** It returns **202**, freezes the audience and hands back a count. The drain
  is `wp algerian-commerce send-campaigns`, scheduled by the deployment. The confirmation screen must
  say this — a progress bar implying live sending is a lie the operator will act on.
- **A second `send` is a 409** and changes nothing. Do not retry it automatically.
- **503 `mail_not_configured`** before any row is written, and **409** when the audience matches
  nobody. Both are common and both need their own screen: the first points at
  `wp algerian-commerce mail-check`, the second at the segment.
- **Consent is not optional and not visible as a toggle.** Every audience is filtered to consenting
  customers, including an explicit id list. Show the eligible count beside the raw count so
  "1 000 clients sélectionnés → 412 destinataires" is legible rather than alarming.
- **Only a draft can be edited or deleted.** A sent campaign is the record of mail that left the
  building. Render it read-only with its counts.
- **Recipient addresses are purged 30 days after completion**, and `meta.purged` says so. The counts
  survive. Show "4 812 destinataires — adresses purgées" rather than an empty table.
- Placeholders are `{{…}}` tokens, not code. An unknown token renders **empty** and is listed in
  `unknown_tokens` on both the preview and the template — surface that list prominently, because an
  empty `{{firstname}}` (the real token is `{{first_name}}`) is invisible in a preview that has a
  name in it.
- `{{unsubscribe_url}}` is appended automatically when absent. Say so; do not add it a second time.

Segments are stored queries with eleven criteria. `consent`, `email`, `email_contains`, `role`,
`commune_id`, `limit` and `sql` are refused by name. **Empty criteria are refused** — that is what
`audience_type: all` is for. `wilaya_id` comes off the shipment, so an unshipped order has no wilaya
and cannot match; say it in the criteria form. A segment in use cannot be deleted.

## Notifications

§90's routes. `ac_manage_customers`.

The operator's answer to "did it send?". List by channel, status and date; detail carries the frozen
message. Retry is a **202** that clears the row for the next drain and mails nothing.

## Import and export

`POST /import/products`, `/import/inventory`; `GET /export/{products,inventory,orders,customers}`.
Capability follows the resource.

**Imports take the CSV as the raw request body** with `Content-Type: text/csv` — not JSON, not
multipart. This differs from `/media` and will be got wrong once.

**`dry_run` defaults to true**, which is the safety property: a client that forgets the flag previews
and never writes. The panel makes that visible — the preview is a screen, and applying is a separate,
explicit action showing the counts the preview reported.

`mode` is `create` or `update` and **neither does both**. The word "mode" was chosen because
`update_existing: false` reads like a modifier and behaves like a switch. Label the two clearly:
"Créer les nouveaux SKU (ignore les existants)" / "Mettre à jour les SKU existants (ignore les
nouveaux)".

A product dry run is a parse and a lookup, not a rehearsal — `preview_only` says so. Do not present
it as a guarantee.

**Exports are files, not JSON.** `Content-Type: text/csv`, a `Content-Disposition` filename that is
the API's. An export *error* still arrives in the envelope, so a client never saves an error as
`products.csv`. Download through the server proxy, streaming, so the credential stays server-side —
this is the one place the envelope-unwrapping client must be bypassed deliberately.

## Settings

`GET/PATCH /settings`. `ac_manage_settings` — **Super Admin only**.

Four writable blocks: `store`, `contact`, `legal` (the trade register — `rc`, `nif`, `nis`, `ai`),
`social`. Everything else is read-only **with its reason on screen**, because a greyed field with no
explanation is a support ticket:

| Read-only | The reason to render |
|---|---|
| `currency` | WooCommerce records it per order; changing it splits the order book instead of converting it. Set once at provisioning. |
| `features` | `ENABLE_*` are environment variables read once at bootstrap. Change `.env` and restart. |
| `providers` | Reports what actually registered, which follows from flags *and* credentials — a flag on with no key is a provider that never loaded, and this is the only place that gap shows. |
| secrets | Environment variables, never the options table. |

`store.storefront_url` earns its own emphasis: without it, password reset answers **503
`storefront_url_not_set`**, tracking links carry no URL, and the unsubscribe link points at the API's
own domain. Render it with that consequence attached.

An Admin holding the other ten management capabilities is refused here, and that is the boundary that
stops an Admin escalating. The forbidden state should name Super Admin rather than the capability
string.

## Users and roles

§87's routes. `ac_manage_users` — Super Admin only.

A staff list, a role picker fed by `GET /roles`, an application-password manager per user, and a
suspend action. The five escalation refusals each render as a disabled control with the reason, not
as a hidden one — the refusals are the security model, and a Super Admin should be able to see it.

The minted password appears **once**, in a sheet, with a copy button and a warning that it will not
be shown again. No "reveal" affordance elsewhere in the panel, because there is nothing to reveal.

## Audit

`GET /audit-logs`. `ac_view_audit_logs`.

Filter by actor, action, resource type, resource id and date. This is the screen that makes the
per-user credential decision worth its cost — every row names a person because every staff member
authenticates as themselves.

Writes are audited **by field name, never by value**, so the log says a trade-register field changed
and not what it changed to. Render it that way; a reader expecting values needs to know they were
never stored.

---

# Part VI — PWA and offline

Installable, read-cached. No offline write queue: the API has strict status transitions, 409s and
money, and a replay engine that resolves those conflicts is a larger and riskier project than the
panel itself.

## Install

`manifest.webmanifest` with maskable icons at 192/512, `display: standalone`, `theme_color` following
the active theme, `orientation: portrait` on phones. Apple touch icons and
`apple-mobile-web-app-status-bar-style: black-translucent` so the safe-area work shows.

Prompt to install after the second successful session, never on first load.

## What the service worker caches

| Cached | Strategy |
|---|---|
| App shell, JS, CSS, fonts, icons | Cache-first, versioned by build |
| Reference data — `/locations/*`, `/product-categories`, `/attributes`, `/settings` | Stale-while-revalidate, 24 h |
| Nothing else | — |

## What it must never cache

This is a security boundary, not an optimisation choice:

- Anything under `/orders`, `/customers`, `/shipments`, `/payments`, `/audit-logs`,
  `/campaigns/*/recipients`, `/notifications`. These are customer PII and money.
- Any response containing a shipment `label` URL, which is a credential.
- Any response to a POST, PATCH, PUT or DELETE.

Working data — the orders list the user just looked at — lives in **TanStack Query's in-memory cache
only**, persisted nowhere. It survives a navigation and dies with the tab, which is the correct
lifetime for a stranger's phone number on a shared warehouse phone.

## Two rules that make the cache safe

1. **Wipe every cache on logout and on any 401.** `caches.keys()` → delete all, plus the Query cache.
   A shared device otherwise serves the previous user's shell state to the next one.
2. **Key the runtime cache by user id.** Two staff on one phone must not share a cache entry, even
   for reference data — a suspended account's cached `/settings` is a small leak but it is one.

## Behaviour offline

The shell loads. Every list shows its last in-memory data if the tab is still alive, with a persistent
banner naming the age — "Données de 14:32 — hors ligne" — never silent staleness. Every write control
is disabled with the same message. `navigator.onLine` is a hint, not a truth; treat a failed fetch as
the real signal and recover on the next success.

---

# Part VII — Testing and checks

`scripts/test.sh` in the panel repository, with stages, mirroring this repository's convention.

| Stage | What it runs | Catches |
|---|---|---|
| `types` | `tsc --noEmit` | |
| `design` | `scripts/check-design.sh` | The non-negotiables |
| `unit` | Vitest — formatters, capability predicates, error mapping, envelope parsing | |
| `component` | Testing Library — the five states of every pattern component | |
| `e2e` | Playwright — mobile viewport, both locales, both directions | |

## `scripts/check-design.sh`

A rule nobody enforces is a preference. This is the enforcement, and it carries a floor the way
`test-api.sh` does — a grep that matches nothing must not report success.

Fails on any hit in `app/` and `components/`:

| Pattern | Rule |
|---|---|
| `bg-gradient`, `from-\[`, `via-`, `linear-gradient`, `radial-gradient` | No gradients |
| `border-[lrse]-[248]` on a status or card element, `border-inline-start-width` | No accent bars |
| `-\[[0-9]`, `-\[#`, `#[0-9a-fA-F]{3,8}` in `tsx`, `rgb(`, `oklch(` outside `tokens.css` | Tokens only |
| `\bm[lr]-`, `\bp[lr]-`, `\bleft-`, `\bright-`, `text-left`, `text-right`, `rounded-[lr]` | Logical properties only |
| `font-family` naming `sans-serif`, `system-ui`, `Inter`, `Arial`, `Helvetica` outside the fallback stack | No generic fonts |
| `shadow-` outside `Sheet` and `Popover` | Elevation is surface, not shadow |
| `from "@mui`, `from "antd`, `shadcn` | No component library |

And asserts a floor: the script must have scanned at least 40 files, or it exits non-zero. A rename
that empties the glob otherwise reports a perfectly compliant codebase.

> **Corrected in the build: the scan covers `lib/` and `i18n/` too, and it carries a second control.**
> The 40-file floor is real but `app/` and `components/` alone reached only 30 at the end of the orders
> branch, which would have meant either a permanently red stage or a floor lowered to whatever
> happened to exist. Widening the net was the better answer on its own merits — a colour literal or a
> physical property is no more acceptable in a formatter than in a component — and brings the scan to
> 45 files, clearing the specified floor honestly.
>
> Two additions the section does not ask for:
>
> - **A positive control on the scanner itself.** Every rule is a grep, and a grep with a broken pattern
>   reports `PASS` on a codebase full of violations. The script writes a file containing `#ff00aa` and
>   `ml-4 text-left`, confirms its own patterns match it, and fails if they do not. Without it, twelve
>   green checks prove only that twelve greps ran.
> - **One named exception, with its reason.** `lib/theme-color.ts` may hold a colour literal, because
>   `theme-color` paints the browser and iOS status-bar chrome through Next's metadata API, which is
>   TypeScript and cannot read a custom property. Setting it from the client works only after first
>   paint, so an installed PWA flashes the wrong status bar on every cold start. The script prints the
>   exemption every run rather than skipping it silently, and a unit test asserts the two literals still
>   match `--color-bg-grouped` — the backend's "refused by name with the reason" device, applied to a
>   design rule.

## What the e2e suite must cover

Each of these is a real failure mode, not a checklist item:

- Login with a valid Application Password; login with a bad one **twice more than the limit** and
  assert the 429 with its `Retry-After` rendered.
- A Support Agent's session renders a coherent dashboard with **no money** and no empty
  currency-shaped elements. *(Unreachable since the two-tier collapse — both tiers hold
  `ac_view_analytics` and `ac_manage_orders`. Build the state; do not assert it.)*
- A Marketing Manager can create a campaign (201) and is **refused** at send (403), with the reason
  visible. *(Also unreachable: Manager holds neither marketing capability, so campaigns is a plain 403
  and no role reaches the draft-but-cannot-send state.)*
- A **Manager** is refused payments, campaigns, marketing, settings, users and audit logs, each with a
  Super Admin answering 200 from the same URL in the same run. This is the live forbidden fixture.
- A 409 on an order status transition renders the allowed moves from the response body.
- A 400 renders **every** field error, not the first — assert two simultaneously bad fields.
- The Arabic locale renders `dir="rtl"`, and a tracking number inside Arabic text keeps its digit
  order. Assert the rendered string, not the DOM attribute; the attribute half cannot catch a bidi bug.
- A shipment label opens without its URL ever appearing in the client bundle or in a DOM attribute.
- Logout clears every Cache Storage entry.

Every negative test carries a positive control, per §65: *a refusal and an unreachable route look
identical from outside.* A test asserting a Support Agent gets 403 proves nothing unless an
administrator gets 200 from the same URL in the same run.

> **Corrected in the build: the bad-login test poisons every test after it, and the suite has to clear
> the bucket.** The first item on the list above asks for a login failed past the limit, and it is the
> right test — but the failed-login bucket is **10 per 15 minutes per IP**, and a locked-out address is
> then refused *even with the correct password*. Two deliberate failures per project across four device
> projects is exactly ten. Measured: partway through the first full run a known-good credential answered
> `429 too_many_requests`, with 218 `ac_rl_` rows in the options table, and eleven tests failed looking
> precisely like a broken login.
>
> `scripts/reset-rate-limit.sh` clears the counters; Playwright's `globalSetup` runs it once and the
> bad-password test runs it again in an `afterEach`, so the allowance it spends is its own. This is what
> the backend's `scripts/test-api.sh` already does before its own assertions, for the same reason —
> *"a lockout left by a previous run would make every assertion below meaningless."*
>
> **Two credentials, not one.** `scripts/mint-credential.sh <role>` issues them, and the suite needs a
> Super Admin *and* a Support Agent, because the positive control for the forbidden state is the same
> URL answering 200 for someone else. Measured on this install: `ac_support_agent` holds
> `ac_manage_customers` and `ac_view_analytics` and **not** `ac_manage_orders`, so it is also the
> natural subject for the money gate — it is the role that has `ac_view_analytics` alone.
>
> **Corrected after the two-tier collapse (2026-08-20): the fixture roles are retired, and one of them
> was load-bearing for a test that can no longer be written.** `mint-credential.sh` assigns with
> `WP_User::set_role()`, which is WordPress core and bypasses the API's `assignable()` narrowing — so
> **every existing fixture still mints and every existing test still passes**. What changed is what
> they prove.
>
> A Support Agent credential now describes a role no live account holds, so "a Support Agent is refused
> `/coupons`" tests a configuration production does not have. The honest replacement is a **Manager**,
> which is a real tier: it is 403 on payments, campaigns, marketing, settings, users and audit logs,
> and 200 on everything else — five genuine refusals with a Super Admin positive control beside each.
>
> The money-gate test has no replacement and should be deleted rather than rewritten. Both tiers hold
> `ac_view_analytics` and `ac_manage_orders`, so `meta.money_visible` is `true` for every staff account
> and no credential can render the moneyless dashboard. The *screen* must still be built — a third tier
> would bring the state back, and `canSeeMoney()` still encodes the rule correctly — but it is
> unreachable by any fixture and a test asserting it would be asserting nothing. Say so where it is
> deleted; a silently removed test reads as coverage that was never needed.
>
> **A device descriptor selects a browser, not just a viewport.** `devices["iPhone 13"]` is WebKit, and
> naming it in the default project turned a missing browser download into thirteen red tests that read
> as product failures. The runnable projects keep the geometry and drop the engine; `phone-webkit` is
> opt-in, and until it runs somewhere the engine-specific risks — `backdrop-filter`,
> `env(safe-area-inset-*)`, bidi isolation — are unverified on the engine that matters.

---

# Part VIII — Accessibility

Not a separate pass. Staff use this eight hours a day, some of them on a cracked phone in a
badly-lit stockroom.

- **Contrast**: 4.5:1 for text, 3:1 for UI boundaries and icons, in **both** themes. The tonal status
  badges are the risk — `color-mix` at 14 % leaves the label at full strength, which passes; a badge
  whose text is also tinted does not.
- **Focus**: a visible ring on every interactive element, `:focus-visible`, using `--color-accent` at
  full strength and 2 px. Never `outline: none` without a replacement.
- **Keyboard**: every swipe action also in the overflow menu; every sheet trap-focused and
  Escape-dismissible; skip-to-content on every page.
- **Screen readers**: `aria-live="polite"` for toasts and for list-count changes after a filter;
  `aria-busy` during refetch; every icon-only button labelled in both locales.
- **Reduced motion** and **reduced transparency** (`prefers-reduced-transparency`) both honoured — the
  second replaces the nav material's blur with an opaque surface.
- **Text scaling**: the layout survives 200 % text zoom and iOS Dynamic Type. Nothing is sized in `px`
  that holds text; `rem` throughout.

---

# Part IX — Performance budgets

On a mid-range Android over Algerian 3G, which is the honest test case:

| Metric | Budget |
|---|---|
| First Contentful Paint | < 1.8 s |
| Largest Contentful Paint | < 2.5 s |
| Interaction to Next Paint | < 200 ms |
| Cumulative Layout Shift | < 0.05 |
| JS shipped to the browser, first load | < 180 KB gzipped |
| Fonts | Per locale: `fr` < 50 KB, `ar` < 140 KB, subset and preloaded |

> **Corrected in the build: the JS budget is per route, and Zod does not belong in the browser.**
> Measured against the production build on 2026-08-18, gzipped, one cold navigation per route:
>
> | Route | JS | Fonts |
> |---|---|---|
> | `/fr/login` | 158.5 KB | 44.6 KB |
> | `/fr/orders` | 162.9 KB | 44.6 KB |
> | `/ar/orders` | 162.9 KB | 131.1 KB |
>
> Two things had to be fixed to get there, and one measurement had to be corrected.
>
> **`/fr/login` was 222.4 KB, and 60 KB of it was Zod.** Part II pairs RHF with Zod, and Zod earns its
> place *at the boundary* — parsing API responses, which happens on the server where its weight is
> free. On the login form it validated two fields as "present" and shipped its whole runtime to the
> first screen anybody loads, on Algerian 3G. RHF's own `required` rule says the same thing for
> nothing. The rule this establishes: **Zod parses responses on the server; a client form reaches for
> the resolver only when the validation is worth 60 KB.** The options editor probably is; a login form
> is not.
>
> **A client component must not import values through a schema module.** `orderStatuses` lived beside
> the Zod schema that validates it, so a client component needing the seven strings pulled Zod in with
> them. The vocabulary now lives in `lib/order-status.ts`, which imports nothing.
>
> **And the first measurement was wrong**, which is worth recording because the mistake is easy: a
> Playwright run that signs in and then navigates to the list accumulates *both* routes' bundles and
> reported 242 KB for a route that ships 163. Per-route means a cold context per route.

> **Corrected in the build: the font budget is per locale, and "2 variable files" was one file too
> few.** The row above said `2 variable files, subset, < 90 KB total`. Three files ship, only one of
> them variable, for the reason in [Part III](#type) — and the total is the wrong unit anyway, because
> `unicode-range` means no reader ever downloads all three. Measured: `fr` transfers
> `plex-sans-latin-var.woff2` alone at 45.7 KB, comfortably inside the original 90 KB; `ar` adds the
> two Arabic weights for 134.2 KB and cannot be brought under 90 KB without dropping to a single
> weight, which would leave Arabic with no typographic weight signal at all.

Skeletons must match real row heights exactly — a skeleton of the wrong height is a layout shift with
extra steps.

> **Corrected in the build: an order row is 81 px, and the first skeleton was 72.** This is the exact
> failure the sentence above warns about, committed while writing it. The fix that holds is
> structural rather than numeric: the skeleton is built from the same paddings and line heights as the
> real row, so it cannot drift when the row changes. `scripts/shots.mjs` measures the rendered row on
> every run. Images through `next/image` with explicit dimensions. No chart library that ships a
plotting engine to render six bars.

---

# Part X — Build order

Fourteen branches. Each is independently reviewable and each inherits the rules of the ones before it,
mirroring §47's slicing.

**In this repository first:**

```
 1. feat/admin-users          §87   DONE
 2. feat/attributes           §88   DONE
 3. feat/cms-writes           §89
 4. feat/notification-queue   §90
```

**Then in `ecom-admin`:**

```
 5. feat/shell          Next.js, tokens, fonts, both locales, both directions,
                        check-design.sh, the five states as components
 6. feat/session        login, the sealed cookie, the proxy allowlist, /auth/me,
                        capability predicates, the forbidden state
 7. feat/patterns       grouped list, large title, sheet, segmented control,
                        action sheet, swipe row, toast, filter bar, date range
 8. feat/orders         the hardest real screen, and the one that proves the patterns
 9. feat/products       list with facets, detail, read-only variations   DONE
                        — the options editor is its own branch. §83's three group
                        types, their caps and their positional error paths are the
                        hardest component in the panel and would have swallowed this
                        one. Editing attributes and categories goes with the
                        attributes screen, which can build a whole attribute list
                        rather than the partial one that clears a variable product's
                        variations.
10. feat/inventory      low stock, adjust, the movements ledger              DONE
                        — one route, three views, plus the item screen. `PATCH
                        /inventory/{id}` came in with it: the "enable manage_stock"
                        409 names an action the panel could not otherwise perform.
                        `POST /inventory/bulk` did not — a batch stocktake is its
                        own screen and the allowlist refuses the route until one
                        exists.
11. feat/customers      + coupons                                    DONE
                        — two collections sharing no field, no capability and no
                        reader, and the branch where the forbidden fixtures
                        invert: a Support Agent reads customers and is refused
                        coupons; a Marketing Manager is the reverse. Five things
                        were fixed in `ecom-temp` rather than worked around here,
                        because the screens were not buildable as specified: the
                        consent record, and the two picker routes a Marketing
                        Manager needs to see what a coupon applies to.
12. feat/shipping       + payments + COD
13. feat/analytics      dashboard, the seven reports, the money gate
14. feat/content        CMS, media, marketing, campaigns, notifications
15. feat/admin          settings, users, audit, import/export
16. feat/pwa            manifest, service worker, offline states, cache wiping
```

Step 8 comes before step 7 is finished being pretty. Orders is the screen that will reveal which
patterns are wrong, and finding that out on the fourth screen instead of the first costs three
rewrites.

---

# Things that will bite you

The panel-side counterpart to `docs/API.md`'s own list.

- **A 403 is not a logout.** Only a 401 clears the session. Getting this wrong makes a Support Agent
  unable to stay signed in.
- **Render `details.fields`, not `error.message`.** The API lists every bad field on purpose.
- **Read the 409 body.** It names the legal status moves. Do not hard-code the transition table.
- **Facet counts are published-only while the list shows drafts.** Seven rows beside a count of six is
  correct.
- **`meta.money_visible` is a layout decision**, not a conditional on one number.
- **Campaign `send` needs a second capability.** 403 on send with 201 on create is not a bug.
- **`marketing_consent` is read-only to staff.** Show why.
- **Shipment `label` URLs are credentials.** Server-proxied, never in the DOM, never cached.
- **Exports are files.** Do not send them through the envelope client.
- **Imports are raw CSV bodies**, not multipart — unlike `/media`, which is.
- **`dry_run` defaults to true.** Applying is a separate action.
- **`?force=true` is permanent.** Different confirmation wording from a trash.
- **Reads are 600/min per credential**, shared across every tab that person has open.
- **Analytics windows cap at 366 days**, and `per_page` caps at 100.
- **Money is formatted, never computed.** The order is right; the panel is a renderer.
- **Numbers inside Arabic text need `dir="ltr"` isolation** or the digits reorder silently.
- **Application Passwords need HTTPS** outside a `local` environment. Staging without TLS is a panel
  that cannot sign anybody in.
- **The panel cannot revoke its own session remotely.** Revoking means deleting the Application
  Password, which is why §87 mints them per device with a name.

Added by the panel build, each one measured rather than anticipated:

- **A 401 is detected by status, not by `error.code`.** A wrong password answers `incorrect_password`.
- **`/orders` has no `wilaya` filter**, and an unknown query parameter is ignored with a 200 rather
  than refused — so a filter that does nothing looks exactly like a filter that works.
- **`?status=` takes one value.** A comma list is a 400.
- **`per_page` over 100 is a 400**, not a clamp, and parameter errors arrive under `details.params`
  rather than `details.fields`.
- **`timeline[].summary` and `notes[].content` contain HTML entities.** Decode to text; never to HTML.
- **`notes[].created_at` has no UTC offset** while `order.date_created` does. `new Date()` reads the
  first as local time and shifts it silently.
- **`/settings` publishes no timezone.** The panel is configured, not informed.
- **`name_ar` is empty for Algiers and Oran**, the two busiest wilayas. Fall back to the other script.
- **Money needs `fr-DZ`, not `fr`** — a bare `fr` renders `DZD` where the shop says `DA`.
- **The timeline already includes the notes.** Rendering both prints everything twice.
- **390 × 844 is the narrowest current iPhone, not the typical one.** Design there, but verify wider —
  see [Part IX](#part-ix--performance-budgets).

Added by the products build:

- **A facet is a set of counts, not a vocabulary.** Zero-count values are omitted — six terms,
  `total_values: 5`. The complete list comes from `/product-categories` and `/attributes/{id}/terms`.
- **The category facet does not exclude its own filter**, though the attribute, stock and price facets
  all do. Rendering it from the facet alone deletes every other category the moment one is picked.
- **`?category=` matches term ids and `?attributes[…]` matches term slugs.** Keying both by slug puts
  a silent `0` beside every category and nothing errors.
- **`orderby` accepted five values it did not honour** — `id`, `price`, `sku`, `popularity`, `rating`
  all returned date order. Fixed in the backend; verify a sort by comparing sequences, never counts.
- **A PATCH of only read-only fields is a 400 with no `details`.** Send a named subset, not "the GET
  body minus what looks read-only".
- **A duplicate SKU is a 409 with `details.sku`**, not a 400 with `details.fields`.
- **The `attributes` filter's 400 arrives under `details.fields`**, not `details.params` like every
  other query parameter, with `details.facetable_attributes` beside it.
- **Field-error messages are English.** Render them anyway; localise the label, not the reason.
- **A trashed product still GETs as 200 with `status: "trash"`.** Only `?force=true` produces a 404.
- **Replacing `attributes` on a variable product clears its variations' attribute maps.** Do not send
  a partial attribute list.
- **`options`, `bundle` and `options_problems` are absent keys**, not nulls, on a product with no
  option set — and saving the product deletes the groups `options_problems` is warning about.
- **A keystroke before hydration changes the DOM and not React.** Measured on WebKit, on a form
  reached by a hard reload: the input read back as typed while the `<h1>` still showed the stored
  name, so the form was never dirty and the save bar never appeared. Chromium hydrates fast enough to
  hide it. It is a real hazard for a real thumb, not only for a test — the mitigation on the test side
  is a retry, and the reason to keep the note is that no Chromium run will ever reproduce it.

  > **Corrected in the build: solved at `Field`, by refusing the keystroke rather than catching it.**
  > Every control in `components/primitives/Field.tsx` — and the adjust form's quantity field and the
  > SKU lookup — now renders `disabled` in the server's HTML and enables on mount, through
  > `useHydrated()`. The alternative was to render uncontrolled and adopt the DOM's value on mount,
  > which loses nothing and *shows* nothing; a window a person cannot see is a window they cannot work
  > around, so the honest version is the one where the control visibly cannot be typed into yet. The
  > hook is `useSyncExternalStore`, not `useState` + `useEffect`: only the former is specified to
  > return the server snapshot during SSR and the client snapshot from the first client render, and
  > the effect version leaves a paint of the same window it exists to close. The e2e suite asserts the
  > attribute in the server's HTML rather than racing a keystroke, because a race is exactly what
  > Chromium wins and WebKit loses.
- **`stock_quantity` is silently dropped when `manage_stock` is false.** A 200 that ignored the field.
- **No product carries an image.** A thumbnail column would be a column of placeholders.
- **A published product can have no price at all**, and the price facet floors at `0.00` because of it.
- **Product ids are not stable**: the backend's own suites delete and recreate their fixtures, so a
  test or a script must find a product by SKU.
- **`Sheet` had never been opened at `md`.** `inset-block: 50%` is not centring — with `block-size:
  auto` it resolves the height to zero, and the desktop sheet rendered 544 × 0.

Added by the customers and coupons build:

- **The forbidden fixture is per screen, not per branch.** A Support Agent reads customers and is
  refused coupons; a Marketing Manager is the exact inverse. `scripts/test.sh` mints three
  credentials, and the Marketing Manager earns its place positively as well: it is the role the
  restriction picker could not have been built for.

Added by the two-tier role collapse (`ecom-temp`, `feat/two-tier-roles`, 2026-08-20):

- **Seven roles are two tiers: Super Admin and Manager.** The other five are *retired* — still defined,
  still published by `GET /roles` with an `assignable` flag, still valid in `?role=`, never granted.
- **Retiring, not deleting, is the whole safety property.** `remove_role()` does not touch
  `wp_capabilities` usermeta, so a live account pointing at a deleted role resolves to **zero
  capabilities**: it authenticates and then 403s everywhere, which reads as a permissions bug.
- **The panel needed no change.** Every gate is a capability, not a role name. Pre-collapse Application
  Passwords still authenticate — they are per account, not per role.
- **Both compound capability rules stopped discriminating.** Manager holds `ac_view_analytics` and
  `ac_manage_orders`, so `canSeeMoney()` is true for every staff account and `meta.money_visible` is
  never false. Manager holds neither marketing capability, so `canSendCampaigns()`'s draft-but-cannot-
  send state has no role. Keep both predicates; retire the tests that depended on them.
- **`set_role()` bypasses the API's narrowing**, so `mint-credential.sh` and the backend's own
  `tests/Api/*` fixtures still assign retired roles freely — and a full backend suite puts ~50 accounts
  back onto them. On a dev stack the collapse needs re-running; on a real install nothing calls it.
- **`?search=` on customers does not match a name**, only login, email and display name. Proven with
  a positive control, because an unmatched search and an unsearchable field look identical.
- **12 of 16 customers have no name at all.** A list that renders `first_name` as the row's identity
  renders twelve blank rows.
- **The customer detail is the list row plus `statistics`** — the first collection here where the two
  routes disagree, so "one schema serves both" stops being true.
- **`total_orders` and `average_order_value` do not divide.** Revenue and the average count only
  completed orders. Label the scope or do not put them adjacent.
- **`POST /customers` is a 404, not a 403.** Staff do not create shoppers.
- **A customer address merges on a partial PATCH**, unlike a product, and an unknown sub-key is
  refused as a dotted path — `details.fields["billing.nonsense"]`.
- **User ids and post ids collide.** Customer 24 is also product 24. An id from one table is not a
  usable negative fixture for the other.
- **A coupon's `amount: "0.00"` is real while a threshold's zero is not** — the null-versus-zero rule
  running in opposite directions on one object.
- **`date_expires` is written `Y-m-d` and read back as ISO.** Bound straight to a date input it
  renders empty and then clears itself on the next save.
- **A default coupon list carries drafts.** No `?status=` means publish *and* draft; `?status=trash`
  is a 400 while a trashed coupon still GETs 200.
- **`Ltr` around a translated sentence forces the wrong direction.** Sixteen call sites reached for
  `numeric`'s tabular figures and took the forced direction with them, laying an Arabic count out
  from the left. `Ltr` is for a bare identifier only; the moment a translated word shares the
  element, it is `Isolate`. Money and percentages measured *identically* under both, so those stay.
- **A `fixed bottom-0` save bar lands under the tab bar.** Both are `z-20` and the tab bar comes
  later in the document, so the save button was physically untappable at phone widths. `.save-bar`
  already existed and solves it.
- **A native date input follows the browser's locale**, not the page's, and `lang` does not override
  it on Chromium. The Arabic form shows `mm/dd/yyyy` and the value is echoed underneath instead.

---

# Reading order for whoever builds this

1. [docs/API.md](API.md) — the contract. All of it.
2. [docs/SECURITY.md](SECURITY.md) — "Authorization", "Secrets", "File uploads", "CSRF".
3. This document, Part I, and build those four route groups.
4. This document, Parts II–IV, and build the shell.
5. The `impeccable` skill and the Apple/iOS design skill, before the first component.
6. [docs/TESTING.md](TESTING.md) — the conventions the panel's own suites mirror.

`CLAUDE.md` summarises this repository and lags it slightly; where the two disagree, the code is
right. Where this document and `docs/API.md` disagree, `docs/API.md` is right — and where
`docs/API.md` and `scripts/test-api.sh` disagree, the script is right.
