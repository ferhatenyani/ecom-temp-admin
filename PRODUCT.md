# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Algerian retail staff, seven roles from Super Admin down to Support Agent, using this on a phone
far more often than on a desk. The load-bearing scenes are a stockroom (one hand, phone held at
arm's length, bad light), a delivery van (mobile data, intermittent), and a back office desk. They
read French or Arabic; many switch between the two mid-sentence. Every staff member authenticates
as themselves with their own WordPress Application Password, because the audit trail has to name a
real person.

## Product Purpose

Run the shop's daily commerce operations — orders, products, inventory, customers, shipping,
payments, content — without ever opening wp-admin. `docs/ADMIN_PANEL.md` (Parts II–X) is the build
specification; PLAN §52 in the backend repository is the requirement it answers.

## Positioning

A commerce admin that is honestly bilingual and honestly mobile. Both directions are first-class
from the first component rather than retrofitted, and the primary navigation sits in thumb reach.
It is not a responsive desktop dashboard that survives on a phone.

## Operating Context

- Backend: `~/projects/ecom-temp`, a headless WordPress + WooCommerce plugin exposing
  `/wp-json/algerian-commerce/v1` — 125 routes, contract in `docs/API.md`, live at
  `http://localhost:8090`.
- The browser never holds a credential. Requests go browser → Next.js Route Handler → API, with
  the Application Password attached server-side only.
- Reads are rate-limited to 600/min **per credential**, shared across every tab that person has
  open, which is why nothing polls faster than 30 s.
- Money and dates are rendered, never computed. The API has already done the arithmetic.

## Capabilities and Constraints

- Next.js 16.3.1 App Router, React 19.2, TypeScript strict. `middleware.ts` is renamed `proxy.ts`
  in Next 16; `params`/`searchParams`/`cookies()` are Promises; `next/root-params` supersedes
  next-intl's deprecated `requestLocale`.
- Tailwind v4 with `@theme` tokens only — arbitrary values and raw colour literals fail CI.
- Locales `fr` and `ar`, both always present in the URL, no implicit default.
- Capabilities from `GET /auth/me` decide what renders; they are never an access boundary. Every
  route enforces its own permission server-side.
- No offline write queue. Reads may be cached; writes need a connection and say so.
- **Open**: the shop timezone is not exposed by the API (measured — `/settings` has no such field),
  so it is configuration on the panel side.

## Brand Commitments

Binding, from the person who commissioned the panel, and constraints rather than preferences:

- No gradients anywhere. `backdrop-filter: blur()` on a navigation material is permitted and is not
  a gradient.
- No accent bars — no coloured leading border to mark status, category or selection.
- No generic fonts. IBM Plex Sans + IBM Plex Sans Arabic, self-hosted from `public/fonts`,
  committed to this repository, never `next/font/google`.
- No component library whose look is the house style of generated UI — no shadcn/ui, MUI, Chakra,
  Ant. Radix is permitted for behaviour only, with every visual property ours.
- Mobile first at 390 × 844, bottom tab bar, iOS-like grammar.
- Full RTL. Physical direction properties are banned and checked.

`scripts/check-design.sh` enforces these, because a rule nobody enforces is a preference.

## Evidence on Hand

- A live backend with real seeded data: 633 orders, 69 wilayas with bilingual names, seven roles.
- `docs/ADMIN_PANEL.md` — the full build specification, including the `Corrected in the build:`
  convention this project uses to record where the spec was wrong.
- `~/projects/ecom-temp/docs/API.md` — the route contract; `scripts/test-api.sh` is its executable
  version and outranks it where they disagree.
- No design mockups exist, and none are owed: Part III specifies the visual system directly.

## Product Principles

1. **Measure, don't remember.** Hit the real API before designing against its shapes. When the
   build proves the specification wrong, correct the specification in place with a
   `> **Corrected in the build:**` note.
2. **Every negative carries a positive control.** A refusal and an unreachable route look identical
   from outside; a test that only asserts the refusal proves nothing.
3. **The API is the authority on its own rules.** Offer the moves and render what a 409 says is
   legal rather than hard-coding a transition table.
4. **A banned pattern needs a named replacement**, or it gets reinvented by the next person.
5. **Say what is unknown.** A number that means "we cannot know" is never rendered as zero, and
   stale data is never silently stale.

## Accessibility & Inclusion

Staff use this eight hours a day, some on a cracked phone in a badly-lit stockroom. 4.5:1 for text
and 3:1 for UI boundaries in both themes; 44 × 44 CSS px minimum targets; semantic colour never the
only signal; `prefers-reduced-motion` and `prefers-reduced-transparency` both honoured; layout
survives 200 % text zoom, so nothing holding text is sized in `px`.
