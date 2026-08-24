import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/primitives/Icon";

/**
 * The page header. See DESIGN.md §2.4.
 *
 * Replaces `Scaffold`'s collapsing large title, which drove an
 * `IntersectionObserver` and two animated properties on every scroll in order to
 * move a title thirty pixels. That is an iOS navigation-bar behaviour, and the
 * thing it buys — vertical room on a 667px phone — is not a problem a panel
 * being read on a monitor has.
 *
 * Static, therefore. It scrolls away with the page like any other content: a
 * sticky page header plus a sticky table header eats 104px of a 768px laptop
 * viewport, which is the actual constraint on this screen.
 */

export function PageHeader({
  title,
  /** A count or one-line description. Never a paragraph. */
  subtitle,
  /** The way back to the list. Rendered at **every** width — see below. */
  back,
  actions,
  /** Filter bar, tabs, search — rendered below the title block. */
  toolbar,
  /** A rule closes the block on list pages; detail pages let the first card do it. */
  divided = true,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  toolbar?: ReactNode;
  divided?: boolean;
}) {
  return (
    <div className={divided ? "border-b border-ui-line" : ""}>
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-6 xl:px-8">
        {/*
          At **every** width, and that is a correction to DESIGN.md rather than a
          preference.

          §2.2 puts the breadcrumb in the top bar at `lg`+ and §2.4 says the back
          link is only needed below it. But `AppShell` renders that top bar
          `lg:hidden` — at `lg`+ there is a sidebar and no bar at all, so the
          breadcrumb was specified for a piece of chrome that does not exist
          there. With this link also `lg:hidden`, a detail screen on a desktop had
          no way back to its list except the sidebar's own nav item, which loses
          the filter the person arrived with.

          Both sections carry the amendment.
        */}
        {back ? (
          <Link
            href={back.href}
            className="ui-ring ui-interactive -ms-1 inline-flex min-h-7 w-fit items-center gap-1 rounded-ui-md px-1 text-ui-label text-ui-muted hover:text-ui-fg"
          >
            {/* A back arrow points the way the reader reads, so it flips. */}
            <Icon name="back" flipInRtl className="size-3.5" />
            <span className="truncate">{back.label}</span>
          </Link>
        ) : null}

        {/*
          Title and actions share a row from `sm` up. Below that the actions
          drop to their own row and go full width — two labelled buttons do not
          fit beside a title at 340px, and shrinking them to icons loses the
          label on the one screen size where a tooltip cannot replace it.
        */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {/*
              `dir="auto"`, because a detail screen's title is the *record's* name
              — a product, a customer, a page — and §6 says a user-supplied string
              in chrome resolves its own direction. Without it a French product
              name in the Arabic panel inherits RTL, and `truncate` then puts the
              ellipsis at the wrong end of a name that was already laid out
              backwards. A translated title is unaffected: `auto` resolves from the
              first strong character, which is the locale's own script.
            */}
            <h1
              dir="auto"
              className="truncate text-ui-title text-ui-fg xl:text-ui-display"
            >
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1 text-ui-label text-ui-muted">{subtitle}</p>
            ) : null}
          </div>

          {/*
            A row at every width, wrapping if it must.
            
            An earlier draft stacked these below `sm`, following the rule in
            DESIGN.md §2.4 that action rows stack on a phone. Measured at 340px
            that was wrong for *this* shape: a `flex-col` container stretches its
            children, so the icon-only refresh button kept its square and the
            Export button went full width beneath it — two controls on two rows,
            badly matched, eating 90px above the data. The pair measures about
            154px side by side against 308px of available width, so they fit.

            The stacking rule still holds for two *labelled* buttons, which is
            what it was written for; `flex-wrap` is what lets both be true.
          */}
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>

        {toolbar}
      </div>
    </div>
  );
}

/**
 * The content column under a header. The width follows the content rather than
 * being `max-w-3xl` by habit — see DESIGN.md §2.3.
 */
export function PageBody({
  width = "full",
  children,
  className = "",
}: {
  /**
   * `full` for tables, `form` for settings, `detail` for a single column,
   * `split` for the two-column detail `DetailGrid` draws.
   */
  width?: "full" | "wide" | "split" | "detail" | "form";
  children: ReactNode;
  className?: string;
}) {
  const MAX = {
    full: "max-w-400",
    wide: "max-w-360",
    /* 1152 = 768 + 24 + 360: §2.3's single-column detail width, the gutter, and
       the aside. The main column at its widest is exactly as wide as it would be
       if the aside were not there. */
    split: "max-w-288",
    detail: "max-w-192",
    form: "max-w-160",
  } as const;

  return (
    <main
      id="content"
      className={`mx-auto w-full px-4 py-4 sm:px-6 xl:px-8 ${MAX[width]} ${className}`}
    >
      {children}
    </main>
  );
}
