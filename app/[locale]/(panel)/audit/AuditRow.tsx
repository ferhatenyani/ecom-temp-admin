import { useTranslations } from "next-intl";
import type { AuditRow as Row } from "@/lib/api/schemas/audit";
import {
  actionTone,
  changedPairs,
  isRedacted,
  isSystemActor,
  metadataShape,
} from "@/lib/audit";
import { formatDate } from "@/lib/format/date";
import { Dot } from "@/components/primitives/StatusBadge";
import { Ltr, Isolate } from "@/components/primitives/Ltr";

/**
 * One entry in the trail.
 *
 * Module scope with explicit props, never nested in the list — the README rule.
 * It holds no state, so nesting would only be wasteful, but the rule is the rule
 * and this file is the one somebody copies.
 *
 * **The action renders as itself and is not translated**, and that is a measured
 * decision rather than a shortcut. There are **85 distinct actions** on this
 * install across 23 resource types and the set grows with every subsystem the
 * backend adds; every one of them contains a `.`, which is a `next-intl` path
 * separator, and the defect that shipped on 14b was exactly this — eight event
 * names used as flat message keys, every one resolving to a path that does not
 * exist, seven of eight e2e tests still passing because the key path renders as
 * plausible-looking text. `product.updated` is an identifier: it is the exact
 * string `?action=` takes, it is what somebody quotes into a bug report, and it
 * goes in `Ltr` for the same reason a SKU does.
 *
 * The **resource type** is translated, because it is the vocabulary of a control
 * — `?resource_type=` is the filter this screen offers — and a picker has to say
 * something in the reader's language. One this build has no name for renders as
 * itself, which is how `ac_banner` (one row in 16 632, a CMS delete path
 * recording a post type where every sibling records `banner`) stays visible as
 * the oddity it is.
 */
export function AuditRow({ row, locale }: { row: Row; locale: string }) {
  const t = useTranslations("audit");

  const shape = metadataShape(row.metadata);
  const system = isSystemActor(row);

  return (
    <div className="list-row flex min-w-0 flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-2">
        <Dot tone={actionTone(row.action)} />
        {/* The action is an identifier. `Ltr` around it, never around the row —
            wrapping the row would force its direction and lay an Arabic line out
            from the left, which is the sixteen-call-site defect the customers
            branch found. */}
        <Ltr numeric={false} className="min-w-0 flex-1 truncate text-body text-label">
          {row.action}
        </Ltr>
        <Isolate className="shrink-0 text-caption text-label-tertiary">
          {/* `created_at` has no offset. `formatDate` goes through
              `parseApiDate`, which reads an offsetless stamp as UTC — `new
              Date()` would shift every row by the host's offset with nothing on
              screen to show it. */}
          {formatDate(row.created_at, locale)}
        </Isolate>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-footnote text-label-secondary">
        {system ? (
          <span>{t("systemActor")}</span>
        ) : (
          <Ltr numeric={false} className="min-w-0 truncate">
            {row.actor_login}
          </Ltr>
        )}
        <span aria-hidden="true" className="text-label-tertiary">
          ·
        </span>
        <Isolate numeric={false} className="min-w-0 truncate">
          {t.has(`resource.${row.resource_type}`)
            ? t(`resource.${row.resource_type}`)
            : row.resource_type}
        </Isolate>
        {/* `"0"` on a settings row, where there is no resource to point at. */}
        {row.resource_id !== "" && row.resource_id !== "0" ? (
          <Ltr numeric={false} className="min-w-0 truncate">
            #{row.resource_id}
          </Ltr>
        ) : null}
      </div>

      {/*
        **What the trail recorded, rendered by shape rather than by assumption.**
        ADMIN_PANEL.md says writes are audited by field name and never by value;
        measured, that is true of `settings.updated` — which is where the spec
        argues for it, and where the shop's trade-register numbers would
        otherwise sit in a table nobody cleans — and false of `product.updated`,
        which carries `before` and `after` in full. Four shapes, all four live.
      */}
      {shape.kind === "change" ? (
        <ul className="flex flex-col gap-0.5 text-caption text-label-tertiary">
          {changedPairs(shape).map((pair) => (
            <li key={pair.field} className="flex min-w-0 flex-wrap items-baseline gap-1">
              <Ltr numeric={false} className="shrink-0">
                {pair.field}
              </Ltr>
              <span className="min-w-0 truncate line-through" dir="auto">
                {pair.before}
              </span>
              <Arrow />
              <span className="min-w-0 truncate" dir="auto">
                {pair.after}
              </span>
            </li>
          ))}
        </ul>
      ) : shape.kind === "transition" ? (
        <p className="flex min-w-0 flex-wrap items-baseline gap-1 text-caption text-label-tertiary">
          <Ltr numeric={false} className="min-w-0 truncate">
            {shape.from}
          </Ltr>
          <Arrow />
          <Ltr numeric={false} className="min-w-0 truncate">
            {shape.to}
          </Ltr>
        </p>
      ) : shape.kind === "fields" ? (
        <p className="text-caption text-label-tertiary">
          {/* The field *names*, which is the whole point of this shape: the log
              says a trade-register field changed and not what it changed to,
              and a reader expecting values has to be told they were never
              stored. */}
          <Isolate numeric={false}>
            {t("fieldsChanged", { fields: shape.fields.join(", ") })}
          </Isolate>
        </p>
      ) : shape.entries.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-caption text-label-tertiary">
          {shape.entries.map(([key, value]) => (
            <li key={key} className="flex min-w-0 flex-wrap items-baseline gap-1">
              <Ltr numeric={false} className="shrink-0">
                {key}
              </Ltr>
              {/*
                `[redacted]` is what the writer stored, and it is a **fact rather
                than a missing value**: the trail records field names, not
                values, and redacts what it must. A row rendering it as a blank
                would say the key was absent, which is a different and untrue
                thing. Measured on `notification.retried`, where `dedupe_key`
                comes back redacted because it carries a customer's order id.
              */}
              {isRedacted(value) ? (
                <span className="tonal tone-neutral rounded-sm px-1">{t("redacted")}</span>
              ) : (
                <span className="min-w-0 truncate" dir="auto">
                  {value}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The arrow between a before and an after.
 *
 * A character rather than an SVG, and `→` rather than a locale-flipped one: it
 * separates two *values*, both of which are `Ltr` identifiers, so the pair reads
 * left to right in both locales and mirroring the arrow would point it away from
 * the direction the values are actually laid out in. `aria-hidden`, because the
 * two spans either side already say what changed.
 */
function Arrow() {
  return (
    <span aria-hidden="true" className="shrink-0 text-label-tertiary">
      →
    </span>
  );
}
