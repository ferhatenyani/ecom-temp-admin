/**
 * One icon set, outline, 1.5px stroke, self-hosted. Never an icon font, and never
 * an emoji standing in for an icon.
 *
 * The sprite is rendered once per document by `IconSprite` in the panel layout,
 * so `<use>` resolves against the same document — an external sprite file costs a
 * request and loses `currentColor` inheritance in some engines.
 *
 * A 20px icon gets its 44px hit area from the `.tap-44` utility on the control
 * around it, never by growing the icon.
 */

export const ICON_NAMES = [
  "orders",
  "products",
  "dashboard",
  "customers",
  "more",
  "chevron",
  "back",
  "search",
  "filter",
  "check",
  "close",
  "alert",
  "clock",
  "refresh",
  "phone",
  "mail",
  "pin",
  "box",
  "note",
  "lock",
  "plus",
  "tag",
  /*
   * Added on the content branch. `up` and `down` are the reordering controls:
   * the homepage document and the menu tree are both *ordered* content, and
   * HTML5 drag-and-drop has no touch implementation and no keyboard path, so
   * moving a row one place is a button rather than a drag. `MoveControls`
   * carries the argument.
   */
  "image",
  "up",
  "down",
  "trash",
  "link",
  "list",
  /*
   * Added with the redesign. `menu` opens the navigation drawer below lg;
   * `columns`, `density`, `sortAsc`/`sortDesc` and `collapse` belong to the
   * DataTable's own controls; `sun`/`moon`/`system` are the three theme states;
   * `download` is export; `command` marks the palette shortcut; `first`/`last`
   * are the pagination ends; `external` marks a link that leaves the drawer.
   */
  "menu",
  "columns",
  "density",
  "sortAsc",
  "sortDesc",
  "collapse",
  "sun",
  "moon",
  "system",
  "download",
  "command",
  "first",
  "last",
  "external",
  "user",
  "logout",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export function Icon({
  name,
  className = "size-5",
  /**
   * A chevron and a back arrow point the way the reader reads, so they flip.
   * A clock, a checkmark and a box do not — most pictograms never mirror.
   */
  flipInRtl = false,
}: {
  name: IconName;
  className?: string;
  flipInRtl?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-flip={flipInRtl ? "" : undefined}
    >
      <use href={`#ac-icon-${name}`} />
    </svg>
  );
}

/**
 * The sprite. Rendered once, hidden from layout and from the accessibility tree.
 */
export function IconSprite() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        <symbol id="ac-icon-orders" viewBox="0 0 24 24">
          <path d="M6 3.5h12a1 1 0 0 1 1 1v16l-2.5-1.75L14 20.5l-2-1.75L10 20.5l-2.5-1.75L5 20.5v-16a1 1 0 0 1 1-1Z" />
          <path d="M8.5 8.5h7M8.5 12.5h7" />
        </symbol>
        <symbol id="ac-icon-products" viewBox="0 0 24 24">
          <path d="M12 3.5 20 8v8L12 20.5 4 16V8l8-4.5Z" />
          <path d="M4 8l8 4.5L20 8M12 12.5v8" />
        </symbol>
        <symbol id="ac-icon-dashboard" viewBox="0 0 24 24">
          <path d="M4.5 19.5v-6M9.5 19.5v-11M14.5 19.5v-7M19.5 19.5v-13" />
        </symbol>
        <symbol id="ac-icon-customers" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="3.75" />
          <path d="M4.75 20.25a7.25 7.25 0 0 1 14.5 0" />
        </symbol>
        <symbol id="ac-icon-more" viewBox="0 0 24 24">
          <circle cx="5.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
        </symbol>
        <symbol id="ac-icon-chevron" viewBox="0 0 24 24">
          <path d="m9.5 5.5 7 6.5-7 6.5" />
        </symbol>
        {/*
          A separate symbol pointing start-ward rather than the chevron plus a
          flip utility: two competing `transform` declarations on one element do
          not compose, they fight on specificity, and in RTL that produced an
          arrow pointing the wrong way.
        */}
        <symbol id="ac-icon-back" viewBox="0 0 24 24">
          <path d="m14.5 5.5-7 6.5 7 6.5" />
        </symbol>
        <symbol id="ac-icon-search" viewBox="0 0 24 24">
          <circle cx="10.75" cy="10.75" r="6.25" />
          <path d="m15.5 15.5 4 4" />
        </symbol>
        <symbol id="ac-icon-filter" viewBox="0 0 24 24">
          <path d="M4.5 7h15M7 12h10M10 17h4" />
        </symbol>
        <symbol id="ac-icon-check" viewBox="0 0 24 24">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </symbol>
        <symbol id="ac-icon-close" viewBox="0 0 24 24">
          <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
        </symbol>
        <symbol id="ac-icon-alert" viewBox="0 0 24 24">
          <path d="M12 4.5 21 19.5H3L12 4.5Z" />
          <path d="M12 10v4M12 16.75v.5" />
        </symbol>
        <symbol id="ac-icon-clock" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="7.75" />
          <path d="M12 7.75V12l3 2" />
        </symbol>
        <symbol id="ac-icon-refresh" viewBox="0 0 24 24">
          <path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7" />
          <path d="M19.75 4.5v4.25H15.5" />
        </symbol>
        <symbol id="ac-icon-phone" viewBox="0 0 24 24">
          <path d="M7.5 3.75h3l1.25 3.5-2 1.25a9.5 9.5 0 0 0 5 5l1.25-2 3.5 1.25v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 5.5 5.95a2 2 0 0 1 2-2.2Z" />
        </symbol>
        <symbol id="ac-icon-mail" viewBox="0 0 24 24">
          <rect x="3.5" y="6" width="17" height="12" rx="2" />
          <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
        </symbol>
        <symbol id="ac-icon-pin" viewBox="0 0 24 24">
          <path d="M12 21s6-5.25 6-9.75a6 6 0 0 0-12 0C6 15.75 12 21 12 21Z" />
          <circle cx="12" cy="11" r="2.25" />
        </symbol>
        <symbol id="ac-icon-box" viewBox="0 0 24 24">
          <rect x="4" y="7.5" width="16" height="12" rx="1.75" />
          <path d="M4 11.5h16M9.5 7.5v-3h5v3" />
        </symbol>
        <symbol id="ac-icon-note" viewBox="0 0 24 24">
          <path d="M5.5 4.5h13v15h-13z" />
          <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" />
        </symbol>
        <symbol id="ac-icon-lock" viewBox="0 0 24 24">
          <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
          <path d="M8.75 10.5V8a3.25 3.25 0 0 1 6.5 0v2.5" />
        </symbol>
        {/* Never mirrored: a plus is a universal mark, and the HIG is explicit
            that those keep one appearance in every direction. */}
        <symbol id="ac-icon-plus" viewBox="0 0 24 24">
          <path d="M12 5.5v13M5.5 12h13" />
        </symbol>
        {/* Coupons. Drawn rather than borrowed from `box`, so a coupon in the
            navigation does not read as a parcel. */}
        <symbol id="ac-icon-tag" viewBox="0 0 24 24">
          <path d="M4.75 11.4V5.5a.75.75 0 0 1 .75-.75h5.9a.75.75 0 0 1 .53.22l7.1 7.1a.75.75 0 0 1 0 1.06l-5.9 5.9a.75.75 0 0 1-1.06 0l-7.1-7.1a.75.75 0 0 1-.22-.53Z" />
          <circle cx="8.75" cy="8.75" r="1.15" />
        </symbol>
        <symbol id="ac-icon-image" viewBox="0 0 24 24">
          <rect x="3.75" y="5.25" width="16.5" height="13.5" rx="1.75" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="m4.5 16.5 4.25-4.25a1 1 0 0 1 1.4 0l3.6 3.6a1 1 0 0 0 1.4 0l1.6-1.6a1 1 0 0 1 1.4 0l2.4 2.4" />
        </symbol>
        {/*
          `up` and `down` are separate symbols and neither flips. A reordering
          arrow points along the *list*, which runs top to bottom in both
          directions — mirroring it would make the control lie in Arabic.
        */}
        <symbol id="ac-icon-up" viewBox="0 0 24 24">
          <path d="M12 19V5.5M6.5 11 12 5.5 17.5 11" />
        </symbol>
        <symbol id="ac-icon-down" viewBox="0 0 24 24">
          <path d="M12 5v13.5M6.5 13l5.5 5.5L17.5 13" />
        </symbol>
        <symbol id="ac-icon-trash" viewBox="0 0 24 24">
          <path d="M4.75 6.75h14.5M9.5 6.75V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.25" />
          <path d="M6.75 6.75 7.6 19a1 1 0 0 0 1 .95h6.8a1 1 0 0 0 1-.95l.85-12.25" />
          <path d="M10.5 10.25v6M13.5 10.25v6" />
        </symbol>
        <symbol id="ac-icon-link" viewBox="0 0 24 24">
          <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.5 1.5" />
          <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.5-1.5" />
        </symbol>
        <symbol id="ac-icon-list" viewBox="0 0 24 24">
          <path d="M9 6.5h10.5M9 12h10.5M9 17.5h10.5" />
          <circle cx="5" cy="6.5" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="5" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="5" cy="17.5" r="1.15" fill="currentColor" stroke="none" />
        </symbol>
        {/* ── added with the redesign ──────────────────────────────────── */}
        <symbol id="ac-icon-menu" viewBox="0 0 24 24">
          <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
        </symbol>
        <symbol id="ac-icon-columns" viewBox="0 0 24 24">
          <rect x="4" y="5" width="16" height="14" rx="1.5" />
          <path d="M10.5 5v14M15.5 5v14" />
        </symbol>
        <symbol id="ac-icon-density" viewBox="0 0 24 24">
          <path d="M4.5 6h15M4.5 10h15M4.5 14h15M4.5 18h15" />
        </symbol>
        {/*
          Sort arrows are a bar plus an arrowhead rather than a bare chevron, so
          the direction reads at 14px in a header cell. They never flip in RTL:
          ascending is ascending in every script.
        */}
        <symbol id="ac-icon-sortAsc" viewBox="0 0 24 24">
          <path d="M12 19V6M12 6l-4.5 4.5M12 6l4.5 4.5" />
        </symbol>
        <symbol id="ac-icon-sortDesc" viewBox="0 0 24 24">
          <path d="M12 5v13M12 18l-4.5-4.5M12 18l4.5-4.5" />
        </symbol>
        <symbol id="ac-icon-collapse" viewBox="0 0 24 24">
          <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
          <path d="M9.5 5v14" />
        </symbol>
        <symbol id="ac-icon-sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
        </symbol>
        <symbol id="ac-icon-moon" viewBox="0 0 24 24">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        </symbol>
        <symbol id="ac-icon-system" viewBox="0 0 24 24">
          <rect x="3.5" y="5" width="17" height="11" rx="1.5" />
          <path d="M9 20h6M12 16v4" />
        </symbol>
        <symbol id="ac-icon-download" viewBox="0 0 24 24">
          <path d="M12 4v11M12 15l-4-4M12 15l4-4M5 19h14" />
        </symbol>
        <symbol id="ac-icon-command" viewBox="0 0 24 24">
          <path d="M9 6.5a2.5 2.5 0 1 0-2.5 2.5H9m0-2.5V9m0-2.5h6m0 0a2.5 2.5 0 1 1 2.5 2.5H15m0-2.5V9m0 6v2.5a2.5 2.5 0 1 0 2.5-2.5H15Zm0 0H9m0 0v2.5A2.5 2.5 0 1 1 6.5 15H9Zm0 0V9m6 6V9m0 0H9" />
        </symbol>
        {/* Pagination ends. These DO flip — first means "the end you read
            from", which is the right edge in Arabic. */}
        <symbol id="ac-icon-first" viewBox="0 0 24 24">
          <path d="m16 5.5-7 6.5 7 6.5M7.5 5.5v13" />
        </symbol>
        <symbol id="ac-icon-last" viewBox="0 0 24 24">
          <path d="m8 5.5 7 6.5-7 6.5M16.5 5.5v13" />
        </symbol>
        <symbol id="ac-icon-external" viewBox="0 0 24 24">
          <path d="M14 5h5v5M19 5l-7.5 7.5" />
          <path d="M18 14.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V7.5A1.5 1.5 0 0 1 6 6h3.5" />
        </symbol>
        <symbol id="ac-icon-user" viewBox="0 0 24 24">
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
        </symbol>
        <symbol id="ac-icon-logout" viewBox="0 0 24 24">
          <path d="M15 8V6a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 15 18v-2" />
          <path d="M11 12h9m0 0-3-3m3 3-3 3" />
        </symbol>
      </defs>
    </svg>
  );
}
