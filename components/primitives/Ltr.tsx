/**
 * Bidi isolation for identifiers.
 *
 * A tracking number, SKU, phone number or order id inside Arabic text needs its
 * own direction and `unicode-bidi: isolate`, or the bidi algorithm reorders it
 * and a customer reads back a number that does not exist. This is the single most
 * common bug in bilingual admin tools and it is silent — nothing errors, the
 * number is just wrong on screen.
 *
 * Use it for every identifier. Numbers never mirror, in any locale.
 */
export function Ltr({
  children,
  className,
  numeric = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Tabular figures, for anything that appears in a column. */
  numeric?: boolean;
}) {
  return (
    <span
      dir="ltr"
      className={className}
      style={{ unicodeBidi: "isolate" }}
      {...(numeric ? { "data-numeric": "" } : {})}
    >
      {children}
    </span>
  );
}
