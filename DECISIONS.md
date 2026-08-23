# DECISIONS.md — the redesign ledger

One block per screen, appended as it is built and merged. Never rewritten.
`DESIGN.md` says how the panel looks; this file says what was decided for each
screen and, more usefully, what was **left out** and why.

The rule the whole run follows: **this API accepts parameters and silently
ignores them.** Five `orderby` values on `/products` returned byte-identical id
sequences. So a control ships only when someone measured it working. Anything
unverified is treated as not working, and its absence is recorded here rather
than left to look like an oversight.

---

## Checklist — 41 route pages

```
[x]  0. Harness — mock API, capture script, this file
[x]  1. Orders — list
[ ]  2. Products — list
[ ]  3. Orders — detail
[ ]  4. Products — detail + form
[ ]  5. Customers — list + detail
[ ]  6. Inventory — list + detail
[ ]  7. Coupons — list + form
[ ]  8. Shipping
[ ]  9. Payments
[ ] 10. Dashboard
[ ] 11. Analytics — revenue
[ ] 11. Analytics — orders
[ ] 11. Analytics — products
[ ] 11. Analytics — customers
[ ] 11. Analytics — shipping
[ ] 11. Analytics — COD
[ ] 12. Content — pages list
[ ] 12. Content — page form
[ ] 12. Content — banners
[ ] 12. Content — FAQs
[ ] 12. Content — homepage
[ ] 12. Content — menus
[ ] 12. Content — index
[ ] 13. Media
[ ] 14. Marketing — campaigns list
[ ] 14. Marketing — composer
[ ] 14. Marketing — segments
[ ] 14. Marketing — config
[ ] 14. Marketing — templates
[ ] 15. Notifications — list + detail
[ ] 16. Staff — list, detail, new
[ ] 17. Settings
[ ] 18. Transfer
[ ] 19. Audit
[ ] 20. Login + not-found
[ ] 21. TEARDOWN
```

Progress check that does not depend on this list: a file with no `ui-` prefix in
its classNames is not migrated. `grep -L 'ui-' app/**/*.tsx`.

---

## 0. Harness — 2026-08-23

Not a screen. The thing every later screen is verified with.

- **Why:** the e2e suite needs live shop credentials nobody has in this
  environment, and a previous session proved a passing `next build` is not
  sufficient — it once passed with a completely broken stylesheet, off a stale
  `.next` cache. So verification had to become something that renders the page.
- `scripts/mock-api.mjs` — a dependency-free `node:http` shop API. Deterministic
  data, seeded, so a screenshot is stable between runs.
- `scripts/capture.mjs` — mints an `ac_admin_session` cookie with `jose` from
  `SESSION_SECRET`, then per route screenshots 340/768/1440 × light/dark × fr/ar
  and asserts zero console errors, zero page errors, and
  `documentElement.scrollWidth === clientWidth` at every width.
- **Mirrors the API's dishonesty on purpose:** the mock accepts `orderby` and
  `order` and ignores them, exactly as measured against the live router. An
  agent must not be able to "verify" a sort control against the harness and ship
  one that does nothing in production.
- **Omitted deliberately:** write endpoints beyond what a screen reads. The mock
  grows one route group per page, the way `lib/api/allowlist.ts` does; a route
  no screen calls is not mocked, so a screen calling something nobody reviewed
  fails loudly instead of quietly succeeding.
- **Notes:** the harness asserts the mock actually received requests. Without
  that, a panel still pointed at `localhost:8090` renders error states at every
  breakpoint and the capture passes on twelve screenshots of nothing.
