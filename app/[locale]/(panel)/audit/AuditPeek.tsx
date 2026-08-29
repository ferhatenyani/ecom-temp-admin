"use client";

import { useTranslations } from "next-intl";
import type { AuditRow } from "@/lib/api/schemas/audit";
import {
  changedPairs,
  isFilterableResourceId,
  isRedacted,
  isSystemActor,
  metadataShape,
  type MetadataShape,
} from "@/lib/audit";
import { formatDate } from "@/lib/format/date";
import { Drawer, useLatchedOpener } from "@/components/ui/Overlay";
import { DataList, DataRow } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { auditOpenerId, resourceName, type AuditColumnContext } from "./columns";

/**
 * One entry in the trail, opened without leaving the list.
 *
 * ## It costs no request, and this is the strongest case in the run for a peek
 *
 * The standing rule frees a drawer when `GET /{id}` returns the list row
 * exactly. Here there is **no `GET /audit-logs/{id}` at all**:
 * `AuditLogController.php:33-41` registers one route, GET on the collection, and
 * says why — *"Read-only by design. Audit records are append-only, so there is
 * no POST, PATCH or DELETE here and there never should be."* `lib/api/allowlist.ts`
 * carries the single rule and `tests/boundary.test.ts:333` asserts the single-row
 * route refused. So the list row **is** the entire record, all nine fields, and
 * the peek renders what is already in memory.
 *
 * That also settles the shape of the whole screen. The metadata is the record's
 * surface — it is the only field that says what actually changed — and it has no
 * fixed height, so it cannot be a column and it cannot be a third tier inside a
 * row. It is this drawer.
 *
 * ## It is deliberately **not** URL-addressable, and that is the carried-forward
 * ## orders/products defect being designed out rather than inherited
 *
 * `OrdersList.tsx:162` and `ProductsList.tsx:244` accept `?peek=<id>` and can
 * only resolve an id that happens to be on the page in front of them; the media
 * branch fixed its own by falling through to `GET /{id}` on a miss. **That door
 * is closed here.** With 887 pages, a peeked id is off the current page in very
 * nearly every case, and there is no single-row route to fall through to — so a
 * `?peek=` parameter would be a link that silently resolves to nothing for
 * almost every value it can hold. The open record lives in component state.
 *
 * `returnFocusTo` is **latched**: Radix fires `onCloseAutoFocus` *after*
 * `onOpenChange`, so by the time focus is restored the screen has already
 * cleared the record and a derived id would be `undefined` — focus lands on
 * `<body>`. The keyboard path hides this, because there the opener also *held*
 * focus at open and Radix's own fallback is already right; only a **pointer**
 * open depends on the name. DECISIONS.md §10.
 */
export function AuditPeek({
  row,
  ctx,
  onOpenChange,
  onFilterResource,
}: {
  row: AuditRow | null;
  ctx: AuditColumnContext;
  onOpenChange: (open: boolean) => void;
  /** Narrows the list to this object's own history. See the footer. */
  onFilterResource: (resourceType: string, resourceId: string) => void;
}) {
  const t = useTranslations("audit");

  const returnFocusTo = useLatchedOpener(row && auditOpenerId(row.id));

  /*
   * **The affordance is absent, not disabled, when the id cannot be asked for.**
   * `?resource_id=0` and `?resource_id=` each answer the whole collection —
   * PHP's `array_filter` and `!empty()` both drop the falsy string — while
   * `settings.updated` and `import.products` rows genuinely carry `"0"`. A
   * button sending it would report a narrowing that did not happen, which is
   * §3.3's "a control that cannot act is not rendered".
   */
  const filterable = row !== null && isFilterableResourceId(row.resource_id);

  return (
    <Drawer
      open={row !== null}
      /* The action names the record. It is an identifier, and `OverlayFrame`
         renders the title `dir="auto"`, which resolves LTR over an all-ASCII
         string inside the Arabic panel too. */
      title={row?.action ?? ""}
      /* The stamp, and it is the record's **only** copy of it — a `Date` row in
         the list below said the same string six inches lower, which is the
         repeated-footnote defect at drawer scale. Here it reads as half of the
         record's identity (this action, at this moment) and it is what a screen
         reader is given as the dialog's description. */
      description={row === null ? undefined : formatDate(row.created_at, ctx.locale)}
      size="md"
      onOpenChange={onOpenChange}
      returnFocusTo={returnFocusTo}
      footer={
        filterable && row !== null ? (
          <Button
            variant="primary"
            icon="filter"
            onClick={() => onFilterResource(row.resource_type, row.resource_id)}
          >
            {t("peek.filterResource")}
          </Button>
        ) : null
      }
    >
      {row === null ? null : (
        <div className="flex flex-col gap-4">
          <DataList>
            <DataRow label={t("field.actor")}>
              {isSystemActor(row) ? (
                t("systemActor")
              ) : (
                <Ltr numeric={false}>{row.actor_login}</Ltr>
              )}
            </DataRow>
            <DataRow label={t("field.resource")}>
              <Isolate numeric={false}>{resourceName(row, ctx)}</Isolate>
            </DataRow>
            {row.resource_id === "" ? null : (
              <DataRow label={t("field.resourceId")}>
                <Ltr numeric={false}>{row.resource_id}</Ltr>
              </DataRow>
            )}
            {/*
              The forensic field, and the reason it is here rather than in a
              column: on this shop it is one of two hosts on almost every row, so
              on the list it would be scan noise, and on the one row where it
              matters it is the whole answer. `Ltr`, because an address reorders
              inside Arabic text without isolation.
            */}
            <DataRow label={t("field.ip")}>
              <Ltr>{row.ip_address}</Ltr>
            </DataRow>
          </DataList>

          <MetadataBlock row={row} />

          {/*
            Said once, on the record it is about, and only where it applies —
            §19's rule that a caveat goes on the thing it is about rather than
            stacking at the foot of the page.
          */}
          {filterable ? null : (
            <p className="text-ui-label text-ui-subtle">{t("peek.noResource")}</p>
          )}
        </div>
      )}
    </Drawer>
  );
}

/**
 * **What the trail recorded, rendered by shape rather than by assumption.**
 *
 * ADMIN_PANEL.md says writes are audited by field name and never by value.
 * Measured, that is true of `settings.updated` — which is where the spec argues
 * for it, and where the shop's trade-register numbers would otherwise sit in a
 * table nobody cleans — and false of `product.updated`, which carries `before`
 * and `after` in full. Four shapes, all four live on the table, and a block this
 * build cannot classify renders as its own key/value pairs: the trail is the one
 * screen where showing less than arrived is the wrong failure.
 *
 * An **empty** block is stated rather than left blank. `metadata` is `{}` on a
 * row whose writer recorded nothing — never null — and an empty box would read
 * as a failed fetch rather than as the fact it is.
 */
function MetadataBlock({ row }: { row: AuditRow }) {
  const t = useTranslations("audit");
  const shape = metadataShape(row.metadata);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h3 className="text-ui-subheading text-ui-fg">{t("field.metadata")}</h3>
      {isEmptyShape(shape) ? (
        <p className="text-ui-label text-ui-subtle">{t("metadataEmpty")}</p>
      ) : shape.kind === "change" ? (
        <ul className="flex flex-col gap-1">
          {changedPairs(shape).map((pair) => (
            <li
              key={pair.field}
              className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-ui-compact"
            >
              <Ltr numeric={false} className="shrink-0 text-ui-muted">
                {pair.field}
              </Ltr>
              <span className="min-w-0 break-words text-ui-subtle line-through" dir="auto">
                {pair.before}
              </span>
              <Arrow />
              <span className="min-w-0 break-words text-ui-fg" dir="auto">
                {pair.after}
              </span>
            </li>
          ))}
        </ul>
      ) : shape.kind === "transition" ? (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-ui-compact">
          <Ltr numeric={false} className="min-w-0 break-words text-ui-subtle">
            {shape.from}
          </Ltr>
          <Arrow />
          <Ltr numeric={false} className="min-w-0 break-words text-ui-fg">
            {shape.to}
          </Ltr>
        </p>
      ) : shape.kind === "fields" ? (
        /* The field *names*, which is the whole point of this shape: the log
           says a trade-register field changed and not what it changed to, and a
           reader expecting values has to be told they were never stored. */
        <p className="text-ui-compact text-ui-fg">
          <Isolate numeric={false}>
            {t("fieldsChanged", { fields: shape.fields.join(", ") })}
          </Isolate>
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {shape.entries.map(([key, value]) => (
            <li
              key={key}
              className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-ui-compact"
            >
              <Ltr numeric={false} className="shrink-0 text-ui-muted">
                {key}
              </Ltr>
              {/*
                `[redacted]` is what the writer stored, and it is a **fact rather
                than a missing value**: a row rendering it as a blank would say
                the key was absent, which is a different and untrue thing.
                Measured on `notification.retried`, where `dedupe_key` comes back
                redacted because it carries a customer's order id.
              */}
              {isRedacted(value) ? (
                <span className="rounded-ui-sm bg-ui-neutral-bg px-1.5 text-ui-neutral-fg">
                  {t("redacted")}
                </span>
              ) : (
                <span className="min-w-0 break-words text-ui-fg" dir="auto">
                  {value}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** `{}` reaches `metadataShape` as a `plain` shape with no entries. */
function isEmptyShape(shape: MetadataShape): boolean {
  return shape.kind === "plain" && shape.entries.length === 0;
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
    <span aria-hidden="true" className="shrink-0 text-ui-subtle">
      →
    </span>
  );
}
